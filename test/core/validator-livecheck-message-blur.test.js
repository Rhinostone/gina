'use strict';
/**
 * FormValidator — live-check error message hidden while typing, revealed on blur
 *
 * While a field is the active element (being typed in), live-check surfaces only the soft
 * `form-item-warning` border; the committed error MESSAGE stays hidden, and is revealed on blur
 * (focusout commits `form-item-warning` -> `form-item-error`).
 *
 * Root cause of the prior "message shown while typing" bug: `handleErrorsDisplay`'s "refresh"
 * branch (the `errAttr` / `data-gina-form-errors` path) REMOVES the existing message div and
 * RE-CREATES it shown on every live-check re-validation. Because `data-gina-form-errors` is set on
 * every browser validation, and this branch runs in the live-check global pass (after refreshWarning),
 * it re-showed the message mid-typing regardless of any earlier hide. The fix makes that re-create
 * focus-aware: the message is created hidden while the field is the active element, shown otherwise.
 *
 * (A first attempt guarded `refreshWarning`'s un-hide instead; that was insufficient — the refresh
 * branch overrode it — and was reverted. The real fix is at the refresh re-create.)
 *
 * Strategy (same convention as validator-aria-invalid / validator-form-reassociation):
 *  - a test-local replica of the refresh-branch message-class decision over the focused/blurred cases;
 *  - a subtract test reproducing the pre-fix (always-shown) behaviour, so the suite distinguishes fix from bug;
 *  - a source-inspection block pinning the production guard so the replica cannot drift.
 *
 * Verified live in a browser-rendered form: a focused field shows the warning border with its message
 * hidden; on blur the field becomes form-item-error and the message becomes visible.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var { JSDOM } = require('jsdom');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');

var mainSrc;

before(function () {
    mainSrc = fs.readFileSync(MAIN, 'utf8');
});


// Replica of the refresh-branch message-class decision (main.js, handleErrorsDisplay "refresh" branch):
// hidden while THIS field is the active element, shown otherwise.
function refreshMsgClass(activeName, fieldName) {
    return ( activeName && activeName == fieldName ) ? 'form-item-error-message hidden' : 'form-item-error-message';
}

// Pre-fix replica: the refresh branch always created the message shown (no focus guard).
function refreshMsgClass_preFix() {
    return 'form-item-error-message';
}

function isHidden(cls) {
    return /\bhidden\b/.test(cls);
}


describe('FormValidator — live-check message hidden while typing, shown on blur', function () {

    var dom, doc;
    before(function () {
        dom = new JSDOM('<!doctype html><html><body></body></html>');
        doc = dom.window.document;
    });

    it('focused field (active == field): refresh re-create HIDES the message — no yelling while typing', function () {
        var $err = doc.createElement('div');
        $err.setAttribute('class', refreshMsgClass('email', 'email'));
        assert.ok(isHidden($err.className), 'message must be hidden while the field is being typed in');
    });

    it('blurred field (active != field): refresh re-create SHOWS the message — committed on blur', function () {
        var $err = doc.createElement('div');
        $err.setAttribute('class', refreshMsgClass('name', 'email'));
        assert.ok(!isHidden($err.className), 'leaving the field reveals the error message');
    });

    it('no active field (active == null / body has no name): message is SHOWN', function () {
        var $err = doc.createElement('div');
        $err.setAttribute('class', refreshMsgClass(null, 'email'));
        assert.ok(!isHidden($err.className));
    });

    it('subtract-the-fix: the pre-fix refresh branch always created the message shown (reproduces the bug)', function () {
        var $err = doc.createElement('div');
        $err.setAttribute('class', refreshMsgClass_preFix());
        assert.ok(!isHidden($err.className), 'pre-fix: message was shown even while the field was focused');
        var $err2 = doc.createElement('div');
        $err2.setAttribute('class', refreshMsgClass('email', 'email'));
        assert.ok(isHidden($err2.className), 'post-fix: the same focused case hides the message');
    });


    // --- Source-inspection: pin the production guard so the replica cannot silently drift ---
    describe('source pins (main.js handleErrorsDisplay refresh branch)', function () {

        it('the refresh re-create makes the message class focus-aware', function () {
            assert.match(
                mainSrc,
                /document\.activeElement\.name\s*==\s*name\s*\)\s*\?\s*'form-item-error-message hidden'\s*:\s*'form-item-error-message'/,
                'the refresh branch must create the error message hidden while the field is the active element'
            );
        });
    });
});
