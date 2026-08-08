/**
 * validator-required-whitespace-trim — isRequired emptiness anchoring + trim global flag (#B245).
 *
 * Two engine defects, one reported interaction:
 *
 *  1. isRequired's emptiness conjunct was `!/^\s+/.test(value)` — anchored at the
 *     START only, so ANY leading-whitespace-padded value read as empty: "  x" was
 *     rejected with "Cannot be left empty" while "x  " passed. Under the documented
 *     isRequired-first rule ordering, a paired `trim` then healed `local.data`
 *     AFTER the error was recorded, so a rejected field simultaneously carried the
 *     trimmed non-empty value — the reported signature. Fixed by anchoring both
 *     ends (`/^\s+$/`): emptiness is undefined / null / "" / whitespace-ONLY.
 *
 *  2. trim's `String.replace(/^\s+|\s+$/, '')` lacked the global flag, so only the
 *     FIRST match was rewritten: "  x  " came back "x  " (leading stripped,
 *     trailing kept whenever a leading match existed; a trailing-only pad still
 *     stripped because `\s+$` was then the first match). Fixed with `g`.
 *
 * Shape: (a) source pins — block-scoped, comment-stripped (the replace-code
 * convention keeps `// was:` records carrying the pre-fix literals, so an
 * un-stripped whole-file scan would false-positive on the comments);
 * (b) behavioural runs of the REAL plugin over the server auto path (#B85 idiom) —
 * the heal matrix, the PRESERVED all-whitespace rejection (the control that can
 * fail), order independence, and the both-sides strip; (c) dist fidelity — the
 * corrected regex literals in gina.min.js, counts measured from the emitted
 * artifact (Closure strips the `// was:` records, so the pre-fix literals must
 * read 0 there; the unminified gina.js keeps comments and is deliberately NOT
 * pinned). Pre-fix bundle baseline, measured: leading-only test 1, both-ends
 * anchor 0, first-match-only trim pair 1 — so §03.1/.2/.3 are red-first across
 * the rebuild by construction.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes')); // Object.prototype.count() — backendInit needs it
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'requiredwsbundle');

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var FV_PATH   = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var MINJS     = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
var FV_SRC    = fs.readFileSync(FV_PATH, 'utf8');

var Validator = require(MAIN_PATH); // ValidatorPlugin (the public gina.plugins.Validator)

function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

function countOccurrences(haystack, needle) {
    var n = 0, i = haystack.indexOf(needle);
    while (i > -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
    return n;
}

// parseRules mutates its input — hand each run a fresh copy
function run(rules, data) {
    return Validator(JSON.parse(JSON.stringify(rules)), data, 'required-ws-form');
}

describe('validator-required-whitespace-trim §01 — source pins (block-scoped, comment-stripped)', function () {

    var reqStart  = FV_SRC.indexOf("self[el]['isRequired'] = function");
    var reqEnd    = FV_SRC.indexOf("self[el]['isString'] = function");
    var trimStart = FV_SRC.indexOf("self[el]['trim'] = function");
    var trimEnd   = FV_SRC.indexOf("self[el]['exclude'] = function");

    it('01.1 - slice anchors resolve (control: the extraction can fail)', function () {
        assert.ok(reqStart > -1, 'isRequired block start anchor not found');
        assert.ok(reqEnd > reqStart, 'isRequired block end anchor not found after the start');
        assert.ok(trimStart > -1, 'trim block start anchor not found');
        assert.ok(trimEnd > trimStart, 'trim block end anchor not found after the start');
    });

    it('01.2 - isRequired anchors its emptiness test at BOTH ends', function () {
        var block = stripComments(FV_SRC.substring(reqStart, reqEnd));
        assert.ok(block.indexOf('!/^\\s+$/.test(this.value)') > -1,
            'the both-ends-anchored emptiness conjunct must be active');
        assert.ok(block.indexOf('!/^\\s+/.test(this.value)') < 0,
            'the pre-fix leading-only anchor must not reappear in active code');
    });

    it('01.3 - trim replaces globally', function () {
        var block = stripComments(FV_SRC.substring(trimStart, trimEnd));
        assert.ok(block.indexOf("replace(/^\\s+|\\s+$/g, '')") > -1,
            'the global-flagged trim must be active');
        assert.ok(block.indexOf("replace(/^\\s+|\\s+$/, '')") < 0,
            'the pre-fix first-match-only trim must not reappear in active code');
    });
});

describe('validator-required-whitespace-trim §02 — behavioural: the heal matrix (REAL plugin, server auto path)', function () {

    it('02.1 - {isRequired, isString, trim} accepts a leading-padded value and stores it trimmed', function () {
        var res = run({ name: { isRequired: true, isString: true, trim: true } }, { name: '  x' });
        assert.equal(res.isValid(), true,
            'the documented pairing must accept "  x" (pre-fix it recorded isRequired while trim healed the data)');
        assert.equal(res.data.name, 'x', 'trim owns the stored shape');
    });

    it('02.2 - {isRequired} alone accepts a leading-padded value verbatim', function () {
        var res = run({ name: { isRequired: true } }, { name: '  x' });
        assert.equal(res.isValid(), true, 'isRequired adjudicates emptiness, not padding');
        assert.equal(res.data.name, '  x', 'no trim authored — the value stays verbatim');
    });

    it('02.3 - a plain value still validates (harness control)', function () {
        var res = run({ name: { isRequired: true } }, { name: 'x' });
        assert.equal(res.isValid(), true, 'harness control — a plain non-empty value must pass');
    });

    it('02.4 - whitespace-ONLY is still empty (the preserved contract — this control can fail)', function () {
        var res = run({ name: { isRequired: true } }, { name: '   ' });
        assert.equal(res.isValid(), false, 'all-whitespace must keep failing isRequired');
        assert.ok(res.error && res.error.name && res.error.name.isRequired,
            'the rejection must be recorded under the isRequired key');
    });

    it('02.5 - the empty string is still empty', function () {
        var res = run({ name: { isRequired: true } }, { name: '' });
        assert.equal(res.isValid(), false, 'the empty string must keep failing isRequired');
        assert.ok(res.error && res.error.name && res.error.name.isRequired,
            'the rejection must be recorded under the isRequired key');
    });

    it('02.6 - trim-before-isRequired also passes (order independence)', function () {
        var res = run({ name: { trim: true, isRequired: true } }, { name: '  x' });
        assert.equal(res.isValid(), true, 'the trim-first authoring order must keep passing');
        assert.equal(res.data.name, 'x', 'trim owns the stored shape');
    });

    it('02.7 - trim strips BOTH ends when both are padded', function () {
        var res = run({ name: { trim: true } }, { name: '  x  ' });
        assert.equal(res.data.name, 'x',
            'pre-fix the first-match-only replace kept the trailing run ("x  ")');
    });

    it('02.8 - trim still strips a trailing-only pad', function () {
        var res = run({ name: { trim: true } }, { name: 'x  ' });
        assert.equal(res.data.name, 'x', 'a trailing-only pad was already stripped — must stay so');
    });

    it('02.9 - a trailing-padded value passes isRequired verbatim (unchanged behaviour)', function () {
        var res = run({ name: { isRequired: true } }, { name: 'x  ' });
        assert.equal(res.isValid(), true, 'trailing padding never counted as empty');
        assert.equal(res.data.name, 'x  ', 'no trim authored — the value stays verbatim');
    });
});

describe('validator-required-whitespace-trim §03 — dist fidelity (gina.min.js, counts from the emitted artifact)', function () {

    var min = fs.readFileSync(MINJS, 'utf8');

    it('03.1 - the both-ends emptiness anchor ships, exactly once', function () {
        assert.equal(countOccurrences(min, '/^\\s+$/'), 1,
            'expected exactly one both-ends anchor in the bundle (0 pre-fix — red-first)');
    });

    it('03.2 - the leading-only emptiness test is gone', function () {
        assert.equal(countOccurrences(min, '/^\\s+/.test'), 0,
            'the pre-fix leading-only test must not ship (1 pre-fix — red-first)');
    });

    it('03.3 - the first-match-only trim pair is gone (Closure strips the was-record)', function () {
        assert.equal(countOccurrences(min, '/^\\s+|\\s+$/,'), 0,
            'the no-g trim pair must not ship (1 pre-fix — red-first)');
    });

    it('03.4 - a global trim pair is present (paired with 03.3 this is conclusive)', function () {
        assert.ok(countOccurrences(min, '/^\\s+|\\s+$/g') >= 1,
            'at least one global trim pair must ship');
    });
});
