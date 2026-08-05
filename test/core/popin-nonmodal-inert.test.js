'use strict';
/**
 * #A11Y8 — a superseded non-modal popin stayed fully keyboard-reachable behind the new one.
 *
 * `applyNonModalShims()` restores, by hand, what native `showModal()` gives for free — one of
 * those things being `inert` on everything behind the dialog. Its loop walked
 * `document.body.children` and skipped three cases: the dialog itself, any ancestor of it, and
 * `instance.target` — the shared `.gina-popins` container. That third skip was the defect: every
 * popin lives INSIDE that container, and `popinOpen()` never closes the popin it supersedes (it
 * only overwrites `activePopinId`). So opening a second dialog non-modally left the first one
 * untouched — not inerted, not closed, still tabbable behind the one the user is looking at.
 *
 * Non-modal is the DEFAULT of the `data-gina-dialog` API (`resolveModal()`'s framework default is
 * `false`), so this is the ordinary path, not an exotic one. The modal path was never affected —
 * native `showModal()` handles the top layer itself.
 *
 * The fix descends into the container instead of skipping it, and inerts sibling `[open]` dialogs
 * only. Closed ones need nothing: a `<dialog>` without `open` is `display:none` per the UA
 * stylesheet, so it is already unreachable. Teardown needed NO change — `removeNonModalShims()`
 * already sweeps `[data-gina-popin-inert]` document-wide.
 *
 * Strategy follows the house convention (popin.test.js / validator-aria-invalid /
 * validator-a11y-*): jsdom exercises a faithful test-local replica, and a source-inspection block
 * pins production to the same shape so the replica cannot silently drift. Both the FIXED and the
 * PRE-FIX loops are replicated, so the first test below is a genuine subtract — it fails if the
 * old shape is restored.
 *
 * ⚠️ INSTRUMENT LIMIT, stated rather than implied — these tests assert the ATTRIBUTE, never
 * focusability. jsdom implements neither `inert`'s focus-blocking nor `HTMLElement.focus()` on
 * <body>, so "is it actually unreachable by Tab?" is NOT answerable here and no assertion below
 * claims it. That half was measured separately in a real browser (Chrome), with controls firing in
 * both directions: a background button behind an inerted subtree was unfocusable, the active
 * dialog's button stayed focusable, and a CLOSED dialog's button was already unfocusable with no
 * inerting at all — which is why only `[open]` is targeted. What this file verifies is the
 * SELECTION logic — which elements get marked — not the platform behaviour that marking triggers.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var { JSDOM } = require('jsdom');

var FW        = require('../fw');
var POPIN_SRC = path.join(FW, 'core/asset/plugin/src/vendor/gina/popin/main.js');
var DIST_JS   = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var _src, _dist;
function getSrc()  { return _src  || (_src  = fs.readFileSync(POPIN_SRC, 'utf8')); }
function getDist() { return _dist || (_dist = fs.readFileSync(DIST_JS, 'utf8')); }

// String-anchored slice of applyNonModalShims() — never line-based, so it survives edits above.
function getShimBlock(src) {
    var start = src.indexOf('function applyNonModalShims');
    var end   = src.indexOf('function removeNonModalShims', start);
    assert.ok(start > -1, 'applyNonModalShims not found');
    assert.ok(end > start, 'removeNonModalShims not found after applyNonModalShims');
    return src.substring(start, end);
}


// ── replicas ──────────────────────────────────────────────────────────────────
// Test-local replicas of the inert loop in applyNonModalShims($popin, $el) — they MUST mirror
// popin/main.js. `$container` stands in for the closure's `instance.target`. The source pins at
// the end lock production to the FIXED shape.

/** The shipped loop. Descends into the container and inerts sibling OPEN dialogs. */
function inertLoopReplica(doc, $el, $container) {
    var siblings = doc.body.children;
    var b = 0, len = siblings.length;
    for (; b < len; ++b) {
        if ( siblings[b] === $container ) {
            var $open = siblings[b].querySelectorAll('dialog[open]');
            var d = 0, dLen = $open.length;
            for (; d < dLen; ++d) {
                if ( $open[d] === $el || $open[d].contains($el) ) {
                    continue;
                }
                if ( $open[d].getAttribute('inert') == null ) {
                    $open[d].setAttribute('inert', '');
                    $open[d].setAttribute('data-gina-popin-inert', 'true');
                }
            }
            continue;
        }
        if ( siblings[b] === $el || siblings[b].contains($el) ) {
            continue;
        }
        if ( siblings[b].getAttribute('inert') == null ) {
            siblings[b].setAttribute('inert', '');
            siblings[b].setAttribute('data-gina-popin-inert', 'true');
        }
    }
}

/** The PRE-FIX loop, kept only so the first test is a real subtract. Skipped the container whole. */
function inertLoopReplicaPreFix(doc, $el, $container) {
    var siblings = doc.body.children;
    var b = 0, len = siblings.length;
    for (; b < len; ++b) {
        if ( siblings[b] === $el || siblings[b] === $container || siblings[b].contains($el) ) {
            continue;
        }
        if ( siblings[b].getAttribute('inert') == null ) {
            siblings[b].setAttribute('inert', '');
            siblings[b].setAttribute('data-gina-popin-inert', 'true');
        }
    }
}

/** Replica of removeNonModalShims()'s sweep — unchanged by this fix, asserted to still restore. */
function removeShimsReplica(doc) {
    var $inert = doc.querySelectorAll('[data-gina-popin-inert]');
    var b = 0, len = $inert.length;
    for (; b < len; ++b) {
        $inert[b].removeAttribute('inert');
        $inert[b].removeAttribute('data-gina-popin-inert');
    }
}


// ── scene builder ─────────────────────────────────────────────────────────────
// <body>
//   <div id="bg">            <- ordinary background sibling
//   <div class="gina-popins">  <- instance.target
//       <dialog open> ... </dialog>   (one per name in openNames)
//       <dialog>      ... </dialog>   (one per name in closedNames)
function makeScene(openNames, closedNames) {
    var doc = new JSDOM('<!DOCTYPE html><body></body>').window.document;

    var $bg = doc.createElement('div');
    $bg.id = 'bg';
    $bg.innerHTML = '<button id="bg-btn">background</button>';
    doc.body.appendChild($bg);

    var $container = doc.createElement('div');
    $container.setAttribute('class', 'gina-popins');
    doc.body.appendChild($container);

    var dialogs = {};
    (openNames || []).forEach(function (name) {
        var $d = doc.createElement('dialog');
        $d.id = name;
        $d.setAttribute('open', '');
        $d.innerHTML = '<button id="' + name + '-btn">in ' + name + '</button>';
        $container.appendChild($d);
        dialogs[name] = $d;
    });
    (closedNames || []).forEach(function (name) {
        var $d = doc.createElement('dialog');
        $d.id = name;
        $d.innerHTML = '<button id="' + name + '-btn">in ' + name + '</button>';
        $container.appendChild($d);
        dialogs[name] = $d;
    });

    return { doc: doc, $container: $container, $bg: $bg, d: dialogs };
}

function isInerted($el) {
    return $el.getAttribute('inert') != null;
}
function isGinaMarked($el) {
    return $el.getAttribute('data-gina-popin-inert') === 'true';
}


// ── 01 — behavioural (jsdom + replica) ────────────────────────────────────────

describe('01 - #A11Y8: a superseded non-modal popin is inerted behind the active one', function() {

    it('SUBTRACT (pre-fix shape): the superseded dialog is left fully reachable', function() {
        var s = makeScene(['a', 'b']);
        inertLoopReplicaPreFix(s.doc, s.d.b, s.$container);

        assert.equal(isInerted(s.d.a), false,
            'pre-fix, A must NOT be inerted — this is the defect the fix removes. If this ' +
            'assertion fails, the pre-fix replica has drifted and the test below proves nothing.');
        assert.equal(isInerted(s.$bg), true,
            'pre-fix still inerted ordinary background siblings — control proving the ' +
            'pre-fix replica runs at all rather than doing nothing');
    });

    it('the superseded OPEN dialog is inerted and marked', function() {
        var s = makeScene(['a', 'b']);
        inertLoopReplica(s.doc, s.d.b, s.$container);

        assert.equal(isInerted(s.d.a), true, 'A (superseded, still open) must be inerted');
        assert.equal(isGinaMarked(s.d.a), true,
            'A must carry data-gina-popin-inert so removeNonModalShims() can restore it');
    });

    it('the active dialog is never inerted', function() {
        var s = makeScene(['a', 'b']);
        inertLoopReplica(s.doc, s.d.b, s.$container);

        assert.equal(isInerted(s.d.b), false, 'B is the popin the user is looking at');
    });

    it('the container itself is never inerted (it holds the active dialog)', function() {
        var s = makeScene(['a', 'b']);
        inertLoopReplica(s.doc, s.d.b, s.$container);

        assert.equal(isInerted(s.$container), false,
            'inerting .gina-popins wholesale would take the active dialog down with it');
    });

    it('CLOSED sibling dialogs are left alone (already display:none per the UA stylesheet)', function() {
        var s = makeScene(['b'], ['closed']);
        inertLoopReplica(s.doc, s.d.b, s.$container);

        assert.equal(isInerted(s.d.closed), false,
            'a <dialog> without [open] is already unreachable; marking it would be noise ' +
            'and would make teardown strip an attribute it never set');
    });

    it('ordinary background siblings are still inerted (no regression)', function() {
        var s = makeScene(['b']);
        inertLoopReplica(s.doc, s.d.b, s.$container);

        assert.equal(isInerted(s.$bg), true, 'the pre-existing background-inert behaviour stands');
        assert.equal(isGinaMarked(s.$bg), true);
    });

    it('three deep: every superseded dialog is inerted, only the newest stays live', function() {
        var s = makeScene(['a', 'b', 'c']);
        inertLoopReplica(s.doc, s.d.c, s.$container);

        assert.equal(isInerted(s.d.a), true, 'A inerted');
        assert.equal(isInerted(s.d.b), true, 'B inerted');
        assert.equal(isInerted(s.d.c), false, 'C is active');
    });

    it('an app-owned inert is not re-marked, so teardown cannot steal it', function() {
        var s = makeScene(['a', 'b']);
        s.d.a.setAttribute('inert', '');            // set by the consumer, not by gina
        inertLoopReplica(s.doc, s.d.b, s.$container);

        assert.equal(isGinaMarked(s.d.a), false,
            'the `getAttribute(inert) == null` guard means gina only marks what it set itself');
        removeShimsReplica(s.doc);
        assert.equal(isInerted(s.d.a), true, 'the app-owned inert survives gina teardown');
    });

    it('teardown restores the superseded dialog — no change was needed there', function() {
        var s = makeScene(['a', 'b']);
        inertLoopReplica(s.doc, s.d.b, s.$container);
        assert.equal(isInerted(s.d.a), true, 'precondition: A was inerted');

        removeShimsReplica(s.doc);

        assert.equal(isInerted(s.d.a), false, 'A restored');
        assert.equal(isGinaMarked(s.d.a), false, 'marker cleared');
        assert.equal(isInerted(s.$bg), false, 'background restored too');
    });
});


// ── 02 — source-inspection pins (lock production to the replica's shape) ──────

describe('02 - #A11Y8 source: applyNonModalShims descends into the popin container', function() {

    it('the container branch descends to sibling OPEN dialogs instead of skipping', function() {
        var block = getShimBlock(getSrc());
        assert.ok(
            block.indexOf("querySelectorAll('dialog[open]')") > -1,
            'applyNonModalShims must select sibling OPEN dialogs inside instance.target'
        );
        // Deliberately spans from the container test INTO the descent. A bare
        // /siblings\[b\] === instance\.target/ would pass on the pre-fix source too — it
        // appears there inside the combined skip condition — i.e. a pin that cannot fail.
        assert.ok(
            /siblings\[b\]\s*===\s*instance\.target\s*\)\s*\{[\s\S]{0,600}?querySelectorAll\('dialog\[open\]'\)/.test(block),
            'the descent must live INSIDE the instance.target branch, not merely somewhere ' +
            'in the function — otherwise the container could still be skipped wholesale'
        );
    });

    it('the container is no longer folded into the unconditional skip', function() {
        var block = getShimBlock(getSrc());
        assert.equal(
            /===\s*\$el\s*\|\|\s*siblings\[b\]\s*===\s*instance\.target/.test(block), false,
            'the pre-fix condition skipped the container in the same test as the dialog; ' +
            'the container now needs its own branch so it can be descended into'
        );
    });

    it('sibling dialogs are marked with the attribute teardown sweeps', function() {
        var block = getShimBlock(getSrc());
        var marks = block.split("setAttribute('data-gina-popin-inert', 'true')").length - 1;
        assert.equal(marks, 2,
            'expected exactly two mark sites — background siblings and sibling open dialogs — ' +
            'both using the attribute removeNonModalShims() sweeps (found ' + marks + ')'
        );
    });

    it('teardown still sweeps document-wide, so no teardown change is required', function() {
        assert.ok(
            getSrc().indexOf("querySelectorAll('[data-gina-popin-inert]')") > -1,
            'removeNonModalShims() must keep its document-wide sweep, which is what restores ' +
            'dialogs nested inside the container without knowing about them'
        );
    });

    it('dist: the built bundle carries the descent', function() {
        var dist = getDist();
        var start = dist.indexOf("define('gina/popin'");
        assert.ok(start > -1, 'gina/popin AMD module not found in dist bundle');
        var block = dist.substring(start, start + 200000);
        assert.ok(
            block.indexOf("querySelectorAll('dialog[open]')") > -1,
            'the rebuilt dist must carry the fix — a stale bundle ships the defect to browsers'
        );
    });
});
