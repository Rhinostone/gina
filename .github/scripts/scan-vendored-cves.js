#!/usr/bin/env node
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * OSV-based CVE scan for dependencies whose advisories name-based matching
 * would otherwise MISS.
 *
 * Two target sources, unioned:
 *
 *   1. **Forked npm deps** (`TRACKED_FORKS`). Gina consumes maintained forks of
 *      dormant upstreams (e.g. `@rhinostone/busboy`, a strict superset of
 *      `busboy@1.6.0`). OSV matches advisories by package NAME, so an advisory
 *      filed against `busboy` will never match `@rhinostone/busboy` — nor will
 *      `npm audit` / Dependabot / Socket flag it. This scan therefore queries
 *      the UPSTREAM BASE coordinates explicitly. Each entry is cross-checked
 *      against the manifests: a fork that is no longer declared anywhere is
 *      reported as stale so the table cannot silently rot.
 *
 *   2. **Vendored deps** under `framework/v*\/core/deps/<dep>/package.json`, if
 *      any exist. Gina de-vendored busboy + streamsearch in favour of the npm
 *      fork, so this source is normally EMPTY — it is retained so that any
 *      future re-vendoring is picked up automatically rather than silently
 *      escaping the scan.
 *
 * Pinning convention for vendored copies: the vendored `package.json` stays
 * byte-identical to upstream until patched; on patch, `version` is bumped to
 * `<upstream>-rhinostone.N` (e.g. `1.6.0-rhinostone.1`). This script strips the
 * `-rhinostone.N` suffix before querying so OSV still matches the base
 * upstream version.
 *
 * Exit codes:
 *   0 — clean, no CVEs matched
 *   1 — at least one vulnerability matched (build fails)
 *   2 — scan error (malformed package.json, network failure, or NOTHING to
 *       scan — an empty target list is treated as a broken scan, never a pass)
 *
 * @module .github/scripts/scan-vendored-cves
 */

'use strict';

var fs    = require('fs');
var path  = require('path');
var https = require('https');

var ROOT = path.resolve(__dirname, '..', '..');

/**
 * Forked npm dependencies and the UPSTREAM coordinates their advisories are
 * filed against. Keep `base` in step with whatever upstream release the fork is
 * rebased onto; add the fork's own runtime deps too, since those are pulled in
 * under their real upstream names and are what actually ship.
 *
 * @constant {Array<{pkg: string, base: {name: string, version: string}, deps: Array<{name: string, version: string}>}>}
 */
var TRACKED_FORKS = [
    {
        // @rhinostone/busboy@1.6.x — gina-io/busboy, a strict superset of
        // upstream busboy@1.6.0 exposing `info.dispositionParams`.
        pkg:  '@rhinostone/busboy',
        base: { name: 'busboy', version: '1.6.0' },
        deps: [
            { name: 'streamsearch', version: '1.1.0' }
        ]
    }
];

/**
 * Manifests a forked dep may be declared in. Both are checked so a fork dropped
 * from one but not the other still counts as declared.
 *
 * @returns {string[]} absolute paths to every manifest that exists
 */
function manifestPaths() {
    var out = [path.join(ROOT, 'package.json')];
    var frameworkDir = path.join(ROOT, 'framework');
    if (fs.existsSync(frameworkDir)) {
        var fws = fs.readdirSync(frameworkDir);
        for (var i = 0; i < fws.length; i++) {
            var p = path.join(frameworkDir, fws[i], 'package.json');
            if (fs.existsSync(p)) out.push(p);
        }
    }
    return out.filter(function (p) { return fs.existsSync(p); });
}

/**
 * Is `name` declared as a dependency in any manifest?
 *
 * @param {string} name
 * @returns {boolean}
 */
function isDeclared(name) {
    var manifests = manifestPaths();
    for (var i = 0; i < manifests.length; i++) {
        var pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(manifests[i], 'utf8'));
        } catch (e) {
            continue;
        }
        var buckets = [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies];
        for (var b = 0; b < buckets.length; b++) {
            if (buckets[b] && Object.prototype.hasOwnProperty.call(buckets[b], name)) return true;
        }
    }
    return false;
}

/**
 * Walk every `framework/v*\/core/deps/<dep>/package.json` and return the
 * list of absolute paths.
 *
 * @returns {string[]}
 */
function walkDepsPackageJsons() {
    var frameworkDir = path.join(ROOT, 'framework');
    if (!fs.existsSync(frameworkDir)) return [];
    var results = [];
    var fws = fs.readdirSync(frameworkDir);
    for (var i = 0; i < fws.length; i++) {
        var depsDir = path.join(frameworkDir, fws[i], 'core', 'deps');
        if (!fs.existsSync(depsDir)) continue;
        if (!fs.statSync(depsDir).isDirectory()) continue;
        var deps = fs.readdirSync(depsDir);
        for (var j = 0; j < deps.length; j++) {
            var pkgPath = path.join(depsDir, deps[j], 'package.json');
            if (fs.existsSync(pkgPath)) results.push(pkgPath);
        }
    }
    return results;
}

/**
 * Strip the local-patch suffix (`-rhinostone.N`) so OSV sees the base
 * upstream version. If the version has no such suffix, returned as-is.
 *
 * @param {string} v
 * @returns {string}
 */
function normalizeVersion(v) {
    return String(v).replace(/-rhinostone\.\d+$/, '');
}

/**
 * Build the full scan target list from both sources.
 *
 * @returns {{targets: Array<{name: string, version: string, origin: string}>, stale: string[], error: (string|null)}}
 */
function collectTargets() {
    var targets = [];
    var stale   = [];

    for (var i = 0; i < TRACKED_FORKS.length; i++) {
        var fork = TRACKED_FORKS[i];
        if (!isDeclared(fork.pkg)) {
            stale.push(fork.pkg);
            continue;
        }
        targets.push({
            name:    fork.base.name,
            version: fork.base.version,
            origin:  'fork base of ' + fork.pkg
        });
        for (var d = 0; d < (fork.deps || []).length; d++) {
            targets.push({
                name:    fork.deps[d].name,
                version: fork.deps[d].version,
                origin:  'dependency of ' + fork.pkg
            });
        }
    }

    var vendored = walkDepsPackageJsons();
    for (var v = 0; v < vendored.length; v++) {
        var rel = path.relative(ROOT, vendored[v]);
        var pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(vendored[v], 'utf8'));
        } catch (e) {
            return { targets: [], stale: stale, error: rel + ': cannot parse (' + e.message + ')' };
        }
        if (!pkg.name || !pkg.version) {
            console.log('[osv] SKIP ' + rel + ': missing name or version');
            continue;
        }
        targets.push({
            name:    pkg.name,
            version: normalizeVersion(pkg.version),
            origin:  'vendored at ' + rel
        });
    }

    return { targets: targets, stale: stale, error: null };
}

/**
 * POST a single `(name, version)` query to api.osv.dev/v1/query.
 * Resolves with the parsed JSON response (which may carry `{vulns: [...]}`
 * or be empty `{}` on a clean match).
 *
 * @param {string} name
 * @param {string} version
 * @returns {Promise<object>}
 */
function queryOSV(name, version) {
    return new Promise(function (resolve, reject) {
        var body = JSON.stringify({
            package: { name: name, ecosystem: 'npm' },
            version: version
        });
        var req = https.request({
            method:   'POST',
            hostname: 'api.osv.dev',
            path:     '/v1/query',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, function (res) {
            var data = '';
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () {
                if (res.statusCode !== 200) {
                    return reject(new Error('OSV HTTP ' + res.statusCode + ': ' + data));
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * Scan driver. Builds the target list, queries OSV for each, prints a one-line
 * status per target, exits with the appropriate code.
 *
 * @returns {Promise<number>} exit code
 */
async function main() {
    var collected = collectTargets();

    if (collected.error) {
        console.error('[osv] ' + collected.error);
        return 2;
    }

    for (var s = 0; s < collected.stale.length; s++) {
        console.error('[osv] STALE TRACKED_FORKS entry: `' + collected.stale[s] +
                      '` is not declared in any manifest — remove it from the table or restore the dependency.');
    }
    if (collected.stale.length > 0) return 2;

    var targets = collected.targets;

    // An empty target list means the scan inspected NOTHING. Treat that as a
    // broken scan (2), never a pass (0): a gate that silently degrades to green
    // reports "clean" forever while providing zero coverage.
    if (targets.length === 0) {
        console.error('[osv] no scan targets resolved — TRACKED_FORKS is empty AND no vendored ' +
                      'package.json files exist under framework/v*/core/deps/. Refusing to report ' +
                      'a clean scan over nothing.');
        return 2;
    }

    var failures = 0;
    var scanned  = 0;
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        var result;
        try {
            result = await queryOSV(t.name, t.version);
        } catch (e) {
            console.error('[osv] ' + t.name + '@' + t.version + ': query failed — ' + e.message);
            return 2;
        }

        scanned++;
        var vulns = result.vulns || [];
        if (vulns.length > 0) {
            failures++;
            console.error('[osv] VULNERABLE ' + t.name + '@' + t.version + ' (' + t.origin + ')');
            for (var v = 0; v < vulns.length; v++) {
                var entry   = vulns[v];
                var aliases = (entry.aliases || []).join(', ');
                var summary = (entry.summary || entry.details || '').replace(/\s+/g, ' ').slice(0, 140);
                console.error('       ' + entry.id + (aliases ? ' (' + aliases + ')' : '') + ' — ' + summary);
            }
        } else {
            console.log('[osv] OK ' + t.name + '@' + t.version + ' (' + t.origin + ')');
        }
    }

    console.log('');
    if (failures > 0) {
        console.error('[osv] ' + failures + ' dep(s) with matching CVEs — failing the build.');
        return 1;
    }
    console.log('[osv] clean — no CVEs matched across ' + scanned + ' scanned dep(s).');
    return 0;
}

main().then(function (code) {
    process.exit(code);
}).catch(function (err) {
    console.error('[osv] uncaught:', err);
    process.exit(2);
});
