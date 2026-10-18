'use strict';
/**
 * The validator fix #B916, pinned in the source and executed on the shipped bytes. The behaviour is
 * driven end-to-end on the real bundle by `test/e2e/validator-optional-boolean-checkbox-b916.spec.js`.
 *
 *  - #B916 — a boolean checkbox posts its live state, `false` when unticked (#49). forEachField
 *    replaced the rule of an unticked checkbox whose rule says `isRequired: false` with
 *    `{ exclude: true }`, so the box was left out of the posted data. The collector already rewrote
 *    a boolean checkbox's rule that lacks `isBoolean` to `isRequired: true`, so only a rule that
 *    declares `isBoolean` with `isRequired: false` reached that arm. The arm now leaves a boolean
 *    checkbox alone, classified by isBooleanCheckbox as the collectors do; a disabled box and an
 *    unticked value-carrying one are still left out.
 *
 *   §01 extraction + controls (the slicers can fail; the harness reaches the arm)
 *   §02 source pins (comment-stripped)
 *   §03 forEachField on the real bytes
 *   §04 dist fidelity (both bundles carry the guard, and it calls the classifier)
 *
 * Red-first: `GINA_B916_MAIN_SRC=<file>` points §01–§03 at another copy of the validator source
 * (e.g. `git show <commit>:<path>` before the change), and `GINA_B916_DIST_DIR=<dir>` points §04 at
 * another dist js directory. Every arm must fail there except those labelled CONTROL.
 *
 * Usage: node --test test/core/validator-optional-boolean-checkbox-b916.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var MAIN     = process.env.GINA_B916_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B916_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

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

// ---------------------------------------------------------------------------
// Extraction — forEachField and isBooleanCheckbox, sliced from the shipped bytes and executed.
// No replica.
// ---------------------------------------------------------------------------
// Same slicer as test/core/validator-case-rules-b885.test.js: forEachField holds a commented-out
// region whose braces do not balance, so a brace walk cannot be used.
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

// isBooleanCheckbox has no brace inside a string or a regex literal, so a brace walk that starts at
// the declaration (depth 0, counting from the first `{`) slices it whole.
var IBC_DECL = 'var isBooleanCheckbox = function($el, rule) {';

function sliceIsBooleanCheckbox(src) {
    var s = src.indexOf(IBC_DECL);
    if (s < 0) { throw new Error('isBooleanCheckbox declaration not found'); }
    if (src.indexOf(IBC_DECL, s + 1) !== -1) { throw new Error('isBooleanCheckbox declaration not unique'); }
    var depth = 0, started = false, k;
    for (k = s; k < src.length; k++) {
        if (src[k] === '{') { depth++; started = true; }
        else if (src[k] === '}') { depth--; }
        if (started && depth === 0) { break; }
    }
    if (!started || depth !== 0) { throw new Error('isBooleanCheckbox: unbalanced braces'); }
    return src.substring(src.indexOf('function', s), k + 1);
}

var feSrc  = sliceForEachField(SRC);
var ibcSrc = sliceIsBooleanCheckbox(SRC);
var isBooleanCheckbox = new Function('return (' + ibcSrc + ');')();

// ---------------------------------------------------------------------------
// Pins shared by the source (§02) and the unminified bundle (§04)
// ---------------------------------------------------------------------------
// The arm's unticked half ends with the #B916 guard, right before the disabled half.
var GUARD_RE = /\/\^\(false\)\$\/i\.test\(rules\[field\]\.isRequired\)\s*&& !isBooleanCheckbox\(\$fields\[field\], rules\[field\]\)\s*\|\|\s*\$fields\[field\]\.disabled/;

// ---------------------------------------------------------------------------
// Harness — forEachField. The slice is compiled with its free identifiers as parameters (the list
// of test/core/validator-case-rules-b885.test.js, plus isBooleanCheckbox, the sliced classifier).
// The checkFieldAgainstRules spy records the rule each field is checked with, and mirrors the real
// function's `delete fields[field]` after an applied rule; the engine stub `d` holds one key per
// field it knows, as FormValidator does.
// ---------------------------------------------------------------------------
var FE_PARAMS = [
    'isGFFCtx', '$allFields', 'checkFieldAgainstRules', 'merge',
    'subLevelRules', 'fieldErrorsAttributes', 'd', 'formatData', 'envIsDev',
    'gina', 'window', 'triggerEvent', 'addListener', 'removeListener',
    'instance', 'evt', 'hasParsedAllRules', 'hasBeenValidated', 'asyncCount',
    'data', 'id', 're', 'flags', 'caseField', 'isBooleanCheckbox',
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
 * A text input stub.
 *
 * @param {string} name
 * @param {string} value
 * @returns {object}
 */
function mkText(name, value) {
    return {
        name: name, type: 'text', value: value, tagName: 'INPUT',
        checked: false, disabled: false, id: name + '-1',
        getAttribute: function (a) {
            if (a === 'type') { return 'text'; }
            if (a === 'id') { return this.id; }
            return null;
        },
        setAttribute: function () {}
    };
}

/**
 * A checkbox stub named `agree`. `value` is the `value` ATTRIBUTE (null when absent: the DOM then
 * reads `.value` as `on`).
 *
 * @param {object} o
 * @param {(string|null)} o.value
 * @param {boolean} [o.checked]
 * @param {boolean} [o.disabled]
 * @returns {object}
 */
function mkCheckbox(o) {
    return {
        name: 'agree', type: 'checkbox', value: (o.value === null) ? 'on' : o.value, tagName: 'INPUT',
        checked: !!o.checked, disabled: !!o.disabled, id: 'agree-1',
        getAttribute: function (a) {
            if (a === 'type') { return 'checkbox'; }
            if (a === 'value') { return o.value; }
            if (a === 'id') { return this.id; }
            return null;
        },
        setAttribute: function () {}
    };
}

/**
 * Runs forEachField once on a form with a required `ref` and the checkbox `agree`, and returns the
 * rule `agree` was checked with.
 *
 * @param {object} o
 * @param {object} o.rule - the rule of `agree`
 * @param {(string|null)} o.value - the checkbox's `value` attribute
 * @param {boolean} [o.checked]
 * @param {boolean} [o.disabled]
 * @param {*} o.collected - the value the pass collected for `agree`
 * @returns {{agree: (object|null), thrown: (Error|null)}}
 */
function driveAgree(o) {
    var applied = [];
    var spy = function (name, rulesArg, fieldsArg) {
        var rule = rulesArg[name] || {};
        applied.push({ name: name, rule: clone(rule), value: fieldsArg[name] });
        if (typeof (rulesArg[name]) != 'undefined' && Object.keys(rule).length > 0) {
            delete fieldsArg[name];
        }
    };
    var fields = { ref: 'x', agree: o.collected };
    var $fields = { ref: mkText('ref', 'x'), agree: mkCheckbox(o) };
    var rules = { ref: { isRequired: true }, agree: o.rule };
    var d = {
        addField: function (el, value) { d[el] = { name: el, value: value }; },
        getErrors: function () { return {}; },
        toData: function () { return {}; },
        isValid: function () { return true; }
    };
    Object.keys(fields).forEach(function (k) { d[k] = { name: k, value: fields[k] }; });
    var thrown = null;
    try {
        compileFE(feSrc)(
            true,                                   // isGFFCtx
            $fields, spy, shallowMerge,
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
            isBooleanCheckbox,
            clone(fields),                          // allFields
            clone(rules),                           // allRules
            clone(fields),                          // fields
            $fields,
            clone(rules)                            // rules
        );
    } catch (err) { thrown = err; }
    var agree = applied.filter(function (c) { return c.name === 'agree'; });
    return { agree: agree.length ? agree[0] : null, count: agree.length, thrown: thrown };
}

var OPTIONAL_BOOLEAN = { isRequired: false, isBoolean: true };
var EXCLUDED = { exclude: true };

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-optional-boolean-checkbox-b916 §01 — extraction + controls', function () {

    it('01.1 - CONTROL: forEachField is sliced once and compiles', function () {
        assert.ok(feSrc.length > 1000, 'the slice holds the function body');
        assert.doesNotThrow(function () { compileFE(feSrc); });
    });

    it('01.2 - CONTROL: isBooleanCheckbox is sliced once and classifies as #49 says', function () {
        assert.equal(isBooleanCheckbox(mkCheckbox({ value: null }), undefined), true, 'no value attribute: boolean');
        assert.equal(isBooleanCheckbox(mkCheckbox({ value: 'true' }), {}), true, 'value "true": boolean');
        assert.equal(isBooleanCheckbox(mkCheckbox({ value: 'false' }), {}), true, 'value "false": boolean');
        assert.equal(isBooleanCheckbox(mkCheckbox({ value: '42' }), { isRequired: false }), false, 'value "42": value-carrying');
        assert.equal(isBooleanCheckbox(mkCheckbox({ value: '42' }), { isBoolean: true }), true, 'an isBoolean rule: boolean');
    });

    it('01.3 - CONTROL: the harness reaches the arm (a disabled box is checked with `{ exclude: true }`)', function () {
        var res = driveAgree({ rule: OPTIONAL_BOOLEAN, value: 'true', disabled: true, collected: false });
        assert.equal(res.thrown, null);
        assert.equal(res.count, 1, 'agree is checked once');
        assert.deepEqual(res.agree.rule, EXCLUDED);
    });
});

// ---------------------------------------------------------------------------
// §02 — source pins (comment-stripped)
// ---------------------------------------------------------------------------
describe('validator-optional-boolean-checkbox-b916 §02 — source pins', function () {

    it('02.1 - #B916: the arm\'s unticked half ends with the boolean-checkbox guard', function () {
        assert.match(activeLines(feSrc), GUARD_RE);
    });

    it('02.2 - CONTROL: both collectors classify a checkbox with the same isBooleanCheckbox', function () {
        var active = activeLines(SRC);
        assert.equal(active.split('isBooleanCheckbox($form[i], (rules) ? rules[name] : null)').length - 1, 1, 'getFormValidationInfos');
        assert.equal(active.split('isBooleanCheckbox($target[i], (rules) ? rules[name] : null)').length - 1, 1, 'the live-check collector');
    });
});

// ---------------------------------------------------------------------------
// §03 — forEachField on the real bytes
// ---------------------------------------------------------------------------
describe('validator-optional-boolean-checkbox-b916 §03 — an unticked boolean checkbox keeps its rule', function () {

    it('03.1 - #B916: value "true", `isBoolean` + `isRequired: false`, unticked — checked with its own rule and the collected false', function () {
        var res = driveAgree({ rule: OPTIONAL_BOOLEAN, value: 'true', collected: false });
        assert.equal(res.thrown, null);
        assert.equal(res.count, 1);
        assert.deepEqual(res.agree.rule, OPTIONAL_BOOLEAN);
        assert.equal(res.agree.value, false);
    });

    it('03.2 - #B916: the same with no `value` attribute', function () {
        var res = driveAgree({ rule: OPTIONAL_BOOLEAN, value: null, collected: false });
        assert.equal(res.thrown, null);
        assert.deepEqual(res.agree.rule, OPTIONAL_BOOLEAN);
    });

    it('03.3 - #B916: a `value` that is not true/false, with an `isBoolean` rule, is boolean too', function () {
        var res = driveAgree({ rule: OPTIONAL_BOOLEAN, value: '42', collected: false });
        assert.equal(res.thrown, null);
        assert.deepEqual(res.agree.rule, OPTIONAL_BOOLEAN);
    });

    it('03.4 - CONTROL: an unticked value-carrying box whose rule says `isRequired: false` is still left out', function () {
        var res = driveAgree({ rule: { isRequired: false }, value: '42', collected: '42' });
        assert.equal(res.thrown, null);
        assert.deepEqual(res.agree.rule, EXCLUDED);
    });

    it('03.5 - CONTROL: a ticked boolean box keeps its rule', function () {
        var res = driveAgree({ rule: OPTIONAL_BOOLEAN, value: 'true', checked: true, collected: true });
        assert.equal(res.thrown, null);
        assert.deepEqual(res.agree.rule, OPTIONAL_BOOLEAN);
        assert.equal(res.agree.value, true);
    });

    it('03.6 - CONTROL: an unticked boolean box whose rule says `isRequired: true` keeps its rule', function () {
        var res = driveAgree({ rule: { isRequired: true, isBoolean: true }, value: 'true', collected: false });
        assert.equal(res.thrown, null);
        assert.deepEqual(res.agree.rule, { isRequired: true, isBoolean: true });
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity: both bundles carry the guard
// ---------------------------------------------------------------------------
describe('validator-optional-boolean-checkbox-b916 §04 — dist fidelity', function () {

    // Measured emission (build of 2026-10-18), identifier-agnostic and wrap-agnostic:
    //   /^(false)$/i.test(Ga[bb].isRequired)&&!nc(jb[bb],Ga[bb])||jb[bb].disabled)Ga[bb]={exclude:!0}
    //   nc=function(a,b){return a.getAttribute('value')===null||/^(true|false)$/.test(a.value)||typeof b!='undefined'&&b&&typeof b.isBoolean!='undefined'?!0:!1}
    // The guard reads 0 on the bundle built before the change; the classifier is renamed per build.
    var ID = '([A-Za-z_$][\\w$]*)';
    var MIN_GUARD_RE = new RegExp(
        '\\/\\^\\(false\\)\\$\\/i\\.test\\(\\s*' + ID + '\\[\\s*' + ID + '\\s*\\]\\.isRequired\\s*\\)'
        + '\\s*&&\\s*!\\s*' + ID + '\\(\\s*' + ID + '\\[\\s*\\2\\s*\\]\\s*,\\s*\\1\\[\\s*\\2\\s*\\]\\s*\\)'
        + '\\s*\\|\\|\\s*\\4\\[\\s*\\2\\s*\\]\\.disabled\\s*\\)\\s*\\1\\[\\s*\\2\\s*\\]\\s*=\\s*\\{\\s*exclude\\s*:\\s*!0\\s*\\}', 'g');
    var MIN_ARM_RE = new RegExp(
        '\\/\\^\\(false\\)\\$\\/i\\.test\\(\\s*' + ID + '\\[\\s*' + ID + '\\s*\\]\\.isRequired\\s*\\)[\\s\\S]{0,80}?'
        + '\\|\\|\\s*' + ID + '\\[\\s*\\2\\s*\\]\\.disabled\\s*\\)\\s*\\1\\[\\s*\\2\\s*\\]\\s*=\\s*\\{\\s*exclude\\s*:\\s*!0\\s*\\}', 'g');

    function classifierDefinitions(min, name) {
        var re = new RegExp('(?:^|[^\\w$])' + name.replace(/\$/g, '\\$') + '\\s*=\\s*function\\(\\s*' + ID + '\\s*,\\s*' + ID + '\\s*\\)\\s*\\{'
            + '\\s*return\\s*\\1\\.getAttribute\\(\\s*\'value\'\\s*\\)\\s*===\\s*null\\s*\\|\\|\\s*\\/\\^\\(true\\|false\\)\\$\\/\\.test\\(\\s*\\1\\.value\\s*\\)'
            + '\\s*\\|\\|\\s*typeof\\s+\\2\\s*!=\\s*\'undefined\'\\s*&&\\s*\\2\\s*&&\\s*typeof\\s+\\2\\.isBoolean\\s*!=\\s*\'undefined\'', 'g');
        return min.match(re) || [];
    }

    it('04.1 - #B916: gina.js (the Closure input) carries the guard', function () {
        var raw = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
        assert.match(activeLines(sliceForEachField(raw)), GUARD_RE);
    });

    it('04.2 - #B916: gina.min.js carries it, calling the classifier', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        var hits = [], m;
        MIN_GUARD_RE.lastIndex = 0;
        while ((m = MIN_GUARD_RE.exec(min)) !== null) { hits.push(m); }
        assert.equal(hits.length, 1, 'gina.min.js is what browsers run: the guard');
        assert.equal(classifierDefinitions(min, hits[0][3]).length, 1,
            'the guard calls the function the collectors classify with');
    });

    it('04.3 - CONTROL: gina.min.js carries the arm itself', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        assert.equal((min.match(MIN_ARM_RE) || []).length, 1);
    });
});
