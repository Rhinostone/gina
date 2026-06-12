var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var SOURCE = path.join(require('../fw'), 'core/router.js');


// Replica of resolveRouteConfig from router.js for isolated logic testing (#P25).
// In production, router.js uses module-level Config and merge.
// Here _Config and _merge are injected to avoid framework dependencies.
function resolveRouteConfig(serverInstance, params, response, controllerFile, local, _Config, _merge) {
    try {
        var config = new _Config().getInstance();
        if (!params.bundle) {
            try {
                //params.bundle = config.bundle;
                //params.param = config.routing[config.reverseRouting[params.param.url]];
                var _rule = config.reverseRouting[params.param.url];
                params = _merge(params, config.routing[_rule]);
                params.rule = _rule;
            } catch(reverseRoutingError) {
                serverInstance.throwError(response, 500, reverseRoutingError);
                return null;
            }
        }
        var bundle = params.bundle;
        local.bundle = bundle;
        return {
            config  : config,
            bundle  : bundle,
            env     : config.env,
            scope   : config.scope,
            conf    : config[bundle][config.env],
            params  : params
        };
    } catch (configErr) {
        serverInstance.throwError(response, 500, new Error('syntax error(s) found in `'+ controllerFile +'` \nTrace: ') + (configErr.stack || configErr.message));
        return null;
    }
}

function stubMerge(a, b) {
    if (!b) return a;
    var r = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) r[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) r[k] = b[k];
    return r;
}


// 01 — resolveRouteConfig: happy path with params.bundle pre-set
describe('01 - resolveRouteConfig: happy path with params.bundle pre-set', function() {

    function makeSetup() {
        var config = {
            env: 'dev',
            scope: 'local',
            myapp: { dev: { template: true, bundlesPath: '/app/bundles' } }
        };
        return {
            config      : config,
            Config      : function() { this.getInstance = function() { return config; }; },
            serverInstance  : { throwError: function() { assert.fail('throwError must not be called on happy path'); } },
            response    : {},
            local       : {},
            params      : { bundle: 'myapp', param: { control: 'home' }, middleware: [] }
        };
    }

    it('returns a non-null object', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.notEqual(result, null);
        assert.equal(typeof result, 'object');
    });

    it('result.bundle equals params.bundle', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(result.bundle, 'myapp');
    });

    it('result.env and result.scope come from config', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(result.env, 'dev');
        assert.equal(result.scope, 'local');
    });

    it('result.conf is config[bundle][env]', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.strictEqual(result.conf, s.config['myapp']['dev']);
    });

    it('sets local.bundle to params.bundle', function() {
        var s = makeSetup();
        resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(s.local.bundle, 'myapp');
    });

    it('result.config is the instance returned by Config().getInstance()', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.strictEqual(result.config, s.config);
    });

});


// 02 — resolveRouteConfig: reverseRouting resolution when params.bundle not set
describe('02 - resolveRouteConfig: reverseRouting resolution when params.bundle not set', function() {

    function makeSetup() {
        var config = {
            env: 'dev',
            scope: 'local',
            reverseRouting: { '/home': 'home@myapp' },
            routing: { 'home@myapp': { bundle: 'myapp', param: { control: 'home' } } },
            myapp: { dev: { template: true, bundlesPath: '/app/bundles' } }
        };
        return {
            config      : config,
            Config      : function() { this.getInstance = function() { return config; }; },
            serverInstance  : { throwError: function() { assert.fail('throwError must not be called on happy path'); } },
            response    : {},
            local       : {},
            params      : { param: { url: '/home', control: null }, middleware: [] }  // no bundle
        };
    }

    it('returns a non-null object', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.notEqual(result, null);
    });

    it('resolves bundle from reverseRouting', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(result.bundle, 'myapp');
    });

    it('sets result.params.rule to the resolved rule', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(result.params.rule, 'home@myapp');
    });

    it('sets local.bundle to the resolved bundle', function() {
        var s = makeSetup();
        resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(s.local.bundle, 'myapp');
    });

});


// 03 — resolveRouteConfig: inner catch — reverseRoutingError
describe('03 - resolveRouteConfig: inner catch — reverseRoutingError', function() {

    function makeSetup() {
        var config = {
            env: 'dev',
            scope: 'local',
            reverseRouting: null    // null[url] throws TypeError → triggers inner catch
        };
        var calls = [];
        return {
            Config      : function() { this.getInstance = function() { return config; }; },
            serverInstance  : { throwError: function(res, status, err) { calls.push({ status: status, err: err }); } },
            response    : {},
            local       : {},
            params      : { param: { url: '/home' }, middleware: [] },  // no bundle
            calls       : calls
        };
    }

    it('returns null', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(result, null);
    });

    it('calls serverInstance.throwError once', function() {
        var s = makeSetup();
        resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(s.calls.length, 1);
    });

    it('calls throwError with status 500', function() {
        var s = makeSetup();
        resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.equal(s.calls[0].status, 500);
    });

    it('passes the caught error to throwError', function() {
        var s = makeSetup();
        resolveRouteConfig(s.serverInstance, s.params, s.response, undefined, s.local, s.Config, stubMerge);
        assert.ok(s.calls[0].err instanceof TypeError, 'expected TypeError from null[url]');
    });

});


// 04 — resolveRouteConfig: outer catch — configErr
describe('04 - resolveRouteConfig: outer catch — configErr', function() {

    function makeSetup() {
        var calls = [];
        return {
            Config      : function() { this.getInstance = function() { throw new Error('Config init failed'); }; },
            serverInstance  : { throwError: function(res, status) { calls.push({ status: status }); } },
            response    : {},
            local       : {},
            params      : { bundle: 'myapp', param: {}, middleware: [] },
            calls       : calls
        };
    }

    it('returns null on configErr', function() {
        var s = makeSetup();
        var result = resolveRouteConfig(s.serverInstance, s.params, s.response, 'controller.js', s.local, s.Config, stubMerge);
        assert.equal(result, null);
    });

    it('calls serverInstance.throwError once', function() {
        var s = makeSetup();
        resolveRouteConfig(s.serverInstance, s.params, s.response, 'controller.js', s.local, s.Config, stubMerge);
        assert.equal(s.calls.length, 1);
    });

    it('calls throwError with status 500', function() {
        var s = makeSetup();
        resolveRouteConfig(s.serverInstance, s.params, s.response, 'controller.js', s.local, s.Config, stubMerge);
        assert.equal(s.calls[0].status, 500);
    });

});


// Replica of the async dispatch guard introduced in Stream A (0.3.0).
// controller[action]() return value is inspected; if thenable, .catch() is attached.
function dispatchAction(serverInstance, controller, action, request, response, next) {
    var _result = controller[action](request, response, next);
    if (_result && typeof _result.then === 'function') {
        return _result.catch(function(err) {
            serverInstance.throwError(response, 500, err.stack || err.message || String(err));
        });
    }
}


// 05 — source structure: resolveRouteConfig extracted to module level (#P25)
describe('05 - source structure: resolveRouteConfig extracted to module level (#P25)', function() {

    it('function resolveRouteConfig is declared in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('function resolveRouteConfig(') > -1,
            'expected `function resolveRouteConfig(` — #P25 extraction not applied'
        );
    });

    it('resolveRouteConfig is declared before function Router (module-level, not inside route)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var fnPos     = src.indexOf('function resolveRouteConfig(');
        var routerPos = src.indexOf('function Router(');
        assert.ok(fnPos > -1,     'function resolveRouteConfig not found');
        assert.ok(routerPos > -1, 'function Router not found');
        assert.ok(
            fnPos < routerPos,
            'resolveRouteConfig must appear before function Router — must be module-level, not nested inside route()'
        );
    });

    it('route() delegates to resolveRouteConfig()', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('resolveRouteConfig(serverInstance,') > -1,
            'route() must call resolveRouteConfig(serverInstance, ...) — #P25 delegation missing'
        );
    });

    it('source contains #P25 replaced comment', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('#P25') > -1,
            'expected #P25 marker in replaced comment — comment convention not applied'
        );
    });

});


// 06 — source structure: async dispatch guard (Stream A, 0.3.0)
describe('06 - source structure: async dispatch guard', function() {

    it('source captures return value of controller[action]()', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('var _result = controller[action](') > -1,
            'expected `var _result = controller[action](` — async capture not applied'
        );
    });

    it('source checks _result is thenable before attaching catch', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("typeof _result.then === 'function'") > -1,
            "expected `typeof _result.then === 'function'` — thenable guard missing"
        );
    });

    it('source attaches _result.catch to route rejected promises to throwError', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('_result.catch(function(err)') > -1,
            'expected `_result.catch(function(err)` — rejection handler missing'
        );
    });

    it('source passes err.stack || err.message || String(err) to throwError', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('err.stack || err.message || String(err)') > -1,
            'expected `err.stack || err.message || String(err)` — error serialization missing'
        );
    });

    it('async guard is applied at both dispatch sites (with and without middleware)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var first  = src.indexOf('var _result = controller[action](');
        var second = src.indexOf('var _result = controller[action](', first + 1);
        assert.ok(first > -1 && second > -1, 'expected two dispatch sites to capture _result — only one found');
    });

});


// 07 — dispatchAction pure logic
describe('07 - dispatchAction: pure dispatch logic', function() {

    function makeServerInstance() {
        var calls = [];
        return {
            throwError: function(res, status, msg) { calls.push({ status: status, msg: msg }); },
            calls: calls
        };
    }

    it('sync action: no .then check, throwError never called', function() {
        var si = makeServerInstance();
        var ctrl = { home: function() { return undefined; } };
        dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        assert.equal(si.calls.length, 0);
    });

    it('sync action returning null: throwError never called', function() {
        var si = makeServerInstance();
        var ctrl = { home: function() { return null; } };
        dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        assert.equal(si.calls.length, 0);
    });

    it('sync action returning plain object (no .then): throwError never called', function() {
        var si = makeServerInstance();
        var ctrl = { home: function() { return { data: 1 }; } };
        dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        assert.equal(si.calls.length, 0);
    });

    it('async action that resolves: throwError never called', function() {
        var si = makeServerInstance();
        var ctrl = { home: async function() { return 'ok'; } };
        var p = dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        return p.then(function() {
            assert.equal(si.calls.length, 0);
        });
    });

    it('async action that rejects with stack: throwError called with err.stack', function() {
        var si = makeServerInstance();
        var err = new Error('boom');
        var ctrl = { home: async function() { throw err; } };
        var p = dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        return p.then(function() {
            assert.equal(si.calls.length, 1);
            assert.equal(si.calls[0].status, 500);
            assert.equal(si.calls[0].msg, err.stack);
        });
    });

    it('async action rejecting with no stack: throwError called with err.message', function() {
        var si = makeServerInstance();
        var err = { message: 'no stack here' };
        var ctrl = { home: function() { return Promise.reject(err); } };
        var p = dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        return p.then(function() {
            assert.equal(si.calls.length, 1);
            assert.equal(si.calls[0].msg, 'no stack here');
        });
    });

    it('async action rejecting with string (no stack, no message): throwError called with String(err)', function() {
        var si = makeServerInstance();
        var ctrl = { home: function() { return Promise.reject('plain string error'); } };
        var p = dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        return p.then(function() {
            assert.equal(si.calls.length, 1);
            assert.equal(si.calls[0].msg, 'plain string error');
        });
    });

    it('action with .then that is not a function: treated as sync, no attach', function() {
        var si = makeServerInstance();
        var ctrl = { home: function() { return { then: 'not-a-function' }; } };
        dispatchAction(si, ctrl, 'home', {}, {}, function(){});
        assert.equal(si.calls.length, 0);
    });

    it('async action receives req, res, next forwarded from router', function() {
        var si = makeServerInstance();
        var received = {};
        var req = { id: 'req' }, res = { id: 'res' }, next = function(){};
        var ctrl = {
            home: async function(r, s, n) {
                received.req = r; received.res = s; received.next = n;
            }
        };
        var p = dispatchAction(si, ctrl, 'home', req, res, next);
        return p.then(function() {
            assert.strictEqual(received.req, req);
            assert.strictEqual(received.res, res);
            assert.strictEqual(received.next, next);
        });
    });

});


// 08 — source structure: hot-reload dirty-flag guards (#M6)
describe('08 - source structure: hot-reload dirty-flag guards (#M6)', function() {

    it('source contains #M6 marker', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(src.indexOf('#M6') > -1, 'expected #M6 marker — hot-reload not applied');
    });

    it('refreshCoreDependencies reads __hotReload from context', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("getContext('__hotReload')") > -1,
            "expected getContext('__hotReload') in source"
        );
    });

    it('refreshCoreDependencies early-returns when core flag is false', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('if (_hotReload && !_hotReload.core) return;') > -1,
            'expected `if (_hotReload && !_hotReload.core) return;` guard in refreshCoreDependencies'
        );
    });

    it('refreshCoreDependencies clears core flag after eviction', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('_hotReload.core = false;') > -1,
            'expected `_hotReload.core = false;` reset after core eviction'
        );
    });

    it('per-action block guards eviction behind !_hotReload || _hotReload.action', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('if (!_hotReload || _hotReload.action) {') > -1,
            'expected `if (!_hotReload || _hotReload.action) {` guard in per-action block'
        );
    });

    it('per-action block clears action flag after eviction', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('_hotReload.action = false;') > -1,
            'expected `_hotReload.action = false;` reset after action eviction'
        );
    });

    it('getContext(__hotReload) appears at both eviction sites', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var first  = src.indexOf("getContext('__hotReload')");
        var second = src.indexOf("getContext('__hotReload')", first + 1);
        assert.ok(
            first > -1 && second > -1,
            'expected getContext(__hotReload) at two eviction sites — only one found'
        );
    });

});


// Replica of refreshCoreDependencies dirty-flag logic for isolated testing (#M6).
// cache, evicted, and hotReload are injected to avoid framework dependencies.
function refreshCoreLogic(hotReload, cache, evictFn) {
    if (hotReload && !hotReload.core) return false; // skipped
    evictFn(cache);
    if (hotReload) hotReload.core = false;
    return true; // evicted
}

// Replica of per-action cache-bust dirty-flag logic (#M6).
function actionCacheLogic(isCacheless, hotReload, evictFn) {
    if (!isCacheless) return false; // not in dev mode
    if (!hotReload || hotReload.action) {
        evictFn();
        if (hotReload) hotReload.action = false;
        return true; // evicted
    }
    return false; // skipped
}


// 09 — hot-reload dirty-flag pure logic (#M6)
describe('09 - hot-reload dirty-flag logic (#M6)', function() {

    // refreshCoreLogic tests
    it('core: skips eviction when watcher running and core flag is false', function() {
        var hotReload = { core: false, action: false };
        var evicted = false;
        var result = refreshCoreLogic(hotReload, {}, function() { evicted = true; });
        assert.equal(result, false);
        assert.equal(evicted, false);
    });

    it('core: evicts when watcher running and core flag is true', function() {
        var hotReload = { core: true, action: false };
        var evicted = false;
        var result = refreshCoreLogic(hotReload, {}, function() { evicted = true; });
        assert.equal(result, true);
        assert.equal(evicted, true);
    });

    it('core: clears core flag to false after eviction', function() {
        var hotReload = { core: true, action: false };
        refreshCoreLogic(hotReload, {}, function() {});
        assert.equal(hotReload.core, false);
    });

    it('core: falls back to always-evict when __hotReload is null (no watcher)', function() {
        var evicted = false;
        var result = refreshCoreLogic(null, {}, function() { evicted = true; });
        assert.equal(result, true);
        assert.equal(evicted, true);
    });

    it('core: falls back to always-evict when __hotReload is undefined', function() {
        var evicted = false;
        var result = refreshCoreLogic(undefined, {}, function() { evicted = true; });
        assert.equal(result, true);
        assert.equal(evicted, true);
    });

    it('core: does not attempt to clear flag when hotReload is null', function() {
        // must not throw
        assert.doesNotThrow(function() {
            refreshCoreLogic(null, {}, function() {});
        });
    });

    // actionCacheLogic tests
    it('action: skips eviction when isCacheless is false', function() {
        var hotReload = { core: false, action: true };
        var evicted = false;
        var result = actionCacheLogic(false, hotReload, function() { evicted = true; });
        assert.equal(result, false);
        assert.equal(evicted, false);
    });

    it('action: skips eviction when watcher running and action flag is false', function() {
        var hotReload = { core: false, action: false };
        var evicted = false;
        var result = actionCacheLogic(true, hotReload, function() { evicted = true; });
        assert.equal(result, false);
        assert.equal(evicted, false);
    });

    it('action: evicts when watcher running and action flag is true', function() {
        var hotReload = { core: false, action: true };
        var evicted = false;
        var result = actionCacheLogic(true, hotReload, function() { evicted = true; });
        assert.equal(result, true);
        assert.equal(evicted, true);
    });

    it('action: clears action flag to false after eviction', function() {
        var hotReload = { core: false, action: true };
        actionCacheLogic(true, hotReload, function() {});
        assert.equal(hotReload.action, false);
    });

    it('action: falls back to always-evict when __hotReload is null (no watcher)', function() {
        var evicted = false;
        var result = actionCacheLogic(true, null, function() { evicted = true; });
        assert.equal(result, true);
        assert.equal(evicted, true);
    });

    it('action: falls back to always-evict when __hotReload is undefined', function() {
        var evicted = false;
        var result = actionCacheLogic(true, undefined, function() { evicted = true; });
        assert.equal(result, true);
        assert.equal(evicted, true);
    });

    it('action: does not attempt to clear flag when hotReload is null', function() {
        assert.doesNotThrow(function() {
            actionCacheLogic(true, null, function() {});
        });
    });

    it('action: consecutive calls without file change — only first evicts', function() {
        var hotReload = { core: false, action: true };
        var count = 0;
        actionCacheLogic(true, hotReload, function() { count++; });
        actionCacheLogic(true, hotReload, function() { count++; }); // action=false now
        assert.equal(count, 1);
    });

    it('action: watcher marks dirty → evicts → watcher marks dirty again → evicts again', function() {
        var hotReload = { core: false, action: true };
        var count = 0;
        actionCacheLogic(true, hotReload, function() { count++; }); // evicts, action→false
        hotReload.action = true; // simulate file change
        actionCacheLogic(true, hotReload, function() { count++; }); // evicts again
        assert.equal(count, 2);
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 10 — #B18 router.js require.cache antipattern eviction
// ─────────────────────────────────────────────────────────────────────────
//
// Per llms.txt #175 (formerly #104): `require.cache[path] = require(path)` is an antipattern
// because Node reads `.exports` off each `require.cache` entry on every
// subsequent `require()`; assigning the bare exports object into the slot
// (no `.exports` key) makes the next plain `require()` return `undefined`.
//
// router.js had two latent occurrences after the `refreshCore()` fix
// (server.isaac.js commit `add6655e`):
//   - refreshCoreDependencies() at ~L116-127 (Super controller hot-reload)
//   - controller-require path at ~L617-627 (per-route Super controller lookup)
//
// The fix at both sites: drop the cache-slot poisoning line and use the
// return value of `require()` directly. The preceding `delete require.cache[
// require.resolve(path)]` already evicts the slot, so the next `require()`
// builds a fresh Module instance correctly.

describe('10 - #B18 router.js require.cache antipattern eviction', function() {

    var SOURCE = path.join(require('../fw'), 'core/router.js');
    var src    = fs.readFileSync(SOURCE, 'utf8');

    // ── (a) source structure — the antipattern is GONE ───────────────────────

    it('no `require.cache[<path>] = require(<path>)` poisoning anywhere in router.js', function() {
        // Specifically the controller/index.js slot — the only path the old
        // antipattern reused. Tolerate other unrelated `require.cache[…] = …`
        // sites if they ever appear (none today), but enforce no occurrence
        // of the exact poisoning shape on controller/index.js.
        var poisonRe = /require\.cache\[\s*_\([^)]*controller\/index\.js[^)]*\)\s*\]\s*=\s*require\s*\(/;
        assert.ok(
            !poisonRe.test(src),
            'router.js must not reassign require.cache[controller/index.js] with require() (#B18 antipattern)'
        );
    });

    it('no `require.cache[<path>] = require(<path>)` poisoning on controller/controller.js either', function() {
        var poisonRe = /require\.cache\[\s*_\([^)]*controller\/controller\.js[^)]*\)\s*\]\s*=\s*require\s*\(/;
        assert.ok(
            !poisonRe.test(src),
            'router.js must not reassign require.cache[controller/controller.js] with require()'
        );
    });

    it('SuperController is read from the return value of require(), not from require.cache[]', function() {
        // Two assignment sites — both should use `require(<path>)` directly,
        // not `require.cache[<path>]`.
        var assignRe = /SuperController\s*=\s*require\.cache\[/g;
        var matches  = src.match(assignRe) || [];
        assert.equal(
            matches.length, 0,
            'no `SuperController = require.cache[...]` reads — read from `require(...)` directly'
        );
    });

    it('refreshCoreDependencies() preserves the delete-before-require shape', function() {
        // The function still evicts both slots; only the re-binding shape changed.
        // Anchor: the function body starts with the two-line eviction block.
        var refreshFnIdx = src.indexOf('refreshCoreDependencies');
        assert.ok(refreshFnIdx > -1, 'refreshCoreDependencies function not found');
        var afterFn = src.slice(refreshFnIdx, refreshFnIdx + 1500);
        assert.ok(
            afterFn.indexOf("delete require.cache[require.resolve(_(corePath +'/controller/controller.js'") > -1,
            'must still delete the controller.js cache entry'
        );
        assert.ok(
            afterFn.indexOf("delete require.cache[require.resolve(_(corePath +'/controller/index.js'") > -1,
            'must still delete the controller/index.js cache entry'
        );
        assert.ok(
            afterFn.indexOf('SuperController = require(_(corePath') > -1,
            'must read SuperController from require(...), not from require.cache[...]'
        );
    });

    it('controller-require path (~L617) preserves the delete-before-require shape', function() {
        // The per-route Super controller lookup. Anchor: the comment marker
        // `//if (isCacheless) {` is unique to this block.
        var blockIdx = src.indexOf('//if (isCacheless) {');
        assert.ok(blockIdx > -1, 'controller-require path anchor not found');
        var afterBlock = src.slice(blockIdx, blockIdx + 800);
        assert.ok(
            afterBlock.indexOf("delete require.cache[require.resolve(_(corePath +'/controller/index.js'") > -1,
            'must still delete the controller/index.js cache entry'
        );
        assert.ok(
            afterBlock.indexOf('delete require.cache[require.resolve(filename)]') > -1,
            'must still delete the user controller filename cache entry'
        );
        assert.ok(
            afterBlock.indexOf('var SuperController     = require(_(corePath') > -1,
            'must read SuperController from require(...), not from require.cache[...]'
        );
    });

    it('source mentions #B18 at the fix sites for traceability', function() {
        assert.ok(src.indexOf('#B18') > -1, 'expected #B18 trace marker at the fix sites');
    });

    // ── (b) pure logic — why the antipattern is wrong ────────────────────────

    it('replica: require.cache[path] = require(path) poisons subsequent require()', function() {
        // Simulate Node's require.cache lookup semantics.
        //   - A real Module instance has `.exports`
        //   - `require.cache[path] = require(path)` stores the exports object directly
        //   - Next require() reads `.exports` off the cache entry → undefined
        var fakeCache = {};
        var modulePath = '/fake/path/to/index.js';

        // The poisoning pattern:
        function poisonedRequire(path) {
            var fresh = { greet: function() { return 'hello'; } }; // simulates module exports
            fakeCache[path] = fresh; // POISON: assigns exports, not Module
            return fakeCache[path];
        }
        function nextPlainRequire(path) {
            // Node's plain require reads `.exports` off the cache entry.
            return fakeCache[path] ? fakeCache[path].exports : undefined;
        }
        var first = poisonedRequire(modulePath);
        assert.ok(first.greet, 'first poisoned require returns the exports object directly');
        assert.equal(nextPlainRequire(modulePath), undefined,
            'plain require on the poisoned slot returns undefined (the bug)');
    });

    it('replica: delete + plain require() yields a usable Module reference', function() {
        // The correct shape:
        //   - delete require.cache[path]
        //   - var fresh = require(path)
        //   - use `fresh` directly
        var fakeCache = {};
        var modulePath = '/fake/path/to/index.js';

        function plainRequire(path) {
            if (!fakeCache[path]) {
                // simulates Node: creates a Module wrapper holding exports
                fakeCache[path] = {
                    exports: { greet: function() { return 'hello'; } }
                };
            }
            return fakeCache[path].exports;
        }
        function deleteAndRequire(path) {
            delete fakeCache[path];
            return plainRequire(path); // returns exports off a properly-built Module
        }
        var fresh = deleteAndRequire(modulePath);
        assert.ok(fresh.greet, 'fresh exports object is usable');
        assert.equal(fresh.greet(), 'hello', 'fresh exports object behaves correctly');
        // And subsequent plainRequire() still works because the slot now holds a Module wrapper.
        var second = plainRequire(modulePath);
        assert.equal(second.greet(), 'hello', 'subsequent plain require still works');
    });

});
