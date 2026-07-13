var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

// helpers/context.js internal `throwError` must not crash when invoked from a
// DETACHED context (cron / timer / worker / bootstrap-time getLib). The
// per-request `router` context (core/router.js) is stored globally and never
// cleared, so a stale routerObj (dead response, `headersSent === true`, a
// non-callable `next`) lingers and is observed by non-request callers. Before
// the fix, throwError entered the request-response branch and called the stale
// `next()` -> `TypeError: next is not a function`, MASKING the real error
// (e.g. a failed getLib() inside a mailing cron).
var SOURCE = path.join(require('../fw'), 'helpers/context.js');

// Structural slice of the internal throwError function body (start of its
// declaration up to the next symbol, `getConfig`). Robust to internal edits.
function throwErrorBlock() {
    var src   = fs.readFileSync(SOURCE, 'utf8');
    var start = src.indexOf('var throwError = function(code, err, isFatal) {');
    assert.ok(start > -1, 'throwError declaration present in helpers/context.js');
    var end   = src.indexOf('getConfig = function', start);
    assert.ok(end > start, 'getConfig follows throwError (end anchor)');
    return src.slice(start, end);
}

// ---------------------------------------------------------------------------
// Faithful replicas — kept in lockstep with the shipped throwError by the
// source pins in §01. `getRouter` mirrors getContext('router'); `emerg`
// mirrors console.emerg. The `isUsingTemplate = isUsingTemplate` self-reference
// (always undefined -> JSON branch) is a pre-existing quirk, preserved verbatim.
// ---------------------------------------------------------------------------
function makeThrowError(getRouter, emerg) {          // POST-fix (shipped)
    return function throwError(code, err, isFatal) {
        if (arguments.length < 2) { err = code; code = 500; }
        var router = getRouter(),
            res    = router ? router.response : null,
            next   = router ? router.next : null;

        if (res && !res.headersSent) {
            var hasViews = router.hasViews, isUsingTemplate = isUsingTemplate;
            if (!hasViews || !isUsingTemplate) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end('json'); }
            else { res.writeHead(code, { 'Content-Type': 'text/html' }); res.end('html'); }
            return;
        }
        if (res && res.headersSent && typeof next == 'function') { next(); return; }
        if (isFatal && /^true$/.test(isFatal)) { emerg(err.stack || err.message || err); return; }
        throw err;
    };
}

function makePreFixThrowError(getRouter, emerg) {     // PRE-fix (subtract control)
    return function throwError(code, err, isFatal) {
        var router = getRouter();
        if (router) {
            var res = router.response, next = router.next,
                hasViews = router.hasViews, isUsingTemplate = isUsingTemplate;
            if (arguments.length < 2) { err = code; code = 500; }
            if (!hasViews || !isUsingTemplate) {
                if (!res.headersSent) { res.writeHead(code, {}); res.end('json'); }
                else { next(); }                     // <-- pre-fix crash site
            } else {
                if (!res.headersSent) { res.writeHead(code, {}); res.end('html'); }
                else { next(); }
            }
        } else {
            if (isFatal && /^true$/.test(isFatal)) { emerg(err.stack || err.message || err); return; }
            throw err;
        }
    };
}

// scenario router shapes
function liveWritable(sink) {
    return { response: { headersSent: false, writeHead: function (c, h) { sink.code = c; sink.headers = h; }, end: function (b) { sink.ended = b; } },
             next: function () { sink.nextCalled = true; }, hasViews: false, isUsingTemplate: false };
}
function liveHeadersSent(sink) {
    return { response: { headersSent: true }, next: function () { sink.nextCalled = true; }, hasViews: false, isUsingTemplate: false };
}
function staleCron() {   // stale global router left by a completed request; next non-callable
    return { response: { headersSent: true }, next: undefined, hasViews: false, isUsingTemplate: false };
}
var NO_ROUTER = function () { return null; };


describe('helpers/context.js throwError — detached-context robustness (§01 source pins)', function () {

    it('guards next() behind a typeof check (no bare next() call)', function () {
        var block = throwErrorBlock();
        assert.match(block, /typeof next == 'function'\s*\)\s*\{\s*next\(\);/,
            'next() must be gated by `typeof next == \'function\'`');
        assert.equal((block.match(/next\(\)/g) || []).length, 1,
            'exactly one next() call (pre-fix two-branch shape must be gone)');
    });

    it('honors isFatal (emerg-log) before the final throw fallback', function () {
        var block    = throwErrorBlock();
        assert.match(block, /if \(\s*isFatal && \/\^true\$\/\.test\(isFatal\)\s*\)\s*\{[\s\S]{0,120}?console\.emerg\(/,
            'isFatal branch emerg-logs');
        var emergIdx = block.indexOf('console.emerg(');
        var throwIdx = block.lastIndexOf('throw err');
        assert.ok(emergIdx > -1 && throwIdx > emergIdx,
            '`throw err` is the final fallback, after the isFatal/emerg branch');
    });

    it('normalizes arguments before reading the router context', function () {
        var block = throwErrorBlock();
        assert.ok(block.indexOf('arguments.length < 2') < block.indexOf("getContext('router')"),
            'the 1-arg normalization runs before the router read');
    });

    it('the guarded next() precedes the detached (emerg/throw) fallback', function () {
        var block   = throwErrorBlock();
        var nextIdx = block.indexOf('next();');
        var emergIdx = block.indexOf('console.emerg(');
        assert.ok(nextIdx > -1 && nextIdx < emergIdx,
            'live headers-sent next() branch comes before the detached fallback');
    });
});


describe('helpers/context.js throwError — behaviour (§02 replica)', function () {

    it('stale-router cron + isFatal=true: does NOT crash, emerg-logs the real error', function () {
        var emergs = [];
        var fn = makeThrowError(staleCron, function (m) { emergs.push(m); });
        assert.doesNotThrow(function () { fn(500, new Error('lib load failed'), true); });
        assert.equal(emergs.length, 1, 'the masked error is emerg-logged (surfaced), not swallowed silently');
    });

    it('stale-router cron + isFatal not set: THROWS the real error (surfaced to caller)', function () {
        var real = new Error('lib load failed');
        var fn = makeThrowError(staleCron, function () {});
        assert.throws(function () { fn(500, real); }, function (e) { return e === real; },
            'without isFatal the real error is thrown, not masked');
    });

    it('live request, headers not sent: renders the error response (unchanged)', function () {
        var sink = {};
        var fn = makeThrowError(function () { return liveWritable(sink); }, function () { assert.fail('emerg must not fire on a live request'); });
        fn(503, new Error('boom'), true);
        assert.equal(sink.code, 503, 'writeHead called with the status');
        assert.equal(sink.ended, 'json', 'response ended (preserved quirk: always JSON branch)');
        assert.ok(!sink.nextCalled, 'next() not called on the writable path');
    });

    it('live request, headers already sent + callable next: hands back to the chain (unchanged)', function () {
        var sink = {};
        var fn = makeThrowError(function () { return liveHeadersSent(sink); }, function () { assert.fail('emerg must not fire'); });
        assert.doesNotThrow(function () { fn(500, new Error('boom')); });
        assert.ok(sink.nextCalled, 'next() called when it is genuinely a function');
    });

    it('no router + isFatal=true: emerg-logs and returns (bootstrap path)', function () {
        var emergs = [];
        var fn = makeThrowError(NO_ROUTER, function (m) { emergs.push(m); });
        assert.doesNotThrow(function () { fn(500, new Error('printenv failed'), true); });
        assert.equal(emergs.length, 1);
    });

    it('no router + isFatal not set: throws the error', function () {
        var real = new Error('config load failed');
        var fn = makeThrowError(NO_ROUTER, function () {});
        assert.throws(function () { fn(500, real); }, function (e) { return e === real; });
    });
});


describe('helpers/context.js throwError — SUBTRACT (§03 pre-fix reproduces the incident)', function () {

    it('pre-fix throwError CRASHES with the exact reported TypeError on the stale cron', function () {
        var fn = makePreFixThrowError(staleCron, function () {});
        assert.throws(function () { fn(500, new Error('lib load failed'), true); },
            /next is not a function/,
            'pre-fix code reproduces `TypeError: next is not a function` (the reported crash)');
    });

    it('pre-fix MASKS the real error even without isFatal (TypeError, not the real error)', function () {
        var real = new Error('lib load failed');
        var fn = makePreFixThrowError(staleCron, function () {});
        assert.throws(function () { fn(500, real); }, function (e) {
            return e instanceof TypeError && e !== real;   // the masking the fix removes
        });
    });
});
