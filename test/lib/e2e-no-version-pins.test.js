/**
 * E2E surfaces — no hardcoded framework-version paths (rename guard).
 *
 * The framework directory is renamed on every release cut
 * (script/prepare_version.js: framework/v<old> → framework/v<new>, then
 * post_publish.js bumpVersion renames again for the next alpha), so any e2e
 * fixture, spec, or config embedding a literal `framework/v<digit>` path is
 * green right up to the cut and breaks on every post-rename tree — the tag
 * (and master, which only moves via tag merges) then carries a deterministic
 * E2E red until the next release. This is exactly what happened at the
 * 0.4.6 cut: the a11y fixture hardcoded its stylesheet href under the
 * then-current alpha framework dir, and the two scroll-lock / transition
 * specs failed on every post-rename push (fixed in ece02d62 by serving the
 * fixture through test/e2e/runtime-server.js, which derives the framework
 * dir from package.json at runtime).
 *
 * This guard locks that version-agnostic state: every file under test/e2e/
 * and .github/workflows/, plus playwright.config.js, must stay free of
 * `framework/v<digit>` literals. It runs in the gated suite (test/lib glob —
 * local pre-publish gate + the Tests CI workflow), so a reintroduced pin
 * fails at commit time, long before any cut.
 *
 * Scope notes:
 * - The sweep covers ONLY the non-rewritten surfaces that reference REAL
 *   on-disk paths. Workflows are included because they share the failure
 *   shape (a hardcoded FW_DIR would be green until the cut); today they
 *   derive `framework/v${VERSION}` dynamically. Sibling node tests
 *   legitimately embed fictitious framework/v1-style mock paths as test
 *   data and must not be swept (this file itself carries the historical
 *   offending literal in its replica section below — it lives in test/lib,
 *   outside the swept set, so it cannot self-trip).
 * - gna.js and the root package.json `main` field DO carry the literal by
 *   design — script/prepare_version.js and post_publish.js bumpVersion
 *   rewrite them atomically with the dir rename, so they are maintained
 *   surfaces, deliberately NOT swept here.
 * - The regex is digit-anchored (`framework/v` followed by a digit) so
 *   prose like `framework/v<version>`, the workflows' `v${VERSION}`
 *   interpolation, `v*` glob pathspecs, and source compositions like
 *   `'framework/v' + VERSION` never match.
 */

'use strict';

var nodePath = require('path');
var fs = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var ROOT          = nodePath.join(__dirname, '..', '..');
var E2E_DIR       = nodePath.join(ROOT, 'test', 'e2e');
var WORKFLOWS_DIR = nodePath.join(ROOT, '.github', 'workflows');
var EXTRA_FILES   = [nodePath.join(ROOT, 'playwright.config.js')];

// Digit-anchored: matches `framework/v0.4.6-alpha.2/...` but not the
// version-agnostic prose form `framework/v<version>`.
var VERSION_PIN_RE = /framework\/v[0-9]/;

/**
 * Recursively collects every regular file under a directory.
 *
 * @inner
 * @param {string} dir - Absolute directory path to walk.
 * @returns {string[]} Absolute paths of every file found under `dir`.
 */
var collectFiles = function (dir) {
    var out = [];
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
        var full = nodePath.join(dir, entries[i].name);
        if (entries[i].isDirectory()) {
            out = out.concat(collectFiles(full));
        } else if (entries[i].isFile()) {
            out.push(full);
        }
    }
    return out;
};

/**
 * Scans a file for framework-version-pinned path literals.
 *
 * @inner
 * @param {string} file - Absolute path of the file to scan.
 * @returns {string[]} One `<relative-path>:<line>: <text>` entry per match.
 */
var findPins = function (file) {
    var violations = [];
    var lines = fs.readFileSync(file, 'utf8').split('\n');
    for (var i = 0; i < lines.length; i++) {
        if (VERSION_PIN_RE.test(lines[i])) {
            violations.push(
                nodePath.relative(ROOT, file) + ':' + (i + 1) + ': ' + lines[i].trim()
            );
        }
    }
    return violations;
};


describe('01 - e2e surfaces carry no hardcoded framework-version path', function () {

    var e2eFiles = collectFiles(E2E_DIR);

    it('sweeps a non-empty test/e2e tree (the guard is not a silent no-op)', function () {
        // A guard that matches zero files passes forever without inspecting
        // anything (the bundle-freshness `:(glob)` lesson). Pin the known
        // surfaces so a future dir move fails loudly instead of hollowing
        // out the sweep.
        assert.ok(e2eFiles.length > 0, 'expected files under test/e2e — empty sweep means the guard inspects nothing');
        var names = e2eFiles.map(function (f) { return nodePath.basename(f); });
        assert.ok(names.indexOf('popin-dialog.a11y.spec.js') > -1, 'expected popin-dialog.a11y.spec.js in the sweep');
        assert.ok(names.indexOf('runtime-server.js') > -1, 'expected runtime-server.js in the sweep');
        assert.ok(names.indexOf('popin-dialog.html') > -1, 'expected fixtures/popin-dialog.html in the sweep');
    });

    it('no file under test/e2e embeds a framework/v<digit> path literal', function () {
        var violations = [];
        for (var i = 0; i < e2eFiles.length; i++) {
            violations = violations.concat(findPins(e2eFiles[i]));
        }
        assert.deepEqual(
            violations, [],
            'hardcoded framework-version path(s) in e2e surfaces — these break on the per-release '
            + 'framework-dir rename (the 0.4.6 incident class). Resolve the path through '
            + 'test/e2e/runtime-server.js (package.json-derived) instead:\n' + violations.join('\n')
        );
    });

    it('playwright.config.js embeds no framework/v<digit> path literal', function () {
        var violations = [];
        for (var i = 0; i < EXTRA_FILES.length; i++) {
            violations = violations.concat(findPins(EXTRA_FILES[i]));
        }
        assert.deepEqual(
            violations, [],
            'hardcoded framework-version path(s) in playwright config — resolve from package.json '
            + 'instead:\n' + violations.join('\n')
        );
    });

    it('no CI workflow embeds a framework/v<digit> path literal', function () {
        var workflowFiles = collectFiles(WORKFLOWS_DIR);
        // Same no-silent-no-op pin as the e2e sweep.
        assert.ok(workflowFiles.length > 0, 'expected files under .github/workflows — empty sweep means the guard inspects nothing');
        var names = workflowFiles.map(function (f) { return nodePath.basename(f); });
        assert.ok(names.indexOf('e2e.yml') > -1, 'expected e2e.yml in the sweep');
        assert.ok(names.indexOf('test.yml') > -1, 'expected test.yml in the sweep');

        var violations = [];
        for (var i = 0; i < workflowFiles.length; i++) {
            violations = violations.concat(findPins(workflowFiles[i]));
        }
        assert.deepEqual(
            violations, [],
            'hardcoded framework-version path(s) in CI workflows — these break at the per-release '
            + 'framework-dir rename. Derive the dir dynamically (FW_DIR="framework/v${VERSION}" '
            + 'idiom) instead:\n' + violations.join('\n')
        );
    });
});


describe('02 - the pin regex catches the historical regression shape (replica)', function () {

    it('matches the pre-fix 0.4.6 fixture stylesheet href', function () {
        // Verbatim shape of the line that broke the 0.4.6 cut (fixed in ece02d62).
        var offending = '<link rel="stylesheet" href="../../../framework/v0.4.6-alpha.2/core/asset/plugin/dist/vendor/gina/css/gina.min.css">';
        assert.ok(VERSION_PIN_RE.test(offending), 'the guard regex must catch the exact 0.4.6 regression shape');
    });

    it('does not match the version-agnostic prose form', function () {
        assert.ok(
            !VERSION_PIN_RE.test('resolves framework/v<version> from package.json'),
            'prose placeholders must not trip the guard'
        );
    });

    it('does not match the runtime path composition the harness uses', function () {
        assert.ok(
            !VERSION_PIN_RE.test("nodePath.join(ROOT, 'framework', 'v' + VERSION)"),
            'package.json-derived composition must not trip the guard'
        );
    });
});
