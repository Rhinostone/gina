'use strict';
/**
 * lib/merge does not rewrite the object it was given (#B428).
 *
 * When a source subtree was grafted BY REFERENCE into an existing target level
 * (`browse()`: the `!override` prop loop assigns `clone[prop] = copy[prop]` for a
 * key the target lacks, then `target[name] = browse(clone, copy)` re-walks the
 * same props), the recursion met `src === copy` — the same object on both sides
 * — and merged every array inside it WITH ITSELF via `mergeArray`, writing the
 * results back INTO the caller's object: array identities replaced at every
 * depth, and primitive duplicates silently dropped. The fix is one identity
 * guard beside the existing never-ending-loop guard: a value merged into itself
 * is identity, so a shared object/array reference is skipped, never walked.
 *
 * Covered (BEHAVIORAL unless marked — the real lib is driven):
 *   01  parent-exists graft: every source array keeps identity + contents (RED pre-fix)
 *   02  primitive duplicates in a grafted source survive (RED pre-fix — content loss)
 *   03  a pre-shared subtree (a.x === b.x) is a no-op (RED pre-fix)
 *   04  override=true never walked the graft — unchanged (control, green either way)
 *   05  root-absent graft takes the createMode path — deliberately untouched (control)
 *   06  legitimate merges of two DIFFERENT objects/arrays still merge (control)
 *   07  the guard is object-scoped: equal primitives keep the original path (control)
 *   08  the result aliases a grafted source object — the standing contract (control)
 *   09  source pin: the guard sits between the loop guard and the recursion block
 *
 * Red-first: §01-§03 and §09 fail on the pre-fix bytes; every control is green on
 * both — validated by running this file before and after the guard landed.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FRAMEWORK = path.resolve(require('../fw'));
var MAIN_SRC  = path.join(FRAMEWORK, 'lib/merge/src/main.js');
var merge     = require(path.join(FRAMEWORK, 'lib/merge'));

function catalog() {
    return {
        list: ['a', 'a', 'b'],
        deep: { inner: ['x'], deeper: { arr: [1, 2], coll: [{ id: 1, v: 'p' }, { id: 1, v: 'q' }] } },
        s: 'str'
    };
}
/** Every array/object reference inside a catalog, in a fixed order. */
function refs(c) { return [c.list, c.deep, c.deep.inner, c.deep.deeper, c.deep.deeper.arr, c.deep.deeper.coll]; }
function snap(v) { return JSON.stringify(v); }


// ─── 01  parent-exists graft — identity at every depth ──────────────────────
describe('01 - a source grafted into an existing target level keeps every array identity', function () {
    it('merge({page:{title}}, {page:{forms: catalog}}) leaves catalog untouched at all depths', function () {
        var c = catalog(), before = refs(c), s = snap(c);
        var out = merge({ page: { title: 'x' } }, { page: { forms: c } });
        var after = refs(c), replaced = 0;
        for (var i = 0; i < before.length; i++) { if (after[i] !== before[i]) replaced++; }
        assert.equal(replaced, 0, replaced + ' of ' + before.length + ' source references were replaced');
        assert.equal(snap(c), s, 'source contents unchanged');
        assert.equal(snap(out.page.forms), s, 'the result carries the source verbatim');
    });

    it('a wider catalog: 0 of 5 arrays replaced (was 5 of 5)', function () {
        var wide = { a: [1], b: [2], c: { d: [3], e: [4], f: { g: [5] } } };
        var ids = [wide.a, wide.b, wide.c.d, wide.c.e, wide.c.f.g];
        merge({ page: { title: 'x' } }, { page: { forms: wide } });
        var now = [wide.a, wide.b, wide.c.d, wide.c.e, wide.c.f.g];
        var replaced = now.filter(function (x, i) { return x !== ids[i]; }).length;
        assert.equal(replaced, 0, replaced + '/5 source arrays replaced');
    });
});


// ─── 02  content loss ────────────────────────────────────────────────────────
describe('02 - primitive duplicates inside a grafted source are preserved', function () {
    it("['a','a','b'] stays 3 elements in the source AND in the result (was deduped to ['a','b'])", function () {
        var c = { list: ['a', 'a', 'b'] };
        var out = merge({ page: { title: 'x' } }, { page: { forms: c } });
        assert.deepEqual(c.list, ['a', 'a', 'b'], 'source: ' + snap(c.list));
        assert.deepEqual(out.page.forms.list, ['a', 'a', 'b'], 'result: ' + snap(out.page.forms.list));
    });

    it('an id-keyed collection with a repeated id is left exactly as given', function () {
        var c = { rows: [{ id: 1, v: 'a' }, { id: 1, v: 'b' }, { id: 2, v: 'c' }] };
        var rows = c.rows, s = snap(rows);
        merge({ page: { title: 'x' } }, { page: { forms: c } });
        assert.equal(c.rows, rows, 'identity kept');
        assert.equal(snap(c.rows), s, 'contents kept');
    });
});


// ─── 03  pre-shared subtree ──────────────────────────────────────────────────
describe('03 - a subtree already shared by target and source is a no-op', function () {
    it('a.x === b.x: merge(a, b) neither replaces nor dedupes a.x', function () {
        var shared = ['q', 'q', 'z'];
        var a = { x: shared, y: 1 }, b = { x: shared, w: 2 };
        var out = merge(a, b);
        assert.equal(a.x, shared, 'a.x identity kept');
        assert.deepEqual(a.x, ['q', 'q', 'z'], 'a.x contents kept');
        assert.equal(out.w, 2, 'the rest of the merge still happened');
    });
});


// ─── 04  control: override=true ──────────────────────────────────────────────
describe('04 - control: override=true never walked a graft, and still does not', function () {
    it('same graft with override=true: nothing replaced, nothing deduped', function () {
        var c = catalog(), before = refs(c), s = snap(c);
        merge({ page: { title: 'x' } }, { page: { forms: c } }, true);
        var after = refs(c);
        for (var i = 0; i < before.length; i++) { assert.equal(after[i], before[i], 'ref ' + i); }
        assert.equal(snap(c), s);
    });
});


// ─── 05  control: the createMode path is deliberately untouched ──────────────
describe('05 - control: a graft at an ABSENT root key takes the createMode path (unchanged)', function () {
    it('merge({existing:true}, {p: catalog}): source untouched; the result holds a shallow copy whose arrays are fresh', function () {
        var c = catalog(), before = refs(c), s = snap(c);
        var out = merge({ existing: true }, { p: c });
        var after = refs(c);
        for (var i = 0; i < before.length; i++) { assert.equal(after[i], before[i], 'source ref ' + i + ' kept'); }
        assert.equal(snap(c), s, 'source contents kept');
        assert.notEqual(out.p, c, 'createMode builds a new top-level object');
        assert.notEqual(out.p.list, c.list, 'createMode still copies top-level arrays (its self-merge is result-side only)');
        assert.equal(out.p.deep, c.deep, 'createMode shallow-copies: nested objects are shared (standing behaviour)');
    });
});


// ─── 06  control: legitimate merges still merge ──────────────────────────────
describe('06 - control: merging two DIFFERENT values still merges', function () {
    it('two different primitive arrays at depth 1 union', function () {
        var out = merge({ p: { list: [1] } }, { p: { list: [2] } });
        assert.ok(out.p.list.indexOf(1) > -1 && out.p.list.indexOf(2) > -1, snap(out.p.list));
    });

    it('two different id-keyed collections: target item kept, new id appended (no override)', function () {
        var out = merge({ p: { rows: [{ id: 1, v: 'old' }] } }, { p: { rows: [{ id: 1, v: 'new' }, { id: 2, v: 'n2' }] } });
        assert.deepEqual(out.p.rows, [{ id: 1, v: 'old' }, { id: 2, v: 'n2' }]);
    });

    it('two different id-keyed collections with override: source wins', function () {
        var out = merge({ p: { rows: [{ id: 1, v: 'old' }] } }, { p: { rows: [{ id: 1, v: 'new' }] } }, true);
        assert.deepEqual(out.p.rows, [{ id: 1, v: 'new' }]);
    });

    it('two different nested objects deep-fill', function () {
        var out = merge({ a: { b: 1 } }, { a: { c: 2 }, d: 3 });
        assert.deepEqual(out, { a: { b: 1, c: 2 }, d: 3 });
    });
});


// ─── 07  control: the guard is object-scoped ─────────────────────────────────
describe('07 - control: equal PRIMITIVES keep the original code path (the guard is object-scoped)', function () {
    it('merge({a: 0}, {a: -0}) still assigns the source value (0 === -0 must not short-circuit)', function () {
        var out = merge({ a: 0 }, { a: -0 });
        assert.ok(Object.is(out.a, -0), 'expected -0, got ' + (Object.is(out.a, -0) ? '-0' : String(out.a)));
    });

    it('merge({a: null}, {a: null}) and equal strings are unchanged', function () {
        assert.deepEqual(merge({ a: null, b: 'v' }, { a: null, b: 'v', c: 1 }), { a: null, b: 'v', c: 1 });
    });
});


// ─── 08  control: aliasing is the standing contract ──────────────────────────
describe('08 - control: a grafted source object is referenced by the result (unchanged contract)', function () {
    it('result.page.forms === catalog — the caller keeps ownership; merge documents, not copies', function () {
        var c = catalog();
        var out = merge({ page: { title: 'x' } }, { page: { forms: c } });
        assert.equal(out.page.forms, c);
    });
});


// ─── 09  source pin ──────────────────────────────────────────────────────────
describe('09 - source pin: the identity guard sits after the loop guard and before the recursion block', function () {
    it('ordering: `target === copy` guard < `src === copy` guard < the "Recurse if" comment', function () {
        var src   = fs.readFileSync(MAIN_SRC, 'utf8');
        var loop  = src.indexOf('if (target === copy) {');
        var guard = src.indexOf("typeof(copy) == 'object' && src === copy");
        var recur = src.indexOf('// Recurse if we\'re merging plain objects or arrays');
        assert.ok(loop > -1 && recur > -1, 'anchors present');
        assert.ok(guard > -1, 'the #B428 identity guard is present');
        assert.ok(loop < guard && guard < recur, 'loop=' + loop + ' guard=' + guard + ' recurse=' + recur);
    });
});
