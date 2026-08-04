'use strict';
/**
 * #B236 + #B235 — `isBoolean` becomes one contract on every surface: the
 * ENGINE adjudicates, and it joins the #B78 empty-value contract.
 *
 * #B236 (plugin pre-cast): `getCastedValue` funneled EVERY value on an
 * isBoolean-ruled field through `/^true$/i ? true : false` BEFORE the engine
 * ran — a total function to boolean, on both the client and server paths
 * (`validate` calls `formatFields` unconditionally). So on the server auto
 * path junk validated clean and persisted as `false` ("nope", "on", "1", any
 * checked HTML checkbox posting "on" stored as UNchecked), the number 1
 * stored as `false` where the engine accepts it as `true`, and the engine's
 * documented accept-set — true/'true'/1 and false/'false'/0, already enforced
 * verbatim by the routing `validator::` surface, which drives the engine
 * directly — never got to run. Fix: the pre-cast survives ONLY in
 * dynamised-rules mode (dollar-substitution into stringified `is` conditions
 * needs it so a spliced boolean stays an unquoted operand — measured: without
 * it a server `$flag === true` condition breaks for a string-'true' flag);
 * the plain pass hands the raw value to the engine.
 *
 * #B235 (engine): the pre-switch rescue `errors['isRequired'] &&
 * this.value == false` was LOOSE — `'' == false` — so a required+EMPTY field
 * lost its isRequired error and reported "Must be a valid boolean" instead.
 * Fix: the rule joins the #B78 contract (strict `=== ''` self-pass; emptiness
 * is isRequired's verdict alone), the rescue moves AFTER the switch gated on
 * the value having been ACCEPTED (`val !== null` — a recognized false/0 is a
 * present answer, the documented unchecked-but-required-toggle case), and the
 * tail joins Shape A (`this.valid = isValid && !errors['isRequired']`),
 * taking that population from five rules to SIX.
 *
 * The two compose: with #B236 alone, required+empty on the server would keep
 * reporting the wrong error (the loose rescue still fires on ''); with #B235
 * alone, junk still never reaches the engine server-side. The minimal
 * strict-rescue-only alternative was measured broken: `0 === false` is false,
 * so a required field answered `0` (engine-accepted) regressed to invalid,
 * and required+empty double-errored.
 *
 * Red-first buckets (pre-fix bytes):
 *   MUST-RED  — §01.2/§01.3, §02.1/§02.2/§02.3/§02.4, §03.1/§03.2,
 *               §04.1-§04.5/§04.7/§04.8/§04.11, §05.2, §06 (all).
 *   MUST-GREEN (premises/controls) — §01.1/§01.4, §02.5, §03.3/§03.4/§03.5,
 *               §04.6/§04.9/§04.10, §05.1/§05.3.
 * At the src-fixed/dist-stale midstate only §06 stays red (the free subtract
 * proving the dist pins watch the artifact, not the source).
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
setContext('bundle', 'isboolcontractbundle');

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var MAIN_SRC = fs.readFileSync(MAIN_PATH, 'utf8');
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

/** Engine rule-body slicer (template: validator-is-empty-bypass.test.js). */
function bodyOf(rule) {
    var start = ENGINE_SRC.indexOf("self[el]['" + rule + "'] = function");
    assert.ok(start > -1, 'rule `' + rule + '` not found');
    var next = ENGINE_SRC.indexOf('self[el][', start + 10);
    assert.ok(next > start, 'no following rule definition');
    return ENGINE_SRC.substring(start, next);
}

/** main.js getCastedValue slicer (same anchors as the crossfield §06 pins). */
function castBlock(src) {
    var start = src.indexOf('var getCastedValue = function');
    var end = src.indexOf('var formatFields', start);
    assert.ok(start > -1 && end > start, 'getCastedValue block not found');
    return src.slice(start, end);
}

/** Direct engine drive: (optionally) isRequired then isBoolean. */
function driveEngine(value, withRequired) {
    var v = new FormValidator({ field: value }, undefined, undefined, undefined, undefined);
    if (withRequired) { v.field.isRequired(true); }
    v.field.isBoolean();
    return {
        valid: v.field.valid,
        errorKeys: Object.keys(v.field.errors || {}),
        value: v.field.value
    };
}

/** Plugin auto path (server backendInit -> validate -> formatFields -> engine). */
function drivePlugin(rules, data) {
    var res = Validator(JSON.parse(JSON.stringify(rules)), data, 'isbool-contract-form');
    var errs = {};
    for (var f in res.error || {}) { errs[f] = Object.keys(res.error[f] || {}); }
    return { formValid: res.isValid(), errs: errs, data: res.data };
}

var REQ_BOOL = { myField: { isRequired: true, isBoolean: true } };
var OPT_BOOL = { myField: { isBoolean: true } };

// ---------------------------------------------------------------------------
// §01 — source pins: main.js getCastedValue (the #B236 gate)
// ---------------------------------------------------------------------------
describe('validator-isboolean-contract §01 — getCastedValue pins', function () {

    it('01.1 - control: the slicers can fail', function () {
        assert.throws(function () { bodyOf('noSuchRule'); }, /not found/);
        assert.throws(function () { castBlock('nothing here'); }, /not found/);
        assert.ok(castBlock(MAIN_SRC).length > 200, 'real block sliced');
    });

    it('01.2 - the boolean pre-cast is GATED on dynamised mode', function () {
        var block = activeLines(castBlock(MAIN_SRC));
        assert.ok(block.indexOf('} else if (isOnDynamisedRules && ruleObj[fieldName].isBoolean) {') > -1,
            'the cast must survive ONLY for dollar-substitution into stringified conditions');
    });

    it('01.3 - the UNGATED pre-cast is gone from active lines', function () {
        var block = activeLines(castBlock(MAIN_SRC));
        assert.equal(block.indexOf('} else if (ruleObj[fieldName].isBoolean) {'), -1,
            'plain validation must hand the raw value to the engine — the engine is the single adjudicator');
    });

    it('01.4 - premise: the dynamised empty-guard machinery is byte-untouched', function () {
        var block = castBlock(MAIN_SRC);
        assert.match(block, /if \( isOnDynamisedRules && \/\^\\s\*\$\/\.test\(fields\[fieldName\]\) \)/,
            'the quoted-empty guard (crossfield arc) must not be disturbed');
        assert.ok(block.indexOf(String.raw`return '\\"\\"';`) > -1, 'quoted-empty literal intact');
    });
});

// ---------------------------------------------------------------------------
// §02 — source pins: the engine isBoolean body (the #B235 shape)
// ---------------------------------------------------------------------------
describe('validator-isboolean-contract §02 — engine body pins', function () {

    it('02.1 - the strict #B78 empty bypass is present', function () {
        assert.match(activeLines(bodyOf('isBoolean')), /if \( this\.value === '' \) \{/,
            'emptiness is adjudicated by isRequired alone');
    });

    it('02.2 - the LOOSE pre-switch rescue is gone from active lines (and recorded as a comment)', function () {
        var body = bodyOf('isBoolean');
        assert.equal(activeLines(body).indexOf("errors['isRequired'] && this.value == false"), -1,
            "the loose gate matched '' and deleted the isRequired error a genuinely-empty field had earned");
        // positive control: the literal survives in the raw body as the
        // replace-code record — proving the stripped view discriminates.
        assert.ok(body.indexOf("errors['isRequired'] && this.value == false") > -1,
            'the // was: record must keep the old gate visible');
    });

    it('02.3 - the rescue now runs post-switch, gated on ACCEPTANCE', function () {
        assert.match(activeLines(bodyOf('isBoolean')), /val !== null && errors\['isRequired'\]/,
            'a recognized boolean false/0 is a present answer; an unrecognized value never rescues');
    });

    it('02.4 - the tail joins Shape A', function () {
        assert.match(activeLines(bodyOf('isBoolean')), /this\.valid = isValid && !errors\['isRequired'\];/,
            'per-field flag stays consistent with a surviving isRequired error');
    });

    it('02.5 - premise: the documented accept-set switch is byte-unchanged', function () {
        var body = bodyOf('isBoolean');
        ["case 'true':", 'case true:', 'case 1:', "case 'false':", 'case false:', 'case 0:'].forEach(function (c) {
            assert.ok(body.indexOf(c) > -1, 'missing ' + c);
        });
    });
});

// ---------------------------------------------------------------------------
// §03 — behaviour: the engine direct (what routing `validator::` also runs)
// ---------------------------------------------------------------------------
describe('validator-isboolean-contract §03 — engine behaviour', function () {

    it('03.1 - THE #B235 RED: required + EMPTY records isRequired ALONE', function () {
        var r = driveEngine('', true);
        assert.deepEqual(r.errorKeys, ['isRequired'],
            'pre-fix the loose rescue deleted isRequired and isBoolean reported instead');
        assert.equal(r.valid, false, 'Shape A keeps the field flag honest');
    });

    it('03.2 - optional + EMPTY passes (the #B78 contract for every rule)', function () {
        var r = driveEngine('', false);
        assert.deepEqual(r.errorKeys, []);
        assert.equal(r.valid, true);
    });

    it('03.3 - premise: junk still fails isBoolean (engine unchanged for junk)', function () {
        ['nope', 'on', '1', 'TRUE'].forEach(function (v) {
            var r = driveEngine(v, true);
            assert.deepEqual(r.errorKeys, ['isBoolean'], 'for ' + JSON.stringify(v));
        });
    });

    it('03.4 - premise: a required boolean false / number 0 is a PRESENT answer', function () {
        [false, 0].forEach(function (v) {
            var r = driveEngine(v, true);
            assert.deepEqual(r.errorKeys, [], 'for ' + JSON.stringify(v));
            assert.equal(r.valid, true);
            assert.equal(r.value, false, 'accepted and cast');
        });
    });

    it('03.5 - premise: the documented accept-set still casts', function () {
        assert.equal(driveEngine('true', false).value, true);
        assert.equal(driveEngine('false', false).value, false);
        assert.equal(driveEngine(1, false).value, true);
        assert.equal(driveEngine(true, false).value, true);
    });
});

// ---------------------------------------------------------------------------
// §04 — behaviour: the plugin auto path (the #B236 reds)
// ---------------------------------------------------------------------------
describe('validator-isboolean-contract §04 — plugin auto path', function () {

    it('04.1 - THE #B236 RED: junk no longer validates clean and persists as false', function () {
        var r = drivePlugin(REQ_BOOL, { myField: 'nope' });
        assert.equal(r.formValid, false,
            'pre-fix: isValid() true, zero errors, data.myField === false — silent data corruption');
        assert.deepEqual(r.errs.myField, ['isBoolean']);
    });

    it('04.2 - a checked HTML checkbox posting "on" errors instead of storing UNchecked', function () {
        var r = drivePlugin(REQ_BOOL, { myField: 'on' });
        assert.equal(r.formValid, false, 'pre-fix "on" (the HTML default value) stored as false');
        assert.deepEqual(r.errs.myField, ['isBoolean']);
    });

    it('04.3 - the strings "1"/"0" error (the documented set accepts the NUMBERS 1/0)', function () {
        ['1', '0'].forEach(function (v) {
            var r = drivePlugin(REQ_BOOL, { myField: v });
            assert.equal(r.formValid, false, 'for ' + JSON.stringify(v) + ' (pre-fix both stored false)');
            assert.deepEqual(r.errs.myField, ['isBoolean']);
        });
    });

    it('04.4 - "TRUE"/"True" error (the pre-cast was case-insensitive; the contract is not)', function () {
        ['TRUE', 'True'].forEach(function (v) {
            var r = drivePlugin(REQ_BOOL, { myField: v });
            assert.equal(r.formValid, false, 'for ' + JSON.stringify(v));
            assert.deepEqual(r.errs.myField, ['isBoolean']);
        });
    });

    it('04.5 - the number 1 now stores TRUE (pre-fix it stored false — a silent meaning flip)', function () {
        var r = drivePlugin(REQ_BOOL, { myField: 1 });
        assert.equal(r.formValid, true);
        assert.equal(r.data.myField, true,
            'the engine accepts 1 as true; the pre-cast coerced it to false');
    });

    it('04.6 - premise: the number 0 stores false on both sides of the fix', function () {
        var r = drivePlugin(REQ_BOOL, { myField: 0 });
        assert.equal(r.formValid, true);
        assert.equal(r.data.myField, false);
    });

    it('04.7 - required + EMPTY reports isRequired alone through the plugin too', function () {
        var r = drivePlugin(REQ_BOOL, { myField: '' });
        assert.equal(r.formValid, false);
        assert.deepEqual(r.errs.myField, ['isRequired'],
            'pre-fix: ["isBoolean"], with the isRequired error silently deleted');
    });

    it('04.8 - optional + EMPTY passes through the plugin', function () {
        var r = drivePlugin(OPT_BOOL, { myField: '' });
        assert.equal(r.formValid, true, 'pre-fix an optional empty boolean field FAILED');
        assert.deepEqual(r.errs, {});
    });

    it('04.9 - premise: the documented accept-set is unchanged end-to-end', function () {
        assert.deepEqual(drivePlugin(REQ_BOOL, { myField: 'true' }).data.myField, true);
        assert.deepEqual(drivePlugin(REQ_BOOL, { myField: 'false' }).data.myField, false);
        assert.deepEqual(drivePlugin(REQ_BOOL, { myField: true }).data.myField, true);
        assert.deepEqual(drivePlugin(REQ_BOOL, { myField: false }).data.myField, false);
    });

    it('04.10 - control: the canonical rule is untouched (isEmail required+empty)', function () {
        var r = drivePlugin({ myField: { isRequired: true, isEmail: true } }, { myField: '' });
        assert.equal(r.formValid, false);
        assert.deepEqual(r.errs.myField, ['isRequired']);
    });

    it('04.11 - the array rule form [flag, message] follows the same contract', function () {
        var r = drivePlugin({ myField: { isRequired: true, isBoolean: [true, 'custom message'] } },
            { myField: 'nope' });
        assert.equal(r.formValid, false, 'pre-fix the array form also funneled junk to false');
        assert.deepEqual(r.errs.myField, ['isBoolean']);
    });
});

// ---------------------------------------------------------------------------
// §05 — dynamised-$ preservation (why the pre-cast survives in that one mode)
// ---------------------------------------------------------------------------
describe('validator-isboolean-contract §05 — dynamised substitution', function () {

    var DYN_RULES = {
        flag: { isRequired: true, isBoolean: true },
        dep: { isRequired: true, is: '$flag === true' }
    };

    it('05.1 - a string-"true" flag still splices as an unquoted boolean operand', function () {
        // Deleting the pre-cast outright (instead of gating it) was measured
        // breaking exactly this arm: the flag spliced as the quoted string
        // `"true"`, the strict condition failed, and the dependent field
        // errored on a valid form.
        var r = drivePlugin(DYN_RULES, { flag: 'true', dep: 'x' });
        assert.equal(r.formValid, true);
        assert.deepEqual(r.errs, {}, 'the dependent is-condition must keep matching');
    });

    it('05.2 - a junk flag now errors itself WITHOUT changing the condition splice', function () {
        var r = drivePlugin({
            flag: { isRequired: true, isBoolean: true },
            dep: { isRequired: true, is: '$flag === false' }
        }, { flag: 'nope', dep: 'x' });
        assert.equal(r.formValid, false, 'pre-fix the whole form VALIDATED on a junk flag');
        assert.deepEqual(r.errs.flag, ['isBoolean']);
        assert.equal(typeof r.errs.dep, 'undefined',
            'the dynamised cast still splices junk as false, so the condition verdict is unchanged');
    });

    it('05.3 - premise: a real boolean flag is untouched by the gate', function () {
        var r = drivePlugin(DYN_RULES, { flag: true, dep: 'x' });
        assert.equal(r.formValid, true);
        assert.deepEqual(r.errs, {});
    });
});

// ---------------------------------------------------------------------------
// §06 — dist fidelity (red until the prod rebuild)
// ---------------------------------------------------------------------------
describe('validator-isboolean-contract §06 — dist fidelity', function () {

    it('06.1 - gina.js carries the gated pre-cast; the ungated form is gone', function () {
        var raw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
        var active = activeLines(raw);
        assert.ok(active.indexOf('} else if (isOnDynamisedRules && ruleObj[fieldName].isBoolean) {') > -1,
            'the gate must reach the bundle');
        assert.equal(active.indexOf('} else if (ruleObj[fieldName].isBoolean) {'), -1,
            'the ungated funnel must not survive in executable dist bytes');
    });

    it('06.2 - gina.js carries the engine contract shape', function () {
        var active = activeLines(fs.readFileSync(DIST_RAW_PATH, 'utf8'));
        assert.ok(active.indexOf('val !== null && errors[\'isRequired\']') > -1,
            'the acceptance-gated rescue');
        assert.equal(active.indexOf("errors['isRequired'] && this.value == false"), -1,
            'the loose rescue is gone from executable dist bytes');
    });

    it('06.3 - gina.min.js: the served artifact carries the acceptance-gated rescue', function () {
        var min = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // Derived from the REAL Closure emission at the rebuild (never authored
        // from a guessed shape) and validated 0-pre/1-post against the actual
        // artifacts. Closure keeps the source operand order and folds the if
        // into a &&-chain: `<v>!==null&&<errs>.isRequired&&delete <errs>.isRequired`
        // (identifier-agnostic via backreference; wrap-agnostic per the
        // content-dependent line-wrap lesson).
        var m = min.match(/([A-Za-z_$][\w$]*)\s*!==\s*null\s*&&\s*([A-Za-z_$][\w$]*)\s*\.\s*isRequired\s*&&\s*delete\s+\2\s*\.\s*isRequired/);
        assert.ok(m, 'gina.min.js is what browsers run — the rescue gate must reach it');
    });
});
