/**
 * lib/cmd/bundle/list.js — running-state column
 *
 * Source-inspection tests for the running-state additions (`readPidfile`
 * + per-bundle `(running, pid N)` / `(stopped)` suffix + JSON
 * `running` / `pid` fields).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var LIST_SOURCE = path.join(require('../fw'), 'lib/cmd/bundle/list.js');
var src         = fs.readFileSync(LIST_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — readPidfile helper
// ---------------------------------------------------------------------------

describe('01 - run-state via lib.cmdStatusFormat', function () {

    it('imports the shared primitive as `var fmt = lib.cmdStatusFormat`', function () {
        assert.match(src, /var fmt = lib\.cmdStatusFormat;/);
    });

    it('probes run state via fmt.readPidfile (no inline copy)', function () {
        assert.match(src, /fmt\.readPidfile\(/);
        assert.doesNotMatch(src, /var readPidfile = function/);
    });

    it('passes the run directory to fmt.readPidfile', function () {
        assert.match(src, /fmt\.readPidfile\(GINA_HOMEDIR \+ '\/run', /);
    });
});


// ---------------------------------------------------------------------------
// 02 — listAll integration
// ---------------------------------------------------------------------------

describe('02 - listAll uses readPidfile', function () {

    it('calls readPidfile(b, list[p]) for the current bundle', function () {
        assert.match(src, /var runState = fmt\.readPidfile\(GINA_HOMEDIR \+ '\/run', b, list\[p\]\);/);
    });

    it('pushes running + pid onto jsonBundle (listAll branch)', function () {
        // both listAll and listProjectOnly share the same mutation lines,
        // so the first occurrence counts for this branch
        assert.match(src, /jsonBundle\.running = runState\.running;/);
        assert.match(src, /jsonBundle\.pid\s*=\s*runState\.pid;/);
    });
});


// ---------------------------------------------------------------------------
// 03 — listProjectOnly integration
// ---------------------------------------------------------------------------

describe('03 - listProjectOnly uses readPidfile', function () {

    it('calls readPidfile(b, self.projectName)', function () {
        assert.match(src, /var runState = fmt\.readPidfile\(GINA_HOMEDIR \+ '\/run', b, self\.projectName\);/);
    });
});


// ---------------------------------------------------------------------------
// 04 — Text suffix shape
// ---------------------------------------------------------------------------

describe('04 - text suffix shape', function () {

    it('appends (running, pid N) when running', function () {
        assert.match(src, /'  \(running, pid ' \+ runState\.pid \+ '\)'/);
    });

    it('appends (stopped) when not running', function () {
        assert.match(src, /'  \(stopped\)'/);
    });
});


// ---------------------------------------------------------------------------
// 05 — pad helper
// ---------------------------------------------------------------------------

describe('05 - pad via lib.cmdStatusFormat', function () {

    it('aligns columns via fmt.pad (no inline copy)', function () {
        assert.match(src, /fmt\.pad\(/);
        assert.doesNotMatch(src, /var pad = function/);
    });
});


// ---------------------------------------------------------------------------
// 06 — pickPreferredPort helper
// ---------------------------------------------------------------------------

describe('06 - pickPreferredPort via lib.cmdStatusFormat', function () {

    it('resolves the preferred port via fmt.pickPreferredPort (no inline copy)', function () {
        assert.match(src, /fmt\.pickPreferredPort\(ports\)/);
        assert.doesNotMatch(src, /var pickPreferredPort = function/);
    });
});


// ---------------------------------------------------------------------------
// 07 — ports.reverse.json loader (init)
// ---------------------------------------------------------------------------

describe('07 - ports.reverse.json loader', function () {

    it('loads ~/.gina/ports.reverse.json into self.portsReverseData', function () {
        assert.match(src, /var portsPath = _\(GINA_HOMEDIR \+ '\/ports\.reverse\.json'\);/);
        assert.match(src, /self\.portsReverseData = requireJSON\(portsPath\);/);
    });

    it('seeds self.portsReverseData to {} before the load attempt', function () {
        assert.match(src, /self\.portsReverseData = \{\};/);
    });

    it('tolerates a missing or unparseable ports.reverse.json', function () {
        // the try/catch swallows parse errors so the command still renders (no port)
        assert.match(src, /try \{\s*self\.portsReverseData = requireJSON\(portsPath\);\s*\} catch/);
    });
});


// ---------------------------------------------------------------------------
// 08 — port column output (listAll + listProjectOnly)
// ---------------------------------------------------------------------------

describe('08 - port column output', function () {

    it('looks up ports via <bundle>@<project> key', function () {
        assert.match(src, /\(self\.portsReverseData \|\| \{\}\)\[b \+ '@' \+ list\[p\]\]/);
        assert.match(src, /\(self\.portsReverseData \|\| \{\}\)\[b \+ '@' \+ self\.projectName\]/);
    });

    it('builds a port label from the preferred pick', function () {
        assert.match(src, /var portLabel\s*=\s*preferred\s*\?\s*preferred\.scheme \+ ' ' \+ preferred\.env \+ ' ' \+ preferred\.protocol \+ ' ' \+ preferred\.port/);
    });

    it("falls back to '(no port)' when no preferred port", function () {
        assert.match(src, /:\s*'\(no port\)'/);
    });

    it('renders padded bundle name + space + port label', function () {
        assert.match(src, /str \+= prefix \+ fmt\.pad\(b, 16\) \+ ' ' \+ portLabel;/);
    });

    it('pushes ports onto jsonBundle (both branches)', function () {
        assert.match(src, /jsonBundle\.ports = ports;/);
    });
});


// ---------------------------------------------------------------------------
// 09 — #B15 Bug A + Bug B: parse-vs-dispatch separation
//
// Both bugs share the same root cause: the pre-fix init() short-circuited
// to listAll() INSIDE the argv parse loop on `!self.projectName`, which
// (a) fired on the bare no-arg call before the post-loop dispatch could
//     emit the spurious `[ null ] is not a valid project name` stderr line
//     (Bug A — fix relies on the fact that null short-circuits cleanly to
//     listAll() with no error), and
// (b) returned before later argv tokens could set `self.format`, so
//     `gina bundle:list --all --format=json` printed text output instead
//     of JSON (Bug B — the workaround `--format=json --all` only worked
//     because the format-setter fired before the short-circuit clause).
//
// Post-fix: the loop ONLY parses (sets self.format + allFlag); dispatch
// happens after the loop using `allFlag || self.projectName == null`
// (loose null check matches both null and undefined).
// ---------------------------------------------------------------------------

describe('09 - #B15: no dispatch inside the argv parse loop', function () {

    it('parse loop walks process.argv from index 3', function () {
        assert.match(src, /for \(let i=3, len=process\.argv\.length; i<len; i\+\+\) \{/);
    });

    it('format setter pins to /^\\-\\-format\\=/.test(...) → split(/=/)[1]', function () {
        assert.match(src, /if \(\s*\/\^\\-\\-format\\=\/\.test\(process\.argv\[i\]\)\s*\)\s*\{\s*self\.format\s*=\s*process\.argv\[i\]\.split\(\/\\=\/\)\[1\];?\s*\}/);
    });

    it('parse loop does NOT contain `return listAll()` (the pre-fix in-loop dispatch is gone)', function () {
        // Slice the source between the `for (let i=3` parse-loop header and the
        // first dispatch site (`if ( allFlag` post-loop). Pre-fix the loop body
        // contained `return listAll()`; post-fix it must not.
        var loopHeaderIdx = src.indexOf("for (let i=3, len=process.argv.length");
        var postLoopIdx   = src.indexOf("if ( allFlag", loopHeaderIdx);
        assert.ok(loopHeaderIdx > -1, 'pre-condition: parse loop header found');
        assert.ok(postLoopIdx > loopHeaderIdx, 'pre-condition: post-loop dispatch found after the loop');
        var loopBlock = src.slice(loopHeaderIdx, postLoopIdx);
        assert.equal(/return listAll\(\)/.test(loopBlock), false,
            'parse loop must not contain `return listAll()` — dispatch happens post-loop');
    });

    it('parse loop does NOT short-circuit on `!self.projectName` (the pre-fix root of Bug A + Bug B)', function () {
        var loopHeaderIdx = src.indexOf("for (let i=3, len=process.argv.length");
        var postLoopIdx   = src.indexOf("if ( allFlag", loopHeaderIdx);
        var loopBlock     = src.slice(loopHeaderIdx, postLoopIdx);
        assert.equal(/!self\.projectName/.test(loopBlock), false,
            'parse loop must not short-circuit on !self.projectName — that was the pre-fix Bug A + B trigger');
    });

    it('declares `var allFlag = false;` before the parse loop', function () {
        // The flag the parse loop sets and the post-loop dispatch reads.
        var loopHeaderIdx = src.indexOf("for (let i=3, len=process.argv.length");
        var pre           = src.slice(0, loopHeaderIdx);
        assert.match(pre, /var\s+allFlag\s*=\s*false\s*;/);
    });
});


// ---------------------------------------------------------------------------
// 10 — #B15 Bug B: --all regex accepts bare `--all` (not just `--all=`)
// ---------------------------------------------------------------------------

describe('10 - #B15: --all regex matches both bare and `--all=` forms', function () {

    it('uses /^\\-\\-all(\\=|$)/ — covers bare `--all` and `--all=value`', function () {
        assert.match(src, /\/\^\\-\\-all\(\\=\|\$\)\//);
    });

    it('the pre-fix /^\\-\\-all\\=/ regex (matches `--all=value` only) is gone', function () {
        // Pre-fix regex anchored on `--all\\=` with no trailing alternation —
        // bare `--all` fell through to the `!self.projectName` short-circuit.
        // The post-fix shape adds the `(\\=|$)` alternation explicitly.
        assert.equal(/\/\^\\-\\-all\\=\/\.test/.test(src), false,
            'pre-fix `--all` regex (no alternation) must not appear — bare `--all` must be matched explicitly');
    });

    it('sets allFlag = true on match (no in-loop listAll dispatch)', function () {
        assert.match(src, /if \(\s*\/\^\\-\\-all\(\\=\|\$\)\/\.test\(process\.argv\[i\]\)\s*\)\s*\{\s*allFlag\s*=\s*true\s*;?\s*\}/);
    });
});


// ---------------------------------------------------------------------------
// 11 — #B15 Bug A: post-loop dispatch uses loose null-check
// ---------------------------------------------------------------------------

describe('11 - #B15: post-loop dispatch with loose null-check', function () {

    it('routes to listAll() on `allFlag || self.projectName == null`', function () {
        // Loose `== null` matches both null (CmdHelper default) and undefined.
        // Strict `=== null` would miss undefined; `typeof === "undefined"`
        // (the pre-fix shape) missed null.
        assert.match(src, /if \(\s*allFlag\s*\|\|\s*self\.projectName\s*==\s*null\s*\)\s*\{\s*listAll\(\);?\s*\}/);
    });

    it('falls through to listProjectOnly() when isDefined(self.projectName)', function () {
        assert.match(src, /else if \(\s*isDefined\(self\.projectName\)\s*\)\s*\{\s*listProjectOnly\(\);?\s*\}/);
    });

    it('reports `[ <name> ] is not a valid project name.` on the else branch', function () {
        assert.match(src, /console\.error\(\s*'\[ '\s*\+\s*self\.projectName\s*\+\s*' \] is not a valid project name\.'\s*\);/);
    });

    it('exits with code 1 on the error branch', function () {
        // Anchored close to the error message so the test fires on the
        // post-loop error branch, not an unrelated process.exit(1).
        assert.match(src, /is not a valid project name\.'\s*\);\s*process\.exit\(1\);?/);
    });

    it('exits with code 0 after dispatch completes', function () {
        // Final line of init() — happy-path termination.
        assert.match(src, /process\.exit\(0\);?\s*\}\s*\/\*\*|process\.exit\(0\);?\s*\}\s*var isDefined/);
    });

    it('the pre-fix `typeof(self.projectName) == "undefined"` dispatch shape is gone', function () {
        // Pre-fix shape: `if ( typeof(self.projectName) == 'undefined' ) { listAll() }` —
        // missed the null case. Post-fix uses loose `== null` so this exact shape
        // must not reappear.
        assert.equal(/if \(\s*typeof\(self\.projectName\)\s*==\s*'undefined'\s*\)\s*\{\s*listAll\(\)/.test(src), false,
            'pre-fix typeof-undefined dispatch shape must not reappear — use `== null` instead');
    });
});
