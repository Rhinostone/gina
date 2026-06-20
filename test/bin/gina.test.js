/**
 * bin/gina — Bun-safety guard on the NODE_PROJECT `.replace`.
 *
 * Under Node, assigning an absent process.argv slot to an env var coerces it to
 * the string 'undefined', so `process.env.NODE_PROJECT.replace(...)` works for
 * argless commands (e.g. `gina version`). Under Bun the assignment stays real
 * undefined and the `.replace` throws — crashing the CLI on its first command.
 *
 * Stage 1 guards the call with `typeof process.env.NODE_PROJECT === 'string'`,
 * which is always true on Node (so behaviour is unchanged) and false on Bun for
 * an absent arg (so the crash is avoided). These tests are two-layered:
 *   (a) source-inspection — the guard is present and precedes the .replace;
 *   (b) behaviour — a pure-logic replica of the guarded block proves the present
 *       arg still strips `@` and the absent (real-undefined) arg does not throw.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var GINA_SOURCE = path.resolve(__dirname, '..', '..', 'bin', 'gina');
var ginaSrc     = fs.readFileSync(GINA_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — source: the .replace is guarded by a typeof === 'string' check
// ---------------------------------------------------------------------------
describe('01 - bin/gina: NODE_PROJECT .replace is Bun-guarded', function() {

    it('guards the .replace with a typeof process.env.NODE_PROJECT === string check', function() {
        assert.match(
            ginaSrc,
            /typeof\s+process\.env\.NODE_PROJECT\s*===\s*'string'/,
            'expected a typeof === string guard before the NODE_PROJECT .replace'
        );
    });

    it('the guard precedes the NODE_PROJECT .replace call', function() {
        var guardIdx   = ginaSrc.indexOf("typeof process.env.NODE_PROJECT === 'string'");
        var replaceIdx = ginaSrc.indexOf('process.env.NODE_PROJECT.replace');
        assert.ok(guardIdx > -1, 'guard not found in bin/gina');
        assert.ok(replaceIdx > -1, 'NODE_PROJECT .replace not found in bin/gina');
        assert.ok(guardIdx < replaceIdx, 'guard must come before the .replace');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: pure-logic replica of the guarded block
// ---------------------------------------------------------------------------
describe('02 - bin/gina: NODE_PROJECT normalisation replica', function() {

    // Mirrors the guarded block. `raw` stands in for process.env.NODE_PROJECT
    // after the env-assignment from process.argv[4]: a string on Node (incl. the
    // literal 'undefined' when the arg is absent) and real undefined on Bun for
    // an absent arg.
    var normalise = function(raw) {
        var val = raw;
        if ( typeof val === 'string' ) {
            val = val.replace(/\@/, '');
        }
        return val;
    };

    it('strips a leading @ from a present project arg', function() {
        assert.equal(normalise('@myproject'), 'myproject');
    });

    it('leaves the Node absent-arg string undefined a string (behaviour unchanged)', function() {
        assert.equal(normalise('undefined'), 'undefined');
    });

    it('does not throw on a real undefined (the Bun absent-arg case)', function() {
        assert.doesNotThrow(function() { normalise(undefined); });
        assert.equal(normalise(undefined), undefined);
    });

});


// ---------------------------------------------------------------------------
// 03 — source: the daemon-spawn binary is runtime-aware (Bun Stage 4)
//
// runAsSubProcess() historically resolved `which node`, which a no-node Bun
// image cannot satisfy. The binary is now routed through utils/runtime's
// runtimeBinary(), with `which node` evaluated ONLY under Node (isBun() false),
// so the Node path is byte-identical and the Bun path spawns the Bun binary.
// ---------------------------------------------------------------------------
describe('03 - bin/gina: daemon-spawn binary is runtime-aware', function() {

    it('requires the utils/runtime helper', function() {
        assert.match(ginaSrc, /require\(__dirname \+ '\/\.\.\/utils\/runtime\.js'\)/);
    });

    it('gates `which node` behind runtime.isBun() and routes through runtimeBinary()', function() {
        assert.match(
            ginaSrc,
            /runtime\.isBun\(\)\s*\?\s*runtime\.runtimeBinary\(\)\s*:\s*runtime\.runtimeBinary\(execSync\('which node'\)/,
            'expected nodeBin = isBun() ? runtimeBinary() : runtimeBinary(execSync(which node)...)'
        );
    });

    it('still spawns the resolved binary (nodeBin)', function() {
        assert.match(ginaSrc, /spawn\(nodeBin, argv/);
    });

});
