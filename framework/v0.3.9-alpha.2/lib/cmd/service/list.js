var fs      = require('fs');
var console = lib.logger;

var CmdHelper = require('./../helper');

/**
 * @module gina/lib/cmd/service/list
 */
/**
 * Lists framework-internal services — bundles registered under the @gina
 * project. Shows name, src-existence status, the preferred dev port, and
 * whether the service is currently running (pidfile under ~/.gina/run/).
 *
 * Usage:
 *  gina service:list
 *  gina service:list @gina
 *  gina service:list --format=json
 *
 * @class List
 * @constructor
 * @param {object} opt - Parsed command-line options
 * @param {object} opt.client - Socket client for terminal output
 * @param {string[]} opt.argv - Full argv array
 * @param {number} [opt.debugPort] - Node.js inspector port
 * @param {boolean} [opt.debugBrkEnabled] - True when --inspect-brk is active
 * @param {object} cmd - The cmd dispatcher object (lib/cmd/index.js)
 */
function List(opt, cmd) {
    var self = { format: null };

    /**
     * Parse --format, load the @gina manifest, merge with ports + pidfile state,
     * emit text or JSON.
     *
     * @inner
     * @private
     */
    var init = function () {

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;

        for (var i = 3, len = process.argv.length; i < len; i++) {
            var arg = process.argv[i];
            if ( /^\-\-format\=/.test(arg) ) {
                self.format = arg.split(/\=/)[1];
            } else if ( /^@/.test(arg) ) {
                // Accept `@gina` as an explicit but redundant target;
                // reject any other project — user-defined services are not
                // a surface yet.
                var name = arg.replace(/^@/, '');
                if (name !== 'gina') {
                    console.error('`service:list` only targets @gina for now. Got: '+ arg);
                    process.exit(1);
                    return;
                }
            }
        }

        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));
        var ginaProject = self.projects['gina'];
        if ( typeof(ginaProject) == 'undefined' || ginaProject == null ) {
            console.error('@gina project is not registered. Run `services/configure` from the gina framework directory.');
            process.exit(1);
            return;
        }

        var manifestPath = _(ginaProject.path + '/manifest.json');
        if ( !fs.existsSync(manifestPath) ) {
            console.error('@gina manifest.json not found at '+ manifestPath);
            process.exit(1);
            return;
        }

        var manifest;
        try {
            manifest = requireJSON(manifestPath);
        } catch (err) {
            console.error('Could not parse @gina manifest.json: '+ err.message);
            process.exit(1);
            return;
        }

        var services     = manifest.bundles || {};
        var portsReverse = {};
        var portsPath    = _(GINA_HOMEDIR + '/ports.reverse.json');
        if ( fs.existsSync(portsPath) ) {
            try {
                portsReverse = requireJSON(portsPath);
            } catch (e) {
                // Fall through with empty ports table — tolerant.
            }
        }

        var names = Object.keys(services).sort();
        var json  = [];
        var lines = [];

        for (var n = 0; n < names.length; ++n) {
            var name       = names[n];
            var src        = services[name].src || '';
            var srcExists  = src && fs.existsSync(_(ginaProject.path + '/' + src));
            var status     = srcExists ? 'ok' : '?!';
            var ports      = portsReverse[name + '@gina'] || null;
            var preferred  = pickPreferredPort(ports);
            var runState   = readPidfile(name);

            json.push({
                service : name,
                path    : src,
                status  : status,
                ports   : ports,
                running : runState.running,
                pid     : runState.pid
            });

            var stateLabel = runState.running ? '[ running ]' : '[ stopped ]';
            var portLabel  = preferred
                ? preferred.scheme + ' ' + preferred.env + ' ' + preferred.protocol + ' ' + preferred.port
                : '(no port)';
            var line = stateLabel + ' ' + pad(name, 14) + ' ' + portLabel;
            if (runState.running && runState.pid) {
                line += '  pid ' + runState.pid;
            }
            if (!srcExists) {
                line += '  [?! src missing]';
            }
            lines.push(line);
        }

        if ( /^json?/.test(self.format) ) {
            process.stdout.write(JSON.stringify(json));
            process.exit(0);
            return;
        }

        if (lines.length === 0) {
            console.log('No services registered under @gina.');
        } else {
            console.log(lines.join('\n\r'));
        }
        process.exit(0);
    };

    /**
     * Right-pads `s` with spaces to reach `width`. Used for column alignment
     * in the text output.
     *
     * @inner
     * @private
     * @param {string} s
     * @param {number} width
     * @returns {string}
     */
    var pad = function (s, width) {
        var out = String(s || '');
        while (out.length < width) {
            out += ' ';
        }
        return out;
    };

    /**
     * Picks the "preferred" port to display for a service: dev env, http/2.0
     * https first, falling back to http/1.1 https, then http/1.1 http.
     *
     * @inner
     * @private
     * @param {object|null} ports - Port record from ports.reverse.json
     * @returns {{env: string, scheme: string, protocol: string, port: number}|null}
     */
    var pickPreferredPort = function (ports) {
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
    };

    /**
     * Reads `~/.gina/run/<name>@gina.pid` and probes the process with
     * `process.kill(pid, 0)`. Returns `running: false` on a stale pidfile
     * but does not delete it — clean-up is bundle:stop's job.
     *
     * @inner
     * @private
     * @param {string} name - Service name (without the @gina suffix)
     * @returns {{running: boolean, pid: number|null}}
     */
    var readPidfile = function (name) {
        var pidPath = _(GINA_HOMEDIR + '/run/' + name + '@gina.pid');
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
    };

    init();
}

module.exports = List;
