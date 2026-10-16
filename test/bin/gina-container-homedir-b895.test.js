/**
 * #B895 — bin/gina-container reads GINA_HOMEDIR, as bin/gina-init writes it.
 *
 * gina-init writes the home to `$GINA_HOMEDIR` when the environment sets it
 * (the K8s and Docker guide documents the variable). gina-container read its
 * home through getEnvVar(), which consults `process.gina` only, and the
 * launcher never imports the environment into it: with GINA_HOMEDIR set, it
 * read HOME/.gina instead and stopped with « …/.gina/projects.json not found »,
 * exit 1.
 *
 * bin/cli scaffolds a project in its own throwaway home; then each arm runs the
 * REAL bin/gina-init and bin/gina-container in a fresh home:
 *   §01 control, GINA_HOMEDIR unset: the bundle boots and answers 200;
 *   §02 GINA_HOMEDIR=<home>/custom-home: gina-init writes there and nothing to
 *       HOME/.gina, and the bundle boots from it and answers 200.
 *
 * Run: node --test test/bin/gina-container-homedir-b895.test.js
 */
'use strict';

var net    = require('net');
var http   = require('http');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawn, spawnSync } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var TREE      = path.resolve(__dirname, '..', '..');
var CLI       = path.join(TREE, 'bin', 'cli');
var GINA_INIT = path.join(TREE, 'bin', 'gina-init');
var CONTAINER = path.join(TREE, 'bin', 'gina-container');
var TMP       = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b895-'));
var PROJ      = 'b895' + String(Date.now()).slice(-6);
var BUNDLE    = 'demo';
var ROOT      = path.join(TMP, 'proj');
var PORT_START = 12750;

var BOOT_TIMEOUT_MS  = 25000;
var POLL_INTERVAL_MS = 250;

/**
 * Builds a child environment: the runner's, without its GINA_* and Node
 * settings (`bun test` injects NODE_ENV), with HOME pinned to the arm's home.
 *
 * @inner
 * @param {string} home - The arm's HOME
 * @param {object} [extra] - Variables to add
 * @returns {object}
 */
function childEnv(home, extra) {
    var env = {};
    Object.keys(process.env).forEach(function (k) {
        if (!/^(GINA_|NODE_OPTIONS$|NODE_ENV$|NODE_SCOPE$|NPM_CONFIG_PREFIX$|npm_config_prefix$)/.test(k)) {
            env[k] = process.env[k];
        }
    });
    env.HOME = home;
    return Object.assign(env, extra || {});
}

/**
 * Resolves true when something accepts a TCP connection on the port.
 *
 * @inner
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortOpen(port) {
    return new Promise(function (resolve) {
        var sock = new net.Socket();
        sock.setTimeout(500);
        sock.on('connect', function () { sock.destroy(); resolve(true); });
        sock.on('error',   function () { resolve(false); });
        sock.on('timeout', function () { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
    });
}

/**
 * @inner
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * GETs a path over plain HTTP and resolves its status code, or an error text.
 *
 * @inner
 * @param {number} port
 * @param {string} reqPath
 * @returns {Promise<(number|string)>}
 */
function httpGet(port, reqPath) {
    return new Promise(function (resolve) {
        var req = http.request({ host: '127.0.0.1', port: port, path: reqPath, method: 'GET' }, function (res) {
            res.resume();
            res.on('end', function () { resolve(res.statusCode); });
        });
        req.on('error', function (e) { resolve('request error: ' + e.message); });
        req.end();
    });
}

/**
 * Parses a gina config file, dropping full-line `//` comments.
 *
 * @inner
 * @param {string} file
 * @returns {object}
 */
function readConfig(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').split('\n').filter(function (l) {
        return !/^\s*\/\//.test(l);
    }).join('\n'));
}

/**
 * Runs gina-init, then boots the bundle with gina-container, waits until it
 * binds its port or exits, GETs its webroot, stops it and waits for the port
 * to close.
 *
 * @inner
 * @param {string} home - The arm's HOME
 * @param {string} ginaHome - Where gina-init is expected to write the home
 * @param {object} [extra] - Variables both launchers get (e.g. GINA_HOMEDIR)
 * @returns {Promise<{init: object, bound: boolean, exit: (object|null), get: (number|string|null), out: string}>}
 */
async function runArm(home, ginaHome, extra) {
    fs.mkdirSync(home, { recursive: true });
    var init = spawnSync(process.execPath, [GINA_INIT], {
        env: childEnv(home, Object.assign({
            GINA_PROJECT_NAME : PROJ,
            GINA_BUNDLES      : BUNDLE,
            GINA_PROJECT_PATH : ROOT,
            GINA_DEF_PROTOCOL : 'http/1.1',
            GINA_DEF_SCHEME   : 'http',
            GINA_PORT_START   : String(PORT_START),
            GINA_LOG_STDOUT   : 'true'
        }, extra)),
        encoding: 'utf8', timeout: 60000
    });
    var port = PORT_START;
    try {
        port = readConfig(path.join(ginaHome, 'ports.reverse.json'))[BUNDLE + '@' + PROJ]['dev']['http/1.1']['http'];
    } catch (e) { /* gina-init's own port start */ }

    var out = '';
    var exit = null;
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], {
        env: childEnv(home, extra), stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { out += d; });
    child.on('exit', function (code, signal) { exit = { code: code, signal: signal }; });

    var bound = false;
    var deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await isPortOpen(port)) { bound = true; break; }
        if (exit) break;
        await sleep(POLL_INTERVAL_MS);
    }
    if (!bound) await sleep(300);
    var get = bound ? await httpGet(port, '/' + BUNDLE + '/') : null;

    if (!exit) {
        try { child.kill('SIGTERM'); } catch (e) { /* already gone */ }
        var until = Date.now() + 4000;
        while (!exit && Date.now() < until) await sleep(100);
        if (!exit) { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }
    }
    var closedBy = Date.now() + 5000;
    while (Date.now() < closedBy && await isPortOpen(port)) await sleep(100);

    return { init: init, bound: bound, exit: exit, get: get, out: out };
}

/**
 * Renders an arm result for an assertion message.
 *
 * @inner
 * @param {object} r - A runArm() result
 * @returns {string}
 */
function detail(r) {
    if (!r) return '\n  (arm did not run)';
    return '\n  init status=' + r.init.status + ' bound=' + r.bound + ' exit=' + JSON.stringify(r.exit) +
        ' get=' + JSON.stringify(r.get) + '\n  output tail: ' + String(r.out).slice(-800);
}

describe('#B895 - gina-container reads GINA_HOMEDIR, as gina-init writes it', function () {

    var skip = (process.platform === 'win32') ? 'gina-init and gina-container are Unix-centric' : false;   // false, not null: node:test skips a test given `skip: null`
    var setupError = null;
    var arms = {};
    var homes = {};

    before(async function () {
        if (skip) return;
        var scaffoldHome = path.join(TMP, 'scaffold-home');
        fs.mkdirSync(ROOT, { recursive: true });
        fs.mkdirSync(scaffoldHome, { recursive: true });
        var senv = childEnv(scaffoldHome, { GINA_LOG_STDOUT: 'true' });
        spawnSync(process.execPath, [CLI, 'project:add', '@' + PROJ, '--path=' + ROOT], { env: senv, encoding: 'utf8', timeout: 60000 });
        spawnSync(process.execPath, [CLI, 'bundle:add', BUNDLE, '@' + PROJ], { env: senv, encoding: 'utf8', timeout: 60000 });
        if (!fs.existsSync(path.join(ROOT, 'manifest.json')) || !fs.existsSync(path.join(ROOT, 'src', BUNDLE, 'index.js'))) {
            setupError = 'bin/cli did not scaffold @' + PROJ + ' with bundle ' + BUNDLE;
            return;
        }

        homes.control = path.join(TMP, 'home-control');
        arms.control = await runArm(homes.control, path.join(homes.control, '.gina'));

        homes.custom = path.join(TMP, 'home-custom');
        homes.customGina = path.join(homes.custom, 'custom-home');
        arms.custom = await runArm(homes.custom, homes.customGina, { GINA_HOMEDIR: homes.customGina });
    });

    after(function () {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    it('the project scaffolds', { skip: skip }, function () {
        assert.equal(setupError, null, setupError);
    });

    describe('01 - control: GINA_HOMEDIR unset', function () {

        it('gina-init writes HOME/.gina and the bundle boots, answering 200', { skip: skip }, function () {
            assert.equal(arms.control.init.status, 0, detail(arms.control));
            assert.equal(fs.existsSync(path.join(homes.control, '.gina', 'projects.json')), true, detail(arms.control));
            assert.equal(arms.control.bound, true, detail(arms.control));
            assert.equal(arms.control.get, 200, detail(arms.control));
        });
    });

    describe('02 - GINA_HOMEDIR set', function () {

        it('gina-init writes the home there, and nothing to HOME/.gina', { skip: skip }, function () {
            assert.equal(arms.custom.init.status, 0, detail(arms.custom));
            assert.equal(fs.existsSync(path.join(homes.customGina, 'projects.json')), true, detail(arms.custom));
            assert.equal(fs.existsSync(path.join(homes.custom, '.gina', 'projects.json')), false, detail(arms.custom));
        });

        it('gina-container reads that home: the bundle boots and answers 200', { skip: skip }, function () {
            assert.equal(arms.custom.bound, true, 'the launcher did not read GINA_HOMEDIR' + detail(arms.custom));
            assert.equal(arms.custom.get, 200, detail(arms.custom));
        });
    });
});
