'use strict';
/**
 * @module lib/secrets/env-file
 * @description `.env`-style parsing, shared so that every reader of a given
 * file agrees on what it means.
 *
 * Two consumers exist today and they answer different questions about the
 * same bytes: the `gina secrets:check` CLI handler asks *"would a bundle
 * started here resolve its placeholders?"*, and a file-backed secrets backend
 * asks *"what value does this key have?"*. If those two parsed differently —
 * on a quoted value, an `export ` prefix, a CRLF line ending — `secrets:check`
 * could report a clean bill of health for a file the runtime then reads
 * differently. Keeping one implementation makes that class of disagreement
 * impossible rather than merely unlikely.
 *
 * Deliberately minimal: no interpolation, no multi-line values, no `.env`
 * dialect extensions. The format this parses is the one a POSIX shell would
 * `source`, which is how the documented container-entrypoint pattern
 * (`set -a; . secrets.env; set +a`) populates the environment.
 */

var fs = require('fs');

/**
 * Parse `.env`-style content into a flat `KEY -> value` map.
 *
 * Recognised per line: blank lines and `#` comments are skipped; a leading
 * `export ` is stripped; the key is everything before the FIRST `=`; a line
 * with no `=` is skipped entirely. A value wrapped in matching single or
 * double quotes is unquoted. Keys and values are trimmed. Later duplicate
 * keys overwrite earlier ones, matching shell `source` semantics.
 *
 * The returned map is created with a `null` prototype, so a key such as
 * `constructor` or `__proto__` is an ordinary entry rather than an inherited
 * member — a plain `{}` would make `map.constructor` truthy for every file.
 *
 * @memberof module:lib/secrets/env-file
 * @function parseEnv
 * @param {string} raw - The file's contents
 * @returns {Object<string,string>} Parsed key/value map (null-prototype)
 *
 * @example
 * parseEnv('# db\nexport DB_PW=s3cr3t\nAPI_KEY="quoted"\nEMPTY=\nNOEQ\n');
 * // → { DB_PW: 's3cr3t', API_KEY: 'quoted', EMPTY: '' }
 * // `NOEQ` is absent: no `=`, so the line is skipped.
 */
function parseEnv(raw) {
    var map = Object.create(null);
    if (typeof raw !== 'string') {
        return map;
    }
    var lines = raw.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || /^#/.test(line)) continue;
        line = line.replace(/^export\s+/, '');
        var eq = line.indexOf('=');
        if (eq < 0) continue;
        var key = line.slice(0, eq).trim();
        var val = line.slice(eq + 1).trim();
        if ( /^".*"$/.test(val) || /^'.*'$/.test(val) ) {
            val = val.slice(1, -1);
        }
        map[key] = val;
    }
    return map;
}

/**
 * @typedef {object} EnvFileRead
 * @property {boolean}                   found - `true` when the file was read and parsed
 * @property {Object<string,string>|null} map  - Parsed map when `found`, else `null`
 * @property {string|null}               code  - `null` when `found`; else the `fs` error
 *   code — `'ENOENT'` for a genuinely absent path, `'EACCES'` / `'EISDIR'` / … for a
 *   path that exists but could not be read
 */

/**
 * Read and parse a `.env`-style file, reporting WHY a read failed.
 *
 * `parseEnvFile` collapses every failure to `null`, which makes a file that is
 * *missing* indistinguishable from one that exists but cannot be opened. Those
 * two deserve opposite handling: a missing layer is a legitimate state (a project
 * may ship a base file and add the per-scope one only on some targets), whereas a
 * layer that exists and cannot be read is an operator error — and silently
 * skipping it drops the bundle onto whatever lower-precedence layer remains,
 * which for a `["<base>", "<per-scope>"]` chain means quietly running on the
 * SHARED credential instead of the scope-specific one (#B267).
 *
 * Callers that must distinguish the two use this; `parseEnvFile` is kept as the
 * map-or-`null` convenience on top of it.
 *
 * @memberof module:lib/secrets/env-file
 * @function readEnvFile
 * @param {string} filePath - Absolute path to the file
 * @returns {EnvFileRead} Discriminated read result
 *
 * @example
 * var res = readEnvFile('/run/secrets.env');
 * if (!res.found && res.code !== 'ENOENT') {
 *     throw new Error('secrets file exists but cannot be read: ' + res.code);
 * }
 *
 * @example
 * // A genuinely absent layer is not an error — it simply contributes nothing:
 * readEnvFile('/run/never-created.env');   // → { found: false, map: null, code: 'ENOENT' }
 */
function readEnvFile(filePath) {
    var raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        // `e.code` is what discriminates: ENOENT (absent, fine) vs EACCES / EISDIR /
        // ENOTDIR / ELOOP (present but unusable). A dangling symlink reports ENOENT,
        // which is the correct reading — its target genuinely is not there.
        return { found: false, map: null, code: (e && e.code) ? e.code : 'EUNKNOWN' };
    }
    return { found: true, map: parseEnv(raw), code: null };
}

/**
 * Read and parse a `.env`-style file.
 *
 * Returns `null` — rather than throwing or returning an empty map — when the
 * file cannot be read, so a caller can tell "unreadable" apart from "readable
 * but empty". That distinction is load-bearing: an unreadable path is an
 * operator error worth reporting, whereas an empty file is a legitimate state
 * that should simply contribute no keys.
 *
 * ⚠️ This collapses *why* the read failed. A caller that must tell a missing
 * file apart from an unreadable one — which is the difference between "skip this
 * layer" and "refuse to boot" — wants {@link module:lib/secrets/env-file.readEnvFile}
 * instead.
 *
 * @memberof module:lib/secrets/env-file
 * @function parseEnvFile
 * @param {string} filePath - Absolute path to the file
 * @returns {Object<string,string>|null} Parsed map, or `null` if unreadable
 *
 * @example
 * var map = parseEnvFile('/run/secrets.env');
 * if (map === null) {
 *     // unreadable — surface it; do not treat as "no secrets"
 * }
 */
function parseEnvFile(filePath) {
    var res = readEnvFile(filePath);
    return res.found ? res.map : null;
}

module.exports = {
    parseEnv: parseEnv,
    parseEnvFile: parseEnvFile,
    readEnvFile: readEnvFile
};
