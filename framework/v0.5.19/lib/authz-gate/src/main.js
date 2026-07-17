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
 * A route opts in by declaring authorization keys in `routing.json`:
 *
 *   "account": {
 *       "method" : "GET",
 *       "url"    : "/account",
 *       "param"  : { "control": "account", "requireAuth": true }
 *   }
 *
 *   "admin-panel": {
 *       "method" : "GET",
 *       "url"    : "/admin",
 *       "param"  : { "control": "panel", "roles": ["admin", "editor"] }
 *   }
 *
 *   "invoice-edit": {
 *       "method" : "PUT",
 *       "url"    : "/invoices/:id",
 *       "param"  : { "control": "edit", "id": ":id", "policy": "ownsInvoice" }
 *   }
 *
 * `core/server.js` lints every declared key at bundle BOOT (fail-fast: a
 * non-boolean `param.requireAuth`, a `param.roles` that is not a non-empty
 * array of non-empty strings, or a `param.policy` naming a missing / broken /
 * async module, refuses to boot) and resolves the login-bounce target ONCE
 * there onto `process.gina._authConf`. This module then runs before the
 * controller action, at BOTH `core/router.js` dispatch sites, and:
 *
 *   1. NO-OPs for any route that declares no authorization key;
 *   2. authenticates first — `param.roles` and `param.policy` both IMPLY
 *      `requireAuth`, since an unauthenticated caller can hold no role and no
 *      policy can meaningfully judge a caller that is not signed in. An
 *      unauthenticated request is terminated here: a browser navigation is
 *      snapshotted (`pauseRequest`) and bounced to the configured login route;
 *      everything else gets a machine-readable **401**;
 *   3. then matches roles — ANY-of: the session user's `user.roles` must
 *      intersect the declared set;
 *   4. then runs the policy — the record/attribute escape hatch RBAC cannot
 *      express (ownership and the like). AND-composed: a route declaring both
 *      needs both to pass.
 *
 * Every denial from steps 3-4 is a **403** whose body stays GENERIC — the
 * required roles and the policy name are never echoed to the wire (they name
 * the bundle's authorization model, and a 403 that lists what WOULD have been
 * enough is a disclosure to exactly the caller that failed it); the specifics
 * go to the server-side log only.
 *
 * It is a strict NO-OP for every route that declares no authorization key, so an
 * existing bundle is byte-identical.
 *
 * ## The roles contract (#COMPLY1 defines it; the app populates it)
 * `req.session.user.roles` is a plain array of opaque role-name strings — the
 * framework imposes no vocabulary and no role→permission indirection (v1 names
 * roles directly; an indirection layer is a demand-gated follow-up). The app
 * populates it at login alongside `session.user`. Absent or non-array means the
 * user holds no roles, so every role-gated route answers 403 for that session.
 *
 * ## The policy contract — SYNCHRONOUS, allow iff `=== true`
 * A `param.policy` names a `<bundle>/policies/<name>.js` module exporting a plain
 * function:
 *
 *   // <bundle>/policies/ownsInvoice.js
 *   module.exports = function (user, req) {
 *       return req.params.ownerId === user.id;
 *   };
 *
 * It is registered at BOOT (`registerPolicy`) onto `process.gina._policies`, so the
 * request path is an O(1) lookup — no fs, no re-require (which would also feed the
 * dev-mode `module.children` leak class, #B32).
 *
 * The contract is synchronous because the GATE is synchronous — `authorizeRequest`
 * returns a boolean that both `core/router.js` dispatch sites branch on directly.
 * Two rules make that safe rather than merely convenient:
 *
 *   * an `async function` policy is **refused at boot**. Its constructor name reads
 *     `AsyncFunction`, which is the only boot-visible tell (`typeof` says 'function'
 *     for both), so the author learns at deploy instead of watching the route deny
 *     every request forever;
 *   * a policy that merely RETURNS a promise (the transpiled-async shape) is
 *     boot-INVISIBLE — its constructor reads `Function`. So the allow test is
 *     strictly `=== true`: a promise is truthy but not `true`, and a truthy-allow
 *     gate would ALLOW it unconditionally — the control silently OFF, inverted into
 *     fail-OPEN. Anything that is not literally `true` denies, and a non-boolean
 *     return warns ONCE naming the policy so the contract violation is visible
 *     without flooding the log.
 *
 * A throwing policy denies (403) and never 500s the wire. Async tolerance is a
 * demand-gated follow-up: `(user, req)` extends compatibly to `(user, req, cb)`.
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
 * #COMPLY2 — the audit-trail primitive, for the framework authz auto-events
 * (`authz.denied` records at the deny writers below). Required by DEEP PATH
 * (the `lib/job` -> `lib/uuid` precedent) so the gate has no dependency on the
 * registry or on global-injection ordering; the dependency is strictly one-way
 * (`lib/audit` never requires this module). `emitAuthzDenied` is fully
 * contained on its side (gated on `audit.enabled` + `audit.events.authz`,
 * whole body try/caught) — an audit failure can NEVER change an authorization
 * outcome.
 *
 * @inner
 */
var audit = require('../../audit/src/main');

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
 * Warn-once bookkeeping, keyed by policy name: a policy that violates the return
 * contract does so on EVERY request, and one line per request would bury the very
 * message the author needs to act on.
 *
 * @type {object}
 * @inner
 * @private
 */
var _warnedPolicies = {};

/**
 * The boot-built policy registry — `process.gina._policies`, name -> function.
 *
 * @returns {object|null} the registry, or `null` outside a booted process.
 * @inner
 * @private
 */
var getPolicyRegistry = function () {
    if ( typeof(process.gina) == 'undefined' || !process.gina ) {
        return null;
    }
    if ( !process.gina._policies || typeof(process.gina._policies) != 'object' ) {
        process.gina._policies = {};
    }
    return process.gina._policies;
};

/**
 * Resolve + register a bundle policy module at BOOT.
 *
 * Mirrors `lib.dto.load`'s resolution contract: returns `null` when unresolved (no
 * such file, or the file exports no function) and THROWS when the file is present
 * but broken — the caller decides what an unresolved reference means (here
 * `core/server.js` refuses the boot either way, adding the route context).
 *
 * The `async function` refusal lives here rather than at the gate because it is the
 * only place the tell is visible: an async policy's promise return is truthy but
 * never `=== true`, so the strict allow test would deny the route on every request
 * — a security control that is silently, permanently broken. Refusing at boot turns
 * that into a deploy-time error.
 *
 * @param {string} bundleSrcPath - absolute path to the bundle source dir.
 * @param {string} name          - the reference (also the file base name).
 * @returns {function|null} the registered policy, or `null` when unresolved.
 * @throws {Error} when the module cannot be required, or is an `async function`.
 *
 * @example
 * // core/server.js, at boot
 * var fn = authzGate.registerPolicy(bundleSrcPath, 'ownsInvoice');
 * if ( !fn ) {
 *     throw new Error('policies/ownsInvoice.js is missing (or exports no function)');
 * }
 */
var registerPolicy = function (bundleSrcPath, name) {
    if ( typeof(name) != 'string' || !name ) {
        return null;
    }
    if ( typeof(bundleSrcPath) != 'string' || !bundleSrcPath ) {
        return null;
    }

    var file = require('path').join(bundleSrcPath, 'policies', name + '.js');
    if ( !require('fs').existsSync(file) ) {
        return null;
    }

    var fn = require(file);   // may throw -> the caller wraps it with route context
    if ( typeof(fn) != 'function' ) {
        return null;
    }
    if ( fn.constructor && fn.constructor.name === 'AsyncFunction' ) {
        throw new Error('policy `'+ name +'` is an `async function`, but the policy contract is SYNCHRONOUS: `module.exports = function (user, req) { return true; };`. The gate authorizes synchronously and allows only a literal `true`, so an async policy would deny this route on every request.');
    }

    var reg = getPolicyRegistry();
    if ( reg ) {
        reg[name] = fn;
    }
    return fn;
};

/**
 * Read a boot-registered policy.
 *
 * @param {string} name - the route's declared `param.policy`.
 * @returns {function|null}
 * @inner
 * @private
 */
var getPolicy = function (name) {
    var reg = ( typeof(process.gina) != 'undefined' && process.gina && process.gina._policies )
        ? process.gina._policies
        : null;

    return ( reg && typeof(reg[name]) == 'function' ) ? reg[name] : null;
};

/**
 * Warn ONCE that a policy broke the return contract.
 *
 * @param {string} name     - the policy name.
 * @param {*} returned      - whatever it returned instead of a boolean.
 * @returns {void}
 * @inner
 * @private
 */
var warnPolicyContractOnce = function (name, returned) {
    if ( _warnedPolicies[name] === true ) {
        return;
    }
    _warnedPolicies[name] = true;

    var shape = ( returned && typeof(returned.then) == 'function' )
        ? 'a promise'
        : '`'+ ( returned === null ? 'null' : typeof(returned) ) +'`';

    console.warn('[ authz ] policy `'+ name +'` returned '+ shape +', not a boolean — DENYING (fail-closed). The policy contract is SYNCHRONOUS: `module.exports = function (user, req) { return true; };`. Every request through this policy is denied until it returns a real boolean.');
};

/**
 * ANY-of role match: does the session user hold at least one of the roles the
 * route requires?
 *
 * Roles are opaque strings — no framework vocabulary, no wildcard, no
 * role→permission indirection (v1 names roles directly). A user whose `roles`
 * is absent or not an array holds NO roles, so any role-gated route denies.
 *
 * Exported so the controller's `self.hasRole(role)` escape hatch reads roles
 * through THIS definition rather than its own copy — "holding a role" must mean
 * exactly one thing framework-wide (the byte-identical-copy-paste class that
 * `lib/cmd-status-format` and `lib/json-config-header` were extracted to end).
 *
 * @param {object} user            - `req.session.user` (truthy by the time the gate calls
 *                                   this — it authenticates first; `self.hasRole` may pass
 *                                   `null` for an unauthenticated request).
 * @param {string[]} requiredRoles - the roles to test against. From the gate: the route's
 *                                   declared `param.roles` (the boot lint guarantees a
 *                                   non-empty array of non-empty strings).
 * @returns {boolean} `true` when at least one required role is held.
 *
 * @example
 * authzGate.hasAnyRole({ roles: ['editor'] }, ['admin', 'editor']);   // true
 * authzGate.hasAnyRole({ roles: 'admin' },    ['admin']);             // false — not an array
 * authzGate.hasAnyRole(null,                  ['admin']);             // false
 */
var hasAnyRole = function (user, requiredRoles) {
    var userRoles = ( user && Array.isArray(user.roles) ) ? user.roles : null;
    if ( !userRoles || userRoles.length === 0 ) {
        return false;
    }
    for (var i = 0; i < requiredRoles.length; ++i) {
        if ( userRoles.indexOf(requiredRoles[i]) > -1 ) {
            return true;
        }
    }
    return false;
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
        audit.emitAuthzDenied(req, '401'); // #COMPLY2 auto-event — contained, never affects the denial
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

    audit.emitAuthzDenied(req, 'login-bounce'); // #COMPLY2 auto-event — contained, never affects the bounce
    return bounceToLogin(req, res, loginRoute);
};

/**
 * Terminate an AUTHENTICATED request that fails an authorization check: a **403**
 * with a deliberately GENERIC body.
 *
 * The body never echoes the required roles (nor, later, a policy name) — those
 * name the bundle's authorization model, and a 403 that lists what WOULD have
 * been enough is a disclosure to exactly the caller that failed it. The
 * specifics land in the server-side log only.
 *
 * @param {object} controller - the per-request controller (its `throwError` writes the 403).
 * @param {object} req        - the request (read for the server-side log line only).
 * @param {string} reason     - the server-side-only denial detail.
 * @param {string} [outcome]  - the #COMPLY2 audit-event token (`'403-roles'` | `'403-policy'`), riding the record's `meta.outcome`.
 * @returns {boolean} always `false` — the gate has answered; the router must return.
 * @inner
 * @private
 */
var denyForbidden = function (controller, req, reason, outcome) {
    console.debug('[ authz ] denied `'+ ((req.routing && req.routing.rule) || '?') +'` — '+ reason);
    // #COMPLY2 auto-event — contained, never affects the denial. The outcome
    // token ('403-roles' | '403-policy') discriminates this writer's call
    // sites; `reason` stays server-side-only (console.debug above), so the
    // record leaks nothing the 403 body does not.
    audit.emitAuthzDenied(req, outcome || '403');
    controller.throwError({
        status : 403,
        error  : 'Forbidden'
    });
    return false;
};

/**
 * Run a route's declared policy — the record/attribute escape hatch RBAC cannot
 * express. Allow **iff** it returns a literal `true`; every other outcome denies.
 *
 * The three deny paths, all fail-CLOSED:
 *   * **unregistered** — the boot registrar guarantees a function for every declared
 *     `param.policy`, so reaching this means the registry was never built or was
 *     mutated. A gate that cannot find its policy must never allow;
 *   * **threw** — the caller learns only that it is Forbidden; the stack goes to the
 *     server-side log. A policy bug must not 500 the wire (nor, via the uncaught path,
 *     the bundle);
 *   * **did not return `true`** — including a promise, which is truthy. See the module
 *     header: this is the strictness that keeps a transpiled-async policy (boot-invisible)
 *     from failing OPEN.
 *
 * @param {object} controller - the per-request controller (its `throwError` writes the 403).
 * @param {object} req        - the request, handed to the policy as its 2nd argument.
 * @param {string} name       - the route's declared `param.policy`.
 * @param {object} user       - `req.session.user`, handed to the policy as its 1st argument.
 * @returns {boolean} `true` to continue to the action, `false` when denied (403 written).
 * @inner
 * @private
 */
var runPolicy = function (controller, req, name, user) {
    var fn = getPolicy(name);
    if ( !fn ) {
        return denyForbidden(controller, req, 'policy `'+ name +'` is not registered', '403-policy');
    }

    var allowed;
    try {
        allowed = fn(user, req);
    } catch (err) {
        console.error('[ authz ] policy `'+ name +'` threw for `'+ ((req.routing && req.routing.rule) || '?') +'`: '+ (err.stack || err.message || err));
        return denyForbidden(controller, req, 'policy `'+ name +'` threw', '403-policy');
    }

    if ( allowed === true ) {
        return true;
    }
    if ( typeof(allowed) != 'boolean' ) {
        warnPolicyContractOnce(name, allowed);
    }

    return denyForbidden(controller, req, 'policy `'+ name +'` did not allow', '403-policy');
};

/**
 * Authorize a request against the route it matched.
 *
 * NO-OP (returns `true`) unless the route declares an authorization key
 * (`param.requireAuth: true`, `param.roles` and/or `param.policy`). Evaluation order:
 * **authN → roles → policy** — an unauthenticated caller on a gated route always gets
 * the 401/bounce, never a 403 (it must not learn that the route is role- or
 * policy-restricted, only that it requires signing in). Roles and policy are
 * AND-composed: a route declaring both needs both to pass.
 *
 * @param {object} controller - the per-request controller (its `throwError` / `pauseRequest`
 *                              write the response).
 * @param {object} req        - the request. Reads `req.routing.param.requireAuth`,
 *                              `req.routing.param.roles`, `req.routing.param.policy`,
 *                              `req.session.user` (and its `.roles`), `req.isXMLRequest`
 *                              and `req[method]`.
 * @param {object} res        - the response (the bounce writes to it directly).
 * @returns {boolean} `true` to continue to the action, `false` when the gate has already
 *                    terminated the response (401 / 302 / 403).
 *
 * @example
 * // core/router.js, before the DTO pipe and the action dispatch
 * if ( !authzGate.authorizeRequest(controller, request, response) ) {
 *     return; // the gate answered (401 / login bounce / 403) — never reach the action
 * }
 */
var authorizeRequest = function (controller, req, res) {

    if ( !req || !req.routing || !req.routing.param ) {
        return true;
    }

    var param = req.routing.param;

    // `param.roles` IMPLIES `requireAuth` — an unauthenticated caller can hold no
    // role, so a role-gated route authenticates first even without the explicit flag.
    // Strictly a NON-EMPTY ARRAY: the boot lint rejects every other declared shape,
    // so an invalid `roles` reaching this point (a string, null, an empty array)
    // must never HALF-gate the route.
    var mustMatchRoles = ( Array.isArray(param.roles) && param.roles.length > 0 );

    // `param.policy` IMPLIES `requireAuth` too — a policy judges an authenticated
    // user, and it is handed one. Strictly a NON-EMPTY STRING, for the same reason:
    // the boot lint rejects every other declared shape, so an invalid `policy`
    // reaching this point must never HALF-gate the route.
    var mustRunPolicy  = ( typeof(param.policy) == 'string' && param.policy !== '' );

    // Strictly `=== true`: the boot lint rejects any other type, so by request time the
    // flag is `true`, `false` or absent — and an absent/false flag must never gate.
    if ( param.requireAuth !== true && !mustMatchRoles && !mustRunPolicy ) {
        return true;   // the route declares no authorization — nothing to do
    }

    if ( !isAuthenticated(req) ) {
        return denyUnauthenticated(controller, req, res);
    }

    // authN passed — from here every denial is a 403, never a 401.
    if ( mustMatchRoles && !hasAnyRole(req.session.user, param.roles) ) {
        return denyForbidden(controller, req, 'the session user holds none of the required roles', '403-roles');
    }

    // Roles AND policy: a route declaring both has already passed roles by here.
    if ( mustRunPolicy ) {
        return runPolicy(controller, req, param.policy, req.session.user);
    }

    return true;
};

module.exports = {
    authorizeRequest : authorizeRequest,
    isAuthenticated  : isAuthenticated,
    hasAnyRole       : hasAnyRole,
    registerPolicy   : registerPolicy
};
