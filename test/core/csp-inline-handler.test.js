'use strict';
// Regression: client-bundle plugins must not inject inline event-handler attributes
// (`setAttribute('onclick', 'return false;')`). Under a nonce-based CSP a nonce
// disables 'unsafe-inline' for inline event-handler attributes (script-src-attr),
// so the injected handler is reported (report-only) or blocked (enforce). Each
// plugin now suppresses the default action with an addEventListener-based
// `preventDefault` listener instead — CSP-safe and behaviour-preserving.
//
// popin close binding: fixed first (see popin.test.js §14).
// link binding + validator submit-trigger binding: fixed here.
//
// Browser-verified (2026-06-03) on a gina-starter harness under a real
// `Content-Security-Policy-Report-Only: script-src-attr 'none'`: the inline
// onclick mechanism raises a `script-src-attr` (disposition "report") violation
// on execution; the addEventListener+preventDefault mechanism raises none; both
// prevent the default action.

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW = require('../fw');
var LINK_SRC      = path.join(FW, 'core/asset/plugin/src/vendor/gina/link/main.js');
var VALIDATOR_SRC = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var POPIN_SRC     = path.join(FW, 'core/asset/plugin/src/vendor/gina/popin/main.js');
var EVENTS_SRC    = path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/events.js');
var DIST_JS       = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }


// ── 01 — Link plugin: no inline onclick injection ─────────────────────────────

describe('01 - CSP: link plugin injects no inline onclick', function() {

    it('link/main.js no longer sets an inline onclick attribute', function() {
        assert.equal(
            read(LINK_SRC).indexOf("setAttribute('onclick'"), -1,
            "link/main.js must not inject an inline onclick (trips CSP script-src-attr)"
        );
    });

    it('link/main.js suppresses default via a preventDefault click listener', function() {
        assert.ok(
            read(LINK_SRC).indexOf("addListener(gina, $el, 'click', function(e) { if ( isModifiedClick(e) ) return; e.preventDefault(); })") > -1,
            'expected an addEventListener-based preventDefault listener on each bound <a>'
        );
    });

    it('link/main.js dead onclickAttribute local (and its writeback branch) is gone', function() {
        assert.equal(
            read(LINK_SRC).indexOf('onclickAttribute'), -1,
            'onclickAttribute should be removed from link/main.js'
        );
    });

    it('link uses preventDefault, NOT cancelEvent (stopPropagation would break the AJAX delegation)', function() {
        // cancelEvent stops propagation; the link AJAX trigger is a document-level
        // delegation, so the per-element listener must only preventDefault.
        var src = read(LINK_SRC);
        var i = src.indexOf("addListener(gina, $el, 'click'");
        assert.ok(i > -1, 'link click listener not found');
        var snippet = src.substring(i, i + 120);
        assert.ok(snippet.indexOf('preventDefault') > -1, 'link listener must preventDefault');
        assert.equal(snippet.indexOf('cancelEvent'), -1, 'link listener must NOT cancelEvent (stopPropagation breaks delegation)');
    });
});


// ── 02 — Validator plugin: no inline onclick injection on submit-trigger ───────

describe('02 - CSP: validator submit-trigger injects no inline onclick', function() {

    it('validator/src/main.js no longer sets an inline onclick attribute', function() {
        assert.equal(
            read(VALIDATOR_SRC).indexOf("setAttribute('onclick'"), -1,
            'validator must not inject an inline onclick on the submit-trigger anchor'
        );
    });

    it('validator suppresses default via a preventDefault click listener', function() {
        assert.ok(
            read(VALIDATOR_SRC).indexOf("addListener(gina, $submit, 'click', function(e) { e.preventDefault(); })") > -1,
            'expected an addEventListener-based preventDefault listener on the submit-trigger anchor'
        );
    });

    it('validator preserves the !onclickAttribute && !isSubmitType gate', function() {
        // The listener must replace the inline onclick ONLY where the onclick used
        // to be injected — same condition — so submit-type anchors and anchors with
        // an author-supplied onclick keep their existing behaviour.
        assert.ok(
            read(VALIDATOR_SRC).indexOf('!onclickAttribute && !isSubmitType') > -1,
            'the original injection gate must be preserved'
        );
    });
});


// ── 03 — Sibling popin + whole-bundle invariant + shared primitive ────────────

describe('03 - CSP: popin sibling + built bundle invariant', function() {

    it('popin/main.js (fixed first) injects no inline onclick', function() {
        assert.equal(
            read(POPIN_SRC).indexOf("setAttribute('onclick'"), -1,
            'popin close binding must not inject an inline onclick'
        );
    });

    it('rebuilt dist bundle contains ZERO setAttribute(onclick) across popin + link + validator', function() {
        assert.equal(
            read(DIST_JS).indexOf("setAttribute('onclick'"), -1,
            'the built gina.js must carry no inline onclick injection from any plugin'
        );
    });

    it('cancelEvent (shared default-suppression primitive) calls preventDefault', function() {
        var ev = read(EVENTS_SRC);
        var i = ev.indexOf('function cancelEvent');
        assert.ok(i > -1, 'cancelEvent not found in events.js');
        assert.ok(
            ev.substring(i, i + 400).indexOf('preventDefault') > -1,
            'cancelEvent must call preventDefault'
        );
    });
});
