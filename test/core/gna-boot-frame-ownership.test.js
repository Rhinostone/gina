/**
 * #B406 — the boot frame (onGettingProjectConfig) owns its own failures.
 *
 * core/gna.js invokes its boot callback as `async function
 * onGettingProjectConfig(err, project)`. Because the callback is async, a
 * synchronous throw anywhere in its direct frame surfaces as a promise
 * REJECTION, never an exception — so the caller's try/catch inside
 * getProjectConfiguration() (which was written for a plain callback) can
 * never see it, and the process-level unhandledRejection net only logs at
 * error level: no `[ emerg` marker for start.js's stdout-only startup
 * watchdog, no exit. Pre-fix, a boot-time crash in that frame left the
 * process alive but never started — the daemon's 60-second startup timer was
 * the only terminal, with no cause attached.
 *
 * The fix wraps the whole direct frame in try/catch and routes every failure
 * into abort() — the existing boot terminal (console.emerg + synchronous
 * stderr flush + process.exit(1)) — after coercing non-Error rejections,
 * because abort() reads err.stack through branches that assume an
 * Error-shaped value and would itself throw on `throw null`.
 *
 * gna.js boots a bundle at require time, so the real module is PINNED, not
 * loaded: section 01 locks the shape in source; section 02 executes verbatim
 * replicas of the caller + callback shape, including a SUBTRACT arm that
 * reproduces the pre-fix escape (the defect this file exists to prevent) and
 * a CONTROL arm locking the caller's unchanged plain-callback contract.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var SRC = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');

// Escaped rejections from the SUBTRACT arm land here instead of crashing the
// runner. Keyed by message so arms stay independent.
var escapedRejections = [];
process.on('unhandledRejection', function (reason) {
    escapedRejections.push(reason);
});

/** @returns {Promise<void>} resolves after pending microtasks + one tick */
var tick = function () { return new Promise(function (r) { setImmediate(r); }); };


describe('01 - source pins: the boot frame is owned', function () {

    var hdrIdx = SRC.indexOf('async function onGettingProjectConfig(err, project) {');
    var eoIdx  = SRC.indexOf('});//EO onDoneGettingProjectConfiguration');

    it('anchors exist (the pins below cannot pass vacuously)', function () {
        assert.ok(hdrIdx > -1, 'callback header not found');
        assert.ok(eoIdx > hdrIdx, 'EO close marker not found after the header');
    });

    it('a try opens the frame: first `try {` after the header precedes the `if (err)` head', function () {
        var tryIdx   = SRC.indexOf('try {', hdrIdx);
        var ifErrIdx = SRC.indexOf('if (err)', hdrIdx);
        assert.ok(tryIdx > -1 && ifErrIdx > -1);
        assert.ok(tryIdx < ifErrIdx,
            'the owning try must open BEFORE the first statement of the frame');
    });

    it('exactly one `} catch (bootErr) {` exists file-wide, inside the frame, before the EO close', function () {
        assert.equal(SRC.split('} catch (bootErr) {').length - 1, 1);
        var catchIdx = SRC.indexOf('} catch (bootErr) {');
        assert.ok(catchIdx > hdrIdx && catchIdx < eoIdx);
    });

    it('the catch block delegates to abort() after coercing non-Error rejections, and never re-enters', function () {
        var catchIdx = SRC.indexOf('} catch (bootErr) {', hdrIdx);
        var blk = SRC.slice(catchIdx, eoIdx);
        assert.ok(blk.indexOf('!(bootErr instanceof Error)') > -1, 'non-Error coercion guard missing');
        assert.ok(blk.indexOf('abort(bootErr)') > -1, 'terminal delegation missing');
        // coercion must PRECEDE the delegation (abort() throws on null.stack)
        assert.ok(blk.indexOf('!(bootErr instanceof Error)') < blk.indexOf('abort(bootErr)'));
        // terminal-only: no re-entry into the callback or its caller
        assert.ok(blk.indexOf('onGettingProjectConfig(') < 0, 're-entry into the callback');
        assert.ok(blk.indexOf('getProjectConfiguration(') < 0, 're-entry into the caller');
    });

    it('abort() — the delegated terminal — carries the marker + sync flush + non-zero exit', function () {
        var aIdx = SRC.indexOf('var abort = function(err, bundle) {');
        assert.ok(aIdx > -1, 'abort definition not found');
        var aEnd = SRC.indexOf('\n};', aIdx);
        var aBlk = SRC.slice(aIdx, aEnd);
        assert.ok(aBlk.indexOf('console.emerg(') > -1,
            'abort must log at emerg — start.js:478 matches /(\\[|\\[\\s+)emerg/ on child stdout');
        assert.ok(aBlk.indexOf('fs.writeSync(2,') > -1,
            'abort must flush synchronously before exit (pipes are async)');
        assert.ok(aBlk.indexOf('process.exit(1)') > -1,
            'abort must exit non-zero (never 0: restart-on-clean-exit semantics)');
    });

    it('the caller contract is untouched: getProjectConfiguration still try/catches its own body', function () {
        var gIdx = SRC.indexOf('gna.getProjectConfiguration = function (callback){');
        assert.ok(gIdx > -1);
        var gBlk = SRC.slice(gIdx, hdrIdx);
        assert.ok(gBlk.indexOf('callback(false, project)') > -1);
        assert.ok(gBlk.indexOf('} catch (err) {') > -1);
    });
});


describe('02 - replica: every failure in the owned frame reaches the terminal', function () {

    // Verbatim replica of gna.getProjectConfiguration's shape (gna.js:644):
    // its own try wraps the success invocation; its catch invokes callback(err).
    var makeCaller = function (spies) {
        return function getProjectConfigurationReplica(callback) {
            var project = { ok: true };
            try {
                callback(false, project);
            } catch (err) {
                spies.callerCatch.push(err);
                callback(err);
            }
        };
    };

    // Verbatim replica of the FIXED frame shape: async callback whose whole
    // body sits in try, catch coerces non-Errors then delegates to abort().
    // `body` stands in for the ~1470-line direct frame.
    var makeFixedCallback = function (spies, body) {
        return async function onGettingProjectConfigReplica(err, project) {
        try {
            if (err) { spies.errHead.push(err); }
            await body(err, project);
            spies.completed.push(true);
        } catch (bootErr) {
            if ( !(bootErr instanceof Error) ) {
                bootErr = new Error('boot frame rejected with a non-Error value: ' + String(bootErr));
            }
            spies.terminal.push(bootErr);   // stands in for abort(bootErr): emerg + flush + exit(1)
        }
        };
    };

    var freshSpies = function () {
        return { terminal: [], callerCatch: [], errHead: [], completed: [] };
    };

    it('02.1 - a SYNC throw in the frame reaches the terminal; net and caller-catch stay silent', async function () {
        var spies = freshSpies();
        var before = escapedRejections.length;
        makeCaller(spies)(makeFixedCallback(spies, function () {
            throw new Error('B406-arm-02.1 sync boot crash');
        }));
        await tick();
        assert.equal(spies.terminal.length, 1);
        assert.match(spies.terminal[0].message, /B406-arm-02\.1/);
        assert.equal(spies.callerCatch.length, 0, 'the caller catch must NOT see an async callback throw');
        assert.equal(escapedRejections.length, before, 'nothing may escape to the net');
    });

    it('02.2 - an AWAITED rejection reaches the same terminal (the future prefetch seam)', async function () {
        var spies = freshSpies();
        var before = escapedRejections.length;
        makeCaller(spies)(makeFixedCallback(spies, function () {
            return Promise.reject(new Error('B406-arm-02.2 awaited boot failure'));
        }));
        await tick();
        assert.equal(spies.terminal.length, 1);
        assert.match(spies.terminal[0].message, /B406-arm-02\.2/);
        assert.equal(escapedRejections.length, before);
    });

    it('02.3 - success path: terminal silent, the frame completes', async function () {
        var spies = freshSpies();
        makeCaller(spies)(makeFixedCallback(spies, function () { return Promise.resolve(); }));
        await tick();
        assert.equal(spies.terminal.length, 0);
        assert.equal(spies.completed.length, 1);
    });

    it('02.4 - a non-Error rejection is coerced to an Error BEFORE the terminal (abort() reads .stack)', async function () {
        var spies = freshSpies();
        makeCaller(spies)(makeFixedCallback(spies, function () {
            throw null;   // the pathological shape that would make abort() itself throw
        }));
        await tick();
        assert.equal(spies.terminal.length, 1);
        assert.ok(spies.terminal[0] instanceof Error);
        assert.match(spies.terminal[0].message, /non-Error value: null/);
    });

    it('02.5 - SUBTRACT: the pre-fix bare async shape lets the rejection ESCAPE to the net', async function () {
        // Runs in a CHILD process: node:test attributes a rejection raised
        // inside a test's async scope to the test itself, so the escape can
        // only be observed where the real one happens — at a process-level
        // unhandledRejection handler (the gna.js net's exact shape).
        var os = require('os');
        var cp = require('child_process');
        var fixture = path.join(os.tmpdir(), 'gina-b406-subtract-' + process.pid + '-' + Date.now() + '.js');
        fs.writeFileSync(fixture, [
            "process.on('unhandledRejection', function (reason) {",
            "    process.stdout.write('NET:' + (reason && reason.message || reason) + '\\n');",
            "});",
            "var callerCatch = 0, terminal = 0;",
            "// verbatim pre-fix replica: the caller's try/catch + a BARE async callback",
            "var getProjectConfigurationReplica = function (callback) {",
            "    var project = { ok: true };",
            "    try { callback(false, project); } catch (err) { callerCatch++; callback(err); }",
            "};",
            "getProjectConfigurationReplica(async function bareOnGettingProjectConfigReplica(err, project) {",
            "    throw new Error('B406-arm-02.5 escapes to the net');",
            "});",
            "setTimeout(function () {",
            "    process.stdout.write('CALLER_CATCH:' + callerCatch + ' TERMINAL:' + terminal + '\\n');",
            "}, 50);"
        ].join('\n'));
        var out = await new Promise(function (resolve) {
            var child = cp.spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] });
            var buf = '';
            child.stdout.on('data', function (d) { buf += d; });
            child.on('close', function () { resolve(buf); });
        });
        try { fs.unlinkSync(fixture); } catch (_e) { /* best-effort */ }
        assert.match(out, /NET:B406-arm-02\.5/, 'the rejection must reach the process-level net');
        assert.match(out, /CALLER_CATCH:0/, 'the caller catch cannot see it either — that is the defect');
        assert.match(out, /TERMINAL:0/, 'no terminal exists in the pre-fix shape');
    });

    it('02.6 - CONTROL: a plain (non-async) callback that throws IS caught by the caller', function () {
        var spies = freshSpies();
        var reentered = [];
        makeCaller(spies)(function plainCallback(err, project) {
            if (err) { reentered.push(err); return; }
            throw new Error('B406-arm-02.6 plain throw');
        });
        assert.equal(spies.callerCatch.length, 1, 'the caller catch must fire for a plain callback');
        assert.match(spies.callerCatch[0].message, /B406-arm-02\.6/);
        assert.equal(reentered.length, 1, 'the caller catch re-invokes the callback with the error');
    });
});
