/**
 * lib/nunjucks-resolver — behavioural tests.
 *
 * Mirrors test/lib/swig-resolver.test.js in structure, with two key
 * differences: there is no framework-bundled fallback (load() throws on
 * "not-installed" instead of silently returning the framework copy), and
 * there is no version floor (any installed version is accepted).
 *
 * Fixtures are built in os.tmpdir() under before() and torn down under
 * after() — tempdir keeps fixtures out of the repo and avoids the
 * node_modules/ gitignore trap.
 */

'use strict';

var fs       = require('fs');
var os       = require('os');
var nodePath = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var resolver = require(nodePath.join(require('../fw'), 'lib/nunjucks-resolver/src/main'));

// os.tmpdir() on macOS returns /var/folders/... (a symlink to
// /private/var/folders/...). require.cache keys are realpath-normalised to
// the /private/... form; we realpath ROOT inside before() so our cache
// evictions in updateFixtureTo match Node's stored keys.
var ROOT = nodePath.join(os.tmpdir(), 'gina-nunjucks-resolver-test-' + Date.now());

function seedFixture(projectDir, pkgName, pkgJson) {
    var pkgDir = nodePath.join(projectDir, 'node_modules', pkgName);
    fs.mkdirSync(pkgDir, { recursive: true });
    var body = typeof pkgJson === 'string' ? pkgJson : JSON.stringify(pkgJson, null, 2);
    fs.writeFileSync(nodePath.join(pkgDir, 'package.json'), body + '\n');
    fs.writeFileSync(
        nodePath.join(pkgDir, 'index.js'),
        'module.exports = { _fixture: ' +
        JSON.stringify(nodePath.basename(projectDir)) +
        ', renderString: function(src) { return src; } };\n'
    );
}

var FX = {};

before(function () {
    fs.mkdirSync(ROOT, { recursive: true });
    ROOT = fs.realpathSync(ROOT);

    FX.hasNunjucks = nodePath.join(ROOT, 'has-nunjucks');
    seedFixture(FX.hasNunjucks, 'nunjucks', {
        name: 'nunjucks', version: '3.2.4', main: 'index.js'
    });

    FX.hasNunjucksAlpha = nodePath.join(ROOT, 'has-nunjucks-alpha');
    seedFixture(FX.hasNunjucksAlpha, 'nunjucks', {
        name: 'nunjucks', version: '4.0.0-alpha.1', main: 'index.js'
    });

    FX.malformed = nodePath.join(ROOT, 'malformed');
    seedFixture(FX.malformed, 'nunjucks',
        '{ "name": "nunjucks", "version": "3.2.4", not valid json');

    FX.missingVersion = nodePath.join(ROOT, 'missing-version');
    seedFixture(FX.missingVersion, 'nunjucks', {
        name: 'nunjucks', main: 'index.js'
    });

    FX.noNunjucks = nodePath.join(ROOT, 'no-nunjucks');
    fs.mkdirSync(FX.noNunjucks, { recursive: true });
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

    it('exports load', function () {
        assert.equal(typeof resolver.load, 'function');
    });

    it('exports get', function () {
        assert.equal(typeof resolver.get, 'function');
    });

    it('exports getDecision', function () {
        assert.equal(typeof resolver.getDecision, 'function');
    });

    it('exports reset', function () {
        assert.equal(typeof resolver.reset, 'function');
    });

    it('exports DEFAULT_PACKAGE = "nunjucks"', function () {
        assert.equal(resolver.DEFAULT_PACKAGE, 'nunjucks');
    });
});


// ---------------------------------------------------------------------------
// 02 - resolve() — installed project copy
// ---------------------------------------------------------------------------

describe('02 - resolve() installed project copy', function () {

    it('finds nunjucks when installed in the project node_modules', function () {
        var d = resolver.resolve(FX.hasNunjucks, {});
        assert.equal(d.source, 'project');
        assert.equal(d.version, '3.2.4');
        assert.equal(d['package'], 'nunjucks');
        assert.equal(d.warning, null);
        assert.ok(nodePath.isAbsolute(d.path));
        assert.match(d.path, /node_modules\/nunjucks\/index\.js$/);
    });

    it('accepts any version — no floor', function () {
        var d = resolver.resolve(FX.hasNunjucksAlpha, {});
        assert.equal(d.source, 'project');
        assert.equal(d.version, '4.0.0-alpha.1');
        assert.equal(d.warning, null);
    });
});


// ---------------------------------------------------------------------------
// 03 - resolve() — rejection paths
// ---------------------------------------------------------------------------

describe('03 - resolve() rejection paths', function () {

    it('returns not-installed when projectPath is null', function () {
        var d = resolver.resolve(null, {});
        assert.equal(d.source, 'none');
        assert.equal(d.warning, 'not-installed');
    });

    it('returns not-installed when projectPath is undefined', function () {
        var d = resolver.resolve(undefined, {});
        assert.equal(d.source, 'none');
        assert.equal(d.warning, 'not-installed');
    });

    it('returns not-installed when projectPath is an empty string', function () {
        var d = resolver.resolve('', {});
        assert.equal(d.source, 'none');
        assert.equal(d.warning, 'not-installed');
    });

    it('returns not-installed when the project has no nunjucks', function () {
        var d = resolver.resolve(FX.noNunjucks, {});
        assert.equal(d.source, 'none');
        assert.equal(d.warning, 'not-installed');
    });

    it('returns malformed-package-json when package.json is invalid JSON', function () {
        var d = resolver.resolve(FX.malformed, {});
        assert.equal(d.source, 'none');
        assert.equal(d.warning, 'malformed-package-json');
    });

    it('returns missing-version when package.json has no version field', function () {
        var d = resolver.resolve(FX.missingVersion, {});
        assert.equal(d.source, 'none');
        assert.equal(d.warning, 'missing-version');
    });
});


// ---------------------------------------------------------------------------
// 04 - resolve() — package override
// ---------------------------------------------------------------------------

describe('04 - resolve() package override', function () {

    it('honours a custom package name', function () {
        // has-nunjucks fixture has pkg "nunjucks"; looking for a different
        // name should miss cleanly (not-installed).
        var d = resolver.resolve(FX.hasNunjucks, { 'package': 'nunjucks-async-loader' });
        assert.equal(d.source, 'none');
        assert.equal(d.warning, 'not-installed');
    });

    it('records the custom package name in the decision', function () {
        var d = resolver.resolve(FX.hasNunjucks, { 'package': 'custom-nunjucks' });
        assert.equal(d['package'], 'custom-nunjucks');
    });
});


// ---------------------------------------------------------------------------
// 05 - load() — happy path caches the project copy
// ---------------------------------------------------------------------------

describe('05 - load() happy path', function () {

    it('loads the project copy and caches on process.gina._nunjucks', function () {
        resolver.reset();
        var nj = resolver.load(FX.hasNunjucks, {});
        assert.equal(nj._fixture, 'has-nunjucks', 'fixture marker exposed on module');
        assert.equal(process.gina._nunjucks, nj, 'cached on process.gina._nunjucks');
        assert.equal(resolver.getDecision().source,  'project');
        assert.equal(resolver.getDecision().version, '3.2.4');
    });

    it('load() is idempotent within a process — second call returns the cached instance', function () {
        resolver.reset();
        var first  = resolver.load(FX.hasNunjucks, {});
        var second = resolver.load(FX.hasNunjucks, {});
        assert.equal(first, second);
    });

    it('second load with a different package name keeps the first but logs a warning', function () {
        resolver.reset();
        var first = resolver.load(FX.hasNunjucks, { 'package': 'nunjucks' });
        // Second call with different pkg — the first is already cached.
        var second = resolver.load(FX.hasNunjucks, { 'package': 'different-name' });
        assert.equal(first, second, 'cached instance returned unchanged');
    });
});


// ---------------------------------------------------------------------------
// 06 - load() — hard error on not-installed
// ---------------------------------------------------------------------------

describe('06 - load() rejection paths', function () {

    it('throws NUNJUCKS_NOT_INSTALLED when the project has no nunjucks', function () {
        resolver.reset();
        assert.throws(
            function () { resolver.load(FX.noNunjucks, {}); },
            function (err) {
                assert.equal(err.code, 'NUNJUCKS_NOT_INSTALLED');
                assert.ok(err.decision, 'decision attached to error');
                assert.equal(err.decision.source,  'none');
                assert.equal(err.decision.warning, 'not-installed');
                return true;
            }
        );
    });

    it('throws when projectPath is falsy', function () {
        resolver.reset();
        assert.throws(
            function () { resolver.load(null, {}); },
            function (err) { return err.code === 'NUNJUCKS_NOT_INSTALLED'; }
        );
    });

    it('throws when package.json is malformed', function () {
        resolver.reset();
        assert.throws(
            function () { resolver.load(FX.malformed, {}); },
            function (err) {
                assert.equal(err.code, 'NUNJUCKS_NOT_INSTALLED');
                assert.equal(err.decision.warning, 'malformed-package-json');
                return true;
            }
        );
    });

    it('throws when package.json is missing a version field', function () {
        resolver.reset();
        assert.throws(
            function () { resolver.load(FX.missingVersion, {}); },
            function (err) {
                assert.equal(err.code, 'NUNJUCKS_NOT_INSTALLED');
                assert.equal(err.decision.warning, 'missing-version');
                return true;
            }
        );
    });

    it('error message includes the expected path and npm install hint', function () {
        resolver.reset();
        try {
            resolver.load(FX.noNunjucks, {});
        } catch (err) {
            assert.match(err.message, /node_modules\/nunjucks/);
            assert.match(err.message, /npm install nunjucks/);
            return;
        }
        assert.fail('load() should have thrown');
    });

    it('does NOT cache a failed load — subsequent successful load wins', function () {
        resolver.reset();
        try { resolver.load(FX.noNunjucks, {}); } catch (e) { /* expected */ }
        assert.equal(process.gina._nunjucks, undefined, 'no stub cached');
        var nj = resolver.load(FX.hasNunjucks, {});
        assert.equal(nj._fixture, 'has-nunjucks');
    });
});


// ---------------------------------------------------------------------------
// 07 - get() — throws before load; returns cached after load
// ---------------------------------------------------------------------------

describe('07 - get()', function () {

    it('throws a clear error when called before any load', function () {
        resolver.reset();
        assert.throws(
            function () { resolver.get(); },
            /load\(\) succeeded/
        );
    });

    it('returns the cached module after load() succeeds', function () {
        resolver.reset();
        resolver.load(FX.hasNunjucks, {});
        var nj = resolver.get();
        assert.equal(nj._fixture, 'has-nunjucks');
    });
});


// ---------------------------------------------------------------------------
// 08 - reset() — clears all six fields
// ---------------------------------------------------------------------------

describe('08 - reset()', function () {

    it('clears every _nunjucks* field on process.gina', function () {
        if (!process.gina) { process.gina = {}; }
        process.gina._nunjucks            = { sentinel: true };
        process.gina._nunjucksDecision    = { source: 'project' };
        process.gina._nunjucksPackage     = 'nunjucks';
        process.gina._nunjucksProjectPath = '/srv/app';
        process.gina._nunjucksOptions     = { a: 1 };
        process.gina._nunjucksMtime       = 12345;
        resolver.reset();
        assert.equal(process.gina._nunjucks,            undefined);
        assert.equal(process.gina._nunjucksDecision,    undefined);
        assert.equal(process.gina._nunjucksPackage,     undefined);
        assert.equal(process.gina._nunjucksProjectPath, undefined);
        assert.equal(process.gina._nunjucksOptions,     undefined);
        assert.equal(process.gina._nunjucksMtime,       undefined);
    });
});


// ---------------------------------------------------------------------------
// 09 - getDecision() — default state
// ---------------------------------------------------------------------------

describe('09 - getDecision()', function () {

    it('returns a source=none record before any load', function () {
        resolver.reset();
        var d = resolver.getDecision();
        assert.equal(d.source,  'none');
        assert.equal(d['package'], 'nunjucks');
        assert.equal(d.version, null);
        assert.equal(d.path,    null);
        assert.equal(d.warning, null);
    });

    it('returns the cached decision after load()', function () {
        resolver.reset();
        resolver.load(FX.hasNunjucks, {});
        var d = resolver.getDecision();
        assert.equal(d.source,  'project');
        assert.equal(d.version, '3.2.4');
    });
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

    // Rewrite fixture + push mtime strictly ahead of any previous value.
    // Date.now() has ms resolution — two calls in the same wall-clock ms
    // would produce identical mtimes without the monotonic counter. Also
    // evict require.cache so the next require() re-parses the new file.
    var _fixtureLastMtime = 0;
    function updateFixtureTo(fixtureDir, newVersion) {
        var pkgDir = nodePath.join(fixtureDir, 'node_modules', 'nunjucks');
        var pkgJsonPath = nodePath.join(pkgDir, 'package.json');
        var indexJsPath = nodePath.join(pkgDir, 'index.js');
        fs.writeFileSync(pkgJsonPath, JSON.stringify({
            name: 'nunjucks', version: newVersion, main: 'index.js'
        }, null, 2) + '\n');
        fs.writeFileSync(
            indexJsPath,
            'module.exports = { _fixture: ' +
            JSON.stringify(nodePath.basename(fixtureDir)) +
            ', version: ' + JSON.stringify(newVersion) + ' };\n'
        );
        var prev   = fs.statSync(pkgJsonPath).mtimeMs;
        var nextMs = Math.max(prev, Date.now(), _fixtureLastMtime) + 1000;
        var future = new Date(nextMs);
        fs.utimesSync(pkgJsonPath, future, future);
        _fixtureLastMtime = nextMs;
        try { delete require.cache[indexJsPath]; } catch (e) { /* ignore */ }
    }

    it('get() is a no-op in production (NODE_ENV_IS_DEV unset)', function () {
        delete process.env.NODE_ENV_IS_DEV;
        resolver.reset();
        updateFixtureTo(FX.hasNunjucks, '3.2.4');
        resolver.load(FX.hasNunjucks, {});
        var first = resolver.get();
        updateFixtureTo(FX.hasNunjucks, '3.2.5');
        var second = resolver.get();
        assert.equal(first, second, 'production keeps the cached instance');
        updateFixtureTo(FX.hasNunjucks, '3.2.4');
    });

    it('dev mode + unchanged mtime: get() returns the same instance', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        resolver.load(FX.hasNunjucks, {});
        var first  = resolver.get();
        var second = resolver.get();
        assert.equal(first, second);
    });

    it('dev mode + changed mtime: get() reloads the new version', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        updateFixtureTo(FX.hasNunjucks, '3.2.4');
        resolver.load(FX.hasNunjucks, {});
        var before = resolver.get();
        assert.equal(before.version, '3.2.4');

        updateFixtureTo(FX.hasNunjucks, '3.2.5');
        var after = resolver.get();
        assert.equal(after.version, '3.2.5', 'new version loaded after mtime shift');
        assert.equal(resolver.getDecision().version, '3.2.5');

        updateFixtureTo(FX.hasNunjucks, '3.2.4'); // restore
    });

    it('dev mode + missing projectPath (impossible in practice): refresh is a no-op', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        // load() would throw for null projectPath, so simulate a cached
        // state without a projectPath directly.
        if (!process.gina) { process.gina = {}; }
        process.gina._nunjucks         = { _stub: true };
        process.gina._nunjucksDecision = { source: 'project', path: null };
        process.gina._nunjucksOptions  = {};
        process.gina._nunjucksProjectPath = null;
        var before = resolver.get();
        assert.equal(before, process.gina._nunjucks, 'no reload when projectPath is falsy');
    });

    it('dev mode + never-loaded: get() still throws (no fallback)', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        assert.throws(
            function () { resolver.get(); },
            /load\(\) succeeded/
        );
    });

    it('dev mode + uninstall between loads: refresh surfaces the error', function () {
        process.env.NODE_ENV_IS_DEV = 'true';
        resolver.reset();
        updateFixtureTo(FX.hasNunjucks, '3.2.4');
        resolver.load(FX.hasNunjucks, {});

        // "Uninstall" by removing the package.json and index.js.
        var pkgDir = nodePath.join(FX.hasNunjucks, 'node_modules', 'nunjucks');
        fs.rmSync(pkgDir, { recursive: true, force: true });

        assert.throws(
            function () { resolver.get(); },
            function (err) { return err.code === 'NUNJUCKS_NOT_INSTALLED'; },
            'refresh detects the uninstall and re-throws'
        );

        // Restore for downstream tests.
        seedFixture(FX.hasNunjucks, 'nunjucks', {
            name: 'nunjucks', version: '3.2.4', main: 'index.js'
        });
    });
});


// ---------------------------------------------------------------------------
// 11 - Negative invariant — library never falls back to a framework copy
// ---------------------------------------------------------------------------

describe('11 - negative invariant', function () {

    it('there is no framework fallback path — load() with no projectPath throws', function () {
        resolver.reset();
        assert.throws(function () { resolver.load(null, {}); });
    });

    it('DEFAULT_PACKAGE is exactly "nunjucks" — no namespace prefix', function () {
        // Mirrors the swig-resolver invariant: the default package name is
        // the canonical upstream package, not a fork or namespaced rewrite.
        assert.equal(resolver.DEFAULT_PACKAGE, 'nunjucks');
    });
});
