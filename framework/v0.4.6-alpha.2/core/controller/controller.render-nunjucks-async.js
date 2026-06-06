/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module controller.render-nunjucks-async
 * @description Render delegate for nunjucks bundles configured with a custom
 * async template loader (`settings.template.nunjucks.loader`). controller.js
 * selects this delegate when
 * `process.gina._nunjucksLoaders[<templateRoot>].loader.async === true`; every
 * other nunjucks bundle keeps the cached-Environment filesystem path
 * (controller.render-nunjucks.js).
 *
 * Unlike render-nunjucks.js — which reads templates from disk through a cached
 * `new nunjucks.FileSystemLoader(root)` Environment — this delegate renders
 * through a PER-REQUEST `new nunjucks.Environment(adapter)` whose adapter is a
 * `nunjucks.Loader.extend({ async, resolve, getSource })` subclass wrapping the
 * gina async loader. nunjucks' async codegen drives `resolve -> getSource` for
 * the page template AND its whole transitive `extends` / `include` / `import`
 * chain through the custom loader, so templates can live off-disk (remote / CDN
 * / object-storage / in-memory). The gina loader's CVE-2023-25345 guard runs on
 * every hop (inside `getSource`'s `ginaLoader.resolve`).
 *
 * ## Per-request Environment (NOT the sync delegate's cached `_nunjucksEnvs` registry)
 *
 * This is the one place the design deliberately diverges from the swig-async
 * per-bundle-engine precedent. nunjucks-resolver.md §8.1 invariant #1 mandates
 * that any async-render port switch to a per-request env: the context-bearing
 * gina filters (`getUrl` / `getWebroot`) are registered per request via
 * `env.addFilter`, and an async `env.render` yields between that registration
 * and the actual template execution — so a shared/cached env would let request
 * B stomp request A's filter table mid-await (a §8.1-class cross-request bleed).
 * A fresh env per request isolates the filter table. The cost — no cross-request
 * compiled-template reuse — is acceptable: the loader's own source cache (e.g.
 * the http loader's Tier-1 cache) collapses the network cost, and a Tier-2
 * "shared env + per-request context via the render ctx" reuse pattern is a later
 * slice. This delegate MUST NOT reuse the sync delegate's cached `_nunjucksEnvs` registry.
 *
 * ## Callback-form render is mandatory
 *
 * With an async loader, a synchronous `env.render(name, ctx)` on an uncached
 * template returns `null` silently (worse than throwing). The delegate therefore
 * promisifies the callback form `env.render(name, ctx, cb)`.
 *
 * MVP scope (matches controller.render-swig-async.js): per-request env + loader
 * adapter + gina filter registration + render + HTTP/1.1 & HTTP/2 send + post-
 * render asset injection (the gina client bundle / CSS / JS via injectAssets()
 * plus the gina-bootstrap whisper pass) + error-interception, so an off-disk
 * full page ships the client runtime and is production-usable. Deferred to a
 * follow-up slice (mirroring the swig-async deferral, all present in the sync
 * render-nunjucks.js to port later): Inspector dev-payload, the bundle
 * `controllers/setup.js` `this.engine` filter hook (registerUserFilters — the
 * per-request env makes its once-per-env `_userSetupDone` marker moot), static
 * HTML cache writes (writeCache), error-template routing (isRenderingCustomError
 * + renderString), the Flow-timeline late entries, and Early Hints.
 *
 * @package gina.framework
 */

// libRef via the registry with a require.cache fallback: server.isaac.js
// refreshCore() overwrites the lib cache entry with the exports value (not a
// Module object) in dev mode, so a plain require() can return undefined and
// crash the module-level read. Mirrors render-nunjucks.js / render-swig-async.js.
const libRef     = require('./../../lib') || require.cache[require.resolve('./../../lib')];
const merge      = libRef.merge;
// Collection — filters the asset list to common-only when rendering without a
// layout (isWithoutLayout XHR/popin responses), mirroring render-nunjucks.js /
// render-swig.js.
const Collection = libRef.Collection;

/**
 * Resolve the loader identifier for the page template, relative to the bundle
 * template root. Same shape as render-nunjucks.js `resolveTemplatePath()`:
 * honours a `self.setTemplate()` override, the namespace sub-directory (dropping
 * a redundant `<namespace>-` prefix), and the extension append. No CVE path
 * check here — the gina loader's `resolve()` guards every hop.
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
 * Register gina's NunjucksFilters on the per-request Environment. Filters such
 * as `getUrl` / `getWebroot` need per-request context (the request, the resolved
 * options, the proxy-host decision), so they are registered after the env is
 * built and before the render. Mirrors render-nunjucks.js `registerGinaFilters`.
 * Because the env is per-request (see the module header), there is no
 * cross-request filter-table race.
 *
 * @inner
 * @param {*}      env          - The per-request `nunjucks.Environment`
 * @param {object} self         - SuperController instance (provides `throwError`)
 * @param {object} local        - Per-request closure
 * @param {object} localOptions - Controller options (`.conf`, hostname/port)
 * @param {object} req          - Request (captured)
 * @param {object} res          - Response (captured)
 * @returns {void}
 */
function registerGinaFilters(env, self, local, localOptions, req, res) {
    // nunjucksFilters via the registry with a require fallback so dev-mode
    // refreshCore() lib-cache eviction doesn't return undefined here.
    var nunjucksFilters = (libRef && libRef.nunjucksFilters)
        || require('../../lib/nunjucks-filters');

    // Same isProxyHost detection as render-nunjucks.js / render-swig.js: reads
    // raw request headers + engine-specific localOptions.
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

    var filters = nunjucksFilters({
        options:     JSON.clone(localOptions),
        isProxyHost: isProxyHost,
        throwError:  self.throwError,
        req:         req,
        res:         res
    });

    // Apply bundle-level filter wraps registered on process state. Bundle-level
    // monkey-patches on `lib.nunjucksFilters` don't survive refreshCore() (a
    // fresh lib singleton ~per-request in dev mode), so bundles register their
    // wrap on `process.gina._bundleFilterWraps[bundleName]` and the framework
    // applies them here — parity with the sync render-nunjucks.js path.
    var bundleFilterWraps = (process.gina && process.gina._bundleFilterWraps) || {};
    Object.keys(bundleFilterWraps).forEach(function (bundleName) {
        var wrap = bundleFilterWraps[bundleName];
        if (typeof wrap === 'function') {
            try {
                filters = wrap(filters) || filters;
            } catch (wrapErr) {
                try {
                    console.warn('[render-nunjucks-async] bundle filter wrap failed for ' + bundleName + ': ' + (wrapErr.message || wrapErr));
                } catch (e) {}
            }
        }
    });

    for (var name in filters) {
        if (typeof filters[name] === 'function' && name !== 'getConfig') {
            env.addFilter(name, filters[name]);
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
                try { console.warn('[render-nunjucks-async] stream already destroyed on HEAD — client disconnected ('+ req.url +')'); } catch (e) {}
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
            try { console.warn('[render-nunjucks-async] stream already destroyed — client disconnected before response ('+ req.url +')'); } catch (e) {}
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
 * Post-render asset injection. Inserts the bundle's stylesheets / scripts, the
 * external plugins, and the gina client bootstrap (`gina.onload.min.js`) onto
 * the `</head>` / `</body>` anchors of the rendered HTML. Verbatim port of
 * render-nunjucks.js `injectAssets()` — the async delegate renders through the
 * engine API (no FS `getAssets()` machinery), so it injects post-render.
 *
 * Honours `javascriptsDeferEnabled` (scripts in `<head>` vs before `</body>`)
 * and `javascriptsExcluded === '**'` (suppresses the bootstrap). Skips any
 * asset already present in the HTML (idempotent) and any fragment missing the
 * `</head>`/`</body>` anchor (HEAD responses, partial renders) — returning the
 * HTML unchanged rather than growing truncated markup.
 *
 * @inner
 * @param {string}  html         - Rendered HTML from the nunjucks async engine
 * @param {object}  data         - Template data (`data.page.view.stylesheets`/`.scripts`)
 * @param {object}  localOptions - Controller options (`template.ginaLoader`, `.externalPlugins`, …)
 * @param {string} [cspNonce]    - #HDR5 per-request CSP nonce; stamps the bootstrap <script>
 * @returns {string} HTML with asset tags injected where appropriate
 */
function injectAssets(html, data, localOptions, cspNonce) {
    if (typeof html !== 'string' || html.length === 0) { return html; }
    if (!data || !data.page || !data.page.view) { return html; }

    var stylesheetsHtml = data.page.view.stylesheets || '';
    var scriptsHtml     = data.page.view.scripts     || '';
    var tpl             = localOptions && localOptions.template;
    var isDeferMode     = !!(tpl && tpl.javascriptsDeferEnabled);
    var jsExcluded      = tpl && tpl.javascriptsExcluded;
    var ginaLoader      = tpl && tpl.ginaLoader;
    // #HDR5 — stamp the bootstrap <script> with the per-request nonce when present.
    // The loader is a cached, immutable string; .replace() returns a fresh copy.
    if (cspNonce && typeof ginaLoader === 'string') {
        ginaLoader = ginaLoader.replace(
            '<script type="text/javascript">',
            '<script type="text/javascript" nonce="' + cspNonce + '">'
        );
    }
    var externalPlugins = (tpl && Array.isArray(tpl.externalPlugins)) ? tpl.externalPlugins : [];
    var hasHead         = /<\/head>/i.test(html);
    var hasBody         = /<\/body>/i.test(html);

    if (stylesheetsHtml && hasHead && html.indexOf(stylesheetsHtml) === -1) {
        html = html.replace(/<\/head>/i, '\n\t' + stylesheetsHtml + '\n</head>');
    }

    if (scriptsHtml && html.indexOf(scriptsHtml) === -1) {
        if (isDeferMode && hasHead) {
            html = html.replace(/<\/head>/i, '\t' + scriptsHtml + '\n</head>');
        } else if (hasBody) {
            html = html.replace(/<\/body>/i, '\t' + scriptsHtml + '\n</body>');
        }
    }

    if (externalPlugins.length > 0 && hasHead) {
        var extHtml = externalPlugins.join('');
        if (extHtml && html.indexOf(extHtml) === -1) {
            html = html.replace(/<\/head>/i, '\t' + extHtml + '\n</head>');
        }
    }

    if (
        ginaLoader
        && jsExcluded !== '**'
        && hasHead
        && !/window\.onGinaLoaded/.test(html)
    ) {
        html = html.replace(/<\/head>/i, '\t' + ginaLoader + '\n</head>');
    }

    return html;
}

/**
 * Build the per-request async loader adapter — a `nunjucks.Loader.extend(...)`
 * subclass instance that bridges nunjucks' loader protocol to the gina async
 * loader. `resolve` is overridden to identity so the gina loader's `resolve()`
 * (carrying the CVE-2023-25345 segment guard + any backend containment check)
 * is the single path authority on every transitive hop; nunjucks' default
 * `resolve` would path-join `..`-laden ids. `getSource` routes through
 * `ginaLoader.resolve` then `ginaLoader.load`, returning the nunjucks
 * `{ src, path, noCache }` source shape.
 *
 * @inner
 * @param {*}      nunjucks   - The resolved nunjucks module (exposes `.Loader`)
 * @param {object} ginaLoader - Guarded async loader (from `process.gina._nunjucksLoaders`)
 * @returns {*} A new async loader adapter instance for `new nunjucks.Environment(adapter)`
 */
function buildLoaderAdapter(nunjucks, ginaLoader) {
    var AsyncGinaLoader = nunjucks.Loader.extend({
        async: true,
        // Identity: hand the raw requested name to getSource so gina's
        // flat-namespace resolve() is the only path authority.
        resolve: function (from, to) { return to; },
        getSource: function (name, cb) {
            var id;
            try {
                id = ginaLoader.resolve(name);   // CVE guard + backend containment run HERE
            } catch (e) {
                return void cb(e);
            }
            ginaLoader.load(id, function (err, src) {
                if (err) { return void cb(err); }
                cb(null, {
                    src:     src,
                    path:    id,
                    noCache: process.env.NODE_ENV_IS_DEV === 'true'
                });
            });
        }
    });
    return new AsyncGinaLoader();
}

/**
 * Async-loader nunjucks render delegate. Signature matches the other delegates
 * so controller.js can dispatch to it interchangeably.
 *
 * @param {object}   userData          - Controller-supplied template data
 * @param {boolean=} displayInspector  - Dev Inspector toggle (deferred — unused in the MVP)
 * @param {object=}  errOptions        - Options when invoked from the error pipeline
 * @param {object}   deps              - Injected controller refs ({ self, local, getData, hasViews, setResources, headersSent, ... })
 * @returns {Promise<void>}
 *
 * @example
 * // Selected automatically by controller.js when the bundle configures
 * // render.engine = 'nunjucks' AND settings.template.nunjucks.loader; the
 * // controller action just calls self.render(data).
 */
module.exports = async function renderNunjucksAsync(userData, displayInspector, errOptions, deps) {
    var self         = deps.self;
    var local        = deps.local;
    var getData      = deps.getData;
    var hasViews     = deps.hasViews;
    var headersSent  = deps.headersSent;
    var setResources = deps.setResources; // #TPL1 — populates data.page.view.stylesheets/.scripts for asset injection

    // Function-scoped captures of the per-request refs (#M1 race fix — mirror of
    // render-nunjucks/render-swig-async). This render awaits (the promisified
    // env.render); capturing isolates post-await reads from a concurrent
    // throwError null-out on the controller closure.
    var req   = local.req;
    var res   = local.res;
    var _next = local.next;

    // #HDR5/#HDR16 — per-request CSP nonce (set on req by gina.plugins.Csp({useNonce:true})).
    var _cspNonce = (req && req._ginaCspNonce) ? req._ginaCspNonce : null;

    // Fetch the resolved nunjucks module (project-installed; bundle startup
    // already validated it via nunjucksResolver.load). get() throws if no load
    // succeeded — surface cleanly via throwError.
    var nunjucks;
    try {
        nunjucks = (libRef && libRef.nunjucksResolver)
            ? libRef.nunjucksResolver.get()
            : require('../../lib/nunjucks-resolver').get();
    } catch (err) {
        return self.throwError(err);
    }

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
    // render-nunjucks.js / render-swig-async.js.
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
            console.error('[render-nunjucks-async] ' + data.page.data.status + ' from upstream — routing to throwError');
        } catch (e) { /* ignore */ }
        return self.throwError(errorObject);
    }

    // Registry key — the SAME expression initNunjucksEngine used to stash the
    // loader (conf.content.templates._common.html), so the two sides never diverge.
    var loaderKey = localOptions.conf
        && localOptions.conf.content
        && localOptions.conf.content.templates
        && localOptions.conf.content.templates._common
        && localOptions.conf.content.templates._common.html;

    var stash = (loaderKey && process.gina._nunjucksLoaders) ? process.gina._nunjucksLoaders[loaderKey] : null;
    if (!stash || !stash.loader) {
        return self.throwError(new Error(
            '[render-nunjucks-async] no async nunjucks loader registered for bundle ' + localOptions.bundle +
            ' — initNunjucksEngine did not build one (was settings.template.nunjucks.loader removed at runtime?)'
        ));
    }
    var ginaLoader = stash.loader;

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

    // Bug-J — alias `data.data` to `data.page.data` so page-shell
    // `{% set X = data.Y %}` resolves under nunjucks layout inheritance (swig
    // does this via `_layouts/layout.html` `{% set data = page.data %}`). Without
    // it a page-shell's `{% set document = data.document %}` evaluates to
    // undefined. Parity with the sync render-nunjucks.js delegate.
    if (data && data.page && data.page.data) {
        data.data = data.page.data;
    }

    // #HDR5/#HDR16 — expose the per-request CSP nonce to templates: top-level
    // {{ cspNonce }} (render-nunjucks parity) AND {{ page.cspNonce }}
    // (render-swig-async parity). Keys stay absent when no nonce is set.
    if (_cspNonce) {
        data.cspNonce = _cspNonce;
        if (!data.page) { data.page = {}; }
        data.page.cspNonce = _cspNonce;
    }

    // Build the per-request Environment over the async loader adapter. PER-REQUEST
    // (never the cached _nunjucksEnvs registry) — see the module header §8.1 rationale.
    var env;
    try {
        var adapter = buildLoaderAdapter(nunjucks, ginaLoader);
        env = new nunjucks.Environment(adapter, {
            autoescape:       (stash.autoescape !== false),
            throwOnUndefined: false,
            trimBlocks:       false,
            lstripBlocks:     false
        });
    } catch (envErr) {
        return self.throwError(envErr);
    }

    try {
        registerGinaFilters(env, self, local, localOptions, req, res);
    } catch (filterErr) {
        return self.throwError(filterErr);
    }

    // #TPL1 asset injection — populate data.page.view.stylesheets / .scripts so
    // injectAssets() (post-render) can auto-inject the gina client bundle, CSS
    // and JS into the off-disk render. Mirrors render-swig-async.js: isWithoutLayout
    // (XHR/popin) responses filter the asset list to common-only via Collection.
    if (typeof setResources === 'function') {
        try {
            var isWithoutLayout   = !!localOptions.isWithoutLayout;
            var localTemplateConf = localOptions.template;
            if (isWithoutLayout && localTemplateConf) {
                localTemplateConf = JSON.clone(localTemplateConf);
                if (Collection && Array.isArray(localTemplateConf.javascripts)) {
                    localTemplateConf.javascripts = new Collection(localTemplateConf.javascripts)
                        .find({ isCommon: false }, { isCommon: true, name: 'gina' });
                }
                if (Collection && Array.isArray(localTemplateConf.stylesheets)) {
                    localTemplateConf.stylesheets = new Collection(localTemplateConf.stylesheets)
                        .find({ isCommon: false }, { isCommon: true, name: 'gina' });
                }
            }
            setResources(localTemplateConf);
            // Re-overlay getData() so the freshly-set page.view.stylesheets /
            // .scripts reach `data` — the render-swig.js:609 "needed !!" step:
            // setResources writes via the controller's set() into local.userData,
            // getData() rebuilds the data object, and merge fills the new keys.
            data = merge(data, getData());
        } catch (resourcesErr) {
            try { console.warn('[render-nunjucks-async] setResources failed: ' + (resourcesErr.message || resourcesErr)); } catch (e) {}
        }
    }

    var templateName;
    try {
        templateName = resolveTemplatePath(data, localOptions);
    } catch (pathErr) {
        return self.throwError(pathErr);
    }

    // Callback-form render is MANDATORY with an async loader — a sync
    // env.render(name, ctx) returns null silently on an uncached template.
    // nunjucks' async codegen drives resolve->getSource for the page template
    // AND its transitive extends/include chain through the adapter.
    var html;
    try {
        html = await new Promise(function (resolve, reject) {
            env.render(templateName, data, function (err, out) {
                if (err) { return reject(err); }
                resolve(out);
            });
        });
    } catch (renderErr) {
        return self.throwError(renderErr);
    }

    // #TPL1 — post-render asset injection (stylesheets / scripts / ginaLoader /
    // externalPlugins) onto the </head> / </body> anchors. Falls through with
    // un-mutated HTML on any error so a mis-shaped template config never breaks
    // the render.
    try {
        html = injectAssets(html, data, localOptions, _cspNonce);
    } catch (assetErr) {
        try { console.warn('[render-nunjucks-async] asset injection skipped: ' + (assetErr.message || assetErr)); } catch (e) {}
    }

    // The injected gina bootstrap (gina.onload.min.js) is a literal HTML string
    // carrying {{ page.X }} / {{ page.environment.X }} / {{ page.data.session.X }}
    // placeholders the engine never saw (inserted post-render); resolve them with
    // whisper(). Mirrors render-nunjucks.js / render-swig-async.js. Without this,
    // window.onGinaLoaded throws a JSON.parse SyntaxError and gina.popin /
    // gina.session / gina.forms / onGenericXhrResponse stay undefined.
    try {
        if (data && data.page && typeof data.page === 'object' && typeof whisper === 'function') {
            var ginaLoaderDic = {};
            for (var _d in data.page) {
                ginaLoaderDic['page.' + _d] = data.page[_d];
            }
            if (typeof data.page.environment === 'object' && data.page.environment !== null) {
                for (var _k in data.page.environment) {
                    ginaLoaderDic['page.environment.' + _k] = data.page.environment[_k];
                }
            }
            // gina.onload.min.js also references `{{ page.data.session.X }}` (depth 3).
            if (data.page.data && typeof data.page.data === 'object' && data.page.data.session && typeof data.page.data.session === 'object') {
                for (var _s in data.page.data.session) {
                    ginaLoaderDic['page.data.session.' + _s] = data.page.data.session[_s];
                }
            }
            html = whisper(ginaLoaderDic, html, /\{{ ([a-zA-Z.]+) \}}/g);
        }
    } catch (whisperErr) {
        try { console.warn('[render-nunjucks-async] ginaLoader whisper substitution skipped: ' + (whisperErr.message || whisperErr)); } catch (e) {}
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
