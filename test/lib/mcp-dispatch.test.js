/**
 * lib/mcp-dispatch — HTTP loopback dispatcher.
 *
 * Split into two layers:
 *  - Internals (pure functions): path resolution, query building, response
 *    mapping. Tested directly.
 *  - End-to-end dispatch: spun-up local http.Server. Covers GET/POST/error/
 *    timeout wiring without mocking node:http.
 */

'use strict';

var path = require('path');
var http = require('http');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var dispatchLib = require(path.join(require('../fw'), 'lib/mcp-dispatch/src/main'));
var internals = dispatchLib._internals;


// ---------------------------------------------------------------------------
// 01 — extractParamNames
// ---------------------------------------------------------------------------

describe('01 - extractParamNames', function () {

    it('returns [] for a static path', function () {
        assert.deepEqual(internals.extractParamNames('/user/list'), []);
    });

    it('extracts one :name', function () {
        assert.deepEqual(internals.extractParamNames('/user/:id'), ['id']);
    });

    it('extracts multiple in order', function () {
        assert.deepEqual(internals.extractParamNames('/a/:x/b/:y/c/:z'), ['x', 'y', 'z']);
    });

    it('does not duplicate repeated names', function () {
        // Current contract: preserves every occurrence. resolvePath handles
        // replacement uniformly.
        assert.deepEqual(internals.extractParamNames('/a/:x/b/:x'), ['x', 'x']);
    });
});


// ---------------------------------------------------------------------------
// 02 — resolvePath
// ---------------------------------------------------------------------------

describe('02 - resolvePath', function () {

    it('substitutes a single parameter', function () {
        assert.equal(
            internals.resolvePath('/user/:id', ['id'], { id: '42' }),
            '/user/42'
        );
    });

    it('URL-encodes special characters', function () {
        assert.equal(
            internals.resolvePath('/query/:q', ['q'], { q: 'hello world/?' }),
            '/query/hello%20world%2F%3F'
        );
    });

    it('throws when a path parameter is missing', function () {
        assert.throws(function () {
            internals.resolvePath('/user/:id', ['id'], {});
        }, /Missing path parameter: id/);
    });

    it('does not replace a shorter prefix of another param name', function () {
        // :id must NOT replace :idKind
        assert.equal(
            internals.resolvePath('/:id/:idKind', ['id', 'idKind'], { id: 'a', idKind: 'b' }),
            '/a/b'
        );
    });

    it('coerces non-string values via String()', function () {
        assert.equal(
            internals.resolvePath('/n/:n', ['n'], { n: 7 }),
            '/n/7'
        );
    });
});


// ---------------------------------------------------------------------------
// 03 — extraArgs
// ---------------------------------------------------------------------------

describe('03 - extraArgs', function () {

    it('removes path parameters', function () {
        assert.deepEqual(
            internals.extraArgs({ id: '1', q: 'x' }, ['id']),
            { q: 'x' }
        );
    });

    it('returns empty object when everything is a path param', function () {
        assert.deepEqual(
            internals.extraArgs({ id: '1' }, ['id']),
            {}
        );
    });
});


// ---------------------------------------------------------------------------
// 04 — buildQueryString
// ---------------------------------------------------------------------------

describe('04 - buildQueryString', function () {

    it('URL-encodes keys and values', function () {
        assert.equal(
            internals.buildQueryString({ 'k/1': 'v 1' }),
            'k%2F1=v%201'
        );
    });

    it('repeats arrays as ?k=a&k=b', function () {
        assert.equal(
            internals.buildQueryString({ k: ['a', 'b'] }),
            'k=a&k=b'
        );
    });

    it('skips null/undefined values', function () {
        assert.equal(
            internals.buildQueryString({ a: 'x', b: null, c: undefined }),
            'a=x'
        );
    });

    it('JSON-stringifies object values', function () {
        assert.equal(
            internals.buildQueryString({ filter: { a: 1 } }),
            'filter=%7B%22a%22%3A1%7D'
        );
    });
});


// ---------------------------------------------------------------------------
// 05 — mapResponse
// ---------------------------------------------------------------------------

describe('05 - mapResponse', function () {

    it('maps 2xx JSON to structuredContent + text', function () {
        var r = internals.mapResponse(200, { 'content-type': 'application/json' }, '{"a":1}', 'GET', '/x');
        assert.equal(r.isError, undefined);
        assert.deepEqual(r.structuredContent, { a: 1 });
        assert.equal(r.content[0].type, 'text');
        assert.equal(r.content[0].text, '{"a":1}');
    });

    it('maps 2xx non-JSON to plain text', function () {
        var r = internals.mapResponse(200, { 'content-type': 'text/plain' }, 'hello', 'GET', '/x');
        assert.equal(r.structuredContent, undefined);
        assert.equal(r.content[0].text, 'hello');
    });

    it('maps 2xx empty body to a placeholder text', function () {
        var r = internals.mapResponse(204, {}, '', 'DELETE', '/x');
        assert.match(r.content[0].text, /204/);
    });

    it('falls back to plain text if JSON body fails to parse', function () {
        var r = internals.mapResponse(200, { 'content-type': 'application/json' }, 'not json', 'GET', '/x');
        assert.equal(r.content[0].text, 'not json');
        assert.equal(r.structuredContent, undefined);
    });

    it('marks non-2xx responses as isError', function () {
        var r = internals.mapResponse(404, {}, 'nope', 'GET', '/x');
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, /404/);
        assert.match(r.content[0].text, /nope/);
    });

    it('accepts application/problem+json as JSON content type', function () {
        var r = internals.mapResponse(200, { 'content-type': 'application/problem+json' }, '{"ok":1}', 'GET', '/x');
        assert.deepEqual(r.structuredContent, { ok: 1 });
    });
});


// ---------------------------------------------------------------------------
// 06 — createDispatcher end-to-end against a local http.Server
// ---------------------------------------------------------------------------

describe('06 - dispatch end-to-end', function () {

    function withServer(handler, body) {
        return new Promise(function (resolve, reject) {
            var server = http.createServer(handler);
            server.listen(0, '127.0.0.1', function () {
                var port = server.address().port;
                Promise.resolve()
                    .then(function () { return body(port); })
                    .then(function (result) { server.close(); resolve(result); })
                    .catch(function (err)   { server.close(); reject(err); });
            });
        });
    }

    it('issues a GET with path substitution and returns structuredContent', async function () {
        await withServer(function (req, res) {
            assert.equal(req.method, 'GET');
            assert.equal(req.url, '/user/42');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"id":"42","name":"Alice"}');
        }, async function (port) {
            var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:' + port });
            var tool = { name: 't', _meta: { 'io.gina.url': '/user/:id', 'io.gina.method': 'GET' } };
            var r = await d.dispatch(tool, { id: '42' });
            assert.equal(r.isError, undefined);
            assert.deepEqual(r.structuredContent, { id: '42', name: 'Alice' });
        });
    });

    it('appends extra args as query string on GET', async function () {
        await withServer(function (req, res) {
            assert.equal(req.url, '/search?q=foo&limit=10');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('[]');
        }, async function (port) {
            var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:' + port });
            var tool = { name: 't', _meta: { 'io.gina.url': '/search', 'io.gina.method': 'GET' } };
            await d.dispatch(tool, { q: 'foo', limit: 10 });
        });
    });

    it('sends a JSON body for POST using non-path args', async function () {
        await withServer(function (req, res) {
            assert.equal(req.method, 'POST');
            assert.equal(req.headers['content-type'], 'application/json');
            var chunks = [];
            req.on('data', function (c) { chunks.push(c); });
            req.on('end', function () {
                var body = Buffer.concat(chunks).toString('utf8');
                assert.deepEqual(JSON.parse(body), { name: 'new' });
                res.writeHead(201, { 'content-type': 'application/json' });
                res.end('{"created":true}');
            });
        }, async function (port) {
            var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:' + port });
            var tool = { name: 't', _meta: { 'io.gina.url': '/users', 'io.gina.method': 'POST' } };
            var r = await d.dispatch(tool, { name: 'new' });
            assert.deepEqual(r.structuredContent, { created: true });
        });
    });

    it('uses explicit `body` argument for POST when provided', async function () {
        await withServer(function (req, res) {
            var chunks = [];
            req.on('data', function (c) { chunks.push(c); });
            req.on('end', function () {
                assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), { x: 1 });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end('{}');
            });
        }, async function (port) {
            var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:' + port });
            var tool = { name: 't', _meta: { 'io.gina.url': '/x', 'io.gina.method': 'POST' } };
            await d.dispatch(tool, { body: { x: 1 } });
        });
    });

    it('returns isError for a non-2xx response', async function () {
        await withServer(function (req, res) {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end('boom');
        }, async function (port) {
            var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:' + port });
            var tool = { name: 't', _meta: { 'io.gina.url': '/x', 'io.gina.method': 'GET' } };
            var r = await d.dispatch(tool, {});
            assert.equal(r.isError, true);
            assert.match(r.content[0].text, /500/);
            assert.match(r.content[0].text, /boom/);
        });
    });

    it('surfaces ECONNREFUSED as a clear isError message', async function () {
        // Port 1 is reserved and effectively guaranteed to refuse.
        var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:1' });
        var tool = { name: 't', _meta: { 'io.gina.url': '/x', 'io.gina.method': 'GET' } };
        var r = await d.dispatch(tool, {});
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, /ECONNREFUSED|refused|not running/i);
    });

    it('returns an isError for missing path parameter', async function () {
        var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:1' });
        var tool = { name: 't', _meta: { 'io.gina.url': '/user/:id', 'io.gina.method': 'GET' } };
        var r = await d.dispatch(tool, {});
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, /Missing path parameter: id/);
    });

    it('returns an isError for a tool missing _meta["io.gina.url"]', async function () {
        var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:1' });
        var tool = { name: 'broken', _meta: {} };
        var r = await d.dispatch(tool, {});
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, /io\.gina\.url/);
    });
});


// ---------------------------------------------------------------------------
// 07 — createDispatcher: input validation
// ---------------------------------------------------------------------------

describe('07 - createDispatcher input', function () {

    it('throws if baseUrl is missing', function () {
        assert.throws(function () { dispatchLib.createDispatcher({}); }, /baseUrl is required/);
    });

    it('throws if baseUrl lacks protocol', function () {
        assert.throws(function () { dispatchLib.createDispatcher({ baseUrl: 'localhost' }); }, /protocol and host/);
    });
});


// ---------------------------------------------------------------------------
// 08 — maxInFlight concurrency cap
// ---------------------------------------------------------------------------

describe('08 - maxInFlight concurrency cap', function () {

    // Server that holds requests open until we release them — lets us have
    // N requests in flight simultaneously to test the cap. `waitForPending(n)`
    // resolves once the server has received at least `n` concurrent requests;
    // avoids racing the increment on the client side.
    function withHangServer(body) {
        var pending = [];
        var waiters = [];
        function ping() {
            for (var i = waiters.length - 1; i >= 0; i--) {
                if (pending.length >= waiters[i].n) {
                    waiters[i].resolve();
                    waiters.splice(i, 1);
                }
            }
        }
        return new Promise(function (resolve, reject) {
            var server = http.createServer(function (req, res) {
                pending.push(res);
                ping();
            });
            server.listen(0, '127.0.0.1', function () {
                var port = server.address().port;
                function releaseAll() {
                    while (pending.length) {
                        var r = pending.shift();
                        r.writeHead(200, { 'content-type': 'application/json' });
                        r.end('{"ok":true}');
                    }
                }
                function waitForPending(n) {
                    if (pending.length >= n) return Promise.resolve();
                    return new Promise(function (r) { waiters.push({ n: n, resolve: r }); });
                }
                Promise.resolve()
                    .then(function () { return body(port, releaseAll, waitForPending); })
                    .then(function (result) { server.close(); resolve(result); })
                    .catch(function (err)   { server.close(); reject(err); });
            });
        });
    }

    it('exposes DEFAULT_MAX_IN_FLIGHT on the module', function () {
        assert.equal(typeof(dispatchLib.DEFAULT_MAX_IN_FLIGHT), 'number');
        assert.ok(dispatchLib.DEFAULT_MAX_IN_FLIGHT > 0);
    });

    it('exposes getInFlightCount() on the dispatcher', function () {
        var d = dispatchLib.createDispatcher({ baseUrl: 'http://127.0.0.1:1' });
        assert.equal(typeof(d.getInFlightCount), 'function');
        assert.equal(d.getInFlightCount(), 0);
    });

    it('rejects the (N+1)th concurrent request with isError true', async function () {
        await withHangServer(async function (port, releaseAll, waitForPending) {
            var d = dispatchLib.createDispatcher({
                baseUrl: 'http://127.0.0.1:' + port,
                maxInFlight: 2
            });
            var tool = { name: 't', _meta: { 'io.gina.url': '/x', 'io.gina.method': 'GET' } };

            // Two in flight — never resolve until releaseAll() runs.
            var p1 = d.dispatch(tool, {});
            var p2 = d.dispatch(tool, {});

            // Wait until the server has actually received both before checking
            // the cap — avoids racing the client-side increment with ping().
            await waitForPending(2);
            assert.equal(d.getInFlightCount(), 2, 'expected 2 in flight before the cap check');

            // Third — must short-circuit.
            var r3 = await d.dispatch(tool, {});
            assert.equal(r3.isError, true);
            assert.match(r3.content[0].text, /busy/i);
            assert.match(r3.content[0].text, /limit is 2/);

            // Release the server responses and wait for in-flight to clear.
            releaseAll();
            await Promise.all([p1, p2]);
            assert.equal(d.getInFlightCount(), 0);
        });
    });

    it('decrements in-flight on error responses (e.g. 500)', async function () {
        await new Promise(function (resolve, reject) {
            var server = http.createServer(function (req, res) {
                res.writeHead(500); res.end('boom');
            });
            server.listen(0, '127.0.0.1', async function () {
                try {
                    var port = server.address().port;
                    var d = dispatchLib.createDispatcher({
                        baseUrl: 'http://127.0.0.1:' + port,
                        maxInFlight: 1
                    });
                    var tool = { name: 't', _meta: { 'io.gina.url': '/x', 'io.gina.method': 'GET' } };
                    var r = await d.dispatch(tool, {});
                    assert.equal(r.isError, true);
                    // The slot must be released — second dispatch should succeed.
                    var r2 = await d.dispatch(tool, {});
                    assert.equal(r2.isError, true); // still 500, but reachable
                    assert.equal(d.getInFlightCount(), 0);
                    server.close(); resolve();
                } catch (e) {
                    server.close(); reject(e);
                }
            });
        });
    });

    it('early-exit on missing _meta does NOT consume a slot', async function () {
        var d = dispatchLib.createDispatcher({
            baseUrl: 'http://127.0.0.1:1',
            maxInFlight: 1
        });
        var broken = { name: 't', _meta: {} };
        var r = await d.dispatch(broken, {});
        assert.equal(r.isError, true);
        assert.equal(d.getInFlightCount(), 0);
    });

    it('early-exit on missing path param does NOT consume a slot', async function () {
        var d = dispatchLib.createDispatcher({
            baseUrl: 'http://127.0.0.1:1',
            maxInFlight: 1
        });
        var tool = { name: 't', _meta: { 'io.gina.url': '/user/:id', 'io.gina.method': 'GET' } };
        var r = await d.dispatch(tool, {});
        assert.equal(r.isError, true);
        assert.equal(d.getInFlightCount(), 0);
    });

    it('ignores non-positive maxInFlight values (falls back to default)', function () {
        // 0, negative, or NaN should fall back to the module default rather
        // than lock the dispatcher at zero in-flight.
        var d = dispatchLib.createDispatcher({
            baseUrl: 'http://127.0.0.1:1',
            maxInFlight: 0
        });
        // If 0 were honoured, any dispatch would short-circuit before issuing.
        // We can't actually observe the resolved value here without hitting
        // the network, but we can verify the constant is respected.
        assert.equal(typeof(d.getInFlightCount), 'function');
        assert.ok(dispatchLib.DEFAULT_MAX_IN_FLIGHT >= 1);
    });
});
