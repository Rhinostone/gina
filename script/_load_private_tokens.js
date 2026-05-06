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
 * The caller passes its `attributionPathPattern` (the regex matching
 * authoring/contributing files where a token like a legal name is
 * allowed). Entries with `allowInAttribution: true` get that pattern
 * attached as `allowIn`, mirroring the original hardcoded shape.
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
 * @param {RegExp} attributionPathPattern
 * @returns {Array<{name: string, pattern: RegExp, allowIn?: RegExp}>}
 */

var fs   = require('fs');
var path = require('path');

module.exports = function loadPrivateTokens(attributionPathPattern) {
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
};
