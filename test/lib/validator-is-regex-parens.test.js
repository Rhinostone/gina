'use strict';
/**
 * #B345 (gh issue #59) — `is` regex literals must compile AS AUTHORED.
 *
 * Pre-fix, the #SCS1e paren/`return` strip ran BEFORE the regex-vs-binary
 * branch decision, so it also mangled every parenthesized regex literal:
 *   - groups destroyed, anchors rebound: `^(a|b)$` compiled as `^a|b$`,
 *     i.e. `(^a)|(b$)` — substring-permissive for middle alternatives;
 *   - quantified groups requantified: `(#TRUE)?` became `#TRU` + optional `E`;
 *   - a literal `return` inside a pattern was deleted outright.
 * All silent: the stripped text still compiled as a valid regex and simply
 * validated something else.
 *
 * The fix moves the strip into the BINARY-COMPARISON branch only. The regex
 * branch never evaluates the condition as JS (`new RegExp(body).test(value)`
 * — no eval), so parentheses there are legitimate syntax, not an injection
 * vector; the grammar-locked comparison keeps its strip (and its tolerance
 * of authored parens: `("a") === ("a")` still strips to a valid comparison).
 *
 * Red-first roster (RED on pre-fix bytes): §01.2, §02.1, §02.2 ('Xb'),
 * §02.3 ('x' and 'x#TRU'), §02.4 ('xyz'), §03.3, and §04 until the prod
 * rebuild. Controls (green on both sides): §01.1, §01.3, §02.2 ('a'),
 * §02.5, §02.6, §03.1, §03.2.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var fs = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes'));
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'isregexparensbundle');

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
var DIST_RAW_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var FormValidator = require(ENGINE_PATH);

// The strip's own literal — regex literals survive both RequireJS (verbatim)
// and Closure (not renamed), so the same needle works on src and dist.
var STRIP_LITERAL = '.replace(/(\\(|\\)|return)/g';

/** Comment-stripped view — pins must not match narrative comments. */
function activeLines(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/** Slices a rule body out of a source text (validator-is-empty-bypass idiom). */
function bodyOf(src, rule) {
    var start = src.indexOf("self[el]['" + rule + "'] = function");
    assert.ok(start > -1, 'rule `' + rule + '` not found');
    var next = src.indexOf('self[el][', start + 10);
    assert.ok(next > start, 'no following rule definition');
    return src.substring(start, next);
}

/** Direct engine drive: fresh instance, one is(condition) call. */
function driveIs(value, condition) {
    var v = new FormValidator({ zone: value }, undefined, undefined, undefined, undefined);
    v.zone.is(condition);
    return { valid: v.zone.valid, errorKeys: Object.keys(v.zone.errors || {}) };
}

// ---------------------------------------------------------------------------
// §01 — source pins: the strip lives in the binary-comparison branch
// ---------------------------------------------------------------------------
describe('validator-is-regex-parens §01 — source pins', function () {

    it('01.1 - control: bodyOf() slices a real rule (can-fail)', function () {
        assert.ok(bodyOf(ENGINE_SRC, 'isEmail').indexOf("this.value === ''") > -1,
            'the canonical rule carries the strict empty bypass');
        assert.throws(function () { bodyOf(ENGINE_SRC, 'noSuchRule345'); }, /not found/);
    });

    it('01.2 - ORDER: the regex-literal compile precedes the strip in file order', function () {
        var body = activeLines(bodyOf(ENGINE_SRC, 'is'));
        var stripIdx = body.indexOf(STRIP_LITERAL);
        var regexIdx = body.indexOf('_scsRegexMatch');
        var binIdx   = body.indexOf('_SCS_BINARY_RE');
        assert.ok(stripIdx > -1, 'the strip must still exist (it protects the comparison branch)');
        assert.ok(regexIdx > -1 && binIdx > -1, 'both #SCS1e branch constructs must exist');
        assert.ok(regexIdx < stripIdx,
            'regex-literal compile must come BEFORE the strip — the strip may no longer run first');
        assert.ok(stripIdx < binIdx,
            'the strip must sit at the top of the comparison branch, before the grammar constant');
    });

    it('01.3 - exactly ONE strip site in is() (no residual pre-branch copy)', function () {
        var body = activeLines(bodyOf(ENGINE_SRC, 'is'));
        var count = body.split(STRIP_LITERAL).length - 1;
        assert.equal(count, 1, 'expected exactly one paren/return strip in is(), found ' + count);
    });
});

// ---------------------------------------------------------------------------
// §02 — behavioral: regex literals compile as authored
// ---------------------------------------------------------------------------
describe('validator-is-regex-parens §02 — regex literals compile as authored', function () {

    var ISSUE_PATTERN = '/^(([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-Za-z]{6,10})(#TRUE)?|null)$/i';

    it('02.1 - the issue #59 reproduction: a 10-alnum id passes the grouped id-shape rule', function () {
        var r = driveIs('S680YMMcNW', ISSUE_PATTERN);
        assert.equal(r.valid, true, 'S680YMMcNW must satisfy the alternation as authored');
        assert.equal(r.errorKeys.indexOf('is'), -1, 'no `is` error expected');
    });

    it('02.2 - grouped anchors bind the WHOLE pattern: /^(a|b)$/ rejects "Xb", accepts "a"', function () {
        assert.equal(driveIs('Xb', '/^(a|b)$/').valid, false,
            'pre-fix the strip yielded /^a|b$/ which accepted "Xb" (substring-permissive)');
        assert.equal(driveIs('a', '/^(a|b)$/').valid, true,
            'control: a legitimate member still passes');
    });

    it('02.3 - a quantified GROUP stays a group: /^x(#TRUE)?$/', function () {
        assert.equal(driveIs('x', '/^x(#TRUE)?$/').valid, true,
            'the whole tag group is optional — pre-fix `^x#TRUE?$` rejected the bare value');
        assert.equal(driveIs('x#TRUE', '/^x(#TRUE)?$/').valid, true, 'the whole group matches');
        assert.equal(driveIs('x#TRU', '/^x(#TRUE)?$/').valid, false,
            'pre-fix `(#TRUE)?` compiled as `#TRU` + optional `E` and accepted this');
    });

    it('02.4 - a literal `return` inside a pattern survives: /^(return|cancel)$/', function () {
        assert.equal(driveIs('return', '/^(return|cancel)$/').valid, true);
        assert.equal(driveIs('cancel', '/^(return|cancel)$/').valid, true);
        assert.equal(driveIs('xyz', '/^(return|cancel)$/').valid, false,
            'pre-fix the strip left /^|cancel$/ whose empty ^-branch matched ANYTHING');
    });

    it('02.5 - control: a paren-free pattern is invariant under the fix', function () {
        assert.equal(driveIs('abc', '/^[a-z]{3}$/').valid, true);
        assert.equal(driveIs('abcd', '/^[a-z]{3}$/').valid, false);
    });

    it('02.6 - control: the #B233 empty bypass is untouched (empty value self-passes)', function () {
        assert.equal(driveIs('', '/^(a|b)$/').valid, true,
            'empty is adjudicated by isRequired alone');
    });
});

// ---------------------------------------------------------------------------
// §03 — the comparison branch keeps its protection
// ---------------------------------------------------------------------------
describe('validator-is-regex-parens §03 — comparison branch unchanged', function () {

    it('03.1 - authored parens in a comparison are still tolerated (strip preserved there)', function () {
        assert.equal(driveIs('anything', '("a") === ("a")').valid, true,
            'strips to `"a" === "a"` exactly as before the fix');
    });

    it('03.2 - non-grammar input still fails CLOSED with a warn, never throws (#B82 hardening)', function () {
        var r = driveIs('anything', '1 === 1; process.exit()');
        assert.equal(r.valid, false, 'injection-shaped condition must fail the field');
        assert.ok(r.errorKeys.indexOf('is') > -1, 'the failure must be recorded on the `is` key');
    });

    it('03.3 - a PARENTHESIZED regex literal now fails closed in the comparison branch (documented edge)', function () {
        // `(/foo/)` does not START with `/` as authored, so it no longer
        // reaches the regex branch (pre-fix the strip un-wrapped it first);
        // the comparison branch strips it to `/foo/`, the grammar rejects
        // that, and the field fails closed with a warn — honest and visible,
        // and not a shape any rules corpus uses.
        assert.equal(driveIs('foo', '(/foo/)').valid, false);
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity: the browser bundle carries the relocation
// ---------------------------------------------------------------------------
describe('validator-is-regex-parens §04 — dist fidelity', function () {

    it('04.1 - unminified gina.js: regex-literal compile precedes the strip', function () {
        var raw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
        var active = activeLines(bodyOf(raw, 'is'));   // RequireJS optimize:"none" keeps the source shape
        var stripIdx = active.indexOf(STRIP_LITERAL);
        var regexIdx = active.indexOf('_scsRegexMatch');
        assert.ok(stripIdx > -1 && regexIdx > -1, 'both constructs must be in the bundle');
        assert.ok(regexIdx < stripIdx, 'bundle must carry the relocated strip — rebuild dist');
    });

    it('04.2 - gina.min.js: the regex-literal branch precedes the strip (wrap-immune order pin)', function () {
        // Both needles are SINGLE minify-surviving tokens (a string literal and
        // the strip's own regex literal — Closure renames neither, and a line
        // wrap cannot split a token), each unique in the artifact — measured
        // 1/1 in both the pre-fix and post-fix builds, with the order flipping
        // exactly at the fix (pre: strip 38755 < literal 38848; post: literal
        // 38814 < strip 38911). Derived from the emitted bytes per the
        // never-guess-Closure-shapes rule.
        var min = fs.readFileSync(path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js'), 'utf8');
        var STRIP_TOKEN = '(\\(|\\)|return)';
        var LIT_TOKEN = 'Invalid regex literal';
        var sc = min.split(STRIP_TOKEN).length - 1;
        var lc = min.split(LIT_TOKEN).length - 1;
        assert.equal(sc, 1, 'strip regex token must be unique in gina.min.js, found ' + sc);
        assert.equal(lc, 1, 'regex-branch string literal must be unique in gina.min.js, found ' + lc);
        assert.ok(min.indexOf(LIT_TOKEN) < min.indexOf(STRIP_TOKEN),
            'minified bundle must carry the relocated strip (regex branch first) — rebuild dist');
    });
});
