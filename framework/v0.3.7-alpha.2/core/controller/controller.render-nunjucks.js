"use strict";
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module core/controller/render-nunjucks
 *
 * Delegate file that handles `self.render()` calls when the bundle's
 * `settings.json > render.engine === 'nunjucks'`. Sister of
 * `controller.render-swig.js`; invoked through `controller.js` `this.render()`
 * dispatch.
 *
 * ## Status — MVP (Session N2)
 *
 * This is a **minimum viable** implementation. It renders a `.njk` template
 * with locals data and sends an HTTP/1.1 response. The following are
 * deliberately **deferred** to follow-up sessions and are called out inline
 * below so nothing is hidden:
 *
 *   1. **Inspector `__gdPayload`** — no `<script>__ginaData</script>` injection,
 *      no `process.emit('inspector#data')`. The Inspector Data tab will not
 *      show dev payloads for nunjucks-rendered pages until this lands.
 *   2. **HTTP/2 `stream.respond()` direct path** — always uses `res.writeHead()`
 *      + `res.end()`. HTTP/2 falls back through the compat layer; Isaac's
 *      native HTTP/2 optimisations (Early Hints 103, `stream.respond()`) are
 *      skipped.
 *   3. **Static HTML cache writes** — no `writeCache()` equivalent; every
 *      request re-renders even when the route has `cache` configured.
 *   4. **Asset cataloguing / `setResources`** — no `<gina>` layout placeholder
 *      resolution, no automatic CSS/JS preload injection. Users wire their
 *      own `<link>` / `<script>` tags into templates.
 *   5. **Gina SwigFilters registration** — the swig-specific filter registry
 *      (`getWebroot`, `nl2br`, etc.) is not ported. Users register their own
 *      filters via `nunjucks.Environment.addFilter()`.
 *   6. **Layout composition** — nunjucks' native `{% extends %}` / `{% block %}`
 *      / `{% include %}` work automatically through `FileSystemLoader`. No
 *      Gina-specific layout merging beyond that.
 *
 * The dispatch in `controller.js` reaches this file only when the bundle
 * explicitly opts in via `settings.json > render.engine === 'nunjucks'`,
 * and the bundle startup has already validated that nunjucks is installed
 * in the project via `lib.nunjucksResolver.load()` — a hard error is
 * surfaced there rather than here, so this file assumes `nunjucksResolver.get()`
 * always returns a real nunjucks module.
 *
 * @param {object}   userData              - Data merged into the template context
 * @param {boolean}  [displayInspector]    - Reserved for future Inspector support; ignored in MVP
 * @param {object}   [errOptions]          - Override `local.options` when rendering a custom error page
 * @param {object}   deps                  - Inherited refs from SuperController
 * @param {object}   deps.self             - The SuperController instance
 * @param {object}   deps.local            - Per-request closure (`req`, `res`, `next`, `options`)
 * @param {function} deps.getData          - Returns the merged template data object
 * @param {function} deps.hasViews         - Returns `true` when the route has a template configured
 * @param {function} deps.headersSent      - Returns `true` when response headers are already sent
 * @returns {Promise<void>}
 */

var fs       = require('fs');
var nodePath = require('path');

/**
 * Caches a `nunjucks.Environment` per bundle template root so we don't
 * rebuild loaders on every request. Key: absolute path to
 * `localOptions.template.html`. Value: `nunjucks.Environment` instance.
 *
 * Stored on `process.gina._nunjucksEnvs` so it survives dev-mode
 * `refreshCoreDependencies()` evictions of `controller.js` and this
 * delegate file. Cleared automatically when `lib.nunjucksResolver.reset()`
 * runs (the Environment holds a reference to the cached nunjucks module).
 *
 * @inner
 * @param {*}      nunjucks   - The loaded nunjucks module
 * @param {string} templateRoot - Absolute path to the bundle's templates/html dir
 * @param {object} [options]   - Pass-through to `new nunjucks.Environment(loader, options)`
 * @returns {*} A cached or newly created `nunjucks.Environment` instance
 */
function getEnvironment(nunjucks, templateRoot, options) {
    if (!process.gina._nunjucksEnvs) {
        process.gina._nunjucksEnvs = Object.create(null);
    }
    // Invalidate when the cached nunjucks module was hot-swapped — the
    // Environment instance is bound to the module that created it, so if
    // the module changed we must rebuild.
    if (process.gina._nunjucksEnvsOwner !== nunjucks) {
        process.gina._nunjucksEnvs = Object.create(null);
        process.gina._nunjucksEnvsOwner = nunjucks;
    }
    var key = templateRoot;
    if (!process.gina._nunjucksEnvs[key]) {
        var loader = new nunjucks.FileSystemLoader(templateRoot, {
            // Dev-mode: disable nunjucks's own template cache so template
            // edits take effect without a bundle restart. Production bundles
            // keep the cache on for performance.
            noCache: process.env.NODE_ENV_IS_DEV === 'true',
            watch:   false
        });
        process.gina._nunjucksEnvs[key] = new nunjucks.Environment(loader, {
            autoescape:  (options && typeof(options.autoescape) === 'boolean') ? options.autoescape : true,
            throwOnUndefined: false,
            trimBlocks:  false,
            lstripBlocks: false
        });
    }
    return process.gina._nunjucksEnvs[key];
}

/**
 * Resolves the template file path relative to the bundle's templates root.
 * Mirrors the non-CVE, non-namespace path of render-swig.js (see
 * render-swig.js:269-335 for the full swig version). Returns a path
 * **relative to the template root** so nunjucks's FileSystemLoader can
 * find it; absolute paths are rejected by the loader.
 *
 * @inner
 * @param {object} data         - Template data (has `data.page.view.file`, `.ext`)
 * @param {object} localOptions - The controller's localOptions (has `.template.html`, `.namespace`)
 * @returns {string} relative template path
 */
function resolveTemplatePath(data, localOptions) {
    var file = data.page.view.file;
    var ext  = data.page.view.ext || '';

    // Bundle's template root — loader is rooted here, so relative paths are
    // all the caller needs to give us.
    // var root = localOptions.template.html;  // kept for debugging reference

    // Namespace sub-dir handling (same as render-swig.js:271-290, minus the
    // CVE guard which is swig-specific legacy).
    if (localOptions.namespace) {
        var effective = file || localOptions.namespace;
        if (effective === localOptions.namespace) {
            effective = 'index';
        }
        var rel = localOptions.namespace + '/' + effective;
        if (ext && !rel.endsWith(ext)) { rel += ext; }
        return rel;
    }

    // No namespace — plain file at template root.
    var rel = file;
    if (ext && !rel.endsWith(ext)) { rel += ext; }
    return rel;
}

/**
 * Send the rendered HTML back through the standard Node response. HTTP/1.1
 * only for the MVP; HTTP/2 stream optimisations (see render-swig.js
 * §7b three-way branch in class.controller.md) are deferred.
 *
 * @inner
 * @param {object} local  - Per-request closure
 * @param {string} html   - Rendered HTML content
 */
function sendHtmlResponse(local, html) {
    if (local.res.headersSent) { return; }
    var statusCode = local.res.statusCode || 200;
    // Use setHeader rather than writeHead so anything the pipeline already
    // set (CORS, cache-control, cookies) is preserved.
    if (!local.res.getHeader('content-type')) {
        local.res.setHeader('content-type', 'text/html; charset=utf-8');
    }
    if (/^HEAD$/i.test(local.req.method)) {
        // HEAD: headers only, no body. content-length must reflect the body
        // we would have sent.
        local.res.setHeader('content-length', Buffer.byteLength(html, 'utf8'));
        local.res.writeHead(statusCode);
        local.res.end();
        return;
    }
    local.res.writeHead(statusCode);
    local.res.end(html);
}

module.exports = async function renderNunjucks(userData, displayInspector, errOptions, deps) {
    var self  = deps.self;
    var local = deps.local;
    var getData      = deps.getData;
    var hasViews     = deps.hasViews;
    var headersSent  = deps.headersSent;

    // Fetch the nunjucks module from the process-cache. `get()` throws if
    // the bundle-startup load did not succeed — we surface that cleanly
    // via throwError so the usual error page pipeline handles it.
    var nunjucks;
    try {
        nunjucks = require('../../lib').nunjucksResolver
            ? require('../../lib').nunjucksResolver.get()
            : require('../../lib/nunjucks-resolver').get();
    } catch (err) {
        return self.throwError(err);
    }

    // No-view short-circuit — e.g. redirect responses reach render() with
    // no template configured. Matches render-swig.js behaviour at this
    // level (the full render-swig file has much more nuanced handling;
    // MVP keeps it simple).
    if (!hasViews || !hasViews()) {
        return sendHtmlResponse(local, '');
    }

    // headersSent guard — if the pipeline already sent headers (e.g. an
    // upstream throwError beat us here), do nothing. render-swig.js has
    // the same guard near the top.
    if (headersSent && headersSent()) { return; }

    var localOptions = errOptions || local.options;
    var data;
    try {
        data = getData();
    } catch (dataErr) {
        return self.throwError(dataErr);
    }

    // Error-interception mirror — render-swig.js:522-555 has identical logic.
    // When render(err) is called with a non-2xx status + an `error` object,
    // route to throwError for the framework's error page rather than
    // attempting to render.
    if (
        !localOptions.isRenderingCustomError
        && data
        && data.page
        && data.page.data
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
            console.error('[render-nunjucks] ' + data.page.data.status + ' from upstream — routing to throwError');
        } catch (e) { /* ignore */ }
        return self.throwError(errorObject);
    }

    var templateRoot = localOptions.template && localOptions.template.html;
    if (!templateRoot) {
        return self.throwError(new Error(
            '[render-nunjucks] missing localOptions.template.html — cannot resolve template root'
        ));
    }

    // Merge user data into page.data so templates can access via {{ page.data.foo }}
    // or {{ foo }} at top level (promoted for ergonomic parity with swig).
    if (userData && typeof(userData) === 'object') {
        if (!data.page.data) { data.page.data = {}; }
        Object.keys(userData).forEach(function (k) {
            data.page.data[k] = userData[k];
        });
    }

    var templateRel;
    try {
        templateRel = resolveTemplatePath(data, localOptions);
    } catch (pathErr) {
        return self.throwError(pathErr);
    }

    // Template-existence pre-flight — nunjucks throws on missing templates
    // with a generic message; this produces a Gina-style error object with
    // a clear path so the dev sees what was looked up.
    var absTemplate = nodePath.join(templateRoot, templateRel);
    if (!fs.existsSync(absTemplate)) {
        return self.throwError(new Error(
            '[render-nunjucks] template not found: ' + templateRel +
            ' (looked under ' + templateRoot + ')'
        ));
    }

    var env;
    try {
        env = getEnvironment(nunjucks, templateRoot, {
            autoescape: (localOptions.autoescape !== false)
        });
    } catch (envErr) {
        return self.throwError(envErr);
    }

    var html;
    try {
        html = env.render(templateRel, data);
    } catch (renderErr) {
        return self.throwError(renderErr);
    }

    sendHtmlResponse(local, html);
};
