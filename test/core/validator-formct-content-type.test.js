'use strict';
/**
 * Validator AJAX Content-Type resolution (#FORMCT) tests
 *
 * Covers the browser-side validator plugin sending the right Content-Type
 * for its non-binary (JSON) request bodies.
 *
 * Bug being pinned: the validator serializes the form body as JSON
 * (JSON.stringify) but historically sent it with the urlencoded default
 * Content-Type. The gina server body parser, seeing
 * `application/x-www-form-urlencoded`, runs `body.replace(/\+/g, ' ')` +
 * decodeURIComponent BEFORE JSON.parse — corrupting `+` inside JSON string
 * values (e.g. email "+aliases": "alias+test@x" -> "alias test@x"). The
 * server side is correct and pinned by test/core/http-methods.test.js §12;
 * the fix is the client labelling the Content-Type to match the JSON body.
 *
 * Strategy:
 *  - Source-inspection guards pin the two send sites in main.js:
 *      * form-submit non-binary path (explicit-enctype-else-application/json)
 *      * file-removal xhrOptions default (application/json, JSON body)
 *  - Behavioural tests on a mirror of the resolution snippet:
 *      * JSON body, no explicit enctype          -> application/json
 *      * JSON body, explicit enctype (multipart)  -> the explicit enctype
 *      * non-JSON string body, no explicit enctype -> the urlencoded default
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');

var mainSrc;

before(function () {
    mainSrc = fs.readFileSync(MAIN, 'utf8');
});


// ─── 01 — Source inspection: the two #FORMCT send sites are present ─────────

describe('01 - source inspection: #FORMCT send sites', function () {

    it('form-submit non-binary path resolves explicit-enctype-else-json', function () {
        // !hasBinaries block: read explicit enctype, fall back to
        // application/json for a JSON body, else the urlencoded default.
        var re = /if \(!hasBinaries\)[\s\S]{0,400}#FORMCT[\s\S]{0,600}var explicitEnctype = \$target\.getAttribute\('enctype'\)[\s\S]{0,400}'application\/json; charset=UTF-8'[\s\S]{0,400}xhr\.setRequestHeader\('Content-Type', sendContentType\)/;
        assert.ok(re.test(mainSrc),
            'expected the #FORMCT explicit-enctype-else-json block on the non-binary send path');
    });

    it('file-removal xhrOptions defaults Content-Type to application/json', function () {
        // The file-removal POST body is JSON.stringify({ files }); the default
        // header must be application/json, not the urlencoded default.
        var re = /let xhrOptions = \{[\s\S]{0,400}#FORMCT[\s\S]{0,400}'Content-Type': 'application\/json; charset=UTF-8'[\s\S]{0,1200}xhr\.send\(JSON\.stringify\(\{ files: filesToBeRemoved \}\)\)/;
        assert.ok(re.test(mainSrc),
            'expected the file-removal xhrOptions to default to application/json with a JSON body');
    });

    it('non-binary send path no longer hard-codes the urlencoded default header', function () {
        // Guard against a regression to `setRequestHeader('Content-Type', enctype)`
        // with no application/json branch on the non-binary path.
        var block = mainSrc.slice(mainSrc.indexOf('if (!hasBinaries) {'));
        block = block.slice(0, block.indexOf('xhr.send(data)') + 20);
        assert.ok(/application\/json; charset=UTF-8/.test(block),
            'the non-binary send block must offer an application/json Content-Type');
    });
});


// ─── helpers — mirror of the resolution snippet in main.js ─────────────────
//
// Kept in lock-step with the source by the 01 source-inspection guards; this
// is the executable form of the `sendContentType` ternary on the non-binary
// path.
function resolveContentType(data, explicitEnctype, enctype) {
    return (explicitEnctype && explicitEnctype != '')
        ? explicitEnctype
        : ( (typeof(data) == 'string' && /^[\[{]/.test(data.trim()))
            ? 'application/json; charset=UTF-8'
            : enctype );
}

var URLENCODED = 'application/x-www-form-urlencoded; charset=UTF-8';
var JSON_CT    = 'application/json; charset=UTF-8';


// ─── 02 — Resolution: JSON body without an explicit enctype -> JSON ────────

describe('02 - JSON body, no explicit enctype -> application/json', function () {

    it('object body uses application/json', function () {
        var data = JSON.stringify({ account: { username: 'alias+test@example.test' } });
        assert.equal(resolveContentType(data, null, URLENCODED), JSON_CT);
    });

    it('array body uses application/json', function () {
        var data = JSON.stringify([1, 2, 3]);
        assert.equal(resolveContentType(data, null, URLENCODED), JSON_CT);
    });

    it('leading whitespace before the JSON still resolves to application/json', function () {
        assert.equal(resolveContentType('   {"a":1}', undefined, URLENCODED), JSON_CT);
    });

    it('empty-string explicit enctype is treated as absent', function () {
        assert.equal(resolveContentType('{"a":1}', '', URLENCODED), JSON_CT);
    });
});


// ─── 03 — Resolution: an explicit form enctype is honoured ─────────────────

describe('03 - explicit form enctype wins over the JSON default', function () {

    it('multipart/form-data enctype is preserved', function () {
        var data = JSON.stringify({ a: 1 });
        assert.equal(resolveContentType(data, 'multipart/form-data', null), 'multipart/form-data');
    });

    it('a custom enctype is preserved', function () {
        var data = JSON.stringify({ a: 1 });
        assert.equal(resolveContentType(data, 'application/vnd.custom+json', URLENCODED),
            'application/vnd.custom+json');
    });

    it('an explicit urlencoded enctype is preserved (opt back in)', function () {
        assert.equal(resolveContentType('{"a":1}', URLENCODED, JSON_CT), URLENCODED);
    });
});


// ─── 04 — Resolution: non-JSON / non-string bodies keep the default ────────

describe('04 - non-JSON bodies fall back to the resolved enctype', function () {

    it('a urlencoded string body keeps the urlencoded default', function () {
        assert.equal(resolveContentType('a=1&b=2', null, URLENCODED), URLENCODED);
    });

    it('a non-string body keeps the resolved enctype', function () {
        assert.equal(resolveContentType(undefined, null, URLENCODED), URLENCODED);
    });

    it('a plain (non-{/[) string keeps the resolved enctype', function () {
        assert.equal(resolveContentType('hello world', null, URLENCODED), URLENCODED);
    });
});


// ─── 05 — Regression: the '+' that the urlencoded header would corrupt ─────

describe('05 - the corruption the JSON Content-Type prevents', function () {

    it('a "+" alias email survives JSON.parse but is corrupted by urlencoded decode', function () {
        var body = JSON.stringify({ username: 'alias+test@example.test' });

        // application/json path — server JSON.parses the raw body, '+' intact.
        assert.equal(resolveContentType(body, null, URLENCODED), JSON_CT);
        assert.equal(JSON.parse(body).username, 'alias+test@example.test');

        // The urlencoded server pre-decode the fix avoids: replace(/\+/g,' ')
        // then decodeURIComponent BEFORE JSON.parse turns '+' into a space.
        var urlDecoded = decodeURIComponent(body.replace(/\+/g, ' '));
        assert.equal(JSON.parse(urlDecoded).username, 'alias test@example.test');
    });
});
