/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module gina/lib/metrics
 *
 * Prometheus metrics primitive. Wraps `prom-client` (peer dep — must be
 * installed by the project at `node_modules/prom-client`). Backs the
 * built-in `/_gina/metrics` endpoint and the request-lifecycle hook that
 * populates the HTTP counter + histogram.
 *
 * Opt-in via `app.json`:
 *
 *     {
 *       "metrics": {
 *         "enabled":   true,
 *         "path":      "/_gina/metrics",
 *         "allowFrom": ["127.0.0.1", "::1"],
 *         "prefix":    "gina_"
 *       }
 *     }
 *
 * The framework reads this block in `core/gna.js`'s `server.on('started')`
 * callback and calls `metrics.start({ prefix, defaultMetrics })` once per
 * bundle. Subsequent calls are no-ops (idempotent).
 *
 * @package    gina.framework
 * @namespace  lib.metrics
 * @author     Rhinostone <contact@gina.io>
 */

'use strict';

/**
 * Cached `prom-client` module reference. Populated on first successful
 * {@link start} call.
 *
 * @inner
 * @type {*}
 */
var promClient = null;

/**
 * Cached `Registry` instance. Single registry per bundle (per process).
 *
 * @inner
 * @type {*}
 */
var registry = null;

/**
 * Cached counter / histogram instances keyed by short name
 * (`requests`, `duration`).
 *
 * @inner
 * @type {Object<string, *>}
 */
var counters = Object.create(null);

/**
 * `true` once {@link start} has succeeded. {@link recordRequest} is a
 * no-op while this is `false`.
 *
 * @inner
 * @type {boolean}
 */
var enabled = false;

/**
 * Captured peer-dep load error. Once set, future {@link start} calls
 * surface this verbatim with the actionable `npm install prom-client`
 * hint rather than re-attempting the require.
 *
 * @inner
 * @type {Error|null}
 */
var startError = null;

/**
 * Default histogram buckets in seconds — covers 5ms to 10s with finer
 * granularity at the lower end where most HTTP latencies sit.
 *
 * @memberof module:gina/lib/metrics
 * @constant
 * @type {number[]}
 */
var DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Initialise the metrics registry and wire HTTP counters. Idempotent —
 * a second call without an intervening {@link reset} returns `true`
 * without re-creating state.
 *
 * Loads `prom-client` from the project's `node_modules` directory using
 * the same peer-dep convention as the mysql / postgres / AI SDK
 * connectors (`getPath('project') + '/node_modules/prom-client'`).
 * Throws when the package is not installed; the error message includes
 * an actionable `npm install` recipe.
 *
 * @memberof module:gina/lib/metrics
 * @param   {Object}   [opts]
 * @param   {string}   [opts.prefix='gina_']        - Metric-name prefix; appears on every counter / histogram.
 * @param   {boolean}  [opts.defaultMetrics=true]   - When `true`, calls `prom.collectDefaultMetrics()` to seed Node.js process metrics (heap, GC pause, event loop lag, active handles).
 * @param   {number[]} [opts.durationBuckets]       - Override histogram buckets (seconds). Defaults to {@link DEFAULT_BUCKETS}.
 * @param   {*}        [opts.client]                - Test-only: inject a mock `prom-client`. Production callers omit this.
 * @returns {boolean}                               - `true` on success.
 * @throws  {Error}                                 - When `prom-client` cannot be loaded.
 *
 * @example
 *   // Production (called by gna.js when app.json `metrics.enabled` is true):
 *   lib.metrics.start({ prefix: 'gina_', defaultMetrics: true });
 *
 * @example
 *   // Test (mock prom-client):
 *   lib.metrics.start({ client: fakeProm, defaultMetrics: false });
 */
function start(opts) {
    opts = opts || {};
    if (enabled) {
        return true;
    }
    if (startError) {
        throw startError;
    }

    var prefix = (typeof opts.prefix === 'string' && opts.prefix.length > 0) ? opts.prefix : 'gina_';

    if (opts.client) {
        promClient = opts.client;
    } else {
        try {
            var promPath = _(getPath('project') + '/node_modules/prom-client', true);
            promClient = require(promPath);
        } catch (e) {
            startError = new Error(
                '[lib.metrics] prom-client is not installed in your project.\n'
                + 'Run: npm install prom-client\n'
                + e.message
            );
            throw startError;
        }
    }

    registry = new promClient.Registry();

    if (opts.defaultMetrics !== false && typeof promClient.collectDefaultMetrics === 'function') {
        try {
            promClient.collectDefaultMetrics({
                register: registry,
                prefix:   prefix
            });
        } catch (collectErr) {
            // Mock implementations may reject the options shape; tolerate
            // quietly so test injection stays simple.
        }
    }

    counters.requests = new promClient.Counter({
        name:       prefix + 'http_requests_total',
        help:       'Total HTTP requests',
        labelNames: ['method', 'route', 'status'],
        registers:  [registry]
    });

    counters.duration = new promClient.Histogram({
        name:       prefix + 'http_request_duration_seconds',
        help:       'HTTP request duration in seconds',
        labelNames: ['method', 'route', 'status'],
        buckets:    Array.isArray(opts.durationBuckets) ? opts.durationBuckets : DEFAULT_BUCKETS,
        registers:  [registry]
    });

    enabled = true;
    return true;
}

/**
 * Record one HTTP request into the counter + histogram. No-op when
 * {@link start} has not been called.
 *
 * The `route` label MUST come from the routing.json rule key
 * (`req.routing.rule`), NOT the raw URL — otherwise Prometheus cardinality
 * blows up on every distinct path-parameter value.
 *
 * @memberof module:gina/lib/metrics
 * @param   {Object}        obs
 * @param   {string}        obs.method     - Uppercased HTTP method (`'GET'`, `'POST'`, …).
 * @param   {string}        obs.route      - routing.json rule key (cardinality-safe). Use `'__not_found__'` / `'__method_not_allowed__'` / `'__error__'` / `'__no_route__'` for unmatched paths.
 * @param   {number|string} obs.status     - HTTP status code.
 * @param   {number}        [obs.duration] - Request duration in milliseconds (NOT seconds — converted internally for the histogram).
 * @returns {void}
 *
 * @example
 *   lib.metrics.recordRequest({
 *     method:   'GET',
 *     route:    'home',
 *     status:   200,
 *     duration: 42  // ms
 *   });
 */
function recordRequest(obs) {
    if (!enabled) return;
    if (!obs || typeof obs !== 'object') return;
    var labels = {
        method: typeof obs.method === 'string' ? obs.method.toUpperCase() : 'UNKNOWN',
        route:  (typeof obs.route === 'string' && obs.route.length > 0) ? obs.route : '__no_route__',
        status: String(obs.status || 0)
    };
    counters.requests.inc(labels);
    if (typeof obs.duration === 'number' && obs.duration >= 0) {
        counters.duration.observe(labels, obs.duration / 1000);
    }
}

/**
 * Render current metrics in Prometheus exposition format.
 * `prom-client@15` made `registry.metrics()` async, so the wrapper always
 * returns a Promise even when the underlying call is synchronous.
 *
 * @memberof module:gina/lib/metrics
 * @returns {Promise<string>} Prometheus text. Empty string when metrics are disabled.
 *
 * @example
 *   var body = await lib.metrics.getMetrics();
 *   response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
 *   response.end(body);
 */
function getMetrics() {
    if (!enabled || !registry) {
        return Promise.resolve('');
    }
    var out = registry.metrics();
    if (out && typeof out.then === 'function') {
        return out;
    }
    return Promise.resolve(String(out || ''));
}

/**
 * Whether {@link start} has been called successfully.
 *
 * @memberof module:gina/lib/metrics
 * @returns {boolean}
 */
function isEnabled() {
    return enabled;
}

/**
 * Direct access to the underlying `prom-client` Registry. Returns `null`
 * before {@link start}. Reserved for advanced users who want to register
 * custom metrics on the same registry the framework owns.
 *
 * @memberof module:gina/lib/metrics
 * @returns {*|null}
 */
function getRegistry() {
    return registry;
}

/**
 * Test-only helper that clears every module-level slot. Production code
 * should not call this — counter references held by callers become stale
 * after a reset.
 *
 * @memberof module:gina/lib/metrics
 * @returns {void}
 */
function reset() {
    promClient = null;
    registry   = null;
    counters   = Object.create(null);
    enabled    = false;
    startError = null;
}

module.exports = {
    start          : start,
    recordRequest  : recordRequest,
    getMetrics     : getMetrics,
    isEnabled      : isEnabled,
    getRegistry    : getRegistry,
    reset          : reset,
    DEFAULT_BUCKETS: DEFAULT_BUCKETS
};
