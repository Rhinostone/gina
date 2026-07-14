/**
 * FormValidator — checkbox state model (#49)
 *
 * A checkbox's `value` attribute must not decide its `checked` state. The
 * HTML `checked` attribute (IDL `defaultChecked`) decides the initial state;
 * the live `.checked` decides the posted boolean; `value` is demoted to a
 * boolean-classification hint and, for value-carrying checkboxes (ids,
 * emails…), the submitted payload.
 *
 * Legacy opt-in: a form carrying `data-gina-form-checkbox-value-as-state="true"`
 * keeps the pre-fix behavior (value-driven initial ticking) — transitional,
 * deprecated at introduction.
 *
 * Test layering (project convention): source-inspection pins lock the live
 * shapes in main.js so the pure-logic replicas below stay honest; the replicas
 * exercise the behavior matrix; subtract cases replay the PRE-fix shapes to
 * prove each fix is load-bearing.
 *
 * Run: node --test test/core/validator-checkbox-state.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require(path.join(__dirname, '..', 'fw'));
var MAIN_PATH = path.join(FW, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var mainSrc = fs.readFileSync(MAIN_PATH, 'utf8');

// ============================================================================
// Replicas — mirror the live shapes in main.js (pinned by section 01 below)
// ============================================================================

// Mirrors the `isBooleanCheckbox` helper.
function isBooleanCheckbox($el, rule) {
    return (
        $el.getAttribute('value') === null
        || /^(true|false)$/.test($el.value)
        || typeof(rule) != 'undefined' && rule && typeof(rule.isBoolean) != 'undefined'
    ) ? true : false;
}

// Mirrors the `isCheckboxValueAsState` helper.
function isCheckboxValueAsState($form) {
    return /^true$/i.test($form.target.dataset.ginaFormCheckboxValueAsState) ? true : false;
}

// Mirrors bindForm's fieldsSet.defaultChecked capture (post-#49 shape).
function captureDefaultChecked($form, $input, defaultValue) {
    return (
        $input.defaultChecked
        ||
        isCheckboxValueAsState($form)
        && /^(true|on)$/.test(defaultValue)
        && /^(checkbox)$/i.test($input.type)
    ) ? true : false;
}

// PRE-fix capture shape (kept ONLY to demonstrate the bug in subtract cases).
function captureDefaultCheckedPreFix($input, defaultValue) {
    return (
        $input.defaultChecked
        ||
        /^(true|on)$/.test(defaultValue)
        && /^(checkbox)$/i.test($input.type)
    ) ? true : false;
}

// Mirrors updateCheckBox's init block gating + state write (post-#49 shape).
function replayInitTick($form, $el, isInit) {
    var localValue = $el.attrs['data-value'] || $el.attrs['value'] || $el.value;
    localValue = (/^(true|on)$/.test(localValue)) ? true : localValue;
    if (localValue === '') {
        localValue = false;
    }
    var isLocalBoleanValue = ( /^(true|on|false)$/i.test(localValue) ) ? true : false;
    if (isInit && isLocalBoleanValue && isCheckboxValueAsState($form)) {
        if ( /^true$/i.test(localValue) && !$el.checked) {
            $el.checked = true;
        } else if ( /^false$/i.test(localValue) && $el.checked) {
            $el.checked = false;
        }
    }
    return $el.checked;
}

// Mirrors getFormValidationInfos' checkbox branch (post-#49 shape): the
// boolean-checkbox short-circuit first, then the legacy chain for
// value-carrying checkboxes (radios keep the legacy chain untouched).
function replayCollect($el, rules) {
    var fields = {};
    var name = $el.name;
    if ( $el.type == 'checkbox' && isBooleanCheckbox($el, (rules) ? rules[name] : null) ) {
        if (rules) {
            if ( typeof(rules[name]) == 'undefined' ) {
                rules[name] = { isBoolean: true };
            } else if ( typeof(rules[name]) != 'undefined' && typeof(rules[name].isBoolean) == 'undefined' ) {
                rules[name].isBoolean = true;
                rules[name].isRequired = true;
            }
        }
        fields[name] = $el.checked;
    } else if (
        $el.checked
        || typeof (rules[name]) == 'undefined'
            && $el.value != 'undefined'
            && /^(true|false)$/.test($el.value)
        || !$el.checked
            && typeof (rules[name]) != 'undefined'
            && typeof (rules[name].isBoolean) != 'undefined'
            && /^(true|false)$/.test($el.value)
    ) {
        if ( /^(true|false)$/.test($el.value) ) {
            fields[name] = (/^true$/.test($el.value)) ? true : false;
        } else {
            fields[name] = $el.value;
        }
    } else if (
        rules
        && typeof(rules[name]) != 'undefined'
        && typeof(rules[name].isBoolean) != 'undefined'
        && typeof(rules[name].isRequired) != 'undefined'
        && !/^(true|false)$/.test($el.value)
    ) {
        fields[name] = false;
    }
    return fields;
}

// PRE-fix collector shape (no short-circuit — kept ONLY for subtract cases).
function replayCollectPreFix($el, rules) {
    var fields = {};
    var name = $el.name;
    if (
        $el.checked
        || typeof (rules[name]) == 'undefined'
            && $el.value != 'undefined'
            && /^(true|false)$/.test($el.value)
        || !$el.checked
            && typeof (rules[name]) != 'undefined'
            && typeof (rules[name].isBoolean) != 'undefined'
            && /^(true|false)$/.test($el.value)
    ) {
        if ( /^(true|false)$/.test($el.value) ) {
            fields[name] = (/^true$/.test($el.value)) ? true : false;
        } else {
            fields[name] = $el.value;
        }
    }
    return fields;
}

// ---------------------------------------------------------------------------
// Fixture builders (plain objects modelling the DOM surface the code reads)
// ---------------------------------------------------------------------------

function mkCheckbox(opts) {
    opts = opts || {};
    var attrs = {};
    if (typeof opts.valueAttr != 'undefined') attrs['value'] = opts.valueAttr;
    if (typeof opts.dataValue != 'undefined') attrs['data-value'] = opts.dataValue;
    if (opts.checkedAttr) attrs['checked'] = 'checked';
    return {
        type: 'checkbox',
        name: opts.name || 'field',
        // DOM default/on mode: `.value` reads the attribute, else "on"
        value: (typeof attrs['value'] != 'undefined') ? attrs['value'] : 'on',
        checked: !!opts.checked,
        defaultChecked: !!opts.checkedAttr,
        attrs: attrs,
        getAttribute: function (k) { return (typeof this.attrs[k] != 'undefined') ? this.attrs[k] : null; },
        hasAttribute: function (k) { return typeof this.attrs[k] != 'undefined'; }
    };
}

function mkForm(legacy) {
    var dataset = {};
    if (legacy) dataset.ginaFormCheckboxValueAsState = 'true';
    return { target: { dataset: dataset } };
}


// 01 — source inspection: pin the live shapes

describe('01 - source inspection: #49 checkbox state model pins', function () {

    it('the isBooleanCheckbox helper exists with the three-way classification', function () {
        var i = mainSrc.indexOf('var isBooleanCheckbox = function($el, rule)');
        assert.ok(i > -1, 'helper declaration must exist');
        var body = mainSrc.substring(i, mainSrc.indexOf('}', i) + 1);
        assert.ok(body.indexOf("$el.getAttribute('value') === null") > -1, 'valueless classification');
        assert.ok(body.indexOf('/^(true|false)$/.test($el.value)') > -1, 'boolean-literal classification');
        assert.ok(body.indexOf('rule.isBoolean') > -1, 'rule classification');
    });

    it('the legacy opt-in helper reads the form dataset flag', function () {
        var re = /var isCheckboxValueAsState = function\(\$form\)\s*\{\s*return \/\^true\$\/i\.test\(\$form\.target\.dataset\.ginaFormCheckboxValueAsState\)/;
        assert.ok(re.test(mainSrc), 'isCheckboxValueAsState must test the dataset flag');
    });

    it('the fieldsSet defaultChecked capture gates the value clause on the legacy opt-in', function () {
        var re = /\$form\.fieldsSet\[elId\]\.defaultChecked\s*=\s*\(\s*\$inputs\[f\]\.defaultChecked\s*\|\|\s*isCheckboxValueAsState\(\$form\)\s*&&\s*\/\^\(true\|on\)\$\/\.test\(defaultValue\)\s*&&\s*\/\^\(checkbox\)\$\/i\.test\(\$inputs\[f\]\.type\)/;
        assert.ok(re.test(mainSrc), 'the value-derived clause must sit behind isCheckboxValueAsState($form)');
    });

    it('the init-time value-driven tick is gated on the legacy opt-in', function () {
        var i = mainSrc.indexOf('if (isInit && isLocalBoleanValue && isCheckboxValueAsState($form))');
        assert.ok(i > -1, 'the init tick gate must include the legacy opt-in');
        // and the ungated pre-fix form must be gone
        assert.equal(mainSrc.indexOf('if (isInit && isLocalBoleanValue) {'), -1,
            'the ungated init tick must not remain');
    });

    it('the dead boolean-coercion regexes are removed file-wide', function () {
        // `$`-anchored where `^` was meant — never matched since 2021; removed, not "fixed"
        assert.equal(mainSrc.indexOf('$(on|true|false)'), -1, 'dead 3-way regex must be gone');
        assert.equal(mainSrc.indexOf('$(on|true)'), -1, 'dead 2-way regex must be gone');
    });

    it('both serialization collectors short-circuit boolean checkboxes to live .checked', function () {
        var inline = mainSrc.indexOf("isBooleanCheckbox($target[i], (rules) ? rules[name] : null)");
        assert.ok(inline > -1, 'inline submit-path collector must classify via the helper');
        var inlinePost = mainSrc.indexOf('fields[name] = $target[i].checked;', inline);
        assert.ok(inlinePost > -1 && inlinePost - inline < 300, 'inline collector must post live .checked');

        var infos = mainSrc.indexOf("isBooleanCheckbox($form[i], (rules) ? rules[name] : null)");
        assert.ok(infos > -1, 'getFormValidationInfos must classify via the helper');
        var infosPost = mainSrc.indexOf('fields[name] = $form[i].checked;', infos);
        assert.ok(infosPost > -1 && infosPost - infos < 900, 'getFormValidationInfos must post live .checked');
    });

    it('the radio boolean sub-branch is untouched', function () {
        var re = /if \(\/\^true\$\/\.test\(rules\[name\]\.isBoolean\) && \$form\[i\]\.checked \)/;
        assert.ok(re.test(mainSrc), 'radio serialization must keep requiring .checked');
    });

    it('the migration warn exists and is guarded once-per-field', function () {
        assert.ok(mainSrc.indexOf('var checkboxValueStateWarned = {};') > -1, 'warn guard map must exist');
        var i = mainSrc.indexOf('!checkboxValueStateWarned[elId]');
        assert.ok(i > -1, 'warn must be guarded per field id');
        assert.ok(mainSrc.indexOf('data-gina-form-checkbox-value-as-state="true"', i) > -1,
            'warn must name the legacy opt-in attribute');
    });

    it('replica honesty: the collector fallback chain still carries the legacy gates', function () {
        // The value-carrying/radio fallback (`else if`) must keep the original
        // three-way gate so replayCollect above mirrors the real flow.
        var re = /\} else if \(\s*\$form\[i\]\.checked\s*\|\| typeof \(rules\[name\]\) == 'undefined'/;
        assert.ok(re.test(mainSrc), 'original gate chain must follow the short-circuit as else-if');
    });
});


// 02 — isBooleanCheckbox classification matrix

describe('02 - boolean classification', function () {
    it('valueless checkbox (DOM .value defaults to "on") is boolean', function () {
        assert.equal(isBooleanCheckbox(mkCheckbox({}), null), true);
    });
    it('value="true" / value="false" are boolean', function () {
        assert.equal(isBooleanCheckbox(mkCheckbox({ valueAttr: 'true' }), null), true);
        assert.equal(isBooleanCheckbox(mkCheckbox({ valueAttr: 'false' }), null), true);
    });
    it('neutral and payload values are NOT boolean (value-carrying)', function () {
        assert.equal(isBooleanCheckbox(mkCheckbox({ valueAttr: '1' }), null), false);
        assert.equal(isBooleanCheckbox(mkCheckbox({ valueAttr: 'someone@domain.tld' }), null), false);
    });
    it('an isBoolean rule classifies any checkbox as boolean', function () {
        assert.equal(isBooleanCheckbox(mkCheckbox({ valueAttr: '1' }), { isBoolean: true }), true);
    });
});


// 03 — defaultChecked capture: spec mode vs legacy opt-in

describe('03 - defaultChecked capture (#49 core fix)', function () {

    it('spec mode: value="true" with no checked attribute is NOT checked-by-default', function () {
        var $el = mkCheckbox({ valueAttr: 'true' });
        assert.equal(captureDefaultChecked(mkForm(false), $el, $el.value), false);
    });

    it('spec mode: the checked attribute decides — regardless of value', function () {
        var t = mkCheckbox({ valueAttr: 'false', checkedAttr: true });
        assert.equal(captureDefaultChecked(mkForm(false), t, t.value), true,
            'value="false" must not defeat the checked attribute');
        var f = mkCheckbox({ valueAttr: 'true' });
        assert.equal(captureDefaultChecked(mkForm(false), f, f.value), false);
    });

    it('spec mode: a valueless checkbox ("on") is NOT checked-by-default (reset no longer ticks it)', function () {
        var $el = mkCheckbox({});
        assert.equal(captureDefaultChecked(mkForm(false), $el, $el.value), false);
    });

    it('legacy opt-in: value="true"/valueless keep deciding the default state', function () {
        var t = mkCheckbox({ valueAttr: 'true' });
        assert.equal(captureDefaultChecked(mkForm(true), t, t.value), true);
        var on = mkCheckbox({});
        assert.equal(captureDefaultChecked(mkForm(true), on, on.value), true);
    });

    it('the value clause never applies to radios, in either mode', function () {
        var radio = mkCheckbox({ valueAttr: 'true' });
        radio.type = 'radio';
        assert.equal(captureDefaultChecked(mkForm(true), radio, radio.value), false);
        assert.equal(captureDefaultChecked(mkForm(false), radio, radio.value), false);
    });

    it('subtract: the PRE-fix shape ticks value="true" with no checked attribute (the #49 bug)', function () {
        var $el = mkCheckbox({ valueAttr: 'true' });
        assert.equal(captureDefaultCheckedPreFix($el, $el.value), true,
            'pre-fix capture must reproduce the bug, proving the gate is load-bearing');
    });
});


// 04 — init-time ticking: spec mode vs legacy opt-in

describe('04 - init-time value-driven ticking', function () {

    it('spec mode: value="true" does NOT tick the box at bind', function () {
        var $el = mkCheckbox({ valueAttr: 'true' });
        assert.equal(replayInitTick(mkForm(false), $el, true), false);
    });

    it('spec mode: value="false" does NOT un-tick a parser-checked box', function () {
        var $el = mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true });
        assert.equal(replayInitTick(mkForm(false), $el, true), true);
    });

    it('legacy opt-in: value drives the initial state (pre-fix behavior preserved)', function () {
        var t = mkCheckbox({ valueAttr: 'true' });
        assert.equal(replayInitTick(mkForm(true), t, true), true);
        var f = mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true });
        assert.equal(replayInitTick(mkForm(true), f, true), false);
    });
});


// 05 — serialization: the posted value comes from live .checked

describe('05 - serialization (#49 posted-value contract)', function () {

    it('boolean checkbox posts its live .checked as a real boolean', function () {
        var on = mkCheckbox({ valueAttr: 'true', checked: true });
        assert.strictEqual(replayCollect(on, {}).field, true);
        var off = mkCheckbox({ valueAttr: 'false', checked: false });
        assert.strictEqual(replayCollect(off, {}).field, false);
    });

    it('stale value="true" with .checked=false posts FALSE (consumer-JS desync fixed)', function () {
        // A consumer setting el.checked = false directly bypasses the value
        // mirror, leaving .value === "true" — the pre-fix collector trusted it.
        var $el = mkCheckbox({ valueAttr: 'true', checked: false });
        assert.strictEqual(replayCollect($el, {}).field, false);
    });

    it('subtract: the PRE-fix collector posts TRUE off the stale value', function () {
        var $el = mkCheckbox({ valueAttr: 'true', checked: false });
        assert.strictEqual(replayCollectPreFix($el, {}).field, true,
            'pre-fix collector must reproduce the desync, proving the short-circuit is load-bearing');
    });

    it('a neutral value with an isBoolean rule posts real checked booleans (dead control fixed)', function () {
        var rules = { field: { isBoolean: true } };
        var on = mkCheckbox({ valueAttr: '1', checked: true });
        assert.strictEqual(replayCollect(on, rules).field, true);
        var off = mkCheckbox({ valueAttr: '1', checked: false });
        assert.strictEqual(replayCollect(off, rules).field, false);
    });

    it('a value-carrying checkbox posts its payload when checked, nothing when not', function () {
        var on = mkCheckbox({ valueAttr: 'someone@domain.tld', checked: true });
        assert.strictEqual(replayCollect(on, {}).field, 'someone@domain.tld');
        var off = mkCheckbox({ valueAttr: 'someone@domain.tld', checked: false });
        assert.equal(Object.prototype.hasOwnProperty.call(replayCollect(off, {}), 'field'), false,
            'unchecked value-carrying checkbox must stay absent from the post');
    });

    it('an unchecked no-rule boolean checkbox still posts false (wire contract preserved)', function () {
        // pre-fix: branch (B) posted boolean(value) for value="false"; post-fix
        // the short-circuit posts .checked === false — same wire bytes.
        var $el = mkCheckbox({ valueAttr: 'false', checked: false });
        assert.strictEqual(replayCollect($el, {}).field, false);
    });

    it('the isBoolean rule self-injection is preserved for boolean checkboxes', function () {
        var rules = {};
        replayCollect(mkCheckbox({ valueAttr: 'true', checked: true }), rules);
        assert.deepEqual(rules.field, { isBoolean: true });
    });
});
