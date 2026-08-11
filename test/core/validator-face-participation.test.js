/**
 * Form-associated custom element (FACE) participation in FormValidator — #CC2
 *
 * A form-associated custom element (`static formAssociated = true` + `attachInternals()`)
 * joins the form's control collection, so value harvest, validation, serialization and
 * error render — all name-keyed and tag-agnostic — already cover it at submit time. The
 * only gap was the BIND layer, which enumerated controls per native tag:
 *   - `getOwnedElements($form, tag)` matches `$el.tagName === tagUpper` (a single native
 *     tag), so a hyphenated custom tag was never collected;
 *   - `registerForLiveChecking` gated on `/^(input|textarea)$/i.test($el.tagName)`, so a
 *     FACE got no live-check, no auto-id, no dirty tracking.
 *
 * The fix widens the bind layer only (four edits, no change to harvest/validate/serialize/
 * error-render/proxy-attach):
 *   1. a `getOwnedFaces($form)` helper collects hyphenated members of `form.elements`
 *      (the only hyphenated members it can hold ARE form-associated custom elements);
 *   2. `$faces = getOwnedFaces($target)` joins the bind collection block;
 *   3. a `$faces` binding loop adds auto-id (`'face.'+uuid()`), dirty tracking
 *      (`fieldsSet`) and live-check;
 *   4. `registerForLiveChecking` detects a custom tag (`isCustomEl`), widens its gate,
 *      SKIPS the HTMLInputElement value-setter interception (setObserver) for custom tags
 *      — a FACE exposes its own `.value` accessor — and routes `addLiveForInput` with
 *      `isOtherTagAllowed = isCustomEl` so a FACE (no input `type`) enters the live-check
 *      body. Its composed bubbling `change` rides the existing form-level / reassociated
 *      change proxy; no `input`-event wiring is added (change-only, per the author contract).
 *
 * Coverage: source pins on the four fix sites; a real-bytes extract+eval running the
 * SHIPPED `getOwnedFaces` against mock forms (+ a SUBTRACT modelling the pre-fix
 * native-tag-only collection); pure-logic replicas of the gate / setObserver-skip /
 * addLiveForInput routing decisions (+ SUBTRACTs reproducing the pre-fix exclusion); and
 * dist-fidelity pins (red before the rebuild, green after).
 *
 * Usage: node --test test/core/validator-face-participation.test.js
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var MAIN_SRC_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_JS       = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_JS   = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var mainSrc = fs.readFileSync(MAIN_SRC_PATH, 'utf8');

// getOwnedFaces helper + the $faces collection line, bounded BEFORE the native binding
// loops (the textarea/input loops share the same fieldsSet / registerForLiveChecking
// shape, so a broad slice would risk matching them instead of the FACE code).
var bindSlice = (function () {
    var start = mainSrc.indexOf('var getOwnedFaces = function');
    var end   = mainSrc.indexOf('// BO Binding textarea', start);
    assert.ok(start > -1 && end > start, 'getOwnedFaces / collection region not isolatable');
    return mainSrc.substring(start, end);
})();

// the $faces binding loop, tightly bounded by its own BO/EO markers so its pins target
// the FACE loop specifically, never the native textarea/input loops above/below it.
var facesLoopSlice = (function () {
    var start = mainSrc.indexOf('// BO Binding form-associated custom elements (FACE)');
    var end   = mainSrc.indexOf('// EO Binding form-associated custom elements (FACE)', start);
    assert.ok(start > -1 && end > start, '$faces binding loop not isolatable');
    return mainSrc.substring(start, end);
})();

// registerForLiveChecking, isolated (its gate / setObserver-skip / routing pins).
var rlcSlice = (function () {
    var start = mainSrc.indexOf('var registerForLiveChecking = function');
    var end   = mainSrc.indexOf('gina.events[\'registered.\' + $el.id] = $el.id;', start);
    assert.ok(start > -1 && end > start, 'registerForLiveChecking not isolatable');
    return mainSrc.substring(start, end);
})();

// ---------------------------------------------------------------------------
// real-bytes extraction: eval the ACTUAL shipped getOwnedFaces (a pure function of
// $form.elements) and run it, so the behavioural assertions exercise the shipped code.
// ---------------------------------------------------------------------------
function extractFn(src, name) {
    return (function () {
        var __fn;
        eval(src + '\n__fn = ' + name + ';');   // eslint-disable-line no-eval
        return __fn;
    })();
}

var getOwnedFacesSrc = (function () {
    var start = mainSrc.indexOf('var getOwnedFaces = function');
    var end   = mainSrc.indexOf('};', start) + 2;   // the function body has no nested `};`
    assert.ok(start > -1 && end > start, 'getOwnedFaces source not isolatable');
    var src = mainSrc.substring(start, end);
    assert.ok(/getOwnedFaces/.test(src) && /return arr/.test(src), 'extracted src looks wrong');
    return src;
})();
var getOwnedFaces = extractFn(getOwnedFacesSrc, 'getOwnedFaces');

// DOM-less mocks: a control collection is just an array; each member exposes `tagName`.
function mkEl(tag, extra) { return Object.assign({ tagName: tag.toUpperCase() }, extra || {}); }
function mkForm(els) { return { elements: els }; }

describe('#CC2 FACE participation — source pins (four fix sites)', function () {

    it('01 - getOwnedFaces collects hyphenated members of form.elements', function () {
        assert.match(bindSlice, /var getOwnedFaces = function\(\$form\)/, 'getOwnedFaces helper is missing');
        // walks form.elements and keeps only hyphenated (custom-element) tagNames
        assert.match(bindSlice, /for \(let i = 0, len = \$form\.elements\.length;[\s\S]{0,160}?\$el\.tagName\.indexOf\('-'\) > -1/,
            'getOwnedFaces does not hyphen-test form.elements members');
    });

    it('02 - $faces joins the bind collection block via getOwnedFaces', function () {
        assert.match(bindSlice, /\$faces\s*=\s*getOwnedFaces\(\$target\)/,
            'the $faces = getOwnedFaces($target) collection line is missing');
    });

    it('03 - the FACE binding loop auto-ids, dirty-tracks and live-checks', function () {
        // iterate $faces
        assert.match(facesLoopSlice, /for \(let f = 0, len = \$faces\.length; f < len; \+\+f\)/, 'the $faces binding loop is missing');
        // FACE-specific auto-id prefix
        assert.match(facesLoopSlice, /elId = 'face\.' \+ uuid\(\)/, "the 'face.'+uuid() auto-id is missing");
        // dirty-tracking parity (fieldsSet)
        assert.match(facesLoopSlice, /\$form\.fieldsSet\[elId\] = \{/, 'the $faces loop does not populate fieldsSet');
        // registers live-check gated on the form opt-in flag
        assert.match(facesLoopSlice, /registerForLiveChecking\(\$form, \$faces\[f\]\)/,
            'the $faces loop does not registerForLiveChecking');
    });

    it('04 - registerForLiveChecking derives isCustomEl from the hyphen test', function () {
        assert.match(rlcSlice, /var isCustomEl = \( \$el\.tagName\.indexOf\('-'\) > -1 \)/,
            'isCustomEl is not derived from the tagName hyphen test');
    });

    it('05 - the supported-element gate is widened for custom tags', function () {
        // custom tags bypass the input|textarea whitelist
        assert.match(rlcSlice, /!isCustomEl && !\/\^\(input\|textarea\)\$\/i\.test\(\$el\.tagName\)/,
            'the gate is not widened to admit custom tags');
    });

    it('06 - setObserver (value-setter interception) is SKIPPED for custom tags (hazard a)', function () {
        assert.match(rlcSlice, /if \( !isCustomEl && !\/\^file\$\/i\.test\(\$el\.type\) \) \{\s*setObserver\(\$el\);/,
            'setObserver is not guarded against custom tags');
    });

    it('07 - addLiveForInput is routed with isOtherTagAllowed=isCustomEl', function () {
        assert.match(rlcSlice, /addLiveForInput\(\$form, \$el, liveCheckTimer, isCustomEl\)/,
            'the default branch does not pass isCustomEl as isOtherTagAllowed');
    });

    it('08 - the Safari-autocomplete bypass stays native-input only', function () {
        // the autocomplete block must sit behind !isCustomEl so a FACE never triggers it
        var guardIdx = rlcSlice.indexOf('if ( !isCustomEl ) {');
        var acIdx    = rlcSlice.indexOf("$el.getAttribute('autocomplete')");
        assert.ok(guardIdx > -1, 'the !isCustomEl guard around the autocomplete block is missing');
        assert.ok(acIdx > guardIdx, 'the autocomplete read must sit inside the !isCustomEl guard');
    });

    it('09 - getOwnedElements native single-tag matcher preserved', function () {
        // the native collector still matches a single uppercased tag exactly.
        // Window widened 400 -> 1200 for the #B333 node-identity dedup comment
        // block between the function head and the matcher (approved 2026-08-11);
        // the matcher itself is what this pin asserts, and it is unchanged.
        assert.match(mainSrc, /var getOwnedElements = function\(\$form, tag\)[\s\S]{0,1200}?\$el\.tagName === tagUpper/,
            'getOwnedElements native matcher was altered');
    });

    it('10 - the FACE loop surfaces .form/.name for the live-check path', function () {
        // a FACE exposes internals.form + the `name` attribute, not element-level
        // .form/.name; the loop surfaces them so addLiveForInput / processEvent
        // ($el.form, $el.name, event.target.form) do not dereference undefined and
        // the form scan does not throw.
        assert.match(facesLoopSlice, /Object\.defineProperty\(\$faces\[f\], 'form', \{ value: \$form\.target/,
            'the FACE loop does not surface .form from the owning form');
        assert.match(facesLoopSlice, /Object\.defineProperty\(\$faces\[f\], 'name', \{ value: \$faces\[f\]\.getAttribute\('name'\)/,
            'the FACE loop does not surface .name from the name attribute');
    });
});

describe('#CC2 getOwnedFaces — real-bytes extract+eval (+ subtract)', function () {

    it('01 - picks only hyphenated (custom-element) tags out of a mixed collection', function () {
        var faces = getOwnedFaces(mkForm([
            mkEl('input'), mkEl('x-rating'), mkEl('select'), mkEl('my-color'), mkEl('textarea')
        ]));
        assert.equal(faces.length, 2);
        assert.equal(faces[0].tagName, 'X-RATING');
        assert.equal(faces[1].tagName, 'MY-COLOR');
    });

    it('02 - excludes every native form control tag', function () {
        var faces = getOwnedFaces(mkForm([
            mkEl('input'), mkEl('textarea'), mkEl('select'), mkEl('button'), mkEl('fieldset'), mkEl('output')
        ]));
        assert.equal(faces.length, 0);
    });

    it('03 - collects multiple FACEs in document order', function () {
        var a = mkEl('x-a'), b = mkEl('x-b'), c = mkEl('x-c');
        var faces = getOwnedFaces(mkForm([a, mkEl('input'), b, mkEl('select'), c]));
        assert.deepEqual(faces.map(function (e) { return e.tagName; }), ['X-A', 'X-B', 'X-C']);
    });

    it('04 - empty form / no custom tags yields an empty set', function () {
        assert.equal(getOwnedFaces(mkForm([])).length, 0);
        assert.equal(getOwnedFaces(mkForm([mkEl('input'), mkEl('select')])).length, 0);
    });

    it('05 - SUBTRACT: the pre-fix native-tag-only collection excluded the FACE', function () {
        // model the pre-fix bind collection: getOwnedElements(tag) matched tagName === tagUpper
        // for each of the four native tags. A hyphenated FACE tag never equals any of them.
        function preFixCollect(els) {
            var out = [];
            ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].forEach(function (tagUpper) {
                els.forEach(function (el) { if (el.tagName === tagUpper) out.push(el); });
            });
            return out;
        }
        var els = [mkEl('input'), mkEl('x-rating'), mkEl('select')];
        var collected = preFixCollect(els);
        // the FACE is absent from the pre-fix collection...
        assert.equal(collected.filter(function (e) { return e.tagName === 'X-RATING'; }).length, 0);
        assert.ok(collected.every(function (e) { return e.tagName.indexOf('-') < 0; }));
        // ...but the shipped getOwnedFaces picks it up
        assert.equal(getOwnedFaces(mkForm(els)).length, 1);
    });
});

describe('#CC2 registerForLiveChecking decisions — replica (+ subtract)', function () {

    // Faithful models of the three widened decision points. Each is paired with a
    // pre-fix SUBTRACT reproducing the exclusion.
    function isCustomEl(tagName) { return tagName.indexOf('-') > -1; }

    // (a) supported-element gate → true means "early-return, no live-check"
    function earlyReturn(tagName, alreadyRegistered) {
        return ( (!isCustomEl(tagName) && !/^(input|textarea)$/i.test(tagName)) || alreadyRegistered );
    }
    function preFixEarlyReturn(tagName, alreadyRegistered) {
        return ( !/^(input|textarea)$/i.test(tagName) || alreadyRegistered );
    }

    // (b) setObserver call decision → true means "install the value-setter interception"
    function callsSetObserver(tagName, elType) {
        return ( !isCustomEl(tagName) && !/^file$/i.test(elType) );
    }

    // (c) addLiveForInput's isOtherTagAllowed argument, per the switch
    function isOtherTagAllowedArg(tagName) {
        return ( /^textarea$/i.test(tagName) ) ? true : isCustomEl(tagName);
    }
    // addLiveForInput enters its live-check body when the type matches OR isOtherTagAllowed
    function addLiveEntersBody(elType, isOtherTagAllowed) {
        var typeMatch = /^(radio|checkbox|text|hidden|password|number|date|email)$/i.test(elType);
        return ( typeMatch || isOtherTagAllowed );
    }

    it('01 - a FACE now passes the supported-element gate (not early-returned)', function () {
        assert.equal(earlyReturn('X-RATING', false), false);
    });

    it('02 - native input/textarea gate unchanged; unknown non-custom tags still rejected', function () {
        assert.equal(earlyReturn('INPUT', false), false);
        assert.equal(earlyReturn('TEXTAREA', false), false);
        assert.equal(earlyReturn('DIV', false), true);
        // idempotency (already registered) still early-returns even a FACE
        assert.equal(earlyReturn('X-RATING', true), true);
    });

    it('03 - SUBTRACT: the pre-fix gate early-returned a FACE (no live-check)', function () {
        assert.equal(preFixEarlyReturn('X-RATING', false), true);   // excluded pre-fix
        assert.equal(preFixEarlyReturn('INPUT', false), false);     // native unchanged
    });

    it('04 - setObserver is skipped for a FACE, preserved for native inputs (hazard a)', function () {
        assert.equal(callsSetObserver('X-RATING', undefined), false); // FACE: skipped
        assert.equal(callsSetObserver('INPUT', 'text'), true);        // native text: installed
        assert.equal(callsSetObserver('INPUT', 'file'), false);       // file: skipped (unchanged)
    });

    it('05 - addLiveForInput routing: a FACE gets isOtherTagAllowed=true and enters the body', function () {
        assert.equal(isOtherTagAllowedArg('X-RATING'), true);
        assert.equal(addLiveEntersBody(undefined, isOtherTagAllowedArg('X-RATING')), true);
    });

    it('06 - native routing unchanged (input via default; textarea forces true)', function () {
        assert.equal(isOtherTagAllowedArg('INPUT'), false);         // default branch, unchanged
        assert.equal(isOtherTagAllowedArg('TEXTAREA'), true);       // textarea case, unchanged
        assert.equal(addLiveEntersBody('text', false), true);       // a native text input still live-checks
    });

    it('07 - SUBTRACT: a FACE routed with the pre-fix default (false) would not live-check', function () {
        // pre-fix, the switch default passed no 4th arg (isOtherTagAllowed=false), and a FACE
        // has no input `type`, so addLiveForInput would not enter its body.
        assert.equal(addLiveEntersBody(undefined, false), false);
    });
});

describe('#CC2 FACE participation — built bundles carry the fix (dist pins)', function () {

    var distJs  = fs.readFileSync(DIST_JS, 'utf8');
    var distMin = fs.readFileSync(DIST_MIN_JS, 'utf8');

    it('01 - the unminified dist carries getOwnedFaces by name', function () {
        // gina.js carries validator src verbatim (comments + local names); the new helper
        // name survives, so its presence proves the rebuilt artifact has the fix.
        assert.ok(distJs.indexOf('getOwnedFaces') > -1,
            'gina.js does not carry getOwnedFaces — rebuild the dist');
    });

    it('02 - the unminified dist carries the FACE auto-id and isCustomEl branch', function () {
        assert.ok(distJs.indexOf("'face.'") > -1, 'gina.js does not carry the face. auto-id — rebuild the dist');
        assert.ok(distJs.indexOf('isCustomEl') > -1, 'gina.js does not carry isCustomEl — rebuild the dist');
    });

    it('03 - the minified dist gained the FACE-unique auto-id token (red pre-rebuild, green after)', function () {
        // `getOwnedFaces`/`isCustomEl` are `var`/local names → Closure renames them, so pin a
        // minify-surviving token: the FACE-unique 'face.' auto-id prefix (a string literal).
        // It appeared ZERO times in the pre-fix minified bundle, so a >=1 count is red before
        // the rebuild, green after — proving the browser bundle carries the source change.
        var m = distMin.match(/face\./g) || [];
        assert.ok(m.length >= 1, 'minified dist has ' + m.length + " 'face.' tokens; expected >= 1 after the rebuild");
    });

    it('04 - the minified dist gained the tagName hyphen-detection idiom (both sites)', function () {
        // getOwnedFaces + the isCustomEl derivation each carry `$el.tagName.indexOf('-')`; the
        // `.tagName.indexOf('-')` idiom survives minification and was absent pre-fix.
        var m = distMin.match(/tagName\.indexOf\('-'\)/g) || [];
        assert.ok(m.length >= 2, 'minified dist has ' + m.length + ' tagName.indexOf hyphen tests; expected >= 2');
    });
});
