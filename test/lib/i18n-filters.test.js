/**
 * lib/swig-filters + lib/nunjucks-filters — `t` filter (#I18N1 slice 2)
 *
 * Source-inspection guards on the per-engine `t` filter wiring. The filter
 * factories reference gina globals (`_`, `GINA_FRAMEWORK_DIR`, `JSON.clone`,
 * `merge`, `routing`, `i18n`) that are only set up by `gna.js` at real
 * bundle boot — exercising the factory end-to-end requires a live bundle,
 * so these guards lock the structural shape and let the runtime tests in
 * `i18n.test.js` cover translation behaviour.
 *
 * What this file pins:
 *   (a) Both factories require `lib/i18n` via the same idiom they use
 *       for `lib/merge` and `lib/routing`.
 *   (b) Both factories declare `self.t = function(key, params)`.
 *   (c) Both `t` filters resolve culture via `(ctx.req && ctx.req.culture)`
 *       with a fallback to `getEnvVar('GINA_CULTURE')`.
 *   (d) Both `t` filters resolve bundleName via `ctx.options.conf.bundle`.
 *   (e) Both `t` filters forward to `i18n.t(key, params, culture, {bundleName})`.
 *   (f) Surface parity — every assertion that holds for swig also holds for
 *       nunjucks, so templates port between engines without behaviour drift.
 *   (g) Negative invariants — neither factory duplicates fallback / plural /
 *       interpolation logic locally; the `t` filter is a thin pass-through.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW     = require('../fw');
var SF_SRC = fs.readFileSync(path.join(FW, 'lib/swig-filters/src/main.js'), 'utf8');
var NF_SRC = fs.readFileSync(path.join(FW, 'lib/nunjucks-filters/src/main.js'), 'utf8');


// ─── 01 — i18n require wired into both factories ──────────────────────────

describe('01 - lib/i18n require in filter factories', function() {

    it('swig-filters requires lib/i18n via the GINA_FRAMEWORK_DIR idiom', function() {
        assert.match(SF_SRC, /require\(\s*_\(\s*GINA_FRAMEWORK_DIR\s*\+\s*["']\/lib\/i18n["']\s*,\s*true\s*\)\s*\)/);
    });

    it('nunjucks-filters requires lib/i18n via the GINA_FRAMEWORK_DIR idiom', function() {
        assert.match(NF_SRC, /require\(\s*_\(\s*GINA_FRAMEWORK_DIR\s*\+\s*["']\/lib\/i18n["']\s*,\s*true\s*\)\s*\)/);
    });

    it('swig-filters guards the i18n require behind a typeof check', function() {
        assert.match(SF_SRC, /typeof\(\s*i18n\s*\)\s*==\s*['"]undefined['"]/);
    });

    it('nunjucks-filters guards the i18n require behind a typeof check', function() {
        assert.match(NF_SRC, /typeof\(\s*i18n\s*\)\s*==\s*['"]undefined['"]/);
    });

});


// ─── 02 — `t` filter declared on both factories ───────────────────────────

describe('02 - self.t filter declarations', function() {

    it('swig-filters declares self.t = function(key, params)', function() {
        assert.match(SF_SRC, /self\.t\s*=\s*function\s*\(\s*key\s*,\s*params\s*\)/);
    });

    it('nunjucks-filters declares self.t = function(key, params)', function() {
        assert.match(NF_SRC, /self\.t\s*=\s*function\s*\(\s*key\s*,\s*params\s*\)/);
    });

});


// ─── 03 — Culture resolution chain (req.culture → GINA_CULTURE) ───────────

describe('03 - culture resolution', function() {

    it('swig-filters reads ctx.req.culture (slice 3 hook) first', function() {
        assert.match(SF_SRC, /ctx\.req\s*&&\s*ctx\.req\.culture/);
    });

    it('nunjucks-filters reads ctx.req.culture (slice 3 hook) first', function() {
        assert.match(NF_SRC, /ctx\.req\s*&&\s*ctx\.req\.culture/);
    });

    it('swig-filters falls back to getEnvVar(\'GINA_CULTURE\')', function() {
        assert.match(SF_SRC, /getEnvVar\(\s*['"]GINA_CULTURE['"]\s*\)/);
    });

    it('nunjucks-filters falls back to getEnvVar(\'GINA_CULTURE\')', function() {
        assert.match(NF_SRC, /getEnvVar\(\s*['"]GINA_CULTURE['"]\s*\)/);
    });

});


// ─── 04 — bundleName resolution ────────────────────────────────────────────

describe('04 - bundleName resolution', function() {

    it('swig-filters reads bundleName from ctx.options.conf.bundle', function() {
        assert.match(SF_SRC, /ctx\.options\.conf\.bundle/);
    });

    it('nunjucks-filters reads bundleName from ctx.options.conf.bundle', function() {
        assert.match(NF_SRC, /ctx\.options\.conf\.bundle/);
    });

});


// ─── 05 — Pass-through to lib.i18n.t ──────────────────────────────────────

describe('05 - i18n.t forwarding', function() {

    it('swig-filters forwards (key, params, culture, {bundleName}) to i18n.t', function() {
        assert.match(SF_SRC, /i18n\.t\s*\(\s*key\s*,\s*params\s*,\s*culture\s*,\s*\{\s*bundleName\s*:\s*bundleName\s*\}\s*\)/);
    });

    it('nunjucks-filters forwards (key, params, culture, {bundleName}) to i18n.t', function() {
        assert.match(NF_SRC, /i18n\.t\s*\(\s*key\s*,\s*params\s*,\s*culture\s*,\s*\{\s*bundleName\s*:\s*bundleName\s*\}\s*\)/);
    });

});


// ─── 06 — Singleton context access (matches existing filter shape) ────────

describe('06 - singleton context access', function() {

    it('swig-filters t reads SwigFilters.instance._options || self.options', function() {
        assert.match(SF_SRC, /SwigFilters\.instance\._options\s*\|\|\s*self\.options/);
    });

    it('nunjucks-filters t reads NunjucksFilters.instance._options || self.options', function() {
        assert.match(NF_SRC, /NunjucksFilters\.instance\._options\s*\|\|\s*self\.options/);
    });

});


// ─── 07 — Negative invariants (no duplicated logic) ───────────────────────

describe('07 - negative invariants — t filter is a thin pass-through', function() {

    // Extract the `t` filter body for each factory so the assertions
    // don't accidentally fire on unrelated lines elsewhere in the file.
    function extractTBody(src) {
        var m = src.match(/self\.t\s*=\s*function\s*\(\s*key\s*,\s*params\s*\)\s*\{([\s\S]*?)\n\s*\};?/);
        return m ? m[1] : '';
    }
    var SF_T_BODY = extractTBody(SF_SRC);
    var NF_T_BODY = extractTBody(NF_SRC);

    it('swig-filters t body extracted (sanity)', function() {
        assert.ok(SF_T_BODY.length > 0, 'expected to find self.t body in swig-filters');
        assert.match(SF_T_BODY, /i18n\.t/);
    });

    it('nunjucks-filters t body extracted (sanity)', function() {
        assert.ok(NF_T_BODY.length > 0, 'expected to find self.t body in nunjucks-filters');
        assert.match(NF_T_BODY, /i18n\.t/);
    });

    it('swig-filters t body does NOT call Intl.PluralRules (no plural duplication)', function() {
        assert.equal(/Intl\.PluralRules/.test(SF_T_BODY), false);
    });

    it('nunjucks-filters t body does NOT call Intl.PluralRules (no plural duplication)', function() {
        assert.equal(/Intl\.PluralRules/.test(NF_T_BODY), false);
    });

    it('swig-filters t body does NOT contain interpolation regex (no interpolation duplication)', function() {
        assert.equal(/\\\{\(\\w\+\)\\\}/.test(SF_T_BODY), false);
    });

    it('nunjucks-filters t body does NOT contain interpolation regex (no interpolation duplication)', function() {
        assert.equal(/\\\{\(\\w\+\)\\\}/.test(NF_T_BODY), false);
    });

    it('swig-filters t body does NOT touch process.gina._i18nCatalogs directly', function() {
        assert.equal(/process\.gina\._i18nCatalogs/.test(SF_T_BODY), false);
    });

    it('nunjucks-filters t body does NOT touch process.gina._i18nCatalogs directly', function() {
        assert.equal(/process\.gina\._i18nCatalogs/.test(NF_T_BODY), false);
    });

});


// ─── 08 — Surface parity (port between engines without drift) ─────────────

describe('08 - swig ↔ nunjucks surface parity', function() {

    function extractTBody(src) {
        var m = src.match(/self\.t\s*=\s*function\s*\(\s*key\s*,\s*params\s*\)\s*\{([\s\S]*?)\n\s*\};?/);
        return m ? m[1] : '';
    }
    var SF_T_BODY = extractTBody(SF_SRC);
    var NF_T_BODY = extractTBody(NF_SRC);

    it('both bodies forward to i18n.t with the same arg shape', function() {
        // Same arg list — culture and bundleName names match.
        var argShape = /i18n\.t\s*\(\s*key\s*,\s*params\s*,\s*culture\s*,\s*\{\s*bundleName\s*:\s*bundleName\s*\}\s*\)/;
        assert.match(SF_T_BODY, argShape);
        assert.match(NF_T_BODY, argShape);
    });

    it('both bodies use the same culture-resolution chain shape', function() {
        var chain = /ctx\.req\s*&&\s*ctx\.req\.culture/;
        assert.match(SF_T_BODY, chain);
        assert.match(NF_T_BODY, chain);
    });

    it('both bodies use the same bundleName-resolution chain shape', function() {
        var chain = /ctx\.options\.conf\.bundle/;
        assert.match(SF_T_BODY, chain);
        assert.match(NF_T_BODY, chain);
    });

});
