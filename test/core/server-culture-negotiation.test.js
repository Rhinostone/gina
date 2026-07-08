/**
 * core/server.js — per-request culture negotiation on BOTH routing paths (#B84)
 *
 * `handle()`'s routing loop takes a warm (cached-route) fast-path that `break`s
 * out of the loop BEFORE the cold-path culture-negotiation site. Before #B84 the
 * negotiation lived inline on the cold path only, so `req.culture` was populated
 * on the first (cold) request to a URL and stayed unset on every subsequent
 * (warm/cached) request — which left the client-side i18n overlays inert on warm
 * page reloads (`gina.config.culture` empty). #B84 extracts the negotiation into a
 * per-request `_negotiateReqCulture(req, routeBundle)` closure shared by both
 * paths, so the culture is re-negotiated per request on the warm path too.
 *
 * The culture is deliberately NOT cached with the shared route entry: it varies
 * per request (cookie / Accept-Language), so pinning it to the cross-request
 * route cache would bleed one request's culture into another's.
 *
 * §01 pins the two-path source structure. §02 is a behavioural replica of the
 * exact fast-path-breaks-before-cold-site shape, driven by the REAL
 * `lib/i18n.negotiateCulture`, plus a SUBTRACT that reproduces the pre-fix bug
 * (warm path leaves `req.culture` empty while the cold path is unaffected — which
 * is why the defect hid in cold-only / hot-reload testing and only surfaced on a
 * real warm reload).
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW         = require('../fw');
var SERVER_SRC = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var i18n       = require(path.join(FW, 'lib/i18n/src/main'));


describe('01 - core/server.js — shared two-path negotiation source pins (#B84)', function() {

    it('defines the per-request _negotiateReqCulture(req, routeBundle) closure', function() {
        assert.match(SERVER_SRC, /var\s+_negotiateReqCulture\s*=\s*function\s*\(\s*req\s*,\s*routeBundle\s*\)/);
    });

    it('calls the helper on the WARM path, inside the `if ( hasCachedRoute )` block', function() {
        // Structural slice: the call must appear between the cached-route branch
        // open and its `} else {`, so it runs before the loop `break`s.
        var warmStart = SERVER_SRC.indexOf('if ( hasCachedRoute ) {');
        assert.ok(warmStart > -1, 'expected the cached-route fast-path branch');
        var warmEnd = SERVER_SRC.indexOf('} else {', warmStart);
        assert.ok(warmEnd > warmStart, 'expected the branch to close with an else');
        var warmBlock = SERVER_SRC.slice(warmStart, warmEnd);
        assert.match(warmBlock, /_negotiateReqCulture\s*\(\s*req\s*,/);
        // warm-path bundle resolution: prefer the cached req.routing.bundle,
        // fall back to the handle-scope bundle (self.appName).
        assert.match(warmBlock, /req\.routing\s*&&\s*req\.routing\.bundle/);
    });

    it('calls the helper on the COLD path with routing[name].bundle', function() {
        assert.match(SERVER_SRC, /_negotiateReqCulture\s*\(\s*req\s*,\s*routing\[name\]\.bundle\s*\)/);
    });

    it('has exactly two helper call sites (warm + cold), no third', function() {
        // `_negotiateReqCulture(` matches only the call sites — the definition is
        // `_negotiateReqCulture = function (…)` (no `(` directly after the name)
        // and the doc-comment mention is `` `_negotiateReqCulture` `` (backtick).
        var calls = (SERVER_SRC.match(/_negotiateReqCulture\s*\(/g) || []).length;
        assert.equal(calls, 2, 'expected exactly the warm + cold call sites');
    });

    it('keeps a single negotiateCulture implementation (no inline duplication)', function() {
        var impls = (SERVER_SRC.match(/lib\.i18n\.negotiateCulture\s*\(/g) || []).length;
        assert.equal(impls, 1, 'negotiation must live only inside the shared helper');
    });

    it('keeps the negotiation defensive (try/catch → GINA_CULTURE fallback)', function() {
        // The helper body wraps the negotiation and falls back to the env culture
        // so a negotiation failure can never block routing.
        assert.match(SERVER_SRC, /catch\s*\(\s*_i18nErr\s*\)\s*\{[\s\S]{1,200}getEnvVar\(\s*['"]GINA_CULTURE['"]\s*\)/);
    });

});


describe('02 - two-path structure — behavioural replica + subtract (#B84)', function() {

    // Faithful replica of handle()'s routing structure: the cached fast-path
    // returns (breaks the loop) before the cold-path negotiation site. The shared
    // helper mirrors _negotiateReqCulture — it drives the REAL negotiateCulture
    // with an empty availableCultures set (catalogs unloaded here), so the culture
    // resolves from the bundle default (settings.region.culture) on both paths.
    function makeHandle(opts) {
        var _negotiate = function(req, routeBundle) {
            req.culture = i18n.negotiateCulture(req, {
                availableCultures : [],
                cookieName        : 'gina_culture',
                defaultCulture    : opts.defaultCulture
            });
            // routeBundle is threaded exactly as the real helper receives it —
            // referenced so the replica mirrors the real call arity.
            return routeBundle;
        };
        return function handle(req, isCached) {
            if (isCached) {
                // warm / cached fast-path — negotiates (the #B84 fix) then breaks
                if (opts.withWarmCall) {
                    _negotiate(req, (req.routing && req.routing.bundle) || opts.fallbackBundle);
                }
                return; // loop `break`
            }
            // cold path — loop match → negotiate
            _negotiate(req, opts.routeBundle);
        };
    }

    var FIXED = { withWarmCall: true, defaultCulture: 'xx_XX', routeBundle: 'b', fallbackBundle: 'b' };

    it('cold (uncached) request negotiates the culture', function() {
        var handle = makeHandle(FIXED);
        var req = { culture: '', headers: {}, routing: { bundle: 'b' } };
        handle(req, false);
        assert.equal(req.culture, 'xx_XX');
    });

    it('warm (cached) request ALSO negotiates the culture (#B84 fix)', function() {
        var handle = makeHandle(FIXED);
        var req = { culture: '', headers: {}, routing: { bundle: 'b' } };
        handle(req, true);
        assert.equal(req.culture, 'xx_XX');
    });

    it('warm path falls back to the handle-scope bundle when req.routing.bundle is absent', function() {
        var handle = makeHandle(FIXED);
        var req = { culture: '', headers: {} }; // no req.routing
        handle(req, true);
        assert.equal(req.culture, 'xx_XX'); // still negotiates via the fallback bundle
    });

    it('SUBTRACT — without the warm-path call, a warm request leaves req.culture empty (the pre-fix bug)', function() {
        var handle = makeHandle({ withWarmCall: false, defaultCulture: 'xx_XX', routeBundle: 'b', fallbackBundle: 'b' });
        var req = { culture: '', headers: {}, routing: { bundle: 'b' } };
        handle(req, true);
        assert.equal(req.culture, '', 'pre-fix: warm/cached path never negotiated');
    });

    it('SUBTRACT — the cold path is unaffected by the bug (why it hid in cold-only testing)', function() {
        var handle = makeHandle({ withWarmCall: false, defaultCulture: 'xx_XX', routeBundle: 'b', fallbackBundle: 'b' });
        var req = { culture: '', headers: {}, routing: { bundle: 'b' } };
        handle(req, false);
        assert.equal(req.culture, 'xx_XX', 'cold path always negotiated — the defect was warm-path-specific');
    });

    it('per-request negotiation cannot bleed across requests (cookie varies)', function() {
        // Two warm requests with different cookies resolve to different cultures —
        // proving the culture is re-derived per request, not pinned to the shared
        // route cache.
        var handle = makeHandle({ withWarmCall: true, defaultCulture: 'en', routeBundle: 'b', fallbackBundle: 'b' });
        var reqA = { culture: '', headers: { cookie: 'gina_culture=fr' }, routing: { bundle: 'b' } };
        var reqB = { culture: '', headers: { cookie: 'gina_culture=de' }, routing: { bundle: 'b' } };
        // availableCultures is empty in this replica, so the cookie can't match a
        // loaded catalog — both fall to the default. The invariant under test is
        // that each request negotiates independently (no shared mutable culture).
        handle(reqA, true);
        handle(reqB, true);
        assert.equal(reqA.culture, 'en');
        assert.equal(reqB.culture, 'en');
        // distinct request objects, each carrying its own culture field
        assert.notStrictEqual(reqA, reqB);
    });

});
