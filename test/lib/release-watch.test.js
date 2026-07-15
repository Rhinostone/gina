'use strict';
/**
 * #RW1 — lib/release-watch primitives (stale built-release watch, slice 1).
 *
 * Behavioral coverage of the real module (fingerprints, listing diffs,
 * classification, the recursive/debounced tree watcher incl. sweep-only mode,
 * busy probes, the in-flight gauge) + source pins locking the build-verb
 * fingerprint stamps (bundle:build + project:build) and the plain-require
 * lib registration.
 *
 * Hygiene: every watcher handle is closed in afterEach/after and the module
 * arms only unref'd timers with persistent:false watchers — this file must
 * exit cleanly WITHOUT --test-force-exit.
 *
 * Run: node --test test/lib/release-watch.test.js
 */

var assert = require('node:assert');
var { describe, it, after, afterEach } = require('node:test');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');

var FW = require('../fw');
var rw = require(FW + '/lib/release-watch/src/main');

var BUILD_SRC         = fs.readFileSync(FW + '/lib/cmd/bundle/build.js', 'utf8');
var PROJECT_BUILD_SRC = fs.readFileSync(FW + '/lib/cmd/project/build.js', 'utf8');
var LIB_INDEX_SRC     = fs.readFileSync(FW + '/lib/index.js', 'utf8');

/** Fixed timestamp so two trees can carry identical mtimes. */
var FIXED_TIME = new Date(1700000000000);

/**
 * Creates a fresh temp dir, tracked for removal.
 * @param {string[]} registry
 * @returns {string}
 */
function mkTmp(registry) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-rw-'));
    registry.push(dir);
    return dir;
}

/**
 * Writes a file, creating parent dirs.
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 * @returns {string} absolute path
 */
function writeFile(root, rel, content) {
    var abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
}

/**
 * Polls until fn() is truthy or the deadline passes.
 * @param {function} fn
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
function waitFor(fn, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 3000);
    return new Promise(function(resolve) {
        (function poll() {
            if (fn()) return resolve(true);
            if (Date.now() > deadline) return resolve(false);
            setTimeout(poll, 25);
        })();
    });
}

/**
 * Fixed wait (for bounded negative assertions after a positive control).
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}


describe('release-watch §01 — fingerprintTree (behavioral)', function() {

    var tmpDirs = [];
    after(function() {
        tmpDirs.forEach(function(d) { fs.rmSync(d, { recursive: true, force: true }); });
    });

    it('01.01 — deterministic: two computes of an unchanged tree hash identically', function() {
        var root = mkTmp(tmpDirs);
        writeFile(root, 'controllers/controller.js', 'a');
        writeFile(root, 'public/css/app.css', 'bb');
        var fp1 = rw.fingerprintTree(root);
        var fp2 = rw.fingerprintTree(root);
        assert.ok(fp1 && fp1.hash && /^[0-9a-f]{40}$/.test(fp1.hash), 'sha1 hex expected');
        assert.strictEqual(fp1.hash, fp2.hash);
        assert.strictEqual(fp1.fileCount, 2);
        assert.strictEqual(fp1.spec, rw.FP_SPEC);
        assert.strictEqual(rw.FP_SPEC, 1);
    });

    it('01.02 — creation-order independent: same files+sizes+mtimes in two dirs hash identically', function() {
        var a = mkTmp(tmpDirs);
        var b = mkTmp(tmpDirs);
        // opposite creation order
        var a1 = writeFile(a, 'x.js', 'one');
        var a2 = writeFile(a, 'sub/y.js', 'four');
        var b2 = writeFile(b, 'sub/y.js', 'four');
        var b1 = writeFile(b, 'x.js', 'one');
        [a1, a2, b1, b2].forEach(function(f) { fs.utimesSync(f, FIXED_TIME, FIXED_TIME); });
        assert.strictEqual(rw.fingerprintTree(a).hash, rw.fingerprintTree(b).hash);
    });

    it('01.03 — a size change flips the hash', function() {
        var root = mkTmp(tmpDirs);
        var f = writeFile(root, 'models/m.js', 'aaa');
        fs.utimesSync(f, FIXED_TIME, FIXED_TIME);
        var before = rw.fingerprintTree(root).hash;
        fs.writeFileSync(f, 'aaaa'); // size 3 → 4
        fs.utimesSync(f, FIXED_TIME, FIXED_TIME); // pin mtime: size alone must flip it
        var afterHash = rw.fingerprintTree(root).hash;
        assert.notStrictEqual(before, afterHash);
    });

    it('01.04 — an mtime-only change flips the hash', function() {
        var root = mkTmp(tmpDirs);
        var f = writeFile(root, 'config/settings.json', '{}');
        fs.utimesSync(f, FIXED_TIME, FIXED_TIME);
        var before = rw.fingerprintTree(root).hash;
        fs.utimesSync(f, new Date(1700000005000), new Date(1700000005000));
        assert.notStrictEqual(before, rw.fingerprintTree(root).hash);
    });

    it('01.05 — ignored segments do not participate (node_modules churn is invisible)', function() {
        var root = mkTmp(tmpDirs);
        writeFile(root, 'index.js', 'x');
        var before = rw.fingerprintTree(root).hash;
        writeFile(root, 'node_modules/dep/index.js', 'yyyy');
        assert.strictEqual(rw.fingerprintTree(root).hash, before);
        writeFile(root, 'node_modules/dep/index.js', 'zzzzzzzz');
        assert.strictEqual(rw.fingerprintTree(root).hash, before);
    });

    it('01.06 — symlinks are skipped (no cycle, no phantom entry)', function() {
        var root = mkTmp(tmpDirs);
        writeFile(root, 'a.js', 'x');
        var before = rw.fingerprintTree(root);
        fs.symlinkSync(path.join(root, 'a.js'), path.join(root, 'link.js'));
        var afterFp = rw.fingerprintTree(root);
        assert.strictEqual(afterFp.hash, before.hash);
        assert.strictEqual(afterFp.fileCount, 1);
    });

    it('01.07 — missing root and non-directory root return null', function() {
        var root = mkTmp(tmpDirs);
        var f = writeFile(root, 'file.txt', 'x');
        assert.strictEqual(rw.fingerprintTree(path.join(root, 'nope')), null);
        assert.strictEqual(rw.fingerprintTree(f), null);
        assert.strictEqual(rw.fingerprintTree(null), null);
    });

    it('01.08 — withListing returns the relpath → size|mtime map used by reconcile', function() {
        var root = mkTmp(tmpDirs);
        var f = writeFile(root, 'sub/deep/z.js', 'abc');
        fs.utimesSync(f, FIXED_TIME, FIXED_TIME);
        var fp = rw.fingerprintTree(root, { withListing: true });
        assert.ok(fp.listing);
        assert.deepStrictEqual(Object.keys(fp.listing), ['sub/deep/z.js']);
        assert.strictEqual(fp.listing['sub/deep/z.js'], '3|' + FIXED_TIME.getTime());
        // withListing must not change the hash
        assert.strictEqual(fp.hash, rw.fingerprintTree(root).hash);
    });
});


describe('release-watch §02 — diffListings (behavioral)', function() {

    it('02.01 — added, removed, changed and unchanged', function() {
        var prev = { 'a.js': '1|100', 'b.js': '2|100', 'c.js': '3|100' };
        var next = { 'a.js': '1|100', 'b.js': '2|200', 'd.js': '4|100' };
        var changed = rw.diffListings(prev, next).sort();
        assert.deepStrictEqual(changed, ['b.js', 'c.js', 'd.js']);
    });

    it('02.02 — identical listings diff empty; null args tolerated', function() {
        assert.deepStrictEqual(rw.diffListings({ 'a.js': '1|1' }, { 'a.js': '1|1' }), []);
        assert.deepStrictEqual(rw.diffListings(null, null), []);
        assert.deepStrictEqual(rw.diffListings(null, { 'a.js': '1|1' }), ['a.js']);
    });
});


describe('release-watch §03 — classify / classifyBatch', function() {

    it('03.01 — public/** is assets-class', function() {
        assert.strictEqual(rw.classify('public/css/app.css'), 'assets');
        assert.strictEqual(rw.classify('public/js/vendor/x.min.js'), 'assets');
        assert.strictEqual(rw.classify('/public/img/logo.png'), 'assets');
        assert.strictEqual(rw.classify('public\\css\\win.css'), 'assets');
    });

    it('03.02 — server code, templates and config are restart-class', function() {
        assert.strictEqual(rw.classify('controllers/controller.js'), 'restart');
        assert.strictEqual(rw.classify('models/order/entity.js'), 'restart');
        assert.strictEqual(rw.classify('templates/html/index.html'), 'restart');
        assert.strictEqual(rw.classify('config/settings.json'), 'restart');
        assert.strictEqual(rw.classify('channels/feed.js'), 'restart');
    });

    it('03.03 — unknown / degenerate paths fail safe to restart', function() {
        assert.strictEqual(rw.classify('(unknown)'), 'restart');
        assert.strictEqual(rw.classify(''), 'restart');
        assert.strictEqual(rw.classify(null), 'restart');
        assert.strictEqual(rw.classify('public'), 'restart'); // a FILE named public, not the tree
    });

    it('03.04 — classifyBatch: all-assets → assets, any-restart → restart, empty → null', function() {
        assert.strictEqual(rw.classifyBatch(['public/a.css', 'public/b.js']), 'assets');
        assert.strictEqual(rw.classifyBatch(['public/a.css', 'models/x.js']), 'restart');
        assert.strictEqual(rw.classifyBatch([]), null);
        assert.strictEqual(rw.classifyBatch(null), null);
    });
});


describe('release-watch §04 — createTreeWatcher (real fs events)', function() {

    var tmpDirs  = [];
    var watchers = [];

    afterEach(function() {
        watchers.forEach(function(w) { try { w.close(); } catch (e) {} });
        watchers = [];
    });
    after(function() {
        tmpDirs.forEach(function(d) { fs.rmSync(d, { recursive: true, force: true }); });
    });

    /**
     * Boots a watched temp tree with a batch collector.
     *
     * fs-events mode is PRIMED before the scenario runs: on macOS the first
     * FSEvents stream in a process can take seconds to go live, and a fresh
     * stream can replay writes made just before it started (measured 2026-07-15
     * — the seed writes surfaced in the first batch). A sacrificial
     * assets-class write is made, its batch awaited, then the collector is
     * cleared — the scenario observes only its own events. (Production-side,
     * this is why watch events are TRIGGERS only; the fingerprint-vs-stamp
     * compare is the staleness verdict.)
     *
     * @param {object} [opts] extra createTreeWatcher options
     * @returns {Promise<{root:string, batches:object[], watcher:object}>}
     */
    async function bootWatched(opts) {
        var root = mkTmp(tmpDirs);
        writeFile(root, 'controllers/controller.js', 'seed');
        writeFile(root, 'public/css/app.css', 'seed');
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        var batches = [];
        var options = Object.assign({
            root       : root,
            debounceMs : 40,
            onChange   : function(batch) { batches.push(batch); }
        }, opts || {});
        var watcher = rw.createTreeWatcher(options);
        watchers.push(watcher);
        if (options.useFsEvents !== false) {
            // prime the stream (assets-class so any straggler can never flip a
            // later assets-severity assertion), absorb cold-start + replay
            fs.writeFileSync(path.join(root, 'public/prime.css'), 'prime');
            await waitFor(function() { return batches.length > 0; }, 8000);
        }
        batches.length = 0;
        return { root: root, batches: batches, watcher: watcher };
    }

    /** @param {object[]} batches @returns {string[]} all paths seen so far */
    function allPaths(batches) {
        return batches.reduce(function(acc, b) { return acc.concat(b.paths); }, []);
    }

    it('04.01 — a change lands in a debounced batch with restart severity', async function() {
        var ctx = await bootWatched();
        assert.strictEqual(ctx.watcher.isWatching(), true);
        fs.writeFileSync(path.join(ctx.root, 'controllers/controller.js'), 'edited');
        var got = await waitFor(function() {
            return allPaths(ctx.batches).some(function(p) { return /controller\.js$/.test(p); });
        });
        assert.ok(got, 'expected a batch containing controllers/controller.js, got: ' + JSON.stringify(ctx.batches));
        var batch = ctx.batches.filter(function(b) {
            return b.paths.some(function(p) { return /controller\.js$/.test(p); });
        })[0];
        assert.strictEqual(batch.severity, 'restart');
        assert.strictEqual(batch.hasUnknown, false);
    });

    it('04.02 — an assets-only change classifies as assets severity', async function() {
        var ctx = await bootWatched();
        fs.writeFileSync(path.join(ctx.root, 'public/css/app.css'), 'body{}');
        var got = await waitFor(function() {
            return allPaths(ctx.batches).some(function(p) { return /app\.css$/.test(p); });
        });
        assert.ok(got, 'expected a batch containing public/css/app.css');
        var batch = ctx.batches.filter(function(b) {
            return b.paths.some(function(p) { return /app\.css$/.test(p); });
        })[0];
        assert.strictEqual(batch.severity, 'assets');
    });

    it('04.03 — ignored segments never surface (positive control first)', async function() {
        var ctx = await bootWatched();
        // positive control: the channel demonstrably fires
        fs.writeFileSync(path.join(ctx.root, 'controllers/controller.js'), 'control');
        var control = await waitFor(function() { return ctx.batches.length > 0; });
        assert.ok(control, 'positive control batch expected');
        // negative: node_modules churn stays invisible
        ctx.batches.length = 0;
        writeFile(ctx.root, 'node_modules/dep/index.js', 'dep');
        await sleep(400); // > debounce
        var leaked = allPaths(ctx.batches).filter(function(p) { return /node_modules/.test(p); });
        assert.deepStrictEqual(leaked, [], 'node_modules paths must be filtered');
    });

    it('04.04 — pause() drops events; resume() restores delivery', async function() {
        var ctx = await bootWatched();
        ctx.watcher.pause();
        assert.strictEqual(ctx.watcher.isPaused(), true);
        fs.writeFileSync(path.join(ctx.root, 'controllers/controller.js'), 'paused-edit');
        await sleep(400);
        assert.strictEqual(ctx.batches.length, 0, 'no batch while paused');
        ctx.watcher.resume();
        assert.strictEqual(ctx.watcher.isPaused(), false);
        fs.writeFileSync(path.join(ctx.root, 'controllers/controller.js'), 'resumed-edit');
        var got = await waitFor(function() { return ctx.batches.length > 0; });
        assert.ok(got, 'batch expected after resume');
    });

    it('04.05 — close() stops delivery and is idempotent', async function() {
        var ctx = await bootWatched();
        ctx.watcher.close();
        ctx.watcher.close(); // idempotent
        assert.strictEqual(ctx.watcher.isWatching(), false);
        fs.writeFileSync(path.join(ctx.root, 'controllers/controller.js'), 'after-close');
        await sleep(400);
        assert.strictEqual(ctx.batches.length, 0);
    });

    it('04.06 — options are validated (root, onChange, sweep-only prerequisites)', function() {
        assert.throws(function() { rw.createTreeWatcher({ onChange: function() {} }); }, /root/);
        assert.throws(function() { rw.createTreeWatcher({ root: '/nope-' + Date.now(), onChange: function() {} }); }, /not found/);
        var root = mkTmp(tmpDirs);
        assert.throws(function() { rw.createTreeWatcher({ root: root }); }, /onChange/);
        assert.throws(function() {
            rw.createTreeWatcher({ root: root, onChange: function() {}, useFsEvents: false });
        }, /reconcileIntervalMs/);
    });

    it('04.07 — sweep-only mode (useFsEvents:false) detects changes via the reconcile diff', async function() {
        var ctx = await bootWatched({ useFsEvents: false, reconcileIntervalMs: 40, debounceMs: 20 });
        assert.strictEqual(ctx.watcher.isWatching(), true);
        writeFile(ctx.root, 'models/new-model.js', 'created-after-baseline');
        var got = await waitFor(function() {
            return allPaths(ctx.batches).some(function(p) { return /new-model\.js$/.test(p); });
        });
        assert.ok(got, 'sweep-only watcher must surface the change, got: ' + JSON.stringify(ctx.batches));
        var batch = ctx.batches.filter(function(b) {
            return b.paths.some(function(p) { return /new-model\.js$/.test(p); });
        })[0];
        assert.strictEqual(batch.severity, 'restart');
    });
});


describe('release-watch §05 — busy probes', function() {

    afterEach(function() {
        rw.reset();
    });

    it('05.01 — empty registry reads idle', async function() {
        var result = await rw.checkBusyProbes();
        assert.deepStrictEqual(result, { busy: false, probes: [] });
    });

    it('05.02 — promise probe: {busy, detail}, plain boolean, and idle aggregation', async function() {
        rw.registerBusyProbe('a', function() { return { busy: false, detail: 'a idle' }; });
        rw.registerBusyProbe('b', function() { return Promise.resolve(false); });
        var result = await rw.checkBusyProbes();
        assert.strictEqual(result.busy, false);
        assert.strictEqual(result.probes.length, 2);
    });

    it('05.03 — any busy probe flips the aggregate; detail carried through', async function() {
        rw.registerBusyProbe('idle', function() { return false; });
        rw.registerBusyProbe('worker', function() { return { busy: true, detail: '3 jobs running' }; });
        var result = await rw.checkBusyProbes();
        assert.strictEqual(result.busy, true);
        var row = result.probes.filter(function(p) { return p.name === 'worker'; })[0];
        assert.strictEqual(row.busy, true);
        assert.strictEqual(row.detail, '3 jobs running');
    });

    it('05.04 — callback-shaped probes work; a callback error reads busy', async function() {
        rw.registerBusyProbe('cb-idle', function(cb) { cb(null, { busy: false }); });
        rw.registerBusyProbe('cb-err', function(cb) { cb(new Error('backend down')); });
        var result = await rw.checkBusyProbes();
        assert.strictEqual(result.busy, true);
        var err = result.probes.filter(function(p) { return p.name === 'cb-err'; })[0];
        assert.strictEqual(err.busy, true);
        assert.match(err.detail, /backend down/);
    });

    it('05.05 — throwing and rejecting probes read busy (fail-safe)', async function() {
        rw.registerBusyProbe('throws', function() { throw new Error('boom'); });
        rw.registerBusyProbe('rejects', function() { return Promise.reject(new Error('nope')); });
        var result = await rw.checkBusyProbes();
        assert.strictEqual(result.busy, true);
        assert.strictEqual(result.probes.length, 2);
        result.probes.forEach(function(p) { assert.strictEqual(p.busy, true); });
    });

    it('05.06 — a probe that never settles times out as busy', async function() {
        rw.registerBusyProbe('hung', function() { return new Promise(function() {}); });
        var result = await rw.checkBusyProbes({ timeoutMs: 30 });
        assert.strictEqual(result.busy, true);
        assert.match(result.probes[0].detail, /timed out after 30ms/);
    });

    it('05.07 — callback form: err is always null, same aggregate', function(t, doneCb) {
        rw.registerBusyProbe('x', function() { return true; });
        rw.checkBusyProbes(function(err, result) {
            try {
                assert.strictEqual(err, null);
                assert.strictEqual(result.busy, true);
                doneCb();
            } catch (assertErr) {
                doneCb(assertErr);
            }
        });
    });

    it('05.08 — overwrite warns; unregister removes; list reflects', function() {
        var warned = [];
        var origWarn = console.warn;
        console.warn = function(msg) { warned.push(String(msg)); };
        try {
            rw.registerBusyProbe('dup', function() { return false; });
            rw.registerBusyProbe('dup', function() { return true; });
        } finally {
            console.warn = origWarn;
        }
        assert.ok(warned.some(function(m) { return /busy probe `dup` is being overwritten/.test(m); }));
        assert.deepStrictEqual(rw.listBusyProbes(), ['dup']);
        assert.strictEqual(rw.unregisterBusyProbe('dup'), true);
        assert.strictEqual(rw.unregisterBusyProbe('dup'), false);
        assert.deepStrictEqual(rw.listBusyProbes(), []);
    });

    it('05.09 — registration validates inputs', function() {
        assert.throws(function() { rw.registerBusyProbe('', function() {}); }, /name/);
        assert.throws(function() { rw.registerBusyProbe('x', null); }, /fn/);
    });

    it('05.10 — registerDefaultProbes wires the jobs probe (idle in this process, idempotent)', async function() {
        rw.registerDefaultProbes();
        assert.ok(rw.listBusyProbes().indexOf('jobs') > -1);
        rw.registerDefaultProbes(); // idempotent — no overwrite warn path
        var result = await rw.checkBusyProbes();
        var jobs = result.probes.filter(function(p) { return p.name === 'jobs'; })[0];
        assert.ok(jobs, 'jobs probe row expected');
        assert.strictEqual(jobs.busy, false);
        assert.match(jobs.detail, /jobs: 0 running, 0 queued, 0 retry-waiting|lib\/job unavailable|no job stats/);
    });
});


describe('release-watch §06 — in-flight request gauge', function() {

    afterEach(function() {
        rw.reset();
    });

    it('06.01 — trackRequest counts up; done() counts down exactly once', function() {
        assert.strictEqual(rw.getInFlightCount(), 0);
        var done1 = rw.trackRequest('/orders');
        var done2 = rw.trackRequest('/orders/42?full=1');
        assert.strictEqual(rw.getInFlightCount(), 2);
        done1();
        assert.strictEqual(rw.getInFlightCount(), 1);
        done1(); // idempotent — finish AND close both call it
        done1();
        assert.strictEqual(rw.getInFlightCount(), 1);
        done2();
        assert.strictEqual(rw.getInFlightCount(), 0);
        done2();
        assert.strictEqual(rw.getInFlightCount(), 0);
    });

    it('06.02 — /_gina/* control paths never enter the gauge (SSE would deadlock the idle gate)', function() {
        var d1 = rw.trackRequest('/_gina/release/status');
        var d2 = rw.trackRequest('/_gina/release/events');
        var d3 = rw.trackRequest('/_gina/logs?tail=1');
        assert.strictEqual(rw.getInFlightCount(), 0);
        d1(); d2(); d3();
        assert.strictEqual(rw.getInFlightCount(), 0);
    });

    it('06.03 — the exclusion matches the PATH, not the query string', function() {
        var done = rw.trackRequest('/orders?next=/_gina/whatever');
        assert.strictEqual(rw.getInFlightCount(), 1);
        done();
        assert.strictEqual(rw.getInFlightCount(), 0);
    });

    it('06.04 — reset() zeroes the gauge and the probe registry', function() {
        rw.trackRequest('/a');
        rw.registerBusyProbe('p', function() { return false; });
        rw.reset();
        assert.strictEqual(rw.getInFlightCount(), 0);
        assert.deepStrictEqual(rw.listBusyProbes(), []);
    });
});


describe('release-watch §07 — build-verb fingerprint stamps (source pins)', function() {

    it('07.01 — bundle:build threads lib.releaseWatch.fingerprintTree BEFORE the manifest write', function() {
        var callIdx  = BUILD_SRC.indexOf('lib.releaseWatch.fingerprintTree(');
        var writeIdx = BUILD_SRC.indexOf('createFileFromDataSync');
        assert.ok(callIdx > -1, 'fingerprintTree call expected in bundle/build.js');
        assert.ok(writeIdx > -1);
        assert.ok(callIdx < writeIdx, 'the stamp must precede the manifest write');
    });

    it('07.02 — project:build carries the mirror stamp, also before its manifest write', function() {
        var callIdx  = PROJECT_BUILD_SRC.indexOf('lib.releaseWatch.fingerprintTree(');
        var writeIdx = PROJECT_BUILD_SRC.indexOf('createFileFromDataSync');
        assert.ok(callIdx > -1, 'fingerprintTree call expected in project/build.js');
        assert.ok(writeIdx > -1);
        assert.ok(callIdx < writeIdx, 'the stamp must precede the manifest write');
    });

    it('07.03 — both stamps are non-fatal (warn, never end(err)) and scoped to defaultScope', function() {
        [BUILD_SRC, PROJECT_BUILD_SRC].forEach(function(src) {
            assert.ok(src.indexOf('could not stamp the release fingerprint') > -1, 'non-fatal warn expected');
            assert.ok(src.indexOf('releases[self.defaultScope]') > -1, 'stamp must target the built scope only');
        });
    });

    it('07.04 — lib/index.js registers releaseWatch via a PLAIN require (singleton survives refreshCore)', function() {
        assert.match(LIB_INDEX_SRC, /releaseWatch\s+:\s+require\('\.\/release-watch'\)/);
        assert.doesNotMatch(LIB_INDEX_SRC, /_require\('\.\/release-watch'\)/);
    });
});


describe('release-watch §08 — stamp-record loop replica (pure logic)', function() {

    /**
     * Verbatim-lifted replica of the build-verb stamp loop: only records that
     * exist AND carry a target get the three fields, and only under the built
     * (default) scope.
     * @param {object} manifestBundle - manifest.bundles[bundle]
     * @param {string[]} envs
     * @param {string} defaultScope
     * @param {{hash:string, spec:number}} fpResult
     * @param {string} fpBuiltAt
     */
    function applyStamp(manifestBundle, envs, defaultScope, fpResult, fpBuiltAt) {
        if ( fpResult && fpResult.hash ) {
            for (let f = 0, fLen = envs.length; f < fLen; f++) {
                let fpEnv = envs[f];
                let fpRec = ( typeof(manifestBundle.releases[defaultScope]) != 'undefined' )
                    ? manifestBundle.releases[defaultScope][fpEnv]
                    : null;
                if ( fpRec && fpRec.target ) {
                    fpRec.fingerprint   = fpResult.hash;
                    fpRec.builtAt       = fpBuiltAt;
                    fpRec.fpSpec        = fpResult.spec;
                }
            }
        }
    }

    it('08.01 — existing records under the built scope are stamped; other scopes untouched', function() {
        var mb = {
            releases: {
                local:      { prod: { target: 'releases/b/local/prod/1.0.0' }, dev: { target: 'releases/b/local/dev/1.0.0' } },
                production: { prod: { target: 'releases/b/production/prod/1.0.0' } }
            }
        };
        applyStamp(mb, ['prod', 'dev'], 'local', { hash: 'abc', spec: 1 }, '2026-07-15T00:00:00.000Z');
        assert.strictEqual(mb.releases.local.prod.fingerprint, 'abc');
        assert.strictEqual(mb.releases.local.prod.fpSpec, 1);
        assert.strictEqual(mb.releases.local.prod.builtAt, '2026-07-15T00:00:00.000Z');
        assert.strictEqual(mb.releases.local.dev.fingerprint, 'abc');
        assert.strictEqual(typeof mb.releases.production.prod.fingerprint, 'undefined', 'unbuilt scope must stay untouched');
    });

    it('08.02 — missing records (project:build dev_env skip) and targetless records are left alone', function() {
        var mb = { releases: { local: { prod: { target: 'releases/b/local/prod/1.0.0' }, staging: { target: null } } } };
        applyStamp(mb, ['prod', 'dev', 'staging'], 'local', { hash: 'abc', spec: 1 }, 'T');
        assert.strictEqual(mb.releases.local.prod.fingerprint, 'abc');
        assert.strictEqual(typeof mb.releases.local.staging.fingerprint, 'undefined', 'targetless record must stay untouched');
        assert.strictEqual(typeof mb.releases.local.dev, 'undefined', 'skipped env must not be created');
    });

    it('08.03 — a null fingerprint (missing src root) stamps nothing', function() {
        var mb = { releases: { local: { prod: { target: 't' } } } };
        applyStamp(mb, ['prod'], 'local', null, 'T');
        assert.strictEqual(typeof mb.releases.local.prod.fingerprint, 'undefined');
    });
});
