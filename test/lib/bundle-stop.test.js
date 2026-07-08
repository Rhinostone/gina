/**
 * lib/cmd/bundle/stop.js — zero-bundle bulk-stop early exit
 *
 * Why source inspection + pure-logic replicas:
 *   stop.js relies on the running CLI/daemon context (CmdHelper, registered
 *   projects, opt.client socket). A full replica would need heavy mocking for
 *   near-zero additional coverage; the end-to-end behaviour was verified live
 *   against an isolated home (zero-bundle project → clean message + exit 0,
 *   no TypeError, no phantom `undefined@<project>` bundle).
 *
 * The defect these tests lock out:
 *   Bulk mode (`gina bundle:stop @<project>` / delegated `gina project:stop`)
 *   entered the per-bundle loop with `self.bundles[0]` === undefined on a
 *   zero-bundle project. isRealApp() then read `pkg[undefined].version` — a
 *   caught TypeError printed a warning stack, and the client saw
 *   `Trying to stop bundle [ undefined@<project> ]` + `[ Offline ] 1/0`.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var STOP_SOURCE = path.join(require('../fw'), 'lib/cmd/bundle/stop.js');
var src = fs.readFileSync(STOP_SOURCE, 'utf8');

// Slice out init() — the early-exit lives there, ahead of the bulk loop.
function initBlock() {
    var startIdx = src.indexOf('var init = function');
    assert.ok(startIdx !== -1, 'init() declaration not found — test needs updating');
    var endIdx = src.indexOf('var stop = function', startIdx);
    assert.ok(endIdx !== -1, 'stop() declaration not found — cannot end-anchor the init slice');
    return src.slice(startIdx, endIdx);
}


// ---------------------------------------------------------------------------
// 01 — Source: zero-bundle bulk stop exits early, before the per-bundle loop
// ---------------------------------------------------------------------------
describe('01 - bundle/stop.js: zero-bundle bulk stop takes the early exit', function() {

    var block = initBlock();

    it('guards the bulk branch on an empty self.bundles', function() {
        assert.ok(
            /if \( !self\.bundles \|\| !self\.bundles\.length \)/.test(block),
            'init() must refuse bulk mode when the project has no bundles'
        );
    });

    it('the guard sits inside the bulk (!self.name) branch, ahead of stop(opt, cmd, 0)', function() {
        var bulkIdx  = block.indexOf('if (!self.name)');
        var guardIdx = block.indexOf('!self.bundles.length');
        var loopIdx  = block.indexOf('stop(opt, cmd, 0)');
        assert.ok(bulkIdx !== -1 && guardIdx !== -1 && loopIdx !== -1, 'expected tokens missing from init()');
        assert.ok(bulkIdx < guardIdx, 'the empty-bundles guard must be inside the bulk branch');
        assert.ok(guardIdx < loopIdx, 'the guard must run BEFORE the bulk loop is entered');
    });

    it('reports the zero-bundle state instead of a phantom bundle', function() {
        assert.ok(
            block.indexOf('No bundles found in project') !== -1
                && block.indexOf('Nothing to stop') !== -1,
            'the client must be told the project has no bundles'
        );
    });

    it('ends via the success path — end(opt, cmd) with no error flag (exit 0)', function() {
        assert.ok(
            /return end\(opt, cmd\);/.test(block),
            'nothing-to-stop is a vacuous success: end() must be called WITHOUT the error arg'
        );
    });

});


// ---------------------------------------------------------------------------
// 02 — Replica: the early-exit decision + the pre-fix failure mechanism
// ---------------------------------------------------------------------------
describe('02 - bundle/stop.js: bulk-entry decision replica', function() {

    // Mirrors init()'s dispatch: bulk when no name; bulk requires >= 1 bundle.
    function bulkEntryDecision(name, bundles) {
        if (!name) {
            if (!bundles || !bundles.length) {
                return 'refuse-empty';
            }
            return 'bulk';
        }
        return 'named';
    }

    it('no name + zero bundles → early exit', function() {
        assert.equal(bulkEntryDecision(null, []), 'refuse-empty');
    });

    it('no name + missing bundles array → early exit (defensive)', function() {
        assert.equal(bulkEntryDecision(null, undefined), 'refuse-empty');
    });

    it('no name + one bundle → bulk loop proceeds', function() {
        assert.equal(bulkEntryDecision(null, ['frontend']), 'bulk');
    });

    it('named bundle → named path regardless of the bundles list', function() {
        assert.equal(bulkEntryDecision('frontend', []), 'named');
    });

    it('SUBTRACT — the unguarded bulk entry derefs `.version` off undefined (the measured TypeError)', function() {
        // Pre-fix mechanism: bundle = self.bundles[0] === undefined, then
        // isRealApp() reads manifest bundles[bundle].version.
        assert.throws(function() {
            var bundles = [];
            var bundle = bundles[0];               // undefined
            var pkg = { frontend: { version: '1.0.0' } };
            return pkg[bundle].version;            // TypeError
        }, TypeError);
    });

});
