/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module gina/lib/admin
 *
 * Admin /_gina/* IP-allowlist gate (#S7). Single source of truth for the
 * access check on the admin-grade /_gina/* endpoints (`/_gina/info`,
 * `/_gina/cache/stats`). Both server engines (`server.js` and
 * `server.isaac.js`) previously carried a byte-identical copy of this
 * helper; this module is now the single source and both engines call
 * `lib.admin.isClientAllowed(req)`.
 *
 * The allowlist is resolved from `process.gina._adminAllowList`, which
 * `gna.js` populates at bundle init from `app.json` `admin.allowFrom`
 * (defaults to loopback `['127.0.0.1', '::1']`). Sibling of
 * `lib.metrics.isClientAllowed` on a separate axis — admin endpoints expose
 * process state (memory, uptime, HTTP/2 session counters, cache contents)
 * and are gated separately from Prometheus scrapes.
 *
 * Registered as a PLAIN `require` in `lib/index.js` (not `_require`): a
 * stateless pure-function leaf with no instance/singleton state to
 * hot-reload — same #B32-residual precedent as merge / uuid / Collection.
 *
 * @example
 * // from an engine handler (lib is the framework lib registry)
 * if (!lib.admin.isClientAllowed(request)) {
 *     response.statusCode = 403;
 *     return response.end(JSON.stringify({ error: 'forbidden' }));
 * }
 */

/**
 * Default allowlist used when `admin.allowFrom` is unset — loopback only.
 * @constant {string[]}
 */
var DEFAULT_ALLOW_LIST = ['127.0.0.1', '::1'];

/**
 * Decide whether a request's client IP is in an explicit allowlist. Inner
 * seam exposed for branch testing without mutating `process.gina` state.
 *
 * Reads the client IP from `req.socket.remoteAddress` only — never trusts
 * `X-Forwarded-For` (reverse proxies could spoof it). Normalises
 * `::ffff:IPv4` (IPv6-mapped IPv4) → `IPv4` so listing `127.0.0.1` matches
 * both forms. An empty list (`[]`) denies everyone (explicit lockdown).
 *
 * @inner
 * @param {http.IncomingMessage|http2.Http2ServerRequest} req
 * @param {string[]} list the allowlist to test against
 * @returns {boolean} true if the client IP is in `list`
 * @example
 * _isAllowedWithList({ socket: { remoteAddress: '127.0.0.1' } }, ['127.0.0.1']); // true
 * _isAllowedWithList({ socket: { remoteAddress: '10.0.0.1' } }, []);             // false
 */
function _isAllowedWithList(req, list) {
    if (list.length === 0) return false;
    var ip = (req.socket && req.socket.remoteAddress)
          || (req.connection && req.connection.remoteAddress)
          || '';
    if (ip.indexOf('::ffff:') === 0) ip = ip.slice(7);
    return list.indexOf(ip) >= 0;
}

/**
 * IP-allowlist check for the admin-grade /_gina/* endpoints.
 *
 * Resolves the allowlist from `process.gina._adminAllowList` (set by
 * `gna.js` from `app.json` admin.allowFrom), falling back to loopback-only
 * when the global is missing (init not yet fired — the safest default).
 *
 * @param {http.IncomingMessage|http2.Http2ServerRequest} req
 * @returns {boolean} true if the client IP is allowed, false otherwise
 * @example
 * if (!lib.admin.isClientAllowed(request)) { return self.throwError(403); }
 */
function isClientAllowed(req) {
    var list = (typeof process.gina === 'object' && process.gina && Array.isArray(process.gina._adminAllowList))
        ? process.gina._adminAllowList
        : DEFAULT_ALLOW_LIST;
    return _isAllowedWithList(req, list);
}

module.exports = {
    isClientAllowed    : isClientAllowed,
    _isAllowedWithList : _isAllowedWithList,
    DEFAULT_ALLOW_LIST : DEFAULT_ALLOW_LIST
};
