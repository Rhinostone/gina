'use strict';
/**
 * Origin-Agent-Cluster plugin (#HDR7) tests
 *
 * Strategy — mirrors the #HDR1 plugin test shape exactly (single fixed
 * header value, no _resolveValue helper, no validation surface):
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults) — no framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract.
 *  - Negative-invariant lock: header value is fixed to "?1" per the HTML
 *    spec; no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/origin-agent-cluster/src/main.js');

var OriginAgentCluster;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    OriginAgentCluster = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: ?1 response-header pattern is present ─────────

describe('01 - source inspection: ?1 response-header patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR7 marker is present', function () {
        assert.ok(src.indexOf('#HDR7') > -1, 'expected #HDR7 marker for traceability');
    });

    it('header name is origin-agent-cluster', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]origin-agent-cluster['"]/.test(src),
            'expected HEADER_NAME = origin-agent-cluster'
        );
    });

    it('header value is "?1" (Structured Header boolean true)', function () {
        assert.ok(
            /HEADER_VALUE\s*=\s*['"]\?1['"]/.test(src),
            'expected HEADER_VALUE = ?1'
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

    it('reads settings.json > originAgentCluster via content.settings.originAgentCluster', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.originAgentCluster/.test(src),
            'expected content.settings → originAgentCluster read chain'
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

    it('returned middleware is a named function (ginaOriginAgentCluster) for stack traces', function () {
        assert.ok(
            /function\s+ginaOriginAgentCluster\s*\(/.test(src),
            'expected the returned middleware to be a named function'
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
        var out = OriginAgentCluster._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no originAgentCluster key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = OriginAgentCluster._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through originAgentCluster block when present (future-proofing)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { originAgentCluster: { reservedField: 'someValue' } } } } }
            };
        };
        var out = OriginAgentCluster._resolveSettingsDefaults();
        assert.deepEqual(out, { reservedField: 'someValue' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = OriginAgentCluster._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = OriginAgentCluster._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = OriginAgentCluster._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = OriginAgentCluster._mergeOptions(undefined, { a: 1, b: 2 });
        assert.deepEqual(out, { a: 1, b: 2 });
    });

    it('caller overrides defaults for known keys', function () {
        var out = OriginAgentCluster._mergeOptions({ a: 'CALLER' }, { a: 'DEFAULT', b: 'KEEP' });
        assert.deepEqual(out, { a: 'CALLER', b: 'KEEP' });
    });

    it('caller adds keys not in defaults', function () {
        var out = OriginAgentCluster._mergeOptions({ extra: 'NEW' }, { a: 1 });
        assert.deepEqual(out, { a: 1, extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.own = 'OWN';
        var out = OriginAgentCluster._mergeOptions(caller, { d: 1 });
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
        var mw = OriginAgentCluster();
        assert.equal(typeof mw, 'function');
    });

    it('factory accepts an opts argument without throwing', function () {
        assert.doesNotThrow(function () { OriginAgentCluster({ futureField: true }); });
    });

    it('middleware sets origin-agent-cluster: ?1 on the response', function () {
        var mw  = OriginAgentCluster();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('origin-agent-cluster'), '?1');
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = OriginAgentCluster();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes();
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('idempotent — preserves an existing origin-agent-cluster header set upstream', function () {
        var mw  = OriginAgentCluster();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'origin-agent-cluster': '?0' });
        var nextCalled = false;
        mw(req, res, function () { nextCalled = true; });
        assert.equal(res.getHeader('origin-agent-cluster'), '?0');
        assert.equal(nextCalled, true);
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = OriginAgentCluster();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('origin-agent-cluster'), '?1');
    });

    it('works on HEAD requests', function () {
        var mw  = OriginAgentCluster();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('origin-agent-cluster'), '?1');
    });

    it('safe to register multiple times — first writer wins, no overwrite', function () {
        var mw1 = OriginAgentCluster();
        var mw2 = OriginAgentCluster();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw1(req, res, function () {});
        mw2(req, res, function () {});
        assert.equal(res.getHeader('origin-agent-cluster'), '?1');
    });

});


// ─── 05 — Plugin registration in core/plugins/index.js ─────────────────────

describe('05 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('OriginAgentCluster is wired to ./lib/security-headers/origin-agent-cluster', function () {
        assert.ok(
            /OriginAgentCluster\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/origin-agent-cluster['"]\s*\)/.test(src),
            'expected OriginAgentCluster registry entry'
        );
    });

    it('#HDR7 marker comment is present', function () {
        assert.ok(
            /#HDR7[^\n]*Origin-Agent-Cluster/.test(src),
            'expected #HDR7 marker comment naming Origin-Agent-Cluster'
        );
    });

});


// ─── 06 — Settings template advertises the slot ────────────────────────────

describe('06 - settings.json template advertises originAgentCluster slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('originAgentCluster key is present', function () {
        assert.ok(
            /"originAgentCluster"\s*:\s*\{/.test(src),
            'expected "originAgentCluster": { ... } block in settings template'
        );
    });

    it('#HDR7 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR7[^\n]*Origin-Agent-Cluster/.test(src),
            'expected #HDR7 marker comment before the originAgentCluster block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.OriginAgentCluster\(\)/.test(BP),
            'expected OriginAgentCluster adoption example in bundle boilerplate'
        );
    });

});
