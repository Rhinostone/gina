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
 * `YYYY/MM/DD/<ulid><ext>`. With size tiering active (`inlineThreshold` > 0,
 * the default), objects strictly under the threshold never touch the
 * filesystem at all: their bytes live inline in the metadata store, under the
 * SAME key shape, and `resolve()` reports them as `{kind:'inline'}`.
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
var Readable = require('stream').Readable;

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
 * @param {number}           [conf.inlineThreshold] - Size-tiering threshold in bytes, already
 *                                               parsed (defaults resolve in `start()`). Objects
 *                                               strictly under it are stored inline in the
 *                                               metadata store; `0`/absent disables tiering.
 * @param {StorageMetaStore} metaStore         - Metadata backend (embedded SQLite by default).
 * @returns {StorageDriver} A ready driver.
 *
 * @example
 * var driver = createLocalDriver('assets', conf, metaStore);
 */
module.exports = function createLocalDriver(name, conf, metaStore) {

    var root = conf.root;
    var max  = conf.maxObjectSize;
    // Size tiering: objects strictly UNDER this many bytes are stored inline
    // in the metadata store; 0 (or absent — defaults resolve in start(), the
    // maxObjectSize pattern) means every object goes to the file tree.
    var inlineThreshold = ( typeof conf.inlineThreshold === 'number' && conf.inlineThreshold > 0 )
        ? conf.inlineThreshold
        : 0;

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
         * With size tiering active, the head of the stream is buffered in
         * memory (bounded by the threshold plus one chunk): a stream that ends
         * strictly under `inlineThreshold` publishes as ONE metadata-store
         * transaction — no temp file, no directories, no filesystem at all —
         * while a stream that reaches the threshold crosses over to the file
         * path below, byte-order-exact.
         *
         * The file path streams to a temp file inside the driver root, then
         * publishes with `rename(2)`. On ANY failure — a source error, a write
         * error, or the size cap being exceeded mid-stream — the temp file is
         * removed and the REAL error is reported: never a fabricated one (the
         * #B223 lesson, where every move failure surfaced as a misleading
         * empty-upload message and masked ENOSPC/EACCES entirely).
         *
         * The reported size is measured from the PUBLISHED file on disk, not
         * from a byte counter read at an event that may still have data queued
         * behind it (the #B142 lesson) and never from the client. An inline
         * object's size is its buffer length — the same bytes the store
         * persists in the same transaction.
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

            var settled = false;
            var written = 0;
            var mkdired = false;
            var spilled = false;
            var ws      = null;
            var head    = [];

            var mkdirs = function() {
                fs.mkdirSync(nodePath.dirname(final), { recursive: true });
                fs.mkdirSync(tmpD, { recursive: true });
                mkdired = true;
            };

            // Tiering off: today's exact sequence — directories up front, a
            // plain early return on failure, then pipe from the first byte.
            if ( inlineThreshold === 0 ) {
                try {
                    mkdirs();
                } catch (mkErr) {
                    return fn(mkErr);
                }
            }

            var onError = function(err) {
                if (settled) return;
                settled = true;
                head = null;
                try { stream.destroy(); } catch (_e) {}
                if (ws) { try { ws.destroy(); } catch (_e) {} }
                try { if ( fs.existsSync(tmp) ) fs.unlinkSync(tmp); } catch (_e) {}
                fn(( err instanceof Error ) ? err : new Error(String(err)));
            };

            /**
             * Cross over to the file tree: create the directories (deferred
             * while the object could still land inline — a pure-inline put
             * touches the filesystem not at all), open the temp write stream,
             * flush whatever head was buffered, and hand delivery to pipe().
             *
             * @inner
             * @returns {void}
             */
            var spill = function() {
                spilled = true;
                if ( !mkdired ) {
                    try {
                        mkdirs();
                    } catch (mkErr) {
                        return onError(mkErr);
                    }
                }

                ws = fs.createWriteStream(tmp);

                // #B143 — armed at creation, never in a later handler: Node does not
                // replay 'error' for a listener attached after the fact, and an
                // unlistened stream 'error' becomes an uncaughtException that takes
                // the bundle down. Both streams need their own; `.pipe()` returns the
                // DESTINATION, so a single chained listener would cover only one.
                ws.on('error', onError);

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

                // The buffered head is queued before pipe() attaches, and both
                // feed the same write stream FIFO — so the crossing is
                // byte-order-exact. pipe() only forwards chunks emitted AFTER
                // it attaches, and the chunk that crossed the threshold was
                // pushed onto the head inside its own 'data' tick.
                if ( head && head.length ) {
                    ws.write(Buffer.concat(head));
                }
                head = null;
                stream.pipe(ws);
            };

            stream.on('error', onError);

            stream.on('data', function(chunk) {
                if (settled) return;
                written += chunk.length;
                if ( written > max ) {
                    return onError(new Error('[storage:' + name + '] object exceeds maxObjectSize (' + max + ' bytes) — refused'));
                }
                if (spilled) return; // pipe() owns delivery from here
                head.push(chunk);
                // Strictly-under inlines: the moment the running total REACHES
                // the threshold the final size cannot be under it, so cross
                // over — including this chunk, via the head flush.
                if ( written >= inlineThreshold ) {
                    spill();
                }
            });

            stream.on('end', function() {
                if (settled || spilled) return;
                // Inline publish: the object never touched the filesystem —
                // one metadata-store transaction IS the write, so there is
                // nothing to roll back on failure.
                var buf = Buffer.concat(head);
                head = null;
                settled = true;
                metaStore.set(key, {
                    originalName : (typeof meta.originalName === 'string') ? meta.originalName : null,
                    contentType  : (typeof meta.contentType === 'string') ? meta.contentType : null,
                    size         : buf.length,
                    createdAt    : now.getTime(),
                    data         : buf
                }, function(metaErr) {
                    if (metaErr) {
                        return fn(metaErr);
                    }
                    fn(null, {
                        key         : key,
                        size        : buf.length,
                        contentType : (typeof meta.contentType === 'string') ? meta.contentType : null
                    });
                });
            });

            if ( inlineThreshold === 0 ) {
                spill();
            }
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
            // Metadata first: an inline row IS the object, and a row without
            // a payload answers exactly like the pre-tiering store did — so a
            // file-backed (or legacy) key falls through to the identical
            // filesystem path below.
            metaStore.get(key, function(metaErr, m) {
                if (metaErr) { return fn(metaErr); }
                if ( m && m.data != null ) {
                    // NB: the buffer must be wrapped in an array —
                    // Readable.from(buffer) would iterate it as INTEGERS.
                    return fn(null, Readable.from([m.data]));
                }
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
            metaStore.get(key, function(err, m) {
                if (err) { return fn(err); }
                if (!m) { return fn(null, null); }
                // The payload is not metadata: an inline row's `data` is
                // stripped so stat() keeps its contracted shape — the
                // existence question and the bytes question stay separate
                // verbs (`resolve()` says where the bytes live).
                fn(null, {
                    originalName : m.originalName,
                    contentType  : m.contentType,
                    size         : m.size,
                    createdAt    : m.createdAt
                });
            });
        },

        /**
         * Delete the object and its metadata row.
         *
         * Handles both tiers with the same code: an inline object has no file
         * (the unlink branch no-ops on a missing path) and its row removal IS
         * the deletion — `existed` comes from whichever side found something.
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
         * `{kind:'path'}` for a file-backed object; `{kind:'inline'}` for a
         * size-tiered one, whose bytes are reached through `get()` — an inline
         * object has no path to hand to a sendfile/X-Accel offload. `'url'`
         * arrives with the s3 adapter. Callers must branch on `kind` rather
         * than assume a path is always available.
         *
         * @param {string}   key - The opaque storage key.
         * @param {function} fn  - `fn(err, {kind: 'path', path: string} | {kind: 'inline'})`.
         * @returns {void}
         *
         * @example
         * driver.resolve(key, function (err, r) {
         *     if (err) { return next(err); }
         *     if (r.kind === 'path') { return res.sendFile(r.path); }
         *     // 'inline' — stream the bytes yourself
         *     driver.get(key, function (err, stream) { stream.pipe(res); });
         * });
         */
        resolve: function(key, fn) {
            if ( typeof fn !== 'function' ) {
                throw new Error('[storage:' + name + '] resolve() requires a callback');
            }
            var r = resolvePath(key);
            if ( r.error ) { return fn(r.error); }
            metaStore.get(key, function(metaErr, m) {
                if (metaErr) { return fn(metaErr); }
                if ( m && m.data != null ) {
                    return fn(null, { kind: 'inline' });
                }
                if ( !fs.existsSync(r.path) ) {
                    return fn(new Error('[storage:' + name + '] no object for key `' + key + '`'));
                }
                fn(null, { kind: 'path', path: r.path });
            });
        },

        /**
         * What this driver can do. Consumers branch on these rather than
         * assuming. `inline` is conf-dependent: `true` when size tiering is
         * active (`inlineThreshold` > 0), meaning `resolve()` may answer
         * `{kind:'inline'}`; the rest flip to `true` in later slices.
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
            inline    : ( inlineThreshold > 0 )
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
