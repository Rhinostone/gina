'use strict';

/**
 * Tiny static server for the gina-dialog RUNTIME e2e harness.
 *
 * Unlike the framework-free `fixtures/popin-dialog.html` (which reimplements the
 * a11y contract in vanilla JS), this server boots the REAL built gina bundle so
 * the full-runtime scenarios — AJAX load, partial slot replace, hover preload,
 * legacy/deprecation — run against the actual delegated `data-gina-dialog*`
 * handlers in popin/main.js. It is what the `popin-dialog.runtime.spec.js`
 * webServer (playwright.config.js) starts.
 *
 * What it serves:
 *   GET /                              -> fixtures/popin-dialog.runtime.html
 *   GET /a11y                          -> fixtures/popin-dialog.html (framework-free
 *                                         a11y harness; its stylesheet link resolves
 *                                         through this server's /css route)
 *   GET /js/gina.min.js                -> built bundle (dist)
 *   GET /js/gina.onload.js             -> built onload (dist), whisper tokens
 *                                         substituted with harness stub values
 *   GET /css/vendor/gina/gina.min.css  -> built stylesheet (dist)
 *   GET /_gina/assets/routing.json     -> {}  (the getDependencies runtime fetch)
 *   GET /frag/<name>.html              -> in-memory AJAX fragments (below)
 *
 * The framework dir is resolved from package.json `version` (same idiom as the
 * bundle-freshness CI gate) so it tracks version bumps without edits here.
 *
 * Run standalone:  GINA_E2E_PORT=3179 node test/e2e/runtime-server.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..', '..');
const VERSION     = require(path.join(ROOT, 'package.json')).version;
const PLUGIN_DIST = path.join(ROOT, 'framework', 'v' + VERSION, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina');
const FIXTURES    = path.join(__dirname, 'fixtures');
const PORT        = process.env.GINA_E2E_PORT ? parseInt(process.env.GINA_E2E_PORT, 10) : 3179;

// Harness stub values for the onload whisper tokens. JSON tokens are
// URI-encoded ('%7B%7D' === encodeURIComponent('{}')) because the onload
// does JSON.parse(decodeURIComponent(token)). Session tokens are left empty
// (the onload coerces '' -> null and getTimeout() early-returns on a null
// lastModified, so no Date math runs).
const ONLOAD_TOKENS = {
    'page.environment.webroot'            : '/',
    'page.environment.bundle'             : 'e2e',
    'page.environment.env'                : 'prod',
    'page.environment.envIsDev'           : 'false',
    'page.environment.scope'              : 'local',
    'page.environment.scopeIsLocal'       : 'true',
    'page.environment.scopeIsProduction'  : 'false',
    'page.environment.isProxyHost'        : 'false',
    'page.environment.proxyHost'          : '',
    'page.environment.proxyHostname'      : '',
    'page.environment.hostname'           : 'localhost',
    'page.environment.protocol'           : 'http/1.1',
    'page.environment.version'            : VERSION,
    'page.environment.routing'            : '%7B%7D',
    'page.environment.reverseRouting'     : '%7B%7D',
    'page.environment.forms'              : '%7B%7D',
    'page.data.session.id'                : '',
    'page.data.session.timeout'           : '',
    'page.data.session.createdAt'         : '',
    'page.data.session.lastModified'      : ''
};

// In-memory AJAX fragments. Kept tiny and identifiable. NB: these are HTML
// fragments (not full documents) — the popin load tail injects them as the
// dialog body. Each `partial` fragment carries a `#slot` so the partial
// (data-gina-dialog-target="#slot") re-load can swap just the slot.
const FRAGMENTS = {
    'ajax':      '<div id="ajax-frag"><h2 id="ajax-frag-title">AJAX loaded</h2><p>cold AJAX body</p></div>',
    'partial-1': '<div id="partial-root"><h2 id="partial-chrome">Chrome stays</h2><div id="slot">SLOT-ONE</div></div>',
    'partial-2': '<div id="partial-root"><h2 id="partial-chrome">REPLACED chrome</h2><div id="slot">SLOT-TWO</div></div>',
    'preload':   '<div id="preload-frag"><h2 id="preload-frag-title">Preloaded body</h2></div>',
    'legacy':    '<div id="legacy-frag"><h2 id="legacy-frag-title">Legacy body</h2></div>'
};

/**
 * renderOnload — read the built onload and substitute its `{{ token }}` whispers
 * with the harness stub values above.
 * @returns {string}
 */
function renderOnload() {
    var src = fs.readFileSync(path.join(PLUGIN_DIST, 'js', 'gina.onload.min.js'), 'utf8');
    Object.keys(ONLOAD_TOKENS).forEach(function (key) {
        var escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var re = new RegExp('\\{\\{\\s*' + escaped + '\\s*\\}\\}', 'g');
        src = src.replace(re, ONLOAD_TOKENS[key]);
    });
    return src;
}

/**
 * send — write a response with the right content-type and no-cache headers.
 */
function send(res, status, type, body) {
    res.writeHead(status, {
        'Content-Type'  : type,
        'Cache-Control' : 'no-store'
    });
    res.end(body);
}

const server = http.createServer(function (req, res) {
    var url = req.url.split('?')[0];

    try {
        if (url === '/' || url === '/index.html') {
            return send(res, 200, 'text/html; charset=utf-8',
                fs.readFileSync(path.join(FIXTURES, 'popin-dialog.runtime.html')));
        }
        if (url === '/a11y' || url === '/a11y.html') {
            return send(res, 200, 'text/html; charset=utf-8',
                fs.readFileSync(path.join(FIXTURES, 'popin-dialog.html')));
        }
        if (url === '/js/gina.onload.js') {
            return send(res, 200, 'application/javascript; charset=utf-8', renderOnload());
        }
        if (url === '/js/gina.min.js') {
            return send(res, 200, 'application/javascript; charset=utf-8',
                fs.readFileSync(path.join(PLUGIN_DIST, 'js', 'gina.min.js')));
        }
        if (url === '/css/vendor/gina/gina.min.css') {
            return send(res, 200, 'text/css; charset=utf-8',
                fs.readFileSync(path.join(PLUGIN_DIST, 'css', 'gina.min.css')));
        }
        if (url === '/_gina/assets/routing.json') {
            return send(res, 200, 'application/json; charset=utf-8', '{}');
        }
        // #B80 — a legacy popin trigger whose GET returns an XHR redirect (application/json),
        // not an HTML fragment. A hover/focus preload must NOT cache + inject this JSON as
        // popin content; the click-time popinLoad's _self tunnel must load `location` instead.
        if (url === '/redirect-frag') {
            return send(res, 200, 'application/json; charset=utf-8',
                JSON.stringify({ isXhrRedirect: true, location: '/frag/ajax.html' }));
        }
        var frag = url.match(/^\/frag\/([\w-]+)\.html$/);
        if (frag && FRAGMENTS.hasOwnProperty(frag[1])) {
            return send(res, 200, 'text/html; charset=utf-8', FRAGMENTS[frag[1]]);
        }
    } catch (err) {
        return send(res, 500, 'text/plain; charset=utf-8', String(err && err.stack || err));
    }

    return send(res, 404, 'text/plain; charset=utf-8', 'not found: ' + url);
});

server.listen(PORT, function () {
    // eslint-disable-next-line no-console
    console.log('[gina-e2e] runtime harness on http://localhost:' + PORT + '/  (framework v' + VERSION + ')');
});
