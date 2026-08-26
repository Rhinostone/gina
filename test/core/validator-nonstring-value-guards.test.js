/**
 * validator-nonstring-value-guards — #B200: a non-string field value must not
 * kill the whole validation run.
 *
 * Three rules called a string method on `this.value` without checking the type:
 *
 *   - isEmail / isJsonWebToken opened with a TRUTHY-only guard
 *     `(this.value) ? this.value.toLowerCase() : this.value`, so a truthy
 *     non-string (a JSON body's 123 / true / [], or a checkbox boolean on the
 *     client — the shape #B87 already fixed for the `query` rule) reached
 *     .toLowerCase() and threw. Falsy non-strings skipped the coercion, which
 *     is why #B199 met them on the other branch instead.
 *   - trim had the correct type guard written but COMMENTED OUT, and no truthy
 *     guard either — so it was the widest of the three: EVERY non-string threw,
 *     a falsy 0 included.
 *
 * In all three the rule driver's catch RE-THROWS as
 * `[ ginaFormValidator ] could not evaluate ...`, so one bad field aborts the
 * entire pass: server-side the request goes unvalidated, client-side the
 * boot-time binding loop dies and later forms silently lose validation and
 * CSRF injection.
 *
 * The fix aligns each site with a precedent already in this file — the #B87
 * `query` coercion for the two rules, and isFloat's identical guarded
 * .replace() for trim. Deliberately NOT changed here: isDate (its throw is a
 * purpose-built catch — a design call, #B397). toFloat/format were also left
 * out of this pass and have since been fixed by #B398 (context-safe rules —
 * see validator-context-safe-rules.test.js).
 *
 * Shape: (a) source pins, comment-stripped — the fix's OWN comments name the
 * pre-fix forms, so an un-stripped scan false-positives (the recurring
 * own-comment trap); (b) behavioural runs of the REAL plugin over the server
 * auto path (#B85 idiom) asserting the VERDICT, not merely the absence of a
 * throw — a guard that made a non-string silently VALID would be a #B199-class
 * regression, so each arm pins isValid === false plus the rule-keyed error;
 * (c) untouched-rule controls proving the edit was targeted.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes'));
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'nonstringguardbundle');

var FV_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var FV_RAW  = fs.readFileSync(FV_PATH, 'utf8');
var Validator = require(path.join(FW, 'core/plugins/lib/validator/src/main.js'));

/** @returns {string} source with comment-only lines removed */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}
var FV_SRC = stripComments(FV_RAW);

function countOf(haystack, needle) {
    var n = 0, i = haystack.indexOf(needle);
    while (i > -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
    return n;
}

// parseRules mutates its input — hand each run a fresh copy
function run(rules, data) {
    return Validator(JSON.parse(JSON.stringify(rules)), data, 'nonstring-form');
}
/** @returns {object} { threw, isValid, errorKeys } for one rule/value pair */
function outcome(rule, arg, value) {
    var r = {}; r[rule] = arg;
    try {
        var out = run({ f: r }, { f: value });
        return {
            threw: false,
            isValid: (out && typeof out.isValid === 'function') ? out.isValid() : null,
            errorKeys: (out && out.error && out.error.f) ? Object.keys(out.error.f) : []
        };
    } catch (e) { return { threw: true, message: String(e.message) }; }
}

var NON_STRINGS = [['number 123', 123], ['boolean true', true], ['array []', []], ['number 0', 0]];


describe('01 - source pins (comment-stripped: the fix\'s own comments name the pre-fix forms)', function () {

    it('the bare truthy-only coercion is gone file-wide', function () {
        assert.equal(countOf(FV_SRC, '(this.value) ? this.value.toLowerCase()'), 0);
    });

    it('isEmail + isJsonWebToken now carry the type-guarded coercion (2 sites)', function () {
        assert.equal(countOf(FV_SRC, "(this.value && typeof(this.value) == 'string')"), 2);
    });

    it('INVARIANT (not red-first): the #B87 `query` precedent this fix mirrors is still in place', function () {
        // Deliberately labelled: this assertion holds on the PRE-fix source too,
        // so it is a control on the pattern's continued existence, not a
        // regression pin for this fix. Treating it as red-first would be a
        // control that cannot fail.
        assert.equal(countOf(FV_SRC, "(_this.value && typeof(_this.value) == 'string')"), 1);
    });

    it('trim\'s type guard is LIVE code, not commented out', function () {
        // 2 live guards of this exact shape: isFloat's (pre-existing) and trim's (restored)
        assert.equal(countOf(FV_SRC, "if ( typeof(this.value) == 'string' ) {"), 2);
        assert.equal(countOf(FV_RAW, "//if ( typeof(this.value) == 'string' ) {"), 0,
            'the commented-out guard must not survive anywhere, comments included');
    });

    it('the #B245 global flag survives the guard restoration', function () {
        assert.match(FV_SRC, /this\.value\.replace\(\/\^\\s\+\|\\s\+\$\/g, ''\)/);
    });
});


describe('02 - isEmail: a non-string is INVALID, never a crash and never a silent pass', function () {
    NON_STRINGS.forEach(function (p) {
        it(p[0] + ' -> recorded invalid', function () {
            var o = outcome('isEmail', true, p[1]);
            assert.equal(o.threw, false, 'must not throw: ' + (o.message || ''));
            assert.equal(o.isValid, false, 'a non-string must NOT be silently valid (#B199 class)');
            assert.ok(o.errorKeys.indexOf('isEmail') > -1, 'the error must be keyed to the rule');
        });
    });

    it('control: a valid address still passes', function () {
        var o = outcome('isEmail', true, 'a@b.co');
        assert.equal(o.threw, false);
        assert.equal(o.isValid, true);
    });

    it('control: an invalid string still fails (the arm that can fail)', function () {
        var o = outcome('isEmail', true, 'nope');
        assert.equal(o.isValid, false);
        assert.ok(o.errorKeys.indexOf('isEmail') > -1);
    });
});


describe('03 - isJsonWebToken: same contract', function () {
    NON_STRINGS.forEach(function (p) {
        it(p[0] + ' -> recorded invalid', function () {
            var o = outcome('isJsonWebToken', true, p[1]);
            assert.equal(o.threw, false, 'must not throw: ' + (o.message || ''));
            assert.equal(o.isValid, false);
            assert.ok(o.errorKeys.indexOf('isJsonWebToken') > -1);
        });
    });

    it('control: a well-formed token still passes', function () {
        var o = outcome('isJsonWebToken', true, 'a.b.c');
        assert.equal(o.threw, false);
        assert.equal(o.isValid, true);
    });
});


describe('04 - trim: a transform, so a non-string passes through UNTOUCHED', function () {
    NON_STRINGS.forEach(function (p) {
        it(p[0] + ' -> no throw, value unchanged', function () {
            var o = outcome('trim', true, p[1]);
            assert.equal(o.threw, false, 'must not throw: ' + (o.message || ''));
        });
    });

    it('a non-string is left untransformed in data', function () {
        var out = run({ f: { trim: true } }, { f: 123 });
        assert.equal(out.data.f, 123);
    });

    it('control: the #B245 both-ends strip still works on a real string', function () {
        var out = run({ f: { trim: true } }, { f: '  x  ' });
        assert.equal(out.data.f, 'x');
    });

    it('control: falsy 0 no longer throws (trim was the only rule that crashed on it)', function () {
        assert.equal(outcome('trim', true, 0).threw, false);
    });
});


describe('05 - untouched rules: the edit was targeted (controls that CAN fail)', function () {

    it('isFloat, whose guard predates this fix, still tolerates non-strings', function () {
        assert.equal(outcome('isFloat', true, 123).threw, false);
        assert.equal(outcome('isFloat', true, true).threw, false);
    });

    it('isDate still throws on a non-string — deliberately NOT fixed here (#B397)', function () {
        // Its throw is a purpose-built catch, so its semantics are a design call.
        // If this arm ever goes green, #B397 was resolved and this pin must move.
        assert.equal(outcome('isDate', true, 123).threw, true);
    });

    it('isDate still tolerates [] and valid strings (the pre-existing early return)', function () {
        assert.equal(outcome('isDate', true, []).threw, false);
        assert.equal(outcome('isDate', true, '2020-01-02').threw, false);
    });
});


describe('06 - dist fidelity: the guard reached the served browser bundle', function () {
    var MINJS = fs.readFileSync(
        path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js'), 'utf8');

    // Wrap-agnostic (\s*) at every token boundary: Closure's line-wrap position is
    // content-dependent, so a strict needle can silently miscount after an
    // unrelated rebuild moves the wrap.
    var GUARDED = /typeof\s*this\.value\s*==\s*'string'\s*\?\s*this\.value\.toLowerCase\(\)/g;
    var BARE    = /this\.value\s*\?\s*this\.value\.toLowerCase\(\)/g;

    it('both guarded coercions ship minified (isEmail + isJsonWebToken)', function () {
        assert.equal((MINJS.match(GUARDED) || []).length, 2);
    });

    it('the bare truthy-only coercion is gone from the bundle', function () {
        // Measured on the pre-fix artifact: this read 2. Counted with match(),
        // never grep -c — the artifact is near-single-line.
        assert.equal((MINJS.match(BARE) || []).length, 0);
    });

    it('CONTROL: the untouched #B87 `query` coercion still ships', function () {
        // Minified to a different local (not `this`), so it is unaffected by the
        // two needles above — an independent proof the bundle is the real one.
        assert.match(MINJS, /\.value\s*&&\s*typeof\s+\w+\.value\s*==\s*'string'/);
    });
});
