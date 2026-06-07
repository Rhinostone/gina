var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var POPIN_SRC    = path.join(FW, 'core/asset/plugin/src/vendor/gina/popin/main.js');
var EVENTS_SRC   = path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/events.js');
var BINDING_SRC  = path.join(FW, 'core/asset/plugin/src/vendor/gina/helpers/binding.js');
var DIST_JS      = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var _popinSrc, _eventsSrc, _bindingSrc, _distSrc;
function getPopinSrc()  { return _popinSrc  || (_popinSrc  = fs.readFileSync(POPIN_SRC, 'utf8')); }
function getEventsSrc() { return _eventsSrc || (_eventsSrc = fs.readFileSync(EVENTS_SRC, 'utf8')); }
function getBindingSrc(){ return _bindingSrc|| (_bindingSrc= fs.readFileSync(BINDING_SRC, 'utf8')); }
function getDistSrc()   { return _distSrc   || (_distSrc   = fs.readFileSync(DIST_JS, 'utf8')); }


// ── 01 — Popin performance: crypto.randomUUID() replaced by _nextId() ─────────

describe('01 - Popin perf: _nextId() replaces crypto.randomUUID()', function() {

    it('_nextId function is defined', function() {
        assert.ok(
            /function\s+_nextId\s*\(/.test(getPopinSrc()),
            'expected _nextId function declaration in popin/main.js'
        );
    });

    it('no crypto.randomUUID() calls remain in popin source', function() {
        // Only allowed in comments (lines starting with // or inside JSDoc)
        var lines = getPopinSrc().split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (/crypto\.randomUUID\(\)/.test(line) && !/^(\/\/|\*)/.test(line)) {
                assert.fail('crypto.randomUUID() found in executable code at line ' + (i + 1) + ': ' + line);
            }
        }
    });

    it('_nextId is used for instance ID', function() {
        assert.ok(
            /id\s*:\s*'gina-popins-'\s*\+\s*_nextId\(\)/.test(getPopinSrc()),
            'expected _nextId() in instance id assignment'
        );
    });
});


// ── 02 — Popin perf: querySelectorAll replaces getElementsByAttribute ──────────

describe('02 - Popin perf: querySelectorAll for DOM scanning', function() {

    it('uses querySelectorAll for data-gina-popin-name', function() {
        assert.ok(
            getPopinSrc().indexOf("document.querySelectorAll('[' + attr + ']')") > -1,
            'expected querySelectorAll for popin name attribute lookup'
        );
    });

    it('uses querySelectorAll for .gina-popin-close', function() {
        var matches = getPopinSrc().match(/querySelectorAll\('\.gina-popin-close'\)/g);
        assert.ok(
            matches && matches.length >= 2,
            'expected at least 2 querySelectorAll calls for .gina-popin-close (popinBind + overlay)'
        );
    });

    it('no getElementsByAttribute calls remain', function() {
        // getElementsByAttribute is the old full-DOM scan helper
        assert.ok(
            getPopinSrc().indexOf('getElementsByAttribute(') === -1,
            'getElementsByAttribute should be replaced by querySelectorAll'
        );
    });
});


// ── 03 — Popin perf: classList API replaces className string manipulation ──────

describe('03 - Popin perf: classList API', function() {

    it('uses classList.add for gina-popin-is-active', function() {
        assert.ok(
            getPopinSrc().indexOf("classList.add('gina-popin-is-active')") > -1,
            'expected classList.add for activation'
        );
    });

    it('uses classList.remove for gina-popin-is-active', function() {
        assert.ok(
            getPopinSrc().indexOf("classList.remove('gina-popin-is-active')") > -1,
            'expected classList.remove for deactivation'
        );
    });

    it('uses classList.contains for gina-popin-is-active checks', function() {
        assert.ok(
            getPopinSrc().indexOf("classList.contains('gina-popin-is-active')") > -1,
            'expected classList.contains for class presence checks'
        );
    });

    it('no className += gina-popin-is-active concatenation remains', function() {
        assert.ok(
            !/className\s*\+=\s*.*gina-popin-is-active/.test(getPopinSrc()),
            'className string concatenation for gina-popin-is-active should be replaced by classList'
        );
    });
});


// ── 04 — Popin perf: cached RegExp for click handler ──────────────────────────

describe('04 - Popin perf: cached RegExp', function() {

    it('_rePopinClick is defined once', function() {
        assert.ok(
            /var\s+_rePopinClick\s*=\s*new\s+RegExp/.test(getPopinSrc()),
            'expected _rePopinClick cached regex'
        );
    });

    it('click handlers use _rePopinClick instead of new RegExp', function() {
        var matches = getPopinSrc().match(/_rePopinClick\.test\(/g);
        assert.ok(
            matches && matches.length >= 2,
            'expected at least 2 uses of _rePopinClick.test()'
        );
    });

    it('no inline RegExp with instance.id for popin click matching in executable code', function() {
        // The general prefix check (without instance.id) at line 222 is intentional
        // Line 223 is a commented-out variant — only executable code matters
        var src = getPopinSrc();
        var lines = src.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (/new\s+RegExp.*popin\.click\.gina-popin-.*instance\.id/.test(line) && !/^\/\//.test(line)) {
                assert.fail('inline RegExp with instance.id in executable code at line ' + (i + 1));
            }
        }
    });
});


// ── 05 — Popin perf: getScript/getStyle use DOM injection ─────────────────────

describe('05 - Popin perf: getScript/getStyle DOM injection', function() {

    it('getScript creates a <script> element', function() {
        assert.ok(
            /document\.createElement\('script'\)/.test(getPopinSrc()),
            'expected document.createElement(script) in getScript'
        );
    });

    it('getStyle creates a <link> element', function() {
        assert.ok(
            /document\.createElement\('link'\)/.test(getPopinSrc()),
            'expected document.createElement(link) in getStyle'
        );
    });

    it('no eval() in getScript or getStyle', function() {
        // Find getScript and getStyle function bodies and verify no eval() in executable code
        var src = getPopinSrc();
        var scriptFn = src.substring(
            src.indexOf('function getScript('),
            src.indexOf('function getStyle(')
        );
        var styleFn = src.substring(
            src.indexOf('function getStyle('),
            src.indexOf('function refreshCSS(')
        );
        // Filter out comments (lines with * or //) before checking for eval
        var scriptLines = scriptFn.split('\n').filter(function(l) {
            return !/^\s*(\/\/|\*|\*\/)/.test(l.trim());
        }).join('\n');
        var styleLines = styleFn.split('\n').filter(function(l) {
            return !/^\s*(\/\/|\*|\*\/)/.test(l.trim());
        }).join('\n');
        assert.ok(
            scriptLines.indexOf('eval(') === -1,
            'eval() must not appear in getScript executable code'
        );
        assert.ok(
            styleLines.indexOf('eval(') === -1,
            'eval() must not appear in getStyle executable code'
        );
    });

    it('getScript and getStyle track headers on $popin for cleanup', function() {
        assert.ok(
            /\$popin\.\$headers\.push/.test(getPopinSrc()),
            'expected $headers tracking for injected resources'
        );
    });
});


// ── 06 — Popin perf: double popinBind guard ───────────────────────────────────

describe('06 - Popin perf: popinBind dedup guard in popinOpen', function() {

    it('popinOpen guards popinBind with gina.popinIsBinded check', function() {
        var src = getPopinSrc();
        // Find the popinOpen function — needs enough range to reach the guard
        var fnStart = src.indexOf('function popinOpen(');
        var fnBlock = src.substring(fnStart, fnStart + 4000);
        assert.ok(
            /if\s*\(!gina\.popinIsBinded\)/.test(fnBlock),
            'expected gina.popinIsBinded guard before popinBind in popinOpen'
        );
    });
});


// ── 07 — Popin perf: per-load XHR ────────────────────────────────────────────

describe('07 - Popin perf: per-load XMLHttpRequest', function() {

    it('popinLoad creates a local xhr', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function popinLoad(');
        var fnBlock = src.substring(fnStart, fnStart + 6000);
        assert.ok(
            /\/\/\s*Fresh XHR per load/.test(fnBlock),
            'expected per-load XHR comment marker in popinLoad'
        );
        assert.ok(
            fnBlock.indexOf('var xhr = null;') > -1,
            'expected local var xhr declaration in popinLoad'
        );
    });

    it('registerPopin does not create xhr', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function registerPopin(');
        // End at var init (which uses = function, not function declaration)
        var fnBlock = src.substring(fnStart, src.indexOf('var init = function'));
        assert.ok(
            fnBlock.indexOf('new XMLHttpRequest()') === -1,
            'registerPopin should not create XMLHttpRequest (moved to popinLoad)'
        );
    });
});


// ── 08 — Popin: popinDestroy implementation ───────────────────────────────────

describe('08 - Popin: popinDestroy is fully implemented', function() {

    it('popinDestroy closes the popin if open', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function popinDestroy(');
        var fnEnd = src.indexOf('\n        function', fnStart + 1);
        var fnBlock = src.substring(fnStart, fnEnd);
        assert.ok(
            /popinClose\(name\)/.test(fnBlock),
            'expected popinClose call in popinDestroy'
        );
    });

    it('popinDestroy removes the DOM element', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function popinDestroy(');
        var fnEnd = src.indexOf('\n        function', fnStart + 1);
        var fnBlock = src.substring(fnStart, fnEnd);
        assert.ok(
            /\$el\.remove\(\)/.test(fnBlock),
            'expected DOM element removal in popinDestroy'
        );
    });

    it('popinDestroy cleans up instance.$popins registry', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function popinDestroy(');
        var fnEnd = src.indexOf('\n        function', fnStart + 1);
        var fnBlock = src.substring(fnStart, fnEnd);
        assert.ok(
            /delete\s+instance\.\$popins\[id\]/.test(fnBlock),
            'expected delete instance.$popins[id]'
        );
    });

    it('popinDestroy cleans up registeredPopins array', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function popinDestroy(');
        var fnEnd = src.indexOf('\n        function', fnStart + 1);
        var fnBlock = src.substring(fnStart, fnEnd);
        assert.ok(
            /registeredPopins\.splice/.test(fnBlock),
            'expected registeredPopins splice in popinDestroy'
        );
    });

    it('popinDestroy fires the destroy event', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function popinDestroy(');
        var fnEnd = src.indexOf('\n        function', fnStart + 1);
        var fnBlock = src.substring(fnStart, fnEnd);
        assert.ok(
            /triggerEvent\(gina,\s*instance\.target,\s*'destroy\.'/.test(fnBlock),
            'expected destroy event trigger'
        );
    });

    it('destroy is exposed on instance proto', function() {
        assert.ok(
            /instance\.destroy\s*=\s*popinDestroy/.test(getPopinSrc()),
            'expected instance.destroy = popinDestroy in setupInstanceProto'
        );
    });
});


// ── 09 — Popin: registeredPopins is populated ─────────────────────────────────

describe('09 - Popin: registeredPopins is populated on registration', function() {

    it('registerPopin pushes to registeredPopins', function() {
        var src = getPopinSrc();
        var fnStart = src.indexOf('function registerPopin(');
        var fnBlock = src.substring(fnStart, fnStart + 1500);
        assert.ok(
            /registeredPopins\.push\(\$popin\.options\['name'\]\)/.test(fnBlock),
            'expected registeredPopins.push in registerPopin'
        );
    });
});


// ── 10 — events.js: malformed regex fix ───────────────────────────────────────

describe('10 - events.js: regex fix in XHR error handler', function() {

    it('regex test is correctly formed (/.test() not between delimiters)', function() {
        var src = getEventsSrc();
        // The old buggy form: /^(\{|\[).test( xhr.responseText ) /
        assert.ok(
            src.indexOf('.test( xhr.responseText ) /') === -1,
            'malformed regex (closing / after .test()) should be fixed'
        );
    });

    it('correct regex form exists', function() {
        assert.ok(
            getEventsSrc().indexOf("/^(\\{|\\[)/.test( xhr.responseText )") > -1,
            'expected properly formed /^({|[)/.test(xhr.responseText)'
        );
    });
});


// ── 11 — events.js: hearder typo fix ─────────────────────────────────────────

describe('11 - events.js: header variable name fix', function() {

    it('no "hearder" typo remains', function() {
        assert.ok(
            getEventsSrc().indexOf('hearder') === -1,
            'typo "hearder" should be replaced with "header"'
        );
    });

    it('"for (var header in options.headers)" exists', function() {
        var matches = getEventsSrc().match(/for\s*\(var\s+header\s+in\s+options\.headers\)/g);
        assert.ok(
            matches && matches.length >= 1,
            'expected corrected "header" loop variable'
        );
    });
});


// ── 12 — binding.js: operator precedence fix ──────────────────────────────────

describe('12 - binding.js: operator precedence in error logging', function() {

    it('err.stack || err is wrapped in parentheses', function() {
        assert.ok(
            getBindingSrc().indexOf('(err.stack || err)') > -1,
            'expected (err.stack || err) with parens to fix precedence'
        );
    });

    it('old unparenthesized form is gone', function() {
        // The old form: + err.stack || err  (without parens around ||)
        // Must not match the fixed form which has parens
        var src = getBindingSrc();
        var lines = src.split('\n');
        for (var i = 0; i < lines.length; i++) {
            if (/\+\s*err\.stack\s*\|\|\s*err[^)]/.test(lines[i])) {
                assert.fail('unparenthesized err.stack || err found at line ' + (i + 1));
            }
        }
    });
});


// ── 13 — dist bundle includes all changes ─────────────────────────────────────

describe('13 - dist/gina.min.js reflects source changes', function() {

    it('dist contains _nextId function', function() {
        assert.ok(
            /function\s+_nextId/.test(getDistSrc()),
            'expected _nextId in built dist/gina.min.js'
        );
    });

    it('dist contains no crypto.randomUUID in popin module', function() {
        // The popin AMD module in the bundle should not contain crypto.randomUUID
        var distSrc = getDistSrc();
        var popinStart = distSrc.indexOf("define('gina/popin'");
        if (popinStart === -1) {
            assert.fail('gina/popin AMD module not found in dist bundle');
        }
        var popinBlock = distSrc.substring(popinStart, popinStart + 20000);
        var lines = popinBlock.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (/crypto\.randomUUID\(\)/.test(line) && !/^(\/\/|\*)/.test(line)) {
                assert.fail('crypto.randomUUID() in dist popin module at line ' + (i + 1));
            }
        }
    });

    it('dist contains corrected regex in events module', function() {
        assert.ok(
            getDistSrc().indexOf("/^(\\{|\\[)/.test( xhr.responseText )") > -1,
            'expected fixed regex in dist'
        );
    });

    it('dist contains operator precedence fix in binding module', function() {
        assert.ok(
            getDistSrc().indexOf('(err.stack || err)') > -1,
            'expected parenthesized err.stack || err in dist'
        );
    });
});


// ── 14 — Popin: no inline onclick injection on close (CSP script-src-attr) ─────
//
// The close-binding loop used to inject `onclick="return false;"` on every
// .gina-popin-close element. Under a nonce-based CSP (a 'nonce-…' in script-src,
// no effective 'unsafe-inline'), a nonce disables 'unsafe-inline' for inline
// event-handler attributes (script-src-attr), so the injected handler is reported
// (report-only) or blocked (enforce). It was redundant: register('close', …)
// attaches a click listener that calls cancelEvent() (preventDefault) on every
// click, so an <a href="#"> default action is already suppressed. Injection removed.

describe('14 - Popin: no inline onclick injection on close (CSP-safe)', function() {

    function getDistPopinBlock() {
        var distSrc = getDistSrc();
        var start = distSrc.indexOf("define('gina/popin'");
        assert.ok(start > -1, 'gina/popin AMD module not found in dist bundle');
        var next = distSrc.indexOf('\ndefine(', start + 20);
        return (next > -1) ? distSrc.substring(start, next) : distSrc.substring(start);
    }

    it('popin source no longer injects an inline onclick handler', function() {
        assert.equal(
            getPopinSrc().indexOf("setAttribute('onclick'"), -1,
            "popin/main.js must not set an inline onclick attribute (trips CSP script-src-attr under nonce policies)"
        );
    });

    it('the dead onclickAttribute local is gone', function() {
        assert.equal(
            getPopinSrc().indexOf('onclickAttribute'), -1,
            'the onclickAttribute variable (and its never-written-back append branch) should be removed'
        );
    });

    it("close behaviour is still wired via register('close', …)", function() {
        assert.ok(
            /register\('close',\s*evt,\s*\$close\[b\]\)/.test(getPopinSrc()),
            "expected register('close', evt, $close[b]) to still bind the close listener"
        );
    });

    it('cancelEvent (relied on by the close listener) calls preventDefault', function() {
        // This is what makes removing the inline onclick safe: the registered click
        // listener suppresses the default <a href="#"> navigation itself.
        var ev = getEventsSrc();
        var start = ev.indexOf('function cancelEvent');
        assert.ok(start > -1, 'cancelEvent function not found in events.js');
        var body = ev.substring(start, start + 400);
        assert.ok(
            body.indexOf('preventDefault') > -1,
            'cancelEvent must call preventDefault (close-listener default suppression)'
        );
    });

    it('rebuilt dist popin module contains no inline onclick injection', function() {
        assert.equal(
            getDistPopinBlock().indexOf("setAttribute('onclick'"), -1,
            'the built gina/popin module must not inject an inline onclick attribute'
        );
    });
});


// ── 15 — Popin: showModal()-only (dev/prod parity), overlay gates de-env'd ─────
//
// Dialog popins now open as native modals in EVERY env. The dev-only downgrade
// (non-modal show() + a manual .gina-popins-overlay, gated on gina.config.envIsDev)
// was removed: popinOpen calls $el.showModal() unconditionally, and the three
// overlay gates dropped their `|| gina.config.envIsDev` disjunct so the manual
// overlay survives only for non-dialog mode (!useDialogMode). A consumer's
// skeleton-preopen observer must also use showModal() so the dialog is born modal
// and the !getAttribute('open') guard then skips popinOpen's own call (re-showModal
// on an already-open dialog throws). Verified end-to-end in a real preemptive-open
// consumer (native modal, real form, no overlay, no double-dim). Replaces the
// reverted "Option F" dev-modal + in-dialog launcher experiment.

describe('15 - Popin: showModal()-only dev/prod parity', function() {

    function getDistPopinBlock() {
        var distSrc = getDistSrc();
        var start = distSrc.indexOf("define('gina/popin'");
        assert.ok(start > -1, 'gina/popin AMD module not found in dist bundle');
        var next = distSrc.indexOf('\ndefine(', start + 20);
        return (next > -1) ? distSrc.substring(start, next) : distSrc.substring(start);
    }

    it('source: overlay gates no longer carry the gina.config.envIsDev disjunct', function() {
        assert.equal(
            getPopinSrc().indexOf('useDialogMode || gina.config.envIsDev'), -1,
            'the 3 overlay gates must be `!self.options.useDialogMode` only (no `|| gina.config.envIsDev`)'
        );
    });

    it('source: the dialog-open branch calls $el.showModal() unconditionally', function() {
        assert.ok(
            getPopinSrc().indexOf('$el.showModal();') > -1,
            'popinOpen must call $el.showModal() in the dialog-open branch'
        );
    });

    it('source: the dev-only $el.show() downgrade is gone', function() {
        assert.equal(
            getPopinSrc().indexOf('$el.show()'), -1,
            'the non-modal dev $el.show() downgrade must be removed (showModal()-only)'
        );
    });

    it("source: the `useDialogMode && !$el.getAttribute('open')` guard is preserved", function() {
        assert.ok(
            /useDialogMode\s*&&\s*!\$el\.getAttribute\('open'\)/.test(getPopinSrc()),
            "popinOpen must keep the open-guard so a consumer-preopened modal is not re-shown (re-showModal throws)"
        );
    });

    it('dist: built popin module reflects showModal()-only (no env gate, no $el.show())', function() {
        var block = getDistPopinBlock();
        assert.equal(
            block.indexOf('useDialogMode || gina.config.envIsDev'), -1,
            'built popin module must not carry the envIsDev overlay-gate disjunct'
        );
        assert.equal(
            block.indexOf('$el.show()'), -1,
            'built popin module must not contain the dev $el.show() downgrade'
        );
        assert.ok(
            block.indexOf('$el.showModal()') > -1,
            'built popin module must call $el.showModal()'
        );
    });
});


// ── 16 — Popin: opt-in skeleton-loading pre-open (preOpen + loadingShell) ──────
//
// showLoadingShell($popin, $el) fills a popin with a loading skeleton and opens it
// born-modal BEFORE the XHR returns, gated on the per-popin `preOpen` option. The
// optional `loadingShell` lets a consumer pass its own markup (so it can delete its
// own pre-open observer and keep its look); otherwise a generic gina-namespaced
// default skeleton (GINA_DEFAULT_LOADING_SHELL, styled by .gina-popin-skeleton* in
// popin.css) is used. It is invoked at BOTH loading-attr write sites and is
// idempotent (the open/active guard makes it fire at most once per load). On
// completion popinBind replaces the skeleton with the real HTML and popinOpen's
// !$el.getAttribute('open') guard skips its own open.
//
// Strategy (same convention as validator-aria-invalid / validator-isinlist):
//  - a jsdom-backed DOM exercises a test-local replica of showLoadingShell.
//  - the source-inspection block pins the production source to the same logic so the
//    replica cannot silently drift. (jsdom ^29 has no native <dialog>.showModal(),
//    so the modal branch is exercised via a showModal spy on the element.)

var { JSDOM } = require('jsdom');

// Test-local replica of showLoadingShell($popin, $el) — MUST mirror popin/main.js.
// The source-inspection pins at the end lock the source-side shape to this.
var GINA_DEFAULT_LOADING_SHELL_REPLICA =
      '<div class="gina-popin-skeleton" aria-hidden="true">'
    +     '<div class="gina-popin-skeleton-line gina-popin-skeleton-title"></div>'
    +     '<div class="gina-popin-skeleton-line"></div>'
    +     '<div class="gina-popin-skeleton-line gina-popin-skeleton-line--short"></div>'
    + '</div>';

function showLoadingShellReplica($popin, $el) {
    if ( !$popin || !$el || !$popin.options || !$popin.options.preOpen ) {
        return;
    }
    if ( $el.hasAttribute('open') || $el.classList.contains('gina-popin-is-active') ) {
        return;
    }
    var shell = ( typeof($popin.options.loadingShell) == 'string' && $popin.options.loadingShell )
        ? $popin.options.loadingShell
        : GINA_DEFAULT_LOADING_SHELL_REPLICA;
    $el.innerHTML = shell;

    if ( $el.tagName === 'DIALOG' ) {
        if ( typeof($el.showModal) === 'function' ) {
            try { $el.showModal(); } catch (e) {}
        } else {
            $el.setAttribute('open', true);
        }
    } else {
        $el.classList.add('gina-popin-is-active');
        var $overlay = $el.parentElement;
        if ( $overlay && !$overlay.classList.contains('gina-popin-is-active') ) {
            $overlay.classList.add('gina-popin-is-active');
        }
    }
}

function makeDoc() {
    return new JSDOM('<!DOCTYPE html><body></body>').window.document;
}
// jsdom has no native dialog.showModal(); attach a spy so the modal branch runs.
function makeDialog(doc, withShowModalSpy) {
    var $el = doc.createElement('dialog');
    $el.className = 'gina-popin-container';
    doc.body.appendChild($el);
    var calls = { showModal: 0 };
    if (withShowModalSpy) {
        $el.showModal = function () { calls.showModal++; $el.setAttribute('open', ''); };
    }
    return { $el: $el, calls: calls };
}
function makeDiv(doc) {
    var $overlay = doc.createElement('div');
    $overlay.className = 'gina-popins-overlay';
    var $el = doc.createElement('div');
    $el.className = 'gina-popin-container';
    $overlay.appendChild($el);
    doc.body.appendChild($overlay);
    return { $el: $el, $overlay: $overlay };
}

describe('16 - Popin: opt-in skeleton pre-open (preOpen + loadingShell)', function () {

    // --- behavioral (jsdom + replica) ---

    it('preOpen:false → no-op (no skeleton, dialog stays closed)', function () {
        var d = makeDialog(makeDoc(), true);
        showLoadingShellReplica({ options: { preOpen: false } }, d.$el);
        assert.equal(d.$el.innerHTML, '', 'no skeleton injected when preOpen is off');
        assert.equal(d.calls.showModal, 0, 'dialog not opened when preOpen is off');
        assert.equal(d.$el.hasAttribute('open'), false);
    });

    it('preOpen:true, no loadingShell → gina default skeleton + showModal (born modal)', function () {
        var d = makeDialog(makeDoc(), true);
        showLoadingShellReplica({ options: { preOpen: true } }, d.$el);
        assert.ok(d.$el.querySelector('.gina-popin-skeleton'), 'gina default skeleton injected');
        assert.ok(d.$el.querySelector('.gina-popin-skeleton-title'), 'skeleton title line injected');
        assert.equal(d.calls.showModal, 1, 'dialog opened as native modal');
        assert.ok(d.$el.hasAttribute('open'), 'open attribute set by showModal');
    });

    it('preOpen:true, custom loadingShell → consumer markup wins (no gina default)', function () {
        var d = makeDialog(makeDoc(), true);
        var custom = '<div class="my-skel"><span>loading…</span></div>';
        showLoadingShellReplica({ options: { preOpen: true, loadingShell: custom } }, d.$el);
        assert.ok(d.$el.querySelector('.my-skel'), 'consumer loadingShell injected');
        assert.equal(d.$el.querySelector('.gina-popin-skeleton'), null, 'gina default NOT used when loadingShell provided');
        assert.equal(d.calls.showModal, 1, 'dialog still opened');
    });

    it('idempotent: second call no-ops (open dialog not re-shown)', function () {
        var d = makeDialog(makeDoc(), true);
        var $popin = { options: { preOpen: true } };
        showLoadingShellReplica($popin, d.$el);   // write site 1
        showLoadingShellReplica($popin, d.$el);   // write site 2 — dialog already open
        assert.equal(d.calls.showModal, 1, 'showModal called once across the two loading-attr write sites');
    });

    it('showModal unavailable → setAttribute(open) fallback', function () {
        var d = makeDialog(makeDoc(), false);   // no spy → typeof($el.showModal) !== 'function'
        showLoadingShellReplica({ options: { preOpen: true } }, d.$el);
        assert.ok(d.$el.querySelector('.gina-popin-skeleton'), 'skeleton injected');
        assert.ok(d.$el.hasAttribute('open'), 'open attribute set via fallback when showModal unavailable');
    });

    it('div mode → activates container + overlay (no native modal)', function () {
        var d = makeDiv(makeDoc());
        showLoadingShellReplica({ options: { preOpen: true } }, d.$el);
        assert.ok(d.$el.querySelector('.gina-popin-skeleton'), 'skeleton injected in div mode');
        assert.ok(d.$el.classList.contains('gina-popin-is-active'), 'container activated');
        assert.ok(d.$overlay.classList.contains('gina-popin-is-active'), 'overlay activated');
    });

    it('div mode idempotent: second call no-ops (already active)', function () {
        var d = makeDiv(makeDoc());
        var $popin = { options: { preOpen: true } };
        showLoadingShellReplica($popin, d.$el);
        var firstHtml = d.$el.innerHTML;
        showLoadingShellReplica($popin, d.$el);
        assert.equal(d.$el.innerHTML, firstHtml, 'skeleton not re-injected once active');
    });

    // --- source pins (lock popin/main.js to the replica above) ---

    it('source: self.options declares preOpen:false default', function () {
        assert.ok(/'preOpen'\s*:\s*false/.test(getPopinSrc()), 'expected preOpen:false default in self.options');
    });

    it('source: self.options declares loadingShell:null default', function () {
        assert.ok(/'loadingShell'\s*:\s*null/.test(getPopinSrc()), 'expected loadingShell:null default in self.options');
    });

    it('source: showLoadingShell($popin, $el) is defined', function () {
        assert.ok(
            /function\s+showLoadingShell\s*\(\s*\$popin\s*,\s*\$el\s*\)/.test(getPopinSrc()),
            'expected showLoadingShell($popin, $el) declaration'
        );
    });

    it('source: GINA_DEFAULT_LOADING_SHELL const uses gina-namespaced skeleton classes', function () {
        var src = getPopinSrc();
        assert.ok(/var\s+GINA_DEFAULT_LOADING_SHELL\s*=/.test(src), 'expected GINA_DEFAULT_LOADING_SHELL const');
        assert.ok(src.indexOf('gina-popin-skeleton') > -1, 'expected gina-namespaced skeleton class');
    });

    it('source: opt-in gate reads $popin.options.preOpen', function () {
        assert.ok(/\$popin\.options\.preOpen/.test(getPopinSrc()), 'expected the preOpen opt-in gate');
    });

    it('source: idempotency guard uses hasAttribute(open) || is-active (not getAttribute)', function () {
        var src = getPopinSrc();
        var fnBlock = src.substring(src.indexOf('function showLoadingShell('), src.indexOf('function showLoadingShell(') + 2000);
        assert.ok(
            /hasAttribute\('open'\)\s*\|\|\s*\$el\.classList\.contains\('gina-popin-is-active'\)/.test(fnBlock),
            'expected idempotent hasAttribute(open) || classList.contains(is-active) guard'
        );
    });

    it('source: consumer loadingShell wins over the gina default', function () {
        var src = getPopinSrc();
        var fnBlock = src.substring(src.indexOf('function showLoadingShell('), src.indexOf('function showLoadingShell(') + 2000);
        assert.ok(
            /typeof\(\$popin\.options\.loadingShell\)\s*==\s*'string'\s*&&\s*\$popin\.options\.loadingShell/.test(fnBlock),
            'expected loadingShell-wins ternary'
        );
        assert.ok(/:\s*GINA_DEFAULT_LOADING_SHELL/.test(fnBlock), 'expected gina default fallback');
    });

    it('source: helper invoked at BOTH loading-attr write sites', function () {
        var matches = getPopinSrc().match(/showLoadingShell\(\$popin,\s*\$el\);/g);
        assert.ok(matches && matches.length >= 2, 'expected >= 2 showLoadingShell($popin, $el) call statements');
    });

    it('source: dialog branch opens born-modal via showModal()', function () {
        var src = getPopinSrc();
        var fnBlock = src.substring(src.indexOf('function showLoadingShell('), src.indexOf('function showLoadingShell(') + 2000);
        assert.ok(/\$el\.tagName\s*===\s*'DIALOG'/.test(fnBlock), 'expected dialog-tag branch');
        assert.ok(/\$el\.showModal\(\)/.test(fnBlock), 'expected showModal() call');
    });

    // --- dist pins (built bundle + concatenated CSS reflect the source) ---

    function getDistPopinBlock() {
        var distSrc = getDistSrc();
        var start = distSrc.indexOf("define('gina/popin'");
        assert.ok(start > -1, 'gina/popin AMD module not found in dist bundle');
        var next = distSrc.indexOf('\ndefine(', start + 20);
        return (next > -1) ? distSrc.substring(start, next) : distSrc.substring(start);
    }

    it('dist: built popin module contains the gina skeleton markup', function () {
        assert.ok(
            getDistPopinBlock().indexOf('gina-popin-skeleton') > -1,
            'built popin module must contain the default skeleton class'
        );
    });

    it('dist/gina.min.css contains the skeleton rules', function () {
        var css = fs.readFileSync(path.join(FW, 'core/asset/plugin/dist/vendor/gina/css/gina.min.css'), 'utf8');
        assert.ok(css.indexOf('gina-popin-skeleton') > -1, 'expected skeleton CSS concatenated into gina.min.css');
    });
});
