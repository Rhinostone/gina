/**
 * validator-label-i18n-server — SERVER-side per-culture built-in rule labels (Slice 2).
 *
 * Companion to validator-label-i18n.test.js (the CLIENT overlay). gina's built-in
 * FormValidator rule labels are English by default. This slice lets the SERVER engine
 * (`!isGFFCtx`) resolve them from the same per-bundle catalog the client reads —
 * `bundle/locales/<culture>.json` under the `_validator.<rule>` namespace — so a
 * controller/middleware doing server-side form validation gets localized labels by
 * passing the negotiated `req.culture` as the trailing constructor arg.
 *
 * Threading (main.js): the optional trailing `culture` flows
 *   ValidatorPlugin(rules, data, formId, culture)
 *     -> backendInit(rules, data, formId, culture)
 *        -> validate(..., culture)  -> new FormValidator(fields, null, xhrOptions, undefined, culture)   [form-body]
 *        -> new FormValidator(fields, undefined, undefined, undefined, culture)                          ["by hand"]
 * Resolution (form-validator.js): after seeding English defaults, the `!isGFFCtx`
 * overlay resolves the culture's `_validator` node via the i18n primitives
 * (walkFallback -> getCatalog -> resolveKey) and merges it over English
 * (target-wins -> catalog wins per key, English fills gaps). A per-field/rule `error`
 * still wins. Existence-guarded via resolveKey (undefined on miss), never `t()`.
 *
 * Routing is deliberately NOT localized: the 3 routing-mode calls
 * (`new Validator('routing', _data, null, _rule)`) run during route MATCHING
 * (getCached/compareUrls), which executes BEFORE req.culture is negotiated
 * (_negotiateReqCulture) — so req.culture is undefined there. The routing call's inert
 * rule object lands in the `culture` slot and is ignored by the `typeof culture ===
 * 'string'` guard, so routing-requirement labels stay English by design.
 *
 * Shape: (a) source-structure pins across the 2 touched files + the routing-descope
 * negative pin, (b) a behavioural check against the REAL FormValidator + REAL lib/i18n
 * (seed a catalog -> localized label; subtracts for no-catalog / no-culture / non-string
 * culture -> English), (c) a pure-logic replica of the overlay resolution driven by the
 * REAL i18n primitives + lib/merge with a subtract, (d) a built-dist guard.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, 'helpers'));
/* global getContext, setContext, JSON */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'i18nsrvbundle');

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var MAIN_PATH   = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var ROUTING_PATH = path.join(FW, 'lib/routing/src/main.js');
var DIST_RAW    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var ENGINE_SRC  = fs.readFileSync(ENGINE_PATH, 'utf8');
var MAIN_SRC    = fs.readFileSync(MAIN_PATH, 'utf8');
var ROUTING_SRC = fs.readFileSync(ROUTING_PATH, 'utf8');

var FormValidator = require(ENGINE_PATH);
var Validator     = require(MAIN_PATH); // ValidatorPlugin (the public gina.plugins.Validator)
var i18n          = require(path.join(FW, 'lib/i18n'));
var merge         = require(path.join(FW, 'lib/merge'));

// Seed a FR catalog with a partial _validator node (2 of 26 rules localized).
if (!process.gina) { process.gina = {}; }
process.gina._i18nCatalogs = process.gina._i18nCatalogs || {};
process.gina._i18nCatalogs.i18nsrvbundle = {
    fr_FR: { _validator: {
        isEmail:    'Un email valide est requis',
        isRequired: 'Ne peut etre vide'
    } },
    fr: { _validator: {
        isRequired: 'Requis (fr)'
    } }
};

/** Construct a server FormValidator with `culture`, run one failing rule, return its error label. */
async function labelFor(rule, value, culture) {
    var data = { field: value };
    var v = new FormValidator(data, undefined, undefined, undefined, culture);
    var res = await v.field[rule]({}, {}, {}, function () {});
    return res && res.errors ? res.errors[rule] : undefined;
}


// 01 — form-validator.js server-overlay source pins
describe('01 - server overlay source pins (form-validator.js)', function () {

    it('requires lib/i18n on the server branch only', function () {
        assert.ok(ENGINE_SRC.indexOf("var i18n            = (isGFFCtx) ? null : require('../../../../../lib/i18n');") >= 0,
            'expected the server-only i18n require (null in the browser)');
    });

    it('adds the optional trailing culture constructor param', function () {
        assert.ok(ENGINE_SRC.indexOf('function FormValidatorUtil(data, $fields, xhrOptions, fieldsSet, culture) {') >= 0,
            'expected the culture 5th param on FormValidatorUtil');
    });

    it('overlay is gated on !isGFFCtx AND a string culture', function () {
        assert.ok(ENGINE_SRC.indexOf("if ( !isGFFCtx && i18n && typeof(culture) === 'string' && culture ) {") >= 0,
            'expected the server + string-culture guard');
    });

    it('resolves via the i18n primitives (walkFallback -> getCatalog -> resolveKey)', function () {
        assert.ok(ENGINE_SRC.indexOf('i18n.walkFallback(culture)') >= 0, 'expected the fallback-chain walk');
        assert.ok(ENGINE_SRC.indexOf('i18n.getCatalog(_vBundle, _vChain[_vi])') >= 0, 'expected per-chain-step catalog lookup');
        assert.ok(ENGINE_SRC.indexOf("i18n.resolveKey(_vCat, '_validator')") >= 0, 'expected the _validator node resolve');
    });

    it('merges catalog over English (target-wins -> catalog wins, English fills)', function () {
        assert.ok(ENGINE_SRC.indexOf('local.errorLabels = merge(JSON.clone(_vNode), _defaultErrorLabels);') >= 0,
            'expected catalog-clone as target, English defaults as source');
    });

    it('reads the bundle from getContext (mirrors the existing :731 usage)', function () {
        assert.ok(ENGINE_SRC.indexOf("var _vBundle = getContext('bundle');") >= 0,
            'expected the bundle resolved from context');
    });
});


// 02 — main.js culture-threading source pins
describe('02 - culture threading source pins (main.js)', function () {

    it('ValidatorPlugin + backendInit + validate declare the trailing culture param', function () {
        assert.ok(MAIN_SRC.indexOf('function ValidatorPlugin(rules, data, formId, culture) {') >= 0);
        assert.ok(MAIN_SRC.indexOf('var backendInit = function (rules, data, formId, culture) {') >= 0);
        assert.ok(MAIN_SRC.indexOf('var validate = function($formOrElement, fields, $fields, rules, cb, culture) {') >= 0);
    });

    it('forwards culture through the dispatch and both server FormValidator sites', function () {
        assert.ok(MAIN_SRC.indexOf('return backendInit(rules, data, formId, culture)') >= 0, 'dispatch forwards culture');
        // REALIGNED 2026-08-04 (approved): #B241 restructured backendInit's form-body
        // call from a direct `return` to an assignment (the alias restore runs before
        // returning) — same call site, same argument list, culture still forwarded.
        assert.ok(MAIN_SRC.indexOf('var backendResult = validate($form, fields, null, instance.rules, null, culture);') >= 0, 'form-body path forwards culture');
        assert.ok(MAIN_SRC.indexOf('return new FormValidator(fields, undefined, undefined, undefined, culture)') >= 0, '"by hand" 293 site threads culture');
        assert.ok(MAIN_SRC.indexOf('d = new FormValidator(fields, null, xhrOptions, undefined, culture);') >= 0, 'validate 7149 site threads culture');
    });
});


// 03 — routing-descope negative pin: routing sites are UNCHANGED (culture not threaded)
describe('03 - routing stays English by design (negative pin)', function () {

    it('the 3 routing-mode calls still pass the inert _rule (culture NOT threaded)', function () {
        var n = (ROUTING_SRC.match(/new Validator\('routing', _data, null, _rule \)/g) || []).length;
        assert.equal(n, 3, 'expected all 3 routing-mode calls unchanged');
    });

    it('request.culture is NOT threaded into any routing-mode call', function () {
        assert.ok(ROUTING_SRC.indexOf("new Validator('routing', _data, null, request.culture") < 0,
            'routing must not thread request.culture — it is undefined at route-match time');
    });
});


// 04 — behavioural against the REAL FormValidator + REAL lib/i18n
describe('04 - server overlay behaviour (real engine + real i18n)', function () {

    it('a seeded fr_FR catalog localizes a failing isEmail label', async function () {
        assert.equal(await labelFor('isEmail', 'notanemail', 'fr_FR'), 'Un email valide est requis');
    });

    it('a seeded fr_FR catalog localizes a failing isRequired label', async function () {
        assert.equal(await labelFor('isRequired', '', 'fr_FR'), 'Ne peut etre vide');
    });

    it('base-language fallback: fr_CA resolves via the seeded fr base-language catalog', async function () {
        // walkFallback('fr_CA') = ['fr_CA','fr','en']; fr_CA is unseeded, fr has a _validator node.
        assert.equal(await labelFor('isRequired', '', 'fr_CA'), 'Requis (fr)');
    });

    it('SUBTRACT: an unseeded culture (de_DE) -> English default', async function () {
        assert.equal(await labelFor('isEmail', 'notanemail', 'de_DE'), 'A valid email is required');
    });

    it('SUBTRACT: no culture -> English default', async function () {
        assert.equal(await labelFor('isEmail', 'notanemail', undefined), 'A valid email is required');
    });

    it('SUBTRACT: a non-string culture (routing rule object) -> English default', async function () {
        assert.equal(await labelFor('isEmail', 'notanemail', { email: { isEmail: {} } }), 'A valid email is required');
    });

    // Full plugin path: gina.plugins.Validator({}, data, formId, culture) -> backendInit
    // (count 0 -> the "by hand" 293 site) -> new FormValidator(..., culture) -> overlay.
    // This is the manual server-side validation pattern a controller/middleware uses:
    // construct with req.culture, then call v.field.rule(...) directly. (The auto path —
    // real rules -> validate -> 7149 — threads culture too but has a pre-existing
    // server crash at validate's forEachField, so it is not exercised here.)
    it('full plugin path (Validator -> backendInit -> 293) localizes with a string culture', async function () {
        var v = new Validator({}, { email: 'notanemail' }, null, 'fr_FR');
        var r = await v.email.isEmail({}, {}, {}, function () {});
        assert.equal(r.errors.isEmail, 'Un email valide est requis');
    });

    it('SUBTRACT: full plugin path with no culture -> English default', async function () {
        var v = new Validator({}, { email: 'notanemail' }, null);
        var r = await v.email.isEmail({}, {}, {}, function () {});
        assert.equal(r.errors.isEmail, 'A valid email is required');
    });
});


// 05 — pure-logic replica of the overlay resolution (REAL i18n primitives + REAL merge)
describe('05 - overlay resolution replica (real primitives)', function () {

    var english = {
        isEmail   : 'A valid email is required',
        isRequired: 'Cannot be left empty',
        isString  : 'Must be a string'
    };

    // faithful mirror of the form-validator.js overlay loop
    function resolve(bundle, culture) {
        var labels = english;
        if (typeof culture === 'string' && culture) {
            var chain = i18n.walkFallback(culture), node = null;
            for (var i = 0; i < chain.length; i++) {
                var cat = i18n.getCatalog(bundle, chain[i]);
                if (cat) {
                    var found = i18n.resolveKey(cat, '_validator');
                    if (found && typeof found === 'object') { node = found; break; }
                }
            }
            if (node) { labels = merge(JSON.clone(node), english); }
        }
        return labels;
    }

    it('GUARD: real lib/merge is target-wins + source-fills', function () {
        assert.deepEqual(merge({ a: 1 }, { a: 9, b: 2 }), { a: 1, b: 2 });
    });

    it('GUARD: walkFallback appends en and yields the culture->base->en chain', function () {
        assert.deepEqual(i18n.walkFallback('fr_FR'), ['fr_FR', 'fr', 'en']);
    });

    it('fr_FR node wins per key, English fills the rest', function () {
        var out = resolve('i18nsrvbundle', 'fr_FR');
        assert.equal(out.isEmail, 'Un email valide est requis'); // catalog wins
        assert.equal(out.isString, 'Must be a string');          // English fill (not in catalog)
    });

    it('fr_CA falls back to the fr base-language node', function () {
        var out = resolve('i18nsrvbundle', 'fr_CA'); // chain fr_CA->fr->en; first node is fr
        assert.equal(out.isRequired, 'Requis (fr)');            // fr node
        assert.equal(out.isEmail, 'A valid email is required'); // fr node lacks isEmail -> English fill
    });

    it('SUBTRACT: without the merge, a French bundle reverts to English', function () {
        function resolvePreFix() { return english; } // overlay removed
        assert.equal(resolve('i18nsrvbundle', 'fr_FR').isEmail, 'Un email valide est requis');
        assert.equal(resolvePreFix().isEmail, 'A valid email is required');
    });

    it('non-string culture / unseeded bundle -> English', function () {
        assert.equal(resolve('i18nsrvbundle', { obj: 1 }).isEmail, 'A valid email is required');
        assert.equal(resolve('nosuchbundle', 'fr_FR').isEmail, 'A valid email is required');
    });
});


// 06 — built dist carries the server-overlay symbols (rebuild guard)
describe('06 - built dist carries the server overlay', function () {

    var RAW = fs.readFileSync(DIST_RAW, 'utf8');

    it('gina.js (un-minified) carries the culture param + overlay primitives', function () {
        assert.ok(RAW.indexOf('fieldsSet, culture') >= 0, 'FormValidatorUtil culture param bundled');
        assert.ok(RAW.indexOf('walkFallback') >= 0, 'overlay resolution bundled');
        assert.ok(RAW.indexOf("require('../../../../../lib/i18n')") >= 0, 'server i18n require bundled (null client-side)');
    });
});
