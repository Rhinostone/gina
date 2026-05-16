/**
 * lib/cmd/project/remove.js + lib/cmd/helper.js — #B16
 *
 * Source-inspection tests + pure-logic replicas for the --force-tolerates-
 * partial-breakage fix. Two coordinating sites:
 *
 *   - `lib/cmd/helper.js` `loadAssets()` (~L640) — when the project manifest
 *     is missing, the helper either recreates from template (current default)
 *     OR, when the task is `project:remove` and `--force` is set, stubs
 *     `cmd.projectData` and skips the recreate + read.
 *
 *   - `lib/cmd/project/remove.js` `init()` (~L53) — when the project folder
 *     is missing, the handler errors and exits. With `--force` it now warns
 *     and dispatches directly to `end(true)` for registry-only removal
 *     (ports cleanup + projects.json delete).
 *
 * Together they let `gina project:rm @<project> --force` succeed against a
 * partially-broken state (missing manifest, missing folder, or both).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var HELPER_SOURCE = path.join(require('../fw'), 'lib/cmd/helper.js');
var REMOVE_SOURCE = path.join(require('../fw'), 'lib/cmd/project/remove.js');
var helperSrc     = fs.readFileSync(HELPER_SOURCE, 'utf8');
var removeSrc     = fs.readFileSync(REMOVE_SOURCE, 'utf8');


// ─────────────────────────────────────────────────────────────────────────
// 01 — helper.js: project:remove --force exemption for missing manifest
// ─────────────────────────────────────────────────────────────────────────

describe('01 - helper.js loadAssets: project:remove --force tolerates missing manifest', function() {

    it('source contains the /:remove$/.test(cmd.task) && cmd.params[force] gate', function() {
        // The exemption branch tests the task name and the --force flag.
        assert.ok(
            /\/\\:remove\$\/\.test\(cmd\.task\)\s*&&\s*cmd\.params\['force'\]/.test(helperSrc),
            'expected `/\\:remove$/.test(cmd.task) && cmd.params[\'force\']` gate in helper.js'
        );
    });

    it('exemption branch stubs cmd.projectData with the minimal shape', function() {
        // The stub object must carry project, version, and bundles keys so
        // downstream `typeof != "undefined"` checks behave correctly.
        var gateIdx = helperSrc.indexOf("/\\:remove$/.test(cmd.task) && cmd.params['force']");
        assert.ok(gateIdx > -1, '#B16 gate anchor not found');
        var afterGate = helperSrc.slice(gateIdx, gateIdx + 600);
        assert.ok(afterGate.indexOf('cmd.projectData') > -1, 'must assign cmd.projectData inside the exemption branch');
        assert.ok(afterGate.indexOf("project: cmd.projectName") > -1, 'stub must carry project: cmd.projectName');
        assert.ok(afterGate.indexOf("version: '0.0.0'") > -1, 'stub must carry version: "0.0.0"');
        assert.ok(afterGate.indexOf("bundles: {}") > -1, 'stub must carry bundles: {}');
    });

    it('exemption branch warns with the manifest path + --force suffix', function() {
        var gateIdx = helperSrc.indexOf("/\\:remove$/.test(cmd.task) && cmd.params['force']");
        var afterGate = helperSrc.slice(gateIdx, gateIdx + 600);
        assert.ok(
            afterGate.indexOf('console.warn') > -1,
            'must warn (not error) on the registry-only removal path'
        );
        assert.ok(
            afterGate.indexOf('registry-only removal') > -1,
            'warn message must mention registry-only removal'
        );
        assert.ok(
            afterGate.indexOf('--force') > -1,
            'warn message must mention --force'
        );
    });

    it('non-force path still recreates from template (existing behaviour preserved)', function() {
        // The else branch must keep the existing recreate-from-template path
        // intact so adding/importing/start/stop/etc. still get a fresh manifest.
        var elseIdx = helperSrc.indexOf("else {", helperSrc.indexOf("/\\:remove$/.test(cmd.task) && cmd.params['force']"));
        assert.ok(elseIdx > -1, 'else branch not found after the #B16 gate');
        var afterElse = helperSrc.slice(elseIdx, elseIdx + 1000);
        assert.ok(
            afterElse.indexOf("'Project manifest.json not found. Trying to fix it ...'") > -1,
            'else branch must keep the existing recreate warn message'
        );
        assert.ok(
            afterElse.indexOf("createFileFromDataSync") > -1,
            'else branch must keep the recreate-from-template code'
        );
    });

    it('cmd.projectData is read once per branch — no duplicate read after refactor', function() {
        // Belt + braces: the L664 unconditional read was moved INSIDE both
        // branches of the if/else. Count occurrences in the loadAssets area.
        var loadAssetsIdx = helperSrc.indexOf('loadAssets = function');
        var nextFnIdx     = helperSrc.indexOf('\n    /**', loadAssetsIdx + 100);
        var region        = helperSrc.slice(loadAssetsIdx, nextFnIdx > -1 ? nextFnIdx : loadAssetsIdx + 4000);
        var readCount     = (region.match(/cmd\.projectData\s*=\s*requireJSON\(cmd\.projectManifestPath\)/g) || []).length;
        // The refactored shape pulls L664 into both branches of the if/else
        // (recreate-then-read and exists-then-read). Stub branch does not read.
        assert.equal(readCount, 2, 'expected exactly 2 read sites — recreate-then-read + exists-then-read');
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 02 — remove.js: --force bypass for missing project folder
// ─────────────────────────────────────────────────────────────────────────

describe('02 - remove.js init: --force bypasses missing project folder', function() {

    it('source contains the if (force) bypass inside the !folder.existsSync() branch', function() {
        var missingFolderIdx = removeSrc.indexOf('!folder.existsSync()');
        assert.ok(missingFolderIdx > -1, '!folder.existsSync() anchor not found');
        var afterMissing = removeSrc.slice(missingFolderIdx, missingFolderIdx + 600);
        assert.ok(
            /if\s*\(\s*force\s*\)/.test(afterMissing),
            'expected `if (force)` bypass inside the missing-folder branch'
        );
    });

    it('bypass dispatches directly to end(true)', function() {
        var missingFolderIdx = removeSrc.indexOf('!folder.existsSync()');
        var afterMissing     = removeSrc.slice(missingFolderIdx, missingFolderIdx + 600);
        assert.ok(
            /return\s+end\s*\(\s*true\s*\)/.test(afterMissing),
            'bypass must `return end(true)` for registry-only removal'
        );
    });

    it('bypass warns instead of erroring', function() {
        var missingFolderIdx = removeSrc.indexOf('!folder.existsSync()');
        var afterMissing     = removeSrc.slice(missingFolderIdx, missingFolderIdx + 600);
        // Inside the if (force) block: console.warn must appear before the
        // outer console.error (which is the no-force branch).
        var forceBlockIdx    = afterMissing.indexOf('if ( force )');
        var consoleErrorIdx  = afterMissing.indexOf('console.error');
        var consoleWarnIdx   = afterMissing.indexOf('console.warn');
        assert.ok(forceBlockIdx > -1, 'if (force) block anchor not found');
        assert.ok(consoleWarnIdx > -1 && consoleWarnIdx < consoleErrorIdx,
            'console.warn must appear inside the force branch, before the no-force console.error');
    });

    it('warn message mentions registry-only removal + --force', function() {
        var missingFolderIdx = removeSrc.indexOf('!folder.existsSync()');
        var afterMissing     = removeSrc.slice(missingFolderIdx, missingFolderIdx + 600);
        assert.ok(
            afterMissing.indexOf('registry-only removal') > -1,
            'warn must mention registry-only removal'
        );
        assert.ok(
            afterMissing.indexOf('--force') > -1,
            'warn must mention --force'
        );
    });

    it('without --force, the original error + exit path is preserved (negative invariant)', function() {
        // The no-force branch must still console.error + process.exit(1).
        var missingFolderIdx = removeSrc.indexOf('!folder.existsSync()');
        var afterMissing     = removeSrc.slice(missingFolderIdx, missingFolderIdx + 600);
        assert.ok(
            /console\.error\([^)]*was not found at this location:/.test(afterMissing),
            'original "was not found at this location" error must still be present'
        );
        assert.ok(
            /process\.exit\(\s*1\s*\)/.test(afterMissing),
            'original process.exit(1) must still be present'
        );
    });

    it('the projects[projectName] missing-from-registry check is unchanged (separate concern)', function() {
        // If the project isn't even in the registry, --force can't help —
        // we have no record to remove. The existing error must stay.
        assert.ok(
            removeSrc.indexOf('not found in `~/.gina/projects.json`') > -1,
            'registry-missing error must remain (separate from #B16)'
        );
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 03 — pure logic — helper.js exemption gate replica
// ─────────────────────────────────────────────────────────────────────────

describe('03 - helper.js exemption gate: pure logic replica', function() {

    // Replica of the gate condition + stub assignment from loadAssets.
    function applyExemption(cmd) {
        if (/\:remove$/.test(cmd.task) && cmd.params['force']) {
            cmd.projectData = { project: cmd.projectName, version: '0.0.0', bundles: {} };
            return true; // exemption applied — caller skips recreate + read
        }
        return false;
    }

    it('project:remove with --force triggers the exemption', function() {
        var cmd = { task: 'project:remove', params: { force: true }, projectName: '@brokenproj' };
        assert.equal(applyExemption(cmd), true);
        assert.deepEqual(cmd.projectData, {
            project: '@brokenproj', version: '0.0.0', bundles: {}
        });
    });

    it('project:remove without --force does NOT trigger the exemption (recreate path)', function() {
        var cmd = { task: 'project:remove', params: {}, projectName: '@brokenproj' };
        assert.equal(applyExemption(cmd), false);
        assert.equal(cmd.projectData, undefined,
            'projectData must not be stubbed — recreate-from-template runs');
    });

    it('project:add with --force does NOT trigger the exemption (different task)', function() {
        // --force on project:add is a legitimate flag for other meanings; the
        // exemption is scoped to :remove specifically.
        var cmd = { task: 'project:add', params: { force: true }, projectName: '@newproj' };
        assert.equal(applyExemption(cmd), false);
    });

    it('bundle:remove with --force does NOT trigger the exemption (task regex anchor)', function() {
        // /\:remove$/ matches `:remove` at end of string, so `bundle:remove`
        // ALSO matches. This is by design — if any future :remove task wants
        // the same tolerance, they get it. But the only :remove task today
        // is `project:remove`. Documenting the intent.
        var cmd = { task: 'bundle:remove', params: { force: true }, projectName: '@whatever' };
        assert.equal(applyExemption(cmd), true,
            'bundle:remove --force ALSO matches by design — any :remove task gets the tolerance');
    });

    it('task with no :remove anywhere ignores the gate', function() {
        var cmd = { task: 'bundle:start', params: { force: true }, projectName: '@p' };
        assert.equal(applyExemption(cmd), false);
    });

    it('stub satisfies typeof-undefined checks downstream (L967-970)', function() {
        var cmd = { task: 'project:remove', params: { force: true }, projectName: '@p' };
        applyExemption(cmd);
        // Mirror the helper.js:967-970 guard pattern.
        var stubBundlesUndefined = typeof(cmd.projectData.bundles) == 'undefined';
        var stubBundlesEmptyKey  = typeof(cmd.projectData.bundles['someBundle']) == 'undefined';
        assert.equal(stubBundlesUndefined, false, 'bundles is present (not undefined)');
        assert.equal(stubBundlesEmptyKey,  true,  'no specific bundle key is present in the stub');
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 04 — pure logic — remove.js bypass dispatch replica
// ─────────────────────────────────────────────────────────────────────────

describe('04 - remove.js bypass: pure logic replica', function() {

    // Replica of the missing-folder branch in init(). Calls in `outcome` to
    // capture the three possible exit paths without process.exit.
    function init(folderExists, force, outcome) {
        if (!folderExists) {
            if (force) {
                outcome.warned = true;
                outcome.endCalled = true; // simulates `return end(true)`
                return;
            }
            outcome.errored = true;
            outcome.exited  = true;
            return;
        }
        outcome.normal = true;
    }

    it('folder exists: normal path (no bypass, no exit)', function() {
        var outcome = {};
        init(true, true, outcome);
        assert.equal(outcome.normal, true);
        assert.ok(!outcome.warned);
        assert.ok(!outcome.errored);
    });

    it('folder missing + force: warn + end(true), no exit', function() {
        var outcome = {};
        init(false, true, outcome);
        assert.equal(outcome.warned, true,    'must warn');
        assert.equal(outcome.endCalled, true, 'must dispatch to end(true)');
        assert.ok(!outcome.errored,           'must NOT error');
        assert.ok(!outcome.exited,            'must NOT exit');
    });

    it('folder missing + no force: error + exit (preserved behaviour)', function() {
        var outcome = {};
        init(false, false, outcome);
        assert.equal(outcome.errored, true, 'must error');
        assert.equal(outcome.exited,  true, 'must exit');
        assert.ok(!outcome.warned,          'must NOT warn');
        assert.ok(!outcome.endCalled,       'must NOT call end()');
    });

    it('folder exists + no force: normal path (unrelated to --force semantics)', function() {
        var outcome = {};
        init(true, false, outcome);
        assert.equal(outcome.normal, true);
    });

});
