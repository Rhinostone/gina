/**
 * lib/cmd/bundle/add.js — non-interactive (no-TTY) guard on the
 * "bundle already exists" prompt.
 *
 * add.js creates a module-scope readline interface on process.stdin at
 * require-time and prompts the user (Replace / Cancel / Import) when the
 * bundle already exists and neither --import nor --replace was passed.
 * In a non-interactive context (container entrypoint, CI, piped/detached
 * stdin) readline closes on stdin EOF before the async port-scan callback
 * reaches the prompt, so rl.prompt() throws ERR_USE_AFTER_CLOSE — caught
 * upstream and surfaced as an opaque "could not complete bundle creation:
 * readline was closed" rollback.
 *
 * The fix adds a guard in check(): when stdin is not a TTY (or rl is
 * already closed), fail fast with actionable guidance pointing at
 * --import / --replace instead of falling into the doomed prompt.
 *
 * Running the Add handler needs the full CLI daemon context (CmdHelper,
 * project registry, gna.js globals), which is heavy for near-zero extra
 * coverage — so these are source-structure pins plus a pure-logic replica
 * of the guard predicate.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var ADD_SOURCE = path.join(require('../fw'), 'lib/cmd/bundle/add.js');
var src        = fs.readFileSync(ADD_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Guard source structure
// ---------------------------------------------------------------------------

describe('01 - non-interactive guard source structure', function () {

    it('guards the prompt on !process.stdin.isTTY', function () {
        assert.match(src, /!\s*process\.stdin\.isTTY/);
    });

    it('also treats an already-closed readline as non-interactive', function () {
        assert.match(src, /\|\|\s*rl\.closed/);
    });

    it('exits non-zero when the prompt cannot be read', function () {
        assert.match(src, /return\s+process\.exit\(1\)/);
    });

    it('points the user at --import and --replace in the message', function () {
        var guardIdx  = src.indexOf('process.stdin.isTTY');
        var msgWindow = src.slice(guardIdx, guardIdx + 700);
        assert.match(msgWindow, /--import/);
        assert.match(msgWindow, /--replace/);
    });

    it('places the guard BEFORE the rl.setPrompt() / rl.prompt() call', function () {
        var guardIdx     = src.indexOf('process.stdin.isTTY');
        var setPromptIdx = src.indexOf('rl.setPrompt(');
        assert.ok(guardIdx > -1 && setPromptIdx > -1, 'both markers present');
        assert.ok(guardIdx < setPromptIdx, 'guard precedes the interactive prompt');
    });

    it('places the guard AFTER the --import/--replace flag short-circuit', function () {
        var flagIdx  = src.indexOf('opt.argv.join');
        var guardIdx = src.indexOf('process.stdin.isTTY');
        assert.ok(flagIdx > -1, 'flag short-circuit present');
        assert.ok(guardIdx > flagIdx, 'guard runs only when no --import/--replace flag matched');
    });
});


// ---------------------------------------------------------------------------
// 02 — Guard predicate (pure-logic replica)
// ---------------------------------------------------------------------------

describe('02 - guard predicate replica', function () {

    // Mirrors: if ( !process.stdin.isTTY || rl.closed ) { fail-fast }
    function failsNonInteractive(stdinIsTTY, rlClosed) {
        return ( !stdinIsTTY || rlClosed );
    }

    it('fails when stdin is not a TTY (container / CI / pipe)', function () {
        // a non-TTY stdin reports isTTY === undefined
        assert.equal(failsNonInteractive(undefined, false), true);
        assert.equal(failsNonInteractive(false, false), true);
    });

    it('fails when the readline is already closed even if isTTY is truthy', function () {
        assert.equal(failsNonInteractive(true, true), true);
    });

    it('proceeds to the interactive prompt on a live TTY', function () {
        assert.equal(failsNonInteractive(true, false), false);
    });
});
