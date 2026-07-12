'use strict';
/**
 * `$form.send(FormData)` mixed payloads: non-file fields ride the multipart body —
 * #B92-adjacent (client half).
 *
 * Root: send() partitions FormData entries into binaries[] (Files) and newData{}
 * (non-file fields, #B92-nested). Any File forces the multipart branch, which
 * hand-assembles the body via processFiles(binaries, boundary, '', 0, ...) — file
 * parts only; the '' accumulator was the drop point and newData was never consumed,
 * so every non-file field silently vanished from a mixed payload.
 *
 * Fix: buildMultipartFieldParts(data, boundary) serializes the FormData's non-file
 * entries into standard multipart text parts and is passed as processFiles' body
 * accumulator (zero changes inside processFiles). Part names keep the caller's
 * ORIGINAL bracket notation — the server nests them on capture (the #B92-adjacent
 * server half), so fields arrive shaped exactly as on the JSON (fileless) path.
 *
 * Strategy: source pins + a real-bytes extract+eval of the shipped helper driven
 * with REAL FormData/File + a ROUND-TRIP through the REAL vendored server busboy
 * with the capture replica (the client<->server contract) + a subtract reproducing
 * the pre-fix drop + red-first dist-fidelity pins (jsdoc.md discipline: validated
 * failing on the pre-rebuild artifact).
 *
 * Suites:
 *  01 — main.js source pins (helper, call site, File skip, escaping, no value encoding)
 *  02 — extract+eval behavioural (REAL FormData/File)
 *  03 — round-trip: client-built parts through the REAL vendored busboy + REAL nesting helper
 *  04 — SUBTRACT: the pre-fix '' accumulator drops every field end-to-end
 *  05 — dist fidelity (gina.js + gina.min.js)
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var { Readable } = require('stream');

var FW            = require('../fw');
var MAIN_SRC_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_JS       = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN      = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
var Busboy        = require(path.join(FW, 'core/deps/busboy-1.6.0'));

// the REAL server-side nesting helper (implicit global once DataHelper runs)
require(path.join(FW, 'helpers', 'data', 'src', 'main.js'))();
var nestBracketNotationKey = global.nestBracketNotationKey;

var SRC = fs.readFileSync(MAIN_SRC_PATH, 'utf8');

function stripLineComments(src) {
    return src.split('\n').filter(function(l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// real-bytes extraction of the shipped helper (validator-send-formdata-nesting
// precedent): eval the actual source, not a hand replica.
function extractBuildMultipartFieldParts() {
    var start = SRC.indexOf('var buildMultipartFieldParts = function');
    var end   = SRC.indexOf('var processFiles = function', start);
    assert.ok(start > 0 && end > start, 'helper block located in main.js');
    var block = SRC.substring(start, end);
    // new Function, not eval: this test file is strict-mode, and a strict eval
    // scopes its `var` declarations to itself — the extracted function would
    // never escape. A Function body is sloppy by construction.
    return new Function(block + '\nreturn buildMultipartFieldParts;')();
}

// ─── 01 — main.js source pins ─────────────────────────────────────────────────
describe('01 - send(FormData) multipart fields: main.js source pins', function() {
    var active;
    before(function() { active = stripLineComments(SRC); });

    it('the buildMultipartFieldParts helper exists', function() {
        assert.match(active, /var buildMultipartFieldParts = function\(data, boundary\)/);
    });

    it('the multipart branch passes the built field parts as processFiles\' body accumulator', function() {
        assert.ok(
            active.indexOf('processFiles(binaries, boundary, buildMultipartFieldParts(data, boundary), 0, function onComplete') > -1
        );
    });

    it('the pre-fix empty accumulator form is gone (whole-source, window-independent)', function() {
        assert.ok(active.indexOf("processFiles(binaries, boundary, '', 0,") < 0);
    });

    it('File entries are skipped — the helper serializes non-file entries only', function() {
        assert.match(active, /if \(fieldValue instanceof File\) \{\s*continue;/);
    });

    it('part names are escaped per RFC 7578 (CR / LF / double-quote percent-encoded)', function() {
        assert.ok(active.indexOf(".replace(/\\r/g, '%0D').replace(/\\n/g, '%0A').replace(/\"/g, '%22')") > -1);
    });

    it('values are appended verbatim — no encoding of the part body (block-scoped)', function() {
        var from = active.indexOf('var buildMultipartFieldParts = function');
        var to   = active.indexOf('var processFiles = function', from);
        var block = active.substring(from, to);
        assert.ok(block.indexOf('encodeURIComponent') < 0, 'no url-encoding of values');
        assert.ok(block.indexOf('encodeRFC5987ValueChars') < 0, 'no RFC5987 value-encoding');
        assert.ok(block.indexOf('JSON.stringify') < 0, 'no JSON reshaping of values');
    });
});

// ─── 02 — extract+eval behavioural (REAL FormData / File) ────────────────────
describe('02 - buildMultipartFieldParts behaviour (shipped bytes, real FormData)', function() {
    var build;
    before(function() { build = extractBuildMultipartFieldParts(); });

    it('a mixed FormData serializes every non-file entry, original bracket keys, file excluded', function() {
        var fd = new FormData();
        fd.append('avatar', new File(['hello'], 'a.txt', { type: 'text/plain' }));
        fd.append('item[0][id]', 'x');
        fd.append('plain', 'p');
        var parts = build(fd, 'bTest');
        assert.ok(parts.indexOf('name="item[0][id]"') > -1, 'bracket key kept verbatim');
        assert.ok(parts.indexOf('name="plain"') > -1);
        assert.ok(parts.indexOf('a.txt') < 0, 'the File entry is not serialized here');
        assert.ok(parts.indexOf('hello') < 0);
    });

    it('each part has the standard text-part shape', function() {
        var fd = new FormData();
        fd.append('a', 'b');
        assert.equal(build(fd, 'bTest'), '--bTest\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n');
    });

    it('values ride verbatim — %XX sequences and boolean-looking strings untouched', function() {
        var fd = new FormData();
        fd.append('pct', '50%20off');
        fd.append('b', 'true');
        var parts = build(fd, 'bTest');
        assert.ok(parts.indexOf('\r\n\r\n50%20off\r\n') > -1);
        assert.ok(parts.indexOf('\r\n\r\ntrue\r\n') > -1);
    });

    it('a files-only FormData yields an empty accumulator (the staged-upload layer is byte-identical)', function() {
        var fd = new FormData();
        fd.append('f', new File(['x'], 'x.bin'));
        assert.equal(build(fd, 'bTest'), '');
    });

    it('CR / LF / double-quote in a name are percent-encoded', function() {
        var fd = new FormData();
        fd.append('a"b\r\nc', 'v');
        var parts = build(fd, 'bTest');
        assert.ok(parts.indexOf('name="a%22b%0D%0Ac"') > -1);
    });
});

// ─── 03 — round-trip: client parts → REAL vendored busboy + REAL nesting ─────
describe('03 - client<->server contract round-trip (REAL busboy, REAL helper)', function() {
    var build;
    before(function() { build = extractBuildMultipartFieldParts(); });

    // the server-side #B92-adjacent capture replica (locked to server.js by its
    // own test file's source pins)
    function capture(body, CT, cb) {
        var state = { fields: null, files: 0, finish: false, error: null };
        var bb = Busboy({ headers: { 'content-type': CT }, defParamCharset: 'utf8' });
        bb.on('file', function(n, s) { state.files++; s.resume(); });
        bb.on('field', function(name, value) {
            if (state.fields == null) { state.fields = {}; }
            if ( /^(.*)\[(.*)\]/.test(name) ) {
                state.fields = nestBracketNotationKey(state.fields, name.replace(/\]/g, '').split(/\[/g), 0, value);
            } else {
                state.fields[name] = value;
            }
        });
        bb.on('finish', function() { state.finish = true; });
        bb.on('error', function(e) { state.error = String((e && e.message) || e); });
        Readable.from([Buffer.from(body)]).pipe(bb);
        setTimeout(function() { cb(state); }, 200);
    }

    it('a mixed send() body arrives with req-side fields NESTED and the file intact', function(t, done) {
        var B  = 'gwkbTest123';                       // boundary value (as declared in the CT header)
        var CT = 'multipart/form-data; boundary=' + B;
        var fd = new FormData();
        fd.append('avatar', new File(['hello'], 'a.txt', { type: 'text/plain' }));
        fd.append('item[0][id]', 'x');
        fd.append('item[1][id]', 'y');
        fd.append('plain', 'p');
        // client half: field parts exactly as send() now builds them...
        var body = build(fd, B)
            // ...plus a file part in processFiles' shape, plus the closer
            + '--' + B + '\r\nContent-Disposition: form-data; name="avatar"; group="untagged"; filename="a.txt"\r\n'
            + 'Content-Type: text/plain\r\nContent-Length: 5\r\n\r\nhello\r\n'
            + '--' + B + '--';
        capture(body, CT, function(s) {
            assert.equal(s.error, null);
            assert.equal(s.finish, true);
            assert.equal(s.files, 1);
            assert.equal(s.fields.item[0].id, 'x');
            assert.equal(s.fields.item[1].id, 'y');
            assert.equal(s.fields.plain, 'p');
            done();
        });
    });

    it('SUBTRACT — the pre-fix empty accumulator drops every field end-to-end', function(t, done) {
        var B  = 'gwkbTest123';
        var CT = 'multipart/form-data; boundary=' + B;
        // pre-fix body: file parts only (the '' accumulator), same closer
        var body = '--' + B + '\r\nContent-Disposition: form-data; name="avatar"; group="untagged"; filename="a.txt"\r\n'
            + 'Content-Type: text/plain\r\nContent-Length: 5\r\n\r\nhello\r\n'
            + '--' + B + '--';
        capture(body, CT, function(s) {
            assert.equal(s.files, 1);
            assert.equal(s.fields, null, 'no text field ever reaches the server — the filed drop');
            done();
        });
    });
});

// ─── 05 — dist fidelity (red-first: validated FAILING on the pre-rebuild dist) ─
describe('05 - dist fidelity: the rebuilt bundle carries the fix', function() {

    it('gina.js (unminified dist) contains the helper declaration AND its call site', function() {
        var dist = fs.readFileSync(DIST_JS, 'utf8');
        var count = dist.split('buildMultipartFieldParts').length - 1;
        assert.ok(count >= 2, 'expected >= 2 occurrences (declaration + call site), got ' + count);
    });

    it('gina.min.js carries a SECOND text-part Content-Disposition literal (the helper, minify-surviving)', function() {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        var count = min.split('Content-Disposition: form-data; name="').length - 1;
        assert.ok(count >= 2, 'expected >= 2 occurrences (processFiles + the field-parts helper), got ' + count);
    });

    it('gina.min.js carries the %0D name-escape literal (absent pre-fix)', function() {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        assert.ok(min.indexOf('%0D') > -1);
    });
});
