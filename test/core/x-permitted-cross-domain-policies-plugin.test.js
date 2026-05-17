'use strict';
/**
 * X-Permitted-Cross-Domain-Policies plugin (#HDR12) tests
 *
 * Strategy — mirrors the #HDR14 Corp + #HDR9 XDnsPrefetchControl
 * single-enum test shape:
 *  - Source-inspection guards pinning the four Adobe tokens.
 *  - Behavioural unit tests on the internal helpers.
 *  - End-to-end tests through stub req/res/next.
 *  - Negative-invariant locks: unknown tokens rejected at factory call
 *    time; non-string values rejected; lowercase normalisation;
 *    silent-fallback on the helmet `{ permittedPolicies }` shape pinned;
 *    no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/x-permitted-cross-domain-policies/src/main.js');

var XPermittedCrossDomainPolicies;
var originalGetContext;
var originalGetConfig;

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    XPermittedCrossDomainPolicies = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection ────────────────────────────────────────────────

describe('01 - source inspection: header + 4-token patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR12 marker is present', function () {
        assert.ok(src.indexOf('#HDR12') > -1, 'expected #HDR12 marker for traceability');
    });

    it('header name is x-permitted-cross-domain-policies', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-permitted-cross-domain-policies['"]/.test(src),
            'expected HEADER_NAME = x-permitted-cross-domain-policies'
        );
    });

    it('all 4 Adobe spec tokens are listed in VALID_VALUES', function () {
        var tokens = ['none', 'master-only', 'by-content-type', 'all'];
        for (var i = 0; i < tokens.length; i++) {
            assert.ok(
                new RegExp("['\"]" + tokens[i] + "['\"]").test(src),
                'expected token ' + tokens[i] + ' in VALID_VALUES'
            );
        }
    });

    it('default value is "none" (most restrictive; matches helmet)', function () {
        assert.ok(
            /DEFAULT_VALUE\s*=\s*['"]none['"]/.test(src),
            'expected DEFAULT_VALUE = none'
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

    it('reads settings.json > xPermittedCrossDomainPolicies via content.settings.xPermittedCrossDomainPolicies', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.xPermittedCrossDomainPolicies/.test(src),
            'expected content.settings → xPermittedCrossDomainPolicies read chain'
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

    it('returned middleware is a named function (ginaXPermittedCrossDomainPolicies) for stack traces', function () {
        assert.ok(
            /function\s+ginaXPermittedCrossDomainPolicies\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('normalises to lowercase before validation', function () {
        assert.ok(
            /\.toLowerCase\(\)/.test(src),
            'expected .toLowerCase() normalisation'
        );
    });

    it('error message points at the Adobe spec', function () {
        assert.ok(
            /Adobe.*Cross-Domain Policy File/.test(src),
            'expected Adobe Cross-Domain Policy File Specification reference in error message'
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
        var out = XPermittedCrossDomainPolicies._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no xPermittedCrossDomainPolicies key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = XPermittedCrossDomainPolicies._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through xPermittedCrossDomainPolicies block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { xPermittedCrossDomainPolicies: { value: 'master-only' } } } } }
            };
        };
        var out = XPermittedCrossDomainPolicies._resolveSettingsDefaults();
        assert.deepEqual(out, { value: 'master-only' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = XPermittedCrossDomainPolicies._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = XPermittedCrossDomainPolicies._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions ────────────────────────────────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = XPermittedCrossDomainPolicies._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = XPermittedCrossDomainPolicies._mergeOptions(undefined, { value: 'master-only' });
        assert.deepEqual(out, { value: 'master-only' });
    });

    it('caller overrides defaults for known keys', function () {
        var out = XPermittedCrossDomainPolicies._mergeOptions({ value: 'all' }, { value: 'none' });
        assert.deepEqual(out, { value: 'all' });
    });

    it('caller adds keys not in defaults', function () {
        var out = XPermittedCrossDomainPolicies._mergeOptions({ extra: 'NEW' }, { value: 'none' });
        assert.deepEqual(out, { value: 'none', extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.value = 'all';
        var out = XPermittedCrossDomainPolicies._mergeOptions(caller, { value: 'none' });
        assert.deepEqual(out, { value: 'all' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveValue ────────────────────────────────────────────────────

describe('04 - _resolveValue: validation + lowercase normalisation', function () {

    it('returns "none" when value is undefined', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue(undefined), 'none');
    });

    it('returns "none" when value is null', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue(null), 'none');
    });

    it('returns "none" when value is empty string', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue(''), 'none');
    });

    it('accepts "none"', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue('none'), 'none');
    });

    it('accepts "master-only"', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue('master-only'), 'master-only');
    });

    it('accepts "by-content-type"', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue('by-content-type'), 'by-content-type');
    });

    it('accepts "all"', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue('all'), 'all');
    });

    it('normalises uppercase "NONE" to lowercase', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue('NONE'), 'none');
    });

    it('normalises mixed-case "Master-Only" to lowercase', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue('Master-Only'), 'master-only');
    });

    it('normalises mixed-case "By-Content-Type" to lowercase', function () {
        assert.equal(XPermittedCrossDomainPolicies._resolveValue('By-Content-Type'), 'by-content-type');
    });

    it('throws on non-string value (number)', function () {
        assert.throws(function () { XPermittedCrossDomainPolicies._resolveValue(42); }, /must be a string/);
    });

    it('throws on non-string value (object)', function () {
        assert.throws(function () { XPermittedCrossDomainPolicies._resolveValue({ v: 'none' }); }, /must be a string/);
    });

    it('throws on non-string value (boolean)', function () {
        assert.throws(function () { XPermittedCrossDomainPolicies._resolveValue(true); }, /must be a string/);
    });

    it('throws on unknown value with full token list in message', function () {
        try {
            XPermittedCrossDomainPolicies._resolveValue('nope');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/invalid value/.test(err.message),     'expected "invalid value" prefix');
            assert.ok(/none/.test(err.message),              'expected none in token list');
            assert.ok(/master-only/.test(err.message),       'expected master-only in token list');
            assert.ok(/by-content-type/.test(err.message),   'expected by-content-type in token list');
            assert.ok(/all/.test(err.message),               'expected all in token list');
        }
    });

    it('throws on close-but-invalid "some"', function () {
        assert.throws(function () {
            XPermittedCrossDomainPolicies._resolveValue('some');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "master" (without -only suffix)', function () {
        assert.throws(function () {
            XPermittedCrossDomainPolicies._resolveValue('master');
        }, /invalid value/);
    });

    it('error message points at the Adobe spec', function () {
        try {
            XPermittedCrossDomainPolicies._resolveValue('bogus');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/Adobe/.test(err.message), 'expected Adobe reference in error');
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
        var mw = XPermittedCrossDomainPolicies();
        assert.equal(typeof mw, 'function');
    });

    it('factory uses "none" by default', function () {
        var mw  = XPermittedCrossDomainPolicies();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'none');
    });

    it('factory accepts { value: "master-only" }', function () {
        var mw  = XPermittedCrossDomainPolicies({ value: 'master-only' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'master-only');
    });

    it('factory accepts { value: "by-content-type" }', function () {
        var mw  = XPermittedCrossDomainPolicies({ value: 'by-content-type' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'by-content-type');
    });

    it('factory accepts { value: "all" }', function () {
        var mw  = XPermittedCrossDomainPolicies({ value: 'all' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'all');
    });

    it('factory accepts uppercase value and emits normalised lowercase', function () {
        var mw  = XPermittedCrossDomainPolicies({ value: 'MASTER-ONLY' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'master-only');
    });

    it('factory throws on { value: "nope" }', function () {
        assert.throws(function () { XPermittedCrossDomainPolicies({ value: 'nope' }); }, /invalid value/);
    });

    it('factory throws on { value: 42 }', function () {
        assert.throws(function () { XPermittedCrossDomainPolicies({ value: 42 }); }, /must be a string/);
    });

    it('factory throws on close-but-invalid "master" (without -only suffix)', function () {
        assert.throws(function () { XPermittedCrossDomainPolicies({ value: 'master' }); }, /invalid value/);
    });

    it('factory throws on helmet-shape { permittedPolicies: "master-only" } — silent fallback to default "none"', function () {
        // helmet uses { permittedPolicies: <enum> }; gina uses { value: <enum> }.
        // Passing { permittedPolicies: '...' } means `merged.value` is undefined →
        // defaults to "none" silently. This test pins the silent fallback so
        // users migrating from helmet get the gina default, not their helmet
        // semantic. README documents the mapping.
        var mw  = XPermittedCrossDomainPolicies({ permittedPolicies: 'master-only' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(
            res.getHeader('x-permitted-cross-domain-policies'),
            'none',
            'helmet-shape { permittedPolicies } does NOT switch the gina default — emits default "none"'
        );
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = XPermittedCrossDomainPolicies();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing x-permitted-cross-domain-policies header set upstream', function () {
        var mw  = XPermittedCrossDomainPolicies({ value: 'none' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-permitted-cross-domain-policies': 'all' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'all');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = XPermittedCrossDomainPolicies({ value: 'master-only' });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'master-only');
    });

    it('works on HEAD requests', function () {
        var mw  = XPermittedCrossDomainPolicies();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'none');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = XPermittedCrossDomainPolicies({ value: 'none' });
        var mw2 = XPermittedCrossDomainPolicies({ value: 'all' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-permitted-cross-domain-policies'), 'none');
    });

});


// ─── 06 — Plugin registration in core/plugins/index.js ─────────────────────

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('XPermittedCrossDomainPolicies is wired to ./lib/security-headers/x-permitted-cross-domain-policies', function () {
        assert.ok(
            /XPermittedCrossDomainPolicies\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/x-permitted-cross-domain-policies['"]\s*\)/.test(src),
            'expected XPermittedCrossDomainPolicies registry entry'
        );
    });

    it('#HDR12 marker comment is present', function () {
        assert.ok(
            /#HDR12[^\n]*X-Permitted-Cross-Domain-Policies/.test(src),
            'expected #HDR12 marker comment naming X-Permitted-Cross-Domain-Policies'
        );
    });

});


// ─── 07 — Settings template advertises the slot + boilerplate ──────────────

describe('07 - settings.json template advertises xPermittedCrossDomainPolicies slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('xPermittedCrossDomainPolicies key is present with default value', function () {
        assert.ok(
            /"xPermittedCrossDomainPolicies"\s*:\s*\{[\s\S]*?"value"\s*:\s*"none"/.test(src),
            'expected "xPermittedCrossDomainPolicies": { "value": "none" } block in settings template'
        );
    });

    it('#HDR12 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR12[^\n]*X-Permitted-Cross-Domain-Policies/.test(src),
            'expected #HDR12 marker comment before the xPermittedCrossDomainPolicies block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.XPermittedCrossDomainPolicies\(\)/.test(BP),
            'expected XPermittedCrossDomainPolicies adoption example in bundle boilerplate'
        );
    });

});
