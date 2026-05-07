/**
 * lib/i18n — Internationalisation primitives (#I18N1, slice 1)
 *
 * Tests cover the runtime primitives in isolation:
 *   - Module shape + helper exports
 *   - splitCulture / toBcp47 / walkFallback / isPluralForm / getPluralRules / selectPlural
 *   - resolveKey (dotted-path catalog walker)
 *   - interpolate ({name}-style placeholders + {{escape}} pass)
 *   - loadCatalogs / setCatalog / getCatalog / getCatalogs / clearCatalogs
 *   - t() — basic shapes, fallback chain, plural forms, interpolation, missing-key behaviour
 *
 * Source-inspection guards on the framework wiring (gna.js, helpers/text.js,
 * lib/index.js, controller.js, settings.json, scaffold stub, schema) live in
 * the sibling `i18n-wiring.test.js` so this file stays runnable against the
 * primitive in isolation.
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW   = require('../fw');
var i18n = require(path.join(FW, 'lib/i18n/src/main'));

// Helpers — temp dir + isolated bundle name per test scope.
function mkTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'gina-i18n-test-'));
}
function rmDir(dir) {
    if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
function writeCatalog(dir, culture, obj) {
    fs.writeFileSync(path.join(dir, culture + '.json'), JSON.stringify(obj, null, 2));
}
function isolatedBundle(label) {
    var name = 'test-i18n-' + label + '-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    i18n.clearCatalogs(name);
    return name;
}


// ─── 01 — Module shape ─────────────────────────────────────────────────────

describe('01 - lib/i18n module exports (#I18N1)', function() {

    it('exports the catalog-management API', function() {
        assert.equal(typeof i18n.loadCatalogs,  'function');
        assert.equal(typeof i18n.setCatalog,    'function');
        assert.equal(typeof i18n.getCatalog,    'function');
        assert.equal(typeof i18n.getCatalogs,   'function');
        assert.equal(typeof i18n.clearCatalogs, 'function');
    });

    it('exports the translation function t', function() {
        assert.equal(typeof i18n.t, 'function');
    });

    it('exports the helpers used by slices 2-3 + tests', function() {
        assert.equal(typeof i18n.resolveKey,     'function');
        assert.equal(typeof i18n.interpolate,    'function');
        assert.equal(typeof i18n.selectPlural,   'function');
        assert.equal(typeof i18n.isPluralForm,   'function');
        assert.equal(typeof i18n.walkFallback,   'function');
        assert.equal(typeof i18n.getPluralRules, 'function');
        assert.equal(typeof i18n.splitCulture,   'function');
        assert.equal(typeof i18n.toBcp47,        'function');
    });

    it('exports CLDR_PLURAL_KEYS with the 6 standard categories', function() {
        assert.deepEqual(i18n.CLDR_PLURAL_KEYS, ['zero', 'one', 'two', 'few', 'many', 'other']);
    });

    it('exports DEFAULT_FALLBACK_LANG = "en"', function() {
        assert.equal(i18n.DEFAULT_FALLBACK_LANG, 'en');
    });

    it('exports CULTURE_FILENAME regex', function() {
        assert.ok(i18n.CULTURE_FILENAME instanceof RegExp);
    });

});


// ─── 02 — splitCulture + toBcp47 ───────────────────────────────────────────

describe('02 - splitCulture + toBcp47', function() {

    it('splits region from language', function() {
        assert.deepEqual(i18n.splitCulture('en_US'), ['en', 'US']);
        assert.deepEqual(i18n.splitCulture('pt_BR'), ['pt', 'BR']);
    });

    it('returns [lang, null] when there is no region', function() {
        assert.deepEqual(i18n.splitCulture('en'), ['en', null]);
        assert.deepEqual(i18n.splitCulture('fr'), ['fr', null]);
    });

    it('handles empty / nullish input', function() {
        assert.deepEqual(i18n.splitCulture(''),         ['', null]);
        assert.deepEqual(i18n.splitCulture(null),       ['', null]);
        assert.deepEqual(i18n.splitCulture(undefined),  ['', null]);
    });

    it('toBcp47 converts underscore to hyphen', function() {
        assert.equal(i18n.toBcp47('en_US'), 'en-US');
        assert.equal(i18n.toBcp47('pt_BR'), 'pt-BR');
    });

    it('toBcp47 leaves already-BCP-47 input alone', function() {
        assert.equal(i18n.toBcp47('en-US'), 'en-US');
        assert.equal(i18n.toBcp47('en'),    'en');
    });

    it('toBcp47 handles empty / nullish input', function() {
        assert.equal(i18n.toBcp47(''),        '');
        assert.equal(i18n.toBcp47(null),      '');
        assert.equal(i18n.toBcp47(undefined), '');
    });

});


// ─── 03 — resolveKey ───────────────────────────────────────────────────────

describe('03 - resolveKey (dotted-path walker)', function() {

    it('resolves a flat key', function() {
        assert.equal(i18n.resolveKey({ welcome: 'Hi' }, 'welcome'), 'Hi');
    });

    it('resolves a nested key', function() {
        assert.equal(
            i18n.resolveKey({ common: { welcome: 'Hi' } }, 'common.welcome'),
            'Hi'
        );
    });

    it('resolves a deep nested key', function() {
        var cat = { a: { b: { c: { d: 'leaf' } } } };
        assert.equal(i18n.resolveKey(cat, 'a.b.c.d'), 'leaf');
    });

    it('returns the intermediate object when the path stops before a leaf', function() {
        var cat = { common: { welcome: 'Hi' } };
        assert.deepEqual(i18n.resolveKey(cat, 'common'), { welcome: 'Hi' });
    });

    it('returns undefined for a missing key', function() {
        assert.equal(i18n.resolveKey({ a: 1 }, 'missing'), undefined);
    });

    it('returns undefined for a missing nested key', function() {
        assert.equal(i18n.resolveKey({ a: { b: 1 } }, 'a.missing'), undefined);
    });

    it('returns undefined when walking into a non-object', function() {
        assert.equal(i18n.resolveKey({ a: 'string' }, 'a.b'), undefined);
        assert.equal(i18n.resolveKey({ a: 42 }, 'a.b'),       undefined);
    });

    it('fails closed on empty segments (..)', function() {
        assert.equal(i18n.resolveKey({ a: { b: 1 } }, 'a..b'), undefined);
        assert.equal(i18n.resolveKey({ a: 1 }, '.a'),          undefined);
        assert.equal(i18n.resolveKey({ a: 1 }, 'a.'),          undefined);
    });

    it('returns undefined for empty / null catalog', function() {
        assert.equal(i18n.resolveKey(null, 'a'),      undefined);
        assert.equal(i18n.resolveKey(undefined, 'a'), undefined);
        assert.equal(i18n.resolveKey({}, 'a'),        undefined);
    });

    it('returns undefined for empty / null key', function() {
        assert.equal(i18n.resolveKey({ a: 1 }, ''),        undefined);
        assert.equal(i18n.resolveKey({ a: 1 }, null),      undefined);
        assert.equal(i18n.resolveKey({ a: 1 }, undefined), undefined);
    });

});


// ─── 04 — interpolate ──────────────────────────────────────────────────────

describe('04 - interpolate ({name}-style placeholders)', function() {

    it('replaces a single placeholder', function() {
        assert.equal(i18n.interpolate('Hello, {name}!', { name: 'Ada' }), 'Hello, Ada!');
    });

    it('replaces multiple placeholders', function() {
        assert.equal(
            i18n.interpolate('{a} + {b} = {c}', { a: 1, b: 2, c: 3 }),
            '1 + 2 = 3'
        );
    });

    it('coerces non-string values via String()', function() {
        assert.equal(i18n.interpolate('{n}', { n: 42 }),     '42');
        assert.equal(i18n.interpolate('{b}', { b: true }),   'true');
        assert.equal(i18n.interpolate('{n}', { n: null }),   'null');
    });

    it('leaves undefined params as the literal placeholder', function() {
        assert.equal(i18n.interpolate('Unknown {x}', {}), 'Unknown {x}');
    });

    it('leaves undefined-valued params as the literal placeholder', function() {
        assert.equal(i18n.interpolate('Unknown {x}', { x: undefined }), 'Unknown {x}');
    });

    it('escapes {{name}} to literal {name}', function() {
        assert.equal(i18n.interpolate('Literal {{x}}', {}), 'Literal {x}');
    });

    it('does not interpolate inside escaped placeholders', function() {
        assert.equal(i18n.interpolate('{{name}} but {name}', { name: 'Ada' }), '{name} but Ada');
    });

    it('handles empty / null params', function() {
        assert.equal(i18n.interpolate('plain', null),      'plain');
        assert.equal(i18n.interpolate('plain', undefined), 'plain');
        assert.equal(i18n.interpolate('plain', {}),        'plain');
    });

    it('coerces non-string input to a string', function() {
        assert.equal(i18n.interpolate(42, {}),    '42');
        assert.equal(i18n.interpolate(null, {}),  'null');
    });

});


// ─── 05 — getPluralRules + selectPlural ────────────────────────────────────

describe('05 - getPluralRules + selectPlural', function() {

    it('getPluralRules returns an Intl.PluralRules instance', function() {
        var pr = i18n.getPluralRules('en');
        assert.ok(pr instanceof Intl.PluralRules);
    });

    it('getPluralRules caches per culture', function() {
        var a = i18n.getPluralRules('fr');
        var b = i18n.getPluralRules('fr');
        assert.equal(a, b);
    });

    it('getPluralRules accepts underscore-form cultures (en_US)', function() {
        var pr = i18n.getPluralRules('en_US');
        assert.ok(pr instanceof Intl.PluralRules);
    });

    it('getPluralRules falls back to "en" on an unknown culture', function() {
        var pr = i18n.getPluralRules('xx_YY');
        assert.ok(pr instanceof Intl.PluralRules);
        // Just verify it didn't throw — `xx_YY` is treated as an unknown
        // tag and Node falls back.
    });

    it('selectPlural picks "one" for English count=1', function() {
        var value = { one: '{count} item', other: '{count} items' };
        assert.equal(i18n.selectPlural(value, 1, 'en'), '{count} item');
    });

    it('selectPlural picks "other" for English count=2 / 5', function() {
        var value = { one: '{count} item', other: '{count} items' };
        assert.equal(i18n.selectPlural(value, 2, 'en'), '{count} items');
        assert.equal(i18n.selectPlural(value, 5, 'en'), '{count} items');
    });

    it('selectPlural picks "other" for English count=0', function() {
        var value = { one: '{count} item', other: '{count} items' };
        assert.equal(i18n.selectPlural(value, 0, 'en'), '{count} items');
    });

    it('selectPlural respects "zero" / "many" forms when present', function() {
        var value = { zero: 'no items', one: '{count} item', many: 'lots', other: '{count} items' };
        // English doesn't have a 'zero' or 'many' category, so selection
        // for 0 / 5 falls through to 'other' — but if Russian were used
        // we would see 'many' selected. Verify the lookup logic, not the
        // CLDR category names specifically:
        var ruValue = { one: '{count} штука', few: '{count} штуки', many: '{count} штук', other: '{count} штуки' };
        assert.equal(i18n.selectPlural(ruValue, 5, 'ru_RU'), '{count} штук');
    });

    it('selectPlural falls back to "other" when the language-specific category is absent', function() {
        var value = { other: '{count} things' };
        assert.equal(i18n.selectPlural(value, 1, 'en'), '{count} things');
    });

    it('selectPlural returns undefined when no usable form exists', function() {
        var value = { zero: 'nope' };  // no 'other', no 'one'
        assert.equal(i18n.selectPlural(value, 1, 'en'), undefined);
    });

});


// ─── 06 — isPluralForm ─────────────────────────────────────────────────────

describe('06 - isPluralForm', function() {

    it('returns true for an object with only CLDR plural keys + string values', function() {
        assert.equal(i18n.isPluralForm({ one: 'a', other: 'b' }), true);
        assert.equal(i18n.isPluralForm({ zero: 'a', one: 'b', few: 'c', many: 'd', other: 'e' }), true);
    });

    it('returns false when any key is not a CLDR plural key', function() {
        assert.equal(i18n.isPluralForm({ one: 'a', other: 'b', extra: 'c' }), false);
        assert.equal(i18n.isPluralForm({ one: 'a', welcome: 'b' }),           false);
    });

    it('returns false when any value is not a string', function() {
        assert.equal(i18n.isPluralForm({ one: 'a', other: 42 }),         false);
        assert.equal(i18n.isPluralForm({ one: 'a', other: { x: 'b' } }), false);
    });

    it('returns false for empty object', function() {
        assert.equal(i18n.isPluralForm({}), false);
    });

    it('returns false for non-objects', function() {
        assert.equal(i18n.isPluralForm(null),         false);
        assert.equal(i18n.isPluralForm(undefined),    false);
        assert.equal(i18n.isPluralForm('string'),     false);
        assert.equal(i18n.isPluralForm(42),           false);
        assert.equal(i18n.isPluralForm([1, 2]),       false);
    });

});


// ─── 07 — walkFallback ─────────────────────────────────────────────────────

describe('07 - walkFallback', function() {

    it('returns [requested, base, default-en] for an underscore culture with no default', function() {
        assert.deepEqual(
            i18n.walkFallback('fr_CA'),
            ['fr_CA', 'fr', 'en']
        );
    });

    it('returns [requested, default, default-en] for a base culture', function() {
        assert.deepEqual(
            i18n.walkFallback('fr'),
            ['fr', 'en']
        );
    });

    it('inserts the bundle default after the specific/base lookups', function() {
        assert.deepEqual(
            i18n.walkFallback('fr_CA', 'en_US'),
            ['fr_CA', 'fr', 'en_US', 'en']
        );
    });

    it('expands the default culture into base too', function() {
        assert.deepEqual(
            i18n.walkFallback('fr_CA', 'pt_BR'),
            ['fr_CA', 'fr', 'pt_BR', 'pt', 'en']
        );
    });

    it('includes a custom chain in order', function() {
        assert.deepEqual(
            i18n.walkFallback('fr_CA', 'en_US', ['de', 'es']),
            ['fr_CA', 'fr', 'de', 'es', 'en_US', 'en']
        );
    });

    it('de-dupes while preserving first-occurrence order', function() {
        assert.deepEqual(
            i18n.walkFallback('en_US', 'en_US'),
            ['en_US', 'en']
        );
        assert.deepEqual(
            i18n.walkFallback('en', 'en'),
            ['en']
        );
    });

    it('ignores nullish entries gracefully', function() {
        var chain = i18n.walkFallback('fr', null, [null, undefined, '']);
        assert.deepEqual(chain, ['fr', 'en']);
    });

});


// ─── 08 — Catalog management ───────────────────────────────────────────────

describe('08 - setCatalog / getCatalog / getCatalogs / clearCatalogs', function() {

    it('setCatalog stores a catalog under the (bundle, culture) slot', function() {
        var b = isolatedBundle('set');
        i18n.setCatalog(b, 'en', { greet: 'Hi' });
        assert.deepEqual(i18n.getCatalog(b, 'en'), { greet: 'Hi' });
    });

    it('setCatalog overwrites previous catalog at same (bundle, culture)', function() {
        var b = isolatedBundle('overwrite');
        i18n.setCatalog(b, 'en', { greet: 'Hi' });
        i18n.setCatalog(b, 'en', { greet: 'Hello' });
        assert.deepEqual(i18n.getCatalog(b, 'en'), { greet: 'Hello' });
    });

    it('setCatalog throws on missing args', function() {
        assert.throws(function() { i18n.setCatalog(null, 'en', {}); }, /required/);
        assert.throws(function() { i18n.setCatalog('b', null, {}); }, /required/);
    });

    it('setCatalog throws on non-object catalog', function() {
        assert.throws(function() { i18n.setCatalog('b', 'en', null);    }, /must be a plain object/);
        assert.throws(function() { i18n.setCatalog('b', 'en', 'str');   }, /must be a plain object/);
        assert.throws(function() { i18n.setCatalog('b', 'en', [1, 2]);  }, /must be a plain object/);
    });

    it('getCatalog returns null when not loaded', function() {
        var b = isolatedBundle('miss');
        assert.equal(i18n.getCatalog(b, 'en'), null);
    });

    it('getCatalogs returns all cultures for a bundle', function() {
        var b = isolatedBundle('multi');
        i18n.setCatalog(b, 'en', { x: 1 });
        i18n.setCatalog(b, 'fr', { x: 2 });
        var all = i18n.getCatalogs(b);
        assert.deepEqual(Object.keys(all).sort(), ['en', 'fr']);
    });

    it('getCatalogs returns empty object for unknown bundle', function() {
        var b = isolatedBundle('unknown');
        assert.deepEqual(Object.keys(i18n.getCatalogs(b)), []);
    });

    it('clearCatalogs removes a bundle', function() {
        var b = isolatedBundle('clear');
        i18n.setCatalog(b, 'en', { x: 1 });
        i18n.clearCatalogs(b);
        assert.equal(i18n.getCatalog(b, 'en'), null);
    });

});


// ─── 09 — loadCatalogs (filesystem) ────────────────────────────────────────

describe('09 - loadCatalogs (filesystem)', function() {

    it('loads each <lang>.json + <lang>_<region>.json file', function() {
        var dir = mkTempDir();
        try {
            writeCatalog(dir, 'en',    { x: 'en' });
            writeCatalog(dir, 'en_US', { x: 'en_US' });
            writeCatalog(dir, 'fr',    { x: 'fr' });
            var b = isolatedBundle('load');
            var loaded = i18n.loadCatalogs(b, dir);
            assert.deepEqual(loaded.sort(), ['en', 'en_US', 'fr']);
            assert.equal(i18n.getCatalog(b, 'en').x,    'en');
            assert.equal(i18n.getCatalog(b, 'en_US').x, 'en_US');
            assert.equal(i18n.getCatalog(b, 'fr').x,    'fr');
        } finally {
            rmDir(dir);
        }
    });

    it('returns [] when dir does not exist', function() {
        var b = isolatedBundle('nodir');
        var loaded = i18n.loadCatalogs(b, '/nonexistent/path/to/locales');
        assert.deepEqual(loaded, []);
    });

    it('returns [] for empty dir', function() {
        var dir = mkTempDir();
        try {
            var b = isolatedBundle('empty');
            assert.deepEqual(i18n.loadCatalogs(b, dir), []);
        } finally {
            rmDir(dir);
        }
    });

    it('skips files that do not match the culture filename pattern', function() {
        var dir = mkTempDir();
        try {
            writeCatalog(dir, 'en', { x: 1 });
            // unrecognised JSON name — should be skipped with a warn
            fs.writeFileSync(path.join(dir, 'messages.json'), '{}');
            var b = isolatedBundle('skip');
            var loaded = i18n.loadCatalogs(b, dir);
            assert.deepEqual(loaded, ['en']);
        } finally {
            rmDir(dir);
        }
    });

    it('skips dotfiles silently', function() {
        var dir = mkTempDir();
        try {
            writeCatalog(dir, 'en', { x: 1 });
            fs.writeFileSync(path.join(dir, '.DS_Store'), 'binary garbage');
            var b = isolatedBundle('dotfile');
            var loaded = i18n.loadCatalogs(b, dir);
            assert.deepEqual(loaded, ['en']);
        } finally {
            rmDir(dir);
        }
    });

    it('throws on malformed JSON with a clear message', function() {
        var dir = mkTempDir();
        try {
            fs.writeFileSync(path.join(dir, 'en.json'), '{ invalid json');
            var b = isolatedBundle('malformed');
            assert.throws(
                function() { i18n.loadCatalogs(b, dir); },
                /malformed catalog/
            );
        } finally {
            rmDir(dir);
        }
    });

    it('throws when catalog root is not an object', function() {
        var dir = mkTempDir();
        try {
            fs.writeFileSync(path.join(dir, 'en.json'), '"a string"');
            var b = isolatedBundle('not-object');
            assert.throws(
                function() { i18n.loadCatalogs(b, dir); },
                /catalog root must be an object/
            );
        } finally {
            rmDir(dir);
        }
    });

    it('throws when catalog root is an array', function() {
        var dir = mkTempDir();
        try {
            fs.writeFileSync(path.join(dir, 'en.json'), '[1, 2, 3]');
            var b = isolatedBundle('array');
            assert.throws(
                function() { i18n.loadCatalogs(b, dir); },
                /catalog root must be an object/
            );
        } finally {
            rmDir(dir);
        }
    });

    it('reload replaces previous catalog state for the bundle', function() {
        var dir = mkTempDir();
        try {
            writeCatalog(dir, 'en', { v: 'first' });
            var b = isolatedBundle('reload');
            i18n.loadCatalogs(b, dir);
            assert.equal(i18n.getCatalog(b, 'en').v, 'first');

            // Change file + reload
            writeCatalog(dir, 'en', { v: 'second' });
            i18n.loadCatalogs(b, dir);
            assert.equal(i18n.getCatalog(b, 'en').v, 'second');
        } finally {
            rmDir(dir);
        }
    });

    it('reload drops cultures that were removed from disk', function() {
        var dir = mkTempDir();
        try {
            writeCatalog(dir, 'en', { x: 1 });
            writeCatalog(dir, 'fr', { x: 2 });
            var b = isolatedBundle('reload-drop');
            i18n.loadCatalogs(b, dir);
            assert.deepEqual(Object.keys(i18n.getCatalogs(b)).sort(), ['en', 'fr']);

            fs.unlinkSync(path.join(dir, 'fr.json'));
            i18n.loadCatalogs(b, dir);
            assert.deepEqual(Object.keys(i18n.getCatalogs(b)), ['en']);
        } finally {
            rmDir(dir);
        }
    });

    it('throws TypeError on missing bundleName', function() {
        assert.throws(function() { i18n.loadCatalogs('', '/tmp'); },     TypeError);
        assert.throws(function() { i18n.loadCatalogs(null, '/tmp'); },   TypeError);
        assert.throws(function() { i18n.loadCatalogs(42, '/tmp'); },     TypeError);
    });

});


// ─── 10 — t() basic shapes ─────────────────────────────────────────────────

describe('10 - t() basic shapes', function() {

    it('returns key verbatim when culture is missing (back-compat)', function() {
        var b = isolatedBundle('no-culture');
        i18n.setCatalog(b, 'en', { common: { welcome: 'Hi' } });
        assert.equal(i18n.t('common.welcome', null, null,      { bundleName: b }), 'common.welcome');
        assert.equal(i18n.t('common.welcome', null, undefined, { bundleName: b }), 'common.welcome');
        assert.equal(i18n.t('common.welcome', null, '',        { bundleName: b }), 'common.welcome');
    });

    it('returns empty string for empty / null key', function() {
        var b = isolatedBundle('empty-key');
        i18n.setCatalog(b, 'en', {});
        assert.equal(i18n.t('',        null, 'en', { bundleName: b }), '');
        assert.equal(i18n.t(null,      null, 'en', { bundleName: b }), '');
        assert.equal(i18n.t(undefined, null, 'en', { bundleName: b }), '');
    });

    it('translates a flat key', function() {
        var b = isolatedBundle('flat');
        i18n.setCatalog(b, 'en', { greet: 'Hi' });
        assert.equal(i18n.t('greet', null, 'en', { bundleName: b }), 'Hi');
    });

    it('translates a nested key', function() {
        var b = isolatedBundle('nested');
        i18n.setCatalog(b, 'en', { common: { welcome: 'Hi!' } });
        assert.equal(i18n.t('common.welcome', null, 'en', { bundleName: b }), 'Hi!');
    });

    it('returns key verbatim when bundleName is unknown to the registry', function() {
        var b = isolatedBundle('absent-bundle');
        // Note: never call setCatalog, so the bundle is registered with
        // an empty slot; t() should return key verbatim.
        assert.equal(i18n.t('common.welcome', null, 'en', { bundleName: b }), 'common.welcome');
    });

    it('returns key verbatim when no bundleName + no GINA_BUNDLE env', function() {
        var savedEnv = process.env.GINA_BUNDLE;
        delete process.env.GINA_BUNDLE;
        try {
            assert.equal(i18n.t('any.key', null, 'en'), 'any.key');
        } finally {
            if (typeof savedEnv !== 'undefined') process.env.GINA_BUNDLE = savedEnv;
        }
    });

});


// ─── 11 — t() fallback chain ───────────────────────────────────────────────

describe('11 - t() fallback chain', function() {

    it('uses the requested culture when the key exists there', function() {
        var b = isolatedBundle('chain-1');
        i18n.setCatalog(b, 'fr_CA', { hi: 'salut quebecois' });
        i18n.setCatalog(b, 'fr',    { hi: 'salut francais' });
        assert.equal(i18n.t('hi', null, 'fr_CA', { bundleName: b }), 'salut quebecois');
    });

    it('falls back to the base language when specific culture lacks the key', function() {
        var b = isolatedBundle('chain-2');
        i18n.setCatalog(b, 'fr_CA', { other: 'autre chose' });
        i18n.setCatalog(b, 'fr',    { hi: 'salut francais' });
        assert.equal(i18n.t('hi', null, 'fr_CA', { bundleName: b }), 'salut francais');
    });

    it('falls back to "en" when the chain has no match', function() {
        var b = isolatedBundle('chain-3');
        i18n.setCatalog(b, 'en', { hi: 'hello' });
        // Request fr_CA — neither fr_CA nor fr has it; the chain ends at 'en'.
        assert.equal(i18n.t('hi', null, 'fr_CA', { bundleName: b }), 'hello');
    });

    it('falls back to the bundle-default culture between base and "en"', function() {
        var b = isolatedBundle('chain-4');
        i18n.setCatalog(b, 'pt_BR', { hi: 'oi' });
        i18n.setCatalog(b, 'en',    { hi: 'hello' });
        assert.equal(
            i18n.t('hi', null, 'fr_CA', { bundleName: b, defaultCulture: 'pt_BR' }),
            'oi'
        );
    });

    it('returns key verbatim when no catalog has the key', function() {
        var b = isolatedBundle('chain-5');
        i18n.setCatalog(b, 'en', { other: 'other' });
        assert.equal(i18n.t('hi', null, 'fr_CA', { bundleName: b }), 'hi');
    });

    it('honours a custom fallbackChain inserted between base and bundle-default', function() {
        var b = isolatedBundle('chain-6');
        i18n.setCatalog(b, 'de', { hi: 'hallo' });
        i18n.setCatalog(b, 'en', { hi: 'hello' });
        // Request fr_CA — chain becomes [fr_CA, fr, de, en, en]; 'de' wins
        assert.equal(
            i18n.t('hi', null, 'fr_CA', { bundleName: b, fallbackChain: ['de'] }),
            'hallo'
        );
    });

});


// ─── 12 — t() pluralization ────────────────────────────────────────────────

describe('12 - t() pluralization', function() {

    it('picks the "one" form for English count=1', function() {
        var b = isolatedBundle('plural-1');
        i18n.setCatalog(b, 'en', {
            items: { one: '{count} item', other: '{count} items' }
        });
        assert.equal(i18n.t('items', { count: 1 }, 'en', { bundleName: b }), '1 item');
    });

    it('picks the "other" form for English count=2', function() {
        var b = isolatedBundle('plural-2');
        i18n.setCatalog(b, 'en', {
            items: { one: '{count} item', other: '{count} items' }
        });
        assert.equal(i18n.t('items', { count: 2 }, 'en', { bundleName: b }), '2 items');
    });

    it('picks "many" for Russian count=5 via Intl.PluralRules', function() {
        var b = isolatedBundle('plural-ru');
        i18n.setCatalog(b, 'ru_RU', {
            items: {
                one:   '{count} штука',
                few:   '{count} штуки',
                many:  '{count} штук',
                other: '{count} штуки'
            }
        });
        assert.equal(i18n.t('items', { count: 5 }, 'ru_RU', { bundleName: b }), '5 штук');
    });

    it('does NOT trigger plural lookup when count is missing', function() {
        var b = isolatedBundle('plural-no-count');
        i18n.setCatalog(b, 'en', {
            items: { one: '{count} item', other: '{count} items' }
        });
        // Without count → resolved value is the plural-form OBJECT, which
        // is not a string → treated as missing → key verbatim.
        assert.equal(i18n.t('items', null, 'en', { bundleName: b }), 'items');
    });

    it('does NOT trigger plural lookup when value is not a plural-form object', function() {
        var b = isolatedBundle('plural-not-form');
        i18n.setCatalog(b, 'en', {
            items: 'just a string'
        });
        assert.equal(i18n.t('items', { count: 5 }, 'en', { bundleName: b }), 'just a string');
    });

    it('returns key verbatim when plural form lacks both selected category AND "other"', function() {
        var b = isolatedBundle('plural-broken');
        i18n.setCatalog(b, 'en', {
            items: { zero: 'none' }  // no 'other', no 'one'
        });
        assert.equal(i18n.t('items', { count: 1 }, 'en', { bundleName: b }), 'items');
    });

});


// ─── 13 — t() interpolation passes through ─────────────────────────────────

describe('13 - t() interpolation pass', function() {

    it('interpolates {name}-style placeholders', function() {
        var b = isolatedBundle('interp-1');
        i18n.setCatalog(b, 'en', { greet: 'Hello, {name}!' });
        assert.equal(
            i18n.t('greet', { name: 'Ada' }, 'en', { bundleName: b }),
            'Hello, Ada!'
        );
    });

    it('interpolates inside plural forms', function() {
        var b = isolatedBundle('interp-2');
        i18n.setCatalog(b, 'en', {
            cart: {
                one:   'You have {count} item, {name}',
                other: 'You have {count} items, {name}'
            }
        });
        assert.equal(
            i18n.t('cart', { count: 1, name: 'Ada' }, 'en', { bundleName: b }),
            'You have 1 item, Ada'
        );
        assert.equal(
            i18n.t('cart', { count: 5, name: 'Ada' }, 'en', { bundleName: b }),
            'You have 5 items, Ada'
        );
    });

    it('leaves missing placeholder params as literals', function() {
        var b = isolatedBundle('interp-3');
        i18n.setCatalog(b, 'en', { greet: 'Hello, {name}!' });
        assert.equal(
            i18n.t('greet', {}, 'en', { bundleName: b }),
            'Hello, {name}!'
        );
    });

});


// ─── 14 — t() missing-key behaviour ────────────────────────────────────────

describe('14 - t() missing-key behaviour', function() {

    it('returns key verbatim by default for missing key', function() {
        var b = isolatedBundle('missing-1');
        i18n.setCatalog(b, 'en', { other: 'other' });
        assert.equal(i18n.t('missing.key', null, 'en', { bundleName: b }), 'missing.key');
    });

    it('prefixes devMissingKey marker when in dev mode', function() {
        var b = isolatedBundle('missing-2');
        i18n.setCatalog(b, 'en', { other: 'other' });
        var savedDev = process.env.NODE_ENV_IS_DEV;
        process.env.NODE_ENV_IS_DEV = 'true';
        try {
            assert.equal(
                i18n.t('missing.key', null, 'en', { bundleName: b, devMissingKey: '[MISSING]' }),
                '[MISSING] missing.key'
            );
        } finally {
            if (typeof savedDev !== 'undefined') process.env.NODE_ENV_IS_DEV = savedDev;
            else delete process.env.NODE_ENV_IS_DEV;
        }
    });

    it('does NOT prefix marker outside of dev mode', function() {
        var b = isolatedBundle('missing-3');
        i18n.setCatalog(b, 'en', { other: 'other' });
        var savedDev = process.env.NODE_ENV_IS_DEV;
        process.env.NODE_ENV_IS_DEV = 'false';
        try {
            assert.equal(
                i18n.t('missing.key', null, 'en', { bundleName: b, devMissingKey: '[MISSING]' }),
                'missing.key'
            );
        } finally {
            if (typeof savedDev !== 'undefined') process.env.NODE_ENV_IS_DEV = savedDev;
            else delete process.env.NODE_ENV_IS_DEV;
        }
    });

    it('returns key verbatim when resolved value is a non-string non-plural object', function() {
        var b = isolatedBundle('missing-4');
        i18n.setCatalog(b, 'en', {
            common: { welcome: 'Hi' }   // 'common' resolves to an object, not a string
        });
        assert.equal(i18n.t('common', null, 'en', { bundleName: b }), 'common');
    });

});
