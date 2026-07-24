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


// ─── 06 — dynamic field-path $N substituted at EVERY occurrence (source pins) ─

describe('06 - field-path $N substitution: every occurrence (source pins)', function() {

    var blk, code;
    before(function() {
        var src = fs.readFileSync(CONNECTOR, 'utf8');
        // isolate the foundSpecialLeftCase substitution loop
        var start = src.indexOf('if (foundSpecialLeftCase) {');
        var rest  = src.slice(start);
        var end   = rest.indexOf('if ( sdkVersion == 3 )');
        blk  = end > -1 ? rest.slice(0, end) : rest;
        // strip comments before negative pins: the explanatory comment in the block
        // intentionally names the old greedy `(.*)` shape it replaced, which would
        // otherwise trip the "(.*) is gone" pin (jsdoc.md negative-pin-vs-comment trap).
        code = blk.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    });

    it('escapes the placeholder once into a reusable paramKeyEsc', function() {
        assert.ok(
            code.indexOf('var paramKeyEsc = params[i].replace(') > -1,
            'expected a single paramKeyEsc = params[i].replace(/([$%]+)/, ...) extraction'
        );
    });

    it('gates field-path position with a leading dot + digit boundary (no greedy prefix)', function() {
        assert.ok(
            code.indexOf("paramKeyEsc + '(?![0-9])');") > -1,
            "gate regex must be /\\.<key>(?![0-9])/ — leading dot + digit boundary, no greedy (.*) prefix"
        );
    });

    it('rewrites EVERY occurrence: global (g) flag + dollar-safe function replacer', function() {
        assert.ok(
            code.indexOf("paramKeyEsc + '(?![0-9])', 'g')") > -1,
            'replace must carry the global (g) flag so all field-path occurrences are rewritten'
        );
        assert.ok(
            code.indexOf("function () { return '.' + args[i]; }") > -1,
            'replace must use a function replacer (dollar-safe), never a string replacement that would expand $&/$`/$\''
        );
    });

    it('keeps the digit boundary on BOTH the gate and the replace', function() {
        var n = (code.match(/\(\?!\[0-9\]\)/g) || []).length;
        assert.ok(n >= 2, 'expected (?![0-9]) on both the gate and the global replace; found ' + n);
    });

    it('removed the greedy (.*) prefix capture and the $1 re-emit (defect gone)', function() {
        assert.ok(code.indexOf('(.*)') === -1, 'the greedy (.*) prefix capture must be gone from the substitution');
        assert.ok(code.indexOf("'$1\\.'+args[i]") === -1, "the old '$1.'+args[i] greedy re-emit replacement must be gone");
    });

});


// ─── 07 — dynamic field-path $N substitution behaviour (pure-logic replica) ──

describe('07 - field-path $N substitution behaviour (pure-logic replica)', function() {

    // Mirrors the foundSpecialLeftCase loop in
    // framework/v*\/core/connectors/couchbase/index.js line-for-line (post-fix).
    function substitute(body, params, inlineParams, args) {
        var qStr = body.slice(0), inl = inlineParams.slice(), re = null, key, i, len;
        var foundSpecialLeftCase = /\w+\.(\$|\%)/.test(qStr);
        if (foundSpecialLeftCase) {
            i = 0; len = args.length;
            for (; i < len; ++i) {
                key = inl.indexOf(params[i]);
                if (key > -1) {
                    var paramKeyEsc = params[i].replace(/([$%]+)/, '\\$1');
                    re = new RegExp('\\.' + paramKeyEsc + '(?![0-9])');
                    if (re.test(qStr)) {
                        qStr = qStr.replace(new RegExp('\\.' + paramKeyEsc + '(?![0-9])', 'g'), function () { return '.' + args[i]; });
                        inl.splice(key, 1);
                    }
                }
            }
        }
        return qStr;
    }

    // inlineParams mirrors index.js:436-443 (deduped $N from the body, order of first use).
    function inlineParamsOf(body) { return Array.from(new Set(body.match(/\$\w+/g))); }

    it('substitutes the SAME $N field-path key in BOTH a SET and a WHERE (the reported bug)', function() {
        var body = 'UPDATE bucket AS d SET d.flags.$2 = $3 WHERE d.id = $1 AND d.flags.$2 IS MISSING RETURNING d.id;';
        var out  = substitute(body, ['$1', '$2', '$3'], inlineParamsOf(body), ['doc-1', 'seen', true]);
        assert.equal(out, 'UPDATE bucket AS d SET d.flags.seen = $3 WHERE d.id = $1 AND d.flags.seen IS MISSING RETURNING d.id;');
        assert.doesNotMatch(out, /\.\$\d+/, 'no literal .$N field-path placeholder may survive');
    });

    it('mixes a field-path $N with value params: field-path interpolated, values stay positional', function() {
        var body = 'UPDATE bucket AS d SET d.counters.$2 = $3 WHERE d.id = $1 RETURNING d.id;';
        var out  = substitute(body, ['$1', '$2', '$3'], inlineParamsOf(body), ['doc-1', 'hits', 5]);
        assert.equal(out, 'UPDATE bucket AS d SET d.counters.hits = $3 WHERE d.id = $1 RETURNING d.id;');
        assert.match(out, /= \$3 /,       'value param $3 must remain positional (not interpolated)');
        assert.match(out, /d\.id = \$1 /, 'value param $1 must remain positional (not interpolated)');
    });

    it('keeps two DISTINCT field-path params (each used once) working', function() {
        var body = 'UPDATE bucket AS d SET d.a.$2 = 1, d.b.$3 = 2 WHERE d.id = $1 RETURNING d.id;';
        var out  = substitute(body, ['$1', '$2', '$3'], inlineParamsOf(body), ['doc-1', 'alpha', 'beta']);
        assert.equal(out, 'UPDATE bucket AS d SET d.a.alpha = 1, d.b.beta = 2 WHERE d.id = $1 RETURNING d.id;');
    });

    it('respects the digit boundary: $3 does not substitute inside $30', function() {
        var body = 'UPDATE bucket AS d SET d.x.$3 = 1, d.y.$30 = 2 WHERE d.id = $1 RETURNING d.id;';
        // comment order forces $3 to be processed before $30; both are field-path keys
        var out  = substitute(body, ['$1', '$3', '$30'], inlineParamsOf(body), ['doc-1', 'K3', 'K30']);
        assert.equal(out, 'UPDATE bucket AS d SET d.x.K3 = 1, d.y.K30 = 2 WHERE d.id = $1 RETURNING d.id;');
    });

    it('handles the same $N as BOTH a field-path key and a value', function() {
        var body = 'UPDATE bucket AS d SET d.flags.$2 = $2 WHERE d.id = $1 RETURNING d.id;';
        var out  = substitute(body, ['$1', '$2'], inlineParamsOf(body), ['doc-1', 'seen']);
        // the field-path .$2 is interpolated; the value `= $2` stays positional
        assert.equal(out, 'UPDATE bucket AS d SET d.flags.seen = $2 WHERE d.id = $1 RETURNING d.id;');
    });

    it("does not dollar-expand a field-key value containing $& (function replacer, not string)", function() {
        var body = 'UPDATE bucket AS d SET d.flags.$2 = 1 WHERE d.id = $1;';
        var out  = substitute(body, ['$1', '$2'], inlineParamsOf(body), ['doc-1', 'a$&b']);
        assert.equal(out, 'UPDATE bucket AS d SET d.flags.a$&b = 1 WHERE d.id = $1;');
    });

    it('leaves %N field-paths untouched (this loop only extracts $N)', function() {
        var body = 'UPDATE bucket AS d SET d.flags.%2 = 1 WHERE d.id = $1 RETURNING d.id;';
        // params/inlineParams are matched with /\$\w+/g, so %2 is never extracted -> never substituted
        var out  = substitute(body, ['$1'], inlineParamsOf(body), ['doc-1', 'seen']);
        assert.equal(out, body, '%N is not handled by this substitution loop (no regression, no new support)');
    });

});


// ─── 08 — #B153: N1QL onError guards the `cause` envelope (never hangs) ──────

describe('08 - #B153: onError guards err.cause so the query always settles', function() {

    var src;
    before(function() { src = fs.readFileSync(CONNECTOR, 'utf8'); });

    it('all three N1QL onError sites guard err.cause before reading first_error_message', function() {
        var guardCount = (src.match(/err && err\.cause && typeof\(err\.cause\.first_error_message\) != 'undefined'/g) || []).length;
        assert.equal(guardCount, 3, 'all three onError sites carry the cause guard');
        // every `new Error(err.cause.first_error_message)` now sits inside a guarded branch
        var b153 = (src.match(/#B153/g) || []).length;
        assert.ok(b153 >= 3, 'each fixed site is annotated with the bug id');
    });

    it('the register() sites forward the raw error through onQueryCallback on the fallback path', function() {
        assert.match(src,
            /var error;\s*if \( err && err\.cause[\s\S]*?error = \(err instanceof Error\) \? err : new Error\(String\(err\)\);[\s\S]*?onQueryCallback\(error\);/,
            'guarded build-from-cause, else forward raw err, then always call onQueryCallback');
    });

    it('the bulkInsert site emits on both paths', function() {
        assert.match(src,
            /else \{\s*error = \(err instanceof Error\) \? err : new Error\(String\(err\)\);\s*\}\s*self\.emit\(trigger, error\);/,
            'bulkInsert onError forwards the raw err then always self.emit(trigger, error)');
    });

    /**
     * Pure-logic replica of the FIXED onError handler (register()/bulkInsert share
     * the same guard).
     *
     * @param {*} err
     * @param {function} terminal - onQueryCallback / self.emit stand-in
     * @returns {void}
     */
    function fixedOnError(err, terminal) {
        var error;
        if ( err && err.cause && typeof(err.cause.first_error_message) != 'undefined' ) {
            error = new Error(err.cause.first_error_message);
            error.stack = 'trigger\n' + err.cause.http_body;
            error.cause = err.cause;
        } else {
            error = (err instanceof Error) ? err : new Error(String(err));
        }
        terminal(error);
    }

    /**
     * The pre-fix (unguarded) handler — the subtract control.
     *
     * @param {*} err
     * @param {function} terminal
     * @returns {void}
     */
    function oldOnError(err, terminal) {
        try {
            var error = new Error(err.cause.first_error_message); // throws when cause is absent
            error.stack = 'trigger\n' + err.cause.http_body;
            terminal(error);
        } catch (_err) {
            /* swallowed — terminal never fires → the request hangs forever */
        }
    }

    it('fixed handler: a socket-level error (no `cause`) still settles, forwarding the raw error', function() {
        var sockErr = new Error('connect ECONNREFUSED 127.0.0.1:8091');
        sockErr.code = 'ECONNREFUSED';
        var seen = null;
        fixedOnError(sockErr, function(e) { seen = e; });
        assert.ok(seen, 'terminal callback fired — no hang');
        assert.equal(seen.code, 'ECONNREFUSED', 'the raw error is forwarded, so code/errno survive for classification');
    });

    it('fixed handler: an N1QL error WITH a cause builds from first_error_message and keeps the raw cause', function() {
        var n1qlErr = { cause: { first_error_message: 'Timeout 1000ms exceeded', http_body: '{"errors":[{"code":1080}]}' } };
        var seen = null;
        fixedOnError(n1qlErr, function(e) { seen = e; });
        assert.equal(seen.message, 'Timeout 1000ms exceeded');
        assert.equal(seen.cause.first_error_message, 'Timeout 1000ms exceeded', 'raw cause preserved for downstream classification');
    });

    it('subtract control: the OLD handler HANGS on a socket-level error (terminal never called)', function() {
        var sockErr = new Error('connect ECONNREFUSED 127.0.0.1:8091');
        sockErr.code = 'ECONNREFUSED'; // no .cause envelope
        var settled = false;
        oldOnError(sockErr, function() { settled = true; });
        assert.equal(settled, false,
            'the pre-fix handler swallowed the TypeError and never settled — the hang #B153 fixes');
    });
});
