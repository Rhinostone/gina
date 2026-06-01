/**
 * lib/cmd/protocol/remove.js — reverts a bundle's protocol override to the
 * project default (settings.json-only; no ports*.json mutation).
 *
 * Source-inspection tests (same style as connector-rm.test.js,
 * minion-list.test.js): the handler runs in the CLI daemon context (CmdHelper,
 * globals) and mutates a bundle's settings.json, so these assertions prove the
 * source structure of:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) bundle-scoped guards (requires a bundle; registered project)
 *   (c) settings.json path resolution (loadAssets + bundlesByProject.configPaths)
 *   (d) flag parsing from self.params (--dry-run / --force / --format)
 *   (e) header-preserving read (requireJSON) + write (createFileFromDataSync)
 *   (f) revert decision (nothing-to-remove vs delete the override)
 *   (g) default-protocol port guard
 *   (h) dry-run short-circuit
 *   (i) JSON output shape
 *   (j) help.txt + arguments.json
 *
 * Section 12 is a pure-logic replica of the two genuinely new bits — the
 * port-guard and the revert decision. Sections 06-07 source-pins lock the
 * operators so the replica cannot silently drift.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var REMOVE_SOURCE = path.join(require('../fw'), 'lib/cmd/protocol/remove.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/protocol/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/protocol/arguments.json');

var src     = fs.readFileSync(REMOVE_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));


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

    it('wires CmdHelper and gates on isCmdConfigured()', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
        assert.match(src, /if \(!isCmdConfigured\(\)\) return false;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — bundle-scoped guards
// ---------------------------------------------------------------------------

describe('02 - guards', function () {

    it('requires a bundle positional (bundle-scoped)', function () {
        assert.match(src, /typeof\(self\.name\) == 'undefined' \|\| self\.name == null/);
        assert.match(src, /protocol:remove requires a bundle/);
    });

    it('rejects an unregistered project', function () {
        assert.match(src, /self\.projectName == null \|\| typeof\(self\.projects\[self\.projectName\]\) == 'undefined'/);
        assert.match(src, /is not a registered project/);
    });
});


// ---------------------------------------------------------------------------
// 03 — settings path resolution
// ---------------------------------------------------------------------------

describe('03 - settings path', function () {

    it('calls loadAssets() to populate bundlesByProject', function () {
        assert.match(src, /loadAssets\(\);/);
    });

    it('resolves the settings path from bundlesByProject configPaths', function () {
        assert.match(src, /self\.bundlesByProject\[self\.projectName\]/);
        assert.match(src, /bundleConfig\.configPaths\.settings/);
        assert.match(src, /is not registered inside/);
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
// 05 — header-preserving read/write
// ---------------------------------------------------------------------------

describe('05 - read/write', function () {

    it('read preserves the comment header and parses with requireJSON', function () {
        assert.match(src, /raw\.indexOf\('\{'\)/);
        assert.match(src, /raw\.slice\(0, firstBrace\)/);
        assert.match(src, /requireJSON\(target\)/);
    });

    it('write preserves the header, 4-space body, and evicts require.cache', function () {
        assert.match(src, /JSON\.stringify\(data, null, 4\)/);
        assert.match(src, /\(header \|\| ''\) \+ body \+ '\\n'/);
        assert.match(src, /lib\.generator\.createFileFromDataSync\(text, target\)/);
        assert.match(src, /delete require\.cache\[require\.resolve\(target\)\]/);
    });
});


// ---------------------------------------------------------------------------
// 06 — revert decision (nothing-to-remove vs delete override)
// ---------------------------------------------------------------------------

describe('06 - revert decision', function () {

    it('reads the current override from settings.server', function () {
        assert.match(src, /settings\.server && settings\.server\.protocol/);
        assert.match(src, /settings\.server && settings\.server\.scheme/);
    });

    it('treats "no override" and "override equals default" as nothing-to-remove', function () {
        assert.match(src, /curProtocol == null && curScheme == null/);
        assert.match(src, /has no protocol override/);
        assert.match(src, /curProtocol === defProtocol && curScheme === defScheme/);
        assert.match(src, /already uses the project default/);
    });

    it('deletes exactly the bundle override keys on revert', function () {
        assert.match(src, /delete settings\.server\.protocol;/);
        assert.match(src, /delete settings\.server\.scheme;/);
        assert.match(src, /delete settings\.server\.allowHTTP1;/);
        assert.match(src, /writeSettings\(settingsPath, parsed\.header, settings\)/);
    });

    it('reads the project default protocol/scheme', function () {
        assert.match(src, /projectConf\.def_protocol/);
        assert.match(src, /projectConf\.def_scheme/);
        assert.match(src, /has no default protocol\/scheme/);
    });
});


// ---------------------------------------------------------------------------
// 07 — default-protocol port guard
// ---------------------------------------------------------------------------

describe('07 - port guard', function () {

    it('checks ports.reverse.json for a default-protocol port per env', function () {
        assert.match(src, /self\.name \+ '@' \+ self\.projectName/);
        assert.match(src, /portsReverse\[key\]\[env\]\[defProtocol\]/);
        assert.match(src, /typeof\(portsReverse\[key\]\[env\]\[defProtocol\]\[defScheme\]\) != 'undefined'/);
        assert.match(src, /missing\.push\(env\)/);
    });

    it('refuses when a default-protocol port is missing unless --force', function () {
        assert.match(src, /missingEnvs\.length > 0 && !force/);
        assert.match(src, /has no port allocated for the project default protocol/);
    });

    it('does NOT mutate ports.json / ports.reverse.json (settings.json only)', function () {
        assert.doesNotMatch(src, /createFileFromDataSync\([^,]*ports/i);
        assert.doesNotMatch(src, /portsPath/);
    });
});


// ---------------------------------------------------------------------------
// 08 — dry-run short-circuit
// ---------------------------------------------------------------------------

describe('08 - dry-run', function () {

    it('short-circuits to a preview before any write', function () {
        assert.match(src, /if \( dryRun \) \{\s*\n\s*return report\(curProtocol, curScheme, defProtocol, defScheme, missingEnvs, true, format\)/);
    });

    it('preview wording differs from the revert wording', function () {
        assert.match(src, /would revert/);
        assert.match(src, /Reverted bundle/);
        assert.match(src, /You need to restart your bundle/);
    });
});


// ---------------------------------------------------------------------------
// 09 — JSON output shape
// ---------------------------------------------------------------------------

describe('09 - JSON output', function () {

    it('detects --format=json and emits a from/to envelope', function () {
        assert.match(src, /\/\^json\?\/\.test\(format\)/);
        assert.match(src, /process\.stdout\.write\(JSON\.stringify\(\{/);
        assert.match(src, /forcedMissingPortEnvs/);
    });
});


// ---------------------------------------------------------------------------
// 10 — help + arguments
// ---------------------------------------------------------------------------

describe('10 - help + arguments', function () {

    it('help.txt documents protocol:remove and --dry-run', function () {
        assert.match(helpTxt, /gina protocol:remove <bundle_name> @<project_name>/);
        assert.match(helpTxt, /--dry-run/);
    });

    it('help.txt has no "remouve" typo', function () {
        assert.doesNotMatch(helpTxt, /remouve/);
    });

    it('arguments.json declares --format, --dry-run, --force', function () {
        assert.ok(Array.isArray(argsArr));
        assert.ok(argsArr.indexOf('--format') > -1);
        assert.ok(argsArr.indexOf('--dry-run') > -1);
        assert.ok(argsArr.indexOf('--force') > -1);
    });
});


// ---------------------------------------------------------------------------
// 11 — pure-logic replica: port guard + revert decision
//      (mirrors checkDefaultPort + the remove() decision; §06-07 pins lock them)
// ---------------------------------------------------------------------------

describe('11 - port-guard + decision replica', function () {

    function missingDefaultPortEnvs(portsReverse, key, envs, defProtocol, defScheme) {
        var missing = [];
        for (var i = 0; i < envs.length; i++) {
            var env = envs[i];
            var hasPort = portsReverse[key]
                && portsReverse[key][env]
                && portsReverse[key][env][defProtocol]
                && typeof(portsReverse[key][env][defProtocol][defScheme]) != 'undefined';
            if (!hasPort) missing.push(env);
        }
        return missing;
    }

    function revertDecision(curProtocol, curScheme, defProtocol, defScheme) {
        if (curProtocol == null && curScheme == null) return 'no-override';
        if (curProtocol === defProtocol && curScheme === defScheme) return 'already-default';
        return 'revert';
    }

    // mirrors the on-disk ports.reverse.json shape (full matrix for one bundle)
    var pr = {
        'api@myproject': {
            dev:  { 'http/1.1': { http: 3100, https: 3101 }, 'http/2.0': { https: 3102 } },
            prod: { 'http/1.1': { http: 3103, https: 3104 }, 'http/2.0': { https: 3105 } }
        }
    };

    it('full matrix -> no missing default-protocol ports', function () {
        assert.deepEqual(missingDefaultPortEnvs(pr, 'api@myproject', ['dev', 'prod'], 'http/1.1', 'http'), []);
    });

    it('a missing prod default port is reported', function () {
        var pr2 = JSON.parse(JSON.stringify(pr));
        delete pr2['api@myproject'].prod['http/1.1'].http;
        assert.deepEqual(missingDefaultPortEnvs(pr2, 'api@myproject', ['dev', 'prod'], 'http/1.1', 'http'), ['prod']);
    });

    it('an entirely unknown bundle key -> every env missing', function () {
        assert.deepEqual(missingDefaultPortEnvs(pr, 'ghost@myproject', ['dev', 'prod'], 'http/1.1', 'http'), ['dev', 'prod']);
    });

    it('decision: no server override -> nothing to remove', function () {
        assert.equal(revertDecision(null, null, 'http/1.1', 'http'), 'no-override');
    });

    it('decision: override equals default -> nothing to remove', function () {
        assert.equal(revertDecision('http/1.1', 'http', 'http/1.1', 'http'), 'already-default');
    });

    it('decision: non-default override -> revert', function () {
        assert.equal(revertDecision('http/2.0', 'https', 'http/1.1', 'http'), 'revert');
    });
});
