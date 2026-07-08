/**
 * lib/cmd/index.js + framework/{stop,restart}.js — the offline start-action
 * version gate must be scoped to the framework topic, and its version-reject
 * paths must flush + exit (never a bare `return`).  (#B74)
 *
 * The gate at `lib/cmd/index.js` fires for ANY isFromFramework task with
 * `action == 'start'`. It was written for `gina start @<version>` (topic
 * 'framework'), but `project:start @<project>` and `service:start @<project>`
 * reach the same branch (topic 'project' / 'service') and their @<project> ref
 * was parsed as a version: it failed /^\d\.\d/ → `Wrong version` + a BARE
 * `return` that never called process.exit. With the CLI's MQ listener holding
 * the event loop that hung forever; via the `gina` wrapper (MQ listener not
 * started) it exited 0 without ever delegating. The fix:
 *   - scope the version parse to `opt.task.topic == 'framework'` so a
 *     project/service ref falls through to run(opt) → the topic's own start.js;
 *   - both reject paths flush (fs.writeSync) + process.exit(1) instead of the
 *     bare return, so the reject can no longer hang / silently exit 0;
 *   - guard `!availableVersions` so an unknown shortVersion reports
 *     `Version not installed` instead of a TypeError on `.indexOf`.
 * framework/stop.js + framework/restart.js carry sibling version parses with the
 * same bare-return defect (`gina stop|restart @<garbage>`); both are repaired.
 *
 * Source-inspection style (same as framework-stop.test.js): these handlers run
 * inside the CLI offline-command context (CmdHelper + gna.js-injected globals)
 * and cannot be required standalone, so §01-§03 lock the source structure and
 * §04 is a pure-logic replica of the gate decision (with a SUBTRACT proving the
 * pre-fix un-scoped shape misfires on a project ref, and the undefined guard).
 * The flush+exit pins use structural ordering (indexOf), NOT a fixed char
 * window — the reject carries a multi-line comment, so a window would be
 * brittle (jsdoc.md "a source pin gating X near a call needs a structural
 * anchor, not a char-distance").
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW           = require('../fw');
var INDEX_SOURCE = path.join(FW, 'lib/cmd/index.js');
var STOP_SOURCE  = path.join(FW, 'lib/cmd/framework/stop.js');
var RESTART_SRC  = path.join(FW, 'lib/cmd/framework/restart.js');

var indexSrc   = fs.readFileSync(INDEX_SOURCE, 'utf8');
var stopSrc    = fs.readFileSync(STOP_SOURCE, 'utf8');
var restartSrc = fs.readFileSync(RESTART_SRC, 'utf8');

// Assert the reject region starting at `startTok` flushes (fs.writeSync(2, ...))
// then process.exit(1), both BEFORE the `boundary` token — robust to comment
// length (structural ordering, not a fixed char window).
function assertFlushExit(src, startTok, boundary, label) {
    var e = src.indexOf(startTok);
    assert.ok(e !== -1, label + ': region start `' + startTok + '` not found');
    var b = boundary ? src.indexOf(boundary, e) : src.length;
    assert.ok(b !== -1, label + ': boundary `' + boundary + '` not found');
    var w = src.indexOf('fs.writeSync(2', e);
    var x = src.indexOf('process.exit(1)', w === -1 ? e : w);
    assert.ok(w !== -1 && w < b, label + ': fs.writeSync(2, ...) must be in the reject, before `' + boundary + '`');
    assert.ok(x !== -1 && x > w && x < b, label + ': process.exit(1) must follow the flush in the reject');
}

// ---------------------------------------------------------------------------
// 01 — lib/cmd/index.js: topic-scoped gate + flush-and-exit rejects
// ---------------------------------------------------------------------------

describe('01 - index.js: version gate scoped to the framework topic', function () {

    it('requires fs (for the guaranteed-flush reject)', function () {
        assert.match(indexSrc, /var fs\s+= require\('fs'\)/);
    });

    it('gates the @<version> parse on opt.task.topic == \'framework\'', function () {
        assert.match(indexSrc, /opt\.task\.topic == 'framework'/);
    });

    it('the topic guard precedes the /^@/ argv[3] test (structural order)', function () {
        var topicIdx = indexSrc.indexOf("opt.task.topic == 'framework'");
        var atIdx    = indexSrc.indexOf('/^@/.test(opt.argv[3])');
        assert.ok(topicIdx !== -1, 'topic guard token not found');
        assert.ok(atIdx !== -1, '/^@/ test token not found');
        assert.ok(topicIdx < atIdx, 'the framework-topic guard must gate the /^@/ version parse');
    });

    it('the Wrong-version reject flushes + exits (no bare return)', function () {
        assertFlushExit(indexSrc, "new Error('Wrong version: '+ version)",
            "new Error('Version not installed", '01 Wrong-version');
    });

    it('guards !availableVersions and flushes + exits on Version-not-installed', function () {
        assert.match(indexSrc, /!availableVersions \|\| availableVersions\.indexOf\(version\) < 0/);
        assertFlushExit(indexSrc, "new Error('Version not installed: '+ version)",
            'self.version = version', '01 Version-not-installed');
    });
});

// ---------------------------------------------------------------------------
// 02 — framework/stop.js: guard + flush-and-exit reject
// ---------------------------------------------------------------------------

describe('02 - framework/stop.js: version-reject flushes + exits', function () {

    it('guards !availableVersions before .indexOf', function () {
        assert.match(stopSrc, /!availableVersions \|\| availableVersions\.indexOf\(version\) < 0/);
    });

    it('the post-loop `if (err)` block flushes + exits (no bare return)', function () {
        assertFlushExit(stopSrc, 'if ( err ) {',
            "console.debug('Stopping", '02 stop if(err)');
        // the bare `if (err) { return; }` must be gone
        var ifIdx  = stopSrc.indexOf('if ( err ) {');
        var dbgIdx = stopSrc.indexOf("console.debug('Stopping", ifIdx);
        assert.doesNotMatch(stopSrc.slice(ifIdx, dbgIdx), /\breturn;/,
            'the bare `return;` in the if(err) block must be gone');
    });
});

// ---------------------------------------------------------------------------
// 03 — framework/restart.js: guard + flush-and-exit rejects
// ---------------------------------------------------------------------------

describe('03 - framework/restart.js: both version rejects flush + exit', function () {

    it('guards !availableVersions before .indexOf', function () {
        assert.match(restartSrc, /!availableVersions \|\| availableVersions\.indexOf\(version\) < 0/);
    });

    it('the Wrong-version reject flushes + exits (no bare return)', function () {
        assertFlushExit(restartSrc, "new Error('Wrong version: '+ version)",
            'var availableVersions', '03 Wrong-version');
    });

    it('the Version-not-installed reject flushes + exits (no bare return)', function () {
        assertFlushExit(restartSrc, "new Error('Version not installed: '+ version)",
            'self.version = version', '03 Version-not-installed');
    });
});

// ---------------------------------------------------------------------------
// 04 — pure-logic replica of the gate decision (+ SUBTRACT)
// ---------------------------------------------------------------------------
//
// Mirrors index.js's gate line-for-line. `unscoped` drops the framework-topic
// guard to reproduce the pre-fix behaviour; `noGuard` drops the
// `!availableVersions` guard to reproduce the pre-fix TypeError.

function classify(topic, argv3, frameworks, opts) {
    opts = opts || {};
    var scoped = opts.unscoped ? true : (topic === 'framework');
    if ( scoped && typeof argv3 !== 'undefined' && /^@/.test(argv3) ) {
        var version = argv3.replace(/\@/, '');
        var shortVersion = version.split('.').splice(0, 2).join('.');
        if ( !/^\d\.\d/.test(shortVersion) ) {
            return { action: 'reject', reason: 'Wrong version: ' + version };
        }
        var availableVersions = frameworks[shortVersion];
        var missing = opts.noGuard
            ? (availableVersions.indexOf(version) < 0)               // pre-fix: throws when undefined
            : (!availableVersions || availableVersions.indexOf(version) < 0);
        if ( missing ) {
            return { action: 'reject', reason: 'Version not installed: ' + version };
        }
        return { action: 'accept', version: version };
    }
    return { action: 'delegate' };   // falls through to run(opt) → the topic's start.js
}

describe('04 - gate decision replica', function () {

    var FRW = { '0.5': ['0.5.12-alpha.2', '0.5.11'] };

    it('framework topic + bad version → reject (Wrong version)', function () {
        assert.deepEqual(classify('framework', '@bad', FRW),
            { action: 'reject', reason: 'Wrong version: bad' });
    });

    it('framework topic + real installed version → accept', function () {
        assert.deepEqual(classify('framework', '@0.5.12-alpha.2', FRW),
            { action: 'accept', version: '0.5.12-alpha.2' });
    });

    it('framework topic + well-formed but uninstalled version → reject (Version not installed)', function () {
        assert.deepEqual(classify('framework', '@0.5.99', FRW),
            { action: 'reject', reason: 'Version not installed: 0.5.99' });
    });

    it('framework topic + unknown shortVersion → reject, NOT a crash (undefined guard)', function () {
        assert.deepEqual(classify('framework', '@9.9', FRW),
            { action: 'reject', reason: 'Version not installed: 9.9' });
    });

    it('project topic + @<project> → DELEGATE (the fix — skips the version parse)', function () {
        assert.deepEqual(classify('project', '@myproject', FRW), { action: 'delegate' });
    });

    it('service topic + @<project> → DELEGATE (bonus — same guard)', function () {
        assert.deepEqual(classify('service', '@myproject', FRW), { action: 'delegate' });
    });

    it('framework topic + no @ arg (daemon boot) → DELEGATE (gate body skipped)', function () {
        assert.deepEqual(classify('framework', '--fake-daemon-pid=123', FRW), { action: 'delegate' });
    });

    // SUBTRACT 1 — drop the topic guard: the project ref is misparsed as a
    // version and rejected (the pre-fix `Wrong version: <project>` bug).
    it('SUBTRACT: un-scoped gate misfires on a project ref', function () {
        assert.deepEqual(classify('project', '@myproject', FRW, { unscoped: true }),
            { action: 'reject', reason: 'Wrong version: myproject' });
    });

    // SUBTRACT 2 — drop the !availableVersions guard: an unknown shortVersion
    // throws instead of rejecting cleanly (the pre-fix TypeError).
    it('SUBTRACT: without the !availableVersions guard an unknown shortVersion throws', function () {
        assert.throws(function () {
            classify('framework', '@9.9', FRW, { noGuard: true });
        }, /Cannot read propert|indexOf/);
    });
});
