'use strict';
/**
 * server.js — #H13 routing.json-declared WebSocket route registration (slice 1)
 *
 * A "method": "ws" route names a connection-handler module via
 * `param.wsHandler`, resolved under the bundle's `channels/` dir, and is
 * registered at bundle bootstrap through the engine's own
 * `onWebSocket(path, handler)` (so a non-http/2 bundle inherits the warn-noop
 * stub rather than a registry nothing reads). WS dispatch happens in the
 * engine's extended-CONNECT handler — these routes never reach
 * handle()/router.route.
 *
 * Strategy: source inspection + a pure-logic replica of the registration loop.
 * No live HTTP server or project required.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var SERVER_SRC  = path.join(require('../fw'), 'core/server.js');
var ROUTING_SRC = path.join(require('../fw'), 'lib/routing/src/main.js');


describe('#H13 — WS-route registration source structure (server.js)', function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    it('iterates the bundle routing and selects only method:"ws" routes', function() {
        assert.ok(src.indexOf('var _wsRouting') > -1, 'expected the _wsRouting iteration over serverOpt.routing');
        assert.match(src, /\/\^ws\$\/i\.test\(_wsRoute\.method/, 'expected a case-insensitive ws-method filter (/^ws$/i)');
    });

    it('registers through engine.instance.onWebSocket — never writes _wsHandlers directly', function() {
        assert.ok(src.indexOf('engine.instance.onWebSocket(_wsUrl, _wsHandlerFn)') > -1,
            'expected registration via engine.instance.onWebSocket');
        assert.ok(src.indexOf('_wsHandlers') < 0,
            'server.js must go through onWebSocket (the registry _wsHandlers is an isaac engine internal)');
    });

    it('resolves the handler module under the bundle channels/ dir from param.wsHandler', function() {
        assert.ok(src.indexOf('_wsRoute.param.wsHandler') > -1, 'expected param.wsHandler read');
        assert.match(src, /\/channels\/'\s*\+\s*_wsName\s*\+\s*'\.js'/, 'expected channels/<name>.js path resolution');
    });

    it('fails loudly at boot on a missing wsHandler / unloadable / non-function module', function() {
        assert.ok(src.indexOf('must declare `param.wsHandler`') > -1, 'expected throw on missing param.wsHandler');
        assert.ok(src.indexOf('could not be loaded') > -1, 'expected throw on an unloadable channel module');
        assert.ok(src.indexOf('must export a function (session, request)') > -1, 'expected throw on a non-function export');
    });

    it('warns once when ws routes are declared on an engine without WebSocket support', function() {
        assert.ok(src.indexOf('has no WebSocket support') > -1, 'expected the unsupported-engine warn');
        assert.ok(src.indexOf('_wsUnsupportedWarned') > -1, 'expected the warn-once guard');
    });

    it('registers each URL of a comma-separated route and warns on a duplicate path', function() {
        assert.match(src, /String\(_wsRoute\.url \|\| ''\)\.split\(','\)/, 'expected the multi-url split');
        assert.ok(src.indexOf('is declared by more than one') > -1, 'expected the duplicate-path collision warn');
    });

    it('registers BEFORE the configured emit (so a programmatic app.onWebSocket in onInitialize wins)', function() {
        var regIdx  = src.indexOf('var _wsRouting');
        var emitIdx = src.indexOf("self.emit('configured'", regIdx);
        assert.ok(regIdx > -1 && emitIdx > regIdx, 'WS registration must precede the configured emit');
    });
});


describe('#H13 — WS routes bypass fitsWithRequirements (allowedMethods unchanged)', function() {

    var routingSrc;
    before(function() { routingSrc = fs.readFileSync(ROUTING_SRC, 'utf8'); });

    it('lib/routing allowedMethods stays the 4 HTTP methods — no `ws`', function() {
        assert.match(routingSrc, /allowedMethods\s*:\s*\[\s*'get'\s*,\s*'post'\s*,\s*'put'\s*,\s*'delete'\s*\]/,
            'allowedMethods must remain the 4 HTTP methods');
        assert.doesNotMatch(routingSrc, /allowedMethods\s*:\s*\[[^\]]*['"]ws['"]/,
            'a `ws` method must NOT be added to allowedMethods — WS dispatch bypasses the HTTP matcher');
    });
});


describe('#H13 — WS-route registration logic (pure replica)', function() {

    // Faithful replica of the server.js registration loop. The source-structure
    // pins above lock the operators so this replica cannot silently drift.
    function registerWsRoutes(routing, engineInstance, requireFn, warn) {
        var registered = {};
        var unsupportedWarned = false;
        var calls = [];
        for (var rule in routing) {
            var route = routing[rule];
            if (typeof route != 'object' || route === null || !/^ws$/i.test(route.method || '')) {
                continue;
            }
            if (typeof engineInstance.onWebSocket != 'function') {
                if (!unsupportedWarned) { warn('unsupported'); unsupportedWarned = true; }
                continue;
            }
            var name = (route.param && typeof route.param.wsHandler == 'string' && route.param.wsHandler != '')
                ? route.param.wsHandler
                : null;
            if (!name) { throw new Error('WebSocket route `' + rule + '` must declare `param.wsHandler`'); }
            var fn = null;
            try {
                fn = requireFn(name);
            } catch (e) {
                throw new Error('channel module `channels/' + name + '.js` could not be loaded: ' + e.message);
            }
            if (typeof fn != 'function') {
                throw new Error('channel module `channels/' + name + '.js` must export a function (session, request)');
            }
            var urls = String(route.url || '').split(',');
            for (var i = 0; i < urls.length; i++) {
                var url = urls[i].trim();
                if (!url) { continue; }
                if (registered[url]) { warn('collision:' + url); }
                registered[url] = true;
                engineInstance.onWebSocket(url, fn);
                calls.push([url, fn]);
            }
        }
        return calls;
    }

    function mkEngine() {
        var reg = {};
        return { reg: reg, onWebSocket: function(p, h) { reg[p] = h; } };
    }
    var FN        = function(session, request) {};
    var requireOk = function(name) { return FN; };

    it('registers a method:"ws" route and skips HTTP routes', function() {
        var eng = mkEngine(), warns = [];
        registerWsRoutes(
            { 'home@b': { method: 'get', url: '/',     param: { control: 'default' } },
              'live@b': { method: 'ws',  url: '/live', param: { wsHandler: 'feed' } } },
            eng, requireOk, function(w) { warns.push(w); }
        );
        assert.equal(typeof eng.reg['/live'], 'function', '/live registered');
        assert.equal(eng.reg['/'], undefined, 'an HTTP route is never registered as ws');
        assert.equal(warns.length, 0);
    });

    it('matches the ws method case-insensitively ("WS")', function() {
        var eng = mkEngine();
        registerWsRoutes({ 'x@b': { method: 'WS', url: '/x', param: { wsHandler: 'x' } } }, eng, requireOk, function() {});
        assert.equal(typeof eng.reg['/x'], 'function');
    });

    it('throws on a ws route missing param.wsHandler', function() {
        var eng = mkEngine();
        assert.throws(function() {
            registerWsRoutes({ 'x@b': { method: 'ws', url: '/x', param: {} } }, eng, requireOk, function() {});
        }, /param\.wsHandler/);
    });

    it('throws when the channel module cannot be loaded', function() {
        var eng = mkEngine();
        var requireThrows = function() { throw new Error('Cannot find module'); };
        assert.throws(function() {
            registerWsRoutes({ 'x@b': { method: 'ws', url: '/x', param: { wsHandler: 'missing' } } }, eng, requireThrows, function() {});
        }, /could not be loaded/);
    });

    it('throws when the channel module does not export a function', function() {
        var eng = mkEngine();
        var requireObj = function() { return { not: 'a function' }; };
        assert.throws(function() {
            registerWsRoutes({ 'x@b': { method: 'ws', url: '/x', param: { wsHandler: 'obj' } } }, eng, requireObj, function() {});
        }, /must export a function/);
    });

    it('warns exactly once (no throw, no registration) when the engine has no onWebSocket', function() {
        var engNoWs = {}; // express engine — no onWebSocket
        var warns = [];
        registerWsRoutes(
            { 'a@b': { method: 'ws', url: '/a', param: { wsHandler: 'a' } },
              'c@b': { method: 'ws', url: '/c', param: { wsHandler: 'c' } } },
            engNoWs, requireOk, function(w) { warns.push(w); }
        );
        assert.deepEqual(warns, ['unsupported'], 'warns once for the whole bundle, not per route');
    });

    it('registers each URL of a comma-separated (multi-url) route', function() {
        var eng = mkEngine();
        registerWsRoutes({ 'm@b': { method: 'ws', url: '/a, /b', param: { wsHandler: 'm' } } }, eng, requireOk, function() {});
        assert.equal(typeof eng.reg['/a'], 'function');
        assert.equal(typeof eng.reg['/b'], 'function');
    });

    it('warns on a duplicate path across two ws routes (last wins)', function() {
        var eng = mkEngine(), warns = [];
        registerWsRoutes(
            { 'a@b': { method: 'ws', url: '/dup', param: { wsHandler: 'a' } },
              'b@b': { method: 'ws', url: '/dup', param: { wsHandler: 'b' } } },
            eng, requireOk, function(w) { warns.push(w); }
        );
        assert.ok(warns.some(function(w) { return /^collision:\/dup/.test(w); }), 'duplicate path warned');
    });
});
