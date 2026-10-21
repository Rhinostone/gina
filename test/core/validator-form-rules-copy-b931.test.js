'use strict';
/**
 * The validator fix #B931 — a form's rules are its own copy of the rule set, and the submit and
 * click passes validate with that copy — pinned in the source, executed on the shipped bytes of
 * the two pass blocks, and pinned in both bundles. The behaviour is driven end-to-end on the real
 * bundle by `test/e2e/validator-shared-rules-b931.spec.js`.
 *
 *   §01 CONTROL — the premises the fix rests on, true on both sides of it: `getRuleObjByName`
 *       caches the object it builds and returns that object; the boot scan assigns one merged
 *       object per form to the registry; `lib/merge` returns its first argument (executed)
 *   §02 source pins (comment-stripped): `bindForm` assigns `JSON.clone(rule)` and no longer the
 *       object itself (raw-text control: the `was:` comment keeps the old line); the singular
 *       `.rule` is re-pointed at the copy; each pass reads the record's rules before resolving by
 *       name
 *   §03 the two pass blocks EXTRACTED and EXECUTED with a recording resolver: with a record, the
 *       record's object is chosen and the resolver is not called; without one, the resolver is
 *       called with the attribute's dotted name, then with the id's (CONTROL)
 *   §04 dist fidelity (both bundles)
 *
 * Red-first: `GINA_B931_MAIN_SRC=<file>` points §02–§03 at another copy of the validator source
 * (e.g. `git show <commit>:<path>` before the change), and `GINA_B931_DIST_DIR=<dir>` points §04 at
 * another dist js directory. Every arm must fail there except those labelled CONTROL.
 *
 * Usage: node --test test/core/validator-form-rules-copy-b931.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var MAIN     = process.env.GINA_B931_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B931_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');
var MERGE    = path.join(FW, 'lib/merge');

var SRC = fs.readFileSync(MAIN, 'utf8');

/**
 * Drops whole-line comments (`//`, `/*`, ` *`), so a pin never matches prose or a `was:` copy of
 * the code.
 *
 * @param {string} src
 * @returns {string}
 */
function activeLines(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * Counts the occurrences of a literal.
 *
 * @param {string} hay
 * @param {string} needle
 * @returns {number}
 */
function count(hay, needle) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) > -1) { n++; i += needle.length; }
    return n;
}

var ACTIVE = activeLines(SRC);

// The two pass blocks, taken from the RAW source: the click proxy's starts where `_id` is re-read
// from the element and ends at the submit latch; the submit proxy's starts at the OTHER
// `var customRule = …` read and ends at the #B346 note. Both anchors exist before and after the fix.
var RESOLVE_LINE = "var customRule = $target.getAttribute('data-gina-form-rule');";
var CLICK_START_RE = /_id = \$target\.getAttribute\('id'\);[ \t]*\n[ \t]*var customRule = \$target\.getAttribute\('data-gina-form-rule'\);/;
var CLICK_END   = 'instance.$forms[id].isSubmitting = true;';
var SUBMIT_END  = '// #B346 — this pass may proceed';

var clickSrc = (function () {
    var m = CLICK_START_RE.exec(SRC);
    if (!m) { return null; }
    var e = SRC.indexOf(CLICK_END, m.index);
    return (e > m.index) ? SRC.substring(m.index, e) : null;
})();
var submitSrc = (function () {
    var first = SRC.indexOf(RESOLVE_LINE);
    var second = (first > -1) ? SRC.indexOf(RESOLVE_LINE, first + RESOLVE_LINE.length) : -1;
    var clickAt = CLICK_START_RE.exec(SRC);
    var s = (clickAt && first > clickAt.index && first < clickAt.index + 400) ? second : first;
    if (s < 0) { return null; }
    var e = SRC.indexOf(SUBMIT_END, s);
    return (e > s) ? SRC.substring(s, e) : null;
})();

/** A form element stub: `getAttribute` over a map. */
function target(attrs) {
    return { getAttribute: function (n) { return (typeof attrs[n] != 'undefined') ? attrs[n] : null; } };
}

/** Runs the click block with a registry `instance`, returning `rule` and the resolver's calls. */
function runClick(attrs, instance) {
    var calls = [];
    var resolver = function (name) { calls.push(name); return { byName: name }; };
    var fn = new Function('$target', 'instance', 'getRuleObjByName',
        'var _id = null, rule = null;\n' + clickSrc + '\nreturn { rule: rule, _id: _id };');
    var out = fn(target(attrs), instance, resolver);
    out.calls = calls;
    return out;
}

/** Runs the submit block with a `$formInstance`, returning `rule` and the resolver's calls. */
function runSubmit(attrs, $formInstance, id) {
    var calls = [];
    var resolver = function (name) { calls.push(name); return { byName: name }; };
    var fn = new Function('$target', '$formInstance', 'id', 'getRuleObjByName',
        'var rule = null;\n' + submitSrc + '\nreturn rule;');
    var rule = fn(target(attrs), $formInstance, id, resolver);
    return { rule: rule, calls: calls };
}

describe('validator-form-rules-copy-b931 §01 — the premises (CONTROL)', function () {

    it('01.1 - CONTROL: getRuleObjByName caches the object it builds and returns that object', function () {
        var i = ACTIVE.indexOf('local.rules[ruleName] = ruleObj;');
        assert.ok(i > -1, 'the cache write is present');
        var tail = ACTIVE.substring(i, i + 120);
        assert.ok(/return ruleObj/.test(tail), 'the cached object is returned: ' + JSON.stringify(tail));
    });

    it('01.2 - CONTROL: the boot scan assigns one merged object per form to the registry and the record', function () {
        assert.equal(count(ACTIVE, 'instance.$forms[id].rules[customRule] = instance.rules[customRule] = local.rules[customRule] = merge(JSON.clone(_scsCur), instance.rules[customRule]);'), 1);
    });

    it('01.3 - CONTROL: lib/merge returns its first argument (executed), so each boot form got a new object carrying the previous one\'s keys', function () {
        var merge = require(MERGE);
        var a = { x: 1 };
        var out = merge(a, { y: 2 });
        assert.equal(out, a, 'the target is returned');
        assert.deepEqual(a, { x: 1, y: 2 });
    });
});

describe('validator-form-rules-copy-b931 §02 — source pins', function () {

    it('02.1 - bindForm assigns the record a copy: `$form.rules = JSON.clone(rule);` once', function () {
        assert.equal(count(ACTIVE, '$form.rules = JSON.clone(rule);'), 1);
    });

    it('02.2 - the object itself is no longer assigned (raw-text control: the was: comment keeps the old line)', function () {
        assert.equal(count(ACTIVE, '$form.rules = rule;'), 0, 'no active `$form.rules = rule;`');
        assert.ok(count(SRC, '$form.rules = rule;') >= 1, 'the raw text still carries the old line, so the stripper is doing work');
    });

    it('02.3 - the singular .rule, where set, is re-pointed at the copy', function () {
        var i = ACTIVE.indexOf('$form.rules = JSON.clone(rule);');
        var tail = ACTIVE.substring(i, i + 200);
        assert.ok(/typeof\(\$form\.rule\) != 'undefined'/.test(tail) && /\$form\.rule = \$form\.rules;/.test(tail), JSON.stringify(tail));
    });

    it('02.4 - the click proxy reads the record\'s rules before resolving by name', function () {
        assert.ok(clickSrc, 'the click block is extracted');
        var a = activeLines(clickSrc);
        var rec = a.indexOf('rule = instance.$forms[_id].rules;');
        var byName = a.indexOf('rule = getRuleObjByName(customRule.replace(');
        assert.ok(rec > -1, 'the record read is present');
        assert.ok(byName > rec, 'the by-name resolve follows it');
    });

    it('02.5 - the submit proxy reads the record\'s rules before resolving by name', function () {
        assert.ok(submitSrc, 'the submit block is extracted');
        var a = activeLines(submitSrc);
        var rec = a.indexOf('rule = $formInstance.rules;');
        var byName = a.indexOf('rule = getRuleObjByName(customRule.replace(');
        assert.ok(rec > -1, 'the record read is present');
        assert.ok(byName > rec, 'the by-name resolve follows it');
    });
});

describe('validator-form-rules-copy-b931 §03 — the two pass blocks executed on the shipped bytes', function () {

    it('03.0 - CONTROL: both blocks are extracted and carry the by-name resolve', function () {
        assert.ok(clickSrc && clickSrc.indexOf('getRuleObjByName(') > -1, 'click block');
        assert.ok(submitSrc && submitSrc.indexOf('getRuleObjByName(') > -1, 'submit block');
        assert.ok(clickSrc.indexOf(SUBMIT_END) < 0, 'the click block stops before the submit block');
    });

    it('03.1 - click: with a record, the record\'s rules object is chosen and the resolver is not called', function () {
        var own = { ref: { isRequired: true }, 'rows[1][id]': { exclude: false } };
        var out = runClick({ id: 'f1', 'data-gina-form-rule': 'shared' }, { $forms: { f1: { rules: own } } });
        assert.equal(out._id, 'f1');
        assert.equal(out.rule, own, 'the record\'s object');
        assert.deepEqual(out.calls, [], 'no by-name resolve');
    });

    it('03.2 - click, CONTROL: without a record, the attribute\'s dotted name resolves', function () {
        var out = runClick({ id: 'f1', 'data-gina-form-rule': 'account/sign-in' }, { $forms: {} });
        assert.deepEqual(out.calls, ['account.sign.in']);
        assert.deepEqual(out.rule, { byName: 'account.sign.in' });
    });

    it('03.3 - click, CONTROL: without a record or an attribute, the id\'s dotted name resolves', function () {
        var out = runClick({ id: 'my-form' }, { $forms: {} });
        assert.deepEqual(out.calls, ['my.form']);
    });

    it('03.4 - submit: with a record, the record\'s rules object is chosen and the resolver is not called', function () {
        var own = { ref: { isRequired: true }, agree: { isRequired: true, isBoolean: true } };
        var out = runSubmit({ id: 'f1', 'data-gina-form-rule': 'shared' }, { rules: own }, 'f1');
        assert.equal(out.rule, own, 'the record\'s object');
        assert.deepEqual(out.calls, []);
    });

    it('03.5 - submit, CONTROL: without a record, by name (attribute, then id)', function () {
        var a = runSubmit({ id: 'f1', 'data-gina-form-rule': 'shared' }, undefined, 'f1');
        assert.deepEqual(a.calls, ['shared']);
        var b = runSubmit({ id: 'my-form' }, undefined, 'my-form');
        assert.deepEqual(b.calls, ['my.form']);
    });

    it('03.6 - submit, CONTROL: a record without rules falls back to the name', function () {
        var out = runSubmit({ id: 'f1', 'data-gina-form-rule': 'shared' }, { binded: false }, 'f1');
        assert.deepEqual(out.calls, ['shared']);
    });
});

describe('validator-form-rules-copy-b931 §04 — dist fidelity', function () {
    var full = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
    var min  = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');

    it('04.1 - gina.js carries the copy and both record reads verbatim', function () {
        assert.equal(count(activeLines(full), '$form.rules = JSON.clone(rule);'), 1);
        assert.equal(count(activeLines(full), 'rule = instance.$forms[_id].rules;'), 1);
        assert.equal(count(activeLines(full), 'rule = $formInstance.rules;'), 1);
    });

    it('04.2 - gina.min.js assigns a JSON.clone to a rules property', function () {
        assert.ok(count(min, 'rules=JSON.clone(') >= 1, 'the minified copy assignment is present');
    });
});
