/**
 * Connector-backed render-cache L2 (render-cache Slice 4) — Redis store.
 *
 * Behavioral coverage of core/connectors/redis/lib/render-cache-store.js against
 * the REAL store code driven by a fake promise-style ioredis driver (CI has no
 * redis; the driver is injected via the factory's test-only third arg — the
 * entity-layer `injected` DI precedent). The store is a pure opaque
 * string + per-key-TTL KV; lib/render-cache owns what the value means.
 *
 * Covers:
 *   - the seam round-trips: set (PSETEX with ttl / SET without), warmRead
 *     (GET+PTTL → { value, ttlMs }), del (existed count);
 *   - the TTL semantics warm() depends on: a live key returns its PTTL as
 *     ttlMs; a no-expiry key (SET) returns ttlMs:null; a miss returns null;
 *     the GET-then-PTTL expiry race (PTTL −2 after a non-null GET) → miss;
 *   - the prefix (default 'cache:', override, cluster no-hash-tag);
 *   - config resolution: standalone host/port/db/password/tls, cluster-mode
 *     construction, the B5 client options (enableOfflineQueue:false + a low
 *     maxRetriesPerRequest reach the driver), fail-open surfacing (a driver
 *     error rejects the seam promise rather than crashing);
 *   - source pins: single-key ops only (NO multi/sunion/mget), no hash-tag
 *     guard (a divergence from job-store), the 'error' listener, PSETEX for the
 *     TTL path.
 *
 * The fake throws on any command the store does not use, so the store reaching
 * for an unexpected redis command fails these tests by construction.
 *
 * Run: node --test test/lib/render-cache-store-redis.test.js
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW          = require('../fw');
var createStore = require(path.join(FW, 'core/connectors/redis/lib/render-cache-store'));

var STORE_SOURCE = path.join(FW, 'core/connectors/redis/lib/render-cache-store.js');
var STORE_SRC    = fs.readFileSync(STORE_SOURCE, 'utf8');


// ─── Fake promise-style ioredis ─────────────────────────────────────────────
/**
 * Implements exactly the commands the render-cache store emits — get / set /
 * psetex / pttl / del — plus .on / .quit / (constructor + Cluster). Promise
 * return (no callback path — the store never passes one). PTTL follows redis:
 *   -2 no key, -1 key with no expiry, >0 ms remaining (from the recorded ttl,
 *   no wall-clock decay so tests are deterministic).
 * Any other command throws → a store reaching for one fails loudly.
 */
function createFakeIoredis(sharedState) {
    var state = sharedState || {
        strings:      Object.create(null), // key -> string value
        pttls:        Object.create(null), // key -> ms (only for psetex'd keys)
        clientOpts:   [],
        clusterCalls: [],
        listeners:    [],
        quits:        0,
        failWith:     null                 // when set, every command rejects with it
    };

    function has(map, k) { return Object.prototype.hasOwnProperty.call(map, k); }

    function apply(cmd, args) {
        switch (cmd) {
            case 'set':
                state.strings[args[0]] = String(args[1]);
                delete state.pttls[args[0]];         // SET clears any TTL
                return 'OK';
            case 'psetex':
                state.strings[args[0]] = String(args[2]);
                state.pttls[args[0]]   = Number(args[1]);
                return 'OK';
            case 'get':
                return has(state.strings, args[0]) ? state.strings[args[0]] : null;
            case 'pttl':
                if (!has(state.strings, args[0])) return -2;
                return has(state.pttls, args[0]) ? state.pttls[args[0]] : -1;
            case 'del': {
                var existed = has(state.strings, args[0]);
                if (existed) { delete state.strings[args[0]]; delete state.pttls[args[0]]; }
                return existed ? 1 : 0;
            }
            default:
                throw new Error('fake ioredis: unsupported command `' + cmd + '`');
        }
    }

    var COMMANDS = ['get', 'set', 'psetex', 'pttl', 'del'];

    function decorate(client) {
        COMMANDS.forEach(function(cmd) {
            client[cmd] = function() {
                var args = Array.prototype.slice.call(arguments);
                if (state.failWith) return Promise.reject(state.failWith);
                var res, err = null;
                try { res = apply(cmd, args); } catch (e) { err = e; }
                return err ? Promise.reject(err) : Promise.resolve(res);
            };
        });
        client.on   = function(event) { state.listeners.push({ event: event }); return client; };
        client.quit = function() { state.quits++; return Promise.resolve('OK'); };
        return client;
    }

    function FakeRedis(opts) { state.clientOpts.push(opts || {}); decorate(this); }
    FakeRedis.Cluster = function(nodes, opts) { state.clusterCalls.push({ nodes: nodes, opts: opts || {} }); decorate(this); };

    return { driver: FakeRedis, state: state };
}

/** Real store over a fresh fake driver. */
function freshStore(connConf, fake) {
    fake = fake || createFakeIoredis();
    var store = createStore(connConf || {}, 'testbundle', { driver: fake.driver });
    return { store: store, fake: fake };
}


// ─── 01. Module + instance shape ────────────────────────────────────────────

describe('render-cache-store-redis § 01 — module + instance shape', function() {

    it('exports a factory taking (connConf, bundle, injected)', function() {
        assert.equal(typeof createStore, 'function');
        assert.equal(createStore.length, 3);
    });

    it('returns the seam: set / warmRead / del / close', function() {
        var s = freshStore().store;
        assert.equal(typeof s.set,      'function');
        assert.equal(typeof s.warmRead, 'function');
        assert.equal(typeof s.del,      'function');
        assert.equal(typeof s.close,    'function');
    });

    it('registers an `error` listener at construction (no-listener crash guard)', function() {
        var f = createFakeIoredis();
        freshStore({}, f);
        assert.ok(f.state.listeners.some(function(l) { return l.event === 'error'; }),
            'the store must attach an `error` listener');
    });
});


// ─── 02. set — PSETEX with ttl, SET without ─────────────────────────────────

describe('render-cache-store-redis § 02 — set()', function() {

    it('PSETEX with the ttl (ms) when ttlMs > 0', async function() {
        var f = createFakeIoredis();
        var s = freshStore({}, f).store;
        await s.set('static:b:/p', 'BODY', 60000);
        assert.equal(f.state.strings['cache:static:b:/p'], 'BODY', 'value stored under the prefixed key');
        assert.equal(f.state.pttls['cache:static:b:/p'], 60000, 'PSETEX recorded the ms TTL');
    });

    it('rounds a fractional ttlMs', async function() {
        var f = createFakeIoredis();
        var s = freshStore({}, f).store;
        await s.set('k', 'v', 1500.7);
        assert.equal(f.state.pttls['cache:k'], 1501);
    });

    it('floors a sub-millisecond ttl to 1 — never PSETEX 0 (redis rejects it)', async function() {
        var f = createFakeIoredis();
        var s = freshStore({}, f).store;
        await s.set('k', 'v', 0.4);        // Math.round(0.4) === 0 → floored to 1
        assert.equal(f.state.pttls['cache:k'], 1, 'a positive sub-ms ttl must PSETEX 1, not 0');
    });

    it('plain SET (no TTL) when ttlMs is falsy', async function() {
        var f = createFakeIoredis();
        var s = freshStore({}, f).store;
        await s.set('k', 'v', null);
        assert.equal(f.state.strings['cache:k'], 'v');
        assert.equal(Object.prototype.hasOwnProperty.call(f.state.pttls, 'cache:k'), false,
            'SET must not record a TTL');
    });

    it('rejects (surfaces the driver error) when the client fails — fail-open is the caller\'s job', async function() {
        var f = createFakeIoredis();
        f.state.failWith = new Error('CONN');
        var s = freshStore({}, f).store;
        await assert.rejects(function() { return s.set('k', 'v', 1000); }, /CONN/);
    });
});


// ─── 03. warmRead — GET + PTTL → { value, ttlMs } | null ─────────────────────

describe('render-cache-store-redis § 03 — warmRead()', function() {

    it('a live PSETEX key → { value, ttlMs } with the PTTL', async function() {
        var s = freshStore().store;
        await s.set('static:b:/p', 'HTML', 30000);
        var r = await s.warmRead('static:b:/p');
        assert.deepEqual(r, { value: 'HTML', ttlMs: 30000 });
    });

    it('a SET key (no expiry, PTTL −1) → ttlMs: null', async function() {
        var s = freshStore().store;
        await s.set('k', 'v', null);
        var r = await s.warmRead('k');
        assert.deepEqual(r, { value: 'v', ttlMs: null });
    });

    it('an absent key → null (GET null short-circuits before PTTL)', async function() {
        var s = freshStore().store;
        var r = await s.warmRead('missing');
        assert.equal(r, null);
    });

    // The GET→PTTL expiry race (a non-null GET then PTTL −2) is covered
    // deterministically in § 03b against a stub whose PTTL is set per-case.
});


// ─── 03b. warmRead — the PTTL branch matrix on a minimal stub ────────────────

describe('render-cache-store-redis § 03b — warmRead PTTL branch matrix (stub driver)', function() {

    // A stub whose GET/PTTL return values are set per-case, so every PTTL branch
    // (−2 / −1 / >0) is exercised deterministically against the REAL store code.
    function stubStore(getVal, pttlVal) {
        function Stub() {
            this.get  = function() { return Promise.resolve(getVal); };
            this.pttl = function() { return Promise.resolve(pttlVal); };
            this.set  = function() { return Promise.resolve('OK'); };
            this.del  = function() { return Promise.resolve(1); };
            this.on   = function() { return this; };
            this.quit = function() { return Promise.resolve('OK'); };
        }
        Stub.Cluster = function() {};
        return createStore({}, 'b', { driver: Stub });
    }

    it('GET non-null + PTTL > 0 → { value, ttlMs }', async function() {
        assert.deepEqual(await stubStore('X', 12345).warmRead('k'), { value: 'X', ttlMs: 12345 });
    });
    it('GET non-null + PTTL −1 (no expiry) → ttlMs null', async function() {
        assert.deepEqual(await stubStore('X', -1).warmRead('k'), { value: 'X', ttlMs: null });
    });
    it('GET non-null + PTTL −2 (vanished between reads) → null', async function() {
        assert.equal(await stubStore('X', -2).warmRead('k'), null);
    });
    it('GET non-null + PTTL 0 (≈expired) → null (never a non-expiring entry)', async function() {
        assert.equal(await stubStore('X', 0).warmRead('k'), null);
    });
    it('GET null → null (never reads PTTL)', async function() {
        var pttlCalled = false;
        function Stub() {
            this.get  = function() { return Promise.resolve(null); };
            this.pttl = function() { pttlCalled = true; return Promise.resolve(9999); };
            this.on   = function() { return this; };
        }
        Stub.Cluster = function() {};
        var r = await createStore({}, 'b', { driver: Stub }).warmRead('k');
        assert.equal(r, null);
        assert.equal(pttlCalled, false, 'a GET miss must short-circuit before PTTL');
    });
});


// ─── 04. del — existed count, fire-and-forget shape ─────────────────────────

describe('render-cache-store-redis § 04 — del()', function() {

    it('returns 1 when the key existed, 0 when it did not', async function() {
        var s = freshStore().store;
        await s.set('k', 'v', 1000);
        assert.equal(await s.del('k'), 1);
        assert.equal(await s.del('k'), 0);
    });

    it('removes both the string and its TTL record', async function() {
        var f = createFakeIoredis();
        var s = freshStore({}, f).store;
        await s.set('k', 'v', 1000);
        await s.del('k');
        assert.equal(Object.prototype.hasOwnProperty.call(f.state.strings, 'cache:k'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(f.state.pttls, 'cache:k'), false);
    });

    it('a rejected del is catchable by the fire-and-forget caller', async function() {
        var f = createFakeIoredis();
        f.state.failWith = new Error('DOWN');
        var s = freshStore({}, f).store;
        var caught = null;
        await s.del('k').catch(function(e) { caught = e; });
        assert.match(String(caught), /DOWN/);
    });
});


// ─── 05. Config resolution ───────────────────────────────────────────────────

describe('render-cache-store-redis § 05 — config resolution', function() {

    it('standalone: host / port / db + the B5 client options reach the driver', function() {
        var f = createFakeIoredis();
        freshStore({ host: '10.0.0.5', port: 6380, db: 3 }, f);
        var opts = f.state.clientOpts[0];
        assert.equal(opts.host, '10.0.0.5');
        assert.equal(opts.port, 6380);
        assert.equal(opts.db, 3);
        assert.equal(opts.enableOfflineQueue, false, 'B5: offline queue must be OFF (fail fast, do not hang)');
        assert.equal(opts.maxRetriesPerRequest, 1, 'B5: a low per-request retry cap');
    });

    it('standalone defaults: 127.0.0.1:6379 db 0', function() {
        var f = createFakeIoredis();
        freshStore({}, f);
        var opts = f.state.clientOpts[0];
        assert.equal(opts.host, '127.0.0.1');
        assert.equal(opts.port, 6379);
        assert.equal(opts.db, 0);
    });

    it('password + tls thread through (standalone)', function() {
        var f = createFakeIoredis();
        freshStore({ password: 'sekret', tls: true }, f);
        var opts = f.state.clientOpts[0];
        assert.equal(opts.password, 'sekret');
        assert.deepEqual(opts.tls, {});
    });

    it('maxRetriesPerRequest is overridable', function() {
        var f = createFakeIoredis();
        freshStore({ maxRetriesPerRequest: 0 }, f);
        assert.equal(f.state.clientOpts[0].maxRetriesPerRequest, 0);
    });

    it('cluster mode: enableOfflineQueue OFF at the TOP LEVEL (B5), maxRetries per-node — NO hash-tag requirement', function() {
        var f = createFakeIoredis();
        var nodes = [{ host: '127.0.0.1', port: 7000 }, { host: '127.0.0.1', port: 7001 }];
        // A plain (un-hash-tagged) prefix must be ACCEPTED — all ops are single-key.
        assert.doesNotThrow(function() {
            freshStore({ cluster: nodes, prefix: 'cache:' }, f);
        });
        var call = f.state.clusterCalls[0];
        assert.deepEqual(call.nodes, nodes);
        // B5: ioredis Omits enableOfflineQueue from redisOptions — the cluster-ready
        // gate is the TOP-LEVEL ClusterOptions field. It MUST be false there, or a
        // command during a cluster outage/failover queues and hangs the hot path.
        assert.equal(call.opts.enableOfflineQueue, false, 'cluster-level enableOfflineQueue must be false (B5)');
        // maxRetriesPerRequest is a per-node RedisOptions field.
        assert.equal(call.opts.redisOptions.maxRetriesPerRequest, 1);
        // And it must NOT be (uselessly) set inside redisOptions where ioredis ignores it.
        assert.equal(Object.prototype.hasOwnProperty.call(call.opts.redisOptions, 'enableOfflineQueue'), false,
            'do not set enableOfflineQueue in redisOptions — ioredis strips it there');
    });

    it('prefix: default cache:, and an override is honoured', async function() {
        var fd = createFakeIoredis();
        var sd = freshStore({}, fd).store;
        await sd.set('k', 'v', 1000);
        assert.ok(Object.prototype.hasOwnProperty.call(fd.state.strings, 'cache:k'), 'default prefix cache:');

        var fo = createFakeIoredis();
        var so = freshStore({ prefix: 'r:' }, fo).store;
        await so.set('k', 'v', 1000);
        assert.ok(Object.prototype.hasOwnProperty.call(fo.state.strings, 'r:k'), 'override prefix honoured');
    });

    it('close() quits the client', function() {
        var f = createFakeIoredis();
        var s = freshStore({}, f).store;
        s.close();
        assert.equal(f.state.quits, 1);
    });
});


// ─── 06. Source pins — the deliberate divergences from the job store ─────────

describe('render-cache-store-redis § 06 — source pins', function() {

    it('uses PSETEX for the TTL write path', function() {
        assert.match(STORE_SRC, /\.psetex\(/, 'the ttl write must be PSETEX');
    });

    it('single-key ops only — NO cross-key MULTI / SUNION / MGET (the cluster-safe divergence)', function() {
        assert.doesNotMatch(STORE_SRC, /\.multi\(/,   'no MULTI — every op is single-key');
        assert.doesNotMatch(STORE_SRC, /\.sunion\(/,  'no SUNION');
        assert.doesNotMatch(STORE_SRC, /\.mget\(/,    'no MGET');
        assert.doesNotMatch(STORE_SRC, /\.zadd\(|\.zrangebyscore\(/, 'no sorted-set indexes');
    });

    it('does NOT impose a hash-tag guard (unlike the job store) — the only throw is the driver-missing one', function() {
        // Code-level, prose-immune: the job store has TWO `throw new Error`
        // (driver-missing + the cluster hash-tag guard); this store has exactly
        // ONE (driver-missing), so a cluster prefix is never rejected. Pinning
        // the throw count sidesteps the own-JSDoc trap (the divergence comment
        // legitimately names CROSSSLOT / hash-tag).
        var throwCount = (STORE_SRC.match(/throw new Error/g) || []).length;
        assert.equal(throwCount, 1, 'the store must throw only for a missing driver, never for a cluster prefix');
        // And it must never test the prefix for a hash tag (the job-store guard's
        // detection regex `/\{.+\}/.test(prefix)`).
        assert.doesNotMatch(STORE_SRC, /\.test\(\s*prefix\s*\)/, 'no hash-tag detection on the prefix');
    });

    it('sets enableOfflineQueue:false + maxRetriesPerRequest (B5)', function() {
        assert.match(STORE_SRC, /enableOfflineQueue\s*:\s*false/);
        assert.match(STORE_SRC, /maxRetriesPerRequest/);
    });

    it('registers a client `error` listener (B4)', function() {
        assert.match(STORE_SRC, /client\.on\(\s*'error'/);
    });

    it('resolves the driver bare-require-first then project node_modules', function() {
        var bareIdx    = STORE_SRC.indexOf("require('ioredis')");
        var projectIdx = STORE_SRC.indexOf("/node_modules/ioredis");
        assert.ok(bareIdx > -1 && projectIdx > -1 && bareIdx < projectIdx,
            'bare require must precede the project-node_modules fallback');
    });
});


// ─── 07. Sync-throw guard — a driver throwing synchronously must REJECT ──────

describe('render-cache-store-redis § 07 — synchronous driver throw becomes a rejection (B6)', function() {

    // A driver whose command methods throw SYNCHRONOUSLY (a wedged client / bad
    // arg). Each seam method must return a REJECTED promise, never let the throw
    // escape — the fire-and-forget `del` caller can only `.catch` a rejection.
    function boomStore() {
        function Boom() {
            this.set    = function() { throw new Error('SYNC'); };
            this.psetex = function() { throw new Error('SYNC'); };
            this.get    = function() { throw new Error('SYNC'); };
            this.pttl   = function() { throw new Error('SYNC'); };
            this.del    = function() { throw new Error('SYNC'); };
            this.on     = function() { return this; };
            this.quit   = function() { return Promise.resolve('OK'); };
        }
        Boom.Cluster = function() {};
        return createStore({}, 'b', { driver: Boom });
    }

    it('set() returns a rejected promise, never a sync throw', async function() {
        var s = boomStore();
        var p;
        assert.doesNotThrow(function() { p = s.set('k', 'v', 1000); }, 'set must not throw synchronously');
        assert.ok(p && typeof p.then === 'function');
        await assert.rejects(p, /SYNC/);
    });

    it('warmRead() returns a rejected promise, never a sync throw', async function() {
        var s = boomStore();
        var p;
        assert.doesNotThrow(function() { p = s.warmRead('k'); });
        await assert.rejects(p, /SYNC/);
    });

    it('del() returns a rejected promise the fire-and-forget caller can .catch', async function() {
        var s = boomStore();
        var p;
        assert.doesNotThrow(function() { p = s.del('k'); });
        var caught = null;
        await p.catch(function(e) { caught = e; });
        assert.match(String(caught), /SYNC/);
    });
});
