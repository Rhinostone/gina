/**
 * #B906 — a gina state file that cannot be used refuses `bundle:start`, and the framework daemon
 * keeps running.
 *
 * `bundle:start` is the one command bin/cli sends to the framework daemon (bin/cmd). On its way to
 * spawning the bundle, the daemon reads gina's own state files in the command helper
 * (lib/cmd/helper.js): `~/.gina/main.json` and `projects.json` in isCmdConfigured(), `ports.json`
 * and `ports.reverse.json` in loadAssets(). They were read with requireJSON(), which calls
 * `process.exit(1)` on a file it cannot read or parse: a malformed or unreadable projects.json,
 * ports.json or ports.reverse.json ended the daemon (measured), and the command printed only
 * « the framework ended this command before it reported the outcome ». They are now read without
 * exiting, as #B890 reads the project's files: a file that cannot be used refuses the command
 * with « <file> cannot be used: <reason> », which inside the daemon ends only that client.
 * bin/cli reads main.json with requireJSON() too, before it sends `bundle:start`, inside a try that
 * the exit defeated; it now only warns there, and the daemon refuses. This file drives each case
 * through its own daemon:
 *
 *   01  a malformed projects.json: exit 1, « projects.json cannot be used: could not parse … »,
 *       and the daemon still runs
 *   02  an unreadable projects.json: exit 1, « projects.json cannot be used: EACCES … », and the
 *       daemon still runs (skipped as root, who reads it anyway)
 *   03  a malformed ports.json: exit 1, « ports.json cannot be used », and the daemon still runs
 *   04  a malformed ports.reverse.json: exit 1, « ports.reverse.json cannot be used », and the
 *       daemon still runs
 *   05  an unreadable ports.reverse.json: exit 1, « ports.reverse.json cannot be used: EACCES », and
 *       the daemon still runs (skipped as root)
 *   06  a malformed main.json: exit 1, « main.json cannot be used », no requireJSON() `<strong>`
 *       markup, and the daemon still runs
 *   07  `bundle:status` (offline, in the CLI process) with a malformed ports.reverse.json: exit 1,
 *       « ports.reverse.json cannot be used », without requireJSON()'s `<strong>` markup
 *   08  `bundle:status` with a missing ports.reverse.json: exit 0 and « (no port) » (the
 *       framework init recreates the file; the documented tolerance is kept)
 *   09  the files restored: exit 0 and the bundle listens (the control: the daemon still starts
 *       bundles after every arm above)
 *
 * Each arm first restarts the daemon if an earlier arm ended it, so on a tree without the fix
 * every arm fails on its own cause. Red-first: see the commit that adds this file.
 *
 * A daemon counts as started only once it has printed « Framework ready for connections », not
 * when its port opens: bin/cmd opens the command socket first and then runs `framework:start`,
 * whose init chain and own start read main.json and projects.json. An arm that broke one of them
 * in that window ended the daemon's own start, which this fix leaves as it was (measured under
 * load: arms 01 and 02 failed that way with the other daemon files running beside this one).
 *
 * Isolation, as in daemon-bundle-start-unusable-file-b890.test.js: a throwaway HOME under
 * os.tmpdir(), whose prefix holds `lib/node_modules/gina`, a link to the tree under test; every
 * command runs through that link with HOME, GINA_PREFIX, GINA_RUNDIR, GINA_LOGDIR, GINA_TMPDIR,
 * GINA_PORT, GINA_MQ_PORT and GINA_DEBUG_PORT pinned, no other GINA_* variable and no npm prefix.
 * Before any command can reach a daemon, settings.json is checked to carry the private port and
 * the temp run dir. The daemon is this file's own child (`node <install>/bin/cli start`), on
 * ports no other test uses: 12150 (daemon), 12151 (MQ), 12152 (debug), bundles from 12155; the
 * file skips when one of them is busy. Teardown kills every process titled
 * `gina: <bundle>@<project>` and the daemon, never through `gina stop`, which SIGKILLs every
 * `gina-v<version>` process on the machine.
 * Seam: `B906_GINA_ROOT=<tree>` links THAT tree into the prefix (the red-first run against a copy
 * of the tree before the fix).
 *
 * Run standalone:
 *   node --test test/integration/daemon-bundle-start-state-file-b906.test.js
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
var FAKE_HOME    = path.join(os.tmpdir(), 'gina-b906d-home-' + STAMP);
var GINA_HOME    = path.join(FAKE_HOME, '.gina');
var PREFIX       = path.join(FAKE_HOME, 'prefix');
var RUN_DIR      = path.join(FAKE_HOME, 'run');
var LOG_DIR      = path.join(FAKE_HOME, 'log');
var TMP_DIR      = path.join(FAKE_HOME, 'tmp');
var PROJ         = 'stf' + STAMP;
var BUNDLE       = 'web';
var PROJ_DIR     = path.join(FAKE_HOME, 'proj');

var DAEMON_PORT  = 12150;
var MQ_PORT      = 12151;
var DEBUG_PORT   = 12152;
var PORT_START   = 12155;

var GINA_ROOT    = process.env.B906_GINA_ROOT || path.resolve(__dirname, '../..');
// the commands run through the prefix, the path a global install gives them
var INSTALL      = path.join(PREFIX, 'lib', 'node_modules', 'gina');
var GINA         = path.join(INSTALL, 'bin', 'gina');
var CLI          = path.join(INSTALL, 'bin', 'cli');

// gina's own state files, the ones this file breaks
var MAIN_JSON          = path.join(GINA_HOME, 'main.json');
var PROJECTS_JSON      = path.join(GINA_HOME, 'projects.json');
var PORTS_JSON         = path.join(GINA_HOME, 'ports.json');
var PORTS_REVERSE_JSON = path.join(GINA_HOME, 'ports.reverse.json');

var CMD_TIMEOUT_MS    = 60000;
var DAEMON_TIMEOUT_MS = 30000;
// the line framework:start prints once it has read gina's state files (lib/cmd/framework/start.js)
var READY_LINE        = 'Framework ready for connections';

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
var daemon = null, daemonOut = '', daemonExit = null, daemonStarts = 0, daemonReady = false;
// the files as gina wrote them; every arm puts them back
var originals = {};


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
 * until it is ready: its port open and READY_LINE in this start's own output. The port opens
 * before `framework:start` has read gina's state files, so the port alone is not enough.
 *
 * @returns {Promise<boolean>} true once the daemon listens and has printed READY_LINE
 */
async function startDaemon() {
    var child = spawn(process.execPath, [CLI, 'start'], { cwd: FAKE_HOME, env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    daemon = child;
    daemonExit = null;
    daemonReady = false;
    ++daemonStarts;
    var startOut = '';
    var keep = function (d) {
        daemonOut += d;
        if (daemonOut.length > 400000) daemonOut = daemonOut.slice(-200000);
        if (!daemonReady && daemon === child) {
            // a rolling window, so a line split across two chunks is still found
            startOut = (startOut + d).slice(-4096);
            if (startOut.indexOf(READY_LINE) > -1) daemonReady = true;
        }
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('exit', function (code, signal) { if (daemon === child) daemonExit = { code: code, signal: signal }; });
    return waitFor(async function () { return daemonExit === null && daemonReady && await isTcpPortOpen(DAEMON_PORT); }, DAEMON_TIMEOUT_MS, 250);
}

/** Restarts the daemon when an earlier arm ended it, so each arm fails on its own cause. */
async function ensureDaemon() {
    if (daemon && daemonExit === null && daemonReady && await isTcpPortOpen(DAEMON_PORT)) return true;
    if (daemon && daemonExit === null) {
        try { daemon.kill('SIGKILL'); } catch (e) { /* gone */ }
    }
    return startDaemon();
}

/** Whether this file's daemon still runs and listens, 1 s after a command. */
async function daemonStillRuns() {
    await sleep(1000);
    return daemonExit === null && await isTcpPortOpen(DAEMON_PORT);
}

/** Puts every file the arms change back as the scaffold wrote it. */
function restoreFiles() {
    Object.keys(originals).forEach(function (file) {
        try { fs.chmodSync(file, 0o644); } catch (e) { /* absent */ }
        fs.writeFileSync(file, originals[file]);
    });
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
    return '\n--- command (' + (r ? r.ms + ' ms' : 'none') + '):\n' + tail(r && r.out) + '\n--- daemon (started ' + daemonStarts + ' times):\n' + tail(plain(daemonOut), 1200);
}

function ready(t) {
    if (skip) { t.skip(skipReason); return false; }
    assert.equal(setupError, null, 'setup failed: ' + setupError + context(null));
    return true;
}

/**
 * One arm: puts a state file in the state `mutate` leaves it in, runs `bundle:start`, and checks
 * the refusal and the daemon.
 *
 * @param {function} mutate - changes the file(s) before the command
 * @param {RegExp} expected - what the output must carry
 * @returns {Promise<{code: ?number, out: string}>} the command's result, for further checks
 */
async function refusedAndDaemonRuns(mutate, expected) {
    assert.ok(await ensureDaemon(), 'precondition: the daemon is not listening on ' + DAEMON_PORT + context(null));
    var r;
    try {
        mutate();
        r = await gina(['bundle:start', BUNDLE, '@' + PROJ]);
    } finally {
        restoreFiles();
    }
    assert.equal(r.code, 1, 'exit ' + r.code + context(r));
    assert.match(r.out, expected, context(r));
    assert.doesNotMatch(r.out, /the framework ended this command/, context(r));
    assert.ok(await daemonStillRuns(), 'the daemon ended: ' + JSON.stringify(daemonExit) + context(r));
    assert.equal(bundlePids().length, 0, 'a bundle was started' + context(r));
    return r;
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('46 - daemon-bundle-start-state-file-b906 — a gina state file that cannot be used refuses bundle:start, and the daemon keeps running (#B906)', function () {

    before(async function () {
        if (process.platform === 'win32') { skip = true; skipReason = 'the daemon path is Unix-centric (win32 not supported)'; return; }
        var ports = [DAEMON_PORT, MQ_PORT, PORT_START];
        for (var p = 0; p < ports.length; p++) {
            if (!(await isPortFree(ports[p]))) { skip = true; skipReason = 'port ' + ports[p] + ' is busy'; return; }
        }

        [PROJ_DIR, path.dirname(INSTALL), RUN_DIR, LOG_DIR, TMP_DIR].forEach(function (d) { fs.mkdirSync(d, { recursive: true }); });
        fs.symlinkSync(GINA_ROOT, INSTALL, 'dir');

        var r = await gina(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
        if (!fs.existsSync(PROJECTS_JSON) || !readJSON(PROJECTS_JSON)[PROJ]) { setupError = 'project:add did not register @' + PROJ + ':\n' + tail(r.out); return; }
        r = await gina(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(PORTS_REVERSE_JSON) || !readJSON(PORTS_REVERSE_JSON)[key]) { setupError = 'bundle:add did not register ' + key + ':\n' + tail(r.out); return; }

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

        var pe = readJSON(PROJECTS_JSON)[PROJ], env = pe.def_env || 'dev';
        try { bundlePort = readJSON(PORTS_REVERSE_JSON)[key][env][pe.def_protocol][pe.def_scheme || 'http']; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        if (!(await isPortFree(bundlePort))) { skip = true; skipReason = 'the bundle port ' + bundlePort + ' is busy'; return; }

        // the files the arms break, each checked to parse as written
        var files = [MAIN_JSON, PROJECTS_JSON, PORTS_JSON, PORTS_REVERSE_JSON];
        for (var f = 0; f < files.length; f++) {
            if (!fs.existsSync(files[f])) { setupError = 'gina wrote no ' + files[f]; return; }
            originals[files[f]] = fs.readFileSync(files[f]);
            try { JSON.parse(originals[files[f]]); } catch (e) { setupError = files[f] + ' does not parse as written: ' + e.message; return; }
        }

        if (!(await startDaemon())) { setupError = 'the daemon is not listening on ' + DAEMON_PORT + ' (exit ' + JSON.stringify(daemonExit) + ')'; return; }
    });

    after(async function () {
        try { restoreFiles(); } catch (e) { /* the home may be gone */ }
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

    // `x` before the text: not JSON, with or without comments
    function breakFile(file) { fs.writeFileSync(file, 'x' + originals[file]); }

    var ARM_TIMEOUT = CMD_TIMEOUT_MS + DAEMON_TIMEOUT_MS + 15000;
    var asRoot = function () { return typeof process.getuid === 'function' && process.getuid() === 0; };

    it('01  a malformed projects.json: exit 1, « projects.json cannot be used », and the daemon still runs', { timeout: ARM_TIMEOUT }, async function (t) {
        if (!ready(t)) return;
        await refusedAndDaemonRuns(function () { breakFile(PROJECTS_JSON); },
            /projects\.json cannot be used: could not parse `[^`]*projects\.json`/);
    });

    it('02  an unreadable projects.json: exit 1, « projects.json cannot be used: EACCES », and the daemon still runs', { timeout: ARM_TIMEOUT }, async function (t) {
        if (!ready(t)) return;
        if (asRoot()) { t.skip('root reads a file whatever its mode'); return; }
        await refusedAndDaemonRuns(function () { fs.chmodSync(PROJECTS_JSON, 0o000); },
            /projects\.json cannot be used: EACCES/);
    });

    it('03  a malformed ports.json: exit 1, « ports.json cannot be used », and the daemon still runs', { timeout: ARM_TIMEOUT }, async function (t) {
        if (!ready(t)) return;
        await refusedAndDaemonRuns(function () { breakFile(PORTS_JSON); },
            /(^|[^.])ports\.json cannot be used: could not parse `[^`]*\/ports\.json`/m);
    });

    it('04  a malformed ports.reverse.json: exit 1, « ports.reverse.json cannot be used », and the daemon still runs', { timeout: ARM_TIMEOUT }, async function (t) {
        if (!ready(t)) return;
        await refusedAndDaemonRuns(function () { breakFile(PORTS_REVERSE_JSON); },
            /ports\.reverse\.json cannot be used: could not parse `[^`]*ports\.reverse\.json`/);
    });

    it('05  an unreadable ports.reverse.json: exit 1, « ports.reverse.json cannot be used: EACCES », and the daemon still runs', { timeout: ARM_TIMEOUT }, async function (t) {
        if (!ready(t)) return;
        if (asRoot()) { t.skip('root reads a file whatever its mode'); return; }
        await refusedAndDaemonRuns(function () { fs.chmodSync(PORTS_REVERSE_JSON, 0o000); },
            /ports\.reverse\.json cannot be used: EACCES/);
    });

    it('06  a malformed main.json: exit 1, « main.json cannot be used », no <strong> markup, and the daemon still runs', { timeout: ARM_TIMEOUT }, async function (t) {
        if (!ready(t)) return;
        var r = await refusedAndDaemonRuns(function () { breakFile(MAIN_JSON); },
            /main\.json cannot be used: could not parse `[^`]*main\.json`/);
        assert.doesNotMatch(r.out, /<strong/, context(r));
    });

    it('07  bundle:status with a malformed ports.reverse.json: exit 1, « ports.reverse.json cannot be used », no <strong> markup', { timeout: CMD_TIMEOUT_MS + 15000 }, async function (t) {
        if (!ready(t)) return;
        var r;
        try {
            breakFile(PORTS_REVERSE_JSON);
            r = await gina(['bundle:status', BUNDLE, '@' + PROJ]);
        } finally {
            restoreFiles();
        }
        assert.equal(r.code, 1, 'exit ' + r.code + context(r));
        assert.match(r.out, /ports\.reverse\.json cannot be used: could not parse `[^`]*ports\.reverse\.json`/, context(r));
        assert.doesNotMatch(r.out, /<strong/, context(r));
    });

    it('08  bundle:status with a missing ports.reverse.json: exit 0 and « (no port) » (the documented tolerance)', { timeout: CMD_TIMEOUT_MS + 15000 }, async function (t) {
        if (!ready(t)) return;
        var r;
        try {
            fs.rmSync(PORTS_REVERSE_JSON);
            r = await gina(['bundle:status', BUNDLE, '@' + PROJ]);
        } finally {
            restoreFiles();
        }
        assert.equal(r.code, 0, 'exit ' + r.code + context(r));
        assert.match(r.out, new RegExp('\\[ (stopped|running) \\] ' + BUNDLE + '\\s+\\(no port\\)'), context(r));
    });

    it('09  the files restored: exit 0 and the bundle listens (the control, after every arm above)', { timeout: CMD_TIMEOUT_MS + DAEMON_TIMEOUT_MS + 25000 }, async function (t) {
        if (!ready(t)) return;
        assert.ok(await ensureDaemon(), 'precondition: the daemon is not listening on ' + DAEMON_PORT + context(null));
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
