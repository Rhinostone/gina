/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * Content-Security-Policy plugin (#HDR5) — emits the
 * `Content-Security-Policy` (or `Content-Security-Policy-Report-Only`)
 * response header on every response, limiting which resources the browser
 * is allowed to load and from where.
 *
 * Bundles adopt it with a one-line bootstrap add:
 *
 *     var express = require('express');
 *     var csp     = require('gina').plugins.Csp({
 *         directives: {
 *             'default-src': ["'self'"],
 *             'script-src':  ["'self'", 'https://cdn.example.com'],
 *             'style-src':   ["'self'", "'unsafe-inline'"],
 *             'img-src':     ["'self'", 'data:', 'https:']
 *         }
 *     });
 *     var app     = express();
 *
 *     app.use(csp);
 *
 * v0 ships STATIC DIRECTIVES ONLY. Per-response nonce wiring requires
 * template-render integration and defers to a separate CSP-aware view-layer
 * plugin that can co-operate with swig / nunjucks template rendering.
 *
 * **Configuration is the primary API surface** — there is no sensible
 * cross-bundle default. Every bundle has its own resource graph; a default
 * policy would either be too restrictive (breaks every bundle that loads
 * external resources) or too permissive (gives no real protection). The
 * factory throws at call time if `directives` is missing or empty.
 *
 * **Strict whitelist of CSP Level 3 standard directives** — unknown
 * directive names throw at factory call time. CSP typos are silent:
 * browsers ignore unknown directive names with no error, no console
 * warning. A `scrpt-src 'self'` typo would mean NO script-source policy is
 * applied, the page is unprotected, and the developer doesn't know.
 * Fail-fast at factory call time is the only mechanism that catches this
 * class.
 *
 * Experimental / future directives (e.g. `webrtc`, `fenced-frame-src`)
 * are not yet supported. The whitelist tracks the W3C CSP Level 3 spec
 * (https://www.w3.org/TR/CSP3/#csp-directives); new entries land when the
 * spec adds them.
 *
 * **`reportOnly: true`** switches the response header name from
 * `Content-Security-Policy` to `Content-Security-Policy-Report-Only` —
 * useful for non-enforcing migration testing. The browser reports
 * violations but does not block any resources.
 *
 * Opens Phase 2 of the gina security-headers track (Phase 1 = HDR1-4 +
 * HDR7 shipped in 0.3.15-alpha). Single-header plugin shape — composes
 * cleanly under the future `SecurityHeaders` combined wrapper (#HDR15).
 *
 * @module plugins/csp
 */

var HEADER_NAME             = 'content-security-policy';
var HEADER_NAME_REPORT_ONLY = 'content-security-policy-report-only';
var DEFAULT_REPORT_ONLY     = false;

/**
 * CSP Level 3 standard directives, alphabetical within category.
 *
 * Reference: https://www.w3.org/TR/CSP3/#csp-directives
 *
 * @constant
 * @type {string[]}
 */
var VALID_DIRECTIVES = [
    // Fetch directives
    'child-src',
    'connect-src',
    'default-src',
    'font-src',
    'frame-src',
    'img-src',
    'manifest-src',
    'media-src',
    'object-src',
    'prefetch-src',
    'script-src',
    'script-src-attr',
    'script-src-elem',
    'style-src',
    'style-src-attr',
    'style-src-elem',
    'worker-src',
    // Document directives
    'base-uri',
    'sandbox',
    // Navigation directives
    'form-action',
    'frame-ancestors',
    // Reporting directives
    'report-to',
    'report-uri',
    // Document policies
    'block-all-mixed-content',
    'upgrade-insecure-requests',
    // Trusted Types
    'require-trusted-types-for',
    'trusted-types'
];

/**
 * Boolean-only directives (presence-or-absence semantics — value must be
 * `true` to emit or `false` to omit; string/array values throw).
 *
 * @constant
 * @type {string[]}
 */
var BOOLEAN_ONLY_DIRECTIVES = [
    'block-all-mixed-content',
    'upgrade-insecure-requests'
];

/**
 * Hybrid directives that accept EITHER boolean true (emit name alone) OR a
 * source-list value (string / array). Per CSP Level 3, `sandbox` with no
 * value applies all sandbox restrictions; with a value, allows specific
 * exceptions (e.g. `sandbox allow-scripts`).
 *
 * @constant
 * @type {string[]}
 */
var HYBRID_DIRECTIVES = [
    'sandbox'
];


/**
 * Read the active bundle's `settings.json > csp.*` block and return the
 * merged framework defaults.
 *
 * Falls back to an empty object when the bundle context is not ready yet
 * (e.g. `Csp()` invoked at module-require time, before `onInitialize`).
 *
 * @returns {object}
 * @inner
 * @private
 */
function resolveSettingsDefaults() {
    var defaults   = {};
    var pluginConf = {};

    try {
        var ctx    = getContext();
        var bundle = ctx && ctx.bundle;
        var env    = ctx && ctx.env;
        var conf   = (typeof getConfig === 'function') ? getConfig() : null;
        if (bundle && env && conf && conf[bundle] && conf[bundle][env]) {
            var content  = conf[bundle][env].content || {};
            var settings = content.settings || {};
            pluginConf   = settings.csp || {};
        }
    } catch (ignored) {
        pluginConf = {};
    }

    for (var k in pluginConf) {
        if (Object.prototype.hasOwnProperty.call(pluginConf, k)) {
            defaults[k] = pluginConf[k];
        }
    }

    return defaults;
}


/**
 * Merge caller-supplied options on top of the resolved defaults. Caller-
 * supplied values always win (`hasOwnProperty`-guarded). Shallow — the
 * `directives` object is replaced wholesale by the caller's `directives`,
 * not key-by-key merged. Callers that want to merge with settings
 * explicitly can do so before passing.
 *
 * @param {object|undefined} caller
 * @param {object}           defaults
 * @returns {object}
 * @inner
 * @private
 */
function mergeOptions(caller, defaults) {
    caller = caller || {};
    var merged = {};
    for (var dk in defaults) {
        if (Object.prototype.hasOwnProperty.call(defaults, dk)) merged[dk] = defaults[dk];
    }
    for (var ck in caller) {
        if (Object.prototype.hasOwnProperty.call(caller, ck)) merged[ck] = caller[ck];
    }
    return merged;
}


/**
 * Validate and normalise the `directives` object.
 *
 * Throws at factory call time for:
 *  - missing / non-object / empty `directives`
 *  - unknown directive name (not in CSP Level 3 standard whitelist)
 *  - boolean value on a source-list directive that isn't `sandbox`
 *  - non-boolean value on a boolean-only directive
 *  - non-string array entries
 *  - all-omitted result (every entry resolved to `false`)
 *
 * Returns a normalised dict where values are one of: `true` (emit name
 * alone), string (emit name + space + string), array (emit name + space +
 * space-joined). Omitted directives (`false`) are excluded.
 *
 * @param {object} directives
 * @returns {object}
 * @throws  {Error}
 * @inner
 * @private
 */
function resolveDirectives(directives) {
    if (!directives || typeof directives !== 'object' || Array.isArray(directives)) {
        throw new Error(
            '[gina.plugins.Csp] directives is required and must be a non-empty object. '
            + 'There is no sensible cross-bundle default; every bundle has its own '
            + 'resource graph. See https://www.w3.org/TR/CSP3/#csp-directives for the '
            + 'directive list.'
        );
    }

    var keys = Object.keys(directives);
    if (keys.length === 0) {
        throw new Error(
            '[gina.plugins.Csp] directives must contain at least one directive — '
            + 'received an empty object. See https://www.w3.org/TR/CSP3/#csp-directives'
        );
    }

    var normalised = {};
    for (var i = 0; i < keys.length; i++) {
        var originalKey   = keys[i];
        var directiveName = String(originalKey).toLowerCase();
        var value         = directives[originalKey];

        if (VALID_DIRECTIVES.indexOf(directiveName) === -1) {
            throw new Error(
                '[gina.plugins.Csp] unknown directive name "' + originalKey + '". '
                + 'Expected one of: ' + VALID_DIRECTIVES.join(', ') + '. '
                + '(Per CSP Level 3 — https://www.w3.org/TR/CSP3/#csp-directives. '
                + 'Experimental / future directives are not yet supported; '
                + 'open an issue to request inclusion.)'
            );
        }

        // false omits the directive (regardless of category)
        if (value === false) continue;

        var isBooleanOnly = BOOLEAN_ONLY_DIRECTIVES.indexOf(directiveName) !== -1;
        var isHybrid      = HYBRID_DIRECTIVES.indexOf(directiveName) !== -1;

        if (isBooleanOnly) {
            if (value !== true) {
                throw new Error(
                    '[gina.plugins.Csp] directive "' + directiveName + '" is boolean-only '
                    + '(presence-or-absence per CSP Level 3); value must be true (emit) '
                    + 'or false (omit). Received: ' + JSON.stringify(value) + '.'
                );
            }
            normalised[directiveName] = true;
            continue;
        }

        if (value === true) {
            if (!isHybrid) {
                throw new Error(
                    '[gina.plugins.Csp] directive "' + directiveName + '" is a source-list '
                    + 'directive; value must be a string (e.g. "\'self\' https:"), an array '
                    + 'of source-list tokens (e.g. ["\'self\'", "https:"]), or false to '
                    + 'omit. Boolean true is only valid for boolean-only and hybrid '
                    + 'directives (sandbox).'
                );
            }
            normalised[directiveName] = true;
            continue;
        }

        if (typeof value === 'string') {
            normalised[directiveName] = value;
            continue;
        }

        if (Array.isArray(value)) {
            for (var j = 0; j < value.length; j++) {
                if (typeof value[j] !== 'string') {
                    throw new Error(
                        '[gina.plugins.Csp] directive "' + directiveName + '" array '
                        + 'entries must be strings; received ' + typeof value[j]
                        + ' at index ' + j + '.'
                    );
                }
            }
            normalised[directiveName] = value.slice();
            continue;
        }

        throw new Error(
            '[gina.plugins.Csp] directive "' + directiveName + '" value must be a '
            + 'string, an array of strings, or false; received ' + typeof value + '.'
        );
    }

    if (Object.keys(normalised).length === 0) {
        throw new Error(
            '[gina.plugins.Csp] directives object resolved to zero enabled directives '
            + '— every entry was omitted (false). Set at least one directive to a '
            + 'source-list value or true.'
        );
    }

    return normalised;
}


/**
 * Coerce reportOnly to a strict boolean. Defaults to false (emit
 * Content-Security-Policy). True emits Content-Security-Policy-Report-Only
 * instead — browsers report violations but do not block resources.
 *
 * @param {*} value
 * @returns {boolean}
 * @throws  {Error}
 * @inner
 * @private
 */
function resolveReportOnly(value) {
    if (typeof value === 'undefined' || value === null) {
        return DEFAULT_REPORT_ONLY;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    throw new Error(
        '[gina.plugins.Csp] reportOnly must be a boolean (true emits '
        + 'Content-Security-Policy-Report-Only, false emits '
        + 'Content-Security-Policy); received ' + typeof value + '.'
    );
}


/**
 * Build the header value string from a normalised directive dict.
 *
 * Per CSP Level 3 §3.1: directives are separated by `;`; each directive
 * consists of a directive name + space + space-separated source-list
 * values (or just the directive name for boolean-only / empty `sandbox`).
 *
 * @param {object} normalised
 * @returns {string}
 * @inner
 * @private
 */
function buildHeaderValue(normalised) {
    var parts = [];
    var keys  = Object.keys(normalised);
    for (var i = 0; i < keys.length; i++) {
        var name  = keys[i];
        var value = normalised[name];
        if (value === true) {
            parts.push(name);
        } else if (typeof value === 'string') {
            parts.push(name + ' ' + value);
        } else if (Array.isArray(value)) {
            parts.push(name + ' ' + value.join(' '));
        }
    }
    return parts.join('; ');
}


/**
 * Return an express-compatible middleware that sets the
 * `Content-Security-Policy` (or `Content-Security-Policy-Report-Only`)
 * response header.
 *
 * Idempotent — if the header is already set by an earlier middleware, the
 * existing value is preserved and `next()` is called immediately.
 *
 * @example
 * var csp = require('gina').plugins.Csp({
 *     directives: {
 *         'default-src': ["'self'"],
 *         'script-src':  ["'self'", 'https://cdn.example.com'],
 *         'upgrade-insecure-requests': true
 *     },
 *     reportOnly: false
 * });
 * app.use(csp);
 *
 * @param   {object}  opts
 * @param   {object}  opts.directives          — CSP Level 3 directives.
 *                                               Required; throws if missing
 *                                               or empty. Keys: directive
 *                                               names (case-insensitive,
 *                                               validated against CSP
 *                                               Level 3 whitelist). Values:
 *                                               string (source list), array
 *                                               of strings, true (boolean-
 *                                               only / sandbox-with-no-
 *                                               value), or false (omit).
 * @param   {boolean} [opts.reportOnly=false]  — emit
 *                                               Content-Security-Policy-
 *                                               Report-Only instead of
 *                                               Content-Security-Policy.
 * @returns {function}                         — express middleware
 *                                               `(req, res, next) => void`
 * @throws  {Error}                            — when `directives` is
 *                                               missing/empty, contains an
 *                                               unknown directive name, or
 *                                               has invalid value shapes.
 */
function Csp(opts) {
    var defaults    = resolveSettingsDefaults();
    var merged      = mergeOptions(opts, defaults);

    var directives  = resolveDirectives(merged.directives);
    var reportOnly  = resolveReportOnly(merged.reportOnly);

    var headerValue = buildHeaderValue(directives);
    var headerName  = reportOnly ? HEADER_NAME_REPORT_ONLY : HEADER_NAME;

    return function ginaCsp(req, res, next) {
        if (typeof res.getHeader === 'function' && res.getHeader(headerName)) {
            return next();
        }
        res.setHeader(headerName, headerValue);
        next();
    };
}


// Exposed for unit testing. Do not rely on these in application code.
Csp._HEADER_NAME              = HEADER_NAME;
Csp._HEADER_NAME_REPORT_ONLY  = HEADER_NAME_REPORT_ONLY;
Csp._DEFAULT_REPORT_ONLY      = DEFAULT_REPORT_ONLY;
Csp._VALID_DIRECTIVES         = VALID_DIRECTIVES;
Csp._BOOLEAN_ONLY_DIRECTIVES  = BOOLEAN_ONLY_DIRECTIVES;
Csp._HYBRID_DIRECTIVES        = HYBRID_DIRECTIVES;
Csp._resolveSettingsDefaults  = resolveSettingsDefaults;
Csp._mergeOptions             = mergeOptions;
Csp._resolveDirectives        = resolveDirectives;
Csp._resolveReportOnly        = resolveReportOnly;
Csp._buildHeaderValue         = buildHeaderValue;

module.exports = Csp;
