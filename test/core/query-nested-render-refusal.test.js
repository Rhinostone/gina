/**
 * #B479 — `self.query()` issued while the controller is rendering from another
 * required controller (`local.options.renderingStack` deeper than one frame:
 * `requireController` hands the required controller the caller's own options
 * object, so both push onto ONE array and it never shrinks) returned the
 * literal `false` and delivered NOTHING: the callback form never fired, and the
 * fluent form handed the chain a boolean so `query(...).onComplete(cb)` threw
 * `TypeError`. The per-call channel (#B475) was minted at the top of query()
 * and discarded by the guard — the one exit in query() that contradicted the
 * documented "the handle comes back on every path".
 * A refused query now settles like every other synchronous failure: a coded
 * `Error` (`code: NESTED_RENDER`) reaches the per-call channel — next tick for
 * the fluent form, in-line for the callback form — both owners (#B399 async
 * rejection, #B402 sync throw) wrap the delivery, the handle comes back, and
 * the upstream is never contacted. The guard itself is unchanged: a nested
 * frame still cannot fire a request whose result the render guards would refuse.
 * Every arm in 01 was RED on the pre-fix bytes (readings in the assertion
 * messages); the depth-0 / depth-1 arms are the controls that stay green on
 * both sides. Pickup: bundle restart (controller.js is server-side).
 */

'use strict';

var assert = require('node:assert');
var { describe, it, before, after } = require('node:test');
var fs    = require('fs');
var os    = require('os');
var path  = require('path');
var http  = require('http');

var FW = require('../fw');
var SOURCE = path.join(FW, 'core', 'controller', 'controller.js');
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
require(path.join(FW, '..', '..', 'utils', 'prototypes'));
setPath('gina', { core: path.join(FW, 'core') });
var SuperController = require(SOURCE);

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b479-'));

// `stack` is what setOptions preserves as `local.options.renderingStack`
// (controller.js:642 keeps a truthy array); undefined → the framework's `[]`
function makeInst(shared, stack) {
    var options = {
        conf: {
            bundle: 'tb479', encoding: 'utf-8',
            server: { protocol: 'http/1.1', scheme: 'http',
                      coreConfiguration: { statusCodes: { '404': 'Not Found', '500': 'Internal Server Error', '502': 'Bad Gateway', '503': 'Service Unavailable' }, mime: { json: 'application/json' } },
                      supportedRequestMethods: { get: 1 } },
            content: { routing: { r479: {} } }
        },
        rule: 'r479', control: 'act', bundle: 'tb479', controller: '/controllers/t479.js'
    };
    if (stack) { options.renderingStack = stack; }
    var inst = SuperController.createTestInstance({
        req: { url: '/x', method: 'GET', headers: {}, session: {}, routing: { rule: 'r479', namespace: 'default', param: {} }, params: {}, get: {}, post: {}, files: [] },
        res: { setHeader: function(){}, end: function(){}, writeHead: function(){}, getHeaders: function(){ return {}; }, statusCode: 200 },
        options: options
    });
    inst.serverInstance = shared;
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
// the upstream COUNTS what reaches it: a refused query must leave the counter untouched
function h1Server() {
    return new Promise(function(resolve) {
        var srv = http.createServer(function(q, r) {
            srv._hits++;
            setTimeout(function() { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ echo: q.url })); }, 30);
        });
        srv._hits = 0;
        srv.listen(0, '127.0.0.1', function() { resolve(srv); });
    });
}
function closeServer(srv) {
    try { if (typeof srv.closeAllConnections === 'function') { srv.closeAllConnections(); } } catch (e) {}
    srv.close();
}
function o1(port, p) { return { protocol: 'http/1.1', scheme: 'http', hostname: '127.0.0.1', host: '127.0.0.1', port: port, path: p, method: 'GET', requestTimeout: '2s', headers: { 'content-type': 'application/json' } }; }
function qrec(name, sink) { return function(err, data) { sink.push({ cb: name, err: err ? (err.status || String(err.message || err)) : false, echo: data && data.echo }); }; }

before(function() {
    setContext('bundle', 'tb479');
    setContext('env', 'dev');
    setContext('gina', {
        ports: { 'http/1.1': { http: {} }, 'http/2.0': { http: {} } },
        config: { envConf: { tb479: { dev: {
            server: { resolvers: [], credentials: {}, protocol: 'http/1.1', scheme: 'http', port: 65531 },
            host: '127.0.0.1', hostname: 'http://127.0.0.1:65531'
        } } } }
    });
});
after(function() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });

describe('01 - #B479: query() while rendering from another required controller settles the call', function() {
    var srv, port, shared;
    before(async function() { srv = await h1Server(); port = srv.address().port; shared = { _cached: new Map(), _cachePath: path.join(TMP, 'cache'), _cacheIsEnabled: 'false', _http2Sessions: [] }; });
    after(function() { destroyShared(shared); closeServer(srv); });

    it('fluent form at depth 2: query() returns a CHAINABLE handle and delivers the coded refusal on the next tick; the upstream is never contacted', async function() {
        var inst = makeInst(shared, ['outer', 'required']), got = [], hits0 = srv._hits;
        var ret = inst.query(o1(port, '/nested'), {});
        assert.equal(typeof (ret && ret.onComplete), 'function',
            'pre-fix measured: query() returned the literal false and the documented chain threw TypeError: onComplete is not a function');
        assert.strictEqual(ret.onComplete(function(err, data) { got.push({ err: err, dataDefined: typeof data !== 'undefined' }); }), ret, 'the handle is chainable');
        assert.equal(got.length, 0, 'delivery of a synchronous refusal waits for the chained registration (next tick)');
        await hold(20);
        assert.equal(got.length, 1, 'pre-fix: nothing was ever delivered');
        assert.equal(got[0].err.status, 500, 'a native Error rides the {status, error} wrap the fluent form uses for pre-transport failures');
        assert.ok(got[0].err.error instanceof Error, 'the wrapped error is the minted Error');
        assert.equal(got[0].err.error.code, 'NESTED_RENDER');
        assert.match(String(got[0].err.error.message), /rendering from another required controller/);
        assert.equal(got[0].dataDefined, false);
        await hold(30);
        assert.equal(got.length, 1, 'exactly one delivery, never a second');
        assert.equal(srv._hits - hits0, 0, 'a refused query makes no upstream request');
        assert.equal(inst._thrown.length, 0, 'no framework throwError on a consumed refusal');
        assert.equal(inst.listenerCount('query#complete'), 0, 'nothing is left on the instance emitter');
    });

    it('callback form at depth 2: the callback fires exactly once, in-line, with the bare coded Error; query() returns undefined; no upstream request', async function() {
        var inst = makeInst(shared, ['outer', 'required']), calls = [], hits0 = srv._hits;
        var ret = inst.query(o1(port, '/nested'), {}, function(err, data) { calls.push({ err: err, data: data }); });
        assert.strictEqual(ret, undefined, "pre-fix measured: the literal false came back (the callback form's documented return is undefined)");
        assert.equal(calls.length, 1, 'pre-fix measured: the callback was never invoked (still 0 after 400 ms)');
        await hold(30);
        assert.equal(calls.length, 1, 'exactly one delivery, never a second');
        assert.ok(calls[0].err instanceof Error, 'the callback form hands over the bare Error, as the host-missing refusal does');
        assert.equal(calls[0].err.code, 'NESTED_RENDER');
        assert.match(calls[0].err.message, /renderingStack depth 2/);
        assert.strictEqual(calls[0].data, undefined);
        assert.equal(srv._hits - hits0, 0, 'a refused query makes no upstream request');
        assert.equal(inst._thrown.length, 0);
        assert.equal(inst.listenerCount('query#complete'), 0);
    });

    it('.onComplete registered AFTER the refusal settled still fires, with the refusal', async function() {
        var inst = makeInst(shared, ['outer', 'required']), got = [];
        var ret = inst.query(o1(port, '/nested'), {});
        await hold(20); // the one-tick fallback has already run
        assert.equal(typeof (ret && ret.onComplete), 'function', 'pre-fix: the literal false');
        ret.onComplete(function(err) { got.push(err); });
        assert.equal(got.length, 0, 'late delivery is asynchronous');
        await hold(20);
        assert.equal(got.length, 1, 'a late registration receives the settled refusal');
        assert.equal(got[0].error.code, 'NESTED_RENDER');
    });

    it('a discarded fluent handle emits query#complete with the coded refusal for a direct listener (the documented "if omitted, emits" fallback)', async function() {
        var inst = makeInst(shared, ['outer', 'required']), got = [];
        inst.once('query#complete', function(err, data) { got.push({ err: err, dataDefined: typeof data !== 'undefined' }); });
        var ret = inst.query(o1(port, '/nested'), {}); // handle discarded on purpose
        assert.notStrictEqual(ret, false, 'pre-fix: the literal false');
        await hold(20);
        assert.equal(got.length, 1, 'pre-fix: the guard returned before any delivery, so the fallback never fired');
        assert.ok(got[0].err instanceof Error);
        assert.equal(got[0].err.code, 'NESTED_RENDER');
        assert.equal(got[0].dataDefined, false);
    });

    it('an async callback that rejects is owned at the refusal site (#B399): throwError receives the async-rejection marker', async function() {
        var inst = makeInst(shared, ['outer', 'required']);
        inst.query(o1(port, '/nested'), {}, async function(err) { throw new Error('app-bug-async-' + err.code); });
        await hold(30);
        var owned = inst._thrown.filter(function(t) { return /on async callback rejection/.test(t.msg); });
        assert.equal(owned.length, 1, 'pre-fix: the callback never ran, so nothing could reject');
        assert.equal(owned[0].status, 500);
        assert.match(owned[0].msg, /app-bug-async-NESTED_RENDER/);
    });

    it('a sync throw inside the callback is owned at the refusal site (#B402): query() returns normally and throwError receives the transport-error-throw marker', async function() {
        var inst = makeInst(shared, ['outer', 'required']), ret;
        assert.doesNotThrow(function() { ret = inst.query(o1(port, '/nested'), {}, function(err) { throw new Error('app-bug-sync-' + err.code); }); });
        assert.strictEqual(ret, undefined, 'pre-fix: the literal false');
        var owned = inst._thrown.filter(function(t) { return /on transport-error callback throw/.test(t.msg); });
        assert.equal(owned.length, 1, 'pre-fix: the callback never ran');
        assert.equal(owned[0].status, 500);
        assert.match(owned[0].msg, /app-bug-sync-NESTED_RENDER/);
    });

    it('depth 1 (control, green on both sides): the query proceeds to the upstream and echoes', async function() {
        var inst = makeInst(shared, ['outer']), got = [], hits0 = srv._hits;
        inst.query(o1(port, '/depth1'), {}).onComplete(qrec('cb', got));
        await waitFor(function() { return got.length >= 1; }, 3000);
        assert.deepStrictEqual(got, [{ cb: 'cb', err: false, echo: '/depth1' }]);
        assert.equal(srv._hits - hits0, 1, 'the guard is depth-keyed: one frame lets the request through');
    });

    it('depth 0 (control, green on both sides): same, callback form', async function() {
        var inst = makeInst(shared, undefined), got = [], hits0 = srv._hits;
        inst.query(o1(port, '/depth0'), {}, qrec('cb', got));
        await waitFor(function() { return got.length >= 1; }, 3000);
        assert.deepStrictEqual(got, [{ cb: 'cb', err: false, echo: '/depth0' }]);
        assert.equal(srv._hits - hits0, 1);
    });
});

describe('02 - #B479 source pins: the refusal is a delivery, not a boolean', function() {
    var src = fs.readFileSync(SOURCE, 'utf8');
    // line-filter idiom + trailing-comment strip: the negatives must read CODE only
    function stripComments(s) {
        return s.split('\n')
            .filter(function(l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); })
            .map(function(l) { return l.replace(/\/\/.*$/, ''); })
            .join('\n');
    }
    var qStart = src.indexOf('this.query = function(options, data, callback)');
    var qEnd   = src.indexOf('self.isProcessingError = false;', qStart);
    var raw    = (qStart > -1 && qEnd > qStart) ? src.slice(qStart, qEnd) : '';
    var code   = stripComments(raw);
    var GUARD  = '&& local.options.renderingStack.length > 1';

    it('anchors resolve and the guard survives in code (premise, green on both sides)', function() {
        assert.ok(qStart > -1 && qEnd > qStart, 'the head of query() was not found');
        assert.equal(code.split(GUARD).length - 1, 1, 'exactly one renderingStack guard in the head of query()');
    });

    it('the guard block delivers through the per-call channel under both owners, then returns the handle — in that order', function() {
        var g = code.indexOf(GUARD);
        var d = code.indexOf('_ownAsyncCbRejection(callback(err))', g);
        var c = code.indexOf('catch (_syncCbErr)', g);
        var o = code.indexOf('_ownSyncCbThrow(_syncCbErr);', g);
        var r = code.indexOf('return _handle;', g);
        assert.ok(d > g, 'pre-fix: no delivery inside the guard block');
        assert.ok(c > d && o > c, 'the sync-throw owner wraps the delivery');
        assert.ok(r > o, 'the handle is returned after the delivery');
    });

    it('the coded Error is minted inside the guard block, before the delivery, and the literal appears once in the head', function() {
        var g = code.indexOf(GUARD);
        var e = code.indexOf("err.code = 'NESTED_RENDER';", g);
        var d = code.indexOf('_ownAsyncCbRejection(callback(err))', g);
        assert.ok(e > g && d > e, 'pre-fix: no code assignment');
        assert.equal(code.split("'NESTED_RENDER'").length - 1, 1);
    });

    it('the literal boolean exit is gone from the head of query() (comment-stripped, with anti-vacuity)', function() {
        assert.ok(code.indexOf(GUARD) > -1, 'stripping emptied the region — the pin would pass vacuously');
        assert.equal(code.indexOf('return false'), -1, 'pre-fix: `return false` at the guard');
    });

    it('no emitter fallback was added to the block (control, green on both sides): post-#B475 the callback is always a function here', function() {
        var g = code.indexOf(GUARD);
        assert.equal(code.indexOf("self.emit('query#complete'", g), -1, 'no dead emitter branch between the guard and isProcessingError');
    });
});
