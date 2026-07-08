/**
 * lib/cmd/bundle/restart.js — zero-bundle early exit + registry derefs behind the guard
 *
 * Why source inspection + pure-logic replicas:
 *   restart.js relies on the running CLI context (CmdHelper, registered
 *   projects, opt.client socket). The end-to-end behaviour was verified live
 *   against an isolated home: zero-bundle bulk restart → clean message +
 *   exit 1 (was an uncaught TypeError + double-printed stack), and a named
 *   unregistered bundle → the clean "is not registered" message (was the
 *   same TypeError, thrown BEFORE the guard could answer).
 *
 * The defect family these tests lock out:
 *   restart() resolved env/scope/protocol/scheme/port from
 *   `self.bundlesByProject[<project>][bundle]` BEFORE checking that `bundle`
 *   exists — so any undefined/unregistered bundle name crashed on
 *   `.def_env` instead of reaching the isDefined guard.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var RESTART_SOURCE = path.join(require('../fw'), 'lib/cmd/bundle/restart.js');
var src = fs.readFileSync(RESTART_SOURCE, 'utf8');

function sliceBetween(startToken, endToken) {
    var startIdx = src.indexOf(startToken);
    assert.ok(startIdx !== -1, '`' + startToken + '` not found — test needs updating');
    var endIdx = src.indexOf(endToken, startIdx);
    assert.ok(endIdx !== -1, '`' + endToken + '` not found — cannot end-anchor the slice');
    return src.slice(startIdx, endIdx);
}


// ---------------------------------------------------------------------------
// 01 — Source: zero-bundle bulk restart exits early with the bundle:add hint
// ---------------------------------------------------------------------------
describe('01 - bundle/restart.js: zero-bundle bulk restart takes the early exit', function() {

    var block = sliceBetween('var init = function', 'var restart = function');

    it('guards the bulk branch on an empty self.bundles', function() {
        assert.ok(
            /if \( !self\.bundles \|\| !self\.bundles\.length \)/.test(block),
            'init() must refuse bulk mode when the project has no bundles'
        );
    });

    it('the guard sits inside the bulk (!self.name) branch, ahead of restart(opt, cmd, 0)', function() {
        var bulkIdx  = block.indexOf('if (!self.name)');
        var guardIdx = block.indexOf('!self.bundles.length');
        var loopIdx  = block.indexOf('restart(opt, cmd, 0)');
        assert.ok(bulkIdx !== -1 && guardIdx !== -1 && loopIdx !== -1, 'expected tokens missing from init()');
        assert.ok(bulkIdx < guardIdx, 'the empty-bundles guard must be inside the bulk branch');
        assert.ok(guardIdx < loopIdx, 'the guard must run BEFORE the bulk loop is entered');
    });

    it('tells the client the project has no bundles, with the bundle:add hint', function() {
        assert.ok(
            block.indexOf('No bundles found in project') !== -1
                && block.indexOf('bundle:add') !== -1,
            'the refusal must explain the state and how to fix it'
        );
        assert.ok(
            /opt\.client\.write\(noBundleMsg\)/.test(block),
            'the message must reach the client (restart\'s end() does not forward opt.msg)'
        );
    });

    it('ends via the error path — end(opt, cmd, false, undefined, true) (exit 1)', function() {
        assert.ok(
            /return end\(opt, cmd, false, undefined, true\);/.test(block),
            'a restart that cannot restart anything is an error terminal'
        );
    });

});


// ---------------------------------------------------------------------------
// 02 — Source: registry derefs sit BEHIND the isDefined guard
// ---------------------------------------------------------------------------
describe('02 - bundle/restart.js: bundlesByProject derefs live behind the isDefined guard', function() {

    var block = sliceBetween('var restart = function', 'var end = function');

    it('the isDefined guard comes first', function() {
        var guardIdx = block.indexOf("if (!isDefined('bundle', bundle))");
        assert.ok(guardIdx !== -1, 'the isDefined guard must exist in restart()');
        var derefIdx = block.indexOf('.def_env');
        assert.ok(derefIdx !== -1, 'the def_env resolution must still exist');
        assert.ok(derefIdx > guardIdx, 'registry derefs must come AFTER the guard, not before');
    });

    it('no registry deref before the guard', function() {
        var guardIdx = block.indexOf("if (!isDefined('bundle', bundle))");
        var preGuard = block.slice(0, guardIdx);
        assert.ok(preGuard.indexOf('bundlesByProject') === -1, 'no bundlesByProject read may precede the guard');
        assert.ok(preGuard.indexOf('portsReverseData') === -1, 'no portsReverseData read may precede the guard');
    });

    it('the derefs moved into the else branch (registered-bundle path)', function() {
        var elseIdx  = block.indexOf('} else {');
        var derefIdx = block.indexOf('.def_env');
        assert.ok(elseIdx !== -1 && derefIdx > elseIdx, 'the resolution block must sit inside the else branch');
    });

    it('all five resolutions survived the move', function() {
        ['def_env', 'def_scope', 'def_protocol', 'def_scheme', 'portsReverseData'].forEach(function(token) {
            assert.ok(block.indexOf(token) !== -1, 'resolution `' + token + '` went missing in the move');
        });
    });

});


// ---------------------------------------------------------------------------
// 03 — Replica: guard-first resolution + the pre-fix failure mechanism
// ---------------------------------------------------------------------------
describe('03 - bundle/restart.js: guard-first resolution replica', function() {

    var registry = {
        myproject: {
            frontend: { def_env: 'dev', def_protocol: 'http/2.0', def_scheme: 'http' }
        }
    };
    function isRegistered(project, bundle) {
        return !!(registry[project] && registry[project][bundle]);
    }

    // Mirrors the FIXED order: guard first, resolve second.
    function resolveFixed(project, bundle) {
        if (!isRegistered(project, bundle)) {
            return 'not-registered';
        }
        return registry[project][bundle].def_env;
    }

    // Mirrors the PRE-FIX order: resolve first, guard second.
    function resolveOld(project, bundle) {
        var env = registry[project][bundle].def_env; // throws for an unknown bundle
        if (!isRegistered(project, bundle)) {
            return 'not-registered';
        }
        return env;
    }

    it('fixed order answers cleanly for an unregistered bundle', function() {
        assert.equal(resolveFixed('myproject', 'nosuchbundle'), 'not-registered');
    });

    it('fixed order answers cleanly for a zero-bundle bulk entry (bundle === undefined)', function() {
        assert.equal(resolveFixed('myproject', undefined), 'not-registered');
    });

    it('both orders resolve identically for a registered bundle', function() {
        assert.equal(resolveFixed('myproject', 'frontend'), 'dev');
        assert.equal(resolveOld('myproject', 'frontend'), 'dev');
    });

    it('SUBTRACT — the pre-fix order throws the measured TypeError for an unknown bundle', function() {
        assert.throws(function() { resolveOld('myproject', 'nosuchbundle'); }, TypeError);
        assert.throws(function() { resolveOld('myproject', undefined); }, TypeError);
    });

});
