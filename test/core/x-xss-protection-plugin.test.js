'use strict';
/**
 * X-XSS-Protection plugin (#HDR10) tests
 *
 * Strategy — mirrors the #HDR1 XContentTypeOptions no-opts test shape:
 *  - Source-inspection guards pinning the literal "0" header value.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults).
 *  - End-to-end tests through stub req/res/next.
 *  - Negative-invariant lock: the value MUST be the literal "0" — the
 *    "1" enable values are unsafe; the plugin must not accept them via
 *    any option shape. No eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/x-xss-protection/src/main.js');

var XXssProtection;
var originalGetContext;
var originalGetConfig;

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    XXssProtection = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection ────────────────────────────────────────────────

describe('01 - source inspection: header + fixed-zero patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR10 marker is present', function () {
        assert.ok(src.indexOf('#HDR10') > -1, 'expected #HDR10 marker for traceability');
    });

    it('header name is x-xss-protection', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-xss-protection['"]/.test(src),
            'expected HEADER_NAME = x-xss-protection'
        );
    });

    it('header value is the literal string "0" (disable Chrome legacy auditor)', function () {
        assert.ok(
            /HEADER_VALUE\s*=\s*['"]0['"]/.test(src),
            'expected HEADER_VALUE = "0" (deliberate: disables Chrome legacy XSS auditor)'
        );
    });

    it('NEGATIVE-INVARIANT: header value is NOT "1" or "1; mode=block" (those are unsafe)', function () {
        assert.ok(
            !/HEADER_VALUE\s*=\s*['"]1[^'"]*['"]/.test(src),
            'HDR10 must NOT use any "1" enable variant — the Chrome auditor itself had vulnerabilities'
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

    it('reads settings.json > xXssProtection via content.settings.xXssProtection', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.xXssProtection/.test(src),
            'expected content.settings → xXssProtection read chain'
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

    it('returned middleware is a named function (ginaXXssProtection) for stack traces', function () {
        assert.ok(
            /function\s+ginaXXssProtection\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('documents the "0 is deliberate" rationale in module JSDoc', function () {
        assert.ok(
            /value\s*`?0`?\s*is\s*deliberate/i.test(src) || /0[^\n]{0,80}deliberate/i.test(src),
            'expected "0 is deliberate" rationale in module JSDoc'
        );
    });

    it('error message points at the MDN reference', function () {
        assert.ok(
            /developer\.mozilla\.org.*X-XSS-Protection/.test(src),
            'expected MDN reference URL in module JSDoc / error context'
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
        var out = XXssProtection._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no xXssProtection key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = XXssProtection._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through xXssProtection block when present (future-proofing)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { xXssProtection: { reservedField: 'someValue' } } } } }
            };
        };
        var out = XXssProtection._resolveSettingsDefaults();
        assert.deepEqual(out, { reservedField: 'someValue' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = XXssProtection._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = XXssProtection._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions ────────────────────────────────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = XXssProtection._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = XXssProtection._mergeOptions(undefined, { a: 1, b: 2 });
        assert.deepEqual(out, { a: 1, b: 2 });
    });

    it('caller overrides defaults for known keys', function () {
        var out = XXssProtection._mergeOptions({ a: 'CALLER' }, { a: 'DEFAULT', b: 'KEEP' });
        assert.deepEqual(out, { a: 'CALLER', b: 'KEEP' });
    });

    it('caller adds keys not in defaults', function () {
        var out = XXssProtection._mergeOptions({ extra: 'NEW' }, { a: 1 });
        assert.deepEqual(out, { a: 1, extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.own = 'OWN';
        var out = XXssProtection._mergeOptions(caller, { d: 1 });
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
        var mw = XXssProtection();
        assert.equal(typeof mw, 'function');
    });

    it('factory accepts an opts argument without throwing', function () {
        assert.doesNotThrow(function () { XXssProtection({ futureField: true }); });
    });

    it('middleware sets x-xss-protection: 0 on the response', function () {
        var mw  = XXssProtection();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-xss-protection'), '0');
    });

    it('emitted value is the STRING "0", not the number 0 (header API contract)', function () {
        var mw  = XXssProtection();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        var v = res.getHeader('x-xss-protection');
        assert.equal(typeof v, 'string', 'expected emitted value to be a string');
        assert.equal(v, '0',             'expected exact string "0"');
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = XXssProtection();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing x-xss-protection header set upstream (even if unsafe "1")', function () {
        // If an upstream middleware set X-XSS-Protection: 1 (the unsafe
        // enable mode), this plugin does NOT override it. Mount this
        // plugin BEFORE the upstream one to win first-writer.
        var mw  = XXssProtection();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-xss-protection': '1; mode=block' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('x-xss-protection'), '1; mode=block');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = XXssProtection();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-xss-protection'), '0');
    });

    it('works on HEAD requests', function () {
        var mw  = XXssProtection();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-xss-protection'), '0');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = XXssProtection();
        var mw2 = XXssProtection();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-xss-protection'), '0');
    });

});


// ─── 05 — Plugin registration in core/plugins/index.js ─────────────────────

describe('05 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('XXssProtection is wired to ./lib/security-headers/x-xss-protection', function () {
        assert.ok(
            /XXssProtection\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/x-xss-protection['"]\s*\)/.test(src),
            'expected XXssProtection registry entry'
        );
    });

    it('#HDR10 marker comment is present', function () {
        assert.ok(
            /#HDR10[^\n]*X-XSS-Protection/.test(src),
            'expected #HDR10 marker comment naming X-XSS-Protection'
        );
    });

});


// ─── 06 — Settings template advertises the slot + boilerplate ──────────────

describe('06 - settings.json template advertises xXssProtection slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('xXssProtection key is present', function () {
        assert.ok(
            /"xXssProtection"\s*:\s*\{/.test(src),
            'expected "xXssProtection": { ... } block in settings template'
        );
    });

    it('#HDR10 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR10[^\n]*X-XSS-Protection/.test(src),
            'expected #HDR10 marker comment before the xXssProtection block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.XXssProtection\(\)/.test(BP),
            'expected XXssProtection adoption example in bundle boilerplate'
        );
    });

});
