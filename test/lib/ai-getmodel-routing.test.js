'use strict';
/**
 * AI connector getModel() routing — lib/model.js must route an AI/service
 * connector to its factory result instead of the Uppercase-keyed entity-class
 * build loops, so getModel('<aiConnector>') exposes the documented .infer / .stream.
 *
 * The AI factory (core/connectors/ai/index.js) returns lowercase keys
 * { client, provider, model, infer, stream }. The model-builder's two branches
 * (loadAllModels#done + reloadModels) iterate a connector's returned keys as
 * Entity classes under an Uppercase-first guard that THROWS on the first
 * lowercase key. A SERVICE_CONNECTOR_TYPES predicate now detects such a connector
 * BEFORE the guard and merges the factory onto the model object (preserving the
 * _connection / getConnection set by onModelReady), skipping both entity loops.
 *
 * Strategy (mirrors test/lib/model-load.test.js): source inspection + a
 * pure-logic routing replica (loadAllModels/reloadModels are not unit-isolatable
 * — they pull getContext/getPath/Model and live connectors) + a real-factory
 * shape check on the shipped export.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW           = require('../fw');
var MODEL_SRC    = path.join(FW, 'lib/model.js');
var AI_CONNECTOR = path.join(FW, 'core/connectors/ai/index.js');


describe('01 - model.js source pins: AI/service routing in BOTH builder branches', function() {

    var src;
    before(function() { src = fs.readFileSync(MODEL_SRC, 'utf8'); });

    it('declares a SERVICE_CONNECTOR_TYPES predicate including ai', function() {
        assert.match(src, /var SERVICE_CONNECTOR_TYPES\s*=\s*\{\s*ai:\s*true\s*\}/);
    });

    it('routes on SERVICE_CONNECTOR_TYPES in exactly two places (boot + reload)', function() {
        var hits = src.match(/SERVICE_CONNECTOR_TYPES\[\s*conf\.content\['connectors'\]\[name\]\.connector\s*\]/g) || [];
        assert.equal(hits.length, 2, 'one routing check per builder branch');
    });

    it('each branch merges the factory onto the model object', function() {
        var merges = src.match(/self\.models\[bundle\]\[name\]\[svcKey\]\s*=\s*entitiesManager\[svcKey\]/g) || [];
        assert.equal(merges.length, 2, 'one merge loop per builder branch');
    });

    it('each routing branch wraps a merge loop and ends with continue (skips the entity loops)', function() {
        var re = /SERVICE_CONNECTOR_TYPES\[/g, m, count = 0;
        while ((m = re.exec(src)) !== null) {
            var block = src.slice(m.index, m.index + 400);
            assert.match(block, /for \(var svcKey in entitiesManager\)/, 'merge loop present in the branch');
            assert.match(block, /continue;/, 'continue present after the merge');
            count++;
        }
        assert.equal(count, 2);
    });

    it('boot routing precedes the boot guard; reload routing precedes the reload guard', function() {
        var bootGuard   = src.indexOf('uppercase !'); // loadAllModels#done throw
        var reloadGuard = src.indexOf('uppercase ?'); // reloadModels throw
        var firstAi     = src.indexOf('SERVICE_CONNECTOR_TYPES[');
        var lastAi      = src.lastIndexOf('SERVICE_CONNECTOR_TYPES[');
        assert.ok(bootGuard > -1 && reloadGuard > -1, 'both guards still present');
        assert.ok(firstAi > -1 && lastAi > -1 && firstAi !== lastAi, 'two distinct routing sites');
        assert.ok(firstAi < bootGuard, 'boot routing must run before the boot guard');
        assert.ok(lastAi > bootGuard && lastAi < reloadGuard, 'reload routing must run before the reload guard');
    });

    it('retains the Uppercase-first guard (no-regression for entity managers)', function() {
        assert.match(src, /should start with an uppercase !/); // boot
        assert.match(src, /should start with an uppercase \?/); // reload
    });
});


describe('02 - routing decision (pure-logic replica of the inner-loop body)', function() {

    // Faithful replica of the per-connector routing fork in loadAllModels#done /
    // reloadModels. The two real branches are structurally identical (merge the
    // factory onto a model object already carrying _connection + getConnection),
    // so one replica covers both; `resetFirst` models reloadModels wiping then
    // re-seeding the model object.
    function buildModel(connectorType, factoryResult, withFix, resetFirst) {
        var SERVICE = { ai: true };
        var conn    = { tag: 'CONN' };

        var modelObj = {};                                   // onModelReady seed
        modelObj._connection   = conn;
        modelObj.getConnection = function() { return modelObj._connection; };
        if (resetFirst) {                                    // reloadModels: reset {} then re-seed
            modelObj = {};
            modelObj._connection   = conn;
            modelObj.getConnection = function() { return modelObj._connection; };
        }

        var entities = {};
        if (withFix && SERVICE[connectorType]) {             // <-- the new routing branch
            for (var k in factoryResult) { modelObj[k] = factoryResult[k]; }
            return { model: modelObj, entities: entities };  // skip both entity loops
        }
        for (var ntt in factoryResult) {                     // step-1 guard loop
            if (!/^[A-Z]/.test(ntt)) {
                throw new Error('Entity Class `' + ntt + '` should start with an uppercase !');
            }
            entities[ntt] = factoryResult[ntt];
        }
        return { model: modelObj, entities: entities };
    }

    var aiFactory = { client: { sdk: true }, provider: 'anthropic', model: 'claude-x',
                      infer: function() {}, stream: function() {} };
    var dbFactory = { UserEntity: function() {}, PostEntity: function() {} };

    it('reproduces the bug: an AI factory hits the Uppercase guard without the fix', function() {
        assert.throws(function() { buildModel('ai', aiFactory, false); }, /uppercase/);
    });

    it('with the fix, an AI connector exposes infer/stream/client/provider/model', function() {
        var r = buildModel('ai', aiFactory, true);
        assert.equal(typeof r.model.infer,  'function');
        assert.equal(typeof r.model.stream, 'function');
        assert.equal(r.model.client.sdk, true);
        assert.equal(r.model.provider,   'anthropic');
        assert.equal(r.model.model,      'claude-x');
        assert.equal(Object.keys(r.entities).length, 0, 'entity loops skipped for AI');
    });

    it('with the fix, the factory merge PRESERVES _connection + getConnection', function() {
        var r = buildModel('ai', aiFactory, true);
        assert.ok(r.model._connection && r.model._connection.tag === 'CONN', '_connection preserved');
        assert.equal(typeof r.model.getConnection, 'function');
        assert.equal(r.model.getConnection().tag, 'CONN', 'getConnection preserved');
    });

    it('reload branch (reset + re-seed) still yields a usable AI model', function() {
        var r = buildModel('ai', aiFactory, true, /*resetFirst*/ true);
        assert.equal(typeof r.model.infer,  'function');
        assert.equal(typeof r.model.stream, 'function');
        assert.equal(r.model.getConnection().tag, 'CONN');
    });

    it('no-regression: a data-store connector still builds its entity model', function() {
        var r = buildModel('sqlite', dbFactory, true);
        assert.deepEqual(Object.keys(r.entities).sort(), ['PostEntity', 'UserEntity']);
        assert.equal(r.model.infer, undefined, 'no service keys leak onto a data-store model');
    });

    it('explicit detection keeps the guard firing: a typo-lowercase entity key still throws WITH the fix', function() {
        assert.throws(function() { buildModel('sqlite', { userEntity: function() {} }, true); }, /uppercase/);
    });
});


describe('03 - real AI factory satisfies the routing premise (shipped export)', function() {

    var AI = require(AI_CONNECTOR);

    it('returns only lowercase-first keys (so the entity guard would throw on it)', function() {
        var ai   = AI({ client: {}, provider: 'anthropic', type: 'anthropic', modelName: 'claude-x' }, {});
        var keys = Object.keys(ai);
        assert.ok(keys.length > 0);
        keys.forEach(function(k) { assert.ok(!/^[A-Z]/.test(k), 'lowercase-first factory key: ' + k); });
        assert.ok(!/^[A-Z]/.test(keys[0]), 'first key is lowercase -> the Uppercase guard would throw');
    });

    it('exposes callable infer + stream (what getModel must surface)', function() {
        var ai = AI({ client: {}, provider: 'anthropic', type: 'anthropic', modelName: 'claude-x' }, {});
        assert.equal(typeof ai.infer,  'function');
        assert.equal(typeof ai.stream, 'function');
    });
});
