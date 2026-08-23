'use strict';
/**
 * #RW1 slice 2 — lib/release-watch SERVICE (the stale-release state machine).
 *
 * Behavioral coverage on a REAL temp project fixture (manifest.json + src
 * tree, stamps computed with the real fingerprintTree so stamp ↔ compare
 * integrate for real), with injected seams for the process-level effects:
 * spawnBuild (fake child restamping the manifest like the real build),
 * execRestart (recorder), flushRenderCache (recorder). Watching runs in
 * sweep-only mode (useFsEvents:false) for determinism — the fs-events
 * channel is covered by release-watch.test.js §04.
 *
 * The service is a module singleton: every test deactivate()s + reset()s in
 * afterEach. All service timers are unref'd — this file must exit cleanly
 * WITHOUT --test-force-exit.
 *
 * Run: node --test test/lib/release-watch-service.test.js
 */

var assert = require('node:assert');
var { describe, it, afterEach, after } = require('node:test');
var EventEmitter = require('node:events').EventEmitter;
var fs     = require('fs');
var os     = require('os');
var path   = require('path');

var FW = require('../fw');
var rw = require(FW + '/lib/release-watch/src/main');

var tmpDirs = [];

/** Sweep/gate timings tuned small; waitFor deadlines stay generous. */
var T = { sweep: 30, debounce: 15, gate: 20, grace: 40 };

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
            setTimeout(poll, 10);
        })();
    });
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/**
 * Writes a file under root, creating parent dirs.
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 * @returns {string}
 */
function writeFile(root, rel, content, sameLengthOk) {
    var abs = path.join(root, rel);
    // #B411 — the release fingerprint is `relpath|size|floor(mtimeMs)`, so an
    // edit that preserves BYTE LENGTH is detectable only by the millisecond of
    // mtime. When such a write lands in the baseline stamp's own tick the
    // fingerprint does not move, the sweep sees nothing, and the awaiting test
    // times out with no clue why — which is exactly how S.19 flaked across
    // three release cuts. Fail loudly at the write instead of mysteriously
    // later. Pass sameLengthOk:true when a test is deliberately probing the
    // mtime-only path.
    if (!sameLengthOk && fs.existsSync(abs)) {
        var prev = fs.readFileSync(abs, 'utf8');
        assert.notStrictEqual(
            Buffer.byteLength(content), Buffer.byteLength(prev),
            'writeFile(' + rel + '): replacement is the same byte length as the ' +
            'existing content, so the fingerprint can only change via mtime (#B411). ' +
            'Change the length, or pass sameLengthOk:true if that is the point.'
        );
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
}

/**
 * Builds a real temp project: src tree + manifest.json whose release stamp
 * is the REAL fingerprint of the src tree (i.e. "freshly built").
 * @param {object} [opts]
 * @param {boolean} [opts.stamped=true] - False = pre-feature manifest (no fingerprint keys)
 * @returns {{root:string, srcRoot:string, manifestPath:string, stampNow:function}}
 */
function mkProject(opts) {
    opts = opts || {};
    var root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-rws-'));
    tmpDirs.push(root);
    var srcRoot = path.join(root, 'src/web');
    writeFile(root, 'src/web/controllers/controller.js', 'seed-controller');
    writeFile(root, 'src/web/templates/html/index.html', 'seed-template');
    writeFile(root, 'src/web/public/css/app.css', 'seed-css');
    var manifestPath = path.join(root, 'manifest.json');

    /**
     * (Re-)stamps the manifest release record with the CURRENT src fingerprint —
     * what a real `gina bundle:build` does.
     * @returns {string} the stamped hash
     */
    var stampNow = function() {
        var fp = rw.fingerprintTree(srcRoot);
        var manifest = {
            bundles: {
                web: {
                    version  : '1.0.0',
                    src      : 'src/web',
                    releases : {
                        local: {
                            prod: {
                                target      : 'releases/web/local/prod/1.0.0',
                                fingerprint : fp.hash,
                                builtAt     : new Date().toISOString(),
                                fpSpec      : fp.spec
                            }
                        }
                    }
                }
            }
        };
        if (opts.stamped === false) {
            delete manifest.bundles.web.releases.local.prod.fingerprint;
            delete manifest.bundles.web.releases.local.prod.builtAt;
            delete manifest.bundles.web.releases.local.prod.fpSpec;
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return fp.hash;
    };
    stampNow();
    return { root: root, srcRoot: srcRoot, manifestPath: manifestPath, stampNow: stampNow };
}

/**
 * A ChildProcess-shaped fake whose exit is test-driven.
 * @returns {object}
 */
function fakeChild() {
    var child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
}

/**
 * Arms the service on a project with recorder seams.
 * @param {object} proj - mkProject() result
 * @param {object} [over] - init option overrides
 * @returns {{events:object[], flushes:string[], restarts:object[], builds:object[], lastChild:function}}
 */
function armService(proj, over) {
    var rec = { events: [], flushes: [], restarts: [], builds: [], _children: [] };
    rec.lastChild = function() { return rec._children[rec._children.length - 1]; };
    var ok = rw.init(Object.assign({
        bundle              : 'web',
        project             : 'demo',
        env                 : 'prod',
        scope               : 'local',
        srcRoot             : proj.srcRoot,
        manifestPath        : proj.manifestPath,
        useFsEvents         : false,
        reconcileIntervalMs : T.sweep,
        debounceMs          : T.debounce,
        gateIntervalMs      : T.gate,
        graceMs             : T.grace,
        probeTimeoutMs      : 200,
        autoCooldownMs      : 0,
        flushRenderCache    : function(bundle) { rec.flushes.push(bundle); },
        spawnBuild          : function(svc) {
            var child = fakeChild();
            rec._children.push(child);
            rec.builds.push({ bundle: svc.bundle, at: Date.now() });
            return child;
        },
        execRestart         : function(svc, done) {
            rec.restarts.push({ bundle: svc.bundle, at: Date.now() });
            done(null);
        }
    }, over || {}));
    assert.strictEqual(ok, true, 'service must arm');
    rw.subscribe(function(evt) { rec.events.push(evt); });
    return rec;
}

/** @param {object[]} events @param {string} type @returns {object[]} */
function ofType(events, type) {
    return events.filter(function(e) { return e.type === type; });
}

/**
 * Completes the current fake build the way the real one would: restamp the
 * manifest from the CURRENT src, then exit 0.
 * @param {object} proj
 * @param {object} rec
 * @param {string[]} [lines]
 */
function completeBuild(proj, rec, lines) {
    var child = rec.lastChild();
    (lines || ['[build] Building bundle `web@demo`', 'Bundle [ web ] built with success']).forEach(function(l) {
        child.stdout.emit('data', Buffer.from(l + '\n'));
    });
    proj.stampNow();
    child.emit('exit', 0);
}


describe('release-watch-service — state machine (behavioral, injected seams)', function() {

    afterEach(function() {
        rw.deactivate();
        rw.reset();
    });
    after(function() {
        tmpDirs.forEach(function(d) { fs.rmSync(d, { recursive: true, force: true }); });
    });

    it('S.01 — init on a freshly-built project arms fresh (no staleness, buildId set)', function() {
        var proj = mkProject();
        armService(proj);
        assert.strictEqual(rw.isActive(), true);
        var st = rw.getStatus();
        assert.strictEqual(st.stale, false);
        assert.strictEqual(st.srcStale, false);
        assert.strictEqual(st.processBehind, false);
        assert.strictEqual(st.severity, null);
        assert.strictEqual(st.stampUnknown, false);
        assert.match(st.buildId, /^[0-9a-f]{12}$/);
        assert.strictEqual(st.buildId, st.releaseBuildId);
        assert.strictEqual(st.watching, true);
    });

    it('S.02 — boot compare: a pre-init edit arms STALE restart-class (the env-switch case)', function() {
        var proj = mkProject();
        writeFile(proj.root, 'src/web/controllers/controller.js', 'edited-before-boot');
        armService(proj);
        var st = rw.getStatus();
        assert.strictEqual(st.srcStale, true);
        assert.strictEqual(st.severity, 'restart');
        assert.deepStrictEqual(st.changes, ['(boot-compare)']);
        assert.ok(st.staleSince);
    });

    it('S.03 — a pre-feature manifest (no stamp) arms UNKNOWN, not stale (no false alarm)', function() {
        var proj = mkProject({ stamped: false });
        armService(proj);
        var st = rw.getStatus();
        assert.strictEqual(st.stampUnknown, true);
        assert.strictEqual(st.stale, false);
        assert.strictEqual(st.buildId, null);
    });

    it('S.04 — a watched edit verifies against the stamp and flips stale with the right class', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        writeFile(proj.root, 'src/web/public/css/app.css', 'body{color:red}');
        var got = await waitFor(function() { return rw.getStatus().srcStale; });
        assert.ok(got, 'stale expected after the sweep');
        var st = rw.getStatus();
        assert.strictEqual(st.severity, 'assets');
        assert.ok(st.changes.some(function(p) { return /app\.css$/.test(p); }));
        assert.ok(ofType(rec.events, 'stale').length >= 1);
    });

    it('S.05 — severity escalates assets → restart and never de-escalates on later assets edits', async function() {
        var proj = mkProject();
        armService(proj);
        writeFile(proj.root, 'src/web/public/css/app.css', 'a{}');
        await waitFor(function() { return rw.getStatus().severity === 'assets'; });
        writeFile(proj.root, 'src/web/templates/html/index.html', 'edited-template');
        var got = await waitFor(function() { return rw.getStatus().severity === 'restart'; });
        assert.ok(got, 'restart escalation expected');
        // 4 bytes, not 3: a same-length swap over 'a{}' would be invisible to the
        // fingerprint, and this assertion would then pass vacuously (#B411).
        writeFile(proj.root, 'src/web/public/css/app.css', 'bb{}');
        await sleep(T.sweep * 4);
        assert.strictEqual(rw.getStatus().severity, 'restart', 'must not de-escalate');
    });

    it('S.06 — a reverted edit self-heals (fingerprint equals the stamp again)', async function() {
        var proj = mkProject();
        var cssAbs = path.join(proj.srcRoot, 'public/css/app.css');
        // Pin the file's mtime to a whole-ms value BEFORE stamping, then revert
        // to that same pinned value — a raw statSync round-trip is NOT stable
        // (APFS stores sub-ms mtimes; Date truncates), which made this scenario
        // precision-flaky. Deterministic by construction instead.
        var PINNED = new Date(1700000000000);
        fs.utimesSync(cssAbs, PINNED, PINNED);
        proj.stampNow(); // stamp reflects the pinned mtime
        armService(proj);
        fs.writeFileSync(cssAbs, 'temporary-edit');
        var wentStale = await waitFor(function() { return rw.getStatus().srcStale; });
        assert.ok(wentStale, 'stale first');
        // revert bytes AND mtime — the fingerprint is (size|mtime)-based
        fs.writeFileSync(cssAbs, 'seed-css');
        fs.utimesSync(cssAbs, PINNED, PINNED);
        var healed = await waitFor(function() { return rw.getStatus().srcStale === false; });
        assert.ok(healed, 'self-heal expected once src matches the stamp again');
        assert.strictEqual(rw.getStatus().severity, null);
    });

    it('S.07 — assets-only pipeline: build → flush → done, NO idle gate, NO restart, ends fresh', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        writeFile(proj.root, 'src/web/public/css/app.css', 'body{margin:0}');
        await waitFor(function() { return rw.getStatus().srcStale; });

        var r = rw.requestRebuild({ restart: 'auto' });
        assert.deepStrictEqual(r, { accepted: true, reason: null });
        assert.strictEqual(rw.getStatus().action.state, 'building');

        completeBuild(proj, rec);
        var done = await waitFor(function() { return ofType(rec.events, 'done').length > 0; });
        assert.ok(done, 'done event expected');
        var st = rw.getStatus();
        assert.strictEqual(st.action, null);
        assert.strictEqual(st.stale, false, 'assets rebuild ends fully fresh');
        assert.strictEqual(st.processBehind, false, 'assets-only must NOT owe a restart');
        assert.deepStrictEqual(rec.flushes, ['web'], 'render cache flushed exactly once');
        assert.strictEqual(rec.restarts.length, 0, 'no restart for assets-only');
        assert.strictEqual(ofType(rec.events, 'done')[0].data.restarted, false);
        assert.ok(ofType(rec.events, 'build').length >= 2, 'build progress events expected');
        assert.strictEqual(rw.getStatus().releaseBuildId, rw.fingerprintTree(proj.srcRoot).hash.substring(0, 12));
    });

    it('S.08 — restart-class pipeline: idle gate waits on in-flight HTTP, then restarts when idle', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        writeFile(proj.root, 'src/web/controllers/controller.js', 'edited-controller');
        await waitFor(function() { return rw.getStatus().severity === 'restart'; });

        var doneReq = rw.trackRequest('/orders'); // one in-flight request holds the gate
        rw.requestRebuild({ restart: 'auto' });
        completeBuild(proj, rec);

        var waiting = await waitFor(function() { return rw.getStatus().action && rw.getStatus().action.state === 'waiting'; });
        assert.ok(waiting, 'waiting state expected');
        var sawWaiting = await waitFor(function() { return ofType(rec.events, 'waiting').length > 0; }, 4000);
        assert.ok(sawWaiting, 'waiting event expected while the request is in flight');
        assert.strictEqual(ofType(rec.events, 'waiting')[0].data.inFlight, 1);
        assert.strictEqual(rec.restarts.length, 0, 'must not restart under load');

        doneReq(); // request finishes → gate opens after graceMs
        var restarted = await waitFor(function() { return rec.restarts.length === 1; }, 4000);
        assert.ok(restarted, 'restart executor expected after idle');
        assert.ok(ofType(rec.events, 'restarting').length >= 1);
        assert.strictEqual(ofType(rec.events, 'restarting')[0].data.how, 'idle');
        assert.strictEqual(rw.getStatus().processBehind, true, 'restart-class rebuild leaves the process behind until the successor boots');
    });

    it('S.09 — a busy probe holds the gate; forceRestartGate() overrides it', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        var appBusy = true;
        rw.registerBusyProbe('worker', function() {
            return { busy: appBusy, detail: '3 jobs running' };
        });
        writeFile(proj.root, 'src/web/models/m.js', 'new-model');
        await waitFor(function() { return rw.getStatus().severity === 'restart'; });

        rw.requestRebuild({ restart: 'auto' });
        completeBuild(proj, rec);
        var sawWaiting = await waitFor(function() { return ofType(rec.events, 'waiting').length > 0; }, 4000);
        assert.ok(sawWaiting, 'gate must wait on the busy probe');
        var row = ofType(rec.events, 'waiting')[0].data.probes.filter(function(p) { return p.name === 'worker'; })[0];
        assert.ok(row && row.busy && /3 jobs running/.test(row.detail), 'probe detail must surface');
        assert.strictEqual(rec.restarts.length, 0);

        assert.strictEqual(rw.forceRestartGate(), true);
        var restarted = await waitFor(function() { return rec.restarts.length === 1; }, 4000);
        assert.ok(restarted, 'force must open the gate');
        assert.strictEqual(ofType(rec.events, 'restarting')[0].data.how, 'forced');
        appBusy = false;
    });

    it('S.10 — restart policy `skip`: build + flush only, staleness retains the pending restart', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        writeFile(proj.root, 'src/web/controllers/controller.js', 'edited-again');
        await waitFor(function() { return rw.getStatus().severity === 'restart'; });

        rw.requestRebuild({ restart: 'skip' });
        completeBuild(proj, rec);
        var done = await waitFor(function() { return ofType(rec.events, 'done').length > 0; });
        assert.ok(done);
        var evt = ofType(rec.events, 'done')[0].data;
        assert.strictEqual(evt.restarted, false);
        assert.strictEqual(evt.restartPending, true);
        var st = rw.getStatus();
        assert.strictEqual(st.srcStale, false, 'src matches the rebuilt release');
        assert.strictEqual(st.processBehind, true, 'process still serves the old release');
        assert.strictEqual(st.stale, true);
        assert.strictEqual(st.severity, 'restart');
        assert.strictEqual(rec.restarts.length, 0);
    });

    it('S.11 — a failing build surfaces an error, clears the action, resumes watching', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        writeFile(proj.root, 'src/web/public/css/app.css', 'x{}');
        await waitFor(function() { return rw.getStatus().srcStale; });

        rw.requestRebuild({});
        var child = rec.lastChild();
        child.stdout.emit('data', Buffer.from('some step\n'));
        child.emit('exit', 1);

        var errored = await waitFor(function() { return ofType(rec.events, 'error').length > 0; });
        assert.ok(errored, 'error event expected');
        var st = rw.getStatus();
        assert.strictEqual(st.action, null);
        assert.match(st.lastError, /exited with code 1/);
        assert.strictEqual(st.srcStale, true, 'still stale after a failed build');
        // watching resumed: a further edit still flips state
        writeFile(proj.root, 'src/web/models/late.js', 'late');
        var escalated = await waitFor(function() { return rw.getStatus().severity === 'restart'; });
        assert.ok(escalated, 'watcher must be live again after the failure');
    });

    it('S.12 — a second rebuild while one runs is rejected busy; inactive service rejects too', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        writeFile(proj.root, 'src/web/public/css/app.css', 'y{}');
        await waitFor(function() { return rw.getStatus().srcStale; });
        assert.strictEqual(rw.requestRebuild({}).accepted, true);
        assert.deepStrictEqual(rw.requestRebuild({}), { accepted: false, reason: 'busy' });
        completeBuild(proj, rec);
        await waitFor(function() { return rw.getStatus().action === null; });
        rw.deactivate();
        assert.deepStrictEqual(rw.requestRebuild({}), { accepted: false, reason: 'inactive' });
    });

    it('S.13 — auto mode: a verified stale auto-runs the pipeline to done with no operator call', async function() {
        var proj = mkProject();
        var rec = armService(proj, { mode: 'auto' });
        writeFile(proj.root, 'src/web/public/css/app.css', 'auto{}');
        var built = await waitFor(function() { return rec.builds.length === 1; }, 4000);
        assert.ok(built, 'auto mode must start the build itself');
        completeBuild(proj, rec);
        var done = await waitFor(function() { return ofType(rec.events, 'done').length > 0; }, 4000);
        assert.ok(done);
        assert.strictEqual(rw.getStatus().stale, false);
        assert.strictEqual(rec.restarts.length, 0, 'assets-only auto cycle must not restart');
    });

    it('S.14 — external rebuild detection: a manifest restamp flips processBehind (fail-safe)', async function() {
        var proj = mkProject();
        armService(proj);
        // an operator runs `gina bundle:build` in a terminal: src edit + restamp
        writeFile(proj.root, 'src/web/controllers/controller.js', 'external-edit');
        proj.stampNow();
        var seen = await waitFor(function() {
            var st = rw.getStatus();
            return st.processBehind === true;
        }, 4000);
        assert.ok(seen, 'external rebuild must surface as a pending restart');
        var st = rw.getStatus();
        assert.notStrictEqual(st.releaseBuildId, st.buildId, 'release moved past the boot identity');
        assert.strictEqual(st.srcStale, false, 'src matches the (externally) rebuilt release');
    });

    it('S.15 — deactivate() disarms cleanly and is idempotent', function() {
        var proj = mkProject();
        armService(proj);
        assert.strictEqual(rw.isActive(), true);
        rw.deactivate();
        rw.deactivate();
        assert.strictEqual(rw.isActive(), false);
        assert.strictEqual(rw.getStatus(), null);
        assert.strictEqual(rw.subscribe(function() {}), null);
    });

    it('S.16 — init validates inputs and refuses to double-arm', function() {
        var proj = mkProject();
        assert.strictEqual(rw.init({}), false, 'missing options must refuse');
        assert.strictEqual(rw.init({
            bundle: 'web', project: 'demo', env: 'prod', scope: 'local',
            srcRoot: proj.srcRoot + '-nope', manifestPath: proj.manifestPath
        }), false, 'missing src root must refuse');
        armService(proj);
        var again = rw.init({
            bundle: 'web', project: 'demo', env: 'prod', scope: 'local',
            srcRoot: proj.srcRoot, manifestPath: proj.manifestPath
        });
        assert.strictEqual(again, false, 'double init must refuse');
        assert.strictEqual(rw.isActive(), true, 'first arm must survive');
    });

    it('S.17 — a proactive rebuild on a FRESH service builds + flushes but never restarts', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        assert.strictEqual(rw.getStatus().stale, false);
        assert.strictEqual(rw.requestRebuild({ restart: 'auto' }).accepted, true);
        completeBuild(proj, rec); // no src change — the restamp hash is unchanged
        var done = await waitFor(function() { return ofType(rec.events, 'done').length > 0; });
        assert.ok(done, 'done event expected');
        assert.strictEqual(ofType(rec.events, 'waiting').length, 0, 'a fresh rebuild must not enter the idle gate');
        assert.strictEqual(rec.restarts.length, 0, 'a healthy process must not be bounced (an intentional bounce is ?restart=force)');
        var st = rw.getStatus();
        assert.strictEqual(st.action, null);
        assert.strictEqual(st.stale, false);
        assert.deepStrictEqual(rec.flushes, ['web']);
    });

    it('S.18 — an edit DURING a build re-classifies restart-class; the next rebuild restarts (no silent stale)', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        // phase 1 — assets-class staleness
        // NB: length differs from the seed on purpose — see writeFile (#B411).
        writeFile(proj.root, 'src/web/public/css/app.css', 'phase-1{}');
        await waitFor(function() { return rw.getStatus().severity === 'assets'; });
        // phase 2 — rebuild; the real build stamps at BUILD START (pre-edit)…
        rw.requestRebuild({ restart: 'auto' });
        proj.stampNow(); // build-start stamp: the css edit only
        // …then the operator edits SERVER CODE while the build runs — the watcher
        // is paused, so the event is dropped and the resume re-baseline swallows it
        writeFile(proj.root, 'src/web/controllers/controller.js', 'edited-during-build');
        rec.lastChild().emit('exit', 0); // build completes WITHOUT seeing the edit
        var done1 = await waitFor(function() { return ofType(rec.events, 'done').length > 0; });
        assert.ok(done1, 'first pipeline must complete (assets endgame)');
        assert.strictEqual(rec.restarts.length, 0, 'the assets-classified action itself must not restart');
        var st = rw.getStatus();
        assert.strictEqual(st.srcStale, true, 'post-build drift must keep the service stale');
        assert.strictEqual(st.severity, 'restart', 'unclassifiable drift must fail safe to restart-class');
        assert.ok(st.changes.indexOf('(post-build-drift)') > -1, 'the drift sentinel must surface in changes');
        assert.strictEqual(st.processBehind, false, 'the assets-only adopt still holds for the delta this build answered');
        // phase 3 — the next rebuild carries restart-class end to end
        assert.strictEqual(rw.requestRebuild({ restart: 'auto' }).accepted, true);
        completeBuild(proj, rec); // restamps WITH the controller edit
        var restarted = await waitFor(function() { return rec.restarts.length === 1; }, 4000);
        assert.ok(restarted, 'the second rebuild must idle-gate and restart — the during-build edit is server code');
        assert.strictEqual(rw.getStatus().processBehind, true);
    });

    it('S.19 — a batch-discovered external rebuild emits a `behind` event for SSE subscribers', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        // an operator runs `gina bundle:build` in a terminal: src edit + restamp
        // NB: length differs from the seed on purpose — see writeFile (#B411).
        writeFile(proj.root, 'src/web/controllers/controller.js', 'external-edit-22');
        proj.stampNow();
        // the predicate reads only the event stream — no getStatus() poll, so the
        // emit provenance is the sweep→batch→adopt path, not a status poll
        var seen = await waitFor(function() { return ofType(rec.events, 'behind').length > 0; }, 4000);
        assert.ok(seen, 'the batch-path adopt must emit `behind` — SSE clients must not need a status poll');
        var evt = ofType(rec.events, 'behind')[0].data;
        assert.strictEqual(evt.processBehind, true);
        assert.match(evt.releaseBuildId, /^[0-9a-f]{12}$/);
    });

    it('S.20 — a pipeline dying in `waiting` (late child error) cannot strand the NEXT pipeline\'s gate', async function() {
        var proj = mkProject();
        var rec = armService(proj);
        writeFile(proj.root, 'src/web/controllers/controller.js', 'edited-for-s20');
        await waitFor(function() { return rw.getStatus().severity === 'restart'; });
        var doneReq = rw.trackRequest('/held'); // hold the gate open
        rw.requestRebuild({ restart: 'auto' });
        completeBuild(proj, rec);
        var waiting = await waitFor(function() { return rw.getStatus().action && rw.getStatus().action.state === 'waiting'; });
        assert.ok(waiting, 'first pipeline must reach waiting');
        // the build child errors LATE (after its exit) — the pipeline dies mid-gate
        rec.lastChild().emit('error', new Error('late boom'));
        var errored = await waitFor(function() { return ofType(rec.events, 'error').length > 0; });
        assert.ok(errored, 'late child error must surface');
        assert.strictEqual(rw.getStatus().action, null, 'the dead pipeline must clear its action');
        assert.match(rw.getStatus().lastError, /late boom/);
        doneReq(); // release the held request
        // the SECOND pipeline must run end to end — a leaked gate interval from the
        // dead pipeline would clear the new gate and strand it in `waiting` forever
        assert.strictEqual(rw.requestRebuild({ restart: 'auto' }).accepted, true);
        completeBuild(proj, rec);
        var restarted = await waitFor(function() { return rec.restarts.length === 1; }, 4000);
        assert.ok(restarted, 'the successor pipeline\'s idle gate must still open');
        assert.strictEqual(ofType(rec.events, 'restarting').length, 1);
    });
});


describe('release-watch-service §pins — the default restart executor', function() {

    var SRC = fs.readFileSync(FW + '/lib/release-watch/src/main.js', 'utf8');

    it('P.01 — the detached bundle:restart child carries an error listener (async spawn failure must not crash the drained process)', function() {
        var start = SRC.indexOf('var defaultExecRestart');
        var end   = SRC.indexOf('var supervisorExecRestart');
        assert.ok(start > -1 && end > start, 'defaultExecRestart block anchors expected');
        var blk = SRC.substring(start, end);
        assert.ok(blk.indexOf("child.on('error'") > -1, 'spawn error listener expected before unref()');
        assert.ok(blk.indexOf('child.unref()') > -1);
        assert.ok(blk.indexOf("'bundle:restart'") > -1);
    });

    // ── #RWATCH S4a — restartMode: the daemonless supervisor executor ──
    it('P.02 — the drain is factored into a shared drainHttpServer helper both executors call', function() {
        assert.ok(SRC.indexOf('var drainHttpServer') > -1, 'shared drain helper expected');
        var defBlk = SRC.substring(SRC.indexOf('var defaultExecRestart'), SRC.indexOf('var supervisorExecRestart'));
        var supBlk = SRC.substring(SRC.indexOf('var supervisorExecRestart'), SRC.indexOf('var runIdleGate'));
        assert.ok(defBlk.indexOf('drainHttpServer(ctx.httpServer') > -1, 'default executor drains via the shared helper');
        assert.ok(supBlk.indexOf('drainHttpServer(ctx.httpServer') > -1, 'supervisor executor drains via the shared helper');
    });

    it('P.03 — the supervisor executor exit(0)s with an fs.writeSync-flushed final line and NEVER spawns bundle:restart', function() {
        var supBlk = SRC.substring(SRC.indexOf('var supervisorExecRestart'), SRC.indexOf('var runIdleGate'));
        assert.ok(/fs\.writeSync\(2,/.test(supBlk), 'the final line must be fs.writeSync(2)-flushed (container stdout is a pipe — boot-exit-flush)');
        assert.ok(/exitProcess\(0\)/.test(supBlk), 'supervisor must exit(0) for a supervisor respawn');
        assert.ok(supBlk.indexOf('bundle:restart') < 0, 'the supervisor path must NEVER spawn bundle:restart (no daemon in a container)');
        assert.ok(supBlk.indexOf('child_process') < 0, 'the supervisor path must not spawn any child');
    });

    it('P.04 — init selects the executor by restartMode and warns on an invalid value', function() {
        assert.ok(/restartMode === 'supervisor' \? supervisorExecRestart : defaultExecRestart/.test(SRC),
            'init must select supervisorExecRestart when restartMode is supervisor');
        assert.ok(/unknown restartMode/.test(SRC), 'an invalid restartMode must warn (fail-safe to daemon)');
    });
});


describe('release-watch-service — restartMode wiring + supervisor executor (behavioral)', function() {

    afterEach(function() {
        rw.deactivate();
        rw.reset();
    });
    after(function() {
        tmpDirs.forEach(function(d) { fs.rmSync(d, { recursive: true, force: true }); });
    });

    it('RM.01 — restartMode `supervisor` is selected and surfaced on getStatus()', function() {
        armService(mkProject(), { restartMode: 'supervisor' });
        assert.strictEqual(rw.getStatus().restartMode, 'supervisor');
    });

    it('RM.02 — restartMode defaults to `daemon` when absent (current verified behavior)', function() {
        armService(mkProject());
        assert.strictEqual(rw.getStatus().restartMode, 'daemon');
    });

    it('RM.03 — an explicit `daemon` is honoured', function() {
        armService(mkProject(), { restartMode: 'daemon' });
        assert.strictEqual(rw.getStatus().restartMode, 'daemon');
    });

    it('RM.04 — an invalid restartMode warns and fails safe to `daemon`', function() {
        var warns = [];
        var origWarn = console.warn;
        console.warn = function() { warns.push(Array.prototype.join.call(arguments, ' ')); };
        try { armService(mkProject(), { restartMode: 'k8s' }); }
        finally { console.warn = origWarn; }
        assert.strictEqual(rw.getStatus().restartMode, 'daemon', 'invalid ⇒ fail-safe to daemon');
        assert.ok(warns.some(function(w) { return /unknown restartMode/.test(w) && /k8s/.test(w); }),
            'an invalid restartMode must warn');
    });

    it('RM.05 — the supervisor executor DRAINS then process.exit(0)s (no bundle:restart spawn)', async function() {
        var proj  = mkProject();
        var order = [], exited = [], closed = 0;
        var fakeServer = {
            close                : function(cb) { order.push('close'); closed++; if (cb) cb(); },
            closeIdleConnections : function() { order.push('closeIdle'); }
        };
        // execRestart:undefined overrides the recorder → the REAL supervisorExecRestart runs
        var rec = armService(proj, {
            restartMode : 'supervisor',
            execRestart : undefined,
            httpServer  : fakeServer,
            exitProcess : function(code) { order.push('exit:' + code); exited.push(code); }
        });
        assert.strictEqual(rw.getStatus().restartMode, 'supervisor');

        writeFile(proj.root, 'src/web/controllers/controller.js', 'edited-supervisor');
        await waitFor(function() { return rw.getStatus().severity === 'restart'; });
        rw.requestRebuild({ restart: 'auto' });   // no in-flight → the idle gate opens on its own
        completeBuild(proj, rec);

        var didExit = await waitFor(function() { return exited.length === 1; }, 4000);
        assert.ok(didExit, 'the supervisor executor must process.exit — only it calls exitProcess (default would spawn instead)');
        assert.deepStrictEqual(exited, [0], 'exit code 0 = a clean supervisor respawn');
        assert.strictEqual(closed, 1, 'the http server must be drained (closed) exactly once');
        assert.ok(order.indexOf('close') > -1 && order.indexOf('close') < order.indexOf('exit:0'),
            'drain (close) must precede exit(0)');
        assert.strictEqual(ofType(rec.events, 'restarting')[0].data.how, 'idle',
            'the gate opened idle, not forced');
    });
});
