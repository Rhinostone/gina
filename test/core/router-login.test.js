'use strict';
/**
 * #COMPLY4 — the login shim's gina-native branch rotates the session id
 *
 * Strategy: core/router.js cannot be require()d standalone (it loads the lib
 * registry + controller at module scope), so the login shim installed inside
 * Router::route() is EXTRACTED from the shipped source via brace-matching and
 * executed as real bytes against fake request/session fixtures — no
 * drift-prone replica. The extraction is control-gated (the declaration
 * appears exactly once; the brace walk balances).
 *
 * Contract under test: the gina-native branch (no Passport) regenerates the
 * session id BEFORE binding the user (session-fixation defense), binds at
 * `session.user`, stamps the absolute-timeout anchor, persists via the
 * session's own save(), and reports through the REQUIRED `done(err)` on every
 * path. It degrades gracefully when the session provider exposes no
 * regenerate() (bind + warn, no rotation). The install guard, the
 * `{session:false}` early-return and the Passport branch stay untouched.
 *
 * Every fixture invokes its callbacks synchronously, so each test asserts
 * AFTER login() returns: a shim that never fires the callback leaves
 * `doneArgs` null and FAILS cleanly — it can never hang the suite.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var ROUTER = path.join(FW, 'core/router.js');

var src;
before(function () { src = fs.readFileSync(ROUTER, 'utf8'); });

/**
 * Drop full-line comments so negative pins can never anchor on a `// was:`
 * line or a JSDoc mention.
 *
 * @param   {string} source
 * @returns {string}
 * @inner
 */
function stripComments(source) {
    return source.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * Brace-match the login shim function expression out of the source.
 *
 * @param   {string} source
 * @returns {{fnSrc: (string|null), declCount: number, balanced: boolean}}
 * @inner
 */
function extractLogin(source) {
    var decl    = 'request.login =';
    var declIdx = source.indexOf(decl);
    if (declIdx < 0) {
        return { fnSrc: null, declCount: 0, balanced: false };
    }
    var declCount = (source.indexOf(decl, declIdx + 1) < 0) ? 1 : 2;
    var funcIdx   = source.indexOf('function', declIdx);
    if (funcIdx < 0 || funcIdx - declIdx > 80) {
        return { fnSrc: null, declCount: declCount, balanced: false };
    }
    var i = source.indexOf('{', funcIdx);
    if (i < 0) {
        return { fnSrc: null, declCount: declCount, balanced: false };
    }
    var depth = 1;
    while (depth > 0 && ++i < source.length) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
    }
    return {
        fnSrc     : (depth === 0) ? source.slice(funcIdx, i + 1) : null,
        declCount : declCount,
        balanced  : depth === 0
    };
}

/**
 * Compile the extracted shim with a stubbed logger in scope.
 *
 * @param   {string} fnSrc
 * @param   {object} consoleStub
 * @returns {function}
 * @inner
 */
function makeLogin(fnSrc, consoleStub) {
    return new Function('console', 'return (' + fnSrc + ');')(consoleStub);
}

/**
 * @returns {{warn: function, calls: string[]}} logger spy
 * @inner
 */
function makeConsoleSpy() {
    var spy = { calls: [] };
    spy.warn = function (msg) { spy.calls.push(msg); };
    return spy;
}

/**
 * A request whose session mimics express-session's regenerate(): the session
 * object on the request is REPLACED by a fresh one before the callback runs.
 *
 * @param   {object} [freshOverrides] - extra keys for the fresh session
 * @returns {{req: object, old: object, fresh: object, counters: object}}
 * @inner
 */
function makeRotatingFixture(freshOverrides) {
    var counters = { regenerate: 0, saveFresh: 0, saveOld: 0 };
    var fresh = {
        cookie : {},
        save   : function (cb) { counters.saveFresh++; cb(null); }
    };
    var k;
    if (freshOverrides) {
        for (k in freshOverrides) { fresh[k] = freshOverrides[k]; }
    }
    var old = {
        cookie     : {},
        anon       : 'cart-before-login',
        save       : function (cb) { counters.saveOld++; cb(null); },
        regenerate : function (cb) {
            counters.regenerate++;
            req.session = fresh;
            cb(null);
        }
    };
    var req = { session: old };
    return { req: req, old: old, fresh: fresh, counters: counters };
}


// ─── 01 — extraction controls ────────────────────────────────────────────────

describe('01 - #COMPLY4 extraction controls', function () {

    it('the login shim declaration appears exactly once', function () {
        assert.equal(extractLogin(src).declCount, 1);
    });

    it('the brace walk balances (extraction is complete)', function () {
        var ex = extractLogin(src);
        assert.equal(ex.balanced, true);
        assert.ok(ex.fnSrc && ex.fnSrc.length > 100);
    });

    it('known-negative: the extractor reports failure on unrelated source', function () {
        assert.equal(extractLogin('var x = 1;').declCount, 0);
    });
});


// ─── 02 — gina-native rotation (the shipped bytes, driven) ───────────────────

describe('02 - #COMPLY4 gina-native login rotates the session id', function () {

    it('regenerates FIRST, binds user + anchor on the fresh session, saves, calls back', function () {
        var fx       = makeRotatingFixture();
        var doneArgs = null;
        var user     = { id: 42, name: 'A' };
        var login    = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());
        var before   = Date.now();

        login.call(fx.req, user, function (err) { doneArgs = [err]; });

        assert.equal(fx.counters.regenerate, 1, 'regenerate() must run');
        assert.equal(fx.fresh.user, user, 'user bound on the FRESH (post-rotation) session');
        assert.equal(typeof fx.old.user, 'undefined', 'the pre-rotation session never sees the user');
        assert.equal(typeof fx.fresh._ginaCreatedAt, 'number', 'absolute-timeout anchor stamped');
        assert.ok(fx.fresh._ginaCreatedAt >= before && fx.fresh._ginaCreatedAt <= Date.now() + 1);
        assert.equal(fx.counters.saveFresh, 1, 'the fresh session is persisted before done');
        assert.equal(fx.req.user, user, 'request-level user kept for middleware parity');
        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], null);
    });

    it('the 3-arg form login(user, {}, done) takes the same native path', function () {
        var fx       = makeRotatingFixture();
        var doneArgs = null;
        var login    = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(fx.req, { id: 1 }, {}, function (err) { doneArgs = [err]; });

        assert.equal(fx.counters.regenerate, 1);
        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], null);
    });

    it('the callback is REQUIRED on the native branch', function () {
        var fx    = makeRotatingFixture();
        var login = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        assert.throws(function () { login.call(fx.req, { id: 1 }); },
            /req#login requires a callback function/);
        assert.equal(fx.counters.regenerate, 0, 'nothing ran before the contract check');
    });

    it('no session at all: calls back with an error naming the Session plugin, user unwound', function () {
        var doneArgs = null;
        var req      = {};
        var login    = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(req, { id: 1 }, function (err) { doneArgs = [err]; });

        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.ok(doneArgs[0] instanceof Error);
        assert.match(doneArgs[0].message, /[Ss]ession/);
        assert.equal(req.user, null, 'request-level user unwound on failure');
    });

    it('a regenerate() error reaches the callback; nothing is bound', function () {
        var boom     = new Error('store down');
        var doneArgs = null;
        var session  = {
            regenerate : function (cb) { cb(boom); },
            save       : function (cb) { cb(null); }
        };
        var req   = { session: session };
        var login = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(req, { id: 1 }, function (err) { doneArgs = [err]; });

        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], boom);
        assert.equal(typeof session.user, 'undefined', 'no bind on a failed rotation');
        assert.equal(req.user, null, 'request-level user unwound on failure');
    });

    it('a save() error reaches the callback; the bind stands', function () {
        var boom  = new Error('write failed');
        var fx    = makeRotatingFixture({ save: function (cb) { cb(boom); } });
        var doneArgs = null;
        var user  = { id: 9 };
        var login = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(fx.req, user, function (err) { doneArgs = [err]; });

        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], boom);
        assert.equal(fx.fresh.user, user, 'the in-memory bind stands; the consumer decides');
    });

    it('degrades without regenerate(): binds + warns + saves, no rotation available', function () {
        var spy      = makeConsoleSpy();
        var saves    = 0;
        var session  = {
            save: function (cb) { saves++; cb(null); }
        };
        var req      = { session: session };
        var doneArgs = null;
        var user     = { id: 3 };
        var login    = makeLogin(extractLogin(src).fnSrc, spy);

        login.call(req, user, function (err) { doneArgs = [err]; });

        assert.equal(session.user, user);
        assert.equal(typeof session._ginaCreatedAt, 'number');
        assert.equal(saves, 1);
        assert.equal(spy.calls.length, 1, 'the missing fixation defense is warned');
        assert.match(spy.calls[0], /rotation|regenerate/i);
        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], null);
    });

    it('degrades without save() either: binds and calls back clean', function () {
        var session  = {};
        var req      = { session: session };
        var doneArgs = null;
        var login    = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(req, { id: 4 }, function (err) { doneArgs = [err]; });

        assert.equal(session.user.id, 4);
        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], null);
    });

    it('{session: false} early-return preserved: request-level bind only, no rotation', function () {
        var fx       = makeRotatingFixture();
        var doneArgs = null;
        var user     = { id: 5 };
        var login    = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(fx.req, user, { session: false }, function () { doneArgs = []; });

        assert.equal(fx.req.user, user);
        assert.equal(fx.counters.regenerate, 0, 'no session work in transient mode');
        assert.equal(typeof fx.old.user, 'undefined');
        assert.ok(doneArgs, 'the login callback was never invoked');
    });
});


// ─── 03 — Passport branch preserved ──────────────────────────────────────────

describe('03 - #COMPLY4 Passport branch untouched', function () {

    it('delegates to _sm.logIn and calls back on success', function () {
        var smArgs   = null;
        var doneArgs = null;
        var req = {
            _passport: {
                instance: {
                    _userProperty : 'account',
                    _sm           : { logIn: function (r, u, cb) { smArgs = [r, u]; cb(null); } }
                }
            },
            session: {
                regenerate: function () { throw new Error('native path must not run for Passport'); }
            }
        };
        var user  = { id: 7 };
        var login = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(req, user, function (err) { doneArgs = [err]; });

        assert.ok(smArgs, 'Passport session manager was not invoked');
        assert.equal(smArgs[0], req);
        assert.equal(smArgs[1], user);
        assert.equal(req.account, user, 'the Passport user property is used');
        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], undefined);
    });

    it('a Passport logIn error nulls the user property and reaches the callback', function () {
        var boom     = new Error('pp down');
        var doneArgs = null;
        var req = {
            _passport: {
                instance: {
                    _sm: { logIn: function (r, u, cb) { cb(boom); } }
                }
            }
        };
        var login = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        login.call(req, { id: 8 }, function (err) { doneArgs = [err]; });

        assert.equal(req.user, null);
        assert.ok(doneArgs, 'the login callback was never invoked');
        assert.equal(doneArgs[0], boom);
    });

    it('the Passport branch still requires a callback', function () {
        var req = {
            _passport: { instance: { _sm: { logIn: function () {} } } }
        };
        var login = makeLogin(extractLogin(src).fnSrc, makeConsoleSpy());

        assert.throws(function () { login.call(req, { id: 1 }); },
            /req#login requires a callback function/);
    });
});


// ─── 04 — source pins (structural lock) ──────────────────────────────────────

describe('04 - #COMPLY4 source pins', function () {

    it('the install guard arms are byte-untouched', function () {
        assert.match(src,
            /typeof\(request\._passport\) != 'undefined'\s*&&\s*typeof\(request\.logIn\) == 'undefined'\s*\|\|\s*typeof\(request\.login\) == 'undefined'/);
    });

    it('the native branch no longer throws for non-Passport bundles', function () {
        var active = stripComments(extractLogin(src).fnSrc);
        assert.ok(active.indexOf("throw new Error('passport.initialize() middleware not in use')") < 0,
            'the passport-required throw must be gone from the ACTIVE native path');
    });

    it('rotation precedes the bind: regenerate() before session.user =', function () {
        var active   = stripComments(extractLogin(src).fnSrc);
        var regenIdx = active.indexOf('.regenerate(');
        var bindIdx  = active.indexOf('.user = user');
        assert.ok(regenIdx > -1, 'the native branch calls regenerate()');
        assert.ok(bindIdx  > -1, 'the native branch binds session.user');
        assert.ok(regenIdx < bindIdx, 'fixation defense: rotate BEFORE binding');
    });

    it('the absolute-timeout anchor is stamped at login', function () {
        var active = stripComments(extractLogin(src).fnSrc);
        assert.match(active, /_ginaCreatedAt\s*=\s*Date\.now\(\)/);
    });

    it('the Passport delegation survives', function () {
        assert.ok(extractLogin(src).fnSrc.indexOf('_sm.logIn(this, user,') > -1);
    });
});
