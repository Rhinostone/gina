/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * #STO1 — `getRange()`, the driver half of HTTP Range serving, across BOTH
 * local strategies and BOTH size tiers.
 *
 * Driven BEHAVIOURALLY like its sibling storage suites: every assertion is a
 * runtime value — the actual bytes a stream yielded, an error, a capability
 * flag. Nothing here pins source text; a range read either returns the right
 * bytes or it does not, and a source pin would happily ratify wrong ones.
 *
 * The contract under test (design record D10):
 *   - `end` is INCLUSIVE, matching the HTTP Range header AND
 *     `fs.createReadStream({start, end})`, so no arithmetic sits between them;
 *   - an `end` past the last byte is CLAMPED, not refused (RFC 9110: a range
 *     whose start is satisfiable is satisfiable);
 *   - only a `start` at or beyond the object size is unsatisfiable — that is
 *     the caller's 416;
 *   - both tiers answer, discriminated by `m.data != null` exactly as `get()`
 *     does, never by the configured threshold.
 *
 * NB the fixtures are byte-patterned rather than text so an off-by-one is
 * caught at the exact offset instead of passing on a lucky substring.
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
var createEmbeddedMetaStore = require(nodePath.join(FW, 'lib', 'storage', 'src', 'meta-store.js'));

var roots = [];

/**
 * A deterministic byte pattern — `i & 0xff`, so every offset carries its own
 * identity and a shifted read is detectable rather than plausible.
 *
 * @inner
 * @param {number} n - Length in bytes.
 * @returns {Buffer} The patterned buffer.
 */
function pattern(n) {
    var b = Buffer.alloc(n);
    for (var i = 0; i < n; i++) { b[i] = i & 0xff; }
    return b;
}

/**
 * Build a driver of either strategy over a fresh temp root.
 *
 * @inner
 * @param {string} strategy  - `sharded` or `cas`.
 * @param {number} threshold - `inlineThreshold` in bytes (0 = tiering off).
 * @returns {object} `{driver, root, store}`.
 */
function freshDriver(strategy, threshold) {
    var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-range-'));
    roots.push(root);
    var store = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
    var conf  = {
        root            : root,
        strategy        : strategy,
        maxObjectSize   : 1024 * 1024,
        inlineThreshold : threshold
    };
    if ( strategy === 'cas' ) {
        conf.hash          = 'sha256';
        conf.fsync         = false;
        conf.sweepInterval = 0;
        conf.sweepGrace    = 60 * 60 * 1000;
    }
    var factory = ( strategy === 'cas' ) ? createLocalCasDriver : createLocalDriver;
    return { driver: factory('r', conf, store), root: root, store: store };
}

/**
 * Publish a buffer and hand back its key.
 *
 * @inner
 * @param {object}   driver - The driver under test.
 * @param {Buffer}   buf    - Bytes to store.
 * @param {function} cb     - `cb(err, key)`.
 * @returns {void}
 */
function put(driver, buf, cb) {
    driver.put(Readable.from([buf]), { originalName: 'f.bin', contentType: 'application/octet-stream' }, function (err, res) {
        if (err) { return cb(err); }
        cb(null, res.key);
    });
}

/**
 * Drain a range read into one buffer.
 *
 * @inner
 * @param {object}   driver - The driver under test.
 * @param {string}   key    - The opaque key.
 * @param {number}   start  - Inclusive start.
 * @param {number}   end    - Inclusive end.
 * @param {function} cb     - `cb(err, buffer)`.
 * @returns {void}
 */
function readRange(driver, key, start, end, cb) {
    driver.getRange(key, start, end, function (err, stream) {
        if (err) { return cb(err); }
        var chunks = [];
        stream.on('data', function (c) { chunks.push(c); });
        stream.on('error', cb);
        stream.on('end', function () { cb(null, Buffer.concat(chunks)); });
    });
}

after(function () {
    roots.forEach(function (d) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    });
});

/* Both strategies × both tiers. The inline tier is forced with a threshold
 * ABOVE the fixture size, the file tier with '0B' (tiering off) — so each pair
 * exercises a genuinely different code path inside the same contract. */
[
    { strategy: 'sharded', tier: 'file',   threshold: 0 },
    { strategy: 'sharded', tier: 'inline', threshold: 64 * 1024 },
    { strategy: 'cas',     tier: 'file',   threshold: 0 },
    { strategy: 'cas',     tier: 'inline', threshold: 64 * 1024 }
].forEach(function (scenario) {

    describe('01 - getRange contract — ' + scenario.strategy + ' / ' + scenario.tier + ' tier', function () {

        var SIZE = 4096;
        var body = pattern(SIZE);

        it('returns an interior range, bytes exact at both ends', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            put(f.driver, body, function (e, key) {
                assert.ifError(e);
                readRange(f.driver, key, 100, 199, function (err, got) {
                    assert.ifError(err);
                    assert.equal(got.length, 100, 'inclusive end ⇒ 100 bytes');
                    assert.deepEqual(got, body.subarray(100, 200));
                    done();
                });
            });
        });

        it('the first byte and the last byte are both reachable', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            put(f.driver, body, function (e, key) {
                assert.ifError(e);
                readRange(f.driver, key, 0, 0, function (err, first) {
                    assert.ifError(err);
                    assert.equal(first.length, 1);
                    assert.equal(first[0], body[0]);
                    readRange(f.driver, key, SIZE - 1, SIZE - 1, function (err2, last) {
                        assert.ifError(err2);
                        assert.equal(last.length, 1);
                        assert.equal(last[0], body[SIZE - 1]);
                        done();
                    });
                });
            });
        });

        it('the whole object as one range equals get()', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            put(f.driver, body, function (e, key) {
                assert.ifError(e);
                readRange(f.driver, key, 0, SIZE - 1, function (err, got) {
                    assert.ifError(err);
                    assert.deepEqual(got, body);
                    done();
                });
            });
        });

        it('an end past the last byte is CLAMPED, not refused', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            put(f.driver, body, function (e, key) {
                assert.ifError(e);
                readRange(f.driver, key, SIZE - 10, SIZE + 100000, function (err, got) {
                    assert.ifError(err, 'a satisfiable start must not error');
                    assert.equal(got.length, 10, 'clamped to the last byte');
                    assert.deepEqual(got, body.subarray(SIZE - 10));
                    done();
                });
            });
        });

        it('a start at or beyond the object size is unsatisfiable (the caller 416s)', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            put(f.driver, body, function (e, key) {
                assert.ifError(e);
                f.driver.getRange(key, SIZE, SIZE + 10, function (err) {
                    assert.ok(err, 'start === size must error');
                    assert.match(err.message, /beyond the object size/);
                    f.driver.getRange(key, SIZE + 1, SIZE + 10, function (err2) {
                        assert.ok(err2, 'start > size must error');
                        done();
                    });
                });
            });
        });

        it('rejects malformed bounds before touching the store', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            put(f.driver, body, function (e, key) {
                assert.ifError(e);
                var bad = [ [10, 5], [-1, 10], [0.5, 10], [0, 1.5], [NaN, 10], [0, NaN] ];
                var i = 0;
                (function next() {
                    if ( i === bad.length ) { return done(); }
                    var pair = bad[i++];
                    f.driver.getRange(key, pair[0], pair[1], function (err) {
                        assert.ok(err, 'range [' + pair[0] + ', ' + pair[1] + '] must be refused');
                        assert.match(err.message, /invalid range/);
                        next();
                    });
                })();
            });
        });

        it('errors on an unknown key', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            f.driver.getRange('2026/01/01/01ARZ3NDEKTSV4RRFFQ69G5FAV', 0, 10, function (err) {
                assert.ok(err);
                done();
            });
        });

        it('refuses a traversal attempt in the key', function (t, done) {
            var f = freshDriver(scenario.strategy, scenario.threshold);
            f.driver.getRange('../../etc/passwd', 0, 10, function (err) {
                assert.ok(err, 'a key escaping the root must never resolve');
                done();
            });
        });
    });
});

describe('02 - the tier is invisible through the contract', function () {

    it('inline and file tiers yield identical bytes for the same range', function (t, done) {
        var body = pattern(4096);
        var inlineDrv = freshDriver('sharded', 64 * 1024);
        var fileDrv   = freshDriver('sharded', 0);
        put(inlineDrv.driver, body, function (e1, k1) {
            assert.ifError(e1);
            put(fileDrv.driver, body, function (e2, k2) {
                assert.ifError(e2);
                // Positive control that the two really took different paths:
                // the inline row carries a payload, the file-backed one does not.
                inlineDrv.store.get(k1, function (er1, m1) {
                    assert.ifError(er1);
                    assert.ok(m1.data != null, 'inline fixture must actually be inline');
                    fileDrv.store.get(k2, function (er2, m2) {
                        assert.ifError(er2);
                        assert.ok(!m2 || m2.data == null, 'file fixture must actually be file-backed');
                        readRange(inlineDrv.driver, k1, 1000, 1099, function (errA, a) {
                            assert.ifError(errA);
                            readRange(fileDrv.driver, k2, 1000, 1099, function (errB, b) {
                                assert.ifError(errB);
                                assert.deepEqual(a, b);
                                assert.deepEqual(a, body.subarray(1000, 1100));
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    it('preserves NUL bytes and high bytes across a range boundary', function (t, done) {
        var body = Buffer.from([0x00, 0xff, 0x00, 0x41, 0xfe, 0x00, 0x42, 0x00]);
        var f = freshDriver('sharded', 64 * 1024);   // inline tier: the BLOB round-trip
        put(f.driver, body, function (e, key) {
            assert.ifError(e);
            readRange(f.driver, key, 2, 5, function (err, got) {
                assert.ifError(err);
                assert.deepEqual(got, Buffer.from([0x00, 0x41, 0xfe, 0x00]));
                done();
            });
        });
    });
});

describe('03 - capabilities', function () {

    it('ranges is true on both local strategies', function () {
        assert.equal(freshDriver('sharded', 0).driver.capabilities.ranges, true);
        assert.equal(freshDriver('cas', 0).driver.capabilities.ranges, true);
    });

    it('getRange is present on both, and the strategy-specific verbs stay where they belong', function () {
        var sharded = freshDriver('sharded', 0).driver;
        var cas     = freshDriver('cas', 0).driver;
        assert.equal(typeof sharded.getRange, 'function');
        assert.equal(typeof cas.getRange, 'function');
        // Controls — the discrimination that proves this is not a blanket
        // "every verb on every driver" change.
        assert.equal(typeof sharded.findByDigest, 'undefined', 'findByDigest stays cas-only');
        assert.equal(typeof cas.findByDigest, 'function');
        assert.equal(typeof sharded.sweepNow, 'undefined', 'sweepNow stays cas-only');
        assert.equal(typeof cas.createUpload, 'undefined', 'the resumable trio is stream-only');
    });

    it('requires a callback', function () {
        var f = freshDriver('sharded', 0);
        assert.throws(function () { f.driver.getRange('k', 0, 1); }, /requires a callback/);
    });
});

describe('04 - cas: a released blob is invisible to getRange', function () {

    it('reads as absent once the last reference is dropped', function (t, done) {
        var f = freshDriver('cas', 0);
        var body = pattern(2048);
        put(f.driver, body, function (e, key) {
            assert.ifError(e);
            // Control: reachable BEFORE the release, so the assertion below
            // measures the release rather than a broken fixture.
            readRange(f.driver, key, 0, 99, function (errBefore, got) {
                assert.ifError(errBefore);
                assert.equal(got.length, 100);
                f.driver.release(key, function (relErr) {
                    assert.ifError(relErr);
                    f.driver.getRange(key, 0, 99, function (errAfter) {
                        assert.ok(errAfter, 'a zero-ref blob must not be range-readable');
                        assert.match(errAfter.message, /no object for key/);
                        done();
                    });
                });
            });
        });
    });
});
