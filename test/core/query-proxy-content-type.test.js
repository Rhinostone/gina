'use strict';
/**
 * Inter-bundle proxy outbound Content-Type (#FORMCT2) tests
 *
 * Covers SuperController::query()'s HTTP/2 request prep keeping the
 * `application/json` label on the raw-JSON body it serializes itself.
 *
 * Bug being pinned: query() serializes the outbound inter-bundle body as raw
 * JSON (`queryData = JSON.stringify(data)`) and labels it `application/json`
 * — but the HTTP/2 request prep then forwarded the INCOMING request's
 * Content-Type unconditionally. When the incoming browser request is a plain
 * urlencoded form POST (canonical case: a haltedRequest resume), the
 * receiving bundle got raw JSON labeled urlencoded;
 * its parser (server.js processRequestData, urlencoded branch) then ran
 * `body.replace(/\+/g, ' ')` + decodeURIComponent on the JSON text,
 * corrupting `+`/`%XX` inside JSON string values (e.g. a "+alias" email
 * "alias+test@x" -> "alias test@x" -> 400 at the receiving bundle). Same
 * corruption #FORMCT fixed in the browser validator, relocated to the
 * server-side proxy. The server parser itself is correct and pinned by
 * test/core/http-methods.test.js §12.
 *
 * Strategy:
 *  - Source-inspection guards pin the two cooperating sites in controller.js:
 *      * query() serializing raw JSON + forcing the json mime
 *      * the #FORMCT2-guarded incoming-Content-Type forward
 *  - Behavioural tests on a mirror of the forward condition
 *  - A corruption demonstration showing what the urlencoded mislabel does to
 *    a JSON body carrying `+` (the stake being protected)
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW         = require('../fw');
var CONTROLLER = path.join(FW, 'core/controller/controller.js');

var controllerSrc;

before(function () {
    controllerSrc = fs.readFileSync(CONTROLLER, 'utf8');
});


// ─── 01 — Source inspection: the two #FORMCT2 cooperating sites ─────────────

describe('01 - source inspection: #FORMCT2 sites in controller.js', function () {

    it('query() serializes the put/post body as raw JSON', function () {
        assert.ok(controllerSrc.indexOf('queryData = JSON.stringify(data)') > -1,
            'expected query() to serialize the outbound body via JSON.stringify');
    });

    it('query() labels the outbound request with the json mime', function () {
        assert.ok(/options\.headers\['content-type'\] = local\.options\.conf\.server\.coreConfiguration\.mime\['json'\]/.test(controllerSrc),
            'expected query() to force the outbound content-type to the json mime');
    });

    it('the incoming-Content-Type forward carries the #FORMCT2 json guard', function () {
        var guarded = "local.req.headers['content-type'] != options.headers['content-type'] && !/application\\/json/i.test(options.headers['content-type'])";
        assert.ok(controllerSrc.indexOf(guarded) > -1,
            'expected the incoming-CT forward to skip application/json outbound bodies (#FORMCT2)');
        assert.ok(controllerSrc.indexOf('#FORMCT2') > -1,
            'expected the #FORMCT2 marker comment next to the guard');
    });

    it('no unguarded incoming-Content-Type forward remains', function () {
        var unguarded = "local.req.headers['content-type'] != options.headers['content-type'] ) {";
        assert.equal(controllerSrc.indexOf(unguarded), -1,
            'found an incoming-CT forward without the #FORMCT2 json guard');
    });
});


// ─── helpers — mirror of the forward condition in controller.js ─────────────
//
// Kept in lock-step with the source by the 01 source-inspection guards; this
// is the executable form of the guarded incoming-Content-Type forward.
function forwardIncomingContentType(incomingCT, outboundCT) {
    if ( typeof(incomingCT) != 'undefined' && incomingCT != outboundCT && !/application\/json/i.test(outboundCT) ) {
        return incomingCT;
    }
    return outboundCT;
}

var URLENCODED = 'application/x-www-form-urlencoded';
var JSON_CT    = 'application/json';


// ─── 02 — Forward resolution: json outbound bodies keep their label ─────────

describe('02 - json outbound body keeps application/json', function () {

    it('urlencoded incoming request does not re-label a json proxy body', function () {
        assert.equal(forwardIncomingContentType(URLENCODED, JSON_CT), JSON_CT);
    });

    it('charset-suffixed json label is also protected', function () {
        assert.equal(
            forwardIncomingContentType(URLENCODED + '; charset=UTF-8', JSON_CT + '; charset=utf8'),
            JSON_CT + '; charset=utf8');
    });

    it('multipart incoming request does not re-label a json proxy body', function () {
        assert.equal(forwardIncomingContentType('multipart/form-data; boundary=x', JSON_CT), JSON_CT);
    });

    it('absent incoming Content-Type keeps the outbound label', function () {
        assert.equal(forwardIncomingContentType(undefined, JSON_CT), JSON_CT);
    });
});


// ─── 03 — Forward resolution: non-json outbound bodies still forward ────────

describe('03 - non-json outbound body still forwards the incoming label', function () {

    it('text/plain outbound (MSIE override) takes the incoming Content-Type', function () {
        assert.equal(forwardIncomingContentType(URLENCODED, 'text/plain'), URLENCODED);
    });

    it('identical labels stay unchanged', function () {
        assert.equal(forwardIncomingContentType('text/plain', 'text/plain'), 'text/plain');
    });
});


// ─── 04 — Corruption demonstration: why the mislabel matters ─────────────────
//
// Mirror of the receiving parser's urlencoded branch (server.js
// processRequestData): `+` -> space, then decodeURIComponent. Raw JSON sent
// under that label is corrupted; under application/json it is parsed verbatim.

describe('04 - urlencoded mislabel corrupts +/% inside JSON string values', function () {

    var body = JSON.stringify({ account: { username: 'alias+test@example.test' } });

    it('urlencoded-branch handling corrupts the + inside a JSON string value', function () {
        var mangled = decodeURIComponent(body.replace(/\+/g, ' '));
        assert.equal(JSON.parse(mangled).account.username, 'alias test@example.test',
            'expected the demonstration to reproduce the +-to-space corruption');
    });

    it('verbatim (application/json) handling preserves the value', function () {
        assert.equal(JSON.parse(body).account.username, 'alias+test@example.test');
    });
});
