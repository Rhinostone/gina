'use strict';
/**
 * Couchbase connector — public SDK Cluster accessor & shared cluster resolver
 *
 * Strategy: source inspection + pure-logic replicas.
 * No live Couchbase cluster (or installed driver) is required — the connector
 * `require`s the project-provided `couchbase` module at load time, so these
 * tests read the source as text and replicate the resolver logic line-for-line.
 *
 * Feature: the connector exposes a public, non-underscore `getCluster()` on its
 * entities so consumers can reach SDK-level features the entity layer does not
 * wrap (e.g. multi-document transactions) without coupling to private `_*`
 * internals. The dual-shape cluster lookup (`conn._cluster` vs
 * `conn._scope._bucket._cluster`) is factored into a single internal
 * `resolveCluster()` helper consumed by `explainForIndexes`, `bulkInsert` and
 * `getCluster()`.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW        = require('../fw');
var CONNECTOR = path.join(FW, 'core/connectors/couchbase/index.js');


// ─── 01 — shared resolveCluster() helper present, dual-shape, named throw ────

describe('01 - resolveCluster: shared dual-shape helper (source pins)', function() {

    var src, body;
    before(function() {
        src  = fs.readFileSync(CONNECTOR, 'utf8');
        // isolate the helper body: from its declaration to the next top-level `var ` def
        var start = src.indexOf('var resolveCluster = function(conn) {');
        var rest  = src.slice(start + 1);
        var end   = rest.indexOf('\n    var ');
        body      = src.slice(start, end > -1 ? start + 1 + end : src.length);
    });

    it('declares the resolveCluster helper', function() {
        assert.ok(
            src.indexOf('var resolveCluster = function(conn) {') > -1,
            'expected a single shared resolveCluster(conn) helper'
        );
    });

    it('checks the top-level shape conn._cluster', function() {
        assert.ok(/conn\._cluster/.test(body), 'resolveCluster must check conn._cluster');
    });

    it('checks the nested shape conn._scope._bucket._cluster', function() {
        assert.ok(
            /conn\._scope\s*&&\s*conn\._scope\._bucket\s*&&\s*conn\._scope\._bucket\._cluster/.test(body),
            'resolveCluster must fall back to conn._scope._bucket._cluster with a defensive chain'
        );
    });

    it('guards that the resolved cluster exposes query()', function() {
        assert.ok(
            /typeof\(cluster\.query\)\s*!==\s*'function'/.test(body),
            'resolveCluster must reject a handle without a query() method'
        );
    });

    it('throws a clearly-coded error when neither shape resolves', function() {
        assert.ok(/GINA_COUCHBASE_CLUSTER_UNRESOLVED/.test(body), 'expected GINA_COUCHBASE_CLUSTER_UNRESOLVED code on the throw');
        assert.ok(/throw _err;/.test(body), 'resolveCluster must throw on unresolved cluster');
    });

});


// ─── 02 — explainForIndexes & bulkInsert consume the shared helper ──────────

describe('02 - consumers route through resolveCluster (source pins)', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR, 'utf8'); });

    it('explainForIndexes resolves via resolveCluster, non-fatally', function() {
        var start = src.indexOf('var explainForIndexes = function');
        var rest  = src.slice(start + 1);
        var end   = rest.indexOf('\n    var ');
        var fn    = src.slice(start, end > -1 ? start + 1 + end : src.length);
        assert.ok(/cluster\s*=\s*resolveCluster\(conn\)/.test(fn), 'explainForIndexes must call resolveCluster(conn)');
        assert.ok(/catch\s*\(_clusterErr\)/.test(fn), 'explainForIndexes must keep resolution non-fatal (try/catch + warn + return)');
        assert.ok(/return;/.test(fn), 'explainForIndexes must skip (return) on a resolution failure');
    });

    it('bulkInsert queries via resolveCluster(conn).query(...)', function() {
        assert.ok(
            src.indexOf('resolveCluster(conn).query(query, queryOptions)') > -1,
            'bulkInsert must query through the shared resolver'
        );
    });

    it('bulkInsert no longer derefs the bare nested shape at the call site', function() {
        assert.ok(
            src.indexOf('conn._scope._bucket._cluster.query(query, queryOptions)') === -1,
            'the bare conn._scope._bucket._cluster.query(...) call site must be gone (replaced by resolveCluster)'
        );
    });

});


// ─── 03 — public getCluster() accessor present and wired onto entities ──────

describe('03 - getCluster: public accessor wired onto entity surfaces (source pins)', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR, 'utf8'); });

    it('defines getCluster delegating to getConnection + resolveCluster', function() {
        assert.ok(src.indexOf('var getCluster = function() {') > -1, 'expected a getCluster accessor');
        assert.ok(
            /return resolveCluster\(this\.getConnection\(\)\);/.test(src),
            'getCluster must resolve the cluster from this.getConnection()'
        );
    });

    it('is decorated onto model entities (alongside bulkInsert)', function() {
        assert.ok(
            /Entity\.prototype\.getCluster\s*=\s*getCluster;/.test(src),
            'model entities must expose getCluster'
        );
    });

    it('is decorated onto N1QL entities (parity, no asymmetric undefined)', function() {
        assert.ok(
            /entities\[entityName\]\.prototype\.getCluster\s*=\s*getCluster;/.test(src),
            'N1QL entities must expose getCluster for parity'
        );
    });

    it('documents that transaction support depends on the project-provided driver', function() {
        var start = src.indexOf('* getCluster');
        var fn    = src.slice(start, start + 1400);
        assert.ok(/transactions\(\)\.run/.test(fn), 'JSDoc should show the transactions().run use case');
        assert.ok(/3\.2\+\s*\/\s*4\.x/.test(fn), 'JSDoc must note the SDK version dependence (3.2+ / 4.x)');
    });

});


// ─── 04 — pure-logic replica: resolveCluster behaviour ──────────────────────

describe('04 - resolveCluster behaviour (pure-logic replica)', function() {

    // Mirrors framework/v*/core/connectors/couchbase/index.js resolveCluster()
    // line-for-line. Kept in lockstep with the source pins in §01.
    function resolveCluster(conn) {
        var cluster = (conn && conn._cluster)
            ? conn._cluster
            : (conn && conn._scope && conn._scope._bucket && conn._scope._bucket._cluster)
                ? conn._scope._bucket._cluster
                : null;

        if (!cluster || typeof(cluster.query) !== 'function') {
            var _err = new Error('[ CONNECTOR ][ couchbase ] Unable to resolve the SDK Cluster from the connection.');
            _err.code = 'GINA_COUCHBASE_CLUSTER_UNRESOLVED';
            throw _err;
        }

        return cluster;
    }

    var clusterStub = { query: function() {} };

    it('returns the cluster on the legacy top-level shape (conn._cluster)', function() {
        var conn = { _cluster: clusterStub };
        assert.equal(resolveCluster(conn), clusterStub);
    });

    it('returns the cluster on the nested shape (conn._scope._bucket._cluster)', function() {
        var conn = { _scope: { _bucket: { _cluster: clusterStub } } };
        assert.equal(resolveCluster(conn), clusterStub);
    });

    it('prefers the top-level shape when both are present', function() {
        var top    = { query: function() {} };
        var nested = { query: function() {} };
        var conn   = { _cluster: top, _scope: { _bucket: { _cluster: nested } } };
        assert.equal(resolveCluster(conn), top);
    });

    it('throws GINA_COUCHBASE_CLUSTER_UNRESOLVED when neither shape resolves', function() {
        assert.throws(
            function() { resolveCluster({}); },
            function(err) { return err.code === 'GINA_COUCHBASE_CLUSTER_UNRESOLVED'; },
            'an empty conn must throw the named error'
        );
    });

    it('throws on a null/undefined connection', function() {
        assert.throws(function() { resolveCluster(null); },      function(e) { return e.code === 'GINA_COUCHBASE_CLUSTER_UNRESOLVED'; });
        assert.throws(function() { resolveCluster(undefined); }, function(e) { return e.code === 'GINA_COUCHBASE_CLUSTER_UNRESOLVED'; });
    });

    it('throws when a resolved handle has no query() method', function() {
        assert.throws(
            function() { resolveCluster({ _cluster: {} }); },
            function(err) { return err.code === 'GINA_COUCHBASE_CLUSTER_UNRESOLVED'; },
            'a cluster handle without query() is not usable'
        );
    });

});


// ─── 05 — pure-logic replica: getCluster delegates correctly ────────────────

describe('05 - getCluster delegation (pure-logic replica)', function() {

    function resolveCluster(conn) {
        var cluster = (conn && conn._cluster)
            ? conn._cluster
            : (conn && conn._scope && conn._scope._bucket && conn._scope._bucket._cluster)
                ? conn._scope._bucket._cluster
                : null;
        if (!cluster || typeof(cluster.query) !== 'function') {
            var _err = new Error('unresolved');
            _err.code = 'GINA_COUCHBASE_CLUSTER_UNRESOLVED';
            throw _err;
        }
        return cluster;
    }

    // Mirrors: var getCluster = function() { return resolveCluster(this.getConnection()); };
    function getCluster() { return resolveCluster(this.getConnection()); }

    var clusterStub = { query: function() {} };

    it('returns the cluster from a bucket-shaped getConnection()', function() {
        var entity = { getConnection: function() { return { _cluster: clusterStub }; }, getCluster: getCluster };
        assert.equal(entity.getCluster(), clusterStub);
    });

    it('returns the cluster from a scope-shaped getConnection()', function() {
        var entity = {
            getConnection: function() { return { _scope: { _bucket: { _cluster: clusterStub } } }; },
            getCluster: getCluster
        };
        assert.equal(entity.getCluster(), clusterStub);
    });

    it('propagates the named error when the connection yields no cluster', function() {
        var entity = { getConnection: function() { return {}; }, getCluster: getCluster };
        assert.throws(
            function() { entity.getCluster(); },
            function(err) { return err.code === 'GINA_COUCHBASE_CLUSTER_UNRESOLVED'; }
        );
    });

});
