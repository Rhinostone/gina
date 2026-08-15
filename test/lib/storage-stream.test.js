/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * #STO1 — the `stream` strategy: per-asset keys, resumable out-of-order
 * segment uploads, interval-union coverage, the abandoned-session sweep, and
 * byte-range reads.
 *
 * NB this file's binary fixtures are BUILT at runtime (`Buffer.alloc` +
 * a byte pattern, `crypto.randomBytes`), so no NUL byte reaches the source and
 * plain `grep` reads it fine — deliberately, because a source-literal NUL
 * makes git treat the file as binary and silently suppresses every grep match
 * (of the storage suite only `storage.test.js` and `storage-local.test.js`
 * carry one; those two need `grep -a`). Keep new fixtures constructed, not
 * pasted.
 *
 * Everything asserted here is a runtime VALUE — bytes, a marker set, a
 * refusal, the presence or absence of a file — except §13's fsync ORDER pins
 * and §02's `highWaterMark` pin, which are structural BECAUSE neither leaves a
 * filesystem-visible artifact and the house bans mocks: a source-order pin
 * with needle-found controls is the honest instrument for "the data is durable
 * before the marker claims it is".
 *
 * The load-bearing test in this file is §04. A hole in a sparse file reads
 * back as ZEROS, so a finalise that mis-verifies coverage publishes a
 * plausible, silently corrupt object. §04 constructs both shapes that fool a
 * naive check — markers whose lengths SUM to the declared size while leaving a
 * gap, and a data file whose SIZE equals the declared size while containing a
 * zero-filled hole — and proves the object is refused in each.
 */

var { describe, it, after } = require('node:test');
var assert   = require('node:assert');
var fs       = require('node:fs');
var os       = require('node:os');
var nodePath = require('node:path');
var crypto   = require('node:crypto');
var Readable = require('node:stream').Readable;

var ROOT    = nodePath.join(__dirname, '..', '..');
var VERSION = require(nodePath.join(ROOT, 'package.json')).version;
var FW      = nodePath.join(ROOT, 'framework', 'v' + VERSION);

var storage                 = require(nodePath.join(FW, 'lib', 'storage', 'src', 'main.js'));
var createLocalStreamDriver = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local-stream.js'));
var createEmbeddedMetaStore = require(nodePath.join(FW, 'lib', 'storage', 'src', 'meta-store.js'));

var STREAM_SRC = fs.readFileSync(nodePath.join(FW, 'lib', 'storage', 'src', 'local-stream.js'), 'utf8');

/** temp roots created by tests, removed in one file-level after() @type {string[]} */
var roots = [];

after(function () {
    storage.reset();
    roots.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
});

/**
 * A fresh temp root, registered for teardown.
 *
 * @inner
 * @returns {string} Absolute path.
 */
function mkRoot() {
    var d = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-stream-'));
    roots.push(d);
    return d;
}

/**
 * Build a stream driver + its embedded store on a fresh root. Defaults mirror
 * what start() would resolve, EXCEPT the sweep timer (0 — tests drive
 * `_sweepAbandoned` deterministically rather than waiting an hour).
 *
 * @inner
 * @param {object} [over] - Conf overrides.
 * @returns {{driver: object, root: string, store: object}}
 */
function freshStream(over) {
    over = over || {};
    var root  = over.root || mkRoot();
    var store = over.store || createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
    var conf  = {
        root                 : root,
        strategy             : 'stream',
        maxObjectSize        : over.maxObjectSize || (50 * 1024 * 1024),
        chunkSize            : over.chunkSize || (8 * 1024 * 1024),
        fsync                : ( typeof over.fsync === 'boolean' ) ? over.fsync : true,
        sessionTtl           : over.sessionTtl || (24 * 60 * 60 * 1000),
        sessionSweepInterval : 0
    };
    return { driver: createLocalStreamDriver('streamT', conf, store), root: root, store: store };
}

/**
 * A readable over an array of Buffers.
 *
 * @inner
 * @param {Buffer[]} chunks - Chunks to emit, in order.
 * @returns {object} A readable stream.
 */
function src(chunks) {
    return Readable.from(Array.isArray(chunks) ? chunks : [chunks]);
}

/**
 * A readable that emits one chunk then errors for real — no mock, an actual
 * stream error travelling the actual path.
 *
 * @inner
 * @param {Buffer} chunk - The one chunk delivered before the failure.
 * @returns {object} A readable stream.
 */
function srcInterrupted(chunk) {
    var r = new Readable({ read: function () {} });
    setImmediate(function () {
        r.push(chunk);
        setImmediate(function () { r.destroy(new Error('interrupted')); });
    });
    return r;
}

/**
 * Collect a readable into one Buffer.
 *
 * @inner
 * @param {object}   stream - Readable.
 * @param {function} fn     - `fn(err, buffer)`.
 * @returns {void}
 */
function drain(stream, fn) {
    var chunks = [];
    stream.on('data', function (c) { chunks.push(c); });
    stream.on('end', function () { fn(null, Buffer.concat(chunks)); });
    stream.on('error', fn);
}

/**
 * A deterministic byte pattern, so an off-by-one is caught at the exact offset
 * instead of passing on a lucky substring.
 *
 * @inner
 * @param {number} n - Byte count.
 * @returns {Buffer}
 */
function pattern(n) {
    var b = Buffer.alloc(n);
    for (var i = 0; i < n; i++) { b[i] = i & 0xff; }
    return b;
}

/**
 * A session's directory inside a driver root.
 *
 * @inner
 * @param {string} root     - Driver root.
 * @param {string} uploadId - Session id.
 * @returns {string}
 */
function sessionDir(root, uploadId) {
    return nodePath.join(root, '.uploads', uploadId);
}

/**
 * The marker file names of a session, sorted.
 *
 * @inner
 * @param {string} dir - Session directory.
 * @returns {string[]}
 */
function markers(dir) {
    return fs.readdirSync(dir).filter(function (n) { return /\.ok$/.test(n); }).sort();
}

var BODY = pattern(3000);

describe('01 - keys name an ASSET, not a file', function () {

    it('lays out assets/<ulid>/original<ext>, extension from the client name only', function (t, done) {
        var f = freshStream();
        f.driver.put(src(BODY), { originalName: 'talk.MP4' }, function (err, res) {
            assert.ifError(err);
            assert.match(res.key, /^assets\/[0-9A-HJKMNP-TV-Z]{26}\/original\.mp4$/,
                'ulid directory, reserved base-rendition name, lowercased extension');
            assert.ok(fs.existsSync(nodePath.join(f.root, res.key)), 'the bytes are at the key');
            f.driver.close();
            done();
        });
    });

    it('a hostile originalName contributes nothing but a whitelisted extension', function (t, done) {
        var f = freshStream();
        f.driver.put(src(BODY), { originalName: '../../etc/passwd' }, function (err, res) {
            assert.ifError(err);
            assert.match(res.key, /^assets\/[0-9A-HJKMNP-TV-Z]{26}\/original$/, 'no extension survives');
            assert.equal(res.key.indexOf('..'), -1);
            assert.equal(res.key.indexOf('passwd'), -1);
            f.driver.stat(res.key, function (e2, m) {
                assert.ifError(e2);
                assert.equal(m.originalName, '../../etc/passwd', 'kept verbatim in metadata, where it is inert');
                f.driver.close();
                done();
            });
        });
    });

    it('refuses a key that escapes the root, is non-canonical, or names driver state', function (t, done) {
        var f = freshStream();
        var bad = ['../../etc/passwd', 'assets/../x', '.uploads/x/data', '.tmp/x', '.meta.db', '/abs/path', ''];
        var i = 0;
        (function next() {
            if ( i === bad.length ) { f.driver.close(); return done(); }
            var k = bad[i++];
            f.driver.get(k, function (err) {
                assert.ok(err, 'key ' + JSON.stringify(k) + ' must be refused');
                next();
            });
        })();
    });
});

describe('02 - put(): the one-shot path', function () {

    it('round-trips bytes exactly, across many chunks, with NUL bytes in them', function (t, done) {
        var nasty = Buffer.concat([Buffer.from([0x00, 0x01, 0x00]), crypto.randomBytes(4096), Buffer.from([0x00])]);
        var chunks = [];
        for (var o = 0; o < nasty.length; o += 512) { chunks.push(nasty.subarray(o, Math.min(o + 512, nasty.length))); }
        assert.ok(chunks.length > 4, 'control: the fixture really is multi-chunk');
        var f = freshStream();
        f.driver.put(src(chunks), { contentType: 'application/octet-stream' }, function (err, res) {
            assert.ifError(err);
            assert.equal(res.size, nasty.length, 'size is measured from the published file');
            f.driver.get(res.key, function (e2, stream) {
                assert.ifError(e2);
                drain(stream, function (e3, buf) {
                    assert.ifError(e3);
                    assert.ok(buf.equals(nasty));
                    f.driver.close();
                    done();
                });
            });
        });
    });

    it('refuses an object over maxObjectSize and leaves no temp behind', function (t, done) {
        var f = freshStream({ maxObjectSize: 1024 });
        f.driver.put(src(pattern(4096)), function (err) {
            assert.ok(err);
            assert.match(err.message, /exceeds maxObjectSize/);
            var tmpD = nodePath.join(f.root, '.tmp');
            var left = fs.existsSync(tmpD) ? fs.readdirSync(tmpD) : [];
            assert.deepEqual(left, [], 'no temp residue');
            f.driver.close();
            done();
        });
    });

    it('reports the REAL error when the source fails mid-stream', function (t, done) {
        var f = freshStream();
        f.driver.put(srcInterrupted(pattern(64)), function (err) {
            assert.ok(err);
            assert.match(err.message, /interrupted/, 'the real error, never a fabricated one');
            f.driver.close();
            done();
        });
    });

    it('rolls the object back when the metadata row cannot be written', function (t, done) {
        var root = mkRoot();
        var failing = {
            set    : function (key, meta, fn) { fn(new Error('store is down')); },
            get    : function (key, fn) { fn(null, null); },
            remove : function (key, fn) { fn(null, false); },
            close  : function () {}
        };
        var f = freshStream({ root: root, store: failing });
        f.driver.put(src(BODY), function (err) {
            assert.ok(err);
            assert.match(err.message, /store is down/);
            var assetsD = nodePath.join(root, 'assets');
            var left = fs.existsSync(assetsD) ? fs.readdirSync(assetsD) : [];
            var files = left.filter(function (d) {
                return fs.readdirSync(nodePath.join(assetsD, d)).length > 0;
            });
            assert.deepEqual(files, [], 'a caller that got no key leaves no unindexed object behind');
            f.driver.close();
            done();
        });
    });

    it('WIRING PIN: the write streams are sized by the configured chunkSize', function () {
        // highWaterMark leaves no filesystem-visible artifact, so source is the
        // assertable invariant. Needle-found controls first.
        var iPut = STREAM_SRC.indexOf('fs.createWriteStream(tmp, { highWaterMark: chunkSize || undefined })');
        var iSeg = STREAM_SRC.indexOf('highWaterMark : chunkSize || undefined');
        assert.ok(iPut > -1, 'needle: put() must size its write stream from chunkSize');
        assert.ok(iSeg > -1, 'needle: writeSegment() must size its write stream from chunkSize');
        assert.match(STREAM_SRC, /flags\s*:\s*'r\+'/, 'segments are written IN PLACE, never appended');
    });
});

describe('03 - the resumable path: segments arrive out of order', function () {

    it('createUpload requires a positive expectedSize and names put() as the alternative', function (t, done) {
        var f = freshStream();
        var bad = [undefined, null, 0, -1, 1.5, '3000', NaN];
        var i = 0;
        (function next() {
            if ( i === bad.length ) { f.driver.close(); return done(); }
            var v = bad[i++];
            f.driver.createUpload({ expectedSize: v }, function (err) {
                assert.ok(err, 'expectedSize ' + JSON.stringify(v) + ' must be refused');
                assert.match(err.message, /expectedSize/);
                assert.match(err.message, /put\(\)/, 'the message names the unknown-size path');
                next();
            });
        })();
    });

    it('accepts segments in any order, tracks them, and publishes byte-exact', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 3000, originalName: 'v.mp4', contentType: 'video/mp4' }, function (err, sess) {
            assert.ifError(err);
            assert.match(sess.uploadId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
            assert.equal(sess.expectedSize, 3000);
            assert.equal(sess.chunkSize, 8 * 1024 * 1024, 'the driver echoes the size it is tuned for');
            // deliberately LAST segment first
            f.driver.writeSegment(sess.uploadId, 1000, src(BODY.subarray(1000)), function (e2, r2) {
                assert.ifError(e2);
                assert.deepEqual(r2, { offset: 1000, length: 2000, received: 2000 });
                f.driver.statUpload(sess.uploadId, function (e3, st) {
                    assert.ifError(e3);
                    assert.deepEqual(st.received, [{ offset: 1000, length: 2000 }]);
                    assert.deepEqual(st.missing,  [{ offset: 0, length: 1000 }], 'a resuming client is told what to send');
                    assert.equal(st.complete, false);
                    assert.equal(st.contentType, 'video/mp4');
                    assert.equal(st.originalName, 'v.mp4');
                    f.driver.writeSegment(sess.uploadId, 0, src(BODY.subarray(0, 1000)), function (e4, r4) {
                        assert.ifError(e4);
                        assert.equal(r4.received, 3000, 'adjacent spans merge into one');
                        f.driver.statUpload(sess.uploadId, function (e5, st2) {
                            assert.ifError(e5);
                            assert.deepEqual(st2.received, [{ offset: 0, length: 3000 }]);
                            assert.deepEqual(st2.missing, []);
                            assert.equal(st2.complete, true);
                            f.driver.finalize(sess.uploadId, function (e6, res) {
                                assert.ifError(e6);
                                assert.equal(res.size, 3000);
                                assert.equal(res.contentType, 'video/mp4');
                                assert.match(res.key, /^assets\/[0-9A-HJKMNP-TV-Z]{26}\/original\.mp4$/);
                                assert.ok(!fs.existsSync(sessionDir(f.root, sess.uploadId)), 'the session is cleaned up');
                                f.driver.get(res.key, function (e7, stream) {
                                    assert.ifError(e7);
                                    drain(stream, function (e8, buf) {
                                        assert.ifError(e8);
                                        assert.ok(buf.equals(BODY), 'out-of-order segments assemble byte-exact');
                                        f.driver.close();
                                        done();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it('the published object is indexed and readable through every read verb', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 3000, originalName: 'a.bin' }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 0, src(BODY), function (e2) {
                assert.ifError(e2);
                f.driver.finalize(sess.uploadId, function (e3, res) {
                    assert.ifError(e3);
                    f.driver.stat(res.key, function (e4, m) {
                        assert.ifError(e4);
                        assert.equal(m.size, 3000);
                        assert.equal(m.originalName, 'a.bin');
                        f.driver.resolve(res.key, function (e5, r) {
                            assert.ifError(e5);
                            assert.equal(r.kind, 'path', 'a stream driver never inlines');
                            assert.equal(r.path, nodePath.join(f.root, res.key));
                            f.driver.release(res.key, function (e6, existed) {
                                assert.ifError(e6);
                                assert.equal(existed, true);
                                assert.ok(!fs.existsSync(r.path));
                                assert.ok(!fs.existsSync(nodePath.dirname(r.path)),
                                    'the empty asset directory goes too — the operational half of the layout');
                                f.driver.stat(res.key, function (e7, m2) {
                                    assert.ifError(e7);
                                    assert.equal(m2, null);
                                    f.driver.close();
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

describe('04 - coverage is an INTERVAL UNION, and that is what stops a zero-filled publish', function () {

    it('markers whose lengths SUM to the declared size but leave a gap are REFUSED', function (t, done) {
        // The kill case: 0-800 and 400-1200 sum to 1600 == expectedSize, while
        // 1200-1600 is uncovered. A sum-based check publishes; a union does not.
        var f = freshStream();
        var body = pattern(1600);
        f.driver.createUpload({ expectedSize: 1600 }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 0, src(body.subarray(0, 800)), function (e2) {
                assert.ifError(e2);
                f.driver.writeSegment(sess.uploadId, 400, src(body.subarray(400, 1200)), function (e3, r3) {
                    assert.ifError(e3);
                    var dir = sessionDir(f.root, sess.uploadId);
                    var sum = markers(dir).reduce(function (a, n) { return a + parseInt(n.split('-')[1], 10); }, 0);
                    assert.equal(sum, 1600, 'control: the marker LENGTHS really do sum to the declared size');
                    assert.equal(r3.received, 1200, 'the union covers only 1200 of them');
                    f.driver.finalize(sess.uploadId, function (e4) {
                        assert.ok(e4, 'a sum-based implementation would have published here');
                        assert.match(e4.message, /incomplete/);
                        assert.match(e4.message, /first gap at offset 1200/);
                        assert.ok(fs.existsSync(dir), 'the session is PRESERVED so the client can complete it');
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });

    it('a data file whose SIZE matches the declared size but holds a zero-filled hole is REFUSED', function (t, done) {
        // The hazard in its purest form: positional writes at 0 and 1200 leave
        // 800-1200 unwritten, and an unwritten range reads back as ZEROS — so
        // without the union check finalise would publish a plausible object
        // with 400 silently wrong bytes.
        var f = freshStream();
        var body = pattern(1600);
        f.driver.createUpload({ expectedSize: 1600 }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 0, src(body.subarray(0, 800)), function (e2) {
                assert.ifError(e2);
                f.driver.writeSegment(sess.uploadId, 1200, src(body.subarray(1200)), function (e3) {
                    assert.ifError(e3);
                    var dir  = sessionDir(f.root, sess.uploadId);
                    var data = fs.readFileSync(nodePath.join(dir, 'data'));
                    assert.equal(data.length, 1600, 'control: the file is exactly the declared size');
                    assert.ok(data.subarray(800, 1200).every(function (b) { return b === 0; }),
                        'control: the hole really does read back as zeros — this is the hazard, measured');
                    f.driver.finalize(sess.uploadId, function (e4) {
                        assert.ok(e4, 'a size-based check would have published 400 zero bytes as content');
                        assert.match(e4.message, /first gap at offset 800/);
                        assert.ok(fs.existsSync(dir));
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });

    it('refuses to publish when the markers claim more than the bytes back', function (t, done) {
        // The marker/bytes desync the fate-sharing argument is about: a full
        // marker set beside a short file. Refuse, never truncate-and-publish.
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 3000 }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 0, src(BODY), function (e2) {
                assert.ifError(e2);
                var dir = sessionDir(f.root, sess.uploadId);
                fs.truncateSync(nodePath.join(dir, 'data'), 1000);   // bytes lost under a full marker set
                f.driver.finalize(sess.uploadId, function (e3) {
                    assert.ok(e3);
                    assert.match(e3.message, /claims full coverage but its assembling file is only 1000/);
                    assert.ok(fs.existsSync(dir), 'preserved — nothing here can safely repair it');
                    f.driver.close();
                    done();
                });
            });
        });
    });
});

describe('05 - partial segments and re-sends', function () {

    it('a segment that ends early is marked for the RECEIVED length, not the promised one', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 3000 }, function (err, sess) {
            assert.ifError(err);
            // the client intends 1000 bytes from offset 0 but delivers 64
            f.driver.writeSegment(sess.uploadId, 0, srcInterrupted(BODY.subarray(0, 64)), function (e2) {
                assert.ok(e2, 'the interruption is reported');
                f.driver.statUpload(sess.uploadId, function (e3, st) {
                    assert.ifError(e3);
                    assert.deepEqual(st.received, [], 'a failed segment claims NOTHING — no marker was written');
                    // and the range is re-sendable
                    f.driver.writeSegment(sess.uploadId, 0, src(BODY.subarray(0, 1000)), function (e4, r4) {
                        assert.ifError(e4);
                        assert.equal(r4.received, 1000);
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });

    it('re-sending a covered range is idempotent, and overlaps merge', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 3000 }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 0, src(BODY.subarray(0, 2000)), function (e2) {
                assert.ifError(e2);
                f.driver.writeSegment(sess.uploadId, 0, src(BODY.subarray(0, 2000)), function (e3, r3) {
                    assert.ifError(e3);
                    assert.equal(r3.received, 2000, 'the same range twice covers the same bytes once');
                    f.driver.writeSegment(sess.uploadId, 1500, src(BODY.subarray(1500)), function (e4, r4) {
                        assert.ifError(e4);
                        assert.equal(r4.received, 3000);
                        f.driver.statUpload(sess.uploadId, function (e5, st) {
                            assert.ifError(e5);
                            assert.deepEqual(st.received, [{ offset: 0, length: 3000 }], 'overlapping spans merge into one');
                            f.driver.finalize(sess.uploadId, function (e6, res) {
                                assert.ifError(e6);
                                f.driver.get(res.key, function (e7, stream) {
                                    assert.ifError(e7);
                                    drain(stream, function (e8, buf) {
                                        assert.ifError(e8);
                                        assert.ok(buf.equals(BODY), 'overlapping re-sends do not corrupt the object');
                                        f.driver.close();
                                        done();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it('a segment running past the declared size is refused', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 1000 }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 500, src(pattern(2000)), function (e2) {
                assert.ok(e2);
                assert.match(e2.message, /runs past the declared size/);
                f.driver.statUpload(sess.uploadId, function (e3, st) {
                    assert.ifError(e3);
                    assert.deepEqual(st.received, [], 'nothing is claimed for a refused segment');
                    f.driver.close();
                    done();
                });
            });
        });
    });

    it('an offset at or beyond the declared size is refused', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 1000 }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 1000, src(pattern(1)), function (e2) {
                assert.ok(e2);
                assert.match(e2.message, /at or beyond the declared size/);
                f.driver.writeSegment(sess.uploadId, -1, src(pattern(1)), function (e3) {
                    assert.ok(e3);
                    assert.match(e3.message, /offset must be an integer/);
                    f.driver.writeSegment(sess.uploadId, 1.5, src(pattern(1)), function (e4) {
                        assert.ok(e4);
                        // control: a legitimate offset in the same session passes
                        f.driver.writeSegment(sess.uploadId, 0, src(pattern(10)), function (e5, r5) {
                            assert.ifError(e5);
                            assert.equal(r5.length, 10, 'control: the verb works for a valid offset');
                            f.driver.close();
                            done();
                        });
                    });
                });
            });
        });
    });
});

describe('06 - finalize is idempotent and heals a published-but-unindexed object', function () {

    it('a retry after a failed row write publishes nothing new and completes the row', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 3000, originalName: 'a.bin', contentType: 'application/x-bin' }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 0, src(BODY), function (e2) {
                assert.ifError(e2);
                var dir = sessionDir(f.root, sess.uploadId);
                var man = JSON.parse(fs.readFileSync(nodePath.join(dir, 'meta.json'), 'utf8'));
                // reproduce the residue: bytes published, process died before the row
                var final = nodePath.join(f.root, man.key);
                fs.mkdirSync(nodePath.dirname(final), { recursive: true });
                fs.renameSync(nodePath.join(dir, 'data'), final);
                f.driver.stat(man.key, function (e3, before) {
                    assert.ifError(e3);
                    assert.equal(before, null, 'control: the object is unindexed before the heal');
                    f.driver.finalize(sess.uploadId, function (e4, res) {
                        assert.ifError(e4, 'the retry completes rather than wedging');
                        assert.equal(res.key, man.key, 'the SAME key — it was minted at createUpload');
                        assert.equal(res.size, 3000);
                        f.driver.stat(man.key, function (e5, after) {
                            assert.ifError(e5);
                            assert.equal(after.size, 3000);
                            assert.equal(after.originalName, 'a.bin', 'the manifest carried the identity fields through');
                            assert.equal(after.contentType, 'application/x-bin');
                            assert.ok(!fs.existsSync(dir), 'and the session is cleaned up on the retry');
                            f.driver.close();
                            done();
                        });
                    });
                });
            });
        });
    });

    it('the key is minted at createUpload and persisted, not invented at finalize', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 10, originalName: 'x.pdf' }, function (err, sess) {
            assert.ifError(err);
            var man = JSON.parse(fs.readFileSync(nodePath.join(sessionDir(f.root, sess.uploadId), 'meta.json'), 'utf8'));
            assert.match(man.key, /^assets\/[0-9A-HJKMNP-TV-Z]{26}\/original\.pdf$/, 'the key exists before any byte arrives');
            f.driver.writeSegment(sess.uploadId, 0, src(pattern(10)), function (e2) {
                assert.ifError(e2);
                f.driver.finalize(sess.uploadId, function (e3, res) {
                    assert.ifError(e3);
                    assert.equal(res.key, man.key);
                    f.driver.close();
                    done();
                });
            });
        });
    });

    it('finalizing a session that no longer exists errors rather than inventing one', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 10 }, function (err, sess) {
            assert.ifError(err);
            f.driver.abortUpload(sess.uploadId, function (e2, r2) {
                assert.ifError(e2);
                assert.deepEqual(r2, { aborted: true });
                f.driver.finalize(sess.uploadId, function (e3) {
                    assert.ok(e3);
                    assert.match(e3.message, /no such upload session/);
                    f.driver.abortUpload(sess.uploadId, function (e4, r4) {
                        assert.ifError(e4);
                        assert.deepEqual(r4, { aborted: false }, 'abort is idempotent');
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });
});

describe('07 - the manifest is atomic, and every verb fails loudly without it', function () {

    it('is written through temp+rename, so a crash leaves it absent rather than truncated', function () {
        var iWrite  = STREAM_SRC.indexOf('fs.writeFileSync(metaTmp, JSON.stringify(manifest));');
        var iRename = STREAM_SRC.indexOf('fs.renameSync(metaTmp, nodePath.join(dir, META_FILE));');
        assert.ok(iWrite > -1,  'needle: the manifest must be written to a temp first');
        assert.ok(iRename > -1, 'needle: the manifest temp must be renamed into place');
        assert.ok(iWrite < iRename, 'write the temp, THEN rename — that is what makes the state binary');
    });

    it('a truncated manifest is refused by statUpload, writeSegment and finalize alike', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 100 }, function (err, sess) {
            assert.ifError(err);
            var dir = sessionDir(f.root, sess.uploadId);
            // control: everything works before the corruption
            f.driver.statUpload(sess.uploadId, function (e0, ok) {
                assert.ifError(e0);
                assert.equal(ok.expectedSize, 100, 'control: the session is readable before we corrupt it');
                fs.writeFileSync(nodePath.join(dir, 'meta.json'), '{"key":"assets/x/original","expec');
                f.driver.statUpload(sess.uploadId, function (e1) {
                    assert.ok(e1);
                    assert.match(e1.message, /unreadable/);
                    f.driver.writeSegment(sess.uploadId, 0, src(pattern(10)), function (e2) {
                        assert.ok(e2);
                        f.driver.finalize(sess.uploadId, function (e3) {
                            assert.ok(e3);
                            f.driver.close();
                            done();
                        });
                    });
                });
            });
        });
    });

    it('a well-formed but malformed-shape manifest is refused too', function (t, done) {
        var f = freshStream();
        f.driver.createUpload({ expectedSize: 100 }, function (err, sess) {
            assert.ifError(err);
            var dir = sessionDir(f.root, sess.uploadId);
            fs.writeFileSync(nodePath.join(dir, 'meta.json'), JSON.stringify({ key: 'assets/x/original' }));
            f.driver.finalize(sess.uploadId, function (e2) {
                assert.ok(e2, 'a manifest with no expectedSize cannot verify coverage over anything');
                assert.match(e2.message, /malformed/);
                f.driver.close();
                done();
            });
        });
    });
});

describe('08 - upload ids are validated BEFORE any path join', function () {

    it('rejects traversal, dot segments, wrong charset and non-strings', function (t, done) {
        var f = freshStream();
        var bad = [
            '../../etc', '..', '.', '', '/abs',
            '01M00QEJAFM75922FFCGF6ZF',            // 25 chars
            '01M00QEJAFM75922FFCGF6ZFGZZ',         // 27 chars
            '01M00QEJAFM75922FFCGF6ZFGI',          // I is not in Crockford base32
            '01m00qejafm75922ffcgf6zfgz',          // lowercase
            null, undefined, 42, {}
        ];
        var i = 0;
        (function next() {
            if ( i === bad.length ) { return control(); }
            var v = bad[i++];
            f.driver.statUpload(v, function (err) {
                assert.ok(err, 'upload id ' + JSON.stringify(v) + ' must be refused');
                assert.match(err.message, /not a valid upload id/);
                next();
            });
        })();

        // The control that makes the sweep above mean something: a REAL id passes.
        function control() {
            f.driver.createUpload({ expectedSize: 10 }, function (err, sess) {
                assert.ifError(err);
                f.driver.statUpload(sess.uploadId, function (e2, st) {
                    assert.ifError(e2, 'control: a valid id is accepted, so the rejections above are discriminating');
                    assert.equal(st.expectedSize, 10);
                    f.driver.close();
                    done();
                });
            });
        }
    });

    it('a hostile id never reaches the filesystem', function (t, done) {
        var f = freshStream();
        var before = fs.existsSync(nodePath.join(f.root, '.uploads'))
            ? fs.readdirSync(nodePath.join(f.root, '.uploads')).length
            : 0;
        f.driver.abortUpload('../../..', function (err) {
            assert.ok(err);
            var after = fs.existsSync(nodePath.join(f.root, '.uploads'))
                ? fs.readdirSync(nodePath.join(f.root, '.uploads')).length
                : 0;
            assert.equal(after, before, 'nothing was created, nothing was removed');
            assert.ok(fs.existsSync(f.root), 'and the root itself is still there');
            f.driver.close();
            done();
        });
    });
});

describe('09 - maxObjectSize: the early reject is advisory, the counter is the enforcement', function () {

    it('refuses an oversized expectedSize before any byte moves', function (t, done) {
        var f = freshStream({ maxObjectSize: 1024 });
        f.driver.createUpload({ expectedSize: 4096 }, function (err) {
            assert.ok(err);
            assert.match(err.message, /exceeds maxObjectSize/);
            assert.match(err.message, /before any bytes were transferred/);
            var uploads = nodePath.join(f.root, '.uploads');
            assert.ok(!fs.existsSync(uploads) || fs.readdirSync(uploads).length === 0, 'no session was opened');
            f.driver.close();
            done();
        });
    });

    it('a LYING expectedSize is still capped by the running byte counter', function (t, done) {
        // expectedSize is client-supplied, so the early reject can be walked
        // around by declaring a small total and then sending more. The counter
        // in writeSegment is what actually holds the line.
        var f = freshStream({ maxObjectSize: 1024 });
        f.driver.createUpload({ expectedSize: 512 }, function (err, sess) {
            assert.ifError(err, 'control: the small declared size is accepted');
            f.driver.writeSegment(sess.uploadId, 0, src(pattern(4096)), function (e2) {
                assert.ok(e2, 'the oversized segment is refused despite the honest-looking declaration');
                assert.match(e2.message, /runs past the declared size/);
                var data = nodePath.join(sessionDir(f.root, sess.uploadId), 'data');
                assert.ok(fs.statSync(data).size <= 1024, 'and nothing beyond the cap was retained');
                f.driver.close();
                done();
            });
        });
    });
});

describe('10 - abandoned sessions and temp orphans are reclaimed, age-gated both sides', function () {

    it('a fresh session survives and a stale one is reclaimed', function (t, done) {
        var f = freshStream({ sessionTtl: 60 * 60 * 1000 });
        f.driver.createUpload({ expectedSize: 100 }, function (err, live) {
            assert.ifError(err);
            f.driver.createUpload({ expectedSize: 100 }, function (e2, stale) {
                assert.ifError(e2);
                var staleDir = sessionDir(f.root, stale.uploadId);
                var past = new Date(Date.now() - (2 * 60 * 60 * 1000));
                fs.utimesSync(nodePath.join(staleDir, 'data'), past, past);
                var r = f.driver._sweepAbandoned();
                assert.equal(r.sessions, 1);
                assert.ok(fs.existsSync(sessionDir(f.root, live.uploadId)), 'the fresh session survives — the gate is real');
                assert.ok(!fs.existsSync(staleDir), 'the stale one is gone');
                f.driver.close();
                done();
            });
        });
    });

    it('liveness comes from mtime(data), so a long segment write is never mistaken for idleness', function (t, done) {
        var f = freshStream({ sessionTtl: 60 * 60 * 1000 });
        f.driver.createUpload({ expectedSize: 3000 }, function (err, sess) {
            assert.ifError(err);
            var dir = sessionDir(f.root, sess.uploadId);
            var past = new Date(Date.now() - (2 * 60 * 60 * 1000));
            // the DIRECTORY looks ancient; the data file does not
            fs.utimesSync(nodePath.join(dir, 'data'), new Date(), new Date());
            fs.utimesSync(dir, past, past);
            var r = f.driver._sweepAbandoned();
            assert.equal(r.sessions, 0, 'a stale directory mtime must not condemn a live upload');
            assert.ok(fs.existsSync(dir));
            // and the fallback still works when `data` is gone entirely
            fs.rmSync(nodePath.join(dir, 'data'));
            fs.utimesSync(dir, past, past);
            var r2 = f.driver._sweepAbandoned();
            assert.equal(r2.sessions, 1, 'a session whose data was renamed away is reclaimable by dir mtime');
            f.driver.close();
            done();
        });
    });

    it('reclaims put() temp orphans on the same gate', function (t, done) {
        var f = freshStream({ sessionTtl: 60 * 60 * 1000 });
        var tmpD = nodePath.join(f.root, '.tmp');
        fs.mkdirSync(tmpD, { recursive: true });
        var oldTmp = nodePath.join(tmpD, 'ancient.tmp');
        var newTmp = nodePath.join(tmpD, 'inflight.tmp');
        fs.writeFileSync(oldTmp, 'x');
        fs.writeFileSync(newTmp, 'x');
        var past = new Date(Date.now() - (2 * 60 * 60 * 1000));
        fs.utimesSync(oldTmp, past, past);
        var r = f.driver._sweepAbandoned();
        assert.equal(r.temps, 1);
        assert.ok(!fs.existsSync(oldTmp), 'a crashed put()\'s temp is reclaimed');
        assert.ok(fs.existsSync(newTmp), 'a sibling process\'s in-flight write is NEVER eaten');
        f.driver.close();
        done();
    });

    it('the build-time pass runs, and the periodic timer is unref\'d and cleared by close()', function (t, done) {
        var root = mkRoot();
        var f1 = freshStream({ root: root, sessionTtl: 60 * 60 * 1000 });
        f1.driver.createUpload({ expectedSize: 100 }, function (err, sess) {
            assert.ifError(err);
            var dir = sessionDir(root, sess.uploadId);
            var past = new Date(Date.now() - (2 * 60 * 60 * 1000));
            fs.utimesSync(nodePath.join(dir, 'data'), past, past);
            f1.driver.close();
            // a restart on the same root: the build-time pass is what reclaims
            // what a crashed process left behind
            var store2 = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
            var f2 = createLocalStreamDriver('streamT', {
                root: root, strategy: 'stream', maxObjectSize: 1024,
                chunkSize: 1024, fsync: false,
                sessionTtl: 60 * 60 * 1000, sessionSweepInterval: 0
            }, store2);
            assert.ok(!fs.existsSync(dir), 'the stale session was reclaimed at build time');
            f2.close();
            assert.match(STREAM_SRC, /if \( sweepTimer\.unref \) \{ sweepTimer\.unref\(\); \}/,
                'the periodic timer never holds the process open');
            done();
        });
    });
});

describe('11 - getRange on stream', function () {

    var f = freshStream();
    var key = null;

    it('publishes a fixture to range over', function (t, done) {
        f.driver.put(src(BODY), function (err, res) {
            assert.ifError(err);
            key = res.key;
            done();
        });
    });

    it('returns an interior range, bytes exact at both ends, end INCLUSIVE', function (t, done) {
        f.driver.getRange(key, 100, 199, function (err, stream) {
            assert.ifError(err);
            drain(stream, function (e2, got) {
                assert.ifError(e2);
                assert.equal(got.length, 100, 'inclusive end ⇒ 100 bytes');
                assert.deepEqual(got, BODY.subarray(100, 200));
                done();
            });
        });
    });

    it('serves the first byte, the last byte and a single byte', function (t, done) {
        f.driver.getRange(key, 0, 0, function (err, s1) {
            assert.ifError(err);
            drain(s1, function (e1, b1) {
                assert.ifError(e1);
                assert.deepEqual(b1, BODY.subarray(0, 1));
                f.driver.getRange(key, 2999, 2999, function (e2, s2) {
                    assert.ifError(e2);
                    drain(s2, function (e3, b2) {
                        assert.ifError(e3);
                        assert.deepEqual(b2, BODY.subarray(2999));
                        done();
                    });
                });
            });
        });
    });

    it('an end past the last byte is CLAMPED, not refused', function (t, done) {
        f.driver.getRange(key, 2990, 999999, function (err, stream) {
            assert.ifError(err, 'a satisfiable start must not error');
            drain(stream, function (e2, got) {
                assert.ifError(e2);
                assert.equal(got.length, 10);
                assert.deepEqual(got, BODY.subarray(2990));
                done();
            });
        });
    });

    it('a start at or beyond the object size is unsatisfiable (the caller 416s)', function (t, done) {
        f.driver.getRange(key, 3000, 3010, function (err) {
            assert.ok(err);
            assert.match(err.message, /beyond the object size/);
            done();
        });
    });

    it('rejects malformed bounds, and requires a callback', function (t, done) {
        var bad = [ [10, 5], [-1, 10], [0.5, 10], [0, 1.5], [NaN, 10], [0, NaN] ];
        var i = 0;
        assert.throws(function () { f.driver.getRange(key, 0, 1); }, /requires a callback/);
        (function next() {
            if ( i === bad.length ) { f.driver.close(); return done(); }
            var pair = bad[i++];
            f.driver.getRange(key, pair[0], pair[1], function (err) {
                assert.ok(err, 'range [' + pair[0] + ', ' + pair[1] + '] must be refused');
                assert.match(err.message, /invalid range/);
                next();
            });
        })();
    });
});

describe('12 - capabilities, and the verbs stay where they belong', function () {

    it('declares resumable and ranges true; inline and dedup are false BY DESIGN', function () {
        var f = freshStream();
        assert.deepEqual(f.driver.capabilities, {
            offload   : false,
            ranges    : true,
            dedup     : false,
            resumable : true,
            inline    : false
        });
        f.driver.close();
    });

    it('carries the five resumable verbs and NOT the cas ones', function () {
        var f = freshStream();
        ['createUpload', 'writeSegment', 'statUpload', 'finalize', 'abortUpload'].forEach(function (v) {
            assert.equal(typeof f.driver[v], 'function', v + ' is stream surface');
        });
        // Controls — the discrimination that proves this is not a blanket
        // "every verb on every driver" change.
        assert.equal(typeof f.driver.findByDigest, 'undefined', 'findByDigest stays cas-only');
        assert.equal(typeof f.driver.sweepNow, 'undefined', 'the gc door stays cas-only — stream sweeps on its own schedule');
        assert.equal(typeof f.driver.verify, 'undefined', 'verify stays cas-only in v1');
        assert.equal(typeof f.driver.getRange, 'function', 'control: a shared verb IS present');
        f.driver.close();
    });

    it('every verb refuses to run without a callback rather than swallowing the result', function () {
        var f = freshStream();
        assert.throws(function () { f.driver.put(src(BODY)); }, /requires a callback/);
        assert.throws(function () { f.driver.get('k'); }, /requires a callback/);
        assert.throws(function () { f.driver.stat('k'); }, /requires a callback/);
        assert.throws(function () { f.driver.resolve('k'); }, /requires a callback/);
        assert.throws(function () { f.driver.stats(); }, /requires a callback/);
        assert.throws(function () { f.driver.createUpload({ expectedSize: 1 }); }, /requires a callback/);
        assert.throws(function () { f.driver.writeSegment('x', 0, src(BODY)); }, /requires a callback/);
        assert.throws(function () { f.driver.statUpload('x'); }, /requires a callback/);
        assert.throws(function () { f.driver.finalize('x'); }, /requires a callback/);
        f.driver.close();
    });

    it('stats() reports the strategy, the root and the store aggregate', function (t, done) {
        var f = freshStream();
        f.driver.put(src(BODY), function (err) {
            assert.ifError(err);
            f.driver.stats(function (e2, s) {
                assert.ifError(e2);
                assert.equal(s.name, 'streamT');
                assert.equal(s.strategy, 'stream');
                assert.equal(s.root, f.root);
                assert.equal(s.capabilities.resumable, true);
                assert.equal(s.store.objects, 1);
                assert.equal(s.store.bytes, 3000);
                assert.equal(s.store.inline, 0, 'a stream driver never inlines');
                f.driver.close();
                done();
            });
        });
    });
});

describe('13 - fsync: ordered before the claim, honest about the platform', function () {

    it('WIRING PIN: a segment is fsynced BEFORE its marker is created', function () {
        // The whole durability contract of a resumable upload is in this
        // order: a surviving marker must imply durable bytes. fsync leaves no
        // filesystem-visible artifact and the house bans mocks, so source
        // order IS the assertable invariant. Needle-found controls first.
        var iFsync  = STREAM_SRC.indexOf('if ( fsyncOn ) { fsyncFile(dataPath); }');
        var iMarker = STREAM_SRC.indexOf("offset + '-' + written + '.ok'");
        assert.ok(iFsync > -1,  'needle: the segment fsync call site must exist');
        assert.ok(iMarker > -1, 'needle: the marker create must exist');
        assert.ok(iFsync < iMarker, 'the DATA is durable before the marker claims it is');
    });

    it('WIRING PIN: finalize fsyncs the data before the rename, the directory after', function () {
        var iSegFsync = STREAM_SRC.indexOf('if ( fsyncOn ) { fsyncFile(dataPath); }');
        assert.ok(iSegFsync > -1, 'needle: the first (writeSegment) fsync must exist');
        // the SECOND occurrence is finalize's — indexOf from just past the first
        var iFsync  = STREAM_SRC.indexOf('if ( fsyncOn ) { fsyncFile(dataPath); }', iSegFsync + 1);
        var iRename = STREAM_SRC.indexOf('fs.renameSync(dataPath, final);');
        var iDir    = STREAM_SRC.indexOf('if ( fsyncOn ) { fsyncDirBestEffort(nodePath.dirname(final)); }', iRename);
        assert.ok(iFsync > -1,  'needle: finalize must fsync the assembled file');
        assert.ok(iRename > -1, 'needle: the rename publish must exist');
        assert.ok(iDir > -1,    'needle: the directory fsync call site must exist');
        assert.ok(iFsync < iRename, 'the FILE is durable before the rename publishes it');
        assert.ok(iRename < iDir,   'the DIRECTORY entry is flushed after the rename creates it');
        // and the helpers keep their halves of the contract
        assert.match(STREAM_SRC, /var fsyncFile = function/,          'hard half exists');
        assert.match(STREAM_SRC, /var fsyncDirBestEffort = function/, 'best-effort half exists');
    });

    it('the flag gates durability only, never correctness — a fsync:false driver behaves identically', function (t, done) {
        var f = freshStream({ fsync: false });
        f.driver.createUpload({ expectedSize: 3000 }, function (err, sess) {
            assert.ifError(err);
            f.driver.writeSegment(sess.uploadId, 1500, src(BODY.subarray(1500)), function (e2) {
                assert.ifError(e2);
                f.driver.writeSegment(sess.uploadId, 0, src(BODY.subarray(0, 1500)), function (e3) {
                    assert.ifError(e3);
                    f.driver.finalize(sess.uploadId, function (e4, res) {
                        assert.ifError(e4);
                        f.driver.get(res.key, function (e5, stream) {
                            assert.ifError(e5);
                            drain(stream, function (e6, buf) {
                                assert.ifError(e6);
                                assert.ok(buf.equals(BODY));
                                f.driver.close();
                                done();
                            });
                        });
                    });
                });
            });
        });
    });
});

describe('14 - validateConfig knows stream', function () {

    var root = mkRoot();
    var ok   = function (over) { return Object.assign({ adapter: 'local', strategy: 'stream', root: root }, over || {}); };

    it('accepts a minimal stream driver', function () {
        var r = storage.validateConfig({ default: 'm', drivers: { m: ok() } });
        assert.equal(r.fatal, null);
        assert.deepEqual(r.warnings, []);
        assert.equal(r.driverCount, 1);
    });

    it('warns on an unparseable or zero chunkSize and falls back to the default', function () {
        assert.match(storage.validateConfig({ drivers: { m: ok({ chunkSize: '8' }) } }).warnings[0], /chunkSize` must carry a unit/);
        assert.match(storage.validateConfig({ drivers: { m: ok({ chunkSize: 8 }) } }).warnings[0], /chunkSize` must carry a unit/);
        assert.match(storage.validateConfig({ drivers: { m: ok({ chunkSize: '0B' }) } }).warnings[0], /greater than zero/);
        // control: a valid one is silent
        assert.deepEqual(storage.validateConfig({ drivers: { m: ok({ chunkSize: '4MB' }) } }).warnings, []);
    });

    it('warns on a non-boolean fsync', function () {
        assert.match(storage.validateConfig({ drivers: { m: ok({ fsync: 'yes' }) } }).warnings[0], /`fsync` must be a boolean/);
        assert.deepEqual(storage.validateConfig({ drivers: { m: ok({ fsync: false }) } }).warnings, []);
    });

    it('requires units on the duration keys, and a zero sessionTtl never means "off"', function () {
        assert.match(storage.validateConfig({ drivers: { m: ok({ sessionTtl: '24' }) } }).warnings[0], /sessionTtl` must carry a unit/);
        assert.match(storage.validateConfig({ drivers: { m: ok({ sessionTtl: '0s' }) } }).warnings[0], /would reclaim in-flight uploads/);
        assert.match(storage.validateConfig({ drivers: { m: ok({ sessionSweepInterval: '1' }) } }).warnings[0], /sessionSweepInterval` must carry a unit/);
        // '0s' IS the documented way to turn the periodic sweep off — silent
        assert.deepEqual(storage.validateConfig({ drivers: { m: ok({ sessionSweepInterval: '0s' }) } }).warnings, []);
    });

    it('names inlineThreshold and hash as ignored on a stream driver', function () {
        var r = storage.validateConfig({ drivers: { m: ok({ inlineThreshold: '64KB', hash: 'sha256' }) } });
        assert.equal(r.fatal, null);
        assert.match(r.warnings[0], /inlineThreshold, hash are not used by the `stream` strategy/);
        // control: the same keys are legitimate elsewhere
        var casOk = storage.validateConfig({ drivers: { m: { adapter: 'local', strategy: 'cas', root: root, inlineThreshold: '64KB', hash: 'sha256' } } });
        assert.deepEqual(casOk.warnings, [], 'control: cas consumes both without complaint');
    });

    it('resolves the stream defaults, and only for stream', function () {
        var r = storage._resolveDriverConf(ok());
        assert.equal(r.chunkSize, storage._DEFAULT_CHUNK_SIZE);
        assert.equal(r.fsync, storage._DEFAULT_STREAM_FSYNC);
        assert.equal(r.sessionTtl, storage._DEFAULT_SESSION_TTL);
        assert.equal(r.sessionSweepInterval, storage._DEFAULT_SESSION_SWEEP_INTERVAL);
        assert.equal(storage._DEFAULT_CHUNK_SIZE, 8 * 1024 * 1024);
        assert.equal(storage._DEFAULT_SESSION_TTL, 24 * 60 * 60 * 1000);
        // control: a sharded driver gets none of them
        var sharded = storage._resolveDriverConf({ adapter: 'local', strategy: 'sharded', root: root });
        assert.equal(typeof sharded.chunkSize, 'undefined');
        assert.equal(typeof sharded.sessionTtl, 'undefined');
    });

    it("'0s' keeps its zero for the sweep interval, while a zero ttl snaps to the default", function () {
        var r = storage._resolveDriverConf(ok({ sessionSweepInterval: '0s', sessionTtl: '0s' }));
        assert.equal(r.sessionSweepInterval, 0, 'periodic sweep off is a legal configuration');
        assert.equal(r.sessionTtl, storage._DEFAULT_SESSION_TTL, 'a zero TTL would eat in-flight uploads');
    });

    it('stream is a built strategy, dispatched through FACTORIES', function () {
        assert.ok(storage._STRATEGIES.indexOf('stream') > -1);
        assert.equal(typeof storage._FACTORIES.stream, 'function');
        assert.deepEqual(storage._DEFERRED_STRATEGIES, [], 'nothing is designed-but-unshipped any more');
    });
});
