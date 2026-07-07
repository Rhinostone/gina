'use strict';
/**
 * FormValidator — a cross-field `is` rule must not THROW when the referenced field is empty
 *
 * A rule like { "is": "$a === $b", "exclude": true } compares one field against another (the
 * framework's documented cross-field / value-confirmation pattern, which pairs `is` with
 * `isRequired`). When the referenced field is EMPTY and also carries a rule entry, the client
 * orchestration mis-rendered the empty operand and the shared engine threw — and because the
 * throw was uncaught it aborted the WHOLE-FORM validity pass, so the submit trigger never got
 * gated (it stayed enabled on an invalid form, the entire time the field was still empty).
 *
 * ROOT CAUSE (main.js `getCastedValue`): in dynamised-rules mode an empty referenced field was
 * spliced RAW (unquoted) into the stringified condition, leaving a DANGLING operator
 * (`"x" === `) that the engine's binary-comparison grammar (form-validator.js `_SCS_BINARY_RE`)
 * rejects. FIX: quote the empty value as "" in dynamised mode (mirrors getDynamisedRules' own
 * sibling default `... : '\\"\\"'`) so the condition stays a parseable `"x" === ""` (a normal
 * mismatch = false). `null`/`undefined` stay raw — they are already valid grammar operands.
 *
 * HARDENING (form-validator.js `is()`): the binary-grammar mismatch now FAILS THE FIELD
 * (console.warn + isValid=false) instead of throwing, so a per-keystroke live pass can never
 * abort the gate on a residually-unparseable condition — most notably a field literally valued
 * "NaN" (which the early-return regex `/^(null|NaN|undefined|\s*)$/i` matches but the root fix
 * deliberately leaves raw, since "NaN" is NOT a grammar operand), or a plain authoring typo.
 * Fail-closed on both the client and the server.
 *
 * Refinement measured during reproduction: `getCastedValue` fires only for a referenced field
 * that ALSO carries a rule entry (the gate `isInRule && typeof(ruleObj[field]) != 'undefined'`
 * in getDynamisedRules). A referenced empty field with NO rule entry keeps the substitution
 * DEFAULT (quoted `""`) and never throws. The canonical case satisfies the trigger because the
 * `{isRequired, is}` rule lives ON the empty field, so it is both host and referenced field.
 *
 * STRATEGY (architecture doc §9 house-style): source-faithful REPLICAS of `getCastedValue`,
 * `getDynamisedRules`'s first substitution loop, the `is()` binary-grammar guard, and the
 * whole-form per-field try/catch — driven directly (these are closure-private and cannot be
 * instantiated in node:test) — plus SUBTRACT replicas of the pre-fix shapes so the suite
 * distinguishes fix from bug, and a SOURCE-INSPECTION block (§05) pinning the shipped shapes so
 * the replicas cannot drift from the real files.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var FVAL = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');

var mainSrc, fvalSrc;
before(function () {
    mainSrc = fs.readFileSync(MAIN, 'utf8');
    fvalSrc = fs.readFileSync(FVAL, 'utf8');
});

// ---------------------------------------------------------------------------
// Replicas — mirror the shipped source (§05 source-pins keep them honest).
// ---------------------------------------------------------------------------

// main.js getCastedValue — FIXED shape (empty/whitespace -> quoted "" in dynamised mode).
// Numeric/boolean branches are omitted: string cross-field comparisons never reach them.
function getCastedValue(ruleObj, fields, fieldName, isOnDynamisedRulesMode) {
    var isOnDynamisedRules = (
        typeof(isOnDynamisedRulesMode) != 'undefined'
        && /^true$/i.test(isOnDynamisedRulesMode)
    );
    if (
        typeof(ruleObj[fieldName]) == 'undefined'
        || /^(null|NaN|undefined|\s*)$/i.test(fields[fieldName])
    ) {
        if ( isOnDynamisedRules && /^\s*$/.test(fields[fieldName]) ) {
            return '\\"\\"';
        }
        return fields[fieldName];
    }
    return isOnDynamisedRules ? '\\"' + fields[fieldName] + '\\"' : fields[fieldName];
}

// main.js getCastedValue — PRE-FIX shape (empty -> raw unquoted), for the subtract.
function getCastedValue_preFix(ruleObj, fields, fieldName, isOnDynamisedRulesMode) {
    if (
        typeof(ruleObj[fieldName]) == 'undefined'
        || /^(null|NaN|undefined|\s*)$/i.test(fields[fieldName])
    ) {
        return fields[fieldName];
    }
    return (
        typeof(isOnDynamisedRulesMode) != 'undefined'
        && /^true$/i.test(isOnDynamisedRulesMode)
    ) ? '\\"' + fields[fieldName] + '\\"' : fields[fieldName];
}

// main.js getDynamisedRules — first substitution loop (mirrors 6798-6817). Sorts field names
// reversed (longer prefixes first so `$a` can't eat `$aLong`), then replaces each `$field` with
// its cast — honoring the gate: getCastedValue only overwrites the quoted default when the field
// carries a rule entry. Returns the parsed, dynamised rules object.
function dynamise(rules, fields, castFn) {
    var stringified    = JSON.stringify(rules);
    var ruleObj        = JSON.parse(stringified.replace(/"(true|false)"/gi, '$1'));
    var stringifiedTmp = JSON.stringify(ruleObj);
    var arrFields      = Object.keys(fields);
    arrFields.sort().reverse();
    for (var i = 0; i < arrFields.length; i++) {
        var _field     = arrFields[i].replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&');
        var re         = new RegExp('\\$' + _field, 'g');
        var fieldValue = '\\"' + fields[arrFields[i]] + '\\"'; // default (already empty-safe)
        var isInRule   = re.test(stringifiedTmp);
        if ( isInRule && typeof(ruleObj[arrFields[i]]) != 'undefined' ) {
            fieldValue = castFn(ruleObj, fields, arrFields[i], true);
        }
        stringified = stringified.replace(re, fieldValue);
    }
    return JSON.parse(stringified);
}

// form-validator.js is() binary-grammar guard.
var _SCS_BINARY_RE = /^\s*(null|undefined|true|false|"[^"]*"|-?\d+(?:\.\d+)?)\s*(===|!==|<=|>=|==|!=|<|>)\s*(null|undefined|true|false|"[^"]*"|-?\d+(?:\.\d+)?)\s*$/;

function _parseOperand(s) {
    var _t = s.replace(/^\s+|\s+$/g, '');
    if (_t === 'null')      return null;
    if (_t === 'undefined') return undefined;
    if (_t === 'true')      return true;
    if (_t === 'false')     return false;
    if (/^"[^"]*"$/.test(_t)) return _t.slice(1, -1);
    return Number(_t);
}

function _compare(l, op, r) {
    switch (op) {
        case '===': return l === r;
        case '!==': return l !== r;
        case '==':  return l ==  r;
        case '!=':  return l !=  r;
        case '<':   return l <   r;
        case '>':   return l >   r;
        case '<=':  return l <=  r;
        case '>=':  return l >=  r;
    }
    return false;
}

// FIXED: an unparseable condition FAILS THE FIELD (would console.warn live), never throws.
function evalCondition(compiledCondition) {
    var m = (typeof(compiledCondition) == 'string') ? compiledCondition.match(_SCS_BINARY_RE) : null;
    if (!m) { return false; }
    return _compare(_parseOperand(m[1]), m[2], _parseOperand(m[3]));
}

// PRE-FIX: an unparseable condition throws (the reported crash), for the subtract.
function evalCondition_preFix(compiledCondition) {
    var m = (typeof(compiledCondition) == 'string') ? compiledCondition.match(_SCS_BINARY_RE) : null;
    if (!m) { throw new Error('Could not evaluate condition `' + compiledCondition + '`.'); }
    return _compare(_parseOperand(m[1]), m[2], _parseOperand(m[3]));
}

// Pull the condition operand out of a rule's `is` value (string form OR [condition, message]).
function isCondition(rule) {
    var v = rule['is'];
    return Array.isArray(v) ? v[0] : v;
}

// validate() per-field loop — mirrors the invoke (main.js 7094) + the try/catch that re-wraps and
// RE-THROWS a rule-method error (7100-7104). An uncaught re-throw is what aborts the whole-form
// pass so the submit-trigger gate never runs. Models the is() empty-field self-pass just enough to
// reproduce the isRequired-first-defeats-the-mask condition: an empty host with NO isRequired
// passes untested; an empty host WITH isRequired is evaluated (which is where the dangling operator
// bites). Returns { formValid, gateRan }; throws (pre-fix) when a rule method throws.
function runWholeFormPass(dynamisedRules, fields, evalFn) {
    var formValid = true;
    for (var field in dynamisedRules) {
        for (var rule in dynamisedRules[field]) {
            try {
                if (rule === 'is') {
                    var host     = fields[field];
                    var required = !!dynamisedRules[field]['isRequired'];
                    var isValid  = (host === '' && !required) ? true : evalFn(isCondition(dynamisedRules[field]));
                    if (!isValid) { formValid = false; }
                } else if (rule === 'isRequired') {
                    if (dynamisedRules[field]['isRequired'] && fields[field] === '') { formValid = false; }
                }
            } catch (err) {
                throw new Error('[ ginaFormValidator ] could not evaluate `' + field + '->' + rule + '()`\nStack:\n' + err);
            }
        }
    }
    return { formValid: formValid, gateRan: true }; // gateRan only reachable if the pass didn't abort
}

// The framework's documented cross-field pattern: `is` lives ON the confirm field, paired with
// isRequired (declared first, so it flags an empty field before `is` runs).
var CROSS_FIELD_RULES = {
    fieldA: { isRequired: true, isString: 7 },
    fieldB: { isRequired: true, isString: 7, is: ['$fieldA === $fieldB', 'values do not match'], exclude: true }
};
// Same rules but the `is` in STRING form (as the docs example writes it).
var CROSS_FIELD_RULES_STR = {
    fieldA: { isRequired: true, isString: 7 },
    fieldB: { isRequired: true, isString: 7, is: '$fieldA === $fieldB', exclude: true }
};


describe('FormValidator — cross-field `is` with an empty referenced field', function () {

    // ----- §01  getCastedValue: empty -> quoted "" in dynamised mode only -------------------
    describe('§01 getCastedValue casts an empty value to a quoted "" (dynamised mode)', function () {
        it('empty value + dynamised mode -> quoted empty string', function () {
            assert.equal(getCastedValue(CROSS_FIELD_RULES, { fieldB: '' }, 'fieldB', true), '\\"\\"');
        });
        it('whitespace-only value + dynamised mode -> quoted empty string', function () {
            assert.equal(getCastedValue(CROSS_FIELD_RULES, { fieldB: '   ' }, 'fieldB', true), '\\"\\"');
        });
        it('empty value WITHOUT the dynamised flag -> raw empty string (unchanged)', function () {
            assert.equal(getCastedValue(CROSS_FIELD_RULES, { fieldB: '' }, 'fieldB'), '');
        });
        it('a filled value + dynamised mode -> escaped-quoted value (unchanged)', function () {
            assert.equal(getCastedValue(CROSS_FIELD_RULES, { fieldB: '7654321' }, 'fieldB', true), '\\"7654321\\"');
        });
        it('null/undefined stay RAW (they are valid grammar operands, must NOT be quoted)', function () {
            assert.equal(getCastedValue(CROSS_FIELD_RULES, { fieldB: 'null' }, 'fieldB', true), 'null');
            assert.equal(getCastedValue(CROSS_FIELD_RULES, { fieldB: 'undefined' }, 'fieldB', true), 'undefined');
        });
        it('the PRE-FIX cast returned a RAW empty value in dynamised mode (the defect)', function () {
            assert.equal(getCastedValue_preFix(CROSS_FIELD_RULES, { fieldB: '' }, 'fieldB', true), '');
        });
    });

    // ----- §02  substitution -> the compiled condition string --------------------------------
    describe('§02 the dynamised condition stays parseable', function () {
        it('empty confirm -> `"7654321" === ""` (parseable), NOT a dangling operator', function () {
            var dyn = dynamise(CROSS_FIELD_RULES, { fieldA: '7654321', fieldB: '' }, getCastedValue);
            assert.equal(isCondition(dyn.fieldB), '"7654321" === ""');
        });
        it('PRE-FIX: empty confirm -> `"7654321" === ` (dangling operator)', function () {
            var dyn = dynamise(CROSS_FIELD_RULES, { fieldA: '7654321', fieldB: '' }, getCastedValue_preFix);
            assert.equal(isCondition(dyn.fieldB), '"7654321" === ');
        });
        it('mismatch -> `"7654321" === "different"`', function () {
            var dyn = dynamise(CROSS_FIELD_RULES, { fieldA: '7654321', fieldB: 'different' }, getCastedValue);
            assert.equal(isCondition(dyn.fieldB), '"7654321" === "different"');
        });
        it('match -> `"7654321" === "7654321"`', function () {
            var dyn = dynamise(CROSS_FIELD_RULES, { fieldA: '7654321', fieldB: '7654321' }, getCastedValue);
            assert.equal(isCondition(dyn.fieldB), '"7654321" === "7654321"');
        });
    });

    // ----- §03  the is() binary-grammar guard ------------------------------------------------
    describe('§03 is() evaluates the parseable condition without throwing', function () {
        it('`"7654321" === ""` -> false, no throw', function () {
            assert.doesNotThrow(function () { assert.equal(evalCondition('"7654321" === ""'), false); });
        });
        it('mismatch -> false, no throw', function () {
            assert.equal(evalCondition('"7654321" === "different"'), false);
        });
        it('match -> true, no throw', function () {
            assert.equal(evalCondition('"7654321" === "7654321"'), true);
        });
        it('SUBTRACT: the dangling operator throws under the pre-fix guard', function () {
            assert.throws(function () { evalCondition_preFix('"7654321" === '); }, /Could not evaluate condition/);
        });
        it('HARDENING: a residually-unparseable condition (a "NaN"-valued field) FAILS the field, no throw', function () {
            // Root fix leaves "NaN" raw (not a grammar operand) -> `"x" === NaN` still no-matches.
            assert.doesNotThrow(function () { assert.equal(evalCondition('"7654321" === NaN'), false); });
            // ...whereas the pre-hardening guard would have thrown on it.
            assert.throws(function () { evalCondition_preFix('"7654321" === NaN'); }, /Could not evaluate condition/);
        });
    });

    // ----- §04  the reported symptom: whole-form pass completes instead of aborting ----------
    describe('§04 the whole-form validity pass completes (submit gate can run)', function () {
        it('REGRESSION: empty confirm + isRequired-first -> pass COMPLETES, form invalid, no throw', function () {
            var fields = { fieldA: '7654321', fieldB: '' };
            var dyn    = dynamise(CROSS_FIELD_RULES, fields, getCastedValue);
            var out;
            assert.doesNotThrow(function () { out = runWholeFormPass(dyn, fields, evalCondition); });
            assert.equal(out.gateRan, true, 'the gate must run (pass did not abort)');
            assert.equal(out.formValid, false, 'the form is invalid (empty required confirm)');
        });
        it('SUBTRACT: the same case under the pre-fix pipeline ABORTS the pass (uncaught throw)', function () {
            var fields = { fieldA: '7654321', fieldB: '' };
            var dyn    = dynamise(CROSS_FIELD_RULES, fields, getCastedValue_preFix);
            assert.throws(function () {
                runWholeFormPass(dyn, fields, evalCondition_preFix);
            }, /\[ ginaFormValidator \] could not evaluate `fieldB->is\(\)`/);
        });
        it('STRING-form `is` -> identical no-throw result (docs example shape)', function () {
            var fields = { fieldA: '7654321', fieldB: '' };
            var dyn    = dynamise(CROSS_FIELD_RULES_STR, fields, getCastedValue);
            var out;
            assert.doesNotThrow(function () { out = runWholeFormPass(dyn, fields, evalCondition); });
            assert.equal(out.formValid, false);
        });
        it('NaN residual: combined fix (root + hardening) completes; root-only (pre-fix eval) still aborts', function () {
            var fields = { fieldA: '7654321', fieldB: 'NaN' };
            var dyn    = dynamise(CROSS_FIELD_RULES, fields, getCastedValue);
            assert.doesNotThrow(function () { runWholeFormPass(dyn, fields, evalCondition); });
            assert.throws(function () { runWholeFormPass(dyn, fields, evalCondition_preFix); });
        });
        it('mismatch -> pass completes, form invalid, is() records failure', function () {
            var fields = { fieldA: '7654321', fieldB: 'different' };
            var dyn    = dynamise(CROSS_FIELD_RULES, fields, getCastedValue);
            var out    = runWholeFormPass(dyn, fields, evalCondition);
            assert.equal(out.formValid, false);
        });
        it('match -> is() passes (no cross-field failure)', function () {
            var fields = { fieldA: '7654321', fieldB: '7654321' };
            var dyn    = dynamise(CROSS_FIELD_RULES, fields, getCastedValue);
            assert.doesNotThrow(function () { runWholeFormPass(dyn, fields, evalCondition); });
            assert.equal(evalCondition(isCondition(dyn.fieldB)), true);
        });
    });

    // ----- §05  hyphenated field name is NOT the trigger (the empty value cast is) -----------
    describe('§05 the empty VALUE cast is the driver, not any hyphen in the field name', function () {
        var HYPHEN_RULES = {
            'field-a': { isRequired: true, isString: 7 },
            'field-b': { isRequired: true, isString: 7, is: ['$field-a === $field-b', 'values do not match'], exclude: true }
        };
        it('hyphenated + empty -> same dangling pre-fix / same quoted post-fix', function () {
            var pre = dynamise(HYPHEN_RULES, { 'field-a': '7654321', 'field-b': '' }, getCastedValue_preFix);
            assert.equal(isCondition(pre['field-b']), '"7654321" === ');
            var fix = dynamise(HYPHEN_RULES, { 'field-a': '7654321', 'field-b': '' }, getCastedValue);
            assert.equal(isCondition(fix['field-b']), '"7654321" === ""');
        });
        it('hyphenated + FILLED -> parses cleanly either way (proves the hyphen never mattered)', function () {
            var fix = dynamise(HYPHEN_RULES, { 'field-a': '7654321', 'field-b': '7654321' }, getCastedValue);
            assert.equal(isCondition(fix['field-b']), '"7654321" === "7654321"');
            assert.equal(evalCondition(isCondition(fix['field-b'])), true);
        });
    });

    // ----- §06  source pins — keep the replicas honest against the shipped files -------------
    describe('§06 source pins (shipped shapes)', function () {
        it('main.js getCastedValue quotes an empty/whitespace value in dynamised mode', function () {
            var start = mainSrc.indexOf('var getCastedValue = function');
            var end   = mainSrc.indexOf('var formatFields', start);
            assert.ok(start >= 0 && end > start, 'getCastedValue block found');
            var block = mainSrc.slice(start, end);
            assert.match(block, /var isOnDynamisedRules = \(/, 'dynamised-mode flag declared');
            assert.match(block, /if \( isOnDynamisedRules && \/\^\\s\*\$\/\.test\(fields\[fieldName\]\) \)/,
                'empty/whitespace guard, scoped to dynamised mode');
            // the quoted-empty return literal `'\\"\\"'` (raw form, no regex-escaping headaches):
            assert.ok(block.indexOf(String.raw`return '\\"\\"';`) >= 0, 'returns the quoted-empty literal');
        });
        it('main.js getCastedValue leaves null/undefined/non-empty raw (scoped to /^\\s*$/, not the full regex)', function () {
            var start = mainSrc.indexOf('var getCastedValue = function');
            var end   = mainSrc.indexOf('var formatFields', start);
            var block = mainSrc.slice(start, end);
            // the quote-guard tests only whitespace-emptiness, NOT the broad null|NaN|undefined regex
            assert.doesNotMatch(block, /isOnDynamisedRules && \/\^\(null\|NaN\|undefined/,
                'the empty-quote guard must not also fire on null/NaN/undefined literals');
        });
        it('form-validator.js is() FAILS the field on a grammar mismatch (no throw)', function () {
            var start = fvalSrc.indexOf('if (!_scsBinMatch) {');
            assert.ok(start >= 0, '_scsBinMatch guard found');
            var elseAt   = fvalSrc.indexOf('} else {', start);
            var ifBlock  = fvalSrc.slice(start, elseAt);
            assert.match(ifBlock, /console\.warn\(/, 'warns on an unparseable condition');
            assert.match(ifBlock, /isValid = false;/, 'fails the field');
            assert.ok(ifBlock.indexOf('throw new Error') < 0, 'the mismatch branch must NOT throw');
        });
        it('form-validator.js is() moved operand parsing into the else (guarded by a match)', function () {
            assert.match(fvalSrc,
                /if \(!_scsBinMatch\) \{[\s\S]*?isValid = false;[\s\S]*?\} else \{[\s\S]*?_scsParseOperand/,
                'operand parsing runs only when the grammar matched');
        });
    });
});
