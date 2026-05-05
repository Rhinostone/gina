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
