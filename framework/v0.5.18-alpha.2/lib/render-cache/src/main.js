'use strict';

/**
 * @module lib/render-cache
 * @description Pluggable output/render-cache backend dispatcher. Wraps the
 * shared in-process `lib/cache` Map (the `memory` strategy / L1 index) behind a
 * uniform interface so the render controllers and the server read path go
 * through one backend seam instead of touching the backing Map directly.
 *
 * Strategies:
 * - `memory` — in-process Map (via `lib/cache`); volatile, fastest per-serve.
 * - `fs`     — disk-backed under `server.cache.path`; entry metadata lives in
 *              the Map, the rendered body on disk. Survives a restart: on a
 *              Map miss `get()`/`has()` read the body back from disk, replaying
 *              the entry from a sibling `<file>.meta` JSON sidecar and
 *              preserving the ORIGINAL absolute expiry (a restart never extends
 *              a TTL). See `from(store, cachePath)`.
 * - `redis`  — shared L1+L2 across replicas (connector-homed; a later slice).
 *
 * Server-only: this module is never part of the browser AMD bundle (unlike
 * `lib/cache`, whose `define()` block is dormant — nothing in the browser
 * build graph requires it). Keeping the fs/redis I/O here — out of `lib/cache`
 * — keeps the hot, multi-purpose Map primitive (which also holds `swig:`
 * compiled templates and `http2session:` entries) free of storage-backend
 * logic.
 *
 * The write dispatch is a behaviour-identical extraction of the memory/fs
 * branch previously inlined in each render delegate's `writeCache()`.
 *
 * @example
 * var renderCache = new RenderCache({ store: serverInstance._cached });
 * await renderCache.set('memory', 'static:demo:/', { ttl: 60 }, { content: html });
 * renderCache.get('static:demo:/');   // -> the cached entry, or undefined
 *
 * @example
 * // fs restart-hardening: the server read path configures the cache root so a
 * // Map miss falls back to disk.
 * renderCache.from(serverInstance._cached, options.cachePath);
 * renderCache.has('static:demo:/page');  // true when the disk file exists
 * renderCache.get('static:demo:/page');  // reconstructs the entry from disk + .meta
 */

var fs    = require('fs');
var Cache = require('../../cache/src/main');

/**
 * Build the on-disk paths for an `fs`-strategy entry. Single source of truth
 * shared by `set('fs')` (write) and the read-back (`has`/`get`), so the write
 * filename and the read-back filename can never drift.
 *
 * Layout: `<root>/<bundle>[/<token>]/<html|data><url>.<ext>`, trailing-slash
 * url → `.../index.<ext>`, resolved through the `_` PathObject global exactly
 * as the pre-strategy code did. The release-namespace `token` (empty by
 * default) is a path segment under the bundle so a namespace change lands NEW
 * files in a fresh dir — old-namespace files are orphaned and, on read-back,
 * never matched (correct cross-namespace invalidation).
 *
 * @inner
 * @param {string} root   - Cache root (`server.cache.path`).
 * @param {string} token  - Release namespace (`buildKey`'s token) or '' for the flat layout.
 * @param {string} bundle - Bundle name.
 * @param {string} kind   - 'data' (JSON, `/data`+`.json`) | anything else (HTML, `/html`+`.html`).
 * @param {string} url    - Request URL (`req.originalUrl`).
 * @returns {{ body: string, meta: string }} Absolute body path + its `.meta` sidecar path.
 */
function fsPaths(root, token, bundle, kind, url) {
    var sub = ( kind === 'data' ) ? '/data' : '/html';
    var ext = ( kind === 'data' ) ? '.json' : '.html';
    if ( url.endsWith('/') ) {
        url += 'index';
    }
    var ns   = token ? ('/' + token) : '';
    var body = _(root + '/' + bundle + ns + sub + url + ext, true);
    return { body: body, meta: body + '.meta' };
}

/**
 * Parse an `fs`-eligible cache key into the pieces needed to reconstruct its
 * on-disk path. Key shape: `[<token>:]<static|data>:<bundle>:<url>` (the
 * optional leading segment is the release namespace `buildKey` prepends). The
 * url may itself contain colons (querystrings), so it is the rejoined
 * remainder; `buildKey` sanitizes the token to `[A-Za-z0-9._-]` (no colon), so
 * the leading segments split unambiguously.
 *
 * `static:` → HTML kind, `data:` → JSON kind (mirrors the delegate write:
 * swig/nunjucks write `static:`+kind `html`, json writes `data:`+kind `data`).
 * Returns `null` for any key that is not one of the two output namespaces (a
 * `swig:` / `http2session:` key has no disk file).
 *
 * @inner
 * @param {string} key
 * @returns {{ token: string, kind: string, bundle: string, url: string }|null}
 */
function parseFsKey(key) {
    if ( typeof(key) != 'string' ) {
        return null;
    }
    var parts = key.split(':');
    var idx   = 0;
    var token = '';
    // A leading segment that is not the kind prefix is the release namespace.
    if ( parts[0] !== 'static' && parts[0] !== 'data' ) {
        token = parts[0];
        idx   = 1;
    }
    var prefix = parts[idx];
    if ( prefix !== 'static' && prefix !== 'data' ) {
        return null;
    }
    var bundle = parts[idx + 1];
    var url    = parts.slice(idx + 2).join(':');
    if ( !bundle || !url ) {
        return null;
    }
    return { token: token, kind: ( prefix === 'data' ) ? 'data' : 'html', bundle: bundle, url: url };
}

/**
 * Resolve the release-namespace token that scopes output-cache keys +
 * fs paths: `GINA_CACHE_NAMESPACE` (an operator-set per-deploy id — a git SHA
 * / build number) wins; else `GINA_VERSION` (set at runtime, so the cache
 * auto-invalidates on a framework upgrade); else '' (the flat, pre-namespace
 * layout). Sanitized to a safe identifier so it is usable as BOTH a
 * colon-delimited key segment and an fs path segment. Read fresh each call —
 * process env is stable, and this keeps it test-controllable.
 *
 * @inner
 * @returns {string}
 */
function resolveReleaseToken() {
    var ns = '';
    if ( typeof(getEnvVar) === 'function' ) {
        ns = getEnvVar('GINA_CACHE_NAMESPACE') || getEnvVar('GINA_VERSION') || '';
    }
    return String(ns).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Remove an `fs` entry's body file and its `.meta` sidecar (best-effort — a
 * missing file is not an error). Used as the eviction cleanup and on read-back
 * of an already-expired disk entry.
 *
 * @inner
 * @param {string} body - Absolute body path (the `.meta` sibling is derived).
 * @returns {void}
 */
function rmFsFiles(body) {
    try { fs.rmSync(body); } catch (e) {}
    try { fs.rmSync(body + '.meta'); } catch (e) {}
}

/**
 * Render-cache dispatcher factory. Returns an `instance` object (not `this`) —
 * usage: `var rc = new RenderCache({ store })`.
 *
 * @class RenderCache
 * @constructor
 * @param {object} [options]
 * @param {Map}    [options.store] - Shared cache Map to adopt (e.g. `serverInstance._cached`).
 * @param {string} [options.path]  - Cache root (`server.cache.path`) for fs read-back.
 */
function RenderCache(options) {
    options = options || {};

    // The `memory` strategy / L1 index — the shared lib/cache Map primitive.
    // (lib/cache's backing Map is a process singleton, so every RenderCache in
    // the process points at the same store once `from()` is called.)
    var mem = new Cache();
    if ( options.store ) {
        mem.from(options.store);
    }

    // Cache root for the fs read-back. Per-INSTANCE (the backing Map is shared;
    // the path is not). Only the server read path configures it (via `from()`),
    // so on the render delegates' instances it stays null and the disk-aware
    // has()/get() below fall back to the Map-only behaviour — byte-identical.
    var _cachePath = ( typeof(options.path) != 'undefined' && options.path ) ? options.path : null;

    var instance = {};

    /**
     * Reconstruct the on-disk body path for `key`, or `null` when read-back is
     * not applicable (no cache root configured, or a non-output-namespace key).
     *
     * @inner
     * @param {string} key
     * @returns {string|null}
     */
    function fsBodyFor(key) {
        if ( !_cachePath ) {
            return null;
        }
        var p = parseFsKey(key);
        if ( !p ) {
            return null;
        }
        return fsPaths(_cachePath, p.token, p.bundle, p.kind, p.url).body;
    }

    /**
     * Read an `fs` entry back from disk after a restart (Map miss). Reads the
     * `.meta` sidecar, drops an already-expired entry (preserving the ORIGINAL
     * absolute expiry — a restart must never extend a TTL), repopulates the Map
     * and returns the reconstructed entry. `undefined` on any miss.
     *
     * Expiry preservation (the entry's `createdAt` is re-stamped to `now` by
     * `mem.set`, so the adjusted `ttl`/`maxAge` below make it expire at the
     * ORIGINAL absolute time):
     * - non-sliding: `ttl` := remaining seconds to the original `createdAt+ttl`.
     * - sliding + maxAge: `maxAge` := remaining seconds to the original ceiling;
     *   the idle `ttl` window restarts (a read-back IS an access).
     * - pure sliding (no maxAge): the idle window cannot be evaluated from disk
     *   (lastAccess is not persisted), so a read-back is treated as a fresh
     *   access — an accepted restart-recovery imprecision.
     *
     * @inner
     * @param {string} key
     * @returns {object|undefined}
     */
    function readBack(key) {
        var body = fsBodyFor(key);
        if ( !body || !fs.existsSync(body) ) {
            return undefined;
        }
        var meta;
        try {
            meta = JSON.parse(fs.readFileSync(body + '.meta', 'utf8'));
        } catch (e) {
            // No / unreadable sidecar: cannot replay expiry safely — treat as a
            // miss. The next render re-writes both body + sidecar (self-heals).
            return undefined;
        }
        var now       = Date.now();
        var createdMs = new Date(meta.createdAt).getTime();
        if ( isNaN(createdMs) ) {
            return undefined;
        }

        var entry = {
            filename        : body,
            responseHeaders : meta.responseHeaders,
            visibility      : meta.visibility
        };
        var hasTtl = ( typeof(meta.ttl) != 'undefined' && meta.ttl > 0 );

        if ( meta.sliding === true ) {
            entry.sliding = true;
            if ( hasTtl ) {
                // Idle window restarts on this access — ttl unchanged.
                entry.ttl = meta.ttl;
            }
            if ( typeof(meta.maxAge) != 'undefined' && meta.maxAge > 0 ) {
                var ceilRemainingMs = createdMs + Math.round(meta.maxAge * 1000) - now;
                if ( ceilRemainingMs <= 0 ) {
                    rmFsFiles(body);
                    return undefined;
                }
                // Preserve the absolute ceiling: mem.set stamps
                // expiresAt = now + maxAge*1000 = original createdAt + maxAge*1000.
                entry.maxAge = ceilRemainingMs / 1000;
            }
            // pure sliding (no maxAge): fresh access, documented imprecision.
        } else {
            if ( hasTtl ) {
                var remainingMs = createdMs + Math.round(meta.ttl * 1000) - now;
                if ( remainingMs <= 0 ) {
                    rmFsFiles(body);
                    return undefined;
                }
                // Preserve absolute expiry: mem.set stamps createdAt = now, so
                // now + remainingMs = original createdAt + ttl*1000.
                entry.ttl = remainingMs / 1000;
            }
            // no ttl → non-expiring entry (rare) — reconstruct as-is.
        }

        // Repopulate the Map: installs the timer + the same disk-cleanup fn as a
        // fresh write, and stamps createdAt/lastAccessedAt/expiresAt.
        mem.set(key, entry, function () { rmFsFiles(entry.filename); });
        return mem.get(key);
    }

    /**
     * Point the memory strategy at a shared cache Map. Idempotent — the server
     * hands the same store on every request. Optionally configures the fs cache
     * root used by the disk read-back (only the server read path passes it).
     *
     * @memberof RenderCache
     * @param {Map}    store
     * @param {string} [cachePath] - Cache root (`server.cache.path` / the top-level
     *                               `cachePath` alias) enabling fs restart read-back.
     * @returns {RenderCache} this instance (chainable)
     */
    instance.from = function(store, cachePath) {
        mem.from(store);
        // Only update when provided — never clear a previously-set path.
        if ( typeof(cachePath) != 'undefined' && cachePath ) {
            _cachePath = cachePath;
        }
        return instance;
    };

    /**
     * Build a fully-namespaced output-cache key: `[<token>:]<kind>:<bundle>:<url>`,
     * where `<token>` is the resolved release namespace
     * (`GINA_CACHE_NAMESPACE || GINA_VERSION || ''`). Empty token → the flat,
     * pre-namespace format (`<kind>:<bundle>:<url>`, unchanged).
     *
     * The SINGLE source of the key format — the 3 render delegates (write) and
     * the server read path all call this, so the writer/reader key can never
     * drift (the #C3 bundle-namespace bug was exactly such a drift). Only scope
     * the two output namespaces through here: `static:` (HTML) and `data:`
     * (JSON) — never `swig:` (compiled templates) or `http2session:`.
     *
     * @memberof RenderCache
     * @param {string} kind   - 'static' (HTML) | 'data' (JSON).
     * @param {string} bundle - Bundle name.
     * @param {string} url    - Request URL (`req.originalUrl` on write, `request.url` on read).
     * @returns {string} The namespaced cache key.
     */
    instance.buildKey = function(kind, bundle, url) {
        var token = resolveReleaseToken();
        return ( token ? token + ':' : '' ) + kind + ':' + bundle + ':' + url;
    };

    /**
     * Store a rendered entry under `key`, dispatching on strategy `type`.
     *
     * Behaviour-identical extraction of the memory/fs branch previously inlined
     * in each render delegate's `writeCache()`:
     * - `memory` — stamps `fromMemory: true` + the inline `content`, `set()`s it.
     * - `fs`     — writes the body to `<path>/<bundle>/<html|data><url>.<html|json>`
     *              (creating the dir), stamps `filename`, `set()`s the entry with
     *              a cleanup fn that removes the file (+ its `.meta`) on eviction,
     *              and writes a `<file>.meta` JSON sidecar carrying everything the
     *              server read path replays after a restart
     *              (`createdAt`/`ttl`/`sliding`/`maxAge`/`visibility`/`responseHeaders`).
     * - anything else (incl. `undefined`) — no-op (matches the pre-strategy
     *              behaviour: neither `/^memory$/` nor `/^fs$/` matched, so
     *              nothing was stored).
     *
     * @memberof RenderCache
     * @param {string} type   - 'memory' | 'fs' (case-insensitive).
     * @param {string} key    - Fully-namespaced cache key.
     * @param {object} entry  - The cache entry (responseHeaders / visibility / ttl / sliding / maxAge).
     * @param {object} [payload]
     * @param {string} [payload.content] - Rendered body (memory: stored inline; fs: written to disk).
     * @param {string} [payload.path]    - Cache root (`server.cache.path`) — fs only.
     * @param {string} [payload.bundle]  - Bundle name — fs path segment.
     * @param {string} [payload.url]     - `req.originalUrl` — fs path segment.
     * @param {string} [payload.kind]    - 'html' | 'data' — selects the fs subdir + extension.
     * @returns {Promise<void>}
     */
    instance.set = async function(type, key, entry, payload) {
        payload = payload || {};

        if ( /^memory$/i.test(type) ) {
            entry.fromMemory = true;
            // content is mandatory for the memory strategy
            entry.content = payload.content;
            mem.set(key, entry);
            return;
        }

        if ( /^fs$/i.test(type) ) {
            // The release namespace comes from the key (buildKey embedded it);
            // bundle/kind/url come from the payload (== the key's, by the
            // delegate's own buildKey call), so the write filename and the
            // read-back filename (fsBodyFor, also key-derived) cannot drift.
            var _pk      = parseFsKey(key);
            var _token   = _pk ? _pk.token : '';
            var p        = fsPaths(payload.path, _token, payload.bundle, payload.kind, payload.url);
            var filename = p.body;
            var dir      = filename.split(/\//g).slice(0, -1).join('/');
            var dirObj   = new _(dir);
            if ( !dirObj.existsSync() ) {
                dirObj.mkdirSync();
            }
            dirObj = null;

            await fs.promises.writeFile(filename, payload.content);

            // filename is mandatory for the fs strategy
            entry.filename = filename;
            // cleanupFn: delete the cached file (+ .meta) from disk on eviction.
            mem.set(key, entry, function() {
                rmFsFiles(entry.filename);
            });

            // .meta sidecar — written AFTER mem.set so meta.createdAt is exactly
            // the in-Map entry.createdAt lib/cache just stamped. Carries what the
            // server read path replays on a restart read-back.
            var meta = {
                createdAt       : entry.createdAt.toISOString(),
                ttl             : entry.ttl,
                sliding         : entry.sliding === true,
                maxAge          : entry.maxAge,
                visibility      : entry.visibility,
                responseHeaders : entry.responseHeaders
            };
            await fs.promises.writeFile(p.meta, JSON.stringify(meta));
            return;
        }
        // Unknown / undefined type → not cached.
    };

    /**
     * Lenient presence check: true when the entry is in the memory index OR
     * (fs restart-hardening) a body file exists on disk for `key`. The disk
     * check is inert unless a cache root was configured via `from()`, so the
     * render delegates (which never pass a path) keep Map-only semantics.
     *
     * The disk arm is deliberately lenient (existence, not expiry): the server
     * read path calls `get()` right after, which is authoritative and treats an
     * expired/absent entry as a miss.
     *
     * @memberof RenderCache
     * @param {string} key
     * @returns {boolean}
     */
    instance.has = function(key) {
        if ( mem.has(key) ) {
            return true;
        }
        var body = fsBodyFor(key);
        return ( body ) ? fs.existsSync(body) : false;
    };

    /**
     * Authoritative get: the memory entry when present, else (fs
     * restart-hardening) a disk read-back reconstructing the entry from its
     * body + `.meta` sidecar with the original absolute expiry preserved.
     * Returns `undefined` on miss / expiry. The disk arm is inert unless a
     * cache root was configured via `from()`.
     *
     * @memberof RenderCache
     * @param {string} key
     * @returns {object|string|undefined} The stored entry, or `undefined` on miss / expiry.
     */
    instance.get = function(key) {
        var hit = mem.get(key);
        if ( typeof(hit) != 'undefined' ) {
            return hit;
        }
        return readBack(key);
    };

    /**
     * @memberof RenderCache
     * @param {string} key
     * @returns {boolean} success
     */
    instance.delete = function(key) {
        return mem.delete(key);
    };

    /**
     * Register cache-invalidation rules for `key` (delegates to `lib/cache`).
     *
     * @memberof RenderCache
     * @param {string}   key
     * @param {string[]} events
     * @param {function} [cb]
     * @returns {void}
     */
    instance.setEvents = function(key, events, cb) {
        return mem.setEvents(key, events, cb);
    };

    /**
     * Fire event-based invalidation for every key registered to `event`
     * (delegates to `lib/cache`).
     *
     * @memberof RenderCache
     * @param {string} event
     * @param {*}      [data]
     * @returns {void}
     */
    instance.invalidateByEvent = function(event, data) {
        return mem.invalidateByEvent(event, data);
    };

    /**
     * Flush the output/render cache — the `static:` (HTML) and `data:` (JSON)
     * namespaces only. Never touches `swig:` (compiled templates) or
     * `http2session:` entries, which have their own lifecycle. Optionally scoped
     * to a single `bundle` (matches the key's bundle segment across ALL release
     * tokens present in the Map).
     *
     * Each matched key is routed through the underlying `delete`, so its expiry
     * timer is cleared AND its cleanup fn runs — for an `fs` entry that removes
     * the CURRENT-namespace body + `.meta` from disk. Old-namespace fs orphans (a
     * prior release token's dir) are NOT touched here — an in-process flush
     * leaves them (already token-invalidated on read-back, so never served);
     * `clearFsBundle()` reclaims them from the offline CLI path.
     *
     * Synchronous: pair a `from(store)` + `clear()` in one tick so the shared Map
     * cannot be re-pointed between them.
     *
     * @memberof RenderCache
     * @param {string} [bundle] - Restrict the flush to this bundle's output entries.
     * @returns {number} The number of entries removed.
     */
    instance.clear = function(bundle) {
        var removed = 0;
        var keys    = mem.keys();
        for (var i = 0; i < keys.length; i++) {
            var p = parseFsKey(keys[i]);
            // parseFsKey is null for any non-output namespace (swig: /
            // http2session: / anything else) — those are never flushed here.
            if ( !p ) {
                continue;
            }
            if ( bundle && p.bundle !== bundle ) {
                continue;
            }
            try {
                if ( mem.delete(keys[i]) ) {
                    removed++;
                }
            } catch (e) {
                // Mirror lib/cache clear()'s per-entry isolation: a throwing
                // cleanup fn must not abort the sweep.
            }
        }
        return removed;
    };

    /**
     * Reclaim a bundle's `fs`-strategy render output from disk — the OFFLINE
     * counterpart to `clear()`. Where `clear()` removes the CURRENT-namespace
     * files via the in-Map entries' cleanup fns, this removes ALL of a bundle's
     * render-output dirs directly, including orphaned prior-release token dirs
     * that survive a namespace change (`buildKey`'s token is an fs path segment,
     * so a redeploy lands new files in a fresh dir and abandons the old one).
     *
     * Under `<root>/<bundle>/` the render output lives in the `html`/`data`
     * subtrees — either directly (the flat, empty-token layout) or nested one
     * level under a release token (`<token>/html`, `<token>/data`). The two
     * SIBLING dirs `config` (the boot-time routing-asset cache) and `swig` (the
     * compiled-layout cache) are NOT render output and are preserved.
     *
     * Consequently `config` and `swig` are RESERVED names: a release namespace
     * (`GINA_CACHE_NAMESPACE`) must not be either, or its token dir would be
     * mistaken for the infra cache and skipped.
     *
     * Best-effort: a missing bundle dir (nothing cached yet) or an un-removable
     * child is not an error.
     *
     * @memberof RenderCache
     * @param {string}  root              - Cache root (`server.cache.path` / the top-level `cachePath`).
     * @param {string}  bundle            - Bundle name.
     * @param {object}  [options]
     * @param {boolean} [options.dryRun]  - Report what WOULD be removed without removing it
     *                                      (so a `--dry-run` preview and a real run resolve
     *                                      the same set from the same code — the CLI never
     *                                      re-implements the layout).
     * @returns {string[]} Absolute paths of the dirs removed (or, on a dry run, that would be).
     */
    instance.clearFsBundle = function(root, bundle, options) {
        options = options || {};
        var dryRun  = ( options.dryRun === true );
        var removed = [];
        if ( !root || !bundle ) {
            return removed;
        }
        var bundleDir = root + '/' + bundle;
        // Siblings of the render-output dirs that are NOT render output.
        var preserve  = { config: true, swig: true };
        var children;
        try {
            children = fs.readdirSync(bundleDir, { withFileTypes: true });
        } catch (e) {
            // No cache dir for this bundle → nothing to reclaim.
            return removed;
        }
        for (var i = 0; i < children.length; i++) {
            var name = children[i].name;
            if ( preserve[name] || !children[i].isDirectory() ) {
                continue;
            }
            var target = bundleDir + '/' + name;
            if ( dryRun ) {
                removed.push(target);
                continue;
            }
            try {
                fs.rmSync(target, { recursive: true, force: true });
                removed.push(target);
            } catch (e) { /* best-effort */ }
        }
        return removed;
    };

    /**
     * Snapshot of the current cache state (delegates to `lib/cache`).
     *
     * @memberof RenderCache
     * @returns {object}
     */
    instance.stats = function() {
        return mem.stats();
    };

    return instance;
}

module.exports = RenderCache;
