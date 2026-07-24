'use strict';
/**
 * MongoDB connector — ORM / entity wiring tests
 *
 * Strategy: source inspection + inline logic replicas.
 * No live MongoDB cluster, no framework bootstrap, no project required.
 * Mock collection methods stand in for the real mongodb driver.
 */
var { describe, it, before } = require('node:test');
var assert  = require('node:assert/strict');
var path    = require('path');
var fs      = require('fs');

var FW = require('../fw');
var CONNECTOR_INDEX  = path.join(FW, 'core/connectors/mongodb/index.js');
var CONNECTOR_LIB    = path.join(FW, 'core/connectors/mongodb/lib/connector.js');
var PIPELINE_LOADER  = path.join(FW, 'core/connectors/mongodb/lib/pipeline-loader.js');


// ─── 01 — source: lib/connector.js ───────────────────────────────────────────

describe('01 - MongoDB connector: lib/connector.js source', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR_LIB, 'utf8'); });

    it('exports a MongodbConnector constructor', function() {
        assert.ok(/function MongodbConnector/.test(src));
        assert.ok(/module\.exports\s*=\s*MongodbConnector/.test(src));
    });

    it('loads mongodb from project node_modules (not from framework)', function() {
        assert.ok(/getPath\('project'\)/.test(src));
        assert.ok(/node_modules\/mongodb/.test(src));
    });

    it('wraps mongodb require in a try/catch guard', function() {
        assert.ok(/try\s*\{/.test(src));
        assert.ok(/catch\s*\(/.test(src));
    });

    it('uses new mongodb.MongoClient (not Pool/cluster)', function() {
        assert.ok(/new mongodb\.MongoClient\(uri,\s*clientOptions\)/.test(src));
    });

    it('accepts conf.uri as the preferred connection string', function() {
        assert.ok(/if\s*\(conf\.uri\)\s*\{/.test(src));
    });

    it('decomposes host+port+username+password when uri absent', function() {
        assert.ok(/var host = conf\.host/.test(src));
        assert.ok(/var port = conf\.port/.test(src));
    });

    it('defaults host to 127.0.0.1 when absent', function() {
        assert.ok(/conf\.host\s*\|\|\s*'127\.0\.0\.1'/.test(src));
    });

    it('defaults port to 27017 when absent', function() {
        assert.ok(/conf\.port\s*\|\|\s*27017/.test(src));
    });

    it('requires conf.database — emits clear error when missing', function() {
        assert.ok(/_dbName = conf\.database/.test(src));
        assert.ok(/missing required `database` field/.test(src));
    });

    it('url-encodes username and password to handle special characters', function() {
        assert.ok(/encodeURIComponent\(conf\.username\)/.test(src));
        assert.ok(/encodeURIComponent\(conf\.password\)/.test(src));
    });

    it('appends authSource to the URI query string when present', function() {
        assert.ok(/'authSource='/.test(src));
        assert.ok(/encodeURIComponent\(conf\.authSource\)/.test(src));
    });

    it('appends replicaSet to the URI query string when present', function() {
        assert.ok(/'replicaSet='/.test(src));
        assert.ok(/encodeURIComponent\(conf\.replicaSet\)/.test(src));
    });

    it('treats ssl=true as TLS enable (clientOptions.tls = true)', function() {
        assert.ok(/conf\.ssl === true/.test(src));
        assert.ok(/clientOptions\.tls = true/.test(src));
    });

    it('merges ssl object into clientOptions (not just true/false)', function() {
        assert.ok(/typeof conf\.ssl === 'object'/.test(src));
        assert.ok(/Object\.prototype\.hasOwnProperty\.call\(conf\.ssl, k\)/.test(src));
    });

    it('decorates client with _name for parity with other connectors', function() {
        assert.ok(/_client\._name = _dbName/.test(src));
    });

    it('onReady calls client.connect().then(...).catch(...)', function() {
        assert.ok(/this\.onReady = function\(fn\)/.test(src));
        assert.ok(/_client\.connect\(\)\.then/.test(src));
        assert.ok(/\.catch\(function\(err\)/.test(src));
    });

    it('onReady selects the db via client.db(_dbName) after connect', function() {
        assert.ok(/_db = _client\.db\(_dbName\)/.test(src));
    });

    it('onReady decorates db with _name for parity', function() {
        assert.ok(/_db\._name = _dbName/.test(src));
    });

    it('onReady yields (err, conn) callback signature', function() {
        assert.ok(/fn\(null, _db\)/.test(src));
        assert.ok(/Connection failed/.test(src));
    });

    it('onReady short-circuits with init error when present', function() {
        assert.ok(/if \(_err\) return fn\(_err, null\)/.test(src));
    });

    it('logs created and connected lifecycle events via console.debug', function() {
        var dbgCount = (src.match(/console\.debug/g) || []).length;
        assert.ok(dbgCount >= 2, 'expected >=2 console.debug calls, got ' + dbgCount);
    });

    it('inherits from EventEmitter', function() {
        assert.ok(/inherits\(MongodbConnector, EventEmitter\)/.test(src));
    });
});


// ─── 02 — source: index.js ───────────────────────────────────────────────────

describe('02 - MongoDB connector: index.js source', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR_INDEX, 'utf8'); });

    it('exports a Mongodb constructor', function() {
        assert.ok(/function Mongodb\(conn, infos\)/.test(src));
        assert.ok(/module\.exports\s*=\s*Mongodb/.test(src));
    });

    it('imports pipeline-loader as loader', function() {
        assert.ok(/var loader\s*=\s*require\('\.\/lib\/pipeline-loader'\)/.test(src));
    });

    it('imports lib registry with refreshCore-safe fallback', function() {
        assert.ok(/var lib\s*=\s*require\('\.\/\.\.\/\.\.\/\.\.\/lib'\)\s*\|\|\s*require\.cache\[require\.resolve/.test(src));
    });

    it('exposes envIsDev and isCacheless flags', function() {
        assert.ok(/var envIsDev\s*=/.test(src));
        assert.ok(/var isCacheless\s*=/.test(src));
    });

    it('loads ObjectId from the project mongodb driver (not fatal on absence)', function() {
        assert.ok(/var ObjectId/.test(src));
        assert.ok(/ObjectId = require\(driverPath\)\.ObjectId/.test(src));
        assert.ok(/ObjectId = null/.test(src));
    });

    it('walks models/<database>/entities for entity classes', function() {
        assert.ok(/'\/models\/'\s*\+\s*infos\.database\s*\+\s*'\/entities'/.test(src));
        assert.ok(/fs\.readdirSync\(entitiesPath\)/.test(src));
    });

    it('uses inherits() to wire entity to EntitySuperClass', function() {
        assert.ok(/Entity = inherits\(Entity, EntitySuperClass\)/.test(src));
    });

    it('sets prototype._collection from entity filename', function() {
        assert.ok(/Entity\.prototype\._collection = entityName/.test(src));
    });

    it('sets prototype._scope from infos.scope or NODE_SCOPE env', function() {
        assert.ok(/Entity\.prototype\._scope\s*=\s*infos\.scope\s*\|\|\s*process\.env\.NODE_SCOPE/.test(src));
    });

    it('walks models/<database>/pipelines/ for per-Entity pipeline dirs', function() {
        assert.ok(/'\/models\/'\s*\+\s*infos\.database\s*\+\s*'\/pipelines'/.test(src));
    });

    it('reads .json pipeline files (not .sql or .cql)', function() {
        assert.ok(/\\\.json\$/.test(src));
    });

    it('uses loader.parse(rawSource, scope) for pipeline parsing', function() {
        assert.ok(/loader\.parse\(rawSource, scope\s*\|\|\s*process\.env\.NODE_SCOPE\)/.test(src));
    });

    it('skips pipeline files that lack the `op` field with a clear error log', function() {
        assert.ok(/missing `op` field/.test(src));
    });

    it('builds trigger as MQL:entityName#methodName', function() {
        assert.ok(/var trigger\s*=\s*'MQL:'/.test(src));
    });

    it('flags writes via op-name regex (insert/update/delete/replace/findOneAnd*)', function() {
        assert.ok(/var isWriteOp/.test(src));
        assert.ok(/insert\|update\|delete\|replace/.test(src));
    });

    it('coerce() handles boolean/number/object/array return types', function() {
        assert.ok(/returnType === 'boolean'/.test(src));
        assert.ok(/returnType === 'number'/.test(src));
        assert.ok(/returnType === 'object'/.test(src));
        assert.ok(/returnType === 'array'/.test(src));
    });

    it('castParam handles objectid via new ObjectId(value)', function() {
        assert.ok(/case 'objectid':/.test(src));
        assert.ok(/new ObjectId\(value\)/.test(src));
    });

    it('castParam handles int/int32, long/int64, double/number, boolean, string/text, date/timestamp', function() {
        assert.ok(/case 'int':/.test(src));
        assert.ok(/case 'long':/.test(src));
        assert.ok(/case 'double':/.test(src));
        assert.ok(/case 'boolean':/.test(src));
        assert.ok(/case 'string':/.test(src));
        assert.ok(/case 'date':/.test(src));
    });

    it('resolveArgs() walks tree and replaces {$arg: N}', function() {
        assert.ok(/keys\.length === 1\s*&&\s*keys\[0\] === '\$arg'/.test(src));
    });

    it('resolveArgs() replaces {$oid: hex} via new ObjectId(...)', function() {
        assert.ok(/keys\.length === 1\s*&&\s*keys\[0\] === '\$oid'/.test(src));
        assert.ok(/new ObjectId\(node\.\$oid\)/.test(src));
    });

    it('switch covers findOne, find, aggregate, countDocuments', function() {
        assert.ok(/case 'findOne':/.test(src));
        assert.ok(/case 'find':/.test(src));
        assert.ok(/case 'aggregate':/.test(src));
        assert.ok(/case 'countDocuments':/.test(src));
    });

    it('switch covers insertOne, insertMany, updateOne, updateMany, replaceOne', function() {
        assert.ok(/case 'insertOne':/.test(src));
        assert.ok(/case 'insertMany':/.test(src));
        assert.ok(/case 'updateOne':/.test(src));
        assert.ok(/case 'updateMany':/.test(src));
        assert.ok(/case 'replaceOne':/.test(src));
    });

    it('switch covers deleteOne, deleteMany', function() {
        assert.ok(/case 'deleteOne':/.test(src));
        assert.ok(/case 'deleteMany':/.test(src));
    });

    it('default branch throws unknown-op error with source path', function() {
        assert.ok(/unknown op/.test(src));
    });

    it('returns native Promise with .onComplete(cb) when no trailing callback', function() {
        assert.ok(/var _promise = new Promise/.test(src));
        assert.ok(/_promise\.onComplete = function\(cb\)/.test(src));
    });

    it('callback path uses node-style (err, result) signature', function() {
        assert.ok(/_mainCallback\(null, raw\)/.test(src));
        // #CE1 wraps the error argument in the transient-vs-permanent classifier
        // (`_mainCallback(lib.connectorError.stamp(err))`). stamp() returns the
        // same err, so the node-style signature is unchanged — this tolerates
        // both the bare and the stamped form.
        assert.ok(/_mainCallback\((?:lib\.connectorError\.stamp\()?err\)?\)/.test(src));
    });

    it('builds _queryEntry with type:MQL and connector:mongodb', function() {
        assert.ok(/type\s*:\s*'MQL'/.test(src));
        assert.ok(/connector\s*:\s*'mongodb'/.test(src));
    });

    it('uses self._collection (not closure) for collection name lookup', function() {
        assert.ok(/conn\.collection\(self\._collection\)/.test(src));
    });

    it('decorates errors with the source file path for traceability', function() {
        assert.ok(/err\.message\s*=\s*'\[ '\s*\+\s*source\s*\+\s*' \]/.test(src));
    });
});


// ─── 03 — source: lib/pipeline-loader.js ─────────────────────────────────────

describe('03 - MongoDB pipeline-loader: source pins', function() {

    var src;
    before(function() { src = fs.readFileSync(PIPELINE_LOADER, 'utf8'); });

    it('exports parse, extractHeader, stripHeader, parseParamTypes, parseReturnType, substituteScope', function() {
        assert.ok(/parse\s*:\s*parse/.test(src));
        assert.ok(/extractHeader\s*:\s*extractHeader/.test(src));
        assert.ok(/stripHeader\s*:\s*stripHeader/.test(src));
        assert.ok(/parseParamTypes\s*:\s*parseParamTypes/.test(src));
        assert.ok(/parseReturnType\s*:\s*parseReturnType/.test(src));
        assert.ok(/substituteScope\s*:\s*substituteScope/.test(src));
    });

    it('extractHeader recognises only leading /* comments after whitespace', function() {
        assert.ok(/source\[i\] !== '\/'\s*\|\|\s*source\[i \+ 1\] !== '\*'/.test(src));
    });

    it('parseParamTypes uses /@param\\s+\\{...\\}/g globally', function() {
        assert.ok(/@param/.test(src));
        assert.ok(/header\.match\(/.test(src));
    });

    it('parseReturnType uses single-shot /@return\\s+\\{...\\}/', function() {
        assert.ok(/@return/.test(src));
    });

    it('substituteScope handles arrays AND objects recursively', function() {
        assert.ok(/Array\.isArray\(node\)/.test(src));
        assert.ok(/typeof node\[key\] === 'object'/.test(src));
    });

    it('parse throws when JSON body is empty', function() {
        assert.ok(/throw new Error\('pipeline file is empty'\)/.test(src));
    });

    it('parse calls JSON.parse on the stripped body', function() {
        assert.ok(/JSON\.parse\(json\)/.test(src));
    });
});


// ─── 04 — pipeline-loader: parse logic (live module) ─────────────────────────

describe('04 - MongoDB pipeline-loader: parse logic (live)', function() {

    var loader;
    before(function() { loader = require(PIPELINE_LOADER); });

    it('extractHeader returns the body of a leading block comment', function() {
        assert.equal(loader.extractHeader('/* hello world */{"op":"findOne"}'), ' hello world ');
    });

    it('extractHeader returns null when no leading comment', function() {
        assert.equal(loader.extractHeader('{"op":"findOne"}'), null);
    });

    it('extractHeader skips leading whitespace before the /*', function() {
        assert.equal(loader.extractHeader('   \n  /* abc */{}'), ' abc ');
    });

    it('extractHeader returns null when /* is mid-file (not leading)', function() {
        assert.equal(loader.extractHeader('{"a":1} /* not leading */'), null);
    });

    it('stripHeader removes the leading block comment, leaving the JSON', function() {
        assert.equal(loader.stripHeader('/** hi */{"op":"findOne"}').trim(), '{"op":"findOne"}');
    });

    it('stripHeader is identity when no leading comment', function() {
        var src = '{"op":"findOne"}';
        assert.equal(loader.stripHeader(src), src);
    });

    it('parseParamTypes returns lowercased types in declaration order', function() {
        var types = loader.parseParamTypes(' @param {ObjectId} id\n* @param {String} name\n* @param {Date} createdAt');
        assert.deepEqual(types, ['objectid', 'string', 'date']);
    });

    it('parseParamTypes returns [] when no @param annotations', function() {
        assert.deepEqual(loader.parseParamTypes('hello world'), []);
        assert.deepEqual(loader.parseParamTypes(null), []);
    });

    it('parseReturnType returns the lowercased single type', function() {
        assert.equal(loader.parseReturnType(' @return {Object}'), 'object');
        assert.equal(loader.parseReturnType('@return {array}'), 'array');
    });

    it('parseReturnType returns null when no @return', function() {
        assert.equal(loader.parseReturnType('@param {string} x'), null);
        assert.equal(loader.parseReturnType(null), null);
    });

    it('substituteScope replaces literal "$scope" string at top level', function() {
        var node = { scope: '$scope' };
        loader.substituteScope(node, 'local');
        assert.equal(node.scope, 'local');
    });

    it('substituteScope recurses into nested objects', function() {
        var node = { filter: { _scope: '$scope', other: 1 } };
        loader.substituteScope(node, 'beta');
        assert.equal(node.filter._scope, 'beta');
        assert.equal(node.filter.other, 1);
    });

    it('substituteScope recurses into arrays', function() {
        var node = { pipeline: [ { $match: { scope: '$scope' } }, { $limit: 10 } ] };
        loader.substituteScope(node, 'production');
        assert.equal(node.pipeline[0].$match.scope, 'production');
        assert.equal(node.pipeline[1].$limit, 10);
    });

    it('substituteScope leaves non-$scope strings alone', function() {
        var node = { foo: 'bar', baz: '$other' };
        loader.substituteScope(node, 'local');
        assert.equal(node.foo, 'bar');
        assert.equal(node.baz, '$other');
    });

    it('parse returns { paramTypes, returnType, body } object', function() {
        var src = '/**\n * @param {objectid} id\n * @return {object}\n */\n{"op":"findOne","filter":{"_id":{"$arg":0}}}';
        var p = loader.parse(src, 'local');
        assert.deepEqual(p.paramTypes, ['objectid']);
        assert.equal(p.returnType, 'object');
        assert.equal(p.body.op, 'findOne');
    });

    it('parse substitutes $scope in body at load time', function() {
        var src = '{"op":"findOne","filter":{"_scope":"$scope"}}';
        var p = loader.parse(src, 'local');
        assert.equal(p.body.filter._scope, 'local');
    });

    it('parse throws on empty body', function() {
        assert.throws(function() { loader.parse('', 'local'); }, /empty/);
        assert.throws(function() { loader.parse('/* only comment */', 'local'); }, /empty/);
    });

    it('parse propagates JSON.parse errors on malformed body', function() {
        assert.throws(function() { loader.parse('{not json', 'local'); }, SyntaxError);
    });

    it('parse leaves $arg / $oid placeholders intact (resolved at query time)', function() {
        var src = '{"op":"findOne","filter":{"_id":{"$arg":0},"u":{"$oid":"507f1f77bcf86cd799439011"}}}';
        var p = loader.parse(src, 'local');
        assert.deepEqual(p.body.filter._id, { $arg: 0 });
        assert.deepEqual(p.body.filter.u,   { $oid: '507f1f77bcf86cd799439011' });
    });
});


// ─── 05 — coerce() return-type logic (pure-logic replica) ────────────────────

describe('05 - MongoDB coerce() — return-type coercions', function() {

    function makeCoerce(returnType) {
        return function(result, isWrite) {
            if (returnType === 'boolean') {
                if (isWrite) {
                    if (!result || result.acknowledged !== true) return false;
                    if (typeof result.insertedId !== 'undefined' && result.insertedId !== null) return true;
                    if (typeof result.modifiedCount === 'number' && result.modifiedCount > 0) return true;
                    if (typeof result.deletedCount === 'number' && result.deletedCount > 0) return true;
                    if (typeof result.upsertedCount === 'number' && result.upsertedCount > 0) return true;
                    if (typeof result.matchedCount === 'number' && result.matchedCount > 0) return true;
                    return false;
                }
                return Array.isArray(result) ? result.length > 0 : !!result;
            }
            if (returnType === 'number') {
                if (typeof result === 'number') return result;
                if (Array.isArray(result)) return result.length;
                if (result && typeof result.modifiedCount === 'number') return result.modifiedCount;
                if (result && typeof result.deletedCount === 'number') return result.deletedCount;
                if (result && typeof result.insertedCount === 'number') return result.insertedCount;
                if (result && typeof result.matchedCount === 'number') return result.matchedCount;
                return 0;
            }
            if (returnType === 'object') {
                if (Array.isArray(result)) return result.length > 0 ? result[0] : null;
                return result || null;
            }
            if (returnType === 'array') {
                if (Array.isArray(result)) return result;
                return result ? [result] : [];
            }
            return result;
        };
    }

    it('object → first element from array', function() {
        var c = makeCoerce('object');
        assert.deepEqual(c([{ a: 1 }, { a: 2 }], false), { a: 1 });
    });

    it('object → null when array is empty', function() {
        assert.equal(makeCoerce('object')([], false), null);
    });

    it('object → result itself when not an array', function() {
        assert.deepEqual(makeCoerce('object')({ a: 1 }, false), { a: 1 });
    });

    it('object → null when result is falsy', function() {
        var c = makeCoerce('object');
        assert.equal(c(null, false), null);
        assert.equal(c(undefined, false), null);
    });

    it('array → array as-is', function() {
        assert.deepEqual(makeCoerce('array')([1, 2, 3], false), [1, 2, 3]);
    });

    it('array → wraps single object', function() {
        assert.deepEqual(makeCoerce('array')({ a: 1 }, false), [{ a: 1 }]);
    });

    it('array → empty when result is null/undefined', function() {
        var c = makeCoerce('array');
        assert.deepEqual(c(null, false), []);
        assert.deepEqual(c(undefined, false), []);
    });

    it('number → numeric result directly (countDocuments)', function() {
        var c = makeCoerce('number');
        assert.equal(c(42, false), 42);
        assert.equal(c(0, false), 0);
    });

    it('number → array length when given an array', function() {
        assert.equal(makeCoerce('number')([{}, {}, {}], false), 3);
    });

    it('number → modifiedCount from UpdateResult', function() {
        assert.equal(makeCoerce('number')({ acknowledged: true, modifiedCount: 5 }, true), 5);
    });

    it('number → deletedCount from DeleteResult', function() {
        assert.equal(makeCoerce('number')({ acknowledged: true, deletedCount: 3 }, true), 3);
    });

    it('number → 0 when result has no recognised numeric field', function() {
        assert.equal(makeCoerce('number')({ unrelated: 'thing' }, true), 0);
    });

    it('boolean+isWrite → false when result is null', function() {
        assert.equal(makeCoerce('boolean')(null, true), false);
    });

    it('boolean+isWrite → false when not acknowledged', function() {
        assert.equal(makeCoerce('boolean')({ acknowledged: false, insertedId: 'x' }, true), false);
    });

    it('boolean+isWrite → true on insertedId present', function() {
        assert.equal(makeCoerce('boolean')({ acknowledged: true, insertedId: 'x' }, true), true);
    });

    it('boolean+isWrite → true on modifiedCount > 0', function() {
        assert.equal(makeCoerce('boolean')({ acknowledged: true, modifiedCount: 1 }, true), true);
    });

    it('boolean+isWrite → true on deletedCount > 0', function() {
        assert.equal(makeCoerce('boolean')({ acknowledged: true, deletedCount: 1 }, true), true);
    });

    it('boolean+isWrite → false when acknowledged but nothing happened', function() {
        var c = makeCoerce('boolean');
        assert.equal(c({ acknowledged: true, modifiedCount: 0, deletedCount: 0, insertedId: null }, true), false);
    });

    it('boolean+isRead → length > 0 for arrays', function() {
        var c = makeCoerce('boolean');
        assert.equal(c([1], false), true);
        assert.equal(c([], false), false);
    });

    it('boolean+isRead → !!result for non-arrays', function() {
        var c = makeCoerce('boolean');
        assert.equal(c({ a: 1 }, false), true);
        assert.equal(c(null, false), false);
    });

    it('no returnType → raw result passes through', function() {
        var c = makeCoerce(null);
        var raw = { a: 1, b: [2, 3] };
        assert.equal(c(raw, false), raw);
    });
});


// ─── 06 — castParam() type casting (pure-logic replica) ──────────────────────

describe('06 - MongoDB castParam() — @param type casting', function() {

    function MockObjectId(value) {
        if (typeof value !== 'string') throw new Error('MockObjectId requires a string');
        this.value = value;
    }

    function makeCastParam(ObjectIdRef) {
        return function(value, type) {
            if (value === null || typeof value === 'undefined') return value;
            switch (type) {
                case 'objectid':
                    if (!ObjectIdRef) {
                        throw new Error('[Mongodb] @param {objectid} requires the mongodb driver to be installed in your project');
                    }
                    return (value instanceof ObjectIdRef) ? value : new ObjectIdRef(value);
                case 'int':
                case 'int32':
                    return parseInt(value, 10);
                case 'long':
                case 'int64':
                    return (typeof value === 'bigint') ? value : parseInt(value, 10);
                case 'double':
                case 'number':
                    return (typeof value === 'number') ? value
                        : parseFloat(String(value).replace(/,/, '.'));
                case 'boolean':
                    return /^true$/i.test(String(value));
                case 'string':
                case 'text':
                    return String(value);
                case 'date':
                case 'timestamp':
                    return (value instanceof Date) ? value : new Date(value);
                default:
                    return value;
            }
        };
    }

    it('null and undefined pass through unchanged for any type', function() {
        var cp = makeCastParam(MockObjectId);
        assert.equal(cp(null, 'objectid'), null);
        assert.equal(cp(undefined, 'int'), undefined);
        assert.equal(cp(null, 'unknown'), null);
    });

    it('objectid → wraps string in new ObjectId(...)', function() {
        var r = makeCastParam(MockObjectId)('507f1f77bcf86cd799439011', 'objectid');
        assert.ok(r instanceof MockObjectId);
        assert.equal(r.value, '507f1f77bcf86cd799439011');
    });

    it('objectid → passes through existing ObjectId instances', function() {
        var existing = new MockObjectId('507f1f77bcf86cd799439011');
        assert.equal(makeCastParam(MockObjectId)(existing, 'objectid'), existing);
    });

    it('objectid → throws when ObjectId reference is null', function() {
        assert.throws(function() { makeCastParam(null)('any', 'objectid'); }, /requires the mongodb driver/);
    });

    it('int / int32 → parses string to integer', function() {
        var cp = makeCastParam(MockObjectId);
        assert.equal(cp('42', 'int'), 42);
        assert.equal(cp('100', 'int32'), 100);
    });

    it('long / int64 → keeps bigint, otherwise parseInt', function() {
        var cp = makeCastParam(MockObjectId);
        assert.equal(cp(123n, 'long'), 123n);
        assert.equal(cp('456', 'int64'), 456);
    });

    it('double / number → parses to float, accepts comma decimal', function() {
        var cp = makeCastParam(MockObjectId);
        assert.equal(cp('3.14', 'double'), 3.14);
        assert.equal(cp('2,5', 'number'), 2.5);
        assert.equal(cp(7.7, 'double'), 7.7);
    });

    it('boolean → /^true$/i match (case-insensitive, strict)', function() {
        var cp = makeCastParam(MockObjectId);
        assert.equal(cp('true', 'boolean'), true);
        assert.equal(cp('TRUE', 'boolean'), true);
        assert.equal(cp('false', 'boolean'), false);
        assert.equal(cp('1', 'boolean'), false);
    });

    it('string / text → String(value)', function() {
        var cp = makeCastParam(MockObjectId);
        assert.equal(cp(42, 'string'), '42');
        assert.equal(cp(true, 'text'), 'true');
    });

    it('date / timestamp → Date constructor or passes through Date instance', function() {
        var cp = makeCastParam(MockObjectId);
        assert.ok(cp('2026-05-09', 'date') instanceof Date);
        var existing = new Date();
        assert.equal(cp(existing, 'timestamp'), existing);
    });

    it('unknown type → passes through unchanged', function() {
        var cp = makeCastParam(MockObjectId);
        assert.equal(cp('hello', 'mystery'), 'hello');
        assert.equal(cp(42, undefined), 42);
    });
});


// ─── 07 — resolveArgs() walking (pure-logic replica) ─────────────────────────

describe('07 - MongoDB resolveArgs() — $arg / $oid placeholder walking', function() {

    function MockObjectId(value) { this.value = value; }

    function makeResolveArgs(ObjectIdRef) {
        return function resolveArgs(node, args) {
            if (Array.isArray(node)) {
                var arrCopy = [];
                for (var i = 0; i < node.length; i++) {
                    arrCopy.push(resolveArgs(node[i], args));
                }
                return arrCopy;
            }
            if (node && typeof node === 'object') {
                var keys = Object.keys(node);
                if (keys.length === 1 && keys[0] === '$arg') {
                    var idx = node.$arg;
                    return (idx >= 0 && idx < args.length) ? args[idx] : null;
                }
                if (keys.length === 1 && keys[0] === '$oid') {
                    if (!ObjectIdRef) {
                        throw new Error('[Mongodb] {"$oid": ...} requires the mongodb driver to be installed in your project');
                    }
                    return new ObjectIdRef(node.$oid);
                }
                var objCopy = {};
                for (var k = 0; k < keys.length; k++) {
                    objCopy[keys[k]] = resolveArgs(node[keys[k]], args);
                }
                return objCopy;
            }
            return node;
        };
    }

    it('replaces {$arg: 0} with args[0]', function() {
        var out = makeResolveArgs(MockObjectId)({ filter: { _id: { $arg: 0 } } }, ['xyz']);
        assert.deepEqual(out, { filter: { _id: 'xyz' } });
    });

    it('replaces multiple $arg refs at different positions', function() {
        var out = makeResolveArgs(MockObjectId)({ filter: { name: { $arg: 0 }, age: { $arg: 1 } } }, ['Alice', 30]);
        assert.deepEqual(out, { filter: { name: 'Alice', age: 30 } });
    });

    it('returns null when $arg index out of range', function() {
        var out = makeResolveArgs(MockObjectId)({ x: { $arg: 5 } }, ['only-one']);
        assert.equal(out.x, null);
    });

    it('replaces {$oid: hex} with new ObjectId(hex)', function() {
        var out = makeResolveArgs(MockObjectId)({ uid: { $oid: 'abc123' } }, []);
        assert.ok(out.uid instanceof MockObjectId);
        assert.equal(out.uid.value, 'abc123');
    });

    it('throws when $oid encountered but ObjectId is null', function() {
        assert.throws(function() { makeResolveArgs(null)({ $oid: 'abc' }, []); }, /requires the mongodb driver/);
    });

    it('preserves nested object structure outside placeholders', function() {
        var out = makeResolveArgs(MockObjectId)({ a: { b: { c: 'leaf' } } }, []);
        assert.deepEqual(out, { a: { b: { c: 'leaf' } } });
    });

    it('walks arrays recursively', function() {
        var out = makeResolveArgs(MockObjectId)({ pipeline: [{ $match: { id: { $arg: 0 } } }, { $limit: 10 }] }, [42]);
        assert.deepEqual(out, { pipeline: [{ $match: { id: 42 } }, { $limit: 10 }] });
    });

    it('passes through primitives unchanged', function() {
        var r = makeResolveArgs(MockObjectId);
        assert.equal(r(42, []), 42);
        assert.equal(r('hello', []), 'hello');
        assert.equal(r(true, []), true);
        assert.equal(r(null, []), null);
    });

    it('does not mutate the input node (returns fresh tree)', function() {
        var r = makeResolveArgs(MockObjectId);
        var src = { filter: { _id: { $arg: 0 } } };
        var out = r(src, ['xyz']);
        assert.deepEqual(src.filter._id, { $arg: 0 });
        assert.equal(out.filter._id, 'xyz');
    });
});


// ─── 08 — source: lib/connector.js surfaces the MongoClient on the Db ─────────

describe('08 - MongoDB connector: _db._client back-reference (source pins)', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR_LIB, 'utf8'); });

    it('decorates the Db with a _client back-reference in onReady', function() {
        assert.ok(/_db\._client = _client;/.test(src), 'onReady must attach _client onto the yielded Db');
    });

    it('attaches _db._client after _db._name and before fn(null, _db)', function() {
        var nameIdx   = src.indexOf('_db._name = _dbName;');
        var clientIdx = src.indexOf('_db._client = _client;');
        var yieldIdx  = src.indexOf('fn(null, _db)');
        assert.ok(nameIdx > -1 && clientIdx > -1 && yieldIdx > -1, 'all three landmarks must be present');
        assert.ok(nameIdx < clientIdx, '_db._client must follow the existing _db._name decoration');
        assert.ok(clientIdx < yieldIdx, '_db._client must be set before the Db is yielded to the caller');
    });

    it('documents the _client back-reference in the onReady JSDoc', function() {
        assert.ok(/back-reference to the owning `MongoClient`/.test(src), 'onReady JSDoc should explain the _client decoration');
    });
});


// ─── 09 — source: index.js resolveClient helper ──────────────────────────────

describe('09 - MongoDB resolveClient: shared client resolver (source pins)', function() {

    var src, body;
    before(function() {
        src = fs.readFileSync(CONNECTOR_INDEX, 'utf8');
        // isolate the helper body: from its declaration to the next top-level `var ` def
        var start = src.indexOf('var resolveClient = function(conn) {');
        var rest  = src.slice(start + 1);
        var end   = rest.indexOf('\n    var ');
        body      = src.slice(start, end > -1 ? start + 1 + end : src.length);
    });

    it('defines a private resolveClient(conn) helper', function() {
        assert.ok(/var resolveClient = function\(conn\) \{/.test(src), 'expected a resolveClient helper');
    });

    it('reads the MongoClient off conn._client', function() {
        assert.ok(/conn && conn\._client/.test(body), 'resolveClient must read conn._client');
    });

    it('guards that the resolved handle exposes startSession()', function() {
        assert.ok(/typeof\(client\.startSession\) !== 'function'/.test(body), 'resolveClient must verify a startSession() method');
    });

    it('throws a clearly-coded error when the client cannot be resolved', function() {
        assert.ok(/GINA_MONGODB_CLIENT_UNRESOLVED/.test(body), 'expected GINA_MONGODB_CLIENT_UNRESOLVED code on the throw');
        assert.ok(/throw _err;/.test(body), 'resolveClient must throw on an unresolved client');
    });

    it('assigns the code via direct property mutation (not Object.assign)', function() {
        assert.ok(/_err\.code = 'GINA_MONGODB_CLIENT_UNRESOLVED';/.test(body), 'code assigned by direct mutation');
    });
});


// ─── 10 — source: index.js getClient public accessor ─────────────────────────

describe('10 - MongoDB getClient: public accessor wired onto entities (source pins)', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR_INDEX, 'utf8'); });

    it('defines getClient delegating to getConnection + resolveClient', function() {
        assert.ok(src.indexOf('var getClient = function() {') > -1, 'expected a getClient accessor');
        assert.ok(
            /return resolveClient\(this\.getConnection\(\)\);/.test(src),
            'getClient must resolve the client from this.getConnection()'
        );
    });

    it('is decorated onto entity prototypes', function() {
        assert.ok(
            /Entity\.prototype\.getClient\s*=\s*getClient;/.test(src),
            'entities must expose getClient'
        );
    });

    it('documents that session/transaction support depends on the project-provided driver', function() {
        var start = src.indexOf('* getClient');
        var doc   = src.slice(start, src.indexOf('var getClient = function'));
        assert.ok(/startSession\(\)/.test(doc), 'JSDoc should show the startSession() use case');
        assert.ok(/withTransaction/.test(doc), 'JSDoc should show the withTransaction() use case');
        assert.ok(/replica-set or sharded deployment/.test(doc), 'JSDoc must note the deployment requirement for multi-document transactions');
    });
});


// ─── 11 — resolveClient behaviour (pure-logic replica) ───────────────────────

describe('11 - MongoDB resolveClient — pure-logic replica', function() {

    // Mirrors framework/v*/core/connectors/mongodb/index.js resolveClient()
    // line-for-line. Kept in lockstep with the source pins in §09.
    function resolveClient(conn) {
        var client = (conn && conn._client) ? conn._client : null;

        if (!client || typeof(client.startSession) !== 'function') {
            var _err = new Error('[ CONNECTOR ][ mongodb ] Unable to resolve the MongoClient from the connection.');
            _err.code = 'GINA_MONGODB_CLIENT_UNRESOLVED';
            throw _err;
        }

        return client;
    }

    var clientStub = { startSession: function() {} };

    it('returns the client from a Db carrying a _client back-reference', function() {
        var conn = { _client: clientStub };
        assert.equal(resolveClient(conn), clientStub);
    });

    it('throws GINA_MONGODB_CLIENT_UNRESOLVED when _client is absent', function() {
        assert.throws(
            function() { resolveClient({}); },
            function(err) { return err.code === 'GINA_MONGODB_CLIENT_UNRESOLVED'; },
            'a Db with no _client must throw the named error'
        );
    });

    it('throws on a null/undefined connection', function() {
        assert.throws(function() { resolveClient(null); },      function(e) { return e.code === 'GINA_MONGODB_CLIENT_UNRESOLVED'; });
        assert.throws(function() { resolveClient(undefined); }, function(e) { return e.code === 'GINA_MONGODB_CLIENT_UNRESOLVED'; });
    });

    it('throws when the resolved handle has no startSession() method', function() {
        assert.throws(
            function() { resolveClient({ _client: {} }); },
            function(err) { return err.code === 'GINA_MONGODB_CLIENT_UNRESOLVED'; },
            'a client handle without startSession() is not usable'
        );
    });
});


// ─── 12 — getClient delegation (pure-logic replica) ──────────────────────────

describe('12 - MongoDB getClient — delegation (pure-logic replica)', function() {

    function resolveClient(conn) {
        var client = (conn && conn._client) ? conn._client : null;
        if (!client || typeof(client.startSession) !== 'function') {
            var _err = new Error('unresolved');
            _err.code = 'GINA_MONGODB_CLIENT_UNRESOLVED';
            throw _err;
        }
        return client;
    }

    // Mirrors: var getClient = function() { return resolveClient(this.getConnection()); };
    function getClient() { return resolveClient(this.getConnection()); }

    var clientStub = { startSession: function() {} };

    it('returns the client from a Db-shaped getConnection()', function() {
        var entity = { getConnection: function() { return { _client: clientStub }; }, getClient: getClient };
        assert.equal(entity.getClient(), clientStub);
    });

    it('propagates the named error when the connection yields no client', function() {
        var entity = { getConnection: function() { return {}; }, getClient: getClient };
        assert.throws(
            function() { entity.getClient(); },
            function(err) { return err.code === 'GINA_MONGODB_CLIENT_UNRESOLVED'; }
        );
    });

    it('re-reads the live connection on each call (delegates to this.getConnection)', function() {
        var calls = 0;
        var entity = { getConnection: function() { calls++; return { _client: clientStub }; }, getClient: getClient };
        entity.getClient();
        entity.getClient();
        assert.equal(calls, 2, 'getClient must re-read getConnection() on each call');
    });
});
