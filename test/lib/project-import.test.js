/**
 * lib/cmd/project/import.js — re-registers a project that already exists on disk.
 * It is a thin ALIAS to lib/cmd/project/add.js; import mode is handled by
 * checkImportMode() → end() → the inner addBundleToManifest(), which is where the
 * release-target writing happens.
 *
 * #B55 — `project:import` must be ADDITIVE across scope×env targets. The previous
 * addBundleToManifest() rebuilt `data.bundles[<bundle>]` from scratch on every
 * import (`releases: {}`) and then unconditionally re-wrote each target, so any
 * release target registered under another scope/env — or with a custom
 * path/version, or under the dev env (which the loop skips) — was silently
 * dropped/clobbered. The fix preserves an existing bundle entry + its `releases`
 * map and only seeds a default target for scope×env cells that have none, mirroring
 * the additive pattern already in lib/cmd/bundle/build.js (`if ( !target )`).
 *
 * Source-inspection tests (same style as project-move.test.js): the handler runs
 * in the CLI daemon/offline context and mutates ~/.gina + a project's manifest.json,
 * so these assertions prove the source structure of the additive merge. Section 05
 * is a pure-logic replica of the genuinely new bit — the additive release-target
 * merge — including a SUBTRACT test that runs the OLD reset-based logic on the same
 * input to prove the guard is load-bearing (it is what stops the data loss).
 *
 * The addBundleToManifest source-pins (§02/§03) are scoped to that function's body
 * via an end-anchored slice (`var addBundleToManifest` → `var linkGina`) so a
 * future edit elsewhere in add.js cannot drift them.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var IMPORT_SOURCE = path.join(require('../fw'), 'lib/cmd/project/import.js');
var ADD_SOURCE    = path.join(require('../fw'), 'lib/cmd/project/add.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/project/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/project/arguments.json');

var importSrc = fs.readFileSync(IMPORT_SOURCE, 'utf8');
var addSrc    = fs.readFileSync(ADD_SOURCE, 'utf8');
var helpTxt   = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr   = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));

// end-anchored slice of the addBundleToManifest function body (jsdoc.md: anchor a
// function-body slice on the declaration form, end on the NEXT declaration).
var fnStart = addSrc.indexOf('var addBundleToManifest = function');
var fnEnd   = addSrc.indexOf('var linkGina', fnStart);
var FN      = addSrc.slice(fnStart, fnEnd);


// ---------------------------------------------------------------------------
// 01 — module shape (import is an alias to add)
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('import.js aliases the Add handler', function () {
        assert.match(importSrc, /module\.exports\s*=\s*require\(\s*['"]\.\/add['"]\s*\)/);
    });

    it('the slice resolves to the addBundleToManifest function body', function () {
        assert.ok(fnStart >= 0, 'addBundleToManifest declaration found');
        assert.ok(fnEnd > fnStart, 'linkGina end-anchor found after it');
        assert.match(FN, /var addBundleToManifest = function\(data, b, done\) \{/);
    });
});


// ---------------------------------------------------------------------------
// 02 — additive merge source-pins (the fix)
// ---------------------------------------------------------------------------

describe('02 - additive merge structure', function () {

    it('only seeds the default bundle skeleton when the bundle is NEW', function () {
        assert.match(FN, /if \(\s*typeof\(data\.bundles\[local\.bundle\]\)\s*==\s*'undefined'\s*\|\|\s*!data\.bundles\[local\.bundle\]\s*\)\s*\{/);
    });

    it('guards the releases map for a pre-existing bundle entry', function () {
        assert.match(FN, /if \(\s*typeof\(data\.bundles\[local\.bundle\]\.releases\)\s*==\s*'undefined'\s*\|\|\s*!data\.bundles\[local\.bundle\]\.releases\s*\)\s*\{/);
    });

    it('uses the bundle\'s real version for any default target path it seeds', function () {
        assert.match(FN, /version = data\.bundles\[local\.bundle\]\.version \|\| version;/);
    });

    it('only writes a default target when none exists (never clobbers a custom one)', function () {
        assert.match(FN, /if \(\s*typeof\(data\.bundles\[local\.bundle\]\.releases\[scope\]\[env\]\.target\)\s*==\s*'undefined'\s*\)\s*\{/);
    });

    it('still skips the dev env (no target for dev)', function () {
        assert.match(FN, /if \(\s*self\.projects\[self\.projectName\]\['dev_env'\]\s*==\s*env\s*\)\s*\{[\s\S]{0,40}?continue;/);
    });
});


// ---------------------------------------------------------------------------
// 03 — load-bearing structure: the writes are GUARDED, not unconditional
// ---------------------------------------------------------------------------

describe('03 - writes are guarded (no wholesale reset / no clobber)', function () {

    it('the bundle-entry skeleton is gated on the bundle being absent', function () {
        var asgnIdx  = FN.indexOf('data.bundles[local.bundle] = {');
        var guardIdx = FN.lastIndexOf("typeof(data.bundles[local.bundle]) == 'undefined'", asgnIdx);
        assert.ok(asgnIdx >= 0, 'skeleton assignment present');
        assert.ok(guardIdx >= 0 && asgnIdx - guardIdx < 160,
            'the `data.bundles[local.bundle] = {` skeleton must be immediately preceded by the typeof-undefined guard');
    });

    it('there is exactly one bundle-entry assignment (no second unconditional reset)', function () {
        var count = (FN.match(/data\.bundles\[local\.bundle\] = \{/g) || []).length;
        assert.equal(count, 1, 'only the guarded skeleton assigns the bundle entry');
    });

    it('the default target write is gated on the target being absent', function () {
        var tgtIdx   = FN.indexOf('.releases[scope][env].target = "releases/');
        var guardIdx = FN.lastIndexOf("typeof(data.bundles[local.bundle].releases[scope][env].target) == 'undefined'", tgtIdx);
        assert.ok(tgtIdx >= 0, 'default target write present');
        assert.ok(guardIdx >= 0 && tgtIdx - guardIdx < 220,
            'the default `.target =` write must be gated on the target being absent');
    });
});


// ---------------------------------------------------------------------------
// 04 — help.txt + arguments.json
// ---------------------------------------------------------------------------

describe('04 - help + arguments', function () {

    it('documents project:import in help.txt', function () {
        assert.match(helpTxt, /\[ Import an existing project \]/);
        assert.match(helpTxt, /gina project:import @<project_name>/);
    });

    it('arguments.json whitelists --scope / --env / --path', function () {
        assert.ok(argsArr.indexOf('--scope') !== -1, '--scope must be whitelisted');
        assert.ok(argsArr.indexOf('--env')   !== -1, '--env must be whitelisted');
        assert.ok(argsArr.indexOf('--path')  !== -1, '--path must be whitelisted');
    });
});


// ---------------------------------------------------------------------------
// 05 — pure-logic replica of the additive release-target merge
// ---------------------------------------------------------------------------

describe('05 - additive merge replica', function () {

    // Faithful mirror of addBundleToManifest()'s per-bundle block (the fix):
    // preserve an existing entry + its releases; only seed missing scope×env cells.
    function additiveMerge(data, bundle, scopes, envs, devEnv) {
        var d = JSON.parse(JSON.stringify(data));
        var version = '0.0.1';
        if (typeof d.bundles[bundle] === 'undefined' || !d.bundles[bundle]) {
            d.bundles[bundle] = {
                _comment: 'Your comment goes here.',
                version: version,
                tag: version.split('.').join(''),
                src: 'src/' + bundle,
                link: 'bundles/' + bundle,
                releases: {}
            };
        }
        if (typeof d.bundles[bundle].releases === 'undefined' || !d.bundles[bundle].releases) {
            d.bundles[bundle].releases = {};
        }
        version = d.bundles[bundle].version || version;
        for (var s = 0; s < scopes.length; s++) {
            var scope = scopes[s];
            if (typeof d.bundles[bundle].releases[scope] === 'undefined') {
                d.bundles[bundle].releases[scope] = {};
            }
            for (var i = 0; i < envs.length; i++) {
                var env = envs[i];
                if (devEnv === env) { continue; }
                if (typeof d.bundles[bundle].releases[scope][env] === 'undefined') {
                    d.bundles[bundle].releases[scope][env] = {};
                }
                if (typeof d.bundles[bundle].releases[scope][env].target === 'undefined') {
                    d.bundles[bundle].releases[scope][env].target =
                        'releases/' + bundle + '/' + scope + '/' + env + '/' + version;
                }
            }
        }
        return d;
    }

    // The OLD (buggy) per-bundle block — wholesale reset then unconditional target.
    function legacyReset(data, bundle, scopes, envs, devEnv) {
        var d = JSON.parse(JSON.stringify(data));
        var version = '0.0.1';
        d.bundles[bundle] = {
            _comment: 'Your comment goes here.',
            version: version,
            tag: version.split('.').join(''),
            src: 'src/' + bundle,
            link: 'bundles/' + bundle,
            releases: {}
        };
        for (var s = 0; s < scopes.length; s++) {
            var scope = scopes[s];
            if (typeof d.bundles[bundle].releases[scope] === 'undefined') {
                d.bundles[bundle].releases[scope] = {};
            }
            for (var i = 0; i < envs.length; i++) {
                var env = envs[i];
                if (devEnv === env) { continue; }
                if (typeof d.bundles[bundle].releases[scope][env] === 'undefined') {
                    d.bundles[bundle].releases[scope][env] = {};
                }
                d.bundles[bundle].releases[scope][env].target =
                    'releases/' + bundle + '/' + scope + '/' + env + '/' + version;
            }
        }
        return d;
    }

    // A manifest with a custom-versioned production target, a dev-env target
    // (which the loop skips), and the bundle pinned at a real version.
    function sampleManifest() {
        return {
            bundles: {
                api: {
                    _comment: 'keep me',
                    version: '2.4.0',
                    tag: '240',
                    src: 'src/api',
                    link: 'bundles/api',
                    releases: {
                        production: { prod: { target: 'releases/api/production/prod/2.4.0' } },
                        local:      { dev:  { target: 'releases/api/local/dev/2.4.0' } }
                    }
                }
            }
        };
    }

    it('preserves a pre-existing custom target across a full-matrix import (never clobbers)', function () {
        var out = additiveMerge(sampleManifest(), 'api', ['local', 'production'], ['dev', 'prod'], 'dev');
        // custom production/prod target kept at its real version, not reset to 0.0.1
        assert.equal(out.bundles.api.releases.production.prod.target, 'releases/api/production/prod/2.4.0');
        // bundle metadata preserved (whole entry, not just releases)
        assert.equal(out.bundles.api._comment, 'keep me');
        assert.equal(out.bundles.api.version, '2.4.0');
    });

    it('keeps a dev-env target alive (the loop skips dev, so a reset would have wiped it)', function () {
        var out = additiveMerge(sampleManifest(), 'api', ['local', 'production'], ['dev', 'prod'], 'dev');
        assert.equal(out.bundles.api.releases.local.dev.target, 'releases/api/local/dev/2.4.0');
    });

    it('seeds a NEW scope×env cell with the bundle\'s real version', function () {
        var out = additiveMerge(sampleManifest(), 'api', ['local', 'production'], ['dev', 'prod'], 'dev');
        // local only had a dev target; local/prod is newly seeded, using version 2.4.0
        assert.equal(out.bundles.api.releases.local.prod.target, 'releases/api/local/prod/2.4.0');
    });

    it('registering a brand-new scope does not wipe existing scopes\' targets', function () {
        var manifest = {
            bundles: {
                web: {
                    version: '1.0.0',
                    releases: {
                        local:      { prod: { target: 'releases/web/local/prod/1.0.0' } },
                        production: { prod: { target: 'releases/web/production/prod/1.0.0' } }
                    }
                }
            }
        };
        // user ran `scope:add staging` then `project:import --scope=staging --env=prod`
        var out = additiveMerge(manifest, 'web', ['local', 'production', 'staging'], ['dev', 'prod'], 'dev');
        assert.equal(out.bundles.web.releases.local.prod.target, 'releases/web/local/prod/1.0.0');       // survives
        assert.equal(out.bundles.web.releases.production.prod.target, 'releases/web/production/prod/1.0.0'); // survives
        assert.equal(out.bundles.web.releases.staging.prod.target, 'releases/web/staging/prod/1.0.0');   // added
    });

    it('is idempotent — importing the same scope×env twice changes nothing', function () {
        var scopes = ['local', 'production'], envs = ['dev', 'prod'];
        var once  = additiveMerge(sampleManifest(), 'api', scopes, envs, 'dev');
        var twice = additiveMerge(once, 'api', scopes, envs, 'dev');
        assert.deepEqual(twice, once);
    });

    it('a brand-new bundle still gets the default skeleton at 0.0.1', function () {
        var out = additiveMerge({ bundles: {} }, 'fresh', ['local'], ['dev', 'prod'], 'dev');
        assert.equal(out.bundles.fresh.version, '0.0.1');
        assert.equal(out.bundles.fresh.releases.local.prod.target, 'releases/fresh/local/prod/0.0.1');
        assert.equal(typeof out.bundles.fresh.releases.local.dev, 'undefined'); // dev skipped
    });

    it('SUBTRACT: the OLD reset-based logic drops + clobbers the other targets', function () {
        var manifest = sampleManifest();
        // same inputs, narrowed matrix (drift): import only knows about `production`
        var legacy = legacyReset(manifest, 'api', ['production'], ['dev', 'prod'], 'dev');
        var fixed  = additiveMerge(manifest, 'api', ['production'], ['dev', 'prod'], 'dev');

        // OLD: local scope wiped entirely, custom production version clobbered to 0.0.1
        assert.equal(typeof legacy.bundles.api.releases.local, 'undefined');
        assert.equal(legacy.bundles.api.releases.production.prod.target, 'releases/api/production/prod/0.0.1');

        // NEW: both targets preserved at their real versions
        assert.equal(fixed.bundles.api.releases.local.dev.target, 'releases/api/local/dev/2.4.0');
        assert.equal(fixed.bundles.api.releases.production.prod.target, 'releases/api/production/prod/2.4.0');
    });
});
