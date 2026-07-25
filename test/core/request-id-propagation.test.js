'use strict';
/**
 * MS1 — cross-service request-id propagation.
 *
 * Two halves: (1) self.query() forwards the always-on correlation id
 * (req._ginaReqId) on every outbound inter-bundle request, and (2) the server
 * echoes X-Request-Id back on the response. Strategy: source inspection +
 * behavioural replica — no live HTTP server.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var CONTROLLER = path.join(require('../fw'), 'core/controller/controller.js');
var SERVER     = path.join(require('../fw'), 'core/server.js');


describe('MS1 — outbound forward on self.query() (controller.js)', function () {

    var src;
    before(function () { src = fs.readFileSync(CONTROLLER, 'utf8'); });

    it('forwards x-request-id from the resolved req._ginaReqId at all 3 outbound sites', function () {
        // The 3 outbound header sites (file-download proxy, HTTP/1 client, HTTP/2
        // client) must each forward the correlation id so a fan-out stays
        // traceable regardless of transport.
        var forwards = src.match(/\['x-request-id'\]\s*=\s*local\.req\._ginaReqId/g) || [];
        assert.equal(forwards.length, 3,
            'expected the id forwarded at all 3 outbound sites, found ' + forwards.length);
    });

    it('forwards only the sanitised resolved id, never a raw inbound header', function () {
        // _ginaReqId is sanitised at resolve time; forwarding the raw inbound
        // header would re-introduce a client-controllable / log-forging value.
        assert.ok(src.indexOf("headers['x-request-id'] = local.req.headers['x-request-id']") < 0,
            'must NOT forward the raw inbound x-request-id header');
    });

    it('a caller-set x-request-id always wins (no-clobber guard at each site)', function () {
        var guards = src.match(/typeof\((?:requestOptions|options)\.headers\['x-request-id'\]\)\s*==\s*'undefined'/g) || [];
        assert.equal(guards.length, 3,
            'each of the 3 forwards must carry a no-clobber guard, found ' + guards.length);
    });

    // ── pure-logic replica of the forward guard ─────────────────────────────
    function forward(reqId, headers) {
        var out = Object.assign({}, headers);
        if (reqId && typeof out['x-request-id'] === 'undefined') {
            out['x-request-id'] = reqId;
        }
        return out;
    }

    it('replica: sets x-request-id from the id when none is present', function () {
        assert.equal(forward('r-abc-123', {})['x-request-id'], 'r-abc-123');
    });
    it('replica: never clobbers a caller-set x-request-id', function () {
        assert.equal(forward('r-abc-123', { 'x-request-id': 'caller' })['x-request-id'], 'caller');
    });
    it('replica: no id → the header stays absent (subtract-my-contribution)', function () {
        assert.equal(typeof forward(undefined, {})['x-request-id'], 'undefined');
        assert.equal(typeof forward('', {})['x-request-id'], 'undefined');
    });
});


describe('MS1 — response echo of X-Request-Id (server.js)', function () {

    var src, echoBlk;
    before(function () {
        src = fs.readFileSync(SERVER, 'utf8');
        var at = src.indexOf("setHeader('X-Request-Id'");
        echoBlk = at > -1 ? src.slice(Math.max(0, at - 220), at + 80) : '';
    });

    it('echoes X-Request-Id from request._ginaReqId on the response', function () {
        assert.ok(src.indexOf("response.setHeader('X-Request-Id', request._ginaReqId)") > -1,
            'must echo X-Request-Id from request._ginaReqId');
    });

    it('is guarded by request._ginaReqId && !response.headersSent', function () {
        assert.ok(/request\._ginaReqId\s*&&\s*!response\.headersSent/.test(echoBlk),
            'echo must guard against a missing id and an already-sent response');
    });

    it('is ungated — not coupled to the JSON-logging gate (_reqCtxLogging)', function () {
        assert.ok(echoBlk.indexOf('_reqCtxLogging') < 0,
            'the echo of an always-on id must not sit behind the log-format gate');
    });

    // ── pure-logic replica of the echo ──────────────────────────────────────
    function echo(reqId, headersSent) {
        var set = null;
        var res = { headersSent: headersSent, setHeader: function (k, v) { set = { k: k, v: v }; } };
        if (reqId && !res.headersSent) { res.setHeader('X-Request-Id', reqId); }
        return set;
    }

    it('replica: sets X-Request-Id when an id exists and headers are open', function () {
        var s = echo('r-abc-123', false);
        assert.ok(s && s.k === 'X-Request-Id' && s.v === 'r-abc-123');
    });
    it('replica: skips when the response is already sent', function () {
        assert.equal(echo('r-abc-123', true), null);
    });
    it('replica: skips when there is no id', function () {
        assert.equal(echo('', false), null);
        assert.equal(echo(undefined, false), null);
    });
});
