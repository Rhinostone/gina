var fs = require('fs');
var console = lib.logger;

var CmdHelper = require('./../helper');

/**
 * @module gina/lib/cmd/project/status
 */
/**
 * Shows the running/stopped state, PID, and port of each bundle in a project
 * (or in every registered project when no project is given).
 *
 * Usage:
 *  gina project:status [@<project_name>]
 *  gina project:status @<project_name> --format=json
 *
 * `project:status` is exempt from the mandatory `@<project>` guard (see
 * lib/cmd/helper.js — the `project:(list|help|status)` allowlist), so the
 * no-argument form reports every registered project, mirroring `project:list`.
 *
 * @class Status
 * @constructor
 * @param {object} opt - Parsed command-line options
 * @param {object} opt.client - Socket client for terminal output
 * @param {string[]} opt.argv - Full argv array
 * @param {number} [opt.debugPort] - Node.js inspector port
 * @param {boolean} [opt.debugBrkEnabled] - True when --inspect-brk is active
 * @param {object} cmd - The cmd dispatcher object (lib/cmd/index.js)
 *
 * @example
 *  // single project, human-readable
 *  $ gina project:status @myproject
 *  [ running ] api              http/2.0 dev https 4208  pid 12345
 *  [ stopped ] web              http/1.1 dev http 3000
 *
 * @example
 *  // every project, machine-readable
 *  $ gina project:status --format=json
 *  [{"project":"myproject","bundles":[{"bundle":"api","project":"myproject","running":true,"pid":12345,...}]}]
 */
function Status(opt, cmd) {
    var self = { format: null };

    /**
     * Parses the --format flag and dispatches to statusProjectOnly (a named
     * `@<project>`) or statusAll (no project given).
     *
     * @inner
     * @private
     */
    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
        // check CMD configuration
        if (!isCmdConfigured()) return false;

        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));

        // Tolerant ports load — a missing/malformed ports table yields "(no port)".
        self.portsReverseData = {};
        var portsPath = _(GINA_HOMEDIR + '/ports.reverse.json');
        if ( fs.existsSync(portsPath) ) {
            try {
                self.portsReverseData = requireJSON(portsPath);
            } catch (e) {
                // Tolerant — fall through with empty ports table.
            }
        }

        // Full pre-scan of argv for --format only. No dispatch inside the loop.
        for (let i = 3, len = process.argv.length; i < len; i++) {
            if ( /^\-\-format\=/.test(process.argv[i]) ) {
                self.format = process.argv[i].split(/\=/)[1];
            }
        }

        // `self.projectName == null` matches both null (CmdHelper default) and
        // undefined — either signals "no project specified", report them all.
        if ( self.projectName == null ) {
            statusAll();
        } else if ( typeof(self.projects[self.projectName]) != 'undefined' ) {
            statusProjectOnly();
        } else {
            console.error('[ '+ self.projectName +' ] is not a registered project.');
            process.exit(1);
        }

        process.exit(0);
    }


    /**
     * Picks the "preferred" port to display for a bundle: dev env, http/2.0
     * https first, falling back to http/1.1 https, then http/1.1 http.
     * Returns null when no port is allocated.
     *
     * @inner
     * @private
     * @param {object|null} ports - Port record from ports.reverse.json
     * @returns {{env: string, scheme: string, protocol: string, port: number}|null}
     */
    var pickPreferredPort = function(ports) {
        if (!ports) return null;
        var envKey = ports.dev ? 'dev' : Object.keys(ports)[0];
        if (!envKey) return null;
        var env = ports[envKey];
        if (!env) return null;

        if (env['http/2.0'] && env['http/2.0'].https) {
            return { env: envKey, scheme: 'http/2.0', protocol: 'https', port: env['http/2.0'].https };
        }
        if (env['http/1.1'] && env['http/1.1'].https) {
            return { env: envKey, scheme: 'http/1.1', protocol: 'https', port: env['http/1.1'].https };
        }
        if (env['http/1.1'] && env['http/1.1'].http) {
            return { env: envKey, scheme: 'http/1.1', protocol: 'http', port: env['http/1.1'].http };
        }
        return null;
    }


    /**
     * Reads `~/.gina/run/<bundle>@<project>.pid` and probes the pid with
     * `process.kill(pid, 0)`. Returns `running: false` on a stale pidfile
     * but does not delete it — clean-up stays with bundle:stop.
     *
     * @inner
     * @private
     * @param {string} bundleName
     * @param {string} projectName
     * @returns {{running: boolean, pid: number|null}}
     */
    var readPidfile = function(bundleName, projectName) {
        var pidPath = _(GINA_HOMEDIR + '/run/' + bundleName + '@' + projectName + '.pid');
        if ( !fs.existsSync(pidPath) ) {
            return { running: false, pid: null };
        }
        var raw;
        try {
            raw = fs.readFileSync(pidPath, 'utf8').trim();
        } catch (e) {
            return { running: false, pid: null };
        }
        var pid = parseInt(raw, 10);
        if ( isNaN(pid) || pid <= 0 ) {
            return { running: false, pid: null };
        }
        try {
            process.kill(pid, 0);
            return { running: true, pid: pid };
        } catch (e) {
            return { running: false, pid: null };
        }
    }


    /**
     * Right-pads `s` with spaces to reach `width`. Used to align the port
     * column after the bundle name.
     *
     * @inner
     * @private
     * @param {string} s
     * @param {number} width
     * @returns {string}
     */
    var pad = function(s, width) {
        var out = String(s || '');
        while (out.length < width) {
            out += ' ';
        }
        return out;
    }


    /**
     * Builds the per-bundle status objects for one project by reading its
     * manifest, ports table, and pidfiles.
     *
     * @inner
     * @private
     * @param {string} projectName
     * @returns {Array<object>}
     */
    var collectBundles = function(projectName) {
        var out  = [];
        var path = self.projects[projectName].path;
        var bundles = require( _(path + '/manifest.json') ).bundles;
        bundles = orderBundles(bundles);
        for (var b in bundles) {
            var ports     = (self.portsReverseData || {})[b + '@' + projectName] || null;
            var preferred = pickPreferredPort(ports);
            var runState  = readPidfile(b, projectName);
            out.push({
                bundle   : b,
                project  : projectName,
                running  : runState.running,
                pid      : runState.pid,
                env      : preferred ? preferred.env : null,
                scheme   : preferred ? preferred.scheme : null,
                protocol : preferred ? preferred.protocol : null,
                port     : preferred ? preferred.port : null,
                ports    : ports
            });
        }
        return out;
    }


    /**
     * Formats one per-bundle status object into a display line.
     *
     * @inner
     * @private
     * @param {object} entry
     * @returns {string}
     */
    var formatLine = function(entry) {
        var stateLabel = entry.running ? '[ running ]' : '[ stopped ]';
        var portLabel  = (entry.port != null)
            ? entry.scheme + ' ' + entry.env + ' ' + entry.protocol + ' ' + entry.port
            : '(no port)';
        var line = stateLabel + ' ' + pad(entry.bundle, 16) + ' ' + portLabel;
        if ( entry.running ) {
            line += '  pid ' + entry.pid;
        }
        return line;
    }


    /**
     * Reports status for self.projectName only.
     *
     * @inner
     * @private
     */
    var statusProjectOnly = function() {
        var entries = [];
        try {
            entries = collectBundles(self.projectName);
        } catch (err) {
            entries = [];
        }

        if ( /^json?/.test(self.format) ) {
            return process.stdout.write(JSON.stringify(entries));
        }

        var str = '';
        for (var i = 0; i < entries.length; i++) {
            str += formatLine(entries[i]) + '\n\r';
        }
        console.log(str);
    }


    /**
     * Reports status for every registered project.
     *
     * @inner
     * @private
     */
    var statusAll = function() {
        var list = [];
        for (var p in self.projects) {
            list.push(p);
        }
        list.sort();

        var json = [];
        var str  = '';
        for (var i = 0; i < list.length; i++) {
            var projectName = list[i];
            var jsonProject = { project: projectName, bundles: [] };
            try {
                jsonProject.bundles = collectBundles(projectName);
            } catch (err) {
                jsonProject.bundles = [];
            }
            str += '------------------------------------\n\r';
            str += projectName + '\n\r';
            str += '------------------------------------\n\r';
            for (var j = 0; j < jsonProject.bundles.length; j++) {
                str += formatLine(jsonProject.bundles[j]) + '\n\r';
            }
            str += '\n\r';
            json.push(jsonProject);
        }

        if ( /^json?/.test(self.format) ) {
            return process.stdout.write(JSON.stringify(json));
        }
        console.log(str);
    }


    init()
};

module.exports = Status
