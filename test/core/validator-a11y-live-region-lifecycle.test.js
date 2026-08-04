'use strict';
/**
 * #A11Y2 — the polite live region's LIFECYCLE: created at bind time, first write deferred.
 *
 * Two defects, one mechanism:
 *   V1 — the region was created, inserted AND populated in a single synchronous tick. To
 *        assistive tech that is one mutation batch on a node it has never observed, which is
 *        commonly not spoken, so the FIRST announcement per form — the one that matters most
 *        — was the one most likely lost. Every later one worked.
 *   V9 — the region lives inside the <form>, so a subtree replacement (a popin re-render's
 *        `innerHTML =`, or a nav fragment swap) destroys it; the next announce silently
 *        re-created it and so re-ran V1.
 *
 * The fix splits creation from announcement:
 *   - `ensureA11yLiveRegion($form)` creates-or-recovers and is called from `bindForm`, so on
 *     the normal path the region has been in the a11y tree since bind and the first announce
 *     writes synchronously to a long-lived node.
 *   - `announceA11yError` calls it again as a fallback. When the region had to be created (or
 *     re-homed) at announce time it is marked FRESH and that first write is deferred one
 *     macrotask, so insertion and mutation land in different ticks. That is what stops a V9
 *     recovery from silently repeating V1.
 *
 * The region deliberately stays a CHILD OF THE FORM: a popin renders its form inside a native
 * <dialog> opened with showModal(), which leaves everything outside the top layer inert, so a
 * body-level region would go unspoken for exactly the forms that live in popins.
 *
 * Strategy follows the house convention used by validator-aria-invalid / -a11y-reannounce:
 * jsdom exercises a faithful replica, and a source-inspection block pins production to the
 * same shape so the replica cannot silently drift. Note the two OLDER replicas still inline
 * the fused create-and-write shape; they remain green by construction and therefore certify
 * nothing about this change — which is why this file exists.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var { JSDOM } = require('jsdom');

var FW      = require('../fw');
var MAIN    = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var mainSrc = fs.readFileSync(MAIN, 'utf8');
var DIST_RAW = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');


// --- Faithful replica of ensureA11yLiveRegion + announceA11yError (main.js ~803-900).
//     `doc` is threaded explicitly because jsdom gives no global document. ---

function ensureA11yLiveRegion(doc, $form) {
    if ( !$form ) return null;
    if ( typeof(doc) === 'undefined' || !doc || typeof(doc.getElementById) !== 'function' ) {
        return null;
    }
    var _fid    = ( typeof($form.id) != 'undefined' && $form.id ) ? $form.id : ( $form.getAttribute('id') || 'form' );
    var _liveId = 'gina-aria-live-' + _fid;
    var _live   = doc.getElementById(_liveId);
    if ( !_live ) {
        _live = doc.createElement('div');
        _live.id = _liveId;
        _live.setAttribute('role', 'status');
        _live.setAttribute('aria-live', 'polite');
        _live.setAttribute('aria-atomic', 'true');
        _live.className = 'gina-visually-hidden';
        _live.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
        _live.ginaA11yFresh = true;
        $form.appendChild(_live);
    } else if ( _live.parentNode !== $form ) {
        _live.ginaA11yFresh = true;
        $form.appendChild(_live);
    }
    return _live;
}

function announceA11yError(doc, $form, text) {
    if ( !$form || !text ) return null;
    var _live = ensureA11yLiveRegion(doc, $form);
    if ( !_live ) return null;
    if ( _live.ginaA11yFresh ) {
        _live.ginaA11yPending = text;
        if ( !_live.ginaA11yTimer ) {
            _live.ginaA11yTimer = setTimeout(function() {
                _live.ginaA11yTimer = null;
                _live.ginaA11yFresh = false;
                announceA11yError(doc, $form, _live.ginaA11yPending);
            }, 0);
        }
        return _live;
    }
    _live.textContent = text;
    return _live;
}

// The PRE-FIX shape, for the subtract tests: create + write fused in one tick.
function announceA11yErrorFused(doc, $form, text) {
    if ( !$form || !text ) return null;
    var _fid    = ( typeof($form.id) != 'undefined' && $form.id ) ? $form.id : ( $form.getAttribute('id') || 'form' );
    var _liveId = 'gina-aria-live-' + _fid;
    var _live   = doc.getElementById(_liveId);
    if ( !_live ) {
        _live = doc.createElement('div');
        _live.id = _liveId;
        _live.setAttribute('aria-live', 'polite');
        $form.appendChild(_live);
    }
    _live.textContent = text;
    return _live;
}

function setupDom(html) {
    var dom = new JSDOM(html || `<!DOCTYPE html><html><body>
        <form id="contact"><input id="email" name="email" type="text"></form>
    </body></html>`);
    return dom.window;
}
function liveOf(win, id) {
    return win.document.getElementById('gina-aria-live-' + id);
}
// one macrotask — the same boundary the production setTimeout(..., 0) crosses
function nextTick() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
}


describe('01 - bind-time creation (the V1 fix)', function () {
    it('creates an empty polite region with no announcement text', function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');
        var live = ensureA11yLiveRegion(win.document, form);

        assert.ok(live, 'region created at bind time');
        assert.equal(live.getAttribute('role'), 'status');
        assert.equal(live.getAttribute('aria-live'), 'polite');
        assert.equal(live.getAttribute('aria-atomic'), 'true');
        assert.equal(live.textContent, '', 'bind-time creation must NOT announce anything');
        assert.equal(live.parentNode, form, 'the region stays inside the form (inert-safe in a popin dialog)');
    });

    it('is idempotent — a second call returns the same node and adds no second region', function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');
        var a = ensureA11yLiveRegion(win.document, form);
        var b = ensureA11yLiveRegion(win.document, form);
        assert.equal(a, b, 'same element reused');
        assert.equal(win.document.querySelectorAll('[aria-live="polite"]').length, 1, 'exactly one region');
    });

    it('returns null outside a browser document (the shared server form-body path)', function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');
        assert.equal(ensureA11yLiveRegion(undefined, form), null);
        assert.equal(ensureA11yLiveRegion({}, form), null, 'a docless object must not throw');
        assert.equal(ensureA11yLiveRegion(win.document, null), null);
    });

    it('a region that existed since bind writes SYNCHRONOUSLY — the working path is unchanged', function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');
        ensureA11yLiveRegion(win.document, form);      // bind time
        // clear the fresh flag the way the deferred write does, i.e. simulate a bound-and-settled region
        liveOf(win, 'contact').ginaA11yFresh = false;

        announceA11yError(win.document, form, 'Email is required');
        assert.equal(liveOf(win, 'contact').textContent, 'Email is required',
            'an already-bound region must not defer — no latency added to the path that already worked');
    });
});


describe('02 - deferred first write when the region is created at announce time (V1 + V9)', function () {
    it('does NOT populate the region in the same tick it was created', async function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');

        announceA11yError(win.document, form, 'Email is required');
        assert.equal(liveOf(win, 'contact').textContent, '',
            'insert and write must not land in one tick — that batch is what screen readers miss');

        await nextTick();
        assert.equal(liveOf(win, 'contact').textContent, 'Email is required',
            'the announcement lands on a later tick');
    });

    it('SUBTRACT: the pre-fix fused shape writes in the same tick (proves the deferral is the change)', function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');
        announceA11yErrorFused(win.document, form, 'Email is required');
        assert.equal(liveOf(win, 'contact').textContent, 'Email is required',
            'pre-fix: created and populated synchronously — the defect');
    });

    it('clears the fresh flag after the deferred write, so the NEXT announce is synchronous', async function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');
        announceA11yError(win.document, form, 'first');
        await nextTick();

        announceA11yError(win.document, form, 'second');
        assert.equal(liveOf(win, 'contact').textContent, 'second',
            'once settled the region writes synchronously');
    });
});


describe('03 - ordering guard while a deferred write is pending', function () {
    it('the LATEST text wins — a stale first message never lands on top of a newer one', async function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');

        announceA11yError(win.document, form, 'stale');
        announceA11yError(win.document, form, 'newest');
        assert.equal(liveOf(win, 'contact').textContent, '', 'still pending, nothing written yet');

        await nextTick();
        assert.equal(liveOf(win, 'contact').textContent, 'newest',
            'the pending text is replaced, not queued — the newest error is what gets spoken');
    });

    it('schedules exactly ONE timer for a burst of announcements', function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');

        announceA11yError(win.document, form, 'a');
        var t1 = liveOf(win, 'contact').ginaA11yTimer;
        announceA11yError(win.document, form, 'b');
        var t2 = liveOf(win, 'contact').ginaA11yTimer;

        assert.ok(t1, 'a timer was scheduled');
        assert.equal(t1, t2, 'the second announce must reuse the pending timer, not schedule a second');
    });
});


describe('04 - V9: the region is recovered after a subtree replacement', function () {
    it('re-creates the region and defers again when a re-render destroyed it', async function () {
        var win  = setupDom();
        var form = win.document.getElementById('contact');
        ensureA11yLiveRegion(win.document, form);
        liveOf(win, 'contact').ginaA11yFresh = false;          // settled

        // a popin re-render / nav fragment swap replaces the form's subtree
        form.innerHTML = '<input id="email" name="email" type="text">';
        assert.equal(liveOf(win, 'contact'), null, 'the re-render destroyed the region (this is V9)');

        announceA11yError(win.document, form, 'Email is required');
        assert.equal(liveOf(win, 'contact').textContent, '',
            'the recovered region must defer too, or the recovery silently re-runs V1');

        await nextTick();
        assert.equal(liveOf(win, 'contact').textContent, 'Email is required');
    });

    it('re-homes a region whose form node was replaced, and treats the move as fresh', async function () {
        var win = setupDom(`<!DOCTYPE html><html><body>
            <form id="contact"><input name="email"></form>
        </body></html>`);
        var oldForm = win.document.getElementById('contact');
        ensureA11yLiveRegion(win.document, oldForm);
        var region = liveOf(win, 'contact');
        region.ginaA11yFresh = false;

        // the form ELEMENT is replaced by a new node carrying the same id, while the old
        // region survives detached-but-findable only if still in the document; emulate the
        // shape where the region ends up outside the announcing form
        var newForm = win.document.createElement('form');
        newForm.id = 'contact';
        oldForm.parentNode.appendChild(region);   // region now sits on <body>, not in a form
        oldForm.parentNode.replaceChild(newForm, oldForm);

        announceA11yError(win.document, newForm, 'Email is required');
        assert.equal(region.parentNode, newForm,
            'the region must be re-homed into the form that announces — the inert-safety property');
        assert.equal(region.textContent, '', 'a move is a fresh insertion, so the write defers');

        await nextTick();
        assert.equal(region.textContent, 'Email is required');
    });
});


describe('05 - source pins: production matches the replica', function () {
    it('creation is split out into ensureA11yLiveRegion, declared before the announcer', function () {
        var ensureIdx   = mainSrc.indexOf('var ensureA11yLiveRegion = function($form)');
        var announceIdx = mainSrc.indexOf('var announceA11yError = function($form, text)');
        assert.ok(ensureIdx > -1, 'the creation helper must exist');
        assert.ok(announceIdx > ensureIdx, 'the helper must be declared before the announcer that calls it');
    });

    it('the creation helper builds the region and no longer writes the announcement text', function () {
        var i = mainSrc.indexOf('var ensureA11yLiveRegion = function($form)');
        var block = mainSrc.slice(i, mainSrc.indexOf('var announceA11yError', i));
        assert.match(block, /_live\.setAttribute\('aria-live', 'polite'\)/, 'region must be polite');
        assert.match(block, /'gina-aria-live-' \+ _fid/, 'id derived from the form id');
        assert.match(block, /\$form\.appendChild\(_live\)/, 'the region is a child of the FORM (inert-safe under showModal)');
        assert.ok(block.indexOf('_live.textContent = text') < 0,
            'creation must NOT announce — that is what fused the two into one tick');
    });

    it('bindForm stands the region up at bind time', function () {
        var b = mainSrc.indexOf('var bindForm = function($target, customRule)');
        assert.ok(b > -1, 'bindForm must exist');
        var block = mainSrc.slice(b, b + 3000);
        assert.match(block, /ensureA11yLiveRegion\(\$target\);/,
            'bindForm must create the region so the FIRST announcement is not the lost one');
    });

    it('the announcer defers the write only while the region is fresh, with one write site', function () {
        var i = mainSrc.indexOf('var announceA11yError = function($form, text)');
        var block = mainSrc.slice(i, i + 1400);
        assert.match(block, /var _live = ensureA11yLiveRegion\(\$form\)/, 'delegates creation');
        assert.match(block, /if \( _live\.ginaA11yFresh \)/, 'defers only on the fresh path');
        assert.match(block, /setTimeout\(/, 'the deferral crosses a macrotask boundary');
        assert.match(block, /_live\.ginaA11yPending = text/, 'pending text is replaced so the latest wins');
        var writes = block.match(/_live\.textContent\s*=\s*text/g) || [];
        assert.equal(writes.length, 1, 'exactly one textContent write site');
    });

    it('the served bundle carries the split (rebuild the bundle if this fails)', function () {
        var dist = fs.readFileSync(DIST_RAW, 'utf8');
        assert.ok(dist.indexOf('ginaA11yFresh') > -1,
            'rebuild the bundle: the #A11Y2 deferral is missing from dist gina.js');
        assert.ok(dist.indexOf('ginaA11yPending') > -1,
            'rebuild the bundle: the pending-text guard is missing from dist gina.js');
    });
});
