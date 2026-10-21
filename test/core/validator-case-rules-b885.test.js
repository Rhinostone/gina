'use strict';
/**
 * The validator fixes #B885, #B913, #B914 and #B915, pinned in the source and executed on the shipped
 * bytes. The behaviour is driven end-to-end on the real bundle by
 * `test/e2e/validator-case-rules-b885.spec.js`.
 *
 *  - #B885 / #B913 — `validate()` works on its own copy of the rules when the rule set carries no
 *    `$` (a `$`-bearing set already got one from getDynamisedRules). forEachField writes into the
 *    rule set it is handed: a matching `_case_` condition's rules over the field's own, and
 *    `{ exclude: true }` over an unchecked optional checkbox. Those writes reached the object the
 *    caller holds (the bound form's rules, or the registry rule set several forms share) and
 *    outlived the pass.
 *  - #B914 — a radio or checkbox group that a matching `_case_` condition requires, which the pass
 *    never collected (the collector reads only the field's own rule, #B221), is entered as '' so
 *    isRequired adjudicates it, once per pass.
 *  - #B915 — the whole-form pass that follows a select's live check collects the form with the
 *    form's own rules. It used bindForm's `rules`, the rule registry keyed by rule-set name, so no
 *    field had a rule there and an unpicked required radio group was not collected.
 *
 *   §01 extraction + controls (the slicers can fail; the harness reaches the code under test)
 *   §02 source pins (comment-stripped) and the premises they rest on (#B915: source pin only;
 *       its behaviour is driven by the e2e spec)
 *   §03 the validate() prologue on the real bytes (#B885 / #B913)
 *   §04 forEachField on the real bytes (#B914)
 *   §05 dist fidelity (both bundles carry both changes)
 *
 * Red-first: `GINA_B885_MAIN_SRC=<file>` points §01–§04 at another copy of the validator source
 * (e.g. `git show <commit>:<path>` before the change), and `GINA_B885_DIST_DIR=<dir>` points §05 at
 * another dist js directory. Every arm must fail there except those labelled CONTROL.
 *
 * Usage: node --test test/core/validator-case-rules-b885.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW           = require('../fw');
var REPO         = path.resolve(__dirname, '..', '..');
var MAIN         = process.env.GINA_B885_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR     = process.env.GINA_B885_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');
var POLYFILL     = path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/polyfill.js');
var SERVER_CLONE = path.join(REPO, 'utils/prototypes.json_clone.js');

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
// Extraction — the validate() prologue (from the stringified rules to the var block that follows)
// and forEachField, sliced from the shipped bytes and executed. No replica.
// ---------------------------------------------------------------------------
var PROLOGUE_START = 'var stringifiedRules = JSON.stringify(rules);';
var PROLOGUE_END   = '\n        var id                  = null';

function slicePrologue(src) {
    return between(src, PROLOGUE_START, PROLOGUE_END, 'validate() prologue');
}

// Same slicer as test/core/validator-case-driver-value-preservation.test.js: forEachField holds a
// commented-out region whose braces do not balance, so a brace walk cannot be used.
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

// The #B914 block sits between the matched condition's rule write and the 2/3 check.
var CASE_WRITE  = 'rules[_r] = localRuleObj;';
var CHECK_2_3   = '// check each field against rule only if rule exists 2/3';

function sliceCaseSpan(src) {
    return between(src, CASE_WRITE, CHECK_2_3, 'case write → 2/3 check');
}

// #B915 — updateSelect, from its declaration to its whole-form pass's callback.
var UPDATE_SELECT_DECL = 'var updateSelect = function($el, $form) {';
var UPDATE_SELECT_END  = "console.debug('[updateSelect]: onSilentGlobalLiveValidation: '";

var prologueSrc = slicePrologue(SRC);
var feSrc       = sliceForEachField(SRC);

// ---------------------------------------------------------------------------
// Pins shared by the source (§02) and the unminified bundle (§05)
// ---------------------------------------------------------------------------
var ELSE_CLONE_RE = /rules = getDynamisedRules\(stringifiedRules, fields, \$fields, isLiveCheckingOnASingleElement\)\s*\}\s*else\s*\{\s*rules = JSON\.clone\(rules\);\s*\}/;
var B914_BLOCK_RE = new RegExp([
    "if \\(\\s*typeof\\(fields\\[_r\\]\\) == 'undefined'",
    "\\s*&& typeof\\(d\\[_r\\]\\) == 'undefined'",
    "\\s*&& \\/\\^\\(radio\\|checkbox\\)\\$\\/i\\.test\\(\\$fields\\[_r\\]\\.type\\)",
    "\\s*&& localRuleObj",
    "\\s*&& \\/\\^true\\$\\/i\\.test\\(localRuleObj\\.isRequired\\)",
    "\\s*\\) \\{",
    "\\s*fields\\[_r\\] = '';",
    "\\s*d\\.addField\\(_r, fields\\[_r\\]\\);",
    "\\s*\\}"
].join(''));

// ---------------------------------------------------------------------------
// Harness — the prologue
// ---------------------------------------------------------------------------
var JSON_SHADOW = { stringify: JSON.stringify, parse: JSON.parse, clone: require(SERVER_CLONE) };
var DYNAMISED = { dynamised: true };

/**
 * Runs the prologue slice on `rules` and returns the rule set the pass goes on with.
 *
 * @param {object} rules - the caller's rule set
 * @returns {{out: object, dynamisedCalls: Array<string>}}
 */
function runPrologue(rules) {
    var dynamisedCalls = [];
    var fn = new Function('JSON', 'fields', 'rules', '$fields', '$formOrElement', 'formatFields', 'getDynamisedRules',
        prologueSrc + '\nreturn rules;');
    var out = fn(JSON_SHADOW, { ref: 'x' }, rules, null, null,
        function (stringifiedRules, fields) { return fields; },
        function (stringifiedRules) { dynamisedCalls.push(stringifiedRules); return DYNAMISED; });
    return { out: out, dynamisedCalls: dynamisedCalls };
}

/** The #B885 shape: `extra` has a rule of its own that `_case_kind` overrides at kind b. */
function caseRules() {
    return {
        ref: { isRequired: true },
        extra: { isRequired: false },
        _case_kind: { conditions: [{ case: 'b', rules: { extra: { isRequired: true } } }] }
    };
}

// ---------------------------------------------------------------------------
// Harness — forEachField. The slice is compiled with its free identifiers as parameters (the list
// of the sibling case-driver test). The checkFieldAgainstRules spy mirrors the real function's
// `delete fields[field]` after an applied rule; the engine stub `d` holds one key per field it
// knows, as FormValidator does, and its addField records each call.
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
 * A control stub. The #B914 guard reads the `type` PROPERTY; the rest of forEachField reads
 * `getAttribute('type')` (null for a select, as in a real DOM).
 *
 * @param {string} name
 * @param {string} type - `text`, `select-one`, `radio`, `checkbox`, `file`, …
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
 * The #B914 shape: `choice` has no rule of its own; `_case_kind` requires it at kind b.
 *
 * @param {object} [o]
 * @param {string} [o.kind='b'] - the driver's collected value
 * @param {string} [o.type='radio'] - the type of the `choice` control
 * @param {object} [o.caseRule] - the condition's rule for `choice`
 * @param {string} [o.choice] - a collected value for `choice` (absent by default)
 * @param {boolean} [o.third] - collect a third field, `note`, after the driver
 * @returns {{rules: object, fields: object, $fields: object}}
 */
function groupShape(o) {
    o = o || {};
    var kind = (typeof (o.kind) != 'undefined') ? o.kind : 'b';
    var fields = { ref: 'x', kind: kind };
    var $fields = {
        ref: mkControl('ref', 'text', 'x'),
        kind: mkControl('kind', 'select-one', kind),
        choice: mkControl('choice', o.type || 'radio', 'x')
    };
    if (typeof (o.choice) != 'undefined') { fields.choice = o.choice; }
    if (o.third) {
        fields.note = 'n';
        $fields.note = mkControl('note', 'text', 'n');
    }
    return {
        rules: {
            ref: { isRequired: true },
            _case_kind: { conditions: [{ case: 'b', rules: { choice: o.caseRule || { isRequired: true } } }] }
        },
        fields: fields,
        $fields: $fields
    };
}

function namedEntries(list, name) {
    return list.filter(function (c) { return c.name === name; });
}

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-case-rules-b885 §01 — extraction + controls', function () {

    it('01.1 - CONTROL: the prologue slice resolves, is bounded, and compiles', function () {
        assert.equal(prologueSrc.indexOf(PROLOGUE_START), 0, 'the slice starts at the stringified rules');
        assert.ok(prologueSrc.length > 200 && prologueSrc.length < 6000, 'slice length: ' + prologueSrc.length);
        assert.ok(prologueSrc.indexOf('getDynamisedRules(stringifiedRules') > -1, 'the slice holds the `$` branch');
        assert.doesNotThrow(function () { runPrologue(caseRules()); });
    });

    it('01.2 - CONTROL: the forEachField slice resolves, is substantial, and compiles', function () {
        assert.equal(feSrc.indexOf(FE_DECL), 0, 'the slice starts at the declaration');
        assert.ok(feSrc.length > 20000, 'slice suspiciously small: ' + feSrc.length);
        assert.ok(/\}$/.test(feSrc), 'the slice ends on a closing brace');
        assert.doesNotThrow(function () { compileFE(feSrc); });
    });

    it('01.3 - CONTROL: the slicers can fail — a bogus anchor throws', function () {
        assert.throws(function () { slicePrologue(SRC.replace(PROLOGUE_START, 'var notStringifiedRules = 1;')); },
            /start anchor not found/);
        assert.throws(function () { slicePrologue(SRC + '\n' + PROLOGUE_START); }, /start anchor not unique/);
        assert.throws(function () { sliceForEachField(SRC.replace(FE_DECL, 'var notForEachField = function() {')); },
            /declaration not found/);
        assert.throws(function () { sliceCaseSpan(SRC.replace(CHECK_2_3, '// gone')); }, /end anchor not found/);
    });

    it('01.4 - CONTROL: the forEachField harness reaches adjudication — the base rule of `ref` runs', function () {
        var res = driveFE(feSrc, groupShape());
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var ref = namedEntries(res.applied, 'ref');
        assert.equal(ref.length, 1, 'if this fails, every §04 assertion is meaningless');
        assert.deepEqual(ref[0].rule, { isRequired: true });
    });

    it('01.5 - CONTROL: the harness reaches the matched condition — a collected `choice` is adjudicated with the case rule', function () {
        var res = driveFE(feSrc, groupShape({ choice: 'y' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var rules = namedEntries(res.applied, 'choice').map(function (c) { return c.rule; });
        assert.ok(rules.length > 0, 'the matched condition writes its rule and a check runs it');
        rules.forEach(function (r) { assert.deepEqual(r, { isRequired: true }); });
    });
});

// ---------------------------------------------------------------------------
// §02 — source pins (comment-stripped) and the premises they rest on
// ---------------------------------------------------------------------------
describe('validator-case-rules-b885 §02 — source pins', function () {

    it('02.1 - #B885: the prologue\'s non-`$` branch works on JSON.clone(rules)', function () {
        assert.match(activeLines(prologueSrc), ELSE_CLONE_RE,
            'the `$` branch parses a copy; the other branch must copy too, or the pass writes into the caller\'s rules');
    });

    it('02.2 - #B914: the matched-condition branch enters an uncollected required radio or checkbox group', function () {
        assert.match(activeLines(sliceCaseSpan(feSrc)), B914_BLOCK_RE,
            'between the case rule write and the 2/3 check: guarded on fields[_r] AND d[_r], type, and the case\'s isRequired');
    });

    it('02.3 - CONTROL: premise — both JSON.clone implementations return a non-plain object as is', function () {
        var line = 'if (source.constructor != Object && source.constructor != Array) return source;';
        var poly = fs.readFileSync(POLYFILL, 'utf8');
        var server = fs.readFileSync(SERVER_CLONE, 'utf8');
        var polyBody = between(poly, 'var clone = function(source, target) {', 'JSON.clone = clone;', 'polyfill clone');
        var serverBody = between(server, 'function JSONClone(source, target) {', 'module.exports = JSONClone', 'server clone');
        assert.ok(polyBody.indexOf(line) > -1, 'the browser clone keeps a RegExp condition by reference');
        assert.ok(serverBody.indexOf(line) > -1, 'the server clone keeps a RegExp condition by reference');
    });

    it('02.4 - CONTROL: premise — checkFieldAgainstRules deletes each adjudicated field from the object it is handed', function () {
        var fn = between(SRC, 'var checkFieldAgainstRules = function(field, rules, fields) {', FE_DECL, 'checkFieldAgainstRules');
        assert.match(fn, /\n\s*delete fields\[field\];\n/,
            'why the #B914 guard also reads d[_r]: after the check, fields[_r] is gone and a later field\'s scan would re-enter the group');
    });

    it('02.5 - #B915: updateSelect\'s whole-form pass collects with the form\'s own rules', function () {
        var span = activeLines(between(SRC, UPDATE_SELECT_DECL, UPDATE_SELECT_END, 'updateSelect'));
        var formIdAt = span.indexOf("var formId = $gForm.getAttribute('id');");
        assert.ok(formIdAt > -1, 'the form id is read in the pass');
        assert.ok(span.indexOf('getFormValidationInfos($gForm, instance.$forms[formId].rules)') > formIdAt,
            'the collection reads the rule set the pass then validates with');
        assert.equal(span.indexOf('getFormValidationInfos($gForm, rules)'), -1,
            '`rules` there is bindForm\'s rule registry, keyed by rule-set name');
    });
});

// ---------------------------------------------------------------------------
// §03 — the validate() prologue on the real bytes (#B885 / #B913)
// ---------------------------------------------------------------------------
describe('validator-case-rules-b885 §03 — the prologue works on a copy', function () {

    it('03.1 - #B885: with no `$`, the pass goes on with a different object, equal to the caller\'s', function () {
        var rules = caseRules();
        var res = runPrologue(rules);
        assert.notEqual(res.out, rules, 'the pass must not hold the caller\'s object');
        assert.deepEqual(res.out, caseRules());
        assert.equal(res.dynamisedCalls.length, 0, 'no `$`: getDynamisedRules is not called');
    });

    it('03.2 - #B885: a case rule written over a field\'s own rule stays in the pass', function () {
        var rules = caseRules();
        var out = runPrologue(rules).out;
        out.extra = out._case_kind.conditions[0].rules.extra;
        assert.deepEqual(rules.extra, { isRequired: false }, 'the caller\'s `extra` keeps its own rule');
    });

    it('03.3 - #B885: a write into a condition\'s own rule object (merge() mutates its first argument) stays in the pass', function () {
        var rules = caseRules();
        var out = runPrologue(rules).out;
        out._case_kind.conditions[0].rules.extra.isString = true;
        assert.deepEqual(rules._case_kind.conditions[0].rules.extra, { isRequired: true },
            'the caller\'s condition is untouched');
    });

    it('03.4 - #B913: `{ exclude: true }` written over an unchecked optional checkbox stays in the pass', function () {
        var rules = { ref: { isRequired: true }, agree: { isRequired: false, isBoolean: true } };
        var out = runPrologue(rules).out;
        out.agree = { exclude: true };
        assert.deepEqual(rules.agree, { isRequired: false, isBoolean: true },
            'a checkbox ticked after this pass is collected under its own rule again');
    });

    it('03.5 - CONTROL: a `$`-bearing rule set goes through getDynamisedRules', function () {
        var rules = { ref: { isRequired: true, is: '/^[a-z0-9]+$/' } };
        var res = runPrologue(rules);
        assert.equal(res.out, DYNAMISED, 'the `$` branch returns what getDynamisedRules parsed');
        assert.deepEqual(res.dynamisedCalls, [JSON.stringify(rules)]);
    });

    it('03.6 - CONTROL: a RegExp value is kept by reference (a JSON round trip would turn it into {})', function () {
        var re = /^b/;
        var rules = { ref: { isRequired: true }, _case_kind: { conditions: [{ case: re, rules: { extra: { isRequired: true } } }] } };
        var out = runPrologue(rules).out;
        assert.equal(out._case_kind.conditions[0].case, re);
    });
});

// ---------------------------------------------------------------------------
// §04 — forEachField on the real bytes (#B914)
// ---------------------------------------------------------------------------
describe('validator-case-rules-b885 §04 — an uncollected group the case requires is adjudicated', function () {

    it('04.1 - #B914: a radio group is entered as \'\' and adjudicated with the case\'s isRequired', function () {
        var res = driveFE(feSrc, groupShape());
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var choice = namedEntries(res.applied, 'choice');
        assert.ok(choice.length > 0, 'the group is never adjudicated: the first submit goes out without it');
        assert.deepEqual(choice[0].rule, { isRequired: true });
        assert.equal(choice[0].value, '');
        assert.deepEqual(namedEntries(res.added, 'choice'), [{ name: 'choice', value: '' }]);
    });

    it('04.2 - #B914: a checkbox group the same', function () {
        var res = driveFE(feSrc, groupShape({ type: 'checkbox' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var choice = namedEntries(res.applied, 'choice');
        assert.equal(choice.length, 1);
        assert.deepEqual(choice[0].rule, { isRequired: true });
        assert.equal(choice[0].value, '');
    });

    it('04.3 - #B914: entered once per pass — two outer fields after it scan the case again', function () {
        var res = driveFE(feSrc, groupShape({ third: true }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.equal(namedEntries(res.applied, 'choice').length, 1, 'adjudicated once');
        assert.equal(namedEntries(res.added, 'choice').length, 1, 'added to the engine once');
    });

    it('04.4 - CONTROL: the case does not match — nothing is entered', function () {
        var res = driveFE(feSrc, groupShape({ kind: 'a' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.deepEqual(namedEntries(res.applied, 'choice'), []);
        assert.deepEqual(namedEntries(res.added, 'choice'), []);
    });

    it('04.5 - CONTROL: a file input is not entered (a staged upload posts through its hidden fields)', function () {
        var res = driveFE(feSrc, groupShape({ type: 'file' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.deepEqual(namedEntries(res.applied, 'choice'), []);
        assert.deepEqual(namedEntries(res.added, 'choice'), []);
    });

    it('04.6 - CONTROL: a condition that does not require the group enters nothing', function () {
        var res = driveFE(feSrc, groupShape({ caseRule: { isRequired: false } }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.deepEqual(namedEntries(res.applied, 'choice'), []);
        assert.deepEqual(namedEntries(res.added, 'choice'), []);
    });

    it('04.7 - CONTROL: a collected group keeps its value and is not added again', function () {
        // A collected field is checked once per later field whose scan meets the case: the check
        // deletes fields[_r], and the scan's « not yet listed » branch pulls it back from allFields.
        // An entered group has no allFields entry, so it is checked once (04.3).
        var res = driveFE(feSrc, groupShape({ choice: 'y' }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        var values = namedEntries(res.applied, 'choice').map(function (c) { return c.value; });
        assert.ok(values.length > 0, 'the collected group is adjudicated');
        values.forEach(function (v) { assert.equal(v, 'y', 'never the empty value #B914 enters'); });
        assert.deepEqual(namedEntries(res.added, 'choice'), []);
    });

    it('04.8 - #B914 SUBTRACT: without the d[_r] guard, a later field\'s scan enters the group again', function () {
        var guard = /\n[ \t]*&& typeof\(d\[_r\]\) == 'undefined'/g;
        var hits = feSrc.match(guard) || [];
        if (hits.length !== 1) { throw new Error('the d[_r] guard is not in the slice exactly once (' + hits.length + ')'); }
        var res = driveFE(feSrc.replace(guard, ''), groupShape({ third: true }));
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(namedEntries(res.applied, 'choice').length > 1,
            'the guard is load-bearing: checkFieldAgainstRules deletes fields[_r], so fields[_r] alone re-enters');
    });
});

// ---------------------------------------------------------------------------
// §05 — dist fidelity: both bundles carry both changes
// ---------------------------------------------------------------------------
describe('validator-case-rules-b885 §05 — dist fidelity', function () {

    it('05.1 - gina.js (the Closure input) carries the prologue copy and the #B914 block', function () {
        var raw = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
        assert.match(activeLines(slicePrologue(raw)), ELSE_CLONE_RE, 'the prologue copy rides into dist');
        assert.match(activeLines(sliceCaseSpan(raw)), B914_BLOCK_RE, 'the #B914 block rides into dist');
    });

    it('05.2 - gina.min.js carries both, in minified form', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        // Measured emission (build of 2026-10-18), identifier-agnostic and wrap-agnostic:
        //   /\$(.*)/.test(e)?(h=…,h=Nc(e,b,c,h)):h=JSON.clone(h)
        //   typeof db[za]=='undefined'&&typeof hb[za]=='undefined'&&/^(radio|checkbox)$/i.test(kb[za].type)
        //     &&Gb&&/^true$/i.test(Gb.isRequired)&&(db[za]='',hb.addField(za,db[za]))
        // Both read 0 on the bundle built before the change.
        var copy = min.match(/\/\\\$\(\.\*\)\/\.test\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\?\s*\([\s\S]{0,400}?\)\s*:\s*([A-Za-z_$][\w$]*)\s*=\s*JSON\.clone\(\s*\2\s*\)/g) || [];
        var block = min.match(/typeof\s+([A-Za-z_$][\w$]*)\s*\[\s*([A-Za-z_$][\w$]*)\s*\]\s*==\s*'undefined'\s*&&\s*typeof\s+([A-Za-z_$][\w$]*)\s*\[\s*\2\s*\]\s*==\s*'undefined'\s*&&\s*\/\^\(radio\|checkbox\)\$\/i\.test\(\s*[A-Za-z_$][\w$]*\s*\[\s*\2\s*\]\s*\.type\s*\)\s*&&\s*([A-Za-z_$][\w$]*)\s*&&\s*\/\^true\$\/i\.test\(\s*\4\s*\.isRequired\s*\)\s*&&\s*\(\s*\1\s*\[\s*\2\s*\]\s*=\s*''\s*,\s*\3\s*\.addField\(\s*\2\s*,\s*\1\s*\[\s*\2\s*\]\s*\)\s*\)/g) || [];
        assert.equal(copy.length, 1, 'gina.min.js is what browsers run: the prologue copy');
        assert.equal(block.length, 1, 'gina.min.js is what browsers run: the #B914 block');
    });

    it('05.3 - #B915: both bundles collect with the form\'s own rules after a select change', function () {
        var raw = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
        assert.equal(raw.split('getFormValidationInfos($gForm, instance.$forms[formId].rules)').length - 1, 1,
            'gina.js carries the call');
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        // Measured emission (build of 2026-10-18), identifier-agnostic:
        //   Cb=Sa.getAttribute('id');Pa=cc(Xb(Sa,l.$forms[Cb].rules))
        // It reads 0 on the bundle built before the change, which collected with `Yb(Sa,q)`.
        var hits = min.match(/([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.getAttribute\(\s*'id'\s*\)\s*;\s*[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*\(\s*[A-Za-z_$][\w$]*\(\s*\2\s*,\s*[A-Za-z_$][\w$]*\.\$forms\[\s*\1\s*\]\.rules\s*\)\s*\)/g) || [];
        assert.equal(hits.length, 1, 'gina.min.js is what browsers run');
    });
});
