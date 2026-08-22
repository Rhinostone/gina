/**
 * #B403 — one HTTP/2 transport failure notified TWICE: the stream-level
 * delivery handed the app callback (or `query#complete` listener) the typed
 * error, while the SESSION 'error' handler independently answered the request
 * through `self.throwError(error)` — racing a callback that handles the error
 * gracefully (degraded mode: the framework 500 could reach the wire before
 * the app's own response), and on a REUSED session doing so with the CREATING
 * query's closure (`local`/`req` of a different request — listeners attach
 * only on fresh connect; the cache-hit path never re-binds them).
 *
 * Fix: the session-level answer is RETIRED (commented out in place). Every
 * live stream on a failing session self-delivers through its own handlers
 * (request 'error' / 'close' / 'end' typed terminals — runtime-measured: the
 * pending stream received its own typed ECONNREFUSED delivery in the same
 * failure), so the session handler keeps cleanup + logging only. HTTP/1.1
 * always notified once; HTTP/2 now matches.
 */

'use strict';

var assert = require('node:assert');
var { describe, it, before } = require('node:test');
var fs   = require('fs');
var path = require('path');
var net  = require('net');

var FW = require('../fw');
var SOURCE = path.join(FW, 'core', 'controller', 'controller.js');
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
require(path.join(FW, '..', '..', 'utils', 'prototypes'));
setPath('gina', { core: path.join(FW, 'core') });
var SuperController = require(SOURCE);

function stripLineComments(text) {
    return text.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
}

describe('01 - #B403 source pins: the session error handler no longer answers the request', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');
    var hStart = src.indexOf("client.on('error'");
    var hEnd   = src.indexOf("client.on('close'", hStart);
    var handler = src.slice(hStart, hEnd);

    it('handler block anchors resolve', function() {
        assert.ok(hStart > -1 && hEnd > hStart, 'the session error handler block must exist before the close handler');
    });

    it('NO live self.throwError remains in the session error handler (comment-stripped)', function() {
        var live = stripLineComments(handler);
        assert.equal(live.indexOf('self.throwError('), -1,
            'the session-level answer is retired — request notification belongs to the stream-level deliveries');
        // instrument control (can-fail): the RAW block still carries the
        // retired call as a comment — the strip must be doing real work
        assert.ok(handler.indexOf('self.throwError(') > -1,
            'control: the commented-out retirement is present, so the strip is load-bearing');
        assert.ok(handler.indexOf('#B403') > -1, 'the retirement is annotated in place');
    });

    it('session CLEANUP stays live in the handler', function() {
        var live = stripLineComments(handler);
        assert.ok(live.indexOf('cache.delete(sessKey)') > -1, 'session cache eviction must survive');
        assert.ok(live.indexOf('_http2Sessions') > -1, 'session-key tracker cleanup must survive');
        assert.ok(live.indexOf('clearInterval(_pingInterval)') > -1, 'keepalive teardown must survive');
    });

    it('the stream-level typed delivery still owns notification (live)', function() {
        var live = stripLineComments(src);
        assert.ok(live.indexOf('_ownAsyncCbRejection(callback(_ginaErr))') > -1,
            'the request-error typed delivery is the owning path');
    });
});

describe('02 - #B403 behavioral: one HTTP/2 transport failure notifies exactly once', function() {

    before(function() {
        setContext('bundle', 'tb43');
        setContext('env', 'dev');
        setContext('gina', {
            ports: { 'http/1.1': { http: {} }, 'http/2.0': { http: {} } },
            config: { envConf: { tb43: { dev: {
                server: { resolvers: [], credentials: {}, protocol: 'http/1.1', scheme: 'http', port: 65529 },
                host: '127.0.0.1', hostname: 'http://127.0.0.1:65529'
            } } } }
        });
    });

    function makeInst() {
        var inst = SuperController.createTestInstance({
            req: { url: '/x', method: 'GET', headers: {}, routing: { rule: 'r43', namespace: 'default', param: {} }, params: {}, get: {}, post: {} },
            res: { setHeader: function(){}, end: function(){}, writeHead: function(){}, getHeaders: function(){ return {}; }, statusCode: 200 },
            options: {
                conf: {
                    bundle: 'tb43', encoding: 'utf-8',
                    server: { protocol: 'http/1.1', scheme: 'http',
                              coreConfiguration: { statusCodes: { '500': 'Internal Server Error', '503': 'Service Unavailable' }, mime: { json: 'application/json', txt: 'text/plain' } },
                              supportedRequestMethods: { get: 1 } },
                    content: { routing: { r43: {} } }
                },
                rule: 'r43', control: 'act', bundle: 'tb43', controller: '/controllers/t43.js'
            }
        });
        inst.serverInstance = { _cached: new Map(), _cachePath: '/tmp/gina-t43', _cacheIsEnabled: 'false', _http2Sessions: [] };
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
    function h2Opts(P) {
        return { protocol: 'http/2.0', scheme: 'http', hostname: 'http://127.0.0.1:' + P, host: '127.0.0.1', port: P, path: '/x', method: 'GET', requestTimeout: '2s', headers: { 'content-type': 'application/json' } };
    }

    it('spy instrument control (can-fail): the throwError spy records when invoked', function() {
        var h = makeInst();
        h.inst.throwError({ message: 'spy-probe', status: 599 });
        assert.equal(h.thrown.length, 1, 'a spy that cannot record would make every ==0 below vacuous');
        assert.equal(h.thrown[0].status, 599);
    });

    it('callback mode: dead-port failure → typed error to the callback ONCE, ZERO framework throwError (grace window held)', async function() {
        var P = await freePort();
        var h = makeInst(), got = [];
        h.inst.query(h2Opts(P), {}, function(err) { got.push(err && { code: err.code, status: err.status }); });
        await waitFor(function() { return got.length; }, 3000);
        await hold(500); // the session error lands in the same tick pre-fix — hold for a late second notify
        assert.equal(got.length, 1, 'the app callback is notified exactly once');
        assert.equal(got[0].code, 'ECONNREFUSED');
        assert.equal(got[0].status, 503);
        assert.equal(h.thrown.length, 0,
            'pre-fix measured: the session handler issued its own throwError for the SAME failure');
        destroy(h);
    });

    it('emitter mode: the session-level answer is retired — no session-native throwError entry (listener delivery itself is #B404, out of scope)', async function() {
        // #B404 (staked from this arm's first run): the single-argument
        // error-path emits crash BOTH onComplete facades' (err, data) dispatch
        // on `data.status` (data is undefined) → the facade's own sync catch
        // answers 500 and the app listener never fires — a PRE-EXISTING defect
        // on both transports, byte-independent of #B403. So this arm asserts
        // only what #B403 owns: whatever throwError activity remains must be a
        // framework-guard shape (marked), never the session handler's native
        // connection error. Green today (one facade-catch entry) and green
        // after a #B404 fix (zero entries) — red pre-#B403 (the native entry).
        var P = await freePort();
        var h = makeInst();
        var handle = h.inst.query(h2Opts(P), {});
        assert.equal(typeof (handle && handle.onComplete), 'function');
        handle.onComplete(function() {});
        await waitFor(function() { return h.thrown.length; }, 3000);
        await hold(500);
        var native = h.thrown.filter(function(t) { return !/Controller Query Exception/.test(t.msg); });
        assert.deepStrictEqual(native, [],
            'pre-fix the session handler pushed the raw connection error as its own request answer');
        destroy(h);
    });

    it('HTTP/1.1 parity control: the h1 path notified once before and after — unchanged', async function() {
        var P = await freePort();
        var h = makeInst(), got = [];
        h.inst.query({ protocol: 'http/1.1', scheme: 'http', host: '127.0.0.1', port: P, path: '/x', method: 'GET', requestTimeout: '2s', maxRetry: 0, headers: { 'content-type': 'application/json' } }, {}, function(err) { got.push(err && err.code); });
        await waitFor(function() { return got.length; }, 3000);
        await hold(300);
        assert.deepStrictEqual(got, ['ECONNREFUSED']);
        assert.equal(h.thrown.length, 0);
        destroy(h);
    });
});
