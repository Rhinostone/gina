/**
 * Connector-backed StorageMetaStore (#STO1) — Couchbase store.
 *
 * Covers:
 *   - core/connectors/couchbase/lib/storage-store.js — behavioral, against the
 *     REAL store code driven by a fake promise-based couchbase SDK (CI has no
 *     cluster; the driver is injected via the factory's test-only fourth arg,
 *     the entity-layer `injected` precedent). The fake simulates per-document
 *     monotonic CAS, so the read-modify-write loops are exercised for real:
 *     an interleaved writer bumps the CAS and the store's mutateIn genuinely
 *     fails and retries.
 *   - The StorageMetaStore contract: exact row shapes (a non-refcounted row
 *     must come back WITHOUT refs/zeroAt, a file-backed row without data),
 *     binary fidelity of the base64 payload column (NUL bytes, a zero-length
 *     payload distinct from an absent one, 64KB round-trip), and the
 *     refcount-verb semantics the `cas` strategy depends on.
 *   - Composed N1QL: the captured statements must scope by driver, exclude
 *     reserved dot-keys, guard on `refs IS VALUED`, run `adhoc:false` and
 *     NotBounded, and stay STABLE strings across calls (the plan cache).
 *   - Driver namespacing: two stores over ONE backend must not see each
 *     other's rows, stamps or refcounts.
 *   - Index bootstrap: probe system:indexes, create only what is missing,
 *     tolerate a benign create race, and log the exact DDL when creation is
 *     refused.
 *   - lib/storage-store — the dispatcher passes `driverName` through to the
 *     implementation (behavioral, against a FAKE connector tree under a temp
 *     GINA_FRAMEWORK_DIR — the audit-store.test.js precedent).
 *
 * The fake SDK THROWS on any collection method the emulator does not
 * implement, so the store reaching for an unexpected SDK call (a binary
 * transcoder, getAndLock, a lookupIn) fails these tests by construction.
 *
 * Run: node --test test/lib/storage-store-couchbase.test.js
 */

'use strict';

var { describe, it, beforeEach, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW          = require('../fw');
var createStore = require(path.join(FW, 'core/connectors/couchbase/lib/storage-store.js'));

var STORE_SOURCE = path.join(FW, 'core/connectors/couchbase/lib/storage-store.js');


// ─── Fake couchbase SDK ─────────────────────────────────────────────────────

/** Base class so `instanceof` classification works exactly as with the real SDK. */
class FakeCouchbaseError extends Error {}
class CasMismatchError extends FakeCouchbaseError {}
class DocumentNotFoundError extends FakeCouchbaseError {}
class DocumentExistsError extends FakeCouchbaseError {}
class IndexExistsError extends FakeCouchbaseError {}

/**
 * Build a fake couchbase SDK over an in-memory backend.
 *
 * @param {object} [opt]
 * @param {boolean} [opt.failConnect]      - Reject `connect()`.
 * @param {boolean} [opt.failIndexProbe]   - Reject the system:indexes SELECT.
 * @param {boolean} [opt.failIndexCreate]  - Reject CREATE INDEX (the RBAC-refused shape).
 * @param {boolean} [opt.indexCreateRaces] - Reject CREATE INDEX with IndexExistsError.
 * @param {string[]} [opt.existingIndexes] - Index names the cluster already has.
 * @returns {object} `{ sdk, backend }`.
 */
function makeFakeSdk(opt) {
    opt = opt || {};

    var backend = {
        docs      : new Map(), // id -> { value, cas }
        queries   : [],        // { statement, options }
        indexes   : (opt.existingIndexes || []).slice(),
        casSeq    : 0,
        closed    : false
    };

    var clone = function(v) {
        return (v === null || typeof v !== 'object') ? v : JSON.parse(JSON.stringify(v));
    };
    var nextCas = function() { return ++backend.casSeq; };

    var collection = {
        get: function(id) {
            var e = backend.docs.get(id);
            if (!e) { return Promise.reject(new DocumentNotFoundError(id)); }
            return Promise.resolve({ content: clone(e.value), cas: e.cas });
        },
        insert: function(id, doc) {
            if (backend.docs.has(id)) { return Promise.reject(new DocumentExistsError(id)); }
            backend.docs.set(id, { value: clone(doc), cas: nextCas() });
            return Promise.resolve({ cas: backend.docs.get(id).cas });
        },
        upsert: function(id, doc) {
            backend.docs.set(id, { value: clone(doc), cas: nextCas() });
            return Promise.resolve({ cas: backend.docs.get(id).cas });
        },
        remove: function(id, options) {
            var e = backend.docs.get(id);
            if (!e) { return Promise.reject(new DocumentNotFoundError(id)); }
            if (options && options.cas && options.cas !== e.cas) {
                return Promise.reject(new CasMismatchError(id));
            }
            backend.docs.delete(id);
            return Promise.resolve({});
        },
        mutateIn: function(id, specs, options) {
            var e = backend.docs.get(id);
            if (!e) { return Promise.reject(new DocumentNotFoundError(id)); }
            if (options && options.cas && options.cas !== e.cas) {
                return Promise.reject(new CasMismatchError(id));
            }
            // atomic as a unit: build the next value, then commit once
            var next = clone(e.value);
            for (var i = 0; i < specs.length; i++) {
                var spec = specs[i];
                if (String(spec.path).indexOf('.') > -1) {
                    throw new Error('fake SDK: nested sub-document paths are not emulated (got `' + spec.path + '`)');
                }
                if (spec.op === 'upsert') { next[spec.path] = spec.value; }
                else if (spec.op === 'remove') { delete next[spec.path]; }
                else { throw new Error('fake SDK: unimplemented mutateIn op `' + spec.op + '`'); }
            }
            backend.docs.set(id, { value: next, cas: nextCas() });
            return Promise.resolve({ cas: backend.docs.get(id).cas });
        }
    };

    // Any method the store reaches for that the emulator does not implement
    // must fail loudly — the redis job-store fake's contract.
    var guardedCollection = new Proxy(collection, {
        get: function(target, prop) {
            if (prop in target) { return target[prop]; }
            if (typeof prop === 'symbol' || prop === 'then' || prop === 'inspect') { return undefined; }
            throw new Error('fake SDK: the store called an unimplemented collection method `' + String(prop) + '`');
        }
    });

    /** Emulate only the statement shapes this store composes. */
    var runQuery = function(statement, options) {
        backend.queries.push({ statement: statement, options: options });
        var params = (options && options.parameters) || [];

        if (statement.indexOf('system:indexes') > -1) {
            if (opt.failIndexProbe) { return Promise.reject(new Error('index probe refused')); }
            return Promise.resolve({ rows: backend.indexes.map(function(n) { return { name: n }; }) });
        }
        if (statement.indexOf('CREATE INDEX') === 0) {
            if (opt.indexCreateRaces) { return Promise.reject(new IndexExistsError('exists')); }
            if (opt.failIndexCreate) { return Promise.reject(new Error('user has no index-creation privilege')); }
            var m = statement.match(/CREATE INDEX `([^`]+)`/);
            backend.indexes.push(m[1]);
            return Promise.resolve({ rows: [] });
        }

        var limit = parseInt((statement.match(/LIMIT (\d+)/) || [])[1], 10);
        var rows  = [];
        backend.docs.forEach(function(e) { rows.push(e.value); });
        rows = rows.filter(function(d) { return d.d === params[0]; });

        if (statement.indexOf('refs IS VALUED AND refs = 0') > -1) {
            rows = rows.filter(function(d) {
                return typeof d.refs === 'number' && d.refs === 0
                    && typeof d.zeroAt === 'number' && d.zeroAt <= params[1];
            });
            rows.sort(function(a, b) { return a.zeroAt - b.zeroAt; });
            return Promise.resolve({ rows: rows.slice(0, limit).map(function(d) { return { k: d.k }; }) });
        }
        if (statement.indexOf('k > $2') > -1) {
            rows = rows.filter(function(d) { return d.k > params[1] && d.k.charAt(0) !== '.'; });
            rows.sort(function(a, b) { return a.k < b.k ? -1 : (a.k > b.k ? 1 : 0); });
            return Promise.resolve({ rows: rows.slice(0, limit).map(function(d) { return { k: d.k }; }) });
        }
        if (statement.indexOf('COUNT(1) AS objects') > -1) {
            rows = rows.filter(function(d) { return d.k.charAt(0) !== '.'; });
            return Promise.resolve({ rows: [{
                objects        : rows.length,
                refcounted     : rows.filter(function(d) { return typeof d.refs === 'number'; }).length,
                zeroRefPending : rows.filter(function(d) { return d.refs === 0; }).length,
                inline         : rows.filter(function(d) { return typeof d.data === 'string'; }).length,
                bytes          : rows.reduce(function(a, d) { return a + (d.size || 0); }, 0)
            }] });
        }
        throw new Error('fake SDK: unemulated statement shape: ' + statement);
    };

    var cluster = {
        bucket: function() {
            return { scope: function() { return { collection: function() { return guardedCollection; } }; } };
        },
        query: runQuery,
        close: function() { backend.closed = true; return Promise.resolve(); }
    };

    var sdk = {
        connect: function() {
            if (opt.failConnect) { return Promise.reject(new Error('cluster unreachable')); }
            return Promise.resolve(cluster);
        },
        CasMismatchError      : CasMismatchError,
        DocumentNotFoundError : DocumentNotFoundError,
        DocumentExistsError   : DocumentExistsError,
        IndexExistsError      : IndexExistsError,
        DurabilityLevel       : { None: 0, Majority: 1, MajorityAndPersistOnMaster: 2, PersistToMajority: 3 },
        QueryScanConsistency  : { NotBounded: 'not_bounded', RequestPlus: 'request_plus' },
        MutateInSpec          : {
            upsert : function(p, v) { return { op: 'upsert', path: p, value: v }; },
            remove : function(p)    { return { op: 'remove', path: p }; }
        }
    };

    return { sdk: sdk, backend: backend };
}

var CONN = { host: '127.0.0.1', database: 'gina_storage', username: 'u', password: 'p' };

/**
 * Build a store over a fresh (or shared) fake backend.
 *
 * @param {object} [o]
 * @param {string} [o.driver='assets']
 * @param {object} [o.conn]
 * @param {object} [o.fake]  - Reuse an existing `makeFakeSdk()` result (shared backend).
 * @param {object} [o.sdkOpt]
 * @returns {object} `{ store, backend, fake }`
 */
function build(o) {
    o = o || {};
    var fake = o.fake || makeFakeSdk(o.sdkOpt);
    var store = createStore(o.conn || CONN, 'testbundle', o.driver || 'assets', { driver: fake.sdk });
    return { store: store, backend: fake.backend, fake: fake };
}

// promise wrappers — the seam is callback-shaped
function pSet(s, k, m)        { return new Promise(function(r, j) { s.set(k, m, function(e, v) { e ? j(e) : r(v); }); }); }
function pGet(s, k)           { return new Promise(function(r, j) { s.get(k, function(e, v) { e ? j(e) : r(v); }); }); }
function pRemove(s, k)        { return new Promise(function(r, j) { s.remove(k, function(e, v) { e ? j(e) : r(v); }); }); }
function pAcquire(s, k, m)    { return new Promise(function(r, j) { s.acquireRef(k, m, function(e, v) { e ? j(e) : r(v); }); }); }
function pRelease(s, k)       { return new Promise(function(r, j) { s.releaseRef(k, function(e, v) { e ? j(e) : r(v); }); }); }
function pZero(s, t, l)       { return new Promise(function(r, j) { s.listZeroRefs(t, l, function(e, v) { e ? j(e) : r(v); }); }); }
function pRmZero(s, k)        { return new Promise(function(r, j) { s.removeIfZero(k, function(e, v) { e ? j(e) : r(v); }); }); }
function pStats(s)            { return new Promise(function(r, j) { s.stats(function(e, v) { e ? j(e) : r(v); }); }); }
function pKeys(s, a, l)       { return new Promise(function(r, j) { s.listKeys(a, l, function(e, v) { e ? j(e) : r(v); }); }); }

/** Let the fire-and-forget index bootstrap settle. */
function settle() { return new Promise(function(r) { setTimeout(r, 5); }); }

/** Silence expected store logging, returning the captured lines. */
function captureConsole() {
    var lines = [], e = console.error, w = console.warn;
    console.error = function() { lines.push(Array.prototype.join.call(arguments, ' ')); };
    console.warn  = function() { lines.push(Array.prototype.join.call(arguments, ' ')); };
    return { lines: lines, restore: function() { console.error = e; console.warn = w; } };
}


describe('01 - base seam verbs', function () {

    it('set/get round-trips the four contract fields, and get() answers null for an unknown key', async function () {
        var b = build();
        await pSet(b.store, '2026/08/14/ABC.pdf', {
            originalName: 'invoice.pdf', contentType: 'application/pdf', size: 12, createdAt: 1700000000000
        });
        var m = await pGet(b.store, '2026/08/14/ABC.pdf');
        assert.deepStrictEqual(m, {
            originalName: 'invoice.pdf', contentType: 'application/pdf', size: 12, createdAt: 1700000000000
        });
        assert.strictEqual(await pGet(b.store, 'nope'), null);
    });

    it('a non-refcounted row comes back with EXACTLY four keys — no refs, no zeroAt, no data', async function () {
        var b = build();
        await pSet(b.store, 'k1', { originalName: 'a', size: 1, createdAt: 2 });
        var m = await pGet(b.store, 'k1');
        assert.deepStrictEqual(Object.keys(m).sort(), ['contentType', 'createdAt', 'originalName', 'size']);
    });

    it('remove() reports whether the row existed', async function () {
        var b = build();
        await pSet(b.store, 'k1', { size: 1 });
        assert.strictEqual(await pRemove(b.store, 'k1'), true);
        assert.strictEqual(await pRemove(b.store, 'k1'), false);
    });

    it('close() releases the cluster', async function () {
        var b = build();
        await pSet(b.store, 'k1', { size: 1 });
        b.store.close();
        await settle();
        assert.strictEqual(b.backend.closed, true);
    });
});


describe('02 - binary payload fidelity (the base64 column)', function () {

    it('round-trips NUL bytes and high bytes exactly', async function () {
        var b = build();
        var payload = Buffer.from([0x00, 0xff, 0x00, 0x41, 0x00, 0xfe, 0x7f]);
        await pSet(b.store, 'bin', { size: payload.length, data: payload });
        var m = await pGet(b.store, 'bin');
        assert.ok(Buffer.isBuffer(m.data), 'data comes back as a Buffer');
        assert.deepStrictEqual(m.data, payload, 'byte-exact, no utf8 coercion, no truncation at NUL');
    });

    it('a ZERO-LENGTH payload is distinct from an absent one', async function () {
        var b = build();
        await pSet(b.store, 'empty',  { size: 0, data: Buffer.alloc(0) });
        await pSet(b.store, 'absent', { size: 0 });
        var e = await pGet(b.store, 'empty');
        var a = await pGet(b.store, 'absent');
        assert.ok(Buffer.isBuffer(e.data) && e.data.length === 0, 'empty payload survives as an empty Buffer');
        assert.strictEqual(typeof a.data, 'undefined', 'an absent payload leaves the key off entirely');
    });

    it('round-trips a 64KB payload (the shipped tiering threshold)', async function () {
        var b = build();
        var payload = Buffer.alloc(64 * 1024);
        for (var i = 0; i < payload.length; i++) { payload[i] = i % 256; }
        await pSet(b.store, 'big', { size: payload.length, data: payload });
        var m = await pGet(b.store, 'big');
        assert.strictEqual(m.data.length, 64 * 1024);
        assert.deepStrictEqual(m.data, payload);
    });

    it('a non-Uint8Array `data` is REFUSED rather than utf8-coerced', async function () {
        var b = build();
        await pSet(b.store, 'strdata', { size: 3, data: 'abc' });
        var m = await pGet(b.store, 'strdata');
        assert.strictEqual(typeof m.data, 'undefined', 'a string payload is dropped, never encoded');
    });

    it('the stored document holds base64, not raw bytes (the query-visibility reason)', async function () {
        var b = build();
        await pSet(b.store, 'bin', { size: 2, data: Buffer.from([0x00, 0x01]) });
        var doc = null;
        b.backend.docs.forEach(function (e) { if (e.value.k === 'bin') { doc = e.value; } });
        assert.strictEqual(typeof doc.data, 'string', 'the payload rides as a JSON string so the row stays queryable');
        assert.strictEqual(doc.data, Buffer.from([0x00, 0x01]).toString('base64'));
    });
});


describe('03 - refcount verbs', function () {

    it('acquireRef creates with refs=1, then increments — first-write-wins on the identity fields', async function () {
        var b = build();
        var r1 = await pAcquire(b.store, 'blobs/sha256/aa/bb/feed', { originalName: 'x', size: 4, createdAt: 1 });
        assert.deepStrictEqual({ created: r1.created, refs: r1.refs }, { created: true, refs: 1 });

        var r2 = await pAcquire(b.store, 'blobs/sha256/aa/bb/feed', { originalName: 'IGNORED' });
        assert.strictEqual(r2.created, false);
        assert.strictEqual(r2.refs, 2);
        assert.strictEqual(r2.meta.originalName, 'x', 'the STORED identity is returned, not the incoming one');
        assert.deepStrictEqual(Object.keys(r2.meta).sort(),
            ['contentType', 'createdAt', 'originalName', 'refs', 'size'],
            'the increment path returns the embedded store\'s exact 5-key meta shape');
    });

    it('a refcounted row exposes refs AND zeroAt together, and only together', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });
        var m = await pGet(b.store, 'blob');
        assert.strictEqual(m.refs, 1);
        assert.strictEqual(m.zeroAt, null, 'zeroAt is null while refs > 0');
        await pSet(b.store, 'plain', { size: 1 });
        var p = await pGet(b.store, 'plain');
        assert.ok(!('refs' in p) && !('zeroAt' in p));
    });

    it('releaseRef floors at 0 and stamps zeroAt exactly at the 1 → 0 transition', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });
        await pAcquire(b.store, 'blob', {});
        var r1 = await pRelease(b.store, 'blob');
        assert.deepStrictEqual(r1, { existed: true, refs: 1 });
        assert.strictEqual((await pGet(b.store, 'blob')).zeroAt, null, 'still null above zero');

        var r2 = await pRelease(b.store, 'blob');
        assert.deepStrictEqual(r2, { existed: true, refs: 0 });
        assert.strictEqual(typeof (await pGet(b.store, 'blob')).zeroAt, 'number', 'stamped at zero');

        var r3 = await pRelease(b.store, 'blob');
        assert.strictEqual(r3.existed, false, 'an already-zero row reports existed:false (idempotent)');
    });

    it('releaseRef on a missing or non-refcounted row reports existed:false', async function () {
        var b = build();
        assert.deepStrictEqual(await pRelease(b.store, 'ghost'), { existed: false, refs: 0 });
        await pSet(b.store, 'plain', { size: 1 });
        assert.strictEqual((await pRelease(b.store, 'plain')).existed, false);
    });

    it('acquireRef REFUSES to adopt an existing non-refcounted row', async function () {
        var b = build();
        await pSet(b.store, 'plain', { originalName: 'sharded-row', size: 1 });
        await assert.rejects(
            pAcquire(b.store, 'plain', { size: 1 }),
            /refuses to adopt an existing non-refcounted row/,
            'a silent adoption would corrupt the row\'s real owner'
        );
        var m = await pGet(b.store, 'plain');
        assert.ok(!('refs' in m), 'the refused row is left exactly as it was');
    });

    it('acquireRef resurrects a zero-ref row and CLEARS its zeroAt stamp', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });
        await pRelease(b.store, 'blob');
        assert.strictEqual(typeof (await pGet(b.store, 'blob')).zeroAt, 'number');

        var r = await pAcquire(b.store, 'blob', { size: 1 });
        assert.deepStrictEqual({ created: r.created, refs: r.refs }, { created: false, refs: 1 });
        assert.strictEqual((await pGet(b.store, 'blob')).zeroAt, null, 'resurrection clears the stamp');
    });

    it('the payload is NOT re-sent on a refcount bump (the mutateIn reason)', async function () {
        var b = build();
        var payload = Buffer.alloc(1024, 7);
        await pAcquire(b.store, 'blob', { size: payload.length, data: payload });
        await pAcquire(b.store, 'blob', {});
        var m = await pGet(b.store, 'blob');
        assert.deepStrictEqual(m.data, payload, 'the inline payload survives a sub-document refcount bump untouched');
        assert.strictEqual(m.refs, 2);
    });
});


describe('04 - CAS contention (the retry loops, driven by real CAS mismatches)', function () {

    it('acquireRef retries when a writer interleaves between its read and its write', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });

        // Interleave exactly once: the first mutateIn sees a moved CAS.
        var coll = null, realMutate = null, fired = 0;
        await pGet(b.store, 'blob'); // ensure the connection is up
        var cluster = await b.fake.sdk.connect();
        coll = cluster.bucket().scope().collection();
        realMutate = coll.mutateIn;
        coll.mutateIn = function (id, specs, options) {
            if (fired++ === 0) {
                var e = b.backend.docs.get(id);
                b.backend.docs.set(id, { value: e.value, cas: e.cas + 1000 }); // somebody else wrote
            }
            return realMutate.call(coll, id, specs, options);
        };

        var r = await pAcquire(b.store, 'blob', {});
        coll.mutateIn = realMutate;
        assert.ok(fired >= 2, 'the store re-read and retried after the CAS mismatch');
        assert.strictEqual(r.refs, 2, 'and the retry produced the correct count — no lost update');
    });

    it('a CAS loop gives up with a coded error under sustained contention', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });
        var cluster = await b.fake.sdk.connect();
        var coll = cluster.bucket().scope().collection();
        coll.mutateIn = function (id) {
            var e = b.backend.docs.get(id);
            b.backend.docs.set(id, { value: e.value, cas: e.cas + 1 }); // always moved
            return Promise.reject(new CasMismatchError(id));
        };
        await assert.rejects(pAcquire(b.store, 'blob', {}), function (err) {
            assert.strictEqual(err.code, 'GINA_STORAGE_CAS_CONTENTION');
            assert.match(err.message, /gave up after 10 CAS attempts/);
            return true;
        });
    });

    it('two concurrent acquireRef calls on a missing key yield ONE row and TWO references', async function () {
        var b = build();
        var results = await Promise.all([
            pAcquire(b.store, 'blob', { originalName: 'a', size: 1 }),
            pAcquire(b.store, 'blob', { originalName: 'b', size: 1 })
        ]);
        var created = results.filter(function (r) { return r.created; });
        assert.strictEqual(created.length, 1, 'exactly one call created the row');
        assert.strictEqual((await pGet(b.store, 'blob')).refs, 2, 'both references were counted');
    });
});


describe('05 - removeIfZero: the sweep claim', function () {

    it('claims a zero-ref row', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });
        await pRelease(b.store, 'blob');
        assert.strictEqual(await pRmZero(b.store, 'blob'), true);
        assert.strictEqual(await pGet(b.store, 'blob'), null);
    });

    it('refuses a row with live references, and a missing row', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });
        assert.strictEqual(await pRmZero(b.store, 'blob'), false);
        assert.strictEqual(await pRmZero(b.store, 'ghost'), false);
    });

    it('never claims a non-refcounted row (a sharded row or the .driver stamp)', async function () {
        var b = build();
        await pSet(b.store, 'plain', { size: 1 });
        await pSet(b.store, '.driver', { createdAt: 1, data: Buffer.from('{}') });
        assert.strictEqual(await pRmZero(b.store, 'plain'), false);
        assert.strictEqual(await pRmZero(b.store, '.driver'), false);
        assert.ok(await pGet(b.store, '.driver'), 'the stamp is untouched');
    });

    it('a resurrection between the read and the claim WINS — the claim reports false', async function () {
        var b = build();
        await pAcquire(b.store, 'blob', { size: 1 });
        await pRelease(b.store, 'blob');

        var cluster = await b.fake.sdk.connect();
        var coll = cluster.bucket().scope().collection();
        var realRemove = coll.remove;
        coll.remove = function (id, options) {
            var e = b.backend.docs.get(id);                                  // resurrect first
            b.backend.docs.set(id, { value: e.value, cas: e.cas + 1 });
            coll.remove = realRemove;
            return realRemove.call(coll, id, options);
        };
        assert.strictEqual(await pRmZero(b.store, 'blob'), false, 'the CAS guard let the resurrection win');
        assert.ok(await pGet(b.store, 'blob'), 'the row survived');
    });

    it('concurrent sweepers: exactly ONE claim succeeds (why no election layer is needed)', async function () {
        var shared = makeFakeSdk();
        var a = build({ fake: shared, driver: 'assets' });
        var c = build({ fake: shared, driver: 'assets' }); // a second process, same driver + backend
        await pAcquire(a.store, 'blob', { size: 1 });
        await pRelease(a.store, 'blob');

        var claims = await Promise.all([pRmZero(a.store, 'blob'), pRmZero(c.store, 'blob')]);
        assert.strictEqual(claims.filter(Boolean).length, 1, 'exactly one sweeper claimed the row');
    });
});


describe('06 - listZeroRefs / listKeys / stats', function () {

    it('listZeroRefs returns only zero-ref rows older than the cutoff, oldest first, capped', async function () {
        var b = build();
        for (var i = 0; i < 3; i++) {
            await pAcquire(b.store, 'blob' + i, { size: 1 });
            await pRelease(b.store, 'blob' + i);
        }
        await pAcquire(b.store, 'live', { size: 1 }); // refs = 1
        await pSet(b.store, 'plain', { size: 1 });    // no refs at all

        var keys = await pZero(b.store, Date.now() + 1000, 100);
        assert.deepStrictEqual(keys.sort(), ['blob0', 'blob1', 'blob2']);
        assert.strictEqual((await pZero(b.store, Date.now() + 1000, 2)).length, 2, 'the limit is honoured');
        assert.deepStrictEqual(await pZero(b.store, 0, 100), [], 'nothing is old enough before the cutoff');
    });

    it('listKeys pages after a cursor and excludes reserved dot-keys', async function () {
        var b = build();
        await pSet(b.store, 'a', { size: 1 });
        await pSet(b.store, 'b', { size: 1 });
        await pSet(b.store, 'c', { size: 1 });
        await pSet(b.store, '.driver', { createdAt: 1 });
        assert.deepStrictEqual(await pKeys(b.store, '', 100), ['a', 'b', 'c'], 'the stamp is never listed');
        assert.deepStrictEqual(await pKeys(b.store, 'a', 100), ['b', 'c']);
        assert.deepStrictEqual(await pKeys(b.store, '', 2), ['a', 'b']);
    });

    it('stats aggregates, excludes the stamp, and reports zeroes on an empty driver', async function () {
        var b = build();
        assert.deepStrictEqual(await pStats(b.store),
            { objects: 0, refcounted: 0, zeroRefPending: 0, inline: 0, bytes: 0 });

        await pSet(b.store, 'plain', { size: 10 });
        await pSet(b.store, '.driver', { createdAt: 1, size: 999 });
        await pAcquire(b.store, 'blob', { size: 5, data: Buffer.from('hi') });
        await pAcquire(b.store, 'gone', { size: 2 });
        await pRelease(b.store, 'gone');

        var s = await pStats(b.store);
        assert.deepStrictEqual(s, { objects: 3, refcounted: 2, zeroRefPending: 1, inline: 1, bytes: 17 });
    });
});


describe('07 - composed N1QL (the captured statements)', function () {

    it('every query scopes by driver, uses adhoc:false and NotBounded', async function () {
        var b = build();
        await settle();   // let the fire-and-forget index bootstrap land first
        b.backend.queries.length = 0;
        await pZero(b.store, 1, 10);
        await pKeys(b.store, '', 10);
        await pStats(b.store);
        assert.strictEqual(b.backend.queries.length, 3);
        b.backend.queries.forEach(function (q) {
            assert.match(q.statement, /d = \$1/, 'driver-scoped');
            assert.strictEqual(q.options.adhoc, false);
            assert.strictEqual(q.options.scanConsistency, 'not_bounded');
            assert.strictEqual(q.options.parameters[0], 'assets');
        });
    });

    it('listZeroRefs guards on `refs IS VALUED` — what keeps foreign rows structurally invisible', async function () {
        var b = build();
        await settle();   // let the fire-and-forget index bootstrap land first
        b.backend.queries.length = 0;
        await pZero(b.store, 1, 10);
        assert.match(b.backend.queries[0].statement, /refs IS VALUED AND refs = 0/);
        assert.match(b.backend.queries[0].statement, /zeroAt IS VALUED AND zeroAt <= \$2/);
    });

    it('listKeys and stats exclude reserved dot-keys in SQL, not in JS', async function () {
        var b = build();
        await settle();   // let the fire-and-forget index bootstrap land first
        b.backend.queries.length = 0;
        await pKeys(b.store, '', 10);
        await pStats(b.store);
        assert.match(b.backend.queries[0].statement, /k NOT LIKE "\.%"/);
        assert.match(b.backend.queries[1].statement, /k NOT LIKE "\.%"/);
    });

    it('statements are STABLE strings across calls with the same limit (the plan cache)', async function () {
        var b = build();
        await settle();   // let the fire-and-forget index bootstrap land first
        b.backend.queries.length = 0;
        await pZero(b.store, 1, 10);
        await pZero(b.store, 999, 10);
        assert.strictEqual(b.backend.queries[0].statement, b.backend.queries[1].statement,
            'only the VALUES vary — they are bound, not interpolated');
        assert.notStrictEqual(b.backend.queries[0].options.parameters[1],
            b.backend.queries[1].options.parameters[1]);
    });

    it('a bogus limit falls back to the documented default rather than reaching the server', async function () {
        var b = build();
        await settle();   // let the fire-and-forget index bootstrap land first
        b.backend.queries.length = 0;
        await pZero(b.store, 1, 'DROP INDEX x');
        await pKeys(b.store, '', 1.5);
        assert.match(b.backend.queries[0].statement, /LIMIT 100$/);
        assert.match(b.backend.queries[1].statement, /LIMIT 500$/);
    });

    it('the keyspace is backtick-quoted from validated identifiers', async function () {
        var b = build();
        await settle();   // let the fire-and-forget index bootstrap land first
        b.backend.queries.length = 0;
        await pStats(b.store);
        assert.match(b.backend.queries[0].statement, /FROM `gina_storage`\.`_default`\.`_default`/);
    });
});


describe('08 - driver namespacing (two drivers, one backend)', function () {

    it('two drivers over ONE backend never see each other\'s rows', async function () {
        var shared = makeFakeSdk();
        var a = build({ fake: shared, driver: 'assets' });
        var v = build({ fake: shared, driver: 'invoices' });

        await pSet(a.store, 'same/key', { originalName: 'from-assets', size: 1 });
        await pSet(v.store, 'same/key', { originalName: 'from-invoices', size: 2 });

        assert.strictEqual((await pGet(a.store, 'same/key')).originalName, 'from-assets');
        assert.strictEqual((await pGet(v.store, 'same/key')).originalName, 'from-invoices');
        assert.deepStrictEqual(await pKeys(a.store, '', 100), ['same/key']);
        assert.strictEqual((await pStats(a.store)).objects, 1, 'stats never counts the sibling driver\'s rows');
    });

    it('refcounts and sweeps stay per-driver', async function () {
        var shared = makeFakeSdk();
        var a = build({ fake: shared, driver: 'assets' });
        var v = build({ fake: shared, driver: 'invoices' });

        await pAcquire(a.store, 'blobs/sha256/aa/bb/ff', { size: 1 });
        await pAcquire(v.store, 'blobs/sha256/aa/bb/ff', { size: 1 }); // identical cas key, other driver
        await pRelease(a.store, 'blobs/sha256/aa/bb/ff');

        assert.deepStrictEqual(await pZero(a.store, Date.now() + 1000, 100), ['blobs/sha256/aa/bb/ff']);
        assert.deepStrictEqual(await pZero(v.store, Date.now() + 1000, 100), [],
            'the sibling driver\'s live blob is not collectable');
        assert.strictEqual((await pGet(v.store, 'blobs/sha256/aa/bb/ff')).refs, 1);
    });

    it('each driver keeps its OWN .driver strategy stamp', async function () {
        var shared = makeFakeSdk();
        var a = build({ fake: shared, driver: 'assets' });
        var v = build({ fake: shared, driver: 'invoices' });
        await pSet(a.store, '.driver', { createdAt: 1, data: Buffer.from(JSON.stringify({ strategy: 'cas' })) });
        await pSet(v.store, '.driver', { createdAt: 1, data: Buffer.from(JSON.stringify({ strategy: 'sharded' })) });
        assert.strictEqual(JSON.parse((await pGet(a.store, '.driver')).data.toString()).strategy, 'cas');
        assert.strictEqual(JSON.parse((await pGet(v.store, '.driver')).data.toString()).strategy, 'sharded');
    });
});


describe('09 - construction guards', function () {

    it('refuses a driver name that could alias another namespace', function () {
        var fake = makeFakeSdk();
        [undefined, '', 'has:colon', 'has space', 'has/slash'].forEach(function (bad) {
            assert.throws(function () { createStore(CONN, 'b', bad, { driver: fake.sdk }); },
                /storage driver name is required/);
        });
        assert.doesNotThrow(function () { createStore(CONN, 'b', 'ok_name-1.2', { driver: fake.sdk }); });
    });

    it('refuses a missing bucket and an unusable keyspace identifier', function () {
        var fake = makeFakeSdk();
        assert.throws(function () { createStore({ host: 'h' }, 'b', 'd', { driver: fake.sdk }); },
            /missing required `database`/);
        assert.throws(function () { createStore({ database: 'ok`; DROP' }, 'b', 'd', { driver: fake.sdk }); },
            /`database` must match/);
        assert.throws(function () { createStore({ database: 'ok', scope: 'a b' }, 'b', 'd', { driver: fake.sdk }); },
            /`scope` must match/);
    });

    it('refuses an SDK with no connect() — the v2 shape', function () {
        assert.throws(function () { createStore(CONN, 'b', 'd', { driver: { CasMismatchError: Error } }); },
            /supported SDK majors are 3 and 4/);
    });

    it('refuses an unknown durability level, and accepts BOTH spellings of the middle one', function () {
        var fake = makeFakeSdk();
        assert.throws(function () { createStore({ database: 'x', durability: 'sorta' }, 'b', 'd', { driver: fake.sdk }); },
            /unknown `durability`/);
        ['majority', 'majorityAndPersistToActive', 'majorityAndPersistOnMaster', 'persistToMajority'].forEach(function (lvl) {
            assert.doesNotThrow(function () {
                createStore({ database: 'x', durability: lvl }, 'b', 'd', { driver: fake.sdk });
            }, lvl + ' is accepted');
        });
    });

    it('refuses a composed document id over Couchbase\'s 250-byte key ceiling', async function () {
        var b = build();
        await assert.rejects(pSet(b.store, 'x'.repeat(300), { size: 1 }), /250-byte key limit/);
        await assert.rejects(pGet(b.store, 'x'.repeat(300)), /250-byte key limit/);
    });

    it('a connection failure surfaces through every verb\'s callback', async function () {
        var cap = captureConsole();
        var b = build({ sdkOpt: { failConnect: true } });
        await settle();
        cap.restore();
        await assert.rejects(pGet(b.store, 'k'), /cluster unreachable/);
        await assert.rejects(pSet(b.store, 'k', {}), /cluster unreachable/);
        assert.ok(cap.lines.some(function (l) { return /connection to .* failed/.test(l); }),
            'and it is logged once at construction');
    });
});


describe('10 - durability passthrough', function () {

    it('applies the configured level to mutations, and omits it when unconfigured', async function () {
        var fake = makeFakeSdk();
        var cluster = await fake.sdk.connect();
        var coll = cluster.bucket().scope().collection();
        var seen = [];
        var realUpsert = coll.upsert;
        coll.upsert = function (id, doc, options) { seen.push(options); return realUpsert.call(coll, id, doc, options); };

        var plain = createStore(CONN, 'b', 'd1', { driver: fake.sdk });
        await pSet(plain, 'k', { size: 1 });
        assert.strictEqual(seen[0].durabilityLevel, undefined, 'unconfigured: the SDK default applies');

        var durable = createStore({ host: 'h', database: 'gina_storage', durability: 'persistToMajority' },
            'b', 'd2', { driver: fake.sdk });
        await pSet(durable, 'k', { size: 1 });
        assert.strictEqual(seen[1].durabilityLevel, 3, 'configured: the SDK enum value rides every mutation');
    });
});


describe('11 - index bootstrap', function () {

    it('probes system:indexes and creates only what is missing', async function () {
        var b = build({ sdkOpt: { existingIndexes: ['gina_storage_refs'] } });
        await settle();
        var creates = b.backend.queries.filter(function (q) { return q.statement.indexOf('CREATE INDEX') === 0; });
        assert.strictEqual(creates.length, 1, 'only the missing index is created');
        assert.match(creates[0].statement, /CREATE INDEX `gina_storage_keys` ON `gina_storage`\.`_default`\.`_default`\(d, k\)/);
    });

    it('creates both on a virgin cluster, and the probe is keyspace-scoped', async function () {
        var b = build();
        await settle();
        var probe = b.backend.queries[0];
        assert.match(probe.statement, /FROM system:indexes/);
        assert.match(probe.statement, /bucket_id IS MISSING AND keyspace_id = \$1/, 'the default-collection shape');
        assert.match(probe.statement, /bucket_id = \$1 AND scope_id = \$2 AND keyspace_id = \$3/, 'the named-collection shape');
        assert.deepStrictEqual(probe.options.parameters, ['gina_storage', '_default', '_default']);
        assert.strictEqual(b.backend.indexes.length, 2);
    });

    it('a benign create race (IndexExistsError) is silent', async function () {
        var cap = captureConsole();
        build({ sdkOpt: { indexCreateRaces: true } });
        await settle();
        cap.restore();
        assert.deepStrictEqual(cap.lines, [], 'a sibling process winning the create is not worth a warning');
    });

    it('a refused create logs the exact DDL to run by hand', async function () {
        var cap = captureConsole();
        build({ sdkOpt: { failIndexCreate: true } });
        await settle();
        cap.restore();
        assert.strictEqual(cap.lines.length, 2, 'one line per index');
        assert.ok(cap.lines.every(function (l) { return /run it by hand: CREATE INDEX/.test(l); }));
    });

    it('a failed probe still hands the operator both DDL statements', async function () {
        var cap = captureConsole();
        build({ sdkOpt: { failIndexProbe: true } });
        await settle();
        cap.restore();
        assert.strictEqual(cap.lines.length, 1);
        assert.match(cap.lines[0], /gina_storage_refs.*gina_storage_keys/);
    });

    it('a query failure is LOGGED as well as reported — the sweep\'s bare call would swallow it', async function () {
        var b = build();
        await settle();
        var cluster = await b.fake.sdk.connect();
        cluster.query = function () { return Promise.reject(new Error('No index available on keyspace')); };
        var cap = captureConsole();
        await assert.rejects(pZero(b.store, 1, 10), /No index available/);
        cap.restore();
        assert.ok(cap.lines.some(function (l) { return /listZeroRefs failed/.test(l) && /CREATE INDEX/.test(l); }),
            'the log names the missing index and the DDL that fixes it');
    });
});


describe('12 - seam conformance (the shapes lib/storage-cas asserts)', function () {

    it('acquireRef/releaseRef round-trip through the seam with the contracted shapes', async function () {
        var b = build();
        var r1 = await pAcquire(b.store, 'blobs/sha256/aa/bb/feed', { originalName: 'x', size: 4, createdAt: 1 });
        assert.deepStrictEqual({ created: r1.created, refs: r1.refs }, { created: true, refs: 1 });
        var r2 = await pAcquire(b.store, 'blobs/sha256/aa/bb/feed', { originalName: 'IGNORED' });
        assert.strictEqual(r2.created, false);
        assert.strictEqual(r2.refs, 2);
        assert.strictEqual(r2.meta.originalName, 'x');
        var r3 = await pRelease(b.store, 'blobs/sha256/aa/bb/feed');
        assert.deepStrictEqual(r3, { existed: true, refs: 1 });
        var r4 = await pRelease(b.store, 'missing-key');
        assert.strictEqual(r4.existed, false);
    });

    it('exposes every verb the cas strategy requires, plus both optional operator verbs', function () {
        var b = build();
        ['set', 'get', 'remove', 'close',
         'acquireRef', 'releaseRef', 'listZeroRefs', 'removeIfZero',
         'stats', 'listKeys'].forEach(function (verb) {
            assert.strictEqual(typeof b.store[verb], 'function', verb + '() is implemented');
        });
    });

    it('every verb reports failure through the callback, never by throwing', async function () {
        var b = build();
        await settle();
        var cluster = await b.fake.sdk.connect();
        var coll = cluster.bucket().scope().collection();
        var boom = function () { return Promise.reject(new Error('backend down')); };
        coll.get = boom; coll.upsert = boom; coll.remove = boom;
        cluster.query = boom;
        var cap = captureConsole();
        for (var p of [pGet(b.store, 'k'), pSet(b.store, 'k', {}), pRemove(b.store, 'k'),
                       pStats(b.store), pKeys(b.store, '', 10), pZero(b.store, 1, 10)]) {
            await assert.rejects(p, /backend down/);
        }
        cap.restore();
    });
});


describe('13 - source pins', function () {

    var src = fs.readFileSync(STORE_SOURCE, 'utf8');

    it('resolves the SDK from the project node_modules, never a bare require', function () {
        assert.ok(src.indexOf("getPath('project') + '/node_modules/couchbase'") > -1,
            'the framework keeps zero hard dependency on the couchbase driver');
        assert.strictEqual(src.indexOf("require('couchbase')"), -1, 'no bare require');
    });

    it('never reaches for a binary transcoder — a binary value would be query-invisible', function () {
        ['RawBinaryTranscoder', 'transcoder'].forEach(function (needle) {
            assert.strictEqual(src.indexOf(needle), -1, needle + ' must not appear');
        });
        assert.ok(src.indexOf("toString('base64')") > -1, 'the payload rides as base64 instead');
    });

    it('uses no pessimistic locking and no cluster-level mutation primitives', function () {
        ['getAndLock', 'unlock', 'lookupIn', 'binary()'].forEach(function (needle) {
            assert.strictEqual(src.indexOf(needle), -1, needle + ' is not part of this design');
        });
    });

    it('every mutation that needs a guard passes a cas token', function () {
        var casGuarded = src.match(/withDurability\(\{ cas: res\.cas \}\)/g) || [];
        assert.strictEqual(casGuarded.length, 3,
            'acquireRef + releaseRef + removeIfZero each guard their write with the read\'s CAS');
    });

    it('reads GetResult.content, the documented field', function () {
        assert.ok(src.indexOf('res.content') > -1);
        assert.strictEqual(src.indexOf('res.value'), -1, '.value is a compat alias, not the contract');
    });
});


// ─── Dispatcher: driverName pass-through ────────────────────────────────────

describe('14 - lib/storage-store dispatcher passes the driver name through', function () {

    var saved = {}, tmpFw = null, StorageStore = null;

    before(function () {
        // Requiring the dispatcher installs the real `_` / `getContext` /
        // `getConfig` globals — snapshot, then override (audit-store precedent).
        StorageStore = require(path.join(FW, 'lib/storage-store.js'));
        saved.getContext        = global.getContext;
        saved.getConfig         = global.getConfig;
        saved.GINA_FRAMEWORK_DIR = global.GINA_FRAMEWORK_DIR;

        tmpFw = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-storage-store-'));
        var connDir = path.join(tmpFw, 'core/connectors/fakecb/lib');
        fs.mkdirSync(connDir, { recursive: true });
        // A fake connector whose storage-store records the args it was handed.
        fs.writeFileSync(path.join(connDir, 'storage-store.js'),
            'module.exports = function (connConf, bundle, driverName) {'
            + ' return { args: { connConf: connConf, bundle: bundle, driverName: driverName },'
            + ' set: function () {}, get: function () {}, remove: function () {}, close: function () {} }; };');

        global.GINA_FRAMEWORK_DIR = tmpFw;
        global.getContext = function () { return { bundle: 'app', env: 'dev' }; };
        global.getConfig  = function () {
            return { app: { dev: { content: { connectors: {
                assetsMeta : { connector: 'fakecb', database: 'gina_storage' },
                brokenMeta : { database: 'no-connector-field' }
            } } } } };
        };
    });

    after(function () {
        global.getContext        = saved.getContext;
        global.getConfig         = saved.getConfig;
        global.GINA_FRAMEWORK_DIR = saved.GINA_FRAMEWORK_DIR;
        if (tmpFw) { fs.rmSync(tmpFw, { recursive: true, force: true }); }
    });

    it('hands the connectors entry, the bundle AND the driver name to the implementation', function () {
        var store = StorageStore('assetsMeta', 'assets');
        assert.strictEqual(store.args.driverName, 'assets',
            'without this the implementation cannot namespace its rows per driver');
        assert.strictEqual(store.args.bundle, 'app');
        assert.strictEqual(store.args.connConf.database, 'gina_storage');
    });

    it('two drivers may name the SAME connectors entry and stay distinguishable', function () {
        assert.strictEqual(StorageStore('assetsMeta', 'assets').args.driverName, 'assets');
        assert.strictEqual(StorageStore('assetsMeta', 'invoices').args.driverName, 'invoices');
    });

    it('still refuses an unknown entry, a connector-less entry and an unimplemented connector', function () {
        assert.throws(function () { StorageStore('nope', 'assets'); }, /could not resolve `nope`/);
        assert.throws(function () { StorageStore('brokenMeta', 'assets'); }, /has no `connector` field/);
        assert.throws(function () { StorageStore(null, 'assets'); }, /entry name is required/);
    });
});
