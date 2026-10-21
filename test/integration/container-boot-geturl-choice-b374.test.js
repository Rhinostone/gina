/**
 * #B374 / #B220 / #B943 / #B946 — the url `getRoute()` composes, in a booted bundle.
 *
 * test/lib/routing-getroute-url-choice-b374.test.js drives the real lib/routing against a routing
 * table written in the shape core/config.js hands it. This file closes the remaining gap: a real
 * bundle, whose routing.json writes a rule's urls the way projects do (`"/m/:id, /m/:id/:mode"`,
 * a space after the comma), loaded by the real config (whitespace stripped, webroot prefixed to
 * each url), with `getRoute()` called from a controller action. The urls composed are then
 * requested, to show that each one routes and carries its values.
 *
 *   01  boot arms over HTTP/1.1 on the default engine:
 *       - controls that hold on both sides of the fix: the compose action answers, a value for
 *         every placeholder of the first url composes the first url, and the url composed for
 *         the first url routes
 *       - the defect: the url chosen without urlIndex (#B374), the caller's urlIndex (#B374),
 *         a value bound to the other url (#B220), a rule without values (#B374), a path value
 *         not repeated in the query (#B943), a comma inside a value (#B946), an index that names
 *         no url (#B374), and the url chosen routing with its values
 *
 * Every request carries a client timeout, so a pre-fix run FAILS instead of hanging the suite.
 *
 * Isolation: the container-boot-throwerror-fallback-b783.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (12950), project:rm + rmSync at teardown. Seam:
 * `B374_GINA_ROOT=<tree>` boots THAT tree's launcher against a project scaffolded by THAT tree's
 * CLI (red-first against a pre-fix tree, zero shared-tree touch).
 *
 * Run standalone:
 *   node --test test/integration/container-boot-geturl-choice-b374.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b374-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'uc' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 12950;

var BOOT_TIMEOUT_MS    = 25000;
var POLL_INTERVAL_MS   = 250;
var REQUEST_TIMEOUT_MS = 5000;

var GINA_ROOT = process.env.B374_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, scheme = 'http', webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;
var composed = null;


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

/** Adds the rules and the actions this file drives to the scaffold. */
function installRoutes() {
    var rf = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'routing.json');
    var cf = path.join(PROJ_DIR, 'src', BUNDLE, 'controllers', 'controller.content.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };
    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    // the urls are written the way projects write them: a space after each comma
    r.b374_multi   = { namespace: 'content', url: '/m/:id, /m/:id/:mode', method: 'GET',
                       requirements: { id: '/^\\d+$/', mode: '/^(alpha|beta)$/' },
                       param: { control: 'b374Echo', id: ':id', mode: ':mode' } };
    r.b374_lo      = { namespace: 'content', url: '/lo/:timestamp, /lo', method: 'GET',
                       requirements: { timestamp: '/^\\d+$/' },
                       param: { control: 'b374Echo', timestamp: ':timestamp' } };
    r.b374_inv     = { namespace: 'content', url: '/inv/:id', method: 'GET',
                       param: { control: 'b374Echo', id: ':id' } };
    r.b374_one     = { namespace: 'content', url: '/one/:x', method: 'GET',
                       requirements: { x: '/^[a-z,]+$/' },
                       param: { control: 'b374Echo', x: ':x' } };
    r.b374_compose = { namespace: 'content', url: '/compose', method: 'GET', param: { control: 'b374Compose' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));
    var s = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    var actions = [
        '    this.b374Echo = function(req, res) { self.renderJSON({ rule: req.routing.rule, params: req.params, get: req.get }); };',
        '    this.b374Compose = function(req, res) {',
        '        var r = require("gina").lib.routing, B = "@' + BUNDLE + '", out = {};',
        '        var c = function (k, f) { try { var u = f(); out[k] = (typeof(u) == "string") ? u : "NOT A STRING: " + String(u); } catch (e) { out[k] = "THROW " + e.message; } };',
        '        c("multiAuto", function () { return r.getRoute("b374_multi" + B, { id: "42", mode: "beta" }).url; });',
        '        c("multiIdx0", function () { return r.getRoute("b374_multi" + B, { id: "42", mode: "beta" }, 0).url; });',
        '        c("multiIdx1", function () { return r.getRoute("b374_multi" + B, { id: "42", mode: "beta" }, 1).url; });',
        '        c("multiFirst", function () { return r.getRoute("b374_multi" + B, { id: "42" }).url; });',
        '        c("loNone", function () { return r.getRoute("b374_lo" + B).url; });',
        '        c("loTs", function () { return r.getRoute("b374_lo" + B, { timestamp: "9" }).url; });',
        '        c("inv", function () { return r.getRoute("b374_inv" + B, { id: "abc-123" }).url; });',
        '        c("one", function () { return r.getRoute("b374_one" + B, { x: "a,b" }).url; });',
        '        c("bad", function () { return r.getRoute("b374_multi" + B, {}, 5).url; });',
        '        self.renderJSON(out);',
        '    };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, actions + anchor));
}


// ---------------------------------------------------------------------------
// 01 — boot arms
// ---------------------------------------------------------------------------

describe('01 - container-boot-geturl-choice — the url getRoute() composes in a booted bundle (#B374)', function () {

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

        try { installRoutes(); } catch (e) { setupError = 'route install failed: ' + (e.message || e); return; }

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

    /** The compositions, read once from the compose action. */
    async function compositions() {
        if (composed) { return composed; }
        var r = await get(webroot + 'compose');
        assert.equal(r.status, 200, 'the compose action did not answer: ' + (r.err || r.body.slice(0, 300)));
        assert.ok(r.json && typeof(r.json) == 'object', 'the compose action did not answer JSON: ' + r.body.slice(0, 300));
        composed = r.json;
        return composed;
    }

    // ── controls: hold on both sides of the fix ─────────────────────────────

    it('01.1  CONTROL — the compose action answers', async function (t) {
        if (!ready(t)) return;
        await compositions();
    });

    it('01.2  CONTROL — a value for every placeholder of the first url composes the first url, webroot prefixed', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.equal(c.loTs, webroot + 'lo/9');
        assert.equal(c.multiFirst, webroot + 'm/42');
    });

    it('01.3  CONTROL — the url composed for the first url routes, with its value', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        var r = await get(c.loTs);
        assert.equal(r.status, 200, c.loTs + ' did not answer: ' + (r.err || r.body.slice(0, 200)));
        assert.equal(r.json && r.json.params && r.json.params.timestamp, '9', c.loTs + ' did not carry timestamp: ' + r.body.slice(0, 200));
    });

    // ── the defect ──────────────────────────────────────────────────────────

    it('01.4  #B374 — without urlIndex, the url whose placeholders all receive a value', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.equal(c.multiAuto, webroot + 'm/42/beta');
    });

    it('01.5  #B374 — the caller\'s urlIndex wins, although a placeholder was filled', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.equal(c.multiIdx1, webroot + 'm/42/beta');
    });

    it('01.6  #B220 — the first url named: the value bound to the second goes to the query', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.equal(c.multiIdx0, webroot + 'm/42?mode=beta');
    });

    it('01.7  #B374 — a rule without values composes its url that has no placeholder', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.equal(c.loNone, webroot + 'lo');
    });

    it('01.8  #B943 — a path value is not repeated in the query', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.equal(c.inv, webroot + 'inv/abc-123');
    });

    it('01.9  #B946 — a comma inside a value stays in the url', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.equal(c.one, webroot + 'one/a,b');
    });

    it('01.10 #B374 — an index that names no url throws a named error', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        assert.ok(typeof(c.bad) == 'string' && c.bad.indexOf('THROW ') === 0
            && c.bad.indexOf('names no url of rule `b374_multi@' + BUNDLE + '`, which has 2 urls') > -1,
            'urlIndex 5 did not throw the named error: ' + JSON.stringify(c.bad));
    });

    it('01.11 #B374 — the urls composed route, with their values (path and query alike)', async function (t) {
        if (!ready(t)) return;
        var c = await compositions();
        var auto = await get(c.multiAuto);
        assert.equal(auto.status, 200, c.multiAuto + ' did not answer: ' + (auto.err || auto.body.slice(0, 200)));
        assert.equal(auto.json && auto.json.params && auto.json.params.mode, 'beta', c.multiAuto + ' did not carry mode in the path: ' + auto.body.slice(0, 200));
        var first = await get(c.multiIdx0);
        assert.equal(first.status, 200, c.multiIdx0 + ' did not answer: ' + (first.err || first.body.slice(0, 200)));
        assert.equal(first.json && first.json.get && first.json.get.mode, 'beta', c.multiIdx0 + ' did not carry mode in the query: ' + first.body.slice(0, 200));
        var none = await get(c.loNone);
        assert.equal(none.status, 200, c.loNone + ' did not answer: ' + (none.err || none.body.slice(0, 200)));
    });
});
