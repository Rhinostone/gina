/**
 * lib/nunjucks-filters — source-inspection tests.
 *
 * The filter factory references gina globals (`_`, `GINA_FRAMEWORK_DIR`,
 * `JSON.clone`, `merge`, `routing`) that are only set up by `gna.js` at
 * real bundle boot. Exercising the factory end-to-end would require a
 * live bundle — heavy for near-zero extra coverage over the structural
 * assertions here. Matches the source-inspection style of
 * `render-engine-dispatch.test.js` and `swig-resolver.test.js`.
 *
 * What these tests lock in:
 *
 *   (a) lib/nunjucks-filters/src/main.js exports a `NunjucksFilters`
 *       factory with the same public surface as the swig-side sibling
 *       (`getUrl`, `getWebroot`, `length`, `nl2br`, `addHours`, `addDays`,
 *       `addYears`, plus internal `getConfig`)
 *   (b) lib/index.js registers `nunjucksFilters` via `_require`
 *   (c) render-nunjucks.js has the `registerGinaFilters` helper and
 *       invokes it once per request after env construction
 *   (d) the `env.addFilter` loop skips `getConfig` (matches swig path)
 *   (e) header docstring item #7 flips from Deferred to shipped
 *   (f) negative invariants — does NOT reference swig.setFilter, does NOT
 *       require('swig'), does NOT leak SwigFilters.instance into nunjucks
 *       code paths
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW             = require('../fw');
var NF_SRC         = fs.readFileSync(path.join(FW, 'lib/nunjucks-filters/src/main.js'), 'utf8');
var NF_PKG         = JSON.parse(fs.readFileSync(path.join(FW, 'lib/nunjucks-filters/package.json'), 'utf8'));
var LIB_INDEX_SRC  = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var RENDER_NJ_SRC  = fs.readFileSync(path.join(FW, 'core/controller/controller.render-nunjucks.js'), 'utf8');
var SF_SRC         = fs.readFileSync(path.join(FW, 'lib/swig-filters/src/main.js'), 'utf8');

/**
 * Strip block and line comments from a JS source string. Used by the
 * negative-invariant assertions below so JSDoc examples mentioning
 * `env.addFilter` or `swig.setFilter` don't trip a "does not call X"
 * check. Intentionally simple — good enough for source-inspection,
 * not a full tokeniser.
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */ (JSDoc + block)
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // // ... (skip protocol:// in strings)
}
var NF_CODE       = stripComments(NF_SRC);
var RENDER_NJ_CODE = stripComments(RENDER_NJ_SRC);


// ---------------------------------------------------------------------------
// 01 - Module shape + package.json
// ---------------------------------------------------------------------------

describe('01 - lib/nunjucks-filters module shape', function () {

    it('package.json is named gina-lib-nunjucks-filters', function () {
        assert.equal(NF_PKG.name, 'gina-lib-nunjucks-filters');
    });

    it('package.json main points to src/main', function () {
        assert.equal(NF_PKG.main, 'src/main');
    });

    it('defines a top-level NunjucksFilters factory function', function () {
        assert.match(NF_SRC, /function\s+NunjucksFilters\s*\(\s*conf\s*\)/);
    });

    it('exports NunjucksFilters via module.exports', function () {
        assert.match(NF_SRC, /module\.exports\s*=\s*NunjucksFilters/);
    });

    it('declares AMD publish path too (isGFFCtx fallback)', function () {
        assert.match(NF_SRC, /define\s*\(\s*function\s*\(\s*\)\s*\{\s*return\s+NunjucksFilters\s*;?\s*\}\s*\)/);
    });
});


// ---------------------------------------------------------------------------
// 02 - Singleton + factory wiring
// ---------------------------------------------------------------------------

describe('02 - Factory wiring', function () {

    it('uses NunjucksFilters.instance + NunjucksFilters.initialized singleton keys', function () {
        assert.match(NF_SRC, /NunjucksFilters\.instance/);
        assert.match(NF_SRC, /NunjucksFilters\.initialized/);
    });

    it('does NOT leak SwigFilters.instance/.initialized into runtime code', function () {
        // Copy-paste check — the port must rename SwigFilters runtime state
        // refs. Comment references (e.g. "Mirror of SwigFilters.getWebroot")
        // are allowed, so we strip comments first.
        assert.doesNotMatch(NF_CODE, /SwigFilters\.(instance|initialized)/);
    });

    it('refreshes instance._options with JSON.clone(conf) on every call', function () {
        assert.match(NF_SRC, /NunjucksFilters\.instance\._options\s*=\s*JSON\.clone\(\s*conf\s*\)/);
    });

    it('lazy-loads the merge lib via GINA_FRAMEWORK_DIR', function () {
        assert.match(NF_SRC, /GINA_FRAMEWORK_DIR\s*\+\s*["']\/lib\/merge["']/);
    });

    it('lazy-loads the routing lib via GINA_FRAMEWORK_DIR', function () {
        assert.match(NF_SRC, /GINA_FRAMEWORK_DIR\s*\+\s*["']\/lib\/routing["']/);
    });
});


// ---------------------------------------------------------------------------
// 03 - Public filter surface
// ---------------------------------------------------------------------------

describe('03 - Public filter surface', function () {

    it('defines self.getUrl(route, params, base)', function () {
        assert.match(NF_SRC, /self\.getUrl\s*=\s*function\s*\(\s*route\s*,\s*params\s*,\s*base\s*\)/);
    });

    it('defines self.getWebroot(input, obj)', function () {
        assert.match(NF_SRC, /self\.getWebroot\s*=\s*function\s*\(\s*input\s*,\s*obj\s*\)/);
    });

    it('defines self.length(input, obj)', function () {
        assert.match(NF_SRC, /self\.length\s*=\s*function\s*\(\s*input\s*,\s*obj\s*\)/);
    });

    it('defines self.nl2br(text, replacement)', function () {
        assert.match(NF_SRC, /self\.nl2br\s*=\s*function\s*\(\s*text\s*,\s*replacement\s*\)/);
    });

    it('defines self.addHours(input, h)', function () {
        assert.match(NF_SRC, /self\.addHours\s*=\s*function\s*\(\s*input\s*,\s*h\s*\)/);
    });

    it('defines self.addDays(input, d)', function () {
        assert.match(NF_SRC, /self\.addDays\s*=\s*function\s*\(\s*input\s*,\s*d\s*\)/);
    });

    it('defines self.addYears(input, y)', function () {
        assert.match(NF_SRC, /self\.addYears\s*=\s*function\s*\(\s*input\s*,\s*y\s*\)/);
    });

    it('defines the internal self.getConfig() — excluded from registration', function () {
        assert.match(NF_SRC, /self\.getConfig\s*=\s*function\s*\(\s*\)/);
    });

    it('has the same 7 public filter names as swig-filters (same surface)', function () {
        var publicFilters = ['getUrl', 'getWebroot', 'length', 'nl2br', 'addHours', 'addDays', 'addYears'];
        publicFilters.forEach(function (name) {
            assert.match(SF_SRC, new RegExp('self\\.' + name + '\\s*=\\s*function'),
                'swig-filters has self.' + name);
            assert.match(NF_SRC, new RegExp('self\\.' + name + '\\s*=\\s*function'),
                'nunjucks-filters has self.' + name);
        });
    });
});


// ---------------------------------------------------------------------------
// 04 - JSDoc presence (every public method + the class block)
// ---------------------------------------------------------------------------

describe('04 - JSDoc presence on public surface', function () {

    it('has a @class / @constructor block for NunjucksFilters', function () {
        assert.match(NF_SRC, /@class\s+NunjucksFilters/);
        assert.match(NF_SRC, /@constructor/);
    });

    it('each public filter has at least one @example', function () {
        // Rough check: the comment blocks that precede the public self.X
        // assignments must contain `@example` somewhere in the preceding
        // 30 lines (the JSDoc block).
        ['getUrl', 'getWebroot', 'length', 'nl2br', 'addHours', 'addDays', 'addYears'].forEach(function (name) {
            var idx = NF_SRC.indexOf('self.' + name + ' = function');
            assert.ok(idx > 0, name + ' assignment found');
            // Look backwards from the method for a JSDoc block with @example
            var window = NF_SRC.slice(Math.max(0, idx - 2000), idx);
            assert.match(window, /@example/, name + ' has a @example somewhere in its JSDoc block');
        });
    });
});


// ---------------------------------------------------------------------------
// 05 - lib/index.js registration
// ---------------------------------------------------------------------------

describe('05 - lib/index.js registration', function () {

    it('registers nunjucksFilters via _require (hot-reloadable path)', function () {
        assert.match(LIB_INDEX_SRC, /nunjucksFilters:\s*_require\('\.\/nunjucks-filters'\)/);
    });

    it('keeps the sibling nunjucksResolver registered', function () {
        assert.match(LIB_INDEX_SRC, /nunjucksResolver:\s*_require\('\.\/nunjucks-resolver'\)/);
    });

    it('keeps SwigFilters registered (swig path unchanged)', function () {
        assert.match(LIB_INDEX_SRC, /SwigFilters\s*:\s*_require\('\.\/swig-filters'\)/);
    });
});


// ---------------------------------------------------------------------------
// 06 - render-nunjucks.js integration
// ---------------------------------------------------------------------------

describe('06 - render-nunjucks.js integration', function () {

    it('defines an inner registerGinaFilters helper function', function () {
        assert.match(RENDER_NJ_SRC, /function\s+registerGinaFilters\s*\(\s*env\s*,\s*self\s*,\s*local\s*,\s*localOptions\s*\)/);
    });

    it('calls registerGinaFilters from the render flow (per-request)', function () {
        assert.match(RENDER_NJ_SRC, /registerGinaFilters\(\s*env\s*,\s*self\s*,\s*local\s*,\s*localOptions\s*\)/);
    });

    it('fetches the lib via require("../../lib").nunjucksFilters', function () {
        assert.match(RENDER_NJ_SRC, /require\(\s*['"]\.\.\/\.\.\/lib['"]\s*\)\.nunjucksFilters/);
    });

    it('has a fallback require("../../lib/nunjucks-filters") for bootstrap safety', function () {
        assert.match(RENDER_NJ_SRC, /require\(\s*['"]\.\.\/\.\.\/lib\/nunjucks-filters['"]\s*\)/);
    });

    it('iterates filters via env.addFilter(name, fn)', function () {
        assert.match(RENDER_NJ_SRC, /env\.addFilter\(\s*name\s*,\s*filters\[\s*name\s*\]\s*\)/);
    });

    it('skips getConfig in the registration loop (matches swig path)', function () {
        assert.match(RENDER_NJ_SRC, /name\s*!==\s*['"]getConfig['"]/);
    });

    it('passes {options, isProxyHost, throwError, req, res} to the factory', function () {
        // All five keys must appear in the factory call payload
        var factoryCall = RENDER_NJ_SRC.match(/nunjucksFilters\(\s*\{[^}]*\}\s*\)/);
        assert.ok(factoryCall, 'factory call object literal found');
        ['options', 'isProxyHost', 'throwError', 'req', 'res'].forEach(function (k) {
            assert.match(factoryCall[0], new RegExp('\\b' + k + '\\s*:'), 'key `' + k + '` in factory payload');
        });
    });

    it('wraps the registration in try/catch + routes errors through self.throwError', function () {
        assert.match(
            RENDER_NJ_SRC,
            /try\s*\{[\s\S]{0,200}registerGinaFilters\([\s\S]{0,200}catch\s*\(\s*filterErr\s*\)[\s\S]{0,80}self\.throwError\(\s*filterErr\s*\)/
        );
    });

    it('registers filters AFTER env construction but BEFORE template render', function () {
        // Single regex enforces the three landmarks in order:
        //   1. env = getEnvironment(nunjucks, templateRoot, ...)
        //   2. registerGinaFilters(env, ...)
        //   3. env.render(templateRel, ...)  — the main template render
        // (the error-path env.renderString() is a separate branch).
        assert.match(
            RENDER_NJ_CODE,
            /env\s*=\s*getEnvironment\(\s*nunjucks\s*,\s*templateRoot[\s\S]*?registerGinaFilters\(\s*env[\s\S]*?env\.render\(\s*templateRel/
        );
    });

    it('deferred-feature item #7 (SwigFilters registration) marked shipped', function () {
        // Header docstring must flag the port. Keep the assertion loose on
        // spacing but strict on intent.
        assert.match(RENDER_NJ_SRC, /Gina SwigFilters registration[\s\S]{0,120}shipped/i);
    });
});


// ---------------------------------------------------------------------------
// 07 - Negative invariants
// ---------------------------------------------------------------------------

describe('07 - negative invariants', function () {

    it('nunjucks-filters does NOT call swig.setFilter in runtime code', function () {
        // Comments referencing the swig API (for parallel-pattern docs) are fine;
        // the factory must not actually invoke it.
        assert.doesNotMatch(NF_CODE, /swig\.setFilter/);
    });

    it('nunjucks-filters does NOT require("swig") or any @rhinostone/swig path', function () {
        assert.doesNotMatch(NF_SRC, /require\(\s*[`'"][^`'"]*swig[^`'"]*[`'"]\s*\)/);
    });

    it('nunjucks-filters does NOT call env.addFilter itself (registration is caller-side)', function () {
        // The lib is a pure filter-function factory; registration lives in
        // render-nunjucks.js so the same functions could be re-registered
        // on a different env in the future without touching the lib.
        // JSDoc example blocks mentioning env.addFilter are allowed —
        // strip comments before the check.
        assert.doesNotMatch(NF_CODE, /env\.addFilter/);
    });

    it('nunjucks-filters never declares nunjucks as a runtime dep', function () {
        // Parallel of the swig-filters / render-nunjucks rule — the library
        // is engine-agnostic at the code level; the caller holds the engine.
        assert.doesNotMatch(NF_SRC, /require\(\s*[`'"]nunjucks[`'"]\s*\)/);
    });

    it('render-nunjucks.js registerGinaFilters uses env.addFilter, not swig.setFilter', function () {
        // Guard against a copy-paste mistake when the swig pattern is the
        // obvious template. env.addFilter is the nunjucks API.
        assert.doesNotMatch(RENDER_NJ_CODE, /swig\.setFilter/);
    });
});
