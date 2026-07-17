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


describe('08 - core/server.isaac.js — request lifecycle hook (slice 3)', function() {

    var ISAAC_SRC = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');

    function hookBlock() {
        var markerIdx = ISAAC_SRC.indexOf('#OBS1 slice 3');
        assert.ok(markerIdx > 0, 'OBS1 slice 3 marker comment not found in server.isaac.js');
        // End-anchor at the next hook's marker (#RWATCH) — robust to the #OBS1 first-seer
        // comment length, unlike a fixed char window (jsdoc.md fixed-window-slicer trap).
        var endIdx = ISAAC_SRC.indexOf('#RWATCH', markerIdx);
        assert.ok(endIdx > markerIdx, 'expected the #RWATCH gauge block to follow the #OBS1 hook');
        return ISAAC_SRC.substring(markerIdx, endIdx);
    }

    it('gates the listener registration on lib.metrics.isEnabled() with the #OBS1 first-seer guard', function() {
        var blk = hookBlock();
        assert.match(blk, /if\s*\(\s*lib\.metrics\.isEnabled\(\)\s*&&\s*!request\._metricsRecorded\s*\)/);
    });

    it('claims the first-seer flag (request._metricsRecorded = true) before wiring the finish listener', function() {
        var blk = hookBlock();
        var claimIdx = blk.indexOf('request._metricsRecorded = true');
        var wireIdx  = blk.indexOf("response.on('finish'");
        assert.ok(claimIdx > -1, 'the hook must set request._metricsRecorded = true (first-seer claim)');
        assert.ok(wireIdx  > -1, 'the hook must register response.on(finish)');
        assert.ok(claimIdx < wireIdx, 'the claim flag must be set BEFORE the finish listener is wired (so onInstance skips)');
    });

    it('captures request._metricsStartTime at request entry', function() {
        var blk = hookBlock();
        assert.match(blk, /request\._metricsStartTime\s*=\s*Date\.now\(\)/);
    });

    it("registers response.on('finish') as the recording trigger", function() {
        var blk = hookBlock();
        assert.match(blk, /response\.on\(\s*['"]finish['"]/);
    });

    it('reads the route label from request.routing.rule (cardinality-safe)', function() {
        var blk = hookBlock();
        assert.match(blk, /request\.routing\s*&&\s*request\.routing\.rule/);
    });

    it('forwards method/route/status/duration to lib.metrics.recordRequest', function() {
        var blk = hookBlock();
        assert.match(blk, /lib\.metrics\.recordRequest\s*\(/);
        assert.match(blk, /method:\s*request\.method/);
        assert.match(blk, /status:\s*response\.statusCode/);
        assert.match(blk, /duration:\s*Date\.now\(\)\s*-\s*request\._metricsStartTime/);
    });

    it('swallows recorder errors in a try/catch (metrics never crashes a request)', function() {
        var blk = hookBlock();
        assert.match(blk, /try\s*\{[\s\S]*?\}\s*catch/);
    });

});


describe('09 - core/server.js — request lifecycle hook (slice 3)', function() {

    var SERVER_SRC = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');

    function hookBlock() {
        var markerIdx = SERVER_SRC.indexOf('#OBS1 slice 3');
        assert.ok(markerIdx > 0, 'OBS1 slice 3 marker not found in server.js');
        // End-anchor at the next hook's marker (#RWATCH) — robust to comment length.
        var endIdx = SERVER_SRC.indexOf('#RWATCH', markerIdx);
        assert.ok(endIdx > markerIdx, 'expected the #RWATCH gauge block to follow the #OBS1 hook');
        return SERVER_SRC.substring(markerIdx, endIdx);
    }

    it('gates on lib.metrics.isEnabled() with the #OBS1 first-seer guard', function() {
        var blk = hookBlock();
        assert.match(blk, /if\s*\(\s*lib\.metrics\.isEnabled\(\)\s*&&\s*!request\._metricsRecorded\s*\)/);
    });

    it('claims the first-seer flag (request._metricsRecorded = true) before wiring the finish listener', function() {
        var blk = hookBlock();
        var claimIdx = blk.indexOf('request._metricsRecorded = true');
        var wireIdx  = blk.indexOf("response.on('finish'");
        assert.ok(claimIdx > -1, 'the hook must set request._metricsRecorded = true (first-seer claim)');
        assert.ok(wireIdx  > -1, 'the hook must register response.on(finish)');
        assert.ok(claimIdx < wireIdx, 'the claim flag must be set BEFORE the finish listener is wired (so onInstance skips)');
    });

    it('captures request._metricsStartTime', function() {
        var blk = hookBlock();
        assert.match(blk, /request\._metricsStartTime\s*=\s*Date\.now\(\)/);
    });

    it("registers response.on('finish')", function() {
        var blk = hookBlock();
        assert.match(blk, /response\.on\(\s*['"]finish['"]/);
    });

    it('reads route from request.routing.rule', function() {
        var blk = hookBlock();
        assert.match(blk, /request\.routing\s*&&\s*request\.routing\.rule/);
    });

    it('calls lib.metrics.recordRequest with the four labels', function() {
        var blk = hookBlock();
        assert.match(blk, /lib\.metrics\.recordRequest\s*\(/);
        assert.match(blk, /method:\s*request\.method/);
        assert.match(blk, /status:\s*response\.statusCode/);
    });

    it('try/catch around the recorder', function() {
        var blk = hookBlock();
        assert.match(blk, /try\s*\{[\s\S]*?\}\s*catch/);
    });

});


describe('10 - schema/app.json — metrics block', function() {

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


describe('11 - #OBS1 / #FI first-seer guards — isaac double-dispatch (both tops)', function() {

    var ISAAC_SRC  = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');
    var SERVER_SRC = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');

    // Root cause: under the isaac engine a ROUTED request runs BOTH the engine's
    // server.on('request') listener AND server.js's onInstance (its cb), so a per-request
    // hook wired at the top of both tops fires twice. The #OBS1 metrics finish-hook was
    // unguarded → recordRequest double-fired (counters double-incremented, histogram
    // double-observed). The fix is a request._metricsRecorded first-seer claim (the isaac
    // listener claims first, onInstance skips) — the exact shape of the RW-F8
    // request._rwTracked gauge fix. Live-confirmed 2×→1× via the daemonless boot smoke
    // (scratchpad/obs1-smoke.js: 10 routed GETs → 20 incs pre-fix, 10 post-fix). These
    // source pins lock the shipped shape so the behavioral replica below cannot drift.

    it('both engines carry the #OBS1 first-seer gate (isEnabled() && !request._metricsRecorded) — in sync', function() {
        var re = /if\s*\(\s*lib\.metrics\.isEnabled\(\)\s*&&\s*!request\._metricsRecorded\s*\)/;
        assert.match(ISAAC_SRC,  re, 'server.isaac.js must carry the #OBS1 first-seer gate');
        assert.match(SERVER_SRC, re, 'server.js must carry the #OBS1 first-seer gate (kept in sync with isaac)');
    });

    it('both engines claim request._metricsRecorded = true before wiring the metrics finish listener', function() {
        [{ n: 'server.isaac.js', s: ISAAC_SRC }, { n: 'server.js', s: SERVER_SRC }].forEach(function(e) {
            var claimIdx = e.s.indexOf('request._metricsRecorded = true');
            var wireIdx  = e.s.indexOf("response.on('finish', function _gina_metrics_record");
            assert.ok(claimIdx > -1, e.n + ' must set request._metricsRecorded = true');
            assert.ok(wireIdx  > -1, e.n + ' must wire the metrics finish listener');
            assert.ok(claimIdx < wireIdx, e.n + ': the claim flag must be set BEFORE the finish listener (so onInstance skips)');
        });
    });

    it('both engines first-seer-guard the sibling #FI timeline init (!request._devTimeline)', function() {
        var re = /&&\s*!request\._devTimeline\s*\)\s*\{/;
        assert.match(ISAAC_SRC,  re, 'server.isaac.js #FI init must be first-seer-guarded (unguarded overwrite drops the earlier requestStart under isaac)');
        assert.match(SERVER_SRC, re, 'server.js #FI init must be first-seer-guarded (in sync with isaac)');
    });

    // Behavioral: the runtime VALUE the fix delivers is "recordRequest fires exactly once
    // per routed request across the double-dispatch". Drive BOTH tops on the SAME
    // request/response with a counting recordRequest, emit 'finish', assert once — plus a
    // SUBTRACT proving the pre-fix (unguarded) shape double-fires. (jsdoc.md: a runtime
    // value needs a behavioral drive + subtract, not just a source pin.)
    it('both-tops wiring records exactly once per routed request (behavioral double-wire + subtract)', function() {
        var EventEmitter = require('events');

        // Replica of the shipped #OBS1 hook (gate + claim + finish wiring), locked to the
        // shipped shape by the source pins above. guarded=false is the pre-fix shape.
        function metricsHook(request, response, metrics, guarded) {
            if (metrics.isEnabled() && (!guarded || !request._metricsRecorded)) {
                if (guarded) { request._metricsRecorded = true; }
                request._metricsStartTime = Date.now();
                response.on('finish', function () {
                    try {
                        metrics.recordRequest({
                            method:   request.method,
                            route:    (request.routing && request.routing.rule) || undefined,
                            status:   response.statusCode,
                            duration: Date.now() - request._metricsStartTime
                        });
                    } catch (_e) { /* metrics never crashes a request */ }
                });
            }
        }

        function drive(guarded) {
            var calls = 0;
            var metrics = { isEnabled: function () { return true; }, recordRequest: function () { calls++; } };
            var request  = { method: 'GET', routing: { rule: 'homepage@demo' } };
            var response = new EventEmitter();
            response.statusCode = 200;
            // Under isaac a routed request runs BOTH tops on the SAME request/response:
            metricsHook(request, response, metrics, guarded);  // isaac listener top
            metricsHook(request, response, metrics, guarded);  // onInstance top (the cb)
            response.emit('finish');
            return calls;
        }

        assert.strictEqual(drive(true),  1, 'guarded: recordRequest fires exactly once across the isaac double-dispatch');
        assert.strictEqual(drive(false), 2, 'SUBTRACT: without the first-seer guard, the two tops register two finish listeners and recordRequest double-fires (the #OBS1 bug)');
    });

    // Behavioral: the #FI runtime VALUE is "requestStart keeps the EARLIER (isaac-listener)
    // time, not onInstance's later overwrite". Deterministic via an injected fake clock.
    it('#FI first-seer keeps the earlier requestStart across the double-dispatch (behavioral + subtract)', function() {
        function fiHook(request, inspectorActive, guarded) {
            if (inspectorActive && (!guarded || !request._devTimeline)) {
                request._devTimeline = { requestStart: request._fakeNow, entries: [] };
            }
        }
        // guarded: isaac top inits at T0=100; onInstance top (later T1=250) must NOT overwrite.
        var req = { _fakeNow: 100 };
        fiHook(req, true, true);          // isaac listener @ 100
        req._fakeNow = 250;               // time advances into onInstance
        fiHook(req, true, true);          // onInstance @ 250 — must skip
        assert.strictEqual(req._devTimeline.requestStart, 100, 'guarded: keeps the isaac-listener requestStart (earlier, more accurate)');

        // SUBTRACT: without the guard, onInstance overwrites requestStart with its later time.
        var req2 = { _fakeNow: 100 };
        fiHook(req2, true, false);
        req2._fakeNow = 250;
        fiHook(req2, true, false);
        assert.strictEqual(req2._devTimeline.requestStart, 250, 'SUBTRACT: without the guard, onInstance overwrites requestStart with its later time (drops the isaac-listener setup interval)');
    });

});
