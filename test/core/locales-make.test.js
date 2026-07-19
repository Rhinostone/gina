/**
 * Region locale generator — behavioral tests (gina-io/gina#50).
 *
 * Drives the REAL generator (core/locales/src/make.js) against fixture CSV +
 * names files in a temp dir, with output redirected via `opt.outdir`. Locks
 * the four #50 generator defects:
 *
 *   01 — source pins (accumulator reset, empty-iso filter, mapping clone,
 *        CLI gate) so the behavioral suite cannot silently drift from the
 *        shipped code
 *   02 — a two-pass en,fr run emits STANDALONE files (the accumulator used
 *        to append the second language's rows to the first's output)
 *   03 — a non-en pass overlays `countryName` from region.names.<lang>.json
 *        (the CSV `name` column only carries the English short name)
 *   04 — rows with an empty isoShort are dropped from the region target
 *   05 — a non-en pass without a names file fails fast instead of silently
 *        emitting English `countryName` values
 *   06 — fr-then-en pass order still emits `officialStateName` for en (the
 *        cached mapping is cloned per pass, so the non-en remap cannot leak
 *        into a later pass)
 *
 * Usage: node --test test/core/locales-make.test.js
 */

var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var assert = require('assert');

var describe = require('node:test').describe;
var it       = require('node:test').it;

var FW       = require('../fw');
var MAKE_SRC = fs.readFileSync(path.join(FW, 'core/locales/src/make.js'), 'utf8');

// Framework-globals bootstrap — bare-module resolution + `_`/`requireJSON`
// globals + JSON.clone (via the lib require chain), same recipe as
// controller-locale-fallback.test.js §02.
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
require(path.join(FW, '..', '..', 'utils', 'prototypes'));

var Make = require(path.join(FW, 'core/locales/src/make.js'));

// Fixture CSV — real column names (the generator always reads the REAL
// resources/region.mapping.json, so the header must use the real names).
// Row 3 is an aggregate row with no ISO 3166 alpha-2 code.
var FIXTURE_CSV = [
    'name;official_name_en;official_name_fr;ISO3166-1-Alpha-2;ISO3166-1-Alpha-3',
    'Germany;Federal Republic of Germany;République fédérale d\'Allemagne;DE;DEU',
    'United States;United States of America;États-Unis d\'Amérique;US;USA',
    'Channel Islands;Channel Islands;Îles Anglo-Normandes;;',
    'United Kingdom;United Kingdom of Great Britain;Royaume-Uni de Grande-Bretagne;GB;GBR'
].join('\n');

var FIXTURE_NAMES_FR = {
    DE: 'Allemagne',
    US: 'États-Unis',
    GB: 'Royaume-Uni'
};

/**
 * Lays down a fixture dir (CSV + optional names file) and an output dir.
 *
 * @param {boolean} withNames - whether to write region.names.fr.json
 * @returns {object} paths - { csv, outdir }
 */
function makeFixture(withNames) {
    var root   = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-locales-make-'));
    var outdir = path.join(root, 'out');
    fs.mkdirSync(outdir);
    var csv = path.join(root, 'region.csv');
    fs.writeFileSync(csv, FIXTURE_CSV);
    if (withNames) {
        fs.writeFileSync(path.join(root, 'region.names.fr.json'), JSON.stringify(FIXTURE_NAMES_FR, null, 2));
    }
    return { csv: csv, outdir: outdir };
}

function readOut(outdir, lang) {
    return JSON.parse(fs.readFileSync(path.join(outdir, lang + '.json'), 'utf8'));
}


describe('01 - generator source pins (#50)', function() {

    it('resets the accumulator before each parse (standalone files per pass)', function() {
        var genStart = MAKE_SRC.indexOf('var generate = function');
        var callIdx  = MAKE_SRC.indexOf('csvToCollection(content.toString())', genStart);
        var resetIdx = MAKE_SRC.indexOf('self.body = null', genStart);
        assert.ok(genStart > -1 && callIdx > -1 && resetIdx > -1, 'anchors must resolve');
        assert.ok(resetIdx < callIdx, 'the reset must run BEFORE the CSV parse');
    });

    it('filters rows with an empty isoShort on the region target', function() {
        assert.match(MAKE_SRC, /self\.body\s*=\s*self\.body\.filter\(/);
    });

    it('clones the cached mapping per pass', function() {
        assert.match(MAKE_SRC, /rec\.mapping\s*=\s*JSON\.clone\(\s*requireJSON\(mappingFile\)\s*\)/);
    });

    it('localizes countryName for non-en passes, fail-fast on a missing names file', function() {
        assert.match(MAKE_SRC, /var localizeCountryNames = function/);
        assert.match(MAKE_SRC, /localization source not found/);
    });

    it('only runs the CLI when invoked directly (require.main gate)', function() {
        assert.match(MAKE_SRC, /require\.main === module/);
        assert.equal(typeof Make, 'function', 'requiring the module must yield the factory, not execute the CLI');
    });
});


describe('02 - two-pass en,fr run emits standalone files (#50 defect 1)', function() {

    var fx = makeFixture(true);
    var m  = Make();
    m.generate({ target: 'region', region: 'en', filename: fx.csv, outdir: fx.outdir });
    m.generate({ target: 'region', region: 'fr', filename: fx.csv, outdir: fx.outdir });

    var en = readOut(fx.outdir, 'en');
    var fr = readOut(fx.outdir, 'fr');

    it('the second pass does NOT append to the first (no duplicated codes)', function() {
        assert.equal(en.length, 3, 'en: 3 coded rows (the empty-iso row is dropped)');
        assert.equal(fr.length, 3, 'fr: 3 rows too — NOT 6 (the pre-fix accumulator doubled it)');
        var frCodes = fr.map(function (r) { return r.isoShort; }).sort();
        assert.deepEqual(frCodes, ['DE', 'GB', 'US'], 'every code exactly once');
    });

    it('both files cover the same iso set', function() {
        var enCodes = en.map(function (r) { return r.isoShort; }).sort();
        var frCodes = fr.map(function (r) { return r.isoShort; }).sort();
        assert.deepEqual(enCodes, frCodes);
    });

    it('en keeps the English short + official names', function() {
        var de = en.filter(function (r) { return r.isoShort === 'DE'; })[0];
        assert.equal(de.countryName, 'Germany');
        assert.equal(de.officialStateName, 'Federal Republic of Germany');
    });

    it('fr rows carry the localized officialStateName from the per-language CSV column', function() {
        var de = fr.filter(function (r) { return r.isoShort === 'DE'; })[0];
        assert.equal(de.officialStateName, 'République fédérale d\'Allemagne');
    });
});


describe('03 - non-en countryName overlay (#50 defects 2+3)', function() {

    var fx = makeFixture(true);
    var m  = Make();
    m.generate({ target: 'region', region: 'fr', filename: fx.csv, outdir: fx.outdir });
    var fr = readOut(fx.outdir, 'fr');

    it('countryName is the localized SHORT name, not the English one', function() {
        var by = {};
        fr.forEach(function (r) { by[r.isoShort] = r; });
        assert.equal(by.DE.countryName, 'Allemagne');
        assert.equal(by.US.countryName, 'États-Unis');
        assert.equal(by.GB.countryName, 'Royaume-Uni');
    });

    it('officialStateName keeps the long official form (distinct field)', function() {
        var us = fr.filter(function (r) { return r.isoShort === 'US'; })[0];
        assert.equal(us.officialStateName, 'États-Unis d\'Amérique');
    });
});


describe('04 - empty-isoShort rows are dropped (#50 empty_iso gate)', function() {

    var fx = makeFixture(true);
    var m  = Make();
    m.generate({ target: 'region', region: 'en', filename: fx.csv, outdir: fx.outdir });
    var en = readOut(fx.outdir, 'en');

    it('no emitted row has an empty isoShort', function() {
        var empties = en.filter(function (r) {
            return typeof (r.isoShort) != 'string' || r.isoShort.trim().length === 0;
        });
        assert.equal(empties.length, 0);
    });
});


describe('05 - a non-en pass without a names file fails fast (#50)', function() {

    it('throws naming the expected file instead of silently emitting English names', function() {
        var fx = makeFixture(false); // no region.names.fr.json
        var m  = Make();
        assert.throws(function () {
            m.generate({ target: 'region', region: 'fr', filename: fx.csv, outdir: fx.outdir });
        }, /localization source not found for `fr`/);
    });
});


describe('06 - fr-then-en pass order (mapping clone) (#50)', function() {

    it('a later en pass still emits officialStateName (the fr remap cannot leak through the cache)', function() {
        var fx = makeFixture(true);
        var m  = Make();
        m.generate({ target: 'region', region: 'fr', filename: fx.csv, outdir: fx.outdir });
        m.generate({ target: 'region', region: 'en', filename: fx.csv, outdir: fx.outdir });
        var en = readOut(fx.outdir, 'en');
        assert.equal(en.length, 3);
        var de = en.filter(function (r) { return r.isoShort === 'DE'; })[0];
        assert.equal(de.officialStateName, 'Federal Republic of Germany',
            'pre-fix, the fr pass deleted official_name_en from the CACHED mapping, so a later en pass lost officialStateName entirely');
    });
});
