'use strict';
/**
 * The validator fix #B923, pinned in the source and executed on the shipped bytes. The behaviour is
 * driven end to end on the real bundle by `test/e2e/validator-element-group-token-b923.spec.js`.
 *
 * A field carrying `data-gina-form-element-group` lists, separated by spaces, the ids of the radios
 * and checkboxes it depends on (its masters). Five places tested a master's id against that list
 * with an unanchored regular expression, so an id found INSIDE a longer one matched too: with
 * masters `opt` and `opt-2`, the radio `opt` drove the fields of `opt-2`; a checkbox `cb-1` drove
 * those of `cb-10`. Each now matches the id as one whole entry of the list: `(^|\s)<id>(\s|$)`.
 * The five: updateReletadItems, updateCheckBox (a checkbox master with no group of its own),
 * updateGroupChildrenState, handleGroupDependencies, and the bind-time loop over checkbox masters.
 *
 *   §01 extraction + controls (the slicer can fail; the harness reaches the code under test)
 *   §02 source pins (comment-stripped)
 *   §03 the group functions on the real bytes
 *   §04 dist fidelity (both bundles)
 *
 * Red-first: `GINA_B923_MAIN_SRC=<file>` points §01–§03 at another copy of the validator source
 * (e.g. `git show <commit>:<path>` before the change), and `GINA_B923_DIST_DIR=<dir>` points §04 at
 * another dist js directory. Every arm must fail there except those labelled CONTROL or SUBTRACT.
 *
 * Usage: node --test test/core/validator-element-group-token-b923.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var MAIN     = process.env.GINA_B923_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B923_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

var SRC = fs.readFileSync(MAIN, 'utf8');

/**
 * Drops whole-line comments (`//`, `/*`, ` *`), so a pin never matches prose or a `// was:` record.
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
 * The text between two anchors, each of which must occur exactly once.
 *
 * @param {string} src
 * @param {string} from - start anchor (included)
 * @param {string} to - end anchor (excluded)
 * @param {string} label - names the span in error messages
 * @returns {string}
 */
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
// Extraction — the group functions of bindForm, sliced from the shipped bytes and executed.
// Slice A holds updateReletadItems and handleCheckBoxGroupDependencies, slice C updateCheckBox,
// slice B updateGroupChildrenState and handleGroupDependencies. Their free identifiers are
// bindForm's `allFormGroupedElements`, `$form`, `withRules` and `isCheckboxValueAsState`.
// ---------------------------------------------------------------------------
var A_START   = 'var updateReletadItems = function(elId, group, excluded, isCalledHasDependency) {';
var C_START   = 'var updateCheckBox = function($el, isInit) {';
var B_START   = 'var updateGroupChildrenState = function($groupMaster) {';
var B_END     = '        // BO Binding radio';
var HGD_START = 'var handleGroupDependencies = function($el, isOnResetMode) {';
var LOOP_START = '// if is master of a group, init children default state';
var LOOP_END   = 'for (let childElement in allFormGroupedElements ) {';   // the loop that follows the construction

// The five constructions, as the change writes them and as they read before it. Since #B929 the id's
// escape covers every regexp character; `${` would open a substitution in a template literal, so the
// escape is assembled around it.
var ESC = String.raw`replace(/[.*+?^$` + '{}' + String.raw`()|[\]\\]/g, '\\$&')`;
var NEW = {
    updateReletadItems:       String.raw`re = new RegExp('(^|\\s)' + namedId + '(\\s|$)');`,
    updateCheckBox:           String.raw`var re              = new RegExp('(^|\\s)' + $el.id.` + ESC + String.raw` + '(\\s|$)');`,
    updateGroupChildrenState: String.raw`var re = new RegExp('(^|\\s)' + $groupMaster.id.` + ESC + String.raw` + '(\\s|$)');`,
    handleGroupDependencies:  String.raw`re = new RegExp('(^|\\s)' + extendedGroupName + '(\\s|$)');`,
    bindLoop:                 String.raw`let re = new RegExp( '(^|\\s)' + $inputs[i].id.` + ESC + String.raw` + '(\\s|$)' );`
};
var OLD = {
    updateReletadItems:       're = new RegExp(namedId);',
    updateCheckBox:           String.raw`var re              = new RegExp($el.id.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&'));`,
    updateGroupChildrenState: String.raw`var re = new RegExp($groupMaster.id.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&'));`,
    handleGroupDependencies:  're = new RegExp(extendedGroupName);',
    bindLoop:                 String.raw`let re = new RegExp( $inputs[i].id.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&') );`
};
var ANCHOR = String.raw`'(^|\\s)' +`;

function sliceA(src)    { return between(src, A_START, C_START, 'slice A'); }
function sliceC(src)    { return between(src, C_START, B_START, 'slice C'); }
function sliceB(src)    { return between(src, B_START, B_END, 'slice B'); }
function sliceLoop(src) { return between(src, LOOP_START, LOOP_END, 'the bind-time loop'); }

var aSrc = sliceA(SRC);
var cSrc = sliceC(SRC);
var bSrc = sliceB(SRC);

/**
 * Compiles the three slices with bindForm's free identifiers as parameters.
 *
 * @param {string} a - slice A
 * @param {string} c - slice C
 * @param {string} b - slice B
 * @returns {function(object, object, boolean, function): object} -> the group functions
 */
function compile(a, c, b) {
    return new Function('allFormGroupedElements', '$form', 'withRules', 'isCheckboxValueAsState', a + '\n' + c + '\n' + b
        + '\nreturn { updateReletadItems: updateReletadItems, handleCheckBoxGroupDependencies: handleCheckBoxGroupDependencies,'
        + ' updateCheckBox: updateCheckBox, updateGroupChildrenState: updateGroupChildrenState,'
        + ' handleGroupDependencies: handleGroupDependencies };');
}

/**
 * A control stub. `group` is its data-gina-form-element-group; `value` its value attribute.
 *
 * @param {string} id
 * @param {string} type - `radio`, `checkbox`, `hidden`, `text`
 * @param {object} [o]
 * @param {boolean} [o.checked]
 * @param {boolean} [o.disabled]
 * @param {string} [o.group]
 * @param {string} [o.value]
 * @returns {object}
 */
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

/**
 * The bind-time map of grouped controls (every control given a `group`) and a fresh rule set.
 *
 * @param {Array<object>} controls - in DOM order
 * @param {string} [b] - slice B to compile (default: the shipped one)
 * @returns {{fns: object, byId: object, $form: {rules: object}}}
 */
function scene(controls, b) {
    var grouped = {}, byId = {};
    controls.forEach(function (c) {
        byId[c.id] = c;
        var g = c.getAttribute('data-gina-form-element-group');
        if (g) { grouped[c.id] = { id: c.id, name: c.name, group: g, target: c }; }
    });
    var $form = { rules: {} };
    var notLegacy = function () { return false; };
    return { fns: compile(aSrc, cSrc, b || bSrc)(grouped, $form, true, notLegacy), byId: byId, $form: $form };
}

/** Radios opt-2 then opt in one group, each with a hidden field; x2 starts as `x2Disabled`. */
function radios(opt2Checked, optChecked, x2Disabled) {
    return [
        ctl('opt-2', 'radio', { checked: opt2Checked }),
        ctl('x2', 'hidden', { group: 'opt-2', disabled: x2Disabled }),
        ctl('opt', 'radio', { checked: optChecked }),
        ctl('x1', 'hidden', { group: 'opt', disabled: true })
    ];
}

/** Checkboxes doc-2 then doc under the radio flow; d2 names "flow doc-2", d1 "flow doc". */
function nested(doc2Checked, docChecked) {
    return [
        ctl('flow', 'radio', { checked: true }),
        ctl('doc-2', 'checkbox', { checked: doc2Checked, group: 'flow', value: 'd2v' }),
        ctl('d2', 'hidden', { group: 'flow doc-2', disabled: true }),
        ctl('doc', 'checkbox', { checked: docChecked, group: 'flow', value: 'd1v' }),
        ctl('d1', 'hidden', { group: 'flow doc', disabled: true })
    ];
}

/** Waits past updateCheckBox's setTimeout(0). */
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-element-group-token-b923 §01 — extraction + controls', function () {

    it('01.1 - CONTROL: the three slices resolve, hold their functions, and compile', function () {
        assert.equal(aSrc.indexOf(A_START), 0, 'slice A starts at updateReletadItems');
        assert.equal(cSrc.indexOf(C_START), 0, 'slice C starts at updateCheckBox');
        assert.equal(bSrc.indexOf(B_START), 0, 'slice B starts at updateGroupChildrenState');
        assert.ok(bSrc.indexOf(HGD_START) > 0, 'slice B holds handleGroupDependencies');
        assert.doesNotThrow(function () { compile(aSrc, cSrc, bSrc); });
    });

    it('01.2 - CONTROL: the slicers can fail — a bogus or a doubled anchor throws', function () {
        assert.throws(function () { sliceC(SRC.replace(C_START, 'var notUpdateCheckBox = function() {')); }, /start anchor not found/);
        assert.throws(function () { sliceLoop(SRC.replace(LOOP_END, '// gone')); }, /end anchor not found/);
        assert.throws(function () { sliceA(SRC + '\n' + A_START); }, /start anchor not unique/);
    });

    it('01.3 - CONTROL: the harness reaches the code — a checked radio enables the field naming it', function () {
        var sc = scene(radios(false, true, true));
        sc.fns.handleGroupDependencies(sc.byId.opt);
        assert.equal(sc.byId.x1.disabled, false, 'if this fails, every §03 assertion is meaningless');
        assert.equal(sc.$form.rules.x1.exclude, false);
    });
});

// ---------------------------------------------------------------------------
// §02 — source pins (comment-stripped)
// ---------------------------------------------------------------------------
describe('validator-element-group-token-b923 §02 — source pins', function () {

    it('02.1 - #B923: each of the five places matches the id as a whole entry of the list', function () {
        assert.equal(count(activeLines(sliceA(SRC)), NEW.updateReletadItems), 1, 'updateReletadItems');
        assert.equal(count(activeLines(sliceC(SRC)), NEW.updateCheckBox), 1, 'updateCheckBox');
        var b = activeLines(sliceB(SRC));
        assert.equal(count(b, NEW.updateGroupChildrenState), 1, 'updateGroupChildrenState');
        assert.equal(count(b, NEW.handleGroupDependencies), 1, 'handleGroupDependencies');
        assert.equal(count(activeLines(sliceLoop(SRC)), NEW.bindLoop), 1, 'the bind-time loop');
        assert.equal(count(activeLines(SRC), ANCHOR), 5, 'and nowhere else');
    });

    it('02.2 - #B923: no unanchored match of a master id is left in the code', function () {
        var active = activeLines(SRC);
        Object.keys(OLD).forEach(function (k) { assert.equal(count(active, OLD[k]), 0, k); });
    });

    it('02.3 - CONTROL: the old constructions are still in the raw text, so the strip cannot pass 02.2 vacuously', function () {
        Object.keys(OLD).forEach(function (k) { assert.equal(count(SRC, OLD[k]), 1, k); });
    });
});

// ---------------------------------------------------------------------------
// §03 — the group functions on the real bytes
// ---------------------------------------------------------------------------
describe('validator-element-group-token-b923 §03 — a master drives only the fields that name its id', function () {

    it('03.1 - #B923: a checked radio opt leaves the field of opt-2 alone', function () {
        var sc = scene(radios(false, true, true));
        sc.fns.handleGroupDependencies(sc.byId.opt);
        assert.equal(sc.byId.x2.disabled, true, 'opt-2 is not checked: x2 stays disabled');
        assert.equal(typeof sc.$form.rules.x2, 'undefined', 'no rule is written for x2');
    });

    it('03.2 - #B923: an unchecked radio opt, bound after a checked opt-2, leaves opt-2\'s field enabled', function () {
        var sc = scene(radios(true, false, false));
        sc.fns.handleGroupDependencies(sc.byId['opt-2']);
        sc.fns.handleGroupDependencies(sc.byId.opt);
        assert.equal(sc.byId.x2.disabled, false, 'opt-2 is checked');
        assert.equal(sc.$form.rules.x2.exclude, false);
    });

    it('03.3 - #B923: ticking the checkbox doc enables the field naming doc, not the one naming doc-2', function () {
        var sc = scene(nested(false, true));
        sc.fns.handleCheckBoxGroupDependencies(sc.$form, sc.byId.doc, 'flow');
        assert.equal(sc.byId.d1.disabled, false, 'd1 names doc');
        assert.equal(sc.byId.d2.disabled, true, 'd2 names doc-2, which is unticked');
    });

    it('03.4 - #B923: under a checked radio, an unticked doc no longer turns off the field of a ticked doc-2', function () {
        var sc = scene(nested(true, false));
        sc.fns.updateGroupChildrenState(sc.byId.flow);
        assert.equal(sc.byId.d2.disabled, false, 'doc-2 is ticked');
        assert.equal(sc.$form.rules.d2.exclude, false);
        assert.equal(sc.byId.d1.disabled, true, 'CONTROL: doc is unticked');
    });

    it('03.5 - #B923: ticking a checkbox master cb-1 enables its field, not cb-10\'s', async function () {
        var sc = scene([
            ctl('cb-10', 'checkbox', { checked: false, value: 'v10' }),
            ctl('k10', 'hidden', { group: 'cb-10', disabled: true }),
            ctl('cb-1', 'checkbox', { checked: true, value: 'v1' }),
            ctl('k1', 'hidden', { group: 'cb-1', disabled: true })
        ]);
        sc.fns.updateCheckBox(sc.byId['cb-1'], false);
        await tick();
        assert.equal(sc.byId.k1.disabled, false, 'CONTROL: k1 names cb-1, which is ticked');
        assert.equal(sc.byId.k10.disabled, true, 'k10 names cb-10, which is unticked');
    });

    it('03.6 - CONTROL: a field naming the master among other ids, first or last, follows it', function () {
        var sc = scene([
            ctl('opt', 'radio', { checked: true }),
            ctl('first', 'hidden', { group: 'opt other', disabled: true }),
            ctl('last', 'hidden', { group: 'other opt', disabled: true }),
            ctl('middle', 'hidden', { group: 'a opt b', disabled: true })
        ]);
        sc.fns.handleGroupDependencies(sc.byId.opt);
        assert.equal(sc.byId.first.disabled, false);
        assert.equal(sc.byId.last.disabled, false);
        assert.equal(sc.byId.middle.disabled, false);
    });

    it('03.7 - CONTROL: a field naming a radio and a checkbox follows both, as #B919 left it', function () {
        var on = scene(nested(false, true));
        on.fns.handleGroupDependencies(on.byId.flow);
        assert.equal(on.byId.d1.disabled, false, 'flow checked and doc ticked');
        var off = scene(nested(false, false));
        off.fns.handleGroupDependencies(off.byId.flow);
        assert.equal(off.byId.d1.disabled, true, 'doc unticked');
    });

    it('03.8 - SUBTRACT: put the unanchored match back in handleGroupDependencies and opt drives opt-2\'s field again', function () {
        var nNew = count(bSrc, NEW.handleGroupDependencies);
        var nOld = count(activeLines(bSrc), OLD.handleGroupDependencies);
        assert.equal(nNew + nOld, 1, 'the construction is in slice B, once');
        var b = nNew ? bSrc.replace(NEW.handleGroupDependencies, OLD.handleGroupDependencies) : bSrc;
        var sc = scene(radios(false, true, true), b);
        sc.fns.handleGroupDependencies(sc.byId.opt);
        assert.equal(sc.byId.x2.disabled, false, 'the unanchored match is the cause');
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity: both bundles carry the change
// ---------------------------------------------------------------------------
describe('validator-element-group-token-b923 §04 — dist fidelity', function () {

    it('04.1 - gina.js (the Closure input): the five anchored constructions, no unanchored one', function () {
        var raw = activeLines(fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8'));
        Object.keys(NEW).forEach(function (k) {
            assert.equal(count(raw, NEW[k]), 1, k);
            assert.equal(count(raw, OLD[k]), 0, k + ' (old)');
        });
    });

    it('04.2 - gina.min.js: the id is anchored at the five places, whatever quote Closure keeps', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        assert.equal(min.split("getAttribute('data-gina-form-element-group').replace(").length - 1, 1,
            'CONTROL: handleGroupDependencies is in the bundle');
        var head = min.match(/["']\(\^\|\\\\s\)["']\s*\+/g) || [];
        var tail = min.match(/\+\s*["']\(\\\\s\|\$\)["']/g) || [];
        assert.equal(head.length, 5, 'gina.min.js is what browsers run: (^|\\s) before the id');
        assert.equal(tail.length, 5, 'gina.min.js is what browsers run: (\\s|$) after it');
    });
});
