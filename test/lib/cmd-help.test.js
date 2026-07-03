/**
 * lib/cmd/framework/help.js — `gina --help` / `gina -h` / `gina help`.
 *
 * All three are aliased to `framework:help` (lib/cmd/aliases.json) and must print
 * the framework command reference at lib/cmd/framework/help.txt.
 *
 * Regression guard for the "shortcut not indexed [undefined]" bug: help.js used
 * to delegate to the `open` command (`open(GINA_DIR)`), but open.js's Open()
 * ignores its argument and switch()es on process.argv[3] — undefined for a bare
 * `--help`, so it fell into open.js's `default` branch and printed
 * `gina: shortcut not indexed [undefined]` instead of the help text.
 *
 * The handler reads the CLI globals (lib.logger) at module top, so it is not
 * require-safe; it is covered by source-inspection pins (same style as
 * cmd-man / framework-update), plus behavioural assertions on the help.txt
 * contract it prints.
 *
 * Pinned/tested:
 *   (a) help.js reads + prints lib/cmd/framework/help.txt, guarded + with exit codes
 *   (b) help.js no longer delegates to `open` (the bug) and never emits the
 *       "shortcut not indexed" message
 *   (c) module shape — exports Help(opt)
 *   (d) the help.txt contract — non-empty, advertises `gina --help | -h`
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW       = require('../fw');
var HELP_JS  = path.join(FW, 'lib/cmd/framework/help.js');
var HELP_TXT = path.join(FW, 'lib/cmd/framework/help.txt');

var src     = fs.readFileSync(HELP_JS, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');

// Comment-stripped source for the negative code-absence pins — the JSDoc
// legitimately names `./open` / `gina open` in prose, which would trip a raw
// code-absence check (jsdoc.md "negative pin trips on the file's own JSDoc" trap).
var srcNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');


// ---------------------------------------------------------------------------
// 01 — help.js reads and prints help.txt
// ---------------------------------------------------------------------------

describe('01 - help.js prints the framework help.txt', function () {

    it('resolves help.txt relative to the handler dir', function () {
        assert.match(src, /path\.join\(\s*__dirname\s*,\s*['"]help\.txt['"]\s*\)/);
    });

    it('guards a missing help.txt before reading', function () {
        assert.match(src, /fs\.existsSync\(/);
    });

    it('reads the file and writes it to stdout', function () {
        assert.match(src, /fs\.readFileSync\(/);
        assert.match(src, /console\.log\(/);
    });

    it('exits 0 on success and 1 on failure', function () {
        assert.match(src, /process\.exit\(\s*0\s*\)/);
        assert.match(src, /process\.exit\(\s*1\s*\)/);
    });
});


// ---------------------------------------------------------------------------
// 02 — regression: no longer delegates to `open`, never emits the bad message
// ---------------------------------------------------------------------------

describe('02 - help.js no longer routes through the `open` command', function () {

    it('does not require ./open', function () {
        assert.doesNotMatch(srcNoComments, /require\(\s*['"]\.\/open['"]\s*\)/);
    });

    it('does not call open()', function () {
        assert.doesNotMatch(srcNoComments, /\bopen\s*\(/);
    });

    it('never emits the "shortcut not indexed" message (that belongs to `open`)', function () {
        assert.doesNotMatch(src, /shortcut not indexed/);
    });
});


// ---------------------------------------------------------------------------
// 03 — module shape
// ---------------------------------------------------------------------------

describe('03 - module shape', function () {

    it('exports a Help(opt) constructor', function () {
        assert.match(src, /function Help\s*\(\s*opt\s*\)/);
        assert.match(src, /module\.exports\s*=\s*Help/);
    });
});


// ---------------------------------------------------------------------------
// 04 — the help.txt contract that help.js prints
// ---------------------------------------------------------------------------

describe('04 - help.txt contract', function () {

    it('help.txt is present and non-empty', function () {
        assert.ok(helpTxt.length > 0, 'help.txt should carry the command reference');
    });

    it('help.txt advertises `gina --help | -h` and a usage section', function () {
        assert.match(helpTxt, /gina --help \| -h/);
        assert.match(helpTxt, /usage:/i);
    });
});
