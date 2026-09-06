'use strict';
/**
 * #B502 — proxied-context truth for the req-less `getRoute()` singleton.
 *
 * A worker's `isProxyHost` latch is monotonic once any request has written
 * `process.gina.PROXY_HOSTNAME`, and `lib/routing getRoute()` resolved its
 * proxied classification and proxy hostname from those worker-globals alone.
 * A DIRECT request following one port-less-Host request therefore built its
 * absolute URLs from the worker-global: on an h1 bundle the port was lost
 * (isaac strips it before the router twin re-classified the request), on an
 * h2 bundle the last port-less client's host was emitted verbatim.
 *
 * Fix, two commits:
 *   R2  `handle()` always dispatches inside `process.gina._reqALS`; the router
 *       fills `store.proxy` after classification; `getRoute()` reads it before
 *       the latch. (this file's §01-§04, §10)
 *   R3  isaac's port-less branch derives its scheme like the router twin.
 *   R1  the router twin lets isaac's pre-strip classification win for the
 *       worker-global write too, not only for the slot fill. (§05-§06)
 *
 * Source pins are `indexOf` on the raw files; the behavioural replica (§10)
 * lifts getRoute's proxy resolution into a harness with a real
 * AsyncLocalStorage so two interleaved async contexts can be proven isolated.
 */
var test   = require('node:test');
var assert = require('node:assert');
var fs     = require('fs');
var path   = require('path');
var { AsyncLocalStorage } = require('async_hooks');

var FW      = path.resolve(__dirname, '../../framework/v0.6.28-alpha.2');
var SERVER  = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var ROUTER  = fs.readFileSync(path.join(FW, 'core/router.js'), 'utf8');
var ISAAC   = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');
var ROUTING = fs.readFileSync(path.join(FW, 'lib/routing/src/main.js'), 'utf8');

function region(src, startNeedle, endNeedle) {
    var s = src.indexOf(startNeedle);
    assert.ok(s > -1, 'region start not found: ' + startNeedle);
    var e = src.indexOf(endNeedle, s);
    assert.ok(e > s, 'region end not found after start: ' + endNeedle);
    return src.slice(s, e);
}

// ── R2 — the always-on request store ────────────────────────────────────────
test('#B502 §01 handle() dispatches inside _reqALS on EVERY request (the _reqCtxLogging gate no longer decides it)', function () {
    var h = region(SERVER, 'var handle = async function(req, res, next, bundle, pathname, config) {', 'var _handleDispatch');
    assert.ok(h.indexOf('process.gina._reqALS.run(') > -1, 'handle() runs inside _reqALS');
    assert.strictEqual(h.indexOf('if ( _reqCtxLogging ) {'), -1, 'the JSON-logging gate no longer wraps the .run()');
    assert.ok(h.indexOf('proxy') > -1, 'the store carries a proxy slot');
});

test('#B502 §02 router.js fills store.proxy after the engine-agnostic classification', function () {
    var r = region(ROUTER, 'var proxyReqIsProxied = (', 'if (!response._implicitHeader) {');
    assert.ok(r.indexOf('_reqALS') > -1, 'router reads the request store');
    assert.ok(r.indexOf('.proxy = {') > -1 || r.indexOf('.proxy={') > -1, 'router writes store.proxy');
});

test('#B502 §03 getRoute() reads the request store BEFORE the worker-global latch', function () {
    var g = region(ROUTING, 'self.getRoute = function(rule, params, urlIndex) {', 'var routing = config.getRouting(bundle, env);');
    var als = g.indexOf('_reqALS');
    var latch = g.indexOf("getContext('isProxyHost')");
    assert.ok(als > -1, 'getRoute consults process.gina._reqALS');
    assert.ok(latch > -1, 'the latch stays as the req-less fallback');
    assert.ok(als < latch, 'the store is consulted first');
});

test('#B502 §04 getRoute() prefers the request store proxy hostname over the worker-global', function () {
    var g = region(ROUTING, 'route.isProxyHost = isProxyHost;', 'if ( /\\,/.test(route.url) ) {');
    var i = g.indexOf('process.gina.PROXY_HOSTNAME || config.envConf._proxyHostname');
    assert.ok(i > -1, 'the worker-global fallback chain is intact');
    var before = g.slice(0, i);
    assert.ok(/proxy\.proxyHostname/.test(before) || /_stProxy/.test(before), 'a request-store hostname is tried before the worker-global');
});

// ── R1 — the router twin defers to isaac's pre-strip classification ─────────
test('#B502 §05 the router twin lets an existing isaac stamp decide proxyReqIsProxied', function () {
    var i = ROUTER.indexOf('var proxyReqIsProxied = (');
    assert.ok(i > -1);
    var def = ROUTER.slice(i, ROUTER.indexOf(';', i) + 1);
    assert.ok(def.indexOf("typeof(request._ginaIsProxyHost) != 'undefined'") > -1, 'the definition consults the isaac stamp first');
    assert.ok(def.indexOf('process.gina._proxyRequireForwarded !== true') > -1, 'the #B152 heuristic is intact for slot-less engines');
});

test('#B502 §06 the pinned twin lines are byte-identical (#B152 / #B67 pins keep firing)', function () {
    assert.ok(ROUTER.indexOf('if ( proxyReqIsProxied ) {') > -1);
    assert.ok(ROUTER.indexOf('process.gina.PROXY_HOSTNAME = proxyReqScheme') > -1);
    assert.ok(ROUTER.indexOf("if ( typeof(request._ginaIsProxyHost) == 'undefined' ) {") > -1);
});

// ── R3 — isaac's port-less branch scheme ────────────────────────────────────
test('#B502 §07 isaac derives the port-less-branch scheme like the router twin', function () {
    var b = region(ISAAC, 'var _thisReqProxied = (', 'process.gina.PROXY_HOSTNAME = request._ginaProxyHostname;');
    assert.strictEqual(b.indexOf("process.gina.PROXY_SCHEME +'://'+ _safeRequestHost"), -1, 'the PROXY_SCHEME-only form is gone');
    assert.ok(/\(\s*_safeScheme\s*\|\|\s*process\.gina\.PROXY_SCHEME\s*\|\|\s*options\.scheme\s*\)\s*\+'\:\/\/'\+\s*_safeRequestHost/.test(b), 'XFP, then PROXY_SCHEME, then the bundle scheme');
});

// ── §10 behavioural replica — the resolution rule under a real ALS ──────────
// Mirrors getRoute()'s server-branch rule (store first, latch second) so two
// interleaved async contexts can be shown isolated; the source pins above bind
// this replica to the shipped bytes.
function resolveLikeGetRoute(als, ctx, gina) {
    var st = als ? als.getStore() : null;
    var isProxyHost = (st && st.proxy) ? st.proxy.isProxyHost : ctx.isProxyHost;
    var proxyHostname = (st && st.proxy && st.proxy.proxyHostname) || gina.PROXY_HOSTNAME || null;
    return { isProxyHost: isProxyHost, hostname: isProxyHost ? proxyHostname : 'http://localhost:9999' };
}

test('#B502 §10a a direct request after a port-less one builds from static config, not the poisoned global', async function () {
    var als = new AsyncLocalStorage();
    var gina = { PROXY_HOSTNAME: 'http://probe.internal' };   // written by the port-less request
    var ctx  = { isProxyHost: true };                         // the monotonic latch
    var out = await als.run({ proxy: { isProxyHost: false, proxyHostname: null } }, async function () {
        await new Promise(function (r) { setTimeout(r, 2); });
        return resolveLikeGetRoute(als, ctx, gina);
    });
    assert.deepStrictEqual(out, { isProxyHost: false, hostname: 'http://localhost:9999' });
});

test('#B502 §10b a proxied request keeps ITS OWN host across an async gap while another context rewrites the global', async function () {
    var als = new AsyncLocalStorage();
    var gina = { PROXY_HOSTNAME: 'http://real.public' };
    var ctx  = { isProxyHost: true };
    var a = als.run({ proxy: { isProxyHost: true, proxyHostname: 'http://real.public' } }, async function () {
        await new Promise(function (r) { setTimeout(r, 5); });            // the async gap
        return resolveLikeGetRoute(als, ctx, gina);
    });
    var b = als.run({ proxy: { isProxyHost: true, proxyHostname: 'http://evil.example' } }, async function () {
        gina.PROXY_HOSTNAME = 'http://evil.example';                       // the racing port-less request
        return resolveLikeGetRoute(als, ctx, gina);
    });
    var res = await Promise.all([a, b]);
    assert.strictEqual(res[0].hostname, 'http://real.public', 'request A is unaffected by B');
    assert.strictEqual(res[1].hostname, 'http://evil.example', 'request B sees its own');
});

test('#B502 §10c without a store (req-less caller) the latch + worker-global rule is unchanged', function () {
    var out = resolveLikeGetRoute(null, { isProxyHost: true }, { PROXY_HOSTNAME: 'http://last.seen' });
    assert.deepStrictEqual(out, { isProxyHost: true, hostname: 'http://last.seen' });
    var off = resolveLikeGetRoute(null, { isProxyHost: false }, { PROXY_HOSTNAME: 'http://last.seen' });
    assert.strictEqual(off.hostname, 'http://localhost:9999');
});
