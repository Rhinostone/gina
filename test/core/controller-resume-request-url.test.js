/**
 * #B215 — resumeRequest()'s GET replay drops query-string keys that never reached
 * req.params during the original match. The recomposed route URL
 * (`getRoute(rule, haltedRequest.params||dataAsParams)`) only carries query keys
 * captured into `req.params` by fitsWithRequirements — i.e. keys declared in BOTH
 * `requirements` AND `param`. A key bound in `param` only (`"mode": ":mode"` with
 * no requirements entry) substitutes `:mode` into param.file/path/title at
 * match-commit (checkRouteParams reads request[method]) yet never lands in
 * req.params, and an entirely undeclared key (`?returnTo=…`) never does either —
 * so the replayed GET arrived query-less, matched anyway, and rendered literal
 * `:key` template paths as a 500. The inheritedData flash cannot heal it: router.js
 * merges it into req.get AFTER matching. Fix: with a live session the GET replay
 * redirects to the byte-exact `haltedRequest.url` (stamped by every pauseRequest
 * since the field existed, so in-flight pre-fix snapshots replay correctly too);
 * the session-less flow keeps the historical recompose, where the composed URL's
 * query params are the halted data's only travel channel.
 *
 * §01 source pins the fix shape in resumeRequest; §02 drives the REAL lib/routing
 * matcher + the REAL SuperController (createTestInstance, the §14/§36 harness)
 * end-to-end across the rule-shape matrix, with the already-working shapes and the
 * session-less fallback as green-both controls.
 */
'use strict';
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');


// ---------------------------------------------------------------------------
// 01 — source pins: the raw-URL replay + the retained recompose fallback
// ---------------------------------------------------------------------------
describe('01 - #B215 source pins: byte-exact URL replay in resumeRequest', function() {

    var slice = null;

    before(function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.resumeRequest = function');
        var end   = src.indexOf('this.renderCustomError', start);
        assert.ok(start > -1 && end > start, 'resumeRequest slice located');
        slice = src.slice(start, end);
    });

    it('reads haltedRequest.url for the replay (the field was write-only before #B215)', function() {
        assert.ok(slice.indexOf('haltedRequest.url') > -1,
            'resumeRequest must consume the snapshotted byte-exact URL');
    });

    it('gates the raw-URL replay on a live session (hasLiveSession)', function() {
        assert.ok(slice.indexOf('hasLiveSession') > -1,
            'the session-less flow must keep the recompose (data-as-query travel channel)');
    });

    it('retains the recompose fallback verbatim', function() {
        assert.ok(slice.indexOf('lib.routing.getRoute(haltedRequest.routing.rule, haltedRequest.params||dataAsParams).url') > -1,
            'the historical recompose must remain as the session-less / defensive fallback');
    });

    it('keeps the replaced line as a // was: marker (replace-code convention)', function() {
        assert.ok(slice.indexOf('// was: var url') > -1,
            'the pre-#B215 single-assignment line must be kept commented');
    });

    it('control: the non-GET in-process re-dispatch is untouched', function() {
        assert.ok(slice.indexOf('requiredController[req.routing.param.control](req, res, next)') > -1,
            'non-GET replay dispatch must remain');
    });

});


// ---------------------------------------------------------------------------
// 02 — behavioral: real matcher + real pauseRequest/resumeRequest end-to-end
// ---------------------------------------------------------------------------
describe('02 - #B215 behavioral: GET replay carries the original query string', function() {

    // -- §14/§36 harness bootstrap -----------------------------------------
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));                              // _, setPath, setContext, ...
    require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));   // JSON.clone, Object.count()
    process.gina = process.gina || {};
    setPath('gina', { core: path.join(FW, 'core') });

    var TABLE = {
        // query key declared in BOTH requirements AND param — already replayed
        // correctly pre-#B215 (captured into req.params) — green-both control
        'widget-a@test': { url: '/widget/:id', method: 'GET', bundle: 'test', namespace: 'test',
            requirements: { id: '/^[0-9]+$/', mode: '/^(compact|full)$/' },
            param: { control: 'widgetOpen', file: 'includes/widget-:mode', id: ':id', mode: ':mode' } },
        // query key bound in param ONLY — substitutes at match-commit but never
        // reaches req.params: the shape that lost its query on the replay
        'widget-c@test': { url: '/widgetc/:id', method: 'GET', bundle: 'test', namespace: 'test',
            requirements: { id: '/^[0-9]+$/' },
            param: { control: 'widgetOpen', file: 'includes/widgetc-:mode', id: ':id', mode: ':mode' } },
        // no URL placeholders — the dataAsParams fallback route
        'dash@test': { url: '/dashboard', method: 'GET', bundle: 'test', namespace: 'test',
            param: { control: 'dash', file: 'dash' } }
    };

    setContext('isProxyHost', false);
    setContext('gina', { config: {
        env: 'dev', bundle: 'test', envConf: {},
        getRouting: function () { return TABLE; }
    } });

    var routingLib      = require(path.join(FW, 'lib/routing/src/main.js'));
    var SuperController = require(SOURCE);

    var CONF = { bundle: 'test',
                 server: { supportedRequestMethods: { get: {}, post: {} } },
                 content: { routing: TABLE } };

    function mkReq(pathname, query) {
        var qs = Object.keys(query || {}).map(function (k) { return k + '=' + query[k]; }).join('&');
        return {
            url     : pathname + (qs ? '?' + qs : ''),
            method  : 'GET',
            headers : {},
            routing : {},
            params  : { 0: pathname },                 // server.isaac.js:812 shape
            get     : JSON.clone(query || {})
        };
    }
    function mkParams(name, pathname) {                // server.js engine literal, faithful subset
        var r = TABLE[name];
        return {
            method: r.method, control: r.param.control, requirements: r.requirements,
            namespace: r.namespace, url: pathname, rule: name,
            cache: null, queryTimeout: null, csrfExempt: false, culturePrefix: false, negotiate: false,
            param: JSON.clone(r.param), middleware: [], bundle: r.bundle,
            isXMLRequest: false, isWithCredentials: false
        };
    }
    // Match via the REAL engine matcher, then pause via the REAL controller,
    // then resume from a later request via the REAL controller. Returns what
    // the GET replay produced (redirect target or XHR renderJSON payload).
    async function haltAndResume(name, pathname, query, opts) {
        opts = opts || {};
        var req    = mkReq(pathname, query);
        var params = mkParams(name, pathname);
        var found  = await routingLib.compareUrls(params, TABLE[name].url, req, {}, function () {});
        assert.equal(found.past, true, 'precondition: the original request matches ' + name);

        if (!opts.sessionless) { req.session = {}; }
        var pauseInst = SuperController.createTestInstance({
            req: req, res: { setHeader: function () {}, end: function () {} },
            options: { conf: CONF, rule: name, control: TABLE[name].param.control }
        });
        var storage = opts.sessionless ? {} : undefined;
        var snap    = pauseInst.pauseRequest(JSON.clone(req.get), storage);   // authz-gate shape: data = req[method]

        var resumeReq = {
            url: '/login', method: 'GET', headers: {},
            routing: { rule: 'login@test', namespace: 'test', param: {} },
            params: { 0: '/login' }, get: {}
        };
        if (!opts.sessionless) { resumeReq.session = snap; }
        var captured = { redirect: null, json: null };
        var resumeInst = SuperController.createTestInstance({
            req: resumeReq, res: { setHeader: function () {}, end: function () {}, headersSent: false },
            options: { conf: CONF, rule: 'login@test', control: 'login',
                       isXMLRequest: !!opts.xhr }
        });
        resumeInst.redirect   = function (u, ignoreWebRoot) { captured.redirect = { url: u, ignoreWebRoot: ignoreWebRoot }; };
        resumeInst.renderJSON = function (payload) { captured.json = payload; };
        resumeInst.resumeRequest(opts.sessionless ? snap : undefined);
        captured.storage = snap;
        return captured;
    }

    it('param-bound-only query key rides the replay URL (the 500 shape healed)', async function() {
        var out = await haltAndResume('widget-c@test', '/widgetc/42', { mode: 'compact' });
        assert.ok(out.redirect, 'GET replay redirects');
        assert.equal(out.redirect.url, '/widgetc/42?mode=compact',
            'the replay must carry the query the original request was halted with');
        assert.equal(out.redirect.ignoreWebRoot, true, 'raw URL already carries the webroot');
    });

    it('undeclared query keys ride the replay URL too', async function() {
        var out = await haltAndResume('widget-a@test', '/widget/42', { mode: 'compact', returnTo: '/after' });
        assert.ok(out.redirect.url.indexOf('mode=compact') > -1, 'declared key present');
        assert.ok(out.redirect.url.indexOf('returnTo=/after') > -1,
            'a key with no requirements entry must survive the replay');
    });

    it('XHR replay location carries the query as well', async function() {
        var out = await haltAndResume('widget-c@test', '/widgetc/42', { mode: 'compact' }, { xhr: true });
        assert.ok(out.json, 'XHR replay answers renderJSON');
        assert.equal(out.json.isXhrRedirect, true);
        assert.equal(out.json.location, '/widgetc/42?mode=compact');
    });

    it('control (green pre-fix too): requirements+param-declared key still replays correctly', async function() {
        var out = await haltAndResume('widget-a@test', '/widget/42', { mode: 'compact' });
        assert.equal(out.redirect.url, '/widget/42?mode=compact');
    });

    it('control (green pre-fix too): session-less custom storage keeps the recompose — data travels as query params', async function() {
        var out = await haltAndResume('dash@test', '/dashboard', { tab: 'reports' }, { sessionless: true });
        assert.equal(out.redirect.url, '/dashboard?tab=reports',
            'with no live session the composed URL remains the data\'s only travel channel');
    });

    it('control (green pre-fix too): the inheritedData flash stash still fires for session-ful replays', async function() {
        var out = await haltAndResume('widget-a@test', '/widget/42', { mode: 'compact' });
        assert.ok(out.storage.inheritedData, 'flash channel populated');
        assert.equal(out.storage.inheritedData.mode, 'compact');
    });

    it('the snapshot itself stays byte-exact (url with query) and consumed on replay', async function() {
        var out = await haltAndResume('widget-c@test', '/widgetc/42', { mode: 'compact' });
        assert.equal(out.storage.haltedRequest, undefined, 'snapshot cleared once consumed');
        assert.equal(out.storage.haltedRequestUrlResumed, '/widgetc/42?mode=compact',
            'the session records the URL actually replayed');
    });

});
