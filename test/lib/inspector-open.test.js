/**
 * lib/cmd/inspector/open.js — argv parsing and Inspector URL resolution
 *
 * Source-inspection tests matching bundle-start.test.js precedent: open.js
 * runs inside the CLI daemon context (CmdHelper, project registry, global
 * helpers injected by gna.js). Replicating that is heavy for near-zero extra
 * coverage, so these assertions prove the source structure of:
 *
 *   (a) Positional http(s) URL detection → targetOverride + trailing-slash strip
 *   (b) --port / URL target shortcut through bundle validation + port lookup
 *   (c) resolveInspectorBase() 4-step resolution: --url → bundle settings →
 *       global settings → null (embedded fallback)
 *   (d) buildInspectorUrl() shape: <base>/?target=<encoded> or
 *       <target>/_gina/inspector/?target=<encoded>
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var OPEN_SOURCE = path.join(require('../fw'), 'lib/cmd/inspector/open.js');
var src = fs.readFileSync(OPEN_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — argv loop: positional http(s) URL → targetOverride
// ---------------------------------------------------------------------------

describe('01 - positional URL argv branch', function () {

    it('matches ^https?:// on positional args', function () {
        assert.match(src, /else if \(\/\^https\?:\\\/\\\/\/i\.test\(arg\)\)/);
    });

    it('assigns to targetOverride with trailing slashes stripped', function () {
        assert.match(src, /targetOverride = arg\.replace\(\/\\\/\+\$\/, ''\);/);
    });

    it('declares targetOverride in the override var block', function () {
        assert.match(src, /var targetOverride\s*=\s*null;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — Validation / port lookup skipped in URL target mode
// ---------------------------------------------------------------------------

describe('02 - URL target short-circuits bundle resolution', function () {

    it('skips CmdHelper isCmdConfigured when portOverride or targetOverride set', function () {
        assert.match(src, /if \(!portOverride && !targetOverride\) \{/);
    });

    it('skips ports.reverse.json lookup in URL target mode', function () {
        assert.match(src, /if \(!portOverride && !targetOverride && bundleName\) \{/);
    });

    it('keeps localhost:<port> fallback only when no URL target', function () {
        assert.match(src, /if \(!port && !targetOverride\) \{\s*port = 3100;/);
    });

    it('builds target from targetOverride when present', function () {
        assert.match(
            src
          , /var target\s+= targetOverride \|\| \('http:\/\/localhost:' \+ port\);/
        );
    });
});


// ---------------------------------------------------------------------------
// 03 — resolveInspectorBase resolution order
// ---------------------------------------------------------------------------

describe('03 - resolveInspectorBase', function () {

    it('accepts targetOverride in its signature', function () {
        assert.match(
            src
          , /function resolveInspectorBase\(self, bundleName, urlOverride, portOverride, targetOverride\)/
        );
    });

    it('returns urlOverride first', function () {
        var fnIdx = src.indexOf('function resolveInspectorBase(');
        var fnEnd = src.indexOf('\n}\n', fnIdx);
        var body  = src.slice(fnIdx, fnEnd);
        var first = body.indexOf('if (urlOverride) return urlOverride;');
        assert.ok(first !== -1, 'urlOverride short-circuit not found');
    });

    it('gates bundle-settings read on !portOverride && !targetOverride', function () {
        assert.match(
            src
          , /if \(!portOverride && !targetOverride\s+&& bundleName && self\.projectName/
        );
    });

    it('calls readGlobalInspectorUrl after bundle-settings miss', function () {
        var fnIdx = src.indexOf('function resolveInspectorBase(');
        var fnEnd = src.indexOf('\n}\n', fnIdx);
        var body  = src.slice(fnIdx, fnEnd);
        assert.match(body, /var globalUrl = readGlobalInspectorUrl\(\);\s*if \(globalUrl\) return globalUrl;/);
    });

    it('documents the 4-step resolution order in JSDoc', function () {
        var jsdocIdx = src.indexOf('Resolves the Inspector base URL for launch');
        assert.ok(jsdocIdx !== -1, 'resolveInspectorBase JSDoc not found');
        var jsdoc = src.slice(jsdocIdx, jsdocIdx + 1200);
        assert.match(jsdoc, /1\. `urlOverride`/);
        assert.match(jsdoc, /2\. The bundle's `config\/settings\.json > inspector\.url`/);
        assert.match(jsdoc, /3\. Global `~\/\.gina\/\$\{shortVersion\}\/settings\.json > inspector\.url`/);
        assert.match(jsdoc, /4\. `null`/);
    });
});


// ---------------------------------------------------------------------------
// 04 — readGlobalInspectorUrl uses framework env vars
// ---------------------------------------------------------------------------

describe('04 - readGlobalInspectorUrl', function () {

    it('reads GINA_HOMEDIR and GINA_SHORT_VERSION via getEnvVar', function () {
        var fnIdx = src.indexOf('function readGlobalInspectorUrl(');
        assert.ok(fnIdx !== -1, 'readGlobalInspectorUrl not found');
        var fnEnd = src.indexOf('\n}\n', fnIdx);
        var body  = src.slice(fnIdx, fnEnd);
        assert.match(body, /var home\s+= getEnvVar\('GINA_HOMEDIR'\);/);
        assert.match(body, /var shortVersion = getEnvVar\('GINA_SHORT_VERSION'\);/);
    });

    it('joins to settings.json via PathObject _()', function () {
        var fnIdx = src.indexOf('function readGlobalInspectorUrl(');
        var fnEnd = src.indexOf('\n}\n', fnIdx);
        var body  = src.slice(fnIdx, fnEnd);
        assert.match(body, /_\(home \+ '\/' \+ shortVersion \+ '\/settings\.json', true\)/);
    });

    it('parses via requireJSON (comment-tolerant)', function () {
        var fnIdx = src.indexOf('function readGlobalInspectorUrl(');
        var fnEnd = src.indexOf('\n}\n', fnIdx);
        var body  = src.slice(fnIdx, fnEnd);
        assert.match(body, /var globalSettings = requireJSON\(globalPath\);/);
    });

    it('only returns a value when settings.inspector.url is a truthy string', function () {
        var fnIdx = src.indexOf('function readGlobalInspectorUrl(');
        var fnEnd = src.indexOf('\n}\n', fnIdx);
        var body  = src.slice(fnIdx, fnEnd);
        assert.match(body, /if \(globalSettings && globalSettings\.inspector && globalSettings\.inspector\.url\)/);
    });
});


// ---------------------------------------------------------------------------
// 05 — buildInspectorUrl shape (no globals; pure string math)
// ---------------------------------------------------------------------------

describe('05 - buildInspectorUrl', function () {

    it('normalises trailing slashes on inspectorBase', function () {
        assert.match(src, /var base = inspectorBase\.replace\(\/\\\/\+\$\/, ''\) \+ '\/';/);
    });

    it('encodes target into the query string', function () {
        assert.match(src, /return base \+ '\?target=' \+ encodeURIComponent\(target\);/);
    });

    it('falls back to embedded <target>/_gina/inspector/ when no base', function () {
        assert.match(
            src
          , /return target \+ '\/_gina\/inspector\/\?target=' \+ encodeURIComponent\(target\);/
        );
    });
});
