var fs          = require('fs');
var CmdHelper   = require('./../helper');
var console     = lib.logger;
var mcpServer   = lib.mcpServer;
var mcpDispatch = lib.mcpDispatch;

/**
 * @module gina/lib/cmd/bundle/mcp-start
 */
/**
 * Starts a Model Context Protocol server for a running bundle. Speaks
 * JSON-RPC 2.0 over stdio (newline-delimited UTF-8) per MCP spec revision
 * 2025-06-18.
 *
 * The server reads the static tool manifest written by `gina bundle:mcp`,
 * advertises every tool over `tools/list`, and dispatches incoming
 * `tools/call` requests by issuing real HTTP requests against the bundle's
 * configured port on localhost.
 *
 * **Prerequisites.** The bundle must already be running (`gina bundle:start`)
 * and its manifest must exist (`gina bundle:mcp`). The MCP server process is
 * stateless — it holds no session, no auth, no config beyond what lives in
 * mcp.json and the bundle's own routing.
 *
 * **Stdio discipline.** The bin/cli early intercept redirects process.stdout
 * to stderr when `bundle:mcp-start` is detected in argv, and stashes the real
 * write on `process.__ginaMcpStdout`. The MCP wire uses that stashed write;
 * every framework log line ends up on stderr where it belongs.
 *
 * Usage:
 *  gina bundle:mcp-start <bundle_name> @<project_name>
 *  gina bundle:mcp-start <bundle_name> @<project_name> --timeout-ms=5000
 *
 * Timeout precedence: `--timeout-ms` CLI flag > `mcp.json > server > timeoutMs`
 * > 30 000 ms default. Negative / non-numeric values at any layer fall through
 * to the next layer with a stderr warning.
 *
 * @class MCPStart
 * @constructor
 * @param {object} opt - Parsed command-line options
 * @param {object} opt.client - Socket client for terminal output (points at stderr in this path)
 * @param {string[]} opt.argv - Full argv array
 * @param {number} [opt.debugPort] - Node.js inspector port
 * @param {boolean} [opt.debugBrkEnabled] - True when --inspect-brk is active
 * @param {object} cmd - The cmd dispatcher object (lib/cmd/index.js)
 */
function MCPStart(opt, cmd) {
    var self = {};

    var server      = null;
    var dispatcher  = null;
    var shuttingDown = false;


    var init = function() {

        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        if ( !isCmdConfigured() ) return false;

        if ( typeof(self.projects[self.projectName]) == 'undefined' || typeof(self.projects[self.projectName].path) == 'undefined' ) {
            return end( new Error('project path not defined in ~/.gina/projects.json for [ '+ self.projectName + ' ]') );
        }

        if (!isDefined('project', self.projectName)) {
            return end( new Error('Missing argument @<project_name>') );
        }

        // Exactly one bundle — MCP stdio is point-to-point.
        if (!self.bundles.length) {
            return end( new Error('Missing argument <bundle_name>. Usage: gina bundle:mcp-start <bundle> @<project>') );
        }
        if (self.bundles.length > 1) {
            return end( new Error('bundle:mcp-start takes exactly one bundle. Got: '+ self.bundles.join(', ')) );
        }

        startServer();
    };


    /**
     * Loads the manifest, wires dispatcher + server, attaches stdio, and
     * installs shutdown handlers. Never returns — the process lives until
     * stdin closes or a signal arrives.
     *
     * @private
     */
    var startServer = function() {

        var bundle      = self.bundles[0];
        var manifest    = self.projectData;
        var bundleSrc   = manifest.bundles[bundle].src;
        var srcPath     = _(self.projects[self.projectName].path + '/' + bundleSrc, true);
        var mcpPath     = _(srcPath + '/config/mcp.json', true);
        var routingPath = _(srcPath + '/config/routing.json', true);

        if ( !fs.existsSync(mcpPath) ) {
            return end( new Error(
                'MCP manifest not found at '+ mcpPath +'.\n' +
                'Run `gina bundle:mcp '+ bundle +' @'+ self.projectName +'` first to generate it.'
            ) );
        }

        // Warn on staleness — routing changed after the manifest was written.
        if ( fs.existsSync(routingPath) ) {
            try {
                var mcpMtime     = fs.statSync(mcpPath).mtimeMs;
                var routingMtime = fs.statSync(routingPath).mtimeMs;
                if (routingMtime > mcpMtime) {
                    console.warn(
                        '[ '+ bundle +' ] routing.json has been modified after mcp.json was generated. ' +
                        'Run `gina bundle:mcp` to regenerate before serving, or clients may see stale tools.'
                    );
                }
            } catch (statErr) {
                // non-fatal
            }
        }

        var mcpDoc = null;
        try {
            mcpDoc = requireJSON(mcpPath);
        } catch (parseErr) {
            return end( new Error('Failed to parse '+ mcpPath +': '+ parseErr.message) );
        }

        if (!mcpDoc || !Array.isArray(mcpDoc.tools)) {
            return end( new Error(mcpPath +' is not a valid MCP manifest (missing `tools` array)') );
        }

        var baseUrl = buildBaseUrl(bundle, mcpDoc);

        // Loud, one-time notice about the tools that look session-scoped.
        warnSessionScopedTools(mcpDoc.tools);

        // Framework package version — the user-facing server version.
        var packVersion = null;
        try {
            var packPath = _(process.env.GINA_DIR + '/package.json', true);
            packVersion = require(packPath).version;
        } catch (pkgErr) {
            packVersion = '0.0.0';
        }

        var timeoutMs = resolveTimeoutMs(mcpDoc);

        dispatcher = mcpDispatch.createDispatcher({
            baseUrl:   baseUrl,
            timeoutMs: timeoutMs
        });

        server = mcpServer.createServer({
            manifest:   mcpDoc,
            dispatch:   dispatcher.dispatch,
            serverInfo: {
                name:    'gina-mcp/'+ bundle,
                version: packVersion,
                title:   bundle + ' (via gina bundle:mcp-start)'
            },
            instructions:
                'This server exposes HTTP routes from the `'+ bundle +'` Gina bundle as MCP tools. '+
                'Tool results mirror the upstream HTTP response. Session-scoped routes may require '+
                'out-of-band authentication — consult `_meta["io.gina.middleware"]` on each tool.',
            onError: function(err) {
                // Transport / unexpected errors — surfaced on stderr for ops.
                console.error('[ '+ bundle +' ][mcp] ' + (err && err.message || err));
            }
        });

        // Output stream: the real stdout stashed by bin/cli before redirect.
        var output = (typeof(process.__ginaMcpStdout) === 'function')
            ? { write: process.__ginaMcpStdout }
            : process.stdout;

        server.attachStdio({
            input:  process.stdin,
            output: output,
            onClose: function() { gracefulExit(0); }
        });

        console.info('[ '+ bundle +' ][mcp] MCP server listening on stdio. Dispatch target: '+ baseUrl +' (timeout: '+ timeoutMs +' ms). '+ mcpDoc.tools.length +' tool'+ (mcpDoc.tools.length === 1 ? '' : 's') +' exposed.');

        process.on('SIGTERM', function() { gracefulExit(0); });
        process.on('SIGINT',  function() { gracefulExit(0); });
    };


    /**
     * Resolves the dispatch timeout in milliseconds. Precedence:
     *   1. `--timeout-ms=<n>` CLI flag
     *   2. `mcp.json > server > timeoutMs`
     *   3. 30 000 ms default
     *
     * Non-numeric or non-positive values at any layer are rejected in favour
     * of the next layer, so a malformed CLI flag or manifest field cannot
     * silently disable the timeout.
     *
     * @private
     * @param   {object} mcpDoc
     * @returns {number} Positive integer milliseconds
     */
    var resolveTimeoutMs = function(mcpDoc) {

        var DEFAULT_MS = 30000;

        var cli = self.params && self.params['timeout-ms'];
        if (typeof(cli) !== 'undefined' && cli !== null && cli !== true && cli !== false) {
            var parsedCli = Number(cli);
            if (isFinite(parsedCli) && parsedCli > 0) {
                return Math.floor(parsedCli);
            }
            console.warn('[mcp] Ignoring --timeout-ms='+ cli +' (must be a positive number). Falling back to manifest / default.');
        }

        if (mcpDoc && mcpDoc.server && typeof(mcpDoc.server.timeoutMs) !== 'undefined') {
            var parsedManifest = Number(mcpDoc.server.timeoutMs);
            if (isFinite(parsedManifest) && parsedManifest > 0) {
                return Math.floor(parsedManifest);
            }
            console.warn('[mcp] Ignoring mcp.json > server > timeoutMs='+ mcpDoc.server.timeoutMs +' (must be a positive number). Falling back to default.');
        }

        return DEFAULT_MS;
    };


    /**
     * Resolves the upstream bundle baseUrl. Prefers the live port registry,
     * falls back to the baseUrl embedded in the manifest at generation time.
     *
     * @private
     * @param   {string} bundle
     * @param   {object} mcpDoc
     * @returns {string}
     */
    var buildBaseUrl = function(bundle, mcpDoc) {

        var key = bundle + '@' + self.projectName;
        if ( typeof(self.portsReverseData) != 'undefined' && typeof(self.portsReverseData[key]) != 'undefined' ) {
            var entry  = self.portsReverseData[key];
            var scheme = entry.scheme || 'http';
            var port   = entry.port;
            if (port) {
                return scheme + '://localhost:' + port;
            }
        }

        if (mcpDoc.server && mcpDoc.server.baseUrl) {
            return mcpDoc.server.baseUrl;
        }

        // Last resort — the dispatcher will fail loudly on ECONNREFUSED.
        return 'http://localhost';
    };


    /**
     * Emits one stderr warning line per tool whose middleware list looks
     * session-scoped. Purely informational — the handler does not filter
     * those tools out; agents are free to call them and receive the
     * upstream 401/403 as `isError: true`.
     *
     * @private
     * @param   {object[]} tools
     */
    var warnSessionScopedTools = function(tools) {
        var hits = [];
        for (var i = 0; i < tools.length; i++) {
            var meta = tools[i]._meta || {};
            var mw = meta['io.gina.middleware'];
            if (Array.isArray(mw) && mw.length) {
                for (var j = 0; j < mw.length; j++) {
                    var name = String(mw[j]).toLowerCase();
                    if ( /(auth|session|login)/.test(name) ) {
                        hits.push(tools[i].name);
                        break;
                    }
                }
            }
        }
        if (hits.length) {
            console.warn(
                '[mcp] ' + hits.length + ' tool' + (hits.length === 1 ? '' : 's') +
                ' appear session-scoped (auth/session/login middleware): ' +
                hits.slice(0, 5).join(', ') + (hits.length > 5 ? ', …' : '') +
                '. These may return 401/403 until the bundle recognises the caller.'
            );
        }
    };


    /**
     * Closes the server cleanly and exits. Idempotent.
     *
     * @private
     * @param   {number} code
     */
    var gracefulExit = function(code) {
        if (shuttingDown) return;
        shuttingDown = true;
        try { if (server) server.close(); } catch (e) { /* ignore */ }
        process.exit(code || 0);
    };


    var end = function(output, type, messageOnly) {
        var err = false;
        if ( typeof(output) != 'undefined') {
            if ( output instanceof Error ) {
                err = output = ( typeof(messageOnly) != 'undefined' && /^true$/i.test(messageOnly) ) ? output.message : (output.stack||output.message);
            }
            if ( typeof(type) != 'undefined' ) {
                console[type](output);
            } else {
                console.log(output);
            }
        }

        process.exit( err ? 1 : 0 );
    };

    init();
}

module.exports = MCPStart;
