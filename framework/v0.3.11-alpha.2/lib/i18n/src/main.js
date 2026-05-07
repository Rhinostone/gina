/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module gina/lib/i18n
 *
 * Internationalisation primitives. Per-bundle JSON catalogs, fallback chain
 * (specific culture → base language → bundle default → process default →
 * 'en'), CLDR plural rules via the Node-built-in `Intl.PluralRules`, and
 * `{name}`-style parameter interpolation.
 *
 * Backs three call surfaces:
 *
 *   - Global `gna.t(key, params, culture)` — explicit culture required.
 *   - Controller helper `self.t(key, params)` — auto-binds `req.culture`.
 *   - Swig / Nunjucks `t` filter — auto-binds via the existing factory shape.
 *
 * Catalogs live at `process.gina._i18nCatalogs[bundleName][culture]`. A
 * `Intl.PluralRules` instance per culture lives at
 * `process.gina._i18nPluralRules[culture]` for amortised cost.
 *
 * Loading is eager (one disk pass per bundle at boot, see {@link loadCatalogs}).
 * No hot-reload — bundle restart picks up edits, mirroring `routing.json` /
 * `connectors.json` policy.
 *
 * @package    gina.framework
 * @namespace  lib.i18n
 * @author     Rhinostone <contact@gina.io>
 */

'use strict';

var fs   = require('fs');
var path = require('path');

/**
 * CLDR plural categories recognised by `Intl.PluralRules` and matched
 * against catalog plural-form objects.
 *
 * @memberof module:gina/lib/i18n
 * @constant
 * @type {string[]}
 */
var CLDR_PLURAL_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * Last-resort culture used when fallback chain is exhausted.
 *
 * @memberof module:gina/lib/i18n
 * @constant
 * @type {string}
 */
var DEFAULT_FALLBACK_LANG = 'en';

/**
 * Filename pattern accepted by {@link loadCatalogs}. Matches `<lang>.json`
 * and `<lang>_<region>.json` (e.g. `en.json`, `en_US.json`, `pt_BR.json`).
 * Hyphenated form (`en-US.json`) is intentionally NOT accepted — gina uses
 * underscore separators (`GINA_CULTURE`, `bin/gina-init`).
 *
 * @memberof module:gina/lib/i18n
 * @constant
 * @type {RegExp}
 */
var CULTURE_FILENAME = /^([a-z]{2,3})(_([A-Z]{2,3}))?\.json$/;

/**
 * Track bundles for which a missing-catalog warn has already fired
 * (one warn per bundle per process lifetime, regardless of how many
 * lookups miss).
 *
 * @inner
 * @type {Object<string, true>}
 */
var _missingBundleWarned = Object.create(null);

/**
 * Track keys for which a missing-key warn has already fired (one warn
 * per `bundleName::key` per process lifetime).
 *
 * @inner
 * @type {Object<string, true>}
 */
var _missingKeyWarned = Object.create(null);

/**
 * Lazily create the `process.gina._i18nCatalogs` slot when first touched.
 *
 * @inner
 * @returns {Object<string, Object<string, object>>} The catalog registry.
 */
function _store() {
    if ( !process.gina ) {
        process.gina = {};
    }
    if ( !process.gina._i18nCatalogs ) {
        process.gina._i18nCatalogs = Object.create(null);
    }
    return process.gina._i18nCatalogs;
}

/**
 * Lazily create the `process.gina._i18nPluralRules` cache.
 *
 * @inner
 * @returns {Object<string, Intl.PluralRules>}
 */
function _pluralCache() {
    if ( !process.gina ) {
        process.gina = {};
    }
    if ( !process.gina._i18nPluralRules ) {
        process.gina._i18nPluralRules = Object.create(null);
    }
    return process.gina._i18nPluralRules;
}

/**
 * Convert a culture string to the form `Intl.PluralRules` expects (BCP-47
 * with `-` rather than `_`). `en_US` → `en-US`. Pass-through for already
 * BCP-47 input.
 *
 * @memberof module:gina/lib/i18n
 * @param   {string} culture
 * @returns {string}
 */
function toBcp47(culture) {
    return String(culture || '').replace(/_/g, '-');
}

/**
 * Split a culture string into `[language, region]`. `en_US` → `['en','US']`,
 * `fr` → `['fr', null]`.
 *
 * @memberof module:gina/lib/i18n
 * @param   {string} culture
 * @returns {string[]}
 */
function splitCulture(culture) {
    var s = String(culture || '');
    var i = s.indexOf('_');
    if ( i < 0 ) {
        return [s, null];
    }
    return [s.substring(0, i), s.substring(i + 1)];
}

/**
 * Eager-load every culture catalog under `<dir>/locales/`. Called once per
 * bundle at boot. Files must match {@link CULTURE_FILENAME}; non-matching
 * files are skipped with a `console.warn`. Malformed JSON throws.
 *
 * @memberof module:gina/lib/i18n
 * @param   {string} bundleName - Bundle name; keys the registry slot.
 * @param   {string} dir        - Absolute path to the bundle's `locales/` directory.
 * @returns {string[]} Sorted list of culture codes loaded (e.g. `['en','en_US','fr']`).
 *
 * @example
 *   var loaded = loadCatalogs('dashboard', '/path/to/bundle/locales');
 *   // → ['en', 'fr']
 */
function loadCatalogs(bundleName, dir) {
    if ( !bundleName || typeof bundleName !== 'string' ) {
        throw new TypeError('loadCatalogs: bundleName must be a non-empty string');
    }
    var store = _store();
    store[bundleName] = Object.create(null);

    if ( !dir || !fs.existsSync(dir) ) {
        return [];
    }

    var stat;
    try {
        stat = fs.statSync(dir);
    } catch (err) {
        return [];
    }
    if ( !stat.isDirectory() ) {
        return [];
    }

    var entries = fs.readdirSync(dir);
    var loaded  = [];
    for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        var match = CULTURE_FILENAME.exec(name);
        if ( !match ) {
            // Skip dotfiles silently; warn on other unrecognised JSON.
            if ( name.charAt(0) !== '.' && /\.json$/.test(name) ) {
                console.warn('[i18n] skipping `' + name + '` in ' + dir + ' — filename must match <lang>(_<REGION>)?.json');
            }
            continue;
        }
        var culture  = match[3] ? (match[1] + '_' + match[3]) : match[1];
        var filePath = path.join(dir, name);
        var raw;
        try {
            raw = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            throw new Error('[i18n] failed to read ' + filePath + ': ' + err.message);
        }
        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            throw new Error('[i18n] malformed catalog at ' + filePath + ': ' + err.message);
        }
        if ( parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ) {
            throw new Error('[i18n] catalog root must be an object: ' + filePath);
        }
        store[bundleName][culture] = parsed;
        loaded.push(culture);
    }
    loaded.sort();
    return loaded;
}

/**
 * Manually inject a catalog (test fixtures, `i18n:add` CLI). Replaces any
 * existing catalog for the same `(bundleName, culture)`.
 *
 * @memberof module:gina/lib/i18n
 * @param {string} bundleName
 * @param {string} culture
 * @param {object} catalog    - Plain object; nested objects + plural forms allowed.
 *
 * @example
 *   setCatalog('test', 'en', { common: { welcome: 'Hi!' } });
 */
function setCatalog(bundleName, culture, catalog) {
    if ( !bundleName || !culture ) {
        throw new TypeError('setCatalog: bundleName and culture are required');
    }
    if ( catalog === null || typeof catalog !== 'object' || Array.isArray(catalog) ) {
        throw new TypeError('setCatalog: catalog must be a plain object');
    }
    var store = _store();
    if ( !store[bundleName] ) {
        store[bundleName] = Object.create(null);
    }
    store[bundleName][culture] = catalog;
}

/**
 * Read a single culture catalog. Returns `null` when not loaded.
 *
 * @memberof module:gina/lib/i18n
 * @param   {string} bundleName
 * @param   {string} culture
 * @returns {object|null}
 */
function getCatalog(bundleName, culture) {
    var store = _store();
    if ( !store[bundleName] || !store[bundleName][culture] ) {
        return null;
    }
    return store[bundleName][culture];
}

/**
 * Read every catalog loaded for a bundle. Returns an empty object when the
 * bundle has no catalogs.
 *
 * @memberof module:gina/lib/i18n
 * @param   {string} bundleName
 * @returns {Object<string, object>}
 */
function getCatalogs(bundleName) {
    var store = _store();
    return store[bundleName] || Object.create(null);
}

/**
 * Drop every catalog for a bundle. Used by tests and (eventually) bundle
 * hot-reload.
 *
 * @memberof module:gina/lib/i18n
 * @param {string} bundleName
 */
function clearCatalogs(bundleName) {
    var store = _store();
    delete store[bundleName];
    // Clear matching warn flags so a subsequent reload can re-warn cleanly.
    for ( var k in _missingBundleWarned ) {
        if ( k === bundleName ) {
            delete _missingBundleWarned[k];
        }
    }
    var prefix = bundleName + '::';
    for ( var kk in _missingKeyWarned ) {
        if ( kk.indexOf(prefix) === 0 ) {
            delete _missingKeyWarned[kk];
        }
    }
}

/**
 * Walk a dotted-path key into a nested catalog. `common.welcome` →
 * `catalog['common']['welcome']`. Returns `undefined` if any step misses.
 *
 * @memberof module:gina/lib/i18n
 * @param   {object} catalog
 * @param   {string} key
 * @returns {*|undefined}
 *
 * @example
 *   resolveKey({ common: { welcome: 'Hi!' } }, 'common.welcome'); // → 'Hi!'
 *   resolveKey({ common: { welcome: 'Hi!' } }, 'missing.key');    // → undefined
 */
function resolveKey(catalog, key) {
    if ( !catalog || typeof catalog !== 'object' ) {
        return undefined;
    }
    if ( typeof key !== 'string' || key.length === 0 ) {
        return undefined;
    }
    var parts = key.split('.');
    var cursor = catalog;
    for (var i = 0; i < parts.length; i++) {
        if ( cursor === null || typeof cursor !== 'object' ) {
            return undefined;
        }
        var part = parts[i];
        if ( part.length === 0 ) {
            // empty segment from `..` or leading/trailing `.` — fail closed.
            return undefined;
        }
        cursor = cursor[part];
        if ( typeof cursor === 'undefined' ) {
            return undefined;
        }
    }
    return cursor;
}

/**
 * Replace `{name}`-style placeholders in `str` with values from `params`.
 * Missing params leave the placeholder as a literal (and emit a one-time
 * dev-mode warn). `{{name}}` renders as the literal `{name}` (single
 * de-quote pass).
 *
 * @memberof module:gina/lib/i18n
 * @param   {string} str
 * @param   {Object<string, *>} [params]
 * @returns {string}
 *
 * @example
 *   interpolate('Hello, {name}!', { name: 'Ada' });      // → 'Hello, Ada!'
 *   interpolate('{a} and {b}',     { a: 1, b: 2 });       // → '1 and 2'
 *   interpolate('Unknown {x}',     {});                   // → 'Unknown {x}'
 *   interpolate('Literal {{x}}',   {});                   // → 'Literal {x}'
 */
function interpolate(str, params) {
    if ( typeof str !== 'string' ) {
        return String(str);
    }
    var p = params || {};
    // Two-pass to handle escapes: first sub a sentinel for `{{...}}`,
    // then replace `{name}`, then restore.
    var SENT_OPEN  = '';
    var SENT_CLOSE = '';
    var s = str
        .replace(/\{\{/g, SENT_OPEN)
        .replace(/\}\}/g, SENT_CLOSE);
    s = s.replace(/\{(\w+)\}/g, function(match, name) {
        if ( Object.prototype.hasOwnProperty.call(p, name) && typeof p[name] !== 'undefined' ) {
            return String(p[name]);
        }
        return match;
    });
    return s
        .replace(new RegExp(SENT_OPEN, 'g'),  '{')
        .replace(new RegExp(SENT_CLOSE, 'g'), '}');
}

/**
 * Get (or lazily build) a cached `Intl.PluralRules` instance for `culture`.
 *
 * @memberof module:gina/lib/i18n
 * @param   {string} culture
 * @returns {Intl.PluralRules}
 */
function getPluralRules(culture) {
    var cache = _pluralCache();
    var bcp47 = toBcp47(culture);
    if ( !cache[bcp47] ) {
        try {
            cache[bcp47] = new Intl.PluralRules(bcp47);
        } catch (err) {
            // Unknown culture — fall back to the default lang.
            cache[bcp47] = new Intl.PluralRules(DEFAULT_FALLBACK_LANG);
        }
    }
    return cache[bcp47];
}

/**
 * Pick a plural form from a value. Caller has already determined that
 * `count` was provided AND that `value` is an object with at least one
 * CLDR plural key. Returns the chosen form (string), or `undefined` if
 * the value lacks both the selected category AND the `'other'` fallback.
 *
 * @memberof module:gina/lib/i18n
 * @param   {object} value
 * @param   {number} count
 * @param   {string} culture
 * @returns {string|undefined}
 */
function selectPlural(value, count, culture) {
    var pr = getPluralRules(culture);
    var category = pr.select(count);
    if ( typeof value[category] === 'string' ) {
        return value[category];
    }
    if ( typeof value.other === 'string' ) {
        return value.other;
    }
    return undefined;
}

/**
 * Test whether `value` looks like a plural-form object (object whose own
 * keys are all in {@link CLDR_PLURAL_KEYS} and whose values are all
 * strings). Conservative: even one unrecognised key means it's a nested
 * category, not a plural form.
 *
 * @memberof module:gina/lib/i18n
 * @param   {*} value
 * @returns {boolean}
 */
function isPluralForm(value) {
    if ( !value || typeof value !== 'object' || Array.isArray(value) ) {
        return false;
    }
    var keys = Object.keys(value);
    if ( keys.length === 0 ) {
        return false;
    }
    for (var i = 0; i < keys.length; i++) {
        if ( CLDR_PLURAL_KEYS.indexOf(keys[i]) < 0 ) {
            return false;
        }
        if ( typeof value[keys[i]] !== 'string' ) {
            return false;
        }
    }
    return true;
}

/**
 * Build the ordered fallback chain for a requested culture. Returns an
 * array of cultures to try in order. Each entry is unique (de-duped while
 * preserving order).
 *
 * @memberof module:gina/lib/i18n
 * @param   {string}   culture          - Requested culture (e.g. `'fr_CA'`).
 * @param   {string}   [defaultCulture] - Bundle / process default (e.g. `'en_US'`).
 * @param   {string[]} [customChain]    - Optional override appended after the
 *                                        specific/base lookups (from
 *                                        `settings.i18n.fallbackChain`).
 * @returns {string[]}
 *
 * @example
 *   walkFallback('fr_CA', 'en_US');
 *   // → ['fr_CA', 'fr', 'en_US', 'en', 'en']
 *   //   (final 'en' is the hardcoded last resort; de-dupe keeps it once)
 */
function walkFallback(culture, defaultCulture, customChain) {
    var seen   = Object.create(null);
    var chain  = [];
    function push(c) {
        if ( !c || typeof c !== 'string' ) {
            return;
        }
        if ( seen[c] ) {
            return;
        }
        seen[c] = true;
        chain.push(c);
    }
    push(culture);
    var parts = splitCulture(culture);
    if ( parts[1] ) {
        push(parts[0]);
    }
    if ( Array.isArray(customChain) ) {
        for (var i = 0; i < customChain.length; i++) {
            push(customChain[i]);
        }
    }
    if ( defaultCulture && defaultCulture !== culture ) {
        push(defaultCulture);
        var dParts = splitCulture(defaultCulture);
        if ( dParts[1] ) {
            push(dParts[0]);
        }
    }
    push(DEFAULT_FALLBACK_LANG);
    return chain;
}

/**
 * Translate a key. Walks the fallback chain, resolves the key, applies
 * plural rules if `params.count` is present and the value is a plural
 * form, then runs interpolation.
 *
 * Behaviour when no translation is found:
 * - If `options.devMissingKey` is a string (and `process.env.NODE_ENV_IS_DEV === 'true'`),
 *   returns `<marker> <key>`.
 * - Otherwise returns the key verbatim.
 * - Always emits a one-time `console.warn` per `(bundleName, key)` in dev mode.
 *
 * @memberof module:gina/lib/i18n
 * @param   {string}            key
 * @param   {Object|null}       [params]
 * @param   {string}            [culture] - Required for actual lookup; if
 *                                          omitted, returns key verbatim
 *                                          (back-compat with the legacy `__()`
 *                                          no-op stub).
 * @param   {Object}            [options]
 * @param   {string}            [options.bundleName]    - Defaults to `process.env.GINA_BUNDLE`.
 * @param   {string}            [options.defaultCulture] - Bundle default culture.
 * @param   {string[]}          [options.fallbackChain]  - Optional override.
 * @param   {string}            [options.devMissingKey]  - Dev-mode prefix marker.
 * @returns {string}
 *
 * @example
 *   t('common.welcome', {},                'en_US', { bundleName: 'dashboard' });
 *   t('common.greeting', { name: 'Ada' },  'fr',    { bundleName: 'dashboard' });
 *   t('common.items',    { count: 5 },     'en',    { bundleName: 'dashboard' });
 */
function t(key, params, culture, options) {
    if ( typeof key !== 'string' || key.length === 0 ) {
        return '';
    }
    if ( !culture ) {
        // Back-compat: no culture → key verbatim, no warn (this is the
        // legacy `__()` no-op shape). Callers who need a translation
        // must supply culture explicitly.
        return key;
    }
    var opts       = options || {};
    var bundleName = opts.bundleName || process.env.GINA_BUNDLE || null;
    if ( !bundleName ) {
        return _missingResult(key, opts);
    }
    var catalogs = getCatalogs(bundleName);
    if ( !catalogs || Object.keys(catalogs).length === 0 ) {
        if ( !_missingBundleWarned[bundleName] && _isDev() ) {
            console.warn('[i18n] no catalogs loaded for bundle `' + bundleName + '` — t() returning key verbatim');
            _missingBundleWarned[bundleName] = true;
        }
        return _missingResult(key, opts);
    }
    var chain = walkFallback(culture, opts.defaultCulture, opts.fallbackChain);
    var value = undefined;
    for (var i = 0; i < chain.length; i++) {
        var cat = catalogs[chain[i]];
        if ( !cat ) continue;
        var resolved = resolveKey(cat, key);
        if ( typeof resolved !== 'undefined' ) {
            value = resolved;
            break;
        }
    }
    if ( typeof value === 'undefined' ) {
        return _missingResult(key, opts, bundleName);
    }

    var p = params || {};
    var hasCount = Object.prototype.hasOwnProperty.call(p, 'count') && typeof p.count === 'number';
    if ( hasCount && isPluralForm(value) ) {
        var form = selectPlural(value, p.count, culture);
        if ( typeof form !== 'string' ) {
            return _missingResult(key, opts, bundleName);
        }
        return interpolate(form, p);
    }
    if ( typeof value === 'string' ) {
        return interpolate(value, p);
    }
    // Resolved to a non-string (deeper nesting node) — treat as missing.
    return _missingResult(key, opts, bundleName);
}

/**
 * @inner
 * @returns {boolean}
 */
function _isDev() {
    return process.env.NODE_ENV_IS_DEV === 'true';
}

/**
 * @inner
 * @param   {string} key
 * @param   {Object} opts
 * @param   {string} [bundleName] - Pass to enable per-key warn dedup.
 * @returns {string}
 */
function _missingResult(key, opts, bundleName) {
    if ( bundleName && _isDev() ) {
        var flagKey = bundleName + '::' + key;
        if ( !_missingKeyWarned[flagKey] ) {
            console.warn('[i18n] missing key `' + key + '` in bundle `' + bundleName + '`');
            _missingKeyWarned[flagKey] = true;
        }
    }
    if ( typeof opts.devMissingKey === 'string' && _isDev() ) {
        return opts.devMissingKey + ' ' + key;
    }
    return key;
}

module.exports = {
    // Catalog management
    loadCatalogs   : loadCatalogs,
    setCatalog     : setCatalog,
    getCatalog     : getCatalog,
    getCatalogs    : getCatalogs,
    clearCatalogs  : clearCatalogs,
    // Translation
    t              : t,
    // Internals exposed for testing + slice 2/3 reuse
    resolveKey     : resolveKey,
    interpolate    : interpolate,
    selectPlural   : selectPlural,
    isPluralForm   : isPluralForm,
    walkFallback   : walkFallback,
    getPluralRules : getPluralRules,
    splitCulture   : splitCulture,
    toBcp47        : toBcp47,
    // Constants
    CLDR_PLURAL_KEYS     : CLDR_PLURAL_KEYS,
    DEFAULT_FALLBACK_LANG: DEFAULT_FALLBACK_LANG,
    CULTURE_FILENAME     : CULTURE_FILENAME
};
