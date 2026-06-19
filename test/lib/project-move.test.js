/**
 * lib/cmd/project/move.js — relocates a project's SOURCE TREE to a new path
 * (atomic rename + rewrite the registry `path` field), leaving the project name,
 * its ~/.<project> home, the homedir-derived paths, the PORT MATRIX, and the
 * per-bundle relative manifest paths untouched. The inverse contrast to
 * project:rename (which changes the NAME and therefore rekeys ports).
 *
 * Source-inspection tests (same style as bundle-rename.test.js): the handler
 * runs in the CLI daemon/offline context and mutates the filesystem + ~/.gina
 * registry, so these assertions prove the source structure of:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) single project token + required --path parsing
 *   (c) validation (registered project, has-source, target!=source, target-free)
 *   (d) refuse-if-running guard (readPidfile over every bundle; NO --force bypass)
 *   (e) atomic rename + EXDEV refusal (NO dereferencing copy fallback)
 *   (f) registry path-rewrite (exact `path` + sub-path fields; homedir-derived
 *       fields preserved) + stale-mount removal + reverse-on-failure
 *   (g) the load-bearing NEGATIVE: move NEVER touches ports.json/ports.reverse
 *   (h) help.txt + arguments.json
 *
 * Section 08 is a pure-logic replica of the genuinely new bit — the path-prefix
 * rewrite — including the trailing-slash boundary that stops `/a/app` from
 * matching `/a/application`. Sections 01-07 source-pins lock the operators so the
 * replica cannot silently drift.
 *
 * NOTE on the running guard: the refuse-if-running path cannot be exercised by a
 * live CLI smoke in this environment (gina re-execs into a process whose fs view
 * does not share the test shell's sandbox). readPidfile itself is proven in
 * cmd-status-format / bundle-status tests; here it is locked by source-pins (§04).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var MOVE_SOURCE = path.join(require('../fw'), 'lib/cmd/project/move.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/project/help.txt');
var ARGS_FILE   = path.join(require('../fw'), 'lib/cmd/project/arguments.json');

var src     = fs.readFileSync(MOVE_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Move constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Move;?/);
    });

    it('declares a function Move(opt, cmd)', function () {
        assert.match(src, /function\s+Move\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('wires CmdHelper and gates on isCmdConfigured()', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
        assert.match(src, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — single project token + required --path
// ---------------------------------------------------------------------------

describe('02 - argument parsing', function () {

    it('uses the single project token (self.projectName), not two positionals', function () {
        assert.match(src, /local\.project\s*=\s*self\.projectName;/);
        assert.doesNotMatch(src, /projectArgvList\[1\]/);
    });

    it('reads --to from argv and requires it (NOT --path, which the bootstrap pre-creates)', function () {
        assert.match(src, /process\.argv\.find\(function\(a\)\{\s*return \/\^--to=\/\.test\(a\);\s*\}\)/);
        assert.match(src, /project:move requires a target path/);
    });
});


// ---------------------------------------------------------------------------
// 03 — validation
// ---------------------------------------------------------------------------

describe('03 - validation', function () {

    it('rejects an unregistered project', function () {
        assert.match(src, /typeof\(self\.projects\[local\.project\]\) == 'undefined'/);
        assert.match(src, /is not a registered project/);
    });

    it('reads the current source path and rejects an empty one', function () {
        assert.match(src, /local\.source\s*=\s*self\.projects\[local\.project\]\.path;/);
        assert.match(src, /has no source path to move/);
    });

    it('resolves the target absolutely and rejects the same-location no-op', function () {
        assert.match(src, /local\.target\s*=\s*path\.resolve\(newPath\);/);
        assert.match(src, /local\.target === path\.resolve\(local\.source\)/);
    });

    it('refuses a target path that already exists', function () {
        assert.match(src, /fs\.existsSync\(local\.target\)/);
        assert.match(src, /already exists\. Choose a path that does not exist yet/);
    });
});


// ---------------------------------------------------------------------------
// 04 — refuse-if-running (no --force bypass)
// ---------------------------------------------------------------------------

describe('04 - refuse-if-running', function () {

    it('checks readPidfile for EVERY bundle in the project', function () {
        assert.match(src, /lib\.cmdStatusFormat\.readPidfile\(runDir, bundles\[i\], project\)/);
        assert.match(src, /if \(\s*st && st\.running\s*\)/);
    });

    it('aborts when a bundle is running and tells the user to stop it', function () {
        assert.match(src, /these bundles are running/);
        assert.match(src, /gina project:stop @/);
    });

    it('has NO --force bypass for the running guard', function () {
        var guard = src.slice(src.indexOf('var running = []'), src.indexOf('// ensure the target parent'));
        assert.doesNotMatch(guard, /force/);
    });
});


// ---------------------------------------------------------------------------
// 05 — atomic rename + EXDEV refusal
// ---------------------------------------------------------------------------

describe('05 - move + EXDEV', function () {

    it('moves the tree with the symlink-preserving atomic renameSync', function () {
        assert.match(src, /new _\(local\.source\)\.renameSync\(local\.target\);/);
    });

    it('refuses a cross-filesystem target (EXDEV) and points to project:import', function () {
        assert.match(src, /mvErr\.code === 'EXDEV'/);
        assert.match(src, /on a different filesystem/);
        assert.match(src, /gina project:import @/);
    });

    it('does NOT fall back to a copy (cp/copySync/folder\\.mv) for the move', function () {
        assert.doesNotMatch(src, /\.cp\(|copySync|\.mv\(/);
    });

    it('mkdirs the target parent before renaming', function () {
        assert.match(src, /fs\.mkdirSync\(parent, \{ recursive: true \}\)/);
    });
});


// ---------------------------------------------------------------------------
// 06 — registry rewrite + stale-mount removal + reverse-on-failure
// ---------------------------------------------------------------------------

describe('06 - registry mutation', function () {

    it('rewrites the exact path field and any sub-path field', function () {
        assert.match(src, /entry\[k\] === oldDir/);
        assert.match(src, /entry\[k\]\.indexOf\(oldDir \+ '\/'\) === 0/);
        assert.match(src, /entry\[k\] = local\.target \+ entry\[k\]\.slice\(oldDir\.length\)/);
    });

    it('removes stale mount symlinks (recreated on next start)', function () {
        assert.match(src, /getCoreEnv\(bundles\[b\]\)/);
        assert.match(src, /\.rmSync\(\)/);
    });

    it('writes projects.json via the atomic generator', function () {
        assert.match(src, /lib\.generator\.createFileFromDataSync\(self\.projects, _\(GINA_HOMEDIR \+ '\/projects\.json'\)\)/);
    });

    it('reverses the move when the registry update fails', function () {
        assert.match(src, /new _\(local\.target\)\.renameSync\(local\.source\)/);
        assert.match(src, /reverted the move/);
    });
});


// ---------------------------------------------------------------------------
// 07 — the load-bearing NEGATIVE: move never touches ports
// ---------------------------------------------------------------------------

describe('07 - ports untouched (vs project:rename)', function () {

    it('never accesses the ports registry surfaces in code (self.ports*)', function () {
        // access-prefixed: the JSDoc's `ports.json` / `ports.reverse.json`
        // contrast-with-rename mention must NOT trip this (jsdoc.md negative-pin trap)
        assert.doesNotMatch(src, /self\.ports/);
    });
});


// ---------------------------------------------------------------------------
// 08 — help.txt + arguments.json
// ---------------------------------------------------------------------------

describe('08 - help + arguments', function () {

    it('documents [ Move project ] in help.txt', function () {
        assert.match(helpTxt, /\[ Move project \]/);
        assert.match(helpTxt, /gina project:move @<project_name> --to=/);
    });

    it('arguments.json whitelists --to', function () {
        assert.ok(argsArr.indexOf('--to') !== -1, '--to must be whitelisted for project:move');
    });
});


// ---------------------------------------------------------------------------
// 09 — pure-logic replica of the path-prefix rewrite
// ---------------------------------------------------------------------------

describe('09 - path-rewrite replica', function () {

    // mirror of move.js run(): rewrite the exact path + any field rooted UNDER it
    function rewritePaths(entry, oldDir, target) {
        var out = JSON.parse(JSON.stringify(entry));
        for (var k in out) {
            if (typeof out[k] === 'string') {
                if (out[k] === oldDir) {
                    out[k] = target;
                } else if (out[k].indexOf(oldDir + '/') === 0) {
                    out[k] = target + out[k].slice(oldDir.length);
                }
            }
        }
        return out;
    }

    it('rewrites only the source-rooted path, preserving homedir-derived fields', function () {
        var entry = {
            path         : '/old/app',
            homedir      : '/home/me/.proj',
            bundles_path : '/home/me/.proj/bundles',
            releases_path: '/home/me/.proj/releases',
            def_prefix   : '/usr/local',
            framework    : 'v0.5.5-alpha.2'
        };
        var out = rewritePaths(entry, '/old/app', '/new/app');
        assert.equal(out.path, '/new/app');
        assert.equal(out.homedir, '/home/me/.proj');          // name-keyed, untouched
        assert.equal(out.bundles_path, '/home/me/.proj/bundles');
        assert.equal(out.releases_path, '/home/me/.proj/releases');
        assert.equal(out.def_prefix, '/usr/local');           // gina install, untouched
        assert.equal(out.framework, 'v0.5.5-alpha.2');        // non-path string, untouched
    });

    it('rewrites a field nested under the source path', function () {
        var out = rewritePaths({ path: '/old/app', custom: '/old/app/sub/x' }, '/old/app', '/new/app');
        assert.equal(out.path, '/new/app');
        assert.equal(out.custom, '/new/app/sub/x');
    });

    it('does NOT false-match a sibling sharing the path prefix (trailing-slash boundary)', function () {
        var out = rewritePaths({ path: '/old/app', other: '/old/application' }, '/old/app', '/new/app');
        assert.equal(out.path, '/new/app');
        assert.equal(out.other, '/old/application');          // /old/app/ boundary stops the match
    });
});
