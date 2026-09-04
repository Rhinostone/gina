/**
 * lib/archiver compress() — directory form walks EVERY entry (#B474).
 *
 * browse() seeded its top-level work list from `f = 1`, so the first entry
 * node's readdir returned was never archived: a directory holding one file
 * produced an empty archive. Behavioural arm drives the REAL singleton on a
 * temp tree and asserts every file is present; the source pin locks the loop
 * start. Both read the archiver through the GINA_ARCHIVER_MAIN seam so the
 * arms can be validated red-first against the pre-fix bytes
 * (`git show HEAD~1:<path>` copied with absolute requires) without touching
 * the working tree.
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
// scope the source-pin to the browse() body
var browseSrc   = mainSrc.slice(mainSrc.indexOf('var browse = function'), mainSrc.indexOf('this.decompress ='));

var archiver = require(MAIN_SOURCE);
var JSZip    = require(path.join(FW, 'lib/archiver/src/dep/jszip.min.js'));


describe('01 - browse() source shape', function () {

    it('seeds the top-level work list from index 0, not 1', function () {
        assert.ok(browseSrc.length > 200, 'browse() body located');
        assert.match(browseSrc, /f = 0; fLen = list\.length;/);
        assert.doesNotMatch(browseSrc, /f = 1; fLen = list\.length;/);
    });
});


describe('02 - directory form archives every entry', function () {

    var root;

    before(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-arch-walk-'));
    });
    after(function () {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    // bounded: a never-settling run FAILS instead of hanging the suite
    function pCompressDir(dir, out, opts) {
        return new Promise(function (resolve, reject) {
            var guard = setTimeout(function () { reject(new Error('compress() never settled')); }, 10000);
            archiver.compress(dir, out, opts).onComplete(function (err, p) {
                clearTimeout(guard);
                err ? reject(err) : resolve(p);
            });
        });
    }

    it('the first top-level entry, its siblings, and a nested subdir all land in the zip', async function () {
        var srcDir = path.join(root, 'tree');
        fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
        var expected = ['a.txt', 'b.txt', 'c.txt', 'sub/d.txt', 'sub/e.txt'];
        expected.forEach(function (rel) {
            fs.writeFileSync(path.join(srcDir, rel), 'content of ' + rel + '\n');
        });
        var first = fs.readdirSync(srcDir)[0];   // whichever entry readdir lists first

        var out     = path.join(root, 'out') + '/';
        var zipPath = await pCompressDir(srcDir, out, { name: 'tree', level: 1 });
        assert.ok(fs.existsSync(zipPath), 'archive was produced');

        var zip     = await JSZip.loadAsync(fs.readFileSync(zipPath));
        var entries = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });

        expected.forEach(function (rel) {
            assert.ok(
                entries.some(function (n) { return n.slice(-rel.length) === rel; }),
                'missing archive entry for ' + rel + ' (readdir first entry was `' + first + '`); got ' + JSON.stringify(entries)
            );
        });
        assert.equal(entries.length, expected.length, 'exactly the five files, nothing duplicated');
    });
});
