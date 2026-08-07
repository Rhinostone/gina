'use strict';
/**
 * FormValidator — submit-trigger state uses the gated marker, not any disabled vocabulary
 *
 * When a live-check-enabled form is invalid, `updateSubmitTriggerState` marks the submit trigger
 * with `data-gina-form-submit-gated="true"` + the class `gina-form-submit-disabled` (#B312) —
 * NEITHER the native `disabled` property NOR an ARIA disabled claim. A natively-disabled <button>
 * emits no click event, so the form-level click -> validate -> show-all-errors -> focus-first
 * guard (the `validate.<id>` listener) never fires and the button is a dead no-op with zero
 * feedback; and an ARIA disabled claim would be dishonest for a control the #B246 gate answers
 * with a reveal. The gated marker keeps the trigger genuinely operable: the click is intercepted
 * and answered with the display-only reveal, while `isValid()` (the real gate in the
 * `validate.<id>` guard) blocks every send. `aria-disabled` is left to AUTHORED marks (enforced,
 * never framework-cleared) and the anchor in-flight lock in send().
 *
 * The SHOW branch (form valid, or live-check off) KEEPS clearing native `disabled` so a trigger
 * rendered `<button disabled>` in markup still enables. The change is tag-agnostic — it works for
 * both <button> and <a> submit triggers (an <a>'s `.disabled` is a harmless expando).
 *
 * Strategy (same convention as validator-aria-invalid / validator-livecheck-message-blur):
 *  - test-local replicas of `updateSubmitTriggerState`'s SHOW/HIDE branches and the `validate.<id>`
 *    guard body, driven against a real jsdom DOM (`updateSubmitTriggerState` is a closure-private
 *    fn inside `ValidatorPlugin` and cannot be instantiated in node:test — see architecture doc §9);
 *  - a subtract test reproducing the pre-fix native-disable so the suite distinguishes fix from bug;
 *  - a source-inspection block pinning the shipped branch shape so the replicas cannot drift.
 *
 * Note on the subtract: jsdom does NOT model a real browser's "a disabled control emits no click"
 * activation behaviour (it dispatches click on disabled buttons), so the bug is asserted via the
 * disabled STATE the pre-fix left behind — that native-disabled state is exactly what suppresses
 * the click in a real browser. Verified live in a browser-rendered form.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var { JSDOM } = require('jsdom');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');

var mainSrc;
before(function () { mainSrc = fs.readFileSync(MAIN, 'utf8'); });


// --- Replica of updateSubmitTriggerState's branch (main.js `updateSubmitTriggerState`) ---
// `$form` is the <form> node; `$form.dataset.ginaFormLiveCheckEnabled` mirrors the production
// read `$formInstance.target.dataset.ginaFormLiveCheckEnabled`. Source pins (§06) keep this honest.
function applySubmitTriggerState($form, $trigger, isFormValid) {
    if ( /^true$/i.test(isFormValid) || !/^(true)$/i.test($form.dataset.ginaFormLiveCheckEnabled) ) { // show
        $trigger.disabled = false;
        $trigger.removeAttribute('data-gina-form-submit-gated');
        $trigger.classList.remove('gina-form-submit-disabled');
    } else { // hide — gated: marked not-ready, still operable, NOT native-disabled
        $trigger.setAttribute('data-gina-form-submit-gated', 'true');
        $trigger.classList.add('gina-form-submit-disabled');
    }
}

// Pre-fix replica: the invalid path natively disabled the trigger (which kills the click).
function applySubmitTriggerState_preFix($form, $trigger, isFormValid) {
    if ( /^true$/i.test(isFormValid) || !/^(true)$/i.test($form.dataset.ginaFormLiveCheckEnabled) ) {
        $trigger.disabled = false;
    } else {
        $trigger.disabled = true; // OLD: native disable -> no click event -> no feedback
    }
}

// Replica of the validate.<id> guard body (main.js): render errors unconditionally, send only when
// result.isValid(), else focus the first invalid field in DOM order (skip hidden/unfocusable).
function runSubmitGuard($formNode, result, sendSpy) {
    var errs = result['fields'] || result['error'];
    displayFieldErrors($formNode, errs); // mirrors handleErrorsDisplay marking the invalid fields
    if ( typeof(result['isValid']) != 'undefined' && result['isValid']() ) { // send if valid
        sendSpy(result['data']);
    } else { // failed submit: focus the first invalid field
        if (errs) {
            for (var i = 0, len = $formNode.length; i < len; ++i) {
                var f = $formNode[i], n = f.getAttribute('name');
                if ( n && typeof(errs[n]) != 'undefined'
                     && ( typeof(errs[n].count) != 'function' || errs[n].count() > 0 )
                     && f.type != 'hidden' && typeof(f.focus) == 'function' ) {
                    f.focus();
                    break;
                }
            }
        }
    }
}

// Replica of the #B246 click path (main.js clickProxyHandler). A trigger marked disabled is
// INTERCEPTED and answered with a display-only reveal — errors rendered + first invalid field
// focused — and the submit cycle (bindSubmitEl -> validate -> validate.<id> -> isValid() ->
// send) is never entered. An enabled trigger falls through to the normal cycle.
function runClickOnTrigger($formNode, $trigger, result, spies) {
    // Mirrors isTriggerDisabled (#B293 nativeCounts guard + the aria and gated arms —
    // the pre-#B293 replica shape here was a documented drift, realigned with #B312).
    var nativeCounts = !('disabled' in $trigger);
    var isDisabled = ( nativeCounts
                       && $trigger.getAttribute('disabled') != null && $trigger.getAttribute('disabled') != 'false' )
                     || $trigger.getAttribute('aria-disabled') == 'true'
                     || $trigger.getAttribute('data-gina-form-submit-gated') == 'true';
    if (isDisabled) {
        var errs = result['fields'] || result['error'];
        displayFieldErrors($formNode, errs);
        if (errs) {
            for (var i = 0, len = $formNode.length; i < len; ++i) {
                var f = $formNode[i], n = f.getAttribute('name');
                if ( n && typeof(errs[n]) != 'undefined'
                     && ( typeof(errs[n].count) != 'function' || errs[n].count() > 0 )
                     && f.type != 'hidden' && typeof(f.focus) == 'function' ) { f.focus(); break; }
            }
        }
        return 'intercepted';
    }
    spies.submitCycle();
    runSubmitGuard($formNode, result, spies.send);
    return 'submitted';
}

// minimal error-marker (the full handleErrorsDisplay renderer is locked by validator-aria-invalid)
function displayFieldErrors($formNode, errs) {
    if (!errs) return;
    for (var i = 0, len = $formNode.length; i < len; ++i) {
        var f = $formNode[i], n = f.getAttribute('name');
        if ( n && typeof(errs[n]) != 'undefined' && f.parentNode ) {
            f.parentNode.classList.add('form-item-error');
        }
    }
}


// --- Fixtures (framework-generic markup) ---
function makeForm(liveCheck, triggerHtml) {
    var dom = new JSDOM('<!doctype html><html><body>' +
        '<form id="parent" data-gina-form-live-check-enabled="' + liveCheck + '">' +
            '<div class="form-item"><input name="myField" id="myField" type="text"></div>' +
            triggerHtml +
        '</form></body></html>');
    var doc = dom.window.document;
    return {
        window  : dom.window,
        document: doc,
        form    : doc.getElementById('parent'),
        field   : doc.getElementById('myField'),
        trigger : doc.getElementById('parentSubmit')
    };
}
var BUTTON          = '<button id="parentSubmit" type="submit">Send</button>';
var BUTTON_DISABLED = '<button id="parentSubmit" type="submit" disabled>Send</button>';
var ANCHOR          = '<a id="parentSubmit" data-gina-form-submit="true" href="#">Send</a>';


// 01 - HIDE branch: invalid + live-on -> gated marker + class, native .disabled stays false
describe('01 - invalid + live-check on: gated marker, native .disabled stays false', function () {
    it('sets data-gina-form-submit-gated="true" + the class and does NOT natively disable', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, false); // invalid
        assert.equal(ctx.trigger.getAttribute('data-gina-form-submit-gated'), 'true');
        assert.ok(ctx.trigger.classList.contains('gina-form-submit-disabled'));
        assert.equal(ctx.trigger.disabled, false, 'the button stays operable (no native disable)');
        assert.equal(ctx.trigger.getAttribute('aria-disabled'), null,
            '#B312: no ARIA claim from the gate — aria-disabled belongs to authors and the in-flight lock');
    });
});


// 02 - a disabled trigger still RECEIVES the click (that is what aria-disabled buys over native
//      disable, which emits nothing), but #B246 intercepts it: errors are revealed and focus
//      moves, while the submit cycle is never entered. An enabled trigger is unaffected.
describe('02 - disabled trigger: click received then intercepted — errors shown, focus first invalid, NO submit cycle', function () {
    it('a gated (not native-disabled) button still emits a click, so the guard can answer it', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, false);
        var clicks = 0;
        ctx.trigger.addEventListener('click', function (e) { e.preventDefault(); clicks++; });
        ctx.trigger.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true }));
        assert.ok(clicks >= 1, 'an operable trigger fires the click that lets the form-level guard run');
    });

    it('#B246 - a click on a DISABLED trigger is intercepted: no submit cycle, no send', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, false); // invalid -> gated marker
        var sent = [], cycles = 0;
        var result = {
            fields : { myField: { isRequired: 'Cannot be left empty' } },
            data   : { myField: '' },
            isValid: function () { return false; }
        };
        var outcome = runClickOnTrigger(ctx.form, ctx.trigger, result,
            { send: function (d) { sent.push(d); }, submitCycle: function () { cycles++; } });

        assert.equal(outcome, 'intercepted');
        assert.equal(cycles, 0, 'the submit cycle is never entered from a disabled trigger');
        assert.equal(sent.length, 0, 'nothing is sent');
        assert.ok(ctx.field.parentNode.classList.contains('form-item-error'), 'errors are still revealed');
        assert.equal(ctx.document.activeElement, ctx.field, 'focus still moves to the first invalid field');
    });

    it('#B246 control - an ENABLED trigger still runs the submit cycle and sends when valid', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, true); // valid -> marker cleared
        var sent = [], cycles = 0;
        var result = { fields: null, data: { myField: 'ok' }, isValid: function () { return true; } };
        var outcome = runClickOnTrigger(ctx.form, ctx.trigger, result,
            { send: function (d) { sent.push(d); }, submitCycle: function () { cycles++; } });

        assert.equal(outcome, 'submitted');
        assert.equal(cycles, 1, 'the submit cycle DOES run for an enabled trigger');
        assert.equal(sent.length, 1, 'and a valid form sends (this control fails if the guard over-fires)');
    });

    it('the guard displays field errors, focuses the first invalid field, and does NOT send', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, false);
        var sent = [];
        var result = {
            fields : { myField: { isRequired: 'Cannot be left empty' } },
            data   : { myField: '' },
            isValid: function () { return false; }
        };
        runSubmitGuard(ctx.form, result, function (d) { sent.push(d); });
        assert.equal(sent.length, 0, 'an invalid form must not send');
        assert.ok(ctx.field.parentNode.classList.contains('form-item-error'), 'the field error is displayed');
        assert.equal(ctx.document.activeElement, ctx.field, 'focus moved to the first invalid field');
    });

    it('a valid form DOES send once the guard runs (control for the no-send assertion)', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, true);
        var sent = [];
        var result = { fields: null, data: { myField: 'ok' }, isValid: function () { return true; } };
        runSubmitGuard(ctx.form, result, function (d) { sent.push(d); });
        assert.equal(sent.length, 1, 'a valid form sends');
    });

    it('the marker serializes as a data attribute, never as native disabled (#B308 retired the DOMParser proxy guard this used to shield)', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, false);
        // Serialization contract: updateSubmitTriggerState writes the gated marker + the
        // class, never the native property, so an innerHTML round-trip carries the
        // marker as an attribute only. (#B308 note: the submit proxy's old DOMParser
        // guard — which read exactly this serialization — is retired; the proxy now
        // gates trusted gestures on the LIVE trigger with isTriggerDisabled.)
        var parsed = new ctx.window.DOMParser()
            .parseFromString(ctx.form.innerHTML, 'text/html')
            .getElementById('parentSubmit');
        assert.equal(parsed.disabled, false, 'no `disabled` attribute serialized (native disable is never written)');
        assert.equal(parsed.getAttribute('data-gina-form-submit-gated'), 'true', 'the gated marker IS serialized (attribute, not native disable)');
    });
});


// 03 - SHOW branch: valid -> marker cleared, .disabled false
describe('03 - valid: gated marker + class removed, .disabled false', function () {
    it('clears the gated marker + the class and keeps .disabled false', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx.form, ctx.trigger, false); // invalid -> marker on
        applySubmitTriggerState(ctx.form, ctx.trigger, true);  // valid   -> marker off
        assert.equal(ctx.trigger.getAttribute('data-gina-form-submit-gated'), null);
        assert.equal(ctx.trigger.classList.contains('gina-form-submit-disabled'), false);
        assert.equal(ctx.trigger.disabled, false);
    });
});


// 04 - regression: markup <button disabled> enables on valid AND when live-check off; subtract-the-fix
describe('04 - markup-disabled button: SHOW branch clears native disabled (both paths) + subtract', function () {
    it('a <button disabled> in markup becomes operable once the form is valid (live-check on)', function () {
        var ctx = makeForm('true', BUTTON_DISABLED);
        assert.equal(ctx.trigger.disabled, true, 'starts natively disabled from markup');
        applySubmitTriggerState(ctx.form, ctx.trigger, true); // valid -> SHOW
        assert.equal(ctx.trigger.disabled, false, 'SHOW branch cleared the native disable');
    });

    it('a <button disabled> becomes operable when live-check is off (even while "invalid")', function () {
        var ctx = makeForm('false', BUTTON_DISABLED);
        applySubmitTriggerState(ctx.form, ctx.trigger, false); // isFormValid false, but live-check off -> SHOW
        assert.equal(ctx.trigger.disabled, false, 'live-check off takes the SHOW branch, clearing disabled');
    });

    it('subtract-the-fix: the pre-fix invalid path left the button natively disabled (the dead-button bug)', function () {
        var ctx = makeForm('true', BUTTON);
        applySubmitTriggerState_preFix(ctx.form, ctx.trigger, false); // pre-fix invalid
        assert.equal(ctx.trigger.disabled, true, 'pre-fix: native disable (this state suppresses the click in a real browser)');
        assert.equal(ctx.trigger.getAttribute('data-gina-form-submit-gated'), null, 'pre-fix: no gated marker, no operable state');
        // post-fix on the same case keeps it operable + marked:
        var ctx2 = makeForm('true', BUTTON);
        applySubmitTriggerState(ctx2.form, ctx2.trigger, false);
        assert.equal(ctx2.trigger.disabled, false, 'post-fix: operable');
        assert.equal(ctx2.trigger.getAttribute('data-gina-form-submit-gated'), 'true', 'post-fix: gated marker');
    });
});


// 05 - anchor <a> submit trigger: tag-agnostic marker, no throw
describe('05 - anchor <a> submit trigger: tag-agnostic marker, no throw', function () {
    it('marks an <a> trigger with the gated marker + class without error on invalid', function () {
        var ctx = makeForm('true', ANCHOR);
        assert.doesNotThrow(function () { applySubmitTriggerState(ctx.form, ctx.trigger, false); });
        assert.equal(ctx.trigger.getAttribute('data-gina-form-submit-gated'), 'true');
        assert.ok(ctx.trigger.classList.contains('gina-form-submit-disabled'));
    });

    it('clears the marker on an <a> trigger when valid, and .disabled=false is a harmless expando', function () {
        var ctx = makeForm('true', ANCHOR);
        applySubmitTriggerState(ctx.form, ctx.trigger, false);
        assert.doesNotThrow(function () { applySubmitTriggerState(ctx.form, ctx.trigger, true); });
        assert.equal(ctx.trigger.getAttribute('data-gina-form-submit-gated'), null);
        assert.equal(ctx.trigger.classList.contains('gina-form-submit-disabled'), false);
    });
});


// 06 - source pins: lock the shipped updateSubmitTriggerState shape + the isValid() send gate
describe('06 - source pins: updateSubmitTriggerState show/hide shape', function () {
    it('SHOW branch clears native disabled + removes the gated marker + removes the class', function () {
        assert.match(
            mainSrc,
            /\{ \/\/ show submitTrigger\s+\$submitTrigger\.disabled = false;\s+\$submitTrigger\.removeAttribute\('data-gina-form-submit-gated'\);\s+\$submitTrigger\.classList\.remove\('gina-form-submit-disabled'\);/
        );
    });

    it('HIDE branch sets the gated marker + adds the class (and does NOT natively disable or write aria)', function () {
        assert.match(
            mainSrc,
            /\} else \{ \/\/ hide submitTrigger[^\n]*\s+\$submitTrigger\.setAttribute\('data-gina-form-submit-gated', 'true'\);\s+\$submitTrigger\.classList\.add\('gina-form-submit-disabled'\);/
        );
    });

    it('the pre-fix native-disable HIDE assignment is gone', function () {
        assert.doesNotMatch(mainSrc, /getElementById\(\$formInstance\.submitTrigger\)\.disabled\s*=\s*true/);
        assert.doesNotMatch(mainSrc, /\$submitTrigger\.disabled\s*=\s*true/);
    });

    it('$submitTrigger.disabled is assigned exactly once, and only to false (the SHOW clear)', function () {
        assert.deepEqual(mainSrc.match(/\$submitTrigger\.disabled\s*=\s*\w+/g) || [], ['$submitTrigger.disabled = false']);
    });

    it('the marker class is used at exactly two code sites (classList.remove in show, classList.add in hide)', function () {
        // NB: a bare `gina-form-submit-disabled` count would be 3 — the consumer-styling comment names
        // the class too. Pin the code form so the comment mention cannot inflate the count.
        assert.equal((mainSrc.match(/classList\.(?:add|remove)\('gina-form-submit-disabled'\)/g) || []).length, 2);
    });

    it('the rationale comment is pinned so the branch is not silently reverted to native disable', function () {
        // #B246 re-pointed this pin: the comment used to read "aria-disabled keeps the
        // trigger operable, so the click still runs validation". That is no longer true —
        // the click is intercepted and the submit cycle is never entered.
        assert.match(mainSrc, /trigger focusable and perceivable/);
        assert.match(mainSrc, /Tag-agnostic: setAttribute\/classList work for both/);
    });

    // --- #B246: a disabled trigger must not be able to reach the submit cycle ---

    it('the disabled-trigger guard runs in clickProxyHandler BEFORE the submit dispatch', function () {
        assert.match(mainSrc, /isTriggerDisabled\(\$el\)/, 'the click guard consults the disabled marker');
        assert.match(mainSrc, /revealValidationState\(/, 'and routes to the display-only reveal');
        // Scope the ordering check to clickProxyHandler's own body: `if (gina.events[_evt]) {`
        // appears in six sibling proxy handlers ABOVE it, so a whole-file indexOf would
        // anchor on the wrong dispatch and fail against correct code.
        var cpStart = mainSrc.indexOf('var clickProxyHandler = function(event)');
        assert.ok(cpStart > -1, 'clickProxyHandler exists');
        var cpBody     = mainSrc.slice(cpStart);
        var guardAt    = cpBody.indexOf('isTriggerDisabled($el)');
        var dispatchAt = cpBody.indexOf('if (gina.events[_evt]) {');
        assert.ok(guardAt > -1, 'the guard lives inside clickProxyHandler');
        assert.ok(dispatchAt > -1, 'the submit dispatch lives inside clickProxyHandler');
        assert.ok(guardAt < dispatchAt,
            'the guard must precede the `submit.<id>` dispatch, or bindSubmitEl still runs');
    });

    it('isTriggerDisabled reads the gated marker AND authored aria-disabled, not only the native property', function () {
        assert.match(mainSrc, /var isTriggerDisabled = function\(\$el\)/);
        assert.match(mainSrc, /\$el\.getAttribute\('aria-disabled'\) == 'true'/);
        assert.match(mainSrc, /\$el\.getAttribute\('data-gina-form-submit-gated'\) == 'true'/,
            '#B312: the gated arm must be in the predicate, or the gate never fires for a not-ready trigger');
    });

    it('revealValidationState is display-only: it can never reach a send', function () {
        var start = mainSrc.indexOf('var revealValidationState = function');
        assert.ok(start > -1, 'revealValidationState exists');
        var body = mainSrc.slice(start, mainSrc.indexOf('\n    };', start));
        assert.ok(body.length > 0, 'body extracted');
        assert.doesNotMatch(body, /triggerEvent/,
            'no dispatch -> the validate.<id> guard (and its isValid() send gate) is unreachable');
        assert.doesNotMatch(body, /\.send\(/, 'no direct send either');
        assert.match(body, /handleErrorsDisplay\(/, 'but it DOES render the errors');
        assert.match(body, /focusFirstInvalidField\(/, 'and focuses the first invalid field');
    });

    it('the real send gate stays isValid() in the validate.<id> guard', function () {
        assert.match(mainSrc, /result\['isValid'\]\(\) \) \{ \/\/ send if valid/);
        assert.match(mainSrc, /instance\.\$forms\[_id\]\.send\(result\['data'\]\)/);
    });
});
