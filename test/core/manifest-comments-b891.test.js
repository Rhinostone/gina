/**
 * #B891 — every reader of manifest.json accepts comments, as requireJSON does.
 *
 * Six readers parsed the project's manifest.json with requireJSON, which
 * accepts `//` lines and docblock comments, and nine parsed it strictly (plain
 * require() in the bundle and project commands and in gna.js, JSON.parse in
 * gina-container and project:restore). With one `//` line in the file,
 * bundle:list crashed, bundle:status reported the bundle missing from its
 * project, project:status printed nothing, and gina-container refused to
 * start the bundle. The strict readers now parse with parseJSONWithComments(),
 * which strips comments as requireJSON does and throws an Error naming the
 * file instead of exiting the process.
 *
 *   §01 parseJSONWithComments() parses what requireJSON parses, and throws an
 *       Error naming the file, with the JSON error as its cause, on text that
 *       is still not JSON;
 *   §02 bundle:list, bundle:status and project:status (bin/cli, no daemon)
 *       give the same result for a manifest with a comment line as for the
 *       plain file;
 *   §03 gina-container starts the bundle of a project whose manifest carries a
 *       comment line, and the bundle answers 200;
 *   §04 a manifest that is still not JSON stops gina-container with
 *       « manifest.json cannot be used: could not parse `<file>`: … ».
 *
 * Run: node --test test/core/manifest-comments-b891.test.js
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

var FW        = require('../fw');
var TREE      = path.resolve(__dirname, '..', '..');
var CLI       = path.join(TREE, 'bin', 'cli');
var GINA_INIT = path.join(TREE, 'bin', 'gina-init');
var CONTAINER = path.join(TREE, 'bin', 'gina-container');
var TMP       = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b891-'));
var PROJ      = 'b891' + String(Date.now()).slice(-6);
var BUNDLE    = 'demo';
var ROOT      = path.join(TMP, 'proj');
var MANIFEST  = path.join(ROOT, 'manifest.json');
var PORT_START = 12970;

require(path.join(FW, 'helpers', 'json', 'src', 'main.js'))();

/**
 * Builds a child environment: the runner's, without its GINA_* and Node
 * settings (`bun test` injects NODE_ENV), with HOME pinned to the given home.
 *
 * @inner
 * @param {string} home
 * @param {object} [extra]
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
    return Object.assign(env, { GINA_LOG_STDOUT: 'true' }, extra || {});
}

/**
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
 * Runs a bin/cli command in the scaffold's home and returns its status and its
 * output with the log timestamps and the runtime warnings removed.
 *
 * @inner
 * @param {string} home
 * @param {string[]} args
 * @returns {{status: number, out: string}}
 */
function cli(home, args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: childEnv(home), encoding: 'utf8', timeout: 60000 });
    var out = (String(r.stdout || '') + String(r.stderr || '')).split('\n').filter(function (l) {
        return !/ExperimentalWarning|trace-warnings/.test(l);
    }).join('\n').replace(/"ts":"[^"]*",/g, '');
    return { status: r.status, out: out };
}

/**
 * Runs gina-init, then gina-container, waits until the bundle binds its port
 * or the launcher exits, GETs the webroot, and stops it.
 *
 * @inner
 * @param {string} home
 * @returns {Promise<{bound: boolean, exit: (object|null), get: (number|string|null), out: string}>}
 */
async function boot(home) {
    fs.mkdirSync(home, { recursive: true });
    spawnSync(process.execPath, [GINA_INIT], {
        env: childEnv(home, {
            GINA_PROJECT_NAME: PROJ, GINA_BUNDLES: BUNDLE, GINA_PROJECT_PATH: ROOT,
            GINA_DEF_PROTOCOL: 'http/1.1', GINA_DEF_SCHEME: 'http', GINA_PORT_START: String(PORT_START)
        }),
        encoding: 'utf8', timeout: 60000
    });
    var port = PORT_START;
    var out = '';
    var exit = null;
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { out += d; });
    child.on('exit', function (code, signal) { exit = { code: code, signal: signal }; });
    var bound = false;
    var deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        if (await isPortOpen(port)) { bound = true; break; }
        if (exit) break;
        await sleep(250);
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
    return { bound: bound, exit: exit, get: get, out: out };
}

/**
 * @inner
 * @param {object} r
 * @returns {string}
 */
function detail(r) {
    return '\n  ' + JSON.stringify({ status: r.status, bound: r.bound, exit: r.exit, get: r.get }) + '\n  output tail: ' + String(r.out).slice(-1200);
}

describe('#B891 - every reader of manifest.json accepts comments', function () {

    var skip = (process.platform === 'win32') ? 'bin/cli, gina-init and gina-container are Unix-centric' : false;   // false, not null: node:test skips a test given `skip: null`
    var setupError = null;
    var plain = null;
    var commentedText = null;
    var runs = {};

    before(async function () {
        if (skip) return;
        var scaffoldHome = path.join(TMP, 'scaffold-home');
        fs.mkdirSync(ROOT, { recursive: true });
        fs.mkdirSync(scaffoldHome, { recursive: true });
        spawnSync(process.execPath, [CLI, 'project:add', '@' + PROJ, '--path=' + ROOT], { env: childEnv(scaffoldHome), encoding: 'utf8', timeout: 60000 });
        spawnSync(process.execPath, [CLI, 'bundle:add', BUNDLE, '@' + PROJ], { env: childEnv(scaffoldHome), encoding: 'utf8', timeout: 60000 });
        if (!fs.existsSync(MANIFEST) || !fs.existsSync(path.join(ROOT, 'src', BUNDLE, 'index.js'))) {
            setupError = 'bin/cli did not scaffold @' + PROJ + ' with bundle ' + BUNDLE;
            return;
        }
        plain = fs.readFileSync(MANIFEST, 'utf8');
        commentedText = plain.replace(/^\{/, '{\n    // a comment line, as a person might add one');

        ['plain', 'commented'].forEach(function (shape) {
            fs.writeFileSync(MANIFEST, shape === 'plain' ? plain : commentedText);
            runs[shape] = {
                list          : cli(scaffoldHome, ['bundle:list', '@' + PROJ]),
                bundleStatus  : cli(scaffoldHome, ['bundle:status', BUNDLE, '@' + PROJ]),
                projectStatus : cli(scaffoldHome, ['project:status', '@' + PROJ])
            };
        });

        fs.writeFileSync(MANIFEST, commentedText);
        runs.bootCommented = await boot(path.join(TMP, 'home-commented'));
        fs.writeFileSync(MANIFEST, plain.replace(/\}\s*$/, ''));
        runs.bootMalformed = await boot(path.join(TMP, 'home-malformed'));
        fs.writeFileSync(MANIFEST, plain);
    });

    after(function () {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    describe('01 - parseJSONWithComments()', function () {

        it('is a global function', function () {
            assert.equal(typeof parseJSONWithComments, 'function');
        });

        it('parses what requireJSON parses: line comments, a docblock, a URL value, a trailing comma', function () {
            var text = '/** a docblock */\n{\n    // a line comment\n    "url": "http://example.com/a",\n    "list": [1, 2,],\n    "n": 1 /* block */\n}\n';
            var file = path.join(TMP, 'parity.json');
            fs.writeFileSync(file, text);
            assert.deepEqual(parseJSONWithComments(text, file), requireJSON(file));
            assert.deepEqual(parseJSONWithComments(text, file), { url: 'http://example.com/a', list: [1, 2], n: 1 });
        });

        it('throws, without exiting, an Error that names the file and carries the JSON error as its cause', function () {
            var thrown = null;
            try { parseJSONWithComments('{ "a": 1', '/some/project/manifest.json'); } catch (e) { thrown = e; }
            assert.ok(thrown instanceof Error, 'no error thrown');
            assert.match(thrown.message, /^could not parse `\/some\/project\/manifest\.json`: /);
            assert.ok(thrown.cause instanceof SyntaxError, 'cause is not the JSON SyntaxError');
        });
    });

    describe('02 - bin/cli commands, a comment line in manifest.json', function () {

        it('the project scaffolds', { skip: skip }, function () {
            assert.equal(setupError, null, setupError);
        });

        ['list', 'bundleStatus', 'projectStatus'].forEach(function (cmd) {
            it(cmd + ': the same status and output as with the plain file', { skip: skip }, function () {
                assert.equal(runs.plain[cmd].status, 0, 'control (plain file)' + detail(runs.plain[cmd]));
                assert.equal(runs.commented[cmd].status, runs.plain[cmd].status, detail(runs.commented[cmd]));
                assert.equal(runs.commented[cmd].out, runs.plain[cmd].out);
            });
        });
    });

    describe('03 - gina-container, a comment line in manifest.json', function () {

        it('starts the bundle, which answers 200', { skip: skip }, function () {
            assert.equal(runs.bootCommented.bound, true, detail(runs.bootCommented));
            assert.equal(runs.bootCommented.get, 200, detail(runs.bootCommented));
        });
    });

    describe('04 - gina-container, a manifest.json that is still not JSON', function () {

        it('exits 1 and says the file cannot be parsed, naming it', { skip: skip }, function () {
            assert.equal(runs.bootMalformed.bound, false, detail(runs.bootMalformed));
            assert.deepEqual(runs.bootMalformed.exit, { code: 1, signal: null }, detail(runs.bootMalformed));
            assert.ok(runs.bootMalformed.out.indexOf('[ gina-container ] manifest.json cannot be used: could not parse `' + MANIFEST + '`: ') > -1, detail(runs.bootMalformed));
        });
    });
});
