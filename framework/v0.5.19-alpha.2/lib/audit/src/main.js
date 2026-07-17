/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

'use strict';

/**
 * @module gina/lib/audit
 *
 * The #COMPLY2 audit-trail primitive — a user-attributed, append-only record
 * of "who did what to which record when", DISTINCT from `lib/logger`
 * (severity-level app logging): the trail has its own store and never rides
 * the logger sinks.
 *
 * - **Module-singleton.** Configuration and the store live at module scope and
 *   are adopted ONCE at bundle boot (`core/server.js` `init()` calls
 *   {@link start} after the fail-fast lint). Registered in `lib/index.js` with
 *   a plain `require` (never `_require`) — like `lib/job` / `State` / logger,
 *   `refreshCore()` re-runs `Lib()` on every dev-mode HTTP request, and
 *   `_require` would discard the adopted store + counters on each request.
 * - **File JSONL backend by default.** `audit.enabled: true` with no
 *   `audit.store` writes one JSON line per record to an append-only file
 *   (O_APPEND fd opened at boot — which also proves writability at boot).
 *   Writes are SERIALIZED through a FIFO queue: parallel `fs.write` calls on
 *   one fd complete in threadpool order, so without the queue the on-disk
 *   order could diverge from emit order — harmless for JSONL, fatal for the
 *   slice-3 HMAC hash chain (`hash = HMAC(key, prevHash + canonical(record))`),
 *   which is why the queue ships in the MVP.
 * - **Fire-and-forget by design.** A write failure is counted + logged
 *   (`console.error`) and NEVER thrown into the request path; the optional
 *   per-call callback is for callers that must confirm the write.
 * - **Correlation, not attribution.** `requestId` mirrors `req._ginaReqId`
 *   (always-on since #COMPLY2 slice 1) and honours a sanitized inbound
 *   `X-Request-Id`, so it is client-influenceable BY DESIGN — attribution is
 *   the `actor` snapshot (session-derived), never the id.
 * - **No require-time app dependency.** Node builtins only — the module loads
 *   standalone (the types-runtime-parity gate requires the whole lib registry
 *   at test load time).
 *
 * @package gina.framework
 * @namespace lib.audit
 * @author Rhinostone <contact@gina.io>
 */

var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');

/**
 * The audit store seam — what a backend must implement. The default file
 * backend ({@link createFileStore}) serializes records to JSONL; a connector
 * store (resolved by `lib/audit-store`, demand-gated) would persist the same
 * record object its own way.
 *
 * @typedef {object} AuditStore
 * @property {function(AuditRecord, function(?Error)=): void} append - Persist one record. MUST be append-only (never update/delete) and MUST report failure through the callback, never by throwing.
 * @property {function(): void} close - Release the backend handle. NOT called on the request path — provided for tests and explicit teardown.
 * @property {?string} [path] - The destination path when the backend is file-based (surfaced by {@link stats} and the boot log).
 */

/**
 * One audit record (schema v1 — the locked #COMPLY2 shape).
 *
 * @typedef {object} AuditRecord
 * @property {string}  id        - Record id (`crypto.randomUUID()`).
 * @property {number}  ts        - Epoch ms at emit time.
 * @property {?string} requestId - `req._ginaReqId` (always-on since slice 1); null off-request.
 * @property {{key: *, roles: string[]}} actor - Snapshot: `session.user[actorKey]` + a COPY of `user.roles`. NEVER the whole user object (PII).
 * @property {string}  action    - App-defined verb, e.g. `"invoice.delete"`; framework auto-events use `"authz.denied"`.
 * @property {*}       [resource] - App-defined subject, e.g. an id — present only when the caller passed one.
 * @property {object}  [meta]     - App-defined extras — present only when passed. Framework authz auto-events carry `{ outcome: '401'|'login-bounce'|'403-roles'|'403-policy' }` here.
 * @property {?string} ip        - Socket remoteAddress, `::ffff:`-normalized. `X-Forwarded-For` is NEVER read (the #OBS1 rule — that header is attacker-writable).
 * @property {?string} rule      - `req.routing.rule` (cardinality-safe, the metrics precedent).
 * @property {?string} method    - HTTP method.
 * @property {?string} bundle    - The booted bundle (captured at {@link start}).
 * @property {?string} env       - The booted env (captured at {@link start}).
 */

/**
 * Resolved configuration — adopted once by {@link start}, null until then.
 * `null` doubles as the "audit disabled" state: `core/server.js` only calls
 * `start()` when `settings.json > audit.enabled === true`.
 *
 * @inner
 * @type {?{bundle: ?string, env: ?string, actorKey: string, eventsAuthz: boolean}}
 */
var _conf = null;

/**
 * The adopted store ({@link AuditStore}), null until {@link start}.
 * @inner
 * @type {?AuditStore}
 */
var _store = null;

/** Records successfully persisted since boot. @inner @type {number} */
var _written = 0;

/** Records dropped (serialization or write failure, or a bad `action`). @inner @type {number} */
var _dropped = 0;

/** @inner */
function noop() {}

/**
 * Build the default append-only JSONL file backend.
 *
 * Creates the parent directory (recursive) and opens the file with the
 * `'a'` flag at BOOT — so an unwritable destination fails the boot (the
 * caller's #B57 catch), never the first request. Each record is one
 * `JSON.stringify(record) + '\n'` line; a record whose `meta` cannot be
 * stringified (circular) fails through the callback and is dropped by the
 * caller — other records are unaffected.
 *
 * Writes are serialized (one in-flight `fs.write` at a time, FIFO): O_APPEND
 * makes each line land whole, but only the queue makes on-disk ORDER match
 * emit order — the property the slice-3 hash chain needs.
 *
 * @inner
 * @param   {string} filePath - Absolute destination (`.jsonl`).
 * @returns {AuditStore}
 * @throws  {Error} When the directory cannot be created or the file cannot be opened for append.
 */
function createFileStore(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    var fd = fs.openSync(filePath, 'a');

    var queue   = [];
    var writing = false;

    var drain = function() {
        if (writing || queue.length === 0) return;
        writing = true;
        var item = queue.shift();
        fs.write(fd, item.line, function(err) {
            writing = false;
            item.cb(err || null);
            drain();
        });
    };

    return {
        path: filePath,
        append: function(record, cb) {
            cb = (typeof cb === 'function') ? cb : noop;
            var line;
            try {
                line = JSON.stringify(record) + '\n';
            } catch (serr) {
                return cb(serr);
            }
            queue.push({ line: line, cb: cb });
            drain();
        },
        close: function() {
            try { fs.closeSync(fd); } catch (cerr) { /* best-effort teardown */ }
        }
    };
}

/**
 * Snapshot the acting user off the request session.
 *
 * Reads `req.session.user` (the framework's authenticated contract — the
 * #COMPLY1 `isAuthenticated` predicate) and keeps exactly TWO things: the
 * configured `actorKey` property and a COPY of `user.roles`. The whole user
 * object is never stored (PII — the COMPLY5 synergy); `roles` is `.slice()`d
 * so a later in-request mutation cannot rewrite an already-emitted record.
 *
 * @inner
 * @param   {?object} req
 * @returns {{key: *, roles: string[]}} `{ key: null, roles: [] }` when unauthenticated or off-request.
 */
function deriveActor(req) {
    var user = (
        req && req.session && typeof req.session === 'object'
        && req.session.user && typeof req.session.user === 'object'
    ) ? req.session.user : null;

    if (!user) {
        return { key: null, roles: [] };
    }
    var key = (typeof user[_conf.actorKey] !== 'undefined' && user[_conf.actorKey] !== null)
        ? user[_conf.actorKey]
        : null;
    return {
        key   : key,
        roles : Array.isArray(user.roles) ? user.roles.slice() : []
    };
}

/**
 * Resolve the client IP from the SOCKET, never from headers.
 * `X-Forwarded-For` is deliberately not read (the #OBS1 rule — the header is
 * attacker-writable, and an audit trail must not let the audited party choose
 * its own recorded address). IPv6-mapped IPv4 (`::ffff:10.0.0.1`) is
 * normalized to the bare IPv4 form, mirroring `lib/metrics`.
 *
 * @inner
 * @param   {?object} req
 * @returns {?string}
 */
function resolveIp(req) {
    var ip = null;
    if (req && req.socket && req.socket.remoteAddress) {
        ip = req.socket.remoteAddress;
    } else if (req && req.connection && req.connection.remoteAddress) {
        ip = req.connection.remoteAddress;
    }
    if (!ip) return null;
    return ip.replace(/^::ffff:/i, '');
}

/**
 * Build one {@link AuditRecord}. Every request-derived read is null-safe by
 * construction, so a released request (`local.req` nulled at a terminal exit —
 * the #B35 class) still yields a DEGRADED record (`requestId`/`ip`/`rule`/
 * `method` null, `actor` `{key:null, roles:[]}`) instead of a crash or a
 * dropped record — for a compliance trail, present-but-degraded beats absent.
 *
 * @inner
 * @param   {string} action
 * @param   {{req: ?object, resource: *, meta: *, actor: *}} fields
 * @returns {AuditRecord}
 */
function buildRecord(action, fields) {
    var req = fields.req || null;

    var record = {
        id        : crypto.randomUUID(),
        ts        : Date.now(),
        requestId : (req && typeof req._ginaReqId === 'string') ? req._ginaReqId : null,
        actor     : (fields.actor && typeof fields.actor === 'object') ? fields.actor : deriveActor(req),
        action    : action
    };
    if (typeof fields.resource !== 'undefined') {
        record.resource = fields.resource;
    }
    if (typeof fields.meta !== 'undefined') {
        record.meta = fields.meta;
    }
    record.ip     = resolveIp(req);
    record.rule   = (req && req.routing && typeof req.routing.rule === 'string') ? req.routing.rule : null;
    record.method = (req && typeof req.method === 'string') ? req.method : null;
    record.bundle = _conf.bundle;
    record.env    = _conf.env;

    return record;
}

/**
 * Adopt the boot-resolved configuration + store. Called ONCE by
 * `core/server.js` `init()` when `settings.json > audit.enabled === true`,
 * AFTER the fail-fast lint. Adoption is once-only (the `lib/job` precedent):
 * a second call is refused loudly — silently swapping the store mid-flight
 * would strand the earlier records.
 *
 * Building the default file store here (rather than at the first write) is
 * deliberate: `mkdirSync` + `openSync` throw on an unwritable destination, and
 * the caller's enclosing #B57 catch turns that into a boot refusal — an audit
 * trail that silently cannot write is the quietly-OFF class the lint exists
 * to prevent.
 *
 * @memberof module:gina/lib/audit
 * @param {object}  opts
 * @param {?string} [opts.bundle]      - The booted bundle name (stamped on every record).
 * @param {?string} [opts.env]         - The booted env (stamped on every record).
 * @param {string}  [opts.actorKey=id] - `session.user` property snapshotted as `actor.key`.
 * @param {boolean} [opts.eventsAuthz=true] - Framework authz auto-events ({@link emitAuthzDenied}).
 * @param {AuditStore} [opts.store]    - A pre-built store (the `lib/audit-store` dispatcher path).
 * @param {string}  [opts.file]        - JSONL destination for the default file backend (required when no `store`).
 * @returns {boolean} `true` when adopted, `false` when already configured.
 * @throws  {Error} When neither `store` nor `file` is given, or the file destination cannot be opened for append.
 *
 * @example
 *   lib.audit.start({ bundle: 'web', env: 'prod', actorKey: 'id', file: '/srv/app/logs/audit-web-prod.jsonl' });
 */
function start(opts) {
    opts = opts || {};
    if (_conf) {
        console.warn('[audit] start: the audit trail is already configured — the new options were ignored.');
        return false;
    }

    var store = null;
    if (opts.store && typeof opts.store === 'object') {
        store = opts.store;
    } else if (typeof opts.file === 'string' && opts.file.length > 0) {
        store = createFileStore(opts.file); // throws on unwritable — the caller's #B57 catch owns it
    } else {
        throw new Error('[audit] start needs a `store` or a `file` destination.');
    }

    _conf = {
        bundle      : opts.bundle || null,
        env         : opts.env || null,
        actorKey    : (typeof opts.actorKey === 'string' && opts.actorKey.length > 0) ? opts.actorKey : 'id',
        eventsAuthz : (opts.eventsAuthz !== false)
    };
    _store = store;
    return true;
}

/**
 * Whether the trail is active (configured + store adopted). `false` means
 * every {@link write} is a benign no-op — `enabled` is deployment config, so
 * application code never needs to branch on it.
 *
 * @memberof module:gina/lib/audit
 * @returns {boolean}
 */
function isEnabled() {
    return !!(_conf && _store);
}

/**
 * Emit one audit record — the single write entry point (`self.audit()` and
 * the framework auto-events both land here).
 *
 * Fire-and-forget by default: a failure is counted ({@link stats} `dropped`)
 * and logged via `console.error`, never thrown into the request path. Pass a
 * callback to observe the write result (`cb(err)`); when the trail is
 * disabled the callback gets `cb(null)` — a vacuous success, so callers stay
 * config-agnostic.
 *
 * @memberof module:gina/lib/audit
 * @param {string}   action     - App-defined verb (`"invoice.delete"`). Non-empty string, else the record is dropped (counted + logged, never thrown).
 * @param {object}   [fields]   - `{ req, resource, meta, actor }` — all optional; `actor` overrides the session-derived snapshot.
 * @param {function(?Error)} [cb] - Optional write confirmation.
 * @returns {void}
 *
 * @example
 *   lib.audit.write('invoice.delete', { req: req, resource: invoiceId });
 */
function write(action, fields, cb) {
    if (typeof fields === 'function') { cb = fields; fields = null; }
    cb     = (typeof cb === 'function') ? cb : noop;
    fields = (fields && typeof fields === 'object') ? fields : {};

    if ( !isEnabled() ) {
        return cb(null);
    }
    if (typeof action !== 'string' || action.length === 0) {
        _dropped++;
        console.error('[audit] dropped a record: `action` must be a non-empty string (got: '+ JSON.stringify(action) +')');
        return cb(new Error('[audit] `action` must be a non-empty string'));
    }

    var record = buildRecord(action, fields);
    _store.append(record, function(err) {
        if (err) {
            _dropped++;
            console.error('[audit] write failed — the record was dropped (dropped so far: '+ _dropped +'): '+ (err.message || err));
            return cb(err);
        }
        _written++;
        return cb(null);
    });
}

/**
 * Framework auto-event for an authorization denial (#COMPLY2 locked decision
 * 3 — ON by default when the trail is enabled; `settings.json >
 * audit.events.authz: false` opts out). Called by `lib/authz-gate`'s two deny
 * writers; the outcome (`'401'` / `'login-bounce'` / `'403-roles'` /
 * `'403-policy'`) rides in `meta.outcome`, so the record schema stays v1.
 *
 * The WHOLE body is contained: an audit failure must never change an
 * authorization outcome, so nothing here can throw into the gate.
 *
 * Flood caveat (documented, accepted): unauthenticated 401s make this an
 * attacker-writable line — like any log line; throttling is COMPLY6's job.
 *
 * @memberof module:gina/lib/audit
 * @param {?object} req     - The denied request (actor derives from its session when present).
 * @param {string}  outcome - `'401' | 'login-bounce' | '403-roles' | '403-policy'`.
 * @returns {void}
 */
function emitAuthzDenied(req, outcome) {
    try {
        if ( !isEnabled() || _conf.eventsAuthz === false ) {
            return;
        }
        write('authz.denied', { req: req, meta: { outcome: String(outcome || 'denied') } });
    } catch (err) {
        try { console.error('[audit] authz auto-event failed (the denial itself is unaffected): '+ (err.message || err)); } catch (e2) { /* never escalate */ }
    }
}

/**
 * Counters + destination snapshot — for tests and the boot log.
 *
 * @memberof module:gina/lib/audit
 * @returns {{enabled: boolean, written: number, dropped: number, path: ?string}}
 */
function stats() {
    return {
        enabled : isEnabled(),
        written : _written,
        dropped : _dropped,
        path    : (_store && _store.path) || null
    };
}

/**
 * Test-only teardown: close the store, reset config + counters so the next
 * `start()` adopts fresh. Never called on a production path (adoption is
 * once-per-boot by design).
 *
 * @memberof module:gina/lib/audit
 * @returns {void}
 */
function _resetForTest() {
    if (_store && typeof _store.close === 'function') {
        try { _store.close(); } catch (err) { /* best-effort */ }
    }
    _conf    = null;
    _store   = null;
    _written = 0;
    _dropped = 0;
}

module.exports = {
    start           : start,
    isEnabled       : isEnabled,
    write           : write,
    emitAuthzDenied : emitAuthzDenied,
    stats           : stats,
    _resetForTest   : _resetForTest
};
