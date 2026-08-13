'use strict';
/**
 * renderStream — controller.render-stream.js unit tests
 *
 * Strategy: inject mock deps (self, local, headersSent) and fake HTTP
 * objects, then drive the async IIFE through its paths.
 *
 * Suites:
 *  01 — controller.js: renderStream method wired correctly
 *  02 — render-stream.js: guards (double-render, isProcessingError, headersSent)
 *  03 — SSE framing: text/event-stream chunks are wrapped as data: …\n\n
 *  04 — raw content-type: chunks written verbatim
 *  05 — HTTP/1.1: headers set, write/end called in order
 *  06 — HTTP/2: stream.respond + stream.write + stream.end
 *  07 — connection-close detection: destroyed/writableEnded mid-stream
 *  08 — error handling: throwError called on iterable rejection
 *  09 — cleanup: local.req/res/next nulled on all exit paths
 */
var { describe, it, before }  = require('node:test');
var assert  = require('node:assert/strict');
var path    = require('path');
var fs      = require('fs');

var FW              = require('../fw');
var CONTROLLER_SRC  = path.join(FW, 'core/controller/controller.js');
var RENDER_STREAM   = path.join(FW, 'core/controller/controller.render-stream.js');

var renderStream = require(RENDER_STREAM);

// ─── helpers ─────────────────────────────────────────────────────────────────

async function* from(items) { for (var i of items) yield i; }

function makeLocal(overrides) {
    return Object.assign({
        req  : {},
        res  : { getHeaders: function() { return {}; }, headersSent: false, statusCode: 200,
                 setHeader: function() {}, write: function() {}, end: function() {},
                 writableEnded: false, destroyed: false },
        next : null,
        options: { renderingStack: [], conf: { server: { protocol: 'http/1.1' }, encoding: 'utf-8',
            coreConfiguration: { mime: { json: 'application/json' } } } }
    }, overrides);
}

function makeDeps(localOverrides, selfOverrides) {
    var local = makeLocal(localOverrides);
    var _headersSent = false;
    var self = Object.assign({ isProcessingError: false, throwError: function() {} }, selfOverrides);
    var headersSent = function() { return _headersSent; };
    headersSent._set = function(v) { _headersSent = v; };
    return { self: self, local: local, headersSent: headersSent };
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }


// ─── 01 — controller.js source ───────────────────────────────────────────────

describe('01 - renderStream: controller.js wiring', function() {

    var src;
    before(function() { src = fs.readFileSync(CONTROLLER_SRC, 'utf8'); });

    it('defines this.renderStream on SuperController', function() {
        assert.ok(/this\.renderStream\s*=\s*function/.test(src));
    });

    it('delegates to controller.render-stream', function() {
        assert.ok(/controller\.render-stream/.test(src));
    });

    it('cache-busts controller.render-stream in cacheless mode', function() {
        var block = src.slice(src.indexOf('this.renderStream'), src.indexOf('this.renderStream') + 1100);
        assert.ok(/isCacheless/.test(block));
        assert.ok(/delete require\.cache/.test(block));
    });

    it('passes asyncIterable, contentType, and deps to the delegate', function() {
        var block = src.slice(src.indexOf('this.renderStream'), src.indexOf('this.renderStream') + 1100);
        assert.ok(/asyncIterable/.test(block));
        assert.ok(/contentType/.test(block));
        assert.ok(/self\s*:\s*self/.test(block));
        assert.ok(/local\s*:\s*local/.test(block));
        assert.ok(/headersSent\s*:\s*headersSent/.test(block));
    });

    it('renderStream appears after renderJSON in the source', function() {
        assert.ok(src.indexOf('this.renderStream') > src.indexOf('this.renderJSON'));
    });
});


// ─── 02 — guards ─────────────────────────────────────────────────────────────

describe('02 - renderStream: guards', function() {

    it('returns false when renderingStack.length > 1', function() {
        var deps = makeDeps({ options: { renderingStack: [1, 2],
            conf: { server: { protocol: 'http/1.1' }, encoding: 'utf-8',
                coreConfiguration: { mime: {} } } } });
        var result = renderStream(from([]), 'text/event-stream', deps);
        assert.strictEqual(result, false);
    });

    it('returns undefined (early) when isProcessingError is true', function() {
        var deps = makeDeps({}, { isProcessingError: true });
        var result = renderStream(from([]), 'text/event-stream', deps);
        assert.strictEqual(result, undefined);
    });

    it('nulls locals and returns when headers already sent', function() {
        var deps = makeDeps();
        deps.headersSent._set(true);
        renderStream(from([]), 'text/event-stream', deps);
        assert.strictEqual(deps.local.req, null);
        assert.strictEqual(deps.local.res, null);
        assert.strictEqual(deps.local.next, null);
    });
});


// ─── 03 — SSE framing ────────────────────────────────────────────────────────

describe('03 - renderStream: SSE framing', function() {

    it('wraps each chunk as data: {chunk}\\n\\n for text/event-stream', async function() {
        var written = [];
        var deps = makeDeps();
        deps.local.res.write = function(d) { written.push(d); };
        deps.local.res.end   = function() {};

        renderStream(from(['hello', 'world']), 'text/event-stream', deps);
        await sleep(50);

        assert.deepEqual(written, ['data: hello\n\n', 'data: world\n\n']);
    });

    it('defaults to text/event-stream when contentType is omitted', async function() {
        var written = [];
        var deps = makeDeps();
        deps.local.res.write = function(d) { written.push(d); };
        deps.local.res.end   = function() {};

        renderStream(from(['token']), undefined, deps);
        await sleep(50);

        assert.ok(written[0].startsWith('data: '));
    });

    it('sets x-accel-buffering: no for SSE (disables nginx buffering)', async function() {
        var headers = {};
        var deps = makeDeps();
        deps.local.res.setHeader = function(k, v) { headers[k.toLowerCase()] = v; };
        deps.local.res.write = function() {};
        deps.local.res.end   = function() {};

        renderStream(from([]), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(headers['x-accel-buffering'], 'no');
    });

    it('converts Buffer chunks to UTF-8 string before SSE framing', async function() {
        var written = [];
        var deps = makeDeps();
        deps.local.res.write = function(d) { written.push(d); };
        deps.local.res.end   = function() {};

        renderStream(from([Buffer.from('buffered')]), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(written[0], 'data: buffered\n\n');
    });
});


// ─── 04 — raw content-type ───────────────────────────────────────────────────

describe('04 - renderStream: raw (non-SSE) content-type', function() {

    it('writes chunks verbatim for application/octet-stream', async function() {
        var written = [];
        var deps = makeDeps();
        deps.local.res.write = function(d) { written.push(d); };
        deps.local.res.end   = function() {};

        renderStream(from(['chunk1', 'chunk2']), 'application/octet-stream', deps);
        await sleep(50);

        assert.deepEqual(written, ['chunk1', 'chunk2']);
    });

    it('does not wrap chunks in data: prefix for text/plain', async function() {
        var written = [];
        var deps = makeDeps();
        deps.local.res.write = function(d) { written.push(d); };
        deps.local.res.end   = function() {};

        renderStream(from(['line']), 'text/plain', deps);
        await sleep(50);

        assert.strictEqual(written[0], 'line');
        assert.ok(!written[0].startsWith('data:'));
    });
});


// ─── 05 — HTTP/1.1 path ──────────────────────────────────────────────────────

describe('05 - renderStream: HTTP/1.1 response path', function() {

    it('sets content-type header', async function() {
        var headers = {};
        var deps = makeDeps();
        deps.local.res.setHeader = function(k, v) { headers[k.toLowerCase()] = v; };
        deps.local.res.write = function() {};
        deps.local.res.end   = function() {};

        renderStream(from([]), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(headers['content-type'], 'text/event-stream');
    });

    it('sets cache-control: no-cache', async function() {
        var headers = {};
        var deps = makeDeps();
        deps.local.res.setHeader = function(k, v) { headers[k.toLowerCase()] = v; };
        deps.local.res.write = function() {};
        deps.local.res.end   = function() {};

        renderStream(from([]), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(headers['cache-control'], 'no-cache');
    });

    it('sets connection: keep-alive', async function() {
        var headers = {};
        var deps = makeDeps();
        deps.local.res.setHeader = function(k, v) { headers[k.toLowerCase()] = v; };
        deps.local.res.write = function() {};
        deps.local.res.end   = function() {};

        renderStream(from([]), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(headers['connection'], 'keep-alive');
    });

    it('calls response.end() after all chunks are written', async function() {
        var ended = false;
        var deps = makeDeps();
        deps.local.res.write = function() {};
        deps.local.res.end   = function() { ended = true; };

        renderStream(from(['a', 'b']), 'text/event-stream', deps);
        await sleep(50);

        assert.ok(ended, 'response.end() should have been called');
    });

    it('sets response.headersSent = true after streaming', async function() {
        var deps = makeDeps();
        var res = deps.local.res;   // capture before finally nulls local.res
        res.write = function() {};
        res.end   = function() {};

        renderStream(from(['x']), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(res.headersSent, true);
    });
});


// ─── 06 — HTTP/2 path ────────────────────────────────────────────────────────

describe('06 - renderStream: HTTP/2 stream path', function() {

    function makeHttp2Deps(pendingHeaders) {
        var responded = null;
        var written   = [];
        var ended     = false;
        var stream2   = {
            headersSent : false,
            destroyed   : false,
            closed      : false,
            respond     : function(h) { responded = h; stream2.headersSent = true; },
            write       : function(d) { written.push(d); },
            end         : function()  { ended = true; }
        };
        var deps = makeDeps();
        deps.local.res.stream     = stream2;
        deps.local.res.getHeaders = function() { return pendingHeaders || {}; };
        deps.local.res.headersSent = false;
        return { deps: deps, stream2: stream2, get responded() { return responded; },
                 get written() { return written; }, get ended() { return ended; } };
    }

    it('calls stream.respond() with :status 200 before writing', async function() {
        var h = makeHttp2Deps();
        renderStream(from(['tok']), 'text/event-stream', h.deps);
        await sleep(50);
        assert.ok(h.responded, 'stream.respond() should have been called');
        assert.strictEqual(h.responded[':status'], 200);
    });

    it('includes content-type in stream.respond() headers', async function() {
        var h = makeHttp2Deps();
        renderStream(from([]), 'text/event-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.responded['content-type'], 'text/event-stream');
    });

    it('merges pending response headers (CORS etc.) into stream.respond()', async function() {
        var h = makeHttp2Deps({ 'access-control-allow-origin': '*' });
        renderStream(from([]), 'text/event-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.responded['access-control-allow-origin'], '*');
    });

    it('does not overwrite :status with pending headers', async function() {
        var h = makeHttp2Deps({ ':status': 204 });
        renderStream(from([]), 'text/event-stream', h.deps);
        await sleep(50);
        // :status should remain 200 — pending headers must not clobber it
        assert.strictEqual(h.responded[':status'], 200);
    });

    it('calls stream.write() for each chunk', async function() {
        var h = makeHttp2Deps();
        renderStream(from(['a', 'b', 'c']), 'text/event-stream', h.deps);
        await sleep(50);
        assert.deepEqual(h.written, ['data: a\n\n', 'data: b\n\n', 'data: c\n\n']);
    });

    it('calls stream.end() after all chunks', async function() {
        var h = makeHttp2Deps();
        renderStream(from(['x']), 'text/event-stream', h.deps);
        await sleep(50);
        assert.ok(h.ended, 'stream.end() should have been called');
    });

    it('sets response.headersSent = true after HTTP/2 stream ends', async function() {
        var h = makeHttp2Deps();
        var res = h.deps.local.res;  // capture before finally nulls local.res
        renderStream(from([]), 'text/event-stream', h.deps);
        await sleep(50);
        assert.strictEqual(res.headersSent, true);
    });

    it('skips writing if stream is already destroyed before start', async function() {
        var h = makeHttp2Deps();
        h.stream2.destroyed = true;
        var called = false;
        h.stream2.respond = function() { called = true; };
        renderStream(from(['tok']), 'text/event-stream', h.deps);
        await sleep(50);
        assert.ok(!called, 'respond should not be called on a destroyed stream');
    });
});


// ─── 07 — connection-close detection ─────────────────────────────────────────

describe('07 - renderStream: connection-close detection', function() {

    it('stops writing HTTP/1.1 chunks when response.writableEnded becomes true mid-stream', async function() {
        var written = [];
        var deps = makeDeps();
        var count = 0;
        deps.local.res.write = function(d) {
            written.push(d);
            count++;
            if (count >= 1) deps.local.res.writableEnded = true;
        };
        deps.local.res.end = function() {};

        async function* slow() { yield 'first'; yield 'second'; yield 'third'; }

        renderStream(slow(), 'text/plain', deps);
        await sleep(100);

        assert.strictEqual(written.length, 1);
    });

    it('stops writing HTTP/2 chunks when stream.destroyed becomes true mid-stream', async function() {
        var written = [];
        var stream2 = {
            headersSent: false, destroyed: false, closed: false,
            respond: function() { stream2.headersSent = true; },
            write  : function(d) { written.push(d); stream2.destroyed = true; },
            end    : function() {}
        };
        var deps = makeDeps();
        deps.local.res.stream     = stream2;
        deps.local.res.getHeaders = function() { return {}; };

        async function* slow() { yield 'a'; yield 'b'; yield 'c'; }

        renderStream(slow(), 'text/plain', deps);
        await sleep(100);

        assert.strictEqual(written.length, 1);
    });
});


// ─── 08 — error handling ─────────────────────────────────────────────────────

describe('08 - renderStream: error handling', function() {

    it('calls self.throwError(response, 500, err) when the iterable rejects', async function() {
        var thrownCode = null, thrownErr = null;
        var deps = makeDeps({}, {
            throwError: function(res, code, err) { thrownCode = code; thrownErr = err; }
        });
        deps.local.res.write = function() {};
        deps.local.res.end   = function() {};

        async function* bad() { yield 'ok'; throw new Error('boom'); }

        renderStream(bad(), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(thrownCode, 500);
        assert.ok(thrownErr instanceof Error);
        assert.strictEqual(thrownErr.message, 'boom');
    });
});


// ─── 09 — cleanup ────────────────────────────────────────────────────────────

describe('09 - renderStream: cleanup (locals nulled)', function() {

    it('nulls local.req, local.res, local.next after successful HTTP/1.1 stream', async function() {
        var deps = makeDeps();
        deps.local.req  = {};
        deps.local.next = function() {};
        deps.local.res.write = function() {};
        deps.local.res.end   = function() {};

        renderStream(from(['x']), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(deps.local.req,  null);
        assert.strictEqual(deps.local.res,  null);
        assert.strictEqual(deps.local.next, null);
    });

    it('nulls locals even when the iterable throws', async function() {
        var deps = makeDeps({}, { throwError: function() {} });
        deps.local.req  = {};
        deps.local.next = function() {};
        deps.local.res.write = function() {};
        deps.local.res.end   = function() {};

        async function* bad() { throw new Error('fail'); }

        renderStream(bad(), 'text/event-stream', deps);
        await sleep(50);

        assert.strictEqual(deps.local.req,  null);
        assert.strictEqual(deps.local.res,  null);
        assert.strictEqual(deps.local.next, null);
    });
});


// ─── 10 — HTTP/2 response trailers (#H10) ────────────────────────────────────

describe('10 - renderStream: HTTP/2 trailers (#H10)', function() {

    function makeHttp2TrailerDeps(pendingHeaders) {
        var responded = null, respondOpts = null, written = [], ended = false;
        var sentTrailers = null, wantTrailersCb = null;
        var stream2 = {
            headersSent : false,
            destroyed   : false,
            closed      : false,
            respond     : function(h, opts) { responded = h; respondOpts = (typeof opts === 'undefined') ? null : opts; stream2.headersSent = true; },
            write       : function(d) { written.push(d); },
            // With waitForTrailers, Node fires 'wantTrailers' on end() instead of closing.
            end         : function() { ended = true; if (wantTrailersCb) wantTrailersCb(); },
            once        : function(ev, cb) { if (ev === 'wantTrailers') wantTrailersCb = cb; },
            sendTrailers: function(f) { sentTrailers = f; }
        };
        var deps = makeDeps();
        deps.local.res.stream      = stream2;
        deps.local.res.getHeaders  = function() { return pendingHeaders || {}; };
        deps.local.res.headersSent = false;
        return {
            deps: deps, stream2: stream2,
            get responded()    { return responded; },
            get respondOpts()  { return respondOpts; },
            get written()      { return written; },
            get ended()        { return ended; },
            get sentTrailers() { return sentTrailers; }
        };
    }

    // ── source-structure pins ──

    it('render-stream source wires waitForTrailers + wantTrailers + sendTrailers', function() {
        var src = fs.readFileSync(RENDER_STREAM, 'utf8');
        assert.ok(src.indexOf('waitForTrailers') > -1, 'expected waitForTrailers in render-stream source');
        assert.ok(src.indexOf("'wantTrailers'") > -1, 'expected the wantTrailers listener');
        assert.ok(src.indexOf('sendTrailers') > -1, 'expected the sendTrailers call');
        assert.ok(src.indexOf('#H10') > -1, 'expected #H10 marker');
    });

    it('trailer wiring is gated on registered trailers (if (_trailers))', function() {
        var src = fs.readFileSync(RENDER_STREAM, 'utf8');
        assert.ok(/if\s*\(\s*_trailers\s*\)/.test(src), 'expected `if (_trailers)` gate around the trailer path');
    });

    // ── execution: opt-in ──

    it('sets waitForTrailers and sends the registered trailers after the body', async function() {
        var h = makeHttp2TrailerDeps();
        h.deps.local._trailers = { 'grpc-status': '0', 'grpc-message': 'OK' };
        renderStream(from(['payload']), 'application/grpc+proto', h.deps);
        await sleep(50);
        assert.ok(h.respondOpts, 'expected respond() called with an options object');
        assert.strictEqual(h.respondOpts.waitForTrailers, true, 'expected waitForTrailers: true');
        assert.ok(h.ended, 'stream.end() should have been called');
        assert.deepEqual(h.sentTrailers, { 'grpc-status': '0', 'grpc-message': 'OK' });
    });

    // ── execution: opt-out (zero behavioural change) ──

    it('does NOT set waitForTrailers or call sendTrailers when no trailers registered', async function() {
        var h = makeHttp2TrailerDeps();
        // no h.deps.local._trailers set
        renderStream(from(['payload']), 'text/event-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.respondOpts, null, 'respond() should be called with no options object');
        assert.strictEqual(h.sentTrailers, null, 'sendTrailers must not be called without registered trailers');
        assert.ok(h.ended, 'stream.end() still called on the normal path');
    });

    it('ignores a non-object _trailers value (treated as no trailers)', async function() {
        var h = makeHttp2TrailerDeps();
        h.deps.local._trailers = 'nope';
        renderStream(from([]), 'text/event-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.respondOpts, null);
        assert.strictEqual(h.sentTrailers, null);
    });
});


// ─── 11 — released-response guard (#B38) ──────────────────────────────────────

describe('11 - renderStream: released-response guard (#B38)', function() {

    var src;
    before(function() { src = fs.readFileSync(RENDER_STREAM, 'utf8'); });

    // renderStream's controller.js wrapper AND this delegate are BOTH synchronous, so a
    // released response (per-request refs nulled by a terminal exit: redirect/renderTEXT/
    // throwError) made the `local.res.stream` read throw SYNCHRONOUSLY -> uncaughtException
    // -> SIGTERM. The read precedes the headersSent() guard, so the fix checks first.
    // Measured (standalone harness): RELEASE threw `reading 'stream'` pre-fix, no-throw after.

    it('returns early (no throw) when local.res was released by a terminal exit', function() {
        var deps = makeDeps();
        deps.local.res = null;   // terminal-exit released state
        var result;
        assert.doesNotThrow(function() {
            result = renderStream(from([]), 'text/event-stream', deps);
        });
        assert.strictEqual(result, undefined);
    });

    it('guard sits after the isProcessingError check and before the first local.res capture', function() {
        var ipIdx    = src.indexOf('self.isProcessingError');
        var guardIdx = src.indexOf('local.res == null');
        var derefIdx = src.indexOf('var response = local.res;');
        assert.ok(ipIdx > -1 && guardIdx > -1 && derefIdx > -1, 'all three anchors must exist');
        assert.ok(guardIdx > ipIdx,   'guard must follow the isProcessingError check');
        assert.ok(guardIdx < derefIdx, 'guard must precede the `var response = local.res` capture');
    });

    it('subtract: the pre-fix `response.stream` read throws on a released response', function() {
        assert.throws(function() { var response = null; return response.stream; },
            /Cannot read properties of null \(reading 'stream'\)/);
    });
});


// ─── 12 — per-request deps are function-scoped (#B62) ───────────────────────

describe('12 - renderStream: per-request deps are function-scoped (#B62 module-scope race)', function() {

    function stripComments(s) { return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); }

    it('module scope declares no per-request state; deps are captured with `var`', function() {
        var src = fs.readFileSync(RENDER_STREAM, 'utf8');
        var prefix = stripComments(src.substring(0, src.indexOf('module.exports')));
        assert.ok(
            !/var\s+(self|local|headersSent)\b/.test(prefix),
            'a per-request binding is declared at module scope — the _doStream IIFE resumes post-await and would read a concurrent request\'s refs (#B62)'
        );
        ['self', 'local', 'headersSent'].forEach(function(name) {
            assert.match(
                src,
                new RegExp('var\\s+' + name + '\\s*=\\s*deps\\.' + name + '\\s*;'),
                '`var ' + name + ' = deps.' + name + ';` missing — dep no longer function-scoped'
            );
        });
    });

    it('a stream finishing while a second is mid-stream releases its OWN triplet, not the concurrent request\'s (real delegate)', async function() {
        var relA, relB;
        var gateA = new Promise(function(r) { relA = r; });
        var gateB = new Promise(function(r) { relB = r; });
        async function* iterA() { yield 'a'; await gateA; yield 'a2'; }
        async function* iterB() { yield 'b'; await gateB; yield 'b2'; }

        var depsA = makeDeps(), depsB = makeDeps();
        renderStream(iterA(), 'text/plain', depsA); // A suspends mid-stream
        renderStream(iterB(), 'text/plain', depsB); // pre-#B62: module refs now = B's
        await sleep(5);

        relA(); // A finishes while B is STILL streaming
        await sleep(5);
        assert.notStrictEqual(depsB.local.req, null,
            'B\'s triplet was nulled mid-stream by A\'s finally — module-scope capture is back (#B62)');
        assert.strictEqual(depsA.local.req, null,
            'A\'s own triplet must be released when A\'s stream ends');

        relB();
        await sleep(5);
        assert.strictEqual(depsB.local.req, null, 'B\'s triplet must be released at B\'s own end');
    });

    it('a stream error is reported through the request\'s OWN controller (real delegate)', async function() {
        var relC, relD;
        var gateC = new Promise(function(r) { relC = r; });
        var gateD = new Promise(function(r) { relD = r; });
        async function* iterC() { yield 'c'; await gateC; throw new Error('boom'); }
        async function* iterD() { yield 'd'; await gateD; yield 'd2'; }

        var threwOn = [];
        var depsC = makeDeps({}, { throwError: function() { threwOn.push('C'); } });
        var depsD = makeDeps({}, { throwError: function() { threwOn.push('D'); } });
        renderStream(iterC(), 'text/plain', depsC); // C suspends
        renderStream(iterD(), 'text/plain', depsD); // pre-#B62: module self now = D's
        await sleep(5);

        relC(); // C's iterable throws
        await sleep(5);
        assert.deepStrictEqual(threwOn, ['C'],
            'C\'s stream error must be reported through C\'s own throwError, not the concurrent request\'s');

        relD();
        await sleep(5);
    });

    it('subtract: the module-scope shape cross-nulls the concurrent request (pure-logic replica)', async function() {
        // Mirror of the pre-#B62 delegate shape: captures at module-analog scope
        // (shared across calls), a fire-and-forget IIFE whose finally nulls them.
        var modLocal = null;
        function delegate(gate, local) {
            modLocal = local;
            ;(async function _doStream() {
                try { await gate; } finally {
                    modLocal.req = null; modLocal.res = null; modLocal.next = null;
                }
            })();
        }
        var relA2, relB2;
        var gA = new Promise(function(r) { relA2 = r; });
        var gB = new Promise(function(r) { relB2 = r; });
        var localA = { req: 1, res: 1, next: 1 }, localB = { req: 1, res: 1, next: 1 };

        delegate(gA, localA);
        delegate(gB, localB); // modLocal now = B's
        relA2();              // A finishes first
        await sleep(5);
        assert.strictEqual(localB.req, null, 'replica premise: A\'s finally nulls B\'s triplet under module scope');
        assert.strictEqual(localA.req, 1, 'replica premise: A\'s own triplet is never released under module scope');
        relB2();
        await sleep(5);
    });
});


// ─── 10 — status-code preservation (#B351) ───────────────────────────────────

describe('10 - renderStream: status-code preservation (#B351)', function() {

    // Pre-fix, BOTH engines were 200-only: the h2 frame hardcoded `':status': 200`
    // and the h1 arm assigned `response.statusCode = 200` unconditionally inside the
    // !headersSent block, clobbering whatever the caller had chosen. That makes
    // 206/416 (Range) and 404 unreachable through renderStream on either engine.

    function makeH2(statusCode) {
        var responded = null;
        var stream2   = {
            headersSent: false, destroyed: false, closed: false,
            respond: function(h) { responded = h; stream2.headersSent = true; },
            write  : function() {},
            end    : function() {}
        };
        var deps = makeDeps();
        deps.local.res.stream      = stream2;
        deps.local.res.getHeaders  = function() { return {}; };
        deps.local.res.headersSent = false;
        deps.local.res.statusCode  = statusCode;
        return { deps: deps, get responded() { return responded; } };
    }

    // NOTE: renderStream nulls local.req/res/next on every exit path (suite 09), so
    // the res object must be captured BEFORE the call — reading deps.local.res after
    // the await is a null deref, not a status assertion. The object itself survives;
    // only the local.* reference is cleared.
    function makeH1(statusCode) {
        var deps = makeDeps();
        var res  = deps.local.res;
        res.statusCode = statusCode;
        res.setHeader  = function() {};
        res.write      = function() {};
        res.end        = function() {};
        return { deps: deps, res: res };
    }

    it('h2: carries a caller-set 206 into the stream.respond() frame', async function() {
        var h = makeH2(206);
        renderStream(from(['a']), 'application/octet-stream', h.deps);
        await sleep(50);
        assert.ok(h.responded, 'stream.respond() should have been called');
        assert.strictEqual(h.responded[':status'], 206);
    });

    it('h2: carries a caller-set 404 into the stream.respond() frame', async function() {
        var h = makeH2(404);
        renderStream(from([]), 'application/octet-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.responded[':status'], 404);
    });

    it('h2: falls back to 200 when the caller left no status', async function() {
        var h = makeH2(undefined);
        renderStream(from([]), 'text/event-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.responded[':status'], 200);
    });

    it('h1: preserves a caller-set 206 rather than clobbering it with 200', async function() {
        var h = makeH1(206);
        renderStream(from(['a']), 'application/octet-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.res.statusCode, 206);
    });

    it('h1: preserves a caller-set 404 rather than clobbering it with 200', async function() {
        var h = makeH1(404);
        renderStream(from([]), 'application/octet-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.res.statusCode, 404);
    });

    it('h1: falls back to 200 when the caller left no status', async function() {
        var h = makeH1(undefined);
        renderStream(from([]), 'text/event-stream', h.deps);
        await sleep(50);
        assert.strictEqual(h.res.statusCode, 200);
    });
});
