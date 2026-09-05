/**
 * #B475 — the fluent `{onComplete}` handles of `self.query()` and `self.store()`
 * registered their callback on the controller instance's SHARED EventEmitter
 * instead of a per-call channel:
 *  - `store(target).onComplete(cb)` used `self.on('uploaded', cb)` and never
 *    removed it, so a SECOND store() on the same instance (sequential or
 *    overlapping) re-invoked every earlier callback with the later result;
 *  - `query(options, data).onComplete(cb)` did `removeAllListeners` + `once`
 *    on `query#complete`, so a concurrent fluent query EVICTED the first
 *    listener: the first callback never fired, the survivor could receive the
 *    other call's payload, and the evicted response was emitted to zero
 *    listeners — both transports, no log line;
 *  - nine synchronous failure paths handed the caller `emit()`'s boolean (or
 *    `undefined`) instead of the handle, so the documented chain threw
 *    `TypeError: .onComplete is not a function` and the payload was lost.
 * Every arm below was RED on the pre-fix bytes (readings in the assertion
 * messages); the callback-form arms are the controls that must stay green on
 * both sides of the change. Pickup: bundle restart (controller.js is server-side).
 */

'use strict';

var assert = require('node:assert');
var { describe, it, before, after } = require('node:test');
var fs    = require('fs');
var os    = require('os');
var path  = require('path');
var http  = require('http');
var http2 = require('http2');
var net   = require('net');

var FW = require('../fw');
var SOURCE = path.join(FW, 'core', 'controller', 'controller.js');
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
require(path.join(FW, '..', '..', 'utils', 'prototypes'));
setPath('gina', { core: path.join(FW, 'core') });
var SuperController = require(SOURCE);

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b475-'));

function makeInst(shared) {
    var inst = SuperController.createTestInstance({
        req: { url: '/x', method: 'GET', headers: {}, session: {}, routing: { rule: 'r475', namespace: 'default', param: {} }, params: {}, get: {}, post: {}, files: [] },
        res: { setHeader: function(){}, end: function(){}, writeHead: function(){}, getHeaders: function(){ return {}; }, statusCode: 200 },
        options: {
            conf: {
                bundle: 'tb475', encoding: 'utf-8',
                server: { protocol: 'http/1.1', scheme: 'http',
                          coreConfiguration: { statusCodes: { '404': 'Not Found', '500': 'Internal Server Error', '502': 'Bad Gateway', '503': 'Service Unavailable' }, mime: { json: 'application/json' } },
                          supportedRequestMethods: { get: 1 } },
                content: { routing: { r475: {} } }
            },
            rule: 'r475', control: 'act', bundle: 'tb475', controller: '/controllers/t475.js'
        }
    });
    inst.serverInstance = shared || { _cached: new Map(), _cachePath: path.join(TMP, 'cache'), _cacheIsEnabled: 'false', _http2Sessions: [] };
    inst._thrown = [];
    inst.throwError = function(a) { inst._thrown.push({ msg: String((a && (a.message || a.msg)) || a), status: a && a.status }); };
    return inst;
}
function destroyShared(sh) {
    try { sh._cached.forEach(function(v) { if (v && typeof v.destroy === 'function') { v.destroy(); } }); } catch (e) {}
    try { (sh._http2Sessions || []).forEach(function(s) { if (s && typeof s.destroy === 'function') { s.destroy(); } }); } catch (e) {}
}
function hold(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function waitFor(fn, cap) {
    return new Promise(function(resolve) {
        var t0 = Date.now();
        (function poll() { if (fn() || Date.now() - t0 > cap) { return resolve(fn()); } setTimeout(poll, 10); })();
    });
}
function freePort() {
    return new Promise(function(resolve) {
        var srv = net.createServer();
        srv.listen(0, '127.0.0.1', function() { var p = srv.address().port; srv.close(function() { resolve(p); }); });
    });
}
// upstreams answer `/slow` after 300 ms and everything else after 30 ms, echoing the path
function h1Server() {
    return new Promise(function(resolve) {
        var srv = http.createServer(function(q, r) {
            setTimeout(function() { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ echo: q.url })); }, /slow/.test(q.url) ? 300 : 30);
        });
        srv.listen(0, '127.0.0.1', function() { resolve(srv); });
    });
}
function h2Server() {
    return new Promise(function(resolve) {
        var srv = http2.createServer();
        srv._sessions = [];
        srv.on('session', function(s) { srv._sessions.push(s); });
        srv.on('stream', function(stream, headers) {
            var p = headers[':path'];
            setTimeout(function() { try { stream.respond({ ':status': 200, 'content-type': 'application/json' }); stream.end(JSON.stringify({ echo: p })); } catch (e) {} }, /slow/.test(p) ? 300 : 30);
        });
        srv.listen(0, '127.0.0.1', function() { resolve(srv); });
    });
}
function closeServer(srv) {
    try { if (srv._sessions) { srv._sessions.forEach(function(s) { try { s.destroy(); } catch (e) {} }); } } catch (e) {}
    try { if (typeof srv.closeAllConnections === 'function') { srv.closeAllConnections(); } } catch (e) {}
    srv.close();
}
function o1(port, p) { return { protocol: 'http/1.1', scheme: 'http', hostname: '127.0.0.1', host: '127.0.0.1', port: port, path: p, method: 'GET', requestTimeout: '2s', headers: { 'content-type': 'application/json' } }; }
function o2(port, p) { return { protocol: 'http/2.0', scheme: 'http', hostname: 'http://127.0.0.1:' + port, host: '127.0.0.1', port: port, path: p, method: 'GET', requestTimeout: '2s', headers: { 'content-type': 'application/json' } }; }
function qrec(name, sink) { return function(err, data) { sink.push({ cb: name, err: err ? (err.status || String(err.message || err)) : false, echo: data && data.echo }); }; }

// store fixtures: real files, moved by the real `movefiles`
function mkFiles(dir, names) {
    fs.mkdirSync(dir, { recursive: true });
    return names.map(function(n) {
        var p = path.join(dir, n); fs.writeFileSync(p, 'content of ' + n);
        return { path: p, filename: n, size: fs.statSync(p).size, type: 'text/plain', encoding: '7bit', group: 'untagged' };
    });
}
function srec(name, sink) { return function(err, files) { sink.push({ cb: name, err: err ? String(err.message || err) : false, files: Array.isArray(files) ? files.map(function(f) { return f.file; }) : files }); }; }

before(function() {
    setContext('bundle', 'tb475');
    setContext('env', 'dev');
    setContext('gina', {
        ports: { 'http/1.1': { http: {} }, 'http/2.0': { http: {} } },
        config: { envConf: { tb475: { dev: {
            server: { resolvers: [], credentials: {}, protocol: 'http/1.1', scheme: 'http', port: 65530 },
            host: '127.0.0.1', hostname: 'http://127.0.0.1:65530'
        } } } }
    });
});
after(function() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });

describe('01 - #B475 store(): the fluent handle delivers per call', function() {

    it('a single fluent call delivers once and leaves NO listener on the instance', async function() {
        var inst = makeInst(), sink = [];
        var f = mkFiles(path.join(TMP, 's0', 'src'), ['a1.txt', 'a2.txt']);
        inst.store(path.join(TMP, 's0', 'dst'), f).onComplete(srec('cb0', sink));
        await waitFor(function() { return sink.length >= 1; }, 2000); await hold(50);
        assert.deepStrictEqual(sink, [{ cb: 'cb0', err: false, files: ['a1.txt', 'a2.txt'] }]);
        assert.equal(inst.listenerCount('uploaded'), 0, "pre-fix measured: listenerCount('uploaded') stayed 1 after completion — the .on was never released");
    });

    it('sequential fluent calls on one instance: the first callback is NOT re-invoked by the second store()', async function() {
        var inst = makeInst(), sink = [];
        var fa = mkFiles(path.join(TMP, 's1', 'srcA'), ['a1.txt']), fb = mkFiles(path.join(TMP, 's1', 'srcB'), ['b1.txt']);
        inst.store(path.join(TMP, 's1', 'dstA'), fa).onComplete(srec('cb1', sink));
        await waitFor(function() { return sink.length >= 1; }, 2000);
        inst.store(path.join(TMP, 's1', 'dstB'), fb).onComplete(srec('cb2', sink));
        await waitFor(function() { return sink.length >= 2; }, 2000); await hold(150);
        assert.deepStrictEqual(sink, [{ cb: 'cb1', err: false, files: ['a1.txt'] }, { cb: 'cb2', err: false, files: ['b1.txt'] }],
            "pre-fix measured: cb1 fired AGAIN with b1.txt (store #2's result) before cb2 did");
        assert.equal(inst.listenerCount('uploaded'), 0);
    });

    it('overlapping fluent calls: each callback fires exactly once, with its own files', async function() {
        var inst = makeInst(), sink = [];
        var fc = mkFiles(path.join(TMP, 's2', 'srcC'), ['c1.txt']), fd = mkFiles(path.join(TMP, 's2', 'srcD'), ['d1.txt']);
        inst.store(path.join(TMP, 's2', 'dstC'), fc).onComplete(srec('cbC', sink));
        inst.store(path.join(TMP, 's2', 'dstD'), fd).onComplete(srec('cbD', sink));
        await waitFor(function() { return sink.length >= 2; }, 2000); await hold(150);
        var byCb = {}; sink.forEach(function(e) { byCb[e.cb] = (byCb[e.cb] || []).concat([e.files.join(',')]); });
        assert.deepStrictEqual(byCb, { cbC: ['c1.txt'], cbD: ['d1.txt'] },
            'pre-fix measured: cbC ← c1, cbD ← c1, cbC ← d1, cbD ← d1 — each callback twice, two wrong deliveries');
    });

    it('callback form (control): each callback fires once with its own files, no listener', async function() {
        var inst = makeInst(), sink = [];
        var fe = mkFiles(path.join(TMP, 's3', 'srcE'), ['e1.txt']), ff = mkFiles(path.join(TMP, 's3', 'srcF'), ['f1.txt']);
        inst.store(path.join(TMP, 's3', 'dstE'), fe, srec('cbE', sink));
        inst.store(path.join(TMP, 's3', 'dstF'), ff, srec('cbF', sink));
        await waitFor(function() { return sink.length >= 2; }, 2000); await hold(150);
        var byCb = {}; sink.forEach(function(e) { byCb[e.cb] = (byCb[e.cb] || []).concat([e.files.join(',')]); });
        assert.deepStrictEqual(byCb, { cbE: ['e1.txt'], cbF: ['f1.txt'] });
        assert.equal(inst.listenerCount('uploaded'), 0);
    });
});

[['HTTP/1.1', h1Server, o1], ['HTTP/2', h2Server, o2]].forEach(function(t) {
    var label = t[0], mkServer = t[1], o = t[2];

    describe('02 - #B475 query() fluent form delivers per call — ' + label, function() {
        var srv, port, shared;
        before(async function() { srv = await mkServer(); port = srv.address().port; shared = { _cached: new Map(), _cachePath: path.join(TMP, 'cache-' + label), _cacheIsEnabled: 'false', _http2Sessions: [] }; });
        after(function() { destroyShared(shared); closeServer(srv); });

        it('sequential fluent calls (control): each callback receives its own payload', async function() {
            var inst = makeInst(shared), sink = [];
            inst.query(o(port, '/slow'), {}).onComplete(qrec('cb1', sink));
            await waitFor(function() { return sink.length >= 1; }, 3000);
            inst.query(o(port, '/fast'), {}).onComplete(qrec('cb2', sink));
            await waitFor(function() { return sink.length >= 2; }, 3000); await hold(50);
            assert.deepStrictEqual(sink, [{ cb: 'cb1', err: false, echo: '/slow' }, { cb: 'cb2', err: false, echo: '/fast' }]);
            assert.equal(inst._thrown.length, 0);
        });

        it('overlapping, slow registered first: BOTH callbacks fire once with their own payload; nothing is left on the instance emitter', async function() {
            var inst = makeInst(shared), sink = [];
            inst.query(o(port, '/slow'), {}).onComplete(qrec('cb1(slow)', sink));
            var lc1 = inst.listenerCount('query#complete');
            inst.query(o(port, '/fast'), {}).onComplete(qrec('cb2(fast)', sink));
            var lc2 = inst.listenerCount('query#complete');
            await waitFor(function() { return sink.length >= 2; }, 3000); await hold(100);
            assert.deepStrictEqual([lc1, lc2], [0, 0], 'pre-fix measured: 1 then 1 — the second registration evicted the first listener');
            var byCb = {}; sink.forEach(function(e) { byCb[e.cb] = (byCb[e.cb] || []).concat([e.echo]); });
            assert.deepStrictEqual(byCb, { 'cb1(slow)': ['/slow'], 'cb2(fast)': ['/fast'] },
                "pre-fix measured: only cb2(fast) fired; the slow response was emitted to 0 listeners and cb1 never ran");
            assert.equal(inst._thrown.length, 0, 'no framework answer — the app owns both outcomes');
        });

        it("overlapping, fast registered first: the slow query's callback receives the SLOW payload (no misattribution)", async function() {
            var inst = makeInst(shared), sink = [];
            inst.query(o(port, '/fast'), {}).onComplete(qrec('cb1(fast)', sink));
            inst.query(o(port, '/slow'), {}).onComplete(qrec('cb2(slow)', sink));
            await waitFor(function() { return sink.length >= 2; }, 3000); await hold(100);
            var byCb = {}; sink.forEach(function(e) { byCb[e.cb] = (byCb[e.cb] || []).concat([e.echo]); });
            assert.deepStrictEqual(byCb, { 'cb1(fast)': ['/fast'], 'cb2(slow)': ['/slow'] },
                "pre-fix measured: cb2(slow) received '/fast' (the other call's payload) and cb1 never fired");
        });

        it('callback form (control): overlapping calls deliver each to its own callback and emit nothing', async function() {
            var inst = makeInst(shared), sink = [], emits = 0, orig = inst.emit;
            inst.emit = function(ev) { if (ev === 'query#complete') { emits++; } return orig.apply(this, arguments); };
            inst.query(o(port, '/slow'), {}, qrec('cb1(slow)', sink));
            inst.query(o(port, '/fast'), {}, qrec('cb2(fast)', sink));
            await waitFor(function() { return sink.length >= 2; }, 3000); await hold(50);
            var byCb = {}; sink.forEach(function(e) { byCb[e.cb] = (byCb[e.cb] || []).concat([e.echo]); });
            assert.deepStrictEqual(byCb, { 'cb1(slow)': ['/slow'], 'cb2(fast)': ['/fast'] });
            assert.equal(emits, 0, 'the callback form never rides the emitter');
        });
    });
});

describe('03 - #B475 (d): the handle comes back on every path and outlives the settlement', function() {
    var srv, port, shared;
    before(async function() { srv = await h1Server(); port = srv.address().port; shared = { _cached: new Map(), _cachePath: path.join(TMP, 'cache-d'), _cacheIsEnabled: 'false', _http2Sessions: [] }; });
    after(function() { destroyShared(shared); closeServer(srv); });

    it('host missing (a synchronous failure): query() returns a CHAINABLE handle and delivers the wrapped error on the next tick', async function() {
        var inst = makeInst(shared), got = [];
        var ret = inst.query({ path: '/x', method: 'GET', requestTimeout: '1s' }, {});
        assert.equal(typeof (ret && ret.onComplete), 'function',
            "pre-fix measured: query() returned emit()'s boolean `true` and the chain threw TypeError: onComplete is not a function");
        assert.strictEqual(ret.onComplete(function(err, data) { got.push({ err: err, dataDefined: typeof data !== 'undefined' }); }), ret, 'the handle is chainable');
        assert.equal(got.length, 0, 'delivery of a synchronous failure waits for the chained registration (next tick)');
        await hold(20);
        assert.equal(got.length, 1, 'pre-fix: the error was emitted synchronously before any listener existed and lost');
        assert.equal(got[0].err.status, 500, 'a native Error rides the {status, error} wrap the fluent form uses for transport errors');
        assert.match(String(got[0].err.error), /needs at least a/);
        assert.equal(got[0].dataDefined, false);
        assert.equal(inst._thrown.length, 0);
        assert.equal(inst.listenerCount('query#complete'), 0);
    });

    it('an explicit null callback takes the fluent form (the guard spellings no longer disagree)', async function() {
        var inst = makeInst(shared), got = [];
        var ret = inst.query(o1(port, '/fast'), {}, null);
        assert.equal(typeof (ret && ret.onComplete), 'function', 'pre-fix: null passed the typeof-undefined guards and the delivery threw "callback is not a function"');
        ret.onComplete(qrec('cb', got));
        await waitFor(function() { return got.length >= 1; }, 3000);
        assert.deepStrictEqual(got, [{ cb: 'cb', err: false, echo: '/fast' }]);
    });

    it('two .onComplete registrations on one handle BOTH fire', async function() {
        var inst = makeInst(shared), got = [];
        var ret = inst.query(o1(port, '/fast'), {});
        ret.onComplete(qrec('first', got)).onComplete(qrec('second', got));
        await waitFor(function() { return got.length >= 2; }, 3000); await hold(30);
        assert.deepStrictEqual(got.map(function(e) { return e.cb + ':' + e.echo; }), ['first:/fast', 'second:/fast'],
            'pre-fix: the second registration evicted the first');
    });

    it('a discarded handle still emits query#complete for a direct listener (the documented "if omitted, emits" fallback) — contract control, green on both sides', async function() {
        var inst = makeInst(shared), got = [];
        inst.once('query#complete', function(err, data) { got.push({ err: err, echo: data && data.echo }); });
        inst.query(o1(port, '/fast'), {}); // handle discarded on purpose
        await waitFor(function() { return got.length >= 1; }, 3000);
        assert.deepStrictEqual(got, [{ err: false, echo: '/fast' }]);
    });

    it('.onComplete registered AFTER the call settled still fires, with the settled arguments', async function() {
        var inst = makeInst(shared), seen = [], got = [];
        inst.once('query#complete', function() { seen.push(1); }); // completion signal only
        var ret = inst.query(o1(port, '/fast'), {});
        await waitFor(function() { return seen.length >= 1; }, 3000); await hold(20);
        ret.onComplete(qrec('late', got));
        assert.equal(got.length, 0, 'late delivery is asynchronous');
        await hold(20);
        assert.deepStrictEqual(got, [{ cb: 'late', err: false, echo: '/fast' }], 'pre-fix: a listener registered after the emit never fired');
    });
});
