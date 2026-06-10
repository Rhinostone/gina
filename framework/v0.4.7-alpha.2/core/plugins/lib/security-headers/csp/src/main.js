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
 * Bundles adopt it inside the bundle bootstrap:
 *
 *     var myapp = require('gina');
 *     var csp   = require('gina').plugins.Csp({
 *         directives: {
 *             'default-src': ["'self'"],
 *             'script-src':  ["'self'", 'https://cdn.example.com'],
 *             'style-src':   ["'self'", "'unsafe-inline'"],
 *             'img-src':     ["'self'", 'data:', 'https:']
 *         }
 *     });
 *
 *     myapp.onInitialize(function(event, app) {
 *         app.use(csp);
 *         event.emit('complete', app);
 *     });
 *
 * **Per-response CSP nonce (`useNonce: true`)** — opt-in (default `false`).
 * When enabled, the middleware generates a fresh cryptographically-random
 * nonce per response (`crypto.randomBytes(16).toString('base64')` — 128 bits,
 * the W3C CSP3 nonce-entropy floor), stamps it on `req._ginaCspNonce`, and
 * appends `'nonce-XXXX'` to the `script-src` directive (falling back to
 * `default-src` when `script-src` is absent; throws at factory call time if
 * neither is present, since the nonce would have nowhere to attach). The swig
 * and nunjucks render delegates read `req._ginaCspNonce` and set a matching
 * `nonce="XXXX"` attribute on every framework-injected inline `<script>` (the
 * `onGinaLoaded` bootstrap, plus the dev-only Inspector blocks). This lets a
 * bundle drop `'unsafe-inline'` from `script-src` without breaking the
 * framework bootstrap.
 *
 * When `useNonce` is `false`, the header value is computed once at factory
 * time and reused on every response (zero per-request allocation) and no
 * `req` slot is written — applications that don't opt in get the exact
 * pre-nonce behaviour.
 *
 * `req._ginaCspNonce` is the documented per-request carrier (mirrors the
 * `req._ginaProxyPrefix` precedent). It is written ONLY when gina is the one
 * setting the CSP header (the idempotent first-writer-wins guard): if an
 * upstream proxy / ingress already set the header, no nonce is generated and
 * none is emitted on the tags, keeping the header and the tags consistent.
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
 * In report-only mode the plugin also OMITS directives that browsers ignore
 * there (`REPORT_ONLY_IGNORED_DIRECTIVES` — currently just `sandbox`, which
 * every engine ignores in report-only: it applies a restriction but produces
 * no violation report and triggers a browser console warning). The omission
 * is functionally identical (the directive does nothing in report-only) and
 * silences that console warning; a one-time factory-time `console.warn`
 * names what was dropped. The omitted directives remain in the configured
 * set, so an enforcing factory built from the same config still emits them.
 * `frame-ancestors` is NOT omitted — its report-only behaviour is
 * engine-divergent: the CSP3 spec, Gecko and Blink evaluate it and send
 * violation reports (without enforcing), while WebKit alone ignores it with
 * a console warning and no report (it retains CSP2's rule that the directive
 * MUST be ignored when monitoring, which CSP3 dropped). Keeping it preserves
 * the observation-phase signal on Chrome + Firefox; WebKit-heavy consumers
 * can leave it out of their own report-only directive set. A report-only
 * policy whose every directive is inert (e.g. only `sandbox`) throws at
 * factory call time.
 *
 * Opens Phase 2 of the gina security-headers track (Phase 1 = HDR1-4 +
 * HDR7 shipped in 0.3.15-alpha). Single-header plugin shape — composes
 * cleanly under the future `SecurityHeaders` combined wrapper (#HDR15).
 *
 * @module plugins/security-headers/csp
 */

var crypto = require('crypto');

var HEADER_NAME             = 'content-security-policy';
var HEADER_NAME_REPORT_ONLY = 'content-security-policy-report-only';
var DEFAULT_REPORT_ONLY     = false;
var DEFAULT_USE_NONCE       = false;
var NONCE_BYTES             = 16;   // 128 bits — the W3C CSP3 nonce-entropy floor

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
 * Directives that browsers IGNORE when delivered in a
 * `Content-Security-Policy-Report-Only` header. A report-only policy monitors
 * and reports violations but enforces nothing; `sandbox` applies a
 * document-level restriction that produces no reportable violation, so the
 * browser drops it in report-only mode AND emits a console warning
 * ("Ignoring sandbox directive when delivered in a report-only policy"). It
 * therefore contributes browser-console noise and zero monitoring value, so
 * the plugin omits it from a report-only header (see the `reportOnly` notes in
 * the module docstring above).
 *
 * Deliberately conservative — `sandbox` is the only directive confirmed
 * ignored in report-only across ALL engines: CSP2 spec text ("The sandbox
 * directive will be ignored when monitoring a policy"), MDN's Report-Only
 * page ("supports all Content-Security-Policy directives except sandbox,
 * which is ignored"), Chromium's SupportedInReportOnly() (false for
 * Sandbox), and WebKit's console warning. Intentionally NOT included:
 *  - `frame-ancestors` — report-only behaviour is ENGINE-DIVERGENT. The CSP3
 *    spec, Gecko and Blink evaluate it and send violation reports without
 *    enforcing (Chromium's SupportedInReportOnly() is true for
 *    FrameAncestors; the WPT report-only frame-ancestors test asserts the
 *    report). WebKit alone ignores it, logs "The Content Security Policy
 *    directive 'frame-ancestors' is ignored when delivered in a report-only
 *    policy." and sends no report — it retains CSP2's "MUST be ignored when
 *    monitoring a policy", which CSP3 dropped (CSP3 restricts only `<meta>`
 *    delivery, which a report-only policy cannot use anyway). Omitting it
 *    would discard the observation-phase signal on Chrome + Firefox;
 *    consumers serving WebKit-heavy audiences that want a clean Safari
 *    console can omit it from their own report-only directive set
 *    (clickjacking stays enforced by X-Frame-Options and/or an enforcing
 *    frame-ancestors regardless).
 *  - `upgrade-insecure-requests` / `block-all-mixed-content` — not confirmed
 *    inert across engines: Chromium ignores-and-warns
 *    `upgrade-insecure-requests` in report-only but supports
 *    `block-all-mixed-content` there, and Gecko/WebKit behaviour is
 *    unverified; excluded under uncertainty (omitting a directive that may
 *    still act/report would lose behaviour or signal). Expanding this list
 *    requires an empirical per-engine check first.
 *
 * @constant
 * @type {string[]}
 */
var REPORT_ONLY_IGNORED_DIRECTIVES = [
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
 * When `nonce` is supplied, the matching `'nonce-<value>'` source-expression
 * is appended to the `nonceTarget` directive only (the rest are untouched).
 * Called with one argument (the static path), `nonce` is `undefined` and the
 * output is identical to the pre-nonce behaviour.
 *
 * @param {object}  normalised
 * @param {string} [nonce]       — raw base64 nonce value (no `nonce-` prefix).
 * @param {string} [nonceTarget] — directive name to append the nonce to.
 * @returns {string}
 * @inner
 * @private
 */
function buildHeaderValue(normalised, nonce, nonceTarget) {
    var parts = [];
    var keys  = Object.keys(normalised);
    for (var i = 0; i < keys.length; i++) {
        var name  = keys[i];
        var value = normalised[name];
        var extra = (nonce && name === nonceTarget) ? (" 'nonce-" + nonce + "'") : '';
        if (value === true) {
            parts.push(name + extra);
        } else if (typeof value === 'string') {
            parts.push(name + ' ' + value + extra);
        } else if (Array.isArray(value)) {
            parts.push(name + ' ' + value.join(' ') + extra);
        }
    }
    return parts.join('; ');
}


/**
 * Return a shallow copy of the normalised directive dict with the
 * report-only-inert directives (`REPORT_ONLY_IGNORED_DIRECTIVES`) removed.
 * Used only when `reportOnly` is true. Pure — never mutates the input, so the
 * full configured set survives for an enforcing factory built from the same
 * directives.
 *
 * @param {object} normalised — validated directive dict from resolveDirectives.
 * @returns {object} a new dict without the report-only-ignored directives.
 * @inner
 * @private
 */
function stripReportOnlyIgnored(normalised) {
    var out  = {};
    var keys = Object.keys(normalised);
    for (var i = 0; i < keys.length; i++) {
        var name = keys[i];
        if (REPORT_ONLY_IGNORED_DIRECTIVES.indexOf(name) !== -1) {
            continue;
        }
        out[name] = normalised[name];
    }
    return out;
}


/**
 * Coerce `useNonce` to a strict boolean. Defaults to `false` (static header,
 * no per-request nonce). `true` opts into per-response nonce generation.
 *
 * @param {*} value
 * @returns {boolean}
 * @throws  {Error}
 * @inner
 * @private
 */
function resolveUseNonce(value) {
    if (typeof value === 'undefined' || value === null) {
        return DEFAULT_USE_NONCE;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    throw new Error(
        '[gina.plugins.Csp] useNonce must be a boolean (true generates a '
        + 'per-response nonce and appends it to script-src; false emits a '
        + 'static policy); received ' + typeof value + '.'
    );
}


/**
 * Resolve which directive the per-response nonce attaches to. Prefers
 * `script-src` (the directive governing inline `<script>` execution), falling
 * back to `default-src`. Throws at factory call time when neither is present —
 * `useNonce: true` is meaningless if there is no script-governing directive
 * for the nonce to extend.
 *
 * @param {object} normalised — the validated directive dict.
 * @returns {string}
 * @throws  {Error}
 * @inner
 * @private
 */
function resolveNonceTarget(normalised) {
    if (Object.prototype.hasOwnProperty.call(normalised, 'script-src')) {
        return 'script-src';
    }
    if (Object.prototype.hasOwnProperty.call(normalised, 'default-src')) {
        return 'default-src';
    }
    throw new Error(
        '[gina.plugins.Csp] useNonce:true requires a "script-src" (or '
        + '"default-src") directive for the per-response nonce to attach to; '
        + 'neither is present. Add "script-src" to your directives — that is '
        + 'the directive governing inline <script> execution.'
    );
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
 * @example
 * // Per-response nonce — drop 'unsafe-inline' from script-src. The framework
 * // bootstrap + Inspector inline <script>s automatically carry the nonce.
 * var csp = require('gina').plugins.Csp({
 *     directives: { 'script-src': ["'self'"] },
 *     useNonce: true
 * });
 * app.use(csp);
 * // → Content-Security-Policy: script-src 'self' 'nonce-<base64>'
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
 * @param   {boolean} [opts.useNonce=false]    — generate a per-response
 *                                               nonce, stamp it on
 *                                               `req._ginaCspNonce`, and
 *                                               append `'nonce-XXXX'` to
 *                                               script-src (fallback
 *                                               default-src). Lets bundles
 *                                               drop `'unsafe-inline'`.
 * @returns {function}                         — express middleware
 *                                               `(req, res, next) => void`
 * @throws  {Error}                            — when `directives` is
 *                                               missing/empty, contains an
 *                                               unknown directive name, has
 *                                               invalid value shapes, or
 *                                               `useNonce:true` with no
 *                                               script-src/default-src.
 */
function Csp(opts) {
    var defaults    = resolveSettingsDefaults();
    var merged      = mergeOptions(opts, defaults);

    var directives  = resolveDirectives(merged.directives);
    var reportOnly  = resolveReportOnly(merged.reportOnly);
    var useNonce    = resolveUseNonce(merged.useNonce);

    // Report-only mode: drop directives browsers ignore in a report-only
    // header (REPORT_ONLY_IGNORED_DIRECTIVES — currently `sandbox`). They apply
    // no restriction and emit no violation report there, so omitting them is
    // functionally identical while silencing the browser console warning. They
    // survive in `directives`, so an enforcing factory built from the same
    // config still emits them.
    var emitDirectives = directives;
    if (reportOnly) {
        emitDirectives = stripReportOnlyIgnored(directives);
        var dropped = Object.keys(directives).filter(function (d) {
            return !Object.prototype.hasOwnProperty.call(emitDirectives, d);
        });
        if (Object.keys(emitDirectives).length === 0) {
            // Mirrors the all-omitted throw in resolveDirectives: an empty CSP
            // is invalid, and a report-only policy made entirely of inert
            // directives reports nothing — surface it at factory (boot) time.
            throw new Error(
                '[gina.plugins.Csp] reportOnly:true but every configured directive is '
                + 'ignored by browsers in report-only mode (' + dropped.join(', ') + '). '
                + 'A report-only policy needs at least one directive that produces '
                + 'violation reports (e.g. script-src / default-src / frame-ancestors). '
                + 'sandbox applies a restriction but reports nothing, so it is dropped '
                + 'in report-only mode.'
            );
        }
        if (dropped.length > 0) {
            // Transparency: the emitted header diverges from the configured
            // directives. One line at factory (boot) time — per call, no
            // module-level latch — so the operator knows why a configured
            // directive is absent from the wire.
            console.warn(
                '[gina.plugins.Csp] reportOnly:true — omitting directive(s) ignored by '
                + 'browsers in report-only mode: ' + dropped.join(', ') + '. They apply no '
                + 'restriction and emit a browser console warning in report-only mode; they '
                + 'are included automatically when reportOnly is false.'
            );
        }
    }

    var headerName  = reportOnly ? HEADER_NAME_REPORT_ONLY : HEADER_NAME;
    // Static value — reused on every response when useNonce is off.
    var headerValue = buildHeaderValue(emitDirectives);
    // Fail-fast at factory time: a nonce needs a script-governing directive.
    // Resolved from `directives` (not emitDirectives) — the nonce target is
    // always script-src/default-src, which are never report-only-stripped, so
    // the two sets agree; the middleware still serialises emitDirectives.
    var nonceTarget = useNonce ? resolveNonceTarget(directives) : null;

    return function ginaCsp(req, res, next) {
        if (typeof res.getHeader === 'function' && res.getHeader(headerName)) {
            return next();
        }
        if (useNonce) {
            // Fresh per-response nonce; stamp the per-request carrier so the
            // render delegates can mirror it onto framework inline <script>s.
            var nonce = crypto.randomBytes(NONCE_BYTES).toString('base64');
            if (req) { req._ginaCspNonce = nonce; }
            res.setHeader(headerName, buildHeaderValue(emitDirectives, nonce, nonceTarget));
        } else {
            res.setHeader(headerName, headerValue);
        }
        next();
    };
}


// Exposed for unit testing. Do not rely on these in application code.
Csp._HEADER_NAME              = HEADER_NAME;
Csp._HEADER_NAME_REPORT_ONLY  = HEADER_NAME_REPORT_ONLY;
Csp._DEFAULT_REPORT_ONLY      = DEFAULT_REPORT_ONLY;
Csp._DEFAULT_USE_NONCE        = DEFAULT_USE_NONCE;
Csp._NONCE_BYTES              = NONCE_BYTES;
Csp._VALID_DIRECTIVES         = VALID_DIRECTIVES;
Csp._BOOLEAN_ONLY_DIRECTIVES  = BOOLEAN_ONLY_DIRECTIVES;
Csp._HYBRID_DIRECTIVES        = HYBRID_DIRECTIVES;
Csp._resolveSettingsDefaults  = resolveSettingsDefaults;
Csp._mergeOptions             = mergeOptions;
Csp._resolveDirectives        = resolveDirectives;
Csp._resolveReportOnly        = resolveReportOnly;
Csp._resolveUseNonce          = resolveUseNonce;
Csp._resolveNonceTarget       = resolveNonceTarget;
Csp._buildHeaderValue         = buildHeaderValue;
Csp._REPORT_ONLY_IGNORED_DIRECTIVES = REPORT_ONLY_IGNORED_DIRECTIVES;
Csp._stripReportOnlyIgnored         = stripReportOnlyIgnored;

module.exports = Csp;
