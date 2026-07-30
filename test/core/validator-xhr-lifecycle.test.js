'use strict';
/**
 * #B175 — FormValidator `send()` XHR lifecycle: fresh XHR per send + a
 * fail-safe `loadend` release.
 *
 * Pre-fix, `send()` reused ONE module-scope XHR (created at validator init).
 * Re-open()ing a COMPLETED XHR transitions readyState 4 → 1 and synchronously
 * fires the PREVIOUS submit's still-assigned `onreadystatechange` handler:
 * that stale closure re-disabled the previous form's submit trigger and
 * re-stamped its `data-gina-form-loading` — with no release path, since the
 * handler is replaced right after and the stale closure's readyState-4
 * release never runs. The lock was armed at four sites and released at one.
 *
 * The fix: `var xhr = setupXhr();` — a fresh LOCAL XHR per send (nested
 * handlers close over the local, so an overlapping send cannot repoint them),
 * plus an `addEventListener('loadend', …)` release that fires on success,
 * error, timeout and abort alike; `$form.isSending` now spans send→settled
 * (it was cleared at the readyState-1 firing, i.e. almost immediately); the
 * timeout path removes `data-gina-form-loading` instead of writing the
 * truthy string "false".
 *
 * §01 — source pins on the fixed shapes (negatives run on comment-stripped
 *       source, since the pre-fix code is kept as `// was:` comments).
 * §02 — behavioural, on jsdom's REAL XMLHttpRequest: the stale-handler
 *       replay reproduced on the pre-fix shared shape (readyState 4 → 1),
 *       silent on the fixed fresh-per-send shape; the REAL extracted
 *       `onSendSettled` release executed against a real failing request.
 */

var assert = require('node:assert');
var { describe, it } = require('node:test');
var fs   = require('fs');
var path = require('path');

var fwPath  = require('../fw');
var mainPath = path.join(fwPath, 'core', 'plugins', 'lib', 'validator', 'src', 'main.js');
var mainSrc  = fs.readFileSync(mainPath).toString();

/**
 * Strip line comments so negative pins cannot trip on the `// was:` blocks
 * that keep the pre-fix code per the replace-code convention.
 * @param {string} src
 * @returns {string} source without `//` line comments
 * @inner
 */
function stripLineComments(src) {
    return src.split('\n').map(function (l) {
        var i = l.indexOf('//');
        return i === -1 ? l : l.slice(0, i);
    }).join('\n');
}
var codeSrc = stripLineComments(mainSrc);

/**
 * Brace-match-extract a block from `open` to its balanced close.
 * @param {string} src
 * @param {string} open - the opening anchor (must contain the first `{`)
 * @returns {string}
 * @inner
 */
function extractBlock(src, open) {
    var start = src.indexOf(open);
    assert.notStrictEqual(start, -1, 'anchor not found: ' + open);
    var i = src.indexOf('{', start);
    var depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('unbalanced block for anchor: ' + open);
}

describe('01 - #B175 source pins', function () {

    it('01.1 - send() creates a fresh LOCAL xhr; the module reuse is gone', function () {
        assert.notStrictEqual(codeSrc.indexOf('var xhr = setupXhr();'), -1,
            'fresh local XHR per send missing');
        // The reuse guard must not survive as code (it may live in comments)
        assert.strictEqual(codeSrc.indexOf('if (!xhr)'), -1,
            'the module-XHR reuse guard is still live code');
        // No module-scope shared instance either: every remaining live
        // `xhr = new XMLHttpRequest()` must be a LOCAL (var/let) declaration
        // (setupXhr in utils/events.js owns creation for send()).
        assert.doesNotMatch(codeSrc, /^\s{4}var xhr\s+=\s+null;/m,
            'the module-scope shared xhr is still declared');
        assert.doesNotMatch(codeSrc, /^\s+xhr = new XMLHttpRequest\(\);/m,
            'an init-time shared-xhr creation survives as code');
    });

    it('01.2 - the loadend fail-safe release is registered per send', function () {
        var block = extractBlock(codeSrc, "xhr.addEventListener('loadend', function onSendSettled() {");
        assert.notStrictEqual(block.indexOf('$form.isSending = false'), -1);
        assert.notStrictEqual(block.indexOf('$form.sent = false'), -1);
        assert.notStrictEqual(block.indexOf("removeAttribute('aria-disabled')"), -1);
        assert.notStrictEqual(block.indexOf("removeAttribute('disabled')"), -1);
        assert.notStrictEqual(block.indexOf("removeAttribute('data-gina-form-loading')"), -1);
        // Release-only: the fail-safe must never arm anything
        assert.strictEqual(block.indexOf('setAttribute'), -1,
            'the loadend release must not arm');
    });

    it('01.3 - isSending spans send()->settled (no readyState-1 clear)', function () {
        // The handler's opening must NOT clear isSending anymore …
        var handlerHead = codeSrc.slice(
            codeSrc.indexOf('function onValidationCallback(event)'),
            codeSrc.indexOf('var redirectDelay')
        );
        assert.strictEqual(handlerHead.indexOf('$form.isSending = false'), -1,
            'isSending is still cleared at the readyState-1 firing');
        assert.notStrictEqual(handlerHead.indexOf('$form.isSubmitting = false'), -1,
            'isSubmitting handling must stay');
        // … and the readyState-4 release must clear it.
        var rs4 = codeSrc.slice(codeSrc.indexOf('if (xhr.readyState == 4)'));
        rs4 = rs4.slice(0, rs4.indexOf('$form.target.removeAttribute'));
        assert.notStrictEqual(rs4.indexOf('$form.isSending = false'), -1,
            'the readyState-4 release must clear isSending');
    });

    it('01.4 - the timeout path removes data-gina-form-loading', function () {
        var ontimeout = extractBlock(codeSrc, 'xhr.ontimeout = function (event) {');
        assert.notStrictEqual(ontimeout.indexOf("removeAttribute('data-gina-form-loading')"), -1,
            'timeout must remove the loading attribute');
        assert.doesNotMatch(ontimeout, /setAttribute\('data-gina-form-loading',\s*false\)/,
            "the truthy string-\"false\" write survives as code");
    });

    it('01.z - control: the pins CAN miss (pre-fix shapes fail them)', function () {
        var preFix = "        if (!xhr) {\n            xhr = setupXhr(options);\n        }\n"
                   + "                $form.target.setAttribute('data-gina-form-loading', false);\n";
        assert.notStrictEqual(preFix.indexOf('if (!xhr)'), -1);
        assert.strictEqual(preFix.indexOf('var xhr = setupXhr();'), -1);
        assert.match(preFix, /setAttribute\('data-gina-form-loading',\s*false\)/);
    });
});

describe('02 - #B175 behavioural: jsdom XMLHttpRequest', function () {

    var { JSDOM } = require('jsdom');
    // Port 1 answers nothing — sends fail fast, which is exactly what the
    // fail-safe must survive.
    var dom = new JSDOM('<!doctype html><body>'
        + '<form id="A"><button id="A-submit">go</button></form>'
        + '</body>', { url: 'http://127.0.0.1:1/' });
    var win = dom.window;

    it('02.1 - the defect mechanism: re-open() of a COMPLETED shared xhr fires the stale handler', function (t, done) {
        var xhr = new win.XMLHttpRequest();
        var staleFired = [];
        xhr.open('POST', 'http://127.0.0.1:1/sink');
        xhr.onreadystatechange = function previousSubmitHandler() {
            staleFired.push(xhr.readyState);
        };
        xhr.send('a=1');
        xhr.addEventListener('loadend', function () {
            var before = staleFired.length;
            // the "second submit" on the SHARED instance — the pre-fix shape
            xhr.open('POST', 'http://127.0.0.1:1/sink');
            assert.ok(staleFired.length > before,
                'the stale handler must fire at re-open (readyState 4 -> 1)');
            assert.strictEqual(staleFired[staleFired.length - 1], 1,
                'the replay fires at readyState 1 - the arm branch');
            done();
        });
    });

    it('02.2 - the fix shape: a fresh xhr per send leaves the old handler silent', function (t, done) {
        var first = new win.XMLHttpRequest();
        var staleFired = [];
        first.open('POST', 'http://127.0.0.1:1/sink');
        first.onreadystatechange = function previousSubmitHandler() {
            staleFired.push('first@' + first.readyState);
        };
        first.send('a=1');
        first.addEventListener('loadend', function () {
            var before = staleFired.length;
            // the "second submit" builds its OWN xhr — the fixed shape
            var second = new win.XMLHttpRequest();
            second.open('POST', 'http://127.0.0.1:1/sink');
            assert.strictEqual(staleFired.length, before,
                'the previous submit handler must NOT fire during the new open');
            done();
        });
    });

    it('02.3 - the REAL extracted onSendSettled release, executed on a failing request', function (t, done) {
        var fnText = extractBlock(mainSrc, "function onSendSettled() {");
        /* eslint-disable no-new-func */
        var makeRelease = new win.Function('$form', '$submitTrigger', 'return ' + fnText + ';');

        var $formTarget = win.document.getElementById('A');
        var $submitTrigger = win.document.getElementById('A-submit');
        var $form = { target: $formTarget, isSending: true, sent: true };

        // Arm exactly what send() arms
        $formTarget.setAttribute('data-gina-form-loading', true);
        $submitTrigger.setAttribute('disabled', true);

        var xhr = new win.XMLHttpRequest();
        xhr.addEventListener('loadend', makeRelease($form, $submitTrigger));
        xhr.open('POST', 'http://127.0.0.1:1/sink');
        xhr.send('a=1');
        xhr.addEventListener('loadend', function assertReleased() {
            assert.strictEqual($formTarget.hasAttribute('data-gina-form-loading'), false,
                'loading flag must be released on a FAILED request');
            assert.strictEqual($submitTrigger.hasAttribute('disabled'), false,
                'the submit trigger must be released on a FAILED request');
            assert.strictEqual($form.isSending, false, 'isSending must settle');
            assert.strictEqual($form.sent, false, 'sent must settle');
            done();
        });
    });

    it('02.4 - subtract control: without the release, a failed request strands the lock', function (t, done) {
        var $formTarget = win.document.createElement('form');
        var $submitTrigger = win.document.createElement('button');
        $formTarget.setAttribute('data-gina-form-loading', true);
        $submitTrigger.setAttribute('disabled', true);

        var xhr = new win.XMLHttpRequest();
        // No release registered — the pre-fix state for any non-readyState-4 settle
        xhr.open('POST', 'http://127.0.0.1:1/sink');
        xhr.send('a=1');
        xhr.addEventListener('loadend', function () {
            assert.strictEqual($formTarget.hasAttribute('data-gina-form-loading'), true,
                'control: with no fail-safe the lock stays armed');
            assert.strictEqual($submitTrigger.hasAttribute('disabled'), true);
            done();
        });
    });
});

describe('03 - #B175 dist fidelity (built bundle carries the fix)', function () {

    var distDir = path.join(fwPath, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js');
    var distSrc = fs.readFileSync(path.join(distDir, 'gina.js')).toString();
    var distMin = fs.readFileSync(path.join(distDir, 'gina.min.js')).toString();

    it('03.1 - unminified dist carries the fresh-per-send + fail-safe shapes', function () {
        assert.notStrictEqual(distSrc.indexOf('onSendSettled'), -1,
            'gina.js must carry the loadend release');
        assert.notStrictEqual(distSrc.indexOf('var xhr = setupXhr();'), -1,
            'gina.js must carry the fresh local XHR');
    });

    it('03.2 - minified dist registers the loadend release (string survives Closure)', function () {
        // Quote- and wrap-agnostic (this toolchain emits single quotes). The
        // `isSending=!1` opening distinguishes the release from the two
        // pre-existing FileReader loadend listeners (arrows, other bodies).
        assert.match(distMin,
            /addEventListener\(\s*['"]loadend['"]\s*,\s*function\s*\(\s*\)\s*\{\s*\w+\.isSending\s*=\s*!1/,
            'gina.min.js must register the loadend release');
    });
});
