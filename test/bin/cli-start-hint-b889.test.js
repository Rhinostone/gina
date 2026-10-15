/**
 * #B889 — the hint printed when the framework is not running.
 *
 * Every online command (`gina bundle:start` above all) dials the framework
 * command socket. When nothing answers, bin/cli prints a hint naming the
 * command that starts the framework. It used to ask for elevated privileges,
 * which gina does not need: the framework runs as the current user, and its
 * pid files go under the npm prefix, or to `~/.gina/run` when the prefix is
 * not writable (utils/helper.js getRunDir). Since 0.7.5 the hint is
 * `$ gina start`, on every platform.
 *
 * The test drives the REAL bin/cli in a child process, in an isolated temp
 * home whose settings pin the framework port to a free one: no daemon can
 * answer, and nothing is written outside the temp dir. The fix's correctness
 * is the printed text, so the test is behavioural, not a source pin.
 *
 * Module-path seam: GINA_B889_CLI points the test at another bin/cli (a
 * `git archive` copy of the pre-fix tree) for the red-first run.
 *
 * Run: node --test test/bin/cli-start-hint-b889.test.js
 */
'use strict';

var assert = require('node:assert');
var { describe, it, before, after } = require('node:test');
var fs   = require('fs');
var os   = require('os');
var path = require('path');
var net  = require('net');
var { spawnSync } = require('child_process');

var GINA_ROOT = path.resolve(__dirname, '..', '..');
var CLI       = process.env.GINA_B889_CLI || path.join(GINA_ROOT, 'bin', 'cli');
// bin/cli derives its version, and so its home's `<short>/` dir, from its own tree.
var VERSION   = require(path.resolve(path.dirname(CLI), '..', 'package.json')).version;
var SHORT     = VERSION.split('.').slice(0, 2).join('.');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b889-'));

/**
 * Reserves `n` distinct free loopback ports, then releases them.
 *
 * @inner
 * @param {number} n - How many ports to reserve
 * @returns {Promise<number[]>} The ports, in reservation order
 */
function freePorts(n) {
    var servers = [];
    for (var i = 0; i < n; ++i) {
        servers.push(net.createServer());
    }
    return Promise.all(servers.map(function (s) {
        return new Promise(function (resolve, reject) {
            s.once('error', reject);
            s.listen(0, '127.0.0.1', function () { resolve(s.address().port); });
        });
    })).then(function (ports) {
        return Promise.all(servers.map(function (s) {
            return new Promise(function (resolve) { s.close(resolve); });
        })).then(function () { return ports; });
    });
}

/**
 * Removes ANSI colour sequences, so assertions read the text a terminal shows.
 *
 * @inner
 * @param {string} s - Raw child output
 * @returns {string} The output without colour codes
 */
function plain(s) {
    return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

describe('#B889 - the hint printed when the framework is not running', function () {

    var port, result, out;

    before(function () {
        return freePorts(2).then(function (ports) {
            port = ports[0];
            var home     = path.join(TMP, 'home');
            var ginaHome = path.join(home, '.gina');
            fs.mkdirSync(path.join(ginaHome, SHORT), { recursive: true });
            ['prefix', 'run', 'log', 'tmp'].forEach(function (d) {
                fs.mkdirSync(path.join(TMP, d));
            });

            var frameworks = {};
            frameworks[SHORT] = [VERSION];
            fs.writeFileSync(path.join(ginaHome, 'main.json'),
                JSON.stringify({ def_framework: VERSION, frameworks: frameworks }) + '\n');
            fs.writeFileSync(path.join(ginaHome, SHORT, 'settings.json'), JSON.stringify({
                log_level : 'info',
                port      : ports[0],
                mq_port   : ports[1],
                bind_host : '127.0.0.1',
                host_v4   : '127.0.0.1'
            }) + '\n');

            // The child must not inherit the runner's gina or npm overrides.
            var env = {};
            Object.keys(process.env).forEach(function (k) {
                if (!/^(GINA_|NODE_OPTIONS$|NPM_CONFIG_PREFIX$|npm_config_prefix$)/.test(k)) {
                    env[k] = process.env[k];
                }
            });
            env.HOME         = home;
            env.GINA_HOMEDIR = ginaHome;
            env.GINA_PREFIX  = path.join(TMP, 'prefix');
            env.GINA_RUNDIR  = path.join(TMP, 'run');
            env.GINA_LOGDIR  = path.join(TMP, 'log');
            env.GINA_TMPDIR  = path.join(TMP, 'tmp');

            result = spawnSync(process.execPath, [CLI, 'bundle:start', 'probe', '@probe'], {
                env      : env,
                encoding : 'utf8',
                timeout  : 30000
            });
            out = plain(result.stdout);
        });
    });

    after(function () {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    it('dials the free port pinned in the temp home, so no real framework can answer', function () {
        assert.ok(out.indexOf('Could not reach the framework command socket at `127.0.0.1:' + port + '`') > -1,
            'the dial line must name the pinned port; stdout: ' + out + '\nstderr: ' + plain(result.stderr));
    });

    it('exits 1', function () {
        assert.strictEqual(result.error, undefined, 'spawn error: ' + result.error);
        assert.strictEqual(result.status, 1, 'stdout: ' + out + '\nstderr: ' + plain(result.stderr));
    });

    it('prints `$ gina start` on a line of its own', function () {
        var lines = out.split('\n').map(function (l) { return l.trim(); });
        assert.ok(lines.indexOf('$ gina start') > -1, 'stdout: ' + out);
    });

    it('does not mention sudo, on stdout or stderr', function () {
        var both = out + '\n' + plain(result.stderr);
        assert.doesNotMatch(both, /\bsudo\b/, 'output: ' + both);
    });
});
