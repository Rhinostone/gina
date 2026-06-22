/**
 * lib/archiver decompress() — the inverse of compress(), added for project:restore.
 * lib/archiver had no test before; this covers decompress() with source-pins on the
 * implementation shape AND behavioural round-trip / zip-slip / missing-archive cases
 * run against the REAL singleton (the probe that shipped the nextTick fix).
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW          = require('../fw');
var MAIN_SOURCE = path.join(FW, 'lib/archiver/src/main.js');
var mainSrc     = fs.readFileSync(MAIN_SOURCE, 'utf8');
// scope the source-pins to the decompress() body
var dcSrc = mainSrc.slice(mainSrc.indexOf('this.decompress ='), mainSrc.indexOf('this.compressFromStream ='));

var archiver = require(path.join(FW, 'lib/archiver'));
var JSZip    = require(path.join(FW, 'lib/archiver/src/dep/jszip.min.js'));


// ---------------------------------------------------------------------------
// 01 — decompress() implementation shape (source-pins)
// ---------------------------------------------------------------------------

describe('01 - decompress source shape', function () {

    it('is implemented (not the empty stub)', function () {
        assert.match(dcSrc, /this\.decompress = function\(src, target, options\) \{/);
        assert.ok(dcSrc.length > 400, 'decompress() body should be non-trivial');
    });

    it('uses JSZip 3.x loadAsync + per-entry async(nodebuffer), NOT the v2 sync load()', function () {
        assert.match(dcSrc, /JSZip\.loadAsync\(/);
        assert.match(dcSrc, /\.async\('nodebuffer'\)/);
        assert.doesNotMatch(dcSrc, /new JSZip\(\)\.load\(/);
        assert.doesNotMatch(dcSrc, /asNodeBuffer|asText/);
    });

    it('branches on entry.dir and writes files with fs.writeFileSync', function () {
        assert.match(dcSrc, /it\.entry\.dir/);
        assert.match(dcSrc, /fs\.writeFileSync\(dest, content\)/);
    });

    it('has a zip-slip guard (entries cannot escape the target)', function () {
        assert.match(dcSrc, /unsafe entry path in archive/);
        assert.match(dcSrc, /dest\.indexOf\(targetAbs \+ path\.sep\) !== 0/);
    });

    it('mirrors the compress() completion contract (emit + onComplete handle)', function () {
        assert.match(dcSrc, /archiver-decompress#complete/);
        assert.match(dcSrc, /onComplete: function onDecompressionCompleted/);
    });

    it('defers synchronous errors via process.nextTick (so onComplete listeners catch them)', function () {
        assert.match(dcSrc, /process\.nextTick/);
    });
});


// ---------------------------------------------------------------------------
// 02 — behavioural (real archiver singleton)
// ---------------------------------------------------------------------------

describe('02 - behavioural round-trip / zip-slip / missing', function () {

    var root;

    before(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-dcp-test-'));
    });
    after(function () {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    function pCompress(list, out, opts) {
        return new Promise(function (resolve, reject) {
            archiver.compress(list, out, opts).onComplete(function (err, p) { err ? reject(err) : resolve(p); });
        });
    }
    function pDecompress(zip, target) {
        return new Promise(function (resolve) {
            archiver.decompress(zip, target).onComplete(function (err, p) { resolve({ err: err, path: p }); });
        });
    }

    it('compress -> decompress restores files byte-exact (and excludes nothing it was given)', async function () {
        var srcDir = path.join(root, 'src');
        fs.mkdirSync(path.join(srcDir, 'src/web'), { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'package.json'), '{"name":"rt"}\n');
        fs.writeFileSync(path.join(srcDir, 'manifest.json'), '{"bundles":{"web":{}}}\n');
        fs.writeFileSync(path.join(srcDir, 'src/web/index.js'), 'module.exports={x:1};\n');

        var list = [
            { input: path.join(srcDir, 'package.json'),     output: 'package.json' },
            { input: path.join(srcDir, 'manifest.json'),    output: 'manifest.json' },
            { input: path.join(srcDir, 'src/web/index.js'), output: 'src/web/index.js' }
        ];
        var zipPath = await pCompress(list, path.join(root, 'out') + '/', { method: 'gzip', name: 'rt', level: 9 });
        assert.ok(fs.existsSync(zipPath), 'archive was produced');

        var extracted = path.join(root, 'extracted');
        var res = await pDecompress(zipPath, extracted);
        assert.equal(res.err, false, 'decompress reports no error');
        assert.equal(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'), '{"name":"rt"}\n');
        assert.equal(fs.readFileSync(path.join(extracted, 'manifest.json'), 'utf8'), '{"bundles":{"web":{}}}\n');
        assert.equal(fs.readFileSync(path.join(extracted, 'src/web/index.js'), 'utf8'), 'module.exports={x:1};\n');
    });

    it('rejects a zip-slip entry and writes nothing outside the target', async function () {
        var zip = new JSZip();
        zip.file('safe.txt', 'ok');
        zip.file('../gina-dcp-ESCAPED.txt', 'PWNED');
        var buf = await zip.generateAsync({ type: 'nodebuffer' });
        var evilZip = path.join(root, 'evil.zip');
        fs.writeFileSync(evilZip, buf);

        var escapedPath = path.resolve(root, 'gina-dcp-ESCAPED.txt'); // parent of the target
        if (fs.existsSync(escapedPath)) { fs.unlinkSync(escapedPath); }

        var res = await pDecompress(evilZip, path.join(root, 'slip'));
        assert.ok(res.err instanceof Error, 'a zip-slip archive is rejected with an error');
        assert.match(res.err.message, /unsafe entry path/);
        assert.ok(!fs.existsSync(escapedPath), 'nothing escaped the target directory');
    });

    it('reports a missing archive through onComplete (no hang, deferred emit)', async function () {
        var res = await pDecompress(path.join(root, 'does-not-exist.zip'), path.join(root, 'none'));
        assert.ok(res.err instanceof Error, 'missing archive yields an error');
        assert.match(res.err.message, /archive not found/);
    });
});
