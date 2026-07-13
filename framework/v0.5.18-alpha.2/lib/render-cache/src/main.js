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
 *              the Map, the rendered body on disk. (Cross-restart read-back is
 *              added in a later slice.)
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
 */

var fs    = require('fs');
var Cache = require('../../cache/src/main');

/**
 * Render-cache dispatcher factory. Returns an `instance` object (not `this`) —
 * usage: `var rc = new RenderCache({ store })`.
 *
 * @class RenderCache
 * @constructor
 * @param {object} [options]
 * @param {Map}    [options.store] - Shared cache Map to adopt (e.g. `serverInstance._cached`).
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

    var instance = {};

    /**
     * Point the memory strategy at a shared cache Map. Idempotent — the server
     * hands the same store on every request.
     *
     * @memberof RenderCache
     * @param {Map} store
     * @returns {RenderCache} this instance (chainable)
     */
    instance.from = function(store) {
        mem.from(store);
        return instance;
    };

    /**
     * Store a rendered entry under `key`, dispatching on strategy `type`.
     *
     * Behaviour-identical extraction of the memory/fs branch previously inlined
     * in each render delegate's `writeCache()`:
     * - `memory` — stamps `fromMemory: true` + the inline `content`, `set()`s it.
     * - `fs`     — writes the body to `<path>/<bundle>/<html|data><url>.<html|json>`
     *              (creating the dir), stamps `filename`, and `set()`s the entry
     *              with a cleanup fn that removes the file on eviction.
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
            var sub = ( payload.kind === 'data' ) ? '/data' : '/html';
            var ext = ( payload.kind === 'data' ) ? '.json' : '.html';
            var url = payload.url;
            if ( url.endsWith('/') ) {
                url += 'index';
            }
            var filename = _(payload.path + '/' + payload.bundle + sub + url + ext, true);
            var dir      = filename.split(/\//g).slice(0, -1).join('/');
            var dirObj   = new _(dir);
            if ( !dirObj.existsSync() ) {
                dirObj.mkdirSync();
            }
            dirObj = null;

            await fs.promises.writeFile(filename, payload.content);

            // filename is mandatory for the fs strategy
            entry.filename = filename;
            // cleanupFn: delete the cached file from disk when the entry is evicted
            mem.set(key, entry, function() {
                try { fs.rmSync(entry.filename); } catch (e) {}
            });
            return;
        }
        // Unknown / undefined type → not cached.
    };

    /**
     * @memberof RenderCache
     * @param {string} key
     * @returns {boolean} true when the entry is present (in the memory index today).
     */
    instance.has = function(key) {
        return mem.has(key);
    };

    /**
     * @memberof RenderCache
     * @param {string} key
     * @returns {object|string|undefined} The stored entry, or `undefined` on miss / expiry.
     */
    instance.get = function(key) {
        return mem.get(key);
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
     * Clear the whole store. Per-bundle / namespace-scoped clearing arrives
     * with the flush slice.
     *
     * @memberof RenderCache
     * @returns {void}
     */
    instance.clear = function() {
        return mem.clear();
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
