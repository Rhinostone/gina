#!/usr/bin/env node
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/check_changie_entries.js
 *
 * Pre-commit guard for `.changes/unreleased/*.yaml` entries. Enforces the
 * rule captured in `llms.txt` #126 (formerly #66): every changie body must be
 * single-quoted, double-quoted, or a block scalar (`>` / `|`). Unquoted
 * bodies silently truncate at ` #` (YAML comment marker) or break at `:`
 * (mapping-values error), losing entire paragraphs from the rendered
 * changelog.
 *
 * Wired into `.githooks/pre-commit` alongside the local-tool-path leak
 * check (#S5). Also runnable standalone:
 *
 *   node script/check_changie_entries.js .changes/unreleased/*.yaml
 *
 * Exit 0 when every file passes; exit 1 with per-file reasons on failure.
 *
 * **Checks performed per file:**
 *
 *   1. `kind:` field is present and matches one of
 *      {Added, Changed, Deprecated, Removed, Fixed, Security}.
 *   2. `body:` field is present and uses one of the three safe forms:
 *      - single-quoted (`body: '...'` — possibly multi-line)
 *      - double-quoted (`body: "..."` — possibly multi-line)
 *      - block scalar (`body: >-` / `body: |-` / `body: >` / `body: |`)
 *   3. `time:` field is present with an ISO-8601-ish shape.
 *   4. For single-quoted bodies: every literal `'` inside must be
 *      doubled (`''`) and the body must terminate before the `time:` key.
 *   5. When the FILENAME encodes a known tracker id (`Fixed-b406-...`),
 *      the body must cite that id (`#B406`). Filename and commit message
 *      carry the id; only the body is rendered into the published
 *      CHANGELOG, so an id present in the first two and absent from the
 *      third ships an UNNUMBERED entry and anyone triaging by id gets a
 *      false zero. See #B410 — measured 2026-08-23 across the full
 *      937-fragment history: ~60 shipped entries are unnumbered this way,
 *      so this is the common case, not an anomaly.
 *
 * **Not checked** (intentional):
 *
 *   - Content of the body beyond structural safety and the id cross-check
 *     above — we don't validate Markdown, link syntax, or commit SHA format.
 *   - Historical files not staged for this commit — the hook only runs
 *     on `git diff --cached --name-only --diff-filter=AM` output.
 */

'use strict';

var fs = require('fs');

var KINDS = new Set(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);

var KIND_RE = '(?:Added|Changed|Deprecated|Removed|Fixed|Security)';

/**
 * Filename shape carrying a candidate id: `<Kind>-<token>-<slug>.yaml`,
 * where the token is letter-led and contains at least one digit.
 * @constant {RegExp}
 */
var ID_TOKEN_RE = new RegExp('^' + KIND_RE + '-([a-z][a-z0-9]*[0-9][a-z0-9]*)-');

/**
 * Tracker-id families in use. An explicit allowlist rather than a generic
 * `[a-z]+\d+` shape BECAUSE the generic form false-positives on real
 * filenames — measured over all 937 historical fragments, it fires on
 * `express5` (Express 5), `npm12` (npm 12) and `s3` (the S3 adapter),
 * none of which are ids. A false positive BLOCKS a commit via pre-commit;
 * a false negative merely ships what we already ship today, so the
 * asymmetry says err toward skipping. `h` is excluded as unresolved.
 * ⚠️ `s` is deliberately ABSENT even though `#S5`/`#S7` are real ids —
 * adding it would make `Added-s3-storage-adapter.yaml` demand a `#S3`
 * that does not exist, blocking a legitimate commit. Same reasoning
 * retires any future urge to add `express` or `npm`.
 * Longer families precede their own prefixes so `ms6` cannot bind as `m`.
 * @constant {RegExp}
 */
var ID_FAMILY_RE = /^(a11y|comply|csrf|i18n|maint|spa|tpl|hdr|fin|obs|ms|cc|ce|cn|kv|zt|b|d|m|p|r)[0-9]+$/;

/**
 * Extracts the tracker id a fragment FILENAME encodes, if any.
 *
 * @param   {string} basename  e.g. `Fixed-b406-boot-frame-ownership.yaml`
 * @returns {string} the id (`'#B406'`), or `''` when the filename encodes none
 * @example
 * idFromFilename('Fixed-b406-boot-frame-ownership.yaml'); // '#B406'
 * idFromFilename('Fixed-a11y3-error-document-conformance.yaml'); // '#A11Y3'
 * idFromFilename('Fixed-express5-engine-boot.yaml');       // '' (not an id)
 * idFromFilename('Fixed-20260327-some-slug.yaml');         // '' (date, not an id)
 */
function idFromFilename(basename) {
    var m = ID_TOKEN_RE.exec(basename);
    if (!m) { return ''; }
    if (!ID_FAMILY_RE.test(m[1])) { return ''; }
    return '#' + m[1].toUpperCase();
}

/**
 * Validates a single file's content. Returns an empty string on success,
 * otherwise a single-line reason suitable for pre-commit output.
 *
 * @param  {string} path
 * @param  {string} text
 * @returns {string} error reason, or '' when valid
 */
function validate(path, text) {
    // 1. kind: line — the FIRST line typically.
    var kindMatch = text.match(/^kind:\s*(\S+)\s*$/m);
    if (!kindMatch) { return 'missing `kind:` field'; }
    if (!KINDS.has(kindMatch[1])) {
        return 'kind `' + kindMatch[1] + '` is not one of ' +
               Array.from(KINDS).sort().join(', ');
    }

    // 2. time: line.
    var timeMatch = text.match(/^time:\s*\d{4}-\d{2}-\d{2}T/m);
    if (!timeMatch) { return 'missing `time:` field or unrecognised ISO-8601 shape'; }

    // 3. body: line — must be present before time:.
    // Find the line that starts with `body:`.
    var bodyLineIdx = text.search(/^body:\s*/m);
    if (bodyLineIdx < 0) { return 'missing `body:` field'; }

    // Slice from `body:` to the start of `time:` (exclusive) to analyse
    // the body scalar in isolation. If time: appears before body: that's
    // a different shape failure — catch it.
    var timeLineIdx = text.search(/^time:\s*/m);
    if (timeLineIdx < bodyLineIdx) {
        return '`time:` appears before `body:` — check field order';
    }

    var bodyBlock = text.slice(bodyLineIdx, timeLineIdx);
    // Take the first line of the body block — that's where the scalar
    // starts, and we classify by leading character.
    var firstNl = bodyBlock.indexOf('\n');
    var firstLine = firstNl < 0 ? bodyBlock : bodyBlock.slice(0, firstNl);

    // Strip the `body: ` prefix to see the scalar's lead character.
    var afterColon = firstLine.replace(/^body:\s*/, '');

    if (afterColon.length === 0) {
        return '`body:` value is empty';
    }

    var leader = afterColon.charAt(0);

    var structural;

    // Block scalar — YAML handles escaping internally, no further check.
    if (leader === '>' || leader === '|') {
        structural = '';

    // Double-quoted scalar — YAML uses \-escaping; structurally safer
    // than single-quoted for content with apostrophes. Accept as-is.
    // Spot-check: it must terminate with an unescaped `"` before `time:`.
    } else if (leader === '"') {
        structural = doubleQuoteTerminates(bodyBlock)
            ? ''
            : 'double-quoted `body:` does not terminate before `time:`';

    // Single-quoted scalar — THE safe default per llms.txt #126 (formerly #66). But it has
    // two traps: (a) literal `'` must be doubled as `''`, and (b) the
    // body must terminate with `'` before the next top-level key.
    } else if (leader === "'") {
        structural = validateSingleQuotedBody(bodyBlock);

    // Everything else is an unquoted scalar — rejected unconditionally
    // because of the ` #` comment-marker and `:` mapping-values traps.
    } else {
        return 'unquoted `body:` — use single quotes (body: \'...\') per llms.txt #126';
    }

    if (structural) { return structural; }

    // 5. The body must cite the tracker id its own filename encodes (#B410).
    return validateBodyCitesId(path, bodyBlock);
}

/**
 * Check 5 — when the filename encodes a tracker id, the body must cite it.
 *
 * The id is normally present in the filename AND the commit message, but
 * only the BODY is rendered into `CHANGELOG.md` and the published tarball,
 * so an id missing here ships an unnumbered entry that no id-based triage
 * can find. Filenames encoding no recognised id are skipped, never failed.
 *
 * @param   {string} path       fragment path (only its basename is read)
 * @param   {string} bodyBlock  the `body:` → `time:` slice
 * @returns {string} error reason, or '' when valid
 * @inner
 */
function validateBodyCitesId(path, bodyBlock) {
    var basename = String(path).replace(/^.*[\\/]/, '');
    var id       = idFromFilename(basename);
    if (!id) { return ''; }
    if (bodyBlock.indexOf(id) >= 0) { return ''; }
    return 'filename encodes ' + id + ' but `body:` never cites it — only the body ' +
           'renders into CHANGELOG.md, so the published entry would be UNNUMBERED ' +
           'and id-based triage gets a false zero (#B410). Add ' + id +
           ' to the body, or rename the file if it tracks no id.';
}

/**
 * Walks a single-quoted body scalar, ensuring every `'` is either part
 * of a `''` escape or the final terminator that ends the scalar before
 * the next top-level key.
 *
 * Returns '' when valid, otherwise a reason.
 *
 * @inner
 */
function validateSingleQuotedBody(bodyBlock) {
    // Find the opening `'` position after `body: `.
    var m = bodyBlock.match(/^body:\s*'/);
    if (!m) { return 'single-quoted `body:` has malformed leading quote'; }
    var start = m[0].length;
    var i = start;
    var len = bodyBlock.length;
    while (i < len) {
        if (bodyBlock.charAt(i) === "'") {
            // Look ahead — doubled quote `''` is the escape for a literal `'`.
            if (i + 1 < len && bodyBlock.charAt(i + 1) === "'") {
                i += 2; // consume both
                continue;
            }
            // Lone `'` — treat as terminator. Whatever follows must be
            // whitespace + newline (no trailing content on the body line).
            var trailing = bodyBlock.slice(i + 1);
            if (!/^[ \t]*\r?\n?$/.test(trailing)) {
                // Some non-whitespace content on the same line after
                // the terminator — that means the first `'` we took as
                // the terminator is actually an UNESCAPED literal, and
                // the real terminator (if any) is later.
                return 'unescaped `\'` in single-quoted body (should be `\'\'`)';
            }
            return ''; // clean termination
        }
        i += 1;
    }
    // Fell off the end without hitting a closing `'`.
    return 'single-quoted `body:` never terminates before `time:` — missing closing `\'`';
}

/**
 * Cheaper variant of the above for double-quoted bodies — looks for an
 * unescaped `"` followed by whitespace/newline.
 *
 * @inner
 */
function doubleQuoteTerminates(bodyBlock) {
    var m = bodyBlock.match(/^body:\s*"/);
    if (!m) { return false; }
    var start = m[0].length;
    var i = start;
    var len = bodyBlock.length;
    while (i < len) {
        var c = bodyBlock.charAt(i);
        if (c === '\\') { i += 2; continue; }
        if (c === '"') {
            var trailing = bodyBlock.slice(i + 1);
            return /^[ \t]*\r?\n?$/.test(trailing);
        }
        i += 1;
    }
    return false;
}


// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
    var files = argv.slice(2);
    if (files.length === 0) {
        process.stderr.write(
            '[check-changie] no files passed; usage: node script/check_changie_entries.js <file>...\n'
        );
        return 0; // pre-commit may call us with no args when no changes files are staged
    }

    var failures = [];
    files.forEach(function (file) {
        var text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch (e) {
            failures.push(file + ': cannot read file (' + e.code + ')');
            return;
        }
        var reason = validate(file, text);
        if (reason) {
            failures.push(file + ': ' + reason);
        }
    });

    if (failures.length === 0) { return 0; }

    process.stderr.write('\n[check-changie] changie entry validation failed:\n');
    failures.forEach(function (line) {
        process.stderr.write('  - ' + line + '\n');
    });

    // Print only the footers that match the failures actually seen — the
    // quoting advice is misleading noise on a pure id-citation failure.
    var anyShape = failures.some(function (l) { return l.indexOf('quoted') >= 0; });
    var anyId    = failures.some(function (l) { return l.indexOf('#B410') >= 0; });

    if (anyShape) {
        process.stderr.write('\n[check-changie] See llms.txt #126 for the safe body shapes.\n');
        process.stderr.write('[check-changie] Every body must be single-quoted (`body: \'...\'`), double-quoted,\n');
        process.stderr.write('[check-changie] or a block scalar (`body: >-` / `body: |-`). Unquoted bodies are\n');
        process.stderr.write('[check-changie] rejected because they silently truncate at ` #` (YAML comment\n');
        process.stderr.write('[check-changie] marker) or break parsing on `:` (mapping-values error).\n');
    }
    if (anyId) {
        process.stderr.write('\n[check-changie] A fragment whose FILENAME names a tracker id must cite that\n');
        process.stderr.write('[check-changie] id in its `body:` — the body is the only part rendered into\n');
        process.stderr.write('[check-changie] CHANGELOG.md and the published tarball. See #B410.\n');
    }
    return 1;
}

if (require.main === module) {
    process.exit(main(process.argv));
}

module.exports = {
    validate:                    validate,
    validateSingleQuotedBody:    validateSingleQuotedBody,
    doubleQuoteTerminates:       doubleQuoteTerminates,
    idFromFilename:              idFromFilename,
    validateBodyCitesId:         validateBodyCitesId
};
