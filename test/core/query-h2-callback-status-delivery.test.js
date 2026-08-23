/**
 * #B405 — an HTTP/2 query in CALLBACK mode never delivered a non-5xx error
 * status to the app callback: the dispatch split 5xx → `callback(data)` /
 * everything else → `self.throwError(data)`, so graceful degradation was
 * impossible for e.g. a 404 from an HTTP/2 upstream, and — measured — the
 * documented `util.promisify(self.query)` idiom NEVER SETTLED on any non-5xx
 * status (the `await` hung and its continuation was silently abandoned).
 * HTTP/1.1 has delivered every non-2xx to the callback since its own #Q1
 * change, whose inline comment states the intent verbatim; HTTP/2 emitter
 * mode delivers every non-2xx since #B404. This was the last divergent cell.
 *
 * Fix: the split is retired — every body-announced non-2xx with a known
 * status code now invokes `callback(data)` on both transports (the replaced
 * split is preserved as comments at the site). The 3xx-with-headers redirect
 * replay above the dispatch is untouched.
 */

'use strict';

var assert = require('node:assert');
var { describe, it, before } = require('node:test');
var fs   = require('fs');
var path = require('path');
var http  = require('http');
var http2 = require('http2');
var util  = require('util');

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

describe('01 - #B405 source pins: the h2 callback-mode non-2xx dispatch delivers, never answers', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');
    var ANCHOR = '// Error code handling (non-2xx)';

    it('the dispatch block anchor is unique', function() {
        assert.equal(src.split(ANCHOR).length - 1, 1, 'the h2 callback-mode dispatch comment must be unique');
    });

    it('NO live throwError remains in the dispatch block (comment-stripped, with strip control)', function() {
        var at = src.indexOf(ANCHOR);
        var block = src.slice(at, at + 1400);
        var live = stripLineComments(block);
        assert.equal(live.indexOf('self.throwError(data)'), -1,
            'the framework no longer answers a non-5xx itself — the callback owns the outcome');
        // instrument control (can-fail): the RAW block still carries the retired
        // split as `// replaced:` comments — the strip must be doing real work
        assert.ok(block.indexOf('self.throwError(data)') > -1,
            'control: the replaced split is preserved in comments, so the strip is load-bearing');
        assert.equal(live.indexOf('/^5/.test(data.status)'), -1, 'the 5xx-only split is retired');
        assert.ok(block.indexOf('/^5/.test(data.status)') > -1, 'control: the split survives as a comment');
        assert.ok(block.indexOf('#B405') > -1, 'the change is annotated in place');
        assert.ok(live.indexOf('return _ownAsyncCbRejection(callback(data));') > -1,
            'the merged delivery is live and wrapped');
    });

    it('the 3xx-with-headers redirect replay above the dispatch is untouched', function() {
        var at = src.indexOf(ANCHOR);
        var head = src.slice(at - 900, at);
        var live = stripLineComments(head);
        assert.ok(live.indexOf('local.res.writeHead(data.status, data.headers)') > -1,
            'the redirect replay intercept must stay live upstream of the dispatch');
    });
});

describe('02 - #B405 behavioral: h2 callback mode delivers every body-announced non-2xx', function() {

    before(function() {
        setContext('bundle', 'tb45');
        setContext('env', 'dev');
        setContext('gina', {
            ports: { 'http/1.1': { http: {} }, 'http/2.0': { http: {} } },
            config: { envConf: { tb45: { dev: {
                server: { resolvers: [], credentials: {}, protocol: 'http/1.1', scheme: 'http', port: 65519 },
                host: '127.0.0.1', hostname: 'http://127.0.0.1:65519'
            } } } }
        });
    });

    function makeInst() {
        var inst = SuperController.createTestInstance({
            req: { url: '/x', method: 'GET', headers: {}, routing: { rule: 'r45', namespace: 'default', param: {} }, params: {}, get: {}, post: {} },
            res: { setHeader: function(){}, end: function(){}, writeHead: function(){}, getHeaders: function(){ return {}; }, statusCode: 200 },
            options: {
                conf: {
                    bundle: 'tb45', encoding: 'utf-8',
                    server: { protocol: 'http/1.1', scheme: 'http',
                              coreConfiguration: { statusCodes: { '404': 'Not Found', '418': "I'm a teapot", '500': 'Internal Server Error', '502': 'Bad Gateway', '503': 'Service Unavailable' }, mime: { json: 'application/json', txt: 'text/plain' } },
                              supportedRequestMethods: { get: 1 } },
                    content: { routing: { r45: {} } }
                },
                rule: 'r45', control: 'act', bundle: 'tb45', controller: '/controllers/t45.js'
            }
        });
        inst.serverInstance = { _cached: new Map(), _cachePath: '/tmp/gina-t45', _cacheIsEnabled: 'false', _http2Sessions: [] };
        var thrown = [];
        inst.throwError = function() {
            var a = arguments[0];
            thrown.push({ msg: String((a && (a.message || a.msg || a.error)) || a), status: a && a.status });
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
    // Deterministic teardown (the 41bca5f2d lesson): live HTTP/2 server
    // sessions and h1 keep-alive sockets hold the file's event loop open on
    // node 22 — every subtest green, file not ok. Track sessions, destroy on
    // close, and unref the listener so a straggler can never outlive the run.
    function h2Upstream(status) {
        return new Promise(function(resolve) {
            var sessions = [];
            var srv = http2.createServer(function(req, res) {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ status: status, error: 'upstream says ' + status, message: 'body' }));
            });
            srv.on('session', function(sess) { sessions.push(sess); });
            srv.listen(0, '127.0.0.1', function() {
                srv.unref();
                resolve({ port: srv.address().port, close: function() {
                    sessions.forEach(function(sess) { try { sess.destroy(); } catch (e) {} });
                    try { srv.close(); } catch (e) {}
                } });
            });
        });
    }
    function h1Upstream(status) {
        return new Promise(function(resolve) {
            var srv = http.createServer(function(req, res) {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ status: status, error: 'upstream says ' + status, message: 'body' }));
            });
            srv.listen(0, '127.0.0.1', function() {
                srv.unref();
                resolve({ port: srv.address().port, close: function() {
                    try { srv.closeAllConnections(); } catch (e) {}
                    try { srv.close(); } catch (e) {}
                } });
            });
        });
    }
    function h2Opts(P) {
        return { protocol: 'http/2.0', scheme: 'http', hostname: 'http://127.0.0.1:' + P, host: '127.0.0.1', port: P, path: '/x', method: 'GET', requestTimeout: '2s', headers: { 'content-type': 'application/json' } };
    }
    function h1Opts(P) {
        return { protocol: 'http/1.1', scheme: 'http', host: '127.0.0.1', port: P, path: '/x', method: 'GET', requestTimeout: '2s', maxRetry: 0, headers: { 'content-type': 'application/json' } };
    }
    function ownMatches(thrown, re) {
        return thrown.filter(function(t) { return re.test(t.msg); });
    }

    it('spy instrument control (can-fail): the throwError spy records when invoked', function() {
        var h = makeInst();
        h.inst.throwError({ message: 'spy-probe', status: 599 });
        assert.equal(h.thrown.length, 1);
        assert.equal(h.thrown[0].status, 599);
    });

    it('h2/200 control: success delivers (false, data)', async function() {
        var s = await h2Upstream(200);
        var h = makeInst(), got = [];
        try {
            h.inst.query(h2Opts(s.port), {}, function(err, data) { got.push([err, data && data.status]); });
            await waitFor(function() { return got.length; }, 3000);
            assert.deepStrictEqual(got, [[false, 200]]);
            assert.equal(h.thrown.length, 0);
        } finally { destroy(h); s.close(); }
    });

    it('h2/500 control: the 5xx delivery worked before and after — unchanged', async function() {
        var s = await h2Upstream(500);
        var h = makeInst(), got = [];
        try {
            h.inst.query(h2Opts(s.port), {}, function(err, data) { got.push({ errStatus: err && err.status, hasData: typeof data !== 'undefined' }); });
            await waitFor(function() { return got.length; }, 3000);
            assert.deepStrictEqual(got, [{ errStatus: 500, hasData: false }]);
            assert.equal(h.thrown.length, 0);
        } finally { destroy(h); s.close(); }
    });

    it('h2/404: the callback is invoked with the error body — the framework no longer answers', async function() {
        var s = await h2Upstream(404);
        var h = makeInst(), got = [];
        try {
            h.inst.query(h2Opts(s.port), {}, function(err, data) { got.push({ errStatus: err && err.status, hasData: typeof data !== 'undefined' }); });
            await waitFor(function() { return got.length || h.thrown.length; }, 3000);
            await hold(200);
            assert.deepStrictEqual(got, [{ errStatus: 404, hasData: false }],
                'pre-fix measured: callback invoked ZERO times, framework answered 404 itself');
            assert.equal(h.thrown.length, 0, 'the caller decides — degrade or surface (#Q1 contract)');
        } finally { destroy(h); s.close(); }
    });

    it('h2/418: any non-5xx deliverable status behaves the same — not 404-specific', async function() {
        var s = await h2Upstream(418);
        var h = makeInst(), got = [];
        try {
            h.inst.query(h2Opts(s.port), {}, function(err) { got.push(err && err.status); });
            await waitFor(function() { return got.length || h.thrown.length; }, 3000);
            await hold(200);
            assert.deepStrictEqual(got, [418]);
            assert.equal(h.thrown.length, 0);
        } finally { destroy(h); s.close(); }
    });

    it('promisified h2 query REJECTS on a 4xx — it previously never settled', async function() {
        var s = await h2Upstream(404);
        var h = makeInst();
        try {
            var outcome = await Promise.race([
                util.promisify(h.inst.query)(h2Opts(s.port), {}).then(
                    function() { return { state: 'resolved' }; },
                    function(e) { return { state: 'rejected', status: e && e.status }; }
                ),
                hold(2500).then(function() { return { state: 'NEVER SETTLED (pre-fix measured shape)' }; })
            ]);
            assert.deepStrictEqual(outcome, { state: 'rejected', status: 404 },
                'the documented promisify contract: a non-2xx upstream status rejects the call');
        } finally { destroy(h); s.close(); }
    });

    it('h1/404 parity control: both transports now share one callback contract', async function() {
        var s = await h1Upstream(404);
        var h = makeInst(), got = [];
        try {
            h.inst.query(h1Opts(s.port), {}, function(err, data) { got.push({ errStatus: err && err.status, hasData: typeof data !== 'undefined' }); });
            await waitFor(function() { return got.length; }, 3000);
            assert.deepStrictEqual(got, [{ errStatus: 404, hasData: false }]);
            assert.equal(h.thrown.length, 0);
        } finally { destroy(h); s.close(); }
    });

    it('a SYNC callback throw on the new 4xx delivery is owned by the dispatch catch', async function() {
        var s = await h2Upstream(404);
        var h = makeInst();
        try {
            h.inst.query(h2Opts(s.port), {}, function() { throw new Error('t45-sync-boom'); });
            await waitFor(function() { return h.thrown.length; }, 3000);
            var m = ownMatches(h.thrown, /t45-sync-boom/);
            assert.equal(m.length, 1, 'the app throw must reach throwError exactly once');
            assert.match(m[0].msg, /Controller Query Exception while catching back\./);
        } finally { destroy(h); s.close(); }
    });

    it('an ASYNC callback rejection on the new 4xx delivery is owned by the async guard', async function() {
        var s = await h2Upstream(404);
        var h = makeInst();
        try {
            h.inst.query(h2Opts(s.port), {}, async function() { throw new Error('t45-async-boom'); });
            await waitFor(function() { return h.thrown.length; }, 3000);
            var m = ownMatches(h.thrown, /t45-async-boom/);
            assert.equal(m.length, 1);
            assert.match(m[0].msg, /Controller Query Exception on async callback rejection\./);
        } finally { destroy(h); s.close(); }
    });
});
