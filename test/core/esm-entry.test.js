var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var Module = require('module');

var ROOT = path.join(__dirname, '..', '..');
var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

var INDEX_MJS_SRC = fs.readFileSync(path.join(ROOT, 'index.mjs'), 'utf8');
var GNA_MJS_SRC = fs.readFileSync(path.join(ROOT, 'gna.mjs'), 'utf8');


// ─── 01 — exports map shape (#M10) ───────────────────────────────────────────
//
// The package declares a STRICT exports map: the documented public surface is
// exactly the bare specifier (`gina`), the explicit-exports helper module
// (`gina/gna`) and `gina/package.json`. That set was measured against every
// known consumer surface before the map landed — nothing else is Node-resolved
// against the package. Each entry carries a "types" condition FIRST so
// TypeScript's node16/bundler resolution keeps finding the declarations that
// "types" / "typesVersions" used to serve (once "exports" exists, TS ignores
// "typesVersions" for these specifiers).

describe('esm-entry — 01: exports map shape', function () {

    it('declares an exports map with exactly the documented subpaths', function () {
        assert.ok(pkg.exports, 'package.json must declare "exports"');
        assert.deepEqual(
            Object.keys(pkg.exports).sort(),
            ['.', './gna', './package.json'].sort()
        );
    });

    it('"." carries types/import/require conditions, types first', function () {
        var dot = pkg.exports['.'];
        assert.deepEqual(Object.keys(dot), ['types', 'import', 'require']);
        assert.equal(dot.types, './types/index.d.ts');
        assert.equal(dot.import, './index.mjs');
    });

    it('"." require condition stays in lockstep with "main"', function () {
        // The bump scripts (prepare_version.js + post_publish.js bumpVersion)
        // rewrite "main" and the exports "." require condition together; this
        // pin makes any drift between them fail the suite.
        assert.equal(pkg.exports['.'].require, pkg.main + '.js');
    });

    it('"main" carries the current version (bump-chain invariant)', function () {
        assert.equal(pkg.main, './framework/v' + pkg.version + '/core/gna');
    });

    it('"." types condition matches the top-level "types" field', function () {
        assert.equal(pkg.exports['.'].types, pkg.types);
    });

    it('"./gna" carries types/import/require conditions, types first', function () {
        var gna = pkg.exports['./gna'];
        assert.deepEqual(Object.keys(gna), ['types', 'import', 'require']);
        assert.equal(gna.types, './types/gna.d.ts');
        assert.equal(gna.import, './gna.mjs');
        assert.equal(gna.require, './gna.js');
    });

    it('"./gna" types condition matches the typesVersions mapping', function () {
        var tv = pkg.typesVersions && pkg.typesVersions['*'] && pkg.typesVersions['*'].gna;
        assert.ok(Array.isArray(tv) && tv.length === 1, 'typesVersions["*"].gna mapping expected');
        assert.equal(pkg.exports['./gna'].types, tv[0]);
    });

    it('"./package.json" is exported verbatim', function () {
        assert.equal(pkg.exports['./package.json'], './package.json');
    });

    it('every exports target file exists on disk', function () {
        var targets = [
            pkg.exports['.'].types, pkg.exports['.'].import, pkg.exports['.'].require,
            pkg.exports['./gna'].types, pkg.exports['./gna'].import, pkg.exports['./gna'].require,
            pkg.exports['./package.json']
        ];
        for (var i = 0; i < targets.length; i++) {
            assert.ok(
                fs.existsSync(path.join(ROOT, targets[i])),
                'exports target missing on disk: ' + targets[i]
            );
        }
    });
});


// ─── 02 — resolution behaviour ───────────────────────────────────────────────
//
// This test file lives INSIDE the package, so `require.resolve('gina')`
// self-references through the exports map (Node only allows self-reference
// by name once "exports" exists). The negative ERR_PACKAGE_PATH_NOT_EXPORTED
// assertion is the proof the map is ACTIVE — the positive resolutions alone
// would also succeed via the legacy node_modules walk + "main".

describe('esm-entry — 02: resolution behaviour', function () {

    it('require.resolve("gina") resolves to the framework core entry', function () {
        assert.equal(
            fs.realpathSync(require.resolve('gina')),
            fs.realpathSync(path.join(ROOT, 'framework', 'v' + pkg.version, 'core', 'gna.js'))
        );
    });

    it('require.resolve("gina/gna") resolves to the root explicit-exports module', function () {
        assert.equal(
            fs.realpathSync(require.resolve('gina/gna')),
            fs.realpathSync(path.join(ROOT, 'gna.js'))
        );
    });

    it('require.resolve("gina/package.json") resolves', function () {
        assert.equal(
            fs.realpathSync(require.resolve('gina/package.json')),
            fs.realpathSync(path.join(ROOT, 'package.json'))
        );
    });

    it('undeclared subpaths are blocked (exports map is active)', function () {
        assert.throws(
            function () { require.resolve('gina/utils/helper.js'); },
            { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
        );
    });
});


// ─── 03 — wrapper file contracts ─────────────────────────────────────────────
//
// index.mjs resolves the core through package.json's "main" so it never
// carries a version-pinned framework path (it is deliberately NOT a member of
// the version-bump rewrite chain). Both wrappers expose a DEFAULT export only:
// gna.js's getter properties resolve at access time (after framework boot),
// so static named ESM re-exports would freeze `undefined` pre-boot.

describe('esm-entry — 03: wrapper file contracts', function () {

    it('index.mjs resolves the core via package.json "main" (version-agnostic)', function () {
        assert.match(INDEX_MJS_SRC, /createRequire/);
        assert.match(INDEX_MJS_SRC, /require\(\s*require\(\s*'\.\/package\.json'\s*\)\.main\s*\)/);
        assert.doesNotMatch(INDEX_MJS_SRC, /framework\/v\d/);
    });

    it('gna.mjs requires the sibling gna.js (version-agnostic)', function () {
        assert.match(GNA_MJS_SRC, /createRequire/);
        assert.match(GNA_MJS_SRC, /require\(\s*'\.\/gna\.js'\s*\)/);
        assert.doesNotMatch(GNA_MJS_SRC, /framework\/v\d/);
    });

    it('both wrappers export a default and nothing else', function () {
        assert.match(INDEX_MJS_SRC, /export default gna;/);
        assert.match(GNA_MJS_SRC, /export default gnaHelpers;/);
        // No named exports — locks the resolve-at-access-time contract for
        // the gna.js getters (and keeps the "." surface honest).
        assert.doesNotMatch(INDEX_MJS_SRC, /export\s+(const|let|var|function|class|\{)/);
        assert.doesNotMatch(GNA_MJS_SRC, /export\s+(const|let|var|function|class|\{)/);
    });
});


// ─── 04 — ESM evaluation (behavioural) ───────────────────────────────────────
//
// `require('gina')` boots the framework and THROWS outside a spawned bundle
// child (it expects the serialized bundle context), so the behavioural check
// stubs the CJS require cache at the resolved core path before importing:
// index.mjs's createRequire shares the global require.cache, so the import
// must surface the stubbed module.exports as the ESM default. This proves the
// wrapper wiring end-to-end without booting the framework.

describe('esm-entry — 04: ESM evaluation', function () {

    function withCjsStub(resolvedPath, stubExports, run) {
        var hadEntry = Object.prototype.hasOwnProperty.call(require.cache, resolvedPath);
        var prevEntry = require.cache[resolvedPath];
        var stub = new Module(resolvedPath, null);
        stub.exports = stubExports;
        stub.loaded = true;
        require.cache[resolvedPath] = stub;
        return run().finally(function () {
            if (hadEntry) { require.cache[resolvedPath] = prevEntry; }
            else { delete require.cache[resolvedPath]; }
        });
    }

    it('import("gina") surfaces the CJS core module.exports as default', function () {
        var stubExports = { __esmEntryTestStub: 'core' };
        return withCjsStub(require.resolve('gina'), stubExports, async function () {
            var ns = await import('gina');
            assert.equal(ns.default, stubExports);
        });
    });

    it('import("gina/gna") surfaces the CJS helper module.exports as default', function () {
        var stubExports = { __esmEntryTestStub: 'gna' };
        return withCjsStub(require.resolve('gina/gna'), stubExports, async function () {
            var ns = await import('gina/gna');
            assert.equal(ns.default, stubExports);
        });
    });
});
