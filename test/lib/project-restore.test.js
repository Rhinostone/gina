/**
 * lib/cmd/project/restore.js — rebuilds a project from a project:backup `.zip`.
 * The inverse of project:backup: extracts the archived source tree to --to (via
 * lib/archiver decompress(), JSZip 3.x), then RE-REGISTERS the project so it is
 * immediately startable — a backup zip carries only source (no node_modules, no
 * registry, no ports), so registration is delegated to the existing commands
 * (project:add for the entry + gina symlink, bundle:add --import per bundle for
 * the ports) rather than duplicating them.
 *
 * Source-inspection tests (same style as project-backup.test.js / project-move.test.js):
 *   (01) module shape + CmdHelper wiring
 *   (02) @<name> + archive(argv) + --to parsing (--to NOT --path; --force)
 *   (03) archive validation (exists / is-file / .zip)
 *   (04) conflict guards (already-registered + non-empty target refuse unless --force)
 *   (05) decompress invocation + post-extract project verification
 *   (06) registration via self-invoked project:add + per-bundle bundle:add --import
 *   (07) the load-bearing NEGATIVES: no --path/projectLocation hijack surface, no
 *        direct registry write, no project:rm/--force on a keep-path (footgun)
 *   (08) help.txt + arguments.json
 *   (09) pure-logic replica of the archive-arg finder
 *   (10) the shared-bootstrap exemption (helper.js lets an unregistered @<name>
 *        through for project:restore, like add/import/remove)
 *
 * NOTE: the end-to-end behaviour (backup -> restore -> boot -> HTTP) is proven by a
 * separate live smoke; these structural tests prove SHAPE (the project:move lesson:
 * 26 green structural tests on a functionally broken command — only the smoke caught it).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var RESTORE_SOURCE = path.join(require('../fw'), 'lib/cmd/project/restore.js');
var HELP_TXT       = path.join(require('../fw'), 'lib/cmd/project/help.txt');
var ARGS_FILE      = path.join(require('../fw'), 'lib/cmd/project/arguments.json');
var HELPER_SOURCE  = path.join(require('../fw'), 'lib/cmd/helper.js');

var src       = fs.readFileSync(RESTORE_SOURCE, 'utf8');
var helpTxt   = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr   = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var helperSrc = fs.readFileSync(HELPER_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Restore constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Restore;?/);
    });

    it('declares a function Restore(opt, cmd)', function () {
        assert.match(src, /function\s+Restore\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('wires CmdHelper and gates on isCmdConfigured()', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
        assert.match(src, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — @<name> + archive(argv) + --to (NOT --path)
// ---------------------------------------------------------------------------

describe('02 - argument parsing', function () {

    it('takes the project NAME from the @<name> token (self.projectName)', function () {
        assert.match(src, /local\.project\s*=\s*self\.projectName;/);
    });

    it('reads the archive positional off argv (skipping @ and -- tokens)', function () {
        assert.match(src, /process\.argv\.slice\(3\)\.find\(/);
        assert.match(src, /!\/\^@\/\.test\(a\)/);
        assert.match(src, /!\/\^--\/\.test\(a\)/);
    });

    it('reads --to and requires it (NOT --path, which the bootstrap pre-creates/hijacks)', function () {
        assert.match(src, /\/\^--to=\//);
        assert.match(src, /requires a target path/);
        assert.doesNotMatch(src, /cmd\.params\.path/);
        assert.doesNotMatch(src, /self\.projectLocation/);
    });

    it('reads --force', function () {
        assert.match(src, /\/\^--force\(=\|\$\)\//);
    });
});


// ---------------------------------------------------------------------------
// 03 — archive validation
// ---------------------------------------------------------------------------

describe('03 - archive validation', function () {

    it('requires the archive to exist and be a file', function () {
        assert.match(src, /fs\.existsSync\(local\.archive\)/);
        assert.match(src, /fs\.statSync\(local\.archive\)\.isFile\(\)/);
        assert.match(src, /does not exist or is not a file/);
    });

    it('requires a .zip archive (project:backup produces .zip)', function () {
        assert.match(src, /\/\\\.zip\$\/i\.test\(local\.archive\)/);
    });
});


// ---------------------------------------------------------------------------
// 04 — conflict guards (refuse unless --force)
// ---------------------------------------------------------------------------

describe('04 - conflict guards', function () {

    it('refuses an already-registered name unless --force', function () {
        assert.match(src, /typeof\(self\.projects\[local\.project\]\) != 'undefined' && !local\.force/);
        assert.match(src, /already registered/);
    });

    it('refuses a non-empty target unless --force', function () {
        assert.match(src, /fs\.readdirSync\(local\.target\)/);
        assert.match(src, /is not empty/);
    });
});


// ---------------------------------------------------------------------------
// 05 — decompress + post-extract verification
// ---------------------------------------------------------------------------

describe('05 - extraction', function () {

    it('extracts via lib.archiver.decompress(...).onComplete', function () {
        assert.match(src, /lib\.archiver\.decompress\(local\.archive, local\.target \+ '\/'\)\.onComplete\(/);
    });

    it('verifies the archive held a gina project (manifest.json + package.json)', function () {
        assert.match(src, /manifest\.json/);
        assert.match(src, /package\.json/);
        assert.match(src, /is not a gina project/);
    });
});


// ---------------------------------------------------------------------------
// 06 — registration (reuse, not duplication)
// ---------------------------------------------------------------------------

describe('06 - registration', function () {

    it('self-invokes the CLI from THIS install (process.execPath + resolved bin/cli), not PATH', function () {
        assert.match(src, /process\.execPath/);
        assert.match(src, /path\.resolve\(__dirname,.*'bin\/cli'\)/);
    });

    it('registers the project via project:add @name --path=<to>', function () {
        assert.match(src, /\['project:add', '@'\+ local\.project, '--path='\+ local\.target\]/);
    });

    it('confirms registration by re-reading projects.json (postcondition, not exit code)', function () {
        assert.match(src, /projects\.json/);
        assert.match(src, /failed to register the project/);
    });

    it('allocates ports by importing each manifest bundle (bundle:add --import)', function () {
        assert.match(src, /\['bundle:add', bundles\[i\], '@'\+ local\.project, '--import'\]/);
    });
});


// ---------------------------------------------------------------------------
// 07 — the load-bearing NEGATIVES
// ---------------------------------------------------------------------------

describe('07 - safety negatives', function () {

    it('never reads the output dir from cmd.params.path / projectLocation', function () {
        assert.doesNotMatch(src, /cmd\.params\.path/);
        assert.doesNotMatch(src, /self\.projectLocation/);
    });

    it('never writes the registry directly (delegates to project:add)', function () {
        assert.doesNotMatch(src, /createFileFromDataSync/);
    });

    it('never invokes project:rm / project:remove --force (the source-deleting footgun)', function () {
        assert.doesNotMatch(src, /project:rm/);
        assert.doesNotMatch(src, /:remove/);
    });
});


// ---------------------------------------------------------------------------
// 08 — help.txt + arguments.json
// ---------------------------------------------------------------------------

describe('08 - help + arguments', function () {

    it('documents [ Restore project ] with @<name>, an archive, --to and .zip', function () {
        assert.match(helpTxt, /\[ Restore project \][\s\S]*?gina project:restore @<project_name> <archive\.zip> --to=/);
    });

    it('the restore block no longer advertises the stale .tar.gz / --path', function () {
        var block = helpTxt.slice(helpTxt.indexOf('[ Restore project ]'));
        assert.doesNotMatch(block, /\.tar\.gz/);
        assert.doesNotMatch(block, /--path/);
    });

    it('arguments.json whitelists --to and --force', function () {
        assert.ok(argsArr.indexOf('--to') !== -1, '--to must be whitelisted');
        assert.ok(argsArr.indexOf('--force') !== -1, '--force must be whitelisted');
    });
});


// ---------------------------------------------------------------------------
// 09 — pure-logic replica of the archive-arg finder
// ---------------------------------------------------------------------------

describe('09 - archive-arg finder replica', function () {

    // mirror of restore.js: the archive is the first argv[3..] token that is
    // neither an @<name> nor a --flag (order-independent).
    function findArchive(argv) {
        return argv.slice(3).find(function (a) { return a && !/^@/.test(a) && !/^--/.test(a); }) || null;
    }

    it('finds the archive after @name', function () {
        assert.equal(findArchive(['node', 'cli', 'project:restore', '@p', '/d/a.zip', '--to=/x']), '/d/a.zip');
    });

    it('finds the archive before @name (order-independent)', function () {
        assert.equal(findArchive(['node', 'cli', 'project:restore', '/d/a.zip', '@p', '--to=/x']), '/d/a.zip');
    });

    it('finds a relative archive too', function () {
        assert.equal(findArchive(['node', 'cli', 'project:restore', '@p', 'a.zip']), 'a.zip');
    });

    it('returns null when only @name and flags are present', function () {
        assert.equal(findArchive(['node', 'cli', 'project:restore', '@p', '--to=/x']), null);
    });
});


// ---------------------------------------------------------------------------
// 10 — shared-bootstrap exemption
// ---------------------------------------------------------------------------

describe('10 - bootstrap exemption', function () {

    it('helper.js exempts project:restore from the "not registered" guard (with add/import/remove/rm)', function () {
        // #B104 — `rm` added to the exemption set so the `project:rm` alias follows
        // the same not-yet-registered exemption as `project:remove`.
        assert.match(helperSrc, /!\/\\:\(add\|import\|remove\|rm\|restore\)\$\/\.test\(cmd\.task\)/);
    });
});
