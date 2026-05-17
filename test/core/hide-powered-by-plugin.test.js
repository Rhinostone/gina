'use strict';
/**
 * Hide X-Powered-By plugin (#HDR8) tests
 *
 * Strategy — mirrors the #HDR1 XContentTypeOptions no-opts test shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeOptions,
 *    _resolveSettingsDefaults) — no framework boot required.
 *  - End-to-end tests through stub req/res/next to verify the middleware
 *    contract: removeHeader called, next() invoked exactly once.
 *  - Negative-invariant lock: shape is REMOVE not SET (no res.setHeader
 *    call); no eval / new Function.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/security-headers/hide-powered-by/src/main.js');

var HidePoweredBy;
var originalGetContext;
var originalGetConfig;

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    HidePoweredBy = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: REMOVE-shape patterns are present ─────────────

describe('01 - source inspection: remove-header patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#HDR8 marker is present', function () {
        assert.ok(src.indexOf('#HDR8') > -1, 'expected #HDR8 marker for traceability');
    });

    it('header name is x-powered-by', function () {
        assert.ok(
            /HEADER_NAME\s*=\s*['"]x-powered-by['"]/.test(src),
            'expected HEADER_NAME = x-powered-by'
        );
    });

    it('middleware calls res.removeHeader with the constant', function () {
        assert.ok(
            /res\.removeHeader\(HEADER_NAME\)/.test(src),
            'expected res.removeHeader(HEADER_NAME) in middleware'
        );
    });

    it('middleware calls next() after the removeHeader call', function () {
        assert.ok(
            /res\.removeHeader\(HEADER_NAME[\s\S]*?next\(\)/.test(src),
            'expected next() to be called after res.removeHeader'
        );
    });

    it('NEGATIVE-INVARIANT: no res.setHeader call — this plugin is REMOVE shape', function () {
        assert.ok(
            !/res\.setHeader\(/.test(src),
            'HDR8 must NOT call res.setHeader — the whole point is to REMOVE the header'
        );
    });

    it('reads settings.json > hidePoweredBy via content.settings.hidePoweredBy', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.hidePoweredBy/.test(src),
            'expected content.settings → hidePoweredBy read chain'
        );
    });

    it('caller options win over defaults (mergeOptions hasOwnProperty)', function () {
        assert.ok(
            /hasOwnProperty\.call\(caller,\s*ck\)/.test(src),
            'expected merge to gate caller iteration on hasOwnProperty'
        );
    });

    it('removeHeader call is guarded by typeof check (safe under stub res)', function () {
        assert.ok(
            /typeof\s+res\.removeHeader\s*===?\s*['"]function['"]/.test(src),
            'expected typeof res.removeHeader === "function" guard'
        );
    });

    it('returned middleware is a named function (ginaHidePoweredBy) for stack traces', function () {
        assert.ok(
            /function\s+ginaHidePoweredBy\s*\(/.test(src),
            'expected the returned middleware to be a named function'
        );
    });

    it('documents Isaac-engine emit path + the settings gate in module JSDoc', function () {
        // Phase 2 (2026-05-14) introduced `_setPoweredByHeader(headers)` at
        // server.isaac.js:572-577 which gates every Isaac emit site on
        // `options.hidePoweredBy`. The pre-Phase-2 "writeHead bypasses
        // removeHeader" framing is replaced with the actual current
        // contract: middleware is a no-op on Isaac; the settings gate
        // suppresses across every emit site at once.
        assert.ok(
            /Isaac engine[\s\S]*_setPoweredByHeader/.test(src),
            'expected mention of the _setPoweredByHeader() helper as the Isaac emit path'
        );
        assert.ok(
            /server\.hidePoweredBy/.test(src),
            'expected the settings.json > server.hidePoweredBy gate to be named'
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
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('returns an empty object when no hidePoweredBy key', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { otherKey: { value: 'ignored' } } } } } };
        };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('passes through hidePoweredBy block when present (future-proofing)', function () {
        global.getConfig = function () {
            return {
                test: { dev: { content: { settings: { hidePoweredBy: { reservedField: 'someValue' } } } } }
            };
        };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, { reservedField: 'someValue' });
    });

    it('falls back to empty object on getConfig throw (defensive)', function () {
        global.getConfig = function () { throw new Error('boot context not ready'); };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

    it('falls back to empty object on getContext throw (defensive)', function () {
        global.getContext = function () { throw new Error('no ctx'); };
        var out = HidePoweredBy._resolveSettingsDefaults();
        assert.deepEqual(out, {});
    });

});


// ─── 03 — _mergeOptions: caller-supplied values win ────────────────────────

describe('03 - _mergeOptions: caller options always win', function () {

    it('returns empty object when both caller and defaults are empty', function () {
        var out = HidePoweredBy._mergeOptions(undefined, {});
        assert.deepEqual(out, {});
    });

    it('applies defaults when caller passes nothing', function () {
        var out = HidePoweredBy._mergeOptions(undefined, { a: 1, b: 2 });
        assert.deepEqual(out, { a: 1, b: 2 });
    });

    it('caller overrides defaults for known keys', function () {
        var out = HidePoweredBy._mergeOptions({ a: 'CALLER' }, { a: 'DEFAULT', b: 'KEEP' });
        assert.deepEqual(out, { a: 'CALLER', b: 'KEEP' });
    });

    it('caller adds keys not in defaults', function () {
        var out = HidePoweredBy._mergeOptions({ extra: 'NEW' }, { a: 1 });
        assert.deepEqual(out, { a: 1, extra: 'NEW' });
    });

    it('skips inherited keys on caller (hasOwnProperty guard)', function () {
        var caller = Object.create({ inherited: 'PROTO' });
        caller.own = 'OWN';
        var out = HidePoweredBy._mergeOptions(caller, { d: 1 });
        assert.deepEqual(out, { d: 1, own: 'OWN' });
        assert.equal(typeof out.inherited, 'undefined');
    });

});


// ─── 04 — Factory + middleware end-to-end ──────────────────────────────────

describe('04 - Factory + middleware behaviour', function () {

    function makeRes(initial) {
        var headers = Object.assign({}, initial || {});
        return {
            statusCode: 200,
            getHeader: function (n) {
                var v = headers[String(n).toLowerCase()];
                return typeof v === 'undefined' ? null : v;
            },
            setHeader: function (n, v) { headers[String(n).toLowerCase()] = v; },
            removeHeader: function (n) { delete headers[String(n).toLowerCase()]; },
            _headers: headers
        };
    }

    it('factory returns a function (express middleware shape)', function () {
        var mw = HidePoweredBy();
        assert.equal(typeof mw, 'function');
    });

    it('factory accepts an opts argument without throwing', function () {
        assert.doesNotThrow(function () { HidePoweredBy({ futureField: true }); });
    });

    it('middleware removes X-Powered-By when set upstream', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/0.3.15-alpha.3' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('middleware is a no-op when X-Powered-By is not set (idempotent)', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes();
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('middleware calls next() exactly once on success', function () {
        var mw    = HidePoweredBy();
        var req   = { method: 'GET', url: '/' };
        var res   = makeRes({ 'x-powered-by': 'Gina/X' });
        var calls = 0;
        mw(req, res, function () { calls++; });
        assert.equal(calls, 1);
    });

    it('middleware leaves OTHER headers alone — only removes x-powered-by', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({
            'x-powered-by': 'Gina/X',
            'content-type': 'text/html',
            'cache-control': 'no-cache'
        });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
        assert.equal(res.getHeader('content-type'),  'text/html');
        assert.equal(res.getHeader('cache-control'), 'no-cache');
    });

    it('works on POST requests (header is method-agnostic)', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'POST', url: '/api' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('works on HEAD requests', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'HEAD', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('typeof-guarded — does NOT throw on stub res without removeHeader', function () {
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        // Stub res with no removeHeader method (intentionally bare)
        var res = { statusCode: 200 };
        var nextCalled = false;
        assert.doesNotThrow(function () {
            mw(req, res, function () { nextCalled = true; });
        });
        assert.equal(nextCalled, true);
    });

    it('safe to register multiple times — second call is a no-op on already-removed header', function () {
        var mw1 = HidePoweredBy();
        var mw2 = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw1(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
        mw2(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
    });

    it('does NOT re-add the header if upstream code re-sets it AFTER this middleware', function () {
        // This is a sanity-check on the documented behaviour: HidePoweredBy
        // only removes the header at the time it runs. If a later middleware
        // re-sets it, that re-add WINS (header is back in the response).
        var mw  = HidePoweredBy();
        var req = { method: 'GET', url: '/' };
        var res = makeRes({ 'x-powered-by': 'Gina/X' });
        mw(req, res, function () {});
        assert.equal(res.getHeader('x-powered-by'), null);
        // Simulate a later middleware re-setting it:
        res.setHeader('x-powered-by', 'Re-added/1.0');
        assert.equal(res.getHeader('x-powered-by'), 'Re-added/1.0');
    });

});


// ─── 05 — Plugin registration in core/plugins/index.js ─────────────────────

describe('05 - plugin is registered in core/plugins/index.js', function () {

    var REGISTRY = path.join(FW, 'core/plugins/index.js');
    var src;
    before(function () { src = fs.readFileSync(REGISTRY, 'utf8'); });

    it('HidePoweredBy is wired to ./lib/security-headers/hide-powered-by', function () {
        assert.ok(
            /HidePoweredBy\s*:\s*_require\(\s*['"]\.\/lib\/security-headers\/hide-powered-by['"]\s*\)/.test(src),
            'expected HidePoweredBy registry entry'
        );
    });

    it('#HDR8 marker comment is present', function () {
        assert.ok(
            /#HDR8[^\n]*X-Powered-By/.test(src),
            'expected #HDR8 marker comment naming X-Powered-By'
        );
    });

});


// ─── 06 — Settings template advertises the slot + boilerplate ──────────────

describe('06 - settings.json template advertises hidePoweredBy slot', function () {

    var TEMPLATE = path.join(FW, 'core/template/conf/settings.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('hidePoweredBy key is present', function () {
        assert.ok(
            /"hidePoweredBy"\s*:\s*\{/.test(src),
            'expected "hidePoweredBy": { ... } block in settings template'
        );
    });

    it('#HDR8 marker comment is present', function () {
        assert.ok(
            /\/\/\s*#HDR8[^\n]*X-Powered-By/.test(src),
            'expected #HDR8 marker comment before the hidePoweredBy block'
        );
    });

    it('boilerplate bundle/index.js advertises the adoption example', function () {
        var BP = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(
            /\$\{bundle\}\.plugins\.HidePoweredBy\(\)/.test(BP),
            'expected HidePoweredBy adoption example in bundle boilerplate'
        );
    });

});


// ─── 07 — env.json template carries no X-Powered-By default (dead-code drop) ─

describe('07 - env.json template carries no X-Powered-By default', function () {

    // 2026-05-17 — the env.json template `response.header` block previously
    // shipped `"X-Powered-By": "Gina I/O - v${version}"` as a default. It was
    // structurally dead: server.js:2425's setHeader OVERWRITES it on Express
    // before any middleware runs, and server.isaac.js does not read
    // `server.response.header` at all. Dropping it has zero observable wire
    // effect AND resolves a format inconsistency (only the canonical
    // `Gina/<version>` shape remains on the wire). This section locks the
    // drop so it cannot silently regress.

    var TEMPLATE = path.join(FW, 'core/template/conf/env.json');
    var src;
    before(function () { src = fs.readFileSync(TEMPLATE, 'utf8'); });

    it('env.json template does NOT define an X-Powered-By default', function () {
        // Match any quoted "X-Powered-By" KEY in the source (case-insensitive)
        // — would be the dead default if it came back. The comment block
        // describing why it's intentionally absent does not contain a quoted
        // key (only the bare token "X-Powered-By"), so a key match would
        // catch a regression even with the why-not comment present.
        assert.ok(
            !/"X-Powered-By"\s*:/i.test(src),
            'env.json template must NOT carry an X-Powered-By default; it would be ' +
            'dead code (overwritten on Express, ignored on Isaac)'
        );
    });

    it('env.json template carries a why-not anchor explaining the absence', function () {
        // Future maintainers diffing the template will see the comment block
        // and understand why no X-Powered-By default lives here.
        assert.ok(
            /X-Powered-By is intentionally NOT set here/.test(src),
            'expected a why-not anchor comment in env.json response.header block'
        );
    });

});


// ─── 08 — server.isaac.js Phase 2 gate is wired ──────────────────────────────

describe('08 - server.isaac.js _setPoweredByHeader Phase 2 gate is wired', function () {

    // Phase 2 (2026-05-14) added `_setPoweredByHeader(headers)` at
    // server.isaac.js:572-577 as the central X-Powered-By emission point
    // for the Isaac engine. Every Isaac writeHead/setHeader emit site runs
    // its headers object through this helper, so flipping
    // `settings.json > server.hidePoweredBy: true` suppresses the header
    // across every site at once. These pins ensure the gate stays wired.

    var ISAAC = path.join(FW, 'core/server.isaac.js');
    var src;
    before(function () { src = fs.readFileSync(ISAAC, 'utf8'); });

    it('_setPoweredByHeader helper is defined', function () {
        assert.ok(
            /var\s+_setPoweredByHeader\s*=\s*function\s*\(\s*headers\s*\)/.test(src),
            'expected `var _setPoweredByHeader = function (headers) { ... }` in server.isaac.js'
        );
    });

    it('_setPoweredByHeader gates on options.hidePoweredBy', function () {
        assert.ok(
            /_setPoweredByHeader[\s\S]{0,400}if\s*\(\s*!\s*options\.hidePoweredBy\s*\)/.test(src),
            'expected `if (!options.hidePoweredBy)` gate inside _setPoweredByHeader'
        );
    });

    it('_setPoweredByHeader writes the canonical Gina/<version> format', function () {
        assert.ok(
            /headers\[['"]X-Powered-By['"]\]\s*=\s*['"]Gina\/['"]\s*\+\s*GINA_VERSION/.test(src),
            'expected canonical Gina/<version> wire format (not the legacy Gina I/O - v${version} env.json shape)'
        );
    });

    it('routing.json asset setHeader site is gated on options.hidePoweredBy', function () {
        // server.isaac.js:1187-1188 — the one direct setHeader emit site
        // (the /_gina/assets/routing.json handler uses setHeader rather
        // than the writeHead headers object).
        assert.ok(
            /if\s*\(\s*!\s*options\.hidePoweredBy\s*\)\s*\{[\s\S]{0,200}response\.setHeader\(\s*['"]X-Powered-By['"]/.test(src),
            'expected the routing.json asset setHeader X-Powered-By call to be gated on options.hidePoweredBy'
        );
    });

    it('at least 10 writeHead sites pass headers through _setPoweredByHeader', function () {
        // The exact count drifts as /_gina/* endpoints are added/removed.
        // 10 is a conservative floor — at write-time there are ~13 such
        // sites. A regression that removed the gate at half of them would
        // still be caught.
        var matches = src.match(/_setPoweredByHeader\s*\(\s*\{/g) || [];
        assert.ok(
            matches.length >= 10,
            'expected at least 10 _setPoweredByHeader({...}) call sites in server.isaac.js, got ' + matches.length
        );
    });

});
