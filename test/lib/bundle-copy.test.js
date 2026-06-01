/**
 * lib/cmd/bundle/copy.js — duplicates a bundle under a NEW name within the SAME
 * project (copy source tree + word-boundary name rewrite + fresh full-matrix
 * ports + manifest/env registration). cp.js is the alias.
 *
 * Source-inspection tests (same style as protocol-remove.test.js,
 * minion-list.test.js): the handler runs in the CLI daemon context (CmdHelper,
 * globals) and touches the filesystem + ~/.gina port maps, so these assertions
 * prove the source structure of:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) two-positional parsing (source + new name via self.bundles, NOT self.name)
 *   (c) project guard + loadAssets
 *   (d) flag parsing from self.params (--dry-run / --force / --format)
 *   (e) validation (source===dest, isValidName, source-exists, dest-existence)
 *   (f) copy flow wiring (scan -> cp -> rewriteTree -> setPorts -> writeManifest)
 *   (g) name-rewrite operators (the two word-boundary regexes + webroot fix)
 *   (h) manifest clone + releases repoint operators
 *   (i) dry-run short-circuit + report shape
 *   (j) JSON output shape
 *   (k) help.txt + arguments.json + cp alias
 *
 * Sections 12-14 are pure-logic replicas of the genuinely new bits — the name
 * rewrite, the preview occurrence count, and the manifest repoint. Sections
 * 07-08 source-pins lock the operators so the replicas cannot silently drift.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var COPY_SOURCE = path.join(require('../fw'), 'lib/cmd/bundle/copy.js');
var CP_SOURCE   = path.join(require('../fw'), 'lib/cmd/bundle/cp.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/bundle/help.txt');
var ARGS_FILE   = path.join(require('../fw'), 'lib/cmd/bundle/arguments.json');

var src     = fs.readFileSync(COPY_SOURCE, 'utf8');
var cpSrc   = fs.readFileSync(CP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Copy constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Copy;?/);
    });

    it('declares a function Copy(opt, cmd)', function () {
        assert.match(src, /function\s+Copy\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('wires CmdHelper and gates on isCmdConfigured()', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
        assert.match(src, /if \(!isCmdConfigured\(\)\) return false;/);
    });

    it('requires the port scanner', function () {
        assert.match(src, /var scan\s*=\s*require\('\.\/\.\.\/port\/inc\/scan'\)/);
    });
});


// ---------------------------------------------------------------------------
// 02 — two-positional parsing (source + new name)
// ---------------------------------------------------------------------------

describe('02 - two-positional parsing', function () {

    it('reads BOTH names from self.bundles (not self.name)', function () {
        assert.match(src, /var bundles = self\.bundles \|\| \[\]/);
        assert.match(src, /local\.source\s*=\s*bundles\[0\]/);
        assert.match(src, /local\.dest\s*=\s*bundles\[1\]/);
    });

    it('requires exactly two positionals', function () {
        assert.match(src, /bundles\.length !== 2/);
        assert.match(src, /requires a source AND a new name/);
    });
});


// ---------------------------------------------------------------------------
// 03 — project guard + loadAssets
// ---------------------------------------------------------------------------

describe('03 - project guard', function () {

    it('rejects an unregistered project', function () {
        assert.match(src, /self\.projectName == null \|\| typeof\(self\.projects\[self\.projectName\]\) == 'undefined'/);
        assert.match(src, /is not a registered project/);
    });

    it('calls loadAssets() to populate bundlesByProject + ports/env/manifest', function () {
        assert.match(src, /loadAssets\(\);/);
    });
});


// ---------------------------------------------------------------------------
// 04 — flag parsing from self.params
// ---------------------------------------------------------------------------

describe('04 - flags', function () {

    it('reads dry-run / force / format from self.params', function () {
        assert.match(src, /var p\s*=\s*self\.params \|\| \{\}/);
        assert.match(src, /var dryRun\s*=\s*!!p\['dry-run'\]/);
        assert.match(src, /var force\s*=\s*!!p\['force'\]/);
        assert.match(src, /var format\s*=\s*p\['format'\] \|\| null/);
    });
});


// ---------------------------------------------------------------------------
// 05 — validation
// ---------------------------------------------------------------------------

describe('05 - validation', function () {

    it('rejects identical source/destination names', function () {
        assert.match(src, /source === dest/);
        assert.match(src, /are identical/);
    });

    it('validates the destination name', function () {
        assert.match(src, /!isValidName\(dest\)/);
        assert.match(src, /is not a valid bundle name/);
    });

    it('requires the source bundle to be registered and on disk', function () {
        assert.match(src, /self\.bundlesByProject\[project\]/);
        assert.match(src, /is not registered inside/);
        assert.match(src, /!fs\.existsSync\(srcPath\)/);
        assert.match(src, /does not exist/);
    });

    it('refuses an existing destination unless --force', function () {
        assert.match(src, /var destInManifest/);
        assert.match(src, /isDefined\('bundle', dest\)/);
        assert.match(src, /destExists && !force/);
        assert.match(src, /already exists inside/);
        assert.match(src, /Re-run with --force/);
    });
});


// ---------------------------------------------------------------------------
// 06 — copy flow wiring (scan -> cp -> rewriteTree -> setPorts -> writeManifest)
// ---------------------------------------------------------------------------

describe('06 - copy flow', function () {

    it('scans for free ports with the full-matrix limit', function () {
        assert.match(src, /local\.portCount\s*=\s*getBundleScanLimit\(dest\)/);
        assert.match(src, /ignore\s*:\s*getPortsList\(\)/);
        assert.match(src, /limit\s*:\s*local\.portCount/);
        assert.match(src, /scan\(options, function/);
    });

    it('copies the source tree with a trailing-slash (children) cp', function () {
        assert.match(src, /var srcDir = new _\(self\.projects\[project\]\.path \+ '\/' \+ srcEntry\.src \+ '\/'\)/);
        assert.match(src, /srcDir\.cp\(destPath, function done/);
    });

    it('rewrites the copied tree, then allocates ports, then writes the manifest', function () {
        assert.match(src, /var rewritten = rewriteTree\(destPath, source, dest\)/);
        assert.match(src, /setPorts\(dest, ports, function onPortsSet/);
        assert.match(src, /writeManifest\(source, dest\)/);
        // ordering: rewriteTree before setPorts before writeManifest
        assert.ok(src.indexOf('rewriteTree(destPath') < src.indexOf('setPorts(dest, ports'));
        assert.ok(src.indexOf('setPorts(dest, ports') < src.indexOf('writeManifest(source, dest)'));
    });

    it('--force removes the pre-existing destination first (mirrors remove.js)', function () {
        assert.match(src, /if \( destExists \) \{\s*\n\s*removeDest\(dest\)/);
        assert.match(src, /createFileFromDataSync\(self\.envData, self\.envPath\)/);
        assert.match(src, /createFileFromDataSync\(ports, self\.portsPath\)/);
        assert.match(src, /createFileFromDataSync\(portsReverse, self\.portsReversePath\)/);
    });
});


// ---------------------------------------------------------------------------
// 07 — delegates the name rewrite to the shared engine
//      (the operators themselves are tested in bundle-name-rewrite.test.js)
// ---------------------------------------------------------------------------

describe('07 - delegates name rewrite to the shared engine', function () {

    it('requires the shared name-rewrite module', function () {
        assert.match(src, /var nameRewrite = require\('\.\/inc\/name-rewrite'\)/);
    });

    it('rewriteTree delegates to nameRewrite.renameContent with the webroot toggle', function () {
        assert.match(src, /nameRewrite\.renameContent\(content, source, dest, \{ fixWebroot: isServerSettings \}\)/);
    });

    it('removeDest uses nameRewrite.escapeRegex for the ports regex', function () {
        assert.match(src, /nameRewrite\.escapeRegex\(dest\)/);
        assert.match(src, /nameRewrite\.escapeRegex\(project\)/);
    });

    it('report uses nameRewrite.capitalize for the dry-run wording', function () {
        assert.match(src, /nameRewrite\.capitalize\(source\)/);
        assert.match(src, /nameRewrite\.capitalize\(dest\)/);
    });

    it('rewrite is limited to .js / .json files', function () {
        assert.match(src, /\/\\\.\(js\|json\)\$\/i\.test\(f\)/);
    });

    it('no longer defines the engine inline (moved to the shared module)', function () {
        assert.doesNotMatch(src, /var renameContent = function/);
        assert.doesNotMatch(src, /var escapeRegex = function/);
        assert.doesNotMatch(src, /var capitalize = function/);
    });
});


// ---------------------------------------------------------------------------
// 08 — manifest clone + releases repoint operators (lock for §14 replica)
// ---------------------------------------------------------------------------

describe('08 - manifest repoint operators', function () {

    it('clones the source entry and repoints src / link', function () {
        assert.match(src, /entry\s*=\s*JSON\.clone\(srcEntry\)/);
        assert.match(src, /entry\.src\s*=\s*'src\/' \+ dest/);
        assert.match(src, /entry\.link\s*=\s*'bundles\/' \+ dest/);
    });

    it('repoints each release target path from source to dest', function () {
        assert.match(src, /rel\.target\.replace\('releases\/' \+ source \+ '\/', 'releases\/' \+ dest \+ '\/'\)/);
    });

    it('writes the manifest and evicts the require cache', function () {
        assert.match(src, /data\.bundles\[dest\]\s*=\s*entry/);
        assert.match(src, /createFileFromDataSync\(data, self\.projectManifestPath\)/);
        assert.match(src, /delete require\.cache\[require\.resolve\(self\.projectManifestPath\)\]/);
    });
});


// ---------------------------------------------------------------------------
// 09 — dry-run short-circuit + report
// ---------------------------------------------------------------------------

describe('09 - dry-run', function () {

    it('short-circuits to a preview (previewRewrite) before any write', function () {
        assert.match(src, /if \( dryRun \) \{\s*\n\s*return report\(true, format, source, dest, project, srcPath, destPath, destExists, previewRewrite\(srcPath, source, dest\)\)/);
    });

    it('previewRewrite scans the SOURCE tree (no copy yet) via nameRewrite.countOccurrences', function () {
        assert.match(src, /var previewRewrite = function\(srcPath, source, dest\)/);
        assert.match(src, /nameRewrite\.countOccurrences\(content, source\)/);
    });

    it('preview wording differs from the success wording', function () {
        assert.match(src, /would copy bundle/);
        assert.match(src, /no changes written/);
        assert.match(src, /copied to/);
    });
});


// ---------------------------------------------------------------------------
// 10 — JSON output shape
// ---------------------------------------------------------------------------

describe('10 - JSON output', function () {

    it('detects --format=json and emits the copy envelope', function () {
        assert.match(src, /\/\^json\?\/\.test\(format \|\| ''\)/);
        assert.match(src, /process\.stdout\.write\(JSON\.stringify\(\{/);
        assert.match(src, /rewriteSites/);
        assert.match(src, /portsToAllocate/);
    });
});


// ---------------------------------------------------------------------------
// 11 — help + arguments + cp alias
// ---------------------------------------------------------------------------

describe('11 - help + arguments + alias', function () {

    it('help.txt documents bundle:copy and the cp alias', function () {
        assert.match(helpTxt, /bundle:copy/);
        assert.match(helpTxt, /bundle:cp/);
    });

    it('help.txt has no "insall" typo carried from the old stub', function () {
        assert.doesNotMatch(helpTxt, /insall/);
    });

    it('arguments.json declares --dry-run, --format, --force', function () {
        assert.ok(Array.isArray(argsArr));
        assert.ok(argsArr.indexOf('--dry-run') > -1);
        assert.ok(argsArr.indexOf('--format') > -1);
        assert.ok(argsArr.indexOf('--force') > -1);
    });

    it('cp.js is a thin re-export of ./copy', function () {
        assert.match(cpSrc, /module\.exports\s*=\s*require\('\.\/copy'\)/);
    });
});


// ---------------------------------------------------------------------------
// 12 — pure-logic replica: manifest clone + releases repoint
//      (the name-rewrite engine's own tests live in bundle-name-rewrite.test.js)
// ---------------------------------------------------------------------------

describe('12 - manifest repoint replica', function () {

    function repointEntry(srcEntry, source, dest) {
        var entry = JSON.parse(JSON.stringify(srcEntry));
        entry.src  = 'src/' + dest;
        entry.link = 'bundles/' + dest;
        if (entry.releases) {
            for (var scope in entry.releases) {
                for (var env in entry.releases[scope]) {
                    var rel = entry.releases[scope][env];
                    if (rel && rel.target) {
                        rel.target = rel.target.replace('releases/' + source + '/', 'releases/' + dest + '/');
                    }
                }
            }
        }
        return entry;
    }

    it('repoints src / link and every release target, preserving version/tag/comment', function () {
        var srcEntry = {
            _comment: 'kept',
            version: '0.0.1',
            tag: '001',
            src: 'src/api',
            link: 'bundles/api',
            releases: {
                local: {
                    staging:    { target: 'releases/api/local/staging/0.0.1' },
                    production: { target: 'releases/api/local/production/0.0.1' }
                }
            }
        };
        var out = repointEntry(srcEntry, 'api', 'web');
        assert.equal(out._comment, 'kept');
        assert.equal(out.version, '0.0.1');
        assert.equal(out.tag, '001');
        assert.equal(out.src, 'src/web');
        assert.equal(out.link, 'bundles/web');
        assert.equal(out.releases.local.staging.target, 'releases/web/local/staging/0.0.1');
        assert.equal(out.releases.local.production.target, 'releases/web/local/production/0.0.1');
        // source entry untouched (deep clone)
        assert.equal(srcEntry.src, 'src/api');
    });
});
