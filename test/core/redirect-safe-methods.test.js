/**
 * #B353 — a redirect treats HEAD as the safe method it is, not as a wrong method.
 *
 * `redirect()` carries a gate meant to stop an UNSAFE method being replayed against
 * the redirect target — its own warning reads "A redirection is not permitted in this
 * scenario", which is a POST/PUT/DELETE concern. It tested `req.method !== 'GET'`, so
 * HEAD was swept in with them, and every consequence was wrong for a safe method:
 *
 *   - a "trying to redirect using the wrong method" warning on a route that explicitly
 *     lists HEAD in its own `method` list (the auto-generated `webroot@<bundle>` route
 *     does exactly that), training readers to ignore a real warning;
 *   - a 303, telling the client to re-issue as GET and fetch a response body it
 *     deliberately did not ask for;
 *   - and, because the gate also switched `req.method` to GET, `originalMethod` and
 *     `req.method` stopped matching, which turned on the `inheritedData` channel and
 *     appended a copy of the request params to the target that the same request as a
 *     GET never receives.
 *
 * Admitting HEAD converges it on GET. Measured on a booted bundle over real HTTP,
 * before -> after, with unsafe methods as the control that the gate still fires:
 *
 *   HEAD /<webroot>?t=V   303 /<webroot>/?inheritedData=%7B…%7D  ->  302 /<webroot>/?t=V
 *   GET  /<webroot>?t=V   302 /<webroot>/?t=V                    ->  unchanged
 *   POST /<webroot>?t=V   303 …&inheritedData=%7B…%7D            ->  unchanged (303)
 *   PUT  /<webroot>?t=V   303 …&inheritedData=%7B…%7D            ->  unchanged (303)
 *
 * The POST/PUT arms are the load-bearing ones: a gate that stopped firing for
 * everything would satisfy the HEAD assertion just as well, so "HEAD is 302" only
 * means something alongside "POST is still 303".
 *
 * Run standalone:
 *   node --test test/core/redirect-safe-methods.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW             = require('../fw');
var CONTROLLER_SRC = path.join(FW, 'core/controller/controller.js');


// ---------------------------------------------------------------------------
// 01 — which methods take the wrong-method branch
// ---------------------------------------------------------------------------
describe('01 - #B353 redirect wrong-method gate: HEAD is safe, unsafe methods still gated', function() {

    // Models the shipped condition; §02 pins the real source so the two cannot
    // silently diverge.
    function takesWrongMethodBranch(reqMethod, originalMethod) {
        var _reqMethod  = reqMethod.toUpperCase();
        var _origMethod = originalMethod ? originalMethod.toUpperCase() : null;
        return (
            ( _reqMethod !== 'GET' && _reqMethod !== 'HEAD' )
            ||
            ( _origMethod && _origMethod !== 'GET' && _origMethod !== 'HEAD' )
        ) ? true : false;
    }

    it('GET does not take the branch (unchanged)', function() {
        assert.equal(takesWrongMethodBranch('GET', 'GET'), false);
    });

    it('HEAD does not take the branch — the fix', function() {
        assert.equal(
            takesWrongMethodBranch('HEAD', 'HEAD'), false,
            'HEAD is GET without a body; redirecting it is not a wrong-method scenario'
        );
    });

    it('HEAD is admitted in BOTH clauses, not just the first', function() {
        // originalMethod carries the pre-switch method; a HEAD there must not
        // re-trigger the gate either.
        assert.equal(takesWrongMethodBranch('GET', 'HEAD'), false);
        assert.equal(takesWrongMethodBranch('HEAD', 'GET'), false);
    });

    it('lower-case method names are handled (the gate upper-cases first)', function() {
        assert.equal(takesWrongMethodBranch('head', 'head'), false);
        assert.equal(takesWrongMethodBranch('post', 'post'), true);
    });

    it('a missing originalMethod does not by itself trigger the gate', function() {
        assert.equal(takesWrongMethodBranch('HEAD', null), false);
        assert.equal(takesWrongMethodBranch('GET', undefined), false);
    });

    // --- the controls: the gate must STILL fire for unsafe methods ---

    it('CONTROL — POST still takes the branch', function() {
        assert.equal(
            takesWrongMethodBranch('POST', 'POST'), true,
            'narrowing the gate to admit HEAD must not disable it for unsafe methods'
        );
    });

    it('CONTROL — PUT / DELETE / PATCH still take the branch', function() {
        ['PUT', 'DELETE', 'PATCH'].forEach(function(m) {
            assert.equal(takesWrongMethodBranch(m, m), true, m + ' must still be gated');
        });
    });

    it('CONTROL — a POST already switched to GET still takes the branch via originalMethod', function() {
        // This is the branch's original purpose: the unsafe method is remembered in
        // originalMethod even after req.method has been rewritten.
        assert.equal(takesWrongMethodBranch('GET', 'POST'), true);
    });

});


// ---------------------------------------------------------------------------
// 02 — source structure
// ---------------------------------------------------------------------------
describe('02 - #B353 source structure: the gate admits HEAD', function() {

    it('both clauses test for HEAD alongside GET', function() {
        var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');
        assert.ok(
            src.indexOf("( _reqMethod !== 'GET' && _reqMethod !== 'HEAD' )") > -1,
            'expected the request-method clause to admit HEAD'
        );
        assert.ok(
            src.indexOf("( _origMethod && _origMethod !== 'GET' && _origMethod !== 'HEAD' )") > -1,
            'expected the original-method clause to admit HEAD'
        );
    });

    it('the gate still uses string comparison, not a regex (#P13)', function() {
        var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');
        var gateIdx = src.indexOf("( _reqMethod !== 'GET' && _reqMethod !== 'HEAD' )");
        assert.ok(gateIdx > -1, 'gate not found');
        // #P13 deliberately replaced a regex test here; one must not come back.
        //
        // The window is stripped of `//` comment text before the negative check:
        // BOTH the pre-existing `#P13` note and this fix's own comment legitimately
        // name the old regex form in prose, so an un-stripped window can never pass —
        // the classic case of a negative pin tripping on the file's own comments.
        var window   = src.substring(gateIdx - 400, gateIdx + 400);
        var codeOnly = window.split('\n').map(function(line) {
            return line.replace(/\/\/.*$/, '');
        }).join('\n');
        assert.ok(
            codeOnly.indexOf('.test(req.method') < 0 && codeOnly.indexOf('.test(_reqMethod') < 0,
            'the wrong-method gate must not reintroduce a regex test (#P13)'
        );
        // and the comment-stripping itself must not have emptied the window
        assert.ok(
            codeOnly.indexOf('_reqMethod') > -1,
            'comment-stripping removed the code under test — the pin would pass vacuously'
        );
    });

    it('the warning and the 303 are still reachable for the methods that deserve them', function() {
        var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');
        assert.ok(src.indexOf('trying to redirect using the wrong method') > -1,
            'the wrong-method warning must survive for unsafe methods');
        assert.ok(src.indexOf('code = 303') > -1,
            'the 303 must survive for unsafe methods');
    });

});
