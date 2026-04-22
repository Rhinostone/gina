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
 * ## Status — MVP (Session N2 + Inspector + HTTP/2 + error-page ports 2026-04-22)
 *
 * Renders a `.njk` template with locals data and sends an HTTP/1.1 or HTTP/2
 * response. Inspector dev-payload injection, HTTP/2 `stream.respond()` direct
 * path, and error-page template routing are all shipped. The following are
 * still deferred to follow-up sessions and called out inline:
 *
 *   1. ~~**Inspector `__gdPayload`**~~ — **shipped**. `<script>window.__ginaData = ...</script>`
 *      + `<script>window.__ginaLogs = ...</script>` are injected before `</body>`
 *      in dev mode, redacted via `lib/inspector-redact`, stashed on
 *      `self.serverInstance._lastGinaData`, and emitted via
 *      `process.emit('inspector#data')`. Within this port, **statusbar.html
 *      inclusion is still deferred** — the swig template uses `{% include %}`
 *      with swig-specific syntax; a nunjucks-compatible statusbar template
 *      is a separate follow-up. `data.page.flow` (flow timeline from
 *      `local._timeline`) and `data.page.queries` (query log from
 *      `local._queryLog`) are also not yet piped into the Inspector payload
 *      — the data is computed in render-swig.js around lines 980-1040 and
 *      belongs in a shared helper before porting.
 *   2. ~~**HTTP/2 `stream.respond()` direct path**~~ — **shipped 2026-04-22**
 *      (commit TBD). `sendHtmlResponse` now implements the four-way branch
 *      from `class.controller.md §7b` (HEAD×stream, HEAD×HTTP1.1, body×stream,
 *      body×HTTP1.1). HTTP/2 streams bypass the compat layer, merge pipeline-set
 *      headers (CORS, cache-control) via `local.res.getHeaders()`, and guard
 *      against `stream.destroyed || stream.closed` client disconnects that
 *      would otherwise throw `ERR_HTTP2_INVALID_STREAM`. Early Hints 103
 *      auto-send for CSS/JS preloads is still deferred — that path in swig
 *      runs in `controller.js this.render()` before the delegate is called.
 *   3. ~~**Error-page template routing**~~ — **shipped 2026-04-22** (commit TBD).
 *      When `controller.js renderCustomError()` sets `localOptions.file` to
 *      the absolute path of the bundle's error template (from
 *      `bundleConf.content.templates._common.errorFiles[code]`), the
 *      `isRenderingCustomError` branch below reads the file with
 *      `fs.readFileSync` and renders it via `env.renderString(source, data)`
 *      instead of going through `FileSystemLoader` (which rejects absolute
 *      paths and cannot reach shared-path error templates outside the bundle
 *      root). Failures fall back to a minimal inline HTML body rather than
 *      recursing via `self.throwError` — recursion would re-enter this same
 *      branch and could loop. The defensive `localOptions.isRenderingCustomError
 *      = false` reset after render mirrors render-swig.js lines 804, 1434.
 *   4. **Early Hints 103** auto-send — lives in `controller.js this.render()`
 *      before the delegate runs, so the port is controller-level rather than
 *      render-nunjucks-level.
 *   5. **Static HTML cache writes** — no `writeCache()` equivalent; every
 *      request re-renders even when the route has `cache` configured.
 *   6. **Asset cataloguing / `setResources`** — no `<gina>` layout placeholder
 *      resolution, no automatic CSS/JS preload injection. Users wire their
 *      own `<link>` / `<script>` tags into templates.
 *   7. **Gina SwigFilters registration** — the swig-specific filter registry
 *      (`getWebroot`, `nl2br`, etc.) is not ported. Users register their own
 *      filters via `nunjucks.Environment.addFilter()`.
 *   8. **Layout composition** — nunjucks' native `{% extends %}` / `{% block %}`
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

var fs              = require('fs');
var nodePath        = require('path');
var inspectorRedact = require('lib/inspector-redact');

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
 * Builds the Inspector dev-payload scripts and injects them into the
 * rendered HTML just before `</body>`. Mirrors render-swig.js:1041-1128
 * but without the `statusbar.html` `{% include %}` (that template is
 * swig-specific — a nunjucks-compatible version is a follow-up).
 *
 * Runs only in dev mode (`self.isCacheless()`), gated by `displayInspector`:
 *
 *   - `displayInspector === true`    → always inject (explicit opt-in)
 *   - `displayInspector === undefined` → inject when cacheless (dev-mode default)
 *   - `displayInspector === false`   → never inject
 *
 * Side effects beyond the HTML mutation:
 *   1. Stashes redacted `__gdPayload` on `self.serverInstance._lastGinaData` —
 *      consumed by the engine.io push and `/_gina/agent` SSE stream.
 *   2. Stashes unredacted snapshot on `serverInstance._lastGinaDataUnredacted`
 *      ONLY when `NODE_SCOPE === 'local'`. Other scopes clear it to null so
 *      `/_gina/reveal` never has anything to leak.
 *   3. Emits `process.emit('inspector#data', __gdPayload)` so attached
 *      listeners (dev-mode sockets) pick up the snapshot.
 *
 * @inner
 * @param  {string}  html              - Rendered HTML from the nunjucks engine
 * @param  {object}  data              - Template data (has `data.page.*`)
 * @param  {object}  self              - SuperController instance (has serverInstance, isCacheless)
 * @param  {object}  local             - Per-request closure
 * @param  {boolean} [displayInspector]
 * @returns {string} HTML with scripts injected, or the original string when gated off
 */
function injectInspectorScripts(html, data, self, local, displayInspector) {
    if (displayInspector === false) { return html; }
    if (displayInspector !== true && !self.isCacheless()) { return html; }
    if (!data || !data.page) { return html; }
    // No `</body>` anchor → nothing safe to inject into. Don't force it.
    if (!/<\/body>/i.test(html)) { return html; }

    // Two deep clones — one labelled gina (metadata for the Inspector
    // sidebar), one labelled user (mirrors what application code sees).
    // JSON.parse(JSON.stringify(...)) is intentional: it drops functions,
    // prototype chains, and circular refs — exactly what we want before
    // handing the payload to a client-side script tag.
    var __gdGina = JSON.parse(JSON.stringify(data.page));
    var __gdUser = JSON.parse(JSON.stringify(data.page));
    if (__gdGina.view) {
        __gdGina.view.assets      = {};
        __gdGina.view.scripts     = 'ignored-by-toolbar';
        __gdGina.view.stylesheets = 'ignored-by-toolbar';
    }
    if (__gdUser.view) {
        __gdUser.view.scripts     = 'ignored-by-toolbar';
        __gdUser.view.stylesheets = 'ignored-by-toolbar';
        __gdUser.view.assets      = {};
    }

    // Redact config — identical source lookup to render-swig.js:1056
    // so the two engines produce the same Inspector payload shape.
    var _redactConf = inspectorRedact.getConfig(local.options.conf);
    __gdGina.inspectorRedact = {
        patterns:    _redactConf.patterns,
        types:       _redactConf.types,
        replacement: _redactConf.replacement
    };
    if (__gdGina.environment) {
        __gdGina.environment.scope = process.env.NODE_SCOPE || null;
    }

    // #INS8 — standalone Inspector URL (settings.json > inspector.url)
    var _inspUrlConf = null;
    try {
        var _confSource = local.options.conf || {};
        if (_confSource.content && _confSource.content.settings
            && _confSource.content.settings.inspector
            && _confSource.content.settings.inspector.url) {
            _inspUrlConf = _confSource.content.settings.inspector.url;
        }
    } catch (e) { /* leave null */ }
    __gdGina.inspectorUrl = _inspUrlConf;

    var __gdPayload = { gina: __gdGina, user: __gdUser };
    // Snapshot BEFORE redaction, gated on local scope only.
    var __gdPayloadUnredacted = (process.env.NODE_SCOPE === 'local')
        ? JSON.parse(JSON.stringify(__gdPayload)) : null;
    __gdPayload = inspectorRedact.redact(__gdPayload, {
        compiledPatterns: _redactConf.compiledPatterns,
        replacement:      _redactConf.replacement
    });

    // `</script>` and `<!--` must be escaped inside JSON-serialised script
    // content so the browser's HTML parser doesn't terminate the tag early
    // or start an HTML comment. Matches render-swig.js:1096-1097.
    var _safeJson = JSON.stringify(__gdPayload)
        .replace(/<\/script>/gi, '<\\/script>')
        .replace(/<!--/g, '<\\!--');

    var __gdScript   = '<script>window.__ginaData = ' + _safeJson + ';</script>\n';
    var _bundleName  = (__gdUser.environment && __gdUser.environment.bundle) || '';
    var __logsScript = '<script>'
        + 'window.__ginaLogs = window.__ginaLogs || [];'
        + '(function(w){'
        + 'var _c=w.console,_l=w.__ginaLogs,_b=' + JSON.stringify(_bundleName) + ';'
        + '["log","info","warn","error","debug"].forEach(function(lvl){'
        + 'var orig=_c[lvl].bind(_c);'
        + '_c[lvl]=function(){'
        + 'orig.apply(_c,arguments);'
        + 'try{_l.push({t:Date.now(),l:lvl,b:_b,s:Array.prototype.slice.call(arguments).join(" ")});}catch(e){}'
        + '};});'
        + '}(window));</script>\n';

    // Stash on serverInstance + emit event. Swig path does both; the
    // Inspector-observer side depends on these specific side effects.
    if (self.serverInstance) {
        self.serverInstance._lastGinaData = __gdPayload;
        self.serverInstance._lastGinaDataUnredacted = __gdPayloadUnredacted; // null outside local scope
    }
    try {
        process.emit('inspector#data', __gdPayload);
    } catch (e) { /* listener raised — not fatal to the render */ }

    // Inject before the first `</body>`. Case-insensitive match; the
    // surrounding newline + tab match render-swig's formatting so the
    // diff against a rendered swig-then-nunjucks page is cosmetic-only.
    return html.replace(/<\/body>/i, '\t' + __logsScript + __gdScript + '\n\t</body>');
}

/**
 * Send the rendered HTML back through the appropriate response path.
 * Implements the four-way branch described in
 * `the internal architecture docs §7b` — same shape as
 * `render-swig.js:877-927`:
 *
 *   1. HEAD + HTTP/2 stream  → `stream.respond({content-type, content-length, :status})` + `stream.end()`
 *   2. HEAD + HTTP/1.1       → `res.setHeader(content-type/content-length)` + `res.end()` (no body)
 *   3. body + HTTP/2 stream  → `stream.respond({content-type, :status})` + `stream.end(html)`
 *   4. body + HTTP/1.1       → `res.end(html)` (content-type set earlier)
 *
 * The HTTP/2 branches merge headers set earlier in the pipeline (CORS,
 * cache-control, cookies) via `local.res.getHeaders()` because
 * `stream.respond()` on the raw HTTP/2 stream does NOT include headers
 * set via `response.setHeader()`. The `stream.destroyed || stream.closed`
 * guard is required — the client may have disconnected before the async
 * render callback completed, in which case `stream.respond()` throws
 * `ERR_HTTP2_INVALID_STREAM`.
 *
 * `local.res.headersSent = true` is set after a successful `stream.respond()`
 * to signal to the HTTP/1.1 compat layer that the response was sent
 * directly, matching render-swig's §7b pattern.
 *
 * @inner
 * @param {object} local  - Per-request closure
 * @param {string} html   - Rendered HTML content
 */
function sendHtmlResponse(local, html) {
    if (local.res.headersSent) { return; }

    var statusCode = local.res.statusCode || 200;
    var stream     = (local.res && typeof local.res.stream !== 'undefined') ? local.res.stream : null;
    var isHead     = /^HEAD$/i.test(local.req.method);
    var byteLength = Buffer.byteLength(html, 'utf8');
    // Ensure content-type is set on the HTTP/1.1 response so header merge
    // picks it up for the stream paths and setHeader()-only paths alike.
    if (!local.res.getHeader('content-type')) {
        local.res.setHeader('content-type', 'text/html; charset=utf-8');
    }

    if (isHead) {
        if (stream) {
            // Case 1: HEAD + HTTP/2
            if (stream.destroyed || stream.closed) {
                try { console.warn('[render-nunjucks] stream already destroyed on HEAD — client disconnected ('+ local.req.url +')'); } catch (e) {}
                return;
            }
            if (!stream.headersSent) {
                var _headH2 = {
                    'content-type':   local.res.getHeader('content-type'),
                    'content-length': byteLength,
                    ':status':        statusCode
                };
                var _pendingHeadH2 = local.res.getHeaders ? local.res.getHeaders() : {};
                for (var _hh2k in _pendingHeadH2) {
                    if (!(_hh2k in _headH2)) { _headH2[_hh2k] = _pendingHeadH2[_hh2k]; }
                }
                stream.respond(_headH2);
            }
            stream.end();
            local.res.headersSent = true;
        } else {
            // Case 2: HEAD + HTTP/1.1
            local.res.setHeader('content-length', byteLength);
            local.res.writeHead(statusCode);
            local.res.end();
        }
        return;
    }

    if (stream) {
        // Case 3: body + HTTP/2
        if (stream.destroyed || stream.closed) {
            try { console.warn('[render-nunjucks] stream already destroyed — client disconnected before response ('+ local.req.url +')'); } catch (e) {}
            return;
        }
        if (!stream.headersSent) {
            var _streamHeaders = {
                'content-type': local.res.getHeader('content-type'),
                ':status':      statusCode
            };
            // Merge pipeline-set headers (CORS, cache-control, etc.) —
            // `stream.respond()` does not include them automatically.
            var _pendingHeaders = local.res.getHeaders ? local.res.getHeaders() : {};
            for (var _shk in _pendingHeaders) {
                if (!(_shk in _streamHeaders)) { _streamHeaders[_shk] = _pendingHeaders[_shk]; }
            }
            stream.respond(_streamHeaders);
        }
        stream.end(html);
        local.res.headersSent = true;
        return;
    }

    // Case 4: body + HTTP/1.1
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

    var env;
    try {
        env = getEnvironment(nunjucks, templateRoot, {
            autoescape: (localOptions.autoescape !== false)
        });
    } catch (envErr) {
        return self.throwError(envErr);
    }

    var isRenderingCustomError = (localOptions.isRenderingCustomError === true);
    var html;

    if (isRenderingCustomError) {
        // Custom error template path. `controller.js renderCustomError()` set
        // `localOptions.file` to the absolute path of the bundle's error file
        // (from `bundleConf.content.templates._common.errorFiles[code]` — see
        // `config.js:2653`). Error templates may live under the bundle's
        // template root OR under the shared path (outside the root), so we
        // read the file directly via `fs.readFileSync` and feed its contents
        // to `env.renderString(source, data)` instead of going through the
        // FileSystemLoader (absolute paths are rejected by the loader, and a
        // shared-path file would be outside the bundle root regardless).
        //
        // Never recurse into `self.throwError` from this branch — that would
        // re-enter the same render call and potentially loop. Every failure
        // mode falls back to a minimal inline HTML body served via
        // `sendHtmlResponse` so the client still gets a well-formed response.
        // Mirrors the render-swig.js behaviour where `isRenderingCustomError`
        // reads the file directly at line 347 and compiles its contents.
        var _absErrTemplate = localOptions.file;
        var _errStatusCode  = (data && data.page && data.page.data && data.page.data.status) || 500;

        if (!_absErrTemplate || !fs.existsSync(_absErrTemplate)) {
            html = '<!doctype html><html><head><title>Error ' + _errStatusCode + '</title></head>'
                 + '<body><pre>[render-nunjucks] error template not found: '
                 + (_absErrTemplate || '(unset)') + '</pre></body></html>';
        } else {
            var _errSource = null;
            try {
                _errSource = fs.readFileSync(_absErrTemplate, 'utf8');
            } catch (readErr) {
                html = '<!doctype html><html><head><title>Error ' + _errStatusCode + '</title></head>'
                     + '<body><pre>[render-nunjucks] failed to read error template: '
                     + (readErr.message || readErr) + '</pre></body></html>';
            }
            if (typeof _errSource === 'string') {
                try {
                    html = env.renderString(_errSource, data);
                } catch (renderErr) {
                    html = '<!doctype html><html><head><title>Error ' + _errStatusCode + '</title></head>'
                         + '<body><pre>[render-nunjucks] error template render failed: '
                         + (renderErr.message || renderErr) + '</pre></body></html>';
                }
            }
        }

        // Defensive flag reset — mirrors render-swig.js:804, 1434. Prevents
        // a subsequent render that reuses the same localOptions reference
        // from re-entering this branch.
        localOptions.isRenderingCustomError = false;
    } else {
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

        try {
            html = env.render(templateRel, data);
        } catch (renderErr) {
            return self.throwError(renderErr);
        }
    }

    // Inspector dev-payload injection (dev mode only; no-op otherwise).
    try {
        html = injectInspectorScripts(html, data, self, local, displayInspector);
    } catch (injectErr) {
        // Never let an Inspector-side bug break the render. Log and
        // continue with the un-injected HTML.
        try { console.warn('[render-nunjucks] inspector injection skipped: ' + injectErr.message); } catch (e) {}
    }

    sendHtmlResponse(local, html);
};
