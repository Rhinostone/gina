/**
 * validator-label-i18n — client-side per-culture built-in rule labels.
 *
 * gina's 24 built-in FormValidator rule labels are English by default. This feature
 * lets an app localize them WITHOUT gina shipping translations, matching gina's
 * "app owns catalogs" i18n stance (bundle/locales + self.t()):
 *   - the request's negotiated `req.culture` is whispered to the browser as
 *     `gina.config.culture` (controller.js + utils/loader.js);
 *   - the app registers per-culture overrides via `gina.validator.setErrorLabels()`
 *     (main.js), stored on `gina.validator._errorLabelsByCulture`;
 *   - the engine (form-validator.js) seeds `local.errorLabels` from that registry
 *     merged over the English defaults (app label wins per key, English fills gaps),
 *     with a culture -> base-language -> English fallback.
 *
 * The overlay is browser-only (`isGFFCtx`); the server path stays English verbatim.
 * A per-field/rule `error` string still wins; custom user-defined rules are untouched.
 *
 * Test shape: the client seed can't be driven under node (`isGFFCtx` is false when
 * `module.exports` exists), so this file combines (a) a behavioural no-regression
 * check on the server path via the REAL engine, (b) source-structure pins across the
 * 4 touched files, and (c) pure-logic replicas of the seed overlay + the
 * setErrorLabels merge driven by the REAL lib/merge + JSON.clone, each with a
 * subtract control, plus a dist-rebuild guard.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0); // engine construction adds logger listeners per instance
require(path.join(FW, 'helpers'));
/* global getContext, setContext, JSON */
if (typeof getContext('gina') === 'undefined') { setContext('gina', {}); }

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var MAIN_PATH   = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var CTRL_PATH   = path.join(FW, 'core/controller/controller.js');
var LOADER_PATH = path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/loader.js');
var DIST_MIN    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
var DIST_RAW    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_ONLOAD = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.onload.min.js');

var ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
var MAIN_SRC   = fs.readFileSync(MAIN_PATH, 'utf8');
var CTRL_SRC   = fs.readFileSync(CTRL_PATH, 'utf8');
var LOADER_SRC = fs.readFileSync(LOADER_PATH, 'utf8');

var FormValidator = require(ENGINE_PATH);
var merge         = require(path.join(FW, 'lib/merge'));

/** Build a one-field validator and return that field object. */
function vf(name, value) {
    var data = {};
    data[name] = value;
    return new FormValidator(data)[name];
}


// 00 — server path: the overlay is browser-only, so server labels stay English
//      AND the rename to _defaultErrorLabels preserved the built-in defaults.
describe('00 - server path keeps English built-in labels (overlay is isGFFCtx-only)', function () {

    it('isRequired on an empty field yields the English default', function () {
        var f = vf('x', '').isRequired();
        assert.equal(f.valid, false);
        assert.equal(f.errors.isRequired, 'Cannot be left empty');
    });

    it('isEmail on a bad address yields the English default', function () {
        var f = vf('e', 'nope').isEmail();
        assert.equal(f.valid, false);
        assert.equal(f.errors.isEmail, 'A valid email is required');
    });
});


// 01 — engine seed (form-validator.js) source pins
describe('01 - engine seed source pins', function () {

    it('keeps the English catalog as _defaultErrorLabels and defaults to it', function () {
        assert.ok(ENGINE_SRC.indexOf('var _defaultErrorLabels = {') >= 0,
            'expected the renamed English default catalog');
        assert.ok(ENGINE_SRC.indexOf("'isRequired': 'Cannot be left empty'") >= 0,
            'expected the English isRequired default preserved');
        assert.ok(ENGINE_SRC.indexOf('local.errorLabels = _defaultErrorLabels;') >= 0,
            'expected English to be the default seed');
    });

    it('overlays a per-culture registry ONLY in the browser (isGFFCtx-gated)', function () {
        var overlayIdx = ENGINE_SRC.indexOf('gina.validator._errorLabelsByCulture');
        assert.ok(overlayIdx >= 0, 'expected the registry read in the engine');
        var gffIdx = ENGINE_SRC.lastIndexOf('isGFFCtx', overlayIdx);
        assert.ok(gffIdx >= 0 && (overlayIdx - gffIdx) < 300,
            'expected the overlay to be gated on isGFFCtx');
        assert.ok(ENGINE_SRC.indexOf('gina.config.culture') >= 0,
            'expected the culture read from gina.config');
    });

    it('resolves culture -> base language -> English, app label wins via merge', function () {
        assert.ok(ENGINE_SRC.indexOf("_culture.substr(0, _culture.indexOf('_'))") >= 0,
            'expected the base-language derivation');
        assert.ok(ENGINE_SRC.indexOf('gina.validator._errorLabelsByCulture[_culture]') >= 0,
            'expected the exact-culture lookup');
        assert.ok(ENGINE_SRC.indexOf('gina.validator._errorLabelsByCulture[_baseLang]') >= 0,
            'expected the base-language fallback');
        assert.ok(ENGINE_SRC.indexOf('merge(JSON.clone(_cultureLabels), _defaultErrorLabels)') >= 0,
            'expected app-labels-win merge direction (culture clone as target, English as source)');
    });
});


// 02 — public API (main.js) source pins
describe('02 - public API source pins', function () {

    it('declares setErrorLabels + the registry (quoted) on the instance', function () {
        assert.ok(MAIN_SRC.indexOf("'setErrorLabels'    : null,") >= 0,
            'expected the quoted setErrorLabels literal (Closure-safe)');
        assert.ok(MAIN_SRC.indexOf("'_errorLabelsByCulture' : {}") >= 0,
            'expected the quoted registry literal (Closure-safe, mirrors $forms)');
    });

    it('defines setErrorLabels and binds it in setupInstanceProto', function () {
        assert.ok(MAIN_SRC.indexOf('var setErrorLabels = function (labels, culture) {') >= 0,
            'expected the setter definition');
        assert.ok(MAIN_SRC.indexOf('instance.setErrorLabels         = setErrorLabels;') >= 0,
            'expected the setter bound on the public instance');
    });

    it('defaults to gina.config.culture and merges app labels over any prior', function () {
        assert.ok(MAIN_SRC.indexOf("gina.config.culture") >= 0,
            'expected the config-culture default');
        assert.ok(MAIN_SRC.indexOf('instance._errorLabelsByCulture[culture] = merge(') >= 0,
            'expected the per-culture registry merge');
        assert.ok(MAIN_SRC.indexOf('JSON.clone(labels)') >= 0,
            'expected the caller object to be cloned (no mutation)');
    });
});


// 03 — culture whisper (controller.js) + client read (loader.js) source pins
describe('03 - culture whisper + client read source pins', function () {

    it('controller whispers req.culture to page.environment.culture', function () {
        assert.ok(CTRL_SRC.indexOf("set('page.environment.culture', (req && req.culture) ? req.culture : '');") >= 0,
            'expected the culture whisper beside the other page.environment sets');
    });

    it('loader reads it into gina.config.culture, externed against Closure renaming', function () {
        assert.ok(LOADER_SRC.indexOf('@js_externs culture') >= 0,
            'expected the @js_externs annotation (mirrors __ginaWebroot / other config keys)');
        assert.ok(LOADER_SRC.indexOf("'culture' : '{{ page.environment.culture }}'") >= 0,
            'expected the culture whisper token read into the config options');
    });
});


// 04 — seed overlay behaviour (pure-logic replica, REAL merge + JSON.clone)
describe('04 - seed overlay behaviour (replica)', function () {

    // faithful mirror of the form-validator.js overlay
    function seed(culture, registry) {
        var english = {
            isRequired: 'Cannot be left empty',
            isEmail   : 'A valid email is required',
            isInteger : 'Must be an integer'
        };
        var labels = english;
        if (culture && registry) {
            var base   = (culture.indexOf('_') > 0) ? culture.substr(0, culture.indexOf('_')) : culture;
            var picked = registry[culture] || (base ? registry[base] : null) || null;
            if (picked) { labels = merge(JSON.clone(picked), english); }
        }
        return labels;
    }

    it('GUARD: real lib/merge is target-wins + source-fills (the overlay direction)', function () {
        assert.deepEqual(merge({ a: 1 }, { a: 9, b: 2 }), { a: 1, b: 2 });
    });

    it('exact culture override wins per key, English fills the rest', function () {
        var out = seed('fr_FR', { fr_FR: { isRequired: 'Ce champ est requis' } });
        assert.equal(out.isRequired, 'Ce champ est requis'); // app wins
        assert.equal(out.isEmail, 'A valid email is required'); // English fill
    });

    it('falls back to base language when the exact culture is absent', function () {
        assert.equal(seed('fr_FR', { fr: { isRequired: 'Requis' } }).isRequired, 'Requis');
    });

    it('exact culture beats base language', function () {
        var out = seed('fr_FR', { fr: { isRequired: 'base' }, fr_FR: { isRequired: 'exact' } });
        assert.equal(out.isRequired, 'exact');
    });

    it('no registration for the culture -> English defaults', function () {
        assert.equal(seed('de_DE', { fr: { isRequired: 'x' } }).isRequired, 'Cannot be left empty');
    });

    it('empty culture / no registry -> English defaults', function () {
        assert.equal(seed('', null).isRequired, 'Cannot be left empty');
        assert.equal(seed('fr_FR', null).isRequired, 'Cannot be left empty');
    });

    it('does not mutate the registry entry (JSON.clone before merge)', function () {
        var reg = { fr_FR: { isRequired: 'Requis' } };
        seed('fr_FR', reg);
        assert.deepEqual(reg.fr_FR, { isRequired: 'Requis' }); // no English keys leaked in
    });

    it('SUBTRACT: without the overlay, a French bundle reverts to English', function () {
        var reg = { fr_FR: { isRequired: 'Ce champ est requis' } };
        function seedPreFix() { return { isRequired: 'Cannot be left empty' }; } // overlay removed
        assert.equal(seed('fr_FR', reg).isRequired, 'Ce champ est requis'); // with overlay -> French
        assert.equal(seedPreFix().isRequired, 'Cannot be left empty');        // without -> English (the bug)
    });
});


// 05 — setErrorLabels registry merge (pure-logic replica, REAL merge + JSON.clone)
describe('05 - setErrorLabels registry merge (replica)', function () {

    // faithful mirror of the main.js setErrorLabels
    function makeSetter(configCulture) {
        var reg = {};
        var setErrorLabels = function (labels, culture) {
            if (!labels || typeof labels != 'object') { return reg; }
            if (!culture) { culture = configCulture || 'en'; }
            reg[culture] = merge(JSON.clone(labels), reg[culture] || {});
            return reg;
        };
        return setErrorLabels;
    }

    it('registers under gina.config.culture when no culture arg is given', function () {
        var reg = makeSetter('fr_FR')({ isRequired: 'Requis' });
        assert.equal(reg.fr_FR.isRequired, 'Requis');
    });

    it('an explicit culture arg overrides the config culture', function () {
        var reg = makeSetter('fr_FR')({ isRequired: 'Erforderlich' }, 'de_DE');
        assert.equal(reg.de_DE.isRequired, 'Erforderlich');
        assert.equal(typeof reg.fr_FR, 'undefined');
    });

    it('accumulates across calls; latest value wins per key, prior fills gaps', function () {
        var set = makeSetter('fr_FR');
        set({ isRequired: 'v1', isEmail: 'Email v1' });
        var reg = set({ isRequired: 'v2' }); // same culture
        assert.equal(reg.fr_FR.isRequired, 'v2');    // latest wins
        assert.equal(reg.fr_FR.isEmail, 'Email v1'); // prior preserved
    });

    it('a non-object labels arg is a no-op', function () {
        var set = makeSetter('fr_FR');
        assert.deepEqual(set(null), {});
        assert.deepEqual(set('nope'), {});
    });

    it('does not mutate the caller-supplied labels object', function () {
        var mine = { isRequired: 'Requis' };
        makeSetter('fr_FR')(mine);
        assert.deepEqual(mine, { isRequired: 'Requis' }); // untouched
    });
});


// 06 — built dist carries the feature (rebuild guard)
describe('06 - built dist carries the feature', function () {

    var MIN    = fs.readFileSync(DIST_MIN, 'utf8');
    var RAW    = fs.readFileSync(DIST_RAW, 'utf8');
    var ONLOAD = fs.readFileSync(DIST_ONLOAD, 'utf8');

    it('gina.min.js preserves the cross-module property names (Closure did not rename them)', function () {
        assert.ok(MIN.indexOf('_errorLabelsByCulture') >= 0);
        assert.ok(MIN.indexOf('gina.config.culture') >= 0);
        assert.ok(MIN.indexOf('setErrorLabels') >= 0);
    });

    it('gina.js (un-minified) carries the feature symbols', function () {
        assert.ok(RAW.indexOf('_defaultErrorLabels') >= 0);
        assert.ok(RAW.indexOf('setErrorLabels') >= 0);
    });

    it('gina.onload.min.js carries the culture whisper token', function () {
        assert.ok(ONLOAD.indexOf('page.environment.culture') >= 0);
    });
});
