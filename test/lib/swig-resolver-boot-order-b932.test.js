/**
 * #B932 — in a booted bundle, `swig.useProject` / `swig.package` were never
 * applied.
 *
 * controller.js asks the resolver for the swig module (get()) as the module
 * loads, and a bundle loads it before its settings are known: server.js and
 * gna.js require ./router at module scope, and router.js requires
 * ./controller. get() cached the framework copy, so when initSwigEngine then
 * called load() with the bundle's swig settings it found the cache filled and
 * returned that copy. The configured package was ignored, with a misleading
 * « second bundle requested » warning for a frontend and no line at all for a
 * pinned @rhinostone/swig; a Twig, Jinja2 or Django template rendered through
 * the native parser.
 *
 * The copy get() caches before any load() is now provisional: the first load()
 * resolves the configured package and replaces it, and a copy cached by a
 * load() still wins over later calls. controller.js reads the module through
 * get() again where it configures the render (setOptions) and where it hands
 * the module to the render delegate (render), so it uses what load() resolved.
 *
 *   01  the order a bundle runs — get() first, then load() — applies the opt-in
 *   02  controls: no opt-in keeps the very instance get() handed out; a copy
 *       cached by load() still wins
 *   03  controller.js reads the module through the resolver at render time
 *       (pins on its comment-stripped source)
 *
 * The real boot order is exercised by
 * test/integration/container-boot-swig-package-b932.test.js.
 *
 * Module-path seams: GINA_B932_RESOLVER=<a copy of the resolver's main.js> and
 * GINA_B932_CONTROLLER_SRC=<a copy of controller.js>. A resolver copy outside
 * the framework tree needs NODE_PATH=<framework dir>/node_modules so its
 * fallback require() finds @rhinostone/swig. On pre-fix copies the 7 tests of
 * 01 and the 2 pins of 03 fail, and the 3 controls of 02 and the raw-text
 * control of 03 pass.
 *
 * Run standalone:
 *   node --test test/lib/swig-resolver-boot-order-b932.test.js
 */

'use strict';

var fs       = require('fs');
var os       = require('os');
var nodePath = require('path');
var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert   = require('node:assert/strict');

var FW = require('../fw');
var RESOLVER_PATH   = process.env.GINA_B932_RESOLVER || nodePath.join(FW, 'lib/swig-resolver/src/main.js');
var CONTROLLER_PATH = process.env.GINA_B932_CONTROLLER_SRC || nodePath.join(FW, 'core/controller/controller.js');
var resolver = require(RESOLVER_PATH);

// macOS: os.tmpdir() is a symlink; realpath it so require.cache keys match.
var ROOT = nodePath.join(os.tmpdir(), 'gina-b932-' + process.pid + '-' + Date.now());
var FX   = {};

/** Writes <projectDir>/node_modules/<pkgName>/ with a package.json and an index.js marker. */
function seedPackage(projectDir, pkgName, version, marker) {
    var dir = nodePath.join(projectDir, 'node_modules', pkgName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(nodePath.join(dir, 'package.json'),
        JSON.stringify({ name: pkgName, version: version, main: 'index.js' }, null, 2) + '\n');
    fs.writeFileSync(nodePath.join(dir, 'index.js'), 'module.exports = { _fixture: ' + JSON.stringify(marker) + ' };\n');
}

/** Runs fn and returns what it threw (null when it did not throw). */
function thrownBy(fn) {
    try { fn(); } catch (e) { return e; }
    return null;
}

/** Captures console.log and console.warn lines while fn runs. */
function capture(fn) {
    var lines = [], log = console.log, warn = console.warn;
    console.log  = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    console.warn = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    try { return { value: fn(), lines: lines }; } finally { console.log = log; console.warn = warn; }
}

before(function () {
    fs.mkdirSync(ROOT, { recursive: true });
    ROOT = fs.realpathSync(ROOT);

    FX.empty = nodePath.join(ROOT, 'empty');
    fs.mkdirSync(nodePath.join(FX.empty, 'node_modules'), { recursive: true });

    FX.twig = nodePath.join(ROOT, 'twig');
    seedPackage(FX.twig, '@rhinostone/swig-twig', '2.0.5', 'twig');

    FX.pinned = nodePath.join(ROOT, 'pinned');
    seedPackage(FX.pinned, '@rhinostone/swig', '2.0.5', 'pinned');

    FX.pinnedDev = nodePath.join(ROOT, 'pinned-dev');
    seedPackage(FX.pinnedDev, '@rhinostone/swig', '2.0.5', 'pinned-dev v1');
});

after(function () {
    resolver.reset();
    fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(function () { resolver.reset(); });
afterEach(function () { resolver.reset(); });


// ---------------------------------------------------------------------------
// 01 — get() first, then load(): the order a booted bundle runs
// ---------------------------------------------------------------------------

describe('01 - get() then load(), the order a bundle runs, applies the opt-in', function () {

    it('a frontend installed in the project: load() returns the project copy and get() hands it out after', function () {
        var early  = resolver.get();
        var loaded = capture(function () {
            return resolver.load(FX.twig, { useProject: true, 'package': '@rhinostone/swig-twig' });
        }).value;
        assert.equal(loaded._fixture, 'twig', 'load() must return the project copy, not the copy get() cached');
        assert.notEqual(loaded, early);
        assert.equal(resolver.get(), loaded, 'get() hands out what load() resolved');
        var d = resolver.getDecision();
        assert.equal(d.source, 'project');
        assert.equal(d['package'], '@rhinostone/swig-twig');
    });

    it('a pinned @rhinostone/swig: the project copy wins and the « using project » line is logged', function () {
        resolver.get();
        var r = capture(function () { return resolver.load(FX.pinned, { useProject: true }); });
        assert.equal(r.value._fixture, 'pinned');
        assert.ok(r.lines.some(function (l) { return l.indexOf('[swig-resolver] using project @rhinostone/swig@2.0.5') > -1; }),
            'expected the « using project » line; got ' + JSON.stringify(r.lines));
    });

    it('no misleading « second bundle requested » warning for the first load() of a process', function () {
        resolver.get();
        var r = capture(function () {
            return resolver.load(FX.twig, { useProject: true, 'package': '@rhinostone/swig-twig' });
        });
        assert.ok(!r.lines.some(function (l) { return l.indexOf('second bundle requested') > -1; }),
            'no second-bundle warning; got ' + JSON.stringify(r.lines));
        assert.equal(r.value._fixture, 'twig');
    });

    it('a frontend NOT installed: load() after get() throws SWIG_PACKAGE_UNAVAILABLE instead of running on the framework copy (#B925)', function () {
        resolver.get();
        var err = thrownBy(function () {
            resolver.load(FX.empty, { useProject: true, 'package': '@rhinostone/swig-twig' });
        });
        assert.ok(err, 'load() must throw — before the fix it returned the framework copy');
        assert.equal(err.code, 'SWIG_PACKAGE_UNAVAILABLE', 'got ' + err.code + ': ' + err.message);
    });

    it('a copy cached by load() wins over a later load() with another package, which is warned', function () {
        resolver.get();
        var first = capture(function () {
            return resolver.load(FX.twig, { useProject: true, 'package': '@rhinostone/swig-twig' });
        }).value;
        var r = capture(function () { return resolver.load(FX.pinned, { useProject: true }); });
        assert.equal(first._fixture, 'twig');
        assert.equal(r.value, first, 'the second load() keeps the first resolved copy');
        assert.ok(r.lines.some(function (l) {
            return l.indexOf('second bundle requested @rhinostone/swig but @rhinostone/swig-twig is already loaded') > -1;
        }), 'expected the standalone-mode warning; got ' + JSON.stringify(r.lines));
    });

    it('get() then load() stores the options, so the dev hot-swap picks up a newer project copy', function () {
        var devFlag = process.env.NODE_ENV_IS_DEV;
        process.env.NODE_ENV_IS_DEV = 'true';
        try {
            resolver.get();
            var v1 = capture(function () { return resolver.load(FX.pinnedDev, { useProject: true }); }).value;
            assert.equal(v1._fixture, 'pinned-dev v1');
            seedPackage(FX.pinnedDev, '@rhinostone/swig', '2.0.6', 'pinned-dev v2');
            var later = new Date(Date.now() + 5000);
            fs.utimesSync(nodePath.join(FX.pinnedDev, 'node_modules', '@rhinostone/swig', 'package.json'), later, later);
            var v2 = capture(function () { return resolver.get(); }).value;
            assert.equal(v2._fixture, 'pinned-dev v2', 'the dev hot-swap must reload the newer copy');
        } finally {
            if (typeof devFlag === 'undefined') { delete process.env.NODE_ENV_IS_DEV; } else { process.env.NODE_ENV_IS_DEV = devFlag; }
        }
    });

    it('the decision record after get() then load() is the resolved one, not get()\'s fallback record', function () {
        resolver.get();
        assert.equal(resolver.getDecision().source, 'framework');
        capture(function () { return resolver.load(FX.pinned, { useProject: true }); });
        var d = resolver.getDecision();
        assert.equal(d.source, 'project');
        assert.equal(d.version, '2.0.5');
    });
});


// ---------------------------------------------------------------------------
// 02 — controls: what must not change
// ---------------------------------------------------------------------------

describe('02 - controls (pass before and after the fix)', function () {

    it('CONTROL: no opt-in — load() after get() returns the very instance get() handed out', function () {
        var early  = resolver.get();
        var loaded = capture(function () { return resolver.load(FX.empty, {}); }).value;
        assert.equal(loaded, early, 'the framework module, one instance');
    });

    it('CONTROL: get() alone caches the framework copy and returns it on every call', function () {
        var a = resolver.get();
        var b = resolver.get();
        assert.ok(a && typeof a === 'object');
        assert.equal(a, b);
        assert.equal(resolver.getDecision().source, 'framework');
    });

    it('CONTROL: two load() calls — the first wins, as before', function () {
        var first  = capture(function () { return resolver.load(FX.pinned, { useProject: true }); }).value;
        var second = capture(function () { return resolver.load(FX.twig, { useProject: true, 'package': '@rhinostone/swig-twig' }); }).value;
        assert.equal(first._fixture, 'pinned');
        assert.equal(second, first);
    });
});


// ---------------------------------------------------------------------------
// 03 — controller.js reads the module through the resolver at render time
// ---------------------------------------------------------------------------

describe('03 - controller.js reads the swig module through the resolver at render time', function () {

    var RAW = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    // Whole-line comments only (a JSDoc line, a `//` line): a JSDoc or a `// was:`
    // comment that names the call must not satisfy a pin.
    var SRC = RAW.split('\n').filter(function (l) { return !/^\s*(\/\/|\/\*|\*)/.test(l); }).join('\n');
    // The re-read is an assignment at the start of a statement, never the
    // module-scope `var swig` declaration.
    var REREAD = /\n\s*swig = lib\.swigResolver\.get\(\);/;

    /** The comment-stripped text between the first `from` and the first `to` after it. */
    function between(from, to) {
        var a = SRC.indexOf(from);
        assert.ok(a > -1, 'anchor « ' + from + ' » must exist in the comment-stripped source');
        var b = SRC.indexOf(to, a);
        assert.ok(b > a, 'anchor « ' + to + ' » must follow « ' + from + ' »');
        return SRC.slice(a, b);
    }

    it('CONTROL: the source was read — the raw text calls lib.swigResolver.get() (the module-scope declaration)', function () {
        assert.ok(RAW.indexOf('lib.swigResolver.get()') > -1);
        assert.ok(SRC.length > 1000 && SRC.length < RAW.length, 'the strip kept the code and removed the comments');
    });

    it('setOptions re-reads the module before it configures the swig loader and engine', function () {
        assert.match(between('this.setOptions = function', 'swigOptions.loader = swig.loaders.fs(dir);'), REREAD);
    });

    it('render re-reads the module before it hands it to the render delegate', function () {
        assert.match(between('this.render = function', 'swigModule  : swig'), REREAD);
    });
});
