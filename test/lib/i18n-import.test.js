/**
 * lib/cmd/i18n/import.js — argv parsing, format auto-detection, PO / CSV /
 * JSON parsers, catalog reassembly from flat entries, multi-bundle
 * dispatch, deep-merge / replace strategies, and the comment-preserving
 * write-back path.
 *
 * Source-inspection tests + pure-logic replicas of the parsers and the
 * merge / wrapper-detection helpers + a sandbox import smoke covering
 * union / replace round-trip. Mirrors the i18n-export.test.js style:
 * import.js itself runs inside the CLI daemon context (CmdHelper, lib.i18n,
 * requireJSON globals) and is not invoked here.
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var IMPORT_SOURCE = path.join(require('../fw'), 'lib/cmd/i18n/import.js');
var HELP_SOURCE   = path.join(require('../fw'), 'lib/cmd/i18n/help.js');
var HELP_TXT      = path.join(require('../fw'), 'lib/cmd/i18n/help.txt');
var ARGS_FILE     = path.join(require('../fw'), 'lib/cmd/i18n/arguments.json');

var src     = fs.readFileSync(IMPORT_SOURCE, 'utf8');
var helpSrc = fs.readFileSync(HELP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Import constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Import;?/);
    });

    it('declares a function Import(opt, cmd)', function () {
        assert.match(src, /function\s+Import\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
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

    it('initialises self with file/format/merge/dryRun/force defaults', function () {
        assert.match(src, /var\s+self\s*=\s*\{[\s\S]*file:\s*null,[\s\S]*format:\s*null,[\s\S]*merge:\s*['"]union['"],[\s\S]*dryRun:\s*false,[\s\S]*force:\s*false/);
    });

    it('declares ALLOWED_FORMATS = json/po/csv', function () {
        assert.match(src, /var\s+ALLOWED_FORMATS\s*=\s*\[\s*['"]json['"]\s*,\s*['"]po['"]\s*,\s*['"]csv['"]\s*\]/);
    });

    it('declares ALLOWED_MERGE = union/replace', function () {
        assert.match(src, /var\s+ALLOWED_MERGE\s*=\s*\[\s*['"]union['"]\s*,\s*['"]replace['"]\s*\]/);
    });

    it('declares CULTURE_RE matching <lang>(_<REGION>)?', function () {
        assert.match(src, /var\s+CULTURE_RE\s*=\s*\/\^\[a-z\]\{2,3\}\(_\[A-Z\]\{2,3\}\)\?\$\//);
    });

    it('declares CLDR_PLURAL_KEYS in canonical order', function () {
        assert.match(src, /var\s+CLDR_PLURAL_KEYS\s*=\s*\[\s*['"]zero['"]\s*,\s*['"]one['"]\s*,\s*['"]two['"]\s*,\s*['"]few['"]\s*,\s*['"]many['"]\s*,\s*['"]other['"]\s*\]/);
    });

    it('calls init() at the bottom of the constructor', function () {
        assert.match(src, /init\(\);\s*\}\s*module\.exports\s*=\s*Import/);
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

    it('captures --file=<path> from argv', function () {
        assert.match(src, /\/\^\\-\\-file\\=\/\.test\(arg\)/);
        assert.match(src, /self\.file\s*=\s*arg\.split\(\/\\=\/\)\[1\]/);
    });

    it('captures --format=<x> from argv', function () {
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(arg\)/);
        assert.match(src, /self\.format\s*=\s*arg\.split\(\/\\=\/\)\[1\]/);
    });

    it('captures --merge=<x> from argv', function () {
        assert.match(src, /\/\^\\-\\-merge\\=\/\.test\(arg\)/);
        assert.match(src, /self\.merge\s*=\s*arg\.split\(\/\\=\/\)\[1\]/);
    });

    it('parses --dry-run', function () {
        assert.match(src, /arg\s*===\s*['"]--dry-run['"]/);
    });

    it('parses --force', function () {
        assert.match(src, /arg\s*===\s*['"]--force['"]/);
    });

    it('errors when --file is missing', function () {
        assert.match(src, /Missing --file=<path>/);
    });

    it('errors when --file path does not exist', function () {
        assert.match(src, /Input file not found/);
    });

    it('rejects unknown --format values via ALLOWED_FORMATS', function () {
        assert.match(src, /ALLOWED_FORMATS\.indexOf\(self\.format\)\s*<\s*0/);
    });

    it('rejects unknown --merge values via ALLOWED_MERGE', function () {
        assert.match(src, /ALLOWED_MERGE\.indexOf\(self\.merge\)\s*<\s*0/);
    });

    it('errors when @<project> is missing', function () {
        assert.match(src, /requires\s*`@<project>`/);
    });

    it('errors when project is not registered', function () {
        assert.match(src, /is not registered/);
    });

    it('routes to importProjectWide when no bundle given', function () {
        assert.match(src, /importProjectWide\(self\.projectName,\s*culture\)/);
    });

    it('routes to importBundleOnly when bundle is given', function () {
        assert.match(src, /importBundleOnly\(self\.projectName,\s*bundleName,\s*culture\)/);
    });

});


// ---------------------------------------------------------------------------
// 03 — Format auto-detect from --file extension
// ---------------------------------------------------------------------------

describe('03 - detectFormatFromPath', function () {

    function detectFormatFromPath(inputPath) {
        var ext = path.extname(String(inputPath || '')).toLowerCase();
        if (ext === '.po')   return 'po';
        if (ext === '.csv')  return 'csv';
        if (ext === '.json') return 'json';
        return null;
    }

    it('returns "po" / "csv" / "json" for matching extensions', function () {
        assert.equal(detectFormatFromPath('/tmp/fr.po'),   'po');
        assert.equal(detectFormatFromPath('/tmp/fr.csv'),  'csv');
        assert.equal(detectFormatFromPath('/tmp/fr.json'), 'json');
    });

    it('returns null for unrecognised extensions', function () {
        assert.equal(detectFormatFromPath('/tmp/fr.txt'), null);
        assert.equal(detectFormatFromPath('/tmp/fr'),     null);
    });

    it('source declares detectFormatFromPath', function () {
        assert.match(src, /var\s+detectFormatFromPath\s*=\s*function/);
    });

    it('source errors when --file extension cannot be auto-detected and --format absent', function () {
        assert.match(src, /--format must be set when --file extension is not/);
    });

});


// ---------------------------------------------------------------------------
// 04 — PO parser pure-logic replica
// ---------------------------------------------------------------------------

describe('04 - PO parser', function () {

    var CLDR_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'];

    function poUnescape(str) {
        return String(str || '').replace(/\\(.)/g, function (m, ch) {
            if (ch === 'n')  return '\n';
            if (ch === 't')  return '\t';
            if (ch === 'r')  return '\r';
            if (ch === '"')  return '"';
            if (ch === '\\') return '\\';
            return m;
        });
    }

    function unwrapPoQuoted(raw) {
        var s = String(raw || '').trim();
        if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
            return s.slice(1, -1);
        }
        return s;
    }

    function newPoEntry() {
        return { msgctxt: null, key: null, msgidPlural: null, msgstr: null, msgstrN: {}, cldrKeys: null };
    }

    function appendToDirective(cur, directive, add) {
        if (directive === 'msgctxt')      cur.msgctxt = (cur.msgctxt || '') + add;
        else if (directive === 'msgid')        cur.key = (cur.key || '') + add;
        else if (directive === 'msgid_plural') cur.msgidPlural = (cur.msgidPlural || '') + add;
        else if (directive === 'msgstr')       cur.msgstr = (cur.msgstr || '') + add;
        else {
            var m = directive.match(/^msgstr\[(\d+)\]$/);
            if (m) {
                var idx = parseInt(m[1], 10);
                cur.msgstrN[idx] = (cur.msgstrN[idx] || '') + add;
            }
        }
    }

    function buildEntryFromPo(cur) {
        var bundle = (cur.msgctxt && cur.msgctxt.length > 0) ? cur.msgctxt : null;
        if (cur.msgidPlural !== null) {
            var indices = Object.keys(cur.msgstrN).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
            var keys    = (cur.cldrKeys && cur.cldrKeys.length > 0) ? cur.cldrKeys : CLDR_KEYS.slice(0, indices.length);
            var plural  = {};
            for (var n = 0; n < indices.length && n < keys.length; n++) {
                plural[keys[n]] = cur.msgstrN[indices[n]];
            }
            return { bundle: bundle, key: cur.key, value: null, plural: plural };
        }
        return { bundle: bundle, key: cur.key, value: cur.msgstr || '', plural: null };
    }

    function parsePO(body) {
        var lines = String(body || '').split(/\r?\n/);
        var entries = [];
        var cur = newPoEntry();
        var lastDirective = null;
        function flush() {
            if (cur.key !== null && cur.key !== '') entries.push(buildEntryFromPo(cur));
            cur = newPoEntry();
            lastDirective = null;
        }
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var trimmed = line.replace(/^\s+/, '');
            if (trimmed === '') { flush(); continue; }
            if (trimmed.charAt(0) === '#') {
                var ckm = trimmed.match(/^#\.\s*cldr-keys\s*:\s*(.+)$/);
                if (ckm) cur.cldrKeys = ckm[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
                lastDirective = null;
                continue;
            }
            var ctx = trimmed.match(/^msgctxt\s+(.*)$/);
            if (ctx) { cur.msgctxt = poUnescape(unwrapPoQuoted(ctx[1])); lastDirective = 'msgctxt'; continue; }
            var idp = trimmed.match(/^msgid_plural\s+(.*)$/);
            if (idp) { cur.msgidPlural = poUnescape(unwrapPoQuoted(idp[1])); lastDirective = 'msgid_plural'; continue; }
            var id = trimmed.match(/^msgid\s+(.*)$/);
            if (id) { cur.key = poUnescape(unwrapPoQuoted(id[1])); lastDirective = 'msgid'; continue; }
            var sn = trimmed.match(/^msgstr\[(\d+)\]\s+(.*)$/);
            if (sn) { cur.msgstrN[parseInt(sn[1], 10)] = poUnescape(unwrapPoQuoted(sn[2])); lastDirective = 'msgstr[' + sn[1] + ']'; continue; }
            var ms = trimmed.match(/^msgstr\s+(.*)$/);
            if (ms) { cur.msgstr = poUnescape(unwrapPoQuoted(ms[1])); lastDirective = 'msgstr'; continue; }
            if (trimmed.charAt(0) === '"' && lastDirective) {
                appendToDirective(cur, lastDirective, poUnescape(unwrapPoQuoted(trimmed)));
            }
        }
        flush();
        return entries;
    }

    it('poUnescape reverses PO escape sequences', function () {
        assert.equal(poUnescape('plain'),                 'plain');
        assert.equal(poUnescape('multi\\nline'),          'multi\nline');
        assert.equal(poUnescape('tab\\there'),            'tab\there');
        assert.equal(poUnescape('back\\\\slash'),         'back\\slash');
        assert.equal(poUnescape('has \\"quote\\"'),       'has "quote"');
        assert.equal(poUnescape('cr\\rhere'),             'cr\rhere');
    });

    it('parses a single-string entry with msgid + msgstr', function () {
        var po = 'msgid ""\nmsgstr ""\n"Language: fr\\n"\n\nmsgid "common.welcome"\nmsgstr "Bienvenue!"\n';
        var entries = parsePO(po);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].key,    'common.welcome');
        assert.equal(entries[0].value,  'Bienvenue!');
        assert.equal(entries[0].plural, null);
        assert.equal(entries[0].bundle, null);
    });

    it('parses msgctxt as the bundle name', function () {
        var po = 'msgid ""\nmsgstr ""\n\nmsgctxt "dashboard"\nmsgid "a"\nmsgstr "A"\n';
        var entries = parsePO(po);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].bundle, 'dashboard');
        assert.equal(entries[0].key,    'a');
        assert.equal(entries[0].value,  'A');
    });

    it('parses plural entry — msgid_plural + msgstr[N] + #. cldr-keys round-trip', function () {
        var po = [
            'msgid ""',
            'msgstr ""',
            '',
            '#. cldr-keys: one,other',
            'msgid "items"',
            'msgid_plural "items.plural"',
            'msgstr[0] "{count} article"',
            'msgstr[1] "{count} articles"',
            ''
        ].join('\n');
        var entries = parsePO(po);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].key, 'items');
        assert.deepEqual(entries[0].plural, {
            one  : '{count} article',
            other: '{count} articles'
        });
    });

    it('falls back to canonical CLDR order when #. cldr-keys is absent', function () {
        var po = [
            'msgid ""',
            'msgstr ""',
            '',
            'msgid "items"',
            'msgid_plural "items.plural"',
            'msgstr[0] "a"',
            'msgstr[1] "b"',
            ''
        ].join('\n');
        var entries = parsePO(po);
        // CLDR order = ['zero','one'], so missing comment → ['zero', 'one']
        assert.equal(entries.length, 1);
        assert.deepEqual(entries[0].plural, { zero: 'a', one: 'b' });
    });

    it('handles 3-form Russian-style plurals via cldr-keys', function () {
        var po = [
            'msgid ""',
            'msgstr ""',
            '',
            '#. cldr-keys: one,few,many',
            'msgid "k"',
            'msgid_plural "k.plural"',
            'msgstr[0] "1"',
            'msgstr[1] "F"',
            'msgstr[2] "M"',
            ''
        ].join('\n');
        var entries = parsePO(po);
        assert.deepEqual(entries[0].plural, { one: '1', few: 'F', many: 'M' });
    });

    it('parses multiline strings via PO continuation (msgid "" + "line1" + "line2")', function () {
        var po = [
            'msgid ""',
            'msgstr ""',
            '',
            'msgid "k"',
            'msgstr ""',
            '"first line\\n"',
            '"second line"',
            ''
        ].join('\n');
        var entries = parsePO(po);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].value, 'first line\nsecond line');
    });

    it('skips the header entry (empty msgid)', function () {
        var po = 'msgid ""\nmsgstr ""\n"Language: fr\\n"\n\nmsgid "k"\nmsgstr "v"\n';
        var entries = parsePO(po);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].key, 'k');
    });

    it('source declares parsePO + poUnescape + buildEntryFromPo + appendToDirective', function () {
        assert.match(src, /var\s+parsePO\s*=\s*function/);
        assert.match(src, /var\s+poUnescape\s*=\s*function/);
        assert.match(src, /var\s+buildEntryFromPo\s*=\s*function/);
        assert.match(src, /var\s+appendToDirective\s*=\s*function/);
    });

});


// ---------------------------------------------------------------------------
// 05 — CSV parser pure-logic replica
// ---------------------------------------------------------------------------

describe('05 - CSV parser', function () {

    function parseCSVRows(body) {
        var rows = [];
        var row  = [];
        var cell = '';
        var inQ  = false;
        var s    = String(body || '');
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i);
            if (inQ) {
                if (c === '"') {
                    if (s.charAt(i + 1) === '"') { cell += '"'; i++; }
                    else                          { inQ = false; }
                } else { cell += c; }
            } else {
                if (c === '"' && cell === '') inQ = true;
                else if (c === ',') { row.push(cell); cell = ''; }
                else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
                else if (c === '\r') {
                    if (s.charAt(i + 1) === '\n') i++;
                    row.push(cell); rows.push(row); row = []; cell = '';
                } else cell += c;
            }
        }
        if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
        return rows;
    }

    function parseCSV(body) {
        var rows = parseCSVRows(body);
        if (rows.length === 0) return [];
        var header = rows[0];
        var hasBundle = false;
        var keyIdx, valIdx, bundleIdx;
        if (header.length === 3 && header[0] === 'bundle' && header[1] === 'key' && header[2] === 'value') {
            hasBundle = true; bundleIdx = 0; keyIdx = 1; valIdx = 2;
        } else if (header.length >= 2 && header[0] === 'key' && header[1] === 'value') {
            hasBundle = false; keyIdx = 0; valIdx = 1;
        } else {
            return [];
        }
        var entries = [];
        for (var r = 1; r < rows.length; r++) {
            var row = rows[r];
            if (row.length === 0) continue;
            if (row.length === 1 && row[0] === '') continue;
            var k = row[keyIdx];
            if (typeof k !== 'string' || k.length === 0) continue;
            entries.push({
                bundle: hasBundle ? (row[bundleIdx] || null) : null,
                key   : k,
                value : (typeof row[valIdx] === 'string') ? row[valIdx] : '',
                plural: null
            });
        }
        return entries;
    }

    it('parses single-bundle CSV (key,value header)', function () {
        var csv = 'key,value\na,A\nb,B\n';
        var entries = parseCSV(csv);
        assert.equal(entries.length, 2);
        assert.equal(entries[0].key,    'a');
        assert.equal(entries[0].value,  'A');
        assert.equal(entries[0].bundle, null);
    });

    it('parses multi-bundle CSV (bundle,key,value header)', function () {
        var csv = 'bundle,key,value\ndashboard,a,A\nauth,b,B\n';
        var entries = parseCSV(csv);
        assert.equal(entries.length, 2);
        assert.equal(entries[0].bundle, 'dashboard');
        assert.equal(entries[1].bundle, 'auth');
    });

    it('handles embedded commas via quoted cells', function () {
        var csv = 'key,value\na,"x,y,z"\n';
        var entries = parseCSV(csv);
        assert.equal(entries[0].value, 'x,y,z');
    });

    it('handles embedded quotes (doubled) via quoted cells', function () {
        var csv = 'key,value\na,"she said ""hi"""\n';
        var entries = parseCSV(csv);
        assert.equal(entries[0].value, 'she said "hi"');
    });

    it('handles embedded newlines via quoted cells', function () {
        var csv = 'key,value\na,"line 1\nline 2"\n';
        var entries = parseCSV(csv);
        assert.equal(entries[0].value, 'line 1\nline 2');
    });

    it('handles CRLF line endings', function () {
        var csv = 'key,value\r\na,A\r\nb,B\r\n';
        var entries = parseCSV(csv);
        assert.equal(entries.length, 2);
        assert.equal(entries[0].value, 'A');
        assert.equal(entries[1].value, 'B');
    });

    it('skips rows without a key', function () {
        var csv = 'key,value\n,V\nk,K\n';
        var entries = parseCSV(csv);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].key, 'k');
    });

    it('returns [] when header does not match expected shape', function () {
        var csv = 'foo,bar\na,b\n';
        var entries = parseCSV(csv);
        assert.deepEqual(entries, []);
    });

    it('source declares parseCSV + parseCSVRows', function () {
        assert.match(src, /var\s+parseCSV\s*=\s*function/);
        assert.match(src, /var\s+parseCSVRows\s*=\s*function/);
    });

});


// ---------------------------------------------------------------------------
// 06 — buildCatalogFromEntries — flat-to-nested reassembly
// ---------------------------------------------------------------------------

describe('06 - catalog reassembly', function () {

    function setNested(out, parts, value) {
        var cursor = out;
        for (var i = 0; i < parts.length - 1; i++) {
            var seg = parts[i];
            if (typeof cursor[seg] !== 'object' || cursor[seg] === null || Array.isArray(cursor[seg])) {
                cursor[seg] = {};
            }
            cursor = cursor[seg];
        }
        cursor[parts[parts.length - 1]] = value;
    }
    function buildCatalogFromEntries(entries) {
        var out = {};
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.plural) setNested(out, e.key.split('.'), e.plural);
            else          setNested(out, e.key.split('.'), e.value);
        }
        return out;
    }

    it('reassembles flat single-segment entries to top-level keys', function () {
        var entries = [
            { key: 'welcome', value: 'Hi', plural: null },
            { key: 'goodbye', value: 'Bye', plural: null }
        ];
        var catalog = buildCatalogFromEntries(entries);
        assert.deepEqual(catalog, { welcome: 'Hi', goodbye: 'Bye' });
    });

    it('nests dotted-path entries into a tree', function () {
        var entries = [
            { key: 'common.welcome',  value: 'Hi',     plural: null },
            { key: 'common.greeting', value: 'Hello',  plural: null },
            { key: 'errors.notFound', value: 'NotF',   plural: null }
        ];
        var catalog = buildCatalogFromEntries(entries);
        assert.deepEqual(catalog, {
            common: { welcome: 'Hi', greeting: 'Hello' },
            errors: { notFound: 'NotF' }
        });
    });

    it('reassembles dotted-suffix CSV plural rows into a plural-form object', function () {
        var entries = [
            { key: 'items.one',   value: '{count} item',  plural: null },
            { key: 'items.other', value: '{count} items', plural: null }
        ];
        var catalog = buildCatalogFromEntries(entries);
        assert.deepEqual(catalog, {
            items: { one: '{count} item', other: '{count} items' }
        });
    });

    it('preserves PO-emitted plural-form objects atomically', function () {
        var entries = [
            { key: 'items', value: null, plural: { one: '1', other: 'N' } }
        ];
        var catalog = buildCatalogFromEntries(entries);
        assert.deepEqual(catalog, { items: { one: '1', other: 'N' } });
    });

    it('source declares buildCatalogFromEntries + setNested', function () {
        assert.match(src, /var\s+buildCatalogFromEntries\s*=\s*function/);
        assert.match(src, /var\s+setNested\s*=\s*function/);
    });

});


// ---------------------------------------------------------------------------
// 07 — JSON wrapper detection
// ---------------------------------------------------------------------------

describe('07 - looksLikeWrapper', function () {

    function looksLikeWrapper(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
        var keys = Object.keys(data);
        if (keys.length === 0) return false;
        var allObjects = true;
        var anyNested  = false;
        for (var i = 0; i < keys.length; i++) {
            var v = data[keys[i]];
            if (!v || typeof v !== 'object' || Array.isArray(v)) { allObjects = false; break; }
            var inner = Object.keys(v);
            for (var j = 0; j < inner.length; j++) {
                if (v[inner[j]] && typeof v[inner[j]] === 'object' && !Array.isArray(v[inner[j]])) {
                    anyNested = true; break;
                }
            }
        }
        return allObjects && anyNested;
    }

    it('returns true for a multi-bundle wrapper (top-level objects with nested objects inside)', function () {
        var data = { dashboard: { common: { welcome: 'Hi' } }, auth: { errors: { notFound: 'NF' } } };
        assert.equal(looksLikeWrapper(data), true);
    });

    it('returns false for a flat catalog with top-level strings', function () {
        var data = { welcome: 'Hi', goodbye: 'Bye' };
        assert.equal(looksLikeWrapper(data), false);
    });

    it('returns false for a shallow flat catalog (strings at depth 2)', function () {
        var data = { common: { welcome: 'Hi', greeting: 'Hello' } };
        assert.equal(looksLikeWrapper(data), false);
    });

    it('returns false for an empty / null / array root', function () {
        assert.equal(looksLikeWrapper({}),    false);
        assert.equal(looksLikeWrapper(null),  false);
        assert.equal(looksLikeWrapper([]),    false);
    });

    it('best-effort: returns true for deeply nested flat catalogs (CLI <bundle> resolves)', function () {
        // A flat catalog whose categories themselves contain nested objects
        // looks structurally identical to a wrapper. The heuristic is
        // best-effort; the CLI <bundle> positional disambiguates at routing
        // time (with <bundle>, the catalog is routed as flat; without
        // <bundle>, top-level keys are walked against the manifest and
        // unmatched ones are warned about and skipped).
        var data = { common: { items: { one: '1', other: 'N' } } };
        assert.equal(looksLikeWrapper(data), true);
    });

    it('source declares looksLikeWrapper', function () {
        assert.match(src, /var\s+looksLikeWrapper\s*=\s*function/);
    });

});


// ---------------------------------------------------------------------------
// 08 — Merge logic (union / replace) + dropped-key counter
// ---------------------------------------------------------------------------

describe('08 - merge', function () {

    function mergeUnion(existing, imported) {
        var out = {};
        var ek = Object.keys(existing || {});
        for (var i = 0; i < ek.length; i++) out[ek[i]] = existing[ek[i]];
        var ik = Object.keys(imported || {});
        for (var j = 0; j < ik.length; j++) {
            var k = ik[j];
            var ev = out[k];
            var iv = imported[k];
            if (ev && typeof ev === 'object' && !Array.isArray(ev)
                && iv && typeof iv === 'object' && !Array.isArray(iv)) {
                out[k] = mergeUnion(ev, iv);
            } else {
                out[k] = iv;
            }
        }
        return out;
    }

    it('union: imported keys win for shared paths', function () {
        var existing = { common: { welcome: 'old', greeting: 'old' } };
        var imported = { common: { welcome: 'new' } };
        var merged   = mergeUnion(existing, imported);
        assert.equal(merged.common.welcome,  'new');
        assert.equal(merged.common.greeting, 'old');
    });

    it('union: existing top-level keys absent from import are preserved', function () {
        var existing = { common: { a: '1' }, errors: { notFound: '404' } };
        var imported = { common: { a: '2' } };
        var merged   = mergeUnion(existing, imported);
        assert.deepEqual(merged.errors, { notFound: '404' });
        assert.equal(merged.common.a, '2');
    });

    it('union: plural-form merge per CLDR-key (partial import keeps existing siblings)', function () {
        var existing = { items: { one: 'OLD-one', other: 'OLD-other' } };
        var imported = { items: { one: 'NEW-one' } };
        var merged   = mergeUnion(existing, imported);
        assert.equal(merged.items.one,   'NEW-one');
        assert.equal(merged.items.other, 'OLD-other');
    });

    it('union: imported strings replace existing object slots when types diverge', function () {
        var existing = { k: { nested: 'old' } };
        var imported = { k: 'new-string' };
        var merged   = mergeUnion(existing, imported);
        assert.equal(merged.k, 'new-string');
    });

    it('union: empty existing → returns imported as-is', function () {
        var imported = { a: 'A' };
        var merged   = mergeUnion({}, imported);
        assert.deepEqual(merged, imported);
    });

    it('union: empty imported → returns existing unchanged', function () {
        var existing = { a: 'A' };
        var merged   = mergeUnion(existing, {});
        assert.deepEqual(merged, existing);
    });

    it('source declares mergeUnion + countDroppedKeys + countLeaves + isLeaf', function () {
        assert.match(src, /var\s+mergeUnion\s*=\s*function/);
        assert.match(src, /var\s+countDroppedKeys\s*=\s*function/);
        assert.match(src, /var\s+countLeaves\s*=\s*function/);
        assert.match(src, /var\s+isLeaf\s*=\s*function/);
    });

    it('source replace-mode wholesale-replaces with importedCatalog', function () {
        // The replace branch sets `merged = importedCatalog` directly
        assert.match(src, /merged\s*=\s*importedCatalog/);
    });

});


// ---------------------------------------------------------------------------
// 09 — Comment-preserving writer + help.txt + arguments.json
// ---------------------------------------------------------------------------

describe('09 - writer + help + arguments', function () {

    it('source declares readExistingFile mirroring the connector pattern', function () {
        assert.match(src, /var\s+readExistingFile\s*=\s*function/);
        assert.match(src, /raw\.indexOf\(['"]\{['"]\)/);
        assert.match(src, /raw\.slice\(0,\s*firstBrace\)/);
    });

    it('source declares writeFile via lib.generator.createFileFromDataSync', function () {
        assert.match(src, /var\s+writeFile\s*=\s*function/);
        assert.match(src, /lib\.generator\.createFileFromDataSync\(text,\s*target\)/);
    });

    it('writeFile preserves the leading comment header', function () {
        assert.match(src, /var\s+text\s*=\s*\(header\s*\|\|\s*['"]['"]\)\s*\+\s*body\s*\+\s*['"]\\n['"]/);
    });

    it('source serialises with 4-space indent + trailing newline', function () {
        assert.match(src, /JSON\.stringify\(data,\s*null,\s*4\)/);
    });

    it('--dry-run prints the [dry-run] would write line', function () {
        assert.match(src, /\[dry-run\] would write/);
    });

    it('--force allows creating a missing target catalog', function () {
        assert.match(src, /no catalog at[\s\S]*--force to create/);
    });

    it('help.txt documents the import action', function () {
        assert.match(helpTxt, /\bimport\b/);
        assert.match(helpTxt, /import\s+<culture>\s+<bundle>\s+@<project>\s+--file=/);
    });

    it('help.txt documents both --merge=union and --merge=replace', function () {
        assert.match(helpTxt, /--merge=union/);
        assert.match(helpTxt, /--merge=replace/);
    });

    it('help.txt example shows i18n:import with --file=', function () {
        assert.match(helpTxt, /gina i18n:import\s+\S+\s+@\S+\s+--file=/);
    });

    it('arguments.json includes --file and --merge (already present from slice 4)', function () {
        ['--file', '--merge'].forEach(function (flag) {
            assert.ok(argsArr.indexOf(flag) > -1, 'expected ' + flag + ' in arguments.json');
        });
    });

    it('source declares importBundle + importBundleOnly + importProjectWide + loadImport', function () {
        assert.match(src, /var\s+importBundle\s*=\s*function/);
        assert.match(src, /var\s+importBundleOnly\s*=\s*function/);
        assert.match(src, /var\s+importProjectWide\s*=\s*function/);
        assert.match(src, /var\s+loadImport\s*=\s*function/);
    });

});


// ---------------------------------------------------------------------------
// 10 — Sandbox import smoke (round-trip union / replace)
// ---------------------------------------------------------------------------

describe('10 - sandbox import write', function () {

    function mergeUnion(existing, imported) {
        var out = {};
        var ek = Object.keys(existing || {});
        for (var i = 0; i < ek.length; i++) out[ek[i]] = existing[ek[i]];
        var ik = Object.keys(imported || {});
        for (var j = 0; j < ik.length; j++) {
            var k = ik[j];
            var ev = out[k];
            var iv = imported[k];
            if (ev && typeof ev === 'object' && !Array.isArray(ev)
                && iv && typeof iv === 'object' && !Array.isArray(iv)) {
                out[k] = mergeUnion(ev, iv);
            } else {
                out[k] = iv;
            }
        }
        return out;
    }

    function readExistingFile(target) {
        if (!fs.existsSync(target)) return { header: '', data: {} };
        var raw = fs.readFileSync(target, 'utf8');
        var firstBrace = raw.indexOf('{');
        var header = (firstBrace > 0) ? raw.slice(0, firstBrace) : '';
        var data   = JSON.parse(raw.slice(firstBrace));
        return { header: header, data: data };
    }
    function writeFile(target, header, data) {
        var body = JSON.stringify(data, null, 4);
        var text = (header || '') + body + '\n';
        fs.writeFileSync(target, text, 'utf8');
    }

    it('union round-trip preserves existing keys absent from the import', function () {
        var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-i18n-import-'));
        try {
            var target = path.join(tmp, 'fr.json');
            var existing = {
                common: { welcome: '[OLD] Bienvenue', greeting: '[OLD] Bonjour' },
                errors: { notFound: '[OLD] Introuvable' }
            };
            fs.writeFileSync(target, JSON.stringify(existing, null, 4) + '\n', 'utf8');

            var imported = { common: { welcome: 'Bienvenue!' } };
            var existingNow = readExistingFile(target);
            var merged = mergeUnion(existingNow.data, imported);
            writeFile(target, existingNow.header, merged);

            var written = JSON.parse(fs.readFileSync(target, 'utf8'));
            assert.equal(written.common.welcome,  'Bienvenue!');
            assert.equal(written.common.greeting, '[OLD] Bonjour');
            assert.equal(written.errors.notFound, '[OLD] Introuvable');
        } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        }
    });

    it('replace round-trip drops existing keys absent from the import', function () {
        var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-i18n-import-'));
        try {
            var target = path.join(tmp, 'fr.json');
            var existing = { a: 'A-old', b: 'B-old', c: 'C-old' };
            fs.writeFileSync(target, JSON.stringify(existing, null, 4) + '\n', 'utf8');

            var imported = { a: 'A-new' };
            var existingNow = readExistingFile(target);
            // simulate replace mode: imported wins entirely
            writeFile(target, existingNow.header, imported);

            var written = JSON.parse(fs.readFileSync(target, 'utf8'));
            assert.deepEqual(written, { a: 'A-new' });
        } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        }
    });

    it('comment header at the top of an existing catalog is preserved', function () {
        var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-i18n-import-'));
        try {
            var target = path.join(tmp, 'fr.json');
            // Existing file has a leading `// comment` header before the `{`.
            var fileContent = '// translator: do not remove this header\n{\n    "k": "v"\n}\n';
            fs.writeFileSync(target, fileContent, 'utf8');

            var existingNow = readExistingFile(target);
            assert.equal(existingNow.header, '// translator: do not remove this header\n');

            var merged = mergeUnion(existingNow.data, { k: 'v2' });
            writeFile(target, existingNow.header, merged);

            var newRaw = fs.readFileSync(target, 'utf8');
            assert.match(newRaw, /^\/\/ translator: do not remove this header\n\{/);
            assert.match(newRaw, /"k": "v2"/);
        } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        }
    });

    it('CSV → import end-to-end: build catalog and write JSON catalog matches original', function () {
        function setNested(out, parts, value) {
            var cur = out;
            for (var i = 0; i < parts.length - 1; i++) {
                if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
                cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = value;
        }
        function buildCatalogFromEntries(entries) {
            var out = {};
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                if (e.plural) setNested(out, e.key.split('.'), e.plural);
                else          setNested(out, e.key.split('.'), e.value);
            }
            return out;
        }
        var entries = [
            { bundle: null, key: 'common.welcome',  value: 'Welcome!',     plural: null },
            { bundle: null, key: 'items.one',       value: '{count} item', plural: null },
            { bundle: null, key: 'items.other',     value: '{count} items',plural: null }
        ];
        var catalog = buildCatalogFromEntries(entries);
        assert.deepEqual(catalog, {
            common: { welcome: 'Welcome!' },
            items : { one: '{count} item', other: '{count} items' }
        });
    });

});
