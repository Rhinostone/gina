/**
 * lib/logger/.../mq/listener.js — a departed MQ speaker must not kill the process (#B279).
 *
 * Every `bin/cli` invocation starts the MQ listener on the shared MQ port
 * (`settings.mq_port`, 8125 by default) — see bin/cli's `startMQListener` call.
 * The port is machine-global, so under a parallel test run (CI runs
 * `node --test` with no `--test-concurrency`) one CLI's listener accepts
 * connections from OTHER CLIs acting as MQ speakers.
 *
 * When such a speaker goes away abruptly — a CLI that finished or was killed —
 * the connection socket stays registered in `sessions` but is broken. The next
 * write to it (the handshake write, or `self.report()`'s
 * `sessions[sessionId].write()`) raises EPIPE/ECONNRESET **on the connection
 * socket**. The connection listener registered 'end'/'exit'/'data'/'connect'
 * but never 'error', so node THREW the event and the whole CLI process died
 * mid-command. Observed on CI: `bundle:add` exited 1 before writing
 * ports.reverse.json, with `Emitted 'error' event on Socket instance` and
 * `at self.report (…/mq/listener.js:113)`.
 *
 * `server.on('error')` does NOT cover this — every accepted connection is its
 * own EventEmitter — which is why the pre-existing server-level handler left
 * the hole open. Arm (b) below proves that independently.
 *
 * Two layers:
 *   (a) source-inspection on the real file — the handler exists, it clears the
 *       session, and it is registered BEFORE the handshake write (itself a
 *       throwing site, so a handler registered after it would not cover it);
 *   (b) behaviour, in CHILD processes — a replica of the connection listener's
 *       registrations dies on a peer reset WITHOUT the handler and survives
 *       WITH it. The negative arm must run out-of-process precisely because a
 *       genuinely unhandled 'error' would take this test runner down.
 *
 * Arm (b) is a REPLICA and can drift from the real file; the pins in (a) are
 * anchored over exactly the registration shape it mirrors.
 */

'use strict';

var fs        = require('fs');
var path      = require('path');
var { spawnSync } = require('child_process');
var { describe, it, before } = require('node:test');
var assert    = require('node:assert/strict');

var FW       = require('../fw');
var LISTENER = path.join(FW, 'lib/logger/src/containers/mq/listener.js');


// ---------------------------------------------------------------------------
// 01 — source: the connection listener registers an 'error' handler, and does
//      so before the handshake write
// ---------------------------------------------------------------------------
describe('01 - mq listener: a connection socket carries an error handler', function () {

    var code;
    before(function () {
        // Strip line comments: the #B279 comment block names 'error',
        // server.on('error') and sessions, and would satisfy these pins on its
        // own (the file's-own-comment trap).
        code = fs.readFileSync(LISTENER, 'utf8').replace(/\/\/[^\n]*/g, '');
    });

    it("registers conn.on('error') on the accepted connection", function () {
        assert.match(code, /conn\.on\(\s*'error'/,
            "the MQ listener's connection handler must register an 'error' listener — " +
            'without it an EPIPE/ECONNRESET from a departed speaker is thrown and kills the process');
    });

    it('the error handler clears the session it was holding', function () {
        // An abruptly-killed peer may never emit 'end', which is what otherwise
        // deletes the entry — leaving a dead socket for the next report() write.
        var m = code.match(/conn\.on\(\s*'error'\s*,\s*function\s*\([^)]*\)\s*\{([\s\S]{0,400}?)\}\s*\)/);
        assert.ok(m, "could not locate the conn.on('error') handler body");
        assert.match(m[1], /delete\s+sessions\[\s*this\.sessionId\s*\]/,
            'the error handler must delete sessions[this.sessionId]');
    });

    it("conn.on('error') is registered BEFORE the handshake conn.write", function () {
        // The handshake write is itself a throwing site, so a handler attached
        // after it would leave that write uncovered.
        var iErr   = code.indexOf("conn.on('error'");
        var iWrite = code.search(/conn\.write\(\s*JSON\.stringify\(\s*\{\s*sessionId/);
        assert.ok(iErr   > -1, "conn.on('error') not found");
        assert.ok(iWrite > -1, 'the handshake conn.write was not found');
        assert.ok(iErr < iWrite,
            "conn.on('error') must be registered before the handshake write (got error@" +
            iErr + ' vs write@' + iWrite + ')');
    });

    it('the server-level error handler is still present (it was never a substitute)', function () {
        assert.match(code, /server\.on\(\s*'error'/,
            'server.on(error) must remain — it covers listen-time failures such as EADDRINUSE');
    });
});


// ---------------------------------------------------------------------------
// 02 — behaviour: replica of the registration shape, in child processes
// ---------------------------------------------------------------------------
describe('02 - mq listener: a peer reset kills an unguarded connection socket', function () {

    // Mirrors listener.js's connection registrations. ARM=fixed adds the
    // conn.on('error') the fix introduces; everything else is identical.
    var replica = [
        "var net = require('net');",
        "var ARM = process.env.ARM;",
        "var sessions = {};",
        "var server = net.createServer(function (conn) {",
        "    conn.sessionId = 'sid';",
        "    sessions[conn.sessionId] = conn;",
        "    if (ARM === 'fixed') {",
        "        conn.on('error', function (err) {",
        "            delete sessions[this.sessionId];",
        "            process.stdout.write('HANDLED:' + (err.code || err.message) + '\\n');",
        "        });",
        "    }",
        "    conn.on('end', function () { delete sessions[this.sessionId]; });",
        "    conn.on('data', function () {});",
        "    conn.on('connect', function () {});",
        "    conn.write('hello\\r\\n');",
        "});",
        // the pre-existing server-level handler: present in BOTH arms, so if the
        // fixed arm survives it cannot be credited to this one.
        "server.on('error', function (e) { process.stdout.write('SERVER:' + e.code + '\\n'); });",
        "server.listen(0, '127.0.0.1', function () {",
        "    var c = net.createConnection({ port: server.address().port, host: '127.0.0.1' }, function () {",
        "        c.resetAndDestroy();",
        "    });",
        "    c.on('error', function () {});",
        "});",
        "setTimeout(function () { process.stdout.write('SURVIVED\\n'); server.close(); process.exit(0); }, 500);"
    ].join('\n');

    function run(arm) {
        return spawnSync(process.execPath, ['-e', replica], {
            env: Object.assign({}, process.env, { ARM: arm }),
            encoding: 'utf8',
            timeout: 20000
        });
    }

    it("WITHOUT conn.on('error') a peer reset takes the process down (the #B279 crash)", function () {
        var r = run('bare');
        assert.equal(r.status, 1,
            'the unguarded replica must die on a peer reset — if this passes with status 0 the ' +
            'probe no longer reproduces the bug and arm (b) proves nothing');
        assert.match(String(r.stderr), /Unhandled 'error' event/,
            'the death must be an unhandled socket error, not some other failure');
        assert.doesNotMatch(String(r.stdout), /SURVIVED/, 'the unguarded replica must not reach the end');
    });

    it("the server-level handler does NOT cover a connection-socket error", function () {
        // Both arms register server.on('error'); the bare arm still dies, so the
        // server-level handler demonstrably does not catch conn errors.
        var r = run('bare');
        assert.doesNotMatch(String(r.stdout), /SERVER:/,
            'server.on(error) must not fire for a connection-socket error');
    });

    it("WITH conn.on('error') the process survives and the session is cleared", function () {
        var r = run('fixed');
        assert.equal(r.status, 0, 'the guarded replica must survive the peer reset; stderr: ' + r.stderr);
        assert.match(String(r.stdout), /HANDLED:(EPIPE|ECONNRESET)/,
            'the error must be delivered to the connection handler');
        assert.match(String(r.stdout), /SURVIVED/, 'the guarded replica must run to completion');
    });
});
