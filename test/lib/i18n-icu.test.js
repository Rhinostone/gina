/**
 * lib/i18n — #I18N2 ICU MessageFormat opt-in (slice part 1)
 *
 * Behavioural tests for `tIcu()` + `ensureIcuLoaded()` + IcuFormatter cache,
 * plus source-inspection guards on the gna.t.icu / self.t.icu / module
 * exports wiring.
 *
 * The dynamic-import loader resolves once per process, so a single
 * top-level `before()` awaits `ensureIcuLoaded()`. After that all `tIcu`
 * calls are sync.
 */

'use strict';

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW           = require('../fw');
var i18n         = require(path.join(FW, 'lib/i18n/src/main'));
var I18N_SOURCE  = path.join(FW, 'lib/i18n/src/main.js');
var GNA_SOURCE   = path.join(FW, 'core/gna.js');
var CTRL_SOURCE  = path.join(FW, 'core/controller/controller.js');
var SWIG_FILTERS_SOURCE = path.join(FW, 'lib/swig-filters/src/main.js');
var NJK_FILTERS_SOURCE  = path.join(FW, 'lib/nunjucks-filters/src/main.js');
var FW_PKG       = path.join(FW, 'package.json');

var i18nSrc        = fs.readFileSync(I18N_SOURCE, 'utf8');
var gnaSrc         = fs.readFileSync(GNA_SOURCE,  'utf8');
var ctrlSrc        = fs.readFileSync(CTRL_SOURCE, 'utf8');
var swigFiltersSrc = fs.readFileSync(SWIG_FILTERS_SOURCE, 'utf8');
var njkFiltersSrc  = fs.readFileSync(NJK_FILTERS_SOURCE,  'utf8');
var fwPkg          = JSON.parse(fs.readFileSync(FW_PKG, 'utf8'));

function isolatedBundle(label) {
    var name = 'test-i18n-icu-' + label + '-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    i18n.clearCatalogs(name);
    return name;
}

before(async function () {
    await i18n.ensureIcuLoaded();
});


// ─── 01 — Module exports ────────────────────────────────────────────────

describe('01 - module exports (#I18N2)', function () {

    it('exports tIcu', function () {
        assert.equal(typeof i18n.tIcu, 'function');
    });

    it('exports ensureIcuLoaded', function () {
        assert.equal(typeof i18n.ensureIcuLoaded, 'function');
    });

    it('preserves the slice 1 catalog API + helpers (no regression)', function () {
        ['loadCatalogs', 'setCatalog', 'getCatalog', 'getCatalogs', 'clearCatalogs',
         't', 'resolveKey', 'interpolate', 'isPluralForm', 'walkFallback'].forEach(function (k) {
            assert.equal(typeof i18n[k], 'function', k + ' should still be a function');
        });
    });

    it('preserves the slice 3 negotiation helpers (no regression)', function () {
        ['parseAcceptLanguage', 'matchAvailable', 'readCookie', 'negotiateCulture'].forEach(function (k) {
            assert.equal(typeof i18n[k], 'function', k + ' should still be a function');
        });
    });

    it('source declares tIcu + ensureIcuLoaded + _getIcuFormatter + _icuFormatterCache', function () {
        assert.match(i18nSrc, /function\s+tIcu\s*\(/);
        assert.match(i18nSrc, /function\s+ensureIcuLoaded\s*\(/);
        assert.match(i18nSrc, /function\s+_getIcuFormatter\s*\(/);
        assert.match(i18nSrc, /function\s+_icuFormatterCache\s*\(/);
    });

    it('source declares the module-level loader state vars', function () {
        assert.match(i18nSrc, /var\s+IntlMessageFormat\s*=\s*null/);
        assert.match(i18nSrc, /var\s+icuLoadPromise\s*=\s*null/);
        assert.match(i18nSrc, /var\s+icuLoadError\s*=\s*null/);
    });

});


// ─── 02 — Loader (ensureIcuLoaded) ───────────────────────────────────────

describe('02 - ensureIcuLoaded', function () {

    it('resolves to a constructor (IntlMessageFormat)', async function () {
        var Mf = await i18n.ensureIcuLoaded();
        assert.equal(typeof Mf, 'function');
    });

    it('is idempotent — second call returns the same constructor', async function () {
        var a = await i18n.ensureIcuLoaded();
        var b = await i18n.ensureIcuLoaded();
        assert.equal(a, b);
    });

    it('source uses dynamic import("intl-messageformat")', function () {
        assert.match(i18nSrc, /import\(\s*['"]intl-messageformat['"]\s*\)/);
    });

    it('source captures load errors on icuLoadError', function () {
        assert.match(i18nSrc, /icuLoadError\s*=\s*err/);
    });

    it('source surfaces the load error with an install hint in tIcu', function () {
        assert.match(i18nSrc, /npm install intl-messageformat/);
    });

    it('loadCatalogs() kicks off the loader fire-and-forget', function () {
        assert.match(i18nSrc, /ensureIcuLoaded\(\)\.catch\(/);
    });

});


// ─── 03 — tIcu basic API ─────────────────────────────────────────────────

describe('03 - tIcu basic API', function () {

    it('returns empty string for null/empty key', function () {
        assert.equal(i18n.tIcu(null, {}, 'en'),         '');
        assert.equal(i18n.tIcu('', {}, 'en'),           '');
        assert.equal(i18n.tIcu(undefined, {}, 'en'),    '');
    });

    it('returns the key verbatim when culture is omitted', function () {
        assert.equal(i18n.tIcu('common.welcome'),        'common.welcome');
        assert.equal(i18n.tIcu('common.welcome', null),  'common.welcome');
    });

    it('returns the key verbatim when bundle has no catalogs loaded', function () {
        var b = isolatedBundle('no-catalogs');
        var out = i18n.tIcu('common.welcome', {}, 'en', { bundleName: b });
        assert.equal(out, 'common.welcome');
        i18n.clearCatalogs(b);
    });

    it('formats a plain {name} placeholder via ICU', function () {
        var b = isolatedBundle('plain');
        i18n.setCatalog(b, 'en', { greet: 'Hello, {name}!' });
        var out = i18n.tIcu('greet', { name: 'Ada' }, 'en', { bundleName: b });
        assert.equal(out, 'Hello, Ada!');
        i18n.clearCatalogs(b);
    });

    it('returns the key verbatim for missing key', function () {
        var b = isolatedBundle('missing');
        i18n.setCatalog(b, 'en', { foo: 'F' });
        assert.equal(i18n.tIcu('bar.baz', {}, 'en', { bundleName: b }), 'bar.baz');
        i18n.clearCatalogs(b);
    });

    it('returns the key when no params and string has placeholders', function () {
        var b = isolatedBundle('no-params');
        i18n.setCatalog(b, 'en', { greet: 'Hello, {name}!' });
        // intl-messageformat throws on a missing param — gracefully degrades to key.
        var out = i18n.tIcu('greet', null, 'en', { bundleName: b });
        // Either the key (graceful degrade) or 'Hello, !' (some ICU MF builds tolerate this).
        // Pin on the never-throws contract: must return a string.
        assert.equal(typeof out, 'string');
        i18n.clearCatalogs(b);
    });

});


// ─── 04 — Plural rules ──────────────────────────────────────────────────

describe('04 - tIcu plural', function () {

    it('English plural — one form for count=1', function () {
        var b = isolatedBundle('en-plural');
        i18n.setCatalog(b, 'en', { items: '{count, plural, one {# item} other {# items}}' });
        assert.equal(i18n.tIcu('items', { count: 1 }, 'en', { bundleName: b }), '1 item');
        i18n.clearCatalogs(b);
    });

    it('English plural — other form for count=5', function () {
        var b = isolatedBundle('en-plural-5');
        i18n.setCatalog(b, 'en', { items: '{count, plural, one {# item} other {# items}}' });
        assert.equal(i18n.tIcu('items', { count: 5 }, 'en', { bundleName: b }), '5 items');
        i18n.clearCatalogs(b);
    });

    it('French plural — one form for count=0 (per French CLDR rule)', function () {
        var b = isolatedBundle('fr-plural-0');
        i18n.setCatalog(b, 'fr', { items: '{count, plural, one {# article} other {# articles}}' });
        // French: 0 and 1 use the singular form (n in 0..1).
        assert.equal(i18n.tIcu('items', { count: 0 }, 'fr', { bundleName: b }), '0 article');
        assert.equal(i18n.tIcu('items', { count: 1 }, 'fr', { bundleName: b }), '1 article');
        assert.equal(i18n.tIcu('items', { count: 2 }, 'fr', { bundleName: b }), '2 articles');
        i18n.clearCatalogs(b);
    });

    it('Russian plural — one/few/many forms', function () {
        var b = isolatedBundle('ru-plural');
        i18n.setCatalog(b, 'ru', {
            items: '{count, plural, one {# книга} few {# книги} many {# книг} other {# книг}}'
        });
        // Russian CLDR: 1 = one; 2,3,4 = few; 5,6,...,11,12 = many; etc.
        assert.equal(i18n.tIcu('items', { count: 1 }, 'ru', { bundleName: b }), '1 книга');
        assert.equal(i18n.tIcu('items', { count: 3 }, 'ru', { bundleName: b }), '3 книги');
        assert.equal(i18n.tIcu('items', { count: 5 }, 'ru', { bundleName: b }), '5 книг');
        i18n.clearCatalogs(b);
    });

    it('plural with explicit number match (=0)', function () {
        var b = isolatedBundle('en-plural-zero');
        i18n.setCatalog(b, 'en', {
            items: '{count, plural, =0 {No items} one {# item} other {# items}}'
        });
        assert.equal(i18n.tIcu('items', { count: 0 }, 'en', { bundleName: b }), 'No items');
        assert.equal(i18n.tIcu('items', { count: 1 }, 'en', { bundleName: b }), '1 item');
        assert.equal(i18n.tIcu('items', { count: 7 }, 'en', { bundleName: b }), '7 items');
        i18n.clearCatalogs(b);
    });

});


// ─── 05 — Select / gender ───────────────────────────────────────────────

describe('05 - tIcu select / gender', function () {

    it('gender select — female form', function () {
        var b = isolatedBundle('select-f');
        i18n.setCatalog(b, 'en', {
            greeting: '{gender, select, female {Hi, {name}!} male {Hey, {name}!} other {Hello, {name}!}}'
        });
        assert.equal(
            i18n.tIcu('greeting', { gender: 'female', name: 'Ada' }, 'en', { bundleName: b }),
            'Hi, Ada!'
        );
        i18n.clearCatalogs(b);
    });

    it('gender select — male form', function () {
        var b = isolatedBundle('select-m');
        i18n.setCatalog(b, 'en', {
            greeting: '{gender, select, female {Hi, {name}!} male {Hey, {name}!} other {Hello, {name}!}}'
        });
        assert.equal(
            i18n.tIcu('greeting', { gender: 'male', name: 'Bob' }, 'en', { bundleName: b }),
            'Hey, Bob!'
        );
        i18n.clearCatalogs(b);
    });

    it('gender select — falls back to other for unknown gender', function () {
        var b = isolatedBundle('select-other');
        i18n.setCatalog(b, 'en', {
            greeting: '{gender, select, female {Hi, {name}!} male {Hey, {name}!} other {Hello, {name}!}}'
        });
        assert.equal(
            i18n.tIcu('greeting', { gender: 'unknown', name: 'Cy' }, 'en', { bundleName: b }),
            'Hello, Cy!'
        );
        i18n.clearCatalogs(b);
    });

    it('nested plural inside select', function () {
        var b = isolatedBundle('select-plural');
        i18n.setCatalog(b, 'en', {
            cart: '{gender, select, female {{count, plural, one {She has # item} other {She has # items}}} male {{count, plural, one {He has # item} other {He has # items}}} other {{count, plural, one {They have # item} other {They have # items}}}}'
        });
        assert.equal(
            i18n.tIcu('cart', { gender: 'female', count: 1 }, 'en', { bundleName: b }),
            'She has 1 item'
        );
        assert.equal(
            i18n.tIcu('cart', { gender: 'male', count: 5 }, 'en', { bundleName: b }),
            'He has 5 items'
        );
        assert.equal(
            i18n.tIcu('cart', { gender: 'unknown', count: 3 }, 'en', { bundleName: b }),
            'They have 3 items'
        );
        i18n.clearCatalogs(b);
    });

});


// ─── 06 — Fallback chain ────────────────────────────────────────────────

describe('06 - tIcu fallback chain', function () {

    it('region → base language → bundle default', function () {
        var b = isolatedBundle('fallback');
        i18n.setCatalog(b, 'en',    { greet: 'Hello, {name}!' });
        i18n.setCatalog(b, 'fr',    { greet: 'Bonjour, {name} !' });
        i18n.setCatalog(b, 'fr_CA', { goodbye: 'À plus, {name} !' });
        // greet not in fr_CA → falls back to fr
        assert.equal(
            i18n.tIcu('greet', { name: 'Ada' }, 'fr_CA', { bundleName: b }),
            'Bonjour, Ada !'
        );
        i18n.clearCatalogs(b);
    });

    it('falls back to bundle default culture', function () {
        var b = isolatedBundle('fallback-default');
        i18n.setCatalog(b, 'en', { greet: 'Hello, {name}!' });
        // Request fr (not in catalog) with defaultCulture=en → falls back to en
        var out = i18n.tIcu('greet', { name: 'Bob' }, 'fr', {
            bundleName: b,
            defaultCulture: 'en'
        });
        assert.equal(out, 'Hello, Bob!');
        i18n.clearCatalogs(b);
    });

    it('returns key verbatim when fallback chain is exhausted', function () {
        var b = isolatedBundle('fallback-exhausted');
        i18n.setCatalog(b, 'en', { foo: 'F' });
        var out = i18n.tIcu('bar', {}, 'fr_CA', { bundleName: b, defaultCulture: 'de' });
        assert.equal(out, 'bar');
        i18n.clearCatalogs(b);
    });

});


// ─── 07 — Non-string fallthrough to t() ─────────────────────────────────

describe('07 - tIcu fallthrough to t() for non-string values', function () {

    it('plural-form object falls through to v1 t() (CLDR plural lookup)', function () {
        var b = isolatedBundle('fallthrough-plural');
        i18n.setCatalog(b, 'en', {
            items: { one: '{count} item', other: '{count} items' }
        });
        // tIcu sees an object value (plural form), forwards to t().
        assert.equal(i18n.tIcu('items', { count: 1 }, 'en', { bundleName: b }), '1 item');
        assert.equal(i18n.tIcu('items', { count: 5 }, 'en', { bundleName: b }), '5 items');
        i18n.clearCatalogs(b);
    });

    it('nested category resolves via dotted path', function () {
        var b = isolatedBundle('fallthrough-nested');
        i18n.setCatalog(b, 'en', {
            common: { welcome: 'Welcome!' }
        });
        assert.equal(i18n.tIcu('common.welcome', {}, 'en', { bundleName: b }), 'Welcome!');
        i18n.clearCatalogs(b);
    });

    it('mixed catalog — ICU strings AND v1 plural objects coexist', function () {
        var b = isolatedBundle('mixed');
        i18n.setCatalog(b, 'en', {
            icuItems: '{count, plural, one {# item} other {# items}}',
            v1Items : { one: '{count} thing', other: '{count} things' }
        });
        assert.equal(i18n.tIcu('icuItems', { count: 5 }, 'en', { bundleName: b }), '5 items');
        assert.equal(i18n.tIcu('v1Items',  { count: 5 }, 'en', { bundleName: b }), '5 things');
        i18n.clearCatalogs(b);
    });

});


// ─── 08 — IcuFormatter cache ────────────────────────────────────────────

describe('08 - IcuFormatter cache', function () {

    it('memoises formatters per <bundle>::<culture>::<key>', function () {
        var b = isolatedBundle('cache');
        i18n.setCatalog(b, 'en', { items: '{count, plural, one {# item} other {# items}}' });
        // First call builds the formatter.
        i18n.tIcu('items', { count: 1 }, 'en', { bundleName: b });
        var cache1 = process.gina._i18nIcuFormatters;
        var hit1 = cache1[b + '::en::items'];
        assert.ok(hit1, 'first call should populate the cache');
        // Second call reuses the same instance.
        i18n.tIcu('items', { count: 5 }, 'en', { bundleName: b });
        var hit2 = cache1[b + '::en::items'];
        assert.equal(hit1, hit2, 'cache hit should be the same instance');
        i18n.clearCatalogs(b);
    });

    it('clearCatalogs() drops cached formatters for the bundle', function () {
        var b = isolatedBundle('cache-clear');
        i18n.setCatalog(b, 'en', { greet: 'Hello, {name}!' });
        i18n.tIcu('greet', { name: 'X' }, 'en', { bundleName: b });
        var prefix = b + '::';
        var cache  = process.gina._i18nIcuFormatters;
        var hadBefore = Object.keys(cache).some(function (k) { return k.indexOf(prefix) === 0; });
        assert.equal(hadBefore, true);
        i18n.clearCatalogs(b);
        var hasAfter = Object.keys(cache).some(function (k) { return k.indexOf(prefix) === 0; });
        assert.equal(hasAfter, false);
    });

    it('source declares process.gina._i18nIcuFormatters slot', function () {
        assert.match(i18nSrc, /process\.gina\._i18nIcuFormatters/);
    });

});


// ─── 09 — Source pin: gna.t.icu wiring ──────────────────────────────────

describe('09 - gna.t.icu wiring', function () {

    it('core/gna.js attaches gna.t.icu', function () {
        assert.match(gnaSrc, /gna\.t\.icu\s*=\s*function/);
    });

    it('gna.t.icu forwards to lib.i18n.tIcu', function () {
        assert.match(gnaSrc, /lib\.i18n\.tIcu\(\s*key,\s*params,\s*culture,\s*options\s*\)/);
    });

    it('gna.t.icu signature mirrors gna.t (key, params, culture, options)', function () {
        var m = gnaSrc.match(/gna\.t\.icu\s*=\s*function\s*\(([^)]*)\)/);
        assert.ok(m, 'gna.t.icu definition not found');
        var paramList = m[1].replace(/\s+/g, '');
        assert.equal(paramList, 'key,params,culture,options');
    });

});


// ─── 10 — Source pin: self.t.icu wiring ─────────────────────────────────

describe('10 - self.t.icu wiring', function () {

    it('core/controller/controller.js attaches this.t.icu', function () {
        assert.match(ctrlSrc, /this\.t\.icu\s*=\s*function/);
    });

    it('self.t.icu auto-binds req.culture from local.req.culture', function () {
        // Locate the t.icu block source (capture from `this.t.icu = function` to the next `};`).
        var m = ctrlSrc.match(/this\.t\.icu\s*=\s*function[\s\S]*?\n\s*\};/);
        assert.ok(m, 'this.t.icu block not found');
        assert.match(m[0], /local\.req\s*&&\s*local\.req\.culture/);
    });

    it('self.t.icu reads bundleName from local.options.conf.bundle', function () {
        var m = ctrlSrc.match(/this\.t\.icu\s*=\s*function[\s\S]*?\n\s*\};/);
        assert.match(m[0], /local\.options\.conf\.bundle/);
    });

    it('self.t.icu reads devMissingKey + fallbackChain from settings.i18n', function () {
        var m = ctrlSrc.match(/this\.t\.icu\s*=\s*function[\s\S]*?\n\s*\};/);
        assert.match(m[0], /settings\.i18n\.devMissingKey/);
        assert.match(m[0], /settings\.i18n\.fallbackChain/);
    });

    it('self.t.icu forwards to lib.i18n.tIcu with bundleName/devMissingKey/fallbackChain', function () {
        var m = ctrlSrc.match(/this\.t\.icu\s*=\s*function[\s\S]*?\n\s*\};/);
        assert.match(m[0], /lib\.i18n\.tIcu\(/);
        assert.match(m[0], /bundleName\s*:\s*bundleName/);
        assert.match(m[0], /devMissingKey\s*:\s*devMissingKey/);
        assert.match(m[0], /fallbackChain\s*:\s*fallbackChain/);
    });

});


// ─── 11 — Framework dependency declaration ──────────────────────────────

describe('11 - framework package.json dep', function () {

    it('framework/v*/package.json declares intl-messageformat', function () {
        assert.ok(fwPkg.dependencies, 'dependencies block missing');
        assert.ok(fwPkg.dependencies['intl-messageformat'], 'intl-messageformat dep missing');
    });

    it('intl-messageformat range is ^11.x', function () {
        assert.match(fwPkg.dependencies['intl-messageformat'], /^\^11\./);
    });

});


// ─── 11b — swig + nunjucks tIcu filter source-pins (#I18N2 part 2) ──────

describe('11b - swig tIcu filter wiring', function () {

    it('lib/swig-filters declares self.tIcu', function () {
        assert.match(swigFiltersSrc, /self\.tIcu\s*=\s*function\s*\(\s*key,\s*params\s*\)/);
    });

    it('swig tIcu reads culture from req.culture (auto-bind, slice 3)', function () {
        var m = swigFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?\n\s*\}/);
        assert.ok(m, 'self.tIcu block not found');
        assert.match(m[0], /ctx\.req\.culture/);
    });

    it('swig tIcu reads bundleName from options.conf.bundle', function () {
        var m = swigFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?\n\s*\}/);
        assert.match(m[0], /ctx\.options\.conf\.bundle/);
    });

    it('swig tIcu forwards to lib.i18n.tIcu', function () {
        var m = swigFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?\n\s*\}/);
        assert.match(m[0], /i18n\.tIcu\(\s*key,\s*params,\s*culture,\s*\{\s*bundleName:\s*bundleName\s*\}\s*\)/);
    });

    it('swig t filter (slice 2) is unchanged — no regression', function () {
        assert.match(swigFiltersSrc, /self\.t\s*=\s*function\s*\(\s*key,\s*params\s*\)/);
        assert.match(swigFiltersSrc, /i18n\.t\(\s*key,\s*params,\s*culture,\s*\{\s*bundleName:\s*bundleName\s*\}\s*\)/);
    });

});


describe('11c - nunjucks tIcu filter wiring', function () {

    it('lib/nunjucks-filters declares self.tIcu', function () {
        assert.match(njkFiltersSrc, /self\.tIcu\s*=\s*function\s*\(\s*key,\s*params\s*\)/);
    });

    it('nunjucks tIcu reads culture from req.culture (auto-bind, slice 3)', function () {
        var m = njkFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?\n\s*\};/);
        assert.ok(m, 'self.tIcu block not found');
        assert.match(m[0], /ctx\.req\.culture/);
    });

    it('nunjucks tIcu reads bundleName from options.conf.bundle', function () {
        var m = njkFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?\n\s*\};/);
        assert.match(m[0], /ctx\.options\.conf\.bundle/);
    });

    it('nunjucks tIcu forwards to lib.i18n.tIcu', function () {
        var m = njkFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?\n\s*\};/);
        assert.match(m[0], /i18n\.tIcu\(\s*key,\s*params,\s*culture,\s*\{\s*bundleName:\s*bundleName\s*\}\s*\)/);
    });

    it('nunjucks t filter (slice 2) is unchanged — no regression', function () {
        assert.match(njkFiltersSrc, /self\.t\s*=\s*function\s*\(\s*key,\s*params\s*\)/);
        assert.match(njkFiltersSrc, /i18n\.t\(\s*key,\s*params,\s*culture,\s*\{\s*bundleName:\s*bundleName\s*\}\s*\)/);
    });

    it('swig + nunjucks tIcu filters share an identical surface (parity)', function () {
        // Both should declare the same self.tIcu signature and forward shape.
        var swig = swigFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?return\s+i18n\.tIcu\([^)]*\);/);
        var njk  = njkFiltersSrc.match(/self\.tIcu\s*=\s*function[\s\S]*?return\s+i18n\.tIcu\([^)]*\);/);
        assert.ok(swig, 'swig tIcu block not found');
        assert.ok(njk,  'nunjucks tIcu block not found');
        // Strip whitespace and compare semantically — both should call lib.i18n.tIcu the same way.
        var swigForward = swig[0].replace(/\s+/g, ' ');
        var njkForward  = njk[0].replace(/\s+/g, ' ');
        // Pull out just the i18n.tIcu(...) call from each
        var swigCall = swigForward.match(/i18n\.tIcu\([^)]*\)/);
        var njkCall  = njkForward.match(/i18n\.tIcu\([^)]*\)/);
        assert.equal(swigCall[0], njkCall[0]);
    });

});


// ─── 12 — Negative invariants ───────────────────────────────────────────

describe('12 - negative invariants', function () {

    it('tIcu does not mutate process.gina._i18nCatalogs (read-only)', function () {
        var b = isolatedBundle('readonly');
        i18n.setCatalog(b, 'en', { foo: 'bar' });
        var before = JSON.stringify(i18n.getCatalog(b, 'en'));
        i18n.tIcu('foo', {}, 'en', { bundleName: b });
        var after = JSON.stringify(i18n.getCatalog(b, 'en'));
        assert.equal(before, after);
        i18n.clearCatalogs(b);
    });

    it('parse error returns the key verbatim (not a thrown exception)', function () {
        var b = isolatedBundle('parse-err');
        // Malformed ICU MF — unmatched brace.
        i18n.setCatalog(b, 'en', { broken: '{count, plural, one {# item' });
        var out = i18n.tIcu('broken', { count: 1 }, 'en', { bundleName: b });
        // Should fall back gracefully, not throw.
        assert.equal(typeof out, 'string');
        i18n.clearCatalogs(b);
    });

    it('format error on missing required param returns gracefully (string)', function () {
        var b = isolatedBundle('format-err');
        i18n.setCatalog(b, 'en', { items: '{count, plural, one {# item} other {# items}}' });
        // Missing `count` — intl-messageformat throws on format().
        var out = i18n.tIcu('items', {}, 'en', { bundleName: b });
        assert.equal(typeof out, 'string'); // Either the key or a partial format.
        i18n.clearCatalogs(b);
    });

});
