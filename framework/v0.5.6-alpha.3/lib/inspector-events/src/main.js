/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

'use strict';

/**
 * @module inspectorEvents
 *
 * #EVTBUS — observable application-event emit hook for the Inspector.
 *
 * Lets a bundle surface a named runtime event (e.g. `order.created`) so it
 * shows up in the Inspector's Event tab — both as a live `inspector#event`
 * frame (streamed over `/_gina/agent`) and in the end-of-request `user.events`
 * snapshot (carried on `inspector#data`). This is an OBSERVABILITY hook, NOT a
 * general pub/sub bus: the only subscriber is the Inspector, so when neither the
 * dev term nor an instrumentation window is open the emit is a cheap no-op with
 * zero subscribers.
 *
 * Mirrors the #AISTREAM AI-token signal. The per-request buffer is a sibling
 * KEY (`_devEventLog`) inside the single `process.gina._queryALS` store (set up
 * in controller.js `setOptions` alongside `_devQueryLog` / `_devAiLog`), reached
 * here via `getStore()`. Capture is gated on the dev term OR an open
 * instrumentation window — identical to the query / AI capture gates.
 *
 * Metadata safety: the event NAME plus framework stamps (`id`, `t`) always ride
 * the wire; the caller-supplied `metadata` object's VALUES ride ONLY when
 * `settings.inspector.events.captureArgs` is enabled (seeded onto
 * `process.gina._inspectorEventsCaptureArgs` at boot, default false). This
 * mirrors #AISTREAM's `captureText`: `lib/inspector-redact` matches secret-NAMED
 * keys only and cannot sanitise arbitrary argument VALUES, so the protection is
 * the gate + the opt-in + the authenticated channel — never redaction.
 *
 * Stateless (no module-scope registry or timer — only a monotonic counter whose
 * uniqueness does not depend on surviving a reset), so it is registered in
 * lib/index.js via the dev-mode-hot-reloadable `_require`.
 *
 * @package gina.framework
 * @namespace inspectorEvents
 * @author Rhinostone <contact@gina.io>
 */

/**
 * Monotonic per-process counter giving each emitted event a unique id suffix
 * (disambiguates events that share a millisecond on the client). Uniqueness does
 * not rely on this surviving a `refreshCore()` reset — the timestamp component
 * keeps ids distinct across requests regardless.
 * @type {number}
 * @private
 */
var _eventSeq = 0;

/**
 * Emit an observable application event into the per-request Inspector buffer and
 * the live `inspector#event` stream. No-op (returns `false`) when the dev/window
 * gate is closed, when `name` is invalid, OR when called outside a request's
 * async context (no ALS store — e.g. from a detached timer or a background job).
 *
 * @param {string} name        - Dotted event name, e.g. `'order.created'`. Required, non-empty.
 * @param {Object} [metadata]  - Optional structured metadata. Its VALUES reach the
 *                               wire only when `settings.inspector.events.captureArgs`
 *                               is enabled (default off); the event name + stamps
 *                               always do.
 * @returns {boolean} `true` if the event was captured, `false` if gated out / no context.
 *
 * @example
 * // From a controller action (preferred — see self.emitEvent):
 * self.emitEvent('order.created', { orderId: order.id });
 *
 * @example
 * // From model / service code (no `self`), via the bare-module resolver:
 * require('lib/inspector-events').emit('cache.miss', { key: k });
 */
function emit(name, metadata) {
    if (typeof name !== 'string' || name.length === 0) {
        return false;
    }
    // Gate: dev term OR an open instrumentation window — identical to the
    // query-connector and AI-stream capture gates.
    var envIsDev = ( /^true$/i.test(process.env.NODE_ENV_IS_DEV) );
    if ( !( envIsDev || (process.gina && process.gina._inspectorWindowUntil > Date.now()) ) ) {
        return false;
    }
    // Reach the per-request buffer via the shared `_queryALS` store. Outside a
    // request's async context `getStore()` is undefined → graceful no-op (mirrors
    // the AI connector's `_aiAls ? _aiAls._devAiLog : null` guard).
    var store = (process.gina && process.gina._queryALS) ? process.gina._queryALS.getStore() : null;
    var buf   = store ? store._devEventLog : null;
    if (!buf) {
        return false;
    }

    var captureArgs = !!(process.gina && process.gina._inspectorEventsCaptureArgs);
    var t  = Date.now();
    var id = 'ev-' + t.toString(36) + '-' + (++_eventSeq);

    // Buffer entry (→ `user.events` snapshot). The metadata object is attached
    // only when captureArgs is on; on the snapshot path it still passes through
    // lib/inspector-redact (secret-NAMED keys masked), but values are NOT relied
    // upon to be safe — the opt-in is the contract.
    var entry = {
        type : 'event',
        id   : id,
        name : name,
        t    : t
    };
    if (captureArgs && metadata && typeof metadata === 'object') {
        entry.meta = metadata;
    }
    buf.push(entry);

    // Live frame (→ `inspector#event` → `event: event` SSE / `{event:'event'}`
    // WS). NOT run through redact() — the free-text channel relies on the gate +
    // the authenticated transport (per #AISTREAM); ships metadata values only
    // when captureArgs is on.
    var frame = { name: name, id: id, t: t };
    if (captureArgs && metadata && typeof metadata === 'object') {
        frame.meta = metadata;
    }
    process.emit('inspector#event', frame);
    return true;
}

module.exports = {
    emit : emit
};
