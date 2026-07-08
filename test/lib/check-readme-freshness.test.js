/**
 * script/check_readme_freshness.js — behavioural tests.
 *
 * Covers the pure helpers (findPreviousStableTag, isReadmeFresh,
 * isAlphaPublish) and the orchestrating `check()` function with an
 * injected git driver so no real repo is needed.
 *
 * Negative-invariant pattern: `check()` must return `ok: false` when
 * README.md is untouched between the previous stable tag and HEAD,
 * even if every other path succeeds.
 */

'use strict';

var nodePath = require('path');
var { describe, it, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');

var SCRIPT = nodePath.join(__dirname, '..', '..', 'script', 'check_readme_freshness.js');
var CHECK  = require(SCRIPT);


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports findPreviousStableTag', function () {
        assert.equal(typeof CHECK.findPreviousStableTag, 'function');
    });

    it('exports isReadmeFresh', function () {
        assert.equal(typeof CHECK.isReadmeFresh, 'function');
    });

    it('exports isAlphaPublish', function () {
        assert.equal(typeof CHECK.isAlphaPublish, 'function');
    });

    it('exports check', function () {
        assert.equal(typeof CHECK.check, 'function');
    });

    it('exports main', function () {
        assert.equal(typeof CHECK.main, 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — findPreviousStableTag: picks the most recent vX.Y.Z
// ---------------------------------------------------------------------------

describe('02 - findPreviousStableTag', function () {

    it('returns null on empty input', function () {
        assert.equal(CHECK.findPreviousStableTag(''), null);
    });

    it('returns null on null input', function () {
        assert.equal(CHECK.findPreviousStableTag(null), null);
    });

    it('returns the only stable tag', function () {
        assert.equal(CHECK.findPreviousStableTag('v0.3.9\n'), 'v0.3.9');
    });

    it('returns the first stable tag (input is creation-date sorted)', function () {
        var input = [
            'v0.3.9',
            'v0.3.8',
            'v0.3.7'
        ].join('\n');
        assert.equal(CHECK.findPreviousStableTag(input), 'v0.3.9');
    });

    it('skips alpha-suffixed tags', function () {
        var input = [
            'v0.3.10-alpha.2',
            'v0.3.10-alpha.1',
            'v0.3.9'
        ].join('\n');
        assert.equal(CHECK.findPreviousStableTag(input), 'v0.3.9');
    });

    it('skips beta-suffixed tags', function () {
        var input = [
            'v1.0.0-beta.3',
            'v0.3.9'
        ].join('\n');
        assert.equal(CHECK.findPreviousStableTag(input), 'v0.3.9');
    });

    it('skips rc-suffixed tags', function () {
        var input = [
            'v1.0.0-rc.1',
            'v0.3.9'
        ].join('\n');
        assert.equal(CHECK.findPreviousStableTag(input), 'v0.3.9');
    });

    it('returns null when only non-stable tags exist', function () {
        var input = [
            'v0.3.10-alpha.2',
            'v0.3.10-alpha.1'
        ].join('\n');
        assert.equal(CHECK.findPreviousStableTag(input), null);
    });

    it('skips tags that are not v-prefixed semver', function () {
        var input = [
            'backup/dev-wip-20260425',
            'pre-history-scrub-develop',
            'release-2026-04-15',
            'v0.3.9'
        ].join('\n');
        assert.equal(CHECK.findPreviousStableTag(input), 'v0.3.9');
    });

    it('trims whitespace per line', function () {
        var input = '  v0.3.9  \n';
        assert.equal(CHECK.findPreviousStableTag(input), 'v0.3.9');
    });
});


// ---------------------------------------------------------------------------
// 03 - isReadmeFresh: non-empty git log stdout
// ---------------------------------------------------------------------------

describe('03 - isReadmeFresh', function () {

    it('returns false on empty input', function () {
        assert.equal(CHECK.isReadmeFresh(''), false);
    });

    it('returns false on null input', function () {
        assert.equal(CHECK.isReadmeFresh(null), false);
    });

    it('returns false on whitespace-only input', function () {
        assert.equal(CHECK.isReadmeFresh('   \n\n  \t\n'), false);
    });

    it('returns true for a single commit line', function () {
        assert.equal(CHECK.isReadmeFresh('abc1234 Updated README highlights\n'), true);
    });

    it('returns true for multiple commit lines', function () {
        var input = [
            'abc1234 Updated README highlights',
            'def5678 Bumping swig version reference'
        ].join('\n');
        assert.equal(CHECK.isReadmeFresh(input), true);
    });
});


// ---------------------------------------------------------------------------
// 04 — isAlphaPublish: env var + argv signal
// ---------------------------------------------------------------------------

describe('04 - isAlphaPublish', function () {

    var savedEnv;
    var savedArgv;

    beforeEach(function () {
        savedEnv  = process.env.npm_config_tag;
        savedArgv = process.argv;
    });

    afterEach(function () {
        if (typeof savedEnv === 'undefined') {
            delete process.env.npm_config_tag;
        } else {
            process.env.npm_config_tag = savedEnv;
        }
        process.argv = savedArgv;
    });

    it('returns true when npm_config_tag === "alpha"', function () {
        process.env.npm_config_tag = 'alpha';
        process.argv = ['node', 'script.js'];
        assert.equal(CHECK.isAlphaPublish(), true);
    });

    it('returns false when npm_config_tag === "latest"', function () {
        process.env.npm_config_tag = 'latest';
        process.argv = ['node', 'script.js'];
        assert.equal(CHECK.isAlphaPublish(), false);
    });

    it('returns false when npm_config_tag is undefined and no argv signal', function () {
        delete process.env.npm_config_tag;
        process.argv = ['node', 'script.js'];
        assert.equal(CHECK.isAlphaPublish(), false);
    });

    it('returns true on argv "--tag=alpha"', function () {
        delete process.env.npm_config_tag;
        process.argv = ['node', 'script.js', '--tag=alpha'];
        assert.equal(CHECK.isAlphaPublish(), true);
    });

    it('returns true on argv "--tag alpha"', function () {
        delete process.env.npm_config_tag;
        process.argv = ['node', 'script.js', '--tag', 'alpha'];
        assert.equal(CHECK.isAlphaPublish(), true);
    });

    it('returns true on argv "--alpha"', function () {
        delete process.env.npm_config_tag;
        process.argv = ['node', 'script.js', '--alpha'];
        assert.equal(CHECK.isAlphaPublish(), true);
    });
});


// ---------------------------------------------------------------------------
// 05 — check(): orchestration with injected git driver
// ---------------------------------------------------------------------------

describe('05 - check', function () {

    /**
     * Build a fake gitExec function from a recipe.
     * recipe = { tags: string|Error, logs: { '<tagOrRange>': string|Error } }
     */
    function fakeExec(recipe) {
        return function (cmd) {
            if (/^git tag/.test(cmd)) {
                if (recipe.tags instanceof Error) throw recipe.tags;
                return recipe.tags;
            }
            if (/^git log/.test(cmd)) {
                // Match against any registered range
                var keys = Object.keys(recipe.logs || {});
                for (var i = 0; i < keys.length; i++) {
                    if (cmd.indexOf(keys[i]) >= 0) {
                        var v = recipe.logs[keys[i]];
                        if (v instanceof Error) throw v;
                        return v;
                    }
                }
                return ''; // default: no commits in range
            }
            throw new Error('unexpected git command: ' + cmd);
        };
    }

    it('passes when README.md was touched since the previous stable tag', function () {
        var result = CHECK.check({
            gitExec: fakeExec({
                tags: 'v0.3.9\nv0.3.8\nv0.3.7\n',
                logs: {
                    'v0.3.9..HEAD': 'abc1234 Updating README What\'s in 0.3.10\n'
                }
            })
        });
        assert.equal(result.ok, true);
        assert.equal(result.prevStableTag, 'v0.3.9');
        assert.equal(result.commitsSinceTag, 1);
        assert.equal(result.reason, 'readme-fresh');
    });

    it('fails when README.md is untouched since the previous stable tag', function () {
        var result = CHECK.check({
            gitExec: fakeExec({
                tags: 'v0.3.9\n',
                logs: {
                    'v0.3.9..HEAD': ''
                }
            })
        });
        assert.equal(result.ok, false);
        assert.equal(result.prevStableTag, 'v0.3.9');
        assert.equal(result.reason, 'readme-untouched-since-v0.3.9');
    });

    it('passes (no-op) when no previous stable tag exists (first publish)', function () {
        var result = CHECK.check({
            gitExec: fakeExec({
                tags: 'v0.3.10-alpha.1\nv0.3.10-alpha.2\n',
                logs: {}
            })
        });
        assert.equal(result.ok, true);
        assert.equal(result.prevStableTag, null);
        assert.equal(result.reason, 'no-previous-stable-tag');
    });

    it('fails closed when git tag listing fails', function () {
        var result = CHECK.check({
            gitExec: fakeExec({
                tags: new Error('not a git repository'),
                logs: {}
            })
        });
        assert.equal(result.ok, false);
        assert.match(result.reason, /^git-tag-list-failed/);
    });

    it('fails closed when git log fails', function () {
        var result = CHECK.check({
            gitExec: fakeExec({
                tags: 'v0.3.9\n',
                logs: {
                    'v0.3.9..HEAD': new Error('bad revision range')
                }
            })
        });
        assert.equal(result.ok, false);
        assert.equal(result.prevStableTag, 'v0.3.9');
        assert.match(result.reason, /^git-log-failed/);
    });

    it('counts multiple commits since the previous stable tag', function () {
        var result = CHECK.check({
            gitExec: fakeExec({
                tags: 'v0.3.9\n',
                logs: {
                    'v0.3.9..HEAD': [
                        'abc1234 Updating README highlights for 0.3.10',
                        'def5678 Bumping swig version reference',
                        'fed4321 Refreshing badge versions'
                    ].join('\n')
                }
            })
        });
        assert.equal(result.ok, true);
        assert.equal(result.commitsSinceTag, 3);
    });

    it('treats whitespace-only git log as untouched', function () {
        var result = CHECK.check({
            gitExec: fakeExec({
                tags: 'v0.3.9\n',
                logs: {
                    'v0.3.9..HEAD': '   \n\n   \n'
                }
            })
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'readme-untouched-since-v0.3.9');
    });
});


// ---------------------------------------------------------------------------
// 06 — extractWhatsInHeadings (pure)
// ---------------------------------------------------------------------------

describe('06 - extractWhatsInHeadings', function () {

    it('returns [] for empty / null content', function () {
        assert.deepEqual(CHECK.extractWhatsInHeadings(''), []);
        assert.deepEqual(CHECK.extractWhatsInHeadings(null), []);
    });

    it('returns the single heading of a well-formed README', function () {
        assert.deepEqual(
            CHECK.extractWhatsInHeadings("# Gina\n\n## What's in 0.5.13\n\n- x\n\n## Documentation\n"),
            ["## What's in 0.5.13"]
        );
    });

    it('returns every heading, in document order, when several are present', function () {
        assert.deepEqual(
            CHECK.extractWhatsInHeadings("## What's in 0.5.13\n- a\n## What's in 0.5.12\n- b\n"),
            ["## What's in 0.5.13", "## What's in 0.5.12"]
        );
    });

    it('ignores unrelated h2 headings', function () {
        assert.deepEqual(CHECK.extractWhatsInHeadings('## Documentation\n## Features\n'), []);
    });

    it('does not match a deeper heading level', function () {
        assert.deepEqual(CHECK.extractWhatsInHeadings("### What's in 0.5.13\n"), []);
    });

    it('tolerates CRLF line endings', function () {
        assert.deepEqual(
            CHECK.extractWhatsInHeadings("## What's in 0.5.13\r\n- x\r\n"),
            ["## What's in 0.5.13"]
        );
    });
});


// ---------------------------------------------------------------------------
// 07 — isStableVersion (pure)
// ---------------------------------------------------------------------------

describe('07 - isStableVersion', function () {

    it('accepts a plain X.Y.Z', function () {
        assert.equal(CHECK.isStableVersion('0.5.13'), true);
        assert.equal(CHECK.isStableVersion('10.20.30'), true);
    });

    it('rejects prereleases — the pre-bump false-positive guard', function () {
        assert.equal(CHECK.isStableVersion('0.5.13-alpha.2'), false);
        assert.equal(CHECK.isStableVersion('0.5.13-beta.1'), false);
        assert.equal(CHECK.isStableVersion('0.5.13-rc.1'), false);
    });

    it('rejects empty / null / garbage', function () {
        assert.equal(CHECK.isStableVersion(''), false);
        assert.equal(CHECK.isStableVersion(null), false);
        assert.equal(CHECK.isStableVersion(undefined), false);
        assert.equal(CHECK.isStableVersion('v0.5.13'), false);
    });
});


// ---------------------------------------------------------------------------
// 08 — check(): single-section + version-match assertions
// ---------------------------------------------------------------------------

describe('08 - check single-section and version-match assertions', function () {

    // A git driver where README is always "fresh" (touched since the tag),
    // so only the README-content assertions can decide the outcome.
    function freshGit() {
        return function (cmd) {
            if (/^git tag/.test(cmd)) return 'v0.5.11\nv0.5.10\n';
            return 'abc1234 Updating README\n';
        };
    }

    function run(readmeContent, targetedVersion) {
        return CHECK.check({
            gitExec: freshGit(),
            readmeContent: readmeContent,
            targetedVersion: targetedVersion
        });
    }

    var ONE = "# Gina\n\n## What's in 0.5.13\n\n- Added — x.\n\nSee the full Changelog.\n";
    var TWO = "# Gina\n\n## What's in 0.5.13\n\n- a\n\n## What's in 0.5.12\n\n- b\n";
    var THREE = TWO + "\n## What's in 0.5.11\n\n- c\n";

    it('passes a single correctly-named section on a stable target', function () {
        var r = run(ONE, '0.5.13');
        assert.equal(r.ok, true);
        assert.equal(r.reason, 'readme-fresh');
        assert.deepEqual(r.headings, ["## What's in 0.5.13"]);
    });

    it('ABORTS on two sections — the shape that shipped in v0.5.12', function () {
        var r = run(TWO, '0.5.12');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'multiple-whats-in-sections');
        assert.equal(r.headings.length, 2);
    });

    it('ABORTS on three sections — the shape that shipped in v0.5.13', function () {
        var r = run(THREE, '0.5.13');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'multiple-whats-in-sections');
        assert.equal(r.headings.length, 3);
    });

    it('ABORTS when no section exists at all', function () {
        var r = run('# Gina\n\n## Documentation\n', '0.5.13');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no-whats-in-section');
    });

    it('ABORTS when the single section names the wrong version', function () {
        var r = run(ONE, '0.5.14');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'whats-in-version-mismatch');
        assert.equal(r.expectedHeading, "## What's in 0.5.14");
        assert.deepEqual(r.headings, ["## What's in 0.5.13"]);
    });

    it('SKIPS the version-match on a prerelease target (pre-bump tree, no false positive)', function () {
        var r = run(ONE, '0.5.14-alpha.2');
        assert.equal(r.ok, true, 'a pre-bump tree drafts the stable heading ahead of the bump');
        assert.equal(r.reason, 'readme-fresh');
    });

    it('still enforces the single-section rule on a prerelease target', function () {
        var r = run(TWO, '0.5.14-alpha.2');
        assert.equal(r.ok, false, 'assertion 2 is version-agnostic');
        assert.equal(r.reason, 'multiple-whats-in-sections');
    });

    it('SKIPS the version-match when the targeted version is unresolvable', function () {
        var r = run(ONE, null);
        assert.equal(r.ok, true);
    });

    it('freshness still short-circuits before the content assertions', function () {
        var r = CHECK.check({
            gitExec: function (cmd) {
                if (/^git tag/.test(cmd)) return 'v0.5.11\n';
                return '';                       // untouched
            },
            readmeContent: THREE,                // would also fail assertion 2
            targetedVersion: '0.5.13'
        });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'readme-untouched-since-v0.5.11',
            'assertion 1 is evaluated first and reports its own reason');
    });

    it('fails closed when README.md cannot be read', function () {
        var r = CHECK.check({
            cwd: nodePath.join(__dirname, '__does_not_exist__'),
            gitExec: freshGit(),
            targetedVersion: '0.5.13'
        });
        assert.equal(r.ok, false);
        assert.match(r.reason, /^readme-read-failed/);
    });
});
