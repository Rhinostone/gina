/**
 * bin/cli + lib/cmd/bundle/mcp-start.js — source-level checks.
 *
 * Why source inspection only:
 *   mcp-start relies on the running gina daemon context (CmdHelper,
 *   registered projects, portsReverseData, framework logger). A full
 *   replica would need heavy mocking for near-zero additional coverage
 *   beyond what test/lib/mcp-server.test.js + test/lib/mcp-dispatch.test.js
 *   already give us.
 *
 *   These assertions prove the wiring invariants that would silently
 *   break if the file were refactored carelessly:
 *     (a) bin/cli redirects stdout to stderr only for bundle:mcp-start
 *     (b) the original write is stashed on process.__ginaMcpStdout
 *     (c) the handler reads the stash and passes it to attachStdio
 *     (d) the handler enforces exactly-one-bundle
 *     (e) missing mcp.json fails with a helpful message
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW_PATH     = require('../fw');
var CLI_PATH    = path.resolve(FW_PATH, '..', '..', 'bin', 'cli');
var HANDLER_PATH = path.join(FW_PATH, 'lib/cmd/bundle/mcp-start.js');

var cliSrc     = fs.readFileSync(CLI_PATH, 'utf8');
var handlerSrc = fs.readFileSync(HANDLER_PATH, 'utf8');


// ---------------------------------------------------------------------------
// 01 — bin/cli intercept
// ---------------------------------------------------------------------------

describe('01 - bin/cli intercept for bundle:mcp-start', function () {

    it('gates the intercept on bundle:mcp-start appearing in argv', function () {
        assert.match(cliSrc, /process\.argv\.indexOf\(['"]bundle:mcp-start['"]\)/);
    });

    it('stashes the real stdout.write on process.__ginaMcpStdout', function () {
        assert.match(cliSrc, /process\.__ginaMcpStdout\s*=\s*process\.stdout\.write\.bind\(process\.stdout\)/);
    });

    it('redirects stdout.write to stderr.write', function () {
        assert.match(cliSrc, /process\.stdout\.write\s*=\s*process\.stderr\.write\.bind\(process\.stderr\)/);
    });

    it('runs before any require call (appears before `var fs = require`)', function () {
        var interceptIdx = cliSrc.indexOf('process.__ginaMcpStdout');
        var firstRequire = cliSrc.indexOf("require('fs')");
        assert.ok(interceptIdx !== -1, 'intercept not found');
        assert.ok(firstRequire !== -1, 'first require not found');
        assert.ok(interceptIdx < firstRequire,
            'intercept must execute before any framework require to avoid logger init noise on stdout');
    });
});


// ---------------------------------------------------------------------------
// 02 — handler imports the MCP libs via the registry
// ---------------------------------------------------------------------------

describe('02 - handler wiring', function () {

    it('reads lib.mcpServer and lib.mcpDispatch from the registry', function () {
        assert.match(handlerSrc, /lib\.mcpServer/);
        assert.match(handlerSrc, /lib\.mcpDispatch/);
    });

    it('does not use the bare-module form (which fails in CLI daemon scope)', function () {
        // require('lib/mcp-server') would throw MODULE_NOT_FOUND because
        // gna.js's NODE_PATH patch only runs in bundle runtime, not in bin/cli.
        assert.doesNotMatch(handlerSrc, /require\(['"]lib\/mcp-server['"]\)/);
        assert.doesNotMatch(handlerSrc, /require\(['"]lib\/mcp-dispatch['"]\)/);
    });
});


// ---------------------------------------------------------------------------
// 03 — exactly-one-bundle constraint
// ---------------------------------------------------------------------------

describe('03 - exactly-one-bundle constraint', function () {

    it('rejects zero bundles with a usage-oriented message', function () {
        assert.match(handlerSrc, /Missing argument <bundle_name>/);
    });

    it('rejects more than one bundle', function () {
        assert.match(handlerSrc, /takes exactly one bundle/);
    });
});


// ---------------------------------------------------------------------------
// 04 — mcp.json prerequisite
// ---------------------------------------------------------------------------

describe('04 - manifest prerequisite', function () {

    it('looks up config/mcp.json under the bundle src', function () {
        assert.match(handlerSrc, /config\/mcp\.json/);
    });

    it('tells the user to run `gina bundle:mcp` when the manifest is missing', function () {
        assert.match(handlerSrc, /Run `gina bundle:mcp.*` first/);
    });

    it('loads the manifest via requireJSON (strips // and /* */ comments)', function () {
        assert.match(handlerSrc, /requireJSON\(mcpPath\)/);
    });

    it('warns on routing.json newer than mcp.json (staleness check)', function () {
        assert.match(handlerSrc, /routingMtime\s*>\s*mcpMtime/);
    });
});


// ---------------------------------------------------------------------------
// 05 — stdio wiring
// ---------------------------------------------------------------------------

describe('05 - stdio wiring', function () {

    it('reads the stashed stdout.write from process.__ginaMcpStdout', function () {
        assert.match(handlerSrc, /process\.__ginaMcpStdout/);
    });

    it('attaches the server to stdin/output with onClose', function () {
        assert.match(handlerSrc, /attachStdio\(\s*\{/);
        assert.match(handlerSrc, /input:\s*process\.stdin/);
        assert.match(handlerSrc, /onClose:/);
    });

    it('installs SIGTERM and SIGINT handlers for graceful exit', function () {
        assert.match(handlerSrc, /process\.on\(['"]SIGTERM['"]/);
        assert.match(handlerSrc, /process\.on\(['"]SIGINT['"]/);
    });
});


// ---------------------------------------------------------------------------
// 06 — baseUrl resolution
// ---------------------------------------------------------------------------

describe('06 - baseUrl resolution', function () {

    it('prefers the live port registry', function () {
        assert.match(handlerSrc, /self\.portsReverseData\[key\]/);
    });

    it('falls back to the manifest baseUrl', function () {
        assert.match(handlerSrc, /mcpDoc\.server\.baseUrl/);
    });
});


// ---------------------------------------------------------------------------
// 07 — session-scoped tools warning
// ---------------------------------------------------------------------------

describe('07 - session-scoped tools warning', function () {

    it('scans _meta.io.gina.middleware for auth/session/login names', function () {
        assert.match(handlerSrc, /io\.gina\.middleware/);
        assert.match(handlerSrc, /auth\|session\|login/);
    });
});


// ---------------------------------------------------------------------------
// 08 — --timeout-ms CLI flag wiring
// ---------------------------------------------------------------------------

describe('08 - --timeout-ms CLI flag wiring', function () {

    var argsPath = path.join(FW_PATH, 'lib/cmd/bundle/arguments.json');
    var argsSrc  = fs.readFileSync(argsPath, 'utf8');

    it('whitelists --timeout-ms in lib/cmd/bundle/arguments.json', function () {
        assert.match(argsSrc, /"--timeout-ms"/);
    });

    it('reads self.params[\'timeout-ms\'] for the CLI override', function () {
        assert.match(handlerSrc, /self\.params\s*\[[^\]]*['"]timeout-ms['"]/);
    });

    it('reads mcpDoc.server.timeoutMs for the manifest fallback', function () {
        assert.match(handlerSrc, /mcpDoc\.server\.timeoutMs/);
    });

    it('falls back to the 30 000 ms default when neither is set', function () {
        assert.match(handlerSrc, /DEFAULT_MS\s*=\s*30000/);
    });

    it('passes the resolved timeout to createDispatcher', function () {
        // Must pass the variable, not the hardcoded 30000.
        assert.match(handlerSrc, /createDispatcher\(\s*\{[^}]*timeoutMs:\s*timeoutMs/);
    });

    it('validates positive-number semantics at every layer', function () {
        // Both CLI and manifest paths must reject non-finite / non-positive values.
        var body = handlerSrc;
        assert.ok(/isFinite\(parsedCli\).*parsedCli\s*>\s*0/.test(body),
            'CLI value guarded by isFinite + > 0');
        assert.ok(/isFinite\(parsedManifest\).*parsedManifest\s*>\s*0/.test(body),
            'manifest value guarded by isFinite + > 0');
    });

    it('surfaces the resolved timeout in the startup info line', function () {
        assert.match(handlerSrc, /timeout:\s*'\s*\+\s*timeoutMs/);
    });
});


// ---------------------------------------------------------------------------
// 09 — --transport CLI flag + stdio|http branch (#AI8 Phase 2b S3)
// ---------------------------------------------------------------------------

describe('09 - --transport flag + stdio|http branch', function () {

    var argsPath = path.join(FW_PATH, 'lib/cmd/bundle/arguments.json');
    var argsSrc  = fs.readFileSync(argsPath, 'utf8');

    it('whitelists --transport in arguments.json', function () {
        assert.match(argsSrc, /"--transport"/);
    });

    it('reads self.params[\'transport\'] for the CLI override', function () {
        assert.match(handlerSrc, /self\.params\s*\[[^\]]*['"]transport['"]/);
    });

    it('reads mcpDoc.server.transport for the manifest fallback', function () {
        assert.match(handlerSrc, /mcpDoc\.server\.transport/);
    });

    it('validates transport value against stdio|http', function () {
        assert.match(handlerSrc, /c\s*===\s*['"]stdio['"]\s*\|\|\s*c\s*===\s*['"]http['"]/);
    });

    it('defaults to stdio when neither CLI nor manifest is set', function () {
        assert.match(handlerSrc, /return\s+['"]stdio['"];/);
    });

    it('branches on the resolved transport to startStdio vs startHttp', function () {
        assert.match(handlerSrc, /startHttp\(/);
        assert.match(handlerSrc, /startStdio\(/);
        assert.match(handlerSrc, /if\s*\(\s*transport\s*===\s*['"]http['"]\s*\)/);
    });
});


// ---------------------------------------------------------------------------
// 10 — HTTP bind host/port resolvers (Session 3)
// ---------------------------------------------------------------------------

describe('10 - HTTP bind host/port resolvers', function () {

    var argsPath = path.join(FW_PATH, 'lib/cmd/bundle/arguments.json');
    var argsSrc  = fs.readFileSync(argsPath, 'utf8');

    it('whitelists --http-host and --http-port in arguments.json', function () {
        assert.match(argsSrc, /"--http-host"/);
        assert.match(argsSrc, /"--http-port"/);
    });

    it('resolveHttpHost follows CLI → manifest → GINA_HOST_V4 → 127.0.0.1', function () {
        assert.match(handlerSrc, /self\.params\s*\[[^\]]*['"]http-host['"]/);
        assert.match(handlerSrc, /mcpDoc\.server\.httpHost/);
        assert.match(handlerSrc, /process\.env\.GINA_HOST_V4/);
        assert.match(handlerSrc, /return\s+['"]127\.0\.0\.1['"];/);
    });

    it('resolveHttpPort follows CLI → manifest → 0 (OS-assigned)', function () {
        assert.match(handlerSrc, /self\.params\s*\[[^\]]*['"]http-port['"]/);
        assert.match(handlerSrc, /mcpDoc\.server\.httpPort/);
        assert.match(handlerSrc, /return\s+0;/);
    });

    it('resolveHttpPort guards with 0..65535 range + integer check', function () {
        // Both CLI and manifest paths must reject out-of-range / non-integer values.
        assert.match(handlerSrc, /parsedCli\s*>=\s*0\s*&&\s*parsedCli\s*<\s*65536/);
        assert.match(handlerSrc, /parsedManifest\s*>=\s*0\s*&&\s*parsedManifest\s*<\s*65536/);
        assert.match(handlerSrc, /Math\.floor\(parsedCli\)\s*===\s*parsedCli/);
    });
});


// ---------------------------------------------------------------------------
// 11 — --max-in-flight resolver (Session 3)
// ---------------------------------------------------------------------------

describe('11 - --max-in-flight resolver', function () {

    var argsPath = path.join(FW_PATH, 'lib/cmd/bundle/arguments.json');
    var argsSrc  = fs.readFileSync(argsPath, 'utf8');

    it('whitelists --max-in-flight in arguments.json', function () {
        assert.match(argsSrc, /"--max-in-flight"/);
    });

    it('follows CLI → manifest → DEFAULT_MAX_IN_FLIGHT', function () {
        assert.match(handlerSrc, /self\.params\s*\[[^\]]*['"]max-in-flight['"]/);
        assert.match(handlerSrc, /mcpDoc\.server\.maxInFlight/);
        assert.match(handlerSrc, /mcpDispatch\.DEFAULT_MAX_IN_FLIGHT/);
    });

    it('passes the resolved cap to createDispatcher', function () {
        assert.match(handlerSrc, /createDispatcher\(\s*\{[^}]*maxInFlight:\s*maxInFlight/);
    });

    it('guards with positive-integer semantics', function () {
        assert.match(handlerSrc, /isFinite\(parsedCli\).*parsedCli\s*>\s*0.*Math\.floor\(parsedCli\)\s*===\s*parsedCli/s);
    });
});


// ---------------------------------------------------------------------------
// 12 — --auth-token + --cors-origin resolvers (Session 3)
// ---------------------------------------------------------------------------

describe('12 - auth-token + cors-origin resolvers', function () {

    var argsPath = path.join(FW_PATH, 'lib/cmd/bundle/arguments.json');
    var argsSrc  = fs.readFileSync(argsPath, 'utf8');

    it('whitelists --auth-token and --cors-origin in arguments.json', function () {
        assert.match(argsSrc, /"--auth-token"/);
        assert.match(argsSrc, /"--cors-origin"/);
    });

    it('resolveAuthToken follows CLI → manifest → GINA_MCP_AUTH_TOKEN env → null', function () {
        assert.match(handlerSrc, /self\.params\s*\[[^\]]*['"]auth-token['"]/);
        assert.match(handlerSrc, /mcpDoc\.server\.authToken/);
        assert.match(handlerSrc, /process\.env\.GINA_MCP_AUTH_TOKEN/);
    });

    it('resolveAllowedOrigins parses CLI as comma-separated list', function () {
        assert.match(handlerSrc, /self\.params\s*\[[^\]]*['"]cors-origin['"]/);
        assert.match(handlerSrc, /\.split\(\s*['"]\s*,\s*['"]\s*\)/);
        // Empty entries (trailing commas, double commas) filtered out.
        assert.match(handlerSrc, /\.filter\(/);
    });

    it('resolveAllowedOrigins falls back to manifest array', function () {
        assert.match(handlerSrc, /mcpDoc\.server\.allowedOrigins/);
        assert.match(handlerSrc, /Array\.isArray\(mcpDoc\.server\.allowedOrigins\)/);
    });
});


// ---------------------------------------------------------------------------
// 13 — HTTP transport wire-up (Session 3)
// ---------------------------------------------------------------------------

describe('13 - HTTP transport wire-up', function () {

    it('reads lib.mcpHttp from the registry', function () {
        assert.match(handlerSrc, /var\s+mcpHttp\s*=\s*lib\.mcpHttp/);
    });

    it('does not use bare-module form for mcp-http', function () {
        assert.doesNotMatch(handlerSrc, /require\(['"]lib\/mcp-http['"]\)/);
    });

    it('calls mcpHttp.createHttpTransport with server + host/port/authToken/allowedOrigins', function () {
        assert.match(handlerSrc, /mcpHttp\.createHttpTransport\(\s*\{/);
        assert.match(handlerSrc, /mcpServer:\s*server/);
        assert.match(handlerSrc, /host:\s*host/);
        assert.match(handlerSrc, /port:\s*port/);
        assert.match(handlerSrc, /authToken:\s*authToken/);
        assert.match(handlerSrc, /allowedOrigins:\s*allowedOrigins/);
    });

    it('starts the transport via .start() and surfaces the resolved port in the log line', function () {
        assert.match(handlerSrc, /httpTransport\.start\(\)/);
        assert.match(handlerSrc, /listening on http:\/\/'\s*\+\s*info\.host/);
    });

    it('logs bearer auth status in the startup info line', function () {
        assert.match(handlerSrc, /bearer auth:/);
    });

    it('rejects with a helpful message when start() fails (port in use etc.)', function () {
        assert.match(handlerSrc, /Failed to start HTTP transport on /);
    });
});


// ---------------------------------------------------------------------------
// 14 — SIGTERM / gracefulExit drains HTTP transport (Session 3)
// ---------------------------------------------------------------------------

describe('14 - gracefulExit drains HTTP transport', function () {

    it('installs SIGTERM/SIGINT in the HTTP branch too', function () {
        // Check that BOTH startStdio and startHttp install the signal handlers.
        var matches = handlerSrc.match(/process\.on\(['"]SIGTERM['"]/g) || [];
        assert.ok(matches.length >= 2, 'SIGTERM must be installed in both transport branches');
    });

    it('awaits httpTransport.stop() before process.exit', function () {
        assert.match(handlerSrc, /httpTransport\.stop\(\)\.then\(\s*finish\s*,\s*finish\s*\)/);
    });

    it('is idempotent via shuttingDown flag', function () {
        assert.match(handlerSrc, /if\s*\(shuttingDown\)\s*return;/);
        assert.match(handlerSrc, /shuttingDown\s*=\s*true;/);
    });
});
