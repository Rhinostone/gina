/**
 * script/smoke_test_tarball.js + script/smoke_in_container.js — gate tests.
 *
 * The pre-release container smoke gate packs the candidate tarball and boots it
 * in a clean node:NN container. These tests cover the parts that DON'T need
 * Docker: the pure argv parser (require the orchestrator — it is guarded behind
 * `require.main === module`, so requiring it never runs a smoke), plus
 * source-pins on the load-bearing safety invariants of BOTH scripts:
 *
 *   - the orchestrator packs with `--ignore-scripts` (so `npm pack` never
 *     re-enters the `prepare` hook and commits a "Prerelease update");
 *   - the default Node matrix mirrors CI (22, 24, 26);
 *   - the in-container script boots via the daemonless `gina-container`, NOT
 *     `gina bundle:start` (which would need the port-8124 daemon a container
 *     does not run);
 *   - it reads the bound port from ports.reverse.json (the resolved port can
 *     differ from the requested --start-port-from) and asserts HTTP 200 + the
 *     greeting.
 *
 * `smoke_in_container.js` is NEVER require()'d here — it calls `main()` on load
 * (which would run `npm install -g`); it is only read as text for source-pins.
 */

'use strict';

var fs       = require('fs');
var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var ORCH_PATH = nodePath.join(__dirname, '..', '..', 'script', 'smoke_test_tarball.js');
var CONT_PATH = nodePath.join(__dirname, '..', '..', 'script', 'smoke_in_container.js');
var ORCH      = require(ORCH_PATH);                 // safe — guarded by require.main === module
var ORCH_SRC  = fs.readFileSync(ORCH_PATH, 'utf8');
var CONT_SRC  = fs.readFileSync(CONT_PATH, 'utf8'); // text only — must NOT be require()'d


describe('smoke gate — parseNodeVersions (pure)', function () {

    it('defaults to the CI matrix 22, 24, 26 when --node is absent', function () {
        assert.deepEqual(ORCH.parseNodeVersions([]), ['22', '24', '26']);
        assert.deepEqual(ORCH.parseNodeVersions(['--other', 'x']), ['22', '24', '26']);
    });

    it('parses a single --node=22', function () {
        assert.deepEqual(ORCH.parseNodeVersions(['--node=22']), ['22']);
    });

    it('parses a comma-separated subset --node=22,24', function () {
        assert.deepEqual(ORCH.parseNodeVersions(['--node=22,24']), ['22', '24']);
    });

    it('trims whitespace and drops empty entries', function () {
        assert.deepEqual(ORCH.parseNodeVersions(['--node=22, 24 ,']), ['22', '24']);
    });

    it('last --node wins when passed more than once', function () {
        assert.deepEqual(ORCH.parseNodeVersions(['--node=22', '--node=26']), ['26']);
    });
});


describe('smoke gate — orchestrator source invariants', function () {

    it('packs with --ignore-scripts (no "Prerelease update" commit side effect)', function () {
        // The whole no-side-effect property hinges on this flag — pin it.
        assert.match(ORCH_SRC, /'pack',\s*'--ignore-scripts'/);
    });

    it('packs into a throwaway temp dir, never the repo root', function () {
        assert.match(ORCH_SRC, /mkdtempSync/);
        assert.match(ORCH_SRC, /--pack-destination/);
    });

    it('default Node matrix mirrors CI (22, 24, 26)', function () {
        assert.deepEqual(ORCH.parseNodeVersions([]), ['22', '24', '26']);
        assert.match(ORCH_SRC, /DEFAULT_NODE_VERSIONS\s*=\s*\['22',\s*'24',\s*'26'\]/);
    });

    it('runs disposable --rm containers and never publishes/commits (call-form pins)', function () {
        assert.match(ORCH_SRC, /'run',\s*'--rm'/);
        // Pin the absence of a real publish/git INVOCATION, not the docstring that
        // mentions them in prose (the jsdoc.md negative-pin trap).
        assert.doesNotMatch(ORCH_SRC, /['"]publish['"]/);
        assert.doesNotMatch(ORCH_SRC, /spawnSync\(\s*['"]git['"]/);
    });

    it('exits 2 (tooling error, not a smoke verdict) when Docker is unreachable', function () {
        // dockerServerVersion() returns null when unreachable; main() returns 2.
        assert.match(ORCH_SRC, /dockerServerVersion\(\)/);
        assert.match(ORCH_SRC, /return 2;/);
    });

    it('exposes the testable surface without running a smoke on require', function () {
        assert.equal(typeof ORCH.parseNodeVersions, 'function');
        assert.equal(typeof ORCH.pack, 'function');
        assert.equal(typeof ORCH.dockerServerVersion, 'function');
        assert.equal(typeof ORCH.main, 'function');
    });
});


describe('smoke gate — in-container source invariants', function () {

    it('boots via the daemonless gina-container, NOT gina bundle:start', function () {
        assert.match(CONT_SRC, /spawn\('gina-container'/);
        // Pin the absence of a real bundle:start CALL — the header comment
        // legitimately mentions `gina bundle:start` to explain why it is avoided
        // (the jsdoc.md negative-pin trap: match the call form, not the prose).
        assert.doesNotMatch(CONT_SRC, /gina\(\[\s*['"]bundle:start/);
    });

    it('reads the resolved bound port from ports.reverse.json (not the requested hint)', function () {
        assert.match(CONT_SRC, /ports\.reverse\.json/);
        assert.match(CONT_SRC, /portsReverse\[\s*\w+\s*\]\[env\]\[proto\]\[scheme\]/);
    });

    it('verifies scaffolding via on-disk state files, not CLI exit codes', function () {
        // The first-run home bootstrap exits non-zero on a benign MQ ECONNRESET,
        // so success must be checked via projects.json / ports.reverse.json.
        assert.match(CONT_SRC, /projects\.json/);
        assert.match(CONT_SRC, /readJSON\(projectsPath\)\[PROJECT\]/);
    });

    it('scaffolds exactly the two requested bundles: api + frontend', function () {
        assert.match(CONT_SRC, /BUNDLES\s*=\s*\['api',\s*'frontend'\]/);
    });

    it('asserts HTTP 200 with the boilerplate greeting', function () {
        assert.match(CONT_SRC, /res\.status\s*!==\s*200/);
        assert.match(CONT_SRC, /GREETING\s*=\s*'Hello World'/);
        assert.match(CONT_SRC, /res\.body\.indexOf\(GREETING\)\s*<\s*0/);
    });

    it('installs the candidate globally (exercises the install scripts)', function () {
        assert.match(CONT_SRC, /'install',\s*'-g',\s*TARBALL/);
    });
});
