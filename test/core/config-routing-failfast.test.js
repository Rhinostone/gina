'use strict';
/**
 * #B132 — bundle config hydration is READDIR-driven (core/config.js
 * loadBundleConfig): `files` seeds `{ "routing": {} }`, the loop iterates
 * fs.readdirSync(<bundle>/config) plus the shared-config complement, and a
 * config/routing.json ABSENT at readdir time is simply never iterated — the
 * bundle's table ends up holding only the framework-synthetic routes, with no
 * log and no re-read in prod (config.refresh has no live caller). Malformed
 * JSON, by contrast, has always failed the boot. The fix tracks whether the
 * loop actually resolved a REAL routing config (`routingConfigSeen`) and
 * refuses to start otherwise, matching the malformed-JSON idiom
 * (callback(err) which leads to process.exit(1)) so a supervisor restart
 * retries until the release tree settles — the deploy-race self-heal.
 *
 * Live-verified on an isolated two-bundle boot (2026-07-20): with a sibling
 * bundle's routing.json renamed away the boot REFUSES, exit 1, the error
 * naming the offending bundle + env; with the file restored the boot starts
 * and serves (no false positive). The enriched not-found message half of
 * #B132 lives in lib/routing (test/lib/routing-fixes.test.js §09).
 *
 * §01 — source pins: flag declaration, in-loop set, post-loop refusal +
 *       ordering (loop end → refusal → the conf merge).
 * §02 — replica of the seen/skip mechanics (locked by §01's operator pins):
 *       present / absent / env-versioned-only / shared-complement / race.
 * §03 — rider: the readdir-race warn dereferenced `app` (a ReferenceError —
 *       the loop's bundle-name variable is `bundle`), so it could never
 *       actually warn: it crashed instead. Now fixed and pinned.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW  = require('../fw');
var SRC = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');

// the loadBundleConfig readdir-loop region (decl → the post-loop conf merge)
var L_START = SRC.indexOf('var loadBundleConfig = function(bundles, b, callback, reload, collectedRules)');
var L_END   = SRC.indexOf('conf[bundle][env] = merge(files, conf[bundle][env]);');
var L       = SRC.substring(L_START, L_END);

// ─── 01 — source pins ─────────────────────────────────────────────────────────
describe('#B132 §01 — the routing fail-fast is wired in loadBundleConfig', function () {

    it('slice anchors resolve (instrument control)', function () {
        assert.ok(L_START > -1, 'loadBundleConfig declaration must exist');
        assert.ok(L_END > L_START, 'the post-loop conf merge must follow it');
    });

    it('the seen flag is declared with the loop counters', function () {
        assert.ok(L.indexOf(', routingConfigSeen = false') > -1);
    });

    it('the in-loop set fires only for a routing iteration whose MAIN file existed', function () {
        assert.match(L, /if \( name == 'routing' && exists \) \{\s*\n\s*routingConfigSeen = true;/);
    });

    it('the post-loop refusal exists, with the boot-refusal message', function () {
        assert.ok(L.indexOf('if (!routingConfigSeen) {') > -1);
        assert.ok(L.indexOf('config/routing.json not found — a declared bundle without a readable routing config is a broken deployment') > -1);
    });

    it('the refusal returns through the malformed-JSON idiom (callback(new Error))', function () {
        var refusal = L.substring(L.indexOf('if (!routingConfigSeen) {'));
        assert.ok(refusal.indexOf('return callback(new Error(e))') > -1);
    });

    it('ordering: loop end → refusal → the conf merge (the refusal gates hydration)', function () {
        var loopEnd = L.indexOf('} // EO for (var c = 0, cLen = configFiles.length; c < cLen; ++c)');
        var refusal = L.indexOf('if (!routingConfigSeen) {');
        assert.ok(loopEnd > -1 && refusal > -1);
        assert.ok(refusal > loopEnd, 'the refusal must sit after the loop');
        // L_END (the conf merge) bounds the slice, so refusal < merge by construction —
        // assert the refusal is inside the slice at all:
        assert.ok(refusal < L.length);
    });

    it('operator pins the §02 replica mirrors (env-skip regex, name derivation, files seed)', function () {
        assert.ok(SRC.indexOf("new RegExp('\\.('+ allEnvs[e] +'|global)\\.json$')") > -1,
            'the env/global skip regex — an env-versioned-only routing file never iterates');
        assert.ok(SRC.indexOf("name            = fName.replace(/\\..*/g, '');") > -1,
            'the base-name derivation the flag keys on');
        assert.ok(SRC.indexOf('var files       = { "routing": {} }, filesList = {};') > -1,
            'the seed that made an absent routing.json silently yield an empty table');
    });
});

// ─── 02 — replica of the seen/skip mechanics ──────────────────────────────────
// Mirrors: the shared-complement push, the allEnvs/global skip, the settings/dot/env
// skips, the base-name derivation, and the main-file `exists` the flag keys on.
// Locked to the source by §01's operator pins.
function replicaSeen(configFiles, sharedConfigFiles, existsMap, env, allEnvs) {
    configFiles = configFiles.slice();
    for (var i = 0; i < sharedConfigFiles.length; i++) {
        if (configFiles.indexOf(sharedConfigFiles[i]) < 0) {
            configFiles.push(sharedConfigFiles[i]);
        }
    }
    var routingConfigSeen = false;
    for (var c = 0; c < configFiles.length; c++) {
        var fName = configFiles[c], skipIt = false;
        for (var e = 0; e < allEnvs.length; e++) {
            var re = new RegExp('\.(' + allEnvs[e] + '|global)\.json$');
            if (re.test(fName)) { skipIt = true; break; }
        }
        if (skipIt) { continue; }
        if (/^settings\./.test(fName)) { continue; }
        if (/^\./.test(fName) || new RegExp('\.' + env + '\.json$').test(fName) || !/\.json$/.test(fName)) { continue; }
        var name = fName.replace(/\..*/g, '');
        if (/\-/.test(name)) {
            name = name.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
        }
        var exists = !!existsMap[fName];
        if (name == 'routing' && exists) { routingConfigSeen = true; }
    }
    return routingConfigSeen;
}

describe('#B132 §02 — seen/skip replica: which trees pass the gate', function () {

    var ENVS = ['dev', 'prod'];

    it('routing.json present and readable → seen (a normal bundle boots)', function () {
        assert.equal(replicaSeen(['routing.json', 'app.json'], [], { 'routing.json': true, 'app.json': true }, 'dev', ENVS), true);
    });

    it('routing.json absent (only app.json) → NOT seen (the silent-degradation tree now refuses)', function () {
        assert.equal(replicaSeen(['app.json'], [], { 'app.json': true }, 'dev', ENVS), false);
    });

    it('ONLY routing.<env>.json on disk → NOT seen (env variants ride the BASE file iteration; alone they never load — already a degraded table today)', function () {
        assert.equal(replicaSeen(['routing.dev.json'], [], { 'routing.dev.json': true }, 'dev', ENVS), false);
    });

    it('routing.global.json alone → NOT seen (the global variant is skipped the same way)', function () {
        assert.equal(replicaSeen(['routing.global.json'], [], { 'routing.global.json': true }, 'dev', ENVS), false);
    });

    it('routing.json via the SHARED-config complement → seen', function () {
        assert.equal(replicaSeen(['app.json'], ['routing.json'], { 'app.json': true, 'routing.json': true }, 'dev', ENVS), true);
    });

    it('readdir↔existsSync race (listed but gone by exists time) → NOT seen (routes to the refusal; the supervisor retry is the self-heal)', function () {
        assert.equal(replicaSeen(['routing.json'], [], { 'routing.json': false }, 'dev', ENVS), false);
    });
});

// ─── 03 — rider: the readdir-race warn could never fire (`app` ReferenceError) ─
describe('#B132 §03 — the race-warn rider names the right variable', function () {

    it('the warn dereferences `bundle` (the loop\'s bundle-name variable)', function () {
        assert.ok(L.indexOf("console.warn('[ ' + bundle + ' ] [ ' + env + ' ]' + new Error('[ ' + filename + ' ] not found'))") > -1);
    });

    it('no bare `app` concatenation remains in the readdir-loop region', function () {
        assert.ok(L.indexOf(" + app + ") < 0,
            '`app` is not in loadBundleConfig scope — any concatenation of it is a ReferenceError');
    });
});
