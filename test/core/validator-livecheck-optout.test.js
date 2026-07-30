'use strict';
/**
 * #B176 — the live-check opt-out is honored, and updateSubmitTriggerState's
 * `$formInstance` is a declared local.
 *
 * Pre-fix, both live-check consumer gates read
 *   /^(true)$/i.test($form.target.dataset.ginaFormLiveCheckEnabled && $form.rules.count() > 0)
 * — the `&&` INSIDE test(). An explicit opt-out `"false"` is a truthy string,
 * so the expression short-circuited to the rules-count BOOLEAN, `test()`
 * stringified it to "true", and the gate passed: a form declaring
 * `data-gina-form-live-check-enabled="false"` with resolvable rules still got
 * live-check. (The bind-time normalization guarantees the dataset value is
 * only ever the string "true" or "false" — the broken gate therefore fired on
 * exactly the normalized opt-out.) The fix hoists the count check out:
 *   test(dataset) && count > 0
 * — the shape the file already used correctly elsewhere.
 *
 * Also: `$formInstance = null;` in updateSubmitTriggerState was an undeclared
 * assignment (an implicit global under sloppy mode) — now `var`-declared.
 *
 * §01 — source pins (negatives on comment-stripped source — the pre-fix
 *       expressions are kept as `// was:` comments).
 * §02 — behavioural: the REAL extracted gate conditions, executed for the
 *       full truth table, plus the pre-fix expression as the subtract control.
 */

var assert = require('node:assert');
var { describe, it } = require('node:test');
var fs   = require('fs');
var path = require('path');

var fwPath  = require('../fw');
var mainPath = path.join(fwPath, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var mainSrc  = fs.readFileSync(mainPath).toString();

/**
 * Strip `//` line comments so negative pins ignore the `// was:` records.
 * @param {string} src
 * @returns {string}
 * @inner
 */
function stripLineComments(src) {
    return src.split('\n').map(function (l) {
        var i = l.indexOf('//');
        return i === -1 ? l : l.slice(0, i);
    }).join('\n');
}
var codeSrc = stripLineComments(mainSrc);

var FIXED_GATE  = '/^(true)$/i.test($form.target.dataset.ginaFormLiveCheckEnabled) && $form.rules.count() > 0';
var BROKEN_GATE = '/^(true)$/i.test($form.target.dataset.ginaFormLiveCheckEnabled && $form.rules.count() > 0)';

/**
 * Execute a gate condition against a fixture form.
 * @param {string} cond - the gate expression
 * @param {string|undefined} liveCheck - dataset value
 * @param {number} ruleCount
 * @returns {boolean}
 * @inner
 */
function runGate(cond, liveCheck, ruleCount) {
    /* eslint-disable no-new-func */
    var fn = new Function('$form', 'return !!( ' + cond + ' );');
    return fn({
        target: { dataset: { ginaFormLiveCheckEnabled: liveCheck } },
        rules:  { count: function () { return ruleCount; } }
    });
}

describe('01 - #B176 source pins', function () {

    it('01.1 - both consumer gates carry the hoisted count check', function () {
        var first = codeSrc.indexOf(FIXED_GATE);
        assert.notStrictEqual(first, -1, 'first fixed gate missing');
        assert.notStrictEqual(codeSrc.indexOf(FIXED_GATE, first + 1), -1,
            'second fixed gate missing (two consumer sites)');
    });

    it('01.2 - the inside-test() form is gone as code', function () {
        assert.strictEqual(codeSrc.indexOf(BROKEN_GATE), -1,
            'the broken &&-inside-test() gate survives as code');
    });

    it('01.3 - $formInstance is a declared local in updateSubmitTriggerState', function () {
        var fn = codeSrc.slice(codeSrc.indexOf('var updateSubmitTriggerState = function'));
        fn = fn.slice(0, 400);
        assert.match(fn, /var \$formInstance = null;/,
            '$formInstance must be var-declared');
        assert.doesNotMatch(fn, /^\s+\$formInstance = null;/m,
            'the undeclared assignment survives');
    });

    it('01.z - control: the pins CAN miss (the broken shape fails them)', function () {
        assert.strictEqual(BROKEN_GATE.indexOf(FIXED_GATE), -1);
        assert.notStrictEqual(('x\n' + BROKEN_GATE).indexOf(BROKEN_GATE), -1);
    });
});

describe('02 - #B176 behavioural: the REAL gate condition, executed', function () {

    // Both fixed sites carry the identical expression — execute it once,
    // sourced from the file rather than retyped.
    var start = codeSrc.indexOf(FIXED_GATE);
    var cond  = codeSrc.slice(start, start + FIXED_GATE.length);

    it("02.1 - explicit opt-out: 'false' + rules -> NO live-check (the fix)", function () {
        assert.strictEqual(runGate(cond, 'false', 3), false);
    });

    it("02.2 - 'true' + rules -> live-check", function () {
        assert.strictEqual(runGate(cond, 'true', 3), true);
    });

    it("02.3 - 'true' + zero rules -> no live-check", function () {
        assert.strictEqual(runGate(cond, 'true', 0), false);
    });

    it("02.4 - 'false' + zero rules -> no live-check", function () {
        assert.strictEqual(runGate(cond, 'false', 0), false);
    });

    it('02.5 - absent attribute -> no live-check at the consumer gate', function () {
        // (In practice bind-time normalization stamps "true" first; the raw
        // gate must still be safe for an un-normalized call order.)
        assert.strictEqual(runGate(cond, undefined, 3), false);
    });

    it("02.z - subtract control: the PRE-FIX expression enables live-check on 'false' + rules", function () {
        // The defect row — 'false' && (3>0) -> boolean true -> test("true") matches:
        assert.strictEqual(runGate(BROKEN_GATE, 'false', 3), true,
            'control: the broken gate must reproduce the defect');
        // Every other row agreed with the fixed gate — the fix flips ONLY the
        // opt-out row: 'true'&&true -> "true" (on), 'true'&&false -> "false"
        // (off), undefined -> "undefined" (off).
        assert.strictEqual(runGate(BROKEN_GATE, 'true', 3), true);
        assert.strictEqual(runGate(BROKEN_GATE, 'true', 0), false);
        assert.strictEqual(runGate(BROKEN_GATE, undefined, 3), false);
    });
});
