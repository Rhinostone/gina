/**
 * lib/cmd/connector/remove.js — positional parsing, target resolution,
 * existence guard, cross-bundle usage detection, project-level --force
 * gate, dry-run preview, key-ordered in-place removal, driver-retention
 * hint, rm.js alias.
 *
 * Source-inspection tests (same style as connector-list.test.js,
 * connector-add.test.js): remove.js runs inside the CLI daemon context
 * (CmdHelper, project registry, globals injected by gna.js). Replicating
 * that is heavy for near-zero extra coverage, so these assertions prove
 * the source structure of:
 *
 *   (a) module shape + CmdHelper wiring + isCmdConfigured gate
 *   (b) positional extraction — argv[3..], skips flags/@/dash tokens
 *   (c) ALLOWED_CONNECTOR_TYPES mirror (schema enum)
 *   (d) resolveConnectorType — lenient entry.connector-vs-key fallback
 *   (e) scanSiblings — shared + bundle scan, sameKey + sameDriver
 *   (f) target resolution — shared vs bundle path, manifest.bundles lookup
 *   (g) readExistingFile — must exist (errors when missing), header-before-
 *       first-brace capture, requireJSON for comment tolerance
 *   (h) existence guard — inherited-from-shared hint when bundle-level rm
 *       finds no entry but shared has one
 *   (i) project-level --force gate — refuses to remove shared while any
 *       bundle still references the key, unless --force is passed
 *   (j) dry-run — prints preview + sibling warnings, does NOT call
 *       writeFile
 *   (k) removeKey — preserves $schema at top + remaining key order
 *   (l) writeFile — delegates to lib.generator.createFileFromDataSync,
 *       trailing newline, header concatenated verbatim
 *   (m) buildDriverRetentionHint — names siblings still using the driver,
 *       sqlite short-circuits (built-in)
 *   (n) help.txt + arguments.json — `rm` section, --dry-run registered
 *   (o) rm.js alias shape
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var RM_SOURCE     = path.join(require('../fw'), 'lib/cmd/connector/remove.js');
var ALIAS_SOURCE  = path.join(require('../fw'), 'lib/cmd/connector/rm.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/connector/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/connector/arguments.json');
var CLI_SOURCE    = path.join(__dirname, '..', '..', 'bin', 'cli');
var SCHEMA_FILE   = path.join(__dirname, '..', '..', 'schema', 'connectors.json');

var src      = fs.readFileSync(RM_SOURCE, 'utf8');
var aliasSrc = fs.readFileSync(ALIAS_SOURCE, 'utf8');
var helpTxt  = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr  = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc   = fs.readFileSync(CLI_SOURCE, 'utf8');
var schema   = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Remove constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Remove;?/);
    });

    it('declares a function Remove(opt, cmd)', function () {
        assert.match(src, /function\s+Remove\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
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

    it('connector name is positionals[0], bundle is positionals[1]', function () {
        assert.match(src, /var connectorName = positionals\[0\] \|\| null;/);
        assert.match(src, /var bundleName\s*= positionals\[1\] \|\| null;/);
    });

    it('validates connector name against [a-zA-Z0-9_-]', function () {
        assert.match(src, /\/\^\[a-z0-9_\\\-\]\+\$\/i\.test\(connectorName\)/);
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
// 04 — Target resolution
// ---------------------------------------------------------------------------

describe('04 - resolveTarget', function () {

    it('declares resolveTarget(projectPath, manifest, bundleName)', function () {
        assert.match(src, /var resolveTarget\s*=\s*function \(projectPath, manifest, bundleName\) \{/);
    });

    it('resolves shared path when no bundle passed', function () {
        assert.match(src, /projectPath \+ '\/shared\/config\/connectors\.json'/);
    });

    it('reads manifest.bundles for bundle-scoped rm', function () {
        assert.match(src, /manifest\.bundles\[bundleName\]/);
    });

    it('resolves <bundle-src>/config/connectors.json from manifest.src', function () {
        assert.match(src, /var bundleSrc = manifest\.bundles\[bundleName\]\.src;/);
        assert.match(src, /projectPath \+ '\/' \+ bundleSrc \+ '\/config\/connectors\.json'/);
    });

    it('errors when the bundle is not registered in the manifest', function () {
        assert.match(src, /is not registered inside `@/);
    });

    it('errors when manifest.json cannot be read', function () {
        assert.match(src, /Cannot read `' \+ projectPath \+ '\/manifest\.json`/);
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
// 06 — readExistingFile (rm-specific: must exist)
// ---------------------------------------------------------------------------

describe('06 - readExistingFile', function () {

    it('declares readExistingFile(target)', function () {
        assert.match(src, /var readExistingFile\s*=\s*function \(target\) \{/);
    });

    it('errors when the target file does not exist (nothing to remove)', function () {
        assert.match(src, /does not exist — nothing to remove/);
    });

    it('captures the raw text before the first `{` as the header', function () {
        assert.match(src, /var firstBrace = raw\.indexOf\('\{'\);/);
        assert.match(src, /var header\s*= \(firstBrace > 0\) \? raw\.slice\(0, firstBrace\) : '';/);
    });

    it('parses the body with requireJSON for comment tolerance', function () {
        assert.match(src, /data = requireJSON\(target\) \|\| \{\};/);
    });

    it('errors on parse failure', function () {
        assert.match(src, /Cannot parse `/);
    });

    it('errors on read failure with the underlying error message', function () {
        assert.match(src, /Cannot read `' \+ target \+ '`: ' \+ e\.message/);
    });
});


// ---------------------------------------------------------------------------
// 07 — resolveConnectorType (lenient driver-type fallback)
// ---------------------------------------------------------------------------

describe('07 - resolveConnectorType', function () {

    it('declares resolveConnectorType(entry, key)', function () {
        assert.match(src, /var resolveConnectorType\s*=\s*function \(entry, key\) \{/);
    });

    it('prefers entry.connector when it is a string', function () {
        assert.match(src, /if \(entry && typeof entry\.connector == 'string'\) return entry\.connector;/);
    });

    it('falls back to the logical key', function () {
        assert.match(src, /return key;/);
    });
});


// ---------------------------------------------------------------------------
// 08 — Existence guard + "inherited from shared" hint
// ---------------------------------------------------------------------------

describe('08 - existence guard', function () {

    it('exits 1 with a "not found" message when entry missing in target', function () {
        assert.match(src, /Connector `' \+ connectorName \+ '` not found in/);
    });

    it('points bundle-level rm at the shared file when entry only lives in shared', function () {
        assert.match(src, /inherited from shared\/config\/connectors\.json/);
        assert.match(src, /Use `gina connector:rm/);
    });

    it('reads shared/config/connectors.json for the inherited-hint check', function () {
        assert.match(src, /projectPath \+ '\/shared\/config\/connectors\.json'/);
    });
});


// ---------------------------------------------------------------------------
// 09 — scanSiblings (cross-bundle usage detection)
// ---------------------------------------------------------------------------

describe('09 - scanSiblings', function () {

    it('declares scanSiblings(projectPath, manifest, connectorName, driverType, excludeBundle)', function () {
        assert.match(src, /var scanSiblings\s*=\s*function \(projectPath, manifest, connectorName, driverType, excludeBundle\) \{/);
    });

    it('returns { sameKey: [], sameDriver: [] } lists', function () {
        assert.match(src, /var sameKey\s*= \[\];/);
        assert.match(src, /var sameDriver\s*= \[\];/);
        assert.match(src, /return \{ sameKey: sameKey, sameDriver: sameDriver \};/);
    });

    it('skips the excludeBundle during iteration', function () {
        assert.match(src, /if \(excludeBundle && bName === excludeBundle\) continue;/);
    });

    it('tags sameKey entries with source `override` when shared also declares it', function () {
        assert.match(src, /var source = \(typeof sharedJson\[bk\] != 'undefined'\) \? 'override' : 'bundle';/);
    });

    it('records driver-type usages under sameDriver', function () {
        assert.match(src, /if \(bDriver === driverType && bk !== connectorName\)/);
        assert.match(src, /sameDriver\.push/);
    });

    it('reads shared/config/connectors.json when excludeBundle is set (bundle-scoped rm)', function () {
        assert.match(src, /if \(excludeBundle\) \{[\s\S]*?for \(var sk in sharedJson\)/);
    });
});


// ---------------------------------------------------------------------------
// 10 — Project-level --force gate
// ---------------------------------------------------------------------------

describe('10 - project-level --force gate', function () {

    it('refuses to remove shared when siblings.sameKey is non-empty without --force', function () {
        assert.match(src, /if \(!bundleName && siblings\.sameKey\.length > 0 && !force\)/);
    });

    it('lists the affected bundles in the error message', function () {
        assert.match(src, /would break ' \+ siblings\.sameKey\.length \+ ' bundle\(s\)/);
    });

    it('suggests --force or per-bundle removal as the remediation', function () {
        assert.match(src, /Re-run with --force to remove anyway, or remove from each bundle first/);
    });
});


// ---------------------------------------------------------------------------
// 11 — Dry-run
// ---------------------------------------------------------------------------

describe('11 - dry-run', function () {

    it('reads --dry-run from self.params', function () {
        assert.match(src, /var dryRun\s*=\s*!!p\['dry-run'\];/);
    });

    it('reads --force from self.params', function () {
        assert.match(src, /var force\s*=\s*!!p\['force'\];/);
    });

    it('declares printDryRun(target, connectorName, entry, bundleName, siblings)', function () {
        assert.match(src, /var printDryRun\s*=\s*function \(target, connectorName, entry, bundleName, siblings\) \{/);
    });

    it('prefixes preview lines with [dry-run]', function () {
        assert.match(src, /\[dry-run\] Would remove connector/);
        assert.match(src, /\[dry-run\] Current entry/);
    });

    it('warns about sibling usages at project level', function () {
        assert.match(src, /\[dry-run\] Warning: ' \+ siblings\.sameKey\.length \+ ' bundle\(s\) still reference/);
    });

    it('dry-run short-circuits before writeFile', function () {
        assert.match(src, /if \(dryRun\)\s*\{\s*printDryRun\(/);
        assert.match(src, /process\.exit\(0\);/);
    });
});


// ---------------------------------------------------------------------------
// 12 — removeKey (key-ordered in-place removal)
// ---------------------------------------------------------------------------

describe('12 - removeKey', function () {

    it('declares removeKey(existing, connectorName)', function () {
        assert.match(src, /var removeKey\s*=\s*function \(existing, connectorName\) \{/);
    });

    it('preserves $schema at the top when present', function () {
        assert.match(src, /if \(existing\.\$schema\)\s*\{\s*out\.\$schema = existing\.\$schema;/);
    });

    it('skips $schema and the removed key during iteration', function () {
        assert.match(src, /for \(var k in existing\) \{\s*if \(k === '\$schema'\) continue;/);
        assert.match(src, /if \(k === connectorName\) continue;/);
    });

    it('copies every other key through unchanged', function () {
        assert.match(src, /out\[k\] = existing\[k\];/);
    });
});


// ---------------------------------------------------------------------------
// 13 — writeFile (header + body + trailing newline)
// ---------------------------------------------------------------------------

describe('13 - writeFile', function () {

    it('declares writeFile(target, header, data)', function () {
        assert.match(src, /var writeFile\s*=\s*function \(target, header, data\) \{/);
    });

    it('serialises body with JSON.stringify(data, null, 4)', function () {
        assert.match(src, /var body = JSON\.stringify\(data, null, 4\);/);
    });

    it('concatenates header + body + trailing newline', function () {
        assert.match(src, /var text\s*=\s*\(header \|\| ''\) \+ body \+ '\\n';/);
    });

    it('routes writes through lib.generator.createFileFromDataSync', function () {
        assert.match(src, /lib\.generator\.createFileFromDataSync\(text, target\);/);
    });
});


// ---------------------------------------------------------------------------
// 14 — buildDriverRetentionHint (driver-not-uninstalled note)
// ---------------------------------------------------------------------------

describe('14 - buildDriverRetentionHint', function () {

    it('declares buildDriverRetentionHint(driverType, connectorName, bundleName, siblings)', function () {
        assert.match(src, /var buildDriverRetentionHint\s*=\s*function \(driverType, connectorName, bundleName, siblings\) \{/);
    });

    it('says "gina does not uninstall npm packages" on every path', function () {
        var matches = src.match(/gina does not uninstall npm packages/g) || [];
        assert.ok(matches.length >= 2, 'expected ≥2 retention-note strings, got ' + matches.length);
    });

    it('sqlite short-circuits (built-in; nothing to uninstall)', function () {
        assert.match(src, /if \(driverType === 'sqlite'\)\s*\{\s*return null;/);
    });

    it('names siblings still using the driver in the hint', function () {
        assert.match(src, /Driver `' \+ driverType \+ '` is still referenced by:/);
    });

    it('invites `npm uninstall` when nothing else uses the driver', function () {
        assert.match(src, /you can `npm uninstall` it yourself/);
    });
});


// ---------------------------------------------------------------------------
// 15 — Error paths + exit codes
// ---------------------------------------------------------------------------

describe('15 - error paths', function () {

    it('requires @<project>', function () {
        assert.match(src, /requires `@<project>`/);
    });

    it('errors when the requested project is not registered', function () {
        assert.match(src, /is not registered\. Run `gina project:list`/);
    });

    it('prints a usage message when <name> is missing', function () {
        assert.match(src, /Usage: gina connector:rm <name>/);
    });

    it('exits 0 on success and 1 on every error', function () {
        assert.match(src, /process\.exit\(0\);/);
        var exit1Count = (src.match(/process\.exit\(1\)/g) || []).length;
        assert.ok(exit1Count >= 5, 'expected ≥5 process.exit(1) sites, got ' + exit1Count);
    });

    it('prints a distinct "Removed" success message', function () {
        assert.match(src, /Removed connector `/);
    });
});


// ---------------------------------------------------------------------------
// 16 — help.txt + arguments.json + bin/cli registration
// ---------------------------------------------------------------------------

describe('16 - help.txt + arguments.json', function () {

    it('help.txt documents the `rm` action', function () {
        assert.match(helpTxt, /rm <name> @<project>/);
        assert.match(helpTxt, /rm <name> <bundle> @<project>/);
    });

    it('help.txt lists `remove` as an alias for rm', function () {
        assert.match(helpTxt, /remove\s+Alias for rm/);
    });

    it('help.txt documents --dry-run and --force under rm', function () {
        assert.match(helpTxt, /Options \(rm\)/);
        assert.match(helpTxt, /--dry-run/);
        assert.match(helpTxt, /--force\s+Skip the project-level guard/);
    });

    it('help.txt documents the "driver NOT uninstalled" invariant', function () {
        assert.match(helpTxt, /never uninstalls the npm driver/);
    });

    it('help.txt includes at least one rm example', function () {
        assert.match(helpTxt, /gina connector:rm /);
    });

    it('arguments.json registers --dry-run', function () {
        assert.ok(argsArr.indexOf('--dry-run') > -1, '--dry-run must be registered in arguments.json');
    });

    it('arguments.json does NOT register `--port` or `--version` (reserved framework flags)', function () {
        assert.strictEqual(argsArr.indexOf('--port'), -1);
        assert.strictEqual(argsArr.indexOf('--version'), -1);
    });

    it('bin/cli registers `connector:` in allowedOffline', function () {
        assert.match(cliSrc, /allowedOffline\s*=\s*\[[\s\S]*?'connector:'[\s\S]*?\]/);
    });
});


// ---------------------------------------------------------------------------
// 17 — rm.js alias
// ---------------------------------------------------------------------------

describe('17 - rm.js alias', function () {

    it('rm.js re-exports remove.js', function () {
        assert.match(aliasSrc, /module\.exports\s*=\s*require\('\.\/remove'\);?/);
    });

    it('rm.js is a one-liner alias (not a duplicate implementation)', function () {
        var nonEmptyLines = aliasSrc.split('\n').filter(function (l) {
            var t = l.trim();
            return t && !/^\/\//.test(t) && !/^\/\*/.test(t) && !/^\*/.test(t) && !/^\*\//.test(t);
        });
        assert.ok(nonEmptyLines.length <= 3, 'rm.js should be ≤3 code lines (alias + export), got ' + nonEmptyLines.length);
    });
});
