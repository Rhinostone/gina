'use strict';
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW      = require('../fw');
var dataDir = path.join(FW, 'helpers', 'data', 'test', 'data');

// helpers/data exposes formatDataFromString as an implicit global once the
// DataHelper constructor runs (gina GFF-context convention — see
// helpers/data/src/main.js). Mirror that here, then read it off `global`.
require(path.join(FW, 'helpers', 'data', 'src', 'main'))();
var formatDataFromString = global.formatDataFromString;

// The request pipeline hands the helper a JSON string of flat, structured keys.
function asBodyString(fixture) {
    return JSON.stringify(JSON.parse(fs.readFileSync(path.join(dataDir, fixture), 'utf8')));
}

// Ported from the dormant nodeunit suite at
// helpers/data/test/01-format-data-from-string.js (which never ran — nodeunit
// is not installed). Expectations characterise verified current behaviour
// (captured 2026-06-06); the original's shadowed-export bug (case 2 and 3
// shared a name, so case 3 never ran) is fixed by the distinct it() names below.
describe('formatDataFromString — structured-key body reconstruction', function () {

    it('body_string.json — nests bracketed keys and coerces "false" to boolean false', function () {
        var obj = formatDataFromString(asBodyString('body_string.json'));
        assert.equal(typeof obj, 'object');
        assert.ok(Array.isArray(obj.design), 'design[N][…] reconstructs an array');
        assert.equal(obj.design.length, 1);
        assert.equal(obj.design[0].id, 'original');
        // "false" (string) -> false (boolean)
        assert.equal(obj.design[0].extras.isHidden, false);
        assert.equal(typeof obj.design[0].extras.isHidden, 'boolean');
        assert.ok(Array.isArray(obj.design[0].images));
        assert.equal(obj.design[0].images[0].id, 'header');
        assert.equal(obj.design[0].colors.length, 7);
        assert.equal(obj.design[0].fonts.length, 5);
    });

    it('body_string2.json — a leading non-zero index yields a null-padded array', function () {
        var obj = formatDataFromString(asBodyString('body_string2.json'));
        assert.equal(obj.company.selectedDesignId, 'scooter');
        assert.equal(obj.design.length, 2);
        // design[1][…] with no design[0][…]: slot 0 is an empty array hole that
        // serialises as null in array context (JSON.stringify of the slot alone is undefined)
        assert.ok(JSON.stringify(obj.design).startsWith('[null,'), 'leading slot serialises as null');
        assert.equal(obj.design[1].id, 'scooter');
        assert.equal(obj.design[1].colors.length, 7);
    });

    it('body_string3.json — merges multipart upload fields into the nested image entry', function () {
        var obj = formatDataFromString(asBodyString('body_string3.json'));
        assert.equal(obj.company.selectedDesignId, 'original');
        var img = obj.design[0].images[0];
        assert.equal(img.originalFilename, 'logo.svg');
        assert.equal(img.ext, '.svg');
        assert.equal(img.mime, 'image/svg+xml');
        assert.equal(img.size, '4374');
        assert.equal(img.location, '/tmp/uploads/logo.svg');
    });
});
