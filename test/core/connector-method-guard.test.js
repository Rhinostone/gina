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
 * §03 — #B174 (couchbase): the attach is deliberately UNCONDITIONAL — the
 *       opposite polarity: a colliding name overwrites/shadows the existing
 *       member instead of being skipped. Its guard warns WITHOUT skipping:
 *       own-member overwrite (stamped entity props, a previously attached
 *       query method) or a non-`Object.prototype` inherited shadow (the
 *       EventEmitter API) → warn; `Object.prototype` members (gina's
 *       count()/functionCount()) → silent — there the file winning is the
 *       desired outcome. Same extract-and-execute harness; EVERY case must
 *       still fall through to ATTACH (the guard contains no return).
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

var couchbaseSource = fs.readFileSync(
    path.join(fwPath, 'core', 'connectors', 'couchbase', 'index.js')
).toString();

/**
 * Couchbase-shaped fixture — the prototype exactly as `readSource()` sees it
 * at the attach site: fresh proto chained through EventEmitter (per
 * `lib/inherits` — `Object.create(parent.prototype)`), carrying the stamped
 * base props of `index.js:234-:247` / `:484-:492` plus one previously
 * attached query method. Entity base-API methods are constructor-INSTANCE
 * assigned in `core/model/entity.js` and are therefore invisible on this
 * chain — measured, not assumed (#B174 probe).
 * @returns {object} entities map with one Report entity
 * @inner
 */
function makeCouchbaseEntities() {
    var proto = Object.create(EventEmitter.prototype);
    proto.name               = 'Report';
    proto.model              = 'm';
    proto._collection        = 'report';
    proto.getCluster         = function() {};
    proto.bulkInsert         = function() {};
    proto.previouslyAttached = function() { return 'first-file'; };
    return { Report: { prototype: proto } };
}

describe('03 - #B174 couchbase: unconditional attach warns on clobber/shadow', function() {

    var block = extractGuardBlock(couchbaseSource);

    it('03.0 - fixture sanity: EventEmitter + gina helpers inherited, stamps own', function() {
        var proto = makeCouchbaseEntities().Report.prototype;
        assert.strictEqual(typeof proto.on, 'function');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(proto, 'on'), false);
        assert.strictEqual(typeof proto.count, 'function');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(proto, 'count'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(proto, 'getCluster'), true);
        assert.strictEqual(typeof proto.zzFresh, 'undefined');
    });

    it('03.1 - source pins: warn-guard precedes the attach, never skips', function() {
        var src = couchbaseSource;
        var guardAt  = src.indexOf(GUARD_OPEN);
        var attachAt = src.indexOf('entities[entityName].prototype[name] = function()');

        // Guard present, attach present, guard sits BEFORE the attach
        assert.notStrictEqual(guardAt, -1, 'warn-guard missing');
        assert.notStrictEqual(attachAt, -1, 'unconditional attach missing');
        assert.ok(guardAt < attachAt, 'guard must precede the attach');

        // The guard is warn-ONLY: no return anywhere inside the block, so
        // nothing can ever skip the attach (behavior byte-identical).
        assert.doesNotMatch(block, /\breturn\b/, 'guard must not skip');

        // Discrimination + prefix + remedy
        assert.notStrictEqual(block.indexOf('Object.prototype.hasOwnProperty.call(entities[entityName].prototype, name)'), -1);
        assert.notStrictEqual(block.indexOf("console.warn('[couchbase] query method"), -1);
        assert.notStrictEqual(block.indexOf('Rename the file'), -1);
        assert.notStrictEqual(block.indexOf('Rows.sql'), -1);

        // #B174 marker in the guard comment; couchbase never uses the six's
        // skip vocabulary (it does not skip)
        assert.notStrictEqual(src.indexOf('#B174'), -1, '#B174 marker missing');
        assert.strictEqual(src.indexOf('skipping query method'), -1,
            'couchbase must not carry the six-connector skip warn');
    });

    describe('03.2 - behavioural: the REAL guard block, executed', function() {

        it("inherited 'on' (EventEmitter) - ATTACH + shadow warn", function() {
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'on', '/models/db/n1ql/report/on.sql', warns);
            assert.strictEqual(out, 'ATTACH', 'must fall through to attachment');
            assert.strictEqual(warns.length, 1, 'exactly one warn');
            assert.notStrictEqual(warns[0].indexOf('shadows an inherited member'), -1);
            assert.notStrictEqual(warns[0].indexOf("'on'"), -1, 'warn names the method');
            assert.notStrictEqual(warns[0].indexOf('/models/db/n1ql/report/on.sql'), -1, 'warn names the file');
            assert.notStrictEqual(warns[0].indexOf('Report'), -1, 'warn names the entity');
            assert.notStrictEqual(warns[0].indexOf('Rename the file'), -1, 'warn carries the remedy');
        });

        it("inherited 'emit' (EventEmitter) - ATTACH + shadow warn", function() {
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'emit', '/models/db/n1ql/report/emit.sql', warns);
            assert.strictEqual(out, 'ATTACH');
            assert.strictEqual(warns.length, 1);
            assert.notStrictEqual(warns[0].indexOf('shadows an inherited member'), -1);
        });

        it("own 'getCluster' (stamped entity prop) - ATTACH + overwrite warn", function() {
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'getCluster', '/models/db/n1ql/report/getCluster.sql', warns);
            assert.strictEqual(out, 'ATTACH');
            assert.strictEqual(warns.length, 1);
            assert.notStrictEqual(warns[0].indexOf('overwrites an existing own member'), -1);
        });

        it("own 'previouslyAttached' (duplicate query method) - ATTACH + overwrite warn", function() {
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'previouslyAttached', '/models/db/n1ql/report/previouslyAttached.sql', warns);
            assert.strictEqual(out, 'ATTACH');
            assert.strictEqual(warns.length, 1);
            assert.notStrictEqual(warns[0].indexOf('overwrites an existing own member'), -1);
        });

        it("inherited 'count' (gina Object.prototype helper) - ATTACH, SILENT", function() {
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'count', '/models/db/n1ql/report/count.sql', warns);
            assert.strictEqual(out, 'ATTACH');
            assert.strictEqual(warns.length, 0,
                'shadowing count() is the desired outcome on couchbase - must stay silent');
        });

        it("inherited 'functionCount' - ATTACH, SILENT", function() {
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'functionCount', '/models/db/n1ql/report/functionCount.sql', warns);
            assert.strictEqual(out, 'ATTACH');
            assert.strictEqual(warns.length, 0);
        });

        it("native 'toString' (Object.prototype) - ATTACH, SILENT (documented exemption)", function() {
            // Deliberate: the exemption is own-on-Object.prototype, which
            // includes natives - a toString.sql folly shadows deterministically
            // with no warn. Pinned so the edge stays a decision, not a drift.
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'toString', '/models/db/n1ql/report/toString.sql', warns);
            assert.strictEqual(out, 'ATTACH');
            assert.strictEqual(warns.length, 0);
        });

        it('fresh name - ATTACH, no warn', function() {
            var warns = [];
            var out = runGuard(block, makeCouchbaseEntities(), 'countRows', '/models/db/n1ql/report/countRows.sql', warns);
            assert.strictEqual(out, 'ATTACH');
            assert.strictEqual(warns.length, 0);
        });
    });

    it('03.z - control: extraction MISSES the pre-#B174 source shape', function() {
        // Validates the instrument: the pre-fix couchbase carried NO guard -
        // the same extraction against that shape must fail, so a green 03.1
        // is meaningful (red-first shape).
        var preFix = "                }\n\n\n                entities[entityName].prototype[name] = function() {";
        assert.throws(function() { extractGuardBlock(preFix); },
            'extraction must fail on the guard-less pre-fix shape');
    });
});
