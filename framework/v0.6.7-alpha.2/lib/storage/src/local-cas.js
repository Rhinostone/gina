/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * @module lib/storage/local-cas
 * @description The `local` adapter crossed with the `cas` strategy —
 * content-addressed storage for immutable content (invoices, receipts,
 * anything a client can usefully ask "do you already have this?" about).
 *
 * **The key IS the blob address**: `blobs/<algo>/<aa>/<bb>/<hex>` — the digest
 * algorithm is a path segment, so an algorithm change is ADDITIVE (old blobs
 * stay addressable under their namespace, new writes land under the new one,
 * and dedup correctly does not span the two), while a STRATEGY change on
 * populated storage remains a re-key migration. Two `put()`s of identical
 * bytes return the SAME key with the reference count at 2 — that is the dedup.
 * Keys are extension-less BY CONSTRUCTION: the extension would derive from the
 * untrusted `originalName`, and identical bytes uploaded under different names
 * would then mint different keys, silently breaking dedup — `contentType`
 * lives in the metadata row instead. Keys remain OPAQUE to callers even
 * though they look parseable: `findByDigest()` exists precisely so nobody
 * composes one.
 *
 * **Hashing happens in the same pass as the write** — `hash.update(chunk)`
 * per chunk, never a whole-object buffer, never a re-read of the temp file.
 * SHA-256 by default: hardware-accelerated on every deployment target and two
 * orders of magnitude faster than the network that feeds the write path, with
 * zero dependencies (`node:crypto`). The configured name is validated against
 * the RUNTIME's `crypto.getHashes()` at boot — measured 2026-08-13: `sha256`
 * and `sha512` exist on both supported runtimes, `blake2b512` is Node-only.
 *
 * **`release()` drops a reference; the GC sweep deletes.** Deletion is never
 * synchronous: a blob whose count reaches 0 is stamped with the time it got
 * there and lingers for the grace window, so re-uploading just-released
 * content is free (`acquireRef` resurrects the row and clears the stamp). The
 * sweep claims a blob by deleting its row FIRST (`removeIfZero` — a guarded
 * delete a concurrent resurrection always beats) and unlinks the file second:
 * the inverse order could lose bytes under a racing dedup-hit `put()`, while
 * this order's crash window merely orphans an UNREFERENCED file — harmless,
 * and scrubbing belongs to the future `storage:verify` CLI. In-process the
 * race cannot interleave at all: the embedded store is synchronous and so are
 * the sweep's file ops, so acquire→check→publish and claim→unlink each run in
 * one uninterruptible JS turn. Across processes (a future async connector
 * store) the protocol keeps the grace window + claim-first ordering + the
 * heal path, and the store contract documents the residual.
 *
 * **Durability (`fsync: true`, the cas default).** The temp file is fsynced
 * BEFORE `rename(2)` publishes it, and the parent directory is fsynced after
 * — without the directory flush, the rename's directory entry is not durable
 * across power loss even though the file's bytes are. The directory half is
 * BEST-EFFORT: platforms and filesystems that cannot fsync a directory
 * (Windows; some network mounts) skip it silently, and macOS honours fsync
 * as the platform defines it (the stronger F_FULLFSYNC barrier would need a
 * native addon, which the framework does not ship). The file half is never
 * skipped while `fsync` is on — its failure fails the `put()`. An INLINE
 * write (below `inlineThreshold`) is one metadata-store transaction, whose
 * durability is the store's (embedded default: SQLite WAL with
 * `synchronous=NORMAL` — a crash can lose the last committed transaction,
 * never a torn row).
 *
 * **Content addressing makes in-place mutation impossible** — editing
 * produces a new blob and a new key. That is correct for legally-immutable
 * documents and wrong for anything with random writes; pick `sharded` there.
 *
 * @example
 * // settings.json — a cas driver for immutable documents
 * // { "storage": { "drivers": { "invoices": {
 * //     "adapter": "local", "strategy": "cas",
 * //     "root": "/var/data/invoices", "maxObjectSize": "50MB"
 * // } } } }
 * var s = gina.storage('invoices');
 * s.put(readStream, { originalName: 'invoice.pdf', contentType: 'application/pdf' },
 *     function (err, res) {
 *         if (err) { return next(err); }
 *         // res => { key, size, contentType, deduplicated }
 *         // identical bytes stored twice => the SAME key, deduplicated: true
 *     });
 */

var fs       = require('fs');
var nodePath = require('path');
var crypto   = require('crypto');
var Readable = require('stream').Readable;

var util = require('./util');

/**
 * Directory holding in-flight temp files, relative to the driver root.
 * Same name as the sharded driver's — one temp namespace per root.
 *
 * @inner
 * @constant
 * @type {string}
 */
var TMP_DIR = '.tmp';

/**
 * Per-tick ceiling on how many zero-reference blobs one sweep collects. A
 * bound, not a config knob: it caps the synchronous work a single timer
 * callback does; anything left over is simply older-first next tick.
 *
 * @inner
 * @constant
 * @type {number}
 */
var SWEEP_BATCH = 100;

/**
 * The metadata-store verbs the cas strategy cannot work without — the
 * refcount half of the {@link StorageMetaStore} contract.
 *
 * @inner
 * @constant
 * @type {string[]}
 */
var REQUIRED_VERBS = ['acquireRef', 'releaseRef', 'listZeroRefs', 'removeIfZero'];

/**
 * A stored object, as returned by the cas `put()`.
 *
 * @typedef  {Object} StorageCasPutResult
 * @property {string}  key          - The opaque storage key. Never parse or compose it.
 * @property {number}  size         - Object size in bytes, measured by this driver as it
 *                                    wrote — never taken from the client.
 * @property {?string} contentType  - The client-supplied MIME type, echoed back untrusted.
 * @property {boolean} deduplicated - `true` when identical content already existed: no new
 *                                    bytes were stored, the existing blob gained a
 *                                    reference. Additive over {@link StoragePutResult} —
 *                                    callers that ignore it see the shared shape.
 */

/**
 * Build a `local` filesystem driver with the `cas` (content-addressed)
 * strategy.
 *
 * Throws — rather than degrading — when `metaStore` lacks the refcount verbs:
 * a cas driver whose store cannot count references would leak every blob
 * forever, which is not a degraded mode but a different (broken) feature.
 * `start()` lets the throw propagate and the boot wiring treats it as fatal,
 * exactly like an unbuildable connector store.
 *
 * @param {string}           name                 - Driver name, used only in error messages.
 * @param {object}           conf                 - Resolved driver configuration (defaults
 *                                                  resolve in `start()`, never here — the
 *                                                  `maxObjectSize` pattern).
 * @param {string}           conf.root            - Absolute driver root. Validated at boot to
 *                                                  be absolute and outside every served tree.
 * @param {number}           conf.maxObjectSize   - Per-object byte ceiling, already parsed.
 * @param {string}           conf.hash            - Digest algorithm (already validated against
 *                                                  `crypto.getHashes()`), e.g. `'sha256'`.
 * @param {boolean}          conf.fsync           - Whether publishes fsync (file hard, parent
 *                                                  dir best-effort).
 * @param {number}           conf.sweepInterval   - GC tick period in ms; `0` disables the
 *                                                  periodic sweep (the startup temp-orphan
 *                                                  sweep still runs).
 * @param {number}           conf.sweepGrace      - How long a blob must sit at zero references
 *                                                  before the sweep may collect it, in ms.
 * @param {number}           [conf.inlineThreshold] - Size-tiering threshold in bytes, already
 *                                                  parsed. Objects strictly under it live
 *                                                  inline in the metadata store; `0`/absent
 *                                                  disables tiering.
 * @param {StorageMetaStore} metaStore            - Metadata backend carrying the refcount
 *                                                  verbs (embedded SQLite by default).
 * @returns {StorageDriver} A ready driver (plus `findByDigest`, cas-only).
 * @throws {Error} When `metaStore` lacks a required refcount verb.
 *
 * @example
 * var driver = createLocalCasDriver('invoices', conf, metaStore);
 */
module.exports = function createLocalCasDriver(name, conf, metaStore) {

    var root    = conf.root;
    var max     = conf.maxObjectSize;
    var algo    = conf.hash;
    var fsyncOn = ( conf.fsync === true );
    var sweepIntervalMs = ( typeof conf.sweepInterval === 'number' && conf.sweepInterval > 0 )
        ? conf.sweepInterval
        : 0;
    var sweepGraceMs = ( typeof conf.sweepGrace === 'number' && conf.sweepGrace > 0 )
        ? conf.sweepGrace
        : 0;
    var inlineThreshold = ( typeof conf.inlineThreshold === 'number' && conf.inlineThreshold > 0 )
        ? conf.inlineThreshold
        : 0;

    // The store capability gate — checked at build time so a cas driver over
    // an incapable store is a boot fatal, never a first-put() TypeError.
    for (var v = 0; v < REQUIRED_VERBS.length; v++) {
        if ( typeof metaStore[REQUIRED_VERBS[v]] !== 'function' ) {
            throw new Error('[storage:' + name + '] the metadata store lacks `' + REQUIRED_VERBS[v] + '()` — the `cas` strategy needs the refcount verbs (the embedded store provides them; a connector store must implement them, see the StorageMetaStore contract)');
        }
    }

    /**
     * Key → confined absolute path. Shared, single-sourced guard sequence —
     * see {@link module:lib/storage/util.makeResolvePath}.
     *
     * @inner
     * @type {function(string): {path: ?string, error: ?Error}}
     */
    var resolvePath = util.makeResolvePath(name, root);

    var tmpD = nodePath.join(root, TMP_DIR);

    /**
     * Compose the blob key for a digest. The ONLY place the key grammar
     * lives: two levels of two hex characters give 65,536 leaf directories —
     * roughly 150 entries each at 10M objects, keeping `readdir` and
     * `creat` off the degraded path on ext4/XFS.
     *
     * @inner
     * @param {string} algoName - Digest algorithm namespace (lowercase).
     * @param {string} hex      - Lowercase hex digest.
     * @returns {string} The blob key.
     */
    var blobKey = function(algoName, hex) {
        return 'blobs/' + algoName + '/' + hex.slice(0, 2) + '/' + hex.slice(2, 4) + '/' + hex;
    };

    /**
     * fsync a file by path — the HARD half of the durability contract: a
     * failure here fails the `put()` (the caller asked for durability and
     * did not get it).
     *
     * @inner
     * @param {string} p - File path.
     * @returns {void}
     */
    var fsyncFile = function(p) {
        var fd = fs.openSync(p, 'r');
        try {
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
    };

    /**
     * fsync a directory — the BEST-EFFORT half: platforms/filesystems that
     * cannot fsync a directory (Windows; some network mounts) throw here,
     * and the publish proceeds — documented in the module header rather
     * than silently implied.
     *
     * @inner
     * @param {string} p - Directory path.
     * @returns {void}
     */
    var fsyncDirBestEffort = function(p) {
        try {
            var fd = fs.openSync(p, 'r');
            try {
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
        } catch (e) {
            // platform cannot fsync a directory — best-effort by contract
        }
    };

    // Startup temp-orphan sweep (age-gated): a crashed put() leaves its temp
    // behind, and nothing else ever removes it. Only temps older than the
    // grace window are touched, so a SIBLING process's in-flight write (the
    // connector-store multi-process shape) is never eaten. Failures never
    // block the build — an unreadable temp dir is the next put()'s problem
    // to report properly.
    if ( sweepGraceMs > 0 ) {
        try {
            if ( fs.existsSync(tmpD) ) {
                var _orphanCutoff = Date.now() - sweepGraceMs;
                var _tmpEntries = fs.readdirSync(tmpD);
                for (var _t = 0; _t < _tmpEntries.length; _t++) {
                    var _tp = nodePath.join(tmpD, _tmpEntries[_t]);
                    try {
                        if ( fs.statSync(_tp).mtimeMs < _orphanCutoff ) {
                            fs.unlinkSync(_tp);
                        }
                    } catch (_e) { /* raced or unreadable — leave it */ }
                }
            }
        } catch (_e) { /* never blocks the build */ }
    }

    /**
     * One GC pass: collect up to {@link SWEEP_BATCH} blobs whose refcount has
     * sat at zero for longer than the grace window.
     *
     * Order is load-bearing: the row is CLAIMED first (`removeIfZero` — a
     * guarded delete a concurrent `acquireRef` resurrection always beats),
     * the file unlinked second. The inverse order can lose bytes: a dedup-hit
     * `put()` between unlink and row-removal would see `created: false`,
     * discard its temp, and leave a live key with no bytes. This order's
     * crash window (row gone, file still there) merely orphans an
     * unreferenced file — invisible to `stat()`/`get()`, reclaimed by the
     * future `storage:verify` scrub, harmless meanwhile. ENOENT on the
     * unlink is normal: inline blobs have no file, and a healed crash residue
     * may already be gone.
     *
     * Exposed as `_sweepOnce` on the driver — a test seam (tests drive the
     * race orderings deterministically), may change without notice.
     *
     * @inner
     * @returns {void}
     */
    var sweepOnce = function() {
        metaStore.listZeroRefs(Date.now() - sweepGraceMs, SWEEP_BATCH, function(listErr, keys) {
            if ( listErr || !keys || !keys.length ) { return; }
            for (var i = 0; i < keys.length; i++) {
                (function(key) {
                    metaStore.removeIfZero(key, function(rmErr, removed) {
                        if ( rmErr || !removed ) { return; }
                        var r = resolvePath(key);
                        if ( !r.path ) { return; } // cannot happen for keys this driver minted
                        try {
                            fs.unlinkSync(r.path);
                        } catch (e) { /* ENOENT — inline blob, or already gone */ }
                    });
                })(keys[i]);
            }
        });
    };

    /**
     * The periodic sweep timer — self-contained and unref'd (the `lib/job`
     * scheduling precedent; `lib/cron` is dormant), so it never holds the
     * process open. Cleared by `close()`.
     *
     * @inner
     * @type {?object}
     */
    var sweepTimer = null;
    if ( sweepIntervalMs > 0 ) {
        sweepTimer = setInterval(sweepOnce, sweepIntervalMs);
        if ( sweepTimer.unref ) { sweepTimer.unref(); }
    }

    return {

        /**
         * Store a readable stream under its content address.
         *
         * The stream is hashed CHUNK BY CHUNK in the same pass as the write —
         * never buffered whole, never re-read. Until `inlineThreshold` bytes
         * arrive the head is buffered in memory (bounded by the threshold
         * plus one chunk); a stream that ends under the threshold publishes
         * as ONE metadata-store transaction carrying the payload. A stream
         * that reaches it spills byte-order-exact into a temp file under the
         * driver root and, once the digest is known, publishes by `rename(2)`
         * — fsynced first when `fsync` is on.
         *
         * The content address is only known at the END, which inverts the
         * sharded driver's key-first shape: `acquireRef` then decides between
         * CREATE (rename the temp in) and DEDUP HIT (discard the temp — the
         * bytes already exist; the blob gains a reference and the stored
         * metadata wins, first-write-wins). A dedup hit whose blob FILE is
         * missing — the sweep's documented crash residue — is HEALED by
         * renaming this put's temp in instead.
         *
         * Failure semantics are the #B223 discipline: the temp is removed,
         * the REAL error reported, and any reference this call took is rolled
         * back, so a caller that got no key never leaves a refcount behind.
         *
         * @param {object}   stream               - Any readable stream.
         * @param {object}   [meta]               - Client-supplied, untrusted.
         * @param {string}   [meta.originalName]  - Filename; stored verbatim in metadata.
         *                                          Unlike `sharded`, it contributes NOTHING
         *                                          to the key — see the module header.
         * @param {string}   [meta.contentType]   - MIME type; stored verbatim.
         * @param {function} fn                   - `fn(err, {@link StorageCasPutResult})`.
         * @returns {void}
         *
         * @example
         * driver.put(req, { originalName: 'invoice.pdf' }, function (err, res) {
         *     if (err) { return next(err); }
         *     record.blobKey = res.key;    // identical bytes => identical key
         *     if (res.deduplicated) { }    // no new bytes were stored
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

            var now    = new Date();
            var tmpId  = util.ulid(now.getTime());
            var tmp    = nodePath.join(tmpD, tmpId + '.tmp');
            var hasher = crypto.createHash(algo);

            var settled = false;
            var written = 0;
            var spilled = false;
            var ws      = null;
            var head    = [];

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
             * Publish under the now-known content address. `inlineBuf` is the
             * whole payload for the inline tier, `null` when the bytes sit in
             * the temp file.
             *
             * @inner
             * @param {string}  hex       - Lowercase hex digest of the full stream.
             * @param {?Buffer} inlineBuf - Payload for the inline tier, else `null`.
             * @param {number}  size      - Byte size, measured by this driver.
             * @returns {void}
             */
            var publish = function(hex, inlineBuf, size) {
                settled = true;
                var key   = blobKey(algo, hex);
                var final = nodePath.join(root, key);
                var contentType = ( typeof meta.contentType === 'string' ) ? meta.contentType : null;
                var storedMeta = {
                    originalName : ( typeof meta.originalName === 'string' ) ? meta.originalName : null,
                    contentType  : contentType,
                    size         : size,
                    createdAt    : now.getTime()
                };
                if ( inlineBuf ) { storedMeta.data = inlineBuf; }

                metaStore.acquireRef(key, storedMeta, function(acqErr, res) {
                    if (acqErr) {
                        if ( !inlineBuf ) { try { if ( fs.existsSync(tmp) ) fs.unlinkSync(tmp); } catch (_e) {} }
                        return fn(acqErr);
                    }

                    if ( res.created ) {
                        if ( inlineBuf ) {
                            // one store transaction WAS the write — nothing on disk
                            return fn(null, { key: key, size: size, contentType: contentType, deduplicated: false });
                        }
                        try {
                            if ( fsyncOn ) { fsyncFile(tmp); }
                            fs.mkdirSync(nodePath.dirname(final), { recursive: true });
                            fs.renameSync(tmp, final);
                            if ( fsyncOn ) { fsyncDirBestEffort(nodePath.dirname(final)); }
                        } catch (pubErr) {
                            // Roll the reference back so a caller that got no key
                            // leaves nothing behind. If a concurrent identical put
                            // has already taken a second reference, removeIfZero
                            // no-ops — and THAT put's heal path installs the bytes.
                            return metaStore.releaseRef(key, function() {
                                metaStore.removeIfZero(key, function() {
                                    try { if ( fs.existsSync(tmp) ) fs.unlinkSync(tmp); } catch (_e) {}
                                    fn(pubErr);
                                });
                            });
                        }
                        return fn(null, { key: key, size: size, contentType: contentType, deduplicated: false });
                    }

                    // Dedup hit — the blob exists and just gained a reference.
                    if ( inlineBuf ) {
                        return fn(null, { key: key, size: size, contentType: contentType, deduplicated: true });
                    }
                    try {
                        if ( !fs.existsSync(final) ) {
                            // heal: the sweep's documented crash residue (row
                            // claimed, file unlinked, crash before row removal —
                            // or rolled-back sibling) — this put has the bytes.
                            if ( fsyncOn ) { fsyncFile(tmp); }
                            fs.mkdirSync(nodePath.dirname(final), { recursive: true });
                            fs.renameSync(tmp, final);
                            if ( fsyncOn ) { fsyncDirBestEffort(nodePath.dirname(final)); }
                        } else {
                            fs.unlinkSync(tmp);
                        }
                    } catch (healErr) {
                        if ( !fs.existsSync(final) ) {
                            // the HEAL failed — the caller would hold a key with
                            // no bytes; undo the reference and report the truth
                            return metaStore.releaseRef(key, function() {
                                try { if ( fs.existsSync(tmp) ) fs.unlinkSync(tmp); } catch (_e) {}
                                fn(healErr);
                            });
                        }
                        // the discard-unlink failed but the blob is intact —
                        // an orphaned temp the age-gated sweep reclaims
                    }
                    fn(null, { key: key, size: size, contentType: contentType, deduplicated: true });
                });
            };

            /**
             * Cross over to the file tree: create the temp dir (deferred while
             * the object could still land inline), open the temp write stream,
             * flush the buffered head, hand delivery to pipe().
             *
             * @inner
             * @returns {void}
             */
            var spill = function() {
                spilled = true;
                try {
                    fs.mkdirSync(tmpD, { recursive: true });
                } catch (mkErr) {
                    return onError(mkErr);
                }

                ws = fs.createWriteStream(tmp);

                // #B143 — armed at creation, never in a later handler; both
                // streams need their own (`.pipe()` returns the destination).
                ws.on('error', onError);

                ws.on('close', function() {
                    if (settled) return;
                    var size;
                    try {
                        // the published-file size is the honest one — never an
                        // in-flight counter (#B142)
                        size = fs.statSync(tmp).size;
                    } catch (err) {
                        return onError(err);
                    }
                    publish(hasher.digest('hex'), null, size);
                });

                // head queued before pipe() attaches; both feed one FIFO — the
                // crossing is byte-order-exact, and the hash saw every chunk in
                // the same order.
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
                // the same pass as the write — every chunk, both tiers
                hasher.update(chunk);
                if (spilled) return; // pipe() owns delivery from here
                head.push(chunk);
                if ( written >= inlineThreshold ) {
                    spill();
                }
            });

            stream.on('end', function() {
                if (settled || spilled) return;
                var buf = Buffer.concat(head);
                head = null;
                publish(hasher.digest('hex'), buf, buf.length);
            });

            if ( inlineThreshold === 0 ) {
                spill();
            }
        },

        /**
         * Open a readable stream for `key`.
         *
         * A key whose reference count has reached 0 answers exactly like a
         * missing one: the release already happened, and the grace window the
         * row spends awaiting the sweep is a GC implementation detail, not a
         * caller-visible afterlife.
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
            metaStore.get(key, function(metaErr, m) {
                if (metaErr) { return fn(metaErr); }
                if ( !m || ( typeof m.refs === 'number' && m.refs < 1 ) ) {
                    return fn(new Error('[storage:' + name + '] no object for key `' + key + '`'));
                }
                if ( m.data != null ) {
                    // NB: the buffer must be wrapped in an array —
                    // Readable.from(buffer) would iterate it as INTEGERS.
                    return fn(null, Readable.from([m.data]));
                }
                if ( !fs.existsSync(r.path) ) {
                    return fn(new Error('[storage:' + name + '] no object for key `' + key + '`'));
                }
                var rs = fs.createReadStream(r.path);
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
         * Metadata for `key` — `null` for a missing OR fully-released key.
         *
         * Includes `refs`, the live reference count: the honest instrument
         * for "how many holders does this content have", and what the dedup
         * test asserts. The payload is stripped as everywhere else.
         *
         * @param {string}   key - The opaque storage key.
         * @param {function} fn  - `fn(err, meta|null)` — `meta` is
         *                         `{originalName, contentType, size, createdAt, refs}`.
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
                if ( !m || ( typeof m.refs === 'number' && m.refs < 1 ) ) { return fn(null, null); }
                fn(null, {
                    originalName : m.originalName,
                    contentType  : m.contentType,
                    size         : m.size,
                    createdAt    : m.createdAt,
                    refs         : ( typeof m.refs === 'number' ) ? m.refs : null
                });
            });
        },

        /**
         * Drop one reference on `key`. The BYTES are not touched here —
         * deletion is never synchronous: the GC sweep collects blobs whose
         * count has sat at zero for longer than the grace window, which is
         * what makes re-uploading just-released content free.
         *
         * `existed` is `true` when a reference was actually dropped; a
         * second release of the same reference answers `false`, the same
         * idempotency shape as the sharded driver.
         *
         * @param {string}   key  - The opaque storage key.
         * @param {function} [fn] - `fn(err, existed)`.
         * @returns {void}
         */
        release: function(key, fn) {
            if ( typeof fn !== 'function' ) { fn = function() {}; }
            var r = resolvePath(key);
            if ( r.error ) { return fn(r.error); }
            metaStore.releaseRef(key, function(err, res) {
                if (err) { return fn(err); }
                fn(null, res.existed);
            });
        },

        /**
         * How to serve `key` — `{kind:'path'}` for a file-backed blob,
         * `{kind:'inline'}` for a size-tiered one (bytes via `get()`).
         *
         * @param {string}   key - The opaque storage key.
         * @param {function} fn  - `fn(err, {kind: 'path', path: string} | {kind: 'inline'})`.
         * @returns {void}
         */
        resolve: function(key, fn) {
            if ( typeof fn !== 'function' ) {
                throw new Error('[storage:' + name + '] resolve() requires a callback');
            }
            var r = resolvePath(key);
            if ( r.error ) { return fn(r.error); }
            metaStore.get(key, function(metaErr, m) {
                if (metaErr) { return fn(metaErr); }
                if ( !m || ( typeof m.refs === 'number' && m.refs < 1 ) ) {
                    return fn(new Error('[storage:' + name + '] no object for key `' + key + '`'));
                }
                if ( m.data != null ) {
                    return fn(null, { kind: 'inline' });
                }
                if ( !fs.existsSync(r.path) ) {
                    return fn(new Error('[storage:' + name + '] no object for key `' + key + '`'));
                }
                fn(null, { kind: 'path', path: r.path });
            });
        },

        /**
         * The pre-upload existence check: does content with this digest
         * already exist? Answers the KEY when it does (so the caller stores a
         * reference without transferring the bytes — after taking one with
         * `put()` or an app-level accounting of its own), `null` when it does
         * not. This is the ONLY sanctioned way to go from a digest to a key —
         * keys stay opaque; composing one by hand breaks the moment the
         * layout changes.
         *
         * `algo` selects the digest NAMESPACE and may name a former driver
         * algorithm — after a `hash` config change, old-namespace blobs stay
         * findable under their own algorithm, and dedup correctly does not
         * span namespaces.
         *
         * **This is a dedup oracle — treat it as sensitive.** A caller who
         * can query it learns whether ANYONE already stored an exact file
         * ("has this document been uploaded before?"), which across users is
         * an information leak. The framework ships NO HTTP endpoint for it:
         * a consumer exposing one owns authentication, and should scope what
         * it reveals per driver (a single-tenant invoice store leaks nothing;
         * a shared upload pool does).
         *
         * cas-only, capability-gated: consumers branch on
         * `capabilities.dedup` rather than probing for the method.
         *
         * @param {string}   algo      - Digest algorithm namespace, e.g. `'sha256'`.
         * @param {string}   hexDigest - The content digest, hex-encoded (case-insensitive).
         * @param {function} fn        - `fn(err, key|null)`.
         * @returns {void}
         *
         * @example
         * // client sent the sha256 of a file it wants to upload
         * driver.findByDigest('sha256', clientHex, function (err, key) {
         *     if (err) { return next(err); }
         *     if (key) { }  // already stored — skip the transfer
         * });
         */
        findByDigest: function(algo_, hexDigest, fn) {
            if ( typeof fn !== 'function' ) {
                throw new Error('[storage:' + name + '] findByDigest() requires a callback');
            }
            if ( typeof algo_ !== 'string' || !/^[a-z0-9-]{2,32}$/i.test(algo_) ) {
                return fn(new Error('[storage:' + name + '] findByDigest() needs a digest algorithm name (got: ' + JSON.stringify(algo_) + ')'));
            }
            if ( typeof hexDigest !== 'string' || !/^[0-9a-f]{32,128}$/i.test(hexDigest) ) {
                return fn(new Error('[storage:' + name + '] findByDigest() needs a hex-encoded digest (got: ' + JSON.stringify(hexDigest) + ')'));
            }
            var key = blobKey(algo_.toLowerCase(), hexDigest.toLowerCase());
            metaStore.get(key, function(err, m) {
                if (err) { return fn(err); }
                if ( !m || ( typeof m.refs === 'number' && m.refs < 1 ) ) { return fn(null, null); }
                fn(null, key);
            });
        },

        /**
         * What this driver can do. `dedup` is the cas flag — it is what
         * gates `findByDigest`. `inline` is conf-dependent, as under
         * `sharded`. The rest stay `false` until their slice ships.
         *
         * @type {{offload: boolean, ranges: boolean, dedup: boolean, resumable: boolean, inline: boolean}}
         */
        capabilities: {
            offload   : false,
            ranges    : false,
            dedup     : true,
            resumable : false,
            inline    : ( inlineThreshold > 0 )
        },

        /**
         * Stop the GC timer and release the metadata handle. Teardown and
         * tests only — the runtime never calls it.
         *
         * @returns {void}
         */
        close: function() {
            if ( sweepTimer ) {
                clearInterval(sweepTimer);
                sweepTimer = null;
            }
            try { metaStore.close(); } catch (e) { /* already closed */ }
        },

        // test seam — drives one GC pass deterministically; may change
        // without notice
        _sweepOnce: sweepOnce
    };
};
