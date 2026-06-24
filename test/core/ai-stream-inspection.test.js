'use strict';
/**
 * AI token-stream inspection wiring (#AISTREAM)
 *
 * Source-pins the cross-cutting wiring that carries the AI connector's token
 * stream to the Inspector: the per-request _devAiLog ALS buffer (controller),
 * the captureText opt-in boot seed (gna.js), the gated capture + live
 * inspector#token emit (AI connector), the SSE / WS forwarders (server.isaac.js
 * / server.js), and the user.aiStream snapshot in the render delegates + window
 * emit. The behavioral capture/emit path is exercised end-to-end in
 * ai-connector.test.js §11; this file locks the delivery wiring against drift.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var FW     = require('../fw');

var read = function(rel) { return fs.readFileSync(path.join(FW, rel), 'utf8'); };


// ─── 01 — controller: _devAiLog per-request buffer (ALS sibling) ─────────────
describe('01 - controller: _devAiLog per-request buffer (ALS sibling)', function() {

    var src;
    before(function() { src = read('core/controller/controller.js'); });

    it('initialises req._devAiLog alongside req._devQueryLog', function() {
        assert.ok(/req\._devAiLog\s*=\s*\[\]/.test(src));
    });
    it('mirrors it onto local._aiLog', function() {
        assert.ok(/local\._aiLog\s*=\s*req\._devAiLog/.test(src));
    });
    it('threads it through the SAME _queryALS store', function() {
        assert.ok(/enterWith\(\{\s*_devQueryLog:\s*req\._devQueryLog,\s*_devAiLog:\s*req\._devAiLog\s*\}\)/.test(src));
    });
});


// ─── 02 — gna: inspector.ai.captureText boot seed ────────────────────────────
describe('02 - gna: inspector.ai.captureText boot seed', function() {

    var src;
    before(function() { src = read('core/gna.js'); });

    it('reads settings.inspector.ai and seeds process.gina._inspectorAiCaptureText', function() {
        assert.ok(/inspector\.ai\b/.test(src), 'reads the inspector.ai settings block');
        assert.ok(/_inspectorAiCaptureText\s*=\s*\(_aiInspConf\.captureText === true\)/.test(src));
    });
    it('fail-closes to false on error', function() {
        assert.ok(/process\.gina\._inspectorAiCaptureText\s*=\s*false/.test(src));
    });
});


// ─── 03 — AI connector: gated capture + live inspector#token emit ────────────
describe('03 - AI connector: gated capture + live inspector#token emit', function() {

    var src;
    before(function() { src = read('core/connectors/ai/index.js'); });

    it('captures under the dev / instrumentation-window gate via the _queryALS store', function() {
        assert.ok(/_inspectorWindowUntil > Date\.now\(\)/.test(src));
        assert.ok(/_queryALS\.getStore\(\)/.test(src));
        assert.ok(/_devAiLog/.test(src));
    });
    it('emits a live inspector#token event', function() {
        assert.ok(src.indexOf("process.emit('inspector#token'") > -1);
    });
    it('gates chunk text + prompt on captureText (default off) with redaction-safe keys', function() {
        assert.ok(/_inspectorAiCaptureText/.test(src), 'reads the captureText flag');
        assert.ok(/_captureText/.test(src));
        assert.ok(/deltaText/.test(src), 'chunk text rides as deltaText (not a bare token key)');
        assert.ok(/outputTokens/.test(src) && /promptTokens/.test(src), 'token counts use redaction-safe plural keys');
    });
    it('leaves infer() byte-identical (no instrumentation in the buffered path)', function() {
        // The instrumentation lives in stream(); infer() must not reference _devAiLog.
        var inferStart = src.indexOf('var infer = function(messages, options)');
        var streamStart = src.indexOf('var stream = function(messages, options)');
        assert.ok(inferStart > -1 && streamStart > inferStart);
        var inferBody = src.substring(inferStart, streamStart);
        assert.ok(inferBody.indexOf('_devAiLog') < 0, 'infer() must not touch the AI inspection buffer');
        assert.ok(inferBody.indexOf('inspector#token') < 0, 'infer() must not emit token frames');
    });
});


// ─── 04 — server.isaac: SSE inspector#token forwarder ────────────────────────
describe('04 - server.isaac: SSE inspector#token forwarder', function() {

    var src;
    before(function() { src = read('core/server.isaac.js'); });

    it('defines _agTokenListener writing an event: token SSE frame', function() {
        assert.ok(src.indexOf('var _agTokenListener = function') > -1);
        assert.ok(src.indexOf('event: token') > -1, 'distinct SSE event name (not data/log)');
    });
    it('registers + deregisters on inspector#token', function() {
        assert.ok(src.indexOf("process.on('inspector#token', _agTokenListener)") > -1);
        assert.ok(src.indexOf("process.removeListener('inspector#token', _agTokenListener)") > -1);
    });
});


// ─── 05 — server.js: WS inspector#token forwarder ────────────────────────────
describe('05 - server.js: WS inspector#token forwarder', function() {

    var src;
    before(function() { src = read('core/server.js'); });

    it('defines _wsTokenListener sending an event: token envelope', function() {
        assert.ok(src.indexOf('var _wsTokenListener = function') > -1);
        assert.ok(src.indexOf("event: 'token', data: payload") > -1);
    });
    it('registers + deregisters on inspector#token', function() {
        assert.ok(src.indexOf("process.on('inspector#token', _wsTokenListener)") > -1);
        assert.ok(src.indexOf("process.removeListener('inspector#token', _wsTokenListener)") > -1);
    });
});


// ─── 06 — render delegates: user.aiStream snapshot ───────────────────────────
describe('06 - render delegates: user.aiStream snapshot', function() {

    it('render-json attaches _gdUser.aiStream gated on a non-empty local._aiLog', function() {
        var src = read('core/controller/controller.render-json.js');
        assert.ok(/_gdUser\.aiStream\s*=\s*local\._aiLog/.test(src));
        assert.ok(/local\._aiLog && local\._aiLog\.length > 0/.test(src));
    });
    it('inspector-window-emit attaches _gdUser.aiStream', function() {
        var src = read('core/controller/inspector-window-emit.js');
        assert.ok(/_gdUser\.aiStream\s*=\s*local\._aiLog/.test(src));
    });
    it('render-swig attaches data.page.aiStream on BOTH cache paths', function() {
        var src = read('core/controller/controller.render-swig.js');
        var m = src.match(/data\.page\.aiStream\s*=\s*local\._aiLog/g);
        assert.ok(m && m.length >= 2, 'expected aiStream attach on the cache-miss AND cache-hit paths');
    });
    it('render-nunjucks attaches data.page.aiStream', function() {
        var src = read('core/controller/controller.render-nunjucks.js');
        assert.ok(/data\.page\.aiStream\s*=\s*local\._aiLog/.test(src));
    });
});
