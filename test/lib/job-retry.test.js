/**
 * lib/job — failed-job retry (#AI6 follow-up)
 *
 * `create(fn, { maxAttempts: N })` retries a failed attempt on the creating
 * process with exponential backoff (`retryBackoffMs`, default 1000 ms,
 * doubling per attempt). Design invariants covered here:
 *   - Back-compat: default maxAttempts = 1 → byte-identical runs-once
 *     behavior (the retry branch is dead unless opted in).
 *   - Settle-time reschedule: a retryable failure returns the record to
 *     `pending` (the serialised last error stays visible, `nextRetryAt` is
 *     informational) — `failed` / `completed` are STRICTLY terminal.
 *   - `expiresAt` stays null while retries remain, so the sweep can never
 *     purge a retryable job.
 *   - The completion webhook fires exactly once, at the terminal transition.
 *   - reset() cancels pending backoff timers (none can fire into a torn-down
 *     store); remove() during a backoff is absorbed by the vanished-record
 *     guard (no resurrection).
 *   - The store seam is untouched: the retry path round-trips a REAL
 *     connector store (SQLite, `:memory:`) unchanged.
 *
 * Plus source pins on the reschedule shape and the gna.js knob wiring.
 *
 * Run: node --test test/lib/job-retry.test.js
 */

'use strict';

var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var job    = require(path.join(FW, 'lib/job/src/main'));
var SOURCE = path.join(FW, 'lib/job/src/main.js');


// ─── Helpers ────────────────────────────────────────────────────────────────

function tick(ms) {
    return new Promise(function(r) { setTimeout(r, ms || 5); });
}

function getJob(id) {
    return new Promise(function(res) { job.get(id, function(e, rec) { res(rec); }); });
}

async function waitForState(id, state, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 2000);
    var rec;
    while (Date.now() < deadline) {
        rec = await getJob(id);
        if (rec && rec.state === state) return rec;
        await tick(2);
    }
    throw new Error('timeout waiting for "' + state + '"; last state = ' + (rec && rec.state));
}

/** Poll until pred(rec) is truthy; returns the matching record snapshot. */
async function waitForRec(id, pred, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 2000);
    var rec;
    while (Date.now() < deadline) {
        rec = await getJob(id);
        if (rec && pred(rec)) return rec;
        await tick(2);
    }
    throw new Error('timeout waiting for predicate; last rec = ' + JSON.stringify(rec));
}

function startWebhookServer(handler) {
    return new Promise(function(resolve) {
        var http   = require('http');
        var server = http.createServer(handler);
        server.listen(0, '127.0.0.1', function() {
            resolve({ server: server, url: 'http://127.0.0.1:' + server.address().port + '/hook' });
        });
    });
}


beforeEach(function() {
    job.reset();
    job.start({ sweepInterval: 0 });
});


// ─── 01 — back-compat: default maxAttempts runs once ────────────────────────

describe('job-retry § 01 — default maxAttempts = 1 is byte-identical runs-once', function() {

    it('a failing job with no maxAttempts goes failed on the FIRST failure', async function() {
        var runs = 0;
        var id = job.create(function() { runs++; throw new Error('boom'); });
        var rec = await waitForState(id, 'failed');
        assert.equal(runs, 1, 'the fn ran exactly once');
        assert.equal(rec.attempts, 1);
        assert.equal(rec.error.message, 'boom');
        assert.equal(rec.nextRetryAt, null, 'terminal record carries no scheduled retry');
        assert.equal(typeof rec.expiresAt, 'number', 'terminal record is sweepable');
        assert.equal(job.stats().retryWaiting, 0);
    });

    it('exports DEFAULT_RETRY_BACKOFF_MS alongside the sibling defaults', function() {
        assert.equal(job.DEFAULT_RETRY_BACKOFF_MS, 1000);
    });
});


// ─── 02 — retry then succeed ────────────────────────────────────────────────

describe('job-retry § 02 — fail, retry with backoff, succeed', function() {

    it('runs the fn again after a failure and completes with a clean record', async function() {
        job.start({ retryBackoffMs: 30, sweepInterval: 0 });
        var failures = 0;
        var id = job.create(function() {
            if (failures < 2) { failures++; throw new Error('flaky-' + failures); }
            return 'finally';
        }, { maxAttempts: 3 });

        // Between attempts the record is PENDING again, with the last failure
        // visible and an informational nextRetryAt — never `failed`.
        var mid = await waitForRec(id, function(r) { return r.state === 'pending' && r.nextRetryAt; });
        assert.equal(mid.error.message, 'flaky-1', 'last failure stays visible mid-retry');
        assert.equal(mid.expiresAt, null, 'not sweepable while retries remain');
        assert.equal(typeof mid.nextRetryAt, 'number');

        var rec = await waitForState(id, 'completed', 4000);
        assert.equal(rec.result, 'finally');
        assert.equal(rec.attempts, 3, 'two failures + one success');
        assert.equal(rec.error, null, 'success clears the mid-retry error');
        assert.equal(rec.nextRetryAt, null);
        assert.equal(typeof rec.expiresAt, 'number');
        assert.equal(failures, 2);
    });

    it('never surfaces a transient `failed` state while retries remain', async function() {
        job.start({ retryBackoffMs: 20, sweepInterval: 0 });
        var sawFailed = false;
        var failures  = 0;
        var id = job.create(function() {
            if (failures < 1) { failures++; throw new Error('once'); }
            return 'ok';
        }, { maxAttempts: 2 });

        var deadline = Date.now() + 2000;
        var rec;
        while (Date.now() < deadline) {
            rec = await getJob(id);
            if (rec && rec.state === 'failed') sawFailed = true;
            if (rec && rec.state === 'completed') break;
            await tick(1);
        }
        assert.equal(rec.state, 'completed');
        assert.equal(sawFailed, false, 'failed must be strictly terminal');
    });
});


// ─── 03 — retries exhausted ─────────────────────────────────────────────────

describe('job-retry § 03 — retries exhausted goes failed with the LAST error', function() {

    it('fails after exactly maxAttempts runs', async function() {
        job.start({ retryBackoffMs: 20, sweepInterval: 0 });
        var runs = 0;
        var id = job.create(function() { runs++; throw new Error('always-' + runs); }, { maxAttempts: 2 });
        var rec = await waitForState(id, 'failed', 4000);
        assert.equal(runs, 2, 'the fn ran exactly maxAttempts times');
        assert.equal(rec.attempts, 2);
        assert.equal(rec.error.message, 'always-2', 'the LAST failure is recorded');
        assert.equal(rec.nextRetryAt, null);
        assert.equal(typeof rec.expiresAt, 'number', 'now sweepable');
        assert.equal(job.stats().retryWaiting, 0);
    });
});


// ─── 04 — webhook fires only at the terminal transition ─────────────────────

describe('job-retry § 04 — webhook only at terminal', function() {

    it('POSTs exactly once, after the final attempt', async function() {
        job.start({ retryBackoffMs: 20, sweepInterval: 0 });
        var hits = [];
        var ctx = await startWebhookServer(function(req, res) {
            var body = '';
            req.on('data', function(c) { body += c; });
            req.on('end',  function() { hits.push(JSON.parse(body)); res.writeHead(200); res.end(); });
        });
        var failures = 0;
        var id = job.create(function() {
            if (failures < 2) { failures++; throw new Error('flaky'); }
            return 'done';
        }, { maxAttempts: 3, callbackUrl: ctx.url });

        await waitForState(id, 'completed', 4000);
        await tick(150); // give a (wrong) mid-retry delivery time to show up
        ctx.server.close();
        assert.equal(hits.length, 1, 'exactly one webhook delivery');
        assert.equal(hits[0].id, id);
        assert.equal(hits[0].state, 'completed');
        assert.equal(hits[0].result, 'done');
    });
});


// ─── 05 — sweep can never purge a retryable job ─────────────────────────────

describe('job-retry § 05 — expiresAt stays null while retries remain', function() {

    it('a mid-retry record survives an explicit sweep', async function() {
        job.start({ retryBackoffMs: 120, sweepInterval: 0 });
        var failures = 0;
        var id = job.create(function() {
            if (failures < 1) { failures++; throw new Error('once'); }
            return 'ok';
        }, { maxAttempts: 2 });

        var mid = await waitForRec(id, function(r) { return r.state === 'pending' && r.nextRetryAt; });
        assert.equal(mid.expiresAt, null);

        var removed = await new Promise(function(res) { job.sweep(function(e, n) { res(n); }); });
        assert.equal(removed, 0, 'mid-retry record is not sweepable');
        assert.ok(await getJob(id), 'still present');

        var rec = await waitForState(id, 'completed', 4000);
        assert.equal(rec.result, 'ok');
    });
});


// ─── 06 — exponential backoff shape ─────────────────────────────────────────

describe('job-retry § 06 — backoff doubles per attempt', function() {

    it('nextRetryAt reflects base, then 2×base', async function() {
        job.start({ retryBackoffMs: 100, sweepInterval: 0 });
        var id = job.create(function() { throw new Error('always'); }, { maxAttempts: 3 });

        // Snapshot the numbers immediately — the memory store returns the LIVE
        // record object, so a later attempt mutates any held reference.
        var afterFirst = await waitForRec(id, function(r) {
            return r.state === 'pending' && r.attempts === 1 && r.nextRetryAt;
        });
        var nrt1   = afterFirst.nextRetryAt;
        var delta1 = afterFirst.nextRetryAt - afterFirst.updatedAt;

        var afterSecond = await waitForRec(id, function(r) {
            return r.state === 'pending' && r.attempts === 2 && r.nextRetryAt;
        }, 3000);
        var nrt2   = afterSecond.nextRetryAt;
        var delta2 = afterSecond.nextRetryAt - afterSecond.updatedAt;

        assert.ok(delta1 <= 100, 'first backoff at most the base (got ' + delta1 + ')');
        assert.ok(delta2 <= 200, 'second backoff at most 2×base (got ' + delta2 + ')');
        assert.ok(delta2 > delta1, 'backoff grows (got ' + delta1 + ' then ' + delta2 + ')');
        assert.ok(nrt2 - nrt1 > 100,
            'the second retry is scheduled at least a base later than the first');

        await waitForState(id, 'failed', 4000);
    });
});


// ─── 07 — reset() cancels pending backoff timers ────────────────────────────

describe('job-retry § 07 — reset() cancels pending retries', function() {

    it('a pending backoff never fires into a torn-down store', async function() {
        job.start({ retryBackoffMs: 60, sweepInterval: 0 });
        var runs = 0;
        var id = job.create(function() { runs++; throw new Error('x'); }, { maxAttempts: 5 });

        await waitForRec(id, function(r) { return r.state === 'pending' && r.nextRetryAt; });
        assert.equal(job.stats().retryWaiting, 1, 'one backoff pending');

        job.reset();
        assert.equal(job.stats().retryWaiting, 0, 'reset cancels the timer');
        var runsAtReset = runs;

        await tick(200); // past the would-be backoff — must be inert
        assert.equal(runs, runsAtReset, 'the cancelled retry never ran');

        // The primitive is still healthy after the reset.
        job.start({ sweepInterval: 0 });
        var id2 = job.create(function() { return 'fresh'; });
        var rec = await waitForState(id2, 'completed');
        assert.equal(rec.result, 'fresh');
    });
});


// ─── 08 — remove() during a backoff window ──────────────────────────────────

describe('job-retry § 08 — remove() during backoff is absorbed, no resurrection', function() {

    it('the fired timer hits the vanished-record guard and drops the job', async function() {
        job.start({ retryBackoffMs: 40, sweepInterval: 0 });
        var runs = 0;
        var id = job.create(function() { runs++; throw new Error('x'); }, { maxAttempts: 3 });

        await waitForRec(id, function(r) { return r.state === 'pending' && r.nextRetryAt; });
        await new Promise(function(res) { job.remove(id, function() { res(); }); });

        await tick(150); // let the backoff timer fire against the removed id
        assert.equal(await getJob(id), null, 'record is not resurrected by the retry');
        assert.equal(runs, 1, 'the fn never ran again');
        assert.equal(job.stats().running, 0);
        assert.equal(job.stats().queued, 0);
    });
});


// ─── 09 — retry round-trips a REAL connector store (seam untouched) ─────────

describe('job-retry § 09 — retry over the SQLite connector store', function() {

    it('fail-then-succeed lands the clean terminal record in the store', async function() {
        var createStore = require(path.join(FW, 'core/connectors/sqlite/lib/job-store'));
        var store = createStore({ file: ':memory:' }, 'testbundle');
        job.reset();
        job.start({ store: store, retryBackoffMs: 20, sweepInterval: 0 });

        var failures = 0;
        var id = job.create(function() {
            if (failures < 1) { failures++; throw new Error('once'); }
            return 'durable';
        }, { maxAttempts: 2 });

        var rec = await waitForState(id, 'completed', 4000);
        assert.equal(rec.result, 'durable');
        assert.equal(rec.attempts, 2);
        assert.equal(rec.error, null);
        assert.equal(rec.nextRetryAt, null);

        // Straight from the store, bypassing lib/job.
        var raw = await new Promise(function(res, rej) {
            store.get(id, function(e, r) { e ? rej(e) : res(r); });
        });
        assert.equal(raw.state, 'completed');
        assert.equal(raw.result, 'durable');
        job.reset();
        if (typeof store.close === 'function') store.close();
    });
});


// ─── 10 — source pins ───────────────────────────────────────────────────────

describe('job-retry § 10 — source pins', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    it('defines scheduleRetry with an unref\'d timer', function() {
        var at = src.indexOf('function scheduleRetry(');
        assert.ok(at > -1, 'scheduleRetry exists');
        var block = src.slice(at, src.indexOf('\n}', at) + 2);
        assert.ok(block.indexOf('.unref') > -1, 'retry timer is unref\'d');
        assert.ok(block.indexOf('_queue.push(entry)') > -1, 're-enqueues through the normal queue');
        assert.ok(block.indexOf('if (!_store) return') > -1, 'guards a reset racing an elapsed timer');
    });

    it('settle gates the reschedule on attempts < maxAttempts (opt-in only)', function() {
        assert.ok(src.indexOf('entry.attempts < entry.maxAttempts') > -1);
    });

    it('the retry patch returns the record to pending with the error kept visible', function() {
        var at = src.indexOf('function settle(');
        var block = src.slice(at, src.indexOf('\n}', at) + 2);
        assert.ok(block.indexOf('state:       STATES.PENDING') > -1, 'back to pending, no transient failed');
        assert.ok(block.indexOf('nextRetryAt: now + delay') > -1,   'informational nextRetryAt');
        // The retry patch must NOT set expiresAt — only the terminal patches do.
        var retryPatch = block.slice(block.indexOf('STATES.PENDING'), block.indexOf('scheduleRetry('));
        assert.ok(retryPatch.indexOf('expiresAt') < 0, 'retry patch never sets expiresAt (sweep-safety)');
    });

    it('terminal patches clear nextRetryAt (and success clears the mid-retry error)', function() {
        // 3 = settle()'s failed patch + settle()'s completed patch + the #B471
        // orphan-reclaim patch (reclaimOrphans — a synthetic terminal write for
        // records stranded by a dead process). Every terminal patch must clear
        // nextRetryAt; a count moving OFF 3 means a new terminal write site
        // appeared (or one vanished) — re-census before touching this number.
        assert.equal((src.match(/nextRetryAt: null/g) || []).length, 3, 'every terminal patch clears it');
        assert.ok(src.indexOf('result: result, error: null') > -1, 'success patch clears error');
    });

    it('reset() cancels and clears the retry timers', function() {
        var at = src.indexOf('function reset(');
        var block = src.slice(at, src.indexOf('\n}', at) + 2);
        assert.ok(block.indexOf('_retryTimers.forEach') > -1);
        assert.ok(block.indexOf('_retryTimers.clear()') > -1);
        assert.ok(block.indexOf('_retryBackoffMs     = DEFAULT_RETRY_BACKOFF_MS') > -1);
    });

    it('gna.js forwards the app.json retryBackoffMs knob', function() {
        var gna = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
        assert.ok(gna.indexOf('retryBackoffMs: _jobsConf.retryBackoffMs') > -1);
    });
});
