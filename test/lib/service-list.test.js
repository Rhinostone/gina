/**
 * lib/cmd/service/list.js — argv parsing, manifest reading, port + pidfile lookup
 *
 * Source-inspection tests matching inspector-open.test.js precedent: list.js
 * runs inside the CLI daemon context (CmdHelper, project registry, globals
 * injected by gna.js). Replicating that is heavy for near-zero extra coverage,
 * so these assertions prove the source structure of:
 *
 *   (a) argv loop — `--format=<x>` capture + `@gina`-only gate
 *   (b) manifest lookup — projects.json → gina.path + /manifest.json, .bundles
 *   (c) ports.reverse.json merge — key shape `<svc>@gina`
 *   (d) pickPreferredPort — http/2.0 https → http/1.1 https → http/1.1 http
 *   (e) readPidfile — ~/.gina/run/<svc>@gina.pid + process.kill(pid, 0)
 *   (f) JSON output shape
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var LIST_SOURCE = path.join(require('../fw'), 'lib/cmd/service/list.js');
var HELP_SOURCE = path.join(require('../fw'), 'lib/cmd/service/help.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/service/help.txt');

var src     = fs.readFileSync(LIST_SOURCE, 'utf8');
var helpSrc = fs.readFileSync(HELP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the List constructor', function () {
        assert.match(src, /module\.exports\s*=\s*List;?/);
    });

    it('declares a function List(opt, cmd)', function () {
        assert.match(src, /function\s+List\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('wires CmdHelper with opt.client and debug flags', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
    });

    it('gates on isCmdConfigured()', function () {
        assert.match(src, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — argv loop
// ---------------------------------------------------------------------------

describe('02 - argv parsing', function () {

    it('captures --format=<value>', function () {
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(arg\)/);
        assert.match(src, /self\.format = arg\.split\(\/\\=\/\)\[1\];/);
    });

    it('accepts @-prefixed project tokens', function () {
        assert.match(src, /\/\^@\/\.test\(arg\)/);
    });

    it('rejects any project name other than `gina`', function () {
        assert.match(src, /if\s*\(\s*name\s*!==\s*'gina'\s*\)/);
        assert.match(src, /`service:list` only targets @gina for now/);
    });
});


// ---------------------------------------------------------------------------
// 03 — projects.json + manifest reading
// ---------------------------------------------------------------------------

describe('03 - manifest lookup', function () {

    it('loads projects.json from GINA_HOMEDIR', function () {
        assert.match(src, /self\.projects = require\(_\(GINA_HOMEDIR \+ '\/projects\.json'\)\);/);
    });

    it('reads the `gina` entry from the project registry', function () {
        assert.match(src, /self\.projects\['gina'\]/);
    });

    it('errors when @gina is missing', function () {
        assert.match(src, /@gina project is not registered/);
    });

    it('builds manifest path from gina.path + /manifest.json', function () {
        assert.match(src, /ginaProject\.path \+ '\/manifest\.json'/);
    });

    it('guards manifest existence with fs.existsSync', function () {
        assert.match(src, /if \(\s*!fs\.existsSync\(manifestPath\)\s*\)/);
    });

    it('parses the manifest via requireJSON (handles // and /* */ comments)', function () {
        assert.match(src, /manifest = requireJSON\(manifestPath\);/);
    });

    it('pulls services from manifest.bundles', function () {
        assert.match(src, /var services\s*=\s*manifest\.bundles \|\| \{\};/);
    });
});


// ---------------------------------------------------------------------------
// 04 — ports.reverse.json merge
// ---------------------------------------------------------------------------

describe('04 - ports.reverse.json merge', function () {

    it('reads ports.reverse.json when present', function () {
        assert.match(src, /GINA_HOMEDIR \+ '\/ports\.reverse\.json'/);
        assert.match(src, /portsReverse = requireJSON\(portsPath\);/);
    });

    it('tolerates a missing / malformed ports.reverse.json', function () {
        // fallback = empty object, wrapped in try/catch
        assert.match(src, /var portsReverse\s*=\s*\{\};/);
        assert.match(src, /try\s*\{[\s\S]*portsReverse = requireJSON\(portsPath\);[\s\S]*\}\s*catch\s*\(e\)\s*\{/);
    });

    it('keys into the ports table with `<name>@gina`', function () {
        assert.match(src, /portsReverse\[name \+ '@gina'\]/);
    });
});


// ---------------------------------------------------------------------------
// 05 — pickPreferredPort precedence
// ---------------------------------------------------------------------------

describe('05 - pickPreferredPort precedence', function () {

    it('prefers dev env, falls back to the first env key', function () {
        assert.match(src, /var envKey\s*=\s*ports\.dev\s*\?\s*'dev'\s*:\s*Object\.keys\(ports\)\[0\];/);
    });

    it('first choice: http/2.0 https', function () {
        assert.match(src, /env\['http\/2\.0'\]\s*&&\s*env\['http\/2\.0'\]\.https/);
    });

    it('second choice: http/1.1 https', function () {
        assert.match(src, /env\['http\/1\.1'\]\s*&&\s*env\['http\/1\.1'\]\.https/);
    });

    it('third choice: http/1.1 http', function () {
        assert.match(src, /env\['http\/1\.1'\]\s*&&\s*env\['http\/1\.1'\]\.http\b/);
    });

    it('returns null when no port is available', function () {
        assert.match(src, /if \(!ports\) return null;/);
    });
});


// ---------------------------------------------------------------------------
// 06 — readPidfile (running state)
// ---------------------------------------------------------------------------

describe('06 - readPidfile running state', function () {

    it('reads ~/.gina/run/<name>@gina.pid', function () {
        assert.match(src, /GINA_HOMEDIR \+ '\/run\/' \+ name \+ '@gina\.pid'/);
    });

    it('returns stopped when pidfile is missing', function () {
        assert.match(src, /if \(\s*!fs\.existsSync\(pidPath\)\s*\)\s*\{\s*return \{ running: false, pid: null \};/);
    });

    it('probes the pid with process.kill(pid, 0)', function () {
        assert.match(src, /process\.kill\(pid, 0\);/);
    });

    it('returns stopped on stale pidfile (ESRCH via catch)', function () {
        assert.match(src, /catch \(e\)\s*\{\s*return \{ running: false, pid: null \};/);
    });

    it('rejects negative or NaN pid values', function () {
        assert.match(src, /if \(\s*isNaN\(pid\) \|\| pid <= 0\s*\)/);
    });
});


// ---------------------------------------------------------------------------
// 07 — Output shape
// ---------------------------------------------------------------------------

describe('07 - output shape', function () {

    it('pushes {service, path, status, ports, running, pid} onto json', function () {
        assert.match(src, /service\s*:\s*name,/);
        assert.match(src, /path\s*:\s*src,/);
        assert.match(src, /status\s*:\s*status,/);
        assert.match(src, /ports\s*:\s*ports,/);
        assert.match(src, /running\s*:\s*runState\.running,/);
        assert.match(src, /pid\s*:\s*runState\.pid/);
    });

    it('writes raw JSON via process.stdout.write when --format=json', function () {
        assert.match(src, /\/\^json\?\/\.test\(self\.format\)/);
        assert.match(src, /process\.stdout\.write\(JSON\.stringify\(json\)\);/);
    });

    it('emits [ running ] / [ stopped ] label', function () {
        assert.match(src, /\[ running \]/);
        assert.match(src, /\[ stopped \]/);
    });

    it('appends `pid <n>` for running services', function () {
        assert.match(src, /line \+= '  pid ' \+ runState\.pid;/);
    });

    it('flags missing src with [?! src missing]', function () {
        assert.match(src, /\[\?! src missing\]/);
    });

    it('shows a helpful message when no services are registered', function () {
        assert.match(src, /No services registered under @gina\./);
    });
});


// ---------------------------------------------------------------------------
// 08 — Help module
// ---------------------------------------------------------------------------

describe('08 - help module', function () {

    it('help.js exports a Help constructor', function () {
        assert.match(helpSrc, /module\.exports\s*=\s*Help;?/);
        assert.match(helpSrc, /function\s+Help\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('help.js calls getHelp() after isCmdConfigured()', function () {
        assert.match(helpSrc, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
        assert.match(helpSrc, /getHelp\(\);/);
    });

    it('help.txt documents list and help actions', function () {
        assert.match(helpTxt, /service:list/);
        assert.match(helpTxt, /service:<action>/);
        assert.match(helpTxt, /--format=json/);
    });

    it('help.txt lists an @gina example', function () {
        assert.match(helpTxt, /gina service:list @gina/);
    });
});
