'use strict';
/**
 * #B850 — a worker child loaded with `--argv-filename` registered as its parent
 * bundle: it wrote its own pid into `<bundle>@<project>.pid` and removed that file
 * when it exited, so `bundle:stop` signalled the worker and `bundle:restart` exited
 * 0 while the old bundle kept serving (its start failed on the bound port, and
 * `bundle:start` reports that as a success, #B851).
 *
 * Fix, two files:
 *   - core/gna.js — the worker branch registers `new Proc(<bundle>@<project>, process, false)`
 *     and sets `process.isMinion = true` (its exit never unlinks the bundle's mount);
 *   - lib/proc.js — `register()` sets the title and the signal handlers (`setPID`) for
 *     every process, and writes the pid file (`save`) only when `usePidFile` is true.
 *
 * Strategy: the shipped bytes are executed, never a replica. `register()` is cut out
 * of lib/proc.js by brace-matching (comment lines dropped first) and compiled with its
 * closure bindings passed in as stubs that record the calls. The worker branch of
 * core/gna.js is pinned on its comment-stripped source. The booted proof is
 * test/integration/container-boot-worker-pidfile-b850.test.js.
 *
 * Red-first seams: B850_PROC_SRC / B850_GNA_SRC = a pre-fix copy
 * (`git show <ref>:<path>`).
 *
 * Run standalone: node --test test/lib/proc-worker-pidfile-b850.test.js
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW       = require('../fw');
var PROC_SRC = process.env.B850_PROC_SRC || path.join(FW, 'lib/proc.js');
var GNA_SRC  = process.env.B850_GNA_SRC  || path.join(FW, 'core/gna.js');

/**
 * Drops full-line comments, so no pin or extraction can anchor on a `// was:` line or
 * a JSDoc mention.
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
 * Cuts a function body out of a source by brace-matching from the first `{` after
 * the declaration. Controls: the declaration appears exactly once, the walk balances.
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


// ---------------------------------------------------------------------------
// 01 — lib/proc.js register(): the title and the handlers for every process,
//      the pid file only with usePidFile
// ---------------------------------------------------------------------------
describe('01 - lib/proc.js register(): setPID for every process, save() only with usePidFile (#B850)', function () {

    var register = null, savedList, savedPids;

    before(function () {
        var cut = cutBody(stripComments(fs.readFileSync(PROC_SRC, 'utf8')), 'self.register = function(bundle, pid)');
        assert.equal(cut.count, 1, 'extraction control: `self.register = function(bundle, pid)` must appear exactly once');
        assert.ok(cut.body, 'extraction control: the body must balance');
        /* eslint-disable no-new-func */
        register = new Function('self', 'Collection', 'dismiss', 'console', 'saveRunningProc', 'setContext', '_', 'pathObj', 'setPID', 'save',
            'return function (bundle, pid) {' + cut.body + '};');
        savedList = process.list; savedPids = process.pids;
    });

    after(function () { process.list = savedList; process.pids = savedPids; });

    /**
     * Runs the shipped register() once with recording stubs.
     *
     * @param {boolean} usePidFile
     * @param {boolean} dirExists - what the run directory's existsSync answers
     * @returns {object} the calls made
     * @inner
     */
    function run(usePidFile, dirExists) {
        var calls = { setPID: [], save: [], mkdir: 0, registered: null };
        process.list = []; process.pids = {};
        var self = { PID: 4242, path: null, bundle: 'web@shop', bundles: [], proc: { pid: 4242 }, usePidFile: usePidFile };
        var Collection = function () { return { findOne: function () { return null; } }; };
        var pathObj = { toUnixStyle: function () { return '/tmp/run'; }, existsSync: function () { return dirExists; }, mkdirSync: function () { calls.mkdir++; }, sep: '/' };
        var stubConsole = { debug: function () {} };
        var fn = register(self, Collection, function () {}, stubConsole, function () {}, function () {}, function (p) { return p; }, pathObj,
            function (b, pid) { calls.setPID.push([b, pid]); },
            function (b, pid) { calls.save.push([b, pid]); });
        fn('web@shop', 4242);
        calls.registered = process.list.slice();
        calls.selfPath = self.path;
        return calls;
    }

    it('CONTROL — usePidFile true: the title and handlers, then the pid file (unchanged)', function () {
        var c = run(true, true);
        assert.deepEqual(c.setPID, [['web@shop', 4242]]);
        assert.deepEqual(c.save, [['web@shop', 4242]]);
        assert.deepEqual(c.registered, [{ pid: 4242, name: 'web@shop' }]);
        assert.equal(c.selfPath, '/tmp/run/');
    });

    it('usePidFile false: the title and handlers are set, the pid file is NOT written', function () {
        var c = run(false, true);
        assert.deepEqual(c.setPID, [['web@shop', 4242]], 'setPID (title + signal handlers) must run for a process without a pid file');
        assert.deepEqual(c.save, [], 'no pid file without usePidFile');
        assert.deepEqual(c.registered, [{ pid: 4242, name: 'web@shop' }], 'the process is still registered in process.list');
    });

    it('usePidFile false: a missing run directory is not created', function () {
        var c = run(false, false);
        assert.equal(c.mkdir, 0);
        assert.deepEqual(c.setPID, [['web@shop', 4242]]);
        assert.deepEqual(c.save, []);
    });

    it('CONTROL — usePidFile true with a missing run directory: created, and (as before) neither set nor saved (#B852, unchanged here)', function () {
        var c = run(true, false);
        assert.equal(c.mkdir, 1);
        assert.deepEqual(c.setPID, []);
        assert.deepEqual(c.save, []);
        assert.deepEqual(c.registered, [{ pid: 4242, name: 'web@shop' }]);
    });
});


// ---------------------------------------------------------------------------
// 02 — core/gna.js: the worker branch registers without a pid file, as a minion
// ---------------------------------------------------------------------------
describe('02 - core/gna.js: the worker branch registers without a pid file and as a minion (#B850)', function () {

    var code = null, workerBranch = null, bundleBranch = null;

    before(function () {
        code = stripComments(fs.readFileSync(GNA_SRC, 'utf8'));
        var open = code.indexOf('if (!isLoadedThroughWorker) {');
        assert.ok(open > -1, 'extraction control: the `if (!isLoadedThroughWorker)` block must exist');
        var elseAt = code.indexOf('} else {', code.indexOf('bundleProcess = new Proc(', open));
        assert.ok(elseAt > -1, 'extraction control: the worker branch must follow the bundle branch');
        bundleBranch = code.slice(open, elseAt);
        workerBranch = code.slice(elseAt, code.indexOf('} catch (err) {', elseAt));
        assert.ok(workerBranch.length > 0 && workerBranch.length < 2000, 'extraction control: the worker branch is bounded by the catch');
    });

    it('the worker branch constructs its Proc with usePidFile false', function () {
        assert.ok(workerBranch.indexOf("bundleProcess = new Proc(appName + '@' + projectName, process, false);") > -1, workerBranch);
    });

    it('the worker branch marks the process a minion before constructing its Proc', function () {
        var mark = workerBranch.indexOf('process.isMinion = true;');
        assert.ok(mark > -1, 'process.isMinion = true must be set in the worker branch');
        assert.ok(mark < workerBranch.indexOf('new Proc('), 'the flag is set before the Proc is constructed');
    });

    it('CONTROL — the bundle branch keeps its pid file (two arguments)', function () {
        assert.ok(bundleBranch.indexOf("bundleProcess = new Proc(appName + '@' + projectName, process);") > -1, bundleBranch.slice(-400));
        assert.equal(bundleBranch.indexOf('isMinion'), -1, 'a bundle is never marked a minion');
    });
});
