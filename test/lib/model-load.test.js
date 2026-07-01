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


describe('03 - #B57: no-onInitialize model-load failure fails fast (not swallowed)', function() {

    // The no-onInitialize boot path (core/gna.js) wraps loadAllModels in a
    // try/catch. It used to SWALLOW a synchronous model-init throw (console.error
    // + e.emit('complete')) and boot a degraded bundle whose entire model layer
    // is dead — getModel() then returns a bare { _connection, getConnection } and
    // the bundle 500s at call-time with a cryptic TypeError. #B57 makes it fail
    // fast (emerg + fd-2 flush + process.exit(1)), matching the framework's
    // existing convention on every other model-init-failure path.
    var gnaSrc;
    before(function() { gnaSrc = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8'); });

    // structural bound: the catch body, from `catch(loadErr)` to the `// -- EO`
    // marker. Comment-stripped so the negative pin doesn't trip on the explanatory
    // "Was: … e.emit('complete') …" note in the catch (the jsdoc.md own-comment trap).
    function catchBody() {
        var ci = gnaSrc.indexOf('catch(loadErr)');
        var eo = gnaSrc.indexOf('// -- EO', ci);
        assert.ok(ci >= 0 && eo > ci, 'catch(loadErr) + // -- EO bound not found');
        return gnaSrc.slice(ci, eo).replace(/^\s*\/\/.*$/gm, '');
    }

    it('the no-onInitialize loadAllModels is still wrapped in try/catch(loadErr)', function() {
        assert.ok(gnaSrc.indexOf('No onInitialize handler') >= 0, 'no-onInitialize block present');
        assert.match(gnaSrc, /catch\s*\(\s*loadErr\s*\)/);
    });

    it('the catch FAILS FAST: console.emerg + fs.writeSync(2 + process.exit(1) + names the abort', function() {
        var body = catchBody();
        assert.match(body, /console\.emerg\(/,         'must emerg the failure (loud)');
        assert.match(body, /fs\.writeSync\(\s*2\s*,/,  'must flush to fd 2 (boot-exit-flush)');
        assert.match(body, /process\.exit\(\s*1\s*\)/, 'must exit(1) — fail fast');
        assert.match(body, /aborting boot/i,           'must name it a model-load abort');
    });

    it('the catch NO LONGER swallows by emitting "complete" (block-scoped negative pin)', function() {
        assert.doesNotMatch(catchBody(), /e\.emit\(\s*['"]complete['"]/,
            'the swallow (emit complete inside the catch) must be gone');
    });

    it('the SUCCESS path still emits "complete" (preserved — the original commit goal)', function() {
        var blockIdx = gnaSrc.indexOf('No onInitialize handler');
        var catchIdx = gnaSrc.indexOf('catch(loadErr)', blockIdx);
        var successBlock = gnaSrc.slice(blockIdx, catchIdx);
        assert.match(successBlock, /e\.emit\(\s*['"]complete['"]\s*,\s*instance\s*\)/,
            'success path must still emit complete');
    });

    // pure-logic replica: the same synchronous model-init throw -> fail-fast ABORTS
    // vs. the old swallow CONTINUES (the subtract that demonstrates the bug).
    it('replica: a sync model-init throw -> fail-fast aborts; the old swallow would have continued', function() {
        function boot(failFast) {
            var out = [];
            try {
                // a synchronous model-build throw (the uppercase entity-class guard,
                // or a syntax error in an entity .js file) on a sync (sqlite) connector
                throw new Error('Entity Class `2fa` should start with an uppercase !');
            } catch (loadErr) {
                if (failFast) { out.push('exit:1'); }       // #B57 — abort boot
                else { out.push('emit:complete'); }         // old behaviour — swallow -> degraded boot
            }
            return out;
        }
        assert.deepEqual(boot(true),  ['exit:1']);
        assert.deepEqual(boot(false), ['emit:complete']);
    });
});
