var fs      = require('fs');
var console = lib.logger;

var CmdHelper = require('./../helper');

/**
 * @module gina/lib/cmd/connector/infer
 */
/**
 * Exercises a configured AI connector OUTSIDE a request — resolves a
 * project's connector config, instantiates the connector directly, and runs
 * a single buffered inference, writing the normalised result to stdout. The
 * runtime sibling of the config-only `connector:add` / `connector:list`
 * tooling: a connector can be smoke-tested for connectivity + credentials
 * from CI/automation, and a one-off inference can be scripted from a shell.
 *
 * `getModel` is deliberately NOT used: it reads from a per-bundle registry
 * populated only by `loadAllModels()` at bundle boot (empty in CLI scope),
 * and its single-arg form infers the bundle by walking the call stack — which
 * resolves to this handler's path, not a bundle, in offline scope. Instead
 * the connector classes are instantiated directly:
 *
 *   setPath('project', <projectPath>)          // SDK resolves from the project's node_modules
 *   new AIConnector(entry).onReady((err, conn)) // build the provider client (no network ping)
 *   AI(conn).infer(messages, options)           // buffered inference → normalised result
 *
 * Config resolution mirrors `connector:list`: the shared
 * `shared/config/connectors.json` is key-merged with the bundle's
 * `<bundle-src>/config/connectors.json` when a bundle is given, bundle
 * winning on a key collision. `${secret:KEY}` placeholders (typically the
 * `apiKey`) are resolved from `process.env` via `lib.secrets` — fail-closed,
 * and the resolved value is NEVER echoed.
 *
 * Operational note: a detached CLI invocation only sees its own shell
 * environment, not secrets a supervisor/orchestrator injects at bundle
 * start. Run against a shell that exports the key, or pass `--api-key=<literal>`.
 * Note that a bare `${ENV_VAR}` (no `secret:` prefix) is NOT substituted —
 * only `${secret:KEY}` or a literal value.
 *
 * Usage:
 *   gina connector:infer <connector> @<project> --message="..."
 *   gina connector:infer <connector> <bundle> @<project> --message="..." --system="..."
 *   gina connector:infer <connector> @<project> --message="..." --format=json
 *   echo '[{"role":"user","content":"hi"}]' | gina connector:infer <connector> @<project>
 *
 * Exit codes: 0 on a completed inference; non-zero (reason on stderr) on
 * connector-not-found / unconfigured / not-an-AI-connector / missing-SDK /
 * credential / transport error.
 *
 * @class Infer
 * @constructor
 * @param {object} opt - Parsed command-line options
 * @param {object} opt.client - Socket client for terminal output
 * @param {string[]} opt.argv - Full argv array
 * @param {number} [opt.debugPort] - Node.js inspector port
 * @param {boolean} [opt.debugBrkEnabled] - True when --inspect-brk is active
 * @param {object} cmd - The cmd dispatcher object (lib/cmd/index.js)
 */
function Infer(opt, cmd) {
    var self = { format: null };

    /**
     * Pure connector-entry resolver — merges the shared + bundle
     * connectors.json maps (bundle wins), selects a single entry by name, and
     * detects the AI subtype. This handler does the file I/O and passes the
     * parsed maps in. See `lib/connector-config/src/main.js`.
     *
     * @inner
     * @constant
     */
    var cfg = lib.connectorConfig;

    /**
     * Secrets resolver — substitutes `${secret:KEY}` placeholders in the
     * connector entry from `process.env`. Reading `connectors.json` off disk
     * does NOT get auto-resolution (that only happens inside the framework's
     * `loadBundleConfig`), so the handler must call `resolve()` itself. See
     * `lib/secrets/src/main.js`.
     *
     * @inner
     * @constant
     */
    var secrets = lib.secrets;

    /**
     * Parse --format and positionals, resolve the connector entry, resolve
     * secrets, build the messages + options, and run the inference.
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
                self.format = arg.split(/\=/)[1];
            }
        }

        var p = self.params || {};

        // Positionals: [0] connector logical name, [1] optional bundle name.
        var positionals   = extractPositionals(process.argv);
        var connectorName = positionals[0] || null;
        var bundleName    = positionals[1] || null;

        if (!connectorName) {
            console.error('Usage: gina connector:infer <connector> [<bundle>] @<project> --message="..." [--system="..."] [--model=...] [--format=json]');
            process.exit(1);
            return;
        }

        if ( typeof(self.projectName) == 'undefined' || self.projectName == null ) {
            console.error('`connector:infer` requires `@<project>`. Did you forget `@<project_name>`?');
            process.exit(1);
            return;
        }

        if ( typeof(self.projects[self.projectName]) == 'undefined' ) {
            console.error('Project @' + self.projectName + ' is not registered. Run `gina project:list` to see registered projects.');
            process.exit(1);
            return;
        }

        var projectPath = self.projects[self.projectName].path;

        // Merged connector entry (shared + bundle, bundle wins). Exits on a
        // bad bundle; returns null when the connector is declared nowhere.
        var entry = resolveConnectorEntry(projectPath, bundleName, connectorName);
        if (!entry) {
            console.error(
                'Connector `' + connectorName + '` not found in '
                + (bundleName ? ('bundle `' + bundleName + '` (merged with shared) of ') : 'shared config of ')
                + '@' + self.projectName + '. Run `gina connector:list @' + self.projectName + '` to see configured connectors.'
            );
            process.exit(1);
            return;
        }

        // infer/stream are AI-specific — reject any non-`ai` connector cleanly.
        if (!cfg.isAIConnector(entry)) {
            var type = (entry && entry.connector) ? entry.connector : connectorName;
            console.error('Connector `' + connectorName + '` is a `' + type + '` connector, not `ai`. `connector:infer` only works with AI connectors.');
            process.exit(1);
            return;
        }

        // Ad-hoc connector-level overrides (NOT written back to disk). --model
        // is an inference-level override and is applied to the call options,
        // not the entry (see buildOptions).
        if (p['protocol'] && p['protocol'] !== true) entry.protocol = String(p['protocol']);
        if (p['base-url'] && p['base-url'] !== true) entry.baseURL  = String(p['base-url']);
        if (p['api-key']  && p['api-key']  !== true) entry.apiKey   = String(p['api-key']); // literal — bypasses ${secret:}

        // Resolve ${secret:KEY} placeholders (apiKey etc.) from process.env.
        // Fail-closed; the missing KEY name is surfaced (never the value).
        try {
            secrets.resolve(entry);
        } catch (secretErr) {
            console.error(
                '[connector:infer] secret resolution failed for `' + (secretErr._ginaSecretKey || '<unknown>') + '`. '
                + 'Set it in this shell (export ' + (secretErr._ginaSecretKey || 'KEY') + '=...), or pass --api-key=<literal>. '
                + 'A detached CLI sees only its own environment, not secrets injected by a supervisor at bundle start.'
            );
            process.exit(1);
            return;
        }

        // Build the messages array (stdin JSON wins when piped) + per-call options.
        var built = buildMessages(p);
        if (!built) return; // buildMessages already exited
        var options = buildOptions(p, built.system);

        runInference(projectPath, entry, built.messages, options);
    };

    /**
     * Walks `process.argv` from index 3 and returns every non-flag,
     * non-`@<project>` token in order. CmdHelper already consumes `--`
     * flags and `@<project>` tokens; the remainder are our positionals:
     * `[0]` is the connector logical name, `[1]` is the optional bundle name.
     * Mirrors `connector:add`'s extractor.
     *
     * @inner
     * @private
     * @param {string[]} argv - process.argv
     * @returns {string[]}
     */
    var extractPositionals = function (argv) {
        var out = [];
        for (var i = 3, len = argv.length; i < len; i++) {
            var tok = argv[i];
            if ( typeof(tok) != 'string' ) continue;
            if ( /^\-\-/.test(tok) ) continue;
            if ( /^\-/.test(tok)  ) continue;
            if ( /^\@/.test(tok)  ) continue;
            out.push(tok);
        }
        return out;
    };

    /**
     * Reads a JSON file with tolerance for line and block comments via
     * `requireJSON` (connectors files routinely carry comments). Returns
     * `null` on any parse or I/O error. Mirrors `connector:list`.
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
     * Loads `<projectPath>/manifest.json` (comment-tolerant). Returns null
     * on failure so the caller can report precisely.
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
     * Resolves the connector entry for `connectorName`: reads the shared
     * connectors.json and (when a bundle is supplied) the bundle's, then
     * delegates the merge + select to the shared pure resolver
     * (`lib.connectorConfig.resolve`, bundle wins). The returned object is a
     * fresh copy, safe to mutate in place (overrides + secrets.resolve).
     *
     * Exits the process (code 1) when the named bundle is not registered.
     * Returns `null` when the connector is declared in neither file.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {string|null} bundleName
     * @param {string} connectorName
     * @returns {object|null}
     */
    var resolveConnectorEntry = function (projectPath, bundleName, connectorName) {
        var sharedJson = readJsonSafe(_(projectPath + '/shared/config/connectors.json', true)) || {};

        var bundleJson = {};
        if (bundleName) {
            var manifest = loadManifest(projectPath);
            if (!manifest || !manifest.bundles || !manifest.bundles[bundleName]) {
                console.error('Bundle [ ' + bundleName + ' ] is not registered inside `@' + self.projectName + '`.');
                process.exit(1);
                return null;
            }
            var bSrc = manifest.bundles[bundleName].src;
            if (bSrc) {
                bundleJson = readJsonSafe(_(projectPath + '/' + bSrc + '/config/connectors.json', true)) || {};
            }
        }

        return cfg.resolve(sharedJson, bundleJson, connectorName).entry;
    };

    /**
     * Builds the OpenAI-format messages array. When stdin is piped (non-TTY),
     * a JSON messages array on stdin takes precedence; otherwise `--message`
     * (with optional `--system`) is used. Exits (code 1) on malformed stdin
     * JSON or when no prompt is supplied.
     *
     * @inner
     * @private
     * @param {object} p - CmdHelper-parsed flags (self.params)
     * @returns {{messages: object[], system: string|null}|null}
     */
    var buildMessages = function (p) {
        var system = (p['system'] && p['system'] !== true) ? String(p['system']) : null;

        // stdin JSON wins when piped.
        if (!process.stdin.isTTY) {
            var raw = '';
            try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { raw = ''; }
            raw = (raw || '').trim();
            if (raw) {
                var parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    console.error('[connector:infer] stdin is not valid JSON: ' + e.message + '. Expected a messages array: [{"role":"user","content":"..."}]');
                    process.exit(1);
                    return null;
                }
                if (!Array.isArray(parsed)) {
                    console.error('[connector:infer] stdin JSON must be a messages array: [{"role":"user","content":"..."}].');
                    process.exit(1);
                    return null;
                }
                return { messages: parsed, system: system };
            }
        }

        var message = (typeof p['message'] === 'string') ? p['message'] : null;
        if (!message) {
            console.error('[connector:infer] provide a prompt: --message="..." (optionally with --system="..."), or pipe a messages JSON array on stdin.');
            process.exit(1);
            return null;
        }
        return { messages: [{ role: 'user', content: message }], system: system };
    };

    /**
     * Builds the per-call inference options from flags. `--model` is an
     * inference-level override (options.model wins over the connector's
     * default model). Non-numeric `--max-tokens` / `--temperature` are ignored.
     *
     * @inner
     * @private
     * @param {object} p - CmdHelper-parsed flags (self.params)
     * @param {string|null} system - Resolved system prompt from buildMessages
     * @returns {object}
     */
    var buildOptions = function (p, system) {
        var options = {};
        if (p['model'] && p['model'] !== true) options.model = String(p['model']);
        if (system) options.system = system;
        if (p['max-tokens'] && p['max-tokens'] !== true) {
            var mt = Number(p['max-tokens']);
            if (!isNaN(mt)) options.maxTokens = mt;
        }
        if (p['temperature'] && p['temperature'] !== true) {
            var tp = Number(p['temperature']);
            if (!isNaN(tp)) options.temperature = tp;
        }
        return options;
    };

    /**
     * Instantiates the AI connector directly and runs one buffered inference.
     * `setPath('project', ...)` points `getPath('project')` (used by
     * AIConnector to require the provider SDK) at the TARGET project's
     * node_modules. `onReady` is synchronous and performs no network ping.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {object} entry - Resolved connector entry (secrets already substituted)
     * @param {object[]} messages - OpenAI-format messages
     * @param {object} options - infer() options (model/maxTokens/temperature/system)
     */
    var runInference = function (projectPath, entry, messages, options) {
        var AIConnector, AI;
        try {
            AIConnector = require('../../../core/connectors/ai/lib/connector');
            AI          = require('../../../core/connectors/ai/index');
        } catch (e) {
            console.error('[connector:infer] failed to load the AI connector core: ' + e.message);
            process.exit(1);
            return;
        }

        // AIConnector requires the provider SDK from getPath('project')/node_modules.
        setPath('project', projectPath);

        var connector = new AIConnector(entry);
        connector.onReady(function (err, conn) {
            if (err) {
                console.error('[connector:infer] ' + err.message);
                process.exit(1);
                return;
            }
            var ai = AI(conn);
            ai.infer(messages, options)
                .then(function (result) {
                    emitResult(result);
                    process.exit(0);
                })
                .catch(function (e) {
                    console.error('[connector:infer] inference failed: ' + (e && e.message ? e.message : e));
                    process.exit(1);
                });
        });
    };

    /**
     * Writes the normalised inference result. JSON mode emits
     * `{ content, model, usage }` (the heavy provider `raw` is omitted for
     * CLI use). Text mode writes the content verbatim to stdout (so
     * `> file` captures only the content) and a model/usage footer to stderr.
     *
     * @inner
     * @private
     * @param {object} result - infer() normalised result { content, model, usage, raw }
     */
    var emitResult = function (result) {
        if ( /^json?/.test(self.format) ) {
            process.stdout.write(JSON.stringify({
                content : result.content,
                model   : result.model,
                usage   : result.usage
            }));
            return;
        }
        process.stdout.write((result.content || '') + '\n');
        var u      = result.usage || {};
        var inTok  = (typeof u.inputTokens  === 'number') ? u.inputTokens  : 'n/a';
        var outTok = (typeof u.outputTokens === 'number') ? u.outputTokens : 'n/a';
        process.stderr.write('— ' + (result.model || 'unknown model') + '  (tokens in: ' + inTok + ', out: ' + outTok + ')\n');
    };

    init();
}

module.exports = Infer;
