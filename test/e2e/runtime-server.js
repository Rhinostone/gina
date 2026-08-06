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
 *   GET /components                    -> fixtures/web-components.html (client
 *                                         components: SSR hydration + raw-HTML
 *                                         crawler-equivalence fixture)
 *   GET /components-csp                -> fixtures/web-components.csp.html with a
 *                                         per-request script nonce substituted and
 *                                         a REAL Content-Security-Policy header
 *   GET /css/web-components.css        -> fixtures/web-components.css
 *   GET /js/components/x-checklist.js  -> the REAL reference component from the
 *                                         view-scaffold boilerplate (specs exercise
 *                                         the shipped artifact, not a copy)
 *
 * The framework dir is resolved from package.json `version` (same idiom as the
 * bundle-freshness CI gate) so it tracks version bumps without edits here.
 *
 * Run standalone:  GINA_E2E_PORT=3179 node test/e2e/runtime-server.js
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT        = path.join(__dirname, '..', '..');
const VERSION     = require(path.join(ROOT, 'package.json')).version;
const PLUGIN_DIST = path.join(ROOT, 'framework', 'v' + VERSION, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina');
const BOILERPLATE_PUBLIC = path.join(ROOT, 'framework', 'v' + VERSION, 'core', 'template', 'boilerplate', 'bundle_public');
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
    'legacy':    '<div id="legacy-frag"><h2 id="legacy-frag-title">Legacy body</h2></div>',
    // #A11Y8 — two popin bodies, each carrying a focusable control, for the inert
    // spec. The unit replica (test/core/popin-nonmodal-inert.test.js) runs in jsdom,
    // which implements NO `inert`, so it can only assert that the marker attribute
    // was set. Proving the browser actually makes the superseded dialog
    // keyboard-unreachable needs a real engine and a real focusable target.
    'inert-a':   '<div id="inert-a-frag"><h2 id="inert-a-title">First body</h2><button id="inert-a-btn" type="button">A action</button></div>',
    'inert-b':   '<div id="inert-b-frag"><h2 id="inert-b-title">Second body</h2><button id="inert-b-btn" type="button">B action</button></div>',
    // client-components fixture (a): a popin body carrying a custom element.
    // Mirrors the reference component's server-rendered light DOM (the view
    // scaffold's x-checklist partial); 'component-script' additionally carries
    // its own external definition <script src> (popinOpen re-creates it in
    // <head>, deduped via parentScripts).
    'component':
        '<div id="component-frag"><h2 id="component-frag-title">Body with a component</h2>' +
        '<x-checklist data-x-checklist=\'{ "statusText": "%s / %s" }\'>' +
        '<p data-role="status" hidden></p>' +
        '<ul>' +
        '<li><label><input type="checkbox" checked> alpha</label></li>' +
        '<li><label><input type="checkbox"> beta</label></li>' +
        '</ul>' +
        '<template data-role="item"><li><label><input type="checkbox"> <span data-role="item-label"></span></label></li></template>' +
        '<form data-role="add" action="#" method="get"><input type="text" name="label" aria-label="New item"><button type="submit">Add</button></form>' +
        '</x-checklist></div>',
    'component-script':
        '<div id="component-script-frag"><h2 id="component-script-frag-title">Body with a component + its definition</h2>' +
        '<x-checklist data-x-checklist=\'{ "statusText": "%s / %s" }\'>' +
        '<p data-role="status" hidden></p>' +
        '<ul>' +
        '<li><label><input type="checkbox" checked> alpha</label></li>' +
        '<li><label><input type="checkbox"> beta</label></li>' +
        '</ul>' +
        '<template data-role="item"><li><label><input type="checkbox"> <span data-role="item-label"></span></label></li></template>' +
        '<form data-role="add" action="#" method="get"><input type="text" name="label" aria-label="New item"><button type="submit">Add</button></form>' +
        '</x-checklist>' +
        '<script src="/js/components/x-checklist.js"></script></div>'
};

// #CC2 — a non-empty forms whisper for the FACE-participation fixture. core.js only
// scans + binds forms when gina.forms.rules is non-empty (it stays byte-identical /
// inert otherwise), so the validator needs a rule set to activate. The `agree` field
// is a form-associated custom element (<x-agree>); the reassociated `note` input is
// intentionally rule-less (it rides the payload untrusted — the hazard-b posture).
const FACE_FORMS_JSON = JSON.stringify({ rules: { faceform: { agree: { isRequired: true } } } });

/**
 * renderOnload — read the built onload and substitute its `{{ token }}` whispers
 * with the harness stub values above. An optional raw forms-JSON string overrides
 * the (empty) `page.environment.forms` whisper so a fixture can activate the
 * validator; it is URI-encoded here because the onload does
 * JSON.parse(decodeURIComponent(token)).
 * @param {string} [formsJson] raw JSON for the forms whisper (defaults to '{}').
 * @returns {string}
 */
function renderOnload(formsJson) {
    var src = fs.readFileSync(path.join(PLUGIN_DIST, 'js', 'gina.onload.min.js'), 'utf8');
    var tokens = formsJson
        ? Object.assign({}, ONLOAD_TOKENS, { 'page.environment.forms': encodeURIComponent(formsJson) })
        : ONLOAD_TOKENS;
    Object.keys(tokens).forEach(function (key) {
        var escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var re = new RegExp('\\{\\{\\s*' + escaped + '\\s*\\}\\}', 'g');
        src = src.replace(re, tokens[key]);
    });
    return src;
}

/**
 * renderCspFixture — read the CSP fixture and substitute its `{{ nonce }}`
 * tokens with a fresh per-request script nonce (fixture (c) of the client
 * components specs: the policy must arrive as a REAL response header with a
 * per-request nonce, mirroring the deployed Csp-plugin shape — not a <meta>
 * policy).
 * @returns {{ nonce: string, body: string }}
 */
function renderCspFixture() {
    var nonce = crypto.randomBytes(16).toString('base64');
    var src = fs.readFileSync(path.join(FIXTURES, 'web-components.csp.html'), 'utf8');
    return { nonce: nonce, body: src.replace(/\{\{\s*nonce\s*\}\}/g, nonce) };
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
        // #CC2 — same onload, but with a non-empty forms whisper so the validator binds
        // (the FACE-participation fixture, /face, references this).
        if (url === '/js/gina.onload.face.js') {
            return send(res, 200, 'application/javascript; charset=utf-8', renderOnload(FACE_FORMS_JSON));
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
        // client components — framework-free fixtures + the shipped reference
        // component (see the header comment)
        if (url === '/components') {
            return send(res, 200, 'text/html; charset=utf-8',
                fs.readFileSync(path.join(FIXTURES, 'web-components.html')));
        }
        if (url === '/components-csp') {
            var csp = renderCspFixture();
            res.writeHead(200, {
                'Content-Type'            : 'text/html; charset=utf-8',
                'Cache-Control'           : 'no-store',
                'Content-Security-Policy' : "default-src 'none'; script-src 'nonce-" + csp.nonce + "'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'"
            });
            return res.end(csp.body);
        }
        if (url === '/css/web-components.css') {
            return send(res, 200, 'text/css; charset=utf-8',
                fs.readFileSync(path.join(FIXTURES, 'web-components.css')));
        }
        if (url === '/js/components/x-checklist.js') {
            return send(res, 200, 'application/javascript; charset=utf-8',
                fs.readFileSync(path.join(BOILERPLATE_PUBLIC, 'js', 'components', 'x-checklist.js')));
        }
        // #CC2 — the FACE-participation harness: fixture page + its FACE definition +
        // the always-XHR submit sink (the validator posts application/json; the sink just
        // acknowledges so the submit path completes and the spec can read the request body).
        if (url === '/face' || url === '/face.html') {
            return send(res, 200, 'text/html; charset=utf-8',
                fs.readFileSync(path.join(FIXTURES, 'web-components.face.html')));
        }
        if (url === '/js/x-agree.js') {
            return send(res, 200, 'application/javascript; charset=utf-8',
                fs.readFileSync(path.join(FIXTURES, 'x-agree.js')));
        }
        if (url === '/face-sink') {
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
