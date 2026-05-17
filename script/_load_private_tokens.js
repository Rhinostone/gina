'use strict';

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Shared loader for the maintainer-local private-token sidecar used by
 * `script/check_no_local_leak.js` (prepack hook) and the leak-scan
 * function inside `script/prepare_version.js` (prepare hook).
 *
 * Reads `script/.private-tokens.json` (gitignored, never published to npm)
 * and returns a list of { name, pattern, allowIn? } entries the calling
 * script feeds into its content scanner. Sidecar format:
 *
 *   {
 *     "tokens": [
 *       { "name": "...", "pattern": "<regex string>", "flags": "i",
 *         "allowInAttribution": true|false }
 *     ]
 *   }
 *
 * Also owns the `ATTRIBUTION_PATHS` regex — the path pattern matching
 * authoring/contributing files where a token marked `allowInAttribution`
 * is permitted (public attribution: README, AUTHORS, GOVERNANCE,
 * CONTRIBUTING, package.json contributors, scaffolding template,
 * framework AUTHORS, framework plugin package.json authors at one or two
 * directory levels under `core/plugins/lib/`). Exposed as
 * `loadPrivateTokens.ATTRIBUTION_PATHS` so any new scanner needing the
 * same allowance can reference it without redeclaring; entries marked
 * `allowInAttribution: true` get it attached as `allowIn`.
 *
 * Callers may pass an override; when omitted, the exported default is
 * used. Both shipping scanners use the default — keeping the regex in
 * one place is the whole point of the consolidation.
 *
 * If the sidecar is absent or malformed, returns an empty array. The
 * caller's path-level scan (CLAUDE.md / .claude*) still runs unchanged;
 * only content-level scanning is silenced. This matches the precedent
 * of `script/.local-sync-targets.json` (silent no-op when absent).
 *
 * Fresh-clone recovery (new machine, restored backup): recreate the
 * sidecar from a personal backup outside the repo, or rebuild it
 * from the schema above before running stable publish.
 *
 * @param {RegExp} [attributionPathPattern] - optional override of the
 *   exported ATTRIBUTION_PATHS default.
 * @returns {Array<{name: string, pattern: RegExp, allowIn?: RegExp}>}
 */

var fs   = require('fs');
var path = require('path');

// Authoring/contributing context — see JSDoc above. Matches one or two
// directory levels under `core/plugins/lib/` so namespace dirs like
// `core/plugins/lib/security-headers/<plugin>/package.json` are allowed
// alongside the historical flat shape `core/plugins/lib/<plugin>/package.json`.
var ATTRIBUTION_PATHS = /^(AUTHORS|CONTRIBUTING\.md|GOVERNANCE\.md|README\.md|package\.json|resources\/package\.json\.template|framework\/v[^/]+\/AUTHORS|framework\/v[^/]+\/core\/plugins\/lib\/[^/]+(\/[^/]+)?\/package\.json)$/;

function loadPrivateTokens(attributionPathPattern) {
    if (!attributionPathPattern) {
        attributionPathPattern = ATTRIBUTION_PATHS;
    }
    var sidecar = path.join(__dirname, '.private-tokens.json');
    if (!fs.existsSync(sidecar)) {
        return [];
    }

    var raw;
    try {
        raw = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    } catch (err) {
        console.error('[private-tokens] WARNING: failed to parse ' + sidecar + ': ' + (err.message || err));
        return [];
    }

    var entries = (raw && raw.tokens) || [];
    var out = [];
    for (var i = 0; i < entries.length; i++) {
        var t = entries[i];
        if (!t || typeof t.name !== 'string' || typeof t.pattern !== 'string') {
            continue;
        }
        var flags = typeof t.flags === 'string' ? t.flags : '';
        var entry = { name: t.name, pattern: new RegExp(t.pattern, flags) };
        if (t.allowInAttribution && attributionPathPattern) {
            entry.allowIn = attributionPathPattern;
        }
        out.push(entry);
    }
    return out;
}

module.exports = loadPrivateTokens;
module.exports.ATTRIBUTION_PATHS = ATTRIBUTION_PATHS;
