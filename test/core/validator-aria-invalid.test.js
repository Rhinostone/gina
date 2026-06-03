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


// --- Slice 2 replicas: aria-errormessage detection / wiring / cleanup ---
// MUST mirror handleErrorsDisplay's slice-2 logic. Source pins (08) keep them honest.

function detectConsumerErrMsg($el) {
    var _ariaErrId         = $el.getAttribute('aria-errormessage');
    var _ginaOwnsErrMsg    = ( typeof($el.dataset) != 'undefined' && typeof($el.dataset.ginaAriaErrormessage) != 'undefined' ) ? true : false;
    var _hasConsumerErrMsg = ( _ariaErrId && !_ginaOwnsErrMsg ) ? true : false;
    return { ariaErrId: _ariaErrId, ginaOwns: _ginaOwnsErrMsg, hasConsumer: _hasConsumerErrMsg };
}

function injectAndWire($el, $err, $target, id, name) {
    var det = detectConsumerErrMsg($el);
    if ($target.type != 'hidden' && !det.hasConsumer) {
        if ( !$el.getAttribute('aria-errormessage') || det.ginaOwns ) {
            $err.id = ('gina-errormessage-' + (id || 'form') + '-' + (name || 'field')).replace(/[^a-zA-Z0-9_-]+/g, '-');
            $el.setAttribute('aria-errormessage', $err.id);
            if ( typeof($el.dataset) != 'undefined' ) {
                $el.dataset.ginaAriaErrormessage = 'true';
            }
        }
        $target.parentNode.insertBefore($err, $target.nextSibling); // mimics insertAfter
        return true;
    }
    return false;
}

function clearErrMsgWire($el) {
    if ( typeof($el.dataset) != 'undefined' && typeof($el.dataset.ginaAriaErrormessage) != 'undefined' ) {
        $el.removeAttribute('aria-errormessage');
        delete $el.dataset.ginaAriaErrormessage;
    }
}


// 05 - aria-errormessage: suppress duplicate vs wire legacy

describe('05 - aria-errormessage suppression and auto-wiring', function () {
    function freshDiv(ctx) {
        var d = ctx.document.createElement('div');
        d.className = 'form-item-error-message';
        return d;
    }

    it('does NOT inject a div when the field has a consumer-provided aria-errormessage', function () {
        var ctx = setupDom();
        ctx.email.setAttribute('aria-errormessage', 'consumer-err');
        var injected = injectAndWire(ctx.email, freshDiv(ctx), ctx.email, 'contact', 'email');
        assert.equal(injected, false, 'must not inject a competing message div');
        assert.equal(ctx.email.getAttribute('aria-errormessage'), 'consumer-err', 'consumer association is untouched');
        assert.equal(ctx.email.dataset.ginaAriaErrormessage, undefined, 'we do not claim ownership of a consumer wire');
    });

    it('injects the div AND wires aria-errormessage on a legacy field (no association)', function () {
        var ctx = setupDom();
        var div = freshDiv(ctx);
        var injected = injectAndWire(ctx.text, div, ctx.text, 'contact', 'text');
        assert.equal(injected, true);
        assert.ok(div.id && div.id.length > 0, 'injected div receives an id');
        assert.equal(ctx.text.getAttribute('aria-errormessage'), div.id, 'field references the injected div');
        assert.equal(ctx.text.dataset.ginaAriaErrormessage, 'true', 'wire is marked gina-owned');
    });

    it('re-wires a gina-owned association on a subsequent error (stable id)', function () {
        var ctx = setupDom();
        var div1 = freshDiv(ctx);
        injectAndWire(ctx.text, div1, ctx.text, 'contact', 'text');
        var firstId = ctx.text.getAttribute('aria-errormessage');
        var div2 = freshDiv(ctx);
        var injected = injectAndWire(ctx.text, div2, ctx.text, 'contact', 'text');
        assert.equal(injected, true);
        assert.equal(div2.id, firstId, 'gina-owned id is stable across error cycles');
    });

    it('does not inject for a hidden target', function () {
        var ctx = setupDom();
        var injected = injectAndWire(ctx.hid, freshDiv(ctx), ctx.hid, 'contact', 'hid');
        assert.equal(injected, false);
    });

    it('sanitises bracketed field names into a valid id', function () {
        var ctx = setupDom();
        ctx.text.setAttribute('name', 'contact[email]');
        var div = freshDiv(ctx);
        injectAndWire(ctx.text, div, ctx.text, 'contact', 'contact[email]');
        assert.doesNotMatch(div.id, /[\[\]]/, 'id has no bracket characters');
        assert.equal(ctx.text.getAttribute('aria-errormessage'), div.id);
    });
});


// 06 - clear cleanup of the gina-owned wire

describe('06 - clear drops gina-owned aria-errormessage, preserves consumer wire', function () {
    it('removes a gina-owned wire + marker on clear', function () {
        var ctx = setupDom();
        injectAndWire(ctx.text, ctx.document.createElement('div'), ctx.text, 'contact', 'text');
        assert.equal(ctx.text.dataset.ginaAriaErrormessage, 'true');
        clearErrMsgWire(ctx.text);
        assert.equal(ctx.text.getAttribute('aria-errormessage'), null, 'gina wire removed on clear');
        assert.equal(ctx.text.dataset.ginaAriaErrormessage, undefined, 'ownership marker removed');
    });

    it('leaves a consumer-provided wire intact on clear', function () {
        var ctx = setupDom();
        ctx.email.setAttribute('aria-errormessage', 'consumer-err');
        clearErrMsgWire(ctx.email);
        assert.equal(ctx.email.getAttribute('aria-errormessage'), 'consumer-err', 'consumer wire preserved');
    });
});


// 07 - source pins for slice 2

describe('07 - source pins: aria-errormessage suppression / wiring', function () {
    it('hoists consumer-association detection before the branch chain', function () {
        assert.match(mainSrc, /_hasConsumerErrMsg = \( _ariaErrId && !_ginaOwnsErrMsg \)/);
        assert.match(mainSrc, /detect a consumer-provided aria-errormessage association/);
    });

    it('gates the error-set injection on !_hasConsumerErrMsg and wires the div', function () {
        assert.match(mainSrc, /if \(\$target\.type != 'hidden' && !_hasConsumerErrMsg\) \{/);
        assert.match(mainSrc, /\$el\.setAttribute\('aria-errormessage', \$err\.id\)/);
        assert.match(mainSrc, /\$el\.dataset\.ginaAriaErrormessage = 'true'/);
    });

    it('gates the refresh injection too and preserves the owned id', function () {
        assert.match(mainSrc, /if \(\$err && \$target\.type != 'hidden' && !_hasConsumerErrMsg\) \{/);
        assert.match(mainSrc, /preserve the aria-errormessage wire we own across refresh/);
    });

    it('drops the gina-owned wire on clear', function () {
        assert.match(mainSrc, /\$el\.removeAttribute\('aria-errormessage'\)/);
        assert.match(mainSrc, /delete \$el\.dataset\.ginaAriaErrormessage/);
    });
});


// --- Slice 3 replica: focus first invalid on failed submit ---
// MUST mirror the failed-submit branch in onValidate. Source pins (09) keep it honest.

function focusFirstInvalid($form, errs) {
    if ( !errs ) return null;
    for (var _ai = 0, _aLen = $form.length; _ai < _aLen; ++_ai) {
        var _aField = $form[_ai];
        var _aName  = _aField.getAttribute('name');
        if (
            _aName
            && typeof(errs[_aName]) != 'undefined'
            && ( typeof(errs[_aName].count) != 'function' || errs[_aName].count() > 0 )
            && _aField.type != 'hidden'
            && typeof(_aField.focus) == 'function'
        ) {
            _aField.focus();
            return _aField;
        }
    }
    return null;
}


// 08 - focus the first invalid field on failed submit

describe('08 - first-invalid focus on failed submit', function () {
    it('focuses the first DOM-order invalid field', function () {
        var ctx = setupDom();
        var focused = focusFirstInvalid(ctx.document.getElementById('contact'), { required: { isRequired: 'x' }, note: { isRequired: 'y' } });
        assert.ok(focused, 'a field was focused');
        assert.equal(focused.id, 'required', 'first invalid field in DOM order is focused');
        assert.equal(ctx.document.activeElement.id, 'required');
    });

    it('picks email when it is the earliest errored field', function () {
        var ctx = setupDom();
        var focused = focusFirstInvalid(ctx.document.getElementById('contact'), { email: { isEmail: 'x' }, note: { isRequired: 'y' } });
        assert.equal(focused.id, 'email');
    });

    it('skips a hidden errored field', function () {
        var ctx = setupDom();
        var focused = focusFirstInvalid(ctx.document.getElementById('contact'), { hid: { isRequired: 'x' } });
        assert.equal(focused, null, 'hidden field is not focusable, nothing focused');
    });

    it('skips a field whose error count is 0', function () {
        var ctx = setupDom();
        var focused = focusFirstInvalid(ctx.document.getElementById('contact'), { email: { count: function () { return 0; } } });
        assert.equal(focused, null);
    });

    it('does nothing when there are no errors', function () {
        var ctx = setupDom();
        assert.equal(focusFirstInvalid(ctx.document.getElementById('contact'), {}), null);
        assert.equal(focusFirstInvalid(ctx.document.getElementById('contact'), null), null);
    });
});


// 09 - source pins for slice 3

describe('09 - source pins: first-invalid focus', function () {
    it('focuses the first invalid field in the failed-submit branch', function () {
        assert.match(mainSrc, /failed submit: move focus to the first invalid field/);
        assert.match(mainSrc, /var _a11yErrs = result\['fields'\] \|\| result\['error'\]/);
        assert.match(mainSrc, /_aField\.focus\(\)/);
    });

    it('skips hidden and unfocusable fields', function () {
        assert.match(mainSrc, /_aField\.type != 'hidden'/);
        assert.match(mainSrc, /typeof\(_aField\.focus\) == 'function'/);
    });
});


// --- Slice 4 replica: polite live-region announcement ---
// MUST mirror announceA11yError + the blur-path gate. Source pins (11) keep them honest.

function announceA11yError(doc, $form, text) {
    if ( !$form || !text ) return null;
    var _fid    = ( typeof($form.id) != 'undefined' && $form.id ) ? $form.id : ( $form.getAttribute('id') || 'form' );
    var _liveId = 'gina-aria-live-' + _fid;
    var _live   = doc.getElementById(_liveId);
    if ( !_live ) {
        _live = doc.createElement('div');
        _live.id = _liveId;
        _live.setAttribute('role', 'status');
        _live.setAttribute('aria-live', 'polite');
        _live.setAttribute('aria-atomic', 'true');
        _live.className = 'gina-visually-hidden';
        _live.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
        $form.appendChild(_live);
    }
    _live.textContent = text;
    return _live;
}

function shouldAnnounceOnBlur(isWarning, fieldName, $err, $el, activeEl) {
    return ( !isWarning && typeof(fieldName) != 'undefined' && !!$err && $el !== activeEl ) ? true : false;
}


// 10 - polite live region

describe('10 - aria-live polite region for blur announcement', function () {
    it('creates a visually-hidden polite status region on the form and announces text', function () {
        var ctx  = setupDom();
        var form = ctx.document.getElementById('contact');
        var live = announceA11yError(ctx.document, form, 'Email is required');
        assert.ok(live, 'region created');
        assert.equal(live.getAttribute('role'), 'status');
        assert.equal(live.getAttribute('aria-live'), 'polite');
        assert.equal(live.getAttribute('aria-atomic'), 'true');
        assert.equal(live.textContent, 'Email is required');
        assert.equal(live.parentNode, form, 'region is appended to the form');
        assert.match(live.style.cssText, /position:\s*absolute/);
    });

    it('reuses the same region on a second announcement', function () {
        var ctx   = setupDom();
        var form  = ctx.document.getElementById('contact');
        var live1 = announceA11yError(ctx.document, form, 'first');
        var live2 = announceA11yError(ctx.document, form, 'second');
        assert.equal(live1, live2, 'same region element reused');
        assert.equal(live2.textContent, 'second');
        assert.equal(ctx.document.querySelectorAll('[aria-live="polite"]').length, 1, 'only one region');
    });

    it('returns null for empty text or missing form', function () {
        var ctx = setupDom();
        assert.equal(announceA11yError(ctx.document, ctx.document.getElementById('contact'), ''), null);
        assert.equal(announceA11yError(ctx.document, null, 'x'), null);
    });

    it('announces only on the blur path: fieldName set, focus gone, committed, $err present', function () {
        var $err = {}; // truthy stand-in for the built message div
        assert.equal(shouldAnnounceOnBlur(false, 'email', $err, { a: 1 }, { b: 2 }), true,  'blur of an unfocused committed-error field announces');
        assert.equal(shouldAnnounceOnBlur(true,  'email', $err, { a: 1 }, { b: 2 }), false, 'soft warning does not announce');
        assert.equal(shouldAnnounceOnBlur(false, undefined, $err, { a: 1 }, { b: 2 }), false, 'submit path (no fieldName) uses focus, not the region');
        var same = { a: 1 };
        assert.equal(shouldAnnounceOnBlur(false, 'email', $err, same, same), false, 'a still-focused field is not announced via the region');
        assert.equal(shouldAnnounceOnBlur(false, 'email', null, { a: 1 }, { b: 2 }), false, 'nothing to announce without a built message');
    });
});


// 11 - source pins for slice 4

describe('11 - source pins: aria-live region', function () {
    it('defines a polite live-region helper', function () {
        assert.match(mainSrc, /var announceA11yError = function\(\$form, text\)/);
        assert.match(mainSrc, /setAttribute\('aria-live', 'polite'\)/);
        assert.match(mainSrc, /'gina-aria-live-' \+ _fid/);
    });

    it('announces on the blur path only (gated on fieldName + focus-gone + not a warning)', function () {
        assert.match(mainSrc, /announce a blur-time committed error through the form's polite/);
        assert.match(mainSrc, /\$el !== document\.activeElement/);
        assert.match(mainSrc, /announceA11yError\(\$form, \$err\.textContent\)/);
    });
});
