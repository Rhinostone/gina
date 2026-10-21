/**
 * FormValidator — a `_case_` target's own live pass leaves the submit control to the whole-form pass (#B922)
 *
 * Since #B884 a field with no rule of its own that a `_case_` condition names is live-checked. Its own
 * (field) pass holds only that field, never the condition's driver, so no case applies: the pass finds
 * no rule and reads valid. `processEvent` then reset the field's display through `handleErrorsDisplay`,
 * whose no-error branch marked the form ready (`updateSubmitTriggerState($form, true)`); the show branch
 * clears native `disabled`, so a page script that had just disabled the submit control natively on that
 * field's `change` saw it enabled again before the whole-form pass gated the form. `handleErrorsDisplay`
 * now takes `isSubmitTriggerLeftToFormPass`, and `processEvent`'s valid branch passes `isCaseTarget`
 * (the wiring-time flag `addLiveForInput` computes): for such a field the whole-form pass that follows
 * alone writes the submit control. Every other caller keeps the former behaviour.
 *
 * Layering (project convention): source pins; the REAL blocks brace-walked out of main.js and executed
 * on stubs, with a subtract that removes the guard; pins on both bundles (gina.js verbatim, gina.min.js
 * by shape — Closure renames the locals).
 *
 * Red-first: `GINA_B922_MAIN_SRC=<file>` points §01–§02 at another copy of the validator source (e.g.
 * `git show <commit>:<path>` before the change), and `GINA_B922_DIST_DIR=<dir>` points §03 at another
 * directory holding gina.js and gina.min.js. On the pre-fix copies the non-control tests fail.
 *
 * Run: node --test test/core/validator-case-target-trigger-b922.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');

var MAIN     = process.env.GINA_B922_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B922_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

var src = fs.readFileSync(MAIN, 'utf8');

function stripComments(s) {
    return s.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}
function count(hay, needle) {
    return hay.split(needle).length - 1;
}
// From the first `{` at or after `from`, returns the index of its matching `}`.
function matchBrace(text, from) {
    var open = text.indexOf('{', from);
    var depth = 0;
    for (var j = open; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') {
            depth--;
            if (depth === 0) return j;
        }
    }
    return -1;
}
// The body of `var <name> = function(...) {...}` in `text`.
function extractVarFn(text, name) {
    var start = text.indexOf('var ' + name + ' = function');
    assert.ok(start > -1, name + ' declaration not found');
    var end = matchBrace(text, start);
    assert.ok(end > start, name + ' body not closed');
    return text.substring(start, end + 1);
}
// The argument count of each call `<callee>(` in `text` (a depth-aware comma count).
function callArities(text, callee) {
    var out = [];
    var from = 0;
    for (;;) {
        var i = text.indexOf(callee + '(', from);
        if (i < 0) break;
        var j = i + callee.length + 1, depth = 1, commas = 0, empty = true;
        for (; j < text.length && depth > 0; j++) {
            var c = text[j];
            if (c === '(' || c === '{' || c === '[') depth++;
            else if (c === ')' || c === '}' || c === ']') depth--;
            else if (c === ',' && depth === 1) commas++;
            if (depth > 0 && !/\s/.test(c)) empty = false;
        }
        out.push(empty ? 0 : commas + 1);
        from = i + callee.length + 1;
    }
    return out;
}
// gina's Object#count() augmentation is non-enumerable at runtime
function withCount(obj) {
    Object.defineProperty(obj, 'count', {
        value: function () { return Object.keys(this).length; },
        enumerable: false
    });
    return obj;
}

var active = stripComments(src);
var DECL = 'var handleErrorsDisplay = function($form, errors, data, fieldName, isSubmitTriggerLeftToFormPass) {';
var GUARD_RE = /if \( !isSubmitTriggerLeftToFormPass \) \{\s*updateSubmitTriggerState\( \$form, true \);\s*\}/g;
var CASE_CALL = 'handleErrorsDisplay(event.target.form, {}, result.data, event.target.name, isCaseTarget);';
var OLD_CALL  = 'handleErrorsDisplay(event.target.form, {}, result.data, event.target.name);';
var ERR_CALL  = 'handleErrorsDisplay(event.target.form, result.error, result.data, event.target.name);';

// handleErrorsDisplay's no-error trigger block: the `if (` holding the « update submit trigger state »
// comment, from that `if` to its closing brace (real bytes, comments kept).
function extractTriggerBlock() {
    var fn = extractVarFn(src, 'handleErrorsDisplay');
    var anchor = fn.indexOf('// update submit trigger state');
    assert.ok(anchor > -1, 'the trigger anchor is missing from handleErrorsDisplay');
    var start = fn.lastIndexOf('if (', anchor);
    var end = matchBrace(fn, start);
    assert.ok(start > -1 && end > anchor, 'the trigger block was not found');
    return fn.substring(start, end + 1);
}
// processEvent's verdict branch: `if (isFormValid) {...} else {...}` right before the error-branch call.
function extractVerdictBranch() {
    var errAt = src.indexOf(ERR_CALL);
    assert.ok(errAt > -1, 'the error-branch call is missing');
    var start = src.lastIndexOf('if (isFormValid) {', errAt);
    assert.ok(start > -1, 'the verdict branch is missing');
    var ifEnd = matchBrace(src, start);
    var elseAt = src.indexOf('else', ifEnd);
    var end = matchBrace(src, elseAt);
    assert.ok(ifEnd < errAt && errAt < end, 'the error-branch call must sit in the else block');
    return src.substring(start, end + 1);
}
function runTriggerBlock(block, flag, storeErrors) {
    var calls = [];
    var instance = { $forms: { f1: { errors: storeErrors } } };
    var fn = new Function('instance', 'formId', '$form', 'updateSubmitTriggerState', 'isSubmitTriggerLeftToFormPass', block);
    fn(instance, 'f1', { id: 'f1' }, function ($f, valid) { calls.push([$f.id, valid]); }, flag);
    return calls;
}
function runVerdictBranch(block, isFormValid, isCaseTarget) {
    var calls = [];
    var event = { target: { form: { id: 'f1' }, name: 'items[0][email]' } };
    var result = { data: { d: 1 }, error: { 'items[0][email]': { isRequired: 'required' } } };
    var fn = new Function('isFormValid', 'event', 'result', 'handleErrorsDisplay', 'isCaseTarget', block);
    fn(isFormValid, event, result, function () { calls.push(Array.prototype.slice.call(arguments)); }, isCaseTarget);
    return calls;
}

// ============================================================================
// 01 — source pins
// ============================================================================

describe('#B922 01 - source pins', function () {

    it('01.1 handleErrorsDisplay takes isSubmitTriggerLeftToFormPass', function () {
        assert.equal(count(active, DECL), 1);
    });

    it('01.2 its only submit-control write sits under `if ( !isSubmitTriggerLeftToFormPass )`', function () {
        var fn = stripComments(extractVarFn(src, 'handleErrorsDisplay'));
        assert.equal(count(fn, 'updateSubmitTriggerState('), 1, 'one write inside handleErrorsDisplay');
        assert.equal((fn.match(GUARD_RE) || []).length, 1, 'the write is guarded');
    });

    it('01.3 processEvent\'s valid branch passes isCaseTarget; the four-argument form is gone there', function () {
        assert.equal(count(active, CASE_CALL), 1);
        assert.equal(count(active, OLD_CALL), 0);
    });

    it('01.4 no other caller passes the flag: one five-argument call to handleErrorsDisplay', function () {
        var arities = callArities(active.replace(DECL, ''), 'handleErrorsDisplay');
        assert.ok(arities.length > 10, 'the census must see the callers (got ' + arities.length + ')');
        assert.equal(arities.filter(function (n) { return n === 5; }).length, 1);
        assert.equal(arities.filter(function (n) { return n > 5; }).length, 0);
    });

    it('01.5 isCaseTarget is declared in addLiveForInput before the listener that uses it', function () {
        var fn = stripComments(extractVarFn(src, 'addLiveForInput'));
        var decl = fn.indexOf('var isCaseTarget = ');
        var listener = fn.indexOf('addListener(gina, $el, eventsList');
        var use = fn.indexOf(CASE_CALL);
        assert.ok(decl > -1 && listener > decl, 'declared before the listener');
        assert.ok(use > listener, 'used inside the listener');
    });

    it('01.6 control (non-discriminating): the error branch and the select\'s field pass keep four arguments', function () {
        assert.equal(count(active, ERR_CALL), 1);
        assert.equal(count(active, 'handleErrorsDisplay($localForm, {}, result.data, $el.name);'), 1);
    });
});

// ============================================================================
// 02 — the real blocks, executed
// ============================================================================

describe('#B922 02 - the real blocks of main.js, executed on stubs', function () {

    it('02.1 handleErrorsDisplay\'s no-error block: no write when the caller\'s whole-form pass owns it', function () {
        assert.deepEqual(runTriggerBlock(extractTriggerBlock(), true, withCount({})), []);
    });

    it('02.2 control: without the flag (every other caller) it still marks the form ready', function () {
        assert.deepEqual(runTriggerBlock(extractTriggerBlock(), undefined, withCount({})), [['f1', true]]);
        // no store at all (`errors` unset): the block's second arm (a null store would throw there,
        // since its typeof guards let `null` through to `.count()`)
        assert.deepEqual(runTriggerBlock(extractTriggerBlock(), false, undefined), [['f1', true]]);
    });

    it('02.3 control: with errors in the store it writes nothing, flag or not', function () {
        var errors = withCount({ title: { isRequired: 'required' } });
        assert.deepEqual(runTriggerBlock(extractTriggerBlock(), undefined, errors), []);
        assert.deepEqual(runTriggerBlock(extractTriggerBlock(), true, errors), []);
    });

    it('02.4 subtract: the same block without the guard writes even with the flag', function () {
        var block = extractTriggerBlock();
        var subtracted = block.replace('if ( !isSubmitTriggerLeftToFormPass ) {', 'if ( true ) {');
        assert.notEqual(subtracted, block, 'the guard text must be found to subtract it');
        assert.deepEqual(runTriggerBlock(subtracted, true, withCount({})), [['f1', true]]);
    });

    it('02.5 processEvent\'s valid branch hands isCaseTarget as the fifth argument', function () {
        var block = extractVerdictBranch();
        var onCase = runVerdictBranch(block, true, true);
        assert.equal(onCase.length, 1);
        assert.deepEqual(onCase[0].slice(1, 4), [{}, { d: 1 }, 'items[0][email]']);
        assert.equal(onCase[0][4], true, 'a `_case_` target leaves the submit control to the whole-form pass');
        assert.equal(runVerdictBranch(block, true, false)[0][4], false, 'a field with its own rule does not');
    });

    it('02.6 control: the invalid branch passes the errors and no flag', function () {
        var calls = runVerdictBranch(extractVerdictBranch(), false, true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].length, 4);
        assert.deepEqual(calls[0][1], { 'items[0][email]': { isRequired: 'required' } });
    });
});

// ============================================================================
// 03 — the built bundles
// ============================================================================

describe('#B922 03 - the built bundles', function () {

    it('03.1 gina.js carries the declaration, the guard and the call', function () {
        var js = stripComments(fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8'));
        assert.equal(count(js, DECL), 1);
        assert.equal((js.match(GUARD_RE) || []).length, 1);
        assert.equal(count(js, CASE_CALL), 1);
        assert.equal(count(js, OLD_CALL), 0);
    });

    it('03.2 gina.min.js: the field pass\'s valid call has five arguments, none has four', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        var five = min.match(/\(([\w$]+)\.target\.form,\{\},([\w$]+)\.data,\1\.target\.name,[\w$]+\)/g) || [];
        var four = min.match(/\(([\w$]+)\.target\.form,\{\},([\w$]+)\.data,\1\.target\.name\)/g) || [];
        assert.equal(five.length, 1, 'gina.min.js is what browsers run: the flag is passed');
        assert.equal(four.length, 0, 'gina.min.js is what browsers run: no unflagged valid call');
    });

    it('03.3 gina.min.js: the no-error write is guarded', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        var guarded   = min.match(/&&!([\w$]+)\.\$forms\[([\w$]+)\]\.errors\)[\w$]+\|\|[\w$]+\([\w$]+,!0\)/g) || [];
        var unguarded = min.match(/&&!([\w$]+)\.\$forms\[([\w$]+)\]\.errors\)&&[\w$]+\([\w$]+,!0\)/g) || [];
        assert.equal(guarded.length, 1);
        assert.equal(unguarded.length, 0);
    });

    it('03.4 control (non-discriminating): gina.min.js keeps the invalid branch\'s call', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        var err = min.match(/\(([\w$]+)\.target\.form,([\w$]+)\.error,\2\.data,\1\.target\.name\)/g) || [];
        assert.equal(err.length, 1);
    });
});
