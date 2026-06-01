/**
 * Non-interactive (no-TTY) guards across the interactive CLI cmd handlers
 * that prompt via readline. Companion to bundle-add-noninteractive.test.js
 * (which covers bundle:add).
 *
 * Each of these handlers creates a readline interface and prompts the user.
 * In a non-interactive context (container entrypoint, CI, piped/detached
 * stdin) readline closes on stdin EOF, so rl.prompt() / rl.question() throws
 * ERR_USE_AFTER_CLOSE — caught upstream (or uncaught) and surfaced as an
 * opaque rollback/crash. Each handler now guards on !process.stdin.isTTY
 * (plus rl.closed where rl is module-scope) and fails fast with guidance
 * pointing at its non-interactive escape hatch:
 *
 *   bundle/remove   --force
 *   project/remove  --force
 *   protocol/set    --protocol / --scheme
 *   port/set        --protocol / --scheme / --port / --env (rl is lazy → isTTY only)
 *   view/add        no flag — guide to interactive use / removing existing files
 *
 * The handlers need the full CLI daemon context (CmdHelper, project registry,
 * gna.js globals) to run, so these are source-structure pins plus a shared
 * pure-logic replica of the guard predicate.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');
function read(rel) { return fs.readFileSync(path.join(FW, rel), 'utf8'); }

var HANDLERS = {
    'bundle/remove' : { src: read('lib/cmd/bundle/remove.js'),  flag: '--force',    promptMarker: 'rl.setPrompt(',           moduleScopeRl: true  },
    'project/remove': { src: read('lib/cmd/project/remove.js'), flag: '--force',    promptMarker: 'rl.setPrompt(',           moduleScopeRl: true  },
    'protocol/set'  : { src: read('lib/cmd/protocol/set.js'),   flag: '--protocol', promptMarker: 'rl.setPrompt(',           moduleScopeRl: true  },
    'port/set'      : { src: read('lib/cmd/port/set.js'),       flag: '--protocol', promptMarker: 'readline.createInterface', moduleScopeRl: false },
    'view/add'      : { src: read('lib/cmd/view/add.js'),       flag: null,         promptMarker: 'rl.setPrompt(',           moduleScopeRl: true  }
};


// ---------------------------------------------------------------------------
// 01 — Every interactive cmd handler guards on a non-TTY stdin
// ---------------------------------------------------------------------------

describe('01 - non-TTY guard present and well-placed', function () {

    Object.keys(HANDLERS).forEach(function (name) {
        var h = HANDLERS[name];

        it(name + ': guards on !process.stdin.isTTY', function () {
            assert.match(h.src, /!\s*process\.stdin\.isTTY/);
        });

        it(name + ': fails fast with process.exit(1) inside the guard', function () {
            var idx    = h.src.indexOf('process.stdin.isTTY');
            var window = h.src.slice(idx, idx + 800);
            assert.match(window, /process\.exit\(1\)/);
        });

        it(name + ': guard precedes the interactive prompt', function () {
            var guardIdx  = h.src.indexOf('process.stdin.isTTY');
            var promptIdx = h.src.indexOf(h.promptMarker);
            assert.ok(guardIdx > -1 && promptIdx > -1, 'both markers present');
            assert.ok(guardIdx < promptIdx, 'guard runs before the prompt is set up');
        });

        if (h.flag) {
            it(name + ': message points at its ' + h.flag + ' escape hatch', function () {
                var idx    = h.src.indexOf('process.stdin.isTTY');
                var window = h.src.slice(idx, idx + 800);
                assert.ok(window.indexOf(h.flag) > -1, 'guard message references ' + h.flag);
            });
        }
    });
});


// ---------------------------------------------------------------------------
// 02 — rl.closed belt-and-suspenders only where rl is module-scope
// ---------------------------------------------------------------------------

describe('02 - rl.closed handling matches the readline lifecycle', function () {

    Object.keys(HANDLERS).forEach(function (name) {
        var h = HANDLERS[name];

        if (h.moduleScopeRl) {
            it(name + ': module-scope rl → guard also checks || rl.closed', function () {
                assert.match(h.src, /\|\|\s*rl\.closed/);
            });
        } else {
            it(name + ': lazy rl → guard precedes createInterface (isTTY only)', function () {
                var guardIdx  = h.src.indexOf('process.stdin.isTTY');
                var createIdx = h.src.indexOf('readline.createInterface');
                assert.ok(guardIdx > -1 && createIdx > -1, 'both markers present');
                assert.ok(guardIdx < createIdx, 'guard runs before lazy rl creation');
            });
        }
    });
});


// ---------------------------------------------------------------------------
// 03 — Guard predicate (pure-logic replica)
// ---------------------------------------------------------------------------

describe('03 - guard predicate replica', function () {

    // Mirrors: if ( !process.stdin.isTTY || rl.closed ) { fail-fast }
    function failsNonInteractive(stdinIsTTY, rlClosed) {
        return ( !stdinIsTTY || rlClosed );
    }

    it('fails when stdin is not a TTY (container / CI / pipe)', function () {
        assert.equal(failsNonInteractive(undefined, false), true);
        assert.equal(failsNonInteractive(false, false), true);
    });

    it('fails when the readline is already closed even if isTTY is truthy', function () {
        assert.equal(failsNonInteractive(true, true), true);
    });

    it('proceeds to the interactive prompt on a live TTY', function () {
        assert.equal(failsNonInteractive(true, false), false);
    });
});
