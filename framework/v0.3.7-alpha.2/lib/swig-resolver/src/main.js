/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module gina/lib/swig-resolver
 *
 * Pure resolver that picks between a project-installed swig package and the
 * framework's bundled copy. Opt-in via `swig.useProject: true` in the bundle
 * or project settings; default-off so the current behaviour (framework copy
 * always wins) is preserved.
 *
 * The resolver does **not** `require()` the swig module itself — it returns
 * a decision record containing the path to require. The caller (server.js /
 * gna.js) performs the actual require. This keeps the library pure and
 * testable without loading the heavy template engine during unit tests.
 *
 * Three safety gates on the project override:
 *
 *  1. **Package name allowlist** — only the configured `package` (default
 *     `@rhinostone/swig`) is honoured. `swig.package: "@rhinostone/swig-twig"`
 *     lets a project opt into the Twig frontend without re-keying anything.
 *     The abandoned upstream `swig` package name is never resolvable — it is
 *     not in the default or the known alternate, so a project that only has
 *     `"swig"` in node_modules gets the framework copy (which fixes
 *     CVE-2023-25345 at the controller layer).
 *
 *  2. **Same-major rule** — the project's version must share the major
 *     component with the floor. Different major → fall back, because the
 *     framework code was written against the major's API surface.
 *
 *  3. **Minimum floor** — within the same major, the project's version must
 *     be >= the floor constant below. Bump the floor in the same commit that
 *     introduces a framework dependency on a new fork API.
 *
 * @example
 * var resolver = require('lib/swig-resolver');
 * var decision = resolver.resolve('/path/to/project', {
 *     useProject: true,
 *     package:    '@rhinostone/swig',
 *     min:        '1.6.0'
 * });
 * if (decision.source === 'project') {
 *     var swig = require(decision.path);
 * } else {
 *     var swig = require('@rhinostone/swig');
 * }
 */

var fs       = require('fs');
var nodePath = require('path');

/**
 * Default npm package name resolved when `options.package` is omitted.
 *
 * @constant
 * @type {string}
 */
var DEFAULT_PACKAGE = '@rhinostone/swig';

/**
 * Framework floor — minimum project-pinned swig version the framework can
 * safely delegate to. Bump in the same commit that adds a framework
 * dependency on a new fork API.
 *
 * @constant
 * @type {string}
 */
var DEFAULT_MIN = '1.6.0';

/**
 * Known warning codes emitted by {@link resolve}. A non-null `warning` on the
 * decision record always pairs with `source: 'framework'` — the caller logs
 * it once at bundle startup.
 *
 * @typedef {'not-installed'|'package-json-not-found'|'malformed-package-json'|'missing-version'|'version-mismatch'} ResolverWarning
 */

/**
 * Shape returned by {@link resolve}.
 *
 * @typedef {Object} ResolverDecision
 * @property {'framework'|'project'}    source   Which copy the caller should load.
 * @property {string}                   package  The package name that was considered.
 * @property {string|null}              version  The resolved version string, or null when no project copy was read.
 * @property {string|null}              path     Absolute require path when `source === 'project'`; null otherwise.
 * @property {ResolverWarning|null}     warning  Reason the project copy was rejected, or null on success / when `useProject` was false.
 */

/**
 * @typedef {Object} ResolverOptions
 * @property {boolean} [useProject=false] Opt-in flag. When false (default),
 *                                        the resolver short-circuits to the
 *                                        framework copy without touching the
 *                                        filesystem.
 * @property {string}  [package]          Package name to look up.
 *                                        Defaults to {@link DEFAULT_PACKAGE}.
 * @property {string}  [min]              Minimum-version floor (same major
 *                                        required). Defaults to
 *                                        {@link DEFAULT_MIN}.
 */

/**
 * Strips a pre-release suffix (`1.6.0-alpha.2` → `1.6.0`) and splits into
 * `[major, minor, patch]`. Missing components default to `0`.
 *
 * @memberof module:gina/lib/swig-resolver
 * @param   {string} version
 * @returns {number[]} Three-element array.
 *
 * @example
 * splitVersion('1.6.2');        // [1, 6, 2]
 * splitVersion('2.0.0-alpha.8'); // [2, 0, 0]
 * splitVersion('1.6');           // [1, 6, 0]
 */
function splitVersion(version) {
    var core = String(version).split('-')[0].split('+')[0];
    var parts = core.split('.').map(function (n) {
        var v = parseInt(n, 10);
        return isNaN(v) ? 0 : v;
    });
    while (parts.length < 3) { parts.push(0); }
    return parts.slice(0, 3);
}

/**
 * Compares two version strings. Pre-release suffixes are ignored (an alpha
 * and its final are treated as equal — adequate for a runtime peer floor).
 *
 * @memberof module:gina/lib/swig-resolver
 * @param   {string} a
 * @param   {string} b
 * @returns {number} -1 when `a < b`, 0 when equal, 1 when `a > b`.
 *
 * @example
 * compareSemver('1.6.0', '1.6.2'); // -1
 * compareSemver('1.6.2', '1.6.2'); // 0
 * compareSemver('2.0.0', '1.9.9'); // 1
 */
function compareSemver(a, b) {
    var ap = splitVersion(a);
    var bp = splitVersion(b);
    for (var i = 0; i < 3; i++) {
        if (ap[i] !== bp[i]) { return ap[i] < bp[i] ? -1 : 1; }
    }
    return 0;
}

/**
 * True when `version` shares the major component with `min` **and** is
 * greater than or equal to `min` within that major.
 *
 * @memberof module:gina/lib/swig-resolver
 * @param   {string} version
 * @param   {string} min
 * @returns {boolean}
 *
 * @example
 * satisfiesMajorAndFloor('1.6.2', '1.6.0'); // true
 * satisfiesMajorAndFloor('1.5.0', '1.6.0'); // false (below floor)
 * satisfiesMajorAndFloor('2.0.0', '1.6.0'); // false (different major)
 */
function satisfiesMajorAndFloor(version, min) {
    var vp = splitVersion(version);
    var mp = splitVersion(min);
    if (vp[0] !== mp[0]) { return false; }
    return compareSemver(version, min) >= 0;
}

/**
 * Walks up from `startDir` looking for a `package.json` whose `name` field
 * matches `expectedName`. Returns the absolute path, or null when nothing
 * matched before the filesystem root.
 *
 * Needed because `require.resolve('@rhinostone/swig', { paths })` returns the
 * path to the package's `main` entry (e.g. `.../lib/index.js`), not to its
 * `package.json` — and the entry's directory is not guaranteed to contain
 * the manifest (monorepos frequently nest a `lib/` or `src/` level).
 *
 * @inner
 * @param  {string} startDir
 * @param  {string} expectedName
 * @returns {string|null}
 */
function findPackageJson(startDir, expectedName) {
    var dir = startDir;
    while (dir && dir !== nodePath.dirname(dir)) {
        var candidate = nodePath.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
            try {
                var pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (pkg && pkg.name === expectedName) { return candidate; }
            } catch (e) { /* malformed — keep walking */ }
        }
        dir = nodePath.dirname(dir);
    }
    return null;
}

/**
 * Resolves which swig copy a running bundle should load.
 *
 * Pure function: the only side effects are `fs.existsSync` and
 * `fs.readFileSync` against the project's `node_modules/`. Never `require()`s
 * the swig module itself — that stays the caller's responsibility so the
 * heavy template engine does not need to load during unit tests.
 *
 * @memberof module:gina/lib/swig-resolver
 * @param   {string|null|undefined} projectPath  Absolute path to the project root. When falsy, the resolver returns the framework decision immediately.
 * @param   {ResolverOptions}       [options]
 * @returns {ResolverDecision}
 *
 * @example <caption>Default (opt-out) — always framework</caption>
 * resolve('/srv/app', { useProject: false });
 * // { source: 'framework', package: '@rhinostone/swig', version: null, path: null, warning: null }
 *
 * @example <caption>Project has a satisfying pin</caption>
 * resolve('/srv/app', { useProject: true });
 * // { source: 'project', package: '@rhinostone/swig', version: '1.6.2', path: '/srv/app/node_modules/@rhinostone/swig/lib/index.js', warning: null }
 *
 * @example <caption>Project pins below the floor</caption>
 * resolve('/srv/app', { useProject: true, min: '1.6.0' });
 * // { source: 'framework', package: '@rhinostone/swig', version: '1.5.0', path: null, warning: 'version-mismatch' }
 */
function resolve(projectPath, options) {
    options = options || {};
    var pkgName    = options['package'] || DEFAULT_PACKAGE;
    var useProject = options.useProject === true;
    var min        = options.min || DEFAULT_MIN;

    var decision = {
        source:  'framework',
        'package': pkgName,
        version: null,
        path:    null,
        warning: null
    };

    if (!useProject || !projectPath) { return decision; }

    // Direct probe of <projectPath>/node_modules/<pkgName>/package.json. We
    // do this BEFORE require.resolve because Node's resolver parses the
    // manifest to pick `main` — a malformed manifest there throws
    // ERR_INVALID_PACKAGE_CONFIG, which would look identical to
    // MODULE_NOT_FOUND if we only relied on the resolver's error. Splitting
    // the concerns lets us surface an accurate warning code to the caller.
    var probedPkgJson = nodePath.join(projectPath, 'node_modules', pkgName, 'package.json');
    if (!fs.existsSync(probedPkgJson)) {
        decision.warning = 'not-installed';
        return decision;
    }

    var pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(probedPkgJson, 'utf8'));
    } catch (e) {
        decision.warning = 'malformed-package-json';
        return decision;
    }

    var entryPath;
    try {
        entryPath = require.resolve(pkgName, { paths: [projectPath] });
    } catch (e) {
        // Manifest parsed OK but the entry file is missing (broken install,
        // corrupted node_modules). Treat as not-installed — there is
        // nothing loadable even if the directory exists.
        decision.warning = 'not-installed';
        return decision;
    }

    // Belt and braces: the directly-read manifest is the source of truth
    // for the name/version checks below. findPackageJson is kept as a
    // safety net for monorepo layouts that may relocate the manifest.
    var pkgJsonPath = probedPkgJson;
    if (pkg.name !== pkgName) {
        pkgJsonPath = findPackageJson(nodePath.dirname(entryPath), pkgName);
        if (!pkgJsonPath) {
            decision.warning = 'package-json-not-found';
            return decision;
        }
        try {
            pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        } catch (e) {
            decision.warning = 'malformed-package-json';
            return decision;
        }
    }

    if (!pkg.version) {
        decision.warning = 'missing-version';
        return decision;
    }

    if (!satisfiesMajorAndFloor(pkg.version, min)) {
        decision.warning = 'version-mismatch';
        decision.version = pkg.version;
        return decision;
    }

    decision.source  = 'project';
    decision.version = pkg.version;
    decision.path    = entryPath;
    return decision;
}

module.exports = {
    resolve:                resolve,
    compareSemver:          compareSemver,
    satisfiesMajorAndFloor: satisfiesMajorAndFloor,
    splitVersion:           splitVersion,
    DEFAULT_PACKAGE:        DEFAULT_PACKAGE,
    DEFAULT_MIN:            DEFAULT_MIN
};
