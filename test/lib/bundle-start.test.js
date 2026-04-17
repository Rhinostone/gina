/**
 * lib/cmd/bundle/start.js — isRealApp error-exit path
 *
 * Why source inspection only:
 *   start.js relies on the running gina daemon context (CmdHelper, registered
 *   projects, global log terminal, opt.client net socket). A full replica
 *   would need heavy mocking for near-zero additional coverage.
 *
 *   These assertions prove the isRealApp error branch:
 *     (a) sets opt.msg to the error stack/message
 *     (b) calls end(opt, cmd, isBulkStart, bundleIndex, true) so the socket
 *         closes and the CLI exits — instead of hanging forever after
 *         terminal.error() wrote to a closed stdio.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var START_SOURCE = path.join(require('../fw'), 'lib/cmd/bundle/start.js');
var src = fs.readFileSync(START_SOURCE, 'utf8');

// Slice out just the isRealApp callback — keeps the regexes narrow so we
// don't accidentally match the sibling nodeModulesErr path.
function isRealAppErrorBlock() {
    var idx = src.indexOf('isRealApp(bundle, function(err, appPath, bundleDir)');
    assert.ok(idx !== -1, 'isRealApp callback signature not found — test needs updating');
    // Slice forward to the first `} else {` — that's the end of the error branch.
    var rest = src.slice(idx);
    var elseIdx = rest.indexOf('} else {');
    assert.ok(elseIdx !== -1, 'isRealApp `} else {` not found — cannot isolate error block');
    return rest.slice(0, elseIdx);
}


// ---------------------------------------------------------------------------
// 01 — Source: isRealApp error branch closes the socket
// ---------------------------------------------------------------------------
describe('01 - bundle/start.js: isRealApp error branch must close the CLI socket', function() {

    var errBlock = isRealAppErrorBlock();

    it('calls terminal.error with err.stack or err.message', function() {
        assert.ok(
            /terminal\.error\(\s*err\.stack\s*\|\|\s*err\.message\s*\)/.test(errBlock),
            'error branch must surface the error to the terminal'
        );
    });

    it('assigns opt.msg = err.stack || err.message so end() writes it to the client', function() {
        assert.ok(
            /opt\.msg\s*=\s*err\.stack\s*\|\|\s*err\.message\s*;/.test(errBlock),
            'opt.msg must be set so end() can forward the error text to the CLI'
        );
    });

    it('calls end(opt, cmd, isBulkStart, bundleIndex, true) to end the connection', function() {
        assert.ok(
            /return\s+end\(\s*opt\s*,\s*cmd\s*,\s*isBulkStart\s*,\s*bundleIndex\s*,\s*true\s*\)\s*;/.test(errBlock),
            'error branch must call end(...) with the bulk-start context and error=true — ' +
            'otherwise the CLI socket is never closed and `gina bundle:start` hangs forever'
        );
    });

    it('error branch sits before the `} else {` — no fall-through into the start path', function() {
        // If `return end(...)` is present and the branch ends with `} else {`,
        // a bare terminal.error() without a return would fall through. The
        // `return` in the assertion above guarantees no fall-through.
        assert.ok(
            /return\s+end\(/.test(errBlock),
            'error branch must use `return end(...)` — a bare end() call would still fall through'
        );
    });

});


// ---------------------------------------------------------------------------
// 02 — Regression alignment with the sibling nodeModulesErr path
// ---------------------------------------------------------------------------
//
// proceedToStart() already had the same pattern for the nodeModulesErr case.
// This test pins that pattern so if the sibling path changes, the isRealApp
// error branch is reviewed alongside it.
// ---------------------------------------------------------------------------
describe('02 - nodeModulesErr path uses the same end() shape', function() {

    it('nodeModulesErr branch also sets opt.msg and returns end(opt, cmd, isBulkStart, bundleIndex, true)', function() {
        var procIdx = src.indexOf('var proceedToStart = function(nodeModulesErr)');
        assert.ok(procIdx !== -1, 'proceedToStart declaration not found');
        // Look at the first ~20 lines of proceedToStart.
        var block = src.slice(procIdx, procIdx + 600);
        assert.ok(
            /opt\.msg\s*=\s*nodeModulesErr\.stack\s*;/.test(block),
            'proceedToStart nodeModulesErr branch assigns opt.msg'
        );
        assert.ok(
            /return\s+end\(\s*opt\s*,\s*cmd\s*,\s*isBulkStart\s*,\s*bundleIndex\s*,\s*true\s*\)/.test(block),
            'proceedToStart nodeModulesErr branch returns end(...) — the isRealApp branch mirrors this'
        );
    });

});
