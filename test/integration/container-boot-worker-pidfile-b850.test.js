/**
 * #B850 — a worker child loaded with `--argv-filename` leaves its parent bundle's
 * pid file alone, through a booted bundle.
 *
 * A worker is a child process whose entry is named `child.js` (or `child-*.js`): the
 * framework loads it as a worker and imports its parent's context from the file named
 * by `--argv-filename`. It registered under the parent bundle's name WITH a pid file,
 * so it wrote its own pid into `<bundle>@<project>.pid` and removed the file when it
 * exited: `bundle:stop` then signalled the worker, and `bundle:restart` exited 0 while
 * the old bundle kept serving. This file boots the REAL `bin/gina-container` against a
 * scaffolded project carrying two actions, `/spawn` (writes a context file the way a
 * worker's parent does and spawns `workers/w/child.js --argv-filename=<ctx>` with an
 * IPC channel) and `/pids` (reports the run directory, the bundle's pid and title), and
 * drives it over HTTP/1.1 on the default engine (isaac):
 *
 *   01  before any worker: the pid file names the bundle (control)
 *   02  while a worker runs: the pid file still names the bundle; the worker carries the
 *       bundle's title and is marked a minion
 *   03  after the worker exited: the pid file is still there, naming the bundle
 *   04  the bundle served every request and is still up
 *
 * Isolation: the container-boot-request-parsing.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (11850), project:rm + rmSync at teardown.
 * Seam: `B850_GINA_ROOT=<tree>` boots THAT tree's launcher against a project scaffolded
 * by THAT tree's CLI (red-first against another worktree, no shared-tree touch).
 *
 * Run standalone:
 *   node --test test/integration/container-boot-worker-pidfile-b850.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync, spawn } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b850-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'wrk' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11850;

var BOOT_TIMEOUT_MS  = 25000;
var POLL_INTERVAL_MS = 100;

var GINA_ROOT = process.env.B850_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;
var spawned = null, pidFileName = BUNDLE + '@' + PROJ + '.pid';


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

/** One GET; resolves with the status, the raw body and the parsed JSON. */
function get(reqPath) {
    return new Promise(function (resolve) {
        var req = http.request({ host: '127.0.0.1', port: bundlePort, path: webroot + reqPath, method: 'GET' }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () {
                var json = null;
                try { json = JSON.parse(data); } catch (e) { /* not JSON */ }
                resolve({ status: res.statusCode, body: data, json: json });
            });
        });
        req.setTimeout(8000, function () { req.destroy(new Error('no answer within 8 s')); });
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

/** The worker's own lines (one JSON object per line), parsed. */
function workerLines() {
    if (!spawned || !fs.existsSync(spawned.outPath)) { return []; }
    return fs.readFileSync(spawned.outPath, 'utf8').split('\n').filter(Boolean).map(function (l) {
        try { return JSON.parse(l); } catch (e) { return { raw: l }; }
    });
}

/** Polls the worker's lines until one satisfies `test`, or the deadline. */
async function waitWorker(test, ms) {
    var until = Date.now() + ms;
    while (Date.now() < until) {
        var hit = workerLines().filter(test)[0];
        if (hit) { return hit; }
        await sleep(POLL_INTERVAL_MS);
    }
    return null;
}

/** Adds the /spawn and /pids routes and actions, and the worker entry. */
function installFixture() {
    var rf = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'routing.json');
    var cf = path.join(PROJ_DIR, 'src', BUNDLE, 'controllers', 'controller.content.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };
    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    r.b850_spawn = { namespace: 'content', url: '/spawn', method: 'GET', param: { control: 'spawnWorker' } };
    r.b850_pids  = { namespace: 'content', url: '/pids',  method: 'GET', param: { control: 'pids' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));
    var wdir = path.join(PROJ_DIR, 'src', BUNDLE, 'workers', 'w');
    fs.mkdirSync(wdir, { recursive: true });
    // the worker: an entry named child.js, so the framework loads it as a worker
    fs.writeFileSync(path.join(wdir, 'child.js'), [
        "var fs = require('fs');",
        "require('gina');",
        "var out = process.env.B850_CHILD_OUT;",
        "fs.appendFileSync(out, JSON.stringify({ loaded: true, pid: process.pid, title: process.title, isMinion: process.isMinion === true }) + '\\n');",
        "setTimeout(function () { fs.appendFileSync(out, JSON.stringify({ exiting: true, pid: process.pid }) + '\\n'); process.exit(0); }, parseInt(process.env.B850_CHILD_TTL || '1500', 10));",
        ''
    ].join('\n'));
    var s = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    var action = [
        '    this.pids = function(req, res) {',
        "        var fs = require('fs'), p = require('path');",
        "        var rundir = getEnvVar('GINA_RUNDIR'), files = {};",
        "        try { fs.readdirSync(rundir).forEach(function (f) { try { files[f] = fs.readFileSync(p.join(rundir, f), 'utf8').trim(); } catch (e) { files[f] = 'ERR:' + e.code; } }); } catch (e) { files = 'ERR:' + e.code; }",
        "        self.renderJSON({ files: files, pid: process.pid, title: process.title });",
        '    };',
        '    this.spawnWorker = function(req, res) {',
        "        var fs = require('fs'), p = require('path'), spawn = require('child_process').spawn;",
        "        var configObj = getContext('gina').config, configExport = {};",
        "        for (var c in configObj) { if ( typeof(configObj[c]) != 'function' && typeof(configObj[c]) != 'object' || Array.isArray(configObj[c]) || /envConf/.test(c) ) { configExport[c] = configObj[c]; } }",
        "        var ctx = { project: configObj.project, bundle: configObj.bundle, bundles: configObj.bundles, env: configObj.env, envVars: getEnvVars(), config: configExport, paths: getPaths(), locales: getContext('gina').locales, processList: process.list, process: getContext('gina').process, portsReverse: getContext('gina').portsReverse };",
        "        var wdir = p.resolve(__dirname, '../workers/w'), ctxPath = p.join(wdir, 'b850.' + Date.now() + '.ctx'), outPath = p.join(wdir, 'child.out');",
        "        fs.writeFileSync(ctxPath, JSON.stringify(ctx));",
        "        var out = fs.openSync(outPath, 'a');",
        "        var minion = spawn(process.execPath, [p.join(wdir, 'child.js'), '--argv-filename=' + ctxPath], { env: Object.assign({}, process.env, { B850_CHILD_OUT: outPath, B850_CHILD_TTL: '1500' }), stdio: ['ignore', out, out, 'ipc'] });",
        "        minion.on('exit', function (code, signal) { fs.appendFileSync(outPath, JSON.stringify({ parentSawExit: true, code: code, signal: signal }) + '\\n'); });",
        "        self.renderJSON({ childPid: minion.pid, outPath: outPath });",
        '    };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, action + anchor));
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('39 - container-boot-worker-pidfile-b850 — a worker child leaves its bundle\'s pid file alone (#B850)', function () {

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

        try { installFixture(); } catch (e) { setupError = 'fixture install failed: ' + (e.message || e); return; }

        var pe = readJSON(projectsPath)[PROJ], env = pe.def_env || 'dev', proto = pe.def_protocol;
        var scheme = pe.def_scheme || 'http';
        if (scheme !== 'http') { setupError = 'the scaffold is ' + scheme + ', this file speaks http'; return; }
        try { bundlePort = readJSON(portsReversePath)[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        // ONE boot for every arm
        child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', function (d) { childOut += d; });
        child.stderr.on('data', function (d) { childOut += d; });
        child.on('exit', function (code, signal) { childExit = { code: code, signal: signal }; });
        var deadline = Date.now() + BOOT_TIMEOUT_MS, up = false;
        while (Date.now() < deadline && !childExit) {
            if (await isTcpPortOpen(bundlePort)) { up = true; break; }
            await sleep(250);
        }
        if (!up) { setupError = 'the bundle did not come up: exit ' + JSON.stringify(childExit) + '\n' + childOut.slice(-2000); return; }
        await sleep(300);
    });

    after(async function () {
        if (spawned && spawned.childPid) { try { process.kill(spawned.childPid, 'SIGKILL'); } catch (e) { /* gone */ } }
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

    var bundlePid = null;

    it('01.1  CONTROL — before any worker, the pid file names the bundle', async function (t) {
        if (!ready(t)) return;
        var r = await get('pids');
        assert.equal(r.status, 200, r.body.slice(0, 300));
        bundlePid = r.json.pid;
        assert.equal(r.json.files[pidFileName], String(bundlePid), JSON.stringify(r.json.files));
        assert.equal(r.json.title, 'gina: ' + BUNDLE + '@' + PROJ);
    });

    it('02.1  while a worker runs, the pid file still names the bundle (was: the worker)', async function (t) {
        if (!ready(t)) return;
        var s = await get('spawn');
        assert.equal(s.status, 200, s.body.slice(0, 300));
        spawned = s.json;
        var loaded = await waitWorker(function (l) { return l.loaded; }, 15000);
        assert.ok(loaded, 'the worker loaded the framework:\n' + JSON.stringify(workerLines()));
        assert.equal(loaded.pid, spawned.childPid);
        var r = await get('pids');
        assert.equal(r.json.files[pidFileName], String(bundlePid), 'the pid file must keep the bundle\'s pid while worker ' + spawned.childPid + ' runs: ' + JSON.stringify(r.json.files));
    });

    it('02.2  the worker carries the bundle\'s title (unchanged) and is marked a minion', async function (t) {
        if (!ready(t)) return;
        var loaded = await waitWorker(function (l) { return l.loaded; }, 1000);
        assert.ok(loaded, 'no loaded line');
        assert.equal(loaded.title, 'gina: ' + BUNDLE + '@' + PROJ, 'CONTROL — the worker\'s title is unchanged');
        assert.equal(loaded.isMinion, true, 'process.isMinion must be true in a worker');
    });

    it('03.1  after the worker exited, the pid file is still there, naming the bundle (was: removed)', async function (t) {
        if (!ready(t)) return;
        var exited = await waitWorker(function (l) { return l.parentSawExit; }, 15000);
        assert.ok(exited, 'the worker did not exit:\n' + JSON.stringify(workerLines()));
        assert.equal(exited.code, 0, 'the worker exits 0: ' + JSON.stringify(exited));
        await sleep(200);
        var r = await get('pids');
        assert.equal(r.status, 200);
        assert.equal(r.json.files[pidFileName], String(bundlePid), 'the pid file must survive the worker\'s exit: ' + JSON.stringify(r.json.files));
    });

    it('04.1  the bundle served every request and is still up', async function (t) {
        if (!ready(t)) return;
        var r = await get('pids');
        assert.equal(r.status, 200);
        assert.equal(r.json.pid, bundlePid);
        assert.ok(isChildAlive(), 'the bundle process is still running');
    });
});
