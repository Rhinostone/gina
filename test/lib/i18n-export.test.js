/**
 * lib/cmd/i18n/export.js — argv parsing, format auto-detection, catalog
 * flattening, PO / CSV / JSON formatters, and the bundle-only / project-only
 * dispatch.
 *
 * Source-inspection tests + pure-logic replicas of the format-detect and
 * formatter functions + a sandbox export smoke. Mirrors the
 * connector-add.test.js / i18n-add.test.js style: export.js itself runs
 * inside the CLI daemon context (CmdHelper, lib.i18n, requireJSON globals)
 * and is not invoked here.
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var EXPORT_SOURCE = path.join(require('../fw'), 'lib/cmd/i18n/export.js');
var HELP_SOURCE   = path.join(require('../fw'), 'lib/cmd/i18n/help.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/i18n/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/i18n/arguments.json');

var src     = fs.readFileSync(EXPORT_SOURCE, 'utf8');
var helpSrc = fs.readFileSync(HELP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Export constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Export;?/);
    });

    it('declares a function Export(opt, cmd)', function () {
        assert.match(src, /function\s+Export\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('requires CmdHelper from ./../helper', function () {
        assert.match(src, /var\s+CmdHelper\s*=\s*require\(\s*['"]\.\/?\.\.\/helper['"]/);
    });

    it('binds console = lib.logger', function () {
        assert.match(src, /var\s+console\s*=\s*lib\.logger/);
    });

    it('reads i18n primitives from lib.i18n', function () {
        assert.match(src, /var\s+i18n\s*=\s*lib\.i18n;/);
    });

    it('initialises self with format / output null defaults', function () {
        assert.match(src, /var\s+self\s*=\s*\{\s*format:\s*null,\s*output:\s*null\s*\}/);
    });

    it('declares ALLOWED_FORMATS = json/po/csv', function () {
        assert.match(src, /var\s+ALLOWED_FORMATS\s*=\s*\[\s*['"]json['"]\s*,\s*['"]po['"]\s*,\s*['"]csv['"]\s*\]/);
    });

    it('declares CULTURE_RE matching <lang>(_<REGION>)?', function () {
        assert.match(src, /var\s+CULTURE_RE\s*=\s*\/\^\[a-z\]\{2,3\}\(_\[A-Z\]\{2,3\}\)\?\$\//);
    });

    it('declares CLDR_PLURAL_KEYS in canonical CLDR order', function () {
        assert.match(src, /var\s+CLDR_PLURAL_KEYS\s*=\s*\[\s*['"]zero['"]\s*,\s*['"]one['"]\s*,\s*['"]two['"]\s*,\s*['"]few['"]\s*,\s*['"]many['"]\s*,\s*['"]other['"]\s*\]/);
    });

    it('calls init() at the bottom of the constructor', function () {
        assert.match(src, /init\(\);\s*\}\s*module\.exports\s*=\s*Export/);
    });

});


// ---------------------------------------------------------------------------
// 02 — argv parsing & dispatch
// ---------------------------------------------------------------------------

describe('02 - argv parsing & dispatch', function () {

    it('extractPositionals strips --flags, -flags, and @<project>', function () {
        assert.match(src, /var\s+extractPositionals\s*=\s*function/);
        assert.match(src, /\/\^\\-\\-\/\.test\(tok\)/);
        assert.match(src, /\/\^\\-\/\.test\(tok\)/);
        assert.match(src, /\/\^\\@\/\.test\(tok\)/);
    });

    it('reads <culture> from positionals[0] and <bundle> from positionals[1]', function () {
        assert.match(src, /positionals\[0\]/);
        assert.match(src, /positionals\[1\]/);
    });

    it('errors when <culture> is missing', function () {
        assert.match(src, /Missing <culture> argument/);
    });

    it('errors when <culture> does not match CULTURE_RE', function () {
        assert.match(src, /Invalid culture/);
    });

    it('captures --format=<x> from argv', function () {
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(arg\)/);
        assert.match(src, /self\.format\s*=\s*arg\.split\(\/\\=\/\)\[1\]/);
    });

    it('captures --output=<path> from argv', function () {
        assert.match(src, /\/\^\\-\\-output\\=\/\.test\(arg\)/);
        assert.match(src, /self\.output\s*=\s*arg\.split\(\/\\=\/\)\[1\]/);
    });

    it('rejects unknown --format values via ALLOWED_FORMATS', function () {
        assert.match(src, /ALLOWED_FORMATS\.indexOf\(self\.format\)\s*<\s*0/);
        assert.match(src, /--format must be `json`, `po`, or `csv`/);
    });

    it('errors when @<project> is missing', function () {
        assert.match(src, /requires\s*`@<project>`/);
    });

    it('errors when project is not registered', function () {
        assert.match(src, /is not registered/);
    });

    it('validates the bundle exists in the manifest', function () {
        assert.match(src, /manifest\.bundles\s*&&\s*!manifest\.bundles\[bundleName\]/);
    });

    it('routes to exportProjectOnly when no bundle given', function () {
        assert.match(src, /exportProjectOnly\(self\.projectName,\s*culture\)/);
    });

    it('routes to exportBundleOnly when bundle is given', function () {
        assert.match(src, /exportBundleOnly\(self\.projectName,\s*bundleName,\s*culture\)/);
    });

});


// ---------------------------------------------------------------------------
// 03 — Format auto-detect from --output extension
// ---------------------------------------------------------------------------

describe('03 - detectFormatFromPath', function () {

    function detectFormatFromPath(outputPath) {
        var ext = path.extname(String(outputPath || '')).toLowerCase();
        if (ext === '.po')   return 'po';
        if (ext === '.csv')  return 'csv';
        if (ext === '.json') return 'json';
        return null;
    }

    it('returns "po" for .po extension', function () {
        assert.equal(detectFormatFromPath('/tmp/fr.po'), 'po');
        assert.equal(detectFormatFromPath('translations.PO'), 'po');
    });

    it('returns "csv" for .csv extension', function () {
        assert.equal(detectFormatFromPath('/tmp/fr.csv'), 'csv');
        assert.equal(detectFormatFromPath('translations.CSV'), 'csv');
    });

    it('returns "json" for .json extension', function () {
        assert.equal(detectFormatFromPath('/tmp/fr.json'), 'json');
    });

    it('returns null for unrecognised extensions', function () {
        assert.equal(detectFormatFromPath('/tmp/fr.txt'), null);
        assert.equal(detectFormatFromPath('/tmp/fr'),     null);
        assert.equal(detectFormatFromPath(''),            null);
    });

    it('source declares detectFormatFromPath', function () {
        assert.match(src, /var\s+detectFormatFromPath\s*=\s*function/);
        assert.match(src, /path\.extname\(String\(outputPath/);
    });

    it('source falls back to DEFAULT_FORMAT when no --output and no --format', function () {
        assert.match(src, /var\s+DEFAULT_FORMAT\s*=\s*['"]json['"]/);
        assert.match(src, /self\.format\s*=\s*DEFAULT_FORMAT/);
    });

});


// ---------------------------------------------------------------------------
// 04 — flattenCatalog pure-logic replica
// ---------------------------------------------------------------------------

describe('04 - flattenCatalog', function () {

    var CLDR = ['zero', 'one', 'two', 'few', 'many', 'other'];

    function isPluralForm(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        var keys = Object.keys(value);
        if (keys.length === 0) return false;
        for (var i = 0; i < keys.length; i++) {
            if (CLDR.indexOf(keys[i]) < 0) return false;
            if (typeof value[keys[i]] !== 'string') return false;
        }
        return true;
    }

    function flattenCatalog(catalog, bundleName) {
        var out = [];
        var stamp = (typeof bundleName === 'string' && bundleName.length > 0) ? bundleName : null;
        function walk(prefix, node) {
            if (node === null || typeof node !== 'object' || Array.isArray(node)) {
                if (typeof node === 'string' && prefix) {
                    out.push({ bundle: stamp, key: prefix, value: node, plural: null });
                }
                return;
            }
            if (isPluralForm(node)) {
                if (prefix) {
                    out.push({ bundle: stamp, key: prefix, value: null, plural: node });
                }
                return;
            }
            var keys = Object.keys(node);
            for (var i = 0; i < keys.length; i++) {
                var k    = keys[i];
                var next = prefix ? (prefix + '.' + k) : k;
                walk(next, node[k]);
            }
        }
        walk('', catalog || {});
        return out;
    }

    it('flattens nested string keys to dotted paths', function () {
        var catalog = { common: { welcome: 'Hi', greeting: 'Hello' } };
        var entries = flattenCatalog(catalog);
        assert.equal(entries.length, 2);
        assert.equal(entries[0].key,   'common.welcome');
        assert.equal(entries[0].value, 'Hi');
        assert.equal(entries[1].key,   'common.greeting');
        assert.equal(entries[1].value, 'Hello');
    });

    it('emits plural-form objects as a single grouped entry (not flattened)', function () {
        var catalog = { items: { one: '{count} item', other: '{count} items' } };
        var entries = flattenCatalog(catalog);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].key,    'items');
        assert.equal(entries[0].value,  null);
        assert.deepEqual(entries[0].plural, { one: '{count} item', other: '{count} items' });
    });

    it('walks deeper than plural detection when keys mix non-CLDR names', function () {
        var catalog = { ui: { button: 'Click', mode: 'fast' } };
        var entries = flattenCatalog(catalog);
        assert.equal(entries.length, 2);
        assert.deepEqual(entries.map(function(e){ return e.key; }), ['ui.button', 'ui.mode']);
    });

    it('stamps bundle on every entry when bundleName is given', function () {
        var entries = flattenCatalog({ a: 'A' }, 'dashboard');
        assert.equal(entries.length, 1);
        assert.equal(entries[0].bundle, 'dashboard');
    });

    it('leaves bundle null when bundleName is null/empty', function () {
        var e1 = flattenCatalog({ a: 'A' });
        var e2 = flattenCatalog({ a: 'A' }, '');
        assert.equal(e1[0].bundle, null);
        assert.equal(e2[0].bundle, null);
    });

    it('drops non-string, non-object leaves silently', function () {
        var catalog = { a: 'A', b: 42, c: true, d: null };
        var entries = flattenCatalog(catalog);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].key, 'a');
    });

    it('source declares flattenCatalog', function () {
        assert.match(src, /var\s+flattenCatalog\s*=\s*function\s*\(\s*catalog,\s*bundleName\s*\)/);
        assert.match(src, /i18n\.isPluralForm\(node\)/);
    });

});


// ---------------------------------------------------------------------------
// 05 — PO writer pure-logic replica
// ---------------------------------------------------------------------------

describe('05 - PO writer', function () {

    var CLDR = ['zero', 'one', 'two', 'few', 'many', 'other'];

    var PLURAL_FORMS_TABLE = {
        'en': 'nplurals=2; plural=(n != 1);',
        'fr': 'nplurals=2; plural=(n > 1);',
        'pt_BR': 'nplurals=2; plural=(n > 1);',
        'ru': 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
        'ja': 'nplurals=1; plural=0;'
    };
    var DEFAULT_PLURAL_FORMS = 'nplurals=2; plural=(n != 1);';

    function pluralFormsFor(culture) {
        var c = String(culture || '');
        if (PLURAL_FORMS_TABLE[c]) return PLURAL_FORMS_TABLE[c];
        var base = c.split('_')[0];
        if (PLURAL_FORMS_TABLE[base]) return PLURAL_FORMS_TABLE[base];
        return DEFAULT_PLURAL_FORMS;
    }

    function poQuote(str) {
        var s = String(str == null ? '' : str);
        s = s
            .replace(/\\/g, '\\\\')
            .replace(/"/g,  '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\t/g, '\\t')
            .replace(/\r/g, '\\r');
        return '"' + s + '"';
    }

    function formatPO(entries, culture) {
        var out = [];
        out.push('msgid ""');
        out.push('msgstr ""');
        out.push('"Project-Id-Version: gina-i18n-export\\n"');
        out.push('"Content-Type: text/plain; charset=UTF-8\\n"');
        out.push('"Content-Transfer-Encoding: 8bit\\n"');
        out.push('"Language: ' + String(culture || '') + '\\n"');
        out.push('"Plural-Forms: ' + pluralFormsFor(culture) + '\\n"');
        out.push('');
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.plural) {
                var present = [];
                for (var j = 0; j < CLDR.length; j++) {
                    if (typeof e.plural[CLDR[j]] === 'string') present.push(CLDR[j]);
                }
                out.push('#. cldr-keys: ' + present.join(','));
                if (e.bundle) out.push('msgctxt ' + poQuote(e.bundle));
                out.push('msgid ' + poQuote(e.key));
                out.push('msgid_plural ' + poQuote(e.key + '.plural'));
                for (var n = 0; n < present.length; n++) {
                    out.push('msgstr[' + n + '] ' + poQuote(e.plural[present[n]]));
                }
            } else {
                if (e.bundle) out.push('msgctxt ' + poQuote(e.bundle));
                out.push('msgid ' + poQuote(e.key));
                out.push('msgstr ' + poQuote(e.value));
            }
            out.push('');
        }
        return out.join('\n');
    }

    it('poQuote escapes backslash, double-quote, and newline', function () {
        assert.equal(poQuote('plain'),               '"plain"');
        assert.equal(poQuote('has "quote"'),         '"has \\"quote\\""');
        assert.equal(poQuote('back\\slash'),         '"back\\\\slash"');
        assert.equal(poQuote('multi\nline'),         '"multi\\nline"');
        assert.equal(poQuote('tab\there'),           '"tab\\there"');
        assert.equal(poQuote('cr\rhere'),            '"cr\\rhere"');
    });

    it('poQuote handles null / undefined / empty input', function () {
        assert.equal(poQuote(null),       '""');
        assert.equal(poQuote(undefined),  '""');
        assert.equal(poQuote(''),         '""');
    });

    it('emits the standard PO header block (msgid "" / msgstr "" / Language: <culture>)', function () {
        var po = formatPO([], 'fr');
        assert.match(po, /^msgid ""\nmsgstr ""\n/);
        assert.match(po, /"Content-Type: text\/plain; charset=UTF-8\\n"/);
        assert.match(po, /"Language: fr\\n"/);
    });

    it('emits the per-culture Plural-Forms formula', function () {
        assert.match(formatPO([], 'fr'),    /"Plural-Forms: nplurals=2; plural=\(n > 1\);\\n"/);
        assert.match(formatPO([], 'ru'),    /"Plural-Forms: nplurals=3;/);
        assert.match(formatPO([], 'ja'),    /"Plural-Forms: nplurals=1; plural=0;\\n"/);
        assert.match(formatPO([], 'pt_BR'), /"Plural-Forms: nplurals=2; plural=\(n > 1\);\\n"/);
    });

    it('falls back to base language for region-qualified cultures (ru_RU → ru formula)', function () {
        var po = formatPO([], 'ru_RU');
        assert.match(po, /"Plural-Forms: nplurals=3;/);
    });

    it('falls back to default for unknown cultures', function () {
        var po = formatPO([], 'xq');
        assert.match(po, /"Plural-Forms: nplurals=2; plural=\(n != 1\);\\n"/);
    });

    it('emits a single-string entry with msgid + msgstr', function () {
        var po = formatPO([{ bundle: null, key: 'common.welcome', value: 'Bienvenue!', plural: null }], 'fr');
        assert.match(po, /msgid "common\.welcome"\nmsgstr "Bienvenue!"/);
    });

    it('emits msgctxt for entries with a bundle (multi-bundle export)', function () {
        var po = formatPO([{ bundle: 'dashboard', key: 'a', value: 'A', plural: null }], 'fr');
        assert.match(po, /msgctxt "dashboard"\nmsgid "a"\nmsgstr "A"/);
    });

    it('emits msgid_plural + msgstr[N] for plural entries', function () {
        var entries = [{
            bundle: null,
            key   : 'items',
            value : null,
            plural: { one: '{count} article', other: '{count} articles' }
        }];
        var po = formatPO(entries, 'fr');
        assert.match(po, /msgid "items"/);
        assert.match(po, /msgid_plural "items\.plural"/);
        assert.match(po, /msgstr\[0\] "\{count\} article"/);
        assert.match(po, /msgstr\[1\] "\{count\} articles"/);
    });

    it('embeds a #. cldr-keys: <list> extracted comment for round-trip', function () {
        var entries = [{
            bundle: null,
            key   : 'items',
            value : null,
            plural: { one: 'a', other: 'b' }
        }];
        var po = formatPO(entries, 'en');
        assert.match(po, /#\. cldr-keys: one,other/);
    });

    it('cldr-keys list preserves CLDR canonical order (zero before one before two before few before many before other)', function () {
        var entries = [{
            bundle: null, key: 'k', value: null,
            plural: { other: 'o', few: 'f', one: '1', many: 'm', zero: 'z' }
        }];
        var po = formatPO(entries, 'ru');
        assert.match(po, /#\. cldr-keys: zero,one,few,many,other/);
    });

    it('emits msgstr[N] in CLDR order matching the cldr-keys comment', function () {
        var entries = [{
            bundle: null, key: 'k', value: null,
            plural: { few: 'F', one: 'O', other: 'X' }
        }];
        var po = formatPO(entries, 'ru');
        // present = ['one', 'few', 'other'] in CLDR order
        assert.match(po, /msgstr\[0\] "O"/);
        assert.match(po, /msgstr\[1\] "F"/);
        assert.match(po, /msgstr\[2\] "X"/);
    });

    it('source declares poQuote and formatPO', function () {
        assert.match(src, /var\s+poQuote\s*=\s*function/);
        assert.match(src, /var\s+formatPO\s*=\s*function/);
        assert.match(src, /msgid_plural/);
        assert.match(src, /#\. cldr-keys/);
    });

    it('source declares pluralFormsFor with base-language fallback', function () {
        assert.match(src, /var\s+pluralFormsFor\s*=\s*function/);
        assert.match(src, /var\s+PLURAL_FORMS_TABLE\s*=\s*\{/);
        assert.match(src, /var\s+DEFAULT_PLURAL_FORMS\s*=\s*['"]nplurals=2;\s*plural=\(n\s*!=\s*1\);['"]/);
    });

});


// ---------------------------------------------------------------------------
// 06 — CSV writer pure-logic replica
// ---------------------------------------------------------------------------

describe('06 - CSV writer', function () {

    var CLDR = ['zero', 'one', 'two', 'few', 'many', 'other'];

    function csvQuote(str) {
        var s = String(str == null ? '' : str);
        if (/[",\r\n]|^\s|\s$/.test(s)) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function formatCSV(entries, includeBundle) {
        var out = [];
        out.push(includeBundle ? 'bundle,key,value' : 'key,value');
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.plural) {
                for (var j = 0; j < CLDR.length; j++) {
                    var k = CLDR[j];
                    if (typeof e.plural[k] === 'string') {
                        var pkey = e.key + '.' + k;
                        if (includeBundle) {
                            out.push(csvQuote(e.bundle || '') + ',' + csvQuote(pkey) + ',' + csvQuote(e.plural[k]));
                        } else {
                            out.push(csvQuote(pkey) + ',' + csvQuote(e.plural[k]));
                        }
                    }
                }
            } else {
                if (includeBundle) {
                    out.push(csvQuote(e.bundle || '') + ',' + csvQuote(e.key) + ',' + csvQuote(e.value));
                } else {
                    out.push(csvQuote(e.key) + ',' + csvQuote(e.value));
                }
            }
        }
        return out.join('\n') + '\n';
    }

    it('csvQuote leaves plain values alone', function () {
        assert.equal(csvQuote('plain'), 'plain');
        assert.equal(csvQuote('123'),   '123');
    });

    it('csvQuote wraps values containing commas', function () {
        assert.equal(csvQuote('a,b'), '"a,b"');
    });

    it('csvQuote doubles embedded quotes and wraps', function () {
        assert.equal(csvQuote('she said "hi"'), '"she said ""hi"""');
    });

    it('csvQuote wraps on embedded newline / CR', function () {
        assert.equal(csvQuote('multi\nline'), '"multi\nline"');
        assert.equal(csvQuote('cr\rhere'),    '"cr\rhere"');
    });

    it('csvQuote wraps on leading / trailing whitespace', function () {
        assert.equal(csvQuote(' leading'), '" leading"');
        assert.equal(csvQuote('trailing '), '"trailing "');
    });

    it('header row matches `key,value` for single bundle, `bundle,key,value` for multi', function () {
        assert.match(formatCSV([], false), /^key,value\n$/);
        assert.match(formatCSV([], true),  /^bundle,key,value\n$/);
    });

    it('emits one row per entry for single-string keys', function () {
        var csv = formatCSV([
            { bundle: null, key: 'a', value: 'A', plural: null },
            { bundle: null, key: 'b', value: 'B', plural: null }
        ], false);
        var lines = csv.split('\n').filter(Boolean);
        assert.deepEqual(lines, ['key,value', 'a,A', 'b,B']);
    });

    it('flattens plural entries to dotted-suffix rows', function () {
        var entries = [{
            bundle: null, key: 'items', value: null,
            plural: { one: '{count} item', other: '{count} items' }
        }];
        var lines = formatCSV(entries, false).split('\n').filter(Boolean);
        assert.deepEqual(lines, [
            'key,value',
            'items.one,{count} item',
            'items.other,{count} items'
        ]);
    });

    it('multi-bundle prefixes each row with the bundle column', function () {
        var entries = [
            { bundle: 'dashboard', key: 'a', value: 'A', plural: null },
            { bundle: 'auth',      key: 'b', value: 'B', plural: null }
        ];
        var lines = formatCSV(entries, true).split('\n').filter(Boolean);
        assert.deepEqual(lines, ['bundle,key,value', 'dashboard,a,A', 'auth,b,B']);
    });

    it('source declares csvQuote and formatCSV with RFC 4180 regex', function () {
        assert.match(src, /var\s+csvQuote\s*=\s*function/);
        assert.match(src, /var\s+formatCSV\s*=\s*function/);
        assert.match(src, /\/\[",\\r\\n\]\|\^\\s\|\\s\$\//);
    });

});


// ---------------------------------------------------------------------------
// 07 — JSON writer + emit
// ---------------------------------------------------------------------------

describe('07 - JSON writer + emit', function () {

    function formatJSON(data) {
        return JSON.stringify(data, null, 4) + '\n';
    }

    it('JSON identity round-trip — single-bundle catalog matches on-disk shape', function () {
        var catalog = { common: { welcome: 'Hi', items: { one: '1', other: 'N' } } };
        var body    = formatJSON(catalog);
        assert.deepEqual(JSON.parse(body), catalog);
    });

    it('JSON multi-bundle wrapper has bundle keys at top level', function () {
        var data = { dashboard: { a: 'A' }, auth: { b: 'B' } };
        var body = formatJSON(data);
        var parsed = JSON.parse(body);
        assert.deepEqual(Object.keys(parsed).sort(), ['auth', 'dashboard']);
        assert.equal(parsed.dashboard.a, 'A');
        assert.equal(parsed.auth.b,      'B');
    });

    it('serialises with 4-space indent and trailing newline', function () {
        var body = formatJSON({ a: 'b' });
        var lines = body.split('\n');
        assert.match(lines[1], /^    "a"/);
        assert.equal(body.charAt(body.length - 1), '\n');
    });

    it('source declares formatJSON with 4-space indent + trailing \\n', function () {
        assert.match(src, /var\s+formatJSON\s*=\s*function/);
        assert.match(src, /JSON\.stringify\(data,\s*null,\s*4\)\s*\+\s*['"]\\n['"]/);
    });

    it('source declares emit() with stdout fallback and lib.generator write', function () {
        assert.match(src, /var\s+emit\s*=\s*function/);
        assert.match(src, /lib\.generator\.createFileFromDataSync\(body,\s*target\)/);
    });

    it('source errors when --output parent dir does not exist', function () {
        assert.match(src, /Output directory does not exist/);
    });

});


// ---------------------------------------------------------------------------
// 08 — Help + arguments + dispatchers
// ---------------------------------------------------------------------------

describe('08 - help + arguments + dispatchers', function () {

    it('help.txt documents the export action', function () {
        assert.match(helpTxt, /\bexport\b/);
        assert.match(helpTxt, /export\s+<culture>\s+<bundle>\s+@<project>/);
    });

    it('help.txt example shows export with --format=po --output=', function () {
        assert.match(helpTxt, /gina i18n:export\s+\S+\s+@\S+\s+--format=po\s+--output=/);
    });

    it('help.txt notes the auto-detect behaviour from --output extension', function () {
        assert.match(helpTxt, /auto-detected from the\n\s+output\s+extension/);
    });

    it('arguments.json includes --format and --output (already present from slice 4)', function () {
        ['--format', '--output'].forEach(function (flag) {
            assert.ok(argsArr.indexOf(flag) > -1, 'expected ' + flag + ' in arguments.json');
        });
    });

    it('source declares exportBundleOnly + exportProjectOnly + readCatalog', function () {
        assert.match(src, /var\s+exportBundleOnly\s*=\s*function/);
        assert.match(src, /var\s+exportProjectOnly\s*=\s*function/);
        assert.match(src, /var\s+readCatalog\s*=\s*function/);
    });

    it('exportProjectOnly skips bundles without a catalog (warn + continue)', function () {
        assert.match(src, /skipped — no catalog at/);
    });

    it('exportProjectOnly errors when zero bundles have a catalog', function () {
        assert.match(src, /No bundles in @/);
    });

});


// ---------------------------------------------------------------------------
// 09 — Sandbox export smoke (end-to-end formatter + write)
// ---------------------------------------------------------------------------

describe('09 - sandbox export write', function () {

    function formatJSON(data) { return JSON.stringify(data, null, 4) + '\n'; }

    it('JSON file round-trips JSON.parse on disk', function () {
        var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-i18n-export-'));
        try {
            var catalog = {
                common: {
                    welcome : 'Welcome!',
                    greeting: 'Hello, {name}!',
                    items   : { one: '{count} item', other: '{count} items' }
                },
                errors: { notFound: 'Not found' }
            };
            var targetPath = path.join(tmp, 'en.json');
            fs.writeFileSync(targetPath, formatJSON(catalog), 'utf8');

            var written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
            assert.deepEqual(written, catalog);
        } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        }
    });

    it('PO output is parseable by a minimal PO recogniser (msgid/msgstr/msgid_plural pairs)', function () {
        var CLDR = ['zero', 'one', 'two', 'few', 'many', 'other'];
        function poQuote(s) {
            return '"' + String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\t/g,'\\t').replace(/\r/g,'\\r') + '"';
        }
        function formatPO(entries, culture) {
            var out = [];
            out.push('msgid ""');
            out.push('msgstr ""');
            out.push('"Language: ' + culture + '\\n"');
            out.push('');
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                if (e.plural) {
                    var present = [];
                    for (var j = 0; j < CLDR.length; j++) {
                        if (typeof e.plural[CLDR[j]] === 'string') present.push(CLDR[j]);
                    }
                    out.push('#. cldr-keys: ' + present.join(','));
                    out.push('msgid '        + poQuote(e.key));
                    out.push('msgid_plural ' + poQuote(e.key + '.plural'));
                    for (var n = 0; n < present.length; n++) {
                        out.push('msgstr[' + n + '] ' + poQuote(e.plural[present[n]]));
                    }
                } else {
                    out.push('msgid '  + poQuote(e.key));
                    out.push('msgstr ' + poQuote(e.value));
                }
                out.push('');
            }
            return out.join('\n');
        }

        var po = formatPO([
            { bundle: null, key: 'common.welcome', value: 'Bienvenue!', plural: null },
            { bundle: null, key: 'items',          value: null,
              plural: { one: '{count} article', other: '{count} articles' } }
        ], 'fr');

        var msgidCount        = (po.match(/^msgid /gm)        || []).length;
        var msgstrCount       = (po.match(/^msgstr /gm)       || []).length;
        var msgidPluralCount  = (po.match(/^msgid_plural /gm) || []).length;
        var msgstrIdxCount    = (po.match(/^msgstr\[\d+\] /gm)|| []).length;

        // Header (msgid "") + 1 single-string entry + 1 plural entry = 3 msgid lines
        assert.equal(msgidCount,       3);
        // Header msgstr "" + 1 single-string msgstr = 2 msgstr lines (plural uses msgstr[N])
        assert.equal(msgstrCount,      2);
        // 1 plural entry → 1 msgid_plural
        assert.equal(msgidPluralCount, 1);
        // 1 plural entry × 2 forms → 2 msgstr[N]
        assert.equal(msgstrIdxCount,   2);
        // cldr-keys round-trip marker present
        assert.match(po, /#\. cldr-keys: one,other/);
    });

    it('CSV output round-trips through a minimal RFC-4180 reader', function () {
        function csvQuote(s) {
            var x = String(s||'');
            return /[",\r\n]|^\s|\s$/.test(x) ? '"' + x.replace(/"/g,'""') + '"' : x;
        }
        function formatCSV(rows) {
            var lines = ['key,value'];
            for (var i = 0; i < rows.length; i++) {
                lines.push(csvQuote(rows[i].key) + ',' + csvQuote(rows[i].value));
            }
            return lines.join('\n') + '\n';
        }
        function parseCSV(body) {
            // Minimal RFC-4180 reader: state-machine over chars
            var rows = [];
            var row  = [];
            var cell = '';
            var inQ  = false;
            for (var i = 0; i < body.length; i++) {
                var c = body[i];
                if (inQ) {
                    if (c === '"') {
                        if (body[i+1] === '"') { cell += '"'; i++; }
                        else { inQ = false; }
                    } else { cell += c; }
                } else {
                    if (c === '"' && cell === '') { inQ = true; }
                    else if (c === ',') { row.push(cell); cell = ''; }
                    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
                    else { cell += c; }
                }
            }
            if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
            return rows;
        }

        var input = [
            { key: 'common.welcome',  value: 'Bienvenue!' },
            { key: 'with_comma',      value: 'a,b,c' },
            { key: 'with_quote',      value: 'she said "hi"' },
            { key: 'with_newline',    value: 'line 1\nline 2' }
        ];
        var body  = formatCSV(input);
        var rows  = parseCSV(body);
        assert.deepEqual(rows[0], ['key', 'value']);
        for (var i = 0; i < input.length; i++) {
            assert.equal(rows[i + 1][0], input[i].key);
            assert.equal(rows[i + 1][1], input[i].value);
        }
    });

});
