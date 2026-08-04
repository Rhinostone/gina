'use strict';
/**
 * FormValidator — radio pick never reached the live check, so the submit
 * trigger kept its bind-time state forever (#B228)
 *
 * A user pick on a radio group produced NO validation pass: the live-check
 * listener for radios/checkboxes is registered under `changed.<id>`, but on
 * the user-pick path nothing dispatches that name for a radio — the
 * form-level click proxy short-circuits into `updateRadio` (which never
 * dispatches any gina event), and the form-level change proxy dispatches
 * `change.<id>` ONLY when that exact name is registered (`gina.events`
 * lookup), which radios never did. The bare-id relay that WOULD forward to
 * `changed.<id>` has no live trigger. Checkboxes are unaffected: their relay
 * is registered under `change.<id>` and forwards to `changed.<id>`.
 *
 * Consequence (consumer-measured live, both journeys): after `#B221` made
 * required radio groups gate at bind (`aria-disabled` +
 * `.gina-form-submit-disabled`), picking a member never re-ran the
 * whole-form silent pass, so the trigger stayed disabled — while submit-time
 * validation (a different call chain) admitted the checked group and let the
 * click-guard send. Pre-#B221 the defect was invisible: an unchecked
 * required group never gated at bind, so there was nothing to re-enable.
 *
 * The fix registers the radio live-check listener under `change.<id>` AS
 * WELL as `changed.<id>` (one registration site in `addLiveForInput`): the
 * pre-existing change proxy then dispatches on the native `change` event a
 * pick fires (mouse, label, keyboard), and the handler's radio arm — which
 * has accepted `change.`-typed events all along — runs the field pass + the
 * whole-form silent pass and `updateSubmitTriggerState` re-enables the
 * trigger. Single delivery per pick (the `changed.<id>` name stays
 * dispatcher-less on this path); checkboxes byte-identical.
 *
 * Test layering (project convention):
 *   §01 extraction + instrument controls (brace-walk bounded, decl-unique);
 *   §02 mechanism premise pins — the three pre-existing halves the fix
 *       relies on (proxy dispatch gate, handler radio arm, updateRadio
 *       dispatches nothing) so a refactor of any half turns this file red;
 *   §03 source pins on the new registration (whole-span, terminator-anchored);
 *   §04 behavioral registration matrix driving the REAL extracted
 *       `addLiveForInput` bytes (radio gains change.<id>; checkbox/text/no-rule
 *       shapes byte-identical as green controls);
 *   §05 dist-fidelity pins (red until the prod rebuild ships the block).
 *
 * Coverage split, stated honestly: the dispatch→consumption integration
 * (native change → proxy → handler → global pass → trigger re-enabled) is
 * the live browser smoke's coverage — this file pins each half structurally
 * and executes the registration half behaviorally.
 *
 * Run: node --test test/core/validator-radio-livecheck-dispatch.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require(path.join(__dirname, '..', 'fw'));

require(path.join(FW, '..', '..', 'utils', 'prototypes'));

var MAIN_PATH = path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var mainSrc = fs.readFileSync(MAIN_PATH, 'utf8');
var DIST_MIN_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');
var DIST_RAW_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.js');

// ============================================================================
// Extraction — execute/pin the SHIPPED bytes (no replica): brace-walk from the
// declaration with a started-flag; decl-uniqueness + balance are the controls.
// ============================================================================

function extractFunctionExpression(src, decl) {
    var start = src.indexOf(decl);
    if (start === -1) { throw new Error('declaration not found: ' + decl); }
    if (src.indexOf(decl, start + 1) !== -1) { throw new Error('declaration not unique: ' + decl); }
    var i = start, depth = 0, started = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        else if (src[i] === '}') {
            depth--;
            if (started && depth === 0) { i++; break; }
        }
    }
    if (!started || depth !== 0) { throw new Error('brace walk did not balance for: ' + decl); }
    return src.substring(start, i);
}

// Comment-stripped view for pins: the fix's own explanatory comment names the
// event literals, and a `// was:`-style line must never satisfy a positive pin.
function activeLines(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

var ADD_LIVE_DECL   = 'var addLiveForInput = function($form, $el, liveCheckTimer, isOtherTagAllowed) {';
var CHANGE_PROXY_DECL = 'var changeProxyHandler = function(event) {';
var CLICK_PROXY_DECL  = 'var clickProxyHandler = function(event) {';
var UPDATE_RADIO_DECL = 'var updateRadio = function($el, isInit, isTriggedByUser) {';

var addLiveSrc      = extractFunctionExpression(mainSrc, ADD_LIVE_DECL);
var changeProxySrc  = extractFunctionExpression(mainSrc, CHANGE_PROXY_DECL);
var clickProxySrc   = extractFunctionExpression(mainSrc, CLICK_PROXY_DECL);
var updateRadioSrc  = extractFunctionExpression(mainSrc, UPDATE_RADIO_DECL);

var addLiveActive     = activeLines(addLiveSrc);
var changeProxyActive = activeLines(changeProxySrc);
var clickProxyActive  = activeLines(clickProxySrc);
var updateRadioActive = activeLines(updateRadioSrc);

// ============================================================================
// §01 — extraction instruments (controls that CAN fail)
// ============================================================================
describe('#B228 §01 extraction instruments', function () {

    it('01.1 - all four declarations extracted (unique + brace-balanced)', function () {
        // extractFunctionExpression throws on not-found / not-unique / unbalanced;
        // reaching here with non-empty bodies is the positive arm.
        assert.ok(addLiveSrc.length > 500, 'addLiveForInput body too small');
        assert.ok(changeProxySrc.length > 100, 'changeProxyHandler body too small');
        assert.ok(clickProxySrc.length > 500, 'clickProxyHandler body too small');
        assert.ok(updateRadioSrc.length > 300, 'updateRadio body too small');
    });

    it('01.2 - the extractor DOES fail on a bogus declaration (can-fail control)', function () {
        assert.throws(function () {
            extractFunctionExpression(mainSrc, 'var addLiveForInputZZZ = function() {');
        }, /declaration not found/);
    });

    it('01.3 - comment-stripping is live: the fix comment is absent from the active view', function () {
        // The #B228 comment names the mechanism; pins below run on activeLines
        // so a comment line can never satisfy them.
        assert.ok(addLiveSrc.indexOf('#B228') > -1, 'expected the #B228 comment in raw bytes');
        assert.equal(addLiveActive.indexOf('#B228'), -1, 'active view must not carry comments');
    });
});

// ============================================================================
// §02 — mechanism premise pins (pre-existing halves the fix relies on).
// These are green pre- AND post-fix; each pins one link of the dispatch
// chain so a refactor that breaks the link is surfaced here, not in prod.
// ============================================================================
describe('#B228 §02 dispatch-chain premise pins', function () {

    it('02.1 - the change proxy dispatches ONLY registered names (gina.events gate)', function () {
        // changeProxyHandler: `_evt = 'change.'+$el.id` guarded by a
        // gina.events registry lookup before triggerEvent — the reason an
        // unregistered `change.<radioId>` was a silent no-op pre-fix.
        assert.match(changeProxyActive,
            /_evt\s*=\s*'change\.'\+\$el\.id[\s\S]{0,200}?if\s*\(\s*gina\.events\[_evt\]\s*\)\s*\{\s*cancelEvent\(event\);\s*triggerEvent\(gina,\s*\$el,\s*_evt,\s*event\.detail\);/,
            'change proxy must gate dispatch on gina.events registration');
    });

    it('02.2 - the live-check handler consumes `change.`-typed events for radios', function () {
        // The consumption arm predates the fix: `changed.` OR (`change.` AND
        // radio). The fix supplies the registration this arm always expected.
        assert.match(addLiveActive,
            /\/\^changed\\\.\/i\.test\(event\.type\)\s*\|\|\s*\/\^change\\\.\/i\.test\(event\.type\)\s*&&\s*event\.target\.type\s*==\s*'radio'/,
            'handler radio arm must accept change.-typed events');
    });

    it('02.3 - updateRadio dispatches NO gina event (the click-proxy path cannot re-validate)', function () {
        // If a future change makes updateRadio dispatch, the single-delivery
        // premise must be re-examined (double-fire risk with 02.1+§03).
        assert.equal(/triggerEvent\s*\(/.test(updateRadioActive), false,
            'updateRadio must not dispatch — the change proxy is the single dispatcher on the pick path');
    });

    it('02.4 - the click proxy short-circuits radio clicks into updateRadio (both sites)', function () {
        var m = clickProxyActive.match(/return updateRadio\(\$el, false, true\);/g);
        assert.ok(m, 'click proxy radio short-circuit not found');
        assert.equal(m.length, 2, 'expected exactly the two known short-circuit sites');
    });

    it('02.5 - radios/checkboxes register the `changed.<id>` name (legacy relay contract kept)', function () {
        assert.match(addLiveActive,
            /if\s*\(\s*\/\^\(radio\|checkbox\)\$\/i\.test\(\$el\.type\)\s*\)\s*\{\s*_evt\s*=\s*'changed\.'\+\$el\.id;\s*\}\s*else\s*\{\s*_evt\s*=\s*'change\.'\+\$el\.id;\s*\}/,
            'the changed.<id> registration branch must remain (bare-id relay + programmatic dispatch compat)');
    });
});

// ============================================================================
// §03 — source pins on the NEW registration (#B228)
// ============================================================================
describe('#B228 §03 new-registration source pins', function () {

    // Whole-span, terminator-anchored (right-extension-proof): the radio-only
    // guard, the proxy-dispatched name, the registry-undefined guard, the
    // eventsList append, both closes.
    var NEW_BLOCK_RE = /if\s*\(\s*\/\^radio\$\/i\.test\(\$el\.type\)\s*\)\s*\{\s*_evt\s*=\s*'change\.'\+\$el\.id;\s*if\s*\(\s*typeof\(gina\.events\[_evt\]\)\s*==\s*'undefined'\s*\)\s*\{\s*eventsList\[_e\]\s*=\s*_evt;\s*\+\+_e;\s*\}\s*\}/;

    it('03.1 - addLiveForInput carries the radio `change.<id>` registration (whole span)', function () {
        assert.match(addLiveActive, NEW_BLOCK_RE,
            'radio change.<id> registration block missing from addLiveForInput');
    });

    it('03.2 - exactly ONE such block (no duplicate registration site)', function () {
        var g = new RegExp(NEW_BLOCK_RE.source, 'g');
        var m = addLiveActive.match(g);
        assert.ok(m, 'block not found');
        assert.equal(m.length, 1, 'expected exactly one registration block');
    });

    it('03.3 - the block is radio-ONLY: no checkbox alternation in its guard', function () {
        // Checkboxes must stay on their working relay — a guard widened to
        // `(radio|checkbox)` would double-deliver checkbox changes.
        var start = addLiveActive.search(NEW_BLOCK_RE);
        assert.ok(start > -1);
        var slice = addLiveActive.slice(start, start + 80);
        assert.equal(slice.indexOf('checkbox'), -1, 'the #B228 guard must not admit checkboxes');
    });
});

// ============================================================================
// §04 — behavioral registration matrix (REAL extracted bytes, recording stubs)
// ============================================================================
describe('#B228 §04 registration behavior (extracted addLiveForInput)', function () {

    function runRegistration(elShape, opts) {
        opts = opts || {};
        var calls = { addListener: [], addEventListener: [] };
        var ginaStub = { events: opts.preRegistered || {} };
        var formId = 'formX';
        var instanceStub = { $forms: {} };
        instanceStub.$forms[formId] = { rules: opts.rules || {} };
        var dataset = opts.liveCheckAbsent ? {} : { ginaFormLiveCheckEnabled: opts.liveCheck || 'true' };
        var $form = {
            rules: opts.rules || {},
            target: { dataset: dataset }
        };
        var $el = {
            id: elShape.id,
            name: elShape.name,
            type: elShape.type,
            disabled: false,
            form: { getAttribute: function () { return formId; } }
        };
        var fn = new Function(
            'instance', 'gina', 'addListener', 'addEventListener', 'checkForRuleAlias', 'console',
            'return (' + addLiveSrc.replace(/^var addLiveForInput\s*=\s*/, '') + ');'
        )(
            instanceStub,
            ginaStub,
            function (g, el, evts) { calls.addListener.push(Array.isArray(evts) ? evts.slice() : [evts]); },
            function (g, el, evt) { calls.addEventListener.push(evt); },
            function () {},
            console
        );
        fn($form, $el, null, false);
        return calls;
    }

    it('04.1 - a rule-bound RADIO registers BOTH changed.<id> AND change.<id> (#B228)', function () {
        var calls = runRegistration({ id: 'r1', name: 'pick', type: 'radio' }, {
            rules: { pick: { isRequired: true } }
        });
        assert.equal(calls.addListener.length, 1, 'expected one addListener call');
        assert.deepEqual(calls.addListener[0], ['changed.r1', 'change.r1'],
            'radio must register the legacy consumed name AND the proxy-dispatched name');
    });

    it('04.2 - a rule-bound CHECKBOX registers ONLY changed.<id> (byte-identical relay contract)', function () {
        var calls = runRegistration({ id: 'c1', name: 'optin', type: 'checkbox' }, {
            rules: { optin: { isRequired: true } }
        });
        assert.equal(calls.addListener.length, 1);
        assert.deepEqual(calls.addListener[0], ['changed.c1'],
            'checkbox registration must be untouched — its change.<id> belongs to the updateCheckBox relay');
    });

    it('04.3 - a rule-bound TEXT input keeps its four live events (untouched path)', function () {
        var calls = runRegistration({ id: 't1', name: 'title', type: 'text' }, {
            rules: { title: { isRequired: true } }
        });
        assert.equal(calls.addListener.length, 1);
        assert.deepEqual(calls.addListener[0], ['change.t1', 'keyup.t1', 'focusin.t1', 'focusout.t1']);
    });

    it('04.4 - a rule-less radio group registers nothing (early return preserved)', function () {
        var calls = runRegistration({ id: 'r2', name: 'norule', type: 'radio' }, { rules: {} });
        assert.equal(calls.addListener.length, 0);
    });

    it('04.5 - an already-registered change.<id> is not re-appended (registry guard respected)', function () {
        var pre = { 'change.r3': 'r3' };
        var calls = runRegistration({ id: 'r3', name: 'pick3', type: 'radio' }, {
            rules: { pick3: { isRequired: true } },
            preRegistered: pre
        });
        assert.equal(calls.addListener.length, 1);
        assert.deepEqual(calls.addListener[0], ['changed.r3'],
            'the typeof-undefined guard must skip a name already in gina.events');
    });

    it('04.6 - live-check attribute absent: no registration at all (gate preserved)', function () {
        // NB: bindForm normally forces the attribute to 'true' for a rule-bound
        // form before this point — the arm pins addLiveForInput's OWN gate.
        var calls = runRegistration({ id: 'r4', name: 'pick4', type: 'radio' }, {
            rules: { pick4: { isRequired: true } },
            liveCheckAbsent: true
        });
        assert.equal(calls.addListener.length, 0);
    });
});

// ============================================================================
// §05 — dist-fidelity pins (red until the prod rebuild ships the block)
// ============================================================================
describe('#B228 §05 dist fidelity', function () {

    var distRaw = fs.readFileSync(DIST_RAW_PATH, 'utf8');
    var distMin = fs.readFileSync(DIST_MIN_PATH, 'utf8');

    it('05.1 - unminified dist carries the registration block verbatim', function () {
        var m = activeLines(distRaw).match(/if\s*\(\s*\/\^radio\$\/i\.test\(\$el\.type\)\s*\)\s*\{\s*_evt\s*=\s*'change\.'\+\$el\.id;/g);
        assert.ok(m, 'gina.js must carry the #B228 registration');
        assert.equal(m.length, 1);
    });

    it('05.2 - minified dist carries a minify-surviving shape of the block', function () {
        // Wrap-agnostic, quote-agnostic; anchors on what survives Closure
        // SIMPLE: the bare /^radio$/i regex literal followed by the measured
        // guard-folded comma form `&& (<id> = 'change.'` (locals renamed,
        // string/regex literals kept). Validated against the real artifacts:
        // 0 on the pre-fix gina.min.js, 1 on the rebuilt one.
        var re = /\/\^radio\$\/i\.test\([\w$.]{1,40}\.type\)\s*&&\s*\(\s*[\w$]{1,8}\s*=\s*['"]change\.['"]/g;
        var m = distMin.match(re);
        assert.ok(m, 'gina.min.js must carry the #B228 radio change.-registration shape');
        assert.equal(m.length, 1, 'expected exactly one registration site in the bundle');
    });
});
