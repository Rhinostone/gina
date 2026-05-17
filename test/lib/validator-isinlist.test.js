'use strict';
var path   = require('path');
var fs     = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW             = require('../fw');
var FORM_VAL_SRC   = fs.readFileSync(path.join(FW, 'core/plugins/lib/validator/src/form-validator.js'), 'utf8');

// Test-local replica of `self[el]['isInList']` from
// `core/plugins/lib/validator/src/form-validator.js`. Behavioural tests below
// run against the replica; source-shape tests in the last describe block pin
// the production source to the same logic so the replica cannot silently
// drift. Same convention as `test/lib/validator-scs1{e,f,g,h,i}.test.js` —
// FormValidatorUtil's runtime dependency chain (logger / routing /
// getContext / setContext) makes direct instantiation infeasible in
// node:test.
function makeField(initialValue) {
    var local = {
        errorLabels: { 'isInList': 'Must be one of: %s' },
        keys: { '%l': 'label', '%n': 'name', '%s': 'size' },
        data: {}
    };
    var self = {};
    var fieldName = 'status';
    self[fieldName] = {
        name: fieldName,
        value: initialValue,
        valid: false,
        label: ''
    };

    var replace = function (target, fieldObj) {
        var keys = target.match(/%[a-z]+/gi);
        if (keys) {
            for (var k = 0, len = keys.length; k < len; ++k) {
                target = target.replace(new RegExp(keys[k], 'g'), fieldObj[local.keys[keys[k]]]);
            }
        }
        return target;
    };

    self[fieldName]['isInList'] = function () {
        var errors = self[this['name']]['errors'] || {};

        var allowedValues = [];
        for (var i = 0, len = arguments.length; i < len; ++i) {
            var t = typeof(arguments[i]);
            if (t !== 'string' && t !== 'number' && t !== 'boolean') {
                throw new Error('`isInList` requires an array of allowed primitive values; got ' + t + ' at position ' + i + '. Use `isInList: ["a", "b", "c"]` form.');
            }
            allowedValues.push(arguments[i]);
        }

        var val     = local.data[this.name] = this.value;
        var isValid = false;

        if ( !errors['isRequired'] && (val === '' || val == null) ) {
            isValid = true;
        } else if ( allowedValues.indexOf(val) > -1 ) {
            isValid = true;
        }

        if (!isValid) {
            this['size'] = allowedValues.join(', ');
            errors['isInList'] = replace(this.error || local.errorLabels['isInList'], this);
        } else if ( typeof(errors['isInList']) != 'undefined' ) {
            delete errors['isInList'];
        }

        this.valid = isValid;
        if ( Object.keys(errors).length > 0 ) {
            this['errors'] = errors;
        }

        return self[this.name];
    };

    return self[fieldName];
}

// --- 01 — Passes when value is a member ---
describe('01 — isInList passes on member value', function () {

    it('strict-matches a string member', function () {
        var f = makeField('pending');
        f.isInList('draft', 'pending', 'sent', 'paid');
        assert.equal(f.valid, true);
        assert.equal(typeof f.errors, 'undefined');
    });

    it('strict-matches a number member', function () {
        var f = makeField(2);
        f.isInList(1, 2, 3);
        assert.equal(f.valid, true);
    });

    it('strict-matches a boolean member', function () {
        var f = makeField(true);
        f.isInList(true, false);
        assert.equal(f.valid, true);
    });

    it('chains — returns the field object', function () {
        var f = makeField('draft');
        var ret = f.isInList('draft', 'pending');
        assert.equal(ret, f);
    });
});

// --- 02 — Fails when value is not a member ---
describe('02 — isInList fails on non-member value', function () {

    it('rejects a non-member string', function () {
        var f = makeField('archived');
        f.isInList('draft', 'pending', 'sent', 'paid');
        assert.equal(f.valid, false);
        assert.ok(f.errors);
        assert.match(f.errors.isInList, /^Must be one of: /);
    });

    it('interpolates the allowed values into the error message', function () {
        var f = makeField('archived');
        f.isInList('draft', 'pending');
        assert.equal(f.errors.isInList, 'Must be one of: draft, pending');
    });

    it('clears a prior isInList error when value re-becomes valid', function () {
        var f = makeField('archived');
        f.isInList('draft', 'pending');
        assert.equal(f.valid, false);
        f.value = 'draft';
        f.isInList('draft', 'pending');
        assert.equal(f.valid, true);
    });
});

// --- 03 — Strict === semantics ---
describe('03 — isInList uses strict equality', function () {

    it('rejects "2" string when the list contains the number 2', function () {
        var f = makeField('2');
        f.isInList(1, 2, 3);
        assert.equal(f.valid, false);
    });

    it('rejects "true" string when the list contains the boolean true', function () {
        var f = makeField('true');
        f.isInList(true, false);
        assert.equal(f.valid, false);
    });
});

// --- 04 — Empty allowed-list rejects every value ---
describe('04 — empty allowed-list fails non-empty values', function () {

    it('fails when no args are passed (apply([]) at the dispatcher)', function () {
        var f = makeField('draft');
        f.isInList();
        assert.equal(f.valid, false);
        assert.ok(f.errors);
        assert.equal(typeof f.errors.isInList, 'string');
    });
});

// --- 05 — Empty value bypass (mirror isString convention) ---
describe('05 — empty value passes when not required', function () {

    it('passes when value is empty string and isRequired has not flagged it', function () {
        var f = makeField('');
        f.isInList('draft', 'pending');
        assert.equal(f.valid, true);
    });

    it('passes when value is null and isRequired has not flagged it', function () {
        var f = makeField(null);
        f.isInList('draft', 'pending');
        assert.equal(f.valid, true);
    });
});

// --- 06 — Non-primitive args throw a config error ---
describe('06 — non-primitive args reject as config error', function () {

    it('throws when a request-shaped object is passed (non-array dispatch path)', function () {
        var f = makeField('draft');
        assert.throws(
            function () { f.isInList('draft', { method: 'POST', url: '/x' }, {}, function () {}); },
            /isInList.+requires an array/i
        );
    });

    it('throws when an array is passed as a single arg (mistake)', function () {
        var f = makeField('draft');
        assert.throws(
            function () { f.isInList(['draft', 'pending']); },
            /isInList.+requires an array/i
        );
    });

    it('throws for a null arg', function () {
        var f = makeField('draft');
        assert.throws(
            function () { f.isInList('draft', null); },
            /isInList.+requires an array/i
        );
    });
});

// --- 07 — Dispatcher apply-spread parity ---
describe('07 — apply()-spread mimics routing dispatcher', function () {

    it('accepts the spread form via apply()', function () {
        var f = makeField('pending');
        f.isInList.apply(f, ['draft', 'pending', 'sent']);
        assert.equal(f.valid, true);
    });

    it('handles mixed primitive types under spread', function () {
        var f = makeField(1);
        f.isInList.apply(f, [1, '2', true]);
        assert.equal(f.valid, true);
    });
});

// --- 08 — Production-source-shape pins ---
// These pin the test-local replica above to the production source. If
// `form-validator.js` drifts (the rule body is rewritten with different
// semantics), these tests fail and the replica must be re-synced.
describe('08 — production source shape', function () {

    it('errorLabel for isInList is registered', function () {
        assert.match(
            FORM_VAL_SRC,
            /['"]isInList['"]\s*:\s*['"]Must be one of: %s['"]/
        );
    });

    it('isInList method is registered on self[el]', function () {
        assert.match(
            FORM_VAL_SRC,
            /self\[el\]\['isInList'\]\s*=\s*function\s*\(\s*\)/
        );
    });

    it('body collects allowed values via arguments-iteration', function () {
        var section = FORM_VAL_SRC.split(/self\[el\]\['isInList'\]\s*=\s*function\s*\(\s*\)\s*\{/)[1];
        assert.ok(section, 'isInList body not located in source');
        var head = section.split(/\n\s{8}\}\s*\n/)[0];
        assert.match(head, /arguments\.length/);
        assert.match(head, /allowedValues\.push\(arguments\[i\]\)/);
    });

    it('body rejects non-primitive args with the expected error', function () {
        var section = FORM_VAL_SRC.split(/self\[el\]\['isInList'\]\s*=\s*function\s*\(\s*\)\s*\{/)[1];
        var head = section.split(/\n\s{8}\}\s*\n/)[0];
        assert.match(head, /requires an array of allowed primitive values/);
        assert.match(head, /typeof\(arguments\[i\]\)/);
        assert.match(head, /!==\s*'string'/);
        assert.match(head, /!==\s*'number'/);
        assert.match(head, /!==\s*'boolean'/);
    });

    it('body uses indexOf for membership check (strict ===)', function () {
        var section = FORM_VAL_SRC.split(/self\[el\]\['isInList'\]\s*=\s*function\s*\(\s*\)\s*\{/)[1];
        var head = section.split(/\n\s{8}\}\s*\n/)[0];
        assert.match(head, /allowedValues\.indexOf\(val\)\s*>\s*-1/);
    });

    it('body bypasses when value is empty and not required', function () {
        var section = FORM_VAL_SRC.split(/self\[el\]\['isInList'\]\s*=\s*function\s*\(\s*\)\s*\{/)[1];
        var head = section.split(/\n\s{8}\}\s*\n/)[0];
        assert.match(head, /!errors\['isRequired'\]\s*&&\s*\(val === ''\s*\|\|\s*val == null\)/);
    });

    it('body joins allowedValues with ", " for the error message', function () {
        var section = FORM_VAL_SRC.split(/self\[el\]\['isInList'\]\s*=\s*function\s*\(\s*\)\s*\{/)[1];
        var head = section.split(/\n\s{8}\}\s*\n/)[0];
        assert.match(head, /this\['size'\]\s*=\s*allowedValues\.join\(', '\)/);
    });

    it('isInList sits between isDate and format in the rule registration order', function () {
        var iDate = FORM_VAL_SRC.indexOf("self[el]['isDate']");
        var iList = FORM_VAL_SRC.indexOf("self[el]['isInList']");
        var iFmt  = FORM_VAL_SRC.indexOf("self[el]['format']");
        assert.ok(iDate > 0, 'isDate not found');
        assert.ok(iList > 0, 'isInList not found');
        assert.ok(iFmt  > 0, 'format not found');
        assert.ok(iDate < iList && iList < iFmt, 'isInList should land between isDate and format');
    });
});
