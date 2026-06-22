#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/smoke_in_container.js
 *
 * Pre-release smoke test — runs INSIDE a throwaway Docker/OrbStack container
 * (a stock `node:NN` image), never on the host directly. It is invoked by
 * `script/smoke_test_tarball.js`, which packs the candidate tarball with
 * `npm pack --ignore-scripts` (faithful published bytes, NO "Prerelease update"
 * commit) and bind-mounts the tarball plus this script into the container:
 *
 *   docker run --rm \
 *     -v <tarball>:/tmp/gina.tgz:ro \
 *     -v script/smoke_in_container.js:/tmp/smoke.js:ro \
 *     -e GINA_SMOKE_TARBALL=/tmp/gina.tgz -e GINA_SMOKE_VERSION=<version> \
 *     -e GINA_LOG_STDOUT=true \
 *     node:NN node /tmp/smoke.js
 *
 * What it proves end-to-end, against the EXACT bytes that would be published:
 *   1. `npm install -g <tarball>` succeeds (exercises pre/post-install scripts —
 *      the v0.3.8 "broken global install" regression class).
 *   2. `gina version` runs and prints a version.
 *   3. `gina project:add` scaffolds a project.
 *   4. `gina bundle:add api` + `gina bundle:add frontend` scaffold two bundles.
 *   5. Both bundles BOOT to a listening HTTP server via the daemonless launcher
 *      `gina-container` (no framework socket / port-8124 daemon needed) and
 *      answer HTTP 200 with the boilerplate greeting.
 *
 * Exit codes: 0 — all checks passed; 1 — a check failed (the orchestrator turns
 * a non-zero exit into a loud red "DO NOT PUBLISH").
 *
 * Design notes mirrored from test/integration/container-boot.test.js (the proven
 * daemonless-boot harness):
 *   - CLI exit codes are NOT trusted (the first-run home bootstrap exits non-zero
 *     on a benign in-process MQ ECONNRESET); success is verified via the on-disk
 *     state files (projects.json / ports.reverse.json).
 *   - The bound port is read from ~/.gina/ports.reverse.json (the requested
 *     --start-port-from is only a hint; the resolved port can differ).
 *   - Boot via `gina-container <bundle> @<project>`, NOT `gina bundle:start`
 *     (the latter needs the port-8124 daemon, which a container does not run).
 */

'use strict';

var fs    = require('fs');
var os    = require('os');
var path  = require('path');
var net   = require('net');
var http  = require('http');
var https = require('https');
var { spawn, spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var TARBALL          = process.env.GINA_SMOKE_TARBALL || '/tmp/gina.tgz';
var EXPECTED_VERSION = process.env.GINA_SMOKE_VERSION  || '';
var PROJECT          = 'smoke';
var PROJECT_DIR      = path.join(os.tmpdir(), 'gina-smoke-project');
var BUNDLES          = ['api', 'frontend'];   // added in this order; first → webroot "/"
var PORT_BASE        = 9700;                   // api 9700, frontend 9800 (hints; resolved from state)
var GREETING         = 'Hello World';          // boilerplate config/app.json greeting
var GINA_HOME        = path.join(os.homedir(), '.gina');
var BOOT_TIMEOUT_MS  = 40000;                  // a cold container boot is slower than a warm host
var POLL_INTERVAL_MS = 300;

var booted = [];   // [{ name, proc, stdout, stderr, exit }] — SIGKILLed on shutdown

// Runtime. The orchestrator launches this script with `node` or `bun` as the
// container command, so detect which we're under. Under Bun the node-shebang
// `gina`/`gina-container` bins can't run (oven/bun has no node), so invoke their
// JS entry points with `bun` directly. (Bun's global install dir is the standard
// ~/.bun/install/global/node_modules location.)
var IS_BUN         = (typeof Bun !== 'undefined') || !!(process.versions && process.versions.bun);
var RUNTIME        = IS_BUN ? 'bun' : 'node';
var BUN_GINA_DIR   = path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'gina');
var GINA_ENTRY     = path.join(BUN_GINA_DIR, 'bin', 'gina');
var GINA_CONTAINER = path.join(BUN_GINA_DIR, 'bin', 'gina-container');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg)  { process.stdout.write('[ smoke ] ' + msg + '\n'); }
function ok(msg)   { process.stdout.write('[ smoke ] ✓ ' + msg + '\n'); }
function fail(msg) { process.stdout.write('[ smoke ] ✗ FAIL: ' + msg + '\n'); }

// ---------------------------------------------------------------------------
// Helpers (mirrored from test/integration/container-boot.test.js)
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

function waitForPort(port, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve) {
        (function poll() {
            isTcpPortOpen(port).then(function (open) {
                if (open)                   return resolve(true);
                if (Date.now() >= deadline) return resolve(false);
                setTimeout(poll, POLL_INTERVAL_MS);
            });
        })();
    });
}

function httpGet(useScheme, port, reqPath) {
    var lib = (useScheme === 'https') ? https : http;
    return new Promise(function (resolve) {
        var req = lib.request({
            host: '127.0.0.1', port: port, path: reqPath,
            method: 'GET', rejectUnauthorized: false
        }, function (res) {
            var body = '';
            res.on('data', function (chunk) { body += chunk; });
            res.on('end',  function () {
                resolve({ status: res.statusCode, contentType: res.headers['content-type'] || '', body: body });
            });
        });
        req.on('error', function (e) { resolve({ status: null, err: e.message, body: '' }); });
        req.end();
    });
}

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/**
 * Runs a gina CLI command. The exit status is informational ONLY — callers
 * verify success via the on-disk state files, because the first-run home
 * bootstrap exits non-zero on a benign in-process MQ ECONNRESET teardown.
 *
 * @param   {string[]} args  CLI argv (e.g. `['bundle:add', 'api', '@smoke']`).
 * @returns {{status: (number|null), stdout: string, stderr: string, error: (Error|undefined)}}
 */
function gina(args) {
    // Run from PROJECT_DIR (a real directory): when a command has no --path, the
    // gina CLI resolves the project from process.cwd() and ERRORS ("run command
    // from a deleted path") if the container's default CWD ("/") can't serve as a
    // project-resolution base. PROJECT_DIR is created before any gina() call.
    var r = IS_BUN
        ? spawnSync('bun', [GINA_ENTRY].concat(args), { cwd: PROJECT_DIR, encoding: 'utf8', timeout: 120000 })
        : spawnSync('gina', args, { cwd: PROJECT_DIR, encoding: 'utf8', timeout: 120000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

/**
 * Boots one scaffolded bundle via the daemonless `gina-container` launcher and
 * wires up stream + exit capture for diagnostics. Each call keeps its own
 * record so the stream listeners never cross-bind under a loop.
 *
 * @param   {string} name  Bundle name.
 * @returns {{name: string, proc: object, stdout: string, stderr: string, exit: (object|null)}}
 */
function bootBundle(name) {
    var rec = { name: name, proc: null, stdout: '', stderr: '', exit: null };
    if (IS_BUN) {
        rec.proc = spawn('bun', [GINA_CONTAINER, name, '@' + PROJECT], { cwd: PROJECT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
        rec.proc = spawn('gina-container', [name, '@' + PROJECT], { cwd: PROJECT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    rec.proc.stdout.on('data', function (d) { rec.stdout += d; });
    rec.proc.stderr.on('data', function (d) { rec.stderr += d; });
    rec.proc.on('exit', function (code, signal) { rec.exit = { code: code, signal: signal }; });
    booted.push(rec);
    return rec;
}

/**
 * Rich boot-failure diagnostic — distinguishes a CRASH (non-zero exit before
 * binding; a timeout bump would not help) from a genuine stalled boot (never
 * reached `.listen()`), and dumps both child streams with byte counts (the
 * 2026-06-10 CI flake came back with an EMPTY tail).
 *
 * @inner
 * @param {object} rec  A {@link bootBundle} record.
 * @returns {string}
 */
function diagnostics(rec) {
    var note;
    if (rec.exit === null)        note = 'still running at deadline — a stalled boot (never reached .listen())';
    else if (rec.exit.code === 0) note = 'exited cleanly (code 0) before binding — unexpected';
    else                          note = 'CRASHED (exit ' + rec.exit.code + ', signal ' + rec.exit.signal + ') before binding — a boot crash, NOT a slow boot';
    return 'container exit: ' + JSON.stringify(rec.exit) + ' — ' + note + '\n' +
           'stdout (' + rec.stdout.length + 'b):\n' + (rec.stdout || '(empty)') + '\n---\n' +
           'stderr (' + rec.stderr.length + 'b):\n' + (rec.stderr || '(empty)');
}

function shutdown() {
    booted.forEach(function (b) {
        try { if (b.proc && b.proc.exitCode === null) b.proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
    });
}

function die(code) { shutdown(); process.exit(code); }

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

async function main() {
    log((IS_BUN ? ('bun ' + (process.versions.bun || '')) : ('node ' + process.version)) +
        ' — tarball ' + TARBALL + (EXPECTED_VERSION ? ' (candidate ' + EXPECTED_VERSION + ')' : ''));

    // Every gina() call runs from PROJECT_DIR (see the gina() helper) — create it
    // up front so the CWD is a real directory before the first CLI invocation.
    fs.mkdirSync(PROJECT_DIR, { recursive: true });

    // 1. Install the candidate globally. Node: `npm install -g` (exercises
    //    pre/post-install). Bun: `bun add -g` — note Bun blocks dependency
    //    postinstall by default, so ~/.gina + framework deps are NOT bootstrapped;
    //    the smoke then surfaces the first runtime break under Bun.
    var t0 = Date.now();
    var inst;
    if (IS_BUN) {
        log('bun add -g ' + TARBALL + ' ...');
        inst = spawnSync('bun', ['add', '-g', TARBALL], { stdio: 'inherit', timeout: 600000 });
    } else {
        log('npm install -g ' + TARBALL + ' (runs pre/post-install) ...');
        inst = spawnSync('npm', ['install', '-g', TARBALL], { stdio: 'inherit', timeout: 600000 });
    }
    if (inst.error) { fail('could not run the ' + RUNTIME + ' installer: ' + inst.error.message); return die(1); }
    if (inst.status !== 0) { fail('global install exited ' + inst.status); return die(1); }
    ok('installed in ' + Math.round((Date.now() - t0) / 1000) + 's');
    if (IS_BUN) {
        log('note: Bun blocks dependency postinstall by default — ~/.gina + framework deps (swig/psl/ws) are NOT auto-bootstrapped; surfacing the first runtime break.');
    }

    // 2. gina version — proves the CLI resolves and runs offline.
    var ver = gina(['version']);
    if (ver.error) { fail('`gina` not runnable after install: ' + ver.error.message + ' (is it on PATH?)'); return die(1); }
    if (ver.status !== 0) { fail('`gina version` exited ' + ver.status + '\n' + (ver.stderr || ver.stdout)); return die(1); }
    var verOut = (ver.stdout + ver.stderr).trim();
    if (!verOut) { fail('`gina version` produced no output'); return die(1); }
    ok('gina version → ' + verOut.split('\n')[0]);
    if (EXPECTED_VERSION && verOut.indexOf(EXPECTED_VERSION) < 0) {
        // Soft check: a STABLE cut packs pre-rename bytes whose internal version
        // still carries the prior alpha suffix (the framework dir is renamed only
        // inside the `prepare` hook, after this gate). The code is identical, so a
        // version-string mismatch here is expected, not a failure.
        log('note: candidate "' + EXPECTED_VERSION + '" not found verbatim in `gina version` output — expected for a stable pre-rename smoke.');
    }

    // 3. project:add — scaffold the project (verify via projects.json, not exit code).
    gina(['project:add', '@' + PROJECT, '--path=' + PROJECT_DIR]);
    var projectsPath = path.join(GINA_HOME, 'projects.json');
    if (!fs.existsSync(projectsPath) || !readJSON(projectsPath)[PROJECT]) {
        fail('project:add did not register @' + PROJECT + ' in ' + projectsPath); return die(1);
    }
    ok('project @' + PROJECT + ' scaffolded at ' + PROJECT_DIR);

    // 4. bundle:add api + frontend (verify via ports.reverse.json + the entry point).
    var portsReversePath = path.join(GINA_HOME, 'ports.reverse.json');
    for (var i = 0; i < BUNDLES.length; i++) {
        var b   = BUNDLES[i];
        var key = b + '@' + PROJECT;
        gina(['bundle:add', b, '@' + PROJECT, '--start-port-from=' + (PORT_BASE + i * 100)]);
        if (!fs.existsSync(portsReversePath) || !readJSON(portsReversePath)[key]) {
            fail('bundle:add did not register ' + key + ' in ports.reverse.json'); return die(1);
        }
        var entry = path.join(PROJECT_DIR, 'src', b, 'index.js');
        if (!fs.existsSync(entry)) { fail('bundle entry point not scaffolded: ' + entry); return die(1); }
        ok('bundle ' + b + ' scaffolded');
    }

    // 5. Boot each bundle and verify it serves — SEQUENTIALLY, one at a time.
    //    gina-container is one-bundle-per-container by design (the k8s model).
    //    Booting two bundles of the same project CONCURRENTLY races on the shared
    //    bundles/ mount symlinks (gna.js mountBundle does check→rmSync→symlinkSync)
    //    and on the shared project config load — which crashes the second bundle.
    //    Booting+verifying each bundle before the next starts removes the race.
    var projects     = readJSON(projectsPath);
    var portsReverse = readJSON(portsReversePath);
    var pe     = projects[PROJECT];
    var env    = pe.def_env      || 'dev';
    var scheme = pe.def_scheme   || 'http';
    var proto  = pe.def_protocol;

    for (var j = 0; j < BUNDLES.length; j++) {
        var name = BUNDLES[j];
        var k    = name + '@' + PROJECT;

        var port;
        try { port = portsReverse[k][env][proto][scheme]; } catch (e) { port = null; }
        if (!port) { fail('could not resolve bound port for ' + k + ' (' + env + '/' + proto + '/' + scheme + ')'); return die(1); }

        var webroot;
        try {
            var ssj = fs.readFileSync(path.join(PROJECT_DIR, 'src', name, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + name);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + name + '/'; }

        var rec = bootBundle(name);
        log('booting ' + name + ' → ' + scheme + '://127.0.0.1:' + port + webroot + ' (gina-container)');

        var opened = await waitForPort(port, BOOT_TIMEOUT_MS);
        if (!opened) {
            fail(name + ' never bound port ' + port + ' within ' + BOOT_TIMEOUT_MS + ' ms.\n' + diagnostics(rec));
            return die(1);
        }
        var res = await httpGet(scheme, port, webroot);
        if (res.status !== 200) {
            fail('GET ' + scheme + '://127.0.0.1:' + port + webroot + ' returned ' + res.status +
                 (res.err ? ' (' + res.err + ')' : '') + '\n' + diagnostics(rec));
            return die(1);
        }
        if (res.body.indexOf(GREETING) < 0) {
            fail(name + ' served 200 but body lacks the "' + GREETING + '" greeting.\nfirst 200 chars: ' + res.body.substring(0, 200));
            return die(1);
        }
        ok(name + ' serving HTTP 200 with greeting at ' + scheme + '://127.0.0.1:' + port + webroot);
    }

    log('ALL CHECKS PASSED on node ' + process.version);
    return die(0);
}

main().catch(function (e) { fail('unexpected error: ' + (e && e.stack ? e.stack : e)); die(1); });
