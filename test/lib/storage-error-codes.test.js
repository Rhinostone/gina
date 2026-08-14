'use strict';
/**
 * lib/storage — machine-readable `err.code` on the read verbs (#STO1 Range serving).
 *
 * The HTTP serving layer maps driver read errors to status codes; before this,
 * 404 vs 416 vs 400 was only discriminable by parsing message text (measured:
 * zero `err.code` anywhere in lib/storage, with a firing control). The codes:
 *
 *   STORAGE_NO_OBJECT            — unknown / released / vanished key  → the caller's 404
 *   STORAGE_RANGE_UNSATISFIABLE  — start at or beyond the object size → the caller's 416
 *   STORAGE_INVALID_RANGE        — malformed bounds                   → a caller bug (500)
 *
 * Message text is deliberately BYTE-UNCHANGED from the pre-code era — the
 * message-regex assertions here are the insurance that stamping codes never
 * moved the human diagnostics (the existing suites pin those texts).
 *
 * Red-first: measured live on the pre-fix bytes — `err.code` read `undefined`
 * on both the unknown-key and invalid-range classes (2026-08-14).
 *
 * Suites:
 *  01 — sharded: the three codes + message stability
 *  02 — cas: the three codes + released-blob invisibility carries NO_OBJECT
 *  03 — stream: the three codes (filesystem-read strategy)
 */
var { describe, it, after } = require('node:test');
var assert   = require('node:assert');
var fs       = require('node:fs');
var os       = require('node:os');
var nodePath = require('node:path');
var Readable = require('node:stream').Readable;

var ROOT    = nodePath.join(__dirname, '..', '..');
var VERSION = require(nodePath.join(ROOT, 'package.json')).version;
var FW      = nodePath.join(ROOT, 'framework', 'v' + VERSION);

var createLocalDriver       = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local.js'));
var createLocalCasDriver    = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local-cas.js'));
var createLocalStreamDriver = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local-stream.js'));
var createEmbeddedMetaStore = require(nodePath.join(FW, 'lib', 'storage', 'src', 'meta-store.js'));

var roots = [];

/**
 * Build a driver of any strategy over a fresh temp root.
 *
 * @inner
 * @param {string} strategy - `sharded`, `cas` or `stream`.
 * @returns {object} `{driver, root}`.
 */
function freshDriver(strategy) {
    var root  = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-codes-'));
    roots.push(root);
    var store = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
    var conf  = { root: root, strategy: strategy, maxObjectSize: 1024 * 1024 };
    var factory = createLocalDriver;
    if ( strategy === 'cas' ) {
        conf.hash          = 'sha256';
        conf.fsync         = false;
        conf.sweepInterval = 0;
        conf.sweepGrace    = 60 * 60 * 1000;
        factory = createLocalCasDriver;
    } else if ( strategy === 'stream' ) {
        conf.chunkSize            = 8 * 1024 * 1024;
        conf.fsync                = false;
        conf.sessionTtl           = 24 * 60 * 60 * 1000;
        conf.sessionSweepInterval = 0;
        factory = createLocalStreamDriver;
    }
    return { driver: factory('codesT', conf, store), root: root };
}

/**
 * Publish 100 patterned bytes and hand back the key.
 *
 * @inner
 * @param {object}   driver - The driver under test.
 * @param {function} cb     - `cb(err, key)`.
 * @returns {void}
 */
function put100(driver, cb) {
    var b = Buffer.alloc(100);
    for (var i = 0; i < 100; i++) { b[i] = i & 0xff; }
    driver.put(Readable.from([b]), { originalName: 'f.bin', contentType: 'application/octet-stream' }, function (err, res) {
        if (err) { return cb(err); }
        cb(null, res.key);
    });
}

// A well-FORMED key that was simply never stored, per strategy — a malformed
// or traversal key exercises the resolvePath guard instead, which is a
// different (deliberately un-coded) refusal.
var UNKNOWN = {
    sharded : '2026/01/01/01ARZ3NDEKTSV4RRFFQ69G5FAV.bin',
    cas     : 'blobs/sha256/aa/bb/aabb00000000000000000000000000000000000000000000000000000000cdef',
    stream  : 'assets/01ARZ3NDEKTSV4RRFFQ69G5FAV/original.bin'
};

after(function () {
    roots.forEach(function (d) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    });
});

['sharded', 'cas', 'stream'].forEach(function (strategy, idx) {

    describe('0' + (idx + 1) + ' - ' + strategy + ': read-verb err.code', function () {

        it('getRange on an unknown key → STORAGE_NO_OBJECT, message unchanged', function (t, done) {
            var d = freshDriver(strategy).driver;
            d.getRange(UNKNOWN[strategy], 0, 10, function (err) {
                assert.ok(err, 'must error');
                assert.strictEqual(err.code, 'STORAGE_NO_OBJECT');
                assert.match(err.message, /no object for key/);
                done();
            });
        });

        it('get on an unknown key → STORAGE_NO_OBJECT', function (t, done) {
            var d = freshDriver(strategy).driver;
            d.get(UNKNOWN[strategy], function (err) {
                assert.ok(err);
                assert.strictEqual(err.code, 'STORAGE_NO_OBJECT');
                done();
            });
        });

        it('resolve on an unknown key → STORAGE_NO_OBJECT', function (t, done) {
            var d = freshDriver(strategy).driver;
            d.resolve(UNKNOWN[strategy], function (err) {
                assert.ok(err);
                assert.strictEqual(err.code, 'STORAGE_NO_OBJECT');
                done();
            });
        });

        it('getRange with malformed bounds → STORAGE_INVALID_RANGE, message unchanged', function (t, done) {
            var d = freshDriver(strategy).driver;
            d.getRange(UNKNOWN[strategy], 5, 2, function (err) {
                assert.ok(err);
                assert.strictEqual(err.code, 'STORAGE_INVALID_RANGE');
                assert.match(err.message, /invalid range/);
                done();
            });
        });

        it('getRange with start at the object size → STORAGE_RANGE_UNSATISFIABLE, message unchanged', function (t, done) {
            var f = freshDriver(strategy);
            put100(f.driver, function (perr, key) {
                assert.ifError(perr);
                f.driver.getRange(key, 100, 200, function (err) {
                    assert.ok(err, 'start === size must error (the caller\'s 416)');
                    assert.strictEqual(err.code, 'STORAGE_RANGE_UNSATISFIABLE');
                    assert.match(err.message, /beyond the object size/);
                    done();
                });
            });
        });

        it('control: a satisfiable range still reads clean (no error, no code)', function (t, done) {
            var f = freshDriver(strategy);
            put100(f.driver, function (perr, key) {
                assert.ifError(perr);
                f.driver.getRange(key, 0, 9, function (err, stream) {
                    assert.ifError(err);
                    var n = 0;
                    stream.on('data', function (c) { n += c.length; });
                    stream.on('end', function () { assert.strictEqual(n, 10); done(); });
                });
            });
        });
    });
});

describe('04 - cas: released-blob invisibility carries STORAGE_NO_OBJECT', function () {

    it('after release, getRange errors with the code (the grace-window race maps to 404)', function (t, done) {
        var f = freshDriver('cas');
        put100(f.driver, function (perr, key) {
            assert.ifError(perr);
            f.driver.release(key, function (rerr) {
                assert.ifError(rerr);
                f.driver.getRange(key, 0, 9, function (err) {
                    assert.ok(err, 'a zero-ref blob must be invisible to getRange');
                    assert.strictEqual(err.code, 'STORAGE_NO_OBJECT');
                    done();
                });
            });
        });
    });
});
