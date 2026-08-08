'use strict';
/**
 * FormValidator — #B312: the not-ready marker is the framework's own channel
 *
 * `updateSubmitTriggerState` gates an invalid live-check form's submit trigger with
 * `data-gina-form-submit-gated="true"` + `.gina-form-submit-disabled` and touches NO
 * disabled vocabulary: `aria-disabled` belongs to AUTHORS (enforced by the gates and
 * never framework-cleared — the old auto-clear on valid is retired) and to the anchor
 * in-flight lock in `send()` (armed at readyState 1/3, released unconditionally at
 * both settles — the #B309 verdict replay retired with the sharing that required it).
 *
 * This file locks the contracts NEW to #B312; the replica-driven branch behaviour
 * lives in validator-submit-trigger-state.test.js (realigned in the same change):
 *
 *  - §01 single-writer, block-scoped: neither branch touches aria vocabulary in code
 *    (a block-scoped negative, because the branch-shape pins in the sibling file are
 *    substring matches a right-extension could slip past);
 *  - §02 authored-aria + in-flight-lock survival through the show-branch heal (#B313);
 *  - §03 the shipped isTriggerDisabled, extracted and EXECUTED — real bytes, no
 *    replica: gated arm, authored-aria arm, the #B293 nativeCounts guard;
 *  - §04 stray removeAttribute second-arguments (salvaged from the retired #B309 suite);
 *  - §05 settle releases: unconditional removal, zero arming, no verdict replay;
 *  - §06 dist fidelity: the gated marker ships in gina.min.js and gina.min.css.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var { JSDOM } = require('jsdom');

var FW     = require('../fw');
var MAIN   = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var MINJS  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
var MINCSS = path.join(FW, 'core/asset/plugin/dist/vendor/gina/css/gina.min.css');

var mainSrc, activeSrc;
before(function () {
    mainSrc = fs.readFileSync(MAIN, 'utf8');
    // ACTIVE code = full-line comments stripped. The replace-code convention keeps
    // retired lines as comments, and the #B312 retirement notes legitimately NAME
    // the old vocabulary — negative pins must not trip on prose.
    activeSrc = mainSrc.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
});

/**
 * Extracts a uniquely-declared function from source and returns it as a live
 * function — the "execute the EXTRACTED source" pattern for closure-private
 * constructs: real shipped bytes, no drift-prone replica. Brace-walk with a
 * started flag (the declaration may not carry the opening brace itself), both
 * controls asserted: unique declaration, balanced walk.
 */
function extractFn(src, decl) {
    var i = src.indexOf(decl);
    assert.ok(i > -1, 'declaration found: ' + decl);
    assert.strictEqual(src.indexOf(decl, i + 1), -1, 'declaration is unique: ' + decl);
    var j = i, depth = 0, started = false;
    for (; j < src.length; j++) {
        var c = src[j];
        if (c === '{') { depth++; started = true; }
        else if (c === '}') { depth--; if (started && depth === 0) { j++; break; } }
    }
    assert.ok(started && depth === 0, 'brace walk balanced');
    var body  = src.slice(i, j);
    var fnSrc = body.slice(body.indexOf('function'));
    return new Function('return (' + fnSrc + ');')();
}

function makeDom(markup) {
    var dom = new JSDOM('<!doctype html><html><body>' + markup + '</body></html>');
    return dom.window.document;
}

// Replica of updateSubmitTriggerState's SHOW branch (its three-line shape is pinned
// by validator-submit-trigger-state §06; §01 below adds the block-scoped negative
// that a right-extension of the real branch cannot slip past).
function runShowBranch($trigger) {
    $trigger.disabled = false;
    $trigger.removeAttribute('data-gina-form-submit-gated');
    $trigger.classList.remove('gina-form-submit-disabled');
}


// 01 - single-writer, block-scoped: the branches touch no aria vocabulary in code
describe('01 - #B312 single-writer: neither branch touches aria vocabulary (block-scoped)', function () {
    it('the show branch carries no aria reference in active code', function () {
        var i = activeSrc.indexOf('{ // show submitTrigger');
        assert.ok(i > -1, 'show branch anchor found');
        var j = activeSrc.indexOf('} else { // hide submitTrigger', i);
        assert.ok(j > i, 'hide branch anchor follows');
        var blk = activeSrc.slice(i, j);
        assert.strictEqual(blk.indexOf('aria-disabled'), -1,
            'single-writer: the gate never clears an aria mark (authored marks and the lock own it)');
    });

    it('the hide branch carries no aria reference in active code', function () {
        var i = activeSrc.indexOf('} else { // hide submitTrigger');
        assert.ok(i > -1, 'hide branch anchor found');
        // the branch closes at the first lone close-brace pair after the anchor
        var blk = activeSrc.slice(i, i + 300);
        assert.ok(blk.indexOf("setAttribute('data-gina-form-submit-gated', 'true')") > -1,
            'slice covers the marker write (window sanity)');
        assert.strictEqual(blk.indexOf('aria-disabled'), -1,
            'single-writer: the gate never claims aria disabled');
    });

    it('control: the negatives CAN fire — the raw source still names aria-disabled', function () {
        assert.ok(mainSrc.indexOf('aria-disabled') > -1,
            'the needle exists in the file (comments + the lock), so a zero above is a real absence');
    });
});


// 02 - authored-aria + in-flight-lock survival through the show-branch heal
describe('02 - authored aria and the in-flight lock survive the heal (#B312 / #B313)', function () {
    it('an AUTHORED aria-disabled is NOT auto-cleared when the form turns valid', function () {
        var doc = makeDom('<button id="t" type="submit" aria-disabled="true" ' +
            'data-gina-form-submit-gated="true" class="gina-form-submit-disabled">Send</button>');
        var $t = doc.getElementById('t');
        runShowBranch($t);
        assert.strictEqual($t.getAttribute('data-gina-form-submit-gated'), null, 'the gate clears its own channel');
        assert.strictEqual($t.classList.contains('gina-form-submit-disabled'), false, 'and its class');
        assert.strictEqual($t.getAttribute('aria-disabled'), 'true',
            'but an authored aria mark is the author\'s to clear — pre-#B312 the show branch stripped it');
    });

    it('#B313: the anchor in-flight lock survives a mid-flight reveal heal', function () {
        // The lock arms aria-disabled on an <a> trigger at readyState 1/3. A second
        // click mid-flight is refused by the gate and answered with the reveal, whose
        // valid-form show branch used to strip the lock's marker (#B313). Under
        // #B312's single-writer split the heal touches only the gated channel.
        var doc = makeDom('<a id="t" data-gina-form-submit="true" href="#" aria-disabled="true">Send</a>');
        var $t = doc.getElementById('t');
        runShowBranch($t); // the reveal's updateSubmitTriggerState(valid) heal
        assert.strictEqual($t.getAttribute('aria-disabled'), 'true',
            'the lock stays armed until send()\'s own settle release removes it');
    });
});


// 03 - the shipped isTriggerDisabled, executed
describe('03 - isTriggerDisabled (extracted, real bytes): gated + authored arms, #B293 guard', function () {
    var isTriggerDisabled;
    before(function () {
        isTriggerDisabled = extractFn(mainSrc, 'var isTriggerDisabled = function($el)');
    });

    it('fires on the gated marker', function () {
        var doc = makeDom('<button id="t" data-gina-form-submit-gated="true">Send</button>');
        assert.strictEqual(isTriggerDisabled(doc.getElementById('t')), true);
    });

    it('fires on an authored aria-disabled', function () {
        var doc = makeDom('<button id="t" aria-disabled="true">Send</button>');
        assert.strictEqual(isTriggerDisabled(doc.getElementById('t')), true);
    });

    it('#B293: a native disabled ATTRIBUTE on a real form control does not count', function () {
        // On a <button>, `disabled` is a real IDL property — the browser enforces it,
        // so an attribute seen here could only be a mid-dispatch double-submit guard.
        var doc = makeDom('<button id="t" disabled>Send</button>');
        assert.strictEqual(isTriggerDisabled(doc.getElementById('t')), false);
    });

    it('a native disabled attribute on an <a> DOES count (nothing enforces it there)', function () {
        var doc = makeDom('<a id="t" href="#" disabled="disabled">Send</a>');
        assert.strictEqual(isTriggerDisabled(doc.getElementById('t')), true);
    });

    it('an unmarked trigger is not refused (control: the predicate can say false)', function () {
        var doc = makeDom('<button id="t">Send</button>');
        assert.strictEqual(isTriggerDisabled(doc.getElementById('t')), false);
    });
});


// 04 - stray removeAttribute second-arguments (salvaged from the retired #B309 suite)
describe('04 - removeAttribute stays unary in live code', function () {
    it('active code carries no removeAttribute(x, y) call', function () {
        var strays = (activeSrc.match(/removeAttribute\('[^']+',\s*[^)\n]+\)/g) || []);
        assert.deepEqual(strays, [], 'removeAttribute is unary; a 2nd argument is silently ignored');
    });

    it('control: the scanner CAN fire — the preserved was:-record in raw source matches it', function () {
        assert.match(mainSrc, /removeAttribute\('aria-disabled',\s*true\)/,
            'the historical stray-arg record (the readyState-4 was:-comment) keeps this scanner honest');
    });
});


// 05 - settle releases: unconditional removal, zero arming, no verdict replay
describe('05 - settle releases are unconditional single-writer removals (#B312)', function () {
    function releaseBlock(anchor) {
        var i = activeSrc.indexOf(anchor);
        assert.ok(i > -1, 'release anchor found: ' + anchor);
        var j = activeSrc.indexOf("removeAttribute('data-gina-form-loading')", i);
        assert.ok(j > i, 'terminator (the form-loading removal) follows the anchor');
        return activeSrc.slice(i, j);
    }

    it('the loadend release removes aria unconditionally and arms nothing', function () {
        var blk = releaseBlock("addEventListener('loadend', function onSendSettled()");
        assert.ok(blk.indexOf("removeAttribute('aria-disabled')") > -1, 'unconditional aria removal');
        assert.ok(blk.indexOf("removeAttribute('disabled')") > -1, 'and the native twin for buttons');
        assert.strictEqual(blk.split('setAttribute').length - 1, 0, 'zero setAttribute: a release removes, never arms');
        assert.strictEqual(blk.indexOf('_gateMarked'), -1, 'no #B309 verdict replay');
    });

    it('the readyState-4 release stays in step', function () {
        var blk = releaseBlock('$form.isSending = false; // #B175');
        assert.ok(blk.indexOf("removeAttribute('aria-disabled')") > -1, 'unconditional aria removal');
        assert.strictEqual(blk.split('setAttribute').length - 1, 0, 'zero setAttribute');
        assert.strictEqual(blk.indexOf('_gateMarked'), -1, 'no #B309 verdict replay');
    });

    it('_gateMarked is gone as code, file-wide', function () {
        assert.strictEqual(activeSrc.indexOf('_gateMarked'), -1,
            'the shadow died with the shared attribute (retirement comments may still name it)');
    });
});


// 06 - dist fidelity: the gated marker ships (red before the prod rebuild, green after)
describe('06 - dist fidelity: the gated marker ships in the built bundle', function () {
    it('gina.min.js carries the gated marker at all three sites', function () {
        var min = fs.readFileSync(MINJS, 'utf8');
        assert.match(min, /setAttribute\(\s*['"]data-gina-form-submit-gated['"]\s*,\s*['"]true['"]\s*\)/,
            'the hide-branch write survives minification');
        assert.match(min, /removeAttribute\(\s*['"]data-gina-form-submit-gated['"]\s*\)/,
            'the show-branch removal survives minification');
        assert.match(min, /getAttribute\(\s*['"]data-gina-form-submit-gated['"]\s*\)\s*==\s*['"]true['"]/,
            'the predicate arm survives minification');
    });

    it('gina.min.css ships the default gated look', function () {
        var css = fs.readFileSync(MINCSS, 'utf8');
        assert.ok(css.indexOf('data-gina-form-submit-gated') > -1, 'the gated selector is present');
        assert.ok(css.indexOf('not-allowed') > -1, 'the cursor rule is present');
    });
});
