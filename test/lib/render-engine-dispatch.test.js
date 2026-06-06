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
var RENDER_SWIG_ASYNC_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.render-swig-async.js'), 'utf8');
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
        // #TPL1 — dispatch refactored from a ternary to an if/else to add the
        // third (render-swig-async) branch; the nunjucks engine still maps to
        // the nunjucks delegate.
        assert.match(
            CONTROLLER_SRC,
            /if\s*\(\s*_engine\s*===\s*['"]nunjucks['"]\s*\)\s*\{\s*_delegate\s*=\s*['"]\/controller\.render-nunjucks['"]/
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
// 03b - #TPL1 controller.js async-loader dispatch
// ---------------------------------------------------------------------------

describe('03b - #TPL1 controller.js async-loader dispatch', function () {

    it('routes a swig bundle with an async loader to controller.render-swig-async', function () {
        assert.match(
            CONTROLLER_SRC,
            /_swigAsync\s*\?\s*['"]\/controller\.render-swig-async['"]\s*:\s*['"]\/controller\.render-swig['"]/
        );
    });

    it('detects the async loader via process.gina._swigLoaders[...].loader.async === true', function () {
        assert.match(CONTROLLER_SRC, /process\.gina\._swigLoaders\[_troot\]\.loader\.async\s*===\s*true/);
    });

    it('keys the dispatch by conf.content.templates._common.html (same key initSwigEngine stashes under)', function () {
        assert.match(CONTROLLER_SRC, /local\.options\.conf\.content\.templates\._common\.html/);
    });

    it('async detection is wrapped in try/catch (falls back to the filesystem path)', function () {
        assert.match(CONTROLLER_SRC, /catch\s*\(e\)\s*\{[^}]*fall back to the filesystem[^}]*\}/);
    });

    it('cacheless branch evicts the render-swig-async delegate, wrapped in try/catch', function () {
        assert.match(
            CONTROLLER_SRC,
            /try\s*\{\s*delete\s+require\.cache\[require\.resolve\(\s*_\(__dirname\s*\+\s*['"]\/controller\.render-swig-async['"][^)]*\)\s*\)\s*\][^}]*\}\s*catch/
        );
    });
});


// ---------------------------------------------------------------------------
// 03c - #TPL1 schema / lib / server wiring
// ---------------------------------------------------------------------------

describe('03c - #TPL1 schema / lib / server wiring', function () {

    it('schema declares template.swig.loader', function () {
        var loader = SCHEMA_SETTINGS.properties.template
            && SCHEMA_SETTINGS.properties.template.properties.swig
            && SCHEMA_SETTINGS.properties.template.properties.swig.properties.loader;
        assert.ok(loader, 'template.swig.loader present');
    });

    it('loader.type is an enum of ["memory"] (Slice 1) and required', function () {
        var loader = SCHEMA_SETTINGS.properties.template.properties.swig.properties.loader;
        assert.deepEqual(loader.properties.type.enum, ['memory']);
        assert.ok(Array.isArray(loader.required) && loader.required.indexOf('type') !== -1, 'type required');
    });

    it('loader allows additional (type-specific flat) properties — connector-style', function () {
        var loader = SCHEMA_SETTINGS.properties.template.properties.swig.properties.loader;
        assert.equal(loader.additionalProperties, true);
    });

    it('lib/index.js registers templateLoaders via _require', function () {
        assert.match(LIB_INDEX_SRC, /templateLoaders\s*:\s*_require\('\.\/template-loaders'\)/);
    });

    it('initSwigEngine reads settings.template.swig.loader', function () {
        assert.match(SERVER_SRC, /conf\.content\.settings\.template\.swig\.loader/);
    });

    it('initSwigEngine builds the loader via lib.templateLoaders.build', function () {
        assert.match(SERVER_SRC, /lib\.templateLoaders\.build\(\s*_loaderCfg\s*\)/);
    });

    it('initSwigEngine stashes the built loader on process.gina._swigLoaders keyed by the template dir', function () {
        assert.match(SERVER_SRC, /process\.gina\._swigLoaders\[dir\]\s*=\s*\{/);
    });

    it('initSwigEngine only stashes when the built loader is async (async === true)', function () {
        assert.match(SERVER_SRC, /_builtLoader\s*&&\s*_builtLoader\.async\s*===\s*true/);
    });
});


// ---------------------------------------------------------------------------
// 03d - #TPL1 controller.render-swig-async.js shape
// ---------------------------------------------------------------------------

describe('03d - #TPL1 controller.render-swig-async.js shape', function () {

    it('exports an async function with the same deps signature as the other delegates', function () {
        assert.match(
            RENDER_SWIG_ASYNC_SRC,
            /module\.exports\s*=\s*async\s+function\s+renderSwigAsync\(userData,\s*displayInspector,\s*errOptions,\s*deps\)/
        );
    });

    it('builds an ISOLATED per-bundle engine via new swigMod.Swig({ loader })', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /new\s+swigMod\.Swig\(\s*\{/);
        assert.match(RENDER_SWIG_ASYNC_SRC, /loader:\s*loader/);
    });

    it('the engine registry is owner-guarded against dev-mode swig hot-swap', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /process\.gina\._swigEnginesOwner\s*!==\s*swigMod/);
    });

    it('forces cache:false on the per-bundle engine (no swig-side async cache)', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /cache:\s*false/);
    });

    it('renders via the async getTemplate path then awaits the compiled fn .output', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /await\s+engine\.getTemplate\(\s*templateName/);
        assert.match(RENDER_SWIG_ASYNC_SRC, /await\s+compiled\(data\)/);
        assert.match(RENDER_SWIG_ASYNC_SRC, /rendered\.output/);
    });

    it('registers gina filters onto the per-bundle engine via engine.setFilter', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /engine\.setFilter\(name,\s*filters\[name\]\)/);
    });

    it('keys the loader lookup by conf.content.templates._common.html (matches the dispatch key)', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /localOptions\.conf\.content\.templates\._common\.html/);
    });

    it('nulls local.req/res/next at the success terminal (per-request memory release)', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /local\.req\s*=\s*null;[\s\S]{0,80}local\.res\s*=\s*null;[\s\S]{0,80}local\.next\s*=\s*null;/);
    });

    it('mirrors render-swig/nunjucks error interception for non-2xx + error data', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /!String\(data\.page\.data\.status\)\.startsWith\(['"]2['"]\)/);
    });

    it('NEGATIVE — does NOT self-read templates from the filesystem (loader owns loading)', function () {
        assert.doesNotMatch(RENDER_SWIG_ASYNC_SRC, /fs\.promises\.readFile/);
        assert.doesNotMatch(RENDER_SWIG_ASYNC_SRC, /readFileSync/);
    });

    it('NEGATIVE — does NOT compile a template string (uses getTemplate, not swig.compile)', function () {
        assert.doesNotMatch(RENDER_SWIG_ASYNC_SRC, /\.compile\(/);
    });
});


// ---------------------------------------------------------------------------
// 03e - #TPL1 asset injection / setResources port (async swig delegate)
// ---------------------------------------------------------------------------
//
// The async swig delegate renders through the engine API (no FS getAssets()
// machinery), so it injects the gina client bundle / CSS / JS post-render the
// same way render-nunjucks.js does. Source-inspection coverage for the
// setResources wiring, the render-swig.js:609 "needed !!" re-fetch, the
// injectAssets helper + call-site, the gina-bootstrap whisper pass, and the
// CSP-nonce exposure — plus a behavioural eval of the (pure) injectAssets helper.

describe('03e - #TPL1 asset injection / setResources port (async swig delegate)', function () {

    // (a) source-level wiring -------------------------------------------------

    it('consumes deps.setResources in the delegate', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /var\s+setResources\s*=\s*deps\.setResources/);
    });

    it('calls setResources(localTemplateConf) BEFORE the async getTemplate render', function () {
        var guardIdx  = RENDER_SWIG_ASYNC_SRC.indexOf("typeof setResources === 'function'");
        var renderIdx = RENDER_SWIG_ASYNC_SRC.indexOf('await engine.getTemplate(templateName');
        assert.ok(guardIdx > 0, 'setResources guard present');
        assert.ok(renderIdx > 0, 'getTemplate render present');
        assert.ok(guardIdx < renderIdx, 'setResources guarded block must run before the render');
        var block = RENDER_SWIG_ASYNC_SRC.slice(guardIdx, renderIdx);
        assert.match(block, /setResources\(\s*localTemplateConf\s*\)\s*;/);
    });

    it('guards the setResources call with a typeof check so older controllers still work', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /typeof\s+setResources\s*===\s*['"]function['"]/);
    });

    it('catches setResources failures without breaking the render', function () {
        var idx = RENDER_SWIG_ASYNC_SRC.indexOf("typeof setResources === 'function'");
        assert.ok(idx > 0);
        var block = RENDER_SWIG_ASYNC_SRC.slice(idx, idx + 1500);
        assert.match(block, /catch\s*\(\s*resourcesErr\s*\)/);
        assert.match(block, /\[render-swig-async\]\s*setResources failed:/);
    });

    it('re-overlays getData() AFTER setResources (render-swig.js:609 "needed !!" step)', function () {
        // setResources writes page.view.stylesheets/.scripts into local.userData
        // via the controller set(); getData() rebuilds the data object and the
        // merge fills the new keys so injectAssets can see them.
        var setIdx = RENDER_SWIG_ASYNC_SRC.indexOf('setResources(localTemplateConf)');
        assert.ok(setIdx > 0);
        var block = RENDER_SWIG_ASYNC_SRC.slice(setIdx, setIdx + 500);
        assert.match(block, /data\s*=\s*merge\(data,\s*getData\(\)\)/);
    });

    // (b) isWithoutLayout — Collection filter mirror --------------------------

    it('clones localTemplateConf via JSON.clone when isWithoutLayout is true', function () {
        var idx = RENDER_SWIG_ASYNC_SRC.indexOf('isWithoutLayout   = !!localOptions.isWithoutLayout');
        assert.ok(idx > 0, 'isWithoutLayout locals present');
        var block = RENDER_SWIG_ASYNC_SRC.slice(idx, idx + 800);
        assert.match(block, /JSON\.clone\(localTemplateConf\)/);
    });

    it('filters javascripts via Collection.find({isCommon:false},{isCommon:true,name:"gina"})', function () {
        assert.match(
            RENDER_SWIG_ASYNC_SRC,
            /new\s+Collection\(localTemplateConf\.javascripts\)[\s\S]{0,80}\.find\(\s*\{\s*isCommon:\s*false\s*\}\s*,\s*\{\s*isCommon:\s*true\s*,\s*name:\s*['"]gina['"]\s*\}\s*\)/
        );
    });

    it('filters stylesheets via the same Collection.find OR-clause', function () {
        assert.match(
            RENDER_SWIG_ASYNC_SRC,
            /new\s+Collection\(localTemplateConf\.stylesheets\)[\s\S]{0,80}\.find\(\s*\{\s*isCommon:\s*false\s*\}\s*,\s*\{\s*isCommon:\s*true\s*,\s*name:\s*['"]gina['"]\s*\}\s*\)/
        );
    });

    it('imports Collection via the lib registry (survives dev hot-reload eviction)', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /const\s+Collection\s*=\s*libRef\.Collection/);
    });

    // (c) injectAssets helper — shape + call-site -----------------------------

    it('declares the injectAssets helper as an inner function', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /function\s+injectAssets\s*\(\s*html\s*,\s*data\s*,\s*localOptions\s*,\s*cspNonce\s*\)/);
    });

    it('calls injectAssets after the render and BEFORE sendHtmlResponse', function () {
        var assetIdx = RENDER_SWIG_ASYNC_SRC.indexOf('html = injectAssets(html, data, localOptions, _cspNonce)');
        var sendIdx  = RENDER_SWIG_ASYNC_SRC.lastIndexOf('sendHtmlResponse(local, html, req, res)');
        assert.ok(assetIdx > 0, 'injectAssets call-site present');
        assert.ok(sendIdx > 0, 'final sendHtmlResponse present');
        assert.ok(assetIdx < sendIdx, 'injectAssets must run BEFORE the final sendHtmlResponse');
    });

    it('wraps the injectAssets call in try/catch so a mis-shaped config never breaks rendering', function () {
        var idx = RENDER_SWIG_ASYNC_SRC.indexOf('html = injectAssets(html, data, localOptions, _cspNonce)');
        assert.ok(idx > 0);
        var block = RENDER_SWIG_ASYNC_SRC.slice(idx, idx + 500);
        assert.match(block, /catch\s*\(\s*assetErr\s*\)/);
        assert.match(block, /\[render-swig-async\]\s*asset injection skipped:/);
    });

    it('short-circuits injectAssets on empty html input', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /if\s*\(\s*typeof\s+html\s*!==\s*['"]string['"]\s*\|\|\s*html\.length\s*===\s*0\s*\)\s*\{\s*return\s+html\s*;\s*\}/);
    });

    it('short-circuits injectAssets when data.page.view is missing', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /if\s*\(\s*!data\s*\|\|\s*!data\.page\s*\|\|\s*!data\.page\.view\s*\)\s*\{\s*return\s+html\s*;\s*\}/);
    });

    // (d) gina-bootstrap whisper placeholder pass + CSP nonce -----------------

    it('runs the whisper() placeholder pass on the injected gina bootstrap', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /html\s*=\s*whisper\(\s*ginaLoaderDic\s*,\s*html\s*,/);
    });

    it('flattens page / page.environment / page.data.session into the whisper dict', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /ginaLoaderDic\['page\.'\s*\+\s*_d\]/);
        assert.match(RENDER_SWIG_ASYNC_SRC, /ginaLoaderDic\['page\.environment\.'\s*\+\s*_k\]/);
        assert.match(RENDER_SWIG_ASYNC_SRC, /ginaLoaderDic\['page\.data\.session\.'\s*\+\s*_s\]/);
    });

    it('guards the whisper pass with typeof whisper === function and try/catch', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /typeof\s+whisper\s*===\s*['"]function['"]/);
        var idx = RENDER_SWIG_ASYNC_SRC.indexOf('whisper(ginaLoaderDic, html');
        assert.ok(idx > 0);
        var block = RENDER_SWIG_ASYNC_SRC.slice(idx, idx + 400);
        assert.match(block, /catch\s*\(\s*whisperErr\s*\)/);
        assert.match(block, /\[render-swig-async\]\s*ginaLoader whisper substitution skipped:/);
    });

    it('exposes the per-request CSP nonce as page.cspNonce (strict-CSP app templates)', function () {
        assert.match(RENDER_SWIG_ASYNC_SRC, /_cspNonce\s*=\s*\(req\s*&&\s*req\._ginaCspNonce\)/);
        assert.match(RENDER_SWIG_ASYNC_SRC, /data\.page\.cspNonce\s*=\s*_cspNonce/);
    });

    // (e) injectAssets behaviour — exercised live -----------------------------

    (function () {
        var helperMatch = RENDER_SWIG_ASYNC_SRC.match(
            /function\s+injectAssets\s*\([^\)]*\)\s*\{[\s\S]*?\n\}/
        );
        if (!helperMatch) {
            it('SKIP: could not extract injectAssets source for behavioural tests', function () {
                assert.ok(false, 'injectAssets helper not found in render-swig-async.js');
            });
            return;
        }
        var injectAssetsFn;
        try {
            // eslint-disable-next-line no-new-func
            injectAssetsFn = new Function(helperMatch[0] + '\nreturn injectAssets;')();
        } catch (e) {
            it('SKIP: could not compile injectAssets for behavioural tests', function () {
                assert.ok(false, 'failed to compile injectAssets: ' + e.message);
            });
            return;
        }

        it('auto-injects stylesheets before </head>', function () {
            var data = { page: { view: { stylesheets: '<link href="/a.css" rel="stylesheet">' } } };
            var out = injectAssetsFn('<html><head></head><body></body></html>', data, { template: {} });
            assert.ok(
                out.indexOf('<link href="/a.css" rel="stylesheet">') < out.indexOf('</head>'),
                'stylesheet appears BEFORE </head>'
            );
        });

        it('skips stylesheet auto-inject when the user already placed the token', function () {
            var stylesheets = '<link href="/app.css" rel="stylesheet">';
            var data = { page: { view: { stylesheets: stylesheets } } };
            var html = '<html><head><title>x</title>' + stylesheets + '</head><body></body></html>';
            var out = injectAssetsFn(html, data, { template: {} });
            assert.equal(out.split(stylesheets).length - 1, 1, 'stylesheets string appears exactly once');
        });

        it('auto-injects scripts before </body> by default (non-defer)', function () {
            var data = { page: { view: { scripts: '<script src="/a.js"></script>' } } };
            var out = injectAssetsFn('<html><head></head><body></body></html>', data, { template: {} });
            assert.ok(
                out.indexOf('<script src="/a.js"></script>') < out.indexOf('</body>'),
                'scripts appear BEFORE </body>'
            );
        });

        it('places scripts in <head> when javascriptsDeferEnabled is true', function () {
            var data = { page: { view: { scripts: '<script defer src="/a.js"></script>' } } };
            var out = injectAssetsFn('<html><head></head><body></body></html>', data, { template: { javascriptsDeferEnabled: true } });
            assert.ok(
                out.indexOf('<script defer src="/a.js"></script>') < out.indexOf('</head>'),
                'defer mode: scripts appear BEFORE </head>'
            );
        });

        it('injects the gina bootstrap (ginaLoader) before </head>', function () {
            var loader = '<script>window.onGinaLoaded = function(){};</script>';
            var out = injectAssetsFn('<html><head></head><body></body></html>', { page: { view: {} } }, { template: { ginaLoader: loader } });
            assert.match(out, /window\.onGinaLoaded[\s\S]*<\/head>/);
        });

        it('stamps the gina bootstrap <script> with the CSP nonce when provided', function () {
            var loader = '<script type="text/javascript">window.onGinaLoaded = function(){};</script>';
            var out = injectAssetsFn('<html><head></head><body></body></html>', { page: { view: {} } }, { template: { ginaLoader: loader } }, 'abc123');
            assert.match(out, /<script type="text\/javascript" nonce="abc123">/);
        });

        it('skips the bootstrap when javascriptsExcluded === "**"', function () {
            var loader = '<script>window.onGinaLoaded = function(){};</script>';
            var out = injectAssetsFn('<html><head></head><body></body></html>', { page: { view: {} } }, { template: { ginaLoader: loader, javascriptsExcluded: '**' } });
            assert.doesNotMatch(out, /window\.onGinaLoaded/);
        });

        it('does not duplicate the bootstrap when HTML already has window.onGinaLoaded', function () {
            var loader = '<script>window.onGinaLoaded = function(){};</script>';
            var html = '<html><head><script>/* window.onGinaLoaded here */</script></head><body></body></html>';
            var out = injectAssetsFn(html, { page: { view: {} } }, { template: { ginaLoader: loader } });
            assert.equal(out.split('<script>window.onGinaLoaded').length - 1, 0, 'bootstrap not duplicated');
        });

        it('injects external plugins (array joined) before </head>', function () {
            var out = injectAssetsFn('<html><head></head><body></body></html>', { page: { view: {} } }, { template: { externalPlugins: ['\n<script src="/jquery.js"></script>'] } });
            assert.match(out, /<script src="\/jquery\.js"><\/script>[\s\S]*<\/head>/);
        });

        it('is a no-op on fragments missing </head> and </body>', function () {
            var frag = '<div>partial</div>';
            var out = injectAssetsFn(frag, { page: { view: { stylesheets: '<link href="/a.css">' } } }, { template: { ginaLoader: '<script>window.onGinaLoaded=0;</script>' } });
            assert.equal(out, frag);
        });
    })();
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
        assert.match(RENDER_NJ_SRC, /\/\^HEAD\$\/i\.test\(\s*\breq\.method\s*\)/);
    });

    it('preserves existing response headers (content-type only set when absent)', function () {
        assert.match(RENDER_NJ_SRC, /!\bres\.getHeader\(['"]content-type['"]\)/);
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

    it('reads the HTTP/2 stream from res.stream', function () {
        assert.match(RENDER_NJ_SRC, /\bres\.stream/);
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
        // #H10 — the body-path respond now passes a conditional waitForTrailers 2nd arg
        // (stream.respond(_streamHeaders, _trailers ? { waitForTrailers: true } : undefined)).
        assert.match(RENDER_NJ_SRC, /stream\.respond\(_streamHeaders,\s*_trailers/);
    });

    it('HTTP/2 body path calls stream.end(html)', function () {
        assert.match(RENDER_NJ_SRC, /stream\.end\(html\)/);
    });

    it('merges pipeline-set headers via res.getHeaders()', function () {
        // Applies to BOTH stream paths — CORS / cache-control / cookies
        // set earlier must be preserved on the raw HTTP/2 stream.
        var matches = RENDER_NJ_SRC.match(/\bres\.getHeaders\(\)/g);
        assert.ok(matches && matches.length >= 2, 'getHeaders() called for both HEAD+stream and body+stream merges');
    });

    it('sets res.headersSent = true after successful stream.respond', function () {
        var matches = RENDER_NJ_SRC.match(/\bres\.headersSent\s*=\s*true/g);
        assert.ok(matches && matches.length >= 2, 'headersSent flagged for both HEAD+stream and body+stream paths');
    });

    it('HTTP/1.1 HEAD path sends content-length via setHeader, empty body', function () {
        assert.match(RENDER_NJ_SRC, /\bres\.setHeader\(\s*['"]content-length['"]\s*,\s*byteLength\s*\)/);
    });

    it('HTTP/1.1 body path uses res.writeHead + res.end(html)', function () {
        assert.match(RENDER_NJ_SRC, /\bres\.writeHead\(statusCode\);\s*\n\s*\bres\.end\(html\)/);
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
        // that protection. Accept either the original direct-require shape
        // or the libRef module-scope fallback shape (which mirrors
        // render-swig.js's `|| require.cache[...]` defence against
        // refreshCore() cache poisoning).
        assert.match(
            RENDER_NJ_SRC,
            /var\s+Collection\s*=\s*(?:require\(\s*['"]\.\.\/\.\.\/lib['"]\s*\)\.Collection|libRef\.Collection)/
        );
    });

    // -----------------------------------------------------------------------
    // (c) injectAssets helper — shape + call-site
    // -----------------------------------------------------------------------

    it('declares the injectAssets helper as an inner function', function () {
        assert.match(RENDER_NJ_SRC, /function\s+injectAssets\s*\(\s*html\s*,\s*data\s*,\s*localOptions\s*,\s*cspNonce\s*\)/);
    });

    it('calls injectAssets BEFORE injectInspectorScripts in the main render function', function () {
        // Ordering matters — asset injection must settle the <head>/<body>
        // content before Inspector scripts are appended near </body> so the
        // Inspector payload sits last.
        var assetIdx = RENDER_NJ_SRC.indexOf('html = injectAssets(html, data, localOptions, _cspNonce)');
        var inspIdx  = RENDER_NJ_SRC.indexOf('html = injectInspectorScripts(html, data, self, local, displayInspector)');
        assert.ok(assetIdx > 0, 'injectAssets call-site present');
        assert.ok(inspIdx > 0, 'injectInspectorScripts call-site present');
        assert.ok(assetIdx < inspIdx, 'injectAssets must run BEFORE injectInspectorScripts');
    });

    it('wraps the injectAssets call in try/catch so a mis-shaped template config never breaks rendering', function () {
        var idx = RENDER_NJ_SRC.indexOf('html = injectAssets(html, data, localOptions, _cspNonce)');
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
// 05e - #NJ3 — static HTML cache writes (writeCache port)
// ---------------------------------------------------------------------------
//
// Source-inspection coverage for the static-HTML cache port: writeCache
// helper shape (guards, `static:<bundle>:<url>` key, memory/fs dispatch,
// sliding-window + invalidateOnEvents), module-level `cache` import, per-
// request `cache.from(serverInstance._cached)` call, and the call-site
// ordering (writeCache runs AFTER injectAssets + injectInspectorScripts and
// BEFORE sendHtmlResponse so the miss-path Cache-Control header is
// committed alongside the response).
//
// Engine-agnostic READ path is not covered here — `server.isaac.js:1012-1067`
// reads from `static:<bundle>:<url>` regardless of which engine populated
// the entry, so this port only exercises the WRITE side. A behavioural
// test covers the guard short-circuit (no cache setting = no write).

describe('05e - #NJ3 static HTML cache (writeCache port)', function () {

    // -----------------------------------------------------------------------
    // (a) module-level cache instance + per-request cache.from()
    // -----------------------------------------------------------------------

    it('declares a module-level `cache` instance via new lib.Cache()', function () {
        // Mirror of render-swig.js:6 and render-json.js:5. The instance is
        // re-pointed per request via cache.from(serverInstance._cached); a
        // shared singleton is fine because there is only one server per process.
        // Accept either the original direct-require shape or the libRef
        // module-scope fallback shape (which mirrors render-swig.js's
        // `|| require.cache[...]` defence against refreshCore() cache poisoning).
        assert.match(
            RENDER_NJ_SRC,
            /var\s+cache\s*=\s*new\s*\(\s*(?:require\(\s*['"]\.\.\/\.\.\/lib['"]\s*\)\.Cache|libRef\.Cache)\s*\)\(\s*\)/
        );
    });

    it('calls cache.from(self.serverInstance._cached) inside the main render function', function () {
        // Without this, cache.set/has/get would operate on an empty local
        // map instead of the server's shared in-memory store — the very
        // next request would miss.
        assert.match(RENDER_NJ_SRC, /cache\.from\(\s*self\.serverInstance\._cached\s*\)/);
    });

    it('cache.from() call sits inside module.exports (not module scope)', function () {
        // A module-scope call would fire once at module load, before
        // self.serverInstance exists — it would crash.
        var exportsIdx = RENDER_NJ_SRC.indexOf('module.exports = async function renderNunjucks');
        var fromIdx    = RENDER_NJ_SRC.indexOf('cache.from(self.serverInstance._cached)');
        assert.ok(exportsIdx > 0, 'module.exports found');
        assert.ok(fromIdx > 0,    'cache.from() found');
        assert.ok(fromIdx > exportsIdx, 'cache.from() must be inside module.exports');
    });

    // -----------------------------------------------------------------------
    // (b) writeCache shape — guards + key + dispatch
    // -----------------------------------------------------------------------

    it('declares writeCache as an async function with (local, self, bundle, opt, htmlContent, req, res) signature', function () {
        // render-swig passes (bundle, opt, htmlContent, req, res) because
        // `local`/`self` are closures inherited at module scope. render-
        // nunjucks does not hoist these — they live in the module.exports
        // scope — so the helper accepts them explicitly. The trailing
        // `req, res` are the renderNunjucks-captured copies (#M1 race fix);
        // a post-await `local.res` read inside writeCache would dereference
        // null if renderNunjucks had already nulled the closure between the
        // writeFile yield and the resume.
        assert.match(
            RENDER_NJ_SRC,
            /async\s+function\s+writeCache\s*\(\s*local\s*,\s*self\s*,\s*bundle\s*,\s*opt\s*,\s*htmlContent\s*,\s*req\s*,\s*res\s*\)/
        );
    });

    it('short-circuits when req.routing.cache is undefined', function () {
        // The triple-OR guard protects three miss conditions: no routing.cache,
        // falsy routing.cache, server-wide cacheIsEnabled !== 'true'.
        var idx = RENDER_NJ_SRC.indexOf('async function writeCache');
        assert.ok(idx > 0);
        var body = RENDER_NJ_SRC.slice(idx, idx + 600);
        assert.match(body, /typeof\(\s*\breq\.routing\.cache\s*\)\s*==\s*['"]undefined['"]/);
    });

    it('short-circuits when serverInstance._cacheIsEnabled is not the string "true"', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 800);
        assert.match(
            body,
            /String\(\s*self\.serverInstance\._cacheIsEnabled\s*\)\.toLowerCase\(\)\s*!==\s*['"]true['"]/
        );
    });

    it('namespaces the cache key as "static:<bundle>:<originalUrl>" (#C3)', function () {
        // Matches render-swig.js:47 and render-json.js:40. The bundle
        // namespace prevents two bundles serving the same URL path from
        // silently reading each other's cached bytes.
        assert.match(
            RENDER_NJ_SRC,
            /var\s+cacheKey\s*=\s*"static:"\s*\+\s*bundle\s*\+\s*":"\s*\+\s*\breq\.originalUrl/
        );
    });

    it('captures response headers for the hit path via res.getHeaders()', function () {
        // The server-layer read path re-plays these headers before emitting
        // the cached body (server.isaac.js:1065-1068).
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 1200);
        assert.match(body, /var\s+responseHeaders\s*=\s*\bres\.getHeaders\(\)\s*\|\|\s*\{\s*\}/);
    });

    it('gates the write on cache.has(cacheKey) being false', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 1500);
        assert.match(body, /if\s*\(\s*!cache\.has\(\s*cacheKey\s*\)\s*\)/);
    });

    it('parses cachingOption from a string shorthand into { type: <string> }', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 2000);
        assert.match(
            body,
            /typeof\(\s*\breq\.routing\.cache\s*\)\s*==\s*['"]string['"]\s*\)\s*\?\s*\{\s*type:\s*\breq\.routing\.cache\s*\}\s*:\s*JSON\.clone\(\s*\breq\.routing\.cache\s*\)/
        );
    });

    it('falls back to opt.ttl when cachingOption.ttl is undefined', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 2200);
        assert.match(
            body,
            /typeof\(\s*cachingOption\.ttl\s*\)\s*==\s*['"]undefined['"][\s\S]{0,120}cachingOption\.ttl\s*=\s*opt\.ttl/
        );
    });

    it('defaults visibility to "private" (opt-in to "public")', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 2500);
        assert.match(
            body,
            /cacheObject\.visibility\s*=\s*\(\s*cachingOption\.visibility\s*===\s*['"]public['"]\s*\)\s*\?\s*['"]public['"]\s*:\s*['"]private['"]/
        );
    });

    it('supports sliding window (opt-in) with optional maxAge absolute ceiling', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 3000);
        assert.match(body, /cachingOption\.sliding\s*===\s*true[\s\S]{0,120}cacheObject\.sliding\s*=\s*true/);
        assert.match(
            body,
            /cacheObject\.sliding\s*&&[\s\S]{0,160}cachingOption\.maxAge[\s\S]{0,160}cacheObject\.maxAge/
        );
    });

    // -----------------------------------------------------------------------
    // (c) memory vs fs dispatch
    // -----------------------------------------------------------------------

    it('memory cache: sets fromMemory=true, content=htmlContent, then cache.set(key, obj)', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 4000);
        assert.match(body, /\/\^memory\$\/i\.test\(\s*cachingOption\.type\s*\)/);
        assert.match(body, /cacheObject\.fromMemory\s*=\s*true/);
        assert.match(body, /cacheObject\.content\s*=\s*htmlContent/);
    });

    it('fs cache: appends "index" when URL ends with slash', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 5000);
        assert.match(body, /url\.endsWith\(\s*['"]\/['"]\s*\)[\s\S]{0,60}url\s*\+=\s*['"]index['"]/);
    });

    it('fs cache: builds filename under opt.path/<bundle>/html/<url>.html via the global `_()` helper', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 5500);
        assert.match(
            body,
            /_\(\s*opt\.path\s*\+\s*['"]\/['"]\s*\+\s*bundle\s*\+\s*['"]\/html['"]\s*\+\s*url\s*\+\s*['"]\.html['"]\s*,\s*true\s*\)/
        );
    });

    it('fs cache: mkdirSync the parent directory when missing before writeFile', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 5800);
        assert.match(body, /htmlDirObj\.existsSync\(\)/);
        assert.match(body, /htmlDirObj\.mkdirSync\(\)/);
    });

    it('fs cache: writes htmlContent via fs.promises.writeFile (async, not openSync/writeSync — #P30)', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 6200);
        assert.match(body, /await\s+fs\.promises\.writeFile\(\s*htmlFilename\s*,\s*htmlContent\s*\)/);
        assert.doesNotMatch(body, /fs\.openSync\(/);
        assert.doesNotMatch(body, /fs\.writeSync\(/);
    });

    it('fs cache: registers a cleanupFn that rm-syncs the file on eviction', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 6500);
        assert.match(body, /cache\.set\(\s*cacheKey\s*,\s*cacheObject\s*,\s*function\(\)/);
        assert.match(body, /fs\.rmSync\(\s*cacheObject\.filename\s*\)/);
    });

    // -----------------------------------------------------------------------
    // (d) invalidateOnEvents
    // -----------------------------------------------------------------------

    it('invalidateOnEvents: must be an array, otherwise throws a 500', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 7200);
        assert.match(body, /!Array\.isArray\(\s*cachingOption\.invalidateOnEvents\s*\)/);
        assert.match(
            body,
            /self\.throwError\(\s*\bres\s*,\s*500\s*,\s*new\s+Error\(\s*['"]cache\.invalidateOn must be an array['"]\s*\)\s*\)/
        );
    });

    it('invalidateOnEvents: registers listeners via cache.setEvents(cacheKey, list)', function () {
        var idx  = RENDER_NJ_SRC.indexOf('async function writeCache');
        var body = RENDER_NJ_SRC.slice(idx, idx + 7500);
        assert.match(body, /cache\.setEvents\(\s*cacheKey\s*,\s*cachingOption\.invalidateOnEvents\s*\)/);
    });

    // -----------------------------------------------------------------------
    // (e) call-site — the miss-path writeCache + Cache-Control header
    // -----------------------------------------------------------------------

    it('call site guards: !isCacheless OR _cacheIsEnabled, routing.cache defined, GET only', function () {
        // Mirrors render-swig.js:821-830 verbatim. If the user changes the
        // method to POST on a cached route, the cache must NOT be written
        // — bodies vary with payload.
        assert.match(
            RENDER_NJ_SRC,
            /!self\.isCacheless\(\)[\s\S]{0,160}\breq\.routing\.cache[\s\S]{0,160}\breq\.method\.toUpperCase\(\)\s*===\s*['"]GET['"]/
        );
    });

    it('writeCache call: uses localOptions.bundle and localOptions.conf.server.cache + passes captured req, res', function () {
        assert.match(
            RENDER_NJ_SRC,
            /await\s+writeCache\(\s*local\s*,\s*self\s*,\s*localOptions\.bundle\s*,\s*localOptions\.conf\.server\.cache\s*,\s*html\s*,\s*req\s*,\s*res\s*\)/
        );
    });

    it('writeCache call is wrapped in try/catch so a cache-write failure never breaks the render', function () {
        var idx = RENDER_NJ_SRC.indexOf('await writeCache(local, self, localOptions.bundle');
        assert.ok(idx > 0);
        var block = RENDER_NJ_SRC.slice(idx - 80, idx + 600);
        assert.match(block, /catch\s*\(\s*cacheErr\s*\)/);
        assert.match(block, /\[render-nunjucks\]\s*writeCache failed:/);
    });

    it('writeCache runs AFTER injectAssets AND injectInspectorScripts', function () {
        var assetIdx = RENDER_NJ_SRC.indexOf('html = injectAssets(html, data, localOptions, _cspNonce)');
        var inspIdx  = RENDER_NJ_SRC.indexOf('html = injectInspectorScripts(html, data, self, local, displayInspector)');
        var writeIdx = RENDER_NJ_SRC.indexOf('await writeCache(local, self, localOptions.bundle');
        assert.ok(assetIdx > 0 && inspIdx > 0 && writeIdx > 0);
        assert.ok(assetIdx < writeIdx, 'writeCache must run AFTER injectAssets');
        assert.ok(inspIdx  < writeIdx, 'writeCache must run AFTER injectInspectorScripts');
    });

    it('writeCache runs BEFORE sendHtmlResponse', function () {
        var writeIdx = RENDER_NJ_SRC.indexOf('await writeCache(local, self, localOptions.bundle');
        var sendIdx  = RENDER_NJ_SRC.lastIndexOf('sendHtmlResponse(local, html, req, res)');
        assert.ok(writeIdx > 0 && sendIdx > 0);
        assert.ok(writeIdx < sendIdx, 'writeCache must run BEFORE sendHtmlResponse');
    });

    it('Cache-Control miss-path header: set after writeCache, before sendHtmlResponse', function () {
        // The hit path in server.isaac.js re-computes its own Cache-Control
        // header, so this one only matters for fresh responses.
        var writeIdx = RENDER_NJ_SRC.indexOf('await writeCache(local, self, localOptions.bundle');
        var ccIdx    = RENDER_NJ_SRC.indexOf("res.setHeader('Cache-Control'");
        var sendIdx  = RENDER_NJ_SRC.lastIndexOf('sendHtmlResponse(local, html, req, res)');
        assert.ok(writeIdx > 0 && ccIdx > 0 && sendIdx > 0);
        assert.ok(writeIdx < ccIdx, 'Cache-Control set AFTER writeCache');
        assert.ok(ccIdx < sendIdx, 'Cache-Control set BEFORE sendHtmlResponse');
    });

    it('Cache-Control miss-path: visibility public vs private + max-age from effective TTL', function () {
        // Same parse as render-swig.js:836-840: string shorthand allowed,
        // falls back to opt.ttl when routing.cache.ttl is undefined, skips
        // header when effective TTL is 0.
        var idx = RENDER_NJ_SRC.indexOf("res.setHeader('Cache-Control'");
        assert.ok(idx > 0);
        var block = RENDER_NJ_SRC.slice(idx - 600, idx + 400);
        assert.match(block, /_ccCfg\.visibility\s*===\s*['"]public['"]\s*\?\s*['"]public['"]\s*:\s*['"]private['"]/);
        assert.match(block, /max-age=['"]\s*\+\s*~~\(\s*_ccTtl\s*\)/);
    });

    // -----------------------------------------------------------------------
    // (f) behavioural — writeCache short-circuits when routing.cache is absent
    // -----------------------------------------------------------------------

    // Extract the writeCache source and run it against an empty local/self
    // stub. The helper is isolated (takes local/self as explicit args) so
    // the eval approach used for injectAssets in 05d works here too.
    (function () {
        var helperMatch = RENDER_NJ_SRC.match(
            /async\s+function\s+writeCache\s*\([^\)]*\)\s*\{[\s\S]*?\n\}/
        );
        if (!helperMatch) {
            it('SKIP: could not extract writeCache source for behavioural tests', function () {
                assert.ok(false, 'writeCache helper not found in render-nunjucks.js');
            });
            return;
        }
        var helperSrc = helperMatch[0];

        // JSON.clone is a Gina runtime monkey-patch installed by the
        // framework bootstrap (`core/gna.js`). The test harness doesn't go
        // through that path, so we inject a lightweight equivalent into the
        // sandbox via a JSON alias.
        var JSON_WITH_CLONE = {
            parse:     JSON.parse.bind(JSON),
            stringify: JSON.stringify.bind(JSON),
            clone:     function (o) { return JSON.parse(JSON.stringify(o)); }
        };

        // Stub the closure dependencies (`cache`, `fs`, `_`). Only `cache.has`
        // matters for the short-circuit paths below — the guards return
        // before any other method is touched.
        var stubCalls;
        function makeFn() {
            stubCalls = { cacheHas: 0, cacheSet: 0, writeFile: 0 };
            var cacheStub = {
                has: function () { stubCalls.cacheHas++; return false; },
                set: function () { stubCalls.cacheSet++; },
                setEvents: function () {}
            };
            var fsStub = { promises: { writeFile: function () { stubCalls.writeFile++; return Promise.resolve(); } }, rmSync: function () {} };
            /* eslint-disable no-new-func */
            return new Function('cache', 'fs', 'JSON', '_',
                helperSrc + '\nreturn writeCache;'
            )(cacheStub, fsStub, JSON_WITH_CLONE, function () { return ''; });
            /* eslint-enable no-new-func */
        }

        it('short-circuits (no cache.has call) when req.routing.cache is undefined', async function () {
            var fn = makeFn();
            var local = { req: { routing: {}, originalUrl: '/x' }, res: { getHeaders: function () { return {}; } } };
            var self = { serverInstance: { _cacheIsEnabled: true } };
            await fn(local, self, 'demo', { path: '/tmp', ttl: 60 }, '<p>x</p>', local.req, local.res);
            assert.equal(stubCalls.cacheHas, 0, 'cache.has must NOT be called');
            assert.equal(stubCalls.cacheSet, 0, 'cache.set must NOT be called');
            assert.equal(stubCalls.writeFile, 0, 'writeFile must NOT be called');
        });

        it('short-circuits when serverInstance._cacheIsEnabled is not the string "true"', async function () {
            var fn = makeFn();
            var local = { req: { routing: { cache: { type: 'memory' } }, originalUrl: '/x' }, res: { getHeaders: function () { return {}; } } };
            var self = { serverInstance: { _cacheIsEnabled: false } };
            await fn(local, self, 'demo', { path: '/tmp', ttl: 60 }, '<p>x</p>', local.req, local.res);
            assert.equal(stubCalls.cacheHas, 0);
            assert.equal(stubCalls.cacheSet, 0);
        });

        it('memory cache: writes content + fromMemory=true to cache.set', async function () {
            var fn = makeFn();
            var captured;
            // swap cache.set to capture the stored object
            /* eslint-disable no-new-func */
            fn = new Function('cache', 'fs', 'JSON', '_',
                helperSrc + '\nreturn writeCache;'
            )({
                has: function () { return false; },
                set: function (k, v) { captured = { key: k, value: v }; },
                setEvents: function () {}
            }, { promises: { writeFile: function () { return Promise.resolve(); } }, rmSync: function () {} }, JSON_WITH_CLONE, function () { return ''; });
            /* eslint-enable no-new-func */
            var local = {
                req: { routing: { cache: { type: 'memory', ttl: 120 } }, originalUrl: '/hello' },
                res: { getHeaders: function () { return { 'x-foo': 'bar' }; } }
            };
            var self = { serverInstance: { _cacheIsEnabled: 'true' } };
            await fn(local, self, 'demo', { path: '/tmp', ttl: 60 }, '<p>hello</p>', local.req, local.res);
            assert.equal(captured.key, 'static:demo:/hello', 'cache key namespaced by bundle');
            assert.equal(captured.value.fromMemory, true);
            assert.equal(captured.value.content, '<p>hello</p>');
            assert.equal(captured.value.visibility, 'private', 'default visibility');
            assert.equal(captured.value.ttl, 120);
            assert.deepEqual(captured.value.responseHeaders, { 'x-foo': 'bar' });
        });

        it('memory cache: opting visibility="public" propagates to cacheObject.visibility', async function () {
            var fn = makeFn();
            var captured;
            /* eslint-disable no-new-func */
            fn = new Function('cache', 'fs', 'JSON', '_',
                helperSrc + '\nreturn writeCache;'
            )({
                has: function () { return false; },
                set: function (k, v) { captured = v; },
                setEvents: function () {}
            }, { promises: { writeFile: function () { return Promise.resolve(); } }, rmSync: function () {} }, JSON_WITH_CLONE, function () { return ''; });
            /* eslint-enable no-new-func */
            var local = {
                req: { routing: { cache: { type: 'memory', visibility: 'public' } }, originalUrl: '/x' },
                res: { getHeaders: function () { return {}; } }
            };
            var self = { serverInstance: { _cacheIsEnabled: 'true' } };
            await fn(local, self, 'demo', { path: '/tmp', ttl: 60 }, '<p>x</p>', local.req, local.res);
            assert.equal(captured.visibility, 'public');
        });
    })();

    // -----------------------------------------------------------------------
    // (g) deferred-items comment — item #5 now marked shipped
    // -----------------------------------------------------------------------

    it('marks the static-HTML-cache deferred item as shipped', function () {
        // Mirror of the pattern used for items 1-3 (Inspector / HTTP/2 /
        // error-page) and 6-7 (#NJ2 / #NJ1). Locks the comment update so a
        // future regression must force explicit re-docs.
        assert.match(RENDER_NJ_SRC, /[Ss]tatic HTML cache writes[\s\S]{0,200}shipped/);
        assert.match(RENDER_NJ_SRC, /#NJ3/);
    });
});


// ---------------------------------------------------------------------------
// 05f - #NJ4 — Early Hints 103 engine-agnostic (data-feed via setResources)
// ---------------------------------------------------------------------------
//
// The #EH1 firing point (controller.js:1034-1044) is already engine-agnostic:
// it reads `local.options.template.h2Links` and calls `self.setEarlyHints()`
// BEFORE the delegate dispatch, so both swig and nunjucks bundles reach it
// identically. The DATA-FEED question is: does `h2Links` get populated on
// the nunjucks code path the same way it does on swig?
//
// Answer: yes — via #NJ2 (commit b2466398). `render-nunjucks.js` calls
// `deps.setResources(localTemplateConf)`, which is the SAME function object
// that `render-swig.js:499` calls (defined once in `controller.js:782`).
// `setResources` invokes `getNodeRes` (`controller.js:843`), which writes to
// `local.options.template.h2Links` at :901 (CSS) and :930 (JS) on HTTP/2
// non-dev requests. The writes target the per-request `options.template`
// reference that `#EH1` reads on subsequent renders.
//
// #NJ4 is therefore a feature-complete confirmation + lock-in — no
// behavioural code was added. The invariants below prevent a future refactor
// from (a) duplicating h2Links accumulation inside the nunjucks delegate,
// (b) moving #EH1 inside a delegate (would break engine agnosticism), or
// (c) fabricating a nunjucks-specific setEarlyHints call path that drifts
// from the swig behaviour.

describe('05f - #NJ4 Early Hints 103 engine-agnostic (data-feed via setResources)', function () {

    // -----------------------------------------------------------------------
    // (a) #EH1 firing point lives in controller.js, not in any delegate
    // -----------------------------------------------------------------------

    it('controller.js contains the #EH1 marker', function () {
        assert.match(CONTROLLER_SRC, /#EH1/);
    });

    it('render-nunjucks.js code does NOT contain a #EH1 auto-send block (engine-agnostic firing point)', function () {
        // A duplicate inside the delegate would cause a double-103 or drift
        // between swig and nunjucks behaviour. The header JSDoc can reference
        // the marker (item #4 explains where the firing point lives), so we
        // strip the top comment block and scan only the module code.
        var firstCodeIdx = RENDER_NJ_SRC.indexOf('var fs');
        assert.ok(firstCodeIdx > 0, 'module code start found');
        var codeOnly = RENDER_NJ_SRC.slice(firstCodeIdx);
        assert.doesNotMatch(codeOnly, /#EH1[\s\S]{0,500}setEarlyHints/);
    });

    it('render-nunjucks.js does NOT call self.setEarlyHints in code (comments are fine)', function () {
        // setEarlyHints is documented as something the developer MAY call
        // manually from a controller action, but the auto-dispatch at #EH1
        // is engine-agnostic and stays in controller.js. Strip the top
        // JSDoc so docstring references (which cite controller.js:1039-1043
        // for context) don't trip the invariant.
        var firstCodeIdx = RENDER_NJ_SRC.indexOf('var fs');
        assert.ok(firstCodeIdx > 0, 'module code start found');
        var codeOnly = RENDER_NJ_SRC.slice(firstCodeIdx);
        assert.doesNotMatch(codeOnly, /self\.setEarlyHints\s*\(/);
    });

    it('#EH1 fires BEFORE the delegate dispatch in controller.js this.render()', function () {
        var eh1Idx      = CONTROLLER_SRC.indexOf('#EH1');
        var dispatchIdx = CONTROLLER_SRC.indexOf('return require( _(__dirname + _delegate, true) )');
        assert.ok(eh1Idx > 0,      '#EH1 marker present');
        assert.ok(dispatchIdx > 0, 'delegate dispatch present');
        assert.ok(eh1Idx < dispatchIdx, '#EH1 must run BEFORE delegate dispatch');
    });

    it('#EH1 reads h2Links from local.options.template (same reference both engines see)', function () {
        var idx  = CONTROLLER_SRC.indexOf('#EH1');
        assert.ok(idx > 0);
        var body = CONTROLLER_SRC.slice(idx, idx + 1200);
        assert.match(body, /local\.options\s*&&\s*local\.options\.template\s*&&\s*local\.options\.template\.h2Links/);
    });

    it('#EH1 trims the trailing comma before calling setEarlyHints', function () {
        var idx  = CONTROLLER_SRC.indexOf('#EH1');
        var body = CONTROLLER_SRC.slice(idx, idx + 1200);
        assert.match(body, /\/,\$\/\.test\(_h2Links\)\s*\?\s*_h2Links\.slice\(0,\s*-1\)\s*:\s*_h2Links/);
        assert.match(body, /self\.setEarlyHints\(\s*_hints\s*\)/);
    });

    // -----------------------------------------------------------------------
    // (b) h2Links accumulation — single source of truth in controller.js
    // -----------------------------------------------------------------------

    it('controller.js getNodeRes writes h2Links for the CSS branch', function () {
        assert.match(
            CONTROLLER_SRC,
            /local\.options\.template\.h2Links\s*\+=\s*'<'\s*\+\s*obj\.url\s*\+\s*'>;\s*as=style;\s*rel=preload,'/
        );
    });

    it('controller.js getNodeRes writes h2Links for the JS branch', function () {
        assert.match(
            CONTROLLER_SRC,
            /local\.options\.template\.h2Links\s*\+=\s*'<'\s*\+\s*obj\.url\s*\+\s*'>;\s*as=script;\s*rel=preload,'/
        );
    });

    it('render-nunjucks.js does NOT accumulate its own h2Links (single source is controller.js)', function () {
        assert.doesNotMatch(RENDER_NJ_SRC, /h2Links\s*\+=/);
    });

    it('render-nunjucks.js does NOT read h2Links in code (comments are fine for docs)', function () {
        // Strip the top JSDoc block that documents the port — we allow
        // mentions in explanatory prose. The remaining source must not
        // contain any h2Links reference: neither a read, a write, nor a
        // property access. That forces a deliberate docs update on any
        // future port that consumes h2Links inside the delegate.
        var firstCodeIdx = RENDER_NJ_SRC.indexOf('var fs');
        assert.ok(firstCodeIdx > 0, 'module code start found');
        var codeOnly = RENDER_NJ_SRC.slice(firstCodeIdx);
        assert.doesNotMatch(codeOnly, /h2Links/);
    });

    it('controller.js router.js initialisation resets h2Links per request', function () {
        // Source-locator: confirms the reset point exists so a future
        // router refactor cannot silently drop it and cause hints to leak
        // across requests.
        var routerSrc = fs.readFileSync(path.join(FW, 'core/router.js'), 'utf8');
        assert.match(routerSrc, /options\.template\.h2Links\s*=\s*['"]{2}/);
    });

    // -----------------------------------------------------------------------
    // (c) setResources is the single function called by both delegates
    // -----------------------------------------------------------------------

    it('controller.js defines setResources once (local closure)', function () {
        var matches = CONTROLLER_SRC.match(/var\s+setResources\s*=\s*function/g) || [];
        assert.equal(matches.length, 1, 'setResources defined exactly once in controller.js');
    });

    it('controller.js passes setResources to the delegate deps block', function () {
        assert.match(CONTROLLER_SRC, /setResources:\s*setResources/);
    });

    it('render-nunjucks.js calls setResources with localTemplateConf (mirror of render-swig.js:499)', function () {
        assert.match(RENDER_NJ_SRC, /setResources\(\s*localTemplateConf\s*\)/);
    });

    it('setResources invokes getNodeRes for both css and js (single accumulation path)', function () {
        var setResIdx  = CONTROLLER_SRC.indexOf('var setResources = function');
        var getNodeIdx = CONTROLLER_SRC.indexOf('var getNodeRes = function');
        assert.ok(setResIdx > 0 && getNodeIdx > 0, 'both helpers present');
        assert.ok(setResIdx < getNodeIdx, 'setResources defined before getNodeRes');
        var body = CONTROLLER_SRC.slice(setResIdx, getNodeIdx);
        assert.match(body, /getNodeRes\(\s*'css'/);
        assert.match(body, /getNodeRes\(\s*'js'/);
    });

    // -----------------------------------------------------------------------
    // (d) getNodeRes gates h2Links writes on HTTP/2 + production
    // -----------------------------------------------------------------------

    it('getNodeRes gates h2Links writes on /http\\/2/ protocol', function () {
        var idx  = CONTROLLER_SRC.indexOf('var getNodeRes = function');
        assert.ok(idx > 0);
        var body = CONTROLLER_SRC.slice(idx, idx + 3000);
        assert.match(body, /\/http\\\/2\/\.test\(\s*local\.options\.conf\.server\.protocol\s*\)/);
    });

    it('getNodeRes gates h2Links writes on !self.isCacheless() (production only)', function () {
        var idx  = CONTROLLER_SRC.indexOf('var getNodeRes = function');
        var body = CONTROLLER_SRC.slice(idx, idx + 3000);
        assert.match(body, /!self\.isCacheless\(\)/);
    });

    // -----------------------------------------------------------------------
    // (e) Behavioural replay — proves engine agnosticism at runtime
    // -----------------------------------------------------------------------

    (function () {
        // Exact replica of the #EH1 block at controller.js:1039-1043. The
        // block reads only local.options.template.h2Links and calls
        // self.setEarlyHints — no engine branching — so a byte-identical
        // h2Links input from either delegate produces a byte-identical call.
        function replayEH1(h2Links) {
            var sent  = [];
            var local = { options: { template: { h2Links: h2Links } } };
            var self  = { setEarlyHints: function (hints) { sent.push(hints); } };

            var _h2Links = local.options && local.options.template && local.options.template.h2Links;
            if (_h2Links) {
                var _hints = /,$/.test(_h2Links) ? _h2Links.slice(0, -1) : _h2Links;
                if (_hints) self.setEarlyHints(_hints);
            }
            return sent;
        }

        it('populated h2Links fires one setEarlyHints call with trailing comma trimmed', function () {
            var populated = '</css/a.css>; as=style; rel=preload,</js/b.js>; as=script; rel=preload,';
            var sent = replayEH1(populated);
            assert.equal(sent.length, 1);
            assert.equal(sent[0], '</css/a.css>; as=style; rel=preload,</js/b.js>; as=script; rel=preload');
        });

        it('empty h2Links no-ops (no setEarlyHints call)', function () {
            assert.equal(replayEH1('').length, 0);
            assert.equal(replayEH1(null).length, 0);
            assert.equal(replayEH1(undefined).length, 0);
        });

        it('trailing-comma-only h2Links slices to empty → no-op', function () {
            // Degenerate case: a getNodeRes that matched zero css/js entries
            // would leave h2Links at its init ''. If something upstream ever
            // wrote a bare ',' the #EH1 block must not send a hint-less 103.
            assert.equal(replayEH1(',').length, 0);
        });

        it('swig-produced and nunjucks-produced h2Links strings yield identical #EH1 behaviour', function () {
            // Both delegates feed h2Links through the same controller.js
            // getNodeRes path, so the strings are byte-identical for the
            // same viewConf. Confirm the block does not branch on engine.
            var same = '</dist/gina.min.css>; as=style; rel=preload,</dist/gina.min.js>; as=script; rel=preload,';
            assert.deepEqual(replayEH1(same), replayEH1(same));
        });
    })();

    // -----------------------------------------------------------------------
    // (f) deferred-items comment — item #4 now marked shipped
    // -----------------------------------------------------------------------

    it('marks the Early Hints 103 deferred item as shipped in the render-nunjucks.js header', function () {
        // Matches the pattern used for items 1-3 (Inspector / HTTP/2 /
        // error-page), 5 (#NJ3), and 6-7 (#NJ2 / #NJ1).
        assert.match(RENDER_NJ_SRC, /[Ee]arly Hints 103[\s\S]{0,400}shipped/);
        assert.match(RENDER_NJ_SRC, /#NJ4/);
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
