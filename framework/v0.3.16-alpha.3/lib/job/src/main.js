/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module gina/lib/job
 *
 * Async-job primitive (#AI6). Runs a deferred async function out-of-band so a slow
 * call (e.g. an LLM `.infer()` taking 1-30s) does not tie up the request
 * pipeline under load: a controller calls `lib.job.create(fn)` (or
 * `self.startJob(fn)`), gets a `jobId` back immediately, returns it to the
 * client, and the client polls `/_gina/jobs/:id` (or, later, receives a
 * webhook) for the outcome.
 *
 * Design notes:
 *   - **Module-singleton.** The registry, worker state, and sweep timer live
 *     at module scope. Registered in `lib/index.js` with a PLAIN `require`
 *     (like `State` / `logger`) so `refreshCore()` does not discard the live
 *     registry or orphan the sweep timer on every dev-mode HTTP request.
 *   - **Concurrency-limited worker.** At most `maxConcurrency` (default 4)
 *     deferred functions run at once; the rest queue. This is the whole point
 *     of moving the work out-of-band — a burst of requests must not fan out
 *     into N unbounded concurrent (and expensive) LLM calls.
 *   - **Pluggable store, memory in v1.** Records persist behind a small
 *     callback-shaped store interface (`set / get / remove / list / sweep`).
 *     v1 ships the in-memory store; a connector-backed store (for multi-pod,
 *     where a job created on one pod is polled on another) is a drop-in
 *     follow-up — no API change, because the interface is callback-shaped
 *     from day one. The deferred *function* always lives in the creating
 *     process's memory (a closure cannot be serialised); only the *record*
 *     (state / result / error) goes in the store.
 *   - **Self-contained TTL sweep.** Terminal (completed / failed) records past
 *     their TTL are purged by an unref'd `setInterval` (the SQLite
 *     session-store cleanup pattern) — NOT `lib/cron`, which is dormant (not
 *     registered in `lib/index.js`, not instantiated at boot). A bundle may
 *     drive an extra sweep from its own cron, but the internal timer
 *     guarantees baseline retention regardless.
 *
 * The primitive is always-on. Optional tuning via `app.json` (an absent block
 * means sane defaults):
 *
 *     {
 *       "jobs": {
 *         "maxConcurrency": 4,
 *         "ttl":           3600,
 *         "sweepInterval":  300,
 *         "idSize":          21
 *       }
 *     }
 *
 * `core/gna.js`'s `server.on('started')` callback calls `lib.job.start(...)`
 * once per bundle with this block.
 *
 * @package    gina.framework
 * @namespace  lib.job
 * @author     Rhinostone <contact@gina.io>
 */

'use strict';

/**
 * Cryptographically-secure base-62 id generator (zero-dep, nanoid-style).
 * Required directly rather than via the `lib` registry so the primitive has
 * no dependency on global-injection ordering.
 *
 * @inner
 * @type {function(number=): string}
 */
var uuid = require('../../uuid/src/main');

/**
 * Job lifecycle states. A job moves `PENDING -> RUNNING -> COMPLETED | FAILED`.
 * A terminal `FAILED` job may be returned to `PENDING` only by an explicit
 * retry (sweeper-driven; not implemented in v1).
 *
 * @memberof module:gina/lib/job
 * @constant
 * @type {{PENDING:string, RUNNING:string, COMPLETED:string, FAILED:string}}
 */
var STATES = {
    PENDING:   'pending',
    RUNNING:   'running',
    COMPLETED: 'completed',
    FAILED:    'failed'
};

/**
 * Default maximum number of deferred functions running concurrently.
 *
 * @memberof module:gina/lib/job
 * @constant
 * @type {number}
 */
var DEFAULT_MAX_CONCURRENCY = 4;

/**
 * Default time-to-live (seconds) for a terminal record before the sweep
 * purges it.
 *
 * @memberof module:gina/lib/job
 * @constant
 * @type {number}
 */
var DEFAULT_TTL = 3600;

/**
 * Default interval (seconds) between sweep passes. `0` disables the internal
 * timer (used by tests that call {@link sweep} manually).
 *
 * @memberof module:gina/lib/job
 * @constant
 * @type {number}
 */
var DEFAULT_SWEEP_INTERVAL = 300;

/**
 * Default jobId length (characters). 21 base-62 chars is nanoid-equivalent
 * entropy — long enough that the id is unguessable, since the id is the
 * capability token for the status endpoint.
 *
 * @memberof module:gina/lib/job
 * @constant
 * @type {number}
 */
var DEFAULT_ID_SIZE = 21;

/**
 * The active record store (memory store by default). `null` until the first
 * {@link create} or {@link start}.
 *
 * @inner
 * @type {JobStore|null}
 */
var _store = null;

/**
 * In-flight worker count. Bounded by {@link _maxConcurrency}.
 *
 * @inner
 * @type {number}
 */
var _running = 0;

/**
 * Pending `{ id, fn }` entries waiting for a worker slot. The deferred
 * function lives here (in-process), never in the store.
 *
 * @inner
 * @type {Array<{id:string, fn:function}>}
 */
var _queue = [];

/** @inner @type {number} */
var _maxConcurrency = DEFAULT_MAX_CONCURRENCY;
/** @inner @type {number} */
var _ttl = DEFAULT_TTL;
/** @inner @type {number} */
var _sweepInterval = DEFAULT_SWEEP_INTERVAL;
/** @inner @type {number} */
var _idSize = DEFAULT_ID_SIZE;
/** @inner @type {*} */
var _sweepTimer = null;

/**
 * No-op callback used when a caller omits one.
 * @inner
 * @returns {void}
 */
function noop() {}

/**
 * @typedef  {Object} JobRecord
 * @property {string}      id          - Unguessable base-62 job id.
 * @property {string}      state       - One of {@link STATES}.
 * @property {*}           result      - The resolved value once `completed`; `null` otherwise.
 * @property {?{name:string, message:string, stack:?string}} error - Serialised error once `failed`; `null` otherwise.
 * @property {number}      attempts    - How many times the worker has run the function.
 * @property {number}      maxAttempts - Retry ceiling (1 in v1 — retry is a follow-up).
 * @property {?string}     callbackUrl - Webhook URL for completion delivery (consumed by the webhook slice).
 * @property {?Object}     meta        - Caller-supplied opaque metadata.
 * @property {number}      createdAt   - Epoch ms at creation.
 * @property {number}      updatedAt   - Epoch ms of the last transition.
 * @property {?number}     startedAt   - Epoch ms the worker began; `null` while pending.
 * @property {?number}     finishedAt  - Epoch ms of the terminal transition; `null` until then.
 * @property {?number}     expiresAt   - Epoch ms after which a terminal record is sweepable; `null` until terminal.
 */

/**
 * @typedef  {Object} JobStore
 * @description Callback-shaped persistence seam. The memory store is the v1
 * implementation; a connector-backed store implements the same five methods.
 * @property {function(string, JobRecord, function=): void}        set    - Upsert `record` under `id`; `fn(err, record)`.
 * @property {function(string, function): void}                    get    - Fetch by `id`; `fn(err, record|null)`.
 * @property {function(string, function=): void}                   remove - Delete by `id`; `fn(err, existed)`.
 * @property {function(?Object, function): void}                   list   - List records matching `filter` (e.g. `{state}`); `fn(err, records)`.
 * @property {function(number, function): void}                    sweep  - Delete terminal records with `expiresAt <= now`; `fn(err, removedCount)`.
 */

/**
 * Build the default in-memory {@link JobStore}. Records are held in a
 * null-prototype map keyed by id; all callbacks fire synchronously.
 *
 * @inner
 * @returns {JobStore}
 */
function createMemoryStore() {
    var map = Object.create(null);
    return {
        set: function(id, record, fn) {
            map[id] = record;
            if (typeof fn === 'function') fn(null, record);
        },
        get: function(id, fn) {
            fn(null, Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null);
        },
        remove: function(id, fn) {
            var existed = Object.prototype.hasOwnProperty.call(map, id);
            if (existed) delete map[id];
            if (typeof fn === 'function') fn(null, existed);
        },
        list: function(filter, fn) {
            var out = [];
            for (var k in map) {
                if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
                var rec = map[k];
                if (filter && filter.state && rec.state !== filter.state) continue;
                out.push(rec);
            }
            fn(null, out);
        },
        sweep: function(now, fn) {
            var removed = 0;
            for (var k in map) {
                if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
                var rec = map[k];
                if (
                    rec.expiresAt && rec.expiresAt <= now
                    && (rec.state === STATES.COMPLETED || rec.state === STATES.FAILED)
                ) {
                    delete map[k];
                    removed++;
                }
            }
            fn(null, removed);
        }
    };
}

/**
 * Coerce any thrown / rejected value into a serialisable error shape. Never
 * store a raw `Error` (its `message` / `stack` are non-enumerable and would
 * vanish through a connector store's `JSON.stringify`).
 *
 * @inner
 * @param   {*} err
 * @returns {?{name:string, message:string, stack:?string}}
 */
function serializeError(err) {
    if (err === null || typeof err === 'undefined') return null;
    if (err instanceof Error) {
        return {
            name:    err.name || 'Error',
            message: err.message || String(err),
            stack:   err.stack || null
        };
    }
    if (typeof err === 'object') {
        var msg;
        try { msg = err.message || JSON.stringify(err); }
        catch (e) { msg = String(err); }
        return { name: err.name || 'Error', message: msg, stack: err.stack || null };
    }
    return { name: 'Error', message: String(err), stack: null };
}

/**
 * Ensure the store and sweep timer exist with the current settings. Called by
 * {@link create} so the primitive works even if {@link start} was never
 * invoked (defaults apply).
 *
 * @inner
 * @returns {void}
 */
function ensureStarted() {
    if (!_store) {
        _store = createMemoryStore();
    }
    ensureSweepTimer();
}

/**
 * Lazily arm the unref'd sweep timer. `unref()` is load-bearing: it lets the
 * process exit cleanly instead of the timer keeping the event loop alive.
 *
 * @inner
 * @returns {void}
 */
function ensureSweepTimer() {
    if (!_sweepTimer && _sweepInterval > 0) {
        _sweepTimer = setInterval(function() { sweep(noop); }, _sweepInterval * 1000);
        if (_sweepTimer && typeof _sweepTimer.unref === 'function') {
            _sweepTimer.unref();
        }
    }
}

/**
 * Pump the queue: while a worker slot is free and a job is waiting, start it.
 * Re-entrancy is safe — settlement always runs on a later microtask (see
 * {@link runOne}), never synchronously inside this loop.
 *
 * @inner
 * @returns {void}
 */
function drain() {
    while (_running < _maxConcurrency && _queue.length > 0) {
        var entry = _queue.shift();
        _running++;
        runOne(entry);
    }
}

/**
 * Transition a job to `running`, invoke its deferred function, and route the
 * outcome to {@link settle}. The function is invoked from inside a resolved
 * Promise so a synchronous `throw` and an async rejection take the identical
 * failure path and settlement is always deferred (no re-entrant {@link drain}).
 *
 * @inner
 * @param   {{id:string, fn:function}} entry
 * @returns {void}
 */
function runOne(entry) {
    var id = entry.id;
    _store.get(id, function(getErr, rec) {
        if (getErr || !rec) {
            // Record vanished (swept / removed) before the worker picked it up.
            _running--;
            drain();
            return;
        }
        rec.state     = STATES.RUNNING;
        rec.startedAt = Date.now();
        rec.updatedAt = rec.startedAt;
        rec.attempts  = (rec.attempts || 0) + 1;
        _store.set(id, rec, function() {
            Promise.resolve().then(function() {
                return entry.fn();
            }).then(function(result) {
                settle(id, result, null);
            }, function(rejErr) {
                settle(id, null, rejErr);
            });
        });
    });
}

/**
 * Write the terminal state for a job, free the worker slot, and pump the
 * queue again.
 *
 * @inner
 * @param   {string} id
 * @param   {*}      result - Resolved value on success.
 * @param   {*}      err    - Thrown / rejected value on failure (mutually exclusive with `result`).
 * @returns {void}
 */
function settle(id, result, err) {
    var now   = Date.now();
    var patch = err
        ? { state: STATES.FAILED,    error: serializeError(err), finishedAt: now, expiresAt: now + _ttl * 1000 }
        : { state: STATES.COMPLETED, result: result,             finishedAt: now, expiresAt: now + _ttl * 1000 };

    update(id, patch, function() {
        _running--;
        drain();
    });
}

/**
 * Get-merge-set a partial patch onto a record. Store-agnostic (works for the
 * sync memory store and a future async connector store).
 *
 * @inner
 * @param   {string}   id
 * @param   {Object}   patch
 * @param   {function} [cb] - `cb(err, record)`.
 * @returns {void}
 */
function update(id, patch, cb) {
    _store.get(id, function(err, rec) {
        if (err || !rec) { if (cb) cb(err || null, null); return; }
        for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) rec[k] = patch[k];
        }
        rec.updatedAt = Date.now();
        _store.set(id, rec, function(setErr) {
            if (cb) cb(setErr || null, rec);
        });
    });
}

/**
 * Create and enqueue a job. Returns the `jobId` synchronously — the deferred
 * function starts on a later tick, so the caller can return the id to the
 * client before the slow work begins.
 *
 * Note: the deferred function runs AFTER the originating request has
 * completed. It must not close over `local.req` / `local.res` (the controller
 * nulls those at response exit) — capture plain values instead.
 *
 * @memberof module:gina/lib/job
 * @param   {function(): (Promise<*>|*)} fn   - The deferred work. May be `async`, return a Promise, or return a value synchronously.
 * @param   {Object}   [opts]
 * @param   {string}   [opts.callbackUrl]     - Webhook URL notified on completion (consumed by the webhook slice).
 * @param   {Object}   [opts.meta]            - Opaque metadata stored on the record.
 * @param   {number}   [opts.maxAttempts=1]   - Retry ceiling (retry is a follow-up; v1 runs once).
 * @returns {string}                          - The job id.
 * @throws  {TypeError}                        - When `fn` is not a function.
 *
 * @example
 *   // In a controller action — return immediately, work runs out-of-band:
 *   var jobId = self.startJob(function() {
 *       return getModel('myModel').infer([{ role: 'user', content: prompt }]);
 *   });
 *   self.renderJSON({ jobId: jobId });
 */
function create(fn, opts) {
    if (typeof fn !== 'function') {
        throw new TypeError('lib.job.create: fn must be a function');
    }
    opts = opts || {};
    ensureStarted();

    var id  = uuid(_idSize);
    var now = Date.now();
    /** @type {JobRecord} */
    var record = {
        id:          id,
        state:       STATES.PENDING,
        result:      null,
        error:       null,
        attempts:    0,
        maxAttempts: (typeof opts.maxAttempts === 'number' && opts.maxAttempts > 0) ? Math.floor(opts.maxAttempts) : 1,
        callbackUrl: (typeof opts.callbackUrl === 'string' && opts.callbackUrl.length > 0) ? opts.callbackUrl : null,
        meta:        (opts.meta && typeof opts.meta === 'object') ? opts.meta : null,
        createdAt:   now,
        updatedAt:   now,
        startedAt:   null,
        finishedAt:  null,
        expiresAt:   null
    };

    _store.set(id, record, noop);
    _queue.push({ id: id, fn: fn });
    // Defer so create() returns the id before the function starts.
    setImmediate(drain);
    return id;
}

/**
 * Fetch a job record by id. Returns the full record (treat as read-only) so a
 * bundle's own authenticated route can read `result`. The built-in
 * `/_gina/jobs/:id` endpoint projects this to state-only via
 * {@link toStatusView}.
 *
 * @memberof module:gina/lib/job
 * @param   {string}   id
 * @param   {function} cb - `cb(err, record|null)`.
 * @returns {void}
 *
 * @example
 *   // In an authenticated controller action retrieving the result:
 *   self.jobStatus(req.params.id, function(err, job) {
 *       if (err || !job)              return self.throwError(404, 'unknown job');
 *       if (job.state !== 'completed') return self.renderJSON({ state: job.state });
 *       return self.renderJSON({ state: job.state, result: job.result });
 *   });
 */
function get(id, cb) {
    if (typeof cb !== 'function') cb = noop;
    if (!_store) { cb(null, null); return; }
    _store.get(id, function(err, rec) {
        cb(err || null, rec || null);
    });
}

/**
 * List job records, optionally filtered.
 *
 * @memberof module:gina/lib/job
 * @param   {?Object}  [filter]       - e.g. `{ state: 'failed' }`. Omit / `null` for all.
 * @param   {function} cb             - `cb(err, records)`.
 * @returns {void}
 *
 * @example
 *   lib.job.list({ state: 'running' }, function(err, jobs) { ... });
 */
function list(filter, cb) {
    if (typeof filter === 'function') { cb = filter; filter = null; }
    if (typeof cb !== 'function') cb = noop;
    if (!_store) { cb(null, []); return; }
    _store.list(filter || null, cb);
}

/**
 * Remove a job record by id.
 *
 * @memberof module:gina/lib/job
 * @param   {string}   id
 * @param   {function} [cb] - `cb(err, existed)`.
 * @returns {void}
 */
function remove(id, cb) {
    if (typeof cb !== 'function') cb = noop;
    if (!_store) { cb(null, false); return; }
    _store.remove(id, cb);
}

/**
 * Purge terminal records whose TTL has elapsed. Invoked automatically by the
 * internal timer; also callable directly (e.g. from a bundle cron, or a test).
 *
 * @memberof module:gina/lib/job
 * @param   {function} [cb] - `cb(err, removedCount)`.
 * @returns {void}
 *
 * @example
 *   lib.job.sweep(function(err, removed) { ... });
 */
function sweep(cb) {
    if (typeof cb !== 'function') cb = noop;
    if (!_store) { cb(null, 0); return; }
    _store.sweep(Date.now(), cb);
}

/**
 * Configure the primitive. Idempotent for resources (the store and sweep timer
 * are created at most once); knob arguments, when provided, always re-apply.
 * Called once per bundle from `gna.js`'s `server.on('started')`; safe before
 * the first {@link create}.
 *
 * @memberof module:gina/lib/job
 * @param   {Object}   [opts]
 * @param   {number}   [opts.maxConcurrency=4]   - Max concurrent workers.
 * @param   {number}   [opts.ttl=3600]           - Terminal-record TTL (seconds).
 * @param   {number}   [opts.sweepInterval=300]  - Sweep interval (seconds); `0` disables the internal timer.
 * @param   {number}   [opts.idSize=21]          - jobId length (characters).
 * @param   {JobStore} [opts.store]              - Custom store (e.g. connector-backed). Defaults to the in-memory store.
 * @returns {boolean}                            - Always `true`.
 *
 * @example
 *   // Production (called by gna.js when the bundle starts):
 *   lib.job.start({ maxConcurrency: 8, ttl: 1800 });
 */
function start(opts) {
    opts = opts || {};
    if (typeof opts.maxConcurrency === 'number' && opts.maxConcurrency > 0) {
        _maxConcurrency = Math.floor(opts.maxConcurrency);
    }
    if (typeof opts.ttl === 'number' && opts.ttl > 0) {
        _ttl = Math.floor(opts.ttl);
    }
    if (typeof opts.sweepInterval === 'number' && opts.sweepInterval >= 0) {
        _sweepInterval = Math.floor(opts.sweepInterval);
    }
    if (typeof opts.idSize === 'number' && opts.idSize > 0) {
        _idSize = Math.floor(opts.idSize);
    }
    if (!_store) {
        _store = (opts.store && typeof opts.store === 'object') ? opts.store : createMemoryStore();
    }
    ensureSweepTimer();
    return true;
}

/**
 * Snapshot of worker state. Useful for tests (asserting the concurrency cap)
 * and a future admin view.
 *
 * @memberof module:gina/lib/job
 * @returns {{running:number, queued:number, maxConcurrency:number}}
 */
function stats() {
    return { running: _running, queued: _queue.length, maxConcurrency: _maxConcurrency };
}

/**
 * Project a record to the state-only view exposed by the always-on
 * `/_gina/jobs/:id` endpoint. Deliberately omits `result` / `error` so the
 * public polling surface never leaks job payloads — authenticated result
 * retrieval goes through a bundle's own route via {@link get}.
 *
 * @memberof module:gina/lib/job
 * @param   {?JobRecord} rec
 * @returns {?{id:string, state:string, createdAt:number, updatedAt:number}}
 *
 * @example
 *   var view = lib.job.toStatusView(rec); // { id, state, createdAt, updatedAt }
 */
function toStatusView(rec) {
    if (!rec) return null;
    return {
        id:        rec.id,
        state:     rec.state,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt
    };
}

/**
 * Clear all module-level state and stop the sweep timer. Test-only — callers
 * holding job ids see them disappear.
 *
 * @memberof module:gina/lib/job
 * @returns {void}
 */
function reset() {
    if (_sweepTimer) {
        clearInterval(_sweepTimer);
        _sweepTimer = null;
    }
    _store          = null;
    _queue          = [];
    _running        = 0;
    _maxConcurrency = DEFAULT_MAX_CONCURRENCY;
    _ttl            = DEFAULT_TTL;
    _sweepInterval  = DEFAULT_SWEEP_INTERVAL;
    _idSize         = DEFAULT_ID_SIZE;
}

module.exports = {
    create:                 create,
    get:                    get,
    list:                   list,
    remove:                 remove,
    sweep:                  sweep,
    start:                  start,
    stats:                  stats,
    toStatusView:           toStatusView,
    reset:                  reset,
    STATES:                 STATES,
    DEFAULT_MAX_CONCURRENCY: DEFAULT_MAX_CONCURRENCY,
    DEFAULT_TTL:            DEFAULT_TTL,
    DEFAULT_SWEEP_INTERVAL: DEFAULT_SWEEP_INTERVAL,
    DEFAULT_ID_SIZE:        DEFAULT_ID_SIZE
};
