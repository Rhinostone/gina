/**
 * lib/cmd/minion/list.js — run-dir-driven live-minion lister.
 *
 * Source-inspection tests (same style as connector-list.test.js,
 * service-list.test.js): list.js runs inside the CLI daemon context (CmdHelper,
 * project registry, globals injected by gna.js). Replicating that is heavy for
 * near-zero extra coverage, so these assertions prove the source structure of:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) argv loop — `--format=<x>` capture
 *   (c) run-dir enumeration — readdirSync(self.runDir), gina-daemon / hidden /
 *       non-pid skips, `<bundle>@<project>` split, fmt.readPidfile liveness,
 *       running-only filter
 *   (d) lib.cmdStatusFormat consumption — no inline pad/readPidfile/pickPreferredPort
 *   (e) mode dispatch — listAll / listProjectOnly / unregistered-project error
 *   (f) JSON output shape (minions envelope)
 *   (g) Help module + help.txt (typo fixed) + arguments.json
 *
 * Section 08 is a pure-logic replica of the run-dir parse/filter/group — the one
 * genuinely new bit of logic (everything else mirrors project:status). The
 * source pins in section 03 lock the operators so the replica cannot silently
 * drift from the handler.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var LIST_SOURCE = path.join(require('../fw'), 'lib/cmd/minion/list.js');
var HELP_SOURCE = path.join(require('../fw'), 'lib/cmd/minion/help.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/minion/help.txt');
var ARGS_FILE   = path.join(require('../fw'), 'lib/cmd/minion/arguments.json');
var CLI_SOURCE  = path.join(__dirname, '..', '..', 'bin', 'cli');

var src     = fs.readFileSync(LIST_SOURCE, 'utf8');
var helpSrc = fs.readFileSync(HELP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc  = fs.readFileSync(CLI_SOURCE, 'utf8');


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

    it('initialises self with a null format', function () {
        assert.match(src, /var self\s*=\s*\{\s*format\s*:\s*null\s*\}/);
    });

    it('wires CmdHelper with opt.client and debug flags', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
    });

    it('gates on isCmdConfigured()', function () {
        assert.match(src, /if \(!isCmdConfigured\(\)\) return false;/);
    });

    it('aligns the lib registry requires (console + cmdStatusFormat)', function () {
        assert.match(src, /var console\s+=\s+lib\.logger;/);
        assert.match(src, /var fmt\s+=\s+lib\.cmdStatusFormat;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — argv --format capture
// ---------------------------------------------------------------------------

describe('02 - argv --format capture', function () {

    it('scans process.argv from index 3', function () {
        assert.match(src, /for \(let i = 3, len = process\.argv\.length/);
    });

    it('captures --format= via regex and split on =', function () {
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(process\.argv\[i\]\)/);
        assert.match(src, /self\.format = process\.argv\[i\]\.split\(\/\\=\/\)\[1\]/);
    });
});


// ---------------------------------------------------------------------------
// 03 — run-dir enumeration (the new logic)
// ---------------------------------------------------------------------------

describe('03 - run-dir enumeration', function () {

    it('resolves the run dir from GINA_RUNDIR with a ~/.gina/run fallback', function () {
        assert.match(src, /self\.runDir = \(typeof\(GINA_RUNDIR\) != 'undefined' && GINA_RUNDIR\)/);
        assert.match(src, /\(GINA_HOMEDIR \+ '\/run'\)/);
    });

    it('reads the run directory with readdirSync(self.runDir)', function () {
        assert.match(src, /fs\.readdirSync\(self\.runDir\)/);
    });

    it('skips hidden, non-pid, and gina-daemon pidfiles', function () {
        assert.match(src, /\/\^\\\.\/\.test\(file\)/);          // /^\./.test(file)
        assert.match(src, /!\/\\\.pid\$\/\.test\(file\)/);      // !/\.pid$/.test(file)
        assert.match(src, /\/\^gina\\-\/\.test\(file\)/);       // /^gina\-/.test(file)
    });

    it('splits <bundle>@<project> via lastIndexOf and guards malformed names', function () {
        assert.match(src, /var at\s+= base\.lastIndexOf\('@'\)/);
        assert.match(src, /at < 1 \|\| at === base\.length - 1/);
        assert.match(src, /base\.substring\(0, at\)/);
        assert.match(src, /base\.substring\(at \+ 1\)/);
    });

    it('applies the optional projectFilter', function () {
        assert.match(src, /projectFilter != null && project !== projectFilter/);
    });

    it('liveness-probes via fmt.readPidfile and keeps only running processes', function () {
        assert.match(src, /fmt\.readPidfile\(self\.runDir, bundle, project\)/);
        assert.match(src, /if \( !runState\.running \)/);
    });
});


// ---------------------------------------------------------------------------
// 04 — lib.cmdStatusFormat consumption (no inline copies)
// ---------------------------------------------------------------------------

describe('04 - cmdStatusFormat consumption', function () {

    it('uses fmt.pickPreferredPort and fmt.pad', function () {
        assert.match(src, /fmt\.pickPreferredPort\(ports\)/);
        assert.match(src, /fmt\.pad\(entry\.bundle, 16\)/);
    });

    it('does not re-declare the extracted primitives inline', function () {
        assert.doesNotMatch(src, /var readPidfile = function/);
        assert.doesNotMatch(src, /var pad = function/);
        assert.doesNotMatch(src, /var pickPreferredPort = function/);
    });
});


// ---------------------------------------------------------------------------
// 05 — mode dispatch
// ---------------------------------------------------------------------------

describe('05 - mode dispatch', function () {

    it('dispatches to listAll when no project is given', function () {
        assert.match(src, /if \( self\.projectName == null \) \{\s*\n\s*listAll\(\);/);
    });

    it('dispatches to listProjectOnly for a registered project', function () {
        assert.match(src, /typeof\(self\.projects\[self\.projectName\]\) != 'undefined'/);
        assert.match(src, /listProjectOnly\(\);/);
    });

    it('errors on an unregistered project', function () {
        assert.match(src, /is not a registered project/);
    });
});


// ---------------------------------------------------------------------------
// 06 — JSON output shape
// ---------------------------------------------------------------------------

describe('06 - JSON output shape', function () {

    it('detects --format=json with the /^json?/ regex', function () {
        assert.match(src, /\/\^json\?\/\.test\(self\.format\)/);
    });

    it('writes JSON via process.stdout.write(JSON.stringify(...))', function () {
        assert.match(src, /process\.stdout\.write\(JSON\.stringify/);
    });

    it('emits a {project, minions} envelope for the all-projects form', function () {
        assert.match(src, /\{ project: names\[k\], minions: byProject\[names\[k\]\] \}/);
    });
});


// ---------------------------------------------------------------------------
// 07 — Help module + help.txt + arguments.json
// ---------------------------------------------------------------------------

describe('07 - help + arguments', function () {

    it('help.js exports the Help constructor', function () {
        assert.match(helpSrc, /module\.exports\s*=\s*Help;?/);
    });

    it('help.txt documents both minion:list forms', function () {
        assert.match(helpTxt, /gina minion:list @<project_name>/);
        assert.match(helpTxt, /\$ gina minion:list\s*$/m);
    });

    it('help.txt no longer carries the "minons" typo and explains grouping', function () {
        assert.doesNotMatch(helpTxt, /minons/);
        assert.match(helpTxt, /grouped by project/);
    });

    it('arguments.json declares --format', function () {
        assert.ok(Array.isArray(argsArr));
        assert.ok(argsArr.indexOf('--format') > -1);
    });

    it('minion: is offline-registered in bin/cli (no daemon needed)', function () {
        assert.match(cliSrc, /'minion:'/);
    });
});


// ---------------------------------------------------------------------------
// 08 — pure-logic replica of the run-dir parse / filter / group
//      (mirrors collectMinions line-for-line; section 03 pins lock the operators)
// ---------------------------------------------------------------------------

describe('08 - run-dir parse/filter replica', function () {

    // Replica of the handler's inline collectMinions logic. `alive` is the set
    // of PIDs the liveness probe (fmt.readPidfile) would report running.
    function parseRunDir(files, projectFilter, pidByFile, alive) {
        var out = [];
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if ( /^\./.test(file) || !/\.pid$/.test(file) || /^gina\-/.test(file) ) {
                continue;
            }
            var base = file.replace(/\.pid$/, '');
            var at   = base.lastIndexOf('@');
            if ( at < 1 || at === base.length - 1 ) {
                continue;
            }
            var bundle  = base.substring(0, at);
            var project = base.substring(at + 1);
            if ( projectFilter != null && project !== projectFilter ) {
                continue;
            }
            var pid = pidByFile[file];
            if ( alive.indexOf(pid) < 0 ) {
                continue;
            }
            out.push({ bundle: bundle, project: project, pid: pid });
        }
        return out;
    }

    function group(entries) {
        var by = {};
        for (var i = 0; i < entries.length; i++) {
            var p = entries[i].project;
            if ( typeof(by[p]) == 'undefined' ) { by[p] = []; }
            by[p].push(entries[i]);
        }
        return by;
    }

    var files = [
        'api@myproject.pid',
        'web@myproject.pid',
        'api@other.pid',
        'gina-v0.4.1-alpha.2.pid',   // framework daemon -> skip
        '.hidden@myproject.pid',     // hidden -> skip
        'notes@myproject.txt',       // non-pid -> skip
        'noatsign.pid',              // no '@' -> skip
        '@myproject.pid',            // at < 1 -> skip
        'broken@.pid'                // at at end -> skip
    ];
    var pidByFile = {
        'api@myproject.pid': 100,
        'web@myproject.pid': 200,
        'api@other.pid'    : 300
    };

    it('skips daemon, hidden, non-pid, and malformed pidfiles', function () {
        var out = parseRunDir(files, null, pidByFile, [100, 200, 300]);
        var keys = out.map(function (e) { return e.bundle + '@' + e.project; });
        assert.deepEqual(keys.sort(), ['api@myproject', 'api@other', 'web@myproject']);
    });

    it('excludes minions whose process is dead (stale pidfile)', function () {
        // 200 (web@myproject) is NOT alive -> dropped
        var out = parseRunDir(files, null, pidByFile, [100, 300]);
        var keys = out.map(function (e) { return e.bundle + '@' + e.project; });
        assert.deepEqual(keys.sort(), ['api@myproject', 'api@other']);
    });

    it('filters to a single project when projectFilter is set', function () {
        var out = parseRunDir(files, 'myproject', pidByFile, [100, 200, 300]);
        var keys = out.map(function (e) { return e.bundle + '@' + e.project; });
        assert.deepEqual(keys.sort(), ['api@myproject', 'web@myproject']);
    });

    it('parses bundle and project from <bundle>@<project>.pid', function () {
        var out = parseRunDir(['api@myproject.pid'], null, { 'api@myproject.pid': 100 }, [100]);
        assert.equal(out.length, 1);
        assert.equal(out[0].bundle, 'api');
        assert.equal(out[0].project, 'myproject');
        assert.equal(out[0].pid, 100);
    });

    it('groups live minions by project (sorted keys)', function () {
        var out = parseRunDir(files, null, pidByFile, [100, 200, 300]);
        var by  = group(out);
        assert.deepEqual(Object.keys(by).sort(), ['myproject', 'other']);
        assert.equal(by.myproject.length, 2);
        assert.equal(by.other.length, 1);
    });

    it('returns an empty list when nothing is alive', function () {
        var out = parseRunDir(files, null, pidByFile, []);
        assert.equal(out.length, 0);
    });
});
