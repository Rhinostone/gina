'use strict';

/**
 * core/config.js — templates.json pre-process pass (gina-io/gina#8 + #10).
 *
 * Runs once per bundle right after the bundle config files are loaded, BEFORE
 * the routing<->template GET auto-vivify and the _common / per-section merge
 * loops, so every downstream consumer sees fully-expanded single-section keys.
 *
 *   #8  — comma-separated section keys ("a, b": { ... }) replicate the block
 *         under each named section, merging into any section that already
 *         exists (a section's own keys win over the shared block).
 *   #10 — an optional `_common.config` block is flattened back into `_common`
 *         (direct `_common.*` keys win over `_common.config.*`).
 *
 * Sections:
 *   01 — source pins: the pre-process block exists in config.js with the right shape
 *   02 — #8 comma-split behaviour (pure-logic replica using the real `merge`)
 *   03 — #10 `_common.config` flatten
 *   04 — backward-compat no-ops (no comma key / no `_common.config`)
 */

var path   = require('path');
var fs     = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW         = require('../fw');
var CONFIG_SRC = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');
var merge      = require(path.join(FW, 'lib/merge'));

// Deep-clone mirror of config.js's `JSON.clone(_block)` (plain JSON config objects).
var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

// Pure-logic replica of the inline pre-process block in config.js. Mirrors the
// source line-for-line and uses the SAME framework `merge` so precedence matches
// production. Section 01 pins the source so this replica cannot silently drift.
var preprocessTemplates = function (templates) {
    if (typeof templates === 'undefined' || templates === null) { return templates; }

    // #10
    if (typeof templates._common !== 'undefined' && typeof templates._common.config !== 'undefined') {
        templates._common = merge(templates._common, templates._common.config);
        delete templates._common.config;
    }

    // #8
    var commaKeys = [];
    for (var k in templates) { if (k.indexOf(',') > -1) { commaKeys.push(k); } }
    for (var i = 0; i < commaKeys.length; i++) {
        var key      = commaKeys[i];
        var block    = templates[key];
        var sections = key.split(/\s*,\s*/);
        for (var s = 0; s < sections.length; s++) {
            var section = sections[s].trim();
            if (!section) { continue; }
            templates[section] = (typeof templates[section] !== 'undefined')
                ? merge(templates[section], clone(block))
                : clone(block);
        }
        delete templates[key];
    }
    return templates;
};

// ---------------------------------------------------------------------------
// 01 — source pins
// ---------------------------------------------------------------------------
describe('01 - source pins (config.js carries the pre-process block)', function () {

    it('#10 flatten: merges _common.config into _common then deletes it', function () {
        assert.match(CONFIG_SRC, /files\['templates'\]\._common\s*=\s*merge\(files\['templates'\]\._common,\s*files\['templates'\]\._common\.config\)/);
        assert.match(CONFIG_SRC, /delete files\['templates'\]\._common\.config/);
    });

    it('#8 split: collects comma keys, splits on /\\s*,\\s*/, merges, deletes the comma key', function () {
        assert.match(CONFIG_SRC, /_commaKeys/);
        assert.match(CONFIG_SRC, /\.indexOf\(','\)\s*>\s*-1/);
        assert.match(CONFIG_SRC, /\.split\(\/\\s\*,\\s\*\/\)/);
        assert.match(CONFIG_SRC, /merge\(files\['templates'\]\[_section\],\s*JSON\.clone\(_block\)\)/);
        assert.match(CONFIG_SRC, /delete files\['templates'\]\[_key\]/);
    });

    it('runs before the GET auto-vivify (placement invariant)', function () {
        var preIdx   = CONFIG_SRC.indexOf('_commaKeys');
        var vivifyIdx = CONFIG_SRC.indexOf("files['templates'][rule.toLowerCase()] = {}");
        assert.ok(preIdx > -1 && vivifyIdx > -1, 'both anchors present');
        assert.ok(preIdx < vivifyIdx, 'pre-process must precede the routing auto-vivify');
    });
});

// ---------------------------------------------------------------------------
// 02 — #8 comma-split behaviour
// ---------------------------------------------------------------------------
describe('02 - #8 comma-separated section keys', function () {

    it('replicates a block under each named section and removes the comma key', function () {
        var t = preprocessTemplates({ 'factsheets, factsheetsentry': { stylesheets: ['a.css'] } });
        assert.deepEqual(t.factsheets, { stylesheets: ['a.css'] });
        assert.deepEqual(t.factsheetsentry, { stylesheets: ['a.css'] });
        assert.equal(typeof t['factsheets, factsheetsentry'], 'undefined');
    });

    it('clones (sections do not share the same object reference)', function () {
        var t = preprocessTemplates({ 'a, b': { stylesheets: ['x.css'] } });
        assert.notEqual(t.a, t.b);
        t.a.stylesheets.push('mutated.css');
        assert.deepEqual(t.b.stylesheets, ['x.css'], 'mutating a must not affect b');
    });

    it('merges into an existing standalone section (union of keys)', function () {
        var t = preprocessTemplates({
            'factsheets, factsheetsentry': { stylesheets: ['page.css'] },
            'factsheetsentry':             { javascripts: ['payroll.js'] }
        });
        assert.deepEqual(t.factsheets, { stylesheets: ['page.css'] });
        assert.deepEqual(t.factsheetsentry, { javascripts: ['payroll.js'], stylesheets: ['page.css'] });
    });

    it("a section's own keys win over the shared block on collision", function () {
        var t = preprocessTemplates({
            'a, b': { theme: 'shared' },
            'b':    { theme: 'own' }
        });
        assert.equal(t.a.theme, 'shared');
        assert.equal(t.b.theme, 'own');
    });

    it('trims whitespace around each section name', function () {
        var t = preprocessTemplates({ 'a , b ': { theme: 't' } });
        assert.ok(t.a && t.b, 'both trimmed sections exist');
        assert.equal(typeof t['b '], 'undefined');
    });

    it('skips empty segments (trailing / double commas)', function () {
        var t = preprocessTemplates({ 'a,,b,': { theme: 't' } });
        assert.deepEqual(Object.keys(t).sort(), ['a', 'b']);
        assert.equal(typeof t[''], 'undefined');
    });

    it('handles two comma keys targeting the same section (first wins, both removed)', function () {
        var t = preprocessTemplates({
            'a, b': { theme: 'fromAB' },
            'b, c': { theme: 'fromBC' }
        });
        assert.deepEqual(Object.keys(t).sort(), ['a', 'b', 'c']);
        assert.equal(t.b.theme, 'fromAB', 'first-processed comma key wins on collision');
    });
});

// ---------------------------------------------------------------------------
// 03 — #10 _common.config flatten
// ---------------------------------------------------------------------------
describe('03 - #10 _common.config flatten', function () {

    it('flattens _common.config into _common and removes the config block', function () {
        var t = preprocessTemplates({ _common: { routeNameAsFilenameEnabled: true, config: { javascriptsDeferEnabled: true } } });
        assert.equal(t._common.routeNameAsFilenameEnabled, true);
        assert.equal(t._common.javascriptsDeferEnabled, true);
        assert.equal(typeof t._common.config, 'undefined');
    });

    it('direct _common.* keys win over _common.config.*', function () {
        var t = preprocessTemplates({ _common: { theme: 'direct', config: { theme: 'cfg' } } });
        assert.equal(t._common.theme, 'direct');
    });

    it('leaves _common untouched when there is no config block', function () {
        var t = preprocessTemplates({ _common: { theme: 'x' } });
        assert.deepEqual(t._common, { theme: 'x' });
    });
});

// ---------------------------------------------------------------------------
// 04 — backward-compat no-ops
// ---------------------------------------------------------------------------
describe('04 - backward-compat no-ops', function () {

    it('a templates object with no comma key and no _common.config is unchanged', function () {
        var input = {
            _common: { stylesheets: [{ url: '/css/public.css' }] },
            home:    { stylesheets: [{ url: '/css/home.css' }] },
            login:   { javascripts: ['/js/login.js'] }
        };
        var expected = clone(input);
        assert.deepEqual(preprocessTemplates(input), expected);
    });

    it('tolerates undefined / null templates', function () {
        assert.equal(preprocessTemplates(undefined), undefined);
        assert.equal(preprocessTemplates(null), null);
    });
});
