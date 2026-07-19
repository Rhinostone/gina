/**
 * FormValidator — handleAutoComplete keydown interception (#B134 / #B135)
 *
 * #B134 — modifier chords (metaKey/ctrlKey) must NOT be intercepted: the
 * handler now returns BEFORE preventDefault so the native select-all / copy /
 * paste / cut / undo defaults run. Pre-fix, the printable rebuild branch typed
 * the chord letter into the field (Cmd+A appended "a") and keyboard paste was
 * routed to document.execCommand("paste"), which is inert in unprivileged web
 * content — keyboard paste was silently dead on intercepted fields.
 *
 * #B135 (companion) — the interception's UA gate matches REAL Safari only:
 * every Chromium UA carries the "Safari/537.36" token, so the bare /safari/i
 * test ran this WebKit workaround on Chrome/Edge/Brave/Opera where it was
 * never intended (the handleAutoComplete header comment states the Safari
 * intent).
 *
 * Test layering (project convention): source pins lock the live shapes in
 * main.js; an extracted-real-bytes section executes the ACTUAL keydown handler
 * (brace-walked out of main.js — no replica to drift) against fake events;
 * subtract cases replay the PRE-fix shapes to prove the bail is load-bearing;
 * dist-fidelity pins lock the built bundle (each validated red-first against
 * the pre-fix artifact: execCommand('paste') = 1 occurrence pre-fix,
 * .metaKey||X.ctrlKey = 0 pre-fix).
 *
 * Run: node --test test/core/validator-autocomplete-interception.test.js
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

// Strip line comments the replace-code convention leaves behind (the house
// idiom) so negative pins never trip on the commented-out pre-fix block.
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// Occurrence count that is safe on minified single-line files (`grep -c`
// counts LINES, not occurrences — measured while designing these pins).
function count(hay, needle) {
    return hay.split(needle).length - 1;
}

// The handleAutoComplete block — end-anchored on the NEXT top-level
// declaration (distinctive outer text, per the structural-anchor discipline).
var acStart = mainSrc.indexOf('var handleAutoComplete = function');
var acEnd = mainSrc.indexOf('var registerForLiveChecking = function');
var acSlice = (acStart > -1 && acEnd > acStart) ? mainSrc.substring(acStart, acEnd) : '';

// Brace-walk the ACTUAL keydown handler function text out of the slice.
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

// Fake element/event factories for the behavioral runs.
function makeEl(value, selStart, selEnd) {
    var calls = { setAttribute: [], removeAttribute: [] };
    return {
        value: value,
        selectionStart: selStart,
        selectionEnd: selEnd,
        setAttribute: function (k, v) { calls.setAttribute.push([k, v]); },
        removeAttribute: function (k) { calls.removeAttribute.push(k); },
        __calls: calls
    };
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
// Builds a callable from the extracted real bytes, supplying the handler's
// free variables as stubbed params.
function buildHandler(spies) {
    spies = spies || {};
    var setCaretCalls = [];
    var fn = new Function(
        'keyboardMapping', 'setCaretToPos', 'focusNextElement',
        'clearTimeout', 'liveCheckTimer', 'console',
        'return ( ' + keydownHandlerText + ' );'
    )(
        spies.keyboardMapping || {},
        spies.setCaretToPos || function ($el, pos) { setCaretCalls.push(pos); },
        spies.focusNextElement || function () {},
        function () {},
        null,
        { debug: function () {} }
    );
    fn.__setCaretCalls = setCaretCalls;
    return fn;
}
// Deterministic drain of the handler's nested setTimeout(0) readonly dance.
async function drainTimers() {
    await new Promise(function (r) { setTimeout(r, 0); });
    await new Promise(function (r) { setTimeout(r, 0); });
    await new Promise(function (r) { setTimeout(r, 0); });
}

// ============================================================================
// 01 — source pins (#B134)
// ============================================================================

describe('01 - #B134 source pins: the chord bail in the keydown interception', function () {

    it('01.1 - extraction controls: the block and the handler are found exactly once', function () {
        assert.ok(acStart > -1, 'handleAutoComplete declaration not found');
        assert.ok(acEnd > acStart, 'registerForLiveChecking end-anchor not found after it');
        assert.equal(count(acSlice, KD_ANCHOR), 1, 'keydown registration anchor must appear exactly once in the block');
        assert.ok(keydownHandlerText, 'brace-walk extraction failed');
        assert.ok(keydownHandlerText.indexOf('switch (e.keyCode)') > -1, 'extracted text is not the keydown handler');
    });

    it('01.2 - the metaKey/ctrlKey bail sits BEFORE preventDefault, and returns', function () {
        var active = stripComments(keydownHandlerText);
        var bailIdx = active.indexOf('if ( e.metaKey || e.ctrlKey )');
        var pdIdx = active.indexOf('e.preventDefault()');
        assert.ok(bailIdx > -1, 'the chord bail is missing');
        assert.ok(pdIdx > -1, 'e.preventDefault() is missing');
        assert.ok(bailIdx < pdIdx, 'the bail must run before preventDefault');
        assert.ok(active.substring(bailIdx, pdIdx).indexOf('return') > -1,
            'the bail must return (leave the event to the native default)');
    });

    it('01.3 - no live execCommand remains anywhere in the handler', function () {
        var active = stripComments(keydownHandlerText);
        assert.equal(count(active, 'document.execCommand'), 0,
            'the chord re-implementations (copy/paste/cut) must be dead code');
    });

    it('01.4 - the plain-key interception contract is intact', function () {
        var active = stripComments(keydownHandlerText);
        assert.ok(active.indexOf('case 46:') > -1, 'Delete handling removed');
        assert.ok(active.indexOf('case 8:') > -1, 'Backspace handling removed');
        assert.ok(active.indexOf('case 9:') > -1, 'Tab handling removed');
        assert.ok(active.indexOf('$_el.value = str.substring(0, posStart) + e.key') > -1,
            'the printable rebuild branch removed');
        assert.ok(active.indexOf("setAttribute('readonly', 'readonly')") > -1,
            'the transient-readonly dance removed');
    });
});

// ============================================================================
// 02 — extracted-real-bytes behavioral (#B134)
// ============================================================================

describe('02 - #B134 behavioral: the REAL handler bytes, executed', function () {

    it('02.1 - Cmd+A bails: no preventDefault, value untouched', function () {
        var el = makeEl('100', 3, 3);
        var ev = makeEvent(el, 65, 'a', { metaKey: true });
        buildHandler()(ev);
        assert.equal(ev.__pdCalled, 0, 'preventDefault must not run on a chord');
        assert.equal(el.value, '100', 'the chord letter must not be typed into the field');
        assert.equal(el.__calls.setAttribute.length, 0, 'no readonly re-set on the bail path');
    });

    it('02.2 - Ctrl+V bails: no preventDefault, value untouched, no caret fiddling', function () {
        var el = makeEl('100', 3, 3);
        var ev = makeEvent(el, 86, 'v', { ctrlKey: true });
        var fn = buildHandler();
        fn(ev);
        assert.equal(ev.__pdCalled, 0);
        assert.equal(el.value, '100');
        assert.equal(fn.__setCaretCalls.length, 0, 'the pre-fix paste path moved the caret — the bail must not');
    });

    it('02.3 - Cmd+ArrowLeft bails (native caret navigation runs)', function () {
        var el = makeEl('100', 3, 3);
        var ev = makeEvent(el, 37, 'ArrowLeft', { metaKey: true });
        var fn = buildHandler();
        fn(ev);
        assert.equal(ev.__pdCalled, 0);
        assert.equal(fn.__setCaretCalls.length, 0, 'the arrow case must not run for a chord');
    });

    it('02.4 - a plain printable key still round-trips through the rebuild', async function () {
        var el = makeEl('100', 3, 3);
        var ev = makeEvent(el, 65, 'a', {});
        var fn = buildHandler();
        fn(ev);
        assert.equal(ev.__pdCalled, 1, 'plain keys are still intercepted');
        assert.equal(el.value, '100a', 'the rebuild must append the typed char');
        assert.deepEqual(el.__calls.setAttribute[0], ['readonly', 'readonly'],
            'the anti-autofill readonly re-set must still run for plain keys');
        await drainTimers();
        assert.ok(el.__calls.removeAttribute.indexOf('readonly') > -1, 'the readonly dance must complete');
        assert.deepEqual(fn.__setCaretCalls, [4], 'caret restored after the typed char');
    });

    it('02.5 - a plain printable key replaces an active selection', function () {
        var el = makeEl('100', 0, 3);
        var ev = makeEvent(el, 88, 'x', {});
        buildHandler()(ev);
        assert.equal(el.value, 'x', 'selection replace must keep working');
    });

    it('02.6 - Backspace still rebuilds', function () {
        var el = makeEl('100', 3, 3);
        var ev = makeEvent(el, 8, 'Backspace', {});
        buildHandler()(ev);
        assert.equal(el.value, '10');
    });
});

// ============================================================================
// 03 — pre-fix subtract (#B134): the shapes the bail replaces
// ============================================================================

describe('03 - #B134 subtract: the PRE-fix shapes typed chords / dead-ended paste', function () {

    // PRE-fix printable branch (no modifier check) — kept ONLY to demonstrate
    // the defect the bail removes.
    function preFixPrintableBranch(e) {
        var $_el = e.currentTarget;
        var str = $_el.value;
        var posStart = $_el.selectionStart, posEnd = $_el.selectionEnd;
        if (e.key.length > 1) { return; }
        if (posStart != posEnd) {
            $_el.value = str.substring(0, posStart) + e.key;
            if (posEnd - 1 < str.length) {
                $_el.value += str.substring(posEnd);
            }
        } else if (posStart == 0) {
            $_el.value = e.key + str.substring(posStart);
        } else {
            $_el.value = str.substring(0, posStart) + e.key + str.substring(posEnd);
        }
    }

    it('03.1 - pre-fix, Cmd+A typed the chord letter into the field', function () {
        var el = makeEl('100', 3, 3);
        preFixPrintableBranch(makeEvent(el, 65, 'a', { metaKey: true }));
        assert.equal(el.value, '100a', 'the pre-fix branch had no modifier check — this is the reported defect');
    });

    it('03.2 - the REAL post-fix handler no longer does (same input)', function () {
        var el = makeEl('100', 3, 3);
        buildHandler()(makeEvent(el, 65, 'a', { metaKey: true }));
        assert.equal(el.value, '100', 'the bail is load-bearing');
    });
});

// ============================================================================
// 04 — dist fidelity (#B134) — validated red-first against the pre-fix bundle
// ============================================================================

describe('04 - #B134 dist fidelity: the built bundle carries the bail, not the dead paste', function () {

    it('04.1 - gina.min.js carries the minified bail shape', function () {
        // Property names survive Closure SIMPLE mode; locals are renamed and
        // the early-return is De-Morganed into an inverted guard wrapping the
        // handler body (measured: `if(!A.metaKey&&!A.ctrlKey){A.preventDefault()`),
        // so accept both encodings of the same invariant. Pre-fix artifact: 0
        // occurrences of either (metaKey/ctrlKey were absent from the bundle).
        assert.match(distMin, /!?[$A-Za-z_][$\w]*\.metaKey(\|\||&&)!?[$A-Za-z_][$\w]*\.ctrlKey/,
            'the metaKey/ctrlKey chord bail must reach the minified bundle');
    });

    it('04.2 - gina.min.js no longer calls execCommand for paste', function () {
        // Closure rewrites "paste" to 'paste' — pin the single-quoted form
        // (measured on the pre-fix artifact: exactly 1 occurrence).
        assert.equal(count(distMin, "execCommand('paste')"), 0,
            'the dead keyboard-paste re-implementation must be out of the shipped bundle');
    });

    it('04.3 - unminified gina.js carries the literal bail', function () {
        assert.ok(distSrc.indexOf('if ( e.metaKey || e.ctrlKey ) {') > -1);
    });

    it('04.4 - unminified gina.js has no LIVE execCommand paste', function () {
        // gina.js keeps comments — strip them so the commented-out pre-fix
        // block does not mask a live regression.
        assert.equal(count(stripComments(distSrc), 'document.execCommand("paste")'), 0);
    });
});

// ============================================================================
// 05 — #B135: the UA gate matches REAL Safari only
// ============================================================================

// The registerForLiveChecking block — end-anchored on the next declaration.
var rlcStart = mainSrc.indexOf('var registerForLiveChecking = function');
var rlcEnd = mainSrc.indexOf('var bindUploadResetOrDeleteTrigger');
var rlcSlice = (rlcStart > -1 && rlcEnd > rlcStart) ? mainSrc.substring(rlcStart, rlcEnd) : '';

// The full gate sub-expression, extracted as REAL bytes (no replica to drift).
var GATE_RE = /\/safari\/i\.test\(navigator\.userAgent\)\s*&&\s*!\/chrom\(e\|ium\)\/i\.test\(navigator\.userAgent\)/;

describe('05 - #B135 source pins + UA matrix: real-Safari-only gate', function () {

    it('05.1 - the narrowed gate exists once, inside the !isCustomEl guard, before the autocomplete read', function () {
        assert.ok(rlcStart > -1 && rlcEnd > rlcStart, 'registerForLiveChecking block not found');
        var active = stripComments(rlcSlice);
        var m = active.match(new RegExp(GATE_RE.source, 'g'));
        assert.ok(m && m.length === 1, 'the safari && !chrom(e|ium) gate must appear exactly once');
        var guardIdx = active.indexOf('if ( !isCustomEl ) {');
        var gateIdx = active.search(GATE_RE);
        var acReadIdx = active.indexOf("$el.getAttribute('autocomplete')");
        assert.ok(guardIdx > -1 && gateIdx > guardIdx, 'the gate must sit inside the !isCustomEl guard');
        assert.ok(acReadIdx > guardIdx && acReadIdx < gateIdx, 'the autocomplete read feeds the gate');
    });

    it('05.2 - the EXTRACTED gate expression classifies a real UA matrix', function () {
        var exprMatch = stripComments(rlcSlice).match(GATE_RE);
        assert.ok(exprMatch, 'gate extraction failed');
        // Execute the real bytes against each UA.
        var gate = new Function('navigator', 'return ( ' + exprMatch[0] + ' );');
        var matrix = [
            // [description, userAgent, expected]
            ['Chrome macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', false],
            ['Edge Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0', false],
            ['Opera', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0', false],
            ['HeadlessChrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36', false],
            ['Firefox desktop (no safari token)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0', false],
            ['Safari macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', true],
            ['Safari iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', true],
            // WebKit-on-iOS third-party browsers stay matched BY DESIGN — they
            // run Safari's engine, so the workaround applies.
            ['Chrome iOS (CriOS, WebKit)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1', true]
        ];
        matrix.forEach(function (row) {
            assert.equal(gate({ userAgent: row[1] }), row[2],
                row[0] + ' must ' + (row[2] ? '' : 'NOT ') + 'be intercepted');
        });
    });

    it('05.3 - subtract: the PRE-fix bare /safari/i gate matched Chromium (the defect)', function () {
        // PRE-fix predicate shape — kept ONLY to demonstrate what the fix removes.
        var preFixGate = function (navigator) { return /safari/i.test(navigator.userAgent); };
        var chromeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
        assert.equal(preFixGate({ userAgent: chromeUA }), true,
            'pre-fix, Chromium was intercepted — this is the reported mis-scope');
    });
});

// ============================================================================
// 06 — #B135 dist fidelity — validated red-first (0 pre-fix in both artifacts)
// ============================================================================

describe('06 - #B135 dist fidelity: the narrowed gate reaches the bundle', function () {

    it('06.1 - gina.min.js carries the chrom(e|ium) exclusion regex', function () {
        // Closure preserves regex literals verbatim. Pre-fix artifact: 0.
        assert.ok(count(distMin, 'chrom(e|ium)') >= 1,
            'the Chromium-exclusion regex must reach the minified bundle');
    });

    it('06.2 - unminified gina.js carries the literal narrowed gate', function () {
        assert.ok(distSrc.indexOf('!/chrom(e|ium)/i.test(navigator.userAgent)') > -1);
    });
});
