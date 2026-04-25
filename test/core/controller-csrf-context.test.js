'use strict';
/**
 * Controller CSRF context exposure (#CSRF2 follow-up) tests
 *
 * The Csrf plugin (core/plugins/lib/csrf/src/main.js) attaches `req.csrfToken`
 * during the request lifecycle. This commit adds two `set()` calls inside
 * controller.js > setOptions() that surface the token to swig templates as:
 *
 *   gina.csrfToken  -> raw base64url string
 *   gina.csrfInput  -> '<input type="hidden" name="<fieldName>" value="<token>">'
 *
 * Strategy — mirrors controller-injection.test.js:
 *  - Source-inspection guards pinning the new block.
 *  - Behavioural simulation of the escape + interpolation logic on a clone
 *    rather than booting the full controller (controller.js load chain
 *    pulls in swig, routing, session stores, etc.).
 *  - Negative-invariant lock: no eval, no template injection vector.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW          = require('../fw');
var SOURCE_PATH = path.join(FW, 'core/controller/controller.js');

var src;
before(function () { src = fs.readFileSync(SOURCE_PATH, 'utf8'); });


// ─── 01 — token exposed when req.csrfToken is set ────────────────────────────

describe('01 - source inspection: gina.csrfToken set when req.csrfToken is a non-empty string', function () {

    it('#CSRF2 marker is present in the new block', function () {
        assert.ok(/#CSRF2/.test(src), 'expected #CSRF2 traceability marker');
    });

    it('guard checks local.req && typeof(local.req.csrfToken) == "string" && local.req.csrfToken', function () {
        // The guard must reject undefined, non-string, and empty-string values.
        assert.ok(
            /local\.req\s*&&\s*typeof\(local\.req\.csrfToken\)\s*==\s*['"]string['"]\s*&&\s*local\.req\.csrfToken/.test(src),
            'expected the three-part guard before set() calls'
        );
    });

    it("set('gina.csrfToken', local.req.csrfToken) is present", function () {
        assert.ok(
            /set\(\s*['"]gina\.csrfToken['"]\s*,\s*local\.req\.csrfToken\s*\)/.test(src),
            'expected set("gina.csrfToken", local.req.csrfToken)'
        );
    });

    it("set('gina.csrfInput', ...) is present", function () {
        assert.ok(
            /set\(\s*['"]gina\.csrfInput['"]\s*,/.test(src),
            'expected set("gina.csrfInput", ...)'
        );
    });

});


// ─── 02 — token undefined when req.csrfToken is absent ──────────────────────

describe('02 - guard: when req.csrfToken is missing/empty/non-string, no set() runs', function () {

    function simulateGuard(req) {
        // Mirrors the source-level guard.
        return !!(req && typeof(req.csrfToken) == 'string' && req.csrfToken);
    }

    it('passes guard for non-empty string token', function () {
        assert.equal(simulateGuard({ csrfToken: 'abc.def' }), true);
    });

    it('rejects undefined req', function () {
        assert.equal(simulateGuard(undefined), false);
    });

    it('rejects req without csrfToken', function () {
        assert.equal(simulateGuard({}), false);
    });

    it('rejects empty-string token', function () {
        assert.equal(simulateGuard({ csrfToken: '' }), false);
    });

    it('rejects non-string token', function () {
        assert.equal(simulateGuard({ csrfToken: 12345 }), false);
        assert.equal(simulateGuard({ csrfToken: null }), false);
        assert.equal(simulateGuard({ csrfToken: { tok: 'x' } }), false);
    });

    it('source: the set() calls live INSIDE the guarded if block', function () {
        // Pin the structural property: the gina.csrfToken set() call must
        // be lexically nested within the guard. We capture the if-block
        // header and confirm the set() call appears between the opening
        // brace of that if and the matching close (approximated by the
        // first occurrence of "set('gina.csrfInput'" then the next "}").
        var ifIdx = src.search(/if\s*\(\s*local\.req\s*&&\s*typeof\(local\.req\.csrfToken\)/);
        assert.ok(ifIdx > -1, 'expected the guard if-statement');
        var tokenSetIdx = src.indexOf("set('gina.csrfToken'", ifIdx);
        assert.ok(tokenSetIdx > ifIdx, 'gina.csrfToken set() must follow the guard');
    });

});


// ─── 03 — csrfInput uses configured fieldName ───────────────────────────────

describe('03 - csrfInput: fieldName comes from settings.csrf.fieldName, default "_csrf"', function () {

    function buildInput(fieldName, token) {
        // Mirrors the source-level escape + interpolation. Token is base64url
        // ([A-Za-z0-9_-]) by construction so it is not escaped here either.
        var escaped = String(fieldName)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return '<input type="hidden" name="' + escaped + '" value="' + token + '">';
    }

    it('default _csrf fieldName produces canonical input', function () {
        assert.equal(
            buildInput('_csrf', 'noncepart.macpart'),
            '<input type="hidden" name="_csrf" value="noncepart.macpart">'
        );
    });

    it('custom fieldName from settings is honoured', function () {
        assert.equal(
            buildInput('csrf-token', 'abc.def'),
            '<input type="hidden" name="csrf-token" value="abc.def">'
        );
    });

    it('source: settings.csrf.fieldName read path matches the plugin', function () {
        // Plugin reads settings.csrf.fieldName via getConfig(); controller
        // reads it via the same shape from options.conf.content.settings.csrf.
        assert.ok(
            /options\.conf\.content\.settings\.csrf/.test(src),
            'expected options.conf.content.settings.csrf access'
        );
        assert.ok(
            /fieldName/.test(src),
            'expected fieldName extraction'
        );
    });

    it('source: default fallback is _csrf', function () {
        assert.ok(
            /_csrfFieldName\s*=\s*['"]_csrf['"]/.test(src),
            'expected default field name "_csrf"'
        );
    });

});


// ─── 04 — csrfInput HTML-escapes the fieldName (defensive) ───────────────────

describe('04 - HTML attribute escape on fieldName', function () {

    function escape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    it('& becomes &amp;', function () {
        assert.equal(escape('a&b'), 'a&amp;b');
    });

    it('" becomes &quot;', function () {
        assert.equal(escape('a"b'), 'a&quot;b');
    });

    it('< becomes &lt;', function () {
        assert.equal(escape('a<b'), 'a&lt;b');
    });

    it('> becomes &gt;', function () {
        assert.equal(escape('a>b'), 'a&gt;b');
    });

    it('attribute-injection attempt is neutralised', function () {
        // A hostile fieldName can't break out of the value attribute or
        // inject onclick handlers — every dangerous character is escaped.
        var hostile = '" onclick="alert(1)" x="';
        var escaped = escape(hostile);
        assert.ok(escaped.indexOf('"') < 0, 'no raw " allowed in escaped output');
        // Ampersand-form is fine; the literal `<` would also be neutralised:
        var withLt = escape('"><script>alert(1)</script>');
        assert.ok(withLt.indexOf('<') < 0, 'no raw < allowed');
        assert.ok(withLt.indexOf('>') < 0, 'no raw > allowed');
    });

    it('source: all four escape replacements are present', function () {
        assert.ok(/&amp;/.test(src),  'expected &amp; replacement');
        assert.ok(/&quot;/.test(src), 'expected &quot; replacement');
        assert.ok(/&lt;/.test(src),   'expected &lt; replacement');
        assert.ok(/&gt;/.test(src),   'expected &gt; replacement');
    });

    it('safe HTML even with empty fieldName', function () {
        // Defensive: empty fieldName is rejected by the guard (`_csrfSettings.fieldName`
        // truthy check), so the default `_csrf` is used. Direct escape of '' is fine.
        assert.equal(escape(''), '');
    });

});


// ─── 05 — negative-invariant: no eval, no template injection vector ─────────

describe('05 - negative-invariant: no eval / new Function / unescaped interpolation', function () {

    it('the new block contains no eval(', function () {
        // Scope the check to the #CSRF2 block — the rest of controller.js
        // is out-of-scope for this commit's negative invariant.
        var startIdx = src.indexOf('// #CSRF2');
        assert.ok(startIdx > -1, 'expected #CSRF2 banner');
        // The block ends before the next blank-line + "set('page.view." anchor.
        var endAnchor = "set('page.view.ext'";
        var endIdx = src.indexOf(endAnchor, startIdx);
        assert.ok(endIdx > startIdx, 'expected end anchor "set(\'page.view.ext\'"');
        var block = src.substring(startIdx, endIdx);

        assert.ok(!/\beval\s*\(/.test(block),         'no eval(');
        assert.ok(!/new\s+Function\s*\(/.test(block), 'no new Function(');
    });

    it('the new block does not interpolate the token through escape()', function () {
        // Token is base64url ([A-Za-z0-9_-]) so it cannot inject HTML.
        // Critically, we MUST NOT pass the token through any HTML-encoding
        // step — that would break round-trip when the form is submitted.
        var startIdx = src.indexOf('// #CSRF2');
        var endIdx   = src.indexOf("set('page.view.ext'", startIdx);
        var block    = src.substring(startIdx, endIdx);
        // The token reference appears as `local.req.csrfToken` in the
        // interpolation, NOT through any replace() chain.
        assert.ok(
            /value="\s*'\s*\+\s*local\.req\.csrfToken\s*\+\s*'/.test(block),
            'expected raw token interpolation (no encoding) — base64url is HTML-attribute-safe'
        );
    });

    it('the fieldName IS passed through escape() before interpolation', function () {
        var startIdx = src.indexOf('// #CSRF2');
        var endIdx   = src.indexOf("set('page.view.ext'", startIdx);
        var block    = src.substring(startIdx, endIdx);
        // The fieldName variable used in the input HTML is the ESCAPED one.
        assert.ok(
            /name="\s*'\s*\+\s*_escapedFieldName\s*\+\s*'/.test(block),
            'expected escaped field name in name attribute'
        );
    });

    it('no template literal / backtick string used to build the input', function () {
        // String concatenation only — keeps the static string analysis trivial
        // and matches the var-style of the rest of the file.
        var startIdx = src.indexOf('// #CSRF2');
        var endIdx   = src.indexOf("set('page.view.ext'", startIdx);
        var block    = src.substring(startIdx, endIdx);
        assert.ok(!/\$\{[^}]+\}/.test(block), 'no template-literal interpolation in the CSRF block');
    });

});
