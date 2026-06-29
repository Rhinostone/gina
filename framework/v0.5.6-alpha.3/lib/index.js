/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module lib
 * @description Central registry that loads and exposes every framework library.
 * Assigned to the global `lib` variable on first require so all framework code
 * can access `lib.merge`, `lib.Collection`, etc. without an explicit `require`.
 *
 * @package    gina.framework
 * @namespace  lib
 * @author     Rhinostone <contact@gina.io>
 */

//var merge = require('./merge');

/**
 * Library registry constructor — returns a plain object `self`, not `this`.
 * Consumed via `lib = new Lib()` in `gna.js`.
 *
 * @class Lib
 * @constructor
 */
function Lib() {


    var _require = function(path) {

        var cacheless = (process.env.NODE_ENV_IS_DEV == 'false') ? false : true;
        if (cacheless) {
            delete require.cache[require.resolve(path)];
            return require(path)
        } else {
            return require(path)
        }
    }



    var self = {
        Config          : _require('./config'),
        //dev     : require('./lib/dev'),//must be at the same level than gina.lib => gina.dev
        inherits        : _require('./inherits'),
        helpers         : _require('./../helpers'),
        //this one must move to Dev since it's dev related
        Domain          : _require('./domain'),
        Model           : _require('./model'),
        // #B32-residual (measured 2026-06-16) — plain require, NOT _require.
        // Collection/merge/uuid are stateless leaf utilities new'd per request from
        // gen-0 bindings captured in load-once modules (server.isaac.js:34
        // `const Collection = lib.Collection`, used per request at :853 in onPath).
        // With _require they are evicted from require.cache every refreshCore(), so each
        // per-request `new Collection()` is a cache-miss that pushes a fresh merge/uuid
        // child Module onto the gen-0 (evicted-but-retained) collection Module — which
        // pruneDeadModuleChildren() never reaches (it walks require.cache keys only),
        // accumulating ~2 dead Modules/request (dev-mode OOM). Plain require = never
        // evicted = cache-hit = Node dedupes the children = flat. Verified standalone:
        // gen-0 collection .children 0->1000 over 500 reqs with _require, pinned at 2
        // with require. Same precedent as logger/job/State/instrument below.
        Collection      : require('./collection'),
        merge           : require('./merge'),
        generator       : _require('./generator'),//move to gina.dev
        Proc            : _require('./proc'),
        Shell           : _require('./shell'),
        // replaced: _require('./logger') — Logger is a singleton persisted via getContext('loggerInstance').
        // refreshCore() (server.isaac.js) re-runs Lib() on every dev-mode HTTP request by deleting and
        // re-requiring lib/index.js. _require would then delete logger from require.cache and re-require it,
        // calling Logger() again → "Logger instance already exists: reusing it ;)" once per request (#4).
        // Logger hot-reload is unnecessary: the singleton state survives through getContext regardless of
        // module eviction, and Logger() returns the existing instance anyway. Use plain require (cache hit).
        logger          : require('./logger'),
        math            : _require('./math'),
        routing         : _require('./routing'),
        // #B32-residual — plain require: archiver is a `new Archiver()` EventEmitter
        // SINGLETON (archiver/src/main.js:510). _require re-instantiated it every
        // refreshCore() (per-request churn) and left each prior instance pinned via the
        // gen-0 lib registry — it was the named instance in the leak's heap snapshot.
        // A singleton must not hot-reload (same reason as logger/job/State/instrument).
        archiver        : require('./archiver'),
        cmd             : _require('./cmd'),
        SessionStore    : _require('./session-store'),
        SwigFilters     : _require('./swig-filters'),
        Cache           : require('./cache'),    // #B32-residual — plain require (leaf class held at gen-0 via server.isaac.js:35; Cache._events is a Collection). See Collection note above.
        uuid            : require('./uuid'),      // #B32-residual — plain require (pushed as a child of the gen-0 collection module per `new Collection()`). See Collection note above.
        // #R1 — WatcherService: fs.watch-based file-change registry. Class is hot-reloadable;
        // instantiated once per bundle in gna.js:onStarted and stored as gna.watcher.
        Watcher         : _require('./watcher'),
        // #M4 — Promise adapter for .onComplete() EventEmitter callbacks.
        // Enables async/await in controller actions without rewriting entities.
        async           : _require('./async'),
        // #I18N1 — Internationalisation primitives. Per-bundle JSON catalogs,
        // fallback chain (specific → base → settings.region.culture →
        // GINA_CULTURE → 'en'), CLDR plural via Intl.PluralRules,
        // {name}-style interpolation. Backs gna.t(), self.t(), and the
        // swig/nunjucks `t` filter (slice 2). Catalogs land at
        // process.gina._i18nCatalogs[bundleName][culture].
        i18n            : _require('./i18n'),
        // #OBS1 — Prometheus metrics primitive. Wraps prom-client (peer dep,
        // loaded from project node_modules — same shape as mysql/postgres/AI
        // SDK connectors). Backs the /_gina/metrics endpoint and the request
        // lifecycle hook that populates the HTTP counter + histogram. Opt-in
        // via app.json `metrics.enabled`.
        metrics         : _require('./metrics'),
        // #S7 — admin /_gina/* IP-allowlist gate (isClientAllowed). Functional
        // sibling of metrics above, but a PLAIN require (NOT _require): a
        // stateless pure-function leaf with no instance/singleton state to
        // hot-reload — same #B32-residual precedent as merge / uuid / Collection.
        admin           : require('./admin'),
        // #AI6 — Async-job primitive. Holds an in-memory job registry, a
        // concurrency-limited worker, and a self-contained unref'd setInterval
        // sweep timer at module scope. Like State / logger below, it MUST use a
        // plain require (not _require): refreshCore() re-runs Lib() on every
        // dev-mode HTTP request, and _require would delete + re-require the
        // module, discarding the live registry and orphaning the sweep timer on
        // each request. Plain require = cache hit = the singleton survives.
        job             : require('./job'),
        // #INS10 — toggleable instrumentation window primitive. Owns the
        // time-boxed Inspector capture window (process.gina._inspectorWindowUntil)
        // and its unref'd expiry timer. PLAIN require (like job / State / logger):
        // refreshCore() re-runs Lib() on every dev-mode HTTP request, and _require
        // would delete + re-require the module, discarding the live window deadline
        // and orphaning the expiry timer. Plain require = cache hit = the singleton
        // and its timer survive.
        instrument      : require('./instrument'),
        // replaced: _require('./state') — StateStore is a singleton backed by node:sqlite
        // (DatabaseSync). Hot-reloading it in dev mode would close and re-open the DB
        // connection on every HTTP request, racing with in-flight writes. Use plain
        // require() so the singleton survives refreshCore() evictions. (#CN2v3)
        State           : require('./state'),
        // Shared semantic extractor for routing.json. Consumed by bundle:openapi
        // and bundle:mcp to parse URL patterns, methods, requirements, and derive
        // stable tool / operation identifiers.
        routingIntrospect: _require('./routing-introspect'),
        // #EVTBUS — observable application-event emit hook (self.emitEvent /
        // lib.inspectorEvents.emit). Stateless (no module-scope state beyond a
        // best-effort counter), so the dev-mode-hot-reloadable _require is safe.
        inspectorEvents : _require('./inspector-events'),
        // Shared run-state / port display primitives (pad, pickPreferredPort,
        // readPidfile) for the bundle:list / service:list / bundle:status /
        // project:status CLI handlers. Pure (same contract as routing-introspect).
        cmdStatusFormat : _require('./cmd-status-format'),
        // Single source of truth for the connector driver → npm package + semver
        // range mapping. Consumed by the connector:* CLI handlers (connector:add
        // install hint + connector:add --install range resolution + connector:list
        // driver introspection).
        connectorRegistry: _require('./connector-registry'),
        // Pure resolver that picks between a project-installed @rhinostone/swig
        // (or swig-twig) and the framework's bundled copy. Opt-in via
        // settings.json > swig.useProject; default-off. Returns a decision
        // record — the caller performs the actual require.
        swigResolver    : _require('./swig-resolver'),
        // Detects project-installed `nunjucks` and caches on process.gina._nunjucks.
        // Opt-in via settings.json > render.engine === 'nunjucks'. No framework
        // fallback — load() throws NUNJUCKS_NOT_INSTALLED when the project has
        // not installed the package.
        nunjucksResolver: _require('./nunjucks-resolver'),
        // Per-request filter registry for the nunjucks render path. Mirror of
        // lib/swig-filters: same factory shape, same 7 public filters
        // (getUrl, getWebroot, length, nl2br, addHours, addDays, addYears).
        // Registered via env.addFilter() in render-nunjucks.js per request.
        nunjucksFilters: _require('./nunjucks-filters'),
        // #TPL1 — Async template-loader extension point. Builds a built-in
        // loader (memory; http in a later slice) from its flat
        // settings.template.<engine>.loader config and wraps it with a
        // CVE-2023-25345 segment-guard. Consumed by initSwigEngine (startup
        // build + validation) and controller.render-swig-async.js. Pure factory
        // (no singleton state), so _require (hot-reloadable) is safe.
        templateLoaders : _require('./template-loaders'),
        // #AI8b — MCP server primitives (JSON-RPC 2.0 framing, lifecycle,
        // method handlers). Transport-agnostic; wired to stdio by bundle:mcp-start.
        mcpServer       : _require('./mcp-server'),
        // #AI8b — HTTP loopback dispatcher. Translates MCP tools/call into a
        // real request against the running bundle's configured port.
        mcpDispatch     : _require('./mcp-dispatch'),
        // #AI8 Phase 2b — MCP Streamable HTTP transport. Wraps an mcpServer
        // instance with an HTTP endpoint (POST, JSON/SSE negotiation, batch,
        // Mcp-Session-Id lifecycle). Auth / Origin checks land in Phase 2b S2.
        mcpHttp         : _require('./mcp-http'),
        // ${secret:KEY} placeholder resolver for bundle JSON configs. Walks
        // the merged config object in place at config-load time (per-bundle,
        // inside loadBundleConfig). Default backend reads process.env[KEY];
        // fail-closed on unset/empty values. See lib/secrets/src/main.js.
        secrets         : _require('./secrets'),
        // #H13 — RFC 6455 WebSocket framing codec (frame encoder + incremental
        // parser: fragmentation reassembly, masking enforcement, UTF-8 and
        // close-code validation, maxPayload/maxFragments caps). Transport-
        // agnostic; the WebSocket-over-HTTP/2 session bridge feeds it
        // extended-CONNECT stream bytes. Pure factory (per-connection parser
        // instances, no module-scope state), so _require (hot-reloadable) is safe.
        wsFraming       : _require('./ws-framing'),
        // #H13 — WebSocket-over-HTTP/2 session bridge. accept(request) answers
        // the extended CONNECT with :status 200 and wraps the raw Http2Stream
        // + a ws-framing parser into a send/ping/close session (auto-pong,
        // timed close handshake, teardown on stream close/error, graceful-
        // shutdown drain registration). Consumed by the Isaac engine's
        // onWebSocket dispatcher. Pure factory, so _require is safe.
        wsSession       : _require('./ws-session'),
        // #H13 slice 3b — cross-bundle session.query() for WS channel handlers.
        // build(app, bundle, env) → query(options[, data]) → Promise: reuses the
        // framework controller's hardened HTTP/1+HTTP/2 client (fresh controller
        // per call) against the live server's warm session cache, mirroring a
        // controller's self.query(). The Isaac dispatcher attaches it to each
        // accepted session AFTER lib.wsSession.accept (so ws-session stays
        // controller-free). Pure factory (no module-scope state), so _require is safe.
        wsQuery         : _require('./ws-query'),
    };

    /**
     * Strip macOS dot-files (`.DS_Store`, `._*`, etc.) from a directory listing.
     *
     * @memberof module:lib
     * @param {string[]} files - Array of filenames from `fs.readdirSync`
     * @returns {string[]} Filtered array
     *
     * @deprecated Use once in `server.js`; TODO — remove entirely
     */
    self.cleanFiles = function(files){
        for(var f=0; f< files.length; f++){
            if(files[f].substring(0,1) == '.')
                files.splice(0,1);
        }
        return files;
    };



    return self
}
// Making it global
lib = new Lib();

/**
 * Bootstrap the command dispatcher when running inside the daemon process.
 * Sets Gina paths, seeds CLI options from the package manifest, and calls
 * `lib.cmd.onExec()` to start processing commands.
 *
 * @memberof module:lib
 * @param {object}  opt                    - Bootstrap options
 * @param {Array}   opt.argv               - `process.argv`-style argument array
 * @param {string}  opt.ginaPath           - Absolute path to gina root
 * @param {string}  opt.frameworkPath      - Absolute path to the framework version dir
 * @param {object}  opt.pack               - Package manifest (`version`, `copyright`)
 * @param {string}  opt.task               - CLI task name
 * @param {string}  opt.homedir            - User home directory
 * @param {object}  opt.client             - Socket client reference
 * @param {boolean} [opt.isFromFramework]  - `true` when invoked from framework internals
 * @returns {void}
 */
lib.cmd.load = function(opt){

    process.argv = opt.argv;

    //Set gina paths.
    setPath('gina.root', _(opt.ginaPath));
    setPath('framework', _(opt.frameworkPath));
    setPath('gina.core', _(opt.frameworkPath +'/core'));
    setPath('gina.home', opt.homedir);
    setPath('gina.lib', _(opt.frameworkPath +'/lib'));
    setPath('gina.helpers', _(opt.frameworkPath +'/helpers'));

    //Getting package.
    var p = opt.pack;

    //Setting default options.
    lib.cmd.setOption([
        {
            'name' : 'version',
            'content' : p.version
        },
        {
            'name' : 'copyright',
            'content' : p.copyright
        },
        {
            'name' : 'task',
            'content' : opt.task
        },
        {
            'name' : 'homedir',
            'content' : opt.homedir
        }
    ]);

    var isFromFramework = ( typeof(opt.isFromFramework) != 'undefined') ? true : false;
    lib.cmd.onExec(opt.client, isFromFramework, opt)
};

module.exports = lib