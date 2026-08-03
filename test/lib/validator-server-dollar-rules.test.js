'use strict';
/**
 * #B234 — the server auto path crashed on ANY `$` that survives the first
 * dollar-substitution loop.
 *
 * `getDynamisedRules`' SECOND substitution loop re-derives each field's
 * splice value from the live DOM (`$fields[name].value`) — and `backendInit`
 * passes `$fields = null`, so the bare deref threw
 * `TypeError: Cannot read properties of null` for any rule set whose
 * stringified form still contains a `$` after loop 1: a regex end-anchor
 * (`is: "/^(alpha|beta)$/"`), a `$` inside a human-readable message string,
 * or a reference to a field the collection does not carry. Loop 1 always
 * replaces the tokens of KNOWN fields (measured — which is why plain
 * `$peer === $me` cross-field conditions never crashed), so loop 2 only ever
 * runs on leftovers it structurally cannot match: on the client it is a
 * no-op re-scan, on the server it was a crash.
 *
 * Fix: the loop-2 gate joins the #B127 precedent in the same function —
 * `$fields && /\$(.*)/.test(...)` — so the server simply skips the DOM
 * fallback it has no DOM for, and behaves exactly as the client does when
 * loop 2 no-ops. Verdicts and substitutions are byte-identical on every
 * path that did not crash.
 *
 * SCOPE — what this fix does NOT cover (measured pre-vs-post on the real
 * bytes, patched copies): it closes THIS crash site, not every `$`. A `$`
 * token sitting in an ARRAY rule's FIRST argument and naming no field —
 * `isInList: ['$100','$200']` — KEPT throwing, one site further on, at
 * `checkFieldAgainstRules`' `d[<token>].value` (#B239, not DOM-dependent, so
 * it bit the client too), until its own two-clause guard landed — that site
 * is owned by test/lib/validator-array-rule-dollar.test.js now. The same `$`
 * in a LATER array element (`['100','$200']`) became clean HERE, because only
 * args[0] is scanned downstream — that placement threw pre-#B234 and
 * validates since. Real cross-field references, non-matching values and
 * `$`-free rule sets are byte-identical across the fix.
 *
 * Red-first buckets (pre-fix bytes):
 *   MUST-RED  — §01.2 (the guarded gate is absent), §02.1/§02.2/§02.3
 *               (the crash arms), §03 (dist pins).
 *   MUST-GREEN (premises/controls) — §01.1/§01.3, §02.4/§02.5.
 * At the src-fixed/dist-stale midstate only §03 stays red.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var fs = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes'));
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'dollarrulesbundle');

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var MAIN_SRC = fs.readFileSync(MAIN_PATH, 'utf8');
var DIST_RAW_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var Validator = require(MAIN_PATH);

/** getDynamisedRules slicer — declaration to the following JSDoc block. */
function dynBlock(src) {
    var start = src.indexOf('var getDynamisedRules = function(');
    var end = src.indexOf('     * Validate form', start);
    assert.ok(start > -1 && end > start, 'getDynamisedRules block not found');
    return src.slice(start, end);
}

function drivePlugin(rules, data) {
    var res = Validator(JSON.parse(JSON.stringify(rules)), data, 'dollar-rules-form');
    var errs = {};
    for (var f in res.error || {}) { errs[f] = Object.keys(res.error[f] || {}); }
    return { formValid: res.isValid(), errs: errs, data: res.data };
}

// ---------------------------------------------------------------------------
// §01 — source pins on the loop-2 gate
// ---------------------------------------------------------------------------
describe('validator-server-dollar-rules §01 — source pins', function () {

    it('01.1 - control: the slicer can fail', function () {
        assert.throws(function () { dynBlock('nothing here'); }, /not found/);
        assert.ok(dynBlock(MAIN_SRC).length > 400, 'real block sliced');
    });

    it('01.2 - loop 2 is gated on $fields (the #B127 precedent, one function later)', function () {
        var block = dynBlock(MAIN_SRC);
        assert.ok(block.indexOf('if ( $fields && /\\$(.*)/.test(stringifiedRules) ) {') > -1,
            'the DOM-fallback loop must not run with no DOM');
    });

    it('01.3 - premise: loop 1 and its casting stay byte-identical', function () {
        var block = dynBlock(MAIN_SRC);
        // the first loop's substitution + cast call shape
        assert.ok(block.indexOf('fieldValue = getCastedValue(ruleObj, fields, arrFields[i], true);') > -1);
        // exactly two call sites (one per loop) — a third means this file is stale
        var m = block.match(/getCastedValue\(ruleObj, fields, arrFields\[i\], true\)/g) || [];
        assert.equal(m.length, 2);
    });
});

// ---------------------------------------------------------------------------
// §02 — behaviour: the crash arms and the no-verdict-change controls
// ---------------------------------------------------------------------------
describe('validator-server-dollar-rules §02 — behaviour', function () {

    it('02.1 - THE #B234 RED: a regex end-anchor in `is` no longer throws', function () {
        var r;
        assert.doesNotThrow(function () {
            r = drivePlugin({ myField: { isRequired: true, is: '/^(alpha|beta)$/' } },
                { myField: 'alpha' });
        });
        assert.equal(r.formValid, true, 'the anchored regex condition matches "alpha"');
        assert.deepEqual(r.errs, {});
    });

    it('02.2 - a `$` inside a message string no longer throws', function () {
        var r;
        assert.doesNotThrow(function () {
            r = drivePlugin({ myField: { isRequired: [true, 'cost is 5$ max'] } },
                { myField: 'x' });
        });
        assert.equal(r.formValid, true);
    });

    it('02.3 - the anchored regex still REJECTS a non-matching value (verdicts are live, not skipped)', function () {
        var r = drivePlugin({ myField: { isRequired: true, is: '/^(alpha|beta)$/' } },
            { myField: 'gamma' });
        assert.equal(r.formValid, false);
        assert.deepEqual(r.errs.myField, ['is']);
    });

    it('02.4 - premise: plain cross-field `$` conditions never crashed (loop 1 consumes known tokens)', function () {
        var r = drivePlugin({
            a: { isRequired: true },
            b: { isRequired: true, is: '$b === $a' }
        }, { a: 'same', b: 'same' });
        assert.equal(r.formValid, true);
        var r2 = drivePlugin({
            a: { isRequired: true },
            b: { isRequired: true, is: '$b === $a' }
        }, { a: 'same', b: 'different' });
        assert.equal(r2.formValid, false);
        assert.deepEqual(r2.errs.b, ['is']);
    });

    it('02.5 - premise: $-free rule sets are untouched', function () {
        var r = drivePlugin({ myField: { isRequired: true, isEmail: true } }, { myField: 'a@b.co' });
        assert.equal(r.formValid, true);
        assert.deepEqual(r.errs, {});
    });
});

// ---------------------------------------------------------------------------
// §03 — dist fidelity (red until the prod rebuild)
// ---------------------------------------------------------------------------
describe('validator-server-dollar-rules §03 — dist fidelity', function () {

    it('03.1 - gina.js carries the guarded loop-2 gate', function () {
        var raw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
        assert.ok(raw.indexOf('if ( $fields && /\\$(.*)/.test(stringifiedRules) ) {') > -1,
            'the guard must reach the bundle');
    });

    it('03.2 - gina.min.js: the guarded gate reaches the served artifact', function () {
        var min = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // DERIVED from the REAL Closure emission at the rebuild — `if(c&&/\$(.*)/
        // .test(a))` — and validated 0-pre/1-post against the actual artifacts.
        // Identifier-agnostic (the minifier renames `$fields`/`stringifiedRules`
        // freely) and wrap-agnostic at every token boundary, because Closure
        // line-breaks its output at token positions that shift with unrelated
        // upstream edits — a strict needle would flip this pin on a future
        // rebuild for reasons having nothing to do with this guard.
        var m = min.match(/if\s*\(\s*[A-Za-z_$][\w$]*\s*&&\s*\/\\\$\(\.\*\)\/\s*\.\s*test\(\s*[A-Za-z_$][\w$]*\s*\)\s*\)/g) || [];
        assert.equal(m.length, 1,
            'gina.min.js must carry the guarded loop-2 gate — exactly one, since ' +
            '`validate`\'s own same-text gate legitimately stays UNGUARDED (it is ' +
            'reached only with a live DOM, and guarding it would change client behaviour)');
    });
});
