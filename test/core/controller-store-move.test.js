/**
 * #B223 — Controller.store()'s mover masked every real failure and could kill
 * the bundle process:
 *
 *  (1) `movefiles` attached its 'error' listener to the return of
 *      `.pipe(destinationStream)` — the DESTINATION stream only — so a
 *      source-side read error (staged file vanished, transient I/O) had NO
 *      listener and escalated to an uncaughtException → SIGTERM bundle kill;
 *  (2) when the destination listener DID fire it passed a plain string, and
 *      store()'s callback discarded whatever arrived, reporting a fabricated
 *      `No file to upload` Error for ANY failure (ENOSPC/EACCES/ENOENT all
 *      presented as an empty upload);
 *  (3) after a destination error the auto-destroyed stream still fired
 *      'close', whose handler unlinked the SOURCE (destroying the caller's
 *      staged file on a FAILED move) and resumed the loop — settling the
 *      callback a SECOND time, as a success;
 *  (4) the copy streamed straight to the final name after pre-deleting any
 *      existing destination — readers observed truncated files mid-copy, and
 *      a failure after the pre-delete had already destroyed the previous
 *      content.
 *
 * Fix shape: stream to a temp sibling in the destination directory, publish
 * with an atomic rename, listen on BOTH streams, settle the callback exactly
 * once with the REAL Error, and never touch the source until the publish
 * succeeded. The genuinely-empty case keeps its historical
 * `No file to upload` message.
 *
 * §01-§05 are source pins over comment-stripped block slices (negative pins
 * would otherwise trip on the replace-code `was:` comments). §06+ drive the
 * REAL SuperController.createTestInstance() through real filesystem arms.
 * The crash-shaped arm (§09, missing source) runs LAST: on pre-fix bytes it
 * dies as an uncaughtException, which would mask later tests' reporting.
 */
'use strict';
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');

// Strip line/block-style comment LINES so negative pins cannot trip on the
// replace-code convention's `was:` comments (jsdoc.md discipline).
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

var RAW = null, MV = null, ST = null;   // raw source, movefiles slice, store slice (both stripped)

before(function () {
    RAW = fs.readFileSync(SOURCE, 'utf8');

    var mvStart = RAW.indexOf('var movefiles = function');
    var mvEnd   = RAW.indexOf('this.getBundleStatus = function', mvStart);
    assert.ok(mvStart > -1, 'extraction control: movefiles declaration located');
    assert.ok(mvEnd > mvStart, 'extraction control: movefiles slice terminator located');
    MV = stripComments(RAW.slice(mvStart, mvEnd));

    var stStart = RAW.indexOf('this.store = function');
    var stEnd   = RAW.indexOf('this.query = function', stStart);
    assert.ok(stStart > -1, 'extraction control: store declaration located');
    assert.ok(stEnd > stStart, 'extraction control: store slice terminator located');
    ST = stripComments(RAW.slice(stStart, stEnd));
});

// ---------------------------------------------------------------------------
// 01 — the source stream has an error listener (pre-fix: NONE → SIGTERM class)
// ---------------------------------------------------------------------------
describe('01 - #B223 pins: source-stream error listener', function () {
    it('movefiles listens for source-side stream errors', function () {
        assert.ok(MV.indexOf("sourceStream.on('error'") > -1,
            'a source read error must settle the callback, never escalate to uncaughtException');
    });
});

// ---------------------------------------------------------------------------
// 02 — atomic publish: temp sibling + rename; no pre-delete, no direct write
// ---------------------------------------------------------------------------
describe('02 - #B223 pins: temp + atomic rename publish', function () {
    it('streams to a temp sibling, not the final name', function () {
        assert.ok(MV.indexOf('createWriteStream(_tmpTarget') > -1,
            'the write must land on a temp sibling in the destination directory');
        assert.ok(MV.indexOf('createWriteStream(files[i].target)') === -1,
            'streaming straight to the final name exposes readers to truncated files');
    });
    it('publishes with rename and never pre-deletes the destination', function () {
        assert.ok(MV.indexOf('renameSync(_tmpTarget') > -1,
            'the publish must be an atomic rename of the temp sibling');
        assert.ok(MV.indexOf('.rmSync()') === -1,
            'pre-deleting the destination destroys the previous content on a failed move');
    });
});

// ---------------------------------------------------------------------------
// 03 — single-settle latch ordered before the publish
// ---------------------------------------------------------------------------
describe('03 - #B223 pins: the callback settles exactly once', function () {
    it('carries a settled latch, checked before the publish path', function () {
        var latchIdx  = MV.indexOf('if (_settled) return');
        var renameIdx = MV.indexOf('renameSync(_tmpTarget');
        assert.ok(latchIdx > -1, 'the close handler must bail once the move settled');
        assert.ok(renameIdx > latchIdx,
            'the latch check must precede the publish (close fires after error on autoDestroyed streams)');
    });
});

// ---------------------------------------------------------------------------
// 04 — store() propagates the real move error; the empty case keeps its message
// ---------------------------------------------------------------------------
describe('04 - #B223 pins: real error propagation in store()', function () {
    it("keeps 'No file to upload' for the genuinely-empty case ONLY (2 sites, was 4)", function () {
        var n = ST.split("'No file to upload'").length - 1;
        assert.equal(n, 2,
            'the fabricated message must not shadow real move errors (cb + emit forms of the empty case remain)');
    });
});

// ---------------------------------------------------------------------------
// 05 — no-regression pin: the #B38 released-response guard survives
// ---------------------------------------------------------------------------
describe('05 - regression pin: #B38 released-response guard intact', function () {
    it('store() still bails on a released request', function () {
        assert.ok(ST.indexOf('local.req == null') > -1,
            'the #B38 guard must survive the #B223 rework');
    });
});

// ---------------------------------------------------------------------------
// 06+ — behavioral: drive the REAL store() through real filesystem arms
// ---------------------------------------------------------------------------
describe('06 - behavioral arms (createTestInstance, real fs)', function () {

    var SuperController = null;
    var work = null;   // per-run scratch root
    var roDir = null;  // the read-only destination used by §07 (chmod restored in after())

    before(function () {
        process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
        require('module').Module._initPaths();
        require(path.join(FW, 'helpers'));                              // _, setPath, setContext, ...
        require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));   // JSON.clone, Object.count()
        process.gina = process.gina || {};
        setPath('gina', { core: path.join(FW, 'core') });

        SuperController = require(SOURCE);
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-store-move-'));
    });

    after(function () {
        try { if (roDir) fs.chmodSync(roDir, 448 /* 0o700 */); } catch (e) { /* best effort */ }
        try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    function mkInstance() {
        return SuperController.createTestInstance({
            req  : { method: 'POST', url: '/upload', headers: {}, routing: { param: {} } },
            res  : {
                statusCode : 200,
                headersSent: false,
                getHeaders : function () { return {}; },
                getHeader  : function () {},
                setHeader  : function () {},
                writeHead  : function () {},
                end        : function () {}
            },
            next : function () {},
            options: {
                rule: '_storemove',
                conf: {
                    bundle : 'test',
                    server : { protocol: 'http/1.1', coreConfiguration: { mime: {} } },
                    encoding: 'utf-8',
                    content: { routing: {} }
                }
            }
        });
    }

    // Settles on the FIRST callback, then holds a short grace window so a
    // double-callback (the pre-fix close-after-error resume) is captured;
    // bounded so a never-called callback FAILS instead of hanging the suite.
    function callStore(inst, target, files) {
        return new Promise(function (resolve) {
            var calls = [];
            var guard = setTimeout(function () { resolve({ calls: calls, timedOut: true }); }, 5000);
            inst.store(target, files, function (err, uploaded) {
                calls.push({ err: err, uploaded: uploaded });
                if (calls.length === 1) {
                    setTimeout(function () { clearTimeout(guard); resolve({ calls: calls, timedOut: false }); }, 250);
                }
            });
        });
    }

    it('07 - a destination failure surfaces the REAL error, once, and leaves the source intact', async function (t) {
        if (typeof process.getuid === 'function' && process.getuid() === 0) {
            t.skip('running as root — a read-only directory does not refuse writes');
            return;
        }
        var srcDir = path.join(work, 'staged-a');
        fs.mkdirSync(srcDir, { recursive: true });
        var srcFile = path.join(srcDir, 'proof.bin');
        fs.writeFileSync(srcFile, 'staged-bytes');

        roDir = path.join(work, 'dest-readonly');
        fs.mkdirSync(roDir, { recursive: true });
        fs.chmodSync(roDir, 365 /* 0o555 */);

        var out = await callStore(mkInstance(), roDir, [
            { filename: 'proof.bin', path: srcFile, size: 12, type: 'application/octet-stream', encoding: '7bit' }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls.length, 1,
            'the callback must settle exactly once (pre-fix: error then a spurious success)');
        assert.ok(out.calls[0].err instanceof Error,
            'the failure must be a real Error (pre-fix: a plain string, then masked)');
        assert.equal(out.calls[0].err.code, 'EACCES',
            'the real filesystem code must survive to the caller');
        assert.ok(fs.existsSync(srcFile),
            'a FAILED move must never destroy the staged source file');
    });

    it('08 - a successful move publishes atomically: content replaced, source consumed, no temp remnant', async function () {
        var srcDir = path.join(work, 'staged-b');
        fs.mkdirSync(srcDir, { recursive: true });
        var srcFile = path.join(srcDir, 'doc.txt');
        fs.writeFileSync(srcFile, 'NEW-CONTENT');

        var destDir = path.join(work, 'dest-ok');
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, 'doc.txt'), 'OLD-CONTENT');

        var out = await callStore(mkInstance(), destDir, [
            { filename: 'doc.txt', path: srcFile, size: 11, type: 'text/plain', encoding: '7bit' }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls.length, 1, 'exactly one settle on success');
        assert.equal(out.calls[0].err, false, 'success reports err === false');
        assert.equal(String(fs.readFileSync(path.join(destDir, 'doc.txt'))), 'NEW-CONTENT',
            'the destination carries the new content');
        assert.equal(fs.existsSync(srcFile), false, 'the source is consumed after a successful publish');
        var remnants = fs.readdirSync(destDir).filter(function (f) { return /\.tmp$/.test(f); });
        assert.deepEqual(remnants, [], 'no temp sibling may remain after the publish');
        assert.equal(out.calls[0].uploaded.length, 1, 'the uploaded-files list is reported');
        assert.equal(out.calls[0].uploaded[0].file, 'doc.txt', 'the reported entry keeps its shape');
    });

    it('09 - an empty file list keeps the historical message', async function () {
        var out = await callStore(mkInstance(), path.join(work, 'dest-empty'), []);
        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.ok(out.calls[0].err instanceof Error, 'the empty case reports an Error');
        assert.equal(out.calls[0].err.message, 'No file to upload',
            'the genuinely-empty case keeps its historical message');
    });

    // LAST on purpose: on pre-fix bytes this arm dies as an uncaughtException
    // (no source-stream listener), which would abort every test after it.
    it('10 - a vanished source settles the callback with the real ENOENT (pre-fix: bundle-killing uncaughtException)', async function () {
        var destDir = path.join(work, 'dest-c');
        fs.mkdirSync(destDir, { recursive: true });

        var out = await callStore(mkInstance(), destDir, [
            { filename: 'gone.txt', path: path.join(work, 'staged-c', 'gone.txt'), size: 1, type: 'text/plain', encoding: '7bit' }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle (never an unhandled stream error)');
        assert.equal(out.calls.length, 1, 'exactly one settle');
        assert.ok(out.calls[0].err instanceof Error, 'the failure is a real Error');
        assert.equal(out.calls[0].err.code, 'ENOENT', 'the real filesystem code survives to the caller');
    });
});
