/**
 * Content negotiation on the render path (#SPA1)
 *
 * A route opts in with routing.json `negotiate: true`. A request then carrying
 * `X-Gina-Navigate: fragment` receives that route's LAYOUTLESS body instead of the
 * full page; without the header (or with any other value) it renders exactly as
 * before. The response advertises `Vary: X-Gina-Navigate` whenever the route is
 * negotiable — whether or not THIS request asked for a fragment — because that is
 * what tells a cache the response varies at all.
 *
 * Three design facts this file locks, each of which was measured rather than assumed
 * and each of which is easy to regress:
 *
 *  (a) The capability is ROUTE-DECLARED and lands on `req.routing.negotiate`
 *      (top-level, never `req.routing.param.*` — the #CSRF2 trap). It has to be
 *      visible at the request-pipeline boundary because the render-cache serve
 *      points run BEFORE the controller, so a shape decided only inside render()
 *      would be invisible to the cache.
 *
 *  (b) `Vary` is emitted from the controller, NOT from `completeHeaders`.
 *      `completeHeaders(null, req, res)` runs at server.js:6452, which is BEFORE the
 *      params block builds `req.routing` — so the flag does not exist there yet and a
 *      Vary emit at that site would silently never fire.
 *
 *  (c) The cache refusal is enforced at the WRITERS and is load-bearing, not
 *      belt-and-braces. isaac's cache read runs PRE-ROUTING (server.isaac.js ~:2150,
 *      keyed off the raw `request.url` with no `request.routing` in scope), so it
 *      CANNOT be guarded on the flag. Keeping a negotiable URL out of the cache
 *      entirely is what keeps that path correct.
 *
 * §01 pins the source structure at every touch point. §02 is a behavioural replica of
 * the controller's resolution block — including a SUBTRACT that reproduces the
 * pre-#SPA1 behaviour (no Vary, no fragment) and a clobber arm proving Vary is
 * appended to, never overwritten. §03 pins the published schema. §04 locks the
 * negative invariant that an undeclared flag leaves the default path untouched.
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var SERVER_SRC     = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var ISAAC_SRC      = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');
var CONTROLLER_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var SWIG_SRC       = fs.readFileSync(path.join(FW, 'core/controller/controller.render-swig.js'), 'utf8');
var NJK_SRC        = fs.readFileSync(path.join(FW, 'core/controller/controller.render-nunjucks.js'), 'utf8');
var ROUTING_SRC    = fs.readFileSync(path.join(FW, 'lib/routing/src/main.js'), 'utf8');

var SCHEMA = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../schema/routing.json'), 'utf8')
);


describe('01 - #SPA1 source pins — the negotiation touch points', function() {

    it('server.js parks the X-Gina-Navigate header on request.ginaHeaders.navigate', function() {
        assert.match(
            SERVER_SRC,
            /request\.headers\['x-gina-navigate'\]/,
            'the negotiation header must be read alongside the other gina headers'
        );
        assert.match(
            SERVER_SRC,
            /ginaHeaders\.navigate\s*=\s*String\(\s*request\.headers\['x-gina-navigate'\]\s*\)/,
            'the value is normalised through String() before use'
        );
    });

    it('the header value is lower-cased and trimmed (case/whitespace tolerant)', function() {
        var line = SERVER_SRC.split('\n').filter(function (l) {
            return /ginaHeaders\.navigate\s*=/.test(l);
        })[0] || '';
        assert.match(line, /\.trim\(\)/,      'trimmed');
        assert.match(line, /\.toLowerCase\(\)/, 'lower-cased');
    });

    it('server.js params block carries the per-route negotiate capability', function() {
        assert.match(
            SERVER_SRC,
            /negotiate\s*:\s*routing\[name\]\.negotiate\s*\|\|\s*false/,
            'params.negotiate defaults false so req.routing.negotiate is always a boolean'
        );
    });

    it('lib/routing propagates negotiate ONLY when the route declares it', function() {
        assert.match(
            ROUTING_SRC,
            /if\s*\(\s*typeof\(routeObject\.negotiate\)\s*!=\s*'undefined'\s*\)\s*\{\s*[\r\n\s]*params\.negotiate\s*=\s*routeObject\.negotiate;/,
            'the guarded-assignment idiom (cache/csrfExempt/culturePrefix) keeps an undeclared route byte-identical'
        );
    });

    it('the flag is top-level on req.routing, never under param.* (#CSRF2 trap)', function() {
        assert.doesNotMatch(
            ROUTING_SRC,
            /params\.param\.negotiate\s*=/,
            'negotiate must not be nested under param'
        );
        assert.doesNotMatch(
            SERVER_SRC,
            /param\.negotiate\s*:/,
            'negotiate must not be declared inside the params.param object'
        );
    });

    it('controller.js resolves the shape BEFORE the delegate is chosen', function() {
        var negIdx = CONTROLLER_SRC.indexOf("local.req.routing.negotiate === true");
        var engIdx = CONTROLLER_SRC.indexOf("var _engine = 'swig';");
        assert.ok(negIdx > -1, 'the negotiation block exists');
        assert.ok(engIdx > -1, 'the engine-resolution stage exists');
        assert.ok(
            negIdx < engIdx,
            'negotiation must resolve before the engine/delegate resolution'
        );
    });

    it('controller.js sets Vary via res.setHeader so BOTH engines carry it', function() {
        assert.match(
            CONTROLLER_SRC,
            /setHeader\(\s*'vary'\s*,\s*'X-Gina-Navigate'\s*\)/,
            'the h2 send sites fold res.getHeaders() into stream.respond()'
        );
    });

    it('controller.js APPENDS to an existing Vary rather than clobbering it', function() {
        assert.match(
            CONTROLLER_SRC,
            /String\(_existingVary\)\s*\+\s*',\s*X-Gina-Navigate'/,
            'Vary is a list header — a sibling value (CORS `vary: Origin`) must survive'
        );
    });

    it('controller.js gates the fragment shape on the exact value', function() {
        assert.match(
            CONTROLLER_SRC,
            /ginaHeaders\.navigate\s*===\s*'fragment'/,
            'only the fragment token switches the shape; anything else falls through'
        );
        assert.match(
            CONTROLLER_SRC,
            /local\.options\.isWithoutLayout\s*=\s*true/,
            'the fragment reuses the proven layoutless path'
        );
    });

    it('BOTH HTML writers refuse to store a negotiable route', function() {
        assert.match(
            SWIG_SRC,
            /req\.routing\s*&&\s*req\.routing\.negotiate\s*===\s*true/,
            'render-swig writeCache refuses'
        );
        assert.match(
            NJK_SRC,
            /req\.routing\s*&&\s*req\.routing\.negotiate\s*===\s*true/,
            'render-nunjucks writeCache refuses'
        );
    });

    it('the express-side cache READ refuses a negotiable route', function() {
        assert.match(
            SERVER_SRC,
            /if\s*\(\s*req\.routing\.negotiate\s*===\s*true\s*\)\s*\{\s*return false;\s*\}/,
            'tryServeRenderCacheHit runs after routing, so this guard can fire'
        );
    });

    it('isaac carries the do-not-add-a-dead-guard note at its PRE-ROUTING read', function() {
        // This is the anti-regression pin for fact (c): a future session must not
        // "harden" the isaac read with a request.routing check that can never fire.
        var idx = ISAAC_SRC.indexOf('#SPA1');
        assert.ok(idx > -1, 'the isaac read carries an #SPA1 note');
        var note = ISAAC_SRC.slice(idx, idx + 700);
        assert.match(note, /PRE-ROUTING/, 'the note states why a guard here cannot work');
    });

    it('isaac has NO executable request.routing.negotiate gate (comment-stripped)', function() {
        // The pin must be comment-stripped: the explanatory note above deliberately
        // NAMES `request.routing.negotiate` to say why it must not be used, so a raw
        // doesNotMatch over the whole source matches the comment and fails on correct
        // code. Strip line comments first so the assertion sees executable code only.
        var codeOnly = ISAAC_SRC
            .split('\n')
            .filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); })
            .join('\n');

        // Control: the stripper must not have eaten the file — a real isaac symbol
        // still has to be visible, otherwise this assertion could not fail.
        assert.match(codeOnly, /renderCache\.buildKey/, 'control: executable code survived stripping');

        assert.doesNotMatch(
            codeOnly,
            /request\.routing\.negotiate/,
            'isaac must NOT gate on request.routing.negotiate — it does not exist at that point'
        );
    });
});


describe('02 - #SPA1 behavioural replica — resolution, Vary composition, subtract', function() {

    // Replica of the controller's resolution block. Kept structurally identical to
    // the shipped code (pinned in §01) so a drift in either shows up as a failure
    // in one of the two.
    function resolveNegotiation(req, res, options) {
        if ( req && req.routing && req.routing.negotiate === true ) {
            if ( res && typeof(res.setHeader) == 'function' && !res.headersSent ) {
                var existingVary = ( typeof(res.getHeader) == 'function' ) ? res.getHeader('vary') : null;
                if ( !existingVary ) {
                    res.setHeader('vary', 'X-Gina-Navigate');
                } else if ( !/x-gina-navigate/i.test( String(existingVary) ) ) {
                    res.setHeader('vary', String(existingVary) + ', X-Gina-Navigate');
                }
            }
            if ( req.ginaHeaders && req.ginaHeaders.navigate === 'fragment' ) {
                options.isWithoutLayout = true;
            }
        }
        return options;
    }

    function mkRes(initialVary) {
        var headers = {};
        if (initialVary) { headers.vary = initialVary; }
        return {
            headersSent : false,
            getHeader   : function (k) { return headers[String(k).toLowerCase()]; },
            setHeader   : function (k, v) { headers[String(k).toLowerCase()] = v; },
            _headers    : headers
        };
    }

    function mkReq(negotiate, navigateValue) {
        return {
            routing     : ( typeof(negotiate) == 'undefined' ) ? {} : { negotiate: negotiate },
            ginaHeaders : { form: {}, popin: {}, navigate: navigateValue }
        };
    }

    it('negotiable + fragment → layoutless body AND Vary', function() {
        var res = mkRes();
        var opt = resolveNegotiation(mkReq(true, 'fragment'), res, {});
        assert.equal(opt.isWithoutLayout, true);
        assert.equal(res._headers.vary, 'X-Gina-Navigate');
    });

    it('negotiable WITHOUT the header → full page, but Vary is STILL advertised', function() {
        // The load-bearing asymmetry: a cache must learn the URL varies from a
        // response that did not itself vary, or it will cache the page and serve it
        // to a later fragment request.
        var res = mkRes();
        var opt = resolveNegotiation(mkReq(true, undefined), res, {});
        assert.equal(opt.isWithoutLayout, undefined, 'full page');
        assert.equal(res._headers.vary, 'X-Gina-Navigate', 'Vary advertised anyway');
    });

    it('NOT negotiable + fragment header → completely inert (no Vary, no shape change)', function() {
        var res = mkRes();
        var opt = resolveNegotiation(mkReq(false, 'fragment'), res, {});
        assert.equal(opt.isWithoutLayout, undefined);
        assert.equal(res._headers.vary, undefined, 'an un-opted route must emit nothing new');
    });

    it('a route with NO negotiate key at all is inert (undeclared === off)', function() {
        var res = mkRes();
        var opt = resolveNegotiation(mkReq(undefined, 'fragment'), res, {});
        assert.equal(opt.isWithoutLayout, undefined);
        assert.equal(res._headers.vary, undefined);
    });

    it('unknown header values fall through to the full page (forward-compatible)', function() {
        ['parts', 'page', 'FRAGMENT ', '', 'true', 'null'].forEach(function (v) {
            var res = mkRes();
            var opt = resolveNegotiation(mkReq(true, v), res, {});
            assert.equal(
                opt.isWithoutLayout, undefined,
                'value ' + JSON.stringify(v) + ' must not switch the shape'
            );
            // ...but Vary is still advertised, because the ROUTE varies.
            assert.equal(res._headers.vary, 'X-Gina-Navigate');
        });
    });

    it('an existing Vary is APPENDED to, never clobbered', function() {
        var res = mkRes('Origin');
        resolveNegotiation(mkReq(true, 'fragment'), res, {});
        assert.equal(res._headers.vary, 'Origin, X-Gina-Navigate');
        assert.match(res._headers.vary, /Origin/, 'the CORS value survives');
    });

    it('Vary is not duplicated when already present (idempotent)', function() {
        var res = mkRes('Origin, X-Gina-Navigate');
        resolveNegotiation(mkReq(true, 'fragment'), res, {});
        assert.equal(res._headers.vary, 'Origin, X-Gina-Navigate');
        assert.equal(
            (res._headers.vary.match(/x-gina-navigate/gi) || []).length, 1,
            'exactly one occurrence'
        );
    });

    it('a response whose headers are already sent is left alone', function() {
        var res = mkRes();
        res.headersSent = true;
        var opt = resolveNegotiation(mkReq(true, 'fragment'), res, {});
        assert.equal(res._headers.vary, undefined, 'no late header write');
        assert.equal(opt.isWithoutLayout, true, 'the shape still resolves');
    });

    it('SUBTRACT — the pre-#SPA1 resolver produces neither Vary nor a fragment', function() {
        // Removing the contribution must break exactly the two observable effects,
        // which is what makes the green arms above meaningful.
        function preSpa1(req, res, options) { return options; }

        var res = mkRes();
        var opt = preSpa1(mkReq(true, 'fragment'), res, {});
        assert.equal(opt.isWithoutLayout, undefined, 'pre-fix: full page even when asked for a fragment');
        assert.equal(res._headers.vary, undefined, 'pre-fix: no Vary, so a cache cannot know the URL varies');
    });

    // ---- the cache-refusal predicate, as shipped ----

    function refusesToStore(req) {
        return !!( req.routing && req.routing.negotiate === true );
    }

    it('the writers refuse a negotiable route and accept every other one', function() {
        assert.equal(refusesToStore({ routing: { negotiate: true } }),  true);
        assert.equal(refusesToStore({ routing: { negotiate: false } }), false);
        assert.equal(refusesToStore({ routing: {} }),                   false);
        assert.equal(refusesToStore({}),                                false, 'a route-less request must not throw');
    });

    it('the refusal is strict-true — a truthy non-boolean does not silently opt in', function() {
        assert.equal(refusesToStore({ routing: { negotiate: 'yes' } }), false);
        assert.equal(refusesToStore({ routing: { negotiate: 1 } }),     false);
    });
});


describe('03 - #SPA1 published schema', function() {

    it('routing.json declares negotiate as an optional boolean defaulting to false', function() {
        var route = SCHEMA.definitions && SCHEMA.definitions.route;
        assert.ok(route, 'the route definition exists');
        var neg = route.properties && route.properties.negotiate;
        assert.ok(neg, 'negotiate is declared');
        assert.equal(neg.type, 'boolean');
        assert.equal(neg.default, false);
        assert.ok(
            !Array.isArray(route.required) || route.required.indexOf('negotiate') < 0,
            'negotiate must stay optional'
        );
    });

    it('the schema documents the cache incompatibility', function() {
        var neg = SCHEMA.definitions.route.properties.negotiate;
        assert.match(
            neg.description, /cache/i,
            'the description must warn that a negotiable route does not participate in the render cache'
        );
    });
});


describe('04 - #SPA1 negative invariants — off is byte-identical', function() {

    it('nothing in the negotiation path reads X-Requested-With', function() {
        // The signal is deliberately NOT overloaded onto X-Requested-With, which
        // popin / link / validator all already send and which the render + error
        // paths already fork on. Overloading it would change their behaviour.
        var idx = CONTROLLER_SRC.indexOf('#SPA1');
        assert.ok(idx > -1);
        var block = CONTROLLER_SRC.slice(idx, idx + 4000);
        assert.doesNotMatch(block, /x-requested-with/i);
        assert.doesNotMatch(block, /isXMLRequest/);
    });

    it('the negotiation block is failure-isolated (never breaks a render)', function() {
        var idx = CONTROLLER_SRC.indexOf('#SPA1');
        var block = CONTROLLER_SRC.slice(idx, idx + 4000);
        assert.match(block, /catch\s*\(\s*negotiationErr\s*\)/, 'wrapped in its own try/catch');
    });

    it('no new always-on response header is introduced', function() {
        // Vary is emitted ONLY inside the negotiate===true branch, so a project that
        // never declares the flag sees a byte-identical response.
        var idx = CONTROLLER_SRC.indexOf("local.req.routing.negotiate === true");
        var varyIdx = CONTROLLER_SRC.indexOf("setHeader('vary', 'X-Gina-Navigate')");
        assert.ok(idx > -1 && varyIdx > idx, 'the Vary emit sits inside the negotiate branch');
    });
});
