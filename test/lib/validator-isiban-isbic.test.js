'use strict';
/**
 * #FIN4 — `isIban` / `isBic` FormValidator rules — behavioral, real engine
 *
 * Constructs the REAL `FormValidator`
 * (`core/plugins/lib/validator/src/form-validator.js`) headless — the exact
 * server seam the validator plugin's `backendInit` uses — and drives the two
 * rules against verified fixtures. Same bootstrap as
 * `validator-engine-rules.test.js`.
 *
 * Fixture provenance: every IBAN checksum below was independently verified
 * with a BigInt reference implementation of ISO 7064 MOD 97-10 before being
 * embedded. The shipped rule computes the checksum with chunked Number
 * arithmetic (<= 9-digit folds; no BigInt in bundled source — build-chain
 * constraint), so an independent oracle keeps a chunking defect from
 * self-certifying.
 *
 * Label assertions: this engine is constructed with NO culture and NO bundle
 * catalog, so the English `_defaultErrorLabels` entry IS the contract under
 * test here (the map entry + `replace()` wiring). This does not key any
 * consumer-facing verification on an English label — catalogs still displace
 * these per key at runtime (validator.md §5f/§5g).
 *
 * §09 source pins + §10 dist pins follow the house discipline: validated
 * red-first against `git show HEAD:` bytes (0-pre / N-post across the commit
 * that adds the rules), dist pins anchor only on tokens that survive Closure
 * SIMPLE (string literals / property tokens), never local variable names.
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

var FormValidator = require(path.join(FW, 'core/plugins/lib/validator/src/form-validator.js'));

var SRC_PATH     = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var FORM_VAL_SRC = fs.readFileSync(SRC_PATH, 'utf8');
var DIST_JS      = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_JS  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

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

// --- fixtures (checksums independently verified — see header) ---
var VALID_FR        = 'FR1420041010050500013M02606';   // 27 = FR registry length, mod97 = 1
var VALID_DE        = 'DE89370400440532013000';        // 22 = DE registry length, mod97 = 1
var VALID_GB        = 'GB29NWBK60161331926819';        // 22 = GB registry length, mod97 = 1
var VALID_DE_SPACED = 'DE89 3704 0044 0532 0130 00';   // ISO 13616 print format
var VALID_DE_LOWER  = 'de89370400440532013000';
var VALID_GB_HYPHEN = 'GB29-NWBK-6016-1331-9268-19';
var VALID_ZZ        = 'ZZ31A1B2C3D4E5';                // mod97 = 1; country NOT in the registry table
var BAD_MOD97       = 'DE89370400440532013001';        // one digit off — mod97 reads 28
var BAD_LENGTH      = 'DE291234567890123456';          // 20 chars, mod97 = 1 — ONLY the DE=22 length gate rejects it
var BAD_COUNTRY_DIG = 'D189370400440532013000';        // digit in the country code
var BAD_CHAR        = 'DE8937040044053201300&';        // illegal character
var BAD_SHORT       = 'DE89';                          // below minimum shape

// --- 01 — isIban passes verified-valid IBANs ---
describe('01 — isIban passes canonical valid IBANs', function () {

    it('accepts a valid FR IBAN (27 chars)', function () {
        ok(vf('iban', VALID_FR).isIban());
    });

    it('accepts a valid DE IBAN (22 chars)', function () {
        ok(vf('iban', VALID_DE).isIban());
    });

    it('accepts a valid GB IBAN (22 chars)', function () {
        ok(vf('iban', VALID_GB).isIban());
    });

    it('chains — returns the field object', function () {
        var f = vf('iban', VALID_DE);
        assert.equal(f.isIban(), f);
    });
});

// --- 02 — tolerant read: separators + case, value NEVER mutated ---
describe('02 — isIban tolerant read leaves the stored value untouched', function () {

    it('accepts the ISO print format (space-grouped)', function () {
        ok(vf('iban', VALID_DE_SPACED).isIban());
    });

    it('accepts lowercase input', function () {
        ok(vf('iban', VALID_DE_LOWER).isIban());
    });

    it('accepts hyphen-separated input', function () {
        ok(vf('iban', VALID_GB_HYPHEN).isIban());
    });

    it('does not mutate a spaced value (validation-only normalization)', function () {
        var f = vf('iban', VALID_DE_SPACED);
        f.isIban();
        assert.equal(f.value, VALID_DE_SPACED);
    });

    it('does not mutate a lowercase value', function () {
        var f = vf('iban', VALID_DE_LOWER);
        f.isIban();
        assert.equal(f.value, VALID_DE_LOWER);
    });
});

// --- 03 — isIban rejects, with the registered label ---
describe('03 — isIban rejects invalid IBANs', function () {

    it('rejects a MOD-97 failure (single-digit flip)', function () {
        ko(vf('iban', BAD_MOD97).isIban(), 'isIban');
    });

    it('rejects a checksum-VALID IBAN at the wrong length for its country (DE=22 gate)', function () {
        // BAD_LENGTH reads mod97 === 1 (verified) at 20 chars — only the
        // per-country registry gate can reject it, so this arm discriminates
        // the length table from the checksum.
        ko(vf('iban', BAD_LENGTH).isIban(), 'isIban');
    });

    it('rejects a digit in the country code', function () {
        ko(vf('iban', BAD_COUNTRY_DIG).isIban(), 'isIban');
    });

    it('rejects an illegal character', function () {
        ko(vf('iban', BAD_CHAR).isIban(), 'isIban');
    });

    it('rejects a too-short value', function () {
        ko(vf('iban', BAD_SHORT).isIban(), 'isIban');
    });

    it('records the registered default label', function () {
        var f = vf('iban', BAD_MOD97);
        f.isIban();
        assert.equal(f.errors.isIban, 'A valid IBAN is required');
    });

    it('clears a prior isIban error when the value re-becomes valid', function () {
        var f = vf('iban', BAD_MOD97);
        f.isIban();
        assert.equal(f.valid, false);
        f.value = VALID_DE;
        f.isIban();
        assert.equal(f.valid, true);
        assert.equal(typeof (f.errors && f.errors.isIban), 'undefined');
    });
});

// --- 04 — unknown country: shape + checksum alone (documented) ---
describe('04 — isIban passes an unknown country on shape + MOD-97', function () {

    it('accepts a mod97-valid IBAN whose country is not in the registry table', function () {
        ok(vf('iban', VALID_ZZ).isIban());
    });
});

// --- 05 — non-string values adjudicated invalid, never thrown (#B200 posture) ---
describe('05 — isIban non-string values record invalid without throwing', function () {

    it('number', function () { ko(vf('iban', 123).isIban(), 'isIban'); });
    it('boolean', function () { ko(vf('iban', true).isIban(), 'isIban'); });
    it('object', function () { ko(vf('iban', {}).isIban(), 'isIban'); });
    it('null', function () { ko(vf('iban', null).isIban(), 'isIban'); });
});

// --- 06 — empty bypass + isRequired interplay (#B78 / #B199) ---
describe('06 — isIban empty value is adjudicated by isRequired alone', function () {

    it('empty string passes when not required', function () {
        ok(vf('iban', '').isIban());
    });

    it('required + empty records ONLY isRequired (no second message)', function () {
        var f = vf('iban', '');
        f.isRequired().isIban();
        assert.equal(f.valid, false);
        assert.ok(f.errors && typeof f.errors.isRequired === 'string');
        assert.equal(typeof f.errors.isIban, 'undefined');
    });

    it('required + valid IBAN passes', function () {
        ok(vf('iban', VALID_DE).isRequired().isIban());
    });
});

// --- 07 — isBic (ISO 9362 shape) ---
describe('07 — isBic accepts 8- and 11-character BICs, case-insensitive', function () {

    it('accepts an 8-char BIC', function () {
        ok(vf('bic', 'DEUTDEFF').isBic());
    });

    it('accepts an 11-char BIC (branch code)', function () {
        ok(vf('bic', 'DEUTDEFF500').isBic());
    });

    it('accepts another 8-char BIC', function () {
        ok(vf('bic', 'AGRIFRPP').isBic());
    });

    it('accepts lowercase input without mutating the value', function () {
        var f = vf('bic', 'deutdeff');
        f.isBic();
        assert.equal(f.valid, true);
        assert.equal(f.value, 'deutdeff');
    });

    it('chains — returns the field object', function () {
        var f = vf('bic', 'DEUTDEFF');
        assert.equal(f.isBic(), f);
    });
});

describe('08 — isBic rejects malformed BICs', function () {

    it('rejects 7 chars', function () { ko(vf('bic', 'DEUTDEF').isBic(), 'isBic'); });
    it('rejects 9 chars', function () { ko(vf('bic', 'DEUTDEFF5').isBic(), 'isBic'); });
    it('rejects 12 chars', function () { ko(vf('bic', 'DEUTDEFF5000').isBic(), 'isBic'); });
    it('rejects a digit in the business-party prefix', function () { ko(vf('bic', 'DEU1DEFF').isBic(), 'isBic'); });
    it('rejects a digit in the country code', function () { ko(vf('bic', 'DEUT12FF').isBic(), 'isBic'); });
    it('rejects an internal space', function () { ko(vf('bic', 'DEUT DEFF').isBic(), 'isBic'); });

    it('records the registered default label', function () {
        var f = vf('bic', 'DEUTDEF');
        f.isBic();
        assert.equal(f.errors.isBic, 'A valid BIC is required');
    });

    it('non-strings record invalid without throwing (#B200 posture)', function () {
        ko(vf('bic', 123).isBic(), 'isBic');
        ko(vf('bic', true).isBic(), 'isBic');
        ko(vf('bic', {}).isBic(), 'isBic');
        ko(vf('bic', null).isBic(), 'isBic');
    });

    it('empty string passes when not required; required + empty records only isRequired', function () {
        ok(vf('bic', '').isBic());
        var f = vf('bic', '');
        f.isRequired().isBic();
        assert.equal(f.valid, false);
        assert.ok(f.errors && typeof f.errors.isRequired === 'string');
        assert.equal(typeof f.errors.isBic, 'undefined');
    });
});

// --- 09 — production source shape (each pin validated red-first vs git show HEAD:) ---
describe('09 — production source shape', function () {

    // strip comment lines so negative pins cannot trip on JSDoc / replace-code
    // convention comments (the own-JSDoc trap, jsdoc.md)
    var ACTIVE = FORM_VAL_SRC.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');

    function sliceBody(src, declLit, endLit) {
        assert.equal(src.split(declLit).length, 2, 'decl literal must be unique: ' + declLit);
        var from = src.indexOf(declLit);
        var to = src.indexOf(endLit, from);
        assert.ok(to > from, 'end literal not found after decl: ' + endLit);
        return src.slice(from, to);
    }

    it('errorLabels register both rules', function () {
        assert.ok(FORM_VAL_SRC.indexOf("'isIban': 'A valid IBAN is required'") > -1);
        assert.ok(FORM_VAL_SRC.indexOf("'isBic': 'A valid BIC is required'") > -1);
    });

    it('both rules are registered on self[el], once each', function () {
        assert.equal(FORM_VAL_SRC.split("self[el]['isIban'] = function() {").length, 2);
        assert.equal(FORM_VAL_SRC.split("self[el]['isBic'] = function() {").length, 2);
    });

    it('registration order: isEmail < isJsonWebToken < isIban < isBic < isBoolean', function () {
        var iEmail = FORM_VAL_SRC.indexOf("self[el]['isEmail']");
        var iJwt   = FORM_VAL_SRC.indexOf("self[el]['isJsonWebToken']");
        var iIban  = FORM_VAL_SRC.indexOf("self[el]['isIban']");
        var iBic   = FORM_VAL_SRC.indexOf("self[el]['isBic']");
        var iBool  = FORM_VAL_SRC.indexOf("self[el]['isBoolean']");
        assert.ok(iEmail > 0 && iJwt > iEmail && iIban > iJwt && iBic > iIban && iBool > iBic);
    });

    it('isIban body: validation-only normalization, type guard, length gate, chunked MOD-97', function () {
        var body = sliceBody(ACTIVE, "self[el]['isIban'] = function() {", "self[el]['isBic']");
        assert.ok(body.indexOf(".toUpperCase().replace(/[\\s-]+/g, '')") > -1, 'candidate normalization');
        assert.ok(body.indexOf("typeof(candidate) == 'string'") > -1, 'type guard folded into isValid');
        assert.ok(body.indexOf('_ibanLengths[country]') > -1, 'per-country length gate');
        assert.ok(body.indexOf('% 97') > -1, 'chunked modulo');
        assert.ok(body.indexOf('remainder === 1') > -1, 'MOD-97 verdict');
        assert.doesNotMatch(body, /BigInt/, 'no BigInt in bundled source (build-chain constraint)');
    });

    it('isIban body: #B78/#B199 contract + no value mutation', function () {
        var body = sliceBody(ACTIVE, "self[el]['isIban'] = function() {", "self[el]['isBic']");
        assert.ok(body.indexOf("if ( this.value === '' ) {") > -1, 'strict empty bypass');
        assert.ok(body.indexOf("this.valid = isValid && !errors['isRequired']") > -1, '.valid regate');
        // non-mutation: no assignment to this.value (comparison `===` excluded),
        // and no DOM write at all in the body
        assert.doesNotMatch(body, /this\.value\s*=[^=]/, 'must not assign this.value');
        assert.doesNotMatch(body, /this\.target/, 'must not touch the DOM');
    });

    it('isBic body: ISO 9362 shape regex, no case mutation, #B78/#B199 contract', function () {
        var body = sliceBody(ACTIVE, "self[el]['isBic'] = function() {", "self[el]['isBoolean']");
        assert.ok(body.indexOf('[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?') > -1, 'ISO 9362 shape');
        assert.ok(body.indexOf("if ( this.value === '' ) {") > -1, 'strict empty bypass');
        assert.ok(body.indexOf("this.valid = isValid && !errors['isRequired']") > -1, '.valid regate');
        assert.doesNotMatch(body, /toLowerCase|toUpperCase/, 'case-insensitive by regex, never by mutation');
        assert.doesNotMatch(body, /this\.value\s*=[^=]/, 'must not assign this.value');
        assert.doesNotMatch(body, /this\.target/, 'must not touch the DOM');
    });

    it('the country-length registry exists once, with verified anchor entries', function () {
        assert.equal(FORM_VAL_SRC.split('var _ibanLengths = {').length, 2);
        assert.ok(FORM_VAL_SRC.indexOf("'DE': 22") > -1);
        assert.ok(FORM_VAL_SRC.indexOf("'FR': 27") > -1);
        assert.ok(FORM_VAL_SRC.indexOf("'GB': 22") > -1);
        assert.ok(FORM_VAL_SRC.indexOf("'NO': 15") > -1, 'shortest registry length');
        assert.ok(FORM_VAL_SRC.indexOf("'RU': 33") > -1, 'longest registry length');
    });
});

// --- 10 — dist fidelity (tokens that survive Closure SIMPLE only) ---
describe('10 — dist carries the rules', function () {

    var distJs  = fs.readFileSync(DIST_JS, 'utf8');
    var distMin = fs.readFileSync(DIST_MIN_JS, 'utf8');

    it('unminified gina.js carries both rule declarations and the registry', function () {
        assert.ok(distJs.indexOf("self[el]['isIban'] = function() {") > -1);
        assert.ok(distJs.indexOf("self[el]['isBic'] = function() {") > -1);
        assert.ok(distJs.indexOf('var _ibanLengths = {') > -1);
    });

    it('gina.min.js carries the rule-name tokens', function () {
        // token count, not grep -c: min.js is near-single-line. Floors are
        // set below the measured post-build counts so an unrelated Closure
        // reshaping cannot false-red them; 0 on the pre-#FIN4 artifact.
        assert.ok(distMin.split('isIban').length - 1 >= 5, 'isIban tokens in min bundle');
        assert.ok(distMin.split('isBic').length - 1 >= 5, 'isBic tokens in min bundle');
    });

    it('gina.min.js carries both default labels', function () {
        assert.ok(distMin.indexOf('A valid IBAN is required') > -1);
        assert.ok(distMin.indexOf('A valid BIC is required') > -1);
    });
});
