'use strict';
/**
 * lib/job — #B471 orphan reclaim (stranded non-terminal records)
 *
 * The deferred function lives only in its creating process (a closure cannot
 * be serialised), so a record left `running` — or `pending` past its
 * scheduled retry — by a process death can never settle. `expiresAt` stays
 * `null` and the TTL sweep's own `expires_at IS NOT NULL` guard excludes the
 * record forever: unbounded growth, phantom `running` listings, and the
 * documented polling pattern never terminating. #B471 precedes the sweep
 * with a reclaim pass on DURABLE stores: non-terminal records past
 * `orphanTimeout` (default 24h, floored at 60s, `0`/`false` disables) are
 * terminalized as `failed` with error name `JobOrphanedError`, after which
 * normal retention deletes them on schedule.
 *
 * Strategy: the real module driven through its public API (the job.test.js
 * harness), with a hand-built map store — an APP-SUPPLIED store, so the
 * reclaim pass runs (the built-in memory store is deliberately exempt: an
 * in-process store cannot hold another process's orphans). Records are
 * backdated by mutating the test's own store map — the exact state a dead
 * process leaves behind. Source pins cover the structural gates the public
 * API cannot reach (builtin-memory skip, gate ordering); each was validated
 * red-first against the pre-change bytes.
 */
var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var job    = require(path.join(FW, 'lib/job/src/main'));
var SOURCE = path.join(FW, 'lib/job/src/main.js');
var src    = fs.readFileSync(SOURCE, 'utf8');

var HOUR = 3600 * 1000;

/** Hand-built app-supplied store: the scripted-store shape (sync callbacks). */
function makeMapStore(overrides) {
    var map = {};
    var store = {
        _map: map,
        set:    function(id, rec, fn) { map[id] = rec; if (fn) fn(null); },
        get:    function(id, fn)      { fn(null, map[id] || null); },
        remove: function(id, fn)      { delete map[id]; if (fn) fn(null); },
        list:   function(filter, fn) {
            var out = [];
            for (var k in map) {
                if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
                if (filter && filter.state && map[k].state !== filter.state) continue;
                out.push(map[k]);
            }
            fn(null, out);
        },
        sweep: function(now, fn) {
            var removed = 0;
            for (var k in map) {
                if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
                if (map[k].expiresAt && map[k].expiresAt <= now) { delete map[k]; removed++; }
            }
            fn(null, removed);
        }
    };
    if (overrides) for (var m in overrides) store[m] = overrides[m];
    return store;
}

/** Seed a record shaped like the module writes them. */
function seedRecord(store, id, state, ageMs, extra) {
    var t = Date.now() - ageMs;
    var rec = {
        id: id, state: state, result: null, error: null,
        attempts: (state === 'pending') ? 0 : 1, maxAttempts: 1,
        callbackUrl: null, meta: null,
        createdAt: t, updatedAt: t,
        startedAt: (state === 'running') ? t : null,
        finishedAt: null, expiresAt: null
    };
    if (extra) for (var k in extra) rec[k] = extra[k];
    store._map[id] = rec;
    return rec;
}

function runSweep() {
    return new Promise(function(res) { job.sweep(function(e, n) { res({ err: e, removed: n }); }); });
}

beforeEach(function() {
    job.reset();
});

describe('01 - stale running records are reclaimed as JobOrphanedError', function() {

    it('reclaims a running record older than the ceiling; keeps a fresh one', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });
        seedRecord(store, 'stale-run', 'running', 2 * HOUR);
        seedRecord(store, 'fresh-run', 'running', 5 * 60 * 1000);

        var r = await runSweep();
        assert.equal(r.err, null);

        var stale = store._map['stale-run'];
        assert.equal(stale.state, 'failed', 'stranded record terminalized');
        assert.equal(stale.error.name, 'JobOrphanedError');
        assert.match(stale.error.message, /orphanTimeout/);
        assert.equal(stale.nextRetryAt, null);
        assert.ok(typeof stale.finishedAt === 'number');
        assert.ok(typeof stale.expiresAt === 'number', 'expiresAt set — normal retention now applies');
        assert.equal(store._map['fresh-run'].state, 'running', 'a live-aged record is never touched');
    });

    it('the sweep callback contract is unchanged: removedCount counts DELETIONS only', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });
        seedRecord(store, 'stale-run', 'running', 2 * HOUR);

        var r = await runSweep();
        assert.equal(r.removed, 0, 'a reclaim is not a deletion');
        assert.equal(store._map['stale-run'].state, 'failed');
    });

    it('a reclaimed record ages out through the ordinary sweep on the next pass', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600, ttl: 1 });
        seedRecord(store, 'stale-run', 'running', 2 * HOUR);
        await runSweep();                                   // reclaim: failed, expiresAt = now + 1s
        store._map['stale-run'].expiresAt = Date.now() - 5; // elapse the TTL without waiting
        var r2 = await runSweep();
        assert.equal(r2.removed, 1, 'the terminalized orphan is now ordinary sweepable debris');
        assert.ok(!store._map['stale-run']);
    });
});

describe('02 - pending records: overdue-retry reclaimed, waiting-on-backoff kept', function() {

    it('reclaims a pending record whose nextRetryAt is ceiling-past; keeps one merely waiting', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });
        // origin died mid-backoff: retry was due 2h ago, ceiling 1h — unambiguous
        seedRecord(store, 'dead-retry', 'pending', 3 * HOUR, { nextRetryAt: Date.now() - 2 * HOUR });
        // live origin: retry scheduled 30s in the FUTURE
        seedRecord(store, 'waiting',    'pending', 10 * 60 * 1000, { nextRetryAt: Date.now() + 30000 });
        // retry due 5 min ago but within the ceiling — a live origin may be slow; keep
        seedRecord(store, 'due-recent', 'pending', 10 * 60 * 1000, { nextRetryAt: Date.now() - 5 * 60 * 1000 });

        await runSweep();
        assert.equal(store._map['dead-retry'].state, 'failed');
        assert.equal(store._map['dead-retry'].error.name, 'JobOrphanedError');
        assert.equal(store._map['waiting'].state, 'pending', 'future retry never touched');
        assert.equal(store._map['due-recent'].state, 'pending', 'within-ceiling overdue retry never touched');
    });

    it('reclaims a plain-pending record (never ran, no nextRetryAt) past the ceiling', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });
        seedRecord(store, 'stale-pending', 'pending', 2 * HOUR);
        seedRecord(store, 'fresh-pending', 'pending', 60 * 1000);

        await runSweep();
        assert.equal(store._map['stale-pending'].state, 'failed');
        assert.equal(store._map['fresh-pending'].state, 'pending');
    });
});

describe('03 - arming: disable, floor, and the terminal-state boundary', function() {

    it('orphanTimeout: 0 disables the pass entirely', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 0 });
        seedRecord(store, 'stale-run', 'running', 48 * HOUR);
        await runSweep();
        assert.equal(store._map['stale-run'].state, 'running', 'disabled — nothing reclaimed');
    });

    it('a tiny configured ceiling is floored at 60s (both sides measured)', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 5 });
        seedRecord(store, 'age-30s', 'running', 30 * 1000);  // past 5s, inside the 60s floor
        seedRecord(store, 'age-90s', 'running', 90 * 1000);  // past the floor
        await runSweep();
        assert.equal(store._map['age-30s'].state, 'running', 'floor keeps a mid-flight job');
        assert.equal(store._map['age-90s'].state, 'failed',  'past the floor is reclaimed');
    });

    it('terminal records are never candidates, however old', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });
        seedRecord(store, 'old-done', 'completed', 48 * HOUR, { finishedAt: Date.now() - 48 * HOUR });
        await runSweep();
        assert.equal(store._map['old-done'].state, 'completed');
    });
});

describe('04 - self-heal: an origin outcome overwrites a mistaken reclaim end-to-end', function() {

    it('a reclaimed-but-actually-alive job self-corrects when its origin settles', async function() {
        var store = makeMapStore();
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });

        var release;
        var id = job.create(function() {
            return new Promise(function(resolve) { release = resolve; });
        });
        // let the worker pick it up (running) — poll the store
        await new Promise(function(res) {
            (function poll() {
                if (store._map[id] && store._map[id].state === 'running') return res();
                setTimeout(poll, 5);
            })();
        });

        // simulate "running far too long": backdate the record, as a stale
        // clock-world would see it, then sweep — the reclaim mistakes it
        store._map[id].updatedAt = Date.now() - 2 * HOUR;
        await runSweep();
        assert.equal(store._map[id].state, 'failed', 'precondition: the reclaim fired');
        assert.equal(store._map[id].error.name, 'JobOrphanedError');

        // the origin now finishes — its settle must win (unguarded write)
        release('the real result');
        await new Promise(function(res) {
            (function poll() {
                if (store._map[id] && store._map[id].state === 'completed') return res();
                setTimeout(poll, 5);
            })();
        });
        assert.equal(store._map[id].state, 'completed');
        assert.equal(store._map[id].result, 'the real result');
        assert.equal(store._map[id].error, null, 'the synthetic error is gone');
    });
});

describe('05 - resilience: the pass never breaks the sweep', function() {

    it('a store whose list() errors: reclaim skipped, sweep still runs and settles', async function() {
        var store = makeMapStore({
            list: function(filter, fn) { fn(new Error('list exploded')); }
        });
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });
        seedRecord(store, 'x', 'completed', 0, { expiresAt: Date.now() - 5 });
        var r = await runSweep();
        assert.equal(r.err, null);
        assert.equal(r.removed, 1, 'store.sweep still ran after the failed reclaim');
    });

    it('a minimal third-party store WITHOUT list(): pass skipped, sweep unaffected', async function() {
        var store = makeMapStore();
        delete store.list;
        job.start({ store: store, sweepInterval: 0, orphanTimeout: 3600 });
        seedRecord(store, 'stale-run', 'running', 2 * HOUR);
        var r = await runSweep();
        assert.equal(r.err, null);
        assert.equal(store._map['stale-run'].state, 'running', 'no list verb — no reclaim, no crash');
    });
});

describe('06 - structural pins (gates the public API cannot reach)', function() {

    it('the built-in memory store is exempt, and the gate short-circuits before any list call', function() {
        // gate shape: disabled OR builtin-memory OR no store OR no list — in that order,
        // ahead of the ceiling computation and both list() calls
        var gateIdx = src.indexOf("if (!_orphanTimeout || _storeIsBuiltinMemory || !_store || typeof _store.list !== 'function') {");
        assert.ok(gateIdx > -1, 'the four-way skip gate exists');
        var reclaimIdx = src.indexOf('function reclaimOrphans(now, cb) {');
        assert.ok(reclaimIdx > -1 && gateIdx > reclaimIdx, 'the gate is the function prologue');
        var listIdx = src.indexOf('_store.list({ state: state }', reclaimIdx);
        assert.ok(listIdx > gateIdx, 'no list call precedes the gate');
    });

    it('BOTH builtin-store creation sites set the exemption flag; the supplied-store path clears it', function() {
        var count = (src.match(/_storeIsBuiltinMemory = true;/g) || []).length;
        assert.equal(count, 2, 'ensureStarted + start default path'); // census: exactly the two createMemoryStore() adoption sites
        assert.ok(src.indexOf('_storeIsBuiltinMemory = false;') > -1, 'an app-supplied store clears it (plus reset())');
    });

    it('the reclaim write goes through update() — vanished-record tolerant, updatedAt-stamping', function() {
        var reclaimIdx = src.indexOf('function reclaimOrphans(now, cb) {');
        var endIdx     = src.indexOf('\nfunction sweep(', reclaimIdx);
        assert.ok(reclaimIdx > -1 && endIdx > reclaimIdx, 'block slice anchors hold');
        var blk = src.slice(reclaimIdx, endIdx);
        assert.ok(blk.indexOf('update(rec.id, {') > -1, 'writes via update(), never store.set directly');
        assert.ok(blk.indexOf('deliverWebhook') < 0, 'reclaim is webhook-SILENT by design');
    });

    it('sweep() runs the reclaim pass BEFORE the store sweep, with one shared timestamp', function() {
        var sweepIdx = src.indexOf('function sweep(cb) {');
        assert.ok(sweepIdx > -1);
        var blk = src.slice(sweepIdx, src.indexOf('\n}', sweepIdx) + 2);
        var reclaimAt = blk.indexOf('reclaimOrphans(now,');
        var storeAt   = blk.indexOf('_store.sweep(now, cb);');
        assert.ok(reclaimAt > -1 && storeAt > -1 && reclaimAt < storeAt, 'reclaim precedes the purge');
    });

    it('gna.js forwards the app.json orphanTimeout knob', function() {
        var gnaSrc = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
        assert.ok(gnaSrc.indexOf('orphanTimeout:  _jobsConf.orphanTimeout,') > -1);
    });
});
