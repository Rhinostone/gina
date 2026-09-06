'use strict';
/**
 * #B491 (b) — `Shell::run()` (lib/shell.js) must refuse a non-function callback
 * AT THE CALLER'S LINE, on BOTH of its handles.
 *
 * Measured before the fix, on the real class (`todo/b491-harness/drive-shell.js`,
 * transcripts `shell-str.out` / `shell-null.out` / `shell-ondata.out`):
 * `new Shell().run('echo b491', true).onComplete('oops')` AND `.onData('oops')`
 * both register without a throw, the command completes, and the resulting
 * `TypeError: callback is not a function` is caught by the spawn `close`
 * handler's own try/catch and merely logged through the gina logger — the
 * caller's delivery never arrives (4-s timeout, exit 4), while the function
 * control fires `CB fired err=false out=b491`.
 *
 * Both handles wrap the callback inside their listener, which is what makes
 * them silent — unlike `helpers/task.js`'s `onData`, which hands the callback
 * straight to `e.once` and so already fails fast with Node's own
 * `ERR_INVALID_ARG_TYPE` (#B491 (a) left it alone for that reason). Here the
 * principle « guard what is silent » covers both.
 *
 * §01 — source pins (lib/shell.js): the two guards and their placement.
 * §02 — behavioural, driving the REAL Shell on `echo`. `Shell::run` spawns with
 *       `{ cwd: root }` and never calls `process.chdir`, so no cwd restore is
 *       needed; it does read the `GINA_TMPDIR` global (unset under a bare
 *       bootstrap) for its out/err log files.
 *
 * NOTE ON PLACEMENT: unlike (a)'s positional-callback guard, a registration
 * guard here necessarily runs AFTER the spawn — the fluent shape is
 * `run(...).onComplete(cb)`, so the command is already started by the time the
 * handle is called. There is deliberately no "guard precedes the side effects"
 * pin in this file; that claim would be false.
 */

var assert    = require('node:assert');
var fs        = require('node:fs');
var os        = require('node:os');
var path      = require('node:path');
var describe  = require('node:test').describe;
var it        = require('node:test').it;

var FW   = require('../fw');
var ROOT = path.resolve(FW, '..', '..');
var SRC  = fs.readFileSync(path.join(FW, 'lib/shell.js'), 'utf8');

describe('01 - #B491 (b) source pins: Shell::run guards both handles at registration', function() {

    it('onComplete throws a TypeError naming Shell::run and the received type, before registering the listener', function() {
        assert.match(
            SRC,
            /e\.onComplete\s*=\s*function\s*\(callback\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*if\s*\(\s*typeof\s*\(\s*callback\s*\)\s*!=\s*'function'\s*\)\s*\{\s*throw new TypeError\('Shell::run — onComplete expects a function, got '\s*\+\s*\(\s*callback\s*===\s*null\s*\?\s*'null'\s*:\s*typeof\s*\(\s*callback\s*\)\s*\)\);?\s*\}\s*(?:\/\/[^\n]*\n\s*)*e\.once\('run#complete'/,
            '#B491 (b): a non-function was swallowed by the close handler try/catch — fail fast at the caller\'s line, mirroring run() (#B491 (a)) and Controller::store / Controller::query'
        );
    });

    it('onData throws the same way, before registering either of its two listeners', function() {
        assert.match(
            SRC,
            /e\.onData\s*=\s*function\s*\(callback\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*if\s*\(\s*typeof\s*\(\s*callback\s*\)\s*!=\s*'function'\s*\)\s*\{\s*throw new TypeError\('Shell::run — onData expects a function, got '\s*\+\s*\(\s*callback\s*===\s*null\s*\?\s*'null'\s*:\s*typeof\s*\(\s*callback\s*\)\s*\)\);?\s*\}\s*(?:\/\/[^\n]*\n\s*)*e\.once\('run#data'/,
            '#B491 (b): Shell wraps onData too (unlike helpers/task.js, whose onData is direct) — so it is silent and needs the guard'
        );
    });

    it('control — both handles still deliver through the same wrapped e.once listeners, and run() still returns the emitter', function() {
        assert.match(SRC, /e\.once\('run#complete',\s*function\(err,\s*data\)\s*\{\s*callback\(err,\s*data\)/, 'onComplete listener shape unchanged (control)');
        assert.match(SRC, /e\.once\('run#err',\s*function\(err,\s*data\)\s*\{\s*callback\(err,\s*data\)/, 'onData error listener shape unchanged (control)');
        assert.match(SRC, /return e\s*\}/, 'run() still returns the emitter (control)');
    });
});

describe('02 - #B491 (b) behavioural: the real Shell on echo', function() {

    require(path.join(ROOT, 'utils/helper'));
    var lib = require(path.join(FW, 'lib'));
    assert.equal(typeof lib.Shell, 'function', 'lib.Shell is the registered constructor (harness control)');

    function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'b491b-')); }

    // `Shell::run` reads the GINA_TMPDIR global for its out/err log files (unset
    // under a bare bootstrap) and captures it synchronously at call time. Give
    // every run its OWN directory: a completed run unlinks `out.log`, and the
    // spawns started by the throwing arms are still in flight, so a single
    // shared GINA_TMPDIR lets one arm delete the log another is still reading —
    // measured, as a delivery of (false, null) in the onComplete control.
    function shell() {
        var tmp = mkTmp();
        global.GINA_TMPDIR = mkTmp();
        var sh = new lib.Shell();
        sh.setOptions({ chdir: tmp });
        return sh;
    }

    // Resolve on the first delivery; reject rather than hang if nothing arrives.
    function firstCall(register) {
        return new Promise(function(resolve, reject) {
            var t = setTimeout(function() { reject(new Error('nothing delivered in 8s')); }, 8000);
            register(function() {
                clearTimeout(t);
                resolve(Array.prototype.slice.call(arguments));
            });
        });
    }

    it('onComplete("oops") throws at registration, naming Shell::run and the type', function() {
        assert.throws(
            function() { shell().run('echo b491', true).onComplete('oops'); },
            /^TypeError: Shell::run — onComplete expects a function, got string$/
        );
    });

    it('onComplete(null) names null (typeof null would read "object")', function() {
        assert.throws(function() { shell().run('echo b491', true).onComplete(null); }, /got null$/);
    });

    it('onComplete(42) names number', function() {
        assert.throws(function() { shell().run('echo b491', true).onComplete(42); }, /got number$/);
    });

    it('onData("oops") throws too — Shell wraps it, so it was silent as well', function() {
        assert.throws(
            function() { shell().run('echo b491', true).onData('oops'); },
            /^TypeError: Shell::run — onData expects a function, got string$/
        );
    });

    it('onData(null) names null', function() {
        assert.throws(function() { shell().run('echo b491', true).onData(null); }, /got null$/);
    });

    it('control — a function onComplete still delivers (err, output)', async function() {
        var args = await firstCall(function(cb) { shell().run('echo b491', true).onComplete(cb); });
        assert.strictEqual(args[0], false, 'no error on a successful echo');
        assert.match(String(args[1]), /b491/);
    });

    it('control — a function onData still delivers the streamed result', async function() {
        var args = await firstCall(function(cb) { shell().run('echo b491', true).onData(cb); });
        assert.match(String(args[0]), /b491/);
    });
});
