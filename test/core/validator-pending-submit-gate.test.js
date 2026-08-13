/**
 * #B346 slice 2 — the pending-verdict carve-out on the TRUSTED-submit and
 * programmatic doors, and the pending-window latch on the shared
 * fresh-validate path.
 *
 * What slice 2 changes (slice 1 = the click-proxy carve-out, pinned by the
 * collision suite's §08):
 *  - the submit proxy's #B308 gesture gate consults
 *    `isAwaitingQueryVerdictOnly` before refusing, so a wrapped-label
 *    submission (`<button type="submit"><span>`) inside a pending window
 *    proceeds instead of dying on a reveal with nothing to reveal;
 *  - the #B247 loading arm gets the same carve-out, so the waiting pass is
 *    visibly alive;
 *  - the fresh-validate path LATCHES `isSubmitting` when it proceeds while a
 *    query verdict is pending (belt-mirrored against double entry) — without
 *    the latch that pass STARVES: with the query field not declared last, its
 *    waiter's completion resolves to the needsGlobalReValidation display-only
 *    work and never runs `onSubmitValidation` (measured; the programmatic
 *    `$forms[id].submit()` door starved exactly this way, unreported);
 *  - `onSubmitValidation` releases the latch BEFORE dispatching a consumer
 *    `submit.<id>` — a custom handler may never reach send(), and a latch
 *    riding that dispatch would strand the form (the #B342 lockout shape).
 *
 * These are STRUCTURAL pins (the shape exists, the ordering holds); the
 * behavioural coverage on real bytes lives in the e2e spec
 * (validator-async-query-inflight-submit.spec.js arms 05-07), which drives
 * the shipped bundle in a real browser. Every needle here was validated
 * red-first against the pre-slice-2 bytes (git show) — see the arc ledger.
 */

var { describe, it, before } = require('node:test');
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var pkg = require(path.join(__dirname, '..', '..', 'package.json'));
var FRAMEWORK = path.join(__dirname, '..', '..', 'framework', 'v' + pkg.version);
var MAIN = path.join(FRAMEWORK, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var DIST_MIN = path.join(FRAMEWORK, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');
var DIST_UNMIN = path.join(FRAMEWORK, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.js');

var mainSrc = fs.readFileSync(MAIN, 'utf8');

describe('01 - the trusted-submit gate consults the pending-verdict helper', function () {

    it('01a - the #B308 refusal is narrowed by the helper, negated, on the registered trigger', function () {
        var i = mainSrc.indexOf(
            "isTriggerDisabled($registeredTrigger)\n"
            + "                    && !isAwaitingQueryVerdictOnly($registeredTrigger, $target, $formInstance)"
        );
        assert.ok(i > -1,
            'the trusted-submit gate must carry the #B346 carve-out conjunct');
        // the carve-out must live INSIDE the isTrusted gesture block — the
        // untrusted path never consulted the gate and must not gain one
        var block = mainSrc.indexOf('if ($formInstance && e.isTrusted) {');
        assert.ok(block > -1 && block < i && (i - block) < 900,
            'the conjunct must sit inside the e.isTrusted gesture gate');
    });

    it('01b - the loading arm carries the same carve-out (a waiting pass is visibly alive)', function () {
        assert.ok(mainSrc.indexOf(
            "!isTriggerDisabled($loadingTrigger)\n"
            + "                    || isAwaitingQueryVerdictOnly($loadingTrigger, $target, $formInstance)"
        ) > -1, 'the #B247 loading arm must arm on a pending-verdict bypass');
    });
});

describe('02 - the fresh-validate path latches when it proceeds under a pending verdict', function () {

    // Slice bounded by two unique anchors — no fixed byte windows (they are a
    // standing liability): from the scan declaration to the post-listener
    // `binded` latch.
    var sliceStart, sliceEnd, slice;
    before(function () {
        sliceStart = mainSrc.indexOf("var _pendingSel = '[data-gina-form-validator-query-pending]';");
        sliceEnd = mainSrc.indexOf("instance.$forms[_id]['binded']", sliceStart);
        assert.ok(sliceStart > -1, '[instrument] the scan declaration anchor vanished');
        assert.ok(sliceEnd > sliceStart, '[instrument] the binded terminator anchor vanished');
        slice = mainSrc.substring(sliceStart, sliceEnd);
    });

    it('02a - the owned-field scan covers in-form AND form-reassociated controls', function () {
        assert.ok(slice.indexOf('$target.querySelector(_pendingSel)') > -1,
            'in-form pending lookup missing');
        assert.ok(slice.indexOf('document.querySelector(\'[form="\'+ _safeFormDomId +\'"]\'+ _pendingSel)') > -1,
            'reassociated (form="<id>") pending lookup missing');
    });

    it('02b - belt, then latch, then isValidating — the #B332 mirror precedes the arm', function () {
        var belt = slice.indexOf('if ( /^true$/i.test(instance.$forms[id].isSubmitting) ) {');
        var latch = slice.indexOf('instance.$forms[id].isSubmitting = true;');
        var validating = slice.indexOf('instance.$forms[id].isValidating = true;');
        assert.ok(belt > -1, 'the belt mirror is missing');
        assert.ok(latch > belt, 'the latch must follow the belt');
        assert.ok(validating > latch, 'the isValidating write must follow the latch block');
        // the belt refuses — a return must sit right after it
        assert.match(slice.substring(belt, belt + 140), /return false;/);
    });

    it('02c - the latch is CONDITIONAL on the pending scan — no pending, no latch', function () {
        var cond = slice.indexOf('if (_awaitsQueryVerdict) {');
        var latch = slice.indexOf('instance.$forms[id].isSubmitting = true;');
        assert.ok(cond > -1 && cond < latch,
            'the latch must be guarded by the pending-verdict condition');
    });

    it('02d - onSubmitValidation releases the latch BEFORE any consumer submit.<id> dispatch', function () {
        var cb = slice.indexOf('function onSubmitValidation(result){');
        assert.ok(cb > -1, '[instrument] the callback anchor vanished');
        var cbSlice = slice.substring(cb);
        var gate = cbSlice.indexOf("typeof(gina.events['submit.' + id]) != 'undefined'");
        var release = cbSlice.indexOf('instance.$forms[id].isSubmitting = false;');
        var dispatch = cbSlice.indexOf("triggerEvent(gina, $target, 'submit.' + id, result);");
        assert.ok(gate > -1 && release > -1 && dispatch > -1,
            '[instrument] a callback anchor vanished: ' + gate + '/' + release + '/' + dispatch);
        assert.ok(gate < release && release < dispatch,
            'release must sit between the submit.<id> gate and its dispatch, got: '
            + gate + ' / ' + release + ' / ' + dispatch);
        // and the validate.<id> arm must NOT release — that latch rides to the
        // send / rejected-validation releases (:2203 / #B192)
        var afterSubmitDispatch = cbSlice.substring(dispatch);
        var validateDispatch = afterSubmitDispatch.indexOf("triggerEvent(gina, $target, 'validate.' + id, result);");
        assert.ok(validateDispatch > -1, '[instrument] the validate.<id> dispatch vanished');
        assert.equal(
            afterSubmitDispatch.substring(0, validateDispatch).split('isSubmitting = false').length - 1, 0,
            'no release may precede the validate.<id> dispatch — that latch rides to the send/reject releases');
    });
});

describe('03 - dist fidelity: the rebuilt bundle carries slice 2', function () {

    var distMin, distUnmin;
    before(function () {
        distMin = fs.readFileSync(DIST_MIN, 'utf8');
        distUnmin = fs.readFileSync(DIST_UNMIN, 'utf8');
    });

    it('03a - the bracketed pending-selector literal count moved 4 -> 6', function () {
        // Derived from the emitted artifact (never a guessed Closure shape):
        // pre-slice-2 the helper accounted for 4; slice 2 declares the literal
        // ONCE (`_pendingSel`) and Closure inlines it into BOTH use sites, so
        // the artifact carries 6. Measured with a whole-string count —
        // `grep -o` is line-oriented and undercounts wrapped minified output.
        assert.equal(distMin.split('[data-gina-form-validator-query-pending]').length - 1, 6,
            'expected the two inlined slice-2 selector emissions on top of the four slice-1 ones');
    });

    it('03b - the latch emission survives minification (property names survive SIMPLE)', function () {
        // JS regex \s spans the content-dependent Closure line wrap (#B235:
        // wrap-agnostic from day one).
        assert.equal((distMin.match(/isSubmitting\s*=\s*!0/g) || []).length, 2,
            'bindSubmitEl\'s arm + the #B346 pending-window latch');
    });

    it('03c - the un-minified prod intermediate carries the latch rationale', function () {
        assert.equal((distUnmin.match(/#B346 — this pass may proceed/g) || []).length, 1,
            'the latch comment must ride the RequireJS concat (optimize:"none")');
        assert.doesNotMatch(distMin, /#B346 — this pass may proceed/,
            'and Closure must strip it from the served artifact');
    });
});
