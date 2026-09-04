/**
 * #B466 — `throwError` stamps an unvalidated status into `writeHead`
 *
 * On the ERROR-render path a payload's top-level `status` reached
 * `res.writeHead()` verbatim. A non-numeric value therefore threw
 * `RangeError [ERR_HTTP_INVALID_STATUS_CODE]` instead of rendering the error
 * page — i.e. the response failed exactly when the error page was needed,
 * while being completely invisible on every successful render.
 *
 * Two sibling paths already guarded before stamping — `renderCustomError`
 * (`_eStatusCodes[data.status]` membership) and the swig SUCCESS path
 * (`statusCodes[...]` with a 200 fallback) — and only the error fallback
 * omitted it.
 *
 * Measured before the fix (real bytes, driven through `createTestInstance`):
 *
 *     throwError({status:'draft', error:'m'})  ->  writeHead("draft")
 *     throwError({status:'099',   error:'m'})  ->  writeHead("099")
 *     throwError({status:'',      error:'m'})  ->  writeHead("")
 *     throwError({status:404,     error:'m'})  ->  writeHead(404)      <- control
 *
 * Fix under test: a module-level `_isValidHttpStatus` predicate applied to
 * every status the method resolves.
 *
 * WHY A NUMERIC RANGE AND NOT THE `statusCodes` TABLE (both measured):
 *   - Node's own rule is integer 100-999: it accepts 700/999 and rejects
 *     99/1000/"099"/0/-1 and every non-numeric. Matching that rule is what
 *     provably eliminates the RangeError, and it regresses nothing that
 *     works today.
 *   - `status.codes` carries a `_comment` key, so a bare
 *     `typeof(statusCodes[code]) != 'undefined'` membership test ACCEPTS the
 *     status `"_comment"`.
 *   - `/^\d{3}$/` (the predicate already used for the explicit-code arm) is
 *     NOT sufficient either: it accepts "099", which Node rejects.
 * The `statusCodes` warn is deliberately left in place and untouched — the
 * table stays the DIAGNOSTIC, the range check is the CORRECTNESS gate.
 *
 * Arms:
 *   §00 instrument validation — the harness can fire AND can fail
 *   §01 source pins          — the predicate exists and is applied
 *   §02 behaviour, real bytes — driven through the real `throwError`
 *   §03 controls              — valid codes must survive untouched
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');
var src    = fs.readFileSync(SOURCE, 'utf8');

function countOf(needle) {
    return src.split(needle).length - 1;
}


describe('#B466 §00 - instrument validation', function () {

    it('finds a token known to exist and rejects a bogus one', function () {
        assert.ok(src.indexOf('this.throwError') > -1, 'known-present token must fire');
        assert.equal(src.indexOf('zz-b466-bogus-token'), -1, 'bogus token must not fire');
    });

    it('the pre-fix defect shape is a real, findable expression', function () {
        // Anchors the claim that a res.status fallback exists at all; if this
        // ever reads 0 the pins below would pass vacuously.
        assert.ok(countOf('_isValidHttpStatus') > 0 || countOf('res.status') > 0,
            'the resolution site must be locatable in source');
    });
});


describe('#B466 §01 - source pins', function () {

    it('the _isValidHttpStatus predicate is defined exactly once', function () {
        assert.equal(countOf('var _isValidHttpStatus'), 1,
            '#B466: the predicate must be defined exactly once at module level');
    });

    it('the predicate encodes Node’s own 100-999 integer rule', function () {
        var i = src.indexOf('var _isValidHttpStatus');
        assert.ok(i > -1, 'predicate not found');
        var block = src.slice(i, i + 320);
        assert.ok(block.indexOf('Number.isInteger') > -1, 'must reject non-integers');
        assert.ok(block.indexOf('100') > -1, 'must carry the lower bound');
        assert.ok(block.indexOf('999') > -1, 'must carry the upper bound');
    });

    it('every status the method resolves is passed through the predicate', function () {
        // 3 resolution sites: the Error/object arm, the <3-args arm, the
        // errObj-shape arm inside the JSON branch.
        assert.ok(countOf('_isValidHttpStatus(') >= 4,
            '#B466: the predicate must guard all three resolution sites (plus its own definition)');
    });

    it('the statusCodes diagnostic warn is NOT removed by the fix', function () {
        assert.ok(src.indexOf('not matching any definition') > -1,
            'the ApiValidator warn must survive - the table remains the diagnostic');
    });
});


describe('#B466 §02 - behaviour over real bytes', function () {

    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);

    var STATUS_CODES = {
        '200': 'OK', '404': 'Not Found',
        '500': 'Internal Server Error', '503': 'Service Unavailable'
    };

    /**
     * Drives the real throwError and captures the code handed to writeHead.
     *
     * @param {Array} args - argument list forwarded to throwError
     * @returns {{seen: Array, threw: (string|null)}}
     */
    function drive(args) {
        var seen = [];
        var res = {
            statusCode: 200, headersSent: false,
            setHeader: function () {}, getHeader: function () {},
            getHeaders: function () { return {}; },
            writeHead: function (code) { seen.push(code); },
            end: function () {}
        };
        var req = {
            url: '/x', method: 'GET',
            routing: { rule: 'r@b', param: {} },
            params: {}, get: {}, headers: {}
        };
        var options = {
            rule: 'r', control: 'action', encoding: 'utf8',
            conf: {
                bundle: 'b', encoding: 'utf8',
                server: { coreConfiguration: {
                    statusCodes: STATUS_CODES,
                    mime: { json: 'application/json', html: 'text/html' }
                } },
                content: { routing: {}, templates: { _common: {} } }
            }
        };
        var inst = SuperController.createTestInstance({
            req: req, res: res, next: function () {}, options: options
        });
        var threw = null;
        try { inst.throwError.apply(inst, args); }
        catch (e) { threw = e.code || e.name; }
        return { seen: seen, threw: threw };
    }

    it('a non-numeric status falls back to 500 instead of reaching writeHead', function () {
        var r = drive([{ status: 'draft', error: 'm' }]);
        assert.equal(r.seen[0], 500,
            '#B466: a domain string must degrade to 500, not be stamped verbatim');
    });

    it('a 3-digit-but-invalid status ("099") falls back to 500', function () {
        // Node rejects 099; /^\d{3}$/ would have accepted it.
        var r = drive([{ status: '099', error: 'm' }]);
        assert.equal(r.seen[0], 500, '#B466: "099" is not a valid HTTP status');
    });

    it('an empty-string status falls back to 500', function () {
        var r = drive([{ status: '', error: 'm' }]);
        assert.equal(r.seen[0], 500, '#B466: an empty status must not reach writeHead');
    });

    it('a status matching a status.codes KEY that is not a code ("_comment") falls back to 500', function () {
        var r = drive([{ status: '_comment', error: 'm' }]);
        assert.equal(r.seen[0], 500,
            '#B466: table membership alone is not a validity test - _comment is a real key');
    });
});


describe('#B466 §03 - controls (valid codes must survive untouched)', function () {

    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);

    function drive(args) {
        var seen = [];
        var res = {
            statusCode: 200, headersSent: false,
            setHeader: function () {}, getHeader: function () {},
            getHeaders: function () { return {}; },
            writeHead: function (code) { seen.push(code); },
            end: function () {}
        };
        var req = {
            url: '/x', method: 'GET',
            routing: { rule: 'r@b', param: {} },
            params: {}, get: {}, headers: {}
        };
        var options = {
            rule: 'r', control: 'action', encoding: 'utf8',
            conf: {
                bundle: 'b', encoding: 'utf8',
                server: { coreConfiguration: {
                    statusCodes: { '200': 'OK', '404': 'Not Found', '500': 'Internal Server Error' },
                    mime: { json: 'application/json', html: 'text/html' }
                } },
                content: { routing: {}, templates: { _common: {} } }
            }
        };
        var inst = SuperController.createTestInstance({
            req: req, res: res, next: function () {}, options: options
        });
        try { inst.throwError.apply(inst, args); } catch (e) { /* captured by caller assertions */ }
        return seen;
    }

    it('control - a numeric 404 is preserved (must pass BOTH generations)', function () {
        assert.equal(drive([{ status: 404, error: 'm' }])[0], 404,
            'the documented numeric-status contract must be preserved');
    });

    it('control - a numeric-STRING "404" is preserved', function () {
        assert.equal(drive([{ status: '404', error: 'm' }])[0], '404',
            'node accepts numeric strings - the fix must not narrow this');
    });

    it('control - a Node-valid but unlisted code (700) is NOT coerced', function () {
        // 700 is absent from status.codes but accepted by node. A table-membership
        // guard would wrongly rewrite it to 500; the range check must not.
        assert.equal(drive([{ status: 700, error: 'm' }])[0], 700,
            'the fix must not narrow beyond node’s own rule');
    });
});


describe('#B466 §04 - the 2-arg errorObj shape must still reach site-2', function () {

    // REGRESSION PIN. The first cut of this fix guarded the `<3-args` arm with
    // a bare `_isValidHttpStatus(res) ? res : 500`, which collapsed the error
    // OBJECT to 500. That silently disabled the site-2 resolution below it
    // (its condition is `typeof(code) == 'object'`) and with it the #CE1
    // transient-503 upgrade — caught only by the full suite
    // (transient-errors.test.js "F — ... site-2 resolution"). The object is
    // deliberately passed through; site-2 applies the guard when it unpacks.

    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);

    function drive(args) {
        var seen = [];
        var res = {
            statusCode: 200, headersSent: false,
            setHeader: function () {}, getHeader: function () {},
            getHeaders: function () { return {}; },
            writeHead: function (code) { seen.push(code); },
            end: function () {}
        };
        var req = {
            url: '/x', method: 'GET',
            routing: { rule: 'r@b', param: {} },
            params: {}, get: {}, headers: {}
        };
        var options = {
            rule: 'r', control: 'action', encoding: 'utf8',
            conf: {
                bundle: 'b', encoding: 'utf8',
                server: { coreConfiguration: {
                    statusCodes: { '200': 'OK', '404': 'Not Found', '500': 'Internal Server Error' },
                    mime: { json: 'application/json', html: 'text/html' }
                } },
                content: { routing: {}, templates: { _common: {} } }
            }
        };
        var inst = SuperController.createTestInstance({
            req: req, res: res, next: function () {}, options: options
        });
        try { inst.throwError.apply(inst, args); } catch (e) { /* asserted by caller */ }
        return seen;
    }

    it('the error OBJECT survives the <3-args arm and site-2 resolves its status', function () {
        assert.equal(drive([{ status: 404, error: 'x' }, undefined])[0], 404,
            '#B466 regression pin: collapsing the object here disables site-2');
    });

    it('site-2 applies the same guard when it unpacks an invalid status', function () {
        assert.equal(drive([{ status: 'draft', error: 'x' }, undefined])[0], 500,
            '#B466: the passthrough is only safe because site-2 validates');
    });
});
