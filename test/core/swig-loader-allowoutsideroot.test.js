/**
 * swig-core (CVE-2023-25345) loader basepath confinement — gina opt-out.
 *
 * swig-core >= 2.7.1 confines the filesystem loader to its basepath and rejects
 * include/extends/import paths that resolve outside it. gina legitimately
 * resolves templates OUTSIDE the bundle templates root in two framework-managed,
 * trusted ways:
 *   - the processed layout cache: render-swig.js rewrites a template's
 *     {% extends "layout.html" %} to an absolute path under cachePath (a sibling
 *     `cache/` tree, structurally outside the templates root) and lets swig
 *     resolve it at compile time;
 *   - dev-only framework includes: the inspector statusbar is injected as
 *     {% include "<framework-core>/asset/.../statusbar.html" %} (absolute path
 *     into the framework dir, also outside the templates root).
 * Both gina loader construction sites therefore pass allowOutsideRoot=true so
 * these trusted framework paths resolve. Untrusted {% extends %} / page-file
 * paths remain guarded by render-swig.js's own boundary checks (the same
 * CVE-2023-25345 defense that predates the swig-core confinement).
 *
 * (a) behavioural — the installed swig-core confines by default and the
 *     allowOutsideRoot=true opt-out lifts it for an out-of-root path shaped
 *     exactly like the layout-cache path that triggered the regression;
 * (b) source pins — both loader sites pass the opt-out and carry the rationale
 *     comment, and neither leaves a bare confined fs(dir) loader (the pre-fix
 *     shape that broke on the out-of-root cache path).
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var os     = require('os');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW             = require('../fw');
var SERVER_SRC     = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var CONTROLLER_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var swig           = require(path.join(FW, 'node_modules/@rhinostone/swig'));

// ---------------------------------------------------------------------------
// 01 - behavioural: swig-core confinement + allowOutsideRoot opt-out
// ---------------------------------------------------------------------------

describe('01 - swig-core loader confinement + allowOutsideRoot opt-out', function () {

    var root    = path.join(os.tmpdir(), 'gina-swig-conf-test', 'src', 'templates', 'html');
    // shaped like the regression: a sibling cache/ tree outside the templates root
    var outside = path.join(os.tmpdir(), 'gina-swig-conf-test', 'cache', 'swig', 'home', 'layout.html');

    it('confined loader (default) rejects an out-of-root path (CVE-2023-25345)', function () {
        var confined = swig.loaders.fs(root);
        assert.throws(function () { confined.resolve(outside); }, /CVE-2023-25345/);
    });

    it('allowOutsideRoot=true lifts the confinement (resolve does not throw)', function () {
        var opened = swig.loaders.fs(root, 'utf8', true);
        assert.doesNotThrow(function () { opened.resolve(outside); });
        assert.equal(opened.resolve(outside), path.resolve(outside));
    });

    it('an in-root relative path resolves identically under both (only confinement changes)', function () {
        var confined = swig.loaders.fs(root);
        var opened   = swig.loaders.fs(root, 'utf8', true);
        var inroot   = confined.resolve('home/index.html');
        assert.ok(inroot.indexOf(path.resolve(root) + path.sep) === 0, 'in-root path stays under root');
        assert.equal(opened.resolve('home/index.html'), inroot);
    });

    it('the opt-out is the ONLY behavioural delta (same path: default throws, opt-out allows)', function () {
        assert.throws(function () { swig.loaders.fs(root).resolve(outside); }, /CVE-2023-25345/);
        assert.doesNotThrow(function () { swig.loaders.fs(root, 'utf8', true).resolve(outside); });
    });
});

// ---------------------------------------------------------------------------
// 02 - source pins: both gina loader sites pass allowOutsideRoot=true
// ---------------------------------------------------------------------------

describe('02 - gina loader sites opt out of basepath confinement', function () {

    it('server.js initSwigEngine builds the loader with allowOutsideRoot=true', function () {
        assert.match(SERVER_SRC, /swig\.loaders\.fs\(dir,\s*'utf8',\s*true\)/);
    });

    it('controller.js per-request loader passes allowOutsideRoot=true', function () {
        assert.match(CONTROLLER_SRC, /swig\.loaders\.fs\(dir,\s*'utf8',\s*true\)/);
    });

    it('server.js documents the rationale (allowOutsideRoot + CVE-2023-25345) so the args are not stripped', function () {
        var idx = SERVER_SRC.indexOf("swig.loaders.fs(dir, 'utf8', true)");
        assert.ok(idx > 0, 'opt-out loader present in server.js');
        var window = SERVER_SRC.slice(Math.max(0, idx - 800), idx);
        assert.match(window, /allowOutsideRoot/);
        assert.match(window, /CVE-2023-25345/);
    });

    it('controller.js documents the rationale (allowOutsideRoot)', function () {
        var idx = CONTROLLER_SRC.indexOf("swig.loaders.fs(dir, 'utf8', true)");
        assert.ok(idx > 0, 'opt-out loader present in controller.js');
        var window = CONTROLLER_SRC.slice(Math.max(0, idx - 600), idx);
        assert.match(window, /allowOutsideRoot/);
    });

    it('neither site leaves a bare confined fs(dir) loader (regression guard)', function () {
        // the bare swig.loaders.fs(dir) form was the pre-fix shape that threw
        // on the out-of-root layout-cache path under swig-core >= 2.7.1
        assert.doesNotMatch(SERVER_SRC, /swig\.loaders\.fs\(dir\)/);
        assert.doesNotMatch(CONTROLLER_SRC, /swig\.loaders\.fs\(dir\)/);
    });
});
