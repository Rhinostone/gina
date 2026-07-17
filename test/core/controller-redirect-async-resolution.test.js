'use strict';
/**
 * #B121 — redirect(): awaited async route resolution + contained failure modes
 *
 * The relative-path redirect form (`self.redirect('/path')`) resolves its target
 * through `getRouteByUrl`, which is async since #B121 (it awaits the same
 * `compareUrls` machinery as the engine's routing loop). The historical
 * un-awaited call could never match, and its `false` sentinel — written verbatim
 * onto `req.routing` — killed the whole bundle downstream (the strict-mode
 * primitive write in the response-header composer; see
 * server-completeheaders-guard.test.js). `redirect()` is therefore async now, and
 * the resolution carries three safeguards, each a runtime VALUE this file drives
 * on the SHIPPED bytes (extract-and-execute — no replica to drift):
 *
 *   1. containment — a resolver rejection costs the request (throwError 500),
 *      never the process;
 *   2. a post-await release re-guard (the #M1/#B37 discipline) — a concurrent
 *      terminal exit during the await makes the redirect a silent no-op;
 *   3. the long-admitted 404 gap is closed — both resolution attempts missing
 *      throws a clean 404 instead of falling through with the `false` sentinel;
 *   4. no-clobber — the resolution lands in a local first, so a miss never
 *      replaces `req.routing`: the matcher derefs `request.routing` on the
 *      request it is handed (a `false` there silently voids its stamps), and
 *      the error reporters' diagnostics expect the request to keep the route
 *      that dispatched it (a `false` crashed the 404 reporter itself).
 *
 * Structure pins lock the shapes; the extracted-execution drives the values;
 * per-case ordering (re-guard BEFORE the 404 test) is proven behaviourally.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');
var src    = fs.readFileSync(SOURCE, 'utf8');

// the redirect body, end-anchored (jsdoc.md discipline: existence asserted, no char windows)
function sliceBetween(s, startAnchor, endAnchor) {
    var a = s.indexOf(startAnchor);
    assert.ok(a > -1, 'slice start anchor missing: ' + startAnchor);
    var b = s.indexOf(endAnchor, a);
    assert.ok(b > a, 'slice end anchor missing after start: ' + endAnchor);
    return s.slice(a, b);
}
var redirectBody = sliceBetween(src, 'this.redirect = async function(req, res, next) {', 'Move files to assets dir');

var activeBody = redirectBody.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');

describe('01 - redirect async resolution: structure pins', function() {

    it('redirect is an async function', function() {
        assert.ok(src.indexOf('this.redirect = async function(req, res, next) {') > -1);
    });

    it('both resolution attempts are awaited', function() {
        assert.ok(redirectBody.indexOf('resolvedRouting = await lib.routing.getRouteByUrl(rte, bundle, req.method, req);') > -1,
            'first attempt must be awaited — into the local, never straight onto req.routing');
        assert.ok(redirectBody.indexOf("resolvedRouting = await lib.routing.getRouteByUrl(rte, bundle, 'GET', req, true);") > -1,
            'the GET-override retry must be awaited — into the local');
    });

    it('negative (comment-stripped): no bare un-awaited getRouteByUrl assignment remains', function() {
        assert.ok(
            !/(?:req\.routing|resolvedRouting)\s*=\s*lib\.routing\.getRouteByUrl\(/.test(activeBody),
            'active code must not assign a bare (un-awaited) getRouteByUrl call'
        );
    });

    it('containment: the awaits sit inside a try whose catch routes to throwError(500)', function() {
        var tryIdx   = redirectBody.indexOf('try {');
        var await1   = redirectBody.indexOf('await lib.routing.getRouteByUrl(');
        var catchIdx = redirectBody.indexOf('catch (redirectRouteErr)');
        var t500     = redirectBody.indexOf('return self.throwError(500, redirectRouteErr);');
        assert.ok(tryIdx > -1 && await1 > -1 && catchIdx > -1 && t500 > -1, 'all four anchors must exist');
        assert.ok(tryIdx < await1 && await1 < catchIdx && catchIdx < t500,
            'order must be try → await → catch → throwError(500)');
    });

    it('the post-await release re-guard sits after the awaits and BEFORE the response captures', function() {
        var await2   = redirectBody.indexOf("getRouteByUrl(rte, bundle, 'GET', req, true)");
        var reGuard  = redirectBody.indexOf('if ( local.req == null ) {', await2);
        var captures = redirectBody.indexOf('res             = local.res;');
        assert.ok(await2 > -1 && reGuard > -1 && captures > -1, 'all three anchors must exist');
        assert.ok(await2 < reGuard && reGuard < captures,
            'the re-guard must run after resuming and before local.res/local.next are captured');
    });

    it('the 404 branch exists AFTER the re-guard (released instances stay silent)', function() {
        var reGuard = redirectBody.indexOf('if ( local.req == null ) {', redirectBody.indexOf('catch (redirectRouteErr)'));
        var miss404 = redirectBody.indexOf('redirect target not found');
        var t404    = redirectBody.indexOf('self.throwError(404,');
        assert.ok(reGuard > -1 && miss404 > -1 && t404 > -1, 'all three anchors must exist');
        assert.ok(reGuard < t404, 'the release re-guard must precede the 404 — a released request must not be error-responded');
    });

    it('no-clobber: req.routing is assigned exactly once in the resolution branch, AFTER the 404 test', function() {
        var branch  = sliceBetween(redirectBody, 'var resolvedRouting = null;', '//route = route = req.routing.name;');
        var assigns = branch.match(/req\.routing\s*=[^=]/g) || [];
        assert.equal(assigns.length, 1,
            'exactly one req.routing assignment in the branch (the success-path adoption)');
        var t404 = branch.indexOf('self.throwError(404,');
        var asg  = branch.indexOf('req.routing = resolvedRouting;');
        assert.ok(t404 > -1 && asg > -1, 'both anchors must exist');
        assert.ok(t404 < asg,
            'the adoption must follow the 404 miss-test — a miss never replaces the dispatching route');
    });
});

describe('02 - redirect async resolution: extract-and-execute the SHIPPED block', function() {

    var START = 'if ( !ignoreWebRoot || !isStaticRoute(rte, req.method, bundle, env, ctx.config.envConf) && !ignoreWebRoot ) {';
    var END   = 'res             = local.res;';

    function extractBlock() {
        var a = src.indexOf(START);
        assert.ok(a > -1, 'extraction control: start anchor not found');
        assert.equal(src.indexOf(START, a + 1), -1, 'extraction control: start anchor must be unique');
        var b = src.indexOf(END, a);
        assert.ok(b > a, 'extraction control: end anchor not found after start');
        var block = src.slice(a, b);
        assert.ok(block.indexOf('await lib.routing.getRouteByUrl(') > -1, 'extraction control: block must contain the awaited resolution');
        assert.ok(block.indexOf('} else {') > -1, 'extraction control: block must span the full if/else (brace balance)');
        return block;
    }

    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

    /**
     * Drives the shipped block. `resolver(callNo)` supplies each getRouteByUrl
     * result (return a value, or throw to model a rejection); it may mutate
     * `local` to model a concurrent terminal exit during the await.
     */
    async function runBlock(resolver, opts) {
        opts = opts || {};
        var calls  = { throwError: [], resolve: 0 };
        // an action always arrives with the route that dispatched it — the
        // no-clobber invariant is asserted against this object's IDENTITY
        var originalRouting = { name: 'origin@b121b', param: { control: 'origin' } };
        var req    = { method: opts.method || 'POST', routing: originalRouting };
        var local  = { req: req };
        var self   = { throwError: function (code, err) { calls.throwError.push({ code: code, err: err }); return false; } };
        var lib    = { routing: { getRouteByUrl: async function () {
            calls.resolve++;
            return resolver(calls.resolve, local);
        } } };
        var fn = new AsyncFunction(
            'ignoreWebRoot', 'isStaticRoute', 'rte', 'req', 'bundle', 'env', 'ctx', 'lib', 'self', 'local', 'method',
            "'use strict';\n" + extractBlock() + "\nreturn { req: req, method: method };");
        var out = await fn(
            false,                                    // ignoreWebRoot → take the resolution branch
            function () { return false; },            // isStaticRoute
            opts.rte || '/b121/landing', req, 'b121b', 'dev',
            { config: { envConf: {} } }, lib, self, local, null);
        return { calls: calls, req: req, out: out, originalRouting: originalRouting };
    }

    it('happy path: first attempt resolves → routing set, no throwError, single resolver call', async function() {
        var r = await runBlock(function () { return { name: 'landing@b121b', param: { file: 'landing' } }; });
        assert.equal(r.calls.resolve, 1);
        assert.equal(r.calls.throwError.length, 0);
        assert.equal(r.req.routing.name, 'landing@b121b');
    });

    it('GET-override retry: first attempt misses, second resolves → method flipped to GET', async function() {
        var r = await runBlock(function (n) { return n === 1 ? false : { name: 'landing@b121b', param: {} }; });
        assert.equal(r.calls.resolve, 2);
        assert.equal(r.calls.throwError.length, 0);
        assert.equal(r.req.method, 'GET', 'the successful override must flip req.method');
    });

    it('double miss → clean 404 through throwError, NEVER a false sentinel left on req.routing consumers', async function() {
        var r = await runBlock(function () { return false; });
        assert.equal(r.calls.throwError.length, 1);
        assert.equal(r.calls.throwError[0].code, 404);
        assert.match(r.calls.throwError[0].err.message, /redirect target not found/);
        assert.equal(r.req.routing, r.originalRouting,
            'no-clobber: a double miss must leave the dispatching route on req.routing (identity) — the 404 reporter derefs it');
    });

    it('resolver rejection → contained as throwError(500), never an escaping throw', async function() {
        var r = await runBlock(function () { throw new Error('validator backend down'); });
        assert.equal(r.calls.throwError.length, 1);
        assert.equal(r.calls.throwError[0].code, 500);
        assert.match(r.calls.throwError[0].err.message, /validator backend down/);
        assert.equal(r.req.routing, r.originalRouting,
            'no-clobber: a rejection (even on the retry, after a first miss) must leave the dispatching route on req.routing');
    });

    it('rejection on the RETRY specifically: the first miss must not have clobbered before the throw', async function() {
        var r = await runBlock(function (n) {
            if (n === 1) { return false; }               // first attempt misses
            throw new Error('backend died on the retry'); // retry rejects with the miss already recorded
        });
        assert.equal(r.calls.resolve, 2);
        assert.equal(r.calls.throwError.length, 1);
        assert.equal(r.calls.throwError[0].code, 500);
        assert.equal(r.req.routing, r.originalRouting,
            'the 500 reporter must see the dispatching route, not a false sentinel from the first miss');
    });

    it('release during the await → silent no-op: NO 404, NO 500 on a released instance (guard ORDER proven)', async function() {
        var r = await runBlock(function (n, local) {
            local.req = null;      // a concurrent terminal exit released the triplet mid-await
            return false;          // and the resolution also missed — the 404 must still NOT fire
        });
        assert.equal(r.calls.throwError.length, 0,
            'a released request must produce no error response at all — the re-guard precedes the 404 test');
    });
});
