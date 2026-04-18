#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Pre-pack leak check.
 *
 * Runs as the `prepack` npm lifecycle hook. Before the tarball is assembled,
 * this script re-runs `npm pack --dry-run --json --ignore-scripts` and fails
 * the publish if the pack listing is dirty on either of two axes:
 *
 *   1. Path-level: any file named `CLAUDE.md` or `.claude*`.
 *   2. Content-level: any text file containing a private-token pattern
 *      (phone, private email, private address, private domain). The
 *      co-author's legal name is allowed in authoring/contributing files
 *      (README, AUTHORS, GOVERNANCE, CONTRIBUTING, package.json
 *      contributors, scaffolding template, framework AUTHORS, framework
 *      plugin package.json authors) — see ATTRIBUTION_PATHS.
 *
 * `--ignore-scripts` prevents recursion into the `prepare` script (which
 * would otherwise re-invoke `prepare_version.js` and commit a "Prerelease
 * update").
 *
 * Exit codes:
 *   0  — pack listing and contents are clean
 *   1  — leakage detected OR check itself errored (fail closed)
 */

var execSync = require('child_process').execSync;
var fs       = require('fs');

var PATH_PATTERN = /(^|\/)(CLAUDE\.md|\.claude[a-z]*)/i;

// Authoring/contributing context — files where the co-author's legal name
// is allowed (public attribution: README, AUTHORS, GOVERNANCE, CONTRIBUTING,
// package.json contributors, scaffolding template, framework AUTHORS,
// framework plugin package.json authors).
var ATTRIBUTION_PATHS = /^(AUTHORS|CONTRIBUTING\.md|GOVERNANCE\.md|README\.md|package\.json|resources\/package\.json\.template|framework\/v[^/]+\/AUTHORS|framework\/v[^/]+\/core\/plugins\/lib\/[^/]+\/package\.json)$/;

// Private tokens that must not appear in published tarball contents.
// Keep patterns narrow — bare words like "Freelancer" are too broad and
// produce false positives on legitimate content; the domain form
// `example.com` catches the leak-relevant variant.
var CONTENT_TOKENS = [
    { name: 'private phone',   pattern: /0618178647/ },
    { name: 'private email',   pattern: /[\w.+-]*etouman@rhinostone/i },
    { name: 'private address', pattern: /Boulevard\s+Arago/i },
    { name: 'private domain',  pattern: /freelancer\.app/i },
    { name: 'co-author legal name',
                               pattern: /Fabrice\s+Delaneau/i,
                               allowIn: ATTRIBUTION_PATHS }
];

// Heuristic: only read files that are likely text. Saves time on binary
// assets (images, compiled JARs, compressed .br/.gz) and prevents
// pattern matches from random byte sequences.
var TEXT_EXT = /\.(md|txt|json|js|mjs|cjs|ts|tsx|jsx|html|htm|css|sass|scss|less|sh|bash|zsh|yaml|yml|xml|svg|csv|d\.ts|mapping|conf|ini|toml|env|template)$/i;
var TEXT_BASENAME = /^(AUTHORS|LICENSE|COPYING|CHANGELOG|README|NOTICE|CONTRIBUTING|GOVERNANCE|Makefile|\.npmignore|\.gitignore|\.eslintrc|\.editorconfig)(\.[^.]+)?$/;

// Scanner scripts contain the token patterns themselves — skip them to
// avoid self-matches. Future maintainers: add any new scanner files here.
var SELF_EXCLUDE = {
    'script/check_no_claude_leak.js': true,
    'script/prepare_version.js':      true
};
// Files larger than this are skipped — production binaries and bundles
// don't warrant a byte-by-byte scan.
var MAX_SCAN_BYTES = 2 * 1024 * 1024;

function isTextPath(p) {
    if (TEXT_EXT.test(p)) return true;
    var base = p.split('/').pop();
    if (TEXT_BASENAME.test(base)) return true;
    return false;
}

function scanContent(path) {
    var stat;
    try { stat = fs.statSync(path); } catch (e) { return []; }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return [];

    var content;
    try { content = fs.readFileSync(path, 'utf8'); } catch (e) { return []; }

    var hits = [];
    for (var i = 0; i < CONTENT_TOKENS.length; i++) {
        if (CONTENT_TOKENS[i].allowIn && CONTENT_TOKENS[i].allowIn.test(path)) continue;
        if (CONTENT_TOKENS[i].pattern.test(content)) {
            hits.push(CONTENT_TOKENS[i].name);
        }
    }
    return hits;
}

try {
    var raw = execSync('npm pack --dry-run --json --ignore-scripts', {
        stdio: ['ignore', 'pipe', 'pipe']
    }).toString();

    var parsed = JSON.parse(raw);
    var pathMatches = [];
    var contentMatches = [];

    for (var i = 0; i < parsed.length; i++) {
        var files = parsed[i].files || [];
        for (var j = 0; j < files.length; j++) {
            var p = files[j].path;

            if (PATH_PATTERN.test(p)) {
                pathMatches.push(p);
            }

            if (isTextPath(p) && !SELF_EXCLUDE[p]) {
                var hits = scanContent(p);
                for (var k = 0; k < hits.length; k++) {
                    contentMatches.push(p + ' — ' + hits[k]);
                }
            }
        }
    }

    var failed = false;

    if (pathMatches.length > 0) {
        console.error('[prepack] ERROR: local-tool configuration paths in pack listing:');
        for (var a = 0; a < pathMatches.length; a++) {
            console.error('  - ' + pathMatches[a]);
        }
        console.error('[prepack] Fix .npmignore (or package.json "files") before publishing.');
        failed = true;
    }

    if (contentMatches.length > 0) {
        if (failed) console.error('');
        console.error('[prepack] ERROR: Private tokens in pack contents:');
        for (var b = 0; b < contentMatches.length; b++) {
            console.error('  - ' + contentMatches[b]);
        }
        console.error('[prepack] Scrub these files before publishing.');
        failed = true;
    }

    if (failed) {
        process.exit(1);
    }

    console.log('[prepack] OK: pack listing and contents are clean.');
    process.exit(0);
} catch (err) {
    console.error('[prepack] Check failed: ' + (err.message || err));
    console.error('[prepack] Failing closed — investigate before publishing.');
    process.exit(1);
}
