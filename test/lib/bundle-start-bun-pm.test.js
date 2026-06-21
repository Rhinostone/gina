/**
 * lib/cmd/bundle/start.js — Bun-safety of the node_modules reinstall on bundle:start.
 *
 * `checkArchAgainstNodeModules` (reached on every `gina bundle:start`) reinstalls
 * the project's node_modules when a local-scope arch/platform mismatch is detected.
 * It shelled out two ways that a Bun-only image (no node, no npm) cannot satisfy:
 *
 *   1. `var npmCmd = isWin32() ? 'npm.cmd install' : 'npm install'` — a Bun-only
 *      image ships no `npm` binary, so `execSync(npmCmd)` ENOENTs.
 *   2. `execSync(ginaBin + ' framework:link @<proj>')` — `ginaBin` (`which gina`)
 *      is a `#!/usr/bin/env node` script, so executing it directly in a no-node
 *      image fails on the shebang.
 *
 * The fix gates both on `runtime.isBun()`:
 *   - npmCmd  → `'bun install'` under Bun (else the original npm command).
 *   - linkCmd → prepend `runtime.runtimeBinary()` (the running Bun binary) to the
 *     gina-bin invocation so it runs under Bun, bypassing the node shebang.
 *
 * Both branches are ZERO Node delta by construction: `runtime.isBun()` is false on
 * Node, so npmCmd and linkCmd are byte-identical to the previous code there.
 *
 * Tests are two-layered:
 *   (a) source-inspection — both commands are gated on `runtime.isBun()`, the bun
 *       branches use `bun install` / `runtimeBinary()`, and the old bare forms are
 *       gone. This is the PRIMARY guard: the no-node/no-npm break is Bun-specific
 *       and cannot be reproduced on Node, which runs this suite.
 *   (b) behaviour — a pure-logic replica of the two ternaries proves the Node path
 *       is byte-identical to the pre-fix strings and the Bun path differs as
 *       intended (`bun install` + runtime-prepended link), with a subtract.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');

var FW    = require('../fw');
var START = path.join(FW, 'lib/cmd/bundle/start.js');


// ---------------------------------------------------------------------------
// 01 — source: the reinstall commands are Bun-aware (runtime.isBun()-gated)
// ---------------------------------------------------------------------------
describe('01 - bundle:start reinstall is PM/runtime aware for Bun', function() {

    var code;
    before(function() {
        // Strip line comments so the explanatory Bun comments (which mention the
        // old `npm install` / `ginaBin` forms) cannot trip the negative pins.
        code = fs.readFileSync(START, 'utf8').replace(/\/\/[^\n]*/g, '');
    });

    it('requires utils/runtime by relative path', function() {
        assert.match(code, /var runtime\s*=\s*require\([^)]*utils\/runtime/,
            'start.js must require utils/runtime.js for isBun()/runtimeBinary()');
    });

    it('npmCmd is gated on runtime.isBun() and uses `bun install` under Bun', function() {
        assert.match(code, /var npmCmd\s*=\s*runtime\.isBun\(\)/,
            'npmCmd must be gated on runtime.isBun()');
        assert.match(code, /\?\s*'bun install'/,
            'the Bun branch of npmCmd must be `bun install`');
    });

    it('the old bare `var npmCmd = ( isWin32() ) ? ...` assignment is gone', function() {
        assert.doesNotMatch(code, /var npmCmd\s*=\s*\(\s*isWin32/,
            'npmCmd must no longer start with the unguarded isWin32() ternary');
    });

    it('linkCmd is gated on runtime.isBun() and prepends runtimeBinary() under Bun', function() {
        assert.match(code, /var linkCmd\s*=\s*runtime\.isBun\(\)/,
            'linkCmd must be gated on runtime.isBun()');
        assert.match(code, /runtime\.runtimeBinary\(\)\s*\+[^]*?ginaBin[^]*?framework:link/,
            'the Bun branch must prepend runtimeBinary() ahead of the gina bin + framework:link');
        assert.match(code, /execSync\(\s*linkCmd\s*\)/,
            'the self-invoke must run the runtime-aware linkCmd');
    });

    it('the old direct `execSync(ginaBin + ...)` self-invoke is gone', function() {
        assert.doesNotMatch(code, /execSync\(\s*ginaBin\s*\+/,
            'the gina bin must no longer be exec\'d directly (shebang fails in a no-node image)');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: pure-logic replica of the two ternaries (Node parity + Bun)
// ---------------------------------------------------------------------------
describe('02 - bundle:start reinstall command shape (replica)', function() {

    // Mirror of start.js exactly.
    function pickNpmCmd(isBun, isWin32) {
        return isBun
            ? 'bun install'
            : ( isWin32 ? 'npm.cmd install' : 'npm install' );
    }
    function pickLinkCmd(isBun, runtimeBinary, ginaBin, projectName) {
        return isBun
            ? runtimeBinary + ' ' + ginaBin + ' framework:link @' + projectName
            : ginaBin + ' framework:link @' + projectName;
    }

    var GINA_BIN = '/usr/local/bin/gina';
    var PROJ     = 'myproject';
    var BUN_BIN  = '/home/u/.bun/bin/bun';

    it('Node (non-win32): byte-identical to the pre-fix strings', function() {
        assert.strictEqual(pickNpmCmd(false, false), 'npm install');
        assert.strictEqual(
            pickLinkCmd(false, BUN_BIN, GINA_BIN, PROJ),
            GINA_BIN + ' framework:link @' + PROJ);
    });

    it('Node (win32): byte-identical to the pre-fix npm.cmd string', function() {
        assert.strictEqual(pickNpmCmd(false, true), 'npm.cmd install');
    });

    it('Bun: npmCmd is `bun install` and linkCmd is prepended with the bun binary', function() {
        assert.strictEqual(pickNpmCmd(true, false), 'bun install');
        assert.strictEqual(pickNpmCmd(true, true), 'bun install'); // win32 irrelevant under Bun
        assert.strictEqual(
            pickLinkCmd(true, BUN_BIN, GINA_BIN, PROJ),
            BUN_BIN + ' ' + GINA_BIN + ' framework:link @' + PROJ);
    });

    it('subtract: the Bun path differs from the Node path on both commands', function() {
        assert.notStrictEqual(pickNpmCmd(true, false), pickNpmCmd(false, false));
        assert.notStrictEqual(
            pickLinkCmd(true, BUN_BIN, GINA_BIN, PROJ),
            pickLinkCmd(false, BUN_BIN, GINA_BIN, PROJ));
    });

});
