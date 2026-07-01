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
 *   (h) buildMessages — --message-wins gate, stdin fallback
 *   (i) buildOptions — model/system/max-tokens/temperature
 *   (j) direct bootstrap — setPath('project'), relative require of the AI core,
 *       AIConnector.onReady → AI(conn).infer(...).then/.catch
 *   (k) emitResult — JSON { content, model, usage } (raw added only under --raw),
 *       content + usage footer written via synchronous fs.writeSync (fd 1 / fd 2)
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

    it('does NOT apply --model to the entry (it is an inference-level option)', function () {
        assert.doesNotMatch(src, /entry\.model\s*=/);
    });
});


// ---------------------------------------------------------------------------
// 08 — buildMessages (--message wins, stdin fallback)
// ---------------------------------------------------------------------------

describe('08 - buildMessages (--message wins, stdin fallback)', function () {

    it('reads stdin only when piped (non-TTY)', function () {
        assert.match(src, /if \(!process\.stdin\.isTTY\)/);
        assert.match(src, /fs\.readFileSync\(0, 'utf8'\)/);
    });

    it('requires a JSON array from stdin', function () {
        assert.match(src, /if \(!Array\.isArray\(parsed\)\)/);
    });

    it('uses --message as the prompt (wins over stdin)', function () {
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
// 10a — shared loadAiCore helper (the extracted AI-core bootstrap)
// ---------------------------------------------------------------------------

// The loadAiCore region of infer.js (defined just before runInference).
function loadAiCoreBody() {
    return src.substring(src.indexOf('var loadAiCore'), src.indexOf('var runInference'));
}

describe('10a - shared loadAiCore helper', function () {

    it('requires the AI connector core via relative paths (version-agnostic)', function () {
        var lc = loadAiCoreBody();
        assert.match(lc, /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/lib\/connector'\)/);
        assert.match(lc, /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/index'\)/);
    });

    it('points getPath(project) at the target project before returning', function () {
        assert.match(loadAiCoreBody(), /setPath\('project', projectPath\);/);
    });

    it('returns the { AIConnector, AI } pair for the runners to consume', function () {
        assert.match(loadAiCoreBody(), /return \{ AIConnector: AIConnector, AI: AI \};/);
    });

    it('is the single bootstrap both runners delegate to (no inlined require/setPath in runInference)', function () {
        var inferBody = src.substring(src.indexOf('var runInference'), src.indexOf('var runStream'));
        assert.match(inferBody, /var core = loadAiCore\(projectPath\);/);
        assert.doesNotMatch(inferBody, /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/lib\/connector'\)/);
    });
});


// ---------------------------------------------------------------------------
// 11 — emitResult (synchronous fs.writeSync, --raw opt-in, strict json gate)
// ---------------------------------------------------------------------------

describe('11 - emitResult', function () {

    it('emits { content, model, usage } as JSON (built as a payload object)', function () {
        assert.match(src, /var payload = \{[\s\S]*?content\s*:\s*result\.content,[\s\S]*?model\s*:\s*result\.model,[\s\S]*?usage\s*:\s*result\.usage[\s\S]*?\}/);
        assert.match(src, /fs\.writeSync\(1, JSON\.stringify\(payload\)\)/);
    });

    it('omits the heavy provider `raw` by default; includes it only under --raw (self.raw-gated)', function () {
        // raw is opt-in: both emit sites add it only inside an `if ( self.raw )` guard.
        assert.match(src, /if \(\s*self\.raw\s*\) payload\.raw = result\.raw;/);
        assert.match(src, /if \(\s*self\.raw\s*\) frame\.raw =/);
    });

    it('writes content to stdout (fd 1) and the model/usage footer to stderr (fd 2) synchronously', function () {
        assert.match(src, /fs\.writeSync\(1, \(result\.content/);
        assert.match(src, /fs\.writeSync\(2, /);
        assert.match(src, /tokens in:/);
    });

    it('never buffers output via process.stdout/stderr.write (truncates on a pipe before process.exit)', function () {
        // emitResult was the only place that wrote to process.stdout/stderr; after
        // the pipe-flush fix neither appears anywhere in the handler (the stream
        // path already used fs.writeSync). Window-independent absence pin.
        assert.doesNotMatch(src, /process\.stdout\.write/);
        assert.doesNotMatch(src, /process\.stderr\.write/);
    });

    it("guards JSON output with a strict self.format === 'json' (jsonl/json5 fall to text)", function () {
        assert.match(src, /self\.format === 'json'/);
        assert.doesNotMatch(src, /\/\^json\?\/\.test\(self\.format\)/);
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

    it('registers --stream (slice 2)', function () {
        assert.ok(argsArr.indexOf('--stream') > -1, '--stream must be registered');
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

    it('help.txt documents the --stream NDJSON option (slice 2)', function () {
        assert.match(helpTxt, /--stream\b/);
        assert.match(helpTxt, /NDJSON/);
        assert.match(helpTxt, /one JSON object per line/);
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

// Mirrors emitResult's default JSON shape (raw omitted; --raw is covered in §23).
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


// ===========================================================================
// Slice 2 — --stream NDJSON. Source-pins on runStream's structure + frame
// mapping, then pure-logic replicas of the event→frame mapping. The live
// stream() behaviour (mock SDK clients) is covered by
// test/core/ai-connector.test.js — these pin the HANDLER's consumption of it.
// ===========================================================================

// The runStream region of infer.js (defined between runInference and emitResult).
function streamBody() {
    return src.substring(src.indexOf('var runStream'), src.indexOf('var emitResult'));
}


// ---------------------------------------------------------------------------
// 19 — stream branch source (runStream + --stream)
// ---------------------------------------------------------------------------

describe('19 - stream branch source (runStream + --stream)', function () {

    it('routes init() to runStream when p[stream] is set, else runInference', function () {
        assert.match(src, /if \(p\['stream'\]\)\s*\{\s*runStream\(projectPath, entry, built\.messages, options\);/);
        assert.match(src, /\} else \{\s*runInference\(projectPath, entry, built\.messages, options\);/);
    });

    it('runStream mirrors the runInference bootstrap (loadAiCore / new AIConnector / onReady / AI / stream)', function () {
        var rs = streamBody();
        // The AI-core require + setPath now live in the shared loadAiCore helper
        // (see §10a); runStream delegates to it rather than inlining the bootstrap.
        assert.match(rs, /var core = loadAiCore\(projectPath\);/);
        assert.match(rs, /var connector = new AIConnector\(entry\);/);
        assert.match(rs, /connector\.onReady\(function \(err, conn\)/);
        assert.match(rs, /var ai\s+= AI\(conn\);/);
        assert.match(rs, /var emitter = ai\.stream\(messages, options\);/);
    });

    it('wires start/delta/done/error listeners (the error listener is mandatory — it is listener-gated)', function () {
        var rs = streamBody();
        assert.match(rs, /emitter\.on\('start',/);
        assert.match(rs, /emitter\.on\('delta',/);
        assert.match(rs, /emitter\.on\('done',/);
        assert.match(rs, /emitter\.on\('error',/);
    });

    it('exits 0 inside the done handler and 1 inside the error handler', function () {
        var rs = streamBody();
        // Unbounded non-greedy: the first exit(0) after the done handler opens IS
        // the done handler's own (runStream's other exits are exit(1)); likewise
        // the first exit(1) after the error handler opens is its own.
        assert.match(rs, /emitter\.on\('done', function \(result\) \{[\s\S]*?process\.exit\(0\);/);
        assert.match(rs, /emitter\.on\('error', function \(e\) \{[\s\S]*?process\.exit\(1\);/);
    });

    it('writes frames via synchronous fs.writeSync(1, ...) so the terminal frame is not truncated by process.exit', function () {
        assert.match(src, /var emitFrame = function \(frame\)/);
        assert.match(src, /fs\.writeSync\(1, JSON\.stringify\(frame\) \+ '\\n'\)/);
    });

    it('maps the start frame to { type, model, role }', function () {
        var rs = streamBody();
        assert.match(rs, /emitFrame\(\{ type: 'start', model: s\.model, role: s\.role \}\)/);
    });

    it('maps the delta frame to { type, index, text, outputTokens } with honest null passthrough', function () {
        var rs = streamBody();
        assert.match(rs, /type\s*:\s*'delta'/);
        assert.match(rs, /index\s*:\s*d\.index/);
        assert.match(rs, /text\s*:\s*d\.text/);
        assert.match(rs, /outputTokens\s*:\s*\(typeof d\.outputTokens\s+===\s*'number'\)\s*\?[\s\S]{0,30}?:\s*null/);
    });

    it('maps the done frame (content/model/usage/latencyMs) with honest null counters', function () {
        var rs = streamBody();
        assert.match(rs, /type\s*:\s*'done'/);
        assert.match(rs, /content\s*:\s*result\.content/);
        assert.match(rs, /model\s*:\s*result\.model/);
        assert.match(rs, /inputTokens\s*:\s*\(typeof u\.inputTokens\s+===\s*'number'\)\s*\?[\s\S]{0,30}?:\s*null/);
        assert.match(rs, /outputTokens\s*:\s*\(typeof u\.outputTokens\s+===\s*'number'\)\s*\?[\s\S]{0,30}?:\s*null/);
        assert.match(rs, /latencyMs\s*:\s*\(typeof result\.latencyMs\s+===\s*'number'\)\s*\?[\s\S]{0,30}?:\s*null/);
    });

    it('includes finishReason only when present (OpenAI-family only; Anthropic done has none)', function () {
        var rs = streamBody();
        assert.match(rs, /if \(typeof result\.finishReason !== 'undefined' && result\.finishReason !== null\)/);
        assert.match(rs, /frame\.finishReason = result\.finishReason;/);
    });

    it('maps the error frame to { type: error, error: { message } }', function () {
        var rs = streamBody();
        assert.match(rs, /type: 'error', error: \{ message:/);
    });

    it('does NOT branch on self.format in runStream (--stream is always NDJSON)', function () {
        assert.doesNotMatch(streamBody(), /self\.format/);
    });
});


// ===========================================================================
// 20 — stream frame mapping (pure-logic replicas of runStream's inline maps)
// ===========================================================================

// Replica of runStream's start-frame mapping.
function startFrame(s) {
    return { type: 'start', model: s.model, role: s.role };
}
// Replica of runStream's delta-frame mapping (numeric passthrough, else null).
function deltaFrame(d) {
    return {
        type         : 'delta',
        index        : d.index,
        text         : d.text,
        outputTokens : (typeof d.outputTokens === 'number') ? d.outputTokens : null
    };
}
// Replica of runStream's done-frame mapping (honest null counters + conditional finishReason).
function doneFrame(result) {
    var u     = result.usage || {};
    var frame = {
        type    : 'done',
        content : result.content,
        model   : result.model,
        usage   : {
            inputTokens  : (typeof u.inputTokens  === 'number') ? u.inputTokens  : null,
            outputTokens : (typeof u.outputTokens === 'number') ? u.outputTokens : null
        },
        latencyMs : (typeof result.latencyMs === 'number') ? result.latencyMs : null
    };
    if (typeof result.finishReason !== 'undefined' && result.finishReason !== null) {
        frame.finishReason = result.finishReason;
    }
    return frame;
}
// Replica of runStream's error-frame mapping.
function errorFrame(e) {
    return { type: 'error', error: { message: (e && e.message) ? e.message : String(e) } };
}


describe('20 - stream frame mapping (replica)', function () {

    it('start frame carries model + role', function () {
        assert.deepEqual(startFrame({ model: 'qwen2.5:0.5b', role: 'assistant' }),
            { type: 'start', model: 'qwen2.5:0.5b', role: 'assistant' });
    });

    it('delta passes a numeric outputTokens through (incl. 0)', function () {
        assert.deepEqual(deltaFrame({ index: 3, text: ' assist', outputTokens: 7 }),
            { type: 'delta', index: 3, text: ' assist', outputTokens: 7 });
        assert.deepEqual(deltaFrame({ index: 0, text: 'Hi', outputTokens: 0 }),
            { type: 'delta', index: 0, text: 'Hi', outputTokens: 0 });
    });

    it('delta coerces null/undefined outputTokens to null (OpenAI-family null-until-final — never fabricated)', function () {
        assert.equal(deltaFrame({ index: 1, text: '!', outputTokens: null }).outputTokens, null);
        assert.equal(deltaFrame({ index: 2, text: '?' }).outputTokens, null);
    });

    it('done passes real usage numbers + latencyMs + finishReason through', function () {
        assert.deepEqual(
            doneFrame({ content: 'Hi! How can I assist you today?', model: 'qwen2.5:0.5b', usage: { inputTokens: 34, outputTokens: 10 }, latencyMs: 1115, finishReason: 'stop' }),
            { type: 'done', content: 'Hi! How can I assist you today?', model: 'qwen2.5:0.5b', usage: { inputTokens: 34, outputTokens: 10 }, latencyMs: 1115, finishReason: 'stop' }
        );
    });

    it('done coerces missing/null usage to null (e.g. ollama omits the final usage chunk)', function () {
        assert.deepEqual(doneFrame({ content: 'x', model: 'm', usage: { inputTokens: null, outputTokens: null }, latencyMs: 50 }).usage,
            { inputTokens: null, outputTokens: null });
        var g = doneFrame({ content: 'y', model: 'm' }); // no usage object at all
        assert.deepEqual(g.usage, { inputTokens: null, outputTokens: null });
        assert.equal(g.latencyMs, null);
    });

    it('done omits finishReason when absent (Anthropic done has none)', function () {
        var f = doneFrame({ content: 'x', model: 'm', usage: { inputTokens: 1, outputTokens: 2 }, latencyMs: 5 });
        assert.equal('finishReason' in f, false);
    });

    it('done includes finishReason when present (OpenAI-family)', function () {
        assert.equal(doneFrame({ content: 'x', model: 'm', usage: {}, latencyMs: 5, finishReason: 'length' }).finishReason, 'length');
    });

    it('error frame extracts an Error message', function () {
        assert.deepEqual(errorFrame(new Error("404 model 'llama3.2' not found")),
            { type: 'error', error: { message: "404 model 'llama3.2' not found" } });
    });

    it('error frame stringifies a non-Error', function () {
        assert.deepEqual(errorFrame('plain string'), { type: 'error', error: { message: 'plain string' } });
    });

    it('every frame serialises to a single NDJSON line', function () {
        [ startFrame({ model: 'm', role: 'r' }),
          deltaFrame({ index: 0, text: 'hi', outputTokens: null }),
          doneFrame({ content: 'x', model: 'm', usage: {}, latencyMs: 1, finishReason: 'stop' }),
          errorFrame(new Error('e')) ].forEach(function (frame) {
            assert.equal(JSON.stringify(frame).indexOf('\n'), -1, 'a frame JSON line must contain no literal newline');
        });
    });

    it('a delta whose text contains a newline still serialises to ONE NDJSON line (JSON escapes it, round-trips back)', function () {
        var line = JSON.stringify(deltaFrame({ index: 0, text: 'line1\nline2', outputTokens: null }));
        assert.equal(line.indexOf('\n'), -1);
        assert.equal(JSON.parse(line).text, 'line1\nline2');
    });
});


// ===========================================================================
// 21 — buildMessages precedence (replica). --message wins over stdin; stdin is
// the fallback; no-input is the terminal error. Mirrors the reworked source
// order so an accidentally-non-TTY stdin (heredoc/CI/< file) never overrides an
// explicit --message.
// ===========================================================================

// Mirrors the precedence decision of the reworked buildMessages.
function chooseSource(p, stdinRaw, isTTY) {
    var message = (typeof p['message'] === 'string') ? p['message'] : null;
    if (message) return { from: 'message', content: message };
    if (!isTTY) {
        var raw = (stdinRaw || '').trim();
        if (raw) return { from: 'stdin', raw: raw };
    }
    return { from: 'none' };
}

describe('21 - buildMessages precedence (replica)', function () {

    it('--message wins even when valid stdin is piped (non-TTY)', function () {
        assert.deepEqual(
            chooseSource({ message: 'hi' }, '[{"role":"user","content":"piped"}]', false),
            { from: 'message', content: 'hi' });
    });

    it('falls back to stdin when no --message and stdin is piped', function () {
        assert.deepEqual(
            chooseSource({}, '[{"role":"user","content":"piped"}]', false),
            { from: 'stdin', raw: '[{"role":"user","content":"piped"}]' });
    });

    it('an accidentally non-TTY empty stdin + a valid --message uses the message (no hard exit)', function () {
        assert.deepEqual(chooseSource({ message: 'hi' }, '', false), { from: 'message', content: 'hi' });
    });

    it('no --message + empty piped stdin yields the no-input terminal', function () {
        assert.deepEqual(chooseSource({}, '   ', false), { from: 'none' });
    });

    it('no --message + a TTY (no pipe) yields the no-input terminal', function () {
        assert.deepEqual(chooseSource({}, '', true), { from: 'none' });
    });

    it('ignores a bare --message flag (boolean true), falling back to stdin', function () {
        assert.deepEqual(
            chooseSource({ message: true }, '[{"role":"user","content":"piped"}]', false),
            { from: 'stdin', raw: '[{"role":"user","content":"piped"}]' });
    });
});


// ---------------------------------------------------------------------------
// 22 — buildMessages source order (--message checked + returned before stdin)
// ---------------------------------------------------------------------------

// The buildMessages region of infer.js (between buildMessages and buildOptions).
function messagesBody() {
    return src.substring(src.indexOf('var buildMessages'), src.indexOf('var buildOptions'));
}

describe('22 - buildMessages source order', function () {

    it('reads p[message] before the !process.stdin.isTTY stdin branch', function () {
        var body     = messagesBody();
        var msgIdx   = body.indexOf("p['message']");
        var stdinIdx = body.indexOf('process.stdin.isTTY');
        assert.ok(msgIdx > -1 && stdinIdx > -1, 'both checks must exist');
        assert.ok(msgIdx < stdinIdx, '--message must be checked before stdin');
    });

    it('returns on --message before touching stdin', function () {
        assert.match(messagesBody(),
            /if \(message\) \{\s*return \{ messages: \[\{ role: 'user', content: message \}\][\s\S]*?\}/);
    });
});


// ===========================================================================
// 23 — --raw opt-in: the heavy provider raw is omitted by default and added
// back only under --raw, on BOTH the buffered JSON path and the stream done
// frame. For a STREAM, OpenAI-family raw is null (no single final object) —
// surfaced as an explicit "raw":null, which is correct, not a bug.
// ===========================================================================

// Replica of emitResult's JSON payload raw opt-in.
function jsonShapeRaw(result, raw) {
    var payload = { content: result.content, model: result.model, usage: result.usage };
    if (raw) payload.raw = result.raw;
    return payload;
}
// Replica of runStream's done-frame raw opt-in (self.raw gate + null coercion).
function doneFrameRaw(result, raw) {
    var frame = doneFrame(result);
    if (raw) frame.raw = (typeof result.raw === 'undefined') ? null : result.raw;
    return frame;
}

describe('23 - --raw opt-in (replica + registration)', function () {

    it('buffered JSON omits raw by default, includes result.raw under --raw', function () {
        var r = { content: 'hi', model: 'm', usage: { inputTokens: 1, outputTokens: 2 }, raw: { full: 'provider response' } };
        assert.equal('raw' in jsonShapeRaw(r, false), false);
        assert.deepEqual(jsonShapeRaw(r, true).raw, { full: 'provider response' });
    });

    it('stream done frame omits raw by default, includes it under --raw', function () {
        var r = { content: 'x', model: 'm', usage: { inputTokens: 1, outputTokens: 2 }, latencyMs: 5, raw: { msg: true } };
        assert.equal('raw' in doneFrameRaw(r, false), false);
        assert.deepEqual(doneFrameRaw(r, true).raw, { msg: true });
    });

    it('stream done frame surfaces an explicit null when the provider gives no final object (OpenAI-family)', function () {
        var r = { content: 'x', model: 'm', usage: {}, latencyMs: 5 }; // no raw key
        var f = doneFrameRaw(r, true);
        assert.equal('raw' in f, true);
        assert.equal(f.raw, null);
        assert.match(JSON.stringify(f), /"raw":null/); // explicit, not dropped
    });

    it('init stashes self.raw from p[raw] (boolean presence flag)', function () {
        assert.match(src, /self\.raw = !!p\['raw'\];/);
    });

    it('arguments.json registers --raw', function () {
        assert.ok(argsArr.indexOf('--raw') > -1, '--raw must be registered');
    });

    it('help.txt documents --raw under Options (infer) + an example', function () {
        assert.match(helpTxt, /--raw\b/);
        assert.match(helpTxt, /provider `raw` payload/);
        assert.match(helpTxt, /--format=json --raw/);
    });
});
