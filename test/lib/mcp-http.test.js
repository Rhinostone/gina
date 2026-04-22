/**
 * lib/mcp-http — Streamable HTTP transport.
 *
 * Pattern mirrors test/lib/mcp-dispatch.test.js: spin up the transport on an
 * ephemeral port with a stub mcpServer, POST real HTTP requests through
 * node:http, assert on the response. No mocking of node:http — the transport
 * owns its own http.Server, and we exercise it end-to-end.
 *
 * Session 1 scope: transport only. No auth, no Origin enforcement (ships in
 * Session 2), so tests here never cover those headers.
 */

'use strict';

var path   = require('path');
var http   = require('http');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var httpLib = require(path.join(require('../fw'), 'lib/mcp-http/src/main'));


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a stub mcpServer whose `handleMessage(raw)` returns a response
 * built by `responder(parsedFrame)`. Notifications (no `id`) return null.
 * If `responder` returns null or undefined, the frame is treated as a
 * notification.
 */
function makeStubServer(responder) {
    return {
        handleMessage: function(raw) {
            return new Promise(function(resolve) {
                var frame;
                try { frame = JSON.parse(raw); }
                catch (e) {
                    return resolve(JSON.stringify({
                        jsonrpc: '2.0', id: null,
                        error: { code: -32700, message: 'Parse error: ' + e.message }
                    }));
                }
                var isNotification = (typeof(frame.id) === 'undefined');
                var out = responder ? responder(frame) : null;
                if (isNotification) return resolve(null);
                if (out == null) {
                    return resolve(JSON.stringify({
                        jsonrpc: '2.0', id: frame.id, result: { ok: true }
                    }));
                }
                if (typeof(out) === 'string') return resolve(out);
                return resolve(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: out }));
            });
        }
    };
}


/**
 * Spins up a transport on an ephemeral port. Runs `body(info, transport)`,
 * then tears the transport down. Returns whatever `body` resolves to.
 */
function withTransport(stubServer, transportOpts, body) {
    var merged = Object.assign({ mcpServer: stubServer, host: '127.0.0.1', port: 0 }, transportOpts || {});
    var transport = httpLib.createHttpTransport(merged);
    return transport.start().then(function(info) {
        return Promise.resolve()
            .then(function() { return body(info, transport); })
            .then(function(result) { return transport.stop().then(function() { return result; }); },
                  function(err)    { return transport.stop().then(function() { throw err; },
                                                                  function()  { throw err; }); });
    });
}


/**
 * One-shot HTTP POST. Returns `{ status, headers, body }` once the response
 * stream ends. `body` is a utf-8 string; callers parse as needed.
 */
function postRequest(port, payload, headers, httpMethod) {
    return new Promise(function(resolve, reject) {
        var req = http.request({
            hostname: '127.0.0.1',
            port:     port,
            path:     '/',
            method:   httpMethod || 'POST',
            headers:  Object.assign({
                'content-type': 'application/json; charset=utf-8'
            }, headers || {})
        }, function(res) {
            var chunks = [];
            res.on('data', function(c) { chunks.push(c); });
            res.on('end', function() {
                resolve({
                    status:  res.statusCode,
                    headers: res.headers,
                    body:    Buffer.concat(chunks).toString('utf8')
                });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        if (payload != null) {
            req.write(typeof(payload) === 'string' ? payload : JSON.stringify(payload));
        }
        req.end();
    });
}


// ---------------------------------------------------------------------------
// 01 — Input validation
// ---------------------------------------------------------------------------

describe('01 - createHttpTransport: input validation', function() {

    it('throws when opts is missing', function() {
        assert.throws(function() { httpLib.createHttpTransport(); }, /opts is required/);
    });

    it('throws when mcpServer is missing', function() {
        assert.throws(function() { httpLib.createHttpTransport({}); }, /mcpServer\.handleMessage/);
    });

    it('throws when mcpServer.handleMessage is not a function', function() {
        assert.throws(function() {
            httpLib.createHttpTransport({ mcpServer: { handleMessage: 'nope' } });
        }, /mcpServer\.handleMessage/);
    });

    it('accepts a minimal valid shape', function() {
        var t = httpLib.createHttpTransport({ mcpServer: makeStubServer() });
        assert.equal(typeof(t.start), 'function');
        assert.equal(typeof(t.stop),  'function');
        assert.equal(typeof(t.address), 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — start / stop / address lifecycle
// ---------------------------------------------------------------------------

describe('02 - lifecycle', function() {

    it('address() returns null before start()', function() {
        var t = httpLib.createHttpTransport({ mcpServer: makeStubServer() });
        assert.equal(t.address(), null);
    });

    it('start() resolves with host/port/family', async function() {
        await withTransport(makeStubServer(), {}, async function(info, t) {
            assert.equal(info.host, '127.0.0.1');
            assert.equal(typeof(info.port), 'number');
            assert.ok(info.port > 0);
            assert.ok(info.family === 'IPv4' || info.family === 4);
            assert.deepEqual(t.address(), info);
        });
    });

    it('start() rejects when called twice', async function() {
        var t = httpLib.createHttpTransport({ mcpServer: makeStubServer() });
        await t.start();
        await assert.rejects(function() { return t.start(); }, /already started/);
        await t.stop();
    });

    it('stop() before start() is a no-op', async function() {
        var t = httpLib.createHttpTransport({ mcpServer: makeStubServer() });
        await t.stop();
        await t.stop();
    });

    it('address() returns null after stop()', async function() {
        var t = httpLib.createHttpTransport({ mcpServer: makeStubServer() });
        await t.start();
        await t.stop();
        assert.equal(t.address(), null);
    });
});


// ---------------------------------------------------------------------------
// 03 — POST with JSON (single request)
// ---------------------------------------------------------------------------

describe('03 - POST application/json (single)', function() {

    it('routes one request through handleMessage and returns JSON', async function() {
        var stub = makeStubServer(function(frame) {
            return { echoed: frame.method };
        });
        await withTransport(stub, {}, async function(info) {
            var r = await postRequest(info.port, {
                jsonrpc: '2.0', id: 1, method: 'tools/list'
            });
            assert.equal(r.status, 200);
            assert.match(r.headers['content-type'], /application\/json/);
            var parsed = JSON.parse(r.body);
            assert.equal(parsed.jsonrpc, '2.0');
            assert.equal(parsed.id, 1);
            assert.deepEqual(parsed.result, { echoed: 'tools/list' });
        });
    });

    it('sets content-length matching the body byte length', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 7, method: 'ping' });
            assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.body, 'utf8'));
        });
    });
});


// ---------------------------------------------------------------------------
// 04 — POST batch (array of frames)
// ---------------------------------------------------------------------------

describe('04 - POST batch', function() {

    it('dispatches each frame and returns an array response', async function() {
        var stub = makeStubServer(function(frame) {
            return { id: frame.id, method: frame.method };
        });
        await withTransport(stub, {}, async function(info) {
            var r = await postRequest(info.port, [
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { jsonrpc: '2.0', id: 2, method: 'tools/list' }
            ]);
            assert.equal(r.status, 200);
            var parsed = JSON.parse(r.body);
            assert.ok(Array.isArray(parsed));
            assert.equal(parsed.length, 2);
            assert.deepEqual(parsed[0].result, { id: 1, method: 'ping' });
            assert.deepEqual(parsed[1].result, { id: 2, method: 'tools/list' });
        });
    });

    it('drops notification frames from the batch response', async function() {
        var stub = makeStubServer(function(frame) { return { ok: true }; });
        await withTransport(stub, {}, async function(info) {
            var r = await postRequest(info.port, [
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { jsonrpc: '2.0',        method: 'notifications/progress' }, // no id → notification
                { jsonrpc: '2.0', id: 3, method: 'tools/list' }
            ]);
            assert.equal(r.status, 200);
            var parsed = JSON.parse(r.body);
            assert.equal(parsed.length, 2);
            assert.equal(parsed[0].id, 1);
            assert.equal(parsed[1].id, 3);
        });
    });
});


// ---------------------------------------------------------------------------
// 05 — POST with Accept: text/event-stream
// ---------------------------------------------------------------------------

describe('05 - POST text/event-stream (SSE)', function() {

    it('returns a single SSE `event: message` for one request', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'accept': 'application/json, text/event-stream' }
            );
            assert.equal(r.status, 200);
            assert.match(r.headers['content-type'], /text\/event-stream/);
            assert.match(r.body, /^event: message\r?\ndata: /);
            var dataLines = r.body.split(/\r?\n/).filter(function(l) { return l.indexOf('data: ') === 0; });
            assert.equal(dataLines.length, 1);
            var frame = JSON.parse(dataLines[0].slice('data: '.length));
            assert.equal(frame.id, 1);
        });
    });

    it('returns N SSE events for a batch, one per non-notification frame', async function() {
        var stub = makeStubServer(function(frame) { return { id: frame.id }; });
        await withTransport(stub, {}, async function(info) {
            var r = await postRequest(info.port, [
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { jsonrpc: '2.0', id: 2, method: 'ping' },
                { jsonrpc: '2.0', id: 3, method: 'ping' }
            ], { 'accept': 'text/event-stream' });
            assert.equal(r.status, 200);
            var events = r.body.split(/\r?\n\r?\n/).filter(function(blk) { return blk.trim().length; });
            assert.equal(events.length, 3);
            events.forEach(function(blk, i) {
                assert.match(blk, /event: message/);
                var dataLine = blk.split(/\r?\n/).find(function(l) { return l.indexOf('data: ') === 0; });
                assert.ok(dataLine, 'each event has a data: line');
                var frame = JSON.parse(dataLine.slice('data: '.length));
                assert.equal(frame.id, i + 1);
            });
        });
    });

    it('picks SSE when Accept lists both JSON and event-stream', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 9, method: 'ping' },
                { 'accept': 'application/json, text/event-stream' }
            );
            assert.match(r.headers['content-type'], /text\/event-stream/);
        });
    });
});


// ---------------------------------------------------------------------------
// 06 — Notifications-only POST
// ---------------------------------------------------------------------------

describe('06 - notifications-only POST', function() {

    it('returns 202 with an empty body for a single notification', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, {
                jsonrpc: '2.0', method: 'notifications/initialized'
            });
            assert.equal(r.status, 202);
            assert.equal(r.body, '');
        });
    });

    it('returns 202 when every frame in a batch is a notification', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, [
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }
            ]);
            assert.equal(r.status, 202);
            assert.equal(r.body, '');
        });
    });

    it('stays at 200 when at least one frame expects a response', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, [
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { jsonrpc: '2.0', id: 5, method: 'ping' }
            ]);
            assert.equal(r.status, 200);
            var parsed = JSON.parse(r.body);
            assert.ok(Array.isArray(parsed));
            assert.equal(parsed.length, 1);
            assert.equal(parsed[0].id, 5);
        });
    });
});


// ---------------------------------------------------------------------------
// 07 — Oversized body
// ---------------------------------------------------------------------------

describe('07 - oversized POST body', function() {

    it('returns 413 with a JSON-RPC error when body exceeds maxBodyBytes', async function() {
        await withTransport(makeStubServer(), { maxBodyBytes: 128 }, async function(info) {
            var big = { jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'a'.repeat(1024) } };
            var r = await postRequest(info.port, big);
            assert.equal(r.status, 413);
            var parsed = JSON.parse(r.body);
            assert.equal(parsed.jsonrpc, '2.0');
            assert.equal(parsed.error.code, -32600);
            assert.match(parsed.error.message, /exceeds limit/);
        });
    });

    it('exposes DEFAULT_MAX_BODY_BYTES as 1 MiB', function() {
        assert.equal(httpLib.DEFAULT_MAX_BODY_BYTES, 1024 * 1024);
    });
});


// ---------------------------------------------------------------------------
// 08 — Malformed JSON
// ---------------------------------------------------------------------------

describe('08 - malformed POST body', function() {

    it('returns a JSON-RPC -32700 parse error at HTTP 200', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, '{not valid json');
            assert.equal(r.status, 200);
            var parsed = JSON.parse(r.body);
            assert.equal(parsed.jsonrpc, '2.0');
            assert.equal(parsed.id, null);
            assert.equal(parsed.error.code, -32700);
            assert.match(parsed.error.message, /Parse error/);
        });
    });

    it('returns the parse error as an SSE event when the client asked for SSE', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, '{bad', { 'accept': 'text/event-stream' });
            assert.equal(r.status, 200);
            assert.match(r.headers['content-type'], /text\/event-stream/);
            var dataLine = r.body.split(/\r?\n/).find(function(l) { return l.indexOf('data: ') === 0; });
            var parsed = JSON.parse(dataLine.slice('data: '.length));
            assert.equal(parsed.error.code, -32700);
        });
    });
});


// ---------------------------------------------------------------------------
// 09 — GET / DELETE / unsupported methods
// ---------------------------------------------------------------------------

describe('09 - method restrictions', function() {

    it('returns 405 on GET with Allow: POST', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null, null, 'GET');
            assert.equal(r.status, 405);
            assert.equal(r.headers['allow'], 'POST');
            var parsed = JSON.parse(r.body);
            assert.equal(parsed.error.code, -32600);
            assert.match(parsed.error.message, /Method not allowed: GET/);
        });
    });

    it('returns 405 on DELETE with Allow: POST', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null, null, 'DELETE');
            assert.equal(r.status, 405);
            assert.equal(r.headers['allow'], 'POST');
        });
    });

    it('returns 405 on PUT', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null, null, 'PUT');
            assert.equal(r.status, 405);
            assert.equal(r.headers['allow'], 'POST');
        });
    });
});


// ---------------------------------------------------------------------------
// 10 — OPTIONS preflight
// ---------------------------------------------------------------------------

describe('10 - OPTIONS preflight', function() {

    it('returns 204 with minimal CORS preflight headers', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null, null, 'OPTIONS');
            assert.equal(r.status, 204);
            assert.match(r.headers['access-control-allow-methods'], /POST/);
            assert.match(r.headers['access-control-allow-headers'], /content-type/);
            assert.match(r.headers['access-control-allow-headers'], /mcp-session-id/);
            assert.equal(r.body, '');
        });
    });
});


// ---------------------------------------------------------------------------
// 11 — Mcp-Session-Id lifecycle
// ---------------------------------------------------------------------------

describe('11 - Mcp-Session-Id', function() {

    it('generates a session id on the initialize response', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, {
                jsonrpc: '2.0', id: 1, method: 'initialize', params: {}
            });
            assert.equal(r.status, 200);
            assert.ok(r.headers['mcp-session-id'],
                'expected mcp-session-id header to be present');
            // UUID v4-ish: 32 hex chars + 4 hyphens
            assert.match(r.headers['mcp-session-id'], /^[0-9a-f-]{36}$/i);
        });
    });

    it('echoes the client-provided session id on subsequent requests', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 2, method: 'ping' },
                { 'mcp-session-id': 'abc-123-xyz' }
            );
            assert.equal(r.headers['mcp-session-id'], 'abc-123-xyz');
        });
    });

    it('does not add a session-id header on a non-initialize request without one', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 3, method: 'ping' });
            assert.equal(r.headers['mcp-session-id'], undefined);
        });
    });

    it('prefers the client-provided id over generating one even on initialize', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 4, method: 'initialize' },
                { 'mcp-session-id': 'client-chosen-id' }
            );
            assert.equal(r.headers['mcp-session-id'], 'client-chosen-id');
        });
    });

    it('includes the session id header on 202 notifications responses too', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { 'mcp-session-id': 'sid-42' }
            );
            assert.equal(r.status, 202);
            assert.equal(r.headers['mcp-session-id'], 'sid-42');
        });
    });
});


// ---------------------------------------------------------------------------
// 12 — Graceful stop
// ---------------------------------------------------------------------------

describe('12 - graceful stop', function() {

    it('resolves stop() after an in-flight request completes', async function() {
        var resolveHandleMessage;
        var pending = new Promise(function(resolve) { resolveHandleMessage = resolve; });
        var stub = {
            handleMessage: function(raw) {
                // Don't resolve until the test releases us.
                return pending.then(function() {
                    return JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { ok: true } });
                });
            }
        };
        var transport = httpLib.createHttpTransport({ mcpServer: stub, host: '127.0.0.1', port: 0 });
        var info = await transport.start();

        // Kick off a request. Don't await yet — handleMessage is blocked.
        var inflight = postRequest(info.port, { jsonrpc: '2.0', id: 1, method: 'ping' });

        // Give the request time to land on the server.
        await new Promise(function(r) { setTimeout(r, 50); });

        var stopP = transport.stop();

        // At this point, stop() must not yet have resolved: the request is
        // still in flight.
        var stopResolved = false;
        stopP.then(function() { stopResolved = true; });
        await new Promise(function(r) { setTimeout(r, 50); });
        assert.equal(stopResolved, false, 'stop() resolved before in-flight request');

        // Release the stub → handleMessage resolves → response flushes → stop() resolves.
        resolveHandleMessage();
        var res = await inflight;
        await stopP;

        assert.equal(res.status, 200);
        assert.equal(JSON.parse(res.body).id, 1);
    });
});


// ---------------------------------------------------------------------------
// 13 — Module exports
// ---------------------------------------------------------------------------

describe('13 - exports', function() {

    it('exposes createHttpTransport + DEFAULT_MAX_BODY_BYTES', function() {
        assert.equal(typeof(httpLib.createHttpTransport), 'function');
        assert.equal(typeof(httpLib.DEFAULT_MAX_BODY_BYTES), 'number');
    });
});


// ---------------------------------------------------------------------------
// 14 — Origin allowlist (Session 2)
// ---------------------------------------------------------------------------

describe('14 - Origin allowlist', function() {

    it('accepts requests without an Origin header (non-browser clients)', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 1, method: 'ping' });
            assert.equal(r.status, 200);
        });
    });

    it('accepts Origin http://localhost (any port) by default', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://localhost:3000' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('accepts Origin http://127.0.0.1 by default', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://127.0.0.1:8080' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('accepts Origin http://[::1] by default', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://[::1]:8080' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('rejects a non-loopback Origin with 403 and JSON-RPC error body', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://evil.example.com' }
            );
            assert.equal(r.status, 403);
            var parsed = JSON.parse(r.body);
            assert.equal(parsed.error.code, -32600);
            assert.match(parsed.error.message, /Origin not allowed/);
            assert.match(parsed.error.message, /evil\.example\.com/);
        });
    });

    it('does not echo CORS headers on a rejected Origin', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://evil.example.com' }
            );
            assert.equal(r.headers['access-control-allow-origin'], undefined);
        });
    });

    it('accepts an extra origin passed in allowedOrigins', async function() {
        await withTransport(makeStubServer(), { allowedOrigins: ['http://app.example.com'] }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://app.example.com' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('still accepts loopback when extra allowedOrigins are configured', async function() {
        await withTransport(makeStubServer(), { allowedOrigins: ['http://app.example.com'] }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://localhost:5000' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('disables the Origin check when allowedOrigins contains "*"', async function() {
        await withTransport(makeStubServer(), { allowedOrigins: ['*'] }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://anywhere.example.com' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('rejects a non-http(s) scheme even if the hostname is loopback', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'file://localhost' }
            );
            assert.equal(r.status, 403);
        });
    });

    it('rejects a malformed Origin string', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'not a url' }
            );
            assert.equal(r.status, 403);
        });
    });
});


// ---------------------------------------------------------------------------
// 15 — Bearer token authentication (Session 2)
// ---------------------------------------------------------------------------

describe('15 - Bearer authentication', function() {

    it('passes through when no authToken is configured', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 1, method: 'ping' });
            assert.equal(r.status, 200);
        });
    });

    it('accepts a request with a matching Bearer token', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'authorization': 'Bearer s3cr3t' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('rejects with 401 + WWW-Authenticate when the header is missing', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 1, method: 'ping' });
            assert.equal(r.status, 401);
            assert.match(r.headers['www-authenticate'], /^Bearer\s+realm="MCP"$/);
            var parsed = JSON.parse(r.body);
            assert.equal(parsed.error.code, -32600);
            assert.match(parsed.error.message, /Bearer/);
        });
    });

    it('rejects a non-Bearer Authorization scheme', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'authorization': 'Basic dXNlcjpwYXNz' }
            );
            assert.equal(r.status, 401);
        });
    });

    it('rejects a wrong Bearer token', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'authorization': 'Bearer wrong' }
            );
            assert.equal(r.status, 401);
        });
    });

    it('rejects a Bearer with a length-mismatched token (constant-time guard)', async function() {
        // Length mismatch must NOT throw from timingSafeEqual — the helper
        // short-circuits length differences before the constant-time compare.
        await withTransport(makeStubServer(), { authToken: 'abcdef' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'authorization': 'Bearer abcdefghij' }
            );
            assert.equal(r.status, 401);
        });
    });

    it('accepts case-insensitive "bearer" scheme prefix', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'authorization': 'bearer s3cr3t' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('trims trailing whitespace on the presented token', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'authorization': 'Bearer s3cr3t   ' }
            );
            assert.equal(r.status, 200);
        });
    });

    it('echoes CORS headers on 401 so browser clients see the error body', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://localhost:3000' }
            );
            assert.equal(r.status, 401);
            assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:3000');
            assert.match(r.headers['vary'], /Origin/);
        });
    });

    it('enforces Origin gate BEFORE bearer — disallowed origin → 403 even with token', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://evil.example.com', 'authorization': 'Bearer s3cr3t' }
            );
            assert.equal(r.status, 403);
        });
    });
});


// ---------------------------------------------------------------------------
// 16 — CORS response headers on successful POST
// ---------------------------------------------------------------------------

describe('16 - CORS response headers', function() {

    it('echoes allowed Origin + vary: Origin on JSON response', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://localhost:4000' }
            );
            assert.equal(r.status, 200);
            assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:4000');
            assert.match(r.headers['vary'], /Origin/);
        });
    });

    it('echoes * when allowedOrigins is ["*"] (wildcard)', async function() {
        await withTransport(makeStubServer(), { allowedOrigins: ['*'] }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://anywhere.example.com' }
            );
            assert.equal(r.headers['access-control-allow-origin'], '*');
            // No vary: Origin when wildcard — cached responses are safe across origins.
            assert.equal(r.headers['vary'], undefined);
        });
    });

    it('does not add CORS headers when the request has no Origin', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 1, method: 'ping' });
            assert.equal(r.headers['access-control-allow-origin'], undefined);
            assert.equal(r.headers['vary'], undefined);
        });
    });

    it('echoes Origin on SSE responses too', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://localhost:3000', 'accept': 'text/event-stream' }
            );
            assert.match(r.headers['content-type'], /text\/event-stream/);
            assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:3000');
        });
    });

    it('echoes Origin on 202 notifications responses', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { 'origin': 'http://localhost:3000' }
            );
            assert.equal(r.status, 202);
            assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:3000');
        });
    });

    it('echoes Origin on 405 method-not-allowed', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null,
                { 'origin': 'http://localhost:3000' }, 'GET');
            assert.equal(r.status, 405);
            assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:3000');
        });
    });

    it('echoes Origin on 413 body-overflow', async function() {
        await withTransport(makeStubServer(), { maxBodyBytes: 64 }, async function(info) {
            var big = { jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'a'.repeat(1024) } };
            var r = await postRequest(info.port, big, { 'origin': 'http://localhost:3000' });
            assert.equal(r.status, 413);
            assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:3000');
        });
    });
});


// ---------------------------------------------------------------------------
// 17 — OPTIONS preflight (Session 2 enhancements)
// ---------------------------------------------------------------------------

describe('17 - OPTIONS preflight (security)', function() {

    it('lists authorization in access-control-allow-headers', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null, null, 'OPTIONS');
            assert.match(r.headers['access-control-allow-headers'], /authorization/);
        });
    });

    it('echoes allowed Origin + vary on preflight', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null,
                { 'origin': 'http://localhost:3000' }, 'OPTIONS');
            assert.equal(r.status, 204);
            assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:3000');
            assert.match(r.headers['vary'], /Origin/);
        });
    });

    it('returns 204 on preflight from a disallowed Origin but WITHOUT ACAO header', async function() {
        await withTransport(makeStubServer(), {}, async function(info) {
            var r = await postRequest(info.port, null,
                { 'origin': 'http://evil.example.com' }, 'OPTIONS');
            // Browsers still see 204 but the missing ACAO header means they
            // reject the actual request — the correct CORS semantics.
            assert.equal(r.status, 204);
            assert.equal(r.headers['access-control-allow-origin'], undefined);
        });
    });

    it('OPTIONS bypasses the bearer check (preflight cannot carry auth)', async function() {
        await withTransport(makeStubServer(), { authToken: 's3cr3t' }, async function(info) {
            var r = await postRequest(info.port, null,
                { 'origin': 'http://localhost:3000' }, 'OPTIONS');
            assert.equal(r.status, 204);
            // No Authorization sent → still 204, not 401.
        });
    });

    it('echoes * on preflight when wildcard is configured', async function() {
        await withTransport(makeStubServer(), { allowedOrigins: ['*'] }, async function(info) {
            var r = await postRequest(info.port, null,
                { 'origin': 'http://anywhere.example.com' }, 'OPTIONS');
            assert.equal(r.headers['access-control-allow-origin'], '*');
        });
    });
});


// ---------------------------------------------------------------------------
// 18 — Input validation: new security options
// ---------------------------------------------------------------------------

describe('18 - input validation (security opts)', function() {

    it('treats empty string authToken as "no auth configured"', async function() {
        await withTransport(makeStubServer(), { authToken: '' }, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 1, method: 'ping' });
            assert.equal(r.status, 200);
        });
    });

    it('treats non-string authToken as "no auth configured"', async function() {
        await withTransport(makeStubServer(), { authToken: 123 }, async function(info) {
            var r = await postRequest(info.port, { jsonrpc: '2.0', id: 1, method: 'ping' });
            assert.equal(r.status, 200);
        });
    });

    it('treats non-array allowedOrigins as empty (loopback-only default)', async function() {
        await withTransport(makeStubServer(), { allowedOrigins: 'http://x' }, async function(info) {
            var r = await postRequest(info.port,
                { jsonrpc: '2.0', id: 1, method: 'ping' },
                { 'origin': 'http://x' }
            );
            assert.equal(r.status, 403);
        });
    });
});
