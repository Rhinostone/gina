'use strict';

/**
 * #B309 — the send-settle releases must REPLAY the live-check gate's last
 * verdict on <a> submit triggers instead of blanket-removing aria-disabled.
 *
 * THE DEFECT. On an <a data-gina-form-submit="true"> trigger the live-check
 * gate (updateSubmitTriggerState) and send()'s in-flight lock SHARE the
 * aria-disabled attribute with opposite lifecycles: the gate marks while the
 * form is invalid, the lock marks for the request window. Both settle
 * releases — the `loadend` fail-safe and the readyState-4 twin — removed the
 * attribute unconditionally, and nothing re-marks after settle (send()
 * contains no gate-refresh call sites), so a MID-FLIGHT invalidation (the
 * user empties a required field while a request is in flight) was silently
 * un-gated at settle: the `gina-form-submit-disabled` class stayed, the
 * attribute — the half assistive tech and the #B246/#B308 gates read — was
 * gone.
 *
 * THE FIX. updateSubmitTriggerState stamps its verdict on the form instance
 * in BOTH branches (hide -> true, show -> false), so the shadow is in sync
 * with the marker by construction; each release's A-branch replays that
 * stamp: restore `aria-disabled="true"` when the gate last said invalid,
 * remove it otherwise (including the unstamped legacy case — strict
 * `=== true`). Buttons are untouched: their lock is native `disabled`, so a
 * mid-flight aria mark on a button already survived the release. The stray
 * 2nd arguments to the unary removeAttribute in the readyState-4 twin are
 * gone in passing.
 *
 * VERIFICATION SHAPE. §01 pins the stamps + the two replay sites; §02/§03
 * EXECUTE the extracted release blocks (A/button x stamped-true/false/
 * unstamped), because the correctness here is a runtime value — which
 * attribute survives — not a shape; §04 locks the stray-args removal against
 * live code (comment-stripped: the replace-code convention keeps the old
 * lines as `// was:` comments); §05 pins the built bundle (counts measured
 * from the emitted artifact, validated against the pre-fix bundle: the popin
 * plugin owns two more stray-arg sites that are deliberately NOT touched by
 * this fix, so the dist pins count rather than assert absence).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const MAIN = path.join(ROOT, 'framework', 'v' + VERSION,
    'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
const DIST_MIN = path.join(ROOT, 'framework', 'v' + VERSION,
    'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');

const mainSrc = fs.readFileSync(MAIN, 'utf8');

/**
 * Brace-walking block extractor (same technique as
 * validator-xhr-lifecycle.test.js): returns src from the anchor through the
 * matching close of the first `{` after it.
 */
function extractBlock(src, open) {
    var start = src.indexOf(open);
    assert.notStrictEqual(start, -1, 'anchor not found: ' + open);
    var i = src.indexOf('{', start);
    var depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('unbalanced block for anchor: ' + open);
}

/** Live code only: drop full-line `//` comments (the `// was:` records). */
function stripLineComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*\/\//.test(l);
    }).join('\n');
}

/** A recording stub element: enough surface for the release blocks. */
function makeEl(tagName) {
    var attrs = {};
    return {
        tagName: tagName,
        attrs: attrs,
        setAttribute: function (k, v) { attrs[k] = String(v); },
        removeAttribute: function (k) { delete attrs[k]; },
        getAttribute: function (k) {
            return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
        }
    };
}

// ─── the extracted release bodies ───────────────────────────────────────────

var loadendBlock = extractBlock(mainSrc,
    "xhr.addEventListener('loadend', function onSendSettled() {");
var loadendBody = loadendBlock.slice(
    loadendBlock.indexOf('{') + 1, loadendBlock.lastIndexOf('}'));

// The readyState-4 release PREFIX: from the guard through the a11y release —
// response handling below it is out of scope. One brace stays open (the
// guard's), closed here so the slice compiles.
var rs4Start = mainSrc.indexOf('if (xhr.readyState == 4) {');
assert.notStrictEqual(rs4Start, -1, 'readyState-4 anchor exists');
var rs4EndToken = 'releaseSubmitA11y($form, $submitTrigger);';
var rs4End = mainSrc.indexOf(rs4EndToken, rs4Start);
assert.notStrictEqual(rs4End, -1, 'readyState-4 a11y release exists');
var rs4Prefix = mainSrc.slice(rs4Start, rs4End + rs4EndToken.length) + '\n}';

/**
 * Execute one of the extracted release blocks against stubs.
 * @returns {object} calls — how often the release helpers fired.
 */
function runRelease(body, ctx) {
    var calls = { disarm: 0, release: 0 };
    /* eslint-disable no-new-func */
    var fn = new Function(
        'xhr', '$form', '$submitTrigger', 'disarmSubmitLoading', 'releaseSubmitA11y',
        body);
    fn(ctx.xhr || null, ctx.$form, ctx.$submitTrigger,
        function () { calls.disarm++; },
        function () { calls.release++; });
    return calls;
}

/** A form-instance stub mid-flight, with the loading attribute armed. */
function makeForm(gateMarked) {
    var target = makeEl('FORM');
    target.setAttribute('data-gina-form-loading', 'true');
    var $form = { isSending: true, sent: true, target: target };
    if (gateMarked !== undefined) { $form._gateMarked = gateMarked; }
    return $form;
}

// ─── §01 source pins ────────────────────────────────────────────────────────

describe('01 - #B309 source pins', function () {

    var gateFn = extractBlock(mainSrc, 'var updateSubmitTriggerState = function');

    it('01.1 - the show branch stamps false after clearing the marker', function () {
        assert.match(gateFn,
            /classList\.remove\('gina-form-submit-disabled'\);[\s\S]{0,700}?_gateMarked = false;/,
            'show branch must stamp after its clears');
    });

    it('01.2 - the hide branch stamps true after setting the marker', function () {
        assert.match(gateFn,
            /setAttribute\('aria-disabled', 'true'\);\s*\n\s*\$submitTrigger\.classList\.add\('gina-form-submit-disabled'\);[\s\S]{0,200}?_gateMarked = true;/,
            'hide branch must stamp after its marks');
    });

    it('01.3 - exactly TWO replay sites read the stamp (loadend + readyState-4)', function () {
        assert.strictEqual(mainSrc.split('_gateMarked === true').length - 1, 2,
            'the strict verdict test appears at the two releases, nowhere else');
    });

    it('01.4 - the quoted aria restore appears at exactly the gate + the two replays', function () {
        // The in-flight lock arms use the UNQUOTED `true` form, so the quoted
        // literal is unique to the gate write and the two replay restores.
        assert.strictEqual(
            mainSrc.split("setAttribute('aria-disabled', 'true')").length - 1, 3,
            'gate hide-branch + loadend replay + readyState-4 replay');
    });

    it('01.z - control: the pins CAN miss (the pre-fix blanket shape fails them)', function () {
        // The pre-fix loadend A-branch, verbatim: no stamp test, no restore.
        var preFix = "if ( /^A$/i.test($submitTrigger.tagName) ) {\n"
            + "                            $submitTrigger.removeAttribute('aria-disabled');\n"
            + "                        } else {\n"
            + "                            $submitTrigger.removeAttribute('disabled');\n"
            + "                        }";
        assert.strictEqual(preFix.indexOf('_gateMarked'), -1);
        assert.doesNotMatch(preFix, /setAttribute\('aria-disabled', 'true'\)/);
    });
});

// ─── §02 the loadend release, executed ──────────────────────────────────────

describe('02 - loadend release replays the stamped verdict (executed)', function () {

    it('02.1 - <a> trigger, gate said invalid mid-flight: the marker is RESTORED', function () {
        var $form = makeForm(true);
        var $a = makeEl('A');
        $a.setAttribute('aria-disabled', 'true'); // the in-flight lock's mark
        var calls = runRelease(loadendBody, { $form: $form, $submitTrigger: $a });
        assert.strictEqual($a.getAttribute('aria-disabled'), 'true',
            'the gate verdict survives the settle');
        assert.strictEqual($form.isSending, false);
        assert.strictEqual($form.sent, false);
        assert.strictEqual($form.target.getAttribute('data-gina-form-loading'), null);
        assert.deepStrictEqual(calls, { disarm: 1, release: 1 });
    });

    it('02.2 - <a> trigger, gate said valid: the marker is removed', function () {
        var $form = makeForm(false);
        var $a = makeEl('A');
        $a.setAttribute('aria-disabled', 'true');
        runRelease(loadendBody, { $form: $form, $submitTrigger: $a });
        assert.strictEqual($a.getAttribute('aria-disabled'), null,
            'a valid form settles with an operable trigger');
    });

    it('02.3 - <a> trigger, NO stamp (form never gate-evaluated): removed, the legacy behaviour', function () {
        var $form = makeForm(undefined);
        var $a = makeEl('A');
        $a.setAttribute('aria-disabled', 'true');
        runRelease(loadendBody, { $form: $form, $submitTrigger: $a });
        assert.strictEqual($a.getAttribute('aria-disabled'), null,
            'strict === true keeps unstamped forms on the old release path');
    });

    it('02.4 - <button> trigger: native lock released, the gate aria mark untouched', function () {
        var $form = makeForm(true);
        var $btn = makeEl('BUTTON');
        $btn.setAttribute('disabled', 'true');        // the in-flight lock
        $btn.setAttribute('aria-disabled', 'true');   // the gate's mid-flight re-mark
        runRelease(loadendBody, { $form: $form, $submitTrigger: $btn });
        assert.strictEqual($btn.getAttribute('disabled'), null,
            'the native lock is released');
        assert.strictEqual($btn.getAttribute('aria-disabled'), 'true',
            'the gate mark on a button already survives — the replay must not touch it');
    });

    it('02.5 - null trigger: the release still settles the form', function () {
        var $form = makeForm(true);
        var calls = runRelease(loadendBody, { $form: $form, $submitTrigger: null });
        assert.strictEqual($form.isSending, false);
        assert.strictEqual($form.target.getAttribute('data-gina-form-loading'), null);
        assert.deepStrictEqual(calls, { disarm: 1, release: 1 });
    });
});

// ─── §03 the readyState-4 twin, executed ────────────────────────────────────

describe('03 - readyState-4 release stays in step (executed)', function () {

    it('03.1 - <a> trigger, stamped invalid: the marker is restored', function () {
        var $form = makeForm(true);
        var $a = makeEl('A');
        $a.setAttribute('aria-disabled', 'true');
        var calls = runRelease(rs4Prefix,
            { xhr: { readyState: 4 }, $form: $form, $submitTrigger: $a });
        assert.strictEqual($a.getAttribute('aria-disabled'), 'true');
        assert.strictEqual($form.isSending, false);
        assert.deepStrictEqual(calls, { disarm: 1, release: 1 });
    });

    it('03.2 - <a> trigger, stamped valid: the marker is removed', function () {
        var $form = makeForm(false);
        var $a = makeEl('A');
        $a.setAttribute('aria-disabled', 'true');
        runRelease(rs4Prefix, { xhr: { readyState: 4 }, $form: $form, $submitTrigger: $a });
        assert.strictEqual($a.getAttribute('aria-disabled'), null);
    });

    it('03.3 - a non-4 readyState is a no-op for the release prefix', function () {
        var $form = makeForm(true);
        var $a = makeEl('A');
        $a.setAttribute('aria-disabled', 'true');
        var calls = runRelease(rs4Prefix,
            { xhr: { readyState: 2 }, $form: $form, $submitTrigger: $a });
        assert.strictEqual($form.isSending, true, 'nothing settled');
        assert.deepStrictEqual(calls, { disarm: 0, release: 0 });
    });
});

// ─── §04 the stray removeAttribute 2nd args are gone from LIVE code ─────────

describe('04 - stray unary-call 2nd arguments removed', function () {

    it('04.1 - no live removeAttribute carries a 2nd argument (comments excluded)', function () {
        // The replace-code convention keeps the old lines as `// was:` records,
        // so scan live code only.
        var live = stripLineComments(mainSrc);
        assert.strictEqual(live.indexOf("removeAttribute('aria-disabled', true)"), -1,
            'the aria stray-arg call survives as live code');
        assert.strictEqual(live.indexOf("removeAttribute('disabled', true)"), -1,
            'the native stray-arg call survives as live code');
    });

    it('04.z - control: the scan CAN miss (the stripped corpus still carries the strays as comments)', function () {
        assert.notStrictEqual(mainSrc.indexOf("removeAttribute('aria-disabled', true)"), -1,
            'the `// was:` record must exist — otherwise 04.1 proves nothing about stripping');
    });
});

// ─── §05 dist fidelity ──────────────────────────────────────────────────────

describe('05 - dist fidelity (rebuild the bundle if these fail)', function () {

    var dist = fs.readFileSync(DIST_MIN, 'utf8');

    it('05.1 - the stamp property reaches the bundle at its four sites', function () {
        // 2 gate stamps + 2 replay tests. Property names survive Closure SIMPLE;
        // comments are stripped, so the count is exact. Pre-fix bundle: 0.
        assert.strictEqual(dist.split('_gateMarked').length - 1, 4);
    });

    it('05.2 - the validator stray-arg calls are gone; the popin plugin keeps its own pair', function () {
        // Wrap-agnostic counts, measured against the emitted artifact: pre-fix
        // 2+2 (validator readyState-4 + the popin release, single-quoted by
        // Closure); post-fix the validator pair is gone, popin's — a separate,
        // deliberately untouched site — remains.
        var aria = (dist.match(/removeAttribute\(\s*'aria-disabled'\s*,\s*!0\s*\)/g) || []).length;
        var nat = (dist.match(/removeAttribute\(\s*'disabled'\s*,\s*!0\s*\)/g) || []).length;
        assert.strictEqual(aria, 1, 'only the popin site remains');
        assert.strictEqual(nat, 1, 'only the popin site remains');
    });

    it('05.3 - the quoted aria restore ships at the gate + the two replays', function () {
        var n = (dist.match(/setAttribute\(\s*'aria-disabled'\s*,\s*'true'\s*\)/g) || []).length;
        assert.strictEqual(n, 3, 'gate hide-branch + loadend replay + readyState-4 replay');
    });
});
