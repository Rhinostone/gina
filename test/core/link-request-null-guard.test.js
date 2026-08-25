'use strict';
// #B328 — gina.link.request(url) on a url with no registered link: the resolution
// (`$operated || getLinkByUrl(url)`) yields null on the public path — `getLinkByUrl`
// returns null on no match, and both click paths always hand off a real
// registration — and the next deref (`$link.id`) threw a bare TypeError. Two
// defects in one:
//
//   1. The error named nothing. Same class as #B415 (client getRoute on a null
//      table): the named guard tells a mistyped url from the real second shape —
//      a registration added by a later construction, which the published
//      instance's walk cannot see (#B326 made second constructions inert).
//   2. The resolution sat BELOW the supersede block, so a miss had already bumped
//      `_linkSeq`, ABORTED a legitimate in-flight request and swapped `_linkXhr`
//      before throwing. The fix resolves-and-guards ABOVE `var seq = ++_linkSeq;`,
//      making a failed resolution side-effect-free on transport state.
//
// House contract, measured before the fix: popin throws named Errors on all six of
// its public-path misses; nav's console.warns are degraded-but-continue cases only;
// link itself throws for `already exists` and a missing transport. A request that
// cannot be built is a miss — it throws, as it always did, just named now.

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

// The guard's message text doubles as the dist-fidelity needle: string literals
// survive minification; identifiers do not.
var ERR_LITERAL = 'no link is registered for url';


describe('01 - link: the miss guard exists, named, ABOVE the transport block (#B328)', function() {

    var block;
    before(function() {
        var src   = read(LINK_SRC);
        var start = src.indexOf('function linkRequest(url, options)');
        assert.ok(start > -1, 'control: linkRequest must exist under its pinned signature');
        block = src.slice(start);
    });

    it('01.1 the resolution is guarded: a null resolution throws the named error', function() {
        var resolve = block.indexOf('var $link      = $operated || getLinkByUrl(url);');
        var guard   = block.indexOf('if ( !$link ) {');
        var literal = block.indexOf(ERR_LITERAL);
        assert.ok(resolve > -1, 'the #B287 resolution line must survive verbatim');
        assert.ok(guard > resolve, 'the null guard must follow the resolution');
        assert.ok(literal > guard, 'and must throw the named message, not a bare TypeError');
    });

    it('01.2 resolution + guard run BEFORE the supersede block — a miss must not abort an in-flight request', function() {
        var resolve = block.indexOf('$operated || getLinkByUrl(url)');
        var guard   = block.indexOf('if ( !$link ) {');
        var seq     = block.indexOf('var seq = ++_linkSeq;');
        assert.ok(seq > -1, 'control: the supersede block must still exist');
        assert.ok(resolve > -1 && resolve < seq,
            'the resolution must sit above `var seq = ++_linkSeq;` — below it, a mistyped public url aborted a legitimate in-flight request before throwing');
        assert.ok(guard > resolve && guard < seq,
            'and the guard must sit between the resolution and the supersede block');
    });

    it('01.3 CONTROL: the #B287 consume/clear still precedes everything (green in both trees)', function() {
        var consume = block.indexOf('var $operated = _operatedLink;');
        var clear   = block.indexOf('_operatedLink = null;');
        var resolve = block.indexOf('$operated || getLinkByUrl(url)');
        assert.ok(consume > -1 && clear > consume && resolve > clear);
    });
});


// ── 02 — the guard, executed (the #B175 brace-extract pattern) ───────────────

describe('02 - link: the extracted guard executes — a null resolution throws, naming the url', function() {

    var runSlice;
    before(function() {
        var src   = read(LINK_SRC);
        var start = src.indexOf('var $operated = _operatedLink;');
        var end   = src.indexOf('var seq = ++_linkSeq;');
        assert.ok(start > -1 && end > start, 'the consume-to-supersede span must exist');
        var slice = src.slice(start, end);
        assert.ok(slice.indexOf('getLinkByUrl') > -1,
            'the resolution must live INSIDE the pre-transport span (red before the fix: it sat below the supersede block)');
        // #B418 moved the $el resolution into this span, so the executed slice
        // references `document` — stubbed here like the other collaborators
        // (`getLinkByUrl` above; the sibling file stubs createXhr/_linkXhr/_linkSeq).
        // The stub returns a present element, so these arms exercise the #B328
        // guard exactly as before; the detached-anchor arms live in
        // link-request-detached-anchor.test.js with a null-returning stub.
        var fn = new Function('_operatedLink', 'getLinkByUrl', 'document', 'url',
            slice + '\nreturn { link: $link, cleared: _operatedLink };');
        var DOC_STUB = { getElementById: function() { return { id: 'present' }; } };
        runSlice = function(operated, lookup, url) {
            return fn(operated, function() { return lookup; }, DOC_STUB, url);
        };
    });

    it('02.1 a miss throws the named error, carrying the url', function() {
        assert.throws(function() { runSlice(null, null, '/never-registered'); }, function(err) {
            assert.ok(err instanceof Error, 'must be an Error');
            assert.ok(!(err instanceof TypeError), 'a bare TypeError is the defect');
            assert.ok(err.message.indexOf(ERR_LITERAL) > -1, 'the named message, got: ' + err.message);
            assert.ok(err.message.indexOf('/never-registered') > -1, 'the message must carry the url');
            return true;
        });
    });

    it('02.2 CONTROL: a registered url still resolves — the guard fires only on a miss', function() {
        var out = runSlice(null, { id: 'found' }, '/registered');
        assert.equal(out.link.id, 'found');
    });

    it('02.3 CONTROL: an operated registration still wins and the slot still clears (#B287 intact)', function() {
        var out = runSlice({ id: 'operated' }, null, '/probe');
        assert.equal(out.link.id, 'operated');
        assert.equal(out.cleared, null);
    });
});


// ── 03 — dist fidelity ───────────────────────────────────────────────────────

describe('03 - dist fidelity: the shipped bundles carry the guard', function() {

    it('03.1 the unminified bundle carries guard + message, above its supersede block', function() {
        var dist  = read(DIST_PATH);
        var start = dist.indexOf('function linkRequest(url, options)');
        assert.ok(start > -1, 'control: linkRequest must be in the bundle');
        var b     = dist.slice(start);
        var guard = b.indexOf(ERR_LITERAL);
        var seq   = b.indexOf('var seq = ++_linkSeq;');
        assert.ok(guard > -1, 'the guard message must be in the bundle');
        assert.ok(seq > guard, 'and must precede the supersede block');
    });

    it('03.2 the minified bundle carries the message exactly once, controls firing', function() {
        var min = read(MIN_PATH);
        assert.equal(count(min, ERR_LITERAL), 1, 'the guard message must survive minification, once');
        assert.ok(count(min, 'No `xhr` object initiated') >= 1, 'known-present control');
        assert.equal(count(min, 'no link is registered for url zzz-bogus'), 0, 'known-absent control');
    });
});
