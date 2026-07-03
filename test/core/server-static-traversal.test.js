'use strict';
/**
 * server.js — static-asset path-traversal regression tests (#B64)
 *
 * A request URL containing `../` (or its `%2F` / `%2e%2e` encoded variants)
 * escaped a statics.json mapping's target directory to any sibling under the
 * shared root, because both static resolvers built the filename by raw string
 * concatenation guarded ONLY by an existence check. Fixed by `confineToBase()`
 * + a per-branch base capture in:
 *   - getAssetFilenameFromUrl  (HTTP/2 push + asset-catalog resolver)
 *   - handleStatics            (request-pipeline static handler)
 *
 * Strategy (established gina idiom):
 *   §01  extract the REAL `confineToBase` from source and drive it (behaviour)
 *   §02  source-pins locking the getAssetFilenameFromUrl guard wiring
 *   §03  source-pins locking the handleStatics guard wiring
 *   §04  pure-logic replica over a REAL temp fs — all three encodings blocked
 *        on BOTH resolvers, legit asset served, sibling-dir + publicPath escapes
 *        rejected
 *   §05  subtract — removing the guard leaks the sibling secret file
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs      = require('fs');
var os     = require('os');

var SOURCE = path.join(require('../fw'), 'core/server.js');
var SRC    = fs.readFileSync(SOURCE, 'utf8');

// ── extract the REAL confineToBase function body from source (brace-balanced) ──
function extractFn(src, decl) {
    var start = src.indexOf(decl);
    assert.ok(start > -1, 'declaration not found: ' + decl);
    var braceStart = src.indexOf('{', start);
    var depth = 0, i = braceStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    // `var confineToBase = function(...) { ... }` → build a callable
    var fnText = src.slice(src.indexOf('function', start), i + 1);
    // eslint-disable-next-line no-new-func
    return new Function('path', 'return (' + fnText + ');')(path);
}

var confineToBase = extractFn(SRC, 'var confineToBase = function(filename, base)');

// faithful copy of gina's safeDecodeURIComponent (helpers/data)
function safeDecodeURIComponent(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}


// ─── §01 — confineToBase (the REAL extracted helper) ─────────────────────────
describe('01 - confineToBase confines a path to its base directory', function() {

    it('accepts a legitimate in-base child and returns its canonical form', function() {
        assert.equal(
            confineToBase('/srv/app/js/lib/app.js', '/srv/app/js/lib'),
            path.resolve('/srv/app/js/lib/app.js')
        );
    });

    it('accepts the base itself (exact single-file mapping)', function() {
        assert.equal(confineToBase('/srv/app/favicon.ico', '/srv/app/favicon.ico'),
            path.resolve('/srv/app/favicon.ico'));
    });

    it('rejects a literal ../ escape → null', function() {
        assert.equal(confineToBase('/srv/app/js/lib/../../../config/secret.json', '/srv/app/js/lib'), null);
    });

    it('rejects an in-base path that still climbs above base at any point', function() {
        // resolves to /srv/app/secret → outside /srv/app/js/lib
        assert.equal(confineToBase('/srv/app/js/lib/../../secret', '/srv/app/js/lib'), null);
    });

    it('rejects the sibling-prefix bypass (lib vs lib-secrets)', function() {
        // separator-aware check: /srv/app/lib-secrets must NOT be treated as under /srv/app/lib
        assert.equal(confineToBase('/srv/app/lib-secrets/x.js', '/srv/app/lib'), null);
    });

    it('fails closed on a null/empty base or non-string filename', function() {
        assert.equal(confineToBase('/srv/app/x', ''), null);
        assert.equal(confineToBase('/srv/app/x', null), null);
        assert.equal(confineToBase(null, '/srv/app'), null);
    });

    it('an in-base but non-normalized path stays accepted (normalises to a child)', function() {
        // a/../b stays inside base
        assert.equal(confineToBase('/srv/app/js/a/../b.js', '/srv/app/js'),
            path.resolve('/srv/app/js/b.js'));
    });
});


// ─── §02 — getAssetFilenameFromUrl guard wiring (source-pins) ─────────────────
describe('02 - getAssetFilenameFromUrl confines the resolved filename', function() {

    var region;
    before(function() {
        var s = SRC.indexOf('var getAssetFilenameFromUrl = function');
        var e = SRC.indexOf('var httpGet', s); // next inner fn after the resolver
        if (e < 0) e = s + 4000;
        region = SRC.slice(s, e);
    });

    it('declares a _base capture var', function() {
        assert.match(region, /_base\s*=\s*null/, 'expected a `_base` local');
    });

    it('captures the mapped-branch base from the matched mapping target', function() {
        // _base = ... content.statics[path] : content.statics[staticProps.firstLevel]
        assert.match(region, /_base\s*=\s*\(bundleConf\.staticResources\.indexOf\(path\)\s*>\s*-1\)\s*\?\s*bundleConf\.content\.statics\[path\]\s*:\s*bundleConf\.content\.statics\[staticProps\.firstLevel\]/);
    });

    it('captures the fallback-branch base (exact mapping target, else publicPath)', function() {
        assert.match(region, /_base\s*=\s*\(\s*bundleConf\.staticResources\.indexOf\(url\)\s*>\s*-1\s*\)\s*\?\s*bundleConf\.content\.statics\[url\]\s*:\s*bundleConf\.publicPath/);
    });

    it('calls confineToBase(filename, _base) and returns notFound BEFORE the existsSync read', function() {
        var guardIdx  = region.indexOf('confineToBase(filename, _base)');
        var existsIdx = region.indexOf('!fs.existsSync(filename)');
        assert.ok(guardIdx > -1, 'expected confineToBase(filename, _base) call');
        assert.ok(existsIdx > -1, 'expected existsSync gate');
        assert.ok(guardIdx < existsIdx, 'the traversal guard must run before the existence check');
        // the guard returns notFound on escape
        assert.match(region.slice(guardIdx, guardIdx + 120), /=== null\s*\)\s*return notFound/);
    });
});


// ─── §03 — handleStatics guard wiring (source-pins) ──────────────────────────
describe('03 - handleStatics confines the resolved filename', function() {

    var region;
    before(function() {
        var s = SRC.indexOf('var handleStatics = function');
        var e = SRC.indexOf('let filenameObj = new _(filename, true)', s) + 200;
        region = SRC.slice(s, e);
    });

    it('defaults _staticBase to publicPath', function() {
        assert.match(region, /var _staticBase\s*=\s*bundleConf\.publicPath;/);
    });

    it('re-points _staticBase to the matched mapping target in the prefix-regex branch', function() {
        // the exact-index, regex-loop, and fallback-loop branches each capture the target
        var caps = region.match(/_staticBase\s*=\s*bundleConf\.content\.statics\[\s*bundleConf\.staticResources\[s\]\s*\]/g) || [];
        assert.ok(caps.length >= 2, 'expected >=2 loop-branch base captures, got ' + caps.length);
        // exact-index single-file branch: _staticBase = filename
        assert.match(region, /_staticBase\s*=\s*filename;/);
    });

    it('calls confineToBase(filename, _staticBase) AFTER safeDecodeURIComponent, BEFORE the exists()/read', function() {
        var decodeIdx = region.indexOf('safeDecodeURIComponent(filename)');
        var guardIdx  = region.indexOf('confineToBase(filename, _staticBase)');
        var existsIdx = region.indexOf('filenameObj.exists');
        var objIdx    = region.indexOf('let filenameObj = new _(filename, true)');
        assert.ok(decodeIdx > -1 && guardIdx > -1 && objIdx > -1, 'expected decode + guard + filenameObj');
        assert.ok(decodeIdx < guardIdx, 'guard must run AFTER percent-decoding is settled');
        assert.ok(guardIdx < objIdx, 'guard must run BEFORE the file is opened/read');
    });

    it('rejects an escape with a plain 404 (same signal as a missing file)', function() {
        var guardIdx = region.indexOf('confineToBase(filename, _staticBase)');
        assert.match(region.slice(guardIdx, guardIdx + 200), /=== null\s*\)\s*\{\s*return throwError\(response,\s*404/);
    });
});


// ─── §04 / §05 — behavioural replica over a REAL temp filesystem ─────────────
// Replicates the two resolvers' filename-build branches VERBATIM from server.js,
// driving the REAL extracted confineToBase over a real fixture. GUARD toggles the
// fix so §05 can prove it is load-bearing (subtract).

describe('04/05 - traversal blocked end-to-end on both resolvers (real fs)', function() {

    var ROOT, SHARED, bundleConf, bundleConfFL;

    before(function() {
        ROOT   = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b64-'));
        SHARED = path.join(ROOT, 'shared');
        fs.mkdirSync(path.join(SHARED, 'js', 'vendor', 'lib'), { recursive: true });
        fs.mkdirSync(path.join(SHARED, 'js', 'vendor', 'lib-secrets'), { recursive: true });
        fs.mkdirSync(path.join(SHARED, 'config'), { recursive: true });
        fs.mkdirSync(path.join(SHARED, 'public'), { recursive: true });
        fs.writeFileSync(path.join(SHARED, 'js', 'vendor', 'lib', 'real-asset.js'), 'ok');
        fs.writeFileSync(path.join(SHARED, 'js', 'vendor', 'lib-secrets', 'k.js'), 'sibling');
        fs.writeFileSync(path.join(SHARED, 'config', 'secret.json'), '{"pw":"TOP-SECRET"}');
        fs.writeFileSync(path.join(SHARED, 'public', 'app.js'), 'pub');

        // mapping "js/vendor/lib" → normalized key "/js/vendor/lib/"
        bundleConf = {
            publicPath      : path.join(SHARED, 'public'),
            server          : { webroot: '/' },
            staticResources : ['/js/vendor/lib/'],
            content         : { statics: { '/js/vendor/lib/': path.join(SHARED, 'js', 'vendor', 'lib') } }
        };
        // firstLevel-mapped config to exercise getAssetFilenameFromUrl's mapped branch
        bundleConfFL = {
            publicPath      : path.join(SHARED, 'public'),
            server          : { webroot: '/' },
            staticResources : ['/js/'],
            publicResources : ['/js/'],
            content         : { statics: { '/js/': path.join(SHARED, 'js') } }
        };
    });

    after(function() {
        fs.rmSync(ROOT, { recursive: true, force: true });
    });

    // VERBATIM copy of handleStatics filename-build (server.js) + optional guard
    function handleStaticsBuild(conf, pathname, isStaticFilename, GUARD) {
        var filename    = conf.publicPath + pathname;
        var _staticBase = conf.publicPath;
        var staticIndex = conf.staticResources.indexOf(pathname);
        if ( isStaticFilename && staticIndex > -1 ) {
            filename    = conf.content.statics[ conf.staticResources[staticIndex] ];
            _staticBase = filename;
        } else {
            var s = 0, sLen = conf.staticResources.length;
            for ( ; s < sLen; ++s ) {
                if ( new RegExp('^' + conf.staticResources[s].replace(/\//g, '\\/')).test(pathname) ) {
                    _staticBase = conf.content.statics[ conf.staticResources[s] ];
                    filename = conf.content.statics[ conf.staticResources[s] ] + '/' + pathname.replace(conf.staticResources[s], '');
                    break;
                }
            }
            if ( !fs.existsSync(filename) ) {
                var key = pathname.replace(pathname.split('/').splice(-1), '');
                for ( ; s < sLen; ++s ) {
                    if ( conf.staticResources[s] == key ) {
                        _staticBase = conf.content.statics[ conf.staticResources[s] ];
                        filename = conf.content.statics[ conf.staticResources[s] ] + '/' + pathname.replace(conf.staticResources[s], '');
                        break;
                    }
                }
            }
        }
        filename = safeDecodeURIComponent(filename);
        if ( GUARD && confineToBase(filename, _staticBase) === null ) return '__404__';
        return fs.existsSync(filename) ? filename : '__404__';
    }

    // VERBATIM copy of getAssetFilenameFromUrl core (server.js) + optional guard
    function getAssetFilenameFromUrl(conf, url, GUARD) {
        url = safeDecodeURIComponent(url);
        var staticProps = {
            firstLevel : '/' + url.split(/\//g)[1] + '/',
            isFile     : /^\/[A-Za-z0-9_-]+\.(.*)$/.test(url)
        };
        var notFound = '404.html';
        var filename = null, p = null, altConf = false, _base = null;
        var staticsArr = conf.publicResources;
        if (
            staticProps.isFile && staticsArr.indexOf(url) > -1
            || staticsArr.indexOf(staticProps.firstLevel) > -1
            || altConf
        ) {
            p = url.replace(url.substring(url.lastIndexOf('/') + 1), '');
            if ( conf.staticResources.indexOf(p) > -1 || conf.staticResources.indexOf(staticProps.firstLevel) > -1 ) {
                filename = (conf.staticResources.indexOf(p) > -1) ? conf.content.statics[p] + url.replace(p, '/') : conf.content.statics[staticProps.firstLevel] + url.replace(staticProps.firstLevel, '/');
                _base    = (conf.staticResources.indexOf(p) > -1) ? conf.content.statics[p] : conf.content.statics[staticProps.firstLevel];
            } else {
                filename = ( conf.staticResources.indexOf(url) > -1 ) ? conf.content.statics[url] : conf.publicPath + url;
                _base    = ( conf.staticResources.indexOf(url) > -1 ) ? conf.content.statics[url] : conf.publicPath;
            }
            if ( GUARD && confineToBase(filename, _base) === null ) return notFound;
            if ( !fs.existsSync(filename) ) return notFound;
            return filename;
        }
        return notFound;
    }

    function isSecret(fname) {
        return typeof fname === 'string' && fname !== '__404__' && fname !== '404.html'
            && path.resolve(fname) === path.resolve(path.join(SHARED, 'config', 'secret.json'));
    }
    function isSibling(fname) {
        return typeof fname === 'string' && fname !== '__404__' && fname !== '404.html'
            && path.resolve(fname) === path.resolve(path.join(SHARED, 'js', 'vendor', 'lib-secrets', 'k.js'));
    }

    var TRAVERSALS = {
        'literal ../'        : '/js/vendor/lib/../../../config/secret.json',
        '%2F encoded slash'  : '/js/vendor/lib/..%2F..%2F..%2Fconfig/secret.json',
        '%2e%2e encoded dots': '/js/vendor/lib/%2e%2e/%2e%2e/%2e%2e/config/secret.json'
    };
    var SIBLINGS = {
        'sibling literal'  : '/js/vendor/lib/../lib-secrets/k.js',
        'sibling %2e%2e'   : '/js/vendor/lib/%2e%2e/lib-secrets/k.js'
    };

    // §04 — with the guard (the fix)
    it('handleStatics: legit asset still served', function() {
        var f = handleStaticsBuild(bundleConf, '/js/vendor/lib/real-asset.js', true, true);
        assert.equal(path.basename(f), 'real-asset.js');
    });

    Object.keys(TRAVERSALS).forEach(function(name) {
        it('handleStatics: ' + name + ' → 404 (blocked)', function() {
            var f = handleStaticsBuild(bundleConf, TRAVERSALS[name], true, true);
            assert.equal(f, '__404__');
            assert.ok(!isSecret(f), 'must not resolve to secret.json');
        });
    });

    Object.keys(SIBLINGS).forEach(function(name) {
        it('handleStatics: ' + name + ' → 404 (sibling-dir bypass blocked)', function() {
            var f = handleStaticsBuild(bundleConf, SIBLINGS[name], true, true);
            assert.equal(f, '__404__');
            assert.ok(!isSibling(f), 'must not resolve to the lib-secrets sibling');
        });
    });

    it('getAssetFilenameFromUrl: legit asset still served', function() {
        var f = getAssetFilenameFromUrl(bundleConfFL, '/js/vendor/lib/real-asset.js', true);
        assert.equal(path.basename(f), 'real-asset.js');
    });

    Object.keys(TRAVERSALS).forEach(function(name) {
        it('getAssetFilenameFromUrl (mapped branch): ' + name + ' → 404 (blocked)', function() {
            var f = getAssetFilenameFromUrl(bundleConfFL, TRAVERSALS[name], true);
            assert.equal(f, '404.html');
            assert.ok(!isSecret(f), 'must not resolve to secret.json');
        });
    });

    it('getAssetFilenameFromUrl (publicPath fallback branch): escape → 404', function() {
        // firstLevel '/pub/' is a public resource but not a statics mapping → publicPath + url
        var conf = {
            publicPath      : path.join(SHARED, 'public'),
            server          : { webroot: '/' },
            staticResources : [],
            publicResources : ['/pub/'],
            content         : { statics: {} }
        };
        var f = getAssetFilenameFromUrl(conf, '/pub/../config/secret.json', true);
        assert.equal(f, '404.html');
        assert.ok(!isSecret(f));
    });

    // §05 — subtract: the SAME inputs WITHOUT the guard leak the secret
    it('SUBTRACT: without the guard, handleStatics leaks secret.json (proves the guard is load-bearing)', function() {
        var leaked = handleStaticsBuild(bundleConf, TRAVERSALS['literal ../'], true, false);
        assert.ok(isSecret(leaked), 'pre-fix code MUST leak secret.json — else the test is not exercising the bug');
    });

    it('SUBTRACT: without the guard, getAssetFilenameFromUrl leaks secret.json', function() {
        var leaked = getAssetFilenameFromUrl(bundleConfFL, TRAVERSALS['literal ../'], false);
        assert.ok(isSecret(leaked), 'pre-fix code MUST leak secret.json');
    });

    it('SUBTRACT: without the guard, all three encodings leak (both resolvers)', function() {
        Object.keys(TRAVERSALS).forEach(function(name) {
            assert.ok(isSecret(handleStaticsBuild(bundleConf, TRAVERSALS[name], true, false)),
                'handleStatics pre-fix must leak for ' + name);
            assert.ok(isSecret(getAssetFilenameFromUrl(bundleConfFL, TRAVERSALS[name], false)),
                'getAssetFilenameFromUrl pre-fix must leak for ' + name);
        });
    });
});
