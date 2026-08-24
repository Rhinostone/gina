'use strict';
// #B329 — the popin sheet shipped an UNSCOPED `::backdrop` rule on the bare
// `dialog` element, so gina painted its dark blurred backdrop on EVERY <dialog>
// a consumer page opens, not just gina popins. Scoped to gina's own container
// class, matching the already-correct rules in the reduced-motion media block.
//
// Measured before the fix: both dialog-creation sites (ensurePopinDialog and
// popinLoad's click-time twin) set `gina-popin-container` on the <dialog>
// element itself, so the scoped selector keeps matching gina's own dialogs —
// the shipped open/close fade already relies on the scoped form. The inspector
// ships its own stylesheet (zero inspector selectors in gina.min.css) and its
// `backdrop` hits are all backdrop-filter properties, so nothing else in the
// bundle leans on the bare rule.
//
// Consumer-visible: a page that relied on the free backdrop for its own dialogs
// styles them itself now, and a popin dialog element supplied by the page's own
// markup (the adopt-by-id path) needs the container class to keep gina's
// backdrop. Both named in the changelog entry.

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW = require('../fw');
var SASS_PATH = path.join(FW, 'core/asset/plugin/src/vendor/gina/popin/sass/popin.sass');
var CSS_PATH  = path.join(FW, 'core/asset/plugin/src/vendor/gina/popin/css/popin.css');
var MIN_PATH  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/css/gina.min.css');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }
function count(hay, needle) { return hay.split(needle).length - 1; }

// BARE is not a substring of SCOPED (`.gina-popin-container` sits between), so a
// zero on BARE beside a positive on SCOPED discriminates cleanly.
var BARE   = 'dialog::backdrop';
var SCOPED = 'dialog.gina-popin-container::backdrop';


describe('01 - popin: the backdrop rule is scoped to gina popin dialogs (#B329)', function() {

    it('01.1 the sass source carries the scoped rule and no bare one', function() {
        var sass = read(SASS_PATH);
        assert.ok(count(sass, SCOPED) >= 1, 'the scoped backdrop rule must exist');
        assert.equal(count(sass, BARE), 0,
            'a bare rule on the dialog element restyles every consumer dialog on the page');
    });

    it('01.2 the compiled css twin agrees', function() {
        var css = read(CSS_PATH);
        assert.ok(count(css, SCOPED) >= 1, 'the scoped backdrop rule must exist in the compiled twin');
        assert.equal(count(css, BARE), 0, 'no bare rule in the compiled twin');
    });
});


describe('02 - dist fidelity: gina.min.css ships the scoped rule only', function() {

    it('02.1 no bare rule, exactly two scoped-literal occurrences, controls firing', function() {
        var min = read(MIN_PATH);
        assert.equal(count(min, BARE), 0, 'the bare rule must not ship');
        // The base rule + the reduced-motion fade; the `[open]` variant reads
        // `...container[open]::backdrop` and deliberately does not match this literal.
        assert.equal(count(min, SCOPED), 2, 'the base rule joins the reduced-motion one');
        assert.ok(count(min, '.gina-popins-overlay') >= 1, 'known-present control');
        assert.equal(count(min, '.gina-bogus-control-zzz'), 0, 'known-absent control');
    });
});
