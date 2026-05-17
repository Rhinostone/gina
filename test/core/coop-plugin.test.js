'use strict';
/**
 * Cross-Origin-Opener-Policy plugin (#HDR13) tests
 *
 * Strategy — mirrors the #HDR3 ReferrerPolicy / #HDR6 Coep single-enum
 * test shape:
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
var PLUGIN = path.join(FW, 'core/plugins/lib/coop/src/main.js');

var Coop;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    Coop = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR13 marker is present', function () {
        assert.ok(src.indexOf('#HDR13') > -1, 'expected #HDR13 marker for traceability');
    });

    it('header name is cross-origin-opener-policy', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]cross-origin-opener-policy['"]/.test(src),
            'expected HEADER_NAME = cross-origin-opener-policy'
        );
    });

    it('all 4 W3C HTML spec tokens are listed in VALID_VALUES', function () {
        var tokens = [
            'same-origin',
            'same-origin-allow-popups',
            'noopener-allow-popups',
            'unsafe-none'
        ];
        for (var i = 0; i < tokens.length; i++) {
            assert.ok(
                new RegExp("['\"]" + tokens[i] + "['\"]").test(src),
                'expected token ' + tokens[i] + ' in VALID_VALUES'
            );
        }
    });

    it('default value is same-origin (matches helmet default + full isolation posture)', function () {
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

    it('reads settings.json > coop via content.settings.coop', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.coop/.test(src),
            'expected content.settings → coop read chain'
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

    it('returned middleware is a named function (ginaCoop) for stack traces', function () {
        assert.ok(
            /function\s+ginaCoop\s*\(/.test(src),
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
        var out = Coop._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no coop key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = Coop._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through coop block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { coop: { value: 'same-origin-allow-popups' } } } } }
            };
        };
        var out = Coop._resolveSettingsDefaults();
        assert.deepEqual(out, { value: 'same-origin-allow-popups' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = Coop._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = Coop._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = Coop._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = Coop._mergeOptions(undefined, { value: 'same-origin-allow-popups' });
        assert.deepEqual(out, { value: 'same-origin-allow-popups' });
    });

    it('caller overrides defaults for known keys', function () {
        var out = Coop._mergeOptions({ value: 'unsafe-none' }, { value: 'same-origin' });
        assert.deepEqual(out, { value: 'unsafe-none' });
    });

    it('caller adds keys not in defaults', function () {
        var out = Coop._mergeOptions({ extra: 'NEW' }, { value: 'same-origin' });
        assert.deepEqual(out, { value: 'same-origin', extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.value = 'same-origin-allow-popups';
        var out = Coop._mergeOptions(caller, { value: 'same-origin' });
        assert.deepEqual(out, { value: 'same-origin-allow-popups' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveValue: validation + lowercase normalisation ──────────────

describe('04 - _resolveValue: validation + lowercase normalisation', function () {

    it('returns same-origin when value is undefined', function () {
        assert.equal(Coop._resolveValue(undefined), 'same-origin');
    });

    it('returns the default when value is null', function () {
        assert.equal(Coop._resolveValue(null), 'same-origin');
    });

    it('returns the default when value is empty string', function () {
        assert.equal(Coop._resolveValue(''), 'same-origin');
    });

    it('accepts "same-origin"', function () {
        assert.equal(Coop._resolveValue('same-origin'), 'same-origin');
    });

    it('accepts "same-origin-allow-popups"', function () {
        assert.equal(
            Coop._resolveValue('same-origin-allow-popups'),
            'same-origin-allow-popups'
        );
    });

    it('accepts "noopener-allow-popups" (Chrome 119+ / Firefox 131+ spec addition)', function () {
        assert.equal(
            Coop._resolveValue('noopener-allow-popups'),
            'noopener-allow-popups'
        );
    });

    it('accepts "unsafe-none"', function () {
        assert.equal(Coop._resolveValue('unsafe-none'), 'unsafe-none');
    });

    it('normalises uppercase "SAME-ORIGIN" to lowercase same-origin', function () {
        assert.equal(Coop._resolveValue('SAME-ORIGIN'), 'same-origin');
    });

    it('normalises mixed-case "Same-Origin-Allow-Popups" to lowercase', function () {
        assert.equal(
            Coop._resolveValue('Same-Origin-Allow-Popups'),
            'same-origin-allow-popups'
        );
    });

    it('normalises mixed-case "Noopener-Allow-Popups" to lowercase', function () {
        assert.equal(
            Coop._resolveValue('Noopener-Allow-Popups'),
            'noopener-allow-popups'
        );
    });

    it('normalises mixed-case "Unsafe-None" to lowercase', function () {
        assert.equal(Coop._resolveValue('Unsafe-None'), 'unsafe-none');
    });

    it('throws on non-string value (number)', function () {
        assert.throws(function () { Coop._resolveValue(42); }, /must be a string/);
    });

    it('throws on non-string value (object)', function () {
        assert.throws(function () { Coop._resolveValue({ v: 'same-origin' }); }, /must be a string/);
    });

    it('throws on non-string value (boolean)', function () {
        assert.throws(function () { Coop._resolveValue(true); }, /must be a string/);
    });

    it('throws on unknown value with full token list in message', function () {
        try {
            Coop._resolveValue('nope');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/invalid value/.test(err.message),                'expected "invalid value" prefix');
            assert.ok(/same-origin/.test(err.message),                  'expected same-origin in token list');
            assert.ok(/same-origin-allow-popups/.test(err.message),     'expected same-origin-allow-popups');
            assert.ok(/noopener-allow-popups/.test(err.message),        'expected noopener-allow-popups');
            assert.ok(/unsafe-none/.test(err.message),                  'expected unsafe-none in token list');
        }
    });

    it('throws on close-but-invalid "same-site" (which is a CORP token, not COOP)', function () {
        assert.throws(function () {
            Coop._resolveValue('same-site');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "noopener" typo (missing -allow-popups)', function () {
        assert.throws(function () {
            Coop._resolveValue('noopener');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "allow-popups" typo (missing same-origin- prefix)', function () {
        assert.throws(function () {
            Coop._resolveValue('allow-popups');
        }, /invalid value/);
    });

    it('error message points at the W3C HTML spec', function () {
        try {
            Coop._resolveValue('bogus-token');
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
        var mw = Coop();
        assert.equal(typeof mw, 'function');
    });

    it('factory uses same-origin by default', function () {
        var mw  = Coop();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-opener-policy'), 'same-origin');
    });

    it('factory accepts { value: "same-origin-allow-popups" }', function () {
        var mw  = Coop({ value: 'same-origin-allow-popups' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(
            res.getHeader('cross-origin-opener-policy'),
            'same-origin-allow-popups'
        );
    });

    it('factory accepts { value: "noopener-allow-popups" }', function () {
        var mw  = Coop({ value: 'noopener-allow-popups' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(
            res.getHeader('cross-origin-opener-policy'),
            'noopener-allow-popups'
        );
    });

    it('factory accepts { value: "unsafe-none" }', function () {
        var mw  = Coop({ value: 'unsafe-none' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-opener-policy'), 'unsafe-none');
    });

    it('factory accepts uppercase value and emits normalised lowercase', function () {
        var mw  = Coop({ value: 'NOOPENER-ALLOW-POPUPS' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(
            res.getHeader('cross-origin-opener-policy'),
            'noopener-allow-popups'
        );
    });

    it('factory throws on { value: "nope" }', function () {
        assert.throws(function () { Coop({ value: 'nope' }); }, /invalid value/);
    });

    it('factory throws on { value: 42 }', function () {
        assert.throws(function () { Coop({ value: 42 }); }, /must be a string/);
    });

    it('factory throws on cross-policy confusion ("same-site" — a CORP token)', function () {
        assert.throws(function () { Coop({ value: 'same-site' }); }, /invalid value/);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = Coop();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing cross-origin-opener-policy header set upstream', function () {
        var mw  = Coop({ value: 'same-origin' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'cross-origin-opener-policy': 'unsafe-none' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('cross-origin-opener-policy'), 'unsafe-none');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = Coop({ value: 'same-origin-allow-popups' });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(
            res.getHeader('cross-origin-opener-policy'),
            'same-origin-allow-popups'
        );
    });

    it('works on HEAD requests', function () {
        var mw  = Coop();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-opener-policy'), 'same-origin');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = Coop({ value: 'same-origin' });
        var mw2 = Coop({ value: 'same-origin-allow-popups' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-opener-policy'), 'same-origin');
    });

});


// ─── 06 — Plugin registration in core/plugins/index.js ─────────────────────

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('Coop is wired to ./lib/coop', function () {
        assert.ok(
            /Coop\s*:\s*_require\(\s*['"]\.\/lib\/coop['"]\s*\)/.test(src),
            'expected Coop registry entry'
        );
    });

    it('#HDR13 marker comment is present', function () {
        assert.ok(
            /#HDR13[^\n]*Cross-Origin-Opener-Policy/.test(src),
            'expected #HDR13 marker comment naming Cross-Origin-Opener-Policy'
        );
    });

});


// ─── 07 — Settings template advertises the slot + boilerplate ──────────────

describe('07 - settings.json template advertises coop slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('coop key is present with default value', function () {
        assert.ok(
            /"coop"\s*:\s*\{[\s\S]*?"value"\s*:\s*"same-origin"/.test(src),
            'expected "coop": { "value": "same-origin" } block in settings template'
        );
    });

    it('#HDR13 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR13[^\n]*Cross-Origin-Opener-Policy/.test(src),
            'expected #HDR13 marker comment before the coop block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.Coop\(\)/.test(BP),
            'expected Coop adoption example in bundle boilerplate'
        );
    });

});
