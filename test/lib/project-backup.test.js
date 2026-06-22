/**
 * lib/cmd/project/backup.js — archives a project's SOURCE TREE into a single
 * `.zip` via lib/archiver's ARRAY form. The handler walks the source itself
 * (excluding node_modules, skipping symlinks) so it never recurses the absolute
 * node_modules/gina link into the framework install — the directory form of
 * compress() follows symlinks and was measured to corrupt the entry paths.
 *
 * Source-inspection tests (same style as project-move.test.js): the handler runs
 * in the CLI offline context and shells out to lib/archiver, so these assertions
 * prove the source structure of:
 *
 *   (01) module shape + CmdHelper wiring
 *   (02) single project token + --out parsing (default cwd; NOT --path)
 *   (03) validation (registered project, has-source, source-on-disk)
 *   (04) --with-password REFUSAL (fail-closed; no encryption method invoked)
 *   (05) file collection (exclude node_modules, skip symlinks)
 *   (06) archiver ARRAY-form invocation (.zip artifact; NOT decompress/stream)
 *   (07) the load-bearing NEGATIVE: backup is READ-ONLY (no registry write, no
 *        tree rename, no ports access)
 *   (08) help.txt + arguments.json
 *   (09) pure-logic replica of the genuinely-new bit — the source walker
 *
 * Sections 01-08 source-pins lock the operators so the section 09 replica cannot
 * silently drift.
 *
 * NOTE: a live happy-path smoke (scaffold a throwaway project, back it up, assert
 * the .zip exists) is run separately — these structural tests prove SHAPE, the
 * smoke proves RUNTIME (the project:move lesson: 26 green structural tests on a
 * functionally broken command; only the smoke caught it).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var BACKUP_SOURCE = path.join(require('../fw'), 'lib/cmd/project/backup.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/project/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/project/arguments.json');

var src     = fs.readFileSync(BACKUP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Backup constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Backup;?/);
    });

    it('declares a function Backup(opt, cmd)', function () {
        assert.match(src, /function\s+Backup\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('wires CmdHelper and gates on isCmdConfigured()', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
        assert.match(src, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — single project token + --out (default cwd, NOT --path)
// ---------------------------------------------------------------------------

describe('02 - argument parsing', function () {

    it('uses the single project token (self.projectName), not two positionals', function () {
        assert.match(src, /local\.project\s*=\s*self\.projectName;/);
        assert.doesNotMatch(src, /self\.bundles\[1\]/);
    });

    it('reads --out from argv (NOT --path, which the bootstrap pre-creates/hijacks)', function () {
        assert.match(src, /\/\^--out=\//);
        // the output dir must never be read off cmd.params.path / projectLocation
        assert.doesNotMatch(src, /cmd\.params\.path/);
        assert.doesNotMatch(src, /self\.projectLocation/);
    });

    it('defaults the output dir to the current working directory', function () {
        assert.match(src, /process\.cwd\(\)/);
        assert.match(src, /path\.resolve\(outVal\)/);
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

    it('reads the source path and rejects an empty one', function () {
        assert.match(src, /local\.source\s*=\s*self\.projects\[local\.project\]\.path;/);
        assert.match(src, /has no source path to back up/);
    });

    it('refuses when the source path is missing on disk', function () {
        assert.match(src, /fs\.existsSync\(local\.source\)/);
        assert.match(src, /does not exist on disk/);
    });
});


// ---------------------------------------------------------------------------
// 04 — --with-password REFUSAL (fail-closed)
// ---------------------------------------------------------------------------

describe('04 - with-password refusal', function () {

    it('detects --with-password on argv AND the hoisted GINA_WITH_PASSWORD', function () {
        assert.match(src, /--with-password\(=\|\$\)/);
        assert.match(src, /process\.gina\.GINA_WITH_PASSWORD/);
    });

    it('refuses with a clear not-supported message (no plaintext fallback)', function () {
        assert.match(src, /--with-password is not supported yet/);
        assert.match(src, /No archive was created/);
    });

    it('never invokes an archiver encryption / signature method', function () {
        assert.doesNotMatch(src, /\.addSignature\(/);
    });
});


// ---------------------------------------------------------------------------
// 05 — file collection (exclude node_modules, skip symlinks)
// ---------------------------------------------------------------------------

describe('05 - source collection', function () {

    it('skips symlinks (so the absolute node_modules/gina link is not followed)', function () {
        assert.match(src, /\.isSymbolicLink\(\)/);
    });

    it('excludes the node_modules directory by name', function () {
        assert.match(src, /=== 'node_modules'/);
    });

    it('collects files as { input, output } with a source-relative output path', function () {
        assert.match(src, /out\.push\(\{ input: abs, output: abs\.substring\(baseLen\) \}\)/);
    });
});


// ---------------------------------------------------------------------------
// 06 — archiver ARRAY-form invocation (.zip artifact)
// ---------------------------------------------------------------------------

describe('06 - archiver invocation', function () {

    it('compresses the collected list with method gzip, level 9, named per project', function () {
        assert.match(src, /lib\.archiver\.compress\(files, local\.outDir \+ '\/', \{ method: 'gzip', name: base, level: 9 \}\)/);
    });

    it('awaits completion via .onComplete', function () {
        assert.match(src, /\.onComplete\(function onBackupComplete\(err, archivePath\)/);
    });

    it('produces a .zip artifact named <project>-<timestamp>', function () {
        assert.match(src, /var base = local\.project \+ '-' \+ timestamp\(\);/);
        assert.match(src, /base \+ '\.zip'/);
    });

    it('asserts the archive exists before reporting success (positive evidence)', function () {
        assert.match(src, /fs\.existsSync\(finalPath\)/);
        assert.match(src, /fs\.statSync\(finalPath\)\.size/);
    });

    it('does NOT call the unimplemented decompress / stream archiver methods', function () {
        assert.doesNotMatch(src, /\.decompress\(/);
        assert.doesNotMatch(src, /\.compressFromStream\(/);
    });
});


// ---------------------------------------------------------------------------
// 07 — the load-bearing NEGATIVE: backup is READ-ONLY
// ---------------------------------------------------------------------------

describe('07 - read-only (no registry write, no rename, no ports)', function () {

    it('never writes the ~/.gina registry', function () {
        assert.doesNotMatch(src, /createFileFromDataSync/);
    });

    it('never moves/renames the source tree', function () {
        assert.doesNotMatch(src, /\.renameSync\(/);
    });

    it('never accesses the ports registry surfaces (self.ports*)', function () {
        assert.doesNotMatch(src, /self\.ports/);
    });
});


// ---------------------------------------------------------------------------
// 08 — help.txt + arguments.json
// ---------------------------------------------------------------------------

describe('08 - help + arguments', function () {

    it('documents [ Backup project ] with --out and a .zip artifact', function () {
        assert.match(helpTxt, /\[ Backup project \][\s\S]*?gina project:backup @<project_name> \[ --out=/);
        assert.match(helpTxt, /\[ Backup project \][\s\S]*?\.zip/);
    });

    it('notes that --with-password is not implemented yet', function () {
        assert.match(helpTxt, /--with-password is not implemented yet/);
    });

    it('arguments.json whitelists --out', function () {
        assert.ok(argsArr.indexOf('--out') !== -1, '--out must be whitelisted for project:backup');
    });
});


// ---------------------------------------------------------------------------
// 09 — pure-logic replica of the source walker
// ---------------------------------------------------------------------------

describe('09 - source-walker replica', function () {

    // mirror of backup.js collectFiles(): exclude node_modules, skip symlinks,
    // emit { input, output } with a source-relative output path.
    function collect(readdir, dir, baseLen, out) {
        var entries = readdir(dir);
        for (var i = 0; i < entries.length; ++i) {
            var e = entries[i];
            if (e.isSymbolicLink()) {
                continue;
            }
            var abs = dir + '/' + e.name;
            if (e.isDirectory()) {
                if (e.name === 'node_modules') {
                    continue;
                }
                collect(readdir, abs, baseLen, out);
            } else if (e.isFile()) {
                out.push({ input: abs, output: abs.substring(baseLen) });
            }
        }
        return out;
    }

    function dirent(name, type) {
        return {
            name: name,
            isFile:          function () { return type === 'file'; },
            isDirectory:     function () { return type === 'dir'; },
            isSymbolicLink:  function () { return type === 'symlink'; }
        };
    }

    var tree = {
        '/proj': [
            dirent('package.json', 'file'),
            dirent('node_modules', 'dir'),
            dirent('gina-link', 'symlink'),
            dirent('src', 'dir'),
            dirent('.git', 'dir')
        ],
        '/proj/src': [ dirent('demo', 'dir') ],
        '/proj/src/demo': [ dirent('index.js', 'file') ],
        '/proj/node_modules': [ dirent('realdep', 'dir') ],  // must NEVER be visited
        '/proj/.git': [ dirent('config', 'file') ]
    };
    function readdir(dir) { return tree[dir] || []; }

    it('collects real files with relative output paths, excludes node_modules, skips symlinks', function () {
        var out = collect(readdir, '/proj', '/proj/'.length, []);
        var outputs = out.map(function (f) { return f.output; }).sort();
        assert.deepEqual(outputs, ['.git/config', 'package.json', 'src/demo/index.js']);
    });

    it('never descends into node_modules (no realdep entry)', function () {
        var out = collect(readdir, '/proj', '/proj/'.length, []);
        assert.ok(out.every(function (f) { return f.output.indexOf('node_modules') < 0; }));
        assert.ok(out.every(function (f) { return f.output.indexOf('realdep') < 0; }));
    });

    it('never emits the symlink entry', function () {
        var out = collect(readdir, '/proj', '/proj/'.length, []);
        assert.ok(out.every(function (f) { return f.output.indexOf('gina-link') < 0; }));
    });

    it('keeps the input as an absolute path and output as source-relative', function () {
        var out = collect(readdir, '/proj', '/proj/'.length, []);
        var pkg = out.find(function (f) { return f.output === 'package.json'; });
        assert.equal(pkg.input, '/proj/package.json');
    });
});


// ---------------------------------------------------------------------------
// 10 — archive-name shape
// ---------------------------------------------------------------------------

describe('10 - archive name shape', function () {

    // mirror of backup.js timestamp(): YYYYMMDD-HHMMSS
    function timestamp(d) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
                  + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    it('builds <project>-<YYYYMMDD-HHMMSS>.zip', function () {
        var name = 'myproj' + '-' + timestamp(new Date(2026, 5, 19, 9, 4, 6)) + '.zip';
        assert.equal(name, 'myproj-20260619-090406.zip');
    });
});
