'use strict';
/**
 * server.js — #B142 req.files[].size race regression tests
 *
 * The defect: the per-file byte counter is incremented inside the liner
 * Transform (one pipe hop downstream of the busboy part stream), but the
 * request.files record was built — final — at the SOURCE stream's 'end'.
 * When 'end' fires, the liner can still hold queued chunks the counter has
 * not seen (objectMode transform: 16-OBJECT high-water marks), so the
 * reported size under-counted by a varying number of whole chunks while the
 * bytes on disk stayed perfect (measured live: a 1.5MB upload reported ~25%
 * short on every run; the shortfall varies with chunk timing).
 *
 * The fix: the record is captured in a per-part closure var (fileRecord) and
 * a live liner._flush finalizes `size` once the LAST _transform has counted.
 * _flush completes strictly before the write stream can emit 'finish', and
 * the request only resumes after every write stream finished — so the
 * patched value is final before any consumer reads request.files. The push
 * stays at the source's 'end' (busboy emits parts sequentially → part order
 * preserved; flush completion order can invert across parts).
 *
 * Strategy: source pins on comment-stripped ACTIVE source + a behavioral
 * choreography replica that executes the EXTRACTED live _transform and
 * _flush bytes (control-gated extraction, no hand replica to drift) through
 * the real pipeline shape — a stalled sink makes the race deterministic —
 * plus a frozen pre-fix subtract (read-at-'end', never patched) proving the
 * rig detects the bug. All settles are completion-driven (sink 'finish'),
 * never wall-clock. server.js is server-side only — no dist pins.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var stream = require('stream');

var SOURCE = path.join(require('../fw'), 'core/server.js');

/** Full-line comment strip — keeps inline code, drops `// was:` blocks. */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}


// ─── 01 — source pins: record capture + live _flush finalization ─────────────

describe('01 - #B142 source pins (comment-stripped)', function () {

    var src, active;

    before(function () {
        src    = fs.readFileSync(SOURCE, 'utf8');
        active = stripComments(src);
    });

    it('a per-part fileRecord var is declared next to the byte counter init', function () {
        var initIdx = active.indexOf('file._dataLen = 0;');
        var varIdx  = active.indexOf('var fileRecord;');
        assert.ok(initIdx > -1, 'counter init present');
        assert.ok(varIdx > initIdx, 'var fileRecord declared after the counter init');
    });

    it('the push routes through the captured record — the bare literal push is gone', function () {
        assert.ok(active.indexOf('request.files.push(fileRecord)') > -1,
            'request.files.push(fileRecord) present');
        assert.equal(active.indexOf('request.files.push({'), -1,
            'no direct object-literal push remains (whole-file)');
    });

    it('exactly one LIVE liner._flush, and it finalizes size from the byte counter', function () {
        var all = active.match(/liner\._flush = function \(done\) \{/g) || [];
        assert.equal(all.length, 1, 'exactly one live liner._flush assignment expected');
        assert.ok(active.indexOf('fileRecord.size = file._dataLen') > -1,
            '_flush must patch fileRecord.size from file._dataLen');
    });

    it('_flush guards the not-yet-captured record (settled-pipeline interleaving)', function () {
        var fIdx = active.indexOf('liner._flush = function (done) {');
        var blk  = active.slice(fIdx, active.indexOf('};', fIdx) + 2);
        assert.match(blk, /if \(\s*fileRecord\s*\)/,
            '_flush must no-op when the source-end capture has not run yet');
    });

    it('_flush is assigned AFTER the pipe call (sibling-suite extraction stays stable)', function () {
        var pipeIdx  = active.indexOf('file.pipe(liner)');
        var flushIdx = active.indexOf('liner._flush = function');
        assert.ok(pipeIdx > -1 && flushIdx > pipeIdx,
            'liner._flush must sit below file.pipe(liner) — the #B103 suite slices the _transform block up to the pipe');
    });

    it('the provisional push still reads the live counter (size: this._dataLen)', function () {
        assert.ok(active.indexOf('size: this._dataLen') > -1,
            'the record captures the provisional count at source-end');
    });

});


// ─── 02 — extraction (control-gated): the live _transform + _flush bytes ─────

var active2, linerFn, flushFn;

function extractAll() {
    var src = fs.readFileSync(SOURCE, 'utf8');
    active2 = stripComments(src);
    // _transform — same structural anchors as upload-binary-integrity.test.js
    var lIdx = active2.indexOf('liner._transform = function');
    var lEnd = active2.indexOf('file.pipe(liner)', lIdx);
    linerFn = null;
    if (lIdx > -1 && lEnd > lIdx) {
        var blk = active2.slice(lIdx, lEnd);
        linerFn = blk.slice(blk.indexOf('function'), blk.lastIndexOf('}') + 1);
    }
    // _flush — non-greedy to its own terminating `};` (no inner `};` in the body)
    var fm = active2.match(/liner\._flush = function \(done\) \{[\s\S]*?\n\s*\};/);
    flushFn = null;
    if (fm) {
        flushFn = fm[0].slice(fm[0].indexOf('function'), fm[0].lastIndexOf('}') + 1);
    }
}

describe('02 - #B142 extraction controls', function () {

    before(extractAll);

    it('_transform extract: locatable and parses', function () {
        assert.ok(linerFn && linerFn.indexOf('function (chunk, encoding, done)') === 0,
            '_transform extract must start at the signature');
        assert.doesNotThrow(function () { new Function('file', 'return (' + linerFn + ');'); });
    });

    it('_flush extract: exactly one match, starts at the signature, parses', function () {
        var all = active2.match(/liner\._flush = function \(done\) \{/g) || [];
        assert.equal(all.length, 1, 'extraction fires on exactly one live _flush');
        assert.ok(flushFn && flushFn.indexOf('function (done)') === 0,
            '_flush extract must start at the signature');
        // sloppy-mode Function so the with-scope live-closure emulation in §03
        // can execute these exact bytes
        assert.doesNotThrow(function () { new Function('scope', 'with (scope) { return (' + flushFn + '); }'); });
    });

});


// ─── 03 — behavioral: the pipeline choreography, extracted bytes ─────────────

// The shipped construction line (server.js): objectMode Transform.
function makeLiner() { return new require('stream').Transform({objectMode: true}); }

/**
 * A sink whose _write callbacks are HELD until release() — makes the race
 * deterministic: chunks queue in the liner while the source drains and
 * emits 'end'. release() pumps via setImmediate recursion (no timers).
 */
function makeStalledSink(collect) {
    var held = [];
    var sink = new stream.Writable({
        write: function (chunk, enc, cb) { collect.push(chunk); held.push(cb); }
    });
    sink.release = function () {
        (function pump() {
            if (held.length === 0) return;
            held.shift()();
            setImmediate(pump);
        })();
    };
    return sink;
}

/**
 * Build the shipped pipeline shape wired with the EXTRACTED live bytes.
 * The with-scope gives the extracted functions a live `file` / `fileRecord`
 * resolution mirroring the real closure (fileRecord is assigned later by the
 * 'end' handler, exactly as in the source).
 */
function makeRig(sink, onFinish) {
    var file  = new stream.PassThrough();
    var liner = makeLiner();
    file._dataLen = 0;

    var scope = { file: file, fileRecord: undefined };
    var state = { snapshotAtEnd: -1, files: [] };

    liner._transform = new Function('file', 'return (' + linerFn + ');')(file);
    file.pipe(liner).pipe(sink);
    liner._flush = new Function('scope', 'with (scope) { return (' + flushFn + '); }')(scope);

    file.on('end', function () {
        state.snapshotAtEnd = file._dataLen;                  // the PRE-fix read point
        scope.fileRecord = { size: file._dataLen };           // the shipped capture shape
        state.files.push(scope.fileRecord);
        if (sink.release) sink.release();                     // structural, not wall-clock
    });

    sink.on('finish', function () { onFinish(state, scope); });
    return { file: file };
}

describe('03 - #B142 behavioral choreography (extracted live bytes)', function () {

    before(extractAll);

    var CHUNK = Buffer.alloc(16384, 0xAB);

    it('stalled sink: provisional read is SHORT, _flush-patched size is exact, bytes intact', function (t, doneCb) {
        var N = 30, TOTAL = N * CHUNK.length;
        var collected = [];
        var rig = makeRig(makeStalledSink(collected), function (state) {
            try {
                // the race is visible at the pre-fix read point (control that CAN fail:
                // a fast rig would read equal here — the stall guarantees the queue)
                assert.ok(state.snapshotAtEnd > 0 && state.snapshotAtEnd < TOTAL,
                    'provisional read must under-count (got ' + state.snapshotAtEnd + '/' + TOTAL + ')');
                // the fix: _flush patched the pushed record to the exact byte size
                assert.equal(state.files.length, 1);
                assert.equal(state.files[0].size, TOTAL,
                    'record.size must be finalized to the exact byte count');
                // #B103 invariant carried: bytes reach the sink verbatim
                assert.ok(Buffer.concat(collected).equals(Buffer.concat(new Array(N).fill(CHUNK))),
                    'sink must receive every byte unmodified');
                doneCb();
            } catch (e) { doneCb(e); }
        });
        for (var i = 0; i < N; i++) rig.file.write(CHUNK);
        rig.file.end();
    });

    it('settled sink: final size exact under whichever end/_flush interleaving occurs', function (t, doneCb) {
        var collected = [];
        var sink = new stream.Writable({
            write: function (chunk, enc, cb) { collected.push(chunk); cb(); }
        });
        var rig = makeRig(sink, function (state) {
            try {
                assert.equal(state.files.length, 1);
                assert.equal(state.files[0].size, CHUNK.length,
                    'settled pipeline must also finalize the exact size');
                doneCb();
            } catch (e) { doneCb(e); }
        });
        rig.file.write(CHUNK);
        setImmediate(function () { setImmediate(function () { rig.file.end(); }); });
    });

    it('SUBTRACT — the pre-fix shape (no _flush patch) ships the short provisional value', function (t, doneCb) {
        // Frozen pre-#B142 behavior: the record's size is whatever the source-'end'
        // read captured; nothing ever patches it. Same rig, flush left DEFAULT.
        var N = 30, TOTAL = N * CHUNK.length;
        var collected = [];
        var file  = new stream.PassThrough();
        var liner = makeLiner();
        file._dataLen = 0;
        var files = [];
        liner._transform = new Function('file', 'return (' + linerFn + ');')(file);
        var sink = makeStalledSink(collected);
        file.pipe(liner).pipe(sink);
        file.on('end', function () {
            files.push({ size: file._dataLen });              // pre-fix: pushed final, never patched
            sink.release();
        });
        sink.on('finish', function () {
            try {
                assert.ok(files[0].size < TOTAL,
                    'pre-fix read must under-count on a stalled pipeline (got ' + files[0].size + '/' + TOTAL + ')');
                doneCb();
            } catch (e) { doneCb(e); }
        });
        for (var i = 0; i < N; i++) file.write(CHUNK);
        file.end();
    });

});
