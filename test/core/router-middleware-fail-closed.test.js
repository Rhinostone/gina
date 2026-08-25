'use strict';
// #B368 — an unresolvable middleware declaration FAILS CLOSED, and this file pins it.
//
// A route whose bundle declares a middleware that resolves to nothing answers 501 —
// consumer-reported (measured on their route AND an arbitrary control route), then
// verified first-hand 2026-08-15 at the PUBLISHED v0.6.8 tag: the behaviour is a
// DESIGNED, explicit guard at two independent points in `processMiddlewares`
// (core/router.js), not an incidental throw into a generic handler.
//
// Why pinning matters although today's behaviour is correct: an unresolvable
// middleware name is a consumer MISCONFIGURATION, and the entire security value
// sits in which way it fails. Fail-closed = a typo'd or half-removed middleware
// name yields 501. Fail-open would mean the route silently serves with NO
// middleware — a route the operator believes is authenticated, is not. Nothing
// pinned this, so an unrelated router refactor could flip it silently.
//
// The live 501 was verified externally (reporter + the 2026-08-15 session); this
// file pins the STRUCTURE that produces it against refactors, per the house
// source-inspection pattern. Both guards must remain `return`s into
// `throwError(res, 501, …)` — the `return` is the fail-closed property: without
// it, execution falls through toward the action-invoking continuation.

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW = require('../fw');
var ROUTER_SRC = path.join(FW, 'core/router.js');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }
function count(hay, needle) { return hay.split(needle).length - 1; }

// Extracts the processMiddlewares function body (balanced-brace walk from its
// declaration), so every pin below is scoped to the function that owns the
// invariant — not to string luck elsewhere in a 4-figure-line file.
function middlewareBlock() {
    var src   = read(ROUTER_SRC);
    var start = src.indexOf('var processMiddlewares = function(');
    assert.ok(start > -1, 'extraction anchor not found: processMiddlewares');
    var open = src.indexOf('{', start);
    var depth = 0, i = open;
    for (; i < src.length; ++i) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    assert.equal(depth, 0, 'unbalanced braces walking processMiddlewares');
    return src.slice(start, i + 1);
}


describe('01 - router: unresolvable middleware declarations fail CLOSED (#B368)', function() {

    var block;
    before(function() { block = middlewareBlock(); });

    it('01.1 guard 1 — alias resolution: bundle miss AND shared miss => return throwError 501', function() {
        var bundleCheck = block.indexOf('if ( !filenameObj.existsSync() )');
        var sharedCheck = block.indexOf('if ( !sharedFilenameObj.existsSync() )');
        var guard       = block.indexOf("return serverInstance.throwError(res, 501, new Error('middleware not found '");
        assert.ok(bundleCheck > -1, 'the bundle-path existence check must exist');
        assert.ok(sharedCheck > bundleCheck, 'the shared-path fallback check must nest after it');
        assert.ok(guard > sharedCheck, 'and only a double miss may reach the 501');
    });

    it('01.2 guard 2 — the named constructor is gated after instantiation => return throwError 501', function() {
        var gate  = block.indexOf('if ( !middleware[constructor] )');
        var guard = block.indexOf('return serverInstance.throwError(res, 501, new Error(\'contructor [ \'');
        assert.ok(gate > -1, 'the constructor gate must exist');
        assert.ok(guard > gate, 'and must answer 501');
    });

    it('01.3 the fail-closed property itself: BOTH 501s are `return`s — no fall-through to the action', function() {
        // The action-running continuation is `cb(action, req, res, next)`; a
        // guard that logs-and-continues would reach it. The `return ` prefix is
        // what forbids that, so it is the byte this test exists to hold.
        assert.equal(count(block, 'return serverInstance.throwError(res, 501'), 2,
            'exactly two 501 guards, each a return — a third means a new guard to review, one means a guard lost its return or was removed');
        assert.ok(block.indexOf('return cb(action, req, res, next);') > -1,
            'control: the action-invoking continuation exists (the thing the returns protect against)');
    });

    it('01.4 CONTROL: the no-middlewares fast path is untouched (green in both trees)', function() {
        assert.ok(middlewareBlock().indexOf('if (!middlewares || middlewares.length == 0)') > -1);
    });
});
