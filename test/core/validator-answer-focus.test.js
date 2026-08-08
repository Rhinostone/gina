'use strict';
/**
 * FormValidator — the one-shot answer-focus exemption (#B319)
 *
 * A refused submit ANSWERS with rendered errors plus a focus move to the first
 * invalid field (#B246/#B308 reveal, and the `validate.<id>` failure branch).
 * `.focus()` dispatches `focusin` synchronously, and the live-check listener's
 * focusin arm used to route that dispatch into `refreshWarning`, whose
 * active-element branch hid the very message the answer had just rendered.
 * The fix raises a module-scope `isAnswerFocusInProgress` flag around BOTH
 * focus loops and gates the focusin arm's `refreshWarning` call on it, cleared
 * on every exit (try/finally) so the user's next interaction re-engages the
 * deliberate mid-typing suppression untouched.
 *
 * Division of labor:
 *  - BEHAVIORAL coverage lives in test/e2e/validator-submit-answer-visibility.spec.js,
 *    which drives the REAL built bundle (gina.min.js) through real focus events —
 *    red-first validated against the pre-fix artifact (arms 01-03 red, height 1).
 *  - THIS file keeps the browserless `npm test` release gate able to detect the
 *    exemption's removal: source pins on the three edit sites plus a pin on the
 *    unminified dist artifact (gina.js), where the flag's name survives
 *    (RequireJS bundles with optimize:"none").
 *  - gina.min.js is deliberately NOT pinned here: Closure renames the flag (a
 *    local), so a min pin would have to encode a wrap-fragile structural shape
 *    for coverage the per-push e2e job already provides behaviorally.
 *
 * Every pin below was validated red-first against the pre-fix bytes
 * (git show HEAD:<path> at the fix commit's parent): each reads absent/0
 * pre-fix and present/expected-count post-fix.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var mainSrc, distSrc;

/** Occurrence count (never grep -c line semantics). */
function countOf(haystack, needle) {
    return haystack.split(needle).length - 1;
}

/** Slice between two anchors, throwing loudly when either is not unique. */
function sliceBetween(src, startAnchor, endAnchor) {
    assert.equal(countOf(src, startAnchor), 1, 'slice start anchor not unique: ' + startAnchor);
    assert.equal(countOf(src, endAnchor), 1, 'slice end anchor not unique: ' + endAnchor);
    var s = src.indexOf(startAnchor);
    var e = src.indexOf(endAnchor);
    assert.ok(s > -1 && e > s, 'slice anchors out of order');
    return src.substring(s, e);
}

before(function () {
    mainSrc = fs.readFileSync(MAIN, 'utf8');
    distSrc = fs.readFileSync(DIST, 'utf8');
});

describe('#B319 — answer-focus exemption source pins', function () {

    it('01 - the module flag is declared exactly once', function () {
        assert.equal(countOf(mainSrc, 'var isAnswerFocusInProgress = false;'), 1);
    });

    it('02 - focusFirstInvalidField raises the flag before focusing and clears it in finally', function () {
        var blk = sliceBetween(mainSrc,
            'var focusFirstInvalidField = function',
            'var revealValidationState = function');
        var setIdx   = blk.indexOf('isAnswerFocusInProgress = true;');
        var focusIdx = blk.indexOf('$field.focus();');
        var clrIdx   = blk.indexOf('isAnswerFocusInProgress = false;');
        assert.ok(setIdx > -1, 'flag raise missing');
        assert.ok(focusIdx > setIdx, 'focus() must run inside the raised window');
        assert.ok(blk.indexOf('finally', focusIdx) > -1, 'clear must be exception-safe (finally)');
        assert.ok(clrIdx > focusIdx, 'flag clear must follow the focus loop');
    });

    it('03 - the validate.<id> inline twin raises and clears the same flag', function () {
        var blk = sliceBetween(mainSrc,
            "var _a11yErrs = result['fields'] || result['error']",
            'var bindSubmitEl = function');
        var setIdx   = blk.indexOf('isAnswerFocusInProgress = true;');
        var focusIdx = blk.indexOf('_aField.focus();');
        var clrIdx   = blk.indexOf('isAnswerFocusInProgress = false;');
        assert.ok(setIdx > -1, 'flag raise missing at the twin');
        assert.ok(focusIdx > setIdx, 'twin focus() must run inside the raised window');
        assert.ok(blk.indexOf('finally', focusIdx) > -1, 'twin clear must be exception-safe (finally)');
        assert.ok(clrIdx > focusIdx, 'twin flag clear must follow its loop');
    });

    it('04 - the focusin arm gates refreshWarning on the flag', function () {
        var anchor = '/^focusin\\./i.test(event.type)';
        assert.equal(countOf(mainSrc, anchor), 1, 'focusin arm anchor not unique');
        var armIdx  = mainSrc.indexOf(anchor);
        var gateIdx = mainSrc.indexOf('!isAnswerFocusInProgress', armIdx);
        var callIdx = mainSrc.indexOf('refreshWarning($el)', armIdx);
        assert.ok(gateIdx > armIdx, 'gate conjunct missing after the focusin arm');
        assert.ok(callIdx > gateIdx, 'the gate must precede the refreshWarning call it guards');
    });

    it('05 - exactly two raise sites and two clear sites exist (no third focus path adopted the flag silently)', function () {
        assert.equal(countOf(mainSrc, 'isAnswerFocusInProgress = true;'), 2);
        assert.equal(countOf(mainSrc, 'isAnswerFocusInProgress = false;'), 3,
            'declaration (= false;) + two finally clears');
    });

    it('06 - the unminified dist artifact carries the exemption (gina.js, names survive optimize:"none")', function () {
        assert.equal(countOf(distSrc, 'var isAnswerFocusInProgress = false;'), 1);
        assert.equal(countOf(distSrc, 'isAnswerFocusInProgress = true;'), 2);
        assert.ok(countOf(distSrc, '!isAnswerFocusInProgress') >= 1, 'focusin gate missing from dist');
    });

});
