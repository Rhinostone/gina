'use strict';
/**
 * #B486 — the client boot survives a CROSS-ORIGIN parent frame.
 *
 * `construct()` (vendor/gina/main.js) read `parent.window['gina']` unconditionally to inherit a
 * parent frame's instance. Under a cross-origin parent that named-property read on the parent's
 * WindowProxy throws `SecurityError`; `construct()` is `async`, so the throw became a rejected
 * promise that `core.js`'s `require('gina')(window['gina'])` discards — no `ginaloaded`
 * dispatch, a silently half-booted client, nothing in the console beyond the rejection.
 * Measured live in a two-origin browser repro (127.0.0.1:8901 embedding :8902): the exact
 * `SecurityError: Failed to read a named property 'gina' from 'Window'` fired at the read and
 * the dispatch line was never reached; the same-origin control reached it; the try/catch below
 * restored it. The inheritance is OPTIONAL — skip it, never let it stop the boot.
 *
 * House style (the #B483 shape): no live browser here. Source pins on the guard, a lock-in on
 * the inheritance still happening inside it, a source-DERIVED replica of the block driven with a
 * throwing parent and a same-origin parent, and — added once the dist is rebuilt — a built-bundle
 * pin. Module-path seam `B486_SRC` so the whole file runs against a pre-change copy.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW   = process.env.B486_FW || require('../fw');
var MAIN = process.env.B486_SRC || path.join(FW, 'core/asset/plugin/src/vendor/gina/main.js');
var BUNDLE     = process.env.B486_BUNDLE     || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var BUNDLE_MIN = process.env.B486_BUNDLE_MIN || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var READ   = "typeof(parent.window['gina']) != 'undefined'";
var MERGE  = "window['gina'] = merge((window['gina'] || {}), parent.window['gina']);";
/** The guard: `try {` immediately gating the read, a `catch` closing the block. */
var GUARD  = /try \{\s*if \( typeof\(parent\.window\['gina'\]\) != 'undefined' \) \{[\s\S]{0,400}?\}\s*\} catch \(\w+\) \{[\s\S]{0,200}?\}/;

describe('01 - #B486 source pins: the parent-frame read is guarded, the inheritance still happens inside', function () {
    var src;
    before(function () { src = fs.readFileSync(MAIN, 'utf8'); });

    it('the read sits inside a try/catch', function () {
        assert.ok(GUARD.test(src), 'try { if (typeof(parent.window[\'gina\']) …) { … } } catch (…) { … } around the read');
    });
    it('lock-in — the inheritance merge is still performed, and only once', function () {
        assert.strictEqual(src.split(MERGE).length - 1, 1, 'exactly one inheritance merge');
        var m = GUARD.exec(src); assert.ok(m && m[0].indexOf(MERGE) > -1, 'and it lives INSIDE the guarded block');
    });
    it('lock-in — the read still happens exactly once (no duplicate probe outside the guard)', function () {
        assert.strictEqual(src.split(READ).length - 1, 1);
    });
    it('the dispatch still follows the block (a caught SecurityError cannot skip it)', function () {
        var g = GUARD.exec(src); assert.ok(g, 'guard present');
        var dispatch = src.indexOf("triggerEvent(gina, proto.target, 'ginaloaded', $instance);");
        assert.ok(dispatch > g.index + g[0].length, 'dispatch after the guarded block');
    });
});

describe('02 - #B486 replica DERIVED from the source: the guarded block under both parents', function () {
    var block;
    before(function () {
        var src = fs.readFileSync(MAIN, 'utf8');
        var m = GUARD.exec(src); assert.ok(m, 'the guarded block must be present to extract');
        block = m[0];
    });
    /** A SecurityError-shaped DOMException, as the browser throws it for a cross-origin named-property read. */
    function crossOriginParent() {
        return { get window() { return new Proxy({}, { get: function (t, k) {
            if (k === 'gina') { throw new DOMException("Failed to read a named property 'gina' from 'Window'", 'SecurityError'); }
            return undefined; } }); } };
    }
    function run(parent, win) {
        var merge = function (a, b) { return Object.assign(a, b); };
        var fn = new Function('parent', 'window', 'merge', block + '\nreturn window;');
        return fn(parent, win, merge);
    }
    it('a cross-origin parent: the SecurityError is caught, window.gina is left alone, control flows on', function () {
        var win = { gina: { stub: true } };
        var out; assert.doesNotThrow(function () { out = run(crossOriginParent(), win); });
        assert.deepStrictEqual(out.gina, { stub: true });
    });
    it('a same-origin parent carrying an instance: still inherited (the feature is intact)', function () {
        var out = run({ window: { gina: { fromParent: 1 } } }, { gina: { stub: true } });
        assert.deepStrictEqual(out.gina, { stub: true, fromParent: 1 });
    });
    it('a top-level page (parent === window, no instance yet): nothing to inherit, nothing thrown', function () {
        var win = {}; var out = run({ window: win }, win);
        assert.strictEqual(typeof out.gina, 'undefined');
    });
    it('control — the SAME block without its guard DOES throw under the cross-origin parent (the pre-fix shape)', function () {
        var unguarded = block.replace(/^try \{\s*/, '').replace(/\}\s*catch \(\w+\) \{[\s\S]*\}$/, '');
        assert.ok(unguarded.indexOf('try') === -1 && unguarded.indexOf(READ) > -1, 'guard stripped, read kept');
        var fn = new Function('parent', 'window', 'merge', unguarded + '\nreturn window;');
        assert.throws(function () { fn(crossOriginParent(), {}, Object.assign); }, function (e) { return e.name === 'SecurityError'; });
    });
});

// ─── 03 — built-bundle pins (validated RED on the pre-fix dist through the B486_BUNDLE* seams) ──

describe('03 - #B486 built-bundle pins: the guard survives r.js and Closure', function () {
    var js, min;
    before(function () { js = fs.readFileSync(BUNDLE, 'utf8'); min = fs.readFileSync(BUNDLE_MIN, 'utf8'); });

    it('gina.js (r.js concatenation, source verbatim) carries the guarded block', function () {
        assert.ok(GUARD.test(js), 'the same try/catch shape as the source');
        assert.strictEqual(js.split(READ).length - 1, 1, 'and exactly one read');
    });
    it('gina.min.js (Closure) wraps the read in try{…}catch — fixed-string needles, never a regex over the minified line', function () {
        // Closure folds the `if` into `&&` and renames `merge`; the try/catch and the property path survive verbatim
        assert.strictEqual(min.split('try{typeof parent.window.gina').length - 1, 1, "`try{` immediately gates the minified read");
        assert.strictEqual(min.split('parent.window.gina))}catch(').length - 1, 1, 'and the catch closes right after the inheritance merge');
        assert.strictEqual(min.split('parent.window.gina').length - 1, 2, 'control — the read and the merge, exactly two property paths (same as the source)');
    });
});
