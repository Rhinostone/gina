'use strict';
/**
 * #B178 — validator error-label coverage: behavioral tests on the REAL engine.
 *
 * Three defects, one family: the key an app can OBSERVE in a field's `errors`
 * object is not always the key the label catalog is consulted under, so
 * translating the observable key was a silent no-op.
 *
 *   1. Alias fill (`_labelAliasFill`) — four rule families consult a SPECIFIC
 *      label key while writing the error under a GENERIC one:
 *        errors['toFloat']         <- errorLabels['toFloatNAN']            (NaN branch)
 *        errors['isNumberLength']  <- errorLabels['isNumberMin|MaxLength']
 *        errors['isIntegerLength'] <- errorLabels['isIntegerMin|MaxLength']
 *        errors['isStringLength']  <- errorLabels['isStringMin|MaxLength']
 *      The fill copies an app-supplied generic onto each specific the app did
 *      not supply itself, on every consumer layer (server catalog, client
 *      catalog whisper, per-culture overrides, setErrorLabels). English
 *      defaults are never touched; an app-supplied specific always wins.
 *   2. Numbered `is` aliases (`is1`, `is2`, ...) had no default label at all —
 *      `replace()` fail-softed to an EMPTY message. They now fall back to the
 *      shared `is` label, which an app can translate once for all aliases.
 *   3. The user-validator setup loop unconditionally reset every user
 *      validator's label to the English default, clobbering app translations
 *      supplied via the catalog. It now fills only when absent.
 *
 * Harness affordances (documented, deliberate):
 *   - `toFloat` reads the live DOM value via document.getElementById(...) —
 *     browser-only; stubbed per-call (the engine's isGFFCtx stays false, so
 *     the write-back branch never runs).
 *   - The user-validator block references the bare `gina` global (the client
 *     window global). The server runtime has no such binding (measured:
 *     nothing assigns global.gina anywhere in the framework), so this suite
 *     seeds `global.gina = getContext('gina')` to reach the block — mirroring
 *     the client environment where the clobber actually fires.
 *   - Numbered aliases are driven the way the client alias wrapper does it:
 *     arm `global._currentValidatorAlias` immediately before calling is().
 *
 * Catalog seeding follows validator-label-i18n-server.test.js:
 * `process.gina._i18nCatalogs.<bundle>` + setContext('bundle') + the culture
 * constructor param (5th).
 */

var { describe, it, after } = require('node:test');
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
var DIST_RAW    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var FormValidator = require(ENGINE_PATH);

/** Build a one-field validator; return the whole validator (for setErrorLabels). */
function v(name, value, culture) {
    var data = {};
    data[name] = value;
    return new FormValidator(data, undefined, undefined, undefined, culture);
}

/**
 * Run `fn(field)` with the browser DOM read `toFloat` performs stubbed to
 * `domValue`; always removes the stub, even on throw.
 */
function withDocStub(field, domValue, fn) {
    global.document = {
        getElementById: function () { return { value: domValue }; }
    };
    field.target = { getAttribute: function () { return field.name; } };
    try {
        return fn(field);
    } finally {
        delete global.document;
    }
}


// 00 — source pins (structure of the fix; each validated red-first vs the pre-fix blob)
describe('00 - source pins', function () {

    it('defines the _labelAliasFill helper', function () {
        assert.match(ENGINE_SRC, /var _labelAliasFill = function\s*\(labels\)/,
            'expected the alias-fill helper definition');
    });

    it('maps all seven specific keys from their four observable generics', function () {
        // quote/space-agnostic: the map uses quoted string keys
        assert.match(ENGINE_SRC, /'toFloatNAN'\s*:\s*'toFloat'/);
        assert.match(ENGINE_SRC, /'isNumberMinLength'\s*:\s*'isNumberLength'/);
        assert.match(ENGINE_SRC, /'isNumberMaxLength'\s*:\s*'isNumberLength'/);
        assert.match(ENGINE_SRC, /'isIntegerMinLength'\s*:\s*'isIntegerLength'/);
        assert.match(ENGINE_SRC, /'isIntegerMaxLength'\s*:\s*'isIntegerLength'/);
        assert.match(ENGINE_SRC, /'isStringMinLength'\s*:\s*'isStringLength'/);
        assert.match(ENGINE_SRC, /'isStringMaxLength'\s*:\s*'isStringLength'/);
    });

    it('fills the server catalog node BEFORE the pinned defaults merge', function () {
        var fillIdx  = ENGINE_SRC.indexOf('_vNode = _labelAliasFill(JSON.clone(_vNode));');
        var mergeIdx = ENGINE_SRC.indexOf('local.errorLabels = merge(JSON.clone(_vNode), _defaultErrorLabels);');
        assert.ok(fillIdx >= 0, 'expected the server-node fill');
        assert.ok(mergeIdx >= 0, 'the pinned server merge line must stay byte-identical');
        assert.ok(fillIdx < mergeIdx, 'fill must run before the merge');
    });

    it('fills the client catalog + per-culture layers BEFORE their pinned merges', function () {
        var catFill   = ENGINE_SRC.indexOf('_catalogLabels = _labelAliasFill(JSON.clone(_catalogLabels));');
        var catMerge  = ENGINE_SRC.indexOf('merge(JSON.clone(_catalogLabels), local.errorLabels)');
        var cultFill  = ENGINE_SRC.indexOf('_cultureLabels = _labelAliasFill(JSON.clone(_cultureLabels));');
        var cultMerge = ENGINE_SRC.indexOf('merge(JSON.clone(_cultureLabels), local.errorLabels)');
        assert.ok(catFill >= 0 && cultFill >= 0, 'expected both client-layer fills');
        assert.ok(catMerge >= 0 && cultMerge >= 0, 'the pinned client merge lines must stay byte-identical');
        assert.ok(catFill < catMerge, 'catalog fill must run before its merge');
        assert.ok(cultFill < cultMerge, 'per-culture fill must run before its merge');
    });

    it('fills setErrorLabels input before its merge', function () {
        var fillIdx  = ENGINE_SRC.indexOf('_labelAliasFill(errorLabels);');
        var mergeIdx = ENGINE_SRC.indexOf('local.errorLabels = merge(errorLabels, local.errorLabels)');
        assert.ok(fillIdx >= 0, 'expected the setErrorLabels fill');
        assert.ok(mergeIdx >= 0, 'expected the setErrorLabels merge');
        assert.ok(fillIdx < mergeIdx, 'fill must run before the merge');
    });

    it('numbered is-aliases fall back to the shared is label (anchored to the call terminator)', function () {
        assert.match(ENGINE_SRC,
            /\|\| local\.errorLabels\[alias\] \|\| local\.errorLabels\['is'\], this, alias\)/,
            'expected the is-alias label fallback, anchored up to the replace() call terminator');
    });

    it('the user-validator default label is guarded (fill-if-absent wrapping the kept literal)', function () {
        assert.match(ENGINE_SRC,
            /if \( typeof\(local\.errorLabels\[v\]\) == 'undefined' \) \{\s*\n\s*local\.errorLabels\[v\] = 'Condition not satisfied';/,
            'expected the guard to structurally wrap the (kept) default-label assignment');
    });
});


// 01 — toFloat NaN branch: the observable key `toFloat` now reaches the consulted `toFloatNAN`
describe('01 - toFloatNAN <- toFloat alias', function () {

    var SENT_G = 'ALIAS-GENERIC-TOFLOAT';
    var SENT_S = 'ALIAS-SPECIFIC-TOFLOATNAN';

    it('setErrorLabels({toFloat}) takes effect on the NaN branch', function () {
        var val = v('price', 'abc');
        val.setErrorLabels({ toFloat: SENT_G });
        withDocStub(val.price, 'abc', function (f) { f.toFloat(2); });
        assert.equal(val.price.errors.toFloat, SENT_G,
            'translating the observable key must reach the consulted toFloatNAN label');
    });

    it('an app-supplied specific key still wins over the generic', function () {
        var val = v('price', 'abc');
        val.setErrorLabels({ toFloat: SENT_G, toFloatNAN: SENT_S });
        withDocStub(val.price, 'abc', function (f) { f.toFloat(2); });
        assert.equal(val.price.errors.toFloat, SENT_S);
    });

    it('with no override the English default still renders (control)', function () {
        var val = v('price', 'abc');
        withDocStub(val.price, 'abc', function (f) { f.toFloat(2); });
        assert.equal(val.price.errors.toFloat, 'Value must be a valid number');
    });

    it('a valid value produces no error keys (control)', function () {
        var val = v('price', '12.50');
        val.setErrorLabels({ toFloat: SENT_G });
        withDocStub(val.price, '12.50', function (f) { f.toFloat(2); });
        assert.equal(typeof val.price.errors, 'undefined');
    });
});


// 02 — the three Length families: generic fills min/max
describe('02 - is<X>MinLength/is<X>MaxLength <- is<X>Length alias', function () {

    var SENT = 'ALIAS-GENERIC-LENGTH';
    var SPEC = 'ALIAS-SPECIFIC-MIN';

    it('isNumber min-length failure renders the app generic', function () {
        var val = v('n', '12');
        val.setErrorLabels({ isNumberLength: SENT });
        val.n.isNumber(5);
        assert.equal(val.n.errors.isNumberLength, SENT,
            'the min failure consults isNumberMinLength — the fill must carry the generic there');
    });

    it('isNumber max-length failure renders the app generic', function () {
        var val = v('n', '123456');
        val.setErrorLabels({ isNumberLength: SENT });
        val.n.isNumber(null, 3);
        assert.equal(val.n.errors.isNumberLength, SENT);
    });

    it('an app-supplied specific min key wins over the generic', function () {
        var val = v('n', '12');
        val.setErrorLabels({ isNumberLength: SENT, isNumberMinLength: SPEC });
        val.n.isNumber(5);
        assert.equal(val.n.errors.isNumberLength, SPEC);
    });

    it('the exact-length case consulted the generic already (control, unchanged)', function () {
        var val = v('n', '12');
        val.setErrorLabels({ isNumberLength: SENT });
        val.n.isNumber(3, 3);
        assert.equal(val.n.errors.isNumberLength, SENT);
    });

    it('isInteger min-length failure renders the app generic', function () {
        var val = v('n', '12');
        val.setErrorLabels({ isIntegerLength: SENT });
        val.n.isInteger(5);
        assert.equal(val.n.errors.isIntegerLength, SENT);
    });

    it('isString min-length failure renders the app generic', function () {
        var val = v('s', 'ab');
        val.setErrorLabels({ isStringLength: SENT });
        val.s.isString(5);
        assert.equal(val.s.errors.isStringLength, SENT);
    });
});


// 03 — numbered is-aliases: shared `is` label instead of an empty message
describe('03 - is<N> alias label fallback', function () {

    /** Arm the alias slot exactly as the client wrapper does, then run is(). */
    function runAlias(field, aliasName, condition, errorMessage) {
        global._currentValidatorAlias = aliasName;
        return field.is(condition, errorMessage);
    }

    it('a failing is1 with no rule text renders the shared is default, not an empty message', function () {
        var val = v('f', 'x');
        runAlias(val.f, 'is1', false);
        assert.equal(val.f.errors.is1, 'Condition not satisfied');
    });

    it('translating `is` covers every numbered alias', function () {
        var SENT = 'ALIAS-SHARED-IS';
        var val = v('f', 'x');
        val.setErrorLabels({ is: SENT });
        runAlias(val.f, 'is2', false);
        assert.equal(val.f.errors.is2, SENT);
    });

    it('rule-supplied text still wins (control)', function () {
        var val = v('f', 'x');
        runAlias(val.f, 'is3', false, 'custom text');
        assert.equal(val.f.errors.is3, 'custom text');
    });

    it('the base is rule is unchanged (control)', function () {
        var val = v('f', 'x');
        val.f.is(false);
        assert.equal(val.f.errors.is, 'Condition not satisfied');
    });
});


// 04 — user-validator labels: catalog translation survives construction
describe('04 - user-validator label clobber guard', function () {

    var CAT_BUNDLE = 'lblaliasbundle';

    function setup() {
        setContext('gina', { forms: { validators: {
            myRule:    function () { this.valid = true; },
            otherRule: function () { this.valid = true; }
        } } });
        // Harness affordance: the engine's user-validator block reads the bare
        // client window global; seed the server equivalent so the block runs.
        global.gina = getContext('gina');
        if (!process.gina) { process.gina = {}; }
        process.gina._i18nCatalogs = process.gina._i18nCatalogs || {};
        process.gina._i18nCatalogs[CAT_BUNDLE] = {
            fr_FR: { _validator: {
                myRule: 'Regle maison (fr)',
                is:     'Condition (fr)'
            } }
        };
        setContext('bundle', CAT_BUNDLE);
    }
    function teardown() {
        delete global.gina;
        delete process.gina._i18nCatalogs[CAT_BUNDLE];
        setContext('gina', {});
    }
    after(teardown);

    it('a catalog translation for a user-validator key survives construction', function () {
        setup();
        var val = v('f', 'x', 'fr_FR');
        var labels = val.f.getValidationContext().local.errorLabels;
        assert.equal(labels.myRule, 'Regle maison (fr)',
            'the setup loop must not clobber an app-supplied user-validator label');
    });

    it('an untranslated user-validator key still gets the English default (control)', function () {
        setup();
        var val = v('f', 'x', 'fr_FR');
        var labels = val.f.getValidationContext().local.errorLabels;
        assert.equal(labels.otherRule, 'Condition not satisfied');
    });

    it('a catalog is-translation composes with the numbered-alias fallback', function () {
        setup();
        var val = v('f', 'x', 'fr_FR');
        global._currentValidatorAlias = 'is1';
        val.f.is(false);
        assert.equal(val.f.errors.is1, 'Condition (fr)');
    });
});


// 05 — dist fidelity: the alias-map pair reaches the built browser bundle
// (red before the prod rebuild, green after — the rebuild-detection control)
describe('05 - dist fidelity', function () {

    var PAIR = /['"]?toFloatNAN['"]?\s*:\s*['"]toFloat['"]/;

    it('gina.js carries the toFloatNAN<-toFloat map pair', function () {
        var raw = fs.readFileSync(DIST_RAW, 'utf8');
        assert.match(raw, PAIR);
    });

    it('gina.min.js carries the toFloatNAN<-toFloat map pair', function () {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        assert.match(min, PAIR);
    });
});
