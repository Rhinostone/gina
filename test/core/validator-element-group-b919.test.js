'use strict';
/**
 * The validator fix #B919, pinned in the source and executed on the shipped bytes. The behaviour is
 * driven end to end on the real bundle by `test/e2e/validator-element-group-b919.spec.js`.
 *
 * A field carrying `data-gina-form-element-group="<id>"` depends on the radio or checkbox with that
 * id (its master): it is enabled, and sent, while the master is checked. `handleGroupDependencies`,
 * which runs for every radio at bind and on every radio click, opened its loop with a branch that
 * disabled, and excluded, EVERY grouped field that is not a radio or a checkbox, whichever radio it
 * ran for; only the next branch re-enabled the fields of that radio. So a radio click, or the bind of
 * any later radio, disabled the fields of every other checked master, a checkbox master's included,
 * and the fields of a group naming no element. The branch is gone. Without it, one more case needs
 * `updateReletadItems`: a checkbox grouped under a master, itself named by a field (a field naming
 * both, e.g. `"master-id checkbox-id"`). The field was recomputed from the checkbox's `checked`
 * alone, so it was enabled again when the master was switched off while the checkbox stayed ticked;
 * the removed branch had hidden that. A checkbox that is disabled now counts as unticked there.
 *
 *   §01 extraction + controls (the slicer can fail; the harness reaches the code under test)
 *   §02 source pins (comment-stripped)
 *   §03 the group functions on the real bytes
 *   §04 dist fidelity (both bundles)
 *
 * Red-first: `GINA_B919_MAIN_SRC=<file>` points §01–§03 at another copy of the validator source
 * (e.g. `git show <commit>:<path>` before the change), and `GINA_B919_DIST_DIR=<dir>` points §04 at
 * another dist js directory. Every arm must fail there except those labelled CONTROL or SUBTRACT.
 *
 * Usage: node --test test/core/validator-element-group-b919.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var MAIN     = process.env.GINA_B919_MAIN_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_DIR = process.env.GINA_B919_DIST_DIR || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

var SRC = fs.readFileSync(MAIN, 'utf8');

/**
 * Drops whole-line comments (`//`, `/*`, ` *`), so a pin never matches prose or a commented-out
 * copy of the code.
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

// ---------------------------------------------------------------------------
// Extraction — the four group functions of bindForm, sliced from the shipped bytes and executed.
// Slice A holds updateReletadItems and handleCheckBoxGroupDependencies, slice B
// updateGroupChildrenState and handleGroupDependencies. Their free identifiers are bindForm's
// `allFormGroupedElements`, `$form` and `withRules`.
// ---------------------------------------------------------------------------
var A_START = 'var updateReletadItems = function(elId, group, excluded, isCalledHasDependency) {';
var A_END   = 'var updateCheckBox = function($el, isInit) {';
var B_START = 'var updateGroupChildrenState = function($groupMaster) {';
var B_END   = '        // BO Binding radio';
var HGD_START = 'var handleGroupDependencies = function($el, isOnResetMode) {';

// The removed branch, as it read before #B919, and the master read of updateReletadItems.
var BRANCH_1 = 'if (!/checkbox|radio/i.test(allFormGroupedElements[id].target.type)) {';
var BRANCH_1_CODE = 'if (!/checkbox|radio/i.test(allFormGroupedElements[id].target.type)) {\n'
    + 'allFormGroupedElements[id].target.disabled = true;\n'
    + 'if ( typeof($form.rules[ allFormGroupedElements[id].name ]) == \'undefined\' ) { $form.rules[ allFormGroupedElements[id].name ] = {} }\n'
    + '$form.rules[ allFormGroupedElements[id].name ].exclude = true;\n'
    + '}\n';
var STATE_NEW = 'elIdIsChecked = allFormGroupedElements[elId].target.checked && !allFormGroupedElements[elId].target.disabled;';
var STATE_OLD = 'elIdIsChecked = allFormGroupedElements[elId].target.checked;';
var LOOP = 'for (let id in allFormGroupedElements) {';

function sliceA(src) { return between(src, A_START, A_END, 'slice A'); }
function sliceB(src) { return between(src, B_START, B_END, 'slice B'); }
function sliceHGD(src) { return between(src, HGD_START, B_END, 'handleGroupDependencies'); }

var aSrc = sliceA(SRC);
var bSrc = sliceB(SRC);

/**
 * Compiles both slices with bindForm's free identifiers as parameters.
 *
 * @param {string} a - slice A
 * @param {string} b - slice B
 * @returns {function(object, object, boolean): object} (allFormGroupedElements, $form, withRules) -> the four functions
 */
function compile(a, b) {
    return new Function('allFormGroupedElements', '$form', 'withRules', a + '\n' + b
        + '\nreturn { updateReletadItems: updateReletadItems, handleCheckBoxGroupDependencies: handleCheckBoxGroupDependencies,'
        + ' updateGroupChildrenState: updateGroupChildrenState, handleGroupDependencies: handleGroupDependencies };');
}

/**
 * A control stub. `group` is its data-gina-form-element-group, read through getAttribute.
 *
 * @param {string} id
 * @param {string} type - `radio`, `checkbox`, `hidden`, `text`, `select-one`
 * @param {object} [o]
 * @param {boolean} [o.checked]
 * @param {boolean} [o.disabled]
 * @param {string} [o.group]
 * @returns {object}
 */
function ctl(id, type, o) {
    o = o || {};
    return {
        id: id, name: id, type: type, checked: !!o.checked, disabled: !!o.disabled,
        getAttribute: function (a) { return (a === 'data-gina-form-element-group') ? (o.group || null) : null; }
    };
}

/**
 * The bind-time map of grouped controls (every control given a `group`) and a fresh rule set.
 *
 * @param {Array<object>} controls
 * @param {string} [a] - slice A to compile (default: the shipped one)
 * @param {string} [b] - slice B to compile (default: the shipped one)
 * @returns {{fns: object, byId: object, $form: {rules: object}}}
 */
function scene(controls, a, b) {
    var grouped = {}, byId = {};
    controls.forEach(function (c) {
        byId[c.id] = c;
        var g = c.getAttribute('data-gina-form-element-group');
        if (g) { grouped[c.id] = { id: c.id, name: c.name, group: g, target: c }; }
    });
    var $form = { rules: {} };
    return { fns: compile(a || aSrc, b || bSrc)(grouped, $form, true), byId: byId, $form: $form };
}

/** The reported shape: master radio ma with a hidden child h1, an unrelated radio u1. */
function reported(maChecked) {
    return [ctl('ma', 'radio', { checked: maChecked }), ctl('h1', 'hidden', { group: 'ma' }), ctl('u1', 'radio', { checked: true })];
}

/** The nested shape: checkbox doc under radio master flow-a; amend names both. */
function nested(flowChecked, docChecked) {
    return [
        ctl('flow-a', 'radio', { checked: flowChecked }),
        ctl('doc', 'checkbox', { checked: docChecked, group: 'flow-a' }),
        ctl('amend', 'hidden', { group: 'flow-a doc' })
    ];
}

// ---------------------------------------------------------------------------
// §01 — extraction + controls
// ---------------------------------------------------------------------------
describe('validator-element-group-b919 §01 — extraction + controls', function () {

    it('01.1 - CONTROL: both slices resolve, hold their functions, and compile', function () {
        assert.equal(aSrc.indexOf(A_START), 0, 'slice A starts at updateReletadItems');
        assert.ok(aSrc.indexOf('var handleCheckBoxGroupDependencies = function($form, $el, checkBoxGroup, isCalledHasDependency) {') > 0);
        assert.equal(bSrc.indexOf(B_START), 0, 'slice B starts at updateGroupChildrenState');
        assert.ok(bSrc.indexOf(HGD_START) > 0, 'slice B holds handleGroupDependencies');
        assert.doesNotThrow(function () { compile(aSrc, bSrc); });
    });

    it('01.2 - CONTROL: the slicers can fail — a bogus or a doubled anchor throws', function () {
        assert.throws(function () { sliceA(SRC.replace(A_START, 'var notUpdateReletadItems = function() {')); }, /start anchor not found/);
        assert.throws(function () { sliceB(SRC.replace(B_END, '        // gone')); }, /end anchor not found/);
        assert.throws(function () { sliceA(SRC + '\n' + A_START); }, /start anchor not unique/);
    });

    it('01.3 - CONTROL: the harness reaches the code — a checked master enables its field', function () {
        var sc = scene(reported(true));
        sc.byId.h1.disabled = true;
        sc.fns.handleGroupDependencies(sc.byId.ma);
        assert.equal(sc.byId.h1.disabled, false, 'if this fails, every §03 assertion is meaningless');
        assert.equal(sc.$form.rules.h1.exclude, false);
    });
});

// ---------------------------------------------------------------------------
// §02 — source pins (comment-stripped)
// ---------------------------------------------------------------------------
describe('validator-element-group-b919 §02 — source pins', function () {

    it('02.1 - #B919: handleGroupDependencies no longer disables every grouped field', function () {
        var hgd = sliceHGD(SRC);
        assert.equal(activeLines(hgd).indexOf(BRANCH_1), -1, 'the branch disabled the fields of every other master');
        assert.ok(hgd.indexOf('/checkbox|radio/i.test(allFormGroupedElements[id].target.type)') > -1,
            'CONTROL: the commented-out copy is still in the raw text, so the strip cannot pass this pin vacuously');
    });

    it('02.2 - #B919: updateReletadItems reads a disabled checkbox as unticked', function () {
        var a = activeLines(sliceA(SRC));
        assert.equal(a.split(STATE_NEW).length - 1, 1, 'the master is read as checked && !disabled');
        assert.equal(a.indexOf(STATE_OLD), -1, 'the checked-only read is gone');
    });

    it('02.3 - CONTROL: the master\'s own branch and the nested recomputation stay', function () {
        var hgd = activeLines(sliceHGD(SRC));
        assert.ok(hgd.indexOf('re.test(allFormGroupedElements[id].group)') > -1, 'a field of this master is matched');
        assert.ok(hgd.indexOf('if (/^(true|on)$/i.test($el.checked)) {') > -1, 'and follows its checked state');
        assert.ok(hgd.indexOf('updateGroupChildrenState($el);') > -1, 'then its checkbox children\'s fields');
    });
});

// ---------------------------------------------------------------------------
// §03 — the group functions on the real bytes
// ---------------------------------------------------------------------------
describe('validator-element-group-b919 §03 — a radio drives only the fields of its own group', function () {

    it('03.1 - #B919: another radio leaves a checked master\'s field enabled and included', function () {
        var sc = scene(reported(true));
        sc.fns.handleGroupDependencies(sc.byId.ma);
        sc.fns.handleGroupDependencies(sc.byId.u1);
        assert.equal(sc.byId.h1.disabled, false, 'ma is still checked');
        assert.equal(sc.$form.rules.h1.exclude, false);
    });

    it('03.2 - #B919: nor does it disable a checkbox master\'s field', function () {
        var sc = scene([ctl('cbm', 'checkbox', { checked: true }), ctl('h2', 'hidden', { group: 'cbm' }), ctl('u1', 'radio', { checked: true })]);
        sc.fns.handleGroupDependencies(sc.byId.u1);
        assert.equal(sc.byId.h2.disabled, false, 'cbm is checked');
        assert.equal(typeof sc.$form.rules.h2, 'undefined', 'no rule is written for h2');
    });

    it('03.3 - #B919: a field whose group names no element is left as rendered', function () {
        var sc = scene([ctl('h3', 'hidden', { group: 'no-such-master' }), ctl('u1', 'radio', { checked: true })]);
        sc.fns.handleGroupDependencies(sc.byId.u1);
        assert.equal(sc.byId.h3.disabled, false);
        assert.equal(typeof sc.$form.rules.h3, 'undefined', 'no rule is written for h3');
    });

    it('03.4 - CONTROL: an unchecked master disables and excludes its field', function () {
        var sc = scene(reported(false));
        sc.fns.handleGroupDependencies(sc.byId.ma);
        assert.equal(sc.byId.h1.disabled, true);
        assert.equal(sc.$form.rules.h1.exclude, true);
    });

    it('03.5 - #B919: a master switched off disables the field naming it and a checkbox it holds, the checkbox still ticked', function () {
        var sc = scene(nested(false, true));
        sc.fns.handleGroupDependencies(sc.byId['flow-a'], true);
        assert.equal(sc.byId.doc.disabled, true, 'CONTROL: the checkbox follows its master');
        assert.equal(sc.byId.amend.disabled, true, 'the disabled checkbox counts as unticked');
        assert.equal(sc.$form.rules.amend.exclude, true);
    });

    it('03.6 - CONTROL: a checked master and a ticked checkbox enable the field; an unticked one disables it', function () {
        var on = scene(nested(true, true));
        on.fns.handleGroupDependencies(on.byId['flow-a']);
        assert.equal(on.byId.doc.disabled, false);
        assert.equal(on.byId.amend.disabled, false);
        assert.equal(on.$form.rules.amend.exclude, false);
        var off = scene(nested(true, false));
        off.fns.handleGroupDependencies(off.byId['flow-a']);
        assert.equal(off.byId.amend.disabled, true);
    });

    it('03.7 - #B919: a field naming an unticked outer checkbox and a ticked, disabled inner one is disabled', function () {
        var sc = scene([
            ctl('outer', 'checkbox', { checked: false }),
            ctl('inner', 'checkbox', { checked: true, disabled: true, group: 'outer' }),
            ctl('ih', 'hidden', { group: 'outer inner' })
        ]);
        sc.fns.updateGroupChildrenState(sc.byId.outer);
        assert.equal(sc.byId.ih.disabled, true);
        assert.equal(sc.$form.rules.ih.exclude, true);
    });

    it('03.8 - CONTROL: with both checkboxes ticked and enabled, the field is enabled', function () {
        var sc = scene([
            ctl('outer', 'checkbox', { checked: true }),
            ctl('inner', 'checkbox', { checked: true, group: 'outer' }),
            ctl('ih', 'hidden', { group: 'outer inner' })
        ]);
        sc.fns.updateGroupChildrenState(sc.byId.outer);
        assert.equal(sc.byId.ih.disabled, false);
        assert.equal(sc.$form.rules.ih.exclude, false);
    });

    it('03.9 - SUBTRACT: put the branch back and another radio disables the master\'s field again', function () {
        var at = bSrc.indexOf(LOOP, bSrc.indexOf(HGD_START));
        assert.ok(at > 0, 'the loop of handleGroupDependencies is in slice B');
        var b = bSrc.substring(0, at + LOOP.length) + '\n' + BRANCH_1_CODE + bSrc.substring(at + LOOP.length);
        var sc = scene(reported(true), aSrc, b);
        sc.fns.handleGroupDependencies(sc.byId.ma);
        sc.fns.handleGroupDependencies(sc.byId.u1);
        assert.equal(sc.byId.h1.disabled, true, 'the branch is the cause');
    });

    it('03.10 - SUBTRACT: read the checkbox as checked only and the field is enabled again', function () {
        // the fixed read, or (in the pre-change bytes) the checked-only read outside comments
        var nNew = aSrc.split(STATE_NEW).length - 1;
        var nOld = activeLines(aSrc).split(STATE_OLD).length - 1;
        assert.equal(nNew + nOld, 1, 'the master read is in slice A, once');
        var a = nNew ? aSrc.replace(STATE_NEW, STATE_OLD) : aSrc;
        var sc = scene(nested(false, true), a, bSrc);
        sc.fns.handleGroupDependencies(sc.byId['flow-a'], true);
        assert.equal(sc.byId.amend.disabled, false, 'the checked-only read is the cause');
    });
});

// ---------------------------------------------------------------------------
// §04 — dist fidelity: both bundles carry the change
// ---------------------------------------------------------------------------
describe('validator-element-group-b919 §04 — dist fidelity', function () {

    it('04.1 - gina.js (the Closure input): the branch is gone and the checkbox is read as checked && !disabled', function () {
        var raw = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
        assert.equal(activeLines(sliceHGD(raw)).indexOf(BRANCH_1), -1);
        var a = activeLines(sliceA(raw));
        assert.equal(a.split(STATE_NEW).length - 1, 1);
        assert.equal(a.indexOf(STATE_OLD), -1);
    });

    it('04.2 - gina.min.js: no grouped field is disabled for not being a radio or a checkbox', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        // Pre-fix emission (build of 2026-10-20), the branch: for(let ha in Fa)if(/checkbox|radio/i.test(Fa[ha].target.type)||(Fa[ha].target.disabled=!0,…
        assert.equal(min.split('/radio|checkbox/i.test(').length - 1, 1, 'CONTROL: updateReletadItems still skips radios and checkboxes');
        assert.equal(min.split("getAttribute('data-gina-form-element-group').replace(").length - 1, 1, 'CONTROL: the master\'s own branch is in the bundle');
        assert.equal(min.split('/checkbox|radio/i.test(').length - 1, 0, 'gina.min.js is what browsers run: the branch is gone');
    });

    it('04.3 - gina.min.js: updateReletadItems reads its checkbox as checked && !disabled', function () {
        var min = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        // Pre-fix emission: r=Fa[r].target.checked;for(let Wa in Fa)if(!/radio|checkbox/i.test(Fa[Wa].target.type)){…
        var ID = '[A-Za-z_$][\\w$]*';
        var fixed = min.match(new RegExp('(' + ID + ')\\[(' + ID + ')\\]\\.target\\.checked&&!\\1\\[\\2\\]\\.target\\.disabled;for\\(let ' + ID + ' in \\1\\)if\\(!/radio\\|checkbox/i\\.test\\(', 'g')) || [];
        var old = min.match(new RegExp('=(' + ID + ')\\[(' + ID + ')\\]\\.target\\.checked;for\\(let ' + ID + ' in \\1\\)if\\(!/radio\\|checkbox/i\\.test\\(', 'g')) || [];
        assert.equal(min.split('Radio & Checkbox dependencies not met').length - 1, 1, 'CONTROL: updateReletadItems is in the bundle');
        assert.equal(old.length, 0, 'gina.min.js is what browsers run: no checked-only read');
        assert.equal(fixed.length, 1, 'gina.min.js is what browsers run: checked && !disabled');
    });
});
