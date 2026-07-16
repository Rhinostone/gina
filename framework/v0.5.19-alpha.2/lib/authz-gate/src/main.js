/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module gina/lib/authz-gate
 *
 * The #COMPLY1 authorization gate — the framework's request-path authorization
 * enforcement point.
 *
 * A route opts in by declaring the flag in `routing.json`:
 *
 *   "account": {
 *       "method" : "GET",
 *       "url"    : "/account",
 *       "param"  : { "control": "account", "requireAuth": true }
 *   }
 *
 * `core/server.js` lints every declared flag at bundle BOOT (fail-fast: a
 * non-boolean `param.requireAuth` refuses to boot) and resolves the login-bounce
 * target ONCE there onto `process.gina._authConf`. This module then runs before
 * the controller action, at BOTH `core/router.js` dispatch sites, and:
 *
 *   1. NO-OPs for any route that does not declare `param.requireAuth: true`;
 *   2. answers `true` when the request carries an authenticated session;
 *   3. otherwise terminates the response itself — a browser navigation is
 *      snapshotted (`pauseRequest`) and bounced to the configured login route;
 *      everything else gets a machine-readable **401**.
 *
 * It is a strict NO-OP for every route that declares no flag, so an existing
 * bundle is byte-identical.
 *
 * ## Why the gate sits before the DTO pipe
 * `core/router.js` calls this immediately BEFORE `dtoPipe.validateRequestPayload`,
 * extending the invariant that site already codifies (auth precedes validation):
 * an unauthenticated caller must never learn whether its payload WOULD have
 * validated — a 422 field map is a disclosure. Route middleware has already
 * drained by then, so a bundle's own auth middleware keeps its semantics and this
 * gate is purely additive after it.
 *
 * ## The authentication contract (#COMPLY1 defines it; the app populates it)
 * A request is authenticated **iff `req.session.user` is truthy**. That is read
 * DIRECTLY rather than through `router.js`'s Passport `request.isAuthenticated()`
 * shim, which is installed only conditionally (on a `_passport` / `session`
 * probe), has no framework caller, and itself converges onto `request.session.user`
 * — so the property IS the contract and the shim stays a userland convenience.
 * Populating it at login is the application's job (later #COMPLY3 ships helpers).
 *
 * ## Why the bounce is a 302 + no-store, unconditionally
 * `controller.redirect()` cannot be reused for it: it defaults to a **cacheable
 * 301** (`req.routing.param.code || 301`, read off whichever route object the
 * branch left on the request) and only applies the no-store set when the request
 * is dev-mode or proxy-classified (#B68). A cached auth bounce is a login LOOP —
 * the browser replays the redirect for the later, now-authenticated visit and
 * never reaches the page. So the bounce is emitted here, mirroring `redirect()`'s
 * proven exit shape (`writeHead` + the `{status, headers}` body the inter-bundle
 * `query()` 3xx intercept replays) with the status and the no-store set forced.
 */

/**
 * Read the boot-resolved login-bounce target.
 *
 * `core/server.js` resolves it ONCE at boot (route-name -> url resolution and
 * webroot composition included) so the request path costs an O(1) property read
 * and never a config clone — the `process.gina._adminAllowList` / `_dtos`
 * precedent. `settings.json` is boot config (never hot-reloaded), so there is
 * nothing to re-read per request.
 *
 * @returns {string|null} the composed, root-relative login path, or `null` when
 *                        the bundle configured none.
 * @inner
 * @private
 */
var getLoginRoute = function () {
    var conf = ( typeof(process.gina) != 'undefined' && process.gina && process.gina._authConf )
        ? process.gina._authConf
        : null;

    return ( conf && typeof(conf.loginRoute) == 'string' && conf.loginRoute ) ? conf.loginRoute : null;
};

/**
 * The authentication predicate — the shape every #COMPLY1 surface reads.
 *
 * @param {object} req - the request.
 * @returns {boolean} `true` when the request carries an authenticated session.
 * @inner
 * @private
 */
var isAuthenticated = function (req) {
    return ( req.session && typeof(req.session) == 'object' && req.session.user ) ? true : false;
};

/**
 * Emit the login bounce: a forced **302** carrying the no-store set.
 *
 * Mirrors `controller.redirect()`'s exit (`writeHead(code, headInfos)` — the same
 * call for both engines — then a `{status, headers}` JSON body, which is what the
 * inter-bundle `query()` 3xx intercept parses) with two deliberate divergences,
 * both load-bearing for an auth bounce: the status is **302**, never redirect()'s
 * cacheable 301 default; and the no-store set is UNCONDITIONAL, not gated on
 * dev-or-proxied (#B68) — a direct production deployment is exactly where a
 * cached 301 bounce would pin a login loop.
 *
 * @param {object} req        - the request (read for the access-log line only).
 * @param {object} res        - the response.
 * @param {string} loginRoute - the boot-resolved, root-relative login path.
 * @returns {boolean} always `false` — the gate has answered; the router must return.
 * @inner
 * @private
 */
var bounceToLogin = function (req, res, loginRoute) {
    if ( !res || res.headersSent ) {
        return false;   // something already answered — never double-send
    }

    var headInfos = {
        'location'      : loginRoute,
        'cache-control' : 'no-cache, no-store, must-revalidate',
        'pragma'        : 'no-cache',
        'expires'       : '0'
    };

    try {
        res.writeHead(302, headInfos);
        // The body the inter-bundle query() 3xx intercept replays (see redirect()).
        res.end(JSON.stringify({ status: 302, headers: headInfos }));
        res.headersSent = true;   // for the render() method — mirrors redirect()
        // The access log is how a redirect is verified from pod logs (it records the
        // EMITTED Location): keep the bounce as observable as a normal redirect.
        console.info(String(req.method || 'GET').toUpperCase() +' [302] '+ loginRoute);
    } catch (err) {
        console.warn('[ authz ] could not emit the login bounce for `'+ ((req.routing && req.routing.rule) || '?') +'`: '+ (err.message || err));
    }

    return false;
};

/**
 * Terminate an unauthenticated request against a gated route.
 *
 * Bounces a browser navigation to the configured login route (snapshotting the
 * request first, so the login action can `resumeRequest()` it); answers a plain
 * **401** in every other case.
 *
 * The bounce needs all three of: a configured target; a NON-XHR request (an XHR's
 * handler cannot meaningfully follow a Location — it needs a status it can read,
 * and XHR follows redirects transparently, so a 302 would hand it the login PAGE
 * as the response body); and a session to snapshot into (`pauseRequest` requires
 * one — it 424s without, which would turn an auth bounce into an error).
 *
 * @param {object} controller - the per-request controller (its `throwError` writes the 401).
 * @param {object} req        - the request.
 * @param {object} res        - the response.
 * @returns {boolean} always `false` — the gate has answered; the router must return.
 * @inner
 * @private
 */
var denyUnauthenticated = function (controller, req, res) {
    var loginRoute = getLoginRoute();

    if ( !loginRoute || req.isXMLRequest === true || !req.session ) {
        controller.throwError({
            status : 401,
            error  : 'Authentication required'
        });
        return false;
    }

    var method = String(req.method || 'GET').toLowerCase();
    try {
        controller.pauseRequest(req[method] || {});
    } catch (err) {
        // A failed snapshot must never turn an auth bounce into a 500: the user still
        // gets to log in, they just lose the replay and land on the login page's own
        // destination.
        console.warn('[ authz ] could not snapshot the halted request for `'+ ((req.routing && req.routing.rule) || '?') +'`: '+ (err.message || err));
    }

    return bounceToLogin(req, res, loginRoute);
};

/**
 * Authorize a request against the route it matched.
 *
 * NO-OP (returns `true`) unless the route declares `param.requireAuth: true`.
 *
 * @param {object} controller - the per-request controller (its `throwError` / `pauseRequest`
 *                              write the response).
 * @param {object} req        - the request. Reads `req.routing.param.requireAuth`,
 *                              `req.session.user`, `req.isXMLRequest` and `req[method]`.
 * @param {object} res        - the response (the bounce writes to it directly).
 * @returns {boolean} `true` to continue to the action, `false` when the gate has already
 *                    terminated the response (401 / 302).
 *
 * @example
 * // core/router.js, before the DTO pipe and the action dispatch
 * if ( !authzGate.authorizeRequest(controller, request, response) ) {
 *     return; // the gate answered (401 / login bounce) — never reach the action
 * }
 */
var authorizeRequest = function (controller, req, res) {

    if ( !req || !req.routing || !req.routing.param ) {
        return true;
    }

    // Strictly `=== true`: the boot lint rejects any other type, so by request time the
    // flag is `true`, `false` or absent — and an absent/false flag must never gate.
    if ( req.routing.param.requireAuth !== true ) {
        return true;   // the route declares no authorization — nothing to do
    }

    if ( isAuthenticated(req) ) {
        return true;
    }

    return denyUnauthenticated(controller, req, res);
};

module.exports = {
    authorizeRequest : authorizeRequest,
    isAuthenticated  : isAuthenticated
};
