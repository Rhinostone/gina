/**
 * #B905 — when the project's node_modules cannot be linked, `bundle:start` exits 1 and says why,
 * instead of reporting success.
 *
 * With gina installed globally, `bundle:start` (and the other start, stop and restart commands)
 * first runs `gina framework:link-node-modules @<project>`, then `gina framework:link
 * @<project>`, as children (lib/cmd/helper.js loadAssets()). A gina CLI command writes its errors
 * on stdout, through gina's logger; the caller built its message from the child's stderr alone,
 * an empty Buffer, so the message was '' and `exit('')` framed exit code 0. Measured on develop
 * cd213edda: with the project's homedir unable to hold `lib/node_modules`, the child exited 1
 * with « Cannot complete symlinkSync … the path does not exist » on stdout and nothing on stderr,
 * and `bundle:start` exited 0 with nothing started; the daemon logged an empty `[error]` line.
 * The message is now built by lib/cmd/framework/inc/child-failure.js (unit-tested in
 * test/lib/child-failure-b905.test.js), never empty. This file drives it through its own daemon:
 *
 *   01  the link-node-modules child fails (the project's node_modules moved aside and the
 *       project homedir's `lib` replaced by a file, so `lib/node_modules` cannot be created, by
 *       root either): exit 1, the message names the child command and its exit code and carries
 *       the child's reason, nothing is started, and the daemon still runs
 *   02  the files restored: exit 0 and the bundle listens (the control)
 *
 * Red-first: see the commit that adds this file.
 *
 * Isolation, as in daemon-bundle-start-unusable-file-b890.test.js: a throwaway HOME under
 * os.tmpdir(), whose prefix holds `lib/node_modules/gina`, a link to the tree under test; every
 * command runs through that link with HOME, GINA_PREFIX, GINA_RUNDIR, GINA_LOGDIR, GINA_TMPDIR,
 * GINA_PORT, GINA_MQ_PORT and GINA_DEBUG_PORT pinned, no other GINA_* variable and no npm prefix.
 * Before any command can reach a daemon, settings.json is checked to carry the private port and
 * the temp run dir. The daemon is this file's own child (`node <install>/bin/cli start`), on
 * ports no other test uses: 12050 (daemon), 12051 (MQ), 12052 (debug), bundles from 12055; the
 * file skips when one of them is busy. Teardown kills every process titled
 * `gina: <bundle>@<project>` (and the one the bundle's pid file names) and the daemon, never
 * through `gina stop`, which SIGKILLs every `gina-v<version>` process on the machine.
 * Seam: `B905_GINA_ROOT=<tree>` links THAT tree into the prefix (the red-first run against a copy
 * of the tree before the fix).
 *
 * Run standalone:
 *   node --test test/integration/daemon-bundle-start-link-failure-b905.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawn, execFileSync } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP        = Date.now();
var FAKE_HOME    = path.join(os.tmpdir(), 'gina-b905d-home-' + STAMP);
var GINA_HOME    = path.join(FAKE_HOME, '.gina');
var PREFIX       = path.join(FAKE_HOME, 'prefix');
var RUN_DIR      = path.join(FAKE_HOME, 'run');
var LOG_DIR      = path.join(FAKE_HOME, 'log');
var TMP_DIR      = path.join(FAKE_HOME, 'tmp');
var PROJ         = 'dmn' + STAMP;
var BUNDLE       = 'web';
var PROJ_DIR     = path.join(FAKE_HOME, 'proj');

var DAEMON_PORT  = 12050;
var MQ_PORT      = 12051;
var DEBUG_PORT   = 12052;
var PORT_START   = 12055;

var GINA_ROOT    = process.env.B905_GINA_ROOT || path.resolve(__dirname, '../..');
// the commands run through the prefix, the path a global install gives them
var INSTALL      = path.join(PREFIX, 'lib', 'node_modules', 'gina');
var GINA         = path.join(INSTALL, 'bin', 'gina');
var CLI          = path.join(INSTALL, 'bin', 'cli');

var CMD_TIMEOUT_MS    = 60000;
var DAEMON_TIMEOUT_MS = 30000;

var CHILD_ENV = {};
Object.keys(process.env).forEach(function (k) {
    if ( /^GINA_/.test(k) || /^npm_config_prefix$/i.test(k) ) return;
    CHILD_ENV[k] = process.env[k];
});
Object.assign(CHILD_ENV, {
    HOME            : FAKE_HOME,
    GINA_PREFIX     : PREFIX,
    GINA_RUNDIR     : RUN_DIR,
    GINA_LOGDIR     : LOG_DIR,
    GINA_TMPDIR     : TMP_DIR,
    GINA_PORT       : String(DAEMON_PORT),
    GINA_MQ_PORT    : String(MQ_PORT),
    GINA_DEBUG_PORT : String(DEBUG_PORT)
});

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, projectHomedir = null;
var daemon = null, daemonOut = '', daemonExit = null;


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
/** Removes the terminal colour codes the CLI prints. */
function plain(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }
function tail(s, n) { s = String(s || ''); return s.slice(-(n || 1500)); }

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

/** Whether a server could bind `port` on every interface, as a bundle does. */
function isPortFree(port) {
    return new Promise(function (resolve) {
        var srv = net.createServer();
        srv.once('error', function () { resolve(false); });
        srv.listen(port, function () { srv.close(function () { resolve(true); }); });
    });
}

async function waitFor(check, ms, step) {
    var until = Date.now() + ms;
    while (Date.now() < until) {
        if (await check()) return true;
        await sleep(step || 200);
    }
    return !!(await check());
}

function isAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** The pid the bundle's pid file names when that process runs, or null. */
function pidFromFile() {
    try {
        var pid = parseInt(fs.readFileSync(path.join(RUN_DIR, BUNDLE + '@' + PROJ + '.pid'), 'utf8').trim(), 10);
        return (!isNaN(pid) && isAlive(pid)) ? pid : null;
    } catch (e) {
        return null;
    }
}

/**
 * The pids of every process titled `gina: <bundle>@<this project>`, and the one the bundle's pid
 * file names (Bun does not show process.title to `ps`).
 */
function bundlePids() {
    var out = '', pids = [];
    try { out = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' }); } catch (e) { out = ''; }
    var re = new RegExp('^\\s*(\\d+)\\s+gina: [a-z0-9_-]+@' + PROJ + '(\\s|$)');
    out.split('\n').forEach(function (line) { var m = line.match(re); if (m) pids.push(parseInt(m[1], 10)); });
    var filePid = pidFromFile();
    if (filePid && pids.indexOf(filePid) < 0) pids.push(filePid);
    return pids;
}

async function kill(pid) {
    if (!isAlive(pid)) return;
    try { process.kill(pid, 'SIGTERM'); } catch (e) { /* gone */ }
    if (await waitFor(function () { return !isAlive(pid); }, 4000, 100)) return;
    try { process.kill(pid, 'SIGKILL'); } catch (e) { /* gone */ }
    await waitFor(function () { return !isAlive(pid); }, 3000, 100);
}

/** Stops every bundle of the project and waits for the bundle's port. */
async function stopBundles() {
    var pids = bundlePids();
    for (var i = 0; i < pids.length; i++) { await kill(pids[i]); }
    return waitFor(function () { return isPortFree(bundlePort); }, 10000);
}

/**
 * Starts this file's daemon (`node <install>/bin/cli start`, a child of this process) and waits
 * for its port.
 *
 * @returns {Promise<boolean>} true once the daemon listens
 */
async function startDaemon() {
    var child = spawn(process.execPath, [CLI, 'start'], { cwd: FAKE_HOME, env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    daemon = child;
    daemonExit = null;
    var keep = function (d) { daemonOut += d; if (daemonOut.length > 400000) daemonOut = daemonOut.slice(-200000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('exit', function (code, signal) { if (daemon === child) daemonExit = { code: code, signal: signal }; });
    return waitFor(async function () { return daemonExit === null && await isTcpPortOpen(DAEMON_PORT); }, DAEMON_TIMEOUT_MS, 250);
}

/** Whether this file's daemon still runs and listens, 1 s after a command. */
async function daemonStillRuns() {
    await sleep(1000);
    return daemonExit === null && await isTcpPortOpen(DAEMON_PORT);
}

/**
 * Runs `gina <args>` through the install link, as a shell does, and resolves with the exit
 * code a shell would see and everything the command printed.
 *
 * @param {string[]} args
 * @returns {Promise<{code: ?number, signal: ?string, out: string, ms: number}>}
 */
function gina(args) {
    return new Promise(function (resolve) {
        var t0 = Date.now(), out = '', exit = null, settled = false;
        var child = spawn(process.execPath, [GINA].concat(args), { cwd: FAKE_HOME, env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
        var done = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: exit ? exit.code : null, signal: exit ? exit.signal : null, out: plain(out), ms: Date.now() - t0 });
        };
        child.stdout.on('data', function (d) { out += d; });
        child.stderr.on('data', function (d) { out += d; });
        var timer = setTimeout(function () { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, CMD_TIMEOUT_MS);
        child.on('exit', function (code, signal) {
            exit = { code: code, signal: signal };
            // 'close' waits for the pipes; a grandchild holding one must not hold the test
            setTimeout(done, 3000);
        });
        child.on('close', done);
    });
}

/** The context an assertion message carries: the command's output and the daemon's. */
function context(r) {
    return '\n--- command (' + (r ? r.ms + ' ms' : 'none') + '):\n' + tail(r && r.out) + '\n--- daemon:\n' + tail(plain(daemonOut), 1200);
}

function ready(t) {
    if (skip) { t.skip(skipReason); return false; }
    assert.equal(setupError, null, 'setup failed: ' + setupError + context(null));
    return true;
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('45 - daemon-bundle-start-link-failure-b905 — a failed node_modules link makes bundle:start exit 1 with its reason (#B905)', function () {

    before(async function () {
        if (process.platform === 'win32') { skip = true; skipReason = 'the daemon path is Unix-centric (win32 not supported)'; return; }
        var ports = [DAEMON_PORT, MQ_PORT, PORT_START];
        for (var p = 0; p < ports.length; p++) {
            if (!(await isPortFree(ports[p]))) { skip = true; skipReason = 'port ' + ports[p] + ' is busy'; return; }
        }

        [PROJ_DIR, path.dirname(INSTALL), RUN_DIR, LOG_DIR, TMP_DIR].forEach(function (d) { fs.mkdirSync(d, { recursive: true }); });
        fs.symlinkSync(GINA_ROOT, INSTALL, 'dir');

        var r = await gina(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
        var projectsPath = path.join(GINA_HOME, 'projects.json');
        if (!fs.existsSync(projectsPath) || !readJSON(projectsPath)[PROJ]) { setupError = 'project:add did not register @' + PROJ + ':\n' + tail(r.out); return; }
        r = await gina(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
        var portsReversePath = path.join(GINA_HOME, 'ports.reverse.json');
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(portsReversePath) || !readJSON(portsReversePath)[key]) { setupError = 'bundle:add did not register ' + key + ':\n' + tail(r.out); return; }

        // nothing below may ever reach a daemon other than this file's own
        var version = readJSON(path.join(GINA_ROOT, 'package.json')).version;
        var settingsPath = path.join(GINA_HOME, version.split('.').slice(0, 2).join('.'), 'settings.json');
        var settings = null;
        try { settings = readJSON(settingsPath); } catch (e) { setupError = 'could not read ' + settingsPath + ': ' + e.message; return; }
        if (~~settings.port !== DAEMON_PORT) { setupError = 'settings.json port is ' + settings.port + ', not ' + DAEMON_PORT; return; }
        if (~~settings.mq_port !== MQ_PORT) { setupError = 'settings.json mq_port is ' + settings.mq_port + ', not ' + MQ_PORT; return; }
        if (typeof settings.rundir !== 'string' || fs.realpathSync(settings.rundir) !== fs.realpathSync(RUN_DIR)) { setupError = 'settings.json rundir is ' + settings.rundir + ', not ' + RUN_DIR; return; }

        // the project must load the tree under test (the #B422 Franken-boot trap)
        try {
            var target = fs.realpathSync(path.join(PROJ_DIR, 'node_modules', 'gina'));
            if (target !== fs.realpathSync(GINA_ROOT)) { setupError = 'node_modules/gina resolves to ' + target + ', not ' + GINA_ROOT; return; }
        } catch (e) { setupError = 'node_modules/gina is not linked: ' + (e.message || e); return; }

        // the markers start.js compares with the framework's: without them the first start
        // removes node_modules and runs npm install
        if (!settings.arch || !settings.platform) { setupError = 'settings.json has no arch/platform: ' + settings.arch + '/' + settings.platform; return; }
        fs.mkdirSync(path.join(PROJ_DIR, '.gna'), { recursive: true });
        fs.writeFileSync(path.join(PROJ_DIR, '.gna', 'arch'), String(settings.arch));
        fs.writeFileSync(path.join(PROJ_DIR, '.gna', 'platform'), String(settings.platform));

        var pe = readJSON(projectsPath)[PROJ], env = pe.def_env || 'dev';
        try { bundlePort = readJSON(portsReversePath)[key][env][pe.def_protocol][pe.def_scheme || 'http']; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        if (!(await isPortFree(bundlePort))) { skip = true; skipReason = 'the bundle port ' + bundlePort + ' is busy'; return; }
        // the homedir link-node-modules links the project's node_modules into
        projectHomedir = pe.homedir || path.join(FAKE_HOME, '.' + PROJ);

        if (!(await startDaemon())) { setupError = 'the daemon is not listening on ' + DAEMON_PORT + ' (exit ' + JSON.stringify(daemonExit) + ')'; return; }
    });

    after(async function () {
        var pids = bundlePids();
        for (var i = 0; i < pids.length; i++) { await kill(pids[i]); }
        if (daemon && daemonExit === null) {
            try { daemon.kill('SIGTERM'); } catch (e) { /* gone */ }
            if (!(await waitFor(function () { return daemonExit !== null; }, 5000, 100))) {
                try { daemon.kill('SIGKILL'); } catch (e) { /* gone */ }
                await waitFor(function () { return daemonExit !== null; }, 3000, 100);
            }
        }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    it('01  the link-node-modules child fails: exit 1, the child command, its exit code and its reason, nothing started, and the daemon still runs', { timeout: CMD_TIMEOUT_MS + 25000 }, async function (t) {
        if (!ready(t)) return;
        assert.ok(await stopBundles(), 'precondition: port ' + bundlePort + ' is still held');
        var nodeModules = path.join(PROJ_DIR, 'node_modules');
        var nodeModulesAside = path.join(FAKE_HOME, 'node_modules.b905-aside');
        var lib = path.join(projectHomedir, 'lib');
        var libAside = path.join(FAKE_HOME, 'homedir-lib.b905-aside');
        var hadLib = fs.existsSync(lib);
        var r;
        try {
            fs.renameSync(nodeModules, nodeModulesAside);
            fs.mkdirSync(projectHomedir, { recursive: true });
            if (hadLib) fs.renameSync(lib, libAside);
            // a file where `lib/` must be: `lib/node_modules` cannot be created, by root either
            fs.writeFileSync(lib, 'not a directory\n');
            r = await gina(['bundle:start', BUNDLE, '@' + PROJ]);
        } finally {
            fs.rmSync(lib, { force: true });
            if (hadLib) fs.renameSync(libAside, lib);
            fs.rmSync(nodeModules, { recursive: true, force: true });
            fs.renameSync(nodeModulesAside, nodeModules);
        }
        assert.equal(r.code, 1, 'exit ' + r.code + context(r));
        assert.match(r.out, new RegExp('`gina framework:link-node-modules @' + PROJ + '` failed \\(exit code 1\\)'), context(r));
        assert.match(r.out, /Cannot complete symlinkSync/, 'the child\'s reason is missing' + context(r));
        assert.ok(await daemonStillRuns(), 'the daemon ended: ' + JSON.stringify(daemonExit) + context(r));
        assert.equal(bundlePids().length, 0, 'a bundle was started' + context(r));
    });

    it('02  the files restored: exit 0 and the bundle listens (the control)', { timeout: CMD_TIMEOUT_MS + 25000 }, async function (t) {
        if (!ready(t)) return;
        assert.ok(await stopBundles(), 'precondition: port ' + bundlePort + ' is still held');
        var r = await gina(['bundle:start', BUNDLE, '@' + PROJ]);
        try {
            assert.equal(r.code, 0, 'exit ' + r.code + context(r));
            assert.ok(await waitFor(function () { return isTcpPortOpen(bundlePort); }, 5000), 'nothing listens on ' + bundlePort + context(r));
        } finally {
            await stopBundles();
        }
    });
});
