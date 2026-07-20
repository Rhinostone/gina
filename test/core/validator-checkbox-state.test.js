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

// Mirrors the `isCheckboxStateModelDeclared` helper (#B125): any EXPLICIT
// `data-gina-form-checkbox-value-as-state` declaration silences the
// migration warns — the author has read the state model.
function isCheckboxStateModelDeclared($form) {
    return ( typeof($form.target.dataset.ginaFormCheckboxValueAsState) != 'undefined' ) ? true : false;
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

// Mirrors updateCheckBox's init block: the jQuery-`on` normalization preamble,
// then the gating + state write (post-#49 shape). The preamble is load-bearing
// for valueless checkboxes — it rewrites `.value` to false BEFORE localValue is
// read, so a valueless *unchecked* box can never reach the legacy tick even in
// value-as-state mode. Omitting it makes the replica claim such a box ticks.
function replayInitTick($form, $el, isInit) {
    // "Preventing jQuery setting `on` value when input is not checked"
    if (isInit && /^(on)$/i.test($el.value) && !$el.checked) {
        $el.value = false;
    }
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
                rules[name].isRequired = true;
                rules[name].isBoolean = true;
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

// Mirrors the INLINE submit-path collector's checkbox/radio branch (post-#49
// shape). Deliberate asymmetry vs replayCollect above: this path never mutates
// `rules` — only getFormValidationInfos self-injects the isBoolean rule.
function replayInlineCollect($el, rules) {
    var fields = {};
    var name = $el.name;
    if ( typeof($el.type) != 'undefined' && $el.type == 'checkbox' && isBooleanCheckbox($el, (rules) ? rules[name] : null) ) {
        fields[name] = $el.checked;
    } else if ( typeof($el.type) != 'undefined' && $el.type == 'radio' || typeof($el.type) != 'undefined' && $el.type == 'checkbox' ) {
        if ( $el.checked ) {
            if ( /^(true|false)$/.test($el.value) ) {
                fields[name] = $el.value = (/^true$/.test($el.value)) ? true : false;
            } else {
                fields[name] = $el.value;
            }
        } else if ( // force validator to pass `false` if boolean is required explicitly
            rules
            && typeof(rules[name]) != 'undefined'
            && typeof(rules[name].isBoolean) != 'undefined' && $el.type == 'checkbox'
            && !/^(true|false)$/.test($el.value)
        ) {
            fields[name] = false;
        }
    } else {
        fields[name] = $el.value;
    }
    return fields;
}

// Mirrors bindForm's migration-warn guard (#49, + the #B125 explicit-declaration
// conjunct): six conjuncts plus the once-per-field-id map write. Returns whether
// the live code would warn.
function replayWarnPass($form, $el, elId, warned) {
    if (
        /^(checkbox)$/i.test($el.type)
        && !isCheckboxValueAsState($form)
        && !isCheckboxStateModelDeclared($form)
        && !$el.hasAttribute('checked')
        && /^(true|on)$/i.test($el.getAttribute('value'))
        && !warned[elId]
    ) {
        warned[elId] = true; // console.warn(...) in the live code
        return true;
    }
    return false;
}

// Mirrors the UN-TICK-direction migration warn (#49 F5): a checked-attr box
// whose OLD resolution chain (data-value attr -> value attr -> .value, with
// '' mapping to false) read false/empty used to render unticked and now stays
// ticked. Shares the once-map with the tick-direction warn (the two guards
// are mutually exclusive by the hasAttribute('checked') polarity).
function replayWarnPassUntick($form, $el, elId, warned) {
    var legacyUntickValue = $el.getAttribute('data-value') || $el.getAttribute('value') || $el.value;
    if (
        /^(checkbox)$/i.test($el.type)
        && !isCheckboxValueAsState($form)
        && !isCheckboxStateModelDeclared($form)
        && $el.hasAttribute('checked')
        && ( legacyUntickValue === '' || /^false$/i.test(legacyUntickValue) )
        && !warned[elId]
    ) {
        warned[elId] = true; // console.warn(...) in the live code
        return true;
    }
    return false;
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
        // end-anchored on the OUTER legacy-chain opener (the injection block has
        // its own inner `} else if (`, so anchor on the distinctive gate text) —
        // comment growth inside the branch cannot break this pin
        var infosTail = mainSrc.substring(infos);
        var legacyGate = infosTail.match(/\} else if \(\s*\$form\[i\]\.checked\s*\|\| typeof \(rules\[name\]\) == 'undefined'/);
        assert.ok(legacyGate, 'the legacy chain must follow the short-circuit');
        assert.ok(infosTail.substring(0, legacyGate.index).indexOf('fields[name] = $form[i].checked;') > -1,
            'getFormValidationInfos must post live .checked inside the short-circuit branch');
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

    it('the jQuery-`on` preamble rewrites .value BEFORE updateCheckBox reads localValue', function () {
        var i = mainSrc.indexOf('var updateCheckBox = function($el, isInit)');
        assert.ok(i > -1, 'updateCheckBox must exist');
        var body = mainSrc.substring(i);
        var preamble = body.indexOf('if (isInit && /^(on)$/i.test($el.value) && !$el.checked)');
        assert.ok(preamble > -1, 'the jQuery-`on` normalization preamble must exist');
        var localValueRead = body.indexOf("$el.getAttribute('data-value') || $el.getAttribute('value') || $el.value");
        assert.ok(localValueRead > -1, 'the localValue read must exist');
        assert.ok(preamble < localValueRead,
            'the preamble must precede the localValue read — replayInitTick mirrors this order');
    });

    it('the inline submit collector short-circuits WITHOUT self-injecting rules (asymmetry vs getFormValidationInfos)', function () {
        var i = mainSrc.indexOf("isBooleanCheckbox($target[i], (rules) ? rules[name] : null)");
        assert.ok(i > -1, 'inline collector must classify via the helper');
        // end-anchor on the distinctive OUTER gate: a bare `} else if (` would
        // terminate on an inner else-if if one is ever added to this branch
        var tail = mainSrc.substring(i);
        var end = tail.indexOf("} else if ( typeof($target[i].type) != 'undefined' && $target[i].type == 'radio'");
        assert.ok(end > -1, 'the inline short-circuit must be followed by the legacy radio/checkbox chain');
        var block = tail.substring(0, end);
        assert.ok(block.indexOf('fields[name] = $target[i].checked;') > -1,
            'the inline short-circuit must post live .checked');
        assert.equal(block.indexOf('isBoolean: true'), -1,
            'the inline path must NOT self-inject the isBoolean rule');
        assert.equal(block.indexOf('rules[name].isRequired'), -1,
            'the inline path must NOT inject isRequired');

        // contrast — the infos collector DOES inject inside its short-circuit
        var j = mainSrc.indexOf("isBooleanCheckbox($form[i], (rules) ? rules[name] : null)");
        var infosTail = mainSrc.substring(j);
        var legacyGate = infosTail.match(/\} else if \(\s*\$form\[i\]\.checked\s*\|\| typeof \(rules\[name\]\) == 'undefined'/);
        assert.ok(legacyGate, 'the infos legacy chain must follow its short-circuit');
        var infosBlock = infosTail.substring(0, legacyGate.index);
        assert.ok(infosBlock.indexOf('rules[name] = { isBoolean: true };') > -1,
            'the infos path DOES self-inject — the asymmetry is deliberate, not drift');
    });

    it('the migration warn gates on its five conjuncts and reads the value ATTRIBUTE', function () {
        var i = mainSrc.indexOf('&& !checkboxValueStateWarned[elId]');
        assert.ok(i > -1, 'the once-guard conjunct must exist');
        var open = mainSrc.lastIndexOf('if (', i);
        assert.ok(open > -1 && open < i, 'the guard must have an opening if');
        var block = mainSrc.substring(open, i);
        assert.ok(block.indexOf('/^(checkbox)$/i.test($inputs[f].type)') > -1,
            'checkbox-only (radios never warn)');
        assert.ok(block.indexOf('!isCheckboxValueAsState($form)') > -1,
            'silent in legacy value-as-state mode');
        assert.ok(block.indexOf("!$inputs[f].hasAttribute('checked')") > -1,
            'silent when the checked attribute is already present');
        assert.ok(block.indexOf("/^(true|on)$/i.test($inputs[f].getAttribute('value'))") > -1,
            'reads the value ATTRIBUTE (null for a valueless box) case-insensitively');
        assert.ok(mainSrc.indexOf('checkboxValueStateWarned[elId] = true;', i) > -1,
            'the guard must set the once-map before warning');
    });

    it('the warn once-map is declared outside bindForm, so it survives re-binds', function () {
        var mapDecl = mainSrc.indexOf('var checkboxValueStateWarned = {};');
        var bindFormDecl = mainSrc.indexOf('var bindForm = function(');
        assert.ok(mapDecl > -1, 'the once-map must exist');
        assert.ok(bindFormDecl > -1, 'bindForm must exist');
        assert.ok(mapDecl < bindFormDecl,
            'the map must be declared OUTSIDE bindForm — a per-bind map would re-warn on every rebind');
    });

    it('the un-tick-direction warn exists, mirrors the OLD resolution chain, and sits AFTER the tick warn', function () {
        var chain = mainSrc.indexOf("var legacyUntickValue = $inputs[f].getAttribute('data-value') || $inputs[f].getAttribute('value') || $inputs[f].value;");
        assert.ok(chain > -1, 'the faithful-mirror chain must exist (data-value -> value attr -> .value)');
        var tickWarn = mainSrc.indexOf('no longer implies the checked state');
        var untickWarn = mainSrc.indexOf('no longer un-ticks a checked box');
        assert.ok(tickWarn > -1 && untickWarn > -1, 'both warn texts must exist');
        assert.ok(tickWarn < untickWarn,
            'the un-tick warn must sit AFTER the tick warn — the §01 five-conjunct pin anchors the FIRST once-map conjunct');
        // the block between the chain and the warn text carries the mirror conjuncts
        var block = mainSrc.substring(chain, untickWarn);
        assert.ok(block.indexOf("&& $inputs[f].hasAttribute('checked')") > -1,
            'requires the checked attribute (positive — the polarity that makes the two warns mutually exclusive)');
        assert.ok(block.indexOf("legacyUntickValue === '' || /^false$/i.test(legacyUntickValue)") > -1,
            "membership: resolved '' (the old ''-to-false mapping) or case-insensitive false");
        assert.ok(block.indexOf('!isCheckboxValueAsState($form)') > -1, 'silent in legacy mode');
        assert.ok(block.indexOf('!checkboxValueStateWarned[elId]') > -1, 'shares the once-guard');
    });

    it('both warn directions share ONE once-map (exactly two stamps, one per direction)', function () {
        var stamps = mainSrc.match(/checkboxValueStateWarned\[elId\] = true;/g);
        assert.ok(stamps, 'stamps must exist');
        assert.equal(stamps.length, 2, 'exactly two stamps — the tick warn and the un-tick warn');
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

    it('legacy opt-in: a valueless UNCHECKED box is not ticked — the jQuery-`on` preamble rewrites .value first', function () {
        var $el = mkCheckbox({});
        assert.equal(replayInitTick(mkForm(true), $el, true), false,
            'the preamble sets .value=false before localValue is read, so "on" never reaches the tick');
        assert.strictEqual($el.value, false, 'the preamble must have rewritten .value');
    });

    it('legacy opt-in: a valueless CHECKED box stays checked (the preamble skips checked boxes)', function () {
        var $el = mkCheckbox({ checkedAttr: true, checked: true });
        assert.equal(replayInitTick(mkForm(true), $el, true), true);
        assert.strictEqual($el.value, 'on', 'the preamble must not touch a checked box');
    });

    it('the preamble only fires at init', function () {
        var $el = mkCheckbox({});
        replayInitTick(mkForm(true), $el, false);
        assert.strictEqual($el.value, 'on', 'a non-init pass must leave .value alone');
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

    it('a valueless checkbox posts its live .checked through BOTH collectors', function () {
        // No `value` attribute at all — classified boolean via the getAttribute
        // null clause, so the posted wire value is the live state, not "on".
        assert.strictEqual(replayCollect(mkCheckbox({ checked: true }), {}).field, true);
        assert.strictEqual(replayCollect(mkCheckbox({ checked: false }), {}).field, false);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ checked: true }), {}).field, true);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ checked: false }), {}).field, false);
    });
});


// 06 — the inline submit-path collector

describe('06 - inline submit collector (#49)', function () {

    it('a boolean checkbox posts its live .checked in both states', function () {
        assert.strictEqual(replayInlineCollect(mkCheckbox({ valueAttr: 'true', checked: true }), {}).field, true);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ valueAttr: 'true', checked: false }), {}).field, false);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ valueAttr: 'false', checked: true }), {}).field, true);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ valueAttr: 'false', checked: false }), {}).field, false);
    });

    it('stale value="true" with .checked=false posts FALSE (consumer-JS desync)', function () {
        assert.strictEqual(replayInlineCollect(mkCheckbox({ valueAttr: 'true', checked: false }), {}).field, false);
    });

    it('a neutral value with an isBoolean rule posts live checked booleans', function () {
        var rules = { field: { isBoolean: true } };
        assert.strictEqual(replayInlineCollect(mkCheckbox({ valueAttr: '1', checked: true }), rules).field, true);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ valueAttr: '1', checked: false }), rules).field, false);
    });

    it('a value-carrying checkbox posts its payload when checked, nothing when not', function () {
        var on = mkCheckbox({ valueAttr: 'someone@domain.tld', checked: true });
        assert.strictEqual(replayInlineCollect(on, {}).field, 'someone@domain.tld');
        var off = mkCheckbox({ valueAttr: 'someone@domain.tld', checked: false });
        assert.equal(Object.prototype.hasOwnProperty.call(replayInlineCollect(off, {}), 'field'), false,
            'unchecked value-carrying checkbox must stay absent from the post');
    });

    it('the inline path does NOT mutate rules — only getFormValidationInfos self-injects', function () {
        var inlineRules = {};
        replayInlineCollect(mkCheckbox({ valueAttr: 'true', checked: true }), inlineRules);
        assert.deepEqual(inlineRules, {}, 'the inline collector must leave rules untouched');

        var infosRules = {};
        replayCollect(mkCheckbox({ valueAttr: 'true', checked: true }), infosRules);
        assert.deepEqual(infosRules.field, { isBoolean: true },
            'the infos collector self-injects — the asymmetry is deliberate, not drift');
    });

    it('a radio keeps riding the legacy chain (never short-circuited)', function () {
        var on = mkCheckbox({ valueAttr: 'true', checked: true });
        on.type = 'radio';
        assert.strictEqual(replayInlineCollect(on, {}).field, true);
        var off = mkCheckbox({ valueAttr: 'true', checked: false });
        off.type = 'radio';
        assert.equal(Object.prototype.hasOwnProperty.call(replayInlineCollect(off, {}), 'field'), false,
            'an unchecked radio posts nothing');
    });

    it('the force-false branch is unreachable post-#49 (characterization)', function () {
        // Reaching it requires BOTH:
        //   (1) isBooleanCheckbox($el, rule) === false — else the short-circuit wins
        //   (2) rules[name].isBoolean !== undefined    — the branch's own gate
        // But (2) makes isBooleanCheckbox true via its third clause, so (1) and (2)
        // are mutually exclusive; the `&& type == 'checkbox'` conjunct then excludes
        // radios. Asserting the exclusion, NOT an output value — both the branch and
        // the short-circuit would yield `false`, so the result cannot discriminate.
        var rule = { isBoolean: true };
        assert.equal(isBooleanCheckbox(mkCheckbox({ valueAttr: '1' }), rule), true,
            'an isBoolean-ruled checkbox is always classified boolean -> short-circuited');
        assert.equal(isBooleanCheckbox(mkCheckbox({ valueAttr: '1' }), undefined), false,
            'without the rule it is not boolean -> but then the force-false gate cannot pass either');
    });
});


// 07 — the migration warn guard

describe('07 - migration warn guard (#49)', function () {

    it('warns for value="true" with no checked attribute, in spec mode', function () {
        var warned = {};
        assert.equal(replayWarnPass(mkForm(false), mkCheckbox({ valueAttr: 'true' }), 'f1', warned), true);
        assert.equal(warned.f1, true, 'the once-map must be stamped');
    });

    it('is case-insensitive on the value attribute, and covers "on"', function () {
        assert.equal(replayWarnPass(mkForm(false), mkCheckbox({ valueAttr: 'TRUE' }), 'f1', {}), true);
        assert.equal(replayWarnPass(mkForm(false), mkCheckbox({ valueAttr: 'On' }), 'f2', {}), true);
    });

    it('fires once per field id — a re-bind does not re-warn', function () {
        var warned = {};
        var $el = mkCheckbox({ valueAttr: 'true' });
        assert.equal(replayWarnPass(mkForm(false), $el, 'f1', warned), true, 'first bind warns');
        assert.equal(replayWarnPass(mkForm(false), $el, 'f1', warned), false, 're-bind must stay silent');
        assert.equal(replayWarnPass(mkForm(false), $el, 'other', warned), true, 'a different field still warns');
    });

    it('stays silent in legacy value-as-state mode (nothing changed for that form)', function () {
        assert.equal(replayWarnPass(mkForm(true), mkCheckbox({ valueAttr: 'true' }), 'f1', {}), false);
    });

    it('stays silent when the checked attribute is present (the markup is already unambiguous)', function () {
        assert.equal(replayWarnPass(mkForm(false), mkCheckbox({ valueAttr: 'true', checkedAttr: true }), 'f1', {}), false);
    });

    it('stays silent for a valueless checkbox — deliberate: the guard reads the ATTRIBUTE, not .value', function () {
        // A valueless box has .value === "on" but getAttribute('value') === null,
        // so /^(true|on)$/i sees the string "null" and never matches. Deliberate:
        // warning here would fire on nearly every plain checkbox on a page, and
        // its *rendering* did not change (no checked attribute either way) — only
        // its form-reset default did.
        var $el = mkCheckbox({});
        assert.equal($el.getAttribute('value'), null, 'valueless: the attribute is absent');
        assert.equal($el.value, 'on', 'but the DOM .value still reads "on"');
        assert.equal(replayWarnPass(mkForm(false), $el, 'f1', {}), false);
    });

    it('stays silent for payload values and for radios', function () {
        assert.equal(replayWarnPass(mkForm(false), mkCheckbox({ valueAttr: 'someone@domain.tld' }), 'f1', {}), false);
        var radio = mkCheckbox({ valueAttr: 'true' });
        radio.type = 'radio';
        assert.equal(replayWarnPass(mkForm(false), radio, 'f2', {}), false);
    });
});


// 08 — the un-tick-direction migration warn (#49 F5)

describe('08 - un-tick migration warn (#49 F5)', function () {

    it('warns for a checked-attr box whose value reads false — the markup that used to render unticked', function () {
        var warned = {};
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true }), 'f1', warned), true);
        assert.equal(warned.f1, true, 'the shared once-map must be stamped');
    });

    it('is case-insensitive on false, like the old un-tick was', function () {
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ valueAttr: 'FALSE', checkedAttr: true, checked: true }), 'f1', {}), true);
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ valueAttr: 'False', checkedAttr: true, checked: true }), 'f2', {}), true);
    });

    it('warns for value="" — the old chain mapped the empty string to false and un-ticked', function () {
        var $el = mkCheckbox({ valueAttr: '', checkedAttr: true, checked: true });
        // the empty ATTRIBUTE is falsy in the chain, so resolution falls to .value (also "")
        assert.equal($el.getAttribute('value'), '', 'attribute present but empty');
        assert.strictEqual($el.value, '', 'DOM .value mirrors it');
        assert.equal(replayWarnPassUntick(mkForm(false), $el, 'f1', {}), true);
    });

    it('warns for data-value="false" — data-value WINS the old chain, even over value="true"', function () {
        var $el = mkCheckbox({ dataValue: 'false', valueAttr: 'true', checkedAttr: true, checked: true });
        assert.equal(replayWarnPassUntick(mkForm(false), $el, 'f1', {}), true,
            'the old init pass resolved data-value first — this markup DID render unticked');
    });

    it('stays silent in legacy value-as-state mode (that form still un-ticks)', function () {
        assert.equal(replayWarnPassUntick(mkForm(true), mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true }), 'f1', {}), false);
    });

    it('stays silent without the checked attribute — nothing to un-tick', function () {
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ valueAttr: 'false' }), 'f1', {}), false);
    });

    it('stays silent for value="true", valueless, and payload values on a checked box (rendering unchanged)', function () {
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ valueAttr: 'true', checkedAttr: true, checked: true }), 'f1', {}), false,
            'value="true" + checked: the old tick was a no-op on an already-checked box');
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ checkedAttr: true, checked: true }), 'f2', {}), false,
            'valueless: .value reads "on" -> resolved true -> the old code never un-ticked it');
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ valueAttr: 'abc', checkedAttr: true, checked: true }), 'f3', {}), false,
            'payload value: not boolean-shaped -> the old init pass left it alone');
    });

    it('stays silent for radios', function () {
        var radio = mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true });
        radio.type = 'radio';
        assert.equal(replayWarnPassUntick(mkForm(false), radio, 'f1', {}), false);
    });

    it('fires once per field id and shares the map across both directions', function () {
        var warned = {};
        var $el = mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true });
        assert.equal(replayWarnPassUntick(mkForm(false), $el, 'f1', warned), true, 'first bind warns');
        assert.equal(replayWarnPassUntick(mkForm(false), $el, 'f1', warned), false, 're-bind stays silent');
        // the map is SHARED: a field stamped by either direction never re-warns
        assert.equal(replayWarnPass(mkForm(false), mkCheckbox({ valueAttr: 'true' }), 'f1', warned), false,
            'the tick-direction guard honors the same stamp');
    });

    it('the two directions are mutually exclusive for any single element', function () {
        // tick requires NO checked attribute; un-tick requires it — no element
        // can satisfy both, so sharing the once-map cannot mask either warn.
        var candidates = [
            mkCheckbox({ valueAttr: 'true' }),
            mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true }),
            mkCheckbox({ valueAttr: 'on' }),
            mkCheckbox({ valueAttr: '', checkedAttr: true, checked: true }),
            mkCheckbox({}),
            mkCheckbox({ checkedAttr: true, checked: true })
        ];
        for (var i = 0; i < candidates.length; i++) {
            var a = replayWarnPass(mkForm(false), candidates[i], 'x' + i, {});
            var b = replayWarnPassUntick(mkForm(false), candidates[i], 'y' + i, {});
            assert.ok(!(a && b), 'element ' + i + ' must not trigger both directions');
        }
    });
});


// 09 — dist fidelity: the built bundle carries both warn directions

describe('09 - dist fidelity (#49 warns in the built bundle)', function () {

    var DIST_DIR = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');
    var distSrc = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
    var distMin = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');

    it('positive control: the tick-direction warn text is findable in both artifacts', function () {
        // proves the instrument — a warn string literal survives Closure — so the
        // un-tick pins below cannot pass (or fail) vacuously
        assert.ok(distSrc.indexOf('no longer implies the checked state') > -1, 'gina.js');
        assert.ok(distMin.indexOf('no longer implies the checked state') > -1, 'gina.min.js');
    });

    it('the un-tick warn text is in gina.js', function () {
        assert.ok(distSrc.indexOf('no longer un-ticks a checked box') > -1,
            'rebuild dist after editing the validator src (prod build, 3 CI flags)');
    });

    it('the un-tick warn text is in gina.min.js', function () {
        assert.ok(distMin.indexOf('no longer un-ticks a checked box') > -1,
            'rebuild dist after editing the validator src (prod build, 3 CI flags)');
    });
});


// 10 — explicit state-model declaration silences the migration warns (#B125)

describe('10 - explicit state-model declaration opt-out (#B125)', function () {

    // A form that EXPLICITLY declares the state model (any value; canonically
    // "false" for the spec model).
    function mkFormDeclared(value) {
        return { target: { dataset: { ginaFormCheckboxValueAsState: value } } };
    }

    // PRE-#B125 warn-gate shape (no declaration conjunct) — kept ONLY to prove
    // the new conjunct is load-bearing in the subtract below.
    function replayWarnPassPreB125($form, $el, elId, warned) {
        if (
            /^(checkbox)$/i.test($el.type)
            && !isCheckboxValueAsState($form)
            && !$el.hasAttribute('checked')
            && /^(true|on)$/i.test($el.getAttribute('value'))
            && !warned[elId]
        ) {
            warned[elId] = true;
            return true;
        }
        return false;
    }

    it('source pin: the helper exists and tests dataset PRESENCE, not value', function () {
        var re = /var isCheckboxStateModelDeclared = function\(\$form\)\s*\{\s*return \( typeof\(\$form\.target\.dataset\.ginaFormCheckboxValueAsState\) != 'undefined' \)/;
        assert.ok(re.test(mainSrc), 'isCheckboxStateModelDeclared must test the dataset flag for presence');
    });

    it('source pin: BOTH warn gates carry the declaration conjunct (and keep the legacy one)', function () {
        var conjuncts = mainSrc.match(/&& !isCheckboxStateModelDeclared\(\$form\)/g);
        assert.ok(conjuncts, 'the declaration conjunct must exist');
        assert.equal(conjuncts.length, 2, 'exactly two — one per warn direction');
        // the legacy conjunct is retained beside it in both gates: `!declared`
        // implies `!valueAsState`, but the pair documents the two silencing
        // layers (legacy mode vs explicit declaration) and keeps §01's pins true
        var legacy = mainSrc.match(/&& !isCheckboxValueAsState\(\$form\)\s*\n\s*&& !isCheckboxStateModelDeclared\(\$form\)/g);
        assert.ok(legacy && legacy.length === 2, 'the legacy conjunct must sit directly above the new one in both gates');
    });

    it('source pin: both messages name the third remedy', function () {
        assert.ok(mainSrc.indexOf('remove the `value` attribute (a boolean checkbox posts its live checked state either way)') > -1,
            'the tick warn must carry the measured payload-only remedy');
        var remedies = mainSrc.match(/declare the current model and silence migration warnings/g);
        assert.ok(remedies && remedies.length === 2, 'both warn directions must name the declaration remedy');
    });

    it('an explicit "false" declaration silences BOTH warn directions', function () {
        var $form = mkFormDeclared('false');
        assert.equal(replayWarnPass($form, mkCheckbox({ valueAttr: 'true' }), 'f1', {}), false,
            'tick direction must stay silent on a declared form');
        assert.equal(replayWarnPassUntick($form, mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true }), 'f2', {}), false,
            'un-tick direction must stay silent on a declared form');
    });

    it('ANY explicit declaration value counts — presence is the signal', function () {
        assert.equal(replayWarnPass(mkFormDeclared('banana'), mkCheckbox({ valueAttr: 'true' }), 'f1', {}), false);
        assert.equal(replayWarnPass(mkFormDeclared(''), mkCheckbox({ valueAttr: 'true' }), 'f2', {}), false,
            'an empty-string dataset value is still an explicit declaration');
        assert.equal(replayWarnPass(mkFormDeclared('true'), mkCheckbox({ valueAttr: 'true' }), 'f3', {}), false,
            'declared-true stays silent (via the legacy conjunct, as before)');
    });

    it('control: an UNDECLARED form still warns — the instrument can fire', function () {
        assert.equal(replayWarnPass(mkForm(false), mkCheckbox({ valueAttr: 'true' }), 'f1', {}), true);
        assert.equal(replayWarnPassUntick(mkForm(false), mkCheckbox({ valueAttr: 'false', checkedAttr: true, checked: true }), 'f2', {}), true);
    });

    it('subtract: the PRE-#B125 gate warns on the declared form — the conjunct is load-bearing', function () {
        assert.equal(replayWarnPassPreB125(mkFormDeclared('false'), mkCheckbox({ valueAttr: 'true' }), 'f1', {}), true,
            'without the declaration conjunct the false-positive fires, proving the fix does the silencing');
    });

    it('an explicit "false" is behavior-inert everywhere else (sole reader is /^true$/i)', function () {
        // measured 2026-07-20: isCheckboxValueAsState is the only reader of the
        // dataset flag; "false" and absent are indistinguishable to it
        assert.equal(isCheckboxValueAsState(mkFormDeclared('false')), false);
        assert.equal(isCheckboxValueAsState(mkForm(false)), false);
    });

    it('wire-matrix completion: the data-value-only shape posts live booleans and never warns', function () {
        // #B125 measurement lock: `data-value="true"` with NO value attribute is
        // boolean-classified (null value attr), posts .checked through BOTH
        // collectors, and the warn predicate (value-attr-only) stays silent.
        var $el = mkCheckbox({ dataValue: 'true' });
        assert.equal(isBooleanCheckbox($el, undefined), true, 'classified boolean via the null value attr');
        assert.equal(replayWarnPass(mkForm(false), $el, 'f1', {}), false, 'the warn never consults data-value');
        assert.strictEqual(replayCollect(mkCheckbox({ dataValue: 'true', checked: true }), {}).field, true);
        assert.strictEqual(replayCollect(mkCheckbox({ dataValue: 'true', checked: false }), {}).field, false);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ dataValue: 'true', checked: true }), {}).field, true);
        assert.strictEqual(replayInlineCollect(mkCheckbox({ dataValue: 'true', checked: false }), {}).field, false);
    });

    it('dist fidelity: the remedy text is in gina.js (rebuild guard, red before the prod rebuild)', function () {
        var DIST_DIR = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');
        var distSrc = fs.readFileSync(path.join(DIST_DIR, 'gina.js'), 'utf8');
        assert.ok(distSrc.indexOf('declare the current model and silence migration warnings') > -1,
            'rebuild dist after editing the validator src (prod build, 3 CI flags)');
        assert.ok(distSrc.indexOf('remove the `value` attribute (a boolean checkbox posts its live checked state either way)') > -1,
            'the tick remedy must ship in the unminified bundle');
    });

    it('dist fidelity: the remedy text is in gina.min.js (rebuild guard, red before the prod rebuild)', function () {
        var DIST_DIR = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');
        var distMin = fs.readFileSync(path.join(DIST_DIR, 'gina.min.js'), 'utf8');
        assert.ok(distMin.indexOf('declare the current model and silence migration warnings') > -1,
            'rebuild dist after editing the validator src (prod build, 3 CI flags)');
    });
});
