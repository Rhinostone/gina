/**
 * #B877 — a `:placeholder` in `param.file` that is a URL segment renders the URL value's template.
 *
 * Before the fix, a query or body value named like the placeholder replaced a URL segment that had
 * passed the route's requirement: `/b877strict/page?name=other`, on a route whose requirement allows
 * only `page`, rendered `content/other.html`. The router now fills the placeholder from the values
 * the route matched (each URL segment, and each query key a requirement of the rule validated), over
 * the request data; #B833's guard still checks every value, and the render boundary (#B867) still
 * confines the path.
 *
 * This boots the REAL bin/gina-container (isaac, http/1.1) on a scaffolded bundle whose routes put a
 * placeholder in `param.file`, with a marker template OUTSIDE the template root (inside the throwaway
 * sandbox). Asserted: a same-name query value no longer selects another template (the fix), an
 * escaping same-name query value is ignored and leaks nothing, a query key folded in by its
 * requirement still selects its template, and escaping values are still refused. Red-first against
 * the pre-fix tree (develop `cfa27f723`): the override arms render `other.html`, the escaping one
 * answers 500. Seam: B877_GINA_ROOT=<tree>.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-param-file-matched-b877.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b877-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'b877m' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 12300;

var PAGE_SENTINEL   = 'B877-PAGE-' + STAMP;
var OTHER_SENTINEL  = 'B877-OTHER-' + STAMP;
var MARKER_SENTINEL = 'B877-MARKER-' + STAMP;

var BOOT_TIMEOUT_MS  = 30000;
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B877_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');
var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var results = {};   // arm key -> { status, body }

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
 * GET a RAW path (query and encodings preserved, never normalised through URL()).
 *
 * @inner
 * @param {string} rawPath
 * @returns {Promise<{status: (number|null), body: string, err: (string|undefined)}>}
 */
function getRaw(rawPath) {
    return new Promise(function (resolve) {
        var req = http.request({ host: '127.0.0.1', port: bundlePort, path: rawPath, method: 'GET', agent: false }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
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
 * Install the #B877 routes, templates, marker and controller action into the scaffolded bundle.
 *
 * @inner
 * @returns {void}
 */
function installFixture() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);

    var rf = path.join(src, 'config', 'routing.json');
    var r = JSON.parse(stripLineComments(fs.readFileSync(rf, 'utf8')));
    // a URL segment with an anchored requirement
    r.b877strict = { url: '/b877strict/:name', method: 'GET', requirements: { name: '/^(page)$/' }, param: { control: 'b877show', file: 'content/:name', name: ':name' } };
    // a URL segment without a requirement
    r.b877free   = { url: '/b877free/:name', method: 'GET', param: { control: 'b877show', file: 'content/:name', name: ':name' } };
    // a query key the requirement folds in as a segment
    r.b877fold   = { url: '/b877fold', method: 'GET', requirements: { tpl: '/.+/' }, param: { control: 'b877show', file: 'content/:tpl', tpl: ':tpl' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    var cf = path.join(src, 'controllers', 'controller.js');
    var s = fs.readFileSync(cf, 'utf8');
    var anchor = 'this.onReady = function(req, res, next){';
    if (s.split(anchor).length !== 2) { throw new Error('controller.js onReady anchor count ' + (s.split(anchor).length - 1)); }
    fs.writeFileSync(cf, s.replace(anchor, "this.b877show = function(req, res) { self.render({ ok: true }); };\n    " + anchor));

    fs.writeFileSync(path.join(src, 'templates', 'html', 'content', 'page.html'), PAGE_SENTINEL + '\n');
    fs.writeFileSync(path.join(src, 'templates', 'html', 'content', 'other.html'), OTHER_SENTINEL + '\n');
    // one level above the template root (templates/html -> templates/)
    fs.writeFileSync(path.join(src, 'templates', 'B877_MARKER.html'), MARKER_SENTINEL + '\n');

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
            strictPlain:     wr + '/b877strict/page',
            strictGood:      wr + '/b877strict/zzz',
            strictUnrelated: wr + '/b877strict/page?foo=1',
            strictOverride:  wr + '/b877strict/page?name=other',
            strictEscape:    wr + '/b877strict/page?name=..%2F..%2FB877_MARKER',
            freeOverride:    wr + '/b877free/page?name=other',
            freeEscapeUrl:   wr + '/b877free/..%5C..%5CB877_MARKER',
            foldInRoot:      wr + '/b877fold?tpl=other',
            foldEscape:      wr + '/b877fold?tpl=..%2F..%2FB877_MARKER'
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

describe('container-boot — #B877 a URL-segment placeholder in param.file renders the URL value', function () {

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
    /** The marker must NOT appear and the response must not be a 200 render. */
    function blocked(key) {
        var r = results[key];
        assert.ok(r, key + ' ran');
        assert.equal(String(r.body).indexOf(MARKER_SENTINEL) > -1, false, key + ': marker LEAKED (status ' + r.status + ')');
        assert.notEqual(r.status, 200, key + ': an escaping value must not answer 200 (got ' + r.status + ')');
    }

    it('01 - controls: the URL value renders, a value its requirement rejects does not match, an unrelated query changes nothing, a folded query key selects', function (t) {
        if (!ready(t)) { return; }
        rendered('strictPlain', PAGE_SENTINEL);
        assert.equal(results.strictGood.status, 404, 'strictGood: the requirement must still reject zzz (got ' + results.strictGood.status + ')');
        rendered('strictUnrelated', PAGE_SENTINEL);
        rendered('foldInRoot', OTHER_SENTINEL);
    });

    it('02 - a same-name query value no longer selects another template (requirement and no requirement)', function (t) {
        if (!ready(t)) { return; }
        rendered('strictOverride', PAGE_SENTINEL);
        rendered('freeOverride', PAGE_SENTINEL);
    });

    it('03 - an escaping same-name query value is ignored: the URL value renders and nothing leaks', function (t) {
        if (!ready(t)) { return; }
        rendered('strictEscape', PAGE_SENTINEL);
        assert.equal(String(results.strictEscape.body).indexOf(MARKER_SENTINEL) > -1, false, 'strictEscape: marker LEAKED');
    });

    it('04 - escaping values are still refused: a URL segment, and a query key folded in by its requirement', function (t) {
        if (!ready(t)) { return; }
        blocked('freeEscapeUrl');
        blocked('foldEscape');
    });
});
