/**
 * lib/ws-query — cross-bundle session.query() for WS channel handlers (#H13 slice 3b).
 *
 * Require-by-path like the sibling lib suites. Three layers:
 *  - source-structure pins on the seam construction (reuse the framework
 *    controller per query, warm cache via serverInstance = app, the {headers:{}}
 *    synthetic req — NOT null, the promisify/callback result path, the deep-cloned
 *    conf + synthetic routing entry);
 *  - real-module behaviour reachable without a booted bundle (build returns a
 *    function; the bundle/env guard rejects; the optional trailing callback and the
 *    returned Promise both deliver the error);
 *  - pure-logic replicas of the controllerOptions shaping and the data/callback
 *    normalization.
 *
 * The happy path (controller construction → controller.query against a target) is
 * locked by these source pins + the server.isaac.test.js §12h dispatcher attach +
 * the ws-session.test.js §11 loopback + the live-boot cross-bundle smoke.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var fs   = require('fs');

var FW  = require('../fw');
var SRC = fs.readFileSync(path.join(FW, 'lib/ws-query/src/main.js'), 'utf8');
var wsQuery = require(path.join(FW, 'lib/ws-query/src/main'));


describe('01 - ws-query source structure', function() {

    it('exports a build factory', function() {
        assert.match(SRC, /module\.exports\s*=\s*\{[\s\S]*build\s*:\s*build/, 'expected module.exports = { build }');
        assert.match(SRC, /function build\(app, bundle, env\)/, 'expected build(app, bundle, env)');
    });

    it('build returns the per-call query function (fresh controller per query)', function() {
        var retIdx = SRC.indexOf('return function query(options, data, callback)');
        var ctorIdx = SRC.indexOf('var controller = new Controller(controllerOptions);');
        assert.ok(retIdx > -1, 'expected build to return function query(options, data, callback)');
        assert.ok(ctorIdx > retIdx,
            'the controller must be constructed INSIDE the returned query function (fresh per query — query() owns a single query#complete listener)');
    });

    it('reuses the framework controller (Option A, not a re-implemented client)', function() {
        assert.match(SRC, /require\(_\(GINA_FRAMEWORK_DIR \+ '\/core\/controller\/controller\.js', true\)\)/,
            'expected the controller required via _(GINA_FRAMEWORK_DIR + .../controller.js, true)');
        assert.ok(SRC.indexOf('new Controller(controllerOptions)') > -1, 'expected new Controller(controllerOptions)');
    });

    it('wires the WARM session cache via serverInstance = app', function() {
        assert.ok(SRC.indexOf('controller.serverInstance = app;') > -1,
            'expected controller.serverInstance = app (the live server holds the warm _cached/_http2Sessions)');
    });

    it('passes a {headers:{}} synthetic req to setOptions — NOT null', function() {
        assert.ok(SRC.indexOf('controller.setOptions({ headers: {} }, null, function () {}, controllerOptions);') > -1,
            'expected setOptions with a {headers:{}} stub req (setOptions calls getParams(req) + reads req.headers)');
        assert.doesNotMatch(SRC, /setOptions\(\s*null\b/,
            'the req arg to setOptions must NOT be null — setOptions itself crashes on a null req (getParams :4732, :292)');
    });

    it('delivers the result via the promisify/callback path, not the emitter', function() {
        assert.match(SRC, /util\.promisify\(controller\.query\)\(options, data\)/,
            'expected util.promisify(controller.query)(options, data)');
        assert.ok(SRC.indexOf("self.emit('query#complete'") < 0,
            'ws-query must not use the emitter path (the WS handler is not an EventEmitter; the emitter shares the colliding query#complete listener)');
    });

    it('deep-clones the bundle conf and synthesizes the routing entry the :328 deref needs', function() {
        assert.match(SRC, /conf\s*:\s*JSON\.clone\(conf\)/, 'expected conf: JSON.clone(conf) (deep clone — no shared-config mutation)');
        assert.ok(SRC.indexOf('controllerOptions.conf.content.routing[rule] = { param: {} };') > -1,
            'expected the synthetic _wsQuery routing entry (setOptions :328 derefs conf.content.routing[rule].param)');
    });

    it('guards a missing captured bundle/env', function() {
        assert.match(SRC, /if \(!bundle \|\| !env\)/, 'expected the bundle/env capture guard');
    });
});


describe('02 - ws-query real-module behaviour (no booted bundle)', function() {

    it('build(app, bundle, env) returns a query function without touching Config', function() {
        var q = wsQuery.build({ _cached: new Map(), _http2Sessions: [] }, 'demo', 'dev');
        assert.equal(typeof q, 'function', 'build returns the query closure (Config is only resolved when query() runs)');
    });

    it('the query rejects when no bundle/env was captured (guard before any global use)', async function() {
        await assert.rejects(
            wsQuery.build({}, null, null)({ hostname: 'http://127.0.0.1:1', path: '/', method: 'GET' }),
            /no bundle\/env captured/,
            'a server with no captured bundle/env rejects cleanly instead of a cryptic TypeError'
        );
    });

    it('the optional trailing callback receives the error (and the returned promise still rejects)', async function() {
        var cbErr = await new Promise(function(resolve) {
            var p = wsQuery.build({}, null, null)(
                { hostname: 'http://127.0.0.1:1', path: '/', method: 'GET' },
                function(err) { resolve(err); }
            );
            p.catch(function() {}); // the returned promise is also rejected — swallow it
        });
        assert.ok(cbErr instanceof Error, 'the trailing callback got the Error');
        assert.match(cbErr.message, /no bundle\/env captured/);
    });

    it('treats a 2nd-arg function as the callback (data defaults), still surfacing the error', async function() {
        var cbErr = await new Promise(function(resolve) {
            var p = wsQuery.build({}, null, null)(
                { hostname: 'http://127.0.0.1:1', path: '/', method: 'GET' },
                function(err) { resolve(err); } // passed as `data`, normalized to the callback
            );
            p.catch(function() {});
        });
        assert.ok(cbErr instanceof Error, 'the 2nd-arg function was treated as the callback');
    });
});


describe('03 - ws-query controllerOptions shaping (pure replica)', function() {

    // Faithful replica of build()'s option shaping. The §01 source pins lock the
    // real operators so this replica cannot silently drift.
    function shape(conf, rule) {
        var co = {
            rule        : rule,
            isCacheless : conf.isCacheless,
            conf        : JSON.parse(JSON.stringify(conf)) // stand-in for JSON.clone (deep clone)
        };
        if (!co.conf.content) { co.conf.content = {}; }
        if (!co.conf.content.routing) { co.conf.content.routing = {}; }
        co.conf.content.routing[rule] = { param: {} };
        return co;
    }

    it('deep-clones the conf — the source bundle config is never mutated', function() {
        var conf = { isCacheless: false, content: { routing: { 'home@b': { param: { control: 'x' } } } }, server: {} };
        var co = shape(conf, '_wsQuery');
        co.conf.content.routing['_wsQuery'].param.injected = true;
        assert.equal(conf.content.routing['_wsQuery'], undefined, 'the synthetic rule never appears on the source conf');
        assert.deepEqual(conf.content.routing['home@b'].param, { control: 'x' }, 'the source routing is untouched');
    });

    it('synthesizes the routing entry the setOptions :328 deref needs', function() {
        var co = shape({ isCacheless: true, content: {}, server: {} }, '_wsQuery');
        assert.deepEqual(co.conf.content.routing['_wsQuery'], { param: {} },
            'conf.content.routing[rule].param must exist (an empty map) so setOptions :328 does not TypeError');
    });

    it('carries isCacheless and sets no template/control (so setOptions skips its page.* block)', function() {
        var co = shape({ isCacheless: true, content: {}, server: {} }, '_wsQuery');
        assert.equal(co.isCacheless, true);
        assert.equal(co.template, undefined, 'no template key — setOptions skips the page.* promotion block');
        assert.equal(co.control, undefined, 'no control key — setOptions skips the page.* promotion block');
    });

    it('builds routing/content scaffolding even when the conf lacks them', function() {
        var co = shape({ isCacheless: false }, '_wsQuery');
        assert.deepEqual(co.conf.content.routing['_wsQuery'], { param: {} });
    });
});


describe('04 - ws-query data/callback normalization (pure replica)', function() {

    function normalize(data, callback) {
        if (typeof data === 'function') { callback = data; data = undefined; }
        data = data || {};
        return { data: data, callback: callback };
    }

    it('a 2-arg call treats data as the callback and defaults data to {}', function() {
        var fn = function() {};
        var r = normalize(fn, undefined);
        assert.equal(r.callback, fn);
        assert.deepEqual(r.data, {});
    });

    it('a 3-arg call keeps data and callback as given', function() {
        var fn = function() {};
        var r = normalize({ a: 1 }, fn);
        assert.deepEqual(r.data, { a: 1 });
        assert.equal(r.callback, fn);
    });

    it('a 1-arg call (no data, no callback) defaults data to {} and leaves callback undefined', function() {
        var r = normalize(undefined, undefined);
        assert.deepEqual(r.data, {});
        assert.equal(r.callback, undefined);
    });
});
