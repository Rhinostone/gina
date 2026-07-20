/**
 * validator-case-coercion — `_case_` condition matching read the WRONG
 * variable at the cross-field scan site (#B129).
 *
 * forEachField's `for (var c in rules)` `_case_` scan (site A) derives
 * `caseValue` from the CASE field (`allFields[caseName]`), but the isGFFCtx
 * boolean coercion that followed tested `fields[field]` — the OUTER field
 * being validated. Two failure modes: (1) a case field without `isBoolean`
 * never matched a boolean `case: false` declaration against its raw
 * "false"/"true" DOM string; (2) when the outer field's own value was the
 * string "true"/"false", `caseValue` was CLOBBERED to a boolean regardless of
 * the case field, so string cases stopped matching for that field's pass.
 * Masked in full-form passes by the direct-case site (site C — correct
 * variable, unconditional coercion) and by formatFields' isBoolean-gated
 * pre-coercion; UNMASKED in single-element/live-check mode, where site C
 * never runs.
 *
 * Fix: coerce the case value itself — site-C semantics (unconditional string
 * "true"/"false" -> boolean), the isGFFCtx gate kept. Site C is deliberately
 * untouched (its coercion legitimately reads the field under iteration, which
 * IS the case field there) — §01.4 pins that, doubling as the known-positive
 * control for §01.3's negative needle. Site B stays dead code (its case-match
 * conjunct is commented out) — report-only in the ledger.
 *
 * The coercion is isGFFCtx-gated, so the server auto path cannot discriminate,
 * and a jsdom boot of the client instance is not feasible in node:test (the
 * auto-boot test documents the limit). Per the established idiom the
 * behavioural assertions EXECUTE THE EXTRACTED REAL BYTES of forEachField
 * (control-gated: the extraction must COMPILE — a mis-bounded slice is a
 * SyntaxError, a can-fail control; raw brace-counting is invalid here because
 * the function body carries a block-commented code region) with isGFFCtx
 * injected true and checkFieldAgainstRules replaced by a recording spy. The
 * assert surface is the APPLY DECISION — which rule set reaches the field
 * check — the engine's own rule execution being covered by its own suites.
 * The full integration truth lives in the real-browser smoke recorded in the
 * ledger entry.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');
require(path.join(FW, '../../utils/prototypes')); // JSON.clone + Object.prototype.count

var merge = require(path.join(FW, 'lib/merge'));

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var MAIN_SRC  = fs.readFileSync(MAIN_PATH, 'utf8');

function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// ---------------------------------------------------------------------------
// Site slices (control-gated anchors)
// ---------------------------------------------------------------------------

// Site A — the cross-field `_case_` scan's caseValue derivation + coercion.
var SITE_A_START = 'caseValue = allFields[caseName];';
var SITE_A_END   = '// filtering conditions';

// Site C — the direct-case branch (hasCase): correct variable, deliberately
// untouched. Two spaces after `=` — the shipped byte shape.
var SITE_C_START = 'caseValue =  allFields[field];';
var SITE_C_END   = "conditions[c]['case'] === caseValue";

function sliceBetween(src, startLit, endLit) {
    var s = src.indexOf(startLit);
    if (s < 0) return null;
    var e = src.indexOf(endLit, s);
    if (e < 0) return null;
    return src.substring(s, e);
}

// ---------------------------------------------------------------------------
// Control-gated extraction of the REAL forEachField bytes
// ---------------------------------------------------------------------------

var FE_DECL = 'var forEachField = function($formOrElement, allFields, allRules, fields, $fields, rules, cb, i) {';

var feSrc = (function () {
    var s = MAIN_SRC.indexOf(FE_DECL);
    if (s < 0) return null;
    // forEachField's close is the last `}` before validate()'s own
    // addListener block — the first statement following the definition.
    var endAnchor = MAIN_SRC.indexOf('addListener(gina, $formOrElement, evt', s);
    if (endAnchor < 0) return null;
    var close = MAIN_SRC.lastIndexOf('}', endAnchor);
    return MAIN_SRC.substring(s, close + 1);
})();

// Free identifiers the extraction closes over (stubs injected per drive),
// then the drive-time arguments handed to forEachField itself.
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

function mkEl(value) {
    return {
        value    : value,
        tagName  : 'INPUT',
        checked  : false,
        disabled : false,
        getAttribute : function (a) { return (a === 'type') ? 'text' : null; },
        setAttribute : function () {}
    };
}

/**
 * Drives the extracted bytes in SINGLE-ELEMENT shape (the unmasked path):
 * `fields` carries only the edited field; the case field exists in the form
 * DOM ($allFields) only, so the shipped `$allFields[caseName].value` read
 * populates it — exactly the live-check state in which site C never runs.
 * Returns the recorded checkFieldAgainstRules calls.
 */
function driveFE(src, opts) {
    var applied = [];
    var spy = function (name, rulesArg) {
        applied.push({ name: name, rule: JSON.clone(rulesArg[name] || {}) });
    };
    var fields = {};
    fields[opts.editedField] = opts.editedValue;
    var $fields = {};
    $fields[opts.editedField] = mkEl(String(opts.editedValue));
    var $allFields = {};
    $allFields[opts.editedField] = $fields[opts.editedField];
    $allFields[opts.caseName]    = mkEl(opts.caseDomValue);
    var rules = {};
    rules[opts.editedField] = { isRequired: true };
    rules['_case_' + opts.caseName] = {
        conditions: [ { case: opts.caseSpec, rules: opts.conditionRules } ]
    };
    var allFields = {};
    allFields[opts.editedField] = opts.editedValue;
    var d = {
        addField : function () {},
        getErrors: function () { return {}; },
        toData   : function () { return {}; },
        isValid  : function () { return true; }
    };
    var fn = compileFE(src);
    fn(
        true,                          // isGFFCtx — the gate under test
        $allFields, spy, merge,
        0,                             // subLevelRules
        {},                            // fieldErrorsAttributes
        d,
        function (x) { return x; },    // formatData
        false,                         // envIsDev
        {},                            // gina
        {},                            // window
        function () {},                // triggerEvent
        function () {},                // addListener
        function () {},                // removeListener
        {},                            // instance
        'change.',                     // evt
        false, false, 0,               // hasParsedAllRules, hasBeenValidated, asyncCount
        null, 'x',                     // data, id
        null, null, null,              // re, flags, caseField (undeclared writes contained)
        allFields, JSON.clone(rules), fields, $fields, rules
    );
    return applied;
}

function conditionApplied(applied, field, marker) {
    return applied.some(function (c) {
        return c.name === field && typeof(c.rule[marker]) != 'undefined';
    });
}

function baseRuleSeen(applied, field) {
    return applied.some(function (c) {
        return c.name === field && typeof(c.rule.isRequired) != 'undefined';
    });
}

// ---------------------------------------------------------------------------
// §01 — source pins (site A block-scoped; site C untouched control)
// ---------------------------------------------------------------------------

describe('validator-case-coercion §01 — source pins', function () {

    it('01.1 - slice anchors resolve (control: the slices can fail)', function () {
        assert.ok(sliceBetween(MAIN_SRC, SITE_A_START, SITE_A_END),
            'site-A slice anchors not found');
        assert.ok(sliceBetween(MAIN_SRC, SITE_C_START, SITE_C_END),
            'site-C slice anchors not found');
    });

    it('01.2 - site A coerces the CASE VALUE itself (site-C semantics, gate kept)', function () {
        var block = stripComments(sliceBetween(MAIN_SRC, SITE_A_START, SITE_A_END));
        var assignIdx = block.indexOf('caseValue = allFields[caseName];');
        var gateIdx   = block.indexOf('if (isGFFCtx)');
        var coerceT   = block.indexOf('if (caseValue == "true")');
        var coerceF   = block.indexOf('else if (caseValue == "false")');
        assert.ok(assignIdx > -1, 'caseValue derivation missing from the slice');
        assert.ok(gateIdx > assignIdx, 'the isGFFCtx gate must follow the derivation');
        assert.ok(coerceT > gateIdx, 'the "true" coercion must test caseValue inside the gate');
        assert.ok(coerceF > coerceT, 'the "false" coercion must test caseValue after the "true" arm');
        assert.ok(block.indexOf('caseValue = true') > -1 && block.indexOf('caseValue = false') > -1,
            'both boolean assignments must land on caseValue');
    });

    it('01.3 - site A no longer reads the outer field (negative, comment-stripped)', function () {
        var block = stripComments(sliceBetween(MAIN_SRC, SITE_A_START, SITE_A_END));
        assert.ok(block.indexOf('fields[field]') < 0,
            'the site-A coercion must not consult fields[field] — the outer field being validated');
    });

    it('01.4 - site C untouched (document-don\'t-touch) — known-positive control for 01.3\'s needle', function () {
        var block = stripComments(sliceBetween(MAIN_SRC, SITE_C_START, SITE_C_END));
        assert.ok(block.indexOf('fields[field] == "true"') > -1,
            'site C must keep its own coercion shape — and this proves the 01.3 needle is findable by this instrument');
    });
});

// ---------------------------------------------------------------------------
// §02 — extracted REAL bytes: apply decisions in single-element mode
// ---------------------------------------------------------------------------

describe('validator-case-coercion §02 — extracted REAL bytes (single-element mode)', function () {

    it('02.1 - extraction controls: bounded, compiles, carries the site under test', function () {
        assert.ok(feSrc, 'forEachField extraction anchors not found');
        assert.ok(feSrc.indexOf(FE_DECL) === 0, 'extraction must start at the declaration');
        assert.equal(feSrc[feSrc.length - 1], '}', 'extraction must end on the closing brace');
        assert.ok(feSrc.indexOf(SITE_A_START) > -1, 'site A must be inside the extraction');
        assert.ok(feSrc.indexOf('checkFieldAgainstRules(') > -1, 'the apply call must be inside the extraction');
        assert.doesNotThrow(function () { compileFE(feSrc); },
            'the extraction must compile — a mis-bounded slice is a SyntaxError');
    });

    it('02.2 - mode 1: boolean `case: false` now matches a raw "false" case-field DOM string', function () {
        var applied = driveFE(feSrc, {
            editedField: 'amount', editedValue: '150',
            caseName: 'pricingMode', caseDomValue: 'false',
            caseSpec: false,
            conditionRules: { amount: { maxLength: 2 } }
        });
        assert.ok(conditionApplied(applied, 'amount', 'maxLength'),
            'the matched condition\'s rules must reach the field check (they were silently skipped)');
    });

    it('02.3 - mode 2: an outer field valued "true" no longer clobbers a string case match', function () {
        var applied = driveFE(feSrc, {
            editedField: 'amount', editedValue: 'true',
            caseName: 'pricingMode', caseDomValue: 'b',
            caseSpec: 'b',
            conditionRules: { amount: { maxLength: 2 } }
        });
        assert.ok(conditionApplied(applied, 'amount', 'maxLength'),
            'a string case must keep matching when the OUTER field\'s own value is "true"/"false"');
    });

    it('02.4 - harness liveness control: a plain string case matches pre- and post-fix', function () {
        // NOT a discriminator — this arm passes against the pre-fix bytes too;
        // it proves the drive detects application at all.
        var applied = driveFE(feSrc, {
            editedField: 'amount', editedValue: '150',
            caseName: 'pricingMode', caseDomValue: 'b',
            caseSpec: 'b',
            conditionRules: { amount: { maxLength: 2 } }
        });
        assert.ok(conditionApplied(applied, 'amount', 'maxLength'), 'harness cannot see applications');
    });

    it('02.5 - the filter still filters: a non-matching case stays skipped (with liveness)', function () {
        var applied = driveFE(feSrc, {
            editedField: 'amount', editedValue: '150',
            caseName: 'pricingMode', caseDomValue: 'other',
            caseSpec: false,
            conditionRules: { amount: { maxLength: 2 } }
        });
        assert.ok(!conditionApplied(applied, 'amount', 'maxLength'),
            'the fix must not make every condition match');
        assert.ok(baseRuleSeen(applied, 'amount'),
            'the base-rule check must still run — proves the drive executed (probe asymmetry)');
    });
});

// ---------------------------------------------------------------------------
// §03 — composed pre-fix replica SUBTRACT (the consumer-class symptom)
// ---------------------------------------------------------------------------

describe('validator-case-coercion §03 — pre-fix replica SUBTRACT', function () {

    var FIX_TEST_TRUE  = 'if (caseValue == "true")';
    var FIX_TEST_FALSE = 'else if (caseValue == "false")';
    var PRE_TEST_TRUE  = 'if (fields[field] == "true")';
    var PRE_TEST_FALSE = 'else if (fields[field] == "false")';

    function preFixFE() {
        // Count-refuse guards: each fixed literal must appear exactly once in
        // the LIVE extraction bytes before the swap (the batch-replace rule).
        assert.equal(feSrc.split(FIX_TEST_TRUE).length - 1, 1,
            'expected exactly one live "true" coercion test in the extraction');
        assert.equal(feSrc.split(FIX_TEST_FALSE).length - 1, 1,
            'expected exactly one live "false" coercion test in the extraction');
        // Swapping only the tested expression reconstructs the exact pre-fix
        // bytes (indentation and the rest of the block are unchanged).
        return feSrc
            .replace(FIX_TEST_TRUE, PRE_TEST_TRUE)
            .replace(FIX_TEST_FALSE, PRE_TEST_FALSE);
    }

    it('03.1 - SUBTRACT mode 1: pre-fix, boolean `case: false` is silently skipped', function () {
        var applied = driveFE(preFixFE(), {
            editedField: 'amount', editedValue: '150',
            caseName: 'pricingMode', caseDomValue: 'false',
            caseSpec: false,
            conditionRules: { amount: { maxLength: 2 } }
        });
        assert.ok(!conditionApplied(applied, 'amount', 'maxLength'),
            'pre-fix the condition must NOT apply — the caseValue never coerced');
        assert.ok(baseRuleSeen(applied, 'amount'),
            'the base-rule check still runs pre-fix — the skip is silent, not a crash');
    });

    it('03.2 - SUBTRACT mode 2: pre-fix, an outer "true" clobbers a string case match', function () {
        var applied = driveFE(preFixFE(), {
            editedField: 'amount', editedValue: 'true',
            caseName: 'pricingMode', caseDomValue: 'b',
            caseSpec: 'b',
            conditionRules: { amount: { maxLength: 2 } }
        });
        assert.ok(!conditionApplied(applied, 'amount', 'maxLength'),
            'pre-fix the string case must NOT match — caseValue was clobbered to boolean true');
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity
// ---------------------------------------------------------------------------

describe('validator-case-coercion §04 — dist fidelity', function () {

    var DIST_JS  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
    var DIST_MIN = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

    it('04.1 - gina.js carries the fixed site-A shape (and site C untouched)', function () {
        var src = fs.readFileSync(DIST_JS, 'utf8');
        var blockA = sliceBetween(src, SITE_A_START, SITE_A_END);
        assert.ok(blockA, 'site-A slice not found in the bundled gina.js');
        blockA = stripComments(blockA);
        assert.ok(blockA.indexOf('if (caseValue == "true")') > -1,
            'bundled gina.js must coerce caseValue itself');
        assert.ok(blockA.indexOf('fields[field]') < 0,
            'bundled gina.js site A must not read the outer field');
        var blockC = sliceBetween(src, SITE_C_START, SITE_C_END);
        assert.ok(blockC && stripComments(blockC).indexOf('fields[field] == "true"') > -1,
            'bundled gina.js site C must keep its shape (needle control)');
    });

    it('04.2 - gina.min.js carries a self-testing bare-variable coercion (0 pre-fix, validated)', function () {
        // Closure renames locals, so the discriminator is the SHAPE: the
        // coerced variable is the tested variable (backreferences), where the
        // pre-fix site tested a bracketed access of a different object.
        // Validated against the pre-fix artifact: 0 matches there.
        // Wrap-agnostic (realigned 2026-07-20, approved): Closure's line-wrap
        // position is content-dependent and an unrelated rebuild landed the
        // wrap INSIDE this expression (`?y=` <newline> `!0`), so every token
        // boundary tolerates whitespace; the backreference discriminator is
        // unchanged (re-validated: still 0 on the pre-fix artifact).
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        var core = /\(([$A-Za-z0-9_]+)=='true'\?\s*\1=\s*!0\s*:\s*\1=='false'\s*&&\s*\(\s*\1=\s*!1\s*\)\s*\)/;
        assert.ok(core.test(min),
            'gina.min.js must carry the self-testing caseValue coercion shape');
    });
});
