/**
 * FormValidator — an unticked value-carrying checkbox whose own rule says `isRequired` is collected (#B926)
 *
 * The two collectors (`getFormValidationInfos` and the native-submit inline copy) admitted an unticked
 * NON-boolean control into the field map only when it was a radio group whose rule declared a truthy
 * `isRequired` (#B221). An unticked value-carrying checkbox — a `value` that is neither `true` nor
 * `false`, no `isBoolean` rule — entered none of their arms, so no rule ever judged it: with
 * `"isRequired": true` on it, the form posted without the box and the required check never fired, on
 * the client or on the server (the engine never fires `isRequired` on an absent key). The #B221 arm now
 * takes a checkbox as well: `isRequired` on a value-carrying checkbox means « must be ticked » —
 * several boxes under one name: at least one ticked; distinct names: each. A boolean checkbox (no
 * `value`, a `true`/`false` value, or an `isBoolean` rule) keeps posting its live state; an unticked
 * box with no rule, `"isRequired": false` or an `isBoolean` rule stays absent; a disabled box is
 * skipped before any arm.
 *
 * Layering (project convention): source pins on both collectors (with a raw-text control that the
 * `was:` record keeps the old conjunct); the REAL `getFormValidationInfos` brace-walked out of main.js
 * and run on jsdom forms; pins on both bundles (gina.js verbatim, gina.min.js by the regex literal,
 * which Closure keeps).
 *
 * Red-first: `GINA_B926_MAIN_SRC=<file>` points §01–§02 at another copy of the validator source (e.g.
 * `git show <commit>:<path>` before the change), and `GINA_B926_DIST_DIR=<dir>` points §03 at another
 * directory holding gina.js and gina.min.js. On the pre-fix copies the non-control tests fail.
 *
 * Run: node --test test/core/validator-required-checkbox-collection-b926.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var FW = require('../fw');
require(path.join(FW, '../../utils/prototypes')); // Object#count — the collector writes fields['_length']

var MAIN     = process.env.GINA_B926_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B926_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

var src = fs.readFileSync(MAIN, 'utf8');

function stripComments(s) {
    return s.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}
function count(hay, needle) {
    return hay.split(needle).length - 1;
}
// From the first `{` at or after `from`, returns the index of its matching `}`.
function matchBrace(text, from) {
    var open = text.indexOf('{', from);
    var depth = 0;
    for (var j = open; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') {
            depth--;
            if (depth === 0) return j;
        }
    }
    return -1;
}
// The body of `var <name> = function(...) {...}` in `text`.
function extractVarFn(text, name) {
    var start = text.indexOf('var ' + name + ' = function');
    assert.ok(start > -1, name + ' declaration not found');
    assert.equal(text.indexOf('var ' + name + ' = function', start + 1), -1, name + ' declaration must be unique');
    var end = matchBrace(text, start);
    assert.ok(end > start, name + ' body not closed');
    return text.substring(start, end + 1);
}
function toExpr(fnSrc, name) {
    return fnSrc.replace(new RegExp('^var ' + name + '\\s*=\\s*'), '');
}

var active = stripComments(src);

// The two arms, in their active text (the `was:` lines are comments and never reach `active`).
var INFOS_ARM  = "/^(radio|checkbox)$/i.test($form[i].type)\n                    && rules\n                    && typeof(rules[name]) != 'undefined'\n                    && /^true$/i.test(rules[name].isRequired)";
var INLINE_ARM = "/^(radio|checkbox)$/i.test($target[i].type)\n                        && rules\n                        && typeof(rules[name]) != 'undefined'\n                        && /^true$/i.test(rules[name].isRequired)";
var OLD_INFOS  = "$form[i].type == 'radio'\n                    && rules";
var OLD_INLINE = "$target[i].type == 'radio'\n                        && rules";

// ============================================================================
// §01 — source pins
// ============================================================================

describe('validator-required-checkbox-collection-b926 §01 — source pins', function () {

    it('01.1 - #B926: the getFormValidationInfos arm takes a radio OR a checkbox', function () {
        assert.equal(count(active, INFOS_ARM), 1, 'expected the widened #B221 arm in getFormValidationInfos');
    });

    it('01.2 - #B926: the native-submit inline collector carries the twin arm', function () {
        assert.equal(count(active, INLINE_ARM), 1, 'expected the widened #B221 arm in the inline collector');
    });

    it('01.3 - #B926: the radio-only conjuncts are gone from the active text', function () {
        assert.equal(count(active, OLD_INFOS), 0, 'the infos arm must no longer gate on radio alone');
        assert.equal(count(active, OLD_INLINE), 0, 'the inline arm must no longer gate on radio alone');
    });

    it('01.4 - CONTROL: the raw text still carries both old conjuncts (the was: records), so 01.3 reads the active text', function () {
        assert.ok(count(src, "$form[i].type == 'radio'") >= 1, 'the infos was: line must survive in the raw text');
        assert.ok(count(src, "$target[i].type == 'radio'") >= 1, 'the inline was: line must survive in the raw text');
    });
});

// ============================================================================
// §02 — the REAL getFormValidationInfos on jsdom forms
// ============================================================================

// Extracted from the RAW source: the collector holds a block comment that opens with `/**if (` and
// closes on a `} else */` line, which the line-based stripper above would leave half-open.
var infosSrc = extractVarFn(src, 'getFormValidationInfos');
var ibcSrc   = extractVarFn(src, 'isBooleanCheckbox');
var isBooleanCheckbox = new Function('return (' + toExpr(ibcSrc, 'isBooleanCheckbox') + ');')();
var getFormValidationInfos = new Function(
    'instance', 'gina', 'isBooleanCheckbox',
    'return (' + toExpr(infosSrc, 'getFormValidationInfos') + ');'
)({ $forms: {} }, { validator: { $forms: {} } }, isBooleanCheckbox);

function collect(innerHtml, rules) {
    var dom = new JSDOM('<!doctype html><html><body>'
        + '<form id="parent" data-gina-form-rule="my-rule" method="post" action="/update">'
        + innerHtml
        + '<button type="submit" id="send">Send</button>'
        + '</form></body></html>');
    var $form = dom.window.document.querySelector('form');
    var out = getFormValidationInfos($form, rules);
    return { $form: $form, fields: out.fields, $fields: out.$fields, rules: out.rules };
}

function ownRule() {
    return { ref: { isRequired: true }, 'items[0][email]': { isRequired: true, isEmail: true } };
}
var REF = '<input type="text" name="ref" value="r">';
function box(checked, extra) {
    return '<input type="checkbox" name="items[0][email]" value="a@example.com"' + (checked ? ' checked' : '') + (extra || '') + '>';
}

describe('validator-required-checkbox-collection-b926 §02 — collection (real getFormValidationInfos bytes, jsdom)', function () {

    it('02.0 - CONTROL: the extraction holds the collection branch and jsdom lists the controls', function () {
        assert.ok(infosSrc.length > 2000, 'getFormValidationInfos extraction suspiciously small');
        assert.ok(infosSrc.indexOf("fields['_length']") > -1, 'extraction must contain the _length write');
        var res = collect(REF + box(false), ownRule());
        assert.equal(res.$form.length, 3, 'ref, the box and the submit button are the listed controls');
        assert.equal(res.fields.ref, 'r');
    });

    it('02.1 - #B926: an unticked value-carrying checkbox with its own isRequired is collected as the empty value', function () {
        var res = collect(REF + box(false), ownRule());
        assert.ok('items[0][email]' in res.fields, 'the box must enter the field map (pre-fix: absent)');
        assert.equal(res.fields['items[0][email]'], '');
        assert.equal(res.fields['_length'], 2);
        assert.ok(res.$fields['items[0][email]'], 'the DOM handle is held');
    });

    it('02.2 - #B926: the string form "true" of isRequired is read too', function () {
        var res = collect(REF + box(false), { ref: { isRequired: true }, 'items[0][email]': { isRequired: 'true' } });
        assert.equal(res.fields['items[0][email]'], '');
    });

    it('02.3 - CONTROL: a ticked box is collected with its value', function () {
        var res = collect(REF + box(true), ownRule());
        assert.equal(res.fields['items[0][email]'], 'a@example.com');
        assert.equal(res.fields['_length'], 2);
    });

    it('02.4 - CONTROL: a disabled unticked box is skipped before any arm', function () {
        var res = collect(REF + box(false, ' disabled'), ownRule());
        assert.equal(typeof res.fields['items[0][email]'], 'undefined');
        assert.equal(res.fields['_length'], 1);
    });

    it('02.5 - CONTROL: an unticked box with no rule stays absent', function () {
        var res = collect(REF + box(false), { ref: { isRequired: true } });
        assert.equal(typeof res.fields['items[0][email]'], 'undefined');
        assert.equal(res.fields['_length'], 1);
    });

    it('02.6 - CONTROL: an unticked box whose rule says isRequired: false stays absent', function () {
        var res = collect(REF + box(false), { ref: { isRequired: true }, 'items[0][email]': { isRequired: false, isEmail: true } });
        assert.equal(typeof res.fields['items[0][email]'], 'undefined');
    });

    it('02.7 - CONTROL: an isBoolean rule classifies the box as boolean, which posts its live state (false)', function () {
        var res = collect(REF + box(false), { ref: { isRequired: true }, 'items[0][email]': { isRequired: true, isBoolean: true } });
        assert.equal(res.fields['items[0][email]'], false);
    });

    it('02.8 - CONTROL: a valueless checkbox is boolean and posts false, isRequired or not', function () {
        var res = collect(REF + '<input type="checkbox" name="agree">', { ref: { isRequired: true }, agree: { isRequired: true } });
        assert.equal(res.fields.agree, false);
    });

    it('02.9 - #B926: two boxes under one name, both unticked: the name is collected once, as the empty value', function () {
        var res = collect(REF + '<input type="checkbox" name="tags[]" value="a"><input type="checkbox" name="tags[]" value="b">',
            { ref: { isRequired: true }, 'tags[]': { isRequired: true } });
        assert.equal(res.fields['tags[]'], '');
        assert.equal(res.fields['_length'], 2);
    });

    it('02.10 - CONTROL: two boxes under one name, one ticked, in either order: the ticked value is kept', function () {
        var rules = { ref: { isRequired: true }, 'tags[]': { isRequired: true } };
        var r1 = collect(REF + '<input type="checkbox" name="tags[]" value="a"><input type="checkbox" name="tags[]" value="b" checked>', rules);
        assert.equal(r1.fields['tags[]'], 'b', 'unticked first: the ticked member overwrites the empty contribution');
        var r2 = collect(REF + '<input type="checkbox" name="tags[]" value="a" checked><input type="checkbox" name="tags[]" value="b">', rules);
        assert.equal(r2.fields['tags[]'], 'a', 'ticked first: the already-collected guard keeps the value');
    });

    it('02.11 - CONTROL (#B221): an unchecked required radio group is still collected as the empty value', function () {
        var res = collect(REF + '<input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b">',
            { ref: { isRequired: true }, plan: { isRequired: true } });
        assert.equal(res.fields.plan, '');
    });
});

// ============================================================================
// §03 — both bundles
// ============================================================================

describe('validator-required-checkbox-collection-b926 §03 — bundles', function () {
    var rawJs = path.join(DIST_DIR, 'gina.js');
    var minJs = path.join(DIST_DIR, 'gina.min.js');
    var NEEDLE = '/^(radio|checkbox)$/i.test(';

    it('03.1 - gina.js carries both widened arms in source form', function () {
        var raw = fs.readFileSync(rawJs, 'utf8');
        assert.ok(raw.indexOf("isBooleanCheckbox($form[i]") > -1, 'control: the collector is bundled');
        assert.equal(count(raw, INFOS_ARM), 1, 'the infos arm, verbatim (r.js runs optimize:none)');
        assert.equal(count(raw, INLINE_ARM), 1, 'the inline arm, verbatim');
    });

    it('03.2 - gina.min.js carries the regex literal at eight sites (the six pre-existing ones plus the two collectors)', function () {
        var min = fs.readFileSync(minJs, 'utf8');
        assert.ok(min.indexOf('.isBoolean') > -1, 'control: the isBoolean property chain exists');
        // Closure keeps a regex literal; the pre-fix bundle reads 6 (measured on the bundle before the
        // change), the fixed one 8: the two collectors' arms.
        assert.equal((min.match(/\/\^\(radio\|checkbox\)\$\/i\.test\(/g) || []).length, 8, NEEDLE + ' must appear eight times in the minified bundle');
    });
});
