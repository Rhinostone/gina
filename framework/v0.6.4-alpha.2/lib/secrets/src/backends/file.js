'use strict';
/**
 * @module lib/secrets/backends/file
 * @description Backend that layers one or more `.env`-style files *underneath*
 * the environment.
 *
 * **The environment always wins.** A value present in `process.gina` /
 * `process.env` is returned even when a file also defines the key. That
 * ordering is deliberate and is the opposite of what `.env`-file tooling
 * usually does: every production mechanism for delivering a secret to a gina
 * bundle — a Kubernetes `envFrom: secretRef`, an ECS task-definition secret,
 * `sops exec-env`, a CI-exported variable — arrives through the environment.
 * If a file won, a stale plaintext file baked into an image would silently
 * shadow the secret the platform injected, and the bundle would run with the
 * wrong credential while looking perfectly healthy. Making the file the
 * *fallback* means it can only ever fill a gap, never override a deployment.
 *
 * Files are layered in declaration order, later entries winning, so a caller
 * can express `["<base>", "<per-scope>"]` and have the scope-specific file
 * override shared defaults. A file that does not exist contributes nothing and
 * is not an error — a project may legitimately ship a base file and add the
 * per-scope one only on some targets.
 *
 * This backend does NOT decrypt. Pointing it at an encrypted file yields
 * ciphertext, silently. For SOPS / Vault / KMS, keep decrypting at the
 * container entrypoint so the values land in the environment, which this
 * backend already prefers.
 */

var envBackend = require('./env');
var envFile    = require('../env-file');

/**
 * Build a backend that reads the environment first and the given files second.
 *
 * @memberof module:lib/secrets/backends/file
 * @function build
 * @param {string[]} paths - Absolute, already-substituted file paths, lowest precedence first
 * @returns {{resolve: function(string): string}} A backend honouring the `lib/secrets` contract
 *
 * @example
 * var backend = build(['/home/u/.myproject/secrets.env',
 *                      '/home/u/.myproject/production/secrets.env']);
 * backend.resolve('DB_PASSWORD');
 * // env value if set; else the production file's; else the base file's;
 * // else throws Error('Secret resolution failed')
 */
function build(paths) {
    // Layer eagerly, once per config-load cycle, rather than statting on every
    // key: resolution walks the whole config and would otherwise re-read the
    // same files for each placeholder.
    var merged = Object.create(null);
    for (var i = 0; i < paths.length; i++) {
        var map = envFile.parseEnvFile(paths[i]);
        // Name each layer and whether it was found. A misresolved path is
        // otherwise indistinguishable from a file that simply lacks the key:
        // both surface as the same fail-closed error, several frames away.
        try {
            console.debug('[secrets][file] ' + (map === null ? 'ABSENT ' : 'loaded ')
                + paths[i] + (map === null ? '' : ' (' + Object.keys(map).length + ' keys)'));
        } catch (noLogger) { /* logger not up yet — diagnostics are best-effort */ }
        if (map === null) continue;          // absent file: contributes nothing, not an error
        for (var key in map) {
            merged[key] = map[key];          // later path wins
        }
    }

    return {
        resolve: function (key) {
            // Environment tiers first — delegate to the env backend rather than
            // re-implementing its two-tier `getEnvVar` -> `process.env` read
            // (#B156), so the two can never disagree about what "set" means.
            // It throws on miss, which here means "not in the environment".
            try {
                return envBackend.resolve(key);
            } catch (notInEnv) {
                // fall through to the file layer
            }

            var value = merged[key];
            if (typeof value === 'string' && value !== '') {
                return value;
            }

            // Same failure shape as the env backend: the message never names
            // the key (it reaches user-facing surfaces), while the key rides
            // on a non-enumerable property for debug logging.
            var err = new Error('Secret resolution failed');
            Object.defineProperty(err, '_ginaSecretKey', {
                value: key,
                enumerable: false,
                configurable: true,
                writable: true
            });
            throw err;
        }
    };
}

module.exports = {
    build: build
};
