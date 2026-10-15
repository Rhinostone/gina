/**
 * #B883 — the router refuses an escaping URL value in `param.path` and `param.namespace`.
 *
 * `lib/routing` wrote a URL value into `param.path` and `param.namespace` before the route's
 * requirement test (fitsWithRequirements), so the #B833 router guard, which checks the values
 * checkRouteParams fills, never saw it. An escaping URL segment, or a query key that its requirement
 * folds in as a segment, reached both fields; the render boundary (#B867) refused it later. The
 * early rewrite now leaves such a value for the guarded fill, and the router answers 500 with
 * `[CVE-2023-25345] Path traversal attempt blocked in route param …`.
 *
 * A redirect route that takes its target from a query key its requirement folds in, with a value
 * starting with `/`, is refused the same way, as its no-requirement twin has been since 0.7.4
 * (decided by Martin Luther ETOUMAN NDAMBWE, 2026-10-15).
 *
 * This boots the REAL bin/gina-container (isaac, http/1.1) on a scaffolded bundle whose routes put a
 * placeholder in `param.path` (used as the template path) and in `param.namespace`, with marker
 * templates OUTSIDE the template root (inside the throwaway sandbox), plus three redirect routes.
 * Asserted: safe values render; each escaping value answers 500 from the ROUTER (the body names the
 * route param, never the render boundary) and leaks no marker; the folded redirect target is
 * refused. Red-first against the tree before this fix (the #B877 tree, 2026-10-15): the escaping
 * arms answer 500 from the render boundary, and the folded redirect answers 302.
 * Seam: B883_GINA_ROOT=<tree>.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-path-namespace-unsafe-b883.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var fs      = require('fs');
var os      = require('os');
var path    = require('path');
var { spawnSync, spawn } = require('child_process');

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b883-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'b883u' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 12400;

var PAGE_SENTINEL   = 'B883-PAGE-' + STAMP;
var MARKER_SENTINEL = 'B883-MARKER-' + STAMP;
var NS_SENTINEL     = 'B883-NSMARKER-' + STAMP;

var BOOT_TIMEOUT_MS  = 30000;
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B883_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');
var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var results = {};   // arm key -> { status, body, location }

/**
 * Whether a TCP port accepts a connection on the loopback.
 *
 * @inner
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isTcpPortOpen(port) {
    return new Promise(function (resolve) {
        var sock = new net.Socket();
        sock.setTimeout(800);
        sock.on('connect', function () { sock.destroy(); resolve(true); });
        sock.on('error',   function () { resolve(false); });
        sock.on('timeout', function () { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
    });
}

/**
 * GET a RAW path (query and encodings preserved, never normalised through URL()); a redirect is
 * not followed.
 *
 * @inner
 * @param {string} rawPath
 * @returns {Promise<{status: (number|null), body: string, location: (string|undefined), err: (string|undefined)}>}
 */
function getRaw(rawPath) {
    return new Promise(function (resolve) {
        var req = http.request({ host: '127.0.0.1', port: bundlePort, path: rawPath, method: 'GET', agent: false }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () { resolve({ status: res.statusCode, body: data, location: res.headers.location }); });
        });
        req.setTimeout(15000, function () { req.destroy(new Error('timeout')); });
        req.on('error', function (e) { resolve({ status: null, body: '', err: e.message }); });
        req.end();
    });
}

/**
 * Run the gina CLI under the throwaway HOME.
 *
 * @inner
 * @param {string[]} args
 * @returns {{status: (number|null), stdout: string, stderr: string}}
 */
function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 90000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function stripLineComments(raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); }

/**
 * Install the #B883 routes, templates, markers and controller actions into the scaffolded bundle.
 *
 * `param.path` holds the template root's absolute form (`/var/…`, not the realpath, as gina builds
 * it), with `ignoreWebRoot`, so the webroot rewrite in config.js leaves it whole (#B800); those
 * routes then match without the webroot.
 *
 * @inner
 * @returns {void}
 */
function installFixture() {
    var src  = path.join(PROJ_DIR, 'src', BUNDLE);
    var HTML = path.join(src, 'templates', 'html');

    var rf = path.join(src, 'config', 'routing.json');
    var r = JSON.parse(stripLineComments(fs.readFileSync(rf, 'utf8')));
    // a URL segment in param.path, used as the template path
    r.b883pu = { url: '/b883pu/:pth', method: 'GET', param: { control: 'b883show', pth: ':pth', ignoreWebRoot: true, path: HTML + '/content/:pth' } };
    // a query key its requirement folds in as a segment, in param.path
    r.b883pq = { url: '/b883pq', method: 'GET', requirements: { pth: '/.+/' }, param: { control: 'b883show', pth: ':pth', ignoreWebRoot: true, path: HTML + '/content/:pth' } };
    // a URL segment in param.namespace
    r.b883nu = { namespace: 'content', url: '/b883nu/:ns', method: 'GET', param: { control: 'b883show', ns: ':ns', namespace: ':ns', file: 'page' } };
    // a folded query key in param.namespace
    r.b883nq = { namespace: 'content', url: '/b883nq', method: 'GET', requirements: { ns: '/.+/' }, param: { control: 'b883show', ns: ':ns', namespace: ':ns', file: 'page' } };
    // redirects: a static target (the control), a folded query target, and its no-requirement twin
    r.b883gostatic = { url: '/b883gostatic', method: 'GET', param: { control: 'redirect', ignoreWebRoot: true, path: '/b883target', code: 302 } };
    r.b883go       = { url: '/b883go', method: 'GET', requirements: { next: '/^\\/[a-z0-9]+$/' }, param: { control: 'redirect', next: ':next', ignoreWebRoot: true, path: ':next', code: 302 } };
    r.b883go2      = { url: '/b883go2', method: 'GET', param: { control: 'redirect', next: ':next', ignoreWebRoot: true, path: ':next', code: 302 } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    var cf = path.join(src, 'controllers', 'controller.js');
    var s1 = fs.readFileSync(cf, 'utf8');
    var anchor = 'this.onReady = function(req, res, next){';
    if (s1.split(anchor).length !== 2) { throw new Error('controller.js onReady anchor count ' + (s1.split(anchor).length - 1)); }
    fs.writeFileSync(cf, s1.replace(anchor, 'this.b883show = function(req, res) { self.render({ ok: true }); };\n    ' + anchor));
    var cfc = path.join(src, 'controllers', 'controller.content.js');
    var sc = fs.readFileSync(cfc, 'utf8');
    var anchorC = '    this.home = function(req, res) {';
    if (sc.split(anchorC).length !== 2) { throw new Error('controller.content.js home anchor count ' + (sc.split(anchorC).length - 1)); }
    fs.writeFileSync(cfc, sc.replace(anchorC, '    this.b883show = function(req, res) { self.render({ ok: true }); };\n' + anchorC));

    fs.writeFileSync(path.join(HTML, 'content', 'page.html'), PAGE_SENTINEL + '\n');
    // escape targets: html/content/../../../B883_MARKER -> src/web/B883_MARKER.html ; html/../../page -> src/web/page.html
    fs.writeFileSync(path.join(src, 'B883_MARKER.html'), MARKER_SENTINEL + '\n');
    fs.writeFileSync(path.join(src, 'page.html'), NS_SENTINEL + '\n');

    fs.writeFileSync(path.join(src, 'index.js'), [
        "var gina = require('gina');",
        'gina.onInitialize(function(event, app, express){ event.emit("complete", app); });',
        'gina.onError(function(err, req, res, next){ next(err); });',
        'gina.start();', ''
    ].join('\n'));
}

/**
 * Boot the bundle with bin/gina-container, drive every arm, then stop it and wait for the port.
 *
 * @inner
 * @returns {Promise<void>}
 */
async function bootAndDrive() {
    var out = '', exit = null;
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { out += d; });
    child.on('exit', function (code, signal) { exit = { code: code, signal: signal }; });
    var alive = function () { return child.exitCode === null && child.signalCode === null; };
    var deadline = Date.now() + BOOT_TIMEOUT_MS, up = false;
    while (Date.now() < deadline && !exit) {
        if (await isTcpPortOpen(bundlePort)) { up = true; break; }
        await sleep(POLL_INTERVAL_MS);
    }
    if (!up) { setupError = 'the bundle did not come up: exit ' + JSON.stringify(exit) + '\n' + out.slice(-1800); }
    else {
        await sleep(400);
        var wr = webroot.replace(/\/$/, '');
        var ARMS = {
            puPlain:  '/b883pu/page',
            puEsc:    '/b883pu/..%5C..%5C..%5CB883_MARKER',
            pqPlain:  '/b883pq?pth=page',
            pqEsc:    '/b883pq?pth=..%2F..%2F..%2FB883_MARKER',
            nuPlain:  wr + '/b883nu/content',
            nuEsc:    wr + '/b883nu/..%5C..',
            nqPlain:  wr + '/b883nq?ns=content',
            nqEsc:    wr + '/b883nq?ns=..%2F..',
            goStatic: '/b883gostatic',
            goFold:   '/b883go?next=%2Fb883target',
            goFree:   '/b883go2?next=%2Fb883target'
        };
        for (var k in ARMS) { results[k] = await getRaw(ARMS[k]); }
    }

    if (alive()) {
        try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
        var until = Date.now() + 12000;
        while (Date.now() < until && alive()) { await sleep(150); }
        if (alive()) {
            var m = out.match(/\[ FRAMEWORK \]\[ (\d+) \]/);
            if (m) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch (e) { /* gone */ } }
            try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
        }
    }
    var free = Date.now() + 8000;
    while (Date.now() < free && await isTcpPortOpen(bundlePort)) { await sleep(150); }
}

describe('container-boot — #B883 the router refuses an escaping URL value in param.path and param.namespace', function () {

    before(async function () {
        if (process.platform === 'win32') { skip = true; skipReason = 'gina-container is Unix-centric (win32 not supported)'; return; }
        fs.mkdirSync(PROJ_DIR, { recursive: true });

        runCli(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
        var projectsPath = path.join(GINA_HOME, 'projects.json');
        if (!fs.existsSync(projectsPath) || !readJSON(projectsPath)[PROJ]) { setupError = 'project:add did not register @' + PROJ; return; }
        runCli(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
        var portsReversePath = path.join(GINA_HOME, 'ports.reverse.json');
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(portsReversePath) || !readJSON(portsReversePath)[key]) { setupError = 'bundle:add did not register ' + key; return; }
        var va = runCli(['view:add', BUNDLE, '@' + PROJ]);
        if (!fs.existsSync(path.join(PROJ_DIR, 'src', BUNDLE, 'templates', 'html', 'layouts', 'main.html'))) {
            setupError = 'view:add did not install the templates: ' + (va.stdout + va.stderr).slice(-800); return;
        }
        try {
            var target = fs.realpathSync(path.join(PROJ_DIR, 'node_modules', 'gina'));
            if (target !== fs.realpathSync(GINA_ROOT)) { setupError = 'node_modules/gina resolves to ' + target + ', not ' + GINA_ROOT; return; }
        } catch (e) { setupError = 'node_modules/gina is not linked: ' + (e.message || e); return; }

        try { installFixture(); } catch (e) { setupError = 'fixture install failed: ' + (e.message || e); return; }

        var env = readJSON(projectsPath)[PROJ].def_env || 'dev';
        try { bundlePort = readJSON(portsReversePath)[key][env]['http/1.1']['http']; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the http/1.1 http port for ' + key; return; }
        try {
            var ss = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            webroot = ((ss.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE)).replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        await bootAndDrive();
    });

    after(async function () {
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    function ready(t) {
        if (skip) { t.skip(skipReason); return false; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        return true;
    }
    /** The arm rendered the template carrying `sentinel`, with a 200. */
    function rendered(key, sentinel) {
        var r = results[key];
        assert.ok(r, key + ' ran');
        assert.equal(r.status, 200, key + ': expected a 200 render (got ' + r.status + ') — ' + String(r.body).slice(0, 200));
        assert.ok(String(r.body).indexOf(sentinel) > -1, key + ': expected the template carrying ' + sentinel + ' — got ' + String(r.body).slice(0, 200));
    }
    /** The ROUTER refused the arm: a 500 naming the route param `variable`, no render-boundary refusal, no marker. */
    function refusedByRouter(key, variable) {
        var r = results[key], b = String(r && r.body);
        assert.ok(r, key + ' ran');
        assert.equal(b.indexOf(MARKER_SENTINEL) > -1 || b.indexOf(NS_SENTINEL) > -1, false, key + ': marker LEAKED (status ' + r.status + ')');
        assert.equal(r.status, 500, key + ': expected 500 (got ' + r.status + ') — ' + b.slice(0, 200));
        assert.ok(b.indexOf('Path traversal attempt blocked in route param `' + variable + '`') > -1,
            key + ': expected the router guard for `' + variable + '` — got ' + b.slice(0, 300));
        assert.equal(/template path of route/.test(b), false, key + ': refused by the render boundary, not the router');
    }

    it('01 - controls: safe values render through param.path and param.namespace, and a static redirect redirects', function (t) {
        if (!ready(t)) { return; }
        rendered('puPlain', PAGE_SENTINEL);
        rendered('pqPlain', PAGE_SENTINEL);
        rendered('nuPlain', PAGE_SENTINEL);
        rendered('nqPlain', PAGE_SENTINEL);
        var g = results.goStatic;
        assert.ok(g.status >= 300 && g.status < 400, 'goStatic: expected a redirect (got ' + g.status + ') — ' + String(g.body).slice(0, 200));
    });

    it('02 - an escaping URL segment is refused by the router: param.path and param.namespace', function (t) {
        if (!ready(t)) { return; }
        refusedByRouter('puEsc', 'pth');
        refusedByRouter('nuEsc', 'ns');
    });

    it('03 - an escaping query key folded in by its requirement is refused by the router', function (t) {
        if (!ready(t)) { return; }
        refusedByRouter('pqEsc', 'pth');
        refusedByRouter('nqEsc', 'ns');
    });

    it('04 - a redirect target from a query value starting with `/`, no requirement: refused (since 0.7.4)', function (t) {
        if (!ready(t)) { return; }
        refusedByRouter('goFree', 'next');
    });

    it('05 - a redirect target from a query key its requirement folds in, starting with `/`: refused like its twin', function (t) {
        if (!ready(t)) { return; }
        refusedByRouter('goFold', 'next');
    });
});
