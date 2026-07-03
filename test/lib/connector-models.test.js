/**
 * lib/cmd/connector/models.js — lists the models a configured AI connector's
 * provider can serve OUTSIDE a request: argv parsing, shared+bundle
 * connectors.json reading, delegation to the shared lib.connectorConfig
 * resolver, non-AI rejection, ${secret:KEY} resolution, direct AIConnector
 * bootstrap, a live client.models.list() call, and the model-list output.
 *
 * Source-inspection + pure-logic-replica tests (same style as
 * connector-infer.test.js / connector-test.test.js): models.js runs inside the
 * CLI daemon context (CmdHelper, project registry, globals injected by gna.js)
 * and instantiates the AI connector core (which require()s core/gna at load).
 * Replicating that is heavy for near-zero extra coverage, so these assertions
 * prove:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) argv loop — --format capture + validation, positional extraction
 *   (c) lib.connectorConfig + lib.secrets consumption (no bare require)
 *   (d) resolveConnectorEntry — file I/O + delegation to cfg.resolve(...).entry
 *   (e) non-AI rejection via cfg.isAIConnector(entry, connectorName)
 *   (f) secrets.resolve in try/catch, key surfaced via _ginaSecretKey (never the value)
 *   (g) ad-hoc overrides applied to the entry; no --model / --message coupling
 *   (h) direct bootstrap — setPath('project'), relative require of the AI core,
 *       AIConnector.onReady → conn.client.models.list(), capability check
 *   (i) emitModels — JSON { project, connector, provider, count, models }, one
 *       id per line in text mode, both via synchronous fs.writeSync (fd 1 / fd 2)
 *   (j) emitUnsupported — honest { supported:false, models:null, reason } + non-zero exit
 *   (k) help.txt + arguments.json + bin/cli allowedOffline registration
 *
 * The merge/select/AI-subtype logic lives in lib/connector-config (covered by
 * connector-config.test.js); the model-entry shapes come from the provider SDK
 * (Anthropic vs OpenAI-compatible) and are passed through unmodified.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var MODELS_SOURCE = path.join(require('../fw'), 'lib/cmd/connector/models.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/connector/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/connector/arguments.json');
var CLI_SOURCE    = path.join(__dirname, '..', '..', 'bin', 'cli');

var src     = fs.readFileSync(MODELS_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc  = fs.readFileSync(CLI_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Models constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Models;?/);
    });

    it('declares a function Models(opt, cmd)', function () {
        assert.match(src, /function\s+Models\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('initialises self with a text format default', function () {
        assert.match(src, /var self\s*=\s*\{\s*format\s*:\s*'text'\s*\}/);
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
        assert.match(src, /self\.format = arg\.split\(\/\\=\/\)\[1\] \|\| 'text';/);
    });

    it('validates --format is text or json (rejects anything else)', function () {
        assert.match(src, /if \(self\.format !== 'text' && self\.format !== 'json'\)/);
        assert.match(src, /--format must be `text` or `json`/);
    });

    it('extracts positionals skipping --flags, -flags and @tokens', function () {
        assert.match(src, /var extractPositionals = function \(argv\)/);
        assert.match(src, /if \( \/\^\\-\\-\/\.test\(tok\) \) continue;/);
        assert.match(src, /if \( \/\^\\-\/\.test\(tok\)\s*\) continue;/);
        assert.match(src, /if \( \/\^\\@\/\.test\(tok\)\s*\) continue;/);
    });

    it('reads connector name + optional bundle from positionals[0] / [1]', function () {
        assert.match(src, /var connectorName = positionals\[0\] \|\| null;/);
        assert.match(src, /var bundleName    = positionals\[1\] \|\| null;/);
    });

    it('requires a connector positional', function () {
        assert.match(src, /Usage: gina connector:models <connector>/);
    });

    it('requires @<project> and a registered project', function () {
        assert.match(src, /`connector:models` requires `@<project>`/);
        assert.match(src, /is not registered\. Run `gina project:list`/);
    });
});


// ---------------------------------------------------------------------------
// 03 — lib registry consumption
// ---------------------------------------------------------------------------

describe('03 - lib registry consumption', function () {

    it('declares `var cfg = lib.connectorConfig;` (shared resolver)', function () {
        assert.match(src, /var cfg = lib\.connectorConfig;/);
    });

    it('declares `var secrets = lib.secrets;`', function () {
        assert.match(src, /var secrets = lib\.secrets;/);
    });

    it('does NOT bare-require lib/secrets (must use the registry)', function () {
        assert.equal(/require\(\s*['"]lib\/secrets['"]\s*\)/.test(src), false);
    });

    it('does NOT bare-require lib/connector-config', function () {
        assert.equal(/require\(\s*['"]lib\/connector-config['"]\s*\)/.test(src), false);
    });
});


// ---------------------------------------------------------------------------
// 04 — resolveConnectorEntry (file I/O + delegation)
// ---------------------------------------------------------------------------

describe('04 - resolveConnectorEntry', function () {

    it('reads shared/config/connectors.json', function () {
        assert.match(src, /projectPath \+ '\/shared\/config\/connectors\.json'/);
    });

    it('reads <projectPath>/<bundle-src>/config/connectors.json', function () {
        assert.match(src, /projectPath \+ '\/' \+ bSrc \+ '\/config\/connectors\.json'/);
    });

    it('delegates merge + select to the shared cfg.resolve', function () {
        assert.match(src, /return cfg\.resolve\(sharedJson, bundleJson, connectorName\)\.entry;/);
    });

    it('does NOT inline the merge/select (it lives in lib.connectorConfig)', function () {
        assert.doesNotMatch(src, /var merge = function/);
    });

    it('readJsonSafe delegates to requireJSON (comment tolerance)', function () {
        assert.match(src, /return requireJSON\(filePath\);/);
    });

    it('validates the bundle against the manifest', function () {
        assert.match(src, /is not registered inside `@'/);
    });

    it('errors when the connector is declared nowhere', function () {
        assert.match(src, /not found in/);
    });
});


// ---------------------------------------------------------------------------
// 05 — non-AI connector rejection (via cfg.isAIConnector)
// ---------------------------------------------------------------------------

describe('05 - non-AI guard', function () {

    it('rejects any connector for which cfg.isAIConnector(entry, connectorName) is false', function () {
        assert.match(src, /if \(!cfg\.isAIConnector\(entry, connectorName\)\)/);
        assert.match(src, /only works with AI connectors/);
    });
});


// ---------------------------------------------------------------------------
// 06 — secrets resolution (fail-closed, never echoed)
// ---------------------------------------------------------------------------

describe('06 - secrets resolution', function () {

    it('calls secrets.resolve(entry) inside a try/catch', function () {
        assert.match(src, /try \{\s*secrets\.resolve\(entry\);\s*\} catch \(secretErr\) \{/);
    });

    it('surfaces the missing KEY name via _ginaSecretKey (not the value)', function () {
        assert.match(src, /secretErr\._ginaSecretKey/);
    });

    it('never prints the resolved apiKey value on any output path', function () {
        assert.doesNotMatch(src, /write\([^)]*entry\.apiKey/);
        assert.doesNotMatch(src, /console\.(error|log|warn)\([^)]*entry\.apiKey/);
    });
});


// ---------------------------------------------------------------------------
// 07 — ad-hoc overrides
// ---------------------------------------------------------------------------

describe('07 - overrides', function () {

    it('applies --protocol / --base-url / --api-key to the connector entry', function () {
        assert.match(src, /entry\.protocol\s*=\s*String\(p\['protocol'\]\)/);
        assert.match(src, /entry\.baseURL\s*=\s*String\(p\['base-url'\]\)/);
        assert.match(src, /entry\.apiKey\s*=\s*String\(p\['api-key'\]\)/);
    });

    it('does NOT read --model or --message (this command lists models, it does not run inference)', function () {
        assert.doesNotMatch(src, /entry\.model\s*=/);
        assert.doesNotMatch(src, /p\['message'\]/);
    });
});


// ---------------------------------------------------------------------------
// 08 — direct bootstrap (no getModel) + live models.list()
// ---------------------------------------------------------------------------

describe('08 - direct AIConnector bootstrap + models.list', function () {

    it('does NOT use getModel (registry empty in CLI scope)', function () {
        assert.doesNotMatch(src, /getModel\(/);
    });

    it('points getPath(project) at the target project before instantiation', function () {
        assert.match(src, /setPath\('project', projectPath\);/);
    });

    it('requires the AI connector class via a relative path (version-agnostic)', function () {
        assert.match(src, /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/lib\/connector'\)/);
    });

    it('builds the connector and waits for onReady(err, conn)', function () {
        assert.match(src, /new AIConnector\(entry\)/);
        assert.match(src, /connector\.onReady\(function \(err, conn\)/);
    });

    it('capability-checks the client before calling models.list (honest unsupported, not a fabricated list)', function () {
        assert.match(src, /if \(!client \|\| !client\.models \|\| typeof client\.models\.list !== 'function'\)/);
    });

    it('calls client.models.list() and keeps the res.data array (not just a count)', function () {
        assert.match(src, /Promise\.resolve\(client\.models\.list\(\)\)\.then\(function \(res\)/);
        assert.match(src, /var models = \(res && Array\.isArray\(res\.data\)\) \? res\.data : \[\];/);
    });

    it('guards the call with a timeout and exits 0 on success, 1 on failure', function () {
        assert.match(src, /CONNECT_TIMEOUT_MS/);
        assert.match(src, /process\.exit\(0\);/);
        assert.match(src, /process\.exit\(1\);/);
    });
});


// ---------------------------------------------------------------------------
// 09 — loadAiCore helper
// ---------------------------------------------------------------------------

// The loadAiCore region of models.js (defined just before listModels).
function loadAiCoreBody() {
    return src.substring(src.indexOf('var loadAiCore'), src.indexOf('var listModels'));
}

describe('09 - loadAiCore helper', function () {

    it('requires the AI connector class via a relative path', function () {
        assert.match(loadAiCoreBody(), /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/lib\/connector'\)/);
    });

    it('points getPath(project) at the target project before returning', function () {
        assert.match(loadAiCoreBody(), /setPath\('project', projectPath\);/);
    });

    it('returns the { AIConnector } handle (the AI wrapper is not needed — models.list is read off conn.client)', function () {
        assert.match(loadAiCoreBody(), /return \{ AIConnector: AIConnector \};/);
    });
});


// ---------------------------------------------------------------------------
// 10 — emitModels / emitUnsupported (synchronous fs.writeSync, strict json gate)
// ---------------------------------------------------------------------------

describe('10 - output', function () {

    it('emits { project, connector, provider, count, models } as a JSON payload object', function () {
        assert.match(src, /var payload = \{[\s\S]*?project\s*:\s*self\.projectName,[\s\S]*?connector\s*:\s*connectorName,[\s\S]*?provider\s*:\s*provider \|\| null,[\s\S]*?count\s*:\s*models\.length,[\s\S]*?models\s*:\s*models[\s\S]*?\}/);
        assert.match(src, /fs\.writeSync\(1, JSON\.stringify\(payload\)\)/);
    });

    it('adds `bundle` to the envelope only when a bundle was named', function () {
        assert.match(src, /if \(bundleName\) payload\.bundle = bundleName;/);
    });

    it('writes one id per line to stdout (fd 1) and a count footer to stderr (fd 2) synchronously', function () {
        assert.match(src, /if \(lines\) fs\.writeSync\(1, lines\);/);
        assert.match(src, /fs\.writeSync\(2, '— ' \+ models\.length \+ ' model'/);
    });

    it('never buffers output via process.stdout/stderr.write (truncates on a pipe before process.exit)', function () {
        assert.doesNotMatch(src, /process\.stdout\.write/);
        assert.doesNotMatch(src, /process\.stderr\.write/);
    });

    it("guards JSON output with a strict self.format === 'json' (jsonl/json5 fall to text)", function () {
        assert.match(src, /self\.format === 'json'/);
        assert.doesNotMatch(src, /\/\^json\?\/\.test\(self\.format\)/);
    });

    it('emitUnsupported reports { supported:false, models:null, reason } and exits non-zero — never a fabricated empty list', function () {
        assert.match(src, /supported\s*:\s*false/);
        assert.match(src, /models\s*:\s*null/);
        assert.match(src, /reason\s*:\s*'provider client exposes no models\.list'/);
        assert.match(src, /exposes no models\.list/);
    });
});


// ---------------------------------------------------------------------------
// 11 — arguments.json (relies on the existing shared connector flags)
// ---------------------------------------------------------------------------

describe('11 - arguments.json', function () {

    it('parses to an array', function () {
        assert.ok(Array.isArray(argsArr));
    });

    it('relies on the existing shared connector flags (no new flag needed)', function () {
        ['--format', '--api-key', '--base-url', '--protocol'].forEach(function (f) {
            assert.ok(argsArr.indexOf(f) > -1, f + ' must be registered');
        });
    });
});


// ---------------------------------------------------------------------------
// 12 — help.txt + bin/cli registration
// ---------------------------------------------------------------------------

describe('12 - help + cli registration', function () {

    it('help.txt documents the models action', function () {
        assert.match(helpTxt, /models <connector> @<project>/);
        assert.match(helpTxt, /models <connector> <bundle> @<project>/);
    });

    it('help.txt documents the models options block', function () {
        assert.match(helpTxt, /Options \(models\):/);
    });

    it('help.txt shows models examples incl. the JSON form', function () {
        assert.match(helpTxt, /gina connector:models claude @myproject/);
        assert.match(helpTxt, /gina connector:models claude @myproject --format=json/);
    });

    it('help.txt notes the AI-only / ollama / no-echo / unsupported behaviour', function () {
        assert.match(helpTxt, /`connector:models` lists the models/);
        assert.match(helpTxt, /ollama/);
        assert.match(helpTxt, /UNSUPPORTED/);
    });

    it('bin/cli registers `connector:` in allowedOffline (models dispatches offline)', function () {
        assert.match(cliSrc, /allowedOffline\s*=\s*\[[\s\S]*?'connector:'[\s\S]*?\]/);
    });
});


// ===========================================================================
// Pure-logic replicas — exercise the handler's OWN decision logic with real
// inputs. (The merge/select/AI-subtype logic is the resolver's — see
// connector-config.test.js.)
// ===========================================================================

// Mirrors models.js extractPositionals.
function extractPositionals(argv) {
    var out = [];
    for (var i = 3, len = argv.length; i < len; i++) {
        var tok = argv[i];
        if (typeof tok != 'string') continue;
        if (/^\-\-/.test(tok)) continue;
        if (/^\-/.test(tok)) continue;
        if (/^\@/.test(tok)) continue;
        out.push(tok);
    }
    return out;
}

// Mirrors the capability check in listModels.
function hasModelsList(client) {
    return !!(client && client.models && typeof client.models.list === 'function');
}

// Mirrors the res.data extraction after models.list() resolves.
function extractModels(res) {
    return (res && Array.isArray(res.data)) ? res.data : [];
}

// Mirrors emitModels' JSON payload (bundle added only when named).
function modelsJson(project, connector, provider, bundle, models) {
    var payload = { project: project, connector: connector, provider: provider || null, count: models.length, models: models };
    if (bundle) payload.bundle = bundle;
    return payload;
}

// Mirrors emitModels' text render (one id per line; <unknown> fallback).
function idLines(models) {
    var lines = '';
    for (var i = 0; i < models.length; i++) {
        var id = (models[i] && models[i].id != null) ? String(models[i].id) : '<unknown>';
        lines += id + '\n';
    }
    return lines;
}

// Mirrors emitUnsupported's JSON payload.
function unsupportedJson(project, connector, provider, bundle) {
    var payload = { project: project, connector: connector, provider: provider || null, supported: false, models: null, reason: 'provider client exposes no models.list' };
    if (bundle) payload.bundle = bundle;
    return payload;
}


describe('13 - extractPositionals (replica)', function () {

    it('returns the connector name only', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:models', 'claude', '@proj', '--format=json']), ['claude']);
    });

    it('returns [connector, bundle] in order', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:models', 'claude', 'api', '@proj']), ['claude', 'api']);
    });

    it('skips @tokens and flags regardless of position', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:models', '@proj', '--format=json', 'claude', '--base-url=x', 'api']), ['claude', 'api']);
    });
});


describe('14 - capability check (replica)', function () {

    it('is true when the client exposes a models.list function', function () {
        assert.equal(hasModelsList({ models: { list: function () {} } }), true);
    });

    it('is false for a null client / no models / non-function list', function () {
        assert.equal(hasModelsList(null), false);
        assert.equal(hasModelsList({}), false);
        assert.equal(hasModelsList({ models: {} }), false);
        assert.equal(hasModelsList({ models: { list: 'nope' } }), false);
    });
});


describe('15 - extractModels (replica)', function () {

    it('returns the res.data array', function () {
        var data = [{ id: 'a' }, { id: 'b' }];
        assert.equal(extractModels({ data: data }), data);
    });

    it('returns [] when res is missing or data is not an array', function () {
        assert.deepEqual(extractModels(null), []);
        assert.deepEqual(extractModels({}), []);
        assert.deepEqual(extractModels({ data: 'nope' }), []);
    });
});


describe('16 - JSON envelope (replica)', function () {

    it('shapes { project, connector, provider, count, models } (no bundle when none named)', function () {
        var models = [{ id: 'claude-opus-4' }, { id: 'claude-sonnet-4' }];
        assert.deepEqual(
            modelsJson('proj', 'claude', 'anthropic', null, models),
            { project: 'proj', connector: 'claude', provider: 'anthropic', count: 2, models: models }
        );
    });

    it('adds `bundle` only when a bundle is named', function () {
        var out = modelsJson('proj', 'claude', 'anthropic', 'api', []);
        assert.equal(out.bundle, 'api');
        assert.equal(out.count, 0);
    });

    it('passes each provider entry through verbatim (Anthropic + OpenAI shapes survive)', function () {
        var anthropic = { id: 'claude-opus-4', type: 'model', display_name: 'Claude Opus 4', created_at: '2026-01-01' };
        var openai    = { id: 'gpt-x', object: 'model', created: 123, owned_by: 'acme' };
        var out = modelsJson('proj', 'mix', 'openai', null, [anthropic, openai]);
        assert.deepEqual(out.models[0], anthropic);
        assert.deepEqual(out.models[1], openai);
    });

    it('normalises a null provider to null', function () {
        assert.equal(modelsJson('proj', 'c', null, null, []).provider, null);
    });
});


describe('17 - text render (replica)', function () {

    it('prints one model id per line', function () {
        assert.equal(idLines([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 'a\nb\nc\n');
    });

    it('falls back to <unknown> for an entry with no id', function () {
        assert.equal(idLines([{ id: 'a' }, {}, { id: 'c' }]), 'a\n<unknown>\nc\n');
    });

    it('is empty for an empty list', function () {
        assert.equal(idLines([]), '');
    });
});


describe('18 - unsupported envelope (replica)', function () {

    it('reports supported:false / models:null / a reason (never a fabricated empty list)', function () {
        assert.deepEqual(
            unsupportedJson('proj', 'weird', 'someprovider', null),
            { project: 'proj', connector: 'weird', provider: 'someprovider', supported: false, models: null, reason: 'provider client exposes no models.list' }
        );
    });

    it('is distinct from a successful empty list ({ count:0, models:[] })', function () {
        var unsupported = unsupportedJson('proj', 'c', 'p', null);
        var emptyOk     = modelsJson('proj', 'c', 'p', null, []);
        assert.equal(unsupported.supported, false);
        assert.equal(unsupported.models, null);
        assert.deepEqual(emptyOk.models, []);
        assert.equal(emptyOk.count, 0);
        assert.equal(emptyOk.supported, undefined);
    });

    it('adds `bundle` only when named', function () {
        assert.equal(unsupportedJson('proj', 'c', 'p', 'api').bundle, 'api');
    });
});
