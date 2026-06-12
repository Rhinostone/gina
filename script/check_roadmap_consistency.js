#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/check_roadmap_consistency.js
 *
 * Pre-publish guard that asserts ROADMAP.md does not contradict the
 * stable version being released. Wired into prepare_version.js as
 * `self.checkRoadmapConsistency`, between `checkReadmeFreshness` and
 * `checkDefFrameworkConsistency`. Also runnable standalone:
 *
 *   node script/check_roadmap_consistency.js
 *
 * The check fires on stable publishes only — alpha cuts are intermediate
 * and never make a roadmap row stale (rows reference stable versions or
 * `X.Y.x` buckets). The skip is signalled via the `npm_config_tag` env
 * var or `--tag=alpha` on the argv, mirroring check_readme_freshness.js.
 *
 * Three rules, scanned over status rows (lines starting `| 📋 |` or
 * `| ✅ |`) and exact backtick-wrapped version tokens:
 *
 *   1. ABORT — an open (📋) row references the exact version being
 *      released. The release is about to ship without that item, so the
 *      row becomes a lie the moment the tag lands. Re-target the row
 *      (e.g. to the `X.Y.x` bucket) or reword the prose reference.
 *      Bucket tokens (`0.5.x`) never trip this rule by design — they
 *      are the sanctioned re-target form.
 *
 *   2. ABORT — a done (✅) row references a version NEWER than the one
 *      being released. A feature cannot have shipped in a version that
 *      does not exist yet; this catches target-version labels left on
 *      rows that were flipped to ✅ before the cut. Only tokens sharing
 *      the released version's MAJOR are compared, so dependency
 *      versions in prose (e.g. a `2.x` template-engine floor or a
 *      two-digit uuid major) cannot false-positive.
 *
 *   3. WARN — no timeline row marks the released version ✅
 *      (`` `X.Y.Z` ✅ ``). The timeline is coarse narrative, so this is
 *      advisory only and never aborts.
 *
 * Why this gate exists: a roadmap-accuracy sweep (2026-06-12) found two
 * recurring drift classes that had survived multiple cuts — ✅ rows
 * carrying their old TARGET version instead of the actual ship version
 * (readers were told a feature needed `0.5.0` when `0.4.0` sufficed),
 * and 📋 rows still targeting versions that had shipped without them
 * (ten rows across `0.4.0`/`0.5.0`). Both are facts that only become
 * checkable at cut time, and manual checklist steps decay (see the
 * README-freshness precedent). This enforces them automatically.
 *
 * Failure mode: fail-closed on rules 1-2 (abort the publish with the
 * offending rows listed). A missing or unreadable ROADMAP.md also
 * aborts — investigate rather than publish with unverified state.
 */

'use strict';

var fs = require('fs');
var nodePath = require('path');

/**
 * Regex for an exact backtick-wrapped version token: `X.Y.Z` with an
 * optional `-alpha.N` suffix. Deliberately does NOT match:
 *   - bucket tokens (`0.5.x`) — the sanctioned open-row re-target form;
 *   - range-prefixed tokens (`^2.3.0`, `~1.2.0`) — dependency floors;
 *   - bare (un-backticked) versions in prose — too noisy to police.
 *
 * @constant {RegExp}
 */
var VERSION_TOKEN_RE = /`(\d+\.\d+\.\d+(?:-alpha\.\d+)?)`/g;

/**
 * Regex matching a status row of any roadmap table — a markdown table
 * line whose first cell is the 📋 (open) or ✅ (done) marker.
 *
 * @constant {RegExp}
 */
var STATUS_ROW_RE = /^\|\s*(📋|✅)\s*\|/;

/**
 * Extract every exact backtick-wrapped version token from a line.
 *
 * @param {string} line  one roadmap line
 * @returns {string[]} version strings without backticks (may be empty)
 * @example
 * extractVersionTokens('| ✅ | x | `0.4.0` | 2026-05-29 |'); // ['0.4.0']
 * extractVersionTokens('floor `^2.3.0` and bucket `0.5.x`'); // []
 */
function extractVersionTokens(line) {
    var out = [];
    var m;
    VERSION_TOKEN_RE.lastIndex = 0;
    while ((m = VERSION_TOKEN_RE.exec(line || '')) !== null) {
        out.push(m[1]);
    }
    return out;
}

/**
 * Compare two version strings of the `X.Y.Z[-alpha.N]` shape.
 * A prerelease sorts BEFORE its stable (`0.5.0-alpha.2` < `0.5.0`).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} -1 when a < b, 0 when equal, 1 when a > b
 * @example
 * compareVersions('0.5.1', '0.5.0');         // 1
 * compareVersions('0.5.0-alpha.1', '0.5.0'); // -1
 */
function compareVersions(a, b) {
    var pa = String(a).split('-');
    var pb = String(b).split('-');
    var na = pa[0].split('.').map(Number);
    var nb = pb[0].split('.').map(Number);
    for (var i = 0; i < 3; i++) {
        if ((na[i] || 0) > (nb[i] || 0)) return 1;
        if ((na[i] || 0) < (nb[i] || 0)) return -1;
    }
    // numeric cores equal — a bare version outranks its prereleases
    if (!pa[1] && pb[1]) return 1;
    if (pa[1] && !pb[1]) return -1;
    if (!pa[1] && !pb[1]) return 0;
    var aa = Number((pa[1].match(/\d+$/) || [0])[0]);
    var ab = Number((pb[1].match(/\d+$/) || [0])[0]);
    if (aa > ab) return 1;
    if (aa < ab) return -1;
    return 0;
}

/**
 * Parse the roadmap content into status rows.
 *
 * @param {string} content  full ROADMAP.md content
 * @returns {Array<{status: string, lineNo: number, line: string, versions: string[]}>}
 */
function parseStatusRows(content) {
    var rows = [];
    var lines = String(content || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(STATUS_ROW_RE);
        if (!m) continue;
        rows.push({
            status: m[1],
            lineNo: i + 1,
            line: lines[i],
            versions: extractVersionTokens(lines[i])
        });
    }
    return rows;
}

/**
 * Run the full consistency check over a roadmap content string.
 * Pure function — callers supply the content and the targeted version,
 * so tests need no filesystem.
 *
 * @param {object} opts
 * @param {string} opts.roadmapContent   full ROADMAP.md content
 * @param {string} opts.targetedVersion  stable version being released (e.g. "0.5.0")
 * @returns {{ok: boolean, failures: Array<{rule: string, lineNo: number, excerpt: string}>, warnings: string[]}}
 */
function check(opts) {
    opts = opts || {};
    var content = opts.roadmapContent;
    var version = opts.targetedVersion;
    var failures = [];
    var warnings = [];
    var targetMajor = Number(String(version).split('.')[0]);

    var rows = parseStatusRows(content);
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        for (var v = 0; v < row.versions.length; v++) {
            var token = row.versions[v];
            if (row.status === '📋' && token === version) {
                failures.push({
                    rule: 'open-row-references-released-version',
                    lineNo: row.lineNo,
                    excerpt: row.line.substring(0, 120)
                });
                break;
            }
            if (row.status === '✅'
                && Number(token.split('.')[0]) === targetMajor
                && compareVersions(token, version) > 0
            ) {
                failures.push({
                    rule: 'done-row-references-future-version',
                    lineNo: row.lineNo,
                    excerpt: row.line.substring(0, 120)
                });
                break;
            }
        }
    }

    // Rule 3 (warn-only): a timeline row should mark the release — `X.Y.Z` ✅
    var timelineMark = new RegExp('`' + String(version).replace(/\./g, '\\.') + '`\\s*✅');
    if (!timelineMark.test(String(content || ''))) {
        warnings.push('no timeline row marks `' + version + '` as released (`' + version + '` ✅) — coarse narrative only, not blocking');
    }

    return { ok: failures.length === 0, failures: failures, warnings: warnings };
}

/**
 * True when this invocation is part of an alpha publish. Mirrors
 * check_readme_freshness.js — `npm_config_tag` env var with an argv
 * fallback for direct script invocations.
 *
 * @returns {boolean}
 */
function isAlphaPublish() {
    if (process.env.npm_config_tag === 'alpha') return true;
    var argv = process.argv || [];
    for (var i = 0; i < argv.length; i++) {
        if (argv[i] === '--tag=alpha' || argv[i] === '--alpha') return true;
        if (argv[i] === '--tag' && argv[i + 1] === 'alpha') return true;
    }
    return false;
}

/**
 * CLI entry. Reads ROADMAP.md and the targeted version from the repo at
 * cwd (or the path given as the first positional argv). Returns 0 on
 * success, 1 on failure.
 *
 * @returns {number} exit code
 */
function main() {
    if (isAlphaPublish()) {
        console.log('[roadmap] Alpha publish — skipping roadmap consistency gate.');
        return 0;
    }

    var root = process.argv[2] && process.argv[2].indexOf('--') !== 0
        ? process.argv[2]
        : process.cwd();

    var content, version;
    try {
        content = fs.readFileSync(nodePath.join(root, 'ROADMAP.md'), 'utf8');
        version = JSON.parse(fs.readFileSync(nodePath.join(root, 'package.json'), 'utf8')).version;
    } catch (err) {
        console.error('[roadmap] ERROR: could not read ROADMAP.md / package.json: ' + (err.message || err));
        return 1;
    }

    var result = check({ roadmapContent: content, targetedVersion: version });

    for (var w = 0; w < result.warnings.length; w++) {
        console.warn('[roadmap] WARN: ' + result.warnings[w]);
    }

    if (result.ok) {
        console.log('[roadmap] OK: ROADMAP.md is consistent with releasing ' + version + '.');
        return 0;
    }

    console.error('[roadmap] ERROR: ROADMAP.md contradicts releasing ' + version + ' — aborting publish.');
    for (var f = 0; f < result.failures.length; f++) {
        var fail = result.failures[f];
        console.error('  [' + fail.rule + '] line ' + fail.lineNo + ': ' + fail.excerpt);
    }
    console.error('');
    console.error('  Fix shape:');
    console.error('    - open (📋) row naming ' + version + ': re-target it (e.g. to the `X.Y.x` bucket) or reword the reference;');
    console.error('    - done (✅) row naming a version newer than ' + version + ': stamp the actual ship version.');
    console.error('  Then commit on develop and re-run npm publish.');
    return 1;
}

module.exports = {
    extractVersionTokens: extractVersionTokens,
    compareVersions: compareVersions,
    parseStatusRows: parseStatusRows,
    check: check,
    isAlphaPublish: isAlphaPublish,
    main: main
};

if (require.main === module) {
    process.exit(main());
}
