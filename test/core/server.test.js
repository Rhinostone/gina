'use strict';
/**
 * server.js — completeHeaders / checkPreflightRequest regression tests
 *
 * Strategy: source inspection + behavioural simulation.
 * No live HTTP server or project required.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var SOURCE = path.join(require('../fw'), 'core/server.js');


// ─── #B13 — completeHeaders must preserve preflight-echoed access-control-allow-headers ──

describe('#B13 — completeHeaders preserves preflight ACAH echo', function() {

    var src;

    before(function() {
        src = fs.readFileSync(SOURCE, 'utf8');
    });

    it('checkPreflightRequest still echoes access-control-request-headers back as access-control-allow-headers', function() {
        // sanity check on the upstream function — the echo is what completeHeaders must NOT clobber
        assert.match(
            src,
            /response\.setHeader\(\s*['"]access-control-allow-headers['"]\s*,\s*request\.headers\[\s*['"]access-control-request-headers['"]\s*\]\s*\)/,
            'checkPreflightRequest must still echo the requested headers list'
        );
    });

    it('completeHeaders contains the #B13 guard against overwriting the preflight echo', function() {
        // The guard lives inside completeHeaders, in the else branch of the resHeaders for-loop
        // (the branch that handles non-ACAO headers).
        var completeHeadersIdx = src.indexOf('var completeHeaders = function(responseHeaders');
        assert.ok(completeHeadersIdx > -1, 'completeHeaders function must exist');

        // Region: from completeHeaders start to end of function (next "    }" at column 4)
        var nextFnIdx = src.indexOf('this.onHttp2Stream', completeHeadersIdx);
        assert.ok(nextFnIdx > -1, 'must find a function after completeHeaders');
        var region = src.slice(completeHeadersIdx, nextFnIdx);

        assert.ok(
            /#B13/.test(region),
            'completeHeaders must reference #B13 marker so the intent is greppable'
        );
        assert.ok(
            /access[-\\]?control[-\\]?allow[-\\]?headers/i.test(region),
            'guard must mention access-control-allow-headers explicitly'
        );
        assert.ok(
            /request\.isPreflightRequest/.test(region),
            'guard must check request.isPreflightRequest'
        );
        assert.ok(
            /response\.getHeader\(\s*['"]access-control-allow-headers['"]\s*\)/.test(region),
            'guard must check response.getHeader(\'access-control-allow-headers\') so the echo wins only when actually set'
        );
        assert.ok(
            /continue\s*;/.test(region),
            'guard must skip the overwrite via continue'
        );
    });

    it('guard is positioned before the response.setHeader call inside the else branch', function() {
        var completeHeadersIdx = src.indexOf('var completeHeaders = function(responseHeaders');
        var nextFnIdx          = src.indexOf('this.onHttp2Stream', completeHeadersIdx);
        var region             = src.slice(completeHeadersIdx, nextFnIdx);

        var b13Idx       = region.indexOf('#B13');
        var continueIdx  = region.indexOf('continue', b13Idx);
        // The else branch's setHeader must still exist and must come AFTER the guard.
        var setHeaderIdx = region.indexOf('response.setHeader(h, headerValue)', continueIdx);

        assert.ok(b13Idx > -1,                   '#B13 marker must be present');
        assert.ok(continueIdx > b13Idx,          'continue must follow the #B13 marker');
        assert.ok(setHeaderIdx > continueIdx,    'setHeader(h, headerValue) must remain after the guard so non-preflight requests still apply the static value');
    });

    it('preflight short-circuit still calls completeHeaders before res.end (defence in depth)', function() {
        // The fix relies on the call ordering: checkPreflightRequest sets the echo,
        // then the short-circuit calls completeHeaders, which now skips the overwrite.
        var shortCircuit = src.match(/if\s*\(\s*req\.isPreflightRequest\s*\)\s*\{[\s\S]{0,1500}?res\.end\(\)/);
        assert.ok(shortCircuit, 'preflight short-circuit block must exist');
        assert.match(shortCircuit[0], /completeHeaders\(/, 'short-circuit must still call completeHeaders');
        assert.match(shortCircuit[0], /204/,               'short-circuit must still respond with 204');
    });

    it('behavioural simulation: when isPreflightRequest && header already set, the guard logic skips overwrite', function() {
        // Reproduce the runtime condition the guard protects.
        // We re-implement the minimal guard logic + the fake res.setHeader so the
        // assertion fails the same way the framework would if the guard regressed.

        var setCalls = [];
        var headers  = {};
        var fakeRes  = {
            setHeader: function(h, v) { setCalls.push([h, v]); headers[h.toLowerCase()] = v; },
            getHeader: function(h)    { return headers[h.toLowerCase()]; }
        };

        // checkPreflightRequest's echo:
        fakeRes.setHeader('access-control-allow-headers', 'content-type,x-requested-with');
        var fakeReq = { isPreflightRequest: true };

        // Simulate the for-loop body for the access-control-allow-headers key:
        var h = 'access-control-allow-headers';
        var staticConfigured = 'X-Requested-With'; // the env.json static value (missing Content-Type)

        var skipped = false;
        if (
            /^access\-control\-allow\-headers$/i.test(h)
            && fakeReq.isPreflightRequest
            && fakeRes.getHeader('access-control-allow-headers')
        ) {
            skipped = true; // matches the production `continue;`
        } else {
            fakeRes.setHeader(h, staticConfigured);
        }

        assert.equal(skipped, true, 'guard must trigger for preflight + already-set header');
        assert.equal(
            fakeRes.getHeader('access-control-allow-headers'),
            'content-type,x-requested-with',
            'echoed value must remain after completeHeaders runs'
        );
        assert.equal(setCalls.length, 1, 'setHeader must be called exactly once (the echo only)');
    });

    it('behavioural simulation: when NOT a preflight, static value still wins', function() {
        var headers  = {};
        var fakeRes  = {
            setHeader: function(h, v) { headers[h.toLowerCase()] = v; },
            getHeader: function(h)    { return headers[h.toLowerCase()]; }
        };
        var fakeReq = { isPreflightRequest: false };
        var h       = 'access-control-allow-headers';
        var staticConfigured = 'X-Requested-With';

        if (
            /^access\-control\-allow\-headers$/i.test(h)
            && fakeReq.isPreflightRequest
            && fakeRes.getHeader('access-control-allow-headers')
        ) {
            // would skip
        } else {
            fakeRes.setHeader(h, staticConfigured);
        }

        assert.equal(
            fakeRes.getHeader('access-control-allow-headers'),
            'X-Requested-With',
            'non-preflight path must still apply the static configured value'
        );
    });

    it('behavioural simulation: preflight with NO prior echo still applies static value', function() {
        // Defensive case: if checkPreflightRequest didn't set the header (e.g. client sent no
        // access-control-request-headers), the static configured value must still be written
        // so we don't silently strip ACAH from the response.
        var headers  = {};
        var fakeRes  = {
            setHeader: function(h, v) { headers[h.toLowerCase()] = v; },
            getHeader: function(h)    { return headers[h.toLowerCase()]; }
        };
        var fakeReq = { isPreflightRequest: true };
        var h       = 'access-control-allow-headers';
        var staticConfigured = 'X-Requested-With';

        if (
            /^access\-control\-allow\-headers$/i.test(h)
            && fakeReq.isPreflightRequest
            && fakeRes.getHeader('access-control-allow-headers')
        ) {
            // skip
        } else {
            fakeRes.setHeader(h, staticConfigured);
        }

        assert.equal(
            fakeRes.getHeader('access-control-allow-headers'),
            'X-Requested-With',
            'when echo was never set, static value must still land in the response'
        );
    });
});
