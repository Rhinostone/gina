'use strict';
/**
 * lib/merge merges a number-carrying array ONCE, and the merge is idempotent (#B436).
 *
 * Staked as "a nested array at depth >= 2 merges TWICE": the depth-1 result
 * `[1,2,3,4]` became `[1,2,3,4,3,4]` one level down. Measured, the root is not
 * the depth. `mergeArray`'s number top-up (the in-code fixture: a = [25];
 * b = [25,25] must give [25,25]) decided "push again" by INDEX — whether the
 * source element differs from the result element at the SAME position — not by
 * COUNT, so any number already present in the target at a shifted index was
 * pushed again at every depth (`merge([9,1],[1])` gave `[9,1,1]`;
 * `{ports:[8080,8124]}` + `{ports:[8124]}` gave `[8080,8124,8124]`), and the
 * merge was not idempotent. The second pass at depth >= 2 (`browse()` merged
 * arrays once in its prop loop and again in the recursion that follows) merely
 * manufactured that index shift; it also cost every nested array a second
 * `mergeArray` walk and, for an array SHARED by target and source at depth >= 2,
 * replaced it with a deduped copy past the #B428 identity guard.
 *
 * Two changes: the top-up compares COUNTS (occurrences of the number in the
 * source so far vs in the result so far), and `browse()`'s prop loop merges
 * arrays only on the createMode path — elsewhere the recursion is the one pass.
 *
 * Covered (BEHAVIOURAL unless marked — the real lib is driven):
 *   01  index-shifted overlaps at the top level and at depth 1 (RED pre-fix)
 *   02  depth >= 2 equals depth 1 (RED pre-fix)
 *   03  idempotence: merging the same source into the result again is a no-op (RED pre-fix)
 *   04  an array shared at depth >= 2 keeps identity and contents — the #B428 residual (RED pre-fix)
 *   05  controls: the number tolerance itself, strings/booleans/null, override,
 *       collections, createMode, the #B437 shapes (green either way)
 *   06  source pins (RED pre-fix)
 *   07  dist pins (RED before the rebuild)
 *
 * The controller-set-path.test.js §04 control that used to fire on this defect through
 * its frozen retired set() is realigned to pin agreement in the same commit; the
 * discrimination burden lives here.
 *
 * Red-first: §01-§04 and §06 fail on the pre-fix bytes, §07 before the prod
 * rebuild; every control is green on both — validated against `git show HEAD:`
 * copies, never a tree revert.
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

/** Wraps `arr` under `depth` object levels: nest(2, a) => { k2: { k1: a } }. */
function nest(depth, arr) { var o = arr; for (var i = 1; i <= depth; i++) { var w = {}; w['k' + i] = o; o = w; } return o; }
function dig(o, depth)    { for (var i = depth; i >= 1; i--) { o = o['k' + i]; } return o; }
function at(depth, t, s)  { return dig(merge(nest(depth, t.slice()), nest(depth, s.slice())), depth); }


// ─── 01  index-shifted overlaps ──────────────────────────────────────────────
describe('01 - a number already in the target at a shifted index is not pushed again', function () {
    it('top level: merge([9,1],[1]) is [9,1]', function () {
        assert.deepEqual(merge([9, 1], [1]), [9, 1]);
    });

    it('depth 1, a configuration shape: {ports:[8080,8124]} + {ports:[8124]} keeps one 8124', function () {
        assert.deepEqual(merge({ ports: [8080, 8124] }, { ports: [8124] }).ports, [8080, 8124]);
    });

    it('depth 1, a partial overlap: [3,1] + [1,2] is [3,1,2]', function () {
        assert.deepEqual(merge({ a: [3, 1] }, { a: [1, 2] }).a, [3, 1, 2]);
    });
});


// ─── 02  depth invariance ────────────────────────────────────────────────────
describe('02 - a number array merges the same way at every depth', function () {
    it('{q:{p:[1,2]}} + {q:{p:[3,4]}} is [1,2,3,4], not [1,2,3,4,3,4]', function () {
        assert.deepEqual(merge({ q: { p: [1, 2] } }, { q: { p: [3, 4] } }).q.p, [1, 2, 3, 4]);
    });

    it('depth 3: {r:{q:{p:[1]}}} + {r:{q:{p:[2]}}} is [1,2]', function () {
        assert.deepEqual(merge({ r: { q: { p: [1] } } }, { r: { q: { p: [2] } } }).r.q.p, [1, 2]);
    });

    it('depths 1-4 agree for four disjoint shapes', function () {
        [[[1], [2]], [[1, 2], [3, 4]], [[1], [2, 3]], [[1, 2], [3]]].forEach(function (c) {
            var d1 = JSON.stringify(at(1, c[0], c[1]));
            for (var d = 2; d <= 4; d++) {
                assert.equal(JSON.stringify(at(d, c[0], c[1])), d1, JSON.stringify(c[0]) + '+' + JSON.stringify(c[1]) + ' at depth ' + d);
            }
        });
    });
});


// ─── 03  idempotence ─────────────────────────────────────────────────────────
describe('03 - merging the same source into the result again is a no-op', function () {
    it('top level', function () {
        var r = merge([1, 2], [3, 4]);
        assert.deepEqual(merge(r, [3, 4]), [1, 2, 3, 4]);
    });

    it('depth 1', function () {
        var r = merge({ p: [1, 2] }, { p: [3, 4] });
        assert.deepEqual(merge(r, { p: [3, 4] }).p, [1, 2, 3, 4]);
    });

    it('depth 2', function () {
        var r = merge({ q: { p: [1, 2] } }, { q: { p: [3, 4] } });
        assert.deepEqual(merge(r, { q: { p: [3, 4] } }).q.p, [1, 2, 3, 4]);
    });
});


// ─── 04  the #B428 residual ──────────────────────────────────────────────────
describe('04 - an array shared by target and source at depth >= 2 is left alone', function () {
    it('numbers: a.q.x === b.q.x keeps identity and contents ([1,1,2] used to become a [1,2,1,2] copy)', function () {
        var shared = [1, 1, 2];
        var a = { q: { x: shared } }, b = { q: { x: shared } };
        merge(a, b);
        assert.equal(a.q.x, shared, 'identity kept');
        assert.deepEqual(a.q.x, [1, 1, 2], 'contents kept');
    });

    it('strings: [\'a\',\'a\',\'b\'] keeps identity and its duplicate (used to become a deduped copy)', function () {
        var shared = ['a', 'a', 'b'];
        var a = { q: { x: shared } }, b = { q: { x: shared } };
        merge(a, b);
        assert.equal(a.q.x, shared, 'identity kept');
        assert.deepEqual(a.q.x, ['a', 'a', 'b'], 'contents kept');
    });
});


// ─── 05  controls ────────────────────────────────────────────────────────────
describe('05 - controls: every neighbouring contract is unchanged', function () {
    it('the number tolerance itself: [25] + [25,25] is [25,25], at depth 1 and depth 4', function () {
        assert.deepEqual(merge({ a: [25] }, { a: [25, 25] }).a, [25, 25]);
        assert.deepEqual(merge({ form: { rule: { f: { isString: [25] } } } }, { form: { rule: { f: { isString: [25, 25] } } } }).form.rule.f.isString, [25, 25]);
    });

    it('the source may carry MORE copies than the target: [25] + [25,25,25] is [25,25,25]; [1,2] + [2,2] is [1,2,2]', function () {
        assert.deepEqual(merge({ a: [25] }, { a: [25, 25, 25] }).a, [25, 25, 25]);
        assert.deepEqual(merge({ a: [1, 2] }, { a: [2, 2] }).a, [1, 2, 2]);
    });

    it('a number at the SAME index was never pushed again: [1,9] + [1] is [1,9]', function () {
        assert.deepEqual(merge({ p: [1, 9] }, { p: [1] }).p, [1, 9]);
    });

    it('strings, booleans and null keep their union/dedupe behaviour', function () {
        assert.deepEqual(merge({ a: ['a', 'b'] }, { a: ['b', 'c'] }).a, ['a', 'b', 'c']);
        assert.deepEqual(merge({ p: ['b', 'a'] }, { p: ['a'] }).p, ['b', 'a']);
        assert.deepEqual(merge({ a: [true] }, { a: [false] }).a, [true, false]);
        assert.deepEqual(merge({ list: ['x'] }, { list: ['x', null] }).list, ['x', null]);
        assert.deepEqual(merge({ a: [0, 'm'] }, { a: [0, 'm'] }).a, [0, 'm']);
    });

    it('override=true at depth 2 still lets the source win', function () {
        assert.deepEqual(merge({ q: { p: [1, 2] } }, { q: { p: [3, 4] } }, true).q.p, [3, 4]);
    });

    it('id-keyed collections at depth 2, both modes', function () {
        assert.deepEqual(merge({ p: { rows: [{ id: 1, v: 'old' }] } }, { p: { rows: [{ id: 1, v: 'new' }, { id: 2, v: 'n2' }] } }).p.rows, [{ id: 1, v: 'old' }, { id: 2, v: 'n2' }]);
        assert.deepEqual(merge({ p: { rows: [{ id: 1, v: 'old' }] } }, { p: { rows: [{ id: 1, v: 'new' }] } }, true).p.rows, [{ id: 1, v: 'new' }]);
    });

    it('the createMode path still copies the array it fills from (its own single pass is kept)', function () {
        var src = { p: { list: [1, 2, 1] } };
        var out = merge({}, src);
        assert.deepEqual(out.p.list, [1, 2, 1]);
        assert.notEqual(out.p.list, src.p.list, 'createMode still builds a fresh array');
    });

    it('the #B437 shapes still do not throw (the two fixes compose)', function () {
        assert.deepEqual(merge(['v2', 'v2'], [{ id: 3, v: 'c1' }, { id: 0, v: 'c2' }, { id: 3, v: 'c1' }]), ['v2', 'v2', { id: 3, v: 'c1' }]);
        assert.deepEqual(merge(['x', 'x', null], [{ a: 1 }, { b: 2 }, { c: 3 }]), ['x', 'x', null]);
    });
});


// ─── 06  source pins ─────────────────────────────────────────────────────────
describe('06 - source pins', function () {
    var src = fs.readFileSync(MAIN_SRC, 'utf8');
    // comment-stripped view for the negative pin: the retired predicate legitimately survives in a `// was:` record
    var code = src.split('\n').map(function (l) { return l.replace(/\/\/.*$/, ''); }).join('\n');

    it('browse(): the prop-loop array merge is gated on createMode, exactly once', function () {
        var gate = '} else if ( createMode && Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {';
        assert.equal(src.split(gate).length - 1, 1);
    });

    it('mergeArray(): the number top-up decides by count, and the count loops sit inside the top-up block', function () {
        var numberGate = src.indexOf('/number/i.test( typeof(options[a]) )');
        var predicate  = src.indexOf('_seenInSource > _seenInTarget');
        var nextBranch = src.indexOf('// Collection with keyComparison');
        assert.ok(numberGate > -1 && nextBranch > -1, 'anchors present');
        assert.ok(predicate > -1, 'the count predicate is present');
        assert.ok(numberGate < predicate && predicate < nextBranch, 'gate=' + numberGate + ' predicate=' + predicate + ' next=' + nextBranch);
        assert.equal(src.split('_seenInSource > _seenInTarget').length - 1, 1, 'exactly one predicate');
    });

    it('mergeArray(): the index comparison is gone from the CODE (comment-stripped), and the stripping did not empty the window', function () {
        var retired = 'options[a] !== newTarget[a]';
        assert.ok(code.indexOf(retired) < 0, 'the index comparison still executes');
        assert.ok(src.indexOf(retired) > -1, 'anti-vacuity: the raw source still records the retired predicate');
        assert.ok(code.indexOf('/number/i.test( typeof(options[a]) )') > -1, 'anti-vacuity: the top-up block is still in the stripped view');
    });
});


// ─── 07  dist pins ───────────────────────────────────────────────────────────
// Derived from the EMITTED artifact, never guessed. Closure keeps the `/number/i`
// regex literal (the anchor for the top-up), emits the two count loops as
// `for(l=v=ma=0;l<=k;++l)q[l]===q[k]&&++ma;for(l=0;l<h.length;++l)h[l]===q[k]&&++v;if(ma>v)`
// (with a line wrap allowed anywhere), and the createMode gate as a flag-prefixed
// isArray pair feeding the mergeArray call. Identifier-agnostic (backreferences)
// and wrap-agnostic (`\s*`). Validated against the pre-fix artifact: positives
// 0 -> 1, the retired index comparison 1 -> 0.
describe('07 - dist pins: the browser bundle carries both changes', function () {
    it('the unminified bundle carries the createMode gate and the count predicate verbatim, once each', function () {
        var js = fs.readFileSync(DIST_JS, 'utf8');
        assert.equal(js.split('} else if ( createMode && Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {').length - 1, 1, 'createMode gate');
        assert.equal(js.split('_seenInSource > _seenInTarget').length - 1, 1, 'count predicate');
    });

    it('the minified bundle: the top-up counts (positive), the index comparison is gone (negative), the gate is flag-prefixed', function () {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        var aPos = min.match(/(\w+)\s*&&\s*Array\.isArray\((\w+)\[(\w+)\]\)\s*&&\s*Array\.isArray\((\w+)\[\3\]\)\s*&&\s*\(\s*\4\[\3\]\s*=\s*(\w+)\(\2\[\3\]\s*,\s*\4\[\3\]/g) || [];
        var bPos = min.match(/\/number\/i\.test\(typeof\s+(\w+)\[(\w+)\]\)\s*\)\s*\{\s*for\s*\(\s*(\w+)\s*=\s*(\w+)\s*=\s*(\w+)\s*=\s*0\s*;\s*\3\s*<=\s*\2\s*;\s*\+\+\3\s*\)\s*\1\[\3\]\s*===\s*\1\[\2\]\s*&&\s*\+\+\5\s*;\s*for\s*\(\s*\3\s*=\s*0\s*;\s*\3\s*<\s*(\w+)\.length\s*;\s*\+\+\3\s*\)\s*\6\[\3\]\s*===\s*\1\[\2\]\s*&&\s*\+\+\4\s*;\s*if\s*\(\s*\5\s*>\s*\4\s*\)/g) || [];
        var bNeg = min.match(/\/number\/i\.test\(typeof\s+(\w+)\[(\w+)\]\)\s*&&\s*\1\[\2\]\s*!==\s*(\w+)\[\2\]\s*\?\s*\3\.push\(\1\[\2\]\)/g) || [];
        assert.equal(aPos.length, 1, 'flag-gated array merge sites in gina.min.js: ' + aPos.length);
        assert.equal(bPos.length, 1, 'count-based top-up sites in gina.min.js: ' + bPos.length);
        assert.equal(bNeg.length, 0, 'index-comparison top-ups still in gina.min.js: ' + bNeg.length);
        // anti-vacuity: the top-up region is still in the bundle
        assert.ok((min.match(/\/number\/i\.test\(typeof/g) || []).length > 0, 'the number top-up vanished from the bundle');
    });
});
