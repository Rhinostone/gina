'use strict';
/**
 * FormValidator::validateFormById fails loud on non-FORM id collision
 *
 * Per the HTML spec, document.getElementById(id) returns the FIRST matching
 * element regardless of tag. When a persistent <p id="X"> exists in the DOM
 * before a <form id="X"> is later loaded from a popin / AJAX fragment, the
 * <p> wins. Pre-fix, validateFormById passed the <p> to bindForm which then
 * crashed inside getOwnedElements with `Cannot read properties of undefined
 * (reading 'length')` (<p>.elements is undefined). The user-visible symptom
 * was a popin that opened but stayed invisible / unresponsive, with only the
 * cryptic .length TypeError as a breadcrumb.
 *
 * The guard at validateFormById's else branch (immediately after the
 * document.getElementById call) now surfaces the collision with an actionable
 * error naming the offending tag and the colliding id.
 *
 * Strategy:
 *  - jsdom-backed DOM exercises a test-local replica of the guard for the
 *    behavioural cases (throws / does-not-throw / null-safe / message shape).
 *  - Source-inspection pins the guard's presence, the `instanceof
 *    HTMLFormElement` shape (matching the existing precedent in
 *    resetErrorsDisplay), and the error-message format.
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
// MUST mirror the inline shape in main.js' validateFormById else branch.
// HTMLFormElement is passed in (not pulled from a global) so the replica is
// hermetic across per-test JSDOM instances; each JSDOM has its own
// HTMLFormElement constructor and instanceof requires the same realm.
// The source-inspection block at the end of this file pins the bare
// `$target instanceof HTMLFormElement` shape on the actual source.
function guard($target, _id, HTMLFormElementCtor) {
    if ($target && !($target instanceof HTMLFormElementCtor)) {
        throw new Error(
            '[ FormValidator::validateFormById(formId) ] `' + _id + '` resolves to <'
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
