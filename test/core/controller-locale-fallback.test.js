/**
 * #B100 — locale-DB fallback hardening (core/controller/controller.js).
 *
 * Two catch sites — the setOptions locale bridge and `getLocales()` — used to
 * read `settings.region.shortCode` blind (threw `reading 'shortCode'` when the
 * `region` block was absent) and deref the fallback `findOne(...).content`
 * unguarded (threw `reading 'content'` when the resolved language was not in
 * the loaded region set). The schema-valid shape (region present, no
 * `shortCode`) never threw — Collection's `find` round-trips its filter
 * through JSON.stringify, which drops undefined-valued keys, so
 * `findOne({lang: undefined})` match-alls to the FIRST record — but the warn
 * printed `undefined` and the fallback was an accident, not a decision.
 *
 * Post-fix: a shared closure helper `getLocaleFallbackLang(conf)` resolves
 * `region.isoShort` (the schema key, ISO 639-1) → legacy `region.shortCode` →
 * `'en'`, every level guarded, and both catches guard the fallback record
 * before dereferencing `.content`.
 *
 * Sections:
 *   01 — source pins on the helper + both catch sites
 *   02 — behavioural replica against the REAL lib/collection + REAL region
 *        data, plus SUBTRACT cases reproducing all three pre-fix behaviours
 *
 * Usage: node --test test/core/controller-locale-fallback.test.js
 */

var path   = require('path');
var assert = require('assert');
var fs     = require('fs');

var describe = require('node:test').describe;
var it       = require('node:test').it;

var FW       = require('../fw');
var CTRL_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');


describe('01 - guarded locale fallback source pins (#B100)', function() {

    it('defines the shared closure helper getLocaleFallbackLang(conf)', function() {
        assert.match(CTRL_SRC, /var\s+getLocaleFallbackLang\s*=\s*function\s*\(\s*conf\s*\)/);
    });

    it('helper prefers isoShort, honours legacy shortCode, defaults to en — in that order', function() {
        // End-anchor slice: helper definition → the getLocales JSDoc that follows it.
        var hStart = CTRL_SRC.indexOf('var getLocaleFallbackLang');
        var hEnd   = CTRL_SRC.indexOf('this.getLocales', hStart);
        assert.ok(hStart > -1 && hEnd > hStart, 'helper block slice must resolve');
        var block   = CTRL_SRC.slice(hStart, hEnd);
        var isoIdx  = block.indexOf('_region.isoShort');
        var legIdx  = block.indexOf('_region.shortCode');
        var enIdx   = block.indexOf("return 'en'");
        assert.ok(isoIdx > -1, 'isoShort read present');
        assert.ok(legIdx > isoIdx, 'legacy shortCode read AFTER isoShort (priority order)');
        assert.ok(enIdx > legIdx, "final return 'en' after both");
        // every level guarded — the region deref is existence-gated
        assert.match(block, /conf\s*&&\s*conf\.content\s*&&\s*conf\.content\.settings\s*&&\s*conf\.content\.settings\.region/);
    });

    it('has exactly TWO helper call sites (setOptions bridge + getLocales)', function() {
        // The definition is `getLocaleFallbackLang = function(` (an `=` between
        // name and paren), so this pattern counts calls only.
        var calls = (CTRL_SRC.match(/getLocaleFallbackLang\s*\(/g) || []).length;
        assert.equal(calls, 2, 'expected the two catch-site calls, no more, no less');
    });

    it('both catches guard the fallback record before dereferencing .content', function() {
        var guards = (CTRL_SRC.match(/_fallbackLocales\s*&&\s*_fallbackLocales\.content/g) || []).length;
        assert.equal(guards, 2, 'both fallback lookups must be guarded');
    });

    it('both warns interpolate the RESOLVED fallback, never a blind deref', function() {
        var warns = (CTRL_SRC.match(/\+\s*_fallbackLang\s*\+/g) || []).length;
        assert.equal(warns, 2, 'both warns must print the resolved fallback language');
    });

    it('the blind settings.region.shortCode deref is gone file-wide', function() {
        // Access-prefix form — the helper reads `_region.shortCode` (guarded)
        // and comments may name `region.shortCode` bare; only the full blind
        // chain is forbidden.
        assert.doesNotMatch(CTRL_SRC, /local\.options\.conf\.content\.settings\.region\.shortCode/);
    });

});


describe('02 - behavioural replica — REAL Collection + REAL region data (#B100)', function() {

    // Bootstrap: framework bare-module resolution + Object.prototype.count
    // (Collection's match loop depends on it) — same recipe as the scratchpad
    // measurement probe that pinned the pre-fix behaviours.
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));

    // Load the region DB exactly like core/locales/index.js does.
    var dir     = path.join(FW, 'core/locales/dist/region');
    var files   = fs.readdirSync(dir);
    var LOCALES = [];
    for (var f = 0; f < files.length; f++) {
        if (!/^\./.test(files[f])) {
            LOCALES.push({ lang: files[f].split(/\./)[0], content: require(path.join(dir, files[f])) });
        }
    }
    var Collection = require('lib/collection');

    var EN_LEN = null, FR_LEN = null;
    for (var k = 0; k < LOCALES.length; k++) {
        if (LOCALES[k].lang === 'en') { EN_LEN = LOCALES[k].content.length; }
        if (LOCALES[k].lang === 'fr') { FR_LEN = LOCALES[k].content.length; }
    }

    // Verbatim-lifted helper (locked to the shipped block by the §01 pins).
    function getLocaleFallbackLang(conf) {
        var _region = ( conf && conf.content && conf.content.settings && conf.content.settings.region ) ? conf.content.settings.region : null;
        if ( _region ) {
            if ( typeof(_region.isoShort) == 'string' && _region.isoShort.length > 0 ) {
                return _region.isoShort.toLowerCase();
            }
            if ( typeof(_region.shortCode) == 'string' && _region.shortCode.length > 0 ) {
                return _region.shortCode.toLowerCase();
            }
        }
        return 'en';
    }

    // Verbatim-lifted NEW bridge (the fixed catch shape).
    function newBridge(conf, userLangCode, warns) {
        var locales     = new Collection(LOCALES);
        var userLocales = null;
        try {
            userLocales = locales.findOne({ lang: userLangCode }).content;
        } catch (err) {
            var _fallbackLang    = getLocaleFallbackLang(conf);
            warns.push('language code `'+ userLangCode +'` not handled by current locales setup: replacing by default: `'+ _fallbackLang +'`');
            var _fallbackLocales = locales.findOne({ lang: _fallbackLang }) || locales.findOne({ lang: 'en' });
            userLocales = ( _fallbackLocales && _fallbackLocales.content ) ? _fallbackLocales.content : [];
        }
        return userLocales;
    }

    // Verbatim-lifted OLD bridge (the pre-fix catch shape) — the subtract.
    function oldBridge(conf, userLangCode, warns) {
        var locales     = new Collection(LOCALES);
        var userLocales = null;
        try {
            userLocales = locales.findOne({ lang: userLangCode }).content;
        } catch (err) {
            warns.push('language code `'+ userLangCode +'` not handled by current locales setup: replacing by default: `'+ conf.content.settings.region.shortCode +'`');
            userLocales = locales.findOne({ lang: conf.content.settings.region.shortCode }).content; // by default
        }
        return userLocales;
    }

    var confSchemaValid = { content: { settings: { region: { culture: 'fr_FR', isoShort: 'fr', date: 'dd/mm/yyyy', timeZone: 'Europe/Paris' } } } };
    var confNoIsoShort  = { content: { settings: { region: { culture: 'fr_FR' } } } };
    var confNoRegion    = { content: { settings: {} } };
    var confLegacyBad   = { content: { settings: { region: { shortCode: 'zz' } } } };
    var confLegacyGood  = { content: { settings: { region: { shortCode: 'fr' } } } };

    it('sanity — region data loaded with en and fr', function() {
        assert.ok(EN_LEN > 0, 'en region data present');
        assert.ok(FR_LEN > 0, 'fr region data present');
        assert.notEqual(EN_LEN, FR_LEN, 'the two region sets are distinguishable by size');
    });

    it('helper: isoShort wins, shortCode is legacy fallback, en is the final default', function() {
        assert.equal(getLocaleFallbackLang(confSchemaValid), 'fr');
        assert.equal(getLocaleFallbackLang({ content: { settings: { region: { isoShort: 'de', shortCode: 'fr' } } } }), 'de');
        assert.equal(getLocaleFallbackLang(confLegacyGood), 'fr');
        assert.equal(getLocaleFallbackLang(confNoIsoShort), 'en');
        assert.equal(getLocaleFallbackLang(confNoRegion), 'en');
        assert.equal(getLocaleFallbackLang(null), 'en');
    });

    it('loaded language takes the try path — catch untouched', function() {
        var warns = [];
        var out = newBridge(confSchemaValid, 'en', warns);
        assert.equal(out.length, EN_LEN);
        assert.equal(warns.length, 0);
    });

    it('unknown lang + schema-valid region → isoShort fallback, honest warn', function() {
        var warns = [];
        var out = newBridge(confSchemaValid, 'xx', warns);
        assert.equal(out.length, FR_LEN, 'isoShort fr resolved the fr region set');
        assert.match(warns[0], /replacing by default: `fr`/);
        assert.doesNotMatch(warns[0], /undefined/);
    });

    it('unknown lang + region WITHOUT isoShort/shortCode → en default, honest warn', function() {
        var warns = [];
        var out = newBridge(confNoIsoShort, 'xx', warns);
        assert.equal(out.length, EN_LEN);
        assert.match(warns[0], /replacing by default: `en`/);
    });

    it('unknown lang + region block ABSENT → NO throw, en default (pre-fix: TypeError)', function() {
        var warns = [];
        var out = newBridge(confNoRegion, 'xx', warns);
        assert.equal(out.length, EN_LEN);
        assert.match(warns[0], /replacing by default: `en`/);
    });

    it('legacy shortCode naming an UNLOADED lang → NO throw, en retry (pre-fix: TypeError)', function() {
        var warns = [];
        var out = newBridge(confLegacyBad, 'xx', warns);
        assert.equal(out.length, EN_LEN, 'fallback findOne missed → guarded en retry');
        assert.match(warns[0], /replacing by default: `zz`/);
    });

    it('legacy shortCode naming a LOADED lang still honoured', function() {
        var warns = [];
        var out = newBridge(confLegacyGood, 'xx', warns);
        assert.equal(out.length, FR_LEN);
    });

    it('SUBTRACT — pre-fix shape THREW when the region block was absent', function() {
        var warns = [];
        assert.throws(function() { oldBridge(confNoRegion, 'xx', warns); }, /shortCode/);
        assert.equal(warns.length, 0, 'the warn itself was the throw site — it never printed');
    });

    it('SUBTRACT — pre-fix shape THREW on an unloaded legacy shortCode', function() {
        var warns = [];
        assert.throws(function() { oldBridge(confLegacyBad, 'xx', warns); }, /content/);
        assert.match(warns[0], /replacing by default: `zz`/, 'warn printed, then the .content deref threw');
    });

    it('SUBTRACT — pre-fix schema-valid shape fell back by ACCIDENT with an `undefined` warn', function() {
        // region present, no shortCode: findOne({lang: undefined}) match-alls to
        // the FIRST record (JSON.stringify drops undefined filter keys), so the
        // old shape returned the en content while warning `undefined`.
        var warns = [];
        var out = oldBridge(confNoIsoShort, 'xx', warns);
        assert.equal(out.length, EN_LEN, 'accidental first-record fallback');
        assert.match(warns[0], /replacing by default: `undefined`/);
    });

});
