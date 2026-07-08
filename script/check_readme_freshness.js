#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/check_readme_freshness.js
 *
 * Pre-publish guard that asserts README.md was touched in the current
 * release cycle for stable publishes. Wired into prepare_version.js as
 * `self.checkReadmeFreshness`, alongside `checkNoLocalLeakage` and
 * `checkPrivateTokenLeakage`. Also runnable standalone:
 *
 *   node script/check_readme_freshness.js
 *
 * The check fires on stable publishes only — alpha cuts are intermediate
 * and the "What's in <stable>" heading is allowed to be drafted ahead.
 * The skip is signalled via the `npm_config_tag` env var or `--tag=alpha`
 * on the argv.
 *
 * Three assertions, evaluated in order:
 *
 *   1. FRESHNESS — `git log <previous-stable-tag>..HEAD -- README.md` must
 *      be non-empty. An empty range means README.md hasn't been touched
 *      since the previous stable cut — typically a forgotten "What's in
 *      <version>" heading, swig version line, or hotfix note.
 *
 *   2. SINGLE SECTION — README.md must carry exactly ONE
 *      `## What's in <version>` heading. The section is REPLACED at each
 *      cut, never prepended; the full history lives in CHANGELOG.md, which
 *      the section itself links to. Asserted unconditionally (it is
 *      version-agnostic and therefore cannot false-positive).
 *
 *   3. VERSION MATCH — that single heading must name the version being
 *      released. Asserted ONLY when the targeted version is a stable
 *      (`X.Y.Z`): at a pre-bump / alpha tree the README legitimately reads
 *      the drafted stable (e.g. `0.5.13`) while package.json still reads
 *      `0.5.13-alpha.2`, so comparing there would be a false positive.
 *
 * Why assertions 2 and 3 exist: assertion 1 asserts that README.md
 * *changed*, never *what it changed into* — it is structurally blind to a
 * WRONG edit. An edit that adds a correct new section while leaving the
 * previous one behind touches README.md, so the freshness gate goes green
 * while shipping the defect. Measured: `v0.5.9` / `v0.5.10` / `v0.5.11`
 * each shipped exactly one section; the 0.5.12 cut prepended instead of
 * replacing (2 sections shipped) and the 0.5.13 cut compounded it (3
 * shipped) — the freshness gate was green on both.
 *
 * Why this gate exists at all: the manual checklist step that asks the
 * operator to grep README.md for the current stable version was silently
 * bypassed on three consecutive stable cuts (v0.3.7 → v0.3.8 → v0.3.9 —
 * each shipped to npm with a stale "What's in 0.3.7" heading and a stale
 * `@rhinostone/swig` version). Manual gates fail; this enforces the rule
 * automatically.
 *
 * Failure mode: fail-closed on every error path. A genuinely untouched
 * README.md, a duplicated section, a mislabelled section, or an unreadable
 * README.md all abort the publish. Git failures (no repo, shallow clone
 * with no tags, etc.) also abort — investigate before publishing rather
 * than silently shipping with unverified state.
 */

'use strict';

var execSync = require('child_process').execSync;
var fs       = require('fs');
var nodePath = require('path');

/**
 * Pick the most recent stable git tag from a `git tag --list "v*"
 * --sort=-creatordate` output. "Stable" means a tag that matches
 * `vX.Y.Z` exactly — no `-alpha.N` / `-beta.N` / `-rc.N` suffix, no
 * `backup/*` or `pre-*` prefix.
 *
 * @param {string} tagListStdout
 * @returns {(string|null)} tag name (e.g. "v0.3.9") or null if none found
 */
function findPreviousStableTag(tagListStdout) {
    var lines = (tagListStdout || '').split('\n');
    var pattern = /^v\d+\.\d+\.\d+$/;
    for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        if (pattern.test(t)) return t;
    }
    return null;
}

/**
 * True when the given `git log` stdout has at least one commit line
 * (i.e. README.md was touched in the range). Whitespace-only output
 * counts as empty.
 *
 * @param {string} gitLogStdout
 * @returns {boolean}
 */
function isReadmeFresh(gitLogStdout) {
    return (gitLogStdout || '').trim().length > 0;
}

/**
 * Collect every `## What's in <version>` heading from README.md content,
 * in document order. Trailing `\r` (CRLF checkouts) and surrounding
 * whitespace are stripped so the returned strings compare cleanly against
 * a composed expectation.
 *
 * @param {string} readmeContent  full README.md content
 * @returns {string[]} matched heading lines, e.g. ["## What's in 0.5.13"]
 * @example
 * extractWhatsInHeadings("## What's in 0.5.13\n\n- x\n");   // ["## What's in 0.5.13"]
 * extractWhatsInHeadings("## What's in 0.5.13\n## What's in 0.5.12\n").length; // 2
 * extractWhatsInHeadings('## Documentation\n');             // []
 * extractWhatsInHeadings(null);                             // []
 */
function extractWhatsInHeadings(readmeContent) {
    var lines = String(readmeContent || '').split('\n');
    var found = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\r$/, '').trim();
        if (/^## What's in /.test(line)) {
            found.push(line);
        }
    }
    return found;
}

/**
 * True when the version string is a plain stable release (`X.Y.Z`) — no
 * `-alpha.N` / `-beta.N` / `-rc.N` suffix. Used to gate the heading
 * version-match assertion: a pre-bump tree legitimately carries the
 * drafted stable heading while package.json still reads the prerelease.
 *
 * @param {string} version
 * @returns {boolean}
 * @example
 * isStableVersion('0.5.13');          // true
 * isStableVersion('0.5.13-alpha.2');  // false
 * isStableVersion(undefined);         // false
 */
function isStableVersion(version) {
    return /^\d+\.\d+\.\d+$/.test(String(version || '').trim());
}

/**
 * Run the full check. Pure function modulo `child_process.execSync` —
 * pass `gitExec` to swap the git driver in tests.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.cwd]             working directory for git calls (default: process.cwd())
 * @param {function} [opts.gitExec]         injected git driver: cmd → stdout string. Throws to signal git failure.
 * @param {string}   [opts.readmeContent]   injected README.md content (default: read `<cwd>/README.md`)
 * @param {string}   [opts.targetedVersion] injected release version (default: `<cwd>/package.json` `version`)
 * @returns {{ok: boolean, reason: string, prevStableTag: (string|null), commitsSinceTag: number, headings: string[], targetedVersion: (string|null), expectedHeading: (string|null)}}
 */
function check(opts) {
    opts = opts || {};
    var cwd = opts.cwd || process.cwd();
    var gitExec = opts.gitExec || function (cmd) {
        return execSync(cmd, { cwd: cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    };

    var tagListStdout;
    try {
        tagListStdout = gitExec('git tag --list "v*" --sort=-creatordate');
    } catch (err) {
        return {
            ok: false,
            reason: 'git-tag-list-failed: ' + (err.message || err),
            prevStableTag: null,
            commitsSinceTag: 0
        };
    }

    var prevStableTag = findPreviousStableTag(tagListStdout);
    if (!prevStableTag) {
        return {
            ok: true,
            reason: 'no-previous-stable-tag',
            prevStableTag: null,
            commitsSinceTag: 0
        };
    }

    var gitLogStdout;
    try {
        gitLogStdout = gitExec('git log ' + prevStableTag + '..HEAD --oneline -- README.md');
    } catch (err) {
        return {
            ok: false,
            reason: 'git-log-failed: ' + (err.message || err),
            prevStableTag: prevStableTag,
            commitsSinceTag: 0
        };
    }

    if (!isReadmeFresh(gitLogStdout)) {
        return {
            ok: false,
            reason: 'readme-untouched-since-' + prevStableTag,
            prevStableTag: prevStableTag,
            commitsSinceTag: 0,
            headings: [],
            targetedVersion: null,
            expectedHeading: null
        };
    }

    var commitsSinceTag = gitLogStdout.trim().split('\n').length;

    // --- assertion 2: exactly ONE `## What's in <version>` section ---
    // Unconditional and version-agnostic, so it can never false-positive.
    var readmeContent = opts.readmeContent;
    if (typeof readmeContent !== 'string') {
        try {
            readmeContent = fs.readFileSync(nodePath.join(cwd, 'README.md'), 'utf8');
        } catch (err) {
            return {
                ok: false,
                reason: 'readme-read-failed: ' + (err.message || err),
                prevStableTag: prevStableTag,
                commitsSinceTag: commitsSinceTag,
                headings: [],
                targetedVersion: null,
                expectedHeading: null
            };
        }
    }

    var headings = extractWhatsInHeadings(readmeContent);

    var targetedVersion = opts.targetedVersion;
    if (typeof targetedVersion === 'undefined') {
        targetedVersion = null;
        try {
            targetedVersion = JSON.parse(
                fs.readFileSync(nodePath.join(cwd, 'package.json'), 'utf8')
            ).version || null;
        } catch (err) { /* tolerated — assertion 3 then self-skips */ }
    }

    if (headings.length !== 1) {
        return {
            ok: false,
            reason: (headings.length === 0)
                ? 'no-whats-in-section'
                : 'multiple-whats-in-sections',
            prevStableTag: prevStableTag,
            commitsSinceTag: commitsSinceTag,
            headings: headings,
            targetedVersion: targetedVersion,
            expectedHeading: null
        };
    }

    // --- assertion 3: that heading names the version being released ---
    // Stable targets only: a pre-bump tree legitimately reads the drafted
    // stable heading while package.json still carries the prerelease.
    if (isStableVersion(targetedVersion)) {
        var expectedHeading = '## What\'s in ' + String(targetedVersion).trim();
        if (headings[0] !== expectedHeading) {
            return {
                ok: false,
                reason: 'whats-in-version-mismatch',
                prevStableTag: prevStableTag,
                commitsSinceTag: commitsSinceTag,
                headings: headings,
                targetedVersion: targetedVersion,
                expectedHeading: expectedHeading
            };
        }
    }

    return {
        ok: true,
        reason: 'readme-fresh',
        prevStableTag: prevStableTag,
        commitsSinceTag: commitsSinceTag,
        headings: headings,
        targetedVersion: targetedVersion,
        expectedHeading: null
    };
}

/**
 * True when this invocation is part of an alpha publish. Inspects the
 * `npm_config_tag` env var that npm sets for lifecycle scripts on
 * `npm publish --tag <name>`, with an argv fallback for direct script
 * invocations.
 *
 * @returns {boolean}
 */
function isAlphaPublish() {
    if (process.env.npm_config_tag === 'alpha') return true;
    var argv = process.argv || [];
    for (var i = 0; i < argv.length; i++) {
        if (argv[i] === '--tag=alpha' || argv[i] === '--alpha') return true;
        if (argv[i] === '--tag' && argv[i + 1] === 'alpha') return true;
    }
    return false;
}

/**
 * CLI entry. Returns 0 on success, 1 on failure.
 *
 * @returns {number} exit code
 */
function main() {
    if (isAlphaPublish()) {
        console.log('[readme] Skipping README freshness gate (alpha publish).');
        return 0;
    }

    var result = check();
    if (result.ok) {
        if (result.reason === 'no-previous-stable-tag') {
            console.log('[readme] OK: no previous stable tag found — first stable publish?');
        } else {
            console.log('[readme] OK: README.md has ' + result.commitsSinceTag +
                ' commit(s) since ' + result.prevStableTag + '.');
        }
        return 0;
    }

    var pack = {};
    try { pack = require('../package.json'); } catch (e) { /* tolerated */ }

    if (result.reason === 'multiple-whats-in-sections') {
        console.error('[readme] ERROR: README.md carries ' + result.headings.length +
            ' "What\'s in" sections — aborting publish.');
        console.error('  Found               :');
        for (var h = 0; h < result.headings.length; h++) {
            console.error('    ' + result.headings[h]);
        }
        console.error('  Targeted version    : ' + (result.targetedVersion || '<unknown>'));
        console.error('');
        console.error('  README.md must carry EXACTLY ONE "## What\'s in <version>" section,');
        console.error('  naming the version being released. REPLACE the prior section — never');
        console.error('  prepend. The full history already lives in CHANGELOG.md, which the');
        console.error('  section links to. Delete the stale section(s), commit, re-run.');
        return 1;
    }

    if (result.reason === 'no-whats-in-section') {
        console.error('[readme] ERROR: README.md has no "## What\'s in <version>" section — aborting publish.');
        console.error('  Targeted version    : ' + (result.targetedVersion || '<unknown>'));
        console.error('');
        console.error('  Add "## What\'s in ' + (result.targetedVersion || '<version>') +
            '" + bullets describing what shipped.');
        return 1;
    }

    if (result.reason === 'whats-in-version-mismatch') {
        console.error('[readme] ERROR: README.md "What\'s in" section names the wrong version — aborting publish.');
        console.error('  Found               : ' + result.headings[0]);
        console.error('  Expected            : ' + result.expectedHeading);
        console.error('');
        console.error('  The single "What\'s in" section must name the version being released.');
        console.error('  Retitle it (and refresh its bullets), commit, re-run.');
        return 1;
    }

    if (result.reason.indexOf('readme-read-failed') === 0) {
        console.error('[readme] ERROR: could not read README.md — aborting publish (fail-closed).');
        console.error('  Failure reason      : ' + result.reason);
        return 1;
    }

    console.error('[readme] ERROR: README.md not touched since previous stable tag — aborting publish.');
    console.error('  Previous stable tag : ' + (result.prevStableTag || '<none>'));
    console.error('  Targeted version    : ' + (pack.version || '<unknown>'));
    console.error('  Failure reason      : ' + result.reason);
    console.error('');
    console.error('  README.md typically needs the following edits before a stable publish:');
    console.error('    - "## What\'s in <version>" heading + bullets describing what shipped');
    console.error('      (exactly ONE such section — replace the prior one, never prepend)');
    console.error('    - "@rhinostone/swig <X>" line in the Features table if swig was bumped');
    console.error('    - Badge versions or other surfaces that drift across releases');
    console.error('');
    console.error('  Touch README.md (even a one-line patch-release note for hotfixes),');
    console.error('  commit on develop, and re-run npm publish.');
    return 1;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = {
    findPreviousStableTag:  findPreviousStableTag,
    isReadmeFresh:          isReadmeFresh,
    extractWhatsInHeadings: extractWhatsInHeadings,
    isStableVersion:        isStableVersion,
    check:                  check,
    isAlphaPublish:         isAlphaPublish,
    main:                   main
};
