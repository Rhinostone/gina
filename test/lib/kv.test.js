/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * lib/kv — general-purpose KV primitive (#KV1, slice 0)
 *
 * Tests cover the runtime primitive in isolation:
 *   - validateConfig — off / malformed / per-namespace rules / default checks
 *   - start / get / list / isStarted / reset — the strict three-refusal get()
 *   - the 13-op handle over the in-memory backend, TTL via mocked timers
 *   - value model — undefined/null/circular refused, JSON round-trip
 *   - consume-once and setnx semantics (the one-shot-token pair)
 *   - counters — create-with-ttl, non-integer refusal, overflow refusal
 *   - delIfEquals (compare-and-delete), clear, expire/ttl
 *   - getOrSet — hit / miss+store / single-flight / loader failure clears flight
 *   - failMode — closed rejects, open degrades to miss shapes (stub store)
 *
 * Plus framework-wiring pins on lib/index.js (plain require + _require'd
 * dispatcher) and gna.js (unconditional accessor + boot start).
 *
 * TTL tests mock BOTH the interval APIs and Date (node:test mock.timers), so
 * no test waits on wall-clock and the unref'd sweep can be driven
 * deterministically. Async-race replicas settle on the promises themselves,
 * never on a sleep — the structural-settle rule.
 */

var { describe, it, beforeEach, afterEach, mock } = require('node:test');
var assert   = require('node:assert/strict');
var fs       = require('node:fs');
var nodePath = require('node:path');

var ROOT    = nodePath.join(__dirname, '..', '..');
var VERSION = require(nodePath.join(ROOT, 'package.json')).version;
var FW_DIR  = nodePath.join(ROOT, 'framework', 'v' + VERSION);
var kv      = require(nodePath.join(FW_DIR, 'lib', 'kv', 'src', 'main.js'));

/**
 * Build a started single-namespace fixture and return its handle.
 *
 * @inner
 * @param {object} [nsConf] - Namespace conf for the `t` namespace.
 * @param {object} [block]  - Whole kv block override.
 * @returns {object} The `t` namespace handle.
 */
var startOne = function (nsConf, block) {
    kv.reset();
    var cfg = block || { default: 't', namespaces: { t: (nsConf || {}) } };
    assert.equal(kv.validateConfig(cfg).fatal, null);
    assert.equal(kv.start(cfg), true);
    return kv.get('t');
};

afterEach(function () {
    kv.reset();
});

describe('01 - validateConfig', function () {

    it('absent block is feature-off, not an error', function () {
        var v = kv.validateConfig(undefined);
        assert.equal(v.fatal, null);
        assert.deepEqual(v.warnings, []);
        assert.equal(v.namespaceCount, 0);
        assert.equal(kv.validateConfig(null).fatal, null);
    });

    it('non-object block is fatal', function () {
        assert.match(kv.validateConfig('nope').fatal, /must be an object/);
        assert.match(kv.validateConfig([1]).fatal, /must be an object/);
    });

    it('unknown block-level key warns, naming it', function () {
        var v = kv.validateConfig({ namespaces: { a: {} }, defualt: 'a' });
        assert.equal(v.fatal, null);
        assert.equal(v.warnings.length, 1);
        assert.match(v.warnings[0], /`kv\.defualt` is not a recognised option/);
    });

    it('declared but no namespaces warns', function () {
        var v = kv.validateConfig({});
        assert.equal(v.fatal, null);
        assert.match(v.warnings[0], /has no `namespaces`/);
    });

    it('non-object namespaces is fatal', function () {
        assert.match(kv.validateConfig({ namespaces: ['a'] }).fatal, /keyed by namespace name/);
    });

    it('invalid namespace name is fatal', function () {
        assert.match(kv.validateConfig({ namespaces: { '9bad': {} } }).fatal, /invalid/);
        assert.match(kv.validateConfig({ namespaces: { 'sp ace': {} } }).fatal, /invalid/);
    });

    it('non-object namespace conf is fatal, naming the {} escape', function () {
        assert.match(kv.validateConfig({ namespaces: { a: null } }).fatal, /use \{\} for a plain in-memory namespace/);
    });

    it('unknown namespace key warns, naming it', function () {
        var v = kv.validateConfig({ namespaces: { a: { failmode: 'open' } } });
        assert.equal(v.fatal, null);
        assert.match(v.warnings[0], /`kv\.namespaces\.a\.failmode` is not a recognised option/);
    });

    it('empty store, bad failMode, bad sweepInterval are each fatal', function () {
        assert.match(kv.validateConfig({ namespaces: { a: { store: '' } } }).fatal, /store/);
        assert.match(kv.validateConfig({ namespaces: { a: { failMode: 'o' } } }).fatal, /failMode/);
        assert.match(kv.validateConfig({ namespaces: { a: { sweepInterval: 0 } } }).fatal, /sweepInterval/);
        assert.match(kv.validateConfig({ namespaces: { a: { sweepInterval: 1.5 } } }).fatal, /sweepInterval/);
    });

    it('default must name a declared namespace', function () {
        assert.match(kv.validateConfig({ default: '', namespaces: { a: {} } }).fatal, /non-empty/);
        assert.match(kv.validateConfig({ default: 'b', namespaces: { a: {} } }).fatal, /not a declared namespace/);
        var v = kv.validateConfig({ default: 'a', namespaces: { a: {}, b: { failMode: 'open' } } });
        assert.equal(v.fatal, null);
        assert.equal(v.namespaceCount, 2);
    });
});

describe('02 - start / get / list / isStarted / reset (the strict accessor)', function () {

    it('get before start throws the not-configured refusal', function () {
        kv.reset();
        assert.throws(function () { kv.get('t'); }, /not configured/);
        assert.equal(kv.isStarted(), false);
        assert.deepEqual(kv.list(), []);
    });

    it('get on an unknown name throws, listing what IS configured', function () {
        startOne();
        assert.throws(function () { kv.get('typo'); }, /no namespace `typo` \(configured: t\)/);
    });

    it('no-arg get without a default throws, listing the options', function () {
        kv.reset();
        kv.start({ namespaces: { a: {}, b: {} } });
        assert.throws(function () { kv.get(); }, /no `kv\.default` is declared[\s\S]*a, b/);
    });

    it('no-arg get resolves the default namespace', function () {
        var t = startOne();
        assert.equal(kv.get(), t);
        assert.equal(t.name, 't');
    });

    it('double start warns and is ignored', function () {
        var warned = [];
        kv.reset();
        kv.start({ namespaces: { a: {} } }, { warn: function (m) { warned.push(m); } });
        assert.equal(kv.start({ namespaces: { b: {} } }), false);
        assert.equal(warned.length, 1);
        assert.match(warned[0], /already installed/);
        assert.deepEqual(kv.list(), ['a']);
    });

    it('reset tears down and get refuses again', function () {
        startOne();
        kv.reset();
        assert.throws(function () { kv.get('t'); }, /not configured/);
    });
});

describe('03 - the value model (JSON strings end to end)', function () {

    it('round-trips an object value', async function () {
        var t = startOne();
        assert.equal(await t.set('k', { a: 1, b: ['x'] }), true);
        assert.deepEqual(await t.get('k'), { a: 1, b: ['x'] });
    });

    it('miss is null', async function () {
        var t = startOne();
        assert.equal(await t.get('absent'), null);
    });

    it('undefined and null values are refused on every write op', async function () {
        var t = startOne();
        await assert.rejects(t.set('k', undefined), /undefined/);
        await assert.rejects(t.set('k', null), /indistinguishable from a miss/);
        await assert.rejects(t.setnx('k', null), /indistinguishable from a miss/);
        await assert.rejects(t.delIfEquals('k', undefined), /undefined/);
    });

    it('non-serializable values are refused', async function () {
        var t = startOne();
        var circ = {}; circ.self = circ;
        await assert.rejects(t.set('k', circ), /not JSON-serializable/);
        await assert.rejects(t.set('k', function () {}), /not JSON-serializable/);
    });

    it('keys must be non-empty strings within the length cap', async function () {
        var t = startOne();
        await assert.rejects(t.get(42), TypeError);
        await assert.rejects(t.get(''), /non-empty/);
        await assert.rejects(t.get(new Array(514).join('ab')), /limit/);
    });
});

describe('04 - TTL semantics (mocked timers + Date)', function () {

    beforeEach(function () {
        mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    });
    afterEach(function () {
        mock.timers.reset();
    });

    it('ttl: 0 and negative/float TTLs are refused, never read as no-expiry', async function () {
        var t = startOne();
        await assert.rejects(t.set('k', 1, { ttl: 0 }), /positive integer/);
        await assert.rejects(t.set('k', 1, { ttl: -5 }), /positive integer/);
        await assert.rejects(t.set('k', 1, { ttl: 1.5 }), /positive integer/);
        await assert.rejects(t.expire('k', 0), /positive integer/);
    });

    it('a set with ttl expires lazily on read', async function () {
        var t = startOne();
        await t.set('k', 'v', { ttl: 1000 });
        assert.equal(await t.get('k'), 'v');
        mock.timers.tick(999);
        assert.equal(await t.get('k'), 'v');
        mock.timers.tick(2);
        assert.equal(await t.get('k'), null);
    });

    it('ttl() reads null on miss, -1 for no expiry, remaining ms otherwise', async function () {
        var t = startOne();
        assert.equal(await t.ttl('absent'), null);
        await t.set('forever', 1);
        assert.equal(await t.ttl('forever'), -1);
        await t.set('k', 1, { ttl: 5000 });
        mock.timers.tick(2000);
        assert.equal(await t.ttl('k'), 3000);
    });

    it('expire() slides the expiry of a live key and misses on absent', async function () {
        var t = startOne();
        await t.set('k', 1, { ttl: 1000 });
        mock.timers.tick(900);
        assert.equal(await t.expire('k', 5000), true);
        mock.timers.tick(4900);
        assert.equal(await t.get('k'), 1);
        mock.timers.tick(200);
        assert.equal(await t.get('k'), null);
        assert.equal(await t.expire('gone', 1000), false);
    });

    it('the interval sweep purges expired entries without a read', async function () {
        var t = startOne({ sweepInterval: 500 });
        await t.set('k', 1, { ttl: 100 });
        mock.timers.tick(600); // past the entry ttl AND one sweep cadence
        // measure via clear(): it counts REMAINING map entries, so a swept
        // store reports 0 — a lazily-expired-only store would report 1
        assert.equal(await t.clear(), 0);
    });

    it('setnx loses to a live key and wins after expiry', async function () {
        var t = startOne();
        assert.equal(await t.setnx('k', 'first', { ttl: 1000 }), true);
        assert.equal(await t.setnx('k', 'second'), false);
        assert.equal(await t.get('k'), 'first');
        mock.timers.tick(1001);
        assert.equal(await t.setnx('k', 'third'), true);
        assert.equal(await t.get('k'), 'third');
    });

    it('incr applies ttl on CREATE only and keeps it on increment', async function () {
        var t = startOne();
        assert.equal(await t.incr('c', 1, { ttl: 1000 }), 1);
        mock.timers.tick(600);
        assert.equal(await t.incr('c'), 2); // ttl NOT renewed
        mock.timers.tick(500);              // 1100ms since create
        assert.equal(await t.get('c'), null);
    });
});

describe('05 - the one-shot pair, counters, compare-and-delete, clear', function () {

    it('consume returns the value once; the second consumer gets null', async function () {
        var t = startOne();
        await t.set('token', { uid: 7 });
        assert.deepEqual(await t.consume('token'), { uid: 7 });
        assert.equal(await t.consume('token'), null);
        assert.equal(await t.get('token'), null);
    });

    it('del reports whether a live entry existed', async function () {
        var t = startOne();
        await t.set('k', 1);
        assert.equal(await t.del('k'), true);
        assert.equal(await t.del('k'), false);
    });

    it('has answers liveness', async function () {
        var t = startOne();
        assert.equal(await t.has('k'), false);
        await t.set('k', 0);
        assert.equal(await t.has('k'), true);
    });

    it('incr/decr from absent, with explicit by', async function () {
        var t = startOne();
        assert.equal(await t.incr('c'), 1);
        assert.equal(await t.incr('c', 5), 6);
        assert.equal(await t.decr('c', 2), 4);
        assert.equal(await t.decr('d'), -1);
    });

    it('incr on a non-integer value and non-integer by are refused', async function () {
        var t = startOne();
        await t.set('s', 'text');
        await assert.rejects(t.incr('s'), /not an integer/);
        await assert.rejects(t.incr('c', 1.5), /safe integer/);
        await assert.rejects(t.decr('c', 'x'), /safe integer/);
    });

    it('incr refuses to leave the safe-integer range', async function () {
        var t = startOne();
        await t.set('c', Number.MAX_SAFE_INTEGER);
        await assert.rejects(t.incr('c'), /safe-integer range/);
    });

    it('delIfEquals deletes only on a strict serialized match', async function () {
        var t = startOne();
        await t.set('lock', { owner: 'a' });
        assert.equal(await t.delIfEquals('lock', { owner: 'b' }), false);
        assert.equal(await t.has('lock'), true);
        assert.equal(await t.delIfEquals('lock', { owner: 'a' }), true);
        assert.equal(await t.has('lock'), false);
        assert.equal(await t.delIfEquals('lock', { owner: 'a' }), false);
    });

    it('clear empties the namespace and reports the count', async function () {
        var t = startOne();
        await t.set('a', 1); await t.set('b', 2);
        assert.equal(await t.clear(), 2);
        assert.equal(await t.get('a'), null);
        assert.equal(await t.clear(), 0);
    });
});

describe('06 - getOrSet (fetch-or-compute, single-flight)', function () {

    it('miss runs the loader once, stores, and later calls hit', async function () {
        var t = startOne();
        var calls = 0;
        var load = function () { calls++; return { fresh: true }; };
        assert.deepEqual(await t.getOrSet('k', load), { fresh: true });
        assert.deepEqual(await t.getOrSet('k', load), { fresh: true });
        assert.equal(calls, 1);
    });

    it('concurrent misses share one in-flight load (settled structurally, no sleeps)', async function () {
        var t = startOne();
        var calls = 0;
        var release;
        var gate = new Promise(function (resolve) { release = resolve; });
        var load = function () { calls++; return gate.then(function () { return 'built'; }); };
        var p1 = t.getOrSet('k', load);
        var p2 = t.getOrSet('k', load);
        release();
        assert.equal(await p1, 'built');
        assert.equal(await p2, 'built');
        assert.equal(calls, 1, 'both callers must share the single in-flight load');
        assert.equal(await t.get('k'), 'built');
    });

    it('a loader returning undefined rejects and caches nothing', async function () {
        var t = startOne();
        await assert.rejects(t.getOrSet('k', function () {}), /returned `undefined`/);
        assert.equal(await t.get('k'), null);
    });

    it('a throwing loader rejects every sharer, clears the flight, and a retry re-runs it', async function () {
        var t = startOne();
        var calls = 0;
        var failing = function () { calls++; throw new Error('boom'); };
        await assert.rejects(t.getOrSet('k', failing), /boom/);
        assert.equal(await t.get('k'), null, 'no negative caching');
        assert.deepEqual(await t.getOrSet('k', function () { calls++; return 'ok'; }), 'ok');
        assert.equal(calls, 2, 'the failed flight must not pin the key');
    });

    it('honours ttl through the (key, opts, loader) form', async function () {
        mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
        try {
            var t = startOne();
            await t.getOrSet('k', { ttl: 1000 }, function () { return 'v'; });
            mock.timers.tick(1001);
            assert.equal(await t.get('k'), null);
        } finally {
            mock.timers.reset();
        }
    });

    it('a non-function loader is refused', async function () {
        var t = startOne();
        await assert.rejects(t.getOrSet('k', {}, 'not a fn'), /loader function/);
    });
});

describe('07 - failMode (closed rejects, open degrades) via the _createNamespace seam', function () {

    /**
     * A backend whose every op rejects — the connector-outage stand-in.
     * @inner
     * @returns {object} A KvStoreContract whose promises all reject.
     */
    var brokenStore = function () {
        var reject = function () { return Promise.reject(new Error('backend down')); };
        return { get: reject, set: reject, del: reject, has: reject, pttl: reject,
                 pexpire: reject, setnx: reject, consume: reject, incrby: reject,
                 compareDel: reject, clear: reject, close: function () {} };
    };

    it('closed (default): backend errors reject the call', async function () {
        var ns = kv._createNamespace('t', brokenStore(), {}, function () {});
        await assert.rejects(ns.get('k'), /backend down/);
        await assert.rejects(ns.set('k', 1), /backend down/);
        await assert.rejects(ns.incr('k'), /backend down/);
    });

    it('open: every op degrades to its miss shape and warns', async function () {
        var warned = [];
        var ns = kv._createNamespace('t', brokenStore(), { failMode: 'open' }, function (m) { warned.push(m); });
        assert.equal(await ns.get('k'), null);
        assert.equal(await ns.set('k', 1), false);
        assert.equal(await ns.del('k'), false);
        assert.equal(await ns.has('k'), false);
        assert.equal(await ns.ttl('k'), null);
        assert.equal(await ns.expire('k', 10), false);
        assert.equal(await ns.setnx('k', 1), false);
        assert.equal(await ns.consume('k'), null);
        assert.equal(await ns.incr('k'), null);
        assert.equal(await ns.clear(), 0);
        assert.ok(warned.length >= 10, 'each degrade must warn — got ' + warned.length);
        assert.match(warned[0], /degraded \(failMode=open\)/);
    });

    it('open never swallows VALIDATION errors', async function () {
        var ns = kv._createNamespace('t', brokenStore(), { failMode: 'open' }, function () {});
        await assert.rejects(ns.set('k', undefined), /undefined/);
        await assert.rejects(ns.set(42, 1), TypeError);
    });

    it('a corrupt stored value is a data error: closed rejects naming the key, open reads as miss', async function () {
        var stub = function (payload) {
            var s = brokenStore();
            s.get = function () { return Promise.resolve(payload); };
            return s;
        };
        var closed = kv._createNamespace('t', stub('{not json'), {}, function () {});
        await assert.rejects(closed.get('k'), /key `k`: stored value is not valid JSON/);
        var warned = [];
        var open = kv._createNamespace('t', stub('{not json'), { failMode: 'open' }, function (m) { warned.push(m); });
        assert.equal(await open.get('k'), null);
        assert.equal(warned.length, 1);
    });
});

describe('08 - framework wiring pins', function () {

    var LIB_INDEX_SRC = fs.readFileSync(nodePath.join(FW_DIR, 'lib', 'index.js'), 'utf8');
    var GNA_SRC       = fs.readFileSync(nodePath.join(FW_DIR, 'core', 'gna.js'), 'utf8');

    it('lib/index.js plain-requires kv (singleton — must survive refreshCore)', function () {
        assert.match(LIB_INDEX_SRC, /kv\s+:\s+require\('\.\/kv'\)/);
    });

    it('lib/index.js _requires the KvStore dispatcher (stateless factory)', function () {
        assert.match(LIB_INDEX_SRC, /KvStore\s+:\s+_require\('\.\/kv-store'\)/);
    });

    it('gna.js assigns the accessor unconditionally and delegates to lib.kv.get', function () {
        assert.match(GNA_SRC, /gna\.kv = function\(name\) \{\n    return lib\.kv\.get\(name\);\n\};/);
    });

    it('gna.js boots kv through validateConfig + start with injected stores and warn sink', function () {
        assert.match(GNA_SRC, /lib\.kv\.validateConfig\(_kvSettings\)/);
        assert.match(GNA_SRC, /lib\.kv\.start\(_kvSettings, \{ stores: _kvStores, warn: /);
        assert.match(GNA_SRC, /lib\.KvStore\(_kvNamespaces\[_kvN\]\.store, _kvN\)/);
    });
});
