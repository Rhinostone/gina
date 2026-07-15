/**
 * validator-query-backend — the server-side validator `query` rule must not re-point
 * the process-wide cache onto a second Map (#B115).
 *
 * First-ever coverage of `queryFromBackend` (core/plugins/lib/validator/src/form-validator.js).
 * A route-level `validator::{ query: {...} }` requirement hand-builds a Controller and runs
 * a real inter-bundle query. `lib/cache` keeps ONE module-scope backing Map shared by every
 * Cache/RenderCache instance, re-pointed by `from()`; `controller.query()` calls
 * `cache.from(self.serverInstance._cached)` for HTTP/2 session pooling. queryFromBackend
 * historically handed the controller `conf.content.server` — a plain CONFIG DICT — and
 * minted a second `_cached` Map on it, so the one process-wide pointer was left on the
 * WRONG Map after every validator query: a concurrent render's cache ops (compiled
 * templates, output cache) then miss/land on the wrong store, and the HTTP/2 session +
 * its `_http2Sessions` tracker accumulate where nothing reads them.
 *
 * The fix publishes the live engine (`process.gina._serverInstance`, stashed by
 * server.js `start()`) and has queryFromBackend hand the controller THAT instance,
 * keeping the config dict (+ its minted Map) only as the fallback when no server runs
 * in the process (offline CLI / harnesses).
 *
 * Shape (behavioral by mandate — see the #B111–#B115 batch note in the internal ledger):
 *   §01 drives the REAL rule end-to-end — a real FormValidatorUtil field's `.query()`
 *       (the router's exact call shape) through the real Controller.query() against a
 *       local h2c stub — and asserts the runtime effect: the render actor's entry is
 *       still readable WITHOUT re-adopting (the war probe), and the pooled session +
 *       tracker land on the ENGINE.
 *   §02 drives the FALLBACK (no engine published): the query must still succeed against
 *       the config dict — and the war probe must FIRE (entry unreadable). That keeps a
 *       permanent, can-fail control in the file: the instrument provably detects the
 *       defect this test exists for.
 *   §03 drift pins on the two fix sites (structural invariants only — the behaviour is
 *       §01/§02's job).
 *
 * Sequencing notes:
 *   - No timers, no races. The defect is observable SEQUENTIALLY — adopt engine Map →
 *     seed → await the validator query → read without re-adopting. (Production harm
 *     needs concurrency; the mispointed module var does not.)
 *   - Each test gets its OWN h2c stub (own port): the pooled session's cache key is
 *     `http2session:<authority>`, and a destroyed client's async 'close' handler deletes
 *     that key from whatever Map is CURRENT when it fires — a shared port would let one
 *     test's teardown handler evict the next test's freshly pooled session.
 *
 * Seeding map (what the real chain reads, measured crash-point by crash-point):
 *   - GINA_FRAMEWORK_DIR: bare global (form-validator :792/:926) AND process.gina
 *     (config.js reads it via getEnvVar at :389/:495)
 *   - Config singleton: `new Config().getInstance()` no-arg returns
 *     `Config.instance.envConf` (config.js:325-327) — so envConf carries `.env`/`.bundle`
 *     and the per-bundle slice; Env/Scope/Host are no-op stubs
 *   - the GLOBAL getConfig(bundle, 'app'|'settings'): the committed R2 mock seam
 *     (helpers/context.js — setContext('__mock__', { config: fn }))
 *   - lib/routing getRoute: getContext('gina').config.getRouting()
 *
 * NO ttl on seeded entries — lib/cache.set({ttl}) arms a real setTimeout per entry and a
 * stranded handle keeps the event loop (and this file) alive; expiry is not under test.
 */
var { describe, it, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var http2  = require('http2');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);

process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, '../../utils/prototypes')); // Object.prototype.count() + JSON.clone
require(path.join(FW, 'helpers'));
/* global setPath, setContext, getContext */
setPath('gina', { core: path.join(FW, 'core') });

global.GINA_FRAMEWORK_DIR = FW;
if (!process.gina) { process.gina = {}; }
process.gina.GINA_FRAMEWORK_DIR = FW;

var RenderCache       = require(path.join(FW, 'lib/render-cache/src/main'));
var FormValidatorUtil = require(path.join(FW, 'core/plugins/lib/validator/src/form-validator.js'));
var Config            = require(path.join(FW, 'core/config.js'));

var SERVER_SRC = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var FV_SRC     = fs.readFileSync(path.join(FW, 'core/plugins/lib/validator/src/form-validator.js'), 'utf8');

var BUNDLE = 'wartest', ENV = 'dev', RULEFULL = 'check-user@wartest';

describe('validator-query-backend — the server-side `query` rule vs the process-wide cache (#B115)', function () {

    // Fresh world per test: own h2c stub (own port → own session key), own config graph.
    // serverDict is the config dict under test; nothing persists across tests.
    async function buildWorld() {
        var server = http2.createServer();
        server.on('stream', function (stream) {
            stream.respond({ ':status': 200, 'content-type': 'application/json' });
            stream.end(JSON.stringify({ status: 200, isValid: true }));
        });
        await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
        var PORT = server.address().port;

        var serverDict = { // conf.content.server
            cache: { path: '/tmp/b115-unused', enable: false },
            coreConfiguration: { mime: { json: 'application/json' }, statusCodes: { 200: 'OK' } }
        };
        var conf = {
            content: {
                server: serverDict,
                routing: (function () { var r = {}; r[RULEFULL] = { param: {} }; return r; })()
                // no `templates` key → routeHasViews=false
            },
            server: {
                scheme: 'http', protocol: 'http/2.0',
                resolvers: [], credentials: {},
                coreConfiguration: { mime: { json: 'application/json' }, statusCodes: { 200: 'OK' } }
            },
            host: '127.0.0.1:' + PORT,
            port: (function () { var p = {}; p['http/2.0'] = { http: PORT }; return p; })(),
            isCacheless: false
        };
        var routingDict = {};
        routingDict[RULEFULL] = {
            method: 'GET', url: '/check-user', requirements: {},
            param: { control: 'checkUser' }, middleware: [], bundle: BUNDLE
        };
        var envConf = {}; envConf[BUNDLE] = {}; envConf[BUNDLE][ENV] = conf;
        // getInstance() no-arg returns Config.instance.envConf; queryFromBackend reads
        // .env / .bundle off that return
        envConf.env = ENV; envConf.bundle = BUNDLE;

        var fakeConfig = {
            env: ENV, scope: 'local', bundle: BUNDLE,
            envConf: envConf,
            bundlesConfiguration: { conf: envConf },
            Env:   { set: function () {}, parent: null },
            Scope: { set: function () {}, parent: null },
            Host:  { setMaster: function () {}, parent: null },
            getRouting: function () { return routingDict; },
            isCacheless: function () { return false; }
        };
        fakeConfig[BUNDLE] = envConf[BUNDLE];
        fakeConfig.getInstance = function () { return fakeConfig; };

        setContext('bundle', BUNDLE);
        setContext('env', ENV);
        setContext('gina', { config: fakeConfig, forms: null });
        setContext('__mock__', { config: function (b, confName) {
            if (confName === 'app')      { return { proxy: {} }; }
            if (confName === 'settings') { return { server: { credentials: {} } }; }
            return {};
        } });
        Config.initialized = true;
        Config.instance    = fakeConfig;

        var world = {
            server: server,
            sessKey: 'http2session:http://127.0.0.1:' + PORT,
            serverDict: serverDict,
            conf: conf,
            maps: []
        };
        worlds.push(world);
        return world;
    }

    // Drive the REAL queryFromBackend exactly as the router does:
    // `_validator[key]['query'](_ruleObj.query, request, response, next)`
    async function driveValidatorQuery() {
        var v = new FormValidatorUtil({ username: 'joe' });
        var reqMock = { headers: {}, isXMLRequest: false, isWithCredentials: false };
        var resMock = {
            setHeader: function () {}, getHeader: function () {}, getHeaders: function () { return {}; },
            end: function () {}, writeHead: function () {}, headersSent: false, statusCode: 200
        };
        return v['username'].query(
            { url: RULEFULL, method: 'GET', data: {} },
            reqMock, resMock, function next() {}
        );
    }

    // Teardown: destroy any pooled HTTP/2 client, drain every touched Map, close the stub.
    var worlds = [];
    afterEach(async function () {
        for (var w; (w = worlds.pop()); ) {
            w.maps.push(w.serverDict._cached);
            w.maps.forEach(function (m) {
                if (!m) { return; }
                try {
                    var entry = m.get(w.sessKey);
                    if (entry && entry.value && entry.value.destroy && !entry.value.destroyed) {
                        entry.value.destroy();
                    }
                } catch (e) {}
                try { new RenderCache().from(m).clear(); } catch (e) {}
            });
            await new Promise(function (r) { w.server.close(r); });
        }
        delete process.gina._serverInstance;
    });

    it('01 — with the engine published, a validator query leaves the process-wide cache on the ENGINE Map (war fixed)', async function () {
        var world  = await buildWorld();
        var engine = { _cached: new Map(), _cacheIsEnabled: false, _http2Sessions: [] };
        world.maps.push(engine._cached);

        // Render actor: adopt the engine Map and seed an output-cache entry (NO ttl).
        var rc  = new RenderCache();
        rc.from(engine._cached);
        var KEY = rc.buildKey('static', BUNDLE, '/page');
        rc.set('memory', KEY, {}, { content: 'RENDERED' });

        // What server.js start() publishes at boot.
        process.gina._serverInstance = engine;

        var result = await driveValidatorQuery();

        // The query itself completed against the stub.
        assert.equal(result && result.status, 200, 'the validator query must succeed');

        // THE WAR PROBE — read through the actor that adopted the engine Map BEFORE the
        // query, WITHOUT re-adopting. Pre-fix this misses: query() left the process-wide
        // pointer on the config dict's minted Map.
        assert.equal(rc.has(KEY), true,
            'the render actor must still read its entry — the process-wide cache must be left on the ENGINE Map');

        // Survival probe (re-adopt): the entry itself was never destroyed either way.
        var fresh = new RenderCache(); fresh.from(engine._cached);
        assert.equal(fresh.has(KEY), true, 'the seeded entry must survive on the engine Map');

        // The pooled HTTP/2 session + its tracker must land on the ENGINE, not the dict.
        assert.equal(engine._cached.has(world.sessKey), true, 'the pooled session must live in the engine Map');
        assert.equal(engine._http2Sessions.indexOf(world.sessKey) > -1, true, 'the tracker entry must live on the engine');
        assert.equal(typeof world.serverDict._http2Sessions, 'undefined', 'no tracker may be minted on the config dict');
        if (typeof world.serverDict._cached !== 'undefined') {
            assert.equal(world.serverDict._cached.size, 0, 'the config-dict fallback Map must stay empty');
        }
    });

    it('02 — with NO engine published, the fallback still works AND the war probe fires (the permanent can-fail control)', async function () {
        var world  = await buildWorld();
        var engine = { _cached: new Map(), _cacheIsEnabled: false, _http2Sessions: [] };
        world.maps.push(engine._cached);

        var rc  = new RenderCache();
        rc.from(engine._cached);
        var KEY = rc.buildKey('static', BUNDLE, '/page2');
        rc.set('memory', KEY, {}, { content: 'RENDERED-2' });

        delete process.gina._serverInstance; // offline CLI / harness: nothing published

        var result = await driveValidatorQuery();

        // The fallback keeps the rule functional…
        assert.equal(result && result.status, 200, 'the fallback query must still succeed');
        assert.equal(world.serverDict._cached instanceof Map, true, 'the config dict must mint its fallback Map');
        assert.equal(world.serverDict._cached.has(world.sessKey), true, 'the pooled session lands on the dict in fallback mode');

        // …and the war probe FIRES on the fallback path: the process-wide pointer is on
        // the dict Map, so the engine-adopted actor misses. This is the pre-fix behaviour
        // kept observable forever — proof this file's instrument can detect the defect.
        assert.equal(rc.has(KEY), false,
            'control: without the published engine, the re-point war must still be observable');

        // The entry itself is alive (mispointed, not destroyed).
        var fresh = new RenderCache(); fresh.from(engine._cached);
        assert.equal(fresh.has(KEY), true, 'the seeded entry itself survives on the engine Map');
    });

    it('03 — drift pins: the stash in server.js start() and the engine preference at the assignment site', function () {
        // server.js: the stash exists inside start(), before router.setServerInstance().
        var startIdx = SERVER_SRC.indexOf('this.start = function(instance)');
        assert.ok(startIdx > -1, 'server.js start() must exist');
        var stashIdx = SERVER_SRC.indexOf('process.gina._serverInstance = instance', startIdx);
        var routerIdx = SERVER_SRC.indexOf('router.setServerInstance(instance)', startIdx);
        assert.ok(stashIdx > -1, 'start() must publish the engine on process.gina._serverInstance');
        assert.ok(routerIdx > -1, 'start() must still hand the engine to the router');
        assert.ok(stashIdx < routerIdx, 'the stash must sit with the engine stamping, before setServerInstance');

        // form-validator: the controller assignment prefers the published engine.
        assert.match(FV_SRC, /controller\.serverInstance\s*=\s*\(\s*process\.gina\s*&&\s*process\.gina\._serverInstance\s*\)/,
            'queryFromBackend must prefer the published engine instance');
        assert.equal(FV_SRC.indexOf('controller.serverInstance = serverInstance;'), -1,
            'the bare config-dict assignment must be gone');
    });
});
