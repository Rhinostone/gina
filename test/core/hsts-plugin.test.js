'use strict';
/**
 * HSTS plugin (#HDR4) tests
 *
 * Strategy — mirrors the #HDR1 / #HDR2 / #HDR3 plugin test shape, with
 * extra sections for the multi-field validation surface unique to HSTS:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults, _toBool, _resolveOptions,
 *    _buildHeaderValue) — no framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract.
 *  - Negative-invariant locks: preload=true requires includeSubDomains
 *    AND maxAge>=31536000 (the browser-parity invariant); maxAge must
 *    be a non-negative integer; no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/hsts/src/main.js');

var Hsts;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    Hsts = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: header + validation patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR4 marker is present', function () {
        assert.ok(src.indexOf('#HDR4') > -1, 'expected #HDR4 marker for traceability');
    });

    it('header name is strict-transport-security', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]strict-transport-security['"]/.test(src),
            'expected HEADER_NAME = strict-transport-security'
        );
    });

    it('default maxAge is 15552000 (180 days)', function () {
        assert.ok(
            /DEFAULT_MAX_AGE\s*=\s*15552000/.test(src),
            'expected DEFAULT_MAX_AGE = 15552000'
        );
    });

    it('default includeSubDomains is false', function () {
        assert.ok(
            /DEFAULT_INCLUDE_SUBDOMS\s*=\s*false/.test(src),
            'expected DEFAULT_INCLUDE_SUBDOMS = false'
        );
    });

    it('default preload is false', function () {
        assert.ok(
            /DEFAULT_PRELOAD\s*=\s*false/.test(src),
            'expected DEFAULT_PRELOAD = false'
        );
    });

    it('preload minimum maxAge is 31536000 (1 year)', function () {
        assert.ok(
            /PRELOAD_MIN_MAX_AGE\s*=\s*31536000/.test(src),
            'expected PRELOAD_MIN_MAX_AGE = 31536000'
        );
    });

    it('middleware calls res.setHeader with the constant and built value', function () {
        assert.ok(
            /res\.setHeader\(HEADER_NAME,\s*headerValue\)/.test(src),
            'expected res.setHeader(HEADER_NAME, headerValue) in middleware'
        );
    });

    it('middleware calls next() after setting the header', function () {
        assert.ok(
            /res\.setHeader\(HEADER_NAME[\s\S]*?next\(\)/.test(src),
            'expected next() to be called after res.setHeader'
        );
    });

    it('reads settings.json > hsts via content.settings.hsts', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.hsts/.test(src),
            'expected content.settings → hsts read chain'
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

    it('returned middleware is a named function (ginaHsts) for stack traces', function () {
        assert.ok(
            /function\s+ginaHsts\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('no HTTPS-gating conditional inside the middleware function body', function () {
        // Extract the body of `function ginaHsts(req, res, next) { ... }`
        // and assert no req.secure / req.protocol / connection.encrypted /
        // x-forwarded-proto / :scheme reads gate emission. Behaviour test
        // §07 "emits even on HTTP-shaped requests" is the load-bearing
        // check; this guards against a future regression that adds the
        // gate inside the middleware. JSDoc comments above the function
        // are excluded from the scan because they legitimately discuss
        // the design decision.
        var match = src.match(/function\s+ginaHsts\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{4}\};?/);
        assert.ok(match, 'expected ginaHsts function body to be locatable');
        var body = match[1];
        assert.ok(
            !/req\.secure|req\.protocol|connection\.encrypted|x-forwarded-proto|:scheme/.test(body),
            'expected no HTTPS gating inside ginaHsts function body'
        );
    });

    it('preload-error message points at hstspreload.org', function () {
        assert.ok(
            /hstspreload\.org/.test(src),
            'expected hstspreload.org pointer in preload-invariant error message'
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
        var out = Hsts._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no hsts key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = Hsts._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through hsts block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { hsts: {
                    maxAge: 63072000, includeSubDomains: true, preload: true
                } } } } }
            };
        };
        var out = Hsts._resolveSettingsDefaults();
        assert.deepEqual(out, { maxAge: 63072000, includeSubDomains: true, preload: true });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = Hsts._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = Hsts._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = Hsts._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = Hsts._mergeOptions(undefined, { maxAge: 100, preload: true });
        assert.deepEqual(out, { maxAge: 100, preload: true });
    });

    it('caller overrides defaults for known keys', function () {
        var out = Hsts._mergeOptions({ maxAge: 5 }, { maxAge: 100, preload: true });
        assert.deepEqual(out, { maxAge: 5, preload: true });
    });

    it('caller adds keys not in defaults', function () {
        var out = Hsts._mergeOptions({ extra: 'NEW' }, { maxAge: 5 });
        assert.deepEqual(out, { maxAge: 5, extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.maxAge = 5;
        var out = Hsts._mergeOptions(caller, { maxAge: 100 });
        assert.deepEqual(out, { maxAge: 5 });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _toBool: boolean coercion with fallback ──────────────────────────

describe('04 - _toBool: boolean coercion with fallback', function () {

    it('returns fallback for undefined', function () {
        assert.equal(Hsts._toBool(undefined, false), false);
        assert.equal(Hsts._toBool(undefined, true),  true);
    });

    it('returns fallback for null', function () {
        assert.equal(Hsts._toBool(null, false), false);
        assert.equal(Hsts._toBool(null, true),  true);
    });

    it('returns boolean directly when given boolean', function () {
        assert.equal(Hsts._toBool(true,  false), true);
        assert.equal(Hsts._toBool(false, true),  false);
    });

    it('parses "true" / "1" / "yes" / "on" (case-insensitive) as true', function () {
        assert.equal(Hsts._toBool('true', false), true);
        assert.equal(Hsts._toBool('TRUE', false), true);
        assert.equal(Hsts._toBool('1',    false), true);
        assert.equal(Hsts._toBool('yes',  false), true);
        assert.equal(Hsts._toBool('on',   false), true);
    });

    it('parses "false" / "0" / "no" / "off" (case-insensitive) as false', function () {
        assert.equal(Hsts._toBool('false', true), false);
        assert.equal(Hsts._toBool('FALSE', true), false);
        assert.equal(Hsts._toBool('0',     true), false);
        assert.equal(Hsts._toBool('no',    true), false);
        assert.equal(Hsts._toBool('off',   true), false);
    });

    it('falls back for unknown strings', function () {
        assert.equal(Hsts._toBool('maybe', false), false);
        assert.equal(Hsts._toBool('maybe', true),  true);
    });

    it('falls back for numbers / objects', function () {
        assert.equal(Hsts._toBool(42,  false), false);
        assert.equal(Hsts._toBool({},  true),  true);
    });

});


// ─── 05 — _resolveOptions: validation + browser-parity invariant ───────────

describe('05 - _resolveOptions: validation + browser-parity invariant on preload', function () {

    it('returns defaults when merged is empty', function () {
        var out = Hsts._resolveOptions({});
        assert.deepEqual(out, { maxAge: 15552000, includeSubDomains: false, preload: false });
    });

    it('returns the merged maxAge when provided as number', function () {
        var out = Hsts._resolveOptions({ maxAge: 300 });
        assert.equal(out.maxAge, 300);
    });

    it('returns includeSubDomains=true when provided', function () {
        var out = Hsts._resolveOptions({ includeSubDomains: true });
        assert.equal(out.includeSubDomains, true);
    });

    it('coerces "true" string for includeSubDomains', function () {
        var out = Hsts._resolveOptions({ includeSubDomains: 'true' });
        assert.equal(out.includeSubDomains, true);
    });

    it('accepts preload=true paired with includeSubDomains=true and 1y maxAge', function () {
        var out = Hsts._resolveOptions({
            maxAge: 31536000, includeSubDomains: true, preload: true
        });
        assert.deepEqual(out, { maxAge: 31536000, includeSubDomains: true, preload: true });
    });

    it('accepts maxAge=0 (clears existing HSTS policy)', function () {
        var out = Hsts._resolveOptions({ maxAge: 0 });
        assert.equal(out.maxAge, 0);
    });

    it('throws when maxAge is negative', function () {
        assert.throws(function () {
            Hsts._resolveOptions({ maxAge: -1 });
        }, /maxAge must be a non-negative integer/);
    });

    it('throws when maxAge is a string', function () {
        assert.throws(function () {
            Hsts._resolveOptions({ maxAge: '300' });
        }, /maxAge must be a non-negative integer/);
    });

    it('throws when maxAge is a float (non-integer)', function () {
        assert.throws(function () {
            Hsts._resolveOptions({ maxAge: 100.5 });
        }, /maxAge must be a non-negative integer/);
    });

    it('throws when maxAge is Infinity', function () {
        assert.throws(function () {
            Hsts._resolveOptions({ maxAge: Infinity });
        }, /maxAge must be a non-negative integer/);
    });

    it('throws when maxAge is NaN', function () {
        assert.throws(function () {
            Hsts._resolveOptions({ maxAge: NaN });
        }, /maxAge must be a non-negative integer/);
    });

    it('throws when preload=true without includeSubDomains=true', function () {
        try {
            Hsts._resolveOptions({ maxAge: 31536000, preload: true });
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/preload=true requires includeSubDomains=true/.test(err.message),
                'expected includeSubDomains-required message');
            assert.ok(/hstspreload\.org/.test(err.message),
                'expected hstspreload.org pointer');
        }
    });

    it('throws when preload=true with includeSubDomains=false explicit', function () {
        assert.throws(function () {
            Hsts._resolveOptions({
                maxAge: 31536000, includeSubDomains: false, preload: true
            });
        }, /preload=true requires includeSubDomains=true/);
    });

    it('throws when preload=true with maxAge below 1 year', function () {
        try {
            Hsts._resolveOptions({
                maxAge: 15552000, includeSubDomains: true, preload: true
            });
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/preload=true requires maxAge>=31536000/.test(err.message),
                'expected maxAge-min message');
            assert.ok(/hstspreload\.org/.test(err.message),
                'expected hstspreload.org pointer');
        }
    });

    it('throws when preload=true with maxAge below 1 year by 1 second', function () {
        assert.throws(function () {
            Hsts._resolveOptions({
                maxAge: 31535999, includeSubDomains: true, preload: true
            });
        }, /preload=true requires maxAge>=31536000/);
    });

    it('does not throw when preload=false even with low maxAge / no includeSubDomains', function () {
        assert.doesNotThrow(function () {
            Hsts._resolveOptions({ maxAge: 0, includeSubDomains: false, preload: false });
        });
    });

});


// ─── 06 — _buildHeaderValue: spec-compliant directive order ────────────────

describe('06 - _buildHeaderValue: emits directives in RFC 6797 §6.1 order', function () {

    it('emits max-age only when both flags are false', function () {
        var out = Hsts._buildHeaderValue({
            maxAge: 15552000, includeSubDomains: false, preload: false
        });
        assert.equal(out, 'max-age=15552000');
    });

    it('appends includeSubDomains when true', function () {
        var out = Hsts._buildHeaderValue({
            maxAge: 31536000, includeSubDomains: true, preload: false
        });
        assert.equal(out, 'max-age=31536000; includeSubDomains');
    });

    it('appends preload when true (full triplet)', function () {
        var out = Hsts._buildHeaderValue({
            maxAge: 63072000, includeSubDomains: true, preload: true
        });
        assert.equal(out, 'max-age=63072000; includeSubDomains; preload');
    });

    it('places max-age first per RFC 6797 §6.1', function () {
        var out = Hsts._buildHeaderValue({
            maxAge: 63072000, includeSubDomains: true, preload: true
        });
        assert.ok(out.indexOf('max-age=') === 0, 'max-age must be the first directive');
    });

    it('emits max-age=0 (clears existing policy)', function () {
        var out = Hsts._buildHeaderValue({
            maxAge: 0, includeSubDomains: false, preload: false
        });
        assert.equal(out, 'max-age=0');
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
        var mw = Hsts();
        assert.equal(typeof mw, 'function');
    });

    it('factory emits max-age=15552000 by default', function () {
        var mw  = Hsts();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), 'max-age=15552000');
    });

    it('factory emits the full triplet when configured for preload', function () {
        var mw  = Hsts({ maxAge: 63072000, includeSubDomains: true, preload: true });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(
            res.getHeader('strict-transport-security'),
            'max-age=63072000; includeSubDomains; preload'
        );
    });

    it('factory throws on invalid preload combination at call time', function () {
        assert.throws(function () {
            Hsts({ preload: true });
        }, /preload=true requires includeSubDomains=true/);
    });

    it('factory throws on invalid maxAge at call time', function () {
        assert.throws(function () { Hsts({ maxAge: -1 }); }, /non-negative integer/);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = Hsts();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing strict-transport-security header set upstream', function () {
        var mw  = Hsts();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'strict-transport-security': 'max-age=0' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('strict-transport-security'), 'max-age=0');
        assert.equal(nextCalled, true);
    });

    it('emits on POST requests (header is method-agnostic)', function () {
        var mw  = Hsts();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), 'max-age=15552000');
    });

    it('emits on HEAD requests', function () {
        var mw  = Hsts();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), 'max-age=15552000');
    });

    it('emits even on HTTP-shaped requests (no HTTPS gating — design decision)', function () {
        // Mimic an HTTP request (no x-forwarded-proto, no :scheme).
        // The middleware emits regardless — design favours proxy-deployment
        // robustness over RFC 6797 §7.2 sender-side spec purity.
        var mw  = Hsts();
        var req = { method: 'GET', url: '/', headers: {}, connection: { encrypted: false } };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), 'max-age=15552000');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = Hsts({ maxAge: 300 });
        var mw2 = Hsts({ maxAge: 9000 });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), 'max-age=300');
    });

});


// ─── 08 — Plugin registration in core/plugins/index.js ─────────────────────

describe('08 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('Hsts is wired to ./lib/security-headers/hsts', function () {
        assert.ok(
            /Hsts\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/hsts['"]\s*\)/.test(src),
            'expected Hsts registry entry'
        );
    });

    it('#HDR4 marker comment is present', function () {
        assert.ok(
            /#HDR4[^\n]*(HSTS|Strict-Transport-Security)/.test(src),
            'expected #HDR4 marker comment naming HSTS / Strict-Transport-Security'
        );
    });

});


// ─── 09 — Settings template advertises the slot + boilerplate ──────────────

describe('09 - settings.json template advertises hsts slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('hsts key is present with default fields', function () {
        assert.ok(
            /"hsts"\s*:\s*\{[\s\S]*?"maxAge"\s*:\s*15552000[\s\S]*?"includeSubDomains"\s*:\s*false[\s\S]*?"preload"\s*:\s*false/.test(src),
            'expected "hsts": { maxAge: 15552000, includeSubDomains: false, preload: false } block in settings template'
        );
    });

    it('#HDR4 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR4[^\n]*(HSTS|Strict-Transport-Security)/.test(src),
            'expected #HDR4 marker comment before the hsts block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.Hsts\(\)/.test(BP),
            'expected Hsts adoption example in bundle boilerplate'
        );
    });

});
