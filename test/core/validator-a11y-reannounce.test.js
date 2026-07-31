'use strict';
/**
 * FormValidator — the aria-live region re-announces a REFRESHED error message (#B89)
 *
 * `handleErrorsDisplay` (main.js) has three branches per field:
 *   - first-error (parent not yet error/warning): builds the message div AND announces via the
 *     form's aria-live region.
 *   - clear (field became valid): removes the div, strips the class.
 *   - refresh (already-errored, still errored): REBUILDS the message div from the fresh
 *     errors[name] — e.g. the value now fails a different rule, or a late setErrorLabels()
 *     overlay changed the label.
 *
 * The refresh branch updated the VISIBLE message but never called announceA11yError, so a
 * screen reader kept announcing the FIRST message. #B89 adds a guarded announce to the refresh
 * branch (same guard as the first-error announce). announceA11yError writes _live.textContent
 * (a replace) on an aria-live="polite" region, so a CHANGED string re-announces.
 *
 * Also (parity, #B89): the refresh loop now skips the `stack` key when building message <p>s,
 * matching the first-error branch — without it a stray stack could render as a <p> AND feed the
 * new announce.
 *
 * Strategy (same convention as validator-aria-invalid): jsdom exercises faithful replicas of the
 * real announceA11yError + the refresh-branch announce/loop; a source-inspection block pins the
 * production source to the same shape so the replicas cannot silently drift.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var { JSDOM } = require('jsdom');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var mainSrc = fs.readFileSync(MAIN, 'utf8');


// --- Faithful replica of announceA11yError (main.js ~595-612) ---
function announceA11yError(win, $form, text) {
    if ( !$form || !text ) return null;
    var _fid    = ( typeof($form.id) != 'undefined' && $form.id ) ? $form.id : ( $form.getAttribute('id') || 'form' );
    var _liveId = 'gina-aria-live-' + _fid;
    var _live   = win.document.getElementById(_liveId);
    if ( !_live ) {
        _live = win.document.createElement('div');
        _live.id = _liveId;
        _live.setAttribute('role', 'status');
        _live.setAttribute('aria-live', 'polite');
        _live.setAttribute('aria-atomic', 'true');
        _live.className = 'gina-visually-hidden';
        $form.appendChild(_live);
    }
    _live.textContent = text;
    return _live;
}

// --- Replica of the refresh-branch: rebuild $err from errors[name] (stack-skipped,
//     #B178 distinct-text dedup), then the guarded announce with #B178's joined text.
//     `announce` toggles the #B89 addition for the subtract test. ---

// #B178 replica of getA11yAnnounceText — per-message texts joined with '. '
function getA11yAnnounceText($err) {
    var $msgs = $err.getElementsByTagName('p');
    if ( !$msgs.length ) {
        return $err.textContent;
    }
    var parts = [];
    for (var m = 0, mLen = $msgs.length; m < mLen; ++m) {
        parts.push($msgs[m].textContent);
    }
    return parts.join('. ');
}

function refreshBranch(win, $form, $el, errors, name, fieldName, isWarning, activeEl, opts) {
    opts = opts || {};
    var $err = win.document.createElement('div');
    $err.className = 'form-item-error-message';
    var _renderedMsgs = {};                                  // #B178 distinct-text dedup
    for (var e in errors[name]) {
        if (e != 'stack' && typeof(_renderedMsgs[ errors[name][e] ]) == 'undefined') { // #B89 parity with first-error branch
            _renderedMsgs[ errors[name][e] ] = true;
            var $msg = win.document.createElement('p');
            $msg.appendChild( win.document.createTextNode(errors[name][e]) );
            $err.appendChild($msg);
        }
    }
    $form.appendChild($err);
    // #B89 announce (guard mirrors the first-error branch)
    if ( opts.announce !== false
        && !isWarning
        && typeof(fieldName) != 'undefined'
        && $err
        && $el !== activeEl ) {
        announceA11yError(win, $form, getA11yAnnounceText($err));
    }
    return $err;
}

function setupDom() {
    var dom = new JSDOM(`<!DOCTYPE html><html><body>
        <form id="contact">
            <input id="required" name="required" type="text" required>
            <input id="other"    name="other"    type="text">
        </form>
    </body></html>`);
    var win = dom.window, d = win.document;
    return { win: win, form: d.getElementById('contact'), required: d.getElementById('required'), other: d.getElementById('other') };
}
function liveText(ctx) {
    var el = ctx.win.document.getElementById('gina-aria-live-contact');
    return el ? el.textContent : null;
}


describe('01 - the refresh branch re-announces the NEW message (the #B89 fix)', function () {
    it('updates the live region from OLD to the refreshed NEW message', function () {
        var ctx = setupDom();
        // first error announced OLD (simulate the first-error branch announce)
        announceA11yError(ctx.win, ctx.form, 'Cannot be left empty');
        assert.equal(liveText(ctx), 'Cannot be left empty');
        // refresh with a NEW label (late setErrorLabels, or a different failing rule); focus has left the field
        refreshBranch(ctx.win, ctx.form, ctx.required, { required: { isRequired: 'This field is required' } },
            'required', 'required', false, ctx.other);
        assert.equal(liveText(ctx), 'This field is required', 'the live region must reflect the refreshed message');
    });

    it('SUBTRACT: without the refresh-branch announce, the region keeps the OLD string (proves the fix is load-bearing)', function () {
        var ctx = setupDom();
        announceA11yError(ctx.win, ctx.form, 'Cannot be left empty');
        refreshBranch(ctx.win, ctx.form, ctx.required, { required: { isRequired: 'This field is required' } },
            'required', 'required', false, ctx.other, { announce: false });
        assert.equal(liveText(ctx), 'Cannot be left empty', 'pre-fix: the region stays stale');
    });
});


describe('02 - the refresh announce respects the first-error branch guard', function () {
    it('does NOT announce a soft live-check warning (isWarning=true)', function () {
        var ctx = setupDom();
        refreshBranch(ctx.win, ctx.form, ctx.required, { required: { isRequired: 'x' } }, 'required', 'required', true, ctx.other);
        assert.equal(liveText(ctx), null, 'a soft warning must not be announced');
    });

    it('does NOT announce while the field is still the active element (mid-typing)', function () {
        var ctx = setupDom();
        // $el === activeEl → focus has NOT left the field yet
        refreshBranch(ctx.win, ctx.form, ctx.required, { required: { isRequired: 'x' } }, 'required', 'required', false, ctx.required);
        assert.equal(liveText(ctx), null, 'no announce until focus leaves the field');
    });

    it('does NOT announce on a full-form pass (fieldName undefined)', function () {
        var ctx = setupDom();
        refreshBranch(ctx.win, ctx.form, ctx.required, { required: { isRequired: 'x' } }, 'required', undefined, false, ctx.other);
        assert.equal(liveText(ctx), null, 'the announce is the per-field/blur path only');
    });
});


describe('03 - stack-key parity: the refresh loop skips `stack` (so it is neither rendered nor announced)', function () {
    it('does not render a `stack` entry as a <p>, and it never reaches the live region', function () {
        var ctx = setupDom();
        var errs = { required: { isRequired: 'This field is required', stack: 'Error\n    at leak (secret.js:1:1)' } };
        var $err = refreshBranch(ctx.win, ctx.form, ctx.required, errs, 'required', 'required', false, ctx.other);
        assert.equal($err.getElementsByTagName('p').length, 1, 'only the real message renders, not stack');
        assert.equal($err.textContent, 'This field is required');
        assert.ok(!/\n\s+at\s/.test(liveText(ctx)), 'the live region must not carry a stack trace');
    });

    it('SUBTRACT: without the guard, `stack` renders AND feeds the announce', function () {
        var ctx = setupDom();
        var errs = { required: { isRequired: 'This field is required', stack: 'Error\n    at leak (secret.js:1:1)' } };
        // reproduce the pre-fix loop (no stack skip)
        var $err = ctx.win.document.createElement('div');
        for (var e in errs.required) {
            var $msg = ctx.win.document.createElement('p');
            $msg.appendChild(ctx.win.document.createTextNode(errs.required[e]));
            $err.appendChild($msg);
        }
        assert.equal($err.getElementsByTagName('p').length, 2, 'pre-fix: stack renders as a second <p>');
        assert.ok(/\n\s+at\s/.test($err.textContent), 'pre-fix: $err.textContent carries the stack');
    });
});


describe('04 - source pins: the production refresh branch matches the replicas', function () {
    it('announceA11yError writes textContent (replace) on an aria-live="polite" region', function () {
        assert.match(mainSrc, /_live\.setAttribute\(\s*'aria-live'\s*,\s*'polite'\s*\)/, 'region must be polite');
        assert.match(mainSrc, /_live\.textContent\s*=\s*text/, 'announce must REPLACE textContent so a changed string re-announces');
    });

    it('the joined-text announce call now appears in BOTH the first-error and refresh branches', function () {
        // #B178 — the announce argument is getA11yAnnounceText($err), not raw textContent
        var calls = mainSrc.match(/announceA11yError\(\s*\$form\s*,\s*getA11yAnnounceText\(\s*\$err\s*\)\s*\)/g) || [];
        assert.equal(calls.length, 2, 'first-error branch + refresh branch (#B89)');
    });

    it('the refresh-branch announce carries the #B89 marker and the first-error guard', function () {
        var b89 = mainSrc.indexOf('#B89 — re-announce the REFRESHED message');
        assert.ok(b89 >= 0, 'expected the #B89 refresh-announce comment');
        // the guard (mirrors the first-error announce) sits between the marker and the call
        var callIdx  = mainSrc.indexOf('announceA11yError($form, getA11yAnnounceText($err))', b89);
        assert.ok(callIdx > b89, 'the announce call follows the #B89 marker');
        var guard = mainSrc.slice(b89, callIdx);
        assert.match(guard, /!isWarning/, 'committed errors only');
        assert.match(guard, /typeof\(fieldName\) != 'undefined'/, 'per-field/blur path only');
        assert.match(guard, /\$el !== document\.activeElement/, 'only once focus has left the field');
    });

    it('the `stack` skip guard now appears in BOTH message loops (first-error + refresh)', function () {
        // #B178 — the guard gained the distinct-text dedup conjunct
        var guards = mainSrc.match(/if\s*\(\s*e\s*!=\s*'stack'\s*&&\s*typeof\(_renderedMsgs\[/g) || [];
        assert.ok(guards.length >= 2, 'both writer branches must skip the stack key (parity, #B89)');
    });
});
