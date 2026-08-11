'use strict';

/**
 * #B332 / #B333 / #B334 — a submit must never go out while an async `query`
 * rule's verdict is still on the wire, and one click must run ONE validation
 * cycle.
 *
 * The measured defect chain (consumer page, live-check off, a `query` rule
 * declared last on the email field, submit button WITHOUT an id in markup):
 *
 *   1. #B333 — `getOwnedElements` deduped by ID, so the id-less submit button
 *      entered the collection twice ($form.elements walk + in-tree sweep), and
 *      the rebind guard tested `gina.events[<buttonId>]` — a key nothing writes
 *      (the registered key is `submit.<buttonId>`) — so `bindSubmitEl` stacked
 *      TWO live listeners: one click -> two full validate() passes.
 *   2. #B332 — pass 2's `query` branch found pass 1's `asyncCompleted.<id>`
 *      waiter in the gina.events registry, zeroed ITS OWN pending-async counter
 *      and returned: its terminal block completed on the sync-only verdict and
 *      `send()` fired ~200ms BEFORE the query XHR answered. The "already
 *      registered" error rendered after the POST had left.
 *   3. #B334 — every validate() left its `validated.<formId>` listener attached
 *      (the self-removal call carries no fn ref — a DOM no-op), and each stale
 *      listener ran the DISPATCHING pass's callback (`event.detail`): one
 *      `validated.` dispatch -> two `validate.<id>` dispatches -> two send()
 *      calls (production absorbed the second via the withRateLimit gate).
 *
 * Sections:
 *   01 — main.js source pins (each verified RED against the pre-fix bytes)
 *   02 — getOwnedElements real-bytes behavior (extract-and-eval, jsdom), with
 *        the PRE-fix in-tree condition embedded as the subtract-control
 *   03 — form-validator.js in-flight gate pins (set / gate / both clears)
 *   04 — dist fidelity (the built bundle carries the fix literals)
 */

var fs     = require('fs');
var path   = require('path');
var assert = require('assert');
var { describe, it, before } = require('node:test');
var { JSDOM } = require('jsdom');

var pkg  = require(path.join(__dirname, '..', '..', 'package.json'));
var FW   = path.join(__dirname, '..', '..', 'framework', 'v' + pkg.version);
var MAIN = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var FV   = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var DIST = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var mainSrc, fvSrc;

before(function () {
    mainSrc = fs.readFileSync(MAIN, 'utf8');
    fvSrc   = fs.readFileSync(FV, 'utf8');
});

/** Slice `src` between two unique anchors — throws (instrument, not verdict) on a miss. */
function slice(src, from, to, label) {
    var a = src.indexOf(from);
    assert.ok(a > -1, '[instrument] anchor not found: ' + label + ' / from');
    var b = src.indexOf(to, a);
    assert.ok(b > a, '[instrument] anchor not found: ' + label + ' / to');
    return src.slice(a, b);
}

describe('01 - main.js source pins (#B332/#B333/#B334)', function () {

    it('01a - the query arm guard is PASS-LOCAL: armedAsyncFields declared and consulted', function () {
        assert.match(mainSrc, /,\s*armedAsyncFields\s*=\s*\{\}/,
            'validate() must declare the pass-local armedAsyncFields set');
        var q = slice(mainSrc, "// query rule case", "addListener(gina, $asyncField, asyncEvt", 'query arm block');
        assert.ok(q.indexOf("armedAsyncFields[$asyncFieldId]") > -1,
            'the arm guard must consult the pass-local set');
    });

    it('01b - the query arm block no longer zeroes asyncCount on a registry hit', function () {
        var q = slice(mainSrc, "// query rule case", "addListener(gina, $asyncField, asyncEvt", 'query arm block');
        // active statements only — the `// was:` record legitimately retains the
        // old line in comment form (jsdoc.md: scope a negative pin to the block,
        // and never let a replace-code comment satisfy/trip it)
        assert.ok(!/^\s*asyncCount\s*=\s*0;/m.test(q),
            'an ACTIVE asyncCount-zeroing statement is back in the query arm block');
        assert.ok(!/^\s*if\s*\(\s*typeof\(gina\.events\[asyncEvt\]\)/m.test(q),
            'the registry-based (cross-pass) arm guard is back');
    });

    it('01c - the asyncCompleted waiter detaches itself on first fire', function () {
        var q = slice(mainSrc, "function onasyncCompleted(event)", "triggeredCount++", 'waiter head');
        assert.ok(q.indexOf("event.currentTarget.removeEventListener(event.type, onasyncCompleted, false)") > -1,
            'the waiter must consume exactly one settle and leave the node');
    });

    it('01d - the validated listener registers only for function callbacks, pairs by detail identity, and self-removes', function () {
        var v = slice(mainSrc, "if ( isGFFCtx && typeof(cb) === 'function' ) {\n            addListener(gina, $formOrElement, evt, function onValidatedOwnPass",
            'if (!hasBeenValidated) {', 'validated listener head');
        assert.ok(v.indexOf('event.detail !== cb') > -1,
            'the listener must refuse another pass\'s completion (detail identity)');
        assert.ok(v.indexOf('event.currentTarget.removeEventListener(event.type, onValidatedOwnPass, false)') > -1,
            'the listener must detach itself on consumption');
    });

    it('01e - both async completion dispatches target $formOrElement (the node the listener sits on)', function () {
        var active = mainSrc.match(/^\s*triggerEvent\(gina, \$formOrElement, 'validated\.' \+ formId, cb\);/mg) || [];
        assert.strictEqual(active.length, 2,
            'expected exactly 2 active $formOrElement-targeted validated dispatches, got ' + active.length);
        var stale = mainSrc.match(/^\s*triggerEvent\(gina, \$currentForm, 'validated\.'/mg) || [];
        assert.strictEqual(stale.length, 0,
            'a form-targeted async validated dispatch is back — a single-element pass\'s listener cannot hear it');
    });

    it('01f - the submit-binding rebind guard tests the key bindSubmitEl actually registers', function () {
        var g = slice(mainSrc, "var _submitEvt = ( /^submit\\./i.test(evt) ) ? evt : 'submit.'+ evt;",
            'bindSubmitEl(evt, $submit);', 'rebind guard');
        assert.ok(g.indexOf('gina.events[_submitEvt]') > -1,
            'the guard must consult the namespaced submit.<id> key');
    });

    it('01g - the submit handler refuses re-entry while a cycle is between click and settle', function () {
        var h = slice(mainSrc, 'var _latchFormId = $target.getAttribute', '// getting fields & values', 'submit latch');
        assert.ok(/isSubmitting/.test(h) && /return;/.test(h),
            'the isSubmitting belt guard must sit at the top of the submit handler');
    });
});

describe('02 - getOwnedElements real-bytes behavior (extract-and-eval + subtract-control)', function () {

    var realGetOwnedElements;
    var fixture;

    /** PRE-fix in-tree condition, verbatim — the subtract-control instrument. */
    function preFixGetOwnedElements($form, tag) {
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

    before(function () {
        var from = 'var getOwnedElements = function($form, tag) {';
        var a = mainSrc.indexOf(from);
        assert.ok(a > -1, '[instrument] getOwnedElements head not found');
        var to = '\n        };';
        var b = mainSrc.indexOf(to, a);
        assert.ok(b > a, '[instrument] getOwnedElements tail not found');
        var body = mainSrc.slice(a, b + to.length);
        // execute the REAL bytes (no replica to drift)
        realGetOwnedElements = new Function('"use strict";' + body.replace('var getOwnedElements =', 'return') + ';')();
        assert.strictEqual(typeof realGetOwnedElements, 'function', '[instrument] extraction must yield a callable');

        var dom = new JSDOM('<!DOCTYPE html><html><body>' +
            '<form id="parent">' +
            '  <input name="email" type="text">' +                 // id-less in-tree input
            '  <button type="submit">Go</button>' +                // id-less in-tree submit — THE defect shape
            '  <button id="named" type="submit">Alt</button>' +    // id-carrying in-tree control (old dedup covered it)
            '</form>' +
            '<button form="parent" type="submit">Out</button>' +   // reassociated, id-less (single-source: elements only)
            '</body></html>');
        fixture = dom.window.document.getElementById('parent');
    });

    it('02a - subtract-control: the PRE-fix bytes double-collect the id-less in-tree button', function () {
        var old = preFixGetOwnedElements(fixture, 'button');
        assert.strictEqual(old.length, 4,
            'the control must fire: pre-fix collection was expected to hold 4 entries (dup id-less + named + reassociated), got ' + old.length);
    });

    it('02b - the shipped bytes collect each owned button exactly once', function () {
        var now = realGetOwnedElements(fixture, 'button');
        assert.strictEqual(now.length, 3,
            'expected exactly 3 buttons (id-less in-tree, named in-tree, reassociated), got ' + now.length);
        var distinct = now.filter(function (el, i) { return now.indexOf(el) === i; });
        assert.strictEqual(distinct.length, now.length, 'no node may appear twice');
    });

    it('02c - id-less inputs stop double-collecting too (same mechanism)', function () {
        var old = preFixGetOwnedElements(fixture, 'input');
        var now = realGetOwnedElements(fixture, 'input');
        assert.strictEqual(old.length, 2, 'control must fire on inputs as well');
        assert.strictEqual(now.length, 1, 'the id-less input must be collected once');
    });

    it('02d - reassociated and id-carrying controls are unaffected (no over-dedup)', function () {
        var now = realGetOwnedElements(fixture, 'button');
        var named = now.filter(function (el) { return el.id === 'named'; });
        var out   = now.filter(function (el) { return el.getAttribute('form') === 'parent'; });
        assert.strictEqual(named.length, 1, 'the id-carrying in-tree button stays collected');
        assert.strictEqual(out.length, 1, 'the reassociated button stays collected');
    });
});

describe('03 - form-validator.js: the query in-flight gate (#B332)', function () {

    it('03a - the marker is set BEFORE the wire call', function () {
        var s = slice(fvSrc, 'ginaFormValidatorQueryPending = _this.value', 'xhr.send(', 'pending set');
        assert.ok(s.length > 0, 'the pending marker assignment must precede xhr.send()');
    });

    it('03b - the same-value fast path refuses to release while that value is pending', function () {
        var b = slice(fvSrc, '} else if (testedValue === this.value) {', 'var hasCachedErrors = false;', 'same-value branch head');
        assert.ok(b.indexOf('ginaFormValidatorQueryPending === this.value') > -1,
            'the pending gate must sit at the TOP of the same-value branch');
        assert.ok(b.indexOf('return self[this.name]') > -1,
            'a pending same-value re-entry must return without releasing the waiter');
    });

    it('03c - BOTH settle chokepoints clear the marker, value-guarded', function () {
        var p = slice(fvSrc, 'var processQueryResult = function(result) {', '#B87: a boolean checkbox', 'processQueryResult head');
        assert.ok(p.indexOf('ginaFormValidatorQueryPending === String(_this.value)') > -1,
            'processQueryResult must clear its own request\'s marker first');
        var r = slice(fvSrc, 'var releaseQueryWaiter = function(err) {', 'var onResult', 'releaseQueryWaiter');
        assert.ok(r.indexOf('ginaFormValidatorQueryPending === String(_this.value)') > -1,
            'releaseQueryWaiter must clear the marker too — a failed settle still ends the request');
    });
});

describe('05 - #B337: the completion payload carries the WHOLE pass verdict', function () {

    it('05a - cb._errors is the no-arg getErrors() (full field-keyed map)', function () {
        var b = slice(mainSrc, "cb._data = d['toData']();", "if ( cb._errors && cb._errors.count() > 0)", 'completion payload block');
        assert.ok(/^\s*cb\._errors = d\['getErrors'\]\(\);/m.test(b),
            'the completion payload must be the no-arg getErrors() — full-form verdict');
        assert.ok(!/^\s*cb\._errors = d\['getErrors'\]\(field\);/m.test(b),
            'the field-scoped payload is back — every other invalid field would vanish from the submit path');
    });

    it('05b - the touched-field display call KEEPS its field argument (the live-check contract)', function () {
        var b = slice(mainSrc, "cb._data = d['toData']();", "triggerEvent(gina, $formOrElement, 'validated.' + formId, cb);", 'completion display block');
        assert.ok(b.indexOf('handleErrorsDisplay($currentForm, cb._errors, cb._data, field)') > -1,
            'the in-branch render must stay scoped to the touched field — widening it would break §4c');
    });

    it('05c - engine contract: getErrors() no-arg iterates every field, same shape as the scoped call', function () {
        var g = slice(fvSrc, "self['getErrors'] = function(fieldName) {", 'return errors\n    }', 'getErrors body');
        assert.ok(/typeof\(fieldName\) != 'undefined'/.test(g), 'scoped branch present');
        assert.ok(/for \(var field in self\)/.test(g), 'no-arg branch iterates all fields');
    });
});

describe('04 - dist fidelity (the built bundle carries the fix)', function () {

    var distSrc;
    before(function () { distSrc = fs.readFileSync(DIST, 'utf8'); });

    it('04a - positive control: a known form-validator literal is present', function () {
        assert.ok(distSrc.indexOf('ginaFormValidatorTestedValue') > -1,
            '[instrument] the bundle does not even carry the tested-value literal — wrong artifact?');
    });

    it('04b - the in-flight marker literal shipped', function () {
        assert.ok(distSrc.indexOf('ginaFormValidatorQueryPending') > -1,
            'gina.min.js must carry the pending-marker literal');
    });

    it('04c - the pass-local arm debug literal shipped', function () {
        assert.ok(distSrc.indexOf('already armed by this pass') > -1,
            'gina.min.js must carry the pass-local arm path');
    });
});
