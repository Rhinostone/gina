/**
 * FormValidator — handleAutoComplete caret integrity (#B389 / #B390 / #B391 / #B392)
 *
 * #B389 (gh issue #63) — the Safari-autocomplete interception rebuilds the
 * field's value in JavaScript, which parks the caret at the END of the field
 * (assigning `.value` collapses the selection to the end — measured on WebKit
 * AND Chromium), and only restored it two setTimeout(0) hops later. Any
 * keystroke arriving inside that window read the stale `selectionStart` and
 * inserted at the wrong offset — fast typing into a field with existing
 * content came out scrambled ("AXB" where the user typed "ABX"). The fix:
 *   (1) commitCaret — synchronous caret restore right after each rebuild
 *       (measured to stick, and to survive the readonly dance, on WebKit and
 *       Chromium), recorded on the element (`_ginaAcCaret`);
 *   (2) an entry override — while a deferred restore is in flight
 *       (`_ginaAcPending > 0`), the keydown handler trusts the recorded
 *       caret, not the element's selection;
 *   (3) queueCaretRestore — the transient-readonly dance (the Safari
 *       autofill suppression, kept mechanism-identical) whose deferred
 *       restore re-asserts the LATEST committed caret instead of a stale
 *       per-keystroke capture, and hands the caret back (tracker nulled)
 *       once the last pending restore fired;
 *   (4) arrows commit through the same tracker so a pending restore cannot
 *       undo an arrow move.
 *
 * By-catches, same switch block (each measured with a firing control):
 * #B390 — Backspace at position 0 deleted the FIRST character (native: no-op).
 * #B391 — Delete with a selection starting at 0 ate one char MORE than the
 *         selection ("XY" with [0,1) selected gave "", native gives "Y").
 * #B392 — ArrowLeft at position 0 called setCaretToPos(-1); setSelectionRange
 *         coerces -1 to the unsigned maximum and clamps to the END of the
 *         field (measured on WebKit and Chromium) — the caret teleported to
 *         the end. Fixed with a floor at 0.
 *
 * Test layering (project convention): source pins lock the live shapes in
 * main.js; an extracted-real-bytes section executes the ACTUAL keydown
 * handler (brace-walked out of main.js — no replica to drift) against fake
 * events on a WebKit-model element (caret-to-end on `.value` assignment —
 * the measured real-engine behavior); timing arms are paired (fast = the
 * defect window, drained = the control that can fail and must not);
 * dist-fidelity pins lock the built bundle. The whole file was validated
 * red-first against the pre-fix source and pre-fix dist.
 *
 * Run: node --test test/core/validator-autocomplete-caret.test.js
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

// Strip line comments (the replace-code convention keeps the pre-fix blocks
// commented out) so negative pins never trip on retired code.
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// Occurrence count that is safe on minified single-line files.
function count(hay, needle) {
    return hay.split(needle).length - 1;
}

// The handleAutoComplete block — end-anchored on the NEXT top-level declaration.
var acStart = mainSrc.indexOf('var handleAutoComplete = function');
var acEnd = mainSrc.indexOf('var registerForLiveChecking = function');
var acSlice = (acStart > -1 && acEnd > acStart) ? mainSrc.substring(acStart, acEnd) : '';

// Brace-walk a `var <name> = function ...` declaration's function text out of
// the module source. Returns null when the declaration is absent (pre-fix).
function extractFnDecl(name, from) {
    var hay = from || mainSrc;
    var anchor = 'var ' + name + ' = function';
    var i = hay.indexOf(anchor);
    if (i < 0) return null;
    var braceStart = hay.indexOf('{', i);
    var depth = 0, j = braceStart;
    for (; j < hay.length; j++) {
        if (hay[j] === '{') depth++;
        else if (hay[j] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    if (depth !== 0) return null;
    return hay.substring(i + ('var ' + name + ' = ').length, j + 1);
}

// Brace-walk the ACTUAL keydown handler out of the handleAutoComplete block.
var KD_ANCHOR = 'addListener(gina, event.currentTarget, evtName, function(e) {';
function extractKeydownHandler() {
    var i = acSlice.indexOf(KD_ANCHOR);
    if (i < 0) return null;
    var fnStart = i + 'addListener(gina, event.currentTarget, evtName, '.length;
    var braceStart = acSlice.indexOf('{', fnStart);
    var depth = 0, j = braceStart;
    for (; j < acSlice.length; j++) {
        if (acSlice[j] === '{') depth++;
        else if (acSlice[j] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    if (depth !== 0) return null;
    return acSlice.substring(fnStart, j + 1);
}
var keydownHandlerText = extractKeydownHandler();
var commitCaretText = extractFnDecl('commitCaret');
var queueCaretRestoreText = extractFnDecl('queueCaretRestore');

// WebKit-model element: assigning `.value` collapses the selection to the END
// (the measured behavior of BOTH engines — probe 2026-08-17), attribute calls
// recorded for the readonly-dance assertions.
function makeEl(initial, selStart, selEnd) {
    var calls = { setAttribute: [], removeAttribute: [] };
    var el = {
        _value: initial,
        selectionStart: selStart,
        selectionEnd: selEnd,
        setAttribute: function (k, v) { calls.setAttribute.push([k, v]); },
        removeAttribute: function (k) { calls.removeAttribute.push(k); },
        __calls: calls
    };
    Object.defineProperty(el, 'value', {
        get: function () { return el._value; },
        set: function (v) {
            el._value = v;
            el.selectionStart = el.selectionEnd = v.length;   // caret to END
        }
    });
    return el;
}
function makeEvent(el, keyCode, key, mods) {
    mods = mods || {};
    var ev = {
        keyCode: keyCode,
        key: key,
        metaKey: !!mods.metaKey,
        ctrlKey: !!mods.ctrlKey,
        currentTarget: el,
        __pdCalled: 0,
        preventDefault: function () { ev.__pdCalled++; }
    };
    return ev;
}
// Builds a callable from the extracted real bytes. The setCaretToPos spy is
// REALISTIC: it moves the fake element's selection (as setSelectionRange
// would) in addition to recording the call.
function buildHandler() {
    var caretCalls = [];
    var spyCaret = function ($el, pos) {
        caretCalls.push(pos);
        $el.selectionStart = $el.selectionEnd = pos;
    };
    // The helpers are REAL extracted bytes too (post-fix); pre-fix they are
    // absent and the pre-fix handler never references them.
    var commitCaretFn = commitCaretText
        ? new Function('setCaretToPos', 'return ( ' + commitCaretText + ' );')(spyCaret)
        : undefined;
    var queueCaretRestoreFn = queueCaretRestoreText
        ? new Function('setTimeout', 'setCaretToPos', 'return ( ' + queueCaretRestoreText + ' );')(setTimeout, spyCaret)
        : undefined;
    var fn = new Function(
        'keyboardMapping', 'setCaretToPos', 'focusNextElement',
        'clearTimeout', 'liveCheckTimer', 'console',
        'commitCaret', 'queueCaretRestore',
        'return ( ' + keydownHandlerText + ' );'
    )(
        {}, spyCaret, function () {}, function () {}, null, { debug: function () {} },
        commitCaretFn, queueCaretRestoreFn
    );
    fn.__setCaretCalls = caretCalls;
    return fn;
}
// Deterministic drain of the nested setTimeout(0) readonly dance (2 hops per
// keystroke; 4 hops covers stacked restores).
async function drainTimers() {
    for (var i = 0; i < 4; i++) {
        await new Promise(function (r) { setTimeout(r, 0); });
    }
}

// ============================================================================
// 00 — extraction controls
// ============================================================================

describe('00 - extraction controls', function () {

    it('00.1 - the block and the keydown handler are found exactly once', function () {
        assert.ok(acStart > -1, 'handleAutoComplete declaration not found');
        assert.ok(acEnd > acStart, 'registerForLiveChecking end-anchor not found after it');
        assert.equal(count(acSlice, KD_ANCHOR), 1, 'keydown registration anchor must appear exactly once');
        assert.ok(keydownHandlerText, 'brace-walk extraction failed');
        assert.ok(keydownHandlerText.indexOf('switch (e.keyCode)') > -1, 'extracted text is not the keydown handler');
    });
});

// ============================================================================
// 10 — source pins (#B389 / #B390 / #B391 / #B392)
// ============================================================================

describe('10 - source pins: sync commit, tracker override, guarded restore', function () {

    it('10.1 - commitCaret and queueCaretRestore exist, after setCaretToPos, before isElementVisible', function () {
        assert.ok(commitCaretText, 'commitCaret declaration not found');
        assert.ok(queueCaretRestoreText, 'queueCaretRestore declaration not found');
        var scpIdx = mainSrc.indexOf('var setCaretToPos = function');
        var ccIdx = mainSrc.indexOf('var commitCaret = function');
        var qcrIdx = mainSrc.indexOf('var queueCaretRestore = function');
        var ievIdx = mainSrc.indexOf('var isElementVisible = function');
        assert.ok(scpIdx > -1 && ccIdx > scpIdx, 'commitCaret must be declared after setCaretToPos');
        assert.ok(qcrIdx > ccIdx && ievIdx > qcrIdx, 'queueCaretRestore must sit between commitCaret and isElementVisible');
    });

    it('10.2 - the entry override trusts the tracker while a restore is pending', function () {
        var active = stripComments(keydownHandlerText);
        var readIdx = active.indexOf('var posStart = $_el.selectionStart, posEnd = $_el.selectionEnd;');
        var ovrIdx = active.indexOf("if ( ($_el._ginaAcPending || 0) > 0 && typeof($_el._ginaAcCaret) == 'number' ) {");
        var swIdx = active.indexOf('switch (e.keyCode)');
        assert.ok(readIdx > -1, 'the selection read is missing');
        assert.ok(ovrIdx > readIdx, 'the pending-window override must follow the selection read');
        assert.ok(swIdx > ovrIdx, 'the override must run before the switch');
        assert.ok(active.indexOf('posStart = posEnd = $_el._ginaAcCaret;') > ovrIdx, 'the override must collapse both positions onto the tracker');
    });

    it('10.3 - every rebuild branch commits + queues; arrows commit through the tracker', function () {
        var active = stripComments(keydownHandlerText);
        assert.equal(count(active, 'queueCaretRestore($_el)'), 3,
            'printable, Backspace and Delete must each queue exactly one guarded restore');
        assert.equal(count(active, 'commitCaret($_el,'), 5,
            'three rebuild branches + two arrow branches must commit through the tracker');
    });

    it('10.4 - #B390: the Backspace-at-0 first-char deletion is dead code', function () {
        // The identical rebuild line legitimately remains ONCE — in the Delete
        // branch, where removing the char AFTER the caret at position 0 is
        // correct. Raw text keeps the retired Backspace copy as a comment.
        assert.equal(count(stripComments(acSlice), '$_el.value = str.substring(posStart+1);'), 1,
            'only the Delete branch may keep the substring(posStart+1) rebuild');
        assert.equal(count(acSlice, '$_el.value = str.substring(posStart+1);'), 2,
            'the retired Backspace copy must remain visible as a comment (replace-code convention)');
    });

    it('10.5 - #B391: the Delete selection-at-0 override is dead code', function () {
        assert.equal(count(stripComments(acSlice), '$_el.value = str.substring(posEnd+1);'), 0,
            'the extra-char-eating override must be out of the live Delete branch');
        assert.ok(count(acSlice, '$_el.value = str.substring(posEnd+1);') >= 1,
            'the retired override must remain visible as a comment');
    });

    it('10.6 - #B392: ArrowLeft floors at 0; no bare posStart-1 caret call remains', function () {
        var active = stripComments(keydownHandlerText);
        assert.equal(count(active, 'setCaretToPos($_el, posStart-1);'), 0,
            'the unfloored ArrowLeft caret call (and the vestigial Backspace-tail copy) must be dead');
        assert.equal(count(active, 'commitCaret($_el, (posStart > 0) ? posStart-1 : 0);'), 1,
            'ArrowLeft must floor at 0 through the tracker');
    });

    it('10.7 - the readonly dance (autofill suppression) lives on, mechanism-identical, in queueCaretRestore', function () {
        var active = stripComments(queueCaretRestoreText || '');
        assert.ok(active.indexOf("setAttribute('readonly', 'readonly')") > -1, 'the transient readonly re-set is missing');
        assert.ok(active.indexOf("removeAttribute('readonly')") > -1, 'the readonly removal is missing');
        assert.equal(count(active, 'setTimeout('), 2, 'the two-hop deferral must be preserved');
    });

    it('10.8 - the deferred restore is typeof-guarded (0 is a valid caret; cleared tracker is null)', function () {
        var active = stripComments(queueCaretRestoreText || '');
        assert.ok(active.indexOf("typeof($el._ginaAcCaret) == 'number'") > -1,
            'the restore must guard on typeof number, never truthiness');
        assert.ok(active.indexOf('$el._ginaAcCaret = null;') > -1,
            'the tracker must be handed back once the last restore fired');
    });
});

// ============================================================================
// 20 — behavioral (#B389): the REAL handler bytes on a WebKit-model element
// ============================================================================

describe('20 - #B389 behavioral: fast typing composes like a native field', function () {

    it('20.1 - two keystrokes in one task: "X" caret 0 + "A","B" -> "ABX" (the gh #63 scene)', async function () {
        var el = makeEl('X', 0, 0);
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));
        fn(makeEvent(el, 66, 'B'));
        await drainTimers();
        assert.equal(el.value, 'ABX', 'fast consecutive keystrokes must compose at the caret');
        assert.equal(el.selectionStart, 2, 'the caret must end up after the two typed chars');
    });

    it('20.2 - three keystrokes in one task exercise a pending count > 1', async function () {
        var el = makeEl('X', 0, 0);
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));
        fn(makeEvent(el, 66, 'B'));
        fn(makeEvent(el, 67, 'C'));
        await drainTimers();
        assert.equal(el.value, 'ABCX');
        assert.equal(el.selectionStart, 3);
    });

    it('20.3 - CONTROL (can fail, must not): drained between keystrokes stays correct', async function () {
        var el = makeEl('X', 0, 0);
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));
        await drainTimers();
        fn(makeEvent(el, 66, 'B'));
        await drainTimers();
        assert.equal(el.value, 'ABX', 'slow typing was always correct — a red here means the harness, not the fix');
        assert.equal(el.selectionStart, 2);
    });

    it('20.4 - printable then Backspace in one task removes the char just typed', async function () {
        var el = makeEl('X', 0, 0);
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));                    // "AX", caret 1
        fn(makeEvent(el, 8, 'Backspace'));             // must remove the "A"
        await drainTimers();
        assert.equal(el.value, 'X', 'Backspace inside the restore window must delete the char before the REAL caret');
        assert.equal(el.selectionStart, 0);
    });

    it('20.5 - a stale deferred restore cannot clobber a later keystroke\'s caret', async function () {
        var el = makeEl('X', 0, 0);
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));                    // queues restore #1 (would be 1)
        fn(makeEvent(el, 66, 'B'));                    // caret now 2
        await drainTimers();                           // BOTH restores fire
        assert.equal(el.selectionStart, 2, 'the earlier restore must re-assert the LATEST caret, not its own stale capture');
    });

    it('20.6 - typing over an initial selection, fast, composes correctly', async function () {
        var el = makeEl('XY', 0, 2);                   // whole value selected
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));                    // replaces selection -> "A"
        fn(makeEvent(el, 66, 'B'));                    // -> "AB"
        await drainTimers();
        assert.equal(el.value, 'AB');
        assert.equal(el.selectionStart, 2);
    });

    it('20.7 - the tracker is handed back once the last restore fired', async function () {
        var el = makeEl('X', 0, 0);
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));
        fn(makeEvent(el, 66, 'B'));
        await drainTimers();
        assert.equal(el._ginaAcPending, 0, 'no restore may be left pending');
        assert.equal(el._ginaAcCaret, null, 'the tracker must be nulled so the element\'s own selection rules again');
    });

    it('20.8 - an arrow move inside the restore window is not undone by the pending restore', async function () {
        var el = makeEl('XY', 2, 2);
        var fn = buildHandler();
        fn(makeEvent(el, 65, 'A'));                    // "XYA", caret 3, restore pending
        fn(makeEvent(el, 37, 'ArrowLeft'));            // caret 2
        await drainTimers();                           // pending restore fires
        assert.equal(el.selectionStart, 2, 'the deferred restore must re-assert the arrow\'s position, not the rebuild\'s');
    });
});

// ============================================================================
// 30 — behavioral by-catches (#B390 / #B391 / #B392) — timing-independent
// ============================================================================

describe('30 - by-catch behavioral: position-0 edges match a native field', function () {

    it('30.1 - #B390: Backspace at position 0 is a no-op (was: deleted the first char)', async function () {
        var el = makeEl('X', 0, 0);
        var ev = makeEvent(el, 8, 'Backspace');
        buildHandler()(ev);
        await drainTimers();
        assert.equal(ev.__pdCalled, 1, 'the interception still owns the event');
        assert.equal(el.value, 'X', 'nothing sits before the caret — the value must not change');
        assert.equal(el.__calls.setAttribute.length, 0, 'a no-op must not run the readonly dance');
    });

    it('30.2 - #B391: Delete removes ONLY the selection when it starts at 0', async function () {
        var el = makeEl('XY', 0, 1);
        buildHandler()(makeEvent(el, 46, 'Delete'));
        await drainTimers();
        assert.equal(el.value, 'Y', 'native Delete removes the selection, nothing more');
        assert.equal(el.selectionStart, 0);
    });

    it('30.3 - CONTROL: Delete with a mid-field selection was always correct', async function () {
        var el = makeEl('XY', 1, 2);
        buildHandler()(makeEvent(el, 46, 'Delete'));
        await drainTimers();
        assert.equal(el.value, 'X');
    });

    it('30.4 - #B392: ArrowLeft at position 0 stays at 0 (was: wrapped to the END)', function () {
        var el = makeEl('XYZ', 0, 0);
        var fn = buildHandler();
        fn(makeEvent(el, 37, 'ArrowLeft'));
        assert.equal(fn.__setCaretCalls.length, 1, 'the arrow must move the caret exactly once');
        assert.equal(fn.__setCaretCalls[0], 0,
            'setSelectionRange(-1) coerces to the unsigned max and clamps to the END — the floor must stop that');
        assert.equal(el.selectionStart, 0);
    });

    it('30.5 - CONTROL: ArrowLeft mid-field still steps one left', function () {
        var el = makeEl('XYZ', 2, 2);
        var fn = buildHandler();
        fn(makeEvent(el, 37, 'ArrowLeft'));
        assert.deepEqual(fn.__setCaretCalls, [1]);
    });

    it('30.6 - ArrowRight at the end still refuses to move past the value', function () {
        var el = makeEl('X', 1, 1);
        var fn = buildHandler();
        fn(makeEvent(el, 39, 'ArrowRight'));
        assert.equal(fn.__setCaretCalls.length, 0, 'the existing end-guard must survive the tracker rewrite');
    });
});

// ============================================================================
// 40 — dist fidelity — validated red-first (0 occurrences in the pre-fix dist)
// ============================================================================

describe('40 - dist fidelity: the tracker reaches the built bundle', function () {

    it('40.1 - gina.min.js carries the tracker properties (names survive Closure SIMPLE)', function () {
        assert.ok(count(distMin, '_ginaAcCaret') >= 1, 'the caret tracker must reach the minified bundle');
        assert.ok(count(distMin, '_ginaAcPending') >= 1, 'the pending counter must reach the minified bundle');
    });

    it('40.2 - unminified gina.js carries the live helpers', function () {
        var active = stripComments(distSrc);
        assert.ok(active.indexOf('var commitCaret = function') > -1);
        assert.ok(active.indexOf('var queueCaretRestore = function') > -1);
    });
});
