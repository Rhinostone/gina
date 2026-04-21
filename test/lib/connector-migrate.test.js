/**
 * lib/cmd/connector/migrate.js — CLI-only lint + fix for connectors.json.
 *
 * Source-inspection tests (same style as connector-list.test.js,
 * connector-add.test.js, connector-rm.test.js): migrate.js runs inside
 * the CLI daemon context (CmdHelper, project registry, globals injected
 * by gna.js). Replicating that is heavy for near-zero extra coverage, so
 * these assertions prove the source structure of:
 *
 *   (a) module shape + CmdHelper wiring + isCmdConfigured gate
 *   (b) positional extraction — argv[3..], skips flags/@/dash tokens,
 *       at most one positional (the bundle name)
 *   (c) ALLOWED_CONNECTOR_TYPES mirror (schema enum)
 *   (d) SCHEMA_URL is the canonical gina.io URL
 *   (e) loadManifest — requireJSON with comment tolerance, null on miss
 *   (f) resolveTargets — shared + every bundle when no <bundle>, single
 *       bundle entry when <bundle> is passed, exits on unknown bundle
 *   (g) scanFile — two check types (`missing-schema`, `bare-key-no-connector`),
 *       header capture before first `{`, requireJSON for parsing,
 *       exists/parseError short-circuit, severity + fixable flags
 *   (h) applyFixes — only fixable today is missing-schema; $schema
 *       pinned at top, remaining keys preserved in order, file
 *       rewritten via lib.generator.createFileFromDataSync
 *   (i) emitText — [fix] vs [dry-run] prefix, FIXED/WARN/INFO labels,
 *       totals footer
 *   (j) emitJson — envelope with project/scope/bundle/fixApplied/files
 *   (k) --fix and --format flags surfaced via self.params
 *   (l) framework-side config.js NOT modified — deliberately CLI-only
 *   (m) help.txt + arguments.json — `migrate` section, --fix registered
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var MIGRATE_SOURCE = path.join(require('../fw'), 'lib/cmd/connector/migrate.js');
var HELP_TXT       = path.join(require('../fw'), 'lib/cmd/connector/help.txt');
var ARGS_FILE      = path.join(require('../fw'), 'lib/cmd/connector/arguments.json');
var CONFIG_SOURCE  = path.join(require('../fw'), 'core/config.js');
var CLI_SOURCE     = path.join(__dirname, '..', '..', 'bin', 'cli');
var SCHEMA_FILE    = path.join(__dirname, '..', '..', 'schema', 'connectors.json');

var src       = fs.readFileSync(MIGRATE_SOURCE, 'utf8');
var helpTxt   = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr   = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var configSrc = fs.readFileSync(CONFIG_SOURCE, 'utf8');
var cliSrc    = fs.readFileSync(CLI_SOURCE, 'utf8');
var schema    = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Migrate constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Migrate;?/);
    });

    it('declares a function Migrate(opt, cmd)', function () {
        assert.match(src, /function\s+Migrate\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('wires CmdHelper with opt.client and debug flags', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
    });

    it('gates on isCmdConfigured()', function () {
        assert.match(src, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
    });

    it('uses fs + path from Node.js', function () {
        assert.match(src, /var fs\s*=\s*require\('fs'\);/);
        assert.match(src, /var path\s*=\s*require\('path'\);/);
    });

    it('uses lib.logger as console', function () {
        assert.match(src, /var console\s*=\s*lib\.logger;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — Positional extraction
// ---------------------------------------------------------------------------

describe('02 - positional extraction', function () {

    it('declares extractPositionals(argv)', function () {
        assert.match(src, /var extractPositionals\s*=\s*function \(argv\) \{/);
    });

    it('iterates from index 3 (past node + bin + task)', function () {
        assert.match(src, /for \(var i = 3, len = argv\.length; i < len; i\+\+\)/);
    });

    it('skips `--flag` tokens', function () {
        assert.match(src, /if \(\s*\/\^\\-\\-\/\.test\(tok\)\s*\) continue;/);
    });

    it('skips `-flag` short tokens', function () {
        assert.match(src, /if \(\s*\/\^\\-\/\.test\(tok\)\s*\) continue;/);
    });

    it('skips `@project` tokens', function () {
        assert.match(src, /if \(\s*\/\^\\@\/\.test\(tok\)\s*\) continue;/);
    });

    it('bundle name is positionals[0] (null when absent)', function () {
        assert.match(src, /var bundleName\s*= positionals\[0\] \|\| null;/);
    });
});


// ---------------------------------------------------------------------------
// 03 — ALLOWED_CONNECTOR_TYPES (schema enum mirror)
// ---------------------------------------------------------------------------

describe('03 - schema enum mirror', function () {

    it('declares ALLOWED_CONNECTOR_TYPES', function () {
        assert.match(src, /var ALLOWED_CONNECTOR_TYPES\s*=\s*\[/);
    });

    it('ALLOWED_CONNECTOR_TYPES contains the six schema enum values', function () {
        assert.match(src, /'couchbase'/);
        assert.match(src, /'mysql'/);
        assert.match(src, /'postgresql'/);
        assert.match(src, /'sqlite'/);
        assert.match(src, /'redis'/);
        assert.match(src, /'ai'/);
    });

    it('schema/connectors.json enum is still the source of truth', function () {
        var enumValues = schema.definitions.connector.properties.connector.enum;
        assert.deepStrictEqual(enumValues.sort(), ['ai', 'couchbase', 'mysql', 'postgresql', 'redis', 'sqlite']);
    });
});


// ---------------------------------------------------------------------------
// 04 — SCHEMA_URL constant
// ---------------------------------------------------------------------------

describe('04 - SCHEMA_URL', function () {

    it('declares SCHEMA_URL', function () {
        assert.match(src, /var SCHEMA_URL\s*=\s*'https:\/\/gina\.io\/schema\/connectors\.json';/);
    });

    it('uses the canonical gina.io URL (matches add.js::mergeEntry)', function () {
        assert.match(src, /'https:\/\/gina\.io\/schema\/connectors\.json'/);
    });
});


// ---------------------------------------------------------------------------
// 05 — loadManifest
// ---------------------------------------------------------------------------

describe('05 - loadManifest', function () {

    it('declares loadManifest(projectPath)', function () {
        assert.match(src, /var loadManifest\s*=\s*function \(projectPath\) \{/);
    });

    it('reads <projectPath>/manifest.json via requireJSON', function () {
        assert.match(src, /return requireJSON\(p\);/);
    });

    it('returns null on missing file', function () {
        assert.match(src, /if \(\s*!fs\.existsSync\(p\)\s*\) return null;/);
    });

    it('swallows parse errors and returns null', function () {
        assert.match(src, /try\s*\{[\s\S]*?return requireJSON\(p\);[\s\S]*?\}\s*catch \(e\) \{\s*return null;/);
    });
});


// ---------------------------------------------------------------------------
// 06 — resolveTargets
// ---------------------------------------------------------------------------

describe('06 - resolveTargets', function () {

    it('declares resolveTargets(projectPath, manifest, bundleName)', function () {
        assert.match(src, /var resolveTargets\s*=\s*function \(projectPath, manifest, bundleName\) \{/);
    });

    it('resolves shared path as the first target when no bundle passed', function () {
        assert.match(src, /projectPath \+ '\/shared\/config\/connectors\.json'/);
    });

    it('reads manifest.bundles for bundle-scoped migrate', function () {
        assert.match(src, /manifest\.bundles\[bundleName\]/);
    });

    it('resolves <bundle-src>/config/connectors.json from manifest.src', function () {
        assert.match(src, /var bundleSrc = manifest\.bundles\[bundleName\]\.src;/);
        assert.match(src, /projectPath \+ '\/' \+ bundleSrc \+ '\/config\/connectors\.json'/);
    });

    it('errors when the bundle is not registered in the manifest', function () {
        assert.match(src, /is not registered inside `@/);
    });

    it('iterates every bundle in the manifest for project scope', function () {
        assert.match(src, /var bundleNames = Object\.keys\(manifest\.bundles\);/);
    });

    it('skips bundles without manifest.src during enumeration', function () {
        assert.match(src, /if \(!bSrc\) continue;/);
    });
});


// ---------------------------------------------------------------------------
// 07 — scanFile checks
// ---------------------------------------------------------------------------

describe('07 - scanFile', function () {

    it('declares scanFile(filePath, bundleName)', function () {
        assert.match(src, /var scanFile\s*=\s*function \(filePath, bundleName\) \{/);
    });

    it('returns a Report shape with issues + fixable + fixed + parsed + header', function () {
        assert.match(src, /issues\s*:\s*\[\]/);
        assert.match(src, /fixable\s*:\s*\[\]/);
        assert.match(src, /fixed\s*:\s*\[\]/);
        assert.match(src, /parsed\s*:\s*null/);
        assert.match(src, /header\s*:\s*''/);
    });

    it('short-circuits with exists=false when the file is absent', function () {
        assert.match(src, /exists\s*:\s*fs\.existsSync\(filePath\)/);
        assert.match(src, /if \(!report\.exists\) return report;/);
    });

    it('captures the raw text before the first `{` as the header', function () {
        assert.match(src, /var firstBrace = raw\.indexOf\('\{'\);/);
        assert.match(src, /report\.header = \(firstBrace > 0\) \? raw\.slice\(0, firstBrace\) : '';/);
    });

    it('parses the body with requireJSON for comment tolerance', function () {
        assert.match(src, /data = requireJSON\(filePath\) \|\| \{\};/);
    });

    it('records parseError on read or parse failure', function () {
        assert.match(src, /report\.parseError = 'read failed: '/);
        assert.match(src, /report\.parseError = 'parse failed: '/);
    });

    it('counts connectors excluding the $schema key', function () {
        assert.match(src, /if \(k === '\$schema'\) continue;/);
        assert.match(src, /report\.connectorCount\+\+;/);
    });

    it('pushes `missing-schema` when data.$schema is undefined', function () {
        assert.match(src, /type\s*:\s*'missing-schema'/);
        assert.match(src, /severity\s*:\s*'info'/);
        assert.match(src, /fixable\s*:\s*true/);
    });

    it('registers missing-schema on both report.issues and report.fixable', function () {
        assert.match(src, /report\.issues\.push\(schemaIssue\);/);
        assert.match(src, /report\.fixable\.push\(schemaIssue\);/);
    });

    it('pushes `bare-key-no-connector` when entry has no connector field and key is not in enum', function () {
        assert.match(src, /type\s*:\s*'bare-key-no-connector'/);
        assert.match(src, /severity\s*:\s*'warn'/);
    });

    it('bare-key-no-connector is NOT auto-fixable', function () {
        // The bare-key issue explicitly declares fixable: false
        assert.match(src, /type\s*:\s*'bare-key-no-connector'[\s\S]*?fixable\s*:\s*false/);
    });

    it('bare-key-no-connector references the built-in enum in the message', function () {
        assert.match(src, /is not in the built-in enum \(' \+ ALLOWED_CONNECTOR_TYPES\.join\(', '\) \+ '\)/);
    });

    it('bare-key-no-connector suggests `gina connector:add … --force` as the manual fix', function () {
        assert.match(src, /gina connector:add.*?--connector=<type> --force/);
    });

    it('skips the $schema key during entry iteration', function () {
        // Second loop body: for (var name in data) { if (name === '$schema') continue; ... }
        var iterMatches = src.match(/if \(name === '\$schema'\) continue;/g) || [];
        assert.ok(iterMatches.length >= 1, 'entry-iteration loop must skip $schema');
    });
});


// ---------------------------------------------------------------------------
// 08 — applyFixes
// ---------------------------------------------------------------------------

describe('08 - applyFixes', function () {

    it('declares applyFixes(report)', function () {
        assert.match(src, /var applyFixes\s*=\s*function \(report\) \{/);
    });

    it('only acts on missing-schema (the only fixable today)', function () {
        assert.match(src, /if \(report\.fixable\[i\]\.type === 'missing-schema'\)/);
    });

    it('pins $schema at the top of the output object', function () {
        assert.match(src, /var out = \{ \$schema: SCHEMA_URL \};/);
    });

    it('preserves every existing key in its original order', function () {
        assert.match(src, /for \(var k in report\.parsed\) \{\s*if \(k === '\$schema'\) continue;\s*out\[k\] = report\.parsed\[k\];/);
    });

    it('serialises body with JSON.stringify(out, null, 4)', function () {
        assert.match(src, /var body = JSON\.stringify\(out, null, 4\);/);
    });

    it('concatenates preserved header + body + trailing newline', function () {
        assert.match(src, /var text = \(report\.header \|\| ''\) \+ body \+ '\\n';/);
    });

    it('routes writes through lib.generator.createFileFromDataSync', function () {
        assert.match(src, /lib\.generator\.createFileFromDataSync\(text, report\.path\);/);
    });

    it('moves applied issues off fixable onto fixed', function () {
        assert.match(src, /report\.fixed\s*=\s*report\.fixed\.concat\(applied\);/);
        assert.match(src, /report\.fixable = report\.fixable\.filter/);
    });

    it('removes applied issues from report.issues so the final count is accurate', function () {
        assert.match(src, /report\.issues\s*=\s*report\.issues\.filter/);
    });
});


// ---------------------------------------------------------------------------
// 09 — emitText
// ---------------------------------------------------------------------------

describe('09 - emitText', function () {

    it('declares emitText(reports, fix)', function () {
        assert.match(src, /var emitText\s*=\s*function \(reports, fix\) \{/);
    });

    it('uses `[fix]` prefix when --fix is active, `[dry-run]` otherwise', function () {
        assert.match(src, /var prefix\s*=\s*fix \? '\[fix\]' : '\[dry-run\]';/);
    });

    it('labels each file with `shared` or the bundle name', function () {
        assert.match(src, /var label\s*=\s*r\.bundle \? \('bundle `' \+ r\.bundle \+ '`'\) : 'shared';/);
    });

    it('handles missing files with a "missing (skipped)" line', function () {
        assert.match(src, /— missing \(skipped\)/);
    });

    it('surfaces parseError inline', function () {
        assert.match(src, /r\.parseError/);
    });

    it('emits FIXED lines for resolved issues', function () {
        assert.match(src, /FIXED  /);
    });

    it('emits WARN for warn-severity issues, INFO otherwise', function () {
        assert.match(src, /\(iss\.severity === 'warn'\) \? 'WARN '/);
    });

    it('suggests `--fix` in the footer when there are fixable issues in dry-run', function () {
        assert.match(src, /Re-run with --fix to apply /);
    });

    it('prints applied-fix count in the footer when --fix ran', function () {
        assert.match(src, /Applied ' \+ totalFixed \+ ' fix\(es\)\./);
    });
});


// ---------------------------------------------------------------------------
// 10 — emitJson
// ---------------------------------------------------------------------------

describe('10 - emitJson', function () {

    it('declares emitJson(reports, bundleName, fix)', function () {
        assert.match(src, /var emitJson\s*=\s*function \(reports, bundleName, fix\) \{/);
    });

    it('wraps file reports in a {project, scope, bundle, fixApplied, files} envelope', function () {
        assert.match(src, /project\s*:\s*self\.projectName/);
        assert.match(src, /scope\s*:\s*bundleName \? 'bundle' : 'project'/);
        assert.match(src, /bundle\s*:\s*bundleName/);
        assert.match(src, /fixApplied\s*:\s*fix/);
        assert.match(src, /files\s*:\s*files/);
    });

    it('serialises with JSON.stringify(..., null, 2) for readability', function () {
        assert.match(src, /JSON\.stringify\([\s\S]*?null, 2\)/);
    });

    it('exposes issues + fixed + connectorCount + parseError per file', function () {
        assert.match(src, /issues\s*:\s*r\.issues/);
        assert.match(src, /fixed\s*:\s*r\.fixed/);
        assert.match(src, /connectorCount\s*:\s*r\.connectorCount/);
        assert.match(src, /parseError\s*:\s*r\.parseError/);
    });
});


// ---------------------------------------------------------------------------
// 11 — Flags surfaced via self.params
// ---------------------------------------------------------------------------

describe('11 - flag parsing', function () {

    it('reads --fix from self.params', function () {
        assert.match(src, /var fix\s*=\s*!!p\['fix'\];/);
    });

    it('reads --format from self.params', function () {
        assert.match(src, /var format\s*=\s*p\['format'\] \|\| null;/);
    });

    it('rejects unknown --format values explicitly', function () {
        assert.match(src, /Unknown --format value /);
        assert.match(src, /Supported: json\./);
    });

    it('--format=json activates the asJson branch', function () {
        assert.match(src, /var asJson\s*=\s*\(format === 'json'\);/);
    });
});


// ---------------------------------------------------------------------------
// 12 — Error paths + exit codes
// ---------------------------------------------------------------------------

describe('12 - error paths', function () {

    it('requires @<project>', function () {
        assert.match(src, /requires `@<project>`/);
    });

    it('errors when the requested project is not registered', function () {
        assert.match(src, /is not registered\. Run `gina project:list`/);
    });

    it('errors when manifest.json cannot be read', function () {
        assert.match(src, /Cannot read `' \+ projectPath \+ '\/manifest\.json`/);
    });

    it('exits 0 on success', function () {
        assert.match(src, /process\.exit\(0\);/);
    });

    it('has at least four process.exit(1) sites (project/manifest/bundle/format)', function () {
        var exit1Count = (src.match(/process\.exit\(1\)/g) || []).length;
        assert.ok(exit1Count >= 4, 'expected ≥4 process.exit(1) sites, got ' + exit1Count);
    });
});


// ---------------------------------------------------------------------------
// 13 — Framework-side config.js is NOT modified (narrower C decision)
// ---------------------------------------------------------------------------

describe('13 - framework hook absent (narrower C scope)', function () {

    it('core/config.js does NOT import connector/migrate', function () {
        assert.ok(configSrc.indexOf('connector/migrate') === -1, 'config.js must not reference connector/migrate');
        assert.ok(configSrc.indexOf("require('./cmd/connector/migrate')") === -1, 'config.js must not require the migrate cmd');
    });

    it('core/config.js does NOT check GINA_NO_AUTO_MIGRATE (no runtime hook)', function () {
        assert.ok(configSrc.indexOf('GINA_NO_AUTO_MIGRATE') === -1, 'no GINA_NO_AUTO_MIGRATE env var — defer the hook to 0.4.0');
    });

    it('migrate.js documents the "no runtime hook" rationale in its header', function () {
        assert.match(src, /framework[\s\S]{0,40}NOT modified|no runtime auto-migration hook|CLI-only/);
    });
});


// ---------------------------------------------------------------------------
// 14 — help.txt + arguments.json + bin/cli registration
// ---------------------------------------------------------------------------

describe('14 - help.txt + arguments.json', function () {

    it('help.txt documents the `migrate` action', function () {
        assert.match(helpTxt, /migrate @<project>/);
        assert.match(helpTxt, /migrate <bundle> @<project>/);
    });

    it('help.txt has an Options (migrate) section', function () {
        assert.match(helpTxt, /Options \(migrate\)/);
    });

    it('help.txt documents --fix under migrate', function () {
        assert.match(helpTxt, /--fix\s+Apply auto-fixable issues/);
    });

    it('help.txt documents --format=json under migrate', function () {
        assert.match(helpTxt, /--format=json/);
    });

    it('help.txt documents the two check types', function () {
        assert.match(helpTxt, /missing-schema/);
        assert.match(helpTxt, /bare-key-no-connector/);
    });

    it('help.txt documents the "explicit, no auto-migrate" stance', function () {
        assert.match(helpTxt, /does NOT\s*\n?\s*auto-migrate/);
    });

    it('help.txt includes at least one migrate example', function () {
        assert.match(helpTxt, /gina connector:migrate /);
    });

    it('arguments.json registers --fix', function () {
        assert.ok(argsArr.indexOf('--fix') > -1, '--fix must be registered in arguments.json');
    });

    it('arguments.json still registers --format', function () {
        assert.ok(argsArr.indexOf('--format') > -1, '--format must be registered in arguments.json');
    });

    it('arguments.json does NOT register `--port` or `--version` (reserved framework flags)', function () {
        assert.strictEqual(argsArr.indexOf('--port'), -1);
        assert.strictEqual(argsArr.indexOf('--version'), -1);
    });

    it('bin/cli registers `connector:` in allowedOffline', function () {
        assert.match(cliSrc, /allowedOffline\s*=\s*\[[\s\S]*?'connector:'[\s\S]*?\]/);
    });
});
