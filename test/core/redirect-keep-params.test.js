/**
 * #B352 — `keep-params`: a redirect route carries the incoming query string.
 *
 * The defect: the framework auto-generates a `webroot@<bundle>` route for every
 * bundle whose `server.webroot` is non-root, redirecting the bare webroot path to
 * its trailing-slash form. Its `param.path` is a CONSTANT (the configured webroot),
 * and nothing merged the incoming request's query onto it — so a bare-webroot hit
 * carrying a token or a redirect target (`/app?t=…`) landed on `/app/` with the
 * parameter already gone. The application saw a missing value, not a bad link, so
 * nothing on screen or in its logs pointed at the URL.
 *
 * `keep-params` had been DOCUMENTED as a redirect-route key since the pre-GitHub
 * import (docs guides/routing.md) but never implemented: `keepParams` was read into
 * a local in controller.js and then dropped. This fix implements it and opts the
 * synthetic route in.
 *
 * Coverage split, stated honestly:
 *  - §01 evaluates the composition SEMANTICS on real inputs — the class of defect a
 *    source pin structurally cannot catch, since a pinned line can be present,
 *    correctly shaped, and still semantically wrong.
 *  - §02/§03 pin the real source's expression shape and the synthetic route's
 *    opt-in, so §01 cannot drift away from the code it models.
 *  - End-to-end proof (the real `Location` header off a booted bundle, both
 *    `webrootAutoredirect` arms, with positive and negative controls) was measured
 *    live against a daemonless scaffold serving over real HTTP.
 *
 * Run standalone:
 *   node --test test/core/redirect-keep-params.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW              = require('../fw');
var CONTROLLER_SRC  = path.join(FW, 'core/controller/controller.js');
var CONFIG_SRC      = path.join(FW, 'core/config.js');


// ---------------------------------------------------------------------------
// 01 — composition semantics
// ---------------------------------------------------------------------------
// Models the shipped block. Kept deliberately tiny and value-asserting: every
// case below is a STRING the redirect writes into the `location` header, which is
// exactly the kind of correctness a shape-only pin would ratify while wrong.
describe('01 - #B352 keep-params: query composition onto the redirect target', function() {

    // The replica mirrors controller.js's block; §02 pins the real source so the
    // two cannot silently diverge.
    function carry(pathTarget, incomingUrl, keepParams) {
        if ( keepParams && !(/\:\/\//).test(pathTarget) ) {
            var incoming   = incomingUrl || '';
            var queryIndex = incoming.indexOf('?');
            if ( queryIndex > -1 ) {
                var incomingQuery = incoming.substring(queryIndex + 1).replace(/[\r\n]/g, '');
                if ( incomingQuery ) {
                    pathTarget += ( (/\?/).test(pathTarget) ? '&' : '?' ) + incomingQuery;
                }
            }
        }
        return pathTarget;
    }

    it('carries the query onto a constant target (the webroot@<bundle> case)', function() {
        assert.equal(carry('/app/', '/app?t=VALUE', true), '/app/?t=VALUE');
    });

    it('carries a multi-parameter query verbatim, preserving encoding', function() {
        assert.equal(
            carry('/app/', '/app?a=1&b=two%20words&c=%2Fslash', true),
            '/app/?a=1&b=two%20words&c=%2Fslash'
        );
    });

    it('appends with & when the target already carries a query', function() {
        assert.equal(carry('/app/?lang=fr', '/app?t=VALUE', true), '/app/?lang=fr&t=VALUE');
    });

    it('leaves the target untouched when the request has no query', function() {
        assert.equal(carry('/app/', '/app', true), '/app/');
    });

    it('adds no stray "?" for an empty query ("/app?")', function() {
        assert.equal(carry('/app/', '/app?', true), '/app/');
    });

    it('is inert when keep-params is off — the historical behaviour of every route', function() {
        assert.equal(carry('/app/', '/app?t=VALUE', false), '/app/');
    });

    it('never carries onto an ABSOLUTE target — no cross-origin parameter disclosure', function() {
        assert.equal(
            carry('https://elsewhere.example/page', '/app?token=SECRET', true),
            'https://elsewhere.example/page',
            'an opt-in flag must not forward the caller\'s query to another origin'
        );
    });

    it('strips CR/LF so a crafted query cannot split the Location header', function() {
        var out = carry('/app/', '/app?x=1\r\nSet-Cookie:%20evil=1', true);
        assert.ok(out.indexOf('\r') < 0 && out.indexOf('\n') < 0, 'CR/LF must not survive into the header value');
        assert.equal(out, '/app/?x=1Set-Cookie:%20evil=1');
    });

    it('a request without originalUrl/url contributes no query (bare/harness requests)', function() {
        assert.equal(carry('/app/', '', true), '/app/');
        assert.equal(carry('/app/', undefined, true), '/app/');
    });

});


// ---------------------------------------------------------------------------
// 02 — controller.js source structure
// ---------------------------------------------------------------------------
describe('02 - #B352 source structure: controller.js honours keep-params', function() {

    it('keepParams is USED, not just read into a local and dropped', function() {
        var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');
        // The pre-fix file contained exactly ONE occurrence: the declaration.
        var occurrences = (src.match(/keepParams/g) || []).length;
        assert.ok(
            occurrences > 1,
            'expected keepParams to be consumed somewhere after its declaration; found ' +
            occurrences + ' occurrence(s) — a single one means the option is dead again'
        );
    });

    it('the query is sourced from originalUrl with a url fallback (#B219 idiom)', function() {
        var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');
        assert.ok(
            src.indexOf('local.req.originalUrl || local.req.url') > -1,
            'expected the engine-agnostic query source (isaac strips the query from req.url)'
        );
    });

    it('the absolute-target exclusion gates the carry', function() {
        var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');
        assert.ok(
            src.indexOf('if ( keepParams && !(/\\:\\/\\//).test(path) )') > -1,
            'expected the carry to be gated on keep-params AND a non-absolute target'
        );
    });

    it('the carry runs BEFORE the inheritedData block (its ?-vs-& test must see the query)', function() {
        var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');
        var carryIdx        = src.indexOf('if ( keepParams && !(/\\:\\/\\//).test(path) )');
        var inheritedIdx    = src.indexOf("inheritedData = '&inheritedData='");
        assert.ok(carryIdx > -1,     'keep-params carry block not found');
        assert.ok(inheritedIdx > -1, 'inheritedData composition not found');
        assert.ok(
            carryIdx < inheritedIdx,
            'the keep-params carry must precede the inheritedData composition, otherwise ' +
            'inheritedData would emit a second "?" instead of "&" on the wrong-method path'
        );
    });

});


// ---------------------------------------------------------------------------
// 03 — config.js: the synthetic route opts in
// ---------------------------------------------------------------------------
describe('03 - #B352 source structure: the synthetic webroot route sets keep-params', function() {

    it("webroot@<bundle> declares 'keep-params': true", function() {
        var src = fs.readFileSync(CONFIG_SRC, 'utf8');
        var routeIdx = src.indexOf("routing['webroot@'+ bundle] = {");
        assert.ok(routeIdx > -1, 'the synthetic webroot route construction was not found');

        // Bound the window to this object literal: the next statement after it is
        // the webrootAutoredirect url rewrite.
        var endIdx = src.indexOf("routing['webroot@'+ bundle].url", routeIdx);
        assert.ok(endIdx > routeIdx, 'could not bound the synthetic route literal');

        var block = src.substring(routeIdx, endIdx);
        assert.ok(
            block.indexOf("'keep-params': true") > -1,
            "expected the auto-generated webroot route to opt into keep-params — without it " +
            "its constant param.path silently discards the caller's query"
        );
        // The opt-in is only meaningful alongside the redirect control it modifies.
        assert.ok(block.indexOf('control: "redirect"') > -1, 'expected the redirect control in the same literal');
    });

});
