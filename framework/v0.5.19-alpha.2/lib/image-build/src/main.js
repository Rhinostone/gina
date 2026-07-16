'use strict';
/**
 * Gina.Lib.ImageBuild
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, extend, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * @module gina/lib/image-build
 * @description Pure OCI packaging primitives backing the `image:build` CLI
 * command. Everything here is deliberately free of framework globals — callers
 * pass data in (the `cmd-status-format` contract) — so the module can be
 * required by path from unit tests.
 *
 * Responsibilities:
 *  - Containerfile + entrypoint synthesis (standard OCI — buildable by
 *    buildah, docker, podman or any OCI builder; zero lock-in).
 *  - Deterministic in-container port computation: an exact replica of the
 *    `bin/gina-init` allocator, so the synthesized `EXPOSE` matches the port
 *    the bundle will actually bind at container start.
 *  - Build-context staging: an allowlist copy of the project tree. Config
 *    files ride BYTE-VERBATIM — `${secret:KEY}` placeholders are never
 *    resolved here; they resolve from the container's environment at runtime
 *    (`core/config.js` at bundle boot). This module must never require or
 *    call the secrets resolver.
 *  - Container-host descriptor resolution (native buildah vs `ssh://` remote).
 */

var fs   = require('fs');
var path = require('path');

/**
 * Defaults mirroring `bin/gina-init` — used only when a project entry is
 * missing a field (a registered project always carries them).
 *
 * @constant {object} DEFAULTS
 */
var DEFAULTS = {
    protocols   : ['http/1.1', 'http/2.0'],
    schemes     : ['http', 'https'],
    envs        : ['dev', 'prod'],
    scopes      : ['local', 'production'],
    portStart   : 3100,
    nodeFloor   : 22,
    defProtocol : 'http/2.0',
    defScheme   : 'https'
};

/**
 * @typedef {object} PortMaps
 * @property {object} ports        - Forward map: `{ protocol: { scheme: { "<port>": "<bundle>@<project>/<env>" } } }`
 * @property {object} portsReverse - Reverse map: `{ "<bundle>@<project>": { env: { protocol: { scheme: port } } } }`
 */

/**
 * Computes the ports `bin/gina-init` will allocate inside the container for
 * the given inputs. This is an EXACT replica of the gina-init allocator
 * (protocol → scheme → bundle → env iteration, sequential `nextPort++`,
 * HTTP/2 cleartext `http/2.0` + `http` skipped) — keep the two in sync; the
 * unit suite compares this replica against the real `bin/gina-init` output.
 *
 * @function computePorts
 * @param {object}   opts
 * @param {string}   opts.projectName - Project name
 * @param {string[]} opts.protocols   - Supported protocols, declaration order
 * @param {string[]} opts.schemes     - Supported schemes, declaration order
 * @param {string[]} opts.bundles     - Bundle names, declaration order
 * @param {string[]} opts.envs        - Envs, declaration order
 * @param {number}   opts.portStart   - First port to allocate
 * @returns {PortMaps} The forward and reverse port maps
 *
 * @example
 * var maps = computePorts({
 *     projectName: 'myproject',
 *     protocols: ['http/1.1', 'http/2.0'], schemes: ['http', 'https'],
 *     bundles: ['demo'], envs: ['dev', 'prod'], portStart: 3100
 * });
 * // maps.portsReverse['demo@myproject'].prod['http/1.1'].http === 3101
 */
function computePorts(opts) {
    var portsOut        = {};
    var portsReverseOut = {};
    var nextPort        = opts.portStart;

    opts.protocols.forEach(function(protocol) {
        portsOut[protocol] = {};
        opts.schemes.forEach(function(scheme) {
            portsOut[protocol][scheme] = {};
        });
    });

    opts.protocols.forEach(function(protocol) {
        opts.schemes.forEach(function(scheme) {
            // HTTP/2 cleartext — skipped by the gina-init allocator
            if (protocol === 'http/2.0' && scheme === 'http') return;

            opts.bundles.forEach(function(bundle) {
                opts.envs.forEach(function(env) {
                    var port  = nextPort++;
                    var label = bundle + '@' + opts.projectName + '/' + env;
                    var key   = bundle + '@' + opts.projectName;

                    portsOut[protocol][scheme][String(port)] = label;

                    if (!portsReverseOut[key])                portsReverseOut[key] = {};
                    if (!portsReverseOut[key][env])           portsReverseOut[key][env] = {};
                    if (!portsReverseOut[key][env][protocol]) portsReverseOut[key][env][protocol] = {};
                    portsReverseOut[key][env][protocol][scheme] = port;
                });
            });
        });
    });

    return { ports: portsOut, portsReverse: portsReverseOut };
}

/**
 * Parses the major version floor out of an engine range string.
 *
 * @function parseNodeFloor
 * @param {string} [engineStr] - e.g. `">= 22 <27"`
 * @returns {number} The floor major (defaults to 22 when unparseable)
 *
 * @example
 * parseNodeFloor('>= 22 <27'); // 22
 * parseNodeFloor(undefined);   // 22
 */
function parseNodeFloor(engineStr) {
    var m = String(engineStr || '').match(/>=?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : DEFAULTS.nodeFloor;
}

/**
 * @typedef {object} BuildPlan
 * @property {string}   projectName  - Project name
 * @property {string}   bundleName   - Target bundle
 * @property {string}   bundleSrc    - Bundle source dir, relative to the project root
 * @property {string}   env          - Selected env (baked as GINA_DEF_ENV)
 * @property {string}   devEnv       - The project's dev env (baked as GINA_DEV_ENV)
 * @property {string}   scope        - Selected scope (baked as GINA_DEF_SCOPE)
 * @property {string[]} envs         - All project envs
 * @property {string[]} scopes       - All project scopes
 * @property {string[]} protocols    - All project protocols
 * @property {string[]} schemes      - All project schemes
 * @property {string}   defProtocol  - Default protocol (port-resolution key)
 * @property {string}   defScheme    - Default scheme (port-resolution key)
 * @property {number}   portStart    - First in-container port (GINA_PORT_START)
 * @property {number}   exposedPort  - The port the bundle binds for env/defProtocol/defScheme
 * @property {string}   ginaVersion  - Framework version installed in the image
 * @property {string}   baseImage    - Base image (node floor major, slim variant)
 * @property {boolean}  needsRelease - True when env is not the dev env (release tree built in-image)
 * @property {boolean}  hasDependencies - True when the project package.json declares dependencies
 * @property {boolean}  hasLockfile  - True when the project has a package-lock.json
 * @property {string}   tag          - Image reference (repo[:tag])
 * @property {string}   image        - Alias of tag (full image reference)
 * @property {string|null} platform  - OS/ARCH passed to the builder, or null for host-native
 */

/**
 * Validates the inputs and resolves the full build plan — every value the
 * Containerfile synthesis and the builder invocation need. Throws an `Error`
 * whose `message` is the user-facing reason (printed on stdout, exit 1) when
 * an input is missing, unknown or ambiguous.
 *
 * Env inference when `--env` is omitted: a single-env project uses that env;
 * a project with exactly one non-dev env uses it (the deployable artifact
 * default); anything else must pass `--env`. Scope inference when `--scope`
 * is omitted: a non-dev env defaults to the project's production scope, the
 * dev env to the project's default scope.
 *
 * @function resolveBuildPlan
 * @param {object}  input
 * @param {string}  input.projectName    - Project name (registered)
 * @param {object}  input.projectEntry   - The project's `~/.gina/projects.json` entry
 * @param {object}  input.manifest       - The project's `manifest.json` (parsed)
 * @param {string}  [input.bundleName]   - Target bundle (inferred for single-bundle projects)
 * @param {string}  [input.env]          - Target env
 * @param {string}  [input.scope]        - Target scope
 * @param {number}  [input.portStart]    - In-container port base (default 3100)
 * @param {string}  [input.tag]          - Image reference override
 * @param {string}  [input.ginaVersion]  - Framework version override
 * @param {string}  [input.platform]     - `linux/arm64` or `linux/amd64`
 * @param {string}  [input.nodeEngine]   - The framework's engine range (e.g. ">= 22 <27")
 * @param {boolean} [input.hasDependencies] - Project package.json declares dependencies
 * @param {boolean} [input.hasLockfile]  - Project has a package-lock.json
 * @returns {BuildPlan} The resolved plan
 * @throws {Error} With a user-facing reason on any invalid or ambiguous input
 *
 * @example
 * var plan = resolveBuildPlan({
 *     projectName: 'myproject',
 *     projectEntry: projects['myproject'],   // from ~/.gina/projects.json
 *     manifest: manifest,                    // from <project>/manifest.json
 *     env: 'prod'
 * });
 * // plan.exposedPort, plan.needsRelease, plan.tag ...
 */
function resolveBuildPlan(input) {
    var projectName  = input.projectName;
    var projectEntry = input.projectEntry || {};
    var manifest     = input.manifest || {};
    var bundlesMap   = manifest.bundles || {};
    var bundleNames  = Object.keys(bundlesMap);

    if (!projectName) {
        throw new Error('missing project name — usage: gina image:build [<bundle>] @<project> [--env=<env>]');
    }
    if (bundleNames.length === 0) {
        throw new Error('project @' + projectName + ' has no bundles in its manifest.json — add one with: gina bundle:add <bundle> @' + projectName);
    }

    // -- bundle -----------------------------------------------------------
    var bundleName = input.bundleName || null;
    if (!bundleName) {
        if (bundleNames.length === 1) {
            bundleName = bundleNames[0];
        } else {
            throw new Error('project @' + projectName + ' has several bundles (' + bundleNames.join(', ') + ') — name one: gina image:build <bundle> @' + projectName);
        }
    }
    if (bundleNames.indexOf(bundleName) < 0) {
        throw new Error('bundle `' + bundleName + '` not found in @' + projectName + ' manifest.json (available: ' + bundleNames.join(', ') + ')');
    }
    var bundleSrc = bundlesMap[bundleName].src || ('bundles/' + bundleName);

    // -- env ---------------------------------------------------------------
    var envs   = (projectEntry.envs && projectEntry.envs.length) ? projectEntry.envs : DEFAULTS.envs.slice();
    var devEnv = projectEntry.dev_env || projectEntry.def_env || envs[0];
    var env    = input.env || null;
    if (env) {
        if (envs.indexOf(env) < 0) {
            throw new Error('env `' + env + '` is not one of @' + projectName + ' envs (' + envs.join(', ') + ')');
        }
    } else {
        var nonDev = envs.filter(function(e) { return e !== devEnv; });
        if (envs.length === 1) {
            env = envs[0];
        } else if (nonDev.length === 1) {
            env = nonDev[0];
        } else {
            throw new Error('cannot infer the target env for @' + projectName + ' (envs: ' + envs.join(', ') + ') — pass --env=<env>');
        }
    }

    // -- scope --------------------------------------------------------------
    var scopes = (projectEntry.scopes && projectEntry.scopes.length) ? projectEntry.scopes : DEFAULTS.scopes.slice();
    var scope  = input.scope || null;
    if (scope) {
        if (scopes.indexOf(scope) < 0) {
            throw new Error('scope `' + scope + '` is not one of @' + projectName + ' scopes (' + scopes.join(', ') + ')');
        }
    } else {
        scope = (env !== devEnv)
            ? (projectEntry.production_scope || scopes[scopes.length - 1])
            : (projectEntry.def_scope || scopes[0]);
    }

    // -- protocols / schemes / port ------------------------------------------
    var protocols   = (projectEntry.protocols && projectEntry.protocols.length) ? projectEntry.protocols : DEFAULTS.protocols.slice();
    var schemes     = (projectEntry.schemes && projectEntry.schemes.length) ? projectEntry.schemes : DEFAULTS.schemes.slice();
    var defProtocol = projectEntry.def_protocol || DEFAULTS.defProtocol;
    var defScheme   = projectEntry.def_scheme || DEFAULTS.defScheme;

    var portStart = (typeof input.portStart !== 'undefined' && input.portStart !== null) ? parseInt(input.portStart, 10) : DEFAULTS.portStart;
    if (isNaN(portStart) || portStart < 1 || portStart > 65534) {
        throw new Error('--start-port-from must be a number between 1 and 65534');
    }

    var maps = computePorts({
        projectName : projectName,
        protocols   : protocols,
        schemes     : schemes,
        bundles     : [bundleName],
        envs        : envs,
        portStart   : portStart
    });
    var byEnv       = maps.portsReverse[bundleName + '@' + projectName] || {};
    var byProto     = (byEnv[env] || {})[defProtocol] || {};
    var exposedPort = byProto[defScheme];
    if (typeof exposedPort === 'undefined') {
        throw new Error('no port resolvable for `' + bundleName + '@' + projectName + '/' + env + '` with def_protocol `' + defProtocol + '` + def_scheme `' + defScheme + '` (HTTP/2 cleartext is never allocated) — adjust the project defaults');
    }

    // -- framework version -----------------------------------------------------
    var ginaVersion = input.ginaVersion || String(projectEntry.framework || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(ginaVersion)) {
        throw new Error('cannot resolve the gina version to install (project entry framework: `' + (projectEntry.framework || 'unset') + '`) — pass --gina-version=<version>');
    }

    // -- image reference --------------------------------------------------------
    var tag = input.tag || (projectName + '/' + bundleName + ':' + env);
    if (!/^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?$/.test(tag) || /\/\//.test(tag)) {
        throw new Error('invalid image reference `' + tag + '` — expected [registry/]repo[:tag], lowercase repo');
    }

    // -- platform ------------------------------------------------------------------
    var platform = input.platform || null;
    if (platform && !/^linux\/(arm64|amd64)$/.test(platform)) {
        throw new Error('--platform must be linux/arm64 or linux/amd64 (got `' + platform + '`)');
    }

    return {
        projectName     : projectName,
        bundleName      : bundleName,
        bundleSrc       : bundleSrc,
        env             : env,
        devEnv          : devEnv,
        scope           : scope,
        envs            : envs,
        scopes          : scopes,
        protocols       : protocols,
        schemes         : schemes,
        defProtocol     : defProtocol,
        defScheme       : defScheme,
        portStart       : portStart,
        exposedPort     : exposedPort,
        ginaVersion     : ginaVersion,
        baseImage       : 'node:' + parseNodeFloor(input.nodeEngine) + '-slim',
        needsRelease    : (env !== devEnv),
        hasDependencies : !!input.hasDependencies,
        hasLockfile     : !!input.hasLockfile,
        tag             : tag,
        image           : tag,
        platform        : platform
    };
}

/**
 * Renders the synthesized Containerfile for a resolved plan. The output is
 * standard OCI — every instruction is plain Containerfile syntax accepted by
 * buildah, docker and podman alike. `${secret:KEY}` references in the copied
 * project config are deliberately untouched: they resolve from the container
 * environment at runtime, so no `ENV` line for any secret is ever emitted.
 *
 * @function renderContainerfile
 * @param {BuildPlan} plan - A plan from {@link resolveBuildPlan}
 * @returns {string} The Containerfile content
 *
 * @example
 * var containerfile = renderContainerfile(plan);
 * // -> "FROM node:22-slim\n..."
 */
function renderContainerfile(plan) {
    var lines = [];

    lines.push('# Containerfile — synthesized by `gina image:build` for ' + plan.bundleName + '@' + plan.projectName + ' (env: ' + plan.env + ', scope: ' + plan.scope + ')');
    lines.push('# Standard OCI — buildable with buildah, docker, podman or any OCI builder.');
    lines.push('# Config placeholders like ${secret:KEY} ride verbatim and resolve from the');
    lines.push('# container environment at runtime — no secret value is baked into a layer.');
    lines.push('FROM ' + plan.baseImage);
    lines.push('');
    lines.push('# gina-init and gina-container expect a writable home directory');
    lines.push('ENV HOME=/home/node');
    lines.push('RUN mkdir -p $HOME && chown node:node $HOME');
    lines.push('');
    lines.push('WORKDIR /app');
    lines.push('');
    lines.push('# Framework — pinned to the project\'s registered gina version. The install');
    lines.push('# runs as root and the framework postinstall seeds $HOME/.gina root-owned;');
    lines.push('# WORKDIR created /app root-owned too (COPY --chown fixes files, not the');
    lines.push('# dir) — hand both back to the runtime user before USER node.');
    lines.push('RUN npm install -g gina@' + plan.ginaVersion + ' --unsafe-perm && chown -R node:node $HOME /app');
    lines.push('');
    lines.push('# Project source (staged build context — see the context manifest)');
    lines.push('COPY --chown=node:node . .');

    if (plan.hasDependencies) {
        lines.push('');
        lines.push('# Project dependencies — a dependency on gina re-runs the framework');
        lines.push('# postinstall as root (HOME=/home/node), re-seeding $HOME/.gina root-owned');
        lines.push('# after the earlier hand-back: re-hand $HOME back after this LAST root-run');
        lines.push('# npm step, or gina-init EACCESes once the build drops privileges.');
        lines.push(plan.hasLockfile
            ? 'RUN npm ci --omit=dev && chown -R node:node $HOME'
            : 'RUN npm install --omit=dev && chown -R node:node $HOME');
    }

    lines.push('');
    lines.push('# The bundle entry resolves the framework via node_modules/gina — link the');
    lines.push('# pinned global install (the project:add auto-link convention), superseding');
    lines.push('# any copy the project\'s own dependencies extracted there (`ln -sfn` cannot');
    lines.push('# replace a real directory — it would nest inside it and the pin would be');
    lines.push('# silently bypassed at runtime). Placed after any npm install, which prunes');
    lines.push('# symlinks it does not know about.');
    lines.push('RUN mkdir -p node_modules && rm -rf node_modules/gina && ln -sfn /usr/local/lib/node_modules/gina node_modules/gina');

    lines.push('');
    lines.push('# gina runtime identity — consumed by gina-init (idempotent ~/.gina bootstrap)');
    lines.push('ENV GINA_PROJECT_NAME=' + plan.projectName + ' \\');
    lines.push('    GINA_BUNDLES=' + plan.bundleName + ' \\');
    lines.push('    GINA_PROJECT_PATH=/app \\');
    lines.push('    GINA_ENVS=' + plan.envs.join(',') + ' \\');
    lines.push('    GINA_DEF_ENV=' + plan.env + ' \\');
    lines.push('    GINA_DEV_ENV=' + plan.devEnv + ' \\');
    lines.push('    GINA_SCOPES=' + plan.scopes.join(',') + ' \\');
    lines.push('    GINA_DEF_SCOPE=' + plan.scope + ' \\');
    lines.push('    GINA_PROTOCOLS="' + plan.protocols.join(',') + '" \\');
    lines.push('    GINA_DEF_PROTOCOL="' + plan.defProtocol + '" \\');
    lines.push('    GINA_SCHEMES=' + plan.schemes.join(',') + ' \\');
    lines.push('    GINA_DEF_SCHEME=' + plan.defScheme + ' \\');
    lines.push('    GINA_PORT_START=' + plan.portStart);
    lines.push('');
    lines.push('USER node');

    if (plan.needsRelease) {
        lines.push('');
        lines.push('# `' + plan.env + '` is not the dev env: gina-container resolves the release tree,');
        lines.push('# built here by the framework itself (dev/prod parity).');
        lines.push('RUN gina-init && gina bundle:build ' + plan.bundleName + ' @' + plan.projectName + ' --env=' + plan.env + ' --scope=' + plan.scope);
    }

    lines.push('');
    lines.push('# The port gina-init allocates for ' + plan.env + '/' + plan.defProtocol + '/' + plan.defScheme + ' (deterministic)');
    lines.push('EXPOSE ' + plan.exposedPort);
    lines.push('');
    lines.push('# gina-init bootstraps ~/.gina (idempotent), gina-container runs the bundle in');
    lines.push('# the foreground and forwards SIGTERM for graceful drain.');
    lines.push('ENTRYPOINT ["/app/gina-entrypoint.sh"]');
    lines.push('CMD ["' + plan.bundleName + '", "@' + plan.projectName + '"]');
    lines.push('');

    return lines.join('\n');
}

/**
 * Renders the container entrypoint script staged alongside the Containerfile.
 *
 * @function renderEntrypoint
 * @returns {string} The entrypoint script content
 *
 * @example
 * fs.writeFileSync(stagingDir + '/gina-entrypoint.sh', renderEntrypoint(), { mode: 0o755 });
 */
function renderEntrypoint() {
    return [
        '#!/bin/sh',
        'set -e',
        '',
        '# Bootstrap ~/.gina/ state files from environment variables.',
        '# Safe to run on every start — gina-init is idempotent.',
        'gina-init',
        '',
        '# Start the bundle in the foreground (SIGTERM is forwarded for graceful drain).',
        'exec gina-container "$@"',
        ''
    ].join('\n');
}

/**
 * The build-context allowlist for a plan. Staging copies ONLY what the
 * container needs: the project's portable root files, the target bundle's
 * source tree and the optional `shared/` tree. Everything else (VCS state,
 * dependencies, logs, releases, OS litter) stays out — dependencies are
 * reinstalled in-image and the release tree is rebuilt in-image when needed.
 *
 * @function contextSpec
 * @param {BuildPlan} plan - A plan from {@link resolveBuildPlan}
 * @returns {{rootFiles: string[], dirs: string[], excludeNames: string[]}} The allowlist rules
 */
function contextSpec(plan) {
    return {
        rootFiles    : ['manifest.json', 'env.json', 'package.json', 'package-lock.json'],
        dirs         : [plan.bundleSrc, 'shared'],
        excludeNames : ['node_modules', '.git', '.gitignore', '.DS_Store', 'logs', 'tmp', 'cache', 'releases']
    };
}

/**
 * Walks a context-spec dir recursively, invoking `onFile(absPath, relPath)`
 * for every included file. Entries named in `excludeNames` are skipped at
 * any depth. Symbolic links are skipped (a build context must be
 * self-contained; links out of the tree cannot ride into an image).
 *
 * @inner
 * @private
 * @param {string}   base         - Project root
 * @param {string}   rel          - Dir to walk, relative to base
 * @param {string[]} excludeNames - Names excluded at any depth
 * @param {function} onFile       - Callback (absPath, relPath)
 * @returns {void}
 */
function walkDir(base, rel, excludeNames, onFile) {
    var abs = path.join(base, rel);
    var entries;
    try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (e) {
        return; // dir vanished mid-walk — treat as absent
    }
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (excludeNames.indexOf(entry.name) > -1) continue;
        var childRel = rel + '/' + entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            walkDir(base, childRel, excludeNames, onFile);
        } else if (entry.isFile()) {
            onFile(path.join(base, childRel), childRel);
        }
    }
}

/**
 * Lists the context files a plan would stage, WITHOUT copying anything —
 * the `--emit` view. Synthesized entries (`Containerfile`,
 * `gina-entrypoint.sh`) are appended so the manifest is the complete
 * context listing.
 *
 * @function listContext
 * @param {BuildPlan} plan        - A plan from {@link resolveBuildPlan}
 * @param {string}    projectPath - The project root on disk
 * @returns {string[]} Sorted context-relative paths
 */
function listContext(plan, projectPath) {
    var spec  = contextSpec(plan);
    var files = [];
    spec.rootFiles.forEach(function(name) {
        if (fs.existsSync(path.join(projectPath, name))) files.push(name);
    });
    spec.dirs.forEach(function(dir) {
        if (fs.existsSync(path.join(projectPath, dir))) {
            walkDir(projectPath, dir, spec.excludeNames, function(absPath, relPath) {
                files.push(relPath);
            });
        }
    });
    files.sort();
    files.push('Containerfile');
    files.push('gina-entrypoint.sh');
    return files;
}

/**
 * Stages the build context into `stagingDir`: allowlisted project files are
 * copied BYTE-VERBATIM (`fs.copyFileSync` — the `${secret:KEY}`-never-baked
 * guarantee), then the synthesized `Containerfile` and executable
 * `gina-entrypoint.sh` are written at the staging root.
 *
 * @function stageContext
 * @param {BuildPlan} plan        - A plan from {@link resolveBuildPlan}
 * @param {string}    projectPath - The project root on disk
 * @param {string}    stagingDir  - Destination directory (created if missing)
 * @returns {{files: string[], containerfilePath: string}} The staged manifest
 *
 * @example
 * var staged = stageContext(plan, '/path/to/project', '/tmp/ctx');
 * // staged.files -> ['Containerfile', 'gina-entrypoint.sh', 'manifest.json', 'src/demo/index.js', ...]
 */
function stageContext(plan, projectPath, stagingDir) {
    var spec  = contextSpec(plan);
    var files = [];

    fs.mkdirSync(stagingDir, { recursive: true });

    var copyOne = function(absPath, relPath) {
        var dest = path.join(stagingDir, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(absPath, dest); // byte-verbatim — placeholders untouched
        files.push(relPath);
    };

    spec.rootFiles.forEach(function(name) {
        var abs = path.join(projectPath, name);
        if (fs.existsSync(abs)) copyOne(abs, name);
    });
    spec.dirs.forEach(function(dir) {
        if (fs.existsSync(path.join(projectPath, dir))) {
            walkDir(projectPath, dir, spec.excludeNames, copyOne);
        }
    });
    files.sort();

    var containerfilePath = path.join(stagingDir, 'Containerfile');
    fs.writeFileSync(containerfilePath, renderContainerfile(plan));
    fs.writeFileSync(path.join(stagingDir, 'gina-entrypoint.sh'), renderEntrypoint(), { mode: 448 + 40 + 5 }); // 0755

    files.push('Containerfile');
    files.push('gina-entrypoint.sh');

    return { files: files, containerfilePath: containerfilePath };
}

/**
 * @typedef {object} SshDescriptor
 * @property {string|null} user      - Login user, or null (ssh config decides)
 * @property {string}      host      - Hostname or address
 * @property {number|null} port      - Explicit TCP port, or null — the user's
 *                                     ssh config decides (host aliases may
 *                                     define their own Port/ProxyCommand;
 *                                     forcing 22 would override them)
 * @property {string}      sshTarget - `user@host` or `host`
 */

/**
 * Parses a container-host descriptor of the form `ssh://[user@]host[:port]`.
 *
 * @function parseSshDescriptor
 * @param {string} str - The descriptor string
 * @returns {SshDescriptor} The parsed descriptor
 * @throws {Error} When the descriptor does not match the expected form
 *
 * @example
 * parseSshDescriptor('ssh://build@10.0.0.5:2222');
 * // { user: 'build', host: '10.0.0.5', port: 2222, sshTarget: 'build@10.0.0.5' }
 * @example
 * parseSshDescriptor('ssh://lin');
 * // { user: null, host: 'lin', port: null, sshTarget: 'lin' } — ssh config decides the port
 */
function parseSshDescriptor(str) {
    var m = String(str || '').match(/^ssh:\/\/(?:([A-Za-z0-9._-]+)@)?([A-Za-z0-9._-]+)(?::(\d{1,5}))?\/?$/);
    if (!m) {
        throw new Error('invalid container-host descriptor `' + str + '` — expected ssh://[user@]host[:port]');
    }
    var port = m[3] ? parseInt(m[3], 10) : null;
    if (port !== null && (port < 1 || port > 65535)) {
        throw new Error('invalid container-host port in `' + str + '`');
    }
    return {
        user      : m[1] || null,
        host      : m[2],
        port      : port,
        sshTarget : (m[1] ? m[1] + '@' : '') + m[2]
    };
}

/**
 * @typedef {object} HostResolution
 * @property {string} mode              - 'native' | 'ssh' | 'error'
 * @property {string} [source]          - 'env' | 'settings' (ssh mode)
 * @property {string} [descriptor]      - The raw descriptor (ssh mode)
 * @property {SshDescriptor} [parsed]   - The parsed descriptor (ssh mode)
 * @property {string} [reason]          - The actionable error (error mode)
 */

/**
 * Resolves where the build executes. Precedence: the `GINA_CONTAINER_HOST`
 * env value (an explicit per-invocation override) wins; then a Linux host
 * with buildah on PATH builds natively; then the persistent settings
 * fallback (`container.host`); otherwise an actionable error naming both
 * configuration surfaces.
 *
 * @function resolveContainerHost
 * @param {object}  input
 * @param {string}  [input.envValue]      - The GINA_CONTAINER_HOST env value (the caller reads it)
 * @param {string}  [input.settingsValue] - settings.json `container.host`
 * @param {string}  input.platform        - process.platform
 * @param {boolean} input.hasBuildah      - True when buildah is on PATH
 * @returns {HostResolution} The resolution (never throws for the absent case)
 * @throws {Error} Only when a PRESENT descriptor is malformed
 *
 * @example
 * resolveContainerHost({ envValue: 'ssh://build@lin', platform: 'darwin', hasBuildah: false });
 * // { mode: 'ssh', source: 'env', descriptor: 'ssh://build@lin', parsed: {...} }
 */
function resolveContainerHost(input) {
    if (input.envValue) {
        return { mode: 'ssh', source: 'env', descriptor: input.envValue, parsed: parseSshDescriptor(input.envValue) };
    }
    if (input.platform === 'linux' && input.hasBuildah) {
        return { mode: 'native' };
    }
    if (input.settingsValue) {
        return { mode: 'ssh', source: 'settings', descriptor: input.settingsValue, parsed: parseSshDescriptor(input.settingsValue) };
    }
    return {
        mode   : 'error',
        reason : 'no container host: this machine cannot build natively (needs Linux with buildah on PATH) — set GINA_CONTAINER_HOST=ssh://[user@]host[:port] or add { "container": { "host": "ssh://..." } } to ~/.gina/<shortVersion>/settings.json'
    };
}

/**
 * Assembles the machine-readable one-shot result (`--format=json`, and the
 * payload of the `done` stream frame).
 *
 * @function buildOneShot
 * @param {BuildPlan} plan   - A plan from {@link resolveBuildPlan}
 * @param {object}    extras - Runtime results
 * @param {string}    [extras.imageId]    - The built image id (sha256-prefixed)
 * @param {number}    [extras.durationMs] - Wall-clock build duration
 * @param {string}    [extras.host]       - 'native' or the ssh descriptor
 * @returns {object} `{ project, bundle, image, tag, imageId?, durationMs, host, exposedPort }`
 */
function buildOneShot(plan, extras) {
    var out = {
        project     : plan.projectName,
        bundle      : plan.bundleName,
        image       : plan.image,
        tag         : plan.tag,
        durationMs  : extras.durationMs,
        host        : extras.host,
        exposedPort : plan.exposedPort
    };
    if (extras.imageId) out.imageId = extras.imageId;
    return out;
}

module.exports = {
    DEFAULTS             : DEFAULTS,
    computePorts         : computePorts,
    parseNodeFloor       : parseNodeFloor,
    resolveBuildPlan     : resolveBuildPlan,
    renderContainerfile  : renderContainerfile,
    renderEntrypoint     : renderEntrypoint,
    contextSpec          : contextSpec,
    listContext          : listContext,
    stageContext         : stageContext,
    parseSshDescriptor   : parseSshDescriptor,
    resolveContainerHost : resolveContainerHost,
    buildOneShot         : buildOneShot
};
