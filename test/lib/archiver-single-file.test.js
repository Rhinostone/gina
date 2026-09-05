/**
 * lib/archiver compress() — the single-file form is a real one-entry zip (#B476).
 *
 * Before the fix the single-file form piped its input through a gzip codec and
 * wrote the result under `<target>/<name>.zip`: `decompress()` — documented as
 * the inverse of `compress()` — rejected it, and `method: 'br'` / `'deflate'`
 * were accepted by the option validator and silently produced that same gzip.
 * A second defect hid in the same branch: an input whose path carried a
 * dot-prefixed segment anywhere (`.env`, but also `~/.config/app.txt`) hit an
 * early return placed BEFORE the streams were tracked, so the run reported
 * SUCCESS with the INPUT path as its archive, left an empty `<name>.zip` on
 * disk, and leaked the read and write descriptors it had already opened.
 *
 * The single-file form now routes through the array path (one entry named by
 * the file's basename), which the directory form already shares, so every form
 * writes DEFLATE zip entries and `decompress()` round-trips all three. `method`
 * is validated against `gzip` alone — the value names the completion event and
 * has never selected a codec for the array or directory forms.
 *
 * Every arm drives the REAL lib on temp trees, read through the
 * GINA_ARCHIVER_MAIN seam so the arms can be validated red against the pre-fix
 * bytes without touching the working tree. Arms 05 and 08 are regression guards
 * that pass on both sides; the rest go red on the pre-fix bytes (03's naming
 * checks would pass there too, but its entry listing needs a real zip).
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW          = require('../fw');
var MAIN_SOURCE = process.env.GINA_ARCHIVER_MAIN || path.join(FW, 'lib/archiver/src/main.js');
var mainSrc     = fs.readFileSync(MAIN_SOURCE, 'utf8');

var archiver = require(MAIN_SOURCE);
var JSZip    = require(path.join(FW, 'lib/archiver/src/dep/jszip.min.js'));

var GUARD_MS = 8000;

function capture(attach) {
    return new Promise(function (resolve) {
        var done = false;
        var guard = setTimeout(function () { if (!done) { done = true; resolve({ timedOut: true }); } }, GUARD_MS);
        attach(function (err, target) {
            if (done) { return; }
            done = true;
            clearTimeout(guard);
            resolve({ timedOut: false, err: err, target: target });
        });
    });
}

function entriesOf(zipPath) {
    return JSZip.loadAsync(fs.readFileSync(zipPath)).then(function (zip) {
        return Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; }).sort();
    });
}

function magicOf(p) {
    var b = Buffer.alloc(2);
    var fd = fs.openSync(p, 'r');
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    return b.toString('hex');
}

function sizeOf(p) { try { return fs.statSync(p).size; } catch (e) { return -1; } }

/** Open-descriptor count for this process — Linux and macOS both expose it under /dev/fd. */
function fdCount() { return fs.readdirSync('/dev/fd').length; }

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var root, out;

before(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-archiver-single-'));
    out  = path.join(root, 'out') + '/';
    fs.writeFileSync(path.join(root, 'plain.txt'), 'single file archive\n'.repeat(64));
    fs.writeFileSync(path.join(root, 'empty.txt'), '');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
    fs.mkdirSync(path.join(root, '.config'));
    fs.writeFileSync(path.join(root, '.config', 'app.txt'), 'under a dot-directory\n');
    fs.mkdirSync(path.join(root, 'tree'));
    fs.writeFileSync(path.join(root, 'tree', 'a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'tree', '.env'), 'S=1');
});

after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});


// ---------------------------------------------------------------------------
// 01 — source shape
// ---------------------------------------------------------------------------

describe('01 - source shape', function () {

    it('the gzip codec branch and its dot-segment early return are gone', function () {
        assert.equal(mainSrc.indexOf('createGzip'), -1, 'no gzip codec is created anywhere');
        assert.equal(mainSrc.indexOf("/\\/\\.(.*)$/.test("), -1, 'no dot-segment test on an input path');
        assert.doesNotMatch(mainSrc, /require\('zlib'\)/);
    });

    it('method is validated against gzip alone', function () {
        assert.match(mainSrc, /allowedCompressionMethods\s*=\s*\[\s*'gzip'\s*\]/);
    });

    it('the structural anchors the sibling test slices depend on are intact', function () {
        // archiver-dir-walk.test.js and archiver-decompress.test.js slice mainSrc on these
        assert.ok(mainSrc.indexOf('var browse = function') > -1);
        assert.ok(mainSrc.indexOf('this.decompress =') > -1);
        assert.ok(mainSrc.indexOf('this.compressFromStream =') > -1);
    });
});


// ---------------------------------------------------------------------------
// 02 — the single-file output is a real zip that decompress() reads back
// ---------------------------------------------------------------------------

describe('02 - single-file output is a one-entry zip', function () {

    it('writes a zip under <target>/<basename>.zip holding one entry named by the basename', async function () {
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, 'plain.txt'), out).onComplete(cb);
        });
        assert.equal(res.timedOut, false);
        assert.equal(res.err, false);
        assert.equal(res.target, path.join(out, 'plain.txt.zip'));
        assert.equal(magicOf(res.target), '504b', 'zip local-file-header signature, not a gzip member');
        assert.deepEqual(await entriesOf(res.target), ['plain.txt']);
    });

    it('decompress() restores the file byte-exact', async function () {
        var restore = path.join(root, 'restore-02') + '/';
        var res = await capture(function (cb) {
            archiver.decompress(path.join(out, 'plain.txt.zip'), restore).onComplete(cb);
        });
        assert.equal(res.timedOut, false);
        assert.equal(res.err, false);
        assert.equal(fs.readFileSync(path.join(restore, 'plain.txt'), 'utf8'), fs.readFileSync(path.join(root, 'plain.txt'), 'utf8'));
    });
});


// ---------------------------------------------------------------------------
// 03 — naming rules are the ones the single-file form always had
// ---------------------------------------------------------------------------

describe('03 - naming rules preserved', function () {

    it('name omitted, name "default", and an explicit name resolve as before', async function () {
        var omitted = await capture(function (cb) {
            archiver.compress(path.join(root, 'plain.txt'), path.join(root, 'out03a') + '/').onComplete(cb);
        });
        var dflt = await capture(function (cb) {
            archiver.compress(path.join(root, 'plain.txt'), path.join(root, 'out03b') + '/', { name: 'default' }).onComplete(cb);
        });
        var given = await capture(function (cb) {
            archiver.compress(path.join(root, 'plain.txt'), path.join(root, 'out03c') + '/', { name: 'given' }).onComplete(cb);
        });
        assert.equal(path.basename(omitted.target), 'plain.txt.zip');
        assert.equal(path.basename(dflt.target),    'plain.txt.zip');
        assert.equal(path.basename(given.target),   'given.zip');
        assert.deepEqual(await entriesOf(given.target), ['plain.txt'], 'the entry keeps the file\'s own name whatever the archive is called');
    });
});


// ---------------------------------------------------------------------------
// 04 — a dot-prefixed path segment is an ordinary input
// ---------------------------------------------------------------------------

describe('04 - dotfile and dot-directory inputs', function () {

    it('a dotfile archives to <target>/.env.zip, reports that path, and releases its descriptors', async function () {
        // warm-up control on a plain file so the baseline below excludes any first-run allocation
        await capture(function (cb) { archiver.compress(path.join(root, 'plain.txt'), path.join(root, 'out04w') + '/').onComplete(cb); });
        await settle(100);
        var before = fdCount();
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, '.env'), out).onComplete(cb);
        });
        await settle(300);
        assert.equal(res.timedOut, false);
        assert.equal(res.err, false);
        assert.equal(res.target, path.join(out, '.env.zip'), 'the archive path, not the input path');
        assert.ok(sizeOf(res.target) > 0, 'not an empty zip');
        assert.deepEqual(await entriesOf(res.target), ['.env']);
        assert.ok(fdCount() <= before, 'no descriptor outlives the run (pre-fix: the read and write streams both leaked)');
    });

    it('a file under a dot-directory is archived the same way', async function () {
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, '.config', 'app.txt'), out).onComplete(cb);
        });
        assert.equal(res.timedOut, false);
        assert.equal(res.err, false);
        assert.equal(res.target, path.join(out, 'app.txt.zip'));
        assert.deepEqual(await entriesOf(res.target), ['app.txt']);
    });
});


// ---------------------------------------------------------------------------
// 05 — the missing-input error survives the routing
// ---------------------------------------------------------------------------

describe('05 - missing input', function () {

    it('still settles the error rather than an empty archive', async function () {
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, 'absent.txt'), out).onComplete(cb);
        });
        assert.equal(res.timedOut, false);
        assert.ok(res.err instanceof Error);
        assert.match(res.err.message, /file not found/);
        assert.equal(sizeOf(path.join(out, 'absent.txt.zip')), -1, 'nothing was written');
    });
});


// ---------------------------------------------------------------------------
// 06 — an empty file
// ---------------------------------------------------------------------------

describe('06 - empty input', function () {

    it('archives to a zip holding one zero-length entry that restores as an empty file', async function () {
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, 'empty.txt'), out).onComplete(cb);
        });
        assert.equal(res.err, false);
        assert.equal(magicOf(res.target), '504b');
        assert.deepEqual(await entriesOf(res.target), ['empty.txt']);
        var restore = path.join(root, 'restore-06') + '/';
        var dc = await capture(function (cb) { archiver.decompress(res.target, restore).onComplete(cb); });
        assert.equal(dc.err, false);
        assert.equal(sizeOf(path.join(restore, 'empty.txt')), 0);
    });
});


// ---------------------------------------------------------------------------
// 07 — method
// ---------------------------------------------------------------------------

describe('07 - method option', function () {

    it('br and deflate throw synchronously as unsupported; gzip and an omitted method are accepted', async function () {
        assert.throws(function () { archiver.compress(path.join(root, 'plain.txt'), out, { name: 'br', method: 'br' }); }, /not supported/);
        assert.throws(function () { archiver.compress(path.join(root, 'plain.txt'), out, { name: 'df', method: 'deflate' }); }, /not supported/);
        assert.equal(sizeOf(path.join(out, 'br.zip')), -1, 'a rejected call opens no output');

        var gz = await capture(function (cb) {
            archiver.compress(path.join(root, 'plain.txt'), out, { name: 'gz', method: 'gzip' }).onComplete(cb);
        });
        assert.equal(gz.err, false);
        assert.equal(magicOf(gz.target), '504b', 'gzip names the completion event; the bytes are a zip like every other form');
    });
});


// ---------------------------------------------------------------------------
// 08 — the directory form's dotfile policy, pinned for consistency
// ---------------------------------------------------------------------------

describe('08 - directory form includes dotfiles', function () {

    it('a dotfile inside a directory is archived like any other entry', async function () {
        var res = await capture(function (cb) {
            archiver.compress(path.join(root, 'tree'), out).onComplete(cb);
        });
        assert.equal(res.err, false);
        var names = (await entriesOf(res.target)).map(function (n) { return path.basename(n); }).sort();
        assert.deepEqual(names, ['.env', 'a.txt']);
    });
});
