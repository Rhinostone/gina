'use strict';
/**
 * #B164 — the logout shim destroys the session record
 *
 * Strategy: core/router.js cannot be require()d standalone (it loads the lib
 * registry + controller at module scope), so the logout shim installed inside
 * Router::route() is EXTRACTED from the shipped source via brace-matching and
 * executed as real bytes against fake request/session fixtures — no
 * drift-prone replica. The extraction is control-gated (the declaration
 * appears exactly once; the brace walk balances).
 *
 * Contract under test: the gina-native branch de-authenticates
 * (`session.user = null`) AND destroys the persisted record via the session's
 * own destroy() when it exposes one, degrading gracefully when it does not,
 * with an optional `done(err)` callback on every path. The install guard and
 * the Passport branch stay untouched, and a call after destruction must never
 * reach `request.destroy()` — the stream method.
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
 * Brace-match the logout shim function expression out of the source.
 *
 * @param   {string} source
 * @returns {{fnSrc: (string|null), declCount: number, balanced: boolean}}
 * @inner
 */
function extractLogout(source) {
    var decl    = 'request.logout =';
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
function makeLogout(fnSrc, consoleStub) {
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


// ─── 01 — extraction controls ────────────────────────────────────────────────

describe('01 - #B164 extraction controls', function () {

    it('the logout shim declaration appears exactly once', function () {
        assert.equal(extractLogout(src).declCount, 1);
    });

    it('the brace walk balances (extraction is complete)', function () {
        var ex = extractLogout(src);
        assert.equal(ex.balanced, true);
        assert.ok(ex.fnSrc && ex.fnSrc.length > 100);
    });

    it('known-negative: the extractor reports failure on unrelated source', function () {
        assert.equal(extractLogout('var x = 1;').declCount, 0);
    });
});


// ─── 02 — behaviour (the shipped bytes, driven) ──────────────────────────────

describe('02 - #B164 gina-native logout destroys the session record', function () {

    // Every fixture invokes its callbacks synchronously, so each test asserts
    // AFTER logout() returns: a shim that never fires the callback leaves
    // `doneArgs` null and FAILS cleanly — it can never hang the suite.

    it('destroys the record, nulls user, and calls back with null', function () {
        var destroyCalls = 0;
        var doneArgs     = null;
        var session = {
            user    : { id: 1 },
            cart    : ['item'],
            destroy : function (cb) { destroyCalls++; cb(null); }
        };
        var req    = { session: session };
        var logout = makeLogout(extractLogout(src).fnSrc, makeConsoleSpy());

        logout.call(req, function (err) { doneArgs = [err]; });

        assert.equal(destroyCalls, 1);
        assert.equal(session.user, null);
        assert.ok(doneArgs, 'the logout callback was never invoked');
        assert.equal(doneArgs[0], null);
    });

    it('a destroy() error reaches the callback and is warned', function () {
        var spy      = makeConsoleSpy();
        var boom     = new Error('store down');
        var doneArgs = null;
        var req  = {
            session: {
                user    : { id: 1 },
                destroy : function (cb) { cb(boom); }
            }
        };
        var logout = makeLogout(extractLogout(src).fnSrc, spy);

        logout.call(req, function (err) { doneArgs = [err]; });

        assert.equal(req.session.user, null);
        assert.ok(doneArgs, 'the logout callback was never invoked');
        assert.equal(doneArgs[0], boom);
        assert.equal(spy.calls.length, 1);
        assert.match(spy.calls[0], /logout/);
    });

    it('degrades gracefully when the session has no destroy()', function () {
        var doneArgs = null;
        var session  = { user: { id: 1 } };
        var req      = { session: session };
        var logout   = makeLogout(extractLogout(src).fnSrc, makeConsoleSpy());

        logout.call(req, function (err) { doneArgs = [err]; });

        assert.equal(session.user, null);
        assert.ok(doneArgs, 'the logout callback was never invoked');
        assert.equal(doneArgs[0], null);
    });

    it('the callback is optional — destruction still happens without one', function () {
        var destroyCalls = 0;
        var session = {
            user    : { id: 1 },
            destroy : function (cb) { destroyCalls++; cb(null); }
        };
        var req    = { session: session };
        var logout = makeLogout(extractLogout(src).fnSrc, makeConsoleSpy());

        assert.doesNotThrow(function () { logout.call(req); });
        assert.equal(destroyCalls, 1);
        assert.equal(session.user, null);
    });

    it('never reaches request.destroy() when the session is gone (stream-hazard guard)', function () {
        var reqDestroyCalls = 0;
        var doneArgs        = null;
        var req    = { destroy: function () { reqDestroyCalls++; } };
        var logout = makeLogout(extractLogout(src).fnSrc, makeConsoleSpy());

        logout.call(req, function (err) { doneArgs = [err]; });

        assert.equal(reqDestroyCalls, 0);
        assert.ok(doneArgs, 'the logout callback was never invoked');
        assert.equal(doneArgs[0], null);
    });

    it('Passport branch preserved: _sm.logOut runs, the record is not destroyed here', function () {
        var smCalls      = [];
        var destroyCalls = 0;
        var doneArgs     = null;
        var req = {
            _passport: {
                instance: {
                    _userProperty : 'account',
                    _sm           : { logOut: function (s) { smCalls.push(s); } }
                }
            },
            account : { id: 7 },
            session : { destroy: function (cb) { destroyCalls++; cb(null); } }
        };
        var logout = makeLogout(extractLogout(src).fnSrc, makeConsoleSpy());

        logout.call(req, function (err) { doneArgs = [err]; });

        assert.equal(smCalls.length, 1);
        assert.equal(smCalls[0], req);
        assert.equal(req.account, null);
        assert.equal(destroyCalls, 0);
        assert.ok(doneArgs, 'the logout callback was never invoked');
        assert.equal(doneArgs[0], null);
    });
});


// ─── 03 — source pins (structural lock) ──────────────────────────────────────

describe('03 - #B164 source pins', function () {

    it('the install guard arms are byte-untouched', function () {
        assert.match(src,
            /typeof\(request\._passport\) != 'undefined'\s*&&\s*typeof\(request\.logOut\) == 'undefined'\s*\|\|\s*typeof\(request\.session\) != 'undefined'\s*&&\s*typeof\(request\.logout\) == 'undefined'/);
    });

    it('the destroy call is gated on the session scope', function () {
        assert.match(extractLogout(src).fnSrc,
            /isSessionScope && typeof\(sess\.destroy\) == 'function'/);
    });

    it('the de-authentication write and the Passport delegation survive', function () {
        var fnSrc = extractLogout(src).fnSrc;
        assert.ok(fnSrc.indexOf('sess[property] = null;') > -1);
        assert.ok(fnSrc.indexOf('_sm.logOut(sess)') > -1);
    });
});
