/**
 * #B833 — param.file path traversal via a request-supplied placeholder value.
 *
 * A route placeholder value coming from the REQUEST (request[method], which merges the query
 * string and body) is substituted VERBATIM into `param.file` by lib/routing checkRouteParams,
 * AFTER the route requirement was matched against the URL segment. So a query value of the same
 * name overrides a requirement-validated URL segment and, carrying `..`, escaped the bundle
 * template root in controller.render-swig.js (whose CVE-2023-25345 guard only checked
 * `file.charAt(0)`, missing a `..` in the MIDDLE of a filled path). Both render-swig branches were
 * affected — the no-namespace else-branch and the namespace branch (no guard at all).
 *
 * The fix (checkRouteParams, lib/routing): a request value that would escape as a path component
 * (`..` segment or leading separator) throws `[CVE-2023-25345] Path traversal attempt blocked`
 * before it can fill `param.file`/`.path`/`.namespace`. Developer-authored static `../` prefixes in
 * `param.file` are never request values and are untouched; a legit single-segment value renders.
 *
 * This boots the REAL bin/gina-container (isaac, http/1.1) on a scaffolded bundle with views,
 * routes whose param.file embeds a placeholder, and benign markers placed OUTSIDE the template
 * root (inside the throwaway sandbox). The security property asserted: a traversal payload never
 * renders a marker (status !== 200, marker sentinel absent), while a legit in-root value renders
 * (the subtract control). Red-first against the pre-fix tree: the traversal arms answer 200 and
 * leak the marker, failing every `markerAbsent` assertion. Seam: B833_GINA_ROOT=<tree>.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-param-file-traversal-b833.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b833trav-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'b833t' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 12100;

var IN_ROOT_SENTINEL = 'INROOT-TEMPLATE-' + STAMP;
var SHALLOW_SENTINEL = 'B833-SHALLOW-MARKER-' + STAMP;
var DEEP_SENTINEL    = 'B833-DEEP-MARKER-' + STAMP;

var BOOT_TIMEOUT_MS  = 30000;
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B833_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');
var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var results = {};   // arm key -> { status, body }

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
/** GET a RAW path (query + encodings preserved — never normalised through URL()). */
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
function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 90000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function stripLineComments(raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); }

/** The b833 routes + markers + controller actions. */
function installFixture() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);

    var rf = path.join(src, 'config', 'routing.json');
    var r = JSON.parse(stripLineComments(fs.readFileSync(rf, 'utf8')));
    // no-namespace route — render-swig else-branch (the guard that missed a mid-string `..`)
    r.b833    = { url: '/b833', method: 'GET', requirements: { tpl: '/.+/' }, param: { control: 'b833show', file: 'content/:tpl', tpl: ':tpl' } };
    // strict anchored requirement on a URL SEGMENT — the query-override test
    r.b833strict = { url: '/b833strict/:name', method: 'GET', requirements: { name: '/^(page)$/' }, param: { control: 'b833show', file: 'content/:name', name: ':name' } };
    // namespace branch (render-swig had no guard here at all)
    r.b833ns  = { namespace: 'content', url: '/b833ns', method: 'GET', requirements: { tpl: '/.+/' }, param: { control: 'b833show', file: ':tpl', tpl: ':tpl' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    // no-namespace routes resolve the control on controller.js; the namespace route on controller.content.js
    var action = "this.b833show = function(req, res) { self.render({ ok: true }); };\n    ";
    var cf = path.join(src, 'controllers', 'controller.js');
    var s = fs.readFileSync(cf, 'utf8');
    var anchor = 'this.onReady = function(req, res, next){';
    if (s.split(anchor).length !== 2) { throw new Error('controller.js onReady anchor count ' + (s.split(anchor).length - 1)); }
    fs.writeFileSync(cf, s.replace(anchor, action + anchor));
    var cfc = path.join(src, 'controllers', 'controller.content.js');
    var sc = fs.readFileSync(cfc, 'utf8');
    var anchorC = '    this.home = function(req, res) {';
    if (sc.split(anchorC).length !== 2) { throw new Error('controller.content.js home anchor count ' + (sc.split(anchorC).length - 1)); }
    fs.writeFileSync(cfc, sc.replace(anchorC, "    this.b833show = function(req, res) { self.render({ ok: true }); };\n" + anchorC));

    // in-root template (positive control / subtract control)
    fs.writeFileSync(path.join(src, 'templates', 'html', 'content', 'b833page.html'), IN_ROOT_SENTINEL + '\n');
    // one level above the template root (templates/html -> templates/)
    fs.writeFileSync(path.join(src, 'templates', 'B833_MARKER.html'), SHALLOW_SENTINEL + '\n');
    // the project root (escapes the bundle src entirely)
    fs.writeFileSync(path.join(PROJ_DIR, 'B833_DEEP_MARKER.html'), DEEP_SENTINEL + '\n');

    fs.writeFileSync(path.join(src, 'index.js'), [
        "var gina = require('gina');",
        'gina.onInitialize(function(event, app, express){ event.emit("complete", app); });',
        'gina.onError(function(err, req, res, next){ next(err); });',
        'gina.start();', ''
    ].join('\n'));
}

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
            inroot:       wr + '/b833?tpl=b833page',
            knownNeg:     wr + '/b833?tpl=does-not-exist-xyz',
            qShallowRaw:  wr + '/b833?tpl=../../B833_MARKER',
            qShallowEnc:  wr + '/b833?tpl=..%2F..%2FB833_MARKER',
            qDeepRaw:     wr + '/b833?tpl=../../../../../B833_DEEP_MARKER',
            qDeepEnc:     wr + '/b833?tpl=..%2F..%2F..%2F..%2F..%2FB833_DEEP_MARKER',
            override:     wr + '/b833strict/page?name=..%2F..%2FB833_MARKER',
            strictGood:   wr + '/b833strict/zzz',
            nsEnc:        wr + '/b833ns?tpl=..%2F..%2FB833_MARKER',
            nsRaw:        wr + '/b833ns?tpl=../../B833_MARKER',
            nsInroot:     wr + '/b833ns?tpl=b833page'
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

describe('container-boot — #B833 param.file path traversal via a request placeholder is blocked', function () {

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
    /** The marker sentinel must NOT appear and the response must not be a 200 render. */
    function blocked(key, sentinel) {
        var r = results[key];
        assert.ok(r, key + ' ran');
        assert.equal(String(r.body).indexOf(sentinel) > -1, false, key + ': marker LEAKED (status ' + r.status + ') — ' + String(r.body).slice(0, 200));
        assert.notEqual(r.status, 200, key + ': a blocked traversal must not answer 200 (got ' + r.status + ')');
    }

    it('01 - the in-root positive control renders (subtract control — proves the render path works)', function (t) {
        if (!ready(t)) { return; }
        var r = results.inroot;
        assert.equal(r.status, 200, 'in-root render: ' + (r.err || String(r.body).slice(0, 300)));
        assert.ok(String(r.body).indexOf(IN_ROOT_SENTINEL) > -1, 'the in-root template rendered');
    });

    it('02 - a known-absent template never leaks a marker (negative control)', function (t) {
        if (!ready(t)) { return; }
        assert.equal(String(results.knownNeg.body).indexOf(SHALLOW_SENTINEL) > -1, false);
        assert.equal(String(results.knownNeg.body).indexOf(DEEP_SENTINEL) > -1, false);
    });

    it('03 - QUERY traversal (raw, shallow) is blocked — no marker, not 200', function (t) {
        if (!ready(t)) { return; }
        blocked('qShallowRaw', SHALLOW_SENTINEL);
    });

    it('04 - QUERY traversal (%2F-encoded, shallow) is blocked', function (t) {
        if (!ready(t)) { return; }
        blocked('qShallowEnc', SHALLOW_SENTINEL);
    });

    it('05 - QUERY traversal (raw, deep — escapes the bundle src) is blocked', function (t) {
        if (!ready(t)) { return; }
        blocked('qDeepRaw', DEEP_SENTINEL);
    });

    it('06 - QUERY traversal (%2F-encoded, deep) is blocked', function (t) {
        if (!ready(t)) { return; }
        blocked('qDeepEnc', DEEP_SENTINEL);
    });

    it('07 - a QUERY value does NOT override a requirement-validated URL segment to traverse', function (t) {
        if (!ready(t)) { return; }
        // /b833strict/page passes the /^(page)$/ requirement, then ?name=..%2F..%2F.. must not override param.file
        blocked('override', SHALLOW_SENTINEL);
    });

    it('08 - the namespace branch (no render-swig guard) is blocked too — %2F and raw', function (t) {
        if (!ready(t)) { return; }
        blocked('nsEnc', SHALLOW_SENTINEL);
        blocked('nsRaw', SHALLOW_SENTINEL);
    });

    it('09 - the namespace branch still renders a legit in-root value (not over-blocked)', function (t) {
        if (!ready(t)) { return; }
        var r = results.nsInroot;
        assert.equal(r.status, 200, 'ns in-root render: ' + (r.err || String(r.body).slice(0, 300)));
        assert.ok(String(r.body).indexOf(IN_ROOT_SENTINEL) > -1, 'the namespace route rendered the in-root template');
    });
});
