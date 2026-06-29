'use strict';
/**
 * Observable application-event inspection wiring (#EVTBUS)
 *
 * Exercises the REAL lib/inspector-events.emit() behaviour (gate, ALS push,
 * live frame, captureArgs metadata gating — §01) and source-pins the
 * cross-cutting wiring that carries an emitted event to the Inspector: the
 * per-request _devEventLog ALS buffer + self.emitEvent pass-through (controller,
 * §02), the captureArgs boot seed (gna.js, §03), the lib registration
 * (lib/index.js, §04), and the settings-template default (§05). The live
 * forwarders (server engines) + the user.events snapshot (render delegates) are
 * pinned in §06+ as those slices land.
 */
var { describe, it, before, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var FW     = require('../fw');
var { AsyncLocalStorage } = require('async_hooks');

var read = function(rel) { return fs.readFileSync(path.join(FW, rel), 'utf8'); };
var inspectorEvents = require(path.join(FW, 'lib/inspector-events/src/main.js'));


// ─── 01 — emit(): real behaviour (gate, ALS push, live frame, captureArgs) ───
describe('01 - inspector-events.emit(): behaviour', function() {

    var savedGina, savedDev, frames;
    var onEvent = function(f) { frames.push(f); };

    beforeEach(function() {
        savedGina = process.gina;
        savedDev  = process.env.NODE_ENV_IS_DEV;
        frames    = [];
        process.on('inspector#event', onEvent);
        process.gina = {
            _queryALS                   : new AsyncLocalStorage(),
            _inspectorWindowUntil       : 0,
            _inspectorEventsCaptureArgs : false
        };
    });
    afterEach(function() {
        process.removeListener('inspector#event', onEvent);
        process.gina = savedGina;
        if (savedDev === undefined) { delete process.env.NODE_ENV_IS_DEV; }
        else { process.env.NODE_ENV_IS_DEV = savedDev; }
    });

    it('no-ops (false) when the gate is closed (no dev, no window)', function() {
        delete process.env.NODE_ENV_IS_DEV;
        var r = process.gina._queryALS.run({ _devEventLog: [] }, function() {
            return inspectorEvents.emit('x.y', { a: 1 });
        });
        assert.equal(r, false);
        assert.equal(frames.length, 0);
    });

    it('no-ops (false) when gate open but outside a request context (no store)', function() {
        process.env.NODE_ENV_IS_DEV = 'true';
        // not inside .run() → getStore() is undefined → graceful no-op
        assert.equal(inspectorEvents.emit('x.y', { a: 1 }), false);
        assert.equal(frames.length, 0);
    });

    it('no-ops (false) on an invalid name', function() {
        process.env.NODE_ENV_IS_DEV = 'true';
        process.gina._queryALS.run({ _devEventLog: [] }, function() {
            assert.equal(inspectorEvents.emit('', { a: 1 }), false);
            assert.equal(inspectorEvents.emit(null), false);
            assert.equal(inspectorEvents.emit(42), false);
        });
        assert.equal(frames.length, 0);
    });

    it('pushes a {type,id,name,t} entry and emits a live frame under the dev gate', function() {
        process.env.NODE_ENV_IS_DEV = 'true';
        process.gina._queryALS.run({ _devEventLog: [] }, function() {
            var store = process.gina._queryALS.getStore();
            var r = inspectorEvents.emit('order.created');
            assert.equal(r, true);
            assert.equal(store._devEventLog.length, 1);
            var e = store._devEventLog[0];
            assert.equal(e.type, 'event');
            assert.equal(e.name, 'order.created');
            assert.ok(typeof e.id === 'string' && e.id.indexOf('ev-') === 0);
            assert.equal(typeof e.t, 'number');
        });
        assert.equal(frames.length, 1);
        assert.equal(frames[0].name, 'order.created');
        assert.ok(frames[0].id && typeof frames[0].t === 'number');
    });

    it('captures under an open instrumentation window even when NOT in dev', function() {
        delete process.env.NODE_ENV_IS_DEV;
        process.gina._inspectorWindowUntil = Date.now() + 60000;
        process.gina._queryALS.run({ _devEventLog: [] }, function() {
            assert.equal(inspectorEvents.emit('payment.received'), true);
        });
        assert.equal(frames.length, 1);
    });

    it('captureArgs=false (default) keeps metadata VALUES off the entry AND the frame', function() {
        process.env.NODE_ENV_IS_DEV = 'true';
        process.gina._inspectorEventsCaptureArgs = false;
        process.gina._queryALS.run({ _devEventLog: [] }, function() {
            var store = process.gina._queryALS.getStore();
            inspectorEvents.emit('order.created', { orderId: 7, secret: 'sk_live_x' });
            assert.equal(store._devEventLog[0].meta, undefined);
        });
        assert.equal(frames[0].meta, undefined);
    });

    it('captureArgs=true rides metadata on the entry AND the frame', function() {
        process.env.NODE_ENV_IS_DEV = 'true';
        process.gina._inspectorEventsCaptureArgs = true;
        process.gina._queryALS.run({ _devEventLog: [] }, function() {
            var store = process.gina._queryALS.getStore();
            inspectorEvents.emit('order.created', { orderId: 7 });
            assert.deepEqual(store._devEventLog[0].meta, { orderId: 7 });
        });
        assert.deepEqual(frames[0].meta, { orderId: 7 });
    });

    it('gives each event a unique id within a request', function() {
        process.env.NODE_ENV_IS_DEV = 'true';
        process.gina._queryALS.run({ _devEventLog: [] }, function() {
            var store = process.gina._queryALS.getStore();
            inspectorEvents.emit('a');
            inspectorEvents.emit('b');
            assert.notEqual(store._devEventLog[0].id, store._devEventLog[1].id);
        });
    });
});


// ─── 02 — controller: _devEventLog buffer + self.emitEvent pass-through ──────
describe('02 - controller: _devEventLog buffer + self.emitEvent', function() {

    var src;
    before(function() { src = read('core/controller/controller.js'); });

    it('initialises req._devEventLog alongside the query/AI buffers', function() {
        assert.ok(/req\._devEventLog\s*=\s*\[\]/.test(src));
    });
    it('mirrors it onto local._eventLog', function() {
        assert.ok(/local\._eventLog\s*=\s*req\._devEventLog/.test(src));
    });
    it('threads it as a 3rd key through the SAME _queryALS store', function() {
        assert.ok(/enterWith\(\{\s*_devQueryLog:\s*req\._devQueryLog,\s*_devAiLog:\s*req\._devAiLog,\s*_devEventLog:\s*req\._devEventLog\s*\}\)/.test(src));
    });
    it('exposes self.emitEvent as a thin pass-through to lib.inspectorEvents.emit', function() {
        assert.ok(/this\.emitEvent\s*=\s*function\s*\(name,\s*metadata\)/.test(src));
        assert.ok(/lib\.inspectorEvents\.emit\(name,\s*metadata\)/.test(src));
    });
});


// ─── 03 — gna: inspector.events.captureArgs boot seed ────────────────────────
describe('03 - gna: inspector.events.captureArgs boot seed', function() {

    var src;
    before(function() { src = read('core/gna.js'); });

    it('reads settings.inspector.events and seeds process.gina._inspectorEventsCaptureArgs', function() {
        assert.ok(/inspector\.events\b/.test(src), 'reads the inspector.events settings block');
        assert.ok(/_inspectorEventsCaptureArgs\s*=\s*\(_evInspConf\.captureArgs === true\)/.test(src));
    });
    it('fail-closes to false on error', function() {
        assert.ok(/process\.gina\._inspectorEventsCaptureArgs\s*=\s*false/.test(src));
    });
});


// ─── 04 — lib/index: inspectorEvents registration ────────────────────────────
describe('04 - lib/index: inspectorEvents registration', function() {

    var src;
    before(function() { src = read('lib/index.js'); });

    it('registers inspectorEvents via _require (stateless, hot-reloadable)', function() {
        assert.ok(/inspectorEvents\s*:\s*_require\('\.\/inspector-events'\)/.test(src));
    });
});


// ─── 05 — settings template: inspector.events.captureArgs default off ────────
describe('05 - settings template: inspector.events.captureArgs default', function() {

    var conf;
    before(function() {
        var raw = read('core/template/conf/settings.json');
        // The template carries // and /* */ comments (requireJSON strips them at
        // load); mirror that here before JSON.parse.
        raw  = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
        conf = JSON.parse(raw);
    });

    it('declares inspector.events.captureArgs = false (opt-in, default off)', function() {
        assert.ok(conf.inspector && conf.inspector.events, 'inspector.events block exists');
        assert.equal(conf.inspector.events.captureArgs, false);
    });
});
