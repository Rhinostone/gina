'use strict';

/**
 * validator — a master id holding a regexp character is matched literally (#B929)
 *
 * The five places that match a field's `data-gina-form-element-group` against a master's id
 * (updateReletadItems, updateCheckBox, updateGroupChildrenState, handleGroupDependencies, the
 * bind-time checkbox loop) build `new RegExp('(^|\\s)' + <escaped id> + '(\\s|$)')`. The escape
 * covered `- _ @ # . [ ]` only, so `a+b` matched `ab`, `a*b` matched `ab` and `aaab`, `a$b`
 * matched nothing, and `a(b` threw at bind. Every regexp character of the id is now escaped.
 * updateReletadItems also built a second expression from the checkbox's own group as written;
 * its result never mattered (`re && re2 || re` is `re`), and it threw for a group naming a master
 * whose id holds `(`. It is gone.
 *
 * Same harness as test/core/validator-element-group-token-b923.test.js: the group functions are
 * sliced out of the validator source and compiled with bindForm's free identifiers as parameters.
 * Red-first: `GINA_B929_MAIN_SRC=<file>` points §01–§03 at another copy of the validator source,
 * `GINA_B929_DIST_DIR=<dir>` points §04 at another dist (gina.js + gina.min.js). On the copies
 * before the change the #B929 arms fail and the controls pass.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW       = require('../fw');
var MAIN     = process.env.GINA_B929_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B929_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');
var SRC      = fs.readFileSync(MAIN, 'utf8');

/** Drops whole-line comments (`//`, `/*`, ` *`), so a pin never matches prose or a `// was:` record. */
function activeLines(src) {
    return src.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
}

/** The text between two anchors, each of which must occur exactly once. */
function between(src, from, to, label) {
    var s = src.indexOf(from);
    if (s < 0) { throw new Error(label + ': start anchor not found'); }
    if (src.indexOf(from, s + 1) !== -1) { throw new Error(label + ': start anchor not unique'); }
    var e = src.indexOf(to, s);
    if (e < 0) { throw new Error(label + ': end anchor not found'); }
    if (src.indexOf(to, e + 1) !== -1) { throw new Error(label + ': end anchor not unique'); }
    return src.substring(s, e);
}

/** Counts the occurrences of `needle` in `text`. */
function count(text, needle) { return text.split(needle).length - 1; }

// ---------------------------------------------------------------------------
// Extraction — the same slices as the #B923 test
// ---------------------------------------------------------------------------
var A_START    = 'var updateReletadItems = function(elId, group, excluded, isCalledHasDependency) {';
var C_START    = 'var updateCheckBox = function($el, isInit) {';
var B_START    = 'var updateGroupChildrenState = function($groupMaster) {';
var B_END      = '        // BO Binding radio';
var LOOP_START = '// if is master of a group, init children default state';
var LOOP_END   = 'for (let childElement in allFormGroupedElements ) {';

// The escape, as the change writes it and as it read before. `${` would open a substitution in a
// template literal, so the new one is assembled around it.
var ESC_NEW = String.raw`replace(/[.*+?^$` + '{}' + String.raw`()|[\]\\]/g, '\\$&')`;
var ESC_OLD = String.raw`replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&')`;
var SITES = {
    updateReletadItems:       'namedId = elId.',
    updateCheckBox:           'var re              = new RegExp(\'(^|\\\\s)\' + $el.id.',
    updateGroupChildrenState: 'var re = new RegExp(\'(^|\\\\s)\' + $groupMaster.id.',
    handleGroupDependencies:  'var extendedGroupName = $el.id.',
    bindLoop:                 'let re = new RegExp( \'(^|\\\\s)\' + $inputs[i].id.'
};
var RE2_OLD = 're2 = new RegExp(group);';
var COND_NEW = 'if ( re.test(allFormGroupedElements[id].group) ) {';

function sliceA(src)    { return between(src, A_START, C_START, 'slice A'); }
function sliceC(src)    { return between(src, C_START, B_START, 'slice C'); }
function sliceB(src)    { return between(src, B_START, B_END, 'slice B'); }
function sliceLoop(src) { return between(src, LOOP_START, LOOP_END, 'the bind-time loop'); }

var aSrc = sliceA(SRC);
var cSrc = sliceC(SRC);
var bSrc = sliceB(SRC);

/** Compiles the three slices with bindForm's free identifiers as parameters. */
function compile(a, c, b) {
    return new Function('allFormGroupedElements', '$form', 'withRules', 'isCheckboxValueAsState', a + '\n' + c + '\n' + b
        + '\nreturn { updateReletadItems: updateReletadItems, handleCheckBoxGroupDependencies: handleCheckBoxGroupDependencies,'
        + ' updateCheckBox: updateCheckBox, updateGroupChildrenState: updateGroupChildrenState,'
        + ' handleGroupDependencies: handleGroupDependencies };');
}

/** A control stub. `group` is its data-gina-form-element-group; `value` its value attribute. */
function ctl(id, type, o) {
    o = o || {};
    var attrs = { 'data-gina-form-element-group': o.group || null, value: o.value || null };
    return {
        id: id, name: id, type: type, checked: !!o.checked, disabled: !!o.disabled, value: o.value || '',
        getAttribute: function (a) { return Object.prototype.hasOwnProperty.call(attrs, a) ? attrs[a] : null; },
        setAttribute: function (a, v) { attrs[a] = String(v); },
        removeAttribute: function (a) { attrs[a] = null; }
    };
}

/** The bind-time map of grouped controls (every control given a `group`) and a fresh rule set. */
function scene(controls, slices) {
    slices = slices || {};
    var grouped = {}, byId = {};
    controls.forEach(function (c) {
        byId[c.id] = c;
        var g = c.getAttribute('data-gina-form-element-group');
        if (g) { grouped[c.id] = { id: c.id, name: c.name, group: g, target: c }; }
    });
    var $form = { rules: {} };
    var notLegacy = function () { return false; };
    return { fns: compile(slices.a || aSrc, slices.c || cSrc, slices.b || bSrc)(grouped, $form, true, notLegacy), byId: byId, $form: $form };
}

/** A checked radio master `id` with a hidden field `f` naming it, plus a radio `other` the field does not name. */
function radioWithField(id) {
    return [
        ctl(id, 'radio', { checked: true }),
        ctl('f', 'hidden', { group: id, disabled: true }),
        ctl('other', 'radio', { checked: false }),
        ctl('g', 'hidden', { group: 'other', disabled: true })
    ];
}

/** Waits past updateCheckBox's setTimeout(0). */
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

// The ids under test: one per regexp character the old escape left raw, plus the shapes that worked.
var RAW_IDS = ['a+b', 'a*b', 'a?b', 'a$b', 'a^b', 'a(b)', 'a{2}b', 'a\\b', 'a(b'];
// `a|b` matched before too, by accident (`^a` finds it): it belongs with the ids that always worked
var OK_IDS  = ['a-b', 'a.b', 'a[0]', 'a_b', 'a@b', 'a#b', 'a|b', 'plain'];

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-element-group-escape-b929 §01 — extraction + controls', function () {

    it('01.1 - CONTROL: the three slices resolve, hold their functions, and compile', function () {
        assert.equal(aSrc.indexOf(A_START), 0);
        assert.equal(cSrc.indexOf(C_START), 0);
        assert.equal(bSrc.indexOf(B_START), 0);
        var fns = compile(aSrc, cSrc, bSrc)({}, { rules: {} }, true, function () { return false; });
        ['updateReletadItems', 'handleCheckBoxGroupDependencies', 'updateCheckBox', 'updateGroupChildrenState', 'handleGroupDependencies']
            .forEach(function (k) { assert.equal(typeof fns[k], 'function', k); });
    });

    it('01.2 - CONTROL: the harness reaches the code — a checked radio with a plain id enables the field naming it', function () {
        var sc = scene(radioWithField('plain'));
        sc.fns.handleGroupDependencies(sc.byId.plain);
        assert.equal(sc.byId.f.disabled, false);
        assert.equal(sc.byId.g.disabled, true, 'g names the unchecked radio');
    });
});

// ---------------------------------------------------------------------------
// §02 — source pins
// ---------------------------------------------------------------------------
describe('validator-element-group-escape-b929 §02 — source pins', function () {

    it('02.1 - #B929: each of the five places escapes every regexp character of the id', function () {
        var active = activeLines(SRC);
        Object.keys(SITES).forEach(function (k) {
            assert.equal(count(active, SITES[k] + ESC_NEW), 1, k);
        });
        // the five sites, plus the name-prefix `formElementGroup` regexp of the bind, which escaped this way before
        assert.equal(count(active, ESC_NEW), 6, 'the five sites and the bind-time name regexp');
    });

    it('02.2 - #B929: the old escape is left at no match site, and the second expression of updateReletadItems is gone', function () {
        var active = activeLines(SRC);
        Object.keys(SITES).forEach(function (k) {
            assert.equal(count(active, SITES[k] + ESC_OLD), 0, k);
        });
        assert.equal(count(activeLines(aSrc), RE2_OLD), 0, 're2 is no longer built');
        assert.equal(count(activeLines(aSrc), COND_NEW), 1, 'the condition is the one test');
    });

    it('02.3 - CONTROL: the raw text still carries the old constructions, so 02.2 cannot pass vacuously', function () {
        Object.keys(SITES).forEach(function (k) {
            assert.equal(count(SRC, SITES[k] + ESC_OLD), 1, k);
        });
        assert.equal(count(aSrc, RE2_OLD), 1);
    });
});

// ---------------------------------------------------------------------------
// §03 — a master drives the field naming its id, whatever characters the id holds
// ---------------------------------------------------------------------------
describe('validator-element-group-escape-b929 §03 — a master drives the field naming its id, whatever the id holds', function () {

    RAW_IDS.forEach(function (id) {
        it('03.1 - #B929: a checked radio `' + id + '` enables the field naming it (handleGroupDependencies)', function () {
            var sc = scene(radioWithField(id));
            sc.fns.handleGroupDependencies(sc.byId[id]);
            assert.equal(sc.byId.f.disabled, false, 'f names ' + id);
            assert.equal(sc.$form.rules.f.exclude, false);
            assert.equal(sc.byId.g.disabled, true, 'CONTROL: g names the unchecked radio');
        });
    });

    OK_IDS.forEach(function (id) {
        it('03.2 - CONTROL: a checked radio `' + id + '` enables the field naming it, as before', function () {
            var sc = scene(radioWithField(id));
            sc.fns.handleGroupDependencies(sc.byId[id]);
            assert.equal(sc.byId.f.disabled, false, 'f names ' + id);
        });
    });

    it('03.3 - #B929: a ticked checkbox master `c+1` enables its field, not the field of `c1` (updateCheckBox)', async function () {
        var sc = scene([
            ctl('c+1', 'checkbox', { checked: true, value: 'v' }),
            ctl('k', 'hidden', { group: 'c+1', disabled: true }),
            ctl('c1', 'checkbox', { checked: false, value: 'w' }),
            ctl('m', 'hidden', { group: 'c1', disabled: true })
        ]);
        sc.fns.updateCheckBox(sc.byId['c+1'], false);
        await tick();
        assert.equal(sc.byId.k.disabled, false, 'k names c+1, which is ticked');
        assert.equal(sc.byId.m.disabled, true, 'm names c1, which is unticked');
    });

    it('03.4 - #B929: under a checked radio, the ticked checkbox `d*2` drives the field naming it (updateGroupChildrenState)', function () {
        var sc = scene([
            ctl('flow', 'radio', { checked: true }),
            ctl('d*2', 'checkbox', { checked: true, group: 'flow', value: 'x' }),
            ctl('e', 'hidden', { group: 'flow d*2', disabled: true }),
            ctl('d2', 'checkbox', { checked: false, group: 'flow', value: 'y' }),
            ctl('h', 'hidden', { group: 'flow d2', disabled: true })
        ]);
        sc.fns.updateGroupChildrenState(sc.byId.flow);
        assert.equal(sc.byId.e.disabled, false, 'e names d*2, which is ticked');
        assert.equal(sc.byId.h.disabled, true, 'h names d2, which is unticked');
    });

    it('03.5 - #B929: a checkbox grouped under the master `fl(ow` reaches its fields (updateReletadItems no longer throws)', function () {
        var sc = scene([
            ctl('fl(ow', 'radio', { checked: true }),
            ctl('doc', 'checkbox', { checked: true, group: 'fl(ow', value: 'x' }),
            ctl('d1', 'hidden', { group: 'fl(ow doc', disabled: true })
        ]);
        sc.fns.handleCheckBoxGroupDependencies(sc.$form, sc.byId.doc, 'fl(ow');
        assert.equal(sc.byId.d1.disabled, false, 'd1 names fl(ow and doc, both on');
    });

    it('03.6 - CONTROL: `a+b` drives only the field naming it — `ab` and `a+bc` stay off', function () {
        var sc = scene([
            ctl('a+b', 'radio', { checked: true }),
            ctl('f', 'hidden', { group: 'a+b', disabled: true }),
            ctl('n1', 'hidden', { group: 'ab', disabled: true }),
            ctl('n2', 'hidden', { group: 'a+bc', disabled: true })
        ]);
        sc.fns.handleGroupDependencies(sc.byId['a+b']);
        assert.equal(sc.byId.f.disabled, false);
        assert.equal(sc.byId.n1.disabled, true, 'ab is not a+b');
        assert.equal(sc.byId.n2.disabled, true, 'a+bc is not a+b');
    });

    it('03.7 - SUBTRACT: put the old escape back in handleGroupDependencies and `a+b` no longer finds its field', function () {
        var needleNew = SITES.handleGroupDependencies + ESC_NEW;
        var needleOld = SITES.handleGroupDependencies + ESC_OLD;
        var nNew = count(bSrc, needleNew), nOld = count(activeLines(bSrc), needleOld);
        assert.equal(nNew + nOld, 1, 'the construction is in slice B, once');
        // a function replacer: the old text carries `$&`, which a string replacement would expand
        var b = nNew ? bSrc.replace(needleNew, function () { return needleOld; }) : bSrc;
        var sc = scene(radioWithField('a+b'), { b: b });
        sc.fns.handleGroupDependencies(sc.byId['a+b']);
        assert.equal(sc.byId.f.disabled, true, 'the escape is the cause');
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity: both bundles carry the change
// ---------------------------------------------------------------------------
describe('validator-element-group-escape-b929 §04 — dist fidelity', function () {

    it('04.1 - gina.js (the Closure input): the complete escape at the five places, the old one at none', function () {
        var raw = activeLines(fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8'));
        Object.keys(SITES).forEach(function (k) {
            assert.equal(count(raw, SITES[k] + ESC_NEW), 1, k);
            assert.equal(count(raw, SITES[k] + ESC_OLD), 0, k + ' (old)');
        });
        assert.equal(count(raw, RE2_OLD), 0, 're2 is no longer built');
    });

    it('04.2 - gina.min.js: the complete escape survives minification at five places, the old one at none', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        assert.equal(min.split("getAttribute('data-gina-form-element-group').replace(").length - 1, 1,
            'CONTROL: handleGroupDependencies is in the bundle');
        var newClass = String.raw`/[.*+?^$` + '{}' + String.raw`()|[\]\\]/g`;
        var raw = activeLines(fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8'));
        // Closure keeps this class verbatim (measured: the bundle reads it as often as its comment-stripped input
        // does, red on a stale bundle); the old `/\-|\_|…/g` class it rewrites, so its absence is pinned on
        // gina.js in 04.1, not here. At least the five sites plus the bind-time name regexp of the validator.
        assert.equal(count(min, newClass), count(raw, newClass), 'gina.min.js is what browsers run: the complete escape');
        assert.ok(count(min, newClass) >= 6, 'the five sites and the bind-time name regexp: ' + count(min, newClass));
    });
});
