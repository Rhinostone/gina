/**
 * #B463 — a value serialised into the Inspector's inline `<script>` must not be
 * evaluated as TEMPLATE SOURCE by the swig renderer.
 *
 * `controller.render-swig.js` splices the `__ginaData` / `__ginaLogs` scripts into
 * the layout BEFORE `swig.compile` (the per-request nonce is a swig conditional
 * there, which is why the block is template source rather than rendered output).
 * That means every delimiter swig recognises — `{{ }}`, `{% %}`, `{# #}` — is live
 * inside the serialised page data: a stored value `A{{ 7*7 }}B` rendered `A49B`,
 * and a tag inside a value executed. #B451 escaped `<` and closed the script
 * breakout class; it never touched braces, so this is a separate hole on the
 * same surface.
 *
 * The fix escapes `{` and `}` inside JSON STRING LITERALS only (`{` /
 * `}`, both valid JSON escapes, so the value still parses back identical).
 * Structural braces are left alone: an escape outside a string literal is not
 * JSON and not JavaScript, so a naive global replace would break every payload.
 * Arm 04 pins that boundary.
 *
 * Every arm renders through the real template engine the framework renders with
 * (the `@rhinostone/swig` fork resolved from the repo root, the same package the
 * framework dir installs), with the same nonce conditional and script shape the
 * renderer emits. A byte assertion alone would not do: the question is what the
 * ENGINE does with the text. Arm 00 is the known-positive control — an expression
 * in template text MUST evaluate — so a harness that cannot fire cannot report a
 * false clean.
 */
'use strict';

var { describe, it } = require('node:test');
var assert  = require('node:assert');
var path    = require('path');
var fs      = require('fs');
var swig    = require('@rhinostone/swig');

var FW      = path.join(__dirname, '..', '..', 'framework');
var version = fs.readdirSync(FW).filter(function (d) { return /^v/.test(d); })[0];
var inlineScript = require(path.join(FW, version, 'core', 'controller', 'inline-script.js'));

/** The nonce attribute exactly as render-swig.js bakes it pre-compile (#B130). */
var NONCE_TPL = '{% if page.cspNonce %} nonce="{{ page.cspNonce }}"{% endif %}';

/**
 * Render a serialised payload the way `controller.render-swig.js` does: spliced
 * into template source, then compiled and executed by swig.
 * @param   {string} serialised - output of the helper under test
 * @param   {Object} [opts]     - extra swig options (e.g. `{ autoescape: false }`)
 * @returns {string} the rendered HTML
 */
function renderThroughSwig(serialised, opts) {
    var tpl = '<body><script' + NONCE_TPL + '>window.__ginaData = ' + serialised + ';<' + '/script>\n</body>';
    return swig.render(tpl, Object.assign({ locals: { page: { cspNonce: 'n' } } }, opts || {}));
}

/**
 * Pull the JSON text back out of the rendered script — what the browser's JS
 * parser would evaluate.
 * @param   {string} html
 * @returns {?string}
 */
function extractPayload(html) {
    var m = /window\.__ginaData = ([\s\S]*?);<\/script>/.exec(html);
    return m ? m[1] : null;
}

describe('#B463 — inline-script helper vs the swig template layer', function () {

    it('00 control: an expression in TEMPLATE text is evaluated (the instrument fires)', function () {
        var html = swig.render('<body>{{ 7*7 }}</body>', { locals: {} });
        assert.ok(html.indexOf('49') > -1, 'control did not fire: ' + html);
    });

    it('01 a `{{ }}` expression inside a serialised value is NOT evaluated', function () {
        var payload = { client: { fullname: 'A{{ 7*7 }}B' } };
        var html    = renderThroughSwig(inlineScript.safeInlineJson(payload), { autoescape: false });
        var json    = extractPayload(html);
        assert.ok(json, 'script block not found in: ' + html);
        assert.ok(html.indexOf('A49B') === -1, 'expression evaluated: ' + html);
        assert.deepStrictEqual(JSON.parse(json), payload);
    });

    it('02 a `{% %}` tag inside a serialised value is NOT executed', function () {
        var payload = { client: { fullname: 'A{% if true %}EVAL{% endif %}B' } };
        var html    = renderThroughSwig(inlineScript.safeInlineJson(payload));
        assert.ok(html.indexOf('AEVALB') === -1, 'tag executed: ' + html);
        assert.deepStrictEqual(JSON.parse(extractPayload(html)), payload);
    });

    it('03 a `{# #}` comment inside a serialised value is NOT stripped', function () {
        var payload = { note: 'A{# hidden #}B' };
        var html    = renderThroughSwig(inlineScript.safeInlineJson(payload));
        assert.ok(html.indexOf('"AB"') === -1, 'comment stripped: ' + html);
        assert.deepStrictEqual(JSON.parse(extractPayload(html)), payload);
    });

    it('04 structural braces stay structural — nested objects, arrays, empties and brace-bearing keys round-trip', function () {
        var payload = { '{k}': { a: [ {}, { b: '}' }, [] ], '{{': '}}', empty: {} }, list: [ { x: '{% raw %}' } ] };
        var html    = renderThroughSwig(inlineScript.safeInlineJson(payload));
        var json    = extractPayload(html);
        assert.ok(json, 'script block not found');
        assert.deepStrictEqual(JSON.parse(json), payload);
        // and the serialised text itself is still valid JSON (no escape landed outside a string)
        assert.doesNotThrow(function () { JSON.parse(inlineScript.safeInlineJson(payload)); });
    });

    it('05 safeInlineString: a delimiter inside the embedded string is inert and the literal parses back identical', function () {
        var str  = 'bundle{{ 7*7 }}name';
        var html = swig.render('<script>var _b=' + inlineScript.safeInlineString(str) + ';<' + '/script>', { locals: {} });
        var m    = /var _b=([\s\S]*?);<\/script>/.exec(html);
        assert.ok(m, 'literal not found in: ' + html);
        assert.ok(html.indexOf('49') === -1, 'expression evaluated: ' + html);
        assert.strictEqual(JSON.parse(m[1]), str);
    });

    it('06 escapeForInlineScript escapes braces INSIDE string literals only', function () {
        assert.strictEqual(inlineScript.escapeForInlineScript('{"a":"{"}'), '{"a":"\\u007b"}');
        assert.strictEqual(inlineScript.escapeForInlineScript('{"a":"}","b":{}}'), '{"a":"\\u007d","b":{}}');
        // a JSON string containing an escaped quote and an escaped backslash before the brace
        assert.strictEqual(inlineScript.escapeForInlineScript('{"a":"x\\"{\\\\{"}'), '{"a":"x\\"\\u007b\\\\\\u007b"}');
    });

    it('07 the #B451 `<` escape and the brace escape compose — a combined breakout payload round-trips', function () {
        var payload = { v: '</script >{{ 7*7 }}<img src=y onerror=1>{% endif %}' };
        var html    = renderThroughSwig(inlineScript.safeInlineJson(payload));
        var json    = extractPayload(html);
        assert.ok(json.indexOf('<') === -1, 'raw < survived');
        assert.ok(json.indexOf('{') === -1 || /^\{"v":"[^{}]*"\}$/.test(json), 'a brace survived inside the string: ' + json);
        assert.ok(html.indexOf('49') === -1, 'expression evaluated');
        assert.deepStrictEqual(JSON.parse(json), payload);
    });

    it('08 escaped quotes and backslashes adjacent to braces do not confuse the string-literal scan', function () {
        var payload = { a: 'q"{{ 7*7 }}', b: 'bs\\{{ 7*7 }}', c: '\\"{%', d: '{"nested":"json"}' };
        var html    = renderThroughSwig(inlineScript.safeInlineJson(payload));
        assert.ok(html.indexOf('49') === -1, 'expression evaluated: ' + html);
        assert.deepStrictEqual(JSON.parse(extractPayload(html)), payload);
    });

    it('09 a value carrying every delimiter renders identically with autoescape on and off', function () {
        var payload = { v: '{{ x }}{% y %}{# z #}' };
        var on  = extractPayload(renderThroughSwig(inlineScript.safeInlineJson(payload)));
        var off = extractPayload(renderThroughSwig(inlineScript.safeInlineJson(payload), { autoescape: false }));
        assert.strictEqual(on, off);
        assert.deepStrictEqual(JSON.parse(on), payload);
    });
});
