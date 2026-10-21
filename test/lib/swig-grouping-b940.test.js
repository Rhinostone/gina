/**
 * #B940 — @rhinostone/swig up to 2.8.1 dropped a grouping parenthesis when the
 * group's operator binds more loosely than the operator outside it, so a
 * template rendered a different expression with no error: {{ (1 + 2) * 3 }}
 * gave 7, and {% if (x or y) and z %} took its branch with x true and z false.
 * The same release line got three more shapes wrong: a comparison grouped
 * inside a comparison, a subscript on a `+` group, and a double minus, which
 * did not compile. 2.8.2 renders them all, and both manifests now require it
 * (^2.8.2).
 *
 * The arms render through each copy gina resolves: the framework directory's
 * @rhinostone/swig, which a bundle in this tree renders with, and the
 * repository root's, which is what an application that installs gina gets.
 * 02 holds shapes that rendered right before the fix as well (a group
 * followed by a filter, a member read on a filtered group, not (…), !(…),
 * parentheses around a whole condition, a grouping that matches JavaScript's
 * precedence), so a regression elsewhere in the parser shows there.
 *
 * Seam: GINA_B940_SWIG_FROM=<dir> resolves @rhinostone/swig from that
 * directory only. On a 2.8.1 copy the 8 arms of 01 fail and the 8 arms of 02
 * pass; 03 reads this tree's two package.json files, so it fails on a tree
 * that still declares ^2.7.2.
 *
 * Run standalone:
 *   node --test test/lib/swig-grouping-b940.test.js
 */

'use strict';

var fs       = require('fs');
var nodePath = require('path');
var { describe, it } = require('node:test');
var assert   = require('node:assert/strict');

var FW   = require('../fw');
var ROOT = nodePath.resolve(__dirname, '..', '..');

/** The release that renders every arm of 01. */
var FIXED = [2, 8, 2];

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
 * Loads the @rhinostone/swig copy that resolves from `from` and builds an
 * engine of its own with the two filters the arms use.
 *
 * @inner
 * @param   {string} from - The directory to resolve from.
 * @returns {{ path: string, version: string, engine: Object }}
 */
function loadCopy(from) {
    var main    = require.resolve('@rhinostone/swig', { paths: [from] });
    var dir     = packageDirOf(main, '@rhinostone/swig');
    var swig    = require(main);
    var engine  = new swig.Swig({ cache: false });
    // fmt: formats a number the way an application's number filter does;
    // anything else comes back visibly unformatted.
    engine.setFilter('fmt', function (v) {
        return typeof v === 'number' ? v.toFixed(2).replace('.', ',') : 'fmt(' + JSON.stringify(v) + ')';
    });
    // dl: returns an object, so the arm can read a member on the filtered group.
    engine.setFilter('dl', function () { return { kind: 'archived' }; });
    return {
        path   : dir,
        version: JSON.parse(fs.readFileSync(nodePath.join(dir, 'package.json'), 'utf8')).version,
        engine : engine
    };
}

/**
 * The copies under test, one per distinct package directory.
 *
 * @inner
 * @returns {Array<{ label: string, path: string, version: string, engine: Object }>}
 */
function copies() {
    var roots = process.env.GINA_B940_SWIG_FROM
        ? [ ['GINA_B940_SWIG_FROM', nodePath.resolve(process.env.GINA_B940_SWIG_FROM)] ]
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
 * Renders a template string through an engine.
 *
 * @inner
 * @param   {Object} engine
 * @param   {string} src
 * @param   {Object} locals
 * @returns {string}
 */
function render(engine, src, locals) {
    return engine.render(src, { locals: locals || {} });
}

var IF = function (cond) { return '{% if ' + cond + ' %}T{% else %}F{% endif %}'; };

// Each arm: [name, template, locals, expected]. The expected value is the
// grouped reading; 2.8.1 renders the ungrouped one.
var AFFECTED = [
    ['(1 + 2) * 3',            '{{ (1 + 2) * 3 }}',     {},                            '9'],
    ['3 * (1 + 2)',            '{{ 3 * (1 + 2) }}',     {},                            '9'],
    ['10 - (2 + 3)',           '{{ 10 - (2 + 3) }}',    {},                            '5'],
    ['(x or y) and z',         IF('(x or y) and z'),    { x: true, y: false, z: false }, 'F'],
    ['(a || b) && c',          IF('(a || b) && c'),     { a: true, b: false, c: false }, 'F'],
    ['f == (one == two)',      IF('f == (one == two)'), { f: false, one: 1, two: 2 },  'T'],
    ['(s + t)[1]',             '{{ (s + t)[1] }}',      { s: 'a', t: 'b' },            'b'],
    ['-(-x)',                  '{{ -(-x) }}',           { x: 3 },                      '3']
];

describe('#B940 — swig keeps a grouping parenthesis', function () {

    copies().forEach(function (copy) {

        describe('01 a group that binds more loosely renders its value — ' + copy.label + ' ' + copy.version, function () {
            AFFECTED.forEach(function (arm) {
                it(arm[0], function () {
                    assert.equal(render(copy.engine, arm[1], arm[2]), arm[3],
                        arm[1] + ' through @rhinostone/swig ' + copy.version + ' at ' + copy.path);
                });
            });
        });

        describe('02 controls: shapes that rendered right before 2.8.2 — ' + copy.label + ' ' + copy.version, function () {

            it('a group followed by a filter', function () {
                assert.equal(render(copy.engine, '{{ (x * -1)|fmt }}', { x: 12.5 }), '-12,50');
            });

            it('a group followed by a filter called with ()', function () {
                assert.equal(render(copy.engine, '{{ (a || 0)|fmt() }}', { a: 1234.5 }), '1234,50');
            });

            it('a member read on a filtered group', function () {
                assert.equal(render(copy.engine, IF("(d | dl).kind == 'archived'"), { d: 1 }), 'T');
            });

            it('not (a and b), on all four inputs', function () {
                [[false, false, 'T'], [true, false, 'T'], [false, true, 'T'], [true, true, 'F']].forEach(function (c) {
                    assert.equal(render(copy.engine, IF('not (a and b)'), { a: c[0], b: c[1] }), c[2],
                        'a=' + c[0] + ' b=' + c[1]);
                });
            });

            it('!(a && b) inside a larger condition', function () {
                // Without the group, !a && b && c reads F on both inputs.
                assert.equal(render(copy.engine, IF('!(a && b) && c'), { a: false, b: false, c: true }), 'T');
                assert.equal(render(copy.engine, IF('!(a && b) && c'), { a: true, b: false, c: true }), 'T');
            });

            it('parentheses around a whole condition', function () {
                assert.equal(render(copy.engine, IF("(s == 'x' || s == 'y')"), { s: 'y' }), 'T');
            });

            it('a grouping that matches JavaScript\'s precedence', function () {
                assert.equal(render(copy.engine, IF('(x and y) or z'), { x: true, y: true, z: false }), 'T');
            });

            it('no grouping at all', function () {
                assert.equal(render(copy.engine, '{{ 1 + 2 * 3 }}', {}), '7');
            });
        });
    });

    describe('03 both manifests require the fixed release', function () {

        it('package.json and the framework package.json declare the same ^2.x range, at 2.8.2 or later', function () {
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
