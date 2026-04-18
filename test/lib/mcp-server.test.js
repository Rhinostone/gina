/**
 * lib/mcp-server — JSON-RPC 2.0 framing, MCP lifecycle, and tools/call
 * validation/dispatch.
 *
 * These tests exercise the server in isolation (no fs, no network). The
 * dispatch function is injected as a fake that records its calls and
 * returns canned results.
 */

'use strict';

var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var stream = require('stream');

var mcpServer = require(path.join(require('../fw'), 'lib/mcp-server/src/main'));


// Minimal manifest used across most tests.
function buildManifest(tools) {
    return {
        protocolVersion: '2025-06-18',
        server: { name: 'test', version: '0.0.0' },
        tools: tools || [
            {
                name: 'get_user',
                title: 'Get user',
                description: 'GET /user/:id',
                inputSchema: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id']
                },
                _meta: { 'io.gina.method': 'GET', 'io.gina.url': '/user/:id' }
            }
        ]
    };
}

function makeServer(overrides) {
    var dispatchCalls = [];
    var defaults = {
        manifest:   buildManifest(),
        dispatch:   function(tool, args) {
            dispatchCalls.push({ tool: tool.name, args: args });
            return Promise.resolve({
                content: [{ type: 'text', text: JSON.stringify({ ok: true, args: args }) }],
                structuredContent: { ok: true, args: args }
            });
        },
        serverInfo: { name: 'test', version: '0.0.0' }
    };
    var opts = Object.assign({}, defaults, overrides || {});
    var srv = mcpServer.createServer(opts);
    srv._dispatchCalls = dispatchCalls;
    return srv;
}

function req(id, method, params) {
    return JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params });
}

function notif(method, params) {
    return JSON.stringify({ jsonrpc: '2.0', method: method, params: params });
}


// ---------------------------------------------------------------------------
// 01 — createServer: input validation
// ---------------------------------------------------------------------------

describe('01 - createServer: input validation', function () {

    it('throws if opts is missing', function () {
        assert.throws(function () { mcpServer.createServer(); }, /opts is required/);
    });

    it('throws if manifest.tools is not an array', function () {
        assert.throws(function () {
            mcpServer.createServer({ manifest: {}, dispatch: function () {}, serverInfo: { name: 'x' } });
        }, /manifest\.tools/);
    });

    it('throws if dispatch is not a function', function () {
        assert.throws(function () {
            mcpServer.createServer({ manifest: buildManifest(), dispatch: null, serverInfo: { name: 'x' } });
        }, /dispatch must be a function/);
    });

    it('throws if serverInfo.name is missing', function () {
        assert.throws(function () {
            mcpServer.createServer({ manifest: buildManifest(), dispatch: function () {}, serverInfo: {} });
        }, /serverInfo\.name/);
    });
});


// ---------------------------------------------------------------------------
// 02 — handleMessage: malformed frames
// ---------------------------------------------------------------------------

describe('02 - handleMessage: malformed frames', function () {

    it('returns a parse error for non-JSON input', async function () {
        var srv = makeServer();
        var raw = await srv.handleMessage('this is not json');
        var resp = JSON.parse(raw);
        assert.equal(resp.jsonrpc, '2.0');
        assert.equal(resp.id, null);
        assert.equal(resp.error.code, mcpServer.errors.PARSE);
    });

    it('returns invalid-request for a wrong jsonrpc version', async function () {
        var srv = makeServer();
        var raw = await srv.handleMessage(JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'initialize' }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_REQUEST);
    });

    it('returns invalid-request when method is missing', async function () {
        var srv = makeServer();
        var raw = await srv.handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 2 }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_REQUEST);
    });

    it('silently drops notifications with no method', async function () {
        var srv = makeServer();
        var raw = await srv.handleMessage(JSON.stringify({ jsonrpc: '2.0' }));
        assert.equal(raw, null);
    });
});


// ---------------------------------------------------------------------------
// 03 — Lifecycle: initialize and notifications/initialized
// ---------------------------------------------------------------------------

describe('03 - lifecycle', function () {

    it('rejects any request before initialize', async function () {
        var srv = makeServer();
        var raw = await srv.handleMessage(req(1, 'tools/list', {}));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_REQUEST);
        assert.match(resp.error.message, /initialize/);
    });

    it('initialize echoes the server protocol version and serverInfo', async function () {
        var srv = makeServer();
        var raw = await srv.handleMessage(req(1, 'initialize', {
            protocolVersion: '2025-06-18',
            clientInfo: { name: 'test-client', version: '0.1.0' }
        }));
        var resp = JSON.parse(raw);
        assert.equal(resp.id, 1);
        assert.equal(resp.result.protocolVersion, '2025-06-18');
        assert.equal(resp.result.serverInfo.name, 'test');
        assert.deepEqual(resp.result.capabilities.tools, { listChanged: false });
        assert.equal(srv.state.phase, 'initializing');
    });

    it('advances to initialized on notifications/initialized', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        await srv.handleMessage(notif('notifications/initialized', {}));
        assert.equal(srv.state.phase, 'initialized');
    });

    it('rejects a second initialize', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'initialize', {}));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_REQUEST);
    });

    it('includes instructions when provided', async function () {
        var srv = makeServer({ instructions: 'hello from test' });
        var raw = await srv.handleMessage(req(1, 'initialize', {}));
        var resp = JSON.parse(raw);
        assert.equal(resp.result.instructions, 'hello from test');
    });
});


// ---------------------------------------------------------------------------
// 04 — ping
// ---------------------------------------------------------------------------

describe('04 - ping', function () {

    it('returns an empty result', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'ping', {}));
        var resp = JSON.parse(raw);
        assert.equal(resp.id, 2);
        assert.deepEqual(resp.result, {});
    });
});


// ---------------------------------------------------------------------------
// 05 — tools/list
// ---------------------------------------------------------------------------

describe('05 - tools/list', function () {

    it('returns every tool with name, description, inputSchema', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/list', {}));
        var resp = JSON.parse(raw);
        assert.equal(resp.result.tools.length, 1);
        assert.equal(resp.result.tools[0].name, 'get_user');
        assert.ok(resp.result.tools[0].inputSchema);
    });

    it('preserves _meta, title, annotations, outputSchema', async function () {
        var srv = makeServer({
            manifest: buildManifest([{
                name: 't', description: 'x',
                inputSchema: { type: 'object' },
                title: 'T',
                annotations: { readOnlyHint: true },
                outputSchema: { type: 'object' },
                _meta: { 'io.gina.url': '/' }
            }])
        });
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/list', {}));
        var resp = JSON.parse(raw);
        var t = resp.result.tools[0];
        assert.equal(t.title, 'T');
        assert.deepEqual(t.annotations, { readOnlyHint: true });
        assert.deepEqual(t.outputSchema, { type: 'object' });
        assert.deepEqual(t._meta, { 'io.gina.url': '/' });
    });
});


// ---------------------------------------------------------------------------
// 06 — tools/call: argument validation
// ---------------------------------------------------------------------------

describe('06 - tools/call: argument validation', function () {

    it('rejects unknown tool name', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'nope', arguments: {} }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.METHOD_NOT_FOUND);
    });

    it('rejects missing required argument as INVALID_PARAMS', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'get_user', arguments: {} }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_PARAMS);
        assert.match(resp.error.message, /missing required argument: id/);
    });

    it('rejects wrong-typed argument', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'get_user', arguments: { id: 42 } }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_PARAMS);
        assert.match(resp.error.message, /must be a string/);
    });

    it('enforces pattern on string arguments', async function () {
        var srv = makeServer({
            manifest: buildManifest([{
                name: 'get_hex',
                description: 'GET /hex/:h',
                inputSchema: {
                    type: 'object',
                    properties: { h: { type: 'string', pattern: '^[0-9a-f]+$' } },
                    required: ['h']
                },
                _meta: { 'io.gina.method': 'GET', 'io.gina.url': '/hex/:h' }
            }])
        });
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'get_hex', arguments: { h: 'ZZZ' } }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_PARAMS);
        assert.match(resp.error.message, /pattern/);
    });

    it('enforces enum on string arguments', async function () {
        var srv = makeServer({
            manifest: buildManifest([{
                name: 'get_status',
                description: 'GET /status/:s',
                inputSchema: {
                    type: 'object',
                    properties: { s: { type: 'string', enum: ['open', 'closed'] } },
                    required: ['s']
                },
                _meta: { 'io.gina.method': 'GET', 'io.gina.url': '/status/:s' }
            }])
        });
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'get_status', arguments: { s: 'maybe' } }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INVALID_PARAMS);
        assert.match(resp.error.message, /one of/);
    });
});


// ---------------------------------------------------------------------------
// 07 — tools/call: dispatch result mapping
// ---------------------------------------------------------------------------

describe('07 - tools/call: dispatch result mapping', function () {

    it('passes tool + args to dispatch and returns the result unchanged', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'get_user', arguments: { id: '42' } }));
        var resp = JSON.parse(raw);
        assert.equal(srv._dispatchCalls.length, 1);
        assert.equal(srv._dispatchCalls[0].tool, 'get_user');
        assert.deepEqual(srv._dispatchCalls[0].args, { id: '42' });
        assert.ok(Array.isArray(resp.result.content));
        assert.equal(resp.result.structuredContent.ok, true);
    });

    it('converts dispatch throw into isError: true result (not RPC error)', async function () {
        var srv = makeServer({
            dispatch: function () { return Promise.reject(new Error('boom')); }
        });
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'get_user', arguments: { id: '42' } }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error, undefined);
        assert.equal(resp.result.isError, true);
        assert.match(resp.result.content[0].text, /boom/);
    });

    it('coerces plain-value dispatch results into text content', async function () {
        var srv = makeServer({
            dispatch: function () { return Promise.resolve('plain string'); }
        });
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'tools/call', { name: 'get_user', arguments: { id: '42' } }));
        var resp = JSON.parse(raw);
        assert.equal(resp.result.content[0].type, 'text');
        assert.equal(resp.result.content[0].text, 'plain string');
    });

    it('marks cancelled requests as INTERNAL error', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        await srv.handleMessage(notif('notifications/cancelled', { requestId: 99 }));
        var raw = await srv.handleMessage(req(99, 'tools/call', { name: 'get_user', arguments: { id: '42' } }));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.INTERNAL);
        assert.match(resp.error.message, /cancelled/);
    });
});


// ---------------------------------------------------------------------------
// 08 — Unknown methods
// ---------------------------------------------------------------------------

describe('08 - unknown methods', function () {

    it('returns METHOD_NOT_FOUND', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(req(2, 'resources/list', {}));
        var resp = JSON.parse(raw);
        assert.equal(resp.error.code, mcpServer.errors.METHOD_NOT_FOUND);
    });

    it('silently drops unknown notifications', async function () {
        var srv = makeServer();
        await srv.handleMessage(req(1, 'initialize', {}));
        var raw = await srv.handleMessage(notif('notifications/random/thing', {}));
        assert.equal(raw, null);
    });
});


// ---------------------------------------------------------------------------
// 09 — attachStdio
// ---------------------------------------------------------------------------

describe('09 - attachStdio', function () {

    function setup() {
        var input  = new stream.PassThrough();
        var output = new stream.PassThrough();
        var srv    = makeServer();

        var outBuf = '';
        output.on('data', function (chunk) { outBuf += chunk.toString('utf8'); });

        srv.attachStdio({ input: input, output: output });
        return { srv: srv, input: input, getOutput: function () { return outBuf; } };
    }

    it('reads newline-delimited frames and writes newline-delimited responses', async function () {
        var t = setup();
        t.input.write(req(1, 'initialize', {}) + '\n');
        t.input.write(req(2, 'ping', {}) + '\n');

        // Wait a tick for handleMessage Promises to settle.
        await new Promise(function (r) { setImmediate(r); });
        await new Promise(function (r) { setImmediate(r); });

        var lines = t.getOutput().split('\n').filter(Boolean);
        assert.equal(lines.length, 2);
        var resp1 = JSON.parse(lines[0]);
        var resp2 = JSON.parse(lines[1]);
        assert.equal(resp1.id, 1);
        assert.equal(resp2.id, 2);
        assert.deepEqual(resp2.result, {});
    });

    it('rejects a second attach', function () {
        var t = setup();
        assert.throws(function () {
            t.srv.attachStdio({ input: new stream.PassThrough(), output: new stream.PassThrough() });
        }, /already attached/);
    });

    it('calls onClose when input ends', async function () {
        var input  = new stream.PassThrough();
        var output = new stream.PassThrough();
        var srv    = makeServer();
        var closed = false;
        srv.attachStdio({ input: input, output: output, onClose: function () { closed = true; } });
        input.end();
        await new Promise(function (r) { setImmediate(r); });
        assert.equal(closed, true);
    });

    it('does not produce a response for notifications', async function () {
        var input  = new stream.PassThrough();
        var output = new stream.PassThrough();
        var outBuf = '';
        output.on('data', function (c) { outBuf += c.toString('utf8'); });
        var srv = makeServer();
        srv.attachStdio({ input: input, output: output });
        await srv.handleMessage(req(1, 'initialize', {}));
        input.write(notif('notifications/initialized', {}) + '\n');
        await new Promise(function (r) { setImmediate(r); });
        // initialize response is NOT written through attachStdio (we awaited
        // handleMessage directly), so output should be empty.
        assert.equal(outBuf, '');
    });
});
