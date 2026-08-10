/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * @module lib/storage/meta-store
 * @description The embedded SQLite {@link StorageMetaStore} — the default
 * metadata backend when a driver names no connector `store`.
 *
 * Sibling of `lib/job`'s `createMemoryStore()`: the dispatcher
 * (`lib/storage-store`) resolves CONNECTOR-backed stores, and the default
 * implementation lives here, on the consumer side, exactly as the async-job
 * primitive arranges it.
 *
 * **Single-process per driver root.** SQLite's locking is a known-broken story
 * on a shared network filesystem, so two bundles (or merged-process siblings)
 * pointing at one root with this backend is NOT supported. The supported
 * multi-process answer IS the seam — a connector-backed store. Nothing here
 * enforces that: cross-process discovery is not something the framework has,
 * and a guess would be worse than a documented boundary.
 *
 * Wraps `node:sqlite` (via the shared `lib/sqlite-driver` seam, which also
 * covers Bun). Consumers must not reach for the driver directly.
 *
 * @example
 * var store = createEmbeddedMetaStore('/var/data/assets/.meta.db');
 * store.set('2026/08/10/01J…', { originalName: 'a.pdf', size: 12 }, function (err) {});
 */

var fs       = require('fs');
var nodePath = require('path');

/**
 * The shared SQLite driver seam — `node:sqlite` first, a `bun:sqlite` adapter
 * under Bun. Required by RELATIVE path because the seam documents staying out
 * of the `lib` registry, which is also what keeps this module loadable in a
 * standalone test.
 *
 * This is the ONE framework import `lib/storage` makes, and it is deliberate:
 * the framework-independence rule forbids gina CORE, the registry and the
 * injected globals — not this dependency-free driver seam.
 * `test/lib/storage-import-boundary.test.js` pins the exception so adding a
 * second one has to be a deliberate act.
 *
 * @inner
 * @type {object}
 */
var sqliteDriver = require('./../../sqlite-driver');

/**
 * No-op callback used when a caller omits one.
 * @inner
 * @returns {void}
 */
function noop() {}

/**
 * Per-object metadata as persisted by the store.
 *
 * @typedef  {Object} StorageMeta
 * @property {?string} originalName - Client-supplied filename, verbatim and untrusted. NEVER
 *                                    used to build a path — the key owns the layout.
 * @property {?string} contentType  - Client-supplied MIME type, untrusted.
 * @property {number}  size         - Object size in bytes, measured by the adapter as it
 *                                    wrote (never taken from the client).
 * @property {number}  createdAt    - Epoch ms at publish time.
 */

/**
 * The metadata persistence seam. The embedded SQLite store below is the v1
 * implementation; a connector-backed store (resolved by `lib/storage-store`,
 * demand-gated) implements the same three methods plus `close`.
 *
 * @typedef  {Object} StorageMetaStore
 * @property {function(string, StorageMeta, function=): void} set    - Upsert `meta` under `key`; `fn(err, meta)`. MUST report failure through the callback, never by throwing.
 * @property {function(string, function): void}               get    - Fetch by `key`; `fn(err, meta|null)`.
 * @property {function(string, function=): void}              remove - Delete by `key`; `fn(err, existed)`.
 * @property {function(): void}                               close  - Release the backend handle. NOT called on the request path — provided for teardown and tests.
 */

/**
 * Build the embedded SQLite metadata store for one driver root.
 *
 * Callbacks fire synchronously (`DatabaseSync` is a synchronous driver), so
 * this has the same timing class as `lib/job`'s memory store.
 *
 * @param {string} dbPath - Absolute path to the metadata database file. Its parent
 *                          directory is created when missing.
 * @returns {StorageMetaStore} A ready store.
 * @throws {Error} On a runtime with no SQLite driver, or when the file cannot be opened —
 *                 the caller treats a throw as fatal, because a driver whose metadata
 *                 cannot be written would answer `stat()` with silence.
 *
 * @example
 * var store = createEmbeddedMetaStore('/var/data/assets/.meta.db');
 */
module.exports = function createEmbeddedMetaStore(dbPath) {

    var DatabaseSync;
    try {
        DatabaseSync = sqliteDriver.getDatabaseSync();
    } catch (e) {
        throw new Error('[storage] ' + e.message);
    }

    // The root may not exist yet on a first boot; the DB is inside it.
    var dir = nodePath.dirname(dbPath);
    if ( !fs.existsSync(dir) ) {
        fs.mkdirSync(dir, { recursive: true });
    }

    var db = new DatabaseSync(dbPath);

    // WAL + synchronous=NORMAL — the same trade-off the SQLite job and session
    // stores take: concurrent readers never block the writer, and a crash can
    // lose the last committed transaction but never corrupts the database.
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=NORMAL');

    // Idempotent schema bootstrap. `key` is the opaque storage key; the object
    // BYTES never live here.
    db.exec(
        'CREATE TABLE IF NOT EXISTS objects ('
        + '  key           TEXT    PRIMARY KEY,'
        + '  original_name TEXT,'
        + '  content_type  TEXT,'
        + '  size          INTEGER,'
        + '  created_at    INTEGER NOT NULL'
        + ')'
    );

    // Prepared once — avoids re-parsing SQL on every call.
    var stmtUpsert = db.prepare('INSERT OR REPLACE INTO objects (key, original_name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)');
    var stmtGet    = db.prepare('SELECT original_name, content_type, size, created_at FROM objects WHERE key = ?');
    var stmtDel    = db.prepare('DELETE FROM objects WHERE key = ?');

    return {

        /**
         * Upsert `meta` under `key`.
         *
         * @param {string}      key
         * @param {StorageMeta} meta
         * @param {function}    [fn] - `fn(err, meta)`.
         * @returns {void}
         */
        set: function(key, meta, fn) {
            if (typeof fn !== 'function') fn = noop;
            meta = meta || {};
            try {
                stmtUpsert.run(
                    key,
                    (typeof meta.originalName === 'string') ? meta.originalName : null,
                    (typeof meta.contentType === 'string') ? meta.contentType : null,
                    (typeof meta.size === 'number') ? meta.size : null,
                    (typeof meta.createdAt === 'number') ? meta.createdAt : Date.now()
                );
                fn(null, meta);
            } catch (err) {
                fn(err);
            }
        },

        /**
         * Fetch metadata by `key`.
         *
         * @param {string}   key
         * @param {function} fn - `fn(err, meta|null)`; `null` when the key is unknown.
         * @returns {void}
         */
        get: function(key, fn) {
            if (typeof fn !== 'function') fn = noop;
            var row;
            try {
                row = stmtGet.get(key);
            } catch (err) {
                return fn(err);
            }
            if (!row) return fn(null, null);
            return fn(null, {
                originalName : row.original_name,
                contentType  : row.content_type,
                size         : row.size,
                createdAt    : row.created_at
            });
        },

        /**
         * Delete metadata by `key`.
         *
         * @param {string}   key
         * @param {function} [fn] - `fn(err, existed)`.
         * @returns {void}
         */
        remove: function(key, fn) {
            if (typeof fn !== 'function') fn = noop;
            try {
                var res = stmtDel.run(key);
                fn(null, res.changes > 0);
            } catch (err) {
                fn(err);
            }
        },

        /**
         * Release the underlying file handle.
         *
         * @returns {void}
         */
        close: function() {
            try { db.close(); } catch (e) { /* already closed */ }
        }
    };
};
