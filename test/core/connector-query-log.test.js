'use strict';
/**
 * Connector query-log coverage (#INS — Slice B)
 *
 * Verifies that every query-capable ORM connector still pushes a gated query
 * entry (statement + timing) into the per-request Inspector query log
 * (process.gina._queryALS.getStore()._devQueryLog), so the Inspector's
 * `user.queries` signal stays populated across all backends.
 *
 * Strategy:
 *   §01-06  source-pin matrix — one describe per connector (couchbase covers
 *           its two push sites: the main N1QL query + bulkInsert). No live DB:
 *           each connector's push code is built inside init(conn, infos), which
 *           needs a live bundle + driver, so end-to-end behavioral capture is
 *           not reachable in the unit suite for couchbase / mongodb / scylladb.
 *           The pins assert the full dev-OR-instrumentation-window gate, the
 *           getStore() -> _devQueryLog -> push chain (structural ordering, not a
 *           char-distance window), and the per-connector type/connector tags.
 *   §07     redis exclusion — session-store stub, no query path.
 *   §08     behavioral pure-logic replica of the byte-identical sqlite /
 *           postgresql / mysql instrumentation block, driven by a real
 *           AsyncLocalStorage, with an open-gate-pushes / closed-gate-does-not
 *           subtract-control (the probe-asymmetry guard that makes the source
 *           pins meaningful).
 *   §09     anti-drift source-pins keeping the §08 replica in sync with the
 *           real connectors (so the replica cannot silently diverge).
 */
var { describe, it, before, beforeEach, afterEach } = require('node:test');
var assert  = require('node:assert/strict');
var path    = require('path');
var fs      = require('fs');
var { AsyncLocalStorage } = require('async_hooks');

var FW = require('../fw');

// The exact per-request capture gate that the six connectors replicate.
var GATE = 'envIsDev || (process.gina && process.gina._inspectorWindowUntil > Date.now())';

/**
 * Assert that, starting at `fromIdx`, the source contains the
 * getStore() -> _devQueryLog -> .push( chain in order (the gated push).
 * Ordering-based (per the jsdoc.md "structural anchor, not a char-distance
 * window" lesson): a strictly increasing index sequence anchored on the gate.
 */
function assertGatedPushChain(src, fromIdx, label) {
    var g = src.indexOf(GATE, fromIdx);
    assert.ok(g >= 0, label + ': capture gate present');
    var s = src.indexOf('.getStore()', g);
    var d = src.indexOf('_devQueryLog', s);
    var p = src.indexOf('.push(', d);
    assert.ok(s > g, label + ': getStore() follows the gate');
    assert.ok(d > s, label + ': _devQueryLog follows getStore()');
    assert.ok(p > d, label + ': .push() follows _devQueryLog');
    return p;
}

var CONNECTORS = [
    { name: 'sqlite',     type: 'SQL',   connector: 'sqlite' },
    { name: 'postgresql', type: 'PG',    connector: 'postgresql' },
    { name: 'mysql',      type: 'MySQL', connector: 'mysql' },
    { name: 'scylladb',   type: 'CQL',   connector: 'scylladb' },
    { name: 'mongodb',    type: 'MQL',   connector: 'mongodb' }
    // couchbase is covered separately (§06) — it has two gated push sites.
];

CONNECTORS.forEach(function(c, i) {
    describe('0' + (i + 1) + ' - ' + c.name + ' connector: gated query-log push', function() {

        var src;
        before(function() {
            src = fs.readFileSync(path.join(FW, 'core/connectors/' + c.name + '/index.js'), 'utf8');
        });

        it('captures under the full dev-OR-instrumentation-window gate', function() {
            assert.ok(src.indexOf(GATE) >= 0,
                c.name + ' must gate capture on envIsDev OR an open instrumentation window');
        });

        it('reaches the request store and pushes inside the gate (getStore -> _devQueryLog -> push)', function() {
            assertGatedPushChain(src, 0, c.name);
            assert.ok(/process\.gina\._queryALS/.test(src), c.name + ': uses the _queryALS store');
        });

        it('pushes a query entry carrying statement + _startMs timing', function() {
            assert.ok(/statement\s*:/.test(src), c.name + ': entry carries a statement field');
            assert.ok(/_startMs\s*=\s*Date\.now\(\)/.test(src), c.name + ': entry stamps _startMs');
        });

        it("tags the entry type '" + c.type + "' and connector '" + c.connector + "'", function() {
            assert.ok(new RegExp("type\\s*:\\s*'" + c.type + "'").test(src),
                c.name + ": entry carries type literal '" + c.type + "'");
            assert.ok(new RegExp("connector\\s*:\\s*'" + c.connector + "'").test(src),
                c.name + ": entry carries connector literal '" + c.connector + "'");
        });
    });
});

// ─── 06 — couchbase: two gated push sites (main N1QL query + bulkInsert) ──────
describe('06 - couchbase connector: gated query-log push (two sites)', function() {

    var src;
    before(function() {
        src = fs.readFileSync(path.join(FW, 'core/connectors/couchbase/index.js'), 'utf8');
    });

    it('has at least two gated capture blocks (main query + bulkInsert)', function() {
        var gateCount = src.split(GATE).length - 1;
        assert.ok(gateCount >= 2,
            'couchbase has a main-query AND a bulkInsert gated push (found ' + gateCount + ')');
    });

    it('main query: pushes inside the gate (getStore -> _devQueryLog -> push)', function() {
        assertGatedPushChain(src, 0, 'couchbase main');
    });

    it('bulkInsert: pushes inside the gate at the second site, tagged source bulkInsert', function() {
        var second = src.lastIndexOf(GATE);
        assert.ok(second > src.indexOf(GATE),
            'couchbase bulkInsert gate is a distinct, later block');
        assertGatedPushChain(src, second, 'couchbase bulkInsert');
        assert.ok(/source\s*:\s*'bulkInsert'/.test(src),
            'bulkInsert entry tags source: bulkInsert');
    });

    it("tags entries type 'N1QL' and connector 'couchbase'", function() {
        assert.ok(/type\s*:\s*'N1QL'/.test(src));
        assert.ok(/connector\s*:\s*'couchbase'/.test(src));
    });
});

// ─── 07 — redis: no query path (excluded by design) ──────────────────────────
describe('07 - redis connector: no query path (excluded by design)', function() {

    var src;
    before(function() {
        src = fs.readFileSync(path.join(FW, 'core/connectors/redis/index.js'), 'utf8');
    });

    it('has no _queryALS / _devQueryLog / _queryEntry (session-store stub only)', function() {
        assert.ok(src.indexOf('_queryALS') < 0,    'redis: no _queryALS');
        assert.ok(src.indexOf('_devQueryLog') < 0, 'redis: no _devQueryLog');
        assert.ok(src.indexOf('_queryEntry') < 0,  'redis: no _queryEntry');
    });
});

// ─── 08 — SQL-trio behavioral replica (sqlite / postgresql / mysql) ──────────
//
// Faithful inline replica of the sqlite / postgresql / mysql instrumentation
// block — the three are byte-identical bar the `type` / `connector` literals.
// Trimmed to the load-bearing gate -> getStore -> _devQueryLog -> push shape and
// reads the same process.gina globals the real connectors read. Kept in sync
// with the real blocks by the §09 anti-drift source-pins.
function sqlInstrumentationBlock(envIsDev, queryString, typeLiteral, connectorName) {
    var _devLog = null, _queryEntry = null;
    if (envIsDev || (process.gina && process.gina._inspectorWindowUntil > Date.now())) {
        var _alsStore = process.gina && process.gina._queryALS
            ? process.gina._queryALS.getStore() : null;
        _devLog = _alsStore ? _alsStore._devQueryLog : null;
        if (_devLog) {
            _queryEntry = {
                type        : typeLiteral,
                statement   : String(queryString),
                durationMs  : 0,
                error       : null,
                connector   : connectorName
            };
            _queryEntry._startMs = Date.now();
            _devLog.push(_queryEntry);
        }
    }
    return _queryEntry;
}

describe('08 - SQL-trio behavioral replica (sqlite / postgresql / mysql)', function() {

    var savedGina;
    beforeEach(function() {
        savedGina = process.gina;
        process.gina = Object.assign({}, savedGina, {
            _queryALS             : new AsyncLocalStorage(),
            _inspectorWindowUntil : 0
        });
    });
    afterEach(function() { process.gina = savedGina; });

    it('gate OPEN via envIsDev -> pushes a gated entry with statement + numeric _startMs', function() {
        var log = [];
        var entry = process.gina._queryALS.run({ _devQueryLog: log }, function() {
            return sqlInstrumentationBlock(true, 'SELECT 1', 'SQL', 'sqlite');
        });
        assert.ok(entry, 'an entry was produced');
        assert.equal(log.length, 1);
        assert.equal(log[0].statement, 'SELECT 1');
        assert.equal(log[0].connector, 'sqlite');
        assert.equal(typeof log[0]._startMs, 'number');
    });

    it('gate OPEN via instrumentation window (envIsDev=false) -> pushes', function() {
        process.gina._inspectorWindowUntil = Date.now() + 60000;
        var log = [];
        process.gina._queryALS.run({ _devQueryLog: log }, function() {
            sqlInstrumentationBlock(false, 'SELECT 2', 'PG', 'postgresql');
        });
        assert.equal(log.length, 1);
        assert.equal(log[0].connector, 'postgresql');
    });

    it('gate CLOSED (no dev, no window) -> pushes NOTHING [subtract-control]', function() {
        process.gina._inspectorWindowUntil = 0;
        var log = [];
        var entry = process.gina._queryALS.run({ _devQueryLog: log }, function() {
            return sqlInstrumentationBlock(false, 'SELECT 3', 'MySQL', 'mysql');
        });
        assert.equal(entry, null, 'no entry produced when the gate is closed');
        assert.equal(log.length, 0, 'closed gate pushes nothing');
    });

    it('gate OPEN but NO request store (run outside ALS context) -> pushes NOTHING [defensive]', function() {
        // getStore() returns undefined outside a .run() scope -> the guard skips the push
        var entry = sqlInstrumentationBlock(true, 'SELECT 4', 'SQL', 'sqlite');
        assert.equal(entry, null);
    });
});

// ─── 09 — SQL-trio replica fidelity (anti-drift source-pins) ─────────────────
describe('09 - SQL-trio replica fidelity (anti-drift source-pins)', function() {

    ['sqlite', 'postgresql', 'mysql'].forEach(function(name) {
        it(name + ': real block still matches the replicated gate -> getStore -> push shape', function() {
            var src = fs.readFileSync(path.join(FW, 'core/connectors/' + name + '/index.js'), 'utf8');
            assert.ok(src.indexOf(GATE) >= 0,
                name + ': capture gate token unchanged');
            assert.ok(/process\.gina\._queryALS\s*\?\s*process\.gina\._queryALS\.getStore\(\)/.test(src),
                name + ': getStore() acquisition unchanged');
            assert.ok(/_devLog\s*=\s*_alsStore\s*\?\s*_alsStore\._devQueryLog\s*:\s*null/.test(src),
                name + ': _devQueryLog acquisition unchanged');
            assert.ok(/_queryEntry\._startMs\s*=\s*Date\.now\(\)/.test(src),
                name + ': _startMs stamp unchanged');
            assert.ok(/_devLog\.push\(_queryEntry\)/.test(src),
                name + ': push call unchanged');
        });
    });
});
