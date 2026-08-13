/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * #STO1 — size tiering for the `local` adapter / `sharded` strategy: objects
 * strictly under a driver's `inlineThreshold` live as a BLOB row in the
 * metadata store; at or above it they take the temp+rename file path.
 *
 * Driven BEHAVIOURALLY, like the sibling `storage-local` suite: everything
 * asserted here is a runtime value — where bytes landed, what a stream
 * yielded, a row count, a warning string. The row counts are measured by
 * opening the driver's own `.meta.db` directly, because the seam deliberately
 * has no list verb and an absence claim needs a positive instrument.
 */

var { describe, it, before, after } = require('node:test');
var assert   = require('node:assert');
var crypto   = require('node:crypto');
var fs       = require('node:fs');
var os       = require('node:os');
var nodePath = require('node:path');
var Readable = require('node:stream').Readable;

var ROOT    = nodePath.join(__dirname, '..', '..');
var VERSION = require(nodePath.join(ROOT, 'package.json')).version;
var FW      = nodePath.join(ROOT, 'framework', 'v' + VERSION);

var storage                 = require(nodePath.join(FW, 'lib', 'storage', 'src', 'main.js'));
var createLocalDriver       = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local.js'));
var createEmbeddedMetaStore = require(nodePath.join(FW, 'lib', 'storage', 'src', 'meta-store.js'));
var sqliteDriver            = require(nodePath.join(FW, 'lib', 'sqlite-driver'));

/** The sharded key shape — tiering must NOT change it (keys are opaque and uniform across tiers). */
var KEY_RE = /^\d{4}\/\d{2}\/\d{2}\/[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}(\.[a-z0-9]{1,10})?$/;

var roots = [];

/**
 * Build a tiering driver over a fresh temp root.
 *
 * @inner
 * @param {number} threshold - `inlineThreshold` in bytes (0 = tiering off).
 * @param {number} [max]     - Per-object byte ceiling.
 * @returns {object} `{driver, root, store}`.
 */
function freshTier(threshold, max) {
    var root  = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
    roots.push(root);
    var store  = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
    var driver = createLocalDriver('t', {
        root            : root,
        strategy        : 'sharded',
        maxObjectSize   : (typeof max === 'number') ? max : 1024 * 1024,
        inlineThreshold : threshold
    }, store);
    return { driver: driver, root: root, store: store };
}

/**
 * A readable stream over a buffer.
 *
 * @inner
 * @param {Buffer|string} buf - Payload.
 * @returns {object} A readable stream.
 */
function src(buf) {
    var r = new Readable();
    r.push(buf);
    r.push(null);
    return r;
}

/**
 * A readable stream emitting each chunk separately.
 *
 * @inner
 * @param {Buffer[]} chunks - Payload chunks.
 * @returns {object} A readable stream.
 */
function srcChunks(chunks) {
    var r = new Readable();
    chunks.forEach(function (c) { r.push(c); });
    r.push(null);
    return r;
}

/**
 * A readable stream that fails after its first chunk.
 *
 * @inner
 * @param {Buffer[]} chunks - Chunks emitted before the failure.
 * @returns {object} A readable stream that raises `interrupted`.
 */
function srcInterrupted(chunks) {
    // the no-op read keeps the stream legitimately PENDING once the pushed
    // chunks drain — a bare `new Readable()` would raise its own
    // `_read() not implemented` error first and mask the injected one
    var r = new Readable({ read: function () {} });
    chunks.forEach(function (c) { r.push(c); });
    setImmediate(function () { r.destroy(new Error('interrupted')); });
    return r;
}

/**
 * Drain a stream and hand back its concatenated bytes.
 *
 * @inner
 * @param {object}   stream - Readable stream.
 * @param {function} fn     - `fn(err, buffer)`.
 * @returns {void}
 */
function drain(stream, fn) {
    var chunks = [];
    stream.on('error', fn);
    stream.on('data', function (c) { chunks.push(c); });
    stream.on('end', function () { fn(null, Buffer.concat(chunks)); });
}

/**
 * Count metadata rows by opening the driver's own database directly — the
 * positive instrument behind every "no row was written" claim (the seam has
 * no list verb, and an absence asserted through it would be unmeasurable).
 *
 * @inner
 * @param {string} root - Driver root holding `.meta.db`.
 * @returns {number} Row count.
 */
function rowCount(root) {
    var DatabaseSync = sqliteDriver.getDatabaseSync();
    var db = new DatabaseSync(nodePath.join(root, '.meta.db'));
    var n = db.prepare('SELECT COUNT(*) AS n FROM objects').get().n;
    db.close();
    return n;
}

/**
 * Non-database entries at the driver root — date dirs, stray files, `.tmp`.
 *
 * @inner
 * @param {string} root - Driver root.
 * @returns {string[]} Entry names, `.meta.db*` excluded.
 */
function nonDbEntries(root) {
    return fs.readdirSync(root).filter(function (e) { return e.indexOf('.meta.db') !== 0; });
}

after(function () {
    roots.forEach(function (d) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    });
});

describe('01 - boundary: strictly-under inlines, at-threshold goes to the file tree', function () {

    var f, under, at;

    before(function (t, done) {
        f = freshTier(1024);
        f.driver.put(src(crypto.randomBytes(1023)), { originalName: 'under.bin' }, function (e1, r1) {
            assert.ifError(e1);
            under = r1;
            f.driver.put(src(crypto.randomBytes(1024)), { originalName: 'at.bin' }, function (e2, r2) {
                assert.ifError(e2);
                at = r2;
                done();
            });
        });
    });

    it('keeps the sharded key shape on both sides of the boundary', function () {
        assert.match(under.key, KEY_RE);
        assert.match(at.key, KEY_RE);
        assert.equal(under.size, 1023);
        assert.equal(at.size, 1024);
    });

    it('resolves one under-threshold byte as inline', function (t, done) {
        f.driver.resolve(under.key, function (err, r) {
            assert.ifError(err);
            assert.deepEqual(r, { kind: 'inline' });
            done();
        });
    });

    it('resolves the exactly-at-threshold object as a published file', function (t, done) {
        f.driver.resolve(at.key, function (err, r) {
            assert.ifError(err);
            assert.equal(r.kind, 'path');
            assert.ok(fs.existsSync(r.path), 'the at-threshold object must be a real file');
            done();
        });
    });

    it('never published the inline object as a file', function (t, done) {
        f.driver.resolve(at.key, function (err, r) {
            assert.ifError(err);
            var dayDir = nodePath.dirname(r.path);
            // exactly ONE published file in the shared day directory: the
            // at-threshold one. The inline sibling left no file behind.
            assert.equal(fs.readdirSync(dayDir).length, 1);
            done();
        });
    });
});

describe('02 - byte fidelity: inline round-trip and the spill crossing', function () {

    it('round-trips a binary inline payload exactly, NUL bytes included', function (t, done) {
        var f = freshTier(4096);
        var payload = Buffer.concat([Buffer.from([0, 1, 2, 0, 255, 0]), crypto.randomBytes(500)]);
        f.driver.put(src(payload), { originalName: 'x.bin' }, function (err, res) {
            assert.ifError(err);
            f.driver.get(res.key, function (gErr, stream) {
                assert.ifError(gErr);
                drain(stream, function (dErr, got) {
                    assert.ifError(dErr);
                    assert.ok(got.equals(payload), 'inline bytes must round-trip exactly');
                    done();
                });
            });
        });
    });

    it('round-trips a multi-chunk inline payload exactly', function (t, done) {
        var f = freshTier(1024);
        var a = crypto.randomBytes(300), b = crypto.randomBytes(300);
        f.driver.put(srcChunks([a, b]), {}, function (err, res) {
            assert.ifError(err);
            assert.equal(res.size, 600);
            f.driver.get(res.key, function (gErr, stream) {
                assert.ifError(gErr);
                drain(stream, function (dErr, got) {
                    assert.ifError(dErr);
                    assert.ok(got.equals(Buffer.concat([a, b])));
                    done();
                });
            });
        });
    });

    it('publishes a byte-identical file when the payload crosses the threshold mid-stream', function (t, done) {
        var f = freshTier(1024);
        var chunks = [crypto.randomBytes(400), crypto.randomBytes(400), crypto.randomBytes(400)];
        var whole  = Buffer.concat(chunks);
        f.driver.put(srcChunks(chunks), { originalName: 'straddle.bin' }, function (err, res) {
            assert.ifError(err);
            assert.equal(res.size, 1200);
            f.driver.resolve(res.key, function (rErr, r) {
                assert.ifError(rErr);
                assert.equal(r.kind, 'path', 'a crossing payload must land in the file tree');
                assert.ok(fs.readFileSync(r.path).equals(whole), 'the head flush + pipe crossing must be byte-order-exact');
                done();
            });
        });
    });
});

describe('03 - an inline put touches the filesystem not at all', function () {

    it('leaves the driver root holding only the metadata database', function (t, done) {
        var f = freshTier(64 * 1024);
        f.driver.put(src(crypto.randomBytes(2048)), { originalName: 'small.pdf' }, function (err, res) {
            assert.ifError(err);
            assert.match(res.key, KEY_RE);
            // no YYYY date dir, no .tmp — the directories are only ever
            // created on a spill.
            assert.deepEqual(nonDbEntries(f.root), []);
            done();
        });
    });
});

describe('04 - interrupted puts leave nothing behind, in either tier', function () {

    it('a source failure while buffering leaves no row, no file, no directory', function (t, done) {
        var f = freshTier(64 * 1024);
        f.driver.put(srcInterrupted([Buffer.from('partial')]), {}, function (err) {
            assert.ok(err, 'the put must fail');
            assert.match(err.message, /interrupted/, 'the REAL error must surface');
            assert.equal(rowCount(f.root), 0, 'no metadata row may exist');
            assert.deepEqual(nonDbEntries(f.root), [], 'no filesystem artifact may exist');
            done();
        });
    });

    it('a source failure after the spill unlinks the temp and publishes nothing', function (t, done) {
        var f = freshTier(512);
        f.driver.put(srcInterrupted([crypto.randomBytes(400), crypto.randomBytes(400)]), {}, function (err) {
            assert.ok(err, 'the put must fail');
            assert.match(err.message, /interrupted/, 'the REAL error must surface');
            assert.equal(rowCount(f.root), 0, 'no metadata row may exist');
            var tmpD = nodePath.join(f.root, '.tmp');
            if ( fs.existsSync(tmpD) ) {
                assert.deepEqual(fs.readdirSync(tmpD), [], 'no temp file may survive');
            }
            fs.readdirSync(f.root).forEach(function (e) {
                if ( /^\d{4}$/.test(e) ) {
                    // a date tree may exist (mkdir ran at spill) but must be
                    // empty of published files
                    var day = e;
                    var walk = function (dir) {
                        fs.readdirSync(dir).forEach(function (x) {
                            var p = nodePath.join(dir, x);
                            if ( fs.statSync(p).isDirectory() ) { return walk(p); }
                            assert.fail('published file survived a failed put: ' + p);
                        });
                    };
                    walk(nodePath.join(f.root, day));
                }
            });
            done();
        });
    });
});

describe('05 - maxObjectSize is enforced during the buffer phase', function () {

    it('refuses an over-cap payload before it ever reaches a tier', function (t, done) {
        var f = freshTier(64 * 1024, 1024);
        f.driver.put(src(crypto.randomBytes(2048)), {}, function (err) {
            assert.ok(err, 'the put must fail');
            assert.match(err.message, /maxObjectSize/);
            assert.equal(rowCount(f.root), 0, 'no metadata row may exist');
            assert.deepEqual(nonDbEntries(f.root), [], 'no filesystem artifact may exist');
            done();
        });
    });
});

describe('06 - threshold changes affect only new writes', function () {

    var root, store, fileKey, inlineKey, filePayload, inlinePayload;

    before(function (t, done) {
        root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        store = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
        filePayload   = crypto.randomBytes(700);
        inlinePayload = crypto.randomBytes(700);

        // yesterday's config: tiering off — the object lands as a file
        var offDriver = createLocalDriver('t', { root: root, strategy: 'sharded', maxObjectSize: 1024 * 1024, inlineThreshold: 0 }, store);
        offDriver.put(src(filePayload), { originalName: 'old.bin' }, function (e1, r1) {
            assert.ifError(e1);
            fileKey = r1.key;
            // today's config: tiering on — the same-size object lands inline
            var onDriver = createLocalDriver('t', { root: root, strategy: 'sharded', maxObjectSize: 1024 * 1024, inlineThreshold: 1024 }, store);
            onDriver.put(src(inlinePayload), { originalName: 'new.bin' }, function (e2, r2) {
                assert.ifError(e2);
                inlineKey = r2.key;
                done();
            });
        });
    });

    it('serves a pre-tiering file-backed object through a tiering driver', function (t, done) {
        var onDriver = createLocalDriver('t', { root: root, strategy: 'sharded', maxObjectSize: 1024 * 1024, inlineThreshold: 1024 }, store);
        onDriver.get(fileKey, function (err, stream) {
            assert.ifError(err);
            drain(stream, function (dErr, got) {
                assert.ifError(dErr);
                assert.ok(got.equals(filePayload));
                onDriver.resolve(fileKey, function (rErr, r) {
                    assert.ifError(rErr);
                    assert.equal(r.kind, 'path', 'a file-backed row (no payload) stays file-served');
                    done();
                });
            });
        });
    });

    it('serves an inline object even after tiering is turned back off', function (t, done) {
        var offDriver = createLocalDriver('t', { root: root, strategy: 'sharded', maxObjectSize: 1024 * 1024, inlineThreshold: 0 }, store);
        offDriver.get(inlineKey, function (err, stream) {
            assert.ifError(err);
            drain(stream, function (dErr, got) {
                assert.ifError(dErr);
                assert.ok(got.equals(inlinePayload));
                offDriver.resolve(inlineKey, function (rErr, r) {
                    assert.ifError(rErr);
                    assert.deepEqual(r, { kind: 'inline' }, 'reads are payload-presence-driven, not threshold-driven');
                    done();
                });
            });
        });
    });
});

describe('07 - capabilities tell the truth about tiering', function () {

    it('advertises inline only when a threshold is active', function () {
        assert.equal(freshTier(1024).driver.capabilities.inline, true);
        assert.equal(freshTier(0).driver.capabilities.inline, false);
    });

    it('a direct factory build with no threshold key has tiering off', function () {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        var store  = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
        var driver = createLocalDriver('t', { root: root, strategy: 'sharded', maxObjectSize: 1024 }, store);
        assert.equal(driver.capabilities.inline, false);
    });

    it('leaves the other capabilities untouched', function () {
        var caps = freshTier(1024).driver.capabilities;
        assert.deepEqual(caps, { offload: false, ranges: false, dedup: false, resumable: false, inline: true });
    });
});

describe('08 - stat strips the payload; release removes an inline object', function () {

    var f, res;

    before(function (t, done) {
        f = freshTier(4096);
        f.driver.put(src(crypto.randomBytes(100)), { originalName: 'a.pdf', contentType: 'application/pdf' }, function (err, r) {
            assert.ifError(err);
            res = r;
            done();
        });
    });

    it('stat answers the contracted shape with no data key', function (t, done) {
        f.driver.stat(res.key, function (err, meta) {
            assert.ifError(err);
            assert.deepEqual(Object.keys(meta).sort(), ['contentType', 'createdAt', 'originalName', 'size']);
            assert.equal(meta.size, 100);
            assert.equal(meta.originalName, 'a.pdf');
            done();
        });
    });

    it('release reports the inline object existed and removes its row', function (t, done) {
        f.driver.release(res.key, function (err, existed) {
            assert.ifError(err);
            assert.equal(existed, true);
            assert.equal(rowCount(f.root), 0);
            f.driver.get(res.key, function (gErr) {
                assert.ok(gErr, 'a released inline key must not serve');
                assert.match(gErr.message, /no object for key/);
                done();
            });
        });
    });
});

describe('09 - embedded store: payload column and the v1 migration', function () {

    it('round-trips a Buffer payload and omits data on file-backed rows', function (t, done) {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        var store = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
        var payload = Buffer.concat([Buffer.from([0, 255, 0]), crypto.randomBytes(64)]);
        store.set('k/inline', { originalName: 'a', size: payload.length, createdAt: 1, data: payload }, function (e1) {
            assert.ifError(e1);
            store.set('k/file', { originalName: 'b', size: 5, createdAt: 2 }, function (e2) {
                assert.ifError(e2);
                store.get('k/inline', function (e3, m1) {
                    assert.ifError(e3);
                    assert.ok(Buffer.isBuffer(m1.data), 'payload must come back as a Buffer');
                    assert.ok(m1.data.equals(payload), 'payload bytes must round-trip exactly');
                    store.get('k/file', function (e4, m2) {
                        assert.ifError(e4);
                        assert.ok(!('data' in m2), 'a file-backed row keeps its pre-tiering shape');
                        store.close();
                        done();
                    });
                });
            });
        });
    });

    it('refuses a non-binary payload to NULL rather than coercing it', function (t, done) {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        var store = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
        store.set('k', { size: 1, createdAt: 1, data: 'a string is not bytes' }, function (e1) {
            assert.ifError(e1);
            store.get('k', function (e2, m) {
                assert.ifError(e2);
                assert.ok(!('data' in m), 'a coerced string would corrupt binary payloads — refused to NULL');
                store.close();
                done();
            });
        });
    });

    it('migrates a pre-tiering database in place, idempotently', function (t, done) {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        var dbPath = nodePath.join(root, '.meta.db');

        // build a genuine v1 database: no data column, one legacy row
        var DatabaseSync = sqliteDriver.getDatabaseSync();
        var db = new DatabaseSync(dbPath);
        db.exec('CREATE TABLE objects (key TEXT PRIMARY KEY, original_name TEXT, content_type TEXT, size INTEGER, created_at INTEGER NOT NULL)');
        db.prepare('INSERT INTO objects (key, original_name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('legacy/key', 'old.pdf', 'application/pdf', 42, 1000);
        db.close();

        // opening the store migrates; a legacy row reads back shape-intact
        var store = createEmbeddedMetaStore(dbPath);
        store.get('legacy/key', function (e1, m) {
            assert.ifError(e1);
            assert.equal(m.size, 42);
            assert.ok(!('data' in m), 'a legacy row has no payload');
            store.set('new/key', { size: 3, createdAt: 2000, data: Buffer.from('abc') }, function (e2) {
                assert.ifError(e2);
                store.close();
                // idempotence: a second open must not attempt a second ALTER
                var again = createEmbeddedMetaStore(dbPath);
                again.get('new/key', function (e3, m2) {
                    assert.ifError(e3);
                    assert.ok(m2.data.equals(Buffer.from('abc')));
                    again.close();
                    done();
                });
            });
        });
    });
});

describe('10 - validateConfig knows the threshold key', function () {

    function block(driverExtra) {
        var d = { adapter: 'local', strategy: 'sharded', root: '/abs/store' };
        Object.keys(driverExtra || {}).forEach(function (k) { d[k] = driverExtra[k]; });
        return { default: 'a', drivers: { a: d } };
    }

    it('accepts a unit-suffixed threshold with no warning', function () {
        var v = storage.validateConfig(block({ inlineThreshold: '64KB' }));
        assert.equal(v.fatal, null);
        assert.deepEqual(v.warnings, []);
    });

    it('does not report the key as ignored — while a bogus key still is (control)', function () {
        var v = storage.validateConfig(block({ inlineThreshold: '64KB', bogusKey: 1 }));
        assert.equal(v.warnings.length, 1);
        assert.match(v.warnings[0], /bogusKey/);
        assert.ok(v.warnings[0].indexOf('inlineThreshold') === -1, 'the threshold key must not be named as ignored');
    });

    it('accepts the explicit off switch silently', function () {
        var v = storage.validateConfig(block({ inlineThreshold: '0B' }));
        assert.deepEqual(v.warnings, []);
    });

    it('warns on a unit-less value and names the default', function () {
        var v = storage.validateConfig(block({ inlineThreshold: '512' }));
        assert.equal(v.fatal, null);
        assert.equal(v.warnings.length, 1);
        assert.match(v.warnings[0], /inlineThreshold/);
        assert.match(v.warnings[0], new RegExp(String(storage._DEFAULT_INLINE_THRESHOLD)));
    });

    it('warns on a bare number', function () {
        var v = storage.validateConfig(block({ inlineThreshold: 512 }));
        assert.equal(v.warnings.length, 1);
        assert.match(v.warnings[0], /inlineThreshold/);
    });
});

describe('11 - start() resolves the default: on at 64KB, off at 0B', function () {

    after(function () {
        storage.reset();
    });

    it('a driver with no threshold key gets the measured default', function () {
        storage.reset();
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        assert.equal(storage._DEFAULT_INLINE_THRESHOLD, 64 * 1024);
        assert.equal(storage.start({ drivers: { a: { adapter: 'local', strategy: 'sharded', root: root } }, default: 'a' }), true);
        assert.equal(storage.get('a').capabilities.inline, true, 'tiering is ON by default');
    });

    it('an explicit 0B turns tiering off for that driver', function () {
        storage.reset();
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        storage.start({ drivers: { a: { adapter: 'local', strategy: 'sharded', root: root, inlineThreshold: '0B' } }, default: 'a' });
        assert.equal(storage.get('a').capabilities.inline, false);
    });

    it('an unparseable threshold falls back to the default', function () {
        storage.reset();
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tier-'));
        roots.push(root);
        storage.start({ drivers: { a: { adapter: 'local', strategy: 'sharded', root: root, inlineThreshold: 'garbage' } }, default: 'a' });
        assert.equal(storage.get('a').capabilities.inline, true);
    });
});

describe('12 - the empty object', function () {

    it('inlines zero bytes and round-trips them', function (t, done) {
        var f = freshTier(1024);
        var r = new Readable();
        r.push(null);
        f.driver.put(r, { originalName: 'empty.txt' }, function (err, res) {
            assert.ifError(err);
            assert.equal(res.size, 0);
            f.driver.resolve(res.key, function (rErr, rr) {
                assert.ifError(rErr);
                assert.deepEqual(rr, { kind: 'inline' }, 'an empty payload is a real (empty) inline object, not a missing one');
                f.driver.get(res.key, function (gErr, stream) {
                    assert.ifError(gErr);
                    drain(stream, function (dErr, got) {
                        assert.ifError(dErr);
                        assert.equal(got.length, 0);
                        done();
                    });
                });
            });
        });
    });
});
