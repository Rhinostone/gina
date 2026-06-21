#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/smoke_test_tarball.js
 *
 * Pre-release container smoke GATE. Packs the candidate gina tarball with
 * `npm pack --ignore-scripts` — faithful published bytes, and crucially NO
 * "Prerelease update" commit (the same no-side-effect pack primitive
 * `script/check_no_local_leak.js` relies on; `--ignore-scripts` keeps npm from
 * re-entering the `prepare` hook / `prepare_version.js`). It then installs and
 * exercises that tarball end-to-end in a CLEAN `node:NN` Docker/OrbStack
 * container for each target Node version (default 22, 24, 26 — the CI test
 * matrix). See `script/smoke_in_container.js` for what runs inside each
 * container (install -> `gina version` -> project -> api + frontend bundles ->
 * boot both -> assert HTTP 200 + greeting).
 *
 * This is a STANDALONE gate — deliberately NOT wired into any npm lifecycle
 * hook, so a casual `npm pack` / `npm install` never boots a container, and the
 * release stays decoupled from Docker being up. Run it as an explicit
 * pre-publish step in the release runbook, before `npm publish`:
 *
 *   npm run smoke                  # full matrix: node 22, 24, 26
 *   npm run smoke -- --node=22     # single version (fast iteration)
 *   npm run smoke -- --node=22,24  # a subset
 *   npm run smoke -- --bun         # Node matrix + the Bun leg
 *   npm run smoke -- --node= --bun # Bun only (for iterating on Bun support)
 *
 * Green -> safe to `npm publish`. Red -> DO NOT publish.
 *
 * Exit codes:
 *   0 — every selected runtime passed (Node versions, and Bun when --bun).
 *   1 — at least one selected runtime FAILED → do not publish.
 *   2 — could not run the gate (Docker unreachable, `npm pack` failed) — this is
 *       a tooling error, NOT a smoke verdict; resolve it and re-run.
 *
 * Side effects: NONE that touch the release. It only reads the working tree,
 * writes a throwaway tarball into a temp dir (removed at the end), and runs
 * disposable `--rm` containers. It never publishes, tags, commits, pushes, or
 * mutates `~/.gina`.
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { spawnSync } = require('child_process');

var REPO_ROOT             = path.resolve(__dirname, '..');
var IN_CONTAINER_SCRIPT   = path.join(__dirname, 'smoke_in_container.js');
var DEFAULT_NODE_VERSIONS = ['22', '24', '26'];   // mirrors the CI test matrix (.github/workflows/test.yml)
var DEFAULT_BUN_IMAGE     = 'oven/bun:latest';    // opt-in via --bun (supported runtime; CI pins a specific tag for reproducibility)

// ---------------------------------------------------------------------------
// Small console helpers
// ---------------------------------------------------------------------------

var ESC = String.fromCharCode(27);   // build ANSI at runtime — no control bytes in this source file
function color(c, s) { return process.stdout.isTTY ? (ESC + '[' + c + 'm' + s + ESC + '[0m') : s; }
function green(s) { return color('1;32', s); }
function red(s)   { return color('1;31', s); }
function bold(s)  { return color('1',    s); }
var BAR = '════════════════════════════════════════════════════════════════════';

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/**
 * Parses `--node=22,24,26` from argv. Falls back to the CI matrix when absent.
 *
 * @inner
 * @param   {string[]} argv  `process.argv.slice(2)`.
 * @returns {string[]} Node major versions (image tags), e.g. `['22','24','26']`.
 */
function parseNodeVersions(argv) {
    var arg = argv.filter(function (a) { return a.indexOf('--node=') === 0; }).pop();
    if (!arg) return DEFAULT_NODE_VERSIONS.slice();
    return arg.slice('--node='.length).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

/**
 * Parses the opt-in `--bun` flag (and optional `--bun-image=<img>` override).
 * Bun is a supported runtime but is kept OUT of the default matrix so the plain
 * `npm run smoke` stays Node-only and fast; the Bun leg runs when requested via
 * `--bun` (the CI Bun-smoke workflow always requests it).
 *
 * @inner
 * @param   {string[]} argv  `process.argv.slice(2)`.
 * @returns {{enabled: boolean, image: string}}
 */
function parseBun(argv) {
    var enabled = argv.indexOf('--bun') > -1;
    var imgArg  = argv.filter(function (a) { return a.indexOf('--bun-image=') === 0; }).pop();
    return { enabled: enabled, image: imgArg ? imgArg.slice('--bun-image='.length) : DEFAULT_BUN_IMAGE };
}

/**
 * Builds the ordered list of runtime targets from argv: the Node legs (from
 * `--node=`, default 22/24/26) followed by the opt-in Bun leg (`--bun`).
 *
 * @inner
 * @param   {string[]} argv
 * @returns {Array<{label: string, image: string, runtime: string, experimental: boolean}>}
 */
function buildTargets(argv) {
    var targets = parseNodeVersions(argv).map(function (v) {
        return { label: 'node:' + v, image: 'node:' + v, runtime: 'node', experimental: false };
    });
    var bun = parseBun(argv);
    if (bun.enabled) {
        targets.push({ label: 'bun', image: bun.image, runtime: 'bun', experimental: false }); // supported runtime (promoted from experimental)
    }
    return targets;
}

/**
 * @inner
 * @returns {(string|null)} the Docker/OrbStack server version, or null if the
 *          daemon is unreachable.
 */
function dockerServerVersion() {
    var r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim() || null;
}

/**
 * Packs the candidate tarball with `--ignore-scripts` (no `prepare`/commit) into
 * `destDir` and returns the absolute path to the produced `.tgz`.
 *
 * @inner
 * @param   {string} destDir  Temp directory to write the tarball into.
 * @returns {string} Absolute path to the packed tarball.
 * @throws  {Error} when `npm pack` fails or the filename can't be determined.
 */
function pack(destDir) {
    var r = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destDir],
        { cwd: REPO_ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('npm pack failed:\n' + (r.stderr || r.stdout || '(no output)'));
    var meta;
    try { meta = JSON.parse(r.stdout); } catch (e) { throw new Error('could not parse `npm pack --json` output:\n' + r.stdout); }
    var filename = meta && meta[0] && meta[0].filename;
    if (!filename) throw new Error('could not determine packed tarball filename from `npm pack --json`');
    return path.join(destDir, filename);
}

/**
 * Runs the smoke for one runtime target in a disposable container.
 *
 * @inner
 * @param   {{label: string, image: string, runtime: string, experimental: boolean}} target
 * @param   {string} tarball          Absolute host path to the packed tarball.
 * @param   {string} candidateVersion `package.json` version of the candidate.
 * @returns {('pass'|'fail'|'error')} `pass` when the container smoke exited 0,
 *          `fail` when it ran and a check failed, `error` when Docker could not
 *          even create/run the container (image pull/extract failure, out of
 *          disk, bad invocation — exit 125/126/127) — a tooling error, NOT a
 *          smoke verdict.
 */
function runOne(target, tarball, candidateVersion) {
    process.stdout.write('\n' + bold(BAR) + '\n' +
        bold('  Smoke — ' + target.label + (target.experimental ? '  (experimental)' : '')) + '\n' + bold(BAR) + '\n');
    var args = [
        'run', '--rm',
        '-v', tarball + ':/tmp/gina.tgz:ro',
        '-v', IN_CONTAINER_SCRIPT + ':/tmp/smoke.js:ro',
        '-e', 'GINA_SMOKE_TARBALL=/tmp/gina.tgz',
        '-e', 'GINA_SMOKE_VERSION=' + candidateVersion,
        '-e', 'GINA_LOG_STDOUT=true',
        target.image, target.runtime, '/tmp/smoke.js'
    ];
    var r = spawnSync('docker', args, { stdio: 'inherit' });
    // Docker reserves 125 (could not run), 126 (not executable), 127 (not found)
    // for "the container never ran" — image pull/extract failure, out of disk,
    // bad flag. That is a tooling error, not a gina smoke failure: the gate could
    // not run, so it cannot certify OR condemn the build.
    if (r.error || r.status === 125 || r.status === 126 || r.status === 127) return 'error';
    return r.status === 0 ? 'pass' : 'fail';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    var argv     = process.argv.slice(2);
    var targets  = buildTargets(argv);
    var pkg      = readJSON(path.join(REPO_ROOT, 'package.json'));
    var isStable = pkg.version.indexOf('-') < 0;

    if (!targets.length) {
        process.stderr.write('\n' + red('No runtime targets selected.') + ' Pass --node=<versions> and/or --bun.\n');
        return 2;
    }

    process.stdout.write(bold('gina pre-release container smoke') + '\n');
    process.stdout.write('  candidate version : ' + pkg.version + (isStable ? ' (stable)' : ' (alpha)') + '\n');
    process.stdout.write('  targets           : ' + targets.map(function (t) { return t.label + (t.experimental ? ' (experimental)' : ''); }).join(', ') + '\n');

    // -- Docker reachable? (tooling precondition, not a smoke verdict) --
    var dockerVer = dockerServerVersion();
    if (!dockerVer) {
        process.stderr.write('\n' + red('Docker / OrbStack is not reachable.') + '\n' +
            '  Start OrbStack (or the Docker daemon) and re-run `npm run smoke`.\n');
        return 2;
    }
    process.stdout.write('  docker server     : ' + dockerVer + '\n');

    // -- Pack faithful bytes with NO commit side effect --
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-smoke-'));
    var tarball;
    try {
        tarball = pack(tmpDir);
    } catch (e) {
        process.stderr.write('\n' + red('Could not pack the candidate tarball: ') + (e.message || e) + '\n');
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
        return 2;
    }
    var sizeMb = (fs.statSync(tarball).size / (1024 * 1024)).toFixed(1);
    process.stdout.write('  packed tarball    : ' + path.basename(tarball) + ' (' + sizeMb + ' MB, --ignore-scripts -> no commit)\n');
    if (isStable) {
        process.stdout.write('  ' + bold('note') + '            : stable cut — testing pre-rename bytes (framework code identical; path-rewrite consistency is gated separately by checkDefFrameworkConsistency).\n');
    }
    if (targets.some(function (t) { return t.experimental; })) {
        process.stdout.write('  ' + bold('note') + '            : an experimental leg is present — it is non-blocking when a supported leg is also selected (progress only); its FAIL is informational.\n');
    }

    // -- Run the targets, sequentially --
    var results = targets.map(function (t) { return { target: t, status: runOne(t, tarball, pkg.version) }; });

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }

    // -- Results table --
    process.stdout.write('\n' + bold(BAR) + '\n' + bold('  Results') + '\n' + bold(BAR) + '\n');
    results.forEach(function (r) {
        var lbl = r.status === 'pass' ? green('PASS') : (r.status === 'fail' ? red('FAIL') : red('ERROR (could not run)'));
        process.stdout.write('  ' + r.target.label + (r.target.experimental ? ' (experimental)' : '') + '  ' + lbl + '\n');
    });
    process.stdout.write('\n');

    // -- Verdict. Supported legs (Node, and Bun) drive the release verdict. Any
    //    experimental leg (none today) is non-blocking when a supported leg is
    //    present; with only experimental legs they drive the exit. A real
    //    FAILURE outranks an ERROR.
    var supported = results.filter(function (r) { return !r.target.experimental; });
    var deciding  = supported.length ? supported : results;
    var failed    = deciding.filter(function (r) { return r.status === 'fail';  }).map(function (r) { return r.target.label; });
    var errored   = deciding.filter(function (r) { return r.status === 'error'; }).map(function (r) { return r.target.label; });
    var expNotPass = supported.length
        ? results.filter(function (r) { return r.target.experimental && r.status !== 'pass'; }).map(function (r) { return r.target.label; })
        : [];

    if (expNotPass.length) {
        process.stdout.write(bold('experimental: ') + expNotPass.join(', ') + ' did not pass (expected — Bun support in progress; see the leg output above).\n');
    }
    if (failed.length) {
        process.stdout.write(red('FAIL  SMOKE FAILED on ' + failed.join(', ') + ' — DO NOT PUBLISH gina ' + pkg.version + '.') + '\n' +
            '   Inspect the container output above for the failing step.\n');
        return 1;
    }
    if (errored.length) {
        process.stderr.write(red('COULD NOT RUN the smoke on ' + errored.join(', ') + ' — Docker could not create the container ') +
            '(image pull/extract failure, out of disk, etc.).\n' +
            '   This is a TOOLING error, not a verdict on gina ' + pkg.version + '. Resolve it (e.g. free disk / `docker system df`) and re-run.\n');
        return 2;
    }
    process.stdout.write(green('PASS  SMOKE PASSED — gina ' + pkg.version + ' installs and runs on ' +
        deciding.map(function (r) { return r.target.label; }).join(', ') + '.' + (supported.length ? ' Safe to publish.' : '')) + '\n');
    return 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { parseNodeVersions: parseNodeVersions, parseBun: parseBun, buildTargets: buildTargets, pack: pack, dockerServerVersion: dockerServerVersion, runOne: runOne, main: main };
