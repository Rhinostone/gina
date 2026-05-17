'use strict';
/**
 * Cross-Origin-Embedder-Policy plugin (#HDR6) tests
 *
 * Strategy — mirrors the #HDR3 ReferrerPolicy single-enum test shape:
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
var PLUGIN = path.join(FW, 'core/plugins/lib/coep/src/main.js');

var Coep;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    Coep = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR6 marker is present', function () {
        assert.ok(src.indexOf('#HDR6') > -1, 'expected #HDR6 marker for traceability');
    });

    it('header name is cross-origin-embedder-policy', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]cross-origin-embedder-policy['"]/.test(src),
            'expected HEADER_NAME = cross-origin-embedder-policy'
        );
    });

    it('all 3 W3C HTML spec tokens are listed in VALID_VALUES', function () {
        var tokens = ['require-corp', 'credentialless', 'unsafe-none'];
        for (var i = 0; i < tokens.length; i++) {
            assert.ok(
                new RegExp("['\"]" + tokens[i] + "['\"]").test(src),
                'expected token ' + tokens[i] + ' in VALID_VALUES'
            );
        }
    });

    it('default value is require-corp (matches helmet default and enables SharedArrayBuffer combo)', function () {
        assert.ok(
            /DEFAULT_VALUE\s*=\s*['"]require-corp['"]/.test(src),
            'expected DEFAULT_VALUE = require-corp'
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

    it('reads settings.json > coep via content.settings.coep', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.coep/.test(src),
            'expected content.settings → coep read chain'
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

    it('returned middleware is a named function (ginaCoep) for stack traces', function () {
        assert.ok(
            /function\s+ginaCoep\s*\(/.test(src),
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
        var out = Coep._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no coep key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = Coep._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through coep block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { coep: { value: 'credentialless' } } } } }
            };
        };
        var out = Coep._resolveSettingsDefaults();
        assert.deepEqual(out, { value: 'credentialless' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = Coep._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = Coep._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = Coep._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = Coep._mergeOptions(undefined, { value: 'credentialless' });
        assert.deepEqual(out, { value: 'credentialless' });
    });

    it('caller overrides defaults for known keys', function () {
        var out = Coep._mergeOptions({ value: 'unsafe-none' }, { value: 'require-corp' });
        assert.deepEqual(out, { value: 'unsafe-none' });
    });

    it('caller adds keys not in defaults', function () {
        var out = Coep._mergeOptions({ extra: 'NEW' }, { value: 'require-corp' });
        assert.deepEqual(out, { value: 'require-corp', extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.value = 'credentialless';
        var out = Coep._mergeOptions(caller, { value: 'require-corp' });
        assert.deepEqual(out, { value: 'credentialless' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveValue: validation + lowercase normalisation ──────────────

describe('04 - _resolveValue: validation + lowercase normalisation', function () {

    it('returns require-corp when value is undefined', function () {
        assert.equal(Coep._resolveValue(undefined), 'require-corp');
    });

    it('returns the default when value is null', function () {
        assert.equal(Coep._resolveValue(null), 'require-corp');
    });

    it('returns the default when value is empty string', function () {
        assert.equal(Coep._resolveValue(''), 'require-corp');
    });

    it('accepts "require-corp"', function () {
        assert.equal(Coep._resolveValue('require-corp'), 'require-corp');
    });

    it('accepts "credentialless"', function () {
        assert.equal(Coep._resolveValue('credentialless'), 'credentialless');
    });

    it('accepts "unsafe-none"', function () {
        assert.equal(Coep._resolveValue('unsafe-none'), 'unsafe-none');
    });

    it('normalises uppercase "REQUIRE-CORP" to lowercase require-corp', function () {
        assert.equal(Coep._resolveValue('REQUIRE-CORP'), 'require-corp');
    });

    it('normalises mixed-case "Credentialless" to lowercase', function () {
        assert.equal(Coep._resolveValue('Credentialless'), 'credentialless');
    });

    it('normalises mixed-case "Unsafe-None" to lowercase', function () {
        assert.equal(Coep._resolveValue('Unsafe-None'), 'unsafe-none');
    });

    it('throws on non-string value (number)', function () {
        assert.throws(function () { Coep._resolveValue(42); }, /must be a string/);
    });

    it('throws on non-string value (object)', function () {
        assert.throws(function () { Coep._resolveValue({ v: 'require-corp' }); }, /must be a string/);
    });

    it('throws on non-string value (boolean)', function () {
        assert.throws(function () { Coep._resolveValue(true); }, /must be a string/);
    });

    it('throws on unknown value with full token list in message', function () {
        try {
            Coep._resolveValue('nope');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/invalid value/.test(err.message),     'expected "invalid value" prefix');
            assert.ok(/require-corp/.test(err.message),      'expected require-corp in token list');
            assert.ok(/credentialless/.test(err.message),    'expected credentialless in token list');
            assert.ok(/unsafe-none/.test(err.message),       'expected unsafe-none in token list');
        }
    });

    it('throws on close-but-invalid "require-cors" typo', function () {
        assert.throws(function () {
            Coep._resolveValue('require-cors');
        }, /invalid value/);
    });

    it('throws on close-but-invalid "credentialed" typo', function () {
        assert.throws(function () {
            Coep._resolveValue('credentialed');
        }, /invalid value/);
    });

    it('error message points at the W3C HTML spec', function () {
        try {
            Coep._resolveValue('bogus-token');
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
        var mw = Coep();
        assert.equal(typeof mw, 'function');
    });

    it('factory uses require-corp by default', function () {
        var mw  = Coep();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'require-corp');
    });

    it('factory accepts { value: "credentialless" }', function () {
        var mw  = Coep({ value: 'credentialless' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'credentialless');
    });

    it('factory accepts { value: "unsafe-none" }', function () {
        var mw  = Coep({ value: 'unsafe-none' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'unsafe-none');
    });

    it('factory accepts uppercase value and emits normalised lowercase', function () {
        var mw  = Coep({ value: 'CREDENTIALLESS' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'credentialless');
    });

    it('factory throws on { value: "nope" }', function () {
        assert.throws(function () { Coep({ value: 'nope' }); }, /invalid value/);
    });

    it('factory throws on { value: 42 }', function () {
        assert.throws(function () { Coep({ value: 42 }); }, /must be a string/);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = Coep();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing cross-origin-embedder-policy header set upstream', function () {
        var mw  = Coep({ value: 'require-corp' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'cross-origin-embedder-policy': 'unsafe-none' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'unsafe-none');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = Coep({ value: 'credentialless' });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'credentialless');
    });

    it('works on HEAD requests', function () {
        var mw  = Coep();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'require-corp');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = Coep({ value: 'require-corp' });
        var mw2 = Coep({ value: 'credentialless' });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'require-corp');
    });

});


// ─── 06 — Plugin registration in core/plugins/index.js ─────────────────────

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('Coep is wired to ./lib/coep', function () {
        assert.ok(
            /Coep\s*:\s*_require\(\s*['"]\.\/lib\/coep['"]\s*\)/.test(src),
            'expected Coep registry entry'
        );
    });

    it('#HDR6 marker comment is present', function () {
        assert.ok(
            /#HDR6[^\n]*Cross-Origin-Embedder-Policy/.test(src),
            'expected #HDR6 marker comment naming Cross-Origin-Embedder-Policy'
        );
    });

});


// ─── 07 — Settings template advertises the slot + boilerplate ──────────────

describe('07 - settings.json template advertises coep slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('coep key is present with default value', function () {
        assert.ok(
            /"coep"\s*:\s*\{[\s\S]*?"value"\s*:\s*"require-corp"/.test(src),
            'expected "coep": { "value": "require-corp" } block in settings template'
        );
    });

    it('#HDR6 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR6[^\n]*Cross-Origin-Embedder-Policy/.test(src),
            'expected #HDR6 marker comment before the coep block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.Coep\(\)/.test(BP),
            'expected Coep adoption example in bundle boilerplate'
        );
    });

});
