/**
 * swig-core (CVE-2023-25345) loader basepath confinement — gina posture (#TPL2).
 *
 * swig-core >= 2.7.1 confines the filesystem loader to its basepath and rejects
 * include/extends/import paths that resolve outside it. gina now keeps that
 * confinement ON for its default render path: both loader construction sites
 * build a bare, confined `swig.loaders.fs(dir)` (allowOutsideRoot defaults false),
 * and gina no longer produces ANY out-of-root template resolution —
 *   - the processed layout cache was relocated UNDER the bundle templates root:
 *     controller.render-swig.js rewrites the page's {% extends %} to an absolute
 *     path under `<templates.html>/.gina-layout-cache/...`, which resolves INSIDE
 *     the loader basepath; and
 *   - the dev inspector statusbar is INLINED into the layout string instead of
 *     being {% include %}-d from the framework core dir.
 * So every resolution — including untrusted nested {% include %} / {% import %} —
 * is now guarded by swig-core's confinement.
 *
 * This replaces the interim `allowOutsideRoot=true` opt-out (commit b7a022e9).
 *
 * (a) behavioural — the installed swig-core loader confines by default: it accepts
 *     an in-root path shaped exactly like the relocated layout cache, rejects both
 *     an out-of-root path (the OLD sibling-cache shape) and a `../` traversal, and
 *     enforces the same boundary through a real swig.compile({% extends %}) chain;
 * (b) source pins — both loader sites build the confined `fs(dir)` (no opt-out),
 *     and render-swig.js derives the cache in-root + inlines the statusbar.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var os     = require('os');
var { describe, it, after } = require('node:test');
var assert = require('node:assert/strict');

var FW              = require('../fw');
var SERVER_SRC      = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var CONTROLLER_SRC  = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var RENDER_SWIG_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.render-swig.js'), 'utf8');
var swig            = require(path.join(FW, 'node_modules/@rhinostone/swig'));

// ---------------------------------------------------------------------------
// 01 - behavioural: swig-core confinement is active on a bare fs(dir) loader
// ---------------------------------------------------------------------------

describe('01 - swig-core loader confinement (gina default posture)', function () {

    // the bundle templates root (the loader basepath)
    var root       = path.join(os.tmpdir(), 'gina-swig-conf-test', 'bundles', 'b', 'templates', 'html');
    // the RELOCATED layout cache: IN-ROOT, under the templates root (#TPL2)
    var inRoot     = path.join(root, '.gina-layout-cache', 'b', 'swig', 'home', 'layout.html');
    // the OLD sibling-cache shape: OUT-OF-ROOT (the regression the relocation fixes)
    var oldOutside = path.join(os.tmpdir(), 'gina-swig-conf-test', 'cache', 'b', 'swig', 'home', 'layout.html');

    it('confined loader (bare fs(dir)) ACCEPTS the in-root relocated layout-cache path', function () {
        var confined = swig.loaders.fs(root);
        assert.doesNotThrow(function () { confined.resolve(inRoot); });
        assert.equal(confined.resolve(inRoot), path.resolve(inRoot));
    });

    it('confined loader REJECTS the old out-of-root sibling-cache path (CVE-2023-25345)', function () {
        var confined = swig.loaders.fs(root);
        assert.throws(function () { confined.resolve(oldOutside); }, /CVE-2023-25345/);
    });

    it('confined loader REJECTS a `../` traversal include (CVE-2023-25345)', function () {
        var confined = swig.loaders.fs(root);
        assert.throws(function () { confined.resolve('../../../../etc/passwd'); }, /CVE-2023-25345/);
    });

    it('an in-root relative include resolves under the templates root', function () {
        var confined = swig.loaders.fs(root);
        var inrootRel = confined.resolve('home/index.html');
        assert.ok(inrootRel.indexOf(path.resolve(root) + path.sep) === 0, 'in-root path stays under root');
    });
});

// ---------------------------------------------------------------------------
// 02 - behavioural: confined loader inside a real swig.compile({% extends %})
// ---------------------------------------------------------------------------

describe('02 - confined loader in a swig.compile extends chain', function () {

    var base       = path.join(os.tmpdir(), 'gina-tpl2-render-' + process.pid);
    var root       = path.join(base, 'bundles', 'b', 'templates', 'html');
    var cacheDir   = path.join(root, '.gina-layout-cache', 'b', 'swig');
    var layoutFile = path.join(cacheDir, 'layout.html');

    after(function () {
        try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    it('renders a page that {% extends %} an IN-ROOT (relocated-cache) layout', function () {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(layoutFile, '<html><body>{% block c %}{% endblock %}</body></html>', 'utf8');
        swig.setDefaults({ loader: swig.loaders.fs(root), cache: false });
        var page = '{% extends "' + layoutFile + '" %}{% block c %}OK{% endblock %}';
        var out;
        assert.doesNotThrow(function () {
            out = swig.compile(page, { filename: path.join(root, 'page.html') })({});
        });
        assert.match(out, /OK/);
    });

    it('REJECTS a page that {% extends %} an OUT-OF-ROOT path (CVE-2023-25345)', function () {
        swig.setDefaults({ loader: swig.loaders.fs(root), cache: false });
        var evil = '{% extends "' + path.join(base, 'outside', 'evil.html') + '" %}';
        assert.throws(function () {
            var t = swig.compile(evil, { filename: path.join(root, 'evil.html') });
            t({});
        }, /CVE-2023-25345|resolves outside/);
    });
});

// ---------------------------------------------------------------------------
// 03 - source pins: both loader sites are confined (no allowOutsideRoot opt-out)
// ---------------------------------------------------------------------------

describe('03 - gina loader sites keep swig-core confinement', function () {

    it('server.js initSwigEngine builds the confined bare fs(dir) loader', function () {
        assert.match(SERVER_SRC, /loader:\s*swig\.loaders\.fs\(dir\),/);
    });

    it('controller.js per-request loader is the confined bare fs(dir)', function () {
        assert.match(CONTROLLER_SRC, /swigOptions\.loader = swig\.loaders\.fs\(dir\);/);
    });

    it('NEITHER site passes the allowOutsideRoot=true opt-out (regression guard)', function () {
        assert.doesNotMatch(SERVER_SRC,     /swig\.loaders\.fs\(dir,\s*'utf8',\s*true\)/);
        assert.doesNotMatch(CONTROLLER_SRC, /swig\.loaders\.fs\(dir,\s*'utf8',\s*true\)/);
    });

    it('server.js documents the CVE confinement rationale next to the loader', function () {
        var idx = SERVER_SRC.indexOf('loader: swig.loaders.fs(dir),');
        assert.ok(idx > 0, 'confined loader present in server.js');
        var win = SERVER_SRC.slice(Math.max(0, idx - 800), idx);
        assert.match(win, /CVE-2023-25345/);
        assert.match(win, /confine/i);
    });
});

// ---------------------------------------------------------------------------
// 04 - source pins: render-swig.js removes both out-of-root resolutions
// ---------------------------------------------------------------------------

describe('04 - render-swig.js: in-root layout cache + inlined statusbar', function () {

    it('derives the layout cache IN-ROOT under the templates root', function () {
        assert.match(RENDER_SWIG_SRC, /cachePath = localOptions\.template\.html \+ '\/\.gina-layout-cache'/);
    });

    it('no longer points the cache at the out-of-root server cache tree', function () {
        assert.doesNotMatch(RENDER_SWIG_SRC, /cachePath\s+=\s+self\.serverInstance\._cachePath/);
    });

    it('inlines the statusbar template (reads it) instead of {% include %}-ing it out-of-root', function () {
        assert.match(RENDER_SWIG_SRC, /_statusbarTpl = await fs\.promises\.readFile/);
        // the out-of-root {% include "<framework core>/...statusbar.html" %} directive,
        // built by string concat, must be gone (the readFile reference is NOT this shape)
        assert.doesNotMatch(RENDER_SWIG_SRC, /include "'\s*\+\s*getPath\('gina'\)\.core/);
    });

    it('drops a self-ignoring .gitignore so the in-root cache never surfaces in consumer git', function () {
        assert.match(RENDER_SWIG_SRC, /cachePath \+ '\/\.gitignore'/);
        assert.match(RENDER_SWIG_SRC, /fs\.writeFileSync\(_cacheIgnore, '\*\\n'\)/);
    });
});
