var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

// helpers/context.js internal config resolvers `getConfig` and `getLib` read the
// bundle's per-env configuration from the active Config. `core/config.js` builds
// `envConf` (via Env.load) BEFORE `bundlesConfiguration` (via loadBundlesConfiguration),
// and `bundlesConfiguration.conf` is an ALIAS of `envConf` (config.js:247 sets it via
// getInstance()). At module-load time in a daemon-spawned / built-release bootstrap,
// a Config whose async build has populated `envConf` but not yet `bundlesConfiguration`
// is a real, reachable state (the consuming bundle's own code even comments the
// "Config.instance.bundlesConfiguration race when getConfig() fires at module-load time").
// Before the fix both resolvers dereferenced `conf.bundlesConfiguration.conf...`
// UNCONDITIONALLY -> `TypeError: Cannot read properties of undefined (reading 'conf')`
// -> the detached-path throwError re-threw -> uncaughtException -> proc.js SIGKILL ->
// crash loop. The fix routes BOTH resolvers through ONE shared `resolveBundlesConf(conf)`
// helper (`bundlesConfiguration.conf` when present, else the equivalent `envConf`), so
// they cannot drift, and fails clean (isFatal emerg-log + return) when neither is usable.
var SOURCE = path.join(require('../fw'), 'helpers/context.js');

function slice(startMarker, endMarker) {
    var src   = fs.readFileSync(SOURCE, 'utf8');
    var start = src.indexOf(startMarker);
    assert.ok(start > -1, 'marker present: ' + startMarker);
    var end   = src.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, 'end marker follows: ' + endMarker);
    return src.slice(start, end);
}
function resolverBlock() { return slice('var resolveBundlesConf = function(conf) {', 'getConfig = function(bundle, confName) {'); }
function getConfigBlock() { return slice('getConfig = function(bundle, confName) {', 'getLib = function(bundle, lib) {'); }
function getLibBlock()    { return slice('getLib = function(bundle, lib) {', 'Whisper'); }

// ---------------------------------------------------------------------------
// Faithful replicas — kept in lockstep with the shipped resolvers by the §01
// source pins.
// ---------------------------------------------------------------------------
function resolveBundlesConf(conf) {                    // POST-fix (shipped shared helper)
    if ( conf && conf.bundlesConfiguration && conf.bundlesConfiguration.conf ) {
        return conf.bundlesConfiguration.conf;
    }
    if ( conf && conf.envConf ) {
        return conf.envConf;
    }
    return null;
}
function resolveLibPath(conf, bundle, env) {           // mirrors getLib
    var confConf = resolveBundlesConf(conf);
    var bundleEnvConf = ( confConf && confConf[bundle] && confConf[bundle][env] ) ? confConf[bundle][env] : null;
    if ( bundleEnvConf && typeof(bundleEnvConf.libPath) != 'undefined' ) {
        return { libPath: bundleEnvConf.libPath, failClean: false };
    }
    return { libPath: undefined, failClean: true };
}
function getConfigWith(conf, bundle, env, confName) {  // mirrors getConfig with-confName
    try { return { value: resolveBundlesConf(conf)[bundle][env].content[confName], failClean: false }; }
    catch (e) { return { value: undefined, failClean: true }; }               // isFatal fail-clean
}
function getConfigWithout(conf, bundle, env) {         // mirrors getConfig without-confName
    try {
        var c = resolveBundlesConf(conf);
        c.bundle = bundle; c.env = env;                                        // mutate the container (as shipped)
        return { value: c, failClean: false };
    } catch (e) { return { value: undefined, failClean: true }; }
}

function preFixLibDeref(conf, b, e)    { return conf.bundlesConfiguration.conf[b][e].libPath; }         // PRE-fix
function preFixConfigDeref(conf, b, e) { conf.bundlesConfiguration.conf.bundle = b; return conf.bundlesConfiguration.conf; } // PRE-fix

// config shapes
function fullConfig(libPath) {          // healthy: bundlesConfiguration.conf IS envConf
    var envConf = { b: { prod: { libPath: libPath, content: { app: { k: 1 } } } } };
    return { envConf: envConf, bundlesConfiguration: { conf: envConf } };
}
function partialConfig(libPath) {       // bootstrap/partial: envConf set, bundlesConfiguration NOT (the measured crash state)
    return { envConf: { b: { prod: { libPath: libPath, content: { app: { k: 1 } } } } } };
}
function brokenConfig() { return {}; }  // neither source usable


describe('helpers/context.js config resolution — §01 source pins', function () {

    it('resolveBundlesConf: bundlesConfiguration.conf when present, else envConf, else null', function () {
        var b = resolverBlock();
        assert.match(b, /if \(\s*conf && conf\.bundlesConfiguration && conf\.bundlesConfiguration\.conf\s*\)/, 'guards each hop to .conf');
        assert.match(b, /return conf\.bundlesConfiguration\.conf;/, 'returns bundlesConfiguration.conf');
        assert.match(b, /if \(\s*conf && conf\.envConf\s*\)/, 'falls back to envConf');
        assert.match(b, /return conf\.envConf;/, 'returns envConf on fallback');
        assert.match(b, /return null;/, 'returns null when neither is available');
    });

    it('getLib resolves libPath via the shared resolveBundlesConf helper (no unguarded deref)', function () {
        var b = getLibBlock();
        assert.match(b, /var confConf = resolveBundlesConf\(conf\);/, 'getLib calls resolveBundlesConf');
        assert.match(b, /libPath = bundleEnvConf\.libPath/, 'libPath comes from the resolved container');
        assert.doesNotMatch(b, /conf\.bundlesConfiguration\.conf\[bundle\]\[env\]\.libPath\s*;/, 'the unguarded pre-fix libPath deref is gone');
    });

    it('getConfig routes BOTH branches through resolveBundlesConf (no unguarded bundlesConfiguration deref)', function () {
        var b = getConfigBlock();
        assert.equal((b.match(/resolveBundlesConf\(conf\)/g) || []).length, 2, 'both getConfig branches call resolveBundlesConf');
        assert.doesNotMatch(b, /conf\.bundlesConfiguration\.conf\[bundle\]\[env\]\.content/, 'the with-confName unguarded deref is gone');
        assert.doesNotMatch(b, /conf\.bundlesConfiguration\.conf\.bundle\s*=/, 'the without-confName unguarded mutation is gone');
    });

    it('getConfig fails clean (isFatal) in BOTH catches; no bare non-isFatal throwError remains', function () {
        var b = getConfigBlock();
        assert.equal((b.match(/throwError\(500, err, true\)/g) || []).length, 2, 'both catches are throwError(500, err, true)');
        assert.doesNotMatch(b, /throwError\(500, err\)/, 'no bare non-isFatal throwError(500, err) remains in getConfig');
    });

    it('getLib fails clean (isFatal): unresolvable-config branch and outer catch', function () {
        var b = getLibBlock();
        assert.match(b, /throwError\(500, new Error\([\s\S]{0,260}?\), true\)/, 'the unresolvable-config branch is isFatal');
        assert.match(b, /throwError\(500, err, true\)/, 'the outer catch is isFatal');
        assert.doesNotMatch(b, /throwError\(500, err\)\s*;/, 'the pre-fix bare throwError(500, err); is gone from getLib');
    });
});


describe('helpers/context.js config resolution — §02 replica', function () {

    it('resolveBundlesConf: full config -> bundlesConfiguration.conf (=== envConf)', function () {
        var full = fullConfig('/x/lib');
        assert.equal(resolveBundlesConf(full), full.bundlesConfiguration.conf);
        assert.equal(resolveBundlesConf(full), full.envConf, 'they are the same reference');
    });
    it('resolveBundlesConf: partial config -> envConf; broken -> null', function () {
        assert.equal(resolveBundlesConf(partialConfig('/x')).b.prod.libPath, '/x');
        assert.equal(resolveBundlesConf(brokenConfig()), null);
        assert.equal(resolveBundlesConf(null), null);
    });

    it('getLib libPath: full and PARTIAL both resolve (partial from envConf) — no crash', function () {
        assert.deepEqual(resolveLibPath(fullConfig('/x/lib'), 'b', 'prod'), { libPath: '/x/lib', failClean: false });
        assert.deepEqual(resolveLibPath(partialConfig('/x/lib'), 'b', 'prod'), { libPath: '/x/lib', failClean: false });
    });
    it('getLib libPath: broken config -> fail clean (no libPath)', function () {
        assert.equal(resolveLibPath(brokenConfig(), 'b', 'prod').failClean, true);
        assert.doesNotThrow(function () { resolveLibPath(null, 'b', 'prod'); });
    });

    it('getConfig (with confName): full and PARTIAL both resolve the content slice', function () {
        assert.equal(getConfigWith(fullConfig('/x'), 'b', 'prod', 'app').value.k, 1);
        assert.equal(getConfigWith(partialConfig('/x'), 'b', 'prod', 'app').value.k, 1, 'partial resolves from envConf');
    });
    it('getConfig (without confName): PARTIAL resolves + returns the container with metadata', function () {
        var r = getConfigWithout(partialConfig('/x'), 'b', 'prod');
        assert.equal(r.failClean, false);
        assert.equal(r.value.bundle, 'b');
        assert.equal(r.value.env, 'prod');
        assert.equal(r.value.b.prod.libPath, '/x', 'the [bundle][env] slice survives');
    });
    it('getConfig: broken config -> fail clean, never throws', function () {
        assert.doesNotThrow(function () { getConfigWith(brokenConfig(), 'b', 'prod', 'app'); });
        assert.equal(getConfigWithout(brokenConfig(), 'b', 'prod').failClean, true);
    });
});


describe('helpers/context.js config resolution — §03 SUBTRACT (pre-fix reproduces the crash)', function () {

    it('pre-fix getLib deref CRASHES with the exact reported TypeError on a partial Config', function () {
        assert.throws(function () { preFixLibDeref(partialConfig('/x'), 'b', 'prod'); },
            /Cannot read properties of undefined \(reading 'conf'\)/,
            "pre-fix getLib reproduces the reported `reading 'conf'` TypeError");
    });
    it('pre-fix getConfig deref CRASHES with the same TypeError on a partial Config (the relocated crash)', function () {
        assert.throws(function () { preFixConfigDeref(partialConfig('/x'), 'b', 'prod'); },
            /Cannot read properties of undefined \(reading 'conf'\)/,
            "pre-fix getConfig reproduces the SAME crash one frame deeper");
    });
    it('post-fix both resolvers handle the SAME partial Config without throwing', function () {
        assert.doesNotThrow(function () {
            assert.equal(resolveLibPath(partialConfig('/x'), 'b', 'prod').libPath, '/x');
            assert.equal(getConfigWith(partialConfig('/x'), 'b', 'prod', 'app').value.k, 1);
            assert.equal(getConfigWithout(partialConfig('/x'), 'b', 'prod').value.bundle, 'b');
        });
    });
});
