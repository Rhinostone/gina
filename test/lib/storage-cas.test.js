/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * #STO1 — the `cas` strategy: content-addressed keys, refcounted dedup, the
 * GC sweep, fsync durability, and the strategy stamp.
 *
 * ⚠️ This file contains NUL bytes in binary fixtures (the byte-fidelity
 * describe) — plain grep treats it as binary and SUPPRESSES matches; always
 * `grep -a` it (the storage-local.test.js lesson, recorded in
 * measurement-traps).
 *
 * Everything asserted here is a runtime VALUE — a key's shape, a refcount, a
 * rejection, the presence or absence of a file or row — except §09's fsync
 * ORDER pin, which is structural BECAUSE fsync leaves no filesystem-visible
 * artifact to assert and the house bans mocks: a source-order pin with
 * needle-found controls is the honest instrument for "the file is flushed
 * before the rename publishes it". Row-level absences are measured by opening
 * the driver's own database directly (the seam's list verb only covers
 * zero-ref rows).
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
var createLocalCasDriver    = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local-cas.js'));
var createLocalDriver       = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local.js'));
var createEmbeddedMetaStore = require(nodePath.join(FW, 'lib', 'storage', 'src', 'meta-store.js'));
var sqliteDriver            = require(nodePath.join(FW, 'lib', 'sqlite-driver.js'));

var CAS_SRC = fs.readFileSync(nodePath.join(FW, 'lib', 'storage', 'src', 'local-cas.js'), 'utf8');

/** temp roots created by tests, removed in one file-level after() @type {string[]} */
var roots = [];

after(function () {
    storage.reset();
    roots.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
});

/**
 * A fresh temp root.
 *
 * @inner
 * @returns {string} Absolute path.
 */
function mkRoot() {
    var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-cas-'));
    roots.push(root);
    return root;
}

/**
 * Build a cas driver + its embedded store on a fresh root. Defaults mirror
 * what start() would resolve, EXCEPT the sweep timer (0 — tests drive
 * `_sweepOnce` deterministically) and tiering (0 — the file path — unless a
 * test opts in).
 *
 * @inner
 * @param {object} [over] - Conf overrides.
 * @returns {{driver: object, root: string, store: object}}
 */
function freshCas(over) {
    over = over || {};
    var root  = over.root || mkRoot();
    var store = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
    var conf  = {
        root            : root,
        strategy        : 'cas',
        maxObjectSize   : over.maxObjectSize || (50 * 1024 * 1024),
        hash            : over.hash || 'sha256',
        fsync           : ( typeof over.fsync === 'boolean' ) ? over.fsync : true,
        sweepInterval   : 0,
        sweepGrace      : over.sweepGrace || (60 * 60 * 1000),
        inlineThreshold : over.inlineThreshold || 0
    };
    return { driver: createLocalCasDriver('casT', conf, store), root: root, store: store };
}

/**
 * A readable that emits `chunks` then ends.
 *
 * @inner
 * @param {Buffer[]} chunks
 * @returns {object} Readable.
 */
function src(chunks) {
    var r = new Readable({ read: function () {} });
    chunks.forEach(function (c) { r.push(c); });
    r.push(null);
    return r;
}

/**
 * A readable destroyed with a real error after its chunks drain — the no-op
 * read keeps it legitimately pending (a bare `new Readable()` would raise its
 * own `_read() not implemented` first and mask the injected error).
 *
 * @inner
 * @param {Buffer[]} chunks
 * @returns {object} Readable.
 */
function srcInterrupted(chunks) {
    var r = new Readable({ read: function () {} });
    chunks.forEach(function (c) { r.push(c); });
    setImmediate(function () { r.destroy(new Error('interrupted')); });
    return r;
}

/**
 * Collect a stream into one Buffer.
 *
 * @inner
 * @param {object}   stream
 * @param {function} fn - `fn(err, buf)`.
 * @returns {void}
 */
function drain(stream, fn) {
    var bufs = [];
    stream.on('data', function (c) { bufs.push(c); });
    stream.on('error', fn);
    stream.on('end', function () { fn(null, Buffer.concat(bufs)); });
}

/**
 * Open the driver's own database directly — the positive instrument behind
 * every row-level claim the seam cannot express.
 *
 * @inner
 * @param {string} root
 * @returns {object} An open DatabaseSync handle — caller closes.
 */
function openDb(root) {
    var DatabaseSync = sqliteDriver.getDatabaseSync();
    return new DatabaseSync(nodePath.join(root, '.meta.db'));
}

/**
 * Non-database entries under the root (recursive): published blobs and stray
 * temps, excluding `.meta.db` and its WAL/SHM sidecars.
 *
 * @inner
 * @param {string} dir
 * @returns {string[]} Absolute paths.
 */
function nonDbEntries(dir) {
    var out = [];
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
        var full = nodePath.join(dir, entries[i].name);
        if ( entries[i].isDirectory() ) {
            out = out.concat(nonDbEntries(full));
        } else if ( entries[i].isFile() && entries[i].name.indexOf('.meta.db') !== 0 ) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Backdate a key's zero_at so the grace window has visibly elapsed.
 *
 * @inner
 * @param {string} root
 * @param {string} key
 * @param {number} ms - How far into the past.
 * @returns {void}
 */
function backdateZero(root, key, ms) {
    var db = openDb(root);
    db.prepare('UPDATE objects SET zero_at = ? WHERE key = ?').run(Date.now() - ms, key);
    db.close();
}

var PAYLOAD = Buffer.from('cas fixture payload — stable bytes\n');
var HEX     = crypto.createHash('sha256').update(PAYLOAD).digest('hex');

describe('01 - keys ARE content addresses: extension-less, algorithm-namespaced, digest-exact', function () {

    it('the key is blobs/<algo>/<aa>/<bb>/<hex> for the actual content digest', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), { originalName: 'invoice.pdf' }, function (err, res) {
            assert.ifError(err);
            assert.strictEqual(res.key, 'blobs/sha256/' + HEX.slice(0, 2) + '/' + HEX.slice(2, 4) + '/' + HEX,
                'the key must be derived from the content digest, nothing else');
            assert.strictEqual(res.size, PAYLOAD.length);
            assert.strictEqual(res.deduplicated, false);
            f.driver.close();
            done();
        });
    });

    it('identical bytes under DIFFERENT client filenames mint the SAME key (extensions would break dedup)', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), { originalName: 'a.pdf', contentType: 'application/pdf' }, function (e1, r1) {
            assert.ifError(e1);
            f.driver.put(src([PAYLOAD]), { originalName: 'b.png', contentType: 'image/png' }, function (e2, r2) {
                assert.ifError(e2);
                assert.strictEqual(r1.key, r2.key);
                assert.ok(r1.key.indexOf('.') < 0, 'cas keys carry no extension');
                // first-write-wins: the row keeps the FIRST put's identity fields
                f.driver.stat(r1.key, function (e3, meta) {
                    assert.ifError(e3);
                    assert.strictEqual(meta.originalName, 'a.pdf');
                    assert.strictEqual(meta.contentType, 'application/pdf');
                    assert.strictEqual(meta.refs, 2);
                    f.driver.close();
                    done();
                });
            });
        });
    });

    it('the hash config changes the namespace segment', function (t, done) {
        var f = freshCas({ hash: 'sha512' });
        var hex512 = crypto.createHash('sha512').update(PAYLOAD).digest('hex');
        f.driver.put(src([PAYLOAD]), function (err, res) {
            assert.ifError(err);
            assert.strictEqual(res.key, 'blobs/sha512/' + hex512.slice(0, 2) + '/' + hex512.slice(2, 4) + '/' + hex512);
            f.driver.close();
            done();
        });
    });
});

describe('02 - dedup: one blob, counted references', function () {

    it('a second identical put stores NO new bytes: one file, one row, refs 2, deduplicated flag', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.put(src([PAYLOAD]), function (e2, r2) {
                assert.ifError(e2);
                assert.strictEqual(r1.deduplicated, false);
                assert.strictEqual(r2.deduplicated, true);
                assert.strictEqual(r1.key, r2.key);
                var files = nonDbEntries(f.root);
                assert.strictEqual(files.length, 1, 'exactly one blob on disk — the dedup hit discarded its temp');
                var db = openDb(f.root);
                var n = db.prepare('SELECT COUNT(*) AS n FROM objects WHERE refs IS NOT NULL').get().n;
                db.close();
                assert.strictEqual(n, 1, 'exactly one refcounted row');
                f.driver.stat(r1.key, function (e3, meta) {
                    assert.ifError(e3);
                    assert.strictEqual(meta.refs, 2);
                    f.driver.close();
                    done();
                });
            });
        });
    });

    it('DIFFERENT bytes do not deduplicate', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.put(src([Buffer.from('other bytes')]), function (e2, r2) {
                assert.ifError(e2);
                assert.notStrictEqual(r1.key, r2.key);
                assert.strictEqual(r2.deduplicated, false);
                assert.strictEqual(nonDbEntries(f.root).length, 2);
                f.driver.close();
                done();
            });
        });
    });

    it('the blob round-trips byte-exact through get()', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD.slice(0, 7), PAYLOAD.slice(7)]), function (err, res) {
            assert.ifError(err);
            f.driver.get(res.key, function (gErr, stream) {
                assert.ifError(gErr);
                drain(stream, function (dErr, buf) {
                    assert.ifError(dErr);
                    assert.ok(buf.equals(PAYLOAD));
                    f.driver.close();
                    done();
                });
            });
        });
    });
});

describe('03 - concurrent identical puts: one blob, two refcounts (the arc\'s own test)', function () {

    it('two overlapping inline puts serialize at acquireRef — deterministic create-then-dedup', function (t, done) {
        var f  = freshCas({ inlineThreshold: 64 * 1024 });
        var s1 = new Readable({ read: function () {} });
        var s2 = new Readable({ read: function () {} });
        var results = [];
        var finish = function () {
            if ( results.length < 2 ) { return; }
            assert.strictEqual(results[0].key, results[1].key);
            assert.strictEqual(results[0].deduplicated, false, 'the first to finish creates');
            assert.strictEqual(results[1].deduplicated, true,  'the second takes a reference');
            f.driver.stat(results[0].key, function (err, meta) {
                assert.ifError(err);
                assert.strictEqual(meta.refs, 2);
                var db = openDb(f.root);
                var n = db.prepare('SELECT COUNT(*) AS n FROM objects WHERE refs IS NOT NULL').get().n;
                db.close();
                assert.strictEqual(n, 1, 'one blob row despite two in-flight writers');
                f.driver.close();
                done();
            });
        };
        // both puts attach BEFORE either stream delivers a byte — genuinely
        // overlapping writes, completion ordered by the end() calls below
        f.driver.put(s1, function (e1, r1) { assert.ifError(e1); results.push(r1); finish(); });
        f.driver.put(s2, function (e2, r2) { assert.ifError(e2); results.push(r2); finish(); });
        s1.push(PAYLOAD); s2.push(PAYLOAD);
        s1.push(null);    s2.push(null);
    });

    it('two overlapping FILE-tier puts: one blob file, refs 2, both callbacks get the same key', function (t, done) {
        var f  = freshCas(); // threshold 0 — both spill to temp files
        var s1 = new Readable({ read: function () {} });
        var s2 = new Readable({ read: function () {} });
        var results = [];
        var finish = function () {
            if ( results.length < 2 ) { return; }
            assert.strictEqual(results[0].key, results[1].key);
            // exactly ONE created, ONE deduplicated — completion order is a
            // stream-scheduling detail, the invariant is the pair
            var flags = [results[0].deduplicated, results[1].deduplicated].sort();
            assert.deepStrictEqual(flags, [false, true]);
            assert.strictEqual(nonDbEntries(f.root).length, 1, 'one blob file; the loser\'s temp was discarded');
            f.driver.stat(results[0].key, function (err, meta) {
                assert.ifError(err);
                assert.strictEqual(meta.refs, 2);
                f.driver.close();
                done();
            });
        };
        f.driver.put(s1, function (e1, r1) { assert.ifError(e1); results.push(r1); finish(); });
        f.driver.put(s2, function (e2, r2) { assert.ifError(e2); results.push(r2); finish(); });
        s1.push(PAYLOAD); s2.push(PAYLOAD);
        s1.push(null);    s2.push(null);
    });
});

describe('04 - size tiering under cas: sub-threshold blobs are rows, dedup included', function () {

    it('an under-threshold put touches the filesystem not at all — and still dedups', function (t, done) {
        var f = freshCas({ inlineThreshold: 64 * 1024 });
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            assert.strictEqual(nonDbEntries(f.root).length, 0, 'no file, no temp — one store transaction');
            assert.strictEqual(fs.existsSync(nodePath.join(f.root, '.tmp')), false, 'not even the temp dir');
            f.driver.put(src([PAYLOAD]), function (e2, r2) {
                assert.ifError(e2);
                assert.strictEqual(r2.deduplicated, true);
                assert.strictEqual(r1.key, r2.key);
                f.driver.resolve(r1.key, function (e3, r) {
                    assert.ifError(e3);
                    assert.strictEqual(r.kind, 'inline');
                    f.driver.get(r1.key, function (e4, stream) {
                        assert.ifError(e4);
                        drain(stream, function (e5, buf) {
                            assert.ifError(e5);
                            assert.ok(buf.equals(PAYLOAD));
                            f.driver.close();
                            done();
                        });
                    });
                });
            });
        });
    });

    it('at-threshold content crosses to the file tree, hashed across the spill byte-exactly', function (t, done) {
        var big = crypto.randomBytes(4096);
        var f = freshCas({ inlineThreshold: 1024 });
        var hex = crypto.createHash('sha256').update(big).digest('hex');
        // chunks straddle the threshold so the head-flush + pipe crossing is
        // exactly what gets hashed
        f.driver.put(src([big.slice(0, 700), big.slice(700, 1500), big.slice(1500)]), function (err, res) {
            assert.ifError(err);
            assert.strictEqual(res.key, 'blobs/sha256/' + hex.slice(0, 2) + '/' + hex.slice(2, 4) + '/' + hex,
                'the digest must cover head + piped bytes in arrival order');
            f.driver.resolve(res.key, function (e2, r) {
                assert.ifError(e2);
                assert.strictEqual(r.kind, 'path');
                assert.ok(fs.readFileSync(r.path).equals(big));
                f.driver.close();
                done();
            });
        });
    });

    it('binary payloads with NUL bytes round-trip exactly, both tiers', function (t, done) {
        var nasty = Buffer.concat([Buffer.from([0x00, 0x01, 0x00]), crypto.randomBytes(64), Buffer.from([0x00])]);
        var f = freshCas({ inlineThreshold: 4096 });
        f.driver.put(src([nasty]), function (e1, r1) {          // inline
            assert.ifError(e1);
            var f2 = freshCas();                                 // file tier
            f2.driver.put(src([nasty]), function (e2, r2) {
                assert.ifError(e2);
                assert.strictEqual(r1.key, r2.key, 'same bytes, same digest, whichever tier');
                f.driver.get(r1.key, function (e3, stream) {
                    assert.ifError(e3);
                    drain(stream, function (e4, buf) {
                        assert.ifError(e4);
                        assert.ok(buf.equals(nasty));
                        f.driver.close();
                        f2.driver.close();
                        done();
                    });
                });
            });
        });
    });
});

describe('05 - release() counts down; zero means GONE to every read verb', function () {

    it('release decrements; the blob survives while any reference remains', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            f.driver.put(src([PAYLOAD]), function (e2) {
                assert.ifError(e1); assert.ifError(e2);
                f.driver.release(r1.key, function (e3, existed) {
                    assert.ifError(e3);
                    assert.strictEqual(existed, true);
                    f.driver.stat(r1.key, function (e4, meta) {
                        assert.ifError(e4);
                        assert.ok(meta, 'one reference remains — still visible');
                        assert.strictEqual(meta.refs, 1);
                        assert.ok(fs.existsSync(nodePath.join(f.root, r1.key)), 'bytes untouched');
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });

    it('at zero the key answers like a missing one — stat null, get/resolve error, no wrong-reason message', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2, existed) {
                assert.ifError(e2);
                assert.strictEqual(existed, true);
                f.driver.stat(r1.key, function (e3, meta) {
                    assert.ifError(e3);
                    assert.strictEqual(meta, null, 'refs=0 reads as absent — the grace window is GC detail, not an afterlife');
                    f.driver.get(r1.key, function (e4) {
                        assert.ok(e4 instanceof Error);
                        assert.match(e4.message, /no object for key/);
                        f.driver.resolve(r1.key, function (e5) {
                            assert.ok(e5 instanceof Error);
                            assert.match(e5.message, /no object for key/);
                            f.driver.close();
                            done();
                        });
                    });
                });
            });
        });
    });

    it('releasing past zero answers existed=false — the sharded idempotency shape', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2, ex1) {
                assert.ifError(e2);
                assert.strictEqual(ex1, true);
                f.driver.release(r1.key, function (e3, ex2) {
                    assert.ifError(e3);
                    assert.strictEqual(ex2, false, 'the reference was already gone');
                    f.driver.close();
                    done();
                });
            });
        });
    });

    it('re-uploading just-released content is free: the row resurrects, the bytes were never gone', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2) {
                assert.ifError(e2);
                f.driver.put(src([PAYLOAD]), function (e3, r3) {
                    assert.ifError(e3);
                    assert.strictEqual(r3.key, r1.key);
                    assert.strictEqual(r3.deduplicated, true, 'no new bytes were stored');
                    f.driver.stat(r3.key, function (e4, meta) {
                        assert.ifError(e4);
                        assert.strictEqual(meta.refs, 1);
                        // the zero stamp must be CLEARED, or the sweep would
                        // collect a live blob once the old stamp aged out
                        var db = openDb(f.root);
                        var row = db.prepare('SELECT zero_at FROM objects WHERE key = ?').get(r3.key);
                        db.close();
                        assert.strictEqual(row.zero_at, null);
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });

    it('reserved, traversal, and non-canonical keys are refused with the right identity, in the right order', function (t, done) {
        var f = freshCas();
        f.driver.release('../../etc/passwd', function (e1) {
            assert.ok(e1 instanceof Error);
            assert.match(e1.message, /escapes the driver root/);
            assert.doesNotMatch(e1.message, /reserved/, 'confinement must answer traversal — reserved-first would shadow the boundary');
            assert.ok(e1.message.indexOf(f.root) < 0, 'the driver root must not leak into the error');
            f.driver.release('.meta.db', function (e2) {
                assert.ok(e2 instanceof Error);
                assert.match(e2.message, /reserved/);
                f.driver.release('a/../b', function (e3) {
                    assert.ok(e3 instanceof Error);
                    assert.match(e3.message, /not in canonical form/);
                    assert.ok(fs.existsSync(nodePath.join(f.root, '.meta.db')), 'the metadata database must survive');
                    f.driver.close();
                    done();
                });
            });
        });
    });
});

describe('06 - the GC sweep: grace-gated, claim-first, refcount-guarded', function () {

    it('a blob at zero past the grace window is collected — row AND file', function (t, done) {
        var f = freshCas({ sweepGrace: 60 * 1000 });
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2) {
                assert.ifError(e2);
                backdateZero(f.root, r1.key, 120 * 1000); // 2min ago > 1min grace
                f.driver._sweepOnce();
                var db = openDb(f.root);
                var row = db.prepare('SELECT key FROM objects WHERE key = ?').get(r1.key);
                db.close();
                assert.strictEqual(row, undefined, 'the row was claimed');
                assert.strictEqual(nonDbEntries(f.root).length, 0, 'the file followed');
                f.driver.close();
                done();
            });
        });
    });

    it('inside the grace window nothing is collected', function (t, done) {
        var f = freshCas({ sweepGrace: 60 * 60 * 1000 });
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2) {
                assert.ifError(e2);
                f.driver._sweepOnce(); // zeroAt is NOW — an hour of grace ahead
                var db = openDb(f.root);
                var row = db.prepare('SELECT refs FROM objects WHERE key = ?').get(r1.key);
                db.close();
                assert.ok(row, 'the row survives its grace window');
                assert.strictEqual(nonDbEntries(f.root).length, 1, 'so do the bytes');
                f.driver.close();
                done();
            });
        });
    });

    it('a referenced blob is never collected, however old', function (t, done) {
        var f = freshCas({ sweepGrace: 60 * 1000 });
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            // refs=1, zero_at NULL — the sweep's predicate cannot see it
            f.driver._sweepOnce();
            f.driver.stat(r1.key, function (e2, meta) {
                assert.ifError(e2);
                assert.ok(meta && meta.refs === 1);
                f.driver.close();
                done();
            });
        });
    });

    it('an inline zero-ref blob collects as a row deletion alone (no file to unlink)', function (t, done) {
        var f = freshCas({ inlineThreshold: 64 * 1024, sweepGrace: 60 * 1000 });
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2) {
                assert.ifError(e2);
                backdateZero(f.root, r1.key, 120 * 1000);
                f.driver._sweepOnce();
                var db = openDb(f.root);
                var row = db.prepare('SELECT key FROM objects WHERE key = ?').get(r1.key);
                db.close();
                assert.strictEqual(row, undefined);
                f.driver.close();
                done();
            });
        });
    });
});

describe('07 - sweep vs concurrent put: both orderings, no bytes lost (the grace race)', function () {

    it('ordering A — the put lands FIRST: resurrection wins, the sweep collects nothing', function (t, done) {
        var f = freshCas({ sweepGrace: 60 * 1000 });
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2) {
                assert.ifError(e2);
                backdateZero(f.root, r1.key, 120 * 1000); // sweep-eligible
                // the racing identical put completes BEFORE the tick fires
                f.driver.put(src([PAYLOAD]), function (e3, r3) {
                    assert.ifError(e3);
                    assert.strictEqual(r3.deduplicated, true);
                    f.driver._sweepOnce();
                    f.driver.get(r3.key, function (e4, stream) {
                        assert.ifError(e4, 'the resurrected blob must survive the sweep');
                        drain(stream, function (e5, buf) {
                            assert.ifError(e5);
                            assert.ok(buf.equals(PAYLOAD), 'and its bytes must be intact');
                            f.driver.close();
                            done();
                        });
                    });
                });
            });
        });
    });

    it('ordering B — the sweep claims FIRST: the put creates a fresh epoch and reinstalls the bytes', function (t, done) {
        var f = freshCas({ sweepGrace: 60 * 1000 });
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.release(r1.key, function (e2) {
                assert.ifError(e2);
                backdateZero(f.root, r1.key, 120 * 1000);
                f.driver._sweepOnce(); // row claimed, file unlinked
                assert.strictEqual(nonDbEntries(f.root).length, 0);
                f.driver.put(src([PAYLOAD]), function (e3, r3) {
                    assert.ifError(e3);
                    assert.strictEqual(r3.key, r1.key, 'content addressing: the same bytes get the same key back');
                    assert.strictEqual(r3.deduplicated, false, 'a fresh row epoch — the old one was collected');
                    f.driver.get(r3.key, function (e4, stream) {
                        assert.ifError(e4);
                        drain(stream, function (e5, buf) {
                            assert.ifError(e5);
                            assert.ok(buf.equals(PAYLOAD));
                            f.driver.close();
                            done();
                        });
                    });
                });
            });
        });
    });

    it('the heal path: a dedup hit whose blob file is missing reinstalls it from this put\'s temp', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            // the sweep's documented crash residue: row live, file gone
            fs.unlinkSync(nodePath.join(f.root, r1.key));
            f.driver.put(src([PAYLOAD]), function (e2, r2) {
                assert.ifError(e2);
                assert.strictEqual(r2.deduplicated, true, 'the row was there — this is a dedup hit');
                assert.ok(fs.existsSync(nodePath.join(f.root, r1.key)), 'healed: the bytes are back');
                f.driver.get(r1.key, function (e3, stream) {
                    assert.ifError(e3);
                    drain(stream, function (e4, buf) {
                        assert.ifError(e4);
                        assert.ok(buf.equals(PAYLOAD));
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });
});

describe('08 - failure semantics: real errors, no residue, no stranded references', function () {

    it('an interrupted stream reports the REAL error and leaves nothing — file tier', function (t, done) {
        var f = freshCas();
        f.driver.put(srcInterrupted([PAYLOAD.slice(0, 5)]), function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /interrupted/, 'the REAL error must surface');
            assert.strictEqual(nonDbEntries(f.root).length, 0, 'no temp, no partial blob');
            var db = openDb(f.root);
            var n = db.prepare('SELECT COUNT(*) AS n FROM objects WHERE refs IS NOT NULL').get().n;
            db.close();
            assert.strictEqual(n, 0, 'no reference was taken');
            f.driver.close();
            done();
        });
    });

    it('an interrupted stream leaves nothing — inline tier', function (t, done) {
        var f = freshCas({ inlineThreshold: 64 * 1024 });
        f.driver.put(srcInterrupted([PAYLOAD.slice(0, 5)]), function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /interrupted/);
            var db = openDb(f.root);
            var n = db.prepare('SELECT COUNT(*) AS n FROM objects WHERE refs IS NOT NULL').get().n;
            db.close();
            assert.strictEqual(n, 0);
            f.driver.close();
            done();
        });
    });

    it('maxObjectSize is enforced mid-stream with the real cap named', function (t, done) {
        var f = freshCas({ maxObjectSize: 64 });
        f.driver.put(src([crypto.randomBytes(100)]), function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /maxObjectSize/);
            assert.strictEqual(nonDbEntries(f.root).length, 0);
            f.driver.close();
            done();
        });
    });

    it('a publish failure rolls the reference back — the caller got no key, so nothing may remain', function (t, done) {
        var f = freshCas();
        // a real injection: a regular FILE where the blob tree wants a
        // directory makes mkdirSync fail with the real ENOTDIR/EEXIST
        fs.writeFileSync(nodePath.join(f.root, 'blobs'), 'in the way');
        f.driver.put(src([PAYLOAD]), function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /ENOTDIR|EEXIST/, 'the real filesystem error, never a fabricated one');
            var db = openDb(f.root);
            var n = db.prepare('SELECT COUNT(*) AS n FROM objects WHERE refs IS NOT NULL').get().n;
            db.close();
            assert.strictEqual(n, 0, 'the acquired reference was rolled back');
            var tmps = fs.existsSync(nodePath.join(f.root, '.tmp')) ? fs.readdirSync(nodePath.join(f.root, '.tmp')) : [];
            assert.strictEqual(tmps.length, 0, 'the temp was cleaned up');
            f.driver.close();
            done();
        });
    });

    it('a failed heal is not success theatre: the reference is undone and the error reported', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            // crash residue AND a blocked tree: the file is gone and the
            // shard dir replaced by a regular file, so the heal rename fails
            fs.unlinkSync(nodePath.join(f.root, r1.key));
            var shardDir = nodePath.dirname(nodePath.join(f.root, r1.key));
            fs.rmSync(shardDir, { recursive: true, force: true });
            fs.writeFileSync(shardDir, 'in the way');
            f.driver.put(src([PAYLOAD]), function (e2) {
                assert.ok(e2 instanceof Error, 'a key whose bytes could not be installed must not be handed out');
                f.driver.stat(r1.key, function (e3, meta) {
                    assert.ifError(e3);
                    // refs must be back where they were (1), not stranded at 2
                    assert.strictEqual(meta.refs, 1, 'the failed put\'s reference was released');
                    f.driver.close();
                    done();
                });
            });
        });
    });
});

describe('09 - fsync: ordered before the publish, honest about the platform', function () {

    it('WIRING PIN: temp-fsync precedes rename, dir-fsync follows it, in the created path', function () {
        // fsync leaves no filesystem-visible artifact and the house bans
        // mocks — source order IS the assertable invariant. Needle-found
        // controls first, so a refactor that renames the helpers fails as a
        // broken instrument, not a silent pass.
        var body = CAS_SRC;
        var iFsync  = body.indexOf('if ( fsyncOn ) { fsyncFile(tmp); }');
        var iRename = body.indexOf('fs.renameSync(tmp, final);');
        var iDir    = body.indexOf('if ( fsyncOn ) { fsyncDirBestEffort(nodePath.dirname(final)); }');
        assert.ok(iFsync > -1,  'needle: the temp-file fsync call site must exist');
        assert.ok(iRename > -1, 'needle: the rename publish must exist');
        assert.ok(iDir > -1,    'needle: the directory fsync call site must exist');
        assert.ok(iFsync < iRename, 'the FILE is durable before the rename publishes it');
        assert.ok(iRename < iDir,   'the DIRECTORY entry is flushed after the rename creates it');
        // and the helpers keep their halves of the contract
        assert.match(body, /var fsyncFile = function/,          'hard half exists');
        assert.match(body, /var fsyncDirBestEffort = function/, 'best-effort half exists');
    });

    it('fsync:true publishes correctly on this platform (dir-fd fsync measured working here)', function (t, done) {
        var f = freshCas({ fsync: true });
        f.driver.put(src([PAYLOAD]), function (err, res) {
            assert.ifError(err);
            assert.ok(fs.existsSync(nodePath.join(f.root, res.key)));
            f.driver.close();
            done();
        });
    });

    it('fsync:false publishes identically — the flag gates durability, never correctness', function (t, done) {
        var f = freshCas({ fsync: false });
        f.driver.put(src([PAYLOAD]), function (err, res) {
            assert.ifError(err);
            assert.ok(fs.existsSync(nodePath.join(f.root, res.key)));
            f.driver.close();
            done();
        });
    });
});

describe('10 - findByDigest: the sanctioned digest-to-key door (and a dedup oracle to guard)', function () {

    it('hit: a client-computed digest finds the key without transferring bytes', function (t, done) {
        var f = freshCas();
        f.driver.put(src([PAYLOAD]), function (e1, r1) {
            assert.ifError(e1);
            f.driver.findByDigest('sha256', HEX, function (e2, key) {
                assert.ifError(e2);
                assert.strictEqual(key, r1.key);
                f.driver.close();
                done();
            });
        });
    });

    it('miss and released-to-zero both answer null — absence and afterlife look identical', function (t, done) {
        var f = freshCas();
        f.driver.findByDigest('sha256', crypto.createHash('sha256').update('never stored').digest('hex'), function (e1, k1) {
            assert.ifError(e1);
            assert.strictEqual(k1, null);
            f.driver.put(src([PAYLOAD]), function (e2, r2) {
                assert.ifError(e2);
                f.driver.release(r2.key, function (e3) {
                    assert.ifError(e3);
                    f.driver.findByDigest('sha256', HEX, function (e4, k4) {
                        assert.ifError(e4);
                        assert.strictEqual(k4, null, 'a zero-ref blob is not findable');
                        f.driver.close();
                        done();
                    });
                });
            });
        });
    });

    it('the algorithm argument selects the NAMESPACE — a former hash\'s blobs stay findable under it', function (t, done) {
        var f = freshCas({ hash: 'sha512' });
        var hex512 = crypto.createHash('sha512').update(PAYLOAD).digest('hex');
        f.driver.put(src([PAYLOAD]), function (e1) {
            assert.ifError(e1);
            // this driver now writes sha512 — but a sha256 query is a valid
            // (empty) namespace, not an error
            f.driver.findByDigest('sha256', HEX, function (e2, k2) {
                assert.ifError(e2);
                assert.strictEqual(k2, null);
                f.driver.findByDigest('sha512', hex512, function (e3, k3) {
                    assert.ifError(e3);
                    assert.ok(k3);
                    f.driver.close();
                    done();
                });
            });
        });
    });

    it('malformed input is an ERROR, never a silent null', function (t, done) {
        var f = freshCas();
        f.driver.findByDigest('sha256', 'not-hex-at-all!', function (e1) {
            assert.ok(e1 instanceof Error);
            assert.match(e1.message, /hex-encoded digest/);
            f.driver.findByDigest(42, HEX, function (e2) {
                assert.ok(e2 instanceof Error);
                assert.match(e2.message, /digest algorithm name/);
                f.driver.close();
                done();
            });
        });
    });

    it('capabilities tell the truth: cas dedups, sharded does not', function () {
        var f = freshCas();
        assert.strictEqual(f.driver.capabilities.dedup, true);
        assert.strictEqual(typeof f.driver.findByDigest, 'function');
        f.driver.close();
        var root2  = mkRoot();
        var store2 = createEmbeddedMetaStore(nodePath.join(root2, '.meta.db'));
        var sharded = createLocalDriver('shardT', { root: root2, strategy: 'sharded', maxObjectSize: 1024 }, store2);
        assert.strictEqual(sharded.capabilities.dedup, false, 'control: the flag discriminates');
        assert.strictEqual(typeof sharded.findByDigest, 'undefined', 'the verb is cas-only');
        sharded.close();
    });
});

describe('11 - the store contract: capability gate and migration', function () {

    it('a cas driver refuses to build over a store lacking the refcount verbs', function () {
        var failing = {
            set    : function (k, m, fn) { fn(null, m); },
            get    : function (k, fn) { fn(null, null); },
            remove : function (k, fn) { fn(null, false); },
            close  : function () {}
        };
        assert.throws(function () {
            createLocalCasDriver('casT', { root: mkRoot(), strategy: 'cas', maxObjectSize: 1024, hash: 'sha256', fsync: false, sweepInterval: 0, sweepGrace: 1000 }, failing);
        }, function (err) {
            assert.match(err.message, /lacks `acquireRef\(\)`/);
            assert.match(err.message, /refcount verbs/);
            return true;
        });
    });

    it('a pre-cas database gains refs/zero_at in place, idempotently', function () {
        var root   = mkRoot();
        var dbPath = nodePath.join(root, '.meta.db');
        // a genuine pre-cas (post-tiering) schema, built raw
        var DatabaseSync = sqliteDriver.getDatabaseSync();
        var db = new DatabaseSync(dbPath);
        db.exec('CREATE TABLE objects (key TEXT PRIMARY KEY, original_name TEXT, content_type TEXT, size INTEGER, created_at INTEGER NOT NULL, data BLOB)');
        db.prepare('INSERT INTO objects (key, original_name, content_type, size, created_at, data) VALUES (?, ?, ?, ?, ?, ?)')
          .run('2026/08/13/LEGACY.pdf', 'legacy.pdf', null, 4, Date.now(), null);
        db.close();

        var store = createEmbeddedMetaStore(dbPath); // migrates
        store.close();
        var store2 = createEmbeddedMetaStore(dbPath); // idempotent second open
        store2.get('2026/08/13/LEGACY.pdf', function (err, m) {
            assert.ifError(err);
            assert.ok(m, 'the legacy row survived both migrations');
            assert.strictEqual(typeof m.refs, 'undefined', 'a non-refcounted row keeps its exact shape — no refs key appears');
        });
        store2.close();
        var db2 = new DatabaseSync(dbPath);
        var cols = db2.prepare('PRAGMA table_info(objects)').all().map(function (c) { return c.name; });
        db2.close();
        assert.ok(cols.indexOf('refs') > -1 && cols.indexOf('zero_at') > -1);
    });

    it('acquireRef/releaseRef round-trip through the seam with the contracted shapes', function (t, done) {
        var store = createEmbeddedMetaStore(nodePath.join(mkRoot(), '.meta.db'));
        store.acquireRef('blobs/sha256/aa/bb/feed', { originalName: 'x', size: 4, createdAt: 1 }, function (e1, r1) {
            assert.ifError(e1);
            assert.deepStrictEqual({ created: r1.created, refs: r1.refs }, { created: true, refs: 1 });
            store.acquireRef('blobs/sha256/aa/bb/feed', { originalName: 'IGNORED' }, function (e2, r2) {
                assert.ifError(e2);
                assert.strictEqual(r2.created, false);
                assert.strictEqual(r2.refs, 2);
                assert.strictEqual(r2.meta.originalName, 'x', 'first-write-wins — the stored identity is returned');
                store.releaseRef('blobs/sha256/aa/bb/feed', function (e3, r3) {
                    assert.ifError(e3);
                    assert.deepStrictEqual(r3, { existed: true, refs: 1 });
                    store.releaseRef('missing-key', function (e4, r4) {
                        assert.ifError(e4);
                        assert.strictEqual(r4.existed, false);
                        store.close();
                        done();
                    });
                });
            });
        });
    });
});

describe('12 - validateConfig knows cas', function () {

    /**
     * A minimally-valid cas driver block, overridable per case.
     *
     * @inner
     * @param {object} [over]
     * @returns {object}
     */
    function casOk(over) {
        var d = { adapter: 'local', strategy: 'cas', root: '/var/data/cas-t' };
        Object.keys(over || {}).forEach(function (k) { d[k] = over[k]; });
        return d;
    }

    it('a plain cas driver block is valid — cas is implemented now', function () {
        var v = storage.validateConfig({ drivers: { a: casOk() } });
        assert.strictEqual(v.fatal, null);
        assert.deepStrictEqual(v.warnings, []);
    });

    it('an unusable hash is FATAL and names the runtime scope', function () {
        var v = storage.validateConfig({ drivers: { a: casOk({ hash: 'not-a-digest' }) } });
        assert.match(v.fatal, /this runtime's crypto does not provide/);
        assert.match(v.fatal, /sha256/);
        var v2 = storage.validateConfig({ drivers: { a: casOk({ hash: '' }) } });
        assert.match(v2.fatal, /must be a digest algorithm name/);
        // control: a real algorithm passes
        var v3 = storage.validateConfig({ drivers: { a: casOk({ hash: 'sha512' }) } });
        assert.strictEqual(v3.fatal, null);
    });

    it('fsync / sweepInterval / sweepGrace lint like their sibling keys', function () {
        var v = storage.validateConfig({ drivers: { a: casOk({ fsync: 'yes' }) } });
        assert.strictEqual(v.fatal, null);
        assert.match(v.warnings[0], /`fsync` must be a boolean/);

        var v2 = storage.validateConfig({ drivers: { a: casOk({ sweepInterval: '15' }) } });
        assert.match(v2.warnings[0], /`sweepInterval` must carry a unit/);
        var v3 = storage.validateConfig({ drivers: { a: casOk({ sweepInterval: '0s' }) } });
        assert.deepStrictEqual(v3.warnings, [], '"0s" is the documented off switch — silent');

        var v4 = storage.validateConfig({ drivers: { a: casOk({ sweepGrace: '0s' }) } });
        assert.match(v4.warnings[0], /`sweepGrace` must be greater than zero/);
        var v5 = storage.validateConfig({ drivers: { a: casOk({ sweepGrace: 'soon' }) } });
        assert.match(v5.warnings[0], /`sweepGrace` must carry a unit/);
    });

    it('the ignored-keys warning is PER-STRATEGY: cas keys warn under sharded, not under cas', function () {
        // fsync on a SHARDED driver: ignored, named
        var v = storage.validateConfig({ drivers: { a: { adapter: 'local', strategy: 'sharded', root: '/var/data/x', fsync: true } } });
        assert.strictEqual(v.fatal, null);
        assert.strictEqual(v.warnings.length, 1);
        assert.match(v.warnings[0], /fsync/);
        assert.match(v.warnings[0], /`sharded` strategy/);
        // the same key on a CAS driver: consumed, silent
        var v2 = storage.validateConfig({ drivers: { a: casOk({ fsync: true }) } });
        assert.deepStrictEqual(v2.warnings, []);
        // control: a genuinely bogus key still warns under cas
        var v3 = storage.validateConfig({ drivers: { a: casOk({ bogusKey: 1 }) } });
        assert.strictEqual(v3.warnings.length, 1);
        assert.match(v3.warnings[0], /bogusKey/);
        assert.match(v3.warnings[0], /`cas` strategy/);
    });

    it('parseDuration: unit-required, ms through days', function () {
        assert.strictEqual(storage._parseDuration('500ms'), 500);
        assert.strictEqual(storage._parseDuration('30s'), 30000);
        assert.strictEqual(storage._parseDuration('15m'), 900000);
        assert.strictEqual(storage._parseDuration('1h'), 3600000);
        assert.strictEqual(storage._parseDuration('7d'), 604800000);
        assert.strictEqual(storage._parseDuration('0s'), 0);
        assert.ok(isNaN(storage._parseDuration('15')), 'a bare number is refused, never assumed');
        assert.ok(isNaN(storage._parseDuration(15)));
    });
});

describe('13 - the strategy stamp (§4): flips warn, hash changes note once', function () {

    /**
     * Read the `.driver` stamp straight off the database.
     *
     * @inner
     * @param {string} root
     * @returns {?object} Parsed stamp, or null.
     */
    function readStamp(root) {
        var db = openDb(root);
        var row = db.prepare('SELECT data FROM objects WHERE key = ?').get('.driver');
        db.close();
        if ( !row || row.data == null ) { return null; }
        return JSON.parse(Buffer.from(row.data).toString('utf8'));
    }

    it('a fresh root is stamped silently with {strategy, hash}', function () {
        storage.reset();
        var root  = mkRoot();
        var warns = [];
        assert.strictEqual(storage.start({
            drivers : { d: { adapter: 'local', strategy: 'cas', root: root } },
            warn    : function (m) { warns.push(m); }
        }), true);
        assert.deepStrictEqual(warns, [], 'a fresh (or pre-cas) root must not cry wolf');
        assert.deepStrictEqual(readStamp(root), { strategy: 'cas', hash: 'sha256' });
        storage.reset();
    });

    it('a strategy flip warns EVERY boot and never restamps', function () {
        storage.reset();
        var root = mkRoot();
        // boot 1: sharded stamps the root
        storage.start({ drivers: { d: { adapter: 'local', strategy: 'sharded', root: root } } });
        storage.reset();
        // boot 2: the config flips to cas
        var warns = [];
        storage.start({
            drivers : { d: { adapter: 'local', strategy: 'cas', root: root } },
            warn    : function (m) { warns.push(m); }
        });
        assert.strictEqual(warns.length, 1);
        assert.match(warns[0], /does not match this root's stamp \(`sharded`\)/);
        assert.match(warns[0], /re-key migration/);
        assert.strictEqual(readStamp(root).strategy, 'sharded', 'the stamp stands — the hazard stays visible');
        storage.reset();
        // boot 3: still mismatched, still warned
        var warns2 = [];
        storage.start({
            drivers : { d: { adapter: 'local', strategy: 'cas', root: root } },
            warn    : function (m) { warns2.push(m); }
        });
        assert.strictEqual(warns2.length, 1, 'the warning repeats each boot while the mismatch stands');
        storage.reset();
    });

    it('a hash change warns ONCE, restamps, and goes quiet', function () {
        storage.reset();
        var root = mkRoot();
        storage.start({ drivers: { d: { adapter: 'local', strategy: 'cas', root: root } } }); // sha256 stamped
        storage.reset();
        var warns = [];
        storage.start({
            drivers : { d: { adapter: 'local', strategy: 'cas', root: root, hash: 'sha512' } },
            warn    : function (m) { warns.push(m); }
        });
        assert.strictEqual(warns.length, 1);
        assert.match(warns[0], /digest algorithm changed/);
        assert.match(warns[0], /additive/);
        assert.deepStrictEqual(readStamp(root), { strategy: 'cas', hash: 'sha512' }, 'restamped');
        storage.reset();
        var warns2 = [];
        storage.start({
            drivers : { d: { adapter: 'local', strategy: 'cas', root: root, hash: 'sha512' } },
            warn    : function (m) { warns2.push(m); }
        });
        assert.deepStrictEqual(warns2, [], 'the notice does not repeat');
        storage.reset();
    });
});

describe('14 - the startup temp-orphan sweep is age-gated', function () {

    it('an aged temp is reclaimed at build; a fresh one (a sibling\'s in-flight write) is not', function () {
        var root = mkRoot();
        var tmpD = nodePath.join(root, '.tmp');
        fs.mkdirSync(tmpD, { recursive: true });
        var oldTmp   = nodePath.join(tmpD, 'OLD.tmp');
        var freshTmp = nodePath.join(tmpD, 'FRESH.tmp');
        fs.writeFileSync(oldTmp, 'crashed put residue');
        fs.writeFileSync(freshTmp, 'in-flight');
        var past = new Date(Date.now() - (2 * 60 * 60 * 1000)); // 2h > 1h grace
        fs.utimesSync(oldTmp, past, past);

        var f = freshCas({ root: root });
        assert.strictEqual(fs.existsSync(oldTmp), false, 'the aged orphan is gone');
        assert.strictEqual(fs.existsSync(freshTmp), true, 'the fresh temp is untouchable — it may be someone\'s live write');
        f.driver.close();
    });
});
