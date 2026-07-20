/**
 * FormValidator — `query` result-path guards (#B87)
 *
 * The `query` rule's XHR result lands asynchronously: by the time it is
 * processed the form may have been unbound or the field detached (e.g. a
 * popin closed mid-flight), and the result body is backend-controlled. A
 * throw anywhere in the processing used to leave `asyncCompleted.<id>`
 * unfired, hanging the submit path's async waiter for the whole pass.
 *
 * Guards under test (all in form-validator.js):
 *   1. `compileError()` tolerates a non-string `error` (returned verbatim —
 *      nothing to compile; today's only caller is string-gated, the guard is
 *      the function's own contract).
 *   2. The query value normalisation only lowercases STRING values (a boolean
 *      checkbox routed through a `query` rule carries a real boolean).
 *   3. `onResult` is a thin guarded wrapper: it delegates to
 *      `processQueryResult` and routes any throw to `releaseQueryWaiter`,
 *      which warns and releases the async waiter with the field state as-is
 *      (fail-open: the query verdict is unknown; the server re-validates).
 *   4. `xhr.onload`'s catch no longer rethrows (it used to be a no-op
 *      `throw err`), and `xhr.onerror`'s body is blanket-guarded — a
 *      malformed response (bad JSON under a JSON content-type) releases the
 *      waiter instead of hanging it.
 *
 * Test layering (project convention): the query path is browser-only
 * (`isGFFCtx`-gated), so behavior is locked via source pins + real-bytes
 * extract-and-eval of the self-contained `compileError`, replicas of the
 * wrapper wiring, and a frozen PRE-fix head replica as the subtract. Dist
 * pins guard the rebuild (red before the prod rebuild, green after).
 *
 * Run: node --test test/lib/validator-query-guard.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require(path.join(__dirname, '..', 'fw'));
var FV_PATH = path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'form-validator.js');
var fvSrc = fs.readFileSync(FV_PATH, 'utf8');

// Brace-matched extraction of a self-contained function expression.
function extractFn(source, marker) {
    var i = source.indexOf(marker);
    assert.ok(i > -1, 'extraction marker not found: ' + marker);
    var start = source.indexOf('function', i);
    var depth = 0, j = source.indexOf('{', start), k = j;
    for (; k < source.length; k++) {
        if (source[k] === '{') depth++;
        else if (source[k] === '}') { depth--; if (depth === 0) { k++; break; } }
    }
    return source.slice(start, k);
}


// 01 — source pins: the guard constructs exist in the live source

describe('01 - source pins: #B87 guard constructs', function () {

    it('compileError opens with the typeof-string guard, BEFORE the match() touch', function () {
        var fn = fvSrc.indexOf('var compileError = function(error, data) {');
        assert.ok(fn > -1, 'compileError must exist');
        var guard = fvSrc.indexOf("if ( typeof(error) != 'string' ) {", fn);
        var match = fvSrc.indexOf('var varArr = error.match(', fn);
        assert.ok(guard > -1, 'the non-string guard must exist');
        assert.ok(match > -1, 'the match() line must exist');
        assert.ok(guard < match, 'the guard must run before error.match() can throw');
    });

    it('the query value normalisation only lowercases strings', function () {
        assert.ok(fvSrc.indexOf("(_this.value && typeof(_this.value) == 'string') ? _this.value.toLowerCase() : _this.value") > -1,
            'a boolean checkbox value must pass through un-lowercased instead of throwing');
    });

    it('processQueryResult carries the former onResult body; onResult is the guarded wrapper', function () {
        assert.ok(fvSrc.indexOf('var processQueryResult = function(result) {') > -1,
            'the processing body must be its own function');
        var wrapper = fvSrc.match(/var onResult = function\(result\) \{\s*try \{\s*return processQueryResult\(result\);\s*\} catch \(err\) \{\s*return releaseQueryWaiter\(err\);\s*\}\s*\}/);
        assert.ok(wrapper, 'onResult must be the thin try/catch delegate');
    });

    it('releaseQueryWaiter warns and releases the waiter behind its own guard', function () {
        var fn = fvSrc.indexOf('var releaseQueryWaiter = function(err) {');
        assert.ok(fn > -1, 'releaseQueryWaiter must exist');
        var body = fvSrc.substring(fn, fvSrc.indexOf('var onResult = function', fn));
        assert.ok(body.indexOf('`query` result handling failed for field') > -1, 'must warn with the field name');
        assert.ok(body.indexOf("'asyncCompleted.' + _releaseId") > -1, 'must release the async waiter');
        assert.ok(/try \{[\s\S]*?triggerEvent\(gina, _this\.target, 'asyncCompleted\.' \+ _releaseId[\s\S]*?\} catch \(ignore\) \{\}/.test(body),
            'the release itself must be guarded — the catch handler can never throw');
    });

    it('xhr.onload routes its catch to releaseQueryWaiter — the no-op rethrow is gone', function () {
        assert.ok(!/\} catch \(err\) \{\s*throw err;\s*\}/.test(fvSrc),
            'no live bare-rethrow catch may remain on the query path');
        var onload = fvSrc.indexOf('xhr.onload = function () {');
        assert.ok(onload > -1, 'onload must exist');
        var body = fvSrc.substring(onload, fvSrc.indexOf('// xhr.onload', onload));
        assert.ok(body.indexOf('return releaseQueryWaiter(err);') > -1,
            'the onload catch must release the waiter');
    });

    it('xhr.onerror is blanket-guarded like onload', function () {
        var onerror = fvSrc.indexOf('xhr.onerror = function(event, err) {');
        assert.ok(onerror > -1, 'onerror must exist');
        var body = fvSrc.substring(onerror, fvSrc.indexOf('// Eo xhr.onerror', onerror));
        assert.ok(/xhr\.onerror = function\(event, err\) \{[\s\S]{0,400}?try \{/.test(fvSrc.substring(onerror)),
            'the onerror body must open with a try');
        assert.ok(body.indexOf('return releaseQueryWaiter(e);') > -1,
            'the onerror catch must release the waiter');
    });
});


// 02 — real bytes: compileError tolerates every non-string shape

describe('02 - compileError real-bytes behavior (extract-and-eval)', function () {

    var compileError = eval('(' + extractFn(fvSrc, 'var compileError = function(error, data) {') + ')');

    it('instrument control: the extraction yields a callable', function () {
        assert.equal(typeof compileError, 'function');
    });

    it('non-string errors are returned verbatim, never thrown on', function () {
        var shapes = [42, 0, true, false, null, undefined, { error: 'x' }, ['x']];
        for (var i = 0; i < shapes.length; i++) {
            var out;
            assert.doesNotThrow(function () { out = compileError(shapes[i], {}); },
                'shape ' + i + ' must not throw');
            assert.strictEqual(out, shapes[i], 'shape ' + i + ' must come back verbatim');
        }
    });

    it('a placeholder-less string still returns verbatim (#B86 behavior held)', function () {
        assert.strictEqual(compileError('Already taken', { a: 1 }), 'Already taken');
    });

    it('a {{path}} placeholder still compiles from data', function () {
        assert.strictEqual(compileError('Value {{name}} is taken', { name: 'sam' }), 'Value sam is taken');
    });

    it('subtract: the PRE-fix head (no guard) throws the exact class the guard prevents', function () {
        // Frozen pre-#B87 head — `.match` is the first touch of `error`.
        var compileErrorPreFixHead = function (error) {
            var varArr = error.match(/\{\{([^{{}}]+)\}\}/g );
            if (!varArr) { return error; }
            return error;
        };
        assert.throws(function () { compileErrorPreFixHead(42); }, TypeError,
            'the pre-fix shape must die on a non-string, proving the guard is load-bearing');
        assert.strictEqual(compileErrorPreFixHead('Already taken'), 'Already taken',
            'control: the frozen head is faithful for the string case');
    });
});


// 03 — wrapper wiring + waiter release (replicas of the pinned shapes)

describe('03 - guarded wrapper + waiter release behavior', function () {

    // Replica of the onResult wrapper wiring (pinned in 01).
    function mkWrapper(processImpl, releaseImpl) {
        return function onResult(result) {
            try {
                return processImpl(result);
            } catch (err) {
                return releaseImpl(err);
            }
        };
    }

    // Replica of releaseQueryWaiter (pinned in 01), with injectable deps.
    function mkRelease(_this, self, triggerEvent, warnSink) {
        return function releaseQueryWaiter(err) {
            warnSink.push('[ FormValidator ] `query` result handling failed for field `' + (_this && _this.name) + '`: ' + (err && err.message || err));
            try {
                var _releaseId = _this.target && (_this.target.id || _this.target.getAttribute('id'));
                if (_releaseId) {
                    triggerEvent('gina', _this.target, 'asyncCompleted.' + _releaseId, self[_this['name']]);
                }
            } catch (ignore) {}
        };
    }

    it('a processing throw reaches the release handler with the error', function () {
        var got = null;
        var wrapper = mkWrapper(
            function () { throw new TypeError('boom'); },
            function (err) { got = err; return 'released'; }
        );
        assert.equal(wrapper({}), 'released');
        assert.ok(got instanceof TypeError);
    });

    it('a normal result passes through untouched', function () {
        var wrapper = mkWrapper(function (r) { return r.ok; }, function () { throw new Error('must not be called'); });
        assert.equal(wrapper({ ok: 'fine' }), 'fine');
    });

    it('release fires asyncCompleted with the field object when the target is alive', function () {
        var fired = [];
        var _this = { name: 'email', target: { id: 'email-1' } };
        var release = mkRelease(_this, { email: { name: 'email', valid: true } },
            function (g, t, evt, detail) { fired.push({ evt: evt, detail: detail }); }, []);
        release(new Error('x'));
        assert.equal(fired.length, 1);
        assert.equal(fired[0].evt, 'asyncCompleted.email-1');
        assert.equal(fired[0].detail.name, 'email');
    });

    it('release survives a DETACHED field (null target) — warn only, no throw, no event', function () {
        var fired = [];
        var warns = [];
        var release = mkRelease({ name: 'email', target: null }, {},
            function () { fired.push(1); }, warns);
        assert.doesNotThrow(function () { release(new TypeError('detached')); });
        assert.equal(fired.length, 0, 'no waiter release without a target — nothing is waiting on a dead field');
        assert.equal(warns.length, 1, 'the failure must still be visible');
        assert.ok(warns[0].indexOf('detached') > -1);
    });

    it('release survives its own trigger throwing (the catch handler can never throw)', function () {
        var release = mkRelease({ name: 'email', target: { id: 'email-1' } }, {},
            function () { throw new Error('gina.events gone'); }, []);
        assert.doesNotThrow(function () { release(new Error('x')); });
    });
});


// 04 — dist fidelity (rebuild guard, red before the prod rebuild)

describe('04 - dist fidelity (#B87 guards in the built bundle)', function () {

    var DIST_DIR = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');
    var distSrc = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
    var distMin = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');

    it('positive control: an existing form-validator literal is findable in both artifacts', function () {
        // proves the instrument — string literals survive Closure — so the pins
        // below cannot pass (or fail) vacuously
        assert.ok(distSrc.indexOf('Condition not satisfied') > -1, 'gina.js');
        assert.ok(distMin.indexOf('Condition not satisfied') > -1, 'gina.min.js');
    });

    it('the release warn literal is in gina.js', function () {
        assert.ok(distSrc.indexOf('result handling failed for field') > -1,
            'rebuild dist after editing the validator src (prod build, 3 CI flags)');
    });

    it('the release warn literal is in gina.min.js', function () {
        assert.ok(distMin.indexOf('result handling failed for field') > -1,
            'rebuild dist after editing the validator src (prod build, 3 CI flags)');
    });
});
