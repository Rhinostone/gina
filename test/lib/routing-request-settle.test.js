'use strict';
/**
 * #B442 — route.request() must settle its caller exactly once, on every outcome.
 *
 * Before the fix `route.request` discarded the ClientRequest returned by `agent.get`,
 * so no `'error'` listener could ever be attached. Three consequences:
 *   (a) a dial failure whose code is carved out in lib/proc.js left the caller waiting
 *       forever with nothing logged (silent wedge);
 *   (b) a code that is NOT carved out (ETIMEDOUT / EHOSTUNREACH / ENETUNREACH) reached
 *       uncaughtException and took the bundle down via dismiss(pid, 'SIGTERM');
 *   (c) a response dying mid-body assigned to `err` and waited for an `'end'` event that
 *       never comes, so the assigned error was never delivered.
 * `options.timeout` was also inert: Node emits `'timeout'` without destroying the socket,
 * and the request object was unreachable, so nobody could act on it.
 *
 * Strategy: source inspection + extract-and-execute.
 * No live HTTP server, no framework bootstrap, no project required — the house pattern for
 * test/lib/routing-<name>.test.js. The behavioural suite executes the SHIPPED bytes of
 * `route.request` (sliced out of the real source and compiled with its free variables
 * injected), so there is no replica to drift. A brace walker cannot be used here: the
 * function body contains the regex literal /^\{/, which makes its braces unbalanced
 * (measured 20 open vs 19 close) — the slice is terminator-anchored instead, and both
 * anchors are uniqueness-guarded.
 *
 * Suites:
 *  01 — source pins: the settle guard, both error listeners, the timeout handler
 *  02 — extraction controls (the instrument that suite 03 depends on)
 *  03 — behaviour, driving the extracted real bytes against a fake agent
 *  04 — dist pins: the browser bundle carries lib/routing, so it must be rebuilt
 *
 * Red-first validated against `git show HEAD:<routing source>` before the fix landed:
 * arms A / B1 / D / E read false pre-fix and true post-fix, every pre-fix failure semantic
 * (two of them the real uncaught 'error' throw, not a harness ReferenceError). Arm B2 is a
 * GUARD LOCK, green on both revisions by construction — it was validated by a separate
 * semantic subtract that neutralised `if (settled) { return; }`, under which it reads
 * calls=2 and goes red while the happy-path control stays green. Arm C is the
 * non-discriminating control and must hold on both revisions.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var EventEmitter = require('events');

var FW          = require('../fw');
var ROUTING_SRC = path.join(FW, 'lib/routing/src/main.js');
var BUNDLE      = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var src = fs.readFileSync(ROUTING_SRC, 'utf8');

var DECL = 'route.request = function(ignoreWebRoot, options) {';
var TERM = '} // EO route.request()';

/**
 * Slices `route.request` out of the routing source between two uniqueness-guarded anchors.
 *
 * @param {string} source - the full lib/routing source text
 * @returns {string} the function expression, from `function(` to its closing brace
 * @inner
 */
function sliceRouteRequest(source) {
    if (source.split(DECL).length !== 2) {
        throw new Error('extraction: DECL is not unique (' + (source.split(DECL).length - 1) + ' hits)');
    }
    if (source.split(TERM).length !== 2) {
        throw new Error('extraction: TERM is not unique (' + (source.split(TERM).length - 1) + ' hits)');
    }
    var i = source.indexOf(DECL), j = source.indexOf(TERM);
    if (j < i) {
        throw new Error('extraction: TERM precedes DECL');
    }
    return source.substring(i + 'route.request = '.length, j + 1);
}

/**
 * Compiles the extracted source, injecting the free variables it closes over in the module.
 *
 * @param {string} fnSrc - the sliced function expression
 * @returns {function} a factory taking (path, isGFFCtx, require, console)
 * @inner
 */
function compileRouteRequest(fnSrc) {
    return new Function('path', 'isGFFCtx', 'require', 'console', 'return (' + fnSrc + ');');
}

var REGION      = sliceRouteRequest(src);
var REGION_CODE = REGION.split('\n').map(function (l) { return l.replace(/\/\/.*$/, ''); }).join('\n');
var FACTORY     = compileRouteRequest(REGION);

/**
 * Builds a scene: a fake http agent whose `get` returns a controllable ClientRequest stand-in.
 *
 * @param {object} opts - the `options` argument handed to route.request
 * @param {boolean} withCb - whether to pass a callback (false exercises fire-and-forget)
 * @returns {object} { made, calls, warns }
 * @inner
 */
function scene(opts, withCb) {
    var made = [], warns = [], calls = [];
    var agent = {
        get: function (url, options, onResponse) {
            var req = new EventEmitter();
            req.destroyArgs = [];
            // Models Node's measured contract (v25.3.0): `req.destroy(err)` emits 'error' with the
            // IDENTICAL error object, while a bare `req.destroy()` emits a different one
            // (ECONNRESET / 'socket hang up'). Modelling it is what lets the timeout arm assert the
            // caller is actually SETTLED, not merely that destroy() was called.
            req.destroy = function (e) {
                req.destroyArgs.push(e);
                if (e) { req.emit('error', e); }
            };
            made.push({ url: url, options: options, onResponse: onResponse, req: req });
            return req;
        }
    };
    var fakeConsole = {
        warn:  function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); },
        log:   function () {},
        error: function () {}
    };
    var fn  = FACTORY(undefined, false, function () { return agent; }, fakeConsole);
    var ctx = { webroot: '/', hostname: 'http://127.0.0.1:1', url: '/probe' };

    if (withCb) {
        fn.call(ctx, false, opts, function (err, data) { calls.push({ err: err, data: data }); });
    } else {
        fn.call(ctx, false, opts);
    }
    return { made: made, calls: calls, warns: warns };
}


// --- 01 - source pins: single-settle guard, error listeners, timeout handler -------------

describe('01 - route.request: source structure (#B442)', function () {

    it('anti-vacuity: comment stripping did not empty the region', function () {
        // Guards every negative pin below: a stripped-to-nothing window would pass them all.
        assert.equal(REGION_CODE.split('onAgentResponse').length - 1, 2,
            'the stripped region must still carry both onAgentResponse occurrences');
    });

    it('a single-settle latch exists', function () {
        assert.ok(REGION_CODE.indexOf('var settled = false;') > -1, 'the settled latch must be declared');
        assert.ok(REGION_CODE.indexOf('settled = true;') > -1, 'the latch must be raised on the first settle');
    });

    it('the callback is invoked from exactly one place', function () {
        // Pre-fix this was 2 (cb(err) in the end handler and cb(false, data) beside it);
        // every exit path now routes through settle(), which owns the only cb( call site.
        assert.equal(REGION_CODE.split('cb(').length - 1, 1,
            'cb( must appear exactly once in route.request - inside settle()');
        assert.equal(REGION_CODE.split('settle(').length - 1, 4,
            'settle( must be called from all four exit paths');
    });

    it('the ClientRequest is captured in BOTH branches', function () {
        assert.ok(REGION_CODE.indexOf('req = agent.get(url, options, onAgentResponse)') > -1,
            'the callback branch must capture the request');
        assert.ok(REGION_CODE.indexOf('req = agent.get(url, options)') > -1,
            'the fire-and-forget branch must capture the request too');
    });

    it("both branches attach req.on('error')", function () {
        assert.equal(REGION_CODE.split("req.on('error'").length - 1, 2,
            "req.on('error') must be attached in the callback AND the fire-and-forget branch");
    });

    it('options.timeout is honoured by a timeout handler', function () {
        assert.ok(REGION_CODE.indexOf("req.on('timeout'") > -1, 'a timeout listener must be attached');
        assert.ok(/e\.code\s*=\s*'ETIMEDOUT'/.test(REGION_CODE), 'the timeout error must carry code ETIMEDOUT');
        assert.ok(/req\.destroy\(e\)/.test(REGION_CODE), 'the timeout handler must destroy the request');
    });

    it('the response-error path no longer carries the stale mail-content message', function () {
        // The retired literal was framework-generic code carrying a caller-specific string.
        // Whole-file negative: no `// was:` comment may reintroduce it either.
        assert.equal(src.indexOf('Failed to get mail content'), -1,
            'the mail-content literal must be gone from the whole routing source');
        assert.ok(REGION_CODE.indexOf('route.request: response stream failed for ') > -1,
            'the response-stream failure must be reported with a generic, self-identifying message');
    });
});


// --- 02 - extraction controls -----------------------------------------------------------

describe('02 - route.request: extraction controls (#B442)', function () {

    it('both anchors are unique in the source', function () {
        assert.equal(src.split(DECL).length - 1, 1, 'the declaration anchor must appear exactly once');
        assert.equal(src.split(TERM).length - 1, 1, 'the terminator anchor must appear exactly once');
    });

    it('the slice compiles to a callable function', function () {
        assert.equal(typeof FACTORY, 'function', 'the factory must compile');
        var fn = FACTORY(undefined, false, function () { return { get: function () { return new EventEmitter(); } }; }, console);
        assert.equal(typeof fn, 'function', 'the extracted route.request must be a function');
        assert.equal(fn.length, 2, 'route.request keeps its declared (ignoreWebRoot, options) arity');
    });

    it('a brace walk would NOT work here - the region is deliberately unbalanced', function () {
        // Recorded so a future session does not "simplify" the terminator anchor into a walker:
        // the /^\{/ regex literal in the end handler opens a brace the parser never closes.
        assert.notEqual(
            REGION.split('{').length - 1,
            REGION.split('}').length - 1,
            'the region is brace-unbalanced, so only a terminator-anchored slice is safe'
        );
    });
});


// --- 03 - behaviour: the extracted real bytes against a fake agent -----------------------

describe('03 - route.request: settles exactly once on every outcome (#B442)', function () {

    it('A - a dial failure settles the caller with the error, exactly once', function () {
        // Pre-fix: the emit threw (no listener on the discarded request) - the bundle-kill path.
        var s = scene({}, true);
        var e = new Error('connect ECONNREFUSED 127.0.0.1:1');
        e.code = 'ECONNREFUSED';
        assert.doesNotThrow(function () { s.made[0].req.emit('error', e); },
            "the request must carry an 'error' listener");
        assert.equal(s.calls.length, 1, 'the caller must be settled exactly once');
        assert.equal(s.calls[0].err, e, 'the caller must receive the original Error');
    });

    it('B1 - a response dying mid-body settles the caller without an end event', function () {
        // Pre-fix: err was assigned and delivery waited on 'end', which never comes.
        var s = scene({}, true);
        var res = new EventEmitter();
        s.made[0].onResponse(res);
        res.emit('data', 'partial');
        res.emit('error', new Error('socket hang up'));
        assert.equal(s.calls.length, 1, 'a broken response stream must settle the caller');
        assert.ok(/^route\.request: response stream failed for /.test(s.calls[0].err),
            'the error must name the failing request');
    });

    it('B2 - GUARD LOCK: response error followed by end still settles exactly once', function () {
        // Green on the pre-fix bytes too (there, 'error' only assigned and 'end' delivered once):
        // this arm exists to lock the settled latch, and was validated by a subtract that
        // neutralised `if (settled) { return; }`, under which it reads 2 calls.
        var s = scene({}, true);
        var res = new EventEmitter();
        s.made[0].onResponse(res);
        res.emit('data', 'partial');
        res.emit('error', new Error('socket hang up'));
        res.emit('end');
        assert.equal(s.calls.length, 1, 'the settled latch must suppress the second delivery');
    });

    it('C - CONTROL: the happy path still delivers the body once', function () {
        // Non-discriminating by design: it holds before and after the fix. Its job is to prove
        // the harness can report success, so the failing arms above mean something.
        var s = scene({}, true);
        var res = new EventEmitter();
        s.made[0].onResponse(res);
        res.emit('data', 'hello ');
        res.emit('data', 'world');
        res.emit('end');
        assert.equal(s.calls.length, 1, 'exactly one delivery');
        assert.equal(s.calls[0].err, false, 'no error on the happy path');
        assert.equal(s.calls[0].data, 'hello world', 'the concatenated body is delivered');
    });

    it('D - a fire-and-forget dial failure warns instead of throwing', function () {
        // Pre-fix: this emit threw, which is how a call nobody awaited could kill the bundle.
        var s = scene({}, false);
        assert.doesNotThrow(function () { s.made[0].req.emit('error', new Error('EHOSTUNREACH')); },
            'the fire-and-forget branch must handle its own error');
        assert.equal(s.warns.length, 1, 'the failure must be reported once');
        assert.ok(/fire-and-forget/.test(s.warns[0]), 'the warning must identify the branch');
    });

    it('E - options.timeout destroys the request with an ETIMEDOUT error', function () {
        // Pre-fix: options.timeout reached http.get, Node emitted 'timeout', and nothing acted.
        var s = scene({ timeout: 1500 }, true);
        s.made[0].req.emit('timeout');
        var destroyed = s.made[0].req.destroyArgs;
        assert.equal(destroyed.length, 1, 'the request must be destroyed on timeout');
        assert.equal(destroyed[0].code, 'ETIMEDOUT', 'the destroy error must carry code ETIMEDOUT');
        assert.ok(/timed out after 1500ms/.test(destroyed[0].message), 'the message must name the budget');
        // The point of the option is that the CALLER is released, not that destroy() ran:
        assert.equal(s.calls.length, 1, 'the timeout must settle the caller exactly once');
        assert.equal(s.calls[0].err, destroyed[0], 'the caller must receive the timeout Error itself');
    });

    it('E2 - no timeout listener is attached when options.timeout is absent', function () {
        var s = scene({}, true);
        assert.equal(s.made[0].req.listenerCount('timeout'), 0,
            'the timeout handler must be opt-in via options.timeout');
        assert.equal(s.made[0].req.listenerCount('error'), 1,
            "the 'error' listener is unconditional");
    });
});


// --- 04 - dist pins: lib/routing is browser-bundled, so the bundle must be rebuilt -------

describe('04 - route.request: browser bundle carries the fix (#B442)', function () {

    var bundle = fs.existsSync(BUNDLE) ? fs.readFileSync(BUNDLE, 'utf8') : null;

    it('the bundle exists and carries lib/routing (control)', function () {
        assert.ok(bundle, 'gina.min.js must be present at ' + BUNDLE);
        assert.ok(bundle.split('RoutingHelper::getRoute').length - 1 > 0,
            'control: lib/routing must be present in the bundle at all');
    });

    it('the retired mail-content literal is gone from the bundle', function () {
        // Red before the rebuild (the shipped bundle still carries it), green after:
        // the free subtract proving the dist was actually rebuilt for this change.
        assert.equal(bundle.split('Failed to get mail content').length - 1, 0,
            'the rebuilt bundle must not carry the retired literal');
    });

    it('the bundle carries the new response-failure message', function () {
        assert.ok(bundle.split('route.request: response stream failed for ').length - 1 > 0,
            'the rebuilt bundle must carry the #B442 response-failure literal');
    });
});
