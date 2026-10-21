'use strict';
/**
 * #B374 / #B220 / #B943 / #B944 / #B946 — the url `getRoute()` composes.
 *
 * #B374 — for a rule with several urls (`"url": "/a/:id, /a/:id/:mode"`), the url was chosen in
 * `checkRouteParams` by a loop that read the FIRST url on every pass (`rawUrls[0]`), so it always
 * chose 0, and `getRoute()` let that 0 override the caller's own `urlIndex` whenever a placeholder had
 * been filled (the `urlIndex` that `forward()` passes from `param.urlIndex` included). Now the caller's
 * `urlIndex` wins, an index that names no url throws, and without one `getRoute()` composes the first
 * url whose placeholders all receive a value, preferring among those the url that uses the most values;
 * when no url is complete, the url that receives the most values; ties go to the first url.
 * #B220 — the query append tested a declared placeholder against every url of the rule joined, so a
 * value whose placeholder sat only in another url was skipped and, when declared in `requirements`,
 * dropped. It now tests the url composed, with the fill's own anchor (`:name` then `/` or the end).
 * #B943 — a value bound to a placeholder of the url composed was appended to the query too, when the
 * rule's `requirements` did not declare it (`/invoice/abc-123?id=abc-123`).
 * #B944 — the first query loop recorded VALUES where the second tests KEYS, so a declared value
 * outside the url was appended twice when `requirements` did not declare it.
 * #B946 — the pick tested and split the FILLED url, so a comma inside a value truncated the url, on any
 * rule. The pick now reads the rule's own url and fills only the url it chose.
 *
 * Strategy: the REAL `lib/routing`, loaded through the framework helpers bootstrap (the routing-fixes
 * §07 shape), against a routing table in the shape `core/config.js` hands it: no whitespace around the
 * commas of a multi-url `url` (config.js strips it at load) and `method` set. The source text is
 * compiled under its real file name, so its relative requires resolve whichever copy the text comes
 * from.
 *
 * Suites:
 *  01 — CONTROLS (hold before and after the fix)
 *  02 — #B374: the caller's urlIndex wins over the url choice
 *  03 — #B374: without urlIndex, the first complete url
 *  04 — #B374: an index that names no url throws
 *  05 — #B220: a value bound to another url of the rule reaches the url
 *  06 — #B943: a value written into the path is not repeated in the query
 *  07 — #B944: a declared value outside the url is appended once
 *  08 — #B946: a comma inside a value stays in the url
 *  09 — CONTROL: the route returned carries no `urlIndex`
 *  10 — source and dist pins (lib/routing is in the browser bundle)
 *
 * Seams (red-first against pre-fix copies):
 *   GINA_B374_ROUTING_SRC=<path>  the lib/routing/src/main.js text to load
 *   GINA_B374_DIST_DIR=<path>     the dist/vendor/gina/js directory suite 10 reads
 * On pre-fix copies the fix arms fail and the CONTROL arms pass.
 *
 * Run standalone: node --test test/lib/routing-getroute-url-choice-b374.test.js
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var Module = require('module');
var FW     = require('../fw');

var REAL_SRC = path.join(FW, 'lib', 'routing', 'src', 'main.js');
var SRC      = process.env.GINA_B374_ROUTING_SRC || REAL_SRC;
var DIST_DIR = process.env.GINA_B374_DIST_DIR || path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');

// -- real-module harness (node:test runs each file in its own process, so the global
//    injection below cannot leak into other test files) --
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
Module._initPaths();
require(path.join(FW, 'helpers'));                       // installs setContext/getContext, requireJSON …
require(path.join(FW, '..', '..', 'utils', 'prototypes'));  // installs JSON.clone

var src     = fs.readFileSync(path.resolve(SRC), 'utf8');
var routing = (function () {
    var m = new Module(REAL_SRC, null);
    m.filename = REAL_SRC;
    m.paths    = Module._nodeModulePaths(path.dirname(REAL_SRC));
    m._compile(src, REAL_SRC);
    return m.exports;                                   // the module exports a ready instance
})();

var BUNDLE  = 'testb';
var ANY     = '/^.*$/';
var TABLE   = {
    // several urls
    'wvar@testb':      { method: 'GET',  url: '/wvar/:id,/wvar/:id/:mode', param: { control: 'render', id: ':id', mode: ':mode' }, requirements: { id: '/^\\d+$/', mode: '/^(alpha|beta)$/' } },
    'scopereq@testb':  { method: 'GET',  url: '/scopereq,/scopereq/:timestamp', param: { control: 'render', timestamp: ':timestamp' }, requirements: { timestamp: ANY } },
    'pwd@testb':       { method: 'GET',  url: '/pwd/:id/:pubkey,/pwd/:id', param: { control: 'render', id: ':id', pubkey: ':pubkey' }, requirements: { id: '/^\\d+$/', pubkey: '/^\\w+$/' } },
    'logout@testb':    { method: 'GET',  url: '/logout/:timestamp,/logout', param: { control: 'logout', timestamp: ':timestamp' }, requirements: { timestamp: '/^\\d+$/' } },
    'three@testb':     { method: 'GET',  url: '/e/:root/:dir/:template,/e/:root/:template,/e/:dir/:template', param: { control: 'render', root: ':root', dir: ':dir', template: ':template' }, requirements: { root: ANY, dir: ANY, template: ANY } },
    'help@testb':      { method: 'GET',  url: '/help,/aide', param: { control: 'help' } },
    'helpentry@testb': { method: 'GET',  url: '/help/:id,/aide/:id', param: { control: 'entry', id: ':id' }, requirements: { id: ANY } },
    'post@testb':      { method: 'POST', url: '/p/:id,/p/:id/:mode', param: { control: 'save', id: ':id', mode: ':mode' }, requirements: { id: '/^\\d+$/', mode: '/^\\w+$/' } },
    // one url
    'widget@testb':    { method: 'GET',  url: '/widget/:id', param: { control: 'render', id: ':id', mode: ':mode' }, requirements: { id: '/^\\d+$/', mode: '/^(alpha|beta)$/' } },
    'invoice@testb':   { method: 'GET',  url: '/invoice/:id', param: { control: 'get', id: ':id' } },
    'dup@testb':       { method: 'GET',  url: '/dup', param: { control: 'render', mode: ':mode' } },
    'unbound@testb':   { method: 'GET',  url: '/echo/:id', param: { control: 'render' } },
    'withreq@testb':   { method: 'GET',  url: '/scoped', param: { control: 'render', file: 'scoped' }, requirements: { ref: '/^\\w+$/' } },
    'noreq@testb':     { method: 'GET',  url: '/deep', param: { control: 'render', file: 'deep' } },
    'page@testb':      { method: 'GET',  url: '/articles/page:number', param: { control: 'list', number: ':number' }, requirements: { number: '/^[0-9]+$/' } },
    'json@testb':      { method: 'GET',  url: '/doc/:id.json', param: { control: 'doc', id: ':id' } },
    'prefix@testb':    { method: 'GET',  url: '/k/:keyXyz', param: { control: 'render', key: ':key', keyXyz: ':keyXyz' }, requirements: { key: '/^\\w+$/', keyXyz: '/^\\w+$/' } },
    'one@testb':       { method: 'GET',  url: '/o/:x', param: { control: 'render', x: ':x' }, requirements: { x: ANY } }
};

process.gina = process.gina || {};                      // gna.js normally creates this; getRoute reads process.gina.PROXY_HOSTNAME
setContext('isProxyHost', false);
setContext('gina', {
    config: {
        env       : 'dev',
        bundle    : BUNDLE,
        getRouting: function () { return TABLE; },
        envConf   : {}
    }
});

/**
 * The url getRoute() composes; a third argument, even `undefined` or `null`, is passed through.
 * @inner
 */
function url(rule) {
    return ( arguments.length > 2 )
        ? routing.getRoute(rule + '@' + BUNDLE, arguments[1], arguments[2]).url
        : routing.getRoute(rule + '@' + BUNDLE, arguments[1]).url;
}

/** Comment-stripped source: a `//` comment preceded by nothing or by whitespace. */
function code(text) {
    return text.split('\n').map(function (l) { return l.replace(/(^|\s)\/\/.*$/, ''); }).join('\n');
}


describe('01 - CONTROLS: compositions the fix must leave as they were', function () {

    it('01.1 a single url: a declared value outside the url goes to the query once (requirements declares it)', function () {
        assert.equal(url('widget', { id: '42', mode: 'beta' }), '/widget/42?mode=beta');
    });

    it('01.2 several urls: a value for every placeholder of the first url composes the first url', function () {
        assert.equal(url('pwd', { id: '7', pubkey: 'k1' }), '/pwd/7/k1');
        assert.equal(url('logout', { timestamp: '9' }), '/logout/9');
    });

    it('01.3 an empty value is a value: it fills its placeholder and the trailing slash is trimmed', function () {
        assert.equal(url('pwd', { id: '7', pubkey: '' }), '/pwd/7');
    });

    it('01.4 urls with the same placeholders (one url per language): the first url, the caller can name another', function () {
        assert.equal(url('help', {}), '/help');
        assert.equal(url('help', {}, 1), '/aide');
        assert.equal(url('helpentry', { id: 'faq-1' }), '/help/faq-1');
    });

    it('01.5 an unbound placeholder (no `"id": ":id"` in param) keeps its value travelling as a query parameter', function () {
        assert.equal(url('unbound', { id: '42' }), '/echo/:id?id=42');
    });

    it('01.6 the #B120 shapes: a requirements-declared key stays out of the query; a rule without requirements appends', function () {
        assert.equal(url('withreq', { ref: 'deep', tab: '2' }), '/scoped?tab=2');
        assert.equal(url('noreq', { ref: 'deep', tab: '2' }), '/deep?ref=deep&tab=2');
        assert.equal(url('noreq', {}), '/deep');
    });

    it('01.7 the fill\'s anchor: an inline placeholder at the end of a segment fills; one followed by `.json` does not', function () {
        assert.equal(url('page', { number: '3' }), '/articles/page3');
        assert.equal(url('json', { id: '5' }), '/doc/:id.json?id=5');
    });

    it('01.8 a single url ignores urlIndex; a value without a comma fills a multi-url rule as before', function () {
        assert.equal(url('one', { x: '1' }, 3), '/o/1');
        assert.equal(url('three', { root: 'n', dir: 'd', template: 't' }), '/e/n/d/t');
    });
});


describe('02 - #B374: the caller\'s urlIndex wins over the url choice (forward() passes param.urlIndex here)', function () {

    it('02.1 urlIndex 1 composes the second url although a placeholder was filled', function () {
        assert.equal(url('wvar', { id: '42', mode: 'beta' }, 1), '/wvar/42/beta');
    });

    it('02.2 a numeric string such as "1" names the same url', function () {
        assert.equal(url('wvar', { id: '42', mode: 'beta' }, '1'), '/wvar/42/beta');
    });

    it('02.3 urlIndex 1 on a rule whose first url has no placeholder', function () {
        assert.equal(url('scopereq', { timestamp: '123' }, 1), '/scopereq/123');
    });

    it('02.4 urlIndex 1 when the first url would leave a placeholder unfilled', function () {
        assert.equal(url('pwd', { id: '7' }, 1), '/pwd/7');
    });
});


describe('03 - #B374: without urlIndex, the first url whose placeholders all receive a value', function () {

    it('03.1 the url that uses the most values, among the complete ones', function () {
        assert.equal(url('wvar', { id: '42', mode: 'beta' }), '/wvar/42/beta');
        assert.equal(url('scopereq', { timestamp: '123' }), '/scopereq/123');
    });

    it('03.2 a complete url wins over one that would keep a placeholder', function () {
        assert.equal(url('pwd', { id: '7' }), '/pwd/7');
        assert.equal(url('logout', {}), '/logout');
        assert.equal(url('logout'), '/logout');
    });

    it('03.3 three urls: the one the values complete', function () {
        assert.equal(url('three', { root: 'n', template: 't' }), '/e/n/t');
        assert.equal(url('three', { dir: 'd', template: 't' }), '/e/d/t');
    });

    it('03.4 a rule that appends no query (POST) composes the url that carries the value', function () {
        assert.equal(url('post', { id: '1', mode: 'm' }), '/p/1/m');
    });

    it('03.5 urlIndex null is no urlIndex', function () {
        assert.equal(url('wvar', { id: '42', mode: 'beta' }, null), '/wvar/42/beta');
    });
});


describe('04 - #B374: an index that names no url throws, instead of composing `undefined`', function () {

    [5, -1, 'x', 1.5].forEach(function (bad) {
        it('04 urlIndex ' + JSON.stringify(bad) + ' on a two-url rule', function () {
            assert.throws(
                function () { url('wvar', {}, bad); },
                function (err) {
                    return err instanceof Error
                        && err.message.indexOf('urlIndex `' + bad + '` names no url of rule `wvar@testb`, which has 2 urls') > -1;
                },
                'getRoute must throw a named error for urlIndex ' + JSON.stringify(bad)
            );
        });
    });
});


describe('05 - #B220: a value bound to another url of the rule reaches the url', function () {

    it('05.1 the first url named: a value bound only to the second goes to the query, requirements or not', function () {
        assert.equal(url('wvar', { id: '42', mode: 'beta' }, 0), '/wvar/42?mode=beta');
        assert.equal(url('scopereq', { timestamp: '123' }, 0), '/scopereq?timestamp=123');
    });

    it('05.2 the second url named: the value bound only to the first goes to the query', function () {
        assert.equal(url('logout', { timestamp: '9' }, 1), '/logout?timestamp=9');
    });

    it('05.3 the fill\'s anchor: `:key` is not found inside `:keyXyz`', function () {
        assert.equal(url('prefix', { key: 'a', keyXyz: 'b' }), '/k/b?key=a');
    });
});


describe('06 - #B943: a value written into the path is not repeated in the query', function () {

    it('06.1 the routing guide\'s reverse-routing example rule (no requirements)', function () {
        assert.equal(url('invoice', { id: 'abc-123' }), '/invoice/abc-123');
    });

    it('06.2 the other values still go to the query', function () {
        assert.equal(url('invoice', { id: 'abc-123', tab: '2' }), '/invoice/abc-123?tab=2');
    });
});


describe('07 - #B944: a declared value outside the url is appended once', function () {

    it('07.1 no requirements block', function () {
        assert.equal(url('dup', { mode: 'beta' }), '/dup?mode=beta');
    });
});


describe('08 - #B946: a comma inside a value stays in the url', function () {

    it('08.1 a single url', function () {
        assert.equal(url('one', { x: 'a,b' }), '/o/a,b');
    });

    it('08.2 an array value (it stringifies with a comma) on a three-url rule', function () {
        assert.equal(url('three', { root: 'n', dir: ['a', 'b'], template: 't' }), '/e/n/a,b/t');
    });

    it('08.3 the url chosen is the one the value fills, whatever the value carries', function () {
        assert.equal(url('scopereq', { timestamp: '1,2' }), '/scopereq/1,2');
    });
});


describe('09 - CONTROL: the route returned carries no `urlIndex`', function () {

    it('09.1 the index handed from the url choice to the query append is removed', function () {
        [
            routing.getRoute('wvar@' + BUNDLE, { id: '42', mode: 'beta' }),
            routing.getRoute('wvar@' + BUNDLE, { id: '42', mode: 'beta' }, 1),
            routing.getRoute('logout@' + BUNDLE, {}),
            routing.getRoute('post@' + BUNDLE, { id: '1', mode: 'm' })
        ].forEach(function (route) {
            assert.equal(typeof(route.url), 'string', 'control: a route was composed');
            assert.equal(Object.prototype.hasOwnProperty.call(route, 'urlIndex'), false, route.url + ' carries urlIndex');
        });
    });
});


describe('10 - source and dist pins: the fix is in the source and in both browser bundles', function () {

    it('10.1 source: the url choice, the mask and the key record (comment-stripped)', function () {
        var c = code(src);
        assert.ok(c.indexOf('var selectUrlIndex = function(rawUrl, params)') > -1, 'selectUrlIndex is not defined');
        assert.ok(c.indexOf('urlIndex = selectUrlIndex(routing[rule].url, params);') > -1, 'getRoute does not choose the url with selectUrlIndex');
        assert.ok(c.indexOf(', maskedUrl = routing[rule].url.split(/\\,/g)[ route.urlIndex || 0 ] || routing[rule].url') > -1, 'the query append does not test the url composed');
        assert.ok(c.indexOf('extracted[i] = r;') > -1, 'the first query loop does not record keys');
        assert.equal(c.indexOf('rawUrls[0].match('), -1, 'the loop that read the first url on every pass is still live code');
    });

    it('10.2 control: the comment stripping is not vacuous (the removed loop survives in a was: comment)', function () {
        assert.ok(src.indexOf('rawUrls[0].match(') > -1, 'the raw text no longer names the removed loop: the stripping control cannot fire');
    });

    it('10.3 dist: gina.js carries selectUrlIndex and the named error', function () {
        var dist = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
        assert.ok(dist.indexOf('var selectUrlIndex = function(rawUrl, params)') > -1, 'gina.js does not carry selectUrlIndex (rebuild the bundle)');
        assert.ok(dist.indexOf('extracted[i] = r;') > -1, 'gina.js does not carry the key record (rebuild the bundle)');
        assert.ok(dist.indexOf('names no url of rule') > -1, 'gina.js does not carry the named error (rebuild the bundle)');
    });

    it('10.4 dist: gina.min.js carries the named error; control: it carries getRoute', function () {
        var dist = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        assert.ok(dist.indexOf('RoutingHelper::getRoute') > -1, 'control: gina.min.js does not carry getRoute at all');
        assert.ok(dist.indexOf('names no url of rule') > -1, 'gina.min.js does not carry the named error (rebuild the bundle)');
    });
});
