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

describe('01 - readPidfile helper', function () {

    it('declares readPidfile(bundleName, projectName)', function () {
        assert.match(src, /var readPidfile = function\(bundleName, projectName\) \{/);
    });

    it('builds ~/.gina/run/<bundle>@<project>.pid path', function () {
        assert.match(src, /GINA_HOMEDIR \+ '\/run\/' \+ bundleName \+ '@' \+ projectName \+ '\.pid'/);
    });

    it('returns { running: false, pid: null } when pidfile missing', function () {
        assert.match(src, /if \(\s*!fs\.existsSync\(pidPath\)\s*\)\s*\{\s*return \{ running: false, pid: null \};/);
    });

    it('probes liveness via process.kill(pid, 0)', function () {
        assert.match(src, /process\.kill\(pid, 0\);/);
    });

    it('catches ESRCH (stale pidfile) without deleting the file', function () {
        // no fs.unlink or rm call in readPidfile
        assert.doesNotMatch(src, /fs\.unlink[A-Za-z]*\(pidPath/);
    });

    it('rejects NaN / non-positive pid values', function () {
        assert.match(src, /if \(\s*isNaN\(pid\) \|\| pid <= 0\s*\)/);
    });
});


// ---------------------------------------------------------------------------
// 02 — listAll integration
// ---------------------------------------------------------------------------

describe('02 - listAll uses readPidfile', function () {

    it('calls readPidfile(b, list[p]) for the current bundle', function () {
        assert.match(src, /var runState = readPidfile\(b, list\[p\]\);/);
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
        assert.match(src, /var runState = readPidfile\(b, self\.projectName\);/);
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

describe('05 - pad helper', function () {

    it('declares pad(s, width)', function () {
        assert.match(src, /var pad = function\(s, width\) \{/);
    });

    it('right-pads with spaces until width reached', function () {
        assert.match(src, /while \(out\.length < width\) \{\s*out \+= ' ';/);
    });
});


// ---------------------------------------------------------------------------
// 06 — pickPreferredPort helper
// ---------------------------------------------------------------------------

describe('06 - pickPreferredPort helper', function () {

    it('declares pickPreferredPort(ports)', function () {
        assert.match(src, /var pickPreferredPort = function\(ports\) \{/);
    });

    it('prefers dev env when present', function () {
        assert.match(src, /var envKey = ports\.dev \? 'dev' : Object\.keys\(ports\)\[0\];/);
    });

    it('returns null when no port record', function () {
        assert.match(src, /if \(!ports\) return null;/);
    });

    it('prefers http/2.0 https over http/1.1', function () {
        assert.match(src, /if \(env\['http\/2\.0'\] && env\['http\/2\.0'\]\.https\)/);
    });

    it('falls back to http/1.1 https before http/1.1 http', function () {
        assert.match(src, /if \(env\['http\/1\.1'\] && env\['http\/1\.1'\]\.https\)/);
        assert.match(src, /if \(env\['http\/1\.1'\] && env\['http\/1\.1'\]\.http\)/);
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
        assert.match(src, /str \+= prefix \+ pad\(b, 16\) \+ ' ' \+ portLabel;/);
    });

    it('pushes ports onto jsonBundle (both branches)', function () {
        assert.match(src, /jsonBundle\.ports = ports;/);
    });
});
