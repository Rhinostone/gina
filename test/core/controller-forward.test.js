/**
 * #B488 — `self.forward()` routes to the target it resolves.
 *
 * The method resolved the target route with `lib.routing.getRoute()` and then
 * discarded the result: the forwarded path was the target bundle's webroot
 * alone (the `@bundle` case) or literally `route.param.port` (the raw-host
 * case). Placeholder values came from the routing DECLARATION (`"id": ":id"`)
 * instead of the captured URL parameters, the `project` override condition was
 * inverted, `port` was set to the hostname string, an unguarded credentials
 * read could throw, and a non-JSON upstream body was re-encoded as a JSON
 * string. None of it had a test.
 *
 * Sections:
 *   01 — source pins, anchored over whole expressions, plus negatives that the
 *        superseded lines are gone from the forward() region.
 *   02 — behavioural arms driving the SHIPPED bytes: the forward() region is
 *        sliced out of the source and compiled under `new Function` with its
 *        four free identifiers (`self`, `local`, `lib`, `getContext`) injected
 *        as fakes, so the arms observe exactly what forward() hands to query()
 *        and which response method it picks.
 *
 * Red-first: run with GINA_CONTROLLER_SRC pointed at a pre-fix blob
 * (`git show HEAD:framework/v<ver>/core/controller/controller.js`). Every 01
 * pin and every 02 arm that pins the change must go red there; the arms marked
 * CONTROL pin behaviour the fix kept and stay green on both revisions.
 */

var assert = require('assert');
var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');

var FW     = require('../fw');
var SOURCE = process.env.GINA_CONTROLLER_SRC
            || path.join(FW, 'core/controller/controller.js');

var SRC = fs.readFileSync(SOURCE, 'utf8');

var START = '    this.forward = function(req, res, next) {';
var END   = '\n    /**\n     * Get config';

function region() {
    var a = SRC.indexOf(START);
    assert.ok(a > -1, 'the forward() declaration anchor must be present');
    var b = SRC.indexOf(END, a);
    assert.ok(b > a, 'the forward() region must end at the getConfig docblock');
    return SRC.slice(a, b);
}


// ── 01 — source pins ────────────────────────────────────────────────────────

describe('01 - #B488 source pins on forward()', function() {

    it('placeholder values come from the captured URL params, falling back to the declaration', function() {
        assert.ok(region().indexOf("param[p] = ( req.params && typeof(req.params[p]) != 'undefined' ) ? req.params[p] : route.param[p];") > -1);
    });

    it('the resolved route url is the forwarded path in the bundle branch', function() {
        assert.ok(region().indexOf('opt.path     = routeObj.url;') > -1);
    });

    it('the raw-host branch takes param.path, then the resolved url — never the port', function() {
        var r = region();
        assert.ok(r.indexOf('opt.path     = route.param.path || routeObj.url;') > -1);
        assert.strictEqual(r.indexOf('path        = route.param.port;'), -1, 'the copy-paste of the port into the path must be gone');
    });

    it('the project override applies when a value IS given (condition no longer inverted)', function() {
        assert.ok(region().indexOf("!/^(null|\\s*)$/.test(route.param.project)") > -1);
    });

    it('the port is never set to the hostname string', function() {
        assert.strictEqual(region().indexOf('port        = hostname;'), -1);
    });

    it('the webroot is no longer looked up — the resolved url carries it', function() {
        assert.strictEqual(region().indexOf("getContext('gina')"), -1);
    });

    it('an unknown target route is answered through throwError, not an escaped throw', function() {
        var r = region();
        assert.ok(r.indexOf('} catch (routeErr) {') > -1);
        assert.ok(r.indexOf("typeof(routeObj.url) != 'string'") > -1);
    });

    it('a string upstream body is relayed with renderTEXT', function() {
        var r = region();
        assert.ok(r.indexOf("if ( typeof(result) == 'string' ) {") > -1);
        assert.ok(r.indexOf('self.renderTEXT(result);') > -1);
    });

    it('the credentials read is guarded', function() {
        assert.ok(region().indexOf('settings && settings.server && settings.server.credentials && settings.server.credentials.ca') > -1);
    });

    it('the work-in-progress note and the typo are gone (typo control: the corrected message is present)', function() {
        assert.strictEqual(SRC.indexOf('work in progres'), -1);
        assert.strictEqual(SRC.indexOf('defiend'), -1);
        assert.ok(SRC.indexOf('must be defined in your route') > -1);
    });
});


// ── 02 — behavioural arms over the SHIPPED bytes ────────────────────────────

describe('02 - #B488 behaviour, forward() compiled from the source', function() {

    function fakes(over) {
        over = over || {};
        var calls = { query: [], throwError: [], renderJSON: [], renderTEXT: [], getRoute: [] };
        var self = {
            throwError : function() { calls.throwError.push([].slice.call(arguments)); },
            getConfig  : function() { return ('settings' in over) ? over.settings : { server: { credentials: { ca: 'CA' } } }; },
            isCacheless: function() { return !!over.cacheless; },
            isLocalScope: function() { return !!over.local; },
            query      : function(opt, data, cb) { calls.query.push({ opt: opt, data: data }); if (over.deliver) over.deliver(cb); },
            renderJSON : function(d) { calls.renderJSON.push(d); },
            renderTEXT : function(d) { calls.renderTEXT.push(d); }
        };
        var local = { options: { conf: { projectName: 'proj', bundle: 'front', env: 'dev' } } };
        var lib = { routing: { getRoute: function(rule, params, urlIndex) {
            calls.getRoute.push({ rule: rule, params: JSON.parse(JSON.stringify(params || {})), urlIndex: urlIndex });
            if (over.getRoute) return over.getRoute(rule, params, urlIndex);
            return { url: '/api/invoices/' + (params && params.id !== undefined ? params.id : '') };
        } } };
        // Only the pre-fix bytes read this; it is here so a red-first run fails on
        // the DEFECT rather than on a missing identifier.
        var getContext = function() { return { config: { envConf: { api: { dev: { server: { webroot: '/api' } } } } } }; };
        return { self: self, local: local, lib: lib, getContext: getContext, calls: calls };
    }

    function build(f) {
        var src = region().replace('this.forward = function', 'var forward = function');
        return new Function('self', 'local', 'lib', 'getContext', src + '\nreturn forward;')(f.self, f.local, f.lib, f.getContext);
    }

    function req(over) {
        return Object.assign({ method: 'GET', params: {}, get: { q: 'x' }, routing: { rule: 'legacy', param: {} } }, over || {});
    }

    it('bundle target with a captured :id — the resolved url is the path, the VALUE feeds the target, no port is set', function() {
        var f = fakes();
        build(f)(req({ params: { id: '42' }, routing: { rule: 'legacy', param: { control: 'forward', url: 'invoice-get@api', id: ':id' } } }), {}, function() {});
        assert.strictEqual(f.calls.throwError.length, 0, JSON.stringify(f.calls.throwError));
        assert.strictEqual(f.calls.query.length, 1);
        var q = f.calls.query[0];
        assert.strictEqual(f.calls.getRoute[0].rule, 'invoice-get@api');
        assert.strictEqual(f.calls.getRoute[0].params.id, '42', 'the captured value, not the ":id" declaration');
        assert.strictEqual(q.opt.hostname, 'api@proj');
        assert.strictEqual(q.opt.path, '/api/invoices/42', 'the resolved route url, webroot included');
        assert.strictEqual(q.opt.port, undefined, 'query() derives the port for a bundle@ hostname');
        assert.strictEqual(q.opt.method, 'get');
        assert.strictEqual(q.data.q, 'x', 'the incoming request data travels');
    });

    it('a bare <rule> with no host forwards to THIS bundle', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'invoice-get' } } }), {}, function() {});
        assert.strictEqual(f.calls.query[0].opt.hostname, 'front@proj');
        assert.strictEqual(f.calls.query[0].opt.path, '/api/invoices/');
    });

    it('raw host — hostname and port from the declaration, param.path wins over the resolved url', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'health', hostname: '10.0.0.5', port: 8080, path: '/status' } } }), {}, function() {});
        var o = f.calls.query[0].opt;
        assert.strictEqual(o.hostname, '10.0.0.5');
        assert.strictEqual(o.port, 8080);
        assert.strictEqual(o.path, '/status');
    });

    it('raw host without param.path falls back to the resolved url (never the port)', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'health', hostname: '10.0.0.5', port: 8080 } } }), {}, function() {});
        assert.strictEqual(f.calls.query[0].opt.path, '/api/invoices/');
    });

    it('a /<env> suffix on the target is stripped from the hostname bundle', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'invoice-get@api/prod' } } }), {}, function() {});
        assert.strictEqual(f.calls.query[0].opt.hostname, 'api@proj');
    });

    it('param.project overrides the project when a value is given', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'invoice-get@api', project: 'other' } } }), {}, function() {});
        assert.strictEqual(f.calls.query[0].opt.hostname, 'api@other');
    });

    it('CONTROL - a missing param.url is refused before any upstream call', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward' } } }), {}, function() {});
        assert.strictEqual(f.calls.throwError.length, 1);
        assert.match(String(f.calls.throwError[0][0].message), /route\.param\.url/, 'the guard pins the refusal; the typo has its own pin in 01');
        assert.strictEqual(f.calls.query.length, 0);
    });

    it('an unknown target (the routing helper throws) is answered through throwError, nothing forwarded', function() {
        var f = fakes({ getRoute: function() { throw new Error('`nope` not found !'); } });
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'nope@api' } } }), {}, function() {});
        assert.strictEqual(f.calls.throwError.length, 1);
        assert.match(String(f.calls.throwError[0][0].message), /not found/);
        assert.strictEqual(f.calls.query.length, 0);
    });

    it('a resolved route without a url is refused', function() {
        var f = fakes({ getRoute: function() { return {}; } });
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        assert.strictEqual(f.calls.throwError.length, 1);
        assert.strictEqual(f.calls.query.length, 0);
    });

    it('CONTROL - an object answer is relayed with renderJSON', function() {
        var f = fakes({ deliver: function(cb) { cb(false, { ok: true }); } });
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        assert.deepStrictEqual(f.calls.renderJSON, [{ ok: true }]);
        assert.strictEqual(f.calls.renderTEXT.length, 0);
    });

    it('a string answer is relayed verbatim with renderTEXT, never re-encoded', function() {
        var f = fakes({ deliver: function(cb) { cb(false, '<html>raw</html>'); } });
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        assert.deepStrictEqual(f.calls.renderTEXT, ['<html>raw</html>']);
        assert.strictEqual(f.calls.renderJSON.length, 0);
    });

    it('CONTROL - an upstream error goes to throwError, nothing is rendered', function() {
        var err = { status: 502, error: 'Bad Gateway' };
        var f = fakes({ deliver: function(cb) { cb(err); } });
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        assert.strictEqual(f.calls.throwError.length, 1);
        assert.strictEqual(f.calls.throwError[0][0], err);
        assert.strictEqual(f.calls.renderJSON.length + f.calls.renderTEXT.length, 0);
    });

    it('CONTROL - param.method overrides the forwarded method; the data still comes from the incoming slot', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api', method: 'POST' } } }), {}, function() {});
        assert.strictEqual(f.calls.query[0].opt.method, 'post');
        assert.strictEqual(f.calls.query[0].data.q, 'x');
    });

    it('CONTROL - local scope relaxes certificate checking; elsewhere it is left alone', function() {
        var a = fakes({ local: true });
        build(a)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        assert.strictEqual(a.calls.query[0].opt.rejectUnauthorized, false);
        var b = fakes();
        build(b)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        assert.strictEqual(b.calls.query[0].opt.rejectUnauthorized, undefined);
    });

    it('a bundle without credentials does not throw (the CA read is guarded)', function() {
        var f = fakes({ settings: { server: {} } });
        assert.doesNotThrow(function() {
            build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        });
        assert.strictEqual(f.calls.query.length, 1);
        assert.strictEqual(f.calls.query[0].opt.ca, undefined);
    });

    it('CONTROL - a configured CA is forwarded to query()', function() {
        var f = fakes();
        build(f)(req({ routing: { rule: 'r', param: { control: 'forward', url: 'x@api' } } }), {}, function() {});
        assert.strictEqual(f.calls.query[0].opt.ca, 'CA');
    });
});
