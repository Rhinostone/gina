/**
 * Redis connector — no-op boot-scan satisfier (core/connectors/redis/lib/connector.js).
 *
 * The model layer loads `core/connectors/<type>/lib/connector.js` for EVERY
 * connectors.json entry at bundle boot and treats a missing file as fatal
 * (`model#ready` fires with an Error → `process.exit(1)` in the boot path).
 * The redis connector had no such file, so ANY redis entry — the documented
 * session-store configuration included — aborted the boot at the scan.
 *
 * Covers:
 *   - Behavioral: the connector satisfies exactly what `core/model/index.js`'s
 *     `connect()` needs — `new Connector(conf)`, an EventEmitter `.on()`
 *     surface (the connector-lifecycle Inspector bridge attaches a 'ready'
 *     listener), and a synchronous `onReady(fn)` firing `fn(null, null)`
 *     (the sqlite connector's sync-onReady precedent; no connection opened).
 *   - Source pins: no driver require (the entry must boot before the driver
 *     package is installed), no client construction / connection attempt.
 *
 * Run: node --test test/lib/redis-connector-noop.test.js
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var EventEmitter = require('events').EventEmitter;

var FW        = require('../fw');
var CONNECTOR = path.join(FW, 'core/connectors/redis/lib/connector.js');

var RedisConnector = require(CONNECTOR);


describe('redis-connector-noop § 01 — shape', function() {

    it('exports a constructor taking the connectors.json entry', function() {
        assert.equal(typeof RedisConnector, 'function');
        assert.equal(RedisConnector.length, 1);
    });

    it('instances are EventEmitters (the model layer attaches a ready listener)', function() {
        var c = new RedisConnector({ host: '127.0.0.1' });
        assert.ok(c instanceof EventEmitter);
        assert.doesNotThrow(function() {
            c.on('ready', function() {});
        });
    });

    it('exposes the connectors.json entry for introspection', function() {
        var conf = { host: 'redis.example', port: 6380 };
        var c = new RedisConnector(conf);
        assert.deepEqual(c.conf, conf);
        assert.deepEqual(new RedisConnector().conf, {}, 'a missing conf defaults to {}');
    });
});


describe('redis-connector-noop § 02 — onReady contract', function() {

    it('fires the callback SYNCHRONOUSLY with (null, null) — no connection is opened', function() {
        var c = new RedisConnector({});
        var calledSync = false;
        var gotErr, gotConn;
        c.onReady(function(err, conn) {
            calledSync = true;
            gotErr  = err;
            gotConn = conn;
        });
        assert.equal(calledSync, true, 'must fire in-line (sqlite sync-onReady precedent)');
        assert.equal(gotErr, null);
        assert.equal(gotConn, null);
    });

    it('replicates the model layer\'s connect() flow without error (listener + onReady)', function() {
        // Mirrors core/model/index.js `connect()`: construct, attach the
        // lifecycle 'ready' listener, then register the ready callback.
        var connector = new RedisConnector({ host: '127.0.0.1', port: 6379 });
        connector.on('ready', function() {});
        var outcome = null;
        connector.onReady(function(err, conn) {
            outcome = { err: err, conn: conn };
        });
        assert.deepEqual(outcome, { err: null, conn: null });
    });
});


describe('redis-connector-noop § 03 — source pins', function() {

    var SRC = fs.readFileSync(CONNECTOR, 'utf8');

    it('requires NO driver — the entry must pass the boot scan before any driver is installed', function() {
        assert.doesNotMatch(SRC, /require\('ioredis'\)|require\("ioredis"\)/);
        assert.doesNotMatch(SRC, /require\('redis'\)|require\("redis"\)/);
    });

    it('opens NO connection (no client construction, no dial)', function() {
        assert.doesNotMatch(SRC, /new Redis\(|\.connect\(/);
    });

    it('reports ready synchronously through onReady', function() {
        assert.match(SRC, /this\.onReady\s*=\s*function\s*\(fn\)\s*\{\s*\n?\s*fn\(null,\s*null\);/);
    });
});
