/**
 * script/post_install.js — Bun-safety of the framework-dir nested install.
 *
 * `npmInstall` chdir's into the framework dir and installs its OWN nested deps
 * (swig/psl/ws). It runs only from-source (a `npm install` / `bun install` in a
 * clone) — NOT under `bun add -g`, which blocks dependency lifecycle scripts. It
 * shelled out one way a Bun-only image (no node, no npm) cannot satisfy:
 *
 *   `var cmd = ( isWin32() ) ? 'npm.cmd install' : 'npm install'` — a Bun-only
 *   image ships no `npm` binary, so `execSync(cmd)` ENOENTs.
 *
 * The fix gates the command on `runtime.isBun()`:
 *   - cmd → `'bun install'` under Bun (else the original win32-aware npm command).
 *
 * Zero Node delta by construction: `runtime.isBun()` is false on Node, so cmd is
 * byte-identical to the previous code there. Mirrors the bundle:start reinstall
 * fix (lib/cmd/bundle/start.js — see bundle-start-bun-pm.test.js), the same
 * nested-install class.
 *
 * Tests are two-layered:
 *   (a) source-inspection — the command is gated on `runtime.isBun()`, the Bun
 *       branch uses `bun install`, runtime is required by a relative path, the
 *       Node branch keeps the win32-aware npm fallback, and the old bare
 *       `var cmd = ( isWin32() ) ? ...` form is gone. This is the PRIMARY guard:
 *       the no-npm break is Bun-specific and cannot be reproduced on Node, which
 *       runs this suite.
 *   (b) behaviour — a pure-logic replica of the ternary proves the Node path is
 *       byte-identical to the pre-fix strings and the Bun path differs, with a
 *       subtract.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');

// post_install.js lives at the repo root under script/ (NOT in the framework
// dir), so resolve it directly rather than via test/fw.js.
var POST_INSTALL = path.resolve(__dirname, '..', '..', 'script', 'post_install.js');


// ---------------------------------------------------------------------------
// 01 — source: the nested install command is Bun-aware (runtime.isBun()-gated)
// ---------------------------------------------------------------------------
describe('01 - post_install nested install is PM/runtime aware for Bun', function() {

    var code;
    before(function() {
        // Strip line comments so the explanatory Bun comments (which mention the
        // old `npm install` form) cannot trip the negative pin.
        code = fs.readFileSync(POST_INSTALL, 'utf8').replace(/\/\/[^\n]*/g, '');
    });

    it('requires utils/runtime by relative path', function() {
        assert.match(code, /var runtime\s*=\s*require\([^)]*utils\/runtime/,
            'post_install.js must require utils/runtime.js for isBun()');
    });

    it('cmd is gated on runtime.isBun() and uses `bun install` under Bun', function() {
        assert.match(code, /var cmd\s*=\s*runtime\.isBun\(\)/,
            'cmd must be gated on runtime.isBun()');
        assert.match(code, /\?\s*'bun install'/,
            'the Bun branch of cmd must be `bun install`');
    });

    it('the Node branch keeps the win32-aware npm fallback', function() {
        assert.match(code, /isWin32\(\)\s*\)\s*\?\s*'npm\.cmd install'\s*:\s*'npm install'/,
            'the non-Bun branch must keep the win32-aware npm command');
    });

    it('the old bare `var cmd = ( isWin32() ) ? ...` assignment is gone', function() {
        assert.doesNotMatch(code, /var cmd\s*=\s*\(\s*isWin32/,
            'cmd must no longer start with the unguarded isWin32() ternary');
    });

    it('the resolved command is still consumed by execSync', function() {
        assert.match(code, /execSync\(\s*cmd\s*\)/,
            'the resolved cmd must be run via execSync');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: pure-logic replica of the ternary (Node parity + Bun)
// ---------------------------------------------------------------------------
describe('02 - post_install nested install command shape (replica)', function() {

    // Mirror of post_install.js exactly.
    function pickCmd(isBun, isWin32) {
        return isBun
            ? 'bun install'
            : ( isWin32 ? 'npm.cmd install' : 'npm install' );
    }

    it('Node (non-win32): byte-identical to the pre-fix string', function() {
        assert.strictEqual(pickCmd(false, false), 'npm install');
    });

    it('Node (win32): byte-identical to the pre-fix npm.cmd string', function() {
        assert.strictEqual(pickCmd(false, true), 'npm.cmd install');
    });

    it('Bun: cmd is `bun install` (win32 irrelevant under Bun)', function() {
        assert.strictEqual(pickCmd(true, false), 'bun install');
        assert.strictEqual(pickCmd(true, true), 'bun install');
    });

    it('subtract: the Bun path differs from the Node path', function() {
        assert.notStrictEqual(pickCmd(true, false), pickCmd(false, false));
    });

});
