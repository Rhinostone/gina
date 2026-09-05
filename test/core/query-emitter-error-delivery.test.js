/**
 * #B404 — in handle/emitter mode (`self.query(options, data)` →
 * `handle.onComplete(cb)`), a transport error or non-2xx outcome NEVER reached
 * the app's listener: every error-path `query#complete` emit is
 * single-argument (mirroring the callback-form contract — `callback(err)` on
 * failure, `callback(false, data)` on success), while both onComplete facades
 * destructured `(err, data)` and dereferenced `data.status` unconditionally —
 * a TypeError inside the facade try, answered 500 by the facade catch with the
 * `while catching back.` marker misattributing a framework arity mismatch to
 * an app callback exception (runtime-measured on both transports, 2026-08-23).
 *
 * Fix: a `typeof(data) == 'undefined'` guard as the first statement of each
 * facade's sync-guard try delivers the single-argument payload as the error —
 * `_ownAsyncCbRejection(cb(err))` — giving emitter mode the exact
 * callback-form error contract (`{status, error}` objects / native or typed
 * Errors). By-catch in the same commit: the host-missing emit gained the
 * `return` its callback twin always had (the only fall-through of the 20 emit
 * sites — the doomed query kept executing after the error was emitted).
 */

'use strict';

var assert = require('node:assert');
var { describe, it, before, after } = require('node:test');
var fs   = require('fs');
var path = require('path');
var net  = require('net');
var http = require('http');

var FW = require('../fw');
var SOURCE = path.join(FW, 'core', 'controller', 'controller.js');
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
require(path.join(FW, '..', '..', 'utils', 'prototypes'));
setPath('gina', { core: path.join(FW, 'core') });
var SuperController = require(SOURCE);

function countOf(text, needle) {
    var n = 0, i = text.indexOf(needle);
    while (i > -1) { n++; i = text.indexOf(needle, i + needle.length); }
    return n;
}

describe('01 - #B404 source pins: the fluent delivery adapter guards the single-argument error delivery', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');
    // #B475 — the two per-transport facades collapsed into ONE constructor-scope
    // adapter behind the per-call handle; the pins now target that adapter.
    var DEF = 'var _fluentDelivery = function(cb) {';

    it('the error-delivery wrap exists in the adapter, distinct from its siblings', function() {
        assert.equal(countOf(src, '_ownAsyncCbRejection(cb(err))'), 1,
            'the guard delivery, one adapter for both transports');
        // needle-distinctness control (can-fail): the 2-arg sibling still reads 1 —
        // were the guard needle a substring of it, the census above would read 2.
        assert.equal(countOf(src, '_ownAsyncCbRejection(cb(err, data))'), 1,
            'control: the success-branch needle stays distinct and untouched');
    });

    it('the guard sits inside the adapter sync-guard try, before the data.status dispatch', function() {
        assert.equal(countOf(src, DEF), 1, 'expected exactly one fluent delivery adapter');
        var at  = src.indexOf(DEF);
        var end = src.indexOf('while catching back.', at);
        assert.ok(end > at, 'the adapter must close with its own catch marker');
        var block = src.slice(at, end);
        var tryAt        = block.lastIndexOf('try {'); // the sync-guard try (the string-parse try comes first)
        var guardAt      = block.indexOf("typeof(data) == 'undefined'");
        var cbErrAt      = block.indexOf('_ownAsyncCbRejection(cb(err))');
        var dataStatusAt = block.indexOf('data.status &&');
        assert.ok(tryAt > -1 && guardAt > tryAt, 'the guard opens the sync-guard try');
        assert.ok(cbErrAt > guardAt, 'the delivery sits under the guard');
        assert.ok(dataStatusAt > cbErrAt, 'the legacy data.status dispatch runs only for two-argument deliveries');
        assert.ok(block.indexOf('#B404') > -1, 'the guard is annotated in place');
    });

    it('the host-missing gate delivers through the per-call channel and returns the handle (#B404 by-catch, closed by the #B475 cleanup)', function() {
        var anchor = 'if ( !options.host && !options.hostname ) {';
        assert.equal(countOf(src, anchor), 1, 'the host-missing gate anchor must be unique');
        var block = src.slice(src.indexOf(anchor), src.indexOf(anchor) + 700);
        assert.ok(block.indexOf('needs at least a') > -1, 'control: the sliced block is the host-missing gate');
        assert.ok(block.indexOf('_ownAsyncCbRejection(callback(err))') > -1, 'the error reaches the caller, rejection-owned');
        assert.ok(block.indexOf('return _handle;') > -1, 'the handle comes back');
        var live = block.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
        assert.equal(live.indexOf("self.emit('query#complete'"), -1,
            'no emitter arm: since query() always supplies a callback the #B404 fall-through cannot recur');
    });
});

describe('02 - #B404 behavioral: handle-mode error outcomes reach the app listener', function() {

    // #B475 — the handle is a per-call channel, so the outcome arms below drive a
    // REAL upstream instead of a bare inst.emit: /404 and /502 answer the JSON
    // bodies the former single-argument emits carried, everything else 200 {"ok":true}
    var srv44 = null, port44 = 0;
    before(async function() {
        srv44 = http.createServer(function(q, r) {
            if (q.url === '/404') { r.writeHead(404, { 'content-type': 'application/json' }); return r.end('{"status":404,"error":"Not Found"}'); }
            if (q.url === '/502') { r.writeHead(502, { 'content-type': 'application/json' }); return r.end('{"status":502,"error":"upstream down"}'); }
            r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}');
        });
        await new Promise(function(res) { srv44.listen(0, '127.0.0.1', res); });
        port44 = srv44.address().port;
        setContext('bundle', 'tb44');
        setContext('env', 'dev');
        setContext('gina', {
            ports: { 'http/1.1': { http: {} }, 'http/2.0': { http: {} } },
            config: { envConf: { tb44: { dev: {
                server: { resolvers: [], credentials: {}, protocol: 'http/1.1', scheme: 'http', port: 65531 },
                host: '127.0.0.1', hostname: 'http://127.0.0.1:65531'
            } } } }
        });
    });

    after(function() {
        try { if (typeof srv44.closeAllConnections === 'function') { srv44.closeAllConnections(); } } catch (e) {}
        try { srv44.close(); } catch (e) {}
    });

    function makeInst() {
        var inst = SuperController.createTestInstance({
            req: { url: '/x', method: 'GET', headers: {}, routing: { rule: 'r44', namespace: 'default', param: {} }, params: {}, get: {}, post: {} },
            res: { setHeader: function(){}, end: function(){}, writeHead: function(){}, getHeaders: function(){ return {}; }, statusCode: 200 },
            options: {
                conf: {
                    bundle: 'tb44', encoding: 'utf-8',
                    server: { protocol: 'http/1.1', scheme: 'http',
                              coreConfiguration: { statusCodes: { '404': 'Not Found', '500': 'Internal Server Error', '502': 'Bad Gateway', '503': 'Service Unavailable' }, mime: { json: 'application/json', txt: 'text/plain' } },
                              supportedRequestMethods: { get: 1 } },
                    content: { routing: { r44: {} } }
                },
                rule: 'r44', control: 'act', bundle: 'tb44', controller: '/controllers/t44.js'
            }
        });
        inst.serverInstance = { _cached: new Map(), _cachePath: '/tmp/gina-t44', _cacheIsEnabled: 'false', _http2Sessions: [] };
        var thrown = [];
        inst.throwError = function() {
            var a = arguments[0];
            thrown.push({ msg: String((a && (a.message || a.msg)) || a), status: a && a.status });
        };
        return { inst: inst, thrown: thrown };
    }
    function destroy(h) {
        try { h.inst.serverInstance._cached.forEach(function(v) { if (v && typeof v.destroy === 'function') { v.destroy(); } }); } catch (e) {}
        try { (h.inst.serverInstance._http2Sessions || []).forEach(function(s) { if (s && typeof s.destroy === 'function') { s.destroy(); } }); } catch (e) {}
    }
    function hold(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
    function waitFor(fn, cap) {
        return new Promise(function(resolve, reject) {
            var t0 = Date.now();
            (function poll() {
                if (fn()) { return resolve(); }
                if (Date.now() - t0 > cap) { return reject(new Error('waitFor timeout')); }
                setTimeout(poll, 15);
            })();
        });
    }
    function freePort() {
        return new Promise(function(resolve) {
            var srv = net.createServer();
            srv.listen(0, '127.0.0.1', function() {
                var p = srv.address().port;
                srv.close(function() { resolve(p); });
            });
        });
    }
    function h1Opts(P, p) {
        return { protocol: 'http/1.1', scheme: 'http', host: '127.0.0.1', port: P, path: p || '/x', method: 'GET', requestTimeout: '2s', maxRetry: 0, headers: { 'content-type': 'application/json' } };
    }
    function h2Opts(P) {
        return { protocol: 'http/2.0', scheme: 'http', hostname: 'http://127.0.0.1:' + P, host: '127.0.0.1', port: P, path: '/x', method: 'GET', requestTimeout: '2s', headers: { 'content-type': 'application/json' } };
    }
    function ownMatches(thrown, re) {
        return thrown.filter(function(t) { return re.test(t.msg); });
    }

    it('spy instrument control (can-fail): the throwError spy records when invoked', function() {
        var h = makeInst();
        h.inst.throwError({ message: 'spy-probe', status: 599 });
        assert.equal(h.thrown.length, 1, 'a spy that cannot record would make every ==0 below vacuous');
        assert.equal(h.thrown[0].status, 599);
    });

    it('HTTP/1.1 dead port: the listener receives the callback-form error shape, no framework answer', async function() {
        var P = await freePort();
        var h = makeInst(), got = [];
        var handle = h.inst.query(h1Opts(P), {});
        assert.equal(typeof (handle && handle.onComplete), 'function');
        handle.onComplete(function(err, data) { got.push({ err: err, dataDefined: typeof data !== 'undefined' }); });
        await waitFor(function() { return got.length || h.thrown.length; }, 3000);
        await hold(300);
        assert.equal(got.length, 1, 'pre-fix measured: the listener never fired; the facade catch answered 500');
        assert.equal(got[0].err.status, 500, 'the transport error rides the callback-form shape');
        assert.match(String(got[0].err.error), /ECONNREFUSED/);
        assert.equal(got[0].dataDefined, false, 'the single-argument payload rides the error slot');
        assert.equal(h.thrown.length, 0, 'the app owns the outcome — no facade-catch 500, no misattributing marker');
        destroy(h);
    });

    it('HTTP/2 dead port: the listener receives the typed terminal, no framework answer', async function() {
        var P = await freePort();
        var h = makeInst(), got = [];
        var handle = h.inst.query(h2Opts(P), {});
        handle.onComplete(function(err, data) { got.push({ err: err, dataDefined: typeof data !== 'undefined' }); });
        await waitFor(function() { return got.length || h.thrown.length; }, 3000);
        await hold(300);
        assert.equal(got.length, 1);
        assert.equal(got[0].err.status, 503, 'connection failures map to 503 on the typed path');
        assert.equal(got[0].err.error && got[0].err.error.code, 'ECONNREFUSED', 'the typed error rides the {status, error} wrap');
        assert.equal(got[0].dataDefined, false);
        assert.equal(h.thrown.length, 0);
        destroy(h);
    });

    it('success control: a two-argument delivery still dispatches (false, data) — the guard does not hijack it', async function() {
        var h = makeInst(), got = [];
        var handle = h.inst.query(h1Opts(port44), {});
        handle.onComplete(function(err, data) { got.push([err, data && data.ok, typeof data !== 'undefined']); });
        await waitFor(function() { return got.length || h.thrown.length; }, 3000);
        await hold(50);
        assert.deepStrictEqual(got, [[false, true, true]]);
        assert.equal(ownMatches(h.thrown, /Controller Query Exception/).length, 0);
        destroy(h);
    });

    it('a non-2xx outcome delivered single-argument reaches the listener as the error', async function() {
        var h = makeInst(), got = [];
        var handle = h.inst.query(h1Opts(port44, '/404'), {});
        handle.onComplete(function(err, data) { got.push({ err: err, dataDefined: typeof data !== 'undefined' }); });
        await waitFor(function() { return got.length || h.thrown.length; }, 3000); // the non-2xx body rides the error slot, single-argument
        await hold(50);
        assert.equal(got.length, 1, 'pre-fix measured: the facade crashed on data.status before invoking the listener');
        assert.equal(got[0].err.status, 404);
        assert.equal(got[0].dataDefined, false);
        assert.equal(ownMatches(h.thrown, /Controller Query Exception/).length, 0);
        destroy(h);
    });

    it('a SYNC listener throw on an error delivery is owned by the facade catch — correctly attributed now', async function() {
        var h = makeInst();
        var handle = h.inst.query(h1Opts(port44, '/502'), {});
        handle.onComplete(function() { throw new Error('t44-sync-boom'); });
        await waitFor(function() { return h.thrown.length; }, 3000);
        await hold(50);
        var m = ownMatches(h.thrown, /t44-sync-boom/);
        assert.equal(m.length, 1, 'the app throw must reach throwError exactly once');
        assert.match(m[0].msg, /Controller Query Exception while catching back\./);
        assert.equal(m[0].status, 500);
        destroy(h);
    });

    it('an ASYNC listener rejection on an error delivery is owned by the async guard', async function() {
        var h = makeInst();
        var handle = h.inst.query(h1Opts(port44, '/502'), {});
        handle.onComplete(async function() { throw new Error('t44-async-boom'); });
        await waitFor(function() { return h.thrown.length; }, 3000);
        await hold(50);
        var m = ownMatches(h.thrown, /t44-async-boom/);
        assert.equal(m.length, 1, 'the rejection must reach throwError through the error-delivery wrap');
        assert.match(m[0].msg, /Controller Query Exception on async callback rejection\./);
        assert.equal(m[0].status, 500);
        destroy(h);
    });
});
