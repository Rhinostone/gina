/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * Session plugin (#CSRF1) — hardened wrapper around `express-session`.
 *
 * Bundles adopt it with a one-line swap in their bootstrap:
 *
 *     // before
 *     // var session = require('express-session');
 *
 *     // after
 *     var session = require('gina').plugins.Session(require('express-session'));
 *
 * The wrapper reads `settings.json > session.cookie.*` and injects defaults
 * into the `options.cookie` object before express-session sees it. Bundle
 * code that sets cookie flags explicitly always wins — intentional choices
 * are preserved.
 *
 * Browser-parity invariant: `SameSite=None` without `Secure` is rejected at
 * factory call time (matching browser behaviour).
 *
 * @module plugins/session
 */

var ALLOWED_SAMESITE = ['lax', 'strict', 'none'];

/**
 * Read the active bundle's `settings.json > session.cookie.*` section and
 * return the merged framework defaults.
 *
 * Falls back to safe defaults when the bundle context is not ready yet
 * (e.g. `Session()` invoked at module-require time, before
 * `onInitialize`).
 *
 * @returns {{sameSite: string, httpOnly: boolean, secure: (boolean|string)}}
 * @throws  {Error} when a setting has an unsupported value.
 * @inner
 * @private
 */
function resolveSettingsDefaults() {
    var defaults   = { sameSite: 'lax', httpOnly: true, secure: 'auto' };
    var cookieConf = {};

    try {
        var ctx    = getContext();
        var bundle = ctx && ctx.bundle;
        var env    = ctx && ctx.env;
        var conf   = (typeof getConfig === 'function') ? getConfig() : null;
        if (bundle && env && conf && conf[bundle] && conf[bundle][env]) {
            var content  = conf[bundle][env].content || {};
            var settings = content.settings || {};
            var session  = settings.session || {};
            cookieConf   = session.cookie || {};
        }
    } catch (ignored) {
        cookieConf = {};
    }

    if (typeof cookieConf.sameSite === 'string') {
        var s = cookieConf.sameSite.toLowerCase();
        if (ALLOWED_SAMESITE.indexOf(s) < 0) {
            throw new Error(
                '[gina session] settings.json > session.cookie.sameSite must be one of '
                + ALLOWED_SAMESITE.map(function (v) { return '"' + v + '"'; }).join(', ')
                + ' — got: ' + JSON.stringify(cookieConf.sameSite)
            );
        }
        defaults.sameSite = s;
    }

    if (typeof cookieConf.httpOnly === 'boolean') {
        defaults.httpOnly = cookieConf.httpOnly;
    }

    if (typeof cookieConf.secure !== 'undefined') {
        if (cookieConf.secure !== true
            && cookieConf.secure !== false
            && cookieConf.secure !== 'auto'
        ) {
            throw new Error(
                '[gina session] settings.json > session.cookie.secure must be true, false, or "auto"'
                + ' — got: ' + JSON.stringify(cookieConf.secure)
            );
        }
        defaults.secure = cookieConf.secure;
    }

    return defaults;
}

/**
 * Merge caller-supplied cookie options on top of the resolved defaults.
 * Caller-supplied values always win — `httpOnly: false` passed by a bundle
 * stays `false` even when the default is `true`.
 *
 * @param {object|undefined} caller
 * @param {object}           defaults
 * @returns {object}
 * @inner
 * @private
 */
function mergeCookie(caller, defaults) {
    caller = caller || {};
    var merged = {};
    if (!Object.prototype.hasOwnProperty.call(caller, 'sameSite')) merged.sameSite = defaults.sameSite;
    if (!Object.prototype.hasOwnProperty.call(caller, 'httpOnly')) merged.httpOnly = defaults.httpOnly;
    if (!Object.prototype.hasOwnProperty.call(caller, 'secure'))   merged.secure   = defaults.secure;
    for (var key in caller) {
        if (Object.prototype.hasOwnProperty.call(caller, key)) merged[key] = caller[key];
    }
    return merged;
}

/**
 * Browser-parity invariant: a cookie carrying `SameSite=None` must also
 * carry `Secure`, or the browser discards it.
 *
 * @param {object} cookie — the merged options object
 * @throws {Error}
 * @inner
 * @private
 */
function assertInvariant(cookie) {
    var sameSite = (typeof cookie.sameSite === 'string')
        ? cookie.sameSite.toLowerCase()
        : cookie.sameSite;
    if (sameSite === 'none' && cookie.secure !== true) {
        throw new Error(
            '[gina session] invariant violation: SameSite=None cookies require Secure=true (browser-parity).'
            + ' Set cookie.secure=true or settings.json > session.cookie.secure=true.'
            + ' Current: sameSite=' + JSON.stringify(cookie.sameSite)
            + ', secure=' + JSON.stringify(cookie.secure)
        );
    }
}

/**
 * Wrap an `express-session` module reference and return a drop-in
 * replacement that injects cookie defaults.
 *
 * @example
 * var session = require('gina').plugins.Session(require('express-session'));
 * app.use(session({ name: 'sessionid', cookie: { maxAge: 86400000 } }));
 *
 * @param   {function} expressSession — the value returned by `require('express-session')`
 * @returns {function}                  — drop-in replacement for the session factory
 * @throws  {Error} when the first argument is not a function
 */
function Session(expressSession) {
    if (typeof expressSession !== 'function') {
        throw new Error(
            '[gina session] expected the express-session module as the first argument.'
            + ' Usage: require("gina").plugins.Session(require("express-session"))'
        );
    }

    function ginaSessionDispatch(options) {
        options = options || {};
        var defaults = resolveSettingsDefaults();
        options.cookie = mergeCookie(options.cookie, defaults);
        assertInvariant(options.cookie);
        return expressSession(options);
    }

    var wrapped = function (options) { return ginaSessionDispatch(options); };

    // Drop-in identity: introspection (`session.name`) returns the upstream
    // identity (`'session'`), while gina stays visible in stack traces via
    // the inner `ginaSessionDispatch` frame. Without this, freelancer/v3 and
    // other bundles that sniff `session.name === 'session'` saw `'ginaSession'`
    // — the wrapper was clobbering the upstream identity.
    Object.defineProperty(wrapped, 'name', {
        value: expressSession.name,
        configurable: true
    });

    // Preserve express-session's static surface (.Store, .MemoryStore,
    // .Session, .Cookie). Consumers do `var MemoryStore = session.MemoryStore`
    // and similar, and those must keep working.
    for (var k in expressSession) {
        if (Object.prototype.hasOwnProperty.call(expressSession, k)) {
            wrapped[k] = expressSession[k];
        }
    }

    return wrapped;
}

// Exposed for unit testing. Do not rely on these in application code — they
// may change without notice.
Session._resolveSettingsDefaults = resolveSettingsDefaults;
Session._mergeCookie             = mergeCookie;
Session._assertInvariant         = assertInvariant;
Session._ALLOWED_SAMESITE        = ALLOWED_SAMESITE;

module.exports = Session;
