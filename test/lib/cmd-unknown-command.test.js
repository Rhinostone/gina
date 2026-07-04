/**
 * lib/cmd/framework/init.js run() — graceful "unknown command" handling.
 *
 * `gina <group>:<action>` where <group> is valid (listed in bin/cli's
 * allowedOffline) but <action> has no handler file used to crash with a raw
 * Node `Cannot find module .../cmd/framework/connector.js` + full stack via
 * console.crit. This hit `gina framework:connector`, `gina connector` and
 * `gina connector --help` (both auto-prefixed by bin/cli to the same
 * `framework:connector`), and `gina -V` (→ `framework:-V`).
 *
 * run() now fs.existsSync-guards the handler path before require() and prints a
 * clean, actionable message (with a did-you-mean when the unknown action is
 * itself a real command group), exit 1. A genuine error thrown from inside a
 * REAL handler still falls through to the original try/catch (console.crit +
 * stack), so debuggability of actual crashes is preserved.
 *
 * framework/init.js reads CLI globals at module top, so it is not require-safe;
 * covered by source-inspection pins (same style as cmd-help / cmd-man), plus
 * the behavioural fact that the did-you-mean target help.txt exists.
 *
 * Pinned:
 *   (a) run() fs.existsSync-guards the handler path before require(path)
 *   (b) the unknown-command branch exits 1 and returns
 *   (c) prints "'<group>:<action>' is not a valid command." + points to `gina help`
 *   (d) writes the same message to opt.client when present (socket dispatch)
 *   (e) did-you-mean is gated on the group-name pattern AND <action>/help.txt
 *   (f) the genuine-handler-error try/catch (console.crit + err.stack) is preserved
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW      = require('../fw');
var INIT_JS = path.join(FW, 'lib/cmd/framework/init.js');
var SRC     = fs.readFileSync(INIT_JS, 'utf8');

// the run() unknown-command branch, sliced for the local pins below
var guardIdx = SRC.indexOf('if ( !fs.existsSync(path) )');
var BLOCK    = guardIdx > -1 ? SRC.substring(guardIdx, guardIdx + 1400) : '';

describe('01 - run() guards an unknown command file before require()', function () {

    it('checks fs.existsSync(path) before the require(path) call', function () {
        var requireIdx = SRC.indexOf('require(path)(opt, cmd)');
        assert.ok(guardIdx > -1, 'run() must fs.existsSync-guard the handler path');
        assert.ok(requireIdx > -1, 'run() still requires the handler on the happy path');
        assert.ok(guardIdx < requireIdx, 'the existsSync guard must precede require(path)');
    });

    it('exits 1 and returns on the unknown-command branch', function () {
        assert.match(BLOCK, /process\.exit\(1\)/);
        assert.match(BLOCK, /return;/);
    });
});

describe('02 - clean message, not a raw module-resolution stack', function () {

    it('prints "\'<group>:<action>\' is not a valid command."', function () {
        assert.match(BLOCK, /is not a valid command\./);
    });

    it('points the user to `gina help` and the group help', function () {
        assert.match(BLOCK, /Run 'gina help' for all commands/);
        assert.match(BLOCK, /gina help "\s*\+\s*opt\.task\.topic/);
    });

    it('writes the same message to opt.client when present (socket dispatch)', function () {
        assert.match(BLOCK, /opt\.client\.write\(/);
    });
});

describe('03 - did-you-mean fires only for a real command group', function () {

    it('gates the suggestion on the group-name pattern AND <action>/help.txt', function () {
        assert.match(BLOCK, /\/\^\[a-z\]\[a-z0-9-\]\*\$\/\.test\(opt\.task\.action\)/);
        assert.match(BLOCK, /fs\.existsSync\(groupHelp\)/);
        assert.match(BLOCK, /is a command group\. Try:  gina help/);
    });

    it('the did-you-mean target exists for a known group (connector)', function () {
        assert.ok(fs.existsSync(path.join(FW, 'lib/cmd/connector/help.txt')),
            'connector/help.txt must exist — it is what the did-you-mean points at');
    });
});

describe('04 - the genuine-handler-error path is preserved', function () {

    it('keeps the try/catch console.crit + err.stack for real handler errors', function () {
        assert.match(SRC, /Gina has some troubles with this command/);
        assert.match(SRC, /console\.crit\(/);
        assert.match(SRC, /err\.stack/);
    });
});
