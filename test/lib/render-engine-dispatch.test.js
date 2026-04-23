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
// 05a - sendHtmlResponse four-way branch (HTTP/2 stream + HTTP/1.1)
// ---------------------------------------------------------------------------

describe('05a - sendHtmlResponse four-way branch (class.controller.md §7b)', function () {

    it('reads the HTTP/2 stream from local.res.stream', function () {
        assert.match(RENDER_NJ_SRC, /local\.res\.stream/);
    });

    it('guards HTTP/2 responses against stream.destroyed || stream.closed', function () {
        // Match the guard pattern — must appear at least once for both
        // HEAD and body paths.
        var matches = RENDER_NJ_SRC.match(/stream\.destroyed\s*\|\|\s*stream\.closed/g);
        assert.ok(matches && matches.length >= 2, 'guard appears in both HEAD+stream and body+stream branches');
    });

    it('HTTP/2 HEAD path calls stream.respond with content-length + :status', function () {
        // Inspect the HEAD×stream block specifically
        assert.match(RENDER_NJ_SRC, /_headH2\s*=\s*\{[\s\S]*?'content-length':\s*byteLength[\s\S]*?':status':[\s\S]*?\}/);
        assert.match(RENDER_NJ_SRC, /stream\.respond\(_headH2\)/);
    });

    it('HTTP/2 body path calls stream.respond with content-type + :status', function () {
        assert.match(RENDER_NJ_SRC, /_streamHeaders\s*=\s*\{[\s\S]*?'content-type':[\s\S]*?':status':[\s\S]*?\}/);
        assert.match(RENDER_NJ_SRC, /stream\.respond\(_streamHeaders\)/);
    });

    it('HTTP/2 body path calls stream.end(html)', function () {
        assert.match(RENDER_NJ_SRC, /stream\.end\(html\)/);
    });

    it('merges pipeline-set headers via local.res.getHeaders()', function () {
        // Applies to BOTH stream paths — CORS / cache-control / cookies
        // set earlier must be preserved on the raw HTTP/2 stream.
        var matches = RENDER_NJ_SRC.match(/local\.res\.getHeaders\(\)/g);
        assert.ok(matches && matches.length >= 2, 'getHeaders() called for both HEAD+stream and body+stream merges');
    });

    it('sets local.res.headersSent = true after successful stream.respond', function () {
        var matches = RENDER_NJ_SRC.match(/local\.res\.headersSent\s*=\s*true/g);
        assert.ok(matches && matches.length >= 2, 'headersSent flagged for both HEAD+stream and body+stream paths');
    });

    it('HTTP/1.1 HEAD path sends content-length via setHeader, empty body', function () {
        assert.match(RENDER_NJ_SRC, /local\.res\.setHeader\(\s*['"]content-length['"]\s*,\s*byteLength\s*\)/);
    });

    it('HTTP/1.1 body path uses res.writeHead + res.end(html)', function () {
        assert.match(RENDER_NJ_SRC, /local\.res\.writeHead\(statusCode\);\s*\n\s*local\.res\.end\(html\)/);
    });

    it('HEAD request fallback returns early (no body sent)', function () {
        assert.match(RENDER_NJ_SRC, /if\s*\(isHead\)/);
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
// 05c - Error-page template routing (isRenderingCustomError branch)
// ---------------------------------------------------------------------------

describe('05c - error-page template routing (isRenderingCustomError branch)', function () {

    it('declares the isRenderingCustomError local flag from localOptions', function () {
        // Matches: var isRenderingCustomError = (localOptions.isRenderingCustomError === true);
        assert.match(
            RENDER_NJ_SRC,
            /var\s+isRenderingCustomError\s*=\s*\(\s*localOptions\.isRenderingCustomError\s*===\s*true\s*\)/
        );
    });

    it('branches on isRenderingCustomError before picking the template path', function () {
        // The if (isRenderingCustomError) branch must precede the call site
        // of resolveTemplatePath so the two cases are exclusive. Search for
        // the assignment form (`templateRel = resolveTemplatePath(...)`) so
        // we hit the call, not the function definition at top of file.
        var branchIdx   = RENDER_NJ_SRC.indexOf('if (isRenderingCustomError)');
        var resolveIdx  = RENDER_NJ_SRC.indexOf('templateRel = resolveTemplatePath(data, localOptions)');
        assert.ok(branchIdx > 0, 'isRenderingCustomError branch present');
        assert.ok(resolveIdx > 0, 'resolveTemplatePath call present');
        assert.ok(branchIdx < resolveIdx, 'custom-error branch must sit before resolveTemplatePath call');
    });

    it('reads the error template via fs.readFileSync on localOptions.file (absolute path)', function () {
        assert.match(
            RENDER_NJ_SRC,
            /fs\.readFileSync\(\s*_absErrTemplate\s*,\s*['"]utf8['"]\s*\)/
        );
        // The source must come from localOptions.file — controller.js
        // renderCustomError() injects the absolute path there via errOptions.
        assert.match(RENDER_NJ_SRC, /var\s+_absErrTemplate\s*=\s*localOptions\.file/);
    });

    it('renders the error template with env.renderString(_errSource, data), not env.render', function () {
        // renderString bypasses the FileSystemLoader (which rejects absolute
        // paths and cannot reach shared-path error templates outside the
        // bundle root).
        assert.match(
            RENDER_NJ_SRC,
            /env\.renderString\(\s*_errSource\s*,\s*data\s*\)/
        );
    });

    it('guards against a missing error template with a minimal inline HTML fallback', function () {
        // If the absolute path doesn't exist, serve an inline fallback — do
        // NOT recurse into self.throwError.
        assert.match(
            RENDER_NJ_SRC,
            /!_absErrTemplate\s*\|\|\s*!fs\.existsSync\(\s*_absErrTemplate\s*\)/
        );
        assert.match(
            RENDER_NJ_SRC,
            /\[render-nunjucks\]\s*error template not found:/
        );
    });

    it('guards against a readFileSync failure with an inline HTML fallback', function () {
        // The try/catch around fs.readFileSync writes to `html` directly —
        // again, no recursion into throwError.
        var readBlockIdx = RENDER_NJ_SRC.indexOf('_errSource = fs.readFileSync');
        assert.ok(readBlockIdx > 0);
        var nearby = RENDER_NJ_SRC.slice(readBlockIdx, readBlockIdx + 700);
        assert.match(nearby, /catch\s*\(\s*readErr\s*\)/);
        assert.match(nearby, /\[render-nunjucks\]\s*failed to read error template:/);
    });

    it('catches env.renderString failures with an inline HTML fallback (no throwError recursion)', function () {
        var rsIdx = RENDER_NJ_SRC.indexOf('env.renderString(_errSource');
        assert.ok(rsIdx > 0);
        var nearby = RENDER_NJ_SRC.slice(rsIdx, rsIdx + 500);
        assert.match(nearby, /catch\s*\(\s*renderErr\s*\)/);
        assert.match(nearby, /\[render-nunjucks\]\s*error template render failed:/);
    });

    it('NEVER calls self.throwError inside the isRenderingCustomError branch', function () {
        // Slice the branch body and assert no throwError call is made. A
        // throwError call here would re-enter the same render path and could
        // loop infinitely. All failure modes MUST fall through to the inline
        // HTML fallback + sendHtmlResponse.
        var branchStart = RENDER_NJ_SRC.indexOf('if (isRenderingCustomError) {');
        assert.ok(branchStart > 0, 'branch entry found');
        // Find the matching closing brace of the if-branch (i.e. up to the `} else {` that opens the normal path).
        var elseMarker = RENDER_NJ_SRC.indexOf('} else {', branchStart);
        assert.ok(elseMarker > branchStart, 'branch else delimiter found');
        var branchBody = RENDER_NJ_SRC.slice(branchStart, elseMarker);
        assert.doesNotMatch(branchBody, /self\.throwError\(/);
    });

    it('resets localOptions.isRenderingCustomError = false after the render (defensive)', function () {
        // Mirrors render-swig.js lines 804 and 1434. Prevents a downstream
        // render that reuses the same localOptions from re-entering the
        // custom-error branch.
        assert.match(
            RENDER_NJ_SRC,
            /localOptions\.isRenderingCustomError\s*=\s*false/
        );
    });

    it('builds the inline HTML fallback from data.page.data.status (or 500 default)', function () {
        // Fallback title/body must show the resolved error code so the
        // client at least sees *which* error the bundle hit.
        assert.match(
            RENDER_NJ_SRC,
            /_errStatusCode\s*=\s*\(\s*data\s*&&\s*data\.page\s*&&\s*data\.page\.data\s*&&\s*data\.page\.data\.status\s*\)\s*\|\|\s*500/
        );
    });

    it('getEnvironment is called BEFORE the isRenderingCustomError branch', function () {
        // Both branches share the same env (cached per templateRoot). The
        // env is built first, then we pick which render strategy to use.
        var envIdx    = RENDER_NJ_SRC.indexOf('env = getEnvironment(nunjucks, templateRoot');
        var branchIdx = RENDER_NJ_SRC.indexOf('if (isRenderingCustomError) {');
        assert.ok(envIdx > 0);
        assert.ok(branchIdx > envIdx, 'env setup precedes the branch');
    });

    it('normal render path (else branch) still calls env.render(templateRel, data)', function () {
        // Locks that refactoring the custom-error branch did not break the
        // normal path — env.render remains for the non-error case.
        assert.match(RENDER_NJ_SRC, /html\s*=\s*env\.render\(\s*templateRel\s*,\s*data\s*\)/);
    });

    it('normal render path keeps the template-existence pre-flight', function () {
        assert.match(
            RENDER_NJ_SRC,
            /\[render-nunjucks\]\s*template not found:/
        );
    });

    it('documents error-page routing as shipped in the top-of-file header block', function () {
        // Same lock we use for Inspector statusbar deferral — if a future
        // session silently re-flags this as deferred, this assertion
        // breaks and forces explicit re-docs.
        assert.match(RENDER_NJ_SRC, /Error-page template routing[\s\S]{0,80}shipped/i);
    });
});


// ---------------------------------------------------------------------------
// 05d - #NJ2 — setResources / <gina> layout placeholder port
// ---------------------------------------------------------------------------
//
// Source-inspection coverage for the asset-cataloguing port: `setResources`
// wiring (produces raw-HTML `data.page.view.stylesheets/scripts`), post-render
// `injectAssets` helper (stylesheets before </head>, scripts before </body>
// unless `javascriptsDeferEnabled`, ginaLoader and externalPlugins in the
// head), user-placement detection (exact substring match on the rendered
// HTML), and `isWithoutLayout` Collection filter. Behavioural tests for
// injectAssets itself are pure functions — we require the delegate via the
// Node loader and exercise the helper directly where possible.

describe('05d - #NJ2 asset injection / setResources port', function () {

    // -----------------------------------------------------------------------
    // (a) source-level wiring — deps.setResources + localTemplateConf prep
    // -----------------------------------------------------------------------

    it('consumes deps.setResources in the main render function', function () {
        assert.match(RENDER_NJ_SRC, /var\s+setResources\s*=\s*deps\.setResources/);
    });

    it('documents deps.setResources in the top-of-file @param block', function () {
        assert.match(RENDER_NJ_SRC, /@param\s+\{function\}\s+deps\.setResources/);
    });

    it('controller.js still passes setResources to both render delegates', function () {
        // The ref was already in the deps block shipped with #NJ1; this test
        // locks it in so a future cleanup pass doesn't drop it before the
        // nunjucks side picks it up.
        assert.match(CONTROLLER_SRC, /setResources:\s*setResources/);
    });

    it('calls setResources(localTemplateConf) before env.render()', function () {
        // Use the `typeof setResources === 'function'` guard site as the
        // anchor — that exact string only appears in the implementation,
        // not in the doc-comment header block.
        var guardIdx  = RENDER_NJ_SRC.indexOf("typeof setResources === 'function'");
        var renderIdx = RENDER_NJ_SRC.indexOf('env.render(templateRel, data)');
        assert.ok(guardIdx > 0, 'setResources guard present');
        assert.ok(renderIdx > 0, 'env.render call present');
        assert.ok(guardIdx < renderIdx, 'setResources guarded block must run before env.render');
        // And the actual invocation line sits inside the guarded block.
        var block = RENDER_NJ_SRC.slice(guardIdx, renderIdx);
        assert.match(block, /setResources\(\s*localTemplateConf\s*\)\s*;/);
    });

    it('guards the setResources call with a typeof check so older controllers still work', function () {
        assert.match(RENDER_NJ_SRC, /typeof\s+setResources\s*===\s*['"]function['"]/);
    });

    it('catches setResources failures without breaking the render', function () {
        // Mis-shaped config should log a warning, not throwError — the render
        // proceeds without auto-injected assets rather than 500ing.
        var idx = RENDER_NJ_SRC.indexOf("typeof setResources === 'function'");
        assert.ok(idx > 0);
        var block = RENDER_NJ_SRC.slice(idx, idx + 1200);
        assert.match(block, /catch\s*\(\s*resourcesErr\s*\)/);
        assert.match(block, /\[render-nunjucks\]\s*setResources failed:/);
    });

    // -----------------------------------------------------------------------
    // (b) isWithoutLayout — Collection filter mirror of render-swig.js:494-498
    // -----------------------------------------------------------------------

    it('clones localTemplateConf via JSON.clone when isWithoutLayout is true', function () {
        // Without cloning, the Collection.find() overwrite of .javascripts
        // would mutate localOptions.template — dangerous across requests.
        var idx = RENDER_NJ_SRC.indexOf('isWithoutLayout = !!localOptions.isWithoutLayout');
        assert.ok(idx > 0, 'isWithoutLayout locals present');
        var block = RENDER_NJ_SRC.slice(idx, idx + 800);
        assert.match(block, /JSON\.clone\(localTemplateConf\)/);
    });

    it('filters javascripts via Collection.find({isCommon: false}, {isCommon: true, name: "gina"})', function () {
        // The OR-clause mirrors render-swig.js:496 — keep all non-common
        // assets PLUS the common gina loader, drop other common assets.
        assert.match(
            RENDER_NJ_SRC,
            /new\s+Collection\(localTemplateConf\.javascripts\)[\s\S]{0,80}\.find\(\s*\{\s*isCommon:\s*false\s*\}\s*,\s*\{\s*isCommon:\s*true\s*,\s*name:\s*['"]gina['"]\s*\}\s*\)/
        );
    });

    it('filters stylesheets via the same Collection.find OR-clause', function () {
        assert.match(
            RENDER_NJ_SRC,
            /new\s+Collection\(localTemplateConf\.stylesheets\)[\s\S]{0,80}\.find\(\s*\{\s*isCommon:\s*false\s*\}\s*,\s*\{\s*isCommon:\s*true\s*,\s*name:\s*['"]gina['"]\s*\}\s*\)/
        );
    });

    it('imports Collection via the lib registry (not a direct require of the sub-path)', function () {
        // lib registry form survives dev-mode hot-reload eviction of
        // lib/index.js. A direct require('../../lib/collection') would skip
        // that protection.
        assert.match(RENDER_NJ_SRC, /var\s+Collection\s*=\s*require\(\s*['"]\.\.\/\.\.\/lib['"]\s*\)\.Collection/);
    });

    // -----------------------------------------------------------------------
    // (c) injectAssets helper — shape + call-site
    // -----------------------------------------------------------------------

    it('declares the injectAssets helper as an inner function', function () {
        assert.match(RENDER_NJ_SRC, /function\s+injectAssets\s*\(\s*html\s*,\s*data\s*,\s*localOptions\s*\)/);
    });

    it('calls injectAssets BEFORE injectInspectorScripts in the main render function', function () {
        // Ordering matters — asset injection must settle the <head>/<body>
        // content before Inspector scripts are appended near </body> so the
        // Inspector payload sits last.
        var assetIdx = RENDER_NJ_SRC.indexOf('html = injectAssets(html, data, localOptions)');
        var inspIdx  = RENDER_NJ_SRC.indexOf('html = injectInspectorScripts(html, data, self, local, displayInspector)');
        assert.ok(assetIdx > 0, 'injectAssets call-site present');
        assert.ok(inspIdx > 0, 'injectInspectorScripts call-site present');
        assert.ok(assetIdx < inspIdx, 'injectAssets must run BEFORE injectInspectorScripts');
    });

    it('wraps the injectAssets call in try/catch so a mis-shaped template config never breaks rendering', function () {
        var idx = RENDER_NJ_SRC.indexOf('html = injectAssets(html, data, localOptions)');
        assert.ok(idx > 0);
        var block = RENDER_NJ_SRC.slice(idx, idx + 500);
        assert.match(block, /catch\s*\(\s*assetErr\s*\)/);
        assert.match(block, /\[render-nunjucks\]\s*asset injection skipped:/);
    });

    it('short-circuits on empty html input', function () {
        // Defensive — an empty body (e.g. HEAD responses or early exits)
        // must pass through unchanged.
        assert.match(RENDER_NJ_SRC, /if\s*\(\s*typeof\s+html\s*!==\s*['"]string['"]\s*\|\|\s*html\.length\s*===\s*0\s*\)\s*\{\s*return\s+html\s*;\s*\}/);
    });

    it('short-circuits when data.page.view is missing', function () {
        assert.match(RENDER_NJ_SRC, /if\s*\(\s*!data\s*\|\|\s*!data\.page\s*\|\|\s*!data\.page\.view\s*\)\s*\{\s*return\s+html\s*;\s*\}/);
    });

    // -----------------------------------------------------------------------
    // (d) injectAssets behaviour — exercised live
    // -----------------------------------------------------------------------

    // Resolve the delegate via the framework path so test isolation doesn't
    // fall through to a stale require.cache entry from another suite.
    var injectAssets;
    try {
        // The delegate is a module.exports async function — injectAssets is
        // an inner helper. Re-require in a sandbox-friendly way by reading
        // the source and evaluating in a vm context would be heavy; instead
        // we copy the helper to a tiny shim file created at test time.
        // The alternative is to test purely through source inspection, which
        // we already have above — behavioural tests are nice-to-have but not
        // required for source-inspection coverage.
    } catch (e) {
        injectAssets = null;
    }

    // Minimal behavioural smoke tests via an in-memory eval — keeps the
    // coverage honest (the helper is small + pure) without spinning a
    // full bundle.
    (function () {
        var RENDER_NJ_SRC_LOCAL = RENDER_NJ_SRC;
        var helperMatch = RENDER_NJ_SRC_LOCAL.match(
            /function\s+injectAssets\s*\([^\)]*\)\s*\{[\s\S]*?\n\}/
        );
        if (!helperMatch) {
            it('SKIP: could not extract injectAssets source for behavioural tests', function () {
                assert.ok(false, 'injectAssets helper not found in render-nunjucks.js');
            });
            return;
        }
        var helperSrc = helperMatch[0];
        // eslint-disable-next-line no-new-func
        var injectAssetsFn;
        try {
            injectAssetsFn = new Function(helperSrc + '\nreturn injectAssets;')();
        } catch (e) {
            it('SKIP: could not compile injectAssets for behavioural tests', function () {
                assert.ok(false, 'failed to compile injectAssets: ' + e.message);
            });
            return;
        }

        it('auto-injects stylesheets before </head> when user did not place the token', function () {
            var data = { page: { view: { stylesheets: '<link href="/a.css" rel="stylesheet">' } } };
            var out = injectAssetsFn('<html><head></head><body></body></html>', data, { template: {} });
            assert.match(out, /<link href="\/a\.css" rel="stylesheet">[\s\S]*<\/head>/);
            assert.ok(
                out.indexOf('<link href="/a.css" rel="stylesheet">') <
                    out.indexOf('</head>'),
                'stylesheet appears BEFORE </head>'
            );
        });

        it('skips stylesheet auto-inject when user placed the token in their template', function () {
            // User wrote `{{ page.view.stylesheets | safe }}` — nunjucks has
            // already rendered the string into the HTML. We detect by exact
            // substring match and skip.
            var stylesheets = '<link href="/app.css" rel="stylesheet">';
            var data = { page: { view: { stylesheets: stylesheets } } };
            var html = '<html><head><title>x</title>' + stylesheets + '</head><body></body></html>';
            var out = injectAssetsFn(html, data, { template: {} });
            // The string should appear exactly ONCE in the output.
            var matches = out.split(stylesheets).length - 1;
            assert.equal(matches, 1, 'stylesheets string must appear exactly once');
        });

        it('auto-injects scripts before </body> by default (non-defer mode)', function () {
            var data = { page: { view: { scripts: '<script src="/a.js"></script>' } } };
            var out = injectAssetsFn('<html><head></head><body></body></html>', data, { template: {} });
            assert.ok(out.indexOf('<script src="/a.js"></script>') > -1, 'scripts string injected');
            assert.ok(
                out.indexOf('<script src="/a.js"></script>') < out.indexOf('</body>'),
                'scripts appear BEFORE </body>'
            );
        });

        it('places scripts in <head> when javascriptsDeferEnabled is true', function () {
            var data = { page: { view: { scripts: '<script defer src="/a.js"></script>' } } };
            var out = injectAssetsFn(
                '<html><head></head><body></body></html>',
                data,
                { template: { javascriptsDeferEnabled: true } }
            );
            assert.ok(out.indexOf('<script defer src="/a.js"></script>') > -1, 'scripts string injected');
            assert.ok(
                out.indexOf('<script defer src="/a.js"></script>') < out.indexOf('</head>'),
                'defer mode: scripts appear BEFORE </head>'
            );
        });

        it('injects localOptions.template.ginaLoader before </head>', function () {
            var data = { page: { view: {} } };
            var loader = '<script>window.onGinaLoaded = function(){};</script>';
            var out = injectAssetsFn(
                '<html><head></head><body></body></html>',
                data,
                { template: { ginaLoader: loader } }
            );
            assert.match(out, /window\.onGinaLoaded[\s\S]*<\/head>/);
        });

        it('skips ginaLoader injection when javascriptsExcluded === "**"', function () {
            var data = { page: { view: {} } };
            var loader = '<script>window.onGinaLoaded = function(){};</script>';
            var out = injectAssetsFn(
                '<html><head></head><body></body></html>',
                data,
                { template: { ginaLoader: loader, javascriptsExcluded: '**' } }
            );
            assert.doesNotMatch(out, /window\.onGinaLoaded/);
        });

        it('skips ginaLoader injection when HTML already contains window.onGinaLoaded', function () {
            var data = { page: { view: {} } };
            var loader = '<script>window.onGinaLoaded = function(){};</script>';
            var html = '<html><head><script>/* window.onGinaLoaded already here */</script></head><body></body></html>';
            var out = injectAssetsFn(html, data, { template: { ginaLoader: loader } });
            // loader body must not be injected a second time
            var matches = out.split('<script>window.onGinaLoaded').length - 1;
            assert.equal(matches, 0, 'ginaLoader must not be duplicated');
        });

        it('injects external plugins (array, joined) before </head>', function () {
            var data = { page: { view: {} } };
            var out = injectAssetsFn(
                '<html><head></head><body></body></html>',
                data,
                { template: { externalPlugins: ['\n<script src="/jquery.js"></script>'] } }
            );
            assert.match(out, /<script src="\/jquery\.js"><\/script>[\s\S]*<\/head>/);
        });

        it('skips external plugins injection when the joined string already appears', function () {
            var extScript = '<script src="/jquery.js"></script>';
            var data = { page: { view: {} } };
            var html = '<html><head>' + extScript + '</head><body></body></html>';
            var out = injectAssetsFn(html, data, { template: { externalPlugins: [extScript] } });
            var matches = out.split(extScript).length - 1;
            assert.equal(matches, 1, 'externalPlugins string must appear exactly once');
        });

        it('is a no-op on fragments missing </head> and </body>', function () {
            // Partial renders / HEAD responses must pass through unchanged.
            var data = { page: { view: { stylesheets: '<link href="/a.css" rel="stylesheet">' } } };
            var frag = '<div>partial</div>';
            var out = injectAssetsFn(frag, data, { template: { ginaLoader: '<script>window.onGinaLoaded=0;</script>' } });
            assert.equal(out, frag);
        });
    })();

    // -----------------------------------------------------------------------
    // (e) top-of-file comment block — deferred #6 now marked shipped
    // -----------------------------------------------------------------------

    it('marks the setResources / asset-cataloguing deferred item as shipped', function () {
        // Mirror of the pattern used for items 1-3 (Inspector / HTTP/2 /
        // error-page). A future regression must force explicit re-docs.
        assert.match(RENDER_NJ_SRC, /[Aa]sset cataloguing[\s\S]{0,120}shipped/);
        assert.match(RENDER_NJ_SRC, /#NJ2/);
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

    it('#NJ2 — render-nunjucks.js does NOT hard-code any asset URL (uses setResources output verbatim)', function () {
        // Any hardcoded `/dist/gina.min.css` or similar would break custom
        // bundle asset paths. All asset URLs must flow through setResources.
        assert.doesNotMatch(RENDER_NJ_SRC, /\/dist\/gina(?:\.min)?\.(?:css|js)/);
    });
});
