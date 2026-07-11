/**
 * validator-server-auto — the server-side AUTO-validation path (#B85 regression).
 *
 * `gina.plugins.Validator(<rulesObject>, data, formId[, culture])` on the server
 * (`!isGFFCtx`) dispatches backendInit -> validate($form, fields, null, rules, null,
 * culture) -> forEachField, whose field loop used to read
 * `$fields[field].getAttribute('type')` unconditionally — one line ABOVE its own
 * missing-field guard. backendInit always passes `$fields = null` on this path, so the
 * very first field crashed with `TypeError: Cannot read properties of null` and the
 * auto path never worked server-side (only the MANUAL count-0 dispatch did). The same
 * bare read also fired BEFORE the client-side warn+continue guard, so a rule field
 * absent from the client `$fields` collection threw instead of reaching the warning
 * written for exactly that case.
 *
 * Fix: the assignment is guarded — `( $fields && typeof($fields[field]) != 'undefined' )
 * ? $fields[field].getAttribute('type') : null`. Server: null, inert (every
 * `localFieldType` consumer sits inside an `isGFFCtx` block). Client: a present field
 * takes the identical getAttribute call; a missing one now reaches the warn+continue.
 *
 * Conditional (`_case_`/conditions) rules retain additional server-unsafe `$fields`
 * reads deeper in forEachField — full server support for those is a separate, larger
 * change (tracked in the internal ledger); this file covers the PLAIN-rules path only.
 *
 * Shape: (a) source pins on the guarded assignment + a whole-source negative pin on the
 * old bare read, (b) behavioural runs of the REAL plugin over the server auto path
 * (invalid / valid / different-rule-invalid + the return-shape contract), (c) a
 * pure-logic replica of the guard with a subtract proving the pre-fix expression throws.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes')); // Object.prototype.count() — backendInit needs it
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'srvautobundle');

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var MAIN_SRC  = fs.readFileSync(MAIN_PATH, 'utf8');

var Validator = require(MAIN_PATH); // ValidatorPlugin (the public gina.plugins.Validator)

// Seed a culture catalog for §02.5 (same shape as validator-label-i18n-server.test.js) —
// the overlay is gated on a STRING culture arg, so the culture-less cases stay English.
if (!process.gina) { process.gina = {}; }
process.gina._i18nCatalogs = process.gina._i18nCatalogs || {};
process.gina._i18nCatalogs.srvautobundle = {
    fr_FR: { _validator: { isRequired: 'Ne peut etre vide' } }
};

describe('validator-server-auto §01 — source pins on the forEachField field-type guard', function () {

    it('01.1 - the localFieldType assignment is the guarded ternary (guard before the DOM read)', function () {
        assert.match(
            MAIN_SRC,
            /localFieldType = \( \$fields && typeof\(\$fields\[field\]\) != 'undefined' \)\s*\n\s*\? \$fields\[field\]\.getAttribute\('type'\)\s*\n\s*: null;/,
            'expected the guarded ternary assignment for localFieldType'
        );
    });

    it('01.2 - the old bare read is globally absent (whole-source negative pin)', function () {
        // Window-independent: the pre-fix line must not exist anywhere in the file,
        // comments included (the fix comment deliberately avoids the literal).
        assert.ok(
            MAIN_SRC.indexOf("localFieldType = $fields[field].getAttribute('type');") < 0,
            'the unguarded localFieldType DOM read must not reappear'
        );
    });
});

describe('validator-server-auto §02 — behavioural: plain-rules server auto path (REAL plugin)', function () {

    // Fresh rules object per call — parseRules mutates its input.
    function plainRules() {
        return { username: { isRequired: true, isEmail: true } };
    }

    it('02.1 - invalid data (empty required field) -> isValid() false + isRequired error', function () {
        var res = Validator(plainRules(), { username: '' }, 'srv-auto-form');
        assert.ok(res && typeof res === 'object', 'auto path must return a result object');
        assert.equal(typeof res.isValid, 'function', 'result.isValid is callable');
        assert.equal(res.isValid(), false);
        assert.ok(res.error && res.error.username, 'errors keyed by field');
        assert.equal(typeof res.error.username.isRequired, 'string', 'isRequired error label present');
        assert.ok(res.error.username.isRequired.length > 0);
    });

    it('02.2 - valid data -> isValid() true and no errors', function () {
        var res = Validator(plainRules(), { username: 'someone@domain.tld' }, 'srv-auto-form');
        assert.equal(res.isValid(), true);
        assert.deepEqual(res.error, {});
    });

    it('02.3 - a different rule fails independently (isEmail on a non-empty value)', function () {
        var res = Validator(plainRules(), { username: 'not-an-email' }, 'srv-auto-form');
        assert.equal(res.isValid(), false);
        assert.equal(typeof res.error.username.isEmail, 'string', 'isEmail error label present');
        assert.equal(typeof res.error.username.isRequired, 'undefined', 'isRequired must not fire on a non-empty value');
    });

    it('02.4 - return-shape contract: { isValid(), error, data } with the submitted data echoed', function () {
        var res = Validator(plainRules(), { username: 'someone@domain.tld' }, 'srv-auto-form');
        assert.ok(Object.keys(res).indexOf('error') > -1);
        assert.ok(Object.keys(res).indexOf('data') > -1);
        assert.equal(res.data.username, 'someone@domain.tld');
    });

    it('02.5 - culture threading: the trailing culture localises auto-path labels; no culture -> English', function () {
        var fr = Validator({ username: { isRequired: true } }, { username: '' }, 'srv-auto-form', 'fr_FR');
        assert.equal(fr.error.username.isRequired, 'Ne peut etre vide');
        var en = Validator({ username: { isRequired: true } }, { username: '' }, 'srv-auto-form');
        assert.equal(en.error.username.isRequired, 'Cannot be left empty');
    });
});

describe('validator-server-auto §03 — guard replica + subtract (pre-fix expression throws)', function () {

    // Replica of the shipped expression, byte-faithful in structure.
    function guardedFieldType($fields, field) {
        return ( $fields && typeof($fields[field]) != 'undefined' )
            ? $fields[field].getAttribute('type')
            : null;
    }

    it('03.1 - replica: null $fields (server auto path) -> null, no throw', function () {
        assert.equal(guardedFieldType(null, 'username'), null);
    });

    it('03.2 - replica: present client field -> the getAttribute value (client parity)', function () {
        var $fields = { username: { getAttribute: function (a) { return (a === 'type') ? 'text' : null; } } };
        assert.equal(guardedFieldType($fields, 'username'), 'text');
    });

    it('03.3 - replica: field missing from a truthy client collection -> null (warn path reachable)', function () {
        assert.equal(guardedFieldType({ other: {} }, 'username'), null);
    });

    it('03.4 - SUBTRACT: the pre-fix bare read throws TypeError on the server auto path', function () {
        assert.throws(function () {
            var $fields = null;
            var field = 'username';
            // the pre-fix shape, verbatim
            var localFieldType = $fields[field].getAttribute('type');
            return localFieldType;
        }, TypeError);
    });

    it('03.5 - SUBTRACT: the pre-fix bare read also throws for a missing client field (the dead warn path)', function () {
        assert.throws(function () {
            var $fields = { other: {} };
            var field = 'username';
            var localFieldType = $fields[field].getAttribute('type');
            return localFieldType;
        }, TypeError);
    });
});
