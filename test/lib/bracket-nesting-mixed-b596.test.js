'use strict';
/**
 * #B596 — a bracket-notation parent whose segments mix indexes and names nests to ONE object keyed by
 * both, whatever the order.
 *
 * Before the fix, a name reaching a level that already held an array (`a[0]=x`, then `a[b]=y`) was read
 * as index 0 by the nesting walk (`~~'b'`): a fresh `{}` replaced the first element, and the name was
 * set as a property of the array, which JSON drops, so `{ a: [ {} ] }` went on the wire. The name
 * first already gave the object. Now a name reaching an array copies the array into an object before
 * the walk goes on; a parent whose segments are all indexes stays an array.
 *
 * Both nesting implementations are driven from their real source:
 *   - helpers/data `parseLocalObj`, through `formatDataFromString` and as the global
 *     `nestBracketNotationKey` that the server's multipart field capture calls;
 *   - the validator twin `nestBracketNotationKey` (`$form.send(FormData)`), extracted from its source
 *     the way test/core/validator-send-formdata-nesting.test.js does.
 * The two must carry the same block, byte for byte (§04).
 *
 * Seams (red-first against pre-fix copies):
 *   GINA_B596_DATA_SRC=<path>       the helpers/data/src/main.js copy to load
 *   GINA_B596_VALIDATOR_SRC=<path>  the validator main.js copy the twin is extracted from
 *   GINA_B596_DIST_DIR=<path>       the dist/vendor/gina/js directory whose bundles §06 reads
 * On pre-fix copies the #B596 arms fail and the CONTROL arms pass.
 *
 * Run standalone: node --test test/lib/bracket-nesting-mixed-b596.test.js
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var zlib   = require('zlib');
var FW     = require('../fw');

var DATA_SRC      = process.env.GINA_B596_DATA_SRC      || path.join(FW, 'helpers', 'data', 'src', 'main.js');
var VALIDATOR_SRC = process.env.GINA_B596_VALIDATOR_SRC || path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var DIST_DIR      = process.env.GINA_B596_DIST_DIR      || path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');

require(path.resolve(DATA_SRC))();                          // installs the implicit globals
var formatDataFromString   = global.formatDataFromString;
var nestBracketNotationKey = global.nestBracketNotationKey;  // the server alias of parseLocalObj

var dataSrc = fs.readFileSync(path.resolve(DATA_SRC), 'utf8');
var mainSrc = fs.readFileSync(path.resolve(VALIDATOR_SRC), 'utf8');

var multipart = require(path.join(FW, 'lib', 'multipart'));  // the inverse encoder (unchanged by #B596)

/** Direct sloppy-mode eval so the self-recursive reference inside the body resolves. */
function extractFn(src, name) {
    return (function () {
        var __fn;
        eval(src + '\n__fn = ' + name + ';');   // eslint-disable-line no-eval
        return __fn;
    })();
}

// the client twin — same anchors as the #B92 and #B591 tests
var twinSrc = (function () {
    var start = mainSrc.indexOf('var nestBracketNotationKey = function');
    var end   = mainSrc.indexOf('/**\n     * send', start);
    assert.ok(start > -1 && end > start, 'nestBracketNotationKey source not isolatable');
    return mainSrc.substring(start, end);
})();
var twin = extractFn(twinSrc, 'nestBracketNotationKey');

/** `item[0][id]` -> ['item','0','id'], as every call site splits a name. */
function splitKey(name) { return name.replace(/\]/g, '').split(/\[/g); }

/**
 * Nests `[name, value]` pairs one at a time, values verbatim, the way the server's multipart field
 * capture and the twin's send(FormData) loop do.
 */
function nestPairs(fn, pairs) {
    var out = {};
    pairs.forEach(function (p) {
        if ( /^(.*)\[(.*)\]/.test(p[0]) ) {
            out = fn(out, splitKey(p[0]), 0, p[1]);
        } else {
            out[ p[0] ] = p[1];
        }
    });
    return out;
}

// the shapes: indexed rows, and a name joining them under the same parent
var ROWS   = [ ['items[0][id]', 'a0'], ['items[0][qty]', '2'], ['items[1][id]', 'a1'] ];
var NAME   = [ 'items[selected]', 'a1' ];
var MIXED  = { '0': { id: 'a0', qty: '2' }, '1': { id: 'a1' }, selected: 'a1' };
var ARRAY  = [ { id: 'a0', qty: '2' }, { id: 'a1' } ];

/** The pairs as an urlencoded body (`[` `]` left raw unless `encoded`). */
function urlencoded(pairs, encoded) {
    return pairs.map(function (p) {
        var name = encoded ? encodeURIComponent(p[0]) : p[0];
        return name + '=' + encodeURIComponent(p[1]);
    }).join('&');
}

/** The #B596 block of one source: from its marker line to the end of its `if` statement. */
var MARKER = '// #B596 — a segment that is not an index';
function blockOf(src) {
    var at = src.indexOf(MARKER);
    if (at < 0) { return null; }
    var start = src.lastIndexOf('\n', at) + 1;
    var close = src.indexOf('\n                    }\n', at);
    if (close < 0) { return null; }
    return src.substring(start, close + '\n                    }\n'.length);
}


describe('01 - formatDataFromString: a parent mixing indexes and names is one object', function () {

    it('01.1 - #B596: indexes first, then a name — one object, every row kept', function () {
        assert.deepEqual(formatDataFromString(urlencoded(ROWS.concat([NAME]))), { items: MIXED });
    });

    it('01.2 - #B596: the same with percent-encoded brackets (the wire form)', function () {
        assert.deepEqual(formatDataFromString(urlencoded(ROWS.concat([NAME]), true)), { items: MIXED });
    });

    it('01.3 - #B596: a list of values, then a name (`a[0]=x&a[b]=y`)', function () {
        assert.deepEqual(formatDataFromString('a[0]=x&a[b]=y'), { a: { '0': 'x', b: 'y' } });
    });

    it('01.4 - #B596: only the level that mixes becomes an object (`m[0][0]=a&m[0][x]=b`)', function () {
        assert.deepEqual(formatDataFromString('m[0][0]=a&m[0][x]=b'), { m: [ { '0': 'a', x: 'b' } ] });
    });

    it('01.5 - #B596: an index after the name is set by key (`r[0]=a&r[x]=b&r[2]=c`)', function () {
        assert.deepEqual(formatDataFromString('r[0]=a&r[x]=b&r[2]=c'), { r: { '0': 'a', x: 'b', '2': 'c' } });
    });

    it('01.6 - #B596: empty brackets are a name (`b[0]=x&b[]=y`)', function () {
        assert.deepEqual(formatDataFromString('b[0]=x&b[]=y'), { b: { '0': 'x', '': 'y' } });
    });

    it('01.7 - #B596: a JSON-valued array, then a name (`list=[1,2]&list[x]=3`)', function () {
        assert.deepEqual(formatDataFromString('list=%5B1%2C2%5D&list[x]=3'), { list: { '0': 1, '1': 2, x: '3' } });
    });

    it('01.8 - #B596: a sparse array keeps the indexes it holds (`d[1][id]=a&d[x]=b`)', function () {
        var out = formatDataFromString('d[1][id]=a&d[x]=b');
        assert.deepEqual(out, { d: { '1': { id: 'a' }, x: 'b' } });
        assert.ok(!Object.prototype.hasOwnProperty.call(out.d, '0'), 'the hole is not a value');
    });

    it('01.9 - #B596: a JSON document whose keys mix (`{"a[0]":"x","a[b]":"y"}`)', function () {
        assert.deepEqual(formatDataFromString('{"a[0]":"x","a[b]":"y"}'), { a: { '0': 'x', b: 'y' } });
    });

    it('01.10 - CONTROL: the name first, then the indexes — the same object', function () {
        assert.deepEqual(formatDataFromString(urlencoded([NAME].concat(ROWS))), { items: MIXED });
    });

    it('01.11 - CONTROL: indexes only — an array', function () {
        assert.deepEqual(formatDataFromString(urlencoded(ROWS)), { items: ARRAY });
    });

    it('01.12 - CONTROL: names only — an object', function () {
        assert.deepEqual(formatDataFromString('o[a]=1&o[b]=2'), { o: { a: '1', b: '2' } });
    });

    it('01.13 - CONTROL: a mixed path through `__proto__` is still dropped, nothing polluted', function () {
        var out = formatDataFromString('a[0]=1&a[__proto__][x]=1');
        assert.deepEqual(out, { a: [ '1' ] });
        assert.equal(({}).x, undefined);
        assert.equal(Object.prototype.hasOwnProperty('x'), false);
    });
});


describe('02 - the global nestBracketNotationKey (the multipart field capture)', function () {

    it('02.1 - CONTROL: it is helpers/data parseLocalObj', function () {
        // whitespace-free: Bun's Function#toString reprints the source (`k + 1`, `obj[_key]`)
        assert.equal(typeof nestBracketNotationKey, 'function');
        assert.ok(nestBracketNotationKey.toString().replace(/\s+/g, '').indexOf('parseLocalObj(obj[_key],key,k+1,value)') > -1,
            'the global is not the data helper\'s parseLocalObj');
    });

    it('02.2 - #B596: fields captured one at a time, indexes first, then a name — one object', function () {
        assert.deepEqual(nestPairs(nestBracketNotationKey, ROWS.concat([NAME])), { items: MIXED });
    });
});


describe('03 - the validator twin (send(FormData)), real extracted bytes', function () {

    it('03.1 - #B596: indexes first, then a name — one object, values verbatim', function () {
        assert.deepEqual(nestPairs(twin, ROWS.concat([NAME, ['flag', 'true']])), { items: MIXED, flag: 'true' });
    });

    it('03.2 - CONTROL: the twins agree on every shape', function () {
        var battery = [
            ROWS.concat([NAME]),
            [NAME].concat(ROWS),
            ROWS,
            [ ['a[0]', 'x'], ['a[b]', 'y'] ],
            [ ['m[0][0]', 'a'], ['m[0][x]', 'b'] ],
            [ ['r[0]', 'a'], ['r[x]', 'b'], ['r[2]', 'c'] ],
            [ ['b[0]', 'x'], ['b[]', 'y'] ],
            [ ['d[1][id]', 'a'], ['d[x]', 'b'] ],
            [ ['o[a]', '1'], ['o[b]', '2'] ],
            [ ['a[0]', '1'], ['a[__proto__][x]', '1'] ]
        ];
        battery.forEach(function (pairs) {
            assert.deepEqual(nestPairs(twin, pairs), nestPairs(nestBracketNotationKey, pairs),
                'the twins diverged on ' + JSON.stringify(pairs));
        });
    });
});


describe('04 - both twins carry the same #B596 block', function () {

    it('04.1 - #B596: each source carries the block once', function () {
        assert.equal(dataSrc.split(MARKER).length - 1, 1, 'helpers/data: the #B596 block is missing or doubled');
        assert.equal(mainSrc.split(MARKER).length - 1, 1, 'validator: the #B596 block is missing or doubled');
    });

    it('04.2 - #B596: the block is byte-identical in both sources and ends with the conversion', function () {
        var a = blockOf(dataSrc), b = blockOf(mainSrc);
        assert.ok(a && b, 'the #B596 block is not isolatable in both sources');
        assert.equal(a, b, 'the #B596 blocks differ');
        assert.ok(/if \( Array\.isArray\(obj\[ _key \]\) && !\/\^\\d\+\$\/\.test\(key\[k\+1\]\) \) \{\n\s+obj\[ _key \] = Object\.assign\(\{\}, obj\[ _key \]\);\n\s+\}\n$/.test(a),
            'the block does not end with the array-to-object conversion');
    });

    it('04.3 - CONTROL: the recursive call the block sits above is in both sources', function () {
        assert.ok(dataSrc.indexOf('parseLocalObj(obj[ _key ], key, k+1, value);') > -1, 'helpers/data recursion not found');
        assert.ok(mainSrc.indexOf('nestBracketNotationKey(obj[ _key ], key, k+1, value);') > -1, 'validator recursion not found');
    });
});


describe('05 - lib/multipart flatten() and the nester stay each other\'s inverse', function () {

    it('05.1 - #B596: a parent mixing indexes and names round-trips', function () {
        var fields = { ref: 'x', items: MIXED };
        var pairs  = multipart.flatten(fields);
        assert.deepEqual(nestPairs(nestBracketNotationKey, pairs), fields);
    });

    it('05.2 - CONTROL: a parent of indexes only round-trips as an array', function () {
        var fields = { ref: 'x', items: ARRAY };
        assert.deepEqual(nestPairs(nestBracketNotationKey, multipart.flatten(fields)), fields);
    });
});


describe('06 - the built bundles carry the block (dist pins)', function () {

    var distJs  = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
    var distMin = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');

    function count(s, needle) { return s.split(needle).length - 1; }

    it('06.1 - #B596: gina.js carries the block twice (the data helper and the twin)', function () {
        assert.equal(count(distJs, 'if ( Array.isArray(obj[ _key ]) && !/^\\d+$/.test(key[k+1]) ) {'), 2);
        assert.equal(count(distJs, 'obj[ _key ] = Object.assign({}, obj[ _key ]);'), 2);
    });

    it('06.2 - #B596: gina.min.js carries the minified block twice', function () {
        // `obj[ _key ]` is renamed (X[Y]) and the `if` may become `&&`: identifier-, wrap- and shape-agnostic
        var re = /Array\.isArray\(\s*([\w$]+)\s*\[\s*([\w$]+)\s*\]\s*\)\s*&&\s*!\s*\/\^\\d\+\$\/\s*\.\s*test\(\s*[\w$]+\s*\[\s*[\w$]+\s*\+\s*1\s*\]\s*\)\s*(?:&&\s*\(\s*|\)\s*\{?\s*)\1\s*\[\s*\2\s*\]\s*=\s*Object\s*\.\s*assign\(\s*\{\s*\}\s*,\s*\1\s*\[\s*\2\s*\]\s*\)/g;
        var m = distMin.match(re) || [];
        assert.equal(m.length, 2, 'gina.min.js carries ' + m.length + ' minified #B596 blocks; expected 2');
    });

    it('06.3 - CONTROL: gina.min.js is the bundle the #B92 pin reads (bracket splitter idiom present)', function () {
        var m = distMin.match(/\.replace\(\s*\/\\\]\/g\s*,\s*(?:''|"")\s*\)\s*\.split\(\s*\/\\\[\/g\s*\)/g) || [];
        assert.ok(m.length >= 3, 'the minified bundle has ' + m.length + ' bracket-split idioms; expected >= 3');
    });

    it('06.4 - CONTROL: the compressed siblings decode to gina.min.js', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'));
        assert.ok(zlib.brotliDecompressSync(fs.readFileSync(path.join(DIST_DIR, 'gina.min.js.br'))).equals(min), '.br differs');
        assert.ok(zlib.gunzipSync(fs.readFileSync(path.join(DIST_DIR, 'gina.min.js.gz'))).equals(min), '.gz differs');
    });
});
