'use strict';
/**
 * Staged-upload action-attribute fallback + preview-container guard — #B146 / #B147.
 *
 * #B146 — checkUploadUrlActions.checkAction default-route fallback CLOBBER.
 *   When the checked attribute (`data-gina-form-upload-reset-action` /
 *   `-delete-action`) was absent and a default route resolved, the fallback
 *   hardcoded `setAttribute('data-gina-form-upload-action', route.toUrl())` —
 *   the STAGING attribute — regardless of which attribute was being checked.
 *   A file input declaring only its staging action thus had it silently
 *   repointed at the reset/delete route, so the staging POST hit the delete
 *   route. Fix: `setAttribute(action, route.toUrl())` — write the attribute
 *   that was actually checked. (The origin/CORS compounding factor is a
 *   separate, deferred concern: toUrl() always prepends the hostname, there is
 *   no clean origin-less form, and the silent death is really the commented-out
 *   status-0 branch in send().)
 *
 * #B147 — previewContainer is a getElementById RESULT (element or null). The
 *   guard `if ( typeof(previewContainer) != 'undefined' )` passed for a MISS,
 *   because typeof(null) === 'object', so hasPreviewContainer went true with a
 *   null container and the success handler later dereferenced `.id`. Fix:
 *   `&& previewContainer` (the architecture-index typeof-null guard pattern).
 *
 * Strategy: source pins on the ACTIVE (comment-stripped) source + an
 * extract+eval of the shipped checkAction driven with a mock element/routing +
 * a frozen pre-fix SUBTRACT reproducing the clobber + a guard replica/subtract
 * for #B147 + red-first dist-fidelity pins (validated FAILING on the
 * pre-rebuild artifact, per the jsdoc.md discipline).
 *
 * Suites:
 *  01 — #B146 source pins (setAttribute the checked attr; hardcoded fallback gone)
 *  02 — #B146 behaviour: extract+eval the shipped checkAction (+ frozen subtract)
 *  03 — #B147 source pins (the && previewContainer guard; bare typeof gone)
 *  04 — #B147 guard replica (+ subtract: the bare typeof passes for null)
 *  05 — dist fidelity (red-first: validated failing on the pre-rebuild dist)
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW            = require('../fw');
var MAIN_SRC_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST_JS       = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var SRC = fs.readFileSync(MAIN_SRC_PATH, 'utf8');

// Comment-strip that also drops JSDoc block lines — the #B146/#B147 fixes carry
// explanatory comments that name the old constructs, so negative pins MUST run
// against the ACTIVE code only.
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// Extract the shipped checkAction function expression from the RAW source
// (the `// checking upload-action` marker is a comment, so extract before any
// comment strip). Bounds: the declaration → the marker; trim to the last brace.
function extractCheckAction(src) {
    var start = src.indexOf('var checkAction = function($el, action, $errorContainer) {');
    var mark  = src.indexOf('// checking upload-action', start);
    assert.ok(start > -1 && mark > start, 'checkAction block located in main.js');
    var slice = src.substring(start, mark);
    var fnSrc = slice.substring(0, slice.lastIndexOf('}') + 1).replace(/^var checkAction = /, '');
    return fnSrc;
}

// Build a runnable checkAction over injected routing/console (the eval closes
// over these locals), so we drive the EXACT shipped bytes.
function makeCheckAction(routing, console) {
    /* eslint-disable no-eval */
    return eval('(' + extractCheckAction(SRC) + ')');
    /* eslint-enable no-eval */
}

// A minimal element mock: attribute bag with get/set + an id.
function mockEl(attrs) {
    return {
        _attrs: Object.assign({}, attrs),
        id: 'myfile',
        getAttribute: function (a) { return (a in this._attrs) ? this._attrs[a] : null; },
        setAttribute: function (a, v) { this._attrs[a] = v; }
    };
}

var silentConsole = { warn: function () {}, info: function () {}, error: function () {} };
var mockRouting   = { getRoute: function (name) { return { bundle: 'b', toUrl: function () { return '/' + name; } }; } };

// ─── 01 — #B146 source pins ─────────────────────────────────────────────────
describe('01 - #B146 source pins: the fallback writes the CHECKED attribute', function () {
    var active;
    before(function () { active = stripComments(SRC); });

    it('the default-route fallback calls setAttribute(action, uploadActionUrl.toUrl())', function () {
        assert.ok(active.indexOf('$el.setAttribute(action, uploadActionUrl.toUrl());') > -1);
    });

    it('the hardcoded staging-attribute fallback is GONE from active source', function () {
        assert.ok(
            active.indexOf("setAttribute('data-gina-form-upload-action', uploadActionUrl.toUrl())") < 0,
            'no hardcoded data-gina-form-upload-action fallback remains'
        );
    });

    it('the switch still maps the two default routes (unchanged)', function () {
        assert.match(active, /case 'data-gina-form-upload-action':[\s\S]{0,80}?defaultRoute = 'upload-to-tmp-xml'/);
        assert.match(active, /case 'data-gina-form-upload-reset-action':[\s\S]{0,80}?defaultRoute = 'upload-delete-from-tmp-xml'/);
    });
});

// ─── 02 — #B146 behaviour (extract+eval the shipped checkAction) ─────────────
describe('02 - #B146 behaviour: reset-fallback no longer clobbers the staging action', function () {

    it('checking -reset-action on an input that declares only -action sets -reset-action, not -action', function () {
        var checkAction = makeCheckAction(mockRouting, silentConsole);
        var $el = mockEl({ 'data-gina-form-upload-action': '/my-staging' });
        checkAction($el, 'data-gina-form-upload-reset-action', null);
        // the checked attribute is now the resolved reset default...
        assert.equal($el._attrs['data-gina-form-upload-reset-action'], '/upload-delete-from-tmp-xml');
        // ...and the staging action is UNTOUCHED (the #B146 regression)
        assert.equal($el._attrs['data-gina-form-upload-action'], '/my-staging');
    });

    it('checking -action itself still resolves the staging default onto -action', function () {
        var checkAction = makeCheckAction(mockRouting, silentConsole);
        var $el = mockEl({}); // declares nothing
        checkAction($el, 'data-gina-form-upload-action', null);
        assert.equal($el._attrs['data-gina-form-upload-action'], '/upload-to-tmp-xml');
    });

    it('an explicitly-declared attribute is left as-is (no fallback fires)', function () {
        var checkAction = makeCheckAction(mockRouting, silentConsole);
        var $el = mockEl({
            'data-gina-form-upload-action': '/staging',
            'data-gina-form-upload-reset-action': '/reset'
        });
        checkAction($el, 'data-gina-form-upload-reset-action', null);
        assert.equal($el._attrs['data-gina-form-upload-reset-action'], '/reset');
        assert.equal($el._attrs['data-gina-form-upload-action'], '/staging');
    });

    it('SUBTRACT: the frozen pre-fix hardcoded fallback clobbers the staging action', function () {
        // the exact pre-#B146 shape (hardcoded staging attribute)
        var preFix = function ($el, action, routing) {
            var defaultRoute = null;
            switch (action) {
                case 'data-gina-form-upload-action': defaultRoute = 'upload-to-tmp-xml'; break;
                case 'data-gina-form-upload-reset-action': defaultRoute = 'upload-delete-from-tmp-xml'; break;
            }
            var uploadActionUrl = $el.getAttribute(action);
            if (!uploadActionUrl || uploadActionUrl == '') {
                if (defaultRoute) uploadActionUrl = routing.getRoute(defaultRoute);
                if (uploadActionUrl) {
                    $el.setAttribute('data-gina-form-upload-action', uploadActionUrl.toUrl());
                }
            }
        };
        var $el = mockEl({ 'data-gina-form-upload-action': '/my-staging' });
        preFix($el, 'data-gina-form-upload-reset-action', mockRouting);
        // the bug: the staging action was repointed at the reset/delete route
        assert.equal($el._attrs['data-gina-form-upload-action'], '/upload-delete-from-tmp-xml');
        assert.equal($el._attrs['data-gina-form-upload-reset-action'], undefined);
    });
});

// ─── 03 — #B147 source pins ─────────────────────────────────────────────────
describe('03 - #B147 source pins: the preview-container guard requires a truthy element', function () {
    var active;
    before(function () { active = stripComments(SRC); });

    it('the guard is typeof-not-undefined AND truthy', function () {
        assert.ok(active.indexOf("typeof(previewContainer) != 'undefined' && previewContainer") > -1);
    });

    it('the bare typeof-only guard (which passes for null) is GONE', function () {
        // the bare guard is the check immediately followed by the block open,
        // with NO && previewContainer conjunct
        assert.doesNotMatch(active, /typeof\(previewContainer\) != 'undefined' \)\s*\{/);
    });
});

// ─── 04 — #B147 guard replica (+ subtract) ──────────────────────────────────
describe('04 - #B147 guard: getElementById MISS no longer counts as a preview container', function () {

    // the fixed decision, mirrored: previewContainer is element|null
    function hasPreview(previewContainer) {
        var has = false;
        if (typeof(previewContainer) != 'undefined' && previewContainer) has = true;
        return has;
    }

    it('a resolved element counts as a preview container', function () {
        assert.equal(hasPreview({ id: 'x-preview' }), true);
    });

    it('a getElementById MISS (null) does NOT count', function () {
        assert.equal(hasPreview(null), false);
    });

    it('SUBTRACT: the bare typeof guard wrongly counts a null as present', function () {
        function hasPreviewPreFix(previewContainer) {
            var has = false;
            if (typeof(previewContainer) != 'undefined') has = true; // typeof null === 'object'
            return has;
        }
        assert.equal(hasPreviewPreFix(null), true); // the bug
        assert.equal(hasPreview(null), false);      // the fix
    });
});

// ─── 05 — dist fidelity (red-first: validated FAILING on the pre-rebuild dist) ─
describe('05 - dist fidelity: the rebuilt bundle carries both fixes', function () {
    var active;
    before(function () { active = stripComments(fs.readFileSync(DIST_JS, 'utf8')); });

    it('gina.js: the fallback writes the checked attribute (setAttribute(action, ...))', function () {
        assert.ok(active.indexOf('$el.setAttribute(action, uploadActionUrl.toUrl());') > -1, '#B146 in dist');
        assert.ok(
            active.indexOf("setAttribute('data-gina-form-upload-action', uploadActionUrl.toUrl())") < 0,
            'hardcoded fallback retired from active dist code'
        );
    });

    it('gina.js: the preview-container guard is truthy-gated', function () {
        assert.ok(active.indexOf("typeof(previewContainer) != 'undefined' && previewContainer") > -1, '#B147 in dist');
    });
});
