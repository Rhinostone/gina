var fs        = require('fs');
var spawnSync = require('child_process').spawnSync;

/**
 * @module gina/lib/cmd/image/_host
 */
/**
 * Shared IMPURE container-host resolution preamble for the image/container
 * command families (`image:build` / `image:list` / `image:rm` / `image:run`,
 * `container:ps` / `container:stop`). Every handler resolves the SAME host
 * through the same precedence, so a `container:*` verb always acts on the host
 * `image:build` builds onto.
 *
 * Impure by design — it reads the injected `getEnvVar` / `GINA_HOMEDIR`
 * globals and probes the local buildah binary — which is why it lives here
 * (cmd-handler scope, where those globals exist) and NOT in `lib/image-build`,
 * whose tests require the pure lib standalone with no globals.
 *
 * NOT a command: the dispatcher resolves `gina image:_host` to this file, but
 * the export is a plain object, so its `require(path)(opt, cmd)` call throws
 * and exits non-zero through the dispatcher's own catch.
 */

/**
 * Reads the machine-level container-host fallback from
 * `~/.gina/<shortVersion>/settings.json` (`container.host`). Absent or
 * unreadable settings resolve to null — resolution then falls through to the
 * native/error branches.
 *
 * @function getSettingsContainerHost
 * @returns {string|null} The configured descriptor, or null
 *
 * @example
 * var hostUtil = require('./_host');
 * hostUtil.getSettingsContainerHost(); // 'ssh://build@lin' or null
 */
function getSettingsContainerHost() {
    try {
        var version = getEnvVar('GINA_VERSION') || require(__dirname + '/../../../../../package.json').version;
        var short   = version.split('.').slice(0, 2).join('.');
        var raw     = fs.readFileSync(GINA_HOMEDIR + '/' + short + '/settings.json', 'utf8');
        var parsed  = JSON.parse(raw);
        return (parsed.container && parsed.container.host) ? String(parsed.container.host) : null;
    } catch (e) {
        return null;
    }
}

/**
 * Resolves the container host with `image:build`'s exact precedence: the
 * `GINA_CONTAINER_HOST` env override, then a Linux host with buildah on PATH
 * (native), then `container.host` from the settings, otherwise an actionable
 * error descriptor.
 *
 * The env override is read through the injected `getEnvVar` global — the CLI
 * bootstrap sweeps every `GINA_*` OS env var into `process.gina` and DELETES
 * it from `process.env` (utils/helper.js `filterArgs`), so a bare
 * `process.env` read never sees it; the `process.env` fallback covers
 * contexts where the sweep never ran.
 *
 * A malformed descriptor (the resolver's throw case) is folded into the same
 * `{ mode: 'error' }` shape, so every caller degrades through its existing
 * `host.mode === 'error'` check instead of an uncaught stack.
 *
 * @function resolveHost
 * @returns {object} A `ContainerHost` descriptor from
 *   `lib/image-build.resolveContainerHost` — `{ mode: 'native' }`,
 *   `{ mode: 'ssh', descriptor, parsed }`, or `{ mode: 'error', reason }`
 *
 * @example
 * var hostUtil = require('./_host');
 * var host = hostUtil.resolveHost();
 * if (host.mode === 'error') return fail(host.reason);
 */
function resolveHost() {
    var imageBuild = lib.imageBuild;

    var hasBuildah = false;
    if (process.platform === 'linux') {
        try {
            hasBuildah = (spawnSync('buildah', ['--version']).status === 0);
        } catch (e) {
            hasBuildah = false;
        }
    }

    var envHost = getEnvVar('GINA_CONTAINER_HOST') || process.env.GINA_CONTAINER_HOST || null;

    try {
        return imageBuild.resolveContainerHost({
            envValue      : envHost,
            settingsValue : getSettingsContainerHost(),
            platform      : process.platform,
            hasBuildah    : hasBuildah
        });
    } catch (e) {
        return { mode: 'error', reason: (e.message || String(e)) };
    }
}

module.exports = {
    getSettingsContainerHost : getSettingsContainerHost,
    resolveHost              : resolveHost
};
