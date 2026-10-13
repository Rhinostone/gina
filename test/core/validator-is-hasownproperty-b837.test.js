/**
 * #B837 — a field named `hasOwnProperty` no longer stops the validator's `is` rule.
 *
 * The `is` rule (and its numbered aliases `is0`, `is1`, …) resolves `$name` tokens
 * against the instance's fields, which it finds by scanning the instance:
 * `self.hasOwnProperty(fieldKey)`. The engine stores every field of the data as an own
 * field object on the instance, so a field named `hasOwnProperty` replaced the method,
 * the scan called an object, and the rule threw « could not evaluate `<field>->is0()` »
 * — on the server, where a route's `validator::` requirement or a validator built from
 * `req.post` / `req.get` runs it. The scan now uses
 * `Object.prototype.hasOwnProperty.call(self, fieldKey)`.
 *
 * Shape: behavioural runs of the REAL plugin over the server auto path (the
 * validator-is-alias.test.js §03 idiom), each beside a control without the field and a
 * near-miss name, plus a negative pin on the active source.
 *
 * SEAM (red-first with no tree revert): GINA_B837_FW points every arm at another
 * framework directory, e.g. one whose validator is the pre-fix copy.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = process.env.GINA_B837_FW || require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes')); // Object.prototype.count() — backendInit needs it
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'b837bundle');

var FV_SRC = fs.readFileSync(path.join(FW, 'core/plugins/lib/validator/src/form-validator.js'), 'utf8');
var Validator = require(path.join(FW, 'core/plugins/lib/validator/src/main.js'));

/** Fresh rules per call: the engine mutates its input. */
function rules() {
    return {
        amount : { isNumber: true, is0: ['$amount <= $cap', 'too high'] },
        cap    : { isNumber: true }
    };
}

function run(data) { return Validator(rules(), data, 'b837-form'); }

/** Strips line and block comments, so the fix's own `// was:` record cannot trip the pin. */
function activeLines(src) {
    return src.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
}

describe('validator-is-hasownproperty-b837 §01 — controls: the is rule without the field', function () {

    it('01.1 - an in-range value validates, an over-cap value is rejected by is0', function () {
        assert.equal(run({ amount: '50', cap: '100' }).isValid(), true);
        var res = run({ amount: '150', cap: '100' });
        assert.equal(res.isValid(), false);
        assert.equal(res.error.amount.is0, 'too high');
    });

    it('01.2 - a near-miss field name changes nothing', function () {
        assert.equal(run({ amount: '50', cap: '100', hasOwnPropertyX: 'x' }).isValid(), true);
        var res = run({ amount: '150', cap: '100', hasOwnPropertyX: 'x' });
        assert.equal(res.isValid(), false);
        assert.equal(res.error.amount.is0, 'too high');
    });
});

describe('validator-is-hasownproperty-b837 §02 — a field named hasOwnProperty', function () {

    it('02.1 - an in-range value validates (was: « could not evaluate »)', function () {
        var res = run({ amount: '50', cap: '100', hasOwnProperty: 'x' });
        assert.equal(res.isValid(), true);
        assert.deepEqual(res.error, {});
    });

    it('02.2 - an over-cap value is still rejected by is0: the rule ran', function () {
        var res = run({ amount: '150', cap: '100', hasOwnProperty: 'x' });
        assert.equal(res.isValid(), false);
        assert.equal(res.error.amount.is0, 'too high');
    });
});

describe('validator-is-hasownproperty-b837 §03 — source pin', function () {

    it('03.1 - the engine calls no hasOwnProperty through the instance', function () {
        assert.ok(FV_SRC.indexOf('self.hasOwnProperty(') > -1, 'control: the raw text keeps the replaced line as a `// was:` record');
        assert.equal(activeLines(FV_SRC).indexOf('self.hasOwnProperty('), -1);
        assert.ok(activeLines(FV_SRC).indexOf('Object.prototype.hasOwnProperty.call(self, fieldKey)') > -1);
    });
});
