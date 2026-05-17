'use strict';
/**
 * Referrer-Policy plugin (#HDR3) tests
 *
 * Strategy — mirrors the #HDR1 / #HDR2 plugin test shape:
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
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/referrer-policy/src/main.js');

var ReferrerPolicy;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    ReferrerPolicy = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR3 marker is present', function () {
        assert.ok(src.indexOf('#HDR3') > -1, 'expected #HDR3 marker for traceability');
    });

    it('header name is referrer-policy', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]referrer-policy['"]/.test(src),
            'expected HEADER_NAME = referrer-policy'
        );
    });

    it('all 8 W3C tokens are listed in VALID_VALUES', function () {
        var tokens = [
            'no-referrer',
            'no-referrer-when-downgrade',
            'origin',
            'origin-when-cross-origin',
            'same-origin',
            'strict-origin',
            'strict-origin-when-cross-origin',
            'unsafe-url'
        ];
        for (var i = 0; i < tokens.length; i++) {
            assert.ok(
                new RegExp("['\"]" + tokens[i].replace(/-/g, '-') + "['\"]").test(src),
                'expected token ' + tokens[i] + ' in VALID_VALUES'
            );
        }
    });

    it('default value is strict-origin-when-cross-origin (browser default since ~2021)', function () {
        assert.ok(
            /DEFAULT_VALUE\s*=\s*['"]strict-origin-when-cross-origin['"]/.test(src),
            'expected DEFAULT_VALUE = strict-origin-when-cross-origin'
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

    it('reads settings.json > referrerPolicy via content.settings.referrerPolicy', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.referrerPolicy/.test(src),
            'expected content.settings → referrerPolicy read chain'
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

    it('returned middleware is a named function (ginaReferrerPolicy) for stack traces', function () {
        assert.ok(
            /function\s+ginaReferrerPolicy\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('normalises to lowercase before validation', function () {
        assert.ok(
            /\.toLowerCase\(\)/.test(src),
            'expected .toLowerCase() normalisation'
        );
    });

    it('error message points at W3C Referrer Policy spec', function () {
        assert.ok(
            /www\.w3\.org\/TR\/referrer-policy/.test(src),
            'expected W3C spec URL in error message'
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
        var out = ReferrerPolicy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no referrerPolicy key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = ReferrerPolicy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through referrerPolicy block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { referrerPolicy: { value: 'no-referrer' } } } } }
            };
        };
        var out = ReferrerPolicy._resolveSettingsDefaults();
        assert.deepEqual(out, { value: 'no-referrer' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = ReferrerPolicy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = ReferrerPolicy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = ReferrerPolicy._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = ReferrerPolicy._mergeOptions(undefined, { value: 'origin' });
        assert.deepEqual(out, { value: 'origin' });
    });

    it('caller overrides defaults for known keys', function () {
        var out = ReferrerPolicy._mergeOptions({ value: 'no-referrer' }, { value: 'origin' });
        assert.deepEqual(out, { value: 'no-referrer' });
    });

    it('caller adds keys not in defaults', function () {
        var out = ReferrerPolicy._mergeOptions({ extra: 'NEW' }, { value: 'origin' });
        assert.deepEqual(out, { value: 'origin', extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.value = 'no-referrer';
        var out = ReferrerPolicy._mergeOptions(caller, { value: 'origin' });
        assert.deepEqual(out, { value: 'no-referrer' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveValue: validation + lowercase normalisation ──────────────

describe('04 - _resolveValue: validation + lowercase normalisation', function () {

    it('returns strict-origin-when-cross-origin when value is undefined', function () {
        assert.equal(
            ReferrerPolicy._resolveValue(undefined),
            'strict-origin-when-cross-origin'
        );
    });

    it('returns the default when value is null', function () {
        assert.equal(
            ReferrerPolicy._resolveValue(null),
            'strict-origin-when-cross-origin'
        );
    });

    it('returns the default when value is empty string', function () {
        assert.equal(
            ReferrerPolicy._resolveValue(''),
            'strict-origin-when-cross-origin'
        );
    });

    it('accepts "no-referrer"', function () {
        assert.equal(ReferrerPolicy._resolveValue('no-referrer'), 'no-referrer');
    });

    it('accepts "no-referrer-when-downgrade"', function () {
        assert.equal(
            ReferrerPolicy._resolveValue('no-referrer-when-downgrade'),
            'no-referrer-when-downgrade'
        );
    });

    it('accepts "origin"', function () {
        assert.equal(ReferrerPolicy._resolveValue('origin'), 'origin');
    });

    it('accepts "origin-when-cross-origin"', function () {
        assert.equal(
            ReferrerPolicy._resolveValue('origin-when-cross-origin'),
            'origin-when-cross-origin'
        );
    });

    it('accepts "same-origin"', function () {
        assert.equal(ReferrerPolicy._resolveValue('same-origin'), 'same-origin');
    });

    it('accepts "strict-origin"', function () {
        assert.equal(ReferrerPolicy._resolveValue('strict-origin'), 'strict-origin');
    });

    it('accepts "strict-origin-when-cross-origin"', function () {
        assert.equal(
            ReferrerPolicy._resolveValue('strict-origin-when-cross-origin'),
            'strict-origin-when-cross-origin'
        );
    });

    it('accepts "unsafe-url"', function () {
        assert.equal(ReferrerPolicy._resolveValue('unsafe-url'), 'unsafe-url');
    });

    it('normalises uppercase "NO-REFERRER" to lowercase no-referrer', function () {
        assert.equal(ReferrerPolicy._resolveValue('NO-REFERRER'), 'no-referrer');
    });

    it('normalises mixed-case "Strict-Origin-When-Cross-Origin" to lowercase', function () {
        assert.equal(
            ReferrerPolicy._resolveValue('Strict-Origin-When-Cross-Origin'),
            'strict-origin-when-cross-origin'
        );
    });

    it('throws on non-string value (number)', function () {
        assert.throws(function () { ReferrerPolicy._resolveValue(42); }, /must be a string/);
    });

    it('throws on non-string value (object)', function () {
        assert.throws(function () { ReferrerPolicy._resolveValue({ v: 'origin' }); }, /must be a string/);
    });

    it('throws on unknown value with full token list in message', function () {
        try {
            ReferrerPolicy._resolveValue('nope');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/invalid value/.test(err.message),                'expected "invalid value" prefix');
            assert.ok(/no-referrer/.test(err.message),                  'expected no-referrer in token list');
            assert.ok(/strict-origin-when-cross-origin/.test(err.message), 'expected default in token list');
            assert.ok(/unsafe-url/.test(err.message),                   'expected unsafe-url in token list');
        }
    });

    it('throws on close-but-invalid "strict-origin-when-same-origin"', function () {
        assert.throws(function () {
            ReferrerPolicy._resolveValue('strict-origin-when-same-origin');
        }, /invalid value/);
    });

    it('error message points at the W3C Referrer Policy spec', function () {
        try {
            ReferrerPolicy._resolveValue('bogus-token');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/www\.w3\.org\/TR\/referrer-policy/.test(err.message), 'expected W3C spec URL');
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
        var mw = ReferrerPolicy();
        assert.equal(typeof mw, 'function');
    });

    it('factory uses strict-origin-when-cross-origin by default', function () {
        var mw  = ReferrerPolicy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('referrer-policy'), 'strict-origin-when-cross-origin');
    });

    it('factory accepts { value: "no-referrer" }', function () {
        var mw  = ReferrerPolicy({ value: 'no-referrer' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('referrer-policy'), 'no-referrer');
    });

    it('factory accepts uppercase value and emits normalised lowercase', function () {
        var mw  = ReferrerPolicy({ value: 'SAME-ORIGIN' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('referrer-policy'), 'same-origin');
    });

    it('factory throws on { value: "nope" }', function () {
        assert.throws(function () { ReferrerPolicy({ value: 'nope' }); }, /invalid value/);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = ReferrerPolicy();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing referrer-policy header set upstream', function () {
        var mw  = ReferrerPolicy({ value: 'no-referrer' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'referrer-policy': 'unsafe-url' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('referrer-policy'), 'unsafe-url');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = ReferrerPolicy({ value: 'no-referrer' });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('referrer-policy'), 'no-referrer');
    });

    it('works on HEAD requests', function () {
        var mw  = ReferrerPolicy();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('referrer-policy'), 'strict-origin-when-cross-origin');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = ReferrerPolicy({ value: 'no-referrer' });
        var mw2 = ReferrerPolicy({ value: 'origin' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('referrer-policy'), 'no-referrer');
    });

});


// ─── 06 — Plugin registration in core/plugins/index.js ─────────────────────

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('ReferrerPolicy is wired to ./lib/security-headers/referrer-policy', function () {
        assert.ok(
            /ReferrerPolicy\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/referrer-policy['"]\s*\)/.test(src),
            'expected ReferrerPolicy registry entry'
        );
    });

    it('#HDR3 marker comment is present', function () {
        assert.ok(
            /#HDR3[^\n]*Referrer-Policy/.test(src),
            'expected #HDR3 marker comment naming Referrer-Policy'
        );
    });

});


// ─── 07 — Settings template advertises the slot + boilerplate ──────────────

describe('07 - settings.json template advertises referrerPolicy slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('referrerPolicy key is present with default value', function () {
        assert.ok(
            /"referrerPolicy"\s*:\s*\{[\s\S]*?"value"\s*:\s*"strict-origin-when-cross-origin"/.test(src),
            'expected "referrerPolicy": { "value": "strict-origin-when-cross-origin" } block in settings template'
        );
    });

    it('#HDR3 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR3[^\n]*Referrer-Policy/.test(src),
            'expected #HDR3 marker comment before the referrerPolicy block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.ReferrerPolicy\(\)/.test(BP),
            'expected ReferrerPolicy adoption example in bundle boilerplate'
        );
    });

});
