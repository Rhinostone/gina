/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var fs   = require('fs');
var path = require('path');

/**
 * @module lib/swig-trusted-loader
 * @description Per-bundle opt-out to swig-core's filesystem-loader basepath
 * confinement (CVE-2023-25345). swig-core >= 2.7.1 confines
 * `swig.loaders.fs(dir)` to `dir` and throws for any `{% include %}` /
 * `{% import %}` / `{% extends %}` that resolves outside it. That confinement
 * (gina's default render-path posture since #TPL2) breaks a legitimate
 * authoring pattern: a template under the bundle template root that includes an
 * author-relative asset from a SIBLING directory
 * (`{% include "../shared/x.css" %}`), which resolves outside the basepath.
 *
 * This module builds the swig filesystem loader for the DEFAULT (synchronous)
 * render path with a per-bundle `trustedRoots` allowlist: a nested resolution is
 * ACCEPTED when it lands under the bundle template root OR under any configured
 * trusted root, and REJECTED (same CVE-style throw) otherwise. When no
 * trustedRoots are configured the bundle stays fully confined — `build()`
 * returns the stock `swig.loaders.fs(dir)`, byte-identical to the #TPL2 posture,
 * and the gina-owned wrapper is never instantiated.
 *
 * Confined-by-default + opt-out: untrusted paths stay confined; only the
 * directories a bundle explicitly declares can be resolved out-of-root.
 *
 * Scope: the loader path only (nested `{% include %}` / `{% import %}`). gina's
 * own top-level `{% extends %}` boundary check (controller.render-swig.js) stays
 * root-confined independently of this allowlist.
 *
 * Distinct from `lib/template-loaders` (#TPL1): that is the ASYNC pluggable
 * backend (memory / http) whose guard hard-rejects every `..` segment — the
 * opposite of what a trusted-roots allowlist must permit. This is the SYNC
 * filesystem loader, gina-owned and fail-closed: it NEVER enables swig-core's
 * blanket `allowOutsideRoot`, so a bypass fails CLOSED (confined), not open.
 *
 * @package gina.framework
 */

/**
 * Normalise a raw `trustedRoots` config value into a clean array of non-empty
 * trimmed strings. Tolerates `undefined` / non-array / non-string entries
 * (returns `[]` / skips them) so a malformed config degrades to "confined"
 * rather than throwing at loader-build time.
 *
 * @inner
 * @param {*} trustedRoots - Raw `settings.template.swig.trustedRoots` value
 * @returns {string[]} Cleaned list (possibly empty)
 */
var cleanRoots = function (trustedRoots) {
    var out = [];
    if ( !Array.isArray(trustedRoots) ) {
        return out;
    }
    for (var i = 0; i < trustedRoots.length; ++i) {
        var r = trustedRoots[i];
        if ( typeof(r) == 'string' && r.trim() !== '' ) {
            out.push(r.trim());
        }
    }
    return out;
};

/**
 * Resolve a bundle template root + its configured trusted roots into a list of
 * absolute, normalised directory paths (the root itself is always first).
 * Relative roots (e.g. `"../shared"`) anchor on `dir`, matching how swig
 * resolves include paths against the loader basepath; absolute roots pass
 * through unchanged.
 *
 * @inner
 * @param {string}   dir          - Bundle template root (loader basepath)
 * @param {string[]} cleanedRoots - Pre-cleaned trusted-root strings
 * @returns {string[]} Absolute, normalised allowed-root directories
 */
var resolveRoots = function (dir, cleanedRoots) {
    var base  = path.normalize(dir);
    var roots = [ base ];
    for (var i = 0; i < cleanedRoots.length; ++i) {
        roots.push( path.normalize( path.resolve(base, cleanedRoots[i]) ) );
    }
    return roots;
};

/**
 * Is `resolved` the directory `root` itself, or contained under it? Uses the
 * trailing-separator prefix test (`root + path.sep`) so a sibling whose name
 * merely shares a prefix is NOT a false match (e.g. `/x/shared-evil` is not
 * under `/x/shared`). Mirrors swig-core filesystem.js's own containment check.
 *
 * @inner
 * @param {string} resolved - Absolute, normalised candidate path
 * @param {string} root     - Absolute, normalised allowed-root directory
 * @returns {boolean}
 */
var isUnder = function (resolved, root) {
    if ( resolved === root ) {
        return true;
    }
    return resolved.indexOf( path.normalize(root + path.sep) ) === 0;
};

/**
 * Is an already-resolved absolute path inside the bundle template root OR any
 * configured trusted root? A reusable predicate carrying the same allowlist
 * semantics as the loader's `resolve` (e.g. for a future `{% extends %}`
 * boundary that wants to honour the same trusted roots).
 *
 * @param {string} resolvedPath - Absolute path produced by `path.resolve`
 * @param {string} dir          - Bundle template root
 * @param {*}      trustedRoots - Raw `trustedRoots` config (cleaned internally)
 * @returns {boolean} `true` when under the root or a configured trusted root
 *
 * @example
 * // sibling 'shared' declared as trusted ⇒ a path inside it is trusted
 * swigTrustedLoader.isTrustedPath('/app/templates/shared/x.css',
 *                                 '/app/templates/html', ['../shared']); // → true
 * @example
 * // nothing declared ⇒ only in-root paths are trusted
 * swigTrustedLoader.isTrustedPath('/app/templates/shared/x.css',
 *                                 '/app/templates/html', []); // → false
 */
var isTrustedPath = function (resolvedPath, dir, trustedRoots) {
    var roots = resolveRoots(dir, cleanRoots(trustedRoots));
    for (var i = 0; i < roots.length; ++i) {
        if ( isUnder(resolvedPath, roots[i]) ) {
            return true;
        }
    }
    return false;
};

/**
 * Build the swig filesystem loader for a bundle's DEFAULT (synchronous) render
 * path, honouring a per-bundle `trustedRoots` allowlist.
 *
 * - No trustedRoots → returns the stock confined `swig.loaders.fs(dir)`
 *   (byte-identical to the #TPL2 confined posture; the gina-owned wrapper is
 *   never instantiated, so a non-opted-in bundle is unchanged).
 * - One or more trustedRoots → returns a gina-owned `{ resolve, load }` loader
 *   that accepts a resolution under `dir` OR any trusted root and throws the
 *   CVE-2023-25345-style error otherwise. It NEVER sets swig-core's blanket
 *   `allowOutsideRoot`, so the confinement is re-imposed by gina and fails
 *   CLOSED if ever bypassed.
 *
 * The returned loader keeps `load` arity 2 (`identifier, cb`) so swig's engine
 * still selects both the callback and synchronous load paths
 * (`loader.load.length >= 2`); it is NOT marked `async`, so it stays on the
 * synchronous `setDefaults` path (not the #TPL1 async delegate).
 *
 * @param {object} swig         - Resolved swig module (exposes `loaders.fs`)
 * @param {string} dir          - Bundle template root (loader basepath)
 * @param {*}      trustedRoots - Raw `settings.template.swig.trustedRoots`
 *                                (array of dir strings, each relative to `dir`
 *                                or absolute; non-array / empty ⇒ fully confined)
 * @param {string} [encoding='utf8'] - Template file encoding
 * @returns {object} A swig loader: `{ resolve(to, from), load(identifier, cb) }`
 *
 * @example
 * // Confined (default) — identical to swig.loaders.fs(dir):
 * var loader = swigTrustedLoader.build(swig, dir, []);
 *
 * @example
 * // Opt-out: allow a sibling shared-assets directory:
 * var loader = swigTrustedLoader.build(swig, dir, ['../shared']);
 * swig.setDefaults({ loader: loader });
 * //   {% include "../shared/x.css" %}  → allowed
 * //   {% include "../secret/x"     %}  → throws (CVE-2023-25345)
 */
var build = function (swig, dir, trustedRoots, encoding) {
    var cleaned = cleanRoots(trustedRoots);

    // Confined-by-default: with no trusted roots declared, return the stock
    // confined fs loader — byte-identical to the #TPL2 posture, zero new code
    // on the default render path.
    if ( cleaned.length === 0 ) {
        return swig.loaders.fs(dir);
    }

    encoding = encoding || 'utf8';

    var base  = path.normalize(dir);
    var roots = resolveRoots(base, cleaned);

    var loader = {
        /**
         * Resolve `to` against the bundle template root (swig discards the
         * caller `from` for a basepath loader — we mirror that), then enforce
         * the trusted-roots allowlist.
         *
         * @param {string} to     - Template identifier requested by the engine
         * @param {string} [from] - Ignored (basepath-anchored, like swig-core fs)
         * @returns {string} Absolute resolved path (when allowed)
         * @throws {Error} CVE-2023-25345-style error when outside root + roots
         */
        resolve: function (to, from) {
            var resolved = path.resolve(base, to);
            for (var i = 0; i < roots.length; ++i) {
                if ( isUnder(resolved, roots[i]) ) {
                    return resolved;
                }
            }
            throw new Error('Template "' + to + '" resolves outside the loader root "'
                + base + '" and is not under a configured trustedRoots entry (CVE-2023-25345).');
        },

        /**
         * Load a template's source. Routes through THIS object's `resolve` (so
         * the allowlist gates the file read too) and supports both the callback
         * and synchronous forms swig dispatches on. Verbatim shape of swig-core's
         * fs `load`, minus the blanket-confinement dependency.
         *
         * @param {string}   identifier - Template identifier
         * @param {function} [cb]        - Node-style callback; sync read when omitted
         * @returns {string|undefined} Source string (sync) or `undefined` (cb form)
         * @throws {Error} When there is no filesystem to read from
         */
        load: function (identifier, cb) {
            if ( !fs || (cb && !fs.readFile) || !fs.readFileSync ) {
                throw new Error('Unable to find file ' + identifier
                    + ' because there is no filesystem to read from.');
            }
            identifier = loader.resolve(identifier);
            if (cb) {
                fs.readFile(identifier, encoding, cb);
                return;
            }
            return fs.readFileSync(identifier, encoding);
        }
    };

    return loader;
};

/**
 * @exports lib/swig-trusted-loader
 */
module.exports = {
    build:         build,
    isTrustedPath: isTrustedPath
};
