/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * @module lib/storage
 * @description Pluggable object storage (#STO1) — an **adapter** (where bytes
 * live) crossed with a **strategy** (how keys are laid out), behind one
 * callback-shaped contract. Slice 0 ships the `local` adapter and the `sharded`
 * strategy; `cas`, `stream`, `s3` and size tiering arrive with the demand that
 * needs them, each capability-gated.
 *
 * **Keys are opaque.** A caller stores a stream and receives a key; it must
 * never parse, compose or assume anything about that key's shape. That is what
 * lets a later strategy change the layout without breaking a consumer.
 *
 * **Framework independence — a hard structural rule.** This module must not
 * require gina core (`core/*`), the `lib` registry, or the injected globals
 * (`_()`, `getContext()`, `getConfig()`). Everything it needs about the
 * surrounding bundle — notably the web-served roots the boot check refuses to
 * sit under — is INJECTED by the caller. `test/lib/storage-import-boundary.test.js`
 * enforces it. Consequences worth knowing rather than rediscovering: the
 * traversal guard and the size parser in `src/util` are lib-local copies (the
 * engine copies are closure-private inside `core/server.js`), and the id
 * generator is inline rather than a `lib/uuid` import.
 *
 * **Not to be confused with the browser `gina/storage` plugin**, which is an
 * AMD-only localStorage pseudo-ORM with zero server-side presence. This module
 * is server-side only.
 *
 * **Durability, stated rather than implied.** A write is published by
 * `rename(2)`, which is atomic — a reader never observes a partial object. It
 * is NOT fsynced: nothing in this codebase fsyncs, and on a host crash an
 * acknowledged write can still be lost. The same disclosure `lib/audit` makes
 * about its own tail.
 *
 * @example
 * // settings.json
 * // {
 * //   "storage": {
 * //     "default": "assets",
 * //     "drivers": {
 * //       "assets": {
 * //         "adapter": "local", "strategy": "sharded",
 * //         "root": "/var/data/assets", "maxObjectSize": "50MB"
 * //       }
 * //     }
 * //   }
 * // }
 * var s = gna.storage();               // the `default` driver
 * s.put(readStream, { originalName: 'invoice.pdf', contentType: 'application/pdf' },
 *     function (err, res) {
 *         if (err) { return next(err); }
 *         // res => { key, size, contentType }
 *     });
 *
 * @example
 * // an unconfigured bundle throws rather than returning undefined
 * gna.storage();   // Error: [storage] not configured — add a `storage` block to settings.json
 */

var nodePath = require('path');

/**
 * Pure shared helpers — id generation, path confinement, size parsing and
 * extension sanitisation. A separate module so the adapter can use them
 * without requiring this core back (which would be a cycle).
 *
 * @inner
 * @type {object}
 */
var util = require('./util');

/**
 * The `local` adapter / `sharded` strategy pair. Required by RELATIVE path
 * rather than through the `lib` registry, both because of the framework-
 * independence rule above and because the registry literal evaluates
 * top-to-bottom (a module reading `lib.X` at module scope depends on
 * registration order — the `lib/job` → `lib/uuid` precedent).
 *
 * @inner
 * @type {function(string, object, object): StorageDriver}
 */
var createLocalDriver = require('./local');

/**
 * Embedded SQLite metadata store factory — the default backend when a driver
 * names no connector `store`.
 *
 * @inner
 * @type {function(string): StorageMetaStore}
 */
var createEmbeddedMetaStore = require('./meta-store');

/**
 * Adapters implemented today. An unknown adapter is a boot FATAL rather than a
 * warn: unlike a cache strategy (whose fallback is simply "not cached"), a
 * storage driver that cannot be built has no safe degraded mode — silently
 * dropping it would leave `put()` writing nowhere.
 *
 * @inner
 * @constant
 * @type {string[]}
 */
var ADAPTERS = ['local'];

/**
 * Strategies implemented today.
 *
 * @inner
 * @constant
 * @type {string[]}
 */
var STRATEGIES = ['sharded'];

/**
 * Strategies named in the design but not yet implemented. Kept distinct from
 * "unknown" so the boot message can say *deferred* instead of *typo* — an
 * operator who wrote `cas` made a scheduling mistake, not a spelling one.
 *
 * @inner
 * @constant
 * @type {string[]}
 */
var DEFERRED_STRATEGIES = ['cas', 'stream'];

/**
 * Per-driver keys the `sharded` strategy consumes. Anything else in a driver
 * block is reported as ignored (the render-cache "named loudly" precedent — a
 * silently-dropped key reads as configured behaviour that never happens).
 *
 * @inner
 * @constant
 * @type {string[]}
 */
var SHARDED_KEYS = ['adapter', 'strategy', 'root', 'maxObjectSize', 'store'];

/**
 * Default per-object byte ceiling when a driver sets no `maxObjectSize`.
 * Defense in depth only: no per-file cap exists anywhere upstream today (the
 * multipart layer caps the whole REQUEST, not an individual part).
 *
 * @inner
 * @constant
 * @type {number}
 */
var DEFAULT_MAX_OBJECT_SIZE = 100 * 1024 * 1024;

/**
 * Built drivers, keyed by name. `null` until {@link start} runs — deliberately
 * NOT built at require time, because `test/lib/types-runtime-parity.test.js`
 * requires the whole `lib` registry in-process and any require-time I/O here
 * would red a test that points nowhere near this module.
 *
 * @inner
 * @type {?Object.<string, StorageDriver>}
 */
var _drivers = null;

/**
 * Name of the driver returned by a no-argument {@link get}.
 *
 * @inner
 * @type {?string}
 */
var _default = null;

/**
 * Validate a `settings.json` `storage` block.
 *
 * **Pure and enable-agnostic**, following the `lib/render-cache` precedent
 * exactly: it lints every shape unconditionally and reports what it found. It
 * does NOT decide whether to abort — the caller owns that, and owns the
 * "downgrade a fatal to a loud warn while the feature is off" behaviour. Both
 * halves being in one place is what makes this testable without a boot.
 *
 * FATAL (the boot must refuse — a storage layer that cannot build has no safe
 * degraded mode):
 *   - a non-object `storage` block, or a non-object `drivers` map;
 *   - `default` naming a driver that does not exist;
 *   - an unknown or not-yet-implemented `adapter` / `strategy`;
 *   - a missing, relative, or `${...}`-unresolved driver `root`;
 *   - a `root` that sits inside a web-served directory (review C6b) — an
 *     object store under the public tree is directly fetchable, and so is the
 *     metadata DB that sits inside it;
 *   - a group binding (#STO1 slice 1) naming a driver that does not exist —
 *     including ANY binding when no `storage`/`drivers` block is configured:
 *     a driver-routed upload group is configured behaviour that can otherwise
 *     never happen.
 *
 * WARN (the driver still builds):
 *   - a `maxObjectSize` that is not a unit-suffixed string — the default cap
 *     applies;
 *   - driver keys the selected strategy does not consume — they are ignored,
 *     and a silently-ignored key reads as configured behaviour that never
 *     happens;
 *   - a binding whose staging `path` sits inside its driver's root — legal to
 *     combine (`path` is only the parse-time staging dir for a routed group),
 *     but staging inside the store tree strands files no key references.
 *
 * @memberof module:lib/storage
 * @param {object}   storageBlock          - The `settings.json` `storage` block.
 * @param {object}   [context]             - Caller-supplied boot context.
 * @param {string[]} [context.servedRoots] - Absolute web-served directories (each bundle's
 *                                           `publicPath` plus any `content.statics` target).
 *                                           INJECTED rather than read, per the framework-
 *                                           independence rule. Omitting it disables only the
 *                                           served-root check; every other check is unchanged.
 * @param {object[]} [context.groupBindings] - Upload-group → driver bindings as NEUTRAL
 *                                           tuples `{owner, driver, path}` (#STO1 slice 1):
 *                                           `owner` labels the config site for messages,
 *                                           `driver` names the required driver, `path` is
 *                                           the group's staging dir or `null`. The caller
 *                                           maps its own config shape into these — this
 *                                           module never reads gina config.
 * @returns {{fatal: ?string, warnings: string[], driverCount: number}} Never throws.
 *
 * @example
 * var v = storage.validateConfig(settings.storage, { servedRoots: roots });
 * v.warnings.forEach(function (w) { console.warn('[storage] ' + w); });
 * if (v.fatal) { console.emerg('[storage] ' + v.fatal); process.exit(1); }
 *
 * @example
 * // no storage block at all is valid — the feature is simply off
 * storage.validateConfig(undefined); // => { fatal: null, warnings: [], driverCount: 0 }
 */
function validateConfig(storageBlock, context) {
    var out = { fatal: null, warnings: [], driverCount: 0 };

    // #STO1 slice 1 — upload-group → driver binding tuples, injected by the
    // caller as NEUTRAL data (owner label / driver name / staging path) so this
    // module never learns the gina config shape.
    var bindings = ( context && Array.isArray(context.groupBindings) ) ? context.groupBindings : [];

    if ( typeof(storageBlock) == 'undefined' || storageBlock === null ) {
        if ( bindings.length ) {
            // a binding without a storage layer is configured behaviour that
            // can never happen — the same fail-fast class as an unknown adapter
            out.fatal = '`' + bindings[0].owner + '` names storage driver `' + bindings[0].driver + '`, but there is no `storage` block — a driver-routed upload group cannot work without the storage layer';
            return out;
        }
        return out; // not configured — the feature is off, which is not an error
    }
    if ( typeof(storageBlock) != 'object' || Array.isArray(storageBlock) ) {
        out.fatal = '`settings.json > storage` must be an object — got ' + JSON.stringify(storageBlock);
        return out;
    }

    var drivers = storageBlock.drivers;
    if ( typeof(drivers) == 'undefined' || drivers === null ) {
        if ( bindings.length ) {
            out.fatal = '`' + bindings[0].owner + '` names storage driver `' + bindings[0].driver + '`, but `storage` declares no `drivers`';
            return out;
        }
        out.warnings.push('`storage` is declared but has no `drivers` — no storage driver will be available');
        return out;
    }
    if ( typeof(drivers) != 'object' || Array.isArray(drivers) ) {
        out.fatal = '`settings.json > storage.drivers` must be an object keyed by driver name';
        return out;
    }

    var names = Object.keys(drivers);
    out.driverCount = names.length;

    if ( typeof(storageBlock.default) != 'undefined' ) {
        if ( typeof(storageBlock.default) != 'string' || storageBlock.default.length === 0 ) {
            out.fatal = '`storage.default` must be a non-empty driver name';
            return out;
        }
        if ( names.indexOf(storageBlock.default) < 0 ) {
            out.fatal = '`storage.default` names `' + storageBlock.default + '`, which is not defined in `storage.drivers` (defined: ' + (names.length ? names.join(', ') : 'none') + ')';
            return out;
        }
    }

    var servedRoots = ( context && Array.isArray(context.servedRoots) ) ? context.servedRoots : [];

    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var d    = drivers[name];

        if ( !d || typeof(d) != 'object' || Array.isArray(d) ) {
            out.fatal = 'driver `' + name + '` must be an object';
            return out;
        }

        if ( ADAPTERS.indexOf(d.adapter) < 0 ) {
            out.fatal = 'driver `' + name + '`: unknown adapter ' + JSON.stringify(d.adapter) + ' (expected ' + ADAPTERS.join('|') + ')';
            return out;
        }

        if ( DEFERRED_STRATEGIES.indexOf(d.strategy) > -1 ) {
            out.fatal = 'driver `' + name + '`: the `' + d.strategy + '` strategy is designed but not implemented yet — use `' + STRATEGIES.join('|') + '` for now';
            return out;
        }
        if ( STRATEGIES.indexOf(d.strategy) < 0 ) {
            out.fatal = 'driver `' + name + '`: unknown strategy ' + JSON.stringify(d.strategy) + ' (expected ' + STRATEGIES.join('|') + ')';
            return out;
        }

        if ( typeof(d.root) != 'string' || d.root.length === 0 ) {
            out.fatal = 'driver `' + name + '`: `root` must be a non-empty absolute path';
            return out;
        }
        if ( /\$\{/.test(d.root) ) {
            out.fatal = 'driver `' + name + '`: `root` carries an unresolved `${...}` placeholder (' + d.root + ') — only the anchored `${secret:KEY}` form is substituted at config load';
            return out;
        }
        if ( !nodePath.isAbsolute(d.root) ) {
            out.fatal = 'driver `' + name + '`: `root` must be absolute (got `' + d.root + '`) — a relative root would resolve against the process cwd, which depends on how the bundle was launched';
            return out;
        }

        // review C6b — a driver root under a web-served dir is directly
        // fetchable, and so is the metadata DB that lives inside it.
        for (var s = 0; s < servedRoots.length; s++) {
            if ( util.confineToBase(d.root, servedRoots[s]) !== null ) {
                out.fatal = 'driver `' + name + '`: `root` (' + d.root + ') sits inside the web-served directory ' + servedRoots[s] + ' — stored objects would be publicly fetchable without passing any authorization, and so would the driver metadata database. Move the root outside every served tree.';
                return out;
            }
        }

        if ( typeof(d.store) != 'undefined' && d.store !== null ) {
            if ( typeof(d.store) != 'string' || d.store.length === 0 ) {
                out.fatal = 'driver `' + name + '`: `store` must be a non-empty connectors.json entry name';
                return out;
            }
        }

        if ( typeof(d.maxObjectSize) != 'undefined' && d.maxObjectSize !== null ) {
            if ( isNaN(util.parseSize(d.maxObjectSize)) ) {
                out.warnings.push('driver `' + name + '`: `maxObjectSize` must carry a unit (B/KB/MB/GB, e.g. "50MB") — got ' + JSON.stringify(d.maxObjectSize) + '; using the default (' + DEFAULT_MAX_OBJECT_SIZE + ' bytes)');
            } else if ( util.parseSize(d.maxObjectSize) <= 0 ) {
                out.warnings.push('driver `' + name + '`: `maxObjectSize` must be greater than zero — got ' + JSON.stringify(d.maxObjectSize) + '; using the default (' + DEFAULT_MAX_OBJECT_SIZE + ' bytes)');
            }
        }

        var extra = Object.keys(d).filter(function (k) { return SHARDED_KEYS.indexOf(k) < 0; });
        if ( extra.length > 0 ) {
            out.warnings.push('driver `' + name + '`: key(s) ' + extra.join(', ') + ' are not used by the `' + d.strategy + '` strategy and are ignored');
        }
    }

    // #STO1 slice 1 — validate the injected bindings against the driver map.
    // A dangling reference is FATAL (a routed group that can never publish).
    // `path` BESIDE `driver` is legal — for a routed group `path` only sets
    // the parse-time staging dir — but staging INSIDE the driver's root would
    // strand files no storage key references, so that earns a warning.
    for (var b = 0; b < bindings.length; b++) {
        var binding = bindings[b];
        if ( !binding || typeof(binding.driver) != 'string' || binding.driver.length === 0 ) { continue; }
        var bOwner = ( typeof(binding.owner) == 'string' && binding.owner.length ) ? binding.owner : 'an upload group';
        if ( names.indexOf(binding.driver) < 0 ) {
            out.fatal = '`' + bOwner + '` names storage driver `' + binding.driver + '`, which is not defined in `storage.drivers` (defined: ' + (names.length ? names.join(', ') : 'none') + ')';
            return out;
        }
        var bRoot = drivers[binding.driver].root;
        if ( typeof(binding.path) == 'string' && binding.path.length
            && !/\$\{/.test(binding.path)
            && typeof(bRoot) == 'string' && bRoot.length
            && util.confineToBase(binding.path, bRoot) !== null
        ) {
            out.warnings.push('`' + bOwner + '`: `path` (' + binding.path + ') sits inside driver `' + binding.driver + '`\'s root — for a driver-routed group `path` is only the parse-time staging dir, and staging inside the store root leaves stray files no storage key references; point it elsewhere');
        }
    }

    return out;
}

/**
 * Build every configured driver and hold them for {@link get}.
 *
 * Adoption is once-only: a second call is refused with a warning rather than
 * silently rebuilding, because rebuilding would drop the open metadata handles
 * the first build installed (the `lib/job` store-adoption precedent).
 *
 * @memberof module:lib/storage
 * @param {object}  opt                - Boot options.
 * @param {object}  opt.drivers        - The validated `storage.drivers` map.
 * @param {string}  [opt.default]      - Name of the default driver.
 * @param {object}  [opt.stores]       - Pre-built connector metadata stores keyed by driver
 *                                       name (the caller resolves them through
 *                                       `lib/storage-store`). A driver absent from this map
 *                                       gets the embedded SQLite store inside its own root.
 * @returns {boolean} `true` when drivers were built, `false` when the call was refused
 *                    because drivers are already installed. The CALLER reports that —
 *                    this module never logs, so it stays free of `lib/logger` and
 *                    standalone-testable (the framework-independence rule), and operator-
 *                    visible output goes through the framework logger rather than the
 *                    global console, which the shipped log level does not govern.
 * @throws {Error} When a driver cannot be built — the caller treats it as fatal.
 *
 * @example
 * if ( !storage.start({ drivers: conf.drivers, default: conf.default, stores: builtStores }) ) {
 *     console.warn('[storage] drivers are already installed — the call was ignored');
 * }
 */
function start(opt) {
    opt = opt || {};

    if ( _drivers ) {
        return false;
    }

    var drivers = opt.drivers || {};
    var names   = Object.keys(drivers);
    var built   = {};

    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var conf = drivers[name];
        var max  = util.parseSize(conf.maxObjectSize);
        if ( isNaN(max) || max <= 0 ) { max = DEFAULT_MAX_OBJECT_SIZE; }

        // A connector store when one was built for this driver, else the
        // embedded SQLite file inside the driver's own root — self-contained,
        // so moving the root moves its metadata with it, and never web-served
        // because validateConfig refuses a served root.
        var store = ( opt.stores && opt.stores[name] )
            ? opt.stores[name]
            : createEmbeddedMetaStore(nodePath.join(conf.root, '.meta.db'));

        built[name] = createLocalDriver(name, {
            root          : conf.root,
            strategy      : conf.strategy,
            maxObjectSize : max
        }, store);
    }

    _drivers = built;
    _default = ( typeof(opt.default) == 'string' && opt.default.length > 0 ) ? opt.default : null;
    return true;
}

/**
 * Return a built storage driver.
 *
 * Throws rather than returning `undefined` on every failure path, so a
 * misconfiguration surfaces at the call site that caused it instead of as a
 * `TypeError` on the first method access.
 *
 * @memberof module:lib/storage
 * @param {string} [name] - Driver name; omitted returns the `storage.default` driver.
 * @returns {StorageDriver} The driver.
 * @throws {Error} When storage is not configured, when no default is declared and `name`
 *                 was omitted, or when `name` is not a configured driver.
 *
 * @example
 * var s = storage.get();          // the default driver
 * var s = storage.get('assets');  // a named driver
 */
function get(name) {
    if ( !_drivers ) {
        throw new Error('[storage] not configured — add a `storage` block to settings.json (see https://gina.io/docs/guides/storage)');
    }
    if ( typeof(name) == 'undefined' || name === null ) {
        if ( !_default ) {
            throw new Error('[storage] no `storage.default` is declared — call gina.storage(\'<name>\') with one of: ' + Object.keys(_drivers).join(', '));
        }
        name = _default;
    }
    if ( !Object.prototype.hasOwnProperty.call(_drivers, name) ) {
        throw new Error('[storage] no driver `' + name + '` (configured: ' + (Object.keys(_drivers).join(', ') || 'none') + ')');
    }
    return _drivers[name];
}

/**
 * Whether {@link start} has installed drivers.
 *
 * @memberof module:lib/storage
 * @returns {boolean} `true` once drivers are built.
 */
function isStarted() {
    return !!_drivers;
}

/**
 * Release every driver's metadata handle and clear module state.
 *
 * Test/teardown seam — the runtime never calls it. Without it each test file
 * that starts a driver would leak an open SQLite handle for the life of the
 * process (the `lib/job` `reset()` precedent).
 *
 * @memberof module:lib/storage
 * @returns {void}
 */
function reset() {
    if ( _drivers ) {
        var names = Object.keys(_drivers);
        for (var i = 0; i < names.length; i++) {
            try { _drivers[names[i]].close(); } catch (e) { /* already closed */ }
        }
    }
    _drivers = null;
    _default = null;
}

module.exports = {
    validateConfig : validateConfig,
    start          : start,
    get            : get,
    isStarted      : isStarted,
    reset          : reset,
    // test seams — may change without notice
    _ulid                    : util.ulid,
    _parseSize               : util.parseSize,
    _confineToBase           : util.confineToBase,
    _sanitiseExtension       : util.sanitiseExtension,
    _ADAPTERS                : ADAPTERS,
    _STRATEGIES              : STRATEGIES,
    _DEFERRED_STRATEGIES     : DEFERRED_STRATEGIES,
    _DEFAULT_MAX_OBJECT_SIZE : DEFAULT_MAX_OBJECT_SIZE
};
