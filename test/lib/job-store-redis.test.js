/**
 * Connector-backed JobStore (#AI6 follow-up) — Redis store.
 *
 * Covers:
 *   - core/connectors/redis/lib/job-store.js — behavioral, against the REAL
 *     store code driven by a fake callback-style ioredis driver (CI has no
 *     redis; the driver is injected via the factory's test-only third arg,
 *     the entity-layer `injected` DI precedent). Seam round-trips,
 *     memory-store parity (no expiry filter on get/list), the sweep predicate
 *     matrix (null-expiresAt / non-terminal records never enter the expiry
 *     index), the index-consistency invariant across state transitions
 *     (exactly one state-SET membership; expiry-index membership only for
 *     terminal records with a numeric expiresAt), and the durability analog
 *     (two store instances over the same fake backend).
 *   - lib/job end-to-end through the real Redis store on a genuinely
 *     async driver (also exercises the create-race hardening).
 *   - Config resolution: standalone host/port/db/password/tls, cluster-mode
 *     construction (nodes + redisOptions), prefix defaults ('jobs:'
 *     standalone / '{jobs}:' cluster), the untagged-cluster-prefix fail-fast,
 *     and the deliberate ignoring of the session store's `ttl` key.
 *   - Source pins: bare-require-then-project-node_modules driver resolution,
 *     no per-key TTL command file-wide (expiry acts ONLY at the seam's
 *     sweep), single expiry-index range read (sweep only), MULTI-atomic
 *     writes, STATES imported from lib/job.
 *
 * The fake driver throws on any command the emulator does not implement, so
 * the store reaching for an unexpected redis command (e.g. a TTL-setting or
 * SCAN command) fails these tests by construction.
 *
 * Run: node --test test/lib/job-store-redis.test.js
 */

'use strict';

var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW          = require('../fw');
var createStore = require(path.join(FW, 'core/connectors/redis/lib/job-store'));
var job         = require(path.join(FW, 'lib/job/src/main'));

var STORE_SOURCE = path.join(FW, 'core/connectors/redis/lib/job-store.js');


// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a record matching create()'s initial 13-key shape. */
function makeRecord(id, patch) {
    var now = Date.now();
    var rec = {
        id:          id,
        state:       'pending',
        result:      null,
        error:       null,
        attempts:    0,
        maxAttempts: 1,
        callbackUrl: null,
        meta:        null,
        createdAt:   now,
        updatedAt:   now,
        startedAt:   null,
        finishedAt:  null,
        expiresAt:   null
    };
    if (patch) {
        for (var k in patch) rec[k] = patch[k];
    }
    return rec;
}

function storeSet(store, rec) {
    return new Promise(function(res, rej) {
        store.set(rec.id, rec, function(err, r) { err ? rej(err) : res(r); });
    });
}
function storeGet(store, id) {
    return new Promise(function(res, rej) {
        store.get(id, function(err, rec) { err ? rej(err) : res(rec); });
    });
}
function storeList(store, filter) {
    return new Promise(function(res, rej) {
        store.list(filter || null, function(err, recs) { err ? rej(err) : res(recs); });
    });
}
function storeSweep(store, now) {
    return new Promise(function(res, rej) {
        store.sweep(now, function(err, n) { err ? rej(err) : res(n); });
    });
}

function tick(ms) {
    return new Promise(function(r) { setTimeout(r, ms || 5); });
}

function getJob(id) {
    return new Promise(function(res) { job.get(id, function(e, rec) { res(rec); }); });
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

/**
 * A fake callback-style ioredis driver. Pass a previous fake's `state` to
 * model a SHARED redis (two clients over the same keyspace — the durability
 * analog). Implements exactly the commands the store emits — get / mget /
 * set / del / sadd / srem / smembers / sunion / zadd / zrem / zrangebyscore /
 * multi().exec — with ioredis's array-flattening, genuinely-async callbacks
 * (nextTick), and atomic multi application. Any other command THROWS, so a
 * store reaching for an unimplemented redis feature fails loudly.
 */
function createFakeIoredis(sharedState) {
    var state = sharedState || {
        strings:        Object.create(null), // key -> string
        sets:           Object.create(null), // key -> { member: true }
        zsets:          Object.create(null), // key -> { member: score }
        clientOpts:     [],
        clusterCalls:   [],
        listeners:      [],                  // { event } records from .on()
        quits:          0,
        failWith:       null,                // when set, every op errors with it
        perCommandFail: null                 // { <cmd>: Error } — fails that command only
    };

    function has(map, k) { return Object.prototype.hasOwnProperty.call(map, k); }
    function ensure(map, k) { if (!has(map, k)) map[k] = Object.create(null); return map[k]; }

    function apply(cmd, args) {
        if (state.perCommandFail && state.perCommandFail[cmd]) {
            throw state.perCommandFail[cmd];
        }
        switch (cmd) {
            case 'set':
                state.strings[args[0]] = String(args[1]);
                return 'OK';
            case 'get':
                return has(state.strings, args[0]) ? state.strings[args[0]] : null;
            case 'mget':
                return args.map(function(k) { return has(state.strings, k) ? state.strings[k] : null; });
            case 'del': {
                var existed = has(state.strings, args[0]);
                if (existed) delete state.strings[args[0]];
                return existed ? 1 : 0;
            }
            case 'sadd': {
                var s = ensure(state.sets, args[0]);
                var added = !has(s, args[1]);
                s[args[1]] = true;
                return added ? 1 : 0;
            }
            case 'srem': {
                if (!has(state.sets, args[0])) return 0;
                var hadIt = has(state.sets[args[0]], args[1]);
                if (hadIt) delete state.sets[args[0]][args[1]];
                return hadIt ? 1 : 0;
            }
            case 'smembers':
                return has(state.sets, args[0]) ? Object.keys(state.sets[args[0]]) : [];
            case 'sunion': {
                var union = Object.create(null);
                for (var i = 0; i < args.length; i++) {
                    if (!has(state.sets, args[i])) continue;
                    for (var m in state.sets[args[i]]) union[m] = true;
                }
                return Object.keys(union);
            }
            case 'zadd': {
                var z = ensure(state.zsets, args[0]);
                var isNew = !has(z, args[2]);
                z[args[2]] = Number(args[1]);
                return isNew ? 1 : 0;
            }
            case 'zrem': {
                if (!has(state.zsets, args[0])) return 0;
                var hadZ = has(state.zsets[args[0]], args[1]);
                if (hadZ) delete state.zsets[args[0]][args[1]];
                return hadZ ? 1 : 0;
            }
            case 'zrangebyscore': {
                if (!has(state.zsets, args[0])) return [];
                var min = (args[1] === '-inf') ? -Infinity : Number(args[1]);
                var max = (args[2] === '+inf') ? Infinity  : Number(args[2]);
                var z2  = state.zsets[args[0]];
                var out = [];
                for (var mem in z2) {
                    if (z2[mem] >= min && z2[mem] <= max) out.push(mem);
                }
                out.sort(function(a, b) { return z2[a] - z2[b]; });
                return out;
            }
            default:
                throw new Error('fake ioredis: unsupported command `' + cmd + '`');
        }
    }

    function flatten(args) {
        var flat = [];
        for (var i = 0; i < args.length; i++) {
            if (Array.isArray(args[i])) flat = flat.concat(args[i]);
            else flat.push(args[i]);
        }
        return flat;
    }

    function makeCommand(target, cmd) {
        target[cmd] = function() {
            var args = Array.prototype.slice.call(arguments);
            var cb   = (typeof args[args.length - 1] === 'function') ? args.pop() : null;
            var flat = flatten(args);
            if (state.failWith) {
                if (cb) return process.nextTick(cb, state.failWith);
                return Promise.reject(state.failWith);
            }
            var res, err = null;
            try { res = apply(cmd, flat); } catch (e) { err = e; }
            if (cb) return process.nextTick(cb, err, err ? undefined : res);
            return err ? Promise.reject(err) : Promise.resolve(res);
        };
    }

    var COMMANDS = ['get', 'mget', 'set', 'del', 'sadd', 'srem', 'smembers', 'sunion', 'zadd', 'zrem', 'zrangebyscore'];

    function decorateClient(client) {
        for (var i = 0; i < COMMANDS.length; i++) makeCommand(client, COMMANDS[i]);
        client.on = function(event) { state.listeners.push({ event: event }); return client; };
        client.quit = function() { state.quits++; return Promise.resolve('OK'); };
        client.multi = function() {
            var queued = [];
            var m = {};
            COMMANDS.forEach(function(cmd) {
                m[cmd] = function() {
                    queued.push([cmd, flatten(Array.prototype.slice.call(arguments))]);
                    return m;
                };
            });
            m.exec = function(cb) {
                if (state.failWith) return process.nextTick(cb, state.failWith, null);
                // Applied synchronously in one pass — atomic, like a real MULTI.
                var results = queued.map(function(entry) {
                    try { return [null, apply(entry[0], entry[1])]; }
                    catch (e) { return [e, null]; }
                });
                process.nextTick(cb, null, results);
            };
            return m;
        };
        return client;
    }

    function FakeRedis(opts) {
        state.clientOpts.push(opts || {});
        decorateClient(this);
    }
    FakeRedis.Cluster = function(nodes, opts) {
        state.clusterCalls.push({ nodes: nodes, opts: opts || {} });
        decorateClient(this);
    };

    return { driver: FakeRedis, state: state };
}

/** Shorthand: real store over a fresh fake driver. */
function freshStore(connConf, fake) {
    fake = fake || createFakeIoredis();
    var store = createStore(connConf || {}, 'testbundle', { driver: fake.driver });
    return { store: store, fake: fake };
}


// ─── 01. Module + instance shape ────────────────────────────────────────────

describe('job-store-redis § 01 — module + instance shape', function() {

    it('exports a factory function taking (connConf, bundle, injected)', function() {
        assert.equal(typeof createStore, 'function');
        // 3rd arg is the test-only driver injection (dispatcher calls with 2).
        assert.equal(createStore.length, 3);
    });

    it('builds an instance with the five seam methods + close()', function() {
        var s = freshStore();
        ['set', 'get', 'remove', 'list', 'sweep', 'close'].forEach(function(m) {
            assert.equal(typeof s.store[m], 'function', m + ' must be a function');
        });
        s.store.close();
    });

    it('registers an error listener on the client (an unhandled error event would crash the process)', function() {
        var s = freshStore();
        var errorListeners = s.fake.state.listeners.filter(function(l) { return l.event === 'error'; });
        assert.ok(errorListeners.length >= 1);
        s.store.close();
    });
});


// ─── 02. set/get round-trip + key layout ────────────────────────────────────

describe('job-store-redis § 02 — set/get round-trip + key layout', function() {

    it('round-trips the full initial record shape byte-faithfully', async function() {
        var s   = freshStore();
        var rec = makeRecord('jobRt1', { meta: { source: 'unit' } });
        var setRes = await storeSet(s.store, rec);
        assert.deepEqual(setRes, rec);
        var got = await storeGet(s.store, 'jobRt1');
        assert.deepEqual(got, rec);
        s.store.close();
    });

    it('stores the record as a JSON string under <prefix><id> with state-SET membership mirrored', async function() {
        var s   = freshStore();
        var rec = makeRecord('jobDoc1', { state: 'completed', expiresAt: 12345 });
        await storeSet(s.store, rec);
        var raw = s.fake.state.strings['jobs:jobDoc1'];
        assert.equal(typeof raw, 'string', 'record must ride as a JSON string');
        assert.deepEqual(JSON.parse(raw), rec);
        assert.ok(s.fake.state.sets['jobs:idx:state:completed']['jobDoc1'], 'id must be in its state SET');
        assert.equal(s.fake.state.zsets['jobs:idx:expires']['jobDoc1'], 12345, 'terminal+numeric expiresAt must be in the expiry index');
        s.store.close();
    });

    it('returns null (not an error) for an unknown id', async function() {
        var s   = freshStore();
        var got = await storeGet(s.store, 'nope');
        assert.equal(got, null);
        s.store.close();
    });

    it('tolerates records gaining keys after creation (webhook fields)', async function() {
        var s   = freshStore();
        var rec = makeRecord('jobGrow1');
        await storeSet(s.store, rec);
        rec.state              = 'completed';
        rec.webhookDeliveredAt = Date.now();
        await storeSet(s.store, rec);
        var got = await storeGet(s.store, 'jobGrow1');
        assert.equal(got.state, 'completed');
        assert.equal(typeof got.webhookDeliveredAt, 'number');
        s.store.close();
    });

    it('reports a non-serialisable record through the callback, never throws', function(t, done) {
        var s   = freshStore();
        var rec = makeRecord('jobCirc1');
        rec.result = {};
        rec.result.self = rec.result; // circular — JSON.stringify must fail
        s.store.set(rec.id, rec, function(err) {
            assert.ok(err instanceof Error);
            s.store.close();
            done();
        });
    });

    it('surfaces a driver error through the callback (get and set)', function(t, done) {
        var s = freshStore();
        s.fake.state.failWith = new Error('Connection is closed.');
        s.store.get('any', function(getErr) {
            assert.ok(getErr instanceof Error);
            assert.match(getErr.message, /Connection is closed/);
            s.store.set('any', makeRecord('any'), function(setErr) {
                assert.ok(setErr instanceof Error);
                s.fake.state.failWith = null;
                s.store.close();
                done();
            });
        });
    });

    it('surfaces a per-command error from inside the MULTI (firstExecError)', function(t, done) {
        var s = freshStore();
        s.fake.state.perCommandFail = { sadd: new Error('SADD boom') };
        s.store.set('jobPcf1', makeRecord('jobPcf1'), function(err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /SADD boom/);
            s.fake.state.perCommandFail = null;
            s.store.close();
            done();
        });
    });

    it('reports a malformed stored record as an error (never silent)', function(t, done) {
        var s = freshStore();
        s.fake.state.strings['jobs:jobBad'] = '{not valid';
        s.store.get('jobBad', function(err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /could not parse/);
            s.store.close();
            done();
        });
    });
});


// ─── 03. Memory-store parity — expiry acts ONLY at sweep ────────────────────

describe('job-store-redis § 03 — no expiry filter on get/list (memory parity)', function() {

    it('a terminal record past expiresAt stays readable until swept', async function() {
        var s    = freshStore();
        var past = Date.now() - 60000;
        var rec  = makeRecord('jobExp1', { state: 'completed', finishedAt: past, expiresAt: past });
        await storeSet(s.store, rec);
        var got = await storeGet(s.store, 'jobExp1');
        assert.ok(got, 'expired-but-unswept record must still be readable (memory-store parity)');
        assert.equal(got.state, 'completed');
        var listed = await storeList(s.store, { state: 'completed' });
        assert.equal(listed.length, 1);
        await storeSweep(s.store, Date.now());
        assert.equal(await storeGet(s.store, 'jobExp1'), null);
        s.store.close();
    });
});


// ─── 04. remove ─────────────────────────────────────────────────────────────

describe('job-store-redis § 04 — remove + index cleanup', function() {

    it('reports existed=true then existed=false', function(t, done) {
        var s = freshStore();
        s.store.set('jobRm1', makeRecord('jobRm1'), function() {
            s.store.remove('jobRm1', function(e1, existed1) {
                assert.equal(e1, null);
                assert.equal(existed1, true);
                s.store.remove('jobRm1', function(e2, existed2) {
                    assert.equal(e2, null);
                    assert.equal(existed2, false);
                    s.store.close();
                    done();
                });
            });
        });
    });

    it('cleans the state-SET and expiry-index entries with the record', async function() {
        var s   = freshStore();
        var rec = makeRecord('jobRm2', { state: 'completed', expiresAt: Date.now() + 60000 });
        await storeSet(s.store, rec);
        assert.ok(s.fake.state.sets['jobs:idx:state:completed']['jobRm2']);
        assert.ok('jobRm2' in s.fake.state.zsets['jobs:idx:expires']);
        await new Promise(function(res, rej) {
            s.store.remove('jobRm2', function(err) { err ? rej(err) : res(); });
        });
        assert.ok(!s.fake.state.sets['jobs:idx:state:completed']['jobRm2'], 'state SET must be cleaned');
        assert.ok(!('jobRm2' in s.fake.state.zsets['jobs:idx:expires']), 'expiry index must be cleaned');
        s.store.close();
    });
});


// ─── 05. list ───────────────────────────────────────────────────────────────

describe('job-store-redis § 05 — list', function() {

    it('lists all records with a null filter (SUNION across state SETs) and filters by state', async function() {
        var s = freshStore();
        await storeSet(s.store, makeRecord('l1', { state: 'pending' }));
        await storeSet(s.store, makeRecord('l2', { state: 'completed' }));
        await storeSet(s.store, makeRecord('l3', { state: 'completed' }));
        assert.equal((await storeList(s.store, null)).length, 3);
        assert.equal((await storeList(s.store, { state: 'completed' })).length, 2);
        assert.equal((await storeList(s.store, { state: 'failed' })).length, 0);
        s.store.close();
    });

    it('skips an index id whose record key is gone (removed between the index read and the MGET)', async function() {
        var s = freshStore();
        await storeSet(s.store, makeRecord('lDrift1', { state: 'pending' }));
        // Model the race: the id is still in the state SET, the record key is gone.
        delete s.fake.state.strings['jobs:lDrift1'];
        var listed = await storeList(s.store, { state: 'pending' });
        assert.deepEqual(listed, [], 'a vanished record is skipped, not an error');
        s.store.close();
    });
});


// ─── 06. sweep predicate matrix ─────────────────────────────────────────────

describe('job-store-redis § 06 — sweep predicate (terminal AND expired only)', function() {

    it('removes exactly the expired terminal records', async function() {
        var s      = freshStore();
        var past   = Date.now() - 60000;
        var future = Date.now() + 60000;
        await storeSet(s.store, makeRecord('swPendExp', { state: 'pending',   expiresAt: past }));
        await storeSet(s.store, makeRecord('swRun',     { state: 'running' }));
        await storeSet(s.store, makeRecord('swDoneLive',{ state: 'completed', expiresAt: future }));
        await storeSet(s.store, makeRecord('swDoneExp', { state: 'completed', expiresAt: past }));
        await storeSet(s.store, makeRecord('swFailExp', { state: 'failed',    expiresAt: past }));

        var removed = await storeSweep(s.store, Date.now());
        assert.equal(removed, 2, 'only completed-expired + failed-expired are sweepable');

        assert.ok(await storeGet(s.store, 'swPendExp'),  'pending is never swept, expired or not');
        assert.ok(await storeGet(s.store, 'swRun'),      'running is never swept');
        assert.ok(await storeGet(s.store, 'swDoneLive'), 'unexpired terminal survives');
        assert.equal(await storeGet(s.store, 'swDoneExp'), null);
        assert.equal(await storeGet(s.store, 'swFailExp'), null);
        s.store.close();
    });

    it('a terminal record with a null expiresAt is never swept (it never enters the expiry index)', async function() {
        var s = freshStore();
        await storeSet(s.store, makeRecord('swNullExp', { state: 'completed', expiresAt: null }));
        assert.ok(!(s.fake.state.zsets['jobs:idx:expires'] && ('swNullExp' in s.fake.state.zsets['jobs:idx:expires'])));
        var removed = await storeSweep(s.store, Date.now());
        assert.equal(removed, 0, 'a null expiresAt must never be sweepable');
        assert.ok(await storeGet(s.store, 'swNullExp'));
        s.store.close();
    });

    it('cleans the swept ids out of the state SETs and the expiry index', async function() {
        var s    = freshStore();
        var past = Date.now() - 60000;
        await storeSet(s.store, makeRecord('swClean1', { state: 'failed', expiresAt: past }));
        await storeSweep(s.store, Date.now());
        assert.ok(!s.fake.state.sets['jobs:idx:state:failed']['swClean1'], 'state SET must be cleaned by sweep');
        assert.ok(!('swClean1' in s.fake.state.zsets['jobs:idx:expires']), 'expiry index must be cleaned by sweep');
        assert.deepEqual(await storeList(s.store, null), [], 'swept record must not be listable');
        s.store.close();
    });
});


// ─── 07. Durability analog — records live server-side, not in the instance ──

describe('job-store-redis § 07 — records survive across store instances (shared backend)', function() {

    it('a record written by one store instance is intact in a new instance over the same backend', async function() {
        var fake = createFakeIoredis();
        var s1   = createStore({}, 'testbundle', { driver: fake.driver });
        var rec  = makeRecord('jobDur1', { state: 'completed', result: { answer: 42 } });
        await storeSet(s1, rec);
        s1.close();

        // Same fake state = same redis; a fresh client/store sees the record.
        var s2  = createStore({}, 'testbundle', { driver: createFakeIoredis(fake.state).driver });
        var got = await storeGet(s2, 'jobDur1');
        assert.deepEqual(got, rec);
        var listed = await storeList(s2, { state: 'completed' });
        assert.equal(listed.length, 1, 'the state index is shared server-side too');
        s2.close();
    });
});


// ─── 08. Integration through lib/job with the real Redis store ──────────────

describe('job-store-redis § 08 — lib/job end-to-end on the Redis store', function() {

    beforeEach(function() {
        job.reset();
    });

    it('create → completed lands the result in the redis-backed record (async store)', async function() {
        var s = freshStore();
        job.start({ store: s.store, sweepInterval: 0 });
        var id  = job.create(function() { return Promise.resolve('ok-result'); });
        var rec = await waitForState(id, 'completed', 2000);
        assert.equal(rec.result, 'ok-result');
        assert.equal(typeof rec.finishedAt, 'number');
        assert.equal(typeof rec.expiresAt, 'number');
        // Straight from the store, bypassing lib/job — proves where it lives.
        var raw = await storeGet(s.store, id);
        assert.equal(raw.state, 'completed');
        assert.equal(raw.result, 'ok-result');
        job.reset();
        s.store.close();
    });

    it('a failing job lands a serialised (JSON-round-trippable) error', async function() {
        var s = freshStore();
        job.start({ store: s.store, sweepInterval: 0 });
        var id  = job.create(function() { throw new Error('boom'); });
        var rec = await waitForState(id, 'failed', 2000);
        assert.ok(!(rec.error instanceof Error), 'error must be the serialised shape, not a raw Error');
        assert.equal(rec.error.message, 'boom');
        assert.doesNotThrow(function() { JSON.stringify(rec); });
        job.reset();
        s.store.close();
    });

    it('lib.job.sweep() purges the expired terminal record through the store', async function() {
        var s = freshStore();
        job.start({ store: s.store, sweepInterval: 0, ttl: 1 });
        var id = job.create(function() { return Promise.resolve('done'); });
        await waitForState(id, 'completed', 2000);
        // Force the record past its TTL, then sweep through the primitive.
        var rec = await storeGet(s.store, id);
        rec.expiresAt = Date.now() - 1;
        await storeSet(s.store, rec);
        var removed = await new Promise(function(res, rej) {
            job.sweep(function(err, n) { err ? rej(err) : res(n); });
        });
        assert.equal(removed, 1);
        assert.equal(await storeGet(s.store, id), null);
        job.reset();
        s.store.close();
    });
});


// ─── 09. Config resolution — the redis connector's own conventions ──────────

describe('job-store-redis § 09 — config resolution', function() {

    it('defaults host/port/db to 127.0.0.1:6379 db 0 (standalone)', function() {
        var s = freshStore();
        assert.deepEqual(s.fake.state.clientOpts[0], { host: '127.0.0.1', port: 6379, db: 0 });
        s.store.close();
    });

    it('honours host/port/db/password and maps tls (session-store shape)', function() {
        var s = freshStore({ host: 'redis.example', port: 6380, db: 3, password: 'pw', tls: true });
        var opts = s.fake.state.clientOpts[0];
        assert.equal(opts.host, 'redis.example');
        assert.equal(opts.port, 6380);
        assert.equal(opts.db, 3);
        assert.equal(opts.password, 'pw');
        assert.deepEqual(opts.tls, {});
        s.store.close();
    });

    it('cluster mode constructs Redis.Cluster with the nodes + redisOptions (password/tls)', function() {
        var fake  = createFakeIoredis();
        var nodes = [{ host: 'n1', port: 6379 }, { host: 'n2', port: 6379 }];
        var s = createStore({ cluster: nodes, password: 'pw', tls: true }, 'testbundle', { driver: fake.driver });
        assert.equal(fake.state.clusterCalls.length, 1);
        assert.deepEqual(fake.state.clusterCalls[0].nodes, nodes);
        assert.equal(fake.state.clusterCalls[0].opts.redisOptions.password, 'pw');
        assert.deepEqual(fake.state.clusterCalls[0].opts.redisOptions.tls, {});
        assert.equal(fake.state.clientOpts.length, 0, 'standalone constructor must not be used in cluster mode');
        s.close();
    });

    it('defaults the prefix to jobs: (standalone) — record + index keys all under it', async function() {
        var s = freshStore();
        await storeSet(s.store, makeRecord('p1'));
        assert.ok('jobs:p1' in s.fake.state.strings);
        assert.ok('jobs:idx:state:pending' in s.fake.state.sets);
        s.store.close();
    });

    it('honours a custom prefix', async function() {
        var s = freshStore({ prefix: 'myapp:jobs:' });
        await storeSet(s.store, makeRecord('p2'));
        assert.ok('myapp:jobs:p2' in s.fake.state.strings);
        assert.ok('myapp:jobs:idx:state:pending' in s.fake.state.sets);
        s.store.close();
    });

    it('defaults the prefix to {jobs}: in cluster mode (hash tag — one slot for MULTI/SUNION/MGET)', async function() {
        var fake = createFakeIoredis();
        var s = createStore({ cluster: [{ host: 'n1', port: 6379 }] }, 'testbundle', { driver: fake.driver });
        await storeSet(s, makeRecord('p3'));
        assert.ok('{jobs}:p3' in fake.state.strings);
        assert.ok('{jobs}:idx:state:pending' in fake.state.sets);
        s.close();
    });

    it('accepts a custom CLUSTER prefix only when it carries a {hash-tag}', function() {
        var fakeOk = createFakeIoredis();
        var ok = createStore(
            { cluster: [{ host: 'n1', port: 6379 }], prefix: '{myapp-jobs}:' },
            'testbundle', { driver: fakeOk.driver }
        );
        ok.close();

        assert.throws(function() {
            createStore(
                { cluster: [{ host: 'n1', port: 6379 }], prefix: 'myapp:jobs:' },
                'testbundle', { driver: createFakeIoredis().driver }
            );
        }, /hash-tagged/);
    });

    it('a standalone untagged prefix is fine (the hash-tag rule is cluster-only)', async function() {
        var s = freshStore({ prefix: 'plain:' });
        await storeSet(s.store, makeRecord('p4'));
        assert.ok('plain:p4' in s.fake.state.strings);
        s.store.close();
    });

    it('ignores the session store\'s ttl key — keys are written with no per-key TTL', async function() {
        // The fake driver throws on ANY command outside the store's documented
        // set — so a TTL-setting command would fail this test by construction.
        var s = freshStore({ ttl: 60 });
        await storeSet(s.store, makeRecord('pTtl1', { state: 'completed', expiresAt: Date.now() + 5000 }));
        assert.ok('jobs:pTtl1' in s.fake.state.strings, 'record persists as a plain key');
        var got = await storeGet(s.store, 'pTtl1');
        assert.equal(got.id, 'pTtl1');
        s.store.close();
    });

    it('close() releases the client via quit (seam-external convenience)', async function() {
        var s = freshStore();
        s.store.close();
        await tick(5);
        assert.equal(s.fake.state.quits, 1);
    });
});


// ─── 10. Index-consistency invariant across state transitions ───────────────

describe('job-store-redis § 10 — index consistency across the job lifecycle', function() {

    function stateSetsContaining(fakeState, id) {
        var out = [];
        for (var key in fakeState.sets) {
            if (key.indexOf('jobs:idx:state:') === 0 && fakeState.sets[key][id]) {
                out.push(key.replace('jobs:idx:state:', ''));
            }
        }
        return out;
    }

    it('an id lives in exactly ONE state SET at every transition; expiry index only when terminal', async function() {
        var s   = freshStore();
        var rec = makeRecord('jobLife1');

        await storeSet(s.store, rec); // pending
        assert.deepEqual(stateSetsContaining(s.fake.state, 'jobLife1'), ['pending']);
        assert.ok(!(s.fake.state.zsets['jobs:idx:expires'] && ('jobLife1' in s.fake.state.zsets['jobs:idx:expires'])));

        rec.state     = 'running';
        rec.startedAt = Date.now();
        rec.attempts  = 1;
        await storeSet(s.store, rec);
        assert.deepEqual(stateSetsContaining(s.fake.state, 'jobLife1'), ['running']);
        assert.ok(!('jobLife1' in (s.fake.state.zsets['jobs:idx:expires'] || {})));

        rec.state      = 'completed';
        rec.result     = 'r';
        rec.finishedAt = Date.now();
        rec.expiresAt  = rec.finishedAt + 3600000;
        await storeSet(s.store, rec);
        assert.deepEqual(stateSetsContaining(s.fake.state, 'jobLife1'), ['completed']);
        assert.equal(s.fake.state.zsets['jobs:idx:expires']['jobLife1'], rec.expiresAt);

        // A post-terminal webhook-field update keeps the indexes stable.
        rec.webhookDeliveredAt = Date.now();
        await storeSet(s.store, rec);
        assert.deepEqual(stateSetsContaining(s.fake.state, 'jobLife1'), ['completed']);
        assert.equal(s.fake.state.zsets['jobs:idx:expires']['jobLife1'], rec.expiresAt);

        s.store.close();
    });
});


// ─── 11. Source pins — redis store contract-critical shapes ─────────────────

describe('job-store-redis § 11 — redis store source pins', function() {

    var SRC = fs.readFileSync(STORE_SOURCE, 'utf8');

    it('resolves the driver bare-first (session-store parity), then from the project node_modules (job-store precedent)', function() {
        var bareIdx = SRC.indexOf("Redis = require('ioredis')");
        var projIdx = SRC.indexOf('node_modules/ioredis');
        assert.ok(bareIdx > -1, 'bare require must exist');
        assert.ok(projIdx > -1, 'project-path fallback must exist');
        assert.ok(bareIdx < projIdx, 'bare require must be attempted before the project fallback');
        assert.ok(SRC.indexOf("getPath('project')") > -1);
    });

    it('throws an actionable error when the driver is missing', function() {
        assert.match(SRC, /ioredis is not installed/);
        assert.match(SRC, /npm install ioredis/);
    });

    it('supports the test-only injected driver (entity-layer DI precedent)', function() {
        assert.match(SRC, /injected && injected\.driver/);
    });

    it('never sets a per-key TTL (redis-side eviction would purge outside the seam\'s sweep)', function() {
        assert.doesNotMatch(SRC, /\bsetex\b|\bpsetex\b|\bpexpire\b|\bexpireat\b/i);
        assert.doesNotMatch(SRC, /\.expire\(/);
    });

    it('reads the expiry index with a range scan in sweep ONLY (get/list carry no expiry filter)', function() {
        assert.equal((SRC.match(/zrangebyscore/g) || []).length, 1);
    });

    it('writes atomically — one MULTI each for set, remove, and sweep', function() {
        assert.equal((SRC.match(/client\.multi\(\)/g) || []).length, 3);
    });

    it('fails fast on an untagged cluster prefix (CROSSSLOT prevention)', function() {
        assert.match(SRC, /cluster mode requires a hash-tagged/);
    });

    it('registers a client error listener', function() {
        assert.match(SRC, /client\.on\('error'/);
    });

    it('owns no timer — the primitive drives the sweep cadence', function() {
        assert.ok(SRC.indexOf('setInterval') < 0);
    });

    it('imports STATES from lib/job so the sweep predicate cannot drift', function() {
        assert.match(SRC, /require\('\.\.\/\.\.\/\.\.\/\.\.\/lib\/job\/src\/main'\)\.STATES/);
    });

    it('derives the per-state index keys from STATES (a new state cannot be silently missed)', function() {
        assert.match(SRC, /Object\.keys\(STATES\)\.map/);
    });
});
