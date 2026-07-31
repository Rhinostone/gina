'use strict';
/**
 * #B181(a) — a project `env.json` block that did not itself declare `host`
 * produced an UNRESOLVED template token inside a filesystem path.
 *
 * Mechanism (measured 2026-07-31, live isolated prod/https boot, single-variable
 * subtract in both directions — control 200 → partial block dead → revert 200):
 * `loadWithTemplate` builds its substitution dictionary from the merged
 * bundle/env block (core/config.js, the `reps` literal) and `host` was the ONLY
 * key it reads off that block with NO framework-side default — absent from both
 * core/template/conf/env.json and core/template/conf/settings.json. Its value
 * was written exclusively by the CLI into the PROJECT's env.json
 * (lib/cmd/helper.js, `content[bundle][env].host = "localhost"`), so a
 * hand-written or partial block left it `undefined`. `whisper()` preserves an
 * unknown token verbatim and silently — deliberate since #B12, which stopped it
 * erroring on every first-run CLI command — so the credentials paths declared in
 * core/template/conf/settings.json rendered as
 * `.../certificates/scopes/local/${host}/private.key`, and the isaac https read
 * ENOENT'd and exited 1 pointing the operator at "server settings" rather than
 * at the missing env.json key.
 *
 * NOTE the filed cause was REFUTED: `lib/merge` does not replace-instead-of-fill
 * on this path. All of loadWithTemplate's merges are override-off, i.e. deep,
 * target-wins fills — verified by driving the real lib in §02. The defect was a
 * missing default, not a clobbering merge.
 *
 * The fix gives the env template the same `localhost` default the CLI already
 * writes, so the existing (correct) fill supplies it, plus a warn so an omitted
 * declaration stays visible instead of silently becoming localhost.
 *
 * Safety property: the change is inert for any configuration that boots today —
 * it can only materialise where `host` was undefined, which is a guaranteed boot
 * failure. §02's blast-radius control asserts a DECLARED host survives untouched.
 *
 * §01 — the template carries the default (data pins + parser control).
 * §02 — BEHAVIORAL: the real merge chain, real lib/merge, real template files —
 *       a partial block ends up with the default; a declared host is preserved;
 *       and a template with the key removed yields `undefined` (the arm that
 *       proves these assertions discriminate rather than pass vacuously).
 * §03 — the warn reads the RAW user block, so it can actually fire.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW    = require('../fw');
var merge = require(path.join(FW, 'lib/merge/src/main.js'));

var ENV_TPL_PATH      = path.join(FW, 'core/template/conf/env.json');
var SETTINGS_TPL_PATH = path.join(FW, 'core/template/conf/settings.json');

var ENV_TPL_SRC = fs.readFileSync(ENV_TPL_PATH, 'utf8');
var CONFIG_SRC  = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');
var HELPER_SRC  = fs.readFileSync(path.join(FW, 'lib/cmd/helper.js'), 'utf8');

// These templates are human-authored and carry `//` + `/* */` comments, so they
// are read at runtime by the comment-tolerant `requireJSON`. The framework
// helpers open an MQ socket on load, which has no place in the gated suite, so
// this file strips comments locally instead. The string-literal alternation
// keeps a `//` inside a JSON string (e.g. a URL) from being treated as a
// comment. §01's first test is the control that this parser actually worked.
function readJSONish(p) {
    var s = fs.readFileSync(p, 'utf8');
    s = s.replace(/"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, function (m) {
        return m[0] === '"' ? m : '';
    });
    return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1'));
}

var ENV_TPL      = readJSONish(ENV_TPL_PATH);
var SETTINGS_TPL = readJSONish(SETTINGS_TPL_PATH);
var TPL_BLOCK    = ENV_TPL['${bundle}'] && ENV_TPL['${bundle}']['${env}'];

// ─── 01 — the template carries the default ───────────────────────────────────
describe('#B181(a) §01 — the env template declares a `host` default for every bundle/env', function () {

    it('the local JSON parser resolved the template (instrument control)', function () {
        assert.ok(TPL_BLOCK, 'the ${bundle}.${env} block must parse');
        // Known-present neighbours: if the parser silently produced a partial
        // object these would be missing too, and every later assertion would be
        // measuring nothing.
        assert.ok(Object.prototype.hasOwnProperty.call(TPL_BLOCK, 'rootDomain'));
        assert.ok(Object.prototype.hasOwnProperty.call(TPL_BLOCK, 'server'));
        assert.ok(Object.prototype.hasOwnProperty.call(TPL_BLOCK, 'bundlesPath'));
        // Known-ABSENT control: proves membership testing can report false.
        assert.equal(Object.prototype.hasOwnProperty.call(TPL_BLOCK, 'nosuchkey'), false);
    });

    it('the per-bundle block declares `host`', function () {
        assert.ok(Object.prototype.hasOwnProperty.call(TPL_BLOCK, 'host'),
            '`host` is read into the substitution dictionary; without a default here a partial '
            + 'env.json block leaves the ${host} token unresolved inside the credentials paths');
    });

    it('the default is a non-empty string carrying no unresolved token', function () {
        assert.equal(typeof TPL_BLOCK.host, 'string');
        assert.ok(TPL_BLOCK.host.length > 0, 'an empty host substitutes to an empty path segment');
        assert.doesNotMatch(TPL_BLOCK.host, /\$\{/,
            'a token here would need its own dictionary entry and could reintroduce the defect');
    });

    it('it matches the value the CLI already writes into a project env.json', function () {
        assert.equal(TPL_BLOCK.host, 'localhost');
        assert.ok(HELPER_SRC.indexOf('content[bundle][env].host = "localhost"') > -1,
            'the template default must not diverge from lib/cmd/helper.js, or a scaffolded '
            + 'project and a partial one would resolve different hosts');
    });
});

// ─── 02 — BEHAVIORAL: the real merge chain ───────────────────────────────────
// Mirrors loadWithTemplate's merge ORDER and ARGUMENT order. The merges execute
// the real lib/merge against the real template files, so what is replicated here
// is only the call sequence, not the merge semantics.
function mergeChain(userBlock, envTplBlock) {
    var bundleSettings = { webroot: '/web', protocol: 'http/1.1', scheme: 'https' };
    var b = JSON.parse(JSON.stringify(userBlock));
    b = merge(bundleSettings, b);                                       // config.js :933
    b = merge(b, JSON.parse(JSON.stringify(SETTINGS_TPL)));             // config.js :990
    b = merge(b, JSON.parse(JSON.stringify(envTplBlock)));              // config.js :1100
    return b;
}

// The staked shape: a per-env block that sets one server key and nothing else.
var PARTIAL  = { server: { cache: { enable: true } } };
var DECLARED = { host: 'example.com', host_if_dns_resolution: '${rootDomain}' };

describe('#B181(a) §02 — the default reaches a partial block through the real merge chain', function () {

    it('a partial block that never mentions `host` ends up with the default', function () {
        assert.equal(mergeChain(PARTIAL, TPL_BLOCK).host, 'localhost');
    });

    it('DISCRIMINATION CONTROL: with the key removed from the template, it is undefined', function () {
        var stripped = JSON.parse(JSON.stringify(TPL_BLOCK));
        delete stripped.host;
        assert.equal(mergeChain(PARTIAL, stripped).host, undefined,
            'this arm must be able to fail — it is what proves the assertions above are not vacuous, '
            + 'and it reproduces the pre-fix state exactly');
    });

    it('BLAST-RADIUS CONTROL: a block that DECLARES host keeps its own value', function () {
        assert.equal(mergeChain(DECLARED, TPL_BLOCK).host, 'example.com',
            'the merges are target-wins fills, so every project that boots today is unaffected');
    });

    it('the declared value is preserved identically without the default present', function () {
        var stripped = JSON.parse(JSON.stringify(TPL_BLOCK));
        delete stripped.host;
        assert.equal(mergeChain(DECLARED, stripped).host, 'example.com',
            'pre- and post-fix agree for a declaring block — the change is inert for them');
    });

    it('the partial block keeps its OWN server value while the template fills the siblings', function () {
        var out = mergeChain(PARTIAL, TPL_BLOCK);
        assert.equal(out.server.cache.enable, true, 'the user value must win over the template default');
        assert.equal(out.server.cache.ttl, 3600, 'and the unspecified siblings must still be filled');
        assert.ok(out.server.credentials && out.server.credentials.privateKey,
            'the credentials block survives a partial `server` — the filed "merge clobbers siblings" '
            + 'cause was refuted; the merges deep-fill');
    });

    it('with the default present the credentials path has a resolvable host segment', function () {
        var out = mergeChain(PARTIAL, TPL_BLOCK);
        // whisper() runs later and substitutes ${host} from the dictionary built
        // off this block; what is assertable here is that the dictionary source
        // is now populated, which is the whole of the fix.
        assert.match(out.server.credentials.privateKey, /\$\{host\}/,
            'the template path still carries the token — substitution is whisper\'s job, not the merge\'s');
        assert.equal(typeof out.host, 'string',
            'and the value whisper will read for it is now defined, which it was not before');
    });
});

// ─── 03 — the warn ───────────────────────────────────────────────────────────
describe('#B181(a) §03 — an omitted `host` declaration is reported', function () {

    it('the warn tests the RAW user block, not the merged one', function () {
        // Reading the merged block would make the condition unsatisfiable the
        // moment the template default lands, i.e. the warn would be dead code.
        assert.match(CONFIG_SRC, /typeof\(content\[app\]\[env\]\.host\) == 'undefined'/,
            'the raw `content` object is the only surface that still records whether the '
            + 'project declared `host`');
    });

    it('it names the bundle and the env', function () {
        var at = CONFIG_SRC.indexOf("typeof(content[app][env].host) == 'undefined'");
        assert.ok(at > -1);
        var block = CONFIG_SRC.substring(at, at + 400);
        assert.match(block, /console\.warn\(/);
        assert.ok(block.indexOf("app +']['+ env") > -1 || block.indexOf("app + '][' + env") > -1,
            'the operator needs to know WHICH bundle/env is missing the declaration');
        assert.ok(block.indexOf('env.json') > -1, 'and which file to add it to');
    });

    it('it sits AFTER the template merge, so it can report the value actually applied', function () {
        var mergeAt = CONFIG_SRC.indexOf('template["${bundle}"]["${env}"]))');
        var warnAt  = CONFIG_SRC.indexOf("typeof(content[app][env].host) == 'undefined'");
        assert.ok(mergeAt > -1, 'the template merge must exist');
        assert.ok(warnAt > mergeAt,
            'placed before the merge it could not name the default that was applied');
    });
});
