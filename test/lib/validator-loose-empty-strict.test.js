'use strict';
/**
 * #B199 — the rule engine no longer conflates loosely-empty values with ''
 *
 * The defect class: five sites tested emptiness with LOOSE equality against ''
 * (`val != ''` at the isInteger/isNumber bounds gates, `this.value == ''` at the
 * isEmail/isJsonWebToken/isFloat #B78 empty-bypasses). Loose coercion makes
 * `0 == ''`, `-0 == ''`, `false == ''` and `[] == ''` all TRUE, so those values
 * rode the empty-value bypass: bounds were skipped, and — worse — the three
 * format rules PASSED them outright (a JSON body's `{email: 0}` validated as a
 * correct email). All five sites now compare strictly, so only the literal empty
 * string bypasses — which is the whole of what the designed contract (#B78:
 * "empty is adjudicated by isRequired alone") ever meant.
 *
 * DELIBERATELY UNTOUCHED (pinned by § 04 so a future sweep cannot widen this
 * silently): `isString`'s gate (typeof-guarded — only real strings reach it, and
 * loose vs strict is identical for strings), `isInList` (already strict),
 * `isDate` (its `!val` swallow of 0 is a broader falsy semantic, report-only),
 * and the `is` condition rule (its own guarded branch, cross-field semantics).
 *
 * NOT covered here (filed as #B200, unfixed): a TRUTHY non-string in an
 * isEmail/isJsonWebToken field throws at an unguarded `.toLowerCase()` and the
 * rule driver's catch RE-THROWS, killing the whole validation run.
 *
 * Bootstrap mirrors `validator-engine-rules.test.js`.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0); // engine construction adds logger listeners per instance
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', {}); }

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var ENGINE_SRC  = fs.readFileSync(ENGINE_PATH, 'utf8');
var FormValidator = require(ENGINE_PATH);

/**
 * Build a one-field validator and return that field object.
 * @param {string} name
 * @param {*} value
 * @returns {object} the field object
 */
function vf(name, value) {
    var data = {};
    data[name] = value;
    return new FormValidator(data)[name];
}

/**
 * Assert the field validated cleanly.
 * @param {object} field
 * @param {string} [ msg ]
 */
function ok(field, msg) {
    assert.equal(field.valid, true, msg || 'expected valid');
    assert.equal(typeof field.errors, 'undefined', 'expected no errors object on a valid field');
}

/**
 * Assert the field failed and recorded `errorKey`.
 * @param {object} field
 * @param {string} errorKey
 * @param {string} [ msg ]
 */
function ko(field, errorKey, msg) {
    assert.equal(field.valid, false, msg || 'expected invalid');
    assert.ok(
        field.errors && typeof field.errors[errorKey] === 'string',
        (msg || 'expected an error') + ' — expected errors[' + errorKey + '], got ' +
            JSON.stringify(field.errors)
    );
}


// 01 — source pins: the five sites are strict, scoped exactly
describe('01 - source: the five approved sites compare strictly', function () {

    /**
     * Slice the source to one rule's body so pins cannot match a sibling.
     * @param {string} ruleName
     * @returns {string}
     */
    function bodyOf(ruleName) {
        var start = ENGINE_SRC.indexOf("self[el]['" + ruleName + "'] = function");
        assert.ok(start > -1, 'rule ' + ruleName + ' not found');
        var next = ENGINE_SRC.indexOf("self[el]['", start + 10);
        return ENGINE_SRC.slice(start, next > -1 ? next : ENGINE_SRC.length);
    }

    it('isInteger + isNumber bounds gates use strict !==', function () {
        assert.match(bodyOf('isInteger'), /!errors\['isRequired'\]\s*&&\s*val\s*!==\s*''/);
        assert.match(bodyOf('isNumber'),  /!errors\['isRequired'\]\s*&&\s*val\s*!==\s*''/);
    });

    it('isEmail + isJsonWebToken + isFloat bypasses use strict ===', function () {
        ['isEmail', 'isJsonWebToken', 'isFloat'].forEach(function (r) {
            assert.match(bodyOf(r), /if\s*\(\s*this\.value\s*===\s*''\s*\)/, r + ' bypass must be strict');
        });
    });

    it('CONTROL: isString\'s gate stays LOOSE (typeof-guarded — out of the approved scope)', function () {
        // A future "flip every loose empty-compare" sweep must not widen #B199
        // silently: isString's gate is behind typeof(val) == 'string', where
        // loose and strict are identical — it was deliberately left alone.
        assert.match(bodyOf('isString'), /!errors\['isRequired'\]\s*&&\s*val\s*!=\s*''/);
    });
});


// 02 — the bounds gates: loosely-empty values no longer skip bounds
describe('02 - bounds gates (isInteger / isNumber)', function () {

    it('Number 0 and -0 hit the bounds on both rules', function () {
        ko(vf('n', 0).isInteger(2),  'isIntegerLength');
        ko(vf('n', -0).isInteger(2), 'isIntegerLength');
        ko(vf('n', 0).isNumber(2),   'isNumberLength');
        ko(vf('n', -0).isNumber(2),  'isNumberLength');
    });

    it('an ARRAY no longer slips the bounds ([].toString() is "", length 0)', function () {
        ko(vf('n', []).isInteger(2), 'isIntegerLength');
        ko(vf('n', []).isNumber(2),  'isNumberLength');
    });

    it('CONTRACT: the literal empty string still bypasses both gates', function () {
        ok(vf('n', '').isInteger(2));
        ok(vf('n', '').isNumber(2));
    });

    it('CONTROL: in-range values still pass', function () {
        ok(vf('n', 12).isInteger(2));
        ok(vf('n', 12).isNumber(2));
    });
});


// 03 — the #B78 bypasses: format rules no longer PASS loosely-empty values
describe('03 - format rules (isEmail / isJsonWebToken / isFloat)', function () {

    it('isEmail records an error for the Number 0 and for false (it PASSED them before)', function () {
        ko(vf('e', 0).isEmail(),     'isEmail', 'a JSON body\'s {email: 0} must not validate');
        ko(vf('e', -0).isEmail(),    'isEmail');
        ko(vf('e', false).isEmail(), 'isEmail');
    });

    it('isJsonWebToken records an error for the Number 0 and for false', function () {
        ko(vf('t', 0).isJsonWebToken(),     'isJsonWebToken');
        ko(vf('t', false).isJsonWebToken(), 'isJsonWebToken');
    });

    it('isFloat records an error for the Number 0, false and [] (whole numbers fail isFloat by contract)', function () {
        ko(vf('f', 0).isFloat(),     'isFloat');
        ko(vf('f', false).isFloat(), 'isFloat');
        ko(vf('f', []).isFloat(),    'isFloat');
    });

    it('CONTRACT: the literal empty string still bypasses all three (#B78 preserved)', function () {
        ok(vf('e', '').isEmail());
        ok(vf('t', '').isJsonWebToken());
        ok(vf('f', '').isFloat());
    });

    it('CONTROL: a real email and a real float still pass; real rejects still reject', function () {
        ok(vf('e', 'a@b.co').isEmail());
        ok(vf('f', '1.5').isFloat());
        ko(vf('e', 'not-an-email').isEmail(), 'isEmail');
    });
});


// 04 — the deliberately-untouched neighbours (pins against silent widening)
describe('04 - untouched neighbours keep their measured behaviour', function () {

    it('isInList was already strict: 0 rejects, \'\' bypasses (unchanged)', function () {
        // gotcha #14: isInList collects its list via `arguments` — spread it.
        var f0 = vf('l', 0);
        f0 = f0.isInList.apply(f0, ['a', 'b']);
        assert.equal(f0.valid, false, 'the Number 0 is not in the list');
        var fe = vf('l', '');
        fe = fe.isInList.apply(fe, ['a', 'b']);
        assert.equal(fe.valid, true, 'the literal empty string keeps its bypass');
    });

    it('isDate still swallows the Number 0 via its broader !val gate (report-only, NOT part of #B199)', function () {
        // Characterization (MEASURED, correcting the design note's first draft):
        // isDate's `!val || val == ''` branch returns early recording NO error
        // while leaving the field flag false — a silent half-state, for the
        // Number 0 and for the literal '' alike. Form-level validity reads
        // getErrors().count(), so the form passes with no message either way.
        // Changing that is a separate decision on isDate's own semantics —
        // pinned so #B199 is not mistaken for having covered it.
        var f0 = vf('d', 0).isDate('yyyy-mm-dd');
        assert.equal(f0.valid, false, 'field flag is false (not a pass)');
        assert.equal(typeof f0.errors, 'undefined', 'yet NO error records — the form-level swallow');
        var fe = vf('d', '').isDate('yyyy-mm-dd');
        assert.equal(fe.valid, false, 'the empty string lands in the same half-state');
        assert.equal(typeof fe.errors, 'undefined');
        // known-negative control: a garbage string DOES record isDate.
        ko(vf('d', 'garbage').isDate('yyyy-mm-dd'), 'isDate');
    });
});
