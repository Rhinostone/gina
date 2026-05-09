'use strict';
/**
 * ScyllaDB / Cassandra connector — ORM / entity wiring tests
 *
 * Strategy: source inspection + inline logic replicas.
 * No live ScyllaDB / Cassandra cluster, no framework bootstrap, no project required.
 * Mock client.execute() stands in for the real cassandra-driver Client.
 */
var { describe, it, before } = require('node:test');
var assert  = require('node:assert/strict');
var path    = require('path');
var fs      = require('fs');

var FW = require('../fw');
var CONNECTOR_INDEX = path.join(FW, 'core/connectors/scylladb/index.js');
var CONNECTOR_LIB   = path.join(FW, 'core/connectors/scylladb/lib/connector.js');


// ─── 01 — source: lib/connector.js ───────────────────────────────────────────

describe('01 - ScyllaDB connector: lib/connector.js source', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR_LIB, 'utf8'); });

    it('exports a ScylladbConnector constructor', function() {
        assert.ok(/function ScylladbConnector/.test(src));
        assert.ok(/module\.exports\s*=\s*ScylladbConnector/.test(src));
    });

    it('loads cassandra-driver from project node_modules (not from framework)', function() {
        assert.ok(/getPath\('project'\)/.test(src));
        assert.ok(/node_modules\/cassandra-driver/.test(src));
    });

    it('wraps cassandra-driver require in a try/catch guard', function() {
        assert.ok(/try\s*\{/.test(src));
        assert.ok(/catch\s*\(/.test(src));
    });

    it('uses new cassandra.Client() (not Pool/cluster)', function() {
        assert.ok(/new cassandra\.Client\(clientConf\)/.test(src));
    });

    it('accepts an array contactPoints config', function() {
        assert.ok(/Array\.isArray\(conf\.contactPoints\)/.test(src));
    });

    it('accepts a comma-separated contactPoints string', function() {
        assert.ok(/conf\.contactPoints\.split/.test(src));
    });

    it('falls back to host+port when contactPoints absent', function() {
        assert.ok(/conf\.host\s*\+\s*':'\s*\+\s*\(conf\.port\s*\|\|\s*9042\)/.test(src));
    });

    it('defaults contactPoints to 127.0.0.1:9042 when nothing is configured', function() {
        assert.ok(/'127\.0\.0\.1:9042'/.test(src));
    });

    it('defaults localDataCenter to datacenter1 when absent', function() {
        assert.ok(/conf\.localDataCenter\s*\|\|\s*'datacenter1'/.test(src));
    });

    it('keyspace falls back to conf.database for schema parity', function() {
        assert.ok(/conf\.keyspace\s*\|\|\s*conf\.database/.test(src));
    });

    it('uses PlainTextAuthProvider when credentials are present', function() {
        assert.ok(/cassandra\.auth\.PlainTextAuthProvider/.test(src));
    });

    it('accepts credentials object OR legacy username/password pair', function() {
        assert.ok(/conf\.credentials\s*&&\s*conf\.credentials\.username/.test(src));
        assert.ok(/conf\.username/.test(src));
    });

    it('passes ssl through as sslOptions to cassandra-driver', function() {
        assert.ok(/clientConf\.sslOptions\s*=\s*conf\.ssl/.test(src));
    });

    it('registers cluster log handler for error-level events', function() {
        assert.ok(/_conn\.on\('log'/.test(src));
    });

    it('onReady() pings via client.connect() Promise', function() {
        assert.ok(/_conn\.connect\(\)\.then/.test(src));
    });

    it('onReady() calls fn(null, conn) on success', function() {
        assert.ok(/fn\(null,\s*_conn\)/.test(src));
    });

    it('onReady() calls fn(_err, null) when init failed', function() {
        assert.ok(/fn\(_err,\s*null\)/.test(src));
    });

    it('inherits from EventEmitter', function() {
        assert.ok(/EventEmitter/.test(src));
        assert.ok(/inherits\(ScylladbConnector,\s*EventEmitter\)/.test(src));
    });

});


// ─── 02 — source: index.js ───────────────────────────────────────────────────

describe('02 - ScyllaDB connector: index.js source', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR_INDEX, 'utf8'); });

    it('exports a Scylladb constructor function', function() {
        assert.ok(/function Scylladb\(/.test(src));
        assert.ok(/module\.exports\s*=\s*Scylladb/.test(src));
    });

    it('loads EntitySuperClass from model/entity.js via getPath', function() {
        assert.ok(/\/model\/entity\.js/.test(src));
        assert.ok(/getPath\('gina'\)/.test(src));
    });

    it('loads entity JS files from models/<database>/entities/', function() {
        assert.ok(/\/models\//.test(src));
        assert.ok(/\/entities/.test(src));
    });

    it('wires entities with inherits(Entity, EntitySuperClass)', function() {
        assert.ok(/inherits\(Entity,\s*EntitySuperClass\)/.test(src));
    });

    it('looks for cql/ directory (not n1ql/)', function() {
        assert.ok(/\/cql/.test(src));
        assert.ok(!/\/n1ql/.test(src));
    });

    it('accepts .sql file extension inside cql/ (uniform with SQL connectors)', function() {
        assert.ok(/\.sql\$/.test(src));
    });

    it('uses conn.execute() (cassandra-driver API — not conn.query)', function() {
        assert.ok(/conn\.execute\(/.test(src));
        assert.ok(!/conn\.query\(/.test(src));
    });

    it('passes prepare:true to client.execute for prepared-statement reuse', function() {
        assert.ok(/prepare\s*:\s*true/.test(src));
    });

    it('returns native Promise with .onComplete() shim from entity methods', function() {
        assert.ok(/new Promise/.test(src));
        assert.ok(/\.onComplete\s*=\s*function/.test(src));
    });

    it('reads SELECT rows from result.rows', function() {
        assert.ok(/result\.rows/.test(src));
    });

    it('detects LWT statements (IF NOT EXISTS / IF condition)', function() {
        assert.ok(src.indexOf('isLWT') > -1);
        assert.ok(/\[applied\]/.test(src));
    });

    it('supports @return {object} coercion', function() {
        assert.ok(/returnType\s*===\s*'object'/.test(src));
    });

    it('supports @return {boolean} coercion', function() {
        assert.ok(/returnType\s*===\s*'boolean'/.test(src));
    });

    it('supports @return {number} COUNT(*) extraction', function() {
        assert.ok(/returnType\s*===\s*'number'/.test(src));
        assert.ok(/\.toNumber\(\)/.test(src));
    });

    it('annotates entity prototype with model/bundle/database/_collection', function() {
        assert.ok(/Entity\.prototype\.model\s*=/.test(src));
        assert.ok(/Entity\.prototype\.bundle\s*=/.test(src));
        assert.ok(/Entity\.prototype\.database\s*=/.test(src));
        assert.ok(/Entity\.prototype\._collection\s*=/.test(src));
    });

    it('sets _scope from infos.scope or NODE_SCOPE env var', function() {
        assert.ok(/Entity\.prototype\._scope\s*=\s*infos\.scope/.test(src));
        assert.ok(/NODE_SCOPE/.test(src));
    });

    it('has existsSync guard for missing cql/ directory', function() {
        assert.ok(/fs\.existsSync\(cqlDir\)/.test(src));
    });

    it('trigger prefix is CQL: for dev logging', function() {
        assert.ok(/'CQL:'/.test(src));
    });

    it('QI _queryEntry uses type CQL and connector scylladb', function() {
        assert.ok(/type\s*:\s*'CQL'/.test(src));
        assert.ok(/connector\s*:\s*'scylladb'/.test(src));
    });

    it('castParam handles uuid/timeuuid as String coercion', function() {
        assert.ok(/case 'uuid'/.test(src));
        assert.ok(/case 'timeuuid'/.test(src));
    });

    it('castParam handles timestamp as Date coercion', function() {
        assert.ok(/case 'timestamp'/.test(src));
        assert.ok(/new Date\(value\)/.test(src));
    });

    it('appends source path to error message for traceability', function() {
        assert.ok(/err\.message\s*=\s*'\[\s*'\s*\+\s*source/.test(src));
    });

});


// ─── 03 — ScylladbConnector logic (mock cassandra-driver) ────────────────────

describe('03 - ScylladbConnector logic', function() {

    // Replicate the onReady logic inline using a mock cassandra Client.
    // client.connect() returns a Promise; the wrapper wires its .then/.catch
    // to fn(null, conn) / fn(err, null).
    var makeOnReady = function(mockClient, initErr) {
        var _conn = mockClient;
        var _err  = initErr || null;
        return function(fn) {
            if (_err) return fn(_err, null);
            _conn.connect().then(function() {
                fn(null, _conn);
            }).catch(function(err) {
                fn(new Error('[ScylladbConnector] Connection failed: ' + err.message), null);
            });
        };
    };

    it('onReady calls fn(null, client) when client.connect() resolves', function(_, done) {
        var mockClient = {
            _name  : 'testks',
            connect: function() { return Promise.resolve(); }
        };
        var onReady = makeOnReady(mockClient, null);
        onReady(function(err, conn) {
            assert.equal(err, null);
            assert.strictEqual(conn, mockClient);
            done();
        });
    });

    it('onReady calls fn(err, null) when client.connect() rejects', function(_, done) {
        var mockClient = {
            connect: function() { return Promise.reject(new Error('NoHostAvailable')); }
        };
        var onReady = makeOnReady(mockClient, null);
        onReady(function(err, conn) {
            assert.ok(err instanceof Error);
            assert.ok(/Connection failed/.test(err.message));
            assert.equal(conn, null);
            done();
        });
    });

    it('onReady calls fn(_err, null) when init failed (e.g. cassandra-driver missing)', function(_, done) {
        var initErr = new Error('[ScylladbConnector] cassandra-driver is not installed');
        var onReady = makeOnReady(null, initErr);
        onReady(function(err, conn) {
            assert.strictEqual(err, initErr);
            assert.equal(conn, null);
            done();
        });
    });

    it('contactPoints array config is preserved as-is', function() {
        var configured = ['10.0.0.1:9042', '10.0.0.2:9042'];
        var resolved   = Array.isArray(configured) ? configured.slice() : [];
        assert.deepEqual(resolved, configured);
    });

    it('contactPoints comma-separated string is split', function() {
        var configured = 'node1:9042,node2:9042';
        var resolved   = configured.split(/\s*,\s*/);
        assert.deepEqual(resolved, ['node1:9042', 'node2:9042']);
    });

    it('host+port composes a single contactPoint when contactPoints absent', function() {
        var conf       = { host: 'db.local', port: 9043 };
        var contactPts = [ conf.host + ':' + (conf.port || 9042) ];
        assert.deepEqual(contactPts, ['db.local:9043']);
    });

    it('default port is 9042 when host given without port', function() {
        var conf       = { host: 'db.local' };
        var contactPts = [ conf.host + ':' + (conf.port || 9042) ];
        assert.deepEqual(contactPts, ['db.local:9042']);
    });

    it('credentials object takes priority over legacy username/password', function() {
        var conf = {
            credentials: { username: 'cassandra', password: 'cs' },
            username   : 'legacy',
            password   : 'lg'
        };
        var creds = (conf.credentials && conf.credentials.username)
            ? conf.credentials
            : (conf.username ? { username: conf.username, password: conf.password || '' } : null);
        assert.equal(creds.username, 'cassandra');
    });

    it('legacy username/password is used when no credentials object', function() {
        var conf = { username: 'cassandra', password: 'cs' };
        var creds = (conf.credentials && conf.credentials.username)
            ? conf.credentials
            : (conf.username ? { username: conf.username, password: conf.password || '' } : null);
        assert.equal(creds.username, 'cassandra');
        assert.equal(creds.password, 'cs');
    });

    it('null credentials when neither shape is configured', function() {
        var conf = {};
        var creds = (conf.credentials && conf.credentials.username)
            ? conf.credentials
            : (conf.username ? { username: conf.username, password: conf.password || '' } : null);
        assert.equal(creds, null);
    });

});


// ─── 04 — coerce() return-type logic ─────────────────────────────────────────

describe('04 - ScyllaDB coerce() — return-type coercions', function() {

    // Replicate the coerce() function from index.js. cassandra-driver wraps
    // ResultSet as { rows, rowLength, info }. Writes return rows: [] unless
    // they are LWT (IF NOT EXISTS / IF condition) — those return rows: [{ '[applied]': bool }].
    var makeCoerce = function(queryString, returnType) {
        var isSELECT = /^\s*SELECT\b/i.test(queryString);
        var isLWT    = /\bIF\s+(NOT\s+)?EXISTS\b/i.test(queryString) || /\bIF\s+\w+\s*=/i.test(queryString);
        return function coerce(result) {
            if (isSELECT) {
                var rows = result.rows || [];
                if (returnType === 'object')  return (rows.length > 0) ? rows[0] : null;
                if (returnType === 'boolean') return rows.length > 0;
                if (returnType === 'number' && /count\s*\(/i.test(queryString)) {
                    if (rows.length > 0 && typeof rows[0] === 'object') {
                        var keys = Object.keys(rows[0]);
                        if (keys.length === 0) return 0;
                        var v = rows[0][keys[0]];
                        return (v && typeof v.toNumber === 'function') ? v.toNumber() : Number(v);
                    }
                    return 0;
                }
                return rows.length > 0 ? rows : null;
            }
            if (isLWT) {
                var lwtRows = result.rows || [];
                var applied = (lwtRows.length > 0 && lwtRows[0]['[applied]'] === true);
                if (returnType === 'boolean') return applied;
                return applied ? lwtRows[0] : null;
            }
            if (returnType === 'boolean') return true;
            return null;
        };
    };

    var cqlResult = function(rows) {
        return { rows: rows || [], rowLength: (rows || []).length, info: {} };
    };

    // SELECT coercions ────────────────────────────────────────────────────────

    it('@return {object} — returns first row when rows non-empty', function() {
        var coerce = makeCoerce('SELECT * FROM users WHERE id = ?', 'object');
        var row = { id: 'a', name: 'Alice' };
        assert.deepEqual(coerce(cqlResult([row])), row);
    });

    it('@return {object} — returns null when rows empty', function() {
        var coerce = makeCoerce('SELECT * FROM users WHERE id = ?', 'object');
        assert.equal(coerce(cqlResult([])), null);
    });

    it('no annotation — returns all rows when non-empty (default SELECT)', function() {
        var coerce = makeCoerce('SELECT * FROM users', null);
        var rows = [{ id: 'a' }, { id: 'b' }];
        assert.deepEqual(coerce(cqlResult(rows)), rows);
    });

    it('no annotation — returns null when SELECT rows empty', function() {
        var coerce = makeCoerce('SELECT * FROM users', null);
        assert.equal(coerce(cqlResult([])), null);
    });

    it('@return {boolean} — returns true when SELECT rows exist', function() {
        var coerce = makeCoerce('SELECT id FROM users WHERE name = ?', 'boolean');
        assert.equal(coerce(cqlResult([{ id: 'a' }])), true);
    });

    it('@return {boolean} — returns false when SELECT no rows', function() {
        var coerce = makeCoerce('SELECT id FROM users WHERE name = ?', 'boolean');
        assert.equal(coerce(cqlResult([])), false);
    });

    it('@return {number} — extracts COUNT(*) value as a Number', function() {
        var coerce = makeCoerce('SELECT COUNT(*) AS cnt FROM users', 'number');
        assert.equal(coerce(cqlResult([{ cnt: 7 }])), 7);
        assert.equal(typeof coerce(cqlResult([{ cnt: 7 }])), 'number');
    });

    it('@return {number} — Long.toNumber() is invoked when bigint', function() {
        var coerce = makeCoerce('SELECT COUNT(*) AS cnt FROM users', 'number');
        var Long = { toNumber: function() { return 12345; } };
        assert.equal(coerce(cqlResult([{ cnt: Long }])), 12345);
    });

    it('@return {number} COUNT — returns 0 when rows empty', function() {
        var coerce = makeCoerce('SELECT COUNT(*) AS cnt FROM users', 'number');
        assert.equal(coerce(cqlResult([])), 0);
    });

    // Write op coercions ──────────────────────────────────────────────────────

    it('INSERT default — returns null (CQL writes have empty result)', function() {
        var coerce = makeCoerce('INSERT INTO users (id, name) VALUES (?, ?)', null);
        assert.equal(coerce(cqlResult([])), null);
    });

    it('UPDATE default — returns null', function() {
        var coerce = makeCoerce('UPDATE users SET name = ? WHERE id = ?', null);
        assert.equal(coerce(cqlResult([])), null);
    });

    it('DELETE @return {boolean} — true on unconditional write', function() {
        var coerce = makeCoerce('DELETE FROM users WHERE id = ?', 'boolean');
        assert.equal(coerce(cqlResult([])), true);
    });

    // LWT coercions ───────────────────────────────────────────────────────────

    it('LWT IF NOT EXISTS @return {boolean} — true when [applied] is true', function() {
        var coerce = makeCoerce('INSERT INTO users (id) VALUES (?) IF NOT EXISTS', 'boolean');
        assert.equal(coerce(cqlResult([{ '[applied]': true }])), true);
    });

    it('LWT IF NOT EXISTS @return {boolean} — false when [applied] is false', function() {
        var coerce = makeCoerce('INSERT INTO users (id) VALUES (?) IF NOT EXISTS', 'boolean');
        assert.equal(coerce(cqlResult([{ '[applied]': false, id: 'existing' }])), false);
    });

    it('LWT no annotation — returns full row when applied', function() {
        var coerce = makeCoerce('UPDATE users SET name=? WHERE id=? IF version=?', null);
        var row    = { '[applied]': true, version: 2 };
        assert.deepEqual(coerce(cqlResult([row])), row);
    });

    it('LWT no annotation — returns null when not applied', function() {
        var coerce = makeCoerce('UPDATE users SET name=? WHERE id=? IF version=?', null);
        assert.equal(coerce(cqlResult([{ '[applied]': false }])), null);
    });

});


// ─── 05 — entity method Promise and .onComplete() with mock conn ─────────────

describe('05 - ScyllaDB entity method — Promise and .onComplete() pattern', function() {

    // Replicate the method-generation closure from index.js (cassandra-driver
    // is Promise-native — resolution happens in client.execute(...).then(...)).
    var makeMethod = function(mockExecute, queryString, returnType) {
        var isSELECT = /^\s*SELECT\b/i.test(queryString);

        var coerce = function(result) {
            if (isSELECT) {
                var rows = result.rows || [];
                if (returnType === 'object')  return rows.length > 0 ? rows[0] : null;
                if (returnType === 'boolean') return rows.length > 0;
                return rows.length > 0 ? rows : null;
            }
            if (returnType === 'boolean') return true;
            return null;
        };

        return function() {
            var args = Array.prototype.slice.call(arguments);
            var _mainCallback = null;
            if (typeof args[args.length - 1] === 'function') {
                _mainCallback = args.pop();
            }

            if (_mainCallback === null) {
                var _resolve, _reject, _internalData;
                var _promise = new Promise(function(resolve, reject) {
                    _resolve = resolve;
                    _reject  = reject;
                });
                _promise.onComplete = function(cb) {
                    _promise.then(
                        function()    { cb(null, _internalData); },
                        function(err) { cb(err); }
                    );
                    return _promise;
                };
                mockExecute(queryString, args).then(function(result) {
                    var raw = coerce(result);
                    _internalData = raw;
                    _resolve(raw);
                }).catch(function(err) {
                    _reject(err);
                });
                return _promise;
            } else {
                mockExecute(queryString, args).then(function(result) {
                    _mainCallback(null, coerce(result));
                }).catch(function(err) {
                    _mainCallback(err);
                });
            }
        };
    };

    var cqlResult = function(rows) {
        return { rows: rows || [], rowLength: (rows || []).length, info: {} };
    };

    it('returns a Promise when no callback is provided', function() {
        var execute = function() { return Promise.resolve(cqlResult([])); };
        var method = makeMethod(execute, 'SELECT 1', null);
        assert.ok(method() instanceof Promise);
    });

    it('returned Promise has .onComplete() attached', function() {
        var execute = function() { return Promise.resolve(cqlResult([])); };
        var method = makeMethod(execute, 'SELECT 1', null);
        assert.equal(typeof method().onComplete, 'function');
    });

    it('.onComplete(cb) receives (null, data) on success', function(_, done) {
        var row = { id: 'a' };
        var execute = function() { return Promise.resolve(cqlResult([row])); };
        var method = makeMethod(execute, 'SELECT * FROM users WHERE id = ?', 'object');
        method('a').onComplete(function(err, data) {
            assert.equal(err, null);
            assert.deepEqual(data, row);
            done();
        });
    });

    it('.onComplete(cb) receives (err) when execute fails', function(_, done) {
        var execute = function() { return Promise.reject(new Error('Unconfigured table users')); };
        var method = makeMethod(execute, 'SELECT * FROM users', 'object');
        method().onComplete(function(err) {
            assert.ok(err instanceof Error);
            assert.ok(/Unconfigured table/.test(err.message));
            done();
        });
    });

    it('await resolves with coerced result', function(_, done) {
        var rows = [{ id: 'a' }, { id: 'b' }];
        var execute = function() { return Promise.resolve(cqlResult(rows)); };
        var method = makeMethod(execute, 'SELECT * FROM users', null);
        method().then(function(data) {
            assert.deepEqual(data, rows);
            done();
        });
    });

    it('direct callback path calls cb(null, data) on success', function(_, done) {
        var execute = function() { return Promise.resolve(cqlResult([{ id: 'a' }])); };
        var method = makeMethod(execute, 'SELECT id FROM users WHERE name = ?', 'object');
        method('Alice', function(err, data) {
            assert.equal(err, null);
            assert.deepEqual(data, { id: 'a' });
            done();
        });
    });

    it('direct callback path calls cb(err) on failure', function(_, done) {
        var execute = function() { return Promise.reject(new Error('keyspace nonexistent')); };
        var method = makeMethod(execute, 'SELECT 1', null);
        method(function(err) {
            assert.ok(err instanceof Error);
            assert.ok(/keyspace nonexistent/.test(err.message));
            done();
        });
    });

});


// ─── 06 — @param type casting ────────────────────────────────────────────────

describe('06 - ScyllaDB @param type casting', function() {

    // Replicate castParam from index.js — covers the standard CQL type set.
    var castParam = function(value, type) {
        if (value === null || typeof value === 'undefined') return value;
        switch (type) {
            case 'int':
            case 'smallint':
            case 'tinyint':
            case 'counter':
                return parseInt(value, 10);
            case 'bigint':
            case 'varint':
                return (typeof value === 'bigint') ? value : parseInt(value, 10);
            case 'decimal':
            case 'double':
            case 'float':
                return (typeof value === 'number') ? value
                    : parseFloat(String(value).replace(/,/, '.'));
            case 'boolean':
                return /^true$/i.test(String(value));
            case 'text':
            case 'varchar':
            case 'ascii':
            case 'inet':
            case 'uuid':
            case 'timeuuid':
                return String(value);
            case 'timestamp':
                return (value instanceof Date) ? value : new Date(value);
            default:
                return value;
        }
    };

    it('int — coerces string to integer', function() {
        assert.strictEqual(castParam('42', 'int'), 42);
        assert.strictEqual(typeof castParam('42', 'int'), 'number');
    });

    it('smallint / tinyint — same parseInt path', function() {
        assert.strictEqual(castParam('7', 'smallint'), 7);
        assert.strictEqual(castParam('3', 'tinyint'), 3);
    });

    it('bigint — preserves BigInt literal when given', function() {
        var big = 9007199254740993n;
        assert.strictEqual(castParam(big, 'bigint'), big);
    });

    it('bigint — falls back to parseInt for string input', function() {
        assert.strictEqual(castParam('123', 'bigint'), 123);
    });

    it('decimal/double/float — accepts comma decimal separator', function() {
        assert.strictEqual(castParam('3,14', 'double'), 3.14);
        assert.strictEqual(castParam('2,5', 'float'), 2.5);
    });

    it('boolean — case-insensitive string check', function() {
        assert.strictEqual(castParam('true', 'boolean'), true);
        assert.strictEqual(castParam('TRUE', 'boolean'), true);
        assert.strictEqual(castParam('false', 'boolean'), false);
        assert.strictEqual(castParam(0, 'boolean'), false);
    });

    it('text/varchar/uuid/timeuuid — String coercion', function() {
        assert.strictEqual(castParam(42, 'text'), '42');
        assert.strictEqual(castParam(42, 'varchar'), '42');
        assert.strictEqual(castParam('a-uuid', 'uuid'), 'a-uuid');
        assert.strictEqual(castParam('a-tuuid', 'timeuuid'), 'a-tuuid');
    });

    it('inet — String coercion', function() {
        assert.strictEqual(castParam('127.0.0.1', 'inet'), '127.0.0.1');
    });

    it('timestamp — Date instance preserved', function() {
        var d = new Date('2026-01-01T00:00:00Z');
        assert.strictEqual(castParam(d, 'timestamp'), d);
    });

    it('timestamp — string ISO converted to Date', function() {
        var result = castParam('2026-01-01T00:00:00Z', 'timestamp');
        assert.ok(result instanceof Date);
        assert.equal(result.getUTCFullYear(), 2026);
    });

    it('unknown type — passthrough', function() {
        var ipAddr = { address: '::1' };
        assert.strictEqual(castParam(ipAddr, 'list<text>'), ipAddr);
    });

    it('null/undefined values pass through any type', function() {
        assert.strictEqual(castParam(null, 'int'), null);
        assert.strictEqual(castParam(undefined, 'text'), undefined);
    });

});
