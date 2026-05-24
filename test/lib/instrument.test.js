/**
 * lib/instrument — toggleable Inspector instrumentation window (#INS10)
 *
 * Tests cover the runtime primitive in isolation:
 *   - Module shape + HARD_CAP_SECONDS / DEFAULT_WINDOW_SECONDS exports
 *   - open() — sets a deadline, isActive() flips true, status() reports it
 *   - ttl clamping — default when omitted/invalid, clamp down to the effective max
 *   - hard cap — config maxWindowSeconds may LOWER the ceiling but never raise it
 *     above the absolute 3600s HARD_CAP
 *   - lazy auto-close — a past deadline reads inactive without the timer firing
 *   - close() — idempotent; emits inspector#instrument-closed only when a window
 *     was actually open
 *
 * Plus source-structure pins on the primitive and framework-wiring pins on
 * lib/index.js (plain require), gna.js (boot capture), and settings.json (the
 * inspector.instrumentation config block).
 */

'use strict';

var { describe, it, beforeEach, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW              = require('../fw');
var instrument      = require(path.join(FW, 'lib/instrument/src/main'));
var SOURCE          = path.join(FW, 'lib/instrument/src/main.js');
var INDEX_SOURCE    = path.join(FW, 'lib/index.js');
var GNA_SOURCE      = path.join(FW, 'core/gna.js');
var SETTINGS_SOURCE = path.join(FW, 'core/template/conf/settings.json');

// Reset the window + per-test config slots before each test so defaults apply.
beforeEach(function() {
    instrument.close();
    if (!process.gina) process.gina = {};
    process.gina._inspectorWindowDefaultSec = undefined;
    process.gina._inspectorWindowMaxSec     = undefined;
});

after(function() { instrument.close(); });

function secondsLeft(st) { return Math.round(st.remainingMs / 1000); }


// ─── Module shape ─────────────────────────────────────────────────────────────

describe('lib/instrument — module shape', function() {

    it('exports the control surface', function() {
        assert.equal(typeof instrument.isActive, 'function');
        assert.equal(typeof instrument.status,   'function');
        assert.equal(typeof instrument.open,     'function');
        assert.equal(typeof instrument.close,    'function');
    });

    it('exports the safety-bound constants', function() {
        assert.equal(instrument.HARD_CAP_SECONDS, 3600);
        assert.equal(instrument.DEFAULT_WINDOW_SECONDS, 300);
    });

    it('starts inactive', function() {
        assert.equal(instrument.isActive(), false);
        assert.equal(instrument.status().active, false);
    });

    it('status() reports the expected shape', function() {
        var st = instrument.status();
        assert.deepEqual(Object.keys(st).sort(), ['active', 'remainingMs', 'startedAt', 'until'].sort());
    });

});


// ─── open() / clamp / default ───────────────────────────────────────────────

describe('lib/instrument — open / clamp / default', function() {

    it('open(300) opens an active ~300s window', function() {
        var st = instrument.open(300);
        assert.equal(st.active, true);
        assert.equal(instrument.isActive(), true);
        assert.ok(secondsLeft(st) >= 299 && secondsLeft(st) <= 300, 'expected ~300s remaining, got ' + secondsLeft(st));
        assert.ok(st.until > Date.now(), 'until must be a future epoch');
        assert.ok(st.startedAt > 0, 'startedAt must be set');
    });

    it('open() with no ttl falls back to the default (300s)', function() {
        assert.equal(secondsLeft(instrument.open()) <= 300 && secondsLeft(instrument.open()) >= 299, true);
    });

    it('open() with an invalid ttl falls back to the default', function() {
        assert.ok(secondsLeft(instrument.open('not-a-number')) >= 299);
        assert.ok(secondsLeft(instrument.open(-50)) >= 299);
        assert.ok(secondsLeft(instrument.open(0)) >= 299);
    });

    it('clamps a huge ttl down to the 3600s hard cap', function() {
        var st = instrument.open(99999);
        assert.ok(secondsLeft(st) >= 3599 && secondsLeft(st) <= 3600, 'expected clamp to 3600, got ' + secondsLeft(st));
    });

    it('config maxWindowSeconds LOWERS the ceiling', function() {
        process.gina._inspectorWindowMaxSec = 60;
        var st = instrument.open(99999);
        assert.ok(secondsLeft(st) >= 59 && secondsLeft(st) <= 60, 'expected clamp to 60, got ' + secondsLeft(st));
    });

    it('config maxWindowSeconds CANNOT raise above the 3600s hard cap', function() {
        process.gina._inspectorWindowMaxSec = 99999;
        var st = instrument.open(99999);
        assert.ok(secondsLeft(st) <= 3600, 'config must not raise above the hard cap, got ' + secondsLeft(st));
    });

    it('honours a config defaultWindowSeconds when ttl is omitted', function() {
        process.gina._inspectorWindowDefaultSec = 120;
        var st = instrument.open();
        assert.ok(secondsLeft(st) >= 119 && secondsLeft(st) <= 120, 'expected default 120, got ' + secondsLeft(st));
    });

});


// ─── lazy auto-close / close / idempotency ──────────────────────────────────

describe('lib/instrument — lazy close / teardown', function() {

    it('a past deadline reads inactive WITHOUT the timer firing (lazy gate)', function() {
        instrument.open(300);
        assert.equal(instrument.isActive(), true);
        // Force the deadline into the past — the lazy per-gate check must close it.
        process.gina._inspectorWindowUntil = Date.now() - 1000;
        assert.equal(instrument.isActive(), false);
        var st = instrument.status();
        assert.equal(st.active, false);
        assert.equal(st.remainingMs, 0);
    });

    it('close() makes the window inactive', function() {
        instrument.open(300);
        var st = instrument.close();
        assert.equal(st.active, false);
        assert.equal(instrument.isActive(), false);
    });

    it('close() emits inspector#instrument-closed when a window was open', function() {
        instrument.open(300);
        var fired = false;
        process.once('inspector#instrument-closed', function() { fired = true; });
        instrument.close();
        assert.equal(fired, true);
    });

    it('close() is idempotent — no spurious event on an already-closed window', function() {
        instrument.close(); // ensure closed
        var fired = false;
        process.once('inspector#instrument-closed', function() { fired = true; });
        instrument.close();
        assert.equal(fired, false);
    });

});


// ─── Source-structure pins ───────────────────────────────────────────────────

describe('lib/instrument — source pins', function() {

    var _src;
    function src() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    it('declares the 3600s hard cap and 300s default constants', function() {
        assert.ok(/HARD_CAP_SECONDS\s*=\s*3600/.test(src()),     'expected HARD_CAP_SECONDS = 3600');
        assert.ok(/DEFAULT_WINDOW_SECONDS\s*=\s*300/.test(src()), 'expected DEFAULT_WINDOW_SECONDS = 300');
    });

    it('reads/writes the process.gina._inspectorWindowUntil deadline slot', function() {
        assert.ok(src().indexOf('process.gina._inspectorWindowUntil') > -1, 'expected the window deadline slot');
    });

    it('isActive() is the canonical > Date.now() comparison', function() {
        var i = src().indexOf('function isActive');
        var blk = src().substring(i, i + 300);
        assert.ok(/_inspectorWindowUntil\s*>\s*Date\.now\(\)/.test(blk), 'expected the > Date.now() window check');
    });

    it('effective max clamps the configured ceiling down to the hard cap', function() {
        var i = src().indexOf('function _effectiveMaxSeconds');
        var blk = src().substring(i, i + 400);
        assert.ok(/Math\.min\([^)]*HARD_CAP_SECONDS\)/.test(blk), 'expected Math.min(configured, HARD_CAP_SECONDS)');
    });

    it('arms an unref(\'d) expiry timer that calls close()', function() {
        var i = src().indexOf('function _armExpiryTimer');
        var blk = src().substring(i, i + 500);
        assert.ok(blk.indexOf('setTimeout') > -1, 'expected a setTimeout expiry timer');
        assert.ok(blk.indexOf('.unref(') > -1,    'expected the timer to be unref()d');
        assert.ok(blk.indexOf('close()') > -1,    'expected the timer to call close()');
    });

    it('emits inspector#instrument-closed on teardown', function() {
        assert.ok(src().indexOf("process.emit('inspector#instrument-closed')") > -1,
            'expected the teardown event emit');
    });

});


// ─── Framework wiring ─────────────────────────────────────────────────────────

describe('lib/instrument — framework wiring', function() {

    it('lib/index.js registers instrument via a PLAIN require (survives refreshCore)', function() {
        var idx = fs.readFileSync(INDEX_SOURCE, 'utf8');
        assert.ok(/instrument\s*:\s*require\('\.\/instrument'\)/.test(idx),
            "expected `instrument : require('./instrument')` (plain require, not _require)");
        assert.ok(!/instrument\s*:\s*_require\('\.\/instrument'\)/.test(idx),
            'instrument must NOT use the dev cache-busting _require — the timer + window would be orphaned per request');
    });

    it('gna.js captures the instrumentation opt-in + key + window bounds at boot', function() {
        var gna = fs.readFileSync(GNA_SOURCE, 'utf8');
        assert.ok(gna.indexOf('_inspectorInstrumentEnabled') > -1, 'expected the enabled toggle capture');
        assert.ok(gna.indexOf('_inspectorInstrumentKey') > -1,     'expected the key capture');
        assert.ok(gna.indexOf('_inspectorWindowDefaultSec') > -1,  'expected the default-window capture');
        assert.ok(gna.indexOf('_inspectorWindowMaxSec') > -1,      'expected the max-window capture');
        assert.ok(gna.indexOf('inspector.instrumentation') > -1 || gna.indexOf('_instrConf') > -1,
            'expected the settings.json inspector.instrumentation read');
    });

    it('gna.js clamps the captured maxWindowSeconds to the 3600s hard cap', function() {
        var gna = fs.readFileSync(GNA_SOURCE, 'utf8');
        var i = gna.indexOf('_inspectorWindowMaxSec');
        var blk = gna.substring(i, i + 200);
        assert.ok(/Math\.min\([^)]*3600\)/.test(blk), 'expected Math.min(_instrMax, 3600) clamp');
    });

    it('gna.js fails closed on a capture error', function() {
        var gna = fs.readFileSync(GNA_SOURCE, 'utf8');
        var i = gna.indexOf('inspector-instrument');
        var blk = gna.substring(i, i + 600);
        assert.ok(/_inspectorInstrumentEnabled\s*=\s*false/.test(blk), 'expected fail-closed enabled=false in the catch');
    });

    it('settings.json declares the inspector.instrumentation block (off by default)', function() {
        var raw = fs.readFileSync(SETTINGS_SOURCE, 'utf8');
        assert.ok(raw.indexOf('"instrumentation"') > -1,      'expected the instrumentation block');
        assert.ok(raw.indexOf('"defaultWindowSeconds"') > -1, 'expected defaultWindowSeconds');
        assert.ok(raw.indexOf('"maxWindowSeconds"') > -1,     'expected maxWindowSeconds');
        // Off + keyless by default (fail-closed).
        var i = raw.indexOf('"instrumentation"');
        var blk = raw.substring(i, i + 220);
        assert.ok(/"enabled"\s*:\s*false/.test(blk), 'instrumentation.enabled must default to false');
        assert.ok(/"key"\s*:\s*""/.test(blk),        'instrumentation.key must default to empty');
    });

});
