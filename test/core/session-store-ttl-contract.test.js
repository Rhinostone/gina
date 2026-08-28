'use strict';
/**
 * #B207 — session-store ttl contract: refuse a non-positive configured ttl at
 * construction; a RESOLVED ttl <= 0 at set() is a no-op.
 *
 * Contract under test:
 *  (a) Constructors REFUSE `ttl: 0` (or any non-positive value) on BOTH config
 *      channels — store options and the connectors.json session entry — with an
 *      error naming the offending channel. `ttl: 0` previously collapsed to the
 *      maxAge fallback through double truthiness (constructor preserve, then
 *      `this.ttl ||` at every use site), silently meaning "unset" in every
 *      store. The couchbase stores validate the options channel only (they
 *      never read connectors.json — pinned by the schema description).
 *  (b) set() no-ops (`fn(null)` invoked synchronously, ZERO backend calls, no
 *      lastModified stamp) when the RESOLVED ttl is <= 0 — reachable because
 *      express-session's `cookie.maxAge` is a decaying remainder that truncates
 *      to 0 in a session's final second and goes negative once expired.
 *      Pre-#B207 the stores split into two camps: redis wrote a plain SET
 *      (immortal key), couchbase upserted a zero expiry (a document that never
 *      expires), scylladb wrote `USING TTL 0` (never expires) — while mongodb
 *      and sqlite wrote an immediately-dead record. The guard unifies all five
 *      families on the #B166 touch() semantics: no write, the existing record
 *      dies on its original schedule.
 *  (c) The couchbase touch() carries the same guard — it was the one family
 *      missing the #B166 parity (it upserted whatever the resolved ttl was).
 *
 * Strategy: the six stores cannot be require()d standalone (they read framework
 * globals + drivers at factory-call time), so the validation statements are
 * EXTRACTED from the shipped source and executed as real bytes, and the
 * set()/touch() bodies are brace-matched out and driven with capturing
 * fixtures — no drift-prone replica. Every extraction is control-gated.
 * Callbacks are captured SYNCHRONOUSLY on the guard arms (the guard invokes
 * them in-line), so a regression to never-calling-back FAILS instead of
 * hanging the suite; promise-settled positive arms use a bounded setImmediate
 * tick, never a bare test-callback wait.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');
var SETTLE_ONCE = require(path.join(FW, 'core/connectors/settle-once.js')); // #B432 — the guard the extracted store bytes now call

var STORES = {
    redis    : { file: path.join(FW, 'core/connectors/redis/lib/session-store.js'),    setDecl: 'RedisStore.prototype.set = ' },
    sqlite   : { file: path.join(FW, 'core/connectors/sqlite/lib/session-store.js'),   setDecl: 'SqliteStore.prototype.set = ' },
    mongodb  : { file: path.join(FW, 'core/connectors/mongodb/lib/session-store.js'),  setDecl: 'MongodbStore.prototype.set = ' },
    scylladb : { file: path.join(FW, 'core/connectors/scylladb/lib/session-store.js'), setDecl: 'ScylladbStore.prototype.set = ' }
};
var COUCHBASE = {
    'couchbase v3' : { file: path.join(FW, 'core/connectors/couchbase/lib/session-store.v3.js'), setDecl: 'CouchbaseStore.prototype.set = ', touchDecl: 'CouchbaseStore.prototype.touch = ' },
    'couchbase v4' : { file: path.join(FW, 'core/connectors/couchbase/lib/session-store.v4.js'), setDecl: 'CouchbaseStore.prototype.set = ', touchDecl: 'CouchbaseStore.prototype.touch = ' }
};

var ONE_DAY = 86400;
var noop    = function () {};

/**
 * Drop full-line comments so extraction regexes and negative pins can never
 * anchor on a commented-out line or a JSDoc mention.
 *
 * @param   {string} src
 * @returns {string}
 * @inner
 */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * Extract the #B207 constructor validation blocks and return an evaluator
 * running those exact bytes. The four connectors.json-driven stores carry two
 * blocks (options + connConf channels); the couchbase stores carry one.
 *
 * @param   {string} src - full store source
 * @returns {{count: number, fn: (function|null)}} evaluator `(options, connConf, bundle)` — throws per the contract
 * @inner
 */
function makeCtorGuard(src) {
    var matches = stripComments(src).match(/if \((options|connConf)\.ttl != null && !\(\1\.ttl > 0\)\) \{[^{}]*\}/g);
    if (!matches) {
        return { count: 0, fn: null };
    }
    return {
        count: matches.length,
        fn: new Function('options', 'connConf', 'bundle', matches.join('\n'))
    };
}

/**
 * Brace-match a prototype method's function expression out of the shipped
 * source. Starts the walk AT the declaration with a started-flag (the decl
 * form does not carry the opening brace), and control-gates uniqueness and
 * balance.
 *
 * @param   {string} src        - full store source
 * @param   {string} declPrefix - e.g. `'RedisStore.prototype.set = '`
 * @returns {{count: number, balanced: boolean, fnSrc: (string|null)}}
 * @inner
 */
function extractMethod(src, declPrefix) {
    var active = stripComments(src);
    var i      = active.indexOf(declPrefix);

    if (i < 0) {
        return { count: 0, balanced: false, fnSrc: null };
    }
    // control — a second declaration would make the slice ambiguous
    if (active.indexOf(declPrefix, i + 1) !== -1) {
        return { count: 2, balanced: false, fnSrc: null };
    }

    var exprStart = i + declPrefix.length; // 'function(…' or 'async function(…'
    var depth = 0, started = false, end = -1;
    for (var p = exprStart; p < active.length; p++) {
        var c = active.charAt(p);
        if (c === '{') { depth++; started = true; }
        else if (c === '}') {
            depth--;
            if (started && depth === 0) { end = p; break; }
        }
    }
    if (end < 0) {
        return { count: 1, balanced: false, fnSrc: null };
    }
    return { count: 1, balanced: true, fnSrc: active.slice(exprStart, end + 1) };
}

/**
 * Compile an extracted function expression with the module-scope bindings the
 * bodies use (`oneDay`, `debug`). Real bytes — no replica.
 *
 * @param   {string} fnSrc
 * @returns {function}
 * @inner
 */
function compile(fnSrc) {
    // #B432 — the extracted bytes wrap `fn` through the shared guard; inject it.
    return new Function('oneDay', 'debug', 'settleOnce', 'return (' + fnSrc + ');')(ONE_DAY, noop, SETTLE_ONCE);
}

/**
 * A bounded macrotask tick for promise-settled positive arms.
 *
 * @returns {Promise<void>}
 * @inner
 */
function tick() {
    return new Promise(function (resolve) { setImmediate(resolve); });
}

var SRC = {};
before(function () {
    Object.keys(STORES).forEach(function (name) {
        SRC[name] = fs.readFileSync(STORES[name].file, 'utf8');
    });
    Object.keys(COUCHBASE).forEach(function (name) {
        SRC[name] = fs.readFileSync(COUCHBASE[name].file, 'utf8');
    });
});


// ─── 01 — extraction controls (an instrument that cannot fail is not one) ────

describe('01 - #B207 extraction controls', function () {

    Object.keys(STORES).forEach(function (name) {
        it(name + ': ctor validation extracted exactly twice (options + connConf channels)', function () {
            assert.equal(makeCtorGuard(SRC[name]).count, 2);
        });
        it(name + ': set() body brace-matched exactly once, balanced', function () {
            var m = extractMethod(SRC[name], STORES[name].setDecl);
            assert.equal(m.count, 1);
            assert.equal(m.balanced, true);
        });
    });

    Object.keys(COUCHBASE).forEach(function (name) {
        it(name + ': ctor validation extracted exactly once (options channel only)', function () {
            assert.equal(makeCtorGuard(SRC[name]).count, 1);
        });
        it(name + ': set() and touch() bodies brace-matched exactly once each, balanced', function () {
            var s = extractMethod(SRC[name], COUCHBASE[name].setDecl);
            var t = extractMethod(SRC[name], COUCHBASE[name].touchDecl);
            assert.equal(s.count, 1); assert.equal(s.balanced, true);
            assert.equal(t.count, 1); assert.equal(t.balanced, true);
        });
    });

    it('known-negative: the guard extractor does not fire on unrelated source', function () {
        assert.equal(makeCtorGuard('var x = 1;\nif (options.ttl != null) { x = options.ttl; }\n').count, 0);
    });
});


// ─── 02 — constructor refusal (the real validation bytes, driven) ────────────

describe('02 - #B207 constructor refuses a non-positive configured ttl', function () {

    Object.keys(STORES).forEach(function (name) {

        it(name + ': options.ttl 0 refuses, naming the store-options channel', function () {
            var g = makeCtorGuard(SRC[name]);
            assert.equal(g.count, 2, 'guard extraction control');
            assert.throws(function () { g.fn({ ttl: 0 }, {}, 'testBundle'); }, /store options/);
        });

        it(name + ': connectors.json ttl 0 refuses, naming the connectors.json channel', function () {
            var g = makeCtorGuard(SRC[name]);
            assert.throws(function () { g.fn({}, { ttl: 0 }, 'testBundle'); }, /connectors\.json/);
        });

        it(name + ': a connectors.json 0 refuses even when options would win the assignment', function () {
            var g = makeCtorGuard(SRC[name]);
            assert.throws(function () { g.fn({ ttl: 3600 }, { ttl: 0 }, 'testBundle'); }, /connectors\.json/);
        });

        it(name + ': negative and non-numeric values refuse; positive and unset pass', function () {
            var g = makeCtorGuard(SRC[name]);
            assert.throws(function () { g.fn({ ttl: -5 }, {}, 'testBundle'); }, /positive number of seconds/);
            assert.throws(function () { g.fn({ ttl: 'abc' }, {}, 'testBundle'); }, /positive number of seconds/);
            g.fn({}, {}, 'testBundle');                    // unset — no throw
            g.fn({ ttl: 3600 }, { ttl: 600 }, 'testBundle'); // positive — no throw
        });
    });

    Object.keys(COUCHBASE).forEach(function (name) {
        it(name + ': options.ttl 0 refuses; positive and unset pass', function () {
            var g = makeCtorGuard(SRC[name]);
            assert.equal(g.count, 1, 'guard extraction control');
            assert.throws(function () { g.fn({ ttl: 0 }, {}, 'testBundle'); }, /store options/);
            assert.throws(function () { g.fn({ ttl: -1 }, {}, 'testBundle'); }, /positive number of seconds/);
            g.fn({}, {}, 'testBundle');
            g.fn({ ttl: 300 }, {}, 'testBundle');
        });
    });
});


// ─── 03 — set() guard: resolved ttl <= 0 is a no-op (real bodies, fixtures) ──

describe('03 - #B207 set() no-ops when the resolved ttl is <= 0', function () {

    /**
     * Drive one store's extracted set() with a decayed (500 ms) and an expired
     * (-3000 ms) maxAge, asserting the synchronous no-op contract; then the
     * positive 1 h control.
     *
     * @param {string}   name       - store label
     * @param {string}   declPrefix - set() declaration prefix
     * @param {function} mkFixture  - `(calls) -> this` fixture builder
     * @param {boolean}  settleTick - positive arm settles via a macrotask tick
     * @param {function} assertPositive - `(calls) -> void` backend-call assertions
     * @inner
     */
    function guardArms(name, declPrefix, mkFixture, settleTick, assertPositive) {

        [500, -3000].forEach(function (maxAge) {
            it(name + ': maxAge ' + maxAge + 'ms -> fn(null) sync, zero backend calls, no stamp', async function () {
                var m = extractMethod(SRC[name], declPrefix);
                assert.equal(m.count, 1, 'extraction control');
                var calls = [];
                var sess  = { cookie: { maxAge: maxAge } };
                var doneArgs = null;
                var out = compile(m.fnSrc).call(mkFixture(calls), 'sid', sess, function (err) { doneArgs = [err]; });
                assert.ok(doneArgs, 'the set() callback was never invoked');
                assert.equal(doneArgs[0], null);
                assert.equal(calls.length, 0, 'backend must not be called: ' + JSON.stringify(calls));
                assert.ok(!('lastModified' in sess), 'no stamp on the guard path');
                if (out && typeof out.then === 'function') { await out; }
            });
        });

        it(name + ': positive control — 1h maxAge reaches the backend with ttl 3600', async function () {
            var m = extractMethod(SRC[name], declPrefix);
            var calls = [];
            var sess  = { cookie: { maxAge: 3600000 } };
            var doneArgs = null;
            var out = compile(m.fnSrc).call(mkFixture(calls), 'sid', sess, function (err) { doneArgs = [err]; });
            if (out && typeof out.then === 'function') { await out; }
            if (settleTick) { await tick(); }
            assert.ok(doneArgs, 'the set() callback was never invoked');
            // loose-null: sqlite's own success path calls `fn()` with no args
            assert.ok(doneArgs[0] == null, 'no error expected, got: ' + doneArgs[0]);
            assert.equal(calls.length, 1, 'exactly one backend write expected');
            assert.equal(typeof sess.lastModified, 'string', 'stamp expected on the write path');
            assertPositive(calls);
        });
    }

    guardArms('redis', STORES.redis.setDecl, function (calls) {
        return { prefix: 'p:', ttl: null, client: {
            setex : function (k, t, d, cb) { calls.push(['setex', k, t]); cb(null); },
            set   : function (k, d, cb)    { calls.push(['set', k]);      cb(null); }
        } };
    }, false, function (calls) {
        assert.deepEqual(calls[0], ['setex', 'p:sid', 3600]);
    });

    guardArms('sqlite', STORES.sqlite.setDecl, function (calls) {
        return { prefix: 'p:', ttl: null, _stmtUpsert: {
            run: function (k, d, expires) { calls.push(['run', k, expires]); }
        } };
    }, false, function (calls) {
        assert.equal(calls[0][1], 'p:sid');
        assert.ok(calls[0][2] > Math.floor(Date.now() / 1000) + 3590, 'expires ~ now + 3600s');
    });

    guardArms('mongodb', STORES.mongodb.setDecl, function (calls) {
        return { ttl: null,
            _ensureTTL: function (cb) { cb(null); },
            _coll: { replaceOne: function (q, doc, opts) { calls.push(['replaceOne', doc]); return Promise.resolve({}); } }
        };
    }, true, function (calls) {
        var doc = calls[0][1];
        assert.ok(doc.expiresAt instanceof Date && doc.expiresAt.getTime() > Date.now() + 3590000, 'expiresAt ~ now + 3600s');
    });

    guardArms('scylladb', STORES.scylladb.setDecl, function (calls) {
        return { table: 't', ttl: null, client: {
            execute: function (q, params, opts) { calls.push(['execute', params]); return Promise.resolve(); }
        } };
    }, true, function (calls) {
        assert.equal(calls[0][1][2], 3600, 'USING TTL param must be the resolved seconds');
    });

    guardArms('couchbase v3', COUCHBASE['couchbase v3'].setDecl, function (calls) {
        return { prefix: 'p:', ttl: null, client: {
            upsert: function (sid, sess, opts) { calls.push(['upsert', sid, opts]); return Promise.resolve({}); }
        } };
    }, false, function (calls) {
        assert.equal(calls[0][1], 'p:sid');
        assert.equal(calls[0][2].expiry, 3600);
    });

    guardArms('couchbase v4', COUCHBASE['couchbase v4'].setDecl, function (calls) {
        return { prefix: 'p:', ttl: null, client: {
            upsert: function (sid, sess, opts, cb) { calls.push(['upsert', sid, opts]); cb(null); }
        } };
    }, false, function (calls) {
        assert.equal(calls[0][1], 'p:sid');
        assert.equal(calls[0][2].expiry, 3600);
    });
});


// ─── 04 — couchbase touch() guard parity (#B166 was absent here) ─────────────

describe('04 - #B207 couchbase touch() no-ops when the resolved ttl is <= 0', function () {

    Object.keys(COUCHBASE).forEach(function (name) {

        it(name + ': decayed maxAge -> fn(null) sync, zero upserts, no stamp', function () {
            var m = extractMethod(SRC[name], COUCHBASE[name].touchDecl);
            assert.equal(m.count, 1, 'extraction control');
            var calls = [];
            var sess  = { cookie: { maxAge: 0 } };
            var doneArgs = null;
            compile(m.fnSrc).call({ prefix: 'p:', ttl: null, client: {
                upsert: function () { calls.push(['upsert']); return Promise.resolve({}); }
            } }, 'sid', sess, function (err) { doneArgs = [err]; });
            assert.ok(doneArgs, 'the touch() callback was never invoked');
            assert.equal(doneArgs[0], null);
            assert.equal(calls.length, 0, 'upsert must not run on the guard path');
            assert.ok(!('lastModified' in sess), 'no stamp on the guard path');
        });

        it(name + ': positive control — 1h maxAge re-upserts with expiry 3600 and re-stamps', async function () {
            var m = extractMethod(SRC[name], COUCHBASE[name].touchDecl);
            var calls = [];
            var sess  = { cookie: { maxAge: 3600000 } };
            var doneArgs = null;
            compile(m.fnSrc).call({ prefix: 'p:', ttl: null, client: {
                upsert: function (sid, s, opts) { calls.push(['upsert', sid, opts]); return Promise.resolve({}); }
            } }, 'sid', sess, function (err) { doneArgs = [err]; });
            await tick();
            assert.ok(doneArgs, 'the touch() callback was never invoked');
            assert.equal(doneArgs[0], null);
            assert.deepEqual([calls.length, calls[0][1], calls[0][2].expiry], [1, 'p:sid', 3600]);
            assert.equal(typeof sess.lastModified, 'string');
        });
    });
});


// ─── 05 — source pins (structural locks on the shipped shape) ────────────────

describe('05 - #B207 source pins', function () {

    it('redis: the immortal plain-SET fallback is gone; SETEX is unconditional', function () {
        var active = stripComments(SRC.redis);
        assert.ok(active.indexOf('this.client.set(key, data, fn)') < 0,
            'the expiry-less SET branch must not exist');
        assert.match(active, /this\.client\.setex\(key, ~~ttl, data, fn\)/);
    });

    Object.keys(STORES).forEach(function (name) {
        it(name + ': exactly one braced set() guard, placed before the stamp', function () {
            var braced = stripComments(SRC[name]).match(/if \(ttl <= 0\) \{/g) || [];
            assert.equal(braced.length, 1, 'one braced guard (touch() keeps its single-line #B166 form)');
            var body = extractMethod(SRC[name], STORES[name].setDecl).fnSrc;
            var g = body.indexOf('if (ttl <= 0)');
            var s = body.indexOf('sess.lastModified');
            assert.ok(g >= 0 && s >= 0 && g < s, 'guard must precede the stamp');
        });
    });

    Object.keys(COUCHBASE).forEach(function (name) {
        it(name + ': two braced guards (set + touch), each before its stamp', function () {
            var braced = stripComments(SRC[name]).match(/if \(ttl <= 0\) \{/g) || [];
            assert.equal(braced.length, 2);
            ['setDecl', 'touchDecl'].forEach(function (d) {
                var body = extractMethod(SRC[name], COUCHBASE[name][d]).fnSrc;
                var g = body.indexOf('if (ttl <= 0)');
                var s = body.indexOf('sess.lastModified');
                assert.ok(g >= 0 && s >= 0 && g < s, d + ': guard must precede the stamp');
            });
        });
    });
});
