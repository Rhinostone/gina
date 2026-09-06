'use strict';
/**
 * #B497 — a custom-error render must build its final-200 `link` preload
 * header and its external-plugin tags from the SAME template object that
 * `getNodeRes()` writes to.
 *
 * The render delegates resolve their view config as `errOptions || local.options`
 * and read the per-response accumulators through it (`localOptions.template.h2Links`
 * for the preload prefix in render-swig, `localOptions.template.externalPlugins`
 * for the head), while `getNodeRes()` writes both through `local.options.template`.
 * `renderCustomError` builds `errOptions` with lib/merge, which grafts `template`
 * as a NEW shallow copy (scalars, empty arrays and primitive arrays copied; only
 * object arrays shared) — so on a custom-error render the writer and the reader
 * held different objects: the config-declared preloads never reached the error
 * page's header, and its external plugins never reached its head. And because a
 * custom-error render is a SECOND top-level render on the same response, an error
 * that strikes AFTER the failing route's setResources() ran would, once the
 * objects are shared, make getNodeRes() append a second copy of every preload —
 * hence the re-seed of both router-seeded accumulators.
 *
 * §01 — source pins (controller.js): the share, both re-seeds, their placement.
 * §02 — the lib/merge premise, driven on the real library (green both sides —
 *       it documents WHY the share is needed).
 * §03 — behavioural: the REAL throwError → renderCustomError → render() path
 *       via createTestInstance with a stubbed render(), in the state a
 *       post-setResources failure leaves behind, plus the pre-setResources
 *       state, an http/1 control and a no-template control.
 *
 * The seam: set `B497_SRC` to a pre-change copy of controller.js to prove the
 * fix arms go red against the old bytes. The copy must sit inside a directory
 * that mirrors the framework tree (symlink every sibling of core/controller/
 * controller.js), because controller.js resolves its dependencies relatively.
 */

var assert   = require('node:assert');
var fs       = require('node:fs');
var path     = require('node:path');
var describe = require('node:test').describe;
var it       = require('node:test').it;

var FW      = require('../fw');
var SOURCE  = process.env.B497_SRC || path.join(FW, 'core/controller/controller.js');
var SRC     = fs.readFileSync(SOURCE, 'utf8');

/**
 * Slices src between two unique anchors, asserting both exist exactly once.
 *
 * @param {string} src   - Full source text
 * @param {string} start - Start anchor (declaration form, not a bare name)
 * @param {string} end   - End anchor
 * @returns {string} The slice between the anchors
 */
function sliceBetween(src, start, end) {
    var s = src.indexOf(start);
    assert.ok(s > -1, 'start anchor not found: ' + start);
    assert.equal(src.indexOf(start, s + 1), -1, 'start anchor is not unique: ' + start);
    var e = src.indexOf(end, s);
    assert.ok(e > s, 'end anchor not found after start: ' + end);
    return src.substring(s, e);
}

describe('01 - #B497 source pins: the share and the re-seeds inside renderCustomError', function() {

    var BODY = sliceBetween(SRC, 'this.renderCustomError = function', 'var getResponseProtocol');

    it('carries the #B497 marker', function() {
        assert.ok(BODY.indexOf('#B497') > -1, 'renderCustomError must document the share (#B497)');
    });

    it('points errOptions.template at the request\'s own template object, guarded on both', function() {
        assert.match(
            BODY,
            /if\s*\(\s*errOptions\s*&&\s*local\.options\.template\s*\)\s*\{\s*errOptions\.template\s*=\s*local\.options\.template;?/,
            '#B497: errOptions.template must be the same object getNodeRes() writes to'
        );
    });

    it('re-seeds h2Links only when the router seeded it (a string under http/2)', function() {
        assert.match(
            BODY,
            /typeof\s*\(\s*local\.options\.template\.h2Links\s*\)\s*==\s*'string'\s*\)\s*\{\s*local\.options\.template\.h2Links\s*=\s*'';?/,
            '#B497: a custom-error render is a second top-level render — h2Links must restart from the router\'s seed, and only where the router seeded it'
        );
    });

    it('re-seeds externalPlugins to a fresh array', function() {
        assert.match(
            BODY,
            /Array\.isArray\(\s*local\.options\.template\.externalPlugins\s*\)\s*\)\s*\{\s*local\.options\.template\.externalPlugins\s*=\s*\[\];?/,
            '#B497: externalPlugins must restart from the router\'s seed too'
        );
    });

    it('both re-seeds are guarded on local.options.template (a route without views has none)', function() {
        var reseedIdx = BODY.indexOf("local.options.template.h2Links = ''");
        assert.ok(reseedIdx > -1, 're-seed not found');
        var guard = BODY.substring(Math.max(0, reseedIdx - 260), reseedIdx);
        assert.match(guard, /if\s*\(\s*local\.options\.template\s*\)/, 'the re-seeds must sit under an `if ( local.options.template )` guard');
    });

    it('the share and the re-seeds sit AFTER both errOptions channels and BEFORE the #B190 stamp and the dispatch', function() {
        var lastMergeIdx = BODY.lastIndexOf('errOptions = merge(');
        var shareIdx     = BODY.indexOf('errOptions.template = local.options.template');
        var reseedIdx    = BODY.indexOf("local.options.template.h2Links = ''");
        var pluginsIdx   = BODY.indexOf('local.options.template.externalPlugins = []');
        var stampIdx     = BODY.search(/res\.statusCode\s*=\s*data\.status/);
        var dispatchIdx  = BODY.indexOf('self.render(data, displayInspector, errOptions)');
        assert.ok(lastMergeIdx > -1 && shareIdx > -1 && reseedIdx > -1 && pluginsIdx > -1 && stampIdx > -1 && dispatchIdx > -1, 'all six anchors must resolve');
        assert.ok(lastMergeIdx < shareIdx, 'the share must follow the last errOptions = merge(...) channel');
        assert.ok(shareIdx < reseedIdx && reseedIdx < pluginsIdx, 'share, then h2Links re-seed, then externalPlugins re-seed');
        assert.ok(pluginsIdx < stampIdx, 'the re-seeds must precede the #B190 status stamp');
        assert.ok(stampIdx < dispatchIdx, 'the #B190 stamp must still precede the dispatch (control)');
    });

    it('control — the #B191 file channel and the #B190 stamp are untouched', function() {
        assert.match(BODY, /else\s+if\s*\([\s\S]{0,200}?req\.routing\.param\.file[\s\S]{0,1200}?errOptions\s*=\s*merge\(/);
        assert.match(BODY, /res\.statusCode\s*=\s*data\.status/);
    });
});

describe('02 - #B497 the lib/merge premise, driven on the real library (why the share exists)', function() {

    var merge = require(path.join(FW, 'lib/merge'));

    it('merge grafts a missing `template` subtree as a NEW object (scalars copied at merge time)', function() {
        var tpl = { stylesheets: [{ url: '/a.css' }], javascripts: [], h2Links: '', externalPlugins: [], sriEnabled: false };
        var out = merge({ file: '/err.html', path: null }, { file: 'route', template: tpl });
        assert.notStrictEqual(out.template, tpl, 'the copy is what created the writer/reader split');
        tpl.h2Links += '<x>; as=style; rel=preload,';
        assert.strictEqual(out.template.h2Links, '', 'a write through the original does not reach the copy');
        assert.strictEqual(out.file, '/err.html', 'target wins (control)');
    });

    it('merge COPIES an empty array and an array of strings, and SHARES an array of objects', function() {
        var tpl = { empty: [], strings: ['<script src="/x.js"></script>'], objects: [{ url: '/a.css' }] };
        var out = merge({ file: 'e' }, { template: tpl });
        assert.notStrictEqual(out.template.empty, tpl.empty, 'router-seeded externalPlugins ([]) lands in the copied class');
        assert.notStrictEqual(out.template.strings, tpl.strings, 'spliced <script> strings would be copied too');
        assert.strictEqual(out.template.objects, tpl.objects, 'stylesheets/javascripts (object arrays) are shared — control');
    });
});

// Runtime tests — framework-globals bootstrap (same recipe as
// controller-custom-error-options.test.js §03/§04).
describe('03 - #B497 behavioural: the real throwError → renderCustomError → render() path', function() {

    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);

    /**
     * Builds a controller whose throwError() HTML branch dispatches to the
     * REAL renderCustomError, with render() stubbed to capture errOptions.
     *
     * @param {object|undefined} tplState - Extra keys grafted onto options.template; `undefined` = no template at all
     * @returns {{inst: object, calls: Array, res: object}}
     */
    function mk(tplState) {
        var sharedRoute = { url: '/custom-error', param: { control: 'renderCustomError', error: {} } };
        var res = {
            statusCode: 200, headersSent: false,
            getHeaders: function() { return {}; }, getHeader: function() { return undefined; },
            setHeader: function() {}, writeHead: function() {}, end: function() {}
        };
        var inst = SuperController.createTestInstance({
            req: {
                url: '/home', method: 'GET', httpVersion: '1.1',
                headers: {}, params: {}, get: {},
                routing: { rule: 'home@b', param: { control: 'home' } }
            },
            res: res,
            next: function() {},
            options: {
                rule: 'home', control: 'home', renderingStack: [],
                conf: {
                    bundle: 'b', bundlesPath: '/tmp/bundles', encoding: 'utf-8', renderingStack: [],
                    server: {
                        protocol: 'http/1.1',
                        coreConfiguration: {
                            statusCodes: { '500': 'Internal Server Error' },
                            mime: { json: 'application/json', html: 'text/html' }
                        }
                    },
                    content: {
                        templates: { _common: { errorFiles: { '500': '/abs/templates/html/errors/500.html' } } },
                        routing: { 'custom-error-page@b': sharedRoute }
                    }
                }
            }
        });
        var calls = [];
        inst.render = function(data, displayInspector, errOptions) {
            calls.push({ data: data, errOptions: errOptions });
        };
        // Grafted AFTER instantiation, as in the #B191 harness: hasViews()/isUsingTemplate
        // gate the throwError HTML branch off this same options object.
        if (typeof tplState != 'undefined') {
            inst._options.template = Object.assign({ html: '/tmp/templates/html' }, tplState);
        }
        inst._options.isUsingTemplate = true;
        return { inst: inst, calls: calls, res: res };
    }

    var PLUGIN = '\n\t\t<script type="text/javascript" src="/x.js"></script>';

    it('post-setResources failure: the error render shares the request\'s template object', function() {
        var h = mk({ h2Links: 'P,', externalPlugins: [PLUGIN], stylesheets: [], javascripts: [] });
        h.inst.throwError(500, new Error('template compilation failed after setResources'));
        assert.equal(h.calls.length, 1, 'throwError must reach render() via renderCustomError (harness control)');
        var eo = h.calls[0].errOptions;
        assert.ok(eo, 'errOptions built (control)');
        assert.strictEqual(eo.template, h.inst._options.template,
            '#B497: the delegates read localOptions.template, getNodeRes writes local.options.template — they must be the same object');
    });

    it('post-setResources failure: h2Links restarts from the router\'s seed on the shared object', function() {
        var h = mk({ h2Links: 'P,', externalPlugins: [PLUGIN], stylesheets: [], javascripts: [] });
        h.inst.throwError(500, new Error('x'));
        var eo = h.calls[0].errOptions;
        assert.strictEqual(h.inst._options.template.h2Links, '', '#B497: getNodeRes appends with +=, so a populated accumulator would double every preload');
        assert.strictEqual(eo.template.h2Links, '', 'and the error render reads that same seed');
    });

    it('post-setResources failure: externalPlugins restarts from the router\'s seed on the shared object', function() {
        var h = mk({ h2Links: 'P,', externalPlugins: [PLUGIN], stylesheets: [], javascripts: [] });
        h.inst.throwError(500, new Error('x'));
        var eo = h.calls[0].errOptions;
        assert.strictEqual(eo.template.externalPlugins, h.inst._options.template.externalPlugins, 'one array, read and written');
        assert.strictEqual(h.inst._options.template.externalPlugins.length, 0, '#B497: getNodeRes splices, so a populated array would carry every plugin twice');
    });

    it('pre-setResources failure (the ledger\'s case): the objects are shared and the seeds are no-ops', function() {
        var h = mk({ h2Links: '', externalPlugins: [], stylesheets: [], javascripts: [] });
        h.inst.throwError(500, new Error('x'));
        var eo = h.calls[0].errOptions;
        assert.strictEqual(eo.template, h.inst._options.template, '#B497: shared');
        assert.strictEqual(eo.template.h2Links, '', 'seed untouched (control)');
        assert.strictEqual(eo.template.externalPlugins.length, 0, 'seed untouched (control)');
    });

    it('the #B191 file channel and the #B190 stamp survive the share (controls)', function() {
        var h = mk({ h2Links: '', externalPlugins: [], stylesheets: [], javascripts: [] });
        h.inst.throwError(500, new Error('x'));
        var eo = h.calls[0].errOptions;
        assert.equal(eo.file, '/abs/templates/html/errors/500.html', '#B191: the resolved error template still rides errOptions');
        assert.strictEqual(eo.path, null, '#B191: custom paths ignore the namespace');
        assert.equal(h.res.statusCode, 500, '#B190: the status stamp still fires');
    });

    it('http/1 control: h2Links is never seeded by the router and the re-seed must not invent it', function() {
        var h = mk({ externalPlugins: [], stylesheets: [], javascripts: [] });
        h.inst.throwError(500, new Error('x'));
        var eo = h.calls[0].errOptions;
        assert.strictEqual(typeof h.inst._options.template.h2Links, 'undefined', 'the typeof guard must leave an unseeded h2Links alone');
        assert.strictEqual(typeof eo.template.h2Links, 'undefined');
    });

    it('no-template control: a route without views still reaches render() and keeps the #B191 channel', function() {
        // The throwError HTML branch needs a template to dispatch a custom page;
        // drive renderCustomError directly, as controller-custom-error-options §03 does.
        var h = mk(undefined);
        var req = {
            url: '/custom-error', method: 'GET',
            routing: { rule: 'custom-error-page@b', param: { error: { status: 500 }, file: '/abs/templates/html/errors/500.html' } },
            params: {}, get: {}, headers: {}
        };
        assert.doesNotThrow(function() { h.inst.renderCustomError(req, h.res, function() {}); },
            '#B497: the share and the re-seeds must be guarded on local.options.template');
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0].errOptions.file, '/abs/templates/html/errors/500.html');
        assert.strictEqual(typeof h.calls[0].errOptions.template, 'undefined', 'no template was invented');
    });
});
