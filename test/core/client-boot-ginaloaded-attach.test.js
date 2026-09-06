'use strict';
/**
 * #B483 — the client `ginaloaded` listener is attached at parse time, ahead of
 * the module factory that dispatches it.
 *
 * Pre-fix, core.js attached the listener inside `getDependencies`' completion
 * callback — i.e. only after the async routing.json fetch resolved — while the
 * dispatch runs from the `core` RequireJS factory, which the loader defers by a
 * 4 ms `setTimeout`. On a light page the timer beat the fetch, the listener never
 * fired, the loader was never invoked against the constructed instance, and the
 * client stayed half-booted (measured by a consumer's instrumented timeline; the
 * mechanism verified in source and in the built bundle).
 *
 * House style: no live browser. Source pins on the ORDER (attach precedes
 * `define('core')`, and precedes `getDependencies`), a lazy-resolution pin, two
 * labelled lock-ins, a source-DERIVED replica of the two orderings, and a
 * built-bundle order pin. Every discriminating pin run RED on the pre-fix source.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW     = process.env.B483_FW || require('../fw');
var CORE   = path.join(FW, 'core/asset/plugin/src/vendor/gina/core.js');
var BUNDLE = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var ATTACH   = 'document.addEventListener("ginaloaded"';
var IE       = 'document.attachEvent("ginaloaded"';
var CORE_DEF = "define('core'";
var GETDEPS  = 'function getDependencies(gina, cb)';

describe('01 - #B483 source pins: the attach precedes the dispatching factory', function () {
    var src;
    before(function () { src = fs.readFileSync(CORE, 'utf8'); });

    it('the ginaloaded listener is attached ABOVE define(\'core\') — file scope, before the factory that dispatches', function () {
        var a = src.indexOf(ATTACH), d = src.indexOf(CORE_DEF);
        assert.ok(a > -1 && d > -1, 'both anchors present');
        assert.ok(a < d, 'attach (' + a + ') must precede define(\'core\') (' + d + ')');
    });

    it('the attach is no longer inside getDependencies\' completion callback', function () {
        var a = src.indexOf(ATTACH), g = src.indexOf(GETDEPS);
        assert.ok(g > -1, 'getDependencies present');
        assert.ok(a < g, 'attach (' + a + ') must precede getDependencies (' + g + ')');
    });

    it('the handler resolves onGinaLoaded LAZILY at dispatch, never captured at parse', function () {
        var a = src.indexOf(ATTACH);
        // the handler is a named function declared just ABOVE the registration, so look on both sides
        var handler = src.slice(Math.max(0, a - 700), a + 400);
        assert.ok(handler.indexOf("window['onGinaLoaded'] ||") > -1, 'lazy resolution of the whispered loader with the fallback');
    });

    it('lock-in (non-discriminating): the #B414 gate release order is byte-identical', function () {
        assert.ok(src.indexOf('_settleDeps();\n            cb()') > -1, '`_settleDeps(); cb()` untouched');
    });

    it('the IE attachEvent branch travels with the block (discriminating on POSITION, lock-in on presence)', function () {
        assert.ok(src.indexOf(IE) > -1);
        assert.ok(src.indexOf(IE) < src.indexOf(CORE_DEF), 'and sits above define(\'core\') too');
    });
});

describe('02 - #B483 replica: attach-vs-dispatch ordering, DERIVED from the source', function () {
    // A minimal event target; `loader` is the whispered onGinaLoaded stand-in.
    function scenario(attachFirst) {
        var listeners = [], loaderCalls = 0;
        var doc = { addEventListener: function (n, fn) { listeners.push(fn); },
                    dispatch: function (detail) { listeners.slice().forEach(function (fn) { fn({ detail: detail }); }); } };
        var instance = { id: 'gina-x', isFrameworkLoaded: false };
        var loader = function (g) { if (!g) return false; if (g.isFrameworkLoaded) return true; g.isFrameworkLoaded = true; loaderCalls++; return true; };
        var attach   = function () { doc.addEventListener('ginaloaded', function (e) { loader(e.detail); }); };
        var dispatch = function () { doc.dispatch(instance); };
        if (attachFirst) { attach(); dispatch(); } else { dispatch(); attach(); }
        return { loaderCalls: loaderCalls, loaded: instance.isFrameworkLoaded };
    }

    it('attach-then-dispatch invokes the loader exactly once and flips isFrameworkLoaded', function () {
        assert.deepEqual(scenario(true), { loaderCalls: 1, loaded: true });
    });

    it('dispatch-then-attach (the pre-fix order) never invokes the loader — the half-booted client', function () {
        assert.deepEqual(scenario(false), { loaderCalls: 0, loaded: false });
    });

    it('the SHIPPED source is the attach-first order', function () {
        var src = fs.readFileSync(CORE, 'utf8');
        var attachFirst = src.indexOf(ATTACH) < src.indexOf(CORE_DEF);
        assert.equal(scenario(attachFirst).loaderCalls, 1, 'source order must be the one that boots');
    });
});

describe('03 - #B483 built-bundle order pin (runs against dist/vendor/gina/js/gina.js)', function () {
    it('define(\'gina\') < core stub < attach < define(\'core\') in the built bundle', function () {
        var b = fs.readFileSync(BUNDLE, 'utf8');
        var g = b.indexOf("define('gina'"), s = b.indexOf("if ( typeof(window['gina']) == 'undefined' )");
        var a = b.indexOf(ATTACH, s), c = b.indexOf(CORE_DEF, s);
        assert.ok(g > -1 && s > -1 && a > -1 && c > -1, 'all four anchors present in the bundle');
        assert.ok(g < s, 'gina registers before core.js file scope');
        assert.ok(s < a && a < c, 'attach sits inside core.js file scope, ahead of define(\'core\') (' + a + ' < ' + c + ')');
    });
});
