'use strict';
/**
 * #CE1 slice 2 — opt-in 503 + `Retry-After` for transient connector failures.
 *
 * With `server.transientErrors.enabled: true` (per-bundle settings.json), a
 * `lib/connector-error`-stamped transient datastore error (`isTransient ===
 * true`) that would render as HTTP 500 through `throwError` renders as 503
 * with a `Retry-After: <retryAfter>` header (default 30s) and the
 * user-facing `error` field replaced by `server.transientErrors.message`
 * (default: the standard 503 status text). Explicit non-500 statuses and
 * permanent errors are never upgraded; the default (opt-out) behaviour is
 * byte-identical to before. `message`/`stack` keep their existing scope
 * semantics and the #ERRREF pairing line keeps the full pre-strip detail.
 *
 * Server-side only (controller.js is not browser-bundled) — no dist pins.
 *
 * Suites:
 *  01 — controller.js source pins: entry capture ordered before the 2-arg
 *       shift, one conf-reader declaration, two upgrade call sites, one
 *       header-helper declaration + two call sites, two error-field swap
 *       sites, header set ordered before the branch dispatch.
 *  02 — gna.js boot-lint pins: the warn-only block sits after the
 *       render-cache validation, carries the three shape warns, and the
 *       extracted block contains no process.exit (never fatal).
 *  03 — behavioral (REAL throwError via createTestInstance + a capturing
 *       mock response): default-off regression, opt-in upgrade (503 +
 *       Retry-After + default message + ref survives), custom
 *       retryAfter/message, permanent untouched, explicit status untouched,
 *       the 2-arg errorObj (site-2) shape.
 *  04 — behavioral (EXTRACTED `_getTransientErrorsConf`, control-gated):
 *       the normalization matrix — strict-boolean enabled, integer-window
 *       retryAfter, non-empty-string message, hostile getters.
 *  05 — invariants: the server.js throwError twin stays free of the
 *       upgrade machinery (deliberate divergence — stamped connector errors
 *       surface through controller actions only).
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var SOURCE   = path.join(FW, 'core/controller/controller.js');
var CTRL_SRC = fs.readFileSync(SOURCE, 'utf8');
var GNA_SRC  = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
var SRV_SRC  = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');

// comment-stripped view for negative pins (the replace-code convention keeps
// prose mentions; a negative pin must only see ACTIVE code)
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// ─── controller.js throwError slice (declaration → the next method decl) ──────
var CTRL_T_START = CTRL_SRC.indexOf('this.throwError = function(res, code, msg)');
var CTRL_T_END   = CTRL_SRC.indexOf('var refToObj = function (arr)');
var CTRL_T       = CTRL_SRC.substring(CTRL_T_START, CTRL_T_END);

// ─── server.js throwError slice (twin — must stay upgrade-free) ───────────────
var SRV_T_START = SRV_SRC.indexOf('var throwError = function(res, code, msg, next)');
var SRV_T_END   = SRV_SRC.indexOf('Server = inherits(Server, EventEmitter)');
var SRV_T       = SRV_SRC.substring(SRV_T_START, SRV_T_END);

// ─── 01 — controller.js source pins ───────────────────────────────────────────
describe('#CE1 §01 — controller.js: capture, upgrade sites, header helper, swaps', function () {

    it('slice anchors resolve (instrument control)', function () {
        assert.ok(CTRL_T_START > -1 && CTRL_T_END > CTRL_T_START, 'throwError slice anchors');
    });

    it('exactly one module-scope conf reader declaration', function () {
        var m = CTRL_SRC.match(/var _getTransientErrorsConf = function\(bundleConf\)/g);
        assert.ok(m, '_getTransientErrorsConf declaration present');
        assert.equal(m.length, 1, 'exactly one declaration (module scope)');
    });

    it('ORDER: the transient-source capture runs BEFORE the 2-arg shift', function () {
        var capIdx   = CTRL_T.indexOf('.isTransient === true');
        var shiftIdx = CTRL_T.indexOf("typeof(res) == 'number' && arguments.length === 2");
        assert.ok(capIdx > -1, 'the isTransient scan exists in throwError');
        assert.ok(shiftIdx > -1, 'the 2-arg shift anchor resolves');
        assert.ok(capIdx < shiftIdx, 'capture must precede the shift (arg reassignment)');
    });

    it('the upgrade helper is applied at BOTH status-resolution sites', function () {
        var m = CTRL_T.match(/code\s*=\s*_maybeUpgradeTransient503\(code\)/g);
        assert.ok(m, 'upgrade call present');
        assert.equal(m.length, 2, 'expected the upgrade at both resolution sites, found ' + m.length);
    });

    it('one header-helper declaration + two call sites', function () {
        var decl = CTRL_T.match(/var _setTransientRetryAfterHeader = function/g);
        assert.ok(decl && decl.length === 1, 'exactly one header-helper declaration');
        var calls = CTRL_T.match(/_setTransientRetryAfterHeader\(res\)/g);
        assert.ok(calls, 'header-helper call sites present');
        assert.equal(calls.length, 2, 'expected two call sites (post-normalization + site-2), found ' + (calls ? calls.length : 0));
    });

    it('the Retry-After literal is emitted from the controller slice', function () {
        assert.ok(stripComments(CTRL_T).indexOf("'Retry-After'") > -1);
    });

    it('the user-facing error field is swapped at BOTH build points (JSON + eData)', function () {
        var m = CTRL_T.match(/errorObject\.error = _teConf\.message \|\| standardErrorMessage/g);
        assert.ok(m, 'swap present');
        assert.equal(m.length, 2, 'expected the swap at both build points, found ' + m.length);
    });

    it('ORDER: the post-normalization header set precedes the branch dispatch', function () {
        var hdrIdx    = CTRL_T.indexOf('_setTransientRetryAfterHeader(res)');
        var branchIdx = CTRL_T.indexOf('if (!headersSent())');
        assert.ok(hdrIdx > -1 && branchIdx > -1, 'anchors resolve');
        assert.ok(hdrIdx < branchIdx, 'first header call must precede the JSON/HTML dispatch');
    });
});

// ─── 02 — gna.js boot-lint pins ───────────────────────────────────────────────
describe('#CE1 §02 — gna.js: warn-only boot shape check', function () {

    var BLOCK_START = GNA_SRC.indexOf('// #CE1');
    var BLOCK_END   = GNA_SRC.indexOf('// setting default global middlewares');
    var BLOCK       = (BLOCK_START > -1 && BLOCK_END > BLOCK_START)
        ? GNA_SRC.substring(BLOCK_START, BLOCK_END) : '';

    it('the block exists and sits AFTER the render-cache validation', function () {
        assert.ok(BLOCK_START > -1, 'the #CE1 gna.js block exists');
        var rcIdx = GNA_SRC.indexOf('[render-cache] config validation skipped');
        assert.ok(rcIdx > -1 && BLOCK_START > rcIdx, 'placed beside (after) the render-cache seam');
    });

    it('carries the three shape warns', function () {
        assert.ok(BLOCK.indexOf('must be a strict boolean') > -1, 'enabled warn');
        assert.ok(BLOCK.indexOf('must be an integer between 1 and 86400 seconds') > -1, 'retryAfter warn');
        assert.ok(BLOCK.indexOf('must be a non-empty string') > -1, 'message warn');
    });

    it('NEVER fatal: the extracted block contains no process.exit', function () {
        assert.ok(BLOCK.length > 0, 'block extracted (control)');
        assert.equal(BLOCK.indexOf('process.exit'), -1,
            'a rendering nicety must not refuse a boot');
    });
});

// ─── 03 — behavioral: the REAL throwError via createTestInstance ──────────────
describe('#CE1 §03 — behavioral: real throwError, capturing mock response', function () {

    var FW2 = require('../fw');
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW2;
    require('module').Module._initPaths();
    require(path.join(FW2, 'helpers'));              // injects _/getPath/requireJSON/setPath globals
    setPath('gina', { core: path.join(FW2, 'core') });
    var SuperController = require(SOURCE);

    function mkRes() {
        var calls = { writeHead: [], setHeader: [], end: [] };
        return {
            statusCode  : 200,
            headersSent : false,
            _calls      : calls,
            getHeaders  : function () { return {}; },
            getHeader   : function () { return undefined; },
            setHeader   : function (k, v) { calls.setHeader.push([k, v]); },
            writeHead   : function () { calls.writeHead.push([].slice.call(arguments)); },
            end         : function (body) { calls.end.push(body); }
        };
    }

    function mkInstance(transientErrorsBlock) {
        var res = mkRes();
        var serverConf = {
            protocol          : 'http/1.1',
            coreConfiguration : { mime: { json: 'application/json', html: 'text/html' } }
        };
        if (typeof transientErrorsBlock !== 'undefined') {
            serverConf.transientErrors = transientErrorsBlock;
        }
        var inst = SuperController.createTestInstance({
            req : {
                url         : '/x',
                method      : 'GET',
                httpVersion : '1.1',
                headers     : {},
                params      : {},
                get         : {},
                routing     : { rule: 'x@b', param: { control: 'test' } }
            },
            res  : res,
            next : function () {},
            options : {
                rule           : 'x',
                control        : 'test',
                renderingStack : [],
                conf : {
                    bundle   : 'b',
                    encoding : 'utf-8',
                    server   : serverConf,
                    content  : { routing: { x: {} } }
                }
            }
        });
        return { inst: inst, res: res };
    }

    function transientErr() {
        var err = new Error('connection reset by the datastore');
        err.isTransient     = true;
        err.transientReason = 'socket';
        return err;
    }

    function retryAfterHeaders(res) {
        return res._calls.setHeader.filter(function (h) { return h[0] === 'Retry-After'; });
    }

    it('A — opt-out default: a transient error still renders 500 with no Retry-After', function () {
        var h = mkInstance(); // no transientErrors block at all
        h.inst.throwError(transientErr());
        assert.equal(h.res._calls.writeHead[0][0], 500, 'status stays 500');
        assert.equal(retryAfterHeaders(h.res).length, 0, 'no Retry-After header');
        var body = JSON.parse(h.res._calls.end[0]);
        assert.equal(body.status, 500);
    });

    it('B — opt-in: transient 500 upgrades to 503 + Retry-After 30 + standard message; ref survives', function () {
        var h = mkInstance({ enabled: true });
        var err = transientErr();
        h.inst.throwError(err);
        assert.equal(h.res._calls.writeHead[0][0], 503, 'status upgraded to 503');
        var hdrs = retryAfterHeaders(h.res);
        assert.equal(hdrs.length, 1, 'exactly one Retry-After header');
        assert.equal(hdrs[0][1], '30', 'default delta-seconds');
        var body = JSON.parse(h.res._calls.end[0]);
        assert.equal(body.status, 503);
        assert.equal(body.error, 'Service Unavailable', 'error field carries the standard 503 text');
        assert.equal(body.message, err.message, 'message keeps its existing semantics (vendor text)');
        assert.ok(/^[\w.\-]{1,32}$/.test(body.ref), '#ERRREF ref still rides the upgraded body');
    });

    it('C — opt-in with custom retryAfter + message', function () {
        var h = mkInstance({ enabled: true, retryAfter: 120, message: 'Please retry shortly.' });
        h.inst.throwError(transientErr());
        assert.equal(h.res._calls.writeHead[0][0], 503);
        assert.equal(retryAfterHeaders(h.res)[0][1], '120');
        var body = JSON.parse(h.res._calls.end[0]);
        assert.equal(body.error, 'Please retry shortly.');
    });

    it('D — opt-in: a PERMANENT error (isTransient false) stays 500, no header', function () {
        var h = mkInstance({ enabled: true });
        var err = new Error('duplicate key');
        err.isTransient     = false;
        err.transientReason = null;
        h.inst.throwError(err);
        assert.equal(h.res._calls.writeHead[0][0], 500);
        assert.equal(retryAfterHeaders(h.res).length, 0);
    });

    it('E — opt-in: an EXPLICIT non-500 status is respected (no upgrade, no header)', function () {
        var h = mkInstance({ enabled: true });
        h.inst.throwError(404, transientErr());
        assert.equal(h.res._calls.writeHead[0][0], 404, 'explicit code preserved');
        assert.equal(retryAfterHeaders(h.res).length, 0);
    });

    it('F — opt-in: the 2-arg errorObj shape (site-2 resolution) upgrades too', function () {
        var h = mkInstance({ enabled: true });
        h.inst.throwError({ status: 500, error: 'db down', isTransient: true }, undefined);
        assert.equal(h.res._calls.writeHead[0][0], 503, 'site-2 resolution upgraded');
        assert.equal(retryAfterHeaders(h.res).length, 1);
        var body = JSON.parse(h.res._calls.end[0]);
        assert.equal(body.status, 503);
        assert.equal(body.error, 'Service Unavailable');
    });

    it('G — opt-in via a malformed block (enabled: "true" string) stays OFF', function () {
        var h = mkInstance({ enabled: 'true' });
        h.inst.throwError(transientErr());
        assert.equal(h.res._calls.writeHead[0][0], 500, 'string "true" must not enable');
        assert.equal(retryAfterHeaders(h.res).length, 0);
    });
});

// ─── 04 — behavioral: the EXTRACTED conf reader (control-gated) ───────────────
describe('#CE1 §04 — _getTransientErrorsConf normalization matrix (extracted real bytes)', function () {

    var READER_RE = /var _getTransientErrorsConf = function\(bundleConf\) \{[\s\S]*?\n\};/;
    var m = CTRL_SRC.match(READER_RE);

    it('extraction anchor resolves (instrument control)', function () {
        assert.ok(m, 'the reader body extracts from controller.js');
    });

    // eval the REAL bytes in an isolated scope — no replica to drift
    function reader() {
        /* eslint-disable no-new-func */
        return new Function(m[0] + '\nreturn _getTransientErrorsConf;')();
    }

    it('absent / non-object shapes → defaults (off, 30, null)', function () {
        var fn = reader();
        [undefined, null, {}, { server: {} },
         { server: { transientErrors: 'yes' } },
         { server: { transientErrors: 42 } }].forEach(function (conf) {
            var out = fn(conf);
            assert.deepEqual(out, { enabled: false, retryAfter: 30, message: null });
        });
    });

    it('enabled: strictly boolean true only', function () {
        var fn = reader();
        assert.equal(fn({ server: { transientErrors: { enabled: true } } }).enabled, true);
        [false, 'true', 1, 0, [], {}, 'yes'].forEach(function (v) {
            assert.equal(fn({ server: { transientErrors: { enabled: v } } }).enabled, false,
                'enabled must reject ' + JSON.stringify(v));
        });
    });

    it('retryAfter: integer within 1..86400, else the 30 default', function () {
        var fn = reader();
        assert.equal(fn({ server: { transientErrors: { retryAfter: 1 } } }).retryAfter, 1);
        assert.equal(fn({ server: { transientErrors: { retryAfter: 120 } } }).retryAfter, 120);
        assert.equal(fn({ server: { transientErrors: { retryAfter: 86400 } } }).retryAfter, 86400);
        [0, -5, 86401, 1.5, '60', NaN, Infinity, null].forEach(function (v) {
            assert.equal(fn({ server: { transientErrors: { retryAfter: v } } }).retryAfter, 30,
                'retryAfter must reject ' + String(v));
        });
    });

    it('message: non-empty string, else null', function () {
        var fn = reader();
        assert.equal(fn({ server: { transientErrors: { message: 'Try later' } } }).message, 'Try later');
        ['', 42, {}, [], null].forEach(function (v) {
            assert.equal(fn({ server: { transientErrors: { message: v } } }).message, null,
                'message must reject ' + JSON.stringify(v));
        });
    });

    it('TOTAL: a hostile getter on the block cannot throw out of the reader', function () {
        var fn = reader();
        var conf = { server: {} };
        Object.defineProperty(conf.server, 'transientErrors', {
            enumerable: true,
            get: function () { throw new Error('hostile'); }
        });
        var out = fn(conf);
        assert.deepEqual(out, { enabled: false, retryAfter: 30, message: null });
    });
});

// ─── 05 — invariants: the server.js twin stays upgrade-free ───────────────────
describe('#CE1 §05 — deliberate divergence: no upgrade machinery in the server twin', function () {

    it('slice anchors resolve (instrument control)', function () {
        assert.ok(SRV_T_START > -1 && SRV_T_END > SRV_T_START, 'server throwError slice anchors');
    });

    it('the server-side throwError carries no Retry-After and no isTransient reads', function () {
        var active = stripComments(SRV_T);
        assert.equal(active.indexOf('Retry-After'), -1,
            'stamped connector errors surface through controller actions only');
        assert.equal(active.indexOf('isTransient'), -1);
    });
});
