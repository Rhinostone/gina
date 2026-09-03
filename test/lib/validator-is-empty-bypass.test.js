'use strict';
/**
 * #B233 — the `is` rule joins the #B78 contract: an EMPTY value is adjudicated
 * by `isRequired` alone.
 *
 * Pre-fix, `is` was the one rule outside the contract: its empty self-pass was
 * gated on `!errors['isRequired']` — i.e. disabled exactly when #B78 wants it
 * applied — so a required+EMPTY field recorded TWO errors (`isRequired` plus
 * "Condition not satisfied") where every converted rule records one. The
 * sibling guard block was DEAD code: both its disjuncts required
 * `value == '' && value != 0`, which no JS value satisfies (`x == ''` forces
 * `ToNumber(x) === 0` for non-strings and `x === ''` for strings).
 *
 * This is a RECORDED REVERSAL of a twice-declined exclusion (#B78 left `is`
 * untouched deliberately; #B82 re-declined the extension) — justified by
 * measurement, both halves pinned below:
 *   - optional+empty ALREADY self-passed via the live else-if, so the
 *     "condition legitimately tests emptiness" rationale was already
 *     unreachable for optional fields;
 *   - on required+empty the condition is VERDICT-IRRELEVANT: form validity is
 *     `getErrors().count()` and `isRequired` has already recorded its error —
 *     only the message list changes.
 * Non-string falsy values (0, false, null) are NOT empty (#B199 contract):
 * they still evaluate the condition, and those arms are pinned green-stable.
 *
 * Rider (same commit): the dead `_defaultErrorLabels['isApiError']` entry is
 * dropped — zero consult sites repo-wide (the API-error path assigns the
 * server's message directly and never calls `replace()`), so it only read as
 * a translatable key that silently did nothing.
 *
 * Red-first: §01.3/§01.4, §02.1/§02.2/§02.6, §03.1 are RED on pre-fix bytes;
 * §04 dist pins are RED until the prod rebuild. Everything else is a control
 * and green on both sides.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var fs = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes'));
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'isbypassbundle');

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_RAW_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var FormValidator = require(ENGINE_PATH);
var Validator = require(MAIN_PATH); // the plugin auto path (gina.plugins.Validator)

/** Comment-stripped view — negative pins must not match a `// was:` record. */
function activeLines(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/** Slices a rule body out of the engine source (same idiom as the sibling
 *  validator-loose-empty-strict.test.js): from its definition line to the
 *  next `self[el][` definition. */
function bodyOf(rule) {
    var start = ENGINE_SRC.indexOf("self[el]['" + rule + "'] = function");
    assert.ok(start > -1, 'rule `' + rule + '` not found');
    var next = ENGINE_SRC.indexOf('self[el][', start + 10);
    assert.ok(next > start, 'no following rule definition');
    return ENGINE_SRC.substring(start, next);
}

/** Direct engine drive: isRequired (optionally) then is(condition). */
function driveEngine(value, withRequired, condition) {
    var v = new FormValidator({ field: value }, undefined, undefined, undefined, undefined);
    if (withRequired) { v.field.isRequired(true); }
    v.field.is(condition);
    return {
        valid: v.field.valid,
        errorKeys: Object.keys(v.field.errors || {})
    };
}

/** Plugin auto path ($-free conditions only — see #B234). */
function drivePlugin(rules, data) {
    var res = Validator(rules, data, 'is-bypass-form');
    return {
        formValid: res.isValid(),
        errorKeys: Object.keys((res.error && res.error.myField) || {})
    };
}

// ---------------------------------------------------------------------------
// §01 — source pins on the engine
// ---------------------------------------------------------------------------
describe('validator-is-empty-bypass §01 — source pins', function () {

    it('01.1 - control: bodyOf() slices a real rule (can-fail)', function () {
        assert.ok(bodyOf('isEmail').indexOf("this.value === ''") > -1,
            'the canonical rule carries the strict empty bypass');
        assert.throws(function () { bodyOf('noSuchRule'); }, /not found/);
    });

    it('01.2 - premise: the dead pre-fix guard was unsatisfiable (recorded, not asserted on bytes)', function () {
        // `x == '' && x != 0` has no witness: for non-strings `x == ''` forces
        // ToNumber(x) === 0; for strings it forces x === ''. Executable record:
        ['', 0, -0, false, [], 'false', '0', null, undefined, NaN].forEach(function (x) {
            assert.equal(x == '' && x != 0, false, 'witness found: ' + String(x));
        });
    });

    it('01.3 - the `is` empty bypass is UNCONDITIONAL and strict (the #B78 canonical shape)', function () {
        var body = activeLines(bodyOf('is'));
        assert.match(body, /if \( this\.value === '' \) \{\s*\n\s*isValid = true;\s*\n\s*\}/,
            'empty is adjudicated by isRequired alone — the bypass must not read errors');
    });

    it('01.4 - the old isRequired-gated bypass is gone from active lines', function () {
        var body = activeLines(bodyOf('is'));
        assert.equal(body.indexOf("!errors['isRequired'] && typeof(this.value) == 'string' && this.value == ''"), -1,
            'the gate that disabled the bypass exactly when #B78 wanted it applied');
        assert.equal(body.indexOf('this.value != 0'), -1,
            'the dead unsatisfiable disjuncts must be deleted, not repaired');
    });

    it('01.5 - the `is` tail carries the #B78 regate, joining the Shape-A population', function () {
        assert.match(activeLines(bodyOf('is')), /this\.valid = isValid && !errors\['isRequired'\];/,
            'per-field flag stays consistent with a surviving isRequired error');
    });

    it('01.6 - Shape-A population count: exactly EIGHT rules carry the regate', function () {
        var m = activeLines(ENGINE_SRC).match(/this\.valid = isValid && !errors\['isRequired'\];/g) || [];
        assert.equal(m.length, 8,
            'is + isEmail + isJsonWebToken + isIban + isBic + isBoolean + isFloat + isInList — a ninth or seventh means this file is stale');
    });
});

// ---------------------------------------------------------------------------
// §02 — behaviour on the REAL engine + the plugin auto path
// ---------------------------------------------------------------------------
describe('validator-is-empty-bypass §02 — behaviour', function () {

    it('02.1 - THE #B233 RED: required + `is` + EMPTY records isRequired ALONE (engine)', function () {
        var r = driveEngine('', true, '/^[a-z]+$/');
        assert.deepEqual(r.errorKeys, ['isRequired'],
            'pre-fix this carried a second "Condition not satisfied" — the #B78 contract violation');
    });

    it('02.2 - same through the plugin auto path ($-free condition)', function () {
        var r = drivePlugin({ myField: { isRequired: true, is: '/^(alpha|beta)/' } }, { myField: '' });
        assert.equal(r.formValid, false, 'the form is still invalid — isRequired holds it');
        assert.deepEqual(r.errorKeys, ['isRequired']);
    });

    it('02.3 - control: the canonical rule behaves identically (isEmail)', function () {
        var r = drivePlugin({ myField: { isRequired: true, isEmail: true } }, { myField: '' });
        assert.deepEqual(r.errorKeys, ['isRequired']);
    });

    it('02.4 - control: optional + empty still passes (already true pre-fix)', function () {
        var r = drivePlugin({ myField: { is: '/^(alpha|beta)/' } }, { myField: '' });
        assert.equal(r.formValid, true);
        assert.deepEqual(r.errorKeys, []);
    });

    it('02.5 - control: a filled-but-invalid value still reports the `is` error', function () {
        var r = drivePlugin({ myField: { isRequired: true, is: '/^(alpha|beta)/' } }, { myField: 'zzz' });
        assert.deepEqual(r.errorKeys, ['is'], 'the bypass is for emptiness only');
        var r2 = drivePlugin({ myField: { is: '/^(alpha|beta)/' } }, { myField: 'zzz' });
        assert.deepEqual(r2.errorKeys, ['is'], 'optional invalid still fails');
    });

    it('02.6 - the boolean-condition form joins the contract too (engine, is(false))', function () {
        var r = driveEngine('', true, false);
        assert.deepEqual(r.errorKeys, ['isRequired'],
            'pre-fix a required-empty field with is(false) also double-reported');
    });

    it('02.7 - #B199 contract: non-string falsy values are VALUES, not emptiness (green-stable)', function () {
        // The condition must be UNSATISFIABLE by the stringified falsy values:
        // `String(false)`/`String(null)` are lowercase letters, so a first
        // draft using /^[a-z]+$/ legitimately MATCHED them (caught by this
        // file's own red-first reconciliation — an instrument bug, not engine).
        [0, false, null].forEach(function (v) {
            var r = driveEngine(v, true, '/^[0-9]{4}/');
            assert.ok(r.errorKeys.indexOf('is') > -1,
                String(v) + ' must still evaluate the condition — only the literal empty string bypasses');
        });
    });

    it('02.8 - verdict-irrelevance (the reversal argument, executable): required+empty form validity is identical either way', function () {
        // The condition CANNOT rescue a required-empty field: isRequired's error
        // is already recorded. This pins the measured argument that justified
        // reversing the #B78/#B82 exclusion.
        var withIs = drivePlugin({ myField: { isRequired: true, is: '/^(alpha|beta)/' } }, { myField: '' });
        var without = drivePlugin({ myField: { isRequired: true } }, { myField: '' });
        assert.equal(withIs.formValid, without.formValid);
        assert.equal(withIs.formValid, false);
    });

    it('02.9 - the per-field flag stays false on required+empty (regate, not rescue)', function () {
        var r = driveEngine('', true, '/^[a-z]+$/');
        assert.equal(r.valid, false,
            'the bypass self-passes the RULE; the regate keeps the FIELD flag honest');
    });
});

// ---------------------------------------------------------------------------
// §03 — rider: the dead isApiError label entry is dropped
// ---------------------------------------------------------------------------
describe('validator-is-empty-bypass §03 — isApiError label drop', function () {

    it('03.1 - _defaultErrorLabels no longer declares isApiError', function () {
        assert.equal(activeLines(ENGINE_SRC).indexOf("'isApiError'"), -1,
            'the key had zero consult sites — it only read as a translatable key that did nothing');
    });

    it('03.2 - control: a live key is still declared (the pin can fail)', function () {
        assert.ok(ENGINE_SRC.indexOf("'isRequired'") > -1);
    });

    it('03.3 - the API-error path is label-independent (source pin on the direct assignment)', function () {
        var main = fs.readFileSync(MAIN_PATH, 'utf8');
        assert.ok(main.indexOf('errorObject[f].isApiError = result.fields[f];') > -1,
            'the rendered text comes from the server response, never from the label map');
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity (red until the prod rebuild)
// ---------------------------------------------------------------------------
describe('validator-is-empty-bypass §04 — dist fidelity', function () {

    it('04.1 - gina.js carries the new `is` bypass and regate; the old gate is gone', function () {
        var raw = activeLines(fs.readFileSync(DIST_RAW_PATH, 'utf8'));
        assert.ok(raw.indexOf("!errors['isRequired'] && typeof(this.value) == 'string' && this.value == ''") === -1,
            'the old gated bypass must not survive in executable dist bytes');
        var m = raw.match(/this\.valid = isValid && !errors\['isRequired'\];/g) || [];
        assert.equal(m.length, 8, 'the regate population must reach the bundle (6 pre-#FIN4)');
    });

    it('04.2 - gina.js no longer ships the isApiError label', function () {
        var raw = activeLines(fs.readFileSync(DIST_RAW_PATH, 'utf8'));
        assert.equal(raw.indexOf("'isApiError': 'Condition not satisfied'"), -1);
        assert.ok(raw.indexOf('errorObject[f].isApiError') > -1,
            'control: the client re-key site legitimately keeps the property NAME');
    });

    it('04.3 - gina.min.js: the minified regate population is 8', function () {
        var min = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // Closure emission of `this.valid = isValid && !errors['isRequired'];`
        // VALIDATED against the real artifacts at each rebuild.
        // WRAP-AGNOSTIC BY MEASUREMENT: Closure line-wraps its output, and the
        // isBoolean rebuild put a break inside one of the six tails
        // (`.valid=V&&\n!I.isRequired`). A needle without the `\s*` boundaries
        // counted 5 of the 6 and so passed its old `=== 5` by COINCIDENCE —
        // where the break falls depends on preceding token lengths, so a strict
        // needle flips this pin on unrelated future rebuilds.
        var m = min.match(/\.valid\s*=\s*[A-Za-z_$][\w$]*\s*&&\s*!\s*[A-Za-z_$][\w$]*\s*\.\s*isRequired/g) || [];
        assert.equal(m.length, 8,
            'the served artifact must carry the #FIN4 regates — gina.min.js is what browsers run');
    });
});
