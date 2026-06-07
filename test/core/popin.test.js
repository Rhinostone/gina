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


// ── 15 — Popin: modal vs non-modal split (showModal for modal, show for non-modal) ─
//
// The dev-only env downgrade is still gone (the three overlay gates carry no
// `|| gina.config.envIsDev` disjunct; the manual .gina-popins-overlay survives only
// for non-dialog mode, !useDialogMode). What changed: the new `data-gina-dialog-*`
// API defaults to NON-modal, so popinOpen now branches on a resolved `useModal`
// boolean — `$el.showModal()` for the modal path, `$el.show()` (+ applyNonModalShims)
// for the non-modal path. Any path that does NOT set `$popin.modal` (legacy
// `data-gina-popin-*` triggers, direct popinOpen() calls) falls back to modal, so
// legacy parity is preserved (legacy popins stay showModal()-only). The
// `!getAttribute('open')` re-entry guard is kept (re-showModal/re-show on an
// already-open dialog throws). Replaces the prior "showModal()-only" pins, which were
// updated deliberately when the non-modal default was added (see plan Test 15).

describe('15 - Popin: modal/non-modal split (showModal vs show, legacy=modal)', function() {

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

    it('source: the dialog-open branch calls $el.showModal() for the modal path', function() {
        assert.ok(
            getPopinSrc().indexOf('$el.showModal();') > -1,
            'popinOpen must call $el.showModal() in the modal branch'
        );
    });

    it('source: a gated non-modal $el.show() branch exists (new-API default)', function() {
        var src = getPopinSrc();
        assert.ok(
            src.indexOf('$el.show()') > -1,
            'popinOpen must have a non-modal $el.show() branch (new data-gina-dialog default is non-modal)'
        );
        // It is gated on a resolved modal boolean, not unconditional — legacy/direct
        // paths fall back to modal (showModal).
        assert.ok(
            /var\s+useModal\s*=/.test(src),
            'expected a resolved `useModal` gate selecting showModal() vs show()'
        );
        assert.ok(
            /applyNonModalShims\s*\(/.test(src),
            'the non-modal branch must restore Escape/scroll-lock/inert via applyNonModalShims()'
        );
    });

    it("source: the `useDialogMode && !$el.getAttribute('open')` guard is preserved", function() {
        assert.ok(
            /useDialogMode\s*&&\s*!\$el\.getAttribute\('open'\)/.test(getPopinSrc()),
            "popinOpen must keep the open-guard so a consumer-preopened modal is not re-shown (re-showModal throws)"
        );
    });

    it('dist: built popin module reflects the modal/non-modal split (no env gate; both show() & showModal())', function() {
        var block = getDistPopinBlock();
        assert.equal(
            block.indexOf('useDialogMode || gina.config.envIsDev'), -1,
            'built popin module must not carry the envIsDev overlay-gate disjunct'
        );
        assert.ok(
            block.indexOf('$el.show()') > -1,
            'built popin module must contain the non-modal $el.show() branch'
        );
        assert.ok(
            block.indexOf('$el.showModal()') > -1,
            'built popin module must call $el.showModal() for the modal branch'
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


// ── 17–22 — new `data-gina-dialog-*` entry layer ─────────────────────────────────
//
// Behavioral jsdom tests of the strangler entry layer (resolveTrigger / resolveModal /
// warnDeprecatedOnce / applyContent / preload / a11y), each paired with a
// source-inspection block — the same convention as block 16 (showLoadingShell): a
// test-local replica exercises the logic in jsdom, and the source pins lock the
// production source's shape to the replica so it cannot silently drift.
//
// jsdom ^29 has no native <dialog>.showModal()/show(); the open-path branch selection
// is asserted via the descriptor (resolveModal) rather than the native method, and the
// shim helpers (Escape, focus) are exercised directly.

// Test-local replica factory mirroring resolveTrigger / resolveModal / warnDeprecatedOnce.
function makeEntryLayer(opts) {
    opts = opts || {};
    var selfOptions = { modal: (typeof opts.optionModal != 'undefined') ? opts.optionModal : null };
    var ginaConfig  = opts.config || null; // e.g. { popin: { modal: true } }
    var warnLog     = [];
    var _warned     = {};

    function warnDeprecatedOnce(kind) {
        if (_warned[kind]) { return; }
        _warned[kind] = true;
        warnLog.push(kind);
    }
    function resolveModal($trigger, isLegacy) {
        if (isLegacy || $trigger.getAttribute('data-gina-popin-name') != null) { return true; }
        var attr = $trigger.getAttribute('data-gina-dialog-modal');
        if (attr != null) { return (attr === 'false') ? false : true; }
        if (selfOptions.modal === true || selfOptions.modal === false) { return selfOptions.modal; }
        if (ginaConfig && ginaConfig.popin && (ginaConfig.popin.modal === true || ginaConfig.popin.modal === false)) {
            return ginaConfig.popin.modal;
        }
        return false;
    }
    function resolveTrigger($trigger) {
        var isLegacy = false;
        var id  = $trigger.getAttribute('data-gina-dialog');
        var src = $trigger.getAttribute('data-gina-dialog-src');
        if (id == null && $trigger.getAttribute('data-gina-popin-name') != null) {
            isLegacy = true; id = $trigger.getAttribute('data-gina-popin-name'); warnDeprecatedOnce('data-gina-popin-name');
        }
        if (src == null && $trigger.getAttribute('data-gina-popin-url') != null) {
            isLegacy = true; src = $trigger.getAttribute('data-gina-popin-url'); warnDeprecatedOnce('data-gina-popin-url');
        }
        if (src == null && /^A$/i.test($trigger.tagName)) {
            var href = $trigger.getAttribute('href');
            if (href && href != '' && href != '#' && !/^#/.test(href)) { src = href; }
        }
        return {
              id            : id
            , src           : src
            , isLegacy      : isLegacy
            , modal         : resolveModal($trigger, isLegacy)
            , partialTarget : $trigger.getAttribute('data-gina-dialog-target')
            , isLink        : /^true$/i.test($trigger.getAttribute('data-gina-popin-is-link'))
            , formSubmit    : /^true$/i.test($trigger.getAttribute('data-gina-form-submit'))
        };
    }
    return { resolveTrigger: resolveTrigger, resolveModal: resolveModal, warnLog: warnLog };
}

function mkTrigger(doc, tag, attrs) {
    var $el = doc.createElement(tag || 'button');
    for (var k in attrs) { $el.setAttribute(k, attrs[k]); }
    doc.body.appendChild($el);
    return $el;
}


// ── 17 — Attribute resolution (resolveTrigger) ────────────────────────────────────

describe('17 - Popin: resolveTrigger parses id/src/target', function () {

    it('new data-gina-dialog → id, no src, not legacy', function () {
        var doc = makeDoc();
        var d = makeEntryLayer().resolveTrigger(mkTrigger(doc, 'button', { 'data-gina-dialog': 'foo', 'type': 'button' }));
        assert.equal(d.id, 'foo');
        assert.equal(d.src, null);
        assert.equal(d.isLegacy, false);
    });

    it('data-gina-dialog-src → src; data-gina-dialog-target → partialTarget', function () {
        var doc = makeDoc();
        var d = makeEntryLayer().resolveTrigger(mkTrigger(doc, 'button', {
            'data-gina-dialog': 'foo', 'data-gina-dialog-src': '/load', 'data-gina-dialog-target': '#slot'
        }));
        assert.equal(d.src, '/load');
        assert.equal(d.partialTarget, '#slot');
    });

    it('<a href> doubles as src; "#" anchors ignored', function () {
        var doc = makeDoc();
        var d1 = makeEntryLayer().resolveTrigger(mkTrigger(doc, 'a', { 'data-gina-dialog': 'foo', 'href': '/page' }));
        assert.equal(d1.src, '/page');
        var d2 = makeEntryLayer().resolveTrigger(mkTrigger(doc, 'a', { 'data-gina-dialog': 'foo', 'href': '#' }));
        assert.equal(d2.src, null, '"#" href must not be treated as a src');
    });

    it('source: resolveTrigger($trigger) reads data-gina-dialog / -src / -target', function () {
        var src = getPopinSrc();
        assert.ok(/function\s+resolveTrigger\s*\(\s*\$trigger\s*\)/.test(src), 'expected resolveTrigger($trigger)');
        assert.ok(src.indexOf("getAttribute('data-gina-dialog')") > -1, 'expected data-gina-dialog read');
        assert.ok(src.indexOf("getAttribute('data-gina-dialog-src')") > -1, 'expected data-gina-dialog-src read');
        assert.ok(src.indexOf("getAttribute('data-gina-dialog-target')") > -1, 'expected data-gina-dialog-target read');
    });
});


// ── 18 — Modal precedence (resolveModal) ─────────────────────────────────────────

describe('18 - Popin: resolveModal precedence', function () {

    it('no attr, no config → non-modal (framework default)', function () {
        var doc = makeDoc();
        var el = makeEntryLayer();
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-dialog': 'x' }), false), false);
    });

    it('config.popin.modal:true → modal', function () {
        var doc = makeDoc();
        var el = makeEntryLayer({ config: { popin: { modal: true } } });
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-dialog': 'x' }), false), true);
    });

    it('data-gina-dialog-modal (bare) and ="true" → modal', function () {
        var doc = makeDoc();
        var el = makeEntryLayer();
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-dialog': 'x', 'data-gina-dialog-modal': '' }), false), true);
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-dialog': 'y', 'data-gina-dialog-modal': 'true' }), false), true);
    });

    it('data-gina-dialog-modal="false" overrides config.popin.modal:true → non-modal', function () {
        var doc = makeDoc();
        var el = makeEntryLayer({ config: { popin: { modal: true } } });
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-dialog': 'x', 'data-gina-dialog-modal': 'false' }), false), false);
    });

    it('per-popin option modal:true (no attr) → modal', function () {
        var doc = makeDoc();
        var el = makeEntryLayer({ optionModal: true });
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-dialog': 'x' }), false), true);
    });

    it('legacy data-gina-popin-* → modal regardless of config/option saying false', function () {
        var doc = makeDoc();
        var el = makeEntryLayer({ optionModal: false, config: { popin: { modal: false } } });
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-popin-name': 'leg' }), false), true);
        assert.equal(el.resolveModal(mkTrigger(doc, 'button', { 'data-gina-dialog': 'z' }), true), true, 'isLegacy flag also short-circuits');
    });

    it('source: resolveModal honors gina.config.popin.modal and ="false" override', function () {
        var src = getPopinSrc();
        assert.ok(/function\s+resolveModal\s*\(\s*\$trigger/.test(src), 'expected resolveModal($trigger, …)');
        assert.ok(/gina\.config\.popin\.modal/.test(src), 'expected lazy gina.config.popin.modal read');
        assert.ok(src.indexOf("attr === 'false'") > -1, 'expected the data-gina-dialog-modal==="false" → non-modal rule');
    });
});


// ── 19 — Legacy aliasing + warn-once ─────────────────────────────────────────────

describe('19 - Popin: legacy aliasing maps name/url + warns once per kind', function () {

    it('data-gina-popin-name → id, data-gina-popin-url → src, isLegacy true', function () {
        var doc = makeDoc();
        var d = makeEntryLayer().resolveTrigger(mkTrigger(doc, 'a', {
            'data-gina-popin-name': 'legacy', 'data-gina-popin-url': '/old'
        }));
        assert.equal(d.id, 'legacy');
        assert.equal(d.src, '/old');
        assert.equal(d.isLegacy, true);
    });

    it('one warn per kind → at most two distinct warnings across repeated triggers', function () {
        var doc = makeDoc();
        var el = makeEntryLayer();
        el.resolveTrigger(mkTrigger(doc, 'a', { 'data-gina-popin-name': 'a', 'data-gina-popin-url': '/1' }));
        el.resolveTrigger(mkTrigger(doc, 'a', { 'data-gina-popin-name': 'b', 'data-gina-popin-url': '/2' }));
        el.resolveTrigger(mkTrigger(doc, 'a', { 'data-gina-popin-name': 'c', 'data-gina-popin-url': '/3' }));
        assert.deepEqual(el.warnLog.sort(), ['data-gina-popin-name', 'data-gina-popin-url']);
    });

    it('engine-managed is-link / loading emit NO deprecation warning', function () {
        var doc = makeDoc();
        var el = makeEntryLayer();
        el.resolveTrigger(mkTrigger(doc, 'a', {
            'data-gina-popin-is-link': 'true', 'data-gina-popin-loading': 'true', 'href': '/x', 'data-gina-dialog': 'newapi'
        }));
        assert.equal(el.warnLog.length, 0, 'is-link/loading must not be deprecated (gina writes them itself)');
    });

    it('source: warnDeprecatedOnce only ever warns name/url (not is-link/loading)', function () {
        var src = getPopinSrc();
        assert.ok(/function\s+warnDeprecatedOnce\s*\(\s*kind\s*\)/.test(src), 'expected warnDeprecatedOnce(kind)');
        assert.ok(src.indexOf("warnDeprecatedOnce('data-gina-popin-name')") > -1, 'expected name warn call');
        assert.ok(src.indexOf("warnDeprecatedOnce('data-gina-popin-url')") > -1, 'expected url warn call');
        assert.equal(src.indexOf("warnDeprecatedOnce('data-gina-popin-is-link')"), -1, 'is-link must NOT be warned');
        assert.equal(src.indexOf("warnDeprecatedOnce('data-gina-popin-loading')"), -1, 'loading must NOT be warned');
    });
});


// ── 20 — Preload on hover/focus ──────────────────────────────────────────────────

// Replica of installPreload/consumePreload — same cache semantics: a reserved
// in-flight slot is `null`; `consumePreload` treats `null` as not-ready (== null).
function makePreload(netLog) {
    var preloadCache = {};
    function preloadFetch(url) { netLog.push(url); preloadCache[url] = 'BODY:' + url; } // synchronous "completion"
    function onIntentEl($trigger) {
        var url = $trigger.getAttribute('data-gina-dialog-src') || $trigger.getAttribute('data-gina-popin-url');
        if (!url || typeof preloadCache[url] != 'undefined') { return; }
        preloadCache[url] = null;   // reserve (dedup concurrent intents)
        preloadFetch(url);
    }
    function onMouseover(target) {
        var $trigger = target.closest ? target.closest('[data-gina-dialog-src],[data-gina-popin-url]') : null;
        if (!$trigger) { return; }
        onIntentEl($trigger);
    }
    function consumePreload(url) {
        if (preloadCache[url] == null) { return null; }
        var body = preloadCache[url];
        delete preloadCache[url];
        return body;
    }
    return { onMouseover: onMouseover, consumePreload: consumePreload, cache: preloadCache };
}

describe('20 - Popin: preload cache (hover/focus warms, open consumes + dedups)', function () {

    it('mouseover warms the cache; open consumes and deletes it', function () {
        var doc = makeDoc();
        var net = [];
        var pl = makePreload(net);
        var $trigger = mkTrigger(doc, 'button', { 'data-gina-dialog': 'd', 'data-gina-dialog-src': '/aj' });
        pl.onMouseover($trigger);
        assert.equal(net.length, 1, 'one network call on hover');
        assert.equal(pl.consumePreload('/aj'), 'BODY:/aj', 'open consumes the cached body');
        assert.equal(pl.consumePreload('/aj'), null, 'cache entry deleted after consume');
    });

    it('repeated mouseover over descendants → only one network call (URL-cache dedup)', function () {
        var doc = makeDoc();
        var net = [];
        var pl = makePreload(net);
        var $trigger = mkTrigger(doc, 'button', { 'data-gina-dialog': 'd', 'data-gina-dialog-src': '/aj' });
        var $child = doc.createElement('span');
        $trigger.appendChild($child);
        pl.onMouseover($child);
        pl.onMouseover($child);
        pl.onMouseover($trigger);
        assert.equal(net.length, 1, 'descendant re-hovers dedup to a single fetch');
    });

    it('source: preloadCache + installPreload/consumePreload + mouseover/focusin listeners', function () {
        var src = getPopinSrc();
        assert.ok(/var\s+preloadCache\s*=/.test(src), 'expected module-level preloadCache');
        assert.ok(/function\s+installPreload\s*\(/.test(src), 'expected installPreload()');
        assert.ok(/function\s+consumePreload\s*\(/.test(src), 'expected consumePreload()');
        assert.ok(src.indexOf("addEventListener('mouseover'") > -1, 'expected mouseover listener');
        assert.ok(src.indexOf("addEventListener('focusin'") > -1, 'expected focusin listener');
    });
});


// ── 21 — Partial vs full content application (applyContent) ───────────────────────

function applyContentReplica($el, html, partialTarget) {
    if (!partialTarget) { $el.innerHTML = (typeof html == 'string') ? html.trim() : ''; return; }
    var $slot = $el.querySelector(partialTarget);
    if (!$slot) { $el.innerHTML = (typeof html == 'string') ? html.trim() : ''; return; }
    var DOMParserCtor = $el.ownerDocument.defaultView.DOMParser;
    var parsed = new DOMParserCtor().parseFromString(html, 'text/html');
    var $incoming = parsed.querySelector(partialTarget) || parsed.body;
    $slot.innerHTML = $incoming.innerHTML;
}

describe('21 - Popin: applyContent full vs partial', function () {

    it('full (no target) replaces the whole element innerHTML', function () {
        var doc = makeDoc();
        var $el = doc.createElement('dialog'); doc.body.appendChild($el);
        $el.innerHTML = '<p>old</p>';
        applyContentReplica($el, '  <p>new</p>  ', null);
        assert.equal($el.innerHTML, '<p>new</p>', 'full-replace trims and swaps everything');
    });

    it('partial swaps only the target slot; chrome survives', function () {
        var doc = makeDoc();
        var $el = doc.createElement('dialog'); doc.body.appendChild($el);
        $el.innerHTML = '<button class="gina-popin-close">×</button><div id="slot"><p>old</p></div>';
        var fetched = '<html><body><header>ignored</header><div id="slot"><p>fresh</p></div></body></html>';
        applyContentReplica($el, fetched, '#slot');
        assert.ok($el.querySelector('.gina-popin-close'), 'close-button chrome preserved');
        assert.equal($el.querySelector('#slot').innerHTML, '<p>fresh</p>', 'only the slot content swapped');
    });

    it('partial with absent slot falls back to full replace', function () {
        var doc = makeDoc();
        var $el = doc.createElement('dialog'); doc.body.appendChild($el);
        $el.innerHTML = '<p>old</p>';
        applyContentReplica($el, '<p>whole</p>', '#missing');
        assert.equal($el.innerHTML, '<p>whole</p>');
    });

    it('source: applyContent has a partialTarget branch using DOMParser', function () {
        var src = getPopinSrc();
        assert.ok(/function\s+applyContent\s*\(\s*\$el\s*,\s*html\s*,\s*\$popin\s*,\s*partialTarget\s*\)/.test(src),
            'expected applyContent($el, html, $popin, partialTarget)');
        var fn = src.substring(src.indexOf('function applyContent('), src.indexOf('function applyContent(') + 900);
        assert.ok(fn.indexOf('partialTarget') > -1, 'expected partialTarget branch');
        assert.ok(/new\s+DOMParser\s*\(\s*\)/.test(fn), 'expected DOMParser parse in the partial branch');
        assert.ok(fn.indexOf('html.trim()') > -1, 'full path must stay byte-identical to $el.innerHTML = html.trim()');
    });
});


// ── 22 — Accessibility (aria wiring, focus return, Escape) ────────────────────────

function wireTriggerAriaReplica($trigger, id) {
    if (!$trigger || !id) { return; }
    $trigger.setAttribute('aria-haspopup', 'dialog');
    $trigger.setAttribute('aria-controls', id);
}
function associateLabelReplica($el) {
    if (!$el || typeof $el.querySelector != 'function') { return; }
    var $title = $el.querySelector('[id$="-title"]') || $el.querySelector('h1, h2, h3, h4, h5, h6');
    if (!$title) { return; }
    if (!$title.id) { $title.id = ($el.id || 'gina-popin') + '-title'; $title.setAttribute('id', $title.id); }
    $el.setAttribute('aria-labelledby', $title.id);
}

describe('22 - Popin: a11y wiring (aria, focus return, Escape)', function () {

    it('wireTriggerAria sets aria-haspopup="dialog" + aria-controls', function () {
        var doc = makeDoc();
        var $trigger = mkTrigger(doc, 'button', { 'data-gina-dialog': 'dlg' });
        wireTriggerAriaReplica($trigger, 'dlg');
        assert.equal($trigger.getAttribute('aria-haspopup'), 'dialog');
        assert.equal($trigger.getAttribute('aria-controls'), 'dlg');
    });

    it('associateLabel points aria-labelledby at a REAL title element (assigns id if missing)', function () {
        var doc = makeDoc();
        var $el = doc.createElement('dialog'); $el.id = 'mydlg'; doc.body.appendChild($el);
        $el.innerHTML = '<h2>Heading</h2><p>body</p>';
        associateLabelReplica($el);
        var labelId = $el.getAttribute('aria-labelledby');
        assert.equal(labelId, 'mydlg-title', 'heading gets an id and aria-labelledby points at it');
        assert.equal($el.querySelector('h2').id, 'mydlg-title');
    });

    it('focus returns to the trigger on close', function () {
        var doc = makeDoc();
        var $trigger = mkTrigger(doc, 'button', { 'data-gina-dialog': 'dlg', 'id': 'trg' });
        var $dialog = doc.createElement('dialog'); $dialog.setAttribute('tabindex', '-1'); doc.body.appendChild($dialog);
        $dialog.focus();
        // replica of popinClose's focus-return
        var $popinTrigger = doc.getElementById('trg');
        if ($popinTrigger && typeof $popinTrigger.focus == 'function') { $popinTrigger.focus(); }
        assert.equal(doc.activeElement, $trigger, 'focus returned to the opening trigger');
    });

    it('Escape closes a non-modal (div-mode) dialog via the shim handler', function () {
        var doc = makeDoc();
        var win = doc.defaultView;
        var $el = doc.createElement('dialog'); doc.body.appendChild($el);
        var closed = 0;
        // replica of applyNonModalShims' Escape handler
        var onKeydown = function (e) {
            if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); closed++; }
        };
        $el.addEventListener('keydown', onKeydown);
        $el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(closed, 1, 'Escape keydown closed the non-modal dialog');
    });

    it('source: aria wiring + focus-return helpers exist and popinClose returns focus', function () {
        var src = getPopinSrc();
        assert.ok(/function\s+wireTriggerAria\s*\(/.test(src), 'expected wireTriggerAria()');
        assert.ok(/function\s+associateLabel\s*\(/.test(src), 'expected associateLabel()');
        assert.ok(/function\s+focusInitial\s*\(/.test(src), 'expected focusInitial()');
        assert.ok(src.indexOf("setAttribute('aria-haspopup', 'dialog')") > -1, 'expected aria-haspopup=dialog');
        assert.ok(src.indexOf("setAttribute('aria-controls', id)") > -1, 'expected aria-controls wiring');
        // popinClose returns focus to the opening trigger on close
        var closeFn = src.substring(src.indexOf('function popinClose('), src.indexOf('function popinDestroy('));
        assert.ok(/\$popinTrigger\.focus\(\)/.test(closeFn), 'popinClose must return focus to the trigger');
    });
});
