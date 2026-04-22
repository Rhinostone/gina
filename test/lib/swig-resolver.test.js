/**
 * lib/swig-resolver — behavioural tests.
 *
 * The resolver is pure (no swig module is ever required; only fs reads
 * against fixture project trees). Fixtures are built in os.tmpdir() under
 * before(), torn down under after() — keeping them out of the repo avoids
 * the node_modules/ gitignore trap and makes each test run self-contained.
 *
 * Fixture matrix:
 *
 *   has-satisfies      — 1.6.2       (satisfies floor 1.6.0, same major)
 *   has-alpha-satisfies — 1.6.0-alpha.3 (pre-release, equal to floor after
 *                         suffix strip — treated as satisfying)
 *   has-too-old        — 1.5.0       (same major, below floor)
 *   has-wrong-major    — 2.0.0       (above floor but different major)
 *   has-twig           — 2.0.0-alpha.8 of @rhinostone/swig-twig (package
 *                         override exercised with a different min)
 *   malformed          — invalid JSON in package.json
 *   missing-version    — no `version` key
 *   no-swig            — empty project, no swig installed at all
 */

'use strict';

var fs       = require('fs');
var os       = require('os');
var nodePath = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var resolver = require(nodePath.join(require('../fw'), 'lib/swig-resolver/src/main'));

// Note: os.tmpdir() returns a symlink on macOS (/var/folders/... → /private/var/folders/...).
// We realpath ROOT inside before() once the directory exists so that paths we hand to
// require.cache (via updateFixtureTo's cache eviction) match Node's realpath-normalised keys.
var ROOT = nodePath.join(os.tmpdir(), 'gina-swig-resolver-test-' + Date.now());

/**
 * Writes a package.json (plus a tiny index.js entry) at
 * <projectDir>/node_modules/<pkgName>/. `pkgJson` may be a parsed object or
 * a raw string (used to seed malformed JSON).
 */
function seedFixture(projectDir, pkgName, pkgJson) {
    var pkgDir = nodePath.join(projectDir, 'node_modules', pkgName);
    fs.mkdirSync(pkgDir, { recursive: true });
    var body = typeof pkgJson === 'string' ? pkgJson : JSON.stringify(pkgJson, null, 2);
    fs.writeFileSync(nodePath.join(pkgDir, 'package.json'), body + '\n');
    fs.writeFileSync(
        nodePath.join(pkgDir, 'index.js'),
        'module.exports = { _fixture: ' + JSON.stringify(nodePath.basename(projectDir)) + ' };\n'
    );
}

var FX = {};

before(function () {
    fs.mkdirSync(ROOT, { recursive: true });
    ROOT = fs.realpathSync(ROOT);

    FX.hasSatisfies = nodePath.join(ROOT, 'has-satisfies');
    seedFixture(FX.hasSatisfies, '@rhinostone/swig', {
        name: '@rhinostone/swig', version: '1.6.2', main: 'index.js'
    });

    FX.hasAlphaSatisfies = nodePath.join(ROOT, 'has-alpha-satisfies');
    seedFixture(FX.hasAlphaSatisfies, '@rhinostone/swig', {
        name: '@rhinostone/swig', version: '1.6.0-alpha.3', main: 'index.js'
    });

    FX.hasTooOld = nodePath.join(ROOT, 'has-too-old');
    seedFixture(FX.hasTooOld, '@rhinostone/swig', {
        name: '@rhinostone/swig', version: '1.5.0', main: 'index.js'
    });

    FX.hasWrongMajor = nodePath.join(ROOT, 'has-wrong-major');
    seedFixture(FX.hasWrongMajor, '@rhinostone/swig', {
        name: '@rhinostone/swig', version: '2.0.0', main: 'index.js'
    });

    FX.hasTwig = nodePath.join(ROOT, 'has-twig');
    seedFixture(FX.hasTwig, '@rhinostone/swig-twig', {
        name: '@rhinostone/swig-twig', version: '2.0.0-alpha.8', main: 'index.js'
    });

    FX.malformed = nodePath.join(ROOT, 'malformed');
    seedFixture(FX.malformed, '@rhinostone/swig',
        '{ "name": "@rhinostone/swig", "version": "1.6.2", this is not valid json');

    FX.missingVersion = nodePath.join(ROOT, 'missing-version');
    seedFixture(FX.missingVersion, '@rhinostone/swig', {
        name: '@rhinostone/swig', main: 'index.js'
    });

    FX.noSwig = nodePath.join(ROOT, 'no-swig');
    fs.mkdirSync(FX.noSwig, { recursive: true });
});

after(function () {
    fs.rmSync(ROOT, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports resolve', function () {
        assert.equal(typeof resolver.resolve, 'function');
    });

    it('exports compareSemver', function () {
        assert.equal(typeof resolver.compareSemver, 'function');
    });

    it('exports satisfiesMajorAndFloor', function () {
        assert.equal(typeof resolver.satisfiesMajorAndFloor, 'function');
    });

    it('exports splitVersion', function () {
        assert.equal(typeof resolver.splitVersion, 'function');
    });

    it('exports DEFAULT_PACKAGE = "@rhinostone/swig"', function () {
        assert.equal(resolver.DEFAULT_PACKAGE, '@rhinostone/swig');
    });

    it('exports DEFAULT_MIN as a semver-shaped string', function () {
        assert.match(resolver.DEFAULT_MIN, /^\d+\.\d+\.\d+/);
    });
});


// ---------------------------------------------------------------------------
// 02 — splitVersion
// ---------------------------------------------------------------------------

describe('02 - splitVersion', function () {

    it('splits a three-part version', function () {
        assert.deepEqual(resolver.splitVersion('1.6.2'), [1, 6, 2]);
    });

    it('strips a pre-release suffix', function () {
        assert.deepEqual(resolver.splitVersion('2.0.0-alpha.8'), [2, 0, 0]);
    });

    it('strips a build-metadata suffix', function () {
        assert.deepEqual(resolver.splitVersion('1.6.2+build.7'), [1, 6, 2]);
    });

    it('pads a short version with zeros', function () {
        assert.deepEqual(resolver.splitVersion('1.6'), [1, 6, 0]);
        assert.deepEqual(resolver.splitVersion('1'),   [1, 0, 0]);
    });

    it('coerces non-numeric components to 0', function () {
        assert.deepEqual(resolver.splitVersion('1.x.0'), [1, 0, 0]);
    });
});


// ---------------------------------------------------------------------------
// 03 - compareSemver
// ---------------------------------------------------------------------------

describe('03 - compareSemver', function () {

    it('returns 0 on equality', function () {
        assert.equal(resolver.compareSemver('1.6.2', '1.6.2'), 0);
    });

    it('returns -1 when the first is older', function () {
        assert.equal(resolver.compareSemver('1.6.0', '1.6.2'), -1);
        assert.equal(resolver.compareSemver('1.5.9', '1.6.0'), -1);
        assert.equal(resolver.compareSemver('1.9.9', '2.0.0'), -1);
    });

    it('returns 1 when the first is newer', function () {
        assert.equal(resolver.compareSemver('1.6.3', '1.6.2'), 1);
        assert.equal(resolver.compareSemver('2.0.0', '1.9.9'), 1);
    });

    it('treats pre-release suffixes as equal to the final', function () {
        // Adequate for a runtime peer floor; strict pre-release ordering
        // would add surface area without saving a real-world user.
        assert.equal(resolver.compareSemver('1.6.0-alpha.3', '1.6.0'), 0);
    });
});


// ---------------------------------------------------------------------------
// 04 - satisfiesMajorAndFloor
// ---------------------------------------------------------------------------

describe('04 - satisfiesMajorAndFloor', function () {

    it('true when version equals the floor', function () {
        assert.equal(resolver.satisfiesMajorAndFloor('1.6.0', '1.6.0'), true);
    });

    it('true when version is above the floor within the same major', function () {
        assert.equal(resolver.satisfiesMajorAndFloor('1.6.2', '1.6.0'), true);
        assert.equal(resolver.satisfiesMajorAndFloor('1.9.0', '1.6.0'), true);
    });

    it('false when version is below the floor within the same major', function () {
        assert.equal(resolver.satisfiesMajorAndFloor('1.5.9', '1.6.0'), false);
        assert.equal(resolver.satisfiesMajorAndFloor('1.0.0', '1.6.0'), false);
    });

    it('false when major differs (even if newer overall)', function () {
        assert.equal(resolver.satisfiesMajorAndFloor('2.0.0', '1.6.0'), false);
    });

    it('false when major differs (older overall)', function () {
        assert.equal(resolver.satisfiesMajorAndFloor('0.9.0', '1.6.0'), false);
    });

    it('alpha pre-release at the floor counts as satisfying', function () {
        // A pre-release of the floor is treated as equal to the floor after
        // suffix strip — a project that pinned 1.6.0-alpha.3 gets the
        // project copy and we log source=project with its alpha version.
        assert.equal(resolver.satisfiesMajorAndFloor('1.6.0-alpha.3', '1.6.0'), true);
    });
});


// ---------------------------------------------------------------------------
// 05 - resolve() — opt-out path (default)
// ---------------------------------------------------------------------------

describe('05 - resolve() opt-out', function () {

    it('returns framework when useProject is not set', function () {
        var d = resolver.resolve(FX.hasSatisfies, {});
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, null);
        assert.equal(d.path, null);
    });

    it('returns framework when useProject is false explicitly', function () {
        var d = resolver.resolve(FX.hasSatisfies, { useProject: false });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, null);
    });

    it('returns framework when projectPath is missing', function () {
        var d = resolver.resolve(null, { useProject: true });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, null);
    });

    it('returns framework when projectPath is undefined', function () {
        var d = resolver.resolve(undefined, { useProject: true });
        assert.equal(d.source, 'framework');
    });

    it('returns framework when projectPath is an empty string', function () {
        var d = resolver.resolve('', { useProject: true });
        assert.equal(d.source, 'framework');
    });

    it('records the default package name in the decision', function () {
        var d = resolver.resolve(null, {});
        assert.equal(d['package'], '@rhinostone/swig');
    });

    it('records a custom package name even when short-circuiting', function () {
        var d = resolver.resolve(null, { 'package': '@rhinostone/swig-twig' });
        assert.equal(d['package'], '@rhinostone/swig-twig');
    });

    it('no filesystem touch when useProject is false (exercised via no-swig fixture)', function () {
        // no-swig has no node_modules; if the resolver tried to resolve it
        // would throw "not-installed". useProject:false must short-circuit
        // before the require.resolve() attempt.
        var d = resolver.resolve(FX.noSwig, { useProject: false });
        assert.equal(d.warning, null);
    });
});


// ---------------------------------------------------------------------------
// 06 - resolve() — project has a satisfying pin
// ---------------------------------------------------------------------------

describe('06 - resolve() satisfying project pin', function () {

    it('picks the project copy when version is above the floor', function () {
        var d = resolver.resolve(FX.hasSatisfies, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.equal(d.source, 'project');
        assert.equal(d.version, '1.6.2');
        assert.equal(d.warning, null);
    });

    it('records the absolute entry path for the caller to require()', function () {
        var d = resolver.resolve(FX.hasSatisfies, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.ok(nodePath.isAbsolute(d.path), 'path should be absolute');
        assert.match(d.path, /node_modules\/@rhinostone\/swig\/index\.js$/);
    });

    it('accepts a pre-release pin equal to the floor', function () {
        var d = resolver.resolve(FX.hasAlphaSatisfies, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.equal(d.source, 'project');
        assert.equal(d.version, '1.6.0-alpha.3');
    });

    it('the resolved path, when required, exposes the fixture marker', function () {
        var d = resolver.resolve(FX.hasSatisfies, {
            useProject: true,
            min:        '1.6.0'
        });
        var mod = require(d.path);
        assert.equal(mod._fixture, 'has-satisfies');
    });
});


// ---------------------------------------------------------------------------
// 07 - resolve() — rejection paths
// ---------------------------------------------------------------------------

describe('07 - resolve() rejection paths', function () {

    it('rejects a pin below the floor with warning=version-mismatch', function () {
        var d = resolver.resolve(FX.hasTooOld, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'version-mismatch');
        assert.equal(d.version, '1.5.0'); // record what they had, for the warning
        assert.equal(d.path, null);
    });

    it('rejects a different-major pin with warning=version-mismatch', function () {
        var d = resolver.resolve(FX.hasWrongMajor, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'version-mismatch');
        assert.equal(d.version, '2.0.0');
    });

    it('rejects a project without swig with warning=not-installed', function () {
        var d = resolver.resolve(FX.noSwig, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'not-installed');
        assert.equal(d.version, null);
    });

    it('rejects malformed package.json with warning=malformed-package-json', function () {
        var d = resolver.resolve(FX.malformed, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'malformed-package-json');
    });

    it('rejects missing version field with warning=missing-version', function () {
        var d = resolver.resolve(FX.missingVersion, {
            useProject: true,
            min:        '1.6.0'
        });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'missing-version');
    });
});


// ---------------------------------------------------------------------------
// 08 - resolve() — package name override (@rhinostone/swig-twig)
// ---------------------------------------------------------------------------

describe('08 - resolve() package override (swig-twig)', function () {

    it('honours a custom package name when the project has it installed', function () {
        var d = resolver.resolve(FX.hasTwig, {
            useProject: true,
            'package':  '@rhinostone/swig-twig',
            min:        '2.0.0'
        });
        assert.equal(d.source, 'project');
        assert.equal(d['package'], '@rhinostone/swig-twig');
        assert.equal(d.version, '2.0.0-alpha.8');
        assert.match(d.path, /node_modules\/@rhinostone\/swig-twig\/index\.js$/);
    });

    it('does NOT find swig-twig when the configured package is @rhinostone/swig', function () {
        // has-twig has swig-twig but not swig. With the default package name
        // the resolver must miss and fall back to framework — never silently
        // substitute a different package.
        var d = resolver.resolve(FX.hasTwig, {
            useProject: true,
            min:        '1.6.0'
            // package omitted → defaults to @rhinostone/swig
        });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'not-installed');
    });

    it('does NOT find swig when the configured package is @rhinostone/swig-twig', function () {
        // has-satisfies has swig but not swig-twig; package override must
        // not silently fall through to the default package name.
        var d = resolver.resolve(FX.hasSatisfies, {
            useProject: true,
            'package':  '@rhinostone/swig-twig',
            min:        '2.0.0'
        });
        assert.equal(d.source, 'framework');
        assert.equal(d.warning, 'not-installed');
    });
});


// ---------------------------------------------------------------------------
// 09 - load() / get() — cache on process.gina._swig
// ---------------------------------------------------------------------------

describe('09 - load() + get() process-cache', function () {

    it('exports load, get, getDecision, reset', function () {
        assert.equal(typeof resolver.load,        'function');
        assert.equal(typeof resolver.get,         'function');
        assert.equal(typeof resolver.getDecision, 'function');
        assert.equal(typeof resolver.reset,       'function');
    });

    it('reset() clears process.gina._swig / decision / package', function () {
        if (!process.gina) { process.gina = {}; }
        process.gina._swig         = { _sentinel: true };
        process.gina._swigDecision = { source: 'project' };
        process.gina._swigPackage  = '@rhinostone/swig-twig';
        resolver.reset();
        assert.equal(process.gina._swig,         undefined);
        assert.equal(process.gina._swigDecision, undefined);
        assert.equal(process.gina._swigPackage,  undefined);
    });

    it('load() with useProject:false caches the framework copy', function () {
        resolver.reset();
        var swig = resolver.load(FX.hasSatisfies, { useProject: false });
        assert.ok(swig, 'load() must return something');
        assert.equal(process.gina._swig, swig, 'cached on process.gina._swig');
        assert.equal(resolver.getDecision().source, 'framework');
    });

    it('load() with useProject:true + satisfying pin caches the project copy', function () {
        resolver.reset();
        var swig = resolver.load(FX.hasSatisfies, { useProject: true, min: '1.6.0' });
        assert.equal(swig._fixture, 'has-satisfies', 'returned swig is the project fixture');
        var d = resolver.getDecision();
        assert.equal(d.source,  'project');
        assert.equal(d.version, '1.6.2');
    });

    it('load() is idempotent within a process — subsequent calls return the cached instance', function () {
        resolver.reset();
        var first  = resolver.load(FX.hasSatisfies, { useProject: true, min: '1.6.0' });
        // Second call with DIFFERENT options should still return the first
        // instance — the cache wins. This is the standalone-mode contract.
        var second = resolver.load(FX.hasWrongMajor, { useProject: true, min: '1.6.0' });
        assert.equal(first, second, 'second load returns the same cached instance');
    });

    it('get() falls back to framework default when nothing has been loaded', function () {
        resolver.reset();
        var swig = resolver.get();
        assert.ok(swig, 'get() must never return null/undefined');
        assert.equal(process.gina._swig, swig, 'fallback is cached too');
        assert.equal(resolver.getDecision().source, 'framework');
    });

    it('get() after load() returns the loaded instance', function () {
        resolver.reset();
        resolver.load(FX.hasSatisfies, { useProject: true, min: '1.6.0' });
        var swig = resolver.get();
        assert.equal(swig._fixture, 'has-satisfies');
    });

    it('load() with a below-floor pin caches the framework copy + records the warning', function () {
        resolver.reset();
        var swig = resolver.load(FX.hasTooOld, { useProject: true, min: '1.6.0' });
        // Framework copy is a real module (no _fixture marker) — just assert
        // the decision reflects the rejection.
        var d = resolver.getDecision();
        assert.equal(d.source,  'framework');
        assert.equal(d.warning, 'version-mismatch');
        assert.equal(d.version, '1.5.0');
    });

    it('load() honours @rhinostone/swig-twig when the project has it installed', function () {
        resolver.reset();
        var twig = resolver.load(FX.hasTwig, {
            useProject: true,
            'package':  '@rhinostone/swig-twig',
            min:        '2.0.0'
        });
        assert.equal(twig._fixture, 'has-twig');
        assert.equal(resolver.getDecision()['package'], '@rhinostone/swig-twig');
    });

    // Restore a clean cache so subsequent test files see the framework
    // default — critical when the full suite is run via
    // `node --test test/**/*.test.js`, since process.gina persists.
    after(function () { resolver.reset(); });
});


// ---------------------------------------------------------------------------
// 10 - Dev-mode hot-swap via mtime check
// ---------------------------------------------------------------------------

describe('10 - dev-mode hot-swap', function () {

    var originalDevFlag;

    before(function () {
        originalDevFlag = process.env.NODE_ENV_IS_DEV;
    });

    after(function () {
        if (typeof originalDevFlag === 'undefined') {
            delete process.env.NODE_ENV_IS_DEV;
        } else {
            process.env.NODE_ENV_IS_DEV = originalDevFlag;
        }
        resolver.reset();
    });

    // --- Helpers ---------------------------------------------------------

    // Rewrite a fixture's package.json + index.js to a new version and push
    // the package.json mtime strictly ahead of every previous value produced
    // by this helper. `Date.now()` has only millisecond resolution, so two
    // consecutive calls within the same wall-clock millisecond both map to
    // `Date.now() + 1000` and produce identical mtimes — refresh would then
    // see a no-op even though the content changed. The lastMtime tracker
    // guarantees strict monotonic progression, independent of wall-clock
    // granularity. Also evict require.cache for the index.js so the next
    // `require()` re-parses the newly written file.
    var _fixtureLastMtime = 0;
    function updateFixtureTo(fixtureDir, newVersion) {
        var pkgDir = nodePath.join(fixtureDir, 'node_modules', '@rhinostone/swig');
        var pkgJsonPath = nodePath.join(pkgDir, 'package.json');
        var indexJsPath = nodePath.join(pkgDir, 'index.js');
        fs.writeFileSync(pkgJsonPath, JSON.stringify({
            name: '@rhinostone/swig', version: newVersion, main: 'index.js'
        }, null, 2) + '\n');
        fs.writeFileSync(
            indexJsPath,
            'module.exports = { _fixture: ' +
            JSON.stringify(nodePath.basename(fixtureDir)) +
            ', version: ' + JSON.stringify(newVersion) + ' };\n'
        );
        var prev     = fs.statSync(pkgJsonPath).mtimeMs;
        var nextMs   = Math.max(prev, Date.now(), _fixtureLastMtime) + 1000;
        var future   = new Date(nextMs);
        fs.utimesSync(pkgJsonPath, future, future);
        _fixtureLastMtime = nextMs;
        try { delete require.cache[indexJsPath]; } catch (e) { /* ignore */ }
    }

    // --- Tests -----------------------------------------------------------

    it('get() is a no-op in production (NODE_ENV_IS_DEV unset)', function () {
        delete process.env.NODE_ENV_IS_DEV;
        resolver.reset();
        resolver.load(FX.hasSatisfies, { useProject: true, min: '1.6.0' });
        var first = resolver.get();
        // Modify the fixture; in prod mode the change must NOT be picked up.
        updateFixtureTo(FX.hasSatisfies, '1.6.3');
        var second = resolver.get();
        assert.equal(first, second, 'production get() must return the cached instance');
        // Restore the fixture so later tests start from 1.6.2.
        updateFixtureTo(FX.hasSatisfies, '1.6.2');
    });

    it('dev mode + unchanged mtime: get() returns the same instance', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        resolver.load(FX.hasSatisfies, { useProject: true, min: '1.6.0' });
        var first  = resolver.get();
        var second = resolver.get();
        assert.equal(first, second, 'no mtime change → same cached module');
    });

    it('dev mode + changed mtime: get() reloads the new version', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        // Prime the fixture's index.js with a `version` export so the module
        // reload is observable via the returned swig (not only via the
        // decision record).
        updateFixtureTo(FX.hasSatisfies, '1.6.2');
        resolver.load(FX.hasSatisfies, { useProject: true, min: '1.6.0' });
        var before = resolver.get();
        assert.equal(before.version, '1.6.2');

        updateFixtureTo(FX.hasSatisfies, '1.6.3');
        var after = resolver.get();
        assert.equal(after.version, '1.6.3', 'new version loaded after mtime shift');
        var d = resolver.getDecision();
        assert.equal(d.version, '1.6.3', 'decision record reflects new version');

        // Restore for downstream tests.
        updateFixtureTo(FX.hasSatisfies, '1.6.2');
    });

    it('dev mode + useProject:false: refresh is a no-op even if mtime drifts', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        resolver.load(FX.hasSatisfies, { useProject: false });
        var before = resolver.get();
        updateFixtureTo(FX.hasSatisfies, '1.6.4');
        var after = resolver.get();
        assert.equal(before, after, 'useProject:false skips the mtime probe');
        updateFixtureTo(FX.hasSatisfies, '1.6.2');
    });

    it('dev mode + missing projectPath: refresh is a no-op', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        resolver.load(null, { useProject: true });
        var before = resolver.get();
        var after  = resolver.get();
        assert.equal(before, after);
    });

    it('dev mode + never-loaded: get() does not crash on stale refresh path', function () {
        // get() is safe before any load() — should fall back to framework copy.
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        var swig = resolver.get();
        assert.ok(swig, 'got a module');
        assert.equal(resolver.getDecision().source, 'framework');
    });

    it('dev mode + version drift below floor: falls back to framework on reload', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        resolver.load(FX.hasSatisfies, { useProject: true, min: '1.6.0' });
        assert.equal(resolver.getDecision().source, 'project');

        // Downgrade the fixture to below the floor — refresh should reject it.
        updateFixtureTo(FX.hasSatisfies, '1.5.0');
        resolver.get();
        var d = resolver.getDecision();
        assert.equal(d.source,  'framework');
        assert.equal(d.warning, 'version-mismatch');
        assert.equal(d.version, '1.5.0');

        updateFixtureTo(FX.hasSatisfies, '1.6.2');
    });
});


// ---------------------------------------------------------------------------
// 11 - Negative invariant — abandoned bare "swig" is never resolvable
// ---------------------------------------------------------------------------

describe('11 - negative invariant', function () {

    it('the abandoned upstream package name "swig" is not a valid default', function () {
        // Guardrail for the CVE-2023-25345 scenario: a project may still
        // carry a bare "swig" dep from the abandoned upstream. The resolver
        // only considers the packages explicitly named by the caller; bare
        // "swig" is neither the default nor an implicit alias, so it can
        // never override the framework copy.
        assert.notEqual(resolver.DEFAULT_PACKAGE, 'swig');
        assert.match(resolver.DEFAULT_PACKAGE, /^@rhinostone\//);
    });
});
