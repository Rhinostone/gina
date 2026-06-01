/**
 * lib/cmd/bundle/inc/name-rewrite.js — the pure, shared bundle-name rewrite
 * engine used by `bundle:copy` and `bundle:rename`.
 *
 * Unlike the handler tests (which are source-inspection), this module is pure
 * (no fs, no framework globals), so it is exercised DIRECTLY by require-by-path
 * (the cmd-status-format idiom). Section 08 source-pins lock the two
 * word-boundary regex operators so the behaviour can't silently drift.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var MODULE_PATH = path.join(require('../fw'), 'lib/cmd/bundle/inc/name-rewrite.js');
var nr  = require(MODULE_PATH);
var src = fs.readFileSync(MODULE_PATH, 'utf8');


// ---------------------------------------------------------------------------
// 01 — module shape + purity
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports escapeRegex / capitalize / renameContent / countOccurrences', function () {
        assert.equal(typeof nr.escapeRegex, 'function');
        assert.equal(typeof nr.capitalize, 'function');
        assert.equal(typeof nr.renameContent, 'function');
        assert.equal(typeof nr.countOccurrences, 'function');
    });

    it('is pure — no fs / framework globals', function () {
        assert.doesNotMatch(src, /require\(\s*'fs'\s*\)/);
        assert.doesNotMatch(src, /lib\.generator|lib\.logger|requireJSON|createFileFromDataSync/);
    });
});


// ---------------------------------------------------------------------------
// 02 — escapeRegex
// ---------------------------------------------------------------------------

describe('02 - escapeRegex', function () {

    it('escapes regex metacharacters', function () {
        assert.equal(nr.escapeRegex('a.b'), 'a\\.b');
        assert.equal(nr.escapeRegex('a+b*c'), 'a\\+b\\*c');
    });

    it('leaves a plain name untouched', function () {
        assert.equal(nr.escapeRegex('api'), 'api');
    });
});


// ---------------------------------------------------------------------------
// 03 — capitalize
// ---------------------------------------------------------------------------

describe('03 - capitalize', function () {

    it('upper-cases the first character only', function () {
        assert.equal(nr.capitalize('api'), 'Api');
        assert.equal(nr.capitalize('webApp'), 'WebApp');
    });
});


// ---------------------------------------------------------------------------
// 04 — renameContent: copy behaviour (fixWebroot: true)
// ---------------------------------------------------------------------------

describe('04 - renameContent (copy / fixWebroot:true)', function () {

    it('renames the PascalCase controller class identifiers', function () {
        assert.equal(nr.renameContent('function ApiController() {}', 'api', 'web'), 'function WebController() {}');
        assert.equal(nr.renameContent('module.exports = ApiContentController', 'api', 'web'), 'module.exports = WebContentController');
    });

    it('renames the require-var and all its uses (whole-word lowercase)', function () {
        assert.equal(
            nr.renameContent("var api = require('gina'); api.onError(); api.start();", 'api', 'web'),
            "var web = require('gina'); web.onError(); web.start();"
        );
    });

    it('renames the app.json "name" value', function () {
        assert.equal(nr.renameContent('"name": "api"', 'api', 'web'), '"name": "web"');
    });

    it('renames a standalone capitalized word in a comment', function () {
        assert.equal(nr.renameContent(' * Api bundle', 'api', 'web'), ' * Web bundle');
    });

    it('first-bundle webroot "/" -> "/<dest>" when fixWebroot is true, preserving comments', function () {
        assert.equal(
            nr.renameContent('    "webroot": "/" // keep me', 'api', 'web', { fixWebroot: true }),
            '    "webroot": "/web" // keep me'
        );
    });
});


// ---------------------------------------------------------------------------
// 05 — renameContent: rename behaviour (fixWebroot omitted/false)
// ---------------------------------------------------------------------------

describe('05 - renameContent (rename / fixWebroot:false)', function () {

    it('leaves a first-bundle webroot "/" UNCHANGED (no collision on rename)', function () {
        assert.equal(nr.renameContent('    "webroot": "/"', 'api', 'web'), '    "webroot": "/"');
        assert.equal(nr.renameContent('    "webroot": "/"', 'api', 'web', { fixWebroot: false }), '    "webroot": "/"');
    });

    it('still rewrites a name-derived webroot "/api" -> "/web" via the lowercase pass', function () {
        assert.equal(nr.renameContent('    "webroot": "/api"', 'api', 'web'), '    "webroot": "/web"');
    });

    it('renames identifiers the same as copy (only the webroot branch differs)', function () {
        assert.equal(nr.renameContent('function ApiController(){} var api = 1;', 'api', 'web'), 'function WebController(){} var web = 1;');
    });
});


// ---------------------------------------------------------------------------
// 06 — renameContent: boundaries (no false positives, path segments, escaping)
// ---------------------------------------------------------------------------

describe('06 - renameContent boundaries', function () {

    it('does NOT touch a name embedded inside a larger token', function () {
        assert.equal(nr.renameContent('var apiKey = 1; var myapi = 2; rapid;', 'api', 'web'), 'var apiKey = 1; var myapi = 2; rapid;');
        assert.equal(nr.renameContent('apiClient.fetch()', 'api', 'web'), 'apiClient.fetch()');
    });

    it('DOES rewrite a name that is a whole path segment (documented — the reason --dry-run exists)', function () {
        assert.equal(nr.renameContent('"/api/v1"', 'api', 'web'), '"/web/v1"');
    });

    it('escapes regex metacharacters in the bundle name', function () {
        assert.equal(nr.renameContent('var a.b = 1; axb;', 'a.b', 'web'), 'var web = 1; axb;');
    });
});


// ---------------------------------------------------------------------------
// 07 — countOccurrences
// ---------------------------------------------------------------------------

describe('07 - countOccurrences', function () {

    it('counts capitalized + lowercase whole-word hits, ignores embedded', function () {
        var content = "var api = require('gina');\nfunction ApiController(){}\napi.start();\nvar apiKey = 1;";
        // hits: api (var), ApiController (cap), api (start) -> 3 ; apiKey embedded -> 0
        assert.equal(nr.countOccurrences(content, 'api'), 3);
    });

    it('returns 0 when the name is absent', function () {
        assert.equal(nr.countOccurrences('var x = 1;', 'api'), 0);
    });
});


// ---------------------------------------------------------------------------
// 08 — source-pins: lock the word-boundary regex operators
// ---------------------------------------------------------------------------

describe('08 - operator pins', function () {

    it('capitalized PascalCase-prefix pass: \\b<SrcCap> -> DstCap', function () {
        assert.match(src, /new RegExp\('\\\\b' \+ escapeRegex\(SrcCap\), 'g'\), DstCap/);
    });

    it('lowercase whole-word pass: \\b<source>\\b -> dest', function () {
        assert.match(src, /new RegExp\('\\\\b' \+ escapeRegex\(source\) \+ '\\\\b', 'g'\), dest/);
    });

    it('webroot fix is gated on opts.fixWebroot', function () {
        assert.match(src, /if \( opts\.fixWebroot \)/);
        assert.match(src, /'\$1"\/' \+ dest \+ '"'/);
    });
});
