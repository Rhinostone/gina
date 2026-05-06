#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/check_def_framework_consistency.js
 *
 * Pre-publish guard that asserts `~/.gina/main.json`'s `def_framework`
 * field points to a framework directory that exists on disk. Wired into
 * prepare_version.js as `self.checkDefFrameworkConsistency`, alongside
 * `checkNoLocalLeakage`, `checkPrivateTokenLeakage`, and
 * `checkReadmeFreshness`. Also runnable standalone:
 *
 *   node script/check_def_framework_consistency.js
 *
 * Background: v0.3.10 stable publish (2026-05-06) aborted at
 * `prepare_version.js → getSelectedVersion()` with `Cannot find module
 * '<gina>/framework/v0.3.9/helpers'` because main.json's scalar
 * `def_framework` had drifted to "0.3.9" while the framework dir on disk
 * was at v0.3.10-alpha.2. ~/.gina/0.3/settings.json and gina.db kv_store
 * had the same drift — all three stores agreed at "0.3.9", all three
 * lagged the disk by one full bump cycle. The drift root cause is queued
 * as a separate follow-up (a writer other than `bumpVersion` updates
 * the scalar inconsistently — distinct from the v0.3.7-alpha.6 →
 * 0.3.7-alpha.8 gina.db drift bug fixed in commit `34115799`). This gate
 * ensures any future drift surfaces with an actionable error message
 * BEFORE npm publish proceeds, instead of a deep MODULE_NOT_FOUND from
 * inside the script.
 *
 * Failure mode: fail-closed when main.json exists and `def_framework`
 * points to a nonexistent dir, or when the JSON is malformed, or when
 * `def_framework` is missing/non-string. Skips silently when main.json
 * itself does not exist (first install / fresh state).
 */

'use strict';

var fs       = require('fs');
var nodePath = require('path');

/**
 * Run the consistency check. Pure function modulo `fs.existsSync`,
 * `fs.readFileSync`, and `fs.readdirSync` — pass `fs` to swap the
 * driver in tests.
 *
 * @param   {object}   opts
 * @param   {string}   opts.ginaHomeDir  Absolute path to `~/.gina/` (no trailing slash).
 * @param   {string}   opts.ginaPath     Absolute path to the gina repo root (no trailing slash).
 * @param   {object}   [opts.fs]         Injected fs driver (defaults to node fs).
 * @returns {{ok: boolean, reason: string, defFramework: (string|null), frameworkDir: (string|null), presentDirs: string[]}}
 *
 * @example <caption>Drift detected</caption>
 * check({ ginaHomeDir: '/home/x/.gina', ginaPath: '/srv/gina' });
 * // { ok: false, reason: 'def_framework-drift', defFramework: '0.3.9',
 * //   frameworkDir: '/srv/gina/framework/v0.3.9', presentDirs: ['v0.3.10-alpha.2'] }
 *
 * @example <caption>Consistent state</caption>
 * check({ ginaHomeDir: '/home/x/.gina', ginaPath: '/srv/gina' });
 * // { ok: true, reason: 'ok', defFramework: '0.3.10-alpha.2',
 * //   frameworkDir: '/srv/gina/framework/v0.3.10-alpha.2', presentDirs: ['v0.3.10-alpha.2'] }
 *
 * @example <caption>Fresh install — main.json absent</caption>
 * check({ ginaHomeDir: '/home/x/.gina', ginaPath: '/srv/gina' });
 * // { ok: true, reason: 'main-json-absent', defFramework: null, frameworkDir: null, presentDirs: [] }
 */
function check(opts) {
    opts = opts || {};
    var driver = opts.fs || fs;

    if (!opts.ginaHomeDir || !opts.ginaPath) {
        return {
            ok:           false,
            reason:       'missing-input',
            defFramework: null,
            frameworkDir: null,
            presentDirs:  []
        };
    }

    var mainConfigPath = nodePath.join(opts.ginaHomeDir, 'main.json');
    if (!driver.existsSync(mainConfigPath)) {
        return {
            ok:           true,
            reason:       'main-json-absent',
            defFramework: null,
            frameworkDir: null,
            presentDirs:  []
        };
    }

    var mainConfig;
    try {
        mainConfig = JSON.parse(driver.readFileSync(mainConfigPath, 'utf8'));
    } catch (err) {
        return {
            ok:           false,
            reason:       'malformed-main-json',
            defFramework: null,
            frameworkDir: null,
            presentDirs:  []
        };
    }

    var defFramework = mainConfig && mainConfig.def_framework;
    if (!defFramework || typeof defFramework !== 'string') {
        return {
            ok:           false,
            reason:       'missing-def-framework',
            defFramework: null,
            frameworkDir: null,
            presentDirs:  listFrameworkDirs(opts.ginaPath, driver)
        };
    }

    var version      = defFramework.replace(/^v/, '');
    var frameworkDir = nodePath.join(opts.ginaPath, 'framework', 'v' + version);

    if (!driver.existsSync(frameworkDir)) {
        return {
            ok:           false,
            reason:       'def_framework-drift',
            defFramework: defFramework,
            frameworkDir: frameworkDir,
            presentDirs:  listFrameworkDirs(opts.ginaPath, driver)
        };
    }

    return {
        ok:           true,
        reason:       'ok',
        defFramework: defFramework,
        frameworkDir: frameworkDir,
        presentDirs:  listFrameworkDirs(opts.ginaPath, driver)
    };
}

/**
 * Lists framework/v* directories under `ginaPath`. Returns [] on any
 * read error (missing framework/, permission denied, etc.) — used only
 * for the diagnostic message, never gates the check itself.
 *
 * @inner
 * @param {string} ginaPath
 * @param {object} driver fs-like driver with readdirSync.
 * @returns {string[]} directory basenames (e.g. `['v0.3.10-alpha.2']`).
 */
function listFrameworkDirs(ginaPath, driver) {
    try {
        var entries = driver.readdirSync(nodePath.join(ginaPath, 'framework'));
        return entries.filter(function (e) { return e.indexOf('v') === 0; });
    } catch (e) {
        return [];
    }
}

/**
 * CLI entry point — runs the check against the live ~/.gina and the
 * caller's repo root, prints a human-readable diagnostic, and exits
 * with status 0 on ok, 1 on drift / missing field / malformed JSON.
 *
 * The same diagnostic shape is rendered by the `prepare_version.js`
 * wrapper when the gate fires during a publish.
 *
 * @returns {number} exit status (0 = ok, 1 = abort).
 */
function main() {
    var homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
        console.error('[check-def-framework] No $HOME path found.');
        return 1;
    }

    var ginaHomeDir = nodePath.join(homeDir, '.gina');
    var ginaPath    = nodePath.resolve(__dirname, '..');

    var result = check({ ginaHomeDir: ginaHomeDir, ginaPath: ginaPath });

    if (result.ok) {
        if (result.reason === 'main-json-absent') {
            console.log('[check-def-framework] OK: ~/.gina/main.json absent (first install / fresh state).');
        } else {
            console.log('[check-def-framework] OK: def_framework "' + result.defFramework +
                '" matches ' + result.frameworkDir + '.');
        }
        return 0;
    }

    renderFailure(result, ginaHomeDir, ginaPath);
    return 1;
}

/**
 * Prints the actionable diagnostic for a failed check. Shared between
 * the standalone CLI entry point and the `prepare_version.js` wrapper
 * so the operator sees the same recovery recipe regardless of which
 * surface tripped the gate.
 *
 * @inner
 * @param {object} result        Return value from {@link check}.
 * @param {string} ginaHomeDir
 * @param {string} ginaPath
 */
function renderFailure(result, ginaHomeDir, ginaPath) {
    console.error('[check-def-framework] ERROR: aborting publish — ' + result.reason);
    console.error('  ~/.gina/main.json def_framework : ' + (result.defFramework || '<unset>'));
    console.error('  Framework dir expected on disk  : ' + (result.frameworkDir || '<n/a>'));
    console.error('  Framework dirs actually present : ' +
        (result.presentDirs.length ? result.presentDirs.join(', ') : '<none>'));
    console.error('');
    console.error('  The state-store has drifted out of sync with the framework directory.');
    console.error('  This typically happens after multiple alpha cuts where post_publish.bumpVersion');
    console.error('  did not write def_framework correctly.');
    console.error('');
    console.error('  To recover, patch all three state stores to match the framework dir on disk:');
    console.error('    1. Identify the actual framework dir: ls ' + ginaPath + '/framework/');
    console.error('    2. Patch all three stores to that version:');
    console.error('       - ' + ginaHomeDir + '/main.json: def_framework');
    console.error('       - ' + ginaHomeDir + '/<shortVersion>/settings.json: version + def_framework');
    console.error('       - ' + ginaHomeDir + '/gina.db kv_store: main + settings/<shortVersion> blobs');
    console.error('    3. Re-run npm publish.');
    console.error('');
}

if (require.main === module) {
    process.exit(main());
}

module.exports = {
    check:             check,
    listFrameworkDirs: listFrameworkDirs,
    renderFailure:     renderFailure,
    main:              main
};
