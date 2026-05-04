/**
 * lib/swig-filters — source-inspection + length-filter null-guard tests.
 *
 * Sister of test/lib/nunjucks-filters.test.js (Section 08). The two filter
 * modules (`lib/swig-filters/src/main.js` and `lib/nunjucks-filters/src/main.js`)
 * carry the same `self.length` shape and were patched together to guard
 * against null/undefined input — templates that piped a missing variable
 * through `| length` previously crashed with a TypeError surfacing as a
 * 500 on the route.
 *
 * Strategy: source inspection + a pure-logic replica of self.length so we
 * can exercise behaviour without booting a real gina bundle (the factory
 * references `_`, `GINA_FRAMEWORK_DIR`, `JSON.clone`, `merge`, `routing`
 * — all set up by `gna.js` at bundle boot, not by the test runtime).
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW     = require('../fw');
var SF_SRC = fs.readFileSync(path.join(FW, 'lib/swig-filters/src/main.js'), 'utf8');

// Strip line comments so the patch-comment mention of `typeof(input.count)`
// doesn't trip the negative-invariant search inside self.length.
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
var SF_CODE = stripComments(SF_SRC);


// ---------------------------------------------------------------------------
// 01 - Module shape
// ---------------------------------------------------------------------------

describe('01 - lib/swig-filters module shape', function () {

    it('defines a top-level SwigFilters factory function', function () {
        assert.match(SF_SRC, /function\s+SwigFilters\s*\(\s*conf\s*\)/);
    });

    it('exports SwigFilters via module.exports', function () {
        assert.match(SF_SRC, /module\.exports\s*=\s*SwigFilters/);
    });

    it('declares self.length(input, obj)', function () {
        assert.match(SF_SRC, /self\.length\s*=\s*function\s*\(\s*input\s*,\s*obj\s*\)/);
    });
});


// ---------------------------------------------------------------------------
// 02 - length filter null/undefined guard (#FX-length-null-guard)
// ---------------------------------------------------------------------------
//
// Sister of nunjucks-filters Section 08. Both filter modules return 0 for
// null/undefined input; the guard MUST sit before the `input.count`
// dereference so a missing template variable doesn't crash the render.

describe('02 - length filter null/undefined guard (#FX-length-null-guard)', function () {

    it('source: null/undefined guard sits before `.count` dereference', function () {
        // Use SF_CODE (comments stripped) so the explanatory `typeof(input.count)`
        // mention in the patch comment doesn't trip the search.
        var lengthIdx = SF_CODE.indexOf('self.length = function');
        assert.ok(lengthIdx > 0, 'self.length declaration must exist');
        var nextDecl  = SF_CODE.indexOf('self.', lengthIdx + 1);
        var body      = SF_CODE.slice(lengthIdx, nextDecl > lengthIdx ? nextDecl : lengthIdx + 800);
        var guardIdx  = body.search(/input\s*==\s*null/);
        var countIdx  = body.search(/if\s*\(\s*typeof\s*\(\s*input\.count\s*\)/);
        assert.ok(guardIdx > -1, 'expected `input == null` guard inside self.length');
        assert.ok(countIdx > -1, 'expected `if ( typeof(input.count) ... )` dereference inside self.length');
        assert.ok(guardIdx < countIdx, 'guard must precede the `.count` dereference');
    });

    // Inline simulator mirroring framework/v*/lib/swig-filters/src/main.js
    // self.length byte-for-byte. Pure function with no gina globals.
    function simulatedLength(input /*, obj */) {
        if ( input == null ) {
            return 0;
        }
        if ( typeof(input.count) != 'undefined' ) {
            return input.count();
        } else {
            return input.length;
        }
    }

    it('returns 0 for undefined input', function () {
        assert.equal(simulatedLength(undefined), 0);
    });

    it('returns 0 for null input', function () {
        assert.equal(simulatedLength(null), 0);
    });

    it('returns array length for arrays', function () {
        assert.equal(simulatedLength([1, 2, 3]), 3);
        assert.equal(simulatedLength([]), 0);
    });

    it('returns string length for strings', function () {
        assert.equal(simulatedLength('abc'), 3);
        assert.equal(simulatedLength(''), 0);
    });

    it('returns count() for collection-like objects with .count()', function () {
        var fakeCollection = { count: function () { return 5; } };
        assert.equal(simulatedLength(fakeCollection), 5);
    });

    it('returns .length for plain objects with a numeric length property', function () {
        var obj = { length: 7 };
        assert.equal(simulatedLength(obj), 7);
    });
});
