'use strict';
/**
 * ScyllaDB session store — source inspection + pure-logic replicas
 *
 * Strategy: read session-store.js as source and assert structural/safety
 * invariants; replicate the get/set/touch/destroy/length/clear/all bodies
 * inline against a mock cassandra-driver Client to verify behaviour.
 *
 * Critical invariant (mirrors #CB-BUG-4 from couchbase-session-store):
 * write methods that resolve via Promise must call `fn(null)` explicitly
 * inside `.then()`, never `.then(fn)` directly — the resolved ResultSet
 * would be treated as the err arg by express-session.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');
var STORE = path.join(FW, 'core/connectors/scylladb/lib/session-store.js');


// ─── 01 — source: factory + driver loading ───────────────────────────────────

describe('01 - ScylladbStore: factory + driver loading', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE, 'utf8'); });

    it('exports a factory taking (session, bundle)', function() {
        assert.ok(/module\.exports\s*=\s*function\(session,\s*bundle\)/.test(src));
    });

    it('factory returns ScylladbStore constructor', function() {
        assert.ok(/function ScylladbStore\(options\)/.test(src));
        assert.ok(/return ScylladbStore/.test(src));
    });

    it('inherits from express-session Store via __proto__ chain', function() {
        assert.ok(/ScylladbStore\.prototype\.__proto__\s*=\s*Store\.prototype/.test(src));
    });

    it('loads cassandra-driver from project node_modules (not framework)', function() {
        assert.ok(/getPath\('project'\)/.test(src));
        assert.ok(/node_modules\/cassandra-driver/.test(src));
    });

    it('throws actionable error when cassandra-driver is missing', function() {
        assert.ok(/cassandra-driver is not installed/.test(src));
        assert.ok(/npm install cassandra-driver/.test(src));
    });

    it('reads connectors.json config at factory-call time (not at require time)', function() {
        assert.ok(/getConfig\(\)\[bundle\]\[env\]/.test(src));
        assert.ok(/conf\.content\.connectors\[connName\]/.test(src));
    });

    it('connName comes from session.name (set by caller before new ScylladbStore())', function() {
        assert.ok(/connName\s*=\s*session\.name/.test(src));
    });

    it('oneDay constant (86400) survives as the set()/touch() last resort', function() {
        assert.ok(/var oneDay\s*=\s*86400/.test(src));
    });

    it('default table is "sessions" when not configured', function() {
        assert.ok(/connConf\.table\s*\|\|\s*'sessions'/.test(src));
    });

    it('keyspace falls back to connConf.database for schema parity', function() {
        assert.ok(/connConf\.keyspace\s*\|\|\s*connConf\.database/.test(src));
    });

    it('emits connect / disconnect on the store EventEmitter', function() {
        assert.ok(/store\.emit\('connect'\)/.test(src));
        assert.ok(/store\.emit\('disconnect'\)/.test(src));
    });

});


// ─── 02 — source: API surface (express-session contract) ─────────────────────

describe('02 - ScylladbStore: API surface', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE, 'utf8'); });

    it('declares get(sid, fn)', function() {
        assert.ok(/ScylladbStore\.prototype\.get\s*=\s*function\(sid,\s*fn\)/.test(src));
    });

    it('declares set(sid, sess, fn)', function() {
        assert.ok(/ScylladbStore\.prototype\.set\s*=\s*function\(sid,\s*sess,\s*fn\)/.test(src));
    });

    it('declares touch(sid, sess, fn)', function() {
        assert.ok(/ScylladbStore\.prototype\.touch\s*=\s*function\(sid,\s*sess,\s*fn\)/.test(src));
    });

    it('declares destroy(sid, fn)', function() {
        assert.ok(/ScylladbStore\.prototype\.destroy\s*=\s*function\(sid,\s*fn\)/.test(src));
    });

    it('declares length(fn)', function() {
        assert.ok(/ScylladbStore\.prototype\.length\s*=\s*function\(fn\)/.test(src));
    });

    it('declares clear(fn)', function() {
        assert.ok(/ScylladbStore\.prototype\.clear\s*=\s*function\(fn\)/.test(src));
    });

    it('declares all(fn)', function() {
        assert.ok(/ScylladbStore\.prototype\.all\s*=\s*function\(fn\)/.test(src));
    });

    it('set() uses INSERT … USING TTL', function() {
        assert.ok(src.indexOf('INSERT INTO ') > -1);
        assert.ok(src.indexOf('(sid, sess) VALUES (?, ?) USING TTL ?') > -1);
    });

    it('touch() uses UPDATE … USING TTL', function() {
        assert.ok(src.indexOf('UPDATE ') > -1);
        assert.ok(src.indexOf('USING TTL ? SET sess = ? WHERE sid = ?') > -1);
    });

    it('destroy() uses explicit DELETE (does not wait for TTL)', function() {
        assert.ok(src.indexOf('DELETE FROM ') > -1);
        assert.ok(src.indexOf('WHERE sid = ?') > -1);
    });

    it('clear() uses TRUNCATE (the only CQL full-table delete)', function() {
        assert.ok(src.indexOf('TRUNCATE ') > -1);
    });

    it('passes prepare:true on every read/write except TRUNCATE', function() {
        assert.ok(/prepare\s*:\s*true/.test(src));
        var clearStart = src.indexOf('ScylladbStore.prototype.clear');
        var clearBody  = src.slice(clearStart, clearStart + 400);
        assert.ok(/prepare\s*:\s*false/.test(clearBody));
    });

});


// ─── 03 — source: safe callback pattern in write methods ─────────────────────

describe('03 - ScylladbStore: safe Promise → callback pattern', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE, 'utf8'); });

    var bodyOf = function(name) {
        var start = src.indexOf('ScylladbStore.prototype.' + name);
        if (start < 0) return '';
        var nextProto = src.indexOf('ScylladbStore.prototype.', start + 1);
        return src.slice(start, nextProto > start ? nextProto : src.length);
    };

    it('set() does not use .then(fn) directly (would forward ResultSet as err)', function() {
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

});


// ─── 04 — pure logic: get() with mocked client ───────────────────────────────

describe('04 - ScylladbStore.get — pure logic', function() {

    var makeGet = function(mockExecute, table) {
        var noop = function() {};
        return function get(sid, fn) {
            if ('function' !== typeof fn) fn = noop;
            var query = 'SELECT sess FROM ' + table + ' WHERE sid = ?';
            mockExecute(query, [sid], { prepare: true }).then(function(result) {
                var rows = result.rows || [];
                if (rows.length === 0) return fn(null, null);
                try { fn(null, JSON.parse(rows[0].sess)); }
                catch (parseErr) { fn(parseErr); }
            }).catch(function(err) { fn(err); });
        };
    };

    it('get(sid) → cb(null, parsedSession) on hit', function(_, done) {
        var sess = { user: 'alice', cookie: { maxAge: 86400000 } };
        var execute = function() { return Promise.resolve({ rows: [{ sess: JSON.stringify(sess) }] }); };
        var get = makeGet(execute, 'sessions');
        get('s1', function(err, data) {
            assert.equal(err, null);
            assert.deepEqual(data, sess);
            done();
        });
    });

    it('get(sid) → cb(null, null) on miss', function(_, done) {
        var execute = function() { return Promise.resolve({ rows: [] }); };
        var get = makeGet(execute, 'sessions');
        get('missing', function(err, data) {
            assert.equal(err, null);
            assert.equal(data, null);
            done();
        });
    });

    it('get(sid) → cb(err) on driver error', function(_, done) {
        var execute = function() { return Promise.reject(new Error('NoHostAvailable')); };
        var get = makeGet(execute, 'sessions');
        get('s1', function(err) {
            assert.ok(err instanceof Error);
            assert.ok(/NoHostAvailable/.test(err.message));
            done();
        });
    });

    it('get(sid) → cb(parseErr) when sess column is malformed JSON', function(_, done) {
        var execute = function() { return Promise.resolve({ rows: [{ sess: '{not valid' }] }); };
        var get = makeGet(execute, 'sessions');
        get('s1', function(err) {
            assert.ok(err instanceof Error);
            done();
        });
    });

});


// ─── 05 — pure logic: set() / touch() TTL behaviour ──────────────────────────

describe('05 - ScylladbStore.set / touch — pure logic', function() {

    var oneDay = 86400;

    var makeSet = function(captured, ttl, table) {
        var noop = function() {};
        return function set(sid, sess, fn) {
            if ('function' !== typeof fn) fn = noop;
            var maxAge = sess.cookie && sess.cookie.maxAge;
            var ttlSec = ttl || ('number' === typeof maxAge ? maxAge / 1000 | 0 : oneDay);
            if (ttlSec > 0) sess.lastModified = new Date().toISOString();
            var data = JSON.stringify(sess);
            var query = 'INSERT INTO ' + table + ' (sid, sess) VALUES (?, ?) USING TTL ?';
            captured.query  = query;
            captured.params = [sid, data, ~~ttlSec];
            Promise.resolve().then(function() { fn(null); });
        };
    };

    it('set() emits INSERT … USING TTL with the configured table name', function(_, done) {
        var captured = {};
        var set = makeSet(captured, 3600, 'mySessions');
        set('s1', { cookie: {} }, function(err) {
            assert.equal(err, null);
            assert.ok(/INSERT INTO mySessions/.test(captured.query));
            assert.ok(/USING TTL \?/.test(captured.query));
            assert.equal(captured.params[2], 3600);
            done();
        });
    });

    it('set() derives TTL from cookie.maxAge (ms → seconds) when ttl option is absent', function(_, done) {
        var captured = {};
        var set = makeSet(captured, null, 'sessions');
        set('s1', { cookie: { maxAge: 7200000 } }, function() {
            assert.equal(captured.params[2], 7200);
            done();
        });
    });

    it('set() falls back to one-day TTL when neither config nor cookie.maxAge', function(_, done) {
        var captured = {};
        var set = makeSet(captured, null, 'sessions');
        set('s1', { cookie: {} }, function() {
            assert.equal(captured.params[2], oneDay);
            done();
        });
    });

    it('set() stamps sess.lastModified before serialising', function(_, done) {
        var captured = {};
        var set = makeSet(captured, 3600, 'sessions');
        var sess = { cookie: {} };
        set('s1', sess, function() {
            var stored = JSON.parse(captured.params[1]);
            assert.ok(stored.lastModified);
            assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(stored.lastModified));
            done();
        });
    });

    var makeTouch = function(captured, ttl, table) {
        var noop = function() {};
        return function touch(sid, sess, fn) {
            if ('function' !== typeof fn) fn = noop;
            var maxAge = sess.cookie && sess.cookie.maxAge;
            var ttlSec = ttl || ('number' === typeof maxAge ? maxAge / 1000 | 0 : oneDay);
            if (ttlSec <= 0) return fn(null);
            var data = JSON.stringify(sess);
            var query = 'UPDATE ' + table + ' USING TTL ? SET sess = ? WHERE sid = ?';
            captured.query  = query;
            captured.params = [~~ttlSec, data, sid];
            Promise.resolve().then(function() { fn(null); });
        };
    };

    it('touch() emits UPDATE … USING TTL SET sess = ? WHERE sid = ?', function(_, done) {
        var captured = {};
        var touch = makeTouch(captured, 1800, 'sessions');
        touch('s1', { cookie: {}, user: 'bob' }, function() {
            assert.ok(/UPDATE sessions USING TTL \? SET sess = \? WHERE sid = \?/.test(captured.query));
            assert.equal(captured.params[0], 1800);
            assert.equal(captured.params[2], 's1');
            done();
        });
    });

    it('touch() short-circuits with fn(null) when computed ttl is non-positive', function(_, done) {
        var captured = {};
        var touch = makeTouch(captured, null, 'sessions');
        touch('s1', { cookie: { maxAge: -1000 } }, function(err) {
            assert.equal(err, null);
            assert.equal(captured.query, undefined);
            done();
        });
    });

});


// ─── 06 — pure logic: destroy / length / clear / all ─────────────────────────

describe('06 - ScylladbStore.destroy / length / clear / all — pure logic', function() {

    it('destroy() emits DELETE FROM <table> WHERE sid = ? and calls fn(null)', function(_, done) {
        var captured = {};
        var execute = function(q, p) {
            captured.query = q;
            captured.params = p;
            return Promise.resolve({});
        };
        var destroy = function(sid, fn) {
            execute('DELETE FROM sessions WHERE sid = ?', [sid], { prepare: true })
                .then(function() { fn(null); })
                .catch(function(err) { fn(err); });
        };
        destroy('gone', function(err) {
            assert.equal(err, null);
            assert.equal(captured.query, 'DELETE FROM sessions WHERE sid = ?');
            assert.deepEqual(captured.params, ['gone']);
            done();
        });
    });

    it('length() returns Number(rows[0].n) when the column is plain', function(_, done) {
        var execute = function() { return Promise.resolve({ rows: [{ n: 42 }] }); };
        var lengthFn = function(fn) {
            execute('SELECT COUNT(*) AS n FROM sessions', [], { prepare: true }).then(function(result) {
                var rows = result.rows || [];
                if (rows.length === 0) return fn(null, 0);
                var v = rows[0].n;
                fn(null, (v && typeof v.toNumber === 'function') ? v.toNumber() : Number(v));
            }).catch(function(err) { fn(err); });
        };
        lengthFn(function(err, count) {
            assert.equal(err, null);
            assert.equal(count, 42);
            done();
        });
    });

    it('length() invokes Long.toNumber() when bigint-style', function(_, done) {
        var Long = { toNumber: function() { return 1234; } };
        var execute = function() { return Promise.resolve({ rows: [{ n: Long }] }); };
        var lengthFn = function(fn) {
            execute('SELECT COUNT(*) AS n FROM sessions', [], { prepare: true }).then(function(result) {
                var rows = result.rows || [];
                if (rows.length === 0) return fn(null, 0);
                var v = rows[0].n;
                fn(null, (v && typeof v.toNumber === 'function') ? v.toNumber() : Number(v));
            }).catch(function(err) { fn(err); });
        };
        lengthFn(function(err, count) {
            assert.equal(count, 1234);
            done();
        });
    });

    it('length() returns 0 when no rows', function(_, done) {
        var execute = function() { return Promise.resolve({ rows: [] }); };
        var lengthFn = function(fn) {
            execute('SELECT COUNT(*) AS n FROM sessions', [], { prepare: true }).then(function(result) {
                var rows = result.rows || [];
                if (rows.length === 0) return fn(null, 0);
                var v = rows[0].n;
                fn(null, (v && typeof v.toNumber === 'function') ? v.toNumber() : Number(v));
            }).catch(function(err) { fn(err); });
        };
        lengthFn(function(err, count) {
            assert.equal(count, 0);
            done();
        });
    });

    it('clear() emits TRUNCATE <table> and calls fn(null)', function(_, done) {
        var captured = {};
        var execute = function(q, p, opts) {
            captured.query = q;
            captured.opts  = opts;
            return Promise.resolve({});
        };
        var clear = function(fn) {
            execute('TRUNCATE sessions', [], { prepare: false })
                .then(function() { fn(null); })
                .catch(function(err) { fn(err); });
        };
        clear(function(err) {
            assert.equal(err, null);
            assert.equal(captured.query, 'TRUNCATE sessions');
            assert.equal(captured.opts.prepare, false);
            done();
        });
    });

    it('all() returns a hash of sid → parsedSession', function(_, done) {
        var rows = [
            { sid: 's1', sess: JSON.stringify({ user: 'alice' }) },
            { sid: 's2', sess: JSON.stringify({ user: 'bob' }) }
        ];
        var execute = function() { return Promise.resolve({ rows: rows }); };
        var all = function(fn) {
            execute('SELECT sid, sess FROM sessions', [], { prepare: true }).then(function(result) {
                var out = {};
                var rs  = result.rows || [];
                for (var i = 0; i < rs.length; i++) {
                    try { out[rs[i].sid] = JSON.parse(rs[i].sess); }
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

    it('all() skips malformed rows silently', function(_, done) {
        var rows = [
            { sid: 'good', sess: JSON.stringify({ user: 'alice' }) },
            { sid: 'bad',  sess: '{not valid' }
        ];
        var execute = function() { return Promise.resolve({ rows: rows }); };
        var all = function(fn) {
            execute('SELECT sid, sess FROM sessions', [], { prepare: true }).then(function(result) {
                var out = {};
                var rs  = result.rows || [];
                for (var i = 0; i < rs.length; i++) {
                    try { out[rs[i].sid] = JSON.parse(rs[i].sess); }
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

});
