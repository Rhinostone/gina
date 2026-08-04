/**
 * #B226 — lib/merge drops `null` elements from arrays on every NO-OVERRIDE merge,
 * which strips the documented `"setFlash": [null, "message"]` rule form on the
 * client-side rules path (the whispered rules survive serialization byte-exact,
 * then lose the first element at the first no-override merge hop — e.g. the
 * validator's `gina.hasValidator` instance re-merge and the `data-gina-form-rule`
 * bind merge), so the engine's positional spread binds `regex = "message"`,
 * `flash = undefined`, and the custom message silently falls back to the
 * built-in label. `""` / `false` / `0` elements survive the same path — the
 * consumer-observed asymmetry — because the strip is the classic
 * `typeof null == 'object'` trap: mergeArray's rebuild and primitive-push guards
 * classified `null` as an object and refused to carry it, and its index-merge
 * branch turned a null source element into `{}`.
 *
 * Red-first expectation on PRE-fix bytes:
 *   - section 01 (defect arms), section 03 arms B/C, section 04 arm D, and the
 *     section 05 source pins + section 06 dist pins FAIL;
 *   - section 02 (byte-identical no-regression arms), the section 03 whisper
 *     round-trip (arm A — eliminates the serialization suspect), and the
 *     section 04 mechanism arms PASS.
 * After the lib/merge fix: everything green except section 06 until the prod
 * dist rebuild (the dist pins' red at the src-fixed/dist-stale mid-state is the
 * free subtract proving they watch the built artifact).
 */

var path = require('path');
var fs = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');
var merge = require(path.join(FW, 'lib/merge/src/main'));
// merge self-installs JSON.clone when absent; helpers install the whisper
// encoder global (`encodeRFC5987ValueChars`) exactly as gna.js does at boot
require(path.join(FW, 'helpers'));
if (typeof setContext != 'undefined') {
    setContext('gina', { forms: null });
}
var FormValidatorUtil = require(path.join(FW, 'core/plugins/lib/validator/src/form-validator'));

var MERGE_SRC_PATH = path.join(FW, 'lib/merge/src/main.js');
var MERGE_SRC = fs.readFileSync(MERGE_SRC_PATH, 'utf8');
// active code only — the replace-code convention keeps retired lines as
// full-line comments, which must not satisfy or trip the pins below
var MERGE_ACTIVE = MERGE_SRC.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');

var DIST_JS_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

// the exact form the public reference documents for setFlash
var DOC_MSG = 'Please enter a work email';


describe('00 - premise controls', function () {

    it('00.1 - merge loads and is a function', function () {
        assert.equal(typeof merge, 'function');
    });

    it('00.2 - JSON.clone is installed and preserves null array elements (eliminated suspect)', function () {
        assert.equal(typeof JSON.clone, 'function');
        var cloned = JSON.clone({ setFlash: [null, 'msg'] });
        assert.deepEqual(cloned.setFlash, [null, 'msg']);
    });

    it('00.3 - the whisper encoder global is installed by helpers', function () {
        assert.equal(typeof encodeRFC5987ValueChars, 'function');
    });

    it('00.4 - the engine constructor loads', function () {
        assert.equal(typeof FormValidatorUtil, 'function');
    });
});


describe('01 - the defect: no-override merges drop null array elements', function () {

    it('01.1 - filling a missing key from a source array keeps the null element', function () {
        var out = merge({}, { setFlash: [null, DOC_MSG] });
        assert.deepEqual(out.setFlash, [null, DOC_MSG],
            'a null element must survive a fill-from-source merge');
    });

    it('01.2 - both sides carrying the identical rule array keeps the null element (the validator hop shape)', function () {
        var out = merge(
            { email: { setFlash: [null, DOC_MSG] } },
            { email: { setFlash: [null, DOC_MSG] } }
        );
        assert.deepEqual(out.email.setFlash, [null, DOC_MSG],
            'merging two identical rule sets must not strip the null argument slot');
    });

    it('01.3 - top-level array merge keeps the null element', function () {
        var out = merge([null, DOC_MSG], [null, DOC_MSG]);
        assert.deepEqual(out, [null, DOC_MSG]);
    });

    it('01.4 - a null source element at an unfilled index stays null (was manufactured into `{}`)', function () {
        var out = merge({ list: ['x'] }, { list: ['x', null] });
        assert.deepEqual(out.list, ['x', null],
            'the index-merge branch must not turn a null source element into an empty object');
    });

    it('01.5 - filling from a source array that leads with null appends the null too', function () {
        var out = merge({ list: ['x'] }, { list: [null, 'msg'] });
        assert.deepEqual(out.list, ['x', null, 'msg'],
            'null is a value: it fills like any other primitive the target lacks');
    });
});


describe('02 - byte-identical behavior for every other shape (no-regression arms)', function () {

    it('02.1 - the empty-string form is untouched (fill)', function () {
        var out = merge({}, { setFlash: ['', DOC_MSG] });
        assert.deepEqual(out.setFlash, ['', DOC_MSG]);
    });

    it('02.2 - the empty-string form is untouched (both sides)', function () {
        var out = merge(
            { email: { setFlash: ['', DOC_MSG] } },
            { email: { setFlash: ['', DOC_MSG] } }
        );
        assert.deepEqual(out.email.setFlash, ['', DOC_MSG]);
    });

    it('02.3 - false and 0 elements are untouched', function () {
        assert.deepEqual(merge({ a: [false, 'm'] }, { a: [false, 'm'] }).a, [false, 'm']);
        assert.deepEqual(merge({ a: [0, 'm'] }, { a: [0, 'm'] }).a, [0, 'm']);
    });

    it('02.4 - string union/dedupe behavior is unchanged', function () {
        assert.deepEqual(merge({ a: ['a', 'b'] }, { a: ['b', 'c'] }).a, ['a', 'b', 'c']);
    });

    it('02.5 - the number duplicate tolerance is unchanged', function () {
        // the in-code fixture: a = [25]; b = [25,25]; result must be [25,25]
        assert.deepEqual(merge({ a: [25] }, { a: [25, 25] }).a, [25, 25]);
    });

    it('02.6 - collection merges (keyComparison) are unchanged, both modes', function () {
        assert.deepEqual(
            merge({ c: [{ id: 1, v: 0 }] }, { c: [{ id: 1, v: 9 }] }).c,
            [{ id: 1, v: 0 }], 'no-override: target collection entry wins');
        assert.deepEqual(
            merge({ c: [{ id: 1, v: 0 }] }, { c: [{ id: 1, v: 9 }] }, true).c,
            [{ id: 1, v: 9 }], 'override: source collection entry wins');
    });

    it('02.7 - the override path already preserved null and still does', function () {
        var out = merge(
            { email: { setFlash: [null, DOC_MSG] } },
            { email: { setFlash: [null, DOC_MSG] } },
            true
        );
        assert.deepEqual(out.email.setFlash, [null, DOC_MSG]);
    });

    it('02.8 - a null-bearing target array with an empty source object is untouched', function () {
        assert.deepEqual(merge({ a: [null, 'm'] }, {}).a, [null, 'm']);
    });

    it('02.9 - a single-null array both sides stays a single null', function () {
        assert.deepEqual(merge({ a: [null] }, { a: [null] }).a, [null]);
    });
});


describe('03 - the rules pipeline: whisper eliminated, merge hops convicted', function () {

    // controller.js whispers `page.environment.forms` as
    // encodeRFC5987ValueChars(JSON.stringify(forms)); the loader parses it back
    // with JSON.parse(decodeURIComponent(...)). Driving the REAL encoder proves
    // the serialization itself is lossless for null — the strip is downstream.
    it('03.A - the whisper serialization round-trips null byte-exact (suspect eliminated)', function () {
        var forms = { rules: { myform: { email: { setFlash: [null, DOC_MSG], isRequired: true } } } };
        var whispered = encodeRFC5987ValueChars(JSON.stringify(forms));
        var parsed = JSON.parse(decodeURIComponent(whispered));
        assert.deepEqual(parsed.rules.myform.email.setFlash, [null, DOC_MSG]);
    });

    // the `gina.hasValidator` re-construction hop: a consumer constructing the
    // validator after auto-boot runs `instance = merge(instance, gina.validator)`
    // with NO override — the whole rules tree traverses mergeArray
    it('03.B - the instance re-merge hop preserves the rule arrays', function () {
        var ginaValidatorLike = {
            rules: { myform: { email: { setFlash: [null, DOC_MSG], isRequired: true } } },
            $forms: { myform: { rules: { email: { setFlash: [null, DOC_MSG], isRequired: true } } } }
        };
        var out = merge({ rules: {}, $forms: {} }, ginaValidatorLike);
        assert.deepEqual(out.rules.myform.email.setFlash, [null, DOC_MSG],
            'instance.rules lost the null argument slot on the re-merge hop');
        assert.deepEqual(out.$forms.myform.rules.email.setFlash, [null, DOC_MSG],
            'the per-form rule record lost the null argument slot on the re-merge hop');
    });

    // the `data-gina-form-rule` bind hop: merge(JSON.clone(resolvedRule), instanceRule)
    // with NO override, both sides carrying the same whispered rule
    it('03.C - the custom-rule bind hop preserves the rule arrays', function () {
        var rule = { email: { setFlash: [null, DOC_MSG], isRequired: true } };
        var out = merge(JSON.clone(rule), rule);
        assert.deepEqual(out.email.setFlash, [null, DOC_MSG],
            'the bind-time rule merge lost the null argument slot');
    });
});


describe('04 - engine adjudication: what the array shape means for the message', function () {

    // replicates the dispatcher's array spread (checkFieldAgainstRules:
    // args = JSON.clone(rules[field][rule]); d[field][rule].apply(d[field], args))
    var applyRuleSet = function (ruleSet) {
        var d = new FormValidatorUtil({ email: '' });
        if (Array.isArray(ruleSet.setFlash)) {
            d['email']['setFlash'].apply(d['email'], JSON.clone(ruleSet.setFlash));
        }
        d['email'].isRequired(true);
        return d['email'].errors && d['email'].errors.isRequired;
    };

    it('04.1 - the intact documented form carries the custom message (mechanism, green both sides)', function () {
        assert.equal(applyRuleSet({ setFlash: [null, DOC_MSG] }), DOC_MSG);
    });

    it('04.2 - a one-element array loses the custom message (mechanism, green both sides)', function () {
        // spread positionally, a stripped array binds regex="msg", flash=undefined,
        // and the engine keeps its built-in label (not asserted literally — labels
        // are displaceable by culture overlays; the loss of DOC_MSG is the defect)
        var msg = applyRuleSet({ setFlash: [DOC_MSG] });
        assert.ok(msg, 'isRequired must have recorded an error');
        assert.notEqual(msg, DOC_MSG);
    });

    it('04.D - end-to-end: a merged-then-adjudicated documented rule renders the custom message', function () {
        var rule = { email: { setFlash: [null, DOC_MSG], isRequired: true } };
        var merged = merge(JSON.clone(rule), rule);
        assert.equal(applyRuleSet(merged.email), DOC_MSG,
            'the documented "setFlash": [null, "..."] form must survive the merge hop and reach the engine');
    });
});


describe('05 - source pins: the three null-tolerant guards in mergeArray', function () {

    it('05.1 - the rebuild guard admits null (unique-literal pin, whole expression)', function () {
        assert.match(MERGE_ACTIVE,
            /\(\s*typeof\(target\[a\]\)\s*!=\s*'object'\s*\|\|\s*target\[a\]\s*===\s*null\s*\)\s*&&\s*newTarget\.indexOf\(target\[a\]\)\s*==\s*-1/,
            'mergeArray rebuild guard must carry the null exception');
    });

    it('05.2 - the index-merge branch excludes null (whole 3-conjunct condition)', function () {
        assert.match(MERGE_ACTIVE,
            /typeof\(newTarget\[a\]\)\s*==\s*'undefined'\s*&&\s*typeof\(options\[a\]\)\s*==\s*'object'\s*&&\s*options\[a\]\s*!=\s*null/,
            'the index-merge branch must skip null source elements');
    });

    it('05.3 - the primitive push admits null (whole expression)', function () {
        assert.match(MERGE_ACTIVE,
            /newTarget\.indexOf\(options\[a\]\)\s*==\s*-1\s*&&\s*\(\s*typeof\(options\[a\]\)\s*!=\s*'object'\s*\|\|\s*options\[a\]\s*===\s*null\s*\)/,
            'the primitive-push guard must carry the null exception');
    });

    it('05.4 - the retired unguarded shapes are gone from active code', function () {
        // each old guard, whole-expression form; the replace-code comments are
        // stripped so a retired line kept as a comment cannot satisfy or trip this
        assert.doesNotMatch(MERGE_ACTIVE,
            /if\s*\(\s*typeof\(target\[a\]\)\s*!=\s*'object'\s*&&\s*newTarget\.indexOf\(target\[a\]\)\s*==\s*-1\s*\)/,
            'old rebuild guard must be retired');
        assert.doesNotMatch(MERGE_ACTIVE,
            /typeof\(newTarget\[a\]\)\s*==\s*'undefined'\s*&&\s*typeof\(options\[a\]\)\s*==\s*'object'\s*\)/,
            'old index-merge condition must be retired');
        assert.doesNotMatch(MERGE_ACTIVE,
            /newTarget\.indexOf\(options\[a\]\)\s*==\s*-1\s*&&\s*typeof\(options\[a\]\)\s*!=\s*'object'\s*\)/,
            'old primitive-push guard must be retired');
    });

    it('05.5 - uniqueness control: each new guard appears exactly once', function () {
        var strictNull = MERGE_ACTIVE.match(/===\s*null/g) || [];
        assert.equal(strictNull.length, 2,
            'exactly the two strict null exceptions (rebuild + primitive push) — got ' + strictNull.length);
        // count the FULL 3-conjunct condition — the bare `options[a] != null`
        // token is shared with the pre-existing ownPropertyNames guard and
        // would miscount (a shared token is not a countable anchor)
        var idxMerge = MERGE_ACTIVE.match(/typeof\(newTarget\[a\]\)\s*==\s*'undefined'\s*&&\s*typeof\(options\[a\]\)\s*==\s*'object'\s*&&\s*options\[a\]\s*!=\s*null/g) || [];
        assert.equal(idxMerge.length, 1,
            'exactly one index-merge null exclusion — got ' + idxMerge.length);
    });
});


describe('06 - dist fidelity: the browser bundle carries the fixed merge', function () {

    it('06.1 - the unminified bundle carries all three guards', function () {
        var distSrc = fs.readFileSync(DIST_JS_PATH, 'utf8');
        assert.match(distSrc,
            /typeof\(target\[a\]\)\s*!=\s*'object'\s*\|\|\s*target\[a\]\s*===\s*null/,
            'gina.js must carry the rebuild-guard null exception');
        assert.match(distSrc,
            /typeof\(options\[a\]\)\s*==\s*'object'\s*&&\s*options\[a\]\s*!=\s*null/,
            'gina.js must carry the index-merge null exclusion');
        assert.match(distSrc,
            /typeof\(options\[a\]\)\s*!=\s*'object'\s*\|\|\s*options\[a\]\s*===\s*null/,
            'gina.js must carry the primitive-push null exception');
    });

    it('06.2 - the minified bundle carries the null-tolerant guard shapes', function () {
        var minSrc = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // Closure SIMPLE De-Morgans the two if-and-push guards into their
        // INVERTED forms — the shipped tokens are
        //   `typeof x[y]=='object'&&x[y]!==null||...`
        // (measured on the rebuilt artifact; a draft pinning the source's
        // `!= 'object' || === null` order read 0 on a bundle carrying the fix).
        // Identifiers rename per build — anchor on the shapes only, wrap- and
        // quote-agnostic.
        var strictPair = minSrc.match(/typeof\s+[\w$]+\[[\w$]+\]\s*==\s*['"]object['"]\s*&&\s*[\w$]+\[[\w$]+\]\s*!==\s*null/g) || [];
        assert.equal(strictPair.length, 2,
            'gina.min.js must carry the two inverted strict-null guards (rebuild + primitive push) — got ' + strictPair.length);
        // guard 2 keeps source order; its bare 2-conjunct tail also matches the
        // pre-existing collection guards, so count the full 3-conjunct form
        var idxMerge = minSrc.match(/typeof\s+[\w$]+\[[\w$]+\]\s*==\s*['"]undefined['"]\s*&&\s*typeof\s+[\w$]+\[[\w$]+\]\s*==\s*['"]object['"]\s*&&\s*[\w$]+\[[\w$]+\]\s*!=(?!=)\s*null/g) || [];
        assert.equal(idxMerge.length, 1,
            'gina.min.js must carry the 3-conjunct index-merge null exclusion — got ' + idxMerge.length);
    });
});
