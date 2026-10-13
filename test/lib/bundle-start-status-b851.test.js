/**
 * #B851 / #B854 — the outcome `gina bundle:start` reports, and the wiring that carries it.
 *
 * `bundle:start` is the one command bin/cli sends to the framework daemon. The daemon ran
 * lib/cmd/bundle/start.js, wrote text back and ended the connection, and bin/cli exited 0 when
 * it ended, whatever had happened: measured on develop be7245c8c, a crash, a port another
 * program holds, the 64 s timeout, a refusal and a bundle already running all exited 0; a
 * second start while the bundle ran also deleted that bundle's pid file (#B854). The daemon
 * now frames a header and the exit code (lib/cmd/bundle/inc/start-status.js), bin/cli exits
 * with that code, a bundle that already runs is found before the spawn, and core/server.js
 * ends the boot on a bind error (core/gna.js prints the readiness flag only once it listens).
 *
 * Sections:
 *   01 — the frames: encode, read across chunk splits, stray separators, foreign payloads
 *   02 — createCliState(): what bin/cli prints and exits with, with and without the header
 *   03 — exitCodeBeforeReady(): the bundle's own code, 128 + signal, 1 for an exit 0
 *   04 — parseBindFailure() and bindFailureMessage()
 *   05 — findRunningBundle(): the « already running » rule, through an injected probe
 *   06 — writeExit(): only a client bin/cmd marked
 *   07 — core/server.js watchBindOutcome(), extracted and driven with stubs
 *   08 — source pins (comment lines removed): bin/cli, bin/cmd, start.js, helper.js and init.js
 *        (an online refusal ends its client, not the daemon: #B855), server.js, gna.js
 *
 * Red-first: every section fails on the pre-fix tree (the module, the server.js function and
 * the wiring are absent). The daemon paths end to end (S0–S11 of the #B851 sandbox) and a
 * booted bundle (test/integration/container-boot-bind-error-b851.test.js) are the acceptance.
 *
 * Run: node --test test/lib/bundle-start-status-b851.test.js
 */
'use strict';

var fs     = require('fs');
var path   = require('path');
var { EventEmitter } = require('events');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var REPO        = path.resolve(__dirname, '..', '..');
var FW          = require('../fw');
var MODULE_PATH = path.join(FW, 'lib/cmd/bundle/inc/start-status.js');
var START_PATH  = path.join(FW, 'lib/cmd/bundle/start.js');
var RESTART_PATH = path.join(FW, 'lib/cmd/bundle/restart.js');
var HELPER_PATH = path.join(FW, 'lib/cmd/helper.js');
var INIT_PATH   = path.join(FW, 'lib/cmd/framework/init.js');
var SERVER_PATH = path.join(FW, 'core/server.js');
var GNA_PATH    = path.join(FW, 'core/gna.js');
var CLI_PATH    = path.join(REPO, 'bin/cli');
var CMD_PATH    = path.join(REPO, 'bin/cmd');

var RS = '\u001e';

/**
 * Loads the module on demand, so each section reports on its own when it is absent.
 *
 * @returns {object} The module's exports
 */
function ss() {
    return require(MODULE_PATH);
}

/**
 * Removes whole-line comments (the idiom of test/lib/bundle-start-boot-lines.test.js), so a
 * pin cannot be met by a `// was:` line.
 *
 * @param {string} source
 * @returns {string}
 */
function live(source) {
    return source.split('\n').filter(function (l) {
        var t = l.trim();
        return !(t.indexOf('//') === 0 || t.indexOf('/*') === 0 || t.indexOf('*') === 0);
    }).join('\n');
}

/**
 * Feeds `text` to a fresh reader in slices of `size` characters.
 *
 * @param {string} text
 * @param {number} size
 * @returns {{text: string, reader: object}}
 */
function feed(text, size) {
    var r = ss().createStatusReader(), out = '';
    for (var i = 0; i < text.length; i += size) {
        out += r.push(text.slice(i, i + size));
    }
    out += r.flush();
    return { text: out, reader: r };
}


// ---------------------------------------------------------------------------
// 01 — the frames
// ---------------------------------------------------------------------------

describe('01 - the frames', function () {

    var STREAM = RS + 'gina-status:1' + RS + '\n\rTrying to start bundle [ api@shop ]  [ api@shop ] started V(-.o)V' + RS + 'gina-exit:0' + RS;

    it('encodes the header and the exit code between two record separators', function () {
        assert.equal(ss().encodeHeader(), RS + 'gina-status:1' + RS);
        assert.equal(ss().encodeExit(0), RS + 'gina-exit:0' + RS);
        assert.equal(ss().encodeExit(137), RS + 'gina-exit:137' + RS);
    });

    it('an exit code is an integer from 0 to 255; anything else is 1', function () {
        var n = ss().normalizeCode;
        assert.equal(n(0), 0);
        assert.equal(n(255), 255);
        assert.equal(n(256), 1);
        assert.equal(n(-1), 1);
        assert.equal(n(1.5), 1);
        assert.equal(n('3'), 1);
        assert.equal(n(null), 1);
        assert.equal(ss().encodeExit('x'), RS + 'gina-exit:1' + RS);
    });

    it('reads the frames out of one chunk and keeps the text', function () {
        var got = feed(STREAM, STREAM.length);
        assert.equal(got.text, '\n\rTrying to start bundle [ api@shop ]  [ api@shop ] started V(-.o)V');
        assert.equal(got.reader.hasHeader(), true);
        assert.equal(got.reader.exitCode(), 0);
    });

    it('reads the same whatever the chunk boundaries (every slice size from 1 to 40)', function () {
        for (var size = 1; size <= 40; size++) {
            var got = feed(STREAM, size);
            assert.equal(got.text, '\n\rTrying to start bundle [ api@shop ]  [ api@shop ] started V(-.o)V', 'slice size ' + size);
            assert.equal(got.reader.hasHeader(), true, 'slice size ' + size);
            assert.equal(got.reader.exitCode(), 0, 'slice size ' + size);
        }
    });

    it('CONTROL — text with no frame passes unchanged, and reads no header and no code', function () {
        var got = feed('Scope: local\nEnv: dev\n', 5);
        assert.equal(got.text, 'Scope: local\nEnv: dev\n');
        assert.equal(got.reader.hasHeader(), false);
        assert.equal(got.reader.exitCode(), null);
    });

    it('a payload that is not ours passes through as text, separators included', function () {
        var got = feed('a' + RS + 'other:1' + RS + 'b', 3);
        assert.equal(got.text, 'a' + RS + 'other:1' + RS + 'b');
        assert.equal(got.reader.exitCode(), null);
    });

    it('a stray separator is text, and does not hold back the output for long', function () {
        var long = 'x'.repeat(200);
        var r = ss().createStatusReader();
        var out = r.push('before' + RS + long);
        assert.equal(out, 'before' + RS + long, 'more than 64 characters after an opening separator: it is text');
        var r2 = ss().createStatusReader();
        assert.equal(r2.push('tail' + RS + 'gina-ex'), 'tail', 'a possible frame split across chunks is held');
        assert.equal(r2.flush(), RS + 'gina-ex', 'and returned as text when the stream ends there');
    });

    it('an exit payload that is not a 1-3 digit number is text', function () {
        var got = feed(RS + 'gina-exit:abc' + RS, 4);
        assert.equal(got.text, RS + 'gina-exit:abc' + RS);
        assert.equal(got.reader.exitCode(), null);
    });
});


// ---------------------------------------------------------------------------
// 02 — createCliState()
// ---------------------------------------------------------------------------

describe('02 - createCliState(): what bin/cli prints and exits with', function () {

    var EADDR_LINE = '[error  ][web@p] Error: listen EADDRINUSE: address already in use :::11970\n';
    var INSPECTOR  = 'Starting inspector on 0.0.0.0:10528 failed: address already in use\n';

    it('with the header: the bundle\'s bind error does not end the command early, and asks for no hint', function () {
        var st = ss().createCliState();
        var a = st.onData(RS + 'gina-status:1' + RS + 'Trying to start bundle [ web@p ]');
        assert.equal(a.print, 'Trying to start bundle [ web@p ]');
        var b = st.onData(EADDR_LINE);
        assert.equal(b.endNow, false);
        assert.equal(b.hint, false, 'the debugger hint is for the inspector line only');
        assert.equal(b.print, EADDR_LINE);
    });

    it('with the header: the inspector line asks for the hint once, and the command goes on', function () {
        var st = ss().createCliState();
        st.onData(RS + 'gina-status:1' + RS);
        var a = st.onData(INSPECTOR);
        assert.equal(a.hint, true);
        assert.equal(a.endNow, false);
        assert.equal(st.onData(INSPECTOR).hint, false, 'once');
    });

    it('with the header: the process exits with the trailer\'s code', function () {
        var st = ss().createCliState();
        st.onData(RS + 'gina-status:1' + RS + 'x');
        st.onData('  [ web@p ] could not start: port 11970 is held by another program' + RS + 'gina-exit:1' + RS);
        var end = st.onEnd();
        assert.equal(end.code, 1);
        assert.equal(end.message, null);
    });

    it('with the header and no trailer: 1, and a line saying the framework ended the command first', function () {
        var st = ss().createCliState();
        st.onData(RS + 'gina-status:1' + RS + 'Project [nosuch] not found in your projects list\n');
        var end = st.onEnd();
        assert.equal(end.code, 1);
        assert.match(end.message, /ended this command before it reported the outcome/);
    });

    it('CONTROL — without the header (an older daemon): `address already in use` ends at once with the hint, and the exit is 0', function () {
        var st = ss().createCliState();
        var a = st.onData('Trying to start bundle [ web@p ]');
        assert.equal(a.endNow, false);
        var b = st.onData(EADDR_LINE);
        assert.equal(b.endNow, true);
        assert.equal(b.hint, true);
        assert.equal(st.onEnd().code, 0);
    });

    it('CONTROL — without the header, a plain start exits 0 and prints everything', function () {
        var st = ss().createCliState();
        assert.equal(st.onData('  [ web@p ] started V(-.o)V').print, '  [ web@p ] started V(-.o)V');
        var end = st.onEnd();
        assert.equal(end.code, 0);
        assert.equal(end.print, '');
    });
});


// ---------------------------------------------------------------------------
// 03 — exitCodeBeforeReady()
// ---------------------------------------------------------------------------

describe('03 - exitCodeBeforeReady(): the code for a bundle that stopped before it was ready', function () {

    it('its own code when it is not 0', function () {
        assert.equal(ss().exitCodeBeforeReady(3, null), 3);
        assert.equal(ss().exitCodeBeforeReady(143, null), 143);
    });

    it('1 when it exited 0', function () {
        assert.equal(ss().exitCodeBeforeReady(0, null), 1);
    });

    it('128 + the signal number for a signal', function () {
        var signals = require('os').constants.signals;
        assert.equal(ss().exitCodeBeforeReady(null, 'SIGKILL'), 128 + signals.SIGKILL);
        assert.equal(ss().exitCodeBeforeReady(null, 'SIGTERM'), 128 + signals.SIGTERM);
    });

    it('1 for a signal with no known number, and for a code out of range', function () {
        assert.equal(ss().exitCodeBeforeReady(null, 'SIGNOTASIGNAL'), 1);
        assert.equal(ss().exitCodeBeforeReady(300, null), 1);
        assert.equal(ss().exitCodeBeforeReady(null, null), 1);
    });
});


// ---------------------------------------------------------------------------
// 04 — parseBindFailure() and bindFailureMessage()
// ---------------------------------------------------------------------------

describe('04 - the bind failure', function () {

    it('reads the port and the code from server.js\'s stderr line and from its emerg line', function () {
        assert.deepEqual(ss().parseBindFailure('[ FRAMEWORK ] abort: could not listen on port 11970: EADDRINUSE (listen EADDRINUSE: address already in use :::11970)\n'), { port: '11970', code: 'EADDRINUSE' });
        assert.deepEqual(ss().parseBindFailure('\u001b[35m[2026 Oct 13] [emerg  ][web@p] [ SERVER ] could not listen on port 80: EACCES (listen EACCES: permission denied 0.0.0.0:80) \u001b[39m'), { port: '80', code: 'EACCES' });
    });

    it('CONTROL — the engine\'s own logged error is not the bind failure (it is not server.js\'s line)', function () {
        assert.equal(ss().parseBindFailure('[error  ][web@p] Error: listen EADDRINUSE: address already in use :::11970'), null);
        assert.equal(ss().parseBindFailure('  [ web@p ] started V(-.o)V'), null);
    });

    it('EADDRINUSE: another program holds the port, and outside Windows the finder command follows', function () {
        var m = ss().bindFailureMessage('api@shop', { port: '3100', code: 'EADDRINUSE' }, false);
        assert.equal(m, '  [ api@shop ] could not start: port 3100 is held by another program, not a running gina bundle api@shop.\n  Find the holder: lsof -nP -iTCP:3100 -sTCP:LISTEN');
        var w = ss().bindFailureMessage('api@shop', { port: '3100', code: 'EADDRINUSE' }, true);
        assert.equal(w.indexOf('lsof'), -1, 'no lsof on Windows');
    });

    it('another code is named', function () {
        assert.equal(ss().bindFailureMessage('api@shop', { port: '80', code: 'EACCES' }, false), '  [ api@shop ] could not start: it could not listen on port 80 (EACCES).');
    });
});


// ---------------------------------------------------------------------------
// 05 — findRunningBundle()
// ---------------------------------------------------------------------------

describe('05 - findRunningBundle(): the « already running » rule', function () {

    var psTitles = require(path.join(FW, 'lib/cmd/framework/inc/ps-titles.js'));

    /**
     * A probe whose readings are given: `seen` is what readPidTitle() would return, `live`
     * what signal 0 would.
     */
    function probe(seen, live) {
        return {
            parsePid : psTitles.parsePid,
            read     : function () { return seen; },
            alive    : function () { return live; }
        };
    }
    var ENTRY = '/srv/shop/src/api/index.js';

    it('a running process titled `gina: <bundle>@<project>` is the bundle', function () {
        assert.equal(ss().findRunningBundle('4242\n', 'api@shop', ENTRY, probe({ title: 'gina:', command: 'gina: api@shop', zombie: false }, true)), 4242);
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe({ title: 'gina:', command: 'gina: api@shop   ', zombie: false }, true)), 4242, 'trailing spaces (Linux pads the title)');
    });

    it('a title that only starts like it is another bundle', function () {
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe({ title: 'gina:', command: 'gina: api@shop2', zombie: false }, true)), null);
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe({ title: 'gina:', command: 'gina: api2@shop', zombie: false }, true)), null);
    });

    it('a pid another program now has, a zombie, and a pid ps lists nothing for are not the bundle', function () {
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe({ title: '/bin/bash', command: '/bin/bash', zombie: false }, true)), null);
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe({ title: 'gina:', command: 'gina: api@shop', zombie: true }, true)), null);
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe(null, false)), null);
    });

    it('where ps cannot tell (undefined), the live pid decides', function () {
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe(undefined, true)), 4242);
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe(undefined, false)), null);
    });

    it('on Bun (no title), a process running the bundle\'s entry is the bundle', function () {
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe({ title: '/usr/local/bin/bun', command: '/usr/local/bin/bun ' + ENTRY + ' {"x":1} shop api', zombie: false }, true)), 4242);
        assert.equal(ss().findRunningBundle('4242', 'api@shop', ENTRY, probe({ title: '/usr/local/bin/bun', command: '/usr/local/bin/bun /srv/other/index.js', zombie: false }, true)), null);
    });

    it('no file, and a file that holds no pid, mean no running bundle', function () {
        var p = probe({ title: 'gina:', command: 'gina: api@shop', zombie: false }, true);
        assert.equal(ss().findRunningBundle(null, 'api@shop', ENTRY, p), null);
        assert.equal(ss().findRunningBundle('', 'api@shop', ENTRY, p), null);
        assert.equal(ss().findRunningBundle('-1', 'api@shop', ENTRY, p), null);
        assert.equal(ss().findRunningBundle('12abc', 'api@shop', ENTRY, p), null);
    });

    it('CONTROL — the real ps reading of this test process: alive, not a bundle', function (t) {
        var seen = psTitles.readPidTitle(process.pid);
        if (typeof seen === 'undefined') { t.skip('ps cannot read a title on this host'); return; }
        var real = { parsePid: psTitles.parsePid, read: psTitles.readPidTitle, alive: function () { return true; } };
        assert.equal(ss().findRunningBundle(String(process.pid), 'api@shop', ENTRY, real), null);
    });
});


// ---------------------------------------------------------------------------
// 06 — writeExit()
// ---------------------------------------------------------------------------

describe('06 - writeExit(): only a client bin/cmd marked', function () {

    function client(extra) {
        var c = { written: [], destroyed: false, write: function (s) { this.written.push(s); return true; } };
        return Object.assign(c, extra || {});
    }

    it('a marked client gets the trailer', function () {
        var c = client({ ginaStatusFrames: true });
        assert.equal(ss().writeExit(c, 1), true);
        assert.deepEqual(c.written, [RS + 'gina-exit:1' + RS]);
    });

    it('an unmarked client (process.stdout for an offline command) and a destroyed one get nothing', function () {
        var a = client();
        assert.equal(ss().writeExit(a, 1), false);
        assert.deepEqual(a.written, []);
        var b = client({ ginaStatusFrames: true, destroyed: true });
        assert.equal(ss().writeExit(b, 1), false);
        assert.deepEqual(b.written, []);
    });

    it('a write that throws is swallowed', function () {
        var c = client({ ginaStatusFrames: true, write: function () { throw new Error('write after end'); } });
        assert.equal(ss().writeExit(c, 1), false);
    });
});


// ---------------------------------------------------------------------------
// 07 — core/server.js watchBindOutcome(), driven
// ---------------------------------------------------------------------------

/**
 * Extracts `function watchBindOutcome(…) { … }` from server.js (the matching closing brace)
 * and compiles it with `console`, `fs` and `process` passed in: the three names it reads.
 *
 * @returns {?function} The function, or null when server.js has none
 */
function extractWatchBindOutcome() {
    var src = fs.readFileSync(SERVER_PATH, 'utf8');
    var at = src.indexOf('function watchBindOutcome(rawServer, port) {');
    if (at < 0) return null;
    var depth = 0, i = src.indexOf('{', at);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    var body = src.slice(at, i + 1);
    return new Function('console', 'fs', 'process', body + '\nreturn watchBindOutcome;');
}

describe('07 - core/server.js watchBindOutcome(): a bind error ends the boot, until the server listens', function () {

    function harness() {
        var calls = { emerg: [], stderr: [], exit: [] };
        var make = extractWatchBindOutcome();
        assert.ok(make, 'server.js defines no watchBindOutcome(rawServer, port)');
        var fn = make(
            { emerg: function (m) { calls.emerg.push(m); } },
            { writeSync: function (fd, s) { if (fd === 2) calls.stderr.push(s); } },
            { exit: function (c) { calls.exit.push(c); } }
        );
        return { fn: fn, calls: calls };
    }

    it('an error before listening: an emerg line, the abort line on stderr, exit 1', function () {
        var h = harness(), srv = new EventEmitter();
        assert.equal(h.fn(srv, 11970), true);
        var err = new Error('listen EADDRINUSE: address already in use :::11970');
        err.code = 'EADDRINUSE';
        srv.emit('error', err);
        assert.deepEqual(h.calls.exit, [1]);
        assert.equal(h.calls.stderr.length, 1);
        assert.equal(h.calls.stderr[0], '[ FRAMEWORK ] abort: could not listen on port 11970: EADDRINUSE (listen EADDRINUSE: address already in use :::11970)\n');
        assert.match(h.calls.emerg[0], /^\[ SERVER \] could not listen on port 11970: EADDRINUSE/);
        assert.deepEqual(ss().parseBindFailure(h.calls.stderr[0]), { port: '11970', code: 'EADDRINUSE' }, 'the line start.js reads');
    });

    it('once the server listens, the handler is gone: a later error is left to the engine', function () {
        var h = harness(), srv = new EventEmitter();
        h.fn(srv, 11970);
        srv.on('error', function () { /* the engine's own listener */ });
        srv.emit('listening');
        srv.emit('error', Object.assign(new Error('accept EMFILE'), { code: 'EMFILE' }));
        assert.deepEqual(h.calls.exit, []);
        assert.equal(srv.listenerCount('error'), 1, 'only the engine\'s own listener is left');
    });

    it('CONTROL — a server object without once/removeListener is left alone', function () {
        var h = harness();
        assert.equal(h.fn({ close: function () {} }, 1), false);
        assert.equal(h.fn(null, 1), false);
    });
});


// ---------------------------------------------------------------------------
// 08 — source pins
// ---------------------------------------------------------------------------

describe('08 - the wiring (comment lines removed)', function () {

    it('bin/cli reads the frames and exits with the outcome, not with 0', function () {
        var raw = fs.readFileSync(CLI_PATH, 'utf8'), code = live(raw);
        assert.match(code, /require\(frameworkPath \+ '\/lib\/cmd\/bundle\/inc\/start-status'\)\.createCliState\(\)/);
        var at = code.indexOf("client.on('end', function() {");
        assert.ok(at > -1, 'the end handler was not found');
        var handler = code.slice(at, code.indexOf('});', at));
        assert.match(handler, /process\.exit\(endState\.code\)/);
        assert.equal(handler.indexOf('process.exit(0)'), -1, 'no bare exit 0 in the end handler');
        assert.ok(raw.indexOf('was: process.exit(0)') > -1, 'CONTROL — the raw text still names what was replaced (the strip works)');
    });

    it('bin/cmd marks the connection and writes the header before it runs the command, and absorbs client errors', function () {
        var code = live(fs.readFileSync(CMD_PATH, 'utf8'));
        var iMark   = code.indexOf('conn.ginaStatusFrames = true;');
        var iHeader = code.indexOf("encodeHeader()");
        var iLoad   = code.indexOf('lib.cmd.load({', iMark);
        assert.ok(iMark > -1 && iHeader > iMark && iLoad > iHeader, 'mark ' + iMark + ' < header ' + iHeader + ' < load ' + iLoad);
        assert.match(code, /conn\.on\('error', function\(connErr\)/);
    });

    it('start.js: the « already running » check runs before the node_modules check and the spawn', function () {
        var code = live(fs.readFileSync(START_PATH, 'utf8'));
        var iFind  = code.indexOf('var runningPid = findRunning(bundle, appPath);');
        var iArch  = code.indexOf('checkArchAgainstNodeModules(opt, proceedToStart);');
        var iSpawn = code.indexOf('var child = spawn(');
        assert.ok(iFind > -1, 'findRunning() is not called');
        assert.ok(iFind < iSpawn && iFind < iArch, 'find ' + iFind + ' before spawn ' + iSpawn + ' and the arch check ' + iArch);
    });

    it('start.js: end() frames the exit code before it ends the client, in both modes', function () {
        var code = live(fs.readFileSync(START_PATH, 'utf8'));
        var at = code.indexOf('var end = function (opt, cmd, isBulkStart, i, error) {');
        assert.ok(at > -1, 'end() was not found');
        var body = code.slice(at, code.indexOf('var isRealApp = function', at));
        var writes = body.split('startStatus.writeExit(opt.client').length - 1;
        var emits  = body.split("opt.client.emit('end')").length - 1;
        assert.equal(writes, 2, 'one writeExit per branch');
        assert.equal(emits, 2);
        assert.ok(body.indexOf('startStatus.writeExit(opt.client') < body.indexOf("opt.client.emit('end')"), 'the trailer comes before the end');
    });

    it('start.js: the watchdog, the started branch, the emerg branch and the exit handler settle the attempt', function () {
        var code = live(fs.readFileSync(START_PATH, 'utf8'));
        // the watchdog, the emerg branch, the started branch, the dual-debug exit, the signal
        // exit and the early exit: six calls
        assert.ok(code.split('settle(').length - 1 >= 6, 'settle() is called on every path: ' + (code.split('settle(').length - 1));
        var iDog = code.indexOf("opt.client.write('Sorry my friend, this is taking too long ! Terminating. Check your logs.');");
        assert.ok(iDog > -1 && code.indexOf('settle(1);', iDog) > iDog, 'the watchdog settles with 1');
        var iStarted = code.indexOf("] started V(-.o)V'+ url + debuggerOn);");
        assert.ok(iStarted > -1 && code.indexOf('settle(0);', iStarted) > iStarted, 'the started branch settles with 0');
    });

    it('start.js: the dead EADDRINUSE branch is gone from the live code', function () {
        var raw = fs.readFileSync(START_PATH, 'utf8'), code = live(raw);
        assert.equal(code.indexOf('/EADDRINUSE.*port/i.test(data)'), -1);
        assert.ok(raw.indexOf('/EADDRINUSE.*port/i.test(data)') > -1, 'CONTROL — the raw text still holds it, commented out (the strip works)');
    });

    it('server.js: the bind is watched right after listen(), before `started` is emitted', function () {
        var code = live(fs.readFileSync(SERVER_PATH, 'utf8'));
        var iListen = code.indexOf('var _rawServer = self.instance.listen(');
        var iWatch  = code.indexOf('watchBindOutcome(process.server, ', iListen);
        var iEmit   = code.indexOf("self.emit('started', ", iListen);
        assert.ok(iListen > -1 && iWatch > iListen && iEmit > iWatch, 'listen ' + iListen + ' < watch ' + iWatch + ' < started ' + iEmit);
    });

    it('helper.js: online, exit() ends only its client, with the exit code framed, and marks the command (#B855)', function () {
        var code = live(fs.readFileSync(HELPER_PATH, 'utf8'));
        var at = code.indexOf('exit = function(errorMessage) {');
        assert.ok(at > -1, 'exit() was not found');
        var body = code.slice(at, code.indexOf('process.exit(1)', at) + 20);
        var iOnline = body.indexOf('if ( client && client.ginaStatusFrames === true ) {');
        var iMark   = body.indexOf('cmd.cmdExited = true;');
        var iFrame  = body.indexOf('startStatus.writeExit(client, errorMessage ? 1 : 0);');
        var iRet    = body.indexOf('return;', iFrame);
        var iExit   = body.indexOf('process.exit(1)');
        assert.ok(iOnline > -1 && iMark > iOnline && iFrame > iMark && iRet > iFrame, 'online branch: mark, frame, return');
        assert.ok(iRet < iExit, 'the online branch returns before the process.exit an offline command keeps');
    });

    it('helper.js: online, an invalid bundle name ends the client through exit(), not process.exit (#B855)', function () {
        var code = live(fs.readFileSync(HELPER_PATH, 'utf8'));
        var at = code.indexOf("console.error('[ ' + cmd.bundles[0] + ' ] is not a valid bundle name.');");
        assert.ok(at > -1, 'the invalid-name branch was not found');
        var region = code.slice(at, code.indexOf('process.exit(1)', at));
        assert.match(region, /client\.ginaStatusFrames === true/);
        assert.match(region, /exit\('\[ ' \+ cmd\.bundles\[0\] \+ ' \] is not a valid bundle name\.'\);\s*return false;/);
    });

    it('start.js: the handler stops when exit() marked the command (isCmdConfigured() is async; its Promise never failed the old guard)', function () {
        var code = live(fs.readFileSync(START_PATH, 'utf8'));
        var at = code.indexOf('isCmdConfigured();');
        assert.ok(at > -1, 'isCmdConfigured() is not called as a statement');
        assert.match(code.slice(at, at + 80), /isCmdConfigured\(\);\s*if \(self\.cmdExited\) return false;/);
        assert.equal(code.indexOf('if (!isCmdConfigured()) return false;'), -1, 'the old guard is gone from start.js');
    });

    it('init.js: online, the unknown-command and the handler-throw paths end the client with exit 1, not the daemon (#B855)', function () {
        var code = live(fs.readFileSync(INIT_PATH, 'utf8'));
        assert.match(code, /if \( opt\.isOnlineCommand \) \{\s*if \(opt\.client\) \{ startStatus\.writeExit\(opt\.client, 1\); opt\.client\.end\(\); \}\s*return;\s*\}/);
        var iCrit = code.indexOf("console.crit('Gina has some troubles with this command: gina '");
        var tail  = code.slice(iCrit, code.indexOf('process.exit(1);', iCrit) + 16);
        assert.match(tail, /if \( opt\.isOnlineCommand && opt\.client \) \{\s*startStatus\.writeExit\(opt\.client, 1\);\s*opt\.client\.end\(\);\s*return;\s*\}\s*process\.exit\(1\);/);
    });

    it('gna.js: the readiness flag waits for the server to listen', function () {
        var code = live(fs.readFileSync(GNA_PATH, 'utf8'));
        var iGate = code.indexOf("typeof(_flagServer.listening) == 'boolean' && !_flagServer.listening");
        assert.ok(iGate > -1, 'the flag is not gated on listening');
        var tail = code.slice(iGate, iGate + 700);
        assert.match(tail, /_flagServer\.once\('listening'/);
        assert.equal(tail.split("console.notice('[ FRAMEWORK ] Bundle started !');").length - 1, 2, 'printed on listening, or at once');
    });
});
