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
        // See .claude/architecture/index.md — require('lib/mcp-server') would
        // throw MODULE_NOT_FOUND because gna.js's NODE_PATH patch only runs in
        // bundle runtime, not in bin/cli.
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
