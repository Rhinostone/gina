/**
 * #B903 — the boot error of an https bundle that cannot read its certificates.
 *
 * `core/server.isaac.js` logs « You are trying to start a secured server
 * (https) … credentials: check your `server settings` » with the error's stack,
 * then exits 1, when it cannot read `server.credentials`. The message misspelled
 * « without sufficient », so the troubleshooting guide's quote of it matched no
 * log line. The default credential paths are
 * `${GINA_HOMEDIR}/certificates/scopes/${scope}/${host}/…`.
 *
 * bin/cli scaffolds a project in its own throwaway home; then each arm runs the
 * REAL bin/gina-init and bin/gina-container over https in a fresh home:
 *   §01 control: certificates at HOME/.gina/certificates/scopes/local/localhost/
 *       (gina-init's defaults resolve ${scope} to local and ${host} to
 *       localhost) → the bundle boots and answers 200 over TLS;
 *   §02 no certificates → exit 1, the message spelled correctly, and the
 *       ENOENT naming the private.key path under HOME/.gina/certificates/.
 *
 * Run: node --test test/core/server-https-credentials-b903.test.js
 */
'use strict';

var net    = require('net');
var https  = require('https');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawn, spawnSync, execFileSync } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var TREE      = path.resolve(__dirname, '..', '..');
var CLI       = path.join(TREE, 'bin', 'cli');
var GINA_INIT = path.join(TREE, 'bin', 'gina-init');
var CONTAINER = path.join(TREE, 'bin', 'gina-container');
var TMP       = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b903-'));
var PROJ      = 'b903' + String(Date.now()).slice(-6);
var BUNDLE    = 'demo';
var ROOT      = path.join(TMP, 'proj');
var PORT_START = 12900;

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
 * GETs a path over TLS (the self-signed certificate accepted) and resolves its
 * status code, or an error text.
 *
 * @inner
 * @param {number} port
 * @param {string} reqPath
 * @returns {Promise<(number|string)>}
 */
function httpsGet(port, reqPath) {
    return new Promise(function (resolve) {
        var req = https.request({ host: '127.0.0.1', port: port, path: reqPath, method: 'GET', rejectUnauthorized: false }, function (res) {
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
 * Writes a self-signed key and certificate, and the certificate again as the
 * CA bundle, to the three file names of the default credential paths.
 *
 * @inner
 * @param {string} dir
 * @returns {void}
 */
function writeCertificates(dir) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', path.join(dir, 'private.key'), '-out', path.join(dir, 'certificate.crt'),
        '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    fs.copyFileSync(path.join(dir, 'certificate.crt'), path.join(dir, 'ca_bundle.crt'));
}

/**
 * Runs gina-init for an https bundle, then boots it with gina-container, waits
 * until it binds its port or exits, GETs its webroot over TLS, stops it and
 * waits for the port to close.
 *
 * @inner
 * @param {string} home - The arm's HOME (gina-init writes HOME/.gina)
 * @returns {Promise<{init: object, bound: boolean, exit: (object|null), get: (number|string|null), out: string}>}
 */
async function runArm(home) {
    fs.mkdirSync(home, { recursive: true });
    var init = spawnSync(process.execPath, [GINA_INIT], {
        env: childEnv(home, {
            GINA_PROJECT_NAME : PROJ,
            GINA_BUNDLES      : BUNDLE,
            GINA_PROJECT_PATH : ROOT,
            GINA_DEF_PROTOCOL : 'http/1.1',
            GINA_DEF_SCHEME   : 'https',
            GINA_PORT_START   : String(PORT_START),
            GINA_LOG_STDOUT   : 'true'
        }),
        encoding: 'utf8', timeout: 60000
    });
    var port = PORT_START;
    try {
        port = readConfig(path.join(home, '.gina', 'ports.reverse.json'))[BUNDLE + '@' + PROJ]['dev']['http/1.1']['https'];
    } catch (e) { /* gina-init's own port start */ }

    var out = '';
    var exit = null;
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], {
        env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe']
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
    var get = bound ? await httpsGet(port, '/' + BUNDLE + '/') : null;

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
        ' get=' + JSON.stringify(r.get) + '\n  output tail: ' + String(r.out).slice(-1200);
}

describe('#B903 - the boot error of an https bundle without readable certificates', function () {

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
        writeCertificates(path.join(homes.control, '.gina', 'certificates', 'scopes', 'local', 'localhost'));
        arms.control = await runArm(homes.control);

        homes.missing = path.join(TMP, 'home-missing');
        arms.missing = await runArm(homes.missing);
    });

    after(function () {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    it('the project scaffolds', { skip: skip }, function () {
        assert.equal(setupError, null, setupError);
    });

    describe('01 - control: certificates under HOME/.gina/certificates/', function () {

        it('the https bundle boots and answers 200 over TLS', { skip: skip }, function () {
            assert.equal(arms.control.init.status, 0, detail(arms.control));
            assert.equal(arms.control.bound, true, detail(arms.control));
            assert.equal(arms.control.get, 200, detail(arms.control));
        });

        it('logs no credentials error', { skip: skip }, function () {
            assert.equal(/secured server \(https\)/.test(arms.control.out), false, detail(arms.control));
        });
    });

    describe('02 - no certificates', function () {

        it('the bundle stops at boot with exit code 1', { skip: skip }, function () {
            assert.equal(arms.missing.init.status, 0, detail(arms.missing));
            assert.equal(arms.missing.bound, false, detail(arms.missing));
            assert.deepEqual(arms.missing.exit, { code: 1, signal: null }, detail(arms.missing));
        });

        it('the error reads « secured server (https) without sufficient credentials », as the troubleshooting guide quotes it', { skip: skip }, function () {
            assert.equal(arms.missing.out.indexOf('You are trying to start a secured server (https) without sufficient credentials: check your `server settings`') > -1, true, detail(arms.missing));
            assert.equal(/wihtout|suficient/.test(arms.missing.out), false, 'the misspelled words are still logged' + detail(arms.missing));
        });

        it('the ENOENT names the private.key path under HOME/.gina/certificates/', { skip: skip }, function () {
            var keyPath = path.join(homes.missing, '.gina', 'certificates', 'scopes', 'local', 'localhost', 'private.key');
            assert.equal(arms.missing.out.indexOf('ENOENT') > -1, true, detail(arms.missing));
            assert.equal(arms.missing.out.indexOf(keyPath) > -1, true, 'expected ' + keyPath + detail(arms.missing));
        });
    });
});
