'use strict';
/**
 * lib/merge must not THROW on a null (or hole) element of an id-keyed array,
 * wherever the element sits and on either operand (#B443).
 *
 * The read-side residual of the #B437 fix: `typeof null == 'object'`, so a null
 * element passed every typeof-object test and the very next access dereferenced
 * it. Seven shapes threw `TypeError: Cannot read properties of null`, across
 * five distinct sites in `mergeArray`:
 *
 *   - both collection ENTRY guards null-checked the source operand and not the
 *     target operand, so a null first target element threw inside the guard
 *     itself (the shape reported against the published artifact);
 *   - both id-ROSTER loops dereferenced every target element, so a null at any
 *     LATER index threw after the entry guard had passed;
 *   - the override WALK dereferenced both operands per step, so a null source
 *     element threw there too;
 *   - the per-element collection tests null-guarded the target side (a regex
 *     test) and not the source side.
 *
 * The fix mirrors the file's existing null-guard idiom at all of those points:
 * a null element has no key, so it can match nothing, block nothing and
 * contribute nothing — every guard either skips the element or fails the
 * comparison the way an absent key already does. No branch semantics changed:
 * every previously-working shape is pinned byte-identical below.
 *
 * Covered (BEHAVIOURAL unless marked — the real lib is driven):
 *   01  the seven throwing shapes no longer throw; their results are pinned
 *       (RED pre-fix: all seven throw on the pre-fix bytes)
 *   02  neighbouring shapes are byte-identical (controls, green either way)
 *   03  source pins: the guard set, counted comment-stripped (RED pre-fix)
 *   04  dist pins: the browser bundle carries the guards (RED before rebuild)
 *
 * Red-first: every §01 arm was validated THROWING against a loadable copy of
 * the `git show HEAD:` pre-fix bytes (JSON.clone pre-seeded so the module's
 * own __dirname-relative fallback require is skipped), and every §02 control
 * returned the same value on both revisions. §03 counts were derived from BOTH
 * corpora, never guessed — `options[a] != null` is 2 pre-fix already (the
 * index-merge and ownPropertyNames guards), so its pin is 4, not 2.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FRAMEWORK = path.resolve(require('../fw'));
var MAIN_SRC  = path.join(FRAMEWORK, 'lib/merge/src/main.js');
var DIST_JS   = path.join(FRAMEWORK, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN  = path.join(FRAMEWORK, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
var merge     = require(path.join(FRAMEWORK, 'lib/merge'));


// ─── 01  the seven throwing shapes ───────────────────────────────────────────
describe('01 - a null array element no longer throws, on either operand (#B443)', function () {

    it('T1: null at target[0] (the reported shape) - target slots win, source not appended', function () {
        var out;
        assert.doesNotThrow(function () { out = merge([null, null], [{ id: 1 }, { id: 2 }]); });
        // Consistent with the shipped mixed-shape semantics: a target whose
        // slots are primitives/null keeps them (compare ['v2','v2'] in §02).
        assert.deepEqual(out, [null, null]);
    });

    it('T2: null at a LATER target index - the roster loop skips it', function () {
        var out;
        assert.doesNotThrow(function () { out = merge([{ id: 9 }, null], [{ id: 1 }, { id: 2 }]); });
        // The walk appends at most one source item per visited target slot and
        // the null slot is skipped, so {id:1} lands and {id:2} does not - the
        // existing cursor semantics, unchanged by this fix.
        assert.deepEqual(out, [{ id: 9 }, null, { id: 1 }]);
    });

    it('T3: null at target[0] with an object behind it - matches the mixed-shape sibling', function () {
        var out;
        assert.doesNotThrow(function () { out = merge([null, { id: 9 }], [{ id: 1 }]); });
        // Same disposition as the pre-existing primitive-first sibling:
        // ['x',{id:9}] + [{id:1}] returns ['x'] on the unmodified branch (§02).
        assert.deepEqual(out, [null]);
    });

    it('T4: null at options[0] - the per-element source-side guard skips it', function () {
        var out;
        assert.doesNotThrow(function () { out = merge([{ id: 9 }], [null, { id: 1 }]); });
        assert.deepEqual(out, [{ id: 9 }, { id: 1 }]);
    });

    it('T5: override - null at target[0] falls to the replace branch', function () {
        var out;
        assert.doesNotThrow(function () { out = merge([null, { id: 9 }], [{ id: 1 }], true); });
        // Not a comparable collection once the target-side guard fails:
        // override replaces wholesale, the branch's existing else semantics.
        assert.deepEqual(out, [{ id: 1 }]);
    });

    it('T6: override - null at a later target index, both source items land', function () {
        var out;
        assert.doesNotThrow(function () { out = merge([{ id: 9 }, null], [{ id: 1 }, { id: 2 }], true); });
        assert.deepEqual(out, [{ id: 9 }, null, { id: 1 }, { id: 2 }]);
    });

    it('T7: override - null at a later source index, the walk cursor skips it', function () {
        var out;
        assert.doesNotThrow(function () { out = merge([{ id: 9 }], [{ id: 1 }, null], true); });
        assert.deepEqual(out, [{ id: 9 }, { id: 1 }]);
    });
});


// ─── 02  controls: previously-working shapes are byte-identical ──────────────
describe('02 - neighbouring shapes unchanged (controls, green on both revisions)', function () {

    it('the #B437 shape: a repeated-primitive target still wins', function () {
        assert.deepEqual(merge(['v2', 'v2'], [{ id: 1 }, { id: 2 }]), ['v2', 'v2']);
    });

    it('clean id-keyed collections still merge', function () {
        assert.deepEqual(merge([{ id: 9 }], [{ id: 1 }]), [{ id: 9 }, { id: 1 }]);
        assert.deepEqual(
            merge([{ id: 3, v: 1 }, { id: 0 }], [{ id: 3, v: 9 }]),
            [{ id: 3, v: 1 }, { id: 0 }]
        );
    });

    it('a null at a later SOURCE index was already tolerated (the walk breaks on it)', function () {
        assert.deepEqual(merge([{ id: 9 }], [{ id: 1 }, null]), [{ id: 9 }, { id: 1 }]);
    });

    it('all-null and no-key shapes never entered the collection branches', function () {
        assert.deepEqual(merge([null], [null]), [null]);
        assert.deepEqual(merge([null], [{ x: 1 }]), [null]);
        assert.deepEqual(merge([1, 2], [3, 4]), [1, 2, 3, 4]);
    });

    it('override with a null source head was already tolerated (entry guard fails to replace)', function () {
        assert.deepEqual(merge([{ id: 9 }], [null, { id: 1 }], true), [null, { id: 1 }]);
        assert.deepEqual(merge([{ id: 9 }], [{ id: 1 }], true), [{ id: 9 }, { id: 1 }]);
    });

    it('the mixed-shape sibling that anchors the T3 pin', function () {
        // Pre-existing on the unmodified per-element branch: an object behind a
        // primitive head is dropped. T3 is this exact semantic with null as the head.
        assert.deepEqual(merge(['x', { id: 9 }], [{ id: 1 }]), ['x']);
        assert.deepEqual(merge(['x', 'y'], [{ id: 1 }]), ['x', 'y']);
    });
});


// ─── 03  source pins ─────────────────────────────────────────────────────────
// Counts are comment-stripped (the fix's own comments deliberately avoid the
// guard literals, and the anti-vacuity arm proves the strip left the code in).
describe('03 - source pins: the #B443 guard set (counted, comment-stripped)', function () {
    var src      = fs.readFileSync(MAIN_SRC, 'utf8');
    var codeOnly = src.split('\n').map(function (l) { return l.replace(/\/\/.*$/, ''); }).join('\n');

    function count(hay, needle) { return hay.split(needle).length - 1; }

    it('anti-vacuity: the stripped view still carries the mergeArray body', function () {
        assert.ok(codeOnly.indexOf('var mergeArray = function(options, target, override)') > -1,
            'comment stripping emptied the corpus - every count below would be void');
    });

    it('both entry guards null-check the target operand (0 pre-fix)', function () {
        assert.equal(count(codeOnly, 'target[0] != null'), 2);
    });

    it('the per-element collection tests null-check the source operand (2 pre-fix: the index-merge and ownPropertyNames guards)', function () {
        assert.equal(count(codeOnly, 'options[a] != null'), 4);
    });

    it('both roster loops skip a null element (0 pre-fix)', function () {
        assert.equal(count(codeOnly, 'if (newTarget[nt] == null) { continue; }'), 1);
        // one in the non-override roster, one in the non-override walk:
        assert.equal(count(codeOnly, 'if (newTarget[a] == null) { continue; }'), 2);
    });

    it('the override walk skips null on both operands (0 pre-fix)', function () {
        assert.equal(count(codeOnly, 'if (target[n] == null) { continue; }'), 1);
        assert.equal(count(codeOnly, 'if (_options[a] == null) { continue; }'), 1);
    });

    it('premise pins: the pre-existing guards are untouched (green on both revisions)', function () {
        assert.equal(count(codeOnly, '_options[n] != null'), 2, 'the non-override walk source guards');
        assert.equal(count(codeOnly, 'newTarget[a] !== null'), 1, 'the #B437 occupied-slot guard');
    });
});


// ─── 04  dist pins ───────────────────────────────────────────────────────────
// Derived from the EMITTED artifact, never guessed (Closure De-Morganed the
// per-element guards into `||` chains and kept the entry guards in `&&` source
// order). Identifier-agnostic (backreferences bind operand and index) and
// wrap-agnostic (`\s*` at token boundaries). Validated against the pre-fix
// artifact via `git show HEAD:<dist>`: per-element pair 0 -> 2, entry &&-form
// 2 -> 4 (the pre-existing 2 are the options-side guards, so the count moving
// by exactly the added target-side pair is the discrimination).
describe('04 - dist pins: the browser bundle carries the #B443 guards', function () {

    it('the unminified bundle carries the guard set verbatim', function () {
        var js = fs.readFileSync(DIST_JS, 'utf8');
        assert.equal(js.split('target[0] != null').length - 1, 2, 'entry guards in gina.js');
        assert.equal(js.split('if (newTarget[nt] == null) { continue; }').length - 1, 1, 'roster guard (override) in gina.js');
        assert.equal(js.split('if (newTarget[a] == null) { continue; }').length - 1, 2, 'roster + walk guards in gina.js');
        assert.equal(js.split('if (target[n] == null) { continue; }').length - 1, 1, 'override walk target guard in gina.js');
        assert.equal(js.split('if (_options[a] == null) { continue; }').length - 1, 1, 'override walk source guard in gina.js');
    });

    it('the minified bundle carries both guard families (0 and 2 pre-fix respectively)', function () {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        var perElement = min.match(/typeof\s+(\w+)\[(\w+)\]\s*==\s*'undefined'\s*\|\|\s*\1\[\2\]\s*==\s*null/g) || [];
        var entry      = min.match(/typeof\s+(\w+)\[0\]\s*==\s*'object'\s*&&\s*\1\[0\]\s*!=\s*null/g) || [];
        assert.equal(perElement.length, 2, 'De-Morganed per-element source-side guards in gina.min.js');
        assert.equal(entry.length, 4, 'entry guards: 2 pre-existing options-side + the 2 added target-side');
        // anti-vacuity: the merge region itself is still in the bundle
        assert.equal(min.split('getKeyComparison').length - 1, 2, 'the array-merge region vanished from the bundle');
    });
});
