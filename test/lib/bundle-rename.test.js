/**
 * lib/cmd/bundle/rename.js — renames a bundle IN PLACE within the same project
 * (move src dir + rewrite name footprint + rekey manifest/env/ports preserving
 * the port numbers), snapshot-guarded for rollback.
 *
 * Source-inspection tests (same style as bundle-copy.test.js): the handler runs
 * in the CLI daemon context and mutates the filesystem + ~/.gina registry, so
 * these assertions prove the source structure of:
 *
 *   (a) module shape + CmdHelper wiring + shared-engine delegation
 *   (b) two-positional parsing (old + new via self.bundles, NOT self.name)
 *   (c) validation (source===dest, isValidName, source-exists, dest-existence)
 *   (d) refuse-if-running guard (readPidfile; NO --force bypass)
 *   (e) mutation flow + ordering (move dir -> rewrite -> env -> manifest ->
 *       ports.json -> ports.reverse.json LAST)
 *   (f) port REKEY operators (preserve numbers; avoid the project/rename.js bugs)
 *   (g) snapshot + rollback
 *   (h) dry-run + JSON output + help/arguments
 *
 * Sections 14-16 are pure-logic replicas of the genuinely new bits — the port
 * forward/reverse rekey and the order-preserving rekeyInPlace. Sections 06-08
 * source-pins lock the operators so the replicas cannot silently drift.
 *
 * NOTE on the running guard: the refuse-if-running path cannot be exercised by a
 * live CLI smoke in this environment — `gina` re-execs into a process whose
 * filesystem view does not share the test shell's sandbox, so a shell-written
 * pidfile is invisible to the handler. readPidfile itself is proven in
 * bundle-status/cmd-status-format tests; here it is locked by source-pins (§06)
 * + a pure-logic decision replica (§15).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var RENAME_SOURCE = path.join(require('../fw'), 'lib/cmd/bundle/rename.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/bundle/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/bundle/arguments.json');

var src     = fs.readFileSync(RENAME_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape + delegation
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Rename constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Rename;?/);
    });

    it('declares a function Rename(opt, cmd)', function () {
        assert.match(src, /function\s+Rename\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('wires CmdHelper and gates on isCmdConfigured()', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
        assert.match(src, /if \(!isCmdConfigured\(\)\) return false;/);
    });

    it('reuses the shared name-rewrite engine (no inline regex engine)', function () {
        assert.match(src, /var nameRewrite = require\('\.\/inc\/name-rewrite'\)/);
        assert.doesNotMatch(src, /var renameContent = function/);
    });
});


// ---------------------------------------------------------------------------
// 02 — two-positional parsing
// ---------------------------------------------------------------------------

describe('02 - two-positional parsing', function () {

    it('reads BOTH names from self.bundles (not self.name)', function () {
        assert.match(src, /var bundles = self\.bundles \|\| \[\]/);
        assert.match(src, /local\.source\s*=\s*bundles\[0\]/);
        assert.match(src, /local\.dest\s*=\s*bundles\[1\]/);
    });

    it('requires exactly two positionals', function () {
        assert.match(src, /bundles\.length !== 2/);
        assert.match(src, /requires an old AND a new name/);
    });
});


// ---------------------------------------------------------------------------
// 03 — project guard + loadAssets
// ---------------------------------------------------------------------------

describe('03 - project guard', function () {

    it('rejects an unregistered project + calls loadAssets()', function () {
        assert.match(src, /typeof\(self\.projects\[self\.projectName\]\) == 'undefined'/);
        assert.match(src, /is not a registered project/);
        assert.match(src, /loadAssets\(\);/);
    });
});


// ---------------------------------------------------------------------------
// 04 — flags
// ---------------------------------------------------------------------------

describe('04 - flags', function () {

    it('reads dry-run / force / format from self.params', function () {
        assert.match(src, /var dryRun\s*=\s*!!p\['dry-run'\]/);
        assert.match(src, /var force\s*=\s*!!p\['force'\]/);
        assert.match(src, /var format\s*=\s*p\['format'\] \|\| null/);
    });
});


// ---------------------------------------------------------------------------
// 05 — validation
// ---------------------------------------------------------------------------

describe('05 - validation', function () {

    it('rejects identical names + invalid dest name', function () {
        assert.match(src, /source === dest/);
        assert.match(src, /are identical/);
        assert.match(src, /!isValidName\(dest\)/);
    });

    it('requires the source bundle registered + on disk', function () {
        assert.match(src, /self\.bundlesByProject\[project\]/);
        assert.match(src, /is not registered inside/);
        assert.match(src, /!fs\.existsSync\(srcPath\)/);
    });

    it('refuses an existing destination unless --force', function () {
        assert.match(src, /isDefined\('bundle', dest\)/);
        assert.match(src, /destExists && !force/);
        assert.match(src, /already exists inside/);
    });
});


// ---------------------------------------------------------------------------
// 06 — refuse-if-running guard (no --force bypass)
// ---------------------------------------------------------------------------

describe('06 - running guard', function () {

    it('reads the run state via cmdStatusFormat.readPidfile', function () {
        assert.match(src, /GINA_RUNDIR.*GINA_HOMEDIR \+ '\/run'/);
        assert.match(src, /lib\.cmdStatusFormat\.readPidfile\(runDir, source, project\)/);
    });

    it('refuses when running — and is NOT gated on force (no bypass)', function () {
        assert.match(src, /if \( runState\.running \)/);
        assert.match(src, /is running \(pid/);
        assert.match(src, /Stop it first/);
        // the running guard block must not mention force
        var guard = src.slice(src.indexOf('runState.running'), src.indexOf('runState.running') + 320);
        assert.doesNotMatch(guard, /force/);
    });
});


// ---------------------------------------------------------------------------
// 07 — mutation flow + ordering
// ---------------------------------------------------------------------------

describe('07 - mutation flow', function () {

    it('moves the dir with renameSync, then rewrites (fixWebroot OFF)', function () {
        assert.match(src, /new _\(local\.srcDir\)\.renameSync\(local\.destDir\)/);
        assert.match(src, /local\.dirMoved = true/);
        assert.match(src, /nameRewrite\.renameContent\(content, source, dest, \{ fixWebroot: false \}\)/);
    });

    it('rekeys env -> manifest -> ports.json -> ports.reverse.json (reverse LAST)', function () {
        var iEnv = src.indexOf('rekey env.json');
        var iManifest = src.indexOf('rekey manifest.json');
        var iPorts = src.indexOf('rekey ports.json');
        var iReverse = src.indexOf('rekey ports.reverse.json LAST');
        assert.ok(iEnv > 0 && iManifest > iEnv && iPorts > iManifest && iReverse > iPorts);
    });

    it('--force removes the pre-existing destination first', function () {
        assert.match(src, /if \( destExists \) \{\s*\n\s*removeDest\(dest\)/);
    });
});


// ---------------------------------------------------------------------------
// 08 — port rekey operators (avoid the project/rename.js bugs)
// ---------------------------------------------------------------------------

describe('08 - port rekey operators', function () {

    it('ports.json rewrites the value back to the SAME [protocol][scheme][port] slot', function () {
        // NOT ports[protocol][port] (the project/rename.js slot bug)
        assert.match(src, /ports\[protocol\]\[scheme\]\[portKey\] = val\.replace\(oldOwner \+ '\/', newOwner \+ '\/'\)/);
        assert.doesNotMatch(src, /ports\[protocol\]\[portKey\]\s*=/);
    });

    it('matches the value by the anchored <old>@<project>/ owner prefix', function () {
        assert.match(src, /val\.indexOf\(oldOwner \+ '\/'\) === 0/);
        assert.match(src, /oldOwner = source \+ '@' \+ project/);
        assert.match(src, /newOwner = dest \+ '@' \+ project/);
    });

    it('ports.reverse rekeys the BUNDLE key (not a project-wide replace)', function () {
        assert.match(src, /portsReverse\[newOwner\] = portsReverse\[oldOwner\]/);
        assert.match(src, /delete portsReverse\[oldOwner\]/);
    });
});


// ---------------------------------------------------------------------------
// 09 — manifest rekey
// ---------------------------------------------------------------------------

describe('09 - manifest rekey', function () {

    it('clones the entry, repoints src/link/releases, and rekeys in place', function () {
        assert.match(src, /entry\.src\s*=\s*'src\/' \+ dest/);
        assert.match(src, /entry\.link\s*=\s*'bundles\/' \+ dest/);
        assert.match(src, /rel\.target\.replace\('releases\/' \+ source \+ '\/', 'releases\/' \+ dest \+ '\/'\)/);
        assert.match(src, /manifest\.bundles = rekeyInPlace\(manifest\.bundles, source, dest, entry\)/);
    });
});


// ---------------------------------------------------------------------------
// 10 — snapshot + rollback
// ---------------------------------------------------------------------------

describe('10 - rollback', function () {

    it('snapshots the four config surfaces before mutating', function () {
        assert.match(src, /local\.snapshot = \{/);
        assert.match(src, /env\s*:\s*JSON\.clone\(self\.envData\)/);
        assert.match(src, /portsReverse\s*:\s*JSON\.clone\(self\.portsReverseData\)/);
    });

    it('rollback reverses the dir move and restores the four files', function () {
        assert.match(src, /new _\(local\.destDir\)\.renameSync\(local\.srcDir\)/);
        assert.match(src, /createFileFromDataSync\(local\.snapshot\.env, self\.envPath\)/);
        assert.match(src, /createFileFromDataSync\(local\.snapshot\.manifest, self\.projectManifestPath\)/);
        assert.match(src, /createFileFromDataSync\(local\.snapshot\.ports, self\.portsPath\)/);
        assert.match(src, /createFileFromDataSync\(local\.snapshot\.portsReverse, self\.portsReversePath\)/);
    });

    it('the mutation block is wrapped in try/catch -> rollback(err)', function () {
        assert.match(src, /\} catch \(err\) \{\s*\n\s*return rollback\(err\)/);
    });
});


// ---------------------------------------------------------------------------
// 11 — dry-run + JSON output + help/arguments
// ---------------------------------------------------------------------------

describe('11 - dry-run + output + help', function () {

    it('dry-run runs AFTER the running guard and previews without writing', function () {
        assert.ok(src.indexOf('runState.running') < src.indexOf('return report(true, format'));
        assert.match(src, /previewRewrite\(srcPath, source\)/);
        assert.match(src, /would rename bundle/);
    });

    it('emits a JSON envelope with --format=json', function () {
        assert.match(src, /\/\^json\?\/\.test\(format \|\| ''\)/);
        assert.match(src, /process\.stdout\.write\(JSON\.stringify\(\{/);
    });

    it('help.txt documents bundle:rename; arguments.json has the flags', function () {
        assert.match(helpTxt, /bundle:rename/);
        assert.ok(argsArr.indexOf('--dry-run') > -1);
        assert.ok(argsArr.indexOf('--force') > -1);
        assert.ok(argsArr.indexOf('--format') > -1);
    });
});


// ---------------------------------------------------------------------------
// 14 — pure-logic replica: ports.json forward rekey (preserve numbers)
// ---------------------------------------------------------------------------

describe('14 - ports.json forward rekey replica', function () {

    function rekeyForward(ports, source, dest, project) {
        var oldOwner = source + '@' + project, newOwner = dest + '@' + project;
        for (var protocol in ports) {
            for (var scheme in ports[protocol]) {
                for (var portKey in ports[protocol][scheme]) {
                    var val = ports[protocol][scheme][portKey];
                    if (typeof(val) === 'string' && val.indexOf(oldOwner + '/') === 0) {
                        ports[protocol][scheme][portKey] = val.replace(oldOwner + '/', newOwner + '/');
                    }
                }
            }
        }
        return ports;
    }

    it('rewrites the owner in values, preserving the port-number KEYS', function () {
        var ports = {
            'http/1.1': { http: { '3106': 'api@proj/dev', '3109': 'api@proj/prod' }, https: { '3107': 'api@proj/dev' } },
            'http/2.0': { https: { '3108': 'api@proj/dev' } }
        };
        rekeyForward(ports, 'api', 'web', 'proj');
        // same port keys, owner rewritten
        assert.equal(ports['http/1.1'].http['3106'], 'web@proj/dev');
        assert.equal(ports['http/1.1'].http['3109'], 'web@proj/prod');
        assert.equal(ports['http/1.1'].https['3107'], 'web@proj/dev');
        assert.equal(ports['http/2.0'].https['3108'], 'web@proj/dev');
        // no stale api refs
        assert.equal(JSON.stringify(ports).indexOf('api@proj'), -1);
    });

    it('does NOT touch a sibling bundle whose name is a prefix (anchored match)', function () {
        var ports = { 'http/1.1': { http: { '3106': 'apibundle@proj/dev', '3107': 'api@proj/dev' } } };
        rekeyForward(ports, 'api', 'web', 'proj');
        assert.equal(ports['http/1.1'].http['3106'], 'apibundle@proj/dev'); // untouched
        assert.equal(ports['http/1.1'].http['3107'], 'web@proj/dev');       // rekeyed
    });

    it('does NOT touch a same-name bundle in a different project', function () {
        var ports = { 'http/1.1': { http: { '3106': 'api@other/dev', '3107': 'api@proj/dev' } } };
        rekeyForward(ports, 'api', 'web', 'proj');
        assert.equal(ports['http/1.1'].http['3106'], 'api@other/dev'); // untouched
        assert.equal(ports['http/1.1'].http['3107'], 'web@proj/dev');  // rekeyed
    });
});


// ---------------------------------------------------------------------------
// 15 — pure-logic replica: ports.reverse rekey + rekeyInPlace + running decision
// ---------------------------------------------------------------------------

describe('15 - reverse rekey + rekeyInPlace + running decision', function () {

    function rekeyInPlace(obj, oldKey, newKey, newValue) {
        var out = {};
        for (var k in obj) {
            if (k === oldKey) out[newKey] = newValue;
            else out[k] = obj[k];
        }
        return out;
    }

    it('ports.reverse: renames the bundle key, preserving the port subtree', function () {
        var pr = {
            'api@proj': { dev: { 'http/1.1': { http: 3106, https: 3107 } } },
            'other@proj': { dev: { 'http/1.1': { http: 3200 } } }
        };
        var oldOwner = 'api@proj', newOwner = 'web@proj';
        var out = JSON.parse(JSON.stringify(pr));
        out[newOwner] = out[oldOwner]; delete out[oldOwner];
        assert.deepEqual(out['web@proj'], pr['api@proj']);   // numbers preserved
        assert.equal(typeof out['api@proj'], 'undefined');   // old gone
        assert.deepEqual(out['other@proj'], pr['other@proj']); // sibling untouched
    });

    it('rekeyInPlace preserves the position of the renamed key', function () {
        var bundles = { a: 1, api: { v: 2 }, z: 3 };
        var out = rekeyInPlace(bundles, 'api', 'web', { v: 2, renamed: true });
        assert.deepEqual(Object.keys(out), ['a', 'web', 'z']); // web takes api's slot
        assert.deepEqual(out.web, { v: 2, renamed: true });
    });

    it('running decision: running -> refuse, stopped -> proceed', function () {
        function decide(runState) { return runState.running ? 'refuse' : 'proceed'; }
        assert.equal(decide({ running: true, pid: 123 }), 'refuse');
        assert.equal(decide({ running: false, pid: null }), 'proceed');
    });
});
