'use strict';
/**
 * #B190 — renderCustomError must stamp the HTTP status on the response
 * before the render dispatch.
 *
 * Verified live (isolated daemonless boot, 2026-08-01): a configured
 * custom error page (`templates/html/errors/500.html`) was served with
 * `HTTP/1.1 200 OK` under the nunjucks engine, while the stock swig
 * engine served the same fixture as 500. The swig and v1 delegates
 * recompute the status downstream from the page data; the nunjucks and
 * the async delegates only read the already-set response status at
 * their write sites — so the stamp must happen upstream, once, in
 * renderCustomError, covering every delegate and every entry path
 * (controller throwError, the server twin's re-dispatch, direct route).
 *
 * §01 — source pins on the guarded stamp (unique-anchor + ordering).
 * §02 — behavioral: drives the REAL renderCustomError bytes via
 *       SuperController.createTestInstance with a stubbed render(),
 *       asserting the stamped VALUE (not just the shape). Red-first
 *       validated against the pre-fix bytes: the two discriminators
 *       fail semantically (statusCode stays 200), the four controls
 *       pass on both generations.
 */

var assert   = require('node:assert');
var fs       = require('node:fs');
var path     = require('node:path');
var describe = require('node:test').describe;
var it       = require('node:test').it;

var SOURCE = path.join(require('../fw'), 'core/controller/controller.js');
var SRC    = fs.readFileSync(SOURCE, 'utf8');

/**
 * Slices SRC between two unique anchors, asserting both exist exactly once.
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

describe('01 - #B190 source pins: the guarded status stamp inside renderCustomError', function() {

    var BODY = sliceBetween(SRC, 'this.renderCustomError = function', 'var getResponseProtocol');

    it('the stamp exists: `res.statusCode = data.status` inside renderCustomError', function() {
        assert.match(
            BODY,
            /res\.statusCode\s*=\s*data\.status/,
            '#B190 stamp missing — a custom error page renders under the response\'s prior status (200) on the nunjucks and async delegates'
        );
    });

    it('the stamp is guarded through to the assignment (membership + headersSent)', function() {
        // Anchored on the change-unique binding `_eStatusCodes` and run
        // THROUGH the assignment, so a right-extension or a dropped
        // conjunct breaks the pin (unanchored-substring lesson).
        assert.match(
            BODY,
            /var _eStatusCodes\s*=[\s\S]{0,400}?!res\.headersSent[\s\S]{0,200}?typeof\s*\(\s*_eStatusCodes\[\s*data\.status\s*\]\s*\)\s*!=\s*'undefined'[\s\S]{0,100}?\)\s*\{\s*res\.statusCode\s*=\s*data\.status/,
            'the #B190 guard chain (headersSent + statusCodes membership) must gate the stamp'
        );
    });

    it('the stamp precedes the render dispatch', function() {
        var stampIdx    = BODY.search(/res\.statusCode\s*=\s*data\.status/);
        var dispatchIdx = BODY.indexOf('self.render(data, displayInspector, errOptions)');
        assert.ok(stampIdx > -1, 'stamp not found in the renderCustomError body');
        assert.ok(dispatchIdx > -1, 'render dispatch not found in the renderCustomError body');
        assert.ok(stampIdx < dispatchIdx, 'the stamp must run BEFORE self.render() so every delegate sees it');
    });
});

// Runtime tests — need the framework-globals bootstrap (same recipe as
// controller.test.js §02/§36: NODE_PATH + _initPaths + helpers + setPath).
describe('02 - #B190 behavioral: renderCustomError stamps the response status (real bytes)', function() {

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
     * @param {object|undefined} errParam         - Value for req.routing.param.error
     * @param {object}           [resOverrides]   - Merged onto the mock response
     * @param {object}           [optionsOverrides] - Merged onto the options bag
     * @returns {{res: object, renderCalls: Array, ret: *}}
     */
    function drive(errParam, resOverrides, optionsOverrides) {
        var renderCalls = [];
        var routingParam = {};
        if (typeof errParam !== 'undefined') {
            routingParam.error = errParam;
        }
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
        var k;
        if (resOverrides) {
            for (k in resOverrides) { res[k] = resOverrides[k]; }
        }
        var options = {
            rule: 'custom-error-page', control: 'renderCustomError',
            conf: {
                bundle: 'b',
                server: { coreConfiguration: { statusCodes: STATUS_CODES } },
                content: { routing: {} }
            }
        };
        if (optionsOverrides) {
            for (k in optionsOverrides) { options[k] = optionsOverrides[k]; }
        }
        var inst = SuperController.createTestInstance({
            req: req, res: res, next: function() {}, options: options
        });
        inst.render = function(data, displayInspector, errOptions) {
            renderCalls.push([data, displayInspector, errOptions]);
        };
        var ret = inst.renderCustomError(req, res, function() {});
        return { res: res, renderCalls: renderCalls, ret: ret };
    }

    it('stamps res.statusCode from the error status when the code is known (503)', function() {
        var r = drive({ status: 503, title: 'Service Unavailable' });
        assert.equal(r.renderCalls.length, 1, 'renderCustomError must dispatch to render()');
        assert.equal(r.res.statusCode, 503,
            '#B190: res.statusCode must carry the error status before the render dispatch');
    });

    it('stamps a 4xx the same way (404)', function() {
        var r = drive({ status: 404, title: 'Not Found' });
        assert.equal(r.renderCalls.length, 1);
        assert.equal(r.res.statusCode, 404,
            '#B190: res.statusCode must carry the error status before the render dispatch');
    });

    it('control — no status on the error param leaves the response untouched', function() {
        // The framework-injected custom-error-page route defaults `error: {}`
        // (direct visits are not errors) — the stamp must not fire.
        var r = drive({});
        assert.equal(r.renderCalls.length, 1);
        assert.equal(r.res.statusCode, 200, 'a status-less error param must not change the response status');
    });

    it('control — an unknown status code is not stamped (statusCodes membership guard)', function() {
        var r = drive({ status: 999 });
        assert.equal(r.renderCalls.length, 1);
        assert.equal(r.res.statusCode, 200, 'a code absent from statusCodes must not reach res.statusCode');
    });

    it('control — a sent response is never re-stamped (headersSent guard)', function() {
        var r = drive({ status: 503 }, { headersSent: true });
        assert.equal(r.renderCalls.length, 1);
        assert.equal(r.res.statusCode, 200, 'headersSent must gate the stamp');
    });

    it('control — the re-render guard still short-circuits before the stamp', function() {
        var r = drive({ status: 503 }, null, { renderingStack: ['a', 'b'] });
        assert.equal(r.ret, false, 'renderingStack > 1 must return false');
        assert.equal(r.renderCalls.length, 0, 'no dispatch on the re-render guard');
        assert.equal(r.res.statusCode, 200, 'no stamp on the re-render guard');
    });
});
