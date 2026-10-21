/**
 * FormValidator — a RegExp KEY inside a `_case_` condition's `rules` applies in every block position (#B921)
 *
 * `forEachField` applies a matching condition's rules in two scans. The condition scan, which runs for
 * every block, skips a key that names no control (`if (_r == caseName || !$fields[_r]) continue;`), so
 * it skipped a RegExp key (`"/^item[/": {…}`): no control bears that name. Only the direct-case
 * recursion expanded a RegExp key over the form's controls, and that recursion runs for a driver that
 * is not the last `_case_` key of the rule set (#B229's arm short-circuits the last one). So a RegExp
 * key applied only when its block was not the last, under every case shape.
 *
 * The fix (option A', decided by Martin Luther ETOUMAN NDAMBWE on 2026-10-20): `expandCaseRegExpKeys`,
 * declared inside forEachField and run once per level on the pass's own copy of the rules (#B885),
 * gives each control a RegExp key matches a literal key of its own in that condition, holding a copy of
 * the key's rules — read as a top-level RegExp key is (`[` and `]` literal, the flags kept), a literal
 * key of the condition winning, then the first matching RegExp key, the block's driver left out, an
 * invalid pattern warned and skipped. The condition scan then applies it as it applies a literal key.
 * The direct-case loop skips the names the expansion added (its own RegExp branch covers them, as
 * before): without that skip, the recursion would check an uncollected field with the condition's rule
 * alone, its base rule lost (measured: §03.6's subtract). `isCaseConditionTarget` counts a RegExp key
 * read the same way, so such a field is live-checked (#B884).
 *
 * Layering (project convention): source pins with controls; `expandCaseRegExpKeys` compiled alone and
 * called on stubs; the forEachField slice driven with `checkFieldAgainstRules` spied (the harness of the
 * sibling case tests), with the literal-key twin of each RegExp-key arm as the reference trace;
 * `isCaseConditionTarget` compiled alone; pins on both bundles.
 *
 * Red-first: `GINA_B921_MAIN_SRC=<file>` points §01–§04 at another copy of the validator source (e.g.
 * `git show <commit>:<path>` before the change), and `GINA_B921_DIST_DIR=<dir>` points §05 at another
 * directory holding gina.js and gina.min.js. On the pre-fix copies the non-control tests fail.
 *
 * Run: node --test test/core/validator-case-regex-key-b921.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');

var MAIN     = process.env.GINA_B921_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B921_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

var SRC = fs.readFileSync(MAIN, 'utf8');

// ---------------------------------------------------------------------------
// Slicing
// ---------------------------------------------------------------------------
var FE_DECL       = 'var forEachField = function($formOrElement, allFields, allRules, fields, $fields, rules, cb, i) {';
var FE_END_ANCHOR = 'addListener(gina, $formOrElement, evt';
var EXPAND_DECL   = 'var expandCaseRegExpKeys = function(levelRules, $levelFields) {';
var TARGET_DECL   = 'var isCaseConditionTarget = function(rules, field) {';
var CASE_RE_DECL  = 'var getCaseRegExp = function(caseDef) {';
var PARSING_LINE  = "//console.debug('parsing ', fields, $fields, rules);";
var CALL          = 'caseRegExpKeyNames = expandCaseRegExpKeys(rules, $fields);';
var SKIP_GUARD    = "caseRegExpKeyNames['_case_' + field + '|' + c][f]";
var DIRECT_LOOP   = "for (var f in conditions[c]['rules']) {";
var BRACKET_ESCAPE = "re.replace(/\\[/g, '\\\\[')";

function sliceForEachField(src) {
    var s = src.indexOf(FE_DECL);
    if (s < 0) { throw new Error('forEachField declaration not found'); }
    if (src.indexOf(FE_DECL, s + 1) !== -1) { throw new Error('forEachField declaration not unique'); }
    var e = src.indexOf(FE_END_ANCHOR, s);
    if (e < 0) { throw new Error('forEachField end anchor not found'); }
    return src.substring(s, src.lastIndexOf('}', e) + 1);
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
function cutFunction(text, decl) {
    var s = text.indexOf(decl);
    if (s < 0) { throw new Error(decl + ' not found'); }
    if (text.indexOf(decl, s + 1) !== -1) { throw new Error(decl + ' not unique'); }
    var e = matchBrace(text, s);
    if (e < 0) { throw new Error(decl + ' not closed'); }
    return text.substring(s, e + 1).replace(/^var [A-Za-z]+ = /, '');
}
// Lines that are not comments (good enough for needles; never compiled).
function activeLines(s) {
    return s.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
}
function count(hay, needle) {
    return hay.split(needle).length - 1;
}

var feSrc = sliceForEachField(SRC);

// ---------------------------------------------------------------------------
// Harness — forEachField compiled with its free identifiers as parameters (the list of the sibling
// case tests). The checkFieldAgainstRules spy mirrors the real function's `delete fields[field]` after
// an applied rule; the engine stub `d` holds one key per field and, like FormValidator's addField,
// ignores a name it already holds. `merge(a, b)`: `a` wins, nested objects merged (the lib/merge default).
// ---------------------------------------------------------------------------
var FE_PARAMS = [
    'isGFFCtx', '$allFields', 'checkFieldAgainstRules', 'merge',
    'subLevelRules', 'fieldErrorsAttributes', 'd', 'formatData', 'envIsDev',
    'gina', 'window', 'triggerEvent', 'addListener', 'removeListener',
    'instance', 'evt', 'hasParsedAllRules', 'hasBeenValidated', 'asyncCount',
    'data', 'id', 're', 'flags', 'caseField', 'console',
    '__allFields', '__allRules', '__fields', '__$fields', '__rules'
];
function compileFE(src) {
    return new Function(FE_PARAMS.join(','),
        src + '\nreturn forEachField(null, __allFields, __allRules, __fields, __$fields, __rules, undefined, 0);');
}
function deepMerge(a, b) {
    if (typeof a !== 'object' || a === null) return (typeof a === 'undefined') ? b : a;
    var o = {}, k;
    for (k in b) o[k] = b[k];
    for (k in a) o[k] = (typeof a[k] === 'object' && a[k] !== null && typeof b[k] === 'object' && b[k] !== null) ? deepMerge(a[k], b[k]) : a[k];
    return o;
}
function clone(o) {
    return JSON.parse(JSON.stringify(o));
}
/**
 * A control stub: forEachField reads `getAttribute('type')`, `.type`, `.checked`, `.value`, `.disabled`.
 *
 * @param {string} name
 * @param {string} type - `text`, `radio`, `checkbox`, `hidden`
 * @param {string} value
 * @param {boolean} [checked]
 * @returns {object}
 */
function mkControl(name, type, value, checked) {
    return {
        name: name, type: type, value: value, tagName: 'INPUT', checked: !!checked, disabled: false, id: name + '-1',
        getAttribute: function (a) { if (a === 'type') return type; if (a === 'id') return this.id; return null; },
        setAttribute: function () {}
    };
}
/**
 * Runs forEachField once on fresh copies of the fixture.
 *
 * @param {string} src - the forEachField slice
 * @param {{rules: object, fields: object, $fields: object}} opts
 * @returns {{applied: Array<object>, added: Array<object>, warns: Array<string>, thrown: (string|null)}}
 */
function driveFE(src, opts) {
    var applied = [], added = [], warns = [];
    var spy = function (name, rulesArg, fieldsArg) {
        var rule = rulesArg[name] || {};
        applied.push({ name: name, rule: clone(rule), value: fieldsArg[name] });
        if (typeof (rulesArg[name]) != 'undefined' && Object.keys(rule).length > 0) delete fieldsArg[name];
    };
    var d = {
        addField: function (el, value) {
            if (typeof (d[el]) != 'undefined') { return; }
            added.push({ name: el, value: value });
            d[el] = { name: el, value: value };
        },
        getErrors: function () { return {}; }, toData: function () { return {}; }, isValid: function () { return true; }
    };
    Object.keys(opts.fields).forEach(function (k) { d[k] = { name: k, value: opts.fields[k] }; });
    var con = { warn: function () { warns.push(Array.prototype.join.call(arguments, ' ')); }, debug: function () {}, log: function () {} };
    var thrown = null;
    try {
        compileFE(src)(true, opts.$fields, spy, deepMerge, 0, {}, d, function (x) { return x; }, false, {}, {},
            function () {}, function () {}, function () {}, {}, 'validated.x', false, false, 0, null, 'x', null, null, null, con,
            clone(opts.fields), clone(opts.rules), clone(opts.fields), opts.$fields, clone(opts.rules));
    } catch (err) { thrown = String(err && err.message || err); }
    return { applied: applied, added: added, warns: warns, thrown: thrown };
}
function controls(list) {
    var o = {};
    list.forEach(function (c) { o[c.name] = c; });
    return o;
}
// The form most arms use: a required text field, a radio driver set to `a`, a text `x`, a hidden boolean
// driver, two amount fields, an unticked and a ticked value-carrying checkbox.
function baseControls(mode) {
    return controls([
        mkControl('ref', 'text', 'r'),
        mkControl('mode', 'radio', mode || 'a', true),
        mkControl('x', 'text', 'xv'),
        mkControl('flag', 'hidden', 'true'),
        mkControl('item[0][amount]', 'text', ''),
        mkControl('item[1][amount]', 'text', '5'),
        mkControl('g', 'radio', 'g1', false),
        mkControl('inv[1][id]', 'checkbox', '1', false),
        mkControl('inv[2][id]', 'checkbox', '2', true)
    ]);
}
var NEVER = { conditions: [ { case: 'never', rules: { g: { isRequired: true } } } ] };
// the checks the spy saw on the fields `re` names, as `name:rule=value` strings
function checksOn(run, re) {
    return run.applied.filter(function (c) { return re.test(c.name); })
        .map(function (c) { return c.name + ':' + JSON.stringify(c.rule) + '=' + JSON.stringify(c.value); });
}

// ---------------------------------------------------------------------------
// expandCaseRegExpKeys compiled on its own, with a console that records its warnings
// ---------------------------------------------------------------------------
function loadExpand() {
    var warns = [];
    var fn = new Function('console', 'return ' + cutFunction(feSrc, EXPAND_DECL) + ';')({
        warn: function () { warns.push(Array.prototype.join.call(arguments, ' ')); }
    });
    return { expand: fn, warns: warns };
}
function loadTarget() {
    return new Function('return ' + cutFunction(SRC, TARGET_DECL) + ';')();
}

// ============================================================================
// §01 — source pins
// ============================================================================
describe('validator-case-regex-key-b921 §01 — source pins', function () {

    it('01.1 - #B921: expandCaseRegExpKeys is declared once inside forEachField, before getCaseRegExp', function () {
        var active = activeLines(feSrc);
        assert.equal(count(active, EXPAND_DECL), 1, 'declared inside the forEachField slice');
        assert.ok(feSrc.indexOf(EXPAND_DECL) < feSrc.indexOf(CASE_RE_DECL), 'before getCaseRegExp, so the #B918 slice (getCaseRegExp to the parsing line) holds nothing new');
    });

    it('01.2 - #B921: it runs once per level, after the parsing line and before the field loop', function () {
        var active = activeLines(feSrc);
        assert.equal(count(active, CALL), 1);
        var p = feSrc.indexOf(PARSING_LINE), c = feSrc.indexOf(CALL), l = feSrc.indexOf('for (var field in fields) {', p);
        assert.ok(p > -1 && c > p && l > c, 'parsing line < call < field loop');
    });

    it('01.3 - #B921: the direct-case loop skips the names the expansion added', function () {
        var loop = feSrc.indexOf(DIRECT_LOOP);
        assert.ok(loop > -1, 'the direct-case loop is there');
        assert.equal(count(activeLines(feSrc), SKIP_GUARD), 1);
        assert.ok(feSrc.indexOf(SKIP_GUARD) > loop && feSrc.indexOf(SKIP_GUARD) < loop + 600, 'the guard opens the loop body');
    });

    it('01.4 - #B921: isCaseConditionTarget tests a RegExp key', function () {
        assert.ok(cutFunction(SRC, TARGET_DECL).indexOf('keyRe.test(field)') > -1);
    });

    it('01.5 - CONTROL: the RegExp branches that read field names keep their bracket escape (3), the case helper has none', function () {
        assert.equal(count(activeLines(feSrc), BRACKET_ESCAPE), 3, 'the condition scan\'s RegExp branch and the direct-case loop\'s two');
        var helper = feSrc.substring(feSrc.indexOf(CASE_RE_DECL), feSrc.indexOf(PARSING_LINE));
        assert.ok(helper.length > 100, 'the getCaseRegExp slice is found');
        assert.equal(helper.indexOf('.replace(/\\['), -1, 'a case pattern matches values: no bracket escaping');
    });

    it('01.6 - CONTROL: the harness finds forEachField and isCaseConditionTarget once', function () {
        assert.equal(count(SRC, FE_DECL), 1);
        assert.equal(count(SRC, TARGET_DECL), 1);
    });
});

// ============================================================================
// §02 — expandCaseRegExpKeys, called directly
// ============================================================================
describe('validator-case-regex-key-b921 §02 — expandCaseRegExpKeys', function () {

    it('02.1 - #B921: a RegExp key gives each control it matches a literal key holding its rules', function () {
        var x = loadExpand();
        var rules = { _case_kind: { conditions: [ { case: 'pro', rules: { '/^item[/': { isRequired: true } } } ] } };
        var added = x.expand(rules, controls([mkControl('kind', 'radio', 'pro', true), mkControl('item[0][a]', 'text', ''),
            mkControl('item[1][a]', 'text', ''), mkControl('other', 'text', '')]));
        assert.deepEqual(added, { '_case_kind|0': { 'item[0][a]': true, 'item[1][a]': true } });
        assert.deepEqual(rules._case_kind.conditions[0].rules, {
            '/^item[/': { isRequired: true }, 'item[0][a]': { isRequired: true }, 'item[1][a]': { isRequired: true }
        });
        assert.deepEqual(x.warns, []);
    });

    it('02.2 - #B921: `[` and `]` are read literally, and the flags are kept', function () {
        var x = loadExpand();
        var rules = { _case_k: { conditions: [ { case: 1, rules: { '/^item[0]/': { a: 1 }, '/^OTHER[/i': { b: 1 } } } ] } };
        x.expand(rules, controls([mkControl('k', 'hidden', '1'), mkControl('item[0][x]', 'text', ''), mkControl('item0', 'text', ''),
            mkControl('other[1]', 'text', '')]));
        var r = rules._case_k.conditions[0].rules;
        assert.deepEqual(r['item[0][x]'], { a: 1 }, '`[0]` is the three characters [, 0, ]');
        assert.equal(typeof r.item0, 'undefined', 'not a character class');
        assert.deepEqual(r['other[1]'], { b: 1 }, 'the `i` flag is kept');
    });

    it('02.3 - #B921: a literal key of the condition wins, then the first RegExp key that matches', function () {
        var x = loadExpand();
        var rules = { _case_k: { conditions: [ { case: 1, rules: {
            '/^f/': { first: true }, '/^f[/': { second: true }, 'f[lit]': { literal: true } } } ] } };
        var added = x.expand(rules, controls([mkControl('k', 'hidden', '1'), mkControl('f[lit]', 'text', ''), mkControl('f[1]', 'text', '')]));
        var r = rules._case_k.conditions[0].rules;
        assert.deepEqual(r['f[lit]'], { literal: true });
        assert.deepEqual(r['f[1]'], { first: true });
        assert.deepEqual(added, { '_case_k|0': { 'f[1]': true } });
    });

    it('02.4 - #B921: the block\'s driver is left out', function () {
        var x = loadExpand();
        var rules = { '_case_item[0]': { conditions: [ { case: 'a', rules: { '/^item[/': { isRequired: true } } } ] } };
        x.expand(rules, controls([mkControl('item[0]', 'text', 'a'), mkControl('item[1]', 'text', '')]));
        var r = rules['_case_item[0]'].conditions[0].rules;
        assert.equal(typeof r['item[0]'], 'undefined', 'the driver gets no key');
        assert.deepEqual(r['item[1]'], { isRequired: true });
    });

    it('02.5 - #B921: each added key is its own copy of plain data; a non-plain value is kept as it is', function () {
        var x = loadExpand();
        var pattern = /abc/;
        var rules = { _case_k: { conditions: [ { case: 1, rules: { '/^f/': { isString: [1, 2], is: pattern } } } ] } };
        x.expand(rules, controls([mkControl('k', 'hidden', '1'), mkControl('f1', 'text', ''), mkControl('f2', 'text', '')]));
        var r = rules._case_k.conditions[0].rules;
        assert.notEqual(r.f1, r.f2, 'distinct objects');
        assert.notEqual(r.f1, r['/^f/'], 'not the RegExp key\'s object');
        assert.notEqual(r.f1.isString, r['/^f/'].isString, 'arrays copied too');
        r.f1.isString.push(3);
        r.f1.extra = true;
        assert.deepEqual(r.f2.isString, [1, 2]);
        assert.equal(typeof r.f2.extra, 'undefined');
        assert.equal(r.f1.is, pattern, 'a RegExp value is kept by reference');
    });

    it('02.6 - #B921: a `g` flag does not make the test skip a name', function () {
        var x = loadExpand();
        var rules = { _case_k: { conditions: [ { case: 1, rules: { '/^f/g': { a: 1 } } } ] } };
        x.expand(rules, controls([mkControl('k', 'hidden', '1'), mkControl('f1', 'text', ''), mkControl('f2', 'text', ''), mkControl('f3', 'text', '')]));
        var r = rules._case_k.conditions[0].rules;
        assert.ok(r.f1 && r.f2 && r.f3, 'every name matched');
    });

    it('02.7 - #B921: a pattern the engine rejects warns and is skipped; a key without a closing slash too', function () {
        var x = loadExpand();
        var rules = { _case_k: { conditions: [ { case: 1, rules: { '/^f(/': { a: 1 }, '/nope': { b: 1 }, '/^g/': { c: 1 } } } ] } };
        var added = x.expand(rules, controls([mkControl('k', 'hidden', '1'), mkControl('f(1', 'text', ''), mkControl('g1', 'text', '')]));
        assert.deepEqual(added, { '_case_k|0': { g1: true } }, 'the valid key still expands');
        assert.equal(x.warns.length, 2, 'one warning per rejected key');
        assert.ok(/cannot be read as a regular expression/.test(x.warns[0]));
    });

    it('02.8 - #B921: without controls (the server path) or without rules nothing is added and nothing throws', function () {
        var x = loadExpand();
        var rules = { _case_k: { conditions: [ { case: 1, rules: { '/^f/': { a: 1 } } } ] } };
        assert.deepEqual(x.expand(rules, null), {});
        assert.deepEqual(Object.keys(rules._case_k.conditions[0].rules), ['/^f/']);
        assert.deepEqual(x.expand(undefined, controls([mkControl('f', 'text', '')])), {});
        assert.deepEqual(x.expand({ _case_k: null, _case_j: { conditions: 'x' }, _case_i: { conditions: [null, { case: 1 }] } },
            controls([mkControl('f', 'text', '')])), {});
    });

    it('02.9 - #B921: a `$` that names no field stays in the key and anchors it: it matches nothing', function () {
        var x = loadExpand();
        var rules = { _case_k: { conditions: [ { case: 1, rules: { '/^item[$pid][amount]/': { isRequired: true } } } ] } };
        var added = x.expand(rules, controls([mkControl('k', 'hidden', '1'), mkControl('item[p1][amount]', 'text', ''),
            mkControl('item[$pid][amount]', 'text', '')]));
        assert.deepEqual(added, {});
    });
});

// ============================================================================
// §03 — the forEachField slice: the RegExp key applies as its literal twin does
// ============================================================================
describe('validator-case-regex-key-b921 §03 — forEachField', function () {

    function twinRun(caseDef, keyRule, extraRules, mode, fields) {
        var rx = { ref: { isRequired: true } }, lit = { ref: { isRequired: true } };
        var re = {}; re['/^x$/'] = keyRule;
        rx._case_mode = { conditions: [ { case: caseDef, rules: re } ] };
        lit._case_mode = { conditions: [ { case: caseDef, rules: { x: keyRule } } ] };
        Object.keys(extraRules || {}).forEach(function (k) { rx[k] = extraRules[k]; lit[k] = extraRules[k]; });
        var f = fields || { ref: 'r', mode: mode || 'a', x: 'xv' };
        return {
            rx: driveFE(feSrc, { rules: rx, fields: f, $fields: baseControls(mode) }),
            lit: driveFE(feSrc, { rules: lit, fields: f, $fields: baseControls(mode) })
        };
    }

    it('03.1 - #B921: single block, plain case: the field is checked with the key\'s rules, as with a literal key', function () {
        var r = twinRun('a', { exclude: true });
        assert.equal(r.rx.thrown, null);
        assert.deepEqual(checksOn(r.rx, /^x$/), checksOn(r.lit, /^x$/));
        assert.ok(checksOn(r.rx, /^x$/).length > 0, 'applied (pre-fix: never)');
    });

    it('03.2 - #B921: an Array case and a regexp case, single block: likewise', function () {
        [['a', 'b'], '/^(a|b)$/'].forEach(function (caseDef) {
            var r = twinRun(caseDef, { exclude: true });
            assert.ok(checksOn(r.rx, /^x$/).length > 0, JSON.stringify(caseDef) + ': applied');
            assert.deepEqual(checksOn(r.rx, /^x$/), checksOn(r.lit, /^x$/), JSON.stringify(caseDef));
        });
    });

    it('03.3 - #B921: a boolean case, single block: every matched amount is checked with isRequired', function () {
        var rules = { flag: { isBoolean: true }, _case_flag: { conditions: [ { case: true, rules: { '/^item[/': { isRequired: true } } } ] } };
        var run = driveFE(feSrc, { rules: rules, fields: { flag: true, 'item[0][amount]': '', 'item[1][amount]': '5' }, $fields: baseControls() });
        assert.equal(run.thrown, null);
        assert.deepEqual(checksOn(run, /^item\[/), ['item[0][amount]:{"isRequired":true}=""', 'item[1][amount]:{"isRequired":true}="5"']);
    });

    it('03.4 - #B921: the RegExp-key block LAST of two: applied, as with a literal key', function () {
        var r = twinRun('a', { exclude: true }, { _case_ref: NEVER });
        assert.ok(checksOn(r.rx, /^x$/).length > 0, 'applied (pre-fix: never)');
        assert.deepEqual(checksOn(r.rx, /^x$/), checksOn(r.lit, /^x$/));
    });

    it('03.5 - CONTROL: the RegExp-key block FIRST of two: applied (through the recursion before the fix too)', function () {
        var rules = { _case_mode: { conditions: [ { case: 'a', rules: { '/^x$/': { exclude: true } } } ] }, ref: { isRequired: true }, _case_ref: NEVER };
        var run = driveFE(feSrc, { rules: rules, fields: { ref: 'r', mode: 'a', x: 'xv' }, $fields: baseControls() });
        assert.equal(run.thrown, null);
        assert.ok(checksOn(run, /^x$/).some(function (c) { return c.indexOf('{"exclude":true}') > -1; }));
    });

    it('03.6 - #B921: an unticked value-carrying checkbox the key requires is entered as "" and checked (#B914), as with a literal key', function () {
        var rx = { ref: { isRequired: true }, flag: { isBoolean: true }, _case_flag: { conditions: [ { case: true, rules: { '/^inv[/': { isRequired: true } } } ] } };
        var lit = { ref: { isRequired: true }, flag: { isBoolean: true }, _case_flag: { conditions: [ { case: true, rules: { 'inv[1][id]': { isRequired: true }, 'inv[2][id]': { isRequired: true } } } ] } };
        var f = { ref: 'r', flag: true, 'inv[2][id]': '2' };
        var a = driveFE(feSrc, { rules: rx, fields: f, $fields: baseControls() });
        var b = driveFE(feSrc, { rules: lit, fields: f, $fields: baseControls() });
        assert.deepEqual(a.added, [{ name: 'inv[1][id]', value: '' }], 'entered as the empty value (pre-fix: never)');
        assert.ok(checksOn(a, /^inv\[1\]/).indexOf('inv[1][id]:{"isRequired":true}=""') > -1);
        assert.deepEqual(checksOn(a, /^inv\[/), checksOn(b, /^inv\[/), 'the trace of the literal twin');
    });

    it('03.7 - #B921: a non-last block\'s recursion keeps the base rule of an uncollected field it pulls in; SUBTRACT: without the skip it is lost', function () {
        var rules = { 'u[1]': { isEmail: true }, _case_mode: { conditions: [ { case: 'a', rules: { '/^u[/': { isRequired: true } } } ] },
            ref: { isRequired: true }, _case_ref: NEVER };
        var $f = baseControls();
        $f['u[1]'] = mkControl('u[1]', 'checkbox', 'a@b.c', false);
        var f = { ref: 'r', mode: 'a' };
        var run = driveFE(feSrc, { rules: rules, fields: f, $fields: $f });
        var last = checksOn(run, /^u\[/).pop();
        assert.equal(last, 'u[1]:{"isEmail":true,"isRequired":true}=undefined', 'the recursion merges the base rule, as before the fix');
        // subtract: the same slice with the skip guard removed
        var guardStart = feSrc.indexOf("                                    if (\n                                        caseRegExpKeyNames\n");
        assert.ok(guardStart > -1, 'the guard is there to subtract');
        var guardEnd = feSrc.indexOf(') continue;\n', guardStart) + ') continue;\n'.length;
        var noSkip = feSrc.substring(0, guardStart) + feSrc.substring(guardEnd);
        var sub = driveFE(noSkip, { rules: rules, fields: f, $fields: $f });
        assert.equal(sub.thrown, null);
        assert.equal(checksOn(sub, /^u\[/).pop(), 'u[1]:{"isRequired":true}=undefined', 'without the skip the base rule is lost');
    });

    it('03.8 - CONTROL: a case that does not match applies nothing', function () {
        var r = twinRun('a', { exclude: true }, null, 'b', { ref: 'r', mode: 'b', x: 'xv' });
        assert.deepEqual(checksOn(r.rx, /^x$/), []);
        assert.deepEqual(checksOn(r.lit, /^x$/), []);
    });

    it('03.9 - CONTROL: a literal key in a single block is checked (the reference the twins compare to)', function () {
        var r = twinRun('a', { exclude: true });
        assert.ok(checksOn(r.lit, /^x$/).length > 0);
        assert.equal(r.lit.thrown, null);
    });
});

// ============================================================================
// §04 — isCaseConditionTarget
// ============================================================================
describe('validator-case-regex-key-b921 §04 — isCaseConditionTarget', function () {

    var RULES = {
        ref: { isRequired: true },
        _case_kind: { conditions: [
            { case: 'a', rules: { other: { isRequired: false } } },
            { case: 'b', rules: { '/^item[/': { isRequired: true }, '/^re[g]ex$/': { isRequired: true }, '/^bad(/': { a: 1 } } }
        ] }
    };

    it('04.1 - #B921: true for a field a RegExp key of any condition matches, `[` and `]` read literally', function () {
        var is = loadTarget();
        assert.equal(is(RULES, 'item[0][id]'), true);
        assert.equal(is(RULES, 're[g]ex'), true);
    });

    it('04.2 - CONTROL: false for the driver, for a name no key matches (`[g]` is no class), for an invalid pattern; exact keys still true', function () {
        var is = loadTarget();
        assert.equal(is(RULES, 'kind'), false);
        assert.equal(is(RULES, 'regex'), false);
        assert.equal(is(RULES, 'bad(1'), false);
        assert.equal(is(RULES, 'ref'), false);
        assert.equal(is(RULES, 'other'), true);
        assert.equal(is({ _case_item: { conditions: [ { case: 1, rules: { '/^item/': { a: 1 } } } ] } }, 'item'), false, 'the driver of the block');
    });
});

// ============================================================================
// §05 — both bundles
// ============================================================================
describe('validator-case-regex-key-b921 §05 — bundles', function () {

    it('05.1 - gina.js carries the helper, the call and the skip verbatim', function () {
        var fe = sliceForEachField(fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8'));
        assert.equal(count(fe, EXPAND_DECL), 1);
        assert.equal(count(fe, CALL), 1);
        assert.equal(count(fe, SKIP_GUARD), 1);
    });

    it('05.2 - gina.min.js carries the expansion\'s warning text (Closure keeps string literals)', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        assert.equal(count(min, '): it is skipped'), 1);
    });

    it('05.3 - CONTROL: gina.min.js carries getCaseRegExp\'s warning text', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        assert.equal(count(min, '): it is compared as a value'), 1);
    });
});
