'use strict';
/**
 * The validator fix #B920, pinned in the source and executed on the shipped bytes. The behaviour is
 * driven end to end on the real bundle by `test/e2e/validator-case-later-condition-b920.spec.js`.
 *
 * forEachField's first condition scan reads the driver's value into `caseValue` once per `_case_`
 * block and tests every condition of the block against it. Inside a matched condition, the branch for
 * a literal rule key also ran `caseValue = fields[caseField]`, and turned it into a boolean when that
 * field's own rule says `isBoolean`. Nothing in the branch read that value: the next reader was the
 * filter of the block's NEXT condition, which then compared its `case` with the value of the field the
 * previous condition names, not with the driver's. A later condition whose `case` equalled that value
 * applied although the driver did not match it.
 *
 *   §01 extraction + controls (the slicer can fail; the harness reaches the code under test)
 *   §02 source pins (comment-stripped)
 *   §03 forEachField on the real bytes
 *   §04 dist fidelity (both bundles)
 *
 * Red-first: `GINA_B920_MAIN_SRC=<file>` points §01–§03 at another copy of the validator source
 * (e.g. `git show <commit>:<path>` before the change), and `GINA_B920_DIST_DIR=<dir>` points §04 at
 * another dist js directory. Every arm must fail there except those labelled CONTROL.
 *
 * Usage: node --test test/core/validator-case-later-condition-b920.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var MAIN     = process.env.GINA_B920_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B920_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

var SRC = fs.readFileSync(MAIN, 'utf8');

/**
 * Drops whole-line comments (`//`, `/*`, ` *`), so a pin never matches prose or a commented-out
 * copy of the code.
 *
 * @param {string} src
 * @returns {string}
 */
function activeLines(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * The text between two anchors, each of which must occur exactly once.
 *
 * @param {string} src
 * @param {string} from - start anchor (included)
 * @param {string} to - end anchor (excluded)
 * @param {string} label - names the span in error messages
 * @returns {string}
 */
function between(src, from, to, label) {
    var s = src.indexOf(from);
    if (s < 0) { throw new Error(label + ': start anchor not found'); }
    if (src.indexOf(from, s + 1) !== -1) { throw new Error(label + ': start anchor not unique'); }
    var e = src.indexOf(to, s);
    if (e < 0) { throw new Error(label + ': end anchor not found'); }
    if (src.indexOf(to, e + 1) !== -1) { throw new Error(label + ': end anchor not unique'); }
    return src.substring(s, e);
}

// ---------------------------------------------------------------------------
// Extraction — forEachField, sliced from the shipped bytes and executed (the slicer of
// test/core/validator-case-rules-b885.test.js: forEachField holds a commented-out region whose
// braces do not balance, so a brace walk cannot be used).
// ---------------------------------------------------------------------------
var FE_DECL = 'var forEachField = function($formOrElement, allFields, allRules, fields, $fields, rules, cb, i) {';
var FE_END_ANCHOR = 'addListener(gina, $formOrElement, evt';

function sliceForEachField(src) {
    var s = src.indexOf(FE_DECL);
    if (s < 0) { throw new Error('forEachField declaration not found'); }
    if (src.indexOf(FE_DECL, s + 1) !== -1) { throw new Error('forEachField declaration not unique'); }
    var endAnchor = src.indexOf(FE_END_ANCHOR, s);
    if (endAnchor < 0) { throw new Error('forEachField end anchor not found'); }
    return src.substring(s, src.lastIndexOf('}', endAnchor) + 1);
}

// The first condition scan: from the driver's value to the scan's end.
var SCAN_START = 'caseValue = allFields[caseName];';
var SCAN_END   = 'if (isInCase) continue;';
// The literal-key branch of a matched condition (site B): from its field assignment to the 2/3 check.
var SITE_B_START = 'caseField = _r;';
var SITE_B_END   = '// check each field against rule only if rule exists 2/3';

function sliceScan(src) {
    return between(src, SCAN_START, SCAN_END, 'first condition scan');
}
function sliceSiteB(src) {
    return between(src, SITE_B_START, SITE_B_END, 'site B');
}

// An assignment to caseValue (not a comparison).
var CASE_VALUE_WRITE_RE = /\bcaseValue\s*=(?!=)/g;

var feSrc = sliceForEachField(SRC);

// ---------------------------------------------------------------------------
// Harness — forEachField compiled with its free identifiers as parameters (the list of the sibling
// case tests). The checkFieldAgainstRules spy mirrors the real function's `delete fields[field]`
// after an applied rule; the engine stub `d` holds one key per field it knows and, like
// FormValidator's public addField, ignores a name it already holds.
// ---------------------------------------------------------------------------
var FE_PARAMS = [
    'isGFFCtx', '$allFields', 'checkFieldAgainstRules', 'merge',
    'subLevelRules', 'fieldErrorsAttributes', 'd', 'formatData', 'envIsDev',
    'gina', 'window', 'triggerEvent', 'addListener', 'removeListener',
    'instance', 'evt', 'hasParsedAllRules', 'hasBeenValidated', 'asyncCount',
    'data', 'id', 're', 'flags', 'caseField',
    '__allFields', '__allRules', '__fields', '__$fields', '__rules'
];

function compileFE(src) {
    return new Function(FE_PARAMS.join(','),
        src + '\nreturn forEachField(null, __allFields, __allRules, __fields, __$fields, __rules, undefined, 0);');
}

function shallowMerge(a, b) {
    var o = {}, k;
    for (k in b) { o[k] = b[k]; }
    for (k in a) { o[k] = a[k]; }
    return o;
}

function clone(o) {
    return JSON.parse(JSON.stringify(o));
}

/**
 * A control stub: forEachField reads `getAttribute('type')` (null for a select, as in a real DOM);
 * the #B914 entry reads the `type` property.
 *
 * @param {string} name
 * @param {string} type - `text`, `select-one`, `radio`, …
 * @param {string} value
 * @returns {object}
 */
function mkControl(name, type, value) {
    return {
        name: name,
        type: type,
        value: value,
        tagName: (type === 'select-one') ? 'SELECT' : 'INPUT',
        checked: false,
        disabled: false,
        id: name + '-1',
        getAttribute: function (a) {
            if (a === 'type') { return (type === 'select-one') ? null : type; }
            if (a === 'id') { return this.id; }
            return null;
        },
        setAttribute: function () {}
    };
}

/**
 * Runs forEachField once on fresh copies of the fixture.
 *
 * @param {string} src - the forEachField slice
 * @param {{rules: object, fields: object, $fields: object}} opts
 * @returns {{applied: Array<object>, added: Array<object>, thrown: (Error|null)}}
 */
function driveFE(src, opts) {
    var applied = [], added = [];
    var spy = function (name, rulesArg, fieldsArg) {
        var rule = rulesArg[name] || {};
        applied.push({ name: name, rule: clone(rule), value: fieldsArg[name] });
        if (typeof (rulesArg[name]) != 'undefined' && Object.keys(rule).length > 0) {
            delete fieldsArg[name];
        }
    };
    var d = {
        addField: function (el, value) {
            if (typeof (d[el]) != 'undefined') { return; }
            added.push({ name: el, value: value });
            d[el] = { name: el, value: value };
        },
        getErrors: function () { return {}; },
        toData: function () { return {}; },
        isValid: function () { return true; }
    };
    Object.keys(opts.fields).forEach(function (k) { d[k] = { name: k, value: opts.fields[k] }; });
    var thrown = null;
    try {
        compileFE(src)(
            true,                                   // isGFFCtx
            opts.$fields, spy, shallowMerge,
            0,                                      // subLevelRules
            {},                                     // fieldErrorsAttributes
            d,
            function (x) { return x; },             // formatData
            false,                                  // envIsDev
            {}, {},                                 // gina, window
            function () {}, function () {}, function () {}, // triggerEvent, addListener, removeListener
            {},                                     // instance
            'validated.x',                          // evt
            false, false, 0,                        // hasParsedAllRules, hasBeenValidated, asyncCount
            null, 'x',                              // data, id
            null, null, null,                       // re, flags, caseField
            clone(opts.fields),                     // allFields
            clone(opts.rules),                      // allRules
            clone(opts.fields),                     // fields
            opts.$fields,
            clone(opts.rules)                       // rules
        );
    } catch (err) { thrown = err; }
    return { applied: applied, added: added, thrown: thrown };
}

/**
 * Two conditions in one block. The first matches the driver `kind` (a select at `a`) and names the
 * collected text field `note`; the second's case is `later` and requires the radio group `choice`,
 * which has no rule of its own and is unpicked.
 *
 * @param {object} o
 * @param {*} o.later - the second condition's case
 * @param {string} o.note - note's collected value
 * @param {object} [o.noteRule] - note's rule in the first condition (default `{ isString: true }`)
 * @param {object} [o.ownNoteRule] - a rule of note's own, at the top level
 * @param {boolean} [o.single] - drop the second condition
 * @returns {{rules: object, fields: object, $fields: object}}
 */
function laterShape(o) {
    var conditions = [{ case: 'a', rules: { note: o.noteRule || { isString: true } } }];
    if (!o.single) { conditions.push({ case: o.later, rules: { choice: { isRequired: true } } }); }
    var rules = { ref: { isRequired: true }, _case_kind: { conditions: conditions } };
    if (o.ownNoteRule) { rules.note = o.ownNoteRule; }
    return {
        rules: rules,
        fields: { ref: 'x', kind: 'a', note: o.note },
        $fields: {
            ref: mkControl('ref', 'text', 'x'),
            kind: mkControl('kind', 'select-one', 'a'),
            note: mkControl('note', 'text', o.note),
            choice: mkControl('choice', 'radio', 'c1')
        }
    };
}

function namedEntries(list, name) {
    return list.filter(function (c) { return c.name === name; });
}

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-case-later-condition-b920 §01 — extraction + controls', function () {

    it('01.1 - CONTROL: the forEachField slice resolves, is substantial, and compiles', function () {
        assert.equal(feSrc.indexOf(FE_DECL), 0, 'the slice starts at the declaration');
        assert.ok(feSrc.length > 20000, 'slice suspiciously small: ' + feSrc.length);
        assert.doesNotThrow(function () { compileFE(feSrc); });
    });

    it('01.2 - CONTROL: the slicers can fail — a bogus anchor throws', function () {
        assert.throws(function () { sliceForEachField(SRC.replace(FE_DECL, 'var notForEachField = function() {')); },
            /declaration not found/);
        assert.throws(function () { sliceSiteB(feSrc.replace(SITE_B_END, '// gone')); }, /end anchor not found/);
        assert.throws(function () { sliceScan(feSrc + '\n' + SCAN_START); }, /start anchor not unique/);
    });

    it('01.3 - CONTROL: the harness reaches the matched condition — note is adjudicated with the case rule', function () {
        var res = driveFE(feSrc, laterShape({ single: true, note: 'n' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var note = namedEntries(res.applied, 'note');
        assert.ok(note.length > 0, 'if this fails, every §03 assertion is meaningless');
        note.forEach(function (c) { assert.deepEqual(c.rule, { isString: true }); });
    });
});

// ---------------------------------------------------------------------------
// §02 — source pins (comment-stripped)
// ---------------------------------------------------------------------------
describe('validator-case-later-condition-b920 §02 — source pins', function () {

    it('02.1 - #B920: the literal-key branch of a matched condition writes no caseValue', function () {
        var writes = activeLines(sliceSiteB(feSrc)).match(CASE_VALUE_WRITE_RE) || [];
        assert.equal(writes.length, 0, 'the next condition\'s filter would read the value written here');
    });

    it('02.2 - #B920: in the first scan, caseValue is written only from the driver (the value and its two coercion arms)', function () {
        var scan = activeLines(sliceScan(feSrc));
        var writes = scan.match(CASE_VALUE_WRITE_RE) || [];
        assert.equal(writes.length, 3, 'writes found: ' + writes.length);
        assert.ok(scan.indexOf('caseValue = true;') > -1 && scan.indexOf('caseValue = false;') > -1,
            'the driver\'s "true"/"false" coercion (#B129) stays');
    });

    it('02.3 - CONTROL: the scan still reads the driver\'s value once, before the conditions are filtered', function () {
        var scan = activeLines(sliceScan(feSrc));
        assert.equal(scan.indexOf(SCAN_START), 0, 'the scan opens on the driver\'s value');
        assert.equal(scan.split(SCAN_START).length - 1, 1, 'read once per block');
        assert.ok(scan.indexOf('for (var _c = 0, _cLen = rules[c].conditions.length; _c < _cLen; ++_c) {') > 0,
            'the condition loop follows the driver\'s value');
    });
});

// ---------------------------------------------------------------------------
// §03 — forEachField on the real bytes
// ---------------------------------------------------------------------------
describe('validator-case-later-condition-b920 §03 — a later condition is matched against the driver', function () {

    it('03.1 - #B920: a later condition whose case equals another field\'s value does not apply', function () {
        var res = driveFE(feSrc, laterShape({ later: 'n', note: 'n' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.deepEqual(namedEntries(res.applied, 'choice'), [], 'the driver is `a`, the case `n` is note\'s value');
        assert.deepEqual(namedEntries(res.added, 'choice'), []);
    });

    it('03.2 - #B920: nor does a later boolean case after a field whose rule says isBoolean', function () {
        var res = driveFE(feSrc, laterShape({ later: true, note: 'true', noteRule: { isBoolean: true }, ownNoteRule: { isBoolean: true } }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.deepEqual(namedEntries(res.applied, 'choice'), [], 'note\'s value coerced to true is not the driver\'s');
        assert.deepEqual(namedEntries(res.added, 'choice'), []);
    });

    it('03.3 - CONTROL: the later case matches neither — nothing is applied', function () {
        var res = driveFE(feSrc, laterShape({ later: 'n', note: 'm' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.deepEqual(namedEntries(res.applied, 'choice'), []);
        assert.deepEqual(namedEntries(res.added, 'choice'), []);
    });

    it('03.4 - CONTROL: a later condition that matches the driver applies', function () {
        var res = driveFE(feSrc, laterShape({ later: 'a', note: 'n' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var choice = namedEntries(res.applied, 'choice');
        assert.ok(choice.length > 0, 'both conditions match `a`');
        assert.deepEqual(choice[0].rule, { isRequired: true });
        assert.deepEqual(namedEntries(res.added, 'choice'), [{ name: 'choice', value: '' }]);
    });

    it('03.5 - SUBTRACT: put the write back into site B and the later condition applies again', function () {
        var reinsert = feSrc.replace(SITE_B_START, SITE_B_START + '\ncaseValue = fields[caseField];');
        assert.notEqual(reinsert, feSrc, 'the site B anchor is in the slice');
        var res = driveFE(reinsert, laterShape({ later: 'n', note: 'n' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(namedEntries(res.applied, 'choice').length > 0, 'the write is the cause');
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity: both bundles carry the change
// ---------------------------------------------------------------------------
describe('validator-case-later-condition-b920 §04 — dist fidelity', function () {

    it('04.1 - gina.js (the Closure input): site B writes no caseValue', function () {
        var raw = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
        var writes = activeLines(sliceSiteB(sliceForEachField(raw))).match(CASE_VALUE_WRITE_RE) || [];
        assert.equal(writes.length, 0);
    });

    it('04.2 - gina.min.js: site B assigns caseField and reads no field value after it', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        // Pre-fix emission (build of 2026-10-18), identifier-agnostic:
        //   (caseField=Ia,r=cb[caseField],typeof jb[caseField]=='undefined'?console.warn('ignoring case `'…
        var written = min.match(/caseField\s*=\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*\[\s*caseField\s*\]/g) || [];
        var coerced = min.match(/\/\^\(true\|false\)\$\/i\.test\(\s*[A-Za-z_$][\w$]*\s*\)\s*&&\s*typeof\s+[A-Za-z_$][\w$]*\[\s*caseField\s*\]/g) || [];
        var assigned = min.match(/caseField\s*=\s*[A-Za-z_$][\w$]*\s*[,;)]/g) || [];
        var warned = min.split("'ignoring case `'").length - 1;
        assert.equal(assigned.length, 1, 'CONTROL: caseField is still assigned once');
        assert.equal(warned, 1, 'CONTROL: the branch\'s warning is in the bundle');
        assert.equal(written.length, 0, 'gina.min.js is what browsers run: no field value read after caseField');
        assert.equal(coerced.length, 0, 'gina.min.js is what browsers run: no isBoolean coercion of it');
    });
});
