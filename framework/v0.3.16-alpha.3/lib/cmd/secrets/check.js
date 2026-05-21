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
 * `--env-file=<path>`: validate against a `.env`-style file's vars instead of
 * the live `process.env` — e.g. a decrypted SOPS export or a CI-exported env.
 *
 * Caveat: without `--env-file` this checks the env of THIS CLI process, not a
 * detached bundle's runtime/container environment. Real value: a CI step that
 * exports (or decrypts) the scope's secrets and runs `secrets:check --scope=…
 * --env-file=…` before shipping. It cannot introspect an already-running
 * bundle's env.
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
    var self = { format: 'text', anyUnset: false, scopeName: null, envFile: null, envMap: null };

    var secrets = lib.secrets;
    var merge   = lib.merge;

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
     * @inner
     * @private
     * @param {string} filePath
     * @returns {Object<string,string>|null}
     */
    var loadEnvFile = function (filePath) {
        var raw;
        try {
            raw = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            return null;
        }
        var map   = Object.create(null);
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
            var effective    = scopeContent ? merge(JSON.clone(scopeContent), baseContent || {}) : baseContent;
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
     * Returns true when the key resolves to a non-empty string in the active
     * env source — the exact condition under which the env backend resolves
     * successfully. The source is the `--env-file` map when given, otherwise
     * the live `process.env`.
     *
     * @inner
     * @private
     * @param {string} key
     * @returns {boolean}
     */
    var isEnvSet = function (key) {
        var source = self.envMap || process.env;
        return typeof source[key] === 'string' && source[key] !== '';
    };

    /**
     * Builds a check report for one bundle: every required key with its
     * `SET`/`UNSET` status against the current `process.env`. Flips
     * `self.anyUnset` when a key is missing.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {object|null} manifest
     * @param {string} bundleName
     * @param {object} sharedKeys - Pre-computed shared key set
     * @returns {{bundle:string, totalKeys:number, set:number, unset:number, keys:Array<{key:string, set:boolean}>}}
     */
    var checkBundle = function (projectPath, manifest, bundleName, sharedKeys) {
        var keySet = Object.create(null);
        for (var sk in sharedKeys) {
            keySet[sk] = true;
        }
        var bundleSrc = resolveBundleSrc(manifest, bundleName);
        collectKeysFromConfigDir(_(projectPath + '/' + bundleSrc + '/config', true), keySet);

        var keys     = Object.keys(keySet).sort();
        var statuses = [];
        var setCount = 0;
        for (var k = 0; k < keys.length; k++) {
            var ok = isEnvSet(keys[k]);
            if (ok) { setCount++; } else { self.anyUnset = true; }
            statuses.push({ key: keys[k], set: ok });
        }
        return {
            bundle    : bundleName,
            totalKeys : keys.length,
            set       : setCount,
            unset     : keys.length - setCount,
            keys      : statuses
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
        if (br.totalKeys === 0) {
            console.log('    No ${secret:KEY} placeholders found in config.');
            return;
        }
        var width = 0;
        for (var w = 0; w < br.keys.length; w++) {
            if (br.keys[w].key.length > width) width = br.keys[w].key.length;
        }
        for (var k = 0; k < br.keys.length; k++) {
            console.log('      ' + padRight(br.keys[k].key, width) + '   ' + (br.keys[k].set ? 'SET' : 'UNSET'));
        }
        console.log('    (' + br.totalKeys + ' required: ' + br.set + ' set, ' + br.unset + ' unset)');
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
