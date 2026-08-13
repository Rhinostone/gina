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
 * strategy; the tiering slice adds size tiering (sub-threshold objects live
 * inline in the metadata store — see `inlineThreshold`); the cas slice adds
 * the `cas` strategy (content-addressed, refcounted, GC-swept — see
 * `src/local-cas`); `stream` and `s3` arrive with the demand that needs them,
 * each capability-gated.
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
 * **Durability, stated rather than implied — and it differs BY STRATEGY.** A
 * file-backed write is published by `rename(2)`, which is atomic — a reader
 * never observes a partial object. Under `sharded` it is NOT fsynced: on a
 * host crash an acknowledged write can still be lost (the same disclosure
 * `lib/audit` makes about its own tail). Under `cas` publishes fsync BY
 * DEFAULT (`fsync: true` — the file before the rename, the parent directory
 * best-effort after; see `src/local-cas` for the per-platform honesty),
 * because the strategy exists for immutable/legal content where
 * "acknowledged means durable" is the point. An INLINE write (below
 * `inlineThreshold`) is one metadata-store transaction — under the embedded
 * default that is SQLite WAL with `synchronous=NORMAL`: a crash can lose the
 * last committed transaction but never yields a partial row, which is the
 * same "recent writes at risk, never a torn object" class as the un-fsynced
 * rename path. The flip side is scoped the same way: losing the metadata
 * store loses inline PAYLOADS, not just metadata — file-backed bytes survive
 * an index loss.
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
var crypto   = require('crypto');

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
 * The `local` adapter / `cas` strategy pair — content-addressed storage with
 * refcounts and a GC sweep.
 *
 * @inner
 * @type {function(string, object, object): StorageDriver}
 */
var createLocalCasDriver = require('./local-cas');

/**
 * Strategy name → driver factory. THE dispatch seam: `start()` builds each
 * driver through this map (strategy names are validated before `start()`
 * runs, so a miss here is a programming error, not a config one). Adapters
 * other than `local` will widen this into a two-axis lookup when one ships.
 *
 * @inner
 * @constant
 * @type {Object.<string, function(string, object, object): StorageDriver>}
 */
var FACTORIES = {
    sharded : createLocalDriver,
    cas     : createLocalCasDriver
};

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
var STRATEGIES = ['sharded', 'cas'];

/**
 * Strategies named in the design but not yet implemented. Kept distinct from
 * "unknown" so the boot message can say *deferred* instead of *typo* — an
 * operator who wrote `stream` made a scheduling mistake, not a spelling one.
 *
 * @inner
 * @constant
 * @type {string[]}
 */
var DEFERRED_STRATEGIES = ['stream'];

/**
 * Per-driver keys, BY STRATEGY. Anything else in a driver block is reported
 * as ignored (the render-cache "named loudly" precedent — a silently-dropped
 * key reads as configured behaviour that never happens). Per-strategy rather
 * than one global list because the warning names the driver's strategy: a
 * single list would either warn falsely on another strategy's keys or accept
 * keys the named strategy never reads — both are the exact lie the warning
 * exists to prevent.
 *
 * @inner
 * @constant
 * @type {Object.<string, string[]>}
 */
var STRATEGY_KEYS = {
    sharded : ['adapter', 'strategy', 'root', 'maxObjectSize', 'store', 'inlineThreshold'],
    cas     : ['adapter', 'strategy', 'root', 'maxObjectSize', 'store', 'inlineThreshold', 'hash', 'fsync', 'sweepInterval', 'sweepGrace']
};

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
 * Default size-tiering threshold when a driver sets no `inlineThreshold`:
 * objects strictly UNDER this many bytes are stored inline in the metadata
 * store; at or above it they go to the file tree. `'0B'` disables tiering for
 * a driver.
 *
 * 64KB is the measured knee, not folklore: benchmarked 2026-08-13 on the
 * shipped stack (`lib/sqlite-driver`, WAL, the real temp+rename+meta-row write
 * sequence, sequential puts) — inline wins 10.8–12.9x on put at 1KB, 8.0–8.5x
 * at 4KB, 5.7–6.6x at 16KB, 2.7–3.3x at 64KB, and the win destabilises above
 * (256KB medians straddled 1.0x across runs, p95 dominated by WAL-checkpoint
 * stalls). Measured on APFS/NVMe — the case MOST favourable to the file path,
 * so slower or network filesystems widen the inline win.
 *
 * @inner
 * @constant
 * @type {number}
 */
var DEFAULT_INLINE_THRESHOLD = 64 * 1024;

/**
 * Default digest algorithm for `cas` drivers. SHA-256: hardware-accelerated
 * on every deployment target (SHA-NI, ARMv8 crypto extensions put it around
 * 1.5–2 GB/s per core — two orders of magnitude above the network feeding the
 * write path), zero dependencies, and present in `crypto.getHashes()` on BOTH
 * supported runtimes (measured 2026-08-13: node 25 and bun 1.2.21 — where
 * e.g. `blake2b512` is Node-only). The algorithm is a path segment in every
 * cas key, so changing it is additive, never a re-key.
 *
 * @inner
 * @constant
 * @type {string}
 */
var DEFAULT_CAS_HASH = 'sha256';

/**
 * Whether `cas` publishes fsync by default. `true` — the strategy exists for
 * immutable/legal content, where "acknowledged means durable" is the point.
 * Per-driver `fsync: false` opts out.
 *
 * @inner
 * @constant
 * @type {boolean}
 */
var DEFAULT_CAS_FSYNC = true;

/**
 * Default GC sweep period for `cas` drivers, in ms. REASONED, not
 * benchmarked (unlike the tiering knee above): the sweep gates reclaim
 * latency only — no hot path — so the default just bounds how long
 * zero-reference blobs linger. 15 minutes.
 *
 * @inner
 * @constant
 * @type {number}
 */
var DEFAULT_SWEEP_INTERVAL = 15 * 60 * 1000;

/**
 * Default GC grace window, in ms: how long a blob must sit at zero
 * references before the sweep may collect it. REASONED, not benchmarked:
 * it must comfortably exceed the longest plausible in-flight `put()` (a
 * default-cap 100MB upload on a slow link runs minutes; git's equivalent
 * grace is two weeks), because the grace window is what keeps the sweep
 * from racing a concurrent dedup-hit publish across processes. 1 hour.
 *
 * @inner
 * @constant
 * @type {number}
 */
var DEFAULT_SWEEP_GRACE = 60 * 60 * 1000;

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
 *   - a cas `hash` this runtime's crypto does not provide — the digest is the
 *     content's identity and a path segment in every key, so minting keys
 *     under a different algorithm than configured is not a degraded mode
 *     (NB runtime-scoped: `sha256`/`sha512` exist on both supported runtimes,
 *     `blake2b512` is Node-only — measured 2026-08-13);
 *   - a group binding (#STO1 slice 1) naming a driver that does not exist —
 *     including ANY binding when no `storage`/`drivers` block is configured:
 *     a driver-routed upload group is configured behaviour that can otherwise
 *     never happen.
 *
 * WARN (the driver still builds):
 *   - a `maxObjectSize` that is not a unit-suffixed string — the default cap
 *     applies;
 *   - an `inlineThreshold` that is not a unit-suffixed string — the default
 *     (64KB) applies; `'0B'` is legal and silent (tiering off);
 *   - a cas `fsync` that is not a boolean, a `sweepInterval`/`sweepGrace`
 *     that is not a unit-suffixed duration string, or a zero `sweepGrace`
 *     (which would re-open the sweep-vs-put race) — each falls back to its
 *     default; `'0s'` is legal and silent for `sweepInterval` only (periodic
 *     sweep off);
 *   - driver keys the selected strategy does not consume — they are ignored,
 *     and a silently-ignored key reads as configured behaviour that never
 *     happens (the list is per-strategy: `fsync` is consumed by `cas` and
 *     ignored-with-warning under `sharded`);
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

        // `'0B'` is a legal, silent value — it is the documented way to turn
        // tiering off for a driver, so only an UNPARSEABLE value warns.
        if ( typeof(d.inlineThreshold) != 'undefined' && d.inlineThreshold !== null ) {
            if ( isNaN(util.parseSize(d.inlineThreshold)) ) {
                out.warnings.push('driver `' + name + '`: `inlineThreshold` must carry a unit (B/KB/MB/GB, e.g. "64KB"), or be "0B" to disable size tiering — got ' + JSON.stringify(d.inlineThreshold) + '; using the default (' + DEFAULT_INLINE_THRESHOLD + ' bytes)');
            }
        }

        if ( d.strategy === 'cas' ) {
            // `hash` is FATAL when unusable, never defaulted-around: the
            // digest is the content's identity and a path segment in every
            // key, so silently minting sha256 keys under a config that says
            // otherwise is configured behaviour that never happens — the
            // fail-fast class, not the warn class. The check runs against
            // THIS runtime's OpenSSL capability table: measured 2026-08-13,
            // `sha256`/`sha512` exist on both supported runtimes while
            // `blake2b512` is Node-only — so the same config can be valid on
            // one runtime and fatal on the other, and saying so beats
            // guessing.
            if ( typeof(d.hash) != 'undefined' && d.hash !== null ) {
                if ( typeof(d.hash) != 'string' || d.hash.length === 0 ) {
                    out.fatal = 'driver `' + name + '`: `hash` must be a digest algorithm name (e.g. "sha256")';
                    return out;
                }
                if ( crypto.getHashes().indexOf(d.hash.toLowerCase()) < 0 ) {
                    out.fatal = 'driver `' + name + '`: `hash` names `' + d.hash + '`, which this runtime\'s crypto does not provide — `sha256` (the default) and `sha512` exist on every supported runtime; run crypto.getHashes() for the full local list';
                    return out;
                }
            }

            if ( typeof(d.fsync) != 'undefined' && d.fsync !== null && typeof(d.fsync) != 'boolean' ) {
                out.warnings.push('driver `' + name + '`: `fsync` must be a boolean — got ' + JSON.stringify(d.fsync) + '; using the default (' + DEFAULT_CAS_FSYNC + ')');
            }

            // duration keys mirror the size keys' strictness: a unit is
            // required (`'15m'` means minutes HERE and megabytes in a size
            // key, which is exactly why neither parser guesses).
            if ( typeof(d.sweepInterval) != 'undefined' && d.sweepInterval !== null ) {
                if ( isNaN(util.parseDuration(d.sweepInterval)) ) {
                    out.warnings.push('driver `' + name + '`: `sweepInterval` must carry a unit (ms/s/m/h/d, e.g. "15m"), or be "0s" to disable the periodic sweep — got ' + JSON.stringify(d.sweepInterval) + '; using the default (' + DEFAULT_SWEEP_INTERVAL + ' ms)');
                }
            }
            if ( typeof(d.sweepGrace) != 'undefined' && d.sweepGrace !== null ) {
                if ( isNaN(util.parseDuration(d.sweepGrace)) ) {
                    out.warnings.push('driver `' + name + '`: `sweepGrace` must carry a unit (ms/s/m/h/d, e.g. "1h") — got ' + JSON.stringify(d.sweepGrace) + '; using the default (' + DEFAULT_SWEEP_GRACE + ' ms)');
                } else if ( util.parseDuration(d.sweepGrace) <= 0 ) {
                    // grace 0 would let the sweep race an in-flight identical
                    // put — the exact window the grace exists to close
                    out.warnings.push('driver `' + name + '`: `sweepGrace` must be greater than zero — got ' + JSON.stringify(d.sweepGrace) + '; using the default (' + DEFAULT_SWEEP_GRACE + ' ms)');
                }
            }
        }

        var consumed = STRATEGY_KEYS[d.strategy];
        var extra = Object.keys(d).filter(function (k) { return consumed.indexOf(k) < 0; });
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
 * Resolve one VALIDATED driver block to the concrete configuration a strategy
 * factory consumes — defaults applied, sizes/durations parsed, the cas hash
 * lowercased. Extracted from {@link start} for the `storage:*` CLI (#STO1 CLI
 * slice): the CLI's offline path builds per-bundle drivers OUTSIDE this
 * module's once-only `start()` state, and resolving through ONE shared
 * function is what keeps a CLI-built driver behaviourally identical to the
 * booted one (two copies of default resolution would drift the moment a new
 * strategy key arrives).
 *
 * The input must already have passed {@link validateConfig} — like the
 * FACTORIES lookup, this resolves; it does not re-validate.
 *
 * @inner
 * @param {object} conf - One `storage.drivers.<name>` block (validated).
 * @returns {object} The resolved configuration `start()` hands the strategy factory
 *                   (`root`/`strategy`/`maxObjectSize`/`inlineThreshold`, plus
 *                   `hash`/`fsync`/`sweepInterval`/`sweepGrace` under `cas`).
 */
function resolveDriverConf(conf) {
    var max = util.parseSize(conf.maxObjectSize);
    if ( isNaN(max) || max <= 0 ) { max = DEFAULT_MAX_OBJECT_SIZE; }

    // Size tiering: absent or unparseable resolves to the measured 64KB
    // default; an explicit `'0B'` keeps its zero and disables tiering.
    // Defaults resolve HERE, not in the factory (the maxObjectSize
    // pattern) — a direct factory caller passing no threshold gets
    // tiering off, which is what keeps the adapter's low-level tests
    // pinned to the file path.
    var inline = util.parseSize(conf.inlineThreshold);
    if ( isNaN(inline) || inline < 0 ) { inline = DEFAULT_INLINE_THRESHOLD; }

    var resolved = {
        root            : conf.root,
        strategy        : conf.strategy,
        maxObjectSize   : max,
        inlineThreshold : inline
    };

    // cas defaults resolve here too, same pattern. `hash` was validated
    // against crypto.getHashes() by validateConfig; lowercasing makes the
    // key's algorithm segment canonical.
    if ( conf.strategy === 'cas' ) {
        resolved.hash = ( typeof conf.hash === 'string' && conf.hash.length > 0 )
            ? conf.hash.toLowerCase()
            : DEFAULT_CAS_HASH;
        resolved.fsync = ( typeof conf.fsync === 'boolean' ) ? conf.fsync : DEFAULT_CAS_FSYNC;
        var si = util.parseDuration(conf.sweepInterval);
        resolved.sweepInterval = ( isNaN(si) || si < 0 ) ? DEFAULT_SWEEP_INTERVAL : si; // '0s' is legal: periodic sweep off
        var sg = util.parseDuration(conf.sweepGrace);
        resolved.sweepGrace = ( isNaN(sg) || sg <= 0 ) ? DEFAULT_SWEEP_GRACE : sg;      // 0 grace would re-open the sweep race
    }

    return resolved;
}

/**
 * Build every configured driver and hold them for {@link get}.
 *
 * Adoption is once-only: a second call is refused with a warning rather than
 * silently rebuilding, because rebuilding would drop the open metadata handles
 * the first build installed (the `lib/job` store-adoption precedent).
 *
 * @memberof module:lib/storage
 * @param {object}   opt               - Boot options.
 * @param {object}   opt.drivers       - The validated `storage.drivers` map.
 * @param {string}   [opt.default]     - Name of the default driver.
 * @param {object}   [opt.stores]      - Pre-built connector metadata stores keyed by driver
 *                                       name (the caller resolves them through
 *                                       `lib/storage-store`). A driver absent from this map
 *                                       gets the embedded SQLite store inside its own root.
 * @param {function} [opt.warn]        - Boot-warning sink for the per-root strategy-stamp
 *                                       checks (§4: a strategy flip on populated storage is
 *                                       unrecoverable by config, so it warns every boot; a
 *                                       hash change is additive and warns once). A callback
 *                                       rather than a logger import — the framework-
 *                                       independence rule — and omitted means silent.
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

    // Boot-warning hook — the strategy-stamp checks below surface through it.
    // A CALLBACK rather than a logger import (the framework-independence
    // rule) and rather than a changed return shape (`start()`'s boolean is
    // pinned); the caller decides where warnings go, and a direct caller
    // that passes none simply gets no stamp chatter.
    var warn = ( typeof opt.warn === 'function' ) ? opt.warn : function() {};

    var drivers = opt.drivers || {};
    var names   = Object.keys(drivers);
    var built   = {};

    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var conf = drivers[name];

        // A connector store when one was built for this driver, else the
        // embedded SQLite file inside the driver's own root — self-contained,
        // so moving the root moves its metadata with it, and never web-served
        // because validateConfig refuses a served root.
        var store = ( opt.stores && opt.stores[name] )
            ? opt.stores[name]
            : createEmbeddedMetaStore(nodePath.join(conf.root, '.meta.db'));

        // Defaults, size/duration parsing and the cas hash canonicalisation —
        // ONE shared resolver, also driven by the `storage:*` CLI's offline
        // path (see resolveDriverConf).
        var resolved = resolveDriverConf(conf);

        // THE strategy dispatch — validateConfig has already refused unknown
        // and deferred names, so this lookup cannot miss on a validated boot;
        // a direct caller bypassing validation gets a loud TypeError, which
        // is the fail-fast it asked for. A factory throw (e.g. cas over a
        // store lacking the refcount verbs) propagates to the caller, whose
        // documented contract treats it as fatal.
        built[name] = FACTORIES[conf.strategy](name, resolved, store);

        // §4 — keys are strategy-specific, so a strategy flip on populated
        // storage is unrecoverable by config edit; persist the strategy on
        // the root's own metadata and warn on mismatch, every boot, until it
        // is resolved. Fire-and-forget: with the embedded store it completes
        // synchronously, with a connector store the warning simply lands
        // when it lands — it gates nothing.
        checkDriverStamp(name, conf.strategy, resolved.hash || null, store, warn);
    }

    _drivers = built;
    _default = ( typeof(opt.default) == 'string' && opt.default.length > 0 ) ? opt.default : null;
    return true;
}

/**
 * Verify (or install) the `.driver` strategy stamp on a driver root's
 * metadata store.
 *
 * The stamp is a reserved store row — `.driver` starts with a dot, which the
 * key guards refuse from callers, so it can never collide with an object key
 * — whose payload column carries `{strategy, hash}` as JSON (the store's
 * `data` field is the one binary-safe slot the seam already contracts, so a
 * connector store carries the stamp with zero extra surface).
 *
 * §4's two cases stay proportionate, deliberately:
 *   - a STRATEGY mismatch warns EVERY boot and never restamps — keys are
 *     strategy-specific, so the hazard (objects written under the old layout
 *     are unaddressable under the new one) stands until a re-key migration
 *     resolves it, and silencing it after one notice would hide exactly the
 *     unrecoverable case;
 *   - a HASH change warns ONCE and restamps — it is additive (the algorithm
 *     is a path segment, old blobs stay addressable under their namespace,
 *     dedup correctly does not span the two), so a routine algorithm bump
 *     must not look as expensive as a re-key.
 *
 * A missing stamp is installed silently: a fresh root and a pre-cas root are
 * indistinguishable, and warning on either would cry wolf on every upgrade.
 *
 * @inner
 * @param {string}           name     - Driver name, for messages.
 * @param {string}           strategy - The configured (validated) strategy.
 * @param {?string}          hash     - The resolved digest algorithm (cas), else `null` —
 *                                      a null hash skips the hash comparison entirely.
 * @param {StorageMetaStore} store    - The driver's metadata store.
 * @param {function}         warn     - Boot-warning sink (`opt.warn`, or a no-op).
 * @returns {void}
 */
function checkDriverStamp(name, strategy, hash, store, warn) {
    store.get('.driver', function(err, m) {
        if (err) {
            return warn('driver `' + name + '`: could not read the strategy stamp — ' + (err.message || err));
        }
        if ( !m || m.data == null ) {
            return store.set('.driver', {
                createdAt : Date.now(),
                data      : Buffer.from(JSON.stringify({ strategy: strategy, hash: hash }))
            }, function(setErr) {
                if (setErr) { warn('driver `' + name + '`: could not write the strategy stamp — ' + (setErr.message || setErr)); }
            });
        }
        var stamp;
        try {
            stamp = JSON.parse(m.data.toString('utf8'));
        } catch (parseErr) {
            return warn('driver `' + name + '`: the strategy stamp on this root is unreadable (' + (parseErr.message || parseErr) + ') — leaving it as-is');
        }
        if ( stamp.strategy !== strategy ) {
            return warn('driver `' + name + '`: configured strategy `' + strategy + '` does not match this root\'s stamp (`' + stamp.strategy + '`) — keys are strategy-specific, so objects written under `' + stamp.strategy + '` are NOT addressable under `' + strategy + '`; changing a driver\'s strategy on populated storage requires a re-key migration, not a config edit. This warning repeats each boot while the mismatch stands.');
        }
        if ( hash && stamp.hash && stamp.hash !== hash ) {
            warn('driver `' + name + '`: digest algorithm changed (`' + stamp.hash + '` -> `' + hash + '`) — additive, no migration required: existing blobs stay addressable under their own namespace, new writes land under `' + hash + '`, and dedup does not span the two until content is re-hashed. Stamp updated; this notice does not repeat.');
            store.set('.driver', {
                createdAt : ( typeof m.createdAt === 'number' ) ? m.createdAt : Date.now(),
                data      : Buffer.from(JSON.stringify({ strategy: strategy, hash: hash }))
            }, function(setErr) {
                if (setErr) { warn('driver `' + name + '`: could not update the strategy stamp — ' + (setErr.message || setErr)); }
            });
        }
    });
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
 * Names of the built drivers — the operator surface's enumeration door
 * (`GET /_gina/storage/stats` and the `storage:*` CLI iterate it). Answers
 * `[]` before {@link start} has run (or when storage is unconfigured), so an
 * iterating caller needs no `isStarted()` pre-check.
 *
 * Names only, deliberately: the drivers themselves stay behind {@link get},
 * whose throw-on-unknown contract is what surfaces a typo at the call site.
 *
 * @memberof module:lib/storage
 * @returns {string[]} Driver names, in configuration order.
 *
 * @example
 * lib.storage.list().forEach(function (name) {
 *     lib.storage.get(name).stats(function (err, s) { });
 * });
 */
function list() {
    return _drivers ? Object.keys(_drivers) : [];
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
    list           : list,
    isStarted      : isStarted,
    reset          : reset,
    // test seams — may change without notice. The three #STO1-CLI seams
    // (_resolveDriverConf / _FACTORIES / _createEmbeddedMetaStore) are ALSO
    // the `storage:*` cmd handlers' offline door: the CLI builds per-bundle
    // drivers outside start()'s once-only state, through the exact resolver
    // and factories a boot uses — in-tree consumers, versioned together.
    _resolveDriverConf       : resolveDriverConf,
    _FACTORIES                : FACTORIES,
    _createEmbeddedMetaStore  : createEmbeddedMetaStore,
    _ulid                    : util.ulid,
    _parseSize               : util.parseSize,
    _confineToBase           : util.confineToBase,
    _sanitiseExtension       : util.sanitiseExtension,
    _ADAPTERS                 : ADAPTERS,
    _STRATEGIES               : STRATEGIES,
    _DEFERRED_STRATEGIES      : DEFERRED_STRATEGIES,
    _STRATEGY_KEYS            : STRATEGY_KEYS,
    _DEFAULT_MAX_OBJECT_SIZE  : DEFAULT_MAX_OBJECT_SIZE,
    _DEFAULT_INLINE_THRESHOLD : DEFAULT_INLINE_THRESHOLD,
    _DEFAULT_CAS_HASH         : DEFAULT_CAS_HASH,
    _DEFAULT_CAS_FSYNC        : DEFAULT_CAS_FSYNC,
    _DEFAULT_SWEEP_INTERVAL   : DEFAULT_SWEEP_INTERVAL,
    _DEFAULT_SWEEP_GRACE      : DEFAULT_SWEEP_GRACE,
    _parseDuration            : util.parseDuration
};
