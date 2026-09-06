'use strict';
/**
 * lib/multipart (#B489) — behavioral suite against the REAL module and the
 * REAL inbound parser.
 *
 * Every body this encoder emits is parsed back by `@rhinostone/busboy` (the
 * framework's multipart parser, built the way core/server.js builds it —
 * `defParamCharset: 'utf8'`) and nested by the framework's own
 * `nestBracketNotationKey` global exactly the way the server nests multipart
 * text fields. A round trip that lands on the same fields object and the
 * same file bytes IS the contract; nothing here is shape-matched.
 *
 * Suites:
 *  01 — flatten(): the inverse of the parser's nesting
 *  02 — encode(): body bytes, boundary, length, escaping
 *  03 — round trip: fields, files, group tag, UTF-8 names, binary bytes, order
 *  04 — errors: coded; the size cap trips BEFORE any file is read
 *  05 — source structure: never deletes a staged file; cap check precedes the read
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var crypto = require('crypto');

var FW = require('../fw');
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(FW + '/helpers'); // defines the `nestBracketNotationKey` global (helpers/data)

var MAIN      = path.join(FW, 'lib/multipart/src/main.js');
var multipart = require(MAIN);
var SRC       = fs.readFileSync(MAIN, 'utf8');
var Busboy;
try {
    Busboy = require(path.join(FW, 'node_modules', '@rhinostone', 'busboy')); // the server's own copy
} catch (e) {
    Busboy = require('@rhinostone/busboy');
}

/**
 * Parse a body the way core/server.js does: busboy with `defParamCharset: 'utf8'`,
 * text fields nested through the framework's `nestBracketNotationKey` when the
 * name carries brackets, assigned flat otherwise; file parts collected with
 * their disposition params.
 */
function parse(contentType, body) {
    return new Promise(function (resolve, reject) {
        var bb = Busboy({ headers: { 'content-type': contentType }, defParamCharset: 'utf8' });
        var fields = null, files = [], pendingStreams = 0, finished = false;
        function settle() {
            if (finished && pendingStreams === 0) {
                resolve({ fields: fields, files: files });
            }
        }
        bb.on('field', function (name, value) {
            if (fields === null) { fields = {}; }
            if ( /^(.*)\[(.*)\]/.test(name) ) { // the server's own condition (core/server.js multipart 'field' handler)
                fields = nestBracketNotationKey(fields, name.replace(/\]/g, '').split(/\[/g), 0, value);
            } else {
                fields[name] = value;
            }
        });
        bb.on('file', function (name, stream, info) {
            var chunks = [];
            ++pendingStreams;
            stream.on('data', function (c) { chunks.push(c); });
            stream.on('end', function () {
                files.push({
                    name     : name,
                    filename : info.filename,
                    mimeType : info.mimeType,
                    encoding : info.encoding,
                    group    : ( info.dispositionParams ) ? info.dispositionParams.group : undefined,
                    data     : Buffer.concat(chunks)
                });
                --pendingStreams;
                settle();
            });
        });
        bb.on('error', reject);
        bb.on('finish', function () { finished = true; settle(); });
        bb.end(body);
    });
}

/** Nest `[name, value]` pairs exactly the way the server would. */
function nestPairs(pairs) {
    var obj = {};
    for (var i = 0; i < pairs.length; ++i) {
        var name = pairs[i][0], value = pairs[i][1];
        if ( /^(.*)\[(.*)\]/.test(name) ) {
            obj = nestBracketNotationKey(obj, name.replace(/\]/g, '').split(/\[/g), 0, value);
        } else {
            obj[name] = value;
        }
    }
    return obj;
}

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

// ─── fixtures on disk ────────────────────────────────────────────────────────

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-multipart-'));
var TXT_PATH   = path.join(TMP, 'a.txt');
var BIN_PATH   = path.join(TMP, 'bin.dat');
var EMPTY_PATH = path.join(TMP, 'empty.bin');
var LOCKED_PATH = path.join(TMP, 'locked.bin');
var TXT_BYTES = Buffer.from('Accusé de réception — ligne 1\r\nligne 2\n', 'utf8');
// bytes that LOOK like a boundary line plus every byte value: the encoder must frame them untouched
var BIN_BYTES = Buffer.concat([
    Buffer.from('\r\n--------------------------deadbeefdeadbeef\r\nContent-Disposition: form-data; name="fake"\r\n\r\n'),
    Buffer.from(Array.from({ length: 256 }, function (_, i) { return i; })),
    Buffer.from('\r\n--\r\n')
]);

before(function () {
    fs.writeFileSync(TXT_PATH, TXT_BYTES);
    fs.writeFileSync(BIN_PATH, BIN_BYTES);
    fs.writeFileSync(EMPTY_PATH, Buffer.alloc(0));
    fs.writeFileSync(LOCKED_PATH, Buffer.alloc(100, 1));
    fs.chmodSync(LOCKED_PATH, 0o000);
});
after(function () {
    try { fs.chmodSync(LOCKED_PATH, 0o600); } catch (e) { /* already gone */ }
    fs.rmSync(TMP, { recursive: true, force: true });
});

function rec(name, filePath, extra) {
    return Object.assign({ name: name, originalFilename: path.basename(filePath), encoding: '7bit', type: 'application/octet-stream', size: fs.statSync(filePath).size, path: filePath }, extra || {});
}


// ─── 01 — flatten() ──────────────────────────────────────────────────────────

describe('01 - flatten() is the inverse of the parser nesting', function () {

    it('objects become a[b], arrays a[0], leaves String(value), null/undefined ""', function () {
        assert.deepEqual(multipart.flatten({ user: { name: 'a', tags: ['x', 'y'], n: null }, k: 1, u: undefined }), [
            ['user[name]', 'a'], ['user[tags][0]', 'x'], ['user[tags][1]', 'y'], ['user[n]', ''], ['k', '1'], ['u', '']
        ]);
    });

    it('round trip: nesting the pairs with the REAL nester yields the input again', function () {
        var fixtures = [
            { a: 'b' },
            { user: { name: 'Zoë', tags: ['x', 'y'], empty: '' } },
            { rows: [ { id: '1', v: 'a' }, { id: '2', v: 'b' } ] },
            { deep: { l1: { l2: { l3: 'v' } } }, flat: 'f' },
            { list: ['1', '2', '3'] }
        ];
        for (var i = 0; i < fixtures.length; ++i) {
            assert.deepEqual(nestPairs(multipart.flatten(fixtures[i])), fixtures[i], 'fixture #' + i);
        }
    });

    it('reserved segments are never emitted (the parser drops them too, #B446)', function () {
        assert.deepEqual(multipart.flatten({ constructor: 'x', a: 'b' }), [['a', 'b']]);
        assert.deepEqual(multipart.flatten({ a: { prototype: '1', b: '2' } }), [['a[b]', '2']]);
    });

    it('an empty object or array has no wire form and is dropped; absent fields yield no pairs', function () {
        assert.deepEqual(multipart.flatten({ a: {}, b: [], c: 'x' }), [['c', 'x']]);
        assert.deepEqual(multipart.flatten(undefined), []);
        assert.deepEqual(multipart.flatten(null), []);
    });

    it('a non-object fields value is refused with MULTIPART_BAD_INPUT', function () {
        assert.throws(function () { multipart.flatten(['a']); }, function (e) { return e.code === 'MULTIPART_BAD_INPUT'; });
        assert.throws(function () { multipart.flatten('a=b'); }, function (e) { return e.code === 'MULTIPART_BAD_INPUT'; });
    });
});


// ─── 02 — encode() structure ─────────────────────────────────────────────────

describe('02 - encode() body bytes, boundary, length, escaping', function () {

    it('a fixed boundary yields exact bytes: one field part, closing delimiter, CRLF discipline', function () {
        var enc = multipart.encode({ fields: { x: '1' } }, { boundary: 'B' });
        assert.equal(enc.body.toString('utf8'), '--B\r\nContent-Disposition: form-data; name="x"\r\n\r\n1\r\n--B--\r\n');
        assert.equal(enc.contentType, 'multipart/form-data; boundary=B');
        assert.equal(enc.length, enc.body.length);
        assert.equal(enc.boundary, 'B');
    });

    it('names and filenames are escaped the way browsers escape them (" → %22, CR → %0D, LF → %0A)', function () {
        var enc = multipart.encode({ fields: { 'a"b\r\nc': 'v' }, files: [ rec('f', TXT_PATH, { originalFilename: 'we"ird\n.txt', group: 'docs' }) ] }, { boundary: 'B' });
        var s = enc.body.toString('latin1');
        assert.ok(s.indexOf('name="a%22b%0D%0Ac"') > -1, 'field name escaped');
        assert.ok(s.indexOf('filename="we%22ird%0A.txt"') > -1, 'filename escaped');
        assert.ok(s.indexOf('; group="docs"') > -1, 'group param emitted');
    });

    it('a file part carries Content-Type from the record, application/octet-stream when the record has none, and no group param when the record has none', function () {
        var withType = multipart.encode({ files: [ rec('f', TXT_PATH, { type: 'text/plain' }) ] }, { boundary: 'B' }).body.toString('latin1');
        assert.ok(withType.indexOf('\r\nContent-Type: text/plain\r\n\r\n') > -1);
        var noType = multipart.encode({ files: [ rec('f', TXT_PATH, { type: '' }) ] }, { boundary: 'B' }).body.toString('latin1');
        assert.ok(noType.indexOf('\r\nContent-Type: application/octet-stream\r\n\r\n') > -1);
        assert.equal(noType.indexOf('group='), -1, 'no group param without a group');
    });

    it('a drawn boundary is ----gina + 48 hex, at most 70 characters, and differs between calls', function () {
        var a = multipart.encode({ fields: { x: '1' } });
        var b = multipart.encode({ fields: { x: '1' } });
        assert.match(a.boundary, /^----gina[0-9a-f]{48}$/);
        assert.ok(a.boundary.length <= 70, 'RFC 2046 boundary length cap');
        assert.notEqual(a.boundary, b.boundary);
        assert.equal(a.contentType, 'multipart/form-data; boundary=' + a.boundary);
    });

    it('an empty input encodes to just the closing delimiter', function () {
        var enc = multipart.encode({}, { boundary: 'B' });
        assert.equal(enc.body.toString('utf8'), '--B--\r\n');
    });
});


// ─── 03 — round trip through the real parser ─────────────────────────────────

describe('03 - round trip through busboy + the real nester', function () {

    var FIELDS = { user: { name: 'Zoë', tags: ['x', 'y'], empty: '' }, n: '1', rows: [ { a: '1' }, { a: '2' } ] };

    it('fields come back as the same nested object', async function () {
        var enc = multipart.encode({ fields: FIELDS });
        var out = await parse(enc.contentType, enc.body);
        assert.deepEqual(out.fields, FIELDS);
        assert.deepEqual(out.files, []);
    });

    it('files come back byte-identical, in order, with name, type, group and a UTF-8 filename', async function () {
        var enc = multipart.encode({
            fields: { note: 'n' },
            files: [
                rec('doc',  TXT_PATH, { type: 'text/plain', group: 'docs', originalFilename: 'Accusé de réception.txt' }),
                rec('blob', BIN_PATH, { type: 'application/octet-stream', group: 'untagged' }),
                rec('none', EMPTY_PATH, { type: 'application/octet-stream' })
            ]
        });
        var out = await parse(enc.contentType, enc.body);
        assert.deepEqual(out.fields, { note: 'n' });
        assert.equal(out.files.length, 3);
        assert.deepEqual(out.files.map(function (f) { return f.name; }), ['doc', 'blob', 'none'], 'part order preserved');
        assert.equal(out.files[0].filename, 'Accusé de réception.txt', 'UTF-8 filename decoded back verbatim');
        assert.equal(out.files[0].mimeType, 'text/plain');
        assert.equal(out.files[0].group, 'docs');
        assert.equal(md5(out.files[0].data), md5(TXT_BYTES));
        assert.equal(out.files[1].group, 'untagged');
        assert.equal(md5(out.files[1].data), md5(BIN_BYTES), 'boundary-looking bytes and every byte value framed untouched');
        assert.equal(out.files[1].data.length, BIN_BYTES.length);
        assert.equal(out.files[2].data.length, 0, 'an empty file is an empty part, not a dropped one');
        assert.equal(typeof out.files[2].group, 'undefined', 'no group emitted ⇒ none parsed (the receiving gate resolves untagged)');
    });

    it('two parts sharing a field name both arrive (the parser does not collapse them)', async function () {
        var enc = multipart.encode({ files: [ rec('f', TXT_PATH, { originalFilename: 'one.txt' }), rec('f', TXT_PATH, { originalFilename: 'two.txt' }) ] });
        var out = await parse(enc.contentType, enc.body);
        assert.deepEqual(out.files.map(function (f) { return f.filename; }), ['one.txt', 'two.txt']);
    });

    it('a quote in a filename survives as %22 on both sides (browser parity — the parser does not unescape it)', async function () {
        var enc = multipart.encode({ files: [ rec('f', TXT_PATH, { originalFilename: 'we"ird.txt' }) ] });
        var out = await parse(enc.contentType, enc.body);
        assert.equal(out.files[0].filename, 'we%22ird.txt');
    });
});


// ─── 04 — errors ─────────────────────────────────────────────────────────────

describe('04 - coded errors; the cap trips before any read', function () {

    it('a missing staged file → MULTIPART_FILE_UNREADABLE carrying .path', function () {
        var gone = path.join(TMP, 'gone.part');
        assert.throws(function () { multipart.encode({ files: [ rec('f', TXT_PATH, { path: gone }) ] }); },
            function (e) { return e.code === 'MULTIPART_FILE_UNREADABLE' && e.path === gone; });
    });

    it('a record without a name or a path, or a non-array files value → MULTIPART_BAD_INPUT', function () {
        assert.throws(function () { multipart.encode({ files: [ { path: TXT_PATH } ] }); }, function (e) { return e.code === 'MULTIPART_BAD_INPUT'; });
        assert.throws(function () { multipart.encode({ files: [ { name: 'f' } ] }); }, function (e) { return e.code === 'MULTIPART_BAD_INPUT'; });
        assert.throws(function () { multipart.encode({ files: { name: 'f' } }); }, function (e) { return e.code === 'MULTIPART_BAD_INPUT'; });
    });

    it('maxSize counts field bytes + on-disk file sizes: a breach → MULTIPART_TOO_LARGE with .size and .limit; equality passes', function () {
        var fieldBytes = Buffer.byteLength('0123456789', 'utf8');
        var total = fieldBytes + TXT_BYTES.length;
        assert.throws(function () { multipart.encode({ fields: { f: '0123456789' }, files: [ rec('f', TXT_PATH) ] }, { maxSize: total - 1 }); },
            function (e) { return e.code === 'MULTIPART_TOO_LARGE' && e.size === total && e.limit === total - 1; });
        var ok = multipart.encode({ fields: { f: '0123456789' }, files: [ rec('f', TXT_PATH) ] }, { maxSize: total });
        assert.equal(ok.body.length > total, true);
    });

    it('the cap is checked BEFORE any file is read: an unreadable file past the cap reports TOO_LARGE, not UNREADABLE', function () {
        // control: the same locked file UNDER the cap does fail on the read
        assert.throws(function () { multipart.encode({ files: [ rec('f', LOCKED_PATH) ] }, { maxSize: 1000 }); },
            function (e) { return e.code === 'MULTIPART_FILE_UNREADABLE'; }, 'control: the locked file is unreadable when the cap allows it');
        assert.throws(function () { multipart.encode({ files: [ rec('f', LOCKED_PATH) ] }, { maxSize: 10 }); },
            function (e) { return e.code === 'MULTIPART_TOO_LARGE'; }, 'the size check ran before the read');
    });
});


// ─── 05 — source structure ───────────────────────────────────────────────────

describe('05 - source structure', function () {

    it('never deletes a staged file', function () {
        assert.equal(SRC.indexOf('unlink'), -1);
        assert.equal(SRC.indexOf('rmSync'), -1);
        assert.equal(SRC.indexOf('.rm('), -1);
    });

    it('the size check precedes the first readFileSync, and the boundary is drawn from a CSPRNG', function () {
        var cap  = SRC.indexOf("codedError('MULTIPART_TOO_LARGE'");
        var read = SRC.indexOf('fs.readFileSync(');
        assert.ok(cap > -1 && read > -1 && cap < read, 'cap check must come first');
        assert.ok(SRC.indexOf('crypto.randomBytes(24)') > -1);
    });

    it('exports exactly encode and flatten', function () {
        assert.deepEqual(Object.keys(multipart).sort(), ['encode', 'flatten']);
    });
});
