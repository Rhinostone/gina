'use strict';
/**
 * FormValidator binding for HTML5 form-reassociated controls (form="X" attribute)
 *
 * Per the HTML spec, an input/button can carry a `form="..."` attribute that binds
 * it to a form element it is NOT a DOM descendant of. The form's HTMLFormControlsCollection
 * (form.elements / form.length / form[i]) reflects this owner relationship; getElementsByTagName
 * does not. This test covers the validator plugin's owner-aware control collection
 * (getOwnedElements helper), per-control listener attachment for reassociated controls,
 * and unbindForm cleanup symmetry.
 *
 * Strategy:
 *  - jsdom-backed DOM exercises getOwnedElements directly against parent + reassociated
 *    layouts (behavioural).
 *  - Source-inspection pins the structural changes in main.js (helper exists, bindForm
 *    uses it for the four field-collection sites + button collection, reassociatedListeners
 *    side-table is initialised + drained, proxy handlers are extracted as named
 *    expressions, per-control reassociated loop attaches them on out-of-tree controls).
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var { JSDOM } = require('jsdom');

var FW   = require('../fw');
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');

var mainSrc;

before(function () {
    mainSrc = fs.readFileSync(MAIN, 'utf8');
});


// --- Test-local copy of getOwnedElements ---
// MUST mirror the inline definition in main.js. The source-inspection block
// at the end of this file pins the source-side shape so this stays honest.
function getOwnedElements($form, tag) {
    var arr = [], seen = {}, tagUpper = tag.toUpperCase();
    for (var i = 0, len = $form.elements.length; i < len; i++) {
        var $el = $form.elements[i];
        if ($el.tagName === tagUpper) {
            arr.push($el);
            if ($el.id) seen[$el.id] = true;
        }
    }
    var inTree = $form.getElementsByTagName(tag);
    for (var j = 0, jLen = inTree.length; j < jLen; j++) {
        var $el2 = inTree[j];
        if ($el2.form === $form && (!$el2.id || !seen[$el2.id])) {
            arr.push($el2);
        }
    }
    return arr;
}


// --- DOM fixture ---
function setupDom() {
    var dom = new JSDOM(`<!DOCTYPE html><html><body>
        <form id="parent">
            <input id="parentField" name="parentField" type="text">
            <input id="childField" name="childField" form="child" type="text">
            <input id="parentImage" name="parentImage" type="image" src="x.png">
            <textarea id="parentNote" name="parentNote"></textarea>
            <textarea id="childNote" name="childNote" form="child"></textarea>
            <select id="parentSel" name="parentSel"><option value="a">a</option></select>
            <select id="childSel" name="childSel" form="child"><option value="b">b</option></select>
            <button id="parentSubmit" type="submit">Submit Parent</button>
            <button id="childSubmit" form="child" type="submit">Submit Child</button>
        </form>
        <form id="child"></form>
        <form id="standalone">
            <input id="soloField" name="soloField" type="text">
            <input id="soloImage" name="soloImage" type="image" src="x.png">
            <button id="soloSubmit" type="submit">Submit</button>
        </form>
    </body></html>`);
    return {
        window         : dom.window,
        document       : dom.window.document,
        parentForm     : dom.window.document.getElementById('parent'),
        childForm      : dom.window.document.getElementById('child'),
        standaloneForm : dom.window.document.getElementById('standalone')
    };
}


// 01 - parent-form filter excludes reassociated descendants

describe('01 - parent form: getOwnedElements excludes reassociated descendants', function () {
    it('returns parentField but NOT childField', function () {
        var ctx    = setupDom();
        var inputs = getOwnedElements(ctx.parentForm, 'input');
        var ids    = inputs.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('parentField') >= 0,
            "parentField should be in parent form's inputs");
        assert.equal(ids.indexOf('childField'), -1,
            'childField (form="child") should NOT be in parent form\'s inputs');
    });

    it('returns parentSubmit but NOT childSubmit', function () {
        var ctx     = setupDom();
        var buttons = getOwnedElements(ctx.parentForm, 'button');
        var ids     = buttons.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('parentSubmit') >= 0);
        assert.equal(ids.indexOf('childSubmit'), -1,
            'childSubmit (form="child") should NOT be in parent form\'s buttons');
    });

    it('returns parentNote but NOT childNote', function () {
        var ctx       = setupDom();
        var textareas = getOwnedElements(ctx.parentForm, 'textarea');
        var ids       = textareas.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('parentNote') >= 0);
        assert.equal(ids.indexOf('childNote'), -1);
    });

    it('returns parentSel but NOT childSel', function () {
        var ctx     = setupDom();
        var selects = getOwnedElements(ctx.parentForm, 'select');
        var ids     = selects.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('parentSel') >= 0);
        assert.equal(ids.indexOf('childSel'), -1);
    });

    it('picks up type=image input via secondary sweep', function () {
        var ctx    = setupDom();
        var inputs = getOwnedElements(ctx.parentForm, 'input');
        var ids    = inputs.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('parentImage') >= 0,
            'type=image input owned by parent should be picked up by the secondary sweep');
    });
});


// 02 - child form picks up reassociated controls

describe('02 - child form: getOwnedElements picks up reassociated controls', function () {
    it('returns childField (input form="child")', function () {
        var ctx    = setupDom();
        var inputs = getOwnedElements(ctx.childForm, 'input');
        var ids    = inputs.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('childField') >= 0,
            'childField should be in child form\'s inputs (HTMLFormControlsCollection owner-aware)');
        assert.equal(ids.indexOf('parentField'), -1,
            'parentField should not appear in child form\'s inputs');
    });

    it('returns childSubmit (button form="child")', function () {
        var ctx     = setupDom();
        var buttons = getOwnedElements(ctx.childForm, 'button');
        var ids     = buttons.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('childSubmit') >= 0);
    });

    it('returns childNote (textarea form="child") and childSel (select form="child")', function () {
        var ctx       = setupDom();
        var textareas = getOwnedElements(ctx.childForm, 'textarea');
        var selects   = getOwnedElements(ctx.childForm, 'select');
        assert.ok(textareas.map(function (el) { return el.id; }).indexOf('childNote') >= 0);
        assert.ok(selects.map(function (el) { return el.id; }).indexOf('childSel') >= 0);
    });

    it('child.elements (HTMLFormControlsCollection) reflects all reassociated owned controls', function () {
        var ctx        = setupDom();
        var elementIds = [];
        for (var i = 0; i < ctx.childForm.elements.length; i++) {
            elementIds.push(ctx.childForm.elements[i].id);
        }
        assert.ok(elementIds.indexOf('childField') >= 0);
        assert.ok(elementIds.indexOf('childNote') >= 0);
        assert.ok(elementIds.indexOf('childSel') >= 0);
        assert.ok(elementIds.indexOf('childSubmit') >= 0);
    });

    it('child form\'s subtree contains zero reassociated controls (proves the form-element tree is empty)', function () {
        var ctx    = setupDom();
        var inputs = ctx.childForm.getElementsByTagName('input');
        assert.equal(inputs.length, 0,
            'child form has no DOM-tree inputs — all its controls are reassociated');
    });
});


// 03 - regression guard for in-tree-only forms

describe('03 - standalone form: regression guard for in-tree-only binding', function () {
    it('binds soloField + soloImage (the latter via secondary sweep)', function () {
        var ctx    = setupDom();
        var inputs = getOwnedElements(ctx.standaloneForm, 'input');
        var ids    = inputs.map(function (el) { return el.id; });
        assert.ok(ids.indexOf('soloField') >= 0);
        assert.ok(ids.indexOf('soloImage') >= 0);
        assert.equal(inputs.length, 2);
    });

    it('returns soloSubmit', function () {
        var ctx     = setupDom();
        var buttons = getOwnedElements(ctx.standaloneForm, 'button');
        assert.equal(buttons.length, 1);
        assert.equal(buttons[0].id, 'soloSubmit');
    });

    it('does not include controls owned by other forms', function () {
        var ctx    = setupDom();
        var inputs = getOwnedElements(ctx.standaloneForm, 'input');
        var ids    = inputs.map(function (el) { return el.id; });
        assert.equal(ids.indexOf('parentField'), -1);
        assert.equal(ids.indexOf('childField'), -1);
    });
});


// 04 - source inspection: structural pins on main.js

describe('04 - source inspection: structural pins on main.js', function () {
    it('getOwnedElements helper exists in bindForm', function () {
        assert.ok(/var\s+getOwnedElements\s*=\s*function\s*\(\$form,\s*tag\)/i.test(mainSrc),
            'getOwnedElements function definition should be present');
        assert.ok(/\$form\.elements\.length/i.test(mainSrc),
            'getOwnedElements should iterate $form.elements (HTMLFormControlsCollection)');
        assert.ok(/\$el\.form\s*===\s*\$form/.test(mainSrc),
            'secondary sweep should filter by $el.form === $form (parent-form-contamination guard)');
    });

    it('the four field-collection sites use getOwnedElements', function () {
        assert.ok(/\$inputs\s*=\s*getOwnedElements\(\$target,\s*['"]input['"]\)/.test(mainSrc),
            '$inputs should source via getOwnedElements');
        assert.ok(/\$textareas\s*=\s*getOwnedElements\(\$target,\s*['"]textarea['"]\)/.test(mainSrc),
            '$textareas should source via getOwnedElements');
        assert.ok(/\$select\s*=\s*getOwnedElements\(\$target,\s*['"]select['"]\)/.test(mainSrc),
            '$select should source via getOwnedElements');
        assert.ok(/\$buttonsTMP\s*=\s*getOwnedElements\(\$target,\s*['"]button['"]\)/.test(mainSrc),
            '$buttonsTMP should source via getOwnedElements');
    });

    it('bindForm initialises $form.reassociatedListeners side-table', function () {
        assert.ok(/Array\.isArray\(\$form\.reassociatedListeners\)/.test(mainSrc),
            '$form.reassociatedListeners initialiser should guard with Array.isArray()');
        assert.ok(/\$form\.reassociatedListeners\s*=\s*\[\]/.test(mainSrc),
            '$form.reassociatedListeners should be initialised as []');
    });

    it('proxy handlers are extracted as named expressions (reusable form-level + per-control)', function () {
        assert.ok(/var\s+resetProxyHandler\s*=\s*function/.test(mainSrc));
        assert.ok(/var\s+keydownProxyHandler\s*=\s*function/.test(mainSrc));
        assert.ok(/var\s+keyupProxyHandler\s*=\s*function/.test(mainSrc));
        assert.ok(/var\s+focusinProxyHandler\s*=\s*function/.test(mainSrc));
        assert.ok(/var\s+focusoutProxyHandler\s*=\s*function/.test(mainSrc));
        assert.ok(/var\s+changeProxyHandler\s*=\s*function/.test(mainSrc));
        assert.ok(/var\s+clickProxyHandler\s*=\s*function/.test(mainSrc));
    });

    it('form-level proxies dispatch via the named handlers (not inline closures)', function () {
        assert.ok(/addListener\(gina,\s*\$target,\s*['"]reset['"],\s*resetProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$target,\s*['"]keydown['"],\s*keydownProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$target,\s*['"]keyup['"],\s*keyupProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$target,\s*['"]focusin['"],\s*focusinProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$target,\s*['"]focusout['"],\s*focusoutProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$target,\s*['"]change['"],\s*changeProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$target,\s*['"]click['"],\s*clickProxyHandler\)/.test(mainSrc));
    });

    it('per-control reassociated loop attaches the 6 handlers on each out-of-tree control', function () {
        assert.ok(/!\$target\.contains\(\$rEl\)/.test(mainSrc),
            'reassociated loop should branch on !$target.contains($rEl)');
        assert.ok(/addListener\(gina,\s*\$rEl,\s*['"]click['"],\s*clickProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$rEl,\s*['"]change['"],\s*changeProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$rEl,\s*['"]keydown['"],\s*keydownProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$rEl,\s*['"]keyup['"],\s*keyupProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$rEl,\s*['"]focusin['"],\s*focusinProxyHandler\)/.test(mainSrc));
        assert.ok(/addListener\(gina,\s*\$rEl,\s*['"]focusout['"],\s*focusoutProxyHandler\)/.test(mainSrc));
    });

    it('per-control loop tracks listeners on $form.reassociatedListeners', function () {
        assert.ok(/\$form\.reassociatedListeners\.push\(/.test(mainSrc),
            'per-control loop should push {el, evt, fn} entries onto $form.reassociatedListeners');
    });

    it('unbindForm drains $form.reassociatedListeners', function () {
        assert.ok(/Array\.isArray\(\$form\.reassociatedListeners\)/.test(mainSrc),
            'unbindForm should check Array.isArray($form.reassociatedListeners)');
        assert.ok(/entry\.el\.removeEventListener\(entry\.evt,\s*entry\.fn/.test(mainSrc),
            'unbindForm should call entry.el.removeEventListener(entry.evt, entry.fn)');
    });

    it('reset and submit are NOT in the per-control reassociated event list', function () {
        // Reset and submit fire on the form directly (not on controls); the form-level
        // listeners on $target capture them for both in-tree and reassociated controls.
        // Confirm the per-control loop's event list excludes them by counting addListener
        // calls within the reassociated branch.
        var reassociatedBlock = mainSrc.match(/!\\$target\.contains\(\\$rEl\)\)\s*\{[\s\S]*?\}\s*\}/);
        // Use a slightly looser matcher (the block contents):
        var reassociatedRange = mainSrc.indexOf('!$target.contains($rEl)');
        assert.ok(reassociatedRange > 0, 'reassociated branch should be present');
        var blockEnd = mainSrc.indexOf('}', reassociatedRange + 200);
        var blockSrc = mainSrc.substring(reassociatedRange, blockEnd + 1);
        assert.equal(/addListener\(gina,\s*\$rEl,\s*['"]reset['"]/.test(blockSrc), false,
            'reset should NOT be attached per-control (form-level handles it)');
        assert.equal(/addListener\(gina,\s*\$rEl,\s*['"]submit['"]/.test(blockSrc), false,
            'submit should NOT be attached per-control (form-level handles it)');
    });
});
