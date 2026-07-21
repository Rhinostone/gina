'use strict';
/**
 * server.js — #B143 multipart multi-file resume hang regression tests
 *
 * The defect: the per-writeStream 'finish' listeners — the ONLY path to
 * resumeAfterMultipart() for a with-files request — were attached inside
 * busboy.on('finish'), i.e. only after the WHOLE body was parsed. Node never
 * replays 'finish' for a late listener, and an early small part's write
 * stream finishes in ~ms while a later large part can stream for seconds:
 * that stream's decrement never ran, the count never reached 0, and the
 * request hung forever — no log line, only a client/front-proxy timeout
 * (measured live: a throttled two-file upload hung deterministically; the
 * race also fired unthrottled ~1 in 13). Unauthenticated (the multipart
 * parse precedes routing + middleware), both engines, single-file unaffected.
 *
 * The fix: arm each write stream's 'finish' AND 'error' listeners AT
 * CREATION in the 'file' handler, count with `pending` (++ at creation,
 * -- in each close callback) plus a `busboyDone` flag set in
 * busboy.on('finish'), and resume when busboyDone && pending === 0 —
 * whichever event lands last. The error side also closes the historical
 * unhandled-write-error window (ENOENT/EIO during streaming used to be an
 * uncaughtException → SIGTERM bundle kill, since no listener existed until
 * parse end). An errored stream never emits 'finish', so it never
 * decrements: the request stays terminal at the guarded 500.
 *
 * Strategy: source pins on comment-stripped ACTIVE source (each
 * discriminator red-first-validated against the pre-fix blob) + a REAL
 * no-replay proof on a real Writable (with a can-fail early-listener
 * control) + a pure-logic dispatch replica making the race deterministic
 * (the #B142 held-completion pattern) with a frozen pre-fix subtract + a
 * REAL @rhinostone/busboy paced two-part drive where the early sink
 * provably finishes before parse end (completion-gated feed, no
 * wall-clock). server.js is server-side only — no dist pins.
 *
 * Suites:
 *  01 — source pins: creation-time arming, the busboyDone && pending === 0
 *       gate, the flag-then-zero-pending finish branch, loop-gone negatives
 *  02 — no-replay proof: a real Writable's 'finish' never replays for a
 *       late listener (early-listener control fires)
 *  03 — dispatch replica: early-finisher race resumes exactly once
 *       post-fix; frozen pre-fix subtract NEVER resumes (the hang);
 *       error semantics (no decrement, single guarded 500)
 *  04 — REAL busboy paced drive: early sink finishes before parse end
 *       (asserted), post-fix choreography resumes once, pre-fix replica
 *       choreography never resumes
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var stream = require('stream');

var FW         = require('../fw');
var SERVER_SRC = path.join(FW, 'core/server.js');
var Busboy     = require('@rhinostone/busboy');

// Strip full-line `//` comments so negative pins do not trip on commented-out
// lines (jsdoc.md: "a negative source-inspection pin trips on the file's own
// comment").
function stripLineComments(src) {
    return src.split('\n').filter(function(l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// ─── 01 — #B143 source pins ───────────────────────────────────────────────────
describe('01 - #B143 source pins (comment-stripped)', function() {
    var active;
    before(function() { active = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8')); });

    it('pending + busboyDone are declared with the multipart locals', function() {
        assert.match(active, /,\s*pending\s+= 0\b/);
        assert.match(active, /,\s*busboyDone\s+= false;/);
    });

    it('the write stream is armed at creation: ++pending right after createWriteStream', function() {
        assert.match(active,
            /writeStreams\[index\] = fs\.createWriteStream\([\s\S]{0,120}?\+\+pending;/);
    });

    it('finish AND error listeners attach inside the file handler, BEFORE busboy.on(finish)', function() {
        var fileIdx    = active.indexOf("busboy.on('file'");
        var errIdx     = active.indexOf("writeStreams[index].on('error'");
        var finIdx     = active.indexOf("writeStreams[index].on('finish'");
        var bbFinIdx   = active.indexOf("busboy.on('finish'");
        assert.ok(fileIdx > 0, "busboy.on('file') present");
        assert.ok(errIdx > fileIdx, 'error listener armed inside the file handler');
        assert.ok(finIdx > fileIdx, 'finish listener armed inside the file handler');
        assert.ok(bbFinIdx > finIdx && bbFinIdx > errIdx,
            'both listeners attach BEFORE the busboy finish handler (creation-time, not parse-end)');
    });

    it('the close callback resumes on busboyDone && pending === 0', function() {
        assert.match(active, /if\s*\(busboyDone && pending === 0\)\s*\{\s*resumeAfterMultipart\(\);/);
    });

    it('busboy.on(finish) sets the flag, then resumes directly when nothing is pending', function() {
        assert.match(active, /busboyDone = true;[\s\S]{0,200}?if\s*\(\s*pending === 0\s*\)\s*\{[\s\S]{0,80}?resumeAfterMultipart\(\);/);
    });

    it('NEGATIVE — the busboy finish block no longer attaches per-stream listeners (the late loop is gone)', function() {
        var from  = active.indexOf("busboy.on('finish'");
        var to    = active.indexOf('request.pipe(busboy)');
        assert.ok(from > 0 && to > from, 'finish block located');
        var block = active.substring(from, to);
        // needles anchored on the historical loop's own shape — the block's
        // opening `busboy.on('finish'` must not collide with the negative.
        assert.equal(block.indexOf("writeStreams[ws].on('finish'"), -1, 'no late finish attach inside the block');
        assert.equal(block.indexOf("writeStreams[ws].on('error'"), -1, 'no late error attach inside the block');
        assert.equal(block.indexOf('for (var ws'), -1, 'the per-stream loop is gone');
    });

    it('NEGATIVE — the snapshot counter (var total = writeStreams.length) is gone', function() {
        assert.equal(active.indexOf('var total = writeStreams.length'), -1);
    });
});

// ─── 02 — no-replay proof (real Writable) ─────────────────────────────────────
// The mechanism the bug rides on: Node emits 'finish' once; a listener
// attached after the emission is NEVER called. The early-listener control
// proves the instrument can fail (a finish that did not fire would fail it).
describe('02 - a Writable finish never replays for a late listener', function() {

    it('early listener fires; a listener attached AFTER finish never does', function(t, done) {
        var ws = new stream.Writable({ write: function(c, e, cb) { cb(); } });
        var early = 0, late = 0;
        ws.on('finish', function() { early++; });          // control: attached pre-end
        ws.end('x');
        ws.on('finish', function() {
            // runs on the real emission — attach the LATE listener strictly after
            setImmediate(function() {
                ws.on('finish', function() { late++; });   // the bug's shape
                setImmediate(function() { setImmediate(function() {
                    try {
                        assert.equal(early, 1, 'control: the early listener must have fired');
                        assert.equal(late, 0, 'a late listener is never replayed');
                        done();
                    } catch (err) { done(err); }
                }); });
            });
        });
    });
});

// ─── 03 — dispatch replica: the race, deterministic ───────────────────────────
// Pure-logic mirror of the shipped dispatch. nEarly = streams whose
// finish+close land BEFORE busboy's 'finish' (the ordering the attach-late
// loop lost). The replica executes the orderings synchronously — the race is
// an event-ORDER bug, not a parallelism bug, so ordering coverage is the
// certification.
describe('03 - resume dispatch replica: early-finisher race', function() {

    // post-fix: mirrors the creation-time arming + the flag-gated resume.
    function runFixed(nStreams, nEarly, resume) {
        var pending = 0, busboyDone = false;
        var lateClosers = [];
        for (var i = 0; i < nStreams; i++) {
            ++pending;                                     // armed at creation
            var onClose = function() {
                --pending;
                if (busboyDone && pending === 0) { resume(); }
            };
            if (i < nEarly) { onClose(); } else { lateClosers.push(onClose); }
        }
        busboyDone = true;                                 // busboy.on('finish')
        if (pending === 0) { resume(); }
        for (var j = 0; j < lateClosers.length; j++) { lateClosers[j](); }
    }

    // frozen pre-fix: listeners attached only at busboy-finish. An early
    // finisher's event already fired and never replays (proven in §02), so
    // its decrement is LOST — modeled by skipping it.
    function runPreFix(nStreams, nEarly, resume) {
        var total = nStreams;
        if (total === 0) { resume(); return; }             // the #B93 zero-branch
        for (var i = 0; i < nStreams; i++) {
            if (i < nEarly) { continue; }                  // finish pre-attach: lost
            --total; if (total === 0) { resume(); }
        }
    }

    it('THE RACE — early small file + late big file resumes exactly once post-fix', function() {
        var n = 0; runFixed(2, 1, function() { n++; });
        assert.equal(n, 1);
    });

    it('SUBTRACT — the pre-fix shape NEVER resumes on the same ordering (the hang)', function() {
        var n = 0; runPreFix(2, 1, function() { n++; });
        assert.equal(n, 0);
    });

    it('all orderings resume exactly once post-fix (0-early, all-early, many-mixed)', function() {
        [[2, 0], [2, 2], [3, 0], [3, 3], [5, 2], [1, 0], [1, 1], [0, 0]].forEach(function(c) {
            var n = 0; runFixed(c[0], c[1], function() { n++; });
            assert.equal(n, 1, c[0] + ' streams / ' + c[1] + ' early must resume exactly once');
        });
    });

    it('pre-fix only hung when at least one stream finished early (single-file was safe)', function() {
        var n1 = 0; runPreFix(1, 0, function() { n1++; });
        assert.equal(n1, 1, 'single file, no early finisher: resumed (why consumers never saw it)');
        var n2 = 0; runPreFix(2, 0, function() { n2++; });
        assert.equal(n2, 1, 'all-late ordering resumed even pre-fix');
    });

    it('an errored stream never decrements: no resume after the guarded 500 (terminal semantics preserved)', function() {
        // mirror: error → respond once (guarded) → no decrement; the healthy
        // sibling drains but pending stays > 0 → resume never fires.
        var pending = 0, busboyDone = false, resumes = 0, codes = [];
        var state = { headersSent: false, handled: false };
        function respond500() {
            if (!state.headersSent && !state.handled) { state.handled = true; codes.push(500); }
        }
        ++pending;                                         // stream A (will error)
        ++pending;                                         // stream B (healthy)
        respond500();                                      // A errors mid-stream
        respond500();                                      // a second error stays guarded
        busboyDone = true;
        if (pending === 0) { resumes++; }
        --pending; if (busboyDone && pending === 0) { resumes++; }  // B closes
        assert.deepEqual(codes, [500], 'exactly one 500');
        assert.equal(resumes, 0, 'no resume after a write error — terminal at the 500');
        assert.equal(pending, 1, 'the errored stream never drained');
    });
});

// ─── 04 — REAL busboy paced two-part drive ────────────────────────────────────
// Real @rhinostone/busboy parses a two-file body fed in stages: part 1 is
// written, then the feed WAITS (completion-gated on the first sink's real
// 'finish' — no wall-clock) before sending part 2's tail. That guarantees the
// early sink finished before busboy's 'finish' — the exact ordering the
// attach-late choreography lost. Both choreographies run against this real
// event sequence: the shipped shape resumes once, the pre-fix replica never.
describe('04 - REAL busboy paced drive (early sink finishes before parse end)', function() {
    var B  = '----b143';
    var CT = 'multipart/form-data; boundary=' + B;

    function drivePaced(choreography, cb) {
        var bb = Busboy({ headers: { 'content-type': CT }, defParamCharset: 'utf8' });
        var sinks = [], resumes = 0, firstSinkFinishedBeforeParseEnd = false;
        var pending = 0, busboyDone = false;
        function resume() { resumes++; }

        bb.on('file', function(name, file) {
            var ws = new stream.Writable({ write: function(c, e, cb2) { cb2(); } });
            sinks.push(ws);
            if (choreography === 'fixed') {
                ++pending;                                 // armed at creation
                ws.on('finish', function() {
                    --pending;
                    if (busboyDone && pending === 0) { resume(); }
                });
            }
            file.pipe(ws);
        });

        bb.on('finish', function() {
            firstSinkFinishedBeforeParseEnd = sinks.length > 0 && sinks[0].writableFinished;
            if (choreography === 'fixed') {
                busboyDone = true;
                if (pending === 0) { resume(); }
            } else {
                // pre-fix replica: attach NOW — too late for the early sink.
                var total = sinks.length;
                if (total === 0) { resume(); return; }
                sinks.forEach(function(ws) {
                    ws.on('finish', function() { --total; if (total === 0) { resume(); } });
                });
            }
        });

        // settle: everything is completion-driven — wait for busboy's finish
        // AND both sinks' real finishes, then two macro-ticks for callbacks.
        var seen = { bb: false, s0: false, s1: false };
        function maybeReport() {
            if (!(seen.bb && seen.s0 && seen.s1)) { return; }
            setImmediate(function() { setImmediate(function() {
                cb({ resumes: resumes, earlyProven: firstSinkFinishedBeforeParseEnd });
            }); });
        }
        bb.on('finish', function() { seen.bb = true; maybeReport(); });

        // paced feed
        var part1 = '--' + B + '\r\nContent-Disposition: form-data; name="a"; filename="s.bin"\r\n' +
                    'Content-Type: application/octet-stream\r\n\r\nAAAA\r\n';
        var part2head = '--' + B + '\r\nContent-Disposition: form-data; name="b"; filename="big.bin"\r\n' +
                    'Content-Type: application/octet-stream\r\n\r\n';
        var tail  = '\r\n--' + B + '--\r\n';

        bb.write(part1 + part2head);                       // ends part 1's source stream
        // completion-gate: wait for sink 0's REAL finish before ending the body,
        // so busboy's 'finish' provably lands after it.
        (function waitSink0() {
            if (sinks[0] && sinks[0].writableFinished) {
                seen.s0 = true;
                bb.end('BBBBBBBB' + tail);
                // sink 1 finishes after busboy closes part 2
                (function waitSink1() {
                    if (sinks[1] && sinks[1].writableFinished) { seen.s1 = true; maybeReport(); return; }
                    setImmediate(waitSink1);
                })();
                maybeReport();
                return;
            }
            setImmediate(waitSink0);
        })();
    }

    it('post-fix choreography resumes exactly once (early sink proven finished before parse end)', function(t, done) {
        drivePaced('fixed', function(r) {
            try {
                assert.equal(r.earlyProven, true,
                    'instrument control: the first sink must have finished BEFORE busboy finish');
                assert.equal(r.resumes, 1, 'the request resumes exactly once');
                done();
            } catch (e) { done(e); }
        });
    });

    it('SUBTRACT — the pre-fix attach-late choreography NEVER resumes on the same real ordering (the hang)', function(t, done) {
        drivePaced('prefix', function(r) {
            try {
                assert.equal(r.earlyProven, true,
                    'instrument control: the first sink must have finished BEFORE busboy finish');
                assert.equal(r.resumes, 0, 'the late-attached listener misses the early finish — no resume, ever');
                done();
            } catch (e) { done(e); }
        });
    });
});
