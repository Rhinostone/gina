'use strict';
/**
 * Multipart requests with no successfully-parsed file part now reach a terminal
 * state — #B93 (fields-only body → hang) + #B97 (malformed body → uncaughtException
 * → SIGTERM bundle-kill).
 *
 * Root: core/server.js's multipart branch drove the request-lifecycle continuation
 * ONLY from inside the per-writeStream finish loop, and had NO busboy.on('error')
 * handler. So:
 *   - a well-formed FIELDS-ONLY body (busboy emits 'finish', zero write streams) ran
 *     the finish loop zero times → the continuation never fired → the request hung
 *     until a front-proxy timeout (unauthenticated, no log line).
 *   - a MALFORMED / empty / non-multipart body (busboy emits 'error', never 'finish')
 *     surfaced as an uncaughtException → proc.js SIGTERM → single-request bundle kill.
 *
 * Fix: extract the continuation into resumeAfterMultipart(), call it from a
 * zero-writeStreams branch in busboy.on('finish') (#B93), and add busboy.on('error')
 * → HTTP 400 with a double-response guard (#B97). Non-file fields stayed dropped when
 * these shipped; #B92-adjacent has since added the field capture (its own test file).
 *
 * Strategy: source inspection (mirrors upload-config.test.js) + a REAL vendored-busboy
 * behavioural test (the load-bearing finish-vs-error discrimination the fix shape
 * depends on) + pure-logic dispatch replicas with subtract controls. No live HTTP
 * server / framework bootstrap. Server-side only — no dist rebuild.
 *
 * Suites:
 *  01 — #B93 server.js source: resumeAfterMultipart extraction + zero-pending branch
 *       (re-gated by #B143: creation-time listeners, busboyDone && pending === 0)
 *  02 — #B97 server.js source: busboy.on('error') → 400, double-response guard, registered pre-pipe
 *  03 — behavioural (REAL vendored busboy): fields-only→finish, malformed/empty→error, file→finish
 *  04 — resume dispatch replica (#B93 + #B143 gating): all orderings resume exactly once
 *       (+ subtract: pre-#B93 fields-only never resumed). The #B143 early-finisher
 *       RACE has its own file: multipart-multifile-resume.test.js.
 *  05 — #B97 dispatch replica: error handler responds 400 once, guarded against double-response
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var { Readable } = require('stream');

var FW         = require('../fw');
var SERVER_SRC = path.join(FW, 'core/server.js');
var Busboy     = require('@rhinostone/busboy');

// Strip full-line `//` comments so negative pins do not trip on commented-out lines
// (jsdoc.md: "a negative source-inspection pin trips on the file's own comment").
function stripLineComments(src) {
    return src.split('\n').filter(function(l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// ─── 01 — #B93 server.js source pins ──────────────────────────────────────────
describe('01 - multipart fields-only hang: server.js source pins (#B93)', function() {
    var active;
    before(function() { active = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8')); });

    it('the lifecycle continuation is extracted into resumeAfterMultipart()', function() {
        assert.match(active, /var resumeAfterMultipart\s*=\s*function/);
    });

    it('resumeAfterMultipart wraps the loadBundleConfiguration -> handle continuation', function() {
        assert.match(active, /var resumeAfterMultipart\s*=\s*function[\s\S]{0,220}?loadBundleConfiguration\(request, response, next/);
    });

    it('a zero-pending branch in busboy.on(finish) resumes directly (#B93, re-gated by #B143)', function() {
        // for a fields-only body no write stream is ever created, so pending
        // stays 0 at parse end; since #B143 the same branch also covers a body
        // whose every write stream already finished+closed during the parse.
        assert.match(active, /busboyDone = true;[\s\S]{0,200}?if\s*\(\s*pending === 0\s*\)\s*\{[\s\S]{0,80}?resumeAfterMultipart\(\);/);
    });

    it('the continuation is invoked from exactly the two dispatch sites (empty branch + has-files completion)', function() {
        // `resumeAfterMultipart();` (call w/ semicolon) matches only the 2 calls,
        // not the definition `function resumeAfterMultipart() {`.
        var calls = active.match(/resumeAfterMultipart\(\);/g) || [];
        assert.equal(calls.length, 2);
    });

    it('the has-files completion (creation-time close callback) gates on busboyDone && pending === 0 (#B143)', function() {
        assert.match(active, /if\s*\(busboyDone && pending === 0\)\s*\{\s*resumeAfterMultipart\(\);/);
    });
});

// ─── 02 — #B97 server.js source pins ──────────────────────────────────────────
describe('02 - malformed multipart crash: server.js source pins (#B97)', function() {
    var active;
    before(function() { active = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8')); });

    it('a busboy.on(error) handler now exists', function() {
        assert.match(active, /busboy\.on\('error',\s*function onBusboyError/);
    });

    it('the error handler answers HTTP 400 for a malformed multipart body', function() {
        assert.match(active, /throwError\(response,\s*400,\s*'Malformed multipart\/form-data request',\s*next\)/);
    });

    it('the 400 response is guarded against a double-response', function() {
        assert.match(active, /if\s*\(\s*!response\.headersSent\s*&&\s*!request\.handled\s*\)/);
    });

    it('the error handler is registered BEFORE request.pipe(busboy)', function() {
        var errIdx  = active.indexOf("busboy.on('error', function onBusboyError");
        var pipeIdx = active.indexOf('request.pipe(busboy)');
        assert.ok(errIdx > 0, 'onBusboyError present');
        assert.ok(pipeIdx > 0, 'request.pipe(busboy) present');
        assert.ok(errIdx < pipeIdx, 'error handler registered before the pipe');
    });
});

// ─── 03 — behavioural: REAL vendored busboy event discrimination ──────────────
// The fix shape depends on busboy emitting 'finish' for a well-formed fields-only
// body (→ zero-writeStreams branch) but 'error' for a malformed one (→ error
// handler). No 'field' listener is attached here — the finish-vs-error
// discrimination is listener-independent (gina itself attaches one since the
// #B92-adjacent field capture).
describe('03 - vendored busboy event discrimination (behavioural)', function() {
    var CT = 'multipart/form-data; boundary=----t';
    var B  = '----t';

    function drive(body, cb) {
        var seen = { file: 0, finish: false, error: null };
        var bb = Busboy({ headers: { 'content-type': CT }, defParamCharset: 'utf8' });
        bb.on('file', function(n, s) { seen.file++; s.resume(); });
        // deliberately NO field listener (the discrimination is listener-independent)
        bb.on('finish', function() { seen.finish = true; });
        bb.on('error', function(e) { seen.error = (e && e.message) || String(e); });
        Readable.from([Buffer.from(body)]).pipe(bb);
        setTimeout(function() { cb(seen); }, 200);
    }

    it('well-formed FIELDS-ONLY body → finish (no file, no error) — #B93 path', function(t, done) {
        drive('--' + B + '\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n--' + B + '--\r\n', function(seen) {
            assert.equal(seen.file, 0);
            assert.equal(seen.finish, true);
            assert.equal(seen.error, null);
            done();
        });
    });

    it('MALFORMED body (no terminating boundary) → error (never finish) — #B97 path', function(t, done) {
        drive('--' + B + '\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n', function(seen) {
            assert.equal(seen.finish, false);
            assert.ok(seen.error, 'busboy emits an error for a malformed body');
            done();
        });
    });

    it('EMPTY body → error (never finish) — #B97 path', function(t, done) {
        drive('', function(seen) {
            assert.equal(seen.finish, false);
            assert.ok(seen.error, 'busboy emits an error for an empty body');
            done();
        });
    });

    it('a FILE part → finish (the working path is unchanged)', function(t, done) {
        drive('--' + B + '\r\nContent-Disposition: form-data; name="f"; filename="x.txt"\r\n' +
              'Content-Type: text/plain\r\n\r\nhello\r\n--' + B + '--\r\n', function(seen) {
            assert.equal(seen.file, 1);
            assert.equal(seen.finish, true);
            assert.equal(seen.error, null);
            done();
        });
    });
});

// ─── 04 — resume dispatch replica (#B93, re-gated by #B143) ───────────────────
describe('04 - resume dispatch replica (#B93 + #B143 gating)', function() {

    // post-fix: mirrors the LIVE dispatch — each stream's close callback is
    // armed at stream creation (++pending), decrements, and resumes only when
    // busboyDone && pending === 0; busboy.on('finish') sets the flag and
    // resumes directly when nothing is pending (zero file parts, or every
    // stream already finished+closed during the parse). nEarly = streams whose
    // finish+close land BEFORE busboy's 'finish' (the ordering the historical
    // attach-late loop lost — the #B143 race lives in its own test file).
    function runDispatch(nStreams, nEarly, resume) {
        var pending = 0, busboyDone = false;
        var lateClosers = [];
        for (var i = 0; i < nStreams; i++) {
            ++pending;                                       // armed at creation
            var onClose = function() {
                --pending;
                if (busboyDone && pending === 0) { resume(); }
            };
            if (i < nEarly) { onClose(); } else { lateClosers.push(onClose); }
        }
        busboyDone = true;                                   // busboy.on('finish')
        if (pending === 0) { resume(); }
        for (var j = 0; j < lateClosers.length; j++) { lateClosers[j](); }
    }
    // frozen pre-#B93: continuation lived ONLY inside the per-stream finish
    // loop (no zero-branch) — the fields-only hang this file was written for.
    function onFinishPreB93(nStreams, resume) {
        var total = nStreams;
        for (var i = 0; i < nStreams; i++) { --total; if (total === 0) { resume(); } }
    }

    it('post-fix: fields-only (0 write streams) resumes exactly once', function() {
        var n = 0; runDispatch(0, 0, function() { n++; });
        assert.equal(n, 1);
    });

    it('post-fix: has-files, all streams close after parse end — resumes exactly once', function() {
        var n = 0; runDispatch(3, 0, function() { n++; });
        assert.equal(n, 1);
    });

    it('post-fix: has-files, ALL streams closed before parse end — resumes exactly once (#B143 all-early terminal)', function() {
        var n = 0; runDispatch(2, 2, function() { n++; });
        assert.equal(n, 1);
    });

    it('SUBTRACT — pre-#B93: fields-only (0 write streams) NEVER resumed (the hang)', function() {
        var n = 0; onFinishPreB93(0, function() { n++; });
        assert.equal(n, 0);
    });

    it('SUBTRACT — pre-#B93: has-files still resumed (only the empty case was broken)', function() {
        var n = 0; onFinishPreB93(2, function() { n++; });
        assert.equal(n, 1);
    });
});

// ─── 05 — #B97 error-handler dispatch replica (+ guard) ───────────────────────
describe('05 - error-handler dispatch replica (#B97)', function() {

    // mirrors busboy.on('error') → guarded 400 response.
    function onBusboyError(state, respond) {
        if (!state.headersSent && !state.handled) {
            state.handled = true;
            respond(400);
        }
    }

    it('a malformed body gets a single 400 response', function() {
        var codes = []; var st = { headersSent: false, handled: false };
        onBusboyError(st, function(c) { codes.push(c); });
        assert.deepEqual(codes, [400]);
        assert.equal(st.handled, true);
    });

    it('does not double-respond when a write stream already sent headers', function() {
        var codes = []; var st = { headersSent: true, handled: false };
        onBusboyError(st, function(c) { codes.push(c); });
        assert.deepEqual(codes, []);
    });

    it('does not double-respond when the request was already handled', function() {
        var codes = []; var st = { headersSent: false, handled: true };
        onBusboyError(st, function(c) { codes.push(c); });
        assert.deepEqual(codes, []);
    });
});
