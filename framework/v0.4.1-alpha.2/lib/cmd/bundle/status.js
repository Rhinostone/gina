var fs = require('fs');
var console = lib.logger;

var CmdHelper = require('./../helper');

/**
 * @module gina/lib/cmd/bundle/status
 */
/**
 * Shows the running/stopped state, PID, port, and active env for a single bundle.
 *
 * Usage:
 *  gina bundle:status <bundle_name> @<project_name>
 *  gina bundle:status <bundle_name> @<project_name> --format=json
 *
 * Unlike `bundle:list` (which answers "what bundles exist" and leads each line
 * with a source-presence marker), `bundle:status` answers "is this one bundle
 * running" and leads with the run-state label.
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
 *  // human-readable
 *  $ gina bundle:status api @myproject
 *  [ running ] api              http/2.0 dev https 4208  pid 12345
 *
 * @example
 *  // machine-readable
 *  $ gina bundle:status api @myproject --format=json
 *  {"bundle":"api","project":"myproject","running":true,"pid":12345,"env":"dev","scheme":"http/2.0","protocol":"https","port":4208,"ports":{...}}
 */
function Status(opt, cmd) {
    var self = { format: null };

    /**
     * Parses the --format flag, resolves the target bundle/project, and prints
     * the bundle's status. CmdHelper resolves the single positional bundle name
     * into `self.name` (the same slot bundle:stop reads) and the `@<project>`
     * token into `self.projectName`.
     *
     * @inner
     * @private
     */
    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
        // check CMD configuration
        if (!isCmdConfigured()) return false;

        // Full pre-scan of argv for --format only. No dispatch inside the loop —
        // separating parsing from dispatch keeps flag ordering from changing
        // behaviour.
        for (let i = 3, len = process.argv.length; i < len; i++) {
            if ( /^\-\-format\=/.test(process.argv[i]) ) {
                self.format = process.argv[i].split(/\=/)[1];
            }
        }

        // A bundle status targets one specific bundle inside one project — both
        // the bundle name and `@<project>` are required. CmdHelper only sets
        // `self.name` when exactly one bundle positional is present
        // (lib/cmd/helper.js — `cmd.bundles.length == 1`), and leaves
        // `self.projectName` null (not undefined) when no `@<project>` token is
        // present, so test loosely with `== null`.
        if ( typeof(self.name) == 'undefined' || self.name == null ) {
            console.error('Usage: gina bundle:status <bundle_name> @<project_name> [--format=json]');
            process.exit(1);
        }
        if ( self.projectName == null ) {
            console.error('You need to add `@<project_name>`. Usage: gina bundle:status <bundle_name> @<project_name>');
            process.exit(1);
        }

        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));
        if ( typeof(self.projects[self.projectName]) == 'undefined' ) {
            console.error('[ '+ self.projectName +' ] is not a registered project.');
            process.exit(1);
        }

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

        status();
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
     * Resolves the target bundle's port + running state and prints it. Exits 1
     * when the bundle is not declared in the project's manifest.
     *
     * @inner
     * @private
     */
    var status = function() {
        var bundle      = self.name;
        var projectName = self.projectName;

        // Confirm the bundle is declared in the project manifest.
        var existsInManifest = false;
        try {
            var path    = self.projects[projectName].path;
            var bundles = require( _(path + '/manifest.json') ).bundles;
            existsInManifest = ( typeof(bundles[bundle]) != 'undefined' );
        } catch (err) {
            existsInManifest = false;
        }

        if ( !existsInManifest ) {
            if ( /^json?/.test(self.format) ) {
                process.stdout.write(JSON.stringify({ bundle: bundle, project: projectName, status: 'not-found' }));
            } else {
                console.error('[ '+ bundle +'@'+ projectName +' ] is not a bundle of project [ '+ projectName +' ].');
            }
            process.exit(1);
        }

        var ports     = (self.portsReverseData || {})[bundle + '@' + projectName] || null;
        var preferred = pickPreferredPort(ports);
        var runState  = readPidfile(bundle, projectName);

        var json = {
            bundle   : bundle,
            project  : projectName,
            running  : runState.running,
            pid      : runState.pid,
            env      : preferred ? preferred.env : null,
            scheme   : preferred ? preferred.scheme : null,
            protocol : preferred ? preferred.protocol : null,
            port     : preferred ? preferred.port : null,
            ports    : ports
        };

        if ( /^json?/.test(self.format) ) {
            return process.stdout.write(JSON.stringify(json));
        }

        var stateLabel = runState.running ? '[ running ]' : '[ stopped ]';
        var portLabel  = preferred
            ? preferred.scheme + ' ' + preferred.env + ' ' + preferred.protocol + ' ' + preferred.port
            : '(no port)';
        var line = stateLabel + ' ' + pad(bundle, 16) + ' ' + portLabel;
        if ( runState.running ) {
            line += '  pid ' + runState.pid;
        }
        console.log(line);
    }


    init()
};

module.exports = Status
