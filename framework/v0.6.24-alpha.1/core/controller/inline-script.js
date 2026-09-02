/**
 * Safe serialisation of server-side data into an inline `<script>` block.
 *
 * ## Why this module exists
 *
 * A value serialised into an inline script is not in HTML text context — it is in
 * *script data* context, where the HTML tokenizer scans for a script-data end tag
 * and hands everything before it to the JS parser. HTML-escaping is therefore the
 * WRONG tool (it would corrupt the JSON); the right one is to make the `<`
 * character incapable of starting any tag-like sequence at all.
 *
 * ## Why `<` rather than a `</script>` blocklist
 *
 * The previous guard was two `.replace()` calls matching the literal `</script>`
 * and `<!--`. That is a blocklist, and it was incomplete: per the HTML5
 * *script data end tag name state*, the tag name may be followed by TAB, LF, FF,
 * SPACE or `/` as well as `>`. Measured with a spec-compliant parser, both
 * `</script >` and `</script/>` terminated the block and injected, while the
 * blocklist let them through untouched — including at the one site that was
 * considered protected.
 *
 * Escaping `<` itself is allowlist-shaped: it neutralises `</script` in every
 * spelling, `<!--`, and a nested `<script` opener in one step, and cannot be
 * defeated by a terminator variant nobody enumerated. `<` is a valid JSON
 * escape, so the emitted text still `JSON.parse`s back to a byte-identical value
 * (measured across every payload shape in the regression suite).
 *
 * U+2028 / U+2029 are additionally escaped: they are legal inside a JSON string
 * but were line terminators to the JS parser before ES2019, so an unescaped one
 * turns a valid payload into a `SyntaxError`. (This is not theoretical — a literal
 * U+2028 in the probe written to verify this module crashed the parser reading it.)
 *
 * @module core/controller/inline-script
 */
'use strict';

/**
 * U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR.
 * Built with `RegExp` + `String.fromCharCode` rather than regex literals so that
 * this source file never contains the raw characters — a literal one here would
 * be a line terminator to some parsers reading this very file.
 *
 * @constant {RegExp}
 * @private
 */
var RE_LINE_SEPARATOR      = new RegExp(String.fromCharCode(0x2028), 'g');
/** @constant {RegExp} @private */
var RE_PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');
/** @constant {RegExp} @private */
var RE_LT                  = /</g;

/**
 * Escape an already-serialised JS/JSON string literal so it is safe to emit inside
 * an inline `<script>` block. Operates on TEXT, not on a value — use
 * {@link safeInlineJson} unless you have already stringified.
 *
 * @param {string} text - serialised JS source text (typically `JSON.stringify` output)
 * @returns {string} the same text with `<` and the JS line separators escaped
 *
 * @example
 * escapeForInlineScript('{"a":"x</script >y"}');
 * // => '{"a":"x\\u003c/script >y"}'
 */
function escapeForInlineScript(text) {
    return String(text)
        .replace(RE_LT, '\\u003c')
        .replace(RE_LINE_SEPARATOR, '\\u2028')
        .replace(RE_PARAGRAPH_SEPARATOR, '\\u2029');
}

/**
 * Serialise a value to JSON that is safe to embed in an inline `<script>`.
 * This is the function every emission site should use.
 *
 * @param {*} value - any JSON-serialisable value
 * @returns {string} JSON text that cannot break out of a script block
 *
 * @example
 * var payload = { client: { fullname: 'Zed</script ><img src=y onerror=1>' } };
 * '<script>window.__ginaData = ' + safeInlineJson(payload) + ';</script>';
 * // the injected markup is inert, and JSON.parse returns the original string
 */
function safeInlineJson(value) {
    return escapeForInlineScript(JSON.stringify(value));
}

/**
 * Serialise a single string as a safe JS string LITERAL (quotes included) for
 * interpolation into inline script source.
 *
 * Use this instead of hand-writing `'"' + str + '"'`: that form breaks on an
 * embedded quote or backslash regardless of any script-terminator concern.
 *
 * @param {string} str - the string to embed
 * @returns {string} a quoted, escaped JS string literal
 *
 * @example
 * 'var _b=' + safeInlineString(bundleName) + ';'
 */
function safeInlineString(str) {
    return escapeForInlineScript(JSON.stringify(String(str == null ? '' : str)));
}

module.exports = {
    escapeForInlineScript : escapeForInlineScript,
    safeInlineJson        : safeInlineJson,
    safeInlineString      : safeInlineString
};
