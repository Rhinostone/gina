/**
 * lib/logger/.../mq/speaker.js — a stalled MQ dial must not hold the event loop.
 *
 * #B318, and it is the third state of the #B276 story rather than a new one.
 * `logger-mq-speaker-unref.test.js` covers the two states that fix considered:
 * a connect that COMPLETES (unref'd handle, process still exits) and one that is
 * REFUSED (reachable host, nothing listening — the peer sends RST and the handle
 * closes itself). The comment `client.unref()` carries in the source says exactly
 * that: "with nothing there the connection is refused and the handle closes
 * itself."
 *
 * The state neither covers is an UNREACHABLE host — powered off, black-holed by a
 * firewall, or simply a stale `host_v4` left behind by a DHCP reassignment. Such
 * a peer answers nothing at all, so the dial neither completes nor errors: it sits
 * pending for the OS connect timeout, ~75s on macOS. And `socket.unref()` does not
 * cover that wait, because what holds the loop is not the socket HANDLE but the
 * pending `TCPConnectWrap` REQUEST — `process._getActiveRequests()` reports it
 * while `_getActiveHandles()` shows only the (already unref'd) socket. So the
 * process hangs for the full window, which is precisely the hang #B276 set out to
 * remove, surviving in the one state its fix and its comment did not enumerate.
 *
 * Measured on the shipped mechanism, dialing RFC 5737 TEST-NET-1 (192.0.2.1),
 * which is reserved and routed nowhere:
 *   unref() alone .................. 75.03s   (the OS connect timeout)
 *   unref() + an unref'd deadline ... 2.04s   (the fix)
 *
 * The deadline is itself `unref`'d, so it never keeps the loop alive on its own
 * account: it can only fire while something ELSE is holding the loop open, which
 * during a stalled dial is exactly the connect request it exists to cancel.
 *
 * ⚠️ #B320 changed what settings can make the speaker dial. host_v4 (and a
 * foreign bind_host) are no longer inputs of the dial — the speaker resolves
 * through resolveLocalDialHost, so a settings file naming an unreachable
 * foreign host now yields an instant LOCAL refusal instead of a pending
 * connect. Consequences for this file:
 *   - the §01 pins keep their full weight: the deadline stays in the shipped
 *     source as defense-in-depth (the pending-connect state would need a
 *     currently-assigned local address that swallows SYNs — exotic, but the
 *     guard is already paid for);
 *   - §02 can no longer steer the shipped speaker into a pending connect via
 *     settings, so it now locks the #B320 exit guarantee instead: a child
 *     whose settings name a FOREIGN host in BOTH keys must still exit
 *     promptly, because the dial never leaves the host. The DELIVERY side of
 *     #B320 (frames arriving at the local listener) is covered by
 *     logger-mq-speaker-local-dial.test.js.
 *
 * ⚠️ #B323 changed WHEN the deadline reaches its verdict, and the §01 pins now
 * guard that shape. The guard used to read `client.connecting` straight from
 * the TIMERS phase, which precedes POLL — so on a boot that blocked the loop
 * past the deadline it read `true` on a connection the kernel had already
 * established, and destroyed a live speaker. The body now re-checks from a
 * `setImmediate` (CHECK phase, after poll), so a completed connect survives and
 * a genuinely pending one still dies on schedule. 01.3 keeps its full weight —
 * `connecting` remains the thing acted on — and 01.6 became end-anchored
 * because the added nesting outgrew its fixed window. The RECONNECT half of
 * #B323, and the blocked-boot delivery arm that discriminates the fix, live in
 * logger-mq-speaker-resilience.test.js.
 *
 * Two layers, per the convention of the #B276 file next to this one:
 *   (a) source-inspection — the deadline exists in LIVE code (comment lines are
 *       stripped first: the positive-existence-pin trap in architecture/jsdoc.md
 *       is real here, since the block is heavily commented), is unref'd, is
 *       anchored to the socket it guards, and is cleared on both settle paths so
 *       a healthy speaker is never destroyed under a live connection;
 *   (b) behaviour — a child whose speaker dials an unreachable address must still
 *       exit on its own, driven against an isolated GINA_HOMEDIR so the real
 *       ~/.gina is neither read nor written.
 *
 * ⚠️ HONEST LIMIT ON (b), stated because a green here can mean two different
 * things. The arm is NETWORK-CONTINGENT in the same way #B276's is
 * listener-contingent. Where 192.0.2.1 black-holes (a normal LAN, and the machine
 * this was developed on) the dial stalls and the arm is genuinely red before the
 * fix. Where the host instead has no route to that prefix, the connect fails fast
 * with ENETUNREACH and the child exits promptly WITH OR WITHOUT the fix — so the
 * arm passes vacuously and proves nothing. It cannot tell you which case you are
 * in. That is why (a) carries the load-bearing pins, and why the control below
 * matters: it proves only that the harness could see a hang, never that a hang was
 * possible on this host.
 */

'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync } = require('child_process');

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW      = require('../fw');
var REPO    = path.resolve(__dirname, '..', '..');
var SPEAKER = path.join(FW, 'lib/logger/src/containers/mq/speaker.js');

var CHILD_TIMEOUT_MS = 15000;

// RFC 5737 TEST-NET-1: reserved for documentation, routed nowhere on the public
// internet. A dial either black-holes (the case under test) or fails fast with
// ENETUNREACH — never reaches a real service, so this cannot generate traffic to
// a third party.
var UNREACHABLE_HOST = '192.0.2.1';


// ---------------------------------------------------------------------------
// 01 — source: the stalled dial is bounded, in live code
// ---------------------------------------------------------------------------
describe('01 - mq speaker: a stalled connect is bounded', function() {

    var code;
    before(function() {
        code = fs.readFileSync(SPEAKER, 'utf8')
                 .split('\n')
                 .filter(function(line) { return !/^\s*\/\//.test(line); })
                 .join('\n');
    });

    it('01.1 - a connect deadline is armed in live code, not in a comment', function() {
        assert.match(
            code, /^\s*var connectDeadline = setTimeout\(/m,
            'speaker.js must arm a deadline bounding the pending connect'
        );
    });

    it('01.2 - the deadline is unref\'d (it must not itself hold the loop open)', function() {
        assert.match(
            code, /^\s*connectDeadline\.unref\(\);/m,
            'an un-unref\'d deadline would keep every short-lived process alive for its '
            + 'full duration — trading a 75s hang for a shorter one'
        );
    });

    it('01.3 - it destroys the socket only while still connecting', function() {
        // Guarding on `connecting` is what keeps the deadline from tearing down a
        // healthy speaker if the clear is ever missed: once connected, the branch
        // is simply not taken.
        var idx = code.indexOf('var connectDeadline = setTimeout(');
        var body = code.slice(idx, idx + 400);
        assert.match(body, /client\.connecting/,
            'the deadline must act only on a dial that has not completed');
        assert.match(body, /client\.destroy\(/,
            'destroying the socket is what cancels the pending connect request');
    });

    it('01.4 - the deadline is armed on the socket it guards, before the error handler', function() {
        // Structural anchor, mirroring 01.2 of the #B276 file: a file-wide pin
        // would survive the deadline being moved onto some other socket.
        var open     = code.indexOf('var client = net.createConnection(');
        var deadline = code.indexOf('var connectDeadline = setTimeout(');
        var onErr    = code.indexOf("client.on('error'");

        assert.ok(open > -1,     'expected the createConnection assigning `client`');
        assert.ok(deadline > -1, 'expected the connect deadline');
        assert.ok(onErr > -1,    'expected the error handler on `client`');
        assert.ok(deadline > open,  'the deadline must follow the createConnection it guards');
        assert.ok(deadline < onErr, 'the deadline must be armed before the error handler is wired');
    });

    it('01.5 - the deadline is cleared on BOTH settle paths', function() {
        // Only clearing on `connect` would leave a refused dial (the #B276 state)
        // holding a live timer for the rest of the deadline window.
        assert.match(code, /client\.once\('connect',[\s\S]{0,80}?clearTimeout\(connectDeadline\)/,
            'a completed connect must clear the deadline');
        assert.match(code, /client\.once\('error',[\s\S]{0,80}?clearTimeout\(connectDeadline\)/,
            'a refused/errored dial must clear the deadline too');
    });

    it('01.6 - the timeout is overridable, with a bounded default', function() {
        // END-ANCHORED slice, not a fixed window. #B323 wrapped the deadline
        // body in a `setImmediate` (the phase-correct verify), which pushed the
        // `}, opt.mqConnectTimeout || 2000);` tail past a 400-char window and
        // failed this pin on correct code — the fixed-window brittleness
        // architecture/jsdoc.md documents, whose prescribed remedy is exactly
        // this: anchor on the arm's own closing `connectDeadline.unref();` so
        // the pin is independent of how large the body grows.
        var idx  = code.indexOf('var connectDeadline = setTimeout(');
        var end  = code.indexOf('connectDeadline.unref();', idx);
        assert.ok(idx > -1,       'expected the connect deadline');
        assert.ok(end  > idx,     'expected the deadline arm to be closed by its unref');
        var body = code.slice(idx, end);
        assert.match(body, /opt\.mqConnectTimeout \|\| \d+/,
            'the window should be tunable for a slow link, with a default');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: a speaker dialing an unreachable host still lets its process
//      exit (network-contingent — see the HONEST LIMIT note in the docblock)
// ---------------------------------------------------------------------------
describe('02 - mq speaker: an unreachable MQ host does not outlive its process', function() {

    var home, scriptPlain, scriptHeld;

    before(function() {
        var version      = require(path.join(REPO, 'package.json')).version;
        var shortVersion = version.split('.').slice(0, 2).join('.');

        home = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b318-'));
        fs.mkdirSync(path.join(home, shortVersion), { recursive: true });

        // No listener is created on purpose. BOTH keys name the unreachable
        // address: post-#B320 the speaker consults only the bind side, and a
        // foreign bind must be refused locally — so this settings file is the
        // poisoned shared-home shape, and the child's prompt exit proves the
        // dial never left the host. (Pre-#B320 this same file steered the
        // speaker into the pending-connect state the §01 deadline bounds.)
        fs.writeFileSync(
            path.join(home, shortVersion, 'settings.json'),
            JSON.stringify({ mq_port: 8125, host_v4: UNREACHABLE_HOST, bind_host: UNREACHABLE_HOST })
        );

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
    });

    after(function() {
        try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
    });

    function run(script) {
        return spawnSync(process.execPath, [script], {
            timeout  : CHILD_TIMEOUT_MS,
            encoding : 'utf8',
            env      : Object.assign({}, process.env, {
                GINA_HOMEDIR : home,
                // Must NOT set GINA_LOG_STDOUT: it splices `mq` out of the flows,
                // so no socket would be opened and this would pass vacuously.
                NODE_PATH    : path.join(REPO, 'node_modules')
            })
        });
    }

    it('02.1 - CONTROL: a child holding an extra handle is killed (the harness can see a hang)', function() {
        var r = run(scriptHeld);
        assert.equal(r.signal, 'SIGTERM',
            'the control child must be killed at timeout — if it exits on its own, '
            + 'this harness cannot detect a hang and 02.2 proves nothing');
    });

    it('02.2 - a child whose settings name a FOREIGN host exits on its own (#B320 dials locally)', function() {
        var r = run(scriptPlain);
        assert.equal(r.signal, null,
            'the child did not exit on its own (signal=' + r.signal + ') — either the '
            + '#B320 local dial regressed (a foreign host was dialled and the pending '
            + 'connect held the loop) or the #B318 deadline no longer bounds a stall');
        assert.equal(r.status, 0, 'expected a clean exit, got status ' + r.status);
    });

});
