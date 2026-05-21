var fs      = require('fs');
var console = lib.logger;

var CmdHelper = require('./../helper');

/**
 * @module gina/lib/cmd/secrets/scan
 */
/**
 * Walks every bundle in a project (or a single named bundle) and reports
 * the `${secret:KEY}` placeholders each bundle requires, aggregated as
 * KEY -> originating config file(s). Read-only: it never resolves a
 * placeholder, never reads `process.env`, and never writes anything.
 *
 * Usage:
 *  gina secrets:scan
 *  gina secrets:scan @<project>
 *  gina secrets:scan <bundle> @<project>
 *  gina secrets:scan @<project> --format=json
 *
 * Config sources walked, matching `core/config.js::loadBundleConfig`:
 *   - `<bundleSrc>/config/` per bundle, where `bundleSrc` comes from
 *     `manifest.bundles[<name>].src` (falling back to the bundle name).
 *   - the project-level `shared/config/`, which the loader merges into
 *     every bundle — so its keys are attributed to each bundle.
 * Every `.json` in those dirs is read (the loader globs the dir rather
 * than using a fixed whitelist); dotfiles and `* copy` files are skipped.
 *
 * Caveat: this reports the *authored* placeholders on disk, not the merged
 * runtime config — correct today because placeholders are always authored
 * literals.
 *
 * @class Scan
 * @constructor
 * @param {object} opt - Parsed command-line options
 * @param {object} opt.client - Socket client for terminal output
 * @param {string[]} opt.argv - Full argv array
 * @param {number} [opt.debugPort] - Node.js inspector port
 * @param {boolean} [opt.debugBrkEnabled] - True when --inspect-brk is active
 * @param {object} cmd - The cmd dispatcher object (lib/cmd/index.js)
 */
function Scan(opt, cmd) {
    var self = { format: 'text' };

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
     * dispatches to the right walker, and exits.
     *
     * @inner
     * @private
     */
    var init = function () {
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
        if ( !isCmdConfigured() ) return false;

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
                console.error('`secrets:scan <bundle>` requires `@<project>`. Did you forget `@<project_name>`?');
                process.exit(1);
                return;
            }
            scanAll();
            process.exit(0);
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
            scanBundleOnly(self.projectName, bundleFilter);
        } else {
            scanProjectOnly(self.projectName);
        }

        process.exit(0);
    };

    /**
     * Reads a JSON file with comment tolerance via `requireJSON`. Returns
     * `null` on any I/O or parse error so callers can choose how to
     * surface the failure.
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
     * siblings — the same filtering `loadBundleConfig` applies. Returns a
     * sorted list of bare filenames. Empty when the dir is absent.
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
     * keys via `lib.secrets.getRequiredKeys`, and records each key against
     * its originating file (labelled with `relBase + '/' + filename`).
     * Mutates `byKey` in place.
     *
     * @inner
     * @private
     * @param {string} absDir  - Absolute config directory to read
     * @param {string} relBase - Display prefix for file labels (e.g. `src/demo/config`)
     * @param {Object<string, string[]>} byKey - Mutable KEY -> [files] map
     */
    var collectFromConfigDir = function (absDir, relBase, byKey) {
        var files = listJsonFiles(absDir);
        for (var f = 0; f < files.length; f++) {
            var conf = readJsonSafe(_(absDir + '/' + files[f], true));
            if (!conf) continue;
            var keys = secrets.getRequiredKeys(conf);
            var label = relBase + '/' + files[f];
            for (var k = 0; k < keys.length; k++) {
                if (!byKey[keys[k]]) byKey[keys[k]] = [];
                if (byKey[keys[k]].indexOf(label) < 0) byKey[keys[k]].push(label);
            }
        }
    };

    /**
     * Computes the shared-config KEY -> [files] map once per project. The
     * loader merges `shared/config/` into every bundle, so these keys are
     * attributed to each bundle.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @returns {Object<string, string[]>}
     */
    var computeSharedByKey = function (projectPath) {
        var byKey = Object.create(null);
        collectFromConfigDir(_(projectPath + '/shared/config', true), 'shared/config', byKey);
        return byKey;
    };

    /**
     * Builds a required-secrets report for one bundle: the union of its
     * own `config/` keys and the project's shared-config keys.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {object|null} manifest
     * @param {string} bundleName
     * @param {Object<string, string[]>} sharedByKey - Pre-computed shared map
     * @returns {{bundle:string, totalKeys:number, byKey:Object<string, string[]>}}
     */
    var scanBundle = function (projectPath, manifest, bundleName, sharedByKey) {
        var byKey = Object.create(null);
        for (var sk in sharedByKey) {
            byKey[sk] = sharedByKey[sk].slice();
        }
        var bundleSrc = resolveBundleSrc(manifest, bundleName);
        var rel       = bundleSrc + '/config';
        collectFromConfigDir(_(projectPath + '/' + rel, true), rel, byKey);
        return {
            bundle    : bundleName,
            totalKeys : Object.keys(byKey).length,
            byKey     : byKey
        };
    };

    /**
     * Iterates every registered project, scanning all bundles in each.
     *
     * @inner
     * @private
     */
    var scanAll = function () {
        var report = { projects: [] };
        var names  = Object.keys(self.projects).sort();
        for (var i = 0; i < names.length; i++) {
            var pp = self.projects[names[i]];
            var mf = loadManifest(pp.path);
            if (!mf || !mf.bundles) continue;
            var sharedByKey = computeSharedByKey(pp.path);
            var entry  = { project: names[i], bundles: [] };
            var bnames = Object.keys(mf.bundles).sort();
            for (var b = 0; b < bnames.length; b++) {
                entry.bundles.push(scanBundle(pp.path, mf, bnames[b], sharedByKey));
            }
            report.projects.push(entry);
        }
        emit(report);
    };

    /**
     * Scans every bundle in a single named project.
     *
     * @inner
     * @private
     * @param {string} projectName
     */
    var scanProjectOnly = function (projectName) {
        var project  = self.projects[projectName];
        var manifest = loadManifest(project.path);
        if (!manifest || !manifest.bundles) {
            console.error('Project @' + projectName + ' has no manifest.json or no bundles registered.');
            process.exit(1);
            return;
        }
        var sharedByKey = computeSharedByKey(project.path);
        var bundles     = Object.keys(manifest.bundles).sort();
        var report      = { project: projectName, bundles: [] };
        for (var i = 0; i < bundles.length; i++) {
            report.bundles.push(scanBundle(project.path, manifest, bundles[i], sharedByKey));
        }
        emit(report);
    };

    /**
     * Scans a single bundle in a single project.
     *
     * @inner
     * @private
     * @param {string} projectName
     * @param {string} bundleName
     */
    var scanBundleOnly = function (projectName, bundleName) {
        var project     = self.projects[projectName];
        var manifest    = loadManifest(project.path);
        var sharedByKey = computeSharedByKey(project.path);
        var report      = { project: projectName, bundles: [scanBundle(project.path, manifest, bundleName, sharedByKey)] };
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
     * Renders one bundle's required-secrets block.
     *
     * @inner
     * @private
     * @param {object} br - One bundle report from `scanBundle`
     */
    var emitTextBundle = function (br) {
        console.log('  ' + br.bundle + ':');
        if (br.totalKeys === 0) {
            console.log('    No ${secret:KEY} placeholders found in config.');
            return;
        }
        var keys  = Object.keys(br.byKey).sort();
        var width = 0;
        for (var w = 0; w < keys.length; w++) {
            if (keys[w].length > width) width = keys[w].length;
        }
        console.log('    Required secrets (' + br.totalKeys + '):');
        for (var k = 0; k < keys.length; k++) {
            console.log('      ' + padRight(keys[k], width) + '   <-  ' + br.byKey[keys[k]].join(', '));
        }
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

module.exports = Scan;
