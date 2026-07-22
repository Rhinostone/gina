'use strict';
/**
 * Staged-upload multipart body: binary bytes reach the wire VERBATIM — #B148.
 *
 * Root: processFiles() historically read each staged File via FileReader,
 * converted the buffer to a per-byte JS string (ab2str) and hand-concatenated
 * the whole multipart body, which send() transmitted as xhr.send(<DOMString>).
 * A DOMString is UTF-8-encoded on the wire, so every file byte >= 0x80 became
 * a 2-byte sequence: any real binary upload (image / PDF / archive) was stored
 * inflated + corrupted server-side (measured x1.49 on a cycling-byte fixture;
 * a real PNG lost its signature byte 0x89 -> 0xC2 0x89 and no longer parsed).
 * The corruption was EXPOSED at the #B103 server fix: the pre-#B103 server's
 * two string-decode layers (setEncoding('utf8') + the liner's
 * toString()/charCode-mod-256 re-encode) exactly REVERSED this client
 * inflation — two wrongs cancelling — so the round-trip was byte-clean until
 * the server became faithful.
 *
 * Fix: processFiles() assembles the body as a Blob — [ field parts (string),
 * per-file header (string), the File object itself (raw bytes), CRLF, ...,
 * closer ] — and hands it to the unchanged onComplete/send call site;
 * xhr.send(Blob) transmits verbatim and the explicitly-set multipart
 * Content-Type request header survives. The multipart FRAMING (boundary
 * delimiters, the name/group/filename disposition-parameter set — the
 * documented upload-group wire vehicle — Content-Type, Content-Length) is
 * byte-identical to the historical body; only the file bytes change (raw
 * instead of inflated). Disposition-parameter values are additionally
 * percent-escaped for CR / LF / double-quote (RFC 7578 §5.1.1, the same
 * treatment buildMultipartFieldParts applies to field names) — an unescaped
 * double-quote previously produced a malformed part.
 *
 * Strategy: source pins on the ACTIVE (comment-stripped) source + a
 * control-gated extract+eval of the shipped processFiles driven with REAL
 * File/Blob bytes + a ROUND-TRIP through the REAL server-side busboy fork
 * (dispositionParams contract) + a frozen pre-fix SUBTRACT reproducing the
 * inflation + red-first dist-fidelity pins (validated FAILING on the
 * pre-rebuild artifact, per the jsdoc.md discipline).
 *
 * Suites:
 *  01 — main.js source pins (Blob assembly, escaping, file.size length, no reader)
 *  02 — extract+eval behavioural: exact body bytes (shipped source, real Files)
 *  03 — wire round-trip: assembled Blob through the REAL busboy — bytes verbatim
 *  04 — SUBTRACT: the frozen pre-fix string assembly inflates through the same wire
 *  05 — dist fidelity (red-first: validated failing on the pre-rebuild dist)
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW            = require('../fw');
var MAIN_SRC_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_JS       = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN      = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
var Busboy        = require('@rhinostone/busboy');

var SRC = fs.readFileSync(MAIN_SRC_PATH, 'utf8');

// Comment-strip that also drops JSDoc block lines — the #B148 change keeps the
// historical implementation commented out (the replace-code convention) and
// its JSDoc names the retired constructs, so negative pins MUST run against
// the ACTIVE code only.
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// Control-gated extraction of the shipped processFiles (the jsdoc.md
// execute-the-extracted-source idiom): slice the ACTIVE source between the
// declaration and the next top-level construct, then eval those exact bytes.
function extractProcessFiles() {
    var active = stripComments(SRC);
    var start  = active.indexOf('var processFiles = function');
    var end    = active.indexOf('var listenToXhrEvents = function', start);
    assert.ok(start > 0 && end > start, 'processFiles block located in ACTIVE main.js');
    var block = active.substring(start, end);
    return new Function(block + '\nreturn processFiles;')();
}

// Expected body bytes, built independently of the implementation under test:
// UTF-8 header/field segments + RAW file bytes.
function expectedBody(fieldParts, boundary, files) {
    var chunks = [];
    if (fieldParts) { chunks.push(Buffer.from(fieldParts, 'utf8')); }
    files.forEach(function (f) {
        chunks.push(Buffer.from(
            '--' + boundary + '\r\n'
            + 'Content-Disposition: form-data; name="' + f.expName + '"; group="' + f.expGroup + '"; filename="' + f.expFilename + '"\r\n'
            + 'Content-Type: ' + f.expType + '\r\n'
            + 'Content-Length: ' + f.bytes.length + '\r\n'
            + '\r\n', 'utf8'));
        chunks.push(Buffer.from(f.bytes));
        chunks.push(Buffer.from('\r\n', 'utf8'));
    });
    chunks.push(Buffer.from('--' + boundary + '--', 'utf8'));
    return Buffer.concat(chunks);
}

function allBytes(n) {
    var b = Buffer.alloc(n);
    for (var i = 0; i < n; i++) { b[i] = i % 256; }
    return b;
}

// ─── 01 — main.js source pins (ACTIVE source) ────────────────────────────────
describe('01 - #B148 source pins: Blob assembly, escaping, no reader (active source)', function () {
    var active;
    before(function () { active = stripComments(SRC); });

    it('processFiles keeps its historical signature (the send call-site contract)', function () {
        assert.match(active, /var processFiles = function\(binaries, boundary, data, f, onComplete\)/);
    });

    it('the body is assembled as a Blob and handed to onComplete', function () {
        assert.ok(active.indexOf('return onComplete(false, new Blob(parts), true)') > -1);
    });

    it('the file rides the body as a raw Blob part (the File object itself)', function () {
        assert.ok(active.indexOf('parts.push(binaries[i].file);') > -1);
    });

    it('all three disposition params are percent-escaped', function () {
        assert.ok(active.indexOf('name="\' + escapeDispositionParam(binaries[i].key)') > -1);
        assert.ok(active.indexOf('group="\' + escapeDispositionParam(binaries[i].group)') > -1);
        assert.ok(active.indexOf('filename="\' + escapeDispositionParam(binaries[i].file.name)') > -1);
    });

    it('the per-part Content-Length reports the true byte count (File.size)', function () {
        assert.ok(active.indexOf("'Content-Length: ' + binaries[i].file.size") > -1);
    });

    it('no reader / per-byte string conversion remains in the ACTIVE source', function () {
        // whole-source: both are globally zero in active code after #B148
        assert.ok(active.indexOf('readAsArrayBuffer') < 0, 'readAsArrayBuffer retired');
        assert.ok(active.indexOf('ab2str(') < 0, 'ab2str call-free');
        // block-scoped: `new FileReader` legitimately survives elsewhere (the
        // response blob-error reader), so pin its absence WITHIN processFiles
        var start = active.indexOf('var processFiles = function');
        var end   = active.indexOf('var listenToXhrEvents = function', start);
        assert.ok(start > 0 && end > start, 'processFiles block located');
        assert.ok(active.substring(start, end).indexOf('new FileReader') < 0, 'no FileReader in the assembly');
    });
});

// ─── 02 — extract+eval behavioural (shipped bytes, real Files) ──────────────
describe('02 - processFiles behaviour: exact body bytes (shipped source)', function () {
    var processFiles;
    before(function () { processFiles = extractProcessFiles(); });

    function run(binaries, boundary, data, f) {
        return new Promise(function (resolve, reject) {
            processFiles(binaries, boundary, data, f, function (err, body, done) {
                if (err) { return reject(err); }
                resolve({ body: body, done: done });
            });
        });
    }

    it('a binary File round-trips into the body VERBATIM (byte-exact whole-body check)', async function () {
        var bytes = allBytes(1024); // every byte value, incl. CRLF and >= 0x80
        var file  = new File([bytes], 'all.bin', { type: 'application/octet-stream' });
        var out   = await run([{ key: 'documents', group: 'untagged', file: file, bin: '' }], 'bWire', '', 0);
        assert.equal(out.done, true);
        assert.ok(out.body instanceof Blob, 'onComplete hands a Blob');
        var got = Buffer.from(await out.body.arrayBuffer());
        var exp = expectedBody('', 'bWire', [{ expName: 'documents', expGroup: 'untagged', expFilename: 'all.bin', expType: 'application/octet-stream', bytes: bytes }]);
        assert.equal(got.length, exp.length, 'no inflation: body length is the raw layout length');
        assert.deepEqual(got, exp, 'body bytes exactly match the expected multipart layout');
    });

    it('multiple files keep selection order, each byte-exact', async function () {
        var b1 = allBytes(300), b2 = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        var f1 = new File([b1], 'one.bin', { type: 'application/octet-stream' });
        var f2 = new File([b2], 'two.png', { type: 'image/png' });
        var out = await run([
            { key: 'documents', group: 'docs', file: f1, bin: '' },
            { key: 'documents', group: 'docs', file: f2, bin: '' }
        ], 'bWire', '', 0);
        var got = Buffer.from(await out.body.arrayBuffer());
        var exp = expectedBody('', 'bWire', [
            { expName: 'documents', expGroup: 'docs', expFilename: 'one.bin', expType: 'application/octet-stream', bytes: b1 },
            { expName: 'documents', expGroup: 'docs', expFilename: 'two.png', expType: 'image/png', bytes: b2 }
        ]);
        assert.deepEqual(got, exp);
    });

    it('field parts (the buildMultipartFieldParts accumulator) ride ahead of the file parts verbatim', async function () {
        var fieldParts = '--bWire\r\nContent-Disposition: form-data; name="plain"\r\n\r\np\r\n';
        var bytes = allBytes(64);
        var file  = new File([bytes], 'x.bin', { type: 'application/octet-stream' });
        var out   = await run([{ key: 'f', group: 'untagged', file: file, bin: '' }], 'bWire', fieldParts, 0);
        var got = Buffer.from(await out.body.arrayBuffer());
        var exp = expectedBody(fieldParts, 'bWire', [{ expName: 'f', expGroup: 'untagged', expFilename: 'x.bin', expType: 'application/octet-stream', bytes: bytes }]);
        assert.deepEqual(got, exp);
    });

    it('CR / LF / double-quote in name, group and filename are percent-escaped in the header', async function () {
        var bytes = Buffer.from('data');
        var file  = new File([bytes], 'we"ird\r\n.bin', { type: 'application/octet-stream' });
        var out   = await run([{ key: 'k"ey', group: 'g\rrp', file: file, bin: '' }], 'bWire', '', 0);
        var got = Buffer.from(await out.body.arrayBuffer()).toString('utf8');
        assert.ok(got.indexOf('name="k%22ey"') > -1, 'name escaped');
        assert.ok(got.indexOf('group="g%0Drp"') > -1, 'group escaped');
        assert.ok(got.indexOf('filename="we%22ird%0D%0A.bin"') > -1, 'filename escaped');
    });

    it('a File with an empty type falls back to application/octet-stream (File.type is read-only)', async function () {
        var file = new File([Buffer.from('x')], 'noext', { type: '' });
        var out  = await run([{ key: 'f', group: 'untagged', file: file, bin: '' }], 'bWire', '', 0);
        var got  = Buffer.from(await out.body.arrayBuffer()).toString('utf8');
        assert.ok(got.indexOf('Content-Type: application/octet-stream\r\n') > -1);
    });

    it('the f start index is honoured (files before it are skipped)', async function () {
        var b2  = Buffer.from('second');
        var out = await run([
            { key: 'a', group: 'g', file: new File([Buffer.from('first')], 'a.bin', { type: 'text/plain' }), bin: '' },
            { key: 'b', group: 'g', file: new File([b2], 'b.bin', { type: 'text/plain' }), bin: '' }
        ], 'bWire', '', 1);
        var got = Buffer.from(await out.body.arrayBuffer());
        var exp = expectedBody('', 'bWire', [{ expName: 'b', expGroup: 'g', expFilename: 'b.bin', expType: 'text/plain', bytes: b2 }]);
        assert.deepEqual(got, exp);
    });

    it('an assembly error routes to onComplete(err, null, true)', function (t, done) {
        // a record with no File forces a TypeError inside the loop
        processFiles([{ key: 'f', group: 'g' }], 'bWire', '', 0, function (err, body, isDone) {
            assert.ok(err instanceof Error);
            assert.equal(body, null);
            assert.equal(isDone, true);
            done();
        });
    });
});

// ─── 03 — wire round-trip through the REAL server-side busboy fork ──────────
describe('03 - client<->server round-trip: bytes verbatim, group param intact', function () {
    var processFiles;
    before(function () { processFiles = extractProcessFiles(); });

    function parse(bodyBuf, boundary, cb) {
        var bb = Busboy({
            headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
            defParamCharset: 'utf8'
        });
        var files = [], error = null;
        bb.on('file', function (name, stream, info) {
            var rec = { name: name, info: info, chunks: [] };
            files.push(rec);
            stream.on('data', function (c) { rec.chunks.push(c); });
        });
        bb.on('error', function (e) { error = e; });
        bb.on('finish', function () {
            cb(error, files.map(function (r) {
                return { name: r.name, filename: r.info.filename, group: r.info.dispositionParams && r.info.dispositionParams.group, bytes: Buffer.concat(r.chunks) };
            }));
        });
        bb.write(bodyBuf);
        bb.end();
    }

    it('a full-byte-range file arrives byte-identical, group parsed from the disposition param', function (t, done) {
        var bytes = allBytes(4096);
        var file  = new File([bytes], 'all.bin', { type: 'application/octet-stream' });
        processFiles([{ key: 'documents', group: 'proofs', file: file, bin: '' }], 'bWire', '', 0, function (err, body) {
            assert.equal(err, false);
            body.arrayBuffer().then(function (ab) {
                parse(Buffer.from(ab), 'bWire', function (perr, files) {
                    assert.equal(perr, null);
                    assert.equal(files.length, 1);
                    assert.equal(files[0].group, 'proofs', 'the upload-group wire vehicle is intact');
                    assert.deepEqual(files[0].bytes, bytes, 'stored bytes == original bytes (no inflation)');
                    done();
                });
            });
        });
    });

    it('a UTF-8 filename decodes exactly (defParamCharset utf8 sees the same bytes as the DOMString era)', function (t, done) {
        var bytes = allBytes(256);
        var file  = new File([bytes], 'Accusé-π.bin', { type: 'application/octet-stream' });
        processFiles([{ key: 'f', group: 'untagged', file: file, bin: '' }], 'bWire', '', 0, function (err, body) {
            body.arrayBuffer().then(function (ab) {
                parse(Buffer.from(ab), 'bWire', function (perr, files) {
                    assert.equal(files[0].filename, 'Accusé-π.bin');
                    assert.deepEqual(files[0].bytes, bytes);
                    done();
                });
            });
        });
    });
});

// ─── 04 — SUBTRACT: the frozen pre-fix assembly inflates through the same wire ─
describe('04 - SUBTRACT: the historical DOMString assembly corrupts (frozen pre-fix replica)', function () {

    // Frozen copies of the retired algorithms (the pre-#B148 shipped shapes):
    // ab2str — one JS char per byte…
    function ab2strFrozen(buf) {
        var str = '';
        var ab = new Uint8Array(buf);
        for (var offset = 0; offset < ab.length; offset += 257) {
            var subab = ab.subarray(offset, Math.min(offset + 257, ab.length));
            str += String.fromCharCode.apply(null, subab);
        }
        return str;
    }
    // …string-concatenated body, transmitted as a DOMString = UTF-8 on the wire.
    function preFixWire(bytes, boundary, key, group, filename, type) {
        var bin = ab2strFrozen(bytes);
        var data = '--' + boundary + '\r\n'
            + 'Content-Disposition: form-data; name="' + key + '"; group="' + group + '"; filename="' + filename + '"\r\n'
            + 'Content-Type: ' + type + '\r\n'
            + 'Content-Length: ' + bin.length + '\r\n'
            + '\r\n'
            + bin + '\r\n'
            + '--' + boundary + '--';
        return Buffer.from(data, 'utf8'); // what xhr.send(<DOMString>) puts on the wire
    }

    it('the pre-fix wire inflates every byte >= 0x80 and the parsed file mismatches the original', function (t, done) {
        var bytes = allBytes(1024); // 512 bytes >= 0x80 -> +512 on the wire
        var wire  = preFixWire(bytes, 'bWire', 'documents', 'untagged', 'all.bin', 'application/octet-stream');
        var bb = Busboy({ headers: { 'content-type': 'multipart/form-data; boundary=bWire' }, defParamCharset: 'utf8' });
        var chunks = [];
        bb.on('file', function (n, s) { s.on('data', function (c) { chunks.push(c); }); });
        bb.on('finish', function () {
            var stored = Buffer.concat(chunks);
            assert.equal(stored.length, 1024 + 512, 'inflated: every high byte doubled');
            assert.notDeepEqual(stored, bytes, 'the stored payload is NOT the original — the #B148 corruption');
            done();
        });
        bb.write(wire);
        bb.end();
    });
});

// ─── 05 — dist fidelity (red-first: validated FAILING on the pre-rebuild dist) ─
describe('05 - dist fidelity: the rebuilt bundle carries the Blob assembly', function () {

    it('gina.js (unminified dist, ACTIVE code) assembles a Blob and retires the reader', function () {
        var active = stripComments(fs.readFileSync(DIST_JS, 'utf8'));
        assert.ok(active.indexOf('return onComplete(false, new Blob(parts), true)') > -1, 'Blob assembly present');
        assert.ok(active.indexOf('readAsArrayBuffer') < 0, 'reader retired from active dist code');
    });

    it('gina.min.js: the part Content-Length reads the File byte size (wrap-agnostic, minify-surviving)', function () {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        assert.match(min, /Content-Length: ["']\s*\+\s*[\s\S]{0,80}?\.file\.size/, 'file.size length present');
        assert.doesNotMatch(min, /Content-Length: ["']\s*\+\s*[\s\S]{0,80}?\.bin\.length/, 'char-count length retired');
    });

    it('gina.min.js: no reader remains (readAsArrayBuffer is minify-surviving and globally gone)', function () {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        assert.ok(min.indexOf('readAsArrayBuffer') < 0);
    });
});
