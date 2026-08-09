'use strict';
// #B288 slice 2 — a modified click (cmd/ctrl/shift/alt) on a bound `<a data-gina-link>`
// must reach the browser, not the XHR path. Slice 1 handled the anchor SHAPES that the
// browser owns (`download`, `target`, a bare `#`) at bind time; a modifier is a property
// of the click, not of the anchor, so it can only be judged when the click happens.
//
// Three native-event sites exist, and all three must bail — they are reached on two
// different paths:
//
//   direct click  -> per-anchor listener (preventDefault)  -> document proxy (cancelEvent
//                    + triggerEvent) -> custom-event handler -> linkRequest
//   child click   -> proxyClick (cancelEvent + triggerEvent) -> custom-event handler
//                    -> linkRequest        (cancelEvent stops propagation, so the two
//                                           sites above are never reached on this path)
//
// The custom-event handler in `registerLink` is deliberately NOT guarded: `triggerEvent`
// builds a `CustomEvent` and copies native properties only when handed a `proxiedEvent`,
// which no call site in this module passes. By that hop `metaKey` and friends are gone,
// so a guard there could never fire. Guarding the three native sites makes it unreachable
// on a modified click anyway.

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW = require('../fw');
var LINK_SRC = path.join(FW, 'core/asset/plugin/src/vendor/gina/link/main.js');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }

// Drops whole-line comments, so a negative assertion cannot be tripped by the very
// comment that documents the omission. Matches the stripper the sibling link tests use;
// note it only removes lines that START with a marker — a trailing `// …` on a code line
// survives, which is what we want when asserting about code.
function activeSource(p) {
    return read(p).split('\n').filter(function(l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// Extracts a balanced-brace block starting at `anchor`, so an assertion about ordering
// inside one listener cannot accidentally read a neighbouring one.
function blockAt(src, anchor) {
    var start = src.indexOf(anchor);
    assert.ok(start > -1, 'extraction anchor not found in link/main.js: ' + anchor);
    var open = src.indexOf('{', start);
    assert.ok(open > -1, 'no opening brace after anchor: ' + anchor);
    var depth = 0, i = open;
    for (; i < src.length; ++i) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    assert.equal(depth, 0, 'unbalanced braces while extracting block for: ' + anchor);
    return src.slice(start, i + 1);
}


// ── 01 — the predicate itself ─────────────────────────────────────────────────

describe('01 - link: isModifiedClick predicate', function() {

    it('is defined as a local closure in link/main.js', function() {
        assert.match(
            read(LINK_SRC),
            /var\s+isModifiedClick\s*=\s*function\s*\(\s*e\s*\)\s*\{/,
            'expected a local `var isModifiedClick = function(e) {` helper'
        );
    });

    it('tests all four modifier keys', function() {
        var body = blockAt(read(LINK_SRC), 'var isModifiedClick = function(e)');
        ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].forEach(function(k) {
            assert.ok(
                body.indexOf('e.' + k) > -1,
                'isModifiedClick must test e.' + k + ' (a click the browser owns)'
            );
        });
    });

    it('is null-safe — a synthetic call with no event must not throw', function() {
        var body = blockAt(read(LINK_SRC), 'var isModifiedClick = function(e)');
        assert.match(
            body, /\(\s*e\s*&&/,
            'isModifiedClick must guard on `e` before reading modifier properties'
        );
    });

    it('returns a real boolean, not a truthy modifier value', function() {
        var body = blockAt(read(LINK_SRC), 'var isModifiedClick = function(e)');
        assert.match(body, /return\s+!!\s*\(/, 'expected a `return !!( … )` coercion');
    });
});


// ── 02 — every NATIVE-event site bails before it suppresses ───────────────────

describe('02 - link: all three native click sites consult the guard first', function() {

    it('the per-anchor listener bails before preventDefault', function() {
        var src = read(LINK_SRC);
        assert.ok(
            src.indexOf("addListener(gina, $el, 'click', function(e) { if ( isModifiedClick(e) ) return; e.preventDefault(); })") > -1,
            'the bound <a> click listener must bail on a modified click before suppressing the default'
        );
    });

    it('the child proxy bails before cancelEvent', function() {
        var block = blockAt(read(LINK_SRC), 'var proxyClick = function($childNode, $el, evt)');
        var guard  = block.indexOf('isModifiedClick');
        var cancel = block.indexOf('cancelEvent');
        assert.ok(guard  > -1, 'proxyClick must consult isModifiedClick');
        assert.ok(cancel > -1, 'proxyClick still cancels an unmodified click');
        assert.ok(
            guard < cancel,
            'proxyClick must bail BEFORE cancelEvent — its stopPropagation would otherwise strand the click'
        );
    });

    it('the document proxy bails before cancelEvent and before the id backfill', function() {
        var block = blockAt(read(LINK_SRC), 'addListener(gina, instance.target, evt, function(event)');
        var guard    = block.indexOf('isModifiedClick');
        var cancel   = block.indexOf('cancelEvent');
        var backfill = block.indexOf('setAttribute');
        assert.ok(guard  > -1, 'the document proxy must consult isModifiedClick');
        assert.ok(cancel > -1, 'the document proxy still cancels an unmodified click');
        assert.ok(guard < cancel,   'the document proxy must bail BEFORE cancelEvent');
        assert.ok(
            backfill === -1 || guard < backfill,
            'the document proxy must bail BEFORE writing a generated id onto the element'
        );
    });
});


// ── 03 — negative invariants: three deliberate omissions ─────────────────────
// Each of these documents a decision that measurement produced. They are written as
// tests so a future "let's complete the guard set" pass has to read the reason first.

describe('03 - link: the deliberate omissions stay omitted', function() {

    it('the custom-event handler in registerLink is NOT modifier-guarded', function() {
        // `triggerEvent` dispatches a CustomEvent and copies native properties only when
        // given a `proxiedEvent`; no call site here does. A guard placed after that hop
        // reads `undefined` for every modifier and can never fire.
        var block = blockAt(read(LINK_SRC), 'addListener(gina, $el, evt, function(e)');
        assert.equal(
            block.indexOf('isModifiedClick'), -1,
            'registerLink handles a synthesised CustomEvent that carries no modifier data — a guard there is dead code'
        );
    });

    it('nav\'s defaultPrevented bail is NOT copied into link', function() {
        // The per-anchor listener suppresses the default before the document proxy runs,
        // so `defaultPrevented` is already true by then and the bail would fire on every click.
        // Comment-stripped for the same reason as the button assertion below: the helper's
        // JSDoc names `defaultPrevented` to record why nav's bail is not reused here.
        assert.equal(
            activeSource(LINK_SRC).indexOf('defaultPrevented'), -1,
            'link must not bail on defaultPrevented — its own listener sets it on every click'
        );
    });

    it('no button / which guard was added', function() {
        // Measured in a real browser: a middle click fires `auxclick`, not `click`, so it
        // never reaches this plugin — the browser opens the tab and no request is made.
        // Asserted against comment-stripped source: the prose above (and the helper's own
        // JSDoc) names `event.button` precisely to explain the omission, and a raw-source
        // needle would match that documentation rather than any code.
        var code = activeSource(LINK_SRC);
        assert.equal(code.indexOf('.button'), -1, 'no e.button guard is needed (middle click fires auxclick)');
        assert.equal(code.indexOf('.which'),  -1, 'no e.which guard is needed (middle click fires auxclick)');
    });
});


// ── 04 — #B324: the dead id-backfill stays deleted ───────────────────────────
// The document proxy used to open with an id-backfill gated on
// `typeof(event.target.id) == 'undefined'` — never true, since an element's `id` IDL
// attribute always exists and defaults to ''. Section 02's ordering assertion already
// tolerates its absence (`backfill === -1 || guard < backfill`), which is what let the
// block be removed without touching that test; this section asserts the stronger fact
// that it must not come BACK. The popin plugin carried the identical dead pair, removed
// as #B300.

describe('04 - link: the #B324 id-backfill stays deleted', function() {

    it('the document proxy does not write a generated id onto the clicked element', function() {
        // Comment-stripped: the #B324 note quotes the removed condition verbatim so a
        // future reader does not restore it, and a raw-source assertion would match my
        // own explanation — a control that can never fail.
        var block = blockAt(activeSource(LINK_SRC), 'addListener(gina, instance.target, evt, function(event)');

        // CONTROL first — proves the block extracted is the document proxy and is
        // non-empty. Without it, a mis-anchored region would pass the negatives vacuously.
        assert.ok(block.indexOf('instance.$links[event.target.id]') > -1,
            'control: the document proxy must still key its dispatch on instance.$links (#B302) — if this fails the extraction is wrong and the negatives below prove nothing');

        assert.equal(block.indexOf("typeof(event.target.id) == 'undefined'"), -1,
            'the always-false id gate must stay deleted: an element\'s `id` always exists (defaults to ""), so the body never ran');
        assert.equal(block.indexOf("setAttribute('id', evt"), -1,
            'the id-backfill must stay deleted — and must NOT be "repaired" by correcting the operand: instance.target is `document` and evt is the literal "click", so a live body would write id="click.<uuid>" onto EVERY id-less element clicked in the page, and since #B302 the dispatch keys on registration rather than the id SHAPE, so such an id dispatches nothing');
    });
});
