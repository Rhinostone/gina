/**
 * Connector-backed JobStore (#AI6 follow-up) — MongoDB store.
 *
 * Covers:
 *   - core/connectors/mongodb/lib/job-store.js — behavioral, against the REAL
 *     store code driven by a fake promise-based mongodb driver (CI has no
 *     mongod; the driver is injected via the factory's test-only third arg,
 *     the entity-layer `injected` DI precedent). Seam round-trips,
 *     memory-store parity (no expiry filter on get/list), the sweep predicate
 *     matrix (incl. the null-expiresAt type-bracketing analog of the SQLite
 *     store's IS NOT NULL), and the durability analog (two store instances
 *     over the same fake backend — records live server-side).
 *   - lib/job end-to-end through the real MongoDB store on a genuinely
 *     promise-async driver (also exercises the create-race hardening on an
 *     async store).
 *   - Config resolution: uri-preferred / composed-URI keys mirroring the
 *     mongodb session store (`database` is a NAME — the connector's own
 *     convention), collection default, ssl → tls mapping, plain (non-TTL)
 *     secondary indexes.
 *   - Source pins: driver-from-project-node_modules, memory-parity negatives
 *     (no expiry filter, no TTL-reaping option file-wide), safe
 *     Promise → callback pattern, STATES imported from lib/job.
 *
 * Run: node --test test/lib/job-store-mongodb.test.js
 */

'use strict';

var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW          = require('../fw');
var createStore = require(path.join(FW, 'core/connectors/mongodb/lib/job-store'));
var job         = require(path.join(FW, 'lib/job/src/main'));

var STORE_SOURCE = path.join(FW, 'core/connectors/mongodb/lib/job-store.js');


// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a record matching create()'s initial 13-key shape. */
function makeRecord(id, patch) {
    var now = Date.now();
    var rec = {
        id:          id,
        state:       'pending',
        result:      null,
        error:       null,
        attempts:    0,
        maxAttempts: 1,
        callbackUrl: null,
        meta:        null,
        createdAt:   now,
        updatedAt:   now,
        startedAt:   null,
        finishedAt:  null,
        expiresAt:   null
    };
    if (patch) {
        for (var k in patch) rec[k] = patch[k];
    }
    return rec;
}

function storeSet(store, rec) {
    return new Promise(function(res, rej) {
        store.set(rec.id, rec, function(err, r) { err ? rej(err) : res(r); });
    });
}
function storeGet(store, id) {
    return new Promise(function(res, rej) {
        store.get(id, function(err, rec) { err ? rej(err) : res(rec); });
    });
}
function storeList(store, filter) {
    return new Promise(function(res, rej) {
        store.list(filter || null, function(err, recs) { err ? rej(err) : res(recs); });
    });
}
function storeSweep(store, now) {
    return new Promise(function(res, rej) {
        store.sweep(now, function(err, n) { err ? rej(err) : res(n); });
    });
}

function tick(ms) {
    return new Promise(function(r) { setTimeout(r, ms || 5); });
}

function getJob(id) {
    return new Promise(function(res) { job.get(id, function(e, rec) { res(rec); }); });
}

async function waitForState(id, state, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 1000);
    var rec;
    while (Date.now() < deadline) {
        rec = await getJob(id);
        if (rec && rec.state === state) return rec;
        await tick(2);
    }
    throw new Error('timeout waiting for "' + state + '"; last state = ' + (rec && rec.state));
}

/**
 * A fake promise-based mongodb driver. Pass a previous fake's `state` to model
 * a SHARED mongod (two clients over the same collections — the durability
 * analog). Query matching implements exactly the shapes the store emits,
 * including BSON type bracketing on `$lte` (a numeric bound never matches a
 * null / missing field — mongo's real semantics for the sweep predicate).
 */
function createFakeMongodb(sharedState) {
    var state = sharedState || {
        dbs:           Object.create(null), // 'dbName.collName' -> { _id -> doc }
        uris:          [],
        clientOptions: [],
        indexes:       [],
        connects:      0,
        closes:        0,
        failWith:      null                 // when set, every collection op rejects with it
    };

    function has(map, id) { return Object.prototype.hasOwnProperty.call(map, id); }

    function matches(doc, query) {
        for (var key in query) {
            if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
            var cond = query[key];
            var val  = doc[key];
            if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
                if (Object.prototype.hasOwnProperty.call(cond, '$in')
                    && cond.$in.indexOf(val) < 0) return false;
                // BSON type bracketing: a numeric range bound only matches numbers.
                if (Object.prototype.hasOwnProperty.call(cond, '$lte')
                    && !(typeof val === 'number' && val <= cond.$lte)) return false;
            } else if (val !== cond) {
                return false;
            }
        }
        return true;
    }

    function op(fn) {
        if (state.failWith) { return Promise.reject(state.failWith); }
        return Promise.resolve().then(fn);
    }

    function makeCollection(map) {
        return {
            findOne: function(query) {
                return op(function() {
                    for (var id in map) {
                        if (has(map, id) && matches(map[id], query)) return map[id];
                    }
                    return null;
                });
            },
            replaceOne: function(query, doc, options) {
                return op(function() {
                    var id      = query._id;
                    var existed = has(map, id);
                    if (existed || (options && options.upsert)) map[id] = doc;
                    return { acknowledged: true, matchedCount: existed ? 1 : 0, upsertedCount: existed ? 0 : 1 };
                });
            },
            deleteOne: function(query) {
                return op(function() {
                    var id = query._id;
                    if (has(map, id)) { delete map[id]; return { deletedCount: 1 }; }
                    return { deletedCount: 0 };
                });
            },
            deleteMany: function(query) {
                return op(function() {
                    var removed = 0;
                    for (var id in map) {
                        if (has(map, id) && matches(map[id], query)) { delete map[id]; removed++; }
                    }
                    return { deletedCount: removed };
                });
            },
            find: function(query) {
                return {
                    toArray: function() {
                        return op(function() {
                            var out = [];
                            for (var id in map) {
                                if (has(map, id) && matches(map[id], query)) out.push(map[id]);
                            }
                            return out;
                        });
                    }
                };
            },
            createIndex: function(spec, options) {
                return op(function() {
                    state.indexes.push({ spec: spec, options: options || {} });
                    return (options && options.name) || 'idx';
                });
            }
        };
    }

    function MongoClient(uri, options) {
        state.uris.push(uri);
        state.clientOptions.push(options || {});
        this.connect = function() {
            state.connects++;
            return Promise.resolve(this);
        };
        this.db = function(dbName) {
            return {
                collection: function(collName) {
                    var key = dbName + '.' + collName;
                    if (!state.dbs[key]) state.dbs[key] = Object.create(null);
                    return makeCollection(state.dbs[key]);
                }
            };
        };
        this.close = function() {
            state.closes++;
            return Promise.resolve();
        };
    }

    return { driver: { MongoClient: MongoClient }, state: state };
}

/** Shorthand: real store over a fresh fake driver. */
function freshStore(connConf, fake) {
    fake = fake || createFakeMongodb();
    var store = createStore(connConf || { database: 'gina_jobs' }, 'testbundle', { driver: fake.driver });
    return { store: store, fake: fake };
}


// ─── 01. Module + instance shape ────────────────────────────────────────────

describe('job-store-mongodb § 01 — module + instance shape', function() {

    it('exports a factory function taking (connConf, bundle, injected)', function() {
        assert.equal(typeof createStore, 'function');
        // 3rd arg is the test-only driver injection (dispatcher calls with 2).
        assert.equal(createStore.length, 3);
    });

    it('builds an instance with the five seam methods + close()', function() {
        var s = freshStore();
        ['set', 'get', 'remove', 'list', 'sweep', 'close'].forEach(function(m) {
            assert.equal(typeof s.store[m], 'function', m + ' must be a function');
        });
        s.store.close();
    });
});


// ─── 02. set/get round-trip ─────────────────────────────────────────────────

describe('job-store-mongodb § 02 — set/get round-trip', function() {

    it('round-trips the full initial record shape byte-faithfully', async function() {
        var s   = freshStore();
        var rec = makeRecord('job-rt-1', { meta: { source: 'unit' } });
        var setRes = await storeSet(s.store, rec);
        assert.deepEqual(setRes, rec);
        var got = await storeGet(s.store, 'job-rt-1');
        assert.deepEqual(got, rec);
        s.store.close();
    });

    it('stores the record as a JSON string with thin indexed fields mirrored', async function() {
        var s   = freshStore();
        var rec = makeRecord('job-doc-1', { state: 'completed', expiresAt: 12345, updatedAt: 999 });
        await storeSet(s.store, rec);
        var doc = s.fake.state.dbs['gina_jobs.jobs']['job-doc-1'];
        assert.equal(typeof doc.record, 'string', 'record must ride as a JSON string');
        assert.equal(doc.state, 'completed');
        assert.equal(doc.expiresAt, 12345);
        assert.equal(doc.updatedAt, 999);
        s.store.close();
    });

    it('round-trips meta with dotted and dollar-prefixed keys (JSON-string storage dodges BSON key limits)', async function() {
        var s   = freshStore();
        var rec = makeRecord('job-keys-1', { meta: { 'a.b': 1, '$weird': 2 } });
        await storeSet(s.store, rec);
        var got = await storeGet(s.store, 'job-keys-1');
        assert.deepEqual(got.meta, { 'a.b': 1, '$weird': 2 });
        s.store.close();
    });

    it('returns null (not an error) for an unknown id', async function() {
        var s   = freshStore();
        var got = await storeGet(s.store, 'nope');
        assert.equal(got, null);
        s.store.close();
    });

    it('tolerates records gaining keys after creation (webhook fields)', async function() {
        var s   = freshStore();
        var rec = makeRecord('job-grow-1');
        await storeSet(s.store, rec);
        rec.state              = 'completed';
        rec.webhookDeliveredAt = Date.now();
        await storeSet(s.store, rec);
        var got = await storeGet(s.store, 'job-grow-1');
        assert.equal(got.state, 'completed');
        assert.equal(typeof got.webhookDeliveredAt, 'number');
        s.store.close();
    });

    it('reports a non-serialisable record through the callback, never throws', function(t, done) {
        var s   = freshStore();
        var rec = makeRecord('job-circ-1');
        rec.result = {};
        rec.result.self = rec.result; // circular — JSON.stringify must fail
        s.store.set(rec.id, rec, function(err) {
            assert.ok(err instanceof Error);
            s.store.close();
            done();
        });
    });

    it('surfaces a driver error through the callback (get and set)', function(t, done) {
        var s = freshStore();
        s.fake.state.failWith = new Error('NetworkTimeout');
        s.store.get('any', function(getErr) {
            assert.ok(getErr instanceof Error);
            assert.match(getErr.message, /NetworkTimeout/);
            s.store.set('any', makeRecord('any'), function(setErr) {
                assert.ok(setErr instanceof Error);
                s.fake.state.failWith = null;
                s.store.close();
                done();
            });
        });
    });

    it('reports a malformed stored record as an error (never silent)', function(t, done) {
        var s = freshStore();
        s.fake.state.dbs['gina_jobs.jobs'] = s.fake.state.dbs['gina_jobs.jobs'] || Object.create(null);
        s.fake.state.dbs['gina_jobs.jobs']['job-bad'] = {
            _id: 'job-bad', state: 'completed', expiresAt: null, updatedAt: 1, record: '{not valid'
        };
        s.store.get('job-bad', function(err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /could not parse/);
            s.store.close();
            done();
        });
    });
});


// ─── 03. Memory-store parity — expiry acts ONLY at sweep ────────────────────

describe('job-store-mongodb § 03 — no expiry filter on get/list (memory parity)', function() {

    it('a terminal record past expiresAt stays readable until swept', async function() {
        var s    = freshStore();
        var past = Date.now() - 60000;
        var rec  = makeRecord('job-exp-1', { state: 'completed', finishedAt: past, expiresAt: past });
        await storeSet(s.store, rec);
        var got = await storeGet(s.store, 'job-exp-1');
        assert.ok(got, 'expired-but-unswept record must still be readable (memory-store parity)');
        assert.equal(got.state, 'completed');
        var listed = await storeList(s.store, { state: 'completed' });
        assert.equal(listed.length, 1);
        await storeSweep(s.store, Date.now());
        assert.equal(await storeGet(s.store, 'job-exp-1'), null);
        s.store.close();
    });
});


// ─── 04. remove ─────────────────────────────────────────────────────────────

describe('job-store-mongodb § 04 — remove', function() {

    it('reports existed=true then existed=false', function(t, done) {
        var s = freshStore();
        s.store.set('job-rm-1', makeRecord('job-rm-1'), function() {
            s.store.remove('job-rm-1', function(e1, existed1) {
                assert.equal(e1, null);
                assert.equal(existed1, true);
                s.store.remove('job-rm-1', function(e2, existed2) {
                    assert.equal(e2, null);
                    assert.equal(existed2, false);
                    s.store.close();
                    done();
                });
            });
        });
    });
});


// ─── 05. list ───────────────────────────────────────────────────────────────

describe('job-store-mongodb § 05 — list', function() {

    it('lists all records with a null filter and filters by state', async function() {
        var s = freshStore();
        await storeSet(s.store, makeRecord('l1', { state: 'pending' }));
        await storeSet(s.store, makeRecord('l2', { state: 'completed' }));
        await storeSet(s.store, makeRecord('l3', { state: 'completed' }));
        assert.equal((await storeList(s.store, null)).length, 3);
        assert.equal((await storeList(s.store, { state: 'completed' })).length, 2);
        assert.equal((await storeList(s.store, { state: 'failed' })).length, 0);
        s.store.close();
    });
});


// ─── 06. sweep predicate matrix ─────────────────────────────────────────────

describe('job-store-mongodb § 06 — sweep predicate (terminal AND expired only)', function() {

    it('removes exactly the expired terminal records', async function() {
        var s      = freshStore();
        var past   = Date.now() - 60000;
        var future = Date.now() + 60000;
        await storeSet(s.store, makeRecord('sw-pend-exp',  { state: 'pending',   expiresAt: past }));
        await storeSet(s.store, makeRecord('sw-run',       { state: 'running' }));
        await storeSet(s.store, makeRecord('sw-done-live', { state: 'completed', expiresAt: future }));
        await storeSet(s.store, makeRecord('sw-done-exp',  { state: 'completed', expiresAt: past }));
        await storeSet(s.store, makeRecord('sw-fail-exp',  { state: 'failed',    expiresAt: past }));

        var removed = await storeSweep(s.store, Date.now());
        assert.equal(removed, 2, 'only completed-expired + failed-expired are sweepable');

        assert.ok(await storeGet(s.store, 'sw-pend-exp'),  'pending is never swept, expired or not');
        assert.ok(await storeGet(s.store, 'sw-run'),       'running is never swept');
        assert.ok(await storeGet(s.store, 'sw-done-live'), 'unexpired terminal survives');
        assert.equal(await storeGet(s.store, 'sw-done-exp'), null);
        assert.equal(await storeGet(s.store, 'sw-fail-exp'), null);
        s.store.close();
    });

    it('a terminal record with a null expiresAt is never swept (type bracketing = the IS NOT NULL analog)', async function() {
        var s = freshStore();
        await storeSet(s.store, makeRecord('sw-null-exp', { state: 'completed', expiresAt: null }));
        var removed = await storeSweep(s.store, Date.now());
        assert.equal(removed, 0, 'a numeric $lte bound must not match a null expiresAt');
        assert.ok(await storeGet(s.store, 'sw-null-exp'));
        s.store.close();
    });
});


// ─── 07. Durability analog — records live server-side, not in the instance ──

describe('job-store-mongodb § 07 — records survive across store instances (shared backend)', function() {

    it('a record written by one store instance is intact in a new instance over the same backend', async function() {
        var fake   = createFakeMongodb();
        var s1     = createStore({ database: 'gina_jobs' }, 'testbundle', { driver: fake.driver });
        var rec    = makeRecord('job-dur-1', { state: 'completed', result: { answer: 42 } });
        await storeSet(s1, rec);
        s1.close();

        // Same fake state = same mongod; a fresh client/store sees the record.
        var s2  = createStore({ database: 'gina_jobs' }, 'testbundle', { driver: createFakeMongodb(fake.state).driver });
        var got = await storeGet(s2, 'job-dur-1');
        assert.deepEqual(got, rec);
        s2.close();
    });
});


// ─── 08. Integration through lib/job with the real MongoDB store ────────────

describe('job-store-mongodb § 08 — lib/job end-to-end on the MongoDB store', function() {

    beforeEach(function() {
        job.reset();
    });

    it('create → completed lands the result in the mongo-backed record (async store)', async function() {
        var s = freshStore();
        job.start({ store: s.store, sweepInterval: 0 });
        var id  = job.create(function() { return Promise.resolve('ok-result'); });
        var rec = await waitForState(id, 'completed', 2000);
        assert.equal(rec.result, 'ok-result');
        assert.equal(typeof rec.finishedAt, 'number');
        assert.equal(typeof rec.expiresAt, 'number');
        // Straight from the store, bypassing lib/job — proves where it lives.
        var raw = await storeGet(s.store, id);
        assert.equal(raw.state, 'completed');
        assert.equal(raw.result, 'ok-result');
        job.reset();
        s.store.close();
    });

    it('a failing job lands a serialised (JSON-round-trippable) error', async function() {
        var s = freshStore();
        job.start({ store: s.store, sweepInterval: 0 });
        var id  = job.create(function() { throw new Error('boom'); });
        var rec = await waitForState(id, 'failed', 2000);
        assert.ok(!(rec.error instanceof Error), 'error must be the serialised shape, not a raw Error');
        assert.equal(rec.error.message, 'boom');
        assert.doesNotThrow(function() { JSON.stringify(rec); });
        job.reset();
        s.store.close();
    });

    it('lib.job.sweep() purges the expired terminal record through the store', async function() {
        var s = freshStore();
        job.start({ store: s.store, sweepInterval: 0, ttl: 1 });
        var id = job.create(function() { return Promise.resolve('done'); });
        await waitForState(id, 'completed', 2000);
        // Force the record past its TTL, then sweep through the primitive.
        var rec = await storeGet(s.store, id);
        rec.expiresAt = Date.now() - 1;
        await storeSet(s.store, rec);
        var removed = await new Promise(function(res, rej) {
            job.sweep(function(err, n) { err ? rej(err) : res(n); });
        });
        assert.equal(removed, 1);
        assert.equal(await storeGet(s.store, id), null);
        job.reset();
        s.store.close();
    });
});


// ─── 09. Config resolution — the mongodb connector's own conventions ────────

describe('job-store-mongodb § 09 — config resolution', function() {

    it('throws when `database` is missing (fail-fast boot through the dispatcher)', function() {
        var fake = createFakeMongodb();
        assert.throws(function() {
            createStore({ host: '127.0.0.1' }, 'testbundle', { driver: fake.driver });
        }, /missing required `database`/);
    });

    it('a full `uri` is used verbatim (preferred over decomposed fields)', function() {
        var fake = createFakeMongodb();
        var s = createStore(
            { uri: 'mongodb://custom-host:9999/whatever', database: 'gina_jobs', host: 'ignored' },
            'testbundle', { driver: fake.driver }
        );
        assert.equal(fake.state.uris[0], 'mongodb://custom-host:9999/whatever');
        s.close();
    });

    it('composes the URI from decomposed fields with percent-encoded credentials', function() {
        var fake = createFakeMongodb();
        var s = createStore({
            host: 'db.example', port: 27018,
            username: 'u@x', password: 'p:w',
            database: 'jobs db', authSource: 'admin', replicaSet: 'rs0'
        }, 'testbundle', { driver: fake.driver });
        assert.equal(
            fake.state.uris[0],
            'mongodb://u%40x:p%3Aw@db.example:27018/jobs%20db?authSource=admin&replicaSet=rs0'
        );
        s.close();
    });

    it('defaults host/port to 127.0.0.1:27017', function() {
        var fake = createFakeMongodb();
        var s = createStore({ database: 'gina_jobs' }, 'testbundle', { driver: fake.driver });
        assert.equal(fake.state.uris[0], 'mongodb://127.0.0.1:27017/gina_jobs');
        s.close();
    });

    it('defaults the collection to `jobs` and honours a custom `collection`', async function() {
        var s = freshStore({ database: 'gina_jobs' });
        await storeSet(s.store, makeRecord('c1'));
        assert.ok(s.fake.state.dbs['gina_jobs.jobs']['c1'], 'default collection is jobs');
        s.store.close();

        var s2 = freshStore({ database: 'gina_jobs', collection: 'myjobs' });
        await storeSet(s2.store, makeRecord('c2'));
        assert.ok(s2.fake.state.dbs['gina_jobs.myjobs']['c2'], 'custom collection honoured');
        s2.store.close();
    });

    it('maps ssl:true and ssl:{...} onto driver tls options (session-store shape)', function() {
        var fakeA = createFakeMongodb();
        var a = createStore({ database: 'd', ssl: true }, 'b', { driver: fakeA.driver });
        assert.equal(fakeA.state.clientOptions[0].tls, true);
        a.close();

        var fakeB = createFakeMongodb();
        var b = createStore({ database: 'd', ssl: { ca: 'pem-here' } }, 'b', { driver: fakeB.driver });
        assert.equal(fakeB.state.clientOptions[0].tls, true);
        assert.equal(fakeB.state.clientOptions[0].ca, 'pem-here');
        b.close();
    });

    it('creates the two PLAIN secondary indexes at construction — name only, no reaping options', async function() {
        var s = freshStore();
        await tick(10); // index creation is fire-and-forget behind connect()
        var idx = s.fake.state.indexes;
        assert.equal(idx.length, 2);
        var byName = {};
        idx.forEach(function(i) { byName[i.options.name] = i; });
        assert.deepEqual(byName['jobsState'].spec,   { state: 1 });
        assert.deepEqual(byName['jobsExpires'].spec, { expiresAt: 1 });
        idx.forEach(function(i) {
            assert.deepEqual(Object.keys(i.options), ['name'],
                'index options must carry a name and nothing else — no TTL/reaping semantics');
        });
        s.store.close();
    });

    it('close() releases the client (seam-external convenience)', async function() {
        var s = freshStore();
        s.store.close();
        await tick(5);
        assert.equal(s.fake.state.closes, 1);
    });
});


// ─── 10. Source pins — mongodb store contract-critical shapes ───────────────

describe('job-store-mongodb § 10 — mongodb store source pins', function() {

    var SRC = fs.readFileSync(STORE_SOURCE, 'utf8');

    it('resolves the driver from the project node_modules (session-store precedent)', function() {
        assert.ok(SRC.indexOf("getPath('project')") > -1);
        assert.ok(SRC.indexOf('node_modules/mongodb') > -1);
    });

    it('throws an actionable error when the driver is missing', function() {
        assert.match(SRC, /mongodb is not installed/);
        assert.match(SRC, /npm install mongodb/);
    });

    it('requires the `database` field (a NAME — the mongodb connector convention)', function() {
        assert.match(SRC, /missing required `database`/);
    });

    it('get has NO expiry filter (memory-store parity — expiry acts at sweep only)', function() {
        assert.ok(SRC.indexOf('findOne({ _id: id })') > -1);
        // The session store's lag-protection operator must be absent file-wide.
        assert.ok(SRC.indexOf('$gt') < 0);
    });

    it('never configures TTL reaping on an index (would purge outside the seam)', function() {
        assert.ok(SRC.indexOf('expireAfterSeconds') < 0);
    });

    it('creates the two plain secondary indexes', function() {
        assert.match(SRC, /createIndex\(\{ state: 1 \},\s+\{ name: 'jobsState' \}\)/);
        assert.match(SRC, /createIndex\(\{ expiresAt: 1 \}, \{ name: 'jobsExpires' \}\)/);
    });

    it('stores the record as a JSON string with mirrored thin fields', function() {
        assert.match(SRC, /JSON\.stringify\(record\)/);
        assert.match(SRC, /record:\s+json/);
    });

    it('sweep deletes terminal AND expired only', function() {
        assert.match(SRC, /\$in: \[STATES\.COMPLETED, STATES\.FAILED\]/);
        assert.match(SRC, /\$lte: now/);
    });

    it('never passes the callback straight to .then (driver results must not land in the err slot)', function() {
        assert.doesNotMatch(SRC, /\.then\(fn\)/);
    });

    it('owns no timer — the primitive drives the sweep cadence', function() {
        assert.ok(SRC.indexOf('setInterval') < 0);
    });

    it('imports STATES from lib/job so the sweep predicate cannot drift', function() {
        assert.match(SRC, /require\('\.\.\/\.\.\/\.\.\/\.\.\/lib\/job\/src\/main'\)\.STATES/);
    });

    it('supports the test-only injected driver (entity-layer DI precedent)', function() {
        assert.match(SRC, /injected && injected\.driver/);
    });
});
