'use strict';
/**
 * #B842 — on an HTML request, core/server.js's `throwError` dispatches the bundle's custom error
 * page through `router.route()`. When building the error-page controller raises, the router's
 * catch calls `throwError(response, 500, err.stack)` again for the same request, and that call
 * dispatched the page again: the cycle repeated until the call stack overflowed and the bundle
 * exited, with no answer sent. The render-time guard (`isRenderingCustomError`) never fired: the
 * exception comes before render.
 *
 * The fix marks the request when its error page is dispatched — `_req._ginaErrorPageDispatched`,
 * a property on the request object `throwError` already resolves, so the extracted function still
 * compiles with the #B806 closure inputs — and skips the dispatch for a request that carries the
 * mark: it falls through to the built-in page, answered under the ref of the call that answers.
 *
 *  01 extraction controls — the slice captured the real function.
 *  02 a dispatch that raises: router.route runs once and the request gets ONE answer — 500, the
 *     built-in page, carrying the ref of the second call — with one pairing line per call.
 *  03 control: a dispatch that does not raise — router.route runs once and throwError writes
 *     nothing itself (the error page answers), as before the fix.
 *  04 the mark belongs to its request: after request A's re-entry, request B's page is dispatched.
 *  05 a later throwError for the same request (its dispatch returned, no answer yet) is answered
 *     with the built-in page; the page is not dispatched a second time.
 *  06 source pins (comment-stripped).
 *
 * The router stub models core/router.js: it raises while building the controller and its catch
 * calls throwError(res, 500, err.stack). It stops raising after RE_ENTRY_CAP dispatches of one
 * request, so the pre-change bytes read a bounded count instead of overflowing the stack, and no
 * arm reads an engine's own error text.
 *
 * Seam: GINA_SERVER_SRC=<absolute file> runs every arm against that text. Red-first against the
 * pre-change bytes (`git show <sha>:<fw>/core/server.js > <file>`): §02, §05 and the §06 pins read
 * RED; §01, §03 and §04 stay GREEN. No arm waits on a callback — each settles synchronously.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');

var FW     = require('../fw');
var SOURCE = process.env.GINA_SERVER_SRC || path.join(FW, 'core/server.js');
require(path.join(FW, 'helpers')); // real safeDecodeURI, __stack, JSON.clone, count()
var SRC = fs.readFileSync(SOURCE, 'utf8');

/** @constant {number} Dispatches of one request after which the stub stops raising. */
var RE_ENTRY_CAP = 50;

function once(needle) {
    var i = SRC.indexOf(needle);
    assert.ok(i > -1 && SRC.indexOf(needle, i + 1) === -1, 'anchor not found exactly once: ' + needle);
    return i;
}
function sliceTo(start, endNeedle) {
    var e = SRC.indexOf(endNeedle, start);
    assert.ok(e > -1, 'end anchor not found: ' + endNeedle);
    return SRC.slice(start, e + endNeedle.length);
}

var TE_SRC   = SRC.slice(once('    var throwError = function(res, code, msg, next) {'), once('\n};\n\nServer = inherits(Server, EventEmitter);'));
var ESC2_SRC = SRC.slice(SRC.indexOf('function escapeLogControlChars(value) {'), SRC.indexOf('/**\n * #B662'));
var GRP_SRC  = sliceTo(once('    var getResponseProtocol = function (response) {'), '\n    }\n');
var MINT_SRC = sliceTo(once('var _mintErrorRef = function(supplied) {'), '\n};\n');
var ESC_SRC  = sliceTo(once('var _escapeHtml = function(value) {'), '\n};\n');
var LANG_SRC = sliceTo(once('var a11yLangTag = function(req) {'), '\n};\n');
var DOC_SRC  = sliceTo(once('var a11yErrorDocument = function(code, bodyHtml, req) {'), '\n};\n');

var H = new Function('crypto', MINT_SRC + ESC_SRC + LANG_SRC + DOC_SRC +
    '\nreturn { _mintErrorRef: _mintErrorRef, _escapeHtml: _escapeHtml, a11yErrorDocument: a11yErrorDocument };')(crypto);

/**
 * Builds the real `throwError` with the #B806 closure inputs and a router stub.
 *
 * @param {object} opts
 * @param {function(object):boolean} opts.raises - true when dispatching this request's error page raises
 * @returns {{throwError: function, calls: string[], logs: string[], dispatches: object}}
 */
function makeServer(opts) {
    var calls = [], logs = [], dispatches = {};
    var S = {};
    var local = {
        router: { route: function (req, res, next, routing) {
            dispatches[req.tag] = (dispatches[req.tag] || 0) + 1;
            calls.push('router.route(req=' + req.tag + ', rule=' + (routing && routing.rule) + ')');
            if (!opts.raises(req) || dispatches[req.tag] >= RE_ENTRY_CAP) { return; }
            // core/router.js: `new Controller(options)` raises, the route's catch answers it
            try { throw new TypeError('b842 dispatch raised for ' + req.tag); }
            catch (err) { S.throwError(res, 500, err.stack); }
        } },
        hasViews: { fixtureapp: true }
    };
    var self = {
        appName: 'fixtureapp', env: 'prod', instance: {},
        conf: { fixtureapp: { prod: {
            template: true, encoding: 'utf-8',
            server: { protocol: 'http/1.1', response: { header: {} },
                coreConfiguration: { statusCodes: { 404: 'Not Found', 500: 'Internal Server Error' },
                                     mime: { html: 'text/html', json: 'application/json' } } },
            content: { templates: { _common: { errorFiles: { 500: 'errors/500.html', '5xx': 'errors/5xx.html' } } } }
        } } },
        isLocalScope: function () { return false; },
        isCacheless: function () { return false; }
    };
    var completeHeaders = function (h) { return h; };
    var checkPreflightRequest = function (req) { return req; };
    var routingLib = { getRoute: function () { return { param: {} }; } };
    var hasViews = function () { return true; };
    var con = { error: function (s) { logs.push(String(s)); }, log: function () {}, warn: function () {}, info: function () {}, debug: function () {} };
    var getResponseProtocol = new Function('local', 'self', GRP_SRC + '\nreturn getResponseProtocol;')(local, self);
    S.throwError = new Function('local', 'self', 'hasViews', 'getResponseProtocol', '_mintErrorRef', 'checkPreflightRequest',
        'completeHeaders', 'safeDecodeURI', 'routingLib', '_escapeHtml', 'a11yErrorDocument', 'console',
        ESC2_SRC + TE_SRC + '\nreturn throwError;')(local, self, hasViews, getResponseProtocol, H._mintErrorRef, checkPreflightRequest,
        completeHeaders, global.safeDecodeURI, routingLib, H._escapeHtml, H.a11yErrorDocument, con);
    return { throwError: S.throwError, calls: calls, logs: logs, dispatches: dispatches };
}

function mkReq(tag) {
    return { tag: tag, method: 'POST', url: '/echo', httpVersion: '1.1', isXMLRequest: false,
             headers: { 'user-agent': 'test/1' }, _ginaReqId: 'rid-' + tag, routing: { rule: 'echo-of-' + tag } };
}
function mkRes(tag, ownReq) {
    var r = { tag: tag, req: ownReq, headersSent: false, statusCode: 200, head: null, body: null, writes: 0, ends: 0, _h: {} };
    r.writeHead = function (code, h) { r.writes++; r.head = { code: code, contentType: h && h['content-type'] }; };
    r.end = function (b) { r.ends++; r.body = String(b); r.headersSent = true; };
    r.setHeader = function (k, v) { r._h[String(k).toLowerCase()] = v; };
    r.getHeader = function (k) { return r._h[String(k).toLowerCase()]; };
    r.getHeaders = function () { return r._h; };
    return r;
}

/** What one response carries: its form, the ref in its body, and the ref of each pairing line. */
function read(S, res) {
    var form = res.body == null ? 'none' : (/^<!doctype html>/i.test(res.body) ? 'html' : 'other');
    var pairs = S.logs.map(function (l) {
        var m = l.match(/\]\[ ref ([0-9A-F]{6}) \]\[ req ([^ ]+) \]/);
        return m ? { ref: m[1], req: m[2] } : null;
    }).filter(Boolean);
    return {
        form: form, status: res.head && res.head.code, contentType: res.head ? res.head.contentType : null,
        builtIn: res.body != null && res.body.indexOf('<h1>Error 500.</h1>') > -1,
        bodyRef: ((res.body || '').match(/ref ([0-9A-F]{6})<\/pre>/) || [])[1] || null,
        writes: res.writes, ends: res.ends, pairs: pairs
    };
}

// ─── 01 — extraction controls ────────────────────────────────────────────────
describe('#B842 §01 — extraction controls', function () {
    it('the throwError slice captured the real function and its custom-error dispatch', function () {
        assert.ok(TE_SRC.indexOf('var isXMLRequest    = ') > -1, 'throwError slice');
        assert.ok(TE_SRC.indexOf('router.route(_req, res, next, _req.routing);') > -1, 'custom-error dispatch');
        assert.ok(/\n    \}$/.test(TE_SRC), 'throwError ends on its own closing brace');
    });
});

// ─── 02 — a dispatch that raises re-enters throwError for the same request ────
describe('#B842 §02 — an error-page dispatch that raises is answered once, with the built-in page', function () {
    var S = makeServer({ raises: function () { return true; } });
    var A = mkReq('A'), resA = mkRes('A', A), threw = null;
    try { S.throwError(resA, 500, 'Could not evaluate POST request data.', function () {}); }
    catch (e) { threw = String(e && e.message || e); }
    var r = read(S, resA);

    it('throwError returns without throwing', function () {
        assert.equal(threw, null);
    });
    it('the error page is dispatched ONCE (it was dispatched again on every re-entry)', function () {
        assert.equal(S.dispatches.A, 1, 'router.route calls for A: ' + S.dispatches.A);
    });
    it('the request gets one answer: 500, the built-in page', function () {
        assert.equal(r.ends, 1, 'one end()');
        assert.equal(r.writes, 1, 'one writeHead()');
        assert.equal(r.status, 500);
        assert.equal(r.contentType, 'text/html; charset=utf-8');
        assert.equal(r.form, 'html');
        assert.ok(r.builtIn, 'the built-in page');
    });
    it('one pairing line per call, both with the request id; the page carries the ref of the call that answered', function () {
        assert.equal(r.pairs.length, 2, 'pairing lines: ' + r.pairs.length);
        assert.equal(r.pairs[0].req, 'rid-A');
        assert.equal(r.pairs[1].req, 'rid-A');
        assert.notEqual(r.pairs[0].ref, r.pairs[1].ref);
        assert.equal(r.bodyRef, r.pairs[1].ref, 'the page shows the ref paired with the dispatch failure');
    });
});

// ─── 03 — control: a dispatch that does not raise ────────────────────────────
describe('#B842 §03 — control: an error-page dispatch that does not raise', function () {
    it('dispatches once and writes nothing itself — the error page answers', function () {
        var S = makeServer({ raises: function () { return false; } });
        var A = mkReq('A'), resA = mkRes('A', A);
        S.throwError(resA, 500, 'Could not evaluate POST request data.', function () {});
        var r = read(S, resA);
        assert.equal(S.dispatches.A, 1);
        assert.equal(S.calls[0], 'router.route(req=A, rule=custom-error-page@fixtureapp)');
        assert.equal(r.form, 'none', 'throwError did not answer');
        assert.equal(r.pairs.length, 1);
    });
});

// ─── 04 — the mark belongs to its request ─────────────────────────────────────
describe('#B842 §04 — the mark belongs to its request', function () {
    it('after request A\'s re-entry, request B\'s error page is dispatched', function () {
        var S = makeServer({ raises: function (req) { return req.tag === 'A'; } });
        var A = mkReq('A'), resA = mkRes('A', A), B = mkReq('B'), resB = mkRes('B', B);
        S.throwError(resA, 500, 'failure serving A', function () {});
        S.throwError(resB, 500, 'failure serving B', function () {});
        assert.equal(S.dispatches.B, 1, 'B\'s error page is dispatched');
        assert.equal(resB.body, null, 'throwError did not answer B — its error page does');
    });
});

// ─── 05 — a later throwError for the same request ─────────────────────────────
describe('#B842 §05 — a later throwError for the same request', function () {
    it('is answered with the built-in page; the error page is not dispatched a second time', function () {
        var S = makeServer({ raises: function () { return false; } });
        var A = mkReq('A'), resA = mkRes('A', A);
        S.throwError(resA, 500, 'first failure', function () {});
        assert.equal(resA.body, null, 'the first call dispatched the error page and wrote nothing');
        S.throwError(resA, 500, 'second failure', function () {});
        var r = read(S, resA);
        assert.equal(S.dispatches.A, 1, 'router.route calls for A: ' + S.dispatches.A);
        assert.equal(r.status, 500);
        assert.ok(r.builtIn, 'the built-in page');
        assert.equal(r.bodyRef, r.pairs[1].ref);
    });
});

// ─── 06 — source pins (comment-stripped) ──────────────────────────────────────
describe('#B842 §06 — source pins', function () {
    function stripComments(s) { return s.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); }
    var live = stripComments(TE_SRC);
    it('the dispatch is skipped for a request that carries the mark', function () {
        assert.match(live, /if\s*\(\s*!hasMiddlewareException\s*&&\s*!_req\._ginaErrorPageDispatched\s*\)\s*\{/);
    });
    it('the mark is set on the request on the line before the dispatch', function () {
        assert.match(live, /_req\._ginaErrorPageDispatched\s*=\s*true;\s*\n\s*router\.route\(_req, res, next, _req\.routing\);/);
    });
});
