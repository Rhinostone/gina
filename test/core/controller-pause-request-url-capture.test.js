/**
 * #B219 — pauseRequest() snapshotted `req.url`, which the isaac engine has already
 * stripped of its query string (`server.isaac.js` splits `request.url` on `?` after
 * parsing the query into `request.query`, before handing off to middleware and
 * controllers) — so `haltedRequest.url` was path-only on isaac and the #B215
 * byte-exact replay faithfully replayed a query-less URL. The engine preserves the
 * byte-exact incoming URL on `request.originalUrl` (stamped as the request
 * listener's first statement, before any mutation; the express engine's own
 * `req.originalUrl` is native and its `req.url` keeps the query anyway). Fix:
 * pauseRequest snapshots `req.originalUrl || req.url` — engine-preserved when
 * available, byte-identical fallback for bare/harness requests and both engines'
 * pre-existing behavior everywhere the property is absent.
 *
 * §01 source-pins the fix shape + the isaac stamp-before-strip premise;
 * §02 drives the REAL SuperController with the ENGINE-FAITHFUL request shape
 * (stripped url + full originalUrl — the shape the #B215 harness did not model);
 * §03 goes end-to-end through the REAL matcher + pause + resume, including the
 * in-flight pre-fix-snapshot no-regression pin.
 */
'use strict';
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW      = require('../fw');
var SOURCE  = path.join(FW, 'core/controller/controller.js');
var ISAAC   = path.join(FW, 'core/server.isaac.js');
var EXPRESS = path.join(FW, 'core/server.express.js');


// ---------------------------------------------------------------------------
// 01 — source pins: snapshot source + the engine premise
// ---------------------------------------------------------------------------
describe('01 - #B219 source pins: originalUrl-first snapshot + isaac stamp-before-strip', function() {

    var pauseSlice = null, isaacSrc = null;

    before(function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.pauseRequest = function');
        var end   = src.indexOf('this.resumeRequest', start);
        assert.ok(start > -1 && end > start, 'pauseRequest slice located');
        pauseSlice = src.slice(start, end);
        isaacSrc   = fs.readFileSync(ISAAC, 'utf8');
    });

    it('pauseRequest snapshots the engine-preserved URL first (req.originalUrl || req.url)', function() {
        assert.ok(pauseSlice.indexOf('req.originalUrl || req.url') > -1,
            'the snapshot url source must prefer the byte-exact engine-preserved URL');
    });

    it('engine premise: isaac stamps request.originalUrl BEFORE its query strip', function() {
        var stamp = isaacSrc.indexOf('request.originalUrl = request.url');
        var strip = isaacSrc.indexOf("request.url = request.url.split('?')[0]");
        assert.ok(stamp > -1, 'isaac must preserve the incoming URL on request.originalUrl');
        assert.ok(strip > -1, 'the isaac query strip this fix routes around must exist');
        assert.ok(stamp < strip, 'the preserve must happen before the strip');
    });

    it('control: the express adapter has no query strip (needle validated by the isaac hit)', function() {
        var expressSrc = fs.readFileSync(EXPRESS, 'utf8');
        assert.ok(expressSrc.indexOf(".split('?')") === -1,
            'server.express.js must not strip the query from the request URL');
    });

});


// ---------------------------------------------------------------------------
// 02 — behavioral: the engine-faithful request shape (stripped url + originalUrl)
// ---------------------------------------------------------------------------
describe('02 - #B219 behavioral: the snapshot captures the byte-exact incoming URL', function() {

    // -- §14/§36 harness bootstrap -----------------------------------------
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));                              // _, setPath, setContext, ...
    require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));   // JSON.clone, Object.count()
    process.gina = process.gina || {};
    setPath('gina', { core: path.join(FW, 'core') });

    var SuperController = require(SOURCE);

    var CONF = { bundle: 'test',
                 server: { supportedRequestMethods: { get: {}, post: {} } },
                 content: { routing: {} } };

    // The isaac reality at controller time (measured live, h1 and h2):
    //   req.url         = pathname only (query stripped by the engine)
    //   req.originalUrl = the byte-exact incoming URL, encoding untouched
    function mkEngineReq(pathname, rawQuery, parsedGet) {
        return {
            url         : pathname,
            originalUrl : pathname + (rawQuery ? '?' + rawQuery : ''),
            method      : 'GET',
            headers     : {},
            routing     : { rule: 'orders@test', namespace: 'test', param: {} },
            params      : { 0: pathname },
            get         : JSON.clone(parsedGet || {})
        };
    }
    function makeInstance(req) {
        return SuperController.createTestInstance({
            req     : req,
            res     : { setHeader: function () {}, end: function () {} },
            options : { conf: CONF, rule: 'orders@test', control: 'index' }
        });
    }

    it('engine-shaped request: haltedRequest.url is the FULL incoming URL, query included', function() {
        var req     = mkEngineReq('/widget/42', 'mode=compact&returnTo=%2Fafter', { mode: 'compact', returnTo: '/after' });
        var storage = {};
        makeInstance(req).pauseRequest(JSON.clone(req.get), storage);
        assert.equal(storage.haltedRequest.url, '/widget/42?mode=compact&returnTo=%2Fafter',
            'the snapshot must carry the query the engine stripped from req.url');
    });

    it('byte-exactness: percent-encoding is preserved verbatim (no decode / re-encode)', function() {
        var req     = mkEngineReq('/search', 'q=a%20b&path=%2Fx%2Fy', { q: 'a b', path: '/x/y' });
        var storage = {};
        makeInstance(req).pauseRequest({}, storage);
        assert.equal(storage.haltedRequest.url, '/search?q=a%20b&path=%2Fx%2Fy');
    });

    it('fallback: a request with no originalUrl snapshots req.url (harness / bare shape, unchanged)', function() {
        var req = {
            url: '/orders/42', method: 'GET', headers: {},
            routing: { rule: 'orders@test', namespace: 'test', param: {} },
            params: { 0: '/orders/42' }, get: {}
        };
        var storage = {};
        makeInstance(req).pauseRequest({}, storage);
        assert.equal(storage.haltedRequest.url, '/orders/42');
    });

    it('fallback: a falsy originalUrl (empty string) falls through to req.url', function() {
        var req = mkEngineReq('/orders/42', null, {});
        req.originalUrl = '';
        var storage = {};
        makeInstance(req).pauseRequest({}, storage);
        assert.equal(storage.haltedRequest.url, '/orders/42');
    });

    it('the rest of the snapshot is untouched by the url-source change', function() {
        var req     = mkEngineReq('/widget/42', 'mode=compact', { mode: 'compact' });
        req.params  = { 0: '/widget/42', id: '42', mode: 'compact' };
        var storage = {};
        makeInstance(req).pauseRequest({ mode: 'compact' }, storage);
        assert.equal(storage.haltedRequest.method, 'get');
        assert.deepEqual(storage.haltedRequest.data, { mode: 'compact' });
        assert.deepEqual(storage.haltedRequest.params, { id: '42', mode: 'compact' });
    });

});


// ---------------------------------------------------------------------------
// 03 — end-to-end: engine-shaped pause → resume replays the full URL
// ---------------------------------------------------------------------------
describe('03 - #B219 end-to-end: the replay redirect carries the engine-preserved URL', function() {

    var SuperController = require(SOURCE);

    var TABLE = {
        'widget-c@test': { url: '/widgetc/:id', method: 'GET', bundle: 'test', namespace: 'test',
            requirements: { id: '/^[0-9]+$/' },
            param: { control: 'widgetOpen', file: 'includes/widgetc-:mode', id: ':id', mode: ':mode' } }
    };

    setContext('isProxyHost', false);
    setContext('gina', { config: {
        env: 'dev', bundle: 'test', envConf: {},
        getRouting: function () { return TABLE; }
    } });

    var routingLib = require(path.join(FW, 'lib/routing/src/main.js'));

    var CONF = { bundle: 'test',
                 server: { supportedRequestMethods: { get: {}, post: {} } },
                 content: { routing: TABLE } };

    function resumeFrom(storage, opts) {
        opts = opts || {};
        var resumeReq = {
            url: '/login', originalUrl: '/login?complete=1', method: 'GET', headers: {},
            routing: { rule: 'login@test', namespace: 'test', param: {} },
            params: { 0: '/login' }, get: { complete: '1' },
            session: storage
        };
        var captured = { redirect: null, json: null };
        var inst = SuperController.createTestInstance({
            req: resumeReq, res: { setHeader: function () {}, end: function () {}, headersSent: false },
            options: { conf: CONF, rule: 'login@test', control: 'login', isXMLRequest: !!opts.xhr }
        });
        inst.redirect   = function (u, ignoreWebRoot) { captured.redirect = { url: u, ignoreWebRoot: ignoreWebRoot }; };
        inst.renderJSON = function (payload) { captured.json = payload; };
        inst.resumeRequest();
        captured.storage = storage;
        return captured;
    }

    it('engine-shaped halt: the replay redirect and the recorded URL are the byte-exact original', async function() {
        // Real matcher first — the engine-faithful request must still match the rule.
        var req = {
            url: '/widgetc/42', originalUrl: '/widgetc/42?mode=compact&returnTo=%2Fafter',
            method: 'GET', headers: {}, routing: {},
            params: { 0: '/widgetc/42' }, get: { mode: 'compact', returnTo: '/after' }
        };
        var params = {
            method: 'GET', control: 'widgetOpen', requirements: TABLE['widget-c@test'].requirements,
            namespace: 'test', url: '/widgetc/42', rule: 'widget-c@test',
            cache: null, queryTimeout: null, csrfExempt: false, culturePrefix: false, negotiate: false,
            param: JSON.clone(TABLE['widget-c@test'].param), middleware: [], bundle: 'test',
            isXMLRequest: false, isWithCredentials: false
        };
        var found = await routingLib.compareUrls(params, TABLE['widget-c@test'].url, req, {}, function () {});
        assert.equal(found.past, true, 'precondition: the engine-shaped request matches');

        req.session = {};
        var pauseInst = SuperController.createTestInstance({
            req: req, res: { setHeader: function () {}, end: function () {} },
            options: { conf: CONF, rule: 'widget-c@test', control: 'widgetOpen' }
        });
        var storage = pauseInst.pauseRequest(JSON.clone(req.get));

        var out = resumeFrom(storage);
        assert.ok(out.redirect, 'GET replay redirects');
        assert.equal(out.redirect.url, '/widgetc/42?mode=compact&returnTo=%2Fafter',
            'the replay must be the byte-exact URL the client originally sent');
        assert.equal(out.redirect.ignoreWebRoot, true);
        assert.equal(out.storage.haltedRequestUrlResumed, '/widgetc/42?mode=compact&returnTo=%2Fafter',
            'the recorded resumed URL is the value actually replayed');
    });

    it('no-regression: an in-flight pre-fix snapshot (path-only url) replays exactly as before', function() {
        var storage = {
            haltedRequest: {
                url     : '/widgetc/42',
                routing : { rule: 'widget-c@test', namespace: 'test',
                            param: JSON.clone(TABLE['widget-c@test'].param) },
                method  : 'get',
                data    : { mode: 'compact' }
            }
        };
        var out = resumeFrom(storage);
        assert.equal(out.redirect.url, '/widgetc/42',
            'a snapshot taken before the fix keeps its exact (path-only) replay');
    });

});
