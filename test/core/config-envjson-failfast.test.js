'use strict';
/**
 * #B181(b) — a project `env.json` that carries no configuration block for the
 * bundle being started killed the boot with an OPAQUE deref.
 *
 * Mechanism (measured 2026-07-31 on fresh isolated scenes, one per arm):
 * `loadBundlesConfiguration` (core/config.js) calls `getAllBundles()`, whose
 * list is built inside the `for (let app in content)` template-merge loop over
 * the user's env.json — so an env.json that is empty (`{}`), ABSENT altogether
 * (`self.userConf` stays `false`), or that declares only bundles absent from
 * manifest.json yields an EMPTY bundle list. `loadBundleConfig(bundles, 0, cb)`
 * then reads `bundles[0]`, finds it undefined, falls back to `bundle =
 * self.startingApp`, and its first statement — `setServerCoreConf(bundle, env,
 * scope, conf.core)` — dereferences `self.envConf[bundle][env]`, which was
 * never populated. Result: `TypeError: Cannot read properties of undefined
 * (reading '<env>')` escaping as an uncaughtException, exit 143, with nothing
 * naming env.json.
 *
 * The fix refuses at the CALL SITE, mirroring the #B132 routing.json refusal
 * that lives ~330 lines below in the same function: `console.error(msg)` +
 * `return callback(new Error(msg))`, which reaches `process.exit(1)` through
 * the established sink at config.js `init()`. The message names the bundle,
 * the env, the resolved env.json path, and whether the file was found at all.
 * A defensive guard in the setter converts the same deref into a NAMED error
 * for any direct caller.
 *
 * Safety property this rests on, asserted in §02: the predicate can only fire
 * in configurations that ALREADY crash, so it cannot refuse a boot that works
 * today (measured: the scaffolded-env.json baseline boots and serves HTTP 200,
 * while all three degenerate shapes died identically before the fix).
 *
 * §01 — source pins: the guard, its message, the callback idiom, and its
 *       position BEFORE the setServerCoreConf call.
 * §02 — replica of the bundle-resolution + guard predicate: the three
 *       degenerate shapes refuse; a well-formed conf does NOT (the control
 *       that would catch a guard which over-fires).
 * §03 — the defensive setter guard.
 * §04 — #B183: the fourth shape, which §02 could only assert as a REPLICA.
 *
 * ── §04, and why it exists ───────────────────────────────────────────────────
 * §02's "a bundle present but MISSING the env block refuses" arm passed while
 * the live boot still died, ~750 lines earlier, with an opaque
 * `TypeError: Cannot set properties of undefined (setting 'bundlesPath')` at
 * exit 143. The replica models the guard PREDICATE faithfully; it does not
 * model the CHOREOGRAPHY that has to reach it. `loadWithTemplate` assigned
 * `newContent[app][env].bundlesPath` one line BEFORE the
 * `if ( typeof(content[app][env]) != "undefined" )` guard that exists to
 * protect exactly that dereference — and since `newContent` is a deep clone of
 * `content`, that property is undefined for precisely the apps the guard
 * rejects. Measured live 2026-07-31 (#B183): env.json declaring only
 * `demo.dev`, booted at `prod`, died at `config.js:786:46`.
 *
 * §04 therefore pins the ORDERING at the source (a structural invariant — the
 * assignment must sit inside the guarded block) AND drives a real boot, which
 * is the only arm that can observe the choreography at all.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW  = require('../fw');
var SRC = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');

// loadBundleConfig opening region: declaration → the setServerCoreConf call.
// End-anchored on the call itself, so a guard that drifted BELOW the call would
// fall outside the slice and trip §01 (ordering enforced by construction).
var L_START = SRC.indexOf('var loadBundleConfig = function(bundles, b, callback, reload, collectedRules)');
var L_END   = SRC.indexOf('self.setServerCoreConf(bundle, env, scope, conf.core);');
var L       = SRC.substring(L_START, L_END);

// the setter body, anchored on its declaration form (never the bare name)
var S_START = SRC.indexOf('this.setServerCoreConf = function(bundle, env, scope, conf)');
var S_END   = SRC.indexOf('this.getServerCoreConf = function(bundle, env)');
var S       = SRC.substring(S_START, S_END);

// ─── 01 — source pins ─────────────────────────────────────────────────────────
describe('#B181(b) §01 — the env.json fail-fast is wired at the setServerCoreConf call site', function () {

    it('slice anchors resolve (instrument control)', function () {
        assert.ok(L_START > -1, 'the loadBundleConfig declaration must exist');
        assert.ok(L_END > L_START, 'the setServerCoreConf call must follow the declaration');
        assert.ok(S_START > -1, 'the setServerCoreConf declaration must exist');
        assert.ok(S_END > S_START, 'getServerCoreConf must follow setServerCoreConf');
    });

    it('the guard predicate covers BOTH the missing-bundle and missing-env levels', function () {
        assert.match(L, /if \(\s*!conf\[bundle\]\s*\|\|\s*!conf\[bundle\]\[env\]\s*\)/,
            'a one-level guard would still deref undefined[env] for a present-but-env-less bundle');
    });

    it('the refusal message names env.json and refuses to start', function () {
        assert.ok(L.indexOf('env.json') > -1, 'the message must name the file the operator has to fix');
        assert.ok(L.indexOf('refusing to start') > -1, 'house refusal wording (#B132)');
    });

    it('the message distinguishes a MISSING file from one lacking the block', function () {
        assert.ok(L.indexOf('self.userConf') > -1,
            'userConf is false when env.json is absent — the two causes need different remedies');
    });

    it('the refusal returns through the malformed-JSON / #B132 idiom', function () {
        var refusal = L.substring(L.indexOf('if ( !conf[bundle]'));
        assert.ok(refusal.indexOf('console.error(') > -1, 'the reason is logged before the callback');
        assert.match(refusal, /return callback\(new Error\(/,
            'config.js refuses through its callback, which config.js init() turns into process.exit(1)');
    });

    it('the guard sits BEFORE the deref it protects (ordering)', function () {
        // L is end-anchored on the setServerCoreConf call, so presence inside L
        // IS the ordering proof; assert it explicitly rather than implicitly.
        var guard = L.indexOf('if ( !conf[bundle]');
        assert.ok(guard > -1, 'the guard must live inside the pre-call region');
        assert.ok(guard < L.length, 'and therefore before the setServerCoreConf call');
    });

    it('operator pins the §02 replica mirrors (bundle fallback + env resolution)', function () {
        assert.ok(SRC.indexOf('bundle = self.startingApp') > -1,
            'the empty-list fallback that makes an unconfigured bundle reachable at all');
        assert.ok(SRC.indexOf("env           = process.env.NODE_ENV || self.env || self.Env.get()") > -1,
            'the env the guard reports');
    });
});

// ─── 02 — replica of the bundle resolution + guard predicate ──────────────────
// Mirrors config.js loadBundleConfig's opening: the bundles[b] fallback to
// startingApp, then the guard. Locked to the source by §01's operator pins.
function replicaGuard(opt) {
    var bundles     = opt.bundles || [];
    var b           = opt.b || 0;
    var conf        = opt.envConf;
    var env         = opt.env;
    var bundle      = ( typeof (bundles[b]) == 'undefined' ) ? opt.startingApp : bundles[b];
    var refusedWith = null;
    var callback    = function (err) { refusedWith = err; return 'REFUSED'; };

    if ( !conf[bundle] || !conf[bundle][env] ) {
        var msg = '[ ' + bundle + ' ][ ' + env + ' ] no configuration block for this bundle/env in '
            + opt.executionPath + '/env.json ('
            + ( opt.userConf ? 'the file declares no `' + bundle + '.' + env + '` block' : 'file NOT FOUND' )
            + ') — refusing to start';
        callback(new Error(msg));
        return { refused: true, bundle: bundle, message: msg, err: refusedWith };
    }
    return { refused: false, bundle: bundle, message: null, err: null };
}

var WELL_FORMED = { web: { dev: { server: {}, host: 'localhost' } } };

describe('#B181(b) §02 — replica: the degenerate shapes refuse, a working conf does not', function () {

    it('replica: an EMPTY env.json refuses the boot — the opaque-deref class', function () {
        var r = replicaGuard({ envConf: {}, startingApp: 'web', env: 'dev', userConf: {}, executionPath: '/srv/app' });
        assert.equal(r.refused, true);
        assert.equal(r.bundle, 'web', 'the empty bundle list falls back to startingApp');
        assert.match(r.message, /no configuration block/);
        assert.match(r.message, /declares no `web\.dev` block/, 'a present-but-empty file is not "NOT FOUND"');
        assert.ok(r.err instanceof Error, 'the refusal travels as an Error through the callback');
    });

    it('replica: an ABSENT env.json refuses, and says NOT FOUND rather than blaming the content', function () {
        var r = replicaGuard({ envConf: {}, startingApp: 'web', env: 'dev', userConf: false, executionPath: '/srv/app' });
        assert.equal(r.refused, true);
        assert.match(r.message, /file NOT FOUND/,
            'userConf === false is the absent-file signal; the remedy differs from a present-but-incomplete file');
    });

    it('replica: a file declaring only UNREGISTERED bundles refuses', function () {
        var r = replicaGuard({ envConf: { nosuchbundle: { dev: {} } }, startingApp: 'web', env: 'dev',
                               userConf: { nosuchbundle: {} }, executionPath: '/srv/app' });
        assert.equal(r.refused, true);
        assert.match(r.message, /\[ web \]\[ dev \]/, 'it names the bundle that was being STARTED, not the one declared');
    });

    it('replica: a bundle present but MISSING the env block refuses (the second guard level)', function () {
        var r = replicaGuard({ envConf: { web: { prod: {} } }, startingApp: 'web', env: 'dev',
                               userConf: { web: {} }, executionPath: '/srv/app' });
        assert.equal(r.refused, true,
            'a one-level `!conf[bundle]` guard would pass here and then deref undefined[env]');
    });

    it('CONTROL: a well-formed conf does NOT refuse — the guard cannot break a working boot', function () {
        var r = replicaGuard({ envConf: WELL_FORMED, startingApp: 'web', env: 'dev',
                               userConf: WELL_FORMED, executionPath: '/srv/app' });
        assert.equal(r.refused, false, 'this arm must be able to fail — it is what proves the guard is not over-firing');
        assert.equal(r.err, null);
    });

    it('CONTROL: the guard keys on the STARTED bundle, so a sibling bundle being configured is not enough', function () {
        var r = replicaGuard({ envConf: { other: { dev: {} } }, startingApp: 'web', env: 'dev',
                               userConf: { other: {} }, executionPath: '/srv/app' });
        assert.equal(r.refused, true);
    });
});

// ─── 03 — the defensive setter guard ─────────────────────────────────────────
describe('#B181(b) §03 — setServerCoreConf refuses a missing block with a NAMED error', function () {

    it('the setter guards both levels before the coreConfiguration write', function () {
        assert.match(S, /if \(\s*!self\.envConf\[bundle\]\s*\|\|\s*!self\.envConf\[bundle\]\[env\]\s*\)/);
    });

    it('the setter throws a named error rather than dereferencing undefined', function () {
        var guardAt = S.indexOf('if ( !self.envConf[bundle]');
        var writeAt = S.indexOf("self.envConf[bundle][env].server['coreConfiguration'] = conf;");
        assert.ok(guardAt > -1 && writeAt > -1, 'both the guard and the write must exist');
        assert.ok(guardAt < writeAt, 'the guard must precede the write it protects');
        assert.match(S.substring(guardAt, writeAt), /throw new Error\(/);
        assert.ok(S.substring(guardAt, writeAt).indexOf('setServerCoreConf') > -1,
            'the thrown message names the failing call so a direct caller is not left with an opaque deref');
    });
});

// ─── 04 — #B183: the bundlesPath deref must sit INSIDE the guard ─────────────
// Comment-stripped, so neither the `//` block explaining the fix nor the
// commented-out legacy assignments a few lines above can satisfy a pin.
var ACTIVE = SRC.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');

var W_START = ACTIVE.indexOf('var loadWithTemplate = function(userConf, template, callback)');
var W_END   = ACTIVE.indexOf('}//EO for.', W_START);
var W       = ACTIVE.substring(W_START, W_END);

var B183_GUARD  = 'if ( typeof(content[app][env]) != "undefined" ) {';
var B183_ASSIGN = 'newContent[app][env].bundlesPath = bundlesPath;';

describe('#B183 §04a — source: the deref is ordered inside the guard that protects it', function () {

    it('extraction control: the region resolves and each anchor appears exactly once', function () {
        assert.ok(W_START > -1, 'the loadWithTemplate declaration must exist');
        assert.ok(W_END > W_START, 'the per-app for-loop terminator must follow it');
        assert.equal(W.split(B183_GUARD).length - 1, 1,
            'the env-block guard must appear exactly once in the loop — a second copy would make the ordering pin ambiguous');
        assert.equal(W.split(B183_ASSIGN).length - 1, 1,
            'the bundlesPath assignment must appear exactly once (the `= bundlesPath = appSrcPath` rewrite is a different statement)');
    });

    it('the guard OPENS before the assignment it protects (the #B183 fix)', function () {
        var guardAt  = W.indexOf(B183_GUARD);
        var assignAt = W.indexOf(B183_ASSIGN);
        assert.ok(guardAt > -1 && assignAt > -1, 'both anchors must resolve');
        assert.ok(guardAt < assignAt,
            'newContent is a deep clone of content, so newContent[app][env] is undefined for exactly the apps '
            + 'this guard rejects; assigning bundlesPath before the guard threw an opaque '
            + '"Cannot set properties of undefined" and killed the boot at exit 143 (#B183)');
    });

    // NB: anchored on the warn's OWN literal, not on a bare `} else {` +
    // `console.warn(` pair. Validated red-first: the bare-token form PASSED
    // against the pre-fix bytes, because this ~500-line loop body already
    // contains other else branches and other console.warn calls (the #B181(a)
    // host warn among them) — it discriminated nothing.
    var B183_WARN = "no `'+ env +'` block in the project env.json";

    it('a bundle skipped for the booting env is reported rather than silently dropped', function () {
        var guardAt = W.indexOf(B183_GUARD);
        var warnAt  = W.indexOf(B183_WARN);
        assert.ok(warnAt > -1, 'the skip warn must exist — a dropped bundle is otherwise invisible');
        assert.ok(warnAt > guardAt, 'the warn belongs to the guard\'s else branch, so it must follow the guard');
        assert.ok(W.substring(guardAt, warnAt).indexOf('} else {') > -1,
            'the warn must sit in an else branch attached to the env-block guard, not on the guarded path');
        var stmt = W.substring(W.lastIndexOf('console.warn(', warnAt), warnAt);
        assert.match(stmt, /\[CONFIG\]\['\+\s*app\s*\+'\]\['\+\s*env\s*\+'\]/,
            'the warn must name the bundle AND the env, or an operator cannot tell which block is missing');
    });
});

// ─── 04b — the live arm: the choreography a replica cannot reach ─────────────
// Daemonless, self-bootstrapping isolated home (HOME override, GINA_HOMEDIR
// deleted, nothing seeded from the real ~/.gina), dev env so the bundle boots
// from src and no release build is needed. One fresh scene per arm.
var os    = require('os');
var net   = require('net');
var { spawn, spawnSync } = require('child_process');

var GINA_ROOT = path.resolve(FW, '..', '..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');
var BUNDLE    = 'demo';

/**
 * Builds a throwaway scene: isolated home + registered project/bundle/view.
 * @param   {number} portFrom - port allocation baseline for this scene
 * @returns {object} scene handle
 */
function makeScene(portFrom) {
    var stamp = Date.now() + '' + portFrom;
    var home  = path.join(fs.realpathSync(os.tmpdir()), 'gina-b183-' + stamp);
    var scene = {
        PROJ      : 'b183' + stamp,
        HOME      : home,
        CWD       : home + '-cwd',
        GINA_HOME : path.join(home, '.gina'),
        PROJ_DIR  : path.join(home, 'proj'),
        portFrom  : portFrom
    };
    // Neutral cwd: not the repo (the CLI auto-link drops a stray `gina`
    // symlink at a repo cwd) and not the fake home itself.
    scene.ENV = Object.assign({}, process.env, { HOME: scene.HOME, GINA_LOG_STDOUT: 'true' });
    delete scene.ENV.GINA_HOMEDIR;
    delete scene.ENV.NODE_OPTIONS;
    return scene;
}

function cli(scene, args) {
    return spawnSync(process.execPath, [CLI].concat(args), {
        env: scene.ENV, cwd: scene.CWD, encoding: 'utf8', timeout: 120000
    });
}

/** Scaffolds the scene, verified through on-disk state (CLI exit codes are not trusted). */
function scaffold(scene) {
    fs.mkdirSync(scene.PROJ_DIR, { recursive: true });
    fs.mkdirSync(scene.CWD, { recursive: true });
    cli(scene, ['project:add', '@' + scene.PROJ, '--path=' + scene.PROJ_DIR]);

    var projects = path.join(scene.GINA_HOME, 'projects.json');
    assert.ok(fs.existsSync(projects), 'project:add did not bootstrap the isolated home');
    var registered = JSON.parse(fs.readFileSync(projects, 'utf8'))[scene.PROJ];
    assert.ok(registered, 'project:add did not register @' + scene.PROJ);
    assert.ok(String(registered.path).indexOf(scene.HOME) === 0,
        'sandbox breach: the project resolved OUTSIDE the throwaway home (' + registered.path + ')');

    // The CLI auto-link is unreliable under an isolated home; without it the
    // bundle's require('gina') dies MODULE_NOT_FOUND before it logs a byte.
    fs.mkdirSync(path.join(scene.PROJ_DIR, 'node_modules'), { recursive: true });
    if (!fs.existsSync(path.join(scene.PROJ_DIR, 'node_modules', 'gina'))) {
        fs.symlinkSync(GINA_ROOT, path.join(scene.PROJ_DIR, 'node_modules', 'gina'));
    }

    cli(scene, ['bundle:add', BUNDLE, '@' + scene.PROJ, '--start-port-from=' + scene.portFrom]);
    var rev = JSON.parse(fs.readFileSync(path.join(scene.GINA_HOME, 'ports.reverse.json'), 'utf8'));
    assert.ok(rev[BUNDLE + '@' + scene.PROJ], 'bundle:add did not register ' + BUNDLE + '@' + scene.PROJ);

    cli(scene, ['view:add', BUNDLE, '@' + scene.PROJ]);
    scene.port = rev[BUNDLE + '@' + scene.PROJ].dev['http/1.1'].http;
    scene.envJson = path.join(scene.PROJ_DIR, 'env.json');
    assert.ok(fs.existsSync(scene.envJson), 'the scaffold must produce a project env.json');
}

/**
 * Boots the bundle and settles on whichever comes first: the port opening
 * (alive) or the process exiting (refused/crashed). On the alive path it
 * DRAINS and waits for the exit before resolving, so no child outlives the test.
 *
 * ⚠️ `spawn` returns the gina-container LAUNCHER; the bundle runs as a separate
 * `gina: <bundle>@<project>` process. The launcher forwards SIGTERM to it —
 * SIGKILL is NOT forwardable, so killing the launcher outright ORPHANS the
 * bundle, which then keeps the test runner alive to its timeout (measured).
 * Always drain with SIGTERM; SIGKILL is only a last resort.
 *
 * @returns {Promise<{alive: boolean, exitCode: (number|null), txt: string}>}
 */
function boot(scene, deadlineMs) {
    return new Promise(function (resolve) {
        var out = { alive: false, exitCode: null, txt: '', settled: false };
        var p = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + scene.PROJ], {
            env: Object.assign({}, scene.ENV, { NODE_ENV: 'dev' }),
            cwd: scene.CWD, stdio: ['ignore', 'pipe', 'pipe']
        });
        var poll = null, cap = null, grace = null;
        scene.proc = p;
        p.stdout.on('data', function (d) { out.txt += d; });
        p.stderr.on('data', function (d) { out.txt += d; });

        function done() {
            if (out.settled) { return; }
            out.settled = true;
            clearInterval(poll);
            clearTimeout(cap);
            clearTimeout(grace);
            resolve(out);
        }
        p.on('exit', function (code) { out.exitCode = code; done(); });

        function drain() {
            clearInterval(poll);
            clearTimeout(cap);
            try { p.kill('SIGTERM'); } catch (e) { return done(); }
            grace = setTimeout(function () {
                try { p.kill('SIGKILL'); } catch (e) { /* already gone */ }
                done();
            }, 10000);
        }

        poll = setInterval(function () {
            var s = new net.Socket();
            s.setTimeout(500);
            s.on('connect', function () { s.destroy(); out.alive = true; drain(); });
            s.on('error',   function () { s.destroy(); });
            s.on('timeout', function () { s.destroy(); });
            s.connect(scene.port, '127.0.0.1');
        }, 300);
        cap = setTimeout(drain, deadlineMs);
    });
}

/**
 * Removes the throwaway scene. The whole isolated home is deleted, so no
 * `project:rm` is needed (and skipping it avoids a CLI call that can stall).
 * @param {object} scene
 * @param {object} [out] - boot() result, used to reach a surviving bundle child
 */
function teardown(scene, out) {
    var launcherStuck = scene.proc && scene.proc.exitCode === null;
    if (launcherStuck) {
        try { scene.proc.kill('SIGTERM'); } catch (e) { /* already gone */ }
        // The bundle child is a separate process the launcher may not have
        // reaped; its pid is on the mount line. Only reached when the launcher
        // was still up, so this cannot target an unrelated recycled pid.
        var m = out && out.txt && out.txt.match(/\[ FRAMEWORK \]\[ (\d+) \]/);
        if (m) { try { process.kill(parseInt(m[1], 10), 'SIGTERM'); } catch (e) { /* gone */ } }
    }
    try { fs.rmSync(scene.HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    try { fs.rmSync(scene.CWD,  { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

describe('#B183 §04b — live: a bundle declared for another env refuses, it does not crash', function () {

    it('CONTROL: the pristine scaffold boots — the arm that proves the harness works', async function () {
        var scene = makeScene(10200);
        var r = null;
        try {
            scaffold(scene);
            r = await boot(scene, 40000);
            assert.equal(r.alive, true,
                'the unmutated scene must come up, or a dead #B183 arm would prove nothing about #B183.\n' + r.txt.slice(-1500));
        } finally {
            teardown(scene, r);
        }
    });

    it('a bundle declared ONLY for another env refuses with the named message, not an opaque deref', async function () {
        var scene = makeScene(10220);
        var r = null;
        try {
            scaffold(scene);
            // Single variable vs the control: drop the booting env's block,
            // leaving the bundle declared (for the other env) but not for `dev`.
            var conf = JSON.parse(fs.readFileSync(scene.envJson, 'utf8').split('\n')
                .filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'));
            assert.ok(conf[BUNDLE] && conf[BUNDLE].dev,
                'fixture precondition: the scaffold must declare a `dev` block to remove');
            delete conf[BUNDLE].dev;
            assert.ok(Object.keys(conf[BUNDLE]).length > 0,
                'the bundle must remain DECLARED — an empty bundle object is #B181(b), a different shape');
            fs.writeFileSync(scene.envJson, JSON.stringify(conf, null, 4));

            r = await boot(scene, 40000);

            assert.equal(r.alive, false, 'the boot must not come up on a bundle with no block for this env');
            assert.equal(r.exitCode, 1,
                'it must refuse cleanly (exit 1), not die as an uncaughtException (exit 143)');
            assert.ok(r.txt.indexOf("setting 'bundlesPath'") === -1,
                'the #B183 deref must be gone — this is the regression assertion');
            assert.ok(r.txt.indexOf('no configuration block for this bundle/env') > -1,
                'the #B181(b) refusal must now be REACHABLE for this shape');
            assert.ok(r.txt.indexOf('skipping this bundle for this environment') > -1,
                'the skip must be reported for the env that has no block');
        } finally {
            teardown(scene, r);
        }
    });
});
