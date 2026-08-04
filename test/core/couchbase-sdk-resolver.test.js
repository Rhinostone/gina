'use strict';
/**
 * #B203 — the couchbase SDK-major resolver twins mis-parsed every non-caret
 * range pin.
 *
 * Contract under test: both resolver shims (`core/connectors/couchbase/lib/
 * connector.js` and its `lib/session-store.js` twin) derive the SDK major
 * from the project package.json couchbase dependency pin as the pin's FIRST
 * integer — `^4.6.1`, `~4.5.0`, `>=4.5`, `4.x` and exact pins all yield `4`;
 * a digit-less pin (`*`, `latest`) refuses with an error naming the pin
 * (previously it mangled through to a misdirecting existsSync "supported
 * majors are 3 and 4" error); a package.json with NO `dependencies` key is
 * tolerated (previously a TypeError on the `.couchbase` read); and the #CN8
 * v2 floor now fires for RANGE v2 pins too (`~2.5.0` previously mangled to
 * `~2`, parseInt NaN, and slipped past the floor).
 *
 * Strategy: the shims are top-level module code requiring a live bundle
 * context, so the version-derivation prologue (from `var version = 3;` up to
 * the `var filename =` gate, v2 floor included) is EXTRACTED from the shipped
 * source and executed as real bytes with fs/getPath fixtures — no replica.
 * Extraction is control-gated.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var TWINS = {
    'connector'     : path.join(FW, 'core/connectors/couchbase/lib/connector.js'),
    'session-store' : path.join(FW, 'core/connectors/couchbase/lib/session-store.js')
};

/**
 * Drop full-line comments so extraction and pins can never anchor on a
 * comment mention.
 *
 * @param   {string} src
 * @returns {string}
 * @inner
 */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * Slice the version-derivation prologue out of a resolver shim: everything
 * from `var version = 3;` (exclusive of the requires above it) up to the
 * `var filename =` dispatch line — the parse, the guards, and the #CN8 v2
 * floor, but not the filesystem-dependent dispatch.
 *
 * @param   {string} src
 * @returns {{ok: boolean, block: (string|null)}}
 * @inner
 */
function extractPrologue(src) {
    var active     = stripComments(src);
    var start      = active.indexOf('var version = 3;');
    var end        = active.indexOf('var filename =');
    var startAgain = start < 0 ? -1 : active.indexOf('var version = 3;', start + 1);
    if (start < 0 || end < 0 || end <= start || startAgain !== -1) {
        return { ok: false, block: null };
    }
    return { ok: true, block: active.slice(start, end) };
}

/**
 * Execute an extracted prologue against a fixture package.json, returning the
 * derived `version` (or throwing what the prologue throws).
 *
 * @param   {string} block - extracted prologue bytes
 * @param   {object} pkg   - fixture package.json content
 * @returns {*} the derived version value
 * @inner
 */
function run(block, pkg) {
    var fsFixture      = { readFileSync: function () { return JSON.stringify(pkg); } };
    var getPathFixture = function () { return '/proj'; };
    return new Function('fs', 'getPath', 'JSON', block + '\nreturn version;')(fsFixture, getPathFixture, JSON);
}

var SRC = {};
before(function () {
    Object.keys(TWINS).forEach(function (name) {
        SRC[name] = fs.readFileSync(TWINS[name], 'utf8');
    });
});


// ─── 01 — extraction controls ────────────────────────────────────────────────

describe('01 - #B203 extraction controls', function () {

    Object.keys(TWINS).forEach(function (name) {
        it(name + ': prologue extracted (both anchors, ordered, unique)', function () {
            var e = extractPrologue(SRC[name]);
            assert.equal(e.ok, true);
            assert.ok(e.block.length > 100, 'non-trivial block expected');
        });
    });

    it('known-negative: the extractor does not fire on unrelated source', function () {
        assert.equal(extractPrologue('var x = 1;\nvar y = 2;\n').ok, false);
    });
});


// ─── 02 — major derivation across real pin shapes ────────────────────────────

describe('02 - #B203 the major is the pin\'s first integer', function () {

    var CASES = [
        ['^4.6.1',   '4'],
        ['4.1.3',    '4'],
        ['4.x',      '4'],
        ['~4.5.0',   '4'],   // pre-#B203: '~4' — slipped the v2 floor, died at existsSync
        ['>=4.5',    '4'],   // pre-#B203: '>=4'
        ['>=3.2 <5', '3'],
        ['^3.2.7',   '3']
    ];

    Object.keys(TWINS).forEach(function (name) {
        CASES.forEach(function (c) {
            it(name + ': "' + c[0] + '" -> major ' + c[1], function () {
                var e = extractPrologue(SRC[name]);
                assert.equal(e.ok, true, 'extraction control');
                assert.equal(String(run(e.block, { dependencies: { couchbase: c[0] } })), c[1]);
            });
        });
    });
});


// ─── 03 — tolerant defaults ──────────────────────────────────────────────────

describe('03 - #B203 default v3 when the project pins nothing', function () {

    Object.keys(TWINS).forEach(function (name) {
        it(name + ': package.json without a dependencies key -> 3 (was: TypeError)', function () {
            var e = extractPrologue(SRC[name]);
            assert.equal(String(run(e.block, { name: 'proj' })), '3');
        });
        it(name + ': empty dependencies -> 3; unrelated dependencies -> 3', function () {
            var e = extractPrologue(SRC[name]);
            assert.equal(String(run(e.block, { dependencies: {} })), '3');
            assert.equal(String(run(e.block, { dependencies: { redis: '^1.0.0' } })), '3');
        });
    });
});


// ─── 04 — refusals: digit-less pins and the v2 floor ─────────────────────────

describe('04 - #B203 refusals', function () {

    Object.keys(TWINS).forEach(function (name) {

        it(name + ': a digit-less pin refuses, naming the pin', function () {
            var e = extractPrologue(SRC[name]);
            assert.throws(function () { run(e.block, { dependencies: { couchbase: '*' } }); },
                /could not derive[\s\S]*"\*"/);
            assert.throws(function () { run(e.block, { dependencies: { couchbase: 'latest' } }); },
                /could not derive/);
        });

        it(name + ': the #CN8 v2 floor fires for caret AND range v2 pins', function () {
            var e = extractPrologue(SRC[name]);
            assert.throws(function () { run(e.block, { dependencies: { couchbase: '^2.1.0' } }); },
                /no longer supported/);
            // pre-#B203: '~2' -> parseInt NaN -> slipped the floor entirely
            assert.throws(function () { run(e.block, { dependencies: { couchbase: '~2.5.0' } }); },
                /no longer supported/);
        });
    });
});


// ─── 05 — source pins ────────────────────────────────────────────────────────

describe('05 - #B203 source pins', function () {

    Object.keys(TWINS).forEach(function (name) {

        it(name + ': the caret-only mangle is gone; first-integer parse and deps guard present', function () {
            var active = stripComments(SRC[name]);
            assert.ok(active.indexOf("replace(/\\^/, '')") < 0,
                'the caret-only strip must not exist');
            assert.ok(active.indexOf('match(/\\d+/)') >= 0,
                'the first-integer parse must exist');
            assert.ok(active.indexOf('.dependencies || {}') >= 0,
                'the missing-dependencies guard must exist');
        });
    });
});
