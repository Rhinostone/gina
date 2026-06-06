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
var { describe, it, before } = require('node:test');
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
