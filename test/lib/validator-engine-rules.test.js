'use strict';
/**
 * Validator engine — behavioral coverage of the LIVE rule bodies
 *
 * Unlike the sibling validator suites (which source-inspect, or drive an
 * in-test re-implementation of a rule), this file constructs the REAL
 * `FormValidator` (`core/plugins/lib/validator/src/form-validator.js`) — the
 * single rule engine that the routing layer runs server-side (via the
 * validator plugin `backendInit` → `new FormValidator(fields)`) AND the
 * browser runs client-side — and exercises each data-validation rule against
 * real inputs, asserting the actual `.valid` / `.errors` outcome.
 *
 * Why this exists: every shipped validation rule (isRequired / isEmail /
 * isString / isInteger / isNumber / isFloat / isDate / isBoolean / isInList)
 * previously had NO behavioral coverage of its real body — the engine that
 * guards every validated HTTP request was pinned only by string-matching or by
 * copies that "MUST mirror" the source. These tests execute the shipped code.
 *
 * Server seam: the framework's own server path builds the engine headless via
 * `new FormValidator(fields)` (validator plugin `backendInit`); that is exactly
 * what `vf()` below does. The `isGFFCtx` flag is `false` under node (module.exports
 * exists), so the server rule bodies run.
 *
 * Bootstrap: `require(<fw>/helpers)` injects the framework globals
 * (`getContext` / `setContext` / `_` / `requireJSON`); `getContext('gina')` is
 * seeded so the constructor's user-validator probe (`hasUserValidators`,
 * form-validator.js:95) is a no-op (no user-defined validators under test).
 *
 * CHARACTERIZATION NOTE: several assertions below lock behavior that is
 * surprising but CURRENT, e.g.
 *   - `isString` accepts a non-string value when the field is not required;
 *   - `isFloat` accepts a STRING "1.5" by coercing via `Number()` (#B46, fixed
 *     2026-06-15) — a whole number still fails (no fractional part); previously
 *     the strict `Number(val) === val` gate rejected every string;
 *   - `isInteger` treats "" as the integer 0;
 *   - `isDate` builds the Date from explicit numeric components + a round-trip
 *     range check (#B47, fixed 2026-06-15), so non-ISO slash masks validate and
 *     out-of-range dates (e.g. 2023-02-30) still reject (see § 09).
 * These are golden/characterization tests: a future change to any of them breaks
 * the matching test, prompting a deliberate confirm-or-fix. That is the point.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');

var FW = require('../fw');

// Inject framework globals before loading the engine, then seed a safe `gina`
// context so the constructor's `hasUserValidators()` probe doesn't throw.
process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0); // engine construction adds logger listeners per instance
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', {}); }

var FormValidator = require(path.join(FW, 'core/plugins/lib/validator/src/form-validator.js'));

/**
 * Build a one-field validator and return that field object (carrying the
 * chainable rule methods + `.valid` / `.errors`).
 * @param {string} name
 * @param {*} value
 * @returns {object} the field object
 */
function vf(name, value) {
    var data = {};
    data[name] = value;
    return new FormValidator(data)[name];
}

/** assert the field passed validation with no error recorded */
function ok(field) {
    assert.equal(field.valid, true, 'expected valid');
    assert.equal(typeof field.errors, 'undefined', 'expected no errors object on a valid field');
}

/** assert the field failed validation and recorded `errorKey` */
function ko(field, errorKey) {
    assert.equal(field.valid, false, 'expected invalid');
    assert.ok(field.errors && typeof field.errors[errorKey] === 'string',
        'expected errors.' + errorKey + ' to be set; got ' + JSON.stringify(field.errors || null));
}


// 00 — construction / harness sanity
describe('00 - construction', function () {

    it('builds a field object with chainable rule methods from data', function () {
        var v = new FormValidator({ email: 'a@b.com', n: '12' });
        assert.equal(typeof v.email, 'object');
        assert.equal(v.email.name, 'email');
        assert.equal(v.email.value, 'a@b.com');
        assert.equal(v.email.valid, false); // not validated yet
        assert.equal(typeof v.email.isEmail, 'function');
        assert.equal(typeof v.n.isInteger, 'function');
    });

    it('throws on missing data param', function () {
        assert.throws(function () { return new FormValidator(); }, /missing data param/);
    });
});


// 01 — isEmail
describe('01 - isEmail', function () {

    it('accepts a valid address', function () { ok(vf('e', 'a@b.com').isEmail()); });
    it('accepts a multi-label domain', function () { ok(vf('e', 'user@sub.domain.com').isEmail()); });
    it('rejects a non-email', function () { ko(vf('e', 'nope').isEmail(), 'isEmail'); });
    it('rejects an address with no TLD', function () { ko(vf('e', 'a@b').isEmail(), 'isEmail'); });

    it('empty value passes when the field is not required (documented empty-bypass)', function () {
        ok(vf('e', '').isEmail());
    });
});


// 02 — isRequired
describe('02 - isRequired', function () {

    it('rejects empty string', function () { ko(vf('x', '').isRequired(), 'isRequired'); });
    it('accepts a non-empty value', function () { ok(vf('x', 'y').isRequired()); });

    it('rejects a leading-whitespace-only value (the /^\\s+/ rule)', function () {
        // Distinguishes the live engine from the orphaned fluent lib/validator.js,
        // whose isRequired passes "   ".
        ko(vf('x', '   ').isRequired(), 'isRequired');
    });
});


// 03 — isString (+ length bounds)
describe('03 - isString', function () {

    it('accepts a string', function () { ok(vf('s', 'ab').isString()); });

    it('CHARACTERIZATION: accepts a non-string value when not required', function () {
        // The engine flips isValid → true for a not-required field even when the
        // value is a number; documented quirk, not an endorsement.
        ok(vf('s', 123).isString());
    });

    it('length bounds: value within [2,4] passes at both boundaries', function () {
        ok(vf('s', 'ab').isString(2, 4));    // len === min
        ok(vf('s', 'abcd').isString(2, 4));  // len === max
    });

    it('length bounds: too-short / too-long fail with isStringLength', function () {
        ko(vf('s', 'a').isString(2, 4), 'isStringLength');
        ko(vf('s', 'abcde').isString(2, 4), 'isStringLength');
    });
});


// 04 — isInteger (+ length bounds)
describe('04 - isInteger', function () {

    it('accepts an integer string and a real integer', function () {
        ok(vf('n', '12').isInteger());
        ok(vf('n', 12).isInteger());
    });

    it('rejects a non-integer', function () { ko(vf('n', '1.5').isInteger(), 'isInteger'); });

    it('CHARACTERIZATION: treats "" as the integer 0 (passes)', function () {
        ok(vf('n', '').isInteger());
    });

    it('length bounds [2,4]: in-range passes, out-of-range fails with isIntegerLength', function () {
        ko(vf('n', '1').isInteger(2, 4), 'isIntegerLength');
        ok(vf('n', '12').isInteger(2, 4));
        ok(vf('n', '1234').isInteger(2, 4));
        ko(vf('n', '12345').isInteger(2, 4), 'isIntegerLength');
    });
});


// 05 — isNumber
describe('05 - isNumber', function () {

    it('accepts an integer string', function () { ok(vf('n', '12').isNumber()); });
    it('accepts a float string (isNumber covers floats)', function () { ok(vf('n', '1.5').isNumber()); });
});


// 06 — isFloat
describe('06 - isFloat', function () {

    it('accepts a real float number', function () { ok(vf('n', 1.5).isFloat()); });

    it('accepts the STRING "1.5" (coerces via Number; #B46)', function () {
        // #B46 (2026-06-15): isFloat now coerces with Number() before testing
        // finiteness + a fractional part, so a string float validates server-side
        // (browser .value + urlencoded bodies are always strings). Previously the
        // strict `Number(val) === val` gate rejected every string value.
        ok(vf('n', '1.5').isFloat());
    });

    it('rejects an integer value (isFloat requires a fractional part)', function () {
        ko(vf('n', '2').isFloat(), 'isFloat');
    });
});


// 07 — isBoolean
describe('07 - isBoolean', function () {

    it('accepts boolean-ish values: true/false (bool), 1/0 (number), "true" (string)', function () {
        ok(vf('b', true).isBoolean());
        ok(vf('b', false).isBoolean());
        ok(vf('b', 1).isBoolean());
        ok(vf('b', 0).isBoolean());
        ok(vf('b', 'true').isBoolean());
    });

    it('rejects the string "1" and arbitrary words', function () {
        ko(vf('b', '1').isBoolean(), 'isBoolean');
        ko(vf('b', 'yes').isBoolean(), 'isBoolean');
    });
});


// 08 — isInList (allow-list membership)
describe('08 - isInList', function () {

    it('accepts a member', function () { ok(vf('st', 'draft').isInList('draft', 'sent')); });
    it('rejects a non-member', function () { ko(vf('st', 'x').isInList('draft', 'sent'), 'isInList'); });

    it('is case-sensitive', function () {
        ko(vf('st', 'Draft').isInList('draft', 'sent'), 'isInList');
    });

    it('CHARACTERIZATION: type-strict (=== ) — string "2" is NOT a member of [1,2,3]', function () {
        // Membership is strict indexOf; a string value never matches a numeric
        // allow-list (and vice-versa). Relevant across Content-Types: a JSON
        // client can send a number the string-only UI cannot, and vice-versa.
        ko(vf('st', '2').isInList(1, 2, 3), 'isInList');
    });

    it('empty value passes when not required (empty-bypass)', function () {
        ok(vf('st', '').isInList('draft', 'sent'));
    });
});


// 09 — isDate
//   NOTE: isDate now returns the field object on ALL paths (#B48, 2026-06-17),
//   like every other rule, so it chains. The parsed Date is preserved on the
//   field's .value (rendered via the field's own .format()). The valid cases
//   below still assert on the field via ok(f); the final test locks the #B48
//   return contract directly.
describe('09 - isDate', function () {

    it('accepts a valid ISO date with the yyyy-mm-dd mask', function () {
        var f = vf('dt', '2023-06-15');
        f.isDate('yyyy-mm-dd');
        ok(f);
    });

    it('rejects an invalid date (live engine catches Invalid Date — unlike the dead fluent file)', function () {
        ko(vf('dt', '2023-13-45').isDate('yyyy-mm-dd'), 'isDate');
    });

    it('defaults the mask to yyyy-mm-dd when passed `true`', function () {
        var f = vf('dt', '2023-06-15');
        f.isDate(true);
        ok(f);
    });

    it('accepts a non-ISO slash mask (dd/mm/yyyy) with day>12 (#B47)', function () {
        // #B47 (2026-06-15): isDate now builds the Date from explicit numeric
        // components identified by the mask tokens (y*/m*/d*) plus a round-trip
        // range check, so a non-ISO slash mask validates. (#B48 since made
        // isDate return the field on all paths; ok(f) asserts on the field
        // either way.)
        var f = vf('dt', '15/06/2023');
        f.isDate('dd/mm/yyyy');
        ok(f);
    });

    it('still rejects an impossible day in a non-ISO mask (2023-02-30) — round-trip check (#B47)', function () {
        // The component build alone would roll Feb 30 over to Mar 2; the
        // round-trip check (constructed components must equal the inputs) keeps
        // it rejected.
        ko(vf('dt', '30/02/2023').isDate('dd/mm/yyyy'), 'isDate');
    });

    it('returns the field object on its valid path so rules chain, with the Date kept on .value (#B48)', function () {
        var f = vf('dt', '2023-06-15');
        var ret = f.isDate('yyyy-mm-dd');
        // #B48: the valid path returns the field (chainable), like every other
        // rule, not the raw parsed Date.
        assert.strictEqual(ret, f, 'isDate should return the field object, not the parsed Date');
        // the parsed Date is preserved on .value (so the field's .format() still renders it)
        assert.ok(f.value instanceof Date, 'parsed Date preserved on field.value');
        // chaining into a subsequent validator rule works (threw on a Date pre-#B48)
        assert.strictEqual(ret.setLabel('Date'), f, 'a rule chained after isDate returns the field');
        assert.equal(f.valid, true);
    });
});


// 10 — chaining / error accumulation
describe('10 - chaining', function () {

    it('isRequired().isEmail() on "" records BOTH errors', function () {
        var f = vf('email', '');
        f.isRequired().isEmail();
        assert.equal(f.valid, false);
        assert.ok(f.errors && typeof f.errors.isRequired === 'string', 'expected isRequired error');
        assert.ok(f.errors && typeof f.errors.isEmail === 'string', 'expected isEmail error');
    });

    it('isRequired().isEmail() on a valid address passes with no errors', function () {
        var f = vf('email', 'a@b.com');
        f.isRequired().isEmail();
        ok(f);
    });
});
