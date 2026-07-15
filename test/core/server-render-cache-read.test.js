/**
 * core/server.js — the render/output-cache redis L2 READ path (#RC4, design f).
 *
 * `handle()` gained an engine-agnostic read that runs AFTER route matching and
 * BEFORE both dispatch paths: `if ( await tryServeRenderCacheHit(req, res, bundle) )
 * return;`. It is tightly gated (GET + a route that opts into caching + resolving to
 * the redis strategy + the cache enabled + an L2 store wired) so an uncached GET pays
 * nothing. On a hit it serves the memory-shaped entry (redis L1/L2 entries are always
 * `fromMemory` — never an fs filename) via `serveRenderCacheHit`, mirroring
 * server.isaac.js's cache-hit serve + render-json's HTTP/2 respond.
 *
 * §01 pins the source structure (the module-scope instance, the two closures, the
 * read call site, every gate, the F3 `_rcType` parity, the F6 dead/committed guard,
 * the F8 log ttl). §02 is a behavioural replica of the exact tryServe→serve control
 * flow driven by a fake renderCache + fake req/res: L1 hit serves WITHOUT a warm, an
 * L1 miss warms L2 then serves, both kinds are probed, HTTP/2 vs HTTP/1.1 write shapes,
 * the B2/F6 dead-response abandon, and SUBTRACTs proving an uncached / non-redis /
 * disabled route pays nothing (no warm, no serve).
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW         = require('../fw');
var SERVER_SRC = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');


describe('01 - core/server.js — read-path source pins (#RC4)', function() {

    it('declares ONE module-scope RenderCache instance (gen-0, survives refreshCore)', function() {
        assert.match(SERVER_SRC, /var\s+renderCache\s*=\s*new\s+lib\.RenderCache\(\)\s*;/);
    });

    it('defines serveRenderCacheHit(req, res, hit) and tryServeRenderCacheHit(req, res, bundle)', function() {
        assert.match(SERVER_SRC, /var\s+serveRenderCacheHit\s*=\s*function\s*\(\s*req\s*,\s*res\s*,\s*hit\s*\)/);
        assert.match(SERVER_SRC, /var\s+tryServeRenderCacheHit\s*=\s*async\s+function\s*\(\s*req\s*,\s*res\s*,\s*bundle\s*\)/);
    });

    it('calls the read inside `if (matched)`, before both dispatch paths', function() {
        var matchedAt = SERVER_SRC.indexOf('if (matched) {');
        assert.ok(matchedAt > -1);
        var readAt = SERVER_SRC.indexOf('if ( await tryServeRenderCacheHit(req, res, bundle) ) {', matchedAt);
        assert.ok(readAt > matchedAt, 'read call is inside the matched branch');
        // …and BEFORE the express-middleware dispatch + router.route.
        var mwAt    = SERVER_SRC.indexOf("_expressMiddlewares.length > 0", matchedAt);
        var routeAt = SERVER_SRC.indexOf('router.route(req, res, next, req.routing)', matchedAt);
        assert.ok(readAt < mwAt,    'read runs before the express-middleware chain');
        assert.ok(readAt < routeAt, 'read runs before router.route');
    });

    // --- the tryServe gates (an uncached GET pays nothing) ---
    var tStart = SERVER_SRC.indexOf('var tryServeRenderCacheHit');
    var tEnd   = SERVER_SRC.indexOf('// #M12b', tStart); // the next function after tryServe/serve
    var tryBlock = SERVER_SRC.slice(tStart, tEnd > tStart ? tEnd : tStart + 4000);

    it('gates on GET method (isaac ":method" pseudo-header aware)', function() {
        assert.match(tryBlock, /if\s*\(\s*!\/\^get\$\/i\.test\(\s*_method\s*\|\|\s*req\.method\s*\|\|\s*''\s*\)\s*\)\s*\{\s*return false;/);
    });

    it('gates on a route that opts into caching (req.routing.cache)', function() {
        assert.match(tryBlock, /if\s*\(\s*!req\.routing\s*\|\|\s*!req\.routing\.cache\s*\)\s*\{\s*return false;/);
    });

    it('gates on the cache being enabled (_cacheIsEnabled === "true")', function() {
        assert.match(tryBlock, /String\(self\.instance\._cacheIsEnabled\)\.toLowerCase\(\)\s*!==\s*'true'/);
    });

    it('gates on an L2 store being wired (process.gina._renderCacheStore)', function() {
        assert.match(tryBlock, /if\s*\(\s*!\(\s*process\.gina\s*&&\s*process\.gina\._renderCacheStore\s*\)\s*\)\s*\{\s*return false;/);
    });

    it('F3: only inherits the bundle-wide type when the route OMITS type (typeof !== undefined)', function() {
        assert.match(tryBlock, /typeof\(_rc\.type\)\s*!==\s*'undefined'/);
        assert.match(tryBlock, /if\s*\(\s*!\/\^redis\$\/i\.test\(_rcType\s*\|\|\s*''\)\s*\)\s*\{\s*return false;/);
    });

    it('reads with req.originalUrl (delegate write-key parity) and probes both kinds', function() {
        assert.match(tryBlock, /var\s+_url\s*=\s*req\.originalUrl\s*\|\|\s*req\.url\s*;/);
        assert.match(tryBlock, /var\s+_kinds\s*=\s*\['data',\s*'static'\]/);
    });

    it('tries L1 (has/get) before an L2 warm(), and re-registers invalidateOnEvents on warm', function() {
        var l1At   = tryBlock.indexOf('renderCache.has(_k)');
        var warmAt = tryBlock.indexOf('await renderCache.warm(_k, _events)');
        assert.ok(l1At > -1 && warmAt > -1 && l1At < warmAt, 'L1 has() precedes the L2 warm()');
        assert.match(tryBlock, /var\s+_events\s*=[\s\S]{1,160}invalidateOnEvents/);
    });

    it('points the shared Map via from() before reading (one-Map, #B115-safe)', function() {
        assert.match(tryBlock, /renderCache\.from\(\s*self\.instance\._cached\s*\)\s*;/);
    });

    // --- serveRenderCacheHit shape (F6 guard, HTTP/2 vs 1.1, F8 log) ---
    var sStart = SERVER_SRC.indexOf('var serveRenderCacheHit');
    var sEnd   = SERVER_SRC.indexOf('var tryServeRenderCacheHit', sStart);
    var serveBlock = SERVER_SRC.slice(sStart, sEnd);

    it('F6: the B2 guard abandons on a gone OR already-committed response', function() {
        // HTTP/2 arm: destroyed || headersSent ; HTTP/1.1 arm: writableEnded || destroyed || headersSent
        assert.match(serveBlock, /res\.stream\.destroyed\s*\|\|\s*res\.stream\.headersSent/);
        assert.match(serveBlock, /res\.writableEnded\s*\|\|\s*res\.destroyed\s*\|\|\s*res\.headersSent/);
    });

    it('HTTP/2 folds res.getHeaders() into stream.respond({:status:200}) then end(content)', function() {
        assert.match(serveBlock, /_sh\s*=\s*\{\s*':status':\s*200\s*\}/);
        assert.match(serveBlock, /res\.stream\.respond\(_sh\)/);
        assert.match(serveBlock, /res\.stream\.end\(hit\.content\)/);
    });

    it('HTTP/1.1 serves via res.end(hit.content) behind a headersSent guard', function() {
        assert.match(serveBlock, /if\s*\(\s*!res\.headersSent\s*&&\s*!res\.writableEnded\s*\)\s*\{\s*res\.end\(hit\.content\)/);
    });

    it('F8: the hit log line includes the remaining ttl (Cache-Status parity)', function() {
        assert.match(serveBlock, /\[200\]\[gina-cache;\s*hit'\s*\+\s*\(_remaining\s*!==\s*null\s*\?\s*';\s*ttl='\s*\+\s*_remaining/);
    });
});


describe('02 - read-path control flow — behavioural replica + subtract (#RC4)', function() {

    // A fake renderCache mirroring the real seam the read path uses: from / buildKey /
    // has / get / warm. Records warm() calls so a test can assert an L1 hit serves
    // WITHOUT touching L2.
    function fakeRC(l1, l2) {
        var calls = { warm: [], from: 0 };
        return {
            calls: calls,
            from: function() { calls.from++; return this; },
            buildKey: function(kind, bundle, url) { return kind + ':' + bundle + ':' + url; },
            has: function(k) { return Object.prototype.hasOwnProperty.call(l1, k); },
            get: function(k) { return l1[k]; },
            warm: async function(k, events) {
                calls.warm.push({ key: k, events: events });
                return (k in l2) ? l2[k] : undefined;
            }
        };
    }

    // A fake response for HTTP/1.1 or HTTP/2 that records the write.
    function fakeRes(isH2) {
        var res = {
            headers: {}, headersSent: false, writableEnded: false, destroyed: false,
            body: null,
            setHeader: function(k, v) { this.headers[k] = v; },
            getHeaders: function() { return this.headers; }
        };
        if (isH2) {
            res.stream = { headersSent: false, destroyed: false, respondHeaders: null, body: null,
                respond: function(h) { this.respondHeaders = h; this.headersSent = true; },
                end: function(c) { this.body = c; } };
        } else {
            res.end = function(c) { this.body = c; this.writableEnded = true; this.headersSent = true; };
        }
        return res;
    }

    // Faithful replica of the real handle()-scope tryServe + serve, parameterised by
    // engine + config. Mirrors the source control flow line-for-line.
    function makeReader(opts) {
        var protocol     = opts.protocol || 'http/1.1';
        var cacheEnabled = ('cacheEnabled' in opts) ? opts.cacheEnabled : 'true';
        var store        = ('store' in opts) ? opts.store : {};   // truthy = wired
        var serverCache  = opts.serverCache || {};
        var rc           = opts.rc;

        function serve(req, res, hit) {
            var _isH2 = /http\/2/.test(protocol) && res.stream;
            if ( _isH2
                    ? ( res.stream.destroyed || res.stream.headersSent )
                    : ( res.writableEnded || res.destroyed || res.headersSent ) ) {
                return true;
            }
            var _remaining = null;
            if ( typeof(hit.ttl) === 'number' && hit.ttl > 0 && hit.createdAt ) {
                _remaining = Math.max(0, Math.floor( (hit.createdAt.getTime() + Math.round(hit.ttl * 1000) - Date.now()) / 1000 ));
            }
            var _vis = ( hit.visibility === 'public' ) ? 'public' : 'private';
            if ( hit.responseHeaders ) {
                for (var h in hit.responseHeaders) { res.setHeader(h, hit.responseHeaders[h]); }
            }
            res.setHeader('Cache-Status', 'gina-cache; hit' + (_remaining !== null ? '; ttl=' + _remaining : ''));
            if ( _remaining !== null ) { res.setHeader('Cache-Control', _vis + ', max-age=' + _remaining); }
            if ( _isH2 ) {
                if ( !res.stream.headersSent && !res.stream.destroyed ) {
                    var _sh = { ':status': 200 };
                    var _pending = res.getHeaders ? res.getHeaders() : {};
                    for (var ph in _pending) { _sh[ph] = _pending[ph]; }
                    res.stream.respond(_sh);
                    res.stream.end(hit.content);
                    res.headersSent = true;
                }
            } else {
                if ( !res.headersSent && !res.writableEnded ) { res.end(hit.content); }
            }
            return true;
        }

        return async function tryServe(req, res, bundle) {
            var _method = ( /http\/2/.test(protocol) ) ? req.headers[':method'] : req.method;
            if ( !/^get$/i.test(_method || req.method || '') ) { return false; }
            if ( !req.routing || !req.routing.cache ) { return false; }
            if ( String(cacheEnabled).toLowerCase() !== 'true' ) { return false; }
            if ( !store ) { return false; }

            var _rc = req.routing.cache;
            var _rcType;
            if ( typeof(_rc) === 'string' ) { _rcType = _rc; }
            else if ( _rc && typeof(_rc.type) !== 'undefined' ) { _rcType = _rc.type; }
            else { _rcType = serverCache && serverCache.type; }
            if ( !/^redis$/i.test(_rcType || '') ) { return false; }

            var _events = ( _rc && typeof(_rc) === 'object' && Array.isArray(_rc.invalidateOnEvents) ) ? _rc.invalidateOnEvents : [];
            var _url    = req.originalUrl || req.url;
            rc.from({});

            var _kinds = ['data', 'static'], _hit = null, i, _k;
            for (i = 0; i < _kinds.length; i++) {
                _k = rc.buildKey(_kinds[i], bundle, _url);
                if ( rc.has(_k) ) { _hit = rc.get(_k); if ( _hit ) break; _hit = null; }
            }
            if ( !_hit ) {
                for (i = 0; i < _kinds.length; i++) {
                    _k = rc.buildKey(_kinds[i], bundle, _url);
                    _hit = await rc.warm(_k, _events); if ( _hit ) break; _hit = null;
                }
            }
            if ( !_hit ) { return false; }
            return serve(req, res, _hit);
        };
    }

    function redisReq(extra) {
        return Object.assign({ method: 'GET', headers: {}, routing: { cache: { type: 'redis', invalidateOnEvents: ['post#saved'] } },
                               originalUrl: '/p', url: '/p' }, extra || {});
    }

    it('L1 hit serves WITHOUT a warm (express fast path)', async function() {
        var rc = fakeRC({ 'static:demo:/p': { fromMemory: true, content: 'L1', visibility: 'public' } }, {});
        var tryServe = makeReader({ rc: rc });
        var res = fakeRes(false);
        var served = await tryServe(redisReq(), res, 'demo');
        assert.equal(served, true);
        assert.equal(res.body, 'L1');
        assert.equal(rc.calls.warm.length, 0, 'an L1 hit never touches L2');
        assert.equal(res.headers['Cache-Status'], 'gina-cache; hit');
    });

    it('L1 miss → warm() L2 → serve, re-registering the route events', async function() {
        var rc = fakeRC({}, { 'data:demo:/p': { fromMemory: true, content: 'L2', visibility: 'private' } });
        var tryServe = makeReader({ rc: rc });
        var res = fakeRes(false);
        var served = await tryServe(redisReq(), res, 'demo');
        assert.equal(served, true);
        assert.equal(res.body, 'L2');
        assert.equal(rc.calls.warm.length, 1, 'one warm (data hit — the first kind)');
        assert.deepEqual(rc.calls.warm[0].events, ['post#saved'], 'invalidateOnEvents threaded to warm');
    });

    it('probes BOTH kinds on a data-miss/static-hit', async function() {
        var rc = fakeRC({}, { 'static:demo:/p': { fromMemory: true, content: 'S', visibility: 'public' } });
        var tryServe = makeReader({ rc: rc });
        var res = fakeRes(false);
        await tryServe(redisReq(), res, 'demo');
        assert.equal(res.body, 'S');
        assert.equal(rc.calls.warm.length, 2, 'data warm (miss) then static warm (hit)');
        assert.equal(rc.calls.warm[0].key, 'data:demo:/p');
        assert.equal(rc.calls.warm[1].key, 'static:demo:/p');
    });

    it('HTTP/2 serves via stream.respond({:status:200}) + end(content), folding headers', async function() {
        var rc = fakeRC({ 'static:demo:/p': { fromMemory: true, content: 'H2', visibility: 'public', responseHeaders: { 'x-a': '1' } } }, {});
        var tryServe = makeReader({ protocol: 'http/2', rc: rc });
        var res = fakeRes(true);
        var served = await tryServe(redisReq(), res, 'demo');
        assert.equal(served, true);
        assert.equal(res.stream.body, 'H2');
        assert.equal(res.stream.respondHeaders[':status'], 200);
        assert.equal(res.stream.respondHeaders['x-a'], '1', 'page header folded into the respond');
        assert.equal(res.stream.respondHeaders['Cache-Status'], 'gina-cache; hit');
    });

    it('ttl entry → Cache-Status + Cache-Control carry the remaining ttl', async function() {
        var hit = { fromMemory: true, content: 'T', visibility: 'public', ttl: 60, createdAt: new Date(Date.now() - 10000) };
        var rc = fakeRC({ 'static:demo:/p': hit }, {});
        var tryServe = makeReader({ rc: rc });
        var res = fakeRes(false);
        await tryServe(redisReq(), res, 'demo');
        assert.match(res.headers['Cache-Status'], /gina-cache; hit; ttl=\d+/);
        assert.match(res.headers['Cache-Control'], /public, max-age=\d+/);
    });

    it('F6/B2: a destroyed HTTP/1.1 response is abandoned (return true, no write)', async function() {
        var rc = fakeRC({ 'static:demo:/p': { fromMemory: true, content: 'X', visibility: 'public' } }, {});
        var tryServe = makeReader({ rc: rc });
        var res = fakeRes(false);
        res.destroyed = true;             // client aborted during the warm await
        var served = await tryServe(redisReq(), res, 'demo');
        assert.equal(served, true, 'abandoned = handled (never fall through to a render)');
        assert.equal(res.body, null, 'no write to a dead socket');
    });

    it('F6: an already-committed (headersSent) response is abandoned before the setHeader loop', async function() {
        var rc = fakeRC({ 'static:demo:/p': { fromMemory: true, content: 'X', visibility: 'public', responseHeaders: { 'x': '1' } } }, {});
        var tryServe = makeReader({ rc: rc });
        var res = fakeRes(false);
        res.headersSent = true;
        var served = await tryServe(redisReq(), res, 'demo');
        assert.equal(served, true);
        assert.equal(res.headers['x'], undefined, 'no setHeader after headersSent (no ERR_HTTP_HEADERS_SENT)');
    });

    // --- SUBTRACTs: the gates make an uncached / non-redis / disabled GET pay nothing ---
    it('SUBTRACT — a non-redis (memory) route pays nothing (no warm, false)', async function() {
        var rc = fakeRC({}, { 'static:demo:/p': { fromMemory: true, content: 'M' } });
        var tryServe = makeReader({ rc: rc });
        var res = fakeRes(false);
        var req = redisReq({ routing: { cache: { type: 'memory' } } });
        var served = await tryServe(req, res, 'demo');
        assert.equal(served, false);
        assert.equal(rc.calls.warm.length, 0, 'a memory route never reaches the L2 read');
    });

    it('SUBTRACT — a route with no cache pays nothing', async function() {
        var rc = fakeRC({}, {});
        var tryServe = makeReader({ rc: rc });
        var served = await tryServe(redisReq({ routing: {} }), fakeRes(false), 'demo');
        assert.equal(served, false);
        assert.equal(rc.calls.from, 0, 'never even points the Map for an uncached route');
    });

    it('SUBTRACT — a non-GET (POST) redis route pays nothing', async function() {
        var rc = fakeRC({ 'static:demo:/p': { fromMemory: true, content: 'X' } }, {});
        var tryServe = makeReader({ rc: rc });
        var served = await tryServe(redisReq({ method: 'POST' }), fakeRes(false), 'demo');
        assert.equal(served, false);
    });

    it('SUBTRACT — the cache disabled pays nothing (even a redis route)', async function() {
        var rc = fakeRC({ 'static:demo:/p': { fromMemory: true, content: 'X' } }, {});
        var tryServe = makeReader({ rc: rc, cacheEnabled: 'false' });
        var served = await tryServe(redisReq(), fakeRes(false), 'demo');
        assert.equal(served, false);
    });

    it('SUBTRACT — no L2 store wired pays nothing', async function() {
        var rc = fakeRC({}, {});
        var tryServe = makeReader({ rc: rc, store: null });
        var served = await tryServe(redisReq(), fakeRes(false), 'demo');
        assert.equal(served, false);
    });

    it('F3: a route type:"" (set-but-blank) does NOT inherit a bundle redis default', async function() {
        var rc = fakeRC({ 'static:demo:/p': { fromMemory: true, content: 'X' } }, {});
        var tryServe = makeReader({ rc: rc, serverCache: { type: 'redis' } });
        var req = redisReq({ routing: { cache: { type: '' } } });
        var served = await tryServe(req, fakeRes(false), 'demo');
        assert.equal(served, false, 'blank route type is not-cached (writeCache parity), not inherited-redis');
        assert.equal(rc.calls.warm.length, 0);
    });

    it('a type-less opt-in route inherits the bundle redis default (warms)', async function() {
        var rc = fakeRC({}, { 'data:demo:/p': { fromMemory: true, content: 'INH', visibility: 'private' } });
        var tryServe = makeReader({ rc: rc, serverCache: { type: 'redis' } });
        var req = redisReq({ routing: { cache: {} } });   // opts in, no type → inherit
        var served = await tryServe(req, fakeRes(false), 'demo');
        assert.equal(served, true);
        assert.equal(rc.calls.warm.length, 1);
    });
});
