/**
 * lib/cmd/connector/test.js — probes a project's configured connectors for
 * readiness OUTSIDE a request: argv parsing, shared+bundle connectors.json
 * enumeration, per-connector config/driver/secrets validation, the opt-in
 * `--connect` live probe (ai only — models.list, zero generation tokens), and
 * a non-zero exit when any connector fails.
 *
 * Source-inspection + pure-logic-replica tests (same style as
 * connector-infer.test.js): test.js runs inside the CLI daemon context
 * (CmdHelper, project registry, globals injected by gna.js) and — only on the
 * `--connect` path — instantiates the AI connector core (which require()s
 * core/gna at load). Replicating that bootstrap is heavy for near-zero extra
 * coverage, so these assertions prove:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) argv loop — --format capture + text|json validation, positional extraction
 *   (c) --connect read from self.params (lib registry consumption, no bare require)
 *   (d) mode dispatch — bare / @project / <connector> [@bundle] @project
 *   (e) evaluateConnector — config (registry) / driver (node_modules) / secrets checks
 *   (f) the connect gate — ai only this release; DB/cache reported SKIPPED
 *   (g) probeAI — setPath('project'), relative require of the AI connector class,
 *       secrets.resolve on a COPY, onReady → client.models.list (NEVER infer:
 *       --connect spends zero generation tokens)
 *   (h) finalize — Promise.all(probes) then process.exit(anyFail ? 1 : 0)
 *   (i) computeOk — a skipped check never fails the connector
 *   (j) emit — JSON report / text PASS-FAIL
 *   (k) help.txt + arguments.json + bin/cli allowedOffline registration
 *
 * The merge/select logic lives in lib/connector-config (covered by
 * connector-config.test.js); the AIConnector/models.list behaviour is the SDK's.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var TEST_SOURCE = path.join(require('../fw'), 'lib/cmd/connector/test.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/connector/help.txt');
var ARGS_FILE   = path.join(require('../fw'), 'lib/cmd/connector/arguments.json');
var CLI_SOURCE  = path.join(__dirname, '..', '..', 'bin', 'cli');

var src     = fs.readFileSync(TEST_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc  = fs.readFileSync(CLI_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Test constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Test;?/);
    });

    it('declares a function Test(opt, cmd)', function () {
        assert.match(src, /function\s+Test\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('initialises self with text format, doConnect false, anyFail false', function () {
        assert.match(src, /var self\s*=\s*\{\s*format\s*:\s*'text',\s*doConnect\s*:\s*false,\s*anyFail\s*:\s*false\s*\}/);
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

    it('iterates process.argv from index 3 for --format', function () {
        assert.match(src, /for \(var i = 3, len = process\.argv\.length; i < len; i\+\+\)/);
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(arg\)/);
    });

    it('validates --format is text or json', function () {
        assert.match(src, /if \(self\.format !== 'text' && self\.format !== 'json'\)/);
    });

    it('reads --connect from self.params (declared in arguments.json)', function () {
        assert.match(src, /self\.doConnect = !!p\['connect'\];/);
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
});


// ---------------------------------------------------------------------------
// 03 — lib registry consumption
// ---------------------------------------------------------------------------

describe('03 - lib registry consumption', function () {

    it('declares cfg / secrets / registry from the lib registry', function () {
        assert.match(src, /var cfg\s*=\s*lib\.connectorConfig;/);
        assert.match(src, /var secrets\s*=\s*lib\.secrets;/);
        assert.match(src, /var registry\s*=\s*lib\.connectorRegistry;/);
    });

    it('does NOT bare-require lib/secrets / lib/connector-config / lib/connector-registry', function () {
        assert.equal(/require\(\s*['"]lib\/secrets['"]\s*\)/.test(src), false);
        assert.equal(/require\(\s*['"]lib\/connector-config['"]\s*\)/.test(src), false);
        assert.equal(/require\(\s*['"]lib\/connector-registry['"]\s*\)/.test(src), false);
    });

    it('gatherConnectors resolves every entry through cfg.resolve (deep copy), not an inline merge', function () {
        // Both the bundle loop (override + bundle-only) and the shared-only loop
        // route entries through the shared cfg resolver, so each gathered entry
        // is a fresh deep copy (parity with resolveSingle). The inline shallowMerge
        // is gone — the merge/select logic lives only in lib/connector-config.
        assert.match(src, /entry\s*:\s*cfg\.resolve\(sharedJson, bJson, bk\)\.entry/);
        assert.match(src, /entry:\s*cfg\.resolve\(sharedJson, \{\}, sk\)\.entry/);
        assert.doesNotMatch(src, /var shallowMerge = function/);
    });
});


// ---------------------------------------------------------------------------
// 04 — mode dispatch
// ---------------------------------------------------------------------------

describe('04 - mode dispatch', function () {

    it('bare (no @project) → testAllProjects', function () {
        assert.match(src, /testAllProjects\(\);/);
        assert.match(src, /var testAllProjects = function \(\)/);
    });

    it('a connector name without @project is rejected', function () {
        assert.match(src, /`connector:test <connector>` requires `@<project>`/);
    });

    it('@project only → testProject; <connector> [@bundle] → testSingle', function () {
        assert.match(src, /testSingle\(self\.projectName, bundleName, connectorName\);/);
        assert.match(src, /testProject\(self\.projectName\);/);
    });

    it('validates the bundle against the manifest in single mode', function () {
        assert.match(src, /is not registered inside `@'/);
    });

    it('errors when a single connector is declared nowhere', function () {
        assert.match(src, /not found in/);
        assert.match(src, /Run `gina connector:list @'/);
    });
});


// ---------------------------------------------------------------------------
// 05 — evaluateConnector (config / driver / secrets)
// ---------------------------------------------------------------------------

describe('05 - evaluateConnector', function () {

    it('config check resolves the driver via the registry', function () {
        assert.match(src, /registry\.getAIDriver\(scheme\)/);
        assert.match(src, /registry\.getDriver\(type\)/);
        assert.match(src, /name\s*:\s*'config'/);
    });

    it('driver check probes <project>/node_modules/<driver>/package.json', function () {
        assert.match(src, /'\/node_modules\/' \+ driverNpm \+ '\/package\.json'/);
        assert.match(src, /name\s*:\s*'driver'/);
        assert.match(src, /not installed — run `npm install /);
    });

    it('secrets check enumerates ${secret:KEY} via getRequiredKeys + env presence', function () {
        assert.match(src, /secrets\.getRequiredKeys\(entry\)/);
        assert.match(src, /typeof process\.env\[key\] === 'string' && process\.env\[key\] !== ''/);
        assert.match(src, /name\s*:\s*'secrets'/);
    });

    it('records per-key SET/UNSET status without printing the value', function () {
        assert.match(src, /statuses\.push\(\{ key: keys\[ki\], set: ok \}\)/);
        // the secret VALUE is never read into output — only env presence + key name
        assert.doesNotMatch(src, /process\.env\[key\]\s*\)/);
    });
});


// ---------------------------------------------------------------------------
// 06 — the connect gate (ai only this release)
// ---------------------------------------------------------------------------

describe('06 - connect gate', function () {

    it('the connect check is added only when --connect is set', function () {
        assert.match(src, /if \(self\.doConnect\)/);
    });

    it('DB/cache connectors report the live probe as SKIPPED', function () {
        assert.match(src, /skipped\s*:\s*true/);
        assert.match(src, /probe not yet available/);
    });

    it('ai connectors run a probe only when config/driver/secrets pass', function () {
        assert.match(src, /if \(driver\.type === 'ai'\)/);
        assert.match(src, /if \(configOk && driverOk && allSet\)/);
    });
});


// ---------------------------------------------------------------------------
// 07 — probeAI (zero-token guarantee: models.list, never infer)
// ---------------------------------------------------------------------------

describe('07 - probeAI bootstrap', function () {

    it('points getPath(project) at the target project before instantiation', function () {
        assert.match(src, /setPath\('project', projectPath\);/);
    });

    it('requires the AI connector class via a relative path (version-agnostic)', function () {
        assert.match(src, /require\('\.\.\/\.\.\/\.\.\/core\/connectors\/ai\/lib\/connector'\)/);
    });

    it('resolves secrets on a COPY (never mutating the caller entry)', function () {
        assert.match(src, /secrets\.resolve\(probeEntry\)/);
        assert.match(src, /connector = new AIConnector\(probeEntry\);/);
        assert.match(src, /connector\.onReady\(function \(err, conn\)/);
    });

    it('probes connectivity with client.models.list (a credentialed, zero-token GET)', function () {
        assert.match(src, /typeof client\.models\.list !== 'function'/);
        assert.match(src, /client\.models\.list\(\)/);
    });

    it('NEVER runs an inference — --connect spends zero generation tokens', function () {
        assert.doesNotMatch(src, /core\/connectors\/ai\/index/); // does not load the AI() wrapper
        assert.doesNotMatch(src, /\.infer\(/);
        assert.doesNotMatch(src, /messages\.create/);
    });

    it('reports inconclusive (skipped) rather than a paid fallback when models.list is absent', function () {
        assert.match(src, /provider client exposes no models\.list/);
    });

    it('bounds the probe with a timeout', function () {
        assert.match(src, /var CONNECT_TIMEOUT_MS = \d+;/);
        assert.match(src, /connect timed out after /);
    });
});


// ---------------------------------------------------------------------------
// 08 — finalize / exit code
// ---------------------------------------------------------------------------

describe('08 - finalize + exit code', function () {

    it('awaits all async probes via Promise.all', function () {
        assert.match(src, /Promise\.all\(tasks\)/);
    });

    it('exits 0 when all pass, 1 when any connector failed', function () {
        assert.match(src, /process\.exit\(self\.anyFail \? 1 : 0\);/);
    });

    it('computeOk skips skipped checks and fails on a non-ok check', function () {
        assert.match(src, /if \(c\.skipped === true\) continue;/);
        assert.match(src, /if \(c\.ok !== true\) return false;/);
    });
});


// ---------------------------------------------------------------------------
// 09 — emit (json / text)
// ---------------------------------------------------------------------------

describe('09 - emit', function () {

    it('emits the JSON report under --format=json', function () {
        assert.match(src, /JSON\.stringify\(report, null, 2\)/);
    });

    it('renders a PASS/FAIL line per connector + a pass/fail summary', function () {
        assert.match(src, /r\.ok \? 'PASS' : 'FAIL'/);
        assert.match(src, /' passed, ' \+/);
    });
});


// ---------------------------------------------------------------------------
// 10 — arguments.json
// ---------------------------------------------------------------------------

describe('10 - arguments.json', function () {

    it('parses to an array', function () {
        assert.ok(Array.isArray(argsArr));
    });

    it('registers --connect (the live-probe opt-in)', function () {
        assert.ok(argsArr.indexOf('--connect') > -1, '--connect must be registered');
    });

    it('relies on the existing shared --format flag', function () {
        assert.ok(argsArr.indexOf('--format') > -1, '--format must be registered');
    });
});


// ---------------------------------------------------------------------------
// 11 — help.txt + bin/cli registration
// ---------------------------------------------------------------------------

describe('11 - help + cli registration', function () {

    it('help.txt documents the test actions', function () {
        assert.match(helpTxt, /test <connector> @<project>/);
        assert.match(helpTxt, /test <connector> <bundle> @<project>/);
        assert.match(helpTxt, /test @<project>/);
    });

    it('help.txt documents the test options block + --connect semantics', function () {
        assert.match(helpTxt, /Options \(test\):/);
        assert.match(helpTxt, /--connect\b/);
        assert.match(helpTxt, /models\.list/);
        assert.match(helpTxt, /ZERO generation tokens/);
    });

    it('help.txt shows test examples', function () {
        assert.match(helpTxt, /gina connector:test @myproject/);
        assert.match(helpTxt, /gina connector:test claude @myproject --connect/);
    });

    it('bin/cli registers `connector:` in allowedOffline (test dispatches offline)', function () {
        assert.match(cliSrc, /allowedOffline\s*=\s*\[[\s\S]*?'connector:'[\s\S]*?\]/);
    });
});


// ===========================================================================
// Pure-logic replicas — exercise the handler's OWN decision logic with real
// inputs. (The merge/select logic is the resolver's — see
// connector-config.test.js.)
// ===========================================================================

// Mirrors test.js extractPositionals.
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

// Mirrors test.js computeOk (skipped checks never fail the connector).
function computeOk(checks) {
    for (var i = 0; i < checks.length; i++) {
        var c = checks[i];
        if (c.skipped === true) continue;
        if (c.ok !== true) return false;
    }
    return true;
}

// Mirrors test.js isEnvSet (env source injected for testability).
function isEnvSet(key, source) {
    return typeof source[key] === 'string' && source[key] !== '';
}

// Mirrors evaluateConnector's secrets block.
function secretsCheck(keys, env) {
    var statuses = [];
    var allSet   = true;
    var setCount = 0;
    for (var i = 0; i < keys.length; i++) {
        var ok = isEnvSet(keys[i], env);
        if (ok) { setCount++; } else { allSet = false; }
        statuses.push({ key: keys[i], set: ok });
    }
    var detail = (keys.length === 0)
        ? 'no secrets required'
        : (keys.length + ' required: ' + setCount + ' set, ' + (keys.length - setCount) + ' unset');
    return { ok: allSet, detail: detail, keys: statuses };
}

// Mirrors evaluateConnector's driver block.
function driverStatus(driver, installed, version) {
    if (!driver || driver.unresolved) return { ok: false, detail: 'driver unresolved — fix the connector type / protocol first' };
    if (driver.builtin)               return { ok: true,  detail: driver.note || 'built-in' };
    if (installed)                    return { ok: true,  detail: driver.npm + (version ? (' ' + version) : '') + ' installed' };
    return { ok: false, detail: driver.npm + ' not installed — run `npm install ' + driver.npm + '`' };
}

// Mirrors evaluateConnector's connect-gate decision.
function connectDecision(type, doConnect, configOk, driverOk, allSet) {
    if (!doConnect) return 'none';
    if (type === 'ai') {
        if (configOk && driverOk && allSet) return 'probe';
        return 'skip-prereq';
    }
    return 'skip-nonai';
}

// Mirrors the emitText pass/fail summary.
function summarize(results) {
    var pass = 0, fail = 0;
    for (var i = 0; i < results.length; i++) {
        if (results[i].ok) { pass++; } else { fail++; }
    }
    return { total: pass + fail, passed: pass, failed: fail };
}


describe('12 - extractPositionals (replica)', function () {

    it('returns the connector name only', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:test', 'claude', '@proj', '--connect']), ['claude']);
    });

    it('returns [connector, bundle] in order', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:test', 'claude', 'api', '@proj']), ['claude', 'api']);
    });

    it('is empty for the all-in-project mode', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:test', '@proj', '--format=json']), []);
    });

    it('skips @tokens and flags regardless of position', function () {
        assert.deepEqual(extractPositionals(['node', 'cli', 'connector:test', '@proj', '--connect', 'claude', '--format=json', 'api']), ['claude', 'api']);
    });
});


describe('13 - computeOk (replica)', function () {

    it('passes when every non-skipped check is ok', function () {
        assert.equal(computeOk([{ ok: true }, { ok: true }, { ok: true }]), true);
    });

    it('fails when any non-skipped check is not ok', function () {
        assert.equal(computeOk([{ ok: true }, { ok: false }]), false);
    });

    it('a skipped check never fails the connector', function () {
        assert.equal(computeOk([{ ok: true }, { ok: null, skipped: true }]), true);
    });

    it('an unfilled (null, non-skipped) check fails until resolved', function () {
        assert.equal(computeOk([{ ok: true }, { ok: null, skipped: false }]), false);
    });
});


describe('14 - secretsCheck (replica)', function () {

    it('passes with "no secrets required" when there are no placeholders', function () {
        assert.deepEqual(secretsCheck([], {}), { ok: true, detail: 'no secrets required', keys: [] });
    });

    it('passes and reports the count when every key is set', function () {
        var r = secretsCheck(['ANTHROPIC_API_KEY'], { ANTHROPIC_API_KEY: 'sk-x' });
        assert.equal(r.ok, true);
        assert.equal(r.detail, '1 required: 1 set, 0 unset');
        assert.deepEqual(r.keys, [{ key: 'ANTHROPIC_API_KEY', set: true }]);
    });

    it('fails when a required key is unset or empty', function () {
        var r = secretsCheck(['A', 'B'], { A: 'x', B: '' });
        assert.equal(r.ok, false);
        assert.equal(r.detail, '2 required: 1 set, 1 unset');
        assert.deepEqual(r.keys, [{ key: 'A', set: true }, { key: 'B', set: false }]);
    });
});


describe('15 - driverStatus (replica)', function () {

    it('ok for a built-in driver (sqlite)', function () {
        assert.deepEqual(driverStatus({ builtin: true, note: 'Node.js >= 22.5.0 built-in (node:sqlite)' }), { ok: true, detail: 'Node.js >= 22.5.0 built-in (node:sqlite)' });
    });

    it('ok with version when the npm driver is installed', function () {
        assert.deepEqual(driverStatus({ npm: 'ioredis' }, true, '5.4.1'), { ok: true, detail: 'ioredis 5.4.1 installed' });
    });

    it('fails with an install hint when the driver is missing', function () {
        assert.deepEqual(driverStatus({ npm: 'mysql2' }, false), { ok: false, detail: 'mysql2 not installed — run `npm install mysql2`' });
    });

    it('fails when the connector type / protocol is unresolved', function () {
        assert.deepEqual(driverStatus({ unresolved: true }), { ok: false, detail: 'driver unresolved — fix the connector type / protocol first' });
    });
});


describe('16 - connectDecision (replica)', function () {

    it('no connect check without --connect', function () {
        assert.equal(connectDecision('ai', false, true, true, true), 'none');
        assert.equal(connectDecision('mysql', false, true, true, true), 'none');
    });

    it('ai probes only when prerequisites pass', function () {
        assert.equal(connectDecision('ai', true, true, true, true), 'probe');
        assert.equal(connectDecision('ai', true, true, false, true), 'skip-prereq');
        assert.equal(connectDecision('ai', true, true, true, false), 'skip-prereq');
    });

    it('DB/cache connectors are skipped this release', function () {
        assert.equal(connectDecision('mysql', true, true, true, true), 'skip-nonai');
        assert.equal(connectDecision('redis', true, true, true, true), 'skip-nonai');
    });
});


describe('17 - summarize (replica)', function () {

    it('counts passes and failures', function () {
        assert.deepEqual(summarize([{ ok: true }, { ok: false }, { ok: true }]), { total: 3, passed: 2, failed: 1 });
    });

    it('is zeroed for an empty project', function () {
        assert.deepEqual(summarize([]), { total: 0, passed: 0, failed: 0 });
    });
});


// ---------------------------------------------------------------------------
// 18 — envvar check (inert bare ${ENV_VAR} placeholders)
// ---------------------------------------------------------------------------

describe('18 - envvar (inert placeholder) check', function () {

    it('declares the anchored UPPER_SNAKE inert-placeholder regex', function () {
        assert.match(src, /var INERT_PLACEHOLDER_RE\s*=\s*\//);
        // the UPPER_SNAKE class excludes ${secret:KEY} (lowercase prefix + colon)
        // and lowercase whisper templates (${bundle}, ${host}, …)
        assert.match(src, /\[A-Z_\]\[A-Z0-9_\]\*/);
    });

    it('collectInertPlaceholders walks nested values and matches the regex', function () {
        assert.match(src, /var collectInertPlaceholders = function \(node, path, out\)/);
        assert.match(src, /INERT_PLACEHOLDER_RE\.test\(node\)/);
    });

    it('adds an `envvar` check that fails on any inert placeholder', function () {
        assert.match(src, /var inert = collectInertPlaceholders\(entry\);/);
        assert.match(src, /name\s*:\s*'envvar'/);
        assert.match(src, /ok\s*:\s*inert\.length === 0/);
    });

    it('surfaces the fix (use ${secret:KEY}) and echoes the literal token (not a secret)', function () {
        assert.match(src, /use \$\{secret:KEY\}/);
        assert.match(src, /p\.path \+ '=' \+ p\.value/);
    });
});


// ---------------------------------------------------------------------------
// 19 — missing project path fails (not a silent pass)
// ---------------------------------------------------------------------------

// NOTE: single-project / bare-invocation missing-path is NOT handled by a
// connector:test check — it already exits non-zero earlier, inside the shared
// isCmdConfigured() → loadAssets() (ENOENT writing manifest.json to the gone
// dir). self.projectName is not resolved until inside that call, so a clean
// pre-emptive guard here is infeasible without a shared-infra change. The
// defensive guard below covers the testAllProjects code path.
//
// #B59 update (2026-07-01): that shared-infra change SHIPPED (`helper.js` now
// degrades a corrupt / gone / empty `.path` to a clean exit — "path no longer
// exists — re-add / remove --force" — instead of a `console.emerg` stack-dump).
// Re-measured via an isolated-home smoke: a TARGETED `connector:test` /
// `connector:infer @<empty-or-gone-path>` is pre-empted inside
// `isCmdConfigured()` -> `loadAssets()` BEFORE this handler's `.path` read
// (init / testSingle / testProject), so the reverted NIT-4 empty-path guard
// stays correctly unreachable dead code — now clean-pre-empted, not
// crash-pre-empted. See `bug-fixes.md #B59` / `cli-handlers.md §30`-§31.
describe('19 - missing project path (defensive testAllProjects guard)', function () {

    it('all-projects mode flips anyFail on a missing path (so the run exits non-zero)', function () {
        assert.match(src, /if \( !ppath \|\| !fs\.existsSync\(ppath\) \) \{\s*self\.anyFail = true;/);
        assert.match(src, /status: 'missing'/);
    });

    it('renders the missing path as a FAIL in text output', function () {
        assert.match(src, /\(project path missing — FAIL\)/);
    });
});


// ===========================================================================
// Pure-logic replica — the inert-placeholder detector (Narrow: whole-string
// UPPER_SNAKE, excludes ${secret:} and lowercase whisper templates).
// ===========================================================================

// Mirrors test.js INERT_PLACEHOLDER_RE + collectInertPlaceholders.
var INERT_RE = /^\$\{[A-Z_][A-Z0-9_]*\}$/;
function collectInert(node, path, out) {
    out  = out  || [];
    path = path || '';
    if (node == null) return out;
    if (typeof node === 'string') {
        if (INERT_RE.test(node)) out.push({ path: path || '(value)', value: node });
        return out;
    }
    if (typeof node === 'object') {
        for (var k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k)) {
                collectInert(node[k], path ? (path + '.' + k) : k, out);
            }
        }
    }
    return out;
}


describe('20 - collectInert (replica)', function () {

    it('flags a bare ${ENV_VAR} apiKey', function () {
        var r = collectInert({ connector: 'ai', protocol: 'anthropic://', apiKey: '${ANTHROPIC_API_KEY}' });
        assert.deepEqual(r, [{ path: 'apiKey', value: '${ANTHROPIC_API_KEY}' }]);
    });

    it('does NOT flag a ${secret:KEY} placeholder (the working form)', function () {
        assert.deepEqual(collectInert({ apiKey: '${secret:ANTHROPIC_API_KEY}' }), []);
    });

    it('does NOT flag lowercase whisper templates the framework resolves at load', function () {
        assert.deepEqual(collectInert({ database: '${bundle}', host: '${host}', scope: '${scope}' }), []);
    });

    it('does NOT flag embedded (non-whole-string) or literal values', function () {
        assert.deepEqual(collectInert({ protocol: 'anthropic://', url: 'Bearer ${ANTHROPIC_API_KEY}', model: 'claude-x' }), []);
    });

    it('walks nested values and reports a dotted path', function () {
        assert.deepEqual(
            collectInert({ options: { auth: { apiKey: '${OPENAI_API_KEY}' } } }),
            [{ path: 'options.auth.apiKey', value: '${OPENAI_API_KEY}' }]
        );
    });

    it('collects multiple inert placeholders', function () {
        assert.equal(collectInert({ apiKey: '${A_KEY}', password: '${B_PASS}' }).length, 2);
    });
});
