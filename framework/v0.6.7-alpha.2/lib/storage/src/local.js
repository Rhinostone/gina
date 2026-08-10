/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * @module lib/storage/local
 * @description The `local` adapter crossed with the `sharded` strategy — bytes
 * on the local filesystem under a per-driver root, keys laid out as
 * `YYYY/MM/DD/<ulid><ext>`.
 *
 * **Why a date prefix.** Directories with millions of sibling entries are slow
 * to list and unpleasant to operate; a day-level prefix keeps each directory
 * small, makes "everything from last Tuesday" a directory walk, and — because
 * a ULID sorts by creation time — keeps entries within a day ordered too.
 *
 * **Why the extension is the only untrusted byte that reaches disk.** The
 * client filename is stored verbatim in the metadata row, never in the path.
 * Only a hard-whitelisted extension is appended, purely so an operator
 * browsing the tree can tell a PDF from a PNG.
 *
 * **The write path is the #B223 discipline generalised.** Content is streamed
 * to a temp file inside the driver root and published with `rename(2)`, so a
 * reader never observes a partial object and a crashed write leaves nothing
 * visible. The temp lives under the SAME root (not the global upload tmp dir)
 * because `rename(2)` fails with `EXDEV` across filesystems, and gina's tmp and
 * asset trees are routinely on different ones. Error listeners are armed AT
 * STREAM CREATION, never later (#B143): an unlistened stream `'error'` takes
 * the whole bundle process down.
 *
 * @example
 * var driver = createLocalDriver('assets',
 *     { root: '/var/data/assets', strategy: 'sharded', maxObjectSize: 52428800 },
 *     metaStore);
 * driver.put(req, { originalName: 'a.pdf' }, function (err, res) { });
 */

var fs       = require('fs');
var nodePath = require('path');

var util = require('./util');

/**
 * Directory holding in-flight temp files, relative to the driver root.
 *
 * @inner
 * @constant
 * @type {string}
 */
var TMP_DIR = '.tmp';

/**
 * A stored object, as returned by `put()`.
 *
 * @typedef  {Object} StoragePutResult
 * @property {string}  key         - The opaque storage key. Never parse or compose it.
 * @property {number}  size        - Object size in bytes, measured from the published file
 *                                   on disk — never taken from the client.
 * @property {?string} contentType - The client-supplied MIME type, echoed back untrusted.
 */

/**
 * The storage contract (v0), callback-shaped throughout — matching every other
 * seam in the tree (job-store, session-store, the upload mover) rather than
 * introducing a promise style the surrounding code does not use.
 *
 * Verbs arrive WITH the strategy that needs them: `getRange` (Range serving),
 * the resumable trio (`createUpload` / `writeSegment` / `finalize`) and
 * `findByDigest` (content-addressed dedup) are deliberately absent from v0 and
 * will be capability-gated when they land.
 *
 * @typedef  {Object} StorageDriver
 * @property {function(object, object, function): void} put          - Store a readable stream; `fn(err, {@link StoragePutResult})`.
 * @property {function(string, function): void}         get          - Open a readable stream for `key`; `fn(err, stream)`. Errors on an unknown key — see `stat` for the existence question.
 * @property {function(string, function): void}         stat         - Metadata for `key`; `fn(err, meta|null)`. `null` (not an error) when unknown.
 * @property {function(string, function=): void}        release      - Delete object and metadata; `fn(err, existed)`.
 * @property {function(string, function): void}         resolve      - How to serve `key`; `fn(err, {kind:'path', path})`.
 * @property {function(): void}                         close        - Release the metadata handle. Teardown/tests only.
 * @property {object}                                   capabilities - What this driver can do; every consumer must branch on it rather than assume.
 */

/**
 * Whether any segment of `key` names driver-internal state.
 *
 * `.tmp` holds in-flight writes and `.meta.db` is the metadata database — both
 * live INSIDE the root by design, so both are reachable by a key that never
 * leaves it. Without this, a caller passing `.meta.db` to `release()` would
 * delete the driver's own index.
 *
 * Checked AFTER confinement, never before — see {@link module:lib/storage/local}'s
 * `resolvePath` for why the order is load-bearing.
 *
 * @inner
 * @param {string} key - A key that has already passed confinement.
 * @returns {boolean} `true` when a segment starts with a dot.
 * @example
 * hasReservedSegment('2026/08/10/01K2…'); // => false
 * hasReservedSegment('.meta.db');         // => true
 * hasReservedSegment('.tmp/x');           // => true
 */
function hasReservedSegment(key) {
    var segments = key.split(/[\\/]/);
    for (var i = 0; i < segments.length; i++) {
        if ( segments[i].charAt(0) === '.' ) { return true; }
    }
    return false;
}

/**
 * Build a `local` filesystem driver.
 *
 * @param {string}           name              - Driver name, used only in error messages.
 * @param {object}           conf              - Resolved driver configuration.
 * @param {string}           conf.root         - Absolute driver root. Validated at boot to be
 *                                               absolute and outside every web-served tree.
 * @param {string}           conf.strategy     - Key-layout strategy (`sharded`).
 * @param {number}           conf.maxObjectSize - Per-object byte ceiling, already parsed.
 * @param {StorageMetaStore} metaStore         - Metadata backend (embedded SQLite by default).
 * @returns {StorageDriver} A ready driver.
 *
 * @example
 * var driver = createLocalDriver('assets', conf, metaStore);
 */
module.exports = function createLocalDriver(name, conf, metaStore) {

    var root = conf.root;
    var max  = conf.maxObjectSize;

    /**
     * Resolve a caller-supplied key to a confined absolute path.
     *
     * **The guard ORDER is load-bearing, and got this wrong once.** Confinement
     * runs FIRST. A reserved-segment check placed ahead of it shadows the
     * security boundary entirely: `..` starts with a dot, so every classic
     * traversal attempt is answered with "reserved", `confineToBase` is never
     * reached, and a traversal test passes for the wrong reason — leaving the
     * real guard unexercised by the one input class it exists for. Caught by a
     * smoke run before this shipped; keep confinement first.
     *
     * The canonical-form check that follows keeps the key and its path 1:1. A
     * key like `a/../b` stays inside the root, so confinement accepts it, but
     * it addresses the same file as `b` while indexing under a different
     * metadata key — so `stat()` would answer for one and `get()` for the
     * other. Keys are opaque and always minted by `put()`, so a non-canonical
     * one never arises honestly.
     *
     * @inner
     * @param {string} key - The opaque storage key.
     * @returns {{path: ?string, error: ?Error}} Exactly one side is set.
     */
    var resolvePath = function(key) {
        if ( typeof(key) != 'string' || key.length === 0 ) {
            return { path: null, error: new Error('[storage:' + name + '] a non-empty string key is required (got: ' + JSON.stringify(key) + ')') };
        }
        // 1. Security boundary, first so it is genuinely exercised.
        var full = util.confineToBase(nodePath.join(root, key), root);
        if ( full === null ) {
            // Deliberately does NOT echo the resolved path — that would confirm
            // filesystem layout to whoever supplied the hostile key.
            return { path: null, error: new Error('[storage:' + name + '] key `' + key + '` escapes the driver root') };
        }
        // 2. Canonical form, so key and path stay 1:1.
        if ( nodePath.normalize(key) !== key || nodePath.isAbsolute(key) ) {
            return { path: null, error: new Error('[storage:' + name + '] key `' + key + '` is not in canonical form') };
        }
        // 3. Driver-internal paths, reachable without ever leaving the root.
        if ( hasReservedSegment(key) ) {
            return { path: null, error: new Error('[storage:' + name + '] key `' + key + '` is reserved (segments starting with a dot hold driver-internal state)') };
        }
        return { path: full, error: null };
    };

    return {

        /**
         * Store a readable stream and return its opaque key.
         *
         * Streams to a temp file inside the driver root, then publishes with
         * `rename(2)`. On ANY failure — a source error, a write error, or the
         * size cap being exceeded mid-stream — the temp file is removed and the
         * REAL error is reported: never a fabricated one (the #B223 lesson,
         * where every move failure surfaced as a misleading empty-upload
         * message and masked ENOSPC/EACCES entirely).
         *
         * The reported size is measured from the PUBLISHED file on disk, not
         * from a byte counter read at an event that may still have data queued
         * behind it (the #B142 lesson) and never from the client.
         *
         * @param {object}   stream               - Any readable stream.
         * @param {object}   [meta]               - Client-supplied, untrusted.
         * @param {string}   [meta.originalName]  - Filename; stored verbatim in metadata,
         *                                          and the only source of the path extension.
         * @param {string}   [meta.contentType]   - MIME type; stored verbatim.
         * @param {function} fn                   - `fn(err, {@link StoragePutResult})`.
         * @returns {void}
         *
         * @example
         * driver.put(req, { originalName: 'invoice.pdf' }, function (err, res) {
         *     if (err) { return next(err); }
         *     record.storageKey = res.key;   // opaque — store it, never parse it
         * });
         */
        put: function(stream, meta, fn) {
            if ( typeof meta === 'function' ) { fn = meta; meta = {}; }
            meta = meta || {};
            if ( typeof fn !== 'function' ) {
                throw new Error('[storage:' + name + '] put() requires a callback');
            }
            if ( !stream || typeof stream.pipe !== 'function' ) {
                return fn(new Error('[storage:' + name + '] put() requires a readable stream'));
            }

            var now  = new Date();
            var id   = util.ulid(now.getTime());
            var ext  = util.sanitiseExtension(meta.originalName);
            var day  = now.getUTCFullYear()
                + '/' + ('0' + (now.getUTCMonth() + 1)).slice(-2)
                + '/' + ('0' + now.getUTCDate()).slice(-2);
            var key   = day + '/' + id + ext;
            var final = nodePath.join(root, key);
            var tmpD  = nodePath.join(root, TMP_DIR);
            var tmp   = nodePath.join(tmpD, id + '.tmp');

            try {
                fs.mkdirSync(nodePath.dirname(final), { recursive: true });
                fs.mkdirSync(tmpD, { recursive: true });
            } catch (mkErr) {
                return fn(mkErr);
            }

            var settled = false;
            var written = 0;

            var onError = function(err) {
                if (settled) return;
                settled = true;
                try { stream.destroy(); } catch (_e) {}
                try { ws.destroy(); } catch (_e) {}
                try { if ( fs.existsSync(tmp) ) fs.unlinkSync(tmp); } catch (_e) {}
                fn(( err instanceof Error ) ? err : new Error(String(err)));
            };

            var ws = fs.createWriteStream(tmp);

            // #B143 — armed at creation, never in a later handler: Node does not
            // replay 'error' for a listener attached after the fact, and an
            // unlistened stream 'error' becomes an uncaughtException that takes
            // the bundle down. Both streams need their own; `.pipe()` returns the
            // DESTINATION, so a single chained listener would cover only one.
            ws.on('error', onError);
            stream.on('error', onError);

            stream.on('data', function(chunk) {
                if (settled) return;
                written += chunk.length;
                if ( written > max ) {
                    onError(new Error('[storage:' + name + '] object exceeds maxObjectSize (' + max + ' bytes) — refused'));
                }
            });

            stream.pipe(ws);

            // 'close' also follows 'error' on an autoDestroyed stream, so the
            // settled latch is what keeps a failed write from publishing.
            ws.on('close', function() {
                if (settled) return;

                var size;
                try {
                    // The published-file size is the honest one: it cannot be
                    // ahead of the bytes actually on disk the way an in-flight
                    // counter can.
                    size = fs.statSync(tmp).size;
                    fs.renameSync(tmp, final);
                } catch (err) {
                    return onError(err);
                }

                settled = true;
                metaStore.set(key, {
                    originalName : (typeof meta.originalName === 'string') ? meta.originalName : null,
                    contentType  : (typeof meta.contentType === 'string') ? meta.contentType : null,
                    size         : size,
                    createdAt    : now.getTime()
                }, function(metaErr) {
                    if (metaErr) {
                        // The bytes are published but unindexed. Roll the object
                        // back rather than leave a file `stat()` will deny exists
                        // — a caller that got no key can never reference it.
                        try { fs.unlinkSync(final); } catch (_e) {}
                        return fn(metaErr);
                    }
                    fn(null, {
                        key         : key,
                        size        : size,
                        contentType : (typeof meta.contentType === 'string') ? meta.contentType : null
                    });
                });
            });
        },

        /**
         * Open a readable stream for `key`.
         *
         * Errors (rather than yielding `null`) on an unknown key: a caller
         * asking for bytes has no use for a null stream, and the existence
         * question belongs to `stat()`.
         *
         * @param {string}   key - The opaque storage key.
         * @param {function} fn  - `fn(err, stream)`.
         * @returns {void}
         *
         * @example
         * driver.get(key, function (err, stream) {
         *     if (err) { return self.throwError(404); }
         *     stream.pipe(res);
         * });
         */
        get: function(key, fn) {
            if ( typeof fn !== 'function' ) {
                throw new Error('[storage:' + name + '] get() requires a callback');
            }
            var r = resolvePath(key);
            if ( r.error ) { return fn(r.error); }
            if ( !fs.existsSync(r.path) ) {
                return fn(new Error('[storage:' + name + '] no object for key `' + key + '`'));
            }
            var rs = fs.createReadStream(r.path);
            // Armed before the caller can touch it (#B143) — an fs error after
            // handoff is the caller's, but one raised during open is ours.
            var handed = false;
            rs.on('error', function(err) {
                if (handed) return;
                handed = true;
                fn(err);
            });
            rs.on('open', function() {
                if (handed) return;
                handed = true;
                fn(null, rs);
            });
        },

        /**
         * Metadata for `key`.
         *
         * @param {string}   key - The opaque storage key.
         * @param {function} fn  - `fn(err, meta|null)`; `null` when the key is unknown.
         * @returns {void}
         *
         * @example
         * driver.stat(key, function (err, meta) {
         *     if (!meta) { return self.throwError(404); }
         *     res.setHeader('Content-Type', meta.contentType);
         * });
         */
        stat: function(key, fn) {
            if ( typeof fn !== 'function' ) {
                throw new Error('[storage:' + name + '] stat() requires a callback');
            }
            var r = resolvePath(key);
            if ( r.error ) { return fn(r.error); }
            metaStore.get(key, fn);
        },

        /**
         * Delete the object and its metadata row.
         *
         * @param {string}   key  - The opaque storage key.
         * @param {function} [fn] - `fn(err, existed)`.
         * @returns {void}
         */
        release: function(key, fn) {
            if ( typeof fn !== 'function' ) { fn = function() {}; }
            var r = resolvePath(key);
            if ( r.error ) { return fn(r.error); }

            var existed = false;
            try {
                if ( fs.existsSync(r.path) ) {
                    fs.unlinkSync(r.path);
                    existed = true;
                }
            } catch (err) {
                // ENOENT means a concurrent release won the race, which is the
                // outcome the caller asked for; anything else is a real failure.
                if ( err.code !== 'ENOENT' ) { return fn(err); }
            }
            metaStore.remove(key, function(metaErr, metaExisted) {
                if (metaErr) { return fn(metaErr); }
                fn(null, existed || !!metaExisted);
            });
        },

        /**
         * How to serve `key`.
         *
         * Always `{kind:'path'}` for this adapter. `'inline'` arrives with size
         * tiering and `'url'` with the s3 adapter — which is why callers must
         * branch on `kind` rather than assume a path is always available.
         *
         * @param {string}   key - The opaque storage key.
         * @param {function} fn  - `fn(err, {kind: 'path', path: string})`.
         * @returns {void}
         *
         * @example
         * driver.resolve(key, function (err, r) {
         *     if (err) { return next(err); }
         *     if (r.kind === 'path') { return res.sendFile(r.path); }
         * });
         */
        resolve: function(key, fn) {
            if ( typeof fn !== 'function' ) {
                throw new Error('[storage:' + name + '] resolve() requires a callback');
            }
            var r = resolvePath(key);
            if ( r.error ) { return fn(r.error); }
            if ( !fs.existsSync(r.path) ) {
                return fn(new Error('[storage:' + name + '] no object for key `' + key + '`'));
            }
            fn(null, { kind: 'path', path: r.path });
        },

        /**
         * What this driver can do. Consumers branch on these rather than
         * assuming — every one of them flips to `true` in a later slice.
         *
         * `offload` is `false` and measured, not assumed: no X-Accel /
         * X-Sendfile handling exists anywhere in either engine today, so a
         * caller must stream bytes itself.
         *
         * @type {{offload: boolean, ranges: boolean, dedup: boolean, resumable: boolean, inline: boolean}}
         */
        capabilities: {
            offload   : false,
            ranges    : false,
            dedup     : false,
            resumable : false,
            inline    : false
        },

        /**
         * Release the metadata handle. Teardown and tests only — the runtime
         * never calls it.
         *
         * @returns {void}
         */
        close: function() {
            try { metaStore.close(); } catch (e) { /* already closed */ }
        }
    };
};
