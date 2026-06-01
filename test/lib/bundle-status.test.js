'use strict';

/**
 * bundle:status — source-structure unit tests
 *
 * bundle:status needs a live framework runtime (CmdHelper, project registry,
 * gna.js-injected globals like `_`, `requireJSON`, `isCmdConfigured`).
 * Re-creating that here for a full invocation would be heavy for near-zero
 * extra coverage, so — exactly like bundle-list.test.js / service-list.test.js
 * — these are source-structure pins: they assert the handler source contains
 * the right path-building, liveness-probe, resolution, and output-shape
 * expressions.
 *
 * Semantics covered:
 *   - reads the pidfile from GINA_HOMEDIR + '/run/<bundle>@<project>.pid'
 *   - liveness via process.kill(pid, 0), no pidfile deletion
 *   - ports.reverse.json preferred-port pick
 *   - requires both a bundle name and an @<project> (single-bundle scope)
 *   - errors when the bundle is not declared in the project manifest
 *   - run-state-led output ([ running ] / [ stopped ]) + --format=json
 *   - help.txt documents the command
 *
 * @module test/lib/bundle-status
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var STATUS_SOURCE = path.join(FW, 'lib/cmd/bundle/status.js');
var HELP_TXT      = path.join(FW, 'lib/cmd/bundle/help.txt');

var src     = fs.readFileSync(STATUS_SOURCE, 'utf8');
var helpTxt = fs.existsSync(HELP_TXT) ? fs.readFileSync(HELP_TXT, 'utf8') : '';

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

describe('02 - status uses readPidfile', function () {
    it('calls readPidfile for the target bundle', function () {
        assert.match(src, /readPidfile\(/);
    });

    it('surfaces running state into the output', function () {
        assert.match(src, /running/);
    });
});

describe('03 - pickPreferredPort via lib.cmdStatusFormat', function () {
    it('resolves the preferred port via fmt.pickPreferredPort (no inline copy)', function () {
        assert.match(src, /fmt\.pickPreferredPort\(ports\)/);
        assert.doesNotMatch(src, /var pickPreferredPort = function/);
    });
});

describe('04 - single-bundle resolution', function () {
    it('requires a bundle name (self.name == null guard)', function () {
        assert.match(src, /self\.name == null/);
    });

    it('requires an @<project> (self.projectName == null guard)', function () {
        assert.match(src, /self\.projectName == null/);
    });

    it('reads the named bundle from self.name (CmdHelper single-positional slot)', function () {
        assert.match(src, /self\.name/);
    });
});

describe('05 - manifest existence check', function () {
    it('verifies the bundle is declared in the project manifest', function () {
        assert.match(src, /manifest\.json/);
        assert.match(src, /existsInManifest/);
    });

    it('reports not-found and exits non-zero when the bundle is absent', function () {
        assert.match(src, /not-found/);
        assert.match(src, /process\.exit\(1\)/);
    });
});

describe('06 - output format', function () {
    it('supports --format=json', function () {
        assert.match(src, /\\-\\-format/);
    });

    it('json branch stringifies', function () {
        assert.match(src, /JSON\.stringify/);
    });

    it('text branch leads with [ running ]', function () {
        assert.match(src, /\[ running \]/);
    });

    it('text branch leads with [ stopped ]', function () {
        assert.match(src, /\[ stopped \]/);
    });

    it('text branch shows the pid when running', function () {
        assert.match(src, /'  pid ' \+ runState\.pid/);
    });

    it('exposes the active env in the JSON payload', function () {
        assert.match(src, /env\s*:\s*preferred \? preferred\.env : null/);
    });
});

describe('07 - help.txt', function () {
    it('documents bundle:status', function () {
        assert.match(helpTxt, /bundle:status/);
    });
});
