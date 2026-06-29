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


// ─── 06 — server.isaac: SSE inspector#event forwarder ────────────────────────
describe('06 - server.isaac: SSE inspector#event forwarder', function() {

    var src;
    before(function() { src = read('core/server.isaac.js'); });

    it('defines _agEventListener writing an event: event SSE frame', function() {
        assert.ok(src.indexOf('var _agEventListener = function') > -1);
        assert.ok(src.indexOf('event: event') > -1, 'distinct SSE event name (not data/log/token)');
    });
    it('registers + deregisters on inspector#event', function() {
        assert.ok(src.indexOf("process.on('inspector#event', _agEventListener)") > -1);
        assert.ok(src.indexOf("process.removeListener('inspector#event', _agEventListener)") > -1);
    });
});


// ─── 07 — server.js: WS inspector#event forwarder ────────────────────────────
describe('07 - server.js: WS inspector#event forwarder', function() {

    var src;
    before(function() { src = read('core/server.js'); });

    it('defines _wsEventListener sending an event: event envelope', function() {
        assert.ok(src.indexOf('var _wsEventListener = function') > -1);
        assert.ok(src.indexOf("event: 'event', data: payload") > -1);
    });
    it('registers + deregisters on inspector#event', function() {
        assert.ok(src.indexOf("process.on('inspector#event', _wsEventListener)") > -1);
        assert.ok(src.indexOf("process.removeListener('inspector#event', _wsEventListener)") > -1);
    });
});


// ─── 08 — server.js: SSE agent omits token + event (shared parity gap) ───────
describe('08 - server.js: SSE agent carries data + log only', function() {

    var src;
    before(function() { src = read('core/server.js'); });

    // The genuine server.js HTTP/1 SSE /_gina/agent handler (distinct from the WS
    // transport above) forwards inspector#data + logger#default only. Both
    // inspector#token and inspector#event ride the isaac SSE + the server.js WS
    // transport, NOT this HTTP/1 SSE path — a pre-existing #AISTREAM parity gap.
    // A single future slice would add BOTH here together; this pin keeps event
    // consistent with token (neither on the server.js SSE path).
    it('omits the SSE token + event forwarders (matches each other)', function() {
        assert.ok(src.indexOf("process.on('inspector#data', _agDataListener)") > -1, 'SSE data forwarder present');
        assert.ok(src.indexOf('_agTokenListener') < 0, 'no SSE token forwarder in server.js');
        assert.ok(src.indexOf('_agEventListener') < 0, 'no SSE event forwarder in server.js (consistent with token)');
    });
});


// ─── 09 — render delegates + window emit: user.events snapshot ───────────────
describe('09 - render delegates + window emit: user.events snapshot', function() {

    it('render-json attaches _gdUser.events gated on local._eventLog.length', function() {
        var src = read('core/controller/controller.render-json.js');
        assert.ok(/if \(local\._eventLog && local\._eventLog\.length > 0\) \{\s*_gdUser\.events = local\._eventLog;/.test(src));
    });
    it('render-swig attaches data.page.events on BOTH cache paths', function() {
        var src = read('core/controller/controller.render-swig.js');
        var matches = src.match(/data\.page\.events = local\._eventLog;/g) || [];
        assert.equal(matches.length, 2, 'cache-hit + cache-miss');
    });
    it('render-nunjucks attaches data.page.events', function() {
        var src = read('core/controller/controller.render-nunjucks.js');
        assert.ok(/data\.page\.events = local\._eventLog;/.test(src));
    });
    it('inspector-window-emit attaches _gdUser.events (prod-window path)', function() {
        var src = read('core/controller/inspector-window-emit.js');
        assert.ok(/if \(local\._eventLog && local\._eventLog\.length > 0\) \{\s*_gdUser\.events = local\._eventLog;/.test(src));
    });
});


// ─── 10 — SPA: Event tab wiring (src) ────────────────────────────────────────
describe('10 - SPA: Event tab wiring (src)', function() {

    var js, html;
    before(function() {
        js   = read('core/asset/plugin/src/vendor/gina/inspector/js/inspector.js');
        html = read('core/asset/plugin/src/vendor/gina/inspector/html/index.html');
    });

    it('declares an accumulating _eventBuf with a cap (not single-slot like tokens)', function() {
        assert.ok(/var _eventBuf\s*=\s*\[\]/.test(js));
        assert.ok(/var EVENT_BUF_MAX/.test(js));
    });
    it('appendAppEvent accumulates and renders via textContent (never innerHTML)', function() {
        assert.ok(/function appendAppEvent\(frame\)/.test(js));
        assert.ok(/_eventBuf\.push\(frame\)/.test(js));
        assert.ok(/_eventBuf\.length > EVENT_BUF_MAX/.test(js), 'caps the rolling buffer');
        var s = js.indexOf('function appendAppEvent');
        var e = js.indexOf('function formatEventBuffer', s);
        assert.ok(s > -1 && e > s);
        var blk = js.substring(s, e);
        assert.ok(blk.indexOf('.textContent') > -1, 'renders via textContent');
        assert.ok(blk.indexOf('.innerHTML') < 0, 'must not use innerHTML (untrusted event text)');
    });
    it('renderTab has a case events rendering the snapshot/buffer', function() {
        assert.ok(/case 'events':/.test(js));
        assert.ok(/renderAppEvents\(treeEl, u\.events\)/.test(js));
    });
    it('renders the Event tab even before a snapshot (!ginaData guard)', function() {
        assert.ok(/if \(name === 'events'\) \{ renderAppEvents\(treeEl, null\); return; \}/.test(js));
    });
    it('wires events into all three TAB_LAYOUTS presets', function() {
        var s   = js.indexOf('var TAB_LAYOUTS');
        var lay = js.substring(s, js.indexOf('};', s) + 2);
        assert.equal((lay.match(/'events'/g) || []).length, 3);
    });
    it('subscribes to the event frame at the 3 agent receive sites', function() {
        assert.equal((js.match(/es\.addEventListener\('event',/g) || []).length, 2, 'SSE: tryAgent + tryAgentPassive');
        assert.ok(/frame\.event === 'event'/.test(js), 'WS branch');
    });
    it('index.html declares the Events tab button + panel', function() {
        assert.ok(/data-tab="events"/.test(html));
        assert.ok(/id="tab-events"/.test(html));
        assert.ok(/id="tree-events"/.test(html));
    });
});


// ─── 11 — SPA: Event tab propagated to dist ──────────────────────────────────
describe('11 - SPA: Event tab propagated to dist', function() {

    var js, html;
    before(function() {
        js   = read('core/asset/plugin/dist/vendor/gina/inspector/inspector.js');
        html = read('core/asset/plugin/dist/vendor/gina/inspector/index.html');
    });

    it('dist inspector.js carries appendAppEvent + case events + the event listener', function() {
        assert.ok(/function appendAppEvent\(frame\)/.test(js));
        assert.ok(/case 'events':/.test(js));
        assert.ok(/es\.addEventListener\('event',/.test(js));
    });
    it('dist index.html carries the Events tab button + panel', function() {
        assert.ok(/data-tab="events"/.test(html));
        assert.ok(/id="tree-events"/.test(html));
    });
});
