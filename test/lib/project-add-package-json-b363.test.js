/**
 * #B363 — `gina project:add` and the project's package.json.
 *
 * An EXISTING package.json is the project's own manifest: since 0.7.5
 * project:add leaves it as it is. It used to rewrite it with the template
 * winning every shared key (name, description, engines.node), re-indented,
 * without its final newline and made executable. A NEW package.json gets
 * gina's own Node floor in engines.node (the lower bound of gina's
 * engines.node), not the version of the Node running the command, and is
 * written at mode 0644 with a final newline.
 *
 * Both arms run the REAL bin/cli project:add in a throwaway HOME (the
 * project-add-link-order-b647 shape: the CLI bootstraps its own ~/.gina, and
 * GINA_HOMEDIR is removed so it cannot inherit the developer's), with the
 * run, log and tmp dirs and the MQ port pinned inside the temp dir.
 *
 * Module-path seam: GINA_B363_TREE points the test at another tree (a
 * `git archive` copy of the pre-fix tree) for the red-first run.
 *
 * Run: node --test test/lib/project-add-package-json-b363.test.js
 */
'use strict';

var assert = require('node:assert');
var { describe, it, before, after } = require('node:test');
var fs   = require('fs');
var os   = require('os');
var path = require('path');
var net  = require('net');
var { spawnSync } = require('child_process');

var TREE = process.env.GINA_B363_TREE || path.resolve(__dirname, '../..');
var CLI  = path.join(TREE, 'bin', 'cli');
var TMP  = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b363-'));
var HOME = path.join(TMP, 'home');

// gina's own Node floor: the lower bound of engines.node in gina's package.json.
var GINA_RANGE = String(require(path.join(TREE, 'package.json')).engines.node);
var FLOOR      = (/^\s*>=\s*v?(\d+(?:\.\d+){0,2})/.exec(GINA_RANGE) || [])[1];

// A project's own manifest, in npm's format (2-space indent, final newline),
// with values a template merge would replace.
var EXISTING = [
    '{',
    '  "name": "sentinel-name",',
    '  "version": "2.3.4",',
    '  "description": "SENTINEL-DESCRIPTION",',
    '  "scripts": {',
    '    "start": "node index.js"',
    '  },',
    '  "engines": {',
    '    "node": ">=18"',
    '  },',
    '  "dependencies": {',
    '    "left-pad": "1.3.0"',
    '  }',
    '}',
    ''
].join('\n');

var STAMP  = Date.now();
var PROJ_A = 'b363a' + STAMP;   // existing package.json
var PROJ_B = 'b363b' + STAMP;   // no package.json
var DIR_A  = path.join(TMP, 'proj-a');
var DIR_B  = path.join(TMP, 'proj-b');

/**
 * A free TCP port on the loopback, for the CLI's MQ listener.
 *
 * @inner
 * @returns {Promise<number>}
 */
function freePort() {
    return new Promise(function (resolve, reject) {
        var srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', function () {
            var port = srv.address().port;
            srv.close(function () { resolve(port); });
        });
    });
}

/**
 * Runs the real `bin/cli project:add @<name> --path=<dir>` in the throwaway HOME.
 *
 * @inner
 * @param {string} name - Project name
 * @param {string} dir - Project directory
 * @param {number} mqPort - Free port for the MQ listener
 * @returns {{ status: (number|null), signal: (string|null), out: string }}
 */
function runAdd(name, dir, mqPort) {
    var env = Object.assign({}, process.env, {
        HOME            : HOME,
        GINA_LOG_STDOUT : 'true',
        GINA_MQ_PORT    : String(mqPort),
        GINA_PREFIX     : path.join(TMP, 'prefix'),
        GINA_RUNDIR     : path.join(TMP, 'run'),
        GINA_LOGDIR     : path.join(TMP, 'log'),
        GINA_TMPDIR     : path.join(TMP, 'tmp')
    });
    delete env.GINA_HOMEDIR;
    var r = spawnSync(process.execPath, [CLI, 'project:add', '@' + name, '--path=' + dir], {
        env: env, cwd: HOME, encoding: 'utf8', timeout: 90000
    });
    return { status: r.status, signal: r.signal, out: (r.stdout || '') + (r.stderr || '') };
}

/**
 * The permission bits of a file.
 *
 * @inner
 * @param {string} p - File path
 * @returns {number}
 */
function modeOf(p) {
    return fs.statSync(p).mode & parseInt('777', 8);
}

describe('#B363 - project:add and the project\'s package.json', function () {

    var runA, runB;

    before(function () {
        ['home', 'prefix', 'run', 'log', 'tmp', 'proj-a', 'proj-b'].forEach(function (d) {
            fs.mkdirSync(path.join(TMP, d), { recursive: true });
        });
        fs.writeFileSync(path.join(DIR_A, 'package.json'), EXISTING);
        fs.chmodSync(path.join(DIR_A, 'package.json'), parseInt('644', 8));
        return freePort().then(function (mqPort) {
            runA = runAdd(PROJ_A, DIR_A, mqPort);
            runB = runAdd(PROJ_B, DIR_B, mqPort);
        });
    });

    after(function () {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    describe('an existing package.json', function () {

        it('project:add registers the project and exits 0', function () {
            assert.strictEqual(runA.signal, null, 'the command hung and was killed:\n' + runA.out);
            assert.strictEqual(runA.status, 0, runA.out);
            assert.match(runA.out, new RegExp('Project \\[ ' + PROJ_A + ' \\] has been added'), runA.out);
        });

        it('is left byte for byte as it was', function () {
            assert.strictEqual(fs.readFileSync(path.join(DIR_A, 'package.json'), 'utf8'), EXISTING);
        });

        it('keeps its mode 0644', function () {
            assert.strictEqual(modeOf(path.join(DIR_A, 'package.json')).toString(8), '644');
        });
    });

    describe('a new package.json', function () {

        var raw, pkg;

        before(function () {
            raw = fs.readFileSync(path.join(DIR_B, 'package.json'), 'utf8');
            pkg = JSON.parse(raw);
        });

        it('project:add registers the project and exits 0', function () {
            assert.strictEqual(runB.signal, null, 'the command hung and was killed:\n' + runB.out);
            assert.strictEqual(runB.status, 0, runB.out);
            assert.match(runB.out, new RegExp('Project \\[ ' + PROJ_B + ' \\] has been added'), runB.out);
        });

        it('is named after the project', function () {
            assert.strictEqual(pkg.name, PROJ_B);
        });

        it('carries gina\'s own Node floor in engines.node, not the running Node', function () {
            assert.ok(FLOOR, 'could not read a floor from gina\'s engines.node: ' + GINA_RANGE);
            assert.strictEqual(pkg.engines && pkg.engines.node, '>=' + FLOOR);
        });

        it('ends with a newline and keeps the 4-space indent', function () {
            assert.ok(raw.endsWith('\n'), 'no final newline: ' + JSON.stringify(raw.slice(-20)));
            assert.ok(raw.indexOf('\n    "name"') > -1, 'not a 4-space indent: ' + raw);
        });

        it('is written at mode 0644', function () {
            assert.strictEqual(modeOf(path.join(DIR_B, 'package.json')).toString(8), '644');
        });
    });
});
