'use strict';
// #B297 — both download emitters produced a non-conformant `Content-Disposition` for any
// filename carrying a space (or `;`, `,`, `"`): the value was appended as a bare token,
// which RFC 6266 reserves for space-less names. Consumer-measured on the wire against
// real documents whose titles are user-supplied — spaces are the common case. Both sites
// (the downloadFromURL `attachment` upgrade and downloadFromLocal's setHeader) now emit
// through ONE module-scope pure helper — formatAttachmentDisposition — which quotes the
// filename and backslash-escapes `"` and `\` so the value cannot terminate early.
//
// SEQUENCING (why this ships with, never before, #B290): the client blob-download parse
// used to retain a quoted-string's delimiters, so quoting the emission alone would have
// regressed every consumer download. The §03 round-trip below executes BOTH shipped
// sides and locks that contract permanently.
//
// Red-first (validated 2026-08-07 against `git show HEAD:` pre-#B297 bytes): the §00
// extraction control fails pre-fix (the helper does not exist), and the §02 negatives
// read 1 each pre-fix (the two retired concatenation shapes), 0 post.

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var os   = require('os');
var path = require('path');

var FW = require('../fw');

var SOURCE     = path.join(FW, 'core/controller/controller.js');
var EVENTS_SRC = path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/events.js');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }

function countOf(haystack, needle) {
    var c = 0, i = haystack.indexOf(needle);
    while (i > -1) { c++; i = haystack.indexOf(needle, i + needle.length); }
    return c;
}

// started-flag brace walker — both extracted helpers are brace-free inside literals
function extractFunction(src, decl) {
    var declIdx = src.indexOf(decl);
    if (declIdx === -1) { throw new Error('declaration `' + decl + '` not found'); }
    if (src.indexOf(decl, declIdx + 1) !== -1) { throw new Error('declaration `' + decl + '` is not unique'); }
    var i = declIdx, depth = 0, started = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        else if (src[i] === '}') { depth--; if (started && depth === 0) { i++; break; } }
    }
    if (!started || depth !== 0) { throw new Error('brace walk did not terminate balanced'); }
    return src.slice(declIdx, i);
}

var DECL = 'function formatAttachmentDisposition(';

var format = null;

before(function () {
    var fnSrc = extractFunction(read(SOURCE), DECL);
    format = new Function('return (' + fnSrc + ');')();
});


// ── 00 — instrument controls ──────────────────────────────────────────────────

describe('00 - extraction controls', function () {

    it('the declaration exists exactly once, at module scope', function () {
        assert.equal(countOf(read(SOURCE), DECL), 1);
        assert.match(read(SOURCE), /^function formatAttachmentDisposition\(/m,
            'a column-0 declaration cannot sit inside SuperController');
    });

    it('the extraction produced a callable (real bytes, no replica)', function () {
        assert.equal(typeof format, 'function');
    });
});


// ── 01 — behavioral matrix on the extracted shipped bytes ─────────────────────

describe('01 - the emitted value is a conformant RFC 6266 quoted-string', function () {

    it('a filename with spaces is quoted (the consumer-measured defect shape)', function () {
        assert.equal(format('monthly report 2026.pdf'),
            'attachment; filename="monthly report 2026.pdf"');
    });

    it('a plain token is quoted too — one uniform emission shape', function () {
        assert.equal(format('report.pdf'), 'attachment; filename="report.pdf"');
    });

    it('a double quote inside the name is backslash-escaped', function () {
        assert.equal(format('a "b".pdf'), 'attachment; filename="a \\"b\\".pdf"');
    });

    it('a backslash inside the name is backslash-escaped', function () {
        assert.equal(format('a\\b.pdf'), 'attachment; filename="a\\\\b.pdf"');
    });

    it('a semicolon inside the name can no longer split the header', function () {
        assert.equal(format('a;b.pdf'), 'attachment; filename="a;b.pdf"');
    });

    it('a non-string input is coerced, never thrown on', function () {
        assert.equal(format(42), 'attachment; filename="42"');
    });
});


// ── 02 — wiring: both emission sites call the helper; the old shapes are gone ─

describe('02 - call-site wiring at both emission sites', function () {

    it('the downloadFromURL attachment upgrade calls the helper', function () {
        assert.equal(countOf(read(SOURCE),
            'opt.contentDisposition = formatAttachmentDisposition(filename);'), 1);
    });

    it('downloadFromLocal emits through the helper', function () {
        assert.equal(countOf(read(SOURCE),
            "setHeader('content-disposition', formatAttachmentDisposition(file));"), 1);
    });

    it('the retired upgrade concatenation is gone (1 pre / 0 post)', function () {
        assert.equal(countOf(read(SOURCE), "opt.contentDisposition += '; filename='"), 0);
    });

    it('the retired local concatenation is gone (1 pre / 0 post)', function () {
        assert.equal(countOf(read(SOURCE), "'attachment; filename=' + file"), 0);
    });
});


// ── 03 — round-trip with the #B290 client parse (both sides are shipped bytes) ─

describe('03 - server emission parses back to the exact filename on the client', function () {

    var parseFilename = null;

    before(function () {
        var fnSrc = extractFunction(read(EVENTS_SRC), 'function getFilenameFromContentDisposition(');
        parseFilename = new Function('return (' + fnSrc + ');')();
    });

    it('every filename shape survives the emit -> parse round trip identically', function () {
        var names = [
            'plain.pdf',
            'monthly report 2026.pdf',
            'a "quoted" name.pdf',
            'back\\slash.pdf',
            'semi;colon.pdf'
        ];
        names.forEach(function (name) {
            assert.equal(parseFilename(format(name)), name,
                'round trip must be identity for: ' + name);
        });
    });
});


// ── 04 — behavioral: downloadFromLocal emits the quoted header on the wire ────
// Runtime (require + createTestInstance) test — needs the framework-globals bootstrap
// (NODE_PATH + Module._initPaths + helpers + setPath), mirroring controller.test.js §36.

describe('04 - downloadFromLocal wire emission (behavioral, real SuperController)', function () {

    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));              // injects _/getPath/requireJSON/setPath globals
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);
    var { Writable } = require('stream');

    var tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-download-'));
    var tmpFile = path.join(tmpDir, 'monthly report 2026.pdf');
    fs.writeFileSync(tmpFile, 'PDFBYTES');

    after(function () {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function makeRes(record) {
        var chunks = [];
        var res = new Writable({
            write: function (chunk, enc, cb) { chunks.push(chunk); cb(); }
        });
        res.setHeader  = function (k, v) { record[k] = v; };
        res.getContent = function () { return Buffer.concat(chunks).toString(); };
        return res;
    }

    it('emits the quoted disposition, the mapped content-type, and pipes the file', async function () {
        var headers = {};
        var res     = makeRes(headers);
        var inst    = SuperController.createTestInstance({
            req     : { url: '/x', method: 'GET', routing: { rule: 'r' }, params: {}, get: {}, post: {} },
            res     : res,
            options : {
                rule : 'r',
                conf : {
                    bundle  : 'b',
                    content : { routing: { r: {} } },
                    server  : { coreConfiguration: { mime: { pdf: 'application/pdf' } } }
                }
            }
        });

        var timer = null;
        var finished = new Promise(function (resolve) { res.on('finish', resolve); });
        var guard    = new Promise(function (ignore, reject) {
            timer = setTimeout(function () { reject(new Error('pipe never finished')); }, 5000);
        });

        inst.downloadFromLocal(tmpFile);
        await Promise.race([finished, guard]);
        clearTimeout(timer);

        assert.equal(headers['content-disposition'],
            'attachment; filename="monthly report 2026.pdf"');
        assert.equal(headers['content-type'], 'application/pdf');
        assert.equal(res.getContent(), 'PDFBYTES');
    });
});
