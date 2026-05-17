'use strict';
/**
 * Hide X-Powered-By plugin (#HDR8) tests
 *
 * Strategy — mirrors the #HDR1 XContentTypeOptions no-opts test shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults) — no framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract: removeHeader called, next() invoked exactly once.
 *  - Negative-invariant lock: shape is REMOVE not SET (no res.setHeader
 *    call); no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/hide-powered-by/src/main.js');

var HidePoweredBy;
var originalGetContext;
var originalGetConfig;

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    HidePoweredBy = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: REMOVE-shape patterns are present ─────────────

describe('01 - source inspection: remove-header patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR8 marker is present', function () {
        assert.ok(src.indexOf('#HDR8') > -1, 'expected #HDR8 marker for traceability');
    });

    it('header name is x-powered-by', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-powered-by['"]/.test(src),
            'expected HEADER_NAME = x-powered-by'
        );
    });

    it('middleware calls res.removeHeader with the constant', function () {
        assert.ok(
            /res\.removeHeader\(HEADER_NAME\)/.test(src),
            'expected res.removeHeader(HEADER_NAME) in middleware'
        );
    });

    it('middleware calls next() after the removeHeader call', function () {
        assert.ok(
            /res\.removeHeader\(HEADER_NAME[\s\S]*?next\(\)/.test(src),
            'expected next() to be called after res.removeHeader'
        );
    });

    it('NEGATIVE-INVARIANT: no res.setHeader call — this plugin is REMOVE shape', function () {
        assert.ok(
            !/res\.setHeader\(/.test(src),
            'HDR8 must NOT call res.setHeader — the whole point is to REMOVE the header'
        );
    });

    it('reads settings.json > hidePoweredBy via content.settings.hidePoweredBy', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.hidePoweredBy/.test(src),
            'expected content.settings → hidePoweredBy read chain'
        );
    });

    it('caller options win over defaults (mergeOptions hasOwnProperty)', function () {
        assert.ok(
            /hasOwnProperty\.call\(caller,\s*ck\)/.test(src),
            'expected merge to gate caller iteration on hasOwnProperty'
        );
    });

    it('removeHeader call is guarded by typeof check (safe under stub res)', function () {
        assert.ok(
            /typeof\s+res\.removeHeader\s*===?\s*['"]function['"]/.test(src),
            'expected typeof res.removeHeader === "function" guard'
        );
    });

    it('returned middleware is a named function (ginaHidePoweredBy) for stack traces', function () {
        assert.ok(
            /function\s+ginaHidePoweredBy\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('documents Isaac-engine writeHead limitation in module JSDoc', function () {
        assert.ok(
            /Isaac engine[\s\S]*writeHead/i.test(src),
            'expected Isaac-engine writeHead caveat in module JSDoc'
        );
    });

    it('no eval, no Function constructor', function () {
        assert.ok(!/\beval\s*\(/.test(src),         'no eval(...) allowed');
        assert.ok(!/new\s+Function\s*\(/.test(src), 'no new Function(...) allowed');
    });

});


// ─── 02 — _resolveSettingsDefaults: settings-driven defaults ───────────────

describe('02 - _resolveSettingsDefaults: settings-driven defaults', function () {

    var savedGetConfig;
    var savedGetContext;

    beforeEach(function () {
        savedGetConfig  = global.getConfig;
        savedGetContext = global.getContext;
    });
    afterEach(function () {
        global.getConfig  = savedGetConfig;
        global.getContext = savedGetContext;
    });

    it('returns an empty object when settings are absent', function () {
        global.getConfig = function () { return { test: { dev: { content: { settings: {} } } } }; };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no hidePoweredBy key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through hidePoweredBy block when present (future-proofing)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { hidePoweredBy: { reservedField: 'someValue' } } } } }
            };
        };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, { reservedField: 'someValue' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = HidePoweredBy._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = HidePoweredBy._mergeOptions(undefined, { a: 1, b: 2 });
        assert.deepEqual(out, { a: 1, b: 2 });
    });

    it('caller overrides defaults for known keys', function () {
        var out = HidePoweredBy._mergeOptions({ a: 'CALLER' }, { a: 'DEFAULT', b: 'KEEP' });
        assert.deepEqual(out, { a: 'CALLER', b: 'KEEP' });
    });

    it('caller adds keys not in defaults', function () {
        var out = HidePoweredBy._mergeOptions({ extra: 'NEW' }, { a: 1 });
        assert.deepEqual(out, { a: 1, extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.own = 'OWN';
        var out = HidePoweredBy._mergeOptions(caller, { d: 1 });
        assert.deepEqual(out, { d: 1, own: 'OWN' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — Factory + middleware end-to-end ──────────────────────────────────

describe('04 - Factory + middleware behaviour', function () {

    function makeRes(initial) {
        var headers = Object.assign({}, initial || {});
        return {
            statusCode: 200,
            getHeader: function (n) {
                var v = headers[String(n).toLowerCase()];
                return typeof v === 'undefined' ? null : v;
            },
            setHeader: function (n, v) { headers[String(n).toLowerCase()] = v; },
            removeHeader: function (n) { delete headers[String(n).toLowerCase()]; },
            _headers: headers
        };
    }

    it('factory returns a function (express middleware shape)', function () {
        var mw = HidePoweredBy();
        assert.equal(typeof mw, 'function');
    });

    it('factory accepts an opts argument without throwing', function () {
        assert.doesNotThrow(function () { HidePoweredBy({ futureField: true }); });
    });

    it('middleware removes X-Powered-By when set upstream', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/0.3.15-alpha.3' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('middleware is a no-op when X-Powered-By is not set (idempotent)', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = HidePoweredBy();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes({ 'x-powered-by': 'Gina/X' });
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('middleware leaves OTHER headers alone — only removes x-powered-by', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({
            'x-powered-by': 'Gina/X',
            'content-type': 'text/html',
            'cache-control': 'no-cache'
        });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
        assert.equal(res.getHeader('content-type'),  'text/html');
        assert.equal(res.getHeader('cache-control'), 'no-cache');
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('works on HEAD requests', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('typeof-guarded — does NOT throw on stub res without removeHeader', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        // Stub res with no removeHeader method (intentionally bare)
        var res = { statusCode: 200 };
        var nextCalled = false;
        assert.doesNotThrow(function () {
            mw(req, res, function () { nextCalled = true; });
        });
        assert.equal(nextCalled, true);
    });

    it('safe to register multiple times — second call is a no-op on already-removed header', function () {
        var mw1 = HidePoweredBy();
        var mw2 = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw1(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('does NOT re-add the header if upstream code re-sets it AFTER this middleware', function () {
        // This is a sanity-check on the documented behaviour: HidePoweredBy
        // only removes the header at the time it runs. If a later middleware
        // re-sets it, that re-add WINS (header is back in the response).
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
        // Simulate a later middleware re-setting it:
        res.setHeader('x-powered-by', 'Re-added/1.0');
        assert.equal(res.getHeader('x-powered-by'), 'Re-added/1.0');
    });

});


// ─── 05 — Plugin registration in core/plugins/index.js ─────────────────────

describe('05 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('HidePoweredBy is wired to ./lib/security-headers/hide-powered-by', function () {
        assert.ok(
            /HidePoweredBy\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/hide-powered-by['"]\s*\)/.test(src),
            'expected HidePoweredBy registry entry'
        );
    });

    it('#HDR8 marker comment is present', function () {
        assert.ok(
            /#HDR8[^\n]*X-Powered-By/.test(src),
            'expected #HDR8 marker comment naming X-Powered-By'
        );
    });

});


// ─── 06 — Settings template advertises the slot + boilerplate ──────────────

describe('06 - settings.json template advertises hidePoweredBy slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('hidePoweredBy key is present', function () {
        assert.ok(
            /"hidePoweredBy"\s*:\s*\{/.test(src),
            'expected "hidePoweredBy": { ... } block in settings template'
        );
    });

    it('#HDR8 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR8[^\n]*X-Powered-By/.test(src),
            'expected #HDR8 marker comment before the hidePoweredBy block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.HidePoweredBy\(\)/.test(BP),
            'expected HidePoweredBy adoption example in bundle boilerplate'
        );
    });

});
