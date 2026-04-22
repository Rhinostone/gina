/**
 * N2 — render.engine dispatch + controller.render-nunjucks.js MVP shape.
 *
 * Source-inspection tests (same style as connector-*.test.js): exercise
 * the full wiring path would require a live bundle with nunjucks installed,
 * a real req/res, and a template root — heavy for near-zero extra coverage
 * over what these assertions prove:
 *
 *   (a) controller.js this.render reads settings.render.engine and
 *       dispatches to either controller.render-swig or
 *       controller.render-nunjucks
 *   (b) the cacheless branch evicts the nunjucks delegate path too
 *   (c) controller.render-nunjucks.js exports an async function with the
 *       same deps signature as render-swig and uses
 *       lib.nunjucksResolver.get() to access the engine
 *   (d) server.js declares initNunjucksEngine and calls it from the
 *       bundle-init path alongside initSwigEngine
 *   (e) schema/settings.json declares `render.engine` and `nunjucks`
 *   (f) lib/index.js registers nunjucksResolver
 *   (g) negative invariant — render-nunjucks.js does NOT fabricate nunjucks
 *       via require('nunjucks') at module load, always goes through the
 *       resolver (locks in the "no direct framework dep" rule)
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW              = require('../fw');
var CONTROLLER_SRC  = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var RENDER_NJ_SRC   = fs.readFileSync(path.join(FW, 'core/controller/controller.render-nunjucks.js'), 'utf8');
var SERVER_SRC      = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var LIB_INDEX_SRC   = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var SCHEMA_SETTINGS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schema/settings.json'), 'utf8'));


// ---------------------------------------------------------------------------
// 01 - schema/settings.json
// ---------------------------------------------------------------------------

describe('01 - schema/settings.json', function () {

    it('declares a top-level `render` block', function () {
        assert.ok(SCHEMA_SETTINGS.properties.render, 'render block present');
    });

    it('render.engine is an enum of ["swig", "nunjucks"]', function () {
        var engine = SCHEMA_SETTINGS.properties.render.properties.engine;
        assert.ok(engine, 'engine prop present');
        assert.deepEqual(engine.enum.sort(), ['nunjucks', 'swig']);
    });

    it('render.engine defaults to "swig"', function () {
        assert.equal(SCHEMA_SETTINGS.properties.render.properties.engine.default, 'swig');
    });

    it('declares a top-level `nunjucks` block', function () {
        assert.ok(SCHEMA_SETTINGS.properties.nunjucks);
    });

    it('nunjucks.package defaults to "nunjucks"', function () {
        assert.equal(SCHEMA_SETTINGS.properties.nunjucks.properties['package'].default, 'nunjucks');
    });

    it('nunjucks.autoescape is boolean with default true', function () {
        var ae = SCHEMA_SETTINGS.properties.nunjucks.properties.autoescape;
        assert.equal(ae.type, 'boolean');
        assert.equal(ae.default, true);
    });
});


// ---------------------------------------------------------------------------
// 02 - lib/index.js registration
// ---------------------------------------------------------------------------

describe('02 - lib/index.js registration', function () {

    it('registers nunjucksResolver via _require', function () {
        assert.match(LIB_INDEX_SRC, /nunjucksResolver:\s*_require\('\.\/nunjucks-resolver'\)/);
    });

    it('keeps swigResolver registered alongside', function () {
        assert.match(LIB_INDEX_SRC, /swigResolver\s*:\s*_require\('\.\/swig-resolver'\)/);
    });
});


// ---------------------------------------------------------------------------
// 03 - controller.js dispatch
// ---------------------------------------------------------------------------

describe('03 - controller.js engine dispatch', function () {

    it('reads render.engine from local.options.conf.content.settings', function () {
        assert.match(CONTROLLER_SRC, /_settings\.render\s*&&\s*_settings\.render\.engine/);
    });

    it('defaults to "swig" when render.engine is unset', function () {
        // the initial var declaration
        assert.match(CONTROLLER_SRC, /var\s+_engine\s*=\s*['"]swig['"]/);
    });

    it('picks controller.render-nunjucks delegate when engine === "nunjucks"', function () {
        assert.match(
            CONTROLLER_SRC,
            /_engine\s*===\s*['"]nunjucks['"]\)\s*\?\s*['"]\/controller\.render-nunjucks['"]/
        );
    });

    it('falls back to controller.render-swig otherwise', function () {
        assert.match(
            CONTROLLER_SRC,
            /:\s*['"]\/controller\.render-swig['"]/
        );
    });

    it('cacheless branch evicts the nunjucks delegate path from require.cache', function () {
        assert.match(
            CONTROLLER_SRC,
            /delete\s+require\.cache\[require\.resolve\(\s*_\(__dirname\s*\+\s*['"]\/controller\.render-nunjucks['"]/
        );
    });

    it('cacheless eviction for nunjucks is wrapped in try/catch (older framework dirs tolerated)', function () {
        // The nunjucks delegate may not exist in older framework dirs after
        // a downgrade; require.resolve throws on missing files, so the
        // eviction line must be wrapped. Matches:
        //   try { delete require.cache[require.resolve( _(__dirname + '/controller.render-nunjucks' ...
        assert.match(
            CONTROLLER_SRC,
            /try\s*\{\s*delete\s+require\.cache\[require\.resolve\(\s*_\(__dirname\s*\+\s*['"]\/controller\.render-nunjucks['"][^)]*\)\s*\)\s*\][^}]*\}\s*catch/
        );
    });

    it('final require dispatches through the computed _delegate var', function () {
        assert.match(
            CONTROLLER_SRC,
            /return\s+require\(\s*_\(__dirname\s*\+\s*_delegate,\s*true\)\s*\)/
        );
    });
});


// ---------------------------------------------------------------------------
// 04 - controller.render-nunjucks.js shape
// ---------------------------------------------------------------------------

describe('04 - controller.render-nunjucks.js shape', function () {

    it('exports an async function with the (userData, displayInspector, errOptions, deps) signature', function () {
        assert.match(
            RENDER_NJ_SRC,
            /module\.exports\s*=\s*async\s+function[^(]*\(\s*userData\s*,\s*displayInspector\s*,\s*errOptions\s*,\s*deps\s*\)/
        );
    });

    it('fetches nunjucks via lib.nunjucksResolver.get() — not a direct require', function () {
        assert.match(RENDER_NJ_SRC, /nunjucksResolver\.get\(\)/);
    });

    it('never calls require("nunjucks") directly at module or function level', function () {
        // Locks in the "no framework dep on nunjucks" rule. Only the
        // resolver may resolve the project-installed copy.
        assert.doesNotMatch(RENDER_NJ_SRC, /require\(\s*['"]nunjucks['"]\s*\)/);
    });

    it('caches the Environment on process.gina._nunjucksEnvs per template root', function () {
        assert.match(RENDER_NJ_SRC, /process\.gina\._nunjucksEnvs/);
        assert.match(RENDER_NJ_SRC, /new\s+nunjucks\.Environment\(/);
        assert.match(RENDER_NJ_SRC, /new\s+nunjucks\.FileSystemLoader\(/);
    });

    it('FileSystemLoader disables template cache in dev mode', function () {
        assert.match(RENDER_NJ_SRC, /noCache:\s*process\.env\.NODE_ENV_IS_DEV\s*===\s*['"]true['"]/);
    });

    it('invalidates the Environment cache when the nunjucks module itself was hot-swapped', function () {
        assert.match(RENDER_NJ_SRC, /_nunjucksEnvsOwner\s*!==\s*nunjucks/);
    });

    it('handles HEAD requests by sending headers only, no body', function () {
        assert.match(RENDER_NJ_SRC, /\/\^HEAD\$\/i\.test\(\s*local\.req\.method\s*\)/);
    });

    it('preserves existing response headers (content-type only set when absent)', function () {
        assert.match(RENDER_NJ_SRC, /!local\.res\.getHeader\(['"]content-type['"]\)/);
    });

    it('short-circuits when hasViews() returns false', function () {
        assert.match(RENDER_NJ_SRC, /!hasViews\s*\|\|\s*!hasViews\(\)/);
    });

    it('mirrors render-swig error interception for non-2xx + error data', function () {
        assert.match(RENDER_NJ_SRC, /isRenderingCustomError/);
        assert.match(RENDER_NJ_SRC, /self\.throwError/);
    });

    it('documents deferred features in a top-of-file comment block', function () {
        // Not an exact-match — just that the deferred-features block exists
        // so a future reader sees what MVP skipped.
        assert.match(RENDER_NJ_SRC, /[Dd]eferred/);
        assert.match(RENDER_NJ_SRC, /[Ii]nspector/);
        assert.match(RENDER_NJ_SRC, /HTTP\/2/);
    });

    it('contains resolveTemplatePath helper for namespace-aware path resolution', function () {
        assert.match(RENDER_NJ_SRC, /function\s+resolveTemplatePath\s*\(/);
    });
});


// ---------------------------------------------------------------------------
// 05 - server.js bundle startup wiring
// ---------------------------------------------------------------------------

describe('05 - server.js bundle startup', function () {

    it('declares var nunjucksResolver at module level', function () {
        assert.match(SERVER_SRC, /var\s+nunjucksResolver\s*=\s*lib\.nunjucksResolver/);
    });

    it('declares initNunjucksEngine as an inner function', function () {
        assert.match(SERVER_SRC, /var\s+initNunjucksEngine\s*=\s*function\s*\(\s*conf\s*\)/);
    });

    it('initNunjucksEngine short-circuits when render.engine !== "nunjucks"', function () {
        // Match: _engine !== 'nunjucks' check followed by return
        var idx = SERVER_SRC.indexOf('var initNunjucksEngine');
        assert.ok(idx > 0);
        var body = SERVER_SRC.slice(idx, idx + 800);
        assert.match(body, /_engine\s*!==\s*['"]nunjucks['"]/);
        assert.match(body, /return\s*;/);
    });

    it('initNunjucksEngine calls nunjucksResolver.load with executionPath + settings.nunjucks', function () {
        var idx = SERVER_SRC.indexOf('var initNunjucksEngine');
        var body = SERVER_SRC.slice(idx, idx + 800);
        assert.match(body, /nunjucksResolver\.load\(\s*self\.executionPath/);
    });

    it('bundle-init path calls initNunjucksEngine alongside initSwigEngine', function () {
        assert.match(
            SERVER_SRC,
            /initSwigEngine\(self\.conf\[self\.appName\]\[self\.env\]\);\s*[\s\S]*?initNunjucksEngine\(self\.conf\[self\.appName\]\[self\.env\]\)/
        );
    });

    it('both inits are gated behind hasViews(self.appName)', function () {
        // The hasViews guard should wrap both calls — find the block and
        // assert both strings appear inside it.
        var match = SERVER_SRC.match(/hasViews\s*\(\s*self\.appName\s*\)\s*\)\s*\{([\s\S]*?)\}/);
        assert.ok(match, 'hasViews guard block found');
        assert.match(match[1], /initSwigEngine/);
        assert.match(match[1], /initNunjucksEngine/);
    });
});


// ---------------------------------------------------------------------------
// 05b - Inspector __gdPayload injection in render-nunjucks.js
// ---------------------------------------------------------------------------

describe('05b - Inspector __gdPayload injection', function () {

    it('imports lib/inspector-redact', function () {
        assert.match(RENDER_NJ_SRC, /require\(\s*['"]lib\/inspector-redact['"]\s*\)/);
    });

    it('declares injectInspectorScripts helper', function () {
        assert.match(RENDER_NJ_SRC, /function\s+injectInspectorScripts\s*\(/);
    });

    it('gates injection on displayInspector + isCacheless', function () {
        assert.match(RENDER_NJ_SRC, /displayInspector\s*===\s*false/);
        assert.match(RENDER_NJ_SRC, /displayInspector\s*!==\s*true\s*&&\s*!self\.isCacheless\(\)/);
    });

    it('skips injection when no </body> anchor is in the HTML', function () {
        // Accept any form of the guard — the key semantic is that the
        // injection only fires when </body> is present.
        assert.match(RENDER_NJ_SRC, /<\\\/body>\/i\.test\(html\)/);
    });

    it('builds __gdGina and __gdUser from data.page via JSON deep-clone', function () {
        assert.match(RENDER_NJ_SRC, /var\s+__gdGina\s*=\s*JSON\.parse\(\s*JSON\.stringify\(\s*data\.page\s*\)\s*\)/);
        assert.match(RENDER_NJ_SRC, /var\s+__gdUser\s*=\s*JSON\.parse\(\s*JSON\.stringify\(\s*data\.page\s*\)\s*\)/);
    });

    it('reads redact config via inspectorRedact.getConfig(local.options.conf)', function () {
        assert.match(RENDER_NJ_SRC, /inspectorRedact\.getConfig\(\s*local\.options\.conf\s*\)/);
    });

    it('snapshots unredacted payload only when NODE_SCOPE === "local"', function () {
        assert.match(
            RENDER_NJ_SRC,
            /process\.env\.NODE_SCOPE\s*===\s*['"]local['"]\)/
        );
    });

    it('redacts via inspectorRedact.redact with compiledPatterns + replacement', function () {
        assert.match(RENDER_NJ_SRC, /inspectorRedact\.redact\(/);
        assert.match(RENDER_NJ_SRC, /compiledPatterns:\s*_redactConf\.compiledPatterns/);
        assert.match(RENDER_NJ_SRC, /replacement:\s*_redactConf\.replacement/);
    });

    it('escapes </script> and <!-- in the serialised JSON', function () {
        assert.match(RENDER_NJ_SRC, /\.replace\(\/<\\\/script>\/gi,\s*['"]<\\\\\/script>['"]\)/);
        assert.match(RENDER_NJ_SRC, /\.replace\(\/<!--\/g,\s*['"]<\\\\!--['"]\)/);
    });

    it('constructs window.__ginaData script with the escaped JSON', function () {
        assert.match(RENDER_NJ_SRC, /window\.__ginaData\s*=\s*['"]\s*\+\s*_safeJson/);
    });

    it('constructs window.__ginaLogs console-hook script', function () {
        assert.match(RENDER_NJ_SRC, /window\.__ginaLogs\s*=\s*window\.__ginaLogs\s*\|\|\s*\[\]/);
    });

    it('stashes redacted payload on self.serverInstance._lastGinaData', function () {
        assert.match(RENDER_NJ_SRC, /self\.serverInstance\._lastGinaData\s*=\s*__gdPayload/);
    });

    it('stashes unredacted snapshot on _lastGinaDataUnredacted (null outside local scope)', function () {
        assert.match(RENDER_NJ_SRC, /_lastGinaDataUnredacted\s*=\s*__gdPayloadUnredacted/);
    });

    it('emits process.emit("inspector#data", __gdPayload)', function () {
        assert.match(RENDER_NJ_SRC, /process\.emit\(\s*['"]inspector#data['"],\s*__gdPayload\s*\)/);
    });

    it('injects scripts before </body> via case-insensitive regex replace', function () {
        assert.match(RENDER_NJ_SRC, /html\.replace\(\/<\\\/body>\/i/);
    });

    it('wraps injection in try/catch so Inspector bugs never break rendering', function () {
        // In the main render function body the injection call is inside try/catch.
        assert.match(
            RENDER_NJ_SRC,
            /try\s*\{\s*html\s*=\s*injectInspectorScripts\(\s*html\s*,\s*data\s*,\s*self\s*,\s*local\s*,\s*displayInspector\s*\)\s*;[\s\S]*?catch/
        );
    });

    it('documents statusbar.html inclusion as a within-Inspector deferred follow-up', function () {
        // Captures our commitment — if a future session silently drops the
        // statusbar note, this test fails and forces explicit re-docs.
        // Multi-line tolerant: token presence plus the 'deferred' word
        // within a small window.
        assert.match(RENDER_NJ_SRC, /statusbar\.html[\s\S]{0,400}deferred/i);
    });

    it('documents data.page.flow / queries pipeline as deferred', function () {
        assert.match(RENDER_NJ_SRC, /flow[\s\S]{0,100}deferred|data\.page\.flow|_timeline/);
        assert.match(RENDER_NJ_SRC, /queries[\s\S]{0,100}deferred|_queryLog/);
    });
});


// ---------------------------------------------------------------------------
// 06 - Negative invariants
// ---------------------------------------------------------------------------

describe('06 - negative invariants', function () {

    it('framework/v*/package.json does NOT declare nunjucks as a dep', function () {
        // The whole point: nunjucks is NEVER a framework dependency.
        // User's project owns the install.
        var pkg = JSON.parse(fs.readFileSync(path.join(FW, 'package.json'), 'utf8'));
        var allDeps = Object.assign({},
            pkg.dependencies || {},
            pkg.devDependencies || {},
            pkg.peerDependencies || {},
            pkg.optionalDependencies || {}
        );
        assert.equal(allDeps.nunjucks, undefined, 'nunjucks must not appear in framework/v*/package.json');
    });

    it('render-nunjucks.js does NOT declare nunjucks in any shape of require()', function () {
        // Catches: require("nunjucks"), require('nunjucks'), require(`nunjucks`)
        assert.doesNotMatch(RENDER_NJ_SRC, /require\(\s*[`'"]nunjucks[`'"]\s*\)/);
    });

    it('controller.js default engine is "swig" — nunjucks is strictly opt-in', function () {
        // Guards against a future session flipping the default, which would
        // silently break every existing bundle that never installed nunjucks.
        var snippet = CONTROLLER_SRC.match(/var\s+_engine\s*=\s*['"]([^'"]+)['"]/);
        assert.ok(snippet, 'engine default found');
        assert.equal(snippet[1], 'swig', 'default MUST be swig');
    });
});
