/**
 * bin/cli-debug — Bun Stage 4: runtime-aware debug-spawn binary.
 *
 * cli-debug launches the CLI under the V8/Bun inspector. It historically
 * resolved `which node`, which a no-node Bun image cannot satisfy. The binary is
 * now routed through utils/runtime's runtimeBinary(), with `which node`
 * evaluated ONLY under Node (isBun() false) — so the Node path is byte-identical
 * and the Bun path spawns the Bun binary. Source-inspection pins (no daemon is
 * spawned in the test) — the runtimeBinary behaviour itself is covered by
 * test/lib/runtime.test.js.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'bin', 'cli-debug'), 'utf8');


// ---------------------------------------------------------------------------
// 01 — source: the debug-spawn binary is runtime-aware
// ---------------------------------------------------------------------------
describe('01 - bin/cli-debug: debug-spawn binary is runtime-aware', function() {

    it('requires the utils/runtime helper', function() {
        assert.match(SRC, /require\(__dirname \+ '\/\.\.\/utils\/runtime\.js'\)/);
    });

    it('gates `which node` behind runtime.isBun() and routes through runtimeBinary()', function() {
        assert.match(
            SRC,
            /runtime\.isBun\(\)\s*\?\s*runtime\.runtimeBinary\(\)\s*:\s*runtime\.runtimeBinary\(execSync\('which node'\)/,
            'expected nodeBin = isBun() ? runtimeBinary() : runtimeBinary(execSync(which node)...)'
        );
    });

    it('still spawns the resolved binary (nodeBin)', function() {
        assert.match(SRC, /spawn\(nodeBin, argv/);
    });

});
