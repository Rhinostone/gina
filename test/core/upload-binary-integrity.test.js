'use strict';
/**
 * server.js — #B103 multipart binary-upload integrity regression tests
 *
 * The defect had TWO layers, both string-decoding a binary stream:
 *   layer 1 — the request prologue called setEncoding unconditionally, so a
 *             multipart body reached busboy utf8-decoded (invalid sequences
 *             already replaced) and re-encoded ~1.5-2x larger;
 *   layer 2 — the liner Transform round-tripped every chunk through a string
 *             and truncated each UTF-16 code unit mod 256 before writing.
 * Pure-ASCII payloads survive both layers byte-identical, which is what hid
 * the corruption. The fix: compute request.isMultipart once, gate the decode
 * on it (multipart stays RAW for busboy), and make the liner pass Buffers
 * through verbatim while counting bytes.
 *
 * Strategy: source inspection on comment-stripped ACTIVE source (the
 * replace-code convention keeps the old lines as comments, which would
 * otherwise satisfy/trip pins) + behavioral replicas with subtract controls
 * (the frozen pre-fix bodies must corrupt; the extracted live body must be
 * byte-identical). No live server required.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var SOURCE = path.join(require('../fw'), 'core/server.js');

/** Full-line comment strip — keeps inline code, drops `// was:` blocks. */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// Deterministic fixtures — every byte value + multipart-looking CRLF noise.
var FULL_CYCLE = Buffer.from(Array.from({ length: 256 }, function (_, i) { return i; }));
var BINARY_FIXTURE = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG magic
    FULL_CYCLE, FULL_CYCLE, FULL_CYCLE,
    Buffer.from('\r\n--------------------------deadbeefdeadbeef\r\n'),
    // VALID multi-byte utf8 — decodes 2 bytes → 1 char, so the fixture's
    // decoded char count provably differs from its byte length (the
    // _dataLen bytes-vs-chars distinction needs it; lone invalid bytes
    // decode 1:1 to U+FFFD and would mask it)
    Buffer.from('héllo ✓ übergroß — çà et là', 'utf8'),
    Buffer.from(Array.from({ length: 256 }, function (_, i) { return 255 - i; }))
]);
var ASCII_FIXTURE = Buffer.from('The quick brown fox 0123456789\r\n'.repeat(64));


// ─── 01 — source pins: the decode gate + the raw-passthrough liner ───────────

describe('01 - #B103 source pins (comment-stripped)', function () {

    var src, active;

    before(function () {
        src    = fs.readFileSync(SOURCE, 'utf8');
        active = stripComments(src);
    });

    it('exactly ONE live setEncoding call, gated on !request.isMultipart', function () {
        var count = (active.match(/request\.setEncoding\(/g) || []).length;
        assert.equal(count, 1, 'server.js must carry exactly one live request.setEncoding call');
        assert.match(
            active,
            /if \( !request\.isMultipart \) \{\s*\n\s*request\.setEncoding\(/,
            'the single setEncoding must sit inside the !request.isMultipart gate'
        );
    });

    it('the multipart flag is computed once from the content-type header', function () {
        assert.match(
            active,
            /request\.isMultipart\s*=\s*\/multipart\\\/form-data;\/\.test\(request\.headers\['content-type'\] \|\| ''\)/,
            'request.isMultipart must be computed at the request prologue'
        );
        // exactly one live multipart/form-data; regex in the file — the branch
        // reuses the flag instead of duplicating the test.
        var reCount = (active.match(/multipart\\\/form-data;/g) || []).length;
        assert.equal(reCount, 1, 'the multipart content-type regex must appear exactly once (the flag compute)');
    });

    it('the multipart branch dispatches on the flag', function () {
        assert.match(active, /if \( request\.isMultipart \) \{/,
            'the upload branch must test request.isMultipart');
    });

    it('liner passes the Buffer through verbatim and counts bytes', function () {
        var lIdx = active.indexOf('liner._transform = function');
        var lEnd = active.indexOf('file.pipe(liner)', lIdx);
        assert.ok(lIdx > -1 && lEnd > lIdx, 'liner block must be locatable');
        var blk = active.slice(lIdx, lEnd);
        assert.ok(blk.indexOf('file._dataLen += chunk.length') > -1, 'must count chunk BYTES');
        assert.ok(blk.indexOf('this.push(chunk)') > -1, 'must push the chunk verbatim');
        assert.equal(blk.indexOf('chunk.toString()'), -1, 'liner must not string-decode chunks');
    });

    it('no live str2ab CALL remains anywhere in the file', function () {
        // call-form token: the definition line reads `str2ab = function(` and
        // cannot match; comments are stripped. Globally zero ⇒ no slice needed.
        assert.equal(active.indexOf('str2ab('), -1, 'no code path may re-encode via str2ab');
    });

});


// ─── 02 — behavioral: the live liner body is byte-identity; the frozen ───────
//          pre-fix bodies corrupt (subtract controls)

describe('02 - #B103 behavioral replicas', function () {

    var src, active, linerFn;

    before(function () {
        src    = fs.readFileSync(SOURCE, 'utf8');
        active = stripComments(src);
        // Extract the LIVE liner transform body and execute those exact bytes —
        // no hand replica to drift. The assignment closes with a bare `}` (no
        // semicolon), so slice structurally: block-bound to file.pipe(liner),
        // function text = from `function (` to the LAST `}` in the block.
        var lIdx = active.indexOf('liner._transform = function');
        var lEnd = active.indexOf('file.pipe(liner)', lIdx);
        linerFn = null;
        if (lIdx > -1 && lEnd > lIdx) {
            var blk = active.slice(lIdx, lEnd);
            linerFn = blk.slice(blk.indexOf('function'), blk.lastIndexOf('}') + 1);
        }
    });

    it('extraction control: exactly one assignment, and the extract parses', function () {
        var all = active.match(/liner\._transform = function \(chunk, encoding, done\) \{/g) || [];
        assert.equal(all.length, 1, 'exactly one liner._transform assignment expected');
        assert.ok(linerFn && linerFn.indexOf('function (chunk, encoding, done)') === 0,
            'extract must start at the transform signature');
        // must compile — an over- or under-sliced extract throws here
        assert.doesNotThrow(function () { new Function('file', 'return (' + linerFn + ');'); });
    });

    it('extracted live body: byte-identical output, byte-accurate _dataLen', function () {
        var file = { _dataLen: 0 };
        var pushed = [];
        var ctx = { push: function (c) { pushed.push(c); } };
        var fn = new Function('file', 'return (' + linerFn + ');')(file);
        fn.call(ctx, BINARY_FIXTURE, null, function () {});
        var out = Buffer.concat(pushed);
        assert.ok(out.equals(BINARY_FIXTURE), 'output must be byte-identical to the input chunk');
        assert.equal(file._dataLen, BINARY_FIXTURE.length,
            '_dataLen must count BYTES (utf8 char count would differ on this fixture)');
        // the fixture is chosen so char-count ≠ byte-count: prove the distinction bites
        assert.notEqual(BINARY_FIXTURE.toString().length, BINARY_FIXTURE.length,
            'fixture sanity: decoded char count must differ from byte length');
    });

    it('SUBTRACT layer 2 — the frozen pre-fix liner body corrupts the fixture', function () {
        // frozen copy of the DELETED code (cannot drift — it is history):
        var legacyStr2ab = function (str, bits) {
            var bytesLength = str.length
                , _bits     = (typeof (bits) != 'undefined') ? (bits / 8) : 1
                , buffer    = new ArrayBuffer(bytesLength * _bits)
                , bufView   = null;
            switch (bytesLength) {
                case 8:  bufView = new Uint8Array(buffer); break;
                case 16: bufView = new Uint16Array(buffer); break;
                case 32: bufView = new Uint32Array(buffer); break;
                default: bufView = new Uint8Array(buffer); break;
            }
            for (let i = 0, strLen = str.length; i < strLen; i++) { bufView[i] = str.charCodeAt(i); }
            return buffer;
        };
        var file = { _dataLen: 0 };
        var str = BINARY_FIXTURE.toString();
        file._dataLen += str.length;
        var out = Buffer.from(legacyStr2ab(str));
        assert.ok(!out.equals(BINARY_FIXTURE), 'the pre-fix body MUST corrupt the binary fixture (control)');
        // the PNG magic first byte 0x89 is invalid utf8 → U+FFFD → mod 256 → 0xFD
        assert.equal(out[0], 0xFD, 'pre-fix: 0x89 must arrive as 0xFD');
        assert.equal(file._dataLen, str.length, 'pre-fix _dataLen counted chars, not bytes');
        // ASCII survives the same body byte-identical — why the bug stayed hidden
        var a = Buffer.from(legacyStr2ab(ASCII_FIXTURE.toString()));
        assert.ok(a.equals(ASCII_FIXTURE), 'ASCII control must survive the pre-fix body (hides the bug)');
    });

    it('SUBTRACT layer 1 — decoding the request stream corrupts + inflates', function () {
        // what an unconditional setEncoding did to the multipart body before
        // busboy ever parsed it: decode to string, re-encode on the pipe.
        var reencoded = Buffer.from(BINARY_FIXTURE.toString('utf8'), 'utf8');
        assert.ok(!reencoded.equals(BINARY_FIXTURE), 'string-decoded stream MUST differ (control)');
        assert.ok(reencoded.length > BINARY_FIXTURE.length,
            'invalid sequences re-encode as 3-byte U+FFFD — the observed 1.5-2x inflation');
        // and the ASCII control passes — both layers are ASCII-transparent
        var a = Buffer.from(ASCII_FIXTURE.toString('utf8'), 'utf8');
        assert.ok(a.equals(ASCII_FIXTURE), 'ASCII control must survive the decode round-trip');
    });

});
