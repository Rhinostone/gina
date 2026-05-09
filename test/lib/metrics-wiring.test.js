/**
 * lib/metrics — Framework wiring guards (#OBS1, slice 1)
 *
 * Source-inspection tests that pin the per-file integration of `lib/metrics`
 * into the framework:
 *
 *   - `lib/index.js` registers `metrics` via `_require`.
 *   - `core/gna.js` calls `lib.metrics.start(...)` inside the
 *     `server.on('started')` callback, gated on
 *     `app.json metrics.enabled === true`, wrapped in try/catch.
 *   - `lib/metrics/src/main.js` follows the project-resolved peer-dep load
 *     pattern (mysql/postgres/AI SDK precedent) and surfaces the
 *     "npm install prom-client" hint on missing dep.
 *   - `lib/metrics/src/main.js` uses cardinality-safe label fallbacks.
 *   - `schema/app.json` carries the `metrics` block with the documented
 *     properties (enabled / path / allowFrom / prefix / defaultMetrics).
 *
 * Pure source-grep — does not exercise the runtime. Behavioural coverage
 * lives in the sibling `metrics.test.js`.
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var GNA_SRC      = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
var LIB_INDEX    = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var METRICS_SRC  = fs.readFileSync(path.join(FW, 'lib/metrics/src/main.js'), 'utf8');
var SCHEMA_PATH  = path.resolve(FW, '..', '..', 'schema/app.json');
var SCHEMA_RAW   = fs.readFileSync(SCHEMA_PATH, 'utf8');
var SCHEMA       = JSON.parse(SCHEMA_RAW);


describe('01 - lib/index.js registration', function() {

    it('registers metrics via _require', function() {
        assert.match(LIB_INDEX, /metrics\s*:\s*_require\(['"]\.\/metrics['"]\)/);
    });

    it('comments the registration with the #OBS1 marker', function() {
        assert.match(LIB_INDEX, /#OBS1/);
    });

});


describe('02 - core/gna.js — bundle-init wiring', function() {

    it('calls lib.metrics.start inside server.on("started")', function() {
        // Locate the server.on('started') callback body and confirm
        // lib.metrics.start appears between that opening and the next
        // major sibling (the middleware-setup `instance.use` block).
        var startIdx = GNA_SRC.indexOf("server.on('started'");
        assert.ok(startIdx > 0, 'server.on("started") registration not found');
        var sliceEnd  = GNA_SRC.indexOf("instance.use", startIdx);
        assert.ok(sliceEnd > startIdx, 'middleware setup boundary not found after started callback');
        var callbackHead = GNA_SRC.substring(startIdx, sliceEnd);
        assert.match(callbackHead, /lib\.metrics\.start\s*\(/);
    });

    it('reads app.json via gna.getConfig("app")', function() {
        var startIdx = GNA_SRC.indexOf("server.on('started'");
        var sliceEnd  = GNA_SRC.indexOf("instance.use", startIdx);
        var callbackHead = GNA_SRC.substring(startIdx, sliceEnd);
        assert.match(callbackHead, /gna\.getConfig\s*\(\s*['"]app['"]\s*\)/);
    });

    it('gates lib.metrics.start on metrics.enabled === true', function() {
        var startIdx = GNA_SRC.indexOf("server.on('started'");
        var sliceEnd  = GNA_SRC.indexOf("instance.use", startIdx);
        var callbackHead = GNA_SRC.substring(startIdx, sliceEnd);
        assert.match(callbackHead, /metrics\.enabled\s*===\s*true/);
    });

    it('forwards prefix + defaultMetrics from app.json', function() {
        var startIdx = GNA_SRC.indexOf("server.on('started'");
        var sliceEnd  = GNA_SRC.indexOf("instance.use", startIdx);
        var callbackHead = GNA_SRC.substring(startIdx, sliceEnd);
        assert.match(callbackHead, /prefix:\s*_metricsAppConf\.metrics\.prefix/);
        assert.match(callbackHead, /defaultMetrics:\s*_metricsAppConf\.metrics\.defaultMetrics/);
    });

    it('wraps the init in try/catch with a console.warn on failure', function() {
        var startIdx = GNA_SRC.indexOf("server.on('started'");
        var sliceEnd  = GNA_SRC.indexOf("instance.use", startIdx);
        var callbackHead = GNA_SRC.substring(startIdx, sliceEnd);
        assert.match(callbackHead, /catch\s*\(\s*metricsErr\s*\)/);
        assert.match(callbackHead, /console\.warn\(['"]\[lib\.metrics\]/);
    });

});


describe('03 - lib/metrics/src/main.js — peer-dep load pattern', function() {

    it('resolves prom-client via getPath("project") + node_modules', function() {
        assert.match(METRICS_SRC, /getPath\(\s*['"]project['"]\s*\)/);
        assert.match(METRICS_SRC, /node_modules\/prom-client/);
    });

    it('surfaces "npm install prom-client" on missing dep', function() {
        assert.match(METRICS_SRC, /npm install prom-client/);
    });

    it('honours opts.client injection for tests (production callers omit it)', function() {
        assert.match(METRICS_SRC, /opts\.client/);
    });

});


describe('04 - lib/metrics/src/main.js — cardinality-safe labels', function() {

    it('falls back to __no_route__ for missing route', function() {
        assert.match(METRICS_SRC, /__no_route__/);
    });

    it('declares method/route/status as the only label names', function() {
        // Both counter and histogram should declare exactly these.
        var counterLabels = METRICS_SRC.match(/labelNames:\s*\[([^\]]+)\]/g);
        assert.ok(counterLabels && counterLabels.length >= 2, 'counter + histogram labelNames not both found');
        counterLabels.forEach(function(decl) {
            assert.match(decl, /['"]method['"]/);
            assert.match(decl, /['"]route['"]/);
            assert.match(decl, /['"]status['"]/);
        });
    });

    it('does not reference req.url or raw-URL labels', function() {
        // Cardinality safety: the source must not advertise a URL-based label.
        assert.equal(/labelNames:\s*\[[^\]]*['"]url['"]/.test(METRICS_SRC), false);
    });

});


describe('05 - lib/metrics/src/main.js — module shape + boot semantics', function() {

    it('declares @module gina/lib/metrics in the JSDoc', function() {
        assert.match(METRICS_SRC, /@module gina\/lib\/metrics/);
    });

    it('exports start / recordRequest / getMetrics / isEnabled / getRegistry / reset / DEFAULT_BUCKETS', function() {
        assert.match(METRICS_SRC, /start\s*:\s*start/);
        assert.match(METRICS_SRC, /recordRequest\s*:\s*recordRequest/);
        assert.match(METRICS_SRC, /getMetrics\s*:\s*getMetrics/);
        assert.match(METRICS_SRC, /isEnabled\s*:\s*isEnabled/);
        assert.match(METRICS_SRC, /getRegistry\s*:\s*getRegistry/);
        assert.match(METRICS_SRC, /reset\s*:\s*reset/);
        assert.match(METRICS_SRC, /DEFAULT_BUCKETS\s*:\s*DEFAULT_BUCKETS/);
    });

    it('start() converts duration ms to seconds for the histogram', function() {
        assert.match(METRICS_SRC, /obs\.duration\s*\/\s*1000/);
    });

    it('start() returns true on idempotent re-entry', function() {
        // The early-out branch returns true.
        assert.match(METRICS_SRC, /if\s*\(enabled\)\s*\{\s*\n\s*return true;/);
    });

});


describe('06 - schema/app.json — metrics block', function() {

    it('declares metrics as an object property', function() {
        assert.equal(typeof SCHEMA.properties.metrics, 'object');
        assert.equal(SCHEMA.properties.metrics.type,    'object');
    });

    it('declares enabled / path / allowFrom / prefix / defaultMetrics', function() {
        var props = SCHEMA.properties.metrics.properties;
        assert.equal(typeof props.enabled,        'object');
        assert.equal(typeof props.path,           'object');
        assert.equal(typeof props.allowFrom,      'object');
        assert.equal(typeof props.prefix,         'object');
        assert.equal(typeof props.defaultMetrics, 'object');
    });

    it('enabled is a boolean defaulting to false', function() {
        var enabled = SCHEMA.properties.metrics.properties.enabled;
        assert.equal(enabled.type,    'boolean');
        assert.equal(enabled.default, false);
    });

    it('path defaults to /_gina/metrics', function() {
        var p = SCHEMA.properties.metrics.properties.path;
        assert.equal(p.type,    'string');
        assert.equal(p.default, '/_gina/metrics');
    });

    it('allowFrom is an array of strings defaulting to localhost', function() {
        var a = SCHEMA.properties.metrics.properties.allowFrom;
        assert.equal(a.type,           'array');
        assert.equal(a.items.type,     'string');
        assert.deepEqual(a.default,    ['127.0.0.1', '::1']);
    });

    it('prefix defaults to gina_', function() {
        var p = SCHEMA.properties.metrics.properties.prefix;
        assert.equal(p.type,    'string');
        assert.equal(p.default, 'gina_');
    });

    it('defaultMetrics defaults to true', function() {
        var d = SCHEMA.properties.metrics.properties.defaultMetrics;
        assert.equal(d.type,    'boolean');
        assert.equal(d.default, true);
    });

    it('rejects unknown properties under metrics (additionalProperties: false)', function() {
        assert.equal(SCHEMA.properties.metrics.additionalProperties, false);
    });

});
