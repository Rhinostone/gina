/**
 * lib/archiver — per-call completion isolation and error ownership (#B473).
 *
 * The lib is a process-wide EventEmitter singleton, and every completion used to
 * be signalled by emitting one fixed event name on it, so two overlapping
 * compress() (or decompress()) calls released each other's onComplete with the
 * first finisher's result; the array branch also wrote its output stream to an
 * implicit global, so one run closed another's stream. Errors on the read
 * streams the lib creates were unowned: a single unreadable input crashed the
 * process on an unhandled 'error', a non-first one hung the run forever, and an
 * unwritable target crashed both branches.
 *
 * Every arm drives the REAL singleton on temp trees. Completion is captured
 * with the capture-all-plus-grace shape (a resolve-on-first wrapper cannot see
 * a double settle) under a bounded guard (a never-settling run FAILS, never
 * hangs the suite). Arms whose pre-fix behaviour is an uncaught exception run in
 * a child process so a regression cannot take the runner down. The archiver is
 * read through the GINA_ARCHIVER_MAIN seam so the arms can be validated
 * red-first against the pre-fix bytes without touching the working tree.
 */

'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var crypto = require('crypto');
var { spawnSync } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW          = require('../fw');
var MAIN_SOURCE = process.env.GINA_ARCHIVER_MAIN || path.join(FW, 'lib/archiver/src/main.js');
var mainSrc     = fs.readFileSync(MAIN_SOURCE, 'utf8');

var archiver = require(MAIN_SOURCE);
var JSZip    = require(path.join(FW, 'lib/archiver/src/dep/jszip.min.js'));
var IS_ROOT  = typeof process.getuid === 'function' && process.getuid() === 0;

var GRACE_MS = 250;   // window after the first delivery in which a double settle would show
var GUARD_MS = 8000;  // a run that has not settled by then is reported, not waited for

/**
 * Capture every delivery of a completion handle.
 *
 * @param {function} attach - receives the recorder callback, attaches it (via onComplete or a trailing cb)
 * @returns {Promise<{calls: Array<{err: *, target: *}>, timedOut: boolean}>}
 */
function capture(attach) {
    return new Promise(function (resolve) {
        var calls = [];
        var guard = setTimeout(function () { resolve({ calls: calls, timedOut: true }); }, GUARD_MS);
        attach(function (err, target) {
            calls.push({ err: err, target: target });
            if (calls.length === 1) {
                setTimeout(function () { clearTimeout(guard); resolve({ calls: calls, timedOut: false }); }, GRACE_MS);
            }
        });
    });
}

function entriesOf(zipPath) {
    return JSZip.loadAsync(fs.readFileSync(zipPath)).then(function (zip) {
        return Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
    });
}

function sizeOf(p) { try { return fs.statSync(p).size; } catch (e) { return -1; } }


// ---------------------------------------------------------------------------
// 01 — source shape
// ---------------------------------------------------------------------------

describe('01 - source shape', function () {

    it('completion is a per-call channel that settles at most once', function () {
        assert.match(mainSrc, /var createRun = function/);
        assert.match(mainSrc, /_settled/);
        // no handle registers on the singleton any more — that was the cross-delivery
        assert.doesNotMatch(mainSrc, /self\.once\('archiver-/);
    });

    it('the array branch output stream and the directory zip folder are locals', function () {
        assert.match(mainSrc, /var outputStream\s*=\s*run\.track\(fs\.createWriteStream\(/);
        assert.match(mainSrc, /var zipFolder\b/);
    });

    it('listens for the stream event that exists', function () {
        assert.doesNotMatch(mainSrc, /once\('err',/);
    });
});


// ---------------------------------------------------------------------------
// 02 — behavioural, in-process
// ---------------------------------------------------------------------------

describe('02 - overlapping calls settle their own caller', function () {

    var root, small, big;

    before(function () {
        root  = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-arch-iso-'));
        small = path.join(root, 'small.bin');
        big   = path.join(root, 'big.bin');
        fs.writeFileSync(small, crypto.randomBytes(1024));
        fs.writeFileSync(big,   crypto.randomBytes(2 * 1024 * 1024));   // incompressible: real work
        fs.mkdirSync(path.join(root, 'outA'));
        fs.mkdirSync(path.join(root, 'outB'));
    });
    after(function () {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    it('two concurrent compress() calls each receive their own archive, exactly once', async function () {
        var outA = path.join(root, 'outA') + '/';
        var outB = path.join(root, 'outB') + '/';
        var pA = capture(function (cb) {
            archiver.compress([{ input: small, output: 'small.bin' }], outA, { name: 'a', level: 1 }).onComplete(cb);
        });
        var pB = capture(function (cb) {
            archiver.compress([{ input: big, output: 'big.bin' }], outB, { name: 'b', level: 1 }).onComplete(cb);
        });
        var rA = await pA, rB = await pB;

        assert.equal(rA.timedOut, false, 'A settled');
        assert.equal(rB.timedOut, false, 'B settled');
        assert.equal(rA.calls.length, 1, 'A delivered exactly once');
        assert.equal(rB.calls.length, 1, 'B delivered exactly once');
        assert.equal(rA.calls[0].err, false);
        assert.equal(rB.calls[0].err, false);
        assert.equal(rA.calls[0].target, path.join(outA, 'a.zip'), 'A got its own target');
        assert.equal(rB.calls[0].target, path.join(outB, 'b.zip'), 'B got its own target, not A\'s');

        assert.ok(sizeOf(path.join(outB, 'b.zip')) > 2 * 1024 * 1024, 'B\'s archive was fully written, not left at 0 bytes');
        assert.deepEqual(await entriesOf(path.join(outA, 'a.zip')), ['small.bin']);
        assert.deepEqual(await entriesOf(path.join(outB, 'b.zip')), ['big.bin']);
    });

    it('an onComplete registered after the run settled is still delivered', async function () {
        var out = path.join(root, 'outA') + '/';
        var handle = archiver.compress([{ input: small, output: 'small.bin' }], out, { name: 'late', level: 1 });
        await new Promise(function (r) { setTimeout(r, 400); });   // the 1 KB run is long settled by now
        var res = await capture(function (cb) { handle.onComplete(cb); });
        assert.equal(res.timedOut, false, 'late registration was delivered');
        assert.equal(res.calls[0].err, false);
        assert.equal(res.calls[0].target, path.join(out, 'late.zip'));
    });

    it('a missing source reaches onComplete as an error (no synchronous emit into nothing)', async function () {
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, 'does-not-exist.bin'), path.join(root, 'outA') + '/', { name: 'm' }).onComplete(cb);
        });
        assert.equal(res.timedOut, false, 'the error was delivered');
        assert.ok(res.calls[0].err instanceof Error);
        assert.match(res.calls[0].err.message, /file not found/);
        // control: the same call shape on an existing source succeeds
        var ok = await capture(function (cb) {
            archiver.compress(small, path.join(root, 'outA') + '/', { name: 'ctl' }).onComplete(cb);
        });
        assert.equal(ok.timedOut, false);
        assert.equal(ok.calls[0].err, false);
    });

    it('the trailing-callback form works without a `method` in options, and with options omitted', async function () {
        var out = path.join(root, 'outA') + '/';
        var noMethod = await capture(function (cb) {
            archiver.compress([{ input: small, output: 'small.bin' }], out, { name: 'p1', level: 1 }, cb);
        });
        assert.equal(noMethod.timedOut, false, 'trailing cb fired although options carried no `method`');
        assert.equal(noMethod.calls[0].target, path.join(out, 'p1.zip'));

        var noOpts = await capture(function (cb) {
            archiver.compress([{ input: small, output: 'small.bin' }], out, cb);
        });
        assert.equal(noOpts.timedOut, false, 'compress(src, target, cb) fired');
        assert.equal(noOpts.calls[0].err, false);
        assert.equal(noOpts.calls[0].target, path.join(out, 'default.zip'));
    });

    it('the lib/async onCompleteCall bridge still promisifies the handle', async function () {
        var onCompleteCall = require(path.join(FW, 'lib/async'));   // module.exports = onCompleteCall
        var target = await onCompleteCall(
            archiver.compress([{ input: small, output: 'small.bin' }], path.join(root, 'outA') + '/', { name: 'bridge', level: 1 })
        );
        assert.equal(target, path.join(root, 'outA', 'bridge.zip'));
    });

    it('two concurrent decompress() calls each extract into their own target', async function () {
        var z1 = path.join(root, 'outA', 'a.zip');      // from the first arm: contains small.bin
        var z2 = path.join(root, 'outB', 'b.zip');      // contains big.bin
        var d1 = path.join(root, 'dz1') + '/';
        var d2 = path.join(root, 'dz2') + '/';
        var p1 = capture(function (cb) { archiver.decompress(z1, d1).onComplete(cb); });
        var p2 = capture(function (cb) { archiver.decompress(z2, d2).onComplete(cb); });
        var r1 = await p1, r2 = await p2;
        assert.equal(r1.timedOut, false); assert.equal(r2.timedOut, false);
        assert.equal(r1.calls.length, 1);  assert.equal(r2.calls.length, 1);
        assert.equal(r1.calls[0].target, d1, 'first decompress got its own target');
        assert.equal(r2.calls[0].target, d2, 'second decompress got its own target, not the first\'s');
        assert.ok(fs.existsSync(path.join(d1, 'small.bin')), 'first archive extracted');
        assert.ok(fs.existsSync(path.join(d2, 'big.bin')),   'second archive extracted');
    });

    it('the documented singleton event is still broadcast for observers (compatibility, passes before and after)', async function () {
        var seen = [];
        archiver.once('archiver-gzip#complete', function (err, target) { seen.push({ err: err, target: target }); });
        var res = await capture(function (cb) {
            archiver.compress([{ input: small, output: 'small.bin' }], path.join(root, 'outA') + '/', { name: 'obs', level: 1 }).onComplete(cb);
        });
        assert.equal(res.timedOut, false);
        assert.equal(seen.length, 1, 'the singleton observer heard the completion');
        assert.equal(seen[0].target, res.calls[0].target);
    });
});


describe('03 - a read error on an input the lib opened is delivered, not swallowed', { skip: IS_ROOT && 'mode bits do not bind root' }, function () {

    var root;

    before(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-arch-err-'));
        fs.mkdirSync(path.join(root, 'tree'));
        ['0-first.txt', 'a-ok.txt', 'z-locked.txt'].forEach(function (n) {
            fs.writeFileSync(path.join(root, 'tree', n), 'x');
        });
        fs.chmodSync(path.join(root, 'tree', 'z-locked.txt'), 0);
        fs.mkdirSync(path.join(root, 'out'));
    });
    after(function () {
        try { fs.chmodSync(path.join(root, 'tree', 'z-locked.txt'), 0o644); } catch (e) { /* best effort */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    it('array form, unreadable input that is not the only entry: the run settles with the error instead of hanging', async function () {
        var t = path.join(root, 'tree');
        var res = await capture(function (cb) {
            archiver.compress([
                { input: path.join(t, '0-first.txt'), output: '0-first.txt' },
                { input: path.join(t, 'a-ok.txt'),    output: 'a-ok.txt' },
                { input: path.join(t, 'z-locked.txt'), output: 'z-locked.txt' }
            ], path.join(root, 'out') + '/', { name: 'arr', level: 1 }).onComplete(cb);
        });
        assert.equal(res.timedOut, false, 'the run settled (it used to hang with a partial archive on disk)');
        assert.equal(res.calls.length, 1, 'settled exactly once');
        assert.equal(res.calls[0].err && res.calls[0].err.code, 'EACCES');
    });

    it('directory form, unreadable file that is not the first entry: same', async function () {
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, 'tree'), path.join(root, 'out') + '/', { name: 'dir', level: 1 }).onComplete(cb);
        });
        assert.equal(res.timedOut, false, 'the run settled');
        assert.equal(res.calls.length, 1, 'settled exactly once');
        assert.equal(res.calls[0].err && res.calls[0].err.code, 'EACCES');
    });
});


// ---------------------------------------------------------------------------
// 04 — arms whose pre-fix behaviour is an uncaught exception: child process
// ---------------------------------------------------------------------------

describe('04 - error paths that used to crash the process', { skip: IS_ROOT && 'mode bits do not bind root' }, function () {

    var root;

    var CHILD = [
        "var fs = require('fs'); var A = require(process.env.GINA_ARCHIVER_MAIN); var MODE = process.env.ARM; var R = process.env.ROOT;",
        "process.on('uncaughtException', function (e) { console.log('UNCAUGHT ' + (e.code || e.name)); process.exit(3); });",
        "var out = R + '/out_' + MODE + '/'; fs.mkdirSync(out);",
        "var cb = function (err, t) { console.log('DELIVERED ' + (err && (err.code || err.message)) + ' ' + t); };",
        "if (MODE === 'array-single')      A.compress([{ input: R + '/locked.bin', output: 'x.bin' }], out, { name: 'one', level: 1 }).onComplete(cb);",
        "if (MODE === 'single-file')       A.compress(R + '/locked.bin', out, { name: 'single', level: 1 }).onComplete(cb);",
        "if (MODE === 'unwritable-array')  { fs.chmodSync(out, 0o555); A.compress([{ input: R + '/ok.bin', output: 'ok.bin' }], out, { name: 'w', level: 1 }).onComplete(cb); }",
        "if (MODE === 'unwritable-dir')    { fs.chmodSync(out, 0o555); A.compress(R + '/tree', out, { name: 'wd', level: 1 }).onComplete(cb); }",
        "setTimeout(function () { process.exit(0); }, 3000);"
    ].join('\n');

    before(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-arch-crash-'));
        fs.writeFileSync(path.join(root, 'locked.bin'), 'x');
        fs.chmodSync(path.join(root, 'locked.bin'), 0);
        fs.writeFileSync(path.join(root, 'ok.bin'), 'ok');
        fs.mkdirSync(path.join(root, 'tree'));
        fs.writeFileSync(path.join(root, 'tree', 'a.txt'), 'a');
        fs.writeFileSync(path.join(root, 'tree', 'b.txt'), 'b');
    });
    after(function () {
        try { fs.chmodSync(path.join(root, 'locked.bin'), 0o644); } catch (e) { /* best effort */ }
        try {
            fs.readdirSync(root).forEach(function (n) {
                if (n.indexOf('out_') === 0) { fs.chmodSync(path.join(root, n), 0o755); }
            });
        } catch (e) { /* best effort */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    function arm(mode) {
        var r = spawnSync(process.execPath, ['-e', CHILD], {
            encoding: 'utf8',
            timeout: 15000,
            env: Object.assign({}, process.env, { GINA_ARCHIVER_MAIN: MAIN_SOURCE, ARM: mode, ROOT: root })
        });
        var out = String(r.stdout);
        assert.equal(r.status, 0, mode + ': child exited ' + r.status + ' — ' + out.trim().split('\n').pop());
        assert.doesNotMatch(out, /UNCAUGHT/, mode + ': the error must be delivered, not thrown');
        assert.match(out, /DELIVERED EACCES/, mode + ': onComplete received the stream error; got: ' + out.trim());
    }

    it('array form, the unreadable input is the only entry', function () { arm('array-single'); });
    it('single-file form, unreadable input', function () { arm('single-file'); });
    it('array form, unwritable target directory', function () { arm('unwritable-array'); });
    it('directory form, unwritable target directory', function () { arm('unwritable-dir'); });
});


// ---------------------------------------------------------------------------
// 05 — no state leaked onto the global object (runs after the arms above)
// ---------------------------------------------------------------------------

describe('05 - no implicit globals', function () {

    it('neither outputStream nor zipFolder exists on `global` after array and directory runs', function () {
        assert.ok(!('outputStream' in global), 'outputStream leaked as an implicit global');
        assert.ok(!('zipFolder' in global), 'zipFolder leaked as an implicit global');
    });
});
