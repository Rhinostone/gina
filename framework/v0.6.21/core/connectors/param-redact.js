/**
 * @module param-redact
 *
 * #B350 — redaction of bound query parameter VALUES (and value-bearing
 * statement bodies) before they reach developer-facing sinks: the dev-mode
 * console lines and the per-request Inspector query log (`_devQueryLog`).
 *
 * Why this exists: a bound parameter's sensitivity is a property of the
 * calling application that a connector cannot infer — a bind value may be a
 * session or credential token, an API key, a password hash. The key-based
 * `lib/inspector-redact` cannot help here: it matches on KEY NAMES, and a
 * positional bind array has no keys. So the fail-safe default is to log the
 * SHAPE (count + types — arity and coercion bugs stay diagnosable) and let a
 * developer opt in to real values via `settings.inspector.queries.captureValues`
 * (seeded onto `process.gina._inspectorQueryCaptureValues` at boot, default
 * false — same contract as `inspector.ai.captureText` and
 * `inspector.events.captureArgs`).
 *
 * Consumers: the query-capable connectors (couchbase, postgresql, mysql,
 * sqlite, duckdb, scylladb, mongodb). The AI connector needs nothing from
 * this module — its value-class capture (prompt text) is already gated by
 * `inspector.ai.captureText`.
 *
 * Loaded with a relative require like the sibling `sql-parser` — connectors
 * are load-once modules, and this module must stay dependency-free (no lib
 * registry, no logger) so it can never affect a query path.
 */

'use strict';

/**
 * Classify a single bound value into a bracketed type marker.
 *
 * Never returns the value itself, only its type family — `Buffer` and `Date`
 * get their own markers because they are common bind types whose family is
 * more diagnostic than a bare `[object]`.
 *
 * @memberof module:param-redact
 * @param {*} value - a single bound parameter value
 * @returns {string} a marker like `[string]`, `[number]`, `[null]`, `[buffer]`
 *
 * @example
 * typeMarker('abc')        // -> '[string]'
 * @example
 * typeMarker(null)         // -> '[null]'
 */
function typeMarker(value) {
    if (value === null) return '[null]';
    var t = typeof value;
    if (t === 'undefined') return '[undefined]';
    if (t === 'string')    return '[string]';
    if (t === 'number')    return '[number]';
    if (t === 'boolean')   return '[boolean]';
    if (t === 'bigint')    return '[bigint]';
    if (t === 'function')  return '[function]';
    if (t === 'symbol')    return '[symbol]';
    if (Array.isArray(value)) return '[array]';
    if (value instanceof Date) return '[date]';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return '[buffer]';
    return '[object]';
}

/**
 * Whether bound values may ride the dev sinks in clear.
 *
 * Reads the boot-seeded `process.gina._inspectorQueryCaptureValues` slot
 * (from `settings.inspector.queries.captureValues`). Fail-closed: absent
 * slot, absent `process.gina`, or any non-`true` value all mean redact.
 *
 * @memberof module:param-redact
 * @returns {boolean} true only when the operator explicitly opted in
 *
 * @example
 * if (paramRedact.captureValues()) { console.debug(params); }
 */
function captureValues() {
    return !!(process.gina && process.gina._inspectorQueryCaptureValues);
}

/**
 * Length-preserving redaction of a positional bind array for the Inspector
 * query-log payload: each value becomes its type marker, so the Inspector
 * UI keeps rendering the params table (arity + types) without receiving a
 * single value byte.
 *
 * @memberof module:param-redact
 * @param {Array} params - the positional bind array
 * @returns {string[]} same-length array of type markers; `[]` for non-arrays
 *
 * @example
 * summarize(['tok', 42])   // -> ['[string]', '[number]']
 * @example
 * summarize(null)          // -> []
 */
function summarize(params) {
    if (!Array.isArray(params)) return [];
    var out = new Array(params.length);
    for (var i = 0, len = params.length; i < len; i++) {
        out[i] = typeMarker(params[i]);
    }
    return out;
}

/**
 * Human-oriented redacted form for the dev console lines:
 * `count [type, type, ...]` — the shape a developer needs for the usual
 * reasons to read a params line (arity mismatches, type coercion bugs).
 *
 * @memberof module:param-redact
 * @param {Array} params - the positional bind array
 * @returns {string} e.g. `3 [string, number, string]`; `0 []` for empty/non-arrays
 *
 * @example
 * describeParams(['tok', 7, 'x'])   // -> '3 [string, number, string]'
 */
function describeParams(params) {
    if (!Array.isArray(params) || params.length === 0) return '0 []';
    var names = new Array(params.length);
    for (var i = 0, len = params.length; i < len; i++) {
        // strip the brackets off the marker for the joined human form
        names[i] = typeMarker(params[i]).slice(1, -1);
    }
    return params.length + ' [' + names.join(', ') + ']';
}

/**
 * Structure-preserving deep redaction for value-bearing statement BODIES
 * (a resolved document-database body, a bulk record set): keys and nesting
 * survive — which fields are touched stays diagnosable — while every
 * primitive leaf value becomes its type marker.
 *
 * Depth-capped and circular-safe; never mutates the input.
 *
 * @memberof module:param-redact
 * @param {*} value - the body to redact
 * @param {number} [depth=0] - internal recursion depth
 * @param {WeakSet} [seen] - internal circular-reference guard
 * @returns {*} a redacted deep copy; primitives become markers
 *
 * @example
 * redactValuesDeep({ filter: { token: 'abc' }, limit: 5 })
 * // -> { filter: { token: '[string]' }, limit: '[number]' }
 */
function redactValuesDeep(value, depth, seen) {
    depth = depth || 0;
    if (depth > 12) return '[deep]';
    if (value === null || typeof value !== 'object') return typeMarker(value);
    if (value instanceof Date) return '[date]';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return '[buffer]';

    seen = seen || new WeakSet();
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    var i, out;
    if (Array.isArray(value)) {
        out = new Array(value.length);
        for (i = 0; i < value.length; i++) {
            out[i] = redactValuesDeep(value[i], depth + 1, seen);
        }
        return out;
    }
    out = {};
    var keys = Object.keys(value);
    for (i = 0; i < keys.length; i++) {
        out[keys[i]] = redactValuesDeep(value[keys[i]], depth + 1, seen);
    }
    return out;
}

module.exports = {
    typeMarker       : typeMarker,
    captureValues    : captureValues,
    summarize        : summarize,
    describeParams   : describeParams,
    redactValuesDeep : redactValuesDeep
};
