#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @file script/version_compare.js
 *
 * Strict-semver comparator used by `script/post_install.js` to gate the
 * `def_framework` overwrite against version regression. Lives in `script/`
 * (not under the framework lib tree) because `post_install.js` runs at npm
 * install time, before any framework helpers are guaranteed loadable.
 *
 * Background: v0.3.10 stable publish (2026-05-06) aborted because
 * `~/.gina/main.json:def_framework` had drifted to "0.3.9" while the
 * framework dir on disk was at v0.3.10-alpha.2. Root cause: `npm install
 * -g gina@<older>` between alpha cycles ran `post_install.js`, which
 * unconditionally overwrote `def_framework` with the installed version
 * (no semver-newer guard at line 822). This module provides the
 * comparator that gates the overwrite — never regress to a strictly
 * older version.
 *
 * Semver rules applied (per semver.org § 11):
 *   - major / minor / patch compared numerically.
 *   - Equal core: stable beats any pre-release of the same core.
 *   - Both pre-release: identifiers compared part-by-part; numeric vs
 *     numeric uses numeric order, identifier vs identifier uses ASCII.
 *   - Shorter pre-release identifier list is older than longer (per
 *     spec — `1.0.0-alpha < 1.0.0-alpha.1`).
 *
 * Unparseable inputs return `false` ("not strictly older") so the caller
 * preserves its existing default behaviour in the indeterminate case.
 */

'use strict';

/**
 * True when `candidate` is strictly older than `current` per semver
 * rules. Returns `false` when they are equal, when `candidate` is newer,
 * when either input is missing, or when either input cannot be parsed.
 *
 * @param   {string|null|undefined} candidate  Version being considered for write.
 * @param   {string|null|undefined} current    Version currently on disk.
 * @returns {boolean}
 *
 * @example
 * isStrictlyOlder('0.3.9', '0.3.10-alpha.2');         // true  — older patch
 * isStrictlyOlder('0.3.10', '0.3.10-alpha.5');        // false — stable supersedes its alphas
 * isStrictlyOlder('0.3.10-alpha.4', '0.3.10-alpha.5'); // true  — older alpha
 * isStrictlyOlder('0.3.10-alpha.5', '0.3.10');        // true  — alpha is older than stable
 * isStrictlyOlder('0.3.10', '0.3.10');                // false — equal
 * isStrictlyOlder('0.3.11-alpha.1', '0.3.10');        // false — newer patch
 * isStrictlyOlder(null, '0.3.10');                    // false — missing input
 * isStrictlyOlder('garbage', '0.3.10');               // false — unparseable
 */
function isStrictlyOlder(candidate, current) {
    if (!current || !candidate) return false;

    var SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/;
    var c = String(candidate).match(SEMVER_RE);
    var u = String(current).match(SEMVER_RE);
    if (!c || !u) return false;

    for (var i = 1; i <= 3; i++) {
        var ci = parseInt(c[i], 10);
        var ui = parseInt(u[i], 10);
        if (ci !== ui) return ci < ui;
    }

    var cpre = c[4] || null;
    var upre = u[4] || null;

    if (cpre === upre) return false;
    if (!cpre) return false;
    if (!upre) return true;

    return comparePrerelease(cpre, upre) < 0;
}

/**
 * Compare two pre-release identifier strings (the `alpha.5` part of
 * `1.0.0-alpha.5`). Returns -1 / 0 / 1 in the usual sort sense. Numeric
 * identifiers compare numerically; non-numeric compare ASCII; numeric
 * always beats non-numeric (per semver § 11.4.3); shorter beats longer
 * when prefixes match (per semver § 11.4.4).
 *
 * @inner
 * @param   {string} a
 * @param   {string} b
 * @returns {number}
 */
function comparePrerelease(a, b) {
    var aparts = a.split('.');
    var bparts = b.split('.');
    var len = Math.max(aparts.length, bparts.length);
    for (var i = 0; i < len; i++) {
        var ap = aparts[i];
        var bp = bparts[i];
        if (ap === undefined) return -1;
        if (bp === undefined) return 1;
        var an = /^\d+$/.test(ap) ? parseInt(ap, 10) : null;
        var bn = /^\d+$/.test(bp) ? parseInt(bp, 10) : null;
        if (an !== null && bn !== null) {
            if (an !== bn) return an < bn ? -1 : 1;
        } else if (an !== null) {
            return -1;
        } else if (bn !== null) {
            return 1;
        } else {
            if (ap !== bp) return ap < bp ? -1 : 1;
        }
    }
    return 0;
}

module.exports = {
    isStrictlyOlder:    isStrictlyOlder,
    comparePrerelease:  comparePrerelease
};
