'use strict';
/**
 * X-Download-Options plugin (#HDR11) tests
 *
 * Strategy — mirrors the #HDR10 XXssProtection / #HDR1 XContentTypeOptions
 * no-opts test shape:
 *  - Source-inspection guards pinning the literal "noopen" header value.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults).
 *  - End-to-end tests through stub req/res/next.
 *  - Negative-invariant lock: only valid value per MSDN is "noopen"; no
 *    eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/x-download-options/src/main.js');

var XDownloadOptions;
var originalGetContext;
var originalGetConfig;

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    XDownloadOptions = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection ────────────────────────────────────────────────

describe('01 - source inspection: header + fixed-value patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR11 marker is present', function () {
        assert.ok(src.indexOf('#HDR11') > -1, 'expected #HDR11 marker for traceability');
    });

    it('header name is x-download-options', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-download-options['"]/.test(src),
            'expected HEADER_NAME = x-download-options'
        );
    });

    it('header value is the literal "noopen"', function () {
        assert.ok(
            /HEADER_VALUE\s*=\s*['"]noopen['"]/.test(src),
            'expected HEADER_VALUE = noopen'
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

    it('reads settings.json > xDownloadOptions via content.settings.xDownloadOptions', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.xDownloadOptions/.test(src),
            'expected content.settings → xDownloadOptions read chain'
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

    it('returned middleware is a named function (ginaXDownloadOptions) for stack traces', function () {
        assert.ok(
            /function\s+ginaXDownloadOptions\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('documents the IE-legacy rationale in module JSDoc', function () {
        assert.ok(
            /IE-?legacy/i.test(src) || /Internet Explorer/i.test(src),
            'expected IE-legacy rationale in module JSDoc'
        );
    });

    it('MSDN reference URL is present in source', function () {
        assert.ok(
            /learn\.microsoft\.com/.test(src),
            'expected MSDN reference URL in module JSDoc'
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
        var out = XDownloadOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no xDownloadOptions key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = XDownloadOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through xDownloadOptions block when present (future-proofing)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { xDownloadOptions: { reservedField: 'someValue' } } } } }
            };
        };
        var out = XDownloadOptions._resolveSettingsDefaults();
        assert.deepEqual(out, { reservedField: 'someValue' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = XDownloadOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = XDownloadOptions._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions ────────────────────────────────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = XDownloadOptions._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = XDownloadOptions._mergeOptions(undefined, { a: 1, b: 2 });
        assert.deepEqual(out, { a: 1, b: 2 });
    });

    it('caller overrides defaults for known keys', function () {
        var out = XDownloadOptions._mergeOptions({ a: 'CALLER' }, { a: 'DEFAULT', b: 'KEEP' });
        assert.deepEqual(out, { a: 'CALLER', b: 'KEEP' });
    });

    it('caller adds keys not in defaults', function () {
        var out = XDownloadOptions._mergeOptions({ extra: 'NEW' }, { a: 1 });
        assert.deepEqual(out, { a: 1, extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.own = 'OWN';
        var out = XDownloadOptions._mergeOptions(caller, { d: 1 });
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
        var mw = XDownloadOptions();
        assert.equal(typeof mw, 'function');
    });

    it('factory accepts an opts argument without throwing', function () {
        assert.doesNotThrow(function () { XDownloadOptions({ futureField: true }); });
    });

    it('middleware sets x-download-options: noopen on the response', function () {
        var mw  = XDownloadOptions();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-download-options'), 'noopen');
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = XDownloadOptions();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing x-download-options header set upstream', function () {
        var mw  = XDownloadOptions();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-download-options': 'custom-value' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('x-download-options'), 'custom-value');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = XDownloadOptions();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-download-options'), 'noopen');
    });

    it('works on HEAD requests', function () {
        var mw  = XDownloadOptions();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-download-options'), 'noopen');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = XDownloadOptions();
        var mw2 = XDownloadOptions();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-download-options'), 'noopen');
    });

});


// ─── 05 — Plugin registration in core/plugins/index.js ─────────────────────

describe('05 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('XDownloadOptions is wired to ./lib/security-headers/x-download-options', function () {
        assert.ok(
            /XDownloadOptions\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/x-download-options['"]\s*\)/.test(src),
            'expected XDownloadOptions registry entry'
        );
    });

    it('#HDR11 marker comment is present', function () {
        assert.ok(
            /#HDR11[^\n]*X-Download-Options/.test(src),
            'expected #HDR11 marker comment naming X-Download-Options'
        );
    });

});


// ─── 06 — Settings template advertises the slot + boilerplate ──────────────

describe('06 - settings.json template advertises xDownloadOptions slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('xDownloadOptions key is present', function () {
        assert.ok(
            /"xDownloadOptions"\s*:\s*\{/.test(src),
            'expected "xDownloadOptions": { ... } block in settings template'
        );
    });

    it('#HDR11 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR11[^\n]*X-Download-Options/.test(src),
            'expected #HDR11 marker comment before the xDownloadOptions block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.XDownloadOptions\(\)/.test(BP),
            'expected XDownloadOptions adoption example in bundle boilerplate'
        );
    });

});
