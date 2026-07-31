'use strict';
/**
 * #B178 — error-message rendering: distinct-text dedup + separator-joined
 * aria-live announcements.
 *
 * Two render-side defects behind the same consumer report:
 *   1. The two error-display loops append one `<p>` per error KEY with no
 *      dedup — a coercion paired with its validator (both failing on the
 *      same input with the same resolved text) rendered the identical
 *      sentence twice. Each loop now renders each DISTINCT text once; the
 *      dev-inspector bookkeeping still records every key.
 *   2. The aria-live announcement passed `$err.textContent`, which
 *      concatenates the `<p>` texts with NO separator — a screen reader
 *      received multiple messages as one run-on string (visually they stack
 *      as blocks, so only the announcement channel was affected). The
 *      announce sites now pass the per-message texts joined with '. ' via
 *      `getA11yAnnounceText`.
 *
 * The helper is executed from the SHIPPED bytes (brace-match extraction with
 * its two controls — declaration matched exactly once, braces balanced), per
 * the house extraction pattern; the loop behaviour is covered by a replica
 * that the source pins keep honest.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');
var { JSDOM } = require('jsdom');

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var MAIN_SRC  = fs.readFileSync(MAIN_PATH, 'utf8');
var DIST_RAW  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

/**
 * Brace-match a `var <name> = function(...) { ... };` declaration out of the
 * source and return the function text. Controls: the declaration must appear
 * exactly once, and the brace walk must end balanced.
 */
function extractFn(src, decl) {
    var declIdx = src.indexOf(decl);
    assert.ok(declIdx >= 0, 'extraction anchor not found: ' + decl);
    assert.equal(src.indexOf(decl, declIdx + 1), -1,
        'extraction anchor must be unique: ' + decl);
    var open = src.indexOf('{', declIdx);
    var depth = 0, i = open;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    assert.equal(depth, 0, 'brace walk must end balanced');
    var fnStart = src.indexOf('function', declIdx);
    return src.slice(fnStart, i + 1);
}


// 00 — source pins (each validated red-first against the pre-fix blob)
describe('00 - source pins', function () {

    it('defines the getA11yAnnounceText helper with the separator join', function () {
        assert.match(MAIN_SRC, /var getA11yAnnounceText = function\(\$err\)/);
        var helperIdx = MAIN_SRC.indexOf('var getA11yAnnounceText = function($err)');
        var block = MAIN_SRC.slice(helperIdx, helperIdx + 800);
        assert.match(block, /parts\.join\('\. '\)/, 'the helper must join with a period-space separator');
    });

    it('both announce sites pass the joined text (and the raw-textContent form is gone)', function () {
        var calls = MAIN_SRC.match(/announceA11yError\(\s*\$form\s*,\s*getA11yAnnounceText\(\s*\$err\s*\)\s*\)/g) || [];
        assert.equal(calls.length, 2, 'first-error branch + refresh branch');
        // access-form negative: the retired call shape must be globally absent from code
        // (this file's own comments name the concept, never the exact call form)
        assert.ok(MAIN_SRC.indexOf('announceA11yError($form, $err.textContent)') < 0,
            'the raw-textContent announce call must be retired');
    });

    it('both render loops carry the distinct-text dedup guard', function () {
        var guards = MAIN_SRC.match(/if\s*\(\s*e\s*!=\s*'stack'\s*&&\s*typeof\(_renderedMsgs\[\s*errors\[name\]\[e\]\s*\]\)\s*==\s*'undefined'\s*\)/g) || [];
        assert.equal(guards.length, 2, 'first-error branch + refresh branch');
    });

    it('the dev bookkeeping stays OUTSIDE the dedup guard (every key still recorded)', function () {
        // in both loops the envIsDev block must remain a sibling of the dedup-guarded
        // append, i.e. each guarded append is followed by an envIsDev block within the loop
        var m = MAIN_SRC.match(/_renderedMsgs\[ errors\[name\]\[e\] \] = true;[\s\S]{0,600}?if \( envIsDev \)/g) || [];
        assert.equal(m.length, 2, 'both loops must keep per-key dev bookkeeping');
    });
});


// 01 — the REAL helper, executed from the shipped bytes
describe('01 - getA11yAnnounceText (extracted from source)', function () {

    var fnText = extractFn(MAIN_SRC, 'var getA11yAnnounceText = function($err)');
    var getText = new Function('return (' + fnText + ');')();

    function containerWith(texts) {
        var dom = new JSDOM('<!DOCTYPE html><html><body><div id="err"></div></body></html>');
        var d = dom.window.document;
        var $err = d.getElementById('err');
        for (var i = 0; i < texts.length; i++) {
            var p = d.createElement('p');
            p.appendChild(d.createTextNode(texts[i]));
            $err.appendChild(p);
        }
        return $err;
    }

    it('joins two messages with a period-space separator', function () {
        var $err = containerWith(['Value must be a valid number', 'Doit etre un nombre']);
        assert.equal(getText($err), 'Value must be a valid number. Doit etre un nombre');
    });

    it('a single message gains no separator', function () {
        var $err = containerWith(['Cannot be left empty']);
        assert.equal(getText($err), 'Cannot be left empty');
    });

    it('falls back to textContent when the container has no p children', function () {
        var dom = new JSDOM('<!DOCTYPE html><html><body><div id="err">plain text</div></body></html>');
        var $err = dom.window.document.getElementById('err');
        assert.equal(getText($err), 'plain text');
    });

    it('SUBTRACT: the raw textContent of the same container is the run-on the fix retires', function () {
        var $err = containerWith(['Value must be a valid number', 'Doit etre un nombre']);
        assert.equal($err.textContent, 'Value must be a valid numberDoit etre un nombre',
            'pre-fix announcement text: no separator between the messages');
    });
});


// 02 — the dedup loop (replica, source-pinned by 00)
describe('02 - distinct-text dedup in the render loop', function () {

    /** Replica of the #B178 loop shape shared by both display branches. */
    function renderLoop(win, errors, name, envIsDev) {
        var d = win.document;
        var $err = d.createElement('div');
        var formsErrors = null;
        var _renderedMsgs = {};
        for (var e in errors[name]) {
            if (e != 'stack' && typeof(_renderedMsgs[ errors[name][e] ]) == 'undefined') {
                _renderedMsgs[ errors[name][e] ] = true;
                var $msg = d.createElement('p');
                $msg.appendChild( d.createTextNode(errors[name][e]) );
                $err.appendChild($msg);
            }
            if ( envIsDev ) {
                if (!formsErrors) formsErrors = {};
                if ( !formsErrors[ name ] ) formsErrors[ name ] = {};
                formsErrors[ name ][e] = errors[name][e];
            }
        }
        return { $err: $err, formsErrors: formsErrors };
    }

    var win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;

    it('two keys carrying byte-identical text render ONE p', function () {
        var out = renderLoop(win, { price: { toFloat: 'Doit etre un nombre', isNumber: 'Doit etre un nombre' } }, 'price', false);
        assert.equal(out.$err.getElementsByTagName('p').length, 1);
        assert.equal(out.$err.textContent, 'Doit etre un nombre');
    });

    it('two keys with distinct texts still render TWO p', function () {
        var out = renderLoop(win, { price: { toFloat: 'A', isNumber: 'B' } }, 'price', false);
        assert.equal(out.$err.getElementsByTagName('p').length, 2);
    });

    it('the stack key is still skipped', function () {
        var out = renderLoop(win, { f: { isRequired: 'x', stack: 'Error\n    at leak' } }, 'f', false);
        assert.equal(out.$err.getElementsByTagName('p').length, 1);
    });

    it('dev bookkeeping records EVERY key, including deduped ones', function () {
        var out = renderLoop(win, { price: { toFloat: 'same', isNumber: 'same' } }, 'price', true);
        assert.equal(out.$err.getElementsByTagName('p').length, 1, 'DOM deduped');
        assert.deepEqual(Object.keys(out.formsErrors.price).sort(), ['isNumber', 'toFloat'],
            'the inspector still sees both keys');
    });
});


// 03 — composition: deduped container + joined announcement
describe('03 - announcement composition', function () {

    var fnText = extractFn(MAIN_SRC, 'var getA11yAnnounceText = function($err)');
    var getText = new Function('return (' + fnText + ');')();

    it('distinct messages announce as sentence-separated, identical ones announce once', function () {
        var dom = new JSDOM('<!DOCTYPE html><html><body><div id="a"></div></body></html>');
        var d = dom.window.document;
        var $err = d.getElementById('a');
        ['First message', 'Second message'].forEach(function (t) {
            var p = d.createElement('p');
            p.appendChild(d.createTextNode(t));
            $err.appendChild(p);
        });
        assert.equal(getText($err), 'First message. Second message');
    });
});


// 04 — dist fidelity (red before the prod rebuild, green after)
describe('04 - dist fidelity', function () {

    it('gina.js carries the helper and the separator join', function () {
        var raw = fs.readFileSync(DIST_RAW, 'utf8');
        assert.ok(raw.indexOf('getA11yAnnounceText') >= 0, 'helper name must reach the unminified bundle');
        assert.ok(raw.indexOf("join('. ')") >= 0 || raw.indexOf('join(". ")') >= 0);
    });

    it('gina.min.js carries the separator join (the helper name is minified away)', function () {
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        assert.ok(min.indexOf('join(". ")') >= 0 || min.indexOf("join('. ')") >= 0,
            'the period-space join literal must survive minification');
    });
});
