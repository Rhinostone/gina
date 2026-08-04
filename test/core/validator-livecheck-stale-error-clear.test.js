/**
 * FormValidator — live-check stale-error clear on a valid global pass (#B136)
 *
 * The two-stage live-check runs a whole-form ("global") validation after the
 * touched-field pass. Pre-fix, when the global pass came back VALID the only
 * clear branch was gated on the stored errors map being ALREADY EMPTY — but a
 * previously-failed pass had populated it, so nothing fired — and even when it
 * fired it cleared only the TOUCHED field's display. Net effect (the reported
 * shape): a checkbox interaction raises a compared sibling field, the pass
 * correctly re-enables the submit trigger, and the sibling's stale
 * blocking-error paragraph stays rendered next to the enabled submit.
 *
 * The fix adds a branch to BOTH copies of the global pass (processEvent's
 * onSilentGlobalLiveValidation and updateSelect's): fresh pass valid + store
 * non-empty → clear each previously-errored field's display via
 * handleErrorsDisplay($gForm, {}, null, field) and reset the store. New errors
 * are never rendered by this branch — untouched-field display still waits for
 * interaction or submit (the touched-only design is preserved).
 *
 * Test layering (project convention): source pins lock both live copies; the
 * behavioral section brace-walks the REAL else-if blocks out of main.js and
 * executes those exact bytes (no replica to drift); a subtract replays the
 * PRE-fix legacy branch to prove the new branch is load-bearing; dist pins
 * lock the built bundle (validated red-first: both artifacts carried neither
 * shape pre-fix).
 *
 * Run: node --test test/core/validator-livecheck-stale-error-clear.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require(path.join(__dirname, '..', 'fw'));
var MAIN_PATH = path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var DIST_JS_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.js');
var DIST_MIN_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');

var mainSrc = fs.readFileSync(MAIN_PATH, 'utf8');
var distSrc = fs.readFileSync(DIST_JS_PATH, 'utf8');
var distMin = fs.readFileSync(DIST_MIN_PATH, 'utf8');

// ============================================================================
// Helpers
// ============================================================================

function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}
function count(hay, needle) {
    return hay.split(needle).length - 1;
}

var BRANCH_HEADER = 'else if ( isFormValid && instance.$forms[formId].errors && instance.$forms[formId].errors.count() > 0 ) {';

// Brace-walk each REAL else-if block (header + body) out of the source.
function extractBranchBlocks() {
    var blocks = [];
    var from = 0;
    for (;;) {
        var i = mainSrc.indexOf(BRANCH_HEADER, from);
        if (i < 0) break;
        // the header itself ends with '{' — walk from that brace
        var braceStart = i + BRANCH_HEADER.length - 1;
        var depth = 0, j = braceStart;
        for (; j < mainSrc.length; j++) {
            if (mainSrc[j] === '{') depth++;
            else if (mainSrc[j] === '}') {
                depth--;
                if (depth === 0) break;
            }
        }
        if (depth !== 0) break;
        blocks.push(mainSrc.substring(i, j + 1));
        from = j;
    }
    return blocks;
}
var branchBlocks = extractBranchBlocks();

// Runtime-faithful error-store fixture: gina's Object#count() augmentation is
// non-enumerable, so the branch's for-in must never see it.
function withCount(obj) {
    Object.defineProperty(obj, 'count', {
        value: function () { return Object.keys(this).length; },
        enumerable: false
    });
    return obj;
}

// Execute a REAL extracted block. The block is an `else if`, so prefix a dead
// `if` to make it compilable stand-alone.
function runBlock(blockText, isFormValid, errorsStore) {
    var calls = [];
    var instance = { $forms: { f1: { errors: errorsStore } } };
    var hED = function ($f, errs, data, fieldName) { calls.push([errs, data, fieldName]); };
    var fn = new Function('isFormValid', 'instance', 'formId', '$gForm', 'handleErrorsDisplay',
        'if (false) { } ' + blockText);
    fn(isFormValid, instance, 'f1', {}, hED);
    return { calls: calls, store: instance.$forms.f1.errors };
}

// ============================================================================
// 01 — source pins: both global-pass copies carry the stale-clear branch
// ============================================================================

describe('01 - #B136 source pins: the stale-clear branch in BOTH copies', function () {

    it('01.1 - the branch appears exactly twice (processEvent + updateSelect)', function () {
        var active = stripComments(mainSrc);
        assert.equal(count(active, BRANCH_HEADER), 2);
        assert.equal(count(active, 'handleErrorsDisplay($gForm, {}, null, staleField);'), 2);
        assert.equal(branchBlocks.length, 2, 'brace-walk extraction must find both blocks');
    });

    it('01.2 - processEvent copy: between the touched-only branch and the legacy empty-store branch', function () {
        var active = stripComments(mainSrc);
        var touchedIdx = active.indexOf('instance.$forms[ $el.form.getAttribute(\'id\') ].errors = merge(result.error, gResult.error);');
        var mineIdx = active.indexOf(BRANCH_HEADER);
        var legacyIdx = active.indexOf('else if ( instance.$forms[formId].errors && !instance.$forms[formId].errors.count() ) {');
        assert.ok(touchedIdx > -1 && mineIdx > -1 && legacyIdx > -1);
        assert.ok(touchedIdx < mineIdx, 'the new branch sits after the touched-only display branch');
        assert.ok(mineIdx < legacyIdx, 'the new branch sits before the legacy empty-store branch');
    });

    it('01.3 - updateSelect copy: inside the updateSelect closure', function () {
        var active = stripComments(mainSrc);
        var usStart = active.indexOf('var updateSelect = function');
        var usEnd = active.indexOf('var selectedIndex = null');
        assert.ok(usStart > -1 && usEnd > usStart, 'updateSelect block anchors not found');
        assert.equal(count(active, 'var selectedIndex = null'), 1, 'end anchor must be unique');
        var usSlice = active.substring(usStart, usEnd);
        assert.equal(count(usSlice, BRANCH_HEADER), 1, 'updateSelect must carry its own copy of the branch');
    });

    it('01.4 - each extracted block resets the store then clears per stale field', function () {
        branchBlocks.forEach(function (b) {
            assert.ok(b.indexOf('instance.$forms[formId].errors = {};') > -1);
            assert.ok(b.indexOf('for (var staleField in staleErrors)') > -1);
            var resetIdx = b.indexOf('instance.$forms[formId].errors = {};');
            var loopIdx = b.indexOf('for (var staleField in staleErrors)');
            assert.ok(resetIdx < loopIdx, 'store reset precedes the clear loop');
        });
    });
});

// ============================================================================
// 02 — behavioral: the REAL extracted blocks, executed
// ============================================================================

describe('02 - #B136 behavioral: real block bytes over the state matrix', function () {

    branchBlocks.forEach(function (blockText, n) {
        var label = (n === 0) ? 'processEvent copy' : 'updateSelect copy';

        it('02.' + (n * 4 + 1) + ' - [' + label + '] valid pass + stale store: clears EVERY previously-errored field', function () {
            var r = runBlock(blockText, true, withCount({ a: { is: 'stale msg' }, b: { isRequired: 'stale msg' } }));
            assert.equal(r.calls.length, 2, 'one clear call per stale field');
            var fields = r.calls.map(function (c) { return c[2]; }).sort();
            assert.deepEqual(fields, ['a', 'b']);
            r.calls.forEach(function (c) {
                assert.deepEqual(c[0], {}, 'clears with EMPTY errors — never renders new ones');
                assert.equal(c[1], null, 'null data — no Toolbar refresh with empty data');
            });
            assert.equal(Object.keys(r.store).length, 0, 'the store is reset');
        });

        it('02.' + (n * 4 + 2) + ' - [' + label + '] invalid pass: untouched (no clears, store kept)', function () {
            var store = withCount({ a: { is: 'stale msg' } });
            var r = runBlock(blockText, false, store);
            assert.equal(r.calls.length, 0);
            assert.equal(r.store, store, 'store must not be reset on an invalid pass');
        });

        it('02.' + (n * 4 + 3) + ' - [' + label + '] valid pass + empty store: no-op (count guard)', function () {
            var r = runBlock(blockText, true, withCount({}));
            assert.equal(r.calls.length, 0);
        });

        it('02.' + (n * 4 + 4) + ' - [' + label + '] valid pass + missing store: no-op (existence guard)', function () {
            var r = runBlock(blockText, true, undefined);
            assert.equal(r.calls.length, 0);
        });
    });
});

// ============================================================================
// 03 — subtract: the PRE-fix legacy branch could not clear the sibling
// ============================================================================

describe('03 - #B136 subtract: the pre-fix shape left the stale display', function () {

    // PRE-fix clear branch — kept ONLY to demonstrate the defect: gated on the
    // store being ALREADY EMPTY, and clearing only the touched field.
    function preFixLegacyBranch(instance, formId, hED, $el) {
        if ( instance.$forms[formId].errors && !instance.$forms[formId].errors.count() ) {
            instance.$forms[formId].errors = {};
            hED({}, null, $el.name);
        }
    }

    it('03.1 - pre-fix: a valid pass over a NON-empty store cleared nothing', function () {
        var calls = [];
        var instance = { $forms: { f1: { errors: withCount({ a: { is: 'stale msg' } }) } } };
        preFixLegacyBranch(instance, 'f1', function () { calls.push(1); }, { name: 'checkboxField' });
        assert.equal(calls.length, 0, 'the empty-store gate never fired with a stale entry — the reported defect');
        assert.equal(Object.keys(instance.$forms.f1.errors).length, 1, 'the stale entry survived');
    });

    it('03.2 - pre-fix: even when it fired, only the TOUCHED field was cleared', function () {
        var cleared = [];
        var instance = { $forms: { f1: { errors: withCount({}) } } };
        preFixLegacyBranch(instance, 'f1', function (e, d, f) { cleared.push(f); }, { name: 'checkboxField' });
        assert.deepEqual(cleared, ['checkboxField'], 'the sibling with the rendered error was never the target');
    });

    it('03.3 - the REAL post-fix block clears the sibling on the same input', function () {
        var r = runBlock(branchBlocks[0], true, withCount({ siblingField: { is: 'stale msg' } }));
        assert.deepEqual(r.calls.map(function (c) { return c[2]; }), ['siblingField'],
            'the new branch is load-bearing');
    });
});

// ============================================================================
// 04 — dist fidelity — validated red-first (0 in both pre-fix artifacts)
// ============================================================================

describe('04 - #B136 dist fidelity: both copies reach the bundle', function () {

    it('04.1 - unminified gina.js carries the literal branch twice', function () {
        assert.equal(count(distSrc, BRANCH_HEADER), 2);
    });

    it('04.2 - gina.min.js carries the minified shape twice', function () {
        // Property names (.errors, .count) survive Closure SIMPLE mode;
        // locals are renamed and the block is folded into a brace-less
        // `for (X in a=…, b={}, a)` comma expression (measured on the built
        // artifact), so pin the distinctive guard+loop adjacency — the
        // valid+non-empty guard immediately followed by the clear loop.
        // Pre-fix artifact: 0 (every other .errors.count()>0 site is followed
        // by && / ?, never a for-in).
        //
        // Wrap-PROOF by normalisation, not by enumerating \s*. Closure breaks
        // minified lines at a fixed column, so ANY upstream byte change shifts
        // every downstream wrap — a newline can land mid-token and blind a pin
        // that tolerates whitespace at all the OTHER boundaries. That is a
        // false negative (the pin stops seeing a match that is really there),
        // so the shape is matched against a whitespace-stripped copy instead.
        // Measured when #A11Y2 grew the bundle: the wrap moved into
        // `count()>` + `0`, and the two live copies wrap at DIFFERENT
        // boundaries, so patching one boundary would not have held.
        var flat = distMin.replace(/\s+/g, '');
        var m = flat.match(/\.errors\.count\(\)>0\)\{?for\(/g);
        assert.ok(m && m.length === 2,
            'expected the stale-clear guard+loop shape twice in the minified bundle, got ' + (m ? m.length : 0));
    });
});
