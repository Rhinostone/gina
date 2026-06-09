'use strict';
/**
 * #B29 — lib/model.js loadAllModels must fire its completion callback for a
 * connectors config that has NO actual connector entries (a `$schema`-only file,
 * the `bundle:add` scaffold default, or an empty `{}`). Before the fix, such a
 * config entered the connector branch with `_connectorCount === 0`; the
 * connector loop `continue`d past every non-object key, so `done()` (the sole
 * `cb()` caller) was never reached, the callback dangled, and boot stalled
 * before `.listen()` (bundle:start "taking too long" / gina-container exit 0).
 *
 * Strategy: source inspection + a pure-logic dispatch replica (loadAllModels is
 * not unit-isolatable — it pulls getContext/getPath/Model and live connectors).
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW        = require('../fw');
var MODEL_SRC = path.join(FW, 'lib/model.js');


describe('01 - #B29: model.js source pins (zero-connector guard fires cb)', function() {

    var src;
    before(function() { src = fs.readFileSync(MODEL_SRC, 'utf8'); });

    it('has a `_connectorCount === 0` guard in the connector branch', function() {
        assert.match(src, /if\s*\(\s*_connectorCount\s*===?\s*0\s*\)/);
    });

    it('the guard advances to the next bundle OR fires cb(), then returns', function() {
        var i = src.search(/if\s*\(\s*_connectorCount\s*===?\s*0\s*\)/);
        assert.ok(i >= 0, 'zero-connector guard not found');
        var block = src.slice(i, i + 300);
        assert.match(block, /loadModel\(\s*b\s*\+\s*1/, 'guard must advance to the next bundle');
        assert.match(block, /\bcb\(\)/,                 'guard must fire cb() for the last bundle');
        assert.match(block, /\breturn;/,                'guard must return after advancing');
    });

    it('the guard sits AFTER the _connectorCount loop and BEFORE the connector-processing (`var t = 0`)', function() {
        var countIdx = src.indexOf('var _connectorCount = 0;');
        var guardIdx = src.search(/if\s*\(\s*_connectorCount\s*===?\s*0\s*\)/);
        var tIdx     = src.indexOf('var t = 0;');
        assert.ok(countIdx >= 0 && guardIdx >= 0 && tIdx >= 0, 'expected landmarks present');
        assert.ok(countIdx < guardIdx && guardIdx < tIdx,
            'guard must be between the _connectorCount loop and `var t = 0`');
    });
});


describe('02 - #B29: zero-connector dispatch fires cb (pure-logic replica)', function() {

    // Faithful replica of loadModel's connector-branch dispatch for a single
    // (last) bundle. `withFix` models the #B29 guard; without it, a
    // zero-connector config reproduces the dangling-callback bug.
    function dispatch(connectorsObj, withFix) {
        var cbFired = false;
        var cb = function() { cbFired = true; };
        var connectors = connectorsObj || undefined;

        if (typeof(connectors) != 'undefined' && connectors != null) {
            var models = connectors;
            var _connectorCount = 0;
            for (var k in models) {
                if (models.hasOwnProperty(k) && typeof(models[k]) == 'object' && models[k] !== null) {
                    ++_connectorCount;
                }
            }
            if (withFix && _connectorCount === 0) { cb(); return cbFired; } // #B29
            var t = 0;
            var done = function() { if (++t === _connectorCount) cb(); };
            for (var c in models) {
                if (typeof(models[c]) != 'object' || models[c] === null) continue; // skip $schema
                done();
            }
        } else {
            cb(); // no-connector else branch
        }
        return cbFired;
    }

    it('$schema-only connectors → cb fires WITH the fix', function() {
        assert.equal(dispatch({ '$schema': 'https://gina.io/schema/connectors.json' }, true), true);
    });

    it('$schema-only connectors → cb DANGLES without the fix (reproduces the bug)', function() {
        assert.equal(dispatch({ '$schema': 'https://gina.io/schema/connectors.json' }, false), false);
    });

    it('empty {} connectors → cb fires WITH the fix', function() {
        assert.equal(dispatch({}, true), true);
    });

    it('empty {} connectors → cb DANGLES without the fix', function() {
        assert.equal(dispatch({}, false), false);
    });

    it('a real connector → cb fires, unchanged by the fix', function() {
        assert.equal(dispatch({ db: { connector: 'sqlite' } }, true),  true);
        assert.equal(dispatch({ db: { connector: 'sqlite' } }, false), true);
    });

    it('$schema + a real connector → cb fires (the real connector is processed)', function() {
        assert.equal(dispatch({ '$schema': 'x', db: { connector: 'sqlite' } }, true), true);
    });

    it('no connectors.json (undefined) → cb fires via the no-connector else', function() {
        assert.equal(dispatch(undefined, true),  true);
        assert.equal(dispatch(undefined, false), true);
    });
});
