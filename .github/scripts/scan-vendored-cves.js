#!/usr/bin/env node
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * OSV-based CVE scan for vendored deps.
 *
 * Walks every `package.json` under `framework/v*\/core/deps/`, extracts
 * `(name, version)` pairs, queries `api.osv.dev`, and exits non-zero if
 * any vulnerability is matched.
 *
 * Pinning convention (see .claude/architecture/vendored-deps.md): the
 * vendored `package.json` stays byte-identical to upstream until
 * patched; on patch, `version` is bumped to `<upstream>-rhinostone.N`
 * (e.g. `1.6.0-rhinostone.1`). This script strips the
 * `-rhinostone.N` suffix before querying so OSV still matches the base
 * upstream version.
 *
 * Exit codes:
 *   0 — clean, no CVEs matched
 *   1 — at least one vulnerability matched (build fails)
 *   2 — scan error (malformed package.json, network failure)
 *
 * @module .github/scripts/scan-vendored-cves
 */

'use strict';

var fs    = require('fs');
var path  = require('path');
var https = require('https');

var ROOT = path.resolve(__dirname, '..', '..');

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
 * Scan driver. Walks the target package.jsons, queries OSV for each,
 * prints a one-line status per dep, exits with the appropriate code.
 *
 * @returns {Promise<number>} exit code
 */
async function main() {
    var pkgs = walkDepsPackageJsons();
    if (pkgs.length === 0) {
        console.log('[osv] no vendored package.json files found under framework/v*/core/deps/');
        return 0;
    }

    var failures = 0;
    var scanned  = 0;
    for (var i = 0; i < pkgs.length; i++) {
        var pkgPath = pkgs[i];
        var rel     = path.relative(ROOT, pkgPath);
        var pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch (e) {
            console.error('[osv] ' + rel + ': cannot parse (' + e.message + ')');
            return 2;
        }
        if (!pkg.name || !pkg.version) {
            console.log('[osv] SKIP ' + rel + ': missing name or version');
            continue;
        }

        var baseVersion = normalizeVersion(pkg.version);
        var suffix      = (pkg.version !== baseVersion) ? ' (patched: ' + pkg.version + ')' : '';
        var result;
        try {
            result = await queryOSV(pkg.name, baseVersion);
        } catch (e) {
            console.error('[osv] ' + rel + ': query failed — ' + e.message);
            return 2;
        }

        scanned++;
        var vulns = result.vulns || [];
        if (vulns.length > 0) {
            failures++;
            console.error('[osv] VULNERABLE ' + pkg.name + '@' + baseVersion + suffix + ' (' + rel + ')');
            for (var v = 0; v < vulns.length; v++) {
                var entry   = vulns[v];
                var aliases = (entry.aliases || []).join(', ');
                var summary = (entry.summary || entry.details || '').replace(/\s+/g, ' ').slice(0, 140);
                console.error('       ' + entry.id + (aliases ? ' (' + aliases + ')' : '') + ' — ' + summary);
            }
        } else {
            console.log('[osv] OK ' + pkg.name + '@' + baseVersion + suffix + ' (' + rel + ')');
        }
    }

    console.log('');
    if (failures > 0) {
        console.error('[osv] ' + failures + ' vendored dep(s) with matching CVEs — failing the build.');
        return 1;
    }
    console.log('[osv] clean — no CVEs matched across ' + scanned + ' vendored dep(s).');
    return 0;
}

main().then(function (code) {
    process.exit(code);
}).catch(function (err) {
    console.error('[osv] uncaught:', err);
    process.exit(2);
});
