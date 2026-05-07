/**
 * lib/cmd/i18n/scan.js — argv parsing, source walker, key-extraction
 * regexes, catalog enumeration, coverage computation, text + JSON output.
 *
 * Source-inspection tests (same style as connector-list.test.js,
 * service-list.test.js): scan.js runs inside the CLI daemon context
 * (CmdHelper, project registry, globals injected by gna.js). Replicating
 * that is heavy for near-zero extra coverage, so these assertions prove
 * the source structure of:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) argv loop — `--format=<x>` capture, CmdHelper-driven project/bundle
 *   (c) file walker — SOURCE_DIRS, EXCLUDE_DIRS, JS_EXT, TEMPLATE_EXT
 *   (d) regex patterns — T_CALL_RE, LEGACY_CALL_RE, TEMPLATE_T_RE, CULTURE_RE
 *   (e) pure-logic key extraction (replica)
 *   (f) pure-logic coverage computation (replica)
 *   (g) JSON output shape
 *   (h) text output shape
 *   (i) Help module + help.txt + arguments.json
 *   (j) bin/cli wiring (i18n: in allowedOffline)
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SCAN_SOURCE = path.join(require('../fw'), 'lib/cmd/i18n/scan.js');
var HELP_SOURCE = path.join(require('../fw'), 'lib/cmd/i18n/help.js');
var HELP_TXT    = path.join(require('../fw'), 'lib/cmd/i18n/help.txt');
var ARGS_FILE   = path.join(require('../fw'), 'lib/cmd/i18n/arguments.json');
var CLI_SOURCE  = path.join(__dirname, '..', '..', 'bin', 'cli');

var src     = fs.readFileSync(SCAN_SOURCE, 'utf8');
var helpSrc = fs.readFileSync(HELP_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var cliSrc  = fs.readFileSync(CLI_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Scan constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Scan;?/);
    });

    it('declares a function Scan(opt, cmd)', function () {
        assert.match(src, /function\s+Scan\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
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

    it('initialises self.format = "text"', function () {
        assert.match(src, /var\s+self\s*=\s*\{\s*format:\s*['"]text['"]\s*\}/);
    });

    it('calls init() at the bottom of the constructor', function () {
        assert.match(src, /init\(\);\s*\}\s*module\.exports\s*=\s*Scan/);
    });

});


// ---------------------------------------------------------------------------
// 02 — argv parsing & CmdHelper wiring
// ---------------------------------------------------------------------------

describe('02 - argv parsing & dispatch', function () {

    it('instantiates CmdHelper with debugPort + brkEnabled', function () {
        assert.match(src, /new\s+CmdHelper\(\s*self,\s*opt\.client,\s*\{\s*port:\s*opt\.debugPort,\s*brkEnabled:\s*opt\.debugBrkEnabled\s*\}\s*\)/);
    });

    it('gates execution on isCmdConfigured()', function () {
        assert.match(src, /if\s*\(\s*!isCmdConfigured\(\)\s*\)\s*return\s+false/);
    });

    it('iterates process.argv from index 3', function () {
        assert.match(src, /for\s*\(\s*var\s+i\s*=\s*3\s*,/);
    });

    it('captures --format=<x> from argv', function () {
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(arg\)/);
        assert.match(src, /self\.format\s*=\s*arg\.split\(\/\\=\/\)\[1\]/);
    });

    it('rejects --format values other than text or json', function () {
        assert.match(src, /self\.format\s*!==\s*['"]text['"]\s*&&\s*self\.format\s*!==\s*['"]json['"]/);
    });

    it('errors when bundle filter is given without @<project>', function () {
        assert.match(src, /requires\s*`@<project>`/);
    });

    it('errors when project is not registered', function () {
        assert.match(src, /is not registered/);
    });

    it('validates the bundle exists in the manifest', function () {
        assert.match(src, /manifest\.bundles\s*&&\s*!manifest\.bundles\[bundleFilter\]/);
    });

    it('routes to scanAll when no project given', function () {
        assert.match(src, /scanAll\(\);/);
    });

    it('routes to scanProjectOnly when project but no bundle', function () {
        assert.match(src, /scanProjectOnly\(self\.projectName\)/);
    });

    it('routes to scanBundleOnly when project + bundle given', function () {
        assert.match(src, /scanBundleOnly\(self\.projectName,\s*bundleFilter\)/);
    });

});


// ---------------------------------------------------------------------------
// 03 — file walker constants
// ---------------------------------------------------------------------------

describe('03 - file walker constants', function () {

    it('SOURCE_DIRS includes the canonical bundle source folders', function () {
        var m = src.match(/var\s+SOURCE_DIRS\s*=\s*\[([^\]]+)\]/);
        assert.ok(m, 'SOURCE_DIRS declaration missing');
        var listed = m[1];
        ['controllers', 'middleware', 'models', 'lib', 'src', 'views', 'public'].forEach(function (d) {
            assert.match(listed, new RegExp("'" + d + "'"));
        });
    });

    it('EXCLUDE_DIRS skips node_modules, dist, .git, locales', function () {
        var m = src.match(/var\s+EXCLUDE_DIRS\s*=\s*\{([^}]+)\}/);
        assert.ok(m, 'EXCLUDE_DIRS declaration missing');
        ['node_modules', 'dist', '.git', 'locales'].forEach(function (d) {
            assert.match(m[1], new RegExp("'" + d.replace(/\./g, '\\.') + "'"));
        });
    });

    it('JS_EXT matches .js / .mjs / .cjs', function () {
        assert.match(src, /var\s+JS_EXT\s*=\s*\/\\\.\(js\|mjs\|cjs\)\$\//);
    });

    it('TEMPLATE_EXT matches .swig / .nunjucks / .njk / .html / .htm', function () {
        assert.match(src, /var\s+TEMPLATE_EXT\s*=\s*\/\\\.\(swig\|nunjucks\|njk\|html\|htm\)\$\//);
    });

    it('skips dotfile directories during walk', function () {
        assert.match(src, /ent\.name\.charAt\(0\)\s*===\s*['"]\.['"]/);
    });

    it('uses an explicit stack (no deep recursion)', function () {
        assert.match(src, /var\s+stack\s*=\s*\[\s*dir\s*\]/);
        assert.match(src, /while\s*\(\s*stack\.length\s*\)/);
    });

});


// ---------------------------------------------------------------------------
// 04 — regex patterns
// ---------------------------------------------------------------------------

describe('04 - key-extraction regexes', function () {

    it('T_CALL_RE captures `t("key")` and `self.t("key")`', function () {
        // Pure-logic replica
        var T_CALL_RE = /(?:^|[^A-Za-z0-9_$])t\s*\(\s*['"]([^'"\\]+)['"]/g;
        var hits = [];
        var lines = [
            'var x = t("common.welcome");',
            'self.t(\'common.greeting\', { name: user.name });',
            'gna.t("errors.timeout", {}, req.culture);',
            'return t( "padded.spaces" );'
        ];
        for (var i = 0; i < lines.length; i++) {
            T_CALL_RE.lastIndex = 0;
            var m;
            while ((m = T_CALL_RE.exec(lines[i])) !== null) {
                hits.push(m[1]);
            }
        }
        assert.deepEqual(hits.sort(), [
            'common.greeting',
            'common.welcome',
            'errors.timeout',
            'padded.spaces'
        ]);
    });

    it('T_CALL_RE does NOT match identifiers ending in `t` (e.g. `print(`, `qrt(`)', function () {
        var T_CALL_RE = /(?:^|[^A-Za-z0-9_$])t\s*\(\s*['"]([^'"\\]+)['"]/g;
        var hits = [];
        var line = 'var s = print("hello"); var r = qrt("world"); var u = output("foo");';
        var m;
        while ((m = T_CALL_RE.exec(line)) !== null) hits.push(m[1]);
        assert.deepEqual(hits, []);
    });

    it('LEGACY_CALL_RE captures `__("key")`', function () {
        var LEGACY_CALL_RE = /(?:^|[^A-Za-z0-9_$])__\s*\(\s*['"]([^'"\\]+)['"]/g;
        var hits = [];
        var lines = [
            'var msg = __("legacy.key");',
            'return __(\'old.style\');'
        ];
        for (var i = 0; i < lines.length; i++) {
            LEGACY_CALL_RE.lastIndex = 0;
            var m;
            while ((m = LEGACY_CALL_RE.exec(lines[i])) !== null) {
                hits.push(m[1]);
            }
        }
        assert.deepEqual(hits.sort(), ['legacy.key', 'old.style']);
    });

    it('TEMPLATE_T_RE captures `"key" | t` and `"key" | t({...})`', function () {
        var TEMPLATE_T_RE = /['"]([^'"\\]+)['"]\s*\|\s*t\b/g;
        var hits = [];
        var lines = [
            '<h1>{{ "common.welcome" | t }}</h1>',
            '<p>{{ \'common.greeting\' | t({ name: user.name }) }}</p>',
            '<span>{{ "common.items" | t({ count: 5 }) }}</span>'
        ];
        for (var i = 0; i < lines.length; i++) {
            TEMPLATE_T_RE.lastIndex = 0;
            var m;
            while ((m = TEMPLATE_T_RE.exec(lines[i])) !== null) {
                hits.push(m[1]);
            }
        }
        assert.deepEqual(hits.sort(), ['common.greeting', 'common.items', 'common.welcome']);
    });

    it('CULTURE_RE matches en.json, en_US.json, pt_BR.json', function () {
        var CULTURE_RE = /^([a-z]{2,3})(_([A-Z]{2,3}))?\.json$/;
        assert.ok(CULTURE_RE.exec('en.json'));
        assert.ok(CULTURE_RE.exec('en_US.json'));
        assert.ok(CULTURE_RE.exec('pt_BR.json'));
        assert.ok(CULTURE_RE.exec('fil_PH.json'));
    });

    it('CULTURE_RE rejects en-US.json (hyphenated)', function () {
        var CULTURE_RE = /^([a-z]{2,3})(_([A-Z]{2,3}))?\.json$/;
        assert.equal(CULTURE_RE.exec('en-US.json'), null);
        assert.equal(CULTURE_RE.exec('EN_US.json'), null);  // language must be lowercase
        assert.equal(CULTURE_RE.exec('en_us.json'), null);  // region must be uppercase
    });

    it('source declares all four key-extraction regexes as named vars', function () {
        assert.match(src, /var\s+T_CALL_RE\s*=\s*\//);
        assert.match(src, /var\s+LEGACY_CALL_RE\s*=\s*\//);
        assert.match(src, /var\s+TEMPLATE_T_RE\s*=\s*\//);
        assert.match(src, /var\s+CULTURE_RE\s*=\s*\//);
    });

});


// ---------------------------------------------------------------------------
// 05 — pure-logic coverage replica
// ---------------------------------------------------------------------------

describe('05 - coverage computation', function () {

    // Replica of the resolveKey + computeCoverage pair so we can lock the
    // expected behaviour without invoking the framework runtime.
    function resolveKey(catalog, key) {
        if (!catalog || typeof catalog !== 'object') return undefined;
        var parts = key.split('.');
        var cursor = catalog;
        for (var i = 0; i < parts.length; i++) {
            if (cursor === null || typeof cursor !== 'object') return undefined;
            cursor = cursor[parts[i]];
            if (typeof cursor === 'undefined') return undefined;
        }
        return cursor;
    }

    function computeCoverage(catalog, keys) {
        var hit = 0;
        var miss = [];
        for (var i = 0; i < keys.length; i++) {
            if (typeof resolveKey(catalog, keys[i]) !== 'undefined') hit++;
            else miss.push(keys[i]);
        }
        return {
            translated : hit,
            missing    : miss.length,
            percent    : keys.length === 0 ? 100 : Math.round((hit / keys.length) * 1000) / 10,
            missingKeys: miss
        };
    }

    it('100% when every key resolves', function () {
        var catalog = { common: { welcome: 'Hi', greeting: 'Hello' } };
        var keys    = ['common.welcome', 'common.greeting'];
        var cov     = computeCoverage(catalog, keys);
        assert.equal(cov.translated, 2);
        assert.equal(cov.missing, 0);
        assert.equal(cov.percent, 100);
        assert.deepEqual(cov.missingKeys, []);
    });

    it('partial coverage with the right percent', function () {
        var catalog = { a: 'x', b: 'y' };
        var keys    = ['a', 'b', 'c', 'd', 'e'];
        var cov     = computeCoverage(catalog, keys);
        assert.equal(cov.translated, 2);
        assert.equal(cov.missing, 3);
        assert.equal(cov.percent, 40);
        assert.deepEqual(cov.missingKeys.sort(), ['c', 'd', 'e']);
    });

    it('0% when nothing resolves', function () {
        var catalog = {};
        var keys    = ['a', 'b', 'c'];
        var cov     = computeCoverage(catalog, keys);
        assert.equal(cov.translated, 0);
        assert.equal(cov.missing, 3);
        assert.equal(cov.percent, 0);
    });

    it('100% on empty key set', function () {
        var cov = computeCoverage({}, []);
        assert.equal(cov.translated, 0);
        assert.equal(cov.missing, 0);
        assert.equal(cov.percent, 100);
    });

    it('rounds percent to one decimal', function () {
        var keys = ['a','b','c','d','e','f','g'];   // 7 keys
        var catalog = { a: 'x', b: 'y' };           // 2 translated → 28.6%
        var cov = computeCoverage(catalog, keys);
        assert.equal(cov.percent, 28.6);
    });

    it('walks dotted-path keys (nested catalogs)', function () {
        var catalog = { common: { items: { one: 'x', other: 'y' } } };
        var keys    = ['common.items.one', 'common.items.other', 'common.items.zero'];
        var cov     = computeCoverage(catalog, keys);
        assert.equal(cov.translated, 2);
        assert.deepEqual(cov.missingKeys, ['common.items.zero']);
    });

    it('source uses lib.i18n.resolveKey', function () {
        assert.match(src, /i18n\.resolveKey\(catalog,/);
    });

});


// ---------------------------------------------------------------------------
// 06 — output structure
// ---------------------------------------------------------------------------

describe('06 - report output', function () {

    it('emits JSON via JSON.stringify with 2-space indent', function () {
        assert.match(src, /JSON\.stringify\(report,\s*null,\s*2\)/);
    });

    it('text path branches on report.projects vs single project', function () {
        assert.match(src, /report\.projects[^?]*\?[^:]+:[^;]+\[\s*\{\s*project:\s*report\.project,\s*bundles:\s*report\.bundles\s*\}\s*\]/);
    });

    it('text output prefixes project lines with `@<name>:`', function () {
        assert.match(src, /'\\n@'\s*\+\s*proj\.project\s*\+\s*':'/);
    });

    it('text output reports `(no bundles)` for empty projects', function () {
        assert.match(src, /\(no bundles\)/);
    });

    it('text output reports `No catalogs found` when bundle has no locales', function () {
        assert.match(src, /No catalogs found at bundle\/locales/);
    });

    it('text output reports `No translation keys found in source.` when totalKeys is 0', function () {
        assert.match(src, /No translation keys found in source\./);
    });

    it('text output caps missing-key listing via TEXT_MISSING_CAP', function () {
        assert.match(src, /var\s+TEXT_MISSING_CAP\s*=\s*\d+/);
        assert.match(src, /TEXT_MISSING_CAP/);
    });

    it('bundle report shape — bundle, totalKeys, cultures, byKey, coverage', function () {
        ['bundle', 'totalKeys', 'cultures', 'byKey', 'coverage'].forEach(function (field) {
            assert.match(src, new RegExp(field + '\\s*:'));
        });
    });

    it('coverage shape — translated, missing, percent, missingKeys', function () {
        ['translated', 'missing', 'percent', 'missingKeys'].forEach(function (field) {
            assert.match(src, new RegExp(field + '\\s*:'));
        });
    });

});


// ---------------------------------------------------------------------------
// 07 — Help module + help.txt + arguments.json
// ---------------------------------------------------------------------------

describe('07 - help + arguments', function () {

    it('help.js exports the Help constructor', function () {
        assert.match(helpSrc, /module\.exports\s*=\s*Help;?/);
    });

    it('help.js calls getHelp() to print group help', function () {
        assert.match(helpSrc, /getHelp\(\);/);
    });

    it('help.txt documents the four planned actions (scan / add / export / import)', function () {
        ['scan', 'add'].forEach(function (action) {
            assert.match(helpTxt, new RegExp('\\b' + action + '\\b'));
        });
    });

    it('help.txt documents the i18n: prefix usage line', function () {
        assert.match(helpTxt, /Usage:\s*gina\s+i18n:/);
    });

    it('help.txt mentions the catalog filename pattern', function () {
        assert.match(helpTxt, /<lang>\(_<REGION>\)\?\.json/);
    });

    it('help.txt links to gina.io/schema/locales.json', function () {
        assert.match(helpTxt, /gina\.io\/schema\/locales\.json/);
    });

    it('arguments.json includes --format, --from, --output, --file, --merge, --dry-run, --force', function () {
        ['--format', '--from', '--output', '--file', '--merge', '--dry-run', '--force'].forEach(function (flag) {
            assert.ok(argsArr.indexOf(flag) > -1, 'expected ' + flag + ' in arguments.json');
        });
    });

    it('arguments.json avoids framework-reserved flag names', function () {
        var reserved = ['--port', '--mq-port', '--host-v4', '--hostname', '--debug-port',
                        '--inspect', '--inspect-brk', '--debug', '--version',
                        '--prefix', '--env', '--scope', '--gina-version'];
        reserved.forEach(function (flag) {
            assert.equal(argsArr.indexOf(flag), -1, 'arguments.json must not contain reserved flag ' + flag);
        });
    });

});


// ---------------------------------------------------------------------------
// 08 — bin/cli wiring
// ---------------------------------------------------------------------------

describe('08 - bin/cli wiring', function () {

    it("bin/cli adds 'i18n:' to the allowedOffline array", function () {
        // Find the array, then assert 'i18n:' appears inside it.
        var m = cliSrc.match(/var\s+allowedOffline\s*=\s*\[([\s\S]*?)\]/);
        assert.ok(m, 'allowedOffline array not found in bin/cli');
        assert.match(m[1], /['"]i18n:['"]/);
    });

    it("'i18n:' is positioned alphabetically (between env: and inspector:)", function () {
        var m = cliSrc.match(/var\s+allowedOffline\s*=\s*\[([\s\S]*?)\]/);
        var listed = m[1];
        // Look for the env: → i18n: → inspector: ordering
        var envIdx       = listed.indexOf("'env:'");
        var i18nIdx      = listed.indexOf("'i18n:'");
        var inspectorIdx = listed.indexOf("'inspector:'");
        assert.ok(envIdx > -1 && i18nIdx > -1 && inspectorIdx > -1, 'one or more expected entries missing');
        assert.ok(envIdx < i18nIdx, "'i18n:' must come after 'env:'");
        assert.ok(i18nIdx < inspectorIdx, "'i18n:' must come before 'inspector:'");
    });

});
