'use strict';

/**
 * project:status — source-structure unit tests
 *
 * project:status needs a live framework runtime (CmdHelper, project registry,
 * gna.js-injected globals like `_`, `requireJSON`, `orderBundles`,
 * `isCmdConfigured`). Re-creating that here for a full invocation would be
 * heavy for near-zero extra coverage, so — exactly like bundle-list.test.js /
 * service-list.test.js — these are source-structure pins: they assert the
 * handler source contains the right path-building, liveness-probe, dispatch,
 * and output-shape expressions.
 *
 * Semantics covered:
 *   - reads pidfiles from GINA_HOMEDIR + '/run/<bundle>@<project>.pid'
 *   - liveness via process.kill(pid, 0), no pidfile deletion
 *   - ports.reverse.json preferred-port pick
 *   - dispatches to statusAll (no @project) or statusProjectOnly (named)
 *   - run-state-led output ([ running ] / [ stopped ]) + --format=json
 *   - help.txt documents the command
 *
 * @module test/lib/project-status
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var STATUS_SOURCE = path.join(FW, 'lib/cmd/project/status.js');
var HELP_TXT      = path.join(FW, 'lib/cmd/project/help.txt');

var src     = fs.readFileSync(STATUS_SOURCE, 'utf8');
var helpTxt = fs.existsSync(HELP_TXT) ? fs.readFileSync(HELP_TXT, 'utf8') : '';

describe('01 - readPidfile helper', function () {
    it('builds the pidfile path under GINA_HOMEDIR/run', function () {
        assert.match(src, /GINA_HOMEDIR \+ '\/run\/' \+ bundleName \+ '@' \+ projectName \+ '\.pid'/);
    });

    it('probes liveness with process.kill(pid, 0)', function () {
        assert.match(src, /process\.kill\(pid, 0\)/);
    });

    it('returns a running flag and pid', function () {
        assert.match(src, /running:\s*true,\s*pid:\s*pid/);
    });

    it('returns running:false on a missing or stale pidfile', function () {
        assert.match(src, /running:\s*false,\s*pid:\s*null/);
    });

    it('does NOT delete the pidfile (cleanup stays with bundle:stop)', function () {
        assert.doesNotMatch(src, /fs\.unlink\w*\(pidPath/);
    });
});

describe('02 - collectBundles uses readPidfile', function () {
    it('calls readPidfile for each bundle', function () {
        assert.match(src, /readPidfile\(/);
    });

    it('iterates bundles via orderBundles', function () {
        assert.match(src, /orderBundles\(/);
    });

    it('surfaces running state into the output', function () {
        assert.match(src, /running/);
    });
});

describe('03 - pickPreferredPort helper', function () {
    it('prefers the dev env', function () {
        assert.match(src, /ports\.dev \? 'dev'/);
    });

    it('prefers http/2.0 https', function () {
        assert.match(src, /http\/2\.0/);
    });
});

describe('04 - projectName null-guard (CmdHelper default)', function () {
    it('treats projectName == null as "all projects"', function () {
        assert.match(src, /self\.projectName == null/);
    });

    it('does NOT use a typeof undefined check that misses null', function () {
        // the bundle:list bug: typeof(self.projectName) != 'undefined' passed for null
        assert.doesNotMatch(src, /typeof\(self\.projectName\) != 'undefined'/);
    });
});

describe('05 - dispatch', function () {
    it('has a statusAll path', function () {
        assert.match(src, /statusAll/);
    });

    it('has a statusProjectOnly path', function () {
        assert.match(src, /statusProjectOnly/);
    });

    it('errors on an unregistered named project', function () {
        assert.match(src, /is not a registered project/);
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
        assert.match(src, /'  pid ' \+ entry\.pid/);
    });
});

describe('07 - help.txt', function () {
    it('documents project:status', function () {
        assert.match(helpTxt, /project:status/);
    });
});
