'use strict';
/**
 * FormValidator - the honest label for a withheld browser autofill at submit time (#B341)
 *
 * Since #B478 a control the browser autofilled but still withholds from script (Chrome,
 * until a trusted gesture: `:autofill` matches while `.value` reads '') is kept OUT of the
 * live checks, but the submit collectors stay strict on purpose: `isValid()` is the send
 * gate and an empty credential must never be posted. So at submit such a field fails
 * `isRequired` - correctly - and rendered the plain required label, which names a problem
 * the user cannot see on a visibly filled control.
 *
 * The fix, all in the engine's `isRequired` (form-validator.js):
 *  - the message is composed from a new built-in label key, `isRequiredAutofill`, when
 *    the plugin's single definition of the state (`gina.validator.isAutofillValueWithheld`,
 *    exported for this purpose) reports the control withheld; the verdict, the errors key
 *    (`isRequired`) and the gate are untouched;
 *  - `_labelAliasFill` copies an app-supplied `isRequired` onto `isRequiredAutofill` when
 *    the app did not translate the latter, so a localized catalog never mixes languages;
 *  - the control is marked `data-gina-form-autofill-withheld="true"` while in that state
 *    and cleared on the next adjudication (a styling hook, and the locale-agnostic signal
 *    the e2e keys on instead of an English string).
 *
 * Strategy:
 *  - 01 source pins on the engine + the plugin export;
 *  - 02 `isRequired`, `replace`, `_labelAliasFill` and the two #B341 helpers EXTRACTED from
 *    the shipped engine bytes and executed against jsdom fields (no replica); the plugin
 *    predicate is a stub so each arm controls the withheld state;
 *  - 03 the real engine under node (server path, always the in-tree file): the honest
 *    branch is browser-only, so the plain label renders there - the control that the
 *    change does not leak server-side;
 *  - 04 dist fidelity.
 *
 * Seams for a red-first run against PRE-fix bytes without touching the shared tree:
 * GINA_FORM_VALIDATOR=<engine file>, GINA_VALIDATOR_MAIN=<plugin main.js>,
 * GINA_PLUGIN_DIST=<dir holding js/>. Section 03 deliberately ignores the engine seam
 * (the engine's relative requires only resolve in-tree).
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var { JSDOM } = require('jsdom');

var FW = require('../fw');
require(path.join(FW, '..', '..', 'utils', 'prototypes')); // Object.prototype.count(), as the engine expects

var ENGINE_IN_TREE = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var ENGINE   = process.env.GINA_FORM_VALIDATOR || ENGINE_IN_TREE;
var MAIN     = process.env.GINA_VALIDATOR_MAIN || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST     = process.env.GINA_PLUGIN_DIST    || path.join(FW, 'core/asset/plugin/dist/vendor/gina');
var DIST_JS  = path.join(DIST, 'js/gina.min.js');
var DIST_RAW = path.join(DIST, 'js/gina.js');

var LABEL_KEY = 'isRequiredAutofill';
var MARKER    = 'ginaFormAutofillWithheld'; // dataset form of data-gina-form-autofill-withheld

var src, active, mainSrc, mainActive;
before(function () {
    src        = fs.readFileSync(ENGINE, 'utf8');
    active     = stripComments(src);
    mainSrc    = fs.readFileSync(MAIN, 'utf8');
    mainActive = stripComments(mainSrc);
});

/** Lines that are not `//` / JSDoc comment lines (the pins must not count rationale). */
function stripComments(text) {
    return text.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l); }).join('\n');
}
function count(text, needle) {
    var n = 0, i = -1;
    while ((i = text.indexOf(needle, i + 1)) > -1) { n++; }
    return n;
}
/** Brace walk from the `function` keyword at `start`; balance-gated. */
function walkFunction(source, start) {
    var i = start, depth = 0, started = false;
    for (; i < source.length; i++) {
        var c = source[i];
        if (c === '{') { depth++; started = true; }
        else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
    }
    assert.ok(started && depth === 0, 'unbalanced braces from offset ' + start);
    return source.substring(start, i);
}
/** `var <name> = function(` - line-anchored, uniqueness-gated (the #B478 extractor). */
function extractVarFn(source, name) {
    var re = new RegExp('^[ \\t]*var ' + name + ' = function\\(', 'mg');
    var m  = re.exec(source);
    assert.ok(m, 'declaration of ' + name + ' not found');
    assert.equal(re.exec(source), null, 'declaration of ' + name + ' is not unique');
    return walkFunction(source, source.indexOf('function', m.index));
}
/** `<lhs> = function(` for a property-assigned method (the rule methods). */
function extractAssignedFn(source, lhs) {
    var needle = lhs + ' = function(';
    var idx = source.indexOf(needle);
    assert.ok(idx > -1, 'assignment ' + needle + ' not found');
    assert.equal(source.indexOf(needle, idx + 1), -1, 'assignment ' + needle + ' is not unique');
    return walkFunction(source, source.indexOf('function', idx));
}
/** The `_defaultErrorLabels` object literal, evaluated from the shipped bytes. */
function extractDefaults(source) {
    var s = source.indexOf('var _defaultErrorLabels = {');
    assert.ok(s > -1, '_defaultErrorLabels not found');
    var start = source.indexOf('{', s);
    var i = start, depth = 0;
    for (; i < source.length; i++) {
        var c = source[i];
        if (c === '{') { depth++; }
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return new Function('return (' + source.substring(start, i) + ');')();
}
/** Instantiate an extracted function with its free variables injected by name. */
function build(fnSrc, argNames, argValues) {
    var factory = new Function(argNames.join(','), 'return (' + fnSrc + ');');
    return factory.apply(null, argValues);
}
/** The engine's `local` state, as the constructor seeds it (labels = a fresh map). */
function localState(labels) {
    return { errors: {}, keys: { '%l': 'label', '%n': 'name', '%s': 'size' }, errorLabels: labels, data: {}, excluded: [] };
}

// ---------------------------------------------------------------------------
describe('01 - source pins', function () {
    it('the engine declares the isRequiredAutofill default BEFORE isInList (the drift census slices the block there)', function () {
        var block = src.indexOf('var _defaultErrorLabels = {');
        var key   = src.indexOf("'" + LABEL_KEY + "':", block);
        var last  = src.indexOf("'isInList': 'Must be one of: %s'", block);
        assert.ok(key > block, 'no default for ' + LABEL_KEY);
        assert.ok(key < last, LABEL_KEY + ' must sit before the isInList line');
    });
    it('the alias map fills isRequiredAutofill from an app-supplied isRequired', function () {
        var a = src.indexOf('var aliasMap = {');
        var z = src.indexOf('};', a);
        assert.match(src.substring(a, z), /'isRequiredAutofill'\s*:\s*'isRequired'/);
    });
    it('isRequired consults the honest key at exactly one threaded call site, and keeps the plain one', function () {
        assert.equal(count(active, "local.errorLabels['" + LABEL_KEY + "'], this, '" + LABEL_KEY + "')"), 1);
        assert.equal(count(active, "local.errorLabels['isRequired'], this, 'isRequired')"), 1);
    });
    it('the honest branch is decided by the plugin predicate, guarded on context and presence', function () {
        var fn = extractVarFn(src, '_isWithheldAutofill');
        assert.ok(fn.indexOf('!isGFFCtx') > -1, 'browser-only');
        assert.ok(fn.indexOf("typeof(gina.validator.isAutofillValueWithheld) != 'function'") > -1, 'presence-guarded');
        assert.ok(fn.indexOf('gina.validator.isAutofillValueWithheld(field.target)') > -1, 'delegates to the plugin definition');
        var req = extractAssignedFn(src, "self[el]['isRequired']");
        assert.ok(req.indexOf('_isWithheldAutofill(this)') > -1, 'isRequired consults the predicate');
    });
    it('the marker is set on the honest branch and cleared by the other adjudications', function () {
        var req = extractAssignedFn(active, "self[el]['isRequired']");
        assert.equal(count(req, "dataset." + MARKER + " = 'true'"), 1);
        assert.equal(count(req, '_clearWithheldAutofill(this)'), 2, 'cleared on the plain-empty branch and on the valid branch');
        var clear = extractVarFn(src, '_clearWithheldAutofill');
        assert.ok(clear.indexOf('delete field.target.dataset.' + MARKER) > -1);
    });
    it('the plugin exports its withheld predicate on the instance for the engine', function () {
        assert.match(mainActive, /instance\.isAutofillValueWithheld\s*=\s*isAutofillValueWithheld;/);
    });
});

// ---------------------------------------------------------------------------
describe('02 - isRequired executed from the shipped engine bytes against jsdom', function () {
    var dom, doc, defaults, warns;
    /** One arm's world: a local state, a predicate stub, the extracted functions, one field. */
    function world(opts) {
        opts = opts || {};
        var labels  = Object.assign({}, defaults, opts.labels || {});
        var local   = localState(labels);
        var gina    = ('gina' in opts) ? opts.gina : { validator: { isAutofillValueWithheld: function () { return !!opts.withheld; } } };
        var console_ = { warn: function (m) { warns.push(m); } };
        var ctx     = ('isGFFCtx' in opts) ? opts.isGFFCtx : true;
        var replace = build(extractVarFn(src, 'replace'), ['local', '_defaultErrorLabels', '_labelWarnings', 'console'], [local, defaults, {}, console_]);
        var isW     = build(extractVarFn(src, '_isWithheldAutofill'),  ['isGFFCtx', 'gina'], [ctx, gina]);
        var clearW  = build(extractVarFn(src, '_clearWithheldAutofill'), ['isGFFCtx'], [ctx]);
        var self    = {};
        var el      = doc.getElementById('p');
        el.value    = ('value' in opts) ? opts.value : '';
        delete el.dataset[MARKER];
        if (opts.staleMarker) { el.dataset[MARKER] = 'true'; }
        var field   = { name: 'p', value: el.value, target: el, valid: false, label: null, exclude: false };
        if (opts.error) { field.error = opts.error; }
        self.p = field;
        var isRequired = build(extractAssignedFn(src, "self[el]['isRequired']"),
            ['isGFFCtx', 'self', 'local', 'document', 'replace', '_isWithheldAutofill', '_clearWithheldAutofill'],
            [ctx, self, local, doc, replace, isW, clearW]);
        return { field: field, el: el, local: local, run: function () { return isRequired.call(field); } };
    }
    before(function () {
        dom = new JSDOM('<!doctype html><html><body><form id="f"><input id="p" name="p" type="password"></form></body></html>');
        doc = dom.window.document;
        defaults = extractDefaults(src);
        assert.equal(typeof defaults[LABEL_KEY], 'string', 'the shipped defaults carry the honest label');
        assert.notEqual(defaults[LABEL_KEY], defaults.isRequired, 'the honest label differs from the plain one');
    });
    it('withheld + empty: the honest label, under the UNCHANGED errors key, verdict invalid, marker set', function () {
        warns = [];
        var w = world({ withheld: true });
        var r = w.run();
        assert.equal(r, w.field, 'chains: returns the field');
        assert.equal(w.field.valid, false);
        assert.deepEqual(Object.keys(w.field.errors), ['isRequired'], 'the errors key stays isRequired');
        assert.equal(w.field.errors.isRequired, defaults[LABEL_KEY]);
        assert.equal(w.el.dataset[MARKER], 'true');
        assert.equal(warns.length, 0);
    });
    it('readable + empty: the plain label; a stale marker is cleared', function () {
        var w = world({ withheld: false, staleMarker: true });
        w.run();
        assert.equal(w.field.valid, false);
        assert.equal(w.field.errors.isRequired, defaults.isRequired);
        assert.equal(typeof w.el.dataset[MARKER], 'undefined');
    });
    it('a released (readable, non-empty) value: valid, no error, marker cleared', function () {
        var w = world({ withheld: true, value: 'hunter2', staleMarker: true });
        w.run();
        assert.equal(w.field.valid, true);
        assert.equal(typeof w.field.errors, 'undefined');
        assert.equal(typeof w.el.dataset[MARKER], 'undefined');
    });
    it('a per-field error message still wins on the honest branch', function () {
        var w = world({ withheld: true, error: 'Custom, per field' });
        w.run();
        assert.equal(w.field.errors.isRequired, 'Custom, per field');
        assert.equal(w.el.dataset[MARKER], 'true', 'the state is still exposed');
    });
    it('the honest label goes through replace(): placeholders are substituted', function () {
        var labels = {}; labels[LABEL_KEY] = 'Your browser filled %n';
        var w = world({ withheld: true, labels: labels });
        w.run();
        assert.equal(w.field.errors.isRequired, 'Your browser filled p');
    });
    it('no plugin (a standalone engine, or the server): the plain label, no marker', function () {
        var w1 = world({ gina: undefined });
        w1.run();
        assert.equal(w1.field.errors.isRequired, defaults.isRequired);
        assert.equal(typeof w1.el.dataset[MARKER], 'undefined');
        var w2 = world({ gina: { validator: {} } });
        w2.run();
        assert.equal(w2.field.errors.isRequired, defaults.isRequired);
    });
    it('outside the browser context the predicate is never consulted, even with a willing plugin', function () {
        var w = world({ withheld: true, isGFFCtx: false, staleMarker: true });
        w.run();
        assert.equal(w.field.errors.isRequired, defaults.isRequired);
        assert.equal(w.el.dataset[MARKER], 'true', 'server-shaped runs never touch the DOM marker either way');
    });
    it('alias fill: a translated isRequired covers isRequiredAutofill; a supplied specific key wins', function () {
        var fill = build(extractVarFn(src, '_labelAliasFill'), [], []);
        assert.equal(fill({ isRequired: 'Obligatoire' })[LABEL_KEY], 'Obligatoire');
        var both = {}; both.isRequired = 'Obligatoire'; both[LABEL_KEY] = 'Rempli par le navigateur';
        assert.equal(fill(both)[LABEL_KEY], 'Rempli par le navigateur');
        assert.equal(LABEL_KEY in fill({}), false, 'nothing to copy from');
        assert.equal(fill({ isEmail: 'x' })[LABEL_KEY], undefined);
    });
    it('the honest branch through an alias-filled app catalog renders the app label (no language mix)', function () {
        var fill = build(extractVarFn(src, '_labelAliasFill'), [], []);
        var w = world({ withheld: true, labels: fill({ isRequired: 'Obligatoire' }) });
        w.run();
        assert.equal(w.field.errors.isRequired, 'Obligatoire');
    });
    it('a non-string honest label fail-softs to its English default and warns once', function () {
        warns = [];
        var labels = {}; labels[LABEL_KEY] = 42;
        var w = world({ withheld: true, labels: labels });
        w.run();
        assert.equal(w.field.errors.isRequired, defaults[LABEL_KEY]);
        assert.equal(warns.length, 1);
        assert.ok(warns[0].indexOf(LABEL_KEY) > -1);
    });
});

// ---------------------------------------------------------------------------
describe('03 - the real engine under node (server path): the change does not leak', function () {
    var FormValidator, defaults;
    before(function () {
        require(path.join(FW, 'helpers'));
        if (typeof getContext('gina') === 'undefined') { setContext('gina', {}); }
        FormValidator = require(ENGINE_IN_TREE);
        defaults = extractDefaults(fs.readFileSync(ENGINE_IN_TREE, 'utf8'));
    });
    it('an empty required field records the PLAIN label server-side (no browser, no plugin)', function () {
        var data = { p: '' };
        var f = new FormValidator(data).p.isRequired();
        assert.equal(f.valid, false);
        assert.equal(f.errors.isRequired, defaults.isRequired);
        assert.equal(typeof global.gina, 'undefined', 'control: no plugin global was leaked by this suite');
    });
    it('a filled required field stays valid', function () {
        var f = new FormValidator({ p: 'x' }).p.isRequired();
        assert.equal(f.valid, true);
        assert.equal(typeof f.errors, 'undefined');
    });
});

// ---------------------------------------------------------------------------
describe('04 - dist fidelity', function () {
    var min, raw;
    before(function () {
        min = fs.readFileSync(DIST_JS, 'utf8');
        raw = fs.readFileSync(DIST_RAW, 'utf8');
    });
    it('gina.min.js carries the honest label key at its three sites (default, alias, consult)', function () {
        assert.ok(count(min, LABEL_KEY) >= 3, 'got ' + count(min, LABEL_KEY));
        assert.ok(min.indexOf('Filled in by your browser') > -1, 'the English default survives Closure');
    });
    it('gina.min.js carries the marker property name (set + delete) and the plugin export', function () {
        assert.ok(count(min, MARKER) >= 2, 'got ' + count(min, MARKER));
        assert.match(min, /\.isAutofillValueWithheld\s*=\s*[\w$]+/, 'the instance export');
        assert.match(min, /\.isAutofillValueWithheld\(/, 'the engine consult');
    });
    it('gina.js (unminified) carries the #B341 rationale, gina.min.js does not (Closure strips comments)', function () {
        assert.ok(raw.indexOf('#B341') > -1);
        assert.equal(min.indexOf('#B341'), -1);
    });
});
