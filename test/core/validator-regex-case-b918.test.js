'use strict';
/**
 * The validator fix #B918, pinned in the source and executed on the shipped bytes. The behaviour is
 * driven end to end on the real bundle by `test/e2e/validator-regex-case-b918.spec.js`.
 *
 * A `_case_<driver>` condition whose `case` is written `/pattern/flags` (the form the 0.3.15
 * migration notes show with `"case": "/^individual$/"`) applied nothing: forEachField's first
 * condition scan compared that string with the driver's value (`case != caseValue`) and skipped the
 * condition, so neither a requirement nor an exclude it declares took effect. The scan now reads such
 * a case as a regular expression (`getCaseRegExp`, declared inside forEachField) and tests the
 * driver's value with it. The pattern is taken as written: a character class stays a class, unlike a
 * RegExp rule KEY, whose square brackets are escaped because it matches field names. A value or an
 * Array of values is compared as before, and so is a string the browser does not accept as a regular
 * expression (with a warning).
 *
 *   §01 extraction + controls (the slicers can fail; the harness reaches the code under test)
 *   §02 getCaseRegExp on the real bytes
 *   §03 forEachField on the real bytes
 *   §04 source pins (comment-stripped)
 *   §05 dist fidelity (both bundles)
 *
 * Red-first: `GINA_B918_MAIN_SRC=<file>` points §01–§04 at another copy of the validator source
 * (e.g. `git show <commit>:<path>` before the change), and `GINA_B918_DIST_DIR=<dir>` points §05 at
 * another dist js directory. Every arm must fail there except those labelled CONTROL (§02's arms fail
 * there because the helper does not exist).
 *
 * Usage: node --test test/core/validator-regex-case-b918.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var MAIN     = process.env.GINA_B918_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B918_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

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
// Extraction — forEachField (the slicer of test/core/validator-case-rules-b885.test.js: the function
// holds a commented-out region whose braces do not balance, so a brace walk cannot be used), the
// helper it declares, and the first scan's condition filter.
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

var HELPER_DECL = 'var getCaseRegExp = function(caseDef) {';
var HELPER_END  = "//console.debug('parsing ', fields, $fields, rules);";
var FILTER_FROM = 'for (var _c = 0, _cLen = rules[c].conditions.length; _c < _cLen; ++_c) {';
var FILTER_TO   = '// enter condition rules';

function sliceHelper(src) {
    return between(src, HELPER_DECL, HELPER_END, 'getCaseRegExp');
}
function sliceFilter(src) {
    return between(src, FILTER_FROM, FILTER_TO, 'first-scan filter');
}

// The helper compiled on its own, with a console that records its warnings.
function loadHelper(src) {
    var warns = [];
    var fn = new Function('console', sliceHelper(src) + '\nreturn getCaseRegExp;')({
        warn: function () { warns.push(Array.prototype.join.call(arguments, ' ')); }
    });
    return { getCaseRegExp: fn, warns: warns };
}

// The filter as the fix writes it: the helper's verdict tested against caseValue, and the value
// comparison kept for a case that is neither an Array nor a regular expression.
var FILTER_RE = new RegExp([
    'caseRegExp = getCaseRegExp\\(rules\\[c\\]\\.conditions\\[_c\\]\\.case\\);',
    '[\\s\\S]*?caseRegExp\\s*&& !caseRegExp\\.test\\(caseValue\\)',
    '[\\s\\S]*?!Array\\.isArray\\(rules\\[c\\]\\.conditions\\[_c\\]\\.case\\)\\s*&& !caseRegExp\\s*&& rules\\[c\\]\\.conditions\\[_c\\]\\.case != caseValue'
].join(''));
var BRACKET_ESCAPE = "re.replace(/\\[/g, '\\\\[')";

var feSrc = sliceForEachField(SRC);

// ---------------------------------------------------------------------------
// Harness — forEachField compiled with its free identifiers as parameters (the list of the sibling
// case tests; the helper is declared inside the slice, so the list is unchanged). The
// checkFieldAgainstRules spy mirrors the real function's `delete fields[field]` after an applied
// rule; the engine stub `d` holds one key per field it knows and, like FormValidator's public
// addField, ignores a name it already holds. `console` is passed in to record the warnings.
// ---------------------------------------------------------------------------
var FE_PARAMS = [
    'isGFFCtx', '$allFields', 'checkFieldAgainstRules', 'merge',
    'subLevelRules', 'fieldErrorsAttributes', 'd', 'formatData', 'envIsDev',
    'gina', 'window', 'triggerEvent', 'addListener', 'removeListener',
    'instance', 'evt', 'hasParsedAllRules', 'hasBeenValidated', 'asyncCount',
    'data', 'id', 're', 'flags', 'caseField', 'console',
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
 * @returns {{applied: Array<object>, added: Array<object>, warns: Array<string>, thrown: (Error|null)}}
 */
function driveFE(src, opts) {
    var applied = [], added = [], warns = [];
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
            { debug: function () {}, warn: function () { warns.push(Array.prototype.join.call(arguments, ' ')); } },
            clone(opts.fields),                     // allFields
            clone(opts.rules),                      // allRules
            clone(opts.fields),                     // fields
            opts.$fields,
            clone(opts.rules)                       // rules
        );
    } catch (err) { thrown = err; }
    return { applied: applied, added: added, warns: warns, thrown: thrown };
}

/**
 * One condition whose case is `caseDef`: it requires the radio group `choice` (no rule of its own,
 * unpicked) and excludes the text field `note`. The driver `kind` is a select (or a radio) at `kind`.
 *
 * @param {*} caseDef
 * @param {object} [o]
 * @param {string} [o.kind='a'] - the driver's value
 * @param {string} [o.driverType='select-one']
 * @returns {{rules: object, fields: object, $fields: object}}
 */
function shape(caseDef, o) {
    o = o || {};
    var kind = (typeof (o.kind) != 'undefined') ? o.kind : 'a';
    return {
        rules: { ref: { isRequired: true }, _case_kind: { conditions: [
            { case: caseDef, rules: { choice: { isRequired: true }, note: { exclude: true } } }
        ] } },
        fields: { ref: 'x', kind: kind, note: 'n' },
        $fields: {
            ref: mkControl('ref', 'text', 'x'),
            kind: mkControl('kind', o.driverType || 'select-one', kind),
            note: mkControl('note', 'text', 'n'),
            choice: mkControl('choice', 'radio', 'c1')
        }
    };
}

/**
 * Two conditions: the first matches `kind` at `a` and names `note` (value `note`); the second's case
 * is `second` and requires `choice`.
 */
function twoShape(second, note) {
    return {
        rules: { ref: { isRequired: true }, _case_kind: { conditions: [
            { case: 'a', rules: { note: { isString: true } } },
            { case: second, rules: { choice: { isRequired: true } } }
        ] } },
        fields: { ref: 'x', kind: 'a', note: note },
        $fields: {
            ref: mkControl('ref', 'text', 'x'),
            kind: mkControl('kind', 'select-one', 'a'),
            note: mkControl('note', 'text', note),
            choice: mkControl('choice', 'radio', 'c1')
        }
    };
}

function namedEntries(list, name) {
    return list.filter(function (c) { return c.name === name; });
}

/** True when the condition applied: choice adjudicated with its case rule as '', note excluded. */
function applied(res) {
    var choice = namedEntries(res.applied, 'choice');
    var note = namedEntries(res.applied, 'note');
    return choice.length > 0
        && JSON.stringify(choice[0].rule) === '{"isRequired":true}'
        && choice[0].value === ''
        && note.length > 0
        && note.every(function (c) { return JSON.stringify(c.rule) === '{"exclude":true}'; });
}

/** True when the condition applied nothing. */
function nothing(res) {
    return namedEntries(res.applied, 'choice').length === 0
        && namedEntries(res.added, 'choice').length === 0
        && namedEntries(res.applied, 'note').length === 0;
}

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-regex-case-b918 §01 — extraction + controls', function () {

    it('01.1 - CONTROL: the forEachField slice resolves, is substantial, and compiles', function () {
        assert.equal(feSrc.indexOf(FE_DECL), 0, 'the slice starts at the declaration');
        assert.ok(feSrc.length > 20000, 'slice suspiciously small: ' + feSrc.length);
        assert.doesNotThrow(function () { compileFE(feSrc); });
    });

    it('01.2 - CONTROL: the slicers can fail — a bogus anchor throws', function () {
        assert.throws(function () { sliceForEachField(SRC.replace(FE_DECL, 'var notForEachField = function() {')); },
            /declaration not found/);
        assert.throws(function () { sliceFilter(feSrc.replace(FILTER_TO, '// gone')); }, /end anchor not found/);
        assert.throws(function () { sliceHelper('var x = 1;'); }, /start anchor not found/);
    });

    it('01.3 - CONTROL: the harness reaches the condition — a plain case applies its rules', function () {
        var res = driveFE(feSrc, shape('a'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(applied(res), 'if this fails, every §03 assertion is meaningless: ' + JSON.stringify(res.applied));
    });
});

// ---------------------------------------------------------------------------
// §02 — getCaseRegExp on the real bytes
// ---------------------------------------------------------------------------
describe('validator-regex-case-b918 §02 — getCaseRegExp', function () {

    it('02.1 - #B918: a `/pattern/flags` string gives the RegExp it describes, flags included', function () {
        var h = loadHelper(feSrc);
        var re = h.getCaseRegExp('/^(a|b)$/i');
        assert.ok(re instanceof RegExp);
        assert.equal(re.source, '^(a|b)$');
        assert.equal(re.flags, 'i');
        assert.ok(re.test('A'));
        assert.equal(h.warns.length, 0);
    });

    it('02.2 - #B918: square brackets stay a character class', function () {
        var re = loadHelper(feSrc).getCaseRegExp('/^[ab]$/');
        assert.ok(re.test('a') && re.test('b'));
        assert.equal(re.test('[ab]'), false);
    });

    it('02.3 - #B918: a slash inside the pattern belongs to it', function () {
        var re = loadHelper(feSrc).getCaseRegExp('/^a\\/b$/');
        assert.ok(re.test('a/b'));
    });

    it('02.4 - #B918: anything else is not a regular expression', function () {
        var h = loadHelper(feSrc);
        [ 'a', '', '/home', 'a/b/', ['a'], true, 5, null, undefined, { a: 1 } ].forEach(function (v) {
            assert.equal(h.getCaseRegExp(v), null, JSON.stringify(v));
        });
        assert.equal(h.warns.length, 0, 'no warning for a value');
    });

    it('02.5 - #B918: a pattern the engine rejects returns null and warns, naming the case', function () {
        var h = loadHelper(feSrc);
        assert.equal(h.getCaseRegExp('/(/'), null);
        assert.equal(h.getCaseRegExp('/a/q'), null, 'an unknown flag');
        assert.equal(h.warns.length, 2);
        assert.ok(h.warns[0].indexOf('/(/') > -1, h.warns[0]);
        assert.ok(h.warns[1].indexOf('/a/q') > -1, h.warns[1]);
    });
});

// ---------------------------------------------------------------------------
// §03 — forEachField on the real bytes
// ---------------------------------------------------------------------------
describe('validator-regex-case-b918 §03 — a regex case is tested against the driver', function () {

    it('03.1 - #B918: a matching regex case applies its requirement and its exclude (select driver)', function () {
        var res = driveFE(feSrc, shape('/^(a|b)$/i'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(applied(res), JSON.stringify(res.applied));
        assert.deepEqual(namedEntries(res.added, 'choice'), [{ name: 'choice', value: '' }]);
    });

    it('03.2 - #B918: the same with a radio driver', function () {
        var res = driveFE(feSrc, shape('/^(a|b)$/i', { driverType: 'radio' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(applied(res), JSON.stringify(res.applied));
    });

    it('03.3 - #B918: the flags apply — /^(A|B)$/i matches a', function () {
        var res = driveFE(feSrc, shape('/^(A|B)$/i'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(applied(res), JSON.stringify(res.applied));
    });

    it('03.4 - #B918: a character class matches — /^[ab]$/ matches a', function () {
        var res = driveFE(feSrc, shape('/^[ab]$/'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(applied(res), JSON.stringify(res.applied));
    });

    it('03.5 - #B918: a regex condition after a matched condition is tested against the driver', function () {
        var res = driveFE(feSrc, twoShape('/^(a|b)$/', 'n'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var choice = namedEntries(res.applied, 'choice');
        assert.ok(choice.length > 0, 'the second condition matches a');
        assert.deepEqual(choice[0].rule, { isRequired: true });
    });

    it('03.6 - #B918: a pattern the engine rejects is compared as a value, with a warning', function () {
        var res = driveFE(feSrc, shape('/(/'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(nothing(res), JSON.stringify(res.applied));
        assert.ok(res.warns.length > 0 && res.warns[0].indexOf('/(/') > -1, JSON.stringify(res.warns));
    });

    it('03.7 - CONTROL: a regex case that does not match applies nothing', function () {
        var res = driveFE(feSrc, shape('/^z$/'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(nothing(res), JSON.stringify(res.applied));
    });

    it('03.8 - CONTROL: without the i flag, /^(A|B)$/ does not match a', function () {
        var res = driveFE(feSrc, shape('/^(A|B)$/'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(nothing(res), JSON.stringify(res.applied));
    });

    it('03.9 - CONTROL: a plain case and an Array case apply as before', function () {
        [ 'a', ['a', 'b'] ].forEach(function (c) {
            var res = driveFE(feSrc, shape(c));
            assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
            assert.ok(applied(res), JSON.stringify(c) + ': ' + JSON.stringify(res.applied));
        });
        assert.ok(nothing(driveFE(feSrc, shape('b'))), 'a plain case that does not match');
    });

    it('03.10 - CONTROL: a string with a leading slash and no closing one is compared as a value', function () {
        assert.ok(applied(driveFE(feSrc, shape('/home', { kind: '/home' }))), 'equal: applies');
        assert.ok(nothing(driveFE(feSrc, shape('/home', { kind: 'home' }))), 'different: nothing');
    });

    it('03.11 - CONTROL (#B920): a regex condition after a matched one is not tested against the named field', function () {
        var res = driveFE(feSrc, twoShape('/^n$/', 'n'));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.deepEqual(namedEntries(res.applied, 'choice'), [], 'note holds n, the driver is a');
    });
});

// ---------------------------------------------------------------------------
// §04 — source pins (comment-stripped)
// ---------------------------------------------------------------------------
describe('validator-regex-case-b918 §04 — source pins', function () {

    it('04.1 - #B918: the first scan\'s filter tests a regex case and compares any other case as before', function () {
        assert.match(activeLines(sliceFilter(feSrc)), FILTER_RE);
    });

    it('04.2 - #B918: getCaseRegExp reads `/pattern/flags` and escapes no bracket', function () {
        var helper = activeLines(sliceHelper(feSrc));
        assert.ok(helper.indexOf('caseDef.match(/^\\/(.*)\\/([a-z]*)$/)') > -1, 'the pattern and flags are captured');
        assert.ok(helper.indexOf('new RegExp(m[1], m[2])') > -1, 'built from them as written');
        assert.equal(helper.indexOf(".replace(/\\["), -1, 'no bracket escaping: a case pattern matches values');
    });

    it('04.3 - CONTROL: the RegExp rule-key branches still escape brackets (they match field names)', function () {
        assert.equal(activeLines(feSrc).split(BRACKET_ESCAPE).length - 1, 3, 'the regex-key branch, and the second scan\'s two');
    });
});

// ---------------------------------------------------------------------------
// §05 — dist fidelity: both bundles carry the change
// ---------------------------------------------------------------------------
describe('validator-regex-case-b918 §05 — dist fidelity', function () {

    it('05.1 - gina.js (the Closure input) carries the helper and the filter', function () {
        var fe = sliceForEachField(fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8'));
        assert.match(activeLines(sliceFilter(fe)), FILTER_RE);
        assert.ok(activeLines(sliceHelper(fe)).indexOf('new RegExp(m[1], m[2])') > -1);
    });

    it('05.2 - gina.min.js carries the helper\'s pattern and its warning', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        // Closure keeps a RegExp literal and a string as written; both read 0 on the bundle built
        // before the change.
        assert.equal(min.split('/^\\/(.*)\\/([a-z]*)$/').length - 1, 1, 'gina.min.js is what browsers run: the parser');
        assert.equal(min.split('is not a valid regular expression').length - 1, 1, 'gina.min.js is what browsers run: the warning');
    });
});
