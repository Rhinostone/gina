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

    it('forwards prefix + defaultMetrics + allowFrom from app.json', function() {
        var startIdx = GNA_SRC.indexOf("server.on('started'");
        var sliceEnd  = GNA_SRC.indexOf("instance.use", startIdx);
        var callbackHead = GNA_SRC.substring(startIdx, sliceEnd);
        assert.match(callbackHead, /prefix:\s*_metricsAppConf\.metrics\.prefix/);
        assert.match(callbackHead, /defaultMetrics:\s*_metricsAppConf\.metrics\.defaultMetrics/);
        assert.match(callbackHead, /allowFrom:\s*_metricsAppConf\.metrics\.allowFrom/);
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


describe('06 - core/server.isaac.js — /_gina/metrics handler (slice 2)', function() {

    var ISAAC_SRC = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');

    function metricsBlock() {
        // Locate the slice-2 marker comment then take a window covering the handler body.
        var markerIdx = ISAAC_SRC.indexOf('#OBS1, slice 2');
        assert.ok(markerIdx > 0, 'OBS1 slice 2 marker comment not found in server.isaac.js');
        // Walk forward to the next /_gina handler ( /_gina/info or /_gina/cache/stats ).
        var endIdx = ISAAC_SRC.indexOf('_gina\\/info$', markerIdx);
        if (endIdx < 0) endIdx = markerIdx + 4000; // generous fallback
        return ISAAC_SRC.substring(markerIdx, endIdx);
    }

    it('matches GET method and /_gina/metrics path', function() {
        var blk = metricsBlock();
        assert.match(blk, /request\.method\.toUpperCase\(\)\s*===\s*['"]GET['"]/);
        assert.match(blk, /\\\/_gina\\\/metrics\$/);
    });

    it('calls lib.metrics.isClientAllowed before isEnabled / getMetrics', function() {
        var blk = metricsBlock();
        var idxAllowed = blk.indexOf('lib.metrics.isClientAllowed');
        var idxEnabled = blk.indexOf('lib.metrics.isEnabled');
        var idxMetrics = blk.indexOf('lib.metrics.getMetrics');
        assert.ok(idxAllowed >= 0, 'isClientAllowed not called');
        assert.ok(idxEnabled >  idxAllowed, 'isEnabled() must be called after isClientAllowed()');
        assert.ok(idxMetrics >  idxEnabled, 'getMetrics() must be called after isEnabled()');
    });

    it('returns 403 on IP-allowlist miss', function() {
        var blk = metricsBlock();
        assert.match(blk, /403/);
        assert.match(blk, /forbidden/);
    });

    it('returns 503 when metrics is not enabled', function() {
        var blk = metricsBlock();
        assert.match(blk, /503/);
        assert.match(blk, /metrics not enabled/);
    });

    it('returns text/plain; version=0.0.4 on success', function() {
        var blk = metricsBlock();
        assert.match(blk, /text\/plain;\s*version=0\.0\.4;\s*charset=utf-8/);
    });

    it('serves both HTTP/2 (response.stream) and HTTP/1.1 paths', function() {
        var blk = metricsBlock();
        // Both branches present.
        assert.ok(blk.indexOf('response.stream.respond') > 0, 'HTTP/2 branch missing');
        assert.ok(blk.indexOf('response.writeHead')      > 0, 'HTTP/1.1 branch missing');
    });

    it('catches getMetrics() errors and surfaces 500', function() {
        var blk = metricsBlock();
        assert.match(blk, /\.catch\s*\(/);
        assert.match(blk, /500/);
        assert.match(blk, /metrics_error/);
    });

});


describe('07 - core/server.js — /_gina/metrics handler (slice 2)', function() {

    var SERVER_SRC = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');

    function metricsBlock() {
        var markerIdx = SERVER_SRC.indexOf('#OBS1 slice 2');
        assert.ok(markerIdx > 0, 'OBS1 slice 2 marker comment not found in server.js');
        // Window through the next /_gina/inspector handler.
        var endIdx = SERVER_SRC.indexOf('Inspector SPA', markerIdx);
        if (endIdx < 0) endIdx = markerIdx + 4000;
        return SERVER_SRC.substring(markerIdx, endIdx);
    }

    it('matches GET method and /_gina/metrics path', function() {
        var blk = metricsBlock();
        assert.match(blk, /request\.method\.toUpperCase\(\)\s*===\s*['"]GET['"]/);
        assert.match(blk, /\\\/_gina\\\/metrics\$/);
    });

    it('is NOT gated on NODE_ENV_IS_DEV (always-on)', function() {
        var blk = metricsBlock();
        assert.equal(/NODE_ENV_IS_DEV/.test(blk), false);
    });

    it('calls lib.metrics.isClientAllowed / isEnabled / getMetrics in order', function() {
        var blk = metricsBlock();
        var idxAllowed = blk.indexOf('lib.metrics.isClientAllowed');
        var idxEnabled = blk.indexOf('lib.metrics.isEnabled');
        var idxMetrics = blk.indexOf('lib.metrics.getMetrics');
        assert.ok(idxAllowed >= 0);
        assert.ok(idxEnabled >  idxAllowed);
        assert.ok(idxMetrics >  idxEnabled);
    });

    it('returns 403 on IP-allowlist miss', function() {
        var blk = metricsBlock();
        assert.match(blk, /statusCode\s*=\s*403/);
        assert.match(blk, /forbidden/);
    });

    it('returns 503 when metrics is not enabled', function() {
        var blk = metricsBlock();
        assert.match(blk, /statusCode\s*=\s*503/);
        assert.match(blk, /metrics not enabled/);
    });

    it('returns text/plain; version=0.0.4 on success', function() {
        var blk = metricsBlock();
        assert.match(blk, /text\/plain;\s*version=0\.0\.4;\s*charset=utf-8/);
    });

    it('catches getMetrics() errors and surfaces 500', function() {
        var blk = metricsBlock();
        assert.match(blk, /\.catch\s*\(/);
        assert.match(blk, /statusCode\s*=\s*500/);
        assert.match(blk, /metrics_error/);
    });

});


describe('08 - schema/app.json — metrics block', function() {

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
