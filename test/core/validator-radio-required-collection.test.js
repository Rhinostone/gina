'use strict';
/**
 * FormValidator — radio-group field collection for `isRequired` (#B221)
 *
 * An unchecked non-boolean radio group never entered the client validator's
 * field map: every arm of the checkbox/radio collection branch requires
 * `.checked`, a `true|false`-shaped value, or a declared `isBoolean` rule —
 * so `isRequired` (or any other rule) never adjudicated the group, and a
 * radio-group-only form short-circuited BOTH submit guards
 * (`fields['_length'] == 0` → synthetic `isValid() === true`) and submitted
 * with zero client-side validation. The DOM handle was always held
 * (`$fields[name]`) — only the VALUE entry was missing.
 *
 * The fix appends one collection arm to BOTH collectors — `getFormValidationInfos`
 * AND the native-submit inline copy: an unchecked non-boolean radio group whose
 * rule declares a truthy `isRequired` is collected as `fields[name] = ''`, so
 * the engine's generic emptiness test adjudicates it. Groups with no rule,
 * `isRequired: false`, or an `isBoolean` declaration keep the legacy
 * absent-when-unchecked shape (native parity; the boolean shapes are owned by
 * the pre-existing arms). A checked member always wins: the arms above collect
 * it, and the new arm's already-collected guard never resets it.
 *
 * Test layering (project convention):
 *   §01 extraction + instrument controls (brace-walk bounded, jsdom indexed
 *       form access proven — controls that CAN fail);
 *   §02 source pins on the new arm in both collectors (whole-expression
 *       anchored to the assignment terminator, right-extension-proof);
 *   §03 behavioral matrix driving the REAL extracted `getFormValidationInfos`
 *       bytes over jsdom fixtures (new shapes red-first; legacy shapes as
 *       green no-regression controls);
 *   §04 engine adjudication on the REAL `FormValidatorUtil` — the '' value the
 *       new arm contributes is exactly what `isRequired`'s generic emptiness
 *       test rejects (incl. the collector→engine integration case);
 *   §05 dist-fidelity pins (red until the prod rebuild lands the arm in the
 *       shipped bundle).
 *
 * Coverage split, stated honestly: the native-submit INLINE collector is
 * pinned at source level here (§02/§05) — it lives inside the submit listener
 * closure, so its behavioral coverage is the live browser smoke (a real
 * <button type="submit"> submit), while `getFormValidationInfos` (which serves
 * the bound-link submit path, the bind-time silent pass, the live-check global
 * pass and validateFormById) is executed directly in §03.
 *
 * NOTE for readers of test/core/validator-checkbox-state.test.js: its
 * `replayCollect` replica deliberately mirrors the pre-#B221 chain — none of
 * its cases declare a bare truthy `isRequired` on a non-boolean radio, so it
 * never reaches the new arm and stays honest for the #49 shapes it locks.
 *
 * Run: node --test test/core/validator-radio-required-collection.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var FW = require(path.join(__dirname, '..', 'fw'));

// Framework globals: Object.prototype.count() for the collector's
// `fields.count()`, then the helpers + a seeded gina context so the REAL
// engine (§04) constructs headless — the engine-rules bootstrap recipe.
process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '..', '..', 'utils', 'prototypes'));
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', {}); }

var MAIN_PATH = path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var mainSrc = fs.readFileSync(MAIN_PATH, 'utf8');
var DIST_MIN_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');
var DIST_RAW_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.js');

var FormValidator = require(path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'form-validator.js'));

// ============================================================================
// Extraction — execute the SHIPPED bytes (no replica): brace-walk from the
// declaration with a started-flag (the declaration string itself may or may
// not carry the opening brace), controls asserted in §01.
// ============================================================================

function extractFunctionExpression(src, decl) {
    var start = src.indexOf(decl);
    if (start === -1) { throw new Error('declaration not found: ' + decl); }
    if (src.indexOf(decl, start + 1) !== -1) { throw new Error('declaration not unique: ' + decl); }
    var i = start, depth = 0, started = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        else if (src[i] === '}') {
            depth--;
            if (started && depth === 0) { i++; break; }
        }
    }
    if (!started || depth !== 0) { throw new Error('brace walk did not balance for: ' + decl); }
    return src.substring(start, i);
}

var INFOS_DECL = 'var getFormValidationInfos = function($form, rules, isOnResetMode) {';
var IBC_DECL   = 'var isBooleanCheckbox = function($el, rule) {';

var infosSrc = extractFunctionExpression(mainSrc, INFOS_DECL);
var ibcSrc   = extractFunctionExpression(mainSrc, IBC_DECL);

function toExpr(fnSrc, name) {
    return fnSrc.replace(new RegExp('^var ' + name + '\\s*=\\s*'), '');
}

// Real bytes, compiled in the node realm (so object literals created inside
// carry Object.prototype.count from utils/prototypes).
var isBooleanCheckbox = new Function('return (' + toExpr(ibcSrc, 'isBooleanCheckbox') + ');')();
var getFormValidationInfos = new Function(
    'instance', 'gina', 'isBooleanCheckbox',
    'return (' + toExpr(infosSrc, 'getFormValidationInfos') + ');'
)({ $forms: {} }, { validator: { $forms: {} } }, isBooleanCheckbox);

// ============================================================================
// Fixtures — generic shapes only. The <a data-gina-form-submit> trigger is
// part of the canonical markup but is NOT a listed form control, so the
// collector's indexed iteration never visits it (asserted in §01.3).
// ============================================================================

function collect(innerHtml, rules) {
    var dom = new JSDOM('<!doctype html><html><body>'
        + '<form id="parent" data-gina-form-rule="my-rule" method="put" action="/update">'
        + innerHtml
        + '<a data-gina-form-submit="true" href="#">Submit</a>'
        + '</form></body></html>');
    var $form = dom.window.document.querySelector('form');
    var out = getFormValidationInfos($form, rules);
    return { $form: $form, fields: out.fields, $fields: out.$fields, rules: out.rules };
}

function requiredRule() {
    return { optionGroup: { setFlash: [null, 'Please pick one'], isRequired: true } };
}

var TWO_RADIOS = '<input type="radio" name="optionGroup" value="a">'
               + '<input type="radio" name="optionGroup" value="b">';

// ============================================================================
// §01 — extraction + instrument controls
// ============================================================================

describe('01 - extraction and instrument controls', function () {

    it('01.1 both declarations are unique and the brace walks balance', function () {
        assert.ok(infosSrc.length > 2000, 'getFormValidationInfos extraction suspiciously small');
        assert.ok(/\}$/.test(infosSrc.trim()), 'extraction must end on a closing brace');
        assert.ok(ibcSrc.length > 100, 'isBooleanCheckbox extraction suspiciously small');
        assert.equal(typeof getFormValidationInfos, 'function');
        assert.equal(typeof isBooleanCheckbox, 'function');
        // The extraction covers the collection branch AND the _length write.
        assert.ok(infosSrc.indexOf("fields['_length']") > -1, 'extraction must contain the _length write');
    });

    it('01.2 the extracted isBooleanCheckbox classifies like the shipped contract', function () {
        var dom = new JSDOM('<input type="checkbox" name="c1">'
            + '<input type="checkbox" name="c2" value="true">'
            + '<input type="checkbox" name="c3" value="x">');
        var d = dom.window.document;
        var els = d.querySelectorAll('input');
        assert.equal(isBooleanCheckbox(els[0], null), true, 'valueless checkbox is boolean');
        assert.equal(isBooleanCheckbox(els[1], null), true, 'true-valued checkbox is boolean');
        assert.equal(isBooleanCheckbox(els[2], null), false, 'payload-valued checkbox is value-carrying');
        assert.equal(isBooleanCheckbox(els[2], { isBoolean: true }), true, 'an isBoolean rule classifies any checkbox');
    });

    it('01.3 jsdom implements the indexed form access the collector iterates (control that CAN fail)', function () {
        var res = collect(TWO_RADIOS, requiredRule());
        assert.equal(res.$form.length, 2, 'two listed controls (the <a> trigger is not one)');
        assert.equal(res.$form[0].name, 'optionGroup');
        assert.equal(res.$form[1].value, 'b');
    });

    it('01.4 harness liveness on a shape the fix does not touch: a text input collects', function () {
        var res = collect('<input type="text" name="title" value="hello">', {});
        assert.equal(res.fields.title, 'hello');
        assert.equal(res.fields['_length'], 1);
        assert.ok(res.$fields.title, 'DOM handle held');
    });
});

// ============================================================================
// §02 — source pins: the #B221 arm exists in BOTH collectors (red pre-fix)
// ============================================================================

// The arm's code-unique needle: the truthy-isRequired gate. Measured pre-fix
// count is 0 (the nearby commented-out legacy line uses /^true$/ WITHOUT the
// `i` flag, so it cannot satisfy this literal).
var GATE_NEEDLE = "/^true$/i.test(rules[name].isRequired)";

function countOf(hay, needle) {
    return hay.split(needle).length - 1;
}

describe('02 - source pins: the collection arm in both collectors', function () {

    it('02.1 the truthy-isRequired gate appears exactly twice (one per collector)', function () {
        assert.equal(countOf(mainSrc, GATE_NEEDLE), 2,
            'expected the #B221 gate in getFormValidationInfos AND the native-submit inline collector');
    });

    it('02.2 getFormValidationInfos carries the whole arm, terminator-anchored', function () {
        var re = /\$form\[i\]\.type == 'radio'\s*&&\s*rules\s*&&\s*typeof\(rules\[name\]\) != 'undefined'\s*&&\s*\/\^true\$\/i\.test\(rules\[name\]\.isRequired\)\s*&&\s*typeof\(rules\[name\]\.isBoolean\) == 'undefined'\s*&&\s*typeof\(fields\[name\]\) == 'undefined'\s*\)\s*\{\s*fields\[name\] = '';/;
        assert.match(mainSrc, re,
            'the infos-collector arm must gate on radio + truthy isRequired + no isBoolean + not-already-collected, and assign the empty value');
    });

    it('02.3 the native-submit inline collector carries the twin arm', function () {
        var re = /\$target\[i\]\.type == 'radio'\s*&&\s*rules\s*&&\s*typeof\(rules\[name\]\) != 'undefined'\s*&&\s*\/\^true\$\/i\.test\(rules\[name\]\.isRequired\)\s*&&\s*typeof\(rules\[name\]\.isBoolean\) == 'undefined'\s*&&\s*typeof\(fields\[name\]\) == 'undefined'\s*\)\s*\{\s*fields\[name\] = '';/;
        assert.match(mainSrc, re,
            'the inline-collector arm must mirror the infos arm on $target[i]');
    });

    it('02.4 each arm sits AFTER its site\'s force-false arm (else-if chain order)', function () {
        // infos site: slice from its classifier anchor to the _length write.
        var iStart = mainSrc.indexOf("isBooleanCheckbox($form[i], (rules) ? rules[name] : null)");
        assert.ok(iStart > -1, 'infos classifier anchor');
        var iEnd = mainSrc.indexOf("fields['_length']", iStart);
        assert.ok(iEnd > iStart, 'infos slice end anchor');
        var infosSlice = mainSrc.substring(iStart, iEnd);
        var iFalse = infosSlice.indexOf('fields[name] = false;');
        var iGate  = infosSlice.indexOf(GATE_NEEDLE);
        assert.ok(iFalse > -1, 'infos force-false arm present');
        assert.ok(iGate > iFalse, 'infos #B221 arm must follow the force-false arm');

        // inline site: slice from its classifier anchor to its $fields write.
        var tStart = mainSrc.indexOf("isBooleanCheckbox($target[i], (rules) ? rules[name] : null)");
        assert.ok(tStart > -1, 'inline classifier anchor');
        var tEnd = mainSrc.indexOf('$fields[name] = $target[i];', tStart);
        assert.ok(tEnd > tStart, 'inline slice end anchor');
        var inlineSlice = mainSrc.substring(tStart, tEnd);
        var tFalse = inlineSlice.indexOf('fields[name] = false;');
        var tGate  = inlineSlice.indexOf(GATE_NEEDLE);
        assert.ok(tFalse > -1, 'inline force-false arm present');
        assert.ok(tGate > tFalse, 'inline #B221 arm must follow the force-false arm');
    });
});

// ============================================================================
// §03 — behavioral matrix on the REAL extracted collector (jsdom)
// ============================================================================

describe('03 - collection behavior (real getFormValidationInfos bytes)', function () {

    it('03.1 [the fix] an unchecked required group is collected as the empty value', function () {
        var res = collect(TWO_RADIOS, requiredRule());
        assert.ok('optionGroup' in res.fields,
            'the group must enter the field map (pre-fix: entirely absent)');
        assert.equal(res.fields.optionGroup, '');
        assert.equal(res.fields['_length'], 1);
    });

    it('03.2 [the fix] a radio-group-only form no longer reads as nothing-to-validate', function () {
        var res = collect(TWO_RADIOS, requiredRule());
        // Both submit paths guard on `fields['_length'] == 0` and synthesize a
        // passing result; a collected group makes the count non-zero.
        assert.notEqual(res.fields['_length'], 0,
            'the _length == 0 short-circuit must not engage for a required radio group');
    });

    it('03.3 [control] a checked member is collected with its value (both pre- and post-fix)', function () {
        var html = '<input type="radio" name="optionGroup" value="a">'
                 + '<input type="radio" name="optionGroup" value="b" checked>';
        var res = collect(html, requiredRule());
        assert.equal(res.fields.optionGroup, 'b');
        assert.equal(res.fields['_length'], 1);
    });

    it('03.4 [control] member iteration order never loses the checked value', function () {
        // unchecked first, checked second: the checked arm overwrites the
        // empty contribution.
        var res1 = collect(
            '<input type="radio" name="optionGroup" value="a">'
            + '<input type="radio" name="optionGroup" value="b" checked>', requiredRule());
        assert.equal(res1.fields.optionGroup, 'b');
        // checked first, unchecked second: the already-collected guard keeps
        // the later unchecked member from resetting it.
        var res2 = collect(
            '<input type="radio" name="optionGroup" value="a" checked>'
            + '<input type="radio" name="optionGroup" value="b">', requiredRule());
        assert.equal(res2.fields.optionGroup, 'a');
    });

    it('03.5 [control] an optional-rule group stays uncollected when unchecked (wire shape unchanged)', function () {
        var res = collect(TWO_RADIOS, { optionGroup: { isEmail: true } });
        assert.equal(typeof res.fields.optionGroup, 'undefined',
            'no truthy isRequired -> the legacy absent-when-unchecked shape is kept');
        assert.equal(res.fields['_length'], 0);
    });

    it('03.6 [control] isRequired:false stays uncollected when unchecked', function () {
        var res = collect(TWO_RADIOS, { optionGroup: { isRequired: false } });
        assert.equal(typeof res.fields.optionGroup, 'undefined');
        assert.equal(res.fields['_length'], 0);
    });

    it('03.7 [control] the isBoolean+isRequired force-false arm still owns boolean-declared groups', function () {
        var res = collect(TWO_RADIOS, { optionGroup: { isRequired: true, isBoolean: true } });
        assert.equal(res.fields.optionGroup, false,
            'the pre-existing force-false arm fires; the #B221 arm must not shadow it');
    });

    it('03.8 [control] boolean-VALUED radios keep the #49-era self-injection shape', function () {
        var html = '<input type="radio" name="optionGroup" value="true">'
                 + '<input type="radio" name="optionGroup" value="false">';
        var rules = {};
        var res = collect(html, rules);
        assert.equal(typeof res.fields.optionGroup, 'undefined',
            'unchecked boolean-valued group stays uncollected');
        assert.ok(rules.optionGroup && rules.optionGroup.isBoolean === true,
            'the legacy arm self-injects isBoolean, which also excludes the group from the #B221 arm');
    });

    it('03.9 [control] disabled members are skipped before any collection arm', function () {
        var allDisabled = collect(
            '<input type="radio" name="optionGroup" value="a" disabled>'
            + '<input type="radio" name="optionGroup" value="b" disabled>', requiredRule());
        assert.equal(typeof allDisabled.fields.optionGroup, 'undefined');
        assert.equal(allDisabled.fields['_length'], 0);
    });

    it('03.9b [the fix] one enabled unchecked member is enough to collect the group', function () {
        var res = collect(
            '<input type="radio" name="optionGroup" value="a" disabled>'
            + '<input type="radio" name="optionGroup" value="b">', requiredRule());
        assert.equal(res.fields.optionGroup, '');
        assert.equal(res.fields['_length'], 1);
    });

    it('03.10 [the fix] a mixed form collects the group beside other fields', function () {
        var res = collect(
            '<input type="text" name="title" value="hello">' + TWO_RADIOS, requiredRule());
        assert.equal(res.fields.title, 'hello');
        assert.equal(res.fields.optionGroup, '');
        assert.equal(res.fields['_length'], 2);
    });

    it('03.11 [control] the DOM handle is held for the group either way', function () {
        var res = collect(TWO_RADIOS, requiredRule());
        assert.ok(res.$fields.optionGroup, '$fields must hold the group member');
        assert.equal(res.$fields.optionGroup.tagName, 'INPUT');
        assert.equal(res.$fields.optionGroup.type, 'radio');
    });
});

// ============================================================================
// §04 — engine adjudication (REAL FormValidatorUtil, server construction)
// ============================================================================

describe('04 - the empty value is exactly what isRequired adjudicates', function () {

    it('04.1 [control] a present-but-empty group value fails isRequired', function () {
        var v = new FormValidator({ optionGroup: '' });
        v['optionGroup'].isRequired(true);
        assert.equal(v.isValid(), false);
        var errs = v.getErrors();
        assert.ok(errs.optionGroup && errs.optionGroup.isRequired,
            'isRequired must record its error for the empty group');
    });

    it('04.2 [control] the setFlash custom message is honored', function () {
        var v = new FormValidator({ optionGroup: '' });
        v['optionGroup'].setFlash(null, 'Please pick one');
        v['optionGroup'].isRequired(true);
        assert.equal(v.isValid(), false);
        assert.equal(v.getErrors().optionGroup.isRequired, 'Please pick one');
    });

    it('04.3 [control] a picked value passes', function () {
        var v = new FormValidator({ optionGroup: 'a' });
        v['optionGroup'].isRequired(true);
        assert.equal(v.isValid(), true);
    });

    it('04.4 [the fix] collector -> engine integration: the group is adjudicated end-to-end', function () {
        var res = collect(TWO_RADIOS, requiredRule());
        var data = {};
        for (var k in res.fields) {
            if (k === '_length') { continue; }
            data[k] = res.fields[k];
        }
        var v = new FormValidator(data);
        assert.ok(v.optionGroup,
            'the group must enter the validation map (pre-fix the field object never exists)');
        v.optionGroup.isRequired(true);
        assert.equal(v.isValid(), false, 'nothing picked -> the form must be invalid');
        assert.ok(v.getErrors().optionGroup.isRequired);
    });
});

// ============================================================================
// §05 — dist fidelity (red until the prod rebuild ships the arm)
// ============================================================================

describe('05 - dist fidelity: the arm is in the shipped browser bundle', function () {

    it('05.1 gina.min.js carries both minified arms (regex literal + property chain survive Closure)', function () {
        var min = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // Existence control on a pre-existing neighbor so a wrong path/read
        // cannot false-zero silently:
        assert.ok(min.indexOf('.isBoolean') > -1, 'control: the isBoolean property chain must exist');
        var hits = min.match(/\/\^true\$\/i\.test\([^)]{0,80}?\.isRequired\)/g) || [];
        assert.equal(hits.length, 2,
            'the truthy-isRequired gate must appear once per collector in the minified bundle');
    });

    it('05.2 the unminified gina.js carries both arms in source form', function () {
        var raw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
        assert.ok(raw.indexOf("isBooleanCheckbox($form[i]") > -1, 'control: the collector is bundled');
        assert.equal(countOf(raw, GATE_NEEDLE), 2,
            'r.js runs optimize:none, so the source-form gate must appear once per collector');
    });
});
