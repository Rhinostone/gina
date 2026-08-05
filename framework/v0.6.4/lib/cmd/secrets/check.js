var fs      = require('fs');
var console = lib.logger;

var CmdHelper = require('./../helper');

/**
 * @module gina/lib/cmd/secrets/check
 */
/**
 * Enumerates the `${secret:KEY}` placeholders each bundle requires (same
 * walk as `secrets:scan`) and cross-references the *current* `process.env`,
 * reporting each key as `SET` or `UNSET`. Exits non-zero when any required
 * key is unset, so it can gate a CI / pre-deploy step.
 *
 * Usage:
 *  gina secrets:check
 *  gina secrets:check @<project>
 *  gina secrets:check <bundle> @<project>
 *  gina secrets:check @<project> --format=json
 *  gina secrets:check @<project> --scope=<scope>
 *  gina secrets:check @<project> --scope=<scope> --env-file=<path>
 *
 * "Set" matches the env backend's fail-closed rule exactly: a key counts
 * as satisfied only when its value is a **non-empty string** — the same
 * condition under which `secrets.resolve()` would succeed at bundle start.
 * So an `UNSET` here is precisely a key that would throw at load.
 *
 * `--scope=<s>`: enumerate the *effective* keys for that scope by read-only
 * overlaying the sibling `config_<s>/` dirs over the base (see `secrets:scan`).
 * `--env-file=<path>`: stand in for the live `process.env` — e.g. a decrypted
 * SOPS export or a CI-exported env. It occupies the *environment tier*, which
 * outranks the file tier below, so an explicit file still wins.
 *
 * Two tiers, because the runtime has two. Since the file backend shipped, a
 * bundle may declare `settings.secrets.file`, and `core/config.js` resolves
 * placeholders against the environment first and those files second. Checking
 * the environment alone therefore reported `UNSET` for a key the bundle would
 * have started with — a false alarm on the very gate that exists to prevent
 * surprises. This command now resolves the bundle's declared chain with the
 * same `whisper` dictionary the runtime uses and consults it as the lower
 * tier, so the two sides cannot disagree about what a file means (they share
 * `lib/secrets`'s parser) nor about where it lives (they share the token
 * substitution).
 *
 * Caveat: without `--env-file` this checks the env of THIS CLI process, not a
 * detached bundle's runtime/container environment. Real value: a CI step that
 * exports (or decrypts) the scope's secrets and runs `secrets:check --scope=…
 * --env-file=…` before shipping. It cannot introspect an already-running
 * bundle's env.
 *
 * Second caveat, and the reason the report names its assumptions: `${scope}`
 * and `${env}` are *launch-time* values. The runtime reads `NODE_SCOPE` /
 * `NODE_ENV` from whatever started the bundle; this process can only see
 * `--scope` / `--env` or the project defaults. When a declared path embeds a
 * token this command cannot resolve, it says so and skips the file tier
 * rather than statting a literally-named path — which can only make the gate
 * stricter than the runtime, never laxer.
 *
 * @class Check
 * @constructor
 * @param {object} opt - Parsed command-line options
 * @param {object} opt.client - Socket client for terminal output
 * @param {string[]} opt.argv - Full argv array
 * @param {number} [opt.debugPort] - Node.js inspector port
 * @param {boolean} [opt.debugBrkEnabled] - True when --inspect-brk is active
 * @param {object} cmd - The cmd dispatcher object (lib/cmd/index.js)
 */
function Check(opt, cmd) {
    var self = { format: 'text', anyUnset: false, scopeName: null, envName: null, envFile: null, envMap: null };

    var secrets = lib.secrets;
    var merge   = lib.merge;

    /**
     * Matches any `${…}` token the substitution pass did not resolve. Mirrors
     * the guard in `lib/secrets/src/main.js` so this command rejects exactly
     * what the runtime would reject.
     *
     * @inner
     * @constant
     * @type {RegExp}
     */
    var UNRESOLVED_TOKEN = /\$\{[^}]*\}/;

    /**
     * Config files are JSON. The loader globs every `.json` in a config
     * dir; this matches that, then drops dotfiles and `* copy` siblings.
     *
     * @inner
     * @constant
     * @type {RegExp}
     */
    var JSON_EXT = /\.json$/;

    /**
     * Parses `--format`, resolves project + optional bundle via CmdHelper,
     * dispatches to the right checker, and exits non-zero if any required
     * secret is unset.
     *
     * @inner
     * @private
     */
    var init = function () {
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
        if ( !isCmdConfigured() ) return false;

        self.anyUnset = false;

        for (var i = 3, len = process.argv.length; i < len; i++) {
            var arg = process.argv[i];
            if ( /^\-\-format\=/.test(arg) ) {
                self.format = arg.split(/\=/)[1] || 'text';
            }
        }
        if (self.format !== 'text' && self.format !== 'json') {
            console.error('--format must be `text` or `json` (got `' + self.format + '`)');
            process.exit(1);
            return;
        }

        // --scope + --env-file are declared in arguments.json and captured into
        // self.params by CmdHelper (filterArgs skips them for GINA_ mapping but
        // leaves them in argv for getParams — same path bundle:* --scope uses).
        self.scopeName = (self.params && self.params.scope) ? self.params.scope : null;
        self.envFile   = (self.params && self.params['env-file']) ? self.params['env-file'] : null;
        // `--env` is not one of the task prefixes CmdHelper re-applies to
        // `defaultEnv` (it does that only for start/stop/restart/build/deploy),
        // so read it off params exactly as --scope is read above. It is needed
        // because a project declares `homedir` per bundle AND per env.
        self.envName   = (self.params && self.params.env) ? self.params.env : (self.defaultEnv || null);
        // The scope a declared `secrets.file` path is resolved WITH is a
        // separate concern from `self.scopeName`, which selects the read-only
        // `config_<scope>/` overlay. Defaulting `scopeName` itself would start
        // applying that overlay to every bare `scan`/`check` — a behaviour
        // change nobody asked for — so the assumed scope lives in its own slot
        // and falls back to the project default, matching what the runtime
        // would use when no launcher overrides NODE_SCOPE.
        self.scopeAssumed = self.scopeName || self.defaultScope || null;
        if (self.envFile) {
            self.envMap = loadEnvFile(_(self.envFile, true));
            if (self.envMap === null) {
                console.error('--env-file not readable: ' + self.envFile);
                process.exit(1);
                return;
            }
        }

        var bundleFilter = self.name || null;

        if ( typeof(self.projectName) == 'undefined' || self.projectName == null ) {
            if (bundleFilter) {
                console.error('`secrets:check <bundle>` requires `@<project>`. Did you forget `@<project_name>`?');
                process.exit(1);
                return;
            }
            checkAll();
            process.exit(self.anyUnset ? 1 : 0);
            return;
        }

        if ( typeof(self.projects[self.projectName]) == 'undefined' ) {
            console.error('Project @' + self.projectName + ' is not registered. Run `gina project:list` to see registered projects.');
            process.exit(1);
            return;
        }

        if (bundleFilter) {
            var manifest = loadManifest(self.projects[self.projectName].path);
            if (manifest && manifest.bundles && !manifest.bundles[bundleFilter]) {
                console.error('Bundle [ ' + bundleFilter + ' ] is not registered inside `@' + self.projectName + '`.');
                process.exit(1);
                return;
            }
            checkBundleOnly(self.projectName, bundleFilter);
        } else {
            checkProjectOnly(self.projectName);
        }

        process.exit(self.anyUnset ? 1 : 0);
    };

    /**
     * Reads a JSON file with comment tolerance via `requireJSON`. Returns
     * `null` on any I/O or parse error.
     *
     * @inner
     * @private
     * @param {string} filePath
     * @returns {object|null}
     */
    var readJsonSafe = function (filePath) {
        try {
            if ( !fs.existsSync(filePath) ) return null;
            return requireJSON(filePath);
        } catch (e) {
            return null;
        }
    };

    /**
     * Parses a `.env`-style file into a `{ KEY: value }` map. Lines are
     * `KEY=value`; blank lines and `#` comments are skipped, an optional
     * `export ` prefix is stripped, and surrounding single/double quotes are
     * removed. Returns `null` when the file cannot be read (so the caller can
     * surface the error). Used by `--env-file`: validate a scope's exported /
     * decrypted env (e.g. SOPS output) instead of the live `process.env`.
     *
     * Delegates to `lib.secrets.parseEnvFile` rather than parsing here: this
     * handler answers "would a bundle started here resolve its placeholders?",
     * so it must read a file byte-for-byte the way the runtime resolver would.
     * A second copy of the parser could drift on a quoted value or a CRLF line
     * ending and report a clean bill of health for a file the runtime then
     * read differently — the exact false-green this command exists to prevent.
     *
     * @inner
     * @private
     * @param {string} filePath
     * @returns {Object<string,string>|null}
     */
    var loadEnvFile = function (filePath) {
        return secrets.parseEnvFile(filePath);
    };

    /**
     * Reads one named config file with the `--scope` overlay applied, using
     * the same merge direction as `collectKeysFromConfigDir` (scope wins,
     * base back-fills, `override=false` stated explicitly).
     *
     * @inner
     * @private
     * @param {string} absDir - Absolute base config directory
     * @param {string} name - File name, e.g. `settings.json`
     * @returns {object|null}
     */
    var readScopedConfig = function (absDir, name) {
        var base  = readJsonSafe(_(absDir + '/' + name, true));
        var scope = self.scopeName
            ? readJsonSafe(_(absDir + '_' + self.scopeName + '/' + name, true))
            : null;
        if (!scope) return base;
        return merge(JSON.clone(scope), base || {}, false);
    };

    /**
     * The effective `settings.json` for a bundle — `shared/config/` first with
     * the bundle's own on top. That direction mirrors the loader, which does
     * `merge(sharedMain, jsonFile, true)` (`core/config.js`): the bundle's own
     * file wins on a conflicting key. Both sides get the `--scope` overlay.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {object|null} manifest
     * @param {string} bundleName
     * @returns {object|null}
     */
    var readEffectiveSettings = function (projectPath, manifest, bundleName) {
        var bundleSrc = resolveBundleSrc(manifest, bundleName);
        var shared    = readScopedConfig(_(projectPath + '/shared/config', true), 'settings.json');
        var own       = readScopedConfig(_(projectPath + '/' + bundleSrc + '/config', true), 'settings.json');
        if (!shared) return own;
        if (!own) return shared;
        return merge(JSON.clone(shared), own, true);
    };

    /**
     * Rebuilds the subset of the runtime's substitution dictionary that a
     * secrets-file path may legitimately use. Deliberately partial: only keys
     * whose value this process can derive to the *same string* the runtime
     * derives are included.
     *
     * A key is set only when its value is a non-empty string. That is not
     * defensive tidiness — it is the contract. An absent key leaves its token
     * verbatim, which the caller then rejects loudly; an **empty** value is
     * substituted silently, so `${scope}` with `scope: ''` would collapse
     * `<home>/<scope>/secrets.env` to the base path and read the wrong file
     * without a word.
     *
     * `homedir` is read from the project's own `env.json` (`<bundle>.<env>`),
     * falling back to the framework template's `~/.<projectName>` — the same
     * two sources, in the same order, as `core/config.js`. It is emphatically
     * NOT `projects.json`'s `homedir` field: that is a CLI-level concept the
     * config loader never reads, and using it here would put this command on a
     * different path from the bundle it is meant to be validating.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {object|null} manifest - The project manifest, for the version tokens
     * @param {string} bundleName
     * @returns {Object<string,string>}
     */
    var buildReps = function (projectPath, manifest, bundleName) {
        var reps = {};
        var put  = function (key, value) {
            if (typeof value === 'string' && value !== '') reps[key] = value;
        };

        // Resolve the name from the PATH rather than trusting `self.projectName`:
        // the no-argument form iterates every registered project, and on that
        // branch `self.projectName` is undefined by definition. Using it there
        // built `~/.undefined` — a real, stat-able, wrong path that reported
        // every layer ABSENT instead of failing loudly.
        var projectName = self.projectName;
        for (var pn in (self.projects || {})) {
            if (self.projects[pn] && self.projects[pn].path === projectPath) {
                projectName = pn;
                break;
            }
        }

        put('projectName', projectName);
        // `${project}` is the project's PATH, not its name (getPath('project')).
        put('project', projectPath);
        put('projectPath', projectPath);
        put('executionPath', projectPath);
        put('root', projectPath);
        put('bundle', bundleName);
        put('frameworkDir', (typeof getEnvVar === 'function') ? getEnvVar('GINA_FRAMEWORK_DIR') : null);
        put('scope', self.scopeAssumed);
        put('env', self.envName);

        // Version tokens. The runtime gets these without listing them in the
        // bundle-config dictionary: `core/template/conf/env.json` declares
        // `projectVersion` / `projectVersionMajor` as per-bundle scalars, the
        // env-loading pass resolves them from the manifest, and the scalar
        // harvest then copies them into the dictionary that substitutes config.
        // Omitting them here made a path like `${homedir}/v${projectVersionMajor}/…`
        // unresolvable on this side while the bundle booted from it fine —
        // the file tier would be skipped and its keys reported UNSET, which is
        // the false alarm this command exists to prevent.
        if (manifest && typeof manifest.version === 'string' && manifest.version !== '') {
            put('projectVersion', manifest.version);
            put('projectVersionMajor', manifest.version.split(/\./g)[0]);
        }

        var declared = null;
        var envData  = readJsonSafe(_(projectPath + '/env.json', true));
        if (envData && envData[bundleName] && envData[bundleName][self.envName]) {
            declared = envData[bundleName][self.envName].homedir;
        }
        // `~` is expanded by whisper's own OS pass, not by `_()`, so the
        // template default is handed over verbatim exactly as the loader does.
        put('homedir', (typeof declared === 'string' && declared !== '')
            ? declared
            : (projectName ? '~/.' + projectName : null));

        return reps;
    };

    /**
     * Resolves a bundle's declared `settings.secrets.file` chain and layers the
     * readable files into one map, later entries winning — the same ordering
     * `lib/secrets/backends/file.js` applies.
     *
     * Validation mirrors `secrets.selectBackend` so this command accepts and
     * rejects exactly what a boot would: a non-string or empty entry, a
     * `${secret:…}` placeholder (unresolvable by definition — the backend that
     * would resolve it is the one being built), and any token the dictionary
     * did not know.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {object|null} manifest
     * @param {string} bundleName
     * @returns {{declared:boolean, layers:Array<{path:string, found:boolean, unreadable:boolean, code:(string|null), keys:number}>, map:(object|null), origin:(object|null), errors:string[]}}
     *   A layer is `unreadable` when it exists but could not be opened (`code` is the
     *   `fs` error, e.g. `'EACCES'`). That case also pushes an entry onto `errors`,
     *   because the runtime refuses to boot on it (#B267) — reporting it as a mere
     *   absence would green-light a config that cannot start.
     */
    var resolveSecretsFileChain = function (projectPath, manifest, bundleName) {
        var out = { declared: false, layers: [], map: null, origin: null, errors: [] };

        var settings = readEffectiveSettings(projectPath, manifest, bundleName);
        var declared = (settings && settings.secrets && typeof settings.secrets === 'object')
            ? settings.secrets.file
            : undefined;
        if (typeof declared === 'undefined' || declared === null) return out;

        var raw = Array.isArray(declared) ? declared : [declared];
        if (!raw.length) return out;
        out.declared = true;

        for (var i = 0; i < raw.length; i++) {
            if (typeof raw[i] !== 'string' || raw[i] === '') {
                out.errors.push('`settings.secrets.file` must be a non-empty string or an array of them');
                return out;
            }
            if (raw[i].indexOf('${secret:') > -1) {
                out.errors.push('`settings.secrets.file` cannot contain a `${secret:…}` placeholder');
                return out;
            }
        }

        var resolved;
        try {
            resolved = whisper(buildReps(projectPath, manifest, bundleName), JSON.clone(raw));
        } catch (whisperErr) {
            out.errors.push('could not substitute tokens in `settings.secrets.file`: ' + whisperErr.message);
            return out;
        }

        var map    = Object.create(null);
        var origin = Object.create(null);
        for (var p = 0; p < resolved.length; p++) {
            var path = resolved[p];
            if (UNRESOLVED_TOKEN.test(path)) {
                // Skip the whole tier rather than stat a literally-named path.
                // Under-reading can only make this gate stricter than the
                // runtime; guessing could make it laxer, which is the failure
                // this command exists to prevent.
                out.errors.push('unresolved token in `' + path + '`'
                    + ' — pass --scope/--env if it names one, since the runtime'
                    + ' reads those from whatever launches the bundle');
                return out;
            }
            var layerRead = secrets.readEnvFile(path);
            out.layers.push({
                path       : path,
                found      : layerRead.found,
                unreadable : (!layerRead.found && layerRead.code !== 'ENOENT'),
                code       : layerRead.code,
                keys       : layerRead.found ? Object.keys(layerRead.map).length : 0
            });
            if (!layerRead.found) {
                // #B267 parity — the runtime REFUSES to boot on a declared path that
                // exists but cannot be read. Reporting that as a plain absence here
                // would hand back a clean bill of health for a config that cannot
                // boot at all, which is precisely the checker-vs-runtime disagreement
                // this command exists to prevent.
                if (layerRead.code !== 'ENOENT') {
                    out.errors.push('`' + path + '` exists but cannot be read ('
                        + layerRead.code + ') — the runtime REFUSES to boot on this;'
                        + ' fix the file permissions or ownership');
                }
                continue;                      // absent file: contributes nothing, not an error
            }
            for (var key in layerRead.map) {
                map[key]    = layerRead.map[key];   // later path wins
                origin[key] = path;
            }
        }

        out.map    = map;
        out.origin = origin;
        return out;
    };

    /**
     * Loads `<projectPath>/manifest.json`. Returns `null` on failure.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @returns {object|null}
     */
    var loadManifest = function (projectPath) {
        return readJsonSafe(_(projectPath + '/manifest.json', true));
    };

    /**
     * Resolves a bundle's source-dir (relative to the project root) from
     * the manifest, mirroring `bundle:openapi`. Falls back to the bundle
     * name when `src` is absent.
     *
     * @inner
     * @private
     * @param {object|null} manifest
     * @param {string} bundleName
     * @returns {string}
     */
    var resolveBundleSrc = function (manifest, bundleName) {
        if ( manifest && manifest.bundles && manifest.bundles[bundleName] && manifest.bundles[bundleName].src ) {
            return manifest.bundles[bundleName].src;
        }
        return bundleName;
    };

    /**
     * Lists the `.json` files in `dir`, skipping dotfiles and `* copy`
     * siblings. Empty when the dir is absent.
     *
     * @inner
     * @private
     * @param {string} dir - Absolute config directory
     * @returns {string[]}
     */
    var listJsonFiles = function (dir) {
        if ( !fs.existsSync(dir) ) return [];
        var entries;
        try { entries = fs.readdirSync(dir); } catch (e) { return []; }
        var out = [];
        for (var i = 0; i < entries.length; i++) {
            var name = entries[i];
            if ( /^\./.test(name) ) continue;
            if ( /\s+copy/i.test(name) ) continue;
            if ( !JSON_EXT.test(name) ) continue;
            out.push(name);
        }
        out.sort();
        return out;
    };

    /**
     * Reads every `.json` under `absDir`, enumerates its required secret
     * keys, and adds them to `keySet` (a null-proto set). Mutates `keySet`.
     *
     * When `--scope=<s>` is active, the sibling `<absDir>_<scope>/` dir is
     * read-only deep-merged over the base per config file (scope wins) before
     * enumeration — mirroring a deploy's per-scope overlay — so the keys are
     * the *effective* ones that scope will require. Read-only introspection;
     * never touches the runtime config loader.
     *
     * @inner
     * @private
     * @param {string} absDir - Absolute base config directory to read
     * @param {object} keySet - Mutable null-proto set; key name -> true
     */
    var collectKeysFromConfigDir = function (absDir, keySet) {
        var scopeAbsDir = self.scopeName ? (absDir + '_' + self.scopeName) : null;
        var baseNames   = listJsonFiles(absDir);
        var scopeNames  = scopeAbsDir ? listJsonFiles(scopeAbsDir) : [];

        var names = baseNames.slice();
        for (var s = 0; s < scopeNames.length; s++) {
            if (names.indexOf(scopeNames[s]) < 0) names.push(scopeNames[s]);
        }

        for (var f = 0; f < names.length; f++) {
            var name         = names[f];
            var baseContent  = (baseNames.indexOf(name) > -1) ? readJsonSafe(_(absDir + '/' + name, true)) : null;
            var scopeContent = (scopeAbsDir && scopeNames.indexOf(name) > -1) ? readJsonSafe(_(scopeAbsDir + '/' + name, true)) : null;
            // scope deep-merges over base (scope wins); override=false is explicit (not
            // merge's default) so scope precedence stays correct even if lib/merge's
            // default override ever changes.
            var effective    = scopeContent ? merge(JSON.clone(scopeContent), baseContent || {}, false) : baseContent;
            if (!effective) continue;
            var keys = secrets.getRequiredKeys(effective);
            for (var k = 0; k < keys.length; k++) {
                keySet[keys[k]] = true;
            }
        }
    };

    /**
     * Computes the shared-config key set once per project. The loader
     * merges `shared/config/` into every bundle, so these keys are
     * required by each bundle.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @returns {object} Null-proto set; key name -> true
     */
    var computeSharedKeys = function (projectPath) {
        var keySet = Object.create(null);
        collectKeysFromConfigDir(_(projectPath + '/shared/config', true), keySet);
        return keySet;
    };

    /**
     * Resolves one key across both tiers in the runtime's order: the
     * environment first, the declared file chain second. "Set" stays the env
     * backend's fail-closed rule at every tier — a non-empty string — so an
     * `UNSET` here is still precisely a key that would throw at bundle start.
     *
     * The environment tier is the `--env-file` map when one was given,
     * otherwise the live `process.env`. Because that tier outranks the files,
     * an explicit `--env-file` still wins over a declared chain, which is what
     * it means to stand in for the environment.
     *
     * Naming the winning source is the point of the return shape: `SET` alone
     * cannot tell an operator whether the value came from the environment they
     * are about to deploy with or from a plaintext file sitting on this disk —
     * and those have very different consequences.
     *
     * @inner
     * @private
     * @param {string} key
     * @param {object|null} chain - Resolved chain from `resolveSecretsFileChain`
     * @returns {{set:boolean, source:(string|null), from:(string|null)}}
     */
    var lookupSecret = function (key, chain) {
        var source = self.envMap || process.env;
        if (typeof source[key] === 'string' && source[key] !== '') {
            return { set: true, source: self.envFile ? 'env-file' : 'env', from: self.envFile || null };
        }
        if (chain && chain.map) {
            var value = chain.map[key];
            if (typeof value === 'string' && value !== '') {
                return { set: true, source: 'file', from: chain.origin[key] };
            }
        }
        return { set: false, source: null, from: null };
    };

    /**
     * Builds a check report for one bundle: every required key with its
     * `SET`/`UNSET` status against both tiers, plus the resolved
     * `settings.secrets.file` chain that formed the lower one. Flips
     * `self.anyUnset` when a key is missing.
     *
     * The chain is resolved per bundle, not per project: `settings.json` is a
     * per-bundle file and a declared path may embed `${bundle}`.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {object|null} manifest
     * @param {string} bundleName
     * @param {object} sharedKeys - Pre-computed shared key set
     * @returns {{bundle:string, totalKeys:number, set:number, unset:number, keys:Array<{key:string, set:boolean, source:(string|null), from:(string|null)}>, secretsFile:object}}
     */
    var checkBundle = function (projectPath, manifest, bundleName, sharedKeys) {
        var keySet = Object.create(null);
        for (var sk in sharedKeys) {
            keySet[sk] = true;
        }
        var bundleSrc = resolveBundleSrc(manifest, bundleName);
        collectKeysFromConfigDir(_(projectPath + '/' + bundleSrc + '/config', true), keySet);

        var chain = resolveSecretsFileChain(projectPath, manifest, bundleName);

        var keys     = Object.keys(keySet).sort();
        var statuses = [];
        var setCount = 0;
        for (var k = 0; k < keys.length; k++) {
            var hit = lookupSecret(keys[k], chain);
            if (hit.set) { setCount++; } else { self.anyUnset = true; }
            statuses.push({ key: keys[k], set: hit.set, source: hit.source, from: hit.from });
        }
        return {
            bundle    : bundleName,
            totalKeys : keys.length,
            set       : setCount,
            unset     : keys.length - setCount,
            keys      : statuses,
            secretsFile : {
                declared     : chain.declared,
                assumedScope : self.scopeAssumed || null,
                assumedEnv   : self.envName || null,
                layers       : chain.layers,
                errors       : chain.errors
            }
        };
    };

    /**
     * Iterates every registered project, checking all bundles in each.
     *
     * @inner
     * @private
     */
    var checkAll = function () {
        var report = { projects: [] };
        var names  = Object.keys(self.projects).sort();
        for (var i = 0; i < names.length; i++) {
            var pp = self.projects[names[i]];
            var mf = loadManifest(pp.path);
            if (!mf || !mf.bundles) continue;
            var sharedKeys = computeSharedKeys(pp.path);
            var entry  = { project: names[i], bundles: [] };
            var bnames = Object.keys(mf.bundles).sort();
            for (var b = 0; b < bnames.length; b++) {
                entry.bundles.push(checkBundle(pp.path, mf, bnames[b], sharedKeys));
            }
            report.projects.push(entry);
        }
        emit(report);
    };

    /**
     * Checks every bundle in a single named project.
     *
     * @inner
     * @private
     * @param {string} projectName
     */
    var checkProjectOnly = function (projectName) {
        var project  = self.projects[projectName];
        var manifest = loadManifest(project.path);
        if (!manifest || !manifest.bundles) {
            console.error('Project @' + projectName + ' has no manifest.json or no bundles registered.');
            process.exit(1);
            return;
        }
        var sharedKeys = computeSharedKeys(project.path);
        var bundles    = Object.keys(manifest.bundles).sort();
        var report     = { project: projectName, bundles: [] };
        for (var i = 0; i < bundles.length; i++) {
            report.bundles.push(checkBundle(project.path, manifest, bundles[i], sharedKeys));
        }
        emit(report);
    };

    /**
     * Checks a single bundle in a single project.
     *
     * @inner
     * @private
     * @param {string} projectName
     * @param {string} bundleName
     */
    var checkBundleOnly = function (projectName, bundleName) {
        var project    = self.projects[projectName];
        var manifest   = loadManifest(project.path);
        var sharedKeys = computeSharedKeys(project.path);
        var report     = { project: projectName, bundles: [checkBundle(project.path, manifest, bundleName, sharedKeys)] };
        emit(report);
    };

    /**
     * Dispatches to the JSON or text renderer based on `self.format`.
     *
     * @inner
     * @private
     * @param {object} report
     */
    var emit = function (report) {
        if (self.format === 'json') {
            console.log(JSON.stringify(report, null, 2));
            return;
        }
        emitText(report);
    };

    /**
     * Renders the human-readable text report.
     *
     * @inner
     * @private
     * @param {object} report
     */
    var emitText = function (report) {
        var projects = report.projects
            ? report.projects
            : [{ project: report.project, bundles: report.bundles }];
        for (var p = 0; p < projects.length; p++) {
            var proj = projects[p];
            console.log('\n@' + proj.project
                + (self.scopeName ? ' (scope: ' + self.scopeName + ')' : '')
                + (self.envFile ? ' [env: ' + self.envFile + ']' : '')
                + ':');
            if (proj.bundles.length === 0) {
                console.log('  (no bundles)');
                continue;
            }
            for (var b = 0; b < proj.bundles.length; b++) {
                emitTextBundle(proj.bundles[b]);
            }
        }
    };

    /**
     * Renders one bundle's SET/UNSET block.
     *
     * @inner
     * @private
     * @param {object} br - One bundle report from `checkBundle`
     */
    var emitTextBundle = function (br) {
        console.log('  ' + br.bundle + ':');
        emitTextChain(br.secretsFile);
        if (br.totalKeys === 0) {
            console.log('    No ${secret:KEY} placeholders found in config.');
            return;
        }
        var width = 0;
        for (var w = 0; w < br.keys.length; w++) {
            if (br.keys[w].key.length > width) width = br.keys[w].key.length;
        }
        for (var k = 0; k < br.keys.length; k++) {
            console.log('      ' + padRight(br.keys[k].key, width) + '   '
                + padRight(br.keys[k].set ? 'SET' : 'UNSET', 5) + '   '
                + sourceLabel(br.keys[k], br.secretsFile));
        }
        console.log('    (' + br.totalKeys + ' required: ' + br.set + ' set, ' + br.unset + ' unset)');
    };

    /**
     * Renders the resolved `settings.secrets.file` block for one bundle, and
     * nothing at all when the bundle declares no chain — an undeclared bundle
     * behaves exactly as before the file tier existed, and its report should
     * look that way too.
     *
     * The assumed scope/env line is not decoration: those are launch-time
     * values this process cannot read, so the report has to say which ones it
     * substituted or a reader cannot tell whether the paths below are the ones
     * their bundle will actually open.
     *
     * @inner
     * @private
     * @param {object} sf - The `secretsFile` block from `checkBundle`
     */
    var emitTextChain = function (sf) {
        if (!sf || !sf.declared) return;

        var assumed = [];
        if (sf.assumedScope) assumed.push('scope=' + sf.assumedScope);
        if (sf.assumedEnv) assumed.push('env=' + sf.assumedEnv);
        console.log('    settings.secrets.file'
            + (assumed.length ? ' (assuming ' + assumed.join(', ') + ')' : '') + ':');

        for (var e = 0; e < sf.errors.length; e++) {
            console.log('      ! ' + sf.errors[e]);
        }
        if (sf.errors.length) {
            console.log('      ! file tier skipped — keys below are checked against the environment only');
            return;
        }
        for (var i = 0; i < sf.layers.length; i++) {
            console.log('      [' + (i + 1) + '] ' + sf.layers[i].path + '   '
                + (sf.layers[i].found
                    ? 'loaded (' + sf.layers[i].keys + ' keys)'
                    : (sf.layers[i].unreadable
                        ? 'UNREADABLE (' + sf.layers[i].code + ')'
                        : 'ABSENT')));
        }
    };

    /**
     * Names the tier a key was satisfied from. An empty label for `UNSET`
     * keeps the column honest — there is no source to name.
     *
     * @inner
     * @private
     * @param {object} entry - One `{key, set, source, from}` status
     * @param {object} sf - The `secretsFile` block, for layer numbering
     * @returns {string}
     */
    var sourceLabel = function (entry, sf) {
        if (!entry.set) return '';
        if (entry.source !== 'file') return entry.source;
        var layers = (sf && sf.layers) ? sf.layers : [];
        for (var i = 0; i < layers.length; i++) {
            if (layers[i].path === entry.from) return 'file[' + (i + 1) + ']';
        }
        return 'file';
    };

    /**
     * Right-pads `s` with spaces to reach `n` characters.
     *
     * @inner
     * @private
     * @param {string} s
     * @param {number} n
     * @returns {string}
     */
    var padRight = function (s, n) {
        var o = String(s || '');
        while (o.length < n) o += ' ';
        return o;
    };

    init();
}

module.exports = Check;
