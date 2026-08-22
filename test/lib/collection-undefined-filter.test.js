/**
 * #B396 (gh #65) — an undefined-valued filter key must throw, never match-all.
 *
 * Before the fix, `find()` round-tripped its filter objects through
 * `JSON.stringify(arguments)` / `JSON.parse` — and stringify silently DROPS
 * keys whose value is `undefined`. A single-key filter degraded to `{}`, whose
 * zero conditions match EVERY record: `findOne({ id: undefined })` returned
 * the collection's FIRST row, and `update({ id: undefined }, set)` mass-mutated
 * every record. The in-loop guard deeper in the matcher — written to throw
 * exactly on this input — was dead code, because the serialization stripped the
 * keys before the loop could see them.
 *
 * The fix hoists the refusal to `find()`'s entry, BEFORE the round-trip. EIGHT
 * public methods reach that gate: `findOne`, `or` and `update` delegate to
 * `find` directly, `replace` (:1199) and `max` (:1373) call it, `notIn` (:869)
 * routes a filter-OBJECT argument through it, and `delete` (:1297) delegates
 * wholly to `notIn`. Only `notIn`'s ARRAY form skips `find` and stays exempt.
 * (The 0.6.12 release notes named only the first four - see section 06.)
 *
 * Deliberately unchanged: an explicitly empty `{}` filter still means
 * "no constraint" (match-all), and `null` stays a legal needle comparing
 * strictly against stored values.
 *
 * Behavioural arms drive the real module; the source/dist pins lock the gate's
 * position (before the serialization) and its presence in the shipped bundle.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var helpers = require(path.join(FW, 'helpers'));
var Collection = require(path.join(FW, 'lib/collection/src/main'));

var SRC = fs.readFileSync(path.join(FW, 'lib/collection/src/main.js'), 'utf8');
var MIN = fs.readFileSync(path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js'), 'utf8');

var ROWS = [
    { id: 'r1', title: 'alpha', rate: 20, note: null },
    { id: 'r2', title: 'beta',  rate: 10 },
    { id: 'r3', title: 'gamma', rate: 5.5 }
];
/** @returns {object} a fresh Collection over a deep copy of ROWS */
var mk = function () { return new Collection(JSON.parse(JSON.stringify(ROWS))); };

var MSG = /filter `id` cannot be left undefined/;


describe('01 - source pins: the gate exists and precedes the serialization', function () {

    it('the refusal message appears exactly three times (entry gate + the two in-loop belts)', function () {
        assert.equal(SRC.split('cannot be left undefined').length - 1, 3);
    });

    it('the FIRST refusal precedes the JSON round-trip that used to strip the keys', function () {
        var gate  = SRC.indexOf('cannot be left undefined');
        var strip = SRC.indexOf('JSON.stringify(arguments)');
        assert.ok(gate > -1, 'gate literal not found');
        assert.ok(strip > -1, 'serialization literal not found');
        assert.ok(gate < strip, 'the entry gate must run before the serialization');
    });

    it('the gate skips array arguments (record sets are not needles)', function () {
        assert.match(SRC, /!Array\.isArray\(_fObj\)/);
    });
});


describe('02 - find/findOne refuse undefined-valued filter keys', function () {

    it('findOne({ id: undefined }) throws naming the key (was: returned the FIRST row)', function () {
        assert.throws(function () { mk().findOne({ id: undefined }); }, MSG);
    });

    it('find({ id: undefined }) throws (was: matched EVERY record)', function () {
        assert.throws(function () { mk().find({ id: undefined }); }, MSG);
    });

    it('a mixed filter throws on the undefined key (was: silently dropped the constraint)', function () {
        assert.throws(
            function () { mk().findOne({ id: 'r2', title: undefined }); },
            /filter `title` cannot be left undefined/
        );
    });

    it('the OR form refuses too when any arm carries an undefined value', function () {
        assert.throws(function () { mk().find({ id: 'r1' }, { title: undefined }); },
            /filter `title` cannot be left undefined/);
    });
});


describe('03 - update() no longer mass-mutates on an undefined-valued filter', function () {

    it('update({ id: undefined }, set) throws (was: wrote `set` onto EVERY record)', function () {
        assert.throws(function () { mk().update({ id: undefined }, { rate: 99 }); }, MSG);
    });

    it('control: a defined-filter update still lands on exactly its target', function () {
        var out = JSON.parse(JSON.stringify(mk().update({ id: 'r2' }, { rate: 99 })));
        var hit = out.filter(function (e) { return e.rate === 99; });
        assert.equal(hit.length, 1);
        assert.equal(hit[0].id, 'r2');
    });
});


describe('04 - unchanged semantics (controls)', function () {

    it('positive control: findOne({ id: "r2" }) still finds its row', function () {
        assert.equal(mk().findOne({ id: 'r2' }).id, 'r2');
    });

    it('negative control: findOne({ id: "nope" }) still returns null', function () {
        assert.equal(mk().findOne({ id: 'nope' }), null);
    });

    it('null needle vs stored null still matches (the null-equality branch)', function () {
        assert.equal(mk().findOne({ note: null }).id, 'r1');
    });

    it('null needle vs a stored string still matches nothing', function () {
        assert.equal(mk().findOne({ title: null }), null);
    });

    it('strict typing still holds: findOne({ rate: "20" }) misses the numeric 20', function () {
        assert.equal(mk().findOne({ rate: '20' }), null);
    });

    it('an explicitly empty {} filter still matches everything (deliberate no-constraint)', function () {
        assert.equal(JSON.parse(JSON.stringify(mk().find({}))).length, ROWS.length);
    });

    it('find() with no arguments still returns the whole collection', function () {
        assert.equal(JSON.parse(JSON.stringify(mk().find())).length, ROWS.length);
    });

    it('the OR form still unions defined filters', function () {
        assert.equal(JSON.parse(JSON.stringify(mk().find({ id: 'r1' }, { id: 'r2' }))).length, 2);
    });
});


describe('05 - dist fidelity: the gate ships in the browser bundle', function () {

    it('gina.min.js carries the refusal literal three times (was 2 pre-fix: the dead belts only)', function () {
        assert.equal(MIN.split('cannot be left undefined').length - 1, 3);
    });

    it('control: the bundle still carries find()\'s non-object refusal', function () {
        assert.ok(MIN.split('filter must be an object').length - 1 >= 1);
    });
});


describe('06 - the transitively-covered family: notIn/delete/replace/max', function () {

    // These four reach the same single gate but were absent from the 0.6.12
    // release notes, which enumerated find/findOne/or/update only. Pinned here
    // so the prose can never drift from the contract again.

    it('delete({ id: undefined }) throws (was: returned an EMPTY collection - every record removed)', function () {
        assert.throws(function () { mk().delete({ id: undefined }); }, MSG);
    });

    it('notIn({ id: undefined }) throws - the filter-object form routes through find()', function () {
        assert.throws(function () { mk().notIn({ id: undefined }); }, MSG);
    });

    it('replace({ id: undefined }, set) throws (was: replaced against a match-all)', function () {
        assert.throws(function () { mk().replace({ id: undefined }, { id: 'r1', title: 'x' }); }, MSG);
    });

    it('max({ rate: undefined }) throws (was: aggregated over EVERY record)', function () {
        assert.throws(function () { mk().max({ rate: undefined }); }, /filter `rate` cannot be left undefined/);
    });

    it('EXEMPT control: notIn(rows, key) - the array form skips find() and still filters', function () {
        assert.equal(JSON.parse(JSON.stringify(mk().notIn([ { id: 'r1' } ], 'id'))).length, ROWS.length - 1);
    });

    it('control: delete({ id: "r1" }) with a defined key still removes exactly its row', function () {
        assert.equal(JSON.parse(JSON.stringify(mk().delete({ id: 'r1' }))).length, ROWS.length - 1);
    });

    it('delete() returns a filtered COPY - the source collection is never mutated in place', function () {
        var col = mk();
        col.delete({ id: 'r1' });
        assert.equal(col.toRaw().length, ROWS.length);
    });
});
