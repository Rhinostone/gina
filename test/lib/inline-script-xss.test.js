/**
 * #B451 — server-side data serialised into an inline `<script>` must not be able
 * to break out of the block. Reported as gina-io/gina#69 (stored `</script>` in
 * page data terminating a nonce'd inline script).
 *
 * TWO defects were measured, and this file pins both:
 *
 *   D1  The terminator guard was applied at ONE emission site per renderer
 *       (`__ginaData`), while other sites serialised server data unguarded.
 *   D2  The guard ITSELF was bypassable. It matched only the literal `</script>`
 *       and `<!--`, but per the HTML5 *script data end tag name state* the tag
 *       name may also be followed by TAB / LF / FF / SPACE / `/`. Measured with a
 *       spec-compliant parser: `</script >` and `</script/>` both injected, at the
 *       site that was believed protected.
 *
 * The fix escapes `<` itself (allowlist-shaped) rather than enumerating
 * terminator spellings, so a variant nobody thought of cannot defeat it.
 *
 * Every arm asserts through a real HTML parser (jsdom) rather than by matching the
 * emitted bytes: the question is what a BROWSER does with the output, and a byte
 * assertion would silently pass for an escape sequence a parser still resolves.
 * The suite carries a known-positive control (unescaped input MUST inject) so a
 * broken harness cannot report a false clean.
 */
'use strict';

var { describe, it } = require('node:test');
var assert  = require('node:assert');
var path    = require('path');
var fs      = require('fs');
var { JSDOM } = require('jsdom');

var FW      = path.join(__dirname, '..', '..', 'framework');
var version = fs.readdirSync(FW).filter(function (d) { return /^v/.test(d); })[0];
var inlineScript = require(path.join(FW, version, 'core', 'controller', 'inline-script.js'));

/** U+2028, built without a literal so this file cannot break a parser reading it. */
var LINE_SEPARATOR = String.fromCharCode(0x2028);

/** Render a payload into an inline script exactly as the renderers do, then parse it. */
function injectedCount(serialised) {
    var html = '<!doctype html><html><body><script nonce="n">window.__ginaData = '
             + serialised + ';<' + '/script></body></html>';
    return new JSDOM(html).window.document.querySelectorAll('img[src=y]').length;
}

/** Every spelling of a script-data end tag the HTML5 tokenizer accepts, plus siblings. */
var BREAKOUTS = [
    ['plain          ', 'Zed</script><img src=y onerror=1>'],
    ['trailing space ', 'Zed</script ><img src=y onerror=1>'],
    ['trailing slash ', 'Zed</script/><img src=y onerror=1>'],
    ['tab            ', 'Zed</script\t><img src=y onerror=1>'],
    ['newline        ', 'Zed</script\n><img src=y onerror=1>'],
    ['form feed      ', 'Zed</script\f><img src=y onerror=1>'],
    ['uppercase      ', 'Zed</SCRIPT><img src=y onerror=1>'],
    ['uppercase+space', 'Zed</SCRIPT ><img src=y onerror=1>'],
    ['mixed case     ', 'Zed</ScRiPt/><img src=y onerror=1>'],
    ['comment open   ', 'Zed<!--<script><img src=y onerror=1>'],
    ['nested opener  ', 'Zed<script><img src=y onerror=1>']
];

describe('#B451 - 01 the harness can actually detect an injection', function () {
    it('CONTROL: unescaped JSON.stringify DOES inject (proves the arms below can fail)', function () {
        var n = injectedCount(JSON.stringify({ client: { fullname: BREAKOUTS[0][1] } }));
        assert.strictEqual(n, 1, 'known-positive control did not fire - the harness is blind');
    });

    it('CONTROL: a benign value injects nothing', function () {
        assert.strictEqual(injectedCount(inlineScript.safeInlineJson({ client: { fullname: 'Zed' } })), 0);
    });
});

describe('#B451 - 02 safeInlineJson neutralises every terminator spelling', function () {
    BREAKOUTS.forEach(function (entry) {
        it(entry[0].trim() + ' cannot break out of the script block', function () {
            var out = inlineScript.safeInlineJson({ client: { fullname: entry[1], id: 7 } });
            assert.strictEqual(injectedCount(out), 0, 'payload escaped the guard: ' + entry[0]);
        });
    });
});

describe('#B451 - 03 escaping does not corrupt the data', function () {
    BREAKOUTS.forEach(function (entry) {
        it(entry[0].trim() + ' round-trips byte-identical through JSON.parse', function () {
            var obj = { client: { fullname: entry[1], id: 7 } };
            assert.deepStrictEqual(JSON.parse(inlineScript.safeInlineJson(obj)), obj);
        });
    });

    it('U+2028 is escaped (a JS line terminator before ES2019) and still round-trips', function () {
        var obj = { note: 'a' + LINE_SEPARATOR + 'b' };
        assert.ok(inlineScript.safeInlineJson(obj).indexOf(LINE_SEPARATOR) === -1, 'raw U+2028 survived');
        assert.deepStrictEqual(JSON.parse(inlineScript.safeInlineJson(obj)), obj);
    });
});

describe('#B451 - 04 safeInlineString for non-JSON interpolation sites', function () {
    it('quotes and escapes a bundle name so it cannot terminate the literal', function () {
        var out = inlineScript.safeInlineString('bun"dle');
        assert.strictEqual(JSON.parse(out), 'bun"dle');
    });

    it('a script terminator inside a bare string cannot break out', function () {
        var html = '<!doctype html><html><body><script nonce="n">var _b='
                 + inlineScript.safeInlineString('x</script ><img src=y onerror=1>')
                 + ';<' + '/script></body></html>';
        assert.strictEqual(new JSDOM(html).window.document.querySelectorAll('img[src=y]').length, 0);
    });

    it('null and undefined degrade to an empty string literal, not "null"', function () {
        assert.strictEqual(JSON.parse(inlineScript.safeInlineString(null)), '');
        assert.strictEqual(JSON.parse(inlineScript.safeInlineString(undefined)), '');
    });
});

describe('#B451 - 05 no emission site still uses the bypassable blocklist', function () {
    var CTRL = path.join(FW, version, 'core', 'controller');

    ['controller.render-swig.js', 'controller.render-nunjucks.js'].forEach(function (file) {
        it(file + ' has no literal </script> blocklist left', function () {
            var src = fs.readFileSync(path.join(CTRL, file), 'utf8');
            // built without a literal so this assertion cannot match its own source
            var needle = new RegExp('replace\\(/<\\\\/' + 'script>/gi');
            assert.ok(!needle.test(src), file + ' still carries the bypassable blocklist');
            assert.ok(src.indexOf('inlineScript.') > -1, file + ' does not use the shared helper');
        });
    });
});
