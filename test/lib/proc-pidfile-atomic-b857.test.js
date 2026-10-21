'use strict';
/**
 * #B857 — `save()` in lib/proc.js wrote the pid file through `fs.createWriteStream()`,
 * which creates the file EMPTY when it opens and wrote the pid only in the 'open'
 * callback, after the process returned to the event loop. A concurrent
 * `checkRunningPids()` (the init chain of any other gina command) read the empty file in
 * that window and deleted it as garbage (measured in a trace sandbox on 2026-10-13), and
 * every other reader of the window took the process for not running. An open error was
 * swallowed by an empty 'error' handler, so the daemon's `onReady()` never fired.
 *
 * Fix: the pid is written to a dot-named temporary file in the run directory and renamed
 * into place, synchronously, so a reader finds no file or the complete one; the dot keeps
 * the temporary file out of every run-directory scan. The completion, or the error, is
 * emitted on the next tick, because `onReady()` is attached after the Proc constructor
 * returns.
 *
 * Strategy: the shipped `save()` body is cut out of lib/proc.js by brace-matching (comment
 * lines dropped first) and compiled with its closure bindings passed in: a real `fs`
 * (wrapped to record the paths it writes), a real EventEmitter and a temporary run
 * directory. No replica.
 *
 * Red-first seam: B857_PROC_SRC = a pre-fix copy (`git show <ref>:<path>`).
 *
 * Run standalone: node --test test/lib/proc-pidfile-atomic-b857.test.js
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var EventEmitter = require('events');

var FW       = require('../fw');
var PROC_SRC = process.env.B857_PROC_SRC || path.join(FW, 'lib/proc.js');

/**
 * Drops full-line comments, so the extraction cannot anchor on a `// was:` line or a
 * JSDoc mention.
 *
 * @param   {string} source
 * @returns {string}
 * @inner
 */
function stripComments(source) {
    return source.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * Cuts a function body out of a source by brace-matching from the first `{` after the
 * declaration. Controls: the declaration appears exactly once, the walk balances.
 *
 * @param   {string} source - comment-stripped source
 * @param   {string} decl - the declaration text, up to its parameter list
 * @returns {{count: number, body: (string|null)}}
 * @inner
 */
function cutBody(source, decl) {
    var i = source.indexOf(decl);
    if (i < 0) { return { count: 0, body: null }; }
    if (source.indexOf(decl, i + 1) !== -1) { return { count: 2, body: null }; }
    var open = source.indexOf('{', i + decl.length - 1);
    var depth = 0;
    for (var k = open; k < source.length; k++) {
        if (source[k] === '{') { depth++; }
        else if (source[k] === '}') {
            depth--;
            if (depth === 0) { return { count: 1, body: source.slice(open + 1, k) }; }
        }
    }
    return { count: 1, body: null };
}

/**
 * Resolves with the first `proc#complete-<pid>` event's arguments, or with the string
 * 'TIMEOUT' when none arrives in time.
 *
 * @param   {EventEmitter} e
 * @param   {number} pid
 * @param   {number} ms
 * @returns {Promise<(Array|string)>}
 * @inner
 */
function completion(e, pid, ms) {
    return new Promise(function (resolve) {
        var t = setTimeout(function () { resolve('TIMEOUT'); }, ms);
        e.once('proc#complete-' + pid, function (err, savedPid) {
            clearTimeout(t);
            resolve([err, savedPid]);
        });
    });
}


describe('01 - lib/proc.js save(): the pid file is written whole and never seen empty (#B857)', function () {

    var save = null, tmpDirs = [];

    before(function () {
        var cut = cutBody(stripComments(fs.readFileSync(PROC_SRC, 'utf8')), 'var save = function(');
        assert.equal(cut.count, 1, 'extraction control: `var save = function(` must appear exactly once');
        assert.ok(cut.body, 'extraction control: the body must balance');
        /* eslint-disable no-new-func */
        save = new Function('self', 'fs', 'e', 'console', 'return function () {' + cut.body + '};');
    });

    after(function () {
        tmpDirs.forEach(function (d) { fs.rmSync(d, { recursive: true, force: true }); });
    });

    /**
     * Builds one save() run on a fresh run directory.
     *
     * @param   {object} [opts]
     * @param   {boolean} [opts.missingDir] - point the pid path at a directory that does not exist
     * @returns {object} the compiled save(), its emitter, the run directory and the recorded writes
     * @inner
     */
    function scene(opts) {
        var base = fs.mkdtempSync(path.join(os.tmpdir(), 'b857-'));
        tmpDirs.push(base);
        var runDir = (opts && opts.missingDir) ? path.join(base, 'absent') : base;
        var e = new EventEmitter();
        var writes = [], warnings = [];
        var spyFs = Object.create(fs);
        spyFs.writeFileSync = function (p) { writes.push(String(p)); return fs.writeFileSync.apply(fs, arguments); };
        var self = { bundle: 'web@shop', PID: 4242, proc: { pid: 4242, title: 'gina: web@shop' }, path: runDir + path.sep };
        var fn = save(self, spyFs, e, { debug: function () {}, warn: function (m) { warnings.push(String(m)); } });
        return { fn: fn, e: e, runDir: runDir, writes: writes, warnings: warnings };
    }

    it('the pid file holds the pid as soon as save() returns (the old stream wrote it later)', async function () {
        var s = scene();
        var done = completion(s.e, 4242, 1500);
        s.fn();
        var content = null;
        try { content = fs.readFileSync(path.join(s.runDir, 'web@shop.pid'), 'utf8'); } catch (err) { content = err.code; }
        await done;
        assert.equal(content, '4242');
    });

    it('when save() returns, the run directory holds the complete pid file and nothing else', async function () {
        var s = scene();
        var done = completion(s.e, 4242, 1500);
        s.fn();
        var listing = fs.readdirSync(s.runDir).sort();
        var content = listing.length ? fs.readFileSync(path.join(s.runDir, listing[0]), 'utf8') : null;
        await done;
        assert.deepEqual(listing, ['web@shop.pid']);
        assert.equal(content, '4242');
    });

    it('the temporary file is dot-named and is not a .pid file, so no run-directory scan can read it', async function () {
        var s = scene();
        var done = completion(s.e, 4242, 1500);
        s.fn();
        await done;
        assert.equal(s.writes.length, 1, 'one synchronous write');
        var name = path.basename(s.writes[0]);
        assert.ok(/^\./.test(name), 'dot-named, skipped by checkRunningPids and the minion and status scans: ' + name);
        assert.ok(!/\.pid$/.test(name), 'not a .pid name, skipped by removePidFileSync: ' + name);
        assert.equal(path.dirname(s.writes[0]), s.runDir, 'written in the run directory, so the rename is atomic');
    });

    it('CONTROL — the completion reaches a listener attached after save() returns, with (false, pid): the onReady() order', async function () {
        var s = scene();
        s.fn();
        var got = await completion(s.e, 4242, 1500);   // attached AFTER the call, like onReady()
        assert.deepEqual(got, [false, 4242]);
    });

    it('a pid file that cannot be written is reported as an error, not swallowed, and leaves nothing behind', async function () {
        var s = scene({ missingDir: true });
        s.fn();
        var got = await completion(s.e, 4242, 1500);   // attached AFTER the call, like onReady()
        assert.notEqual(got, 'TIMEOUT', 'the daemon\'s onReady() must not wait forever');
        assert.ok(got[0] instanceof Error, 'an Error reaches the listener');
        assert.equal(got[0].code, 'ENOENT');
        assert.ok(s.warnings.some(function (m) { return /Could not write the pid file/.test(m); }), 'the failure is logged');
        assert.equal(fs.existsSync(s.runDir), false, 'no directory and no temporary file were created');
    });
});
