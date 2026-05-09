'use strict';
/**
 * MongoDB session store — source inspection + pure-logic replicas
 *
 * Strategy: read session-store.js as source and assert structural/safety
 * invariants; replicate the get/set/touch/destroy/length/clear/all bodies
 * inline against a mock mongodb collection to verify behaviour.
 *
 * Critical invariant (mirrors #CB-BUG-4 / scylladb #13.6): write methods
 * that resolve via Promise must call `fn(null)` explicitly inside `.then()`,
 * never `.then(fn)` directly — the resolved UpdateResult / DeleteResult
 * would be treated as the err arg by express-session.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW    = require('../fw');
var STORE = path.join(FW, 'core/connectors/mongodb/lib/session-store.js');


// ─── 01 — source: factory + driver loading ───────────────────────────────────

describe('01 - MongodbStore: factory + driver loading', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE, 'utf8'); });

    it('exports a factory taking (session, bundle)', function() {
        assert.ok(/module\.exports\s*=\s*function\(session,\s*bundle\)/.test(src));
    });

    it('factory returns MongodbStore constructor', function() {
        assert.ok(/function MongodbStore\(options\)/.test(src));
        assert.ok(/return MongodbStore/.test(src));
    });

    it('inherits from express-session Store via __proto__ chain', function() {
        assert.ok(/MongodbStore\.prototype\.__proto__\s*=\s*Store\.prototype/.test(src));
    });

    it('calls Store.call(this, options) in the constructor', function() {
        assert.ok(/Store\.call\(this,\s*options\)/.test(src));
    });

    it('loads mongodb from project node_modules (not framework)', function() {
        assert.ok(/getPath\('project'\)/.test(src));
        assert.ok(/node_modules\/mongodb/.test(src));
    });

    it('throws actionable error when mongodb is missing', function() {
        assert.ok(/mongodb is not installed/.test(src));
        assert.ok(/npm install mongodb/.test(src));
    });

    it('reads connectors.json config at factory-call time (not at require time)', function() {
        assert.ok(/getConfig\(\)\[bundle\]\[env\]/.test(src));
        assert.ok(/conf\.content\.connectors\[connName\]/.test(src));
    });

    it('connName comes from session.name (set by caller before new MongodbStore())', function() {
        assert.ok(/connName\s*=\s*session\.name/.test(src));
    });

    it('default ttl is 86400 (one day) when not configured', function() {
        assert.ok(/var oneDay\s*=\s*86400/.test(src));
    });

    it('default collection is "sessions" when not configured', function() {
        assert.ok(/connConf\.collection\s*\|\|\s*'sessions'/.test(src));
    });

    it('database field is required — throws when absent', function() {
        assert.ok(/missing required `database` field/.test(src));
    });

    it('emits connect / disconnect on the store EventEmitter', function() {
        assert.ok(/store\.emit\('connect'\)/.test(src));
        assert.ok(/store\.emit\('disconnect'\)/.test(src));
    });

    it('builds collection reference synchronously (driver queues until connect)', function() {
        assert.ok(/this\._db\s*=\s*this\.client\.db\(dbName\)/.test(src));
        assert.ok(/this\._coll\s*=\s*this\._db\.collection\(this\.collection\)/.test(src));
    });
});


// ─── 02 — source: API surface (express-session contract) ─────────────────────

describe('02 - MongodbStore: API surface', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE, 'utf8'); });

    it('declares get(sid, fn)', function() {
        assert.ok(/MongodbStore\.prototype\.get\s*=\s*function\(sid,\s*fn\)/.test(src));
    });

    it('declares set(sid, sess, fn)', function() {
        assert.ok(/MongodbStore\.prototype\.set\s*=\s*function\(sid,\s*sess,\s*fn\)/.test(src));
    });

    it('declares touch(sid, sess, fn)', function() {
        assert.ok(/MongodbStore\.prototype\.touch\s*=\s*function\(sid,\s*sess,\s*fn\)/.test(src));
    });

    it('declares destroy(sid, fn)', function() {
        assert.ok(/MongodbStore\.prototype\.destroy\s*=\s*function\(sid,\s*fn\)/.test(src));
    });

    it('declares length(fn)', function() {
        assert.ok(/MongodbStore\.prototype\.length\s*=\s*function\(fn\)/.test(src));
    });

    it('declares clear(fn)', function() {
        assert.ok(/MongodbStore\.prototype\.clear\s*=\s*function\(fn\)/.test(src));
    });

    it('declares all(fn)', function() {
        assert.ok(/MongodbStore\.prototype\.all\s*=\s*function\(fn\)/.test(src));
    });

    it('declares _ensureTTL(fn) for lazy TTL index creation', function() {
        assert.ok(/MongodbStore\.prototype\._ensureTTL\s*=\s*function\(fn\)/.test(src));
    });

    it('get() filters on _id AND expiresAt > now (TTL monitor lag protection)', function() {
        assert.ok(/findOne\(\{\s*_id:\s*sid,\s*expiresAt:\s*\{\s*\$gt:\s*new Date\(\)\s*\}\s*\}\)/.test(src));
    });

    it('set() upserts via replaceOne with upsert:true', function() {
        assert.ok(/replaceOne\(/.test(src));
        assert.ok(/upsert:\s*true/.test(src));
    });

    it('touch() updates only sess + expiresAt via $set', function() {
        assert.ok(/updateOne\(/.test(src));
        assert.ok(/\$set:\s*\{\s*sess:\s*data,\s*expiresAt:\s*expiresAt\s*\}/.test(src));
    });

    it('destroy() uses deleteOne({_id: sid})', function() {
        assert.ok(/deleteOne\(\{\s*_id:\s*sid\s*\}\)/.test(src));
    });

    it('length() filters on expiresAt > now (counts active only)', function() {
        assert.ok(/countDocuments\(\{\s*expiresAt:\s*\{\s*\$gt:\s*new Date\(\)\s*\}\s*\}\)/.test(src));
    });

    it('clear() uses deleteMany({}) (preserves TTL index — mirrors TRUNCATE intent)', function() {
        assert.ok(/deleteMany\(\{\}\)/.test(src));
    });

    it('all() uses find({expiresAt: {$gt: now}}).toArray()', function() {
        assert.ok(/find\(\{\s*expiresAt:\s*\{\s*\$gt:\s*new Date\(\)\s*\}\s*\}\)\.toArray\(\)/.test(src));
    });

    it('TTL index spec is {expiresAt: 1} with expireAfterSeconds: 0', function() {
        assert.ok(/createIndex\(/.test(src));
        assert.ok(/\{\s*expiresAt:\s*1\s*\}/.test(src));
        assert.ok(/expireAfterSeconds:\s*0/.test(src));
        assert.ok(/name:\s*'sessionsExpiresTTL'/.test(src));
    });
});


// ─── 03 — source: safe callback pattern in write methods ─────────────────────

describe('03 - MongodbStore: safe Promise → callback pattern', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE, 'utf8'); });

    var bodyOf = function(name) {
        var start = src.indexOf('MongodbStore.prototype.' + name);
        if (start < 0) return '';
        var nextProto = src.indexOf('MongodbStore.prototype.', start + 1);
        return src.slice(start, nextProto > start ? nextProto : src.length);
    };

    it('set() does not use .then(fn) directly (would forward UpdateResult as err)', function() {
        var body = bodyOf('set').replace(/\/\/[^\n]*/g, '');
        assert.ok(!/\.then\(fn\)/.test(body));
    });

    it('set() calls fn(null) explicitly on success', function() {
        assert.ok(/fn\s*&&\s*fn\(null\)/.test(bodyOf('set')));
    });

    it('set() calls fn(err) in .catch()', function() {
        assert.ok(/fn\s*&&\s*fn\(err\)/.test(bodyOf('set')));
    });

    it('touch() does not use .then(fn) directly', function() {
        var body = bodyOf('touch').replace(/\/\/[^\n]*/g, '');
        assert.ok(!/\.then\(fn\)/.test(body));
    });

    it('touch() calls fn(null) explicitly on success', function() {
        assert.ok(/fn\s*&&\s*fn\(null\)/.test(bodyOf('touch')));
    });

    it('touch() calls fn(err) in .catch()', function() {
        assert.ok(/fn\s*&&\s*fn\(err\)/.test(bodyOf('touch')));
    });

    it('destroy() does not use .then(fn) directly', function() {
        var body = bodyOf('destroy').replace(/\/\/[^\n]*/g, '');
        assert.ok(!/\.then\(fn\)/.test(body));
    });

    it('destroy() calls fn(null) explicitly on success', function() {
        assert.ok(/fn\s*&&\s*fn\(null\)/.test(bodyOf('destroy')));
    });

    it('destroy() calls fn(err) in .catch()', function() {
        assert.ok(/fn\s*&&\s*fn\(err\)/.test(bodyOf('destroy')));
    });

    it('clear() calls fn(null) explicitly on success', function() {
        assert.ok(/fn\s*&&\s*fn\(null\)/.test(bodyOf('clear')));
    });

    it('clear() calls fn(err) in .catch()', function() {
        assert.ok(/fn\s*&&\s*fn\(err\)/.test(bodyOf('clear')));
    });
});


// ─── 04 — pure logic: get() with mocked collection ───────────────────────────

describe('04 - MongodbStore.get — pure logic', function() {

    var makeGet = function(mockFindOne) {
        var noop = function() {};
        return function get(sid, fn) {
            if ('function' !== typeof fn) fn = noop;
            mockFindOne({ _id: sid, expiresAt: { $gt: new Date() } }).then(function(doc) {
                if (!doc) return fn(null, null);
                try { fn(null, JSON.parse(doc.sess)); }
                catch (parseErr) { fn(parseErr); }
            }).catch(function(err) { fn(err); });
        };
    };

    it('get(sid) → cb(null, parsedSession) on hit', function(_, done) {
        var sess     = { user: 'alice', cookie: { maxAge: 86400000 } };
        var findOne  = function() { return Promise.resolve({ sess: JSON.stringify(sess) }); };
        var get      = makeGet(findOne);
        get('s1', function(err, data) {
            assert.equal(err, null);
            assert.deepEqual(data, sess);
            done();
        });
    });

    it('get(sid) → cb(null, null) on miss', function(_, done) {
        var findOne = function() { return Promise.resolve(null); };
        var get     = makeGet(findOne);
        get('missing', function(err, data) {
            assert.equal(err, null);
            assert.equal(data, null);
            done();
        });
    });

    it('get(sid) → cb(err) on driver error', function(_, done) {
        var findOne = function() { return Promise.reject(new Error('NetworkTimeout')); };
        var get     = makeGet(findOne);
        get('s1', function(err) {
            assert.ok(err instanceof Error);
            assert.ok(/NetworkTimeout/.test(err.message));
            done();
        });
    });

    it('get(sid) → cb(parseErr) when sess field is malformed JSON', function(_, done) {
        var findOne = function() { return Promise.resolve({ sess: '{not valid' }); };
        var get     = makeGet(findOne);
        get('s1', function(err) {
            assert.ok(err instanceof Error);
            done();
        });
    });

    it('get() filter passed to findOne includes expiresAt > now (lag protection)', function(_, done) {
        var captured;
        var findOne = function(filter) { captured = filter; return Promise.resolve(null); };
        var get     = makeGet(findOne);
        get('s1', function() {
            assert.equal(captured._id, 's1');
            assert.ok(captured.expiresAt && captured.expiresAt.$gt instanceof Date);
            done();
        });
    });
});


// ─── 05 — pure logic: set() / touch() / TTL index ────────────────────────────

describe('05 - MongodbStore.set / touch / TTL index — pure logic', function() {

    var oneDay = 86400;

    var makeSet = function(captured, ttl, ensureTTL, replaceOne) {
        var noop = function() {};
        return function set(sid, sess, fn) {
            if ('function' !== typeof fn) fn = noop;
            var maxAge = sess.cookie && sess.cookie.maxAge;
            var ttlSec = ttl || ('number' === typeof maxAge ? maxAge / 1000 | 0 : oneDay);
            if (ttlSec > 0) sess.lastModified = new Date().toISOString();
            var data      = JSON.stringify(sess);
            var expiresAt = new Date(Date.now() + ~~ttlSec * 1000);
            ensureTTL(function(ttlErr) {
                if (ttlErr) return fn && fn(ttlErr);
                captured.filter   = { _id: sid };
                captured.doc      = { _id: sid, sess: data, expiresAt: expiresAt };
                captured.options  = { upsert: true };
                captured.ttlSec   = ttlSec;
                replaceOne(captured.filter, captured.doc, captured.options)
                    .then(function() { fn && fn(null); })
                    .catch(function(err) { fn && fn(err); });
            });
        };
    };

    it('set() upserts {_id, sess, expiresAt} with options.upsert=true', function(_, done) {
        var captured   = {};
        var ensureTTL  = function(cb) { cb(null); };
        var replaceOne = function() { return Promise.resolve({ acknowledged: true }); };
        var set        = makeSet(captured, 3600, ensureTTL, replaceOne);
        set('s1', { cookie: {} }, function(err) {
            assert.equal(err, null);
            assert.equal(captured.filter._id, 's1');
            assert.equal(captured.options.upsert, true);
            assert.ok(captured.doc.expiresAt instanceof Date);
            assert.equal(captured.ttlSec, 3600);
            done();
        });
    });

    it('set() derives TTL from cookie.maxAge (ms → seconds) when ttl option is absent', function(_, done) {
        var captured   = {};
        var ensureTTL  = function(cb) { cb(null); };
        var replaceOne = function() { return Promise.resolve({}); };
        var set        = makeSet(captured, null, ensureTTL, replaceOne);
        set('s1', { cookie: { maxAge: 7200000 } }, function() {
            assert.equal(captured.ttlSec, 7200);
            done();
        });
    });

    it('set() falls back to one-day TTL when neither config nor cookie.maxAge', function(_, done) {
        var captured   = {};
        var ensureTTL  = function(cb) { cb(null); };
        var replaceOne = function() { return Promise.resolve({}); };
        var set        = makeSet(captured, null, ensureTTL, replaceOne);
        set('s1', { cookie: {} }, function() {
            assert.equal(captured.ttlSec, oneDay);
            done();
        });
    });

    it('set() stamps sess.lastModified before serialising', function(_, done) {
        var captured   = {};
        var ensureTTL  = function(cb) { cb(null); };
        var replaceOne = function() { return Promise.resolve({}); };
        var set        = makeSet(captured, 3600, ensureTTL, replaceOne);
        set('s1', { cookie: {} }, function() {
            var stored = JSON.parse(captured.doc.sess);
            assert.ok(stored.lastModified);
            assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(stored.lastModified));
            done();
        });
    });

    it('set() short-circuits with fn(ttlErr) when _ensureTTL fails', function(_, done) {
        var captured   = {};
        var ensureTTL  = function(cb) { cb(new Error('CreateIndexFailed')); };
        var replaceOne = function() { throw new Error('should not be called'); };
        var set        = makeSet(captured, 3600, ensureTTL, replaceOne);
        set('s1', { cookie: {} }, function(err) {
            assert.ok(err instanceof Error);
            assert.ok(/CreateIndexFailed/.test(err.message));
            done();
        });
    });

    var makeTouch = function(captured, ttl, ensureTTL, updateOne) {
        var noop = function() {};
        return function touch(sid, sess, fn) {
            if ('function' !== typeof fn) fn = noop;
            var maxAge = sess.cookie && sess.cookie.maxAge;
            var ttlSec = ttl || ('number' === typeof maxAge ? maxAge / 1000 | 0 : oneDay);
            if (ttlSec <= 0) return fn(null);
            var data      = JSON.stringify(sess);
            var expiresAt = new Date(Date.now() + ~~ttlSec * 1000);
            ensureTTL(function(ttlErr) {
                if (ttlErr) return fn && fn(ttlErr);
                captured.filter = { _id: sid };
                captured.update = { $set: { sess: data, expiresAt: expiresAt } };
                updateOne(captured.filter, captured.update)
                    .then(function() { fn && fn(null); })
                    .catch(function(err) { fn && fn(err); });
            });
        };
    };

    it('touch() updates only sess + expiresAt via $set', function(_, done) {
        var captured  = {};
        var ensureTTL = function(cb) { cb(null); };
        var updateOne = function() { return Promise.resolve({}); };
        var touch     = makeTouch(captured, 1800, ensureTTL, updateOne);
        touch('s1', { cookie: {}, user: 'bob' }, function(err) {
            assert.equal(err, null);
            assert.equal(captured.filter._id, 's1');
            assert.ok(captured.update.$set.sess);
            assert.ok(captured.update.$set.expiresAt instanceof Date);
            done();
        });
    });

    it('touch() short-circuits with fn(null) when computed ttl is non-positive', function(_, done) {
        var captured  = {};
        var ensureTTL = function() { throw new Error('should not be called'); };
        var updateOne = function() { throw new Error('should not be called'); };
        var touch     = makeTouch(captured, null, ensureTTL, updateOne);
        touch('s1', { cookie: { maxAge: -1000 } }, function(err) {
            assert.equal(err, null);
            assert.equal(captured.filter, undefined);
            done();
        });
    });
});


// ─── 06 — pure logic: destroy / length / clear / all ─────────────────────────

describe('06 - MongodbStore.destroy / length / clear / all — pure logic', function() {

    it('destroy() emits deleteOne({_id: sid}) and calls fn(null)', function(_, done) {
        var captured;
        var deleteOne = function(filter) {
            captured = filter;
            return Promise.resolve({ acknowledged: true, deletedCount: 1 });
        };
        var destroy = function(sid, fn) {
            deleteOne({ _id: sid })
                .then(function() { fn(null); })
                .catch(function(err) { fn(err); });
        };
        destroy('gone', function(err) {
            assert.equal(err, null);
            assert.deepEqual(captured, { _id: 'gone' });
            done();
        });
    });

    it('length() returns count from countDocuments({expiresAt: {$gt: now}})', function(_, done) {
        var captured;
        var countDocuments = function(filter) {
            captured = filter;
            return Promise.resolve(42);
        };
        var lengthFn = function(fn) {
            countDocuments({ expiresAt: { $gt: new Date() } })
                .then(function(count) { fn(null, count); })
                .catch(function(err) { fn(err); });
        };
        lengthFn(function(err, count) {
            assert.equal(err, null);
            assert.equal(count, 42);
            assert.ok(captured.expiresAt && captured.expiresAt.$gt instanceof Date);
            done();
        });
    });

    it('length() returns 0 when no active sessions', function(_, done) {
        var countDocuments = function() { return Promise.resolve(0); };
        var lengthFn       = function(fn) {
            countDocuments({}).then(function(count) { fn(null, count); }).catch(function(err) { fn(err); });
        };
        lengthFn(function(err, count) {
            assert.equal(count, 0);
            done();
        });
    });

    it('clear() emits deleteMany({}) and calls fn(null)', function(_, done) {
        var captured;
        var deleteMany = function(filter) {
            captured = filter;
            return Promise.resolve({ acknowledged: true, deletedCount: 5 });
        };
        var clear = function(fn) {
            deleteMany({})
                .then(function() { fn(null); })
                .catch(function(err) { fn(err); });
        };
        clear(function(err) {
            assert.equal(err, null);
            assert.deepEqual(captured, {});
            done();
        });
    });

    it('all() returns a hash of _id → parsedSession', function(_, done) {
        var docs = [
            { _id: 's1', sess: JSON.stringify({ user: 'alice' }) },
            { _id: 's2', sess: JSON.stringify({ user: 'bob' }) }
        ];
        var find = function() {
            return { toArray: function() { return Promise.resolve(docs); } };
        };
        var all = function(fn) {
            find({ expiresAt: { $gt: new Date() } }).toArray().then(function(ds) {
                var out = {};
                for (var i = 0; i < ds.length; i++) {
                    try { out[ds[i]._id] = JSON.parse(ds[i].sess); }
                    catch (_e) { /* skip */ }
                }
                fn(null, out);
            }).catch(function(err) { fn(err); });
        };
        all(function(err, sessions) {
            assert.equal(err, null);
            assert.deepEqual(sessions, { s1: { user: 'alice' }, s2: { user: 'bob' } });
            done();
        });
    });

    it('all() skips malformed docs silently', function(_, done) {
        var docs = [
            { _id: 'good', sess: JSON.stringify({ user: 'alice' }) },
            { _id: 'bad',  sess: '{not valid' }
        ];
        var find = function() {
            return { toArray: function() { return Promise.resolve(docs); } };
        };
        var all = function(fn) {
            find({}).toArray().then(function(ds) {
                var out = {};
                for (var i = 0; i < ds.length; i++) {
                    try { out[ds[i]._id] = JSON.parse(ds[i].sess); }
                    catch (_e) { /* skip */ }
                }
                fn(null, out);
            }).catch(function(err) { fn(err); });
        };
        all(function(err, sessions) {
            assert.equal(err, null);
            assert.deepEqual(sessions, { good: { user: 'alice' } });
            done();
        });
    });

    it('_ensureTTL: createIndex spec is {expiresAt: 1} with expireAfterSeconds: 0', function(_, done) {
        var capturedSpec;
        var capturedOpts;
        var createIndex = function(spec, opts) {
            capturedSpec = spec;
            capturedOpts = opts;
            return Promise.resolve('sessionsExpiresTTL');
        };
        var ensureTTL = function(fn) {
            createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'sessionsExpiresTTL' })
                .then(function() { fn(null); })
                .catch(function(err) { fn(err); });
        };
        ensureTTL(function(err) {
            assert.equal(err, null);
            assert.deepEqual(capturedSpec, { expiresAt: 1 });
            assert.equal(capturedOpts.expireAfterSeconds, 0);
            assert.equal(capturedOpts.name, 'sessionsExpiresTTL');
            done();
        });
    });

    it('_ensureTTL warns-and-continues on IndexOptionsConflict (operator intent wins)', function(_, done) {
        var conflict = new Error('Index already exists with different options');
        conflict.codeName = 'IndexOptionsConflict';
        conflict.code     = 85;
        var createIndex = function() { return Promise.reject(conflict); };
        var warned      = false;
        var ensureTTL = function(fn) {
            createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
                .then(function() { fn(null); })
                .catch(function(err) {
                    if (err && (err.codeName === 'IndexOptionsConflict' || err.code === 85)) {
                        warned = true;
                        return fn(null);
                    }
                    fn(err);
                });
        };
        ensureTTL(function(err) {
            assert.equal(err, null);
            assert.equal(warned, true);
            done();
        });
    });
});
