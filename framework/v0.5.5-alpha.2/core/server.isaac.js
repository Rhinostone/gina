"use strict";
/**
 * @module gina/core/server.isaac
 */
const fs                    = require('fs');
const crypto                = require('crypto');
const { execSync, exec }    = require('child_process');
const {EventEmitter}        = require('events');
// #B10 fix: engine.io is only needed when options.ioServer is configured (WebSocket support).
// Require it lazily so bundles without WebSocket support don't crash if engine.io is absent.
// const Eio = require('engine.io');
let Eio = null;
// const zlib                  = require('zlib'); // gzip / deflate

// Lightweight debug logger — gated on LOG_LEVEL so zero cost in production.
// Format mirrors lib/logger template: [date] [debug  ][gina:isaac] message
var _isDebugLog = function() {
    return process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';
};
var _debugLog = function(msg) {
    if (!_isDebugLog()) return;
    var _m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var p2 = function(n) { return (n < 10 ? '0' : '') + n; };
    var d = new Date();
    var ts = d.getFullYear() + ' ' + _m[d.getMonth()] + ' ' + p2(d.getDate())
        + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    process.stderr.write('\u001b[90m[' + ts + '] [debug  ][gina:isaac] ' + msg + '\u001b[39m\n');
};

const lib               = require('./../lib');
const inherits          = lib.inherits;
const merge             = lib.merge;
const console           = lib.logger;
const Collection        = lib.Collection;
const cache             = new lib.Cache();


const env               = process.env.NODE_ENV
    , isDev             = process.env.NODE_ENV_IS_DEV && process.env.NODE_ENV_IS_DEV.toLowerCase() === 'true'
    , scope             = process.env.NODE_SCOPE
    , isLocalScope      = process.env.NODE_SCOPE_IS_LOCAL && process.env.NODE_SCOPE_IS_LOCAL.toLowerCase() === 'true'
    , isProductionScope = process.env.NODE_SCOPE_IS_PRODUCTION && process.env.NODE_SCOPE_IS_PRODUCTION.toLowerCase() === 'true'
;

/**
 * Constant-time API-key check for the /_gina/agent SSE endpoint when it is
 * exposed outside dev mode (#INS9b). The configured key lives on
 * `process.gina._inspectorAgentKey` (set by gna.js from settings.json
 * `inspector.agent.key`). The request presents the key via the
 * `x-gina-inspector-key` header or a `?key=` query param — browsers using
 * EventSource cannot set request headers, so the query param is the browser
 * path; programmatic callers should prefer the header.
 *
 * Fail-closed: when no key is configured this returns false, so the endpoint
 * stays closed even if `inspector.agent.enabled` is true. Uses
 * `crypto.timingSafeEqual` with a length guard so a length mismatch can't
 * throw and the compare does not early-exit on the first differing byte.
 *
 * @inner
 * @param {http.IncomingMessage|http2.Http2ServerRequest} req
 * @returns {boolean} true when the presented key matches the configured key
 */
function _agentKeyValid(req) {
    var configured = (typeof process.gina === 'object' && process.gina && typeof process.gina._inspectorAgentKey === 'string')
        ? process.gina._inspectorAgentKey
        : '';
    if (!configured) return false;
    var presented = (req.headers && req.headers['x-gina-inspector-key']) || '';
    if (!presented && typeof req.url === 'string') {
        var _qi = req.url.indexOf('?');
        if (_qi >= 0) {
            try {
                presented = new URLSearchParams(req.url.slice(_qi + 1)).get('key') || '';
            } catch (e) { presented = ''; }
        }
    }
    if (!presented) return false;
    var a = Buffer.from(String(presented));
    var b = Buffer.from(configured);
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

/**
 * Validate the inspector instrumentation control key (#INS10). Mirrors
 * {@link _agentKeyValid} but reads the SEPARATE `process.gina._inspectorInstrumentKey`
 * — turning on raw query/flow capture is more sensitive than agent log-streaming,
 * so it carries its own opt-in + key and is required EVEN in dev. Reads the
 * `x-gina-inspector-key` header or a `?key=` query param; constant-time compare
 * with a length guard; fail-closed when no key is configured.
 *
 * @inner
 * @param {http.IncomingMessage|http2.Http2ServerRequest} req
 * @returns {boolean} true when the presented key matches the configured instrument key
 */
function _instrumentKeyValid(req) {
    var configured = (typeof process.gina === 'object' && process.gina && typeof process.gina._inspectorInstrumentKey === 'string')
        ? process.gina._inspectorInstrumentKey
        : '';
    if (!configured) return false;
    var presented = (req.headers && req.headers['x-gina-inspector-key']) || '';
    if (!presented && typeof req.url === 'string') {
        var _qi = req.url.indexOf('?');
        if (_qi >= 0) {
            try {
                presented = new URLSearchParams(req.url.slice(_qi + 1)).get('key') || '';
            } catch (e) { presented = ''; }
        }
    }
    if (!presented) return false;
    var a = Buffer.from(String(presented));
    var b = Buffer.from(configured);
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

/**
 * Read a small JSON request body for the POST /_gina/instrument control
 * endpoint (#INS10). Bounded at 4 KB — the control body is tiny
 * (`{enable, ttlSeconds}`). Uses `req.body` when an upstream parser already
 * populated it; otherwise drains the request stream (works for HTTP/1.1
 * IncomingMessage and HTTP/2 Http2ServerRequest). A 2s timeout guards against
 * an already-consumed stream that never re-fires `end`. Calls back exactly once.
 *
 * @inner
 * @param {http.IncomingMessage|http2.Http2ServerRequest} req
 * @param {function(Error|null, object=):void} cb - `(err, parsedBody)`
 * @returns {void}
 */
function _readInstrumentBody(req, cb) {
    if (req.body && typeof req.body === 'object') {
        return cb(null, req.body);
    }
    var _chunks = [];
    var _size   = 0;
    var _done   = false;
    var _MAX    = 4096;
    var _timer  = null;
    var _finish = function(err, val) {
        if (_done) return;
        _done = true;
        if (_timer) { clearTimeout(_timer); _timer = null; }
        cb(err, val);
    };
    _timer = setTimeout(function() { _finish(new Error('body read timeout')); }, 2000);
    if (_timer && typeof _timer.unref === 'function') { _timer.unref(); }
    req.on('data', function(chunk) {
        _size += chunk.length;
        if (_size > _MAX) {
            _finish(new Error('body too large'));
            try { req.destroy(); } catch (e) {}
            return;
        }
        _chunks.push(chunk);
    });
    req.on('end', function() {
        var _raw = Buffer.concat(_chunks).toString('utf8').trim();
        if (!_raw) return _finish(null, {});
        try { _finish(null, JSON.parse(_raw)); }
        catch (e) { _finish(new Error('invalid JSON body')); }
    });
    req.on('error', function(e) { _finish(e); });
}

/**
 * Reloads all core and lib modules from disk by replacing their require.cache
 * entries with fresh exports. Excludes gna.js itself. Also refreshes the
 * plugins index so the running instance picks up any hot-reloaded code.
 *
 * @memberof module:gina/core/server.isaac
 */
var refreshCore = function() {

    var corePath    = getPath('gina').core;
    var libPath     = getPath('gina').lib;

    // replaced: new RegExp(corePath) — use indexOf instead (#P4)
    var excluded    = [
        _(corePath + '/gna.js', true)
    ];

    for (let c in require.cache) {
        if ( c.indexOf(corePath) > -1 && excluded.indexOf(c) < 0 ) {
            require.cache[c].exports = require( _(c, true) )
        }
    }

    // Update lib & helpers.
    //
    // `require.cache[<path>] = require(<path>)` would overwrite the cache entry
    // — which Node expects to be a `Module` instance with an `.exports` property
    // — with the lib registry's *exports object* directly. Subsequent plain
    // `require('../../lib')` calls then read `require.cache[<path>].exports` and
    // get `undefined` (the registry object has no `.exports` key), surfacing as
    // `Cannot read properties of undefined (reading 'Collection')` / `(reading
    // 'Cache')` etc. in the controller render delegates after a dev-mode hot
    // reload. Fix: delete the entry and let the next require() rebuild a proper
    // Module, then point gna.js's captured `.lib` at the fresh exports — the
    // same `.exports`-preserving shape the loop above already uses.
    var libIndexPath = _(libPath +'/index.js', true);
    delete require.cache[require.resolve(libIndexPath)];
    var freshLib = require( libIndexPath );
    require.cache[_(corePath + '/gna.js', true)].exports.lib = freshLib;

    // Update plugins — same fix as above.
    var pluginsIndexPath = _(corePath +'/plugins/index.js', true);
    delete require.cache[require.resolve(pluginsIndexPath)];
    var freshPlugins = require( pluginsIndexPath );
    require.cache[_(corePath + '/gna.js', true)].exports.plugins = freshPlugins;

    pruneDeadModuleChildren();
}

/**
 * Prunes stale `Module` references from every cached module's `children` array.
 *
 * Each cache-miss `require()` pushes the freshly created `Module` onto the
 * requiring module's `children` array — Node only dedupes on cache hits — so the
 * per-request delete-and-re-require cycles in `refreshCore()` (and the router's
 * `refreshCoreDependencies()`) make long-lived parents accumulate one dead
 * `Module` per eviction: this engine module, `router.js`, and any module with a
 * lazy in-function `require()` of an evicted lib. Every dead `Module` pins its
 * entire evaluated exports graph. Measured on a minimal bundle in dev mode:
 * ~1.8 MB of post-GC live heap retained per request, ending in a heap-limit
 * OOM (SIGABRT) at ~2400 requests.
 *
 * Keeping only children whose resolved id still maps to that same instance in
 * `require.cache` releases the dead graphs. `children` is diagnostic metadata
 * (nothing in Node's resolution reads it), so pruning never unloads a module
 * still referenced elsewhere.
 *
 * A local copy of the same sweep lives in `core/router.js` — the engine-agnostic
 * router cannot depend on an engine module, and the `lib` registry is itself
 * evicted per request. Keep both copies in sync.
 *
 * @memberof module:gina/core/server.isaac
 * @inner
 * @returns {undefined}
 */
var pruneDeadModuleChildren = function() {
    var cacheIds = Object.keys(require.cache);
    for (var i = 0, len = cacheIds.length; i < len; i++) {
        var cached = require.cache[cacheIds[i]];
        if (cached && cached.children && cached.children.length > 0) {
            cached.children = cached.children.filter(function onPruneFilter(child) {
                return require.cache[child.id] === child;
            });
        }
    }
};

// Express compatibility
const slice = Array.prototype.slice;


/**
 * Isaac server engine — Gina's built-in HTTP/1.1 and HTTP/2 server.
 * Creates an HTTP or HTTPS server (Node `http`, `https`, or `http2`),
 * sets up asset caching, routing cache, brotli/gzip compression detection,
 * and wires the `onPath` request handler.
 * Also attaches an optional engine.io WebSocket server when `options.ioServer` is defined.
 *
 * Returns `{ instance: server, middleware: middleware }`.
 *
 * @class ServerEngineClass
 * @constructor
 * @param {object} options - Bundle server configuration
 * @param {string} options.protocol - Protocol string (e.g. 'http/1.1', 'http/2')
 * @param {string} options.scheme - Scheme: 'http' or 'https'
 * @param {string} options.bundle - Bundle name
 * @param {string} options.cachePath - Absolute path to the bundle cache directory
 * @param {boolean} options.isCacheless - True in dev mode; clears local cache on startup
 * @param {object} options.credentials - TLS credentials (privateKey, certificate, ca, passphrase)
 * @param {object} options.allRoutes - Full routing map (used for frontend routing cache)
 * @param {string} options.preferedCompressionEncodingOrder - Ordered list of accepted encodings
 * @param {number} [options.keepAliveTimeout] - Server keep-alive timeout in ms
 * @param {number} [options.headersTimeout] - Server headers timeout in ms
 * @param {object} [options.ioServer] - engine.io server options; omit to disable WebSocket support
 * @returns {{ instance: object, middleware: function }} Configured Node server and middleware factory
 */
function ServerEngineClass(options) {

    // TODO - See if it would be interesting to add it to Helper::Path & to extend it to also readdirSync, returning the directory content
    /**
     * Reads a file synchronously, resolving symlinks before reading.
     *
     * @inner
     * @private
     * @param {string} filename - Absolute path to the file (may be a symlink)
     * @returns {string} UTF-8 file contents
     */
    var readSync = function(filename) {
        var fileObj = new _(filename, true);
        if ( fileObj.isSymlinkSync() ) {
            filename = fileObj.getSymlinkSourceSync()
        }

        return fs.readFileSync(filename).toString()
    }

    var preferedEncoding    = options.preferedCompressionEncodingOrder
        , acceptEncodingArr = null
        , acceptEncoding    = null
    ;

    var localAssets             = null
        , cachedAssets          = null
        , cachePathObj          = null
        , localCachePathObj     = null
    ;
    try {

        // Adding cache directory if not found
        cachePathObj = new _(options.cachePath, true);
        localCachePathObj = new _(options.cachePath +'/'+ options.bundle, true);
        if ( !cachePathObj.existsSync() ) {
            cachePathObj.mkdirSync();
        }
        // Empty cache for cahceless envs
        if ( options.isCacheless && localCachePathObj.existsSync() ) {
            localCachePathObj.rmSync();
        }
        // For frontend template routing if needed
        // TODO - Used `options.routing` instead after having filtered `options.allRoutes` vs `options.formsRules` to use only external routes exposed by `"query"` validation
        // replaced: delete operator + for...in — destructuring rest builds clean objects (#P21, #P22)
        var _routing = JSON.clone(options.allRoutes);
        // var _routing = JSON.clone(options.routing);
        var _routingKeys = Object.keys(_routing);
        for (var ri = 0; ri < _routingKeys.length; ++ri) {
            const { _comment, middleware, ...clean } = _routing[_routingKeys[ri]];
            _routing[_routingKeys[ri]] = clean;

            // reverseRouting is done on the frontend side

        }// EO for routing keys

        // Checking if brotli is installed
        var brotliBin = null;
        try {
            brotliBin = execSync( 'which brotli' ).toString().trim();
        } catch (binErr) {
            // Means that it is not installed.
        }
        // Checking if gzip is installed
        var gZipBin = null;
        try {
            gZipBin = execSync( 'which gzip' ).toString().trim();
        } catch (binErr) {
            // Means that it is not installed.
        }

        // Caching routing
        let targetDir   = _(options.cachePath +'/'+ options.bundle +'/config', true);
        let targetDirObj = new _(targetDir, true);
        if ( ! targetDirObj.existsSync() ) {
            targetDirObj.mkdirSync();
        }
        let targetFile  = null
            , fd        = null
            , buffer    = null
            , cmd       = null
            , brFileObj = null
            , gzFileObj = null
        ;
        if (_routing) {
            targetFile  = 'routing.json';
            // Storing to disk
            console.debug(`Writing ${targetFile} to: ${targetDir}/${targetFile}`);
            fd = fs.openSync(targetDir +'/'+ targetFile, 'w'); // Open file for writing
            buffer = Buffer.from( JSON.stringify(_routing) );
            fs.writeSync(fd, buffer, 0, buffer.length, 0); // Write the buffer
            fs.closeSync(fd); // Close the file descriptor

            // Adding brotli version
            // To enblable this feature, you need to install brotli on the host
            // [ Mac Os X ] brew install brotli
            // [ Debian/Ubuntu ] sudo apt install brotli
            try {
                if (brotliBin) {
                    brFileObj = new _(targetDir +'/'+ targetFile +'.br');
                    // Removing existing
                    if ( brFileObj.existsSync() ) {
                        brFileObj.rmSync();
                    }
                    // Creating a new br version
                    cmd = brotliBin +' --best '+ _(targetDir +'/'+ targetFile, true);
                    // replaced: execSync — async exec to avoid blocking event loop during startup (#P32)
                    // console.debug( execSync( cmd ).toString() );
                    exec(cmd, function(brCmdErr, stdout) {
                        if (brCmdErr) { console.error('[ SERVER ] brotli compression error: ' + (brCmdErr.stack || brCmdErr.message)); return; }
                        if (stdout) console.debug(stdout.toString().trim());
                    });
                }
            } catch (brError) {
                console.error('[ SERVER ] '+ brError.stack);
            }

            // Adding GZip version
            // To enblable this feature, you need to install gzip on the host
            // [ Mac Os X ] brew install gzip
            // [ Debian/Ubuntu ] sudo apt install gzip
            try {
                if (gZipBin) {
                    gzFileObj = new _(targetDir +'/'+ targetFile +'.gz');
                    // Removing existing
                    if ( gzFileObj.existsSync() ) {
                        gzFileObj.rmSync();
                    }
                    // Creating a new gz version
                    cmd = gZipBin +' -9 -k '+ _(targetDir +'/'+ targetFile, true);
                    // replaced: execSync — async exec to avoid blocking event loop during startup (#P32)
                    // console.debug( execSync( cmd ).toString() );
                    exec(cmd, function(gzCmdErr, stdout) {
                        if (gzCmdErr) { console.error('[ SERVER ] gzip compression error: ' + (gzCmdErr.stack || gzCmdErr.message)); return; }
                        if (stdout) console.debug(stdout.toString().trim());
                    });
                }
            } catch (gzError) {
                console.error('[ SERVER ] '+ gzError.stack);
            }
        }


        buffer = null;
        fd = null;


        localAssets = [
            {
                file    : 'routing.json',
                path    : targetDir,
                mime    : 'application/json; charset=utf8'
            }
        ];
        for (let i=0, len=localAssets.length; i<len; i++) {
            let fileName  =  _(localAssets[i].path +'/'+ localAssets[i].file, true);
            localAssets[i].content = readSync(fileName, 'utf8');
        }// EO for localAssets

    } catch (assetsError) {
        // TODO - Reuse the default or the project 404 page
        // fileContent = 'Not found';
        console.error('[ SERVER ] '+ assetsError.stack);
    }

    // openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=localhost" -keyout localhost-privkey.pem -out localhost-cert.pem
    var http2Options = {};
    if ( /https/.test(options.scheme) ) {
        try {
            http2Options = {
                key: readSync(options.credentials.privateKey),
                cert: readSync(options.credentials.certificate)
            };
        } catch(err) {
            var _credMsg = 'You are trying to start a secured server (https) wihtout suficient credentials: check your `server settings`\n'+ err.stack;
            console.emerg(_credMsg);
            // Guarantee the reason survives process.exit() on an async pipe (e.g. bin/gina-container).
            try { fs.writeSync(2, _credMsg + '\n'); } catch (_e) { /* best-effort */ }
            process.exit(1)
        }
    }


    var allowHTTP1 = true; // by default
    if (typeof (options.allowHTTP1) != 'undefined' && options.allowHTTP1 != '' ) {
        allowHTTP1 = options.allowHTTP1;
    }
    http2Options.allowHTTP1 = allowHTTP1;


    // Only read optional CA/PFX credentials for HTTPS — they are not needed for plain HTTP
    if ( /https/.test(options.scheme) ) {
        if (typeof (options.credentials.ca) != 'undefined' && options.credentials.ca != '' )
            // replaced: http2Options.ca = options.credentials.ca — credentials.ca is a path string; readSync() expands ~/ via _() before fs.readFileSync
            http2Options.ca = readSync(options.credentials.ca);

        if (typeof (options.credentials.pfx) != 'undefined' && options.credentials.pfx != '' )
            http2Options.pfx = readSync(options.credentials.pfx);

        if (typeof (options.credentials.passphrase) != 'undefined' && options.credentials.passphrase != '' )
            http2Options.passphrase = options.credentials.passphrase;
    }

    var server = null, http = null, ioServer = null;


    if ( /^http\/2/.test(options.protocol) ) {
        var _h2Opts = (options.http2Options && typeof options.http2Options === 'object') ? options.http2Options : {};
        // #H13 — RFC 8441 extended CONNECT (WebSocket over HTTP/2): strict boolean
        // opt-in via settings.json http2Options.enableConnectProtocol (default false).
        // Gates both the SETTINGS advert below and the `connect` listener registration.
        var _enableConnectProtocol = _h2Opts.enableConnectProtocol === true;
        http2Options.settings = {
            // Max parallel streams per TCP connection — configurable via settings.json http2Options.maxConcurrentStreams
            maxConcurrentStreams : _h2Opts.maxConcurrentStreams || 256,
            // Flow-control window in bytes — configurable via settings.json http2Options.initialWindowSize
            initialWindowSize   : _h2Opts.initialWindowSize    || 65535 * 10,
            // #H3 — HPACK bomb defense: cap compressed header list size (SETTINGS_MAX_HEADER_LIST_SIZE)
            maxHeaderListSize   : 65536,
            // #H3 — Server push is deprecated in Chrome/Firefox and removed in HTTP/2 RFC 9113; disable it
            enablePush          : false,
            // #H13 — advertises SETTINGS_ENABLE_CONNECT_PROTOCOL (RFC 8441) on any
            // http/2 bundle: `http2Options` (and this `settings` block) reaches
            // createSecureServer (https) and createServer (h2c) alike. RFC 8441 has
            // no TLS requirement; the flag stays a strict opt-in (default false).
            enableConnectProtocol : _enableConnectProtocol
        };
        // #H3 — RST flood defense (CVE-2019-9514, CVE-2023-44487 rapid reset)
        // #H7 — configurable via settings.json http2Options.maxSessionRejectedStreams (default 100)
        http2Options.maxSessionRejectedStreams = _h2Opts.maxSessionRejectedStreams || 100;
        // #H3 — CONTINUATION flood defense (CVE-2024-27316, CVE-2024-27983)
        // #H7 — configurable via settings.json http2Options.maxSessionInvalidFrames (default 1000)
        http2Options.maxSessionInvalidFrames = _h2Opts.maxSessionInvalidFrames || 1000;
        // #H9 — rapid-reset rate limit: max new streams accepted per session per
        // rolling 1s window before the session is GOAWAY'd + closed. Defends against
        // CVE-2023-44487-style rapid-reset floods (open then immediately RST streams
        // faster than maxConcurrentStreams alone can throttle). Configurable via
        // settings.json http2Options.maxStreamsPerSecond (default 200).
        var _maxStreamsPerSec = _h2Opts.maxStreamsPerSecond || 200;
        var http2   = require('http2');
        // h2c flood-defense parity: the cleartext branches receive the same
        // `http2Options` as the https branch. On non-https schemes the object
        // carries no TLS material (key/cert/ca/pfx/passphrase are merged under
        // `/https/` scheme gates only) — it holds exactly allowHTTP1 + the
        // `settings` advert + the #H3/#H7 caps, so the hardening applies
        // identically across schemes.
        switch (options.scheme) {
            case 'http':
                server      = http2.createServer(http2Options);
                break;

            case 'https':
                server      = http2.createSecureServer(http2Options);
                break;

            default:
                server      = http2.createServer(http2Options);
                break;
        }

        // ── HTTP/2 session metrics — exposed via /_gina/info ─────────────────────
        var _h2Metrics = {
            activeSessions : 0,
            totalStreams    : 0,
            goawayCount     : 0,
            rstCount        : 0,
            rapidResetBlocked : 0,
            // #H13 — extended-CONNECT (`:protocol`-bearing) streams observed
            extendedConnect : 0
        };
        server._h2Metrics = _h2Metrics;

        server.on('session', (session) => {
            // 120 seconds (120000 of inactivity
            let sessionTimeout = 120000;
            session.setTimeout(sessionTimeout);
            _h2Metrics.activeSessions++;

            session.on('timeout', () => {
                // Check if there are active streams before closing
                // This prevents killing a POST request that is still processing
                if (session.activeStreams === 0) {
                    console.log('[SERVER] Session idle timeout - Closing connection safely');
                    session.close();
                } else {
                    // Reset timeout if streams are still active
                    session.setTimeout(sessionTimeout);
                }
            });

            session.on('stream', (stream) => {
                _h2Metrics.totalStreams++;

                // #H9 — rapid-reset rate limit. Count new streams in a rolling 1s
                // window per session; on breach send GOAWAY(ENHANCE_YOUR_CALM) and
                // close the session so a flood cannot exhaust the worker.
                var _now = Date.now();
                if (typeof session._streamWindowStart === 'undefined' || (_now - session._streamWindowStart) >= 1000) {
                    session._streamWindowStart = _now;
                    session._streamWindowCount = 0;
                }
                session._streamWindowCount++;
                if (session._streamWindowCount > _maxStreamsPerSec) {
                    _h2Metrics.rapidResetBlocked++;
                    console.warn('[ SERVER ] HTTP/2 rapid-reset rate limit exceeded — ' + session._streamWindowCount + ' streams in <1s (limit ' + _maxStreamsPerSec + '); sending GOAWAY + closing session');
                    session.goaway(http2.constants.NGHTTP2_ENHANCE_YOUR_CALM);
                    session.close();
                    // Deliberately return before registering the per-stream
                    // `rstCode` listener below: the session is being torn down,
                    // so the breaching stream needs no per-stream accounting.
                    // Breached streams are counted by `rapidResetBlocked`, not
                    // `rstCount` — the two metrics stay cleanly separated
                    // (proactive block vs. observed client RST_STREAM).
                    return;
                }

                stream.on('rstCode', (code) => {
                    if (code !== 0) _h2Metrics.rstCount++;
                });
            });

            session.on('goaway', () => {
                _h2Metrics.goawayCount++;
            });

            session.on('close', () => {
                // This is normal after 60s of inactivity
                if (_h2Metrics.activeSessions > 0) _h2Metrics.activeSessions--;
                console.warn("[ SERVER ] TCP Connection closed");
            });

            // Without this handler, an abrupt client disconnect (ECONNRESET, EPROTO)
            // emits 'error' on the session with no listener → escalates to uncaughtException
            // → proc.js kills the bundle. Absorb these as warnings.
            session.on('error', (err) => {
                if (/ECONNRESET|EPROTO|ETIMEDOUT/i.test(err.code)) {
                    console.warn('[ SERVER ] Session error (absorbed):', err.message);
                    return;
                }
                console.error('[ SERVER ] Session error:', err.stack);
            });
        });

        // #H13 — RFC 8441 extended CONNECT (WebSocket over HTTP/2), strict opt-in.
        // Registering a `connect` listener suppresses the engine compat layer's
        // automatic 405 for CONNECT streams, so EVERY path below must terminate
        // the stream/socket — an unanswered CONNECT hangs forever. When the flag
        // is off, no listener is registered and the engine behaves byte-identically
        // to previous releases (plain CONNECT → compat 405; extended CONNECT →
        // rejected as malformed before reaching the app, since
        // SETTINGS_ENABLE_CONNECT_PROTOCOL was never advertised).
        // #H9 composition: the per-session `stream` accounting above still counts
        // every CONNECT stream — a rapid-reset flood of CONNECT streams trips the
        // same GOAWAY teardown, which destroys any just-accepted stream with it.
        if (_enableConnectProtocol) {
            server.on('connect', (request, response) => {
                try {
                    if (!request.stream) {
                        // HTTP/1.1 CONNECT (allowHTTP1 fallback): `response` is the
                        // raw socket here, the third argument the head buffer. Gina
                        // is not a forward proxy — refuse and close. (Without this
                        // listener the engine destroys the connection unanswered.)
                        response.write('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n');
                        response.destroy();
                        return;
                    }
                    var _protocol = request.headers[':protocol'];
                    if (typeof _protocol === 'undefined') {
                        // Plain HTTP/2 CONNECT (no :protocol): mirror the compat
                        // layer's default refusal (`:status 405` + `date`, no body).
                        response.writeHead(405);
                        response.end();
                        return;
                    }
                    _h2Metrics.extendedConnect++;
                    if (_protocol !== 'websocket') {
                        response.writeHead(501);
                        response.end();
                        return;
                    }
                    if (typeof server._extendedConnectHandler === 'function') {
                        // Narrow internal hook: the WebSocket session bridge claims
                        // the stream from here (`request.stream` is the raw
                        // Http2Stream; RFC 8441 §5 — respond `:status 200`, then the
                        // stream IS the bidirectional WebSocket channel).
                        server._extendedConnectHandler(request, response);
                        return;
                    }
                    // No consumer registered (transport enabled, bridge not wired):
                    // refuse cleanly so clients see a handshake failure, not a hang.
                    response.writeHead(501);
                    response.end();
                } catch (err) {
                    // Never let a CONNECT-path error escalate to uncaughtException
                    // (proc.js would SIGTERM the bundle) — terminate the stream instead.
                    console.warn('[ SERVER ] extended CONNECT handling failed: ' + err.message);
                    try {
                        if (request.stream && !request.stream.destroyed) {
                            request.stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
                        } else if (!request.stream && response && response.destroy) {
                            response.destroy();
                        }
                    } catch (closeErr) {
                        // stream/socket already gone — nothing left to terminate
                    }
                }
            });

            /**
             * #H13 — public WebSocket-over-HTTP/2 registration API. Bundle code
             * reaches it from `onInitialize` (the `app` argument IS this raw
             * server object) and registers a handler per exact pathname:
             *
             *     app.onWebSocket('/live', function(session, request) { ... });
             *
             * The dispatcher installs LAZILY on the first registration so the
             * default refusal table above keeps answering 501 for websocket
             * streams when no consumer exists. With handlers registered, an
             * accepted websocket stream is matched on its `:path` pathname
             * (query string stripped): an exact-path hit first, then (#H13
             * slice 2) an ordered scan of `:param` patterns whose captured
             * segments populate `request.params` (colon-stripped keys, the
             * same shape an HTTP controller reads). A hit is answered
             * `:status 200` via lib.wsSession.accept and handed to the handler
             * as a live session; a miss is refused with 404. No express middleware runs
             * on the CONNECT path — authentication is the handler's concern
             * (it receives the full request for header/cookie inspection).
             * Registering a path that already has a handler warns and overwrites
             * (last-write-wins): a programmatic call overrides a routing.json
             * `method:"ws"` declaration for the same path (declarations are
             * registered at bundle bootstrap, before onInitialize).
             *
             * #H13 slice 3a — an optional 3rd argument carries per-route session
             * options (maxPayload / protocol / closeTimeout) forwarded verbatim to
             * lib.wsSession.accept; a routing.json `method:"ws"` route supplies them
             * via `param.wsOptions`. Overwriting a path replaces handler AND options.
             */
            server._wsHandlers = {};
            // #H13 slice 3a — parallel exact-path → per-route options map. Kept
            // separate from _wsHandlers so that stays a pure path→handler map (the
            // collision guard tests the literal `_wsHandlers[wsPath]` shape).
            server._wsHandlerOptions = {};
            // #H13 slice 2 — ordered registry of `:param` patterns, scanned only
            // on an exact-match miss. Each entry: { pattern, segments, handler }.
            // First-registered wins among overlapping equal-length patterns —
            // mirrors gina's HTTP router, which is first-match by declaration
            // order (core/server.js routing loop breaks on the first matching
            // route; there is no cross-route best-score selection). Keeping the
            // same rule here means WS routing resolves consistently with HTTP.
            server._wsParamHandlers = [];

            // #H13 slice 2 — match a request pathname against the `:param`
            // registry. Exact routes are resolved by the caller BEFORE this runs.
            // Splits on '/' (keeping the leading '' from the leading slash, so
            // pattern/request segments index-align, mirroring lib/routing). A
            // strict segment-count gate, then per-segment: a literal must equal
            // exactly; a `:name` segment captures any NON-EMPTY segment as
            // `params[name]` (colon-stripped key + decodeURIComponent — the same
            // shape an HTTP controller reads off req.params). Returns
            // { handler, params } for the first matching pattern, else null.
            server._wsMatchParam = function(pathname) {
                var reqSegs = String(pathname || '').split('/');
                for (var i = 0; i < server._wsParamHandlers.length; i++) {
                    var entry = server._wsParamHandlers[i];
                    if (entry.segments.length !== reqSegs.length) { continue; }
                    var params = {};
                    var ok = true;
                    for (var s = 0; s < entry.segments.length; s++) {
                        var pat = entry.segments[s];
                        if (pat.charAt(0) === ':') {
                            if (reqSegs[s] === '') { ok = false; break; } // reject empty captured segment
                            params[pat.substring(1)] = decodeURIComponent(reqSegs[s]);
                        } else if (pat !== reqSegs[s]) {
                            ok = false; break;
                        }
                    }
                    if (ok) { return { handler: entry.handler, params: params, options: entry.options }; }
                }
                return null;
            };

            server.onWebSocket = function(wsPath, wsHandler, wsOptions) {
                if (typeof wsPath !== 'string' || wsPath.length === 0 || typeof wsHandler !== 'function') {
                    throw new TypeError('onWebSocket(path, handler) requires a non-empty path string and a handler function');
                }
                // #H13 slice 2 — a path with a `:` segment is a param pattern
                // (same placeholder convention as lib/routing's hasParams: /\:/).
                if ( /\:/.test(wsPath) ) {
                    var _existing = -1;
                    for (var _p = 0; _p < server._wsParamHandlers.length; _p++) {
                        if (server._wsParamHandlers[_p].pattern === wsPath) { _existing = _p; break; }
                    }
                    if (_existing > -1) {
                        console.warn('[ SERVER ] onWebSocket: pattern `'+ wsPath +'` already has a handler — overwriting');
                        server._wsParamHandlers[_existing].handler = wsHandler;
                        server._wsParamHandlers[_existing].options = wsOptions || null;
                    } else {
                        server._wsParamHandlers.push({ pattern: wsPath, segments: wsPath.split('/'), handler: wsHandler, options: wsOptions || null });
                    }
                } else {
                    if ( typeof server._wsHandlers[wsPath] === 'function' ) {
                        console.warn('[ SERVER ] onWebSocket: path `'+ wsPath +'` already has a handler — overwriting');
                    }
                    server._wsHandlers[wsPath] = wsHandler;
                    server._wsHandlerOptions[wsPath] = wsOptions || null;
                }
                if (typeof server._extendedConnectHandler !== 'function') {
                    server._extendedConnectHandler = function(request, response) {
                        var _wsPathname = String(request.headers[':path'] || '').split('?')[0];
                        // Exact match wins (slice-1 precedence preserved).
                        var _wsTarget = server._wsHandlers[_wsPathname];
                        var _wsParams = null;
                        // #H13 slice 3a — per-route session options resolved alongside
                        // the handler: an exact hit reads the exact options map; a
                        // param hit takes the matched entry's options below.
                        var _wsOpts   = server._wsHandlerOptions[_wsPathname] || null;
                        // #H13 slice 2 — param fallback only on an exact miss.
                        if (typeof _wsTarget !== 'function' && server._wsParamHandlers.length) {
                            var _m = server._wsMatchParam(_wsPathname);
                            if (_m) { _wsTarget = _m.handler; _wsParams = _m.params; _wsOpts = _m.options || null; }
                        }
                        if (typeof _wsTarget !== 'function') {
                            // No handler registered for this pathname.
                            response.writeHead(404);
                            response.end();
                            return;
                        }
                        // Populate request.params (named keys, colon-stripped) so a
                        // channel handler reads the same shape an HTTP controller does.
                        request.params = _wsParams || {};
                        var _wsSession = lib.wsSession.accept(request, _wsOpts || undefined);
                        _wsTarget(_wsSession, request);
                    };
                }
            };
        }
    } else {

        switch (options.scheme) {
            case 'http':
                http        = require('http');
                server      = http.createServer();
                break;

            case 'https':
                var https   = require('https');
                server      = https.createServer(http2Options);
                break;

            default:
                http        = require('http');
                server      = http.createServer();
                break;
        }
    }

    // #H13 — cross-protocol safety stub: onWebSocket is only functional on an
    // http/2 bundle with http2Options.enableConnectProtocol enabled. Bundles
    // sharing one onInitialize across differently-configured environments
    // must not crash on the call — warn instead of throwing.
    if (typeof server.onWebSocket !== 'function') {
        server.onWebSocket = function() {
            console.warn('[ SERVER ] onWebSocket() ignored — WebSocket over HTTP/2 requires an http/2 protocol and settings.json http2Options.enableConnectProtocol set to true');
        };
    }

    // Setting up server options
    if ( typeof(options.keepAliveTimeout) != 'undefined' ) {
        server.keepAliveTimeout = parseTimeout(options.keepAliveTimeout);
    }

    // Set headersTimeout slightly longer than keepAliveTimeout
    if ( typeof(options.headersTimeout) != 'undefined' ) {
        server.headersTimeout = parseTimeout(options.headersTimeout);
    }



    /**
     * Placeholder middleware factory (currently a stub).
     * Reserved for future path-scoped middleware support.
     *
     * @inner
     * @private
     * @param {string} path - Route path to match
     * @param {function} cb - Middleware callback
     */
    const middleware = function(path, cb) {

        // if (request.path === path) {
        //     onPath.call(this, path, cb)
        // }  else { // 404
        //     stream.respond({
        //         'content-type': 'text/html',
        //         ':status': 404
        //     });
        //     stream.end('<h1>404</h1>');
        // }
    }


    /**
     * Core HTTP request handler. Wires the server's `request` event listener,
     * dispatches health-check and info endpoints internally, handles static asset
     * serving with brotli/gzip negotiation, and delegates all other requests to
     * the Gina Router via `cb`. Called by `server.all` with `allowAll=true`.
     *
     * @inner
     * @private
     * @param {string} path - Base path this handler is mounted at
     * @param {function} cb - Gina router callback invoked for non-static requests
     * @param {boolean} [allowAll=false] - When true, all paths are handled (set by server.all)
     */
    const onPath = function(path, cb, allowAll) {

        var queryParams         = null
            , i                 = null
            , len               = null
            , p                 = null
            , arr               = null
            , a                 = null
            , isProxyHost       = null
            , requestHost       = null
            , isBinary          = null
            , isCacheless       = options.isCacheless
            , assetsCollection  = new Collection(localAssets)
            , localAsset        = null
            , cachedContents    = null
            , cachedContentObj  = null
            , cachedIndexes     = []
            , cachedIndexe      = null
        ;

        // #HDR8 Phase 2 — gate the framework's X-Powered-By emission based on
        // settings.json > server.hidePoweredBy (default false). Phase 1's
        // gina.plugins.HidePoweredBy() middleware can intercept setHeader /
        // removeHeader on the Express engine but NOT the 15 direct writeHead
        // emissions below — writeHead bypasses the setHeader interface. This
        // helper closes that Isaac-engine gap. Default false preserves shipped
        // behaviour; opt-in by setting server.hidePoweredBy = true.
        var _setPoweredByHeader = function(headers) {
            if (!options.hidePoweredBy) {
                headers['X-Powered-By'] = 'Gina/' + GINA_VERSION;
            }
            return headers;
        };


        // http2stream handle by the Router class & the SuperController class
        // See `${core}/router.js` & `${core}/controller/controller.js`

        server.on('request', (request, response) => {

            request.originalUrl = request.url;
            // #FI — dev-mode request timeline for Inspector Flow tab
            // Only initialized when the Inspector has been opened (process.gina._inspectorActive)
            // #INS10 — or during a prod instrumentation window (process.gina._inspectorWindowUntil).
            if ((process.gina && process.gina._inspectorWindowUntil > Date.now()) || (isCacheless && process.gina._inspectorActive)) {
                request._devTimeline = { requestStart: Date.now(), entries: [] };
            }
            // #OBS1 slice 3 — HTTP request lifecycle hook for Prometheus metrics.
            // Gated on lib.metrics.isEnabled() so the listener is only wired when
            // app.json metrics.enabled is true. Records on response 'finish' (fires
            // for both HTTP/1.1 ServerResponse and HTTP/2 Http2ServerResponse).
            // Errors inside the listener are swallowed — metrics must never crash
            // a request.
            if (lib.metrics.isEnabled()) {
                request._metricsStartTime = Date.now();
                response.on('finish', function _gina_metrics_record() {
                    try {
                        var _route = (request.routing && request.routing.rule) || undefined;
                        lib.metrics.recordRequest({
                            method:   request.method,
                            route:    _route,
                            status:   response.statusCode,
                            duration: Date.now() - request._metricsStartTime
                        });
                    } catch (_e) { /* metrics never crashes a request */ }
                });
            }
            // From the original

            acceptEncodingArr = null;
            if ( typeof(request.headers['accept-encoding']) != 'undefined' ) {
                acceptEncodingArr   = request.headers['accept-encoding'].replace(/\s+/g, '').split(/\,/);
            }
            acceptEncoding      = null;
            isBinary            = false;

            // healthcheck
            // TODO - add a top level API : server.api.js (check, get ...)
            // TODO - on 90% RAM usage, redirect to `come back later then restart bundle`
            // TODO - check url against wroot : getContext() ?
            if ( request.method.toUpperCase() === 'GET' && /\_gina\/health\/check$/i.test(request.url) ) {

                const healthStatus = JSON.stringify({
                    status: "healthy",
                    timestamp: new Date().toISOString() // Correction : JSON valide (string)
                });

                const healthHeaders = _setPoweredByHeader({
                    'cache-control': 'no-cache, no-store, must-revalidate',
                    'pragma': 'no-cache',
                    'expires': '0',
                    'content-type': 'application/json; charset=utf8'
                });

                // HTTP/2 (Multiplexing)
                if (response.stream) {
                    // On utilise le stream pour garder la session ouverte
                    response.stream.respond({
                        ':status': 200,
                        ...healthHeaders
                    });
                    return response.stream.end(healthStatus);
                }

                // Fallback HTTP/1.1
                response.writeHead(200, healthHeaders);
                return response.end(healthStatus);
            }

            // /_gina/metrics — Prometheus exposition format (#OBS1, slice 2)
            if ( request.method.toUpperCase() === 'GET' && /\/_gina\/metrics$/i.test(request.url) ) {
                if ( !lib.metrics.isClientAllowed(request) ) {
                    var metricsForbiddenBody    = JSON.stringify({ error: 'forbidden', message: '/_gina/metrics: client IP not in app.json metrics.allowFrom' });
                    var metricsForbiddenHeaders = _setPoweredByHeader({
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'pragma':        'no-cache',
                        'expires':       '0',
                        'content-type':  'application/json; charset=utf8'
                    });
                    if (response.stream) {
                        response.stream.respond({ ':status': 403, ...metricsForbiddenHeaders });
                        return response.stream.end(metricsForbiddenBody);
                    }
                    response.writeHead(403, metricsForbiddenHeaders);
                    return response.end(metricsForbiddenBody);
                }
                if ( !lib.metrics.isEnabled() ) {
                    var metricsDisabledBody    = '# /_gina/metrics — metrics not enabled\n# set app.json metrics.enabled to true and install prom-client (npm install prom-client)\n';
                    var metricsDisabledHeaders = _setPoweredByHeader({
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'content-type':  'text/plain; version=0.0.4; charset=utf-8'
                    });
                    if (response.stream) {
                        response.stream.respond({ ':status': 503, ...metricsDisabledHeaders });
                        return response.stream.end(metricsDisabledBody);
                    }
                    response.writeHead(503, metricsDisabledHeaders);
                    return response.end(metricsDisabledBody);
                }
                return lib.metrics.getMetrics().then(function(metricsText) {
                    var metricsHeaders = _setPoweredByHeader({
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'content-type':  'text/plain; version=0.0.4; charset=utf-8'
                    });
                    if (response.stream) {
                        response.stream.respond({ ':status': 200, ...metricsHeaders });
                        return response.stream.end(metricsText);
                    }
                    response.writeHead(200, metricsHeaders);
                    return response.end(metricsText);
                }).catch(function(metricsErr) {
                    var metricsErrBody    = JSON.stringify({ error: 'metrics_error', message: metricsErr.message || String(metricsErr) });
                    var metricsErrHeaders = _setPoweredByHeader({
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'content-type':  'application/json; charset=utf8'
                    });
                    if (response.stream) {
                        response.stream.respond({ ':status': 500, ...metricsErrHeaders });
                        return response.stream.end(metricsErrBody);
                    }
                    response.writeHead(500, metricsErrHeaders);
                    return response.end(metricsErrBody);
                });
            }

            if ( request.method.toUpperCase() === 'GET' && /\_gina\/info$/i.test(request.url) ) {

                // #S7 — IP allowlist gate. Mirrors the metrics endpoint
                // gate at L605-621. 403 on deny.
                if ( !lib.admin.isClientAllowed(request) ) {
                    var infoForbiddenBody    = JSON.stringify({ error: 'forbidden', message: '/_gina/info: client IP not in app.json admin.allowFrom' });
                    var infoForbiddenHeaders = _setPoweredByHeader({
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'pragma':        'no-cache',
                        'expires':       '0',
                        'content-type':  'application/json; charset=utf8'
                    });
                    if (response.stream) {
                        response.stream.respond({ ':status': 403, ...infoForbiddenHeaders });
                        return response.stream.end(infoForbiddenBody);
                    }
                    response.writeHead(403, infoForbiddenHeaders);
                    return response.end(infoForbiddenBody);
                }

                var infoPayload = {
                    "cache-is-enabled": server._cacheIsEnabled,
                    "memory"  : process.memoryUsage(),
                    "uptime"  : process.uptime(),
                    "version" : process.version
                };
                if (server._h2Metrics) {
                    infoPayload["http2"] = {
                        activeSessions : server._h2Metrics.activeSessions,
                        totalStreams    : server._h2Metrics.totalStreams,
                        goawayCount    : server._h2Metrics.goawayCount,
                        rstCount       : server._h2Metrics.rstCount,
                        rapidResetBlocked : server._h2Metrics.rapidResetBlocked,
                        extendedConnect : server._h2Metrics.extendedConnect
                    };
                }
                const infoStatus = JSON.stringify(infoPayload);

                const infoHeaders = _setPoweredByHeader({
                    'cache-control': 'no-cache, no-store, must-revalidate',
                    'pragma': 'no-cache',
                    'expires': '0',
                    'content-type': 'application/json; charset=utf8'
                });

                // HTTP/2 (Multiplexing)
                if (response.stream) {
                    // On utilise le stream pour garder la session ouverte
                    response.stream.respond({
                        ':status': 200,
                        ...infoHeaders
                    });
                    // fixed: #H1 — was passing infoHeaders (object) instead of infoStatus (JSON string)
                    return response.stream.end(infoStatus);
                }

                // Fallback HTTP/1.1
                response.writeHead(200, infoHeaders);
                return response.end(infoStatus);
            }

            if ( request.method.toUpperCase() === 'GET' && /\/_gina\/cache\/stats$/i.test(request.url) ) {

                // #S7 — IP allowlist gate. Same shape as the /_gina/info gate above.
                if ( !lib.admin.isClientAllowed(request) ) {
                    var cacheStatsForbiddenBody    = JSON.stringify({ error: 'forbidden', message: '/_gina/cache/stats: client IP not in app.json admin.allowFrom' });
                    var cacheStatsForbiddenHeaders = _setPoweredByHeader({
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'pragma':        'no-cache',
                        'expires':       '0',
                        'content-type':  'application/json; charset=utf8'
                    });
                    if (response.stream) {
                        response.stream.respond({ ':status': 403, ...cacheStatsForbiddenHeaders });
                        return response.stream.end(cacheStatsForbiddenBody);
                    }
                    response.writeHead(403, cacheStatsForbiddenHeaders);
                    return response.end(cacheStatsForbiddenBody);
                }

                cache.from(server._cached);
                const cacheStatsData = JSON.stringify(cache.stats());
                const cacheStatsHeaders = _setPoweredByHeader({
                    'cache-control': 'no-cache, no-store, must-revalidate',
                    'pragma': 'no-cache',
                    'expires': '0',
                    'content-type': 'application/json; charset=utf8'
                });
                // HTTP/2 (Multiplexing)
                if (response.stream) {
                    response.stream.respond({ ':status': 200, ...cacheStatsHeaders });
                    return response.stream.end(cacheStatsData);
                }
                // Fallback HTTP/1.1
                response.writeHead(200, cacheStatsHeaders);
                return response.end(cacheStatsData);
            }

            // ── /_gina/jobs/:id — async-job status (#AI6 slice 3) ────────────────
            // Always-on, state-only: returns lib.job.toStatusView (id + state +
            // timestamps), never result / error. Engine-agnostic handler lives in
            // server.js; this is the Isaac (HTTP/2) fast-path. 404 on unknown /
            // malformed id.
            var _jobsMatch = (request.method.toUpperCase() === 'GET')
                ? request.url.match(/\/_gina\/jobs\/([A-Za-z0-9_-]+)\/?(\?.*)?$/)
                : null;
            if ( _jobsMatch ) {
                var _jobsId      = _jobsMatch[1];
                var _jobsHeaders = _setPoweredByHeader({
                    'cache-control': 'no-cache, no-store, must-revalidate',
                    'pragma': 'no-cache',
                    'expires': '0',
                    'content-type': 'application/json; charset=utf8'
                });
                return lib.job.get(_jobsId, function(_jErr, _jRec) {
                    var _jobsStatus, _jobsBody;
                    if (_jErr || !_jRec) {
                        _jobsStatus = 404;
                        _jobsBody   = JSON.stringify({ error: 'not_found', message: '/_gina/jobs/' + _jobsId + ': unknown job id' });
                    } else {
                        _jobsStatus = 200;
                        _jobsBody   = JSON.stringify(lib.job.toStatusView(_jRec));
                    }
                    if (response.stream) {
                        response.stream.respond({ ':status': _jobsStatus, ..._jobsHeaders });
                        return response.stream.end(_jobsBody);
                    }
                    response.writeHead(_jobsStatus, _jobsHeaders);
                    return response.end(_jobsBody);
                });
            }

            // ── /_gina/instrument — toggleable instrumentation window (#INS10) ──
            // Opt-in (inspector.instrumentation.enabled) + key-auth required EVEN
            // in dev. GET → window status; POST {enable,ttlSeconds} → open/close.
            // Off-by-default: when not enabled the block does not match and the
            // request 404s through normal routing. Isaac HTTP/2 + HTTP/1.1 dual.
            if (
                process.gina && process.gina._inspectorInstrumentEnabled
                && (request.method.toUpperCase() === 'GET' || request.method.toUpperCase() === 'POST')
                && /\/_gina\/instrument(?:\?|$)/.test(request.url)
            ) {
                var _instrHeaders = _setPoweredByHeader({
                    'content-type':  'application/json; charset=utf8',
                    'cache-control': 'no-cache, no-store, must-revalidate',
                    'access-control-allow-origin': '*'
                });
                var _instrSend = function(_code, _payload) {
                    var _bodyStr = JSON.stringify(_payload);
                    if (response.stream) {
                        try {
                            response.stream.respond({ ':status': _code, ..._instrHeaders });
                            return response.stream.end(_bodyStr);
                        } catch (e) { return; }
                    }
                    response.writeHead(_code, _instrHeaders);
                    return response.end(_bodyStr);
                };
                if (!_instrumentKeyValid(request)) {
                    return _instrSend(401, { error: 'forbidden', message: '/_gina/instrument: invalid or missing inspector key' });
                }
                if (request.method.toUpperCase() === 'GET') {
                    return _instrSend(200, lib.instrument.status());
                }
                return _readInstrumentBody(request, function(_bErr, _body) {
                    if (_bErr) {
                        return _instrSend(400, { error: 'bad_request', message: '/_gina/instrument: ' + _bErr.message });
                    }
                    if (_body && _body.enable === false) {
                        var _stClose = lib.instrument.close();
                        console.warn('[inspector-instrument] window closed via /_gina/instrument');
                        return _instrSend(200, _stClose);
                    }
                    if (_body && _body.enable === true) {
                        var _stOpen = lib.instrument.open(_body.ttlSeconds);
                        console.warn('[inspector-instrument] window opened via /_gina/instrument for ' + Math.round(_stOpen.remainingMs / 1000) + 's');
                        return _instrSend(200, _stOpen);
                    }
                    return _instrSend(400, { error: 'bad_request', message: '/_gina/instrument: body must be {"enable":true|false[,"ttlSeconds":N]}' });
                });
            }

            // ── Inspector SPA — served at /_gina/inspector/ in dev mode ──────────
            if (
                isCacheless
                && request.method.toUpperCase() === 'GET'
                && /\/_gina\/inspector(\/.*)?$/.test(request.url)
            ) {
                // Activate profiling on first Inspector access — one-way flag,
                // stays true until bundle restart. QI (controller.js:257) gates
                // on this; it must be true before any request is processed.
                if (!process.gina._inspectorActive) process.gina._inspectorActive = true;
                var _inspBase = __dirname + '/asset/plugin/dist/vendor/gina/inspector';
                var _inspPath = request.url.replace(/^.*\/_gina\/inspector\/?/, '').split('?')[0];
                if (!_inspPath || _inspPath === '') _inspPath = 'index.html';

                var _inspMime = {
                    'html':  'text/html; charset=utf8',
                    'js':    'application/javascript; charset=utf8',
                    'css':   'text/css; charset=utf8',
                    'svg':   'image/svg+xml',
                    'woff2': 'font/woff2',
                    'woff':  'font/woff'
                };
                var _inspExt  = _inspPath.split('.').pop();
                var _inspFile = _(_inspBase + '/' + _inspPath, true);

                if (fs.existsSync(_inspFile)) {
                    var _inspBinary = /^(woff2?|png|ico|gif|jpe?g)$/.test(_inspExt);
                    var _inspHeaders = _setPoweredByHeader({
                        'content-type': _inspMime[_inspExt] || 'application/octet-stream',
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'x-content-type-options': 'nosniff',
                        'access-control-allow-origin': '*'
                    });
                    var _inspData = fs.readFileSync(_inspFile, _inspBinary ? undefined : 'utf8');

                    // HTTP/2
                    if (response.stream) {
                        response.stream.respond({ ':status': 200, ..._inspHeaders });
                        return response.stream.end(_inspData);
                    }

                    // HTTP/1.1
                    response.writeHead(200, _inspHeaders);
                    console.info(request.method + ' [200] ' + request.url);
                    return response.end(_inspData);
                }
                // Fall through to 404 if file not found
            }

            // ── Server-side log streaming — SSE at /_gina/logs in dev mode ──
            if (
                isCacheless
                && request.method.toUpperCase() === 'GET'
                && /\/_gina\/logs$/.test(request.url)
            ) {
                if (!process.gina._inspectorActive) process.gina._inspectorActive = true;
                var _ansiRe = /\x1B\[\d+m/g;

                var _sseHeaders = _setPoweredByHeader({
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache, no-store',
                    'connection': 'keep-alive',
                    'x-content-type-options': 'nosniff',
                    'access-control-allow-origin': '*'
                });

                var _write, _onClose;

                // HTTP/2
                if (response.stream) {
                    response.stream.respond({ ':status': 200, ..._sseHeaders });
                    _write   = function(d) { try { response.stream.write(d); } catch(e){} };
                    _onClose = function(fn) { response.stream.on('close', fn); };
                } else {
                    // HTTP/1.1
                    response.writeHead(200, _sseHeaders);
                    _write   = function(d) { try { response.write(d); } catch(e){} };
                    _onClose = function(fn) { request.on('close', fn); };
                }

                _write(':ok\n\n');

                var _sseLogListener = function(payload) {
                    try {
                        var entry = JSON.parse(payload);
                        var level = entry.level === 'catch' ? 'log' : (entry.level || 'log');
                        var msg   = (entry.content || '').replace(_ansiRe, '').replace(/\n$/, '');
                        if (!msg) return;
                        var evt = JSON.stringify({
                            t: Date.now(),
                            l: level,
                            b: entry.group || '',
                            s: msg,
                            src: 'server'
                        });
                        _write('data: ' + evt + '\n\n');
                    } catch (e) {}
                };

                if (!process.gina._sseConnections) process.gina._sseConnections = new Set();
                var _sseClose = function() {
                    process.removeListener('logger#default', _sseLogListener);
                    process.gina._sseConnections.delete(_sseClose);
                    try {
                        if (response.stream) response.stream.end();
                        else response.end();
                    } catch (e) {}
                };

                process.on('logger#default', _sseLogListener);
                process.gina._sseConnections.add(_sseClose);
                _onClose(_sseClose);

                console.info(request.method + ' [200] ' + request.url + ' (SSE)');
                return; // keep the connection open
            }

            // ── Inspector agent — combined SSE at /_gina/agent in dev mode ──
            if (
                (isCacheless || (process.gina && process.gina._inspectorAgentEnabled))
                && request.method.toUpperCase() === 'GET'
                && /\/_gina\/agent(?:\?|$)/.test(request.url)
            ) {
                // #INS9b — outside dev mode the agent endpoint requires a valid
                // key (x-gina-inspector-key header or ?key= query param). In dev
                // (isCacheless) it stays open with no key, preserving #INS9a.
                if (!isCacheless && !_agentKeyValid(request)) {
                    var _agDenyBody    = JSON.stringify({ error: 'forbidden', message: '/_gina/agent: invalid or missing inspector key' });
                    var _agDenyHeaders = _setPoweredByHeader({
                        'cache-control': 'no-cache, no-store, must-revalidate',
                        'content-type':  'application/json; charset=utf8'
                    });
                    if (response.stream) {
                        response.stream.respond({ ':status': 401, ..._agDenyHeaders });
                        return response.stream.end(_agDenyBody);
                    }
                    response.writeHead(401, _agDenyHeaders);
                    return response.end(_agDenyBody);
                }
                if (!process.gina._inspectorActive) process.gina._inspectorActive = true;
                var _agAnsiRe = /\x1B\[\d+m/g;

                var _agHeaders = _setPoweredByHeader({
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache, no-store',
                    'connection': 'keep-alive',
                    'access-control-allow-origin': '*',
                    'x-content-type-options': 'nosniff'
                });

                var _agWrite, _agOnClose;

                // HTTP/2
                if (response.stream) {
                    response.stream.respond({ ':status': 200, ..._agHeaders });
                    _agWrite   = function(d) { try { response.stream.write(d); } catch(e){} };
                    _agOnClose = function(fn) { response.stream.on('close', fn); };
                } else {
                    // HTTP/1.1
                    response.writeHead(200, _agHeaders);
                    _agWrite   = function(d) { try { response.write(d); } catch(e){} };
                    _agOnClose = function(fn) { request.on('close', fn); };
                }

                _agWrite(':ok\n\n');

                // Send current snapshot immediately if available; otherwise
                // send a lightweight "connected" frame so the Inspector shows
                // the bundle identity without waiting for the first request.
                // #INS10 — only replay the last snapshot to a connecting client in dev OR
                // during an active instrumentation window; never leak a post-window snapshot
                // to a late client (the redacted snapshot lingers in memory until overwritten).
                if ((isCacheless || lib.instrument.isActive()) && server._lastGinaData) {
                    try {
                        _agWrite('event: data\ndata: ' + JSON.stringify(server._lastGinaData) + '\n\n');
                    } catch (e) {}
                } else {
                    try {
                        var _initEnv = {
                            bundle : options.bundle || '',
                            env    : env || ''
                        };
                        var _initPayload = { gina: { environment: _initEnv }, user: { environment: _initEnv } };
                        _agWrite('event: data\ndata: ' + JSON.stringify(_initPayload) + '\n\n');
                    } catch (e) {}
                }

                // Data updates — emitted by render-swig.js on every HTML render
                var _agDataListener = function(payload) {
                    try {
                        _agWrite('event: data\ndata: ' + JSON.stringify(payload) + '\n\n');
                    } catch (e) {}
                };

                // Log entries — same source as /_gina/logs
                var _agLogListener = function(payload) {
                    try {
                        var entry = JSON.parse(payload);
                        var level = entry.level === 'catch' ? 'log' : (entry.level || 'log');
                        var msg   = (entry.content || '').replace(_agAnsiRe, '').replace(/\n$/, '');
                        if (!msg) return;
                        var evt = JSON.stringify({
                            t: Date.now(),
                            l: level,
                            b: entry.group || '',
                            s: msg,
                            src: 'server'
                        });
                        _agWrite('event: log\ndata: ' + evt + '\n\n');
                    } catch (e) {}
                };

                if (!process.gina._sseConnections) process.gina._sseConnections = new Set();
                var _agClose = function() {
                    process.removeListener('inspector#data', _agDataListener);
                    process.removeListener('logger#default', _agLogListener);
                    process.gina._sseConnections.delete(_agClose);
                    try {
                        if (response.stream) response.stream.end();
                        else response.end();
                    } catch (e) {}
                };

                process.on('inspector#data', _agDataListener);
                process.on('logger#default', _agLogListener);
                process.gina._sseConnections.add(_agClose);
                _agOnClose(_agClose);

                console.info(request.method + ' [200] ' + request.url + ' (SSE agent)');
                return;
            }

            // ── Live index introspection — JSON at /_gina/indexes in dev mode ──
            // #QI2 — triggers inspector#indexes event; each SQL connector responds
            // with its live index data. Collector aggregates responses.
            if (
                isCacheless
                && request.method.toUpperCase() === 'GET'
                && /\/_gina\/indexes$/.test(request.url)
            ) {
                if (!process.gina._inspectorActive) process.gina._inspectorActive = true;

                var _ixListenerCount = process.listenerCount('inspector#indexes');
                var _ixHeaders = _setPoweredByHeader({
                    'content-type': 'application/json; charset=utf8',
                    'cache-control': 'no-cache, no-store',
                    'access-control-allow-origin': '*'
                });

                if (_ixListenerCount === 0) {
                    var _ixEmpty = JSON.stringify({ connectors: {} });
                    if (response.stream) {
                        response.stream.respond({ ':status': 200, ..._ixHeaders });
                        return response.stream.end(_ixEmpty);
                    }
                    response.writeHead(200, _ixHeaders);
                    console.info(request.method + ' [200] ' + request.url);
                    return response.end(_ixEmpty);
                }

                var _ixResults   = {};
                var _ixRemaining = _ixListenerCount;
                var _ixResponded = false;

                var _ixRespond = function() {
                    if (_ixResponded) return;
                    _ixResponded = true;
                    clearTimeout(_ixTimeout);
                    var _ixBody = JSON.stringify({ connectors: _ixResults });
                    if (response.stream) {
                        if (response.stream.destroyed || response.stream.closed) return;
                        response.stream.respond({ ':status': 200, ..._ixHeaders });
                        return response.stream.end(_ixBody);
                    }
                    response.writeHead(200, _ixHeaders);
                    console.info(request.method + ' [200] ' + request.url);
                    response.end(_ixBody);
                };

                var _ixCollector = function(err, type, database, indexMap) {
                    if (_ixResponded) return;
                    if (!err && indexMap) {
                        var key = type + ':' + database;
                        _ixResults[key] = { type: type, database: database, tables: indexMap };
                    }
                    if (--_ixRemaining <= 0) _ixRespond();
                };

                var _ixTimeout = setTimeout(_ixRespond, 2000);
                process.emit('inspector#indexes', _ixCollector);
                return;
            }

            // ── Inspector reveal — JSON at /_gina/reveal in dev mode ──
            // #R7 reveal — returns the unredacted snapshot of the most recent
            // __ginaData payload, but ONLY when the bundle is running in the
            // `local` scope. Production / beta / testing bundles never expose
            // raw secrets through this endpoint, even in dev mode. The
            // unredacted snapshot itself is only stored when scope === 'local'
            // (see render-swig.js / render-json.js #R7 reveal block); other
            // scopes leave _lastGinaDataUnredacted as null.
            if (
                isCacheless
                && request.method.toUpperCase() === 'GET'
                && /\/_gina\/reveal$/.test(request.url)
            ) {
                var _rvHeaders = _setPoweredByHeader({
                    'content-type': 'application/json; charset=utf8',
                    'cache-control': 'no-cache, no-store',
                    'access-control-allow-origin': '*'
                });

                var _rvSend = function(status, body) {
                    var _rvBody = JSON.stringify(body);
                    if (response.stream) {
                        if (response.stream.destroyed || response.stream.closed) return;
                        response.stream.respond({ ':status': status, ..._rvHeaders });
                        return response.stream.end(_rvBody);
                    }
                    response.writeHead(status, _rvHeaders);
                    console.info(request.method + ' [' + status + '] ' + request.url);
                    response.end(_rvBody);
                };

                if (process.env.NODE_SCOPE !== 'local') {
                    return _rvSend(403, { error: 'reveal forbidden in non-local scope' });
                }

                if (!server._lastGinaDataUnredacted) {
                    return _rvSend(404, { error: 'no snapshot available' });
                }

                return _rvSend(200, server._lastGinaDataUnredacted);
            }

            // Proxy detection - Needs to be place after /_gina/health/*
            isProxyHost = getContext('isProxyHost') || false;
            requestHost = request.headers.host || request.headers[':authority'];
            // console.debug('[PROXY_HOST][isProxyHost='+ isProxyHost +'] request.headers.host -> ' + request.headers.host + '  VS request.headers[":authority"] '+ request.headers[':authority'] +' | '+ request.url);
            if (
                !isProxyHost
                && !/\:[0-9]+$/.test(requestHost)
                ||
                !isProxyHost
                && request.headers['x-forwarded-host']
            ) {
                // Enable proxied mode
                process.gina.PROXY_HOSTNAME = process.gina.PROXY_SCHEME +'://'+ requestHost;
                process.gina.PROXY_HOST     = requestHost;
                // For internal services communications - Eg.: Controller::query()
                if (request.headers['x-forwarded-host']) {
                    process.gina.PROXY_HOSTNAME = request.headers['x-forwarded-proto'] +'://'+ request.headers['x-forwarded-host'];
                    process.gina.PROXY_HOST     = request.headers['x-forwarded-host'];
                    // console.debug('[PROXY_HOST][X-FORWARDED-PROTO] override request.headers["x-forwarded-host"] -> ' + request.headers['x-forwarded-host']);
                }
                // Forcing context - also available for workers
                setContext('isProxyHost', true);
            }

            // Path-prefix awareness for upstreams mounted on a sub-path by the
            // reverse proxy. Standard header used by Spring Boot, Traefik,
            // FastAPI, etc. Per-request state (`request._ginaProxyPrefix`) so
            // the value cannot leak across requests when the worker handles a
            // mix of proxied + direct calls or different proxy mounts. Run on
            // EVERY request — gating on `!isProxyHost` like the host/scheme
            // block above would freeze the value at the first proxied
            // request's prefix forever (the gate stops firing after the first
            // proxied request, because `isProxyHost` becomes globally true).
            // Normalised to leading slash + no trailing slash so downstream
            // concatenation with the bundle's internal webroot is stable
            // (e.g. "/admin" + "/" → "/admin/"). Empty or "/" values are
            // dropped (back-compat: header absent or no-op header → property
            // never set, controller falls back to bundle's internal webroot).
            if (request.headers['x-forwarded-prefix']) {
                var _xfp = String(request.headers['x-forwarded-prefix']).trim();
                _xfp = _xfp.replace(/\/+$/, '');
                if (_xfp.length > 0 && _xfp.charAt(0) !== '/') {
                    _xfp = '/' + _xfp;
                }
                if (_xfp.length > 0) {
                    request._ginaProxyPrefix = _xfp;
                }
            }


            if (
                request.method.toUpperCase() === 'GET' && /\_gina\/assets\/routing\.json$/i.test(request.url)
            ) {
                // server.toApi(reques, response)
                // console.debug('[ SERVER ][200] '+ request.url);
                localAsset = assetsCollection.findOne({ file: request.url.split(/\//g).slice(-1).toString() });
                response.setHeader('content-type', localAsset.mime);
                response.setHeader('vary', 'Origin');
                response.setHeader('cache-control', 'public, max-age=86400');
                response.setHeader('x-content-type-options', 'nosniff');
                response.setHeader('x-frame-options', 'DENY');
                response.setHeader('x-xss-protection', '1; mode=block');
                // #HDR8 Phase 2 — gated on settings.json > server.hidePoweredBy
                // (inline form because this site uses setHeader instead of the
                // writeHead object-literal headers shape that _setPoweredByHeader covers)
                if (!options.hidePoweredBy) {
                    response.setHeader('X-Powered-By', 'Gina/'+ GINA_VERSION);
                }

                var filename  =  _(localAsset.path +'/'+ localAsset.file, true);
                if (acceptEncodingArr) {
                    for (let e=0, eLen=preferedEncoding.length; e<eLen; e++) {
                        if ( acceptEncodingArr && acceptEncodingArr.indexOf(preferedEncoding[e]) > -1 ) {
                            acceptEncoding = options.coreConfiguration.encoding[ preferedEncoding[e] ] ;
                            break;
                        }
                    }
                }
                // Compressed content
                if (
                    !isCacheless
                    && acceptEncoding
                    && fs.existsSync(filename + acceptEncoding)
                ) {
                    isBinary = true;
                    filename += acceptEncoding;
                    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding
                    response.setHeader('content-encoding', acceptEncoding.replace(/^\./, ''));
                    // override content length
                    response.setHeader('content-length', fs.statSync(filename).size);
                }

                if (!isBinary) {
                    console.info(request.method +' [200] '+ request.url);
                    return response.end(localAsset.content);
                }

                return fs.createReadStream(filename)
                    .on('end', function onResponse(){
                        console.info(request.method +' [200] '+ request.url);
                    })
                    .pipe(response);
            }


            if (isDev) {
                refreshCore()
            }

            if (!isCacheless || String(server._cacheIsEnabled).toLowerCase() === 'true') {
                if ( request.method.toUpperCase() === 'GET' ) {
                    var cacheStatus = null;
                    if ( String(server._cacheIsEnabled).toLowerCase() === 'true' ) {
                        cacheStatus = 'gina-cache';
                    }

                    // Importing cache handler
                    cache.from(server._cached);
                    var cacheKey        = null
                        , hasCachedKey  = false
                        // before: ['data:', 'static:']  (#C3 — bundle namespace prevents silent cache collisions)
                        , keyPrefixes   = ['data:' + options.bundle + ':', 'static:' + options.bundle + ':']
                    ;
                    for (let p=0, pLen=keyPrefixes.length; p<pLen; p++ ) {
                        cacheKey = keyPrefixes[p] + request.url;
                        if ( cache.has(cacheKey) ) {
                            hasCachedKey = true;
                            break;
                        }
                    }

                    if ( hasCachedKey ) {
                        // Getting cache from key.
                        // get() may return undefined when a sliding window expires between
                        // has() and get() — treat that as a miss and fall through.
                        cachedContentObj = cache.get(cacheKey);
                        if ( !cachedContentObj ) {
                            hasCachedKey = false;
                        }
                    }

                    if ( hasCachedKey ) {
                        // Getting the headers
                        cacheStatus += '; hit';
                        var cacheNow = new Date().getTime();
                        if ( cachedContentObj.sliding === true ) {
                            // Sliding: report remaining idle window and absolute ceiling separately
                            if ( typeof(cachedContentObj.ttl) != 'undefined' && cachedContentObj.ttl > 0 ) {
                                var lastAccess = cachedContentObj.lastAccessedAt
                                    ? cachedContentObj.lastAccessedAt.getTime()
                                    : cachedContentObj.createdAt.getTime();
                                var slidingRemainingSeconds = Math.max(0, Math.floor( (lastAccess + Math.round(cachedContentObj.ttl * 1000) - cacheNow) / 1000 ));
                                cacheStatus += '; ttl=' + slidingRemainingSeconds;
                                lastAccess = null;
                                slidingRemainingSeconds = null;
                            }
                            if ( cachedContentObj.expiresAt ) {
                                var absoluteRemainingSeconds = Math.max(0, Math.floor( (cachedContentObj.expiresAt.getTime() - cacheNow) / 1000 ));
                                cacheStatus += '; max-age=' + absoluteRemainingSeconds;
                                absoluteRemainingSeconds = null;
                            }
                        } else {
                            // Non-sliding (existing behaviour): report remaining absolute TTL
                            if ( typeof(cachedContentObj.ttl) != 'undefined' && cachedContentObj.ttl > 0) {
                                var createdAt = cachedContentObj.createdAt.getTime() + Math.round(cachedContentObj.ttl * 1000);
                                var remainingSeconds = Math.floor( (createdAt - cacheNow) /1000);
                                cacheStatus += '; ttl='+remainingSeconds;
                                createdAt = null;
                                remainingSeconds = null;
                            }
                        }
                        cacheNow = null;

                        if ( typeof(cachedContentObj.responseHeaders) != 'undefined' ) {
                            for (let h in cachedContentObj.responseHeaders ) {
                                response.setHeader(h, cachedContentObj.responseHeaders[h]);
                            }
                        }
                        response.setHeader('Cache-Status', cacheStatus);

                        // Cache-Control: hit path — use remaining TTL so downstream caches don't over-serve (#C6)
                        var _ccHitMaxAge = null;
                        var _ccHitNow = new Date().getTime();
                        if ( cachedContentObj.sliding === true ) {
                            if ( typeof(cachedContentObj.ttl) != 'undefined' && cachedContentObj.ttl > 0 ) {
                                var _ccHitLast = cachedContentObj.lastAccessedAt
                                    ? cachedContentObj.lastAccessedAt.getTime()
                                    : cachedContentObj.createdAt.getTime();
                                _ccHitMaxAge = Math.max(0, Math.floor( (_ccHitLast + Math.round(cachedContentObj.ttl * 1000) - _ccHitNow) / 1000 ));
                            }
                        } else {
                            if ( typeof(cachedContentObj.ttl) != 'undefined' && cachedContentObj.ttl > 0 ) {
                                _ccHitMaxAge = Math.max(0, Math.floor( (cachedContentObj.createdAt.getTime() + Math.round(cachedContentObj.ttl * 1000) - _ccHitNow) / 1000 ));
                            }
                        }
                        if ( _ccHitMaxAge !== null ) {
                            var _ccHitVis = ( cachedContentObj.visibility === 'public' ) ? 'public' : 'private';
                            response.setHeader('Cache-Control', _ccHitVis + ', max-age=' + _ccHitMaxAge);
                        }
                        _ccHitMaxAge = null; _ccHitNow = null;

                        if (
                            typeof(cachedContentObj.fromMemory) != 'undefined'
                        ) {
                            console.info(request.method +' [200]['+ cacheStatus +'] '+ request.url);
                            return response.end(cachedContentObj.content);
                        }

                        filename  =  _(cachedContentObj.filename, true);

                        return fs.createReadStream(filename)
                            .on('error', function onError(err) {
                                console.error("[SERVER][CACHE][FILE ERROR] ", err.stack|err.message|err);
                                return response.end(''+ err.stack|err.message|err);
                            })
                            .on('end', function onResponse(){
                                console.info(request.method +' [200] '+ request.url);
                            })
                            .pipe(response);
                    } // EO if ( hasCachedKey )
                    if (cacheStatus) {
                        cacheStatus += '; uri-miss';
                        response.setHeader('Cache-Status', cacheStatus);
                    }


                    cacheKey        = null;
                    hasCachedKey    = null;
                    keyPrefixes     = null;
                } // EO if ( request.method.toUpperCase() === 'GET' )
            } // EO if (!isCacheless)



            if ( /engine.io/.test(request.url)) {
                console.debug('[ SERVER ] engine.io request');
            }

            if (path === '*' || path == request.url) {
                request.params  = {};
                request.query   = {};

                if ( request.url.indexOf('?') > -1 ) {

                    queryParams = request.url.split('?');

                    len = queryParams.length;
                    // fixing `?` > 1 occurence
                    if (len > 2) {
                        queryParams[1] = queryParams.slice(1).join('&');
                        // cleanup
                        queryParams.splice(2);
                        len = queryParams.length;
                    }
                    request.params[0] = queryParams[0];

                    if ( queryParams[1].indexOf('&') > -1 ) {
                        i = 1;
                        for (; i < len; ++i) {

                            arr = queryParams[i].split('&');
                            p = 0;
                            for (; p < arr.length; ++p) {
                                a = arr[p].split('=');
                                // false & true case — replaced: regex with string comparison (#P16)
                                var _aLower = a[1] && a[1].toLowerCase();
                                if ( _aLower === 'false' || _aLower === 'true' || _aLower === 'on' )
                                    a[1] = ( _aLower === 'true' || _aLower === 'on' ) ? true : false;
                                else if (a[1] && (a[1].indexOf('+') > -1 || a[1].indexOf('%') > -1)) {
                                    // #B17: '+' → space per WHATWG URL form-urlencoded parser; must run before decodeURIComponent (which does NOT decode '+').
                                    if (a[1].indexOf('+') > -1) a[1] = a[1].replace(/\+/g, ' ');
                                    if (a[1].indexOf('%') > -1) a[1] = safeDecodeURIComponent(a[1]); // #B30: malformed-%-safe (raw fallback) — an unguarded decodeURIComponent here crashes the bundle
                                }

                                if (a[1] && typeof a[1] === 'string' && (a[1].charAt(0) === '{' || a[1].charAt(0) === '[') ) {
                                    try {
                                        a[1] = JSON.parse(a[1]);
                                    } catch(notAJsonError) {
                                        console.warn('[SERVER][INCOMING REQUEST]', 'Could not convert to JSON or Array this key/value to :' + a[0] + ': '+a[1] +'/nLeaving value as a string.');
                                    }
                                }
                                request.query[ a[0] ] = a[1]
                            }
                        }
                    } else {
                        a = queryParams[1].split('=');

                        if (a.length > 1) {
                            // false & true case — replaced: regex with string comparison (#P16)
                            var _aLower2 = a[1] && a[1].toLowerCase();
                            if ( _aLower2 === 'false' || _aLower2 === 'true' || _aLower2 === 'on' )
                                a[1] = ( _aLower2 === 'true' || _aLower2 === 'on' ) ? true : false;
                            else if (a[1] && (a[1].indexOf('+') > -1 || a[1].indexOf('%') > -1)) {
                                // #B17: '+' → space per WHATWG URL form-urlencoded parser; must run before decodeURIComponent (which does NOT decode '+').
                                if (a[1].indexOf('+') > -1) a[1] = a[1].replace(/\+/g, ' ');
                                if (a[1].indexOf('%') > -1) a[1] = safeDecodeURIComponent(a[1]); // #B30: malformed-%-safe (raw fallback) — an unguarded decodeURIComponent here crashes the bundle
                            }

                            request.query[ a[0] ] = a[1]
                        } else { // for redirection purposes or when passing `?encodedJsonObject`
                            try {
                                if ( a[0].indexOf('%') > -1 ) { // encoded URI Component
                                    a[0] = decodeURIComponent(a[0])
                                }

                                request.query = a[0] ? JSON.parse(a[0]) : {};
                            } catch(err) {
                                console.error(err.stack)
                            }
                        }

                    }
                    request.url = request.url.split('?')[0]
                } else {
                    request.params[0] = request.url
                }

                var referer     = null
                    , authority = request.scheme + '://'+ request.authority
                    , host      = null
                ;
                if ( typeof(request.headers.origin) != 'undefined' ) {
                    referer = request.headers.origin;
                } else if (request.headers.referer || request.authority) {
                    referer = request.headers.referer || authority;
                }
                var a = null;
                if (authority) {
                    a = authority.match(/^[https://|http://][a-z0-9-_.:/]+/);
                    if (a) {
                        a[0].split(/\//g);
                        a.splice(3);
                        authority = a.join('/');
                        host = authority;
                    }
                }

                if ( referer && /^(https\:\/\/|http\:\/\/)/.test(referer) ) {
                    if (referer != authority ) {
                        a = referer.match(/^[https://|http://][a-z0-9-_.:/]+\//)[0].split(/\//g);
                        a.splice(3);
                        referer = a.join('/');
                    }

                    a = null;
                }
                request.origin = referer;
                if (!host && referer) {
                    host = referer;
                } else if (!host && typeof(request.headers.host) != 'undefined' ) {
                    host = request.headers.host;
                }

                var port = null;
                try {
                    port = host.match(/\:\d+/);
                } catch (portError) {
                    console.warn('[SERVER] Port not in string for host `'+ host +'`.\nSetting default port to 80.');
                }
                if (port) {
                    host = host.replace(port[0], '');
                    port = ~~(port[0].substring(1));
                } else {
                    port = 80;
                }

                if (host) {
                    host = host.replace(/^(https\:\/\/|http\:\/\/)/, '');

                    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin
                    if ( /^http\/2/.test(options.protocol) ) {
                        request.headers[':host']    = host;
                        request.headers[':port']    = port;
                    } else if ( typeof(request.headers.hostname) == 'undefined') {
                        request.headers.host = host;
                        request.headers.port = port;
                    }

                    request.port    = port;
                    request.host    = host;

                    port    = null;
                    referer = null;
                }


                cb(request, response);
            }
        });

    }


    /**
     * Registers a catch-all request handler for every path.
     * Delegates to onPath with `allowAll=true`.
     *
     * @memberof ServerEngineClass
     * @param {string} path - Base path (usually '/')
     * @param {function} cb - Gina router callback
     */
    // All paths allowed
    server.all = function(path, cb) {
        onPath.call(this, path, cb, true)
    }

    // configuring express plugins|middlewares
    server._expressMiddlewares = [];
    /**
     * Registers one or more middleware functions to be called for every request.
     * Accepts either a plain function or an array of functions (Express-compatible signature).
     * Middlewares are stored in `server._expressMiddlewares` and invoked in registration order.
     *
     * @memberof ServerEngineClass
     * @param {function|function[]} fn - Middleware function or array of middleware functions
     */
    server.use = function use(fn) {

        var offset = 0;
        //var path = '/';

        // default path to '/'
        // disambiguate app.use([fn])
        if (typeof fn !== 'function') {
          var arg = fn;

          while (Array.isArray(arg) && arg.length !== 0) {
            arg = arg[0];
          }

          // first arg is the path
          if (typeof arg !== 'function') {
            offset = 1;
            path = fn;
          }
        }


        var fns = merge(slice.call(arguments, offset));

        if (fns.length === 0) {
          throw new TypeError('server.use() requires a middleware function')
        }

        fns.forEach(function (fn) {
            server._expressMiddlewares[server._expressMiddlewares.length] = fn;
        });

        return this;
    }


    server.on('error', (err) => {
        console.error(err)
    });


    //------------------------------------
    // Engine IO server
    // https://socket.io/docs/v4/server-api/#socketsendargs
    //------------------------------------
    if (
        typeof(options.ioServer) != 'undefined'
        && typeof(options.ioServer.integrationMode) != 'undefined'
        && /^attach$/.test(options.ioServer.integrationMode)
    ) {
        console.info('[IO SERVER ] `eio` found using `'+ options.ioServer.integrationMode +'` integration mode');
        delete options.ioServer.integrationMode;
        // Normalize timeout fields to ms before passing to engine.io constructor,
        // which calls setTimeout() internally and requires numeric values.
        var _ioTimeoutKeys = ['pingTimeout', 'pingInterval', 'timeout', 'interval', 'ackTimeout'];
        for (var _k = 0; _k < _ioTimeoutKeys.length; ++_k) {
            if (typeof options.ioServer[_ioTimeoutKeys[_k]] !== 'undefined') {
                options.ioServer[_ioTimeoutKeys[_k]] = parseTimeout(options.ioServer[_ioTimeoutKeys[_k]]);
            }
        }
        // #B10 fix: lazy-require engine.io — only loaded when ioServer is configured
        if (Eio === null) {
            Eio = require('engine.io');
        }
        // test done in case we would like to switch to socket.io-server
        ioServer = ( typeof(Eio.attach) != 'undefined' ) ? new Eio.attach(server, options.ioServer) : new Eio(server, options.ioServer);

        server.eio = ioServer;

        ioServer.on('connection', function (socket) {

            socket.send(JSON.stringify({
                id: this.id,//socket.id,
                handshake: 'Welcomed to `'+ options.bundle +'` main socket !',
                // how many ms before sending a new ping packet
                pingTimeout: parseTimeout(options.ioServer.pingTimeout || options.ioServer.timeout),
                // how many ms without a pong packet to consider the connection closed
                pingInterval: parseTimeout(options.ioServer.pingInterval || options.ioServer.interval)
            }));

            // Graceful-shutdown drain: proc.js's SIGTERM path invokes every
            // registered closer before _httpServer.close(), so live engine.io
            // sockets get a graceful close() (write buffer flushed, transport
            // close packet sent) instead of blocking shutdown until the hard
            // timeout. engine.io's close() takes no status code — the discard
            // variant close(true) is the hard teardown ioServer.close() uses.
            if (!process.gina._sseConnections) process.gina._sseConnections = new Set();
            var _eioShutdownCloser = function() {
                try { socket.close(); } catch (e) {}
            };
            process.gina._sseConnections.add(_eioShutdownCloser);

            socket.on('message', function(payload){

                try {
                    console.debug('[IO SERVER ] receiving '+ payload);
                    payload = JSON.parse(payload);
                    // bind to session ID
                    if ( typeof(payload.session) != 'undefined' ) {
                        this.sessionId = payload.session.id;
                    }
                    // Inspector: respond to data pull request. #INS10 — the engine.io
                    // channel is UNAUTHENTICATED, so never serve the captured snapshot
                    // over it outside dev mode. An instrumentation window can populate
                    // _lastGinaData in prod; that data must only leave via the
                    // authenticated /_gina/agent SSE, never this socket.
                    if ( payload.type === 'getGinaData' ) {
                        var _gd = options.isCacheless ? server._lastGinaData : null;
                        if (_gd) {
                            socket.send(JSON.stringify({ type: 'ginaData', data: _gd }));
                        }
                    }
                } catch(err) {
                    console.error(err.stack||err.message|| err)
                }
            });

            // ── Broadcast server-side log entries to connected Inspector ──
            if (options.isCacheless) {
                var _ioAnsiRe = /\x1B\[\d+m/g;

                var _ioLogListener = function(payload) {
                    try {
                        var entry = JSON.parse(payload);
                        var level = entry.level === 'catch' ? 'log' : (entry.level || 'log');
                        var msg   = (entry.content || '').replace(_ioAnsiRe, '').replace(/\n$/, '');
                        if (!msg) return;
                        socket.send(JSON.stringify({
                            type: 'log',
                            data: {
                                t: Date.now(),
                                l: level,
                                b: entry.group || '',
                                s: msg,
                                src: 'server'
                            }
                        }));
                    } catch (e) { /* socket may be closing */ }
                };

                process.on('logger#default', _ioLogListener);
            }

            socket.on('close', function(){
                console.debug('[IO SERVER ] closed socket #'+ this.id);
                if (process.gina._sseConnections) {
                    process.gina._sseConnections.delete(_eioShutdownCloser);
                }
                if (typeof _ioLogListener !== 'undefined') {
                    process.removeListener('logger#default', _ioLogListener);
                }
            });
        });

        server.on('upgrade', function(req, socket, head){
            // #INS8 — defer /_gina/agent upgrades to the WebSocket agent handler
            // attached in server.js; engine.io owns only its own upgrade path.
            if (/\/_gina\/agent(?:\?|$)/.test(req.url || '')) { return; }
            console.debug('[IO SERVER ] upgrading socket #'+ this.id);
            ioServer.handleUpgrade(req, socket, head);
        });
        // httpServer.on('request', function(req, res){
        //     ioServer.handleRequest(req, res);
        // });


    }



    return {
        instance: server,
        middleware: middleware
    }
};

module.exports = ServerEngineClass;