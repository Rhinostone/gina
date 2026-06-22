/**
 * framework:init checkRunningPids — run-dir pidfile liveness / cleanup
 *
 * Why source inspection + simulation instead of requiring the module:
 *   init.js depends on injected globals (lib.logger, getPath, getEnvVar, _,
 *   GINA_RUNDIR) only present inside a running gina process — so it cannot be
 *   required in a bare node:test context (the same constraint
 *   framework-init-middleware.test.js / framework-reset.test.js document). The
 *   end-to-end behaviour is validated by the Bun container smoke.
 *
 * Background: checkRunningPids runs in the framework:init chain ahead of every
 * command's handler. It enumerates the run dir's pidfiles and prunes the stale
 * ones. It used to liveness-check each pid with a `ps -p <pid> -o pid=`
 * shell-out and prune on any throw — two latent defects: (a) on a minimal image
 * WITHOUT `ps` (bare oven/bun is Debian-slim, no procps) every check throws, so
 * init prunes ALL pidfiles on every command (bundle:list / minion:list /
 * framework:reset's guard then see nothing running); (b) the pid was read
 * untrimmed, so a trailing newline broke the interpolated `ps` command. The fix
 * replaces the shell-out with process.kill(pid, 0) (ps-independent, identical
 * Node/Bun) + a trimmed, parsed pid — mirroring lib/cmd/framework/reset.js
 * detectRunning.
 *
 * Covers:
 *   (a) source structure — process.kill(pid, 0) liveness (no `ps` shell-out in
 *       the block, while execSync legitimately survives elsewhere in the file),
 *       trimmed + parsed pid, EPERM-as-alive, the rmSync prune, the run-dir
 *       enumeration + dotfile skip
 *   (b) the prune decision (pure-logic replica) incl. the trailing-newline
 *       regression and a subtract vs the pre-fix `ps` shell-out
 */
'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SOURCE_PATH = path.join(require('../fw'), 'lib/cmd/framework/init.js');
var src = fs.readFileSync(SOURCE_PATH, 'utf8');

/** Strip block + line comments so negative code-absence pins don't trip on the
 *  file's own comments (the jsdoc.md "negative pin trips on the file's own
 *  comment" trap). */
function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Slice the checkRunningPids body, start-anchored on its declaration and
 *  end-anchored on the next declaration (self.end) so the window can't drift. */
function checkRunningPidsBlock() {
    var start = src.indexOf('self.checkRunningPids = function(done) {');
    var end   = src.indexOf('self.end = function(done) {', start);
    assert.ok(start > -1 && end > start, 'could not slice checkRunningPids body');
    return src.slice(start, end);
}


// ---------------------------------------------------------------------------
// 01 — source structure
// ---------------------------------------------------------------------------
describe('01 - checkRunningPids source structure', function() {

    it('probes liveness via process.kill(pid, 0), not a ps shell-out', function() {
        var blk = checkRunningPidsBlock();
        assert.ok(blk.indexOf('process.kill(pid, 0)') > -1, 'expected a process.kill(pid, 0) liveness probe');
        var clean = stripComments(blk);
        assert.ok(clean.indexOf('ps -p') < 0, 'expected no `ps -p` shell-out in checkRunningPids');
        assert.ok(clean.indexOf('execSync(') < 0, 'expected no execSync(...) call in checkRunningPids');
        // execSync legitimately survives elsewhere in init.js (e.g. the npm-prefix lookup).
        assert.ok(src.indexOf('execSync') > -1, 'execSync import/use must remain elsewhere in init.js');
    });

    it('reads the pid trimmed and parsed (so a trailing newline cannot break it)', function() {
        var blk = checkRunningPidsBlock();
        assert.ok(blk.indexOf('parseInt(') > -1, 'expected parseInt(...) of the pidfile content');
        assert.ok(blk.indexOf('.trim()') > -1, 'expected the pidfile content to be trimmed');
    });

    it('counts EPERM as alive and prunes stale pidfiles with rmSync', function() {
        var blk = checkRunningPidsBlock();
        assert.ok(blk.indexOf("'EPERM'") > -1, 'expected EPERM handled as alive (conservative)');
        assert.ok(blk.indexOf('filenameObj.rmSync()') > -1, 'expected the stale-pidfile prune via rmSync');
    });

    it('enumerates the run dir and skips dotfiles', function() {
        var blk = checkRunningPidsBlock();
        assert.ok(blk.indexOf('fs.readdirSync(runDir)') > -1, 'expected the run-dir enumeration');
        assert.ok(blk.indexOf('/^\\./') > -1, 'expected the dotfile skip');
    });

});


// ---------------------------------------------------------------------------
// 02 — prune decision (pure-logic replica)
// ---------------------------------------------------------------------------
describe('02 - run-dir prune logic', function() {

    /**
     * Mirror of checkRunningPids' loop: skip dotfiles; for every other file read
     * the pid (trimmed + parsed); prune (rmSync) empty/garbage/zero pids and any
     * whose process is not alive; keep alive (or EPERM) ones. NOTE: no `.pid`
     * filter — checkRunningPids processes all non-dot files (incl. the gina-*
     * daemon pidfile), matching the shipped behaviour.
     * @param {Object.<string,string>} files  filename -> pidfile content
     * @param {function(number):string} kill   pid -> 'alive' | 'ESRCH' | 'EPERM'
     * @returns {{kept:string[], pruned:string[]}}
     */
    function runCheck(files, kill) {
        var kept = [], pruned = [];
        Object.keys(files).forEach(function(file) {
            if (/^\./.test(file)) return;                          // dotfile -> skipped entirely
            var pid = parseInt(String(files[file]).trim(), 10);
            if (!pid || isNaN(pid)) { pruned.push(file); return; } // empty/garbage/zero -> prune
            var v = kill(pid);
            if (v === 'alive' || v === 'EPERM') kept.push(file);   // alive (or foreign-owned) -> keep
            else pruned.push(file);                                // ESRCH (stale) -> prune
        });
        return { kept: kept, pruned: pruned };
    }

    it('keeps live bundle AND gina-* daemon pidfiles, prunes stale (ESRCH)', function() {
        var files = { 'api@demo.pid': '111', 'web@demo.pid': '222', 'gina-v0.5.5-alpha.2.pid': '333' };
        var res = runCheck(files, function(pid) { return pid === 222 ? 'ESRCH' : 'alive'; });
        assert.deepEqual(res.kept.sort(), ['api@demo.pid', 'gina-v0.5.5-alpha.2.pid']);
        assert.deepEqual(res.pruned, ['web@demo.pid']);
    });

    it('counts an EPERM pid (foreign-owned, alive) as kept', function() {
        var res = runCheck({ 'api@demo.pid': '999' }, function() { return 'EPERM'; });
        assert.deepEqual(res.kept, ['api@demo.pid']);
        assert.deepEqual(res.pruned, []);
    });

    it('keeps a LIVE process whose pidfile has a trailing newline (defect-b regression)', function() {
        var res = runCheck({ 'api@demo.pid': '12345\n' }, function(pid) { return pid === 12345 ? 'alive' : 'ESRCH'; });
        assert.deepEqual(res.kept, ['api@demo.pid']);
        assert.deepEqual(res.pruned, []);
    });

    it('prunes empty/garbage/zero pids and non-pid files; skips dotfiles', function() {
        var files = { '.DS_Store': 'x', 'notes.txt': 'y', 'bad.pid': 'notanumber', 'zero.pid': '0', 'ok.pid': '42' };
        var res = runCheck(files, function() { return 'alive'; });
        assert.deepEqual(res.kept, ['ok.pid']);
        // .DS_Store skipped (neither kept nor pruned); the rest pruned (no .pid filter).
        assert.deepEqual(res.pruned.sort(), ['bad.pid', 'notes.txt', 'zero.pid']);
    });

    it('subtract: the pre-fix ps shell-out prunes a live newline-pidfile process; the fix keeps it', function() {
        // Pre-fix: execSync("ps -p " + raw + " -o pid=") with an UNTRIMMED pid.
        // A trailing newline splits the shell command (the fragment after the
        // newline runs as its own failing command), so execSync throws and the
        // live process is treated as dead -> pruned.
        function oldPsThrows(raw) { return !/^\d+$/.test(raw); }   // newline / non-digit -> ps command fails
        var raw = '12345\n';
        assert.equal(oldPsThrows(raw), true, 'pre-fix: the newline breaks the ps command -> live process pruned (the bug)');

        var res = runCheck({ 'api@demo.pid': raw }, function(pid) { return pid === 12345 ? 'alive' : 'ESRCH'; });
        assert.deepEqual(res.kept, ['api@demo.pid'], 'fix: trimmed + parsed pid + process.kill keeps the live process');
        assert.deepEqual(res.pruned, []);
    });

});
