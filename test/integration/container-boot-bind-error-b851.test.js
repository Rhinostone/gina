/**
 * #B851 — a bundle that cannot bind its port ends its boot with exit 1, through a booted
 * bundle.
 *
 * `listen()` reports a failed bind on a later tick, through the server's `'error'` event. The
 * isaac engine only logged it and the boot went on: the readiness flag `Bundle started !` was
 * printed on its 700 ms timer and, with nothing listening, the process then exited 0, so
 * `bundle:start` (through the daemon) and `gina-container` took a bundle that never listened
 * for a started one. core/server.js now ends the boot on a bind error (an emerg line, then
 * `[ FRAMEWORK ] abort: could not listen on port <port>: <code> (…)` on stderr, exit 1), and
 * core/gna.js prints the flag only once the server listens. This file boots the REAL
 * `bin/gina-container` (it exits with the bundle's code) against a scaffolded project, on the
 * default engine (isaac):
 *
 *   01  another program holds the bundle's port: the boot ends with exit 1, the abort line
 *       names the port and EADDRINUSE, and no readiness flag is printed
 *   02  CONTROL — the port is free: the bundle answers, the flag is printed, SIGTERM ends it
 *       with 143
 *
 * Red-first: 01.1–01.3 fail on the pre-fix tree (the boot exits 0 after printing the flag);
 * 02.1–02.3 pass on both.
 *
 * Isolation: the container-boot-worker-pidfile-b850.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (11900), project:rm + rmSync at teardown.
 * Seam: `B851_GINA_ROOT=<tree>` boots THAT tree's launcher against a project scaffolded by
 * THAT tree's CLI (red-first against another worktree, no shared-tree touch).
 *
 * Run standalone:
 *   node --test test/integration/container-boot-bind-error-b851.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b851-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'bnd' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11900;

var BOOT_TIMEOUT_MS  = 25000;
var EXIT_TIMEOUT_MS  = 20000;

var GINA_ROOT = process.env.B851_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var FLAG_RE = /Bundle started !/;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var holder = null;
var boots = [];


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

/** One GET on the bundle's webroot; resolves with the status (null when nothing answered). */
function get() {
    return new Promise(function (resolve) {
        var req = http.request({ host: '127.0.0.1', port: bundlePort, path: webroot, method: 'GET' }, function (res) {
            res.resume();
            res.on('end', function () { resolve({ status: res.statusCode }); });
        });
        req.setTimeout(8000, function () { req.destroy(new Error('no answer within 8 s')); });
        req.on('error', function (e) { resolve({ status: null, err: e.message }); });
        req.end();
    });
}

function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/**
 * Boots the bundle through `bin/gina-container` and records its output and its exit.
 *
 * @returns {{child: object, out: function(): string, exit: function(): ?object, alive: function(): boolean}}
 */
function boot() {
    var rec = { text: '', exit: null };
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', function (d) { rec.text += d; });
    child.stderr.on('data', function (d) { rec.text += d; });
    child.on('exit', function (code, signal) { rec.exit = { code: code, signal: signal }; });
    var b = {
        child : child,
        out   : function () { return rec.text; },
        exit  : function () { return rec.exit; },
        alive : function () { return rec.exit === null; }
    };
    boots.push(b);
    return b;
}

/** Resolves once the boot has exited, or after `ms`; returns its exit record (null: still running). */
async function waitExit(b, ms) {
    var until = Date.now() + ms;
    while (Date.now() < until && b.alive()) { await sleep(100); }
    return b.exit();
}

/** Resolves once `re` appears in the boot's output, or after `ms`. */
async function waitOutput(b, re, ms) {
    var until = Date.now() + ms;
    while (Date.now() < until && !re.test(b.out())) { await sleep(100); }
    return re.test(b.out());
}

async function stop(b) {
    if (!b || !b.alive()) return;
    try { b.child.kill('SIGTERM'); } catch (e) { /* ignore */ }
    var until = Date.now() + 5000;
    while (Date.now() < until && b.alive()) { await sleep(150); }
    if (b.alive()) { try { b.child.kill('SIGKILL'); } catch (e) { /* ignore */ } }
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('41 - container-boot-bind-error-b851 — a bundle that cannot bind its port exits 1 (#B851)', function () {

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
        var scheme = pe.def_scheme || 'http';
        if (scheme !== 'http') { setupError = 'the scaffold is ' + scheme + ', this file speaks http'; return; }
        try { bundlePort = readJSON(portsReversePath)[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        if (await isTcpPortOpen(bundlePort)) { setupError = 'port ' + bundlePort + ' is already in use before the test'; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }
    });

    after(async function () {
        for (var i = 0; i < boots.length; i++) { await stop(boots[i]); }
        if (holder) { try { holder.close(); } catch (e) { /* ignore */ } }
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    function ready(t) {
        if (skip) { t.skip(skipReason); return false; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        return true;
    }

    var held = null;

    it('01.1  another program holds the port: the boot ends with exit 1 (was: 0, after the flag)', { timeout: EXIT_TIMEOUT_MS + 10000 }, async function (t) {
        if (!ready(t)) return;
        // the holder binds the way node binds by default (every interface), as the bundle does
        holder = http.createServer(function (q, s) { s.end('holder'); });
        await new Promise(function (resolve, reject) { holder.once('error', reject); holder.listen(bundlePort, resolve); });
        held = boot();
        var exit = await waitExit(held, EXIT_TIMEOUT_MS);
        assert.ok(exit, 'the boot is still running ' + EXIT_TIMEOUT_MS + ' ms after it started:\n' + held.out().slice(-2000));
        assert.equal(exit.code, 1, 'exit ' + JSON.stringify(exit) + '\n' + held.out().slice(-2000));
    });

    it('01.2  the abort line names the port and EADDRINUSE', async function (t) {
        if (!ready(t)) return;
        assert.ok(held, 'no boot from 01.1');
        assert.match(held.out(), new RegExp('\\[ FRAMEWORK \\] abort: could not listen on port ' + bundlePort + ': EADDRINUSE'), held.out().slice(-2000));
    });

    it('01.3  no readiness flag is printed for a bundle that does not listen', async function (t) {
        if (!ready(t)) return;
        assert.ok(held, 'no boot from 01.1');
        assert.doesNotMatch(held.out(), FLAG_RE, held.out().slice(-2000));
    });

    it('01.4  CONTROL — the holder still has the port', async function (t) {
        if (!ready(t)) return;
        assert.ok(holder && holder.listening, 'the holder is listening');
        assert.ok(await isTcpPortOpen(bundlePort));
    });

    var free = null;

    it('02.1  CONTROL — the port is free: the bundle comes up and answers', { timeout: BOOT_TIMEOUT_MS + 15000 }, async function (t) {
        if (!ready(t)) return;
        await new Promise(function (resolve) { holder.close(function () { resolve(); }); });
        holder = null;
        free = boot();
        var deadline = Date.now() + BOOT_TIMEOUT_MS, up = false;
        while (Date.now() < deadline && free.alive()) {
            if (await isTcpPortOpen(bundlePort)) { up = true; break; }
            await sleep(250);
        }
        assert.ok(up, 'the bundle did not come up: exit ' + JSON.stringify(free.exit()) + '\n' + free.out().slice(-2000));
        var r = await get();
        assert.ok(r.status !== null, 'the bundle answered: ' + JSON.stringify(r));
    });

    it('02.2  CONTROL — the readiness flag is printed once the bundle listens', async function (t) {
        if (!ready(t)) return;
        assert.ok(free, 'no boot from 02.1');
        assert.ok(await waitOutput(free, FLAG_RE, 5000), 'no flag within 5 s of the bundle listening:\n' + free.out().slice(-2000));
        assert.doesNotMatch(free.out(), /abort: could not listen/);
    });

    it('02.3  CONTROL — SIGTERM ends the bundle with 143', async function (t) {
        if (!ready(t)) return;
        assert.ok(free && free.alive(), 'the bundle is running');
        free.child.kill('SIGTERM');
        var exit = await waitExit(free, 15000);
        assert.ok(exit, 'the bundle did not exit after SIGTERM');
        assert.equal(exit.code, 143, JSON.stringify(exit));
    });
});
