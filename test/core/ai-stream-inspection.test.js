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


// ─── 07 — SPA: AI-stream tab wiring (inspector.js, A1c) ──────────────────────
describe('07 - SPA: AI-stream tab wiring (inspector.js)', function() {

    var src;
    before(function() {
        src = read('core/asset/plugin/src/vendor/gina/inspector/js/inspector.js');
    });

    it('adds "stream" to all three TAB_LAYOUTS presets', function() {
        assert.ok(/balanced:[^\n]*'stream'\s*\]/.test(src), 'balanced preset');
        assert.ok(/backend:[^\n]*'stream'\s*\]/.test(src), 'backend preset');
        assert.ok(/frontend:[^\n]*'stream'\s*\]/.test(src), 'frontend preset');
    });

    it('declares the single-slot live token buffer', function() {
        assert.ok(/var _aiStreamBuf\s*=\s*\{\s*id:\s*null,\s*frames:\s*\[\]\s*\}/.test(src));
    });

    it('appendTokenDelta resets on a new stream id and accumulates frames', function() {
        assert.ok(src.indexOf('function appendTokenDelta') > -1, 'function defined');
        assert.ok(/frame\.id !== _aiStreamBuf\.id/.test(src), 'resets the buffer when the id changes');
        assert.ok(/_aiStreamBuf\.frames\.push\(frame\)/.test(src), 'accumulates frames');
    });

    it('wires the token event at all three agent receive sites', function() {
        // two SSE paths (tryAgent / tryAgentPassive) + one WS path (tryAgentWS)
        var sse = src.match(/addEventListener\('token',/g);
        assert.ok(sse && sse.length === 2, 'two SSE token listeners (tryAgent + tryAgentPassive)');
        assert.ok(src.indexOf("frame.event === 'token'") > -1, 'WS onmessage token branch');
        var parseCalls = src.match(/appendTokenDelta\(JSON\.parse\(ev\.data\)\)/g);
        assert.ok(parseCalls && parseCalls.length === 2, 'both SSE branches parse ev.data');
        assert.ok(src.indexOf('appendTokenDelta(frame.data)') > -1, 'WS branch passes the already-parsed frame.data');
    });

    it('renderTab has a stream case and a live-buffer guard for the no-snapshot state', function() {
        assert.ok(/case 'stream':/.test(src), 'switch case');
        assert.ok(src.indexOf('renderAiStream(treeEl, u.aiStream)') > -1, 'snapshot path reads u.aiStream');
        assert.ok(src.indexOf('renderAiStream(treeEl, null)') > -1, 'live-buffer fallback when !ginaData');
    });

    it('renders the stream pane via textContent, never innerHTML (untrusted token text)', function() {
        // Structural slice: the four AI-stream helpers sit between appendTokenDelta
        // and the next function (renderRaw). They must write textContent only.
        var start = src.indexOf('function appendTokenDelta');
        var end   = src.indexOf('function renderRaw');
        assert.ok(start > -1 && end > start, 'AI-stream function block located');
        var block = src.slice(start, end);
        assert.ok(block.indexOf('.textContent') > -1, 'writes textContent');
        assert.ok(block.indexOf('.innerHTML') < 0, 'never interpolates token text as innerHTML');
    });
});


// ─── 08 — SPA: tab markup (index.html) + dist propagation ────────────────────
describe('08 - SPA: AI-stream tab markup + dist propagation', function() {

    it('index.html adds the nav button and the <pre id="tree-stream"> pane', function() {
        var html = read('core/asset/plugin/src/vendor/gina/inspector/html/index.html');
        assert.ok(/<button class="bm-tab" data-tab="stream">/.test(html), 'nav button');
        assert.ok(/<section id="tab-stream"/.test(html), 'panel section');
        assert.ok(/<pre[^>]*id="tree-stream"/.test(html), 'pre pane');
    });

    it('the built dist copies carry the tab (verbatim-copy build)', function() {
        var distJs   = read('core/asset/plugin/dist/vendor/gina/inspector/inspector.js');
        var distHtml = read('core/asset/plugin/dist/vendor/gina/inspector/index.html');
        assert.ok(distJs.indexOf('function appendTokenDelta') > -1, 'dist inspector.js carries appendTokenDelta');
        assert.ok(distJs.indexOf("case 'stream':") > -1, 'dist inspector.js carries the stream case');
        assert.ok(/data-tab="stream"/.test(distHtml), 'dist index.html carries the nav button');
        assert.ok(/id="tree-stream"/.test(distHtml), 'dist index.html carries the pane');
    });
});
