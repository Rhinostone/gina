/**
 * #B489 — `self.query()` raw-body pass-through: `options.body` (Buffer | string)
 * sent verbatim under the caller's own `content-type`, on BOTH transports.
 * #B494 — an HTTP/1 retry used to re-send the request with NO body.
 *
 * Before #B489 a caller could not hand query() bytes to send as-is: `data`
 * was JSON-encoded (or appended as a query string), the outbound content-type
 * was forced to the json mime unconditionally, a Buffer left on `options`
 * was destroyed by the options deep-clone, and the HTTP/2 request prep
 * relabelled any non-JSON outbound body with the INCOMING request's
 * content-type. Before #B494 the HTTP/1 handler deleted `options.queryData`
 * after the first write and the retry re-entered with the same options, so a
 * retried request carried `content-length: 0`.
 *
 * Sections:
 *   01 — source pins on the cooperating sites.
 *   02 — behavioural, on a REAL http server and a REAL h2c server: the body
 *        and its content-type arrive verbatim; the incoming request's
 *        content-type does not relabel a raw body; body + data is refused
 *        before any upstream contact; a wrong body type is refused; the
 *        default content-type; the JSON/query-string paths are untouched (CONTROL).
 *   03 — #B494: a destroyed first socket + `retryUnsafe` → the retried POST
 *        carries the SAME body.
 *
 * Red-first: every 01 pin and every 02/03 arm that pins the change goes red on
 * the pre-change bytes; the arms marked CONTROL stay green on both revisions.
 */

'use strict';

var assert = require('node:assert');
var { describe, it, before, after } = require('node:test');
var fs     = require('fs');
var path   = require('path');
var http   = require('http');
var http2  = require('http2');
var crypto = require('crypto');

var FW = require('../fw');
var SOURCE = path.join(FW, 'core', 'controller', 'controller.js');
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
require(path.join(FW, '..', '..', 'utils', 'prototypes'));
setPath('gina', { core: path.join(FW, 'core') });
var SuperController = require(SOURCE);

var SRC = fs.readFileSync(SOURCE, 'utf8');

function md5(b) { return crypto.createHash('md5').update(b).digest('hex'); }
function region(startNeedle, endNeedle) {
    var a = SRC.indexOf(startNeedle); assert.ok(a > -1, 'anchor missing: ' + startNeedle);
    var b = SRC.indexOf(endNeedle, a); assert.ok(b > a, 'end anchor missing: ' + endNeedle);
    return SRC.slice(a, b);
}


// ── 01 — source pins ────────────────────────────────────────────────────────

describe('01 - #B489/#B494 source pins', function() {

    it('the raw body is extracted BEFORE the options deep-clone (JSON.clone would destroy a Buffer)', function() {
        var extract = SRC.indexOf('var rawBody    = options.body');
        var clone   = SRC.indexOf('options = merge(JSON.clone(options), defaultOptions)');
        assert.ok(extract > -1, 'extraction present');
        assert.ok(clone > -1 && extract < clone, 'extraction precedes the clone');
    });

    it('the json content-type forcing is kept (CONTROL) and guarded by the raw-body flag', function() {
        var q = region('this.query = function(options, data, callback)', 'var handleHTTP1ClientRequest = function');
        assert.ok(q.indexOf("options.headers['content-type'] = local.options.conf.server.coreConfiguration.mime['json']") > -1, 'the forcing literal stays');
        assert.ok(q.indexOf('if ( !hasRawBody ) {') > -1, 'the forcing is guarded');
        assert.ok(q.indexOf("options._rawBody = true") > -1, 'the flag travels on the options for the HTTP/2 prep');
    });

    it('the HTTP/2 incoming content-type relabel is guarded by the raw-body flag, and the flag never becomes a header', function() {
        var h2 = region('var handleHTTP2ClientRequest = function', 'this.forward404Unless = function');
        assert.ok(h2.indexOf("&& !/application\\/json/i.test(options.headers['content-type']) && !options._rawBody ) {") > -1, 'guard appended after the #FORMCT2 condition');
        assert.ok(h2.indexOf("'_rawBody',") > -1, '_rawBody listed in _NON_HTTP_OPTS');
    });

    it('#B494 — the HTTP/1 handler stashes the body and restores it on a retry', function() {
        var h1 = region('var handleHTTP1ClientRequest = function', 'var handleHTTP2ClientRequest = function');
        assert.ok(h1.indexOf('options._body = body;') > -1, 'stash present');
        assert.ok(h1.indexOf('options.queryData = options._body;') > -1, 'restore present');
        assert.ok(h1.indexOf('options.queryData = options._body;') < h1.indexOf('let body = "";'), 'the restore precedes the body build');
    });

    it('the JSDoc documents options.body', function() {
        var doc = SRC.slice(SRC.lastIndexOf('/**', SRC.indexOf('this.query = function(options, data, callback)')), SRC.indexOf('this.query = function(options, data, callback)'));
        assert.ok(doc.indexOf('`options.body`') > -1);
    });
});


// ── 02 — behavioural ────────────────────────────────────────────────────────

describe('02 - #B489 behavioural: raw bodies arrive verbatim on both transports', function() {

    before(function() {
        setContext('bundle', 'tb89');
        setContext('env', 'dev');
        setContext('gina', {
            ports: { 'http/1.1': { http: {} }, 'http/2.0': { http: {} } },
            config: { envConf: { tb89: { dev: {
                server: { resolvers: [], credentials: {}, protocol: 'http/1.1', scheme: 'http', port: 65489 },
                host: '127.0.0.1', hostname: 'http://127.0.0.1:65489'
            } } } }
        });
    });

    function makeInst(incomingHeaders) {
        var inst = SuperController.createTestInstance({
            req: { url: '/x', method: 'POST', headers: incomingHeaders || {}, routing: { rule: 'r89', namespace: 'default', param: {} }, params: {}, get: {}, post: {} },
            res: { setHeader: function(){}, end: function(){}, writeHead: function(){}, getHeaders: function(){ return {}; }, statusCode: 200 },
            options: {
                conf: {
                    bundle: 'tb89', encoding: 'utf-8',
                    server: { protocol: 'http/1.1', scheme: 'http',
                              coreConfiguration: { statusCodes: { '404': 'Not Found', '500': 'Internal Server Error' }, mime: { json: 'application/json' } },
                              supportedRequestMethods: { get: 1, post: 1 } },
                    content: { routing: { r89: {} } }
                },
                rule: 'r89', control: 'act', bundle: 'tb89', controller: '/controllers/t89.js'
            }
        });
        inst.serverInstance = { _cached: new Map(), _cachePath: '/tmp/gina-t89', _cacheIsEnabled: 'false', _http2Sessions: [] };
        inst.throwError = function() {};
        return inst;
    }
    function destroy(inst) {
        try { inst.serverInstance._cached.forEach(function(v) { if (v && typeof v.destroy === 'function') { v.destroy(); } }); } catch (e) {}
        try { (inst.serverInstance._http2Sessions || []).forEach(function(s) { if (s && typeof s.destroy === 'function') { s.destroy(); } }); } catch (e) {}
    }
    function collect(req, cb) {
        var chunks = [];
        req.on('data', function(c) { chunks.push(c); });
        req.on('end', function() { cb(Buffer.concat(chunks)); });
    }
    // Every upstream records what it received and answers a JSON 200.
    function h1Upstream() {
        return new Promise(function(resolve) {
            var seen = [];
            var srv = http.createServer(function(req, res) {
                collect(req, function(body) {
                    seen.push({ method: req.method, url: req.url, ct: req.headers['content-type'], cl: req.headers['content-length'], body: body });
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, n: seen.length }));
                });
            });
            srv.listen(0, '127.0.0.1', function() {
                srv.unref();
                resolve({ port: srv.address().port, seen: seen, close: function() { try { srv.closeAllConnections(); } catch (e) {} try { srv.close(); } catch (e) {} } });
            });
        });
    }
    function h2Upstream() {
        return new Promise(function(resolve) {
            var seen = [], sessions = [];
            var srv = http2.createServer(function(req, res) {
                collect(req, function(body) {
                    seen.push({ method: req.method, url: req.url, ct: req.headers['content-type'], body: body });
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, n: seen.length }));
                });
            });
            srv.on('session', function(s) { sessions.push(s); });
            srv.listen(0, '127.0.0.1', function() {
                srv.unref();
                resolve({ port: srv.address().port, seen: seen, close: function() { sessions.forEach(function(s) { try { s.destroy(); } catch (e) {} }); try { srv.close(); } catch (e) {} } });
            });
        });
    }
    function h1Opts(P, extra) {
        return Object.assign({ protocol: 'http/1.1', scheme: 'http', host: '127.0.0.1', port: P, path: '/up', method: 'POST', requestTimeout: '2s', maxRetry: 0 }, extra || {});
    }
    function h2Opts(P, extra) {
        return Object.assign({ protocol: 'http/2.0', scheme: 'http', hostname: 'http://127.0.0.1:' + P, host: '127.0.0.1', port: P, path: '/up', method: 'POST', requestTimeout: '2s', maxRetry: 0 }, extra || {});
    }
    function run(inst, opts, data) {
        return new Promise(function(resolve) {
            inst.query(opts, data, function(err, result) { resolve({ err: err, result: result }); });
        });
    }
    function waitFor(fn, cap) {
        return new Promise(function(resolve, reject) {
            var t0 = Date.now();
            (function poll() { if (fn()) { return resolve(); } if (Date.now() - t0 > cap) { return reject(new Error('waitFor timeout')); } setTimeout(poll, 15); })();
        });
    }

    var BODY = Buffer.concat([ Buffer.from('--X\r\nContent-Disposition: form-data; name="f"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'), Buffer.from([0, 1, 2, 255, 254, 13, 10]), Buffer.from('\r\n--X--\r\n') ]);
    var CT   = 'multipart/form-data; boundary=X';

    it('HTTP/1: a Buffer body and its content-type arrive verbatim, content-length = its length', async function() {
        var up = await h1Upstream(); var inst = makeInst();
        try {
            var r = await run(inst, h1Opts(up.port, { headers: { 'content-type': CT }, body: BODY }), {});
            assert.strictEqual(r.err, false, 'no error: ' + JSON.stringify(r.err));
            assert.strictEqual(up.seen.length, 1);
            assert.strictEqual(up.seen[0].ct, CT);
            assert.strictEqual(md5(up.seen[0].body), md5(BODY));
            assert.strictEqual(String(up.seen[0].cl), String(BODY.length));
            assert.strictEqual(up.seen[0].url, '/up', 'no query string appended');
        } finally { destroy(inst); up.close(); }
    });

    it('HTTP/2: a Buffer body and its content-type arrive verbatim', async function() {
        var up = await h2Upstream(); var inst = makeInst();
        try {
            var r = await run(inst, h2Opts(up.port, { headers: { 'content-type': CT }, body: BODY }), {});
            assert.strictEqual(r.err, false, 'no error: ' + JSON.stringify(r.err));
            await waitFor(function() { return up.seen.length === 1; }, 2000);
            assert.strictEqual(up.seen[0].ct, CT);
            assert.strictEqual(md5(up.seen[0].body), md5(BODY));
        } finally { destroy(inst); up.close(); }
    });

    it('HTTP/2: the INCOMING request\'s content-type does not relabel a raw body (the #FORMCT2 forward is skipped)', async function() {
        var up = await h2Upstream(); var inst = makeInst({ 'content-type': 'multipart/form-data; boundary=browser' });
        try {
            var r = await run(inst, h2Opts(up.port, { headers: { 'content-type': CT }, body: BODY }), {});
            assert.strictEqual(r.err, false, 'no error: ' + JSON.stringify(r.err));
            await waitFor(function() { return up.seen.length === 1; }, 2000);
            assert.strictEqual(up.seen[0].ct, CT, 'our boundary, not the browser\'s');
        } finally { destroy(inst); up.close(); }
    });

    it('HTTP/1: CONTROL — the same incoming content-type never relabelled on HTTP/1 either', async function() {
        var up = await h1Upstream(); var inst = makeInst({ 'content-type': 'multipart/form-data; boundary=browser' });
        try {
            var r = await run(inst, h1Opts(up.port, { headers: { 'content-type': CT }, body: BODY }), {});
            assert.strictEqual(r.err, false);
            assert.strictEqual(up.seen[0].ct, CT);
        } finally { destroy(inst); up.close(); }
    });

    it('body + non-empty data is refused with BODY_AND_DATA before any upstream contact', async function() {
        var up = await h1Upstream(); var inst = makeInst();
        try {
            var r = await run(inst, h1Opts(up.port, { headers: { 'content-type': CT }, body: BODY }), { a: '1' });
            assert.ok(r.err && r.err.code === 'BODY_AND_DATA', 'got: ' + JSON.stringify(r.err));
            assert.strictEqual(up.seen.length, 0, 'upstream never contacted');
        } finally { destroy(inst); up.close(); }
    });

    it('a body that is neither a Buffer nor a string is refused with BODY_TYPE', async function() {
        var up = await h1Upstream(); var inst = makeInst();
        try {
            var r = await run(inst, h1Opts(up.port, { body: 42 }), {});
            assert.ok(r.err && r.err.code === 'BODY_TYPE', 'got: ' + JSON.stringify(r.err));
            assert.strictEqual(up.seen.length, 0);
        } finally { destroy(inst); up.close(); }
    });

    it('a string body travels as UTF-8; without a content-type it is labelled application/octet-stream', async function() {
        var up = await h1Upstream(); var inst = makeInst();
        try {
            var r1 = await run(inst, h1Opts(up.port, { headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'héllo' }), {});
            assert.strictEqual(r1.err, false);
            assert.strictEqual(up.seen[0].body.toString('utf8'), 'héllo');
            assert.strictEqual(up.seen[0].ct, 'text/plain; charset=utf-8');
            var r2 = await run(inst, h1Opts(up.port, { body: Buffer.from([1, 2, 3]) }), {});
            assert.strictEqual(r2.err, false);
            assert.strictEqual(up.seen[1].ct, 'application/octet-stream');
        } finally { destroy(inst); up.close(); }
    });

    it('CONTROL — without a body, a POST with data is still JSON-encoded and labelled application/json', async function() {
        var up = await h1Upstream(); var inst = makeInst();
        try {
            var r = await run(inst, h1Opts(up.port, { headers: { 'content-type': 'application/json' } }), { a: '1', b: [1, 2] });
            assert.strictEqual(r.err, false);
            assert.strictEqual(up.seen[0].ct, 'application/json');
            assert.deepStrictEqual(JSON.parse(up.seen[0].body.toString('utf8')), { a: '1', b: [1, 2] });
        } finally { destroy(inst); up.close(); }
    });

    it('CONTROL — without a body, a GET with data appends a query string', async function() {
        var up = await h1Upstream(); var inst = makeInst();
        try {
            var r = await run(inst, h1Opts(up.port, { method: 'GET' }), { q: 'x' });
            assert.strictEqual(r.err, false);
            assert.strictEqual(up.seen[0].url, '/up?q=x');
            assert.strictEqual(up.seen[0].method, 'GET');
        } finally { destroy(inst); up.close(); }
    });
});


// ── 03 — #B494 ──────────────────────────────────────────────────────────────

describe('03 - #B494 behavioural: an HTTP/1 retry re-sends the same body', function() {

    it('after a destroyed first socket, the retried POST (retryUnsafe) carries the same JSON body', async function() {
        setContext('bundle', 'tb94'); setContext('env', 'dev');
        setContext('gina', { ports: { 'http/1.1': { http: {} }, 'http/2.0': { http: {} } }, config: { envConf: { tb94: { dev: { server: { resolvers: [], credentials: {}, protocol: 'http/1.1', scheme: 'http', port: 65494 }, host: '127.0.0.1', hostname: 'http://127.0.0.1:65494' } } } } });
        var inst = SuperController.createTestInstance({
            req: { url: '/x', method: 'POST', headers: {}, routing: { rule: 'r94', namespace: 'default', param: {} }, params: {}, get: {}, post: {} },
            res: { setHeader: function(){}, end: function(){}, writeHead: function(){}, getHeaders: function(){ return {}; }, statusCode: 200 },
            options: { conf: { bundle: 'tb94', encoding: 'utf-8', server: { protocol: 'http/1.1', scheme: 'http', coreConfiguration: { statusCodes: { '500': 'Internal Server Error' }, mime: { json: 'application/json' } }, supportedRequestMethods: { post: 1 } }, content: { routing: { r94: {} } } }, rule: 'r94', control: 'act', bundle: 'tb94', controller: '/controllers/t94.js' }
        });
        inst.serverInstance = { _cached: new Map(), _cachePath: '/tmp/gina-t94', _cacheIsEnabled: 'false', _http2Sessions: [] };
        inst.throwError = function() {};
        var seen = [], hits = 0;
        var srv = http.createServer(function(req, res) {
            ++hits;
            if (hits === 1) { req.socket.destroy(); return; } // a post-send transient failure
            var chunks = [];
            req.on('data', function(c) { chunks.push(c); });
            req.on('end', function() {
                seen.push({ cl: req.headers['content-length'], body: Buffer.concat(chunks).toString('utf8') });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            });
        });
        await new Promise(function(r) { srv.listen(0, '127.0.0.1', r); });
        srv.unref();
        try {
            var data = { a: '1', nested: { b: 'two' } };
            var out = await new Promise(function(resolve) {
                inst.query({ protocol: 'http/1.1', scheme: 'http', host: '127.0.0.1', port: srv.address().port, path: '/retry', method: 'POST', requestTimeout: '2s', maxRetry: 2, retryUnsafe: true, headers: { 'content-type': 'application/json' } }, data, function(err, result) { resolve({ err: err, result: result }); });
            });
            assert.strictEqual(out.err, false, 'the retry succeeded: ' + JSON.stringify(out.err));
            assert.strictEqual(hits, 2, 'exactly one retry');
            assert.strictEqual(seen.length, 1);
            assert.strictEqual(seen[0].body, JSON.stringify(data), 'the retried request carries the same body');
            assert.strictEqual(String(seen[0].cl), String(Buffer.byteLength(JSON.stringify(data))));
        } finally {
            try { inst.serverInstance._cached.forEach(function(v) { if (v && typeof v.destroy === 'function') { v.destroy(); } }); } catch (e) {}
            try { srv.closeAllConnections(); } catch (e) {} try { srv.close(); } catch (e) {}
        }
    });
});
