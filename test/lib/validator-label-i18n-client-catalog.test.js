/**
 * validator-label-i18n-client-catalog — CLIENT built-in rule labels from the bundle
 * catalog, and their precedence vs app setErrorLabels() overrides (Slice 3).
 *
 * Slice 2 localized the SERVER FormValidator labels from bundle/locales/<culture>.json
 * (the `_validator.<rule>` namespace). Slice 3 delivers the SAME catalog to the browser,
 * so the CLIENT validator overlays localized labels WITHOUT the app calling
 * gina.validator.setErrorLabels():
 *   - controller.js resolves the negotiated req.culture's `_validator` subset
 *     (walkFallback -> getCatalog -> resolveKey('_validator'), mirroring the server
 *     overlay) and whispers it, encoded, as page.environment.validatorLabels;
 *   - loader.js reads it into gina.config.validatorLabels (guarded JSON.parse,
 *     @js_externs against Closure renaming);
 *   - form-validator.js's client overlay applies it as the MIDDLE layer, with precedence
 *     app setErrorLabels() > server catalog > English defaults. Each layer is a
 *     target-wins/source-fills merge over the running local.errorLabels, so a higher
 *     layer wins per key and lower layers fill gaps.
 *
 * The overlay is browser-only (isGFFCtx is false under node when module.exports exists),
 * so — like the companion CLIENT file (validator-label-i18n.test.js) — this combines
 * (a) source-structure pins across the 3 touched files, (b) a behavioural check of the
 * controller resolver against the REAL lib/i18n primitives (seed a catalog -> the
 * whispered subset; subtracts for fallback / no-catalog / non-string culture), (c) a
 * pure-logic replica of the 3-layer precedence driven by the REAL lib/merge + JSON.clone
 * (with subtracts), and (d) a built-dist guard.
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

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var CTRL_PATH   = path.join(FW, 'core/controller/controller.js');
var LOADER_PATH = path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/loader.js');
var DIST_MIN    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
var DIST_RAW    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_ONLOAD = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.onload.min.js');

var ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
var CTRL_SRC   = fs.readFileSync(CTRL_PATH, 'utf8');
var LOADER_SRC = fs.readFileSync(LOADER_PATH, 'utf8');

var i18n  = require(path.join(FW, 'lib/i18n'));
var merge = require(path.join(FW, 'lib/merge'));

// Seed a FR catalog: fr_FR has a partial _validator node, fr has a smaller one, and
// a de entry exists WITHOUT a _validator node (to exercise the walk-past on miss).
var BUNDLE = 'i18ncatbundle';
if (!process.gina) { process.gina = {}; }
process.gina._i18nCatalogs = process.gina._i18nCatalogs || {};
process.gina._i18nCatalogs[BUNDLE] = {
    fr_FR: { _validator: {
        isEmail:    'Un email valide est requis',
        isRequired: 'Ne peut etre vide'
    } },
    fr: { _validator: {
        isRequired: 'Requis (fr)'
    } },
    de_DE: { greeting: 'Hallo' } // present catalog, but no _validator node
};


// 00 — controller.js whisper source pins
describe('00 - controller whisper source pins (controller.js)', function () {

    it('whispers page.environment.validatorLabels encoded beside the culture whisper', function () {
        assert.ok(CTRL_SRC.indexOf("set('page.environment.culture', (req && req.culture) ? req.culture : '');") >= 0,
            'expected the Slice-1 culture whisper still present');
        assert.ok(CTRL_SRC.indexOf("set('page.environment.validatorLabels', encodeRFC5987ValueChars(JSON.stringify(_validatorLabels)));") >= 0,
            'expected the encoded validatorLabels whisper (RFC5987 -> decodeURIComponent on the client)');
    });

    it('resolves via the same chain as the server overlay: walkFallback -> getCatalog -> resolveKey', function () {
        assert.ok(CTRL_SRC.indexOf('lib.i18n.walkFallback(req.culture)') >= 0,
            'expected the culture fallback chain');
        assert.ok(CTRL_SRC.indexOf("lib.i18n.getCatalog(options.conf.bundle, _vlChain[_vli])") >= 0,
            'expected per-step catalog lookup keyed on the render bundle');
        assert.ok(CTRL_SRC.indexOf("lib.i18n.resolveKey(_vlCat, '_validator')") >= 0,
            'expected the _validator node existence-guarded via resolveKey (never t())');
    });

    it('defaults to {} and only resolves for a non-empty string culture', function () {
        assert.ok(CTRL_SRC.indexOf('var _validatorLabels = {};') >= 0,
            'expected the empty-object default (whispered when i18n inactive / no node)');
        assert.ok(CTRL_SRC.indexOf("typeof(req.culture) === 'string' && req.culture && lib.i18n") >= 0,
            'expected the string-culture + i18n-present guard');
    });
});


// 01 — loader.js client-read source pins
describe('01 - loader read source pins (loader.js)', function () {

    it('reads validatorLabels into gina.config, externed against Closure renaming', function () {
        assert.ok(LOADER_SRC.indexOf('@js_externs validatorLabels') >= 0,
            'expected the @js_externs annotation (mirrors culture / routing config keys)');
        assert.ok(LOADER_SRC.indexOf("'validatorLabels':") >= 0,
            'expected the validatorLabels config field');
        assert.ok(LOADER_SRC.indexOf("JSON.parse(decodeURIComponent('{{ page.environment.validatorLabels }}'))") >= 0,
            'expected the encoded-JSON read (mirrors the routing config blob)');
    });

    it('guards the parse so an empty/absent whisper degrades to {} (not a dead onGinaLoaded)', function () {
        // A bare JSON.parse('') would throw and kill onGinaLoaded (whole-page JS dead);
        // the try/catch returns {} instead. Diverges from routing's bare parse on purpose
        // (routing is required; validatorLabels is optional).
        assert.match(LOADER_SRC, /'validatorLabels':\s*\(function \(\) \{ try \{ return JSON\.parse[\s\S]*?\} catch \(e\) \{ return \{\}; \} \}\)\(\)/,
            'expected the guarded IIFE returning {} on a parse failure');
    });
});


// 02 — form-validator.js client overlay source pins
describe('02 - client overlay source pins (form-validator.js)', function () {

    it('reads the whispered catalog from gina.config.validatorLabels, isGFFCtx-gated', function () {
        assert.ok(ENGINE_SRC.indexOf('gina.config.validatorLabels') >= 0,
            'expected the catalog read');
        // the CODE read `if ( gina.config.validatorLabels && ...` (not the doc comment)
        // sits inside the isGFFCtx overlay block: its nearest preceding isGFFCtx is the
        // overlay gate opener `if (`. Structural anchor, not a char-distance (jsdoc.md).
        var catIdx = ENGINE_SRC.indexOf('if ( gina.config.validatorLabels');
        assert.ok(catIdx >= 0, 'expected the catalog read guard in the engine');
        var gffIdx = ENGINE_SRC.lastIndexOf('isGFFCtx', catIdx);
        assert.match(ENGINE_SRC.slice(Math.max(0, gffIdx - 30), gffIdx), /if \(\s*$/,
            'expected the catalog read gated by the isGFFCtx overlay opener (client only)');
    });

    it('applies catalog BELOW setErrorLabels (both merge over the running local.errorLabels)', function () {
        var catIdx = ENGINE_SRC.indexOf('merge(JSON.clone(_catalogLabels), local.errorLabels)');
        var regIdx = ENGINE_SRC.indexOf('merge(JSON.clone(_cultureLabels), local.errorLabels)');
        assert.ok(catIdx >= 0, 'expected the catalog-layer merge over local.errorLabels');
        assert.ok(regIdx >= 0, 'expected the registry-layer merge over local.errorLabels');
        assert.ok(catIdx < regIdx,
            'expected the catalog layer applied FIRST, then the setErrorLabels layer on top ' +
            '(so setErrorLabels > catalog > English)');
    });

    it('skips an empty catalog object (own-key guard) so it degrades to registry/English', function () {
        assert.ok(ENGINE_SRC.indexOf('for (var _clk in gina.config.validatorLabels)') >= 0,
            'expected the own-key emptiness guard (empty {} -> no clone, English/registry kept)');
        assert.ok(ENGINE_SRC.indexOf('gina.config.validatorLabels.hasOwnProperty(_clk)') >= 0,
            'expected the hasOwnProperty own-key check');
    });
});


// 03 — controller resolver behaviour (REAL lib/i18n primitives + a seeded catalog)
describe('03 - controller resolver behaviour (real lib/i18n)', function () {

    // faithful mirror of the controller.js resolver (walkFallback -> getCatalog ->
    // resolveKey('_validator'), first present object node wins), driven by the REAL i18n.
    function resolveWhisper(bundle, culture) {
        if (!(typeof culture === 'string' && culture)) { return {}; }
        var chain = i18n.walkFallback(culture);
        for (var i = 0; i < chain.length; i++) {
            var cat = i18n.getCatalog(bundle, chain[i]);
            if (cat) {
                var node = i18n.resolveKey(cat, '_validator');
                if (node && typeof node === 'object') { return node; }
            }
        }
        return {};
    }

    it('GUARD: lib/i18n exports the three resolver primitives', function () {
        assert.equal(typeof i18n.walkFallback, 'function');
        assert.equal(typeof i18n.getCatalog, 'function');
        assert.equal(typeof i18n.resolveKey, 'function');
    });

    it('exact culture resolves its _validator subset (present keys only)', function () {
        var out = resolveWhisper(BUNDLE, 'fr_FR');
        assert.deepEqual(out, { isEmail: 'Un email valide est requis', isRequired: 'Ne peut etre vide' });
    });

    it('falls back to the base language when the exact culture lacks the node', function () {
        // fr_CA has no catalog; walkFallback -> [fr_CA, fr, en] -> fr._validator
        assert.deepEqual(resolveWhisper(BUNDLE, 'fr_CA'), { isRequired: 'Requis (fr)' });
    });

    it('walks past a present catalog that lacks a _validator node', function () {
        // de_DE catalog exists but has no _validator; chain -> [de_DE, de, en] -> none -> {}
        assert.deepEqual(resolveWhisper(BUNDLE, 'de_DE'), {});
    });

    it('no catalog for the culture -> {} (English is filled client-side)', function () {
        assert.deepEqual(resolveWhisper(BUNDLE, 'es_ES'), {});
    });

    it('non-string / empty culture -> {} (the controller guard)', function () {
        assert.deepEqual(resolveWhisper(BUNDLE, ''), {});
        assert.deepEqual(resolveWhisper(BUNDLE, null), {});
        assert.deepEqual(resolveWhisper(BUNDLE, undefined), {});
    });

    it('only present keys are whispered (English NOT merged in server-side — payload stays small)', function () {
        var out = resolveWhisper(BUNDLE, 'fr_FR');
        assert.equal(typeof out.isEmail, 'string');
        assert.equal(typeof out.isNumber, 'undefined'); // an unlocalized rule is absent, not English-filled
    });
});


// 04 — client overlay precedence (pure-logic replica, REAL merge + JSON.clone)
describe('04 - client overlay precedence (replica)', function () {

    var ENGLISH = {
        isRequired: 'Cannot be left empty',
        isEmail   : 'A valid email is required',
        isInteger : 'Must be an integer'
    };

    // faithful mirror of the form-validator.js client overlay: catalog applied first,
    // then setErrorLabels, each a target-wins/source-fills merge over the running labels.
    function overlay(english, catalog, registryEntry) {
        var labels = english;
        var _catalogLabels = null;
        if (catalog && typeof catalog === 'object') {
            for (var k in catalog) { if (catalog.hasOwnProperty(k)) { _catalogLabels = catalog; break; } }
        }
        var _cultureLabels = registryEntry || null;
        if (_catalogLabels) { labels = merge(JSON.clone(_catalogLabels), labels); }
        if (_cultureLabels) { labels = merge(JSON.clone(_cultureLabels), labels); }
        return labels;
    }

    it('GUARD: real lib/merge is target-wins + source-fills', function () {
        assert.deepEqual(merge({ a: 1 }, { a: 9, b: 2 }), { a: 1, b: 2 });
    });

    it('all three layers: setErrorLabels > catalog > English', function () {
        var out = overlay(ENGLISH,
            { isRequired: 'CATALOG requis', isEmail: 'CATALOG email' },
            { isRequired: 'REGISTRY requis' });
        assert.equal(out.isRequired, 'REGISTRY requis');          // setErrorLabels wins
        assert.equal(out.isEmail, 'CATALOG email');               // catalog wins where no override
        assert.equal(out.isInteger, 'Must be an integer');        // English fills the rest
    });

    it('catalog only (no setErrorLabels) -> catalog over English', function () {
        var out = overlay(ENGLISH, { isRequired: 'CATALOG requis' }, null);
        assert.equal(out.isRequired, 'CATALOG requis');
        assert.equal(out.isEmail, 'A valid email is required');
    });

    it('setErrorLabels only (empty catalog) -> registry over English (old behaviour preserved)', function () {
        var out = overlay(ENGLISH, {}, { isRequired: 'REGISTRY requis' });
        assert.equal(out.isRequired, 'REGISTRY requis');
        assert.equal(out.isEmail, 'A valid email is required');
    });

    it('empty catalog + no registry -> English reference untouched (no allocation)', function () {
        assert.equal(overlay(ENGLISH, {}, null), ENGLISH); // same reference
    });

    it('does not mutate English defaults, the catalog, or the registry entry', function () {
        var cat = { isRequired: 'CATALOG' };
        var reg = { isRequired: 'REGISTRY' };
        overlay(ENGLISH, cat, reg);
        assert.equal(ENGLISH.isRequired, 'Cannot be left empty'); // English pristine
        assert.deepEqual(cat, { isRequired: 'CATALOG' });         // catalog pristine
        assert.deepEqual(reg, { isRequired: 'REGISTRY' });        // registry pristine
    });

    it('SUBTRACT: without the catalog layer, a catalog-only culture reverts to English', function () {
        // remove ONLY the catalog merge; setErrorLabels + English remain
        function overlayNoCatalog(english, catalog, registryEntry) {
            var labels = english;
            var _cultureLabels = registryEntry || null;
            if (_cultureLabels) { labels = merge(JSON.clone(_cultureLabels), labels); }
            return labels;
        }
        var cat = { isRequired: 'CATALOG requis' };
        assert.equal(overlay(ENGLISH, cat, null).isRequired, 'CATALOG requis');          // with catalog layer -> localized
        assert.equal(overlayNoCatalog(ENGLISH, cat, null).isRequired, 'Cannot be left empty'); // without -> English (the gap Slice 3 closes)
    });
});


// 05 — built dist carries the whisper + client read
describe('05 - built dist carries the feature', function () {

    var MIN    = fs.readFileSync(DIST_MIN, 'utf8');
    var RAW    = fs.readFileSync(DIST_RAW, 'utf8');
    var ONLOAD = fs.readFileSync(DIST_ONLOAD, 'utf8');

    it('gina.onload.min.js carries the validatorLabels whisper token', function () {
        assert.ok(ONLOAD.indexOf('page.environment.validatorLabels') >= 0,
            'expected the loader.js whisper survived the onload build');
    });

    it('gina.min.js preserves the validatorLabels property (Closure did not rename it)', function () {
        assert.ok(MIN.indexOf('validatorLabels') >= 0,
            'expected the @js_externs-protected property in the main bundle');
    });

    it('gina.js (un-minified) carries the catalog-overlay symbol', function () {
        assert.ok(RAW.indexOf('_catalogLabels') >= 0,
            'expected the client overlay catalog layer in the un-minified bundle');
    });
});
