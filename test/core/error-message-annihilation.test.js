'use strict';
/**
 * #B112 — `err.stack|err.message|err` was a BITWISE OR at nine sites, annihilating a
 * real Error to the NUMBER 0. `+` binds tighter than `|`, so `'' + err.stack | err.message | err`
 * parses as `(('' + err.stack) | err.message) | err` → every operand coerces to NaN → 0.
 * The fix is `||` (logical). A source pin on this line would ratify the bug forever — it never
 * EVALUATES that the expression computes to 0 (the reason it survived at nine sites). So §01/§02
 * DRIVE the
 * path and assert the runtime value/effect, each with an in-test SUBTRACT that discriminates
 * the fix from the bug; §03 is the drift-proof source + dist guard (a syntactic invariant —
 * the appropriate use of a source check).
 *
 * Measured (Node 25): `res.end(0)` (the number the buggy form yields) does NOT throw
 * ERR_INVALID_ARG_TYPE — it serves an EMPTY body. So sites 3-4 are MEDIUM (lost error), not a
 * crash. The fix removes the number-0 path entirely regardless of Node version.
 *
 * Suites:
 *  01 — value semantics: the fixed `||` form is the real error; SUBTRACT: the `|` form is 0.
 *  02 — response-body effect (real http): fixed serves the error; SUBTRACT: buggy serves "".
 *  03 — source + dist guard: the bitwise `err.stack|err.message` form is globally absent.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var http   = require('node:http');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

// ─── 01 — value semantics (the jsdoc.md-prescribed behavioral core) ───────────
describe('#B112 §01 — the composed error expression yields the real error, not 0', function () {

    it('fixed 3-operand form (err.stack || err.message || err) is the real error string', function () {
        var err = new Error('B112 cause alpha');
        var v = err.stack || err.message || err;
        assert.equal(typeof v, 'string');
        assert.ok(v.indexOf('B112 cause alpha') >= 0, 'carries the real message');
        assert.notEqual(v, 0);
    });

    it('fixed 2-operand CLI form (err.stack || err.message) is the real error string', function () {
        var err = new Error('B112 cause beta');
        var v = err.stack || err.message;
        assert.equal(typeof v, 'string');
        assert.ok(v.indexOf('B112 cause beta') >= 0);
    });

    it('SUBTRACT: the pre-fix bitwise form is the NUMBER 0 (the annihilation)', function () {
        var err = new Error('B112 cause gamma');
        var buggy3 = '' + err.stack | err.message | err;   // 3-operand server/browser shape
        var buggy2 = err.stack | err.message;              // 2-operand CLI shape
        assert.equal(buggy3, 0);
        assert.equal(typeof buggy3, 'number');
        assert.equal(buggy2, 0);
        // the discriminator: fixed !== buggy
        assert.notEqual(err.stack || err.message || err, buggy3);
    });

    it('fallback survives an absent .stack — and the isaac:2002 parens are load-bearing', function () {
        var err = new Error('B112 no-stack');
        delete err.stack;
        // fixed, parenthesised (the shipped isaac:2002 shape): falls through to the message.
        var fixed = '' + (err.stack || err.message || err);
        assert.equal(fixed, 'B112 no-stack');
        // WRONG (unparenthesised): `'' + err.stack` binds first → the truthy string "undefined"
        // short-circuits the chain. This is why isaac:2002 must wrap the ||-chain in parens.
        var wrong = '' + err.stack || err.message || err;
        assert.equal(wrong, 'undefined');
    });
});

// ─── 02 — response-body effect, driven through a real http response ───────────
describe('#B112 §02 — the 500 response body carries the error, not an empty body', function () {

    // Fire one GET against a throwaway server, resolve { status, body }, always close it
    // (no lingering handles → the test file exits cleanly).
    function serveOnce(handler) {
        return new Promise(function (resolve, reject) {
            var srv = http.createServer(handler);
            srv.listen(0, '127.0.0.1', function () {
                var port = srv.address().port;
                http.get('http://127.0.0.1:' + port, function (r) {
                    var body = '';
                    r.on('data', function (c) { body += c; });
                    r.on('end', function () { srv.close(function () { resolve({ status: r.statusCode, body: body }); }); });
                }).on('error', function (e) { srv.close(function () { reject(e); }); });
            });
        });
    }

    it('FIXED: response.end("" + (err.stack || err.message || err)) serves the real error', async function () {
        var err = new Error('B112 response cause');
        var out = await serveOnce(function (req, res) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('' + (err.stack || err.message || err));   // exact shipped isaac:2002 shape
        });
        assert.equal(out.status, 500);
        assert.ok(out.body.indexOf('B112 response cause') >= 0, 'the body carries the real error');
    });

    it('SUBTRACT: the pre-fix response.end("" + err.stack | err.message | err) serves an EMPTY body', async function () {
        var err = new Error('B112 response cause');
        var out = await serveOnce(function (req, res) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('' + err.stack | err.message | err);   // buggy shape → end(0) → empty body
        });
        assert.equal(out.status, 500);
        assert.equal(out.body, '', 'the annihilated error yields an empty body — the measured bug');
    });
});

// ─── 03 — drift-proof source + dist guard (a syntactic invariant) ─────────────
describe('#B112 §03 — the bitwise err.stack|err.message form is globally absent', function () {

    // Sites whose `err` name is literal (all source + the un-minified dist bundle).
    var LITERAL_SITES = [
        'core/server.js',
        'core/server.isaac.js',
        'core/asset/plugin/src/vendor/gina/core.js',
        'lib/cmd/protocol/set.js',
        'lib/cmd/port/reset.js',
        'lib/cmd/project/add.js',
        'core/asset/plugin/dist/vendor/gina/js/gina.js'
    ];
    var BITWISE = /err\.stack\s*\|\s*err\.message/;   // single | only — validated NOT to match ||

    LITERAL_SITES.forEach(function (rel) {
        it(rel + ' — no bitwise err.stack|err.message', function () {
            var src = fs.readFileSync(path.join(FW, rel), 'utf8');
            assert.ok(!BITWISE.test(src), 'the annihilating bitwise-OR form is present in ' + rel);
        });
    });

    it('gina.min.js — no minified bitwise .stack|<var>, and the fixed .stack|| chain IS baked in', function () {
        var min = fs.readFileSync(path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js'), 'utf8');
        assert.ok(!/\.stack\|[A-Za-z_$]/.test(min), 'minified bitwise .stack|<var> present in gina.min.js');
        assert.ok(/\.stack\|\|/.test(min), 'the fixed .stack|| chain must be baked into the minified artifact');
    });

    it('server.isaac.js — the response.end site keeps the load-bearing parenthesised ||-chain', function () {
        var src = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');
        assert.ok(
            /response\.end\(''\+\s*\(err\.stack\|\|err\.message\|\|err\)\)/.test(src),
            'isaac:2002 must be response.end("" + (err.stack||err.message||err)) — parens preserve the fallback'
        );
    });
});
