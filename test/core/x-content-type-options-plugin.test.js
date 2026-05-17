'use strict';
/**
 * X-Content-Type-Options plugin (#HDR1) tests
 *
 * Strategy — mirrors the #CSRF1 / #CSRF2 campaign shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults) — no framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract.
 *  - Negative-invariant lock: header value is fixed to "nosniff" per
 *    RFC 7034 / WHATWG Fetch Standard; no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/x-content-type-options/src/main.js');

var XContentTypeOptions;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    XContentTypeOptions = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: the nosniff response-header pattern is present ─

describe('01 - source inspection: nosniff response-header patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR1 marker is present', function () {
        assert.ok(src.indexOf('#HDR1') > -1, 'expected #HDR1 marker for traceability');
    });

    it('header name is x-content-type-options', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-content-type-options['"]/.test(src),
            'expected HEADER_NAME = x-content-type-options'
        );
    });

    it('header value is nosniff (single valid value per RFC 7034)', function () {
        assert.ok(
            /HEADER_VALUE\s*=\s*['"]nosniff['"]/.test(src),
            'expected HEADER_VALUE = nosniff'
        );
    });

    it('middleware calls res.setHeader with the constants', function () {
        assert.ok(
            /res\.setHeader\(HEADER_NAME,\s*HEADER_VALUE\)/.test(src),
            'expected res.setHeader(HEADER_NAME, HEADER_VALUE) in middleware'
        );
    });

    it('middleware calls next() after setting the header', function () {
        assert.ok(
            /res\.setHeader\(HEADER_NAME[\s\S]*?next\(\)/.test(src),
            'expected next() to be called after res.setHeader'
        );
    });

    it('reads settings.json > xContentTypeOptions via content.settings.xContentTypeOptions', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.xContentTypeOptions/.test(src),
            'expected content.settings → xContentTypeOptions read chain'
        );
    });

    it('caller options win over defaults (mergeOptions hasOwnProperty)', function () {
        assert.ok(
            /hasOwnProperty\.call\(caller,\s*ck\)/.test(src),
            'expected merge to gate caller iteration on hasOwnProperty'
        );
    });

    it('idempotent — skips write when header already present', function () {
        assert.ok(
            /res\.getHeader\(HEADER_NAME\)[\s\S]*?return\s+next\(\)/.test(src),
            'expected idempotent guard: skip+next if header already set'
        );
    });

    it('returned middleware is a named function (ginaXContentTypeOptions) for stack traces', function () {
        assert.ok(
            /function\s+ginaXContentTypeOptions\s*\(/.test(src),
            'expected the returned middleware to be a named function'
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
        var out = XContentTypeOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no xContentTypeOptions key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = XContentTypeOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through xContentTypeOptions block when present (future-proofing)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { xContentTypeOptions: { reservedField: 'someValue' } } } } }
            };
        };
        var out = XContentTypeOptions._resolveSettingsDefaults();
        assert.deepEqual(out, { reservedField: 'someValue' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = XContentTypeOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = XContentTypeOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = XContentTypeOptions._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = XContentTypeOptions._mergeOptions(undefined, { a: 1, b: 2 });
        assert.deepEqual(out, { a: 1, b: 2 });
    });

    it('caller overrides defaults for known keys', function () {
        var out = XContentTypeOptions._mergeOptions({ a: 'CALLER' }, { a: 'DEFAULT', b: 'KEEP' });
        assert.deepEqual(out, { a: 'CALLER', b: 'KEEP' });
    });

    it('caller adds keys not in defaults', function () {
        var out = XContentTypeOptions._mergeOptions({ extra: 'NEW' }, { a: 1 });
        assert.deepEqual(out, { a: 1, extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.own = 'OWN';
        var out = XContentTypeOptions._mergeOptions(caller, { d: 1 });
        assert.deepEqual(out, { d: 1, own: 'OWN' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — Factory + middleware end-to-end ──────────────────────────────────

describe('04 - Factory + middleware behaviour', function () {

    function makeRes(initial) {
        var headers = initial || {};
        return {
            statusCode: 200,
            getHeader: function (n) { return headers[String(n).toLowerCase()] || null; },
            setHeader: function (n, v) { headers[String(n).toLowerCase()] = v; },
            _headers: headers
        };
    }

    it('factory returns a function (express middleware shape)', function () {
        var mw = XContentTypeOptions();
        assert.equal(typeof mw, 'function');
    });

    it('factory accepts an opts argument without throwing', function () {
        assert.doesNotThrow(function () { XContentTypeOptions({ futureField: true }); });
    });

    it('middleware sets x-content-type-options: nosniff on the response', function () {
        var mw  = XContentTypeOptions();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = XContentTypeOptions();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing x-content-type-options header set upstream', function () {
        var mw  = XContentTypeOptions();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-content-type-options': 'nosniff-custom' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff-custom');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = XContentTypeOptions();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

    it('works on HEAD requests', function () {
        var mw  = XContentTypeOptions();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = XContentTypeOptions();
        var mw2 = XContentTypeOptions();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

});


// ─── 05 — Plugin registration in core/plugins/index.js ─────────────────────

describe('05 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('XContentTypeOptions is wired to ./lib/security-headers/x-content-type-options', function () {
        assert.ok(
            /XContentTypeOptions\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/x-content-type-options['"]\s*\)/.test(src),
            'expected XContentTypeOptions registry entry'
        );
    });

    it('#HDR1 marker comment is present', function () {
        assert.ok(
            /#HDR1[^\n]*X-Content-Type-Options/.test(src),
            'expected #HDR1 marker comment naming X-Content-Type-Options'
        );
    });

});


// ─── 06 — Settings template advertises the slot ────────────────────────────

describe('06 - settings.json template advertises xContentTypeOptions slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('xContentTypeOptions key is present', function () {
        assert.ok(
            /"xContentTypeOptions"\s*:\s*\{/.test(src),
            'expected "xContentTypeOptions": { ... } block in settings template'
        );
    });

    it('#HDR1 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR1[^\n]*X-Content-Type-Options/.test(src),
            'expected #HDR1 marker comment before the xContentTypeOptions block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.XContentTypeOptions\(\)/.test(BP),
            'expected XContentTypeOptions adoption example in bundle boilerplate'
        );
    });

});
