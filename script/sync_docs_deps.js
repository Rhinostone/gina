#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/sync_docs_deps.js
 *
 * Fail-closed decision helper for `script/post_publish.js → syncDocs`.
 *
 * After a stable publish, `syncDocs` bumps the docs repo's
 * `devDependencies.gina` to the just-published version and regenerates
 * `package-lock.json`. When the npm registry's eventual-consistency window
 * leaves the new version unresolvable past the retry budget (see
 * `retry_lockfile_sync.js`), the regen fails and `package-lock.json` is left
 * pinning the PREVIOUS version while `package.json` has already been bumped to
 * the new one. Committing + merging that mismatched pair to docs `main` breaks
 * the next Vercel `npm ci` deploy (the recurring failure on
 * `gina@0.3.7` / `gina@0.3.9` / `gina@0.3.11` / `gina@0.4.0`).
 *
 * This helper makes that path FAIL CLOSED: on a regen failure it reads the
 * version still pinned in the unregenerated `package-lock.json` and reverts
 * `devDependencies.gina` to match it, so the committed pair stays internally
 * consistent and the docs CONTENT still deploys — only the cosmetic version
 * badge lags until a follow-up bump. If the locked version cannot be read, the
 * merge is skipped entirely rather than ship a mismatch.
 *
 * Both functions are pure (no I/O) so the decision is unit-testable without a
 * real docs repo or registry — the caller passes in the lockfile content and
 * the retry result.
 */

'use strict';


/**
 * Extract the `gina` version pinned in a docs-repo `package-lock.json`.
 *
 * Handles all three lockfile shapes: `lockfileVersion` 2/3 store packages in a
 * path-keyed `packages` map; `lockfileVersion` 1 (and the legacy half of a
 * `lockfileVersion` 2 file) uses a flat `dependencies` map. The `packages` map
 * is preferred when present.
 *
 * @param {string|null} lockfileContent  raw `package-lock.json` text
 * @returns {string|null} the pinned gina version (e.g. `'0.3.15'`), or `null`
 *   when the lockfile is absent, unparseable, or carries no gina entry.
 *
 * @example
 *   readLockedGina(fs.readFileSync('package-lock.json', 'utf8')); // '0.3.15'
 *   readLockedGina(null);          // null
 *   readLockedGina('{ not json');  // null
 */
function readLockedGina(lockfileContent) {
    if (!lockfileContent) {
        return null;
    }
    var parsed;
    try {
        parsed = JSON.parse(lockfileContent);
    } catch (e) {
        return null;
    }
    // lockfileVersion 2/3 — path-keyed packages map.
    if (
        parsed.packages
        && parsed.packages['node_modules/gina']
        && parsed.packages['node_modules/gina'].version
    ) {
        return parsed.packages['node_modules/gina'].version;
    }
    // lockfileVersion 1 (and the legacy half of a v2 file) — flat dependencies map.
    if (
        parsed.dependencies
        && parsed.dependencies.gina
        && parsed.dependencies.gina.version
    ) {
        return parsed.dependencies.gina.version;
    }
    return null;
}


/**
 * Decide what `devDependencies.gina` should be set to, and whether the
 * docs `develop → main` merge is safe, given the outcome of the lockfile regen.
 *
 * @param {object}        opts
 * @param {object}        opts.lockResult       result from `retryWithBackoff` — `{ ok, attempts, lastErr }`
 * @param {string|null}   [opts.lockfileContent] raw `package-lock.json` text (read only on the failure path)
 * @param {string}        opts.newVersion       the just-published gina version (no `^`)
 * @returns {{ devDep: (string|null), mergeToMain: boolean, reason: string }}
 *   `devDep` is the spec to set (`'^x.y.z'`), or `null` when no consistent
 *   spec can be guaranteed; `mergeToMain` is `false` only when shipping the
 *   merge would risk a mismatched pair; `reason` is a stable diagnostic tag.
 *
 * @example
 *   // regen succeeded — lockfile pins the new version, merge is safe
 *   resolveDocsDepState({ lockResult: { ok: true }, newVersion: '0.4.0' });
 *   // → { devDep: '^0.4.0', mergeToMain: true, reason: 'lockfile-fresh' }
 *
 *   // regen failed (registry lag), lockfile still pins the old version —
 *   // revert the devDep to match so the committed pair stays consistent
 *   resolveDocsDepState({
 *       lockResult: { ok: false },
 *       lockfileContent: oldLockfileText, // pins gina@0.3.15
 *       newVersion: '0.4.0'
 *   });
 *   // → { devDep: '^0.3.15', mergeToMain: true, reason: 'registry-lag-reverted' }
 *
 *   // regen failed AND the locked version is unreadable — fail closed
 *   resolveDocsDepState({ lockResult: { ok: false }, lockfileContent: null, newVersion: '0.4.0' });
 *   // → { devDep: null, mergeToMain: false, reason: 'manual-recovery' }
 */
function resolveDocsDepState(opts) {
    opts = opts || {};
    var lockResult = opts.lockResult || {};
    var newVersion = opts.newVersion;

    // Regen succeeded → package-lock.json now pins the new version; the devDep
    // already set to ^new is consistent and the merge is safe.
    if (lockResult.ok) {
        return { devDep: '^' + newVersion, mergeToMain: true, reason: 'lockfile-fresh' };
    }

    // Regen failed (registry lag). package-lock.json was NOT regenerated and
    // still pins the previously-locked version. Revert the devDep to match it
    // so the committed pair is internally consistent and content still deploys.
    var locked = readLockedGina(opts.lockfileContent);
    if (locked) {
        return { devDep: '^' + locked, mergeToMain: true, reason: 'registry-lag-reverted' };
    }

    // Cannot determine the locked version → cannot guarantee a consistent pair.
    // Fail closed: skip the merge so no mismatch reaches docs main.
    return { devDep: null, mergeToMain: false, reason: 'manual-recovery' };
}


module.exports = {
    readLockedGina: readLockedGina,
    resolveDocsDepState: resolveDocsDepState
};
