'use strict';
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module lib/secrets
 * @description Substitutes `${secret:KEY}` placeholders in a merged bundle
 * config tree at config-load time. The default backend resolves keys from
 * `process.env`; a future iteration may add pluggable backends.
 *
 * **Syntax.** `${secret:KEY}` where `KEY` matches `^[A-Z_][A-Z0-9_]*$`.
 * The placeholder must be the entire JSON string value — mixed-content
 * strings like `'prefix-${secret:K}-suffix'` are passed through unchanged
 * (no substitution attempted).
 *
 * **Timing.** Runs once per bundle slice during `loadBundleConfig`,
 * mutating the merged config object in place. Subsequent reads see the
 * resolved values; no dynamic re-resolution.
 *
 * **Fail-closed.** Unset / empty backend values cause the backend to
 * throw `Error('Secret resolution failed')`. The error message does NOT
 * include the key name.
 *
 * **Path tracking.** The dotted paths that were substituted are recorded
 * in an internal `WeakMap`; callers can retrieve them via
 * `getResolvedPaths(config)` to support future log-redaction wrappers.
 *
 * **Introspection.** `getRequiredKeys(config)` enumerates the placeholder
 * keys a config requires without resolving them — read-only and
 * non-throwing. It backs the `gina secrets:scan` / `secrets:check` CLI.
 *
 * @example
 * var secrets = lib.secrets;
 * process.env.DB_PASSWORD = 's3cret';
 * var conf = { db: { password: '${secret:DB_PASSWORD}' }, db_host: 'localhost' };
 * secrets.resolve(conf);
 * conf.db.password;                  // → 's3cret'
 * secrets.getResolvedPaths(conf);    // → ['db.password']
 *
 * @example
 * // Fail-closed when env var is missing:
 * delete process.env.MISSING;
 * try {
 *     secrets.resolve({ a: '${secret:MISSING}' });
 * } catch (e) {
 *     e.message;   // 'Secret resolution failed'
 * }
 */

var defaultBackend = require('./backends/env');

/**
 * Regex matching an entire `${secret:KEY}` placeholder. The capture group
 * is the key name. Anchored on both ends — embedded placeholders inside
 * longer strings do not match.
 *
 * @constant {RegExp} SECRET_RE
 * @memberof module:lib/secrets
 */
var SECRET_RE = /^\${secret:([A-Z_][A-Z0-9_]*)\}$/;

/**
 * Internal map of resolved-config object → array of dotted paths that
 * were substituted during the walk. `WeakMap` so entries are GC'd with
 * their config object.
 *
 * @inner
 * @private
 * @type {WeakMap<object, string[]>}
 */
var _resolvedPathsByConfig = new WeakMap();

/**
 * Walk `node` recursively, substituting any string value that matches
 * `SECRET_RE` in place. Records substituted dotted paths into `paths`.
 * Mixed-content strings pass through unchanged.
 *
 * @inner
 * @private
 * @param {*}        node        - Current subtree (object, array, or scalar)
 * @param {string[]} paths       - Mutable array of substituted dotted paths
 * @param {string}   currentPath - Dotted path of `node` from the walk root
 * @param {object}   backend     - Backend with `resolve(key) → string`
 * @returns {void}
 * @throws {Error} Propagates backend resolution errors
 */
function walkAndResolve(node, paths, currentPath, backend) {
    if (node === null || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
            var elementPath = currentPath + '[' + i + ']';
            if (typeof node[i] === 'string') {
                var match = node[i].match(SECRET_RE);
                if (match) {
                    node[i] = backend.resolve(match[1]);
                    paths.push(elementPath);
                }
            } else if (node[i] !== null && typeof node[i] === 'object') {
                walkAndResolve(node[i], paths, elementPath, backend);
            }
        }
        return;
    }
    for (var key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) {
            continue;
        }
        var keyPath = currentPath ? (currentPath + '.' + key) : key;
        if (typeof node[key] === 'string') {
            var keyMatch = node[key].match(SECRET_RE);
            if (keyMatch) {
                node[key] = backend.resolve(keyMatch[1]);
                paths.push(keyPath);
            }
        } else if (node[key] !== null && typeof node[key] === 'object') {
            walkAndResolve(node[key], paths, keyPath, backend);
        }
    }
}

/**
 * Walk `node` recursively, collecting the KEY of every string value that
 * matches `SECRET_RE` into `keys`. Unlike `walkAndResolve`, this never
 * calls a backend and never mutates `node` — it only enumerates the
 * placeholder keys present, so it cannot throw on unset / empty values.
 * Mixed-content strings (`'prefix-${secret:K}-suffix'`) do not match,
 * exactly as `walkAndResolve` leaves them untouched.
 *
 * @inner
 * @private
 * @param {*}      node - Current subtree (object, array, or scalar)
 * @param {object} keys - Mutable null-proto set; each required key name maps to `true`
 * @returns {void}
 */
function walkAndCollect(node, keys) {
    if (node === null || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
            if (typeof node[i] === 'string') {
                var match = node[i].match(SECRET_RE);
                if (match) {
                    keys[match[1]] = true;
                }
            } else if (node[i] !== null && typeof node[i] === 'object') {
                walkAndCollect(node[i], keys);
            }
        }
        return;
    }
    for (var key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) {
            continue;
        }
        if (typeof node[key] === 'string') {
            var keyMatch = node[key].match(SECRET_RE);
            if (keyMatch) {
                keys[keyMatch[1]] = true;
            }
        } else if (node[key] !== null && typeof node[key] === 'object') {
            walkAndCollect(node[key], keys);
        }
    }
}

/**
 * Resolve all `${secret:KEY}` placeholders in `config` in place. Returns
 * the same `config` reference (for chaining).
 *
 * Walks every object key and array element; replaces any string value
 * matching `^\${secret:KEY\}$` with the value returned by `backend.resolve(KEY)`.
 * Substitution is one-pass — placeholders inside already-resolved values
 * are NOT re-walked. Mixed-content strings (`'prefix-${secret:K}-suffix'`)
 * return unchanged.
 *
 * @memberof module:lib/secrets
 * @function resolve
 * @param {object|Array} config    - The merged bundle config object to walk in place
 * @param {object}       [backend] - Optional backend override. Defaults to the env-var backend.
 * @param {function}     backend.resolve - `function(key) ⇒ string`. Throws on failure.
 * @returns {object|Array|*} The same `config` reference (mutated in place). Non-object inputs return unchanged.
 * @throws {Error} `'Secret resolution failed'` if any placeholder cannot be resolved
 *
 * @example
 * var secrets = lib.secrets;
 * process.env.API_KEY = 'abc';
 * secrets.resolve({ api: { key: '${secret:API_KEY}' } });
 * // → { api: { key: 'abc' } }
 *
 * @example
 * // Custom backend (test fixture or future plug-in shape):
 * secrets.resolve(conf, {
 *     resolve: function(key) {
 *         if (key === 'TEST') return 'value';
 *         throw new Error('Secret resolution failed');
 *     }
 * });
 */
function resolve(config, backend) {
    if (config === null || typeof config !== 'object') {
        return config;
    }
    var paths = [];
    walkAndResolve(config, paths, '', backend || defaultBackend);
    if (paths.length > 0) {
        _resolvedPathsByConfig.set(config, paths);
    }
    return config;
}

/**
 * Return the dotted paths that were substituted in `config` during the
 * most recent `resolve(config)` call. Used by future log-redaction
 * wrappers to know which fields originated as secrets.
 *
 * Paths use dotted notation for object keys (`'db.password'`) and
 * bracketed indices for array elements (`'items[0]'`).
 *
 * @memberof module:lib/secrets
 * @function getResolvedPaths
 * @param {object|Array} config - The resolved config object
 * @returns {string[]} Array of substituted dotted paths. Empty if none.
 *
 * @example
 * var conf = { db: { password: '${secret:DB_PASSWORD}' }, items: ['${secret:A}', 'literal'] };
 * process.env.DB_PASSWORD = 'pw';
 * process.env.A = 'va';
 * secrets.resolve(conf);
 * secrets.getResolvedPaths(conf); // → ['db.password', 'items[0]']
 */
function getResolvedPaths(config) {
    if (config === null || typeof config !== 'object') {
        return [];
    }
    return _resolvedPathsByConfig.get(config) || [];
}

/**
 * Enumerate the distinct `${secret:KEY}` placeholder keys present in
 * `config`, without resolving any of them. Read-only and non-throwing:
 * unlike `resolve()`, it never calls a backend, never mutates `config`,
 * and never fails on unset / empty values — it answers only the question
 * "which keys would this config require?".
 *
 * Backs the `gina secrets:scan` / `secrets:check` introspection CLI.
 * Mirrors `resolve()`'s matching rule exactly (anchored `SECRET_RE`), so
 * the reported set is precisely the set `resolve()` would substitute:
 * mixed-content strings (`'prefix-${secret:K}-suffix'`) are NOT reported.
 *
 * @memberof module:lib/secrets
 * @function getRequiredKeys
 * @param {object|Array} config - A bundle config object (or any subtree)
 * @returns {string[]} Sorted, de-duplicated list of required key names. Empty for non-object inputs or configs with no bare placeholders.
 *
 * @example
 * secrets.getRequiredKeys({
 *     db: { password: '${secret:DB_PASSWORD}' },
 *     api: { key: '${secret:API_KEY}', url: 'https://${secret:API_KEY}/v1' }
 * });
 * // → ['API_KEY', 'DB_PASSWORD']
 * // The mixed-content `url` is not reported (mirrors resolve()).
 */
function getRequiredKeys(config) {
    if (config === null || typeof config !== 'object') {
        return [];
    }
    var keys = Object.create(null);
    walkAndCollect(config, keys);
    return Object.keys(keys).sort();
}

module.exports = {
    resolve: resolve,
    getResolvedPaths: getResolvedPaths,
    getRequiredKeys: getRequiredKeys,
    SECRET_RE: SECRET_RE
};
