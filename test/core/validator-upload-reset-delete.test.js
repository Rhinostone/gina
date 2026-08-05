/**
 * Upload reset/delete removal path — dead cleanup tail + removal-path callbacks
 *
 * Two coordinated fixes in `onUploadResetOrDelete` (validator plugin) plus one
 * in `bindUploadResetOrDeleteTrigger`:
 *
 * 1. The removal tail was dead code: the statement wrapping the DOM removals
 *    referenced an undefined identifier, so evaluating its arguments threw a
 *    ReferenceError on (nearly) every reset/delete click — the preview image
 *    and its reset/delete link were only inline-hidden, never removed, and
 *    re-uploads accumulated stale nodes with deterministic duplicate ids.
 *    The fix runs the removals DIRECTLY (`$resetLink.remove()` +
 *    `childNodes[i].remove()`); the link's native click listener dies with the
 *    node, so no de-registration ceremony is needed.
 *    Because the removals now actually happen, the iteration was made safe for
 *    removal-under-iteration: `childNodes` is a STATIC snapshot of the preview
 *    images (a live NodeList shrinks by TWO nodes per removed file while the
 *    old `len--; i--;` compensated for one — out-of-range `.tagName` reads on
 *    multi-file passes). The `len--; i--;` compensation is deleted.
 *
 * 2. The add-affordance restore was inline-`style.display`-only (a class-hidden
 *    affordance could never come back) and aborted the WHOLE removal pass via
 *    an early `return` when the parent was inline-hidden. The restore now goes
 *    through `restoreUploadAffordance()`: removes the optional
 *    `data-gina-form-upload-hidden-class` class from the input + parent, then
 *    the historical inline-display fallback (same branch outcomes, no abort).
 *    New removal-path callbacks `data-gina-form-upload-on-reset` /
 *    `data-gina-form-upload-on-delete` (bare identifier registered on
 *    `window`, same convention as `data-gina-form-upload-on-success`) are
 *    dispatched ONCE per action, AFTER the removal XHR went out, with
 *    `{ $upload, bindingType, files }`; a throwing callback is contained.
 *
 * 3. The documented `data-gina-form-upload-<reset|delete>-trigger` id override
 *    could never resolve: the attribute name was built with a stray `'-'` and
 *    a unary `+` coercing the binding type to NaN. The lookup now reads the
 *    documented attribute name (and the not-found warn no longer suggests an
 *    id with a double-appended suffix).
 *
 * Usage: node --test test/core/validator-upload-reset-delete.test.js
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

// function-body slices, anchored on the DECLARATION form (a bare name can
// match comments/JSDoc earlier in the file)
function fnSlice(src, declToken) {
    var start = src.indexOf(declToken);
    assert.ok(start > -1, 'declaration anchor not found: ' + declToken);
    // generous fixed span is fine here: both functions are < 200 lines and the
    // assertions inside are existence/ordering checks, not end-of-slice pins.
    // Widened 12000 -> 16000 for #A11Y7/U5, which added the pre-removal focus move
    // and removal announcement inside `onUploadResetOrDelete` (~2.6k chars) and
    // pushed the #R8 strip and the callback dispatch past the old window — the
    // pinned code was present and correctly ordered, the extractor just could not
    // reach it. `onUploadResetOrDelete` currently ends ~14.2k past its anchor.
    // NOTE this is still a FIXED window and will bite again on the next sizeable
    // edit here; the durable fix is to brace-walk to the real function end, as
    // the sibling validator-upload-progress.test.js already does.
    return src.substring(start, start + 16000);
}
var onRemoveSlice = fnSlice(mainSrc, 'var onUploadResetOrDelete = function');
var binderSlice   = fnSlice(mainSrc, 'var bindUploadResetOrDeleteTrigger = function').substring(0, 4000);
var restoreSlice  = fnSlice(mainSrc, 'var restoreUploadAffordance = function').substring(0, 1400);

describe('upload reset/delete — dead removal tail replaced by direct removals (source pins)', function () {

    it('01 - the undefined identifier is gone file-wide', function () {
        assert.ok(mainSrc.indexOf('$uploadResetTrigger') < 0,
            'the undefined free identifier must not appear anywhere (code or comments)');
    });

    it('02 - the dead wrapper callback is gone file-wide', function () {
        assert.ok(mainSrc.indexOf('onUploadResetTriggerEventRemoved') < 0);
    });

    it('03 - no click-deregistration ceremony remains around the removal tail', function () {
        assert.doesNotMatch(onRemoveSlice, /removeListener\(gina,\s*\$\w+,\s*'click'/);
    });

    it('04 - childNodes is a STATIC img snapshot, not the live NodeList', function () {
        assert.match(onRemoveSlice,
            /childNodes\s*=\s*Array\.prototype\.filter\.call\(\$uploadPreview\.childNodes,\s*function \(node\) \{\s*return \/img\/i\.test\(node\.tagName\);\s*\}\)/);
        assert.ok(onRemoveSlice.indexOf('childNodes            = $uploadPreview.childNodes') < 0,
            'the live-NodeList assignment must be gone');
    });

    it('05 - direct removals: link first, then the preview image, then break', function () {
        assert.match(onRemoveSlice,
            /\$resetLink\.remove\(\);[\s\S]{0,120}?childNodes\[i\]\.remove\(\);[\s\S]{0,40}?break;/);
    });

    it('06 - the len--/i-- live-list compensation is deleted', function () {
        assert.ok(onRemoveSlice.indexOf('len--') < 0, 'len-- must be gone from onUploadResetOrDelete');
        assert.doesNotMatch(onRemoveSlice, /^\s*i--;\s*$/m);
    });

    it('07 - the removal XHR is sent BEFORE any DOM removal (payload reads the preview DOM)', function () {
        var sendIdx   = onRemoveSlice.indexOf('xhr.send(JSON.stringify({ files: filesToBeRemoved }))');
        var removeIdx = onRemoveSlice.indexOf('$resetLink.remove();');
        assert.ok(sendIdx > -1 && removeIdx > -1);
        assert.ok(sendIdx < removeIdx, 'xhr.send must precede the DOM removals');
    });
});

describe('upload reset/delete — removal-under-iteration replica (+ subtract)', function () {

    // minimal DOM-less model: a backing array plays the parent's childNodes;
    // node.remove() splices out of the backing array exactly like a live
    // NodeList view would shrink.
    function makePreview(fileNames) {
        var backing = [];
        fileNames.forEach(function (name, idx) {
            var img = {
                tagName: 'IMG', name: name, removed: false,
                remove: function () { backing.splice(backing.indexOf(img), 1); img.removed = true; }
            };
            var link = {
                tagName: 'A', of: name, removed: false,
                remove: function () { backing.splice(backing.indexOf(link), 1); link.removed = true; }
            };
            backing.push(img, link);
        });
        return backing;
    }

    it('01 - SUBTRACT: the pre-fix live-list loop with len--/i-- overruns on a multi-file pass', function () {
        var backing = makePreview(['a.png', 'b.png']);
        var files = [{ name: 'a.png' }, { name: 'b.png' }];
        function preFixPass() {
            var childNodes = backing; // live view
            for (var i = 0, len = childNodes.length; i < len; i++) {
                if (/img/i.test(childNodes[i].tagName)) {            // ← throws on undefined
                    var img = childNodes[i];
                    for (var f = 0; f < files.length; f++) {
                        if (files[f].name === img.name) {
                            // the two removals the dead tail was meant to run
                            backing[backing.indexOf(img) + 1].remove(); // its link
                            img.remove();
                            files.splice(f, 1);
                            len--;                                     // compensates ONE of TWO
                            i--;
                            break;
                        }
                    }
                }
            }
        }
        assert.throws(preFixPass, TypeError,
            'live list shrinks by 2 per removal while len-- compensates 1 → out-of-range .tagName read');
    });

    it('02 - the fixed shape (static img snapshot, no compensation) removes every file cleanly', function () {
        var backing = makePreview(['a.png', 'b.png']);
        var files = [{ name: 'a.png' }, { name: 'b.png' }];
        var removedCount = 0;
        function fixedPass() {
            var childNodes = backing.filter(function (node) { return /img/i.test(node.tagName); });
            for (var i = 0, len = childNodes.length; i < len; i++) {
                if (/img/i.test(childNodes[i].tagName)) {
                    var img = childNodes[i];
                    for (var f = 0; f < files.length; f++) {
                        if (files[f].name === img.name) {
                            files.splice(f, 1);
                            removedCount++;
                            backing[backing.indexOf(img) + 1].remove(); // link
                            img.remove();
                            break;
                        }
                    }
                }
            }
        }
        assert.doesNotThrow(fixedPass);
        assert.equal(backing.length, 0, 'both images AND both links actually removed');
        assert.equal(removedCount, 2);
        assert.equal(files.length, 0);
    });
});

describe('upload reset/delete — affordance restore + removal-path callbacks (source pins)', function () {

    it('01 - restoreUploadAffordance exists and handles the configurable hidden class', function () {
        assert.match(restoreSlice, /classList\.remove\(hiddenClass\)/);
        assert.match(restoreSlice, /parentElement\.classList\.remove\(hiddenClass\)/);
    });

    it('02 - the historical inline-display fallback is preserved WITHOUT the pass-aborting return', function () {
        assert.match(restoreSlice, /parentElement\.style\.display = 'block';/);
        assert.match(restoreSlice, /\$uploadTrigger\.style\.display = 'block';/);
        assert.ok(restoreSlice.indexOf('return') < 0, 'the restore helper must not abort the removal pass');
        // and the in-loop restore goes through the helper
        assert.match(onRemoveSlice, /restoreUploadAffordance\(\$uploadTrigger, uploadHiddenClass\);/);
        assert.doesNotMatch(onRemoveSlice, /style\.display = 'block';\s*\n\s*return;/);
    });

    it('03 - the callback + hidden-class attributes are read off the file input', function () {
        assert.match(onRemoveSlice, /onRemoveCbName\s*=\s*\$uploadTrigger\.getAttribute\('data-gina-form-upload-on-' \+ bindingType\)/);
        assert.match(onRemoveSlice, /uploadHiddenClass\s*=\s*\$uploadTrigger\.getAttribute\('data-gina-form-upload-hidden-class'\)/);
    });

    it('04 - dispatch: once per action, gated on removedCount, window[name], throw-contained', function () {
        assert.match(onRemoveSlice, /if \(removedCount > 0 && onRemoveCbName\) \{/);
        assert.match(onRemoveSlice, /typeof\(window\[onRemoveCbName\]\) === 'function'/);
        assert.match(onRemoveSlice, /window\[onRemoveCbName\]\(\{ \$upload: \$uploadTrigger, bindingType: bindingType, files: filesToBeRemoved \}\);/);
        // contained: the invocation sits in a try whose catch reports
        assert.match(onRemoveSlice, /try \{\s*window\[onRemoveCbName\]\([\s\S]{0,120}?\}\s*catch \(cbErr\)/);
        // function-call shapes rejected like the -on-success convention
        assert.match(onRemoveSlice, /\/\\\(\(\.\*\)\\\)\/\.test\(onRemoveCbName\)/);
    });

    it('05 - the dispatch sits AFTER the removal loop (all XHRs already out)', function () {
        var loopEnd  = onRemoveSlice.indexOf('} // EO for');
        var dispatch = onRemoveSlice.indexOf('if (removedCount > 0 && onRemoveCbName)');
        assert.ok(loopEnd > -1 && dispatch > -1);
        assert.ok(dispatch > loopEnd, 'callback dispatch must follow the whole removal pass');
    });
});

describe('upload reset/delete — restore + dispatch replicas (+ subtracts)', function () {

    // faithful replica of restoreUploadAffordance against a minimal element model
    function makeEl(computedDisplay, inlineDisplay, classes) {
        var el = {
            style: { display: inlineDisplay },
            _classes: classes ? classes.slice() : [],
            classList: {
                remove: function (c) {
                    var k = el._classes.indexOf(c);
                    if (k > -1) { el._classes.splice(k, 1); }
                }
            }
        };
        el._computed = computedDisplay;
        return el;
    }
    function restoreReplica($uploadTrigger, hiddenClass, getComputedStyle) {
        if (hiddenClass) {
            try {
                $uploadTrigger.classList.remove(hiddenClass);
                if ($uploadTrigger.parentElement) {
                    $uploadTrigger.parentElement.classList.remove(hiddenClass);
                }
            } catch (restoreErr) {}
        }
        if ( /none/i.test(getComputedStyle($uploadTrigger).display) ) {
            if ( /none/i.test($uploadTrigger.parentElement.style.display) ) {
                $uploadTrigger.parentElement.style.display = 'block';
            } else {
                $uploadTrigger.style.display = 'block';
            }
        }
    }
    // computed display: none while the class is applied to input or parent,
    // else whatever the element carries
    function computedOf(el) {
        var parent = el.parentElement;
        var classHidden = el._classes.indexOf('is-hidden') > -1
            || (parent && parent._classes.indexOf('is-hidden') > -1);
        return { display: classHidden ? 'none' : el._computed };
    }

    it('01 - class-hidden parent + configured class: the class is removed from input AND parent', function () {
        var parent = makeEl('block', '', ['is-hidden']);
        var input  = makeEl('inline-block', '');
        input.parentElement = parent;
        restoreReplica(input, 'is-hidden', computedOf);
        assert.equal(parent._classes.length, 0, 'parent class removed');
        // class removal alone made it visible — no inline overrides needed
        assert.equal(parent.style.display, '');
        assert.equal(input.style.display, '');
    });

    it('02 - SUBTRACT: the inline-only historical restore leaves a class-hidden parent hidden', function () {
        var parent = makeEl('block', '', ['is-hidden']);
        var input  = makeEl('inline-block', '');
        input.parentElement = parent;
        restoreReplica(input, null /* no configured class */, computedOf);
        // input got the inline block (the historical A&&!B branch) but the
        // parent still carries the hiding class — the affordance stays hidden
        assert.equal(input.style.display, 'block');
        assert.ok(parent._classes.indexOf('is-hidden') > -1);
    });

    it('03 - inline-hidden parent: parent restored, and the pass is NOT aborted', function () {
        var parent = makeEl('block', 'none', []);
        var input  = makeEl('none', '');
        input.parentElement = parent;
        var afterRan = false;
        restoreReplica(input, null, function (el) { return { display: el._computed }; });
        afterRan = true; // pre-fix the early `return` aborted the caller's pass
        assert.equal(parent.style.display, 'block');
        assert.equal(input.style.display, '', 'A&&B branch: parent only, input untouched (historical outcome)');
        assert.ok(afterRan);
    });

    it('04 - visible input: restore is a no-op', function () {
        var parent = makeEl('block', '', []);
        var input  = makeEl('inline-block', '');
        input.parentElement = parent;
        restoreReplica(input, null, function (el) { return { display: el._computed }; });
        assert.equal(input.style.display, '');
        assert.equal(parent.style.display, '');
    });

    // dispatch-block replica
    function dispatchReplica(removedCount, onRemoveCbName, windowObj, log) {
        if (removedCount > 0 && onRemoveCbName) {
            if ( /\((.*)\)/.test(onRemoveCbName) ) {
                log.push('warn:call-shape');
            } else if ( typeof(windowObj[onRemoveCbName]) === 'function' ) {
                try {
                    windowObj[onRemoveCbName]({ $upload: 'el', bindingType: 'reset', files: ['a.png'] });
                } catch (cbErr) {
                    log.push('error:threw');
                }
            } else {
                log.push('warn:not-found');
            }
        }
    }

    it('05 - fires ONCE with the payload; zero removals or no attribute means no dispatch', function () {
        var calls = [], log = [];
        var w = { onFilesRemoved: function (p) { calls.push(p); } };
        dispatchReplica(1, 'onFilesRemoved', w, log);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], { $upload: 'el', bindingType: 'reset', files: ['a.png'] });
        dispatchReplica(0, 'onFilesRemoved', w, log);   // no removal → no fire
        dispatchReplica(1, null, w, log);               // no attribute → no fire
        assert.equal(calls.length, 1);
        assert.equal(log.length, 0);
    });

    it('06 - a throwing callback is contained; unknown / call-shape names warn instead of throwing', function () {
        var log = [];
        var w = { boom: function () { throw new Error('consumer bug'); } };
        assert.doesNotThrow(function () { dispatchReplica(1, 'boom', w, log); });
        dispatchReplica(1, 'missing', w, log);
        dispatchReplica(1, 'doIt(arg)', w, log);
        assert.deepEqual(log, ['error:threw', 'warn:not-found', 'warn:call-shape']);
    });
});

describe('upload reset/delete — form click proxy survives a mid-dispatch removal (source pin + replica)', function () {

    it('01 - clickProxyHandler early-returns on a detached click target', function () {
        var proxySlice = fnSlice(mainSrc, 'var clickProxyHandler = function(event)').substring(0, 2400);
        assert.match(proxySlice, /if \( !\$el \|\| !\$el\.parentNode \) \{\s*return;\s*\}/);
        // the guard sits BEFORE the first parentNode read
        var guardIdx = proxySlice.indexOf('!$el.parentNode');
        var readIdx  = proxySlice.indexOf('event.target.parentNode.tagName');
        assert.ok(guardIdx > -1 && readIdx > -1 && guardIdx < readIdx);
    });

    it('02 - replica: a target removed during its own dispatch no longer throws at the form proxy', function () {
        function proxyReplica(eventTarget) {
            var $el = eventTarget;
            if ( !$el || !$el.parentNode ) { return 'skipped'; }
            return /(label)/i.test($el.parentNode.tagName) ? 'label' : 'other';
        }
        var detached = { tagName: 'A', parentNode: null }; // removed mid-dispatch
        assert.equal(proxyReplica(detached), 'skipped');
        var attached = { tagName: 'A', parentNode: { tagName: 'DIV' } };
        assert.equal(proxyReplica(attached), 'other');
        // SUBTRACT: the pre-guard shape throws on the detached target
        function preGuard(eventTarget) {
            return /(label)/i.test(eventTarget.parentNode.tagName);
        }
        assert.throws(function () { preGuard(detached); }, TypeError);
    });
});

describe('upload reset/delete — custom trigger-id override resolves as documented (source pins)', function () {

    it('01 - the override reads the documented attribute name', function () {
        assert.match(binderSlice,
            /customTriggerId = \$uploadTrigger\.getAttribute\('data-gina-form-upload-'\+ bindingType \+'-trigger'\)/);
        assert.match(binderSlice, /if \(customTriggerId\) \{/);
    });

    it('02 - the NaN-producing attribute-name build is gone', function () {
        assert.ok(binderSlice.indexOf('+ +bindingType') < 0,
            'the unary-plus coercion must be gone');
        assert.ok(mainSrc.indexOf("'data-gina-form-upload-'+ '-' +index") < 0,
            'the stray-dash attribute-name build must be gone file-wide');
    });

    it('03 - the not-found warn suggests the deterministic id verbatim (no double suffix)', function () {
        assert.ok(binderSlice.indexOf("uploadResetOrDeleteTriggerId +'-'+bindingType+'-trigger`") < 0,
            'the warn must not double-append the type/trigger suffix');
        assert.match(binderSlice, /element ID is `'\+ uploadResetOrDeleteTriggerId \+'`/);
    });

    it('04 - unset override keeps the deterministic id for the warn (guarded reassignment)', function () {
        // the reassignment only happens when the attribute is present
        var reassignIdx = binderSlice.indexOf('uploadResetOrDeleteTriggerId = customTriggerId;');
        var guardIdx    = binderSlice.indexOf('if (customTriggerId) {');
        assert.ok(guardIdx > -1 && reassignIdx > guardIdx);
    });
});

describe('upload reset/delete — built bundles carry the fix (dist pins)', function () {

    var distJs  = fs.readFileSync(DIST_JS, 'utf8');
    var distMin = fs.readFileSync(DIST_MIN_JS, 'utf8');

    it('01 - the undefined identifier is gone from BOTH dist artifacts', function () {
        // a free global reference survives minification verbatim — its absence
        // proves the rebuilt artifacts carry the fix
        assert.ok(distJs.indexOf('$uploadResetTrigger') < 0, 'gina.js still carries the dead read');
        assert.ok(distMin.indexOf('$uploadResetTrigger') < 0, 'gina.min.js still carries the dead read');
    });

    it('02 - the dead wrapper callback is gone from the unminified dist', function () {
        assert.ok(distJs.indexOf('onUploadResetTriggerEventRemoved') < 0);
    });

    it('03 - the new attribute literals are present in BOTH dist artifacts', function () {
        assert.ok(distJs.indexOf('data-gina-form-upload-on-') > -1);
        assert.ok(distMin.indexOf('data-gina-form-upload-on-') > -1);
        assert.ok(distJs.indexOf('data-gina-form-upload-hidden-class') > -1);
        assert.ok(distMin.indexOf('data-gina-form-upload-hidden-class') > -1);
    });
});

// ─── #B150 — a zero-match removal loop signals the otherwise-silent skip ─────
describe('upload reset/delete — #B150: a zero-match removal loop signals the silent cleanup skip', function () {
    it('01 - source: removedCount===0 with non-empty previews warns', function () {
        assert.match(onRemoveSlice, /if \(removedCount === 0 && childNodes\.length > 0\) \{[\s\S]{0,300}?console\.warn\(/);
    });
    it('02 - source: the signal precedes the still-gated #R8 strip AND the callback (gates unchanged)', function () {
        var signal   = onRemoveSlice.indexOf('if (removedCount === 0 && childNodes.length > 0)');
        var strip    = onRemoveSlice.indexOf('if (removedCount > 0) {');
        var dispatch = onRemoveSlice.indexOf('if (removedCount > 0 && onRemoveCbName)');
        assert.ok(signal > -1 && strip > -1 && dispatch > -1);
        assert.ok(signal < strip && strip < dispatch, 'the signal sits before the removedCount>0 cleanup tail');
    });
    function zeroMatchWarns(removedCount, childNodesLength) { return (removedCount === 0 && childNodesLength > 0); }
    it('03 - replica: non-empty previews, zero removals => warn', function () { assert.equal(zeroMatchWarns(0, 3), true); });
    it('04 - replica: an empty preview set => silent (nothing to remove is normal)', function () { assert.equal(zeroMatchWarns(0, 0), false); });
    it('05 - replica: a real removal (removedCount>0) => no warn', function () { assert.equal(zeroMatchWarns(2, 3), false); });
    it('06 - dist fidelity: the rebuilt bundle carries the zero-match signal (new string, red-first by construction)', function () {
        var dist = fs.readFileSync(DIST_JS, 'utf8');
        assert.ok(dist.indexOf('none matched the staged input files') > -1, '#B150 in dist');
    });
});
