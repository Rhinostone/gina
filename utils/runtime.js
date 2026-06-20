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

module.exports = {
    isBun  : isBun,
    isNode : isNode
};
