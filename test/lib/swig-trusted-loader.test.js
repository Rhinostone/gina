/**
 * lib/swig-trusted-loader — per-bundle `trustedRoots` opt-out to swig-core's
 * filesystem-loader basepath confinement (CVE-2023-25345).
 *
 * build(swig, dir, trustedRoots):
 *   - empty / absent / non-array trustedRoots → the stock confined
 *     swig.loaders.fs(dir): in-root allowed, every out-of-root path throws.
 *   - one or more trustedRoots → a gina-owned fail-closed loader that allows a
 *     resolution under `dir` OR under any declared trusted root (each relative
 *     to `dir`, or absolute) and throws the CVE-style error otherwise.
 * isTrustedPath(resolvedPath, dir, trustedRoots): the reusable predicate.
 *
 * Confined-by-default + opt-out: untrusted paths stay confined; only declared
 * sibling dirs can be resolved out-of-root. Containment is separator-safe
 * (`/x/shared-evil` is NOT under `/x/shared`). Loader path only — the top-level
 * {% extends %} boundary is unaffected (gina guards it in render-swig.js).
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var os     = require('os');
var { describe, it, after } = require('node:test');
var assert = require('node:assert/strict');

var FW   = require('../fw');
var stl  = require(path.join(FW, 'lib/swig-trusted-loader'));
var swig = require(path.join(FW, 'node_modules/@rhinostone/swig'));

// neutral fixture roots (resolve()/isTrustedPath() tests need no real files)
var ROOT       = path.join(os.tmpdir(), 'gina-trusted-roots-test', 'bundles', 'b', 'templates', 'html');
var SHARED_ABS = path.normalize(path.resolve(ROOT, '../shared'));   // sibling, declared trusted

function tryResolve(loader, p) {
    try { return { ok: true, resolved: loader.resolve(p) }; }
    catch (e) { return { ok: false, msg: e.message }; }
}

// ---------------------------------------------------------------------------
// 01 - confined-by-default (no trustedRoots): behaves like swig.loaders.fs(dir)
// ---------------------------------------------------------------------------
describe('01 - build(): confined by default (no trustedRoots)', function () {

    [ [], undefined, null, 'notanarray', {} ].forEach(function (cfg, i) {
        it('confined for trustedRoots = ' + JSON.stringify(cfg) + ' (#' + i + ')', function () {
            var L = stl.build(swig, ROOT, cfg);
            // in-root resolves
            assert.equal(L.resolve('home/index.html'), path.resolve(ROOT, 'home/index.html'));
            // out-of-root sibling throws CVE
            assert.throws(function () { L.resolve('../shared/x.css'); }, /CVE-2023-25345/);
            // deep traversal throws CVE
            assert.throws(function () { L.resolve('../../../../etc/passwd'); }, /CVE-2023-25345/);
        });
    });

    it('confined-default is the STOCK swig.loaders.fs(dir) (behavioural equivalence)', function () {
        var mine  = stl.build(swig, ROOT, []);
        var stock = swig.loaders.fs(ROOT);
        // identical accept
        assert.equal(mine.resolve('a/b.html'), stock.resolve('a/b.html'));
        // identical reject
        assert.throws(function () { stock.resolve('../shared/x'); }, /CVE-2023-25345/);
        assert.throws(function () { mine.resolve('../shared/x'); },  /CVE-2023-25345/);
    });
});

// ---------------------------------------------------------------------------
// 02 - trustedRoots opt-out: only the declared sibling escapes confinement
// ---------------------------------------------------------------------------
describe('02 - build(): trustedRoots allowlist', function () {

    var L = stl.build(swig, ROOT, ['../shared']);

    it('an in-root path is allowed', function () {
        assert.equal(L.resolve('home/index.html'), path.resolve(ROOT, 'home/index.html'));
    });

    it('a path under the declared trusted sibling is allowed', function () {
        var r = tryResolve(L, '../shared/x.css');
        assert.ok(r.ok, 'expected allow, got: ' + r.msg);
        assert.equal(r.resolved, path.normalize(path.join(SHARED_ABS, 'x.css')));
    });

    it('the declared trusted directory ITSELF is allowed', function () {
        assert.equal(L.resolve('../shared'), SHARED_ABS);
    });

    it('an UNDECLARED out-of-root sibling still throws (CVE-2023-25345)', function () {
        assert.throws(function () { L.resolve('../other/x.css'); }, /CVE-2023-25345/);
    });

    it('a sibling whose name merely SHARES A PREFIX is NOT trusted (../shared-evil)', function () {
        assert.throws(function () { L.resolve('../shared-evil/x'); }, /CVE-2023-25345/);
    });

    it('a deep traversal still throws (CVE-2023-25345)', function () {
        assert.throws(function () { L.resolve('../../../../etc/passwd'); }, /CVE-2023-25345/);
    });

    it('an absolute trustedRoot entry is honoured', function () {
        var abs = path.join(os.tmpdir(), 'gina-abs-trusted-' + process.pid);
        var La  = stl.build(swig, ROOT, [abs]);
        assert.equal(La.resolve(path.join(abs, 'x.html')), path.join(abs, 'x.html'));
        assert.throws(function () { La.resolve('../shared/x'); }, /CVE-2023-25345/);
    });

    it('blank / non-string entries are ignored (only "../shared" survives)', function () {
        var Lm = stl.build(swig, ROOT, [null, '', '   ', 123, '../shared']);
        assert.ok(tryResolve(Lm, '../shared/x').ok, 'the declared dir is still trusted');
        assert.throws(function () { Lm.resolve('../other/x'); }, /CVE-2023-25345/);
    });
});

// ---------------------------------------------------------------------------
// 03 - load() gates the file read through resolve (real files)
// ---------------------------------------------------------------------------
describe('03 - load() enforces the allowlist on the file read', function () {

    var base   = path.join(os.tmpdir(), 'gina-trusted-load-' + process.pid);
    var root   = path.join(base, 'bundles', 'b', 'templates', 'html');
    var shared = path.join(base, 'bundles', 'b', 'templates', 'shared');
    var other  = path.join(base, 'bundles', 'b', 'templates', 'other');

    after(function () { try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* best effort */ } });

    it('sync load() reads a trusted out-of-root file and rejects an untrusted one', function () {
        fs.mkdirSync(root,   { recursive: true });
        fs.mkdirSync(shared, { recursive: true });
        fs.mkdirSync(other,  { recursive: true });
        fs.writeFileSync(path.join(shared, 'asset.css'), 'TRUSTED-BODY', 'utf8');
        fs.writeFileSync(path.join(other,  'secret.txt'), 'SECRET', 'utf8');

        var L = stl.build(swig, root, ['../shared']);
        assert.equal(L.load('../shared/asset.css'), 'TRUSTED-BODY');
        assert.throws(function () { L.load('../other/secret.txt'); }, /CVE-2023-25345/);
    });

    it('callback load() (arity 2) is preserved and also gated', function (t, done) {
        var L = stl.build(swig, root, ['../shared']);
        assert.equal(L.load.length, 2, 'load keeps arity 2 (swig cb-path dispatch)');
        L.load('../shared/asset.css', function (err, src) {
            try {
                assert.equal(err, null);
                assert.equal(src, 'TRUSTED-BODY');
                done();
            } catch (e) { done(e); }
        });
    });
});

// ---------------------------------------------------------------------------
// 04 - isTrustedPath predicate truth-table
// ---------------------------------------------------------------------------
describe('04 - isTrustedPath() predicate', function () {

    it('in-root is always trusted (no roots needed)', function () {
        assert.equal(stl.isTrustedPath(path.resolve(ROOT, 'home/x'), ROOT, []), true);
    });
    it('out-of-root is NOT trusted without a declaration', function () {
        assert.equal(stl.isTrustedPath(path.resolve(ROOT, '../shared/x'), ROOT, []), false);
    });
    it('out-of-root under a declared root IS trusted', function () {
        assert.equal(stl.isTrustedPath(path.resolve(ROOT, '../shared/x'), ROOT, ['../shared']), true);
    });
    it('out-of-root under an UNdeclared sibling is NOT trusted', function () {
        assert.equal(stl.isTrustedPath(path.resolve(ROOT, '../other/x'), ROOT, ['../shared']), false);
    });
    it('a sibling-prefix path is NOT trusted (root containment is separator-safe)', function () {
        assert.equal(stl.isTrustedPath(path.normalize(ROOT + '-evil') + path.sep + 'x', ROOT, []), false);
    });
    it('the declared trusted directory itself is trusted', function () {
        assert.equal(stl.isTrustedPath(SHARED_ABS, ROOT, ['../shared']), true);
    });
});

// ---------------------------------------------------------------------------
// 05 - behavioural: real swig.compile include chain through the loader
// ---------------------------------------------------------------------------
describe('05 - swig.compile include chain honours the allowlist', function () {

    var base   = path.join(os.tmpdir(), 'gina-trusted-compile-' + process.pid);
    var root   = path.join(base, 'bundles', 'b', 'templates', 'html');
    var shared = path.join(base, 'bundles', 'b', 'templates', 'shared');
    var other  = path.join(base, 'bundles', 'b', 'templates', 'other');

    after(function () { try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* best effort */ } });

    it('renders a page that {% include %}s a TRUSTED out-of-root partial', function () {
        fs.mkdirSync(root,   { recursive: true });
        fs.mkdirSync(shared, { recursive: true });
        fs.mkdirSync(other,  { recursive: true });
        fs.writeFileSync(path.join(shared, 'partial.html'), 'SHARED-PARTIAL-OK', 'utf8');
        fs.writeFileSync(path.join(other,  'secret.html'),  'SECRET', 'utf8');

        swig.setDefaults({ loader: stl.build(swig, root, ['../shared']), cache: false });
        var page = 'before {% include "../shared/partial.html" %} after';
        var out;
        assert.doesNotThrow(function () {
            out = swig.compile(page, { filename: path.join(root, 'page.html') })({});
        });
        assert.match(out, /SHARED-PARTIAL-OK/);
    });

    it('REJECTS a page that {% include %}s an UNTRUSTED out-of-root partial (CVE-2023-25345)', function () {
        swig.setDefaults({ loader: stl.build(swig, root, ['../shared']), cache: false });
        var page = '{% include "../other/secret.html" %}';
        assert.throws(function () {
            swig.compile(page, { filename: path.join(root, 'evil.html') })({});
        }, /CVE-2023-25345|resolves outside/);
    });

    it('confined-default REJECTS the same out-of-root include (no trustedRoots)', function () {
        swig.setDefaults({ loader: stl.build(swig, root, []), cache: false });
        var page = '{% include "../shared/partial.html" %}';
        assert.throws(function () {
            swig.compile(page, { filename: path.join(root, 'page.html') })({});
        }, /CVE-2023-25345|resolves outside/);
    });
});
