'use strict';
/**
 * #B947 — on a rule with several urls, a placeholder bound only under `file`, `title`, `namespace`
 * or `path` stays literal in the url `getRoute()` composes.
 *
 * #B374 composes a multi-url rule by filling ONLY the url it chose, from the rule's own url. The
 * bindings that fill it were read from the route AFTER the first `checkRouteParams()` call, and that
 * call writes the values into `param.file`, `.title`, `.namespace` and `.path`: a binding such as
 * `"file": ":file"` then read `"file": "intro"`, was no longer a binding, and the url kept `:file`
 * (`/docs/:file` where `/docs/intro` was composed before). The bindings now come from the rule's own
 * `param`, before any value is filled in.
 *
 * Strategy: the REAL `lib/routing`, loaded as routing-getroute-url-choice-b374.test.js loads it,
 * against a routing table in the shape `core/config.js` hands it (no whitespace around the commas,
 * `method` set). `lib/routing` is in the browser bundle, so suite 03 composes against the client map
 * the REAL `buildClientRoutingAssets()` derives from the same table: it is sliced out of
 * `core/server.js` (a top-level function whose only free identifier is `JSON.clone`) and run as is.
 * A bundle with a webroot rewrites `param.path` at load (#B800), so the `path` arm covers the module
 * given such a table, not a scaffolded bundle.
 *
 * Suites:
 *  01 — CONTROLS (hold before and after the fix)
 *  02 — #B947: a multi-url rule fills a placeholder bound under file, title, namespace or path
 *  03 — #B947: the client map composes the same url
 *  04 — source and dist pins (lib/routing is in the browser bundle)
 *
 * Seams (red-first against pre-fix copies):
 *   GINA_B947_ROUTING_SRC=<path>  the lib/routing/src/main.js text to load
 *   GINA_B947_DIST_DIR=<path>     the dist/vendor/gina/js directory suite 04 reads
 * On pre-fix copies the fix arms fail and the CONTROL arms pass.
 *
 * Run standalone: node --test test/lib/routing-getroute-bindings-b947.test.js
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var Module = require('module');
var FW     = require('../fw');

var REAL_SRC = path.join(FW, 'lib', 'routing', 'src', 'main.js');
var SRC      = process.env.GINA_B947_ROUTING_SRC || REAL_SRC;
var DIST_DIR = process.env.GINA_B947_DIST_DIR || path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');

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

// -- the client map: buildClientRoutingAssets() as core/server.js defines it --
var SERVER_SRC = fs.readFileSync(path.join(FW, 'core', 'server.js'), 'utf8');
var buildClientRoutingAssets = (function () {
    var head = 'function buildClientRoutingAssets(allRoutes) {', tail = '\nfunction Server(options) {';
    assert.equal(SERVER_SRC.split(head).length - 1, 1, 'core/server.js must define buildClientRoutingAssets exactly once');
    assert.equal(SERVER_SRC.split(tail).length - 1, 1, 'core/server.js must define Server exactly once');
    var a = SERVER_SRC.indexOf(head), b = SERVER_SRC.indexOf(tail, a);
    return new Function(SERVER_SRC.slice(a, b) + '\nreturn buildClientRoutingAssets;')();
})();

var BUNDLE  = 'testb';
var TABLE   = {
    // several urls, the placeholder bound only under a key the fill writes into
    'docfile@testb':     { method: 'GET', url: '/docs/:file,/d/:file', param: { control: 'render', file: ':file' }, requirements: { file: '/^[a-z]+$/' } },
    'doctitle@testb':    { method: 'GET', url: '/post/:title,/p/:title', param: { control: 'show', title: ':title' } },
    'docns@testb':       { method: 'GET', url: '/admin/:namespace/list,/a/:namespace', param: { control: 'list', namespace: ':namespace' } },
    'docpath@testb':     { method: 'GET', url: '/files/:path,/f/:path', param: { control: 'show', path: ':path' } },
    // controls
    'docfile1@testb':    { method: 'GET', url: '/docs/:file', param: { control: 'render', file: ':file' }, requirements: { file: '/^[a-z]+$/' } },
    'docoptional@testb': { method: 'GET', url: '/docs/:file,/docs', param: { control: 'render', file: ':file' } },
    'both@testb':        { method: 'GET', url: '/x/:id,/y', param: { control: 'render', id: ':id', title: ':id' } },
    'wvar@testb':        { method: 'GET', url: '/wvar/:id,/wvar/:id/:mode', param: { control: 'render', id: ':id', mode: ':mode' }, requirements: { id: '/^\\d+$/', mode: '/^(alpha|beta)$/' } }
};
var CLIENT  = buildClientRoutingAssets(TABLE).full;
var current = TABLE;

process.gina = process.gina || {};                      // gna.js normally creates this; getRoute reads process.gina.PROXY_HOSTNAME
setContext('isProxyHost', false);
setContext('gina', {
    config: {
        env       : 'dev',
        bundle    : BUNDLE,
        getRouting: function () { return current; },
        envConf   : {}
    }
});

/**
 * The url getRoute() composes against `table`; a fourth argument is passed through as urlIndex.
 * @inner
 */
function urlOn(table, rule, params) {
    current = table;
    try {
        return ( arguments.length > 3 )
            ? routing.getRoute(rule + '@' + BUNDLE, params, arguments[3]).url
            : routing.getRoute(rule + '@' + BUNDLE, params).url;
    } finally {
        current = TABLE;
    }
}

/** Comment-stripped source: a `//` comment preceded by nothing or by whitespace. */
function code(text) {
    return text.split('\n').map(function (l) { return l.replace(/(^|\s)\/\/.*$/, ''); }).join('\n');
}


describe('01 - CONTROLS: compositions the fix must leave as they were', function () {

    it('01.1 a single url fills a placeholder bound under `file`', function () {
        assert.equal(urlOn(TABLE, 'docfile1', { file: 'intro' }), '/docs/intro');
    });

    it('01.2 several urls, a placeholder bound under its own name', function () {
        assert.equal(urlOn(TABLE, 'wvar', { id: '42', mode: 'beta' }), '/wvar/42/beta');
    });

    it('01.3 several urls, no value: the url without a placeholder', function () {
        assert.equal(urlOn(TABLE, 'docoptional', {}), '/docs');
    });

    it('01.4 several urls, a placeholder bound under `id` and under `title`: the `id` binding fills it', function () {
        assert.equal(urlOn(TABLE, 'both', { id: '5' }), '/x/5');
    });

    it('01.5 the client map keeps the `file` binding, so both sides can fill it', function () {
        assert.deepEqual(CLIENT['docfile@testb'].param, { file: ':file' });
    });
});


describe('02 - #B947: a multi-url rule fills a placeholder bound under file, title, namespace or path', function () {

    it('02.1 `file`', function () {
        assert.equal(urlOn(TABLE, 'docfile', { file: 'intro' }), '/docs/intro');
    });

    it('02.2 `file`, the second url named by urlIndex', function () {
        assert.equal(urlOn(TABLE, 'docfile', { file: 'intro' }, 1), '/d/intro');
    });

    it('02.3 `title`', function () {
        assert.equal(urlOn(TABLE, 'doctitle', { title: 'hello' }), '/post/hello');
    });

    it('02.4 `namespace`', function () {
        assert.equal(urlOn(TABLE, 'docns', { namespace: 'users' }), '/admin/users/list');
    });

    it('02.5 `path`', function () {
        assert.equal(urlOn(TABLE, 'docpath', { path: 'docs' }), '/files/docs');
    });

    it('02.6 the other values still go to the query string', function () {
        assert.equal(urlOn(TABLE, 'docfile', { file: 'intro', tab: '2' }), '/docs/intro?tab=2');
    });
});


describe('03 - #B947: the client map composes the same url', function () {

    it('03.1 `file`', function () {
        assert.equal(urlOn(CLIENT, 'docfile', { file: 'intro' }), '/docs/intro');
    });

    it('03.2 `title`', function () {
        assert.equal(urlOn(CLIENT, 'doctitle', { title: 'hello' }), '/post/hello');
    });

    it('03.3 control: a placeholder bound under its own name composes the same on both sides', function () {
        assert.equal(urlOn(CLIENT, 'wvar', { id: '42', mode: 'beta' }), urlOn(TABLE, 'wvar', { id: '42', mode: 'beta' }));
    });
});


describe('04 - source and dist pins: the fix is in the source and in the browser bundle', function () {

    it('04.1 source: the bindings come from the rule\'s own param (comment-stripped)', function () {
        var c = code(src);
        assert.ok(c.indexOf('_ruleParam = routing[rule].param') > -1, 'the url re-fill does not read the rule\'s own param');
        assert.equal(c.indexOf('for (var _key in route.param)'), -1, 'the url re-fill still reads the filled route.param');
    });

    it('04.2 control: the comment stripping is not vacuous (the replaced loop survives in a was: comment)', function () {
        assert.ok(src.indexOf('for (var _key in route.param)') > -1, 'the raw text no longer names the replaced loop: the stripping control cannot fire');
    });

    it('04.3 dist: gina.js carries the fix (comment-stripped)', function () {
        var c = code(fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8'));
        assert.ok(c.indexOf('_ruleParam = routing[rule].param') > -1, 'gina.js does not carry the fix (rebuild the bundle)');
        assert.equal(c.indexOf('for (var _key in route.param)'), -1, 'gina.js still carries the replaced loop (rebuild the bundle)');
    });

    it('04.4 dist: gina.min.js reads the rule\'s own param, not the route\'s; control: it carries getRoute', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        // wrap-agnostic: Closure may break a line between any two tokens
        var fixed    = /\]\s*\.\s*param\s*\|\|\s*\{\s*\}\s*;\s*for\s*\(\s*var\s+[$\w]+\s+in\s+[$\w]+\s*\)/g;
        var replaced = /for\s*\(\s*var\s+[$\w]+\s+in\s+[$\w]+\s*\.\s*param\s*\)\s*typeof\s+[$\w]+\s*\.\s*param\s*\[\s*[$\w]+\s*\]\s*==\s*['"]string['"]\s*&&\s*\/\^:\//g;
        assert.ok(min.indexOf('RoutingHelper::getRoute') > -1, 'control: gina.min.js does not carry getRoute at all');
        assert.equal((min.match(fixed) || []).length, 1, 'gina.min.js does not read the rule\'s own param (rebuild the bundle)');
        assert.equal((min.match(replaced) || []).length, 0, 'gina.min.js still reads the filled route.param (rebuild the bundle)');
    });
});
