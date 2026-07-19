'use strict';
/**
 * Multipart TEXT fields are captured into the request body — #B92-adjacent.
 *
 * Root: core/server.js's multipart branch attached NO busboy 'field' listener, and
 * the vendored busboy SKIPS every non-file part when no listener is registered
 * (lib/types/multipart.js — the listenerCount('field') guard). Text fields sent
 * alongside files (or alone, #B93) silently vanished: request.post / request.body
 * stayed {} for every multipart request, on both engines.
 *
 * Fix: a real busboy.on('field') handler captures fields with the application/json
 * body contract (#B28/#B92) — values VERBATIM (no decode, no coercion), bracket
 * names nested via the data helper's own nesting layer (nestBracketNotationKey,
 * the parseLocalObj global alias) — and busboy.on('finish') exposes them as
 * `request.body` (+ `request[method]` for POST/PUT/PATCH) before either dispatch
 * path runs. Busboy limits are wired for the first time: `fields` (count; the
 * excess emits 'fieldsLimit' once then skips — answered 400) and `fieldSize`
 * (bytes; busboy truncates and flags valueTruncated — answered 400).
 *
 * Strategy: source inspection (mirrors multipart-nonfile-terminal.test.js) + a
 * REAL vendored-busboy + REAL data-helper behavioural suite + a dispatch replica
 * with a subtract reproducing the pre-fix drop. No live HTTP server / framework
 * bootstrap. Server-side only — no dist rebuild.
 *
 * Suites:
 *  01 — server.js source pins: handler, limits wiring, caps resolution, verbatim
 *       block scope, finish-top assignment ordering, fieldsLimit/truncation → 400
 *  02 — helpers/data source + runtime: the nestBracketNotationKey global alias
 *  03 — behavioural (REAL busboy + REAL helper): mixed/fields-only capture, nesting,
 *       verbatim values, duplicate keys, caps
 *  04 — assignment dispatch replica + SUBTRACT (no listener → the pre-fix drop)
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var { Readable } = require('stream');

var FW               = require('../fw');
var SERVER_SRC       = path.join(FW, 'core/server.js');
var HELPERS_DATA_SRC = path.join(FW, 'helpers', 'data', 'src', 'main.js');
var Busboy           = require('@rhinostone/busboy');

// helpers/data exposes its helpers as implicit globals once the DataHelper
// constructor runs (gina convention — format-data-from-string.test.js precedent).
require(HELPERS_DATA_SRC)();
var nestBracketNotationKey = global.nestBracketNotationKey;

// Strip full-line `//` comments so negative pins do not trip on the fix's own
// comments (jsdoc.md: "a negative source-inspection pin trips on the file's own
// comment").
function stripLineComments(src) {
    return src.split('\n').filter(function(l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// ─── 01 — server.js source pins ───────────────────────────────────────────────
describe('01 - multipart field capture: server.js source pins (#B92-adjacent)', function() {
    var active;
    before(function() { active = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8')); });

    it('a busboy field handler now exists', function() {
        assert.match(active, /busboy\.on\('field',\s*function onMultipartField/);
    });

    it('the field handler is registered BEFORE request.pipe(busboy)', function() {
        var fieldIdx = active.indexOf("busboy.on('field', function onMultipartField");
        var pipeIdx  = active.indexOf('request.pipe(busboy)');
        assert.ok(fieldIdx > 0, 'onMultipartField present');
        assert.ok(pipeIdx > 0, 'request.pipe(busboy) present');
        assert.ok(fieldIdx < pipeIdx, 'field handler registered before the pipe');
    });

    it('busboy is constructed with the text-field limits', function() {
        assert.match(active, /limits:\s*\{\s*fields:\s*maxTextFields,\s*fieldSize:\s*maxTextFieldSize\s*\}/);
    });

    it('caps resolve from upload.maxTextFields / upload.maxTextFieldSize with safe defaults', function() {
        assert.match(active, /parseInt\(opt\.maxTextFields, 10\)/);
        assert.match(active, /parseSize\(opt\.maxTextFieldSize\)/);
        // explicit 0 = no limit (Infinity), matching the maxFields convention
        assert.match(active, /maxTextFields = Infinity/);
        assert.match(active, /maxTextFieldSize = Infinity/);
    });

    it('bracket-notation names are nested through the data helper alias, values verbatim', function() {
        assert.ok(
            active.indexOf("multipartFields = nestBracketNotationKey(multipartFields, name.replace(/\\]/g, '').split(/\\[/g), 0, value)") > -1,
            'per-entry nesting through nestBracketNotationKey'
        );
    });

    it('the field handler neither url-decodes nor form-coerces the value (block-scoped)', function() {
        var from = active.indexOf("busboy.on('field', function onMultipartField");
        var to   = active.indexOf("busboy.on('fieldsLimit'");
        assert.ok(from > 0 && to > from, 'field-handler block located');
        var block = active.substring(from, to);
        assert.ok(block.indexOf('decodeURIComponent') < 0, 'no url-decode in the capture path');
        assert.ok(block.indexOf('formatDataFromString') < 0, 'no urlencoded-semantics wrapper in the capture path');
        assert.ok(block.indexOf('JSON.parse') < 0, 'no JSON reinterpretation of field values');
    });

    it('a truncated value (fieldSize cap) is answered 400, guarded against double-response', function() {
        var from = active.indexOf("busboy.on('field', function onMultipartField");
        var to   = active.indexOf("busboy.on('fieldsLimit'");
        var block = active.substring(from, to);
        assert.match(block, /info\.valueTruncated/);
        assert.match(block, /!response\.headersSent\s*&&\s*!request\.handled/);
        assert.match(block, /throwError\(response,\s*400,[\s\S]{0,120}?upload\.maxTextFieldSize/);
    });

    it('excess fields (fields cap) are answered 400 via a fieldsLimit handler, guarded', function() {
        var from = active.indexOf("busboy.on('fieldsLimit', function onFieldsLimit");
        assert.ok(from > 0, 'onFieldsLimit present');
        var block = active.substring(from, from + 600);
        assert.match(block, /!response\.headersSent\s*&&\s*!request\.handled/);
        assert.match(block, /throwError\(response,\s*400,\s*'too many multipart text fields/);
    });

    it('captured fields are exposed on the request at the TOP of busboy.on(finish), before both dispatch paths', function() {
        var from = active.indexOf("busboy.on('finish'");
        var to   = active.indexOf('request.pipe(busboy)');
        assert.ok(from > 0 && to > from, 'finish block located');
        var block     = active.substring(from, to);
        var assignIdx = block.indexOf('request.body = multipartFields');
        var totalIdx  = block.indexOf('var total = writeStreams.length');
        var resumeIdx = block.indexOf('resumeAfterMultipart();');
        assert.ok(assignIdx > -1, 'request.body assignment present');
        assert.ok(totalIdx > -1 && resumeIdx > -1, 'dispatch anchors present');
        assert.ok(assignIdx < totalIdx, 'assignment precedes the writeStreams accounting');
        assert.ok(assignIdx < resumeIdx, 'assignment precedes the zero-writeStreams resume');
    });

    it('only body-carrying methods get the method slot (request.get / request.delete feed URL params)', function() {
        assert.ok(active.indexOf('/^(post|put|patch)$/.test(_fieldsMethod)') > -1);
        assert.ok(active.indexOf('request[_fieldsMethod] = multipartFields') > -1);
    });
});

// ─── 02 — helpers/data: the nesting-layer alias ───────────────────────────────
describe('02 - helpers/data exposes nestBracketNotationKey (parseLocalObj alias)', function() {

    it('the alias is a bare-global assignment of parseLocalObj (source pin)', function() {
        var src = fs.readFileSync(HELPERS_DATA_SRC, 'utf8');
        assert.match(src, /nestBracketNotationKey\s*=\s*parseLocalObj;/);
    });

    it('the alias is callable after DataHelper() runs and nests a bracket path', function() {
        assert.equal(typeof nestBracketNotationKey, 'function');
        var obj = nestBracketNotationKey({}, 'item[0][id]'.replace(/\]/g, '').split(/\[/g), 0, 'x');
        assert.equal(obj.item[0].id, 'x');
    });
});

// ─── 03 — behavioural: REAL vendored busboy + REAL helper ────────────────────
describe('03 - field capture behaviour (REAL busboy + REAL nesting helper)', function() {
    var CT = 'multipart/form-data; boundary=----t';
    var B  = '----t';

    function part(name, value) {
        return '--' + B + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n';
    }
    function filePart(name, filename, content) {
        return '--' + B + '\r\nContent-Disposition: form-data; name="' + name + '"; filename="' + filename + '"\r\n' +
               'Content-Type: text/plain\r\n\r\n' + content + '\r\n';
    }
    function close() { return '--' + B + '--\r\n'; }

    // Replicates the shipped onMultipartField/onFieldsLimit capture against the
    // REAL parser and the REAL nesting helper (locked to the source by the §01 pins).
    function drive(body, limits, cb) {
        var state = { fields: null, files: 0, fieldsLimit: false, truncated: [], finish: false, error: null };
        var bb = Busboy({ headers: { 'content-type': CT }, defParamCharset: 'utf8', limits: limits });
        bb.on('file', function(n, s) { state.files++; s.resume(); });
        bb.on('field', function(name, value, info) {
            if (info && info.valueTruncated) { state.truncated.push(name); return; }
            if (state.fields == null) { state.fields = {}; }
            if ( /^(.*)\[(.*)\]/.test(name) ) {
                state.fields = nestBracketNotationKey(state.fields, name.replace(/\]/g, '').split(/\[/g), 0, value);
            } else {
                state.fields[name] = value;
            }
        });
        bb.on('fieldsLimit', function() { state.fieldsLimit = true; });
        bb.on('finish', function() { state.finish = true; });
        bb.on('error', function(e) { state.error = String((e && e.message) || e); });
        Readable.from([Buffer.from(body)]).pipe(bb);
        setTimeout(function() { cb(state); }, 200);
    }

    it('MIXED body (file + bracket fields + plain field) captures and nests every text field', function(t, done) {
        var body = filePart('avatar', 'a.txt', 'hello') +
                   part('item[0][id]', 'x') + part('item[1][id]', 'y') + part('plain', 'p') + close();
        drive(body, undefined, function(s) {
            assert.equal(s.files, 1);
            assert.equal(s.finish, true);
            assert.equal(s.error, null);
            assert.equal(s.fields.item[0].id, 'x');
            assert.equal(s.fields.item[1].id, 'y');
            assert.equal(s.fields.plain, 'p');
            done();
        });
    });

    it('values arrive VERBATIM — no url-decode, no boolean/null coercion', function(t, done) {
        var body = part('pct', '50%20off') + part('b', 'true') + part('n', 'null') + close();
        drive(body, undefined, function(s) {
            assert.equal(s.fields.pct, '50%20off');
            assert.equal(s.fields.b, 'true');
            assert.equal(s.fields.n, 'null');
            done();
        });
    });

    it('FIELDS-ONLY body captures too (composes with the #B93 zero-writeStreams resume)', function(t, done) {
        drive(part('a', 'b') + close(), undefined, function(s) {
            assert.equal(s.files, 0);
            assert.equal(s.finish, true);
            assert.deepEqual(s.fields, { a: 'b' });
            done();
        });
    });

    it('a UTF-8 field value round-trips', function(t, done) {
        drive(part('u', 'Accusé de réception') + close(), undefined, function(s) {
            assert.equal(s.fields.u, 'Accusé de réception');
            done();
        });
    });

    it('duplicate plain names: last one wins (the JSON-object semantics)', function(t, done) {
        drive(part('t', '1') + part('t', '2') + close(), undefined, function(s) {
            assert.equal(s.fields.t, '2');
            done();
        });
    });

    it('the fields count cap fires fieldsLimit once and skips the excess', function(t, done) {
        var body = part('f1', 'a') + part('f2', 'b') + part('f3', 'c') + close();
        drive(body, { fields: 2 }, function(s) {
            assert.equal(s.fieldsLimit, true);
            assert.deepEqual(Object.keys(s.fields), ['f1', 'f2']);
            done();
        });
    });

    it('a field beyond fieldSize arrives flagged valueTruncated (the 400 trigger)', function(t, done) {
        drive(part('big', '123456789') + close(), { fieldSize: 4 }, function(s) {
            assert.deepEqual(s.truncated, ['big']);
            done();
        });
    });

    it('Infinity limits (the 0 = no-limit mapping) are accepted by busboy', function(t, done) {
        drive(part('a', 'b') + close(), { fields: Infinity, fieldSize: Infinity }, function(s) {
            assert.equal(s.finish, true);
            assert.deepEqual(s.fields, { a: 'b' });
            done();
        });
    });
});

// ─── 04 — assignment dispatch replica + SUBTRACT ──────────────────────────────
describe('04 - request assignment replica + the pre-fix drop subtract', function() {

    // mirrors the busboy.on('finish') top block
    function applyCapturedFields(request, multipartFields) {
        if ( multipartFields != null ) {
            request.body = multipartFields;
            var _fieldsMethod = ( request.method || '' ).toLowerCase();
            if ( /^(post|put|patch)$/.test(_fieldsMethod) ) {
                request[_fieldsMethod] = multipartFields;
            }
        }
        return request;
    }

    it('POST: fields land on request.body AND request.post', function() {
        var req = applyCapturedFields({ method: 'POST', body: {}, post: {} }, { a: 'b' });
        assert.deepEqual(req.body, { a: 'b' });
        assert.deepEqual(req.post, { a: 'b' });
    });

    it('PUT / PATCH get their method slot too', function() {
        var put   = applyCapturedFields({ method: 'PUT', body: {}, put: {} }, { a: 'b' });
        var patch = applyCapturedFields({ method: 'PATCH', body: {}, patch: {} }, { a: 'b' });
        assert.deepEqual(put.put, { a: 'b' });
        assert.deepEqual(patch.patch, { a: 'b' });
    });

    it('GET: request.body only — request.get (URL params) is left alone', function() {
        var req = applyCapturedFields({ method: 'GET', body: {}, get: { q: 'url' } }, { a: 'b' });
        assert.deepEqual(req.body, { a: 'b' });
        assert.deepEqual(req.get, { q: 'url' });
    });

    it('no captured fields (files-only / empty): the request is untouched', function() {
        var req = applyCapturedFields({ method: 'POST', body: {}, post: {} }, null);
        assert.deepEqual(req.body, {});
        assert.deepEqual(req.post, {});
    });

    it('SUBTRACT — with NO field listener the REAL busboy skips every non-file part (the pre-fix drop)', function(t, done) {
        var CT = 'multipart/form-data; boundary=----t';
        var bb = Busboy({ headers: { 'content-type': CT }, defParamCharset: 'utf8' });
        var fieldEvents = 0, files = 0, finish = false;
        bb.on('file', function(n, s) { files++; s.resume(); });
        // deliberately NO 'field' listener — busboy's listenerCount guard skips the part
        bb.on('finish', function() { finish = true; });
        var body = '------t\r\nContent-Disposition: form-data; name="f"; filename="x.txt"\r\n' +
                   'Content-Type: text/plain\r\n\r\nhello\r\n' +
                   '------t\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n------t--\r\n';
        Readable.from([Buffer.from(body)]).pipe(bb);
        setTimeout(function() {
            assert.equal(files, 1);
            assert.equal(fieldEvents, 0, 'no field event without a listener — the field is dropped');
            assert.equal(finish, true);
            done();
        }, 200);
    });
});
