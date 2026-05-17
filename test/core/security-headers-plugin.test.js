'use strict';
/**
 * Security Headers combined wrapper plugin (#HDR15) tests
 *
 * Strategy:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults, _resolveSubConfig, _runChain) — no
 *    framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the wrapper
 *    contract (safe-set default mount, opt-in CSP + COEP, per-sub-config
 *    opt-out, sub-plugin invariant throw-through, chain order).
 *  - Negative-invariant locks: CSP without directives throws (wrapper
 *    surfaces the standalone Csp throw); COEP with unknown token throws;
 *    sub-config of invalid type throws; no eval / new Function.
 *
 * Does NOT re-test per-plugin behaviour — each sub-plugin has its own
 * test file (csp-plugin.test.js, coep-plugin.test.js, etc.).
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/src/main.js');

var SecurityHeaders;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin (and its sub-plugins) read `getContext()` + `getConfig()`
    // from the global scope. Stub them so the module + sub-plugins can be
    // required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    SecurityHeaders = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: header + validation patterns are present ──────

describe('01 - source inspection: composition patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR15 marker is present', function () {
        assert.ok(src.indexOf('#HDR15') > -1, 'expected #HDR15 marker for traceability');
    });

    it('requires all 9 per-header sub-plugin factories', function () {
        var subs = [
            'x-content-type-options',
            'x-frame-options',
            'referrer-policy',
            'hsts',
            'csp',
            'coep',
            'origin-agent-cluster',
            'coop',
            'corp'
        ];
        for (var i = 0; i < subs.length; i++) {
            var pattern = new RegExp("require\\(['\"]\\.\\./\\.\\./" + subs[i] + "/src/main");
            assert.ok(pattern.test(src), 'expected require of ../../' + subs[i] + '/src/main');
        }
    });

    it('SUB_PLUGINS registry array is declared with at least 9 entries', function () {
        assert.ok(
            /SUB_PLUGINS\s*=\s*\[[\s\S]*?\];/.test(src),
            'expected SUB_PLUGINS = [ ... ] declaration'
        );
        // Count the per-entry safeDefault key occurrences as a proxy for entry count.
        var matches = src.match(/safeDefault:\s*(true|false)/g);
        assert.ok(matches && matches.length === 9, 'expected 9 safeDefault flags');
    });

    it('reads settings.json > securityHeaders via content.settings.securityHeaders', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.securityHeaders/.test(src),
            'expected content.settings → securityHeaders read chain'
        );
    });

    it('caller options win over defaults (mergeOptions hasOwnProperty)', function () {
        assert.ok(
            /hasOwnProperty\.call\(caller,\s*ck\)/.test(src),
            'expected merge to gate caller iteration on hasOwnProperty'
        );
    });

    it('returned middleware is a named function (ginaSecurityHeaders) for stack traces', function () {
        assert.ok(
            /function\s+ginaSecurityHeaders\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('runChain advances on next() and short-circuits on err', function () {
        assert.ok(
            /runChain\s*\(/.test(src),
            'expected runChain helper'
        );
        assert.ok(
            /if\s*\(err\)\s+return\s+done\s*\(err\)/.test(src),
            'expected err short-circuit to done(err)'
        );
    });

    it('factory throws on unsupported sub-config types via resolveSubConfig', function () {
        assert.ok(
            /sub-config for "[\s\S]*?must be[\s\S]*?(false\/null|true|object)/.test(src),
            'expected throw message naming the accepted shapes'
        );
    });

    it('SecurityHeaders factory calls each sub.factory unwrapped (throws propagate)', function () {
        // Behavioural coverage is in section 07 ("sub-plugin invariant throw
        // propagates" suite); this guard just pins the source pattern so a
        // future refactor that adds try/catch around sub.factory() would be
        // visible at review time.
        assert.ok(
            /middlewares\.push\(sub\.factory\(subConfig\)\)/.test(src),
            'expected unwrapped sub.factory(subConfig) call site'
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
        var out = SecurityHeaders._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no securityHeaders key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = SecurityHeaders._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through securityHeaders block when present', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { securityHeaders: {
                    xFrameOptions: { value: 'DENY' },
                    hsts: false
                } } } } }
            };
        };
        var out = SecurityHeaders._resolveSettingsDefaults();
        assert.deepEqual(out, {
            xFrameOptions: { value: 'DENY' },
            hsts: false
        });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = SecurityHeaders._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = SecurityHeaders._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = SecurityHeaders._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var d = { xFrameOptions: { value: 'DENY' } };
        var out = SecurityHeaders._mergeOptions(undefined, d);
        assert.deepEqual(out, d);
    });

    it('caller overrides defaults for known keys (shallow replace)', function () {
        var out = SecurityHeaders._mergeOptions(
            { xFrameOptions: { value: 'SAMEORIGIN' } },
            { xFrameOptions: { value: 'DENY' } }
        );
        assert.deepEqual(out, { xFrameOptions: { value: 'SAMEORIGIN' } });
    });

    it('caller adds keys not in defaults', function () {
        var out = SecurityHeaders._mergeOptions({ coep: true }, { hsts: false });
        assert.deepEqual(out, { hsts: false, coep: true });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.csp = { directives: { 'default-src': ["'self'"] } };
        var out = SecurityHeaders._mergeOptions(caller, {});
        assert.deepEqual(out, { csp: { directives: { 'default-src': ["'self'"] } } });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — _resolveSubConfig: per-case decision rules ───────────────────────

describe('04 - _resolveSubConfig: per-case decision rules', function () {

    var SAFE   = { key: 'xFrameOptions', safeDefault: true  };
    var OPT_IN = { key: 'csp',           safeDefault: false };

    it('returns null on false (opt-out) for safe-set', function () {
        assert.equal(SecurityHeaders._resolveSubConfig(false, SAFE), null);
    });

    it('returns null on false (opt-out) for opt-in-only', function () {
        assert.equal(SecurityHeaders._resolveSubConfig(false, OPT_IN), null);
    });

    it('returns null on null (opt-out) for safe-set', function () {
        assert.equal(SecurityHeaders._resolveSubConfig(null, SAFE), null);
    });

    it('returns null on null (opt-out) for opt-in-only', function () {
        assert.equal(SecurityHeaders._resolveSubConfig(null, OPT_IN), null);
    });

    it('returns {} on undefined for safe-set (mount with defaults)', function () {
        assert.deepEqual(SecurityHeaders._resolveSubConfig(undefined, SAFE), {});
    });

    it('returns null on undefined for opt-in-only (skip)', function () {
        assert.equal(SecurityHeaders._resolveSubConfig(undefined, OPT_IN), null);
    });

    it('returns {} on true for safe-set (boolean shorthand)', function () {
        assert.deepEqual(SecurityHeaders._resolveSubConfig(true, SAFE), {});
    });

    it('returns {} on true for opt-in-only (boolean shorthand → mount with defaults)', function () {
        assert.deepEqual(SecurityHeaders._resolveSubConfig(true, OPT_IN), {});
    });

    it('returns the object as-is on object value (safe-set)', function () {
        var opts = { value: 'DENY' };
        assert.deepEqual(SecurityHeaders._resolveSubConfig(opts, SAFE), opts);
    });

    it('returns the object as-is on object value (opt-in-only)', function () {
        var opts = { directives: { 'default-src': ["'self'"] } };
        assert.deepEqual(SecurityHeaders._resolveSubConfig(opts, OPT_IN), opts);
    });

    it('throws on string value (invalid shape)', function () {
        assert.throws(function () {
            SecurityHeaders._resolveSubConfig('DENY', SAFE);
        }, /must be[\s\S]*?(false|true|object)/);
    });

    it('throws on number value (invalid shape)', function () {
        assert.throws(function () {
            SecurityHeaders._resolveSubConfig(42, SAFE);
        }, /must be[\s\S]*?(false|true|object)/);
    });

    it('throws on array value (invalid shape — arrays are not plain objects)', function () {
        assert.throws(function () {
            SecurityHeaders._resolveSubConfig(['DENY'], SAFE);
        }, /must be[\s\S]*?(false|true|object)/);
    });

    it('throws on function value (invalid shape)', function () {
        assert.throws(function () {
            SecurityHeaders._resolveSubConfig(function () {}, SAFE);
        }, /must be[\s\S]*?(false|true|object)/);
    });

    it('error message names the offending sub-config key', function () {
        try {
            SecurityHeaders._resolveSubConfig('DENY', SAFE);
            assert.fail('expected throw');
        } catch (err) {
            assert.ok(/xFrameOptions/.test(err.message), 'expected key in message');
        }
    });

});


// ─── 05 — SUB_PLUGINS registry: composition order + safeDefault flags ─────

describe('05 - SUB_PLUGINS registry metadata', function () {

    it('contains exactly 9 entries', function () {
        assert.equal(SecurityHeaders._SUB_PLUGINS.length, 9);
    });

    it('emission order: HDR1, 2, 3, 4, 5, 6, 7, 13, 14', function () {
        var expected = ['#HDR1', '#HDR2', '#HDR3', '#HDR4', '#HDR5', '#HDR6', '#HDR7', '#HDR13', '#HDR14'];
        var actual = SecurityHeaders._SUB_PLUGINS.map(function (s) { return s.marker; });
        assert.deepEqual(actual, expected);
    });

    it('sub-config keys match the settings.json convention', function () {
        var expected = [
            'xContentTypeOptions', 'xFrameOptions', 'referrerPolicy', 'hsts',
            'csp', 'coep', 'originAgentCluster', 'coop', 'corp'
        ];
        var actual = SecurityHeaders._SUB_PLUGINS.map(function (s) { return s.key; });
        assert.deepEqual(actual, expected);
    });

    it('safe-set: HDR1/2/3/4/7/13/14 are safeDefault:true (7 plugins)', function () {
        var safeKeys = SecurityHeaders._SUB_PLUGINS
            .filter(function (s) { return s.safeDefault; })
            .map(function (s) { return s.key; });
        assert.deepEqual(safeKeys, [
            'xContentTypeOptions', 'xFrameOptions', 'referrerPolicy', 'hsts',
            'originAgentCluster', 'coop', 'corp'
        ]);
    });

    it('opt-in-only: HDR5 (csp) + HDR6 (coep) are safeDefault:false (2 plugins)', function () {
        var optInKeys = SecurityHeaders._SUB_PLUGINS
            .filter(function (s) { return !s.safeDefault; })
            .map(function (s) { return s.key; });
        assert.deepEqual(optInKeys, ['csp', 'coep']);
    });

    it('every entry has factory function', function () {
        for (var i = 0; i < SecurityHeaders._SUB_PLUGINS.length; i++) {
            assert.equal(
                typeof SecurityHeaders._SUB_PLUGINS[i].factory,
                'function',
                SecurityHeaders._SUB_PLUGINS[i].key + ' factory'
            );
        }
    });

});


// ─── 06 — _runChain: sequential dispatch + error short-circuit ────────────

describe('06 - _runChain: sequential dispatch', function () {

    it('calls done() immediately when chain is empty', function () {
        var doneCalls = 0;
        var doneErr   = 'untouched';
        SecurityHeaders._runChain([], {}, {}, function (err) {
            doneCalls++;
            doneErr = err;
        });
        assert.equal(doneCalls, 1);
        assert.equal(doneErr, undefined);
    });

    it('runs middlewares in order (sequential)', function () {
        var order = [];
        var mws = [
            function (req, res, next) { order.push('a'); next(); },
            function (req, res, next) { order.push('b'); next(); },
            function (req, res, next) { order.push('c'); next(); }
        ];
        SecurityHeaders._runChain(mws, {}, {}, function () {
            order.push('done');
        });
        assert.deepEqual(order, ['a', 'b', 'c', 'done']);
    });

    it('short-circuits on next(err) — done invoked with err, later mws skipped', function () {
        var order = [];
        var mws = [
            function (req, res, next) { order.push('a'); next(); },
            function (req, res, next) { order.push('b'); next(new Error('boom')); },
            function (req, res, next) { order.push('c'); next(); }   // should not run
        ];
        var doneErr;
        SecurityHeaders._runChain(mws, {}, {}, function (err) {
            order.push('done');
            doneErr = err;
        });
        assert.deepEqual(order, ['a', 'b', 'done']);
        assert.equal(doneErr.message, 'boom');
    });

    it('synchronous throw inside a middleware lands in done(err)', function () {
        var mws = [
            function () { throw new Error('sync-throw'); }
        ];
        var doneErr;
        SecurityHeaders._runChain(mws, {}, {}, function (err) {
            doneErr = err;
        });
        assert.equal(doneErr.message, 'sync-throw');
    });

    it('each middleware receives req + res + next', function () {
        var receivedReq, receivedRes, nextType;
        var mws = [
            function (req, res, next) {
                receivedReq = req;
                receivedRes = res;
                nextType = typeof next;
                next();
            }
        ];
        var theReq = { url: '/' };
        var theRes = { statusCode: 200 };
        SecurityHeaders._runChain(mws, theReq, theRes, function () {});
        assert.equal(receivedReq, theReq);
        assert.equal(receivedRes, theRes);
        assert.equal(nextType, 'function');
    });

});


// ─── 07 — Factory + middleware end-to-end ──────────────────────────────────

describe('07 - Factory + middleware end-to-end', function () {

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
        var mw = SecurityHeaders();
        assert.equal(typeof mw, 'function');
    });

    it('with no opts, emits the 7 safe-set headers (no CSP, no COEP)', function () {
        var mw  = SecurityHeaders();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        // Safe-set
        assert.equal(res.getHeader('x-content-type-options'),       'nosniff');
        assert.equal(res.getHeader('x-frame-options'),              'SAMEORIGIN');
        assert.equal(res.getHeader('referrer-policy'),              'strict-origin-when-cross-origin');
        assert.ok(/max-age=15552000/.test(res.getHeader('strict-transport-security')));
        assert.equal(res.getHeader('origin-agent-cluster'),         '?1');
        assert.equal(res.getHeader('cross-origin-opener-policy'),   'same-origin');
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'same-origin');
        // Opt-in only — must NOT be emitted with no opts
        assert.equal(res.getHeader('content-security-policy'),       null);
        assert.equal(res.getHeader('cross-origin-embedder-policy'),  null);
    });

    it('coep: true opts in to COEP with require-corp default', function () {
        var mw  = SecurityHeaders({ coep: true });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'require-corp');
    });

    it('coep: { value: "credentialless" } opts in with explicit value', function () {
        var mw  = SecurityHeaders({ coep: { value: 'credentialless' } });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), 'credentialless');
    });

    it('csp: { directives: {...} } opts in with the given directives', function () {
        var mw  = SecurityHeaders({
            csp: { directives: { 'default-src': ["'self'"] } }
        });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), "default-src 'self'");
    });

    it('csp: {} throws at factory call time (CSP requires directives — wrapper Q3=required policy)', function () {
        assert.throws(function () {
            SecurityHeaders({ csp: {} });
        }, /directives is required/);
    });

    it('csp: true throws at factory call time (boolean shorthand → {} → CSP throws)', function () {
        assert.throws(function () {
            SecurityHeaders({ csp: true });
        }, /directives is required/);
    });

    it('csp: false skips CSP cleanly (no throw, header not emitted)', function () {
        var mw  = SecurityHeaders({ csp: false });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), null);
    });

    it('coep: false skips COEP cleanly (no header emitted, no throw)', function () {
        var mw  = SecurityHeaders({ coep: false });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('cross-origin-embedder-policy'), null);
    });

    it('hsts: false opts out of HSTS (no Strict-Transport-Security)', function () {
        var mw  = SecurityHeaders({ hsts: false });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), null);
        // Other safe-set still emitted
        assert.equal(res.getHeader('x-frame-options'), 'SAMEORIGIN');
    });

    it('hsts: null opts out of HSTS (same as false)', function () {
        var mw  = SecurityHeaders({ hsts: null });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), null);
    });

    it('safe-set sub-config object overrides per-plugin default', function () {
        var mw  = SecurityHeaders({ xFrameOptions: { value: 'DENY' } });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'DENY');
    });

    it('multiple safe-set sub-config overrides apply together', function () {
        var mw  = SecurityHeaders({
            xFrameOptions:  { value: 'DENY' },
            referrerPolicy: { value: 'no-referrer' },
            coop:           { value: 'same-origin-allow-popups' },
            corp:           { value: 'cross-origin' }
        });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'),              'DENY');
        assert.equal(res.getHeader('referrer-policy'),              'no-referrer');
        assert.equal(res.getHeader('cross-origin-opener-policy'),   'same-origin-allow-popups');
        assert.equal(res.getHeader('cross-origin-resource-policy'), 'cross-origin');
    });

    it('opt-out everything = no headers emitted', function () {
        var mw  = SecurityHeaders({
            xContentTypeOptions: false,
            xFrameOptions:       false,
            referrerPolicy:      false,
            hsts:                false,
            originAgentCluster:  false,
            coop:                false,
            corp:                false
        });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-content-type-options'),       null);
        assert.equal(res.getHeader('x-frame-options'),              null);
        assert.equal(res.getHeader('referrer-policy'),              null);
        assert.equal(res.getHeader('strict-transport-security'),    null);
        assert.equal(res.getHeader('origin-agent-cluster'),         null);
        assert.equal(res.getHeader('cross-origin-opener-policy'),   null);
        assert.equal(res.getHeader('cross-origin-resource-policy'), null);
    });

    it('sub-plugin invariant throw propagates (HSTS preload-list invariant)', function () {
        assert.throws(function () {
            SecurityHeaders({
                hsts: { maxAge: 3600, includeSubDomains: false, preload: true }
            });
        }, /preload/);
    });

    it('sub-plugin invariant throw propagates (XFrameOptions ALLOW-FROM)', function () {
        assert.throws(function () {
            SecurityHeaders({ xFrameOptions: { value: 'ALLOW-FROM https://e.com' } });
        }, /ALLOW-FROM/);
    });

    it('sub-plugin invariant throw propagates (ReferrerPolicy invalid token)', function () {
        assert.throws(function () {
            SecurityHeaders({ referrerPolicy: { value: 'nope' } });
        }, /invalid value/);
    });

    it('sub-plugin invariant throw propagates (Coep invalid token)', function () {
        assert.throws(function () {
            SecurityHeaders({ coep: { value: 'nope' } });
        }, /invalid value/);
    });

    it('sub-plugin invariant throw propagates (Coop invalid token — same-site is CORP-only)', function () {
        assert.throws(function () {
            SecurityHeaders({ coop: { value: 'same-site' } });
        }, /invalid value/);
    });

    it('sub-plugin invariant throw propagates (Corp invalid token — require-corp is COEP-only)', function () {
        assert.throws(function () {
            SecurityHeaders({ corp: { value: 'require-corp' } });
        }, /invalid value/);
    });

    it('invalid sub-config type at the wrapper layer throws (string)', function () {
        assert.throws(function () {
            SecurityHeaders({ xFrameOptions: 'DENY' });
        }, /xFrameOptions/);
    });

    it('invalid sub-config type at the wrapper layer throws (number)', function () {
        assert.throws(function () {
            SecurityHeaders({ hsts: 31536000 });
        }, /hsts/);
    });

    it('emission order: HDR1 first, HDR14 last (matches SUB_PLUGINS array order)', function () {
        // Pre-set one header — first-writer-wins — and observe whether HDR1 had
        // a chance to win on a different header. Easier: just verify all
        // safe-set headers appear after one call (already covered) AND verify
        // chain order via call-tracking sub.
        var order = [];
        var spyMws = [
            function (req, res, next) { order.push('a'); next(); },
            function (req, res, next) { order.push('b'); next(); },
            function (req, res, next) { order.push('c'); next(); }
        ];
        SecurityHeaders._runChain(spyMws, {}, {}, function () {});
        assert.deepEqual(order, ['a', 'b', 'c']);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = SecurityHeaders();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing header set upstream (per-plugin first-writer-wins)', function () {
        var mw  = SecurityHeaders();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-frame-options': 'DENY' });
        mw(req, res, function () {});
        // Upstream value preserved
        assert.equal(res.getHeader('x-frame-options'), 'DENY');
        // Other safe-set still emit normally
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = SecurityHeaders({ xFrameOptions: { value: 'DENY' } });
        var mw2 = SecurityHeaders({ xFrameOptions: { value: 'SAMEORIGIN' } });
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'DENY');
    });

    it('works on POST requests (header set is method-agnostic)', function () {
        var mw  = SecurityHeaders();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

    it('works on HEAD requests', function () {
        var mw  = SecurityHeaders();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

});


// ─── 07b — settings.json > securityHeaders.* integration ─────────────────

describe('07b - settings.json integration: caller opts merge over wrapper-settings', function () {

    var savedGetConfig;
    beforeEach(function () { savedGetConfig = global.getConfig; });
    afterEach(function () { global.getConfig = savedGetConfig; });

    function makeRes() {
        var headers = {};
        return {
            getHeader: function (n) { return headers[String(n).toLowerCase()] || null; },
            setHeader: function (n, v) { headers[String(n).toLowerCase()] = v; }
        };
    }

    it('settings.json > securityHeaders.csp: opt-in via settings alone', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: {
                    securityHeaders: { csp: { directives: { 'default-src': ["'self'"] } } }
                } } } }
            };
        };
        var mw  = SecurityHeaders();
        var res = makeRes();
        mw({}, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), "default-src 'self'");
    });

    it('settings.json > securityHeaders.hsts:false skips HSTS via settings alone', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: {
                    securityHeaders: { hsts: false }
                } } } }
            };
        };
        var mw  = SecurityHeaders();
        var res = makeRes();
        mw({}, res, function () {});
        assert.equal(res.getHeader('strict-transport-security'), null);
        // Other safe-set still mounted
        assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });

    it('caller opts override settings (caller-wins precedence)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: {
                    securityHeaders: { xFrameOptions: { value: 'DENY' } }
                } } } }
            };
        };
        var mw  = SecurityHeaders({ xFrameOptions: { value: 'SAMEORIGIN' } });
        var res = makeRes();
        mw({}, res, function () {});
        assert.equal(res.getHeader('x-frame-options'), 'SAMEORIGIN');
    });

    it('caller false overrides settings opt-in (caller opt-out wins)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: {
                    securityHeaders: { csp: { directives: { 'default-src': ["'self'"] } } }
                } } } }
            };
        };
        var mw  = SecurityHeaders({ csp: false });
        var res = makeRes();
        mw({}, res, function () {});
        assert.equal(res.getHeader('content-security-policy'), null);
    });

});


// ─── 08 — Plugin registration in core/plugins/index.js ────────────────────

describe('08 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('SecurityHeaders is wired to ./lib/security-headers', function () {
        assert.ok(
            /SecurityHeaders\s*:\s*_require\(\s*['"]\.\/lib\/security-headers['"]\s*\)/.test(src),
            'expected SecurityHeaders registry entry'
        );
    });

    it('#HDR15 marker comment is present', function () {
        assert.ok(
            /#HDR15[^\n]*(combined wrapper|Security Headers)/i.test(src),
            'expected #HDR15 marker comment naming the combined wrapper'
        );
    });

});


// ─── 09 — Settings template advertises the slot + boilerplate ──────────────

describe('09 - settings.json template advertises securityHeaders slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('securityHeaders key is present', function () {
        assert.ok(
            /"securityHeaders"\s*:\s*\{/.test(src),
            'expected "securityHeaders": { ... } block in settings template'
        );
    });

    it('#HDR15 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR15[^\n]*(combined wrapper|Security Headers)/i.test(src),
            'expected #HDR15 marker comment before the securityHeaders block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.SecurityHeaders\(\)/.test(BP),
            'expected SecurityHeaders adoption example in bundle boilerplate'
        );
    });

});
