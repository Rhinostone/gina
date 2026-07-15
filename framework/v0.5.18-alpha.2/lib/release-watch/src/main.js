/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

'use strict';

var fs      = require('fs');
var crypto  = require('crypto');

/**
 * @module releaseWatch
 *
 * #RW1 — stale built-release watch primitives.
 *
 * When a bundle serves a BUILT release under local scope + a production env
 * (a local production rehearsal), the process runs in full prod-mode: no
 * hot-reload, render cache on, templates server-cached. After the operator
 * edits source, the bundle silently keeps serving the stale built release.
 * This module provides the building blocks the framework uses to detect and
 * surface that staleness:
 *
 *   - `fingerprintTree()` — a deterministic sha1 fingerprint of a source tree
 *     (`fpSpec` 1: sorted `relpath|size|mtimeMs` lines). `bundle:build` /
 *     `project:build` stamp it into the project manifest release records
 *     (`releases[scope][env].{fingerprint, builtAt, fpSpec}`) at build START,
 *     so a boot-time recompute that differs from the stamp reads as stale.
 *     Stamping at start is deliberate: an edit racing the src → release copy
 *     changes the recompute, never the stamp — fail-safe toward "stale".
 *   - `classify()` / `classifyBatch()` — split changed paths into the
 *     `assets` class (disk-served statics, refreshed by a rebuild alone) and
 *     the `restart` class (server code / templates / config — server-cached
 *     in prod, so a rebuild alone cannot refresh them). Unknown paths
 *     classify as `restart` (fail-safe toward over-restarting).
 *   - `createTreeWatcher()` — a recursive, debounced source-tree watcher
 *     (`fs.watch` `{recursive:true}`, Node >= 20 on darwin/linux) with an
 *     optional slow mtime reconcile sweep for event-lossy mounts, and a
 *     sweep-only mode (`useFsEvents:false`). Distinct from lib/watcher's
 *     WatcherService, whose contract is single-file, non-recursive entries.
 *   - Busy probes — `registerBusyProbe(name, fn)` lets an application report
 *     in-flight background work (e.g. a job runner) so a restart is idle-gated
 *     on more than open HTTP requests. Probe failures and timeouts read as
 *     BUSY (fail-safe toward never killing work; the operator Force overrides).
 *     `registerDefaultProbes()` wires a `jobs` probe over lib/job stats.
 *   - The in-flight request gauge — `trackRequest(url)` returns an idempotent
 *     finisher, so wiring it to both `response.on('finish')` and
 *     `response.on('close')` can never double-decrement. `/_gina/*` control
 *     paths are excluded by design: an open SSE stream never fires `finish`
 *     (see lib/proc.js's SIGTERM drain comment), so counting the release-watch
 *     SSE/status connections themselves would deadlock the idle gate forever.
 *
 * Module-singleton: registered in lib/index.js via a PLAIN require (not the
 * dev-mode cache-busting `_require`) so watcher handles, the probe registry
 * and the in-flight gauge survive `refreshCore()`'s per-request `Lib()`
 * rebuild — same discipline as lib/job, lib/instrument and lib/state.
 *
 * All timers this module arms are `unref()`'d and every `fs.watch` handle is
 * created with `persistent:false` — the module can never keep a process (or a
 * test file) alive on its own.
 *
 * @package gina.framework
 * @namespace releaseWatch
 * @author Rhinostone <contact@gina.io>
 */

/**
 * Fingerprint spec version. Bump when the fingerprint algorithm changes so a
 * stamp produced by an older spec is never compared against a newer recompute.
 * Spec 1: sha1 over the sorted `relpath|size|floor(mtimeMs)` lines of every
 * regular file in the tree (symlinks skipped, ignored segments pruned).
 * @constant {number}
 */
var FP_SPEC = 1;

/**
 * Path segments pruned from fingerprints, reconcile sweeps and watch events.
 * Segment-name match — any path containing one of these as a component is
 * ignored wherever it appears in the tree.
 * @constant {string[]}
 */
var DEFAULT_IGNORE = [ 'node_modules', '.git', '.DS_Store', 'logs', 'tmp' ];

/**
 * Default debounce window for watcher change batches, in ms.
 * @constant {number}
 */
var DEFAULT_DEBOUNCE_MS = 750;

/**
 * Default per-probe deadline, in ms. A probe that has not settled by then
 * reads as busy (fail-safe).
 * @constant {number}
 */
var DEFAULT_PROBE_TIMEOUT_MS = 1500;

/**
 * Registered busy probes, keyed by name.
 * @type {Object<string, function>}
 * @private
 */
var _probes = {};

/**
 * In-flight (non-`/_gina/*`) request count.
 * @type {number}
 * @private
 */
var _inFlight = 0;


/**
 * Tells whether a path contains an ignored segment.
 *
 * @inner
 * @private
 * @param {string} relPath - `/`-separated relative path
 * @param {string[]} ignore - Segment names to prune
 * @returns {boolean} True when any path component is in the ignore list
 */
var isIgnoredPath = function(relPath, ignore) {
    var parts = String(relPath).split('/');
    for (var i = 0, len = parts.length; i < len; i++) {
        if (ignore.indexOf(parts[i]) > -1) {
            return true;
        }
    }
    return false;
};

/**
 * Computes the fingerprint of a source tree.
 *
 * Walks the tree synchronously (readdir + stat — no content reads, so the
 * cost is proportional to the file count, cheap enough for a build-time stamp
 * and a boot-time compare), skips symlinks (avoids cycles and node_modules
 * links) and ignored segments, then hashes the sorted
 * `relpath|size|floor(mtimeMs)` lines with sha1.
 *
 * NOTE the spec is mtime-based: a copy that preserves timestamps (`cp -p`)
 * produces the same fingerprint as its source, and a checkout that rewrites
 * mtimes without changing content reads as changed. Acceptable for the
 * stale-release use case (fail-safe direction is "stale"); a content-hash
 * spec can ship later under a bumped `FP_SPEC`.
 *
 * @function fingerprintTree
 * @param {string} root - Absolute path of the tree to fingerprint
 * @param {object} [opts]
 * @param {string[]} [opts.ignore] - Segment names to prune (defaults to DEFAULT_IGNORE)
 * @param {boolean} [opts.withListing=false] - Also return the per-file listing (for reconcile diffs)
 * @returns {{spec: number, hash: string, fileCount: number, listing: (Object<string,string>|null)}|null}
 *          The fingerprint, or `null` when the root is missing or not a directory
 * @example
 *  var fp = lib.releaseWatch.fingerprintTree('/path/to/project/src/frontend');
 *  if (fp) {
 *      console.log(fp.hash, fp.fileCount);
 *  }
 */
var fingerprintTree = function(root, opts) {
    opts = opts || {};
    var ignore      = Array.isArray(opts.ignore) ? opts.ignore : DEFAULT_IGNORE;
    var withListing = (opts.withListing === true);

    if (!root || typeof root !== 'string') return null;
    var rootStat = null;
    try {
        rootStat = fs.statSync(root);
    } catch (statErr) {
        return null;
    }
    if (!rootStat.isDirectory()) return null;

    var lines   = [];
    var listing = withListing ? {} : null;

    /**
     * Depth-first tree walk collecting `relpath|size|mtime` lines.
     * @inner
     * @private
     * @param {string} abs - Absolute directory path
     * @param {string} rel - `/`-separated path relative to the root ('' at the root)
     * @returns {void}
     */
    var walk = function(abs, rel) {
        var entries = null;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch (readErr) {
            return; // directory vanished mid-walk — its files simply drop out
        }
        for (var i = 0, len = entries.length; i < len; i++) {
            var name = entries[i].name;
            if (ignore.indexOf(name) > -1) continue;
            var childAbs = abs + '/' + name;
            var childRel = rel ? (rel + '/' + name) : name;
            if (entries[i].isDirectory()) {
                walk(childAbs, childRel);
                continue;
            }
            if (!entries[i].isFile()) continue; // symlinks & specials skipped by design
            var st = null;
            try {
                st = fs.statSync(childAbs);
            } catch (fileErr) {
                continue; // file vanished mid-walk
            }
            var meta = st.size + '|' + Math.floor(st.mtimeMs);
            lines.push(childRel + '|' + meta);
            if (listing) {
                listing[childRel] = meta;
            }
        }
    };

    walk(root, '');
    lines.sort();

    return {
        spec      : FP_SPEC,
        hash      : crypto.createHash('sha1').update(lines.join('\n')).digest('hex'),
        fileCount : lines.length,
        listing   : listing
    };
};

/**
 * Diffs two `fingerprintTree(..., {withListing:true})` listings.
 *
 * @function diffListings
 * @param {Object<string,string>} prev - Previous listing (relpath → `size|mtime`)
 * @param {Object<string,string>} next - Current listing
 * @returns {string[]} Relative paths added, removed or changed between the two
 * @example
 *  var changed = lib.releaseWatch.diffListings(prevFp.listing, nextFp.listing);
 *  // → [ 'controllers/controller.js', 'public/css/app.css' ]
 */
var diffListings = function(prev, next) {
    prev = prev || {};
    next = next || {};
    var changed = [];
    var p = null;
    for (p in next) {
        if (typeof prev[p] === 'undefined' || prev[p] !== next[p]) {
            changed.push(p); // added or modified
        }
    }
    for (p in prev) {
        if (typeof next[p] === 'undefined') {
            changed.push(p); // removed
        }
    }
    return changed;
};

/**
 * Classifies a changed source path.
 *
 * `assets` — disk-served static classes (the bundle's `public/` tree): a
 * rebuild alone refreshes them, no restart needed.
 * `restart` — everything else (controllers, models, templates — server-cached
 * in prod —, config, channels, …) plus unknown/null paths: fail-safe toward
 * over-restarting rather than silently serving stale server code.
 *
 * @function classify
 * @param {string} relPath - Path relative to the bundle source root
 * @returns {string} `'assets'` or `'restart'`
 * @example
 *  lib.releaseWatch.classify('public/css/app.css');        // → 'assets'
 *  lib.releaseWatch.classify('templates/html/index.html'); // → 'restart'
 */
var classify = function(relPath) {
    if (!relPath || typeof relPath !== 'string') return 'restart';
    var p = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (/^public\//.test(p)) return 'assets';
    return 'restart';
};

/**
 * Classifies a batch of changed paths.
 *
 * @function classifyBatch
 * @param {string[]} paths - Changed paths relative to the source root
 * @returns {string|null} `'restart'` when any path is restart-class,
 *          `'assets'` when every path is assets-class, `null` for an empty batch
 * @example
 *  lib.releaseWatch.classifyBatch(['public/a.css', 'public/b.js']); // → 'assets'
 *  lib.releaseWatch.classifyBatch(['public/a.css', 'models/x.js']); // → 'restart'
 */
var classifyBatch = function(paths) {
    if (!Array.isArray(paths) || !paths.length) return null;
    for (var i = 0, len = paths.length; i < len; i++) {
        if (classify(paths[i]) === 'restart') return 'restart';
    }
    return 'assets';
};

/**
 * Creates a recursive, debounced source-tree watcher.
 *
 * Primary signal: `fs.watch(root, {recursive:true, persistent:false})`
 * (Node >= 20, darwin/linux). Optional secondary signal: a slow reconcile
 * sweep (`reconcileIntervalMs` > 0) that re-fingerprints the tree and diffs
 * the listing — the fallback for event-lossy mounts (some Docker/NFS
 * topologies). `useFsEvents:false` runs sweep-only. If recursive `fs.watch`
 * is unavailable on the platform, the watcher degrades to sweep-only when the
 * sweep is enabled, and throws otherwise (the caller decides the fallback).
 *
 * Changed paths are collected into a debounced batch; each batch is delivered
 * to `onChange` as `{paths, severity, hasUnknown}` where `severity` is
 * `classifyBatch(paths)`. A null/absent event filename (platform-dependent)
 * surfaces as the `'(unknown)'` sentinel, which classifies as restart-class.
 *
 * `pause()` drops events while a build runs (a build may touch the source
 * tree, e.g. compiled intermediates); `resume(listing)` re-baselines the
 * reconcile listing — pass a fresh `fingerprintTree(..., {withListing:true})`
 * listing taken after the build, or omit it to re-fingerprint internally.
 *
 * @function createTreeWatcher
 * @param {object} options
 * @param {string} options.root - Absolute path of the source tree to watch
 * @param {function} options.onChange - `function(batch)` — receives `{paths:string[], severity:string, hasUnknown:boolean}`
 * @param {number} [options.debounceMs=750] - Batch debounce window
 * @param {number} [options.reconcileIntervalMs=0] - Reconcile sweep interval; 0 disables the sweep
 * @param {string[]} [options.ignore] - Segment names to prune (defaults to DEFAULT_IGNORE)
 * @param {boolean} [options.useFsEvents=true] - False = sweep-only mode (requires `reconcileIntervalMs` > 0)
 * @param {function} [options.onError] - `function(err)` — watch-channel errors (never thrown into the caller)
 * @returns {{close: function, pause: function, resume: function, isPaused: function, isWatching: function}}
 * @throws {Error} When `root`/`onChange` are missing, when the root does not exist,
 *         or when no watch channel can be established (no fs events AND no sweep)
 * @example
 *  var watcher = lib.releaseWatch.createTreeWatcher({
 *      root     : '/path/to/project/src/frontend',
 *      onChange : function(batch) {
 *          console.log(batch.severity, batch.paths);
 *      }
 *  });
 *  // … later
 *  watcher.close();
 */
var createTreeWatcher = function(options) {
    options = options || {};
    var root                = options.root;
    var onChange            = options.onChange;
    var debounceMs          = (typeof options.debounceMs === 'number' && options.debounceMs >= 0) ? options.debounceMs : DEFAULT_DEBOUNCE_MS;
    var reconcileIntervalMs = (typeof options.reconcileIntervalMs === 'number' && options.reconcileIntervalMs > 0) ? options.reconcileIntervalMs : 0;
    var ignore              = Array.isArray(options.ignore) ? options.ignore : DEFAULT_IGNORE;
    var useFsEvents         = (options.useFsEvents !== false);
    var onError             = (typeof options.onError === 'function') ? options.onError : null;

    if (!root || typeof root !== 'string') {
        throw new Error('createTreeWatcher: `root` is required');
    }
    if (typeof onChange !== 'function') {
        throw new Error('createTreeWatcher: `onChange` is required');
    }
    if (!fs.existsSync(root)) {
        throw new Error('createTreeWatcher: root not found: ' + root);
    }
    if (!useFsEvents && !reconcileIntervalMs) {
        throw new Error('createTreeWatcher: `useFsEvents:false` requires `reconcileIntervalMs` > 0');
    }

    var _closed         = false;
    var _paused         = false;
    var _pending        = {};      // rel path → true (batch under debounce)
    var _hasPending     = false;
    var _debounceTimer  = null;
    var _fsWatcher      = null;
    var _reconcileTimer = null;
    var _lastListing    = null;

    /**
     * Reports a watch-channel error without ever throwing into the caller.
     * @inner
     * @private
     * @param {Error} err
     * @returns {void}
     */
    var reportError = function(err) {
        if (onError) {
            try { onError(err); } catch (cbErr) { /* never escalate */ }
            return;
        }
        console.warn('[releaseWatch] watcher error: ' + (err && (err.stack || err.message) || err));
    };

    /**
     * Flushes the pending batch to `onChange`.
     * @inner
     * @private
     * @returns {void}
     */
    var flush = function() {
        _debounceTimer = null;
        if (_closed || !_hasPending) return;
        var paths = Object.keys(_pending);
        _pending    = {};
        _hasPending = false;
        var hasUnknown = (paths.indexOf('(unknown)') > -1);
        var batch = {
            paths      : paths,
            severity   : classifyBatch(paths),
            hasUnknown : hasUnknown
        };
        try {
            onChange(batch);
        } catch (cbErr) {
            reportError(cbErr);
        }
    };

    /**
     * Records one changed path and (re)arms the debounce timer.
     * @inner
     * @private
     * @param {string} relPath
     * @returns {void}
     */
    var record = function(relPath) {
        if (_closed || _paused) return;
        if (relPath !== '(unknown)' && isIgnoredPath(relPath, ignore)) return;
        _pending[relPath] = true;
        _hasPending = true;
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(flush, debounceMs);
        if (typeof _debounceTimer.unref === 'function') _debounceTimer.unref();
    };

    /**
     * fs.watch event handler.
     * @inner
     * @private
     * @param {string} fsEvent - 'rename' | 'change'
     * @param {(string|Buffer|null)} filename - Path relative to the watch root, when the platform provides it
     * @returns {void}
     */
    var onFsEvent = function(fsEvent, filename) {
        var rel = null;
        if (filename === null || typeof filename === 'undefined') {
            rel = '(unknown)';
        } else {
            rel = String(filename).replace(/\\/g, '/');
            if (!rel.length) rel = '(unknown)';
        }
        record(rel);
    };

    /**
     * One reconcile sweep: re-fingerprint the tree, diff against the baseline,
     * feed differences through the same debounced batch path as fs events.
     * @inner
     * @private
     * @returns {void}
     */
    var reconcileTick = function() {
        if (_closed || _paused) return;
        var fp = fingerprintTree(root, { ignore: ignore, withListing: true });
        if (!fp) {
            record('(unknown)'); // root vanished — definitely stale, restart-class
            return;
        }
        if (_lastListing) {
            var changed = diffListings(_lastListing, fp.listing);
            for (var i = 0, len = changed.length; i < len; i++) {
                record(changed[i]);
            }
        }
        _lastListing = fp.listing;
    };

    if (useFsEvents) {
        try {
            _fsWatcher = fs.watch(root, { recursive: true, persistent: false }, onFsEvent);
            _fsWatcher.on('error', reportError);
        } catch (watchErr) {
            _fsWatcher = null;
            if (!reconcileIntervalMs) {
                throw watchErr; // no fs events AND no sweep — nothing would ever fire
            }
            reportError(watchErr); // degrade to sweep-only
        }
    }

    if (reconcileIntervalMs) {
        var baseline = fingerprintTree(root, { ignore: ignore, withListing: true });
        _lastListing = baseline ? baseline.listing : null;
        _reconcileTimer = setInterval(reconcileTick, reconcileIntervalMs);
        if (typeof _reconcileTimer.unref === 'function') _reconcileTimer.unref();
    }

    return {
        /**
         * Stops watching and releases every handle. Idempotent.
         * @returns {void}
         */
        close: function close() {
            if (_closed) return;
            _closed = true;
            if (_fsWatcher) {
                try { _fsWatcher.close(); } catch (closeErr) { /* already gone */ }
                _fsWatcher = null;
            }
            if (_debounceTimer) {
                clearTimeout(_debounceTimer);
                _debounceTimer = null;
            }
            if (_reconcileTimer) {
                clearInterval(_reconcileTimer);
                _reconcileTimer = null;
            }
            _pending    = {};
            _hasPending = false;
        },
        /**
         * Suspends event recording and reconcile sweeps (e.g. while a build
         * child runs — builds may write compiled intermediates into src).
         * @returns {void}
         */
        pause: function pause() {
            _paused = true;
            _pending    = {};
            _hasPending = false;
            if (_debounceTimer) {
                clearTimeout(_debounceTimer);
                _debounceTimer = null;
            }
        },
        /**
         * Resumes after `pause()`, re-baselining the reconcile listing.
         * @param {Object<string,string>} [listing] - Fresh listing to baseline on;
         *        omitted → the tree is re-fingerprinted internally
         * @returns {void}
         */
        resume: function resume(listing) {
            if (_closed) return;
            if (listing && typeof listing === 'object') {
                _lastListing = listing;
            } else if (_reconcileTimer) {
                var fp = fingerprintTree(root, { ignore: ignore, withListing: true });
                _lastListing = fp ? fp.listing : null;
            }
            _paused = false;
        },
        /**
         * @returns {boolean} True while paused
         */
        isPaused: function isPaused() {
            return _paused;
        },
        /**
         * @returns {boolean} True while at least one watch channel (fs events or sweep) is live
         */
        isWatching: function isWatching() {
            return !_closed && ( !!_fsWatcher || !!_reconcileTimer );
        }
    };
};


/**
 * Registers (or replaces, with a warning) a busy probe.
 *
 * A probe reports application-level in-flight work the idle gate must wait on
 * before a restart-class rebuild may recycle the process. Two shapes:
 *
 *   - zero-arg, Promise-returning (or plain-returning):
 *     `function() { return { busy: true, detail: '3 jobs running' }; }`
 *   - callback-shaped (declared arity >= 1):
 *     `function(cb) { cb(null, { busy: false }); }`
 *
 * The result may be `{busy, detail}` or a plain boolean. A probe that throws,
 * rejects, errors or exceeds the deadline reads as BUSY with the failure in
 * `detail` (fail-safe: never kill work because a probe broke; the operator
 * Force override remains available).
 *
 * @function registerBusyProbe
 * @param {string} name - Probe name (unique; re-registering overwrites with a warning)
 * @param {function} fn - The probe
 * @returns {void}
 * @throws {Error} On a missing/invalid name or fn
 * @example
 *  gina.registerBusyProbe('imports', function() {
 *      return { busy: importQueue.size > 0, detail: importQueue.size + ' imports pending' };
 *  });
 */
var registerBusyProbe = function(name, fn) {
    if (!name || typeof name !== 'string') {
        throw new Error('registerBusyProbe: `name` must be a non-empty string');
    }
    if (typeof fn !== 'function') {
        throw new Error('registerBusyProbe: `fn` must be a function');
    }
    if (typeof _probes[name] !== 'undefined') {
        console.warn('[releaseWatch] busy probe `' + name + '` is being overwritten');
    }
    _probes[name] = fn;
};

/**
 * Removes a busy probe.
 *
 * @function unregisterBusyProbe
 * @param {string} name - Probe name
 * @returns {boolean} True when a probe was removed
 * @example
 *  gina.unregisterBusyProbe('imports');
 */
var unregisterBusyProbe = function(name) {
    if (typeof _probes[name] === 'undefined') return false;
    delete _probes[name];
    return true;
};

/**
 * Lists registered probe names.
 *
 * @function listBusyProbes
 * @returns {string[]} Registered probe names
 */
var listBusyProbes = function() {
    return Object.keys(_probes);
};

/**
 * Runs one probe with a deadline, normalising every outcome to
 * `{name, busy, detail}` and settling exactly once.
 *
 * @inner
 * @private
 * @param {string} name
 * @param {function} fn
 * @param {number} timeoutMs
 * @param {function} done - `function(result)` — called exactly once
 * @returns {void}
 */
var runProbe = function(name, fn, timeoutMs, done) {
    var settled = false;
    var timer   = setTimeout(function onProbeTimeout() {
        settle({ name: name, busy: true, detail: 'probe timed out after ' + timeoutMs + 'ms' });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    /**
     * @inner
     * @private
     * @param {{name:string, busy:boolean, detail:string}} result
     * @returns {void}
     */
    function settle(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done(result);
    }

    /**
     * Normalises a probe's return/callback value.
     * @inner
     * @private
     * @param {*} res - `{busy, detail}` | boolean | anything else (→ not busy)
     * @returns {{name:string, busy:boolean, detail:string}}
     */
    function normalize(res) {
        if (typeof res === 'boolean') {
            return { name: name, busy: res, detail: '' };
        }
        if (res && typeof res === 'object') {
            return {
                name   : name,
                busy   : (res.busy === true),
                detail : (typeof res.detail === 'string') ? res.detail : ''
            };
        }
        return { name: name, busy: false, detail: '' };
    }

    try {
        if (fn.length >= 1) {
            // callback-shaped probe
            fn(function onProbeResult(err, res) {
                if (err) {
                    return settle({ name: name, busy: true, detail: 'probe error: ' + (err.message || err) });
                }
                settle(normalize(res));
            });
        } else {
            Promise.resolve(fn()).then(
                function onProbeResolved(res) { settle(normalize(res)); },
                function onProbeRejected(err) { settle({ name: name, busy: true, detail: 'probe error: ' + (err && err.message || err) }); }
            );
        }
    } catch (probeErr) {
        settle({ name: name, busy: true, detail: 'probe threw: ' + (probeErr.message || probeErr) });
    }
};

/**
 * Runs every registered probe (bounded by a per-probe deadline) and
 * aggregates the results.
 *
 * Never errors: probe failures surface as `busy:true` rows, and the aggregate
 * is busy when ANY probe is. With no registered probes the result is idle.
 *
 * @function checkBusyProbes
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=1500] - Per-probe deadline
 * @param {function} [cb] - `function(err, result)` — `err` is always null;
 *        omit it to receive a Promise of the same result
 * @returns {(Promise|undefined)} A Promise when no callback is given
 * @example
 *  lib.releaseWatch.checkBusyProbes(function(err, result) {
 *      // result → { busy: true, probes: [ { name: 'jobs', busy: true, detail: 'jobs: 2 running, …' } ] }
 *  });
 */
var checkBusyProbes = function(opts, cb) {
    if (typeof opts === 'function') {
        cb   = opts;
        opts = null;
    }
    if (typeof cb !== 'function') {
        return new Promise(function(resolve) {
            checkBusyProbes(opts, function(err, result) {
                resolve(result);
            });
        });
    }
    opts = opts || {};
    var timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : DEFAULT_PROBE_TIMEOUT_MS;
    var names     = Object.keys(_probes);
    if (!names.length) {
        return process.nextTick(function() {
            cb(null, { busy: false, probes: [] });
        });
    }
    var results   = [];
    var remaining = names.length;
    for (var i = 0, len = names.length; i < len; i++) {
        runProbe(names[i], _probes[names[i]], timeoutMs, function onProbeDone(result) {
            results.push(result);
            if (--remaining === 0) {
                var busy = false;
                for (var r = 0, rLen = results.length; r < rLen; r++) {
                    if (results[r].busy) { busy = true; break; }
                }
                cb(null, { busy: busy, probes: results });
            }
        });
    }
};

/**
 * Registers the framework's own default probes. Currently: a `jobs` probe
 * over lib/job's stats — busy while any job is running, queued or waiting on
 * a retry backoff (graceful shutdown does NOT drain async jobs: their timers
 * are unref'd by design, so `server.close()` never waits on them — this probe
 * is what makes the idle gate see them).
 *
 * Idempotent: an already-registered `jobs` probe is left untouched (so an
 * application override survives).
 *
 * @function registerDefaultProbes
 * @returns {void}
 * @example
 *  lib.releaseWatch.registerDefaultProbes();
 */
var registerDefaultProbes = function() {
    if (typeof _probes['jobs'] !== 'undefined') return;
    registerBusyProbe('jobs', function jobsProbe() {
        var job = null;
        try {
            job = require('../../job');
        } catch (requireErr) {
            return { busy: false, detail: 'lib/job unavailable' };
        }
        var s = (job && typeof job.stats === 'function') ? job.stats() : null;
        if (!s) {
            return { busy: false, detail: 'no job stats' };
        }
        var running      = s.running | 0;
        var queued       = s.queued | 0;
        var retryWaiting = s.retryWaiting | 0;
        return {
            busy   : (running + queued + retryWaiting) > 0,
            detail : 'jobs: ' + running + ' running, ' + queued + ' queued, ' + retryWaiting + ' retry-waiting'
        };
    });
};


/**
 * Tells whether a request URL targets a `/_gina/*` control endpoint.
 *
 * @inner
 * @private
 * @param {string} url - Raw request URL (path[?query])
 * @returns {boolean}
 */
var isControlPath = function(url) {
    if (typeof url !== 'string') return false;
    return /^\/_gina\//.test(url.split('?')[0]);
};

/**
 * No-op finisher handed out for control-path requests.
 * @inner
 * @private
 * @returns {void}
 */
var noopDone = function() {};

/**
 * Tracks one in-flight request on the idle-gate gauge and returns an
 * IDEMPOTENT finisher — wire it to both `response.on('finish')` and
 * `response.on('close')`; only the first call decrements.
 *
 * `/_gina/*` control paths are excluded from the gauge by design: the
 * release-watch SSE/status connections are themselves long-lived responses
 * that never fire `finish`, so counting them would hold the idle gate open
 * forever.
 *
 * @function trackRequest
 * @param {string} url - Raw request URL
 * @returns {function} Idempotent finisher
 * @example
 *  var done = lib.releaseWatch.trackRequest(request.url);
 *  response.on('finish', done);
 *  response.on('close',  done);
 */
var trackRequest = function(url) {
    if (isControlPath(url)) {
        return noopDone;
    }
    _inFlight++;
    var finished = false;
    return function done() {
        if (finished) return;
        finished = true;
        if (_inFlight > 0) _inFlight--;
    };
};

/**
 * Current in-flight (non-control) request count.
 *
 * @function getInFlightCount
 * @returns {number}
 * @example
 *  if (lib.releaseWatch.getInFlightCount() === 0) { … }
 */
var getInFlightCount = function() {
    return _inFlight;
};

/**
 * Resets the probe registry and the in-flight gauge. For tests and for the
 * restart executor's teardown; live watchers are NOT touched (close their
 * handles individually).
 *
 * @function reset
 * @returns {void}
 */
var reset = function() {
    _probes   = {};
    _inFlight = 0;
};


module.exports = {
    FP_SPEC               : FP_SPEC,
    DEFAULT_IGNORE        : DEFAULT_IGNORE,
    DEFAULT_DEBOUNCE_MS   : DEFAULT_DEBOUNCE_MS,
    fingerprintTree       : fingerprintTree,
    diffListings          : diffListings,
    classify              : classify,
    classifyBatch         : classifyBatch,
    createTreeWatcher     : createTreeWatcher,
    registerBusyProbe     : registerBusyProbe,
    unregisterBusyProbe   : unregisterBusyProbe,
    listBusyProbes        : listBusyProbes,
    checkBusyProbes       : checkBusyProbes,
    registerDefaultProbes : registerDefaultProbes,
    trackRequest          : trackRequest,
    getInFlightCount      : getInFlightCount,
    reset                 : reset
};
