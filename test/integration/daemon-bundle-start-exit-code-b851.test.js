/**
 * #B851 — `bundle:start` and `bundle:restart` exit with the bundle's outcome, through a REAL
 * framework daemon.
 *
 * `bundle:start` is the one command bin/cli sends to the framework daemon (bin/cmd). The daemon's
 * lib/cmd/bundle/start.js spawns the bundle and reports the outcome over the command socket, in
 * two frames bin/cli strips: a header when the daemon takes the command, a trailer carrying the
 * exit code. Before #B851 bin/cli exited 0 for every outcome, and a refusal inside the daemon
 * (an unregistered project) ended the daemon itself (#B855). The unit tests pin the frame reader
 * and the codes (test/lib/bundle-start-status-b851.test.js), and the bind check is driven end to
 * end through gina-container (container-boot-bind-error-b851.test.js); this file drives the daemon
 * path end to end — its own daemon in an isolated home, `gina <command>` run the way a shell runs
 * it, the exit code the shell sees:
 *
 *   01  S0 — a free port: exit 0, and the bundle listens
 *   02  S1 — the bundle already runs: exit 0, « is already running with PID », nothing new is
 *       started, and the pid file still names the running bundle 1.5 s later (#B854)
 *   03  R1 — the pid file names another process: `bundle:restart` exits 1, and the old bundle
 *       still serves (B2, the #B850 shape)
 *   04  S2 — another program holds the bundle's port: exit 1, « held by another program »
 *   05  S3 — the bundle throws during startup: exit 1, « crashed during startup »
 *   06  S7 — a bundle the project does not declare: exit 1
 *   07  S6 — a project that is not registered: exit 1, and the daemon still runs (#B855). LAST:
 *       before the fix it ended the daemon.
 *
 * Red-first: on the tree before the arc (be7245c8c), 01 passes and every other arm fails. 03–07
 * fail on their exit code (each command exits 0); 02 exits 0 on both trees, as it should, and
 * fails on its missing « already running » line (that tree started a second child, which
 * overwrote the running bundle's pid file and removed it as it exited). 02 and 03 need the bundle
 * 01 started; 04 and 05 first stop every bundle of the project and wait for its port, so a
 * failed 03 does not fail them.
 *
 * Isolation: a throwaway HOME under os.tmpdir(). Its prefix holds `lib/node_modules/gina`, a link
 * to the tree under test, and every command runs through that link, the path a global install
 * gives it. The children get HOME, GINA_PREFIX, GINA_RUNDIR, GINA_LOGDIR, GINA_TMPDIR, GINA_PORT,
 * GINA_MQ_PORT and GINA_DEBUG_PORT pinned, and no other GINA_* variable and no npm prefix from
 * this process (an exported GINA_HOMEDIR would move the home), and run in the throwaway HOME, so
 * no child writes in the runner's directory (the tree under test). Before any command can reach a
 * daemon, settings.json is checked to carry the private port and the temp run dir. The daemon is
 * this file's own child (`node <install>/bin/cli start`, not `gina start`, which detaches it), on
 * ports no other test uses: 11950 (daemon), 11951 (MQ), 11952 (debug), bundles from 11955; the
 * file skips when one of them is busy. The project's `.gna/arch` and `.gna/platform` are written
 * before the first start, so the start never reinstalls node_modules. Teardown kills the decoy,
 * every process titled `gina: <bundle>@<project>` and the daemon — never through `gina stop`,
 * which SIGKILLs every `gina-v<version>` process on the machine.
 * Seam: `B851_GINA_ROOT=<tree>` links THAT tree into the prefix (red-first against another
 * worktree, no shared-tree touch).
 *
 * Run standalone:
 *   node --test test/integration/daemon-bundle-start-exit-code-b851.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawn, execFileSync } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP        = Date.now();
var FAKE_HOME    = path.join(os.tmpdir(), 'gina-b851d-home-' + STAMP);
var GINA_HOME    = path.join(FAKE_HOME, '.gina');
var PREFIX       = path.join(FAKE_HOME, 'prefix');
var RUN_DIR      = path.join(FAKE_HOME, 'run');
var LOG_DIR      = path.join(FAKE_HOME, 'log');
var TMP_DIR      = path.join(FAKE_HOME, 'tmp');
var PROJ         = 'dmn' + STAMP;
var BUNDLE       = 'web';
var PROJ_DIR     = path.join(FAKE_HOME, 'proj');
var CRASH_MARKER = path.join(FAKE_HOME, 'crash.marker');

var DAEMON_PORT  = 11950;
var MQ_PORT      = 11951;
var DEBUG_PORT   = 11952;
var PORT_START   = 11955;

var GINA_ROOT    = process.env.B851_GINA_ROOT || path.resolve(__dirname, '../..');
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
var bundlePort = null;
var daemon = null, daemonOut = '', daemonExit = null;
var decoy = null, holder = null;
var s0Pid = null;


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

/** The command line `ps` shows for `pid` (the process title for a gina process), or ''. */
function commandOf(pid) {
    try {
        return execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    } catch (e) {
        return '';
    }
}

/** The pids of every process titled `gina: <bundle>@<this project>`. */
function bundlePids() {
    var out = '';
    try { out = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' }); } catch (e) { return []; }
    var re = new RegExp('^\\s*(\\d+)\\s+gina: [a-z0-9_-]+@' + PROJ + '(\\s|$)');
    return out.split('\n').map(function (line) { var m = line.match(re); return m ? parseInt(m[1], 10) : null; })
        .filter(function (pid) { return pid; });
}

function pidFile() { return path.join(RUN_DIR, BUNDLE + '@' + PROJ + '.pid'); }

/** The pid the bundle's pid file names, or null when it is absent or empty. */
function pidFromFile() {
    try {
        var pid = parseInt(fs.readFileSync(pidFile(), 'utf8').trim(), 10);
        return isNaN(pid) ? null : pid;
    } catch (e) {
        return null;
    }
}

async function kill(pid) {
    if (!isAlive(pid)) return;
    try { process.kill(pid, 'SIGTERM'); } catch (e) { /* gone */ }
    if (await waitFor(function () { return !isAlive(pid); }, 4000, 100)) return;
    try { process.kill(pid, 'SIGKILL'); } catch (e) { /* gone */ }
    await waitFor(function () { return !isAlive(pid); }, 3000, 100);
}

/**
 * An arm's precondition: no bundle of the project runs and the bundle's port is free, whatever
 * the arm before it left (a failed assertion skips that arm's own cleanup).
 *
 * @returns {Promise<boolean>} true once the port is free
 */
async function stopBundles() {
    var pids = bundlePids();
    for (var i = 0; i < pids.length; i++) { await kill(pids[i]); }
    return waitFor(function () { return isPortFree(bundlePort); }, 10000);
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

describe('42 - daemon-bundle-start-exit-code-b851 — bundle:start and bundle:restart through a real daemon exit with the outcome (#B851)', function () {

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

        // S3's switch: the bundle throws before gina loads while the marker exists
        var indexPath = path.join(PROJ_DIR, 'src', BUNDLE, 'index.js');
        fs.writeFileSync(indexPath, "if (require('fs').existsSync(" + JSON.stringify(CRASH_MARKER) + ")) { throw new Error('b851 crash marker'); }\n" + fs.readFileSync(indexPath, 'utf8'));

        daemon = spawn(process.execPath, [CLI, 'start'], { cwd: FAKE_HOME, env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
        var keep = function (d) { daemonOut += d; if (daemonOut.length > 400000) daemonOut = daemonOut.slice(-200000); };
        daemon.stdout.on('data', keep);
        daemon.stderr.on('data', keep);
        daemon.on('exit', function (code, signal) { daemonExit = { code: code, signal: signal }; });
        var up = await waitFor(async function () { return daemonExit === null && await isTcpPortOpen(DAEMON_PORT); }, DAEMON_TIMEOUT_MS, 250);
        if (!up) { setupError = 'the daemon is not listening on ' + DAEMON_PORT + ' (exit ' + JSON.stringify(daemonExit) + ')'; return; }
    });

    after(async function () {
        if (decoy && decoy.exitCode === null && decoy.signalCode === null) { try { decoy.kill('SIGKILL'); } catch (e) { /* gone */ } }
        if (holder) { try { holder.close(); } catch (e) { /* ignore */ } }
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

    it('01  S0 — a free port: bundle:start exits 0 and the bundle listens', { timeout: CMD_TIMEOUT_MS + 15000 }, async function (t) {
        if (!ready(t)) return;
        var r = await gina(['bundle:start', BUNDLE, '@' + PROJ]);
        assert.doesNotMatch(r.out, /isNodeModulesReinstallNeeded: true/, 'the start reinstalled node_modules: the .gna markers did not match' + context(r));
        assert.equal(r.code, 0, 'exit ' + r.code + context(r));
        assert.ok(await waitFor(function () { return isTcpPortOpen(bundlePort); }, 3000), 'nothing listens on ' + bundlePort + context(r));
        s0Pid = pidFromFile();
        assert.ok(s0Pid && isAlive(s0Pid), 'the pid file names no running process: ' + s0Pid + context(r));
        assert.match(commandOf(s0Pid), new RegExp('^gina: ' + BUNDLE + '@' + PROJ + '(\\s|$)'), 'pid ' + s0Pid + ' is not the bundle');
    });

    it('02  S1 — the bundle already runs: exit 0, « already running », and its pid file intact 1.5 s later', { timeout: CMD_TIMEOUT_MS + 15000 }, async function (t) {
        if (!ready(t)) return;
        assert.ok(s0Pid, 'no running bundle from 01');
        var r = await gina(['bundle:start', BUNDLE, '@' + PROJ]);
        assert.equal(r.code, 0, 'exit ' + r.code + context(r));
        var m = r.out.match(/is already running with PID \[ (\d+) \]/);
        assert.ok(m, 'no « already running » line' + context(r));
        assert.equal(parseInt(m[1], 10), s0Pid, context(r));
        await sleep(1500);
        assert.equal(pidFromFile(), s0Pid, 'the pid file no longer names the running bundle' + context(r));
        assert.ok(isAlive(s0Pid) && await isTcpPortOpen(bundlePort), 'the running bundle stopped serving' + context(r));
    });

    it('03  R1 — the pid file names a decoy: bundle:restart exits 1 and the old bundle still serves', { timeout: CMD_TIMEOUT_MS + 25000 }, async function (t) {
        if (!ready(t)) return;
        assert.ok(s0Pid && isAlive(s0Pid), 'no running bundle from 01');
        decoy = spawn(process.execPath, ['-e', 'setInterval(function () {}, 1000)'], { stdio: 'ignore' });
        fs.writeFileSync(pidFile(), String(decoy.pid));
        var r = await gina(['bundle:restart', BUNDLE, '@' + PROJ]);
        assert.equal(r.code, 1, 'exit ' + r.code + context(r));
        assert.ok(isAlive(s0Pid), 'the old bundle ' + s0Pid + ' is gone' + context(r));
        assert.match(commandOf(s0Pid), new RegExp('^gina: ' + BUNDLE + '@' + PROJ + '(\\s|$)'), 'pid ' + s0Pid + ' is no longer the bundle');
        assert.ok(await isTcpPortOpen(bundlePort), 'nothing listens on ' + bundlePort + context(r));
    });

    it('04  S2 — another program holds the port: exit 1, « held by another program »', { timeout: CMD_TIMEOUT_MS + 25000 }, async function (t) {
        if (!ready(t)) return;
        assert.ok(await stopBundles(), 'precondition: port ' + bundlePort + ' is still held after every bundle of the project was stopped');
        holder = http.createServer(function (q, s) { s.end('holder'); });
        await new Promise(function (resolve, reject) { holder.once('error', reject); holder.listen(bundlePort, resolve); });
        try {
            var r = await gina(['bundle:start', BUNDLE, '@' + PROJ]);
            assert.equal(r.code, 1, 'exit ' + r.code + context(r));
            assert.match(r.out, new RegExp('port ' + bundlePort + ' is held by another program'), context(r));
            assert.ok(holder.listening, 'the holder lost the port');
        } finally {
            await new Promise(function (resolve) { holder.close(function () { resolve(); }); });
            holder = null;
        }
    });

    it('05  S3 — the bundle throws during startup: exit 1, « crashed during startup »', { timeout: CMD_TIMEOUT_MS + 25000 }, async function (t) {
        if (!ready(t)) return;
        assert.ok(await stopBundles(), 'precondition: port ' + bundlePort + ' is still held after every bundle of the project was stopped');
        fs.writeFileSync(CRASH_MARKER, '');
        var r;
        try { r = await gina(['bundle:start', BUNDLE, '@' + PROJ]); } finally { fs.rmSync(CRASH_MARKER, { force: true }); }
        assert.equal(r.code, 1, 'exit ' + r.code + context(r));
        assert.match(r.out, /crashed during startup \(exit code 1\)/, context(r));
        assert.equal(await isTcpPortOpen(bundlePort), false, 'something listens on ' + bundlePort + context(r));
    });

    it('06  S7 — a bundle the project does not declare: exit 1', { timeout: CMD_TIMEOUT_MS + 15000 }, async function (t) {
        if (!ready(t)) return;
        var r = await gina(['bundle:start', 'nosuch', '@' + PROJ]);
        assert.equal(r.code, 1, 'exit ' + r.code + context(r));
        assert.match(r.out, /Bundle \[ nosuch \] is not registered inside/, context(r));
    });

    it('07  S6 — a project that is not registered: exit 1, and the daemon still runs', { timeout: CMD_TIMEOUT_MS + 15000 }, async function (t) {
        if (!ready(t)) return;
        var r = await gina(['bundle:start', BUNDLE, '@nosuch' + STAMP]);
        assert.equal(r.code, 1, 'exit ' + r.code + context(r));
        assert.match(r.out, new RegExp('Project \\[nosuch' + STAMP + '\\] not found in your projects list'), context(r));
        await sleep(1000);
        assert.equal(daemonExit, null, 'the daemon exited: ' + JSON.stringify(daemonExit) + context(r));
        assert.ok(await isTcpPortOpen(DAEMON_PORT), 'the daemon no longer listens on ' + DAEMON_PORT + context(r));
    });
});
