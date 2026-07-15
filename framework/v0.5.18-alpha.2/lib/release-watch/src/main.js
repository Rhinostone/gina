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
 * Timer hygiene: the standing timers (debounce, reconcile sweep, idle gate,
 * auto cooldown) are `unref()`'d and every `fs.watch` handle is created with
 * `persistent:false` — the module never keeps an idle process (or a test
 * file) alive. The ONE exception is the per-probe deadline inside an
 * in-flight `checkBusyProbes()` call: it stays ref'd because it is the only
 * settlement guarantee for the caller's promise (Node 22 drains an
 * otherwise-idle loop mid-check without it); it is bounded (`timeoutMs`) and
 * self-clearing.
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
    // Deliberately NOT unref'd: while a checkBusyProbes() call is in flight,
    // this deadline is the ONLY guarantee the caller's promise/callback ever
    // settles — an unref'd deadline lets an otherwise-idle event loop drain
    // with the check still pending (measured on Node 22: "Promise resolution
    // is still pending but the event loop has already resolved"). Bounded and
    // self-clearing, so it holds the loop for at most `timeoutMs`.
    var timer   = setTimeout(function onProbeTimeout() {
        settle({ name: name, busy: true, detail: 'probe timed out after ' + timeoutMs + 'ms' });
    }, timeoutMs);

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


// ─────────────────────────────────────────────────────────────────────────
// Service — the stale-release state machine (#RW1 slice 2)
//
// One instance per bundle process (a bundle process serves one bundle).
// The server engine calls `init()` at boot when every hard gate passes
// (NODE_SCOPE_IS_LOCAL === 'true', !isDev, server.releaseWatch.enabled).
// Everything below is inert until init() runs — CLI processes and dev-mode
// bundles never pay for it.
//
// Staleness is a DUAL-AXIS model:
//   - src vs release  — fingerprint(srcRoot) != the manifest release stamp
//                       (the operator edited source after the last build)
//   - release vs process — the manifest stamp != the stamp captured at boot
//                       (a rebuild happened, but this process still serves
//                        the release it booted from — restart pending)
//
// Watch events are TRIGGERS only: every batch re-runs the fingerprint
// compare against the (re-read) manifest stamp before any state flips —
// macOS FSEvents can replay pre-boot writes and streams can be lossy, so
// the fingerprint is the single source of truth. A reverted edit therefore
// self-heals on the next batch.
// ─────────────────────────────────────────────────────────────────────────

var EventEmitter = require('events').EventEmitter;

/**
 * Maximum changed paths retained on the status payload.
 * @constant {number}
 * @private
 */
var MAX_TRACKED_CHANGES = 50;

/**
 * Maximum build progress lines retained on the action record.
 * @constant {number}
 * @private
 */
var MAX_PROGRESS_LINES = 200;

/**
 * Service singleton state — null until `init()`.
 * @type {(object|null)}
 * @private
 */
var _svc = null;

/**
 * Emits one service event to every subscriber.
 * @inner
 * @private
 * @param {string} type - Event type (status|stale|build|flushed|waiting|restarting|done|error)
 * @param {object} [data]
 * @returns {void}
 */
var _emitEvent = function(type, data) {
    if (!_svc) return;
    try {
        _svc.emitter.emit('release', { type: type, data: data || {}, at: Date.now() });
    } catch (emitErr) {
        console.warn('[releaseWatch] event emit failed: ' + (emitErr.message || emitErr));
    }
};

/**
 * Reads the bundle's release stamp from the project manifest. The manifest
 * is machine-written JSON, but a full-line `//` comment header is tolerated
 * (the requireJSON convention) — read fresh on every call so a rebuild's
 * restamp is always observed.
 *
 * @inner
 * @private
 * @param {string} manifestPath
 * @param {string} bundle
 * @param {string} scope
 * @param {string} env
 * @returns {({fingerprint:string, builtAt:string, fpSpec:number, target:string}|null)}
 */
var readReleaseStamp = function(manifestPath, bundle, scope, env) {
    var raw = null;
    try {
        raw = fs.readFileSync(manifestPath, 'utf8');
    } catch (readErr) {
        return null;
    }
    var manifest = null;
    try {
        manifest = JSON.parse(raw);
    } catch (parseErr) {
        try {
            manifest = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
        } catch (parse2Err) {
            return null;
        }
    }
    var rec = manifest
        && manifest.bundles
        && manifest.bundles[bundle]
        && manifest.bundles[bundle].releases
        && manifest.bundles[bundle].releases[scope]
        && manifest.bundles[bundle].releases[scope][env]
        || null;
    if (!rec || !rec.target) return null;
    return {
        fingerprint : (typeof rec.fingerprint === 'string') ? rec.fingerprint : null,
        builtAt     : rec.builtAt || null,
        fpSpec      : (typeof rec.fpSpec === 'number') ? rec.fpSpec : null,
        target      : rec.target
    };
};

/**
 * Short display form of a fingerprint (the buildId).
 * @inner
 * @private
 * @param {(string|null)} hash
 * @returns {(string|null)}
 */
var shortId = function(hash) {
    return (hash && typeof hash === 'string') ? hash.substring(0, 12) : null;
};

/**
 * Merges a batch of changed paths into the tracked set (capped).
 * @inner
 * @private
 * @param {string[]} paths
 * @returns {void}
 */
var trackChanges = function(paths) {
    for (var i = 0, len = paths.length; i < len; i++) {
        if (_svc.changes.indexOf(paths[i]) > -1) continue;
        if (_svc.changes.length >= MAX_TRACKED_CHANGES) {
            _svc.changesTruncated = true;
            break;
        }
        _svc.changes.push(paths[i]);
    }
};

/**
 * Flips (or escalates) the stale state and notifies. The loud log line fires
 * on the fresh → stale transition and on a severity escalation — not on
 * every batch.
 *
 * @inner
 * @private
 * @param {string[]} paths - Changed paths (or a sentinel like '(boot-compare)')
 * @param {string} severity - 'assets' | 'restart'
 * @returns {void}
 */
var markStale = function(paths, severity) {
    var wasStale     = _svc.srcStale;
    var prevSeverity = _svc.severity;
    _svc.srcStale = true;
    if (severity === 'restart' || _svc.severity === 'restart') {
        _svc.severity = 'restart';
    } else {
        _svc.severity = 'assets';
    }
    if (!_svc.staleSince) _svc.staleSince = Date.now();
    trackChanges(paths);
    if (!wasStale || (prevSeverity !== 'restart' && _svc.severity === 'restart')) {
        console.warn(
            '[releaseWatch] source changed after build — serving a stale release'
            + ' (severity: ' + _svc.severity + ').'
            + ' POST /_gina/release/rebuild or run: gina bundle:build '
            + _svc.bundle + ' @' + _svc.project
            + ' --env=' + _svc.env + ' --scope=' + _svc.scope
        );
    }
    _emitEvent('stale', {
        severity : _svc.severity,
        paths    : paths,
        changes  : _svc.changes.slice()
    });
    if (_svc.mode === 'auto') {
        scheduleAutoAct();
    }
};

/**
 * Clears the src-vs-release staleness (verified back in sync — e.g. a
 * reverted edit, or a completed rebuild).
 * @inner
 * @private
 * @returns {void}
 */
var markSrcFresh = function() {
    var was = _svc.srcStale;
    _svc.srcStale         = false;
    _svc.severity         = _svc.processBehind ? 'restart' : null;
    _svc.staleSince       = _svc.processBehind ? _svc.staleSince : null;
    _svc.changes          = [];
    _svc.changesTruncated = false;
    if (was) {
        _emitEvent('status', getStatus());
    }
};

/**
 * Adopts a (re-)read release stamp and derives the release-vs-process axis.
 *
 * `processBehind` means "the release moved past what this process booted
 * from, in a way a restart is needed for". Our OWN pipeline knows the
 * accumulated change class (`assetsOnlyKnown` — disk-served statics need no
 * restart); an EXTERNAL rebuild's delta class is unknowable, so it fails
 * safe to restart-pending. A stamp equal to the boot stamp always clears
 * the axis.
 *
 * @inner
 * @private
 * @param {({fingerprint:string}|null)} newStamp
 * @param {boolean} assetsOnlyKnown - True when the adopting caller KNOWS the delta was assets-class only
 * @returns {void}
 */
var adoptReleaseStamp = function(newStamp, assetsOnlyKnown) {
    if (!_svc || !newStamp || !newStamp.fingerprint) return;
    var changed = !(_svc.releaseStamp && _svc.releaseStamp.fingerprint === newStamp.fingerprint);
    _svc.releaseStamp = newStamp;
    var differsFromRunning = (_svc.runningStamp && _svc.runningStamp.fingerprint)
        ? (newStamp.fingerprint !== _svc.runningStamp.fingerprint)
        : true; // boot identity unknown + a stamped release ⇒ fail-safe
    if (!differsFromRunning) {
        _svc.processBehind = false;
        return;
    }
    if (assetsOnlyKnown) return; // release moved, but only disk-served statics — no restart owed
    if (changed) _svc.processBehind = true;
};

/**
 * Watcher batch handler — verify-by-fingerprint before any state flip.
 * @inner
 * @private
 * @param {{paths:string[], severity:string, hasUnknown:boolean}} batch
 * @returns {void}
 */
var onWatchBatch = function(batch) {
    if (!_svc || !_svc.active) return;
    var fp    = fingerprintTree(_svc.srcRoot, { ignore: _svc.ignore });
    var stamp = readReleaseStamp(_svc.manifestPath, _svc.bundle, _svc.scope, _svc.env);
    if (!fp) {
        // src root vanished — definitely stale, and only a restart-class
        // action can make sense of it
        markStale(['(src-root-missing)'], 'restart');
        return;
    }
    if (!stamp || !stamp.fingerprint || stamp.fpSpec !== FP_SPEC) {
        // no comparable stamp (pre-feature build) — the event itself is the
        // best evidence we have; fail-safe toward stale
        markStale(batch.paths, batch.severity || 'restart');
        return;
    }
    adoptReleaseStamp(stamp, false); // notice EXTERNAL rebuilds too
    if (fp.hash === stamp.fingerprint) {
        // spurious event, replayed pre-boot write, or a reverted edit —
        // the source matches the release: self-heal
        markSrcFresh();
        return;
    }
    markStale(batch.paths, batch.severity || 'restart');
};

/**
 * Schedules an auto-mode rebuild (debounced by a cooldown so rapid editing
 * doesn't stack builds; a failed build is NOT auto-retried — the next
 * source change re-triggers).
 * @inner
 * @private
 * @returns {void}
 */
var scheduleAutoAct = function() {
    if (!_svc || _svc.mode !== 'auto' || _svc.action || _svc.autoTimer) return;
    var wait = Math.max(0, _svc.autoCooldownMs - (Date.now() - (_svc.lastAutoAt || 0)));
    _svc.autoTimer = setTimeout(function autoAct() {
        if (!_svc) return;
        _svc.autoTimer = null;
        if (!_svc.srcStale || _svc.action) return;
        _svc.lastAutoAt = Date.now();
        requestRebuild({ restart: 'auto', requestedBy: 'auto' });
    }, wait);
    if (typeof _svc.autoTimer.unref === 'function') _svc.autoTimer.unref();
};

/**
 * Default build spawner — `gina bundle:build <bundle> @<project> --env=… --scope=…`
 * as a detached-from-stdio child whose stdout/stderr lines feed progress.
 * @inner
 * @private
 * @param {object} ctx - The service state
 * @returns {object} ChildProcess-like ({stdout, stderr, on})
 */
var defaultSpawnBuild = function(ctx) {
    var spawn = require('child_process').spawn;
    return spawn('gina', [
        'bundle:build', ctx.bundle, '@' + ctx.project,
        '--env=' + ctx.env, '--scope=' + ctx.scope
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
};

/**
 * Default restart executor: mirror lib/proc.js's SIGTERM drain steps
 * (close SSE closers → closeIdleConnections → server.close with a hard
 * cap), then spawn a detached `gina bundle:restart` — its `bundle:stop`
 * kill -9 lands on an idle, listener-closed process, and its
 * `bundle:start` boots the successor on the rebuilt release.
 * @inner
 * @private
 * @param {object} ctx - The service state
 * @param {function} done - `function(err)` — best-effort; the process is expected to die
 * @returns {void}
 */
var defaultExecRestart = function(ctx, done) {
    var finished = false;
    var finish = function(err) {
        if (finished) return;
        finished = true;
        try {
            var spawn = require('child_process').spawn;
            var child = spawn('gina', ['bundle:restart', ctx.bundle, '@' + ctx.project], {
                detached : true,
                stdio    : 'ignore'
            });
            child.unref();
        } catch (spawnErr) {
            return done(spawnErr);
        }
        done(err || null);
    };
    var httpServer = ctx.httpServer;
    if (!httpServer || typeof httpServer.close !== 'function') {
        return finish(null);
    }
    var capMs = parseInt(process.env.GINA_SHUTDOWN_TIMEOUT) || 10000;
    var cap = setTimeout(function() {
        console.warn('[releaseWatch] restart drain timed out (' + capMs + 'ms) — proceeding');
        finish(null);
    }, capMs);
    if (typeof cap.unref === 'function') cap.unref();
    // Drain long-lived SSE responses first — closeIdleConnections() does not
    // close active streams, so open SSE would hold close() to the cap
    // (same steps as lib/proc.js's SIGTERM handler — keep the two in sync).
    if (process.gina && process.gina._sseConnections && process.gina._sseConnections.size > 0) {
        var closers = Array.from(process.gina._sseConnections);
        for (var i = 0; i < closers.length; i++) {
            try { closers[i](); } catch (sseErr) { /* best effort */ }
        }
    }
    if (typeof httpServer.closeIdleConnections === 'function') {
        try { httpServer.closeIdleConnections(); } catch (idleErr) { /* best effort */ }
    }
    try {
        httpServer.close(function() {
            clearTimeout(cap);
            finish(null);
        });
    } catch (closeErr) {
        clearTimeout(cap);
        finish(null);
    }
};

/**
 * The idle gate: waits until the in-flight gauge is 0 AND every busy probe
 * is idle, continuously for `graceMs` — or until forced. Emits throttled
 * `waiting` events so the operator sees WHAT the gate waits on.
 * @inner
 * @private
 * @param {function} proceed - Called once when the gate opens
 * @returns {void}
 */
var runIdleGate = function(proceed) {
    var stableSince = null;
    var lastEmit    = 0;
    var ticking     = false;
    _svc.gateTimer = setInterval(function gateTick() {
        if (!_svc || !_svc.action) return;
        if (_svc.action.force) {
            return openGate('forced');
        }
        if (ticking) return; // a probe check is still in flight
        ticking = true;
        var inFlight = getInFlightCount();
        checkBusyProbes({ timeoutMs: _svc.probeTimeoutMs }, function(err, result) {
            ticking = false;
            if (!_svc || !_svc.action || _svc.action.state !== 'waiting') return;
            if (_svc.action.force) {
                return openGate('forced');
            }
            var busy = (inFlight > 0) || result.busy;
            if (busy) {
                stableSince = null;
                if (Date.now() - lastEmit > 1000) {
                    lastEmit = Date.now();
                    _emitEvent('waiting', { inFlight: inFlight, probes: result.probes });
                }
                return;
            }
            if (stableSince === null) stableSince = Date.now();
            if (Date.now() - stableSince >= _svc.graceMs) {
                return openGate('idle');
            }
        });
    }, _svc.gateIntervalMs);
    if (typeof _svc.gateTimer.unref === 'function') _svc.gateTimer.unref();

    /**
     * @inner
     * @private
     * @param {string} how - 'idle' | 'forced'
     * @returns {void}
     */
    function openGate(how) {
        if (_svc.gateTimer) {
            clearInterval(_svc.gateTimer);
            _svc.gateTimer = null;
        }
        proceed(how);
    }
};

/**
 * The rebuild pipeline: build child → re-stamp read → render-cache flush →
 * (restart-class) idle gate → restart executor. Runs in the background;
 * progress lands on the event stream and `getStatus()`.
 * @inner
 * @private
 * @param {{restart:string, requestedBy:string}} opts
 * @returns {void}
 */
var runPipeline = function(opts) {
    var action = {
        state           : 'building',
        startedAt       : Date.now(),
        requestedBy     : opts.requestedBy || 'operator',
        restartPolicy   : opts.restart || 'auto',
        force           : (opts.restart === 'force'),
        severityAtStart : _svc.severity, // the accumulated class this build answers
        progress        : []
    };
    _svc.action    = action;
    _svc.lastError = null;
    _svc.watcher.pause();
    _emitEvent('status', getStatus());

    var child = null;
    try {
        child = _svc.spawnBuild(_svc);
    } catch (spawnErr) {
        return failPipeline('build spawn failed: ' + (spawnErr.message || spawnErr));
    }

    /**
     * @inner
     * @private
     * @param {Buffer|string} chunk
     * @returns {void}
     */
    var onData = function(chunk) {
        var lines = String(chunk).split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line.length) continue;
            if (action.progress.length < MAX_PROGRESS_LINES) {
                action.progress.push(line);
            }
            _emitEvent('build', { line: line });
        }
    };
    if (child.stdout && child.stdout.on) child.stdout.on('data', onData);
    if (child.stderr && child.stderr.on) child.stderr.on('data', onData);
    child.on('error', function(childErr) {
        failPipeline('build child error: ' + (childErr.message || childErr));
    });
    child.on('exit', function(code) {
        if (!_svc || _svc.action !== action) return; // deactivated mid-build
        if (code !== 0) {
            return failPipeline('build exited with code ' + code);
        }
        afterBuild();
    });

    /**
     * Marks the pipeline failed, resumes watching, notifies.
     * @inner
     * @private
     * @param {string} message
     * @returns {void}
     */
    function failPipeline(message) {
        if (!_svc || _svc.action !== action) return;
        _svc.lastError = message;
        _svc.action    = null;
        try { _svc.watcher.resume(); } catch (resumeErr) { /* closed */ }
        console.warn('[releaseWatch] rebuild failed: ' + message);
        _emitEvent('error', { message: message });
        _emitEvent('status', getStatus());
    }

    /**
     * Post-build: restamp read, flush, classify the endgame.
     * @inner
     * @private
     * @returns {void}
     */
    function afterBuild() {
        var newStamp = readReleaseStamp(_svc.manifestPath, _svc.bundle, _svc.scope, _svc.env);
        // our own pipeline KNOWS the accumulated class — an assets-only build
        // moves the release without owing a restart
        adoptReleaseStamp(newStamp, action.severityAtStart === 'assets');

        action.state = 'flushing';
        _emitEvent('status', getStatus());
        var flushed = function() {
            _emitEvent('flushed', {});
            // src freshness after the build: edits made DURING the build keep
            // it stale (the resumed watcher + this compare both catch them)
            var fp = fingerprintTree(_svc.srcRoot, { ignore: _svc.ignore });
            var srcFresh = !!(fp && _svc.releaseStamp && _svc.releaseStamp.fingerprint
                && fp.hash === _svc.releaseStamp.fingerprint);
            var severity = _svc.severity;
            try { _svc.watcher.resume(); } catch (resumeErr) { /* closed */ }
            if (srcFresh) {
                markSrcFresh();
            }
            if (severity === 'assets' && action.restartPolicy !== 'force' && !_svc.processBehind) {
                _svc.action = null;
                _emitEvent('done', { restarted: false });
                _emitEvent('status', getStatus());
                return;
            }
            if (action.restartPolicy === 'skip') {
                _svc.action = null;
                _emitEvent('done', { restarted: false, restartPending: _svc.processBehind });
                _emitEvent('status', getStatus());
                return;
            }
            action.state = 'waiting';
            _emitEvent('status', getStatus());
            runIdleGate(function(how) {
                if (!_svc || _svc.action !== action) return;
                action.state = 'restarting';
                _emitEvent('restarting', { how: how });
                _emitEvent('status', getStatus());
                _svc.execRestart(_svc, function(restartErr) {
                    if (restartErr) {
                        return failPipeline('restart failed: ' + (restartErr.message || restartErr));
                    }
                    // normally unreachable for long — bundle:restart kill -9s
                    // this process; kept for the drain-only (daemonless) path
                    _emitEvent('done', { restarted: true });
                });
            });
        };
        try {
            if (_svc.flushRenderCache.length >= 2) {
                _svc.flushRenderCache(_svc.bundle, function() { flushed(); });
            } else {
                _svc.flushRenderCache(_svc.bundle);
                flushed();
            }
        } catch (flushErr) {
            console.warn('[releaseWatch] render-cache flush failed (continuing): ' + (flushErr.message || flushErr));
            flushed();
        }
    }
};

/**
 * Initialises and arms the stale-release watch service for this bundle
 * process. The CALLER owns the hard gates (`NODE_SCOPE_IS_LOCAL === 'true'`,
 * `!isDev`, `server.releaseWatch.enabled === true`) — init() assumes they
 * passed. Inert until called; calling it twice is a warned no-op.
 *
 * @function init
 * @param {object} options
 * @param {string} options.bundle - Bundle name
 * @param {string} options.project - Project name
 * @param {string} options.env - Environment being served
 * @param {string} options.scope - Scope being served (local)
 * @param {string} options.srcRoot - Absolute path of the bundle SOURCE tree (from the manifest `src`, NOT the release)
 * @param {string} options.manifestPath - Absolute path of the project manifest.json
 * @param {string} [options.mode='notify'] - 'notify' | 'auto'
 * @param {number} [options.debounceMs=750]
 * @param {number} [options.reconcileIntervalMs=0]
 * @param {string[]} [options.ignore]
 * @param {object} [options.httpServer] - The engine's HTTP(S) server (drained before a restart)
 * @param {function} [options.flushRenderCache] - `function(bundle[, cb])` — injected by the server engine
 * @param {function} [options.spawnBuild] - Seam: replaces the `gina bundle:build` child (tests)
 * @param {function} [options.execRestart] - Seam: replaces the drain+`bundle:restart` executor (tests / daemonless)
 * @param {number} [options.graceMs=2000] - Idle gate stability window
 * @param {number} [options.gateIntervalMs=250] - Idle gate poll interval
 * @param {number} [options.probeTimeoutMs=1500]
 * @param {number} [options.autoCooldownMs=5000] - Minimum spacing between auto-mode builds
 * @param {boolean} [options.useFsEvents=true] - Seam: sweep-only watching (tests / lossy mounts)
 * @returns {boolean} True when the service armed
 * @example
 *  lib.releaseWatch.init({
 *      bundle: 'frontend', project: 'myproject', env: 'prod', scope: 'local',
 *      srcRoot: '/path/to/project/src/frontend',
 *      manifestPath: '/path/to/project/manifest.json',
 *      httpServer: instance,
 *      flushRenderCache: function(bundle) { renderCache.clear(bundle); }
 *  });
 */
var init = function(options) {
    options = options || {};
    if (_svc && _svc.active) {
        console.warn('[releaseWatch] init() called twice — already active for `' + _svc.bundle + '`');
        return false;
    }
    var required = ['bundle', 'project', 'env', 'scope', 'srcRoot', 'manifestPath'];
    for (var i = 0; i < required.length; i++) {
        if (!options[required[i]] || typeof options[required[i]] !== 'string') {
            console.warn('[releaseWatch] init() missing required option `' + required[i] + '` — service not armed');
            return false;
        }
    }
    if (!fs.existsSync(options.srcRoot)) {
        console.warn('[releaseWatch] source root not found (`' + options.srcRoot + '`) — service not armed');
        return false;
    }

    var runningStamp = readReleaseStamp(options.manifestPath, options.bundle, options.scope, options.env);

    _svc = {
        active           : false,
        bundle           : options.bundle,
        project          : options.project,
        env              : options.env,
        scope            : options.scope,
        srcRoot          : options.srcRoot,
        manifestPath     : options.manifestPath,
        mode             : (options.mode === 'auto') ? 'auto' : 'notify',
        ignore           : Array.isArray(options.ignore) ? options.ignore : DEFAULT_IGNORE,
        graceMs          : (typeof options.graceMs === 'number') ? options.graceMs : 2000,
        gateIntervalMs   : (typeof options.gateIntervalMs === 'number') ? options.gateIntervalMs : 250,
        probeTimeoutMs   : (typeof options.probeTimeoutMs === 'number') ? options.probeTimeoutMs : DEFAULT_PROBE_TIMEOUT_MS,
        autoCooldownMs   : (typeof options.autoCooldownMs === 'number') ? options.autoCooldownMs : 5000,
        httpServer       : options.httpServer || null,
        flushRenderCache : (typeof options.flushRenderCache === 'function') ? options.flushRenderCache : function noopFlush() {},
        spawnBuild       : (typeof options.spawnBuild === 'function') ? options.spawnBuild : defaultSpawnBuild,
        execRestart      : (typeof options.execRestart === 'function') ? options.execRestart : defaultExecRestart,
        // state
        runningStamp     : runningStamp,           // what THIS process serves (boot snapshot)
        releaseStamp     : runningStamp,           // what the manifest says the release is (refreshed on rebuild)
        srcStale         : false,
        processBehind    : false,
        severity         : null,
        staleSince       : null,
        changes          : [],
        changesTruncated : false,
        stampUnknown     : !(runningStamp && runningStamp.fingerprint && runningStamp.fpSpec === FP_SPEC),
        action           : null,
        lastError        : null,
        autoTimer        : null,
        gateTimer        : null,
        emitter          : new EventEmitter(),
        watcher          : null,
        startedAt        : Date.now()
    };
    _svc.emitter.setMaxListeners(64);

    registerDefaultProbes();

    try {
        _svc.watcher = createTreeWatcher({
            root                : _svc.srcRoot,
            debounceMs          : (typeof options.debounceMs === 'number') ? options.debounceMs : DEFAULT_DEBOUNCE_MS,
            reconcileIntervalMs : (typeof options.reconcileIntervalMs === 'number') ? options.reconcileIntervalMs : 0,
            ignore              : _svc.ignore,
            useFsEvents         : options.useFsEvents,
            onChange            : onWatchBatch,
            onError             : function(watchErr) {
                console.warn('[releaseWatch] watch channel error: ' + (watchErr.message || watchErr));
            }
        });
    } catch (watcherErr) {
        console.warn('[releaseWatch] could not start the source watcher: ' + (watcherErr.message || watcherErr));
        _svc = null;
        return false;
    }

    _svc.active = true;

    // Boot compare — the env-switch case: source edited (e.g. under dev-env)
    // after the last build, then relaunched serving the built release. The
    // boot compare cannot know WHICH paths changed (the stamp holds no
    // listing), so it fails safe to restart-class.
    if (_svc.stampUnknown) {
        console.log('[releaseWatch] no comparable fingerprint stamp for `' + _svc.bundle
            + '` (' + _svc.scope + '/' + _svc.env + ') — staleness unknown until the next `gina bundle:build`');
    } else {
        var bootFp = fingerprintTree(_svc.srcRoot, { ignore: _svc.ignore });
        if (bootFp && bootFp.hash !== _svc.runningStamp.fingerprint) {
            markStale(['(boot-compare)'], 'restart');
        }
    }

    console.log('[releaseWatch] armed (' + _svc.mode + ') — watching `' + _svc.srcRoot
        + '` for `' + _svc.bundle + '@' + _svc.project + '` (' + _svc.scope + '/' + _svc.env + ')');
    _emitEvent('status', getStatus());
    return true;
};

/**
 * Whether the service is armed for this process.
 * @function isActive
 * @returns {boolean}
 * @example
 *  if (lib.releaseWatch.isActive()) { … }
 */
var isActive = function() {
    return !!(_svc && _svc.active);
};

/**
 * The status snapshot — the payload behind `GET /_gina/release/status`.
 *
 * @function getStatus
 * @returns {(object|null)} Null when the service is not armed
 * @example
 *  var st = lib.releaseWatch.getStatus();
 *  // → { stale, severity, buildId, releaseBuildId, action, inFlight, … }
 */
var getStatus = function() {
    if (!_svc) return null;
    if (_svc.active) {
        // notice external rebuilds promptly (a status poll is ~2s cadence;
        // one manifest read per poll is cheap) — adopt() no-ops on an
        // unchanged stamp
        var _cur = readReleaseStamp(_svc.manifestPath, _svc.bundle, _svc.scope, _svc.env);
        if (_cur && _cur.fingerprint) adoptReleaseStamp(_cur, false);
    }
    return {
        active           : _svc.active,
        mode             : _svc.mode,
        bundle           : _svc.bundle,
        project          : _svc.project,
        env              : _svc.env,
        scope            : _svc.scope,
        watching         : !!(_svc.watcher && _svc.watcher.isWatching()),
        // identity
        buildId          : shortId(_svc.runningStamp && _svc.runningStamp.fingerprint),
        releaseBuildId   : shortId(_svc.releaseStamp && _svc.releaseStamp.fingerprint),
        builtAt          : (_svc.releaseStamp && _svc.releaseStamp.builtAt) || null,
        stampUnknown     : _svc.stampUnknown,
        // staleness (dual axis)
        stale            : !!(_svc.srcStale || _svc.processBehind),
        srcStale         : _svc.srcStale,
        processBehind    : _svc.processBehind,
        severity         : _svc.severity,
        staleSince       : _svc.staleSince,
        changes          : _svc.changes.slice(),
        changesTruncated : _svc.changesTruncated,
        // action
        action           : _svc.action ? {
            state         : _svc.action.state,
            startedAt     : _svc.action.startedAt,
            requestedBy   : _svc.action.requestedBy,
            restartPolicy : _svc.action.restartPolicy,
            force         : _svc.action.force,
            progressTail  : _svc.action.progress.slice(-10)
        } : null,
        lastError        : _svc.lastError,
        inFlight         : getInFlightCount(),
        startedAt        : _svc.startedAt
    };
};

/**
 * Subscribes to the service event stream (the substrate of the
 * `/_gina/release/events` SSE endpoint).
 *
 * @function subscribe
 * @param {function} fn - `function({type, data, at})`
 * @returns {(function|null)} Unsubscribe function, or null when not armed
 * @example
 *  var off = lib.releaseWatch.subscribe(function(evt) { console.log(evt.type); });
 *  // … later
 *  off();
 */
var subscribe = function(fn) {
    if (!_svc || typeof fn !== 'function') return null;
    _svc.emitter.on('release', fn);
    return function unsubscribe() {
        if (_svc) _svc.emitter.removeListener('release', fn);
    };
};

/**
 * Requests the rebuild pipeline (the substrate of
 * `POST /_gina/release/rebuild`). Runs in the background — follow progress
 * via `subscribe()` / `getStatus()`.
 *
 * @function requestRebuild
 * @param {object} [opts]
 * @param {string} [opts.restart='auto'] - 'auto' (idle-gated when restart-class) | 'force' (skip the idle gate) | 'skip' (build+flush only)
 * @param {string} [opts.requestedBy='operator']
 * @returns {{accepted:boolean, reason:(string|null)}}
 * @example
 *  var r = lib.releaseWatch.requestRebuild({ restart: 'auto' });
 *  // → { accepted: true, reason: null }
 */
var requestRebuild = function(opts) {
    opts = opts || {};
    if (!_svc || !_svc.active) {
        return { accepted: false, reason: 'inactive' };
    }
    if (_svc.action) {
        return { accepted: false, reason: 'busy' };
    }
    runPipeline({
        restart     : opts.restart || 'auto',
        requestedBy : opts.requestedBy || 'operator'
    });
    return { accepted: true, reason: null };
};

/**
 * Forces an in-progress idle gate open (the operator's "Force restart").
 *
 * @function forceRestartGate
 * @returns {boolean} True when a waiting gate was forced
 * @example
 *  lib.releaseWatch.forceRestartGate();
 */
var forceRestartGate = function() {
    if (!_svc || !_svc.action || _svc.action.state !== 'waiting') return false;
    _svc.action.force = true;
    return true;
};

/**
 * Disarms the service and releases every handle (tests; process teardown).
 *
 * @function deactivate
 * @returns {void}
 */
var deactivate = function() {
    if (!_svc) return;
    if (_svc.watcher) {
        try { _svc.watcher.close(); } catch (closeErr) { /* already gone */ }
    }
    if (_svc.autoTimer) clearTimeout(_svc.autoTimer);
    if (_svc.gateTimer) clearInterval(_svc.gateTimer);
    try { _svc.emitter.removeAllListeners(); } catch (emErr) { /* noop */ }
    _svc = null;
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
    reset                 : reset,
    // service (slice 2)
    init                  : init,
    isActive              : isActive,
    getStatus             : getStatus,
    subscribe             : subscribe,
    requestRebuild        : requestRebuild,
    forceRestartGate      : forceRestartGate,
    deactivate            : deactivate
};
