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


// ---------------------------------------------------------------------------
// 03 — config.js + proc.js:319 — the boot exit-sites the 2d99ac60 sweep MISSED
// ---------------------------------------------------------------------------
// The gina logger writes via async process.stdout.write, so a console.emerg /
// console.error followed by process.exit (or a dismiss-driven SIGTERM exit) can
// truncate on a loaded pipe — the SAME mechanism §01 proves for the launcher.
// 2d99ac60 flushed gna.js / server.js / server.isaac.js / proc.js:procname but
// left config.js (the primary boot-config-failure path) and proc.js:319 (the
// uncaughtException handler) unflushed. These pins lock the completion sweep.
describe('03 - config.js + proc.js:319 boot exit-sites: sync flush before exit/dismiss', function() {

    var config, proc;
    before(function() {
        config = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');
        proc   = fs.readFileSync(PROC, 'utf8');
    });

    it('config.js core-content read catch: flush precedes exit', function() {
        flushPrecedesExit(config, 'var _coreMsg', 'fs.writeSync(2, _coreMsg', 'config.js core read');
    });
    it('config.js loadBundlesConfiguration err: flush precedes the (deferred) exit', function() {
        flushPrecedesExit(config, 'var _bundlesMsg', 'fs.writeSync(2, _bundlesMsg', 'config.js bundles load');
    });
    it('config.js getServerCoreConf catch: flush precedes exit', function() {
        flushPrecedesExit(config, 'var _coreConfCtx', 'fs.writeSync(2, _coreConfCtx', 'config.js getServerCoreConf');
    });
    it('config.js protocol/scheme inconsistency: flush precedes exit', function() {
        flushPrecedesExit(config, 'Protocol or scheme settings inconsistency found in', 'fs.writeSync(2,', 'config.js protocol inconsistency');
    });
    it('config.js bad-routing-syntax: flush precedes exit', function() {
        flushPrecedesExit(config, 'var _routeMsg', 'fs.writeSync(2, _routeMsg', 'config.js routing syntax');
    });
    it('config.js env-block refusal: flush precedes the callback-driven exit (#B278)', function() {
        // Deliberately NOT flushPrecedesExit(): this site exits via
        // `return callback(new Error(...))`, not a literal process.exit(1). The
        // shared helper slices from its anchor to the NEXT `process.exit(1)` in
        // the file, which here lies far below in unrelated code — so the slice
        // would span most of config.js and the assertion would pass no matter
        // where (or whether) the flush sat. A helper that cannot fail is not a
        // pin. Anchor on the callback that IS this site's exit instead.
        var i = config.indexOf('var _envBlockMsg');
        assert.ok(i > -1, 'config.js: _envBlockMsg anchor not found');
        var cbIdx = config.indexOf('return callback(new Error(_envBlockMsg))', i);
        assert.ok(cbIdx > -1, 'config.js: no callback exit after _envBlockMsg');
        var slice = config.slice(i, cbIdx);
        assert.ok(slice.indexOf('fs.writeSync(2, _envBlockMsg') > -1,
            'expected a synchronous flush before the callback that ends this boot — ' +
            'without it the refusal can be lost to the async pipe, which is what made ' +
            'config-envjson-failfast §04b intermittently unable to see its own message');
        assert.match(slice, /console\.error\(/,
            'the env-block refusal must keep its console.error alongside the flush');
    });

    it('config.js requires fs (the flush dependency)', function() {
        assert.match(config, /require\(['"]fs['"]\)/, 'config.js must require fs');
    });

    it('proc.js:319 uncaughtException: sync flush precedes dismiss(SIGTERM), console.emerg retained', function() {
        var i = proc.indexOf('var _uncaughtMsg');
        assert.ok(i > -1, 'proc.js: _uncaughtMsg anchor not found');
        var dismissIdx = proc.indexOf("dismiss(pid, 'SIGTERM')", i);
        assert.ok(dismissIdx > -1, 'proc.js: no dismiss(pid, SIGTERM) after _uncaughtMsg');
        var slice = proc.slice(i, dismissIdx);
        assert.ok(slice.indexOf('fs.writeSync(2, _uncaughtMsg') > -1,
            'expected a synchronous flush before dismiss(SIGTERM)');
        assert.match(slice, /console\.emerg\(/, 'proc.js:319 must keep its console.emerg alongside the flush');
    });

});


// ---------------------------------------------------------------------------
// 04 — gna.js:336 portsReverse lookup guard (cryptic TypeError -> actionable)
// ---------------------------------------------------------------------------
// The bare 4-level reversePorts[...][env][def_protocol][def_scheme] deref at
// module load threw a cryptic `TypeError: Cannot read properties of undefined`
// (exit 1, no actionable reason) on a desynced ports.reverse.json. The guard
// turns it into a clear, pipe-flushed diagnostic + clean exit.
describe('04 - gna.js portsReverse lookup guard', function() {
    var gna;
    before(function() { gna = fs.readFileSync(GNA, 'utf8'); });

    it('resolves the port via a null-guarded lookup', function() {
        assert.match(gna, /port\s*=\s*\(\s*_byProto\s*&&\s*typeof\(_byProto\[scheme\]\)/,
            'expected a guarded port resolution (_byProto && typeof check)');
        assert.match(gna, /if\s*\(\s*port\s*==\s*null\s*\)\s*\{/, 'expected an if (port == null) fail-fast guard');
    });
    it('the guard emits an actionable message and flushes before exit', function() {
        flushPrecedesExit(gna, 'var _portMsg', 'fs.writeSync(2, _portMsg', 'gna.js port guard');
        assert.match(gna, /could not resolve the listening port for/, 'expected an actionable port-resolution message');
    });
    it('the bare unguarded 4-level reversePorts deref is gone', function() {
        assert.doesNotMatch(gna,
            /\[env\]\[projects\[projectName\]\['def_protocol'\]\]\[projects\[projectName\]\['def_scheme'\]\]/,
            'the bare unguarded reversePorts[...][env][def_protocol][def_scheme] chain should be replaced by the guard');
    });
});
