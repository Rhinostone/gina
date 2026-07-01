'use strict';
/**
 * Upload filename charset — decode the Content-Disposition `filename=` param as
 * UTF-8, not busboy's latin1 default.
 *
 * Bug: a UTF-8 filename ("Accusé de réception.pdf") uploaded through the plain
 * `filename=` param was emitted mojibaked ("AccusÃ© de rÃ©ception.pdf") because
 * the vendored busboy builds its param decoder from `cfg.defParamCharset`, which
 * defaults to latin1. server.js now constructs Busboy with `defParamCharset:'utf8'`.
 *
 * Strategy: source inspection + a behavior replica fed straight to the vendored
 * busboy (no live HTTP server, no framework bootstrap, no project required —
 * mirrors upload-groups.test.js).
 *
 * Suites:
 *  01 — server.js source: Busboy is constructed with defParamCharset:'utf8'
 *  02 — vendored busboy behavior: latin1 default mojibakes a UTF-8 filename;
 *       defParamCharset:'utf8' decodes it correctly; RFC 5987 filename* is unaffected
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW         = require('../fw');
var SERVER_SRC = path.join(FW, 'core/server.js');
var Busboy     = require(path.join(FW, 'core/deps/busboy-1.6.0'));

var BOUNDARY = '----ginauploadfilenamecharset';

// Build a multipart/form-data body whose Content-Disposition carries the given
// filename in the PLAIN `filename=` param (the gina-SDK shape: raw UTF-8 bytes,
// no RFC 5987 filename*). `extended:true` adds a filename* alongside it.
function multipartBody(name, opts) {
    opts = opts || {};
    var disp = 'Content-Disposition: form-data; name="file"; filename="' + name + '"';
    if (opts.extended) {
        disp += "; filename*=UTF-8''" + encodeURIComponent(name);
    }
    return Buffer.concat([
        Buffer.from('--' + BOUNDARY + '\r\n' + disp + '\r\n'
                    + 'Content-Type: application/pdf\r\n\r\n', 'utf8'),
        Buffer.from('PDFDATA', 'utf8'),
        Buffer.from('\r\n--' + BOUNDARY + '--\r\n', 'utf8')
    ]);
}

// Run the vendored busboy over a multipart body and resolve the emitted filename.
function parseFilename(name, cfg, opts) {
    return new Promise(function (resolve, reject) {
        var bb = Busboy(Object.assign(
            { headers: { 'content-type': 'multipart/form-data; boundary=' + BOUNDARY } },
            cfg || {}
        ));
        var got = null;
        bb.on('file', function (fieldname, file, filename) { got = filename; file.resume(); });
        bb.on('close', function () { resolve(got); });
        bb.on('error', reject);
        bb.end(multipartBody(name, opts));
    });
}

// ─── 01 — server.js source: the fix is present ────────────────────────────────
describe('01 - upload filename charset: server.js constructs Busboy with utf8', function () {
    var src;
    before(function () { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    it('passes defParamCharset:\'utf8\' to the Busboy constructor', function () {
        assert.match(src, /Busboy\(\{\s*headers:\s*request\.headers,\s*defParamCharset:\s*'utf8'\s*\}\)/);
    });

    it('no longer constructs Busboy with headers alone (the latin1-default form)', function () {
        assert.doesNotMatch(src, /Busboy\(\{\s*headers:\s*request\.headers\s*\}\)/);
    });
});

// ─── 02 — vendored busboy behavior ────────────────────────────────────────────
describe('02 - upload filename charset: vendored busboy decode behavior', function () {
    var UTF8_NAME = 'Accusé de réception.pdf';
    var MOJIBAKE  = 'AccusÃ© de rÃ©ception.pdf';

    it('default (latin1) mojibakes a UTF-8 filename — the bug', async function () {
        assert.equal(await parseFilename(UTF8_NAME, {}), MOJIBAKE);
    });

    it('defParamCharset:\'utf8\' decodes the plain filename= param correctly — the fix', async function () {
        assert.equal(await parseFilename(UTF8_NAME, { defParamCharset: 'utf8' }), UTF8_NAME);
    });

    it('an ASCII filename is unaffected by either charset', async function () {
        assert.equal(await parseFilename('report.pdf', {}), 'report.pdf');
        assert.equal(await parseFilename('report.pdf', { defParamCharset: 'utf8' }), 'report.pdf');
    });

    it('RFC 5987 filename* is self-describing — correct regardless of defParamCharset', async function () {
        // filename* is preferred over filename and carries its own charset, so it
        // decodes correctly even under the latin1 default.
        assert.equal(await parseFilename(UTF8_NAME, {}, { extended: true }), UTF8_NAME);
    });
});
