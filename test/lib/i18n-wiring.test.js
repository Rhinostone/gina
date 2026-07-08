/**
 * lib/i18n — Framework wiring guards (#I18N1, slice 1)
 *
 * Source-inspection tests that pin the per-file integration of `lib/i18n`
 * into the framework:
 *
 *   - `lib/index.js` registers `i18n` via `_require`.
 *   - `core/gna.js` exposes `gna.t` and forwards to `lib.i18n.t`.
 *   - `core/gna.js` keeps `gna.__` for back-compat.
 *   - `helpers/text.js` rewires `__()` as a guarded one-arg alias of
 *     `lib.i18n.t`, with the broken `__.prototype.split` removed.
 *   - `core/controller/controller.js` declares `this.t = function(...)`,
 *     reads bundleName from `local.options.conf.bundle`, and reads culture
 *     from `local.req.culture` (the slice 3 hook).
 *   - `core/template/conf/settings.json` carries the `i18n.*` block with
 *     the documented defaults.
 *   - The bundle scaffold ships a starter `bundle/locales/en.json`.
 *   - `schema/locales.json` publishes a Draft-07 schema with the
 *     value-or-pluralForm shape.
 *
 * Pure source-grep — does not exercise the runtime. Behavioural coverage
 * lives in the sibling `i18n.test.js`.
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var GNA_SRC      = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
var TEXT_SRC     = fs.readFileSync(path.join(FW, 'helpers/text.js'), 'utf8');
var LIB_INDEX    = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var CTRL_SRC     = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var SETTINGS_SRC = fs.readFileSync(path.join(FW, 'core/template/conf/settings.json'), 'utf8');
var SCAFFOLD_PATH = path.join(FW, 'core/template/boilerplate/bundle/locales/en.json');
var SCHEMA_PATH   = path.resolve(FW, '..', '..', 'schema/locales.json');


describe('01 - lib/index.js registration', function() {

    it('registers i18n via _require', function() {
        assert.match(LIB_INDEX, /i18n\s*:\s*_require\(['"]\.\/i18n['"]\)/);
    });

});


describe('02 - core/gna.js — gna.t exposure', function() {

    it('exposes gna.t', function() {
        assert.match(GNA_SRC, /gna\.t\s*=\s*function/);
    });

    it('gna.t calls lib.i18n.t', function() {
        assert.match(GNA_SRC, /lib\.i18n\.t\s*\(/);
    });

    it('still exposes gna.__ for back-compat', function() {
        assert.match(GNA_SRC, /gna\.__\s*=\s*__\s*;/);
    });

});


describe('03 - helpers/text.js — __() rewire', function() {

    it('__() function defers to lib.i18n.t', function() {
        assert.match(TEXT_SRC, /lib\.i18n\.t\s*\(\s*str\s*\)/);
    });

    it('__() guards against unloaded lib', function() {
        assert.match(TEXT_SRC, /typeof\s+lib\s*===\s*['"]undefined['"]/);
    });

    it('no longer carries the broken __.prototype.split', function() {
        assert.equal(/\b__\.prototype\.split\b/.test(TEXT_SRC), false);
    });

});


describe('04 - controller.js — self.t() helper', function() {

    it('declares this.t = function(key, params, culture)', function() {
        assert.match(CTRL_SRC, /this\.t\s*=\s*function\s*\(\s*key\s*,\s*params\s*,\s*culture\s*\)/);
    });

    it('reads bundleName from local.options.conf.bundle', function() {
        // The exact slot — guards against accidental refactors that move
        // bundle off `local.options.conf`.
        assert.match(CTRL_SRC, /local\.options\.conf\.bundle/);
    });

    it('reads culture from local.req.culture (slice 3 hook)', function() {
        assert.match(CTRL_SRC, /local\.req\s*&&\s*local\.req\.culture/);
    });

    it('forwards to lib.i18n.t with key/params/culture/options', function() {
        assert.match(CTRL_SRC, /lib\.i18n\.t\s*\(\s*key\s*,\s*params\s*,\s*culture/);
    });

});


describe('05 - settings.json template — i18n.* block', function() {

    // settings.json uses //-style comments — JSON.parse won't accept it
    // even after a naive strip (URLs inside strings collide with the
    // comment regex). Source-grep the raw file instead, mirroring the
    // pattern used by other CN10 / CSRF audits.

    it('declares the i18n object', function() {
        assert.match(SETTINGS_SRC, /"i18n"\s*:\s*\{/);
    });

    it('seeds cookieName = "gina_culture"', function() {
        assert.match(SETTINGS_SRC, /"cookieName"\s*:\s*"gina_culture"/);
    });

    it('seeds devMissingKey = "[MISSING]"', function() {
        assert.match(SETTINGS_SRC, /"devMissingKey"\s*:\s*"\[MISSING\]"/);
    });

    it('defaults fallbackChain = null', function() {
        assert.match(SETTINGS_SRC, /"fallbackChain"\s*:\s*null/);
    });

    it('defaults cultures = null', function() {
        assert.match(SETTINGS_SRC, /"cultures"\s*:\s*null/);
    });

});


describe('06 - bundle scaffold — locales/en.json stub', function() {

    it('ships a stub catalog at the expected path', function() {
        assert.ok(fs.existsSync(SCAFFOLD_PATH), 'expected scaffold stub at ' + SCAFFOLD_PATH);
    });

    it('the stub has a `common` namespace', function() {
        var parsed = JSON.parse(fs.readFileSync(SCAFFOLD_PATH, 'utf8'));
        assert.ok(parsed.common);
        assert.equal(typeof parsed.common.welcome, 'string');
    });

    it('the stub demonstrates {name}-style interpolation', function() {
        var parsed = JSON.parse(fs.readFileSync(SCAFFOLD_PATH, 'utf8'));
        assert.match(parsed.common.greeting, /\{name\}/);
    });

});


describe('07 - schema/locales.json — published JSON Schema', function() {

    it('exists at schema/locales.json (repo root)', function() {
        assert.ok(fs.existsSync(SCHEMA_PATH), 'expected schema at ' + SCHEMA_PATH);
    });

    it('declares the published $id and Draft-07 $schema', function() {
        var parsed = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
        assert.equal(parsed.$id,     'https://gina.io/schema/locales.json');
        assert.equal(parsed.$schema, 'https://json-schema.org/draft-07/schema#');
    });

    it('declares the value-or-pluralForm $defs', function() {
        var parsed = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
        assert.ok(parsed.$defs);
        assert.ok(parsed.$defs.value);
        assert.ok(parsed.$defs.pluralForm);
    });

    it('marks `other` as required on every plural form', function() {
        var parsed = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
        assert.deepEqual(parsed.$defs.pluralForm.required, ['other']);
    });

});


describe('08 - core/config.js — i18n catalog activation (#I18N Slice 1)', function() {

    var CONFIG_SRC = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');

    it('binds lib.i18n like lib.secrets', function() {
        assert.match(CONFIG_SRC, /var i18n\s*=\s*lib\.i18n/);
    });

    it('eager-loads the bundle catalogs at loadBundleConfig time', function() {
        // loadCatalogs(bundle, <bundleRoot>/locales), keyed by the same bundle
        // name core/server.js negotiates availableCultures against.
        assert.match(CONFIG_SRC, /i18n\.loadCatalogs\(\s*bundle\s*,/);
        assert.match(CONFIG_SRC, /appPath\s*\+\s*['"]\/locales['"]/);
    });

    it('guards a missing locales/ dir (opt-in) and never fails boot on a bad catalog', function() {
        // existsSync skips non-i18n bundles (avoids the empty _i18nCatalogs entry
        // + the background ICU loader); the try/catch turns a malformed catalog
        // (loadCatalogs throws) into a console.warn rather than a boot abort.
        assert.match(CONFIG_SRC, /fs\.existsSync\(\s*_localesDir\s*\)/);
        assert.match(CONFIG_SRC, /catch\s*\(\s*i18nErr\s*\)[\s\S]{1,200}console\.warn/);
    });

});
