'use strict';
/**
 * FormValidator id-collision guards (validateFormById + getFormById)
 *
 * Per the HTML spec, document.getElementById(id) returns the FIRST matching
 * element regardless of tag. When a persistent <p id="X"> exists in the DOM
 * before a <form id="X"> is later loaded from a popin / AJAX fragment, the
 * <p> wins. Pre-fix, both validateFormById and getFormById (via initForm)
 * passed the <p> to bindForm which then crashed inside getOwnedElements with
 * `Cannot read properties of undefined (reading 'length')` (<p>.elements is
 * undefined). The user-visible symptom was a popin that opened but stayed
 * invisible / unresponsive, with only the cryptic .length TypeError as a
 * breadcrumb.
 *
 * Both guards surface the collision with an actionable error naming the
 * offending tag and the colliding id. Same shape — `instanceof
 * HTMLFormElement` discriminator matching the existing precedent in
 * resetErrorsDisplay elsewhere in the same file.
 *
 * Strategy:
 *  - jsdom-backed DOM exercises a test-local replica of the guard
 *    (parameterised by function name) for the behavioural cases.
 *  - Source-inspection pins the guard's presence, shape, and position at
 *    BOTH call sites: validateFormById's else branch and getFormById's
 *    capture+guard pattern.
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


// --- Test-local replica of the guard ---
// MUST mirror the inline shape in main.js' validateFormById else branch AND
// getFormById's capture+guard pattern (same logic, different function name
// in the error message — parameterised here via `fnName`). HTMLFormElement
// is passed in (not pulled from a global) so the replica is hermetic across
// per-test JSDOM instances; each JSDOM has its own HTMLFormElement constructor
// and instanceof requires the same realm.
// The source-inspection blocks at the end of this file pin the bare
// `<var> instanceof HTMLFormElement` shape at both call sites in the actual
// source.
function guard($target, _id, HTMLFormElementCtor, fnName) {
    fnName = fnName || 'validateFormById';
    if ($target && !($target instanceof HTMLFormElementCtor)) {
        throw new Error(
            '[ FormValidator::' + fnName + '(formId) ] `' + _id + '` resolves to <'
            + $target.tagName + '>, not a FORM. A non-FORM element shares the same id as '
            + 'the target form — rename one of them so the id is unique.'
        );
    }
}


// --- DOM fixtures ---
function setupCollisionDom(siblingTag, sharedId) {
    siblingTag = siblingTag || 'p';
    sharedId   = sharedId   || 'parent';
    return new JSDOM('<!DOCTYPE html><html><body>'
        + '<' + siblingTag + ' id="' + sharedId + '">Sibling element sharing the id</' + siblingTag + '>'
        + '<form id="' + sharedId + '"><input name="name" type="text"></form>'
        + '</body></html>');
}

function setupCleanDom(formId) {
    formId = formId || 'onlyform';
    return new JSDOM('<!DOCTYPE html><html><body>'
        + '<form id="' + formId + '"><input name="name" type="text"></form>'
        + '</body></html>');
}


// 01 - guard throws when id resolves to a non-FORM element

describe('01 - guard throws when getElementById resolves to a non-FORM element', function () {

    it('throws when <p id="parent"> shadows <form id="parent">', function () {
        var dom     = setupCollisionDom('p', 'parent');
        var $target = dom.window.document.getElementById('parent');
        assert.equal($target.tagName, 'P',
            'fixture sanity: getElementById returns the <p> (first in document order)');
        assert.throws(
            function () { guard($target, 'parent', dom.window.HTMLFormElement); },
            /\[ FormValidator::validateFormById\(formId\) \]/
        );
    });

    it('error message names the offending tag (<P>) and the colliding id', function () {
        var dom     = setupCollisionDom('p', 'parent');
        var $target = dom.window.document.getElementById('parent');
        assert.throws(
            function () { guard($target, 'parent', dom.window.HTMLFormElement); },
            /`parent` resolves to <P>, not a FORM/
        );
    });

    it('error message suggests the rename action so the cause is actionable', function () {
        var dom     = setupCollisionDom('p', 'parent');
        var $target = dom.window.document.getElementById('parent');
        assert.throws(
            function () { guard($target, 'parent', dom.window.HTMLFormElement); },
            /rename one of them so the id is unique/
        );
    });

    it('also throws when a <div> shadows the form', function () {
        var dom     = setupCollisionDom('div', 'panel');
        var $target = dom.window.document.getElementById('panel');
        assert.equal($target.tagName, 'DIV');
        assert.throws(
            function () { guard($target, 'panel', dom.window.HTMLFormElement); },
            /resolves to <DIV>, not a FORM/
        );
    });

    it('also throws when a <span> shadows the form', function () {
        var dom     = setupCollisionDom('span', 'label');
        var $target = dom.window.document.getElementById('label');
        assert.throws(
            function () { guard($target, 'label', dom.window.HTMLFormElement); },
            /resolves to <SPAN>, not a FORM/
        );
    });
});


// 02 - guard does not throw on valid input

describe('02 - guard does not throw when id resolves to a FORM element', function () {

    it('does not throw on a clean DOM where id is unique to the form', function () {
        var dom     = setupCleanDom('onlyform');
        var $target = dom.window.document.getElementById('onlyform');
        assert.equal($target.tagName, 'FORM',
            'fixture sanity: getElementById returns the <form>');
        assert.doesNotThrow(function () {
            guard($target, 'onlyform', dom.window.HTMLFormElement);
        });
    });

    it('does not throw when getElementById returns null (id not in DOM)', function () {
        // The $target && short-circuit in the guard lets null fall through —
        // the surrounding function has its own handling of the $target===null
        // case (returns a $form with target:null and skips bindForm at the
        // `if ($target && !$form.binded)` guard).
        var dom     = setupCleanDom('onlyform');
        var $target = dom.window.document.getElementById('missing'); // null
        assert.equal($target, null);
        assert.doesNotThrow(function () {
            guard($target, 'missing', dom.window.HTMLFormElement);
        });
    });
});


// 03 - source-inspection: guard presence, shape, and position

describe('03 - source inspection: guard at validateFormById else branch', function () {

    it('uses `$target instanceof HTMLFormElement` (not a tagName string check)', function () {
        // instanceof is spec-conformant across shadow roots / iframes / cross-realm
        // cases — same shape as the existing $formOrFormId instanceof HTMLFormElement
        // discriminator in resetErrorsDisplay elsewhere in this file.
        var re = /if\s*\(\s*\$target\s*&&\s*!\(\s*\$target\s+instanceof\s+HTMLFormElement\s*\)\s*\)/;
        assert.ok(re.test(mainSrc),
            'guard must use `$target instanceof HTMLFormElement`');
    });

    it('guard sits immediately after the document.getElementById(_id) assignment', function () {
        // Anchor the guard to the document.getElementById call that produces $target.
        // Allows arbitrary whitespace and one comment block between the assignment
        // and the guard, but no other statement may sit between them.
        var re = /\$target\s*=\s*document\.getElementById\(_id\)\s*;[^;{}]{0,800}?if\s*\(\s*\$target\s*&&\s*!\(\s*\$target\s+instanceof\s+HTMLFormElement\s*\)\s*\)/;
        assert.ok(re.test(mainSrc),
            'guard must immediately follow the document.getElementById(_id) assignment with no intervening statement');
    });

    it('throws Error with the [FormValidator::validateFormById(formId)] prefix', function () {
        var re = /throw\s+new\s+Error\s*\(\s*['"]\[ FormValidator::validateFormById\(formId\) \]/;
        assert.ok(re.test(mainSrc),
            'guard must throw new Error with the [FormValidator::validateFormById(formId)] prefix');
    });

    it('error message includes the offending tagName via $target.tagName', function () {
        var re = /\$target\.tagName/;
        assert.ok(re.test(mainSrc),
            'guard error message must include $target.tagName so the offending tag is visible');
    });

    it('error message suggests the rename action so the cause is actionable', function () {
        var re = /rename one of them so the id is unique/;
        assert.ok(re.test(mainSrc),
            'guard error message must suggest renaming so the user can act on the collision');
    });

    it('whole-shape pin: getElementById call → guard → $validator.id in order', function () {
        // Belt-and-suspenders: assert the shape together so a regression that
        // reverts the guard or moves it elsewhere is caught by a single failure.
        var re = /binding a form out of context[\s\S]{0,200}?\$target\s*=\s*document\.getElementById\(_id\)[\s\S]{0,1200}?\$target\s+instanceof\s+HTMLFormElement[\s\S]{0,1200}?\$validator\.id\s*=/;
        assert.ok(re.test(mainSrc),
            'else-branch body must include the document.getElementById call, the instanceof HTMLFormElement guard, and the subsequent $validator.id assignment in order');
    });
});


// 04 - source-inspection: JSDoc on validateFormById names the new throw condition

describe('04 - source inspection: JSDoc documents the new @throws condition', function () {

    it('validateFormById JSDoc carries an @throws line', function () {
        // Anchored to the validateFormById JSDoc block — match @throws inside the
        // /** ... */ that immediately precedes `var validateFormById = function`.
        var re = /@throws\s+\{Error\}[\s\S]{0,400}?non-FORM[\s\S]{0,400}?\*\/\s*var\s+validateFormById\s*=\s*function/;
        assert.ok(re.test(mainSrc),
            'validateFormById JSDoc must carry an @throws {Error} line describing the non-FORM resolution case');
    });
});


// 05 - getFormById guard: throws when id resolves to a non-FORM element

describe('05 - getFormById guard throws when getElementById resolves to a non-FORM element', function () {

    it('throws with the [FormValidator::getFormById(formId)] prefix when <p id="parent"> shadows <form id="parent">', function () {
        var dom     = setupCollisionDom('p', 'parent');
        var $target = dom.window.document.getElementById('parent');
        assert.equal($target.tagName, 'P',
            'fixture sanity: getElementById returns the <p> (first in document order)');
        assert.throws(
            function () { guard($target, 'parent', dom.window.HTMLFormElement, 'getFormById'); },
            /\[ FormValidator::getFormById\(formId\) \]/
        );
    });

    it('error message names the offending tag and the colliding id', function () {
        var dom     = setupCollisionDom('p', 'parent');
        var $target = dom.window.document.getElementById('parent');
        assert.throws(
            function () { guard($target, 'parent', dom.window.HTMLFormElement, 'getFormById'); },
            /`parent` resolves to <P>, not a FORM/
        );
    });

    it('error message suggests the rename action so the cause is actionable', function () {
        var dom     = setupCollisionDom('p', 'parent');
        var $target = dom.window.document.getElementById('parent');
        assert.throws(
            function () { guard($target, 'parent', dom.window.HTMLFormElement, 'getFormById'); },
            /rename one of them so the id is unique/
        );
    });

    it('also throws when a <div> shadows the form', function () {
        var dom     = setupCollisionDom('div', 'panel');
        var $target = dom.window.document.getElementById('panel');
        assert.throws(
            function () { guard($target, 'panel', dom.window.HTMLFormElement, 'getFormById'); },
            /resolves to <DIV>, not a FORM/
        );
    });
});


// 06 - getFormById guard: does not throw when id resolves to a FORM element

describe('06 - getFormById guard does not throw when id resolves to a FORM element', function () {

    it('does not throw on a clean DOM where id is unique to the form', function () {
        var dom     = setupCleanDom('onlyform');
        var $target = dom.window.document.getElementById('onlyform');
        assert.equal($target.tagName, 'FORM');
        assert.doesNotThrow(function () {
            guard($target, 'onlyform', dom.window.HTMLFormElement, 'getFormById');
        });
    });

    it('does not throw when getElementById returns null (id not in DOM)', function () {
        // getFormById's outer check ($candidate != null) skips the guard entirely
        // when the element is absent — mirror that here: passing null to the
        // replica's `$target` short-circuits via the `$target &&` test.
        var dom     = setupCleanDom('onlyform');
        var $target = dom.window.document.getElementById('missing'); // null
        assert.equal($target, null);
        assert.doesNotThrow(function () {
            guard($target, 'missing', dom.window.HTMLFormElement, 'getFormById');
        });
    });
});


// 07 - source-inspection: getFormById guard presence, shape, and position

describe('07 - source inspection: getFormById guard at the on-the-fly registration block', function () {

    it('captures document.getElementById(_id) into $candidate (single call, not two)', function () {
        // Pre-fix shape called document.getElementById twice (once in the condition,
        // once in the initForm argument). Post-fix captures into $candidate so the
        // guard can run on a single resolved value.
        var re = /\/\/\s*in case form is created on the fly[^\n]*\n\s*var\s+\$candidate\s*=\s*document\.getElementById\(_id\)\s*;/;
        assert.ok(re.test(mainSrc),
            'getFormById must capture document.getElementById(_id) into $candidate before the null-check');
    });

    it('uses `$candidate instanceof HTMLFormElement` (not a tagName string check)', function () {
        // Same instanceof shape as validateFormById and resetErrorsDisplay.
        var re = /if\s*\(\s*!\(\s*\$candidate\s+instanceof\s+HTMLFormElement\s*\)\s*\)/;
        assert.ok(re.test(mainSrc),
            'getFormById guard must use `$candidate instanceof HTMLFormElement`');
    });

    it('throws Error with the [FormValidator::getFormById(formId)] prefix', function () {
        var re = /throw\s+new\s+Error\s*\(\s*['"]\[ FormValidator::getFormById\(formId\) \]/;
        assert.ok(re.test(mainSrc),
            'guard must throw new Error with the [FormValidator::getFormById(formId)] prefix');
    });

    it('error message includes the offending tagName via $candidate.tagName', function () {
        // Anchored to the getFormById guard via the [FormValidator::getFormById prefix.
        var re = /\[ FormValidator::getFormById\(formId\) \][\s\S]{0,400}?\$candidate\.tagName/;
        assert.ok(re.test(mainSrc),
            'getFormById guard error message must include $candidate.tagName');
    });

    it('initForm is called with the captured $candidate (not a fresh getElementById call)', function () {
        // Pin the post-fix shape: initForm receives the captured variable, not a
        // second getElementById call. Belt-and-suspenders against a future regression
        // that re-introduces the pre-fix double-call pattern.
        var re = /initForm\s*\(\s*\$candidate\s*\)\s*;/;
        assert.ok(re.test(mainSrc),
            'getFormById must call initForm with the captured $candidate variable');
    });

    it('the pre-fix double-call shape (initForm( document.getElementById(_id) )) is gone', function () {
        // Guard against a regression that re-introduces the inline second call.
        var re = /initForm\s*\(\s*document\.getElementById\(_id\)\s*\)/;
        assert.equal(re.test(mainSrc), false,
            'getFormById must NOT call initForm with a fresh document.getElementById(_id) — use the captured $candidate instead');
    });

    it('whole-shape pin: capture → guard → initForm($candidate) in order', function () {
        var re = /\$candidate\s*=\s*document\.getElementById\(_id\)[\s\S]{0,1500}?\$candidate\s+instanceof\s+HTMLFormElement[\s\S]{0,1500}?initForm\s*\(\s*\$candidate\s*\)/;
        assert.ok(re.test(mainSrc),
            'getFormById block must include the capture, the instanceof guard, and the initForm($candidate) call in order');
    });
});


// 08 - source-inspection: JSDoc on getFormById names the new throw condition

describe('08 - source inspection: JSDoc documents getFormById @throws', function () {

    it('getFormById JSDoc carries an @throws line', function () {
        var re = /@throws\s+\{Error\}[\s\S]{0,400}?non-FORM[\s\S]{0,400}?\*\/\s*var\s+getFormById\s*=\s*function/;
        assert.ok(re.test(mainSrc),
            'getFormById JSDoc must carry an @throws {Error} line referencing the non-FORM resolution case');
    });
});
