/**
 * lib/job — async-job primitive (#AI6, slice 1)
 *
 * Tests cover the runtime primitive in isolation:
 *   - Module shape + STATES + DEFAULT_* exports
 *   - create() — returns a jobId synchronously, pending → running → completed
 *   - error capture — sync throw and async reject both land as `failed`
 *   - concurrency cap — never more than maxConcurrency workers at once
 *   - sweep / TTL — terminal records past expiresAt are purged; live ones aren't
 *   - toStatusView — state-only projection (no result / error leak)
 *   - start() knobs + reset()
 *
 * Plus source-structure pins on the primitive and framework-wiring pins on
 * lib/index.js (plain require) and gna.js (boot start).
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

function countState(state) {
    return new Promise(function(res) { job.list({ state: state }, function(e, recs) { res(recs.length); }); });
}

async function waitForState(id, state, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 1000);
    var rec;
    while (Date.now() < deadline) {
        rec = await getJob(id);
        if (rec && rec.state === state) return rec;
        await tick(2);
    }
    throw new Error('timeout waiting for "' + state + '"; last state = ' + (rec && rec.state));
}


// Reset singleton state between tests; disable the internal timer so sweeps
// are driven explicitly (deterministic).
beforeEach(function() {
    job.reset();
    job.start({ sweepInterval: 0 });
});


// ─── 01 — Module shape ─────────────────────────────────────────────────────

describe('01 - lib/job module exports (#AI6)', function() {

    it('exports the public API', function() {
        assert.equal(typeof job.create,       'function');
        assert.equal(typeof job.get,          'function');
        assert.equal(typeof job.list,         'function');
        assert.equal(typeof job.remove,       'function');
        assert.equal(typeof job.sweep,        'function');
        assert.equal(typeof job.start,        'function');
        assert.equal(typeof job.stats,        'function');
        assert.equal(typeof job.toStatusView, 'function');
        assert.equal(typeof job.reset,        'function');
    });

    it('exports the four lifecycle states', function() {
        assert.deepEqual(job.STATES, {
            PENDING:   'pending',
            RUNNING:   'running',
            COMPLETED: 'completed',
            FAILED:    'failed'
        });
    });

    it('exports numeric defaults', function() {
        assert.equal(typeof job.DEFAULT_MAX_CONCURRENCY, 'number');
        assert.equal(typeof job.DEFAULT_TTL,             'number');
        assert.equal(typeof job.DEFAULT_SWEEP_INTERVAL,  'number');
        assert.equal(job.DEFAULT_ID_SIZE, 21);
    });

});


// ─── 02 — create() happy path ──────────────────────────────────────────────

describe('02 - create() + completion', function() {

    it('returns a 21-char id synchronously and starts pending', async function() {
        var id = job.create(function() { return 'done'; });
        assert.equal(typeof id, 'string');
        assert.equal(id.length, 21);

        // Synchronously after create() the record exists and is pending.
        var rec = await getJob(id);
        assert.ok(rec, 'record exists immediately');
        assert.equal(rec.state, 'pending');
        assert.equal(rec.result, null);

        rec = await waitForState(id, 'completed');
        assert.equal(rec.result, 'done');
        assert.equal(rec.error, null);
        assert.equal(rec.attempts, 1);
        assert.ok(rec.startedAt  >= rec.createdAt);
        assert.ok(rec.finishedAt >= rec.startedAt);
        assert.ok(rec.expiresAt  >  rec.finishedAt, 'expiresAt set on terminal');
    });

    it('resolves a returned Promise', async function() {
        var id  = job.create(function() { return Promise.resolve({ ok: 1 }); });
        var rec = await waitForState(id, 'completed');
        assert.deepEqual(rec.result, { ok: 1 });
    });

    it('stores caller meta on the record', async function() {
        var id  = job.create(function() { return 1; }, { meta: { kind: 'infer' } });
        var rec = await getJob(id);
        assert.deepEqual(rec.meta, { kind: 'infer' });
    });

});


// ─── 03 — error capture ─────────────────────────────────────────────────────

describe('03 - error capture', function() {

    it('captures a synchronous throw as failed', async function() {
        var id  = job.create(function() { throw new Error('boom'); });
        var rec = await waitForState(id, 'failed');
        assert.equal(rec.result, null);
        assert.equal(rec.error.name, 'Error');
        assert.equal(rec.error.message, 'boom');
        assert.ok(typeof rec.error.stack === 'string' && rec.error.stack.length > 0);
    });

    it('captures an async rejection as failed', async function() {
        var id  = job.create(function() { return Promise.reject(new TypeError('nope')); });
        var rec = await waitForState(id, 'failed');
        assert.equal(rec.error.name, 'TypeError');
        assert.equal(rec.error.message, 'nope');
    });

    it('never stores a raw Error instance (serialisable shape only)', async function() {
        var id  = job.create(function() { throw new Error('x'); });
        var rec = await waitForState(id, 'failed');
        assert.ok(!(rec.error instanceof Error), 'error is a plain object');
        // Round-trips through JSON (the connector-store requirement).
        assert.doesNotThrow(function() { JSON.stringify(rec); });
    });

    it('throws TypeError when fn is not a function', function() {
        assert.throws(function() { job.create(123); }, TypeError);
        assert.throws(function() { job.create();    }, TypeError);
    });

});


// ─── 04 — concurrency cap ───────────────────────────────────────────────────

describe('04 - concurrency limiting', function() {

    it('never runs more than maxConcurrency workers at once', async function() {
        job.start({ maxConcurrency: 2, sweepInterval: 0 });

        var active = 0, maxActive = 0;
        var releases = [];
        function gated() {
            return new Promise(function(resolve) {
                active++;
                if (active > maxActive) maxActive = active;
                releases.push(function() { active--; resolve('ok'); });
            });
        }

        var i;
        for (i = 0; i < 5; i++) job.create(gated);

        await tick(15); // let the first batch start
        assert.equal(job.stats().running, 2, 'two workers running');
        assert.equal(job.stats().queued,  3, 'three queued');
        assert.equal(maxActive, 2, 'cap held on the first batch');

        // Drain through the 2-slot gate, releasing one at a time.
        var deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            if (releases.length) releases.shift()();
            await tick(2);
            if (await countState('completed') === 5) break;
        }

        assert.equal(await countState('completed'), 5, 'all five completed');
        assert.equal(maxActive, 2, 'cap held for the whole run');
        assert.equal(job.stats().running, 0, 'no workers left running');
        assert.equal(job.stats().queued,  0, 'queue drained');
    });

});


// ─── 05 — sweep / TTL ───────────────────────────────────────────────────────

describe('05 - sweep / TTL', function() {

    it('does not sweep a terminal record still within its TTL', async function() {
        var id = job.create(function() { return 1; });
        await waitForState(id, 'completed');

        await new Promise(function(res) { job.sweep(function(e, n) { res(n); }); })
            .then(function(removed) { assert.equal(removed, 0, 'within TTL → kept'); });
        assert.ok(await getJob(id), 'still present');
    });

    it('sweeps a terminal record once expiresAt has passed', async function() {
        var id  = job.create(function() { return 1; });
        var rec = await waitForState(id, 'completed');

        // The memory store returns the live record — backdate its expiry.
        rec.expiresAt = Date.now() - 1;

        var removed = await new Promise(function(res) { job.sweep(function(e, n) { res(n); }); });
        assert.equal(removed, 1, 'expired terminal → purged');
        assert.equal(await getJob(id), null, 'gone after sweep');
    });

    it('never sweeps a running job', async function() {
        var release;
        var id = job.create(function() {
            return new Promise(function(resolve) { release = resolve; });
        });
        await waitForState(id, 'running');

        var removed = await new Promise(function(res) { job.sweep(function(e, n) { res(n); }); });
        assert.equal(removed, 0, 'running job never swept (expiresAt is null)');
        assert.ok(await getJob(id), 'still present');

        // Settle it within this test so the pending work does not cross over.
        release('ok');
        await waitForState(id, 'completed');
    });

});


// ─── 06 — toStatusView ──────────────────────────────────────────────────────

describe('06 - toStatusView (state-only projection)', function() {

    it('projects to id/state/createdAt/updatedAt and omits result + error', function() {
        var view = job.toStatusView({
            id: 'abc', state: 'completed', createdAt: 1, updatedAt: 2,
            result: 'SECRET', error: { message: 'oops' }
        });
        assert.deepEqual(view, { id: 'abc', state: 'completed', createdAt: 1, updatedAt: 2 });
        assert.ok(!('result' in view), 'no result leaked to the public view');
        assert.ok(!('error'  in view), 'no error leaked to the public view');
    });

    it('returns null for a missing record', function() {
        assert.equal(job.toStatusView(null), null);
        assert.equal(job.toStatusView(undefined), null);
    });

});


// ─── 07 — start() knobs + reset() ───────────────────────────────────────────

describe('07 - start() knobs + reset()', function() {

    it('applies the maxConcurrency knob', function() {
        job.start({ maxConcurrency: 7 });
        assert.equal(job.stats().maxConcurrency, 7);
    });

    it('reset() clears state and restores defaults', async function() {
        var id = job.create(function() { return 1; });
        await waitForState(id, 'completed');

        job.reset();
        assert.equal(job.stats().maxConcurrency, job.DEFAULT_MAX_CONCURRENCY);
        assert.equal(job.stats().running, 0);
        assert.equal(job.stats().queued,  0);
        // Store was torn down — previously-created id is gone.
        assert.equal(await getJob(id), null);
    });

    it('ignores non-positive knob values (keeps defaults)', function() {
        job.reset();
        job.start({ maxConcurrency: 0, ttl: -5 });
        assert.equal(job.stats().maxConcurrency, job.DEFAULT_MAX_CONCURRENCY);
    });

});


// ─── 08 — id uniqueness ─────────────────────────────────────────────────────

describe('08 - jobId generation', function() {

    it('produces unique 21-char ids', async function() {
        var ids = {};
        var i, id;
        var created = [];
        for (i = 0; i < 50; i++) {
            id = job.create(function() { return 1; });
            assert.equal(id.length, 21, 'id is 21 chars');
            assert.ok(!ids[id], 'id is unique');
            ids[id] = true;
            created.push(id);
        }
        // Drain so none of these settles leak into the next test.
        var deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            if (await countState('completed') === 50) break;
            await tick(3);
        }
        assert.equal(await countState('completed'), 50);
    });

});


// ─── 09 — source structure (lib/job) ────────────────────────────────────────

describe('09 - source structure (#AI6)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    it('carries the #AI6 marker', function() {
        assert.ok(src.indexOf('#AI6') > -1);
    });

    it('defines the worker functions', function() {
        assert.ok(src.indexOf('function create(') > -1, 'create');
        assert.ok(src.indexOf('function drain(')  > -1, 'drain');
        assert.ok(src.indexOf('function runOne(') > -1, 'runOne');
        assert.ok(src.indexOf('function settle(') > -1, 'settle');
    });

    it('enforces the concurrency cap in the worker loop', function() {
        assert.ok(src.indexOf('_running < _maxConcurrency') > -1, 'cap checked in drain');
    });

    it('uses a self-contained unref\'d sweep timer (not cron)', function() {
        assert.ok(src.indexOf('setInterval(') > -1, 'has an interval timer');
        assert.ok(/\.unref\(\)/.test(src),          'timer is unref\'d');
    });

    it('serialises errors rather than storing a raw Error', function() {
        assert.ok(src.indexOf('function serializeError(') > -1);
    });

    it('defers fn invocation through a resolved Promise (sync-throw === async-reject path)', function() {
        assert.ok(src.indexOf('Promise.resolve().then(') > -1);
    });

});


// ─── 10 — framework wiring (#AI6) ────────────────────────────────────────────

describe('10 - framework wiring (#AI6)', function() {

    it('lib/index.js registers job with a plain require (singleton-safe)', function() {
        var idx = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
        assert.ok(/job\s*:\s*require\('\.\/job'\)/.test(idx),  'job registered via plain require');
        assert.ok(!/job\s*:\s*_require\('\.\/job'\)/.test(idx), 'job must NOT use _require (would not survive refreshCore)');
    });

    it('gna.js wires lib.job.start() at boot', function() {
        var gna = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
        assert.ok(gna.indexOf('lib.job.start(') > -1, 'lib.job.start() called at boot');
        assert.ok(gna.indexOf('#AI6') > -1,            '#AI6 marker present in boot block');
    });

});
