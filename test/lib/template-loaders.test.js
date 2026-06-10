/**
 * #TPL1 — lib/template-loaders: async template-loader extension point.
 *
 * Covers the factory + guard contract (build / wrapWithGuard /
 * assertSafeIdentifier), the in-memory built-in loader, and a behavioural
 * end-to-end render through the framework swig proving the guarded loader
 * drives swig's async getTemplate path (extends + include through the loader)
 * and isolates per-instance.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var http   = require('http');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');
var tl = require(path.join(FW, 'lib/template-loaders/src/main'));


// ---------------------------------------------------------------------------
// 01 - build() factory
// ---------------------------------------------------------------------------

describe('01 - build()', function () {

    it('returns null when no loader is configured', function () {
        assert.equal(tl.build(null), null);
        assert.equal(tl.build(undefined), null);
    });

    it('builds the memory built-in and flags it async', function () {
        var loader = tl.build({ type: 'memory', templates: { 'a.html': 'hi' } });
        assert.equal(loader.async, true);
        assert.equal(typeof loader.resolve, 'function');
        assert.equal(typeof loader.load, 'function');
    });

    it('throws on an unknown loader type', function () {
        assert.throws(function () { tl.build({ type: 'redis' }); }, /unknown loader type/);
    });

    it('throws on a non-string / missing type', function () {
        assert.throws(function () { tl.build({}); }, /unknown loader type/);
        assert.throws(function () { tl.build({ type: 42 }); }, /unknown loader type/);
    });

    it('propagates the built-in factory config error (fail-fast)', function () {
        // memory requires a `templates` object map
        assert.throws(function () { tl.build({ type: 'memory' }); }, /templates/);
        assert.throws(function () { tl.build({ type: 'memory', templates: [] }); }, /templates/);
    });
});


// ---------------------------------------------------------------------------
// 02 - memory loader contract
// ---------------------------------------------------------------------------

describe('02 - memory loader', function () {

    var loader;
    before(function () {
        loader = tl.build({ type: 'memory', templates: { 'index.html': '<h1>{{ t }}</h1>', 'sub/p.html': 'P' } });
    });

    it('resolve() is identity (the identifier IS the key)', function () {
        assert.equal(loader.resolve('index.html'), 'index.html');
        assert.equal(loader.resolve('sub/p.html'), 'sub/p.html');
    });

    it('load.length is 2 so swig.getTemplate picks the callback path', function () {
        assert.equal(loader.load.length, 2);
    });

    it('load(id, cb) returns the source for a known identifier', function (t, done) {
        loader.load('index.html', function (err, src) {
            assert.equal(err, null);
            assert.equal(src, '<h1>{{ t }}</h1>');
            done();
        });
    });

    it('load(id, cb) errors for a missing identifier', function (t, done) {
        loader.load('nope.html', function (err, src) {
            assert.ok(err);
            assert.match(err.message, /template not found/);
            done();
        });
    });
});


// ---------------------------------------------------------------------------
// 03 - CVE-2023-25345 segment-guard
// ---------------------------------------------------------------------------

describe('03 - segment-guard', function () {

    it('assertSafeIdentifier rejects parent traversal', function () {
        assert.throws(function () { tl.assertSafeIdentifier('../../etc/passwd'); }, /CVE-2023-25345/);
        assert.throws(function () { tl.assertSafeIdentifier('a/../../b'); }, /CVE-2023-25345/);
    });

    it('assertSafeIdentifier rejects absolute paths', function () {
        assert.throws(function () { tl.assertSafeIdentifier('/etc/passwd'); }, /absolute/);
        assert.throws(function () { tl.assertSafeIdentifier('\\windows'); }, /absolute/);
    });

    it('assertSafeIdentifier rejects empty / non-string identifiers', function () {
        assert.throws(function () { tl.assertSafeIdentifier(''); }, /invalid template identifier/);
        assert.throws(function () { tl.assertSafeIdentifier(null); }, /invalid template identifier/);
    });

    it('assertSafeIdentifier accepts plain relative identifiers', function () {
        assert.doesNotThrow(function () { tl.assertSafeIdentifier('index.html'); });
        assert.doesNotThrow(function () { tl.assertSafeIdentifier('account/profile.html'); });
    });

    it('the guard fires through the built loader resolve() (covers extends/include targets)', function () {
        var loader = tl.build({ type: 'memory', templates: { 'a.html': 'x' } });
        assert.throws(function () { loader.resolve('../../../etc/passwd'); }, /CVE-2023-25345|traversal/);
        assert.doesNotThrow(function () { loader.resolve('a.html'); });
    });

    it('wrapWithGuard preserves load arity (.length) so swig keeps the callback path', function () {
        var raw = { async: true, resolve: function (t) { return t; }, load: function (id, cb) { cb(null, ''); } };
        var wrapped = tl.wrapWithGuard(raw);
        assert.equal(wrapped.load.length, 2);
    });

    it('wrapWithGuard rejects a loader missing resolve/load', function () {
        assert.throws(function () { tl.wrapWithGuard({ load: function () {} }); }, /must expose resolve/);
        assert.throws(function () { tl.wrapWithGuard({ resolve: function () {} }); }, /must expose resolve/);
    });
});


// ---------------------------------------------------------------------------
// 04 - behavioural: render through the guarded loader (framework swig)
// ---------------------------------------------------------------------------

describe('04 - behavioural render through a guarded loader', function () {

    var swig;
    before(function () {
        // Same swig copy the framework resolves at runtime (async loader needs >= 2.2.0).
        swig = require(path.join(FW, 'node_modules/@rhinostone/swig'));
    });

    it('renders {% extends %} + {% include %} through the async loader', async function () {
        var loader = tl.build({ type: 'memory', templates: {
            'base.html'   : '<html><body>[BASE]{% block content %}{% endblock %}</body></html>',
            'partial.html': '(inc:{{ name }})',
            'page.html'   : '{% extends "base.html" %}{% block content %}P:{{ name }} {% include "partial.html" %}{% endblock %}'
        }});
        var engine = new swig.Swig({ loader: loader, autoescape: false, cache: false });
        var fn = await engine.getTemplate('page.html');
        var out = await fn({ name: 'alice' });
        assert.equal(out.output, '<html><body>[BASE]P:alice (inc:alice)</body></html>');
    });

    it('two engines with different loaders do NOT collide (per-bundle isolation)', async function () {
        var A = new swig.Swig({ loader: tl.build({ type: 'memory', templates: { 'page.html': 'A:{{ name }}' } }), cache: false });
        var B = new swig.Swig({ loader: tl.build({ type: 'memory', templates: { 'page.html': 'B:{{ name }}' } }), cache: false });
        var a = await (await A.getTemplate('page.html'))({ name: 'x' });
        var b = await (await B.getTemplate('page.html'))({ name: 'y' });
        assert.equal(a.output, 'A:x');
        assert.equal(b.output, 'B:y');
        // A again after B — no cross-instance contamination
        var a2 = await (await A.getTemplate('page.html'))({ name: 'z' });
        assert.equal(a2.output, 'A:z');
    });

    it('blocks a malicious {% extends "../../../etc/passwd" %} at load time', async function () {
        var evil = new swig.Swig({ loader: tl.build({ type: 'memory', templates: { 'evil.html': '{% extends "../../../etc/passwd" %}' } }), cache: false });
        await assert.rejects(async function () {
            await (await evil.getTemplate('evil.html'))({});
        }, /CVE-2023-25345|traversal/);
    });
});


// ---------------------------------------------------------------------------
// 05 - http loader: build() dispatch + config validation (no network)
// ---------------------------------------------------------------------------

describe('05 - http loader build / validation', function () {

    it('builds the http built-in, flags it async, keeps the cb-arity load', function () {
        var loader = tl.build({ type: 'http', origin: 'https://cdn.example.com', basePath: '/templates' }, { bundle: 'site' });
        assert.equal(loader.async, true);
        assert.equal(typeof loader.resolve, 'function');
        assert.equal(loader.load.length, 2); // swig.getTemplate picks the callback path on load.length >= 2
    });

    it('fail-fast: throws when origin is missing', function () {
        assert.throws(function () { tl.build({ type: 'http' }); }, /origin/);
        assert.throws(function () { tl.build({ type: 'http', origin: '' }); }, /origin/);
    });

    it('fail-fast: throws when origin is not an http(s) URL', function () {
        assert.throws(function () { tl.build({ type: 'http', origin: 'not a url' }); }, /origin/);
        assert.throws(function () { tl.build({ type: 'http', origin: 'ftp://x.example' }); }, /http or https/);
    });
});


// ---------------------------------------------------------------------------
// 06 - http loader: resolve() containment (no network)
// ---------------------------------------------------------------------------

describe('06 - http loader resolve containment', function () {

    var loader;
    before(function () {
        loader = tl.build({ type: 'http', origin: 'https://cdn.example.com', basePath: '/templates' }, { bundle: 'site' });
    });

    it('resolves a plain identifier to an absolute URL under origin+basePath', function () {
        assert.equal(loader.resolve('pages/home.html'), 'https://cdn.example.com/templates/pages/home.html');
    });

    it('resolves with no basePath against the origin root', function () {
        var L = tl.build({ type: 'http', origin: 'https://cdn.example.com' }, { bundle: 'site' });
        assert.equal(L.resolve('home.html'), 'https://cdn.example.com/home.html');
    });

    it('rejects an absolute-URL identifier that swaps the origin (containment, not the segment guard)', function () {
        assert.throws(function () { loader.resolve('http://evil.com/x.html'); }, /escapes configured origin/);
    });

    it('rejects a protocol-relative identifier (caught by the absolute-path guard)', function () {
        // `//evil.com/x` starts with `/`, so the segment-guard's absolute check
        // rejects it before the http resolve's containment check even runs —
        // either layer rejecting it is the point (the origin-swap containment
        // path is separately covered by the http://evil.com case above).
        assert.throws(function () { loader.resolve('//evil.com/x.html'); }, /absolute|escapes configured origin/);
    });

    it('the CVE segment-guard still fires first through the built loader', function () {
        assert.throws(function () { loader.resolve('../../../etc/passwd'); }, /CVE-2023-25345|traversal/);
    });
});


// ---------------------------------------------------------------------------
// 07 - http loader: load() over a localhost server + source cache + ETag
// ---------------------------------------------------------------------------

describe('07 - http loader load + source cache (localhost)', function () {

    var server, port, hits, _savedCache;

    before(async function () {
        // Stand up process.gina._cache the way the request pipeline does at
        // runtime (controller.js points the shared instance at the server Map).
        if (!process.gina) { process.gina = {}; }
        _savedCache = process.gina._cache;
        var Cache = require(path.join(FW, 'lib/cache/src/main'));
        process.gina._cache = new Cache();
        process.gina._cache.from(new Map());

        hits = {};
        server = http.createServer(function (req, res) {
            hits[req.url] = (hits[req.url] || 0) + 1;
            if (req.url === '/t/page.html') {
                var etag = '"v1"';
                if (req.headers['if-none-match'] === etag) {
                    res.writeHead(304, { 'ETag': etag });
                    return res.end();
                }
                res.writeHead(200, { 'ETag': etag, 'Content-Type': 'text/html' });
                return res.end('PAGE-BODY');
            }
            if (req.url === '/t/noetag.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end('NOETAG-BODY');
            }
            // extends + include chain for the end-to-end swig-async render test (e)
            if (req.url === '/t/base.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end('<html><body>[BASE]{% block content %}{% endblock %}</body></html>');
            }
            if (req.url === '/t/partial.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end('(inc:{{ name }})');
            }
            if (req.url === '/t/tpl.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end('{% extends "base.html" %}{% block content %}P:{{ name }} {% include "partial.html" %}{% endblock %}');
            }
            res.writeHead(404);
            res.end('not found');
        });
        await new Promise(function (resolve) {
            server.listen(0, '127.0.0.1', function () { port = server.address().port; resolve(); });
        });
    });

    after(function () {
        if (server) { server.close(); }
        try { http.globalAgent.destroy(); } catch (e) {} // drop keep-alive sockets so the test exits
        if (process.gina && process.gina._cache) { process.gina._cache.clear(); } // clear pending TTL timers
        process.gina._cache = _savedCache;
    });

    function mkLoader(opts) {
        opts = opts || {};
        return tl.build({
            type:       'http',
            origin:     'http://127.0.0.1:' + port,
            basePath:   '/t',
            revalidate: (opts.revalidate === true),
            ttl:        60
        }, { bundle: 'site' });
    }

    it('(a) cold load fetches and returns the source (200)', function (t, done) {
        var L = mkLoader({ revalidate: true });
        L.load(L.resolve('page.html'), function (err, src) {
            assert.equal(err, null);
            assert.equal(src, 'PAGE-BODY');
            assert.equal(hits['/t/page.html'], 1);
            done();
        });
    });

    it('(b) warm load with revalidate issues a conditional GET, gets 304, serves cached', function (t, done) {
        var L = mkLoader({ revalidate: true });
        L.load(L.resolve('page.html'), function (err, src) {
            assert.equal(err, null);
            assert.equal(src, 'PAGE-BODY');        // served from cache
            assert.equal(hits['/t/page.html'], 2); // exactly one extra (the conditional revalidation GET)
            done();
        });
    });

    it('(c) a non-200 surfaces as a load error', function (t, done) {
        var L = mkLoader();
        L.load(L.resolve('nope.html'), function (err, src) {
            assert.ok(err);
            assert.match(err.message, /404/);
            done();
        });
    });

    it('(d) revalidate:false serves a fresh cache hit WITHOUT re-fetching', function (t, done) {
        var L = mkLoader({ revalidate: false });
        L.load(L.resolve('noetag.html'), function (err, src) {
            assert.equal(err, null);
            assert.equal(src, 'NOETAG-BODY');
            assert.equal(hits['/t/noetag.html'], 1);
            // second load — cache hit, no revalidation → must NOT touch the server
            L.load(L.resolve('noetag.html'), function (err2, src2) {
                assert.equal(err2, null);
                assert.equal(src2, 'NOETAG-BODY');
                assert.equal(hits['/t/noetag.html'], 1); // still 1 — served from cache
                done();
            });
        });
    });

    it('(e) drives swig async extends+include through the http loader end-to-end', async function () {
        var swig   = require(path.join(FW, 'node_modules/@rhinostone/swig'));
        var engine = new swig.Swig({ loader: mkLoader(), autoescape: false, cache: false });
        // getTemplate('tpl.html') → resolve maps to the localhost URL → load
        // fetches it AND its transitive {% extends %}/{% include %} over http.
        var fn  = await engine.getTemplate('tpl.html', { filename: 'tpl.html' });
        var out = await fn({ name: 'alice' });
        assert.equal(out.output, '<html><body>[BASE]P:alice (inc:alice)</body></html>');
    });
});
