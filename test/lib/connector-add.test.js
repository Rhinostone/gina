/**
 * lib/cmd/connector/add.js — positional parsing, connector type resolution,
 * target file resolution, entry building, comment-header preservation,
 * key-ordered merge, install-hint printing.
 *
 * Source-inspection tests (same style as connector-list.test.js): add.js
 * runs inside the CLI daemon context (CmdHelper, project registry, globals
 * injected by gna.js). Replicating that is heavy for near-zero extra
 * coverage, so these assertions prove the source structure of:
 *
 *   (a) module shape + CmdHelper wiring + isCmdConfigured gate
 *   (b) positional extraction — argv[3..], skips flags/@/dash tokens
 *   (c) ALLOWED_CONNECTOR_TYPES + ALLOWED_SCOPES (mirror schema enums)
 *   (d) DRIVER_MAP + AI_DRIVER_MAP (mirror list.js, kept in sync by hand)
 *   (e) connector type inference — infer from <name> when it matches enum,
 *       --driver= synonym for --connector=, reject unknown types
 *   (f) target resolution — shared vs bundle path, manifest.bundles lookup
 *   (g) buildEntry — flag-to-entry mapping, scope enum validation,
 *       `connector` omitted when type matches the logical name,
 *       port cast to Number when numeric
 *   (h) readExistingFile — existence check, header-before-first-brace
 *       capture, requireJSON for comment tolerance, parent-dir exists check
 *   (i) mergeEntry — $schema pinned first, existing key order preserved,
 *       overwrite replaces in place, new entry appended
 *   (j) writeFile — delegates to lib.generator.createFileFromDataSync,
 *       trailing newline, header concatenated verbatim
 *   (k) buildInstallHint — AI resolves from protocol scheme, entry.version
 *       pin overrides peerDeps range, sqlite reports built-in note
 *   (l) error paths — missing project, unregistered project, invalid bundle,
 *       existing entry without --force, invalid scope/type
 *   (m) help.txt + arguments.json — `add` section, all flags registered
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var ADD_SOURCE  = path.join(require('../fw'), 'lib/cmd/connector/add.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/connector/help.txt');
var ARGS_FILE   = path.join(require('../fw'), 'lib/cmd/connector/arguments.json');
var CLI_SOURCE  = path.join(__dirname, '..', '..', 'bin', 'cli');
var SCHEMA_FILE = path.join(__dirname, '..', '..', 'schema', 'connectors.json');

var src     = fs.readFileSync(ADD_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc  = fs.readFileSync(CLI_SOURCE, 'utf8');
var schema  = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Add constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Add;?/);
    });

    it('declares a function Add(opt, cmd)', function () {
        assert.match(src, /function\s+Add\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
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
// 03 — ALLOWED_CONNECTOR_TYPES + ALLOWED_SCOPES (schema enum mirrors)
// ---------------------------------------------------------------------------

describe('03 - schema enum mirrors', function () {

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

    it('declares ALLOWED_SCOPES', function () {
        assert.match(src, /var ALLOWED_SCOPES\s*=\s*\[\s*'local',\s*'beta',\s*'production',\s*'testing'\s*\]/);
    });

    it('schema/connectors.json enum is the source of truth', function () {
        var enumValues = schema.definitions.connector.properties.connector.enum;
        assert.deepStrictEqual(enumValues.sort(), ['ai', 'couchbase', 'mysql', 'postgresql', 'redis', 'sqlite']);
    });

    it('schema scope enum is [local, beta, production, testing]', function () {
        var scopes = schema.definitions.connector.properties.scope.enum;
        assert.deepStrictEqual(scopes.sort(), ['beta', 'local', 'production', 'testing']);
    });

    it('schema declares a `version` property (new in session 2)', function () {
        assert.ok(schema.definitions.connector.properties.version, '`version` property must exist on the connector schema');
        assert.strictEqual(schema.definitions.connector.properties.version.type, 'string');
    });
});


// ---------------------------------------------------------------------------
// 04 — DRIVER_MAP + AI_DRIVER_MAP
// ---------------------------------------------------------------------------

describe('04 - DRIVER_MAP', function () {

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

    it('flags sqlite as builtin (node:sqlite)', function () {
        assert.match(src, /sqlite\s*:\s*\{[^}]*builtin:\s*true[^}]*\}/);
        assert.match(src, /node:sqlite/);
    });
});


describe('05 - AI_DRIVER_MAP', function () {

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
// 06 — Connector type inference
// ---------------------------------------------------------------------------

describe('06 - connector type inference', function () {

    it('reads --connector=<type> from self.params', function () {
        assert.match(src, /var connectorType = p\['connector'\] \|\| p\['driver'\] \|\| null;/);
    });

    it('--driver= is a synonym for --connector=', function () {
        assert.match(src, /p\['connector'\] \|\| p\['driver'\]/);
    });

    it('infers type from <name> when name matches an allowed type', function () {
        assert.match(src, /if \(!connectorType && ALLOWED_CONNECTOR_TYPES\.indexOf\(connectorName\) > -1\)/);
        assert.match(src, /connectorType = connectorName;/);
    });

    it('errors when connector type cannot be resolved', function () {
        assert.match(src, /pass `--connector=<type>` or name the entry after one of/);
    });

    it('rejects unknown connector types with a helpful hint', function () {
        assert.match(src, /Unknown connector type/);
        assert.match(src, /Allowed values/);
    });
});


// ---------------------------------------------------------------------------
// 07 — Target resolution
// ---------------------------------------------------------------------------

describe('07 - resolveTarget', function () {

    it('declares resolveTarget(projectPath, bundleName)', function () {
        assert.match(src, /var resolveTarget\s*=\s*function \(projectPath, bundleName\) \{/);
    });

    it('resolves shared path when no bundle passed', function () {
        assert.match(src, /projectPath \+ '\/shared\/config\/connectors\.json'/);
    });

    it('reads manifest.bundles for bundle-scoped writes', function () {
        assert.match(src, /manifest\.bundles\[bundleName\]/);
    });

    it('resolves <bundle-src>/config/connectors.json from manifest.src', function () {
        assert.match(src, /var bundleSrc = manifest\.bundles\[bundleName\]\.src;/);
        assert.match(src, /projectPath \+ '\/' \+ bundleSrc \+ '\/config\/connectors\.json'/);
    });

    it('errors when manifest.json cannot be read', function () {
        assert.match(src, /Cannot read `'.+'\/manifest\.json`/);
    });

    it('errors when the bundle is not registered in the manifest', function () {
        assert.match(src, /is not registered inside `@/);
    });
});


describe('08 - loadManifest', function () {

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
// 09 — buildEntry (flag-to-entry mapping)
// ---------------------------------------------------------------------------

describe('09 - buildEntry', function () {

    it('declares buildEntry(connectorName, connectorType, p)', function () {
        assert.match(src, /var buildEntry\s*=\s*function \(connectorName, connectorType, p\) \{/);
    });

    it('omits `connector` field when type matches the logical name', function () {
        assert.match(src, /if \(connectorType !== connectorName\)\s*\{\s*entry\.connector = connectorType;/);
    });

    it('maps --protocol= to entry.protocol', function () {
        assert.match(src, /if \(p\['protocol'\]\) entry\.protocol\s*=\s*String\(p\['protocol'\]\);/);
    });

    it('maps --host= to entry.host', function () {
        assert.match(src, /if \(p\['host'\]\)\s+entry\.host\s*=\s*String\(p\['host'\]\);/);
    });

    it('casts --connector-port= to Number when numeric, keeps String otherwise', function () {
        assert.match(src, /var portNum = Number\(p\['connector-port'\]\);/);
        assert.match(src, /entry\.port = isNaN\(portNum\) \? String\(p\['connector-port'\]\) : portNum;/);
    });

    it('guards --connector-port=true (bare flag) so port isn\'t set to `true`', function () {
        assert.match(src, /typeof p\['connector-port'\] != 'undefined' && p\['connector-port'\] !== true/);
    });

    it('maps --database= to entry.database', function () {
        assert.match(src, /if \(p\['database'\]\) entry\.database\s*=\s*String\(p\['database'\]\);/);
    });

    it('maps --username= and --password= to entry.username/password', function () {
        assert.match(src, /if \(p\['username'\]\) entry\.username\s*=\s*String\(p\['username'\]\);/);
        assert.match(src, /if \(p\['password'\]\) entry\.password\s*=\s*String\(p\['password'\]\);/);
    });

    it('validates --scope= against ALLOWED_SCOPES', function () {
        assert.match(src, /if \(ALLOWED_SCOPES\.indexOf\(sc\) < 0\)/);
        assert.match(src, /Scope `' \+ sc \+ '` is not valid\. Allowed:/);
    });

    it('maps --model= to entry.model (AI connector)', function () {
        assert.match(src, /if \(p\['model'\]\)\s+entry\.model\s+=\s*String\(p\['model'\]\);/);
    });

    it('maps --api-key= to entry.apiKey (AI connector)', function () {
        assert.match(src, /if \(p\['api-key'\]\)\s+entry\.apiKey\s+=\s*String\(p\['api-key'\]\);/);
    });

    it('maps --base-url= to entry.baseURL (AI connector)', function () {
        assert.match(src, /if \(p\['base-url'\]\) entry\.baseURL\s+=\s*String\(p\['base-url'\]\);/);
    });

    it('maps --driver-version= to entry.version', function () {
        assert.match(src, /if \(p\['driver-version'\]\)\s+entry\.version\s+=\s*String\(p\['driver-version'\]\);/);
    });
});


// ---------------------------------------------------------------------------
// 10 — readExistingFile (comment-header preservation)
// ---------------------------------------------------------------------------

describe('10 - readExistingFile', function () {

    it('declares readExistingFile(target)', function () {
        assert.match(src, /var readExistingFile\s*=\s*function \(target\) \{/);
    });

    it('returns an empty shape when the file does not exist', function () {
        assert.match(src, /return \{ header: '', data: \{\} \};/);
    });

    it('errors when the parent directory does not exist', function () {
        assert.match(src, /Config directory does not exist/);
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
});


// ---------------------------------------------------------------------------
// 11 — mergeEntry (key-ordered merge)
// ---------------------------------------------------------------------------

describe('11 - mergeEntry', function () {

    it('declares mergeEntry(existing, connectorName, entry)', function () {
        assert.match(src, /var mergeEntry\s*=\s*function \(existing, connectorName, entry\) \{/);
    });

    it('pins $schema at the top of the output', function () {
        assert.match(src, /if \(existing\.\$schema\)\s*\{\s*out\.\$schema = existing\.\$schema;/);
    });

    it('uses the canonical $schema URL when none is present', function () {
        assert.match(src, /out\.\$schema = 'https:\/\/gina\.io\/schema\/connectors\.json';/);
    });

    it('preserves existing key order during iteration', function () {
        assert.match(src, /for \(var k in existing\) \{\s*if \(k === '\$schema'\) continue;/);
    });

    it('replaces in place when the key already exists (overwrite path)', function () {
        assert.match(src, /if \(k === connectorName\)\s*\{\s*out\[connectorName\] = entry;/);
    });

    it('appends the new entry when it was not present', function () {
        assert.match(src, /if \(!overwrite\)\s*\{\s*out\[connectorName\] = entry;/);
    });
});


// ---------------------------------------------------------------------------
// 12 — writeFile (header + body + trailing newline)
// ---------------------------------------------------------------------------

describe('12 - writeFile', function () {

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
// 13 — buildInstallHint (AI + driver resolution + version pin)
// ---------------------------------------------------------------------------

describe('13 - buildInstallHint', function () {

    it('declares buildInstallHint(connectorType, entry)', function () {
        assert.match(src, /var buildInstallHint\s*=\s*function \(connectorType, entry\) \{/);
    });

    it('AI path reads the protocol scheme from entry.protocol', function () {
        assert.match(src, /var scheme = entry\.protocol \? String\(entry\.protocol\)\.split\(':'\)\[0\]\.toLowerCase\(\) : null;/);
    });

    it('AI path hints to set a valid protocol when scheme is unknown', function () {
        assert.match(src, /set `protocol` to one of:/);
    });

    it('AI path uses entry.version pin over ai.range when present', function () {
        assert.match(src, /var range = entry\.version \|\| ai\.range;/);
    });

    it('non-AI path uses entry.version pin over info.range when present', function () {
        assert.match(src, /var r = entry\.version \|\| info\.range;/);
    });

    it('sqlite short-circuits to a "no install needed" note', function () {
        assert.match(src, /No install needed/);
    });

    it('prints `npm install <pkg>@"<range>"` for runnable paths', function () {
        var matches = src.match(/Next: run `npm install/g) || [];
        assert.ok(matches.length >= 2, 'expected at least two `Next: run `npm install ...`` hint strings (AI + driver), got ' + matches.length);
    });
});


// ---------------------------------------------------------------------------
// 14 — Error paths + exit codes
// ---------------------------------------------------------------------------

describe('14 - error paths', function () {

    it('requires @<project>', function () {
        assert.match(src, /requires `@<project>`/);
    });

    it('errors when the requested project is not registered', function () {
        assert.match(src, /is not registered\. Run `gina project:list`/);
    });

    it('rejects when an entry exists without --force', function () {
        assert.match(src, /already exists in/);
        assert.match(src, /Re-run with --force to overwrite/);
    });

    it('exits 0 on success and 1 on every error', function () {
        assert.match(src, /process\.exit\(0\);/);
        var exit1Count = (src.match(/process\.exit\(1\)/g) || []).length;
        assert.ok(exit1Count >= 5, 'expected ≥5 process.exit(1) sites (missing name, invalid name, no project, bad type, …), got ' + exit1Count);
    });

    it('distinguishes Added vs Updated in the success message', function () {
        assert.match(src, /\(overwrite \? 'Updated' : 'Added'\)/);
    });
});


// ---------------------------------------------------------------------------
// 15 — help.txt + arguments.json + bin/cli registration
// ---------------------------------------------------------------------------

describe('15 - help.txt + arguments.json', function () {

    it('help.txt documents the `add` action', function () {
        assert.match(helpTxt, /add <name> @<project>/);
        assert.match(helpTxt, /add <name> <bundle> @<project>/);
    });

    it('help.txt documents --connector, --driver synonym, and --force', function () {
        assert.match(helpTxt, /--connector=<type>/);
        assert.match(helpTxt, /--driver=<type>\s+Synonym/);
        assert.match(helpTxt, /--force\s+Overwrite/);
    });

    it('help.txt documents --driver-version (driver pin)', function () {
        assert.match(helpTxt, /--driver-version=<range>/);
        assert.match(helpTxt, /semver range/);
    });

    it('help.txt documents AI connector flags', function () {
        assert.match(helpTxt, /--model=<id>/);
        assert.match(helpTxt, /--api-key=<value>/);
        assert.match(helpTxt, /--base-url=<url>/);
    });

    it('help.txt documents scope enum (local, beta, production, testing)', function () {
        assert.match(helpTxt, /local,\s*\n?\s*beta, production, testing/);
    });

    it('help.txt shows at least one add example', function () {
        assert.match(helpTxt, /gina connector:add /);
    });

    it('arguments.json registers every flag consumed by add.js', function () {
        assert.ok(Array.isArray(argsArr), 'arguments.json must parse to an array');
        [
            '--format', '--connector', '--driver', '--protocol', '--host',
            '--connector-port', '--database', '--username', '--password', '--scope',
            '--model', '--api-key', '--base-url', '--driver-version', '--force'
        ].forEach(function (flag) {
            assert.ok(argsArr.indexOf(flag) > -1, flag + ' must be registered in arguments.json');
        });
    });

    it('arguments.json does NOT register `--port` or `--version` (reserved framework flags)', function () {
        assert.strictEqual(argsArr.indexOf('--port'), -1, '`--port` is reserved for the framework socket port and must not be exposed to connector:add');
        assert.strictEqual(argsArr.indexOf('--version'), -1, '`--version` maps to GINA_VERSION and triggers a framework migration; must not be exposed to connector:add');
    });

    it('bin/cli registers `connector:` in allowedOffline (add inherits from list)', function () {
        assert.match(cliSrc, /allowedOffline\s*=\s*\[[\s\S]*?'connector:'[\s\S]*?\]/);
    });
});
