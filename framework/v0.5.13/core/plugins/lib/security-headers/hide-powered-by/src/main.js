/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * Hide X-Powered-By plugin (#HDR8) — removes the `X-Powered-By` response
 * header on every response. Opens Phase 1.5 (helmet-parity gap-fill).
 *
 * Bundles adopt it inside the bundle bootstrap:
 *
 *     var myapp          = require('gina');
 *     var hidePoweredBy  = require('gina').plugins.HidePoweredBy();
 *
 *     myapp.onInitialize(function(event, app) {
 *         app.use(hidePoweredBy);
 *         event.emit('complete', app);
 *     });
 *
 * **Different shape from #HDR1-#HDR7 / #HDR13-#HDR14**: REMOVE pattern
 * (`res.removeHeader('x-powered-by')`) rather than SET. gina's framework
 * code emits `X-Powered-By: Gina/<version>` on every response — the
 * canonical wire format. Removing the header reduces the attacker's
 * reconnaissance surface (one byte of useful intel — what server stack
 * to target). helmet ships `hidePoweredBy` for the same reason.
 *
 * **Two engine-specific emit paths — full coverage requires both
 * mechanisms**:
 *
 *  1. **Express engine** (`server.js:2425`) — `response.setHeader(
 *     'X-Powered-By', 'Gina/'+GINA_VERSION)` fires once in the early
 *     request pipeline, before any user `app.use()` mount. This
 *     middleware's `res.removeHeader('x-powered-by')` runs later in
 *     the chain and removes the header cleanly before the response
 *     is written.
 *
 *  2. **Isaac engine** (`server.isaac.js`) — the framework emits
 *     `X-Powered-By: Gina/<version>` via the `_setPoweredByHeader(
 *     headers)` helper at `server.isaac.js:572-577`, which writes
 *     the header into the headers object passed to `writeHead(...)`
 *     at every `/_gina/*` built-in endpoint (~15 sites: health,
 *     metrics, info, cache stats, inspector SSE, agent, indexes,
 *     reveal, etc.), plus one direct `setHeader` site at L1188 for
 *     the routing.json asset endpoint. ALL of these emit sites are
 *     gated on `options.hidePoweredBy` — set
 *     `settings.json > server.hidePoweredBy: true` (default `false`)
 *     to make the helper skip the X-Powered-By write across every
 *     site at once. This middleware is a no-op on Isaac (the header
 *     never lands in the response object at middleware time);
 *     registering it is harmless but does not suppress the header
 *     on Isaac. Use the `server.hidePoweredBy: true` settings gate
 *     for Isaac-engine bundles.
 *
 * **No third path** — the env.json template's `response.header` block
 * intentionally does NOT carry an `X-Powered-By` default (a previous
 * `"Gina I/O - v${version}"` entry was structurally dead — overwritten
 * by L2425's `setHeader` on Express, and Isaac never reads
 * `server.response.header` — dropped 2026-05-17).
 *
 * Takes no options — registering the plugin opts in; not registering
 * opts out. Mirrors helmet's no-opts shape (helmet warns + falls back if
 * options are passed to `hidePoweredBy()`).
 *
 * @module plugins/security-headers/hide-powered-by
 */

var HEADER_NAME = 'x-powered-by';


/**
 * Read the active bundle's `settings.json > hidePoweredBy.*` block
 * and return the merged framework defaults.
 *
 * No tunable options today — removing the header is the only behaviour.
 * The settings block is reserved for future fields (e.g. per-route
 * opt-out); reading + passing through pluginConf preserves the shape
 * of sibling header plugins so a future field addition does not need
 * an API break.
 *
 * Falls back to an empty object when the bundle context is not ready
 * yet (e.g. `HidePoweredBy()` invoked at module-require time, before
 * `onInitialize`).
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
            pluginConf   = settings.hidePoweredBy || {};
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
 * Merge caller-supplied options on top of the resolved defaults.
 * Caller-supplied values always win (`hasOwnProperty`-guarded).
 *
 * No tunable options exist today, but the function preserves the shape
 * used by sibling header plugins so opts can be threaded through future
 * revisions without an API break.
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
 * Return an express-compatible middleware that removes the
 * `X-Powered-By` response header.
 *
 * Calls `res.removeHeader('x-powered-by')` unconditionally; Node's
 * `removeHeader` is a no-op when the header is not set, so the call
 * is safe even when no upstream middleware emitted the header.
 *
 * @example
 * var hidePoweredBy = require('gina').plugins.HidePoweredBy();
 * app.use(hidePoweredBy);
 *
 * @param   {object} [opts] — reserved for future use; ignored today
 * @returns {function} — express middleware `(req, res, next) => void`
 */
function HidePoweredBy(opts) {
    var defaults = resolveSettingsDefaults();
    mergeOptions(opts, defaults);

    return function ginaHidePoweredBy(req, res, next) {
        if (typeof res.removeHeader === 'function') {
            res.removeHeader(HEADER_NAME);
        }
        next();
    };
}


// Exposed for unit testing. Do not rely on these in application code.
HidePoweredBy._HEADER_NAME             = HEADER_NAME;
HidePoweredBy._resolveSettingsDefaults = resolveSettingsDefaults;
HidePoweredBy._mergeOptions            = mergeOptions;

module.exports = HidePoweredBy;
