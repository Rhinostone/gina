/**
 * #B79 — Validator popin redirect: content-first open (blind-open timer removed)
 *
 * The validator's XHR-success redirect intercept (`Validator::Popin now redirecting`,
 * core/plugins/lib/validator/src/main.js) resolves a target popin and calls
 * `$popin.load(name, url, options)`. popinLoad RETURNS `{ open }` — invoking `open()`
 * arms a one-shot `loaded.<id>` listener that injects the response body FIRST and
 * then opens the popin (content-first; popin/main.js "Site D"). The validator used
 * to DISCARD that return and instead schedule a blind 50 ms `open()` when the popin
 * was not already open. Because an XHR completion against a CLOSED popin only fires
 * the `loaded.<id>` event (no direct injection), the discarded handle meant:
 *   - XHR faster than the timer  -> the event fired with no listener armed: the body
 *     was PERMANENTLY LOST and the timer then opened an EMPTY popin;
 *   - XHR slower than the timer  -> the popin opened empty first (flash), and the
 *     completing XHR direct-injected via the ACTIVE-popin lookup — which can resolve
 *     a DIFFERENT, still-open popin (its close had silently bailed on isRedirecting),
 *     landing the body in the wrong popin.
 * The fix captures the load handle, arms it inside the existing not-open gate
 * (replacing the timer body; the early `return` is preserved so the form's
 * `success.<id>` consumer events keep their prior emission behavior), guards the
 * no-handle case (popinLoad returns undefined when the request could not start,
 * e.g. CORS unsupported), and lets the cross-popin branch's close of the ORIGINAL
 * popin actually run by resetting `isRedirecting` first (popinClose ignores a
 * redirecting popin — the same reset-then-close idiom the `result.popin.close`
 * branch already used).
 *
 * The same-popin branch on an OPEN popin is untouched: no listener is armed there
 * (the direct-inject path already swaps the content in place) and the timer was
 * never scheduled there.
 *
 * Reachability note (measured in a real browser against the built bundle): the
 * cross-popin branch used to throw at its own pre-existing `getPopinByName`
 * guard before reaching the load, because the published `gina.popin` was
 * re-assembled with a target-wins `merge()` whose accessors stayed bound to the
 * first Popin instance's registry — so the blind timer could not actually fire
 * there either. That registry defect is fixed (#B90: module-shared registry +
 * publish-once + activePopinId write-through — see popin-registry.test.js), and
 * the content-first arm IS now browser-verified end-to-end: a form submit
 * redirecting into a different popin closes the original and opens the target
 * with the tunneled body injected first. The replicas below still model the
 * popin contract in isolation.
 *
 * Usage: node --test test/core/validator-popin-redirect.test.js
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var VALIDATOR_SRC = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_JS       = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_JS   = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var _src, _distSrc, _distMinSrc;
function getSrc()        { return _src        || (_src        = fs.readFileSync(VALIDATOR_SRC, 'utf8')); }
function getDistSrc()    { return _distSrc    || (_distSrc    = fs.readFileSync(DIST_JS, 'utf8')); }
function getDistMinSrc() { return _distMinSrc || (_distMinSrc = fs.readFileSync(DIST_MIN_JS, 'utf8')); }


// ── 01 — #B79 source pins: content-first handle replaces the blind open ───────

describe('01 - Validator popin redirect (#B79): source pins', function () {

    it('declares the load handle beside popinUrl', function () {
        assert.ok(
            getSrc().indexOf('var _popinLoadHandle = null;') > -1,
            'expected the _popinLoadHandle declaration in the redirect block'
        );
    });

    it('both redirect branches capture the popinLoad return', function () {
        var m = getSrc().match(/_popinLoadHandle = \$popin\.load\(\$popin\.name, popinUrl, \$popin\.options\);/g);
        assert.ok(m && m.length === 2,
            'expected exactly 2 handle-captured $popin.load calls (cross-popin + same-popin), got ' + (m ? m.length : 0));
    });

    it('the not-open tail arms the handle content-first and keeps the early return', function () {
        var src = getSrc();
        var gateIdx = src.indexOf('if ($popin && !$popin.isOpen) {');
        assert.ok(gateIdx > -1, 'the not-open tail gate is missing');
        var block = src.substring(gateIdx, gateIdx + 1200);
        assert.match(
            block,
            /if \( _popinLoadHandle && typeof\(_popinLoadHandle\.open\) != 'undefined' \) \{\s*\n\s*_popinLoadHandle\.open\(\);/,
            'expected the guarded content-first open() inside the not-open gate'
        );
        var openIdx = block.indexOf('_popinLoadHandle.open();');
        var retIdx  = block.indexOf('return;', openIdx);
        assert.ok(openIdx > -1 && retIdx > openIdx,
            'expected the early return; after the guarded open() (success.<id> emission behavior preserved)');
    });

    it('the blind timed open is gone file-wide', function () {
        var src = getSrc();
        assert.ok(src.indexOf('onPopinredirect') < 0,
            'the blind-timer callback name must be gone from the validator source');
        assert.ok(src.indexOf(', 50, $popin') < 0,
            'the 50 ms timed-open argument shape must be gone from the validator source');
        var gateIdx = src.indexOf('if ($popin && !$popin.isOpen) {');
        var block = src.substring(gateIdx, gateIdx + 1200);
        assert.doesNotMatch(block, /setTimeout/,
            'the not-open tail must not schedule any timer');
    });

    it('the cross-popin branch actually closes the original popin (reset-then-close idiom)', function () {
        var src = getSrc();
        var i = src.indexOf('popinName != result.popin.name');
        assert.ok(i > -1, 'cross-popin branch condition not found');
        var slice = src.substring(i, i + 700);
        assert.match(
            slice,
            /\$popin\.isRedirecting = false;\s*\n\s*\$popin\.close\(\);/,
            'expected the isRedirecting reset immediately before the cross-popin close (popinClose ignores a redirecting popin)'
        );
    });
});


// ── 02 — #B79 behavioral replicas: content-first vs the blind-timer race ──────
//
// Deterministic replicas — event ordering is driven explicitly (no real timers),
// mirroring the popin contract verified at popin/main.js: popinLoad returns
// { open } arming a one-shot loaded-listener (inject THEN open); a completion
// against a CLOSED popin is event-only (an unarmed event drops the body);
// popinClose bails on isRedirecting.

describe('02 - Validator popin redirect (#B79): behavioral replicas', function () {

    function makePopin(name) {
        return { name: name, isOpen: false, isRedirecting: false, target: { innerHTML: '' }, listeners: [] };
    }

    function makeLoad($popin) {
        var body = null;
        function fireLoaded() {
            var ls = $popin.listeners.slice();
            if (!ls.length) { return false; } // event fires into the void — body dropped
            for (var i = 0; i < ls.length; i++) { ls[i](body); }
            return true;
        }
        return {
            handle: {
                open: function () {
                    var fired = false;
                    $popin.listeners.push(function (b) {
                        if (fired) { return; }
                        fired = true;
                        $popin.target.innerHTML = b; // inject first…
                        $popin.isOpen = true;        // …then open (content-first)
                    });
                }
            },
            completeXhr: function (b) { body = b; return fireLoaded(); }
        };
    }

    it('fixed shape: the armed handle opens content-first even when the XHR is fast', function () {
        var $b = makePopin('b');
        var load = makeLoad($b);
        var _popinLoadHandle = load.handle;
        // the fixed tail: arm inside the not-open gate
        if ($b && !$b.isOpen) {
            if (_popinLoadHandle && typeof(_popinLoadHandle.open) != 'undefined') {
                _popinLoadHandle.open();
            }
        }
        var delivered = load.completeXhr('<p>content</p>');
        assert.equal(delivered, true, 'the loaded event must find the armed listener');
        assert.equal($b.target.innerHTML, '<p>content</p>');
        assert.equal($b.isOpen, true, 'opened with content already injected');
    });

    it('subtract: the pre-fix discarded handle loses the body when the XHR beats the timer', function () {
        var $b = makePopin('b');
        var load = makeLoad($b);
        // pre-fix: the popinLoad return was DISCARDED — no listener armed
        var delivered = load.completeXhr('<p>content</p>'); // XHR completes before 50 ms
        assert.equal(delivered, false, 'the loaded event fired into the void');
        // …then the blind timer opens whatever is in the target
        if (!$b.isOpen) { $b.isOpen = true; }
        assert.equal($b.isOpen, true);
        assert.equal($b.target.innerHTML, '', 'the popin opened EMPTY — the body was permanently lost');
    });

    it('subtract: with a slower XHR the pre-fix timer opens empty first, then the active-popin lookup can inject into the WRONG popin', function () {
        var $a = makePopin('a'); $a.isOpen = true; // original popin: its close silently bailed on isRedirecting
        var $b = makePopin('b');
        // timer fires first: blind-open b, empty
        if (!$b.isOpen) { $b.isOpen = true; }
        assert.equal($b.target.innerHTML, '', 'empty flash: opened before the content arrived');
        // completion direct-injects via the ACTIVE-popin lookup — first OPEN popin wins
        var active = [$a, $b].filter(function (p) { return p.isOpen; })[0];
        active.target.innerHTML = '<p>content</p>';
        assert.equal($a.target.innerHTML, '<p>content</p>',
            "the ORIGINAL still-open popin received the new popin's body (active-popin map-order hazard)");
        assert.equal($b.target.innerHTML, '', 'the intended popin stayed empty');
    });

    it('no handle (request could not start): the guard skips, nothing throws, the popin stays closed', function () {
        var $b = makePopin('b');
        var _popinLoadHandle; // popinLoad returned undefined (xhr null — CORS unsupported)
        assert.doesNotThrow(function () {
            if ($b && !$b.isOpen) {
                if (_popinLoadHandle && typeof(_popinLoadHandle.open) != 'undefined') {
                    _popinLoadHandle.open();
                }
            }
        });
        assert.equal($b.isOpen, false, 'no blind open on a failed load — the error event is the only signal');
    });

    it('reset-then-close: the original popin actually closes in the cross-popin branch', function () {
        function popinCloseReplica($p) {
            if (!$p.isOpen) { return; }
            if ($p.isRedirecting) { return; } // popin/main.js popinClose bail
            $p.isOpen = false;
        }
        // pre-fix: isRedirecting was set just above the close — the close silently bailed
        var $a1 = makePopin('a'); $a1.isOpen = true; $a1.isRedirecting = true;
        popinCloseReplica($a1);
        assert.equal($a1.isOpen, true, 'pre-fix: the close was a silent no-op');
        // fixed: reset first (the result.popin.close branch idiom), then close
        var $a2 = makePopin('a'); $a2.isOpen = true; $a2.isRedirecting = true;
        $a2.isRedirecting = false;
        popinCloseReplica($a2);
        assert.equal($a2.isOpen, false, 'reset-then-close actually closes the original popin');
    });
});


// ── 03 — #B79 dist fidelity: the served bundles carry the fix ─────────────────

describe('03 - Validator popin redirect (#B79): dist fidelity', function () {

    it('unminified dist bundle carries the handle and no blind-timer callback', function () {
        var dist = getDistSrc();
        assert.ok(dist.indexOf('_popinLoadHandle') > -1,
            'rebuild the bundle: _popinLoadHandle missing from dist gina.js');
        assert.ok(dist.indexOf('onPopinredirect') < 0,
            'rebuild the bundle: the blind-timer callback is still in dist gina.js');
    });

    it('served gina.min.js redirect region loads-then-arms with no timed open', function () {
        var min = getDistMinSrc();
        var i = min.indexOf('Popin now redirecting [1-c]');
        assert.ok(i > -1, 'validator redirect marker missing from gina.min.js');
        var win = min.substring(i, i + 800);
        assert.doesNotMatch(win, /setTimeout/,
            'a timed open survives in the served bundle — rebuild from source');
        assert.match(win, /\.load\(/, 'the redirect load is missing from the served bundle');
        assert.match(win, /\.open\(\)/, 'the content-first open() is missing from the served bundle');
    });
});
