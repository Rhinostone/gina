'use strict';
/**
 * #B152 — worker-global proxy-context poisoning by port-less internal calls
 *
 * A request whose inbound Host carries no `:port` is classified "proxied" and
 * REWRITES the worker-global process.gina.PROXY_HOST / PROXY_HOSTNAME — but a
 * port-less Host is also what an internal call addressed by service/DNS name
 * carries (container health probe on an app route, mesh hop, sibling-bundle
 * request). Every later worker-global read (the getUrl template filters, the
 * redirect/throwError getRoute().toUrl() callers) then emitted the INTERNAL
 * host. The fix set:
 *   1. router.js fills the #B65 per-request slots when absent (engine-agnostic
 *      — the Express engine never had them; isaac's earlier write always wins),
 *   2. both getUrl filters + the two controller.js toUrl callers prefer THIS
 *      request's slots over the worker-global latch (global stays the req-less
 *      fallback, byte-identical when slot-less),
 *   3. opt-in `server.proxy.requireForwardedHeaders` disables the port-less
 *      heuristic entirely (X-Forwarded-Host required) — the only mechanism that
 *      protects req-less renders, which read the global by design.
 *
 * Strategy: source inspection + inline logic replicas + a REAL lib/routing
 * getRoute()/toUrl() harness (the routing-fixes §07 recipe — node:test runs
 * each file in its own process, so the global injection cannot leak).
 * No live HTTP server, no framework bootstrap, no project required.
 *
 * Suites:
 *  01 — swig-filters source pins (reader re-point: init, both hostname sites, url override)
 *  02 — nunjucks-filters source pins (mirror of 01)
 *  03 — router.js source pins (slot fill-when-absent + requireForwardedHeaders term)
 *  04 — server.isaac.js source pin (requireForwardedHeaders term inside _thisReqProxied)
 *  05 — server.js source pins (boot-resolve of process.gina._proxyRequireForwarded)
 *  06 — controller.js source pins (redirect + throwError route-object re-points)
 *  07 — schema/settings.json declares server.proxy.requireForwardedHeaders
 *  08 — replica: classification predicate matrix (default heuristic vs opt-in)
 *  09 — replica: router slot-fill derivation (fill-when-absent, XFH-wins, isaac-wins)
 *  10 — REAL lib/routing: poisoned worker-global vs per-request re-point + SUBTRACT
 *  11 — replica: getUrl path-form host chain + per-request isProxyHost init
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW   = require('../fw');
var REPO = path.join(FW, '..', '..');

var SWIG_PATH   = path.join(FW, 'lib/swig-filters/src/main.js');
var NUNJ_PATH   = path.join(FW, 'lib/nunjucks-filters/src/main.js');
var ROUTER_PATH = path.join(FW, 'core/router.js');
var ISAAC_PATH  = path.join(FW, 'core/server.isaac.js');
var SERVER_PATH = path.join(FW, 'core/server.js');
var CTRL_PATH   = path.join(FW, 'core/controller/controller.js');
var ROUTING_SRC = path.join(FW, 'lib/routing/src/main.js');

var swigSrc   = fs.readFileSync(SWIG_PATH, 'utf8');
var nunjSrc   = fs.readFileSync(NUNJ_PATH, 'utf8');
var routerSrc = fs.readFileSync(ROUTER_PATH, 'utf8');
var isaacSrc  = fs.readFileSync(ISAAC_PATH, 'utf8');
var serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
var ctrlSrc   = fs.readFileSync(CTRL_PATH, 'utf8');
var schema    = JSON.parse(fs.readFileSync(path.join(REPO, 'schema', 'settings.json'), 'utf8'));

/** Strip whole-line // comments so negative pins can't trip on rationale text. */
function stripComments(s) {
    return s.replace(/^\s*\/\/.*$/gm, '');
}
function countOccurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
}
/** Recursively find the first value held under `key` anywhere in a parsed JSON tree. */
function findKey(obj, key) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    for (var k in obj) {
        var found = findKey(obj[k], key);
        if (typeof found !== 'undefined') return found;
    }
    return undefined;
}

var SLOT_INIT   = "( ctx.req && typeof(ctx.req._ginaIsProxyHost) != 'undefined' ) ? ( ctx.req._ginaIsProxyHost === true )";
var SLOT_CHAIN  = "((ctx.req && ctx.req._ginaProxyHost)||process.gina.PROXY_HOST||ctx.req.headers.host||ctx.req.headers[':host'])";
var SLOT_PXHOST = "( (ctx.req && ctx.req._ginaProxyHostname) || process.gina.PROXY_HOSTNAME )";
var OLD_CHAIN   = "'+ (process.gina.PROXY_HOST||";   // pre-fix: global-first right after the scheme concat
var OLD_PXHOST  = "document.location.hostname : process.gina.PROXY_HOSTNAME;"; // pre-fix bare global override

// ─── 01 — swig-filters: reader re-point source pins ────────────────────────────

describe('01 - swig-filters getUrl: per-request re-point (#B152)', function() {

    it('isProxyHost init prefers the per-request slot over the ctx/global latch', function() {
        assert.ok(swigSrc.indexOf(SLOT_INIT) > -1,
            'getUrl must read ctx.req._ginaIsProxyHost first (strict === true), latch as fallback');
    });

    it('both hostname sites are slot-first (exactly 2 occurrences of the new chain)', function() {
        assert.equal(countOccurrences(swigSrc, SLOT_CHAIN), 2,
            'the isSpecialCase + proxied-rewrite hostname sites must both read the slot first');
    });

    it('the pre-fix global-first hostname chain is gone', function() {
        assert.equal(stripComments(swigSrc).indexOf(OLD_CHAIN), -1,
            'no bare `scheme + (process.gina.PROXY_HOST||…)` composition may remain');
    });

    it('the route object gets THIS request\'s classification before toUrl (url.isProxyHost = isProxyHost)', function() {
        assert.ok(swigSrc.indexOf('url.isProxyHost = isProxyHost;') > -1,
            'without this a raw victim keeps the getRoute-stamped worker-global latch');
    });

    it('url.proxy_hostname override is slot-first (global fallback preserved)', function() {
        assert.ok(swigSrc.indexOf(SLOT_PXHOST) > -1, 'proxy_hostname must prefer ctx.req._ginaProxyHostname');
        assert.equal(stripComments(swigSrc).indexOf(OLD_PXHOST), -1,
            'the bare `: process.gina.PROXY_HOSTNAME;` server-branch override must be gone');
    });

    it('ordering: the isProxyHost re-point sits between getRoute and toUrl', function() {
        var getRouteIdx = swigSrc.indexOf("url = routing.getRoute(route +'@'+ config.bundle, params);");
        var repointIdx  = swigSrc.indexOf('url.isProxyHost = isProxyHost;');
        var toUrlIdx    = swigSrc.indexOf('url = url.toUrl();');
        assert.ok(getRouteIdx > -1 && repointIdx > -1 && toUrlIdx > -1, 'all three anchors must exist');
        assert.ok(getRouteIdx < repointIdx && repointIdx < toUrlIdx,
            'the re-point must run after getRoute and before toUrl');
    });
});

// ─── 02 — nunjucks-filters: mirror pins ────────────────────────────────────────

describe('02 - nunjucks-filters getUrl: per-request re-point (#B152 mirror)', function() {

    it('isProxyHost init prefers the per-request slot over the ctx/global latch', function() {
        assert.ok(nunjSrc.indexOf(SLOT_INIT) > -1);
    });

    it('both hostname sites are slot-first (exactly 2 occurrences of the new chain)', function() {
        assert.equal(countOccurrences(nunjSrc, SLOT_CHAIN), 2);
    });

    it('the pre-fix global-first hostname chain is gone', function() {
        assert.equal(stripComments(nunjSrc).indexOf(OLD_CHAIN), -1);
    });

    it('url.isProxyHost re-point + slot-first proxy_hostname present, old bare override gone', function() {
        assert.ok(nunjSrc.indexOf('url.isProxyHost = isProxyHost;') > -1);
        assert.ok(nunjSrc.indexOf(SLOT_PXHOST) > -1);
        assert.equal(stripComments(nunjSrc).indexOf(OLD_PXHOST), -1);
    });

    it('ordering: re-point between getRoute and toUrl', function() {
        var getRouteIdx = nunjSrc.indexOf("url = routing.getRoute(route +'@'+ config.bundle, params);");
        var repointIdx  = nunjSrc.indexOf('url.isProxyHost = isProxyHost;');
        var toUrlIdx    = nunjSrc.indexOf('url = url.toUrl();');
        assert.ok(getRouteIdx > -1 && repointIdx > -1 && toUrlIdx > -1);
        assert.ok(getRouteIdx < repointIdx && repointIdx < toUrlIdx);
    });
});

// ─── 03 — router.js: engine-agnostic slot fill + opt-in term ───────────────────

describe('03 - router.js: slot fill-when-absent + requireForwardedHeaders term (#B152)', function() {

    it('fills the per-request slots only when absent (isaac\'s earlier write wins)', function() {
        assert.ok(routerSrc.indexOf("if ( typeof(request._ginaIsProxyHost) == 'undefined' ) {") > -1,
            'the fill must be guarded on slot absence — never overwrite isaac\'s classification');
    });

    it('stashes both host slots inside the fill (XFH branch + port-less branch)', function() {
        assert.ok(routerSrc.indexOf('request._ginaProxyHostname = _slotScheme') > -1);
        assert.ok(routerSrc.indexOf('request._ginaProxyHost     = proxyReqHost;') > -1);
    });

    it('the fill runs AFTER the #B67 worker-global refresh gate (append-only — §12 pins intact)', function() {
        var gateIdx = routerSrc.indexOf('if ( proxyReqIsProxied ) {');
        var fillIdx = routerSrc.indexOf("if ( typeof(request._ginaIsProxyHost) == 'undefined' ) {");
        assert.ok(gateIdx > -1 && fillIdx > gateIdx);
    });

    it('the port-less arm carries the opt-in disable term (X-Forwarded-Host arm untouched)', function() {
        var declIdx = routerSrc.indexOf('var proxyReqIsProxied = (');
        var termIdx = routerSrc.indexOf('process.gina._proxyRequireForwarded !== true');
        var closeIdx = routerSrc.indexOf(') ? true : false;', declIdx);
        assert.ok(declIdx > -1 && termIdx > declIdx && termIdx < closeIdx,
            'the requireForwardedHeaders term must sit inside the proxyReqIsProxied expression');
    });

    it('the worker-global write itself is untouched (still gated, still XFH-wins)', function() {
        var gateIdx  = routerSrc.indexOf('if ( proxyReqIsProxied ) {');
        var writeIdx = routerSrc.indexOf('process.gina.PROXY_HOSTNAME = proxyReqScheme');
        assert.ok(gateIdx > -1 && writeIdx > gateIdx, 'the #B65/#B67 freeze-guard shape must survive');
    });
});

// ─── 04 — server.isaac.js: opt-in term in the twin predicate ───────────────────

describe('04 - server.isaac.js: requireForwardedHeaders term in _thisReqProxied (#B152)', function() {

    it('the term sits inside the _thisReqProxied classification expression', function() {
        var declIdx  = isaacSrc.indexOf('var _thisReqProxied = (');
        var termIdx  = isaacSrc.indexOf('process.gina._proxyRequireForwarded !== true');
        var stashIdx = isaacSrc.indexOf('request._ginaIsProxyHost = _thisReqProxied');
        assert.ok(declIdx > -1, '#B65 classification anchor must exist');
        assert.ok(termIdx > declIdx && termIdx < stashIdx,
            'the opt-in term must be part of the classification, before the slot stash');
    });

    it('the X-Forwarded-Host arm is NOT gated by the opt-in (XFH always classifies)', function() {
        var declIdx = isaacSrc.indexOf('var _thisReqProxied = (');
        var block   = isaacSrc.substring(declIdx, isaacSrc.indexOf('? true : false;', declIdx));
        var xfhIdx  = block.indexOf("|| request.headers['x-forwarded-host']");
        var termIdx = block.indexOf('process.gina._proxyRequireForwarded !== true');
        assert.ok(xfhIdx > -1 && termIdx > -1 && termIdx < xfhIdx,
            'the disable term must live in the port-less arm only — XFH stays sufficient');
    });
});

// ─── 05 — server.js: boot-resolve of the opt-in flag ───────────────────────────

describe('05 - server.js: boot-resolves process.gina._proxyRequireForwarded (#B152)', function() {

    it('resolves the flag once from server.proxy.requireForwardedHeaders (strict === true)', function() {
        assert.ok(serverSrc.indexOf('_proxyClassifyConf.requireForwardedHeaders === true') > -1,
            'a truthy-string value must NOT enable the opt-in (the #COMPLY1 truthy-string class)');
        assert.ok(serverSrc.indexOf('process.gina._proxyRequireForwarded = ( _proxyClassifyConf && _proxyClassifyConf.requireForwardedHeaders === true ) ? true : false;') > -1);
    });

    it('fail-safe: a missing/unreadable conf path resolves to false (heuristic default preserved)', function() {
        var catchIdx = serverSrc.indexOf('catch (_proxyClassifyErr)');
        assert.ok(catchIdx > -1);
        var tail = serverSrc.substring(catchIdx, catchIdx + 200);
        assert.ok(tail.indexOf('process.gina._proxyRequireForwarded = false;') > -1);
    });
});

// ─── 06 — controller.js: the two toUrl callers re-point ────────────────────────

describe('06 - controller.js: redirect + throwError route-object re-points (#B152)', function() {

    it('redirect-by-URL branch: route captured, re-pointed, then toUrl (direct chain call gone)', function() {
        assert.ok(ctrlSrc.indexOf('var _rteRedirect = lib.routing.getRoute(path);') > -1);
        var overrideIdx = ctrlSrc.indexOf('_rteRedirect.isProxyHost = ( local.req._ginaIsProxyHost === true );');
        var toUrlIdx    = ctrlSrc.indexOf('path = _rteRedirect.toUrl(ignoreWebRoot);');
        assert.ok(overrideIdx > -1 && toUrlIdx > overrideIdx,
            're-point must run before toUrl');
        assert.equal(stripComments(ctrlSrc).indexOf('lib.routing.getRoute(path).toUrl(ignoreWebRoot)'), -1,
            'the pre-fix direct getRoute().toUrl() chain must be gone');
    });

    it('throwError fallback: route object re-pointed before self.redirect(fallback.toUrl())', function() {
        var overrideIdx = ctrlSrc.indexOf('fallback.isProxyHost = ( req._ginaIsProxyHost === true );');
        var toUrlIdx    = ctrlSrc.indexOf('return self.redirect( fallback.toUrl() );');
        assert.ok(overrideIdx > -1 && toUrlIdx > overrideIdx);
    });

    it('both re-points keep the req-less fallback (guarded on slot presence, not unconditional)', function() {
        assert.ok(ctrlSrc.indexOf("if ( local.req && typeof(local.req._ginaIsProxyHost) != 'undefined' ) {") > -1);
        assert.ok(ctrlSrc.indexOf("if ( req && typeof(req._ginaIsProxyHost) != 'undefined' ) {") > -1);
    });
});

// ─── 07 — schema: the opt-in key is declared ───────────────────────────────────

describe('07 - schema/settings.json declares server.proxy.requireForwardedHeaders', function() {

    it('requireForwardedHeaders exists and is a boolean', function() {
        var node = findKey(schema, 'requireForwardedHeaders');
        assert.ok(node, 'the key must be declared in the published schema');
        assert.equal(node.type, 'boolean');
    });

    it('it lives under a `proxy` object that rejects unknown siblings', function() {
        var proxyNode = findKey(schema, 'proxy');
        assert.ok(proxyNode && proxyNode.properties && proxyNode.properties.requireForwardedHeaders,
            'requireForwardedHeaders must sit under the proxy block');
        assert.equal(proxyNode.additionalProperties, false);
    });
});

// ─── 08 — replica: classification predicate matrix ─────────────────────────────
// Mirrors the (kept-in-sync) twins: isaac _thisReqProxied + router proxyReqIsProxied.

function classify(requestHost, xfh, requireFwd) {
    return (
        ( requestHost && !/\:[0-9]+$/.test(requestHost)
            && requireFwd !== true )
        || xfh
    ) ? true : false;
}

describe('08 - replica: proxied-request classification (default vs requireForwardedHeaders)', function() {

    it('default: a port-less internal Host classifies proxied — the #B152 poisoner', function() {
        assert.equal(classify('internal-svc', undefined, false), true);
    });

    it('default: a port-bearing Host is never proxied (the repro\'s inert measuring arm)', function() {
        assert.equal(classify('internal-svc:8080', undefined, false), false);
    });

    it('default: X-Forwarded-Host classifies proxied regardless of Host shape', function() {
        assert.equal(classify('inner-host:3000', 'public.example', false), true);
    });

    it('opt-in: the port-less heuristic is DISABLED — the poisoner is killed', function() {
        assert.equal(classify('internal-svc', undefined, true), false);
    });

    it('opt-in: X-Forwarded-Host still classifies (the real proxy signal survives)', function() {
        assert.equal(classify('internal-svc', 'public.example', true), true);
        assert.equal(classify('inner-host:3000', 'public.example', true), true);
    });

    it('no Host at all never classifies', function() {
        assert.equal(classify(undefined, undefined, false), false);
        assert.equal(classify(undefined, undefined, true), false);
    });
});

// ─── 09 — replica: router slot-fill derivation ─────────────────────────────────

function fillSlots(request, proxyReqHost, proxyReqIsProxied, PROXY_SCHEME, confScheme) {
    if ( typeof(request._ginaIsProxyHost) == 'undefined' ) {
        request._ginaIsProxyHost = proxyReqIsProxied;
        if (proxyReqIsProxied) {
            var _slotScheme = request.headers['x-forwarded-proto']
                || PROXY_SCHEME
                || confScheme;
            if ( request.headers['x-forwarded-host'] ) {
                request._ginaProxyHostname = _slotScheme +'://'+ request.headers['x-forwarded-host'];
                request._ginaProxyHost     = request.headers['x-forwarded-host'];
            } else {
                request._ginaProxyHostname = _slotScheme +'://'+ proxyReqHost;
                request._ginaProxyHost     = proxyReqHost;
            }
        }
    }
    return request;
}

describe('09 - replica: engine-agnostic slot fill (fill-when-absent)', function() {

    it('Express-shaped request (no slots), proxied via XFH: slots filled, XFH + x-forwarded-proto win', function() {
        var req = fillSlots({ headers: { 'x-forwarded-host': 'public.example', 'x-forwarded-proto': 'https' } },
            'inner-host', true, 'http', 'http');
        assert.equal(req._ginaIsProxyHost, true);
        assert.equal(req._ginaProxyHost, 'public.example');
        assert.equal(req._ginaProxyHostname, 'https://public.example');
    });

    it('Express-shaped request, proxied via port-less Host: scheme falls back PROXY_SCHEME then conf', function() {
        var req = fillSlots({ headers: {} }, 'public.example', true, undefined, 'http');
        assert.equal(req._ginaProxyHostname, 'http://public.example');
        var req2 = fillSlots({ headers: {} }, 'public.example', true, 'https', 'http');
        assert.equal(req2._ginaProxyHostname, 'https://public.example');
    });

    it('raw request: flag stashed false, host slots left unset', function() {
        var req = fillSlots({ headers: {} }, 'inner-host:3000', false, 'http', 'http');
        assert.equal(req._ginaIsProxyHost, false);
        assert.equal(typeof req._ginaProxyHost, 'undefined');
    });

    it('isaac already classified (even false): the fill never overwrites', function() {
        var req = fillSlots({ headers: { 'x-forwarded-host': 'attacker.example' }, _ginaIsProxyHost: false },
            'inner-host', true, 'http', 'http');
        assert.equal(req._ginaIsProxyHost, false, 'isaac\'s earlier classification must win');
        assert.equal(typeof req._ginaProxyHost, 'undefined');
    });
});

// ─── 10 — REAL lib/routing: poisoned worker vs per-request re-point ────────────
// The routing-fixes §07 harness recipe: NODE_PATH injection + helpers +
// prototypes, then drive the REAL getRoute()/toUrl() with a seeded context.

process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));                // installs _, getPath, setContext/getContext, requireJSON …
require(path.join(REPO, 'utils', 'prototypes'));  // installs JSON.clone, count() …

var routingInstance = require(ROUTING_SRC);       // the module exports a ready instance

var B152_TABLE = {
    'page@bundlea': {
        method: 'GET', url: '/page', bundle: 'bundlea',
        hostname: 'http://config-host.internal:3100', webroot: '/',
        param: { control: 'render', file: 'page' }
    }
};

process.gina = process.gina || {};                // getRoute reads process.gina.PROXY_HOSTNAME
setContext('gina', {
    config: {
        env     : 'dev',
        bundle  : 'bundlea',
        getRouting: function () { return B152_TABLE; },
        envConf : {}
    }
});

var INTERNAL_POISON = 'http://internal-svc';      // what a port-less internal caller writes
var PUBLIC_SLOT     = 'https://public.example';   // THIS request's own proxied host (slot)

/** The exact override the fixed getUrl filters apply between getRoute and toUrl. */
function applyFilterRepoint(url, ctxReq) {
    var isProxyHost = ( ctxReq && typeof(ctxReq._ginaIsProxyHost) != 'undefined' )
        ? ( ctxReq._ginaIsProxyHost === true )
        : ( typeof(process.gina.PROXY_HOSTNAME) != 'undefined' );
    url.isProxyHost = isProxyHost;
    if (isProxyHost) {
        url.proxy_hostname = ( (ctxReq && ctxReq._ginaProxyHostname) || process.gina.PROXY_HOSTNAME );
        url.proxy_host     = url.hostname.replace(/(https|http)\:\/\//, '');
    }
    return url;
}

describe('10 - REAL getRoute/toUrl: poisoned worker-global vs per-request re-point', function() {

    it('SUBTRACT (pre-fix shape, no re-point): a poisoned worker emits the INTERNAL host', function() {
        setContext('isProxyHost', true);                       // the monotonic latch
        process.gina.PROXY_HOSTNAME = INTERNAL_POISON;         // the poisoner's write
        var route = routingInstance.getRoute('page@bundlea');
        assert.equal(route.isProxyHost, true, 'getRoute stamps the worker-global latch');
        assert.equal(route.proxy_hostname, INTERNAL_POISON, 'getRoute reads the poisoned global');
        var emitted = route.toUrl();
        assert.equal(emitted, INTERNAL_POISON + '/page',
            'pre-fix: the emitted absolute URL carries the internal host — the reported bug, on the real toUrl');
    });

    it('FIX arm — proxied victim: THIS request\'s slot beats the poisoned global', function() {
        setContext('isProxyHost', true);
        process.gina.PROXY_HOSTNAME = INTERNAL_POISON;
        var route = routingInstance.getRoute('page@bundlea');
        applyFilterRepoint(route, { _ginaIsProxyHost: true, _ginaProxyHostname: PUBLIC_SLOT });
        assert.equal(route.toUrl(), PUBLIC_SLOT + '/page',
            'a proxied victim must emit its OWN public host, not the last port-less caller\'s');
    });

    it('FIX arm — raw victim (slot false): flips to the config-host branch despite the latch', function() {
        setContext('isProxyHost', true);                       // worker latched by history
        process.gina.PROXY_HOSTNAME = INTERNAL_POISON;
        var route = routingInstance.getRoute('page@bundlea');
        applyFilterRepoint(route, { _ginaIsProxyHost: false });
        assert.equal(route.toUrl(), 'http://config-host.internal:3100/page',
            'a raw victim resolves the CONFIG host — neither the poison nor the latch');
    });

    it('FIX arm — slot-less caller (req-less render): legacy global fallback, byte-identical', function() {
        setContext('isProxyHost', true);
        process.gina.PROXY_HOSTNAME = INTERNAL_POISON;
        var route = routingInstance.getRoute('page@bundlea');
        applyFilterRepoint(route, undefined);
        assert.equal(route.toUrl(), INTERNAL_POISON + '/page',
            'no slot -> the worker-global remains the source (the documented req-less fallback)');
    });

    it('control: an unlatched worker (no proxy history) resolves the config host', function() {
        setContext('isProxyHost', false);
        delete process.gina.PROXY_HOSTNAME;
        var route = routingInstance.getRoute('page@bundlea');
        assert.equal(route.isProxyHost, false);
        assert.equal(route.toUrl(), 'http://config-host.internal:3100/page');
    });
});

// ─── 11 — replica: getUrl path-form host chain + isProxyHost init ──────────────

function resolvePathFormHost(ctxReq, PROXY_HOST) {
    // the :292/:302 chain as shipped
    return ((ctxReq && ctxReq._ginaProxyHost)||PROXY_HOST||ctxReq.headers.host||ctxReq.headers[':host']);
}
function computeGetUrlIsProxyHost(ctxReq, ctxIsProxyHost, proxyHostnameDefined) {
    return ( ctxReq && typeof(ctxReq._ginaIsProxyHost) != 'undefined' )
        ? ( ctxReq._ginaIsProxyHost === true )
        : ( ( ctxIsProxyHost && String(ctxIsProxyHost).toLowerCase() === 'true' )
            ? true
            : ( proxyHostnameDefined ? true : false ) );
}

describe('11 - replica: getUrl path-form precedence + per-request isProxyHost init', function() {

    it('slot beats the poisoned global; global beats headers; headers close the chain', function() {
        assert.equal(resolvePathFormHost({ _ginaProxyHost: 'public.example', headers: {} }, 'internal-svc'),
            'public.example', 'slot first');
        assert.equal(resolvePathFormHost({ headers: { host: 'from-headers' } }, 'internal-svc'),
            'internal-svc', 'no slot -> global (legacy)');
        assert.equal(resolvePathFormHost({ headers: { host: 'from-headers' } }, undefined),
            'from-headers', 'no slot, no global -> the request\'s own Host');
    });

    it('slot=false beats a latched ctx \'true\' (the raw-victim flip)', function() {
        assert.equal(computeGetUrlIsProxyHost({ _ginaIsProxyHost: false }, 'true', true), false);
    });

    it('slot=true is authoritative even when the latch never fired', function() {
        assert.equal(computeGetUrlIsProxyHost({ _ginaIsProxyHost: true }, false, false), true);
    });

    it('slot absent: the legacy composite is byte-identical (ctx latch, then global-defined)', function() {
        assert.equal(computeGetUrlIsProxyHost({ headers: {} }, 'true', false), true);
        assert.equal(computeGetUrlIsProxyHost({ headers: {} }, false, true), true);
        assert.equal(computeGetUrlIsProxyHost({ headers: {} }, false, false), false);
        assert.equal(computeGetUrlIsProxyHost(undefined, false, true), true, 'req-less render keeps the latch');
    });
});


// ─── 12 — #B168: the getUrl override must never force an UNSET proxy_hostname ──
//
// The #B152 slot-first override runs after getRoute() and re-points url.isProxyHost
// + url.proxy_hostname. In a slot-less render with the sticky latch true and the
// worker global unset, it assigned an unset value while forcing isProxyHost true —
// toUrl() then stringified it into the emitted URL ('undefined/...'), and it also
// overwrote a usable envConf-derived resolution getRoute had just produced. The fix
// holds getRoute's own resolution before the override, restores it when the
// override resolved nothing, and degrades isProxyHost to false only when nothing
// resolved anywhere — composing with getRoute's #B168 degrade (which guarantees a
// self-consistent route: either isProxyHost true with a truthy proxy_hostname, or
// isProxyHost false).

describe('12 - #B168 getUrl override: hold-and-restore guard (no forced-unset proxy_hostname)', function() {

    var HOLD    = 'var _routeProxyHostname = url.proxy_hostname;';
    var RESTORE = 'url.proxy_hostname = _routeProxyHostname;';
    var GUARD   = 'if ( !url.proxy_hostname ) {';
    var FLIP    = 'url.isProxyHost = false;';

    function pinHoldAndRestore(src, label) {
        var holdIdx    = src.indexOf(HOLD);
        var slotIdx    = src.indexOf(SLOT_PXHOST);
        var restoreIdx = src.indexOf(RESTORE);
        var flipIdx    = src.indexOf(FLIP);
        var toUrlIdx   = src.indexOf('url = url.toUrl();');
        assert.ok(holdIdx > -1, label + ': the hold of getRoute\'s resolution must exist');
        assert.ok(slotIdx > -1 && restoreIdx > -1 && flipIdx > -1 && toUrlIdx > -1, label + ': all anchors must exist');
        assert.ok(holdIdx < slotIdx, label + ': the hold must precede the slot-first override');
        assert.ok(slotIdx < restoreIdx && restoreIdx < flipIdx, label + ': override, then restore, then degrade-flip');
        assert.ok(flipIdx < toUrlIdx, label + ': the whole guard must complete before toUrl()');
        assert.equal(countOccurrences(src, GUARD), 2, label + ': outer unresolved-guard + inner nothing-anywhere guard');
    }

    it('swig-filters: hold-and-restore guard present, ordered, before toUrl', function() {
        pinHoldAndRestore(swigSrc, 'swig');
    });

    it('nunjucks-filters: hold-and-restore guard present, ordered, before toUrl (mirror)', function() {
        pinHoldAndRestore(nunjSrc, 'nunjucks');
    });

    // -- decision-table replica of the guarded override (mirrors the shipped block) --

    function overrideReplica(routeState, ctxReq, globalPXH, filterIsProxyHost) {
        var url = { hostname: routeState.hostname, isProxyHost: routeState.isProxyHost };
        if ('proxy_hostname' in routeState) { url.proxy_hostname = routeState.proxy_hostname; }
        url.isProxyHost = filterIsProxyHost;
        if (filterIsProxyHost) {
            var _routeProxyHostname = url.proxy_hostname;
            url.proxy_hostname = ( (ctxReq && ctxReq._ginaProxyHostname) || globalPXH );
            url.proxy_host = url.hostname.replace(/(https|http)\:\/\//, '');
            if ( !url.proxy_hostname ) {
                url.proxy_hostname = _routeProxyHostname;
                if ( !url.proxy_hostname ) {
                    url.isProxyHost = false;
                }
            }
        }
        return url;
    }

    var ROUTE_DIRECT   = { hostname: 'https://direct.internal:3999', isProxyHost: false };
    var ROUTE_RESOLVED = { hostname: 'https://direct.internal:3999', isProxyHost: true, proxy_hostname: 'http://fallback.example' };

    it('replica: a true slot wins (per-request truth, unchanged)', function() {
        var url = overrideReplica(ROUTE_RESOLVED, { _ginaIsProxyHost: true, _ginaProxyHostname: 'https://public.example' }, undefined, true);
        assert.equal(url.isProxyHost, true);
        assert.equal(url.proxy_hostname, 'https://public.example');
    });

    it('replica: a false slot degrades to the config-host branch (the #B152 raw victim, unchanged)', function() {
        var url = overrideReplica(ROUTE_RESOLVED, { _ginaIsProxyHost: false, headers: {} }, 'https://stale.example', false);
        assert.equal(url.isProxyHost, false, 'the raw victim must keep the direct-host branch');
    });

    it('replica: slot-less with a set global keeps the legacy read (unchanged)', function() {
        var url = overrideReplica(ROUTE_RESOLVED, undefined, 'https://public.example', true);
        assert.equal(url.isProxyHost, true);
        assert.equal(url.proxy_hostname, 'https://public.example');
    });

    it('FIXED replica: slot-less + unset global keeps getRoute\'s own envConf-derived resolution', function() {
        var url = overrideReplica(ROUTE_RESOLVED, undefined, undefined, true);
        assert.equal(url.isProxyHost, true);
        assert.equal(url.proxy_hostname, 'http://fallback.example',
            'the override must not replace a usable resolution with an unset one');
    });

    it('FIXED replica: nothing resolvable anywhere degrades isProxyHost (no stringified unset host)', function() {
        var url = overrideReplica(ROUTE_DIRECT, undefined, undefined, true);
        assert.equal(url.isProxyHost, false, 'with nothing resolvable the route must fall back to its direct hostname');
        assert.ok(!url.proxy_hostname, 'no truthy proxy_hostname may be fabricated');
    });

    it('SUBTRACT (pre-fix shape, no hold/restore): the override forces the unset value and the latch', function() {
        // the pre-#B168 block: unconditional assign, no guard
        var url = { hostname: ROUTE_RESOLVED.hostname, isProxyHost: ROUTE_RESOLVED.isProxyHost, proxy_hostname: ROUTE_RESOLVED.proxy_hostname };
        url.isProxyHost = true;
        url.proxy_hostname = ( (undefined) || undefined );
        url.proxy_host = url.hostname.replace(/(https|http)\:\/\//, '');
        assert.equal(url.isProxyHost, true, 'pre-fix: the latch stays forced');
        assert.equal(typeof url.proxy_hostname, 'undefined', 'pre-fix: the usable resolution is overwritten');
        assert.equal('' + url.proxy_hostname, 'undefined',
            'pre-fix: toUrl()\'s hostname coercion emits the literal "undefined" prefix');
    });
});
