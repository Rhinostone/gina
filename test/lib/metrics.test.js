/**
 * lib/metrics — Prometheus metrics primitive (#OBS1, slice 1)
 *
 * Tests cover the runtime primitives in isolation:
 *   - Module shape + helper exports
 *   - start() — mock client injection, idempotency, prefix, defaultMetrics flag
 *   - recordRequest() — counter increment, label fallbacks, ms→s conversion
 *   - getMetrics() — async wrapper over registry.metrics()
 *   - isEnabled / getRegistry / reset
 *
 * Source-inspection guards on the framework wiring (gna.js, lib/index.js,
 * schema/app.json) live in the sibling `metrics-wiring.test.js` so this
 * file stays runnable against the primitive in isolation.
 */

'use strict';

var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');

var FW      = require('../fw');
var metrics = require(path.join(FW, 'lib/metrics/src/main'));


// ─── Mock prom-client factory ──────────────────────────────────────────────

function makeMockProm() {
    var lastRegistry = null;
    var lastDefaultMetricsCall = null;
    var lastCounterArgs = null;
    var lastHistogramArgs = null;

    function MockRegistry() {
        var calls = { inc: [], observe: [] };
        this._calls = calls;
        this.metrics = function() {
            return Promise.resolve('# HELP gina_http_requests_total Total HTTP requests\n');
        };
        lastRegistry = this;
    }

    function collectDefaultMetrics(opts) {
        lastDefaultMetricsCall = opts;
    }

    function MockCounter(opts) {
        lastCounterArgs = opts;
        var registries = opts.registers || [];
        this.inc = function(labels) {
            registries.forEach(function(r) { r._calls.inc.push(labels); });
        };
    }

    function MockHistogram(opts) {
        lastHistogramArgs = opts;
        var registries = opts.registers || [];
        this.observe = function(labels, value) {
            registries.forEach(function(r) { r._calls.observe.push({ labels: labels, value: value }); });
        };
    }

    return {
        Registry             : MockRegistry,
        collectDefaultMetrics: collectDefaultMetrics,
        Counter              : MockCounter,
        Histogram            : MockHistogram,
        // Test introspection
        _last: function() {
            return {
                registry            : lastRegistry,
                defaultMetricsCall  : lastDefaultMetricsCall,
                counterArgs         : lastCounterArgs,
                histogramArgs       : lastHistogramArgs
            };
        }
    };
}


// Reset module state between tests (singleton state).
beforeEach(function() {
    metrics.reset();
});


// ─── 01 — Module shape ─────────────────────────────────────────────────────

describe('01 - lib/metrics module exports (#OBS1)', function() {

    it('exports the lifecycle API', function() {
        assert.equal(typeof metrics.start,         'function');
        assert.equal(typeof metrics.recordRequest, 'function');
        assert.equal(typeof metrics.getMetrics,    'function');
        assert.equal(typeof metrics.isEnabled,     'function');
        assert.equal(typeof metrics.getRegistry,   'function');
        assert.equal(typeof metrics.reset,         'function');
    });

    it('exports DEFAULT_BUCKETS as an ascending number array', function() {
        assert.ok(Array.isArray(metrics.DEFAULT_BUCKETS));
        assert.ok(metrics.DEFAULT_BUCKETS.length > 0);
        for (var i = 1; i < metrics.DEFAULT_BUCKETS.length; i++) {
            assert.ok(metrics.DEFAULT_BUCKETS[i] > metrics.DEFAULT_BUCKETS[i - 1]);
        }
    });

    it('default buckets cover sub-10s range', function() {
        var b = metrics.DEFAULT_BUCKETS;
        assert.ok(b[0] < 0.01,           'fastest bucket < 10ms');
        assert.ok(b[b.length - 1] >= 5,  'slowest bucket >= 5s');
    });

});


// ─── 02 — start() lifecycle ────────────────────────────────────────────────

describe('02 - start()', function() {

    it('flips isEnabled() from false to true on success', function() {
        assert.equal(metrics.isEnabled(), false);
        metrics.start({ client: makeMockProm() });
        assert.equal(metrics.isEnabled(), true);
    });

    it('returns true on success', function() {
        var ret = metrics.start({ client: makeMockProm() });
        assert.equal(ret, true);
    });

    it('is idempotent — second call returns true and does NOT re-create state', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        var firstRegistry = metrics.getRegistry();
        var ret = metrics.start({ client: prom });
        assert.equal(ret, true);
        assert.equal(metrics.getRegistry(), firstRegistry, 'registry instance preserved');
    });

    it('uses gina_ prefix by default', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        assert.match(prom._last().counterArgs.name,    /^gina_http_requests_total$/);
        assert.match(prom._last().histogramArgs.name,  /^gina_http_request_duration_seconds$/);
    });

    it('honours custom prefix', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom, prefix: 'myapp_' });
        assert.match(prom._last().counterArgs.name,    /^myapp_http_requests_total$/);
        assert.match(prom._last().histogramArgs.name,  /^myapp_http_request_duration_seconds$/);
    });

    it('falls back to gina_ prefix when prefix is empty string or non-string', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom, prefix: '' });
        assert.match(prom._last().counterArgs.name, /^gina_http_requests_total$/);
        metrics.reset();
        var prom2 = makeMockProm();
        metrics.start({ client: prom2, prefix: null });
        assert.match(prom2._last().counterArgs.name, /^gina_http_requests_total$/);
    });

    it('seeds default metrics when defaultMetrics is omitted (true is the default)', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        assert.notEqual(prom._last().defaultMetricsCall, null);
    });

    it('skips default metrics when defaultMetrics is false', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom, defaultMetrics: false });
        assert.equal(prom._last().defaultMetricsCall, null);
    });

    it('passes the registry + prefix into collectDefaultMetrics', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom, prefix: 'gina_', defaultMetrics: true });
        var call = prom._last().defaultMetricsCall;
        assert.equal(call.register, prom._last().registry);
        assert.equal(call.prefix,   'gina_');
    });

    it('uses DEFAULT_BUCKETS for the histogram by default', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        assert.deepEqual(prom._last().histogramArgs.buckets, metrics.DEFAULT_BUCKETS);
    });

    it('honours durationBuckets override when given an array', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom, durationBuckets: [0.1, 1, 10] });
        assert.deepEqual(prom._last().histogramArgs.buckets, [0.1, 1, 10]);
    });

    it('falls back to DEFAULT_BUCKETS when durationBuckets is not an array', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom, durationBuckets: 'oops' });
        assert.deepEqual(prom._last().histogramArgs.buckets, metrics.DEFAULT_BUCKETS);
    });

    it('declares method/route/status as label names', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        assert.deepEqual(prom._last().counterArgs.labelNames,   ['method', 'route', 'status']);
        assert.deepEqual(prom._last().histogramArgs.labelNames, ['method', 'route', 'status']);
    });

    it('tolerates collectDefaultMetrics throwing (mock parity scenario)', function() {
        var prom = makeMockProm();
        prom.collectDefaultMetrics = function() { throw new Error('mock rejected'); };
        // Should not throw — start() swallows.
        metrics.start({ client: prom });
        assert.equal(metrics.isEnabled(), true);
    });

});


// ─── 03 — recordRequest() ──────────────────────────────────────────────────

describe('03 - recordRequest()', function() {

    it('is a no-op when start() has not been called', function() {
        // Should not throw.
        metrics.recordRequest({ method: 'GET', route: 'home', status: 200 });
    });

    it('is a no-op when called with non-object input', function() {
        metrics.start({ client: makeMockProm() });
        metrics.recordRequest(null);
        metrics.recordRequest(undefined);
        metrics.recordRequest('oops');
        var calls = metrics.getRegistry()._calls;
        assert.equal(calls.inc.length, 0);
    });

    it('increments the counter once per call', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'GET', route: 'home', status: 200 });
        metrics.recordRequest({ method: 'GET', route: 'home', status: 200 });
        assert.equal(prom._last().registry._calls.inc.length, 2);
    });

    it('passes method/route/status as label values', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'POST', route: 'createInvoice', status: 201 });
        var labels = prom._last().registry._calls.inc[0];
        assert.equal(labels.method, 'POST');
        assert.equal(labels.route,  'createInvoice');
        assert.equal(labels.status, '201');
    });

    it('uppercases the method', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'get', route: 'home', status: 200 });
        assert.equal(prom._last().registry._calls.inc[0].method, 'GET');
    });

    it('falls back to "UNKNOWN" when method is missing', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ route: 'home', status: 200 });
        assert.equal(prom._last().registry._calls.inc[0].method, 'UNKNOWN');
    });

    it('falls back to "__no_route__" when route is missing or empty', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'GET', status: 200 });
        metrics.recordRequest({ method: 'GET', route: '', status: 200 });
        var calls = prom._last().registry._calls.inc;
        assert.equal(calls[0].route, '__no_route__');
        assert.equal(calls[1].route, '__no_route__');
    });

    it('coerces status to string', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'GET', route: 'home', status: 404 });
        assert.equal(prom._last().registry._calls.inc[0].status, '404');
    });

    it('observes duration converted from ms to seconds', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'GET', route: 'home', status: 200, duration: 1500 });
        var obs = prom._last().registry._calls.observe[0];
        assert.equal(obs.value, 1.5);
    });

    it('skips the histogram when duration is omitted', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'GET', route: 'home', status: 200 });
        assert.equal(prom._last().registry._calls.observe.length, 0);
    });

    it('skips the histogram when duration is negative', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'GET', route: 'home', status: 200, duration: -1 });
        assert.equal(prom._last().registry._calls.observe.length, 0);
    });

    it('observes duration of 0 as 0 seconds', function() {
        var prom = makeMockProm();
        metrics.start({ client: prom });
        metrics.recordRequest({ method: 'GET', route: 'home', status: 200, duration: 0 });
        assert.equal(prom._last().registry._calls.observe.length, 1);
        assert.equal(prom._last().registry._calls.observe[0].value, 0);
    });

});


// ─── 04 — getMetrics() ─────────────────────────────────────────────────────

describe('04 - getMetrics()', function() {

    it('returns empty string before start()', async function() {
        var out = await metrics.getMetrics();
        assert.equal(out, '');
    });

    it('returns Prometheus text after start()', async function() {
        metrics.start({ client: makeMockProm() });
        var out = await metrics.getMetrics();
        assert.match(out, /^# HELP/);
    });

    it('always returns a Promise', function() {
        var p = metrics.getMetrics();
        assert.equal(typeof p.then, 'function');
    });

    it('wraps a sync registry.metrics() return in a Promise (legacy prom-client)', async function() {
        // Inline minimal mock — registry.metrics() returns sync string.
        metrics.start({
            client: {
                Registry             : function() { this.metrics = function() { return '# sync output'; }; },
                Counter              : function() { this.inc = function() {}; },
                Histogram            : function() { this.observe = function() {}; },
                collectDefaultMetrics: function() {}
            }
        });
        var out = await metrics.getMetrics();
        assert.equal(out, '# sync output');
    });

});


// ─── 05 — isEnabled() + getRegistry() ──────────────────────────────────────

describe('05 - isEnabled() + getRegistry()', function() {

    it('isEnabled() reflects start() state', function() {
        assert.equal(metrics.isEnabled(), false);
        metrics.start({ client: makeMockProm() });
        assert.equal(metrics.isEnabled(), true);
    });

    it('getRegistry() returns null before start()', function() {
        assert.equal(metrics.getRegistry(), null);
    });

    it('getRegistry() returns the Registry instance after start()', function() {
        metrics.start({ client: makeMockProm() });
        var r = metrics.getRegistry();
        assert.notEqual(r, null);
        assert.equal(typeof r.metrics, 'function');
    });

});


// ─── 06 — reset() ──────────────────────────────────────────────────────────

describe('06 - reset()', function() {

    it('flips isEnabled() back to false', function() {
        metrics.start({ client: makeMockProm() });
        assert.equal(metrics.isEnabled(), true);
        metrics.reset();
        assert.equal(metrics.isEnabled(), false);
    });

    it('clears the registry', function() {
        metrics.start({ client: makeMockProm() });
        metrics.reset();
        assert.equal(metrics.getRegistry(), null);
    });

    it('allows a fresh start() with a new client after reset', function() {
        var p1 = makeMockProm();
        metrics.start({ client: p1 });
        var r1 = metrics.getRegistry();
        metrics.reset();
        var p2 = makeMockProm();
        metrics.start({ client: p2 });
        var r2 = metrics.getRegistry();
        assert.notEqual(r1, r2);
    });

});
