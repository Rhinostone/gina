/**
 * Framework control-plane hardening — command socket (8124) + MQ listener (8125).
 *
 * The framework command socket accepts a JSON argv array and dispatches it as a
 * CLI command inside the long-lived daemon, so both WHERE it listens and WHAT it
 * will resolve are security-relevant.
 *
 * Node binds every interface when `listen()` is called without a host argument,
 * so both control-plane listeners now take an explicit bind host that defaults
 * to loopback (`bind_host` / `GINA_BIND_HOST`). Widening it is a deliberate
 * opt-in, mirroring a bundle's own `--http-host`. `bind_host` is deliberately
 * separate from `host_v4`: `host_v4` is the address clients CONNECT to, and a
 * workstation may legitimately point it at another machine — inheriting that as
 * a bind address would make the local daemon fail to start (EADDRNOTAVAIL).
 *
 * Pinned:
 *   (a) bin/cmd passes an explicit bind host to listen(), never host-less
 *   (b) bin/cmd defaults the bind host to loopback when the option is absent
 *   (c) bin/cli resolves bind_host env-first with a loopback fallback
 *   (d) bin/cli constructs the MQ listener with the key the listener READS
 *       (`hostV4`) — a mismatched key silently binds every interface
 *   (e) the MQ listener itself defaults to loopback when the key is absent
 *   (f) init.js constrains a command name to the shipped namespace before it
 *       can become a require() path, and an online command never exits the
 *       daemon on an unresolvable name
 *   (g) behavioural: the namespace predicate accepts every shipped command and
 *       rejects path separators / traversal segments
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW = require('../fw');

var CMD_SRC      = fs.readFileSync(path.resolve(__dirname, '../../bin/cmd'), 'utf8');
var CLI_SRC      = fs.readFileSync(path.resolve(__dirname, '../../bin/cli'), 'utf8');
var LISTENER_JS  = path.join(FW, 'lib/logger/src/containers/mq/listener.js');
var LISTENER_SRC = fs.readFileSync(LISTENER_JS, 'utf8');
var INIT_SRC     = fs.readFileSync(path.join(FW, 'lib/cmd/framework/init.js'), 'utf8');

// Comment-stripped views, so a negative pin cannot trip on prose that merely
// quotes the shape it forbids.
var CMD_CODE  = CMD_SRC.replace(/\/\/[^\n]*/g, '');
var INIT_CODE = INIT_SRC.replace(/\/\/[^\n]*/g, '');

/**
 * Replica of the command-namespace predicate in init.js run(). Pure logic —
 * no filesystem, no require. Kept in step with the source pin in §06.
 *
 * @param   {*} segment - a topic or action segment as received from a caller
 * @returns {boolean} true when the segment can only resolve inside lib/cmd/
 */
function isSafeCmdSegment(segment) {
    return /^[A-Za-z0-9_-]+$/.test( String(segment) );
}


describe('01 - the command socket binds an explicit host', function () {

    it('passes a bind host to listen(), never the host-less form', function () {
        assert.match(CMD_CODE, /framework\.listen\(\s*local\.port\s*,\s*local\.bindHost\s*,/,
            'bin/cmd must call framework.listen(port, bindHost, cb)');
    });

    it('no longer calls listen() with only a port and callback', function () {
        assert.doesNotMatch(CMD_CODE, /framework\.listen\(\s*local\.port\s*,\s*function/,
            'a host-less listen(port, cb) binds every interface');
    });

    it('defaults the bind host to loopback when the option is absent', function () {
        assert.match(CMD_CODE, /local\.bindHost\s*=\s*opt\.bindHost\s*\|\|\s*'127\.0\.0\.1'/,
            'an omitted option must never widen the bind');
    });
});


describe('02 - bind_host resolution in bin/cli', function () {

    it('resolves env-first, then settings, then loopback', function () {
        assert.match(CLI_SRC, /bindHost\s*=\s*getEnvVar\('GINA_BIND_HOST'\)\s*\|\|\s*settings\['bind_host'\]\s*\|\|\s*'127\.0\.0\.1'/,
            'bind_host must fall back to loopback, not to all interfaces');
    });

    it('forwards the resolved bind host to bin/cmd', function () {
        var forwarded = CLI_SRC.match(/bindHost\s*:\s*bindHost/g) || [];
        assert.ok(forwarded.length >= 2,
            'both launch paths must forward bindHost (found ' + forwarded.length + ')');
    });

    it('keeps bind_host distinct from the client-side host_v4', function () {
        assert.match(CLI_SRC, /hostV4\s*=\s*getEnvVar\('GINA_HOST_V4'\)/,
            'host_v4 remains the address clients connect to');
        assert.notEqual(
            CLI_SRC.indexOf("settings['bind_host']"), -1,
            'bind_host must be its own settings key'
        );
    });
});


describe('03 - the MQ listener binds loopback by default', function () {

    it('is constructed with the key the listener actually reads', function () {
        assert.match(CLI_SRC, /new MQListener\(\{\s*port:\s*mqPort,\s*hostV4:\s*bindHost\s*\}\)/,
            'the listener reads opt.hostV4 — a `host` key leaves it undefined');
    });

    it('no longer passes the mismatched `host` key', function () {
        assert.doesNotMatch(CLI_SRC, /new MQListener\(\{[^}]*\bhost:\s*hostV4/,
            'a key the listener does not read silently binds every interface');
    });

    it('the listener defaults to loopback when the key is absent', function () {
        assert.match(LISTENER_SRC, /var host\s*=\s*opt\.hostV4\s*\|\|\s*'127\.0\.0\.1'/,
            'matches the defaulting idiom of every sibling in this subsystem');
    });

    it('a malformed frame cannot drop the listener', function () {
        assert.match(LISTENER_SRC, /try\s*\{[\s\S]{0,120}?JSON\.parse\(payload\)[\s\S]{0,80}?\}\s*catch/,
            'the payload parse must be guarded — an uncaught throw here reaches the SIGTERM path');
    });
});


describe('04 - command names are constrained to the shipped namespace', function () {

    it('validates both segments before they can become a require() path', function () {
        assert.match(INIT_CODE, /isSafeCmdSegment\s*=\s*function/,
            'run() must constrain the caller-supplied command name');
        assert.match(INIT_CODE, /isKnownNamespace\s*=\s*isSafeCmdSegment\(opt\.task\.topic\)\s*&&\s*isSafeCmdSegment\(opt\.task\.action\)/);
    });

    it('an out-of-namespace name never yields a resolvable path', function () {
        assert.match(INIT_CODE, /var path\s*=\s*isKnownNamespace\s*\?\s*getPath\('gina'\)\.lib\s*\+\s*filename\s*:\s*''/,
            "an unsafe segment must resolve to '' so it takes the unknown-command branch");
    });

    it('the guard still precedes the require() call', function () {
        var guardIdx   = INIT_SRC.indexOf('if ( !fs.existsSync(path) )');
        var requireIdx = INIT_SRC.indexOf('require(path)(opt, cmd)');
        assert.ok(guardIdx > -1 && requireIdx > -1);
        assert.ok(guardIdx < requireIdx, 'the guard must run before require(path)');
    });
});


describe('05 - an unresolvable name never drops the daemon', function () {

    it('ends the client connection instead of exiting when online', function () {
        assert.match(INIT_CODE, /if\s*\(\s*opt\.isOnlineCommand\s*\)\s*\{[\s\S]{0,160}?opt\.client\.end\(\)/,
            'an online command runs inside the daemon that serves every other client');
    });

    it('keeps the non-zero exit for an offline run', function () {
        assert.match(INIT_CODE, /process\.exit\(1\)/,
            'a one-shot CLI process should still exit non-zero');
    });
});


describe('06 - namespace predicate accepts every shipped command', function () {

    it('accepts every command group directory and action file', function () {
        var cmdDir  = path.join(FW, 'lib/cmd');
        var topics  = fs.readdirSync(cmdDir).filter(function (f) {
            return fs.statSync(path.join(cmdDir, f)).isDirectory();
        });
        assert.ok(topics.length > 0, 'expected at least one command group');

        var rejected = [];
        topics.forEach(function (t) {
            if ( !isSafeCmdSegment(t) ) { rejected.push(t); }
            fs.readdirSync(path.join(cmdDir, t))
                .filter(function (f) { return /\.js$/.test(f); })
                .forEach(function (f) {
                    var action = f.replace(/\.js$/, '');
                    if ( !isSafeCmdSegment(action) ) { rejected.push(t + ':' + action); }
                });
        });

        assert.deepEqual(rejected, [],
            'the predicate must not reject any shipped command');
    });

    it('accepts the synthetic flag-shaped forms', function () {
        ['-V', '--version', '-h', '--help'].forEach(function (action) {
            assert.ok(isSafeCmdSegment(action), action + ' must remain dispatchable');
        });
    });

    it('rejects path separators and traversal segments', function () {
        ['..', '../../etc', 'a/b', 'a\\b', '', ' ', '.', 'a b'].forEach(function (segment) {
            assert.equal(isSafeCmdSegment(segment), false,
                JSON.stringify(segment) + ' must not resolve to a handler path');
        });
    });
});
