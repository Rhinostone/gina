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
