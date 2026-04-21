/**
 * lib/cmd/connector/list.js — argv parsing, connectors.json reading, driver
 * resolution, install probing, overlay + override detection, version-pin
 * disagreement warnings.
 *
 * Source-inspection tests (same style as service-list.test.js,
 * inspector-open.test.js): list.js runs inside the CLI daemon context
 * (CmdHelper, project registry, globals injected by gna.js). Replicating
 * that is heavy for near-zero extra coverage, so these assertions prove the
 * source structure of:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) argv loop — `--format=<x>` capture, CmdHelper-driven project/bundle
 *   (c) DRIVER_MAP + AI_DRIVER_MAP — the full peerDependencies mapping
 *   (d) resolveDriver — entry.connector vs key fallback, ai protocol map,
 *       builtin / unresolved paths
 *   (e) readJsonSafe — uses requireJSON, null on missing
 *   (f) gatherProjectRows — shared + bundle merge, bundle wins, override
 *       source label
 *   (g) checkInstalled — node_modules/<driver>/package.json
 *   (h) detectVersionDisagreements — byDriver grouping
 *   (i) formatRow — status flags, source labels, driver info
 *   (j) listAll / listProjectOnly / listBundleOnly
 *   (k) JSON output shape
 *   (l) Help module + help.txt + arguments.json
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var LIST_SOURCE = path.join(require('../fw'), 'lib/cmd/connector/list.js');
var HELP_SOURCE = path.join(require('../fw'), 'lib/cmd/connector/help.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/connector/help.txt');
var ARGS_FILE   = path.join(require('../fw'), 'lib/cmd/connector/arguments.json');
var CLI_SOURCE  = path.join(__dirname, '..', '..', 'bin', 'cli');

var src     = fs.readFileSync(LIST_SOURCE, 'utf8');
var helpSrc = fs.readFileSync(HELP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc  = fs.readFileSync(CLI_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the List constructor', function () {
        assert.match(src, /module\.exports\s*=\s*List;?/);
    });

    it('declares a function List(opt, cmd)', function () {
        assert.match(src, /function\s+List\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('initialises self with a null format', function () {
        assert.match(src, /var self\s*=\s*\{\s*format\s*:\s*null\s*\}/);
    });

    it('wires CmdHelper with opt.client and debug flags', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
    });

    it('gates on isCmdConfigured()', function () {
        assert.match(src, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — argv parsing
// ---------------------------------------------------------------------------

describe('02 - argv parsing', function () {

    it('iterates process.argv from index 3', function () {
        assert.match(src, /for \(var i = 3, len = process\.argv\.length; i < len; i\+\+\)/);
    });

    it('captures --format=<value>', function () {
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(arg\)/);
        assert.match(src, /self\.format = arg\.split\(\/\\=\/\)\[1\];/);
    });

    it('uses self.name from CmdHelper as the bundle filter', function () {
        assert.match(src, /var bundleFilter = self\.name \|\| null;/);
    });

    it('defaults to listAll when no @-project is supplied', function () {
        assert.match(src, /typeof\(self\.projectName\) == 'undefined'[\s\S]*?listAll\(\);/);
    });

    it('errors if a bundle is supplied without `@<project>`', function () {
        assert.match(src, /`connector:list <bundle>` requires `@<project>`/);
    });

    it('errors if the requested project is not registered', function () {
        assert.match(src, /is not registered\. Run `gina project:list`/);
    });
});


// ---------------------------------------------------------------------------
// 03 — DRIVER_MAP + AI_DRIVER_MAP
// ---------------------------------------------------------------------------

describe('03 - DRIVER_MAP', function () {

    it('declares a DRIVER_MAP table', function () {
        assert.match(src, /var DRIVER_MAP\s*=\s*\{/);
    });

    it('maps couchbase → couchbase >=3.0.0', function () {
        assert.match(src, /couchbase\s*:\s*\{\s*npm:\s*'couchbase',\s*range:\s*'>=3\.0\.0'\s*\}/);
    });

    it('maps redis → ioredis >=5.0.0', function () {
        assert.match(src, /redis\s*:\s*\{\s*npm:\s*'ioredis',\s*range:\s*'>=5\.0\.0'\s*\}/);
    });

    it('maps mysql → mysql2 >=2.0.0', function () {
        assert.match(src, /mysql\s*:\s*\{\s*npm:\s*'mysql2',\s*range:\s*'>=2\.0\.0'\s*\}/);
    });

    it('maps postgresql → pg >=8.0.0', function () {
        assert.match(src, /postgresql\s*:\s*\{\s*npm:\s*'pg',\s*range:\s*'>=8\.0\.0'\s*\}/);
    });

    it('maps mongodb → mongodb >=5.0.0', function () {
        assert.match(src, /mongodb\s*:\s*\{\s*npm:\s*'mongodb',\s*range:\s*'>=5\.0\.0'\s*\}/);
    });

    it('maps scylladb → @scylladb/scylla-driver >=1.0.0', function () {
        assert.match(src, /scylladb\s*:\s*\{\s*npm:\s*'@scylladb\/scylla-driver',\s*range:\s*'>=1\.0\.0'\s*\}/);
    });

    it('flags sqlite as builtin (node:sqlite)', function () {
        assert.match(src, /sqlite\s*:\s*\{[^}]*builtin:\s*true[^}]*\}/);
        assert.match(src, /node:sqlite/);
    });
});


describe('04 - AI_DRIVER_MAP', function () {

    it('declares an AI_DRIVER_MAP table', function () {
        assert.match(src, /var AI_DRIVER_MAP\s*=\s*\{/);
    });

    it('maps anthropic → @anthropic-ai/sdk', function () {
        assert.match(src, /anthropic\s*:\s*\{\s*npm:\s*'@anthropic-ai\/sdk',\s*range:\s*'>=0\.27\.0'\s*\}/);
    });

    it('maps openai → openai >=4.0.0', function () {
        assert.match(src, /openai\s*:\s*\{\s*npm:\s*'openai',\s*range:\s*'>=4\.0\.0'\s*\}/);
    });

    it('maps at least 9 OpenAI-compatible providers', function () {
        // deepseek, qwen, groq, mistral, together, ollama, gemini, xai, perplexity
        assert.match(src, /deepseek\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /qwen\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /groq\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /mistral\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /together\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /ollama\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /gemini\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /xai\s*:\s*\{\s*npm:\s*'openai'/);
        assert.match(src, /perplexity\s*:\s*\{\s*npm:\s*'openai'/);
    });
});


// ---------------------------------------------------------------------------
// 05 — resolveDriver()
// ---------------------------------------------------------------------------

describe('05 - resolveDriver', function () {

    it('prefers entry.connector, falls back to the logical key', function () {
        assert.match(src, /var type = \(entry && entry\.connector\) \? entry\.connector : key;/);
    });

    it('reads entry.protocol to resolve ai scheme', function () {
        assert.match(src, /var protocol = \(entry && entry\.protocol\) \? String\(entry\.protocol\) : '';/);
        assert.match(src, /var scheme\s*=\s*protocol\.split\(':'\)\[0\]\.toLowerCase\(\);/);
    });

    it('flags unresolved ai protocol with a helpful hint', function () {
        assert.match(src, /unknown `ai` protocol/);
        assert.match(src, /unresolved\s*:\s*true/);
    });

    it('flags unknown connector types with a note', function () {
        assert.match(src, /unknown connector type/);
    });

    it('returns builtin: true for node:sqlite', function () {
        assert.match(src, /if \(entryInfo\.builtin\)/);
        assert.match(src, /builtin\s*:\s*true/);
    });
});


// ---------------------------------------------------------------------------
// 06 — readJsonSafe + loadManifest
// ---------------------------------------------------------------------------

describe('06 - readJsonSafe + loadManifest', function () {

    it('readJsonSafe returns null on missing file', function () {
        assert.match(src, /if \(\s*!fs\.existsSync\(filePath\)\s*\) return null;/);
    });

    it('readJsonSafe delegates to requireJSON (comment tolerance)', function () {
        assert.match(src, /return requireJSON\(filePath\);/);
    });

    it('readJsonSafe swallows parse errors and returns null', function () {
        assert.match(src, /try\s*\{[\s\S]*?return requireJSON\(filePath\);[\s\S]*?\}\s*catch \(e\) \{\s*return null;/);
    });

    it('loadManifest reads <projectPath>/manifest.json', function () {
        assert.match(src, /projectPath \+ '\/manifest\.json'/);
    });
});


// ---------------------------------------------------------------------------
// 07 — checkInstalled (install status probe)
// ---------------------------------------------------------------------------

describe('07 - checkInstalled', function () {

    it('returns {installed:false, version:null} when driver is null', function () {
        assert.match(src, /if \(!driverNpm\) return \{\s*installed:\s*false,\s*version:\s*null\s*\};/);
    });

    it('probes <projectPath>/node_modules/<driver>/package.json', function () {
        assert.match(src, /projectPath \+ '\/node_modules\/' \+ driverNpm \+ '\/package\.json'/);
    });

    it('returns installed:false when package.json is missing', function () {
        assert.match(src, /if \(\s*!fs\.existsSync\(pkgPath\)\s*\)\s*\{\s*return \{\s*installed:\s*false,\s*version:\s*null\s*\};/);
    });

    it('extracts pkg.version when the package.json parses', function () {
        assert.match(src, /version:\s*pkg\.version \|\| null/);
    });
});


// ---------------------------------------------------------------------------
// 08 — gatherProjectRows (overlay semantics)
// ---------------------------------------------------------------------------

describe('08 - gatherProjectRows', function () {

    it('reads shared/config/connectors.json', function () {
        assert.match(src, /project\.path \+ '\/shared\/config\/connectors\.json'/);
    });

    it('iterates manifest.bundles in sorted order', function () {
        assert.match(src, /Object\.keys\(manifest\.bundles\)\.sort\(\);/);
    });

    it('reads <projectPath>/<bundle-src>/config/connectors.json', function () {
        assert.match(src, /project\.path \+ '\/' \+ bSrc \+ '\/config\/connectors\.json'/);
    });

    it('skips the $schema meta-key on both shared and bundle maps', function () {
        // Two places: inside sharedJson loop and inside bJson loop
        assert.match(src, /if \(k === '\$schema'\) continue;/);
        assert.match(src, /if \(bk === '\$schema'\) continue;/);
    });

    it('tracks override relationships through sharedOverriddenBy', function () {
        assert.match(src, /var sharedOverriddenBy = \{\};/);
        assert.match(src, /sharedOverriddenBy\[bk\]/);
    });

    it('marks overridden rows with source=`override`', function () {
        assert.match(src, /overrode \? 'override' : 'bundle'/);
    });

    it('emits a standalone shared row only for un-overridden keys', function () {
        assert.match(src, /if \(sharedOverriddenBy\[sk\]\s*&&\s*sharedOverriddenBy\[sk\]\.length > 0\) continue;/);
    });

    it('merges shared + bundle entries with bundle winning', function () {
        assert.match(src, /var mergedEntry = overrode \? merge\(sharedKeys\[bk\], entry\) : entry;/);
    });

    it('merge() is right-wins shallow', function () {
        assert.match(src, /for \(k in a\) \{ out\[k\] = a\[k\]; \}\s*for \(k in b\) \{ out\[k\] = b\[k\]; \}/);
    });
});


// ---------------------------------------------------------------------------
// 09 — buildRow (row shape)
// ---------------------------------------------------------------------------

describe('09 - buildRow', function () {

    it('calls resolveDriver(entry, key)', function () {
        assert.match(src, /var driver\s*=\s*resolveDriver\(entry, key\);/);
    });

    it('short-circuits install probe for builtin drivers', function () {
        assert.match(src, /driver\.builtin\s*\?\s*\{ installed: true, version: null \}/);
    });

    it('records entry.version as pinnedRange when it is a string', function () {
        assert.match(src, /var pinnedRange\s*=\s*\(typeof entry\.version == 'string'\) \? entry\.version : null;/);
    });

    it('row carries project, bundle, name, connector, source', function () {
        assert.match(src, /project\s*:\s*projectName,/);
        assert.match(src, /bundle\s*:\s*bundleName,/);
        assert.match(src, /name\s*:\s*key,/);
        assert.match(src, /connector\s*:\s*driver\.type,/);
        assert.match(src, /source\s*:\s*source,/);
    });

    it('row carries driver, builtin, range, version, installed, installedVersion, note, unresolved', function () {
        assert.match(src, /driver\s*:\s*driver\.npm,/);
        assert.match(src, /builtin\s*:\s*driver\.builtin,/);
        assert.match(src, /range\s*:\s*driver\.range,/);
        assert.match(src, /version\s*:\s*pinnedRange,/);
        assert.match(src, /installed\s*:\s*install\.installed,/);
        assert.match(src, /installedVersion\s*:\s*install\.version,/);
        assert.match(src, /note\s*:\s*driver\.note,/);
        assert.match(src, /unresolved\s*:\s*driver\.unresolved/);
    });
});


// ---------------------------------------------------------------------------
// 10 — detectVersionDisagreements
// ---------------------------------------------------------------------------

describe('10 - detectVersionDisagreements', function () {

    it('groups rows by driver and version', function () {
        assert.match(src, /byDriver\[r\.driver\] = byDriver\[r\.driver\] \|\| \{\};/);
        assert.match(src, /byDriver\[r\.driver\]\[r\.version\]/);
    });

    it('skips rows without a driver or without a version pin', function () {
        assert.match(src, /if \(!r\.driver \|\| !r\.version\) continue;/);
    });

    it('only emits a warning when 2+ distinct versions are pinned', function () {
        assert.match(src, /if \(versions\.length > 1\)/);
    });

    it('uses "conflicting `version` pins" in the warning string', function () {
        assert.match(src, /conflicting `version` pins:/);
    });
});


// ---------------------------------------------------------------------------
// 11 — formatRow (text output)
// ---------------------------------------------------------------------------

describe('11 - formatRow', function () {

    it('uses [ ?? ] for unresolved rows', function () {
        assert.match(src, /\[ \?\? \]/);
    });

    it('uses [ ok ] when builtin or installed', function () {
        assert.match(src, /statusFlag = '\[ ok \]'/);
    });

    it('uses [ ?! ] when driver is missing', function () {
        assert.match(src, /statusFlag = '\[ \?\! \]'/);
    });

    it('uses [shared] for shared-source rows', function () {
        assert.match(src, /sourceLabel\s*=\s*'\[shared\]'/);
    });

    it('uses [<bundle> override] for overridden rows', function () {
        assert.match(src, /sourceLabel\s*=\s*'\[' \+ r\.bundle \+ ' override\]'/);
    });

    it('uses [<bundle>] for bundle-only rows', function () {
        assert.match(src, /sourceLabel\s*=\s*'\[' \+ r\.bundle \+ '\]'/);
    });

    it('shows `pin <version>` when a version is pinned', function () {
        assert.match(src, /' pin ' \+ r\.version/);
    });

    it('shows `<N.N.N> installed` when resolved', function () {
        assert.match(src, /' installed'/);
    });

    it('suggests `npm install <driver>` when missing', function () {
        assert.match(src, /run `npm install ' \+ r\.driver \+ '`/);
    });

    it('labels node:sqlite as built-in', function () {
        assert.match(src, /\(built-in\)/);
    });

    it('pad() right-pads with spaces to a target width', function () {
        assert.match(src, /while \(out\.length < width\) \{\s*out \+= ' ';/);
    });
});


// ---------------------------------------------------------------------------
// 12 — list dispatch functions
// ---------------------------------------------------------------------------

describe('12 - list functions', function () {

    it('declares listAll()', function () {
        assert.match(src, /var listAll\s*=\s*function \(\) \{/);
    });

    it('declares listProjectOnly(projectName)', function () {
        assert.match(src, /var listProjectOnly\s*=\s*function \(projectName\) \{/);
    });

    it('declares listBundleOnly(projectName, bundleName)', function () {
        assert.match(src, /var listBundleOnly\s*=\s*function \(projectName, bundleName\) \{/);
    });

    it('listAll sorts projects alphabetically', function () {
        assert.match(src, /projectNames\.sort\(\);/);
    });

    it('listAll handles missing project path gracefully', function () {
        assert.match(src, /project path missing:/);
    });

    it('listAll prints `(no connectors declared)` when empty', function () {
        assert.match(src, /\(no connectors declared\)/);
    });

    it('listAll prints `(manifest.json not found ...)` when missing', function () {
        assert.match(src, /\(manifest\.json not found or unreadable/);
    });

    it('listBundleOnly filters rows by r.bundle === bundleName OR r.source === shared', function () {
        assert.match(src, /r\.bundle === bundleName \|\| r\.source === 'shared'/);
    });

    it('uses divider `------------------------------------` in text output', function () {
        assert.match(src, /------------------------------------/);
    });
});


// ---------------------------------------------------------------------------
// 13 — JSON output
// ---------------------------------------------------------------------------

describe('13 - JSON output', function () {

    it('writes raw JSON via process.stdout.write when --format=json', function () {
        // Multiple call sites (listAll, listProjectOnly, listBundleOnly)
        var matches = src.match(/process\.stdout\.write\(JSON\.stringify\(/g) || [];
        assert.ok(matches.length >= 3, 'expected ≥3 process.stdout.write(JSON.stringify(...)) call sites, got ' + matches.length);
    });

    it('guards JSON output with /^json?/ test', function () {
        assert.match(src, /\/\^json\?\/\.test\(self\.format\)/);
    });

    it('listAll json shape: [{project, status, connectors}]', function () {
        assert.match(src, /\{\s*project:\s*pname,\s*status:\s*'ok',\s*connectors:\s*\[\]\s*\}/);
    });

    it('listProjectOnly json shape: {project, status, connectors}', function () {
        assert.match(src, /jsonOut\s*=\s*\{\s*project:\s*projectName,\s*status:\s*'ok',\s*connectors:\s*collected\.rows\s*\}/);
    });

    it('listBundleOnly json shape: {project, bundle, status, connectors}', function () {
        assert.match(src, /jsonOut\s*=\s*\{\s*project:\s*projectName,\s*bundle:\s*bundleName,\s*status:\s*'ok',\s*connectors:\s*filtered\s*\}/);
    });

    it('labels broken project paths with status `?!` in JSON', function () {
        assert.match(src, /jsonProject\.status = '\?\!'/);
    });
});


// ---------------------------------------------------------------------------
// 14 — Help module + arguments.json + bin/cli registration
// ---------------------------------------------------------------------------

describe('14 - help module', function () {

    it('help.js exports a Help constructor', function () {
        assert.match(helpSrc, /module\.exports\s*=\s*Help;?/);
        assert.match(helpSrc, /function\s+Help\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('help.js calls getHelp() after isCmdConfigured()', function () {
        assert.match(helpSrc, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
        assert.match(helpSrc, /getHelp\(\);/);
    });

    it('help.txt documents list / help actions', function () {
        assert.match(helpTxt, /connector:<action>/);
        assert.match(helpTxt, /list\s+List every connector/);
        assert.match(helpTxt, /--format=json/);
    });

    it('help.txt documents all three invocation modes', function () {
        assert.match(helpTxt, /list\s+@<project>/);
        assert.match(helpTxt, /list\s+<bundle>\s+@<project>/);
    });

    it('help.txt documents the status flags', function () {
        assert.match(helpTxt, /\[ ok \]/);
        assert.match(helpTxt, /\[ \?\! \]/);
        assert.match(helpTxt, /\[ \?\? \]/);
        assert.match(helpTxt, /\[ \!\! \]/);
    });

    it('help.txt documents driver resolution table', function () {
        assert.match(helpTxt, /couchbase/);
        assert.match(helpTxt, /ioredis/);
        assert.match(helpTxt, /mysql2/);
        assert.match(helpTxt, /pg/);
        assert.match(helpTxt, /node:sqlite/);
        assert.match(helpTxt, /@anthropic-ai\/sdk/);
    });

    it('help.txt shows at least one concrete example per mode', function () {
        assert.match(helpTxt, /gina connector:list\b/);
        assert.match(helpTxt, /gina connector:list @/);
        assert.match(helpTxt, /gina connector:list \w+ @/);
        assert.match(helpTxt, /gina connector:list --format=json/);
    });

    it('arguments.json registers --format', function () {
        assert.ok(Array.isArray(argsArr), 'arguments.json must parse to an array');
        assert.ok(argsArr.indexOf('--format') > -1, '--format must be registered');
    });

    it('bin/cli registers `connector:` in allowedOffline', function () {
        // Line should appear inside the allowedOffline array literal
        assert.match(cliSrc, /allowedOffline\s*=\s*\[[\s\S]*?'connector:'[\s\S]*?\]/);
    });
});
