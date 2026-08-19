/**
 * #B393 — `Collection.replace()` resolves its comparison key from BOTH sides.
 *
 * Before the fix the key was chosen by inspecting the STORED entry only, and was
 * mutated in place:
 *
 *   - when the stored entry carried a `_uuid` and the caller's `set` did not,
 *     neither the `id` fallback nor the refusal fired (both were gated on the
 *     stored entry lacking the key), so the comparison was
 *     `<storedUuid> == undefined` — never true. Nothing matched, nothing was
 *     replaced, and the call returned a successful-looking result: a silent,
 *     lossy write;
 *   - `key` was assigned rather than shadowed, so once any entry flipped it to
 *     `id` it stayed `id` for every later entry in the same call.
 *
 * A stored `_uuid` is present exactly when the caller re-loaded an array that a
 * previous chained call had returned — a fresh collection built from raw data
 * keeps no `_uuid` in `content`, which is why the defect looks intermittent.
 *
 * Behavioural throughout: these arms drive the real module rather than an
 * extracted copy, so no arm can go red for a missing-global harness reason.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var helpers = require(path.join(require('../fw'), 'helpers'));
var Collection = require(path.join(require('../fw'), 'lib/collection/src/main'));

/** @returns {Array} a plain, method-free view of a chained result */
var raw = function (v) { return JSON.parse(JSON.stringify(v)); };

/** @returns {object|undefined} the entry whose `id` matches */
var byId = function (v, id) {
    return raw(v).filter(function (e) { return e.id === id; })[0];
};

/**
 * Entries carrying a stored `_uuid`, obtained the way a caller acquires them:
 * by persisting the array a previous chained call returned.
 * @returns {Array}
 */
var seededWithUuid = function () {
    return raw(new Collection([
        { id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }
    ]).delete({ id: 'c' }));
};


// 01 — the defect itself: this arm is red on the pre-fix bytes
describe('01 - stored entry carries _uuid, `set` does not', function () {

    it('premise: the seeded entries really do carry a stored _uuid', function () {
        var seeded = seededWithUuid();
        assert.ok(seeded.length > 0, 'seeding produced no entries');
        assert.ok(
            seeded.every(function (e) { return typeof e._uuid === 'string'; }),
            'the premise of this file does not hold: seeded entries carry no _uuid'
        );
    });

    it('replaces the matched entry instead of silently doing nothing', function () {
        var out = new Collection(seededWithUuid()).replace({ id: 'a' }, { id: 'a', v: 99 });
        assert.equal(byId(out, 'a').v, 99, 'the replacement was silently dropped');
    });

    it('leaves every other entry untouched', function () {
        var out = new Collection(seededWithUuid()).replace({ id: 'a' }, { id: 'a', v: 99 });
        assert.equal(byId(out, 'b').v, 2);
    });
});


// 02 — arms pinning behaviour the fix does NOT change: green pre-fix AND post-fix
describe('02 - previously-working shapes are unchanged', function () {

    it('`set` carrying the matching _uuid still replaces', function () {
        var seeded = seededWithUuid();
        var target = byId(seeded, 'a');
        var out = new Collection(seeded).replace(
            { id: 'a' }, { id: 'a', v: 77, _uuid: target._uuid }
        );
        assert.equal(byId(out, 'a').v, 77);
    });

    it('a collection with no stored _uuid still replaces through the id fallback', function () {
        var out = new Collection([{ id: 'a', v: 1 }, { id: 'b', v: 2 }])
            .replace({ id: 'a' }, { id: 'a', v: 55 });
        assert.equal(byId(out, 'a').v, 55);
    });

    it('an explicitly named comparison key is honoured as given', function () {
        var out = new Collection([{ ref: 'r1', v: 1 }, { ref: 'r2', v: 2 }])
            .replace({ ref: 'r1' }, { ref: 'r1', v: 11 }, 'ref');
        assert.equal(raw(out).filter(function (e) { return e.ref === 'r1'; })[0].v, 11);
    });
});


// NOTE — the second half of the fix shadows the comparison key per iteration
// instead of assigning the shared `key`, so a fallback resolved for one entry can
// no longer apply to later ones. That correction is DEFENSIVE and is deliberately
// NOT pinned here: two attempts to build a behavioural arm for it were both green
// against the pre-fix bytes, i.e. neither discriminated. The reachable paths that
// would expose it are narrow — `content` carries a stamped `_uuid` on every entry,
// so the pre-fix fallback only ever triggered off the instance array's own
// caller-supplied keys — and rather than ship an arm that certifies nothing, the
// leak is recorded here as fixed-without-a-reproducing-case. Removing the
// shadowing would not redden this file; the source change stands on the read.


// 03 — the silent case is now loud
describe('03 - no key shared by both sides refuses loudly', function () {

    it('throws rather than returning a result that replaced nothing', function () {
        var seeded = seededWithUuid();
        assert.throws(
            function () {
                // `set` carries neither the stored `_uuid` nor an `id`.
                new Collection(seeded).replace({ id: 'a' }, { v: 123 });
            },
            /No comparison key defined/
        );
    });

    it('control: the same call with an id on both sides does NOT throw', function () {
        var seeded = seededWithUuid();
        assert.doesNotThrow(function () {
            new Collection(seeded).replace({ id: 'a' }, { id: 'a', v: 123 });
        });
    });
});
