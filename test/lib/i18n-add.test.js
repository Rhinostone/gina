/**
 * lib/cmd/i18n/add.js — argv parsing, source-culture resolution, seed
 * transformation (string + plural + nested), guarded write path, and
 * per-bundle iteration for project-wide seeding.
 *
 * Source-inspection tests + a pure-logic replica of `seedCatalog` and a
 * sandbox write smoke test (key-order preservation, indent, trailing
 * newline). Mirrors the connector-add.test.js style: add.js itself runs
 * inside the CLI daemon context and is not invoked here.
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var ADD_SOURCE = path.join(require('../fw'), 'lib/cmd/i18n/add.js');

var src = fs.readFileSync(ADD_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Add constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Add;?/);
    });

    it('declares a function Add(opt, cmd)', function () {
        assert.match(src, /function\s+Add\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('requires CmdHelper from ./../helper', function () {
        assert.match(src, /var\s+CmdHelper\s*=\s*require\(\s*['"]\.\/?\.\.\/helper['"]/);
    });

    it('binds console = lib.logger', function () {
        assert.match(src, /var\s+console\s*=\s*lib\.logger/);
    });

    it('initialises self with from / force / dryRun defaults', function () {
        assert.match(src, /var\s+self\s*=\s*\{\s*from:\s*null,\s*force:\s*false,\s*dryRun:\s*false\s*\}/);
    });

    it('declares TODO_PREFIX = "[TODO] "', function () {
        assert.match(src, /var\s+TODO_PREFIX\s*=\s*['"]\[TODO\]\s+['"]/);
    });

    it('declares CULTURE_RE for <lang>(_<REGION>)? validation', function () {
        assert.match(src, /var\s+CULTURE_RE\s*=\s*\/\^\[a-z\]\{2,3\}\(_\[A-Z\]\{2,3\}\)\?\$\//);
    });

    it('calls init() at the bottom of the constructor', function () {
        assert.match(src, /init\(\);\s*\}\s*module\.exports\s*=\s*Add/);
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

    it('parses --from=<culture>', function () {
        assert.match(src, /\/\^\\-\\-from\\=\/\.test\(arg\)/);
    });

    it('validates --from value via CULTURE_RE', function () {
        assert.match(src, /Invalid --from culture/);
    });

    it('parses --force', function () {
        assert.match(src, /arg\s*===\s*['"]--force['"]/);
    });

    it('parses --dry-run', function () {
        assert.match(src, /arg\s*===\s*['"]--dry-run['"]/);
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

    it('routes to addProjectOnly when no bundle given', function () {
        assert.match(src, /addProjectOnly\(self\.projectName,\s*culture\)/);
    });

    it('routes to addBundleOnly when bundle is given', function () {
        assert.match(src, /addBundleOnly\(self\.projectName,\s*bundleName,\s*culture\)/);
    });

});


// ---------------------------------------------------------------------------
// 03 — source-culture resolution
// ---------------------------------------------------------------------------

describe('03 - source culture resolution', function () {

    it('resolveSourceCulture is declared', function () {
        assert.match(src, /var\s+resolveSourceCulture\s*=\s*function/);
    });

    it('priority 1: --from flag wins', function () {
        assert.match(src, /if\s*\(\s*self\.from\s*\)\s*return\s+self\.from/);
    });

    it('priority 2: settings.region.culture from <bundle>/config/settings.json', function () {
        assert.match(src, /['"]config['"]\s*,\s*['"]settings\.json['"]/);
        assert.match(src, /settings\.region\.culture/);
    });

    it('priority 3: process.env.GINA_CULTURE', function () {
        assert.match(src, /process\.env\.GINA_CULTURE/);
    });

    it('priority 4: DEFAULT_FALLBACK_CULTURE = "en"', function () {
        assert.match(src, /var\s+DEFAULT_FALLBACK_CULTURE\s*=\s*['"]en['"]/);
        assert.match(src, /return\s+DEFAULT_FALLBACK_CULTURE/);
    });

});


// ---------------------------------------------------------------------------
// 04 — seedCatalog transform (pure-logic replica)
// ---------------------------------------------------------------------------

describe('04 - seedCatalog transform', function () {

    var TODO_PREFIX = '[TODO] ';

    function seedCatalog(source) {
        if (typeof source === 'string') return TODO_PREFIX + source;
        if (source === null || typeof source !== 'object' || Array.isArray(source)) return source;
        var out  = {};
        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; i++) {
            out[keys[i]] = seedCatalog(source[keys[i]]);
        }
        return out;
    }

    it('prefixes a flat string value', function () {
        assert.equal(seedCatalog('Welcome!'), '[TODO] Welcome!');
    });

    it('walks a nested object', function () {
        var input  = { common: { welcome: 'Hi', greeting: 'Hello, {name}!' } };
        var output = seedCatalog(input);
        assert.equal(output.common.welcome, '[TODO] Hi');
        assert.equal(output.common.greeting, '[TODO] Hello, {name}!');
    });

    it('walks plural-form objects (every CLDR key gets prefixed)', function () {
        var input = { items: { one: '{count} item', other: '{count} items' } };
        var output = seedCatalog(input);
        assert.equal(output.items.one, '[TODO] {count} item');
        assert.equal(output.items.other, '[TODO] {count} items');
    });

    it('preserves source key order', function () {
        var input  = { c: 'C', a: 'A', b: 'B' };
        var output = seedCatalog(input);
        assert.deepEqual(Object.keys(output), ['c', 'a', 'b']);
    });

    it('passes through non-string, non-object leaves (numbers, booleans, null)', function () {
        assert.equal(seedCatalog(42), 42);
        assert.equal(seedCatalog(true), true);
        assert.equal(seedCatalog(null), null);
    });

    it('passes through arrays unchanged (catalogs do not use array values)', function () {
        var arr = ['a', 'b'];
        assert.equal(seedCatalog(arr), arr);
    });

    it('source declares seedCatalog', function () {
        assert.match(src, /var\s+seedCatalog\s*=\s*function\s*\(\s*source\s*\)/);
    });

    it('source uses TODO_PREFIX inside seedCatalog', function () {
        assert.match(src, /TODO_PREFIX\s*\+\s*source/);
    });

});


// ---------------------------------------------------------------------------
// 05 — write path & guards
// ---------------------------------------------------------------------------

describe('05 - addBundle write path', function () {

    it('declares addBundle(projectPath, bundleName, culture)', function () {
        assert.match(src, /var\s+addBundle\s*=\s*function\s*\(\s*projectPath,\s*bundleName,\s*culture\s*\)/);
    });

    it('refuses when source culture equals target culture', function () {
        assert.match(src, /sourceCulture\s*===\s*culture/);
        assert.match(src, /same as the target/);
    });

    it('errors when source catalog file is missing', function () {
        assert.match(src, /no source catalog at/);
    });

    it('errors on malformed source JSON', function () {
        assert.match(src, /cannot parse source catalog/);
    });

    it('errors when source root is not an object', function () {
        assert.match(src, /catalog root must be an object/);
    });

    it('refuses overwriting an existing target unless --force', function () {
        assert.match(src, /target catalog already exists/);
        assert.match(src, /re-run with --force to overwrite/);
    });

    it('honours --dry-run by skipping the disk write', function () {
        assert.match(src, /\[dry-run\] would write/);
    });

    it('creates locales/ dir if missing (recursive mkdir)', function () {
        assert.match(src, /fs\.mkdirSync\(localesDir,\s*\{\s*recursive:\s*true\s*\}\)/);
    });

    it('writes via lib.generator.createFileFromDataSync', function () {
        assert.match(src, /lib\.generator\.createFileFromDataSync\(body,\s*targetPath\)/);
    });

    it('serialises with 4-space indent + trailing newline', function () {
        assert.match(src, /JSON\.stringify\(targetData,\s*null,\s*4\)\s*\+\s*['"]\\n['"]/);
    });

});


// ---------------------------------------------------------------------------
// 06 — multi-bundle iteration (addProjectOnly)
// ---------------------------------------------------------------------------

describe('06 - addProjectOnly', function () {

    it('declares addProjectOnly(projectName, culture)', function () {
        assert.match(src, /var\s+addProjectOnly\s*=\s*function\s*\(\s*projectName,\s*culture\s*\)/);
    });

    it('reads manifest.bundles and iterates sorted', function () {
        assert.match(src, /Object\.keys\(manifest\.bundles\)\.sort\(\)/);
    });

    it('errors when project has no manifest or no bundles', function () {
        assert.match(src, /no manifest\.json or no bundles registered/);
    });

    it('reports per-bundle ok/fail counts at end', function () {
        assert.match(src, /bundle\(s\) seeded/);
        assert.match(src, /skipped/);
    });

});


// ---------------------------------------------------------------------------
// 07 — sandbox write smoke (end-to-end transform + write check)
// ---------------------------------------------------------------------------

describe('07 - sandbox seed write', function () {

    function seedCatalog(source) {
        if (typeof source === 'string') return '[TODO] ' + source;
        if (source === null || typeof source !== 'object' || Array.isArray(source)) return source;
        var out  = {};
        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; i++) {
            out[keys[i]] = seedCatalog(source[keys[i]]);
        }
        return out;
    }

    it('a transformed catalog round-trips JSON.parse with the [TODO] prefix in place', function () {
        var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-i18n-add-'));
        try {
            var sourceData = {
                common: {
                    welcome : 'Welcome!',
                    greeting: 'Hello, {name}!',
                    items   : { one: '{count} item', other: '{count} items' }
                },
                errors: { notFound: 'Not found' }
            };
            var targetPath = path.join(tmp, 'fr.json');
            var body       = JSON.stringify(seedCatalog(sourceData), null, 4) + '\n';
            fs.writeFileSync(targetPath, body, 'utf8');

            var written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
            assert.equal(written.common.welcome,  '[TODO] Welcome!');
            assert.equal(written.common.greeting, '[TODO] Hello, {name}!');
            assert.equal(written.common.items.one,   '[TODO] {count} item');
            assert.equal(written.common.items.other, '[TODO] {count} items');
            assert.equal(written.errors.notFound, '[TODO] Not found');
        } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        }
    });

    it('serialised body ends with a trailing newline', function () {
        var body = JSON.stringify(seedCatalog({ a: 'b' }), null, 4) + '\n';
        assert.equal(body.charAt(body.length - 1), '\n');
    });

    it('serialised body uses 4-space indent', function () {
        var body = JSON.stringify(seedCatalog({ a: 'b' }), null, 4) + '\n';
        // 2nd line should be indented 4 spaces
        var lines = body.split('\n');
        assert.match(lines[1], /^    "a"/);
    });

});
