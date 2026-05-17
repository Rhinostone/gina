'use strict';
/**
 * Content-Security-Policy plugin (#HDR5) tests
 *
 * Strategy — mirrors the #HDR1-4 / #HDR7 plugin test shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults, _resolveDirectives, _resolveReportOnly,
 *    _buildHeaderValue) — no framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract.
 *  - Negative-invariant locks: unknown directive names rejected at factory
 *    call time, boolean-only directives reject non-boolean values, source-
 *    list directives reject naked true (except sandbox), all-omitted result
 *    throws, no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/csp/src/main.js');

var Csp;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    Csp = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR5 marker is present', function () {
        assert.ok(src.indexOf('#HDR5') > -1, 'expected #HDR5 marker for traceability');
    });

    it('enforcing header name is content-security-policy', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]content-security-policy['"]/.test(src),
            'expected HEADER_NAME = content-security-policy'
        );
    });

    it('report-only header name is content-security-policy-report-only', function () {
        assert.ok(
            /HEADER_NAME_REPORT_ONLY\s*=\s*['"]content-security-policy-report-only['"]/.test(src),
            'expected HEADER_NAME_REPORT_ONLY = content-security-policy-report-only'
        );
    });

    it('default reportOnly is false (enforcing mode)', function () {
        assert.ok(
            /DEFAULT_REPORT_ONLY\s*=\s*false/.test(src),
            'expected DEFAULT_REPORT_ONLY = false'
        );
    });

    it('VALID_DIRECTIVES includes the 17 fetch directives', function () {
        var fetch = [
            'child-src', 'connect-src', 'default-src', 'font-src',
            'frame-src', 'img-src', 'manifest-src', 'media-src',
            'object-src', 'prefetch-src', 'script-src', 'script-src-attr',
            'script-src-elem', 'style-src', 'style-src-attr', 'style-src-elem',
            'worker-src'
        ];
        for (var i = 0; i < fetch.length; i++) {
            assert.ok(
                src.indexOf("'" + fetch[i] + "'") > -1,
                'expected fetch directive "' + fetch[i] + '" in VALID_DIRECTIVES'
            );
        }
    });

    it('VALID_DIRECTIVES includes document + navigation + reporting directives', function () {
        var other = [
            'base-uri', 'sandbox', 'form-action', 'frame-ancestors',
            'report-to', 'report-uri'
        ];
        for (var i = 0; i < other.length; i++) {
            assert.ok(
                src.indexOf("'" + other[i] + "'") > -1,
                'expected directive "' + other[i] + '" in VALID_DIRECTIVES'
            );
        }
    });

    it('VALID_DIRECTIVES includes document-policies + trusted-types directives', function () {
        var other = [
            'block-all-mixed-content', 'upgrade-insecure-requests',
            'require-trusted-types-for', 'trusted-types'
        ];
        for (var i = 0; i < other.length; i++) {
            assert.ok(
                src.indexOf("'" + other[i] + "'") > -1,
                'expected directive "' + other[i] + '" in VALID_DIRECTIVES'
            );
        }
    });

    it('BOOLEAN_ONLY_DIRECTIVES has block-all-mixed-content + upgrade-insecure-requests', function () {
        assert.ok(
            /BOOLEAN_ONLY_DIRECTIVES\s*=\s*\[[\s\S]*?'block-all-mixed-content'[\s\S]*?'upgrade-insecure-requests'/.test(src),
            'expected BOOLEAN_ONLY_DIRECTIVES list with both names'
        );
    });

    it('HYBRID_DIRECTIVES has sandbox', function () {
        assert.ok(
            /HYBRID_DIRECTIVES\s*=\s*\[[\s\S]*?'sandbox'/.test(src),
            'expected HYBRID_DIRECTIVES list with sandbox'
        );
    });

    it('middleware uses dynamic headerName from reportOnly switch', function () {
        assert.ok(
            /headerName\s*=\s*reportOnly\s*\?\s*HEADER_NAME_REPORT_ONLY\s*:\s*HEADER_NAME/.test(src),
            'expected headerName = reportOnly ? HEADER_NAME_REPORT_ONLY : HEADER_NAME ternary'
        );
    });

    it('middleware calls res.setHeader with dynamic headerName + value', function () {
        assert.ok(
            /res\.setHeader\(headerName,\s*headerValue\)/.test(src),
            'expected res.setHeader(headerName, headerValue) in middleware'
        );
    });

    it('middleware calls next() after setting the header', function () {
        assert.ok(
            /res\.setHeader\(headerName[\s\S]*?next\(\)/.test(src),
            'expected next() to be called after res.setHeader'
        );
    });

    it('reads settings.json > csp via content.settings.csp', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.csp/.test(src),
            'expected content.settings → csp read chain'
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
            /res\.getHeader\(headerName\)[\s\S]*?return\s+next\(\)/.test(src),
            'expected idempotent guard: skip+next if header already set'
        );
    });

    it('returned middleware is a named function (ginaCsp) for stack traces', function () {
        assert.ok(
            /function\s+ginaCsp\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('directive name normalised to lowercase before whitelist check', function () {
        assert.ok(
            /\.toLowerCase\(\)/.test(src),
            'expected .toLowerCase() normalisation on directive keys'
        );
    });

    it('error message points at W3C CSP3 spec', function () {
        assert.ok(
            /www\.w3\.org\/TR\/CSP3/.test(src),
            'expected W3C CSP3 spec URL in error message'
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
        var out = Csp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no csp key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { x: 1 } } } } } };
        };
        var out = Csp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through csp block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { csp: {
                    directives: { 'default-src': ["'self'"] },
                    reportOnly: true
                } } } } }
            };
        };
        var out = Csp._resolveSettingsDefaults();
        assert.deepEqual(out, {
            directives: { 'default-src': ["'self'"] },
            reportOnly: true
        });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = Csp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = Csp._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = Csp._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var d = { directives: { 'default-src': ["'self'"] } };
        var out = Csp._mergeOptions(undefined, d);
        assert.deepEqual(out, d);
    });

    it('caller overrides defaults for the directives key (shallow replace)', function () {
        var out = Csp._mergeOptions(
            { directives: { 'script-src': ["'self'"] } },
            { directives: { 'default-src': ["'self'"] } }
        );
        assert.deepEqual(out, { directives: { 'script-src': ["'self'"] } });
    });

    it('caller overrides defaults for reportOnly', function () {
        var out = Csp._mergeOptions({ reportOnly: true }, { reportOnly: false });
        assert.deepEqual(out, { reportOnly: true });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.reportOnly = true;
        var out = Csp._mergeOptions(caller, { reportOnly: false });
        assert.deepEqual(out, { reportOnly: true });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveDirectives: validation + normalisation ───────────────────

describe('04 - _resolveDirectives: validation + normalisation', function () {

    it('throws on undefined directives', function () {
        assert.throws(function () { Csp._resolveDirectives(undefined); }, /directives is required/);
    });

    it('throws on null directives', function () {
        assert.throws(function () { Csp._resolveDirectives(null); }, /directives is required/);
    });

    it('throws on non-object directives (string)', function () {
        assert.throws(function () { Csp._resolveDirectives('default-src'); }, /directives is required/);
    });

    it('throws on non-object directives (number)', function () {
        assert.throws(function () { Csp._resolveDirectives(42); }, /directives is required/);
    });

    it('throws on array directives (Array is not a plain object)', function () {
        assert.throws(function () { Csp._resolveDirectives(['default-src']); }, /directives is required/);
    });

    it('throws on empty object directives', function () {
        assert.throws(function () { Csp._resolveDirectives({}); }, /at least one directive/);
    });

    it('throws on unknown directive name with full whitelist in message', function () {
        try {
            Csp._resolveDirectives({ 'scrpt-src': ["'self'"] });
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/unknown directive name/.test(err.message),  'expected "unknown directive" prefix');
            assert.ok(/scrpt-src/.test(err.message),               'expected typo in message');
            assert.ok(/default-src/.test(err.message),             'expected default-src in whitelist');
            assert.ok(/script-src/.test(err.message),              'expected script-src in whitelist');
            assert.ok(/upgrade-insecure-requests/.test(err.message), 'expected upgrade-insecure-requests');
        }
    });

    it('error message points at the W3C CSP3 spec URL', function () {
        try {
            Csp._resolveDirectives({ 'bogus': ["'self'"] });
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/www\.w3\.org\/TR\/CSP3/.test(err.message), 'expected W3C CSP3 spec URL');
        }
    });

    it('normalises uppercase directive names to lowercase before whitelist check', function () {
        var out = Csp._resolveDirectives({ 'DEFAULT-SRC': ["'self'"] });
        assert.deepEqual(out, { 'default-src': ["'self'"] });
    });

    it('accepts a source-list array', function () {
        var out = Csp._resolveDirectives({ 'default-src': ["'self'", 'https:'] });
        assert.deepEqual(out, { 'default-src': ["'self'", 'https:'] });
    });

    it('accepts a pre-formatted source-list string', function () {
        var out = Csp._resolveDirectives({ 'default-src': "'self' https:" });
        assert.deepEqual(out, { 'default-src': "'self' https:" });
    });

    it('omits a directive set to false', function () {
        var out = Csp._resolveDirectives({
            'default-src': ["'self'"],
            'script-src':  false
        });
        assert.deepEqual(out, { 'default-src': ["'self'"] });
    });

    it('accepts true for boolean-only directive upgrade-insecure-requests', function () {
        var out = Csp._resolveDirectives({ 'upgrade-insecure-requests': true });
        assert.deepEqual(out, { 'upgrade-insecure-requests': true });
    });

    it('accepts true for boolean-only directive block-all-mixed-content', function () {
        var out = Csp._resolveDirectives({ 'block-all-mixed-content': true });
        assert.deepEqual(out, { 'block-all-mixed-content': true });
    });

    it('omits a boolean-only directive set to false', function () {
        var out = Csp._resolveDirectives({
            'default-src': ["'self'"],
            'upgrade-insecure-requests': false
        });
        assert.deepEqual(out, { 'default-src': ["'self'"] });
    });

    it('throws on boolean-only directive given a string value', function () {
        assert.throws(function () {
            Csp._resolveDirectives({ 'upgrade-insecure-requests': "'self'" });
        }, /boolean-only/);
    });

    it('throws on boolean-only directive given an array value', function () {
        assert.throws(function () {
            Csp._resolveDirectives({ 'upgrade-insecure-requests': ["'self'"] });
        }, /boolean-only/);
    });

    it('throws on source-list directive given naked true (not sandbox)', function () {
        try {
            Csp._resolveDirectives({ 'default-src': true });
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/source-list directive/.test(err.message), 'expected source-list explanation');
            assert.ok(/default-src/.test(err.message),           'expected directive name');
        }
    });

    it('accepts true for hybrid directive sandbox (empty sandbox — all restrictions)', function () {
        var out = Csp._resolveDirectives({ 'sandbox': true });
        assert.deepEqual(out, { 'sandbox': true });
    });

    it('accepts string value for hybrid directive sandbox', function () {
        var out = Csp._resolveDirectives({ 'sandbox': 'allow-scripts allow-same-origin' });
        assert.deepEqual(out, { 'sandbox': 'allow-scripts allow-same-origin' });
    });

    it('accepts array value for hybrid directive sandbox', function () {
        var out = Csp._resolveDirectives({ 'sandbox': ['allow-scripts', 'allow-same-origin'] });
        assert.deepEqual(out, { 'sandbox': ['allow-scripts', 'allow-same-origin'] });
    });

    it('throws on source-list directive given a number value', function () {
        assert.throws(function () {
            Csp._resolveDirectives({ 'default-src': 42 });
        }, /must be a string, an array of strings, or false/);
    });

    it('throws on array entry that is not a string (number)', function () {
        try {
            Csp._resolveDirectives({ 'default-src': ["'self'", 42] });
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/array entries must be strings/.test(err.message), 'expected array-entries error');
            assert.ok(/index 1/.test(err.message),                       'expected index in message');
        }
    });

    it('throws on array entry that is not a string (object)', function () {
        assert.throws(function () {
            Csp._resolveDirectives({ 'default-src': ["'self'", { v: 'x' }] });
        }, /array entries must be strings/);
    });

    it('throws when all entries resolve to false (zero enabled)', function () {
        assert.throws(function () {
            Csp._resolveDirectives({
                'default-src': false,
                'script-src':  false,
                'upgrade-insecure-requests': false
            });
        }, /zero enabled directives/);
    });

    it('does not throw when one entry survives even though others are false', function () {
        var out = Csp._resolveDirectives({
            'default-src': ["'self'"],
            'script-src':  false
        });
        assert.deepEqual(out, { 'default-src': ["'self'"] });
    });

    it('returned array is a copy — caller mutation does not affect the normalised result', function () {
        var input = ["'self'", 'https:'];
        var out = Csp._resolveDirectives({ 'default-src': input });
        input.push("'unsafe-inline'");
        assert.deepEqual(out['default-src'], ["'self'", 'https:'],
            'expected normalised array unaffected by caller mutation');
    });

    it('preserves insertion order across multiple directives', function () {
        var out = Csp._resolveDirectives({
            'default-src': ["'self'"],
            'script-src':  ["'self'"],
            'style-src':   ["'self'"]
        });
        assert.deepEqual(Object.keys(out), ['default-src', 'script-src', 'style-src']);
    });

    it('accepts mixed value shapes in the same directives object', function () {
        var out = Csp._resolveDirectives({
            'default-src':               ["'self'"],
            'script-src':                "'self' https:",
            'sandbox':                   true,
            'upgrade-insecure-requests': true,
            'frame-src':                 false
        });
        assert.deepEqual(out, {
            'default-src':               ["'self'"],
            'script-src':                "'self' https:",
            'sandbox':                   true,
            'upgrade-insecure-requests': true
        });
    });

});


// ─── 05 — _resolveReportOnly: strict boolean coercion ──────────────────────

describe('05 - _resolveReportOnly: strict boolean coercion', function () {

    it('returns false (default) when value is undefined', function () {
        assert.equal(Csp._resolveReportOnly(undefined), false);
    });

    it('returns false (default) when value is null', function () {
        assert.equal(Csp._resolveReportOnly(null), false);
    });

    it('returns false when value is boolean false', function () {
        assert.equal(Csp._resolveReportOnly(false), false);
    });

    it('returns true when value is boolean true', function () {
        assert.equal(Csp._resolveReportOnly(true), true);
    });

    it('throws on non-boolean string "true" (no string coercion)', function () {
        assert.throws(function () { Csp._resolveReportOnly('true'); }, /must be a boolean/);
    });

    it('throws on number 1 (no truthy coercion)', function () {
        assert.throws(function () { Csp._resolveReportOnly(1); }, /must be a boolean/);
    });

    it('error message names both header variants', function () {
        try {
            Csp._resolveReportOnly('yes');
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/Content-Security-Policy-Report-Only/.test(err.message), 'expected report-only name');
            assert.ok(/Content-Security-Policy/.test(err.message),             'expected enforcing name');
        }
    });

});


// ─── 06 — _buildHeaderValue: serialisation per CSP Level 3 §3.1 ────────────

describe('06 - _buildHeaderValue: serialisation', function () {

    it('returns empty string when normalised dict is empty', function () {
        assert.equal(Csp._buildHeaderValue({}), '');
    });

    it('serialises a single source-list array', function () {
        assert.equal(
            Csp._buildHeaderValue({ 'default-src': ["'self'"] }),
            "default-src 'self'"
        );
    });

    it('joins multi-token array with single space', function () {
        assert.equal(
            Csp._buildHeaderValue({ 'default-src': ["'self'", 'https:', 'data:'] }),
            "default-src 'self' https: data:"
        );
    });

    it('serialises a string value as-is (no re-quoting)', function () {
        assert.equal(
            Csp._buildHeaderValue({ 'default-src': "'self' https:" }),
            "default-src 'self' https:"
        );
    });

    it('emits boolean-only directive name alone', function () {
        assert.equal(
            Csp._buildHeaderValue({ 'upgrade-insecure-requests': true }),
            'upgrade-insecure-requests'
        );
    });

    it('emits sandbox alone when value is true', function () {
        assert.equal(
            Csp._buildHeaderValue({ 'sandbox': true }),
            'sandbox'
        );
    });

    it('separates multiple directives with "; "', function () {
        assert.equal(
            Csp._buildHeaderValue({
                'default-src': ["'self'"],
                'script-src':  ["'self'", 'https:']
            }),
            "default-src 'self'; script-src 'self' https:"
        );
    });

    it('mixes source-list + boolean-only directives correctly', function () {
        assert.equal(
            Csp._buildHeaderValue({
                'default-src':               ["'self'"],
                'upgrade-insecure-requests': true,
                'frame-ancestors':           ["'none'"]
            }),
            "default-src 'self'; upgrade-insecure-requests; frame-ancestors 'none'"
        );
    });

});


// ─── 07 — Factory + middleware end-to-end ──────────────────────────────────

describe('07 - Factory + middleware behaviour', function () {

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
        var mw = Csp({ directives: { 'default-src': ["'self'"] } });
        assert.equal(typeof mw, 'function');
    });

    it('factory throws when called with no args (directives required)', function () {
        assert.throws(function () { Csp(); }, /directives is required/);
    });

    it('factory throws when directives is empty object', function () {
        assert.throws(function () { Csp({ directives: {} }); }, /at least one directive/);
    });

    it('emits content-security-policy by default', function () {
        var mw  = Csp({ directives: { 'default-src': ["'self'"] } });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), "default-src 'self'");
        assert.equal(res.getHeader('content-security-policy-report-only'), null);
    });

    it('emits content-security-policy-report-only when reportOnly:true', function () {
        var mw  = Csp({ directives: { 'default-src': ["'self'"] }, reportOnly: true });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy-report-only'), "default-src 'self'");
        assert.equal(res.getHeader('content-security-policy'), null);
    });

    it('factory throws on unknown directive name', function () {
        assert.throws(function () {
            Csp({ directives: { 'scrpt-src': ["'self'"] } });
        }, /unknown directive name/);
    });

    it('factory throws on non-boolean reportOnly', function () {
        assert.throws(function () {
            Csp({ directives: { 'default-src': ["'self'"] }, reportOnly: 'true' });
        }, /reportOnly must be a boolean/);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = Csp({ directives: { 'default-src': ["'self'"] } });
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves existing content-security-policy header', function () {
        var mw  = Csp({ directives: { 'default-src': ["'self'"] } });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'content-security-policy': "default-src 'none'" });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('content-security-policy'), "default-src 'none'");
        assert.equal(nextCalled, true);
    });

    it('does NOT skip when only the OTHER header variant is set (enforcing vs report-only are distinct)', function () {
        var mw  = Csp({ directives: { 'default-src': ["'self'"] }, reportOnly: false });
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'content-security-policy-report-only': "default-src 'none'" });
        mw(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), "default-src 'self'",
            'expected enforcing CSP to be set even though report-only was set upstream');
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = Csp({ directives: { 'default-src': ["'self'"] } });
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), "default-src 'self'");
    });

    it('works on HEAD requests', function () {
        var mw  = Csp({ directives: { 'default-src': ["'self'"] } });
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), "default-src 'self'");
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = Csp({ directives: { 'default-src': ["'self'"] } });
        var mw2 = Csp({ directives: { 'default-src': ["'none'"] } });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), "default-src 'self'");
    });

    it('emits a realistic strict policy correctly', function () {
        var mw = Csp({
            directives: {
                'default-src':               ["'self'"],
                'script-src':                ["'self'"],
                'style-src':                 ["'self'", "'unsafe-inline'"],
                'img-src':                   ["'self'", 'data:'],
                'upgrade-insecure-requests': true,
                'frame-ancestors':           ["'none'"],
                'object-src':                ["'none'"]
            }
        });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        var emitted = res.getHeader('content-security-policy');
        assert.ok(emitted.indexOf("default-src 'self'") > -1);
        assert.ok(emitted.indexOf("script-src 'self'") > -1);
        assert.ok(emitted.indexOf("style-src 'self' 'unsafe-inline'") > -1);
        assert.ok(emitted.indexOf('upgrade-insecure-requests') > -1);
        assert.ok(emitted.indexOf("frame-ancestors 'none'") > -1);
        assert.ok(emitted.indexOf("object-src 'none'") > -1);
    });

});


// ─── 08 — Plugin registration in core/plugins/index.js ─────────────────────

describe('08 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('Csp is wired to ./lib/security-headers/csp', function () {
        assert.ok(
            /Csp\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/csp['"]\s*\)/.test(src),
            'expected Csp registry entry'
        );
    });

    it('#HDR5 marker comment is present', function () {
        assert.ok(
            /#HDR5[^\n]*Content-Security-Policy/.test(src),
            'expected #HDR5 marker comment naming Content-Security-Policy'
        );
    });

});


// ─── 09 — Settings template advertises the slot + boilerplate ──────────────

describe('09 - settings.json template advertises csp slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('csp key is present in settings template', function () {
        assert.ok(
            /"csp"\s*:\s*\{/.test(src),
            'expected "csp": { ... } block in settings template'
        );
    });

    it('#HDR5 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR5[^\n]*Content-Security-Policy/.test(src),
            'expected #HDR5 marker comment before the csp block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.Csp\(\)/.test(BP),
            'expected Csp adoption example in bundle boilerplate'
        );
    });

});
