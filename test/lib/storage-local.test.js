/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * #STO1 — the `local` adapter / `sharded` strategy contract, driven
 * BEHAVIOURALLY against a real temp filesystem and a real embedded SQLite
 * metadata store.
 *
 * Everything asserted here is a runtime VALUE — a key's shape, a byte count, a
 * rejection, the presence or absence of a file on disk — which is exactly the
 * class a source pin would ratify while being wrong (#B112). No mocks: the
 * write path's correctness is inseparable from real stream and rename
 * behaviour, and a stubbed filesystem could not exhibit the partial-write
 * failure the temp+rename discipline exists to prevent.
 */

var { describe, it, before, after } = require('node:test');
var assert   = require('node:assert');
var fs       = require('node:fs');
var os       = require('node:os');
var nodePath = require('node:path');
var Readable = require('node:stream').Readable;

var ROOT    = nodePath.join(__dirname, '..', '..');
var VERSION = require(nodePath.join(ROOT, 'package.json')).version;
var FW      = nodePath.join(ROOT, 'framework', 'v' + VERSION);

var createLocalDriver       = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local.js'));
var createEmbeddedMetaStore = require(nodePath.join(FW, 'lib', 'storage', 'src', 'meta-store.js'));

var roots = [];

/**
 * Build a driver over a fresh temp root.
 *
 * @inner
 * @param {number} [max] - Per-object byte ceiling.
 * @returns {object} `{driver, root}`.
 */
function freshDriver(max) {
    var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-local-'));
    roots.push(root);
    var store  = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
    var driver = createLocalDriver('t', {
        root          : root,
        strategy      : 'sharded',
        maxObjectSize : (typeof max === 'number') ? max : 1024 * 1024
    }, store);
    return { driver: driver, root: root };
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
 * Count files under a directory, ignoring the WAL/SHM siblings SQLite creates.
 *
 * @inner
 * @param {string} dir - Directory to count.
 * @returns {number} File count, or 0 when the directory does not exist.
 */
function countFiles(dir) {
    if ( !fs.existsSync(dir) ) { return 0; }
    return fs.readdirSync(dir).length;
}

after(function () {
    roots.forEach(function (d) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    });
});

describe('01 - put: the happy path', function () {

    var d, root, result;

    before(function (t, done) {
        var f = freshDriver();
        d = f.driver; root = f.root;
        d.put(src(Buffer.from('hello world')), { originalName: 'Invoice.PDF', contentType: 'application/pdf' }, function (err, res) {
            assert.ifError(err);
            result = res;
            done();
        });
    });

    it('returns a date-sharded key ending in a sanitised extension', function () {
        assert.match(result.key, /^\d{4}\/\d{2}\/\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.pdf$/);
    });

    it('reports the size measured from the published file, not from the client', function () {
        assert.equal(result.size, 11);
        assert.equal(fs.statSync(nodePath.join(root, result.key)).size, 11);
    });

    it('echoes the content type back untrusted', function () {
        assert.equal(result.contentType, 'application/pdf');
    });

    it('leaves no temp residue', function () {
        assert.equal(countFiles(nodePath.join(root, '.tmp')), 0);
    });

    it('never writes the client filename to disk', function () {
        // The original name survives only in metadata; the path is ULID-keyed.
        var onDisk = fs.readdirSync(nodePath.dirname(nodePath.join(root, result.key)));
        assert.equal(onDisk.length, 1);
        assert.doesNotMatch(onDisk[0], /invoice/i);
    });

    it('round-trips the bytes through get()', function (t, done) {
        d.get(result.key, function (err, stream) {
            assert.ifError(err);
            var chunks = [];
            stream.on('data', function (c) { chunks.push(c); });
            stream.on('end', function () {
                assert.equal(Buffer.concat(chunks).toString(), 'hello world');
                done();
            });
        });
    });

    it('stat() returns the metadata row, with the original name verbatim', function (t, done) {
        d.stat(result.key, function (err, meta) {
            assert.ifError(err);
            assert.equal(meta.originalName, 'Invoice.PDF');
            assert.equal(meta.contentType, 'application/pdf');
            assert.equal(meta.size, 11);
            assert.equal(typeof meta.createdAt, 'number');
            done();
        });
    });

    it('resolve() answers with a path kind', function (t, done) {
        d.resolve(result.key, function (err, r) {
            assert.ifError(err);
            assert.equal(r.kind, 'path');
            assert.equal(r.path, nodePath.join(root, result.key));
            done();
        });
    });
});

describe('02 - put: failure paths leave nothing behind', function () {

    it('a source error mid-stream publishes NOTHING and reports the real error', function (t, done) {
        var f = freshDriver();
        var stream = new Readable({ read: function () {} });
        stream.push(Buffer.from('partial'));

        f.driver.put(stream, { originalName: 'x.bin' }, function (err) {
            assert.ok(err, 'the failure must surface');
            assert.match(err.message, /boom/, 'the REAL error must propagate, never a fabricated one (#B223)');
            assert.equal(countFiles(nodePath.join(f.root, '.tmp')), 0, 'the temp file must be cleaned up');
            // Nothing may be visible under a date prefix: the rename is the
            // publish, so an interrupted write is invisible by construction.
            var dated = fs.readdirSync(f.root).filter(function (n) { return /^\d{4}$/.test(n); });
            var published = dated.reduce(function (n, y) {
                var acc = [];
                (function walk(p) {
                    fs.readdirSync(p, { withFileTypes: true }).forEach(function (e) {
                        if (e.isDirectory()) { walk(nodePath.join(p, e.name)); } else { acc.push(e.name); }
                    });
                })(nodePath.join(f.root, y));
                return n + acc.length;
            }, 0);
            assert.equal(published, 0, 'an interrupted write must leave no visible partial object');
            done();
        });

        setImmediate(function () { stream.destroy(new Error('boom')); });
    });

    it('an object over maxObjectSize is refused and cleaned up', function (t, done) {
        var f = freshDriver(10);
        f.driver.put(src(Buffer.alloc(5000)), {}, function (err) {
            assert.ok(err);
            assert.match(err.message, /maxObjectSize/);
            assert.equal(countFiles(nodePath.join(f.root, '.tmp')), 0);
            done();
        });
    });

    it('a non-stream argument is refused without throwing', function (t, done) {
        var f = freshDriver();
        f.driver.put({}, {}, function (err) {
            assert.match(err.message, /requires a readable stream/);
            done();
        });
    });

    it('put() without a callback throws immediately rather than losing the error', function () {
        var f = freshDriver();
        assert.throws(function () { f.driver.put(src('x')); }, /requires a callback/);
    });
});

describe('03 - key handling: confinement, canonical form, reserved names', function () {

    var d, root, key;

    before(function (t, done) {
        var f = freshDriver();
        d = f.driver; root = f.root;
        d.put(src('data'), { originalName: 'a.txt' }, function (err, res) {
            assert.ifError(err);
            key = res.key;
            done();
        });
    });

    it('rejects a traversal key on get() — and says TRAVERSAL, not "reserved"', function (t, done) {
        // The guard ORDER matters and was wrong once: `..` starts with a dot,
        // so a reserved-segment check placed before confinement answers every
        // traversal attempt with the wrong reason and leaves confineToBase
        // unexercised by the one input class it exists for.
        d.get('../../etc/passwd', function (err) {
            assert.ok(err);
            assert.match(err.message, /escapes the driver root/);
            assert.doesNotMatch(err.message, /reserved/);
            done();
        });
    });

    it('rejects traversal on every verb, not just get()', function (t, done) {
        var bad = '../../etc/passwd';
        d.stat(bad, function (e1) {
            assert.match(e1.message, /escapes the driver root/);
            d.release(bad, function (e2) {
                assert.match(e2.message, /escapes the driver root/);
                d.resolve(bad, function (e3) {
                    assert.match(e3.message, /escapes the driver root/);
                    done();
                });
            });
        });
    });

    it('never echoes the resolved filesystem path in a traversal error', function (t, done) {
        // Echoing it would confirm layout to whoever supplied the hostile key.
        d.get('../../etc/passwd', function (err) {
            assert.ok(err.message.indexOf(root) < 0, 'the driver root must not leak into the error');
            done();
        });
    });

    it('rejects a driver-internal path that never leaves the root', function (t, done) {
        d.release('.meta.db', function (err) {
            assert.match(err.message, /is reserved/);
            assert.ok(fs.existsSync(nodePath.join(root, '.meta.db')), 'the metadata database must survive');
            done();
        });
    });

    it('rejects a non-canonical key that would desynchronise path and metadata', function (t, done) {
        // `a/../b` stays inside the root, so confinement accepts it — but it
        // addresses the same file as `b` while indexing under a different key.
        d.stat('a/../b', function (err) {
            assert.match(err.message, /not in canonical form/);
            done();
        });
    });

    it('rejects an empty or non-string key', function (t, done) {
        d.stat('', function (e1) {
            assert.match(e1.message, /non-empty string key/);
            d.stat(null, function (e2) {
                assert.match(e2.message, /non-empty string key/);
                done();
            });
        });
    });

    it('accepts the key it minted', function (t, done) {
        d.stat(key, function (err, meta) {
            assert.ifError(err);
            assert.equal(meta.originalName, 'a.txt');
            done();
        });
    });
});

describe('04 - unknown keys: get errors, stat answers null', function () {

    it('stat() on an unknown key yields null, not an error', function (t, done) {
        var f = freshDriver();
        f.driver.stat('2026/01/01/0123456789ABCDEFGHJKMNPQRS', function (err, meta) {
            assert.ifError(err);
            assert.equal(meta, null);
            done();
        });
    });

    it('get() on an unknown key errors — a caller wanting bytes has no use for null', function (t, done) {
        var f = freshDriver();
        f.driver.get('2026/01/01/0123456789ABCDEFGHJKMNPQRS', function (err) {
            assert.match(err.message, /no object for key/);
            done();
        });
    });

    it('resolve() on an unknown key errors', function (t, done) {
        var f = freshDriver();
        f.driver.resolve('2026/01/01/0123456789ABCDEFGHJKMNPQRS', function (err) {
            assert.match(err.message, /no object for key/);
            done();
        });
    });
});

describe('05 - release', function () {

    it('removes the object AND its metadata row', function (t, done) {
        var f = freshDriver();
        f.driver.put(src('bye'), { originalName: 'x.txt' }, function (err, res) {
            assert.ifError(err);
            var onDisk = nodePath.join(f.root, res.key);
            assert.ok(fs.existsSync(onDisk));
            f.driver.release(res.key, function (e2, existed) {
                assert.ifError(e2);
                assert.equal(existed, true);
                assert.equal(fs.existsSync(onDisk), false);
                f.driver.stat(res.key, function (e3, meta) {
                    assert.ifError(e3);
                    assert.equal(meta, null, 'the metadata row must go with the bytes');
                    done();
                });
            });
        });
    });

    it('reports false for a key that was never stored', function (t, done) {
        var f = freshDriver();
        f.driver.release('2026/01/01/0123456789ABCDEFGHJKMNPQRS', function (err, existed) {
            assert.ifError(err);
            assert.equal(existed, false);
            done();
        });
    });

    it('is idempotent', function (t, done) {
        var f = freshDriver();
        f.driver.put(src('x'), {}, function (err, res) {
            assert.ifError(err);
            f.driver.release(res.key, function () {
                f.driver.release(res.key, function (e2, existed) {
                    assert.ifError(e2);
                    assert.equal(existed, false);
                    done();
                });
            });
        });
    });
});

describe('06 - extension handling end-to-end', function () {

    var cases = [
        ['invoice.pdf',      /\.pdf$/],
        ['IMG_0001.JPEG',    /\.jpeg$/],
        ['archive.tar.gz',   /\.gz$/],
        ['payload.php .jpg', /\.jpg$/],
        ['noext',            /[0-9A-HJKMNP-TV-Z]$/],
        ['.hidden',          /[0-9A-HJKMNP-TV-Z]$/],
        ['../../etc/passwd', /[0-9A-HJKMNP-TV-Z]$/]
    ];

    cases.forEach(function (c) {
        it('stores ' + JSON.stringify(c[0]) + ' under a safe key', function (t, done) {
            var f = freshDriver();
            f.driver.put(src('x'), { originalName: c[0] }, function (err, res) {
                assert.ifError(err);
                assert.match(res.key, c[1]);
                // Whatever the client sent, the key stays inside the layout.
                assert.match(res.key, /^\d{4}\/\d{2}\/\d{2}\/[0-9A-HJKMNP-TV-Z]{26}(\.[a-z0-9]{1,10})?$/);
                done();
            });
        });
    });
});

describe('07 - capabilities', function () {

    it('declares every deferred capability as false', function () {
        var f = freshDriver();
        assert.deepEqual(f.driver.capabilities, {
            offload   : false,
            ranges    : false,
            dedup     : false,
            resumable : false,
            inline    : false
        });
    });

    it('offload is false because no X-Accel/X-Sendfile handling exists in either engine', function () {
        var f = freshDriver();
        assert.equal(f.driver.capabilities.offload, false);
    });
});

describe('08 - metadata store failure rolls the object back', function () {

    it('does not leave bytes a caller can never reference', function (t, done) {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-metafail-'));
        roots.push(root);
        var failing = {
            set    : function (k, m, fn) { fn(new Error('meta store down')); },
            get    : function (k, fn) { fn(null, null); },
            remove : function (k, fn) { fn(null, false); },
            close  : function () {}
        };
        var d = createLocalDriver('t', { root: root, strategy: 'sharded', maxObjectSize: 1024 }, failing);
        d.put(src('orphan'), { originalName: 'x.txt' }, function (err) {
            assert.ok(err);
            assert.match(err.message, /meta store down/);
            var dated = fs.readdirSync(root).filter(function (n) { return /^\d{4}$/.test(n); });
            var found = 0;
            dated.forEach(function (y) {
                (function walk(p) {
                    fs.readdirSync(p, { withFileTypes: true }).forEach(function (e) {
                        if (e.isDirectory()) { walk(nodePath.join(p, e.name)); } else { found++; }
                    });
                })(nodePath.join(root, y));
            });
            assert.equal(found, 0, 'a caller that got no key must not be left with unreferenceable bytes on disk');
            done();
        });
    });
});
