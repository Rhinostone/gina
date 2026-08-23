/**
 * #B407 — GET/HEAD query serialization must not destroy escaped characters.
 *
 * `processRequestData`'s GET and HEAD branches round-trip `request.query`
 * through JSON.stringify + a re-parse (`formatDataFromString`). The previous
 * implementation unwrapped nested-JSON string values TEXTUALLY on the
 * serialized document — two wrapper replaces plus a blanket backslash strip —
 * and the strip destroyed exactly the escapes JSON.stringify had just
 * written: `%0A` became the letter `n`, a backslash vanished, and a double
 * quote (or a JSON-ARRAY value, which the wrapper replaces never handled)
 * produced invalid JSON, which drops EVERY query param on the request
 * (parseBody logs `[365]` and returns undefined). The fix replaces the
 * textual unwrap with `serializeQueryForReparse`: each own string value
 * leaning `{`/`[` is unwrapped by PARSING it (kept verbatim when it does not
 * parse), then the query serializes cleanly with no post-processing.
 *
 * Coverage shapes, per the house discipline:
 *   §01 — source pins on server.js (both call sites, no live strip —
 *         comment-stripped negatives with anti-vacuity + raw-view controls,
 *         since the retired literal legitimately survives in the `// was:`
 *         comments and one pre-existing commented-out line).
 *   §02 — extract-and-execute of the REAL shipped helper bytes.
 *         ⚠️ extraction is TERMINATOR-ANCHORED, not brace-walked: the
 *         helper's own `/^\s*[\{\[]/` regex literal carries an unmatched
 *         `{` that defeats a naive brace counter (the documented walker
 *         caveat — braces inside string/regex literals).
 *   §03 — full-pipeline behaviour through the REAL `formatDataFromString`
 *         (helpers/data), covering every reported corruption row, the two
 *         additional total-loss rows found while measuring (JSON-array
 *         value; unparsable `{`-leading value), and the preserved intended
 *         behaviours (nested unwrap, bool/null coercion, plain values).
 *   §04 — subtract: an inline replica of the PRE-fix transform (verbatim
 *         from the `// was:` line) must still produce the corruption on the
 *         same fixtures — proving §03's arms discriminate rather than
 *         passing vacuously.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert');
var fs     = require('node:fs');
var path   = require('node:path');

var ROOT = path.join(__dirname, '..', '..');
var frameworkDir = fs.readdirSync(path.join(ROOT, 'framework')).filter(function (d) {
    return /^v\d/.test(d) && fs.existsSync(path.join(ROOT, 'framework', d, 'core/server.js'));
}).sort().pop();
var FW  = path.join(ROOT, 'framework', frameworkDir);
var SRC = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');

// real framework globals — formatDataFromString comes from helpers/data
require(path.join(FW, 'helpers'));

var DECL = 'var serializeQueryForReparse = function (query) {';
var TERM = '// to compare with /core/controller/controller.js -> getParams()';

/** Comment-stripped code view for the negative pins (the own-comment trap). */
function codeOnly(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).map(function (l) {
        return l.replace(/\/\/.*$/, '');
    }).join('\n');
}

/** Extracts and compiles the REAL shipped helper (terminator-anchored). */
function extractSerialize() {
    assert.equal(SRC.split(DECL).length, 2, 'helper declaration must be unique');
    assert.equal(SRC.split(TERM).length, 2, 'terminator anchor must be unique');
    var i = SRC.indexOf(DECL);
    var j = SRC.indexOf(TERM, i);
    assert.ok(j > i, 'terminator must follow the declaration');
    var slice = SRC.substring(i, j);
    var cut   = slice.lastIndexOf('};');
    assert.ok(cut > 0, 'helper close not found in the slice');
    var fnSrc = slice.substring('var serializeQueryForReparse = '.length, cut + 1);
    return new Function('return (' + fnSrc + ');')();
}

/** The call sites' unchanged coercion lines + the real parser (full pipeline). */
function fixedPipeline(serialize, query) {
    var bodyStr = serialize(query);
    if ( /(\"false\"|\"true\"|\"on\")/i.test(bodyStr) )
        bodyStr = bodyStr.replace(/\"false\"/ig, false).replace(/\"true\"/ig, true).replace(/\"on\"/ig, true);
    if ( /(\"null\")/i.test(bodyStr) )
        bodyStr = bodyStr.replace(/\"null\"/ig, null);
    return formatDataFromString(bodyStr);
}

/** The PRE-fix transform, verbatim from the `// was:` record — the subtract. */
function preFixPipeline(query) {
    var bodyStr = JSON.stringify(query).replace(/\"{/g, '{').replace(/}\"/g, '}').replace(/\\/g, '');
    if ( /(\"false\"|\"true\"|\"on\")/i.test(bodyStr) )
        bodyStr = bodyStr.replace(/\"false\"/ig, false).replace(/\"true\"/ig, true).replace(/\"on\"/ig, true);
    if ( /(\"null\")/i.test(bodyStr) )
        bodyStr = bodyStr.replace(/\"null\"/ig, null);
    return formatDataFromString(bodyStr);
}

// ---------------------------------------------------------------------------
// 01 — source pins
// ---------------------------------------------------------------------------

describe('01 - source pins (#B407)', function () {

    it('defines serializeQueryForReparse once inside processRequestData', function () {
        assert.equal(SRC.split(DECL).length, 2);
        var declIdx = SRC.indexOf(DECL);
        var procIdx = SRC.indexOf('var processRequestData = function(request, response, next)');
        assert.ok(procIdx > -1 && declIdx > procIdx, 'helper must live inside processRequestData');
    });

    it('BOTH the GET and HEAD branches serialize through the helper (exactly 2 call sites)', function () {
        var calls = SRC.match(/bodyStr = serializeQueryForReparse\(request\.query\);/g) || [];
        assert.equal(calls.length, 2, 'expected the GET site and the HEAD site');
    });

    it('no LIVE blanket backslash strip remains in server.js (code view)', function () {
        var code = codeOnly(SRC);
        // anti-vacuity: the stripped view still carries the live call sites
        assert.ok(code.indexOf('serializeQueryForReparse(request.query)') > -1,
            'stripping emptied the corpus - the negative below would pass vacuously');
        assert.equal(code.indexOf(".replace(/\\\\/g, '')") , -1,
            'a live blanket backslash strip is back');
        // positive control: the RAW view still carries the retired literal in
        // comments (the pre-existing commented-out line + the two was-lines),
        // proving the strip-does-work and the literal is greppable history.
        var rawHits = SRC.split(".replace(/\\\\/g, '')").length - 1;
        assert.ok(rawHits >= 3, 'expected the retired literal to survive in comments, saw ' + rawHits);
    });

    it('the helper guards: own-property check, string gate, parse inside try', function () {
        var i = SRC.indexOf(DECL);
        var body = SRC.substring(i, SRC.indexOf(TERM, i));
        assert.match(body, /Object\.prototype\.hasOwnProperty\.call\(query, qKey\)/);
        assert.match(body, /typeof\(query\[qKey\]\) == 'string'/);
        var tryIdx   = body.indexOf('try {');
        var parseIdx = body.indexOf('JSON.parse(query[qKey])');
        assert.ok(tryIdx > -1 && parseIdx > tryIdx, 'JSON.parse must sit inside the try');
    });
});

// ---------------------------------------------------------------------------
// 02 — the real helper, extracted and executed
// ---------------------------------------------------------------------------

describe('02 - serializeQueryForReparse (real shipped bytes)', function () {
    var serialize = extractSerialize();

    it('serializes ordinary values with every escape intact', function () {
        assert.equal(serialize({ value: 'A\nB' }), '{"value":"A\\nB"}');
        assert.equal(serialize({ value: 'C:\\path' }), '{"value":"C:\\\\path"}');
        assert.equal(serialize({ message: 'say "hi"' }), '{"message":"say \\"hi\\""}');
    });

    it('unwraps a nested-JSON object value by parsing it', function () {
        assert.equal(serialize({ filter: '{"a":1}' }), '{"filter":{"a":1}}');
    });

    it('unwraps a nested-JSON ARRAY value (the textual unwrap never handled arrays)', function () {
        assert.equal(serialize({ list: '["a","b"]' }), '{"list":["a","b"]}');
    });

    it('keeps an unparsable {-leading value as a verbatim string', function () {
        assert.equal(serialize({ v: '{not json' }), '{"v":"{not json"}');
    });

    it('tolerates leading whitespace on a nested-JSON value', function () {
        assert.equal(serialize({ filter: '  {"a":1}' }), '{"filter":{"a":1}}');
    });

    it('leaves non-string values alone (an engine may pre-nest, e.g. express qs a[b]=1)', function () {
        assert.equal(serialize({ a: { b: '1' } }), '{"a":{"b":"1"}}');
    });
});

// ---------------------------------------------------------------------------
// 03 — full pipeline through the REAL formatDataFromString
// ---------------------------------------------------------------------------

describe('03 - full GET/HEAD pipeline (real parser)', function () {
    var serialize = extractSerialize();

    it('a double quote in a value survives, and SIBLING params are no longer dropped', function () {
        var got = fixedPipeline(serialize, { message: 'say "hi"', other: 'kept?' });
        assert.deepEqual(got, { message: 'say "hi"', other: 'kept?' });
    });

    it('newline, tab, CRLF and backslash survive byte-exact', function () {
        assert.deepEqual(fixedPipeline(serialize, { value: 'A\nB' }),   { value: 'A\nB' });
        assert.deepEqual(fixedPipeline(serialize, { value: 'A\tB' }),   { value: 'A\tB' });
        assert.deepEqual(fixedPipeline(serialize, { value: 'A\r\nB' }), { value: 'A\r\nB' });
        assert.deepEqual(fixedPipeline(serialize, { value: 'C:\\path' }), { value: 'C:\\path' });
    });

    it('a JSON-array query value arrives as a real array (was: whole query dropped)', function () {
        assert.deepEqual(fixedPipeline(serialize, { list: '["a","b"]' }), { list: ['a', 'b'] });
    });

    it('PRESERVED: nested-JSON unwrap delivers a real object', function () {
        assert.deepEqual(fixedPipeline(serialize, { filter: '{"a":1}' }), { filter: { a: 1 } });
    });

    it('PRESERVED: whole-value "true"/"false"/"on"/"null" coercion still applies', function () {
        assert.deepEqual(fixedPipeline(serialize, { flag: 'true' }),  { flag: true });
        assert.deepEqual(fixedPipeline(serialize, { flag: 'false' }), { flag: false });
        assert.deepEqual(fixedPipeline(serialize, { flag: 'null' }),  { flag: null });
    });

    it('PRESERVED: plain values pass through unchanged', function () {
        assert.deepEqual(fixedPipeline(serialize, { value: 'hello' }), { value: 'hello' });
    });

    it('an EMBEDDED quoted "true" inside a longer value is no longer coercible (escapes intact)', function () {
        // pre-fix, the strip turned \"true\" into "true" inside the value and
        // the coercion then mangled the document; with escapes intact the
        // whole-token regex cannot match an embedded escaped occurrence.
        var got = fixedPipeline(serialize, { note: 'it said "true" here' });
        assert.deepEqual(got, { note: 'it said "true" here' });
    });
});

// ---------------------------------------------------------------------------
// 04 — subtract: the pre-fix transform still corrupts (the arms discriminate)
// ---------------------------------------------------------------------------

describe('04 - subtract (pre-fix replica must fail these)', function () {

    it('pre-fix, a newline value degraded to the letter n', function () {
        assert.deepEqual(preFixPipeline({ value: 'A\nB' }), { value: 'AnB' });
    });

    it('pre-fix, a quote-bearing value dropped the WHOLE query (undefined)', function () {
        assert.equal(preFixPipeline({ message: 'say "hi"', other: 'kept?' }), undefined);
    });

    it('pre-fix, a JSON-array value dropped the WHOLE query (undefined)', function () {
        assert.equal(preFixPipeline({ list: '["a","b"]' }), undefined);
    });
});
