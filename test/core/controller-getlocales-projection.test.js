/**
 * getLocales().getCountries(code) — behavioral projection tests
 * (gina-io/gina#50 defect 4).
 *
 * Pre-fix, `getCountries(code)` computed a `cde` selector from its documented
 * `code` argument and then never read it — the projection argument had no
 * effect. Post-fix, a valid `code` ADDS that field to every returned row; the
 * 4 historical fields (`isoShort`, `isoLong`, `countryName`,
 * `officialStateName`) are always present, so no-arg calls are byte-identical.
 *
 * Sections:
 *   01 — source pins locking the additive-projection shape
 *   02 — behavioral: drives the REAL controller via createTestInstance
 *        (the §36 framework-globals bootstrap recipe)
 *
 * Usage: node --test test/core/controller-getlocales-projection.test.js
 */

var path   = require('path');
var fs     = require('fs');
var assert = require('assert');

var describe = require('node:test').describe;
var it       = require('node:test').it;

var FW       = require('../fw');
var SOURCE   = path.join(FW, 'core/controller/controller.js');
var CTRL_SRC = fs.readFileSync(SOURCE, 'utf8');


describe('01 - additive projection source pins (#50)', function() {

    // Block slice: the getCountries definition → its closing `return list`.
    var gStart = CTRL_SRC.indexOf('var getCountries = function (code)');
    var gEnd   = CTRL_SRC.indexOf('return list', gStart);
    var block  = CTRL_SRC.slice(gStart, gEnd);

    it('the getCountries block resolves', function() {
        assert.ok(gStart > -1 && gEnd > gStart);
    });

    it('the selector defaults to null and is only set from a validated `code`', function() {
        assert.match(block, /var list = \[\], cde = null;/);
    });

    it('the projection loop reads the selector (the pre-fix dead-arg shape is gone)', function() {
        assert.match(block, /list\[\s*i\s*\]\[\s*cde\s*\]\s*=\s*userLocales\[\s*i\s*\]\[\s*cde\s*\]/);
    });

    it('an empty locale set cannot throw on the probe read', function() {
        assert.match(block, /userLocales\.length\s*>\s*0\s*&&\s*typeof\(userLocales\[0\]\[code\]\)/);
    });

    it('getLocales degrades to an empty list when the locale bridge never ran', function() {
        assert.match(CTRL_SRC, /var userLocales = local\.options\.conf\.locales \|\| \[\];/);
    });
});


describe('02 - behavioral: real controller via createTestInstance (#50)', function() {

    var FIXTURE_FR = [
        { isoShort: 'DE', isoLong: 'DEU', countryName: 'Allemagne',  officialStateName: 'République fédérale d\'Allemagne', capital: 'Berlin', continent: 'EU', languages: ['de'] },
        { isoShort: 'FR', isoLong: 'FRA', countryName: 'France',     officialStateName: 'République française',             capital: 'Paris',  continent: 'EU', languages: ['fr'] }
    ];
    var FIXTURE_EN = [
        { isoShort: 'DE', isoLong: 'DEU', countryName: 'Germany',    officialStateName: 'Federal Republic of Germany',      capital: 'Berlin', continent: 'EU', languages: ['de'] },
        { isoShort: 'FR', isoLong: 'FRA', countryName: 'France',     officialStateName: 'French Republic',                  capital: 'Paris',  continent: 'EU', languages: ['fr'] }
    ];

    // Framework-globals bootstrap (§36 recipe).
    var FW2 = require('../fw');
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW2;
    require('module').Module._initPaths();
    require(path.join(FW2, 'helpers'));              // injects _/getPath/setContext/setPath globals
    setPath('gina', { core: path.join(FW2, 'core') });
    var SuperController = require(SOURCE);

    function makeInstance(locales) {
        var conf = { bundle: 'b', content: { routing: {} } };
        if (typeof (locales) != 'undefined') {
            conf.locales = locales;
        }
        return SuperController.createTestInstance({
            req     : { headers: {} },
            res     : { setHeader: function () {}, end: function () {} },
            options : { conf: conf, rule: '_test' }
        });
    }

    it('no-arg: rows carry exactly the 4 historical fields (byte-identical contract)', function() {
        var rows = makeInstance(FIXTURE_FR).getLocales().getCountries();
        assert.equal(rows.length, 2);
        assert.deepEqual(Object.keys(rows[0]).sort(), ['countryName', 'isoLong', 'isoShort', 'officialStateName']);
        assert.equal(rows[0].countryName, 'Allemagne');
        assert.equal(rows[0].officialStateName, 'République fédérale d\'Allemagne');
    });

    it('valid code: each row gains that field (additive projection)', function() {
        var rows = makeInstance(FIXTURE_FR).getLocales().getCountries('capital');
        assert.deepEqual(Object.keys(rows[0]).sort(), ['capital', 'countryName', 'isoLong', 'isoShort', 'officialStateName']);
        assert.equal(rows[0].capital, 'Berlin');
        assert.equal(rows[1].capital, 'Paris');
    });

    it('unknown code: warns path keeps the 4-field shape (no throw, no extra field)', function() {
        var rows = makeInstance(FIXTURE_FR).getLocales().getCountries('bogus');
        assert.equal(rows.length, 2);
        assert.deepEqual(Object.keys(rows[0]).sort(), ['countryName', 'isoLong', 'isoShort', 'officialStateName']);
    });

    it('non-string field (array): rejected like an unknown code, 4-field shape kept', function() {
        var rows = makeInstance(FIXTURE_FR).getLocales().getCountries('languages');
        assert.deepEqual(Object.keys(rows[0]).sort(), ['countryName', 'isoLong', 'isoShort', 'officialStateName']);
    });

    it('empty locale set + code: returns [] instead of throwing on the probe read', function() {
        var rows = makeInstance([]).getLocales().getCountries('capital');
        assert.deepEqual(rows, []);
    });

    it('missing locale bridge (viewless bundle): getCountries degrades to []', function() {
        var rows = makeInstance(undefined).getLocales().getCountries();
        assert.deepEqual(rows, []);
    });

    it('getLocales(lang) resolves the requested language set from the region registry', function() {
        setContext('gina', { locales: [
            { lang: 'en', content: FIXTURE_EN },
            { lang: 'fr', content: FIXTURE_FR }
        ] });
        var rows = makeInstance(FIXTURE_EN).getLocales('fr').getCountries();
        assert.equal(rows[0].countryName, 'Allemagne', 'the explicit language arg must override the request default');
    });

    it('getLocales(unknown lang) falls back through the #B100 chain to en', function() {
        setContext('gina', { locales: [
            { lang: 'en', content: FIXTURE_EN },
            { lang: 'fr', content: FIXTURE_FR }
        ] });
        var rows = makeInstance(FIXTURE_FR).getLocales('zz').getCountries();
        assert.equal(rows[0].countryName, 'Germany', 'unknown language degrades to the en set');
    });
});
