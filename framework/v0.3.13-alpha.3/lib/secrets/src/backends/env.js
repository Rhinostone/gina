'use strict';
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module lib/secrets/backends/env
 * @description `process.env`-backed resolver for `{secret:KEY}` placeholders.
 * Reads the raw value from `process.env[key]`. Throws the generic
 * `'Secret resolution failed'` Error when the env var is unset or empty —
 * the user-facing message intentionally omits the key name. The key is
 * attached non-enumerably to the thrown Error as `_ginaSecretKey` so
 * callers can log it at debug level without leaking it through `toString()`.
 */

/**
 * Resolve a secret key against `process.env`.
 *
 * @memberof module:lib/secrets/backends/env
 * @function resolve
 * @param {string} key - Placeholder key, e.g. `'DB_PASSWORD'`
 * @returns {string} Non-empty env-var value
 * @throws {Error} `'Secret resolution failed'` when `process.env[key]` is unset or empty
 *
 * @example
 * var env = require('./backends/env');
 * process.env.DB_PASSWORD = 's3cret';
 * env.resolve('DB_PASSWORD'); // → 's3cret'
 *
 * @example
 * delete process.env.MISSING;
 * try {
 *     env.resolve('MISSING');
 * } catch (e) {
 *     e.message;          // 'Secret resolution failed'  ← no key name
 *     e._ginaSecretKey;   // 'MISSING'                  ← non-enumerable, for debug logging
 * }
 */
function resolve(key) {
    var value = process.env[key];
    if (typeof value !== 'string' || value === '') {
        var err = new Error('Secret resolution failed');
        Object.defineProperty(err, '_ginaSecretKey', {
            value: key,
            enumerable: false,
            configurable: true,
            writable: true
        });
        throw err;
    }
    return value;
}

module.exports = {
    resolve: resolve
};
