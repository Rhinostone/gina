/**
 * lib/logger/.../mq/speaker.js — #B320: log frames must reach the LOCAL MQ
 * listener even when `~/.gina` state names another machine.
 *
 * The regression this locks: `host_v4` is self-describing advertisement state
 * ("the address EXTERNAL clients use to reach this machine"), but the speaker
 * dialled it — so on a `~/.gina` shared across hosts (each host rewriting the
 * file at boot with its own address), or after a stale address was left
 * behind, every application log frame was shipped to ANOTHER machine while
 * the boot lines read healthy: the connect succeeds, the local tail and file
 * sink receive nothing, and the drop is silent at every layer. The speaker's
 * listener is co-located BY CONSTRUCTION (started by the same install's
 * `bin/cli`), so the fix removes host_v4 from the dial entirely:
 * resolveLocalDialHost(bindHost) — a concrete non-wildcard LOCAL bind is
 * dialled, anything else (wildcard, absent, FOREIGN, unverifiable) stays on
 * loopback.
 *
 * This file is the DELIVERY arm — the one that discriminates the fix:
 * a collector listens on an ephemeral LOOPBACK port, the child's isolated
 * settings.json names FOREIGN addresses in BOTH host_v4 and bind_host, and
 * the child's frames must arrive at the collector anyway. On the pre-#B320
 * bytes this exact scene dials the foreign address and the collector receives
 * nothing (measured during the fix's design — the unpatched control run), so
 * the assertions below genuinely fail on the unfixed speaker. The exit
 * guarantee for the same poisoned settings lives in
 * logger-mq-speaker-connect-timeout.test.js §02; the resolver's unit matrix
 * in net-locality.test.js §04; the structural pins in
 * test/bin/control-plane-dial.test.js §02/§03.
 *
 * Instrument notes:
 *   - the ephemeral port doubles as the settings-read control: if the child
 *     ignored our GINA_HOMEDIR settings it would dial the default 8125, not
 *     our port, and the collector would stay empty — the test cannot pass on
 *     a child that read some other home;
 *   - the child holds its loop open briefly (a REF'd timer) so the unref'd
 *     speaker socket has time to flush before exit — delivery, not lifetime,
 *     is what this file asserts;
 *   - GINA_BIND_HOST is stripped from the child env: the fix reads it as its
 *     first tier, and an ambient value would bypass the settings under test.
 *
 * Run: node --test test/lib/logger-mq-speaker-local-dial.test.js
 */
'use strict';

var fs   = require('fs');
var os   = require('os');
var net  = require('net');
var path = require('path');
var { spawn } = require('child_process');

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW   = require('../fw');
var REPO = path.resolve(__dirname, '..', '..');

var CHILD_TIMEOUT_MS = 15000;

// RFC 5737 documentation ranges — routable-looking, never assigned to this
// machine, so `isLocalAddress` can never accidentally classify them local.
var FOREIGN_HOST = '203.0.113.7';   // TEST-NET-3 -> host_v4 (the sibling-host shape)
var FOREIGN_BIND = '198.51.100.9';  // TEST-NET-2 -> bind_host (the shared file's other key)

var MARKER = 'B320-LOCAL-DIAL-DELIVERY';

describe('01 - mq speaker: foreign per-host state cannot divert log delivery off-host', function() {

    var home, script, collector;
    var conns = 0, received = '';

    before(function(t, done) {
        var version      = require(path.join(REPO, 'package.json')).version;
        var shortVersion = version.split('.').slice(0, 2).join('.');

        home = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b320-'));
        fs.mkdirSync(path.join(home, shortVersion), { recursive: true });

        // Raw collector on an ephemeral loopback port. It only records; the
        // speaker does not require the listener handshake before writing.
        collector = net.createServer(function(conn) {
            conns++;
            conn.on('data', function(d) { received += d.toString(); });
            conn.on('error', function() { /* child exit RSTs are expected */ });
        });
        collector.listen({ host: '127.0.0.1', port: 0 }, function() {
            var port = collector.address().port;

            // The poisoned shared-home shape: BOTH keys foreign. The port is
            // the collector's — which is also the settings-read control (see
            // the docblock).
            fs.writeFileSync(
                path.join(home, shortVersion, 'settings.json'),
                JSON.stringify({ mq_port: port, host_v4: FOREIGN_HOST, bind_host: FOREIGN_BIND })
            );

            script = path.join(home, 'speak.js');
            fs.writeFileSync(script,
                'var logger = require(' + JSON.stringify(path.join(FW, 'lib/logger')) + ');\n'
                + 'logger.info(' + JSON.stringify(MARKER) + ');\n'
                // REF'd hold: give the unref'd speaker socket time to connect
                // and flush before the process exits on its own.
                + 'setTimeout(function(){}, 600);\n'
            );
            done();
        });
    });

    after(function() {
        try { collector.close(); } catch (e) {}
        try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
    });

    it('01.1 - the settings under test really are poisoned (harness control)', function() {
        var version      = require(path.join(REPO, 'package.json')).version;
        var shortVersion = version.split('.').slice(0, 2).join('.');
        var written = JSON.parse(fs.readFileSync(path.join(home, shortVersion, 'settings.json'), 'utf8'));
        assert.equal(written.host_v4, FOREIGN_HOST);
        assert.equal(written.bind_host, FOREIGN_BIND);
        assert.notEqual(written.mq_port, 8125, 'the ephemeral port must differ from the default, or the settings-read control is inert');
    });

    it('01.2 - the frames arrive at the LOCAL listener, and the child exits cleanly', function(t, done) {
        var env = Object.assign({}, process.env, {
            GINA_HOMEDIR : home,
            LOG_LEVEL    : 'info',
            NODE_PATH    : path.join(REPO, 'node_modules')
        });
        // An ambient value would bypass the settings under test (it is the
        // fix's first tier); stdout mode would splice `mq` out of the flows
        // and pass vacuously.
        delete env.GINA_BIND_HOST;
        delete env.GINA_LOG_STDOUT;
        delete env.GINA_LOG_FORMAT;

        var child = spawn(process.execPath, [script], { env: env });
        var killTimer = setTimeout(function() { child.kill('SIGTERM'); }, CHILD_TIMEOUT_MS);

        child.on('exit', function(code, signal) {
            clearTimeout(killTimer);
            // Give the collector one settle turn to drain what the kernel
            // buffered before the child's socket closed.
            setTimeout(function() {
                try {
                    assert.equal(signal, null, 'child was killed — it did not exit on its own');
                    assert.equal(code, 0, 'expected a clean exit, got ' + code);
                    assert.ok(conns >= 1,
                        'no connection reached the loopback collector — the speaker dialled '
                        + 'the foreign host_v4/bind_host instead of resolving locally (#B320 regressed)');
                    assert.ok(received.indexOf(MARKER) > -1,
                        'the log frame never arrived at the local listener (connections: ' + conns + ')');
                    done();
                } catch (err) {
                    done(err);
                }
            }, 200);
        });
    });

});
