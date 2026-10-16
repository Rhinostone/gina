/**
 * #B892 — bin/gina-init applies the container logging preset, as bin/gina-container does.
 *
 * gina-init runs at container start, where no MQ listener exists. It required
 * utils/helper — which starts this process's logger — without the
 * `GINA_LOG_STDOUT` preset bin/gina-container applies (#B524), so the logger's
 * `mq` flow dialled the MQ port: « [MQSpeaker] Error: connect ECONNREFUSED
 * 127.0.0.1:8125 » on every container start, and in a pod, whose containers
 * share localhost, a sidecar listening on that port would have received the
 * process's log frames.
 *
 * The instrument: the speaker reads its port from
 * `$GINA_HOMEDIR/<shortVersion>/settings.json` when the logger starts, before
 * gina-init writes anything, so each arm pre-seeds that file with the port of a
 * listener this test owns and counts the connections it receives. Port 8125 is
 * never used. The arms run the REAL bin/gina-init in a throwaway home:
 *   §01 GINA_LOG_STDOUT unset: no connection, and gina-init completes as before;
 *   §02 control, GINA_LOG_STDOUT=false: the dial reaches the listener;
 *   §03 GINA_LOG_STDOUT=true: no connection.
 *
 * Run: node --test test/bin/gina-init-log-preset-b892.test.js
 */
'use strict';

var net    = require('net');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawn } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var TREE      = path.resolve(__dirname, '..', '..');
var GINA_INIT = path.join(TREE, 'bin', 'gina-init');
var SHORT     = require(path.join(TREE, 'package.json')).version.split('.').slice(0, 2).join('.');
var TMP       = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b892-'));

var ARM_TIMEOUT_MS = 10000;

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
 * Runs bin/gina-init once in a fresh home whose settings point the MQ speaker
 * at a listener this test owns, and counts the connections the listener
 * receives. A child still running after ARM_TIMEOUT_MS is killed.
 *
 * @inner
 * @param {string} name - The arm's directory name
 * @param {object} [extra] - Variables to add to the child environment
 * @returns {Promise<{code: (number|string), connections: number, out: string}>}
 */
async function runArm(name, extra) {
    var home = path.join(TMP, name);
    var settingsDir = path.join(home, '.gina', SHORT);
    fs.mkdirSync(settingsDir, { recursive: true });

    var connections = 0;
    var server = net.createServer(function (sock) { connections++; sock.destroy(); });
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'),
        JSON.stringify({ mq_port: server.address().port, host_v4: '127.0.0.1' }));

    var out = '';
    var code = await new Promise(function (resolve) {
        var child = spawn(process.execPath, [GINA_INIT], {
            env: childEnv(home, Object.assign({
                GINA_PROJECT_NAME : 'b892p',
                GINA_BUNDLES      : 'demo',
                GINA_PROJECT_PATH : path.join(TMP, 'proj')
            }, extra)),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        var timer = setTimeout(function () { child.kill('SIGKILL'); }, ARM_TIMEOUT_MS);
        child.stdout.on('data', function (d) { out += d; });
        child.stderr.on('data', function (d) { out += d; });
        child.on('exit', function (c, signal) { clearTimeout(timer); resolve(c === null ? signal : c); });
    });
    // a connection the kernel accepted while the child ran is delivered now
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    await new Promise(function (resolve) { server.close(resolve); });
    return { code: code, connections: connections, out: out };
}

/**
 * Renders an arm result for an assertion message.
 *
 * @inner
 * @param {object} r - A runArm() result
 * @returns {string}
 */
function detail(r) {
    return '\n  code=' + r.code + ' connections=' + r.connections + '\n  output: ' + String(r.out).slice(-600);
}

describe('#B892 - bin/gina-init applies the container logging preset', function () {

    var skip = (process.platform === 'win32') ? 'gina-init is Unix-centric' : false;   // false, not null: node:test skips a test given `skip: null`
    var arms = {};

    before(async function () {
        if (skip) return;
        fs.mkdirSync(path.join(TMP, 'proj'), { recursive: true });
        arms.unset = await runArm('unset', {});
        arms.off   = await runArm('off', { GINA_LOG_STDOUT: 'false' });
        arms.on    = await runArm('on', { GINA_LOG_STDOUT: 'true' });
    });

    after(function () {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    describe('01 - GINA_LOG_STDOUT unset', function () {

        it('does not dial the MQ port', { skip: skip }, function () {
            assert.equal(arms.unset.connections, 0, 'gina-init dialled the MQ listener' + detail(arms.unset));
        });

        it('completes as before: exit 0, its own bootstrap line printed', { skip: skip }, function () {
            assert.equal(arms.unset.code, 0, detail(arms.unset));
            assert.match(arms.unset.out, /\[gina-init\] Bootstrap complete for @b892p/, detail(arms.unset));
        });
    });

    describe('02 - control: GINA_LOG_STDOUT=false keeps the transport', function () {

        it('dials the MQ listener the settings name', { skip: skip }, function () {
            assert.ok(arms.off.connections >= 1, 'the listener saw no dial, so this instrument cannot see one' + detail(arms.off));
        });
    });

    describe('03 - GINA_LOG_STDOUT=true', function () {

        it('does not dial the MQ port, and completes', { skip: skip }, function () {
            assert.equal(arms.on.connections, 0, detail(arms.on));
            assert.equal(arms.on.code, 0, detail(arms.on));
        });
    });
});
