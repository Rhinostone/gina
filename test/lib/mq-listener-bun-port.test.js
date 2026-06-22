/**
 * lib/logger/.../mq/listener.js — Bun-safety of the MQ listener's net.listen port.
 *
 * The MQ listener builds a `server.listen()` options object from the port it was
 * constructed with (`new MQListener({ port: mqPort })`, where mqPort is the
 * string "8125" from settings). Under Node, the options-object form of
 * `server.listen({ port, host, signal })` coerces a string port to a number, so
 * a string port works. Under Bun it does NOT — Bun rejects a string port with
 * `TypeError: The argument 'options' must have the property "port" or "path"`,
 * crashing `bin/cli` at the MQ-listener startup (`onExec`). That crash is what
 * left `gina link` (and therefore `project:add`'s node_modules/gina symlink)
 * broken under Bun, so a scaffolded bundle could not resolve the framework.
 *
 * The fix coerces the port with `parseInt(port, 10)` at the listenOption site:
 * a no-op under Node (the string "8125" already coerces to 8125 there) and
 * correct under Bun. Tests are two-layered:
 *   (a) source-inspection — the listenOption coerces the port with parseInt and
 *       no longer passes the bare (possibly string) port through;
 *   (b) behaviour — a numeric-port options object binds (the fixed shape).
 *
 * Note: the string-port REJECTION is Bun-specific and cannot be reproduced on
 * Node (which runs this suite — Node accepts both string and number ports), so
 * the source-pin in (a) is the primary regression guard; (b) confirms the fixed
 * numeric shape is a valid listen target.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var net    = require('net');
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');

var FW       = require('../fw');
var LISTENER = path.join(FW, 'lib/logger/src/containers/mq/listener.js');


// ---------------------------------------------------------------------------
// 01 — source: the listenOption coerces the port with parseInt, not bare port
// ---------------------------------------------------------------------------
describe('01 - mq listener: net.listen port is a Bun-safe number', function() {

    var code;
    before(function() {
        // Strip line comments so the explanatory Bun comment (which mentions
        // "port") cannot trip the bare-`port: port` negative pin.
        code = fs.readFileSync(LISTENER, 'utf8').replace(/\/\/[^\n]*/g, '');
    });

    it('listenOption.port is coerced with parseInt(port, 10)', function() {
        assert.match(code, /port:\s*parseInt\(\s*port\s*,\s*10\s*\)/,
            'the MQ listenOption must coerce the port with parseInt(port, 10)');
    });

    it('the bare (possibly string) port is no longer passed through', function() {
        assert.doesNotMatch(code, /port:\s*port\b/,
            'the listenOption must NOT assign the bare `port: port` (Bun rejects a string port)');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: a numeric-port options object is a valid listen target
// ---------------------------------------------------------------------------
describe('02 - mq listener: the fixed numeric-port shape binds', function() {

    it('parseInt coerces the settings string port to a number', function() {
        assert.strictEqual(parseInt('8125', 10), 8125);
        assert.strictEqual(typeof parseInt('8125', 10), 'number');
    });

    it('net.listen({ host, port: <number> }) binds (the fixed shape)', async function() {
        await new Promise(function(resolve, reject) {
            var srv = net.createServer();
            srv.once('error', reject);
            // Port 0 = ephemeral; mirrors the fixed listenOption shape with a number.
            srv.listen({ host: '127.0.0.1', port: parseInt('0', 10) }, function() {
                var bound = srv.address().port;
                assert.ok(bound > 0, 'should bind an ephemeral port');
                srv.close(resolve);
            });
        });
    });

});
