/**
 * lib/cmd/connector/infer.js — runs a one-off inference against a configured
 * AI connector OUTSIDE a request: argv parsing, shared+bundle connectors.json
 * reading, delegation to the shared lib.connectorConfig resolver, non-AI
 * rejection, ${secret:KEY} resolution, message/option building (flags + stdin),
 * direct AIConnector+AI bootstrap, and buffered result output.
 *
 * Source-inspection + pure-logic-replica tests (same style as
 * connector-list.test.js): infer.js runs inside the CLI daemon context
 * (CmdHelper, project registry, globals injected by gna.js) and instantiates
 * the AI connector core (which require()s core/gna at load). Replicating that
 * is heavy for near-zero extra coverage, so these assertions prove:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) argv loop — --format capture, positional extraction
 *   (c) lib.connectorConfig + lib.secrets consumption (no bare require)
 *   (d) resolveConnectorEntry — file I/O + delegation to cfg.resolve(...).entry
 *   (e) non-AI rejection via cfg.isAIConnector(entry)
 *   (f) secrets.resolve in try/catch, key surfaced via _ginaSecretKey (never the value)
 *   (g) ad-hoc overrides applied to the entry; --model applied to options, not the entry
 *   (h) buildMessages — stdin-JSON-wins gate, flag fallback
 *   (i) buildOptions — model/system/max-tokens/temperature
 *   (j) direct bootstrap — setPath('project'), relative require of the AI core,
 *       AIConnector.onReady → AI(conn).infer(...).then/.catch
 *   (k) emitResult — JSON { content, model, usage } (raw omitted), text content
 *       to stdout + usage footer to stderr
 *   (l) help.txt + arguments.json + bin/cli allowedOffline registration
 *
 * The merge/select/AI-subtype logic lives in lib/connector-config (covered by
 * connector-config.test.js); the inference behavior of AIConnector/AI/infer()
 * is covered by test/core/ai-connector.test.js (mock SDK clients, incl. ollama).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var INFER_SOURCE = path.join(require('../fw'), 'lib/cmd/connector/infer.js');
var HELP_TXT     = path.join(require('../fw'), 'lib/cmd/connector/help.txt');
var ARGS_FILE    = path.join(require('../fw'), 'lib/cmd/connector/arguments.json');
var CLI_SOURCE   = path.join(__dirname, '..', '..', 'bin', 'cli');

var src     = fs.readFileSync(INFER_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc  = fs.readFileSync(CLI_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Infer constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Infer;?/);
    });

    it('declares a function Infer(opt, cmd)', function () {
        assert.match(src, /function\s+Infer\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
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

    it('requires @<project> and a registered project', function () {
        assert.match(src, /`connector:infer` requires `@<project>`/);
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

    it('rejects any connector for which cfg.isAIConnector(entry) is false', function () {
        assert.match(src, /if \(!cfg\.isAIConnector\(entry\)\)/);
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

    it('does NOT apply --model to the entry (it is an inference-level option)', function () {
        assert.doesNotMatch(src, /entry\.model\s*=/);
    });
});


// ---------------------------------------------------------------------------
// 08 — buildMessages (stdin wins, flag fallback)
// ---------------------------------------------------------------------------

describe('08 - buildMessages', function () {

    it('reads stdin only when piped (non-TTY)', function () {
        assert.match(src, /if \(!process\.stdin\.isTTY\)/);
        assert.match(src, /fs\.readFileSync\(0, 'utf8'\)/);
    });

    it('requires a JSON array from stdin', function () {
        assert.match(src, /if \(!Array\.isArray\(parsed\)\)/);
    });

    it('falls back to --message as a user message', function () {
        assert.match(src, /var message = \(typeof p\['message'\] === 'string'\) \? p\['message'\] : null;/);
        assert.match(src, /role: 'user', content: message/);
    });

    it('errors when no prompt is supplied', function () {
        assert.match(src, /provide a prompt: --message/);
    });
});


// ---------------------------------------------------------------------------
// 09 — buildOptions
// ---------------------------------------------------------------------------

describe('09 - buildOptions', function () {

    it('applies --model as options.model', function () {
        assert.match(src, /options\.model = String\(p\['model'\]\)/);
    });

    it('applies --system as options.system', function () {
        assert.match(src, /if \(system\) options\.system = system;/);
    });

    it('parses --max-tokens / --temperature numerically, ignoring NaN', function () {
        assert.match(src, /if \(!isNaN\(mt\)\) options\.maxTokens = mt;/);
        assert.match(src, /if \(!isNaN\(tp\)\) options\.temperature = tp;/);
    });
});


// ---------------------------------------------------------------------------
// 10 — direct bootstrap (no getModel)
// ---------------------------------------------------------------------------

describe('10 - direct AIConnector + AI bootstrap', function () {

    it('does NOT use getModel (registry empty in CLI scope)', function () {
        assert.doesNotMatch(src, /getModel\(/);
    });

    it('points getPath(project) at the target project before instantiation', function () {
        assert.match(src, /setPath\('project', projectPath\);/);
    });

    it('requires the AI connector core via relative paths (version-agnostic)', function () {
        assert.match(src, /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/lib\/connector'\)/);
        assert.match(src, /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/index'\)/);
    });

    it('builds the connector and waits for onReady(err, conn)', function () {
        assert.match(src, /var connector = new AIConnector\(entry\);/);
        assert.match(src, /connector\.onReady\(function \(err, conn\)/);
    });

    it('wraps conn with AI(conn) and runs infer(messages, options)', function () {
        assert.match(src, /var ai = AI\(conn\);/);
        assert.match(src, /ai\.infer\(messages, options\)/);
    });

    it('exits 0 on success and 1 on connector/inference error', function () {
        assert.match(src, /process\.exit\(0\);/);
        assert.match(src, /process\.exit\(1\);/);
    });
});


// ---------------------------------------------------------------------------
// 11 — emitResult (raw omitted)
// ---------------------------------------------------------------------------

describe('11 - emitResult', function () {

    it('emits { content, model, usage } as JSON', function () {
        assert.match(src, /JSON\.stringify\(\{[\s\S]*?content\s*:\s*result\.content,[\s\S]*?model\s*:\s*result\.model,[\s\S]*?usage\s*:\s*result\.usage[\s\S]*?\}\)/);
    });

    it('omits the heavy provider `raw` payload everywhere', function () {
        assert.doesNotMatch(src, /result\.raw/);
    });

    it('writes content to stdout and the model/usage footer to stderr', function () {
        assert.match(src, /process\.stdout\.write\(\(result\.content/);
        assert.match(src, /process\.stderr\.write\(/);
        assert.match(src, /tokens in:/);
    });

    it('guards JSON output with /^json?/ test', function () {
        assert.match(src, /\/\^json\?\/\.test\(self\.format\)/);
    });
});


// ---------------------------------------------------------------------------
// 12 — arguments.json
// ---------------------------------------------------------------------------

describe('12 - arguments.json', function () {

    it('parses to an array', function () {
        assert.ok(Array.isArray(argsArr));
    });

    it('registers the infer flags', function () {
        ['--message', '--system', '--max-tokens', '--temperature'].forEach(function (f) {
            assert.ok(argsArr.indexOf(f) > -1, f + ' must be registered');
        });
    });

    it('relies on the existing shared connector flags', function () {
        ['--model', '--api-key', '--base-url', '--protocol', '--format'].forEach(function (f) {
            assert.ok(argsArr.indexOf(f) > -1, f + ' must be registered');
        });
    });
});


// ---------------------------------------------------------------------------
// 13 — help.txt + bin/cli registration
// ---------------------------------------------------------------------------

describe('13 - help + cli registration', function () {

    it('help.txt documents the infer action', function () {
        assert.match(helpTxt, /infer <connector> @<project>/);
        assert.match(helpTxt, /infer <connector> <bundle> @<project>/);
    });

    it('help.txt documents the infer options block', function () {
        assert.match(helpTxt, /Options \(infer\):/);
        assert.match(helpTxt, /--message=<text>/);
        assert.match(helpTxt, /--system=<text>/);
    });

    it('help.txt shows infer examples incl. the stdin form', function () {
        assert.match(helpTxt, /gina connector:infer claude @myproject --message=/);
        assert.match(helpTxt, /\| gina connector:infer/);
    });

    it('help.txt notes the AI-only / ollama / no-echo behaviour', function () {
        assert.match(helpTxt, /only works with `ai` connectors/);
        assert.match(helpTxt, /ollama/);
        assert.match(helpTxt, /never printed/);
    });

    it('bin/cli registers `connector:` in allowedOffline (infer dispatches offline)', function () {
        assert.match(cliSrc, /allowedOffline\s*=\s*\[[\s\S]*?'connector:'[\s\S]*?\]/);
    });
});


// ===========================================================================
// Pure-logic replicas — exercise the handler's OWN decision logic with real
// inputs. (The merge/select/AI-subtype logic is the resolver's — see
// connector-config.test.js.)
// ===========================================================================

// Mirrors infer.js extractPositionals.
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

// Mirrors the flag path of buildMessages.
function buildFromFlags(p) {
    var system = (p['system'] && p['system'] !== true) ? String(p['system']) : null;
    var message = (typeof p['message'] === 'string') ? p['message'] : null;
    if (!message) return null;
    return { messages: [{ role: 'user', content: message }], system: system };
}

// Mirrors the stdin-array gate of buildMessages.
function parseStdin(raw) {
    raw = (raw || '').trim();
    if (!raw) return { empty: true };
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return { error: 'json' }; }
    if (!Array.isArray(parsed)) return { error: 'notarray' };
    return { messages: parsed };
}

// Mirrors buildOptions.
function buildOptions(p, system) {
    var options = {};
    if (p['model'] && p['model'] !== true) options.model = String(p['model']);
    if (system) options.system = system;
    if (p['max-tokens'] && p['max-tokens'] !== true) { var mt = Number(p['max-tokens']); if (!isNaN(mt)) options.maxTokens = mt; }
    if (p['temperature'] && p['temperature'] !== true) { var tp = Number(p['temperature']); if (!isNaN(tp)) options.temperature = tp; }
    return options;
}

// Mirrors emitResult's JSON shape (raw omitted).
function jsonShape(result) {
    return { content: result.content, model: result.model, usage: result.usage };
}


describe('14 - extractPositionals (replica)', function () {

    it('returns the connector name only', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:infer', 'claude', '@proj', '--message=hi']), ['claude']);
    });

    it('returns [connector, bundle] in order', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:infer', 'claude', 'api', '@proj']), ['claude', 'api']);
    });

    it('skips @tokens and flags regardless of position', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:infer', '@proj', '--stream', 'claude', '--model=x', 'api']), ['claude', 'api']);
    });
});


describe('15 - buildFromFlags (replica)', function () {

    it('wraps --message as a single user message', function () {
        assert.deepEqual(buildFromFlags({ message: 'hi' }), { messages: [{ role: 'user', content: 'hi' }], system: null });
    });

    it('carries --system through', function () {
        assert.deepEqual(buildFromFlags({ message: 'hi', system: 'be terse' }), { messages: [{ role: 'user', content: 'hi' }], system: 'be terse' });
    });

    it('returns null when no message is given', function () {
        assert.equal(buildFromFlags({}), null);
    });

    it('ignores a bare --message flag (boolean true)', function () {
        assert.equal(buildFromFlags({ message: true }), null);
    });
});


describe('16 - parseStdin (replica)', function () {

    it('accepts a JSON messages array', function () {
        assert.deepEqual(parseStdin('[{"role":"user","content":"hi"}]'), { messages: [{ role: 'user', content: 'hi' }] });
    });

    it('rejects non-array JSON', function () {
        assert.deepEqual(parseStdin('{"role":"user"}'), { error: 'notarray' });
    });

    it('rejects malformed JSON', function () {
        assert.deepEqual(parseStdin('not json'), { error: 'json' });
    });

    it('reports empty/whitespace stdin', function () {
        assert.deepEqual(parseStdin('   '), { empty: true });
    });
});


describe('17 - buildOptions (replica)', function () {

    it('maps model + system', function () {
        assert.deepEqual(buildOptions({ model: 'm' }, 'sys'), { model: 'm', system: 'sys' });
    });

    it('parses numeric max-tokens / temperature (incl. 0)', function () {
        assert.deepEqual(buildOptions({ 'max-tokens': '500', 'temperature': '0' }, null), { maxTokens: 500, temperature: 0 });
    });

    it('ignores non-numeric max-tokens', function () {
        assert.deepEqual(buildOptions({ 'max-tokens': 'abc' }, null), {});
    });

    it('ignores a bare --model flag (boolean true)', function () {
        assert.deepEqual(buildOptions({ model: true }, null), {});
    });
});


describe('18 - jsonShape (replica)', function () {

    it('keeps content/model/usage and drops raw', function () {
        var out = jsonShape({ content: 'hi', model: 'm', usage: { inputTokens: 1, outputTokens: 2 }, raw: { huge: true } });
        assert.deepEqual(out, { content: 'hi', model: 'm', usage: { inputTokens: 1, outputTokens: 2 } });
        assert.equal('raw' in out, false);
    });
});
