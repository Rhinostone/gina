'use strict';
/**
 * X-DNS-Prefetch-Control plugin (#HDR9) tests
 *
 * Strategy — mirrors the #HDR14 Corp single-enum test shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults, _resolveValue) — no framework boot.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract.
 *  - Negative-invariant locks: unknown tokens rejected at factory call
 *    time with the full token list in the message; non-string values
 *    rejected; lowercase normalisation; no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/x-dns-prefetch-control/src/main.js');

var XDnsPrefetchControl;
var originalGetContext;
var originalGetConfig;

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    XDnsPrefetchControl = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection ────────────────────────────────────────────────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR9 marker is present', function () {
        assert.ok(src.indexOf('#HDR9') > -1, 'expected #HDR9 marker for traceability');
    });

    it('header name is x-dns-prefetch-control', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-dns-prefetch-control['"]/.test(src),
            'expected HEADER_NAME = x-dns-prefetch-control'
        );
    });

    it('both valid tokens are listed in VALID_VALUES', function () {
        var tokens = ['on', 'off'];
        for (var i = 0; i < tokens.length; i++) {
            assert.ok(
                new RegExp("['\"]" + tokens[i] + "['\"]").test(src),
                'expected token ' + tokens[i] + ' in VALID_VALUES'
            );
        }
    });

    it('default value is "off" (matches helmet default + privacy-respecting choice)', function () {
        assert.ok(
            /DEFAULT_VALUE\s*=\s*['"]off['"]/.test(src),
            'expected DEFAULT_VALUE = off'
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

    it('reads settings.json > xDnsPrefetchControl via content.settings.xDnsPrefetchControl', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.xDnsPrefetchControl/.test(src),
            'expected content.settings → xDnsPrefetchControl read chain'
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

    it('returned middleware is a named function (ginaXDnsPrefetchControl) for stack traces', function () {
        assert.ok(
            /function\s+ginaXDnsPrefetchControl\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('normalises to lowercase before validation', function () {
        assert.ok(
            /\.toLowerCase\(\)/.test(src),
            'expected .toLowerCase() normalisation'
        );
    });

    it('error message points at the MDN reference', function () {
        assert.ok(
            /developer\.mozilla\.org.*X-DNS-Prefetch-Control/.test(src),
            'expected MDN reference URL in error message'
        );
    });

    it('no eval, no Function constructor', function () {
        assert.ok(!/\beval\s*\(/.test(src),         'no eval(...) allowed');
        assert.ok(!/new\s+Function\s*\(/.test(src), 'no new Function(...) allowed');
    });

});


// ─── 02 — _resolveSettingsDefaults ─────────────────────────────────────────

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
        var out = XDnsPrefetchControl._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no xDnsPrefetchControl key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = XDnsPrefetchControl._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through xDnsPrefetchControl block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { xDnsPrefetchControl: { value: 'on' } } } } }
            };
        };
        var out = XDnsPrefetchControl._resolveSettingsDefaults();
        assert.deepEqual(out, { value: 'on' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = XDnsPrefetchControl._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = XDnsPrefetchControl._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions ────────────────────────────────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = XDnsPrefetchControl._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = XDnsPrefetchControl._mergeOptions(undefined, { value: 'on' });
        assert.deepEqual(out, { value: 'on' });
    });

    it('caller overrides defaults for known keys', function () {
        var out = XDnsPrefetchControl._mergeOptions({ value: 'on' }, { value: 'off' });
        assert.deepEqual(out, { value: 'on' });
    });

    it('caller adds keys not in defaults', function () {
        var out = XDnsPrefetchControl._mergeOptions({ extra: 'NEW' }, { value: 'off' });
        assert.deepEqual(out, { value: 'off', extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.value = 'on';
        var out = XDnsPrefetchControl._mergeOptions(caller, { value: 'off' });
        assert.deepEqual(out, { value: 'on' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveValue ────────────────────────────────────────────────────

describe('04 - _resolveValue: validation + lowercase normalisation', function () {

    it('returns "off" when value is undefined', function () {
        assert.equal(XDnsPrefetchControl._resolveValue(undefined), 'off');
    });

    it('returns "off" when value is null', function () {
        assert.equal(XDnsPrefetchControl._resolveValue(null), 'off');
    });

    it('returns "off" when value is empty string', function () {
        assert.equal(XDnsPrefetchControl._resolveValue(''), 'off');
    });

    it('accepts "on"', function () {
        assert.equal(XDnsPrefetchControl._resolveValue('on'), 'on');
    });

    it('accepts "off"', function () {
        assert.equal(XDnsPrefetchControl._resolveValue('off'), 'off');
    });

    it('normalises uppercase "ON" to lowercase', function () {
        assert.equal(XDnsPrefetchControl._resolveValue('ON'), 'on');
    });

    it('normalises uppercase "OFF" to lowercase', function () {
        assert.equal(XDnsPrefetchControl._resolveValue('OFF'), 'off');
    });

    it('normalises mixed-case "On" to lowercase', function () {
        assert.equal(XDnsPrefetchControl._resolveValue('On'), 'on');
    });

    it('throws on non-string value (number)', function () {
        assert.throws(function () { XDnsPrefetchControl._resolveValue(42); }, /must be a string/);
    });

    it('throws on non-string value (object)', function () {
        assert.throws(function () { XDnsPrefetchControl._resolveValue({ v: 'on' }); }, /must be a string/);
    });

    it('throws on non-string value (boolean true)', function () {
        // Even though helmet uses `{ allow: true }`, gina uses `{ value: 'on' }`.
        // Passing a boolean should fail-fast at factory call time to surface
        // the API-shape mismatch — helps users migrating from helmet.
        assert.throws(function () { XDnsPrefetchControl._resolveValue(true); }, /must be a string/);
    });

    it('throws on non-string value (boolean false)', function () {
        assert.throws(function () { XDnsPrefetchControl._resolveValue(false); }, /must be a string/);
    });

    it('throws on unknown value with full token list in message', function () {
        try {
            XDnsPrefetchControl._resolveValue('nope');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/invalid value/.test(err.message), 'expected "invalid value" prefix');
            assert.ok(/on/.test(err.message),            'expected "on" in token list');
            assert.ok(/off/.test(err.message),           'expected "off" in token list');
        }
    });

    it('throws on close-but-invalid "enabled"', function () {
        assert.throws(function () {
            XDnsPrefetchControl._resolveValue('enabled');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "disabled"', function () {
        assert.throws(function () {
            XDnsPrefetchControl._resolveValue('disabled');
        }, /invalid value/);
    });

    it('error message points at the MDN reference', function () {
        try {
            XDnsPrefetchControl._resolveValue('bogus');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/developer\.mozilla\.org/.test(err.message), 'expected MDN reference URL');
        }
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
        var mw = XDnsPrefetchControl();
        assert.equal(typeof mw, 'function');
    });

    it('factory uses "off" by default', function () {
        var mw  = XDnsPrefetchControl();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'off');
    });

    it('factory accepts { value: "on" }', function () {
        var mw  = XDnsPrefetchControl({ value: 'on' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'on');
    });

    it('factory accepts { value: "off" }', function () {
        var mw  = XDnsPrefetchControl({ value: 'off' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'off');
    });

    it('factory accepts uppercase value and emits normalised lowercase', function () {
        var mw  = XDnsPrefetchControl({ value: 'ON' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'on');
    });

    it('factory throws on { value: "nope" }', function () {
        assert.throws(function () { XDnsPrefetchControl({ value: 'nope' }); }, /invalid value/);
    });

    it('factory throws on { value: 42 }', function () {
        assert.throws(function () { XDnsPrefetchControl({ value: 42 }); }, /must be a string/);
    });

    it('factory throws on helmet-shape { allow: true } — surfaces API mismatch', function () {
        // helmet uses { allow: boolean }; gina uses { value: 'on' | 'off' }.
        // Passing { allow: true } means `merged.value` is undefined → defaults
        // to "off" silently. This test pins the silent fallback: users
        // migrating from helmet will get the gina default, not their helmet
        // semantic. README documents the mapping.
        var mw  = XDnsPrefetchControl({ allow: true });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(
            res.getHeader('x-dns-prefetch-control'),
            'off',
            'helmet-shape { allow: true } does NOT enable DNS prefetching in gina — emits default "off"'
        );
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = XDnsPrefetchControl();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing x-dns-prefetch-control header set upstream', function () {
        var mw  = XDnsPrefetchControl({ value: 'off' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-dns-prefetch-control': 'on' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'on');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = XDnsPrefetchControl({ value: 'on' });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'on');
    });

    it('works on HEAD requests', function () {
        var mw  = XDnsPrefetchControl();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'off');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = XDnsPrefetchControl({ value: 'off' });
        var mw2 = XDnsPrefetchControl({ value: 'on' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-dns-prefetch-control'), 'off');
    });

});


// ─── 06 — Plugin registration in core/plugins/index.js ─────────────────────

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('XDnsPrefetchControl is wired to ./lib/security-headers/x-dns-prefetch-control', function () {
        assert.ok(
            /XDnsPrefetchControl\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/x-dns-prefetch-control['"]\s*\)/.test(src),
            'expected XDnsPrefetchControl registry entry'
        );
    });

    it('#HDR9 marker comment is present', function () {
        assert.ok(
            /#HDR9[^\n]*X-DNS-Prefetch-Control/.test(src),
            'expected #HDR9 marker comment naming X-DNS-Prefetch-Control'
        );
    });

});


// ─── 07 — Settings template advertises the slot + boilerplate ──────────────

describe('07 - settings.json template advertises xDnsPrefetchControl slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('xDnsPrefetchControl key is present with default value', function () {
        assert.ok(
            /"xDnsPrefetchControl"\s*:\s*\{[\s\S]*?"value"\s*:\s*"off"/.test(src),
            'expected "xDnsPrefetchControl": { "value": "off" } block in settings template'
        );
    });

    it('#HDR9 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR9[^\n]*X-DNS-Prefetch-Control/.test(src),
            'expected #HDR9 marker comment before the xDnsPrefetchControl block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.XDnsPrefetchControl\(\)/.test(BP),
            'expected XDnsPrefetchControl adoption example in bundle boilerplate'
        );
    });

});
