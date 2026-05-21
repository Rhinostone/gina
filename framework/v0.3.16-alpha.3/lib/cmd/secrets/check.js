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
 *
 * "Set" matches the env backend's fail-closed rule exactly: a key counts
 * as satisfied only when `process.env[KEY]` is a **non-empty string** — the
 * same condition under which `secrets.resolve()` would succeed at bundle
 * start. So an `UNSET` here is precisely a key that would throw at load.
 *
 * Caveat: this checks the env of THIS CLI process, not a detached bundle's
 * runtime/container environment. Real value: a CI step that exports the
 * secrets and runs `secrets:check` before shipping, or a shell that sourced
 * the same env file. It cannot introspect an already-running bundle's env.
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
    var self = { format: 'text', anyUnset: false };

    var secrets = lib.secrets;

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
     * Reads every `.json` under `absDir` and adds each required secret key
     * to `keySet` (a null-proto set). Mutates `keySet` in place.
     *
     * @inner
     * @private
     * @param {string} absDir - Absolute config directory to read
     * @param {object} keySet - Mutable null-proto set; key name -> true
     */
    var collectKeysFromConfigDir = function (absDir, keySet) {
        var files = listJsonFiles(absDir);
        for (var f = 0; f < files.length; f++) {
            var conf = readJsonSafe(_(absDir + '/' + files[f], true));
            if (!conf) continue;
            var keys = secrets.getRequiredKeys(conf);
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
     * Returns true when `process.env[key]` is a non-empty string — the
     * exact condition under which the env backend resolves successfully.
     *
     * @inner
     * @private
     * @param {string} key
     * @returns {boolean}
     */
    var isEnvSet = function (key) {
        return typeof process.env[key] === 'string' && process.env[key] !== '';
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
            console.log('\n@' + proj.project + ':');
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
