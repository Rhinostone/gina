/**
 * script/check_roadmap_consistency.js — behavioural tests.
 *
 * Covers the pure helpers (extractVersionTokens, compareVersions,
 * parseStatusRows) and the orchestrating `check()` function with
 * injected roadmap content so no filesystem is needed, plus
 * source-structure pins on the prepare_version.js wiring and a smoke
 * run against the real ROADMAP.md (zero false positives on the live
 * file for plausible next versions).
 *
 * Negative-invariant pattern: `check()` must return `ok: false` when an
 * open (📋) row references the exact version being released, or a done
 * (✅) row references a same-major version newer than it — and must NOT
 * trip on `X.Y.x` bucket tokens, range-prefixed dependency floors
 * (`^2.3.0`), bare prose versions, or cross-major dependency versions.
 */

'use strict';

var fs = require('fs');
var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SCRIPT = nodePath.join(__dirname, '..', '..', 'script', 'check_roadmap_consistency.js');
var CHECK  = require(SCRIPT);

var PREPARE_SRC = fs.readFileSync(
    nodePath.join(__dirname, '..', '..', 'script', 'prepare_version.js'), 'utf8');
var ROADMAP = fs.readFileSync(
    nodePath.join(__dirname, '..', '..', 'ROADMAP.md'), 'utf8');


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports extractVersionTokens', function () {
        assert.equal(typeof CHECK.extractVersionTokens, 'function');
    });

    it('exports compareVersions', function () {
        assert.equal(typeof CHECK.compareVersions, 'function');
    });

    it('exports latestTimelineStable', function () {
        assert.equal(typeof CHECK.latestTimelineStable, 'function');
    });

    it('exports parseStatusRows', function () {
        assert.equal(typeof CHECK.parseStatusRows, 'function');
    });

    it('exports check', function () {
        assert.equal(typeof CHECK.check, 'function');
    });

    it('exports isAlphaPublish', function () {
        assert.equal(typeof CHECK.isAlphaPublish, 'function');
    });

    it('exports main', function () {
        assert.equal(typeof CHECK.main, 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — extractVersionTokens
// ---------------------------------------------------------------------------

describe('02 - extractVersionTokens', function () {

    it('extracts an exact backtick-wrapped version', function () {
        assert.deepEqual(
            CHECK.extractVersionTokens('| ✅ | feature | `0.4.0` | 2026-05-29 |'),
            ['0.4.0']);
    });

    it('extracts an alpha-suffixed version', function () {
        assert.deepEqual(
            CHECK.extractVersionTokens('shipped in `0.4.1-alpha.2` then stable'),
            ['0.4.1-alpha.2']);
    });

    it('extracts multiple tokens in order', function () {
        assert.deepEqual(
            CHECK.extractVersionTokens('moved from `0.4.0` to ship in `0.5.0`'),
            ['0.4.0', '0.5.0']);
    });

    it('does NOT match a bucket token (`0.5.x`)', function () {
        assert.deepEqual(CHECK.extractVersionTokens('re-targeted to `0.5.x` later'), []);
    });

    it('does NOT match a caret-prefixed dependency floor (`^2.3.0`)', function () {
        assert.deepEqual(CHECK.extractVersionTokens('floor moved to `^2.3.0`'), []);
    });

    it('does NOT match a tilde-prefixed range (`~1.2.0`)', function () {
        assert.deepEqual(CHECK.extractVersionTokens('pinned `~1.2.0` somewhere'), []);
    });

    it('does NOT match bare (un-backticked) prose versions', function () {
        assert.deepEqual(CHECK.extractVersionTokens('swig 1.6 went to 2.0.1 here'), []);
    });

    it('returns an empty array on empty / null input', function () {
        assert.deepEqual(CHECK.extractVersionTokens(''), []);
        assert.deepEqual(CHECK.extractVersionTokens(null), []);
    });
});


// ---------------------------------------------------------------------------
// 03 — compareVersions
// ---------------------------------------------------------------------------

describe('03 - compareVersions', function () {

    it('orders by major, minor, patch', function () {
        assert.equal(CHECK.compareVersions('0.5.1', '0.5.0'), 1);
        assert.equal(CHECK.compareVersions('0.5.0', '0.5.1'), -1);
        assert.equal(CHECK.compareVersions('1.0.0', '0.9.9'), 1);
        assert.equal(CHECK.compareVersions('0.4.10', '0.4.9'), 1);
    });

    it('treats equal versions as equal', function () {
        assert.equal(CHECK.compareVersions('0.5.0', '0.5.0'), 0);
    });

    it('sorts a prerelease BEFORE its stable', function () {
        assert.equal(CHECK.compareVersions('0.5.0-alpha.1', '0.5.0'), -1);
        assert.equal(CHECK.compareVersions('0.5.0', '0.5.0-alpha.2'), 1);
    });

    it('orders prereleases by their counter', function () {
        assert.equal(CHECK.compareVersions('0.5.0-alpha.2', '0.5.0-alpha.1'), 1);
        assert.equal(CHECK.compareVersions('0.5.0-alpha.1', '0.5.0-alpha.1'), 0);
    });

    it('a prerelease of a HIGHER core still outranks a lower stable', function () {
        assert.equal(CHECK.compareVersions('0.5.1-alpha.1', '0.5.0'), 1);
    });
});


// ---------------------------------------------------------------------------
// 03b — latestTimelineStable (rule-2 shipped baseline)
// ---------------------------------------------------------------------------

describe('03b - latestTimelineStable', function () {

    it('returns the highest stable version marked shipped in a timeline row', function () {
        var content = [
            '| **Q2 2026** | `0.5.0` ✅ | a |',
            '| **Q2 2026** | `0.5.2` ✅ | b |',
            '| **Q2 2026** | `0.4.7` ✅ | c |'
        ].join('\n');
        assert.equal(CHECK.latestTimelineStable(content), '0.5.2');
    });

    it('ignores status rows (✅ marker BEFORE the version) — only timeline marks count', function () {
        assert.equal(
            CHECK.latestTimelineStable('| ✅ | feature | `0.9.0` | 2026-06-11 |'),
            null);
    });

    it('returns null when no timeline mark is present', function () {
        assert.equal(CHECK.latestTimelineStable('no versions here'), null);
        assert.equal(CHECK.latestTimelineStable(''), null);
    });
});


// ---------------------------------------------------------------------------
// 04 — parseStatusRows
// ---------------------------------------------------------------------------

describe('04 - parseStatusRows', function () {

    var SAMPLE = [
        '# Roadmap',
        '| Period | Version | Focus |',
        '| **Q2 2026** | `0.5.0` ✅ | stuff |',
        '| ✅ | **Done thing** | `0.4.0` | 2026-05-29 |',
        '| 📋 | **Open thing** | `0.5.x` | Q1 2027 |',
        'prose mentioning `9.9.9` outside any table row'
    ].join('\n');

    it('finds only 📋/✅ status rows (not headers, timeline rows, or prose)', function () {
        var rows = CHECK.parseStatusRows(SAMPLE);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].status, '✅');
        assert.equal(rows[1].status, '📋');
    });

    it('reports 1-based line numbers and attaches extracted versions', function () {
        var rows = CHECK.parseStatusRows(SAMPLE);
        assert.equal(rows[0].lineNo, 4);
        assert.deepEqual(rows[0].versions, ['0.4.0']);
        assert.deepEqual(rows[1].versions, []); // bucket token excluded
    });

    it('returns an empty array on empty input', function () {
        assert.deepEqual(CHECK.parseStatusRows(''), []);
    });
});


// ---------------------------------------------------------------------------
// 05 — check(): rule 1 — open row references the released version
// ---------------------------------------------------------------------------

describe('05 - check: open-row-references-released-version', function () {

    it('fails when a 📋 row references the exact version being released', function () {
        var r = CHECK.check({
            roadmapContent: '| 📋 | **thing** | `0.5.0` | Q1 2027 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, false);
        assert.equal(r.failures.length, 1);
        assert.equal(r.failures[0].rule, 'open-row-references-released-version');
    });

    it('passes when the 📋 row uses the bucket form instead', function () {
        var r = CHECK.check({
            roadmapContent: '| 📋 | **thing** | `0.5.x` | Q1 2027 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, true);
    });

    it('passes when the 📋 row targets a DIFFERENT (future) version', function () {
        var r = CHECK.check({
            roadmapContent: '| 📋 | **thing** | `0.6.0` | Q3 2027 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, true);
    });

    it('also trips on a prose reference inside the open row (forces a reword)', function () {
        var r = CHECK.check({
            roadmapContent: '| 📋 | **thing** — deferred at the `0.5.0` cut | `0.6.0` | Q3 2027 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, false);
    });
});


// ---------------------------------------------------------------------------
// 06 — check(): rule 2 — done row references a future version
// ---------------------------------------------------------------------------

describe('06 - check: done-row-references-future-version', function () {

    it('fails when a ✅ row references a same-major version NEWER than the release', function () {
        var r = CHECK.check({
            roadmapContent: '| ✅ | **thing** | `0.6.0` | 2026-06-11 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, false);
        assert.equal(r.failures[0].rule, 'done-row-references-future-version');
    });

    it('ignores cross-major dependency versions in ✅ rows (no false positive)', function () {
        var r = CHECK.check({
            roadmapContent: '| ✅ | **engine bump** — fork moved to `2.3.0` | `0.4.0` | 2026-05-29 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, true);
    });

    it('passes when the ✅ row references the version being released', function () {
        var r = CHECK.check({
            roadmapContent: '| ✅ | **thing** | `0.5.0` | 2026-06-11 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, true);
    });

    it('passes when the ✅ row references an older version', function () {
        var r = CHECK.check({
            roadmapContent: '| ✅ | **thing** | `0.4.3` | 2026-06-04 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, true);
    });

    it('does NOT flag a newer ✅ version that the timeline records as shipped (hotfix / out-of-order cut)', function () {
        // Releasing 0.4.8 while 0.5.0 has already shipped: the ✅ 0.5.0 feature
        // row legitimately references a newer-but-shipped version. The timeline
        // mark `0.5.0` ✅ is the shipped record that floors the comparison, so
        // the older-line cut is not falsely blocked.
        var r = CHECK.check({
            roadmapContent: [
                '| **Q2 2026** | `0.5.0` ✅ | shipped feature set |',
                '| ✅ | **a 0.5.0 feature** | `0.5.0` | 2026-06-11 |'
            ].join('\n'),
            targetedVersion: '0.4.8'
        });
        assert.equal(r.ok, true,
            'a newer version already marked shipped in the timeline must not block an older-line cut');
    });

    it('STILL flags a newer ✅ version the timeline does NOT record as shipped', function () {
        // Same older-line target, but no `0.5.0` ✅ timeline mark — 0.5.0 is not
        // recorded as shipped, so the jumped-ahead-label protection still fires.
        var r = CHECK.check({
            roadmapContent: '| ✅ | **a feature** | `0.5.0` | 2026-06-11 |',
            targetedVersion: '0.4.8'
        });
        assert.equal(r.ok, false);
        assert.equal(r.failures[0].rule, 'done-row-references-future-version');
    });
});


// ---------------------------------------------------------------------------
// 07 — check(): rule 3 — timeline warning is advisory only
// ---------------------------------------------------------------------------

describe('07 - check: timeline warning', function () {

    it('warns (without failing) when no timeline row marks the release', function () {
        var r = CHECK.check({
            roadmapContent: '| ✅ | **thing** | `0.4.0` | 2026-05-29 |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, true);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /no timeline row/);
    });

    it('does not warn when a `version` ✅ timeline mark exists', function () {
        var r = CHECK.check({
            roadmapContent: '| **Q2 2026** | `0.5.0` ✅ | shipped stuff |',
            targetedVersion: '0.5.0'
        });
        assert.equal(r.ok, true);
        assert.equal(r.warnings.length, 0);
    });
});


// ---------------------------------------------------------------------------
// 08 — smoke against the real ROADMAP.md (no false positives on live file)
// ---------------------------------------------------------------------------

describe('08 - live ROADMAP.md smoke', function () {

    // A genuine forward cut on the CURRENT release line: minor-bump the
    // package.json version. Deriving from package.json (not from the max token
    // in the file) keeps the candidate in the live major (0.x) — so the smoke
    // actually exercises rule 2 against the real 0.x ✅ rows (a cross-major
    // candidate would skip them all, rule 2 being same-major-only) — and ahead
    // of every shipped 0.x version, so a clean forward cut must pass. Replaces
    // the prior hardcoded `0.5.1` / `0.6.0` constants, which had both already
    // shipped and would have false-flagged against the next forward ✅ row (#2).
    function forwardCandidate() {
        var pkg = JSON.parse(fs.readFileSync(
            nodePath.join(__dirname, '..', '..', 'package.json'), 'utf8'));
        var core = String(pkg.version).split('-')[0].split('.').map(Number);
        return core[0] + '.' + (core[1] + 1) + '.0';
    }

    it('the live file is consistent with a genuine forward cut (derived from package.json)', function () {
        var v = forwardCandidate();
        var r = CHECK.check({ roadmapContent: ROADMAP, targetedVersion: v });
        assert.equal(r.ok, true,
            'live ROADMAP.md must not trip the gate for forward cut ' + v + ': ' +
            JSON.stringify(r.failures));
    });

    it('the live file would have CAUGHT the pre-sweep drift (regression proof)', function () {
        // Reconstruct the two drift shapes the 2026-06-12 sweep fixed and
        // assert the gate flags both.
        var preSweep = [
            '| 📋 | **`project:move`** — relocate | `0.5.0` | Q1 2027 |',
            '| ✅ | **Agent endpoint — production auth** | `0.5.0` | 2026-06-02 |'
        ].join('\n');
        var r = CHECK.check({ roadmapContent: preSweep, targetedVersion: '0.4.7' });
        // rule 2: ✅ row says 0.5.0 while releasing 0.4.7
        assert.equal(r.ok, false);
        var rules = r.failures.map(function (f) { return f.rule; });
        assert.ok(rules.indexOf('done-row-references-future-version') > -1);
        // and at the 0.5.0 cut itself, rule 1 catches the stale open row
        var r2 = CHECK.check({ roadmapContent: preSweep, targetedVersion: '0.5.0' });
        assert.equal(r2.ok, false);
        var rules2 = r2.failures.map(function (f) { return f.rule; });
        assert.ok(rules2.indexOf('open-row-references-released-version') > -1);
    });
});


// ---------------------------------------------------------------------------
// 09 — prepare_version.js wiring pins
// ---------------------------------------------------------------------------

describe('09 - prepare_version.js wiring', function () {

    it('declares the gate as self.checkRoadmapConsistency', function () {
        assert.match(PREPARE_SRC, /self\.checkRoadmapConsistency = function\(done\)/);
    });

    it('requires the standalone checker module', function () {
        assert.match(PREPARE_SRC, /require\('\.\/check_roadmap_consistency'\)/);
    });

    it('skips on alpha publishes', function () {
        var blk = PREPARE_SRC.substring(PREPARE_SRC.indexOf('self.checkRoadmapConsistency'));
        blk = blk.substring(0, 400);
        assert.ok(blk.indexOf("self.git.tag === 'alpha'") > -1,
            'the roadmap gate must skip alpha publishes');
    });

    it('is declared after checkReadmeFreshness and before checkDefFrameworkConsistency (run order = declaration order)', function () {
        var readmeIdx  = PREPARE_SRC.indexOf('self.checkReadmeFreshness = function');
        var roadmapIdx = PREPARE_SRC.indexOf('self.checkRoadmapConsistency = function');
        var defIdx     = PREPARE_SRC.indexOf('self.checkDefFrameworkConsistency = function');
        assert.ok(readmeIdx > -1 && roadmapIdx > -1 && defIdx > -1);
        assert.ok(readmeIdx < roadmapIdx, 'roadmap gate must come after the README gate');
        assert.ok(roadmapIdx < defIdx, 'roadmap gate must come before the def_framework gate');
    });
});
