'use strict';
/**
 * FormValidator - the autofill signal, and the withheld-value carve-out (#B478)
 *
 * A browser autofill (saved credentials, an address) lands without any keystroke, and on
 * Chrome without an `input`/`change` either until a later user gesture. The live check had
 * nothing to react to: the submit trigger kept the gated look it was given at bind time
 * while the user looked at a completed form, and an autofilled INVALID value rendered no
 * error. Two halves:
 *
 *  - the SIGNAL: `autofill.scss` gives every autofilled control (`:autofill` /
 *    `:-webkit-autofill`) a 1ms keyframe named `gina-autofill-start`; the validator's new
 *    form-level `animationstart` proxy (`autofillProxyHandler`) routes that event into the
 *    control's own `change.<id>` live check when the value is readable;
 *  - the CARVE-OUT: Chrome keeps an autofilled value away from script until a trusted
 *    gesture (`.value` reads `''` while `:-webkit-autofill` matches - measured on Chrome 152).
 *    `isAutofillValueWithheld` names that state and `excludeWithheldAutofill` drops such
 *    fields from the LIVE-CHECK passes only (bind-time, live global, select global, the
 *    display-only reveal, and the new silent pass `revalidateSilently`), so the gate reflects
 *    what the user sees. The SUBMIT collectors stay strict: `isValid()` remains the send gate,
 *    so a value still withheld at click time fails `isRequired` there and never posts as `''`.
 *
 * Strategy:
 *  - 01 source pins on the wiring (registration sites, the keyframe-name gate, the
 *    withheld-before-dispatch order, exactly five wrapped live collectors, the untouched
 *    reset/submit collectors) - counted on a comment-stripped view, because the helpers'
 *    own JSDoc `@example` lines carry the call shape;
 *  - 02/03 the pure helpers and the proxy handler are EXTRACTED from the shipped source
 *    (line-anchored declaration, uniqueness- and balance-gated brace walk) and executed
 *    against jsdom - no replica. jsdom does not implement the autofill pseudo-classes and its
 *    `matches()` THROWS on them, which is the real "unsupported engine" path the helper's
 *    try/catch exists for; Chrome's withheld state is simulated by stubbing `matches`;
 *  - 04 the stylesheet contract (functional => un-layered; a non-empty keyframe, because
 *    csso 5.0.5 strips an empty `@keyframes` block - measured);
 *  - 05 dist fidelity (string literals survive Closure; the CSS hook sits OUTSIDE the
 *    `@layer gina` block; the intermediate css the build must produce).
 *
 * Real browser autofill cannot be produced by automation and never fires on a fresh CI
 * profile (no saved credentials), so the end-to-end claim is verified in the reporter's own
 * browser after pickup; `test/e2e/validator-autofill.spec.js` drives the same plumbing with
 * the served keyframe applied through a harness class.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var { JSDOM } = require('jsdom');

var FW = require('../fw');
require(path.join(FW, '..', '..', 'utils', 'prototypes')); // Object.prototype.count(), as the plugin expects

// Seams for a red-first run against PRE-fix bytes without touching the shared tree:
// GINA_VALIDATOR_MAIN=<git-show copy of main.js>, GINA_PLUGIN_DIST=<dir holding js/ + css/>.
var MAIN     = process.env.GINA_VALIDATOR_MAIN || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST     = process.env.GINA_PLUGIN_DIST    || path.join(FW, 'core/asset/plugin/dist/vendor/gina');
var SCSS     = path.join(FW, 'core/asset/plugin/src/vendor/gina/autofill/sass/autofill.scss');
var INTER    = path.join(FW, 'core/asset/plugin/src/vendor/gina/autofill/css/autofill.css');
var DIST_JS  = path.join(DIST, 'js/gina.min.js');
var DIST_RAW = path.join(DIST, 'js/gina.js');
var DIST_CSS = path.join(DIST, 'css/gina.min.css');

var src, active, scss;
before(function () {
    src    = fs.readFileSync(MAIN, 'utf8');
    // comment-stripped view: call-shape pins must not count JSDoc @example lines
    active = src.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l); }).join('\n');
    scss   = fs.readFileSync(SCSS, 'utf8');
});

/**
 * Extract `var <name> = function(...) {...}` from the shipped source: line-anchored
 * declaration (the file's own `// EO` markers never match a line start), uniqueness-gated,
 * started-flag brace walk, balance-gated. Every helper extracted here has no brace inside a
 * string or regex literal (checked by reading them), which the naive walker requires.
 */
function extractFn(source, name) {
    var re = new RegExp('^[ \\t]*var ' + name + ' = function\\(', 'mg');
    var m  = re.exec(source);
    assert.ok(m, 'declaration of ' + name + ' not found');
    assert.equal(re.exec(source), null, 'declaration of ' + name + ' is not unique');
    var start = source.indexOf('function', m.index);
    var i = start, depth = 0, started = false;
    for (; i < source.length; i++) {
        var c = source[i];
        if (c === '{') { depth++; started = true; }
        else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
    }
    assert.ok(started && depth === 0, 'unbalanced braces extracting ' + name);
    return source.substring(start, i);
}
/** Instantiate an extracted function with its free variables injected by name. */
function build(fnSrc, argNames, argValues) {
    var factory = new Function(argNames.join(','), 'return (' + fnSrc + ');');
    return factory.apply(null, argValues);
}
function count(text, needle) {
    var n = 0, i = -1;
    while ((i = text.indexOf(needle, i + 1)) > -1) { n++; }
    return n;
}

describe('01 - wiring pins', function () {
    it('the animationstart proxy is registered form-level, once, after the click proxy', function () {
        var reg = "addListener(gina, $target, 'animationstart', autofillProxyHandler)";
        assert.equal(count(active, reg), 1);
        var click = "addListener(gina, $target, 'click', clickProxyHandler)";
        assert.ok(active.indexOf(click) > -1 && active.indexOf(click) < active.indexOf(reg), 'registered after the click proxy');
    });
    it('reassociated controls get the same proxy, tracked for unbind', function () {
        assert.equal(count(active, "addListener(gina, $rEl, 'animationstart', autofillProxyHandler)"), 1);
        assert.equal(count(active, "{ el: $rEl, evt: 'animationstart', fn: autofillProxyHandler }"), 1);
    });
    it('the handler gates on the keyframe name the stylesheet declares', function () {
        var handler = extractFn(src, 'autofillProxyHandler');
        assert.ok(handler.indexOf("event.animationName !== 'gina-autofill-start'") > -1, 'name gate');
        assert.match(scss, /@keyframes\s+gina-autofill-start\s*\{/, 'the stylesheet declares that keyframe');
    });
    it('withheld is decided BEFORE the dispatch, and the withheld branch returns', function () {
        var handler = extractFn(src, 'autofillProxyHandler');
        var w = handler.indexOf('isAutofillValueWithheld($el)');
        var t = handler.indexOf('triggerEvent(gina, $el, _evt, event.detail)');
        assert.ok(w > -1 && t > -1 && w < t, 'withheld check precedes the dispatch');
        assert.match(handler, /isAutofillValueWithheld\(\$el\)\s*\)\s*\{\s*revalidateSilently\([\s\S]{0,120}?\);\s*return;/);
    });
    it('exactly five live-check collectors are narrowed (bind, live global, select global, reveal, silent)', function () {
        assert.equal((active.match(/excludeWithheldAutofill\(getFormValidationInfos\(/g) || []).length, 5);
    });
    it('the reset-mode and submit collectors are NOT narrowed (the strict send gate stays)', function () {
        assert.equal(count(active, 'excludeWithheldAutofill(getFormValidationInfos($form.target, $form.rules, true)'), 0);
        assert.ok(count(active, 'getFormValidationInfos($form.target, $form.rules, true)') >= 1, 'control: the reset-mode call exists un-narrowed');
        // every other call is a plain, un-narrowed collection: definition + narrowed + plain
        var all = (active.match(/getFormValidationInfos\(/g) || []).length;
        assert.ok(all - 1 - 5 >= 2, 'at least the reset-mode and a submit-path collector stay plain, got ' + all);
    });
    it('the withheld predicate is text-like only and needs BOTH an empty value and the autofill state', function () {
        var fn = extractFn(src, 'isAutofillValueWithheld');
        assert.ok(fn.indexOf('/^(radio|checkbox|file)$/i.test($el.type)') > -1);
        assert.ok(fn.indexOf("$el.value === '' && matchesAutofill($el)") > -1);
    });
    it('matchesAutofill tries each pseudo-class under its own try/catch', function () {
        var fn = extractFn(src, 'matchesAutofill');
        assert.ok(fn.indexOf("[':autofill', ':-webkit-autofill']") > -1);
        assert.match(fn, /for\s*\([^)]*\)\s*\{\s*try\s*\{/);
    });
    it('revalidateSilently narrows, validates and re-syncs the trigger without rendering', function () {
        var fn = extractFn(src, 'revalidateSilently');
        assert.ok(fn.indexOf('excludeWithheldAutofill(getFormValidationInfos($formInstance.target, $formInstance.rules))') > -1);
        assert.ok(fn.indexOf('updateSubmitTriggerState($formInstance, result.isValid())') > -1);
        assert.equal(fn.indexOf('handleErrorsDisplay'), -1, 'display-free by construction');
    });
});

describe('02 - the helpers, executed from the shipped bytes against jsdom', function () {
    var dom, doc, u, p, c, matchesAutofill, isAutofillValueWithheld, excludeWithheldAutofill;
    before(function () {
        dom = new JSDOM('<!doctype html><html><body><form id="f">' +
            '<input id="u" name="u" type="text"><input id="p" name="p" type="password">' +
            '<input id="c" name="c" type="checkbox"></form></body></html>');
        doc = dom.window.document;
        u = doc.getElementById('u'); p = doc.getElementById('p'); c = doc.getElementById('c');
        matchesAutofill         = build(extractFn(src, 'matchesAutofill'), [], []);
        isAutofillValueWithheld = build(extractFn(src, 'isAutofillValueWithheld'), ['matchesAutofill'], [matchesAutofill]);
        excludeWithheldAutofill = build(extractFn(src, 'excludeWithheldAutofill'), ['isAutofillValueWithheld'], [isAutofillValueWithheld]);
    });
    it('an engine that knows the pseudo-classes but has no autofill reports false (jsdom returns false, no throw)', function () {
        assert.equal(u.matches(':autofill'), false);
        assert.equal(matchesAutofill(u), false);
    });
    it('an engine that THROWS on both selectors is survived: false, no throw (the try/catch is load-bearing)', function () {
        var thrown = 0;
        u.matches = function () { thrown++; throw new SyntaxError('unknown pseudo-class'); };
        assert.equal(matchesAutofill(u), false);
        assert.equal(thrown, 2, 'both selectors were tried');
        delete u.matches;
        assert.equal(matchesAutofill(null), false);
        assert.equal(matchesAutofill({}), false);
    });
    it('withheld = autofill state AND an empty value (Chrome before the gesture)', function () {
        u.matches = function (sel) { return sel === ':-webkit-autofill'; };
        u.value = '';
        assert.equal(matchesAutofill(u), true);
        assert.equal(isAutofillValueWithheld(u), true);
        u.value = 'released';
        assert.equal(isAutofillValueWithheld(u), false, 'a released value is adjudicated normally');
        delete u.matches;
    });
    it('a checkbox never withholds, even in the autofill state', function () {
        c.matches = function () { return true; };
        assert.equal(isAutofillValueWithheld(c), false);
        delete c.matches;
        assert.equal(isAutofillValueWithheld(null), false);
    });
    it('excludeWithheldAutofill drops the withheld field from BOTH maps and recomputes _length', function () {
        u.matches = function (sel) { return sel === ':-webkit-autofill'; };
        u.value = ''; p.value = 'secret';
        var info = { fields: { u: '', p: 'secret', c: false, _length: 3 }, $fields: { u: u, p: p, c: c }, rules: {} };
        var out = excludeWithheldAutofill(info);
        assert.equal(out, info, 'mutated in place, same object returned');
        assert.equal('u' in out.fields, false);
        assert.equal('u' in out.$fields, false);
        assert.equal(out.fields.p, 'secret');
        assert.equal(out.$fields.p, p);
        assert.equal(out.fields._length, 2);
        delete u.matches;
    });
    it('no-ops: nothing withheld leaves the maps and _length untouched; a missing shape is returned as-is', function () {
        var info = { fields: { p: 'secret', _length: 99 }, $fields: { p: p } };
        var out = excludeWithheldAutofill(info);
        assert.equal(out.fields._length, 99);
        assert.equal(out.fields.p, 'secret');
        assert.equal(excludeWithheldAutofill(null), null);
        assert.deepEqual(excludeWithheldAutofill({}), {});
    });
});

describe('03 - the proxy handler, executed from the shipped bytes', function () {
    var dom, doc, u, orphan, calls, gina, instance, handler, withheld;
    before(function () {
        dom = new JSDOM('<!doctype html><html><body><form id="f"><input id="u" name="u" type="text"></form>' +
            '<input id="orphan" type="text"></body></html>');
        doc = dom.window.document;
        u = doc.getElementById('u'); orphan = doc.getElementById('orphan');
        gina     = { events: {} };
        instance = { $forms: { f: { id: 'f', target: doc.getElementById('f') } } };
        withheld = false;
        calls    = { trigger: [], silent: [] };
        handler  = build(extractFn(src, 'autofillProxyHandler'),
            ['gina', 'instance', 'triggerEvent', 'isAutofillValueWithheld', 'revalidateSilently'],
            [gina, instance,
             function (g, el, evt, detail) { calls.trigger.push({ el: el, evt: evt, detail: detail }); },
             function () { return withheld; },
             function (rec) { calls.silent.push(rec); }]);
    });
    function reset() { calls.trigger.length = 0; calls.silent.length = 0; }
    it('a keyframe of another name is ignored', function () {
        reset(); gina.events['change.u'] = 'u';
        handler({ animationName: 'af-other-start', target: u });
        assert.equal(calls.trigger.length + calls.silent.length, 0);
    });
    it('a control the live check never registered is ignored', function () {
        reset(); delete gina.events['change.u'];
        handler({ animationName: 'gina-autofill-start', target: u });
        assert.equal(calls.trigger.length + calls.silent.length, 0);
    });
    it('a form-less control is ignored', function () {
        reset(); gina.events['change.orphan'] = 'orphan';
        handler({ animationName: 'gina-autofill-start', target: orphan });
        assert.equal(calls.trigger.length + calls.silent.length, 0);
    });
    it('readable value: the control\'s own change.<id> live check is dispatched, nothing silent', function () {
        reset(); gina.events['change.u'] = 'u'; withheld = false;
        handler({ animationName: 'gina-autofill-start', target: u, detail: 'd' });
        assert.equal(calls.trigger.length, 1);
        assert.equal(calls.trigger[0].el, u);
        assert.equal(calls.trigger[0].evt, 'change.u');
        assert.equal(calls.trigger[0].detail, 'd');
        assert.equal(calls.silent.length, 0);
    });
    it('withheld value: the gate is re-derived silently for the owning form, nothing dispatched', function () {
        reset(); gina.events['change.u'] = 'u'; withheld = true;
        handler({ animationName: 'gina-autofill-start', target: u });
        assert.equal(calls.silent.length, 1);
        assert.equal(calls.silent[0], instance.$forms.f);
        assert.equal(calls.trigger.length, 0);
    });
});

describe('04 - the stylesheet contract', function () {
    it('lives under a vendor dir whose name matches its basename (the build concatenates only that)', function () {
        assert.equal(path.basename(SCSS, '.scss'), path.basename(path.dirname(path.dirname(SCSS))));
    });
    it('is FUNCTIONAL, so un-layered: no @layer in the CODE (the header comment names the layer it stays out of)', function () {
        var code = scss.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal(code.indexOf('@layer'), -1);
        assert.ok(scss.indexOf('@layer') > -1, 'control: the raw text does name it, so the strip above is what makes this pin honest');
    });
    it('the keyframe is not empty (csso 5.0.5 strips an empty @keyframes block - measured)', function () {
        assert.match(scss, /@keyframes\s+gina-autofill-start\s*\{[\s\S]*?outline-offset[\s\S]*?\}\s*\}/);
    });
    it('one rule per pseudo-class, never merged into one selector list', function () {
        assert.equal((scss.match(/animation-name:\s*gina-autofill-start/g) || []).length, 2);
        assert.match(scss, /^input:-webkit-autofill,/m);
        assert.match(scss, /^input:autofill,/m);
        assert.doesNotMatch(scss, /:-webkit-autofill[^{]*:autofill\b|:autofill\b[^{]*:-webkit-autofill/);
    });
    it('stays ASCII (a non-ASCII byte would emit a mid-file @charset into the concatenated bundle)', function () {
        assert.doesNotMatch(scss, /[^\x00-\x7f]/);
    });
});

describe('05 - dist fidelity', function () {
    var minjs, rawjs, css, layerBlock, outsideLayer;
    before(function () {
        minjs = fs.readFileSync(DIST_JS, 'utf8');
        rawjs = fs.readFileSync(DIST_RAW, 'utf8');
        css   = fs.readFileSync(DIST_CSS, 'utf8');
        var i = css.indexOf('@layer gina{');
        assert.ok(i > -1, 'gina.min.css carries the @layer gina block');
        var start = css.indexOf('{', i), depth = 0, end = -1;
        for (var k = start; k < css.length; k++) {
            if (css[k] === '{') depth++;
            else if (css[k] === '}' && --depth === 0) { end = k; break; }
        }
        assert.ok(end > -1, 'the @layer gina block is brace-balanced');
        layerBlock   = css.slice(start, end + 1);
        outsideLayer = css.slice(0, i) + css.slice(end + 1);
    });
    it('the intermediate autofill.css the build produces exists and carries the keyframe', function () {
        assert.ok(fs.existsSync(INTER), INTER + ' must be produced by the build (tracked like popin\'s)');
        assert.ok(fs.readFileSync(INTER, 'utf8').indexOf('gina-autofill-start') > -1);
    });
    it('gina.min.css declares the keyframe exactly once, OUTSIDE the gina layer', function () {
        assert.equal((css.match(/@keyframes gina-autofill-start\{/g) || []).length, 1);
        assert.equal(layerBlock.indexOf('gina-autofill-start'), -1, 'never inside @layer gina (a project reset must not beat it)');
        assert.ok(outsideLayer.indexOf('@keyframes gina-autofill-start{') > -1);
    });
    it('gina.min.css keeps both pseudo-class rules (csso may reorder a selector list, never merge across rules)', function () {
        assert.ok(css.indexOf('input:-webkit-autofill') > -1);
        assert.ok(css.indexOf('input:autofill') > -1);
        assert.equal((outsideLayer.match(/animation-name:gina-autofill-start/g) || []).length, 2);
    });
    it('gina.min.js carries the proxy: the animationstart registration, the keyframe-name gate and both selectors survive Closure', function () {
        assert.match(minjs, /['"]animationstart['"]/);
        assert.equal((minjs.match(/gina-autofill-start/g) || []).length, 1, 'the name gate literal, exactly once');
        assert.match(minjs, /\[['"]:autofill['"],\s*['"]:-webkit-autofill['"]\]/);
    });
    it('gina.js (unminified) carries the #B478 rationale, gina.min.js does not (Closure strips comments)', function () {
        assert.ok(count(rawjs, '#B478') >= 5, 'rationale comments propagate to the unminified bundle');
        assert.equal(minjs.indexOf('#B478'), -1);
    });
});
