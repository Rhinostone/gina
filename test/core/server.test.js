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


// ─── getAssets — embedded Swig expressions preserve inner string-literal quotes ──
//
// Regression caught downstream in freelancer/v3 after the v0.3.9-alpha.2 self-update:
// the decorative-quote-strip guard inside getAssets() was anchored (`/^\{\{/`), so
// an asset URL with `{{ }}` embedded mid-string (e.g. a render-time cache-buster
// like `css/main.css?cache={{ ''|formatDate('HH:MM:ss') }}`) had its inner Swig
// string-literal quotes stripped as decoration. The mangled URL was written into
// the cached layout's __ginaData.gina.view.assets JSON; the cached layout's
// runtime Swig pass then threw `Unexpected colon on line N` at parse time,
// surfacing as a 500 from @rhinostone/swig parser.
//
// Fix: drop the `^` anchor on the strip guard so the strip is also skipped when
// `{{` appears anywhere in the URL. The compile guard keeps its `^` anchor —
// only fully-Swig URLs are pre-compiled at scan time; embedded `{{ }}` is left
// for the cached layout's runtime Swig pass.

describe('getAssets — embedded Swig expressions preserve inner quotes', function() {

    var src;

    before(function() {
        src = fs.readFileSync(SOURCE, 'utf8');
    });

    it('source: FRAMEWORK PATCH marker for the strip-guard anchor fix is present', function() {
        // Regression guard against an accidental revert during a future merge/sync.
        assert.ok(
            src.indexOf('FRAMEWORK PATCH (freelancer/v3): drop the `^` anchor') > -1,
            'expected FRAMEWORK PATCH marker explaining the strip-guard anchor fix in core/server.js'
        );
    });

    // Minimal simulation of the two-branch quote-strip + compile logic that lives
    // inside getAssets() in core/server.js. Mirrors the source byte-for-byte —
    // when the source changes, this simulation must change too.
    function normalizeAssetUrl(url, swig, data) {
        if ( !/\{\{/.test(url) ) {
            url = url.replace(/(\"|\')/g, '');
        }
        if (swig && /^\{\{/.test(url) ) {
            url = swig.compile(url, swig.getOptions())(data || {});
        }
        return url;
    }

    it('plain URL (no Swig syntax): inner decorative quotes are stripped', function() {
        // Existing behaviour — regression guard.
        var url = normalizeAssetUrl('"css/main.css?v=1"', null);
        assert.equal(url, 'css/main.css?v=1', 'decorative quotes around a plain URL must be stripped');
    });

    it('URL that is entirely a Swig expression: inner quotes preserved, compile branch fires', function() {
        // Existing behaviour — regression guard.
        var compileCalled = false;
        var fakeSwig = {
            getOptions: function() { return {}; },
            compile: function(tpl /*, opts */) {
                compileCalled = true;
                // Inner quotes must reach this point untouched
                assert.ok(/'resolved'/.test(tpl), 'compile must receive the original string-literal quotes');
                return function(/* data */) { return 'resolved'; };
            }
        };

        var url = normalizeAssetUrl("{{ 'resolved' }}", fakeSwig, {});
        assert.ok(compileCalled, 'compile branch must fire for fully-Swig URLs');
        assert.equal(url, 'resolved', 'compile output must replace the URL');
    });

    it('URL with {{ }} embedded mid-string: inner quotes preserved, compile branch does NOT fire (#FX-getAssets-embedded-swig)', function() {
        // The freelancer/v3 reproducer.
        var compileCalled = false;
        var fakeSwig = {
            getOptions: function() { return {}; },
            compile: function() { compileCalled = true; return function() { return ''; }; }
        };

        var input  = "css/main.css?cache={{ ''|formatDate('HH:MM:ss') }}";
        var output = normalizeAssetUrl(input, fakeSwig, {});

        assert.equal(
            output,
            input,
            'embedded {{ }} must be passed through verbatim — inner string-literal quotes are syntactically meaningful and must NOT be stripped'
        );
        assert.equal(
            compileCalled,
            false,
            'compile branch must NOT fire for embedded {{ }} — the cached layout\'s runtime Swig pass evaluates it later'
        );
    });
});


// ─── Bug I — createNextMiddleware factory isolates per-request dispatch state ──
//
// Pre-fix shape: a single module-scope `nextMiddleware` function held its
// dispatch state on its own function-object properties (`._index`, `._count`,
// `._request`, `._response`, `._next`, `._nextAction`). Under concurrent
// requests, request B's setup at the entry point overwrote request A's
// state, so A's awaited middleware callbacks resumed against B's `req`
// object — visible as sporadic `[csrf] no req.session.id` 500s when
// express-session correctly populated `req.session` for A but CSRF then
// ran with B's `req` that never went through session.
//
// Post-fix shape: `nextMiddleware` is wrapped in a `createNextMiddleware()`
// factory; each `_expressMiddlewares.length > 0` entry point calls the
// factory and gets a fresh closure with isolated state. This block locks
// in the source structure so a future merge can't silently revert it,
// and exercises the closure-isolation invariant on a pure-logic replica
// of the entry-point setup pattern.

describe('Bug I — createNextMiddleware factory isolates per-request dispatch state', function () {

    var src;

    before(function () {
        src = fs.readFileSync(SOURCE, 'utf8');
    });

    it('source: FRAMEWORK PATCH marker for Bug I is present', function () {
        assert.ok(
            src.indexOf('FRAMEWORK PATCH (freelancer/v3): Bug I') > -1,
            'expected FRAMEWORK PATCH marker explaining the per-request dispatcher fix'
        );
    });

    it('source: createNextMiddleware factory exists and wraps a fresh nextMiddleware', function () {
        // The factory MUST exist — the old shape held state on a shared
        // function object and is the regression path we're guarding against.
        assert.match(
            src,
            /var\s+createNextMiddleware\s*=\s*function\s*\(\s*\)\s*\{[\s\S]*?var\s+nextMiddleware\s*=\s*function\s*\(\s*err\s*\)/,
            'createNextMiddleware factory must wrap a fresh `var nextMiddleware = function(err)` declaration'
        );
        assert.match(
            src,
            /return\s+nextMiddleware\s*;?\s*\}\s*;/,
            'factory must return the inner nextMiddleware so each call gets a fresh closure'
        );
    });

    it('source: both _expressMiddlewares entry points use the factory (no shared state)', function () {
        // Two call sites — onInstance() (~line 2767) and the matched-routing
        // post-process block (~line 4118). Both must construct via the factory
        // before assigning `._index` / `._request` / etc.; assignment to a
        // module-scope `nextMiddleware` directly would re-introduce the bug.
        var calls = src.match(/var\s+nextMiddleware\s*=\s*createNextMiddleware\s*\(\s*\)/g);
        assert.ok(
            calls && calls.length >= 2,
            'expected createNextMiddleware() to be invoked at both _expressMiddlewares entry points (got ' + (calls ? calls.length : 0) + ')'
        );
    });

    // Pure-logic replica of the entry-point setup pattern. Confirms that
    // two factory invocations produce dispatchers with isolated state, so
    // a setup race between request A and request B doesn't bleed B's req
    // onto A's continuation.
    function makeFactory() {
        return function createNextMiddleware() {
            var nextMiddleware = function (err) { /* dispatch body */ };
            return nextMiddleware;
        };
    }

    it('two factory calls produce dispatchers with isolated own-property state', function () {
        var createNextMiddleware = makeFactory();

        // Request A enters the pipeline first.
        var reqA = { id: 'A', session: { id: 'sess-A' } };
        var dispatcherA = createNextMiddleware();
        dispatcherA._index   = 0;
        dispatcherA._request = reqA;

        // Request B enters next — the scenario that reproduced the bug.
        var reqB = { id: 'B', session: { id: 'sess-B' } };
        var dispatcherB = createNextMiddleware();
        dispatcherB._index   = 0;
        dispatcherB._request = reqB;

        // The two dispatchers MUST be distinct function objects so writes
        // to one don't shadow the other's state. Pre-fix, the assignments
        // above would have overwritten the shared module-scope function's
        // own properties — `dispatcherA._request` would now be `reqB`.
        assert.notStrictEqual(dispatcherA, dispatcherB,
            'each createNextMiddleware() call must return a distinct function');
        assert.strictEqual(dispatcherA._request, reqA,
            'dispatcher A must retain its own _request after dispatcher B is set up');
        assert.strictEqual(dispatcherB._request, reqB,
            'dispatcher B must hold its own _request');
        assert.strictEqual(dispatcherA._request.session.id, 'sess-A',
            'dispatcher A must continue to see request A\'s session — the regression case');
    });
});
