/**
 * script/retry_lockfile_sync.js — behavioural tests.
 *
 * Covers `retryWithBackoff` with injected execDriver / sleepDriver / logger
 * so no real shell commands run. Negative-invariant pattern: retry must
 * stop at the first success and must NOT sleep after the final attempt.
 */

'use strict';

var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SCRIPT = nodePath.join(__dirname, '..', '..', 'script', 'retry_lockfile_sync.js');
var MOD = require(SCRIPT);


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports retryWithBackoff', function () {
        assert.equal(typeof MOD.retryWithBackoff, 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — happy path: command succeeds on first attempt
// ---------------------------------------------------------------------------

describe('02 - first-attempt success', function () {

    it('returns ok=true, attempts=1, no sleep, when command succeeds first try', function () {
        var execCalls = 0;
        var sleepCalls = 0;
        var infoCalls = [];
        var result = MOD.retryWithBackoff({
            cmd: 'fake-cmd',
            execDriver: function () { execCalls++; },
            sleepDriver: function (s) { sleepCalls++; },
            logger: { info: function (m) { infoCalls.push(m); } }
        });
        assert.equal(result.ok, true);
        assert.equal(result.attempts, 1);
        assert.equal(result.lastErr, null);
        assert.equal(execCalls, 1);
        assert.equal(sleepCalls, 0);
        assert.equal(infoCalls.length, 0);
    });
});


// ---------------------------------------------------------------------------
// 03 — fail-then-succeed: backoff between attempts, succeed mid-way
// ---------------------------------------------------------------------------

describe('03 - retry after transient failures', function () {

    it('retries with backoff and reports attempts when command succeeds on attempt 3', function () {
        var execCalls = 0;
        var sleepCalls = [];
        var infoCalls = [];
        var result = MOD.retryWithBackoff({
            cmd: 'fake-cmd',
            delaysSec: [1, 2, 3, 4],
            execDriver: function () {
                execCalls++;
                if (execCalls < 3) throw new Error('transient: registry not ready');
            },
            sleepDriver: function (s) { sleepCalls.push(s); },
            logger: { info: function (m) { infoCalls.push(m); } }
        });
        assert.equal(result.ok, true);
        assert.equal(result.attempts, 3);
        assert.equal(result.lastErr, null);
        assert.equal(execCalls, 3);
        // 2 sleeps (between attempt 1→2 and attempt 2→3); no sleep after the success.
        assert.deepStrictEqual(sleepCalls, [1, 2]);
        assert.equal(infoCalls.length, 2);
        assert.match(infoCalls[0], /attempt 1\/4 failed/);
        assert.match(infoCalls[1], /attempt 2\/4 failed/);
    });
});


// ---------------------------------------------------------------------------
// 04 — exhaustion: all attempts fail, never sleeps after the final attempt
// ---------------------------------------------------------------------------

describe('04 - all attempts exhausted', function () {

    it('returns ok=false, full attempts, lastErr set, after all attempts fail', function () {
        var execCalls = 0;
        var sleepCalls = [];
        var infoCalls = [];
        var finalErr = new Error('permanent: 404 not found');
        var result = MOD.retryWithBackoff({
            cmd: 'fake-cmd',
            delaysSec: [1, 2, 3],
            execDriver: function () { execCalls++; throw finalErr; },
            sleepDriver: function (s) { sleepCalls.push(s); },
            logger: { info: function (m) { infoCalls.push(m); } }
        });
        assert.equal(result.ok, false);
        assert.equal(result.attempts, 3);
        assert.equal(result.lastErr, finalErr);
        assert.equal(execCalls, 3);
        // 2 sleeps (after attempts 1 and 2). No sleep after attempt 3 (the final).
        assert.deepStrictEqual(sleepCalls, [1, 2]);
        assert.equal(infoCalls.length, 2);
    });
});


// ---------------------------------------------------------------------------
// 05 — defaults: omitting delaysSec uses the default [5, 15, 30, 30] schedule
// ---------------------------------------------------------------------------

describe('05 - default delay schedule', function () {

    it('default delaysSec is [5, 15, 30, 30] when not provided', function () {
        var sleepCalls = [];
        MOD.retryWithBackoff({
            cmd: 'fake-cmd',
            execDriver: function () { throw new Error('always fails'); },
            sleepDriver: function (s) { sleepCalls.push(s); },
            logger: { info: function () {} }
        });
        // 4 attempts, 3 sleeps (no sleep after the final attempt).
        assert.deepStrictEqual(sleepCalls, [5, 15, 30]);
    });
});


// ---------------------------------------------------------------------------
// 06 — input validation: missing cmd throws
// ---------------------------------------------------------------------------

describe('06 - input validation', function () {

    it('throws when cmd is missing', function () {
        assert.throws(
            function () { MOD.retryWithBackoff({}); },
            /opts\.cmd is required/
        );
    });

    it('throws when opts is omitted entirely', function () {
        assert.throws(
            function () { MOD.retryWithBackoff(); },
            /opts\.cmd is required/
        );
    });
});


// ---------------------------------------------------------------------------
// 07 — error message extraction: multi-line errors get only the first line
// ---------------------------------------------------------------------------

describe('07 - log message brevity', function () {

    it('logs only the first line of a multi-line error message', function () {
        var infoCalls = [];
        MOD.retryWithBackoff({
            cmd: 'fake-cmd',
            delaysSec: [1, 1],
            execDriver: function () {
                var e = new Error('line1\nline2-with-stack-trace\n  at foo\n  at bar');
                throw e;
            },
            sleepDriver: function () {},
            logger: { info: function (m) { infoCalls.push(m); } }
        });
        assert.equal(infoCalls.length, 1);
        assert.match(infoCalls[0], /line1/);
        assert.equal(infoCalls[0].indexOf('line2'), -1);
        assert.equal(infoCalls[0].indexOf('at foo'), -1);
    });
});
