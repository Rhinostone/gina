/**
 * merge() contract pins — properties the call surface RELIES on that nothing
 * previously asserted (merge-contract audit, 2026-09-02).
 *
 * Background: the #B446 first-cut regression proved that merge()'s contract can
 * shift for 200+ framework call sites while the full suite stays green — the
 * entity/inherited-copy contract was pinned in its wake
 * (merge-entity-prototype.test.js); this file pins the REST of the census's
 * load-bearing properties, each with a consumer named in the framework source:
 *
 *   01  RETURN IDENTITY (objects) — merge returns THE target reference, not an
 *       equivalent object. controller.render-swig.js documents its correctness
 *       on `data === userData` after `data = merge(userData, data)` (a clone
 *       would silently un-alias the layoutless render's data tree).
 *   02  ...and arrays deliberately DIFFER: a top-level array merge returns a
 *       FRESH array (mergeArray rebuilds). Pinned as the contrast so 01 is
 *       never "generalised" to arrays.
 *   03  VARIADIC, EARLIER SOURCES WIN — merge(t, s1, s2): s1 beats s2 on
 *       conflicts; override is read only from a BOOLEAN last argument.
 *       form-validator.js's live-check query options state this dependency in
 *       their own comment ("merge is variadic and earlier sources win").
 *   04  FUNCTION / CLASS-INSTANCE VALUES GRAFT BY REFERENCE — isObject()
 *       routes only plain objects into recursion; everything else is assigned.
 *       The client storage plugin deletes a grafted `save` method by name and
 *       config singletons survive as live references because of this.
 *   05  UNDEFINED TARGET COERCION — merge(undefined, src) mints {} or [] to
 *       match the source. The entity relations assembly
 *       (core/model/entity.js) passes an undefined slot on every first pass.
 *   06  NON-OBJECT SOURCE REPLACES TARGET — a primitive source short-circuits
 *       the walk and becomes the result.
 *   07  setKeyComparison IS ONE-SHOT — the key applies to the next mergeArray
 *       call and resets to 'id' (getKeyComparison resets on read). The six
 *       curried config.js template/asset merges depend on the key applying;
 *       everything after depends on the reset.
 *
 * All arms assert behaviour MEASURED against the live lib before writing
 * (2026-09-02); none of them encode intended-but-unverified semantics.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path   = require('path');
const fs     = require('fs');

const FW      = path.join(__dirname, '..', '..', 'framework');
const version = fs.readdirSync(FW).filter(d => /^v/.test(d))[0];
const merge   = require(path.join(FW, version, 'lib', 'merge', 'src', 'main.js'));

describe('merge() contract pins — the properties the call surface relies on', function () {

    it('01 — object target: merge RETURNS THE IDENTICAL REFERENCE (render delegates rely on data === userData)', function () {
        const target = { a: 1 };
        const out = merge(target, { b: 2 });
        assert.strictEqual(out, target, 'a clone-returning merge would silently un-alias every mutate-and-return caller');
        assert.deepStrictEqual(out, { a: 1, b: 2 });
    });

    it('02 — CONTRAST: a top-level ARRAY merge returns a FRESH array (do not generalise 01)', function () {
        const target = [1];
        const out = merge(target, [2]);
        assert.notStrictEqual(out, target);
        assert.deepStrictEqual(out, [1, 2]);
    });

    it('03 — variadic: earlier sources win; override only binds to a boolean last argument', function () {
        assert.deepStrictEqual(merge({}, { a: 1, c: 3 }, { a: 2, b: 9 }),
            { a: 1, c: 3, b: 9 }, 'first source must beat the second on a conflict');
        assert.deepStrictEqual(merge({}, { a: 1, c: 3 }, { a: 2, b: 9 }, true),
            { a: 2, c: 3, b: 9 }, 'override flips the conflict, still merging both sources');
    });

    it('04 — function and class-instance VALUES are grafted by reference, never recursed into', function () {
        const fn = function () { return 'live'; };
        assert.strictEqual(merge({}, { fn: fn }).fn, fn);

        class Svc { constructor() { this.tag = 'live'; } }
        const inst = new Svc();
        const t = {};
        merge(t, { svc: inst });
        assert.strictEqual(t.svc, inst, 'a deep-cloning merge would sever live singletons and method bags');
    });

    it('05 — an undefined target is coerced to match the source shape', function () {
        assert.deepStrictEqual(merge(undefined, { a: 1 }), { a: 1 });
        assert.deepStrictEqual(merge(undefined, [1, 2]), [1, 2]);
    });

    it('06 — a non-object source replaces the target outright', function () {
        assert.strictEqual(merge({ a: 1 }, 'str'), 'str');
        assert.strictEqual(merge({ a: 1 }, 42), 42);
    });

    it('07 — setKeyComparison applies to the NEXT array merge only, then resets to id', function () {
        const A = [{ name: 'x', v: 1 }];
        const B = [{ name: 'x', v: 2 }, { name: 'y', v: 3 }];
        assert.deepStrictEqual(merge.setKeyComparison('name')(A, B),
            [{ name: 'x', v: 1 }, { name: 'y', v: 3 }],
            'keyed: same-name element keeps the target side, new names append');

        // and the very next merge is back on the default 'id' comparison
        const C = [{ id: 1, name: 'x' }];
        const D = [{ id: 1, name: 'CHANGED' }, { id: 2, name: 'y' }];
        assert.deepStrictEqual(merge(C, D),
            [{ id: 1, name: 'x' }, { id: 2, name: 'y' }],
            'the one-shot key must have reset — id:1 keeps the target row');
    });
});
