'use strict';

/**
 * Drift-detection test for the #DTO3 type emitter (mirrors gna-types-drift.test.js).
 *
 * Re-runs `lib/dto-types` in memory over the committed fixture DTOs and compares the
 * result to the committed artifact. Any mismatch means the emitter's output changed
 * without the artifact being regenerated — i.e. every bundle's `dtos/index.d.ts` in the
 * wild would silently drift from what `gina bundle:types` now produces.
 *
 * The fixture deliberately covers the whole vocabulary: required/optional, every scalar,
 * a date, value + length bounds, a pattern, string/numeric/boolean enums, a quoted
 * non-identifier key, `.passthrough()`, `.exclude()` (both the Omit and the plain-alias
 * branches), object-level title/description, and a DTO whose `toRules()` THROWS on an
 * authored dollar sign but which must still emit types.
 *
 * Regenerate with:
 *   gina bundle:types <bundle> @<project>     (for a real bundle)
 *   node --test test/lib/dto-types-drift.test.js   (this test tells you when it drifted)
 */

var { test } = require('node:test');
var assert   = require('node:assert/strict');
var fs       = require('fs');
var path     = require('path');

var FW = require('../fw');

var dto      = require(path.join(FW, 'lib/dto/src/main.js'));
var dtoTypes = require(path.join(FW, 'lib/dto-types/src/main.js'));

var FIXTURE  = path.join(__dirname, '..', 'fixtures', 'dto-types');
var DTOS_DIR = path.join(FIXTURE, 'dtos');
var ARTIFACT = path.join(FIXTURE, 'expected.d.ts');

test('test/fixtures/dto-types/expected.d.ts is in sync with lib/dto-types', function () {

    // Resolve the fixture DTOs exactly as `bundle:types` does: sorted (readdir order is
    // filesystem-dependent) and through the shared offline resolver.
    var names = fs.readdirSync(DTOS_DIR)
        .filter(function (f) { return /\.js$/.test(f); })
        .map(function (f) { return f.replace(/\.js$/, ''); })
        .sort();

    assert.ok(names.length > 0, 'the fixture must carry DTOs — an empty fixture would make ' +
        'this test pass vacuously');

    var dtos = names.map(function (n) { return dto.load(FIXTURE, n); });
    assert.ok(dtos.every(Boolean), 'every fixture DTO must resolve');

    var expected = dtoTypes.emit(dtos, { bundle: 'fixture' });
    var actual   = fs.readFileSync(ARTIFACT, 'utf8');

    if (expected !== actual) {
        var expLines = expected.split('\n');
        var actLines = actual.split('\n');
        var limit    = Math.max(expLines.length, actLines.length);
        var firstDiff = -1;
        for (var i = 0; i < limit; i++) {
            if (expLines[i] !== actLines[i]) { firstDiff = i + 1; break; }
        }
        assert.fail(
            'test/fixtures/dto-types/expected.d.ts drifted from lib/dto-types output. ' +
            'Regenerate it (the emitter changed — check every bundle\'s dtos/index.d.ts too).' +
            (firstDiff > 0
                ? '\n  First diff at line ' + firstDiff +
                  '\n  expected: ' + JSON.stringify(expLines[firstDiff - 1]) +
                  '\n  actual:   ' + JSON.stringify(actLines[firstDiff - 1])
                : '')
        );
    }
});
