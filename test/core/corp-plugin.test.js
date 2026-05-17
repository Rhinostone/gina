'use strict';
/**
 * Cross-Origin-Resource-Policy plugin (#HDR14) tests
 *
 * Strategy — mirrors the #HDR6 Coep / #HDR13 Coop single-enum test
 * shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults, _resolveValue) — no framework boot required.
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
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/corp/src/main.js');

var Corp;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    Corp = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR14 marker is present', function () {
        assert.ok(src.indexOf('#HDR14') > -1, 'expected #HDR14 marker for traceability');
    });

    it('header name is cross-origin-resource-policy', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]cross-origin-resource-policy['"]/.test(src),
            'expected HEADER_NAME = cross-origin-resource-policy'
        );
    });

    it('all 3 W3C HTML spec tokens are listed in VALID_VALUES', function () {
        var tokens = ['same-origin', 'same-site', 'cross-origin'];
        for (var i = 0; i < tokens.length; i++) {
            assert.ok(
                new RegExp("['\"]" + tokens[i] + "['\"]").test(src),
                'expected token ' + tokens[i] + ' in VALID_VALUES'
            );
        }
    });

    it('default value is same-origin (matches helmet default + most restrictive posture)', function () {
        assert.ok(
            /DEFAULT_VALUE\s*=\s*['"]same-origin['"]/.test(src),
            'expected DEFAULT_VALUE = same-origin'
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

    it('reads settings.json > corp via content.settings.corp', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.corp/.test(src),
            'expected content.settings → corp read chain'
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

    it('returned middleware is a named function (ginaCorp) for stack traces', function () {
        assert.ok(
            /function\s+ginaCorp\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('normalises to lowercase before validation', function () {
        assert.ok(
            /\.toLowerCase\(\)/.test(src),
            'expected .toLowerCase() normalisation'
        );
    });

    it('error message points at W3C HTML spec', function () {
        assert.ok(
            /html\.spec\.whatwg\.org/.test(src),
            'expected W3C HTML spec URL in error message'
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
        var out = Corp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no corp key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = Corp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through corp block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { corp: { value: 'cross-origin' } } } } }
            };
        };
        var out = Corp._resolveSettingsDefaults();
        assert.deepEqual(out, { value: 'cross-origin' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = Corp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = Corp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = Corp._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = Corp._mergeOptions(undefined, { value: 'same-site' });
        assert.deepEqual(out, { value: 'same-site' });
    });

    it('caller overrides defaults for known keys', function () {
        var out = Corp._mergeOptions({ value: 'cross-origin' }, { value: 'same-origin' });
        assert.deepEqual(out, { value: 'cross-origin' });
    });

    it('caller adds keys not in defaults', function () {
        var out = Corp._mergeOptions({ extra: 'NEW' }, { value: 'same-origin' });
        assert.deepEqual(out, { value: 'same-origin', extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.value = 'cross-origin';
        var out = Corp._mergeOptions(caller, { value: 'same-origin' });
        assert.deepEqual(out, { value: 'cross-origin' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveValue: validation + lowercase normalisation ──────────────

describe('04 - _resolveValue: validation + lowercase normalisation', function () {

    it('returns same-origin when value is undefined', function () {
        assert.equal(Corp._resolveValue(undefined), 'same-origin');
    });

    it('returns the default when value is null', function () {
        assert.equal(Corp._resolveValue(null), 'same-origin');
    });

    it('returns the default when value is empty string', function () {
        assert.equal(Corp._resolveValue(''), 'same-origin');
    });

    it('accepts "same-origin"', function () {
        assert.equal(Corp._resolveValue('same-origin'), 'same-origin');
    });

    it('accepts "same-site"', function () {
        assert.equal(Corp._resolveValue('same-site'), 'same-site');
    });

    it('accepts "cross-origin"', function () {
        assert.equal(Corp._resolveValue('cross-origin'), 'cross-origin');
    });

    it('normalises uppercase "SAME-ORIGIN" to lowercase same-origin', function () {
        assert.equal(Corp._resolveValue('SAME-ORIGIN'), 'same-origin');
    });

    it('normalises mixed-case "Same-Site" to lowercase', function () {
        assert.equal(Corp._resolveValue('Same-Site'), 'same-site');
    });

    it('normalises mixed-case "Cross-Origin" to lowercase', function () {
        assert.equal(Corp._resolveValue('Cross-Origin'), 'cross-origin');
    });

    it('throws on non-string value (number)', function () {
        assert.throws(function () { Corp._resolveValue(42); }, /must be a string/);
    });

    it('throws on non-string value (object)', function () {
        assert.throws(function () { Corp._resolveValue({ v: 'same-origin' }); }, /must be a string/);
    });

    it('throws on non-string value (boolean)', function () {
        assert.throws(function () { Corp._resolveValue(true); }, /must be a string/);
    });

    it('throws on unknown value with full token list in message', function () {
        try {
            Corp._resolveValue('nope');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/invalid value/.test(err.message),    'expected "invalid value" prefix');
            assert.ok(/same-origin/.test(err.message),      'expected same-origin in token list');
            assert.ok(/same-site/.test(err.message),        'expected same-site in token list');
            assert.ok(/cross-origin/.test(err.message),     'expected cross-origin in token list');
        }
    });

    it('throws on close-but-invalid "require-corp" (which is a COEP token, not CORP)', function () {
        assert.throws(function () {
            Corp._resolveValue('require-corp');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "noopener-allow-popups" (which is a COOP token, not CORP)', function () {
        assert.throws(function () {
            Corp._resolveValue('noopener-allow-popups');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "unsafe-none" (which is a COEP/COOP token, not CORP)', function () {
        assert.throws(function () {
            Corp._resolveValue('unsafe-none');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "credentialless" (which is a COEP token, not CORP)', function () {
        assert.throws(function () {
            Corp._resolveValue('credentialless');
        }, /invalid value/);
    });

    it('error message points at the W3C HTML spec', function () {
        try {
            Corp._resolveValue('bogus-token');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/html\.spec\.whatwg\.org/.test(err.message), 'expected W3C HTML spec URL');
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
        var mw = Corp();
        assert.equal(typeof mw, 'function');
    });

    it('factory uses same-origin by default', function () {
        var mw  = Corp();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'same-origin');
    });

    it('factory accepts { value: "same-site" }', function () {
        var mw  = Corp({ value: 'same-site' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'same-site');
    });

    it('factory accepts { value: "cross-origin" }', function () {
        var mw  = Corp({ value: 'cross-origin' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'cross-origin');
    });

    it('factory accepts uppercase value and emits normalised lowercase', function () {
        var mw  = Corp({ value: 'CROSS-ORIGIN' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'cross-origin');
    });

    it('factory throws on { value: "nope" }', function () {
        assert.throws(function () { Corp({ value: 'nope' }); }, /invalid value/);
    });

    it('factory throws on { value: 42 }', function () {
        assert.throws(function () { Corp({ value: 42 }); }, /must be a string/);
    });

    it('factory throws on cross-policy confusion ("require-corp" — a COEP token)', function () {
        assert.throws(function () { Corp({ value: 'require-corp' }); }, /invalid value/);
    });

    it('factory throws on cross-policy confusion ("unsafe-none" — a COEP/COOP token)', function () {
        assert.throws(function () { Corp({ value: 'unsafe-none' }); }, /invalid value/);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = Corp();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing cross-origin-resource-policy header set upstream', function () {
        var mw  = Corp({ value: 'same-origin' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'cross-origin-resource-policy': 'cross-origin' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'cross-origin');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = Corp({ value: 'cross-origin' });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'cross-origin');
    });

    it('works on HEAD requests', function () {
        var mw  = Corp();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'same-origin');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = Corp({ value: 'same-origin' });
        var mw2 = Corp({ value: 'cross-origin' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'same-origin');
    });

});


// ─── 06 — Plugin registration in core/plugins/index.js ─────────────────────

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('Corp is wired to ./lib/security-headers/corp', function () {
        assert.ok(
            /Corp\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/corp['"]\s*\)/.test(src),
            'expected Corp registry entry'
        );
    });

    it('#HDR14 marker comment is present', function () {
        assert.ok(
            /#HDR14[^\n]*Cross-Origin-Resource-Policy/.test(src),
            'expected #HDR14 marker comment naming Cross-Origin-Resource-Policy'
        );
    });

});


// ─── 07 — Settings template advertises the slot + boilerplate ──────────────

describe('07 - settings.json template advertises corp slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('corp key is present with default value', function () {
        assert.ok(
            /"corp"\s*:\s*\{[\s\S]*?"value"\s*:\s*"same-origin"/.test(src),
            'expected "corp": { "value": "same-origin" } block in settings template'
        );
    });

    it('#HDR14 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR14[^\n]*Cross-Origin-Resource-Policy/.test(src),
            'expected #HDR14 marker comment before the corp block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.Corp\(\)/.test(BP),
            'expected Corp adoption example in bundle boilerplate'
        );
    });

});
