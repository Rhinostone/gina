'use strict';
/**
 * @module utils/runtime
 * @description Runtime detection for gina's CLI / bootstrap layer. Distinguishes
 * the Bun runtime from Node so later stages can branch spawn, install and
 * shebang behaviour without changing how gina runs under Node. Required by a
 * plain relative path from `bin/*` and `script/*` (NOT as a bare module — the
 * framework `require('lib/name')` form is unavailable in CLI / daemon scope).
 *
 * Detection keys off `process.versions.bun`, which Bun defines and Node does
 * not. Bun also sets `process.versions.node` for compatibility, so Node is
 * defined here as "not Bun" rather than by sniffing `process.versions.node`.
 * Values are read live (the property is static per process); nothing is cached.
 *
 * @example
 * var runtime = require(__dirname + '/../utils/runtime.js');
 * if ( runtime.isBun() ) {
 *     // Bun-specific path (wired up by later stages)
 * }
 */

/**
 * Whether the current process is running under the Bun runtime.
 *
 * @memberof module:utils/runtime
 * @function isBun
 * @returns {boolean} `true` under Bun, `false` under Node (or any non-Bun runtime).
 */
var isBun = function() {
    return ( (typeof Bun !== 'undefined')
        || !!(process.versions && process.versions.bun) );
};

/**
 * Whether the current process is running under Node (i.e. not Bun).
 *
 * @memberof module:utils/runtime
 * @function isNode
 * @returns {boolean} `true` under Node, `false` under Bun.
 */
var isNode = function() {
    return !isBun();
};

/**
 * Resolve the executable that should launch a child gina / JS process under the
 * CURRENT runtime, so a spawned child runs under the same runtime as its parent.
 *
 * Under Node this returns `fallbackBinary` verbatim — the exact value the call
 * site already uses (a `which node` result, `process.execPath`, or
 * `process.argv[0]`) — so routing a spawn site through this helper is a
 * byte-identical no-op on Node (zero Node delta by construction, matching the
 * additive discipline of the earlier Bun stages). Under Bun it returns the
 * running Bun binary (`process.execPath`), so a site that historically resolved
 * `which node` — which a no-node Bun image cannot satisfy — instead launches Bun.
 *
 * @memberof module:utils/runtime
 * @function runtimeBinary
 * @param {string} [fallbackBinary] The binary the call site uses today. Returned
 *   unchanged under Node. Under Bun it is only a last resort, used when the Bun
 *   binary cannot otherwise be determined.
 * @returns {string} Path (or PATH name) of the interpreter to spawn.
 *
 * @example
 * // Shape B — was: spawn(process.execPath, args, opts)
 * spawn(runtime.runtimeBinary(process.execPath), args, opts);
 *
 * @example
 * // Shape A — never run `which node` under Bun (a no-node image cannot resolve it)
 * var bin = runtime.isBun()
 *     ? runtime.runtimeBinary()
 *     : runtime.runtimeBinary(execSync('which node').toString().trim());
 */
var runtimeBinary = function(fallbackBinary) {
    if ( isNode() ) {
        return fallbackBinary;
    }
    // Bun: process.execPath IS the running Bun binary (measured on Bun 1.2.21 and
    // 1.3.14) — the correct interpreter whether the call site previously resolved
    // `which node` (Shape A) or used process.execPath / argv[0] (Shape B).
    var execPath = process.execPath;
    if ( execPath && /(^|[\/\\])bun(\.exe)?$/i.test(execPath) ) {
        return execPath;
    }
    // Defensive fallback: execPath is not recognisably the Bun binary (a renamed
    // or embedded single-file executable). Resolve `bun` from PATH, then fall
    // back to execPath, then to the caller's value.
    try {
        if ( typeof Bun !== 'undefined' && typeof Bun.which === 'function' ) {
            var viaBun = Bun.which('bun');
            if ( viaBun ) { return viaBun; }
        }
        var viaPath = require('child_process').execSync('which bun').toString().trim();
        if ( viaPath ) { return viaPath; }
    } catch (e) { /* fall through to execPath / caller value */ }
    return execPath || fallbackBinary;
};

module.exports = {
    isBun         : isBun,
    isNode        : isNode,
    runtimeBinary : runtimeBinary
};
