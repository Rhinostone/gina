'use strict';
/**
 * #B936 / #B594 — a top-level JSON array handed to `formatDataFromString` comes back as the array of
 * its parsed elements, not as a circular value.
 *
 * Before the fix, `parseCollection` (helpers/data) handed every element the ROOT array as its
 * accumulator and stored the return value in each slot, so `[{"a":1}]` came back as
 * `[ [Circular], a: 1 ]` and `[1]` as `[ [Circular] ]`: `JSON.stringify` of the result throws, and a
 * route that renders the parsed data answered 500 (a GET whose only parameter is `inheritedData=[1]`,
 * a `[`-leading POST body not labelled `application/json`). Now an element that is an object is parsed
 * like a document of its own, into its own object (bracket keys nest, the three prototype names are
 * dropped), and any other element is kept as it is, as a value inside an object document is.
 *
 * The helper is driven from its real source; the built bundles are pinned too, since the browser
 * bundle carries the same helper as `utils/data` (§04).
 *
 * Seams (red-first against pre-fix copies):
 *   GINA_B936_DATA_SRC=<path>  the helpers/data/src/main.js copy to load
 *   GINA_B936_DIST_DIR=<path>  the dist/vendor/gina/js directory whose bundles §04 reads
 * On pre-fix copies the #B936 arms fail and the CONTROL arms pass.
 *
 * Run standalone: node --test test/lib/format-data-array-document-b936.test.js
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var zlib   = require('zlib');
var FW     = require('../fw');

var DATA_SRC = process.env.GINA_B936_DATA_SRC || path.join(FW, 'helpers', 'data', 'src', 'main.js');
var DIST_DIR = process.env.GINA_B936_DIST_DIR || path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');

require(path.resolve(DATA_SRC))();                          // installs the implicit globals
var formatDataFromString = global.formatDataFromString;

/** Comment-stripped source, so the `// was:` record cannot trip a negative pin (the #B588 idiom). */
function codeOnly(src) {
    return src.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); })
              .map(function (l) { return l.replace(/\/\/.*$/, ''); }).join('\n');
}

/** Parses, then serializes: a circular result throws here, as it did in `renderJSON`. */
function parse(input) {
    var out = formatDataFromString(input);
    JSON.stringify(out);
    return out;
}


describe('01 - #B936/#B594: a top-level array document is parsed element by element', function () {

    it('01.1 - an object element is parsed into its own object; no slot holds the array itself', function () {
        var one = parse('[{"a":1}]');
        assert.ok(Array.isArray(one), 'an array document gives an array');
        assert.notEqual(one[0], one, 'element 0 must not be the array itself');
        assert.deepEqual(one, [ { a: 1 } ]);
        var two = parse('[{"a":1},{"b":2}]');
        assert.deepEqual(two, [ { a: 1 }, { b: 2 } ]);
        assert.notEqual(two[0], two[1], 'each element has its own object');
    });

    it('01.2 - any other element is kept as it is: strings, numbers, booleans, null, nested arrays', function () {
        assert.deepEqual(parse('["x","y"]'), [ 'x', 'y' ]);
        assert.deepEqual(parse('[1]'), [ 1 ]);
        assert.deepEqual(parse('[true,false]'), [ true, false ]);
        assert.deepEqual(parse('[null]'), [ null ]);
        assert.deepEqual(parse('[[1,2]]'), [ [ 1, 2 ] ]);
        assert.deepEqual(parse('[1,"x",null,{"a":"1"},[2]]'), [ 1, 'x', null, { a: '1' }, [ 2 ] ]);
    });

    it('01.3 - an object element follows the document contract: bracket keys nest, quoted tokens are cast', function () {
        assert.deepEqual(parse('[{"a[b]":"1","c":"2"}]'), [ { a: { b: '1' }, c: '2' } ]);
        assert.deepEqual(parse('[{"x":"true","y":"null"}]'), [ { x: true, y: null } ]);
        assert.deepEqual(parse('["true","off"]'), [ true, 'off' ]);
    });

    it('01.4 - a top-level __proto__, constructor or prototype key is dropped from each element; no prototype changes', function () {
        var out = parse('[{"__proto__":{"polluted":1},"k":2},{"constructor":1,"prototype":2,"k":3}]');
        assert.deepEqual(out, [ { k: 2 }, { k: 3 } ]);
        assert.equal(Object.getPrototypeOf(out[0]), Object.prototype);
        assert.equal(Object.getPrototypeOf(out[1]), Object.prototype);
        assert.equal(({}).polluted, undefined, 'Object.prototype is untouched');
    });

    it('01.5 - the other entry shapes give the same result: an array passed as an object, a percent-encoded document', function () {
        assert.deepEqual(parse([ { a: 1 }, 'x' ]), [ { a: 1 }, 'x' ]);
        assert.deepEqual(parse('%5B%7B%22a%22%3A1%7D%2C2%5D'), [ { a: 1 }, 2 ]);
    });
});


describe('02 - CONTROL: what the fix leaves as it was', function () {

    // the invalid document below logs one [365] line; keep the runner quiet
    var origError = null;
    before(function () { origError = console.error; console.error = function () {}; });
    after(function () { console.error = origError; });

    it('02.1 - CONTROL: an object document, and an array as a value inside it', function () {
        assert.deepEqual(parse('{"a":1}'), { a: 1 });
        assert.deepEqual(parse('{"a":[1,{"b":"2"}]}'), { a: [ 1, { b: '2' } ] });
    });

    it('02.2 - CONTROL: a JSON array as the value of a urlencoded pair', function () {
        assert.deepEqual(parse('x=1&list=["a","b"]'), { x: '1', list: [ 'a', 'b' ] });
    });

    it('02.3 - CONTROL: an empty array, and a [-leading text that is not JSON', function () {
        assert.deepEqual(parse('[]'), []);
        assert.equal(formatDataFromString('[1,'), undefined);
    });
});


describe('03 - source pin (comment-stripped; the `// was:` record cannot trip it)', function () {

    var raw  = fs.readFileSync(path.resolve(DATA_SRC), 'utf8');
    var code = codeOnly(raw);

    it('03.1 - #B936: parseCollection gives an object element its own accumulator and keeps any other element', function () {
        var s = code.indexOf('var parseCollection = function');
        var e = code.indexOf('var parseObject = function', s);
        assert.ok(s > -1 && e > s, 'parseCollection not isolatable');
        var body = code.slice(s, e);
        assert.match(body, /parseObject\(collection\[i\], \{\}\)/, 'each object element gets its own accumulator');
        assert.match(body, /!Array\.isArray\(collection\[i\]\)/, 'a nested array is not parsed as an object');
        assert.match(body, /: collection\[i\];/, 'any other element is kept as it is');
        assert.doesNotMatch(body, /parseObject\(collection\[i\], obj\)/, 'the root array must not be the accumulator');
        // anti-vacuity: the raw file still carries the retired line in its was: record
        assert.ok(raw.indexOf('//     obj[i] = parseObject(collection[i], obj);') > -1, 'the was: record is missing');
    });
});


describe('04 - the built bundles carry the fix (dist pins)', function () {

    var distJs  = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
    var distMin = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');

    function count(s, needle) { return s.split(needle).length - 1; }

    it('04.1 - #B936: gina.js carries the fixed loop once and no longer the root accumulator', function () {
        assert.equal(count(distJs, "obj[i] = ( collection[i] !== null && typeof(collection[i]) == 'object' && !Array.isArray(collection[i]) )"), 1);
        assert.equal(count(distJs, '? parseObject(collection[i], {})'), 1);
        assert.equal(count(codeOnly(distJs), 'parseObject(collection[i], obj)'), 0);
    });

    it('04.2 - #B936: gina.min.js carries the minified guard once, and not the root-accumulator shape', function () {
        // identifier-agnostic; Closure may emit the guard as written or inverted (it inverts it today,
        // inside the inlined parseBody: `y[U]=O[U]===null||typeof O[U]!='object'||Array.isArray(O[U])?O[U]:h(O[U],{})`)
        var fixed = /([\w$]+)\[([\w$]+)\]\s*=\s*(?:([\w$]+)\[\2\]\s*===\s*null\s*\|\|\s*typeof\s+\3\[\2\]\s*!=\s*['"]object['"]\s*\|\|\s*Array\.isArray\(\s*\3\[\2\]\s*\)\s*\?\s*\3\[\2\]\s*:\s*[\w$]+\(\s*\3\[\2\]\s*,\s*\{\s*\}\s*\)|null\s*!==\s*([\w$]+)\[\2\]\s*&&\s*['"]object['"]\s*==\s*typeof\s+\4\[\2\]\s*&&\s*!\s*Array\.isArray\(\s*\4\[\2\]\s*\)\s*\?\s*[\w$]+\(\s*\4\[\2\]\s*,\s*\{\s*\}\s*\)\s*:\s*\4\[\2\])/g;
        var m = distMin.match(fixed) || [];
        assert.equal(m.length, 1, 'gina.min.js carries ' + m.length + ' minified #B936 guards; expected 1');
        // the pre-fix shape `x[V]=h(P[V],x)`: the element parsed with the array itself as its accumulator
        var rootAcc = /([\w$]+)\[([\w$]+)\]\s*=\s*([\w$]+)\(\s*([\w$]+)\[\2\]\s*,\s*\1\s*\)/g;
        assert.equal((distMin.match(rootAcc) || []).length, 0, 'the root-accumulator shape must be gone');
    });

    it('04.3 - CONTROL: gina.min.js is the bundle that carries the data helper (its document-branch cast)', function () {
        assert.ok(count(distMin, '.replace(/"null"/ig,null)') >= 1, 'the minified bundle lacks the helper\'s "null" cast');
    });

    it('04.4 - CONTROL: the compressed siblings decode to gina.min.js', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'));
        assert.ok(zlib.brotliDecompressSync(fs.readFileSync(path.join(DIST_DIR, 'gina.min.js.br'))).equals(min), '.br differs');
        assert.ok(zlib.gunzipSync(fs.readFileSync(path.join(DIST_DIR, 'gina.min.js.gz'))).equals(min), '.gz differs');
    });
});
