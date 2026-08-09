/**
 * lib/logger/.../mq/speaker.js — #B323: the speaker must survive a slow boot,
 * and must come back after the listener goes away.
 *
 * TWO defects, one file, because they share a mechanism and a harness.
 *
 * (1) THE SLOW-BOOT KILL. #B318 armed a 2s deadline that destroys the socket if
 *     `client.connecting` is still true when it fires. `connecting` does not
 *     flip when the KERNEL completes the connect — it flips when the POLL phase
 *     runs `afterConnect`. A timer fires in the TIMERS phase, which comes
 *     BEFORE poll. So on any boot that blocks the event loop past the deadline
 *     — a bundle mounting off a network filesystem, i.e. every
 *     Kubernetes-class start — the loop resumes, runs the overdue deadline
 *     first, reads `connecting === true` on a connection the kernel established
 *     seconds ago, and destroys it. Measured both directions before the fix:
 *
 *       kernel-completed dial ... timers phase: connecting=true   check: false
 *       black-holed dial ........ timers phase: connecting=true   check: true
 *
 *     The fix re-checks from `setImmediate` (CHECK phase, after poll), so a
 *     completed connect survives and a genuinely pending one still dies on
 *     schedule — #B318's no-hang contract intact. The second row above is what
 *     makes that a measurement rather than a hope: if both arms read the same
 *     at the check phase, the deferral would prove nothing.
 *
 * (2) NO WAY BACK. The speaker dialled exactly once, ever. Whatever killed the
 *     connection — the deadline above, a daemon restart, an OOM kill of the
 *     listener — silenced the bundle's `mq` flow for the rest of the process's
 *     life, with no error after the first and nothing in the logs to say so.
 *     The fix redials on `close` with a capped, unref'd backoff.
 *
 * WHY A FACADE. `mq/index.js` is the sole consumer (verified) and it captures
 * the speaker's return ONCE, at logger-construction time, holding it for the
 * life of the process. A speaker that swapped its socket without an
 * indirection would leave that consumer writing into the dead one forever — so
 * reconnect is only reachable because `startMQSpeaker` now returns a stable
 * `{ write }` facade rather than the socket itself.
 *
 * Layers, per the convention of the two sibling speaker files:
 *   §01 source-inspection — the deferral and the reconnect exist in LIVE code
 *       (comment lines are stripped first: this block is heavily commented, and
 *       the positive-existence-pin trap in architecture/jsdoc.md is real here);
 *   §02 behaviour — a child that blocks its loop for 3s right after the dial
 *       still delivers its frames. This is the arm that discriminates the
 *       slow-boot fix: on the pre-fix bytes the same scene loses the marker;
 *   §03 behaviour — a child whose listener disappears and comes back is heard
 *       again. On the pre-fix bytes it never is;
 *   §04 behaviour — the reconnect must not resurrect the #B276 hang: a child
 *       with no listener at all still exits on its own.
 *
 * §02 and §03 both carry a control that must fire, because "the marker arrived"
 * and "the child exited" are each satisfiable by a harness that was never
 * measuring anything.
 *
 * Run: node --test test/lib/logger-mq-speaker-resilience.test.js
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var net  = require('net');
var path = require('path');
var { spawn, spawnSync } = require('child_process');

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW      = require('../fw');
var REPO    = path.resolve(__dirname, '..', '..');
var SPEAKER = path.join(FW, 'lib/logger/src/containers/mq/speaker.js');

var CHILD_TIMEOUT_MS = 20000;


/**
 * Builds an isolated GINA_HOMEDIR holding a settings.json for `port`.
 *
 * The speaker honours process.env.GINA_HOMEDIR (the #B160 three-tier read), so
 * every child below resolves OUR settings and never the real ~/.gina.
 * shortVersion mirrors speaker.js's own derivation.
 *
 * @inner
 * @param {string} tag - Distinguishes this run's temp dir.
 * @param {number} port - The MQ port the child's speaker should dial.
 * @returns {string} The home directory path.
 *
 * @example
 * var home = makeHome('b323-boot', 54321);
 */
function makeHome(tag, port) {
    var version      = require(path.join(REPO, 'package.json')).version;
    var shortVersion = version.split('.').slice(0, 2).join('.');
    var home         = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-' + tag + '-'));

    fs.mkdirSync(path.join(home, shortVersion), { recursive: true });
    fs.writeFileSync(
        path.join(home, shortVersion, 'settings.json'),
        JSON.stringify({ mq_port: port, host_v4: '127.0.0.1', bind_host: '127.0.0.1' })
    );
    return home;
}

/**
 * The child environment every behavioural arm uses.
 *
 * GINA_LOG_STDOUT is stripped because it splices `mq` out of the flows — no
 * socket would be opened at all and the arm would pass vacuously.
 * GINA_BIND_HOST is stripped because it is the dial's first tier, and an
 * ambient value would bypass the settings under test.
 *
 * @inner
 * @param {string} home - The isolated GINA_HOMEDIR.
 * @returns {object} An env object for spawn().
 *
 * @example
 * spawn(process.execPath, [script], { env: childEnv(home) });
 */
function childEnv(home) {
    var env = Object.assign({}, process.env, {
        GINA_HOMEDIR : home,
        LOG_LEVEL    : 'info',
        NODE_PATH    : path.join(REPO, 'node_modules')
    });
    delete env.GINA_BIND_HOST;
    delete env.GINA_LOG_STDOUT;
    delete env.GINA_LOG_FORMAT;
    return env;
}


// ---------------------------------------------------------------------------
// 01 — source: the deferral and the reconnect are in live code
// ---------------------------------------------------------------------------
describe('01 - mq speaker: the phase-correct deadline and the reconnect exist', function() {

    var code, arm;
    before(function() {
        code = fs.readFileSync(SPEAKER, 'utf8')
                 .split('\n')
                 .filter(function(line) { return !/^\s*\/\//.test(line); })
                 .join('\n');
        // End-anchored slice of the deadline arm — never a fixed char window
        // (architecture/jsdoc.md: the body's size is exactly what changed here).
        var open = code.indexOf('var connectDeadline = setTimeout(');
        var end  = code.indexOf('connectDeadline.unref();', open);
        arm = (open > -1 && end > open) ? code.slice(open, end) : '';
    });

    it('01.1 - the deadline arm is sliceable (harness premise)', function() {
        assert.ok(arm.length > 0,
            'could not isolate the deadline arm — every §01 pin below reads an '
            + 'empty string and would pass or fail for harness reasons');
    });

    it('01.2 - the verdict is deferred to the CHECK phase, inside the deadline', function() {
        // The ordering IS the fix: setTimeout (timers) wraps setImmediate
        // (check), and only then is `connecting` consulted. Reading it straight
        // from the timers phase is what destroyed live connections.
        var immediate  = arm.indexOf('setImmediate(');
        var connecting = arm.indexOf('client.connecting');

        assert.ok(immediate > -1,
            'the deadline must defer its verdict one phase — a timers-phase read of '
            + '`connecting` fires BEFORE poll processes a completed connect');
        assert.ok(connecting > immediate,
            'the `connecting` check must sit INSIDE the setImmediate, not before it');
    });

    it('01.3 - the deferred verdict still destroys a genuinely pending dial (#B318 intact)', function() {
        var immediate = arm.indexOf('setImmediate(');
        var destroy   = arm.indexOf('client.destroy(');
        assert.ok(destroy > immediate,
            'destroying the socket is what cancels the pending connect request, and it '
            + 'must be reached from the deferred check');
    });

    it('01.4 - a closed connection arms a redial', function() {
        assert.match(code, /client\.on\('close'/,
            'without a close handler the speaker dials exactly once, ever — the '
            + 'second half of #B323');
        var close = code.indexOf("client.on('close'");
        var body  = code.slice(close, close + 400);
        assert.match(body, /current !== client/,
            'a SUPERSEDED socket closing must not arm a redial — only the current one');
        assert.match(body, /scheduleRedial\(\)/,
            'the close handler must arm the next dial');
    });

    it('01.5 - the backoff is exponential AND capped', function() {
        assert.match(code, /Math\.min\(500 \* Math\.pow\(2, attempts\), 30000\)/,
            'an uncapped backoff eventually stops retrying in practice; an unbacked-off '
            + 'one hammers a down listener');
    });

    it('01.6 - the redial timer is unref\'d (#B276 must not come back)', function() {
        assert.match(code, /^\s*redialTimer\.unref\(\);/m,
            'a ref\'d redial timer would keep every short-lived CLI alive across the '
            + 'whole backoff — reintroducing the hang #B276 removed');
    });

    it('01.7 - the speaker returns a stable transport facade, not the socket', function() {
        assert.match(code, /^\s*return transport;/m,
            'mq/index.js captures this return once and holds it for the life of the '
            + 'process — returning the socket makes reconnect unreachable');
        assert.equal(code.indexOf('return client;'), -1,
            'returning the socket is the shape the facade replaces');
    });

    it('01.8 - the facade writes to whichever socket is CURRENT', function() {
        var write = code.indexOf('write: function (chunk)');
        assert.ok(write > -1, 'expected the facade write()');
        var body = code.slice(write, write + 400);
        assert.match(body, /current && current\.writable/,
            'a write while the speaker is down must not throw into the emitter');
        assert.match(body, /current\.write\(chunk\)/,
            'the facade must delegate to the current socket, not to a captured one');
    });

    it('01.9 - the socket is adopted at DIAL time, so mount-window frames still queue', function() {
        var adopt = code.indexOf('current = client;');
        var unref = code.indexOf('client.unref();');
        assert.ok(adopt > -1, 'expected the dial-time adoption');
        assert.ok(adopt < unref,
            'adoption must happen with the rest of the dial — a net.Socket queues writes '
            + 'made while connecting, which is how frames logged DURING a bundle mount survive');
    });

    it('01.10 - the caller callback settles exactly once', function() {
        assert.match(code, /cbCalled/,
            'a reconnecting speaker settles repeatedly; a callback contract does not');
        var settle = code.indexOf('function settle(');
        assert.ok(settle > -1, 'expected the settle() gate');
        var body = code.slice(settle, settle + 300);
        assert.match(body, /cbCalled = true;/, 'the gate must latch');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: a boot that blocks the loop past the deadline still delivers
// ---------------------------------------------------------------------------
describe('02 - mq speaker: a slow boot does not lose its frames', function() {

    var home, collector, port, received = '', conns = 0;
    var MARKER = 'B323-SLOW-BOOT-DELIVERY';
    var BLOCK_MS = 3000;   // > the 2000ms deadline: the whole point

    before(function(t, done) {
        collector = net.createServer(function(conn) {
            conns++;
            conn.on('data', function(d) { received += d.toString(); });
            conn.on('error', function() { /* child exit RSTs are expected */ });
        });
        collector.listen({ host: '127.0.0.1', port: 0 }, function() {
            port = collector.address().port;
            home = makeHome('b323-boot', port);
            done();
        });
    });

    after(function() {
        try { collector.close(); } catch (e) {}
        try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
    });

    it('02.1 - the scene really does block past the deadline (harness control)', function() {
        // If the block were shorter than the deadline the arm would pass on the
        // pre-fix bytes too, proving nothing. Read the shipped default rather
        // than trusting this file's memory of it.
        var src     = fs.readFileSync(SPEAKER, 'utf8');
        var m       = src.match(/opt\.mqConnectTimeout \|\| (\d+)/);
        assert.ok(m, 'could not read the shipped connect deadline');
        assert.ok(BLOCK_MS > Number(m[1]),
            'the block (' + BLOCK_MS + 'ms) must exceed the connect deadline (' + m[1]
            + 'ms), or this arm cannot exhibit the defect at all');
    });

    it('02.2 - a child blocking its loop for 3s after the dial still reaches the listener', function(t, done) {
        var script = path.join(home, 'slow-boot.js');
        fs.writeFileSync(script,
            'var logger = require(' + JSON.stringify(path.join(FW, 'lib/logger')) + ');\n'
            // Mimic a bundle mount: sync-block the loop right after the logger
            // (and its speaker dial) is constructed. The deadline is already
            // armed and goes overdue during this window.
            + 'var end = Date.now() + ' + BLOCK_MS + ';\n'
            + 'while (Date.now() < end) {}\n'
            + 'logger.info(' + JSON.stringify(MARKER) + ');\n'
            // REF'd hold: give the unref'd speaker socket time to flush.
            + 'setTimeout(function(){}, 800);\n'
        );

        var child     = spawn(process.execPath, [script], { env: childEnv(home) });
        var killTimer = setTimeout(function() { child.kill('SIGTERM'); }, CHILD_TIMEOUT_MS);

        child.on('exit', function(code, signal) {
            clearTimeout(killTimer);
            setTimeout(function() {
                try {
                    assert.equal(signal, null, 'child was killed — it did not exit on its own');
                    assert.ok(conns >= 1,
                        'no connection reached the collector at all — the dial itself failed');
                    assert.ok(received.indexOf(MARKER) > -1,
                        'the frame never arrived: the connect deadline destroyed a connection '
                        + 'the kernel had already established, because it read `connecting` from '
                        + 'the timers phase instead of deferring past poll (#B323)');
                    done();
                } catch (err) {
                    done(err);
                }
            }, 300);
        });
    });

});


// ---------------------------------------------------------------------------
// 03 — behaviour: the speaker comes back after the listener goes away
// ---------------------------------------------------------------------------
describe('03 - mq speaker: a listener that restarts is heard again', function() {

    var home, first, second, port;
    var beforeKill = '', afterRestart = '';
    var child = null;
    var accepted = [];
    var MARKER = 'B323-HEARTBEAT';

    before(function(t, done) {
        first = net.createServer(function(conn) {
            // Held so the restart below can DESTROY them. `server.close()` only
            // stops accepting — it leaves established connections up, so a
            // harness that just closes the server never puts the speaker in the
            // state this arm exists to test (measured: the arm then fails for
            // that harness reason, not for the defect).
            accepted.push(conn);
            conn.on('data', function(d) { beforeKill += d.toString(); });
            conn.on('error', function() {});
        });
        first.listen({ host: '127.0.0.1', port: 0 }, function() {
            port = first.address().port;
            home = makeHome('b323-reconnect', port);
            done();
        });
    });

    after(function() {
        if (child) { try { child.kill('SIGKILL'); } catch (e) {} }
        try { first.close(); }  catch (e) {}
        try { second.close(); } catch (e) {}
        try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
    });

    it('03.1 - frames flow, the listener dies and returns, and frames flow again', function(t, done) {
        // The child heartbeats on a REF'd interval, so it holds its own loop
        // open (as a bundle's HTTP server does) and the unref'd redial timer can
        // actually fire. No coordination with this process is needed: we watch
        // the two collectors instead of choreographing the child.
        var script = path.join(home, 'heartbeat.js');
        fs.writeFileSync(script,
            'var logger = require(' + JSON.stringify(path.join(FW, 'lib/logger')) + ');\n'
            + 'var n = 0;\n'
            + 'setInterval(function () { logger.info(' + JSON.stringify(MARKER) + ' + (++n)); }, 200);\n'
            + 'setTimeout(function () { process.exit(0); }, 18000);\n'
        );
        child = spawn(process.execPath, [script], { env: childEnv(home) });

        var deadline = Date.now() + 25000;

        /**
         * Polls until `test()` is true or the deadline passes.
         *
         * @inner
         * @param {function} test - Predicate.
         * @param {function} next - Called with (ok).
         * @returns {void}
         *
         * @example
         * waitFor(function () { return got; }, function (ok) { });
         */
        function waitFor(test, next) {
            if (test())            { return next(true); }
            if (Date.now() > deadline) { return next(false); }
            setTimeout(function () { waitFor(test, next); }, 100);
        }

        waitFor(function () { return beforeKill.indexOf(MARKER) > -1; }, function (gotFirst) {
            try {
                assert.ok(gotFirst, 'no frame arrived before the restart — the harness never '
                    + 'reached the state this arm is about to disturb');
            } catch (e) { return done(e); }

            // Kill the listener the way a daemon restart does: drop the
            // accepting server AND every established connection under it. The
            // second half is what the speaker actually observes.
            accepted.forEach(function (c) { try { c.destroy(); } catch (e) {} });
            accepted = [];
            first.close();
            first = null;

            // Rebind the SAME port — the child's settings named it, and a
            // speaker that resolved the port once must find the new listener.
            second = net.createServer(function(conn) {
                conn.on('data', function(d) { afterRestart += d.toString(); });
                conn.on('error', function() {});
            });

            /**
             * Rebinds with a few retries — the just-closed port can linger.
             *
             * @inner
             * @param {number} tries - Remaining attempts.
             * @returns {void}
             *
             * @example
             * relisten(20);
             */
            function relisten(tries) {
                second.once('error', function (err) {
                    if (tries > 0 && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
                        return setTimeout(function () { relisten(tries - 1); }, 150);
                    }
                    done(err);
                });
                second.listen({ host: '127.0.0.1', port: port }, function () {
                    waitFor(function () { return afterRestart.indexOf(MARKER) > -1; }, function (gotSecond) {
                        try {
                            assert.ok(gotSecond,
                                'nothing arrived after the listener came back: the speaker dialled '
                                + 'once and stayed dead, which is exactly the state a daemon restart '
                                + 'used to leave a live bundle in (#B323)');
                            done();
                        } catch (err) {
                            done(err);
                        }
                    });
                });
            }
            relisten(20);
        });
    });

});


// ---------------------------------------------------------------------------
// 04 — behaviour: the reconnect loop must not resurrect the #B276 hang
// ---------------------------------------------------------------------------
describe('04 - mq speaker: retrying forever must not keep a process alive', function() {

    var home, deadPort, scriptPlain, scriptHeld;

    before(function(t, done) {
        // An ephemeral port we bind and immediately release: as close to
        // "certainly nothing listening" as a test can get without guessing.
        var probe = net.createServer();
        probe.listen({ host: '127.0.0.1', port: 0 }, function() {
            deadPort = probe.address().port;
            probe.close(function() {
                home = makeHome('b323-noexit', deadPort);

                scriptPlain = path.join(home, 'plain.js');
                fs.writeFileSync(scriptPlain,
                    'require(' + JSON.stringify(path.join(FW, 'lib/logger')) + ');\n'
                );

                // CONTROL: identical plus one deliberate handle. MUST be killed —
                // otherwise "the plain child exited" cannot be distinguished from
                // "this harness could not detect a hang in the first place".
                scriptHeld = path.join(home, 'held.js');
                fs.writeFileSync(scriptHeld,
                    'require(' + JSON.stringify(path.join(FW, 'lib/logger')) + ');\n'
                    + 'setInterval(function(){}, 1000);\n'
                );
                done();
            });
        });
    });

    after(function() {
        try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
    });

    /**
     * Runs one child under the isolated home, bounded by the harness timeout.
     *
     * @inner
     * @param {string} script - Path to the child script.
     * @returns {object} The spawnSync result.
     *
     * @example
     * var r = run(scriptPlain);
     */
    function run(script) {
        return spawnSync(process.execPath, [script], {
            timeout  : 10000,
            encoding : 'utf8',
            env      : childEnv(home)
        });
    }

    it('04.1 - CONTROL: a child holding an extra handle is killed (the harness can see a hang)', function() {
        var r = run(scriptHeld);
        assert.equal(r.signal, 'SIGTERM',
            'the control child must be killed at timeout — if it exits on its own, '
            + 'this harness cannot detect a hang and 04.2 proves nothing');
    });

    it('04.2 - a child whose MQ port has no listener still exits on its own', function() {
        var r = run(scriptPlain);
        assert.equal(r.signal, null,
            'the child did not exit on its own (signal=' + r.signal + ') — the #B323 redial '
            + 'timer must be unref\'d, or every short-lived CLI now waits out the backoff');
        assert.equal(r.status, 0, 'expected a clean exit, got status ' + r.status);
    });

});
