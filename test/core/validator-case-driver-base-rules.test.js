'use strict';
/**
 * FormValidator — a `_case_` DRIVER still owns its BASE rules (#B229)
 *
 * `forEachField`'s per-field tail used to read:
 *
 *     if (isInCase || caseName == field) continue;
 *
 * `caseName` is assigned inside the `_case_` scan loop that runs, in full, on
 * EVERY field iteration — so at the tail it always holds the LAST scanned
 * `_case_` key's driver name, whichever field is being validated. When the
 * iterated field IS that driver, the `continue` skipped the rest of the
 * iteration wholesale: both the base-rule check (site 3/3) and the direct-case
 * block. A rule shape
 *
 *     { "group": { "isRequired": true }, "_case_group": { "conditions": [...] } }
 *
 * therefore never adjudicated `group`'s own `isRequired` — not on the bind
 * pass, not on the live-check global pass, not on the submit pass. The form
 * never gated and an empty submit went out with zero client-side validation:
 * the #B221 silent-submit class resurfacing for the self-driving shape,
 * structurally downstream of #B221's collection fix (the group IS collected as
 * `''`; only the adjudication was missing).
 *
 * The fix splits the tail. `isInCase` keeps its own `continue` (it is dead
 * code — never assigned truthy — and is preserved as-is, pinned in §02). The
 * `caseName == field` arm now runs the base-rule check before continuing, and
 * restores the driver's `allFields` entry around the call:
 * `checkFieldAgainstRules` ends every applied rule with `delete fields[field]`
 * on the object it is handed, and `allFields[caseName]` is the case VALUE the
 * scan block re-reads on every later field iteration — a deleted entry
 * re-seeds from `$allFields[name].value`, which for a radio group is the FIRST
 * member's value regardless of `.checked` (filed separately as #B230, a
 * pre-existing defect this fix deliberately does NOT widen).
 *
 * The direct-case block stays skipped for the driver, so WHICH conditions
 * apply is unchanged — measured: site C is never entered for a self-driving
 * case, pre-fix or post-fix (§04.8).
 *
 * Order independence (§04.4/§04.5): a driver that is NOT the last-declared
 * `_case_` key was already adjudicated by site 3/3 (the tail's comparison did
 * not match it); the last one was not. Post-fix the union is "every driver
 * carrying base rules is adjudicated", regardless of declaration order.
 *
 * Scope, stated honestly: this is a CLIENT-side fix. The server form-body path
 * (`isGFFCtx === false`) never reaches this tail for a `_case_`-bearing rule
 * set — it throws earlier on `$allFields[caseName]` with `$fields === null`, a
 * known limitation already documented by test/lib/validator-server-auto.test.js.
 *
 * Test layering (project convention):
 *   §01 extraction + instrument controls (anchored slice — a brace walk is
 *       invalid here, forEachField carries a block-commented code region —
 *       plus liveness and known-negative controls that CAN fail);
 *   §02 premise pins for every source fact the fix rests on;
 *   §03 source pins on the new arm (whole-span, terminator-anchored) and a
 *       comment-stripped negative on the old combined tail;
 *   §04 behavioural matrix driving the REAL extracted `forEachField` bytes;
 *   §05 naive-variant SUBTRACT — proves the caseValue restore is load-bearing;
 *   §06 dist-fidelity pins (red until the prod rebuild lands the arm).
 *
 * Run: node --test test/core/validator-case-driver-base-rules.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require(path.join(__dirname, '..', 'fw'));

var MAIN_PATH = path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var MAIN_SRC = fs.readFileSync(MAIN_PATH, 'utf8');
var DIST_RAW_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.js');
var DIST_MIN_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');

// ---------------------------------------------------------------------------
// Extraction — the SHIPPED forEachField bytes, executed (no replica).
//
// A brace walk cannot be used: forEachField contains a `/** ... */` region
// holding commented-out code whose braces do not balance under a naive scan
// (the same reason validator-case-coercion.test.js uses an anchored slice).
// The close is the last `}` before validate()'s own addListener block, which
// is the first statement following the definition.
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

var feSrc = sliceForEachField(MAIN_SRC);

/** Comment-stripped view — negative pins must not match a `// was:` record. */
function activeLines(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

var feActive = activeLines(feSrc);

// Free identifiers the extraction closes over, then the drive-time arguments.
var FE_PARAMS = [
    'isGFFCtx', '$allFields', 'checkFieldAgainstRules', 'merge',
    'subLevelRules', 'fieldErrorsAttributes', 'd', 'formatData', 'envIsDev',
    'gina', 'window', 'triggerEvent', 'addListener', 'removeListener',
    'instance', 'evt', 'hasParsedAllRules', 'hasBeenValidated', 'asyncCount',
    'data', 'id', 're', 'flags', 'caseField', '__siteC',
    '__allFields', '__allRules', '__fields', '__$fields', '__rules'
];

function compileFE(src) {
    return new Function(FE_PARAMS.join(','),
        src + '\nreturn forEachField(null, __allFields, __allRules, __fields, __$fields, __rules, undefined, 0);');
}

/** Instruments site C (the direct-case `hasCase` block) entry. */
function instrumentSiteC(src) {
    var needle = 'if (hasCase) {\n                        ++i; // add sub level';
    if (src.split(needle).length !== 2) { throw new Error('site C needle not unique'); }
    return src.replace(needle, 'if (hasCase) { __siteC(field);\n                        ++i; // add sub level');
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

function shallowMerge(a, b) {
    var o = {}, k;
    for (k in b) { o[k] = b[k]; }
    for (k in a) { o[k] = a[k]; }
    return o;
}

/**
 * Drives the extracted bytes in FULL-FORM shape and records every
 * `checkFieldAgainstRules` call — the APPLY DECISION is the assert surface
 * (the engine's own rule execution is pinned by validator-engine-rules /
 * validator-radio-required-collection §04).
 *
 * The recording spy mirrors the real function's terminal `delete fields[field]`
 * so the allFields mutation trail is faithful.
 */
function driveFE(src, opts) {
    var applied = [], siteC = [];
    var spy = function (name, rulesArg, fieldsArg) {
        applied.push({ name: name, rule: JSON.parse(JSON.stringify(rulesArg[name] || {})) });
        if (typeof (rulesArg[name]) != 'undefined') { delete fieldsArg[name]; }
    };
    var allFields = JSON.parse(JSON.stringify(opts.fields));
    var d = {
        addField: function () {},
        getErrors: function () { return {}; },
        toData: function () { return {}; },
        isValid: function () { return true; }
    };
    var thrown = null;
    try {
        compileFE(src)(
            true,                                  // isGFFCtx
            opts.$fields, spy, shallowMerge,
            0,                                     // subLevelRules
            {},                                    // fieldErrorsAttributes
            d,
            function (x) { return x; },            // formatData
            false,                                 // envIsDev
            {}, {},                                // gina, window
            function () {}, function () {}, function () {}, // triggerEvent, addListener, removeListener
            {},                                    // instance
            'validated.x',                         // evt
            false, false, 0,                       // hasParsedAllRules, hasBeenValidated, asyncCount
            null, 'x',                             // data, id
            null, null, null,                      // re, flags, caseField (undeclared writes contained)
            function (f) { siteC.push(f); },       // __siteC
            allFields,
            JSON.parse(JSON.stringify(opts.rules)),
            JSON.parse(JSON.stringify(opts.fields)),
            opts.$fields,
            JSON.parse(JSON.stringify(opts.rules))
        );
    } catch (err) {
        thrown = err;
    }
    return {
        applied: applied,
        names: applied.map(function (c) { return c.name; }),
        siteC: siteC,
        allFields: allFields,
        thrown: thrown
    };
}

function adjudicatedWith(res, field, ruleKey) {
    return res.applied.some(function (c) {
        return c.name === field && typeof (c.rule[ruleKey]) != 'undefined';
    });
}

// --------------------------- fixtures --------------------------------------

/** The reported shape: the group DRIVES its own case AND carries base rules. */
function selfDriving() {
    return {
        rules: {
            'group': { isRequired: true },
            '_case_group': { conditions: [{ case: 'flowA', rules: { 'note': { isRequired: true, marker: 'fromCase' } } }] },
            'note': {}
        },
        fields: { group: '', note: '' },
        $fields: { group: mkRadio('flowA', false), note: mkRadio('', false) }
    };
}

/** Healthy control — a plain base rule with no `_case_` anywhere. */
function plain() {
    return {
        rules: { 'group': { isRequired: true } },
        fields: { group: '' },
        $fields: { group: mkRadio('flowA', false) }
    };
}

/** The driver carries base rules and its case targets a DIFFERENT field. */
function separateDriver() {
    return {
        rules: {
            'driver': { isRequired: true },
            'group': { isRequired: true },
            '_case_driver': { conditions: [{ case: 'flowA', rules: { 'note': { isRequired: true } } }] },
            'note': {}
        },
        fields: { driver: '', group: '', note: '' },
        $fields: { driver: mkRadio('flowA', false), group: mkRadio('x', false), note: mkRadio('', false) }
    };
}

/** Two cases — `_case_b` is declared last, so `caseName` settles on 'b'. */
function twoCases() {
    return {
        rules: {
            'a': { isRequired: true },
            'b': { isRequired: true },
            '_case_a': { conditions: [{ case: 'never-a', rules: { 'note': { isRequired: true } } }] },
            '_case_b': { conditions: [{ case: 'never-b', rules: { 'note': { isRequired: true } } }] },
            'note': {}
        },
        fields: { a: '', b: '', note: '' },
        $fields: { a: mkRadio('never-a', false), b: mkRadio('never-b', false), note: mkRadio('', false) }
    };
}

/** A driver with NO base rules — nothing to adjudicate, either way. */
function driverWithoutBaseRules() {
    return {
        rules: {
            '_case_group': { conditions: [{ case: 'flowA', rules: { 'note': { isRequired: true } } }] },
            'note': {}
        },
        fields: { group: '', note: '' },
        $fields: { group: mkRadio('flowA', false), note: mkRadio('', false) }
    };
}

// ---------------------------------------------------------------------------
// §01 — extraction + instrument controls
// ---------------------------------------------------------------------------

describe('validator-case-driver-base-rules §01 — extraction + instrument controls', function () {

    it('01.1 - the anchored slice resolves, is unique and compiles', function () {
        assert.ok(feSrc.length > 20000, 'slice looks truncated: ' + feSrc.length);
        assert.equal(feSrc.indexOf(FE_DECL), 0, 'slice must start at the declaration');
        assert.ok(/\}\s*$/.test(feSrc), 'slice must end on a closing brace');
        assert.doesNotThrow(function () { compileFE(feSrc); }, 'extracted bytes must compile');
    });

    it('01.2 - extraction control: a bogus declaration throws (the slicer CAN fail)', function () {
        assert.throws(function () {
            sliceForEachField(MAIN_SRC.replace(FE_DECL, 'var notForEachField = function() {'));
        }, /declaration not found/);
    });

    it('01.3 - harness liveness: a plain no-case form adjudicates its field', function () {
        var res = driveFE(feSrc, plain());
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(adjudicatedWith(res, 'group', 'isRequired'),
            'the harness must reach the base-rule check at all — otherwise every §04 red is meaningless');
    });

    it('01.4 - known-negative control: a field with no rule is never adjudicated', function () {
        var f = plain();
        f.fields.spare = '';
        f.$fields.spare = mkRadio('s', false);
        var res = driveFE(feSrc, f);
        assert.ok(res.names.indexOf('spare') === -1,
            'the spy must be able to report ABSENCE, not just presence');
    });

    it('01.5 - site C instrument compiles and its needle is unique', function () {
        var instrumented = instrumentSiteC(feSrc);
        assert.notEqual(instrumented, feSrc, 'site C instrumentation must apply');
        assert.doesNotThrow(function () { compileFE(instrumented); });
    });
});

// ---------------------------------------------------------------------------
// §02 — premise pins: every source fact the fix rests on
// ---------------------------------------------------------------------------

describe('validator-case-driver-base-rules §02 — premise pins', function () {

    it('02.1 - `isInCase` is never assigned truthy (the tail\'s first half is dead)', function () {
        var assigns = feActive.match(/isInCase\s*=\s*[^;]+/g) || [];
        assert.ok(assigns.length > 0, 'control: `isInCase` must have assignments at all');
        assigns.forEach(function (a) {
            assert.ok(/=\s*(null|false)\s*$/.test(a.trim()),
                'unexpected truthy write to isInCase — the fix preserves `if (isInCase) continue;` ' +
                'precisely because it is inert today: ' + a);
        });
    });

    it('02.2 - control for 02.1: `hasCase` DOES take a conditional write', function () {
        assert.match(feActive, /hasCase\s*=\s*\(\s*typeof\(rules\['_case_'\s*\+\s*field\]\)/,
            'if this stops matching, 02.1\'s regex shape is no longer discriminating');
    });

    it('02.3 - `checkFieldAgainstRules` deletes the field from the object it is handed', function () {
        var cfar = MAIN_SRC.indexOf('var checkFieldAgainstRules = function(field, rules, fields) {');
        assert.ok(cfar > -1, 'checkFieldAgainstRules declaration must exist');
        var tail = MAIN_SRC.substring(cfar, MAIN_SRC.indexOf('var d = null;//FormValidator instance', cfar));
        assert.match(tail, /delete fields\[field\];/,
            'the restore in the new arm exists only because of this delete');
    });

    it('02.4 - the base-rule site 3/3 hands `allFields` (not `fields`) to the check', function () {
        // Pinned against the RAW slice: the anchor is a comment, so a
        // comment-stripped view cannot carry it.
        assert.match(feSrc, /\/\/ check each field against rule only if rule exists 3\/3\s*\n\s*if \( typeof\(rules\[field\]\) != 'undefined' \) \{\s*\n\s*\/\/checkFieldAgainstRules\(field, rules, fields\);\s*\n\s*checkFieldAgainstRules\(field, rules, allFields\);/,
            'the new arm mirrors this call verbatim; a change here must be mirrored there');
    });

    it('02.5 - the `_case_` scan re-seeds a MISSING allFields entry from the DOM', function () {
        assert.match(feActive, /if \(\s*typeof\(allFields\[caseName\]\) == 'undefined'\s*\)[\s\S]{0,200}allFields\[caseName\] =\s*\$allFields\[caseName\]\.value/,
            'this re-seed is exactly what the restore prevents reaching (#B230)');
    });

    it('02.6 - the collector binds $fields[name] FIRST-WINS (why the re-seed reads member 1)', function () {
        assert.match(MAIN_SRC, /if \(\s*typeof\(\$fields\[name\]\) == 'undefined'\s*\) \{\s*\n\s*\$fields\[name\] = \$form\[i\];/,
            'a radio group\'s $fields entry is its FIRST member, checked or not');
    });
});

// ---------------------------------------------------------------------------
// §03 — source pins on the new arm
// ---------------------------------------------------------------------------

describe('validator-case-driver-base-rules §03 — source pins', function () {

    it('03.1 - `isInCase` keeps its own, separate `continue`', function () {
        assert.match(feActive, /\n\s*if \(isInCase\) continue;\n/,
            'the dead-but-preserved half must stand alone after the split');
    });

    it('03.2 - the `caseName == field` arm carries backup -> check -> restore -> continue', function () {
        var span = feActive.match(/if \( caseName == field \) \{[\s\S]*?\n\s{20}\}/);
        assert.ok(span, 'the new arm must exist as a `caseName == field` block');
        var body = span[0];
        assert.match(body, /if \( typeof\(rules\[field\]\) != 'undefined' \) \{/, 'guarded on a declared base rule');
        assert.match(body, /caseValueBackup = allFields\[field\];/, 'captures the case value before the call');
        assert.match(body, /checkFieldAgainstRules\(field, rules, allFields\);/, 'adjudicates against allFields, like site 3/3');
        assert.match(body, /typeof\(allFields\[field\]\) == 'undefined'\s*\n\s*&& typeof\(caseValueBackup\) != 'undefined'/, 'restores only a value the call actually removed');
        assert.match(body, /allFields\[field\] = caseValueBackup;/, 'restores the case value');
        assert.match(body, /\n\s*continue;\n/, 'the direct-case block stays skipped for the driver');
    });

    it('03.3 - the old combined tail is gone from ACTIVE source', function () {
        assert.equal(feActive.indexOf('if (isInCase || caseName == field) continue;'), -1,
            'the combined tail must no longer execute');
    });

    it('03.4 - control for 03.3: it survives as a `// was:` record (house convention)', function () {
        assert.ok(feSrc.indexOf('// if (isInCase || caseName == field) continue;') > -1,
            'the replaced line is commented, not silently deleted — this also proves 03.3 reads a ' +
            'comment-STRIPPED view rather than an empty one');
    });

    it('03.5 - `caseValueBackup` is declared in forEachField\'s var block', function () {
        var head = feSrc.substring(0, feSrc.indexOf('if ( typeof(rules) != \'undefined\' ) {'));
        assert.match(head, /var caseValueBackup\s*=\s*null;/,
            'declared with its siblings, not leaked as an implicit global');
    });

    it('03.6 - the fix does not duplicate case-coercion\'s count-guarded literal', function () {
        assert.equal(feSrc.split('if (caseValue == "true")').length - 1, 1,
            'validator-case-coercion.test.js refuses on a second copy of this literal');
    });
});

// ---------------------------------------------------------------------------
// §04 — behavioural matrix on the REAL extracted bytes
// ---------------------------------------------------------------------------

describe('validator-case-driver-base-rules §04 — behaviour on real bytes', function () {

    it('04.1 - a self-driving `_case_` group HAS its base isRequired adjudicated', function () {
        var res = driveFE(feSrc, selfDriving());
        assert.equal(res.thrown, null, 'drive threw: ' + (res.thrown && res.thrown.message));
        assert.ok(adjudicatedWith(res, 'group', 'isRequired'),
            'THE #B229 RED: `group` drives `_case_group` and declares isRequired, so it must be adjudicated');
    });

    it('04.2 - the healthy no-case control is unchanged', function () {
        var res = driveFE(feSrc, plain());
        assert.deepEqual(res.names, ['group'], 'a form with no `_case_` must be byte-identical in behaviour');
    });

    it('04.3 - a driver whose case targets ANOTHER field still owns its base rules', function () {
        var res = driveFE(feSrc, separateDriver());
        assert.ok(adjudicatedWith(res, 'driver', 'isRequired'), 'the driver is skipped by the same tail');
        assert.ok(adjudicatedWith(res, 'group', 'isRequired'), 'the non-driver field must stay adjudicated');
    });

    it('04.4 - control: a NON-last driver was already adjudicated (pre- and post-fix)', function () {
        var res = driveFE(feSrc, twoCases());
        assert.ok(adjudicatedWith(res, 'a', 'isRequired'),
            '`caseName` settles on the LAST case key, so `a` never matched the tail — this arm must be ' +
            'green on pre-fix bytes too, which is what makes 04.5 a meaningful red');
    });

    it('04.5 - order independence: the LAST-declared driver is adjudicated too', function () {
        var res = driveFE(feSrc, twoCases());
        assert.ok(adjudicatedWith(res, 'b', 'isRequired'),
            'post-fix the union is "every driver carrying base rules", regardless of declaration order');
    });

    it('04.6 - a driver with NO base rules is still never adjudicated', function () {
        var res = driveFE(feSrc, driverWithoutBaseRules());
        assert.ok(res.names.indexOf('group') === -1,
            'the new arm is guarded on a declared rule — no rule, no call');
    });

    it('04.7 - the driver\'s allFields entry SURVIVES the added adjudication', function () {
        var res = driveFE(feSrc, selfDriving());
        assert.equal(res.allFields.group, '',
            'the case VALUE must stay as collected — a deleted entry re-seeds from the first radio ' +
            'member\'s value and spuriously matches a condition (#B230)');
    });

    it('04.8 - site C reachability is UNCHANGED: never entered for a self-driving case', function () {
        var res = driveFE(instrumentSiteC(feSrc), selfDriving());
        assert.deepEqual(res.siteC, [],
            'the driver still `continue`s before the direct-case block, so which conditions apply ' +
            'is untouched by this fix');
    });

    it('04.9 - no-regression: the case-targeted field is adjudicated exactly once', function () {
        var res = driveFE(feSrc, selfDriving());
        var noteCalls = res.names.filter(function (n) { return n === 'note'; });
        assert.equal(noteCalls.length, 1,
            'a second `note` call would mean the direct-case block re-applied what site A already did');
    });

    it('04.10 - the case rules still reach the targeted field (site A untouched)', function () {
        var f = selfDriving();
        f.fields.group = 'flowA';
        f.$fields.group = mkRadio('flowA', true);
        var res = driveFE(feSrc, f);
        assert.ok(adjudicatedWith(res, 'note', 'marker'),
            'a matching case must still inject its rules — the fix adds an adjudication, it removes none');
    });
});

// ---------------------------------------------------------------------------
// §05 — naive-variant SUBTRACT: the restore is load-bearing
// ---------------------------------------------------------------------------

describe('validator-case-driver-base-rules §05 — naive-variant SUBTRACT', function () {

    /** Strips the backup/restore, leaving a bare adjudicate-then-continue. */
    function naiveVariant() {
        var out = feSrc
            .replace('caseValueBackup = allFields[field];\n', '')
            .replace(/if \(\s*\n\s*typeof\(allFields\[field\]\) == 'undefined'\s*\n\s*&& typeof\(caseValueBackup\) != 'undefined'\s*\n\s*\) \{\s*\n\s*allFields\[field\] = caseValueBackup;\s*\n\s*\}\n/, '');
        if (out === feSrc) { throw new Error('naive-variant transform did not apply — the fix shape changed'); }
        if (out.indexOf('allFields[field] = caseValueBackup;') > -1) {
            throw new Error('naive-variant transform left the restore in place');
        }
        return out;
    }

    it('05.1 - the transform applies and still compiles (control)', function () {
        assert.doesNotThrow(function () { compileFE(naiveVariant()); });
    });

    it('05.2 - WITHOUT the restore the driver\'s case value is corrupted to member 1', function () {
        var res = driveFE(naiveVariant(), separateDriver());
        assert.equal(res.allFields.driver, 'flowA',
            'subtract control: with the restore removed, the deleted entry re-seeds from the DOM — ' +
            'if this ever reads "" the restore has stopped being load-bearing and §04.7 is vacuous');
    });

    it('05.3 - and the corruption spuriously matches a condition', function () {
        var res = driveFE(naiveVariant(), separateDriver());
        assert.ok(adjudicatedWith(res, 'note', 'isRequired'),
            'nothing is checked, yet the flowA condition applies — the defect §04.7 prevents');
    });

    it('05.4 - the shipped bytes do NOT exhibit 05.2 (the pair is the subtract)', function () {
        var res = driveFE(feSrc, separateDriver());
        assert.equal(res.allFields.driver, '',
            'same fixture, shipped bytes: the value survives');
    });
});

// ---------------------------------------------------------------------------
// §06 — dist fidelity (red until the prod rebuild lands the arm)
// ---------------------------------------------------------------------------

describe('validator-case-driver-base-rules §06 — dist fidelity', function () {

    it('06.1 - gina.js carries the new arm', function () {
        var raw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
        assert.ok(raw.indexOf('caseValueBackup = allFields[field];') > -1,
            'the un-minified bundle is the Closure INPUT — a miss here means the rebuild never ran');
        assert.ok(raw.indexOf('allFields[field] = caseValueBackup;') > -1,
            'the restore must ride into dist with the call');
    });

    it('06.2 - gina.js no longer carries the old combined tail (active source)', function () {
        var raw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
        assert.equal(activeLines(raw).indexOf('if (isInCase || caseName == field) continue;'), -1,
            'the replaced tail must not survive in executable dist bytes');
    });

    it('06.3 - gina.min.js carries the minified restore guard', function () {
        var min = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // Closure renames every local but preserves the property reads and the
        // typeof string literals. Both pins below are IDENTIFIER-AGNOSTIC and
        // backreferenced (same object/key pair, same backup local), so a rename
        // in an adjacent Closure run cannot false-red them while an actual
        // shape change will. Measured emission:
        //   typeof Ya[Pa]=='undefined'&&typeof w!='undefined'&&(Ya[Pa]=w)
        // VALIDATED against the real artifacts: 0 on the pre-fix gina.min.js
        // (git HEAD before the rebuild), 1 on the rebuilt one.
        var restore = min.match(/typeof ([A-Za-z_$][\w$]*)\[([A-Za-z_$][\w$]*)\]=='undefined'&&typeof ([A-Za-z_$][\w$]*)!='undefined'&&\(\1\[\2\]=\3\)/g) || [];
        assert.equal(restore.length, 1,
            'the shipped, served artifact must carry the caseValue restore — gina.min.js is what browsers run');
    });

    it('06.4 - gina.min.js carries the minified `caseName == field` arm', function () {
        var min = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // Measured emission (Closure folds the `continue` into if/else and
        // coalesces the backup local with `caseValue`):
        //   if(eb==Pa)typeof Ra[Pa]!='undefined'&&(w=Ya[Pa],Ha(Pa,Ra,Ya)…
        // VALIDATED 0-pre / 1-post against the real artifacts.
        var arm = min.match(/if\(([A-Za-z_$][\w$]*)==([A-Za-z_$][\w$]*)\)typeof ([A-Za-z_$][\w$]*)\[\2\]!='undefined'&&\(([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\[\2\],([A-Za-z_$][\w$]*)\(\2,\3,\5\)/g) || [];
        assert.equal(arm.length, 1,
            'the driver arm must reach the served bundle — backup, then the base-rule check against allFields');
    });
});
