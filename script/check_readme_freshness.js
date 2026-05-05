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
 * Single assertion: `git log <previous-stable-tag>..HEAD -- README.md`
 * must be non-empty. An empty range means README.md hasn't been touched
 * since the previous stable cut — typically a forgotten "What's in
 * <version>" heading, swig version line, or hotfix note. Failure prints
 * the previous tag, the targeted version, and a hint at the typical
 * edits.
 *
 * Why this gate exists: the manual checklist step that asks the operator
 * to grep README.md for the current stable version was silently bypassed
 * on three consecutive stable cuts (v0.3.7 → v0.3.8 → v0.3.9 — each
 * shipped to npm with a stale "What's in 0.3.7" heading and a stale
 * `@rhinostone/swig` version). Manual gates fail; this enforces the rule
 * automatically.
 *
 * Failure mode: fail-closed on every error path. A genuinely untouched
 * README.md aborts the publish. Git failures (no repo, shallow clone
 * with no tags, etc.) also abort — investigate before publishing rather
 * than silently shipping with unverified state.
 */

'use strict';

var execSync = require('child_process').execSync;

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
 * Run the full check. Pure function modulo `child_process.execSync` —
 * pass `gitExec` to swap the git driver in tests.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.cwd]      working directory for git calls (default: process.cwd())
 * @param {function} [opts.gitExec]  injected git driver: cmd → stdout string. Throws to signal git failure.
 * @returns {{ok: boolean, reason: string, prevStableTag: (string|null), commitsSinceTag: number}}
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
            commitsSinceTag: 0
        };
    }

    return {
        ok: true,
        reason: 'readme-fresh',
        prevStableTag: prevStableTag,
        commitsSinceTag: gitLogStdout.trim().split('\n').length
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

    console.error('[readme] ERROR: README.md not touched since previous stable tag — aborting publish.');
    console.error('  Previous stable tag : ' + (result.prevStableTag || '<none>'));
    console.error('  Targeted version    : ' + (pack.version || '<unknown>'));
    console.error('  Failure reason      : ' + result.reason);
    console.error('');
    console.error('  README.md typically needs the following edits before a stable publish:');
    console.error('    - "## What\'s in <version>" heading + bullets describing what shipped');
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
    findPreviousStableTag: findPreviousStableTag,
    isReadmeFresh:         isReadmeFresh,
    check:                 check,
    isAlphaPublish:        isAlphaPublish,
    main:                  main
};
