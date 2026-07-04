/**
 * Unit + behavioral tests for lib/json-config-header.
 *
 * Covers:
 *   (a) module shape — exports firstStructuralBraceIndex + splitHeader
 *   (b) firstStructuralBraceIndex — skips `{` inside `//` and block comments,
 *       returns -1 when there is no structural brace, null/undefined-safe
 *   (c) splitHeader — { header, braceIndex }; header verbatim; empty header
 *       when the structural brace is at index 0 or absent (byte-compatible
 *       with the old `(firstBrace > 0) ? ... : ''` semantics for comment-free
 *       files)
 *   (d) BEHAVIORAL REGRESSION — the real scaffolded connectors.json template
 *       (whose example block literally contains `// "couchbase": {`) splits at
 *       the structural brace, so a connector:add-style rewrite
 *       (header + JSON.stringify(merged) + '\n') re-parses the way requireJSON
 *       would AND round-trips the merged connector back out
 *   (e) SUBTRACT — the pre-fix `raw.indexOf('{')` split on the same template
 *       corrupts the rewrite (fails to parse), proving the fix is load-bearing
 *
 * This is the behavioral surface for the connector:add / connector:rm /
 * connector:migrate header-split fix; the handler tests assert delegation to
 * this module (source pins), mirroring the lib/cmd-status-format precedent.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var MODULE   = path.join(require('../fw'), 'lib/json-config-header/src/main.js');
var TEMPLATE = path.join(require('../fw'), 'core/template/boilerplate/bundle/config/connectors.json');

var jch      = require(MODULE);
var template = fs.readFileSync(TEMPLATE, 'utf8');

/**
 * Faithful mirror of the framework's requireJSON comment strip + parse
 * (helpers/json/src/main.js): block comments removed only when `/** ` is
 * present, then per-line leftmost `//` unless preceded by `:` / `"` / `\`.
 * The test asserts a rewritten file parses the way requireJSON would.
 */
function parseJsonc(str) {
    var s = str;
    if (/\/\*\*/.test(s)) {
        s = s.replace(/(\/\*([^*]|[\r\n]|(\*+([^*\/]|[\r\n])))*\*+\/)/g, '');
    }
    s = s.split('\n').map(function (line) {
        var idx = line.indexOf('//');
        if (idx === -1) return line;
        if (idx > 0) {
            var prev = line.charAt(idx - 1);
            if (prev === ':' || prev === '"' || prev === '\\') return line;
        }
        return line.substring(0, idx);
    }).join('\n');
    return JSON.parse(s);
}

// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports firstStructuralBraceIndex and splitHeader as functions', function () {
        assert.equal(typeof jch.firstStructuralBraceIndex, 'function');
        assert.equal(typeof jch.splitHeader, 'function');
    });
});

// ---------------------------------------------------------------------------
// 02 — firstStructuralBraceIndex
// ---------------------------------------------------------------------------

describe('02 - firstStructuralBraceIndex', function () {

    it('returns 0 for a comment-free object starting with `{`', function () {
        assert.equal(jch.firstStructuralBraceIndex('{ "a": 1 }'), 0);
    });

    it('skips a `{` inside a // line comment', function () {
        var s = '// { not this one\n{ "a": 1 }';
        assert.equal(jch.firstStructuralBraceIndex(s), s.indexOf('\n') + 1);
    });

    it('skips a `{` inside a /* */ block comment', function () {
        assert.equal(jch.firstStructuralBraceIndex('/* { */ { "a": 1 }'), 8);
    });

    it('does not treat // inside a block comment as a line comment', function () {
        // The `{` is inside the block; the // is inert there.
        assert.equal(jch.firstStructuralBraceIndex('/* // { */\n{ "x":1 }'), 11);
    });

    it('does not treat /* inside a line comment as a block opener', function () {
        var s = '// /* { still a line comment\n{ "x":1 }';
        assert.equal(jch.firstStructuralBraceIndex(s), s.indexOf('\n') + 1);
    });

    it('returns -1 when there is no structural brace', function () {
        assert.equal(jch.firstStructuralBraceIndex('// only comments\n// more\n'), -1);
        assert.equal(jch.firstStructuralBraceIndex(''), -1);
    });

    it('is null/undefined-safe (returns -1)', function () {
        assert.equal(jch.firstStructuralBraceIndex(null), -1);
        assert.equal(jch.firstStructuralBraceIndex(undefined), -1);
    });

    it('lands on the real structural brace of the scaffolded template', function () {
        var idx = jch.firstStructuralBraceIndex(template);
        assert.ok(idx > 0);
        assert.equal(template.charAt(idx), '{');
        // the char before it is a newline (the `{` sits on its own line)
        assert.equal(template.charAt(idx - 1), '\n');
        // and it is NOT the brace inside the `// "couchbase": {` comment
        assert.ok(idx > template.indexOf('// "couchbase": {'));
    });
});

// ---------------------------------------------------------------------------
// 03 — splitHeader
// ---------------------------------------------------------------------------

describe('03 - splitHeader', function () {

    it('returns { header, braceIndex }', function () {
        var r = jch.splitHeader('{ "a": 1 }');
        assert.deepEqual(Object.keys(r).sort(), ['braceIndex', 'header']);
    });

    it('empty header when the structural brace is at index 0 (comment-free)', function () {
        var r = jch.splitHeader('{ "$schema": "x" }');
        assert.equal(r.header, '');
        assert.equal(r.braceIndex, 0);
    });

    it('empty header when there is no structural brace', function () {
        var r = jch.splitHeader('// nothing here\n');
        assert.equal(r.header, '');
        assert.equal(r.braceIndex, -1);
    });

    it('preserves the FULL comment header of the scaffolded template verbatim', function () {
        var r = jch.splitHeader(template);
        // header starts at the top banner and ends exactly at the structural brace
        assert.equal(r.header, template.slice(0, r.braceIndex));
        assert.ok(/^\/\/ bundle needs to be restarted/.test(r.header));
        // the whole example block (dropped by the buggy split) survives
        assert.ok(r.header.indexOf('"protocol" : "couchbase://"') > -1);
        assert.ok(r.header.indexOf('For local overrides') > -1);
        assert.ok(r.header.indexOf('declare only the keys') > -1);
    });

    it('is byte-compatible with the old split for a comment-free file', function () {
        // old behavior was: (raw.indexOf('{') > 0) ? raw.slice(0, i) : ''
        var noComment = '{\n    "$schema": "https://gina.io/schema/connectors.json"\n}\n';
        var r = jch.splitHeader(noComment);
        assert.equal(r.header, '');           // brace at 0 → empty header (unchanged)
        assert.equal(r.braceIndex, noComment.indexOf('{'));
    });
});

// ---------------------------------------------------------------------------
// 04 — BEHAVIORAL REGRESSION: real template rewrite round-trips
// ---------------------------------------------------------------------------

describe('04 - connector:add-style rewrite round-trips (real template)', function () {

    // The object connector:add would produce after
    //   gina connector:add c1 <bundle> @<project> --connector=ai --protocol=openai://
    function rewriteWith(headerSplitFn) {
        var header = headerSplitFn(template);
        var base   = parseJsonc(template);          // { $schema }
        var merged = { $schema: base.$schema, c1: { connector: 'ai', protocol: 'openai://' } };
        return header + JSON.stringify(merged, null, 4) + '\n';
    }

    it('the fixed splitHeader rewrite re-parses via a requireJSON-faithful parse', function () {
        var text = rewriteWith(function (raw) { return jch.splitHeader(raw).header; });
        var reparsed;
        assert.doesNotThrow(function () { reparsed = parseJsonc(text); });
        // round-trip: the added connector is readable back (what connector:list reads)
        assert.ok(reparsed.c1);
        assert.equal(reparsed.c1.connector, 'ai');
        assert.equal(reparsed.c1.protocol, 'openai://');
        assert.equal(reparsed.$schema, 'https://gina.io/schema/connectors.json');
        // and the comment header still leads the file
        assert.ok(/^\/\/ bundle needs to be restarted/.test(text));
    });
});

// ---------------------------------------------------------------------------
// 05 — SUBTRACT: the pre-fix split corrupts the same rewrite
// ---------------------------------------------------------------------------

describe('05 - subtract: the old raw.indexOf split corrupts the rewrite', function () {

    it('splitting at the first RAW brace produces an unparseable file', function () {
        // the exact pre-fix logic: header = (i > 0) ? raw.slice(0, i) : ''
        function oldSplit(raw) {
            var i = raw.indexOf('{');
            return (i > 0) ? raw.slice(0, i) : '';
        }
        var header = oldSplit(template);
        var base   = parseJsonc(template);
        var merged = { $schema: base.$schema, c1: { connector: 'ai', protocol: 'openai://' } };
        var text   = header + JSON.stringify(merged, null, 4) + '\n';
        // the JSON body's opening brace got appended to the `// "couchbase": `
        // comment line → commented out → the file no longer parses
        assert.throws(function () { parseJsonc(text); });
    });
});
