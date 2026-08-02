'use strict';
/**
 * #B212 — /_gina/assets/routing.json engine parity.
 *
 * The client-served routing maps (the full map + the #B66 host-stripped
 * variant) used to be built AND served by the isaac engine only
 * (`server.isaac.js`): under `engine: "express"` the URL fell through to
 * normal routing and 404'd — and the client, lacking a `response.ok` check
 * (#B213), then installed the 404 JSON body AS its routing table. Measured
 * live 2026-08-02 (isolated bundle, engine key the single variable, positive
 * controls `/web/` + `/_gina/health/check` + `/_gina/info` all 200 under
 * express, negative control 404 under both engines).
 *
 * The fix moves the map build into ONE engine-agnostic builder in
 * `core/server.js` (`buildClientRoutingAssets`) — isaac consumes it for its
 * precompressed-file fast-path, and a `server.js` `onRequest` handler serves
 * the maps from memory for every other engine, mirroring the MS2
 * `/_gina/health/check` precedent (same `/_gina/*` sync-rule gap, same fix
 * shape).
 *
 * Strategy: source inspection + behavioural extraction (the extracted REAL
 * builder is driven over synthetic route tables — no re-typed replica).
 * No live HTTP server or project required.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW           = require('../fw');
var SERVER_PATH  = path.join(FW, 'core/server.js');
var ISAAC_PATH   = path.join(FW, 'core/server.isaac.js');


describe('#B212 §00 — instrument: sources readable, known anchors present', function() {

    it('both engine sources read, and a known-positive anchor fires in each', function() {
        var serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
        var isaacSrc  = fs.readFileSync(ISAAC_PATH, 'utf8');
        // known positives — if these fail, later 0-results mean a broken
        // instrument, not an absent feature (pair every 0 with a firing control)
        assert.ok(serverSrc.indexOf('/_gina/health/check') > -1,
            'server.js health/check anchor must fire (control)');
        assert.ok(isaacSrc.indexOf('assetsCollection') > -1,
            'isaac assetsCollection anchor must fire (control)');
        // known negative — the instrument can also NOT fire
        assert.equal(serverSrc.indexOf('zzz-bogus-anchor-b212'), -1,
            'bogus anchor must not fire (control)');
    });
});


describe('#B212 §01 — the shared builder lives in core/server.js, and isaac consumes it', function() {

    var serverSrc, isaacSrc;

    before(function() {
        serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
        isaacSrc  = fs.readFileSync(ISAAC_PATH, 'utf8');
    });

    it('server.js defines buildClientRoutingAssets', function() {
        assert.ok(serverSrc.indexOf('function buildClientRoutingAssets(') > -1,
            'expected the engine-agnostic builder function in core/server.js');
    });

    it('the #COMPLY1 strip, #COMPLY10 delete and #B66 derivation live in the server.js builder', function() {
        var fnIdx = serverSrc.indexOf('function buildClientRoutingAssets(');
        assert.ok(fnIdx > -1);
        var stripIdx   = serverSrc.indexOf('const { requireAuth, roles, policy, ...cleanParam } = clean.param;', fnIdx);
        var publicIdx  = serverSrc.indexOf('delete cleanParam.public;', fnIdx);
        var derivedIdx = serverSrc.indexOf('var _routingStripped = JSON.clone(_routing);', fnIdx);
        var hostIdx    = serverSrc.indexOf('const { host, hostname, ...cleanStripped }', fnIdx);
        assert.ok(stripIdx > fnIdx,   'the #COMPLY1 authorization strip must live in the builder');
        assert.ok(publicIdx > stripIdx, 'the #COMPLY10 public strip must follow the #COMPLY1 destructuring');
        assert.ok(derivedIdx > stripIdx,
            'the #B66 stripped variant must be derived AFTER the strip (so it inherits it)');
        assert.ok(hostIdx > derivedIdx, 'the #B66 host/hostname drop must operate on the derived clone');
    });

    it('webroot is never destructured away (load-bearing for client toUrl — #B66)', function() {
        assert.ok(serverSrc.indexOf('const { host, hostname, webroot,') < 0,
            'webroot must NOT be dropped — the client toUrl path relies on route.webroot');
    });

    it('init builds the maps BEFORE the engine is constructed, and hands them to it', function() {
        var buildIdx  = serverSrc.indexOf('buildClientRoutingAssets(serverOpt.allRoutes)');
        var handIdx   = serverSrc.indexOf('serverOpt.clientRoutingAssets');
        var engineIdx = serverSrc.indexOf("Engine = require('./server.'");
        assert.ok(buildIdx > -1, 'init must call the builder');
        assert.ok(handIdx > -1,  'init must hand the maps to the engine via serverOpt.clientRoutingAssets');
        assert.ok(engineIdx > -1, 'engine construction anchor (control)');
        assert.ok(buildIdx < engineIdx,
            'the maps must exist before `new Engine(serverOpt)` — isaac consumes them in its constructor');
        assert.ok(handIdx < engineIdx,
            'the hand-off must precede engine construction');
    });

    it('server.js keeps pre-stringified copies for its own serve path', function() {
        var fullIdx     = serverSrc.indexOf('full     : JSON.stringify(_clientRoutingAssets.full)');
        var strippedIdx = serverSrc.indexOf('stripped : JSON.stringify(_clientRoutingAssets.stripped)');
        assert.ok(fullIdx > -1,     'expected the pre-stringified full map on self._clientRoutingAssets');
        assert.ok(strippedIdx > -1, 'expected the pre-stringified stripped map on self._clientRoutingAssets');
    });

    it('isaac CONSUMES options.clientRoutingAssets instead of rebuilding', function() {
        assert.ok(isaacSrc.indexOf('options.clientRoutingAssets.full') > -1,
            'isaac must take the full map from options');
        assert.ok(isaacSrc.indexOf('options.clientRoutingAssets.stripped') > -1,
            'isaac must take the stripped map from options');
    });

    it('the strip no longer exists in isaac — ONE builder, no drift surface', function() {
        // decisive red-first discriminator: on pre-#B212 bytes these lines DO
        // exist in isaac, so this test fails until the build genuinely moves
        assert.equal(isaacSrc.indexOf('const { requireAuth, roles, policy, ...cleanParam } = clean.param;'), -1,
            'the #COMPLY1 strip must not be duplicated in isaac');
        assert.equal(isaacSrc.indexOf('var _routingStripped = JSON.clone(_routing);'), -1,
            'the #B66 derivation must not be duplicated in isaac');
    });

    it('isaac keeps its file-write fast-path (the precompressed variants)', function() {
        assert.ok(isaacSrc.indexOf("targetFile  = 'routing.json';") > -1,
            'the full-map file write stays in isaac');
        assert.ok(isaacSrc.indexOf("targetFile  = 'routing.stripped.json';") > -1,
            'the stripped-map file write stays in isaac');
    });
});


describe('#B212 §02 — the engine-agnostic onRequest handler', function() {

    var serverSrc;

    before(function() {
        serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
    });

    it('defines a GET /_gina/assets/routing.json handler inside onInstance, after health/check', function() {
        var healthIdx  = serverSrc.indexOf('/_gina\\/health\\/check$');
        var handlerIdx = serverSrc.indexOf('/_gina\\/assets\\/routing\\.json$');
        assert.ok(healthIdx > -1,  'health/check regex anchor (control)');
        assert.ok(handlerIdx > -1, 'routing.json regex anchor not found in server.js');
        assert.ok(handlerIdx > healthIdx,
            'the asset handler sits with its /_gina siblings, after the liveness probe');
    });

    it('classifies proxied-ness per request with the #B65-twin heuristic (isaac stamp is unreachable here)', function() {
        var handlerIdx = serverSrc.indexOf('/_gina\\/assets\\/routing\\.json$');
        var hostIdx    = serverSrc.indexOf("request.headers.host || request.headers[':authority']", handlerIdx);
        var xfhIdx     = serverSrc.indexOf("request.headers['x-forwarded-host']", handlerIdx);
        var optOutIdx  = serverSrc.indexOf('process.gina._proxyRequireForwarded !== true', handlerIdx);
        assert.ok(hostIdx > handlerIdx,   'the handler must read Host/:authority itself');
        assert.ok(xfhIdx > handlerIdx,    'the handler must honour X-Forwarded-Host');
        assert.ok(optOutIdx > handlerIdx, 'the #B152 opt-out must disable the port-less-Host heuristic here too');
    });

    it('serves the stripped variant to proxied clients, the full map otherwise (#B66)', function() {
        var handlerIdx  = serverSrc.indexOf('/_gina\\/assets\\/routing\\.json$');
        var strippedIdx = serverSrc.indexOf('self._clientRoutingAssets.stripped', handlerIdx);
        var fullIdx     = serverSrc.indexOf('self._clientRoutingAssets.full', handlerIdx);
        assert.ok(strippedIdx > handlerIdx, 'proxied clients get the host-stripped variant');
        assert.ok(fullIdx > handlerIdx,     'raw clients keep the full map');
    });

    it('marks the proxied variant private (shared caches must not cross-serve the variants)', function() {
        var handlerIdx = serverSrc.indexOf('/_gina\\/assets\\/routing\\.json$');
        var ccIdx      = serverSrc.indexOf("'private, max-age=86400' : 'public, max-age=86400'", handlerIdx);
        assert.ok(ccIdx > handlerIdx,
            'expected the #B66 private/public cache-control split in the handler');
    });
});


describe('#B212 §03 — extracted builder behaviour (the REAL function, no replica)', function() {

    var build;

    // Extracts the genuine buildClientRoutingAssets from core/server.js by
    // string anchors and compiles it with a JSON.clone shim — the shipped
    // bytes are what runs, so a source drift fails here, not in production.
    before(function() {
        var src   = fs.readFileSync(SERVER_PATH, 'utf8');
        var start = src.indexOf('function buildClientRoutingAssets(');
        assert.ok(start > -1, 'builder not found — extraction cannot proceed');
        var retNeedle = 'return { full: _routing, stripped: _routingStripped };';
        var retIdx    = src.indexOf(retNeedle, start);
        assert.ok(retIdx > start, 'builder return shape not found');
        var end  = src.indexOf('}', retIdx + retNeedle.length);
        assert.ok(end > retIdx, 'builder closing brace not found');
        var body = src.slice(start, end + 1);
        var JSONShim = Object.create(JSON);
        JSONShim.clone = function(o) { return JSON.parse(JSON.stringify(o)); };
        /* eslint-disable no-new-func */
        var factory = new Function('JSON', body + '\nreturn buildClientRoutingAssets;');
        /* eslint-enable no-new-func */
        build = factory(JSONShim);
    });

    function sampleRoutes() {
        return {
            'panel@web': {
                method     : 'GET',
                url        : '/web/admin',
                webroot    : '/web/',
                host       : 'http://internal-host:3100',
                hostname   : 'http://internal-host:3100',
                middleware : ['x'],
                _comment   : 'internal note',
                param      : {
                    control     : 'panel',
                    file        : 'admin',
                    path        : '/x',
                    requireAuth : true,
                    roles       : ['admin'],
                    policy      : 'isOwner',
                    'public'    : true
                }
            },
            'plain@web': { method: 'GET', url: '/plain' }
        };
    }

    it('strips _comment, middleware and the four authorization keys from the full map', function() {
        var maps  = build(sampleRoutes());
        var route = maps.full['panel@web'];
        assert.equal(typeof route._comment,          'undefined');
        assert.equal(typeof route.middleware,        'undefined');
        assert.equal(typeof route.param.requireAuth, 'undefined');
        assert.equal(typeof route.param.roles,       'undefined');
        assert.equal(typeof route.param.policy,      'undefined');
        assert.equal(typeof route.param.public,      'undefined');
    });

    it('keeps the client contract keys in the full map', function() {
        var maps  = build(sampleRoutes());
        var route = maps.full['panel@web'];
        assert.equal(route.url, '/web/admin');
        assert.equal(route.method, 'GET');
        assert.equal(route.webroot, '/web/');
        assert.equal(route.param.control, 'panel');
        assert.equal(route.param.file, 'admin');
        assert.equal(route.param.path, '/x');
        // the FULL map keeps host/hostname — only the #B66 variant drops them
        assert.equal(route.host, 'http://internal-host:3100');
        assert.equal(route.hostname, 'http://internal-host:3100');
    });

    it('the stripped variant drops host + hostname and KEEPS webroot, inheriting the strip', function() {
        var maps  = build(sampleRoutes());
        var route = maps.stripped['panel@web'];
        assert.equal(typeof route.host,     'undefined');
        assert.equal(typeof route.hostname, 'undefined');
        assert.equal(route.webroot, '/web/', 'webroot is load-bearing for the client toUrl path');
        // inherited from the full-map strip (derived AFTER, so it can never resurface)
        assert.equal(typeof route.param.requireAuth, 'undefined');
        assert.equal(typeof route.param.roles,       'undefined');
        assert.equal(typeof route.param.policy,      'undefined');
        assert.equal(typeof route.param.public,      'undefined');
        assert.equal(typeof route.middleware,        'undefined');
    });

    it('a param-less route flows through untouched (guarded)', function() {
        var maps = build(sampleRoutes());
        assert.equal(maps.full['plain@web'].url, '/plain');
        assert.equal(typeof maps.full['plain@web'].param, 'undefined');
        assert.equal(maps.stripped['plain@web'].url, '/plain');
    });

    it('never mutates the live route table (the JSON.clone guarantee)', function() {
        var input    = sampleRoutes();
        var snapshot = JSON.parse(JSON.stringify(input));
        build(input);
        assert.deepEqual(input, snapshot,
            'the builder must operate on clones — the live config is not its to rewrite');
    });
});
