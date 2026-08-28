'use strict';
/**
 * #B166 — sqlite session-store `touch()` missing the `ttl <= 0` guard
 *
 * Contract under test: when the resolved ttl is zero or negative, `touch()`
 * must NOT write — it refreshes nothing and returns cleanly. Three of the four
 * connectors.json-driven stores already honour this (redis as `if (ttl > 0)`,
 * mongodb and scylladb as `if (ttl <= 0) return fn(null)`); sqlite alone
 * computed `expires = now + ~~ttl` and wrote it, so a touch at the expiry
 * boundary stamped an already-past expiry and EXPIRED the session it was
 * asked to refresh.
 *
 * Reachability is not hypothetical: express-session's `Cookie.maxAge` is a
 * getter returning `this.expires.valueOf() - Date.now()` — a DECAYING
 * remainder — so `maxAge / 1000 | 0` truncates to 0 in the final second of a
 * session's life and goes negative once expired. §02 drives that exact shape
 * rather than asserting it in prose.
 *
 * Strategy: the six session stores cannot be require()d standalone (they read
 * framework globals + drivers at factory-call time), so each `touch()` body is
 * EXTRACTED from the shipped source by brace-matching and executed as real
 * bytes (no drift-prone replica). Brace-matching is safe here because no
 * `touch()` body contains a brace inside a string literal — §01 pins that.
 * Every extraction is control-gated: an extractor that silently matched zero,
 * matched twice, or ran off an unbalanced slice would vacuously pass
 * everything after it.
 *
 * The callbacks are captured SYNCHRONOUSLY (`var seen = null; … ; assert(seen)`)
 * rather than settled via node:test's `done`: every fixture below invokes its
 * callback in-line, and a `done`-style test would HANG rather than fail if a
 * future regression stopped calling back at all.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');
var SETTLE_ONCE = require(path.join(FW, 'core/connectors/settle-once.js')); // #B432 — the guard the extracted store bytes now call

/**
 * The four connectors.json-driven stores, with the declaration prefix used to
 * anchor each `touch()` extraction.
 *
 * @constant {object}
 */
var STORES = {
    redis    : { file: path.join(FW, 'core/connectors/redis/lib/session-store.js'),    decl: 'RedisStore.prototype.touch = function' },
    sqlite   : { file: path.join(FW, 'core/connectors/sqlite/lib/session-store.js'),   decl: 'SqliteStore.prototype.touch = function' },
    mongodb  : { file: path.join(FW, 'core/connectors/mongodb/lib/session-store.js'),  decl: 'MongodbStore.prototype.touch = function' },
    scylladb : { file: path.join(FW, 'core/connectors/scylladb/lib/session-store.js'), decl: 'ScylladbStore.prototype.touch = function' }
};

var ONE_DAY = 86400;
var noop    = function () {};

/**
 * Drop full-line comments so extraction and negative pins can never anchor on
 * a `// was:` line or a JSDoc mention.
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
 * Brace-match a multi-line prototype method out of the shipped source.
 *
 * A line-bounded regex cannot capture a body containing nested `{}`, so the
 * opening brace is located after the declaration and the source walked until
 * depth returns to zero.
 *
 * @param   {string} src  - full store source
 * @param   {string} decl - declaration prefix, e.g. `'SqliteStore.prototype.touch = function'`
 * @returns {{count: number, balanced: boolean, body: (string|null)}}
 * @inner
 */
function extractMethod(src, decl) {
    var active = stripComments(src);
    var i      = active.indexOf(decl);

    if (i < 0) {
        return { count: 0, balanced: false, body: null };
    }
    // control — a second declaration would make the slice ambiguous
    if (active.indexOf(decl, i + 1) !== -1) {
        return { count: 2, balanced: false, body: null };
    }

    var open  = active.indexOf('{', i + decl.length - 1);
    var depth = 0;
    var end   = -1;

    for (var j = open; j < active.length; j++) {
        if (active[j] === '{') {
            depth++;
        } else if (active[j] === '}') {
            depth--;
            if (depth === 0) { end = j; break; }
        }
    }

    if (end < 0 || depth !== 0) {
        return { count: 1, balanced: false, body: null };
    }

    return {
        count    : 1,
        balanced : true,
        body     : active.slice(active.indexOf('function', i), end + 1)
    };
}

/**
 * Compile an extracted `touch()` body into a callable running those exact
 * bytes. Only the module-scope names the bodies close over are injected;
 * `Date` / `Math` / `JSON` come from the ambient realm.
 *
 * @param   {string} body - extracted `function (…) { … }` source
 * @returns {function} callable via `.call(ctx, sid, sess, fn)`
 * @inner
 */
function compile(body) {
    // #B432 — the extracted bytes wrap `fn` through the shared guard; inject it.
    return new Function('noop', 'oneDay', 'settleOnce', 'return (' + body + ');')(noop, ONE_DAY, SETTLE_ONCE);
}

/**
 * Build an express-session-shaped cookie whose `maxAge` DECAYS, mirroring
 * express-session's `get maxAge() { return this.expires.valueOf() - Date.now(); }`.
 *
 * @param   {number} msFromNow - milliseconds until expiry (negative = already expired)
 * @returns {object} `{ cookie: { expires, get maxAge } }`
 * @inner
 */
function decayingSession(msFromNow) {
    var cookie = { expires: new Date(Date.now() + msFromNow) };
    Object.defineProperty(cookie, 'maxAge', {
        get: function () { return this.expires.valueOf() - Date.now(); },
        enumerable: true
    });
    return { cookie: cookie };
}

/**
 * A session carrying a fixed (non-decaying) numeric maxAge.
 *
 * @param   {*} maxAge
 * @returns {object}
 * @inner
 */
function fixedSession(maxAge) {
    return { cookie: { maxAge: maxAge } };
}

/**
 * Per-store context whose write path is a recording spy, so "did touch write?"
 * is observable without a driver.
 *
 * @param   {string} name - store key
 * @param   {*}      ttl  - value for `this.ttl`
 * @returns {{ctx: object, writes: Array}}
 * @inner
 */
function makeCtx(name, ttl) {
    var writes = [];
    var ctx    = { ttl: ttl, prefix: 'sess:' };

    if (name === 'sqlite') {
        ctx._stmtTouch = { run: function (expires, key) { writes.push({ expires: expires, key: key }); } };
    } else if (name === 'redis') {
        ctx.client = { expire: function (key, ttlArg, fn) { writes.push({ key: key, ttl: ttlArg }); if (fn) fn(null); } };
    } else if (name === 'mongodb') {
        ctx._ensureTTL = function (cb) { writes.push({ step: '_ensureTTL' }); cb(null); };
        ctx._coll      = { updateOne: function () { writes.push({ step: 'updateOne' }); return { then: function () { return { catch: function () {} }; } }; } };
    } else if (name === 'scylladb') {
        ctx.table  = 'sessions';
        ctx.client = { execute: function () { writes.push({ step: 'execute' }); return { then: function () { return { catch: function () {} }; } }; } };
    }

    return { ctx: ctx, writes: writes };
}

var SRC  = {};
var TOUCH = {};

before(function () {
    Object.keys(STORES).forEach(function (name) {
        SRC[name]   = fs.readFileSync(STORES[name].file, 'utf8');
        TOUCH[name] = extractMethod(SRC[name], STORES[name].decl);
    });
});


// ─── 01 — extraction controls (an instrument that cannot fail is not one) ────

describe('01 - #B166 extraction controls', function () {

    Object.keys(STORES).forEach(function (name) {
        it(name + ': touch() declaration appears exactly once', function () {
            assert.equal(TOUCH[name].count, 1);
        });

        it(name + ': touch() body brace-matched to depth zero', function () {
            assert.equal(TOUCH[name].balanced, true);
            assert.ok(/^function\s*\(/.test(TOUCH[name].body), 'body starts at the function keyword');
            assert.ok(/\}$/.test(TOUCH[name].body), 'body ends at the matching brace');
        });

        it(name + ': touch() body carries no brace inside a string literal', function () {
            // brace-matching is only sound while this holds — pin it rather than assume it
            var literals = TOUCH[name].body.match(/'[^'\n]*'|"[^"\n]*"/g) || [];
            literals.forEach(function (lit) {
                assert.ok(lit.indexOf('{') < 0 && lit.indexOf('}') < 0,
                    'string literal must not contain a brace: ' + lit);
            });
        });

        it(name + ': extracted body compiles and is callable', function () {
            assert.equal(typeof compile(TOUCH[name].body), 'function');
        });
    });

    it('known-negative: the extractor does not fire on unrelated source', function () {
        var res = extractMethod('var x = 1;\nfunction other() { return 2; }\n', 'SqliteStore.prototype.touch = function');
        assert.equal(res.count, 0);
        assert.equal(res.body, null);
    });

    it('known-negative: the extractor refuses an ambiguous double declaration', function () {
        var doubled = 'SqliteStore.prototype.touch = function (a) { return 1; }\n'
                    + 'SqliteStore.prototype.touch = function (a) { return 2; }\n';
        var res = extractMethod(doubled, 'SqliteStore.prototype.touch = function');
        assert.equal(res.count, 2);
        assert.equal(res.body, null);
    });
});


// ─── 02 — reachability: express-session's decaying maxAge reaches ttl <= 0 ───

describe('02 - #B166 the decaying cookie maxAge reaches a non-positive ttl', function () {

    it('a cookie 500ms from expiry yields ttl 0 through the shared expression', function () {
        var sess   = decayingSession(500);
        var maxAge = sess.cookie.maxAge;
        assert.ok(maxAge > 0 && maxAge <= 500, 'maxAge is a small positive remainder, got ' + maxAge);
        assert.equal(maxAge / 1000 | 0, 0, 'truncates to a zero ttl');
    });

    it('an already-expired cookie yields a negative ttl', function () {
        var sess = decayingSession(-5000);
        assert.ok(sess.cookie.maxAge < 0);
        assert.ok((sess.cookie.maxAge / 1000 | 0) < 0);
    });
});


// ─── 03 — the guard: no store writes when the resolved ttl is non-positive ──

describe('03 - #B166 touch() never writes on a non-positive ttl', function () {

    Object.keys(STORES).forEach(function (name) {

        it(name + ': ttl 0 (sub-second decaying cookie) performs no write', function () {
            var touch = compile(TOUCH[name].body);
            var built = makeCtx(name, null);
            var seen  = null;

            touch.call(built.ctx, 'abc', decayingSession(500), function (err) { seen = [err]; });

            assert.equal(built.writes.length, 0,
                name + ' wrote on a zero ttl: ' + JSON.stringify(built.writes));
            assert.ok(seen, 'the touch callback was never invoked');
            assert.ok(seen[0] === null || seen[0] === undefined, 'callback reports no error');
        });

        it(name + ': negative ttl (expired cookie) performs no write', function () {
            var touch = compile(TOUCH[name].body);
            var built = makeCtx(name, null);
            var seen  = null;

            touch.call(built.ctx, 'abc', decayingSession(-5000), function (err) { seen = [err]; });

            assert.equal(built.writes.length, 0,
                name + ' wrote on a negative ttl: ' + JSON.stringify(built.writes));
            assert.ok(seen, 'the touch callback was never invoked');
        });

        it(name + ': an explicitly configured ttl of 0 via maxAge performs no write', function () {
            var touch = compile(TOUCH[name].body);
            var built = makeCtx(name, null);
            var seen  = null;

            touch.call(built.ctx, 'abc', fixedSession(0), function (err) { seen = [err]; });

            assert.equal(built.writes.length, 0);
            assert.ok(seen, 'the touch callback was never invoked');
        });
    });
});


// ─── 04 — the happy path is unchanged (the guard must not regress refresh) ──

describe('04 - #B166 touch() still refreshes on a positive ttl', function () {

    it('sqlite: stamps expires = now + ttl and reports success', function () {
        var touch = compile(TOUCH.sqlite.body);
        var built = makeCtx('sqlite', null);
        var seen  = null;
        var before = Math.floor(Date.now() / 1000);

        touch.call(built.ctx, 'abc', fixedSession(3600 * 1000), function (err) { seen = [err]; });

        assert.equal(built.writes.length, 1, 'sqlite must still write on a positive ttl');
        assert.equal(built.writes[0].key, 'sess:abc');
        assert.ok(built.writes[0].expires >= before + 3600,
            'expires stamped at least now+3600, got ' + built.writes[0].expires);
        assert.ok(built.writes[0].expires <= before + 3601 + 2, 'expires not overshooting');
        assert.ok(seen, 'the touch callback was never invoked');
        assert.ok(seen[0] === null || seen[0] === undefined);
    });

    it('sqlite: an explicit this.ttl wins over the cookie maxAge', function () {
        var touch = compile(TOUCH.sqlite.body);
        var built = makeCtx('sqlite', 120);
        var before = Math.floor(Date.now() / 1000);

        touch.call(built.ctx, 'abc', fixedSession(3600 * 1000), noop);

        assert.equal(built.writes.length, 1);
        assert.ok(built.writes[0].expires <= before + 122,
            'the configured 120s ttl must win, got ' + (built.writes[0].expires - before));
    });

    it('sqlite: no cookie maxAge falls back to one day', function () {
        var touch = compile(TOUCH.sqlite.body);
        var built = makeCtx('sqlite', null);
        var before = Math.floor(Date.now() / 1000);

        touch.call(built.ctx, 'abc', { cookie: {} }, noop);

        assert.equal(built.writes.length, 1);
        assert.ok(built.writes[0].expires >= before + ONE_DAY, 'falls back to oneDay');
    });

    it('redis: still expires the key on a positive ttl', function () {
        var touch = compile(TOUCH.redis.body);
        var built = makeCtx('redis', null);

        touch.call(built.ctx, 'abc', fixedSession(3600 * 1000), noop);

        assert.equal(built.writes.length, 1);
        assert.equal(built.writes[0].key, 'sess:abc');
        assert.equal(built.writes[0].ttl, 3600);
    });
});


// ─── 05 — source pins (whole-expression anchored, comment-stripped) ─────────

describe('05 - #B166 source pins', function () {

    it('sqlite touch() carries the non-positive-ttl guard', function () {
        var body = stripComments(TOUCH.sqlite.body);
        assert.match(body, /if\s*\(\s*ttl\s*<=\s*0\s*\)\s*return\s+fn\(null\);/,
            'sqlite touch() must short-circuit on a non-positive ttl');
    });

    it('sqlite guards BEFORE computing or writing the expiry', function () {
        var body     = stripComments(TOUCH.sqlite.body);
        var guardIdx = body.search(/if\s*\(\s*ttl\s*<=\s*0\s*\)/);
        var exprIdx  = body.indexOf('var expires');
        var writeIdx = body.indexOf('_stmtTouch.run');

        assert.ok(guardIdx >= 0, 'guard present');
        assert.ok(exprIdx  > guardIdx, 'expires computed only past the guard');
        assert.ok(writeIdx > guardIdx, 'the write sits past the guard');
    });

    it('all four stores short-circuit a non-positive ttl', function () {
        // redis spells it as the inverted `if (ttl > 0) { … } else { fn(); }`
        assert.match(stripComments(TOUCH.redis.body), /if\s*\(\s*ttl\s*>\s*0\s*\)/);
        ['sqlite', 'mongodb', 'scylladb'].forEach(function (name) {
            assert.match(stripComments(TOUCH[name].body), /if\s*\(\s*ttl\s*<=\s*0\s*\)\s*return\s+fn\(null\);/,
                name + ' must carry the shared guard shape');
        });
    });
});
