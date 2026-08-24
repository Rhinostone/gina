'use strict';
// #B418 — gina.link.request(url) for a REGISTERED url whose anchor has left the
// DOM: `$el = document.getElementById(id) || null` then the bare
// `$el.getAttribute(...)` threw a raw TypeError. The sibling miss of #B328, and
// guarded the same way — named, and ABOVE the supersede block, because the
// collateral there is DOUBLE: below it, a miss has already ABORTED any in-flight
// request AND bumped `_linkSeq`, whose stale-response wrapper then drops the
// in-flight request's completion even where the abort races.
//
// Reachability, measured: public path only. Both click paths are synchronous
// from the dispatch listener (`getLinkById(e.target.id)` → hand-off →
// linkRequest) on an element that was just operated, so it is in the DOM. The
// public path hits this when a registration outlives its element — there is NO
// deregistration path (`$links` is write-only) — e.g. a page that re-renders
// its anchors after binding.
//
// Contract decided by measurement (the #B328 pass): every public-path
// cannot-proceed in the client plugins throws named (popin x6, link x3,
// routing #B415), and this path already threw — a named throw preserves the
// behaviour class. The link contract is DOM-coupled (loading state, hlink
// attributes, response events all target the anchor), so a detached anchor is
// a cannot-proceed; send-without-DOM-effects stays demand-gated.

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW = require('../fw');
var LINK_SRC  = path.join(FW, 'core/asset/plugin/src/vendor/gina/link/main.js');
var DIST_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var MIN_PATH  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }
function count(hay, needle) { return hay.split(needle).length - 1; }

// The guard's message text doubles as the dist-fidelity needle.
var ERR_LITERAL  = 'is no longer in the DOM';
var B328_LITERAL = 'no link is registered for url';


describe('01 - link: the detached-anchor guard exists, named, ABOVE the transport block (#B418)', function() {

    var block;
    before(function() {
        var src   = read(LINK_SRC);
        var start = src.indexOf('function linkRequest(url, options)');
        assert.ok(start > -1, 'control: linkRequest must exist under its pinned signature');
        block = src.slice(start);
    });

    it('01.1 the $el resolution and its guard sit between the #B328 guard and the supersede block', function() {
        var b328    = block.indexOf(B328_LITERAL);
        var resolve = block.indexOf('var $el = document.getElementById(id) || null;');
        var guard   = block.indexOf('if ( !$el ) {');
        var seq     = block.indexOf('var seq = ++_linkSeq;');
        assert.ok(b328 > -1 && seq > -1, 'controls: both fences must exist');
        assert.ok(resolve > b328, 'the $el resolution must follow the #B328 guard');
        assert.ok(guard > resolve && guard < seq,
            'the guard must sit between resolution and supersede — below it, a detached-anchor miss aborts an in-flight request AND its seq bump drops that request\'s completion');
    });

    it('01.2 the guard throws the named message', function() {
        var guard   = block.indexOf('if ( !$el ) {');
        var literal = block.indexOf(ERR_LITERAL);
        assert.ok(literal > guard && literal < block.indexOf('var seq = ++_linkSeq;'),
            'the named message must live inside the guard, not a bare TypeError');
    });

    it('01.3 CONTROL: the #B328 guard is untouched above it (green in both trees)', function() {
        assert.ok(block.indexOf(B328_LITERAL) > -1);
        assert.match(read(LINK_SRC), /function linkRequest\(url, options\)/);
    });
});


// ── 02 — the guard, executed (the same extractor pattern as the sibling file,
//         with a document stub — the arm that differs is what the stub returns) ─

describe('02 - link: the extracted guard executes — a detached anchor throws, naming id and url', function() {

    var run;
    before(function() {
        var src   = read(LINK_SRC);
        var start = src.indexOf('var $operated = _operatedLink;');
        var end   = src.indexOf('var seq = ++_linkSeq;');
        assert.ok(start > -1 && end > start, 'the consume-to-supersede span must exist');
        var slice = src.slice(start, end);
        assert.ok(slice.indexOf('document.getElementById') > -1,
            'the $el resolution must live INSIDE the pre-transport span (red before the fix: it sat below the supersede block)');
        var fn = new Function('_operatedLink', 'getLinkByUrl', 'document', 'url',
            slice + '\nreturn { link: $link, el: $el };');
        run = function(lookup, el, url) {
            return fn(null, function() { return lookup; },
                { getElementById: function() { return el; } }, url);
        };
    });

    it('02.1 registered + present anchor: resolves both, no throw', function() {
        var out = run({ id: 'live-link' }, { id: 'live-link' }, '/registered');
        assert.equal(out.link.id, 'live-link');
        assert.equal(out.el.id, 'live-link');
    });

    it('02.2 registered + DETACHED anchor: throws the named error carrying id and url', function() {
        assert.throws(function() { run({ id: 'ghost-link' }, null, '/re-rendered'); }, function(err) {
            assert.ok(err instanceof Error, 'must be an Error');
            assert.ok(!(err instanceof TypeError), 'a bare TypeError is the defect');
            assert.ok(err.message.indexOf(ERR_LITERAL) > -1, 'the named message, got: ' + err.message);
            assert.ok(err.message.indexOf('ghost-link') > -1, 'the message must carry the link id');
            assert.ok(err.message.indexOf('/re-rendered') > -1, 'the message must carry the url');
            return true;
        });
    });

    it('02.3 CONTROL: an unregistered url still throws the #B328 error FIRST — document is never consulted', function() {
        var consulted = false;
        var fnSrc = read(LINK_SRC);
        var slice = fnSrc.slice(fnSrc.indexOf('var $operated = _operatedLink;'),
                                fnSrc.indexOf('var seq = ++_linkSeq;'));
        var fn = new Function('_operatedLink', 'getLinkByUrl', 'document', 'url', slice + '\nreturn true;');
        assert.throws(function() {
            fn(null, function() { return null; },
               { getElementById: function() { consulted = true; return null; } }, '/never-registered');
        }, function(err) {
            assert.ok(err.message.indexOf(B328_LITERAL) > -1, 'the #B328 guard must fire first');
            return true;
        });
        assert.equal(consulted, false, 'a miss must not even resolve the element');
    });
});


// ── 03 — dist fidelity ───────────────────────────────────────────────────────

describe('03 - dist fidelity: the shipped bundles carry the guard', function() {

    it('03.1 the unminified bundle carries the message, above its supersede block', function() {
        var dist  = read(DIST_PATH);
        var start = dist.indexOf('function linkRequest(url, options)');
        assert.ok(start > -1, 'control: linkRequest must be in the bundle');
        var b     = dist.slice(start);
        var lit   = b.indexOf(ERR_LITERAL);
        var seq   = b.indexOf('var seq = ++_linkSeq;');
        assert.ok(lit > -1, 'the guard message must be in the bundle');
        assert.ok(seq > lit, 'and must precede the supersede block');
    });

    it('03.2 the minified bundle carries the message exactly once, controls firing', function() {
        var min = read(MIN_PATH);
        assert.equal(count(min, ERR_LITERAL), 1, 'the guard message must survive minification, once');
        assert.ok(count(min, B328_LITERAL) >= 1, 'known-present control (#B328 message)');
        assert.equal(count(min, 'zzz-bogus-detached-control'), 0, 'known-absent control');
    });
});
