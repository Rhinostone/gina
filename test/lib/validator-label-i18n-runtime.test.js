/**
 * validator-label-i18n-runtime — runtime semantics of catalog-supplied built-in labels.
 *
 * Fourth file in the `validator-label-i18n-*` family. The three siblings cover the
 * REGISTRY layer (validator-label-i18n.test.js), the SERVER overlay
 * (validator-label-i18n-server.test.js) and the CLIENT whisper + 3-layer precedence
 * (validator-label-i18n-client-catalog.test.js). None of them covers what happens to a
 * catalog label once the overlay has installed it, nor when the overlay is re-evaluated.
 * Both gaps were surfaced by a consuming app's real-browser verification and are pinned
 * here so a refactor cannot silently break them.
 *
 * (a) %-token interpolation is LABEL-SOURCE-AGNOSTIC. `replace()` (form-validator.js)
 *     substitutes tokens in whatever string the rule resolved — English default, bundle
 *     catalog, or `setErrorLabels()` override alike. This matters more than it looks:
 *     length bounds are declared as array args (`"isString": [5]`), spread through
 *     `apply()` in main.js, so `isStringMinLength` / `isStringMaxLength` are reachable
 *     from rule files that never name those keys. A catalog author translating them MUST
 *     keep the `%s`, or the bound vanishes from the message.
 *
 * (b) The %-token vocabulary is CLOSED and case-sensitive. `replace()` matches
 *     /%[a-z]+/gi greedily and looks each hit up verbatim in `local.keys`, so an unknown
 *     token (`%d`, `%L`) — or a literal percent glued to letters, as in `20%sur le prix`
 *     — resolves to `undefined` and is spliced into user-facing copy. A non-string label
 *     makes `replace()` throw outright. Neither is detectable from the catalog alone at
 *     render time, so `lib/i18n loadCatalogs` lints the `_validator` node once at boot.
 *
 * (c) Labels are LATE-BOUND, per validation pass. The overlay lives in the
 *     `FormValidatorUtil` constructor, and the engine is re-constructed inside
 *     `validate()` on every pass — not once at bind time. So a `setErrorLabels()` call
 *     made after `new FormValidator(...)` (canonically from a `ready` handler, which
 *     fires right after `gina.validator = instance`) applies from the next pass onward.
 *
 * Shape: (a)/(b) drive the REAL engine + REAL lib/i18n with a seeded catalog, each with a
 * known-negative control so a passing read cannot come from a stuck instrument; the lint
 * is exercised against real `loadCatalogs` over temp dirs; (c) is a real-engine
 * per-construction re-read on the server layer plus source pins for the client layer
 * (whose overlay is `isGFFCtx`-gated and therefore unreachable from node).
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var MAIN_PATH   = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var I18N_PATH   = path.join(FW, 'lib/i18n/src/main.js');

var ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
var MAIN_SRC   = fs.readFileSync(MAIN_PATH, 'utf8');
var I18N_SRC   = fs.readFileSync(I18N_PATH, 'utf8');

var FormValidator = require(ENGINE_PATH);
var i18n          = require(path.join(FW, 'lib/i18n'));

if (!process.gina) { process.gina = {}; }
process.gina._i18nCatalogs = process.gina._i18nCatalogs || {};

// Catalog whose labels deliberately exercise every %-token class.
process.gina._i18nCatalogs.i18nrtbundle = {
    fr_FR: { _validator: {
        isStringMinLength: 'Au moins %s caracteres',
        isEmail:           'Le champ %n est invalide',
        isBoolean:         'Doit valoir %d',            // unknown token
        isRequired:        'Remise 100%sur le prix',    // literal percent glued to letters
        isInteger:         'Champ %l requis'            // %l is frontend-only (DOM label)
    } }
};

/**
 * Run one failing rule through the REAL engine for `culture`, return the rendered label.
 * `args` are spread into the rule exactly as main.js's `apply()` spreads a rule file's
 * array args, so `isString` receives its minLength.
 */
async function render(bundle, rule, value, culture, errorKey, args) {
    setContext('bundle', bundle);
    var v = new FormValidator({ field: value }, undefined, undefined, undefined, culture);
    var res = await v.field[rule].apply(v.field, args || [{}, {}, {}, function () {}]);
    return res && res.errors ? res.errors[errorKey || rule] : undefined;
}

/** Capture console.warn emitted while `fn` runs. */
function captureWarns(fn) {
    var warns = [];
    var original = console.warn;
    console.warn = function () { warns.push(Array.prototype.join.call(arguments, ' ')); };
    try { fn(); } finally { console.warn = original; }
    return warns;
}

/** Write `catalog` as `<tmp>/fr.json`, run loadCatalogs, return { loaded, warns }. */
function lintCatalog(bundleName, catalog) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-i18n-rt-'));
    fs.writeFileSync(path.join(dir, 'fr.json'), JSON.stringify(catalog));
    var loaded;
    var warns = captureWarns(function () { loaded = i18n.loadCatalogs(bundleName, dir); });
    fs.rmSync(dir, { recursive: true, force: true });
    return { loaded: loaded, warns: warns };
}

/** Call `fn`, returning the thrown error (or null). Tolerates sync throw and rejection. */
async function thrownBy(fn) {
    try { await fn(); return null; } catch (err) { return err; }
}


// 01 — %-token interpolation reads the MERGED label set (catalog labels included)
describe('01 - %-tokens interpolate in catalog-supplied labels (real engine + real i18n)', function () {

    it('substitutes %s from a catalog label, via an array-arg rule (isString: [5])', async function () {
        // `isString(5)` sets field.size = 5 and renders the `isStringMinLength` label.
        var msg = await render('i18nrtbundle', 'isString', 'abc', 'fr_FR', 'isStringLength', [5]);
        assert.equal(msg, 'Au moins 5 caracteres');
    });

    it('substitutes %n (field name) from a catalog label', async function () {
        var msg = await render('i18nrtbundle', 'isEmail', 'notanemail', 'fr_FR');
        assert.equal(msg, 'Le champ field est invalide');
    });

    it('KNOWN-NEGATIVE control: a culture with no catalog renders the English default', async function () {
        // If this ever localizes, the instrument is stuck and every reading above is void.
        var msg = await render('i18nrtbundle', 'isString', 'abc', 'de_DE', 'isStringLength', [5]);
        assert.equal(msg, 'Should be at least 5 characters');
    });

    it('SUBTRACT: no culture at all renders the English default, %s still interpolating', async function () {
        var msg = await render('i18nrtbundle', 'isString', 'abc', undefined, 'isStringLength', [5]);
        assert.equal(msg, 'Should be at least 5 characters');
    });
});


// 02 — the %-token vocabulary is closed; unknown tokens corrupt the message
describe('02 - unknown %-tokens in a catalog label render the literal "undefined"', function () {

    it('an unknown token (%d) renders as "undefined"', async function () {
        var msg = await render('i18nrtbundle', 'isBoolean', 'xyz', 'fr_FR');
        assert.equal(msg, 'Doit valoir undefined');
    });

    it('a literal percent glued to letters (100%sur) is consumed as a token', async function () {
        var msg = await render('i18nrtbundle', 'isRequired', '', 'fr_FR');
        assert.equal(msg, 'Remise 100undefined le prix');
    });

    it('%l is frontend-only: server-side the field carries no DOM label, so it renders EMPTY', async function () {
        // Distinct from the unknown-token case above: `%l` IS a known token, so the lint
        // stays silent, but `field.label` is '' server-side (it comes from the DOM attribute
        // `data-gina-form-field-label`). A catalog label built around %l therefore degrades
        // quietly on the server path rather than emitting "undefined".
        var msg = await render('i18nrtbundle', 'isInteger', 'notaninteger', 'fr_FR');
        assert.equal(msg, 'Champ  requis');
    });

    it('a non-string catalog label degrades to the English default (it used to throw)', async function () {
        // Until 0.5.14 this threw `TypeError: target.match is not a function` out of
        // replace(), which escapes validate() and takes the whole validation pass with it.
        // The engine now discards the bad label and renders the rule's English default,
        // warning once. The boot lint still fires — it just no longer guards a crash.
        process.gina._i18nCatalogs.i18nrtbad = {
            fr_FR: { _validator: { isRequired: { message: 'Requis' } } }
        };
        var warns = [];
        var original = console.warn;
        console.warn = function () { warns.push(Array.prototype.join.call(arguments, ' ')); };
        var msg = undefined, err = null;
        try { msg = await render('i18nrtbad', 'isRequired', '', 'fr_FR'); }
        catch (e) { err = e; }
        finally { console.warn = original; }

        assert.equal(err, null, 'expected no throw, got ' + err);
        assert.equal(msg, 'Cannot be left empty');
        assert.equal(warns.length, 1, 'expected exactly one degrade warning');
        assert.match(warns[0], /isRequired/);
        assert.match(warns[0], /must be a string/);
    });

    it('the engine scans tokens with /%[a-z]+/gi and looks them up verbatim in local.keys', function () {
        assert.ok(ENGINE_SRC.indexOf('var keys = target.match(/%[a-z]+/gi);') >= 0,
            'expected replace() to scan with the /%[a-z]+/gi token regex');
        assert.ok(ENGINE_SRC.indexOf('fieldObj[local.keys[keys[k]]]') >= 0,
            'expected the verbatim local.keys lookup that yields undefined on an unknown token');
    });
});


// 03 — boot lint over the `_validator` node (lib/i18n loadCatalogs)
describe('03 - loadCatalogs lints the _validator node once at boot', function () {

    it('CONTROL: a clean catalog warns nothing (incl. a percent NOT followed by letters)', function () {
        var r = lintCatalog('lintclean', { greeting: 'Bonjour', _validator: {
            isRequired:        'Ne peut etre vide',
            isStringMinLength: 'Au moins %s caracteres',
            isEmail:           'Le champ %n est invalide',
            discount:          'Remise de 100% sur le prix'
        } });
        assert.deepEqual(r.warns, []);
        assert.deepEqual(r.loaded, ['fr']);
    });

    it('CONTROL: a catalog with no _validator node warns nothing', function () {
        var r = lintCatalog('lintnonode', { greeting: 'Bonjour' });
        assert.deepEqual(r.warns, []);
    });

    it('warns on an unknown token (%d)', function () {
        var r = lintCatalog('lintunknown', { _validator: { isBoolean: 'Doit valoir %d' } });
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /`_validator\.isBoolean`/);
        assert.match(r.warns[0], /unknown placeholder `%d`/);
        assert.match(r.warns[0], /renders as "undefined"/);
    });

    it('warns on a literal percent glued to letters (%sur)', function () {
        var r = lintCatalog('lintglued', { _validator: { isRequired: 'Remise 100%sur le prix' } });
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /unknown placeholder `%sur`/);
    });

    it('warns on an uppercase token (%L) — the engine lookup is case-sensitive', function () {
        var r = lintCatalog('lintupper', { _validator: { isEmail: 'Champ %L invalide' } });
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /unknown placeholder `%L`/);
    });

    it('warns on a non-string label', function () {
        var r = lintCatalog('lintnonstring', { _validator: { isRequired: { message: 'Requis' } } });
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /must be a string/);
    });

    it('warns when _validator is not an object', function () {
        var r = lintCatalog('lintarray', { _validator: ['nope'] });
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /must be an object mapping rule names to labels/);
    });

    it('never throws: an offending catalog still loads', function () {
        var r = lintCatalog('lintstillloads', { _validator: { isBoolean: 'Doit valoir %d' } });
        assert.deepEqual(r.loaded, ['fr'], 'a label typo must not take the bundle down');
    });

    it('source: the lint runs before the catalog is stored, inside loadCatalogs', function () {
        var lintIdx  = I18N_SRC.indexOf('warnOnSuspectValidatorLabels(parsed, filePath);');
        var storeIdx = I18N_SRC.indexOf('store[bundleName][culture] = parsed;');
        assert.ok(lintIdx >= 0, 'expected the lint call site');
        assert.ok(storeIdx > lintIdx, 'expected the lint to run before the store assignment');
    });

    it('DRIFT PIN: the lint token set matches local.keys in form-validator.js', function () {
        // Extract `local.keys` from the engine.
        var keysBlock = ENGINE_SRC.slice(ENGINE_SRC.indexOf("'keys': {"));
        keysBlock = keysBlock.slice(0, keysBlock.indexOf('}'));
        var engineTokens = (keysBlock.match(/'(%[a-z]+)'\s*:/g) || [])
            .map(function (m) { return m.replace(/'|\s|:/g, ''); })
            .sort();

        // Extract VALIDATOR_LABEL_TOKENS from lib/i18n.
        var declMatch = I18N_SRC.match(/var VALIDATOR_LABEL_TOKENS = \[([^\]]*)\]/);
        assert.ok(declMatch, 'expected the VALIDATOR_LABEL_TOKENS declaration');
        var lintTokens = (declMatch[1].match(/'(%[a-z]+)'/g) || [])
            .map(function (m) { return m.replace(/'/g, ''); })
            .sort();

        assert.deepEqual(lintTokens, engineTokens,
            'lib/i18n VALIDATOR_LABEL_TOKENS drifted from form-validator.js local.keys — '
            + 'the lint would now warn on a token the engine substitutes, or stay silent on one it does not');
        assert.deepEqual(engineTokens, ['%l', '%n', '%s']);
    });

    it('DRIFT PIN: the lint scans with the same token regex as the engine', function () {
        assert.ok(I18N_SRC.indexOf('var VALIDATOR_TOKEN_RE = /%[a-z]+/gi;') >= 0,
            'expected the lint regex to mirror the engine replace() regex');
    });
});


// 04 — labels are late-bound: the overlay is re-evaluated on every validation pass
describe('04 - label sources are re-read per engine construction (late binding)', function () {

    it('real engine: mutating the catalog between two constructions changes the label', async function () {
        process.gina._i18nCatalogs.i18nrtlate = {
            fr_FR: { _validator: { isRequired: 'AVANT' } }
        };
        var before = await render('i18nrtlate', 'isRequired', '', 'fr_FR');
        assert.equal(before, 'AVANT');

        // Stand-in for a late `setErrorLabels()` write: the label SOURCE changed after the
        // first construction. A constructor that cached its labels would still say AVANT.
        process.gina._i18nCatalogs.i18nrtlate.fr_FR._validator.isRequired = 'APRES';

        var after = await render('i18nrtlate', 'isRequired', '', 'fr_FR');
        assert.equal(after, 'APRES', 'the overlay must re-read its source on each construction');
    });

    it('source: the overlay lives inside the FormValidatorUtil constructor, not at module scope', function () {
        var ctorIdx     = ENGINE_SRC.indexOf('function FormValidatorUtil(data, $fields, xhrOptions, fieldsSet, culture) {');
        var registryIdx = ENGINE_SRC.indexOf('gina.validator._errorLabelsByCulture');
        var exportsIdx  = ENGINE_SRC.indexOf('module.exports  = FormValidatorUtil');
        assert.ok(ctorIdx >= 0 && registryIdx > ctorIdx && exportsIdx > registryIdx,
            'expected the setErrorLabels registry read to sit inside the constructor body');
    });

    it('source: the client engine is constructed inside validate(), i.e. per validation pass', function () {
        var validateIdx = MAIN_SRC.indexOf('var validate = function($formOrElement, fields, $fields, rules, cb, culture) {');
        assert.ok(validateIdx >= 0, 'expected the validate() declaration');
        var ctorIdx = MAIN_SRC.indexOf('d = new FormValidator(fields, $fields, xhrOptions);', validateIdx);
        assert.ok(ctorIdx > validateIdx,
            'expected validate() to construct a fresh FormValidator (so labels are re-read each pass)');
    });

    it('source: `ready` fires after gina.validator is published, so a ready handler can register labels', function () {
        var publishIdx = MAIN_SRC.indexOf('gina.validator = instance;');
        var readyIdx   = MAIN_SRC.indexOf("triggerEvent(gina, instance.target, 'ready.' + instance.id, instance);", publishIdx);
        assert.ok(publishIdx >= 0, 'expected gina.validator to be published');
        assert.ok(readyIdx > publishIdx,
            'expected ready to fire after the singleton is published — a ready handler calling '
            + 'gina.validator.setErrorLabels() lands before the first validate() builds an engine');
    });
});
