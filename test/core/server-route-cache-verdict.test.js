'use strict';
/**
 * #B422 — cached route entries are candidates, not verdicts.
 *
 * A route whose URL structurally matches but whose `requirements` REJECT the
 * request used to be force-matched on the warm (cached-route) path: getCached()
 * re-runs compareUrls(), which returns its foundRoute object UNCONDITIONALLY
 * with the verdict in `.past` — and the dispatch call site tested the object's
 * truthiness, never `.past`. A rejected warm match therefore dispatched with
 * `req.routing` unset, and router.route()'s `params.param.control` deref threw
 * inside the async chain: unhandled rejection, connection dropped, no response.
 * Trigger: the cache key is `method:pathname` and (isaac engine) `req.url`
 * arrives query-stripped, so all query variants of one pathname share one
 * entry — whichever variant is seen first decides what is cached.
 *
 * Suites:
 *  01 — core/server.js source pins: verdict gate + pre-cache capture/restore
 *       + owned (try/caught) warm getCached call + preserved warm fast-path
 *  02 — REAL lib/routing behavioral: cache() → getCached() returns the verdict
 *       (`.past` false on a requirements-rejecting request, `req.routing` left
 *       unpopulated) and the entry survives for accepting variants
 *  03 — core/router.js source pins: named-500 guard precedes the control deref
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var SERVER_PATH  = path.join(FW, 'core/server.js');
var ROUTER_PATH  = path.join(FW, 'core/router.js');
var ROUTING_PATH = path.join(FW, 'lib/routing/src/main.js');

var SERVER_SRC = fs.readFileSync(SERVER_PATH, 'utf8');
var ROUTER_SRC = fs.readFileSync(ROUTER_PATH, 'utf8');

/** Count non-overlapping occurrences of a literal needle. */
function countOf(src, needle) {
    var n = 0, i = src.indexOf(needle);
    while (i > -1) { ++n; i = src.indexOf(needle, i + needle.length); }
    return n;
}

// ─── 01 — server.js source structure: the verdict gate ────────────────────────

describe('01 - #B422 server.js: warm route-cache hits are gated on the compareUrls verdict', function() {

    it('the verdict gate exists, exactly once, and fails toward miss on a non-true past', function() {
        assert.equal(
            countOf(SERVER_SRC, '_cachedRouteThrew || hasCachedRoute && hasCachedRoute.past !== true'),
            1,
            'dispatch must treat any warm outcome other than past === true as a cache miss'
        );
    });

    it('the pre-cache capture precedes the getCached call (restore state = cold-entry state)', function() {
        var captureIdx = SERVER_SRC.indexOf('var _preCacheParams');
        var lookupIdx  = SERVER_SRC.indexOf('routingLib.getCached');
        assert.ok(captureIdx > -1, 'pre-cache capture must exist');
        assert.equal(countOf(SERVER_SRC, 'routingLib.getCached'), 1, 'single warm lookup site');
        assert.ok(captureIdx < lookupIdx,
            'req.params/req[method] must be captured BEFORE getCached runs compareUrls');
    });

    it('the warm getCached call owns its promise (try/caught -> miss, never an unhandled rejection)', function() {
        var tryIdx    = SERVER_SRC.indexOf('_cachedRouteThrew');
        var catchIdx  = SERVER_SRC.indexOf('catch (_cachedRouteErr)');
        var lookupIdx = SERVER_SRC.indexOf('routingLib.getCached');
        assert.ok(catchIdx > -1, 'the warm lookup must be try/caught');
        assert.ok(tryIdx > -1 && tryIdx < lookupIdx && lookupIdx < catchIdx,
            'flag declared before the lookup, catch after it');
    });

    it('the rejected-hit restore mirrors the cold loop reset surface (req.params + req[method])', function() {
        assert.equal(countOf(SERVER_SRC, 'req.params = Object.assign({}, _preCacheParams);'), 1);
        assert.equal(countOf(SERVER_SRC,
            'req[_reqMethodKey] = _preCacheReqMethod ? Object.assign({}, _preCacheReqMethod) : {};'), 1);
    });

    it('the warm fast-path is preserved: an accepted cached hit still breaks out of the scan', function() {
        // the loop's cached-route break — the accepting warm path must stay warm
        assert.ok(
            /if\s*\(\s*hasCachedRoute\s*\)\s*\{\s*\n\s*matched = true;\s*\n\s*break;/.test(SERVER_SRC),
            'the cached-route break inside the routing loop must survive the fix'
        );
    });

    it('_reqMethodKey is computed once, before the lookup (capture and loop reset share one key)', function() {
        assert.equal(countOf(SERVER_SRC, "var _reqMethodKey   = (method || req.method || 'GET').toLowerCase();"), 1,
            'exactly one computation site');
        var keyIdx    = SERVER_SRC.indexOf("var _reqMethodKey   = (method || req.method || 'GET').toLowerCase();");
        var lookupIdx = SERVER_SRC.indexOf('routingLib.getCached');
        assert.ok(keyIdx < lookupIdx, 'key computed before the warm lookup');
    });
});

// ─── 02 — REAL lib/routing: the cache primitive returns the verdict ───────────

describe('02 - #B422 behavioral: getCached() carries the requirements verdict in .past', function() {

    // -- §14/§36 harness bootstrap (the #B215 matcher-standalone shape) -------
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));                              // _, setPath, setContext, ...
    require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));   // JSON.clone, Object.count()
    process.gina = process.gina || {};
    setPath('gina', { core: path.join(FW, 'core') });

    var TABLE = {
        // a literal-segment url whose sole requirement targets a QUERY param —
        // the requirement enters matching via the request[method] injection loop
        'thing-list@test': {
            url: '/thing/a/b', method: 'GET', bundle: 'test', namespace: 'test',
            requirements: { flag: '/^(true)$/i' },
            param: { control: 'thingList', file: 'thing', title: 'Thing', flag: ':flag' }
        }
    };

    setContext('isProxyHost', false);
    setContext('gina', { config: {
        env: 'dev', bundle: 'test', envConf: {},
        getRouting: function () { return TABLE; }
    } });

    var routingLib = require(ROUTING_PATH);

    /**
     * isaac-shaped request: url already query-stripped, query parsed into the
     * GET bag (booleans coerced, per server.isaac.js).
     */
    function mkReq(pathname, getBag) {
        return {
            url     : pathname,
            method  : 'GET',
            headers : {},
            routing : {},
            params  : { 0: pathname },
            get     : JSON.clone(getBag || {})
        };
    }

    // server.js engine literal (faithful subset), as passed to routingLib.cache()
    var CACHE_KEY = 'GET:/thing/a/b';
    function seedCache() {
        var name = 'thing-list@test', r = TABLE[name];
        routingLib.invalidateCached(CACHE_KEY);
        routingLib.cache(CACHE_KEY, name, r, {
            method: r.method, control: r.param.control, requirements: r.requirements,
            namespace: r.namespace, url: '/thing/a/b', rule: name,
            cache: null, queryTimeout: null, csrfExempt: false, culturePrefix: false, negotiate: false,
            param: JSON.clone(r.param), middleware: [], bundle: r.bundle,
            isXMLRequest: false, isWithCredentials: false
        }, {});
    }

    it('accepting request: warm hit returns past === true and populates req.routing', async function() {
        seedCache();
        var req   = mkReq('/thing/a/b', { flag: true });
        var found = await routingLib.getCached(CACHE_KEY, req);
        assert.ok(found, 'warm hit returns a foundRoute');
        assert.equal(found.past, true, 'requirements accept -> verdict true');
        assert.ok(req.routing && typeof req.routing.param === 'object',
            'the accepting request gets its full routing description');
        assert.equal(req.routing.param.control, 'thingList');
    });

    it('rejecting request: warm hit returns past === false and leaves req.routing unpopulated', async function() {
        seedCache();
        var warm = mkReq('/thing/a/b', { flag: true });
        await routingLib.getCached(CACHE_KEY, warm);          // warm precondition, accepted

        var req   = mkReq('/thing/a/b', { flag: false });     // isaac coerces 'false' -> boolean
        var found = await routingLib.getCached(CACHE_KEY, req);
        assert.ok(found, 'a truthy object comes back even for a rejected match — WHY the dispatch gate must read .past');
        assert.equal(found.past, false, 'requirements reject -> verdict false');
        assert.equal(typeof req.routing.param, 'undefined',
            'the rejecting request must NOT inherit a routing description');
    });

    it('a rejecting lookup does not evict the entry — accepting variants stay warm', async function() {
        seedCache();
        var rejected = mkReq('/thing/a/b', { flag: false });
        var r1 = await routingLib.getCached(CACHE_KEY, rejected);
        assert.equal(r1.past, false);

        var accepted = mkReq('/thing/a/b', { flag: true });
        var r2 = await routingLib.getCached(CACHE_KEY, accepted);
        assert.ok(r2 && r2.past === true,
            'the entry must survive a rejecting lookup (it is valid for the variants it accepts)');
    });

    it('a cold pathname has no entry: getCached returns null without running compareUrls', async function() {
        var req = mkReq('/thing/zzz', { flag: false });
        var found = await routingLib.getCached('GET:/thing/zzz', req);
        assert.equal(found, null, 'no entry -> null (the truly-cold contract the restore relies on)');
        assert.equal(typeof req.routing.param, 'undefined');
    });
});

// ─── 03 — router.js source structure: the dispatch-target guard ───────────────

describe('03 - #B422 router.js: missing params.param.control fails LOUD, before the deref', function() {

    it('the guard exists and answers a named 500 via throwError', function() {
        assert.equal(countOf(ROUTER_SRC, "typeof(params.param.control) == 'undefined'"), 1,
            'exactly one guard site');
        assert.equal(countOf(ROUTER_SRC, 'Routing state error: no `param.control` resolved for'), 1,
            'the 500 names the request so the failure is diagnosable');
    });

    it('the guard precedes the control deref', function() {
        var guardIdx = ROUTER_SRC.indexOf("typeof(params.param.control) == 'undefined'");
        var derefIdx = ROUTER_SRC.indexOf('var action          = request.control = params.param.control;');
        assert.ok(guardIdx > -1 && derefIdx > -1, 'both sites exist');
        assert.ok(guardIdx < derefIdx, 'guard must run before the bare deref');
    });
});
