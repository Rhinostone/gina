'use strict';
/**
 * #B230 — a `_case_` driver's case VALUE must survive its own base-rule check
 * in every full-form pass (client FormValidator, `forEachField`).
 *
 * The defect (pre-fix): `checkFieldAgainstRules` ends every applied rule with
 * `delete fields[field]` on the object it is handed, and the per-field
 * base-rule site 3/3 hands it `allFields`. A field that DRIVES a `_case_`
 * block and is NOT the last-declared driver (the last one takes the restoring
 * `caseName == field` arm) therefore loses its `allFields` entry the moment
 * its own base rules are adjudicated — and that entry is the case VALUE every
 * later reader consumes. Two corruption surfaces, one cause:
 *
 *   1. LATER field iterations' `_case_` scans hit the
 *      `typeof(allFields[caseName]) == 'undefined'` re-seed and assign
 *      `$allFields[caseName].value` — for a radio group the FIRST member's
 *      value regardless of `.checked` — so conditions match a value the user
 *      never picked (spurious rules applied / picked-flow rules dropped).
 *   2. The SAME iteration's direct-case block reads
 *      `caseValue = allFields[field]` after the delete — `undefined` — so the
 *      driver's own conditions silently never match through that path.
 *
 * The fix: back the entry up before site 3/3 and restore it after, gated on
 * the field being a driver in EITHER the live `rules` (`hasCase`) OR the
 * pass-entry clone `allRules`. The union gate is load-bearing: inside a
 * direct-case recursion `rules` is the condition's own rule set, which
 * carries no `_case_` keys — `hasCase` alone leaves a recursion-adjudicated
 * driver corrupting (measured; §04.8/§04.9 pin it).
 *
 * Layering (the sibling file's choreography — red-first on pre-fix bytes):
 *   §01 extraction + can-fail controls
 *   §02 premise pins (the defect substrate the fix rests on)
 *   §03 source pins on the new block + byte-stability of the sibling arm
 *   §04 behavioural matrix on the REAL extracted bytes
 *   §05 naive-variant SUBTRACT (the restore is load-bearing)
 *   §06 dist fidelity (red until the prod rebuild lands the block)
 */

var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var describe = require('node:test').describe;
var it = require('node:test').it;

var FW = require(path.join(__dirname, '..', 'fw'));
var MAIN_PATH = path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var DIST_RAW_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.js');
var DIST_MIN_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');

var MAIN_SRC = fs.readFileSync(MAIN_PATH, 'utf8');

if (typeof JSON.clone !== 'function') {
    // the shipped bytes call the framework's JSON.clone prototype extension
    JSON.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
}

// ---------------------------------------------------------------------------
// Extraction — the SHIPPED forEachField bytes, executed (no replica).
//
// A brace walk cannot be used: forEachField contains a `/** ... */` region
// holding commented-out code whose braces do not balance under a naive scan
// (same rationale as the sibling validator-case-driver-base-rules.test.js).
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

/** Comment-stripped view — negative pins must not match comment records. */
function activeLines(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

var feSrc = sliceForEachField(MAIN_SRC);
var feActive = activeLines(feSrc);

// ---------------------------------------------------------------------------
// Instruments (uniqueness-guarded string injection on the extracted bytes)
//   __caseC  — the direct-case `caseValue = allFields[field]` read (surface 2)
//   __reseed — the `_case_` scan's DOM re-seed (surface 1's mechanism)
// ---------------------------------------------------------------------------
var CASEC_NEEDLE = 'caseValue =  allFields[field];';
var RESEED_NEEDLE = 'allFields[caseName] =  $allFields[caseName].value';

function instrument(src) {
    if (src.split(CASEC_NEEDLE).length !== 2) { throw new Error('direct-case needle not unique'); }
    if (src.split(RESEED_NEEDLE).length !== 2) { throw new Error('re-seed needle not unique'); }
    return src
        .replace(CASEC_NEEDLE, CASEC_NEEDLE + ' __caseC(field, caseValue);')
        .replace(RESEED_NEEDLE, '__reseed(caseName, $allFields[caseName].value); ' + RESEED_NEEDLE);
}

// ---------------------------------------------------------------------------
// Harness — compiles the slice with its free identifiers as parameters.
// The recording spy mirrors the real function's terminal `delete fields[field]`
// FAITHFULLY: the real delete sits INSIDE the per-rule loop, so a rule entry
// with zero keys is recorded as a call but deletes nothing.
// ---------------------------------------------------------------------------
var FE_PARAMS = [
    'isGFFCtx', '$allFields', 'checkFieldAgainstRules', 'merge',
    'subLevelRules', 'fieldErrorsAttributes', 'd', 'formatData', 'envIsDev',
    'gina', 'window', 'triggerEvent', 'addListener', 'removeListener',
    'instance', 'evt', 'hasParsedAllRules', 'hasBeenValidated', 'asyncCount',
    'data', 'id', 're', 'flags', 'caseField',
    '__caseC', '__reseed',
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

function mkRadio(value, checked) {
    return {
        value: value,
        tagName: 'INPUT',
        checked: !!checked,
        disabled: false,
        id: 'el-' + value,
        getAttribute: function (a) { return (a === 'type') ? 'radio' : ((a === 'id') ? this.id : null); },
        setAttribute: function () {}
    };
}

function driveFE(srcInstrumented, opts) {
    var applied = [], caseC = [], reseeds = [];
    var spy = function (name, rulesArg, fieldsArg) {
        var rule = rulesArg[name] || {};
        applied.push({ name: name, rule: JSON.parse(JSON.stringify(rule)) });
        if (typeof (rulesArg[name]) != 'undefined' && Object.keys(rule).length > 0) {
            delete fieldsArg[name];
        }
    };
    var allFields = JSON.parse(JSON.stringify(opts.fields));
    var allRules = JSON.parse(JSON.stringify(opts.rules));
    var d = {
        addField: function () {},
        getErrors: function () { return {}; },
        toData: function () { return {}; },
        isValid: function () { return true; }
    };
    var thrown = null;
    try {
        compileFE(srcInstrumented)(
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
            null, null, null,                       // re, flags, caseField (undeclared writes contained)
            function (f, v) { caseC.push({ field: f, value: v }); },
            function (n, v) { reseeds.push({ name: n, value: v }); },
            allFields,
            allRules,
            JSON.parse(JSON.stringify(opts.fields)),
            opts.$fields,
            JSON.parse(JSON.stringify(opts.rules))
        );
    } catch (err) { thrown = err; }
    return {
        applied: applied,
        names: applied.map(function (c) { return c.name; }),
        caseC: caseC,
        reseeds: reseeds,
        allFields: allFields,
        thrown: thrown
    };
}

function adjudicatedWith(res, field, ruleKey) {
    return res.applied.some(function (c) {
        return c.name === field && typeof (c.rule[ruleKey]) != 'undefined';
    });
}

// ---------------------------------------------------------------------------
// Fixtures — fresh per call (the engine mutates its inputs)
// ---------------------------------------------------------------------------

/** No `_case_` at all — the byte-identity control. */
function plain() {
    return {
        rules: { group: { isRequired: true } },
        fields: { group: '', note: '' },
        $fields: { group: mkRadio('x', false), note: mkRadio('', false) }
    };
}

/**
 * The #B230 shape: driver `a` carries base rules and is NOT the last-declared
 * `_case_` key (`_case_b` follows), so site 3/3 adjudicates it. `a` is an
 * unchecked radio whose FIRST member's value ('x') equals its condition's
 * case — the re-seed manufactures a match the user never made.
 */
function twoCasesBase() {
    return {
        rules: {
            a: { isRequired: true },
            _case_a: { conditions: [{ case: 'x', rules: { extra: { isRequired: true, marker: 'fromCaseA' } } }] },
            b: { isRequired: true },
            _case_b: { conditions: [{ case: 'y', rules: { other: { isRequired: true } } }] }
        },
        fields: { a: '', b: '', extra: '', other: '' },
        $fields: { a: mkRadio('x', false), b: mkRadio('y', false), extra: mkRadio('', false), other: mkRadio('', false) }
    };
}

/**
 * A user picked the SECOND member ('y') of driver `a`, whose FIRST member is
 * 'x'. With base rules on `a`, the pre-fix pass re-seeds 'x' and applies the
 * 'x' flow's rules. `withBase` toggles the driver's base rules so the same
 * fixture doubles as the engine's own no-base-rules REFERENCE behaviour.
 */
function pickedNonFirst(withBase) {
    var rules = {
        _case_a: {
            conditions: [
                { case: 'y', rules: { flowY: { isRequired: true, marker: 'yRule' } } },
                { case: 'x', rules: { flowX: { isRequired: true, marker: 'xRule' } } }
            ]
        },
        _case_z: { conditions: [{ case: 'never', rules: { flowX: { marker: 'zRule' } } }] }
    };
    if (withBase) { rules.a = { isRequired: true }; }
    return {
        rules: rules,
        fields: { a: 'y', z: '', flowY: '', flowX: '' },
        $fields: { a: mkRadio('x', false), z: mkRadio('', false), flowY: mkRadio('', false), flowX: mkRadio('', false) }
    };
}

/**
 * Recursion arm: `_case_d1`'s condition targets d2 — and `_case_d2` is the
 * LAST key, so `caseName` is 'd2' during every scan and the scan-phase sites
 * all skip `_r == caseName`. d2 is therefore adjudicated ONLY inside d1's
 * direct-case recursion, where `rules` is the condition's own rule set
 * (no `_case_` keys — the arm that makes the union gate load-bearing).
 * d2's unchecked DOM first member is 'k'; `_case_d2`'s case 'k' targets zk.
 */
function recursionShape() {
    return {
        rules: {
            _case_d1: { conditions: [{ case: '', rules: { d2: { isRequired: true } } }] },
            _case_d2: { conditions: [{ case: 'k', rules: { zk: { isRequired: true, marker: 'fromD2K' } } }] }
        },
        fields: { d1: '', d2: '', zk: '' },
        $fields: { d1: mkRadio('', false), d2: mkRadio('k', false), zk: mkRadio('', false) }
    };
}

var feInstr = instrument(feSrc);

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-case-driver-value-preservation §01 — extraction + controls', function () {

    it('01.1 - the slice resolves, is substantial, and compiles', function () {
        assert.ok(feSrc.indexOf(FE_DECL) === 0, 'slice must start at the declaration');
        assert.ok(feSrc.length > 20000, 'slice suspiciously small: ' + feSrc.length);
        assert.ok(/\}$/.test(feSrc), 'slice must end on a closing brace');
        assert.doesNotThrow(function () { compileFE(feSrc); });
    });

    it('01.2 - extraction control: a bogus declaration throws (the slicer CAN fail)', function () {
        assert.throws(function () {
            sliceForEachField(MAIN_SRC.replace(FE_DECL, 'var notForEachField = function() {'));
        }, /declaration not found/);
    });

    it('01.3 - liveness: the harness reaches base-rule adjudication at all', function () {
        var res = driveFE(feInstr, plain());
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(adjudicatedWith(res, 'group', 'isRequired'),
            'if this fails, every corruption assertion below is meaningless');
    });

    it('01.4 - known-negative: an unruled field is never adjudicated', function () {
        var res = driveFE(feInstr, plain());
        assert.ok(res.names.indexOf('note') === -1,
            'the spy must be able to report ABSENCE, not just presence');
    });

    it('01.5 - the two instruments inject uniquely (count-guarded)', function () {
        assert.doesNotThrow(function () { instrument(feSrc); });
        assert.throws(function () { instrument(feSrc + '\n// ' + CASEC_NEEDLE); },
            /not unique/, 'a duplicated needle must refuse, not silently double-inject');
    });
});

// ---------------------------------------------------------------------------
// §02 — premise pins: the defect substrate the fix rests on
// ---------------------------------------------------------------------------
describe('validator-case-driver-value-preservation §02 — premise pins', function () {

    it('02.1 - checkFieldAgainstRules ends applied rules with `delete fields[field]`', function () {
        var fn = MAIN_SRC.substring(
            MAIN_SRC.indexOf('var checkFieldAgainstRules = function(field, rules, fields) {'),
            MAIN_SRC.indexOf(FE_DECL));
        assert.ok(fn.length > 0, 'checkFieldAgainstRules must precede forEachField');
        assert.match(fn, /\n\s*delete fields\[field\];\n/,
            'the restore exists only because of this delete — if it moves, re-derive the fix');
    });

    it('02.2 - the `_case_` scan re-seeds a MISSING allFields entry from the DOM', function () {
        assert.match(feActive, /if \(\s*typeof\(allFields\[caseName\]\) == 'undefined'\s*\)[\s\S]{0,200}allFields\[caseName\] =\s*\$allFields\[caseName\]\.value/,
            'corruption surface 1: the re-seed the restore prevents reaching');
    });

    it('02.3 - the collector binds $fields[name] FIRST-WINS (why the re-seed reads member 1)', function () {
        assert.match(MAIN_SRC, /if \(\s*typeof\(\$fields\[name\]\) == 'undefined'\s*\) \{\s*\n\s*\$fields\[name\] = \$form\[i\];/,
            'a radio group\'s $fields entry is its FIRST member, checked or not');
    });

    it('02.4 - the direct-case block reads `caseValue` from allFields AFTER site 3/3 runs', function () {
        assert.equal(feSrc.split(CASEC_NEEDLE).length - 1, 1,
            'corruption surface 2: the same-iteration read that saw `undefined` pre-fix');
        assert.ok(feSrc.indexOf('// check each field against rule only if rule exists 3/3') < feSrc.indexOf(CASEC_NEEDLE),
            'site 3/3 precedes the direct-case read within the per-field iteration');
    });

    it('02.5 - allRules is a pass-entry CLONE of the rule set (the gate\'s substrate)', function () {
        assert.ok(MAIN_SRC.indexOf("var allRules = ( typeof(rules) !=  'undefined' ) ? JSON.clone(rules) : {};") > -1,
            'the union gate reads allRules because it survives into recursions unchanged');
    });

    it('02.6 - the direct-case recursion forwards allRules while narrowing `rules`', function () {
        assert.match(feSrc, /forEachField\(\$formOrElement, allFields, allRules, fields, \$fields, localRules, cb, i\);/,
            'inside a recursion `rules` is the condition rule set (no `_case_` keys) — hasCase alone is blind there');
    });

    it('02.7 - pin-specificity control: a mutated needle reads absent', function () {
        assert.equal(feSrc.indexOf('caseValue =   allFields[field];'), -1,
            'three-space variant must NOT be found — the pins discriminate at byte level');
    });
});

// ---------------------------------------------------------------------------
// §03 — source pins on the new block (+ sibling-arm stability)
// ---------------------------------------------------------------------------
describe('validator-case-driver-value-preservation §03 — source pins', function () {

    it('03.1 - the backup line precedes the (unchanged) site 3/3 span', function () {
        assert.match(feActive, /baseValueBackup = allFields\[field\];\s*\n\s*if \( typeof\(rules\[field\]\) != 'undefined' \) \{/,
            'the backup must capture the entry BEFORE the adjudication can delete it');
    });

    it('03.2 - the union-gated restore block follows the 3/3 span', function () {
        var m = feActive.match(/if \(\s*\n\s*\( hasCase \|\| typeof\(allRules\['_case_' \+ field\]\) != 'undefined' \)\s*\n\s*&& typeof\(baseValueBackup\) != 'undefined'\s*\n\s*&& typeof\(allFields\[field\]\) == 'undefined'\s*\n\s*\) \{\s*\n\s*allFields\[field\] = baseValueBackup;\s*\n\s*\}/);
        assert.ok(m, 'the restore: driver (live rules OR pass-entry clone) + had a value + call removed it');
    });

    it('03.3 - baseValueBackup is declared in the var block (not an implicit global)', function () {
        assert.match(feSrc, /var baseValueBackup = null; \/\/ #B230/,
            'the shipped source has no "use strict" — an undeclared write would leak');
    });

    it('03.4 - stability: the sibling `caseName == field` arm is byte-untouched', function () {
        var span = feActive.match(/if \( caseName == field \) \{[\s\S]*?\n\s{20}\}/);
        assert.ok(span, 'the arm must exist');
        assert.ok(span[0].indexOf('caseValueBackup = allFields[field];') > -1
            && span[0].indexOf('allFields[field] = caseValueBackup;') > -1
            && span[0].indexOf('baseValueBackup') === -1,
            'this fix adds around site 3/3 only — the tail arm keeps its own backup local');
    });

    it('03.5 - stability: the 3/3 four-line span itself is contiguous and unchanged', function () {
        assert.match(feSrc, /\/\/ check each field against rule only if rule exists 3\/3\s*\n\s*if \( typeof\(rules\[field\]\) != 'undefined' \) \{\s*\n\s*\/\/checkFieldAgainstRules\(field, rules, fields\);\s*\n\s*checkFieldAgainstRules\(field, rules, allFields\);/,
            'the fix inserts BEFORE and AFTER this span, never inside it');
    });
});

// ---------------------------------------------------------------------------
// §04 — behavioural matrix on the REAL extracted bytes
// ---------------------------------------------------------------------------
describe('validator-case-driver-value-preservation §04 — behaviour on real bytes', function () {

    it('04.1 - THE #B230 RED: a non-last driver\'s case value survives its base-rule check', function () {
        var res = driveFE(feInstr, twoCasesBase());
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.equal(res.allFields.a, '',
            'pre-fix the deleted entry re-seeds from the first radio member (\'x\') and lies about the pick');
    });

    it('04.2 - no spurious condition application from the re-seeded value', function () {
        var res = driveFE(feInstr, twoCasesBase());
        assert.ok(!adjudicatedWith(res, 'extra', 'isRequired'),
            'nothing is checked — the \'x\' condition must not apply');
    });

    it('04.3 - the DOM re-seed never fires for the driver', function () {
        var res = driveFE(feInstr, twoCasesBase());
        assert.ok(!res.reseeds.some(function (e) { return e.name === 'a'; }),
            'the restore makes the re-seed unreachable for an adjudicated driver: ' + JSON.stringify(res.reseeds));
    });

    it('04.4 - the driver\'s own direct-case block reads the COLLECTED value (surface 2)', function () {
        var res = driveFE(feInstr, twoCasesBase());
        var aReads = res.caseC.filter(function (e) { return e.field === 'a'; });
        assert.ok(aReads.length > 0 && aReads.every(function (e) { return e.value === ''; }),
            'pre-fix this read `undefined` (deleted just above) — its conditions could never match: '
            + JSON.stringify(aReads));
    });

    it('04.5 - control (liveness for 04.4): the non-last driver\'s direct-case IS entered', function () {
        var res = driveFE(feInstr, twoCasesBase());
        assert.ok(res.caseC.some(function (e) { return e.field === 'a'; }),
            'green pre- AND post-fix — a dead instrument would make 04.4 vacuous');
    });

    it('04.6 - control: the LAST driver keeps its tail-arm restore (adjacent-correct)', function () {
        var res = driveFE(feInstr, twoCasesBase());
        assert.equal(res.allFields.b, '',
            'green pre- AND post-fix — what makes 04.1\'s red meaningful');
    });

    it('04.7 - control: both drivers are base-adjudicated (order independence holds)', function () {
        var res = driveFE(feInstr, twoCasesBase());
        assert.ok(adjudicatedWith(res, 'a', 'isRequired') && adjudicatedWith(res, 'b', 'isRequired'),
            'the fix preserves values — it must not lose the adjudication itself');
    });

    it('04.8 - the union gate covers the direct-case RECURSION path', function () {
        var res = driveFE(feInstr, recursionShape());
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(res.allFields.d2 === '' && !adjudicatedWith(res, 'zk', 'isRequired'),
            'a driver adjudicated INSIDE a recursion sees rules==condition-rules (no `_case_` keys): '
            + 'hasCase alone left d2 re-seeding to \'k\' and spuriously requiring zk — '
            + 'd2=' + JSON.stringify(res.allFields.d2));
    });

    it('04.9 - control (liveness for 04.8): d2 is adjudicated via the recursion at all', function () {
        var res = driveFE(feInstr, recursionShape());
        assert.ok(adjudicatedWith(res, 'd2', 'isRequired'),
            'green pre- AND post-fix — the recursion arm must actually reach site 3/3');
    });

    it('04.10 - picked-flow fidelity: the unpicked flow\'s rules never apply', function () {
        var res = driveFE(feInstr, pickedNonFirst(true));
        assert.ok(!adjudicatedWith(res, 'flowX', 'isRequired'),
            'the user picked \'y\' — pre-fix the re-seeded first member \'x\' applied the wrong flow');
    });

    it('04.11 - control: the picked flow\'s rules DO apply in the same drive', function () {
        var res = driveFE(feInstr, pickedNonFirst(true));
        assert.ok(adjudicatedWith(res, 'flowY', 'isRequired'),
            'green pre- AND post-fix — the fix must not lose the correct condition');
    });

    it('04.12 - a base-ruled driver\'s conditions now behave like a no-base-rules driver\'s', function () {
        function targeted(res) {
            return res.applied.filter(function (c) { return c.name === 'flowY' || c.name === 'flowX'; });
        }
        var withBase = driveFE(feInstr, pickedNonFirst(true));
        var reference = driveFE(feInstr, pickedNonFirst(false));
        assert.deepEqual(targeted(withBase), targeted(reference),
            'base rules on the driver must not change WHICH conditions its value matches');
    });

    it('04.13 - byte-identity control: a form with no `_case_` is unchanged', function () {
        var res = driveFE(feInstr, plain());
        assert.equal(res.thrown, null);
        assert.deepEqual(res.names, ['group'],
            'the restore is driver-gated — non-driver adjudication is untouched');
    });
});

// ---------------------------------------------------------------------------
// §05 — naive-variant SUBTRACT: the restore is load-bearing
// ---------------------------------------------------------------------------
describe('validator-case-driver-value-preservation §05 — naive-variant SUBTRACT', function () {

    /** Strips THIS fix's backup + restore, leaving the bare 3/3 call. */
    function naiveVariant() {
        var out = feSrc
            .replace(/baseValueBackup = allFields\[field\];\n/, '')
            .replace(/[ \t]*\/\/ #B230[^\n]*\n\s*if \(\s*\n\s*\( hasCase \|\| typeof\(allRules\['_case_' \+ field\]\) != 'undefined' \)\s*\n\s*&& typeof\(baseValueBackup\) != 'undefined'\s*\n\s*&& typeof\(allFields\[field\]\) == 'undefined'\s*\n\s*\) \{\s*\n\s*allFields\[field\] = baseValueBackup;\s*\n\s*\}\n/, '');
        if (out === feSrc) { throw new Error('naive-variant transform did not apply — the fix shape changed'); }
        if (out.indexOf('allFields[field] = baseValueBackup;') > -1) {
            throw new Error('naive-variant transform left the restore in place');
        }
        if (out.indexOf('allFields[field] = caseValueBackup;') === -1) {
            throw new Error('naive-variant transform must NOT touch the sibling tail-arm restore');
        }
        return out;
    }

    it('05.1 - the transform applies and still compiles (control)', function () {
        assert.doesNotThrow(function () { compileFE(naiveVariant()); });
    });

    it('05.2 - WITHOUT the restore the driver\'s case value corrupts to member 1', function () {
        var res = driveFE(instrument(naiveVariant()), twoCasesBase());
        assert.equal(res.allFields.a, 'x',
            'subtract control: if this ever reads "" the restore has stopped being load-bearing');
    });

    it('05.3 - and the corruption spuriously applies the wrong condition', function () {
        var res = driveFE(instrument(naiveVariant()), twoCasesBase());
        assert.ok(adjudicatedWith(res, 'extra', 'isRequired'),
            'nothing is checked, yet the first-member condition applies — the defect §04.2 prevents');
    });

    it('05.4 - the shipped bytes do NOT exhibit 05.2 (the pair is the subtract)', function () {
        var res = driveFE(feInstr, twoCasesBase());
        assert.equal(res.allFields.a, '',
            'same fixture, shipped bytes: the value survives');
    });
});

// ---------------------------------------------------------------------------
// §06 — dist fidelity (red until the prod rebuild lands the block)
// ---------------------------------------------------------------------------
describe('validator-case-driver-value-preservation §06 — dist fidelity', function () {

    it('06.1 - gina.js carries the backup, the union gate, and the restore', function () {
        var raw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
        assert.ok(raw.indexOf('baseValueBackup = allFields[field];') > -1,
            'the un-minified bundle is the Closure INPUT — a miss here means the rebuild never ran');
        assert.ok(raw.indexOf("( hasCase || typeof(allRules['_case_' + field]) != 'undefined' )") > -1,
            'the union gate must ride into dist verbatim');
        assert.ok(raw.indexOf('allFields[field] = baseValueBackup;') > -1,
            'the restore must ride into dist with the call');
    });

    it('06.2 - gina.min.js carries the minified union-gated restore', function () {
        var min = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // The '_case_'+ concat ALONE cannot discriminate: `hasCase`'s own
        // assignment minifies to the same read (caught by this file's own
        // red-first run — the bare pattern was already 1 on PRE-fix bytes).
        // Closure DE-MORGANs the three-conjunct guard into a negated `||`
        // chain and coalesces the backup local. Measured emission:
        //   !L&&typeof gb['_case_'+Ma]=='undefined'||typeof w=='undefined'
        //     ||typeof Ya[Ma]!='undefined'||(Ya[Ma]=w)
        // The pin is IDENTIFIER-AGNOSTIC and backreferenced (same key local,
        // same allFields object, same backup local through the chain), so an
        // adjacent-run rename cannot false-red it while a shape change will.
        // VALIDATED against the real artifacts: 0 on the pre-fix gina.min.js
        // (git HEAD before the rebuild), 1 on the rebuilt one.
        var m = min.match(/!([A-Za-z_$][\w$]*)&&typeof ([A-Za-z_$][\w$]*)\['_case_'\+([A-Za-z_$][\w$]*)\]=='undefined'\|\|typeof ([A-Za-z_$][\w$]*)=='undefined'\|\|typeof ([A-Za-z_$][\w$]*)\[\3\]!='undefined'\|\|\(\5\[\3\]=\4\)/g) || [];
        assert.equal(m.length, 1,
            'the served artifact must carry the union-gated restore — gina.min.js is what browsers run');
    });
});
