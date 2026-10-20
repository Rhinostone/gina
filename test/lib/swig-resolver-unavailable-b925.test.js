/**
 * #B925 — lib/swig-resolver load(): a non-default `swig.package` with no usable
 * project copy stops with a named error, SWIG_PACKAGE_UNAVAILABLE, instead of
 * the bare MODULE_NOT_FOUND of the resolver's fallback require().
 *
 * The framework ships only @rhinostone/swig, so the fallback cannot load any
 * other package. Before the fix, load() for @rhinostone/swig-twig, -jinja2 or
 * -django without a usable project copy threw MODULE_NOT_FOUND from the
 * framework's own resolution path, with no word of `swig.useProject` or of the
 * project install. The error now names the package, the reason (the gate that
 * rejected the project copy, or `swig.useProject` not being true), the path it
 * expected and the install line, and carries the decision record: the shape of
 * the nunjucks resolver's NUNJUCKS_NOT_INSTALLED. @rhinostone/swig itself keeps
 * falling back to the framework copy with its one-line warning.
 *
 * In a booted bundle this path became reachable with #B932, which makes the
 * bundle's load() resolve the configured package (see
 * swig-resolver-boot-order-b932.test.js).
 *
 * Fixtures are fake packages in os.tmpdir() — a package.json and an index.js
 * marker — as in swig-resolver.test.js.
 *
 * Module-path seam: GINA_B925_RESOLVER=<a copy of the resolver's main.js> runs
 * every arm against that copy. A copy outside the framework tree needs
 * NODE_PATH=<framework dir>/node_modules so its fallback require() finds
 * @rhinostone/swig. On the pre-fix copy the 7 tests of 02 and 03 fail (each
 * receives MODULE_NOT_FOUND) and the 4 tests of 01 pass.
 *
 * Run standalone:
 *   node --test test/lib/swig-resolver-unavailable-b925.test.js
 */

'use strict';

var fs       = require('fs');
var os       = require('os');
var nodePath = require('path');
var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert   = require('node:assert/strict');

var RESOLVER_PATH = process.env.GINA_B925_RESOLVER
    || nodePath.join(require('../fw'), 'lib/swig-resolver/src/main.js');
var resolver = require(RESOLVER_PATH);

var CODE = 'SWIG_PACKAGE_UNAVAILABLE';

// macOS: os.tmpdir() is a symlink; realpath it so require.cache keys match.
var ROOT = nodePath.join(os.tmpdir(), 'gina-b925-' + process.pid + '-' + Date.now());
var FX   = {};

/** Writes <projectDir>/node_modules/<pkgName>/package.json (object or raw string) and an index.js marker. */
function seedPackage(projectDir, pkgName, pkgJson, marker) {
    var dir = nodePath.join(projectDir, 'node_modules', pkgName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(nodePath.join(dir, 'package.json'),
        (typeof pkgJson === 'string' ? pkgJson : JSON.stringify(pkgJson, null, 2)) + '\n');
    fs.writeFileSync(nodePath.join(dir, 'index.js'), 'module.exports = { _fixture: ' + JSON.stringify(marker) + ' };\n');
}

/** Runs fn and returns what it threw (null when it did not throw). */
function thrownBy(fn) {
    try { fn(); } catch (e) { return e; }
    return null;
}

/** Captures console[level] lines while fn runs. */
function capture(level, fn) {
    var lines = [], orig = console[level];
    console[level] = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    try { return { value: fn(), lines: lines }; } finally { console[level] = orig; }
}

before(function () {
    fs.mkdirSync(ROOT, { recursive: true });
    ROOT = fs.realpathSync(ROOT);

    FX.empty = nodePath.join(ROOT, 'empty');
    fs.mkdirSync(nodePath.join(FX.empty, 'node_modules'), { recursive: true });

    FX.twig = nodePath.join(ROOT, 'twig');
    seedPackage(FX.twig, '@rhinostone/swig-twig',
        { name: '@rhinostone/swig-twig', version: '2.0.5', main: 'index.js' }, 'twig');

    FX.djangoOld = nodePath.join(ROOT, 'django-old');
    seedPackage(FX.djangoOld, '@rhinostone/swig-django',
        { name: '@rhinostone/swig-django', version: '1.0.0', main: 'index.js' }, 'django-old');

    FX.twigMalformed = nodePath.join(ROOT, 'twig-malformed');
    seedPackage(FX.twigMalformed, '@rhinostone/swig-twig', '{ "name": "@rhinostone/swig-twig", not json', 'twig-malformed');

    FX.twigNoVersion = nodePath.join(ROOT, 'twig-no-version');
    seedPackage(FX.twigNoVersion, '@rhinostone/swig-twig',
        { name: '@rhinostone/swig-twig', main: 'index.js' }, 'twig-no-version');

    FX.twigDev = nodePath.join(ROOT, 'twig-dev');
    seedPackage(FX.twigDev, '@rhinostone/swig-twig',
        { name: '@rhinostone/swig-twig', version: '2.0.5', main: 'index.js' }, 'twig-dev');
});

after(function () {
    resolver.reset();
    fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(function () { resolver.reset(); });
afterEach(function () { resolver.reset(); });


// ---------------------------------------------------------------------------
// 01 — premises and controls: the resolver loads, and what must not change
// ---------------------------------------------------------------------------

describe('01 - premises and controls (pass before and after the fix)', function () {

    it('the resolver under test exports load, get, getDecision and reset', function () {
        ['load', 'get', 'getDecision', 'reset'].forEach(function (k) {
            assert.equal(typeof resolver[k], 'function', k);
        });
    });

    it('CONTROL: @rhinostone/swig with no project copy still falls back to the framework copy, with its not-installed warning', function () {
        var r = capture('warn', function () { return resolver.load(FX.empty, { useProject: true }); });
        assert.ok(r.value && typeof r.value === 'object', 'load() must return the framework module');
        var d = resolver.getDecision();
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'not-installed');
        assert.ok(r.lines.some(function (l) { return l.indexOf('project override ignored (not-installed)') > -1; }),
            'the one-line warning; got ' + JSON.stringify(r.lines));
    });

    it('CONTROL: the documented setup — useProject: true and the package installed — loads the project copy', function () {
        var twig = capture('log', function () {
            return resolver.load(FX.twig, { useProject: true, 'package': '@rhinostone/swig-twig' });
        }).value;
        assert.equal(twig._fixture, 'twig');
        assert.equal(resolver.getDecision().source, 'project');
    });

    it('a failed load() caches nothing (invariant, before and after the fix)', function () {
        thrownBy(function () { resolver.load(FX.empty, { useProject: true, 'package': '@rhinostone/swig-twig' }); });
        assert.equal(process.gina._swig, undefined, 'process.gina._swig');
        assert.equal(process.gina._swigPackage, undefined, 'process.gina._swigPackage');
    });
});


// ---------------------------------------------------------------------------
// 02 — each way a non-default package can be unusable throws the named error
// ---------------------------------------------------------------------------

describe('02 - a non-default swig.package with no usable project copy throws ' + CODE, function () {

    var CASES = [
        { name: 'not installed in the project',            fx: 'empty',         pkg: '@rhinostone/swig-twig',   useProject: true,  warning: 'not-installed',          reason: 'not-installed', path: true },
        { name: 'useProject false, nothing installed',     fx: 'empty',         pkg: '@rhinostone/swig-jinja2', useProject: false, warning: null,                     reason: 'swig.useProject is not true' },
        { name: 'useProject false, the package installed', fx: 'twig',          pkg: '@rhinostone/swig-twig',   useProject: false, warning: null,                     reason: 'swig.useProject is not true' },
        { name: 'a 1.0.0 project pin (version-mismatch)',  fx: 'djangoOld',     pkg: '@rhinostone/swig-django', useProject: true,  warning: 'version-mismatch',       reason: 'version-mismatch, project pinned 1.0.0', path: true },
        { name: 'a malformed package.json',                fx: 'twigMalformed', pkg: '@rhinostone/swig-twig',   useProject: true,  warning: 'malformed-package-json', reason: 'malformed-package-json', path: true },
        { name: 'a package.json without a version',        fx: 'twigNoVersion', pkg: '@rhinostone/swig-twig',   useProject: true,  warning: 'missing-version',        reason: 'missing-version', path: true }
    ];

    CASES.forEach(function (c) {
        it(c.name + ': ' + c.pkg + ' throws ' + CODE + ' naming the package, the reason and the install', function () {
            var projectPath = FX[c.fx];
            var err = thrownBy(function () {
                resolver.load(projectPath, { useProject: c.useProject, 'package': c.pkg });
            });
            assert.ok(err, 'load() must throw');
            assert.equal(err.code, CODE, 'err.code — got ' + err.code + ': ' + err.message);
            assert.ok(err.message.indexOf('settings.swig.package is ' + c.pkg) > -1, 'names the package: ' + err.message);
            assert.ok(err.message.indexOf(c.reason) > -1, 'names the reason « ' + c.reason + ' »: ' + err.message);
            if (c.path) {
                var expected = nodePath.join(projectPath, 'node_modules', c.pkg);
                assert.ok(err.message.indexOf(expected) > -1, 'names the expected path ' + expected + ': ' + err.message);
            }
            assert.ok(err.message.indexOf('swig.useProject: true') > -1, 'names swig.useProject: ' + err.message);
            assert.ok(err.message.indexOf('npm install ' + c.pkg) > -1, 'gives the install line: ' + err.message);
            assert.ok(err.decision, 'err.decision is attached');
            assert.equal(err.decision.source, 'framework');
            assert.equal(err.decision['package'], c.pkg);
            assert.equal(err.decision.warning, c.warning);
        });
    });
});


// ---------------------------------------------------------------------------
// 03 — dev hot-swap: the project copy removed while a dev bundle runs
// ---------------------------------------------------------------------------

describe('03 - dev hot-swap: a removed project copy throws ' + CODE + ' on the next get(), and a reinstall recovers', function () {

    var devFlag;
    before(function () { devFlag = process.env.NODE_ENV_IS_DEV; process.env.NODE_ENV_IS_DEV = 'true'; });
    after(function () {
        if (typeof devFlag === 'undefined') { delete process.env.NODE_ENV_IS_DEV; } else { process.env.NODE_ENV_IS_DEV = devFlag; }
    });

    it('get() throws the named error while the package is gone, and returns the project copy once it is back', function () {
        var pkgDir  = nodePath.join(FX.twigDev, 'node_modules', '@rhinostone', 'swig-twig');
        var awayDir = pkgDir + '.away';
        var first = capture('log', function () {
            return resolver.load(FX.twigDev, { useProject: true, 'package': '@rhinostone/swig-twig' });
        }).value;
        assert.equal(first._fixture, 'twig-dev');

        fs.renameSync(pkgDir, awayDir);
        try {
            for (var i = 1; i <= 2; i++) {
                var err = thrownBy(function () { resolver.get(); });
                assert.ok(err, 'get() #' + i + ' must throw while the package is gone');
                assert.equal(err.code, CODE, 'get() #' + i + ' — got ' + err.code + ': ' + err.message);
            }
        } finally {
            fs.renameSync(awayDir, pkgDir);
        }
        // A reinstall writes a new package.json: move its mtime strictly ahead.
        var later = new Date(Date.now() + 5000);
        fs.utimesSync(nodePath.join(pkgDir, 'package.json'), later, later);
        var back = capture('log', function () { return resolver.get(); }).value;
        assert.equal(back._fixture, 'twig-dev', 'the project copy is loaded again');
    });
});
