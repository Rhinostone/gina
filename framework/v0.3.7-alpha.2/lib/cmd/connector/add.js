var fs      = require('fs');
var path    = require('path');
var console = lib.logger;

var CmdHelper = require('./../helper');

/**
 * @module gina/lib/cmd/connector/add
 */
/**
 * Adds a connector entry to a project's shared or bundle-level
 * `connectors.json`. Positional-absence scoping:
 *
 *   gina connector:add <name> @<project>           → shared/config/connectors.json
 *   gina connector:add <name> <bundle> @<project>  → <bundle>/config/connectors.json
 *
 * The driver type is inferred from `<name>` when it matches one of the
 * schema enum values (e.g. `redis`, `couchbase`), otherwise `--connector=`
 * (or its synonym `--driver=`) is required. The allowed values mirror the
 * schema enum at `schema/connectors.json`.
 *
 * After writing the entry, prints the exact `npm install <driver>@<range>`
 * command to run, using the resolved version range in this order:
 *   1. the entry's `version` field (set via `--version=`)
 *   2. the framework `peerDependencies` range (DRIVER_MAP / AI_DRIVER_MAP)
 *
 * Leading header comments at the top of an existing `connectors.json` are
 * preserved verbatim (everything before the first `{`). Mid-body `//` or
 * `/* * /` comments are lost — the JSON body is rewritten from the parsed
 * object graph. See help.txt for the caveat.
 *
 * Flags:
 *   --connector=<type>        Driver type (enum: couchbase, mysql, postgresql,
 *                             sqlite, redis, ai). Required unless <name>
 *                             matches.
 *   --driver=<type>           Synonym for --connector=.
 *   --protocol=<uri>          Connection protocol URI scheme (couchbase://,
 *                             mysql://, anthropic://, …).
 *   --host=<host>             Hostname or IP. Comma-separated for clusters.
 *   --connector-port=<port>   Server port. Parsed as number when numeric.
 *                             (Not `--port=` — `--port` is reserved for the
 *                              gina framework socket port.)
 *   --database=<name>         Database / bucket / keyspace name.
 *   --username=<name>         Authentication username.
 *   --password=<value>        Authentication password. `${ENV_VAR}` preserved.
 *   --scope=<scope>           One of: local, beta, production, testing.
 *   --model=<id>              AI connector only. Default model identifier.
 *   --api-key=<value>         AI connector only. API key. `${ENV_VAR}`
 *                             preserved.
 *   --base-url=<url>          AI connector only. Custom base URL.
 *   --driver-version=<range>  Optional semver range to pin the driver install.
 *                             (Not `--version=` — `--version` is reserved
 *                              for the gina framework version override.)
 *   --force                   Overwrite an existing entry with the same name.
 *
 * Usage:
 *   gina connector:add session @myproject --connector=redis --host=127.0.0.1 --connector-port=6379
 *   gina connector:add mydb api @myproject --connector=mysql --database=mydb --username=root
 *   gina connector:add claude @myproject --connector=ai --protocol=anthropic:// --api-key=\${ANTHROPIC_API_KEY}
 *
 * @class Add
 * @constructor
 * @param {object} opt - Parsed command-line options
 * @param {object} opt.client - Socket client for terminal output
 * @param {string[]} opt.argv - Full argv array
 * @param {number} [opt.debugPort] - Node.js inspector port
 * @param {boolean} [opt.debugBrkEnabled] - True when --inspect-brk is active
 * @param {object} cmd - The cmd dispatcher object (lib/cmd/index.js)
 */
function Add(opt, cmd) {
    var self = {};

    /**
     * Allowed `connector` driver types — mirrors the enum in
     * `schema/connectors.json` (`connector.properties.connector.enum`).
     *
     * @inner
     * @constant
     * @type {string[]}
     */
    var ALLOWED_CONNECTOR_TYPES = ['couchbase', 'mysql', 'postgresql', 'sqlite', 'redis', 'ai'];

    /**
     * Allowed `scope` values — mirrors the enum in `schema/connectors.json`
     * (`connector.properties.scope.enum`).
     *
     * @inner
     * @constant
     * @type {string[]}
     */
    var ALLOWED_SCOPES = ['local', 'beta', 'production', 'testing'];

    /**
     * Driver map — logical `connector` type → npm driver package + the
     * framework peerDependencies range. Kept in sync with the table in
     * `lib/cmd/connector/list.js` by hand.
     *
     * `builtin: true` means the driver is provided by Node.js itself
     * (e.g. `node:sqlite` since Node 22.5.0) — nothing to install.
     *
     * @inner
     * @constant
     * @type {Object<string, {npm?: string, range?: string, builtin?: boolean, note?: string}>}
     */
    var DRIVER_MAP = {
        couchbase  : { npm: 'couchbase',               range: '>=3.0.0' },
        redis      : { npm: 'ioredis',                 range: '>=5.0.0' },
        mysql      : { npm: 'mysql2',                  range: '>=2.0.0' },
        postgresql : { npm: 'pg',                      range: '>=8.0.0' },
        sqlite     : { builtin: true, note: 'Node.js >= 22.5.0 built-in (node:sqlite)' }
    };

    /**
     * AI `protocol` scheme → npm driver. Matches the PROVIDERS table in
     * `core/connectors/ai/lib/connector.js` and the AI_DRIVER_MAP in
     * `lib/cmd/connector/list.js`.
     *
     * @inner
     * @constant
     * @type {Object<string, {npm: string, range: string}>}
     */
    var AI_DRIVER_MAP = {
        anthropic  : { npm: '@anthropic-ai/sdk', range: '>=0.27.0' },
        openai     : { npm: 'openai',            range: '>=4.0.0' },
        deepseek   : { npm: 'openai',            range: '>=4.0.0' },
        qwen       : { npm: 'openai',            range: '>=4.0.0' },
        groq       : { npm: 'openai',            range: '>=4.0.0' },
        mistral    : { npm: 'openai',            range: '>=4.0.0' },
        together   : { npm: 'openai',            range: '>=4.0.0' },
        ollama     : { npm: 'openai',            range: '>=4.0.0' },
        gemini     : { npm: 'openai',            range: '>=4.0.0' },
        xai        : { npm: 'openai',            range: '>=4.0.0' },
        perplexity : { npm: 'openai',            range: '>=4.0.0' }
    };

    /**
     * Parse positionals, validate scope/target, merge into the existing
     * `connectors.json`, write it back (preserving a leading comment
     * header when present), and print the install hint.
     *
     * @inner
     * @private
     */
    var init = function () {

        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
        if ( !isCmdConfigured() ) return false;

        var positionals = extractPositionals(process.argv);
        var connectorName = positionals[0] || null;
        var bundleName    = positionals[1] || null;

        if (!connectorName) {
            console.error('Usage: gina connector:add <name> [<bundle>] @<project> [--connector=<type>] [--host=...] [--connector-port=...]');
            process.exit(1);
            return;
        }

        if ( !/^[a-z0-9_\-]+$/i.test(connectorName) ) {
            console.error('Connector name `' + connectorName + '` is not valid. Use [a-zA-Z0-9_-] only.');
            process.exit(1);
            return;
        }

        if ( typeof(self.projectName) == 'undefined' || self.projectName == null ) {
            console.error('`connector:add` requires `@<project>`. Did you forget `@<project_name>`?');
            process.exit(1);
            return;
        }

        if ( typeof(self.projects[self.projectName]) == 'undefined' ) {
            console.error('Project @' + self.projectName + ' is not registered. Run `gina project:list` to see registered projects.');
            process.exit(1);
            return;
        }

        var projectPath = self.projects[self.projectName].path;
        var target      = resolveTarget(projectPath, bundleName);
        if (!target) return; // resolveTarget already exited

        var p             = self.params || {};
        var connectorType = p['connector'] || p['driver'] || null;
        if (!connectorType && ALLOWED_CONNECTOR_TYPES.indexOf(connectorName) > -1) {
            connectorType = connectorName;
        }
        if (!connectorType) {
            console.error('`connector:add` needs a connector type — pass `--connector=<type>` or name the entry after one of: ' + ALLOWED_CONNECTOR_TYPES.join(', ') + '.');
            process.exit(1);
            return;
        }
        if (ALLOWED_CONNECTOR_TYPES.indexOf(connectorType) < 0) {
            console.error('Unknown connector type `' + connectorType + '`. Allowed values: ' + ALLOWED_CONNECTOR_TYPES.join(', ') + '.');
            process.exit(1);
            return;
        }

        var entry = buildEntry(connectorName, connectorType, p);
        if (!entry) return; // buildEntry already exited on invalid scope

        var parsed = readExistingFile(target);
        if (!parsed) return; // readExistingFile already exited on parse error

        if (typeof parsed.data[connectorName] != 'undefined' && !p['force']) {
            console.error('Connector `' + connectorName + '` already exists in ' + target + '. Re-run with --force to overwrite.');
            process.exit(1);
            return;
        }

        var overwrite = (typeof parsed.data[connectorName] != 'undefined');
        var out       = mergeEntry(parsed.data, connectorName, entry);
        writeFile(target, parsed.header, out);

        console.log(
            (overwrite ? 'Updated' : 'Added') +
            ' connector `' + connectorName + '` (' + connectorType + ')' +
            (bundleName ? ' in bundle `' + bundleName + '`' : ' in shared scope') +
            ' at ' + target
        );

        var hint = buildInstallHint(connectorType, entry);
        if (hint) {
            console.log(hint);
        }

        process.exit(0);
    };

    /**
     * Walks `process.argv` from index 3 and returns every non-flag,
     * non-`@<project>` token in order. CmdHelper already consumes
     * `--` flags and `@<project>` tokens; the remainder are our
     * positionals: `[0]` is the connector logical name, `[1]` is the
     * optional bundle name.
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
     * Resolves the target `connectors.json` path based on whether a bundle
     * was supplied. Validates the bundle against `manifest.json` when one
     * is given. Exits the process on any error and returns null.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @param {string|null} bundleName
     * @returns {string|null}
     */
    var resolveTarget = function (projectPath, bundleName) {
        if (!bundleName) {
            return _(projectPath + '/shared/config/connectors.json', true);
        }
        var manifest = loadManifest(projectPath);
        if (!manifest || !manifest.bundles) {
            console.error('Cannot read `' + projectPath + '/manifest.json`. Project is missing or malformed.');
            process.exit(1);
            return null;
        }
        if ( !manifest.bundles[bundleName] ) {
            console.error('Bundle [ ' + bundleName + ' ] is not registered inside `@' + self.projectName + '`.');
            process.exit(1);
            return null;
        }
        var bundleSrc = manifest.bundles[bundleName].src;
        if (!bundleSrc) {
            console.error('Bundle [ ' + bundleName + ' ] has no `src` entry in manifest.json.');
            process.exit(1);
            return null;
        }
        return _(projectPath + '/' + bundleSrc + '/config/connectors.json', true);
    };

    /**
     * Loads `<projectPath>/manifest.json` with comment tolerance.
     * Returns null on missing or malformed file so the caller can exit
     * with a precise error message.
     *
     * @inner
     * @private
     * @param {string} projectPath
     * @returns {object|null}
     */
    var loadManifest = function (projectPath) {
        try {
            var p = _(projectPath + '/manifest.json', true);
            if ( !fs.existsSync(p) ) return null;
            return requireJSON(p);
        } catch (e) {
            return null;
        }
    };

    /**
     * Builds the connector entry object from the parsed flags. Only
     * supplied fields are written. `connector` is omitted when the
     * driver type matches the logical name (same convention as
     * `list.js::resolveDriver`). Validates `scope` against the enum.
     *
     * @inner
     * @private
     * @param {string} connectorName
     * @param {string} connectorType
     * @param {object} p - CmdHelper-parsed flags (self.params)
     * @returns {object|null} Entry object, or null after exiting on invalid scope
     */
    var buildEntry = function (connectorName, connectorType, p) {
        var entry = {};
        if (connectorType !== connectorName) {
            entry.connector = connectorType;
        }
        if (p['protocol']) entry.protocol = String(p['protocol']);
        if (p['host'])     entry.host     = String(p['host']);
        if (typeof p['connector-port'] != 'undefined' && p['connector-port'] !== true) {
            var portNum = Number(p['connector-port']);
            entry.port = isNaN(portNum) ? String(p['connector-port']) : portNum;
        }
        if (p['database']) entry.database = String(p['database']);
        if (p['username']) entry.username = String(p['username']);
        if (p['password']) entry.password = String(p['password']);
        if (p['scope']) {
            var sc = String(p['scope']);
            if (ALLOWED_SCOPES.indexOf(sc) < 0) {
                console.error('Scope `' + sc + '` is not valid. Allowed: ' + ALLOWED_SCOPES.join(', ') + '.');
                process.exit(1);
                return null;
            }
            entry.scope = sc;
        }
        if (p['model'])    entry.model   = String(p['model']);
        if (p['api-key'])  entry.apiKey  = String(p['api-key']);
        if (p['base-url']) entry.baseURL = String(p['base-url']);
        if (p['driver-version']) entry.version = String(p['driver-version']);
        return entry;
    };

    /**
     * Reads the existing `connectors.json` (if any), preserves any leading
     * comment header (everything before the first `{`), and parses the
     * JSON body with comment tolerance via `requireJSON`.
     *
     * Returns `{ header: string, data: object }`. On a parse failure, exits
     * with a clear message and returns null. When the file does not exist,
     * verifies the parent directory exists and returns an empty shape.
     *
     * @inner
     * @private
     * @param {string} target - Absolute path to connectors.json
     * @returns {{header: string, data: object}|null}
     */
    var readExistingFile = function (target) {
        if ( !fs.existsSync(target) ) {
            var parentDir = path.dirname(target);
            if ( !fs.existsSync(parentDir) ) {
                console.error('Config directory does not exist: `' + parentDir + '`. Create the bundle first (gina bundle:add), then re-run.');
                process.exit(1);
                return null;
            }
            return { header: '', data: {} };
        }
        var raw;
        try {
            raw = fs.readFileSync(target, 'utf8');
        } catch (e) {
            console.error('Cannot read `' + target + '`: ' + e.message);
            process.exit(1);
            return null;
        }
        var firstBrace = raw.indexOf('{');
        var header     = (firstBrace > 0) ? raw.slice(0, firstBrace) : '';
        var data;
        try {
            data = requireJSON(target) || {};
        } catch (e) {
            console.error('Cannot parse `' + target + '`: ' + e.message);
            process.exit(1);
            return null;
        }
        return { header: header, data: data };
    };

    /**
     * Merges `entry` into `existing` under `connectorName`, preserving key
     * order. `$schema` is pinned at the top; existing keys keep their
     * order; a fresh entry is appended. An overwrite replaces the value
     * at the existing key position.
     *
     * @inner
     * @private
     * @param {object} existing
     * @param {string} connectorName
     * @param {object} entry
     * @returns {object}
     */
    var mergeEntry = function (existing, connectorName, entry) {
        var out = {};
        if (existing.$schema) {
            out.$schema = existing.$schema;
        } else {
            out.$schema = 'https://gina.io/schema/connectors.json';
        }
        var overwrite = (typeof existing[connectorName] != 'undefined');
        for (var k in existing) {
            if (k === '$schema') continue;
            if (k === connectorName) {
                out[connectorName] = entry;
            } else {
                out[k] = existing[k];
            }
        }
        if (!overwrite) {
            out[connectorName] = entry;
        }
        return out;
    };

    /**
     * Writes the merged config back to disk. Preserves the leading comment
     * header verbatim when present, then serialises the JSON body with
     * 4-space indentation and a trailing newline.
     *
     * @inner
     * @private
     * @param {string} target
     * @param {string} header - Text before the first `{` in the existing file
     * @param {object} data - Full merged config object
     */
    var writeFile = function (target, header, data) {
        var body = JSON.stringify(data, null, 4);
        var text = (header || '') + body + '\n';
        lib.generator.createFileFromDataSync(text, target);
    };

    /**
     * Builds the "Next: run npm install …" hint line. For AI connectors,
     * resolves the driver from `entry.protocol`; for everything else, from
     * the static DRIVER_MAP. When the entry carries a `version` pin that
     * overrides the framework peerDependencies range.
     *
     * @inner
     * @private
     * @param {string} connectorType
     * @param {object} entry
     * @returns {string|null}
     */
    var buildInstallHint = function (connectorType, entry) {
        if (connectorType === 'ai') {
            var scheme = entry.protocol ? String(entry.protocol).split(':')[0].toLowerCase() : null;
            if (!scheme || !AI_DRIVER_MAP[scheme]) {
                return 'Next: set `protocol` to one of: ' + Object.keys(AI_DRIVER_MAP).map(function(k){ return k + '://'; }).join(', ') + ' — then run the matching npm install.';
            }
            var ai    = AI_DRIVER_MAP[scheme];
            var range = entry.version || ai.range;
            return 'Next: run `npm install ' + ai.npm + '@"' + range + '"` inside your project root.';
        }
        var info = DRIVER_MAP[connectorType];
        if (!info) return null;
        if (info.builtin) {
            return 'No install needed — ' + info.note + '.';
        }
        var r = entry.version || info.range;
        return 'Next: run `npm install ' + info.npm + '@"' + r + '"` inside your project root.';
    };

    init();
}

module.exports = Add;
