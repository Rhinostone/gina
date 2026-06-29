/**
 * lib/cmd/framework/stop.js — daemon-only stop + surviving-bundle notice.
 *
 * `framework:stop` (alias `gina stop`) kills ONLY the `gina-v<version>` daemon;
 * running bundles are detached child processes and survive the stop. This adds a
 * non-fatal notice that enumerates the run dir for any bundle still running and
 * tells the user how to stop it (`bundle:stop` / `project:stop`).
 *
 * Source-inspection style (same as minion-list.test.js): stop.js runs inside the
 * CLI offline-command context (CmdHelper + globals injected by gna.js), so it
 * cannot be required standalone. These assertions lock the source structure:
 *   01 module shape + fmt (lib.cmdStatusFormat) wiring
 *   02 daemon-only JSDoc + the surviving-bundle snapshot taken in stop()
 *   03 collectSurvivingBundles enumeration operators (skip filters + liveness)
 *   04 printSurvivingBundles + the !err-guarded emit in the end() chokepoint
 *   05 pure-logic replica of the run-dir enumeration against the REAL
 *      lib.cmdStatusFormat.readPidfile (temp fixture pidfiles)
 *
 * Section 05 mirrors the handler's enumeration (the handler can't be required);
 * the section 03 source pins lock the operators so the replica cannot silently
 * drift from the handler.
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var STOP_SOURCE = path.join(require('../fw'), 'lib/cmd/framework/stop.js');
var FMT_SOURCE  = path.join(require('../fw'), 'lib/cmd-status-format/src/main.js');

var src = fs.readFileSync(STOP_SOURCE, 'utf8');
var fmt = require(FMT_SOURCE);   // pure module (fs + path only) — directly requirable


// ---------------------------------------------------------------------------
// 01 — Module shape + fmt wiring
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Stop constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Stop;?/);
    });

    it('declares a function Stop(opt, cmd)', function () {
        assert.match(src, /function\s+Stop\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('aligns the lib registry requires (console + cmdStatusFormat)', function () {
        assert.match(src, /var console\s+=\s+lib\.logger;/);
        assert.match(src, /var fmt\s+=\s+lib\.cmdStatusFormat;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — daemon-only contract + snapshot
// ---------------------------------------------------------------------------

describe('02 - daemon-only contract', function () {

    it('JSDoc documents the daemon-only contract', function () {
        assert.match(src, /daemon-only/i);
        assert.match(src, /are NOT stopped/);
    });

    it('snapshots surviving bundles at the top of stop()', function () {
        assert.match(src, /self\.survivingBundles\s*=\s*collectSurvivingBundles\(\)/);
    });
});


// ---------------------------------------------------------------------------
// 03 — collectSurvivingBundles enumeration operators
// ---------------------------------------------------------------------------

describe('03 - collectSurvivingBundles source pins', function () {

    it('defines collectSurvivingBundles()', function () {
        assert.match(src, /var collectSurvivingBundles = function\(\)/);
    });

    it('skips hidden files', function () {
        assert.match(src, /\/\^\\\.\/\.test\(file\)/);
    });

    it('skips non-.pid files', function () {
        assert.match(src, /!\/\\\.pid\$\/\.test\(file\)/);
    });

    it('skips framework-daemon pidfiles (gina-*)', function () {
        assert.match(src, /\/\^gina\\-\/\.test\(file\)/);
    });

    it('splits <bundle>@<project> on the last @ and guards empties', function () {
        assert.match(src, /var at\s+= base\.lastIndexOf\('@'\)/);
        assert.match(src, /at < 1 \|\| at === base\.length - 1/);
    });

    it('liveness-probes via lib.cmdStatusFormat.readPidfile and keeps only running', function () {
        assert.match(src, /fmt\.readPidfile\(runDir, bundle, project\)/);
        assert.match(src, /if \( !runState\.running \)/);
    });
});


// ---------------------------------------------------------------------------
// 04 — printSurvivingBundles + guarded emit
// ---------------------------------------------------------------------------

describe('04 - surviving-bundle notice', function () {

    it('defines printSurvivingBundles(list)', function () {
        assert.match(src, /var printSurvivingBundles = function\(list\)/);
    });

    it('the notice states framework:stop does not stop bundles', function () {
        assert.match(src, /framework:stop stops the framework server only, not bundles/);
    });

    it('the notice points at bundle:stop and project:stop', function () {
        assert.match(src, /gina bundle:stop <bundle> @<project>/);
        assert.match(src, /gina project:stop @<project>/);
    });

    it('emits the notice from end() only on a successful exit (guarded by !err)', function () {
        assert.match(src, /if \( !err && self\.survivingBundles && self\.survivingBundles\.length > 0 \)/);
        assert.match(src, /printSurvivingBundles\(self\.survivingBundles\)/);
    });
});


// ---------------------------------------------------------------------------
// 05 — run-dir enumeration replica (REAL fmt.readPidfile)
// ---------------------------------------------------------------------------

describe('05 - run-dir enumeration replica', function () {

    var runDir;
    var LIVE = process.pid;     // the test process itself is alive
    var DEAD = 2147483646;      // above pid_max on macOS/Linux -> ESRCH (never alive)

    before(function () {
        runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-fwstop-'));
        fs.writeFileSync(path.join(runDir, 'gina-v0.5.6-alpha.3.pid'), String(LIVE)); // daemon  -> skipped
        fs.writeFileSync(path.join(runDir, 'api@myproject.pid'),       String(LIVE)); // live    -> included
        fs.writeFileSync(path.join(runDir, 'web@myproject.pid'),       String(DEAD)); // stale   -> excluded
        fs.writeFileSync(path.join(runDir, '.hidden@myproject.pid'),   String(LIVE)); // hidden  -> skipped
        fs.writeFileSync(path.join(runDir, 'notapid.txt'),            String(LIVE)); // non-pid -> skipped
        fs.writeFileSync(path.join(runDir, 'noatsign.pid'),           String(LIVE)); // no '@'  -> skipped
        fs.writeFileSync(path.join(runDir, 'api@.pid'),              String(LIVE)); // empty project -> skipped
    });

    after(function () {
        try { fs.rmSync(runDir, { recursive: true, force: true }); } catch (e) {}
    });

    // Mirrors collectSurvivingBundles (locked by the §03 source pins) but uses the
    // REAL lib.cmdStatusFormat.readPidfile for the liveness probe.
    var collect = function (dir) {
        var out = [], files = fs.readdirSync(dir);
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
            var runState = fmt.readPidfile(dir, bundle, project);
            if ( !runState.running ) {
                continue;
            }
            out.push({ bundle: bundle, project: project, pid: runState.pid });
        }
        return out;
    };

    it('returns only the live <bundle>@<project> bundle', function () {
        var live = collect(runDir);
        assert.equal(live.length, 1);
        assert.equal(live[0].bundle, 'api');
        assert.equal(live[0].project, 'myproject');
        assert.equal(live[0].pid, LIVE);
    });

    it('excludes the stale (dead-pid) bundle', function () {
        assert.ok(collect(runDir).every(function (b) { return b.bundle !== 'web'; }));
    });

    it('skips the framework daemon pidfile (gina-*)', function () {
        assert.ok(collect(runDir).every(function (b) { return !/^gina\-/.test(b.bundle); }));
    });

    it('subtract: WITHOUT the liveness filter the stale bundle would be included', function () {
        var files = fs.readdirSync(runDir), nofilter = [];
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
            // NO liveness probe — include every well-formed pidfile
            nofilter.push(base.substring(0, at));
        }
        assert.ok(nofilter.indexOf('web') >= 0, 'stale web is present without the liveness filter');
        assert.ok(collect(runDir).every(function (b) { return b.bundle !== 'web'; }), 'and excluded with it');
    });
});
