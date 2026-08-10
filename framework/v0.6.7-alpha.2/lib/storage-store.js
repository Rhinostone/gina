/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var fs          = require('fs');

var helpers = require('./../helpers');
var console = require('./logger');

/**
 * @module lib/storage-store
 * @description Thin factory that loads the connector-specific storage metadata
 * store from `<connectorsPath>/<connector>/lib/storage-store.js` and returns a
 * ready store for `lib/storage` — the `lib/job-store` / `lib/audit-store` /
 * `lib/render-cache-store` sibling for the object-storage layer (#STO1).
 *
 * The store holds the per-object metadata row (originalName, contentType,
 * size, createdAt) that backs `stat()`; the object BYTES live in the driver's
 * adapter, never here.
 *
 * Do not call this directly — declare the backend in `config/connectors.json`,
 * point the driver's `settings.json` `storage.drivers.<name>.store` at that
 * entry name, and let `gna.js` wire it at boot (before the first `put()`, since
 * store adoption is once-only).
 *
 * NOTE: no connector ships a storage-store implementation yet — connector
 * backends are demand-gated (the `lib/audit-store` shipping order). Configuring
 * a driver's `store` today therefore refuses the boot with a clear message; the
 * embedded SQLite backend (no `store` key) is the v1 path. That embedded
 * default is documented single-process-per-driver-root: two bundles sharing one
 * root need a connector-backed store, which is exactly what this seam is for.
 */

/**
 * Resolve `connName` against the bundle's `connectors.json` and build the
 * connector-specific storage metadata store.
 *
 * @class StorageStore
 * @constructor
 *
 * @param {string} connName - `connectors.json` entry name (referenced by `settings.json`'s
 *                            `storage.drivers.<name>.store`). The entry's `.connector` field
 *                            selects the implementation (a connector without a
 *                            `lib/storage-store.js` is rejected).
 * @returns {object}        - A `StorageMetaStore` instance (`set/get/remove/close`).
 * @throws {Error}          - When the entry is missing, has no `connector` field, or the
 *                            connector has no storage-store implementation. `gna.js`
 *                            treats a throw as fatal — an explicitly configured store must
 *                            build, never degrade silently to the embedded backend, which
 *                            would put the metadata somewhere the operator did not ask for.
 *
 * @example
 *   // settings.json:    { "storage": { "drivers": { "assets": { "store": "assetsDb" } } } }
 *   // connectors.json:  { "assetsDb": { "connector": "sqlite", "file": "/data/assets-meta.db" } }
 *   var store = new StorageStore('assetsDb'); // done by gna.js at boot
 */
function StorageStore(connName) {

    if (typeof connName !== 'string' || connName.length === 0) {
        throw new Error('[StorageStore] a connectors.json entry name is required (got: ' + JSON.stringify(connName) + ')');
    }

    var ctx                 = getContext()
        , bundle            = ctx.bundle
        , env               = ctx.env
        , conf              = getConfig()[bundle][env]
        // Same resolution as lib/session-store / lib/job-store / lib/audit-store
        // (#B10 fix): conf.connectorsPath is never populated by config.js — use
        // GINA_FRAMEWORK_DIR directly.
        , connectorsPath    = GINA_FRAMEWORK_DIR + '/core/connectors'
        , connConf          = null
        , connector         = null
    ;
    try {
        connConf  = conf.content.connectors[connName];
        connector = connConf.connector;
    } catch (err) {
        throw new Error('[StorageStore] could not resolve `' + connName + '`: check your bundle configuration @config/connectors.json\n' + err.stack);
    }
    if (!connector) {
        throw new Error('[StorageStore] connectors.json entry `' + connName + '` has no `connector` field');
    }

    var filename = _(connectorsPath + '/' + connector + '/lib/storage-store.js', true);

    if ( !fs.existsSync(filename) ) {
        throw new Error('[StorageStore] connector `' + connector + '` has no storage-store implementation (`' + filename + '` is missing)');
    }

    var store = require(filename)(connConf, bundle);
    console.debug('[storage-store] loaded connector=' + connector + ' bundle=' + bundle + ' (entry: ' + connName + ')');
    return store;
};

module.exports = StorageStore;
