'use strict';
/**
 * #B173 — the query-file attachment guard warns on inherited-name collisions.
 *
 * Every ORM connector attaches file-derived methods (`sql/<Entity>/<name>.sql`,
 * `cql/…`, `pipelines/<Entity>/<name>.json`) behind
 * `typeof entities[E].prototype[name] !== 'undefined'` — a PROTOTYPE-CHAIN
 * lookup. gina extends `Object.prototype` (`utils/prototypes.js` `count`,
 * `functionCount`), and entities chain through the model Entity → EventEmitter,
 * so an inherited name (`count`, `on`, `emit`, …) read as "already defined":
 * the file was silently skipped and calls fell through to the inherited member.
 *
 * The fix keeps the skip set byte-identical (outer predicate unchanged) and
 * adds a warn INSIDE the taken branch when the collision is NOT an own
 * property. Own-property skips stay silent — user code in the entity `.js`
 * winning over a same-named file is the designed intent.
 *
 * §01 — source pins: new guard shape present in all six connectors, old bare
 *       one-line guard absent, per-connector log prefix correct.
 * §02 — behavioural: the REAL guard block is brace-match-extracted from each
 *       connector source and EXECUTED against the real `utils/prototypes` +
 *       EventEmitter chain: inherited name → skip + warn; own property →
 *       skip + NO warn; fresh name → attach (fall-through) + no warn.
 *
 * Couchbase is deliberately NOT covered: it attaches unconditionally (a
 * colliding name shadows the inherited member instead of being skipped) and
 * is out of #B173's scope.
 */

var assert = require('node:assert');
var { describe, it } = require('node:test');
var fs   = require('fs');
var path = require('path');

var fwPath = require('../fw');

// Load gina's real Object.prototype extensions (count / functionCount).
// Idempotent — defineProperty with configurable:true.
require(path.join(fwPath, '..', '..', 'utils', 'prototypes'));

var EventEmitter = require('events').EventEmitter;

var CONNECTORS = [
    { key: 'duckdb',     prefix: '[duckdb]',     verb: 'query method',    ext: 'Rows.sql'  },
    { key: 'sqlite',     prefix: '[sqlite]',     verb: 'query method',    ext: 'Rows.sql'  },
    { key: 'mysql',      prefix: '[mysql]',      verb: 'query method',    ext: 'Rows.sql'  },
    { key: 'postgresql', prefix: '[postgresql]', verb: 'query method',    ext: 'Rows.sql'  },
    { key: 'scylladb',   prefix: '[scylladb]',   verb: 'query method',    ext: 'Rows.sql'  },
    { key: 'mongodb',    prefix: '[Mongodb]',    verb: 'pipeline method', ext: 'Rows.json' }
];

var sources = {};
CONNECTORS.forEach(function(c) {
    sources[c.key] = fs.readFileSync(
        path.join(fwPath, 'core', 'connectors', c.key, 'index.js')
    ).toString();
});

var GUARD_OPEN = "if (typeof entities[entityName].prototype[name] !== 'undefined') {";

/**
 * Brace-match-extract the guard if-block (from GUARD_OPEN to its balanced
 * close) out of a connector source. Returns the block text.
 * @param {string} src - full connector source
 * @returns {string} the guard block
 * @inner
 */
function extractGuardBlock(src) {
    var start = src.indexOf(GUARD_OPEN);
    assert.notStrictEqual(start, -1, 'guard open not found');
    var i = src.indexOf('{', start);
    var depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('unbalanced guard block');
}

/**
 * Build a fresh entity fixture chained like the real connectors wire it:
 * user class → (model Entity stand-in) → EventEmitter → Object.prototype
 * (carrying gina's count/functionCount extensions).
 * @returns {object} entities map with one Report entity
 * @inner
 */
function makeEntities() {
    var proto = Object.create(EventEmitter.prototype);
    proto.myOwnMethod = function() { return 'user code'; };
    return { Report: { prototype: proto } };
}

/**
 * Execute the REAL extracted guard block. Returns 'ATTACH' when the guard
 * falls through (i.e. the loader would attach the method), undefined when
 * the guard returns (skip).
 * @inner
 */
function runGuard(block, entities, name, source, warns) {
    var fakeConsole = {
        warn: function(msg) { warns.push(msg); }
    };
    /* eslint-disable no-new-func */
    var fn = new Function('entities', 'entityName', 'name', 'source', 'console',
        block + "\nreturn 'ATTACH';");
    return fn(entities, 'Report', name, source, fakeConsole);
}

describe('01 - #B173 source pins (all six connectors)', function() {

    CONNECTORS.forEach(function(c) {
        it('01.' + c.key + ' - new guard shape present, old bare guard absent', function() {
            var src = sources[c.key];

            // New shape: own-property discrimination inside the guard
            assert.notStrictEqual(
                src.indexOf('Object.prototype.hasOwnProperty.call(entities[entityName].prototype, name)'),
                -1, c.key + ': hasOwnProperty discrimination missing');

            // The warn, with the per-connector prefix and the rename hint
            assert.notStrictEqual(
                src.indexOf("console.warn('" + c.prefix + ' skipping ' + c.verb + " \\''"),
                -1, c.key + ': guard warn with ' + c.prefix + ' prefix missing');
            assert.notStrictEqual(
                src.indexOf("Rename the file"), -1,
                c.key + ': rename hint missing');
            assert.notStrictEqual(
                src.indexOf(c.ext), -1,
                c.key + ': rename example extension missing');

            // Old bare one-line guard gone (fixed-string; also matches the
            // pre-fix sqlite form with its trailing comment)
            assert.strictEqual(
                src.indexOf("!== 'undefined') return;"), -1,
                c.key + ': old bare guard still present');

            // #B173 marker in the guard comment
            assert.notStrictEqual(src.indexOf('#B173'), -1,
                c.key + ': #B173 marker missing');
        });
    });

    it('01.z - control: the pin strings CAN miss (known-negative)', function() {
        // Validates the instrument: the same indexOf pins return -1 on a
        // source that does not carry the fix.
        var bogus = "if (typeof entities[entityName].prototype[name] !== 'undefined') return;";
        assert.strictEqual(bogus.indexOf('Object.prototype.hasOwnProperty.call(entities[entityName].prototype, name)'), -1);
        assert.notStrictEqual(bogus.indexOf("!== 'undefined') return;"), -1);
    });
});

describe('02 - #B173 behavioural: the REAL guard block, executed', function() {

    it('02.0 - fixture sanity: count/on inherited, myOwnMethod own', function() {
        var entities = makeEntities();
        var proto = entities.Report.prototype;
        // Inherited (gina Object.prototype extension + EventEmitter)
        assert.strictEqual(typeof proto.count, 'function');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(proto, 'count'), false);
        assert.strictEqual(typeof proto.on, 'function');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(proto, 'on'), false);
        // Own
        assert.strictEqual(Object.prototype.hasOwnProperty.call(proto, 'myOwnMethod'), true);
    });

    CONNECTORS.forEach(function(c) {
        describe('02.' + c.key, function() {
            var block = extractGuardBlock(sources[c.key]);

            it('extraction found the fixed block', function() {
                assert.ok(block.length > 200, 'block suspiciously short');
                assert.notStrictEqual(block.indexOf('hasOwnProperty'), -1);
                assert.notStrictEqual(block.indexOf('console.warn'), -1);
            });

            it("inherited 'count' (Object.prototype extension) - skip + warn", function() {
                var warns = [];
                var out = runGuard(block, makeEntities(), 'count', '/models/db/x/count.x', warns);
                assert.notStrictEqual(out, 'ATTACH', 'must skip');
                assert.strictEqual(warns.length, 1, 'exactly one warn');
                assert.notStrictEqual(warns[0].indexOf("'count'"), -1, 'warn names the method');
                assert.notStrictEqual(warns[0].indexOf('/models/db/x/count.x'), -1, 'warn names the file');
                assert.notStrictEqual(warns[0].indexOf('Report'), -1, 'warn names the entity');
                assert.notStrictEqual(warns[0].indexOf('Rename the file'), -1, 'warn carries the remedy');
            });

            it("inherited 'on' (EventEmitter) - skip + warn", function() {
                var warns = [];
                var out = runGuard(block, makeEntities(), 'on', '/models/db/x/on.x', warns);
                assert.notStrictEqual(out, 'ATTACH', 'must skip');
                assert.strictEqual(warns.length, 1, 'exactly one warn');
            });

            it('own property - skip, SILENT (user code wins)', function() {
                var warns = [];
                var out = runGuard(block, makeEntities(), 'myOwnMethod', '/models/db/x/myOwnMethod.x', warns);
                assert.notStrictEqual(out, 'ATTACH', 'must skip');
                assert.strictEqual(warns.length, 0, 'own-property skip must stay silent');
            });

            it('fresh name - attaches (falls through), no warn', function() {
                var warns = [];
                var out = runGuard(block, makeEntities(), 'countRows', '/models/db/x/countRows.x', warns);
                assert.strictEqual(out, 'ATTACH', 'must fall through to attachment');
                assert.strictEqual(warns.length, 0);
            });
        });
    });

    it('02.z - subtract control: the OLD guard skips count with NO warn', function() {
        // Replicates the pre-#B173 guard verbatim and proves the fixture
        // would have caught the silent skip (red-first validation shape).
        var oldGuard = "if (typeof entities[entityName].prototype[name] !== 'undefined') { return; }";
        var warns = [];
        var out = runGuard(oldGuard, makeEntities(), 'count', '/models/db/x/count.x', warns);
        assert.notStrictEqual(out, 'ATTACH', 'old guard also skips');
        assert.strictEqual(warns.length, 0, 'old guard is silent - the #B173 defect');
    });
});
