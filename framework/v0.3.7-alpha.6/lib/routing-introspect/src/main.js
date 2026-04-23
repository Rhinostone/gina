/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module gina/lib/routing-introspect
 *
 * Semantic extractor for `routing.json`. Shared by `bundle:openapi` and
 * `bundle:mcp`. Parses URL patterns, HTTP methods, parameter requirements,
 * and derives stable tool / operation identifiers from a bundle routing
 * manifest.
 *
 * This module is pure — it does not read the filesystem, does not require
 * lib.*, and does not touch global state. Callers pass a parsed routing
 * object (the shape published as `schema/routing.json`) and receive back
 * JSON-serialisable descriptors.
 *
 * @example
 * var introspect = require('lib/routing-introspect');
 * var tools = [];
 * introspect.eachRoute(routing, function(routeName, route) {
 *     var urls = introspect.parseUrls(route.url);
 *     var methods = introspect.parseMethods(route.method);
 *     // ...
 * });
 */

/**
 * @typedef {Object} UrlInfo
 * @property {string}   openApiPath - OpenAPI path form (`{param}` placeholders).
 * @property {string}   mcpPath     - Colon-prefix form preserved verbatim (`:param`).
 * @property {string[]} params      - Ordered list of parameter names.
 */

/**
 * @typedef {Object} PatternInfo
 * @property {'pattern'|'enum'} type
 * @property {string|string[]}  value
 */

/**
 * Parses a `url` field (string, comma-separated string, or array) into an
 * array of {@link UrlInfo} entries.
 *
 * Accepts any of these routing.json shapes:
 * - `"url": "/path/:id"`
 * - `"url": "/path/:id, /path/:id/:slug"`
 * - `"url": ["/path/:id", "/path/:id/:slug"]`
 *
 * @memberof module:gina/lib/routing-introspect
 * @param   {string|string[]} raw
 * @returns {UrlInfo[]}
 *
 * @example
 * parseUrls('/user/:id');
 * // [{ openApiPath: '/user/{id}', mcpPath: '/user/:id', params: ['id'] }]
 *
 * @example
 * parseUrls('/a, /a/:b');
 * // [
 * //   { openApiPath: '/a',     mcpPath: '/a',     params: [] },
 * //   { openApiPath: '/a/{b}', mcpPath: '/a/:b',  params: ['b'] }
 * // ]
 */
var parseUrls = function(raw) {
    var patterns = [];

    if ( Array.isArray(raw) ) {
        patterns = raw;
    } else if ( typeof(raw) === 'string' ) {
        patterns = raw.split(',');
    }

    var results = [];
    for (var i = 0; i < patterns.length; i++) {
        var p = String(patterns[i]).trim();
        if (!p) continue;

        var params = [];
        var oaPath = p.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, function(match, name) {
            params.push(name);
            return '{' + name + '}';
        });

        // OpenAPI disallows trailing slash (except for "/")
        if (oaPath.length > 1 && oaPath.charAt(oaPath.length - 1) === '/') {
            oaPath = oaPath.slice(0, -1);
        }

        results.push({ openApiPath: oaPath, mcpPath: p, params: params });
    }

    return results;
};

/**
 * Parses the `method` field into an array of lowercase HTTP method strings.
 * Defaults to `['get']` when missing or non-string.
 *
 * @memberof module:gina/lib/routing-introspect
 * @param   {string} [raw]
 * @returns {string[]}
 *
 * @example
 * parseMethods('GET, POST');     // ['get', 'post']
 * parseMethods(undefined);       // ['get']
 * parseMethods('put , delete '); // ['put', 'delete']
 */
var parseMethods = function(raw) {
    if ( !raw || typeof(raw) !== 'string' ) return ['get'];

    return raw.split(',').map(function(m) {
        return m.trim().toLowerCase();
    }).filter(function(m) {
        return m.length > 0;
    });
};

/**
 * Converts a routing.json `requirements` value into a portable
 * {@link PatternInfo} descriptor suitable for JSON Schema `pattern` or `enum`.
 *
 * Handles four input shapes:
 * 1. Regex with slash delimiters: `/^[a-z]+$/i` → `{ type: 'pattern', value: '^[a-z]+$' }` (flags stripped)
 * 2. Simple pipe alternatives: `"admin|user|guest"` → `{ type: 'enum', value: [...] }`
 * 3. Bare regex body: `"(^foo|bar$)"` → `{ type: 'pattern', value: '^foo|bar$' }` (wrapping parens stripped)
 * 4. Validator reference: `"validator::email"` → `{ type: 'pattern', value: '.*' }` (runtime-only)
 *
 * JSON Schema does not support regex flags — `/^X$/i` loses case-insensitivity
 * in the emitted pattern. Document this limitation in the generator output when
 * emitting the schema.
 *
 * @memberof module:gina/lib/routing-introspect
 * @param   {string} raw
 * @returns {PatternInfo}
 *
 * @example
 * requirementToPattern('/^[0-9a-f]{8}-/i');     // { type: 'pattern', value: '^[0-9a-f]{8}-' }
 * requirementToPattern('admin|user|guest');     // { type: 'enum', value: ['admin','user','guest'] }
 * requirementToPattern('validator::email');     // { type: 'pattern', value: '.*' }
 * requirementToPattern('(^foo|bar$)');          // { type: 'pattern', value: '^foo|bar$' }
 */
var requirementToPattern = function(raw) {
    if ( typeof(raw) !== 'string' ) return { type: 'pattern', value: '.*' };

    if ( raw.indexOf('validator::') === 0 ) {
        return { type: 'pattern', value: '.*' };
    }

    // Regex with slash delimiters
    if ( raw.charAt(0) === '/' ) {
        var lastSlash = raw.lastIndexOf('/');
        if (lastSlash > 0) {
            return { type: 'pattern', value: raw.substring(1, lastSlash) };
        }
        return { type: 'pattern', value: raw.substring(1) };
    }

    // Pipe alternatives that look like a plain enum (no regex meta-chars)
    if ( raw.indexOf('|') !== -1 && !/[\\()\[\]{}^$.*+?]/.test(raw.replace(/\|/g, '')) ) {
        return { type: 'enum', value: raw.split('|') };
    }

    // Regex body without slash delimiters — strip wrapping parens if balanced
    var cleaned = raw;
    if (cleaned.charAt(0) === '(' && cleaned.charAt(cleaned.length - 1) === ')') {
        cleaned = cleaned.substring(1, cleaned.length - 1);
    }

    return { type: 'pattern', value: cleaned };
};

/**
 * Converts a hyphenated / snake_case / camelCase route name to a
 * human-readable title. Used as a fallback when `route.param.title` is absent.
 *
 * @memberof module:gina/lib/routing-introspect
 * @param   {string} name
 * @returns {string}
 *
 * @example
 * humanise('user-get-profile'); // 'User get profile'
 * humanise('getUserProfile');   // 'Get user profile'
 */
var humanise = function(name) {
    if ( typeof(name) !== 'string' || !name.length ) return '';
    var words = name.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Derives a stable identifier for a route. `namespace.control` when both are
 * present; falls back to the route name. Used as OpenAPI `operationId` and
 * MCP tool `name`.
 *
 * @memberof module:gina/lib/routing-introspect
 * @param   {string} routeName
 * @param   {object} route
 * @returns {string}
 *
 * @example
 * toolName('getProfile', { namespace: 'user', param: { control: 'getProfile' } });
 * // 'user.getProfile'
 *
 * @example
 * toolName('homepage', { param: { control: 'home' } });
 * // 'home'
 */
var toolName = function(routeName, route) {
    var param = route && route.param || {};
    if (route && route.namespace && param.control) {
        return route.namespace + '.' + param.control;
    }
    return param.control || routeName;
};

/**
 * Builds a human-readable Cache-Control descriptor from a `route.cache` value.
 *
 * @memberof module:gina/lib/routing-introspect
 * @param   {string|object} cache
 * @returns {string|null}
 *
 * @example
 * buildCacheHeader('memory');                       // 'private, cached (memory)'
 * buildCacheHeader({ visibility: 'public', ttl: 60 }); // 'public, max-age=60'
 * buildCacheHeader(null);                           // null
 */
var buildCacheHeader = function(cache) {
    if ( typeof(cache) === 'string' ) {
        return 'private, cached (' + cache + ')';
    }
    if ( cache && typeof(cache) === 'object' ) {
        var parts = [];
        parts.push(cache.visibility || 'private');
        if ( typeof(cache.ttl) !== 'undefined' ) {
            parts.push('max-age=' + cache.ttl);
        }
        return parts.join(', ');
    }
    return null;
};

/**
 * Returns true when the route should be treated as framework-internal and
 * excluded from agent-consumable manifests (OpenAPI, MCP). Currently this
 * means URLs under `/_gina/*` — the Inspector / live-reload endpoints.
 *
 * @memberof module:gina/lib/routing-introspect
 * @param   {object} route
 * @returns {boolean}
 */
var isFrameworkInternal = function(route) {
    if ( !route || typeof(route.url) !== 'string' ) return false;
    var first = route.url.split(',')[0].trim();
    return first.indexOf('/_gina/') === 0 || first === '/_gina';
};

/**
 * Iterates every valid route entry in a parsed `routing.json`. Skips the
 * `$schema` key and any non-object value. The callback receives the route
 * name and the raw route object — callers are free to ignore internal routes
 * (see {@link isFrameworkInternal}) or redirect control flows based on
 * `route.param.control`.
 *
 * @memberof module:gina/lib/routing-introspect
 * @param {object}   routing
 * @param {function} cb - `(routeName, route) => void`. Return `false` to stop iteration.
 * @returns {void}
 *
 * @example
 * var routing = require('/path/to/routing.json');
 * require('lib/routing-introspect').eachRoute(routing, function(name, route) {
 *     console.log(name, route.url);
 * });
 */
var eachRoute = function(routing, cb) {
    if ( !routing || typeof(routing) !== 'object' ) return;
    for (var routeName in routing) {
        if ( !routing.hasOwnProperty(routeName) ) continue;
        if ( routeName === '$schema' ) continue;
        var route = routing[routeName];
        if ( typeof(route) !== 'object' || route === null ) continue;
        if ( cb(routeName, route) === false ) return;
    }
};

module.exports = {
    parseUrls           : parseUrls,
    parseMethods        : parseMethods,
    requirementToPattern: requirementToPattern,
    humanise            : humanise,
    toolName            : toolName,
    buildCacheHeader    : buildCacheHeader,
    isFrameworkInternal : isFrameworkInternal,
    eachRoute           : eachRoute
};
