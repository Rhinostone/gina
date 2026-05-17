'use strict';
/**
 * X-Frame-Options plugin (#HDR2) tests
 *
 * Strategy — mirrors the #HDR1 plugin test shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults, _resolveValue) — no framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract.
 *  - Negative-invariant locks: legacy "ALLOW-FROM <uri>" rejected with
 *    explicit pointer at CSP frame-ancestors; non-"DENY"/"SAMEORIGIN"
 *    values rejected at factory call time; no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/x-frame-options/src/main.js');

var XFrameOptions;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    XFrameOptions = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR2 marker is present', function () {
        assert.ok(src.indexOf('#HDR2') > -1, 'expected #HDR2 marker for traceability');
    });

    it('header name is x-frame-options', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-frame-options['"]/.test(src),
            'expected HEADER_NAME = x-frame-options'
        );
    });

    it('valid values are DENY and SAMEORIGIN', function () {
        assert.ok(
            /VALID_VALUES\s*=\s*\[\s*['"]DENY['"]\s*,\s*['"]SAMEORIGIN['"]\s*\]/.test(src),
            'expected VALID_VALUES = ["DENY", "SAMEORIGIN"]'
        );
    });

    it('default value is SAMEORIGIN', function () {
        assert.ok(
            /DEFAULT_VALUE\s*=\s*['"]SAMEORIGIN['"]/.test(src),
            'expected DEFAULT_VALUE = SAMEORIGIN'
        );
    });

    it('legacy ALLOW-FROM is rejected explicitly', function () {
        assert.ok(
            /\^ALLOW-FROM\\b/.test(src) || /ALLOW-FROM/.test(src),
            'expected ALLOW-FROM rejection branch'
        );
        assert.ok(
            /frame-ancestors/.test(src),
            'expected CSP frame-ancestors pointer in the rejection message'
        );
    });

    it('middleware calls res.setHeader with the constant and resolved value', function () {
        assert.ok(
            /res\.setHeader\(HEADER_NAME,\s*value\)/.test(src),
            'expected res.setHeader(HEADER_NAME, value) in middleware'
        );
    });

    it('middleware calls next() after setting the header', function () {
        assert.ok(
            /res\.setHeader\(HEADER_NAME[\s\S]*?next\(\)/.test(src),
            'expected next() to be called after res.setHeader'
        );
    });

    it('reads settings.json > xFrameOptions via content.settings.xFrameOptions', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.xFrameOptions/.test(src),
            'expected content.settings → xFrameOptions read chain'
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

    it('returned middleware is a named function (ginaXFrameOptions) for stack traces', function () {
        assert.ok(
            /function\s+ginaXFrameOptions\s*\(/.test(src),
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
        var out = XFrameOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no xFrameOptions key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = XFrameOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through xFrameOptions block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { xFrameOptions: { value: 'DENY' } } } } }
            };
        };
        var out = XFrameOptions._resolveSettingsDefaults();
        assert.deepEqual(out, { value: 'DENY' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = XFrameOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = XFrameOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = XFrameOptions._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = XFrameOptions._mergeOptions(undefined, { value: 'SAMEORIGIN' });
        assert.deepEqual(out, { value: 'SAMEORIGIN' });
    });

    it('caller overrides defaults for known keys', function () {
        var out = XFrameOptions._mergeOptions({ value: 'DENY' }, { value: 'SAMEORIGIN' });
        assert.deepEqual(out, { value: 'DENY' });
    });

    it('caller adds keys not in defaults', function () {
        var out = XFrameOptions._mergeOptions({ extra: 'NEW' }, { value: 'DENY' });
        assert.deepEqual(out, { value: 'DENY', extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.value = 'DENY';
        var out = XFrameOptions._mergeOptions(caller, { value: 'SAMEORIGIN' });
        assert.deepEqual(out, { value: 'DENY' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveValue: validation + normalisation ─────────────────────────

describe('04 - _resolveValue: validation + uppercase normalisation', function () {

    it('returns SAMEORIGIN when value is undefined', function () {
        assert.equal(XFrameOptions._resolveValue(undefined), 'SAMEORIGIN');
    });

    it('returns SAMEORIGIN when value is null', function () {
        assert.equal(XFrameOptions._resolveValue(null), 'SAMEORIGIN');
    });

    it('returns SAMEORIGIN when value is empty string', function () {
        assert.equal(XFrameOptions._resolveValue(''), 'SAMEORIGIN');
    });

    it('accepts "DENY" (canonical case)', function () {
        assert.equal(XFrameOptions._resolveValue('DENY'), 'DENY');
    });

    it('accepts "SAMEORIGIN" (canonical case)', function () {
        assert.equal(XFrameOptions._resolveValue('SAMEORIGIN'), 'SAMEORIGIN');
    });

    it('accepts lowercase "deny" and normalises to DENY', function () {
        assert.equal(XFrameOptions._resolveValue('deny'), 'DENY');
    });

    it('accepts mixed-case "SameOrigin" and normalises to SAMEORIGIN', function () {
        assert.equal(XFrameOptions._resolveValue('SameOrigin'), 'SAMEORIGIN');
    });

    it('throws on non-string value (number)', function () {
        assert.throws(function () { XFrameOptions._resolveValue(42); }, /must be a string/);
    });

    it('throws on non-string value (object)', function () {
        assert.throws(function () { XFrameOptions._resolveValue({ v: 'DENY' }); }, /must be a string/);
    });

    it('throws on legacy "ALLOW-FROM https://example.com"', function () {
        assert.throws(function () {
            XFrameOptions._resolveValue('ALLOW-FROM https://example.com');
        }, /ALLOW-FROM/);
    });

    it('throws on bare "ALLOW-FROM" with no URI', function () {
        assert.throws(function () { XFrameOptions._resolveValue('ALLOW-FROM'); }, /ALLOW-FROM/);
    });

    it('ALLOW-FROM rejection message points at CSP frame-ancestors', function () {
        try {
            XFrameOptions._resolveValue('ALLOW-FROM https://example.com');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/frame-ancestors/.test(err.message), 'expected frame-ancestors hint');
            assert.ok(/Content-Security-Policy/.test(err.message), 'expected CSP reference');
        }
    });

    it('throws on unknown value with clear error', function () {
        try {
            XFrameOptions._resolveValue('NOPE');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/invalid value/.test(err.message),    'expected "invalid value" prefix');
            assert.ok(/DENY/.test(err.message),             'expected DENY listed in message');
            assert.ok(/SAMEORIGIN/.test(err.message),       'expected SAMEORIGIN listed in message');
        }
    });

    it('throws on close-but-invalid "ALLOW-ALL"', function () {
        assert.throws(function () { XFrameOptions._resolveValue('ALLOW-ALL'); }, /invalid value/);
    });

});


// ─── 05 — Factory + middleware end-to-end ──────────────────────────────────

describe('05 - Factory + middleware behaviour', function () {

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
        var mw = XFrameOptions();
        assert.equal(typeof mw, 'function');
    });

    it('factory uses SAMEORIGIN by default', function () {
        var mw  = XFrameOptions();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'SAMEORIGIN');
    });

    it('factory accepts { value: "DENY" }', function () {
        var mw  = XFrameOptions({ value: 'DENY' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'DENY');
    });

    it('factory throws on { value: "ALLOW-FROM https://x.com" }', function () {
        assert.throws(function () {
            XFrameOptions({ value: 'ALLOW-FROM https://x.com' });
        }, /ALLOW-FROM/);
    });

    it('factory throws on { value: "NOPE" }', function () {
        assert.throws(function () { XFrameOptions({ value: 'NOPE' }); }, /invalid value/);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = XFrameOptions();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing x-frame-options header set upstream', function () {
        var mw  = XFrameOptions({ value: 'DENY' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-frame-options': 'SAMEORIGIN' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('x-frame-options'), 'SAMEORIGIN');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = XFrameOptions({ value: 'DENY' });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'DENY');
    });

    it('works on HEAD requests', function () {
        var mw  = XFrameOptions();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'SAMEORIGIN');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = XFrameOptions({ value: 'DENY' });
        var mw2 = XFrameOptions({ value: 'SAMEORIGIN' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'DENY');
    });

});


// ─── 06 — Plugin registration in core/plugins/index.js ─────────────────────

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('XFrameOptions is wired to ./lib/x-frame-options', function () {
        assert.ok(
            /XFrameOptions\s*:\s*_require\(\s*['"]\.\/lib\/x-frame-options['"]\s*\)/.test(src),
            'expected XFrameOptions registry entry'
        );
    });

    it('#HDR2 marker comment is present', function () {
        assert.ok(
            /#HDR2[^\n]*X-Frame-Options/.test(src),
            'expected #HDR2 marker comment naming X-Frame-Options'
        );
    });

});


// ─── 07 — Settings template advertises the slot + boilerplate ──────────────

describe('07 - settings.json template advertises xFrameOptions slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('xFrameOptions key is present with default value', function () {
        assert.ok(
            /"xFrameOptions"\s*:\s*\{[\s\S]*?"value"\s*:\s*"SAMEORIGIN"/.test(src),
            'expected "xFrameOptions": { "value": "SAMEORIGIN" } block in settings template'
        );
    });

    it('#HDR2 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR2[^\n]*X-Frame-Options/.test(src),
            'expected #HDR2 marker comment before the xFrameOptions block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.XFrameOptions\(\)/.test(BP),
            'expected XFrameOptions adoption example in bundle boilerplate'
        );
    });

});
