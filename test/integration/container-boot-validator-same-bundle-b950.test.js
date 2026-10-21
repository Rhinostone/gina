/**
 * #B950 — a validator `query` rule aimed at its own bundle, in a bundle started by
 * `bin/gina-container`, with no `proxy` entry for that bundle in app.json.
 *
 * `queryFromBackend` (core/plugins/lib/validator/src/form-validator.js) looks the target bundle
 * up in app.json's `proxy` block unless the target is the bundle it runs in, and it decided that
 * by comparing the target with the Config instance's `bundle`. Inside a gina-container bundle
 * that `bundle` is undefined (measured: `getContext('bundle')` names the bundle), so a rule
 * aimed at its own bundle took the proxy lookup and the route answered 500 « Could not retrieve
 * `proxy` configuration for bundle `<b>` ». The fix also accepts the bundle in context.
 *
 *   01  controls that hold on both sides of the fix: the echo action answers a direct request,
 *       and a route whose requirement holds no `query` rule answers 200
 *   02  #B950: the route whose requirement is a same-bundle `query` rule answers 200, and the
 *       rule's data reaches the echo action
 *
 * Every request carries a client timeout, so a pre-fix run FAILS instead of hanging the suite.
 *
 * Isolation: the container-boot-query-data-b945.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (13100), project:rm + rmSync at teardown. Seam:
 * `B950_GINA_ROOT=<tree>` boots THAT tree's launcher against a project scaffolded by THAT tree's
 * CLI (red-first against a pre-fix tree, zero shared-tree touch). The scene's app.json carries no
 * `proxy` entry for the bundle: that is the condition under test.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-validator-same-bundle-b950.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var https  = require('https');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync, spawn } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b950-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'uc' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 13100;

var BOOT_TIMEOUT_MS    = 25000;
var POLL_INTERVAL_MS   = 250;
var REQUEST_TIMEOUT_MS = 5000;

var GINA_ROOT = process.env.B950_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, scheme = 'http', webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * One GET with a client timeout: an unanswered request resolves with
 * `{ status: null, err: 'timeout' }` instead of waiting forever.
 *
 * @inner
 * @param {string} reqPath - path including the webroot
 * @returns {Promise<object>} `{ status, body, json }` or `{ status: null, err }`
 */
function get(reqPath) {
    var lib = (scheme === 'https') ? https : http;
    return new Promise(function (resolve) {
        var req = lib.request({
            host: '127.0.0.1', port: bundlePort, path: reqPath, method: 'GET', rejectUnauthorized: false
        }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () {
                var json = null;
                try { json = JSON.parse(data); } catch (e) { /* not JSON */ }
                resolve({ status: res.statusCode, body: data, json: json });
            });
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, function () { req.destroy(new Error('timeout')); });
        req.on('error', function (e) { resolve({ status: null, err: e.message, body: '', json: null }); });
        req.end();
    });
}

function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function isChildAlive() { return child && child.exitCode === null && child.signalCode === null; }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** Adds the rules and the actions this file drives; app.json keeps no `proxy` entry. */
function installScene() {
    var rf = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'routing.json');
    var cf = path.join(PROJ_DIR, 'src', BUNDLE, 'controllers', 'controller.content.js');
    var af = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'app.json');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };
    var app = JSON.parse(strip(fs.readFileSync(af, 'utf8')));
    if (app.proxy && app.proxy[BUNDLE]) { throw new Error('the scaffold already gives the bundle a proxy entry: the scene would not test #B950'); }
    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    var B = '@' + BUNDLE;
    r.b950_echo  = { namespace: 'content', url: '/echo', method: 'GET', param: { control: 'b950Echo' } };
    r.b950_last  = { namespace: 'content', url: '/last', method: 'GET', param: { control: 'b950Last' } };
    r.b950_plain = { namespace: 'content', url: '/plain/:name', method: 'GET',
                     requirements: { name: '/^[a-z]+$/i' },
                     param: { control: 'b950Ok', name: ':name' } };
    r.b950_vq    = { namespace: 'content', url: '/vq/:name', method: 'GET',
                     requirements: { name: '/^[a-z]+$/i', check: 'validator::{ query: { validIf: "$isValid == true", url: "b950_echo' + B + '", method: "GET", data: { name: ":name" } } }' },
                     param: { control: 'b950Ok', name: ':name' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));
    var s = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    var actions = [
        '    this.b950Echo = function(req, res) {',
        '        global.__b950 = global.__b950 || []; global.__b950.push({ originalUrl: req.originalUrl, get: req.get || null });',
        '        self.renderJSON({ isValid: true });',
        '    };',
        '    this.b950Last = function(req, res) { self.renderJSON({ seen: global.__b950 || [] }); };',
        '    this.b950Ok = function(req, res) { self.renderJSON({ ok: true }); };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, actions + anchor));
}


// ---------------------------------------------------------------------------
// 01 – 02 — boot arms
// ---------------------------------------------------------------------------

describe('container-boot-validator-same-bundle — a query rule aimed at its own bundle, no proxy entry (#B950)', function () {

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

        // the project must load the tree under test (the #B422 Franken-boot trap)
        try {
            var target = fs.realpathSync(path.join(PROJ_DIR, 'node_modules', 'gina'));
            if (target !== fs.realpathSync(GINA_ROOT)) { setupError = 'node_modules/gina resolves to ' + target + ', not ' + GINA_ROOT; return; }
        } catch (e) { setupError = 'node_modules/gina is not linked: ' + (e.message || e); return; }

        var pe = readJSON(projectsPath)[PROJ], env = pe.def_env || 'dev', proto = pe.def_protocol;
        scheme = pe.def_scheme || 'http';
        try { bundlePort = readJSON(portsReversePath)[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        try { installScene(); } catch (e) { setupError = 'scene install failed: ' + (e.message || e); return; }

        // ONE boot for every arm
        child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', function (d) { childOut += d; });
        child.stderr.on('data', function (d) { childOut += d; });
        child.on('exit', function (code, signal) { childExit = { code: code, signal: signal }; });
        var deadline = Date.now() + BOOT_TIMEOUT_MS, up = false;
        while (Date.now() < deadline && !childExit) {
            if (await isTcpPortOpen(bundlePort)) { up = true; break; }
            await sleep(POLL_INTERVAL_MS);
        }
        if (!up) { setupError = 'the bundle did not come up: exit ' + JSON.stringify(childExit) + '\n' + childOut.slice(-2000); return; }
        await sleep(300);
    });

    after(async function () {
        if (isChildAlive()) {
            try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
            var until = Date.now() + 4000;
            while (Date.now() < until && isChildAlive()) { await sleep(150); }
            if (isChildAlive()) { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }
        }
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    function ready(t) {
        if (skip) { t.skip(skipReason); return false; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        return true;
    }

    it('01.1  CONTROL — the echo action answers a direct request', async function (t) {
        if (!ready(t)) return;
        var r = await get(webroot + 'echo?name=direct');
        assert.equal(r.status, 200, 'the echo action did not answer: ' + (r.err || r.body.slice(0, 300)));
    });

    it('01.2  CONTROL — a route whose requirement holds no query rule answers 200', async function (t) {
        if (!ready(t)) return;
        var r = await get(webroot + 'plain/foo');
        assert.equal(r.status, 200, 'the plain route did not answer 200: ' + (r.err || r.body.slice(0, 300)));
    });

    it('02.1  #B950 — a same-bundle query rule answers 200 without a proxy entry', async function (t) {
        if (!ready(t)) return;
        var r = await get(webroot + 'vq/foo');
        assert.equal(r.status, 200, 'the same-bundle query rule route did not answer 200: ' + (r.err || r.body.slice(0, 300)));
        assert.equal(r.json && r.json.ok, true, 'the route\'s own action did not answer: ' + r.body.slice(0, 300));
    });

    it('02.2  #B950 — the rule\'s data reaches the echo action of the same bundle', async function (t) {
        if (!ready(t)) return;
        var r = await get(webroot + 'vq/bar');
        assert.equal(r.status, 200, 'the same-bundle query rule route did not answer 200: ' + (r.err || r.body.slice(0, 300)));
        var last = await get(webroot + 'last');
        var seen = (last.json && last.json.seen) || [];
        var hit = seen.filter(function (e) { return e.get && e.get.name === 'bar'; });
        assert.equal(hit.length, 1, 'the echo action did not receive the rule\'s data once: ' + JSON.stringify(seen).slice(0, 400));
    });
});
