'use strict';
/**
 * #B825 — a filter, tag or extension a bundle registers in `controllers/setup.js`
 * through `this.engine` never reached the engine a custom async swig template
 * loader (`settings.template.swig.loader`) renders through.
 *
 * `setup.js` registers on the bundle's own engine (the per-bundle default engine
 * controller.js mints, `self.engine`), while controller.render-swig-async.js
 * renders through an engine of its own, `new swigMod.Swig({ loader })`, and swig
 * gives every instance private filter and tag maps. A template using the bundle's
 * filter answered 500 with `Invalid filter`, a tag with `Unexpected tag`. The fix:
 * controller.js records every registration made on the engine of a bundle with an
 * async loader (`recordRegistrations`), and the delegate replays the record onto
 * its own engine whenever it changed (`replayBundleRegistrations`). A bundle filter
 * named like one of gina's is not replayed: on the default render path gina
 * registers its filters again at each render, after setup.js, so gina's wins
 * there, and it wins here too.
 *
 * §01 — source pins: controller.js records for a bundle with an async loader; the
 *       delegate replays after getSwigEngine; gina's filter names are kept.
 * §02 — the premise, on the real swig: a registration on one instance never
 *       reaches another (green before and after the fix: it says why).
 * §03 — behavioural, on the REAL delegate module, with the bundle engine minted
 *       by the REAL getDefaultSwigEngine and, as controller.js does for a bundle
 *       with an async loader, recordRegistrations (both lifted from controller.js).
 *
 * Red first: against the pre-fix tree, §01 and the §03 arms marked [fix] fail;
 * the arms marked [guard] pass on both sides.
 */

var assert     = require('node:assert');
var fs         = require('node:fs');
var path       = require('node:path');
var describe   = require('node:test').describe;
var it         = require('node:test').it;
var beforeEach = require('node:test').beforeEach;
var afterEach  = require('node:test').afterEach;

var FW             = require('../fw');
var CONTROLLER_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var DELEGATE_PATH  = path.join(FW, 'core/controller/controller.render-swig-async.js');
var DELEGATE_SRC   = fs.readFileSync(DELEGATE_PATH, 'utf8');

var swig = null;
try { swig = require('@rhinostone/swig'); } catch (e) { swig = null; }


describe('01 - #B825 source pins', function () {

    it('controller.js defines recordRegistrations once', function () {
        assert.equal(CONTROLLER_SRC.split('\nfunction recordRegistrations(engine) {').length - 1, 1);
    });

    it('controller.js installs it on the bundle engine, before self.engine is handed to setup.js, only for a bundle with an async swig loader', function () {
        var a = CONTROLLER_SRC.indexOf('local._swigEngine = ( dir && typeof(swig.Swig) === \'function\' )');
        var b = CONTROLLER_SRC.indexOf('self.engine = local._swigEngine;', a);
        assert.ok(a > -1 && b > a, 'the engine assignment and the self.engine hand-over are found, in that order');
        var between = CONTROLLER_SRC.slice(a, b);
        assert.match(between, /recordRegistrations\(local\._swigEngine\)/);
        // the dispatch's own test (render()): the bundle's loader is registered and async
        assert.match(between, /process\.gina\._swigLoaders\[_asyncRoot\]\.loader\.async === true/);
        assert.match(between, /local\._swigEngine !== swig/);
    });

    it('the delegate replays the record after getSwigEngine, from deps.swig', function () {
        assert.equal(DELEGATE_SRC.split('\nfunction replayBundleRegistrations(entry, bundleEngine) {').length - 1, 1);
        var g = DELEGATE_SRC.indexOf('engineEntry = getSwigEngine(');
        var r = DELEGATE_SRC.indexOf('replayBundleRegistrations(engineEntry, deps.swig);');
        assert.ok(g > -1 && r > g, 'the replay follows getSwigEngine');
    });

    it('getSwigEngine keeps the names registerGinaFilters registered, so a same-name bundle filter is skipped', function () {
        assert.match(DELEGATE_SRC, /var ginaFilterNames = registerGinaFilters\(engine, SwigFilters, throwError, \(autoescape === true\)\);/);
        assert.match(DELEGATE_SRC, /ginaFilterNames:\s*ginaFilterNames/);
    });
});


describe('02 - the premise, on the real swig (green before and after the fix)', function () {

    it('a filter registered on one swig instance is not on another', function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var a = new swig.Swig({ cache: false, autoescape: false });
        var b = new swig.Swig({ cache: false, autoescape: false });
        a.setFilter('b825premise', function (x) { return 'P<' + x + '>'; });
        assert.equal(a.compile('{{ "x"|b825premise }}')({}), 'P<x>');
        assert.throws(
            function () { return b.compile('{{ "x"|b825premise }}')({}); },
            /Invalid filter "b825premise"/
        );
    });
});


// Runtime tests — framework-globals bootstrap (the render-swig-async-module-b808.test.js §03 recipe).
describe('03 - #B825 behavioural: the real async delegate', function () {

    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    require(path.join(FW, '..', '..', 'utils', 'prototypes'));
    setPath('gina', { core: path.join(FW, 'core') });

    var renderSwigAsync = require(DELEGATE_PATH);
    var tlBuild         = require(path.join(FW, 'lib/template-loaders/src/main.js')).build;

    // Registry keys only: the async loader serves the templates from memory, and the
    // per-bundle engine's fs loader is never asked for a file here.
    var ROOT_A = path.join(require('node:os').tmpdir(), 'b825-unused-root-a', 'templates', 'html');
    var ROOT_B = path.join(require('node:os').tmpdir(), 'b825-unused-root-b', 'templates', 'html');
    var LAYOUT = '<!doctype html><html><head><title>b825</title></head><body>{% block body %}{% endblock %}</body></html>';
    function page(body) { return '{% extends "layout.html" %}{% block body %}' + body + '{% endblock %}'; }
    var TEMPLATES = {
        'layout.html' : LAYOUT,
        'plain.html'  : page('<p id="m">PLAIN</p>'),
        'stamp.html'  : page('<p id="s">{{ "x"|b825stamp }}</p>'),
        'late.html'   : page('<p id="l">{{ "x"|b825late }}</p>'),
        'tag.html'    : page('<p id="t">{% b825tag %}</p>'),
        'swap.html'   : page('<p id="w">{{ "x"|b825swap }}</p>'),
        'collide.html': page('<p id="c">{{ "x"|b825gina }}|{{ "y"|b825own }}</p>'),
        'onlya.html'  : page('<p id="a">{{ "x"|b825onlya }}</p>'),
        'never.html'  : page('<p id="n">{{ "x"|b825never }}</p>')
    };
    var KEYS = ['_swigLoaders', '_swigEngines', '_swigEnginesOwner', '_swigDefaultEngines', '_swigDefaultEnginesOwner', '_renderALS'];
    var saved = null;

    /**
     * Lift a top-level function from controller.js by its opening line, up to the
     * first `\n}\n` after it, compiled with the named helpers declared before it.
     * The lifted functions close over nothing but their parameters and the
     * `process` / `JSON` / `Object` globals, so compiling them outside the module
     * is sound.
     *
     * @param {string}   startLine - The `function name(...) {` line opening the span
     * @param {string}   endLine   - The `function name(...) {` line whose end closes it
     * @param {string}   ret       - The function name the span returns
     * @returns {?function} the function, or null when the start line is absent
     */
    function lift(startLine, endLine, ret) {
        var start = CONTROLLER_SRC.indexOf(startLine);
        if (start < 0) { return null; }
        var last = CONTROLLER_SRC.indexOf(endLine, start);
        assert.ok(last >= start, ret + ': end function found after start');
        var end = CONTROLLER_SRC.indexOf('\n}\n', last);
        assert.ok(end > last, ret + ': end found');
        return new Function(CONTROLLER_SRC.slice(start, end + 2) + '\nreturn ' + ret + ';')();
    }
    var getDefaultSwigEngine = lift(
        'function bridgeRegistrationsToModule(engine, swigMod) {',
        'function getDefaultSwigEngine(swigMod, templateRoot, opts) {',
        'getDefaultSwigEngine'
    );
    // null on the pre-fix tree: controller.js then records nothing
    var recordRegistrations = lift('function recordRegistrations(engine) {', 'function recordRegistrations(engine) {', 'recordRegistrations');

    /**
     * The engine controller.js hands `setup.js` (and the delegate, as `deps.swig`)
     * for a bundle with an async loader: the real getDefaultSwigEngine, then
     * recordRegistrations when the tree has it.
     *
     * @param {string} root - The bundle templates root
     * @returns {*} the per-bundle engine
     */
    function bundleEngine(root) {
        var engine = getDefaultSwigEngine(swig, root, { autoescape: true, cache: false, loader: swig.loaders.fs(root) });
        return recordRegistrations ? recordRegistrations(engine) : engine;
    }

    /**
     * Deps as controller.js's render() hands them to a delegate, with a captured
     * response and throwError.
     *
     * @param {string}   root          - The bundle templates root (the registry key)
     * @param {string}   file          - The page template (without `.html`)
     * @param {*}        depsSwig      - What `deps.swig` carries
     * @param {function} [swigFilters] - The SwigFilters factory; defaults to one returning {}
     * @returns {{deps: object, sent: object, thrown: Array}}
     */
    function mkDeps(root, file, depsSwig, swigFilters) {
        var sent = { status: null, body: null, headers: {} };
        var thrown = [];
        var res = {
            statusCode : 200,
            headersSent: false,
            getHeader  : function (k) { return sent.headers[String(k).toLowerCase()]; },
            setHeader  : function (k, v) { sent.headers[String(k).toLowerCase()] = v; },
            getHeaders : function () { return sent.headers; },
            writeHead  : function (code) { sent.status = code; },
            end        : function (body) { sent.body = (typeof body === 'undefined') ? '' : String(body); res.headersSent = true; }
        };
        var req = { method: 'GET', url: '/b825', headers: { host: '127.0.0.1:3100' } };
        var localOptions = {
            bundle  : 'b825',
            template: {},
            conf    : {
                bundle  : 'b825',
                env     : 'dev',
                hostname: 'http://127.0.0.1:3100',
                host    : '127.0.0.1',
                server  : { scheme: 'http', port: 3100 },
                content : { templates: { _common: { html: root } } }
            }
        };
        var deps = {
            self        : { throwError: function (err) { thrown.push(err); } },
            local       : { req: req, res: res, next: function () {}, options: localOptions },
            getData     : function () { return { page: { view: { file: file, ext: '.html' }, data: {} } }; },
            hasViews    : function () { return true; },
            setResources: function () {},
            SwigFilters : swigFilters || function () { return {}; },
            headersSent : function () { return res.headersSent === true; },
            swig        : depsSwig,
            swigModule  : swig
        };
        return { deps: deps, sent: sent, thrown: thrown };
    }

    /**
     * Render `file` through the real delegate and return what it sent or threw.
     *
     * @param {string}   root          - The bundle templates root
     * @param {string}   file          - The page template
     * @param {*}        depsSwig      - What `deps.swig` carries
     * @param {function} [swigFilters] - The SwigFilters factory
     * @returns {Promise<{deps: object, sent: object, thrown: Array}>}
     */
    async function render(root, file, depsSwig, swigFilters) {
        var r = mkDeps(root, file, depsSwig, swigFilters);
        await renderSwigAsync({}, false, null, r.deps);
        return r;
    }

    /**
     * The text of `<p id="<id>">…</p>` in a rendered body.
     *
     * @param {?string} body - The sent body
     * @param {string}  id   - The element id
     * @returns {?string} the element text, or null
     */
    function el(body, id) {
        var m = String(body || '').match(new RegExp('<p id="' + id + '">([\\s\\S]*?)</p>'));
        return m ? m[1] : null;
    }

    beforeEach(function () {
        process.gina = process.gina || {};
        saved = {};
        KEYS.forEach(function (k) { saved[k] = { had: Object.prototype.hasOwnProperty.call(process.gina, k), v: process.gina[k] }; delete process.gina[k]; });
        process.gina._swigLoaders = Object.create(null);
        [ROOT_A, ROOT_B].forEach(function (root) {
            process.gina._swigLoaders[root] = { loader: tlBuild({ type: 'memory', templates: TEMPLATES }), autoescape: true, cache: false };
        });
    });

    afterEach(function () {
        KEYS.forEach(function (k) { if (saved[k].had) { process.gina[k] = saved[k].v; } else { delete process.gina[k]; } });
    });

    it('[fix] a filter setup.js registers before the first async render reaches the async template', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var engine = bundleEngine(ROOT_A);
        engine.setFilter('b825stamp', function (x) { return 'STAMP<' + x + '>'; });   // what setup.js does
        var r = await render(ROOT_A, 'stamp', engine);
        assert.deepEqual(r.thrown.map(String), [], 'no throwError');
        assert.equal(r.sent.status, 200);
        assert.equal(el(r.sent.body, 's'), 'STAMP&lt;x&gt;', 'the bundle filter ran, its output autoescaped');
        assert.notStrictEqual(process.gina._swigEngines[ROOT_A].engine, engine, 'rendered on the async engine, not the bundle engine');
    });

    it('[fix] a tag and the extension it reads, registered by setup.js, reach the async template', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var engine = bundleEngine(ROOT_A);
        engine.setExtension('b825ext', { hello: function () { return 'EXT-HELLO'; } });
        engine.setTag('b825tag',
            function () { return true; },
            function () { return '_output += _ext.b825ext.hello();\n'; },
            false, false);
        var r = await render(ROOT_A, 'tag', engine);
        assert.deepEqual(r.thrown.map(String), [], 'no throwError');
        assert.equal(r.sent.status, 200);
        assert.equal(el(r.sent.body, 't'), 'EXT-HELLO');
    });

    it('[fix] a registration made after the async engine was minted reaches the next render (setup.js runs again on later requests)', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var engine = bundleEngine(ROOT_A);
        var r1 = await render(ROOT_A, 'plain', engine);
        assert.equal(r1.sent.status, 200, 'the first render mints the async engine');
        var minted = process.gina._swigEngines[ROOT_A].engine;
        engine.setFilter('b825late', function (x) { return 'LATE<' + x + '>'; });
        var r2 = await render(ROOT_A, 'late', engine);
        assert.deepEqual(r2.thrown.map(String), [], 'no throwError');
        assert.equal(el(r2.sent.body, 'l'), 'LATE&lt;x&gt;');
        assert.strictEqual(process.gina._swigEngines[ROOT_A].engine, minted, 'the same async engine, minted once per root');
    });

    it('[fix] a re-registration under the same name replaces the replayed function at the next render', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var engine = bundleEngine(ROOT_A);
        engine.setFilter('b825swap', function (x) { return 'ONE<' + x + '>'; });
        var r1 = await render(ROOT_A, 'swap', engine);
        assert.equal(el(r1.sent.body, 'w'), 'ONE&lt;x&gt;');
        engine.setFilter('b825swap', function (x) { return 'TWO<' + x + '>'; });
        var r2 = await render(ROOT_A, 'swap', engine);
        assert.equal(el(r2.sent.body, 'w'), 'TWO&lt;x&gt;');
    });

    it('[fix] a bundle filter named like a gina filter is not replayed (gina\'s wins, as on the default path); the bundle\'s own filter is', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var ginaFilters = function () {
            return {
                b825gina : function (x) { return 'GINA<' + x + '>'; },
                getConfig: function () { return {}; }
            };
        };
        var engine = bundleEngine(ROOT_A);
        engine.setFilter('b825gina', function (x) { return 'BUNDLE<' + x + '>'; });
        engine.setFilter('b825own', function (x) { return 'OWN<' + x + '>'; });
        var r = await render(ROOT_A, 'collide', engine, ginaFilters);
        assert.deepEqual(r.thrown.map(String), [], 'no throwError');
        assert.equal(el(r.sent.body, 'c'), 'GINA&lt;x&gt;|OWN&lt;y&gt;');
    });

    it('[fix] the record is replayed only when it changed', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var engine = bundleEngine(ROOT_A);
        engine.setFilter('b825stamp', function (x) { return 'STAMP<' + x + '>'; });
        await render(ROOT_A, 'stamp', engine);
        var asyncEngine = process.gina._swigEngines[ROOT_A].engine;
        var calls = 0, orig = asyncEngine.setFilter;
        asyncEngine.setFilter = function () { calls++; return orig.apply(asyncEngine, arguments); };
        var r1 = await render(ROOT_A, 'stamp', engine);
        assert.equal(el(r1.sent.body, 's'), 'STAMP&lt;x&gt;');
        assert.equal(calls, 0, 'nothing registered since the last render: no replay');
        engine.setFilter('b825stamp', function (x) { return 'STAMP2<' + x + '>'; });
        var r2 = await render(ROOT_A, 'stamp', engine);
        assert.equal(el(r2.sent.body, 's'), 'STAMP2&lt;x&gt;');
        assert.ok(calls > 0, 'a new registration is replayed');
    });

    it('[guard] one bundle\'s registration does not reach another bundle\'s async engine', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var a = bundleEngine(ROOT_A);
        var b = bundleEngine(ROOT_B);
        a.setFilter('b825onlya', function (x) { return 'A<' + x + '>'; });
        var rb = await render(ROOT_B, 'onlya', b);
        assert.equal(rb.thrown.length, 1, 'bundle B answers through throwError');
        assert.match(String(rb.thrown[0] && rb.thrown[0].message), /Invalid filter "b825onlya"/);
        assert.equal(rb.sent.body, null, 'nothing was sent for bundle B');
        assert.notStrictEqual(process.gina._swigEngines[ROOT_B].engine, a, 'B renders on its own async engine');
    });

    it('[guard] control: a filter registered nowhere still fails the render through throwError', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var engine = bundleEngine(ROOT_A);
        engine.setFilter('b825stamp', function (x) { return 'STAMP<' + x + '>'; });
        var r = await render(ROOT_A, 'never', engine);
        assert.equal(r.thrown.length, 1, 'answered through throwError');
        assert.match(String(r.thrown[0] && r.thrown[0].message), /Invalid filter "b825never"/);
        assert.equal(r.sent.body, null, 'nothing was sent');
    });

    it('[guard] deps.swig with no record (the swig module, or a bundle engine never recorded) replays nothing and still renders', async function (t) {
        if (!swig) { t.skip('@rhinostone/swig not installed'); return; }
        var r1 = await render(ROOT_A, 'plain', swig);
        assert.deepEqual(r1.thrown.map(String), []);
        assert.equal(el(r1.sent.body, 'm'), 'PLAIN');
        var plainEngine = getDefaultSwigEngine(swig, ROOT_B, { autoescape: true, cache: false, loader: swig.loaders.fs(ROOT_B) });
        assert.equal(typeof plainEngine._ginaRegistrations, 'undefined', 'fixture: an engine never handed to recordRegistrations');
        var r2 = await render(ROOT_B, 'plain', plainEngine);
        assert.deepEqual(r2.thrown.map(String), []);
        assert.equal(el(r2.sent.body, 'm'), 'PLAIN');
    });
});
