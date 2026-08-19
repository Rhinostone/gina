'use strict';
/**
 * FormValidator — the answer-focus HOLD, the asynchronous continuation of the
 * one-shot #B319 exemption (#B387)
 *
 * On an async-`query` form with a committed error, a refused submit's answer
 * is rendered and focused — and then CLIPPED ~0.2ms later when the click
 * lands inside the undrained completion tail of the previous settle: a stale
 * live-check waiter (or the trailing silent global re-validation) wakes
 * INSIDE the click's cascade and runs the display-refresh pair. Both hide
 * sites key on the SAME heuristic — "the field is the active element, so the
 * user is editing it":
 *   - `refreshWarning`'s error->warning downgrade appends ` hidden` to the
 *     message div;
 *   - `handleErrorsDisplay`'s refresh branch REMOVES the message div and
 *     re-creates it born-hidden (the active-element ternary).
 * The answer's own focus move (#B319) is what makes the field active, and the
 * one-shot `isAnswerFocusInProgress` flag only covers the SYNCHRONOUS focusin
 * dispatched inside `.focus()` — the async completion callers arrive after
 * its `finally` cleared it (measured: `isValidating` false at both parent
 * writes, no focusin-arm suppression logged in any red run).
 *
 * The fix — focus PROVENANCE, one primitive, two consults:
 *   - `answerFocusHold` ({formId, elName}, single slot — only one active
 *     element exists) is SET where the answer's focus lands: the confirmed-
 *     focus points of `focusFirstInvalidField` and the `validate.<id>` inline
 *     twin (both already inside #B319 windows);
 *   - CONSULTED by both hide sites (`!isAnswerFocusHeldFor(...)`), for ANY
 *     caller, sync or async, stale or fresh — which is why provenance beats a
 *     pass-generation latch: the trailing global re-validation is a FRESH
 *     pass spawned inside the click cascade and would sail through any
 *     staleness check, yet it keys its hide on the active element all the
 *     same;
 *   - RELEASED on the first genuine user interaction: any TRUSTED native
 *     event reaching one of the seven form proxy handlers while the one-shot
 *     flag is down. No timers. The deliberate mid-typing suppression
 *     re-engages the moment the user actually edits (e2e arm 04 is the
 *     standing subtract control for exactly that).
 *
 * Division of labor (the #B319 pattern):
 *  - BEHAVIORAL choreography lives in
 *    test/e2e/validator-submit-answer-visibility.spec.js §02, which drives
 *    the REAL built bundle through the real cascade (its ~1/20 CI red with
 *    signature `Received: 1` + msgClass `hidden` IS this defect — the #B385
 *    verdict).
 *  - THIS file keeps the browserless `npm test` release gate able to detect
 *    the hold's removal: source pins on every edit site, plus extracted-real-
 *    bytes behavioral arms (comment-stripped brace walk / anchored slices —
 *    no replica to drift) driving `refreshWarning`, the re-create ternary,
 *    and the release helper against fake scenes.
 *  - The unminified dist artifact (gina.js, names survive optimize:"none")
 *    is pinned; gina.min.js is deliberately NOT pinned (Closure renames the
 *    locals; the per-push e2e job covers the built bundle behaviorally).
 *
 * Comment-strip note: the fix's own `// was:` lines carry an unmatched `{`
 * (the #B353 own-comment trap), so every extraction below strips
 * `//`-comment lines BEFORE walking or slicing — the stripped text is what
 * executes, and comments are inert there.
 *
 * Red-first: every pin and both defect-facing behavioral arms were validated
 * against the pre-fix bytes (`git show <parent>:<path>`): pins read absent/0,
 * the extracted pre-fix `refreshWarning` HID the message in the answer scene
 * (the defect), and the pre-fix ternary produced the born-hidden class.
 *
 * Run: node --test test/core/validator-answer-focus-hold.test.js
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var mainSrc, distSrc, activeSrc;

/** Occurrence count (never grep -c line semantics). */
function countOf(haystack, needle) {
    return haystack.split(needle).length - 1;
}

/** Strip `//`-comment lines — the replace-code convention leaves brace-bearing `// was:` lines. */
function stripLineComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*\/\//.test(l);
    }).join('\n');
}

/**
 * Started-flag brace walk from a unique declaration (comment-stripped input).
 * Throws loudly on a non-unique decl or an unbalanced walk — an extraction
 * that silently matched twice, or ran off the end, is not a control.
 */
function extractFn(src, decl) {
    assert.equal(countOf(src, decl), 1, 'decl not unique: ' + decl);
    var i = src.indexOf(decl);
    var depth = 0, started = false, j = i;
    while (j < src.length) {
        var c = src[j];
        if (c === '{') { depth++; started = true; }
        else if (c === '}') {
            depth--;
            if (started && depth === 0) break;
        }
        j++;
    }
    assert.ok(started && depth === 0 && j < src.length, 'unbalanced walk for: ' + decl);
    return src.substring(i, j + 1);
}

/** Slice between two anchors, throwing loudly when either is not unique. */
function sliceBetween(src, startAnchor, endAnchor) {
    assert.equal(countOf(src, startAnchor), 1, 'slice start anchor not unique: ' + startAnchor);
    var s = src.indexOf(startAnchor);
    var e = src.indexOf(endAnchor, s + startAnchor.length);
    assert.ok(e > s, 'slice end anchor not found after start: ' + endAnchor);
    return src.substring(s, e);
}

before(function () {
    mainSrc   = fs.readFileSync(MAIN, 'utf8');
    distSrc   = fs.readFileSync(DIST, 'utf8');
    activeSrc = stripLineComments(mainSrc);
});

// ============================================================================
// 1. Source pins — every edit site, anchored on what a regression would remove
// ============================================================================
describe('#B387 — source pins', function () {

    it('01 - the hold slot and both helpers are declared exactly once', function () {
        assert.equal(countOf(mainSrc, 'var answerFocusHold = null;'), 1);
        assert.equal(countOf(mainSrc, 'var isAnswerFocusHeldFor = function(formId, elName) {'), 1);
        assert.equal(countOf(mainSrc, 'var releaseAnswerFocusHold = function(event) {'), 1);
    });

    it('02 - exactly two set sites, one inside each answer-focus loop, each before its exit', function () {
        assert.equal(countOf(mainSrc, 'answerFocusHold = { formId:'), 2, 'set-site count');

        var ffif = sliceBetween(mainSrc,
            'var focusFirstInvalidField = function',
            'var revealValidationState = function');
        var setIdx = ffif.indexOf('answerFocusHold = { formId: $form.getAttribute(');
        assert.ok(setIdx > -1, 'focusFirstInvalidField set site missing');
        assert.ok(ffif.indexOf('return true;', setIdx) > setIdx, 'set must precede the confirmed-focus return');

        var twin = sliceBetween(mainSrc,
            "var _a11yErrs = result['fields'] || result['error']",
            'var bindSubmitEl = function');
        var twinSet = twin.indexOf('answerFocusHold = { formId: $a11yForm.getAttribute(');
        assert.ok(twinSet > -1, 'validate.<id> twin set site missing');
        assert.ok(twin.indexOf('break;', twinSet) > twinSet, 'twin set must precede the confirmed-focus break');
    });

    it('03 - refreshWarning\'s downgrade branch consults the hold after the active-element comparison', function () {
        var fn = extractFn(activeSrc, 'var refreshWarning = function($el) {');
        var cmpIdx  = fn.indexOf('currentElName == elName');
        var gateIdx = fn.indexOf('!isAnswerFocusHeldFor(formId, elName)');
        var hideIdx = fn.indexOf('isErrorMessageHidden = true;');
        assert.ok(cmpIdx > -1, 'active-element comparison missing');
        assert.ok(gateIdx > cmpIdx, 'the provenance consult must ride the downgrade condition');
        assert.ok(hideIdx > gateIdx, 'the consult must precede the hide it guards');
    });

    it('04 - the handleErrorsDisplay re-create ternary consults the hold (companion pin to validator-livecheck-message-blur)', function () {
        assert.match(
            mainSrc,
            /document\.activeElement\.name\s*==\s*name\s*&&\s*!isAnswerFocusHeldFor\(id,\s*name\)\s*\)\s*\?\s*'form-item-error-message hidden'/,
            'the born-hidden re-create must be provenance-gated'
        );
    });

    it('05 - all seven proxy handlers release the hold at their head', function () {
        assert.equal(countOf(mainSrc, 'releaseAnswerFocusHold(event); // #B387'), 7, 'release call-site count');
        var handlers = ['reset', 'keydown', 'keyup', 'focusin', 'focusout', 'change', 'click'];
        for (var h = 0; h < handlers.length; h++) {
            var decl = 'var ' + handlers[h] + 'ProxyHandler = function(event) {';
            assert.equal(countOf(mainSrc, decl), 1, 'proxy decl not unique: ' + handlers[h]);
            var idx = mainSrc.indexOf(decl);
            var rel = mainSrc.indexOf('releaseAnswerFocusHold(event);', idx);
            assert.ok(rel > idx && rel - idx < 200,
                handlers[h] + 'ProxyHandler must release the hold at its head');
        }
    });

    it('06 - the release helper is trusted-only and defers to the one-shot flag', function () {
        var fn = extractFn(activeSrc, 'var releaseAnswerFocusHold = function(event) {');
        assert.ok(fn.indexOf('event.isTrusted') > -1, 'trusted-only guard missing');
        assert.ok(fn.indexOf('!isAnswerFocusInProgress') > -1, 'one-shot-flag guard missing');
        assert.ok(fn.indexOf('answerFocusHold = null;') > -1, 'release write missing');
    });

});

// ============================================================================
// 2. Behavioral — the extracted REAL bytes, driven through the answer scene
// ============================================================================
describe('#B387 — extracted refreshWarning behavior', function () {

    /** Fake field + parent + message div in the committed-error answer state. */
    function answerScene(fieldName, formId) {
        var msg = {
            className: 'form-item-error-message',
            parentElement: null
        };
        var parent = {
            className: 'form-item-error',
            getElementsByTagName: function (tag) {
                return tag === 'div' ? [msg] : [];
            }
        };
        msg.parentElement = parent;
        var form = {
            id: formId,
            getAttribute: function (k) { return k === 'id' ? formId : null; }
        };
        var el = { name: fieldName, form: form, parentNode: parent };
        return { el: el, parent: parent, msg: msg };
    }

    function makeRefreshWarning(heldFor, activeName, formId) {
        var fnSrc = extractFn(activeSrc, 'var refreshWarning = function($el) {')
            .replace(/^var refreshWarning = /, '');
        var instance = { $forms: {} };
        instance.$forms[formId] = { isValidating: false };
        var fakeDoc = { activeElement: { name: activeName } };
        var clips = [], reveals = [];
        var factory = new Function(
            'instance', 'document', 'clipErrorMessage', 'revealErrorMessage', 'isAnswerFocusHeldFor',
            'return (' + fnSrc + ');'
        );
        return factory(
            instance, fakeDoc,
            function (n) { clips.push(n); },
            function (n) { reveals.push(n); },
            function (fId, elName) { return heldFor !== null && fId === formId && elName === heldFor; }
        );
    }

    it('07 - answer scene, hold LIVE: the downgrade is skipped — the answer stays rendered', function () {
        var scene = answerScene('note', 'parent');
        var refreshWarning = makeRefreshWarning('note', 'note', 'parent');
        refreshWarning(scene.el);
        assert.equal(scene.parent.className, 'form-item-error',
            'the committed-error border must survive an async display refresh while the hold names the field');
        assert.ok(!/\bhidden\b/.test(scene.msg.className),
            'the answer message must NOT be hidden by a completion firing after the one-shot window');
    });

    it('08 - answer scene, hold RELEASED: the classic mid-typing suppression fires (the control that can fail)', function () {
        var scene = answerScene('note', 'parent');
        var refreshWarning = makeRefreshWarning(null, 'note', 'parent');
        refreshWarning(scene.el);
        assert.equal(scene.parent.className, 'form-item-warning',
            'without the hold, the active-element downgrade must still fire — the deliberate suppression is untouched');
        assert.ok(/\bhidden\b/.test(scene.msg.className),
            'without the hold, the message hides while the field is being edited');
    });

    it('09 - hold names a DIFFERENT field: the downgrade fires normally', function () {
        var scene = answerScene('note', 'parent');
        var refreshWarning = makeRefreshWarning('email', 'note', 'parent');
        refreshWarning(scene.el);
        assert.equal(scene.parent.className, 'form-item-warning');
        assert.ok(/\bhidden\b/.test(scene.msg.className));
    });

});

describe('#B387 — extracted re-create ternary behavior', function () {

    function ternaryDecision(activeName, fieldName, formId, heldFor) {
        var line = sliceBetween(mainSrc,
            "$err.setAttribute('class', ( document.activeElement && document.activeElement.name == name && !isAnswerFocusHeldFor(id, name) )",
            ");");
        var expr = line.replace("$err.setAttribute('class', ", '');
        var fn = new Function('document', 'name', 'id', 'isAnswerFocusHeldFor', 'return (' + expr + ');');
        return fn(
            { activeElement: activeName ? { name: activeName } : null },
            fieldName, formId,
            function (fId, elName) { return heldFor !== null && fId === formId && elName === heldFor; }
        );
    }

    it('10 - active field + hold LIVE: the re-created message is born VISIBLE', function () {
        assert.equal(ternaryDecision('note', 'note', 'parent', 'note'), 'form-item-error-message');
    });

    it('11 - active field, hold RELEASED: born hidden (the mid-typing contract — the control)', function () {
        assert.equal(ternaryDecision('note', 'note', 'parent', null), 'form-item-error-message hidden');
    });

    it('12 - inactive field: born visible regardless of the hold', function () {
        assert.equal(ternaryDecision('email', 'note', 'parent', 'note'), 'form-item-error-message');
        assert.equal(ternaryDecision(null, 'note', 'parent', null), 'form-item-error-message');
    });

});

describe('#B387 — extracted hold lifecycle (declaration + helpers, one scope)', function () {

    /**
     * Evaluate the shipped declaration + both helpers in ONE scope, with the
     * one-shot flag injected per instantiation and a probe API returned.
     */
    function makeHoldScope(oneShotFlagUp) {
        var declLine = 'var answerFocusHold = null;';
        assert.equal(countOf(activeSrc, declLine), 1);
        var held    = extractFn(activeSrc, 'var isAnswerFocusHeldFor = function(formId, elName) {');
        var release = extractFn(activeSrc, 'var releaseAnswerFocusHold = function(event) {');
        var factory = new Function('isAnswerFocusInProgress',
            declLine + '\n' + held + ';\n' + release + ';\n' +
            'return { held: isAnswerFocusHeldFor, release: releaseAnswerFocusHold,' +
            ' set: function (v) { answerFocusHold = v; },' +
            ' get: function () { return answerFocusHold; } };');
        return factory(oneShotFlagUp);
    }

    it('13 - a trusted event releases the hold; the next consult reads not-held', function () {
        var scope = makeHoldScope(false);
        scope.set({ formId: 'parent', elName: 'note' });
        assert.equal(scope.held('parent', 'note'), true);
        scope.release({ isTrusted: true });
        assert.equal(scope.get(), null);
        assert.equal(scope.held('parent', 'note'), false);
    });

    it('14 - an untrusted (framework-internal) event does NOT release it', function () {
        var scope = makeHoldScope(false);
        scope.set({ formId: 'parent', elName: 'note' });
        scope.release({ isTrusted: false });
        assert.deepEqual(scope.get(), { formId: 'parent', elName: 'note' });
    });

    it('15 - the answer\'s own synchronous focusin (trusted, one-shot flag up) does NOT release it', function () {
        var scope = makeHoldScope(true);
        scope.set({ formId: 'parent', elName: 'note' });
        scope.release({ isTrusted: true });
        assert.deepEqual(scope.get(), { formId: 'parent', elName: 'note' });
    });

    it('16 - the consult is exact: same name on another form is NOT held', function () {
        var scope = makeHoldScope(false);
        scope.set({ formId: 'parent', elName: 'note' });
        assert.equal(scope.held('other', 'note'), false);
        assert.equal(scope.held('parent', 'email'), false);
    });

});

// ============================================================================
// 3. Dist fidelity — unminified artifact only (the #B319 precedent)
// ============================================================================
describe('#B387 — dist pins (gina.js, names survive optimize:"none")', function () {

    it('17 - the hold, both helpers, both consults and all seven releases reached the bundle', function () {
        assert.equal(countOf(distSrc, 'var answerFocusHold = null;'), 1);
        assert.equal(countOf(distSrc, 'var isAnswerFocusHeldFor = function(formId, elName) {'), 1);
        assert.equal(countOf(distSrc, 'var releaseAnswerFocusHold = function(event) {'), 1);
        assert.equal(countOf(distSrc, '!isAnswerFocusHeldFor(formId, elName)'), 1, 'refreshWarning consult');
        assert.equal(countOf(distSrc, '!isAnswerFocusHeldFor(id, name)'), 1, 'ternary consult');
        assert.equal(countOf(distSrc, 'releaseAnswerFocusHold(event); // #B387'), 7, 'proxy releases');
        assert.equal(countOf(distSrc, 'answerFocusHold = { formId:'), 2, 'set sites');
    });

});
