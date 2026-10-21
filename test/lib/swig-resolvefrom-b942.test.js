/**
 * #B942 — @rhinostone/swig up to 2.8.2 wrote the including template's
 * filename (the `filename` option, which swig carries as resolveFrom) into the
 * compiled template body without escaping it. A double quote in the filename
 * closed the string literal, so a template that includes, imports or extends
 * another failed to compile; and an async import, from or extends wrote a
 * backslash in the filename raw, which corrupted the path. 2.8.3 escapes the
 * filename wherever it is written, and both manifests now require it (^2.8.3).
 *
 * The arms compile through each copy gina resolves: the framework directory's
 * @rhinostone/swig, which a bundle in this tree renders with, and the
 * repository root's, which is what an application that installs gina gets.
 * gina hands swig the template's resolved path in its sync render and the
 * template's name in its async-loader render. 02 holds shapes that compiled
 * the same way before the fix, so a change elsewhere in the code generator
 * shows there.
 *
 * Seam: GINA_B942_SWIG_FROM=<dir> resolves @rhinostone/swig from that
 * directory only. On a 2.8.2 copy the 6 arms of 01 fail and the 5 arms of 02
 * pass; 03 reads this tree's two package.json files, so it fails on a tree
 * that still declares ^2.8.2.
 *
 * Run standalone:
 *   node --test test/lib/swig-resolvefrom-b942.test.js
 */

'use strict';

var fs       = require('fs');
var nodePath = require('path');
var { describe, it } = require('node:test');
var assert   = require('node:assert/strict');

var FW   = require('../fw');
var ROOT = nodePath.resolve(__dirname, '..', '..');

/** The release that escapes the filename everywhere it is written. */
var FIXED = [2, 8, 3];

/** A filename holding a double quote, and the literal 2.8.3 writes for it. */
var QUOTED         = 'a"b.html';
var QUOTED_LITERAL = 'resolveFrom: "a\\"b.html"';

/**
 * Walks up from a resolved module file to the directory of the package that
 * holds it.
 *
 * @inner
 * @param   {string} file - A file inside the package.
 * @param   {string} name - The package name to stop at.
 * @returns {string} The package directory.
 */
function packageDirOf(file, name) {
    var dir = nodePath.dirname(file);
    while ( dir !== nodePath.dirname(dir) ) {
        var pkgFile = nodePath.join(dir, 'package.json');
        if ( fs.existsSync(pkgFile) && JSON.parse(fs.readFileSync(pkgFile, 'utf8')).name === name ) {
            return dir;
        }
        dir = nodePath.dirname(dir);
    }
    throw new Error('no package.json named ' + name + ' above ' + file);
}

/**
 * Loads the @rhinostone/swig copy that resolves from `from`.
 *
 * @inner
 * @param   {string} from - The directory to resolve from.
 * @returns {{ path: string, version: string, swig: Object }}
 */
function loadCopy(from) {
    var main = require.resolve('@rhinostone/swig', { paths: [from] });
    var dir  = packageDirOf(main, '@rhinostone/swig');
    return {
        path   : dir,
        version: JSON.parse(fs.readFileSync(nodePath.join(dir, 'package.json'), 'utf8')).version,
        swig   : require(main)
    };
}

/**
 * The copies under test, one per distinct package directory.
 *
 * @inner
 * @returns {Array<{ label: string, path: string, version: string, swig: Object }>}
 */
function copies() {
    var roots = process.env.GINA_B942_SWIG_FROM
        ? [ ['GINA_B942_SWIG_FROM', nodePath.resolve(process.env.GINA_B942_SWIG_FROM)] ]
        : [ ['framework copy', FW], ['root copy', ROOT] ];
    var seen = {}, out = [];
    roots.forEach(function (r) {
        var c = loadCopy(r[1]);
        if ( seen[c.path] ) { seen[c.path].label += ' + ' + r[0]; return; }
        c.label = r[0];
        seen[c.path] = c;
        out.push(c);
    });
    return out;
}

/**
 * Compiles a template and returns the body of the compiled function.
 *
 * @inner
 * @param   {Object} swig    - The swig module under test.
 * @param   {string} src     - The template source.
 * @param   {Object} options - The compile options (filename, codegenMode).
 * @returns {string} The compiled function's source.
 */
function compiledBody(swig, src, options) {
    var tpl = swig.precompile(src, options).tpl;
    assert.equal(typeof tpl, 'function');
    return tpl.toString();
}

/**
 * Renders a template through an engine whose memory loader holds `store`.
 *
 * @inner
 * @param   {Object} swig     - The swig module under test.
 * @param   {string} src      - The template source.
 * @param   {string} filename - The including template's filename.
 * @returns {string} The rendered output.
 */
function renderWithStore(swig, src, filename) {
    var engine = new swig.Swig({
        cache : false,
        loader: swig.loaders.memory({ '/views/p.html': 'P' })
    });
    return engine.render(src, { filename: filename });
}

describe('#B942 — swig escapes the template filename in the compiled body', function () {

    copies().forEach(function (copy) {

        describe('01 a filename that holds a double quote or a backslash — ' + copy.label + ' ' + copy.version, function () {

            it('sync include, a double quote', function () {
                assert.ok(compiledBody(copy.swig, '{% include "p.html" %}', { filename: QUOTED }).indexOf(QUOTED_LITERAL) !== -1,
                    'escaped filename literal through @rhinostone/swig ' + copy.version + ' at ' + copy.path);
            });

            it('async include, a double quote', function () {
                assert.ok(compiledBody(copy.swig, '{% include "p.html" %}', { filename: QUOTED, codegenMode: 'async' }).indexOf(QUOTED_LITERAL) !== -1);
            });

            it('async import, a double quote', function () {
                assert.ok(compiledBody(copy.swig, '{% import "m.html" as m %}', { filename: QUOTED, codegenMode: 'async' }).indexOf(QUOTED_LITERAL) !== -1);
            });

            it('async extends, a double quote', function () {
                assert.ok(compiledBody(copy.swig, '{% extends "b.html" %}', { filename: QUOTED, codegenMode: 'async' }).indexOf(QUOTED_LITERAL) !== -1);
            });

            it('async import, a backslash path', function () {
                assert.ok(compiledBody(copy.swig, '{% import "m.html" as m %}', { filename: 'C:\\d\\f.html', codegenMode: 'async' })
                    .indexOf('resolveFrom: "C:\\\\d\\\\f.html"') !== -1);
            });

            it('an include under a quoted filename renders its sibling', function () {
                assert.equal(renderWithStore(copy.swig, '{% include "p.html" %}x', '/views/a"b.html'), 'Px');
            });
        });

        describe('02 controls: shapes that compiled the same way before 2.8.3 — ' + copy.label + ' ' + copy.version, function () {

            it('sync include, a plain filename keeps its literal', function () {
                assert.ok(compiledBody(copy.swig, '{% include "p.html" %}', { filename: 'plain.html' }).indexOf('resolveFrom: "plain.html"') !== -1);
            });

            it('async import, a plain filename keeps its literal', function () {
                assert.ok(compiledBody(copy.swig, '{% import "m.html" as m %}', { filename: 'plain.html', codegenMode: 'async' })
                    .indexOf('resolveFrom: "plain.html"') !== -1);
            });

            it('a template with no include, import or extends compiles under a quoted filename', function () {
                assert.equal(typeof copy.swig.precompile('{{ a }}', { filename: QUOTED }).tpl, 'function');
            });

            it('an include under a plain filename renders its sibling', function () {
                assert.equal(renderWithStore(copy.swig, '{% include "p.html" %}x', '/views/plain.html'), 'Px');
            });

            it('an include under a backslash filename renders its sibling (the path is not escaped twice)', function () {
                assert.equal(renderWithStore(copy.swig, '{% include "p.html" %}x', '/views/c\\d.html'), 'Px');
            });
        });
    });

    describe('03 both manifests require the fixed release', function () {

        it('package.json and the framework package.json declare the same ^2.x range, at 2.8.3 or later', function () {
            var ranges = [nodePath.join(ROOT, 'package.json'), nodePath.join(FW, 'package.json')].map(function (f) {
                var deps = JSON.parse(fs.readFileSync(f, 'utf8')).dependencies || {};
                return [f, deps['@rhinostone/swig']];
            });
            assert.equal(ranges[0][1], ranges[1][1], 'the two manifests differ: ' + JSON.stringify(ranges));
            var m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(ranges[0][1] || '');
            assert.ok(m, 'not a caret range: ' + ranges[0][1]);
            var floor = [+m[1], +m[2], +m[3]];
            assert.equal(floor[0], FIXED[0], 'major ' + floor[0]);
            assert.ok(floor[1] > FIXED[1] || (floor[1] === FIXED[1] && floor[2] >= FIXED[2]),
                'floor ' + floor.join('.') + ' is below ' + FIXED.join('.'));
        });
    });
});
