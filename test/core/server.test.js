'use strict';
/**
 * server.js — completeHeaders / checkPreflightRequest regression tests
 *
 * Strategy: source inspection + behavioural simulation.
 * No live HTTP server or project required.
 */
var { describe, it, before, beforeEach } = require('node:test');
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
// Regression caught downstream after the v0.3.9-alpha.2 self-update:
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
            src.indexOf('FRAMEWORK PATCH: drop the `^` anchor') > -1,
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
        // The reproducer.
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
            src.indexOf('FRAMEWORK PATCH: Bug I') > -1,
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


// ─── #H11 — opt-in Alt-Svc HTTP/3-advertisement header (completeHeaders gate) ──
//
// When server.http3Advertisement is true, completeHeaders() emits
// `Alt-Svc: h3=":443"; ma=86400` on every routed (user-facing) response via
// response.setHeader, covering BOTH engines: completeHeaders runs for Isaac
// routed requests through the composeHeadersMiddleware drain and for the
// Express engine alike, and the render delegates fold response.getHeaders()
// into the HTTP/2 stream.respond. Gina does NOT implement QUIC — advertise
// only (a QUIC-capable edge proxy terminates HTTP/3 on :443). Idempotent /
// first-writer-wins (an upstream-set Alt-Svc is never clobbered); off by
// default (zero behaviour change when the flag is unset).

describe('#H11 — Alt-Svc HTTP/3-advertisement gate in completeHeaders', function () {

    var src, settingsSrc;

    before(function () {
        src         = fs.readFileSync(SOURCE, 'utf8');
        settingsSrc = fs.readFileSync(path.join(require('../fw'), 'core/template/conf/settings.json'), 'utf8');
    });

    // region = the completeHeaders function body
    function completeHeadersRegion() {
        var startIdx = src.indexOf('var completeHeaders = function(responseHeaders');
        var endIdx   = src.indexOf('this.onHttp2Stream', startIdx);
        return src.slice(startIdx, endIdx);
    }

    it('source: completeHeaders carries the #H11 marker', function () {
        assert.ok(/#H11/.test(completeHeadersRegion()),
            'completeHeaders must carry the #H11 marker so intent is greppable');
    });

    it('source: gate reads conf.server.http3Advertisement', function () {
        assert.match(completeHeadersRegion(), /conf\.server\.http3Advertisement/,
            'gate must read conf.server.http3Advertisement');
    });

    it('source: gate is typeof-guarded and idempotent (first-writer-wins via response.getHeader)', function () {
        var region = completeHeadersRegion();
        assert.match(region, /typeof\s*\(\s*response\.getHeader\s*\)\s*==\s*['"]function['"]/,
            'gate must guard `typeof(response.getHeader) == function`');
        assert.match(region, /!\s*response\.getHeader\(\s*['"]alt-svc['"]\s*\)/,
            'gate must skip when alt-svc is already set (first-writer-wins)');
    });

    it('source: gate emits the exact RFC 7838 value via response.setHeader', function () {
        assert.ok(
            completeHeadersRegion().indexOf("response.setHeader('alt-svc', 'h3=\":443\"; ma=86400')") > -1,
            "gate must emit response.setHeader('alt-svc', 'h3=\":443\"; ma=86400')"
        );
    });

    it('source: exactly one alt-svc setHeader emit in server.js (no drift)', function () {
        var matches = src.match(/setHeader\(\s*['"]alt-svc['"]/gi);
        assert.ok(matches && matches.length === 1,
            'expected exactly one setHeader(\'alt-svc\', …) emit; found ' + (matches ? matches.length : 0));
    });

    it('settings.json template declares server.http3Advertisement: false (opt-in default)', function () {
        assert.ok(settingsSrc.indexOf('"http3Advertisement": false') > -1,
            'settings.json template must declare `"http3Advertisement": false` as the default');
    });

    it('settings.json http3Advertisement key sits inside the top-level server.* block', function () {
        var serverIdx = settingsSrc.indexOf('"server"');
        var uploadIdx = settingsSrc.indexOf('"upload"');
        var h3Idx     = settingsSrc.indexOf('"http3Advertisement"');
        assert.ok(serverIdx > -1 && uploadIdx > serverIdx, 'sanity: server then upload blocks present');
        assert.ok(h3Idx > serverIdx && h3Idx < uploadIdx,
            'http3Advertisement must live inside the server.* block (sibling of hidePoweredBy)');
    });

    // ── Pure-logic replica of the gate (mirrors the source) ──
    function altSvcGate(conf, response) {
        if (
            conf.server.http3Advertisement
            && typeof(response.getHeader) === 'function'
            && !response.getHeader('alt-svc')
        ) {
            response.setHeader('alt-svc', 'h3=":443"; ma=86400');
        }
    }

    function makeRes() {
        var headers = {};
        return {
            setHeader: function (h, v) { headers[h.toLowerCase()] = v; },
            getHeader: function (h)    { return headers[h.toLowerCase()]; },
            _keys:     function ()     { return Object.keys(headers); }
        };
    }

    it('replica: flag unset → no Alt-Svc (zero behaviour change)', function () {
        var res = makeRes();
        altSvcGate({ server: {} }, res);
        assert.equal(res.getHeader('alt-svc'), undefined, 'no Alt-Svc when the flag is unset');
    });

    it('replica: flag false → no Alt-Svc', function () {
        var res = makeRes();
        altSvcGate({ server: { http3Advertisement: false } }, res);
        assert.equal(res.getHeader('alt-svc'), undefined, 'no Alt-Svc when the flag is false');
    });

    it('replica: flag true → Alt-Svc: h3=":443"; ma=86400', function () {
        var res = makeRes();
        altSvcGate({ server: { http3Advertisement: true } }, res);
        assert.equal(res.getHeader('alt-svc'), 'h3=":443"; ma=86400', 'exact RFC 7838 advertise-only value');
    });

    it('replica: first-writer-wins — an upstream/proxy Alt-Svc is never clobbered', function () {
        var res = makeRes();
        res.setHeader('Alt-Svc', 'h3=":8443"; ma=3600'); // simulate an upstream proxy
        altSvcGate({ server: { http3Advertisement: true } }, res);
        assert.equal(res.getHeader('alt-svc'), 'h3=":8443"; ma=3600',
            'gate must not overwrite an already-present Alt-Svc');
    });

    it('replica: idempotent on repeat calls — single value, one key', function () {
        var res  = makeRes();
        var conf = { server: { http3Advertisement: true } };
        altSvcGate(conf, res);
        altSvcGate(conf, res);
        assert.equal(res.getHeader('alt-svc'), 'h3=":443"; ma=86400', 'value stays correct after repeat calls');
        assert.equal(res._keys().filter(function (k) { return k === 'alt-svc'; }).length, 1,
            'alt-svc key must be unique after repeat calls');
    });

    it('replica: missing response.getHeader → no throw, no emit (defensive typeof guard)', function () {
        var bareRes = { setHeader: function () { throw new Error('setHeader should not be called'); } };
        assert.doesNotThrow(function () {
            altSvcGate({ server: { http3Advertisement: true } }, bareRes);
        }, 'gate must not throw or emit when response.getHeader is absent');
    });
});


// ─── #M12b — per-request log context (requestId / durationMs) ──────────────────

describe('#M12b — per-request log context (requestId / durationMs)', function () {

    var src;
    before(function () { src = fs.readFileSync(SOURCE, 'utf8'); });

    // ---- source pins ----

    it('gates the request-context ALS on JSON logging (text mode pays nothing)', function () {
        assert.match(src, /var _reqCtxLogging\s*=/, '_reqCtxLogging gate missing');
        // mirrors the logger opt.format precedence: GINA_LOG_FORMAT > GINA_LOG_STDOUT
        assert.match(src, /GINA_LOG_FORMAT/, 'gate must read GINA_LOG_FORMAT');
        assert.match(src, /GINA_LOG_STDOUT/, 'gate must fall back to GINA_LOG_STDOUT');
    });

    it('defines a sanitising requestId resolver (honour inbound X-Request-Id, else UUID)', function () {
        assert.match(src, /var _resolveRequestId\s*=\s*function/, '_resolveRequestId missing');
        assert.match(src, /headers\['x-request-id'\]/, 'resolver must read the inbound x-request-id header');
        assert.match(src, /\{1,128\}/, 'resolver must length-cap the inbound id (128)');
        assert.match(src, /crypto\.randomUUID\(\)/, 'resolver must fall back to crypto.randomUUID()');
    });

    it('stamps requestId + startMs at the onInstance request entry', function () {
        assert.match(src, /request\._ginaReqStartMs\s*=\s*Date\.now\(\)/, 'onInstance must stamp _ginaReqStartMs');
        assert.match(src, /request\._ginaReqId\s*=\s*_resolveRequestId\(request\)/, 'onInstance must stamp _ginaReqId');
    });

    it('establishes the store via .run() at handle() — never enterWith(), never onInstance', function () {
        assert.match(src, /process\.gina\._reqALS\s*=\s*new AsyncLocalStorage\(\)/, '_reqALS must be parked on process.gina');
        assert.match(src, /process\.gina\._reqALS\.run\(_reqStore,/, 'dispatch must be wrapped in _reqALS.run()');
        assert.doesNotMatch(src, /_reqALS\.enterWith/, 'must use .run(), never enterWith() for the request store');
        assert.match(src, /var _handleDispatch\s*=\s*async function/, 'original handle body must be renamed to _handleDispatch');
    });

    it('builds the store with {requestId, startMs} from the onInstance stash', function () {
        assert.match(src, /requestId\s*:\s*req\._ginaReqId/, 'store.requestId from the stash');
        assert.match(src, /startMs\s*:\s*\(typeof req\._ginaReqStartMs/, 'store.startMs from the stash (with fallback)');
    });

    // ---- pure-logic replica: _resolveRequestId (sanitisation) ----

    function makeResolveRequestId(genUuid) {
        return function (request) {
            var _inbound = request && request.headers && request.headers['x-request-id'];
            if (_inbound && /^[\w.\-]{1,128}$/.test(_inbound)) {
                return _inbound;
            }
            return genUuid();
        };
    }

    it('replica: honours a well-formed inbound X-Request-Id', function () {
        var resolve = makeResolveRequestId(function () { return 'GENERATED'; });
        assert.equal(resolve({ headers: { 'x-request-id': 'trace-abc_123.45-XY' } }), 'trace-abc_123.45-XY');
    });

    it('replica: regenerates when the inbound id has illegal chars (log-forging guard)', function () {
        var resolve = makeResolveRequestId(function () { return 'GENERATED'; });
        assert.equal(resolve({ headers: { 'x-request-id': 'bad id with spaces' } }), 'GENERATED');
        assert.equal(resolve({ headers: { 'x-request-id': 'line\nbreak' } }),       'GENERATED');
        assert.equal(resolve({ headers: { 'x-request-id': 'semi;colon' } }),         'GENERATED');
    });

    it('replica: regenerates over 128 chars; 128 is the inclusive boundary', function () {
        var resolve = makeResolveRequestId(function () { return 'GENERATED'; });
        assert.equal(resolve({ headers: { 'x-request-id': 'a'.repeat(129) } }), 'GENERATED');
        assert.equal(resolve({ headers: { 'x-request-id': 'a'.repeat(128) } }), 'a'.repeat(128));
    });

    it('replica: generates when no inbound header is present', function () {
        var resolve = makeResolveRequestId(function () { return 'GENERATED'; });
        assert.equal(resolve({ headers: {} }), 'GENERATED');
        assert.equal(resolve({}),              'GENERATED');
        assert.equal(resolve(null),            'GENERATED');
    });

    // ---- pure-logic replica: _reqCtxLogging env precedence ----

    function reqCtxLogging(env) {
        if (/^json$/i.test(env.GINA_LOG_FORMAT || '')) { return true; }
        if (/^text$/i.test(env.GINA_LOG_FORMAT || '')) { return false; }
        return /^true$/i.test(env.GINA_LOG_STDOUT || '');
    }

    it('replica: GINA_LOG_FORMAT=json enables the context', function () {
        assert.equal(reqCtxLogging({ GINA_LOG_FORMAT: 'json' }), true);
    });
    it('replica: GINA_LOG_FORMAT=text disables it even with GINA_LOG_STDOUT=true (format wins)', function () {
        assert.equal(reqCtxLogging({ GINA_LOG_FORMAT: 'text', GINA_LOG_STDOUT: 'true' }), false);
    });
    it('replica: GINA_LOG_STDOUT=true (no format) enables it (back-compat alias)', function () {
        assert.equal(reqCtxLogging({ GINA_LOG_STDOUT: 'true' }), true);
    });
    it('replica: neither set → disabled (default text path, zero ALS cost)', function () {
        assert.equal(reqCtxLogging({}), false);
    });

    // ---- ALS propagation mechanism (decoupled from a running server) ----
    // Proves the contract the handle() wrapper depends on: a store established via
    // .run() survives the awaited dispatch chain, and concurrent runs stay isolated.
    // (The always-on THROUGHPUT cost is a separate PoC that needs a bootable env.)

    it('replica: the store survives .run() + awaited async dispatch (await, setTimeout, nesting)', async function () {
        var { AsyncLocalStorage } = require('async_hooks');
        var als = new AsyncLocalStorage();

        async function deepRead() {
            await Promise.resolve();
            await new Promise(function (r) { setTimeout(r, 1); });
            var s = als.getStore();
            return s ? s.requestId : null;
        }
        async function dispatch() {
            await Promise.resolve();
            return deepRead();
        }

        var seen = await als.run({ requestId: 'rid-propagated', startMs: Date.now() }, dispatch);
        assert.equal(seen, 'rid-propagated', 'store must survive awaits + setTimeout + nested async');
    });

    it('replica: concurrent .run() contexts stay isolated (no cross-request bleed)', async function () {
        var { AsyncLocalStorage } = require('async_hooks');
        var als = new AsyncLocalStorage();
        async function idAfterTick() {
            await new Promise(function (r) { setTimeout(r, 1); });
            var s = als.getStore();
            return s ? s.requestId : null;
        }
        var results = await Promise.all([
            als.run({ requestId: 'A', startMs: 0 }, idAfterTick),
            als.run({ requestId: 'B', startMs: 0 }, idAfterTick)
        ]);
        assert.deepEqual(results, ['A', 'B'], 'each concurrent run() must see only its own store');
    });
});


// ─────────────────────────────────────────────────────────────────────────
// #S7 — admin-grade /_gina/* IP allowlist (express-engine mirror)
// ─────────────────────────────────────────────────────────────────────────
//
// server.isaac.js serves /_gina/info and /_gina/cache/stats (admin-grade —
// they expose process state: memory, uptime, HTTP/2 counters, cache
// contents) behind an IP allowlist. The default express engine (server.js)
// previously 404'd both — a /_gina/* endpoint-sync-rule gap (fail-closed,
// but a parity gap). They are now mirrored into server.js with the same
// always-on + admin-gated shape, using the express response idiom
// (setHeader / statusCode / end) rather than Isaac's _setPoweredByHeader /
// response.stream.
//
// The IP-allowlist check now lives in the shared lib.admin (extracted from
// the former byte-identical copies in server.js + server.isaac.js); both
// engines call lib.admin.isClientAllowed(request). The helper-body +
// byte-identical-sync pins moved to test/lib/admin.test.js; this describe now
// pins only the express-engine handler wiring. Mirrors server.isaac.test.js §08.

describe('#S7 — admin /_gina/* IP allowlist (express-engine mirror)', function () {

    var src;

    before(function () {
        src = fs.readFileSync(SOURCE, 'utf8');
    });

    // ── source-structure pins (express-engine handler wiring) ───────────────
    // The helper-body + byte-identical-sync pins moved to test/lib/admin.test.js
    // when isAdminClientAllowed was extracted into the shared lib.admin; this
    // describe now pins only how the express handlers wire that gate.

    it('/_gina/info handler invokes the gate before responding (403 on deny)', function () {
        var infoAt  = src.indexOf('_gina\\/info$');
        var cacheAt = src.indexOf('_gina\\/cache\\/stats$');
        assert.ok(infoAt > -1, '/_gina/info regex anchor not found in server.js');
        assert.ok(cacheAt > infoAt, '/_gina/cache/stats anchor must follow /_gina/info');
        var blk = src.slice(infoAt, cacheAt);
        assert.ok(blk.indexOf('lib.admin.isClientAllowed(request)') > -1,
            '/_gina/info handler must invoke lib.admin.isClientAllowed(request) before responding');
        assert.ok(blk.indexOf('statusCode = 403') > -1,
            '/_gina/info handler must return 403 on deny');
    });

    it('/_gina/info uses the express idiom, not Isaac stream / _setPoweredByHeader', function () {
        var infoAt  = src.indexOf('_gina\\/info$');
        var cacheAt = src.indexOf('_gina\\/cache\\/stats$');
        var blk     = src.slice(infoAt, cacheAt);
        assert.ok(blk.indexOf('response.end(') > -1, 'info handler must respond via response.end()');
        assert.ok(blk.indexOf('response.stream') < 0 && blk.indexOf('_setPoweredByHeader') < 0,
            'express mirror must not use Isaac-only response.stream / _setPoweredByHeader');
    });

    it('/_gina/info reads self.instance._cacheIsEnabled + keeps the _h2Metrics guard', function () {
        var infoAt  = src.indexOf('_gina\\/info$');
        var cacheAt = src.indexOf('_gina\\/cache\\/stats$');
        var blk     = src.slice(infoAt, cacheAt);
        assert.ok(blk.indexOf('self.instance._cacheIsEnabled') > -1, 'must read self.instance._cacheIsEnabled');
        assert.ok(blk.indexOf('if (self.instance._h2Metrics)') > -1,
            'the http2 block must stay guarded (Isaac-only — falsy/omitted under express)');
    });

    it('/_gina/cache/stats handler invokes the gate before responding (403 on deny)', function () {
        var cacheAt = src.indexOf('_gina\\/cache\\/stats$');
        var jobsAt  = src.indexOf('_gina\\/jobs\\/', cacheAt);
        assert.ok(cacheAt > -1, '/_gina/cache/stats regex anchor not found in server.js');
        assert.ok(jobsAt > cacheAt, '/_gina/jobs anchor must follow /_gina/cache/stats');
        var blk = src.slice(cacheAt, jobsAt);
        assert.ok(blk.indexOf('lib.admin.isClientAllowed(request)') > -1,
            '/_gina/cache/stats handler must invoke lib.admin.isClientAllowed(request) before responding');
        assert.ok(blk.indexOf('statusCode = 403') > -1,
            '/_gina/cache/stats handler must return 403 on deny');
    });

    it('/_gina/cache/stats builds a Cache view over self.instance._cached', function () {
        var cacheAt = src.indexOf('_gina\\/cache\\/stats$');
        var jobsAt  = src.indexOf('_gina\\/jobs\\/', cacheAt);
        var blk     = src.slice(cacheAt, jobsAt);
        assert.ok(blk.indexOf('new lib.Cache()') > -1, 'must construct a fresh lib.Cache()');
        assert.ok(blk.indexOf('.from(self.instance._cached)') > -1, 'must adopt the shared self.instance._cached Map');
        assert.ok(blk.indexOf('.stats()') > -1, 'must serialise cache.stats()');
    });

    // ── /_gina/cache/clear (#RC — Slice 3 cross-strategy flush) ─────────────
    it('/_gina/cache/clear handler is POST-gated + admin-gated (403 on deny)', function () {
        var clearAt = src.indexOf('/_gina/cache/clear');
        var jobsAt  = src.indexOf('_gina\\/jobs\\/', clearAt);
        assert.ok(clearAt > -1, '/_gina/cache/clear regex anchor not found in server.js');
        assert.ok(jobsAt > clearAt, '/_gina/jobs anchor must follow /_gina/cache/clear');
        var blk = src.slice(clearAt, jobsAt);
        assert.ok(/method\.toUpperCase\(\) === 'POST'/.test(blk),
            '/_gina/cache/clear must gate on POST (a flush is a mutation, not a safe GET)');
        assert.ok(blk.indexOf('lib.admin.isClientAllowed(request)') > -1,
            '/_gina/cache/clear handler must invoke lib.admin.isClientAllowed(request) before flushing');
        assert.ok(blk.indexOf('statusCode = 403') > -1,
            '/_gina/cache/clear handler must return 403 on deny');
    });

    it('/_gina/cache/clear flushes via lib.RenderCache scoped clear(bundle) — not lib.Cache whole-store', function () {
        var clearAt = src.indexOf('/_gina/cache/clear');
        var jobsAt  = src.indexOf('_gina\\/jobs\\/', clearAt);
        var blk     = src.slice(clearAt, jobsAt);
        assert.ok(blk.indexOf('new lib.RenderCache()') > -1,
            'must use the render-cache dispatcher (scoped to static:/data:), never lib.Cache().clear() which wipes swig:/http2session:');
        assert.ok(blk.indexOf('.from(self.instance._cached)') > -1, 'must adopt the shared self.instance._cached Map');
        assert.ok(/\.clear\(_cacheClearBundle\)/.test(blk), 'must call the scoped clear(bundle)');
        assert.ok(blk.indexOf("get('bundle')") > -1, 'must honour the optional ?bundle= filter');
    });

    it('/_gina/cache/clear honours ?event= and lets it WIN over ?bundle=', function () {
        // Load-bearing, not cosmetic: `event` used to be an unparsed param, so
        // ?event=<name> fell through with bundle === null and clear(null) flushed
        // EVERY bundle's output cache — the opposite of the narrow eviction asked for.
        var clearAt = src.indexOf('/_gina/cache/clear');
        var jobsAt  = src.indexOf('_gina\\/jobs\\/', clearAt);
        var blk     = src.slice(clearAt, jobsAt);

        assert.ok(blk.indexOf("get('event')") > -1, 'must parse the ?event= selector');
        assert.ok(/\.invalidateByEvent\(_cacheClearEvent\)/.test(blk),
            'an ?event= run must evict by event, not flush');

        // The event branch must SHORT-CIRCUIT before the flush can run.
        var eventBranchAt = blk.search(/if \(\s*_cacheClearEvent\s*\)/);
        var flushAt       = blk.search(/\.clear\(_cacheClearBundle\)/);
        assert.ok(eventBranchAt > -1, 'must branch on _cacheClearEvent');
        assert.ok(eventBranchAt < flushAt,
            'the ?event= branch must precede (and return before) the bundle flush');
        assert.match(blk.slice(eventBranchAt), /^if \(\s*_cacheClearEvent\s*\)\s*\{[\s\S]{0,320}?return response\.end\(/,
            'the ?event= branch must return its own response, never fall through to clear()');
    });

    // ── pure-logic replica (mirrors server.isaac.test.js §08b) ──────────────
    // Inline replica of isAdminClientAllowed; takes the allowlist as a param
    // so every branch is exercised without touching process.gina state. The
    // helper body above is byte-pinned to the Isaac copy, so this logic
    // applies to both engines.

    function isAllowed(req, list) {
        if (list.length === 0) return false;
        var ip = (req.socket && req.socket.remoteAddress)
              || (req.connection && req.connection.remoteAddress)
              || '';
        if (ip.indexOf('::ffff:') === 0) ip = ip.slice(7);
        return list.indexOf(ip) >= 0;
    }

    it('replica: loopback IPv4 is allowed by default', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '127.0.0.1' } }, ['127.0.0.1', '::1']), true);
    });
    it('replica: loopback IPv6 (::1) is allowed by default', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '::1' } }, ['127.0.0.1', '::1']), true);
    });
    it('replica: ::ffff:127.0.0.1 (IPv6-mapped IPv4 loopback) is normalised and allowed', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '::ffff:127.0.0.1' } }, ['127.0.0.1', '::1']), true);
    });
    it('replica: arbitrary public IP is denied by the default loopback list', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '203.0.113.42' } }, ['127.0.0.1', '::1']), false);
    });
    it('replica: private network IP is allowed when listed', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '10.0.1.5' } }, ['127.0.0.1', '::1', '10.0.1.5']), true);
    });
    it('replica: ::ffff:10.0.1.5 (IPv6-mapped non-loopback) is normalised and matched', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '::ffff:10.0.1.5' } }, ['10.0.1.5']), true);
    });
    it('replica: empty allowlist denies everyone (explicit lockdown)', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '127.0.0.1' } }, []), false);
        assert.equal(isAllowed({ socket: { remoteAddress: '::1' } }, []), false);
        assert.equal(isAllowed({ socket: { remoteAddress: '10.0.0.1' } }, []), false);
    });
    it('replica: falls back to req.connection.remoteAddress when req.socket missing', function () {
        assert.equal(isAllowed({ connection: { remoteAddress: '127.0.0.1' } }, ['127.0.0.1', '::1']), true);
    });
    it('replica: req with no socket and no connection denies', function () {
        assert.equal(isAllowed({}, ['127.0.0.1', '::1']), false);
    });
    it('replica: X-Forwarded-For is ignored even when present (spoofing defense)', function () {
        var req = { socket: { remoteAddress: '203.0.113.42' }, headers: { 'x-forwarded-for': '127.0.0.1' } };
        assert.equal(isAllowed(req, ['127.0.0.1', '::1']), false,
            'must NOT trust X-Forwarded-For — reverse proxies could spoof it');
    });

});


// ─── #COMPLY2 slice 1 — the always-on request-id (the audit correlation key) ───
//
// The audit trail (#COMPLY2) correlates every record to its originating request. The
// #M12b id it reuses was stamped ONLY under _reqCtxLogging (JSON logging), which would
// have made an audit record's correlation key depend on GINA_LOG_FORMAT. Slice 1 hoists
// the id stamp out of that gate (always-on, first-seer-guarded) while leaving the ALS
// .run() and the durationMs startMs stamp gated exactly as #M12b shipped them.

describe('#COMPLY2 slice 1 — always-on request id (audit correlation key)', function () {

    var src, onInstanceBlk;

    before(function () {
        src = fs.readFileSync(SOURCE, 'utf8');
        // End-anchor the onInstance head on distinctive OUTER text (never a bare
        // structural token — an inner brace/else would truncate the slice).
        var start = src.indexOf("function onInstance(request, response, next)");
        assert.ok(start > -1, 'onInstance catch-all not found — re-anchor this slice');
        var end = src.indexOf('#FI — dev-mode request timeline', start);
        assert.ok(end > start, 'onInstance head end-anchor (#FI timeline comment) not found');
        onInstanceBlk = src.slice(start, end);
    });

    // ---- source pins (structural ordering — no char-distance windows) ----

    it('stamps the id OUTSIDE the _reqCtxLogging gate (always-on)', function () {
        var idIdx   = onInstanceBlk.indexOf('request._ginaReqId = _resolveRequestId(request)');
        var gateIdx = onInstanceBlk.indexOf('if ( _reqCtxLogging )');
        assert.ok(idIdx   > -1, 'the id stamp must exist in the onInstance head');
        assert.ok(gateIdx > -1, 'the _reqCtxLogging gate must still exist in the onInstance head');
        assert.ok(idIdx < gateIdx,
            'the id stamp must precede (i.e. sit outside) the _reqCtxLogging gate — ' +
            'an audit correlation key must not depend on the log format');
    });

    it('first-seer-guards the id (a re-entered dispatch must not regenerate it)', function () {
        assert.match(onInstanceBlk, /if \(\s*!request\._ginaReqId\s*\)\s*\{\s*[\r\n]+\s*request\._ginaReqId = _resolveRequestId\(request\);/,
            'the id stamp must be wrapped in an `if ( !request._ginaReqId )` first-seer guard');
    });

    it('leaves the durationMs startMs stamp INSIDE the gate (not over-hoisted)', function () {
        // Structural, NOT a positional `startMsIdx > gateIdx` proxy: if a future edit
        // hoists startMs by DELETING the gate, indexOf returns -1 and `startMsIdx > -1`
        // is trivially true — the pin would pass on the very change it exists to catch.
        // Matching the gate-opens-then-startMs shape cannot pass with the gate gone.
        assert.match(onInstanceBlk,
            /if \(\s*_reqCtxLogging\s*\)\s*\{\s*[\r\n]+\s*request\._ginaReqStartMs = Date\.now\(\);/,
            'startMs must sit immediately inside the _reqCtxLogging gate — its only consumer ' +
            "is the logger's durationMs; an audit record stamps its own ts at write time");
    });

    it('#M12b is preserved: the ALS .run() stays JSON-gated', function () {
        // The hoist must not have leaked the ALS into text mode — that is the
        // un-measured #M12b always-on-throughput PoC, deliberately untouched here.
        var runIdx  = src.indexOf('process.gina._reqALS.run(_reqStore,');
        var gateIdx = src.lastIndexOf('if ( _reqCtxLogging ) {', runIdx);
        assert.ok(runIdx > -1, '_reqALS.run() must still exist');
        assert.ok(gateIdx > -1 && gateIdx < runIdx, '_reqALS.run() must still sit under a _reqCtxLogging gate');
    });

    // ---- behavioural replica + subtract control ----
    // Shipped shape vs the pre-fix shape, driven over the same inputs. The pre-fix arm
    // is the control: it MUST fail where the shipped one succeeds, or these tests prove
    // nothing.

    function makeStampShipped(reqCtxLogging, resolveId) {
        return function onInstanceStamp(request) {
            if (!request._ginaReqId) {
                request._ginaReqId = resolveId(request);
            }
            if (reqCtxLogging) {
                request._ginaReqStartMs = Date.now();
            }
        };
    }

    function makeStampPreFix(reqCtxLogging, resolveId) {
        return function onInstanceStampPreFix(request) {
            if (reqCtxLogging) {
                request._ginaReqStartMs = Date.now();
                request._ginaReqId      = resolveId(request);   // unguarded + gated
            }
        };
    }

    var seq;
    function resolveIdStub() { return 'id-' + (++seq); }
    beforeEach(function () { seq = 0; });

    it('text mode: the id IS stamped (the whole point of the hoist)', function () {
        var req = { headers: {} };
        makeStampShipped(false, resolveIdStub)(req);
        assert.equal(req._ginaReqId, 'id-1', 'a text-mode request must still get a correlation key');
    });

    it('CONTROL: the pre-fix shape stamps NO id in text mode (audit would lose correlation)', function () {
        var req = { headers: {} };
        makeStampPreFix(false, resolveIdStub)(req);
        assert.equal(req._ginaReqId, undefined,
            'subtract: pre-fix left text-mode requests id-less — if this ever passes with an id, ' +
            'the control is dead and the always-on test above proves nothing');
    });

    it('text mode: startMs is NOT stamped (stays with its only consumer, the logger)', function () {
        var req = { headers: {} };
        makeStampShipped(false, resolveIdStub)(req);
        assert.equal(req._ginaReqStartMs, undefined, 'startMs must not be hoisted along with the id');
    });

    it('json mode: both id and startMs are stamped (#M12b behaviour intact)', function () {
        var req = { headers: {} };
        makeStampShipped(true, resolveIdStub)(req);
        assert.equal(req._ginaReqId, 'id-1');
        assert.equal(typeof req._ginaReqStartMs, 'number');
    });

    it('re-entry: the id is stable across a second dispatch pass (first-seer)', function () {
        var req = { headers: {} };
        var stamp = makeStampShipped(true, resolveIdStub);
        stamp(req);
        var first = req._ginaReqId;
        stamp(req);
        assert.equal(req._ginaReqId, first, 'a re-entered dispatch must not regenerate the id');
        assert.equal(req._ginaReqId, 'id-1', 'the resolver must not have been called twice');
    });

    it('CONTROL: the pre-fix shape REGENERATES the id on a second pass (records would split)', function () {
        var req = { headers: {} };
        var stamp = makeStampPreFix(true, resolveIdStub);
        stamp(req);
        var first = req._ginaReqId;
        stamp(req);
        assert.notEqual(req._ginaReqId, first,
            'subtract: pre-fix regenerated the id on re-entry — if this ever holds stable, ' +
            'the first-seer test above proves nothing');
    });

    it('an inbound X-Request-Id still wins in text mode (the resolver is reused, not bypassed)', function () {
        var req = { headers: { 'x-request-id': 'upstream-trace-42' } };
        // the real resolver's contract, replicated: sanitised inbound wins, else generate
        makeStampShipped(false, function (r) {
            var inbound = r && r.headers && r.headers['x-request-id'];
            return (inbound && /^[\w.\-]{1,128}$/.test(inbound)) ? inbound : 'GENERATED';
        })(req);
        assert.equal(req._ginaReqId, 'upstream-trace-42',
            'cross-service correlation must work in text mode too, not only under JSON logging');
    });

});
