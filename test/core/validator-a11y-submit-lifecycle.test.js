'use strict';
/**
 * #A11Y4 — the SUBMIT lifecycle's accessibility exposure.
 *
 * Three findings, one window:
 *   S1 — a `<button>`/`<input>` trigger holds focus at the moment gina natively disables it
 *        for the in-flight request. A disabled control cannot hold focus, so the browser moves
 *        focus to `<body>` and re-enabling does NOT bring it back. Both halves measured in a
 *        real browser; the discriminating control also measured — an `<a>` receives
 *        `aria-disabled`, which does not blur, so that branch needs no restore.
 *   S2 — nothing set `aria-busy` anywhere in the framework (0 hits, control fired) and nothing
 *        announced that a submit had started. `data-gina-loading` (#B247) is a purely visual
 *        hook, so an assistive-tech user pressed Save and perceived silence.
 *   S4 — the loading state is armed BEFORE validation runs, so a rejected submit arms then
 *        disarms. Harmless while silent, but it would become a spurious busy/not-busy pair the
 *        moment `aria-busy` landed.
 *
 * S4 is resolved by PLACEMENT rather than by code: every signal here hangs off the request
 * window inside `send()`, which is only ever reached once an XHR is genuinely in flight. A
 * validation-rejected submit returns at the `validate.<id>` else-branch and never arrives, so
 * it can neither arm nor announce. That is why these tests assert the arm sites sit inside the
 * readyState guard rather than at click time.
 *
 * Two design points the tests pin deliberately:
 *   - `aria-busy` goes on the TRIGGER, not the form. The polite region #A11Y2 stands up lives
 *     INSIDE the form, and `aria-busy` on an ancestor is commonly implemented as "defer
 *     announcements in this subtree" — which would silence the very channel used to announce.
 *     ARIA 1.2 defines no normative behaviour for this, so it is a hedge against real
 *     implementations, not a spec requirement; the pin records the intent either way.
 *   - completion announces NOTHING. An errored response is already announced field-by-field by
 *     `handleErrorsDisplay`; a second status write over the same polite region in the same beat
 *     can cut that announcement off.
 *
 * Strategy follows the house convention (validator-aria-invalid / -a11y-reannounce /
 * -a11y-live-region-lifecycle): jsdom exercises a faithful replica, and a source-inspection
 * block pins production to the same shape so the replica cannot silently drift.
 *
 * ⚠️ INSTRUMENT LIMIT, measured — jsdom does NOT emulate blur-on-disable. Neither
 * `setAttribute('disabled', true)` nor `.disabled = true` moves `document.activeElement`
 * off the control, and `document.body.focus()` is a no-op because <body> is not focusable
 * without a tabindex. So these tests CANNOT establish S1's premise; they use an explicit
 * `.blur()` as the stand-in for what the browser does on its own, and the premise itself
 * ("native disable drops focus to <body>, and re-enabling does not restore it") was measured
 * separately in a real browser with a discriminating control. What this file verifies is the
 * SAVE/RESTORE decision logic, not the platform behaviour that triggers it.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var { JSDOM } = require('jsdom');

var FW      = require('../fw');
var MAIN    = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var mainSrc = fs.readFileSync(MAIN, 'utf8');
var DIST_RAW = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');


// --- Faithful replicas of main.js's a11yLabel / holdTriggerFocus / releaseTriggerFocus /
//     armSubmitA11y / releaseSubmitA11y. `doc` and `ginaRef` are threaded explicitly
//     because jsdom gives no globals. ---

var A11Y_LABELS = {
    submitting: 'Submitting…'
};

function a11yLabel(ginaRef, key) {
    var _over = ( typeof(ginaRef) != 'undefined' && ginaRef && ginaRef.config && ginaRef.config.a11y )
        ? ginaRef.config.a11y
        : null;
    if ( _over && typeof(_over[key]) == 'string' && _over[key] ) {
        return _over[key];
    }
    return A11Y_LABELS[key] || '';
}

function holdTriggerFocus(doc, $form, $trigger) {
    if ( !$form || !$trigger ) {
        return false;
    }
    if ( typeof(doc) === 'undefined' || !doc ) {
        return false;
    }
    if ( doc.activeElement !== $trigger ) {
        return false;
    }
    $form.ginaA11yFocusReturn = $trigger;
    return true;
}

function releaseTriggerFocus(doc, $form) {
    if ( !$form || !$form.ginaA11yFocusReturn ) {
        return false;
    }
    var $trigger = $form.ginaA11yFocusReturn;
    $form.ginaA11yFocusReturn = null;
    if ( typeof(doc) === 'undefined' || !doc ) {
        return false;
    }
    if ( doc.activeElement && doc.activeElement !== doc.body ) {
        return false;
    }
    var _stillThere = ( typeof($trigger.isConnected) == 'boolean' )
        ? $trigger.isConnected
        : ( doc.body && doc.body.contains($trigger) );
    if ( !_stillThere || typeof($trigger.focus) != 'function' ) {
        return false;
    }
    $trigger.focus();
    return true;
}

function armSubmitA11y(doc, ginaRef, announce, $form, $trigger) {
    if ( !$form ) {
        return false;
    }
    if ($trigger) {
        if ( !/^A$/i.test($trigger.tagName) ) {
            holdTriggerFocus(doc, $form, $trigger);
        }
        $trigger.setAttribute('aria-busy', 'true');
    }
    if ( $form.ginaA11yBusy ) {
        return false;
    }
    $form.ginaA11yBusy = true;
    if ( $form.target ) {
        announce($form.target, a11yLabel(ginaRef, 'submitting'));
    }
    return true;
}

function releaseSubmitA11y(doc, $form, $trigger) {
    if ( !$form ) {
        return false;
    }
    if ($trigger) {
        $trigger.removeAttribute('aria-busy');
    }
    $form.ginaA11yBusy = false;
    return releaseTriggerFocus(doc, $form);
}


function setupDom(triggerTag) {
    var tag = triggerTag || 'button';
    var markup = (tag === 'a')
        ? '<a id="trg" href="#" data-gina-form-submit>Save</a>'
        : '<button id="trg" type="submit">Save</button>';
    var dom = new JSDOM(
        '<!doctype html><html><body><form id="f">' +
        '<input id="txt" name="txt">' + markup +
        '</form><input id="outside" name="outside"></body></html>'
    );
    var doc = dom.window.document;
    var announced = [];
    return {
        dom: dom,
        doc: doc,
        $formEl: doc.getElementById('f'),
        $trigger: doc.getElementById('trg'),
        $txt: doc.getElementById('txt'),
        $outside: doc.getElementById('outside'),
        announced: announced,
        announce: function($t, text) { announced.push(text); return {}; },
        // the form INSTANCE shape send() works with
        $form: { target: doc.getElementById('f') }
    };
}


describe('01 - a11yLabel: English default, project override wins', function () {

    it('returns the English default when nothing is configured', function () {
        assert.equal(a11yLabel(null, 'submitting'), 'Submitting…');
        assert.equal(a11yLabel({ config: {} }, 'submitting'), 'Submitting…');
    });

    it('a project override wins', function () {
        var g = { config: { a11y: { submitting: 'Envoi…' } } };
        assert.equal(a11yLabel(g, 'submitting'), 'Envoi…');
    });

    it('an empty or non-string override falls back rather than announcing nothing', function () {
        assert.equal(a11yLabel({ config: { a11y: { submitting: '' } } }, 'submitting'), 'Submitting…');
        assert.equal(a11yLabel({ config: { a11y: { submitting: 42 } } }, 'submitting'), 'Submitting…');
    });

    it('an unknown key yields an empty string, never "undefined"', function () {
        assert.equal(a11yLabel(null, 'nope'), '');
    });
});


describe('02 - S1: focus is captured only when gina is the one taking it', function () {

    it('captures the trigger when it holds focus', function () {
        var c = setupDom();
        c.$trigger.focus();
        assert.equal(c.doc.activeElement, c.$trigger, 'precondition: the trigger holds focus');
        assert.equal(holdTriggerFocus(c.doc, c.$form, c.$trigger), true);
        assert.equal(c.$form.ginaA11yFocusReturn, c.$trigger);
    });

    it('captures NOTHING when focus is elsewhere — gina must not move focus it never took', function () {
        var c = setupDom();
        c.$txt.focus();
        assert.equal(holdTriggerFocus(c.doc, c.$form, c.$trigger), false);
        assert.equal(typeof c.$form.ginaA11yFocusReturn, 'undefined');
    });

    it('tolerates a null trigger (a form may register none)', function () {
        var c = setupDom();
        assert.equal(holdTriggerFocus(c.doc, c.$form, null), false);
    });
});


describe('03 - S1: the restore is deliberately conservative', function () {

    it('restores when focus is still where the disable dropped it', function () {
        var c = setupDom();
        c.$trigger.focus();
        holdTriggerFocus(c.doc, c.$form, c.$trigger);
        c.$trigger.blur();                        // stand-in: jsdom does not blur on disable
        assert.equal(c.doc.activeElement, c.doc.body, 'precondition: focus fell to <body>');
        assert.equal(releaseTriggerFocus(c.doc, c.$form), true);
        assert.equal(c.doc.activeElement, c.$trigger, 'focus is back on the trigger');
    });

    it('does NOT restore when something else claimed focus during the request', function () {
        var c = setupDom();
        c.$trigger.focus();
        holdTriggerFocus(c.doc, c.$form, c.$trigger);
        c.$outside.focus();                       // a popin / redirect / first-invalid-field move
        assert.equal(releaseTriggerFocus(c.doc, c.$form), false);
        assert.equal(c.doc.activeElement, c.$outside, "the other party's focus decision wins");
    });

    it('does NOT restore to a trigger the response removed from the document', function () {
        var c = setupDom();
        c.$trigger.focus();
        holdTriggerFocus(c.doc, c.$form, c.$trigger);
        c.$trigger.blur();                        // stand-in: jsdom does not blur on disable
        c.$trigger.remove();
        assert.equal(releaseTriggerFocus(c.doc, c.$form), false);
    });

    it('clears the stash even when it declines to restore, so it cannot leak into a later request', function () {
        var c = setupDom();
        c.$trigger.focus();
        holdTriggerFocus(c.doc, c.$form, c.$trigger);
        c.$outside.focus();
        releaseTriggerFocus(c.doc, c.$form);
        assert.equal(c.$form.ginaA11yFocusReturn, null, 'stash cleared');
        assert.equal(releaseTriggerFocus(c.doc, c.$form), false, 'a second release is a no-op');
    });

    it('is a no-op when nothing was ever captured', function () {
        var c = setupDom();
        assert.equal(releaseTriggerFocus(c.doc, c.$form), false);
    });
});


describe('04 - S2: aria-busy and a single start announcement', function () {

    it('marks the trigger busy and announces once', function () {
        var c = setupDom();
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);
        assert.equal(c.$trigger.getAttribute('aria-busy'), 'true');
        assert.deepEqual(c.announced, ['Submitting…']);
    });

    it('announces ONCE across readyState 1 and 3 — both arms reach the same code', function () {
        var c = setupDom();
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);   // readyState 1
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);   // readyState 3
        assert.equal(c.announced.length, 1, 'exactly one announcement per request');
    });

    it('announces the project override when one is set', function () {
        var c = setupDom();
        var g = { config: { a11y: { submitting: 'Envoi…' } } };
        armSubmitA11y(c.doc, g, c.announce, c.$form, c.$trigger);
        assert.deepEqual(c.announced, ['Envoi…']);
    });

    it('release clears aria-busy and re-opens the gate for the next request', function () {
        var c = setupDom();
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);
        releaseSubmitA11y(c.doc, c.$form, c.$trigger);
        assert.equal(c.$trigger.getAttribute('aria-busy'), null, 'aria-busy removed, not set to "false"');
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);
        assert.equal(c.announced.length, 2, 'a second request announces again');
    });

    it('release announces NOTHING — the error path already announces per field', function () {
        var c = setupDom();
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);
        var before = c.announced.length;
        releaseSubmitA11y(c.doc, c.$form, c.$trigger);
        assert.equal(c.announced.length, before, 'no completion announcement');
    });

    it('release is idempotent — readyState 4 and loadend both run it', function () {
        var c = setupDom();
        c.$trigger.focus();
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);
        c.$trigger.blur();                        // stand-in: jsdom does not blur on disable
        assert.equal(releaseSubmitA11y(c.doc, c.$form, c.$trigger), true, 'first release restores');
        assert.equal(releaseSubmitA11y(c.doc, c.$form, c.$trigger), false, 'second is a harmless no-op');
        assert.equal(c.doc.activeElement, c.$trigger);
    });
});


describe('05 - S1: the <a> branch is excluded from the focus capture', function () {

    it('an <a> trigger gets aria-busy but no focus stash — aria-disabled does not blur', function () {
        var c = setupDom('a');
        c.$trigger.focus();
        assert.equal(c.doc.activeElement, c.$trigger, 'precondition: the anchor holds focus');
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);
        assert.equal(c.$trigger.getAttribute('aria-busy'), 'true', 'still marked busy');
        assert.ok(!c.$form.ginaA11yFocusReturn, 'no restore is scheduled for an anchor');
    });

    it('a <button> trigger DOES get the stash — the discriminating control', function () {
        var c = setupDom('button');
        c.$trigger.focus();
        armSubmitA11y(c.doc, null, c.announce, c.$form, c.$trigger);
        assert.equal(c.$form.ginaA11yFocusReturn, c.$trigger,
            'the button branch must capture, or the <a> assertion above proves nothing');
    });
});


describe('06 - source pins: production matches the replica', function () {

    it('declares all five helpers', function () {
        assert.match(mainSrc, /var a11yLabel = function\(key\)/);
        assert.match(mainSrc, /var announceA11yStatus = function\(\$form, text\)/);
        assert.match(mainSrc, /var holdTriggerFocus = function\(\$form, \$trigger\)/);
        assert.match(mainSrc, /var releaseTriggerFocus = function\(\$form\)/);
        assert.match(mainSrc, /var armSubmitA11y = function\(\$form, \$trigger\)/);
        assert.match(mainSrc, /var releaseSubmitA11y = function\(\$form, \$trigger\)/);
    });

    it('announceA11yStatus delegates to the #A11Y2 region rather than building a second one', function () {
        var i = mainSrc.indexOf('var announceA11yStatus = function($form, text)');
        var block = mainSrc.slice(i, i + 200);
        assert.match(block, /return announceA11yError\(\$form, text\)/);
        assert.ok(block.indexOf('createElement') < 0, 'must not create a region of its own');
    });

    it('aria-busy is written to the TRIGGER, never to the form', function () {
        var i = mainSrc.indexOf('var armSubmitA11y = function($form, $trigger)');
        var block = mainSrc.slice(i, i + 900);
        assert.match(block, /\$trigger\.setAttribute\('aria-busy', 'true'\)/);
        assert.ok(block.indexOf("$form.target.setAttribute('aria-busy'") < 0,
            'aria-busy on the form would defer the live region nested inside it');
    });

    it('the focus capture is scoped to the non-anchor branch', function () {
        var i = mainSrc.indexOf('var armSubmitA11y = function($form, $trigger)');
        var block = mainSrc.slice(i, i + 900);
        assert.match(block, /if \( !\/\^A\$\/i\.test\(\$trigger\.tagName\) \) \{\s*\n\s*holdTriggerFocus\(\$form, \$trigger\);/,
            'holdTriggerFocus must sit inside the not-an-anchor guard');
    });

    it('the restore refuses when another party holds focus', function () {
        var i = mainSrc.indexOf('var releaseTriggerFocus = function($form)');
        var block = mainSrc.slice(i, i + 900);
        assert.match(block, /document\.activeElement !== document\.body/,
            'restores only from the body, i.e. only what the disable itself caused');
        assert.match(block, /isConnected/, 'and only to a trigger still in the document');
    });

    it('both arm sites sit INSIDE the readyState guard — this is what makes S4 moot', function () {
        var arms = mainSrc.match(/armSubmitA11y\(\$form, \$submitTrigger\)/g) || [];
        assert.equal(arms.length, 2, 'readyState 1|3 appears twice in send()');
        // each arm must be preceded by the readyState test rather than by a click handler
        var idx = -1, seen = 0;
        while ( (idx = mainSrc.indexOf('armSubmitA11y($form, $submitTrigger)', idx + 1)) > -1 ) {
            var before = mainSrc.slice(Math.max(0, idx - 400), idx);
            assert.match(before, /\/\^\(1\|3\)\$\/\.test\(xhr\.readyState\)/,
                'an arm outside the request window would re-introduce the S4 flap');
            ++seen;
        }
        assert.equal(seen, 2);
    });

    it('the arm runs BEFORE the native disable, or the focus capture is pointless', function () {
        var idx = -1;
        while ( (idx = mainSrc.indexOf('armSubmitA11y($form, $submitTrigger)', idx + 1)) > -1 ) {
            var after = mainSrc.slice(idx, idx + 500);
            var disableAt = after.indexOf("setAttribute('disabled', true)");
            assert.ok(disableAt > -1, 'the disable must follow within the same block');
        }
    });

    it('both releases run AFTER the trigger is re-enabled, so focus has somewhere to land', function () {
        var rels = mainSrc.match(/releaseSubmitA11y\(\$form, \$submitTrigger\)/g) || [];
        assert.equal(rels.length, 2, 'readyState 4 + the loadend fail-safe');
        var idx = -1;
        while ( (idx = mainSrc.indexOf('releaseSubmitA11y($form, $submitTrigger)', idx + 1)) > -1 ) {
            var before = mainSrc.slice(Math.max(0, idx - 600), idx);
            assert.match(before, /removeAttribute\('disabled'/,
                'restoring focus to a still-disabled trigger is a no-op');
        }
    });
});


describe('07 - dist fidelity', function () {

    it('the served bundle carries #A11Y4 (rebuild the bundle if this fails)', function () {
        var dist = fs.readFileSync(DIST_RAW, 'utf8');
        assert.ok(dist.indexOf('ginaA11yFocusReturn') > -1,
            'rebuild the bundle: the #A11Y4 focus stash is missing from dist gina.js');
        assert.ok(dist.indexOf('aria-busy') > -1,
            'rebuild the bundle: aria-busy is missing from dist gina.js');
    });
});
