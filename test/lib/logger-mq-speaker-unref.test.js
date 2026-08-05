/**
 * lib/logger/.../mq/speaker.js — the MQ speaker's socket must not hold the event loop.
 *
 * #B276. The logger is a load-time singleton: `lib/index.js` requires it eagerly
 * (deliberately, as a singleton) and `lib/logger/src/main.js` invokes `Logger()`
 * at module scope. Its default flows are `['default', 'mq']`, so `mq/index.js`
 * constructs an MQSpeaker — and `speaker.js` opens a TCP connection — as a side
 * effect of merely requiring the framework.
 *
 * That matters on a boot which is about to fail. `require('gina')` outside a
 * bundle context reaches the logger BEFORE it reaches the contextless-boot throw
 * (#B277), so by the time the error is raised the socket is already open. The
 * published contract for that boot is that it THROWS — `index.mjs`'s own docblock
 * says "the framework bootstrap expects the bundle context and throws without it"
 * — and a throw is recoverable. Without `unref`, it is not: the caller catches
 * the error and the process still cannot exit, because the socket keeps the loop
 * alive. Wrapping the require in try/catch is the obvious mitigation and it does
 * not work.
 *
 * The failure is LISTENER-CONTINGENT, which is what makes it expensive rather
 * than rare: with nothing bound to the MQ port the connection is refused and the
 * handle closes itself, so the process exits and the bug is invisible. With a
 * listener present — the normal state of a machine running gina bundles, and of
 * CI — the process hangs with no output until something kills it.
 *
 * Tests are two-layered, per the convention in mq-listener-bun-port.test.js:
 *   (a) source-inspection — `client.unref()` is present in startMQSpeaker and
 *       anchored to the createConnection it applies to (a bare "file contains
 *       unref" pin would survive the call being moved to an unrelated socket);
 *   (b) behaviour — a child process that connects to a real listener still
 *       exits, driven against an isolated GINA_HOMEDIR so the real ~/.gina is
 *       never read or written.
 *
 * (b) carries its own two-sided control: a sibling child that holds an extra
 * handle open MUST be killed by the same harness. Without it, "the child exited"
 * cannot be distinguished from "the harness cannot detect a hang at all".
 */

'use strict';

var fs     = require('fs');
var os     = require('os');
var net    = require('net');
var path   = require('path');
var { spawnSync } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW      = require('../fw');
var REPO    = path.resolve(__dirname, '..', '..');
var SPEAKER = path.join(FW, 'lib/logger/src/containers/mq/speaker.js');

var CHILD_TIMEOUT_MS = 8000;


// ---------------------------------------------------------------------------
// 01 — source: the speaker unrefs the socket it just opened
// ---------------------------------------------------------------------------
describe('01 - mq speaker: the connection is unref\'d', function() {

    var code;
    before(function() {
        // Comment lines are stripped before pinning. A bare "the file contains
        // client.unref()" assertion is satisfied by a COMMENTED-OUT call — verified
        // by subtracting the fix, where the pin stayed green against
        // `// client.unref();` while the behavioural arm correctly went red. That
        // is the documented positive-existence-pin trap (architecture/jsdoc.md):
        // the literal survives in the comment, so the pin cannot fail.
        code = fs.readFileSync(SPEAKER, 'utf8')
                 .split('\n')
                 .filter(function(line) { return !/^\s*\/\//.test(line); })
                 .join('\n');
    });

    it('01.1 - calls client.unref() in live code, not in a comment', function() {
        assert.match(
            code, /^\s*client\.unref\(\);/m,
            'speaker.js must unref the MQ socket so it cannot hold the event loop open'
        );
    });

    it('01.2 - the unref applies to the socket createConnection returned', function() {
        // Structural anchor: the unref must sit after the createConnection that
        // assigns `client`, and before the error handler registered on it. A
        // char-distance or file-wide pin would pass if the call were moved onto
        // some other socket, which is the regression that actually matters.
        var open   = code.indexOf('var client = net.createConnection(');
        var unref  = code.indexOf('client.unref()');
        var onErr  = code.indexOf("client.on('error'");

        assert.ok(open  > -1, 'expected the createConnection assigning `client`');
        assert.ok(unref > -1, 'expected a client.unref() call');
        assert.ok(onErr > -1, 'expected the error handler on `client`');
        assert.ok(unref > open,  'unref must follow the createConnection it applies to');
        assert.ok(unref < onErr, 'unref must be applied before the error handler is wired');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: a speaker connected to a real listener still lets the
//      process exit (and the harness can prove it would notice if it did not)
// ---------------------------------------------------------------------------
describe('02 - mq speaker: a connected speaker does not outlive its process', function() {

    var home, server, port, scriptPlain, scriptHeld;

    before(async function() {
        // Isolated home — the speaker honours process.env.GINA_HOMEDIR (the #B160
        // three-tier read), so it resolves OUR settings.json and never the real
        // ~/.gina. shortVersion is the first two components of the package version,
        // matching speaker.js's own derivation.
        var version      = require(path.join(REPO, 'package.json')).version;
        var shortVersion = version.split('.').slice(0, 2).join('.');

        home = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b276-'));
        fs.mkdirSync(path.join(home, shortVersion), { recursive: true });

        server = net.createServer(function(socket) { /* accept and hold */ });
        await new Promise(function(resolve) {
            server.listen(0, '127.0.0.1', resolve);
        });
        port = server.address().port;

        fs.writeFileSync(
            path.join(home, shortVersion, 'settings.json'),
            JSON.stringify({ mq_port: port, host_v4: '127.0.0.1', bind_host: '127.0.0.1' })
        );

        // Requires the logger only — enough to construct the speaker and open
        // the socket, without needing a bundle context.
        scriptPlain = path.join(home, 'plain.js');
        fs.writeFileSync(scriptPlain,
            'require(' + JSON.stringify(path.join(FW, 'lib/logger')) + ');\n'
        );

        // CONTROL: identical, plus one deliberate handle. MUST be killed —
        // otherwise "the plain child exited" proves nothing about the harness.
        scriptHeld = path.join(home, 'held.js');
        fs.writeFileSync(scriptHeld,
            'require(' + JSON.stringify(path.join(FW, 'lib/logger')) + ');\n'
            + 'setInterval(function(){}, 1000);\n'
        );
    });

    after(function() {
        if (server) server.close();
        try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
    });

    function run(script) {
        return spawnSync(process.execPath, [script], {
            timeout  : CHILD_TIMEOUT_MS,
            encoding : 'utf8',
            env      : Object.assign({}, process.env, {
                GINA_HOMEDIR : home,
                // Must NOT set GINA_LOG_STDOUT: it splices `mq` out of the flows,
                // so no socket would be opened and the test would pass vacuously.
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

    it('02.2 - a child whose speaker connected to a live listener exits on its own', function() {
        var r = run(scriptPlain);
        assert.equal(r.signal, null,
            'the MQ socket kept the event loop alive (signal=' + r.signal + ') — '
            + 'speaker.js must unref it');
        assert.equal(r.status, 0, 'expected a clean exit, got status ' + r.status);
    });

});


// ---------------------------------------------------------------------------
// 03 — behaviour: the contextless-boot failure names the boundary (#B277)
// ---------------------------------------------------------------------------
describe('03 - contextless require(\'gina\') fails with a diagnostic message', function() {

    var result;
    before(function() {
        var script = path.join(os.tmpdir(), 'gina-b277-probe-' + process.pid + '.js');
        var out    = path.join(os.tmpdir(), 'gina-b277-out-' + process.pid + '.json');
        // The result goes to a FILE, not stdout: requiring gina loads the logger,
        // which writes its own lines to stdout (the MQ connect notice, or the
        // ECONNREFUSED warn), so stdout is not a clean channel for a JSON payload.
        fs.writeFileSync(script,
            'var fs = require("fs");\n'
            + 'var caught = null;\n'
            + 'try { require("gina"); } catch (e) { caught = e.message; }\n'
            + 'fs.writeFileSync(' + JSON.stringify(out) + ', JSON.stringify({ caught: caught }));\n'
        );
        spawnSync(process.execPath, [script], {
            timeout  : CHILD_TIMEOUT_MS,
            encoding : 'utf8',
            env      : Object.assign({}, process.env, {
                NODE_PATH : path.join(REPO, 'node_modules')
            })
        });
        result = JSON.parse(fs.readFileSync(out, 'utf8'));
        try { fs.unlinkSync(script); } catch (e) {}
        try { fs.unlinkSync(out); } catch (e) {}
    });

    it('03.1 - still throws (the boundary is intended, and fail-fast here is deliberate)', function() {
        assert.ok(result.caught, 'requiring gina outside a bundle context must throw');
    });

    it('03.2 - names the boundary rather than an internal path-registry call', function() {
        assert.match(result.caught, /bundle context/i,
            'the message must name the boundary that was hit');
        assert.doesNotMatch(result.caught, /^setPath\(/,
            'the opaque setPath("gina.home", ...) failure must not be what surfaces');
    });

    it('03.3 - points at the supported alternative', function() {
        assert.match(result.caught, /createTestInstance/,
            'the message should route the reader to the supported way to exercise '
            + 'controller code without booting a bundle');
    });

});
