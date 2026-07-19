/**
 * validator-injected-form-rule — attribute-first rule resolution in
 * validateFormById (#B128).
 *
 * An INJECTED form (the popin bind path calls `validateFormById(id)` with no
 * customRule) carrying `data-gina-form-rule` used to bind with ZERO resolved
 * rules: the no-customRule branch derived the lookup name from the FORM ID and
 * read the attribute only inside a `typeof(rules) == 'undefined'` branch —
 * unreachable on a rules-bearing page (and its inner `rules` recheck was false
 * by construction, so that branch could only ever throw). The id-derived name
 * missed, `getRuleObjByName` returned `{}`, `bindForm` re-resolved by id,
 * `$form.rules` bound `{}`, and the live-check gate stamped the form
 * `data-gina-form-live-check-enabled="false"` — while the submit handler
 * independently re-read the attribute against the SAME store and succeeded.
 * Live-check + submit-trigger gating were silently dead; enforcement remained
 * at submit only.
 *
 * Fix: attribute-first in the no-customRule branch — a target carrying
 * `data-gina-form-rule` resolves by the attribute's dotted name (the
 * `:3056`/`:6819` normalization); attribute-less forms keep the id-derived
 * name (back-compat for forms whose id names the rule).
 *
 * A jsdom boot of the REAL client instance is not feasible in node:test (the
 * validator boot wiring needs a rendered gina bundle — the auto-boot test
 * documents the same limit), so per the established idiom the behavioural
 * assertions here EXECUTE THE EXTRACTED REAL BYTES of the two load-bearing
 * blocks (control-gated extractions): the resolution block and bindForm's
 * live-check gate. The full integration truth (injected form -> live-check
 * alive) lives in the real-browser smoke recorded in the ledger entry.
 *
 * Shape: (a) source pins — attribute-read-before-id-derive ordering inside the
 * no-customRule branch (structural slice, comment-stripped) + the dead
 * attribute-branch throw gone; (b) extracted-source execution of the shipped
 * resolution block (jsdom targets, recording resolver stub): injected /
 * back-compat / customRule / slash-normalization; (c) extracted-source
 * execution of bindForm's live-check gate proving the stamped-false mechanism;
 * (d) a pre-fix replica subtract reproducing the consumer's exact symptom
 * chain (id-derived miss -> {} rules -> gate stamps "false").
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var { JSDOM } = require('jsdom');

var FW = require('../fw');
require(path.join(FW, '../../utils/prototypes')); // Object.prototype.count() — the live-check gate needs it

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var MAIN_SRC  = fs.readFileSync(MAIN_PATH, 'utf8');

function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// ---------------------------------------------------------------------------
// Control-gated extractions of the REAL shipped bytes
// ---------------------------------------------------------------------------

// (1) validateFormById's rule-resolution block: `var rule = null;` up to the
// popin-context statement that follows the if/else.
var RESOLUTION_START = 'var rule    = null;';
var RESOLUTION_END   = 'if ( $target && typeof(this.isPopinContext)';
var resolutionSrc = (function () {
    var s = MAIN_SRC.indexOf(RESOLUTION_START);
    var e = MAIN_SRC.indexOf(RESOLUTION_END);
    return (s > -1 && e > s) ? MAIN_SRC.substring(s, e) : null;
})();

// (2) bindForm's live-check gate: the block that stamps
// data-gina-form-live-check-enabled from $form.rules.count().
var GATE_START = '// Live check by default - data-gina-form-live-check-enabled';
var GATE_END   = '// form fields collection';
var gateSrc = (function () {
    var s = MAIN_SRC.indexOf(GATE_START);
    var e = MAIN_SRC.indexOf(GATE_END);
    return (s > -1 && e > s) ? MAIN_SRC.substring(s, e) : null;
})();

function runResolution(opts) {
    // Executes the REAL extracted block. Records what getRuleObjByName was
    // asked for; resolves through opts.rulesStore (dotted-key map).
    var calls = [];
    var getRuleObjByName = function (name) {
        calls.push(name);
        return ( typeof(opts.rulesStore[name]) != 'undefined' ) ? opts.rulesStore[name] : {};
    };
    var fn = new Function('customRule', '$form', '_id', 'rules', 'getRuleObjByName',
        resolutionSrc + '\nreturn { rule: rule, $form: $form };');
    var out = fn(opts.customRule, opts.$form, opts._id, opts.rules, getRuleObjByName);
    out.calls = calls;
    return out;
}

function makeTarget(html) {
    var dom = new JSDOM('<!DOCTYPE html><html><body>' + html + '</body></html>');
    return dom.window.document.querySelector('form');
}

describe('validator-injected-form-rule §01 — source pins (no-customRule branch)', function () {

    // Slice of the no-customRule branch: from the resolution head to the else arm.
    var s = MAIN_SRC.indexOf(RESOLUTION_START);
    var e = MAIN_SRC.indexOf(RESOLUTION_END);

    it('01.1 - extraction anchors resolve exactly (control: the slice can fail)', function () {
        assert.ok(s > -1, 'resolution start anchor not found');
        assert.ok(e > s, 'resolution end anchor not found after the start');
        assert.ok(resolutionSrc && resolutionSrc.indexOf('getRuleObjByName') > -1,
            'extracted resolution block looks wrong');
        assert.ok(gateSrc && gateSrc.indexOf('ginaFormLiveCheckEnabled') > -1,
            'extracted live-check gate block looks wrong');
    });

    it('01.2 - attribute read comes BEFORE the id-derived fallback (ordering, comment-stripped)', function () {
        var block = stripComments(MAIN_SRC.substring(s, e));
        var attrIdx = block.indexOf("$form.target.getAttribute('data-gina-form-rule')");
        var idIdx   = block.indexOf("rule = _id.replace(/\\-/g, '.');");
        assert.ok(attrIdx > -1, 'attribute read not found in the resolution block');
        assert.ok(idIdx > -1, 'id-derived fallback not found in the resolution block');
        assert.ok(attrIdx < idIdx,
            'the data-gina-form-rule attribute must be consulted BEFORE the id-derived name (it was only reachable when `rules` was undefined)');
    });

    it('01.3 - the dead attribute-branch throw is gone (it could only ever fire)', function () {
        var block = stripComments(MAIN_SRC.substring(s, e));
        assert.ok(
            block.indexOf('using `data-gina-form-rule` on form') < 0,
            'the unreachable-else-if throw must not survive the restructure'
        );
    });

    it('01.4 - the resolver call still flows through getRuleObjByName + customRule reassignment', function () {
        var block = stripComments(MAIN_SRC.substring(s, e));
        assert.ok(
            block.indexOf("$form['rule'] = customRule = getRuleObjByName(rule)") > -1,
            'the resolved rule object must still land on $form.rule (and reassign customRule)'
        );
    });
});

describe('validator-injected-form-rule §02 — extracted REAL bytes: resolution decisions', function () {

    it('02.1 - injected form with data-gina-form-rule (id != rule name) resolves by the ATTRIBUTE', function () {
        var $target = makeTarget('<form id="form-a1b2c3-injected" data-gina-form-rule="parent-child"><input name="child" type="text"></form>');
        var out = runResolution({
            customRule : undefined,
            $form      : { target: $target },
            _id        : 'form-a1b2c3-injected',
            rules      : {},   // rules-bearing page: defined store (content irrelevant to the branch test)
            rulesStore : { 'parent.child': { child: { isRequired: true } } }
        });
        assert.deepEqual(out.calls, ['parent.child'],
            'the resolver must be asked for the attribute-dotted name, not the id-derived one');
        assert.equal(out.rule, 'parent.child');
        assert.ok(out.$form.rule && out.$form.rule.child,
            'the resolved (non-empty) rule object must land on $form.rule');
    });

    it('02.2 - back-compat: attribute-less form whose id names the rule still resolves by id', function () {
        var $target = makeTarget('<form id="parent-child"><input name="child" type="text"></form>');
        var out = runResolution({
            customRule : undefined,
            $form      : { target: $target },
            _id        : 'parent-child',
            rules      : {},
            rulesStore : { 'parent.child': { child: { isRequired: true } } }
        });
        assert.deepEqual(out.calls, ['parent.child'], 'id-derived dotted name must still be the fallback');
        assert.equal(out.rule, 'parent.child');
        assert.ok(out.$form.rule && out.$form.rule.child);
    });

    it('02.3 - explicit customRule still takes the else branch untouched', function () {
        var $target = makeTarget('<form id="whatever" data-gina-form-rule="parent-child"><input name="child"></form>');
        var out = runResolution({
            customRule : 'other/rule-name',
            $form      : { target: $target },
            _id        : 'whatever',
            rules      : {},
            rulesStore : { 'other.rule.name': { ok: true } }
        });
        assert.deepEqual(out.calls, ['other.rule.name'],
            'an explicit customRule must win over the attribute (unchanged behavior)');
    });

    it('02.4 - attribute normalization: slashes and hyphens both dot (the :3056/:6819 idiom)', function () {
        var $target = makeTarget('<form id="x" data-gina-form-rule="parent/child-grand"><input name="g"></form>');
        var out = runResolution({
            customRule : undefined,
            $form      : { target: $target },
            _id        : 'x',
            rules      : {},
            rulesStore : { 'parent.child.grand': { g: { isRequired: true } } }
        });
        assert.deepEqual(out.calls, ['parent.child.grand']);
    });

    it('02.5 - no target (id not in the DOM) falls back to the id-derived name without crashing', function () {
        var out = runResolution({
            customRule : undefined,
            $form      : { target: null },
            _id        : 'some-form',
            rules      : {},
            rulesStore : {}
        });
        assert.deepEqual(out.calls, ['some.form'], 'null target must not crash the attribute probe');
    });
});

describe('validator-injected-form-rule §03 — extracted REAL bytes: the live-check gate mechanism', function () {

    function runGate(rulesObj, presetDataset) {
        var $form = { target: { dataset: presetDataset || {} }, rules: rulesObj };
        var fn = new Function('$form', gateSrc + '\nreturn $form.target.dataset.ginaFormLiveCheckEnabled;');
        return fn($form);
    }

    it('03.1 - resolved rules (count > 0) -> live-check enabled', function () {
        assert.equal(runGate({ child: { isRequired: true } }), true);
    });

    it('03.2 - empty rules -> the gate stamps false (the consumer-measured symptom mechanism)', function () {
        assert.equal(runGate({}), false);
    });

    it('03.3 - an explicit author opt-out attribute is respected either way', function () {
        assert.equal(runGate({ child: { isRequired: true } }, { ginaFormLiveCheckEnabled: 'false' }), false);
    });
});

describe('validator-injected-form-rule §04 — pre-fix replica + composed SUBTRACT', function () {

    // Byte-faithful replica of the PRE-fix no-customRule branch (id-derive first;
    // the attribute only behind `typeof(rules) == 'undefined'`, whose inner
    // recheck could only throw).
    function preFixResolution(customRule, $form, _id, rules, getRuleObjByName) {
        var rule = null;
        if ( typeof(customRule) == 'undefined') {
            rule = _id.replace(/\-/g, '.');
            if ( typeof(rules) != 'undefined' ) {
                $form['rule'] = customRule = getRuleObjByName(rule);
            } else if ( typeof($form.target) != 'undefined' && $form.target !== null && $form.target.getAttribute('data-gina-form-rule') ) {
                rule = $form.target.getAttribute('data-gina-form-rule').replace(/\-|\//g, '.');
                if ( typeof(rules) != 'undefined' ) {
                    $form['rule'] = getRuleObjByName(rule);
                } else {
                    throw new Error('unreachable-and-throwing branch');
                }
            }
        }
        return { rule: rule, $form: $form };
    }

    it('04.1 - SUBTRACT: pre-fix, the injected form resolves by ID, misses, and the gate stamps false', function () {
        var $target = makeTarget('<form id="form-a1b2c3-injected" data-gina-form-rule="parent-child"><input name="child"></form>');
        var calls = [];
        var store = { 'parent.child': { child: { isRequired: true } } };
        var resolver = function (name) {
            calls.push(name);
            return ( typeof(store[name]) != 'undefined' ) ? store[name] : {}; // getRuleObjByName's {} miss (:3282)
        };
        var out = preFixResolution(undefined, { target: $target }, 'form-a1b2c3-injected', {}, resolver);

        assert.deepEqual(calls, ['form.a1b2c3.injected'],
            'pre-fix: the resolver is asked for the ID-derived name — the attribute is never consulted');
        assert.deepEqual(out.$form.rule, {}, 'the miss binds an empty rule object');

        // …which the REAL live-check gate then turns into the stamped-false symptom:
        var gateFn = new Function('$form', gateSrc + '\nreturn $form.target.dataset.ginaFormLiveCheckEnabled;');
        assert.equal(gateFn({ target: { dataset: {} }, rules: out.$form.rule }), false,
            'composed pre-fix chain: {} rules -> data-gina-form-live-check-enabled="false"');
    });

    it('04.2 - the FIXED extracted bytes resolve the same fixture by the attribute (the discriminating pair)', function () {
        var $target = makeTarget('<form id="form-a1b2c3-injected" data-gina-form-rule="parent-child"><input name="child"></form>');
        var out = runResolution({
            customRule : undefined,
            $form      : { target: $target },
            _id        : 'form-a1b2c3-injected',
            rules      : {},
            rulesStore : { 'parent.child': { child: { isRequired: true } } }
        });
        var gateFn = new Function('$form', gateSrc + '\nreturn $form.target.dataset.ginaFormLiveCheckEnabled;');
        assert.equal(gateFn({ target: { dataset: {} }, rules: out.$form.rule }), true,
            'composed post-fix chain: attribute-resolved rules -> live-check enabled');
    });
});

describe('validator-injected-form-rule §05 — dist fidelity', function () {

    // main.js is browser-bundled; the unminified dist keeps identifiers, so the
    // ordering pin re-runs against it (Closure renames locals in gina.min.js —
    // there the REMOVED dead-throw string literal is the discriminator).
    var DIST_JS  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
    var DIST_MIN = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

    it('05.1 - gina.js carries the attribute-first resolution (ordering inside the bundled block)', function () {
        var src = fs.readFileSync(DIST_JS, 'utf8');
        var s2 = src.indexOf(RESOLUTION_START);
        var e2 = src.indexOf(RESOLUTION_END);
        assert.ok(s2 > -1 && e2 > s2, 'resolution block not found in the bundled gina.js');
        var block = stripComments(src.substring(s2, e2));
        var attrIdx = block.indexOf("$form.target.getAttribute('data-gina-form-rule')");
        var idIdx   = block.indexOf("rule = _id.replace(/\\-/g, '.');");
        assert.ok(attrIdx > -1 && idIdx > -1 && attrIdx < idIdx,
            'bundled gina.js must carry the attribute-first ordering');
    });

    it('05.2 - the dead attribute-branch throw is gone from BOTH built artifacts', function () {
        var js  = fs.readFileSync(DIST_JS, 'utf8');
        var min = fs.readFileSync(DIST_MIN, 'utf8');
        assert.ok(js.indexOf('using `data-gina-form-rule` on form') < 0, 'gina.js still ships the dead throw');
        assert.ok(min.indexOf('using `data-gina-form-rule` on form') < 0, 'gina.min.js still ships the dead throw');
    });
});
