/**
 * Boot-path exit-flush guard.
 *
 * The launcher (bin/gina-container) and the framework boot path print a
 * diagnostic and then call `process.exit(1)`. `process.stdout`/`process.stderr`
 * are ASYNCHRONOUS when they are a pipe (a container log collector, or a test
 * harness that pipes the child's stdio) — so a `console.emerg(...)` /
 * `process.stdout.write(...)` immediately followed by `process.exit(1)` is
 * truncated: the process tears down before libuv drains the pipe. That is the
 * empty-log signature seen in the container-boot CI flake (exit 1, no captured
 * output) — the crash reason was lost, which blinds the bootDiagnostics() the
 * test prints.
 *
 * The fix flushes the diagnostic SYNCHRONOUSLY (fs.writeSync) before exiting, at
 * every boot-path exit site:
 *   - bin/gina-container        (every early exit, via the out() helper → fd 1)
 *   - core/gna.js              (abort, mount-symlink catch → fd 2)
 *   - core/server.js          (ServerEngine catch → fd 2)
 *   - core/server.isaac.js     (https-credentials catch → fd 2)
 *   - lib/proc.js             (invalid proc name → fd 2)
 *
 * §01 pins the launcher fix and PROVES it behaviourally (spawn under a real
 * pipe, assert the message survives). §02 pins the framework sites structurally;
 * the mechanism is identical to the behaviourally-proven launcher write, only on
 * fd 2 and in the inherited-stdio bundle child (same pipe).
 *
 * Run standalone:
 *   node --test test/core/boot-exit-flush.test.js
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var cp     = require('child_process');

var FW        = require('../fw');
var LAUNCHER  = path.resolve(__dirname, '../../bin/gina-container');
var GNA       = path.join(FW, 'core/gna.js');
var SERVER    = path.join(FW, 'core/server.js');
var ISAAC     = path.join(FW, 'core/server.isaac.js');
var PROC      = path.join(FW, 'lib/proc.js');


/**
 * Asserts that a synchronous flush token appears between an anchor and the next
 * `process.exit(1)` — i.e. the diagnostic is flushed before the exit.
 */
function flushPrecedesExit(src, anchor, flushToken, label) {
    var i = src.indexOf(anchor);
    assert.ok(i > -1, label + ': anchor not found (' + anchor + ')');
    var exitIdx = src.indexOf('process.exit(1)', i);
    assert.ok(exitIdx > -1, label + ': no process.exit(1) after the anchor');
    var slice = src.slice(i, exitIdx);
    assert.ok(
        slice.indexOf(flushToken) > -1,
        label + ': expected a synchronous flush "' + flushToken + '" before process.exit(1)'
    );
}


// ---------------------------------------------------------------------------
// 01 — Launcher (bin/gina-container)
// ---------------------------------------------------------------------------
describe('01 - bin/gina-container: synchronous flush before exit', function() {

    var src;
    before(function() { src = fs.readFileSync(LAUNCHER, 'utf8'); });

    it('defines a synchronous out() helper backed by fs.writeSync(1, ...)', function() {
        assert.match(
            src,
            /function out\(msg\)\s*\{[\s\S]{0,200}?fs\.writeSync\(1,\s*msg\)/,
            'expected out(msg) to wrap fs.writeSync(1, msg)'
        );
    });

    it('no bare async process.stdout.write( call remains — all diagnostics go through out()', function() {
        // The JSDoc mentions `process.stdout.write` in prose WITHOUT a call paren,
        // so a real CALL (process.stdout.write( ) must not appear anywhere.
        assert.doesNotMatch(
            src,
            /process\.stdout\.write\(/,
            'expected every process.stdout.write(...) call to be routed through out()'
        );
    });

    it('each early process.exit(1) is preceded by an out() write', function() {
        assert.match(src, /out\('Usage: gina-container[\s\S]{0,60}?process\.exit\(1\)/,
            'usage exit must out() first');
        assert.match(src, /out\([\s\S]{0,140}?not found\.[\s\S]{0,140}?process\.exit\(1\)/,
            'projects.json-not-found exit must out() first');
        assert.match(src, /out\('\[ gina-container \] bundle entry point not found:[\s\S]{0,80}?process\.exit\(1\)/,
            'entry-point-not-found exit must out() first');
    });

    it('BEHAVIOURAL: an early-exit diagnostic survives a PIPED stdout (exit 1, non-empty capture)', { timeout: 20000 }, async function() {
        var H = path.join(os.tmpdir(), 'gina-cb-flush-' + process.pid + '-' + Date.now());
        fs.mkdirSync(H, { recursive: true });
        var env = Object.assign({}, process.env, { HOME: H, GINA_LOG_STDOUT: 'true' });
        delete env.GINA_HOMEDIR;   // derive ~/.gina from the isolated HOME

        var captured = '';
        var result = await new Promise(function(resolve) {
            // A brand-new HOME has no projects.json → the launcher hits the
            // "projects.json not found" early exit. Pre-fix that message was lost
            // to the async pipe (empty capture); post-fix it must survive.
            var child = cp.spawn(process.execPath, [LAUNCHER, 'demo', '@nope' + Date.now()], {
                env: env, stdio: ['ignore', 'pipe', 'pipe']
            });
            child.stdout.on('data', function(d) { captured += d; });
            child.stderr.on('data', function(d) { captured += d; });
            child.on('exit', function(code, signal) { resolve({ code: code, signal: signal }); });
            child.on('error', function(e) { resolve({ code: null, error: e.message }); });
        });

        try { fs.rmSync(H, { recursive: true, force: true }); } catch (e) { /* ignore */ }

        assert.equal(result.code, 1, 'expected exit code 1 on a missing project' +
            (result.error ? ' (spawn error: ' + result.error + ')' : ''));
        assert.ok(
            captured.length > 0,
            'expected a NON-EMPTY diagnostic on the piped stream — the flush fix. ' +
            'An empty capture is the pre-fix container-boot truncation signature.'
        );
        assert.match(
            captured, /not found|not registered/,
            'expected the missing-project diagnostic in the captured output, got: ' + JSON.stringify(captured.slice(0, 200))
        );
    });

});


// ---------------------------------------------------------------------------
// 02 — Framework boot exit-sites (sync flush precedes process.exit(1))
// ---------------------------------------------------------------------------
describe('02 - framework boot exit-sites: fs.writeSync flush precedes process.exit(1)', function() {

    var gna, server, isaac, proc;
    before(function() {
        gna    = fs.readFileSync(GNA, 'utf8');
        server = fs.readFileSync(SERVER, 'utf8');
        isaac  = fs.readFileSync(ISAAC, 'utf8');
        proc   = fs.readFileSync(PROC, 'utf8');
    });

    it('gna.js abort(): flush precedes exit, console.emerg retained', function() {
        assert.match(
            gna,
            /fs\.writeSync\(2, '\[ FRAMEWORK \] abort: '[\s\S]{0,160}?process\.exit\(1\);/,
            'expected the abort fs.writeSync flush immediately before process.exit(1)'
        );
        assert.match(gna, /console\.emerg\(err\.stack\|\|err\)/, 'abort must keep its console.emerg');
    });

    it('gna.js mount-symlink catch: flush precedes exit, console.emerg retained', function() {
        flushPrecedesExit(gna, 'var _mountMsg', 'fs.writeSync(2, _mountMsg', 'gna.js mount');
        assert.match(gna, /console\.emerg\(_mountMsg\)/, 'mount must keep its console.emerg');
    });

    it('server.js ServerEngine catch: flush precedes exit, console.emerg retained', function() {
        flushPrecedesExit(server, 'var _engineMsg', 'fs.writeSync(2, _engineMsg', 'server.js ServerEngine');
        assert.match(server, /console\.emerg\(_engineMsg\)/, 'ServerEngine must keep its console.emerg');
    });

    it('server.isaac.js https-credentials catch: flush precedes exit, console.emerg retained', function() {
        flushPrecedesExit(isaac, 'var _credMsg', 'fs.writeSync(2, _credMsg', 'server.isaac.js creds');
        assert.match(isaac, /console\.emerg\(_credMsg\)/, 'creds catch must keep its console.emerg');
    });

    it('proc.js invalid-proc-name: flush precedes exit, console.error retained', function() {
        flushPrecedesExit(proc, 'var _procMsg', 'fs.writeSync(2, _procMsg', 'proc.js procname');
        assert.match(proc, /console\.error\(_procMsg\)/, 'procname must keep its console.error');
    });

    it('all four framework boot files still require fs (the flush dependency)', function() {
        assert.match(gna,    /require\(['"]fs['"]\)/, 'gna.js must require fs');
        assert.match(server, /require\(['"]fs['"]\)/, 'server.js must require fs');
        assert.match(isaac,  /require\(['"]fs['"]\)/, 'server.isaac.js must require fs');
        assert.match(proc,   /require\(['"]fs['"]\)/, 'proc.js must require fs');
    });

});
