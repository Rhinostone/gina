/**
 * @module gina/lib/mcp-http
 *
 * Model Context Protocol Streamable HTTP transport. Spec revision 2025-06-18.
 *
 * Responsibilities:
 *  - Bind an HTTP server to a host/port and accept JSON-RPC 2.0 over POST.
 *  - Negotiate `application/json` vs `text/event-stream` via `Accept`.
 *  - Support batch requests (JSON-RPC 2.0 array).
 *  - Emit `Mcp-Session-Id` on `initialize` responses; echo when provided.
 *  - Enforce a body-size cap (413 on overflow).
 *  - Return 405 for GET / DELETE (no server-initiated streams in v1).
 *
 * Out of scope (Session 2):
 *  - Origin allowlist check
 *  - `Authorization: Bearer` enforcement
 *  - Full CORS response headers on POST
 *
 * The transport consumes an `mcpServer` instance that exposes
 * `handleMessage(raw) → Promise<string|null>`. All JSON-RPC framing and
 * lifecycle logic lives there; this module owns only the wire.
 */

'use strict';

var http   = require('http');
var crypto = require('crypto');

var DEFAULT_MAX_BODY_BYTES = 1024 * 1024;


/**
 * Creates an HTTP transport bound to an mcp-server instance. Returns a
 * controller with `start()`, `stop()`, and `address()`.
 *
 * @param   {object}    opts
 * @param   {object}    opts.mcpServer          - Instance from mcpServer.createServer
 * @param   {string}    [opts.host='127.0.0.1'] - Bind host
 * @param   {number}    [opts.port=0]           - Bind port (0 = OS-assigned)
 * @param   {number}    [opts.maxBodyBytes]     - Cap on POST body size
 * @param   {function}  [opts.onError]          - (err) => void, for transport logs
 * @returns {{start: function, stop: function, address: function}}
 *
 * @example
 *   var transport = createHttpTransport({ mcpServer: server, port: 3107 });
 *   transport.start().then(function (info) {
 *       console.log('listening on', info.host + ':' + info.port);
 *   });
 */
function createHttpTransport(opts) {

    if (!opts || typeof(opts) !== 'object') {
        throw new Error('createHttpTransport: opts is required');
    }
    if (!opts.mcpServer || typeof(opts.mcpServer.handleMessage) !== 'function') {
        throw new Error('createHttpTransport: opts.mcpServer.handleMessage must be a function');
    }

    var mcpServer     = opts.mcpServer;
    var host          = opts.host || '127.0.0.1';
    var port          = (typeof(opts.port) === 'number') ? opts.port : 0;
    var maxBodyBytes  = (typeof(opts.maxBodyBytes) === 'number' && opts.maxBodyBytes > 0)
                        ? opts.maxBodyBytes
                        : DEFAULT_MAX_BODY_BYTES;
    var onError       = (typeof(opts.onError) === 'function') ? opts.onError : function() {};

    var httpServer = null;


    /**
     * Node `request` event handler. Routes by method, delegates body handling
     * to processBody.
     *
     * @private
     */
    function handleHttpRequest(req, res) {

        var method = req.method;

        if (method === 'OPTIONS') {
            // Minimal CORS preflight — full Origin/header echo lands in Session 2.
            res.writeHead(204, {
                'access-control-allow-methods': 'POST, OPTIONS',
                'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version',
                'access-control-max-age': '600'
            });
            return res.end();
        }

        if (method === 'GET' || method === 'DELETE') {
            var msg = 'Method not allowed: ' + method + '. MCP Streamable HTTP exposes only POST in this server.';
            res.writeHead(405, {
                'content-type': 'application/json; charset=utf-8',
                'allow':        'POST'
            });
            return res.end(JSON.stringify({
                jsonrpc: '2.0',
                id:      null,
                error:   { code: -32600, message: msg }
            }));
        }

        if (method !== 'POST') {
            res.writeHead(405, { 'allow': 'POST' });
            return res.end();
        }

        readBodyAndProcess(req, res);
    }


    /**
     * Accumulates the POST body up to `maxBodyBytes`, then hands off to
     * processBody. Sends 413 and closes the connection on overflow.
     *
     * @private
     */
    function readBodyAndProcess(req, res) {

        var received = 0;
        var chunks   = [];
        var aborted  = false;

        req.on('data', function(chunk) {
            if (aborted) return;
            received += chunk.length;
            if (received > maxBodyBytes) {
                aborted = true;
                res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id:      null,
                    error:   {
                        code:    -32600,
                        message: 'Request body exceeds limit of ' + maxBodyBytes + ' bytes'
                    }
                }));
                // Signal the client to stop sending. Already responded.
                try { req.destroy(); } catch (e) { /* ignore */ }
            } else {
                chunks.push(chunk);
            }
        });

        req.on('end', function() {
            if (aborted) return;
            var body = Buffer.concat(chunks).toString('utf8');
            processBody(req, res, body);
        });

        req.on('error', function(err) {
            if (aborted) return;
            aborted = true;
            onError(err);
            try { res.destroy(); } catch (e) { /* ignore */ }
        });
    }


    /**
     * Parses the body, dispatches each JSON-RPC frame through
     * `mcpServer.handleMessage`, and writes the HTTP response in the shape
     * negotiated by the `Accept` header.
     *
     * @private
     */
    function processBody(req, res, body) {

        var acceptHeader    = req.headers['accept'] || '';
        var wantsSse        = /text\/event-stream/i.test(acceptHeader);
        var clientSessionId = req.headers['mcp-session-id'] || null;

        var parsed;
        try {
            parsed = JSON.parse(body);
        } catch (parseErr) {
            // Malformed JSON — surface as a JSON-RPC parse error frame.
            // HTTP stays 200; the error lives in the JSON-RPC envelope.
            var errFrame = JSON.stringify({
                jsonrpc: '2.0',
                id:      null,
                error:   { code: -32700, message: 'Parse error: ' + parseErr.message }
            });
            if (wantsSse) {
                return writeSseFrames(res, [errFrame], clientSessionId);
            }
            return writeJsonFrame(res, errFrame, clientSessionId);
        }

        var isBatch = Array.isArray(parsed);
        var frames  = isBatch ? parsed : [parsed];

        // initialize in any frame triggers session-id generation when the
        // client didn't supply one. Per MCP spec, the server assigns the
        // session id on the initialize response.
        var hasInitialize = false;
        for (var i = 0; i < frames.length; i++) {
            if (frames[i] && frames[i].method === 'initialize') {
                hasInitialize = true;
                break;
            }
        }
        var responseSessionId = clientSessionId
            || (hasInitialize ? crypto.randomUUID() : null);

        var dispatches = frames.map(function(frame) {
            // handleMessage expects a raw frame string. Re-serialise each entry
            // so the server sees a consistent shape, regardless of whether we
            // came from a single-frame POST or a batch.
            return mcpServer.handleMessage(JSON.stringify(frame));
        });

        Promise.all(dispatches).then(function(responses) {

            var nonNull = [];
            for (var j = 0; j < responses.length; j++) {
                if (responses[j] != null) nonNull.push(responses[j]);
            }

            if (nonNull.length === 0) {
                // All frames were notifications — spec says 202 Accepted, no body.
                var headers = {};
                if (responseSessionId) headers['mcp-session-id'] = responseSessionId;
                res.writeHead(202, headers);
                return res.end();
            }

            if (wantsSse) {
                return writeSseFrames(res, nonNull, responseSessionId);
            }

            if (isBatch) {
                // JSON-RPC batch response is an array of response frames.
                // Each frame is already a JSON string from handleMessage.
                var arrayBody = '[' + nonNull.join(',') + ']';
                return writeJsonFrame(res, arrayBody, responseSessionId);
            }

            return writeJsonFrame(res, nonNull[0], responseSessionId);

        }, function(err) {
            // handleMessage always resolves — this is defensive.
            onError(err);
            try {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id:      null,
                    error:   { code: -32603, message: 'Internal error' }
                }));
            } catch (writeErr) { /* response already sent */ }
        });
    }


    /**
     * Writes a single JSON response frame (object or array-as-string) with
     * content-length and optional session-id header.
     *
     * @private
     */
    function writeJsonFrame(res, frameBody, sessionId) {
        var headers = {
            'content-type':   'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(frameBody, 'utf8')
        };
        if (sessionId) headers['mcp-session-id'] = sessionId;
        res.writeHead(200, headers);
        res.end(frameBody);
    }


    /**
     * Writes N frames as SSE `event: message` events, then closes the stream.
     * No resumability in v1 — the stream ends as soon as every response frame
     * for the triggering POST has been flushed.
     *
     * @private
     */
    function writeSseFrames(res, frames, sessionId) {
        var headers = {
            'content-type':  'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            'connection':    'keep-alive'
        };
        if (sessionId) headers['mcp-session-id'] = sessionId;
        res.writeHead(200, headers);
        for (var i = 0; i < frames.length; i++) {
            res.write('event: message\ndata: ' + frames[i] + '\n\n');
        }
        res.end();
    }


    /**
     * Starts the HTTP listener. Rejects if called twice. Resolves with the
     * resolved { host, port, family } — `port` is the OS-assigned port when
     * `opts.port` was 0.
     *
     * @returns {Promise<{host: string, port: number, family: string}>}
     */
    function start() {
        return new Promise(function(resolve, reject) {
            if (httpServer) {
                return reject(new Error('start: transport already started'));
            }
            var server = http.createServer(handleHttpRequest);
            var onListenError = function(err) { reject(err); };
            server.once('error', onListenError);
            server.listen(port, host, function() {
                server.removeListener('error', onListenError);
                server.on('error', function(err) { onError(err); });
                httpServer = server;
                var addr = server.address();
                resolve({ host: addr.address, port: addr.port, family: addr.family });
            });
        });
    }


    /**
     * Stops the HTTP listener. Resolves once every in-flight request has
     * finished. Idempotent — calling stop() before start() or twice is a no-op.
     *
     * HTTP keep-alive would otherwise hold `server.close()` open for the full
     * keepAliveTimeout (Node default ~5s) even when no request is in flight.
     * Two levers combined drop that:
     *   - `closeIdleConnections()` drops sockets that are idle at stop time.
     *   - `keepAliveTimeout = 1` ensures any socket that becomes idle after
     *     its current response finishes also closes immediately.
     * Active requests still drain normally.
     *
     * @returns {Promise<void>}
     */
    function stop() {
        return new Promise(function(resolve) {
            if (!httpServer) return resolve();
            var toClose = httpServer;
            httpServer = null;
            toClose.keepAliveTimeout = 1;
            toClose.close(function() { resolve(); });
            if (typeof(toClose.closeIdleConnections) === 'function') {
                toClose.closeIdleConnections();
            }
        });
    }


    /**
     * Returns the current bind address, or null when not listening.
     *
     * @returns {{host: string, port: number, family: string}|null}
     */
    function address() {
        if (!httpServer) return null;
        var a = httpServer.address();
        if (!a) return null;
        return { host: a.address, port: a.port, family: a.family };
    }


    return {
        start:   start,
        stop:    stop,
        address: address
    };
}


module.exports = {
    createHttpTransport:    createHttpTransport,
    DEFAULT_MAX_BODY_BYTES: DEFAULT_MAX_BODY_BYTES
};
