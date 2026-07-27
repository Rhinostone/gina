'use strict';
/**
 * #COMPLY4 — absolute session timeout (opt-in) in the Session plugin
 *
 * Contract under test: `session({ absoluteTimeout: <ms> })` — or the
 * `settings.json > session.absoluteTimeout` default, bundle code winning —
 * wraps the express-session middleware so that an AUTHENTICATED session older
 * than the cap (measured from the `_ginaCreatedAt` anchor `req.login()` stamps
 * at rotation) is destroyed on its next request, the request proceeding with a
 * fresh anonymous session. Manual-bind consumers are anchored lazily (one
 * request late) — and only once `session.user` is truthy, so anonymous
 * sessions are never modified and `saveUninitialized: false` semantics are
 * preserved. Without the option the factory returns express-session's
 * middleware IDENTICALLY (the subtract: no opt-in, no contribution).
 *
 * The plugin is require()able directly, so this suite is genuinely
 * behavioural — a stub express-session factory + synchronous session fixtures,
 * assertions after the call returns (no callback-wait hang class).
 */
var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');

var FW      = require('../fw');
var Session = require(path.join(FW, 'core/plugins/lib/session/src/main.js'));

var originalGetContext, originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});

/**
 * Point the mocked settings at a given `session` block.
 *
 * @param {object} sessionBlock
 * @inner
 */
function setSettings(sessionBlock) {
    global.getConfig = function () {
        return { test: { dev: { content: { settings: { session: sessionBlock } } } } };
    };
}

/**
 * Stub express-session factory: records the options it was called with and
 * returns a marker middleware that just next()s (the test pre-sets
 * `req.session` on the request object it drives).
 *
 * @returns {function} stub factory with `.lastOptions` and `.mw`
 * @inner
 */
function makeStub() {
    function stub(options) {
        stub.lastOptions = options;
        stub.mw = function mw(req, res, next) { next(); };
        return stub.mw;
    }
    stub.lastOptions = null;
    stub.mw          = null;
    stub.Store       = function Store() {};
    return stub;
}

/**
 * Drive a produced middleware against a request fixture, capturing next()
 * synchronously.
 *
 * @param   {function} produced - what the wrapped factory returned
 * @param   {object}   req
 * @returns {{args: (Array|null), calls: number}}
 * @inner
 */
function drive(produced, req) {
    var seen = { args: null, calls: 0 };
    produced(req, {}, function (err) { seen.calls++; seen.args = [err]; });
    return seen;
}


// ─── 01 — factory-time resolution, validation, and the subtract ──────────────

describe('01 - #COMPLY4 absoluteTimeout resolution at factory time', function () {

    beforeEach(function () { setSettings({}); });
    afterEach(function () { setSettings({}); });

    it('SUBTRACT: no option, no settings default — the raw middleware is returned identically', function () {
        var stub     = makeStub();
        var produced = Session(stub)({ name: 'sid' });
        assert.equal(produced, stub.mw, 'no opt-in must mean zero contribution');
    });

    it('a valid option returns a wrapper (not the raw mw) and never reaches express-session', function () {
        var stub     = makeStub();
        var produced = Session(stub)({ absoluteTimeout: 60000 });
        assert.notEqual(produced, stub.mw);
        assert.ok(!('absoluteTimeout' in stub.lastOptions),
            'the gina-only key must be stripped before express-session sees the options');
    });

    it('the wrapper is named for stack traces', function () {
        var stub     = makeStub();
        var produced = Session(stub)({ absoluteTimeout: 60000 });
        assert.equal(produced.name, 'ginaSessionAbsoluteTimeout');
    });

    it('invalid option values throw at factory call time', function () {
        ['x', 0, -5, NaN, Infinity, true, {}].forEach(function (bad) {
            var stub = makeStub();
            assert.throws(function () { Session(stub)({ absoluteTimeout: bad }); },
                /absoluteTimeout/,
                'expected a factory-time throw for ' + JSON.stringify(bad));
        });
    });

    it('false / null explicitly opt OUT, beating a settings default', function () {
        setSettings({ absoluteTimeout: 1000 });
        [false, null].forEach(function (off) {
            var stub     = makeStub();
            var produced = Session(stub)({ absoluteTimeout: off });
            assert.equal(produced, stub.mw, 'explicit opt-out must return the raw middleware');
        });
    });

    it('the settings default drives the wrapper when bundle code passes nothing', function () {
        setSettings({ absoluteTimeout: 1000 });
        var stub     = makeStub();
        var produced = Session(stub)({ name: 'sid' });
        assert.notEqual(produced, stub.mw, 'settings default must engage the wrapper');
    });

    it('bundle code WINS over the settings default (proven by the effective value)', function () {
        setSettings({ absoluteTimeout: 1000 });                 // would expire a 3s-old anchor
        var stub     = makeStub();
        var produced = Session(stub)({ absoluteTimeout: 5000 }); // must not
        var sess     = { user: { id: 1 }, _ginaCreatedAt: Date.now() - 3000,
                         regenerate: function (cb) { sess.regenerateCalled = true; cb(null); } };
        var seen     = drive(produced, { session: sess });

        assert.equal(seen.calls, 1);
        assert.ok(!sess.regenerateCalled, 'a 3s-old anchor must survive under the 5s bundle value');
        assert.equal(sess.user.id, 1, 'still authenticated');
    });

    it('an invalid settings default throws at factory call time', function () {
        ['8h', -1, 0].forEach(function (bad) {
            setSettings({ absoluteTimeout: bad });
            var stub = makeStub();
            assert.throws(function () { Session(stub)({ name: 'sid' }); }, /absoluteTimeout/);
        });
    });
});


// ─── 02 — the anchor: stamped for authenticated sessions only ────────────────

describe('02 - #COMPLY4 anchor stamping', function () {

    beforeEach(function () { setSettings({}); });

    function produced(ms) {
        return Session(makeStub())({ absoluteTimeout: ms });
    }

    it('an authenticated session without an anchor is stamped (manual-bind consumers)', function () {
        var sess   = { user: { id: 1 } };
        var before = Date.now();
        var seen   = drive(produced(60000), { session: sess });

        assert.equal(seen.calls, 1);
        assert.equal(seen.args[0], undefined);
        assert.equal(typeof sess._ginaCreatedAt, 'number');
        assert.ok(sess._ginaCreatedAt >= before);
    });

    it('a corrupt (non-number) anchor is re-stamped, not enforced against', function () {
        var sess = { user: { id: 1 }, _ginaCreatedAt: 'garbage' };
        drive(produced(60000), { session: sess });
        assert.equal(typeof sess._ginaCreatedAt, 'number');
        assert.equal(sess.user.id, 1);
    });

    it('an ANONYMOUS session is never stamped (saveUninitialized preserved)', function () {
        var sess = { cookie: {} };
        var seen = drive(produced(60000), { session: sess });

        assert.equal(seen.calls, 1);
        assert.ok(!('_ginaCreatedAt' in sess), 'no anchor on anonymous sessions');
    });

    it('no session on the request at all: pass-through', function () {
        var seen = drive(produced(60000), {});
        assert.equal(seen.calls, 1);
        assert.equal(seen.args[0], undefined);
    });

    it('an upstream middleware error is forwarded untouched', function () {
        var boom = new Error('session store down');
        var stub = makeStub();
        function failingFactory(options) { stub(options); return function (req, res, next) { next(boom); }; }
        failingFactory.Store = function () {};
        var wrapper = Session(failingFactory)({ absoluteTimeout: 60000 });
        var sess    = { user: { id: 1 } };
        var seen    = drive(wrapper, { session: sess });

        assert.equal(seen.calls, 1);
        assert.equal(seen.args[0], boom);
        assert.ok(!('_ginaCreatedAt' in sess), 'no work after an upstream error');
    });
});


// ─── 03 — expiry: destroy + fresh anonymous, fail-closed ─────────────────────

describe('03 - #COMPLY4 absolute expiry', function () {

    beforeEach(function () { setSettings({}); });

    function produced(ms) {
        return Session(makeStub())({ absoluteTimeout: ms });
    }

    it('an over-age session is regenerated: fresh anonymous, request proceeds', function () {
        var fresh = { cookie: {} };
        var req   = {};
        var sess  = {
            user           : { id: 1 },
            _ginaCreatedAt : Date.now() - 10000,
            regenerate     : function (cb) { sess.regenerateCalled = true; req.session = fresh; cb(null); }
        };
        req.session = sess;
        var seen = drive(produced(5000), req);

        assert.equal(sess.regenerateCalled, true, 'the record must be destroyed');
        assert.equal(req.session, fresh, 'a fresh anonymous session replaces it');
        assert.ok(!fresh.user, 'the fresh session is unauthenticated');
        assert.equal(seen.calls, 1, 'the request proceeds');
        assert.equal(seen.args[0], undefined, 'no error surfaced — indistinguishable from natural expiry');
    });

    it('a session within the cap is untouched', function () {
        var sess = {
            user           : { id: 1 },
            _ginaCreatedAt : Date.now() - 1000,
            regenerate     : function () { sess.regenerateCalled = true; }
        };
        var seen = drive(produced(60000), { session: sess });

        assert.ok(!sess.regenerateCalled);
        assert.equal(sess.user.id, 1);
        assert.equal(seen.calls, 1);
    });

    it('FAIL-CLOSED: a regenerate() error still drops the authentication locally', function () {
        var sess = {
            user           : { id: 1 },
            _ginaCreatedAt : Date.now() - 10000,
            regenerate     : function (cb) { cb(new Error('store down')); }
        };
        var seen = drive(produced(5000), { session: sess });

        assert.equal(sess.user, null, 'authentication dropped despite the store failure');
        assert.ok(!('_ginaCreatedAt' in sess), 'the anchor is cleared');
        assert.equal(seen.calls, 1, 'the request still proceeds');
        assert.equal(seen.args[0], undefined);
    });

    it('FAIL-CLOSED without regenerate(): user nulled, destroy() used when present', function () {
        var destroyed = 0;
        var sess = {
            user           : { id: 1 },
            _ginaCreatedAt : Date.now() - 10000,
            destroy        : function (cb) { destroyed++; cb(null); }
        };
        var seen = drive(produced(5000), { session: sess });

        assert.equal(sess.user, null);
        assert.equal(destroyed, 1);
        assert.equal(seen.calls, 1);
    });

    it('FAIL-CLOSED with neither regenerate() nor destroy(): user still nulled', function () {
        var sess = { user: { id: 1 }, _ginaCreatedAt: Date.now() - 10000 };
        var seen = drive(produced(5000), { session: sess });

        assert.equal(sess.user, null);
        assert.ok(!('_ginaCreatedAt' in sess));
        assert.equal(seen.calls, 1);
    });

    it('an anchored-but-anonymous leftover is cleaned up too', function () {
        var sess = {
            _ginaCreatedAt : Date.now() - 10000,
            regenerate     : function (cb) { sess.regenerateCalled = true; cb(null); }
        };
        var seen = drive(produced(5000), { session: sess });

        assert.equal(sess.regenerateCalled, true, 'a stale anchor is a stale record — destroyed');
        assert.equal(seen.calls, 1);
    });
});
