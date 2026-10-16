/**
 * #K8s7 — gina-container and a project without a usable manifest.json.
 *
 * The bundle reads `<project>/manifest.json` at boot (isBundleMounted() in
 * core/gna.js), so no launcher can start a bundle without it. gina-container
 * used to fall back to the bundle's mount link under `bundles/`, which a
 * checkout does not have, and reported that path as missing; when the link
 * existed, the bundle started and died on the manifest. Since 0.7.5 the
 * launcher stops with exit code 1: a missing file prints the two commands that
 * create it, any other manifest error prints
 * `manifest.json cannot be used: <reason>`.
 *
 * Both arms run the REAL bin/gina-init, then the REAL bin/gina-container, in a
 * throwaway home: HOME and GINA_HOMEDIR, the prefix and the run, log and tmp
 * dirs all point inside the temp dir. Arm 1 is a checkout's shape: the bundle's
 * sources, no manifest.json, no `bundles/` dir. Arm 2 has a manifest that
 * lists another bundle, and an entry under `bundles/` that leaves a marker file
 * if anything starts it.
 *
 * Module-path seam: GINA_K8S7_TREE points the test at another tree (a
 * `git archive` copy of the pre-fix tree) for the red-first run.
 *
 * Run: node --test test/bin/gina-container-manifest-k8s7.test.js
 */
'use strict';

var assert = require('node:assert');
var { describe, it, before, after } = require('node:test');
var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { spawnSync } = require('child_process');

var TREE      = process.env.GINA_K8S7_TREE || path.resolve(__dirname, '..', '..');
var CONTAINER = path.join(TREE, 'bin', 'gina-container');
var GINA_INIT = path.join(TREE, 'bin', 'gina-init');
var TMP       = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-k8s7-'));
var BUNDLE    = 'demo';

/**
 * The child environment: the runner's environment without its gina, node and
 * npm overrides, with every gina path pinned inside the temp dir.
 *
 * @inner
 * @param {string} home - The arm's HOME
 * @param {object} [extra] - Variables to add (gina-init's inputs)
 * @returns {object} The environment
 */
function childEnv(home, extra) {
    var env = {};
    Object.keys(process.env).forEach(function (k) {
        if (!/^(GINA_|NODE_OPTIONS$|NODE_ENV$|NODE_SCOPE$|NPM_CONFIG_PREFIX$|npm_config_prefix$)/.test(k)) {
            env[k] = process.env[k];
        }
    });
    env.HOME         = home;
    env.GINA_HOMEDIR = path.join(home, '.gina');
    env.GINA_PREFIX  = path.join(TMP, 'prefix');
    env.GINA_RUNDIR  = path.join(TMP, 'run');
    env.GINA_LOGDIR  = path.join(TMP, 'log');
    env.GINA_TMPDIR  = path.join(TMP, 'tmp');
    return Object.assign(env, extra || {});
}

/**
 * Bootstraps a home with the real gina-init, then runs the real gina-container
 * for the `demo` bundle in it.
 *
 * @inner
 * @param {string} project - The project name; also names the arm's home dir
 * @param {string} root - The project root
 * @returns {{ init: object, run: object, out: string }} Both spawnSync results,
 *   and the launcher's stdout and stderr joined
 */
function runArm(project, root) {
    var home = path.join(TMP, project + '-home');
    fs.mkdirSync(home, { recursive: true });
    var init = spawnSync(process.execPath, [GINA_INIT], {
        env      : childEnv(home, {
            GINA_PROJECT_NAME : project,
            GINA_BUNDLES      : BUNDLE,
            GINA_PROJECT_PATH : root
        }),
        cwd      : home,
        encoding : 'utf8',
        timeout  : 30000
    });
    var run = spawnSync(process.execPath, [CONTAINER, BUNDLE, '@' + project], {
        env      : childEnv(home),
        cwd      : home,
        encoding : 'utf8',
        timeout  : 30000
    });
    return { init: init, run: run, out: (run.stdout || '') + (run.stderr || '') };
}

/**
 * Renders a spawnSync result for an assertion message.
 *
 * @inner
 * @param {object} r - A spawnSync result
 * @returns {string} Status, signal and the output tail
 */
function detail(r) {
    return '\n  status=' + r.status + ' signal=' + r.signal +
        (r.error ? ' error=' + r.error.message : '') +
        '\n  stdout: ' + String(r.stdout || '').slice(-800) +
        '\n  stderr: ' + String(r.stderr || '').slice(-800);
}

describe('#K8s7 - gina-container and a project without a usable manifest.json', function () {

    var ROOT_A = path.join(TMP, 'proj-a');      // a checkout: sources, no manifest.json, no bundles/
    var ROOT_B = path.join(TMP, 'proj-b');      // a manifest that lists another bundle
    var MARKER = path.join(TMP, 'started-b');   // written if anything starts arm 2's bundles/ entry
    var a, b;

    before(function () {
        ['prefix', 'run', 'log', 'tmp'].forEach(function (d) {
            fs.mkdirSync(path.join(TMP, d));
        });
        fs.mkdirSync(path.join(ROOT_A, 'src', BUNDLE), { recursive: true });
        fs.writeFileSync(path.join(ROOT_A, 'src', BUNDLE, 'index.js'), '// the bundle\n');

        fs.mkdirSync(path.join(ROOT_B, 'bundles', BUNDLE), { recursive: true });
        fs.writeFileSync(path.join(ROOT_B, 'manifest.json'), JSON.stringify({
            bundles: { other: { version: '0.0.1', src: 'src/other', link: 'bundles/other' } }
        }, null, 2) + '\n');
        fs.writeFileSync(path.join(ROOT_B, 'bundles', BUNDLE, 'index.js'),
            'require(\'fs\').writeFileSync(' + JSON.stringify(MARKER) + ', \'started\');\n');

        a = runArm('k8s7a', ROOT_A);
        b = runArm('k8s7b', ROOT_B);
    });

    after(function () {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    it('gina-init bootstraps both homes', function () {
        assert.strictEqual(a.init.status, 0, 'arm 1 gina-init:' + detail(a.init));
        assert.strictEqual(b.init.status, 0, 'arm 2 gina-init:' + detail(b.init));
    });

    describe('arm 1 - no manifest.json (a checkout)', function () {

        it('exits 1', function () {
            assert.strictEqual(a.run.status, 1, detail(a.run));
        });

        it('says manifest.json is missing from the project root and prints the two commands that create it', function () {
            var expected =
                '[ gina-container ] manifest.json not found in ' + ROOT_A + '\n' +
                '  The bundle reads it at boot. Commit it with the project, or create it in the image:\n' +
                '    gina project:add @k8s7a --path=' + ROOT_A + '\n' +
                '    gina bundle:add demo @k8s7a --import\n';
            assert.ok(a.out.indexOf(expected) > -1, 'expected:\n' + expected + detail(a.run));
        });

        it('names no bundles/ path and starts nothing', function () {
            assert.doesNotMatch(a.out, /\/bundles\//, detail(a.run));
            assert.doesNotMatch(a.out, /\[ gina-container \] Starting /, detail(a.run));
        });
    });

    describe('arm 2 - a manifest.json without the bundle', function () {

        it('exits 1', function () {
            assert.strictEqual(b.run.status, 1, detail(b.run));
        });

        it('says manifest.json cannot be used, and why', function () {
            var expected = '[ gina-container ] manifest.json cannot be used: bundle `demo` not found in manifest.json\n';
            assert.ok(b.out.indexOf(expected) > -1, 'expected:\n' + expected + detail(b.run));
        });

        it('names no bundles/ path and never starts the bundles/ entry', function () {
            assert.doesNotMatch(b.out, /\/bundles\//, detail(b.run));
            assert.doesNotMatch(b.out, /\[ gina-container \] Starting /, detail(b.run));
            assert.strictEqual(fs.existsSync(MARKER), false, 'the bundles/ entry ran' + detail(b.run));
        });
    });
});
