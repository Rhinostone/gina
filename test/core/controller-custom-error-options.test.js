'use strict';
/**
 * #B191 — the custom-error render must never lose its resolved template,
 * and the error dispatch must never mutate shared routing config.
 *
 * Consumer-reported (one in-the-wild observation against published 0.6.0,
 * verified structurally on develop): `renderCustomError` builds `errOptions`
 * ONLY inside `if (isLocalOptionResetNeeded)`, so whenever that flag reads
 * falsy the resolved error-template path in `req.routing.param.file` is
 * DISCARDED — the swig delegate then falls back to the FAILING route's own
 * `file` and renders a bare, un-rooted path ("could not open home.html"),
 * reporting a correct routing rule as broken. The server-side throwError
 * twin (`server.js`) sets `param.file` but never the flag; the controller
 * dispatch stamped its params onto the SHARED `bundleConf.content.routing`
 * entry (the server twin gets a per-call clone via lib/routing getRoute).
 *
 * §01 — source pins (controller.js): the unconditional file channel + the
 *       dispatch-site clone.
 * §02 — source pins (controller.render-swig.js): the template-not-found
 *       message under isRenderingCustomError carries no routing-rule dump.
 * §03 — behavioral: the REAL renderCustomError via createTestInstance with
 *       a stubbed render() — the resolved file survives a falsy flag.
 * §04 — behavioral: the REAL throwError HTML dispatch with a stubbed
 *       renderCustomError — the shared routing entry is not mutated.
 */

var assert   = require('node:assert');
var fs       = require('node:fs');
var path     = require('node:path');
var describe = require('node:test').describe;
var it       = require('node:test').it;

var SOURCE      = path.join(require('../fw'), 'core/controller/controller.js');
var SRC         = fs.readFileSync(SOURCE, 'utf8');
var SWIG_SOURCE = path.join(require('../fw'), 'core/controller/controller.render-swig.js');
var SWIG_SRC    = fs.readFileSync(SWIG_SOURCE, 'utf8');

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

describe('01 - #B191 source pins: file channel + dispatch clone (controller.js)', function() {

    var BODY = sliceBetween(SRC, 'this.renderCustomError = function', 'var getResponseProtocol');

    it('the resolved template file reaches errOptions OUTSIDE the reset-flag gate', function() {
        // The falsy-flag branch must still read req.routing.param.file into
        // errOptions — anchored on the else-branch shape so dropping it (or
        // folding it back under the flag) breaks the pin.
        assert.match(
            BODY,
            /else\s+if\s*\([\s\S]{0,200}?req\.routing\.param\.file[\s\S]{0,1200}?errOptions\s*=\s*merge\(/,
            '#B191: a falsy isLocalOptionResetNeeded must not discard req.routing.param.file — the delegates would fall back to the failing route\'s own file'
        );
    });

    it('the falsy-flag channel still blanks `path` so the namespace is ignored', function() {
        var elseIdx = BODY.search(/else\s+if\s*\([\s\S]{0,200}?req\.routing\.param\.file/);
        assert.ok(elseIdx > -1, 'file-channel branch not found');
        var tail = BODY.substring(elseIdx, elseIdx + 1200);
        assert.match(tail, /path\s*:\s*null/,
            'the file channel must carry `path: null` like the reset branch (custom paths ignore the namespace)');
    });

    it('the dispatch site CLONES the injected route instead of mutating shared routing config', function() {
        // Anchored on the eRule assembly through the routeObj assignment.
        var DISPATCH = sliceBetween(SRC,
            "var eRule = 'custom-error-page@'+ bundle;",
            'return self.renderCustomError(local.req, res, local.next);'
        );
        assert.match(
            DISPATCH,
            /routeObj\s*=\s*JSON\.clone\(\s*bundleConf\.content\.routing\[\s*eRule\s*\]\s*\)/,
            '#B191: the controller dispatch must clone the shared routing entry (renderCustomError deletes params off the dispatched object; lib/routing getRoute() already clones for the server twin)'
        );
    });
});

describe('02 - #B191 source pins: no routing-rule dump on the custom-error not-found path (render-swig)', function() {

    // The whole not-found block, from the existsSync guard to the throwError
    // hand-off that ends it.
    var BLOCK = sliceBetween(SWIG_SRC, 'if ( !fs.existsSync(path) ) {', 'var localRequestPort');

    it('control — the generic not-found message still carries the routing-rule dump exactly once', function() {
        var dumps = BLOCK.split('content.routing[localOptions.rule]').length - 1;
        assert.equal(dumps, 1, 'the generic diagnostic (rule dump) must survive for normal renders');
    });

    it('a custom-error render that cannot open its template gets a dedicated message, BEFORE the generic dump', function() {
        var gateIdx = BLOCK.indexOf('isRenderingCustomError');
        var dumpIdx = BLOCK.indexOf('content.routing[localOptions.rule]');
        assert.ok(gateIdx > -1,
            '#B191: the not-found block must branch on isRenderingCustomError — the rule dump misdirects (the rule in scope is correct by construction)');
        assert.ok(gateIdx < dumpIdx, 'the custom-error branch must short-circuit ahead of the generic dump');
    });

    it('the custom-error branch names the template and hands off to throwError (inline fallback via the re-entry guard)', function() {
        var gateIdx = BLOCK.indexOf('isRenderingCustomError');
        var dumpIdx = BLOCK.indexOf('content.routing[localOptions.rule]');
        var branch  = BLOCK.substring(gateIdx, dumpIdx);
        assert.match(branch, /custom error template/,
            'the message must say WHICH template failed, not imply a routing problem');
        assert.match(branch, /self\.throwError\(/,
            'the branch must route through throwError — its re-entry guard serves the built-in page without looping');
        assert.equal(branch.indexOf('content.routing['), -1,
            'no routing dump inside the custom-error branch');
    });
});

// Runtime tests — framework-globals bootstrap (same recipe as
// controller-custom-error-status.test.js §02).
describe('03 - #B191 behavioral: the resolved file survives a falsy reset flag (real bytes)', function() {

    var FW = require('../fw');
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);

    var STATUS_CODES = {
        '404': 'Not Found',
        '500': 'Internal Server Error',
        '503': 'Service Unavailable'
    };

    /**
     * Drives the real renderCustomError with a stubbed render().
     *
     * @param {object} routingParam - The dispatched route's param object
     * @returns {{res: object, renderCalls: Array, ret: *}}
     */
    function drive(routingParam) {
        var renderCalls = [];
        var req = {
            url: '/custom-error', method: 'GET',
            routing: { rule: 'custom-error-page@b', param: routingParam },
            params: {}, get: {}, headers: {}
        };
        var res = {
            statusCode: 200, headersSent: false,
            setHeader: function() {}, getHeader: function() {},
            getHeaders: function() { return {}; },
            writeHead: function() {}, end: function() {}
        };
        var options = {
            rule: 'custom-error-page', control: 'renderCustomError',
            file: 'home', // the FAILING route's derived file — must never win
            conf: {
                bundle: 'b',
                bundlesPath: '/tmp/bundles',
                renderingStack: [],
                server: { coreConfiguration: { statusCodes: STATUS_CODES } },
                content: { routing: {} }
            }
        };
        var inst = SuperController.createTestInstance({
            req: req, res: res, next: function() {}, options: options
        });
        inst.render = function(data, displayInspector, errOptions) {
            renderCalls.push([data, displayInspector, errOptions]);
        };
        var ret = inst.renderCustomError(req, res, function() {});
        return { res: res, renderCalls: renderCalls, ret: ret };
    }

    it('flag ABSENT (the server-twin / stripped-flag shape): errOptions still carries the resolved file', function() {
        var r = drive({
            error: { status: 500, title: 'Internal Server Error' },
            file: '/abs/templates/html/errors/500.html'
        });
        assert.equal(r.renderCalls.length, 1, 'renderCustomError must dispatch to render()');
        var errOptions = r.renderCalls[0][2];
        assert.ok(errOptions, '#B191: errOptions must not be null when the dispatch resolved a template file');
        assert.equal(errOptions.file, '/abs/templates/html/errors/500.html',
            '#B191: the resolved error template must ride errOptions — falling back to the failing route\'s file renders a bare path');
        assert.strictEqual(errOptions.path, null, 'custom paths ignore the namespace (path blanked)');
    });

    it('flag PRESENT (the controller-dispatch shape): identical file — the two channels agree', function() {
        var r = drive({
            error: { status: 500, title: 'Internal Server Error' },
            file: '/abs/templates/html/errors/500.html',
            control: 'renderCustomError',
            isLocalOptionResetNeeded: true
        });
        assert.equal(r.renderCalls.length, 1);
        var errOptions = r.renderCalls[0][2];
        assert.ok(errOptions, 'reset branch builds errOptions');
        assert.equal(errOptions.file, '/abs/templates/html/errors/500.html');
    });

    it('control — no file and no flag (a direct visit): errOptions stays null', function() {
        var r = drive({ error: {} });
        assert.equal(r.renderCalls.length, 1);
        assert.strictEqual(r.renderCalls[0][2], null,
            'a direct visit resolves like a normal route — no synthetic errOptions');
    });

    it('composition — the #B190 status stamp still fires alongside the file channel', function() {
        var r = drive({
            error: { status: 503 },
            file: '/abs/templates/html/errors/5xx.html'
        });
        assert.equal(r.res.statusCode, 503, '#B190 stamp must survive #B191');
        assert.equal(r.renderCalls[0][2].file, '/abs/templates/html/errors/5xx.html');
    });
});

describe('04 - #B191 behavioral: the throwError dispatch leaves shared routing config untouched (real bytes)', function() {

    var FW = require('../fw');
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);

    function mkHtmlErrorInstance() {
        var sharedRoute = {
            url: '/custom-error',
            param: { control: 'renderCustomError', error: {} }
        };
        var res = {
            statusCode: 200, headersSent: false,
            getHeaders: function() { return {}; },
            getHeader: function() { return undefined; },
            setHeader: function() {},
            writeHead: function() {},
            end: function() {}
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
                rule: 'home', control: 'home',
                renderingStack: [],
                conf: {
                    bundle: 'b',
                    bundlesPath: '/tmp/bundles',
                    encoding: 'utf-8',
                    renderingStack: [],
                    server: {
                        protocol: 'http/1.1',
                        coreConfiguration: {
                            statusCodes: { '500': 'Internal Server Error' },
                            mime: { json: 'application/json', html: 'text/html' }
                        }
                    },
                    content: {
                        templates: { _common: {
                            errorFiles: { '500': '/abs/templates/html/errors/500.html' }
                        } },
                        routing: { 'custom-error-page@b': sharedRoute }
                    }
                }
            }
        });
        var dispatches = [];
        inst.renderCustomError = function(req) {
            dispatches.push(req.routing);
        };
        // Grafted AFTER instantiation: hasViews()/isUsingTemplate gate the
        // throwError HTML branch at THROW time off this same options object,
        // while setting them at create time would route setOptions through
        // the page.environment block, which needs a full gina context this
        // harness deliberately does not fake.
        inst._options.template        = { html: '/tmp/templates/html' };
        inst._options.isUsingTemplate = true;
        return { inst: inst, sharedRoute: sharedRoute, dispatches: dispatches };
    }

    it('the dispatched route is a CLONE — not the shared routing entry', function() {
        var h = mkHtmlErrorInstance();
        h.inst.throwError(500, new Error('upstream unavailable'));
        assert.equal(h.dispatches.length, 1, 'throwError must reach the custom-error dispatch (harness control)');
        assert.notStrictEqual(h.dispatches[0], h.sharedRoute,
            '#B191: the dispatch must clone the shared routing entry — mutating it races overlapping errors');
        assert.equal(h.dispatches[0].param.file, '/abs/templates/html/errors/500.html',
            'the clone carries the resolved template (harness control)');
    });

    it('the SHARED routing entry gains none of the per-error stamps', function() {
        var h = mkHtmlErrorInstance();
        h.inst.throwError(500, new Error('upstream unavailable'));
        assert.equal(h.dispatches.length, 1, 'dispatch fired (control)');
        var param = h.sharedRoute.param;
        assert.ok(!('file' in param), 'shared param must not gain `file`');
        assert.ok(!('error' in param) || Object.keys(param.error).length === 0,
            'shared param.error must stay the injected default');
        assert.ok(!('title' in param), 'shared param must not gain `title`');
        assert.ok(!('displayInspector' in param), 'shared param must not gain `displayInspector`');
        assert.ok(!('isLocalOptionResetNeeded' in param), 'shared param must not gain the reset flag');
        assert.ok(!('rule' in h.sharedRoute), 'the shared route must not gain `rule`');
    });
});
