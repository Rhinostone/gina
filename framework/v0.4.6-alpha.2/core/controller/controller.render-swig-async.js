/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module controller.render-swig-async
 * @description Render delegate for swig bundles configured with a custom async
 * template loader (`settings.template.swig.loader`). controller.js selects this
 * delegate when `process.gina._swigLoaders[<templateRoot>].loader.async === true`;
 * every other swig bundle keeps the byte-identical filesystem path
 * (controller.render-swig.js).
 *
 * Unlike render-swig.js — which self-reads the template from disk, pre-resolves
 * `{% extends %}`, and compiles a string — this delegate renders through an
 * ISOLATED per-bundle `new swig.Swig({ loader })` instance. swig's async
 * codegen drives `resolve -> load` for the page template AND its whole
 * transitive `extends` / `include` / `import` chain through the custom loader,
 * so templates can live off-disk (remote / CDN / object-storage / in-memory).
 * The per-bundle instance is what keeps multiple bundles in one process from
 * colliding on the swig process-singleton's shared loader (#TPL1).
 *
 * MVP scope (Slice 1): per-bundle engine isolation + loader pipeline + gina
 * filter registration + render + HTTP/1.1 & HTTP/2 send. Deferred to follow-up
 * slices (mirroring the render-nunjucks N2 -> #NJ build-out): post-render asset
 * injection, Inspector dev-payload, static HTML cache writes, error-template
 * routing, and Early Hints.
 *
 * @package gina.framework
 */

const libRef = require('./../../lib') || require.cache[require.resolve('./../../lib')];
const merge  = libRef.merge;

/**
 * Per-bundle isolated swig engine cache. Key: the bundle template root. Value:
 * a `new swig.Swig({ loader })` instance with its OWN options.loader, cache,
 * filters and tags — so multiple bundles sharing one process never collide on
 * a shared loader (which a per-bundle `swig.setDefaults({ loader })` on the
 * process-singleton would cause).
 *
 * Stored on `process.gina` so it survives dev-mode `refreshCoreDependencies()`
 * evictions of controller.js + this delegate. Invalidated when the resolved
 * swig MODULE is hot-swapped (`_swigEnginesOwner !== swigMod`), mirroring
 * render-nunjucks.js `getEnvironment()`'s `_nunjucksEnvsOwner` guard.
 *
 * @inner
 * @param {*}       swigMod      - The resolved swig module (exposes `.Swig`)
 * @param {string}  templateRoot - Registry key (bundle template root)
 * @param {object}  loader       - Guarded async loader (from `process.gina._swigLoaders`)
 * @param {boolean} autoescape   - Per-bundle autoescape (captured by initSwigEngine)
 * @returns {*} A cached or newly built isolated swig engine instance
 */
function getSwigEngine(swigMod, templateRoot, loader, autoescape) {
    if (!process.gina._swigEngines) {
        process.gina._swigEngines = Object.create(null);
    }
    // Drop all cached engines when the swig module was hot-swapped (dev-mode
    // project-swig refresh) — instances are bound to the module that built them.
    if (process.gina._swigEnginesOwner !== swigMod) {
        process.gina._swigEngines = Object.create(null);
        process.gina._swigEnginesOwner = swigMod;
    }
    var key = templateRoot;
    if (!process.gina._swigEngines[key]) {
        process.gina._swigEngines[key] = new swigMod.Swig({
            loader:     loader,
            autoescape: (autoescape === true),
            // swig forces cache:false for async-compiled templates anyway; set
            // it explicitly. A gina-managed compiled-fn cache is a later slice.
            cache:      false
        });
    }
    return process.gina._swigEngines[key];
}

/**
 * Resolve the loader identifier for the page template, relative to the bundle
 * template root. Same shape as render-nunjucks.js `resolveTemplatePath()`:
 * honours a `self.setTemplate()` override, the namespace sub-directory, and the
 * extension append. No CVE path check here — the loader wrapper guards every
 * `resolve()`.
 *
 * @inner
 * @param {object} data         - Template data (`data.page.view.file` / `.ext`)
 * @param {object} localOptions - Controller options (`.namespace`, `._templateOverride`)
 * @returns {string} Loader identifier (path relative to the template root)
 */
function resolveTemplatePath(data, localOptions) {
    // Runtime override from self.setTemplate(file, ext) fully replaces the
    // rule's default path (no namespace prefixing).
    if (localOptions && localOptions._templateOverride && localOptions._templateOverride.file) {
        var ovFile = localOptions._templateOverride.file;
        var ovExt  = localOptions._templateOverride.ext || data.page.view.ext || '';
        if (ovExt && !ovFile.endsWith(ovExt)) { ovFile += ovExt; }
        return ovFile;
    }

    var file = data.page.view.file;
    var ext  = data.page.view.ext || '';

    if (localOptions.namespace) {
        var effective = file || localOptions.namespace;
        if (effective === localOptions.namespace) { effective = 'index'; }
        // Drop a redundant `<namespace>-` prefix from the file segment so a
        // route named `<namespace>-<action>` resolves to `<namespace>/<action>`.
        var nsPrefix = localOptions.namespace + '-';
        if (effective.length > nsPrefix.length && effective.indexOf(nsPrefix) === 0) {
            effective = effective.substring(nsPrefix.length);
        }
        var rel = localOptions.namespace + '/' + effective;
        if (ext && !rel.endsWith(ext)) { rel += ext; }
        return rel;
    }

    var relRoot = file;
    if (ext && !relRoot.endsWith(ext)) { relRoot += ext; }
    return relRoot;
}

/**
 * Register gina's SwigFilters on the per-bundle engine, per request. Filters
 * such as `getUrl` / `getWebroot` need per-request context (the request, the
 * resolved options, the proxy-host decision), so they are (re)registered before
 * each render. Mirrors the render-swig.js filter loop. Per-request mutation of
 * the cached engine is safe under Node's single-threaded loop: the
 * `getTemplate` / execute below complete before another request can touch the
 * engine's filter table.
 *
 * @inner
 * @param {*}        engine       - The per-bundle swig engine instance
 * @param {object}   self         - SuperController instance (provides `throwError`)
 * @param {object}   localOptions - Controller options (`.conf`, hostname/port)
 * @param {function} SwigFilters  - The SwigFilters factory (from `deps`)
 * @param {object}   req          - Request (captured)
 * @param {object}   res          - Response (captured)
 * @returns {void}
 */
function registerGinaFilters(engine, self, localOptions, SwigFilters, req, res) {
    var localRequestPort = req.headers.port || req.headers[':port'];
    var isProxyHost = (
        typeof(req.headers.host) != 'undefined'
        && typeof(localRequestPort) != 'undefined'
        && (localRequestPort === '80' || localRequestPort === '443' || localRequestPort === 80 || localRequestPort === 443)
        && localOptions.conf.server.scheme +'://'+ req.headers.host+':'+ localRequestPort != localOptions.conf.hostname.replace(/\:\d+$/, '') +':'+ localOptions.conf.server.port
        ||
        typeof(req.headers[':authority']) != 'undefined'
        && localOptions.conf.server.scheme +'://'+ req.headers[':authority'] != localOptions.conf.hostname
        ||
        typeof(req.headers.host) != 'undefined'
        && typeof(localRequestPort) != 'undefined'
        && (localRequestPort === '80' || localRequestPort === '443' || localRequestPort === 80 || localRequestPort === 443)
        && req.headers.host == localOptions.conf.host
        ||
        typeof(req.headers['x-nginx-proxy']) != 'undefined'
        && String(req.headers['x-nginx-proxy']).toLowerCase() === 'true'
        ||
        typeof(process.gina) != 'undefined' && typeof(process.gina.PROXY_HOSTNAME) != 'undefined'
    ) ? true : false;

    var filters = SwigFilters({
        options:     JSON.clone(localOptions),
        isProxyHost: isProxyHost,
        throwError:  self.throwError,
        req:         req,
        res:         res
    });

    for (var name in filters) {
        if (typeof filters[name] === 'function' && name !== 'getConfig') {
            engine.setFilter(name, filters[name]);
        }
    }
}

/**
 * Send the rendered HTML, covering HEAD + HTTP/2 stream + HTTP/1.1 in the
 * four-way branch from class.controller.md §7b. Ported verbatim from
 * render-nunjucks.js `sendHtmlResponse()` (the proven separate-delegate send).
 *
 * @inner
 * @param {object} local - Per-request closure (for `_trailers`)
 * @param {string} html  - Final HTML string
 * @param {object} req   - Request (captured)
 * @param {object} res   - Response (captured)
 * @returns {void}
 */
function sendHtmlResponse(local, html, req, res) {
    if (res.headersSent) { return; }

    var statusCode = res.statusCode || 200;
    var stream     = (res && typeof res.stream !== 'undefined') ? res.stream : null;
    var isHead     = /^HEAD$/i.test(req.method);
    // #H10 — opt-in HTTP/2 response trailers (registered via self.sendTrailers()).
    var _trailers  = (local && local._trailers && typeof(local._trailers) === 'object') ? local._trailers : null;
    var byteLength = Buffer.byteLength(html, 'utf8');

    if (!res.getHeader('content-type')) {
        res.setHeader('content-type', 'text/html; charset=utf-8');
    }

    if (isHead) {
        if (stream) {
            // Case 1: HEAD + HTTP/2
            if (stream.destroyed || stream.closed) {
                try { console.warn('[render-swig-async] stream already destroyed on HEAD — client disconnected ('+ req.url +')'); } catch (e) {}
                return;
            }
            if (!stream.headersSent) {
                var _headH2 = {
                    'content-type':   res.getHeader('content-type'),
                    'content-length': byteLength,
                    ':status':        statusCode
                };
                var _pendingHeadH2 = res.getHeaders ? res.getHeaders() : {};
                for (var _hh2k in _pendingHeadH2) {
                    if (!(_hh2k in _headH2)) { _headH2[_hh2k] = _pendingHeadH2[_hh2k]; }
                }
                stream.respond(_headH2);
            }
            stream.end();
            res.headersSent = true;
        } else {
            // Case 2: HEAD + HTTP/1.1
            res.setHeader('content-length', byteLength);
            res.writeHead(statusCode);
            res.end();
        }
        return;
    }

    if (stream) {
        // Case 3: body + HTTP/2
        if (stream.destroyed || stream.closed) {
            try { console.warn('[render-swig-async] stream already destroyed — client disconnected before response ('+ req.url +')'); } catch (e) {}
            return;
        }
        if (!stream.headersSent) {
            var _streamHeaders = {
                'content-type': res.getHeader('content-type'),
                ':status':      statusCode
            };
            var _pendingHeaders = res.getHeaders ? res.getHeaders() : {};
            for (var _shk in _pendingHeaders) {
                if (!(_shk in _streamHeaders)) { _streamHeaders[_shk] = _pendingHeaders[_shk]; }
            }
            if (_trailers) {
                stream.once('wantTrailers', function() {
                    try { if (!stream.destroyed && !stream.closed) stream.sendTrailers(_trailers); } catch (_e) { /* best-effort */ }
                });
            }
            stream.respond(_streamHeaders, _trailers ? { waitForTrailers: true } : undefined);
        }
        stream.end(html);
        res.headersSent = true;
        return;
    }

    // Case 4: body + HTTP/1.1
    res.writeHead(statusCode);
    res.end(html);
}

/**
 * Async-loader swig render delegate. Signature matches the other delegates so
 * controller.js can dispatch to it interchangeably.
 *
 * @param {object}   userData          - Controller-supplied template data
 * @param {boolean=} displayInspector  - Dev Inspector toggle (deferred — unused in the MVP)
 * @param {object=}  errOptions        - Options when invoked from the error pipeline
 * @param {object}   deps              - Injected controller refs ({ self, local, getData, hasViews, headersSent, SwigFilters, swig })
 * @returns {Promise<void>}
 *
 * @example
 * // Selected automatically by controller.js when the bundle configures
 * // settings.template.swig.loader; the controller action just calls self.render(data).
 */
module.exports = async function renderSwigAsync(userData, displayInspector, errOptions, deps) {
    var self        = deps.self;
    var local       = deps.local;
    var getData     = deps.getData;
    var hasViews    = deps.hasViews;
    var headersSent = deps.headersSent;
    var SwigFilters = deps.SwigFilters;
    var swigMod     = deps.swig; // the resolved swig MODULE (exposes .Swig)

    // Function-scoped captures of the per-request refs (#M1 race fix — mirror of
    // render-nunjucks/render-swig). This render awaits (getTemplate + execute);
    // capturing isolates post-await reads from a concurrent throwError null-out
    // on the controller closure.
    var req   = local.req;
    var res   = local.res;
    var _next = local.next;

    // No-view short-circuit (e.g. redirect responses reach render() without a
    // configured template).
    if (!hasViews || !hasViews()) {
        sendHtmlResponse(local, '', req, res);
        local.req = null;
        local.res = null;
        local.next = null;
        return;
    }

    // If the pipeline already sent headers (an upstream throwError beat us), stop.
    if (headersSent && headersSent()) { return; }

    var localOptions = errOptions || local.options;

    var data;
    try {
        data = getData();
    } catch (dataErr) {
        return self.throwError(dataErr);
    }

    // Error-interception — render(err) with a non-2xx status + an error object
    // routes to the framework error page rather than rendering. Mirrors
    // render-swig.js / render-nunjucks.js.
    if (
        !localOptions.isRenderingCustomError
        && data && data.page && data.page.data
        && typeof(data.page.data.status) !== 'undefined'
        && !String(data.page.data.status).startsWith('2')
        && typeof(data.page.data.error) !== 'undefined'
    ) {
        var errorObject = {
            status:  data.page.data.status,
            error:   data.page.data.error   || data.page.data.message,
            message: data.page.data.message || data.page.data.error,
            stack:   data.page.data.stack
        };
        try {
            console.error('[render-swig-async] ' + data.page.data.status + ' from upstream — routing to throwError');
        } catch (e) { /* ignore */ }
        return self.throwError(errorObject);
    }

    // Registry key — the SAME expression initSwigEngine used to stash the loader
    // (conf.content.templates._common.html), so the two sides never diverge.
    var loaderKey = localOptions.conf
        && localOptions.conf.content
        && localOptions.conf.content.templates
        && localOptions.conf.content.templates._common
        && localOptions.conf.content.templates._common.html;

    var stash = (loaderKey && process.gina._swigLoaders) ? process.gina._swigLoaders[loaderKey] : null;
    if (!stash || !stash.loader) {
        return self.throwError(new Error(
            '[render-swig-async] no async swig loader registered for bundle ' + localOptions.bundle +
            ' — initSwigEngine did not build one (was settings.template.swig.loader removed at runtime?)'
        ));
    }

    // Merge user data into the render context — mirror render-nunjucks.js:
    //   (a) branching stash (userData without a `page` key -> data.page.data),
    //   (b) top-level merge with per-key `page` handling (preserves page.view etc.),
    //   (c) framework-data restore (re-overlay getData() so page.environment /
    //       page.view / page.data.session survive a partial page.* from the controller).
    if (userData && typeof(userData) === 'object') {
        if (!userData.page) {
            if (!data.page.data) { data.page.data = {}; }
            Object.keys(userData).forEach(function (k) {
                data.page.data[k] = userData[k];
            });
        }
        Object.keys(userData).forEach(function (k) {
            if (k === 'page' && data.page && typeof userData.page === 'object') {
                Object.keys(userData.page).forEach(function (pk) {
                    data.page[pk] = userData.page[pk];
                });
            } else {
                data[k] = userData[k];
            }
        });
        data = merge(data, getData());
    }

    var engine;
    try {
        engine = getSwigEngine(swigMod, loaderKey, stash.loader, stash.autoescape);
    } catch (engErr) {
        return self.throwError(engErr);
    }

    try {
        registerGinaFilters(engine, self, localOptions, SwigFilters, req, res);
    } catch (filterErr) {
        return self.throwError(filterErr);
    }

    var templateName;
    try {
        templateName = resolveTemplatePath(data, localOptions);
    } catch (pathErr) {
        return self.throwError(pathErr);
    }

    var html;
    try {
        // swig async path: getTemplate(name) resolves+loads the page template
        // AND its transitive extends/include chain through the custom loader,
        // returning Promise<TemplateFn>; the compiled fn returns Promise<{output}>.
        var compiled = await engine.getTemplate(templateName, { filename: templateName });
        var rendered = await compiled(data);
        html = (rendered && typeof rendered.output === 'string') ? rendered.output : String(rendered);
    } catch (renderErr) {
        return self.throwError(renderErr);
    }

    // A concurrent throwError may have sent headers while we awaited — re-check.
    if (headersSent && headersSent()) { return; }

    sendHtmlResponse(local, html, req, res);

    // Release per-request refs on the closure; the function-scoped captures stay
    // alive until return.
    local.req = null;
    local.res = null;
    local.next = null;
};
