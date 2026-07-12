/**
 * lib/i18n — Locale negotiation primitives + framework wiring (#I18N1 slice 3)
 *
 * Behavioural tests for the new helpers (parseAcceptLanguage, matchAvailable,
 * readCookie, negotiateCulture) plus source-inspection guards for the
 * propagation wiring (lib/routing/src/main.js per-route flag, core/server.js
 * params block + req.culture hook).
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW   = require('../fw');
var i18n = require(path.join(FW, 'lib/i18n/src/main'));

function isolatedBundle(label) {
    var name = 'test-i18n-neg-' + label + '-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    i18n.clearCatalogs(name);
    return name;
}


// ─── 01 — parseAcceptLanguage ──────────────────────────────────────────────

describe('01 - parseAcceptLanguage (RFC 9110-style q-value parsing)', function() {

    it('parses a single tag with no q', function() {
        assert.deepEqual(i18n.parseAcceptLanguage('en'),    [{tag:'en', q:1}]);
        assert.deepEqual(i18n.parseAcceptLanguage('en-US'), [{tag:'en_US', q:1}]);
    });

    it('parses multiple tags ordered by q-value descending', function() {
        var out = i18n.parseAcceptLanguage('en-US,en;q=0.9,fr;q=0.8');
        assert.deepEqual(out, [
            { tag: 'en_US', q: 1 },
            { tag: 'en',    q: 0.9 },
            { tag: 'fr',    q: 0.8 }
        ]);
    });

    it('preserves source order for equal q-values', function() {
        var out = i18n.parseAcceptLanguage('fr;q=0.5,de;q=0.5,es;q=0.5');
        assert.deepEqual(out.map(function(e) { return e.tag; }), ['fr', 'de', 'es']);
    });

    it('drops the wildcard "*"', function() {
        assert.deepEqual(i18n.parseAcceptLanguage('en,*;q=0.1'), [{tag:'en', q:1}]);
    });

    it('handles whitespace gracefully', function() {
        assert.deepEqual(
            i18n.parseAcceptLanguage(' en-US , en ; q = 0.9 , fr ; q = 0.8 '),
            [
                { tag: 'en_US', q: 1 },
                { tag: 'en',    q: 0.9 },
                { tag: 'fr',    q: 0.8 }
            ]
        );
    });

    it('returns [] for empty / nullish input', function() {
        assert.deepEqual(i18n.parseAcceptLanguage(''),        []);
        assert.deepEqual(i18n.parseAcceptLanguage(null),      []);
        assert.deepEqual(i18n.parseAcceptLanguage(undefined), []);
        assert.deepEqual(i18n.parseAcceptLanguage(42),        []);
    });

    it('clamps q-value to [0,1] and ignores malformed', function() {
        // q=2 is invalid → defaults to 1
        var out = i18n.parseAcceptLanguage('fr;q=2,en;q=0.5');
        assert.equal(out[0].tag, 'fr');
        assert.equal(out[0].q,   1);
        assert.equal(out[1].tag, 'en');
        assert.equal(out[1].q,   0.5);
    });

});


// ─── 02 — matchAvailable ───────────────────────────────────────────────────

describe('02 - matchAvailable (best-fit picker)', function() {

    it('picks an exact match when present', function() {
        assert.equal(i18n.matchAvailable(['fr_CA'], ['en', 'fr', 'fr_CA']), 'fr_CA');
    });

    it('falls back to the base language when exact missing', function() {
        assert.equal(i18n.matchAvailable(['fr_CA'], ['en', 'fr']), 'fr');
    });

    it('walks the requested list in order, taking the first match', function() {
        assert.equal(i18n.matchAvailable(['ja', 'fr_CA', 'en'], ['en', 'fr']), 'fr');
    });

    it('returns null when nothing matches', function() {
        assert.equal(i18n.matchAvailable(['ja_JP'], ['en', 'fr']), null);
    });

    it('returns null for empty / non-array inputs', function() {
        assert.equal(i18n.matchAvailable([],         ['en']),      null);
        assert.equal(i18n.matchAvailable(['en'],     []),          null);
        assert.equal(i18n.matchAvailable(null,       ['en']),      null);
        assert.equal(i18n.matchAvailable(['en'],     null),        null);
    });

    it('skips empty-string requested entries', function() {
        assert.equal(i18n.matchAvailable(['', 'fr'], ['fr']), 'fr');
    });

});


// ─── 03 — readCookie ───────────────────────────────────────────────────────

describe('03 - readCookie (single-name extractor)', function() {

    it('extracts a value when present', function() {
        assert.equal(i18n.readCookie('session=abc; gina_culture=fr_CA', 'gina_culture'), 'fr_CA');
    });

    it('handles a single-pair cookie', function() {
        assert.equal(i18n.readCookie('only=value', 'only'), 'value');
    });

    it('returns null when the name is absent', function() {
        assert.equal(i18n.readCookie('a=1; b=2', 'c'), null);
    });

    it('returns null for empty / nullish input', function() {
        assert.equal(i18n.readCookie('',        'x'), null);
        assert.equal(i18n.readCookie(null,      'x'), null);
        assert.equal(i18n.readCookie('a=1',     ''),  null);
        assert.equal(i18n.readCookie('a=1',     null), null);
    });

    it('URL-decodes the value', function() {
        assert.equal(i18n.readCookie('x=fr%5FCA', 'x'), 'fr_CA');
    });

    it('falls back to raw value on decoding error', function() {
        // Malformed percent-escape — shouldn't throw.
        assert.equal(i18n.readCookie('x=%E0%A4%A', 'x'), '%E0%A4%A');
    });

    it('handles whitespace around pairs', function() {
        assert.equal(i18n.readCookie('  session=abc  ;  gina_culture=fr  ', 'gina_culture'), 'fr');
    });

});


// ─── 04 — negotiateCulture ─────────────────────────────────────────────────

describe('04 - negotiateCulture (full chain)', function() {

    it('priority 1 — URL prefix wins when culturePrefix flag + matching available', function() {
        var req = {
            routing: { culturePrefix: true, param: { culture: 'fr' } },
            headers: { 'accept-language': 'de,en;q=0.5' }
        };
        var got = i18n.negotiateCulture(req, { availableCultures: ['en', 'fr', 'de'] });
        assert.equal(got, 'fr');
    });

    it('priority 1 — URL prefix accepts hyphen form (en-US → en_US)', function() {
        var req = {
            routing: { culturePrefix: true, param: { culture: 'en-US' } },
            headers: {}
        };
        var got = i18n.negotiateCulture(req, { availableCultures: ['en', 'en_US', 'fr'] });
        assert.equal(got, 'en_US');
    });

    it('priority 1 — URL prefix skipped when culturePrefix flag is absent', function() {
        var req = {
            routing: { culturePrefix: false, param: { culture: 'fr' } },
            headers: { 'accept-language': 'de;q=0.5,en;q=0.9' }
        };
        var got = i18n.negotiateCulture(req, { availableCultures: ['en', 'fr', 'de'] });
        assert.equal(got, 'en');  // best Accept-Language match
    });

    it('priority 1 — URL prefix skipped when value is not in available cultures', function() {
        var req = {
            routing: { culturePrefix: true, param: { culture: 'ja' } },
            headers: { 'accept-language': 'fr' }
        };
        var got = i18n.negotiateCulture(req, { availableCultures: ['en', 'fr'] });
        assert.equal(got, 'fr');  // falls through to Accept-Language
    });

    it('priority 2 — cookie wins over Accept-Language', function() {
        var req = {
            routing: { culturePrefix: false, param: {} },
            headers: {
                cookie: 'session=x; gina_culture=fr',
                'accept-language': 'en'
            }
        };
        var got = i18n.negotiateCulture(req, {
            availableCultures: ['en', 'fr'],
            cookieName: 'gina_culture'
        });
        assert.equal(got, 'fr');
    });

    it('priority 2 — cookie skipped when value is not in available cultures', function() {
        var req = {
            routing: {},
            headers: { cookie: 'gina_culture=ja', 'accept-language': 'fr' }
        };
        var got = i18n.negotiateCulture(req, {
            availableCultures: ['en', 'fr'],
            cookieName: 'gina_culture'
        });
        assert.equal(got, 'fr');  // falls through to Accept-Language
    });

    it('priority 3 — Accept-Language with q-value ordering wins over default', function() {
        var req = {
            routing: {},
            headers: { 'accept-language': 'ja;q=1.0,fr;q=0.9,en;q=0.5' }
        };
        var got = i18n.negotiateCulture(req, {
            availableCultures: ['en', 'fr'],
            defaultCulture: 'en'
        });
        assert.equal(got, 'fr');  // ja unsupported, fr is next-highest q
    });

    it('priority 4 — defaultCulture wins when no header / cookie / catalog match', function() {
        var req = { routing: {}, headers: {} };
        var got = i18n.negotiateCulture(req, {
            availableCultures: ['en', 'fr'],
            defaultCulture: 'en_US'
        });
        assert.equal(got, 'en_US');
    });

    it('priority 5 — GINA_CULTURE env wins when no defaultCulture', function() {
        // The framework moves GINA_* off process.env into process.gina at init,
        // so negotiateCulture step 5 reads the live getEnvVar accessor (not the
        // deleted process.env.GINA_CULTURE). This file requires lib/i18n in
        // isolation with no framework globals booted, so stub getEnvVar.
        var savedGetEnvVar = global.getEnvVar;
        global.getEnvVar = function(k) { return (k === 'GINA_CULTURE') ? 'fr_FR' : undefined; };
        try {
            var req = { routing: {}, headers: {} };
            assert.equal(i18n.negotiateCulture(req, {}), 'fr_FR');
        } finally {
            if (typeof savedGetEnvVar === 'undefined') delete global.getEnvVar;
            else global.getEnvVar = savedGetEnvVar;
        }
    });

    it('priority 6 — falls back to "en" when nothing else is available', function() {
        var savedEnv = process.env.GINA_CULTURE;
        delete process.env.GINA_CULTURE;
        try {
            var req = { routing: {}, headers: {} };
            assert.equal(i18n.negotiateCulture(req, {}), 'en');
        } finally {
            if (typeof savedEnv !== 'undefined') process.env.GINA_CULTURE = savedEnv;
        }
    });

    it('always returns a non-empty string (defensive against bad inputs)', function() {
        var got = i18n.negotiateCulture(null);
        assert.equal(typeof got, 'string');
        assert.ok(got.length > 0);
    });

    it('normalises hyphenated default cultures to underscore form', function() {
        var req = { routing: {}, headers: {} };
        assert.equal(
            i18n.negotiateCulture(req, { defaultCulture: 'en-US' }),
            'en_US'
        );
    });

});


// ─── 05 — Source-inspection guards on framework wiring ────────────────────

describe('05 - Framework wiring guards', function() {

    var ROUTING_SRC = fs.readFileSync(path.join(FW, 'lib/routing/src/main.js'),  'utf8');
    var SERVER_SRC  = fs.readFileSync(path.join(FW, 'core/server.js'),           'utf8');

    it('lib/routing/src/main.js propagates culturePrefix from routeObject to params', function() {
        // Same shape as the csrfExempt propagation right above it.
        assert.match(ROUTING_SRC, /typeof\(routeObject\.culturePrefix\)\s*!=\s*['"]undefined['"]/);
        assert.match(ROUTING_SRC, /params\.culturePrefix\s*=\s*routeObject\.culturePrefix/);
    });

    it('core/server.js hoists culturePrefix into the request-lifecycle params block', function() {
        // Sibling of `csrfExempt: routing[name].csrfExempt || false`.
        assert.match(SERVER_SRC, /culturePrefix\s*:\s*routing\[name\]\.culturePrefix\s*\|\|\s*false/);
    });

    it('core/server.js calls lib.i18n.negotiateCulture after routing match', function() {
        assert.match(SERVER_SRC, /lib\.i18n\.negotiateCulture\s*\(\s*req\s*,/);
    });

    it('core/server.js sets req.culture from the negotiator', function() {
        assert.match(SERVER_SRC, /req\.culture\s*=\s*lib\.i18n\.negotiateCulture/);
    });

    it('core/server.js wraps i18n negotiation in try/catch (defensive)', function() {
        // Ensure the hook can never block routing. Structural ordering pin —
        // the former {1,2000} char window broke when #B99's guarded
        // settings.i18n.cookieName read landed (deliberately) inside the try;
        // ordering has no byte window to re-tune on future insertions.
        var hStart   = SERVER_SRC.indexOf('var _negotiateReqCulture');
        assert.ok(hStart > -1, 'helper definition must exist');
        var hEnd     = SERVER_SRC.indexOf('// Checking cached route', hStart);
        assert.ok(hEnd > hStart, 'stable end anchor must follow the helper');
        var block    = SERVER_SRC.slice(hStart, hEnd);
        var tryIdx   = block.indexOf('try {');
        var callIdx  = block.indexOf('lib.i18n.negotiateCulture');
        var catchIdx = block.indexOf('} catch');
        assert.ok(tryIdx > -1, 'helper opens a try block');
        assert.ok(callIdx > tryIdx, 'negotiation runs inside the try');
        assert.ok(catchIdx > callIdx, 'the catch closes after the call');
    });

    it('core/server.js supplies the bundle settings.region.culture as defaultCulture (#I18N Slice 1)', function() {
        // Step-4 bundle-level default: reads the matched bundle's
        // content.settings.region.culture (format-guarded) and threads it in.
        assert.match(SERVER_SRC, /content\.settings\.region\.culture/);
        assert.match(SERVER_SRC, /defaultCulture\s*:\s*_i18nDefault/);
    });

    it('core/server.js negotiation catch reads GINA_CULTURE via getEnvVar, not the deleted process.env (#I18N Slice 1)', function() {
        assert.match(SERVER_SRC, /catch\s*\(\s*_i18nErr\s*\)\s*\{[\s\S]{1,200}getEnvVar\(\s*['"]GINA_CULTURE['"]\s*\)/);
        assert.doesNotMatch(SERVER_SRC, /process\.env\.GINA_CULTURE/);
    });

    it('lib/i18n negotiateCulture step 5 reads GINA_CULTURE via typeof-guarded getEnvVar (#I18N Slice 1)', function() {
        var I18N_SRC = fs.readFileSync(path.join(FW, 'lib/i18n/src/main.js'), 'utf8');
        assert.match(I18N_SRC, /typeof\s+getEnvVar\s*===\s*['"]function['"]/);
        assert.match(I18N_SRC, /getEnvVar\(\s*['"]GINA_CULTURE['"]\s*\)/);
        assert.doesNotMatch(I18N_SRC, /process\.env\.GINA_CULTURE/);
    });

    it('core/server.js reads availableCultures from process.gina._i18nCatalogs[bundleName]', function() {
        assert.match(SERVER_SRC, /process\.gina\._i18nCatalogs\[_i18nBundle\]/);
    });

});


// ─── 06 — Module exports ──────────────────────────────────────────────────

describe('06 - Slice 3 helpers exposed on the module', function() {

    it('exports parseAcceptLanguage', function() {
        assert.equal(typeof i18n.parseAcceptLanguage, 'function');
    });

    it('exports matchAvailable', function() {
        assert.equal(typeof i18n.matchAvailable, 'function');
    });

    it('exports readCookie', function() {
        assert.equal(typeof i18n.readCookie, 'function');
    });

    it('exports negotiateCulture', function() {
        assert.equal(typeof i18n.negotiateCulture, 'function');
    });

});
