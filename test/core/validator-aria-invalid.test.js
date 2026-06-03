'use strict';
/**
 * FormValidator — aria-invalid reflection (#A11Y1)
 *
 * Per WAI-ARIA, a field's `aria-errormessage` association is only exposed to assistive
 * technology when the field also carries `aria-invalid="true"`. The validator's error-display
 * chokepoint (`handleErrorsDisplay` in main.js) now reflects each managed field's committed
 * validity into `aria-invalid`:
 *   - committed error (error-set / refresh branch, not a soft live-check warning) -> "true"
 *   - valid (clear branch) -> "false", UNLESS the field has native HTML constraints that are
 *     still invalid, in which case "true" so aria-invalid never disagrees with the
 *     `:user-invalid` styling already shown (the value is mirrored from native `ValidityState`).
 *   - hidden fields and pristine fields are left untouched.
 *
 * Strategy (same convention as validator-form-reassociation / validator-isinlist):
 *  - jsdom-backed DOM exercises a test-local replica of each branch's aria-invalid decision.
 *  - the source-inspection block at the end pins the production source to the same logic so the
 *    replica cannot silently drift.
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


// --- Test-local replicas of the three aria-invalid decisions in handleErrorsDisplay ---
// MUST mirror the inline logic in main.js. The source-inspection block at the end pins the
// source-side shape so these stay honest.

// error-set branch (a new committed error was just displayed)
function ariaInvalidOnErrorSet($el, isWarning) {
    if ( !isWarning && $el.type != 'hidden' ) {
        $el.setAttribute('aria-invalid', 'true');
    }
}

// clear branch (the field is valid per Gina again)
function ariaInvalidOnClear($el) {
    if ( $el.type != 'hidden' ) {
        var _a11yNativeInvalid = ( $el.willValidate && $el.validity && !$el.validity.valid ) ? true : false;
        $el.setAttribute('aria-invalid', _a11yNativeInvalid ? 'true' : 'false');
    }
}

// refresh branch (an already-displayed error persists, message updated)
function ariaInvalidOnRefresh($el, isWarning) {
    if ( !isWarning && $el.type != 'hidden' ) {
        $el.setAttribute('aria-invalid', 'true');
    }
}


// --- DOM fixture ---
function setupDom() {
    var dom = new JSDOM(`<!DOCTYPE html><html><body>
        <form id="contact">
            <input  id="text"     name="text"     type="text">
            <input  id="email"    name="email"    type="email">
            <input  id="required" name="required" type="text" required>
            <input  id="custom"   name="custom"   type="text">
            <textarea id="note"   name="note"></textarea>
            <input  id="hid"      name="hid"      type="hidden">
        </form>
    </body></html>`);
    var d = dom.window.document;
    return {
        window   : dom.window,
        document : d,
        text     : d.getElementById('text'),
        email    : d.getElementById('email'),
        required : d.getElementById('required'),
        custom   : d.getElementById('custom'),
        note     : d.getElementById('note'),
        hid      : d.getElementById('hid')
    };
}


// 01 - error-set branch asserts aria-invalid="true" on a committed error

describe('01 - error-set branch: committed error reflects aria-invalid="true"', function () {
    it('sets aria-invalid="true" on a committed (non-warning) text error', function () {
        var ctx = setupDom();
        ariaInvalidOnErrorSet(ctx.text, false);
        assert.equal(ctx.text.getAttribute('aria-invalid'), 'true');
    });

    it('sets aria-invalid="true" on a committed email error', function () {
        var ctx = setupDom();
        ariaInvalidOnErrorSet(ctx.email, false);
        assert.equal(ctx.email.getAttribute('aria-invalid'), 'true');
    });

    it('does NOT assert aria-invalid for a soft live-check warning (isWarning=true)', function () {
        var ctx = setupDom();
        ariaInvalidOnErrorSet(ctx.text, true);
        assert.equal(ctx.text.getAttribute('aria-invalid'), null,
            'a pristine field still being edited (warning) must not be asserted invalid');
    });

    it('does NOT touch a hidden field', function () {
        var ctx = setupDom();
        ariaInvalidOnErrorSet(ctx.hid, false);
        assert.equal(ctx.hid.getAttribute('aria-invalid'), null);
    });
});


// 02 - clear branch mirrors native ValidityState

describe('02 - clear branch: aria-invalid mirrors native ValidityState', function () {
    it('sets "false" for a plain valid field (no native constraint)', function () {
        var ctx = setupDom();
        ctx.text.value = 'hello';
        ariaInvalidOnClear(ctx.text);
        assert.equal(ctx.text.getAttribute('aria-invalid'), 'false');
    });

    it('sets "false" for a natively-valid email', function () {
        var ctx = setupDom();
        ctx.email.value = 'a@b.co';
        ariaInvalidOnClear(ctx.email);
        assert.equal(ctx.email.getAttribute('aria-invalid'), 'false');
    });

    it('keeps "true" when native validity still fails (email typeMismatch) — agrees with :user-invalid', function () {
        var ctx = setupDom();
        ctx.email.value = 'not-an-email';
        ariaInvalidOnClear(ctx.email);
        assert.equal(ctx.email.getAttribute('aria-invalid'), 'true',
            'Gina cleared but native type=email is still invalid -> aria-invalid stays true');
    });

    it('keeps "true" when a required field is natively empty (valueMissing)', function () {
        var ctx = setupDom();
        ctx.required.value = '';
        ariaInvalidOnClear(ctx.required);
        assert.equal(ctx.required.getAttribute('aria-invalid'), 'true');
    });

    it('keeps "true" under setCustomValidity (jsdom-independent native-invalid path)', function () {
        var ctx = setupDom();
        ctx.custom.setCustomValidity('nope');
        ariaInvalidOnClear(ctx.custom);
        assert.equal(ctx.custom.getAttribute('aria-invalid'), 'true');
    });

    it('flips a previously-invalid field back to "false" once corrected', function () {
        var ctx = setupDom();
        ctx.text.setAttribute('aria-invalid', 'true'); // prior committed error
        ctx.text.value = 'fixed';
        ariaInvalidOnClear(ctx.text);
        assert.equal(ctx.text.getAttribute('aria-invalid'), 'false');
    });

    it('does NOT touch a hidden field', function () {
        var ctx = setupDom();
        ariaInvalidOnClear(ctx.hid);
        assert.equal(ctx.hid.getAttribute('aria-invalid'), null);
    });
});


// 03 - refresh branch re-asserts aria-invalid="true"

describe('03 - refresh branch: persisting error keeps aria-invalid="true"', function () {
    it('re-asserts aria-invalid="true" on a committed refresh', function () {
        var ctx = setupDom();
        ariaInvalidOnRefresh(ctx.note, false);
        assert.equal(ctx.note.getAttribute('aria-invalid'), 'true');
    });

    it('does NOT assert during a soft warning refresh (isWarning=true)', function () {
        var ctx = setupDom();
        ariaInvalidOnRefresh(ctx.note, true);
        assert.equal(ctx.note.getAttribute('aria-invalid'), null);
    });
});


// 04 - source-inspection pins (keep the replicas honest)

describe('04 - source pins: handleErrorsDisplay aria-invalid logic', function () {
    it('sets aria-invalid at exactly three sites (error-set, clear, refresh)', function () {
        var hits = mainSrc.match(/setAttribute\('aria-invalid'/g) || [];
        assert.equal(hits.length, 3, 'expected exactly 3 aria-invalid setAttribute sites for #A11Y1');
    });

    it('error-set branch carries the committed-invalid comment + guarded true', function () {
        assert.match(mainSrc, /reflect a committed invalid state into aria-invalid/);
        assert.match(mainSrc, /!isWarning && \$el\.type != 'hidden'/);
    });

    it('clear branch mirrors native ValidityState', function () {
        assert.match(mainSrc, /field is valid per Gina; mirror the native ValidityState/);
        assert.match(mainSrc, /\$el\.willValidate && \$el\.validity && !\$el\.validity\.valid/);
        assert.match(mainSrc, /setAttribute\('aria-invalid', _a11yNativeInvalid \? 'true' : 'false'\)/);
    });

    it('refresh branch keeps aria-invalid asserted', function () {
        assert.match(mainSrc, /the committed error persists on refresh; keep aria-invalid asserted/);
    });

    it('JSDoc documents the aria-invalid reflection', function () {
        assert.match(mainSrc, /reflects each managed field's committed validity into/);
    });
});
