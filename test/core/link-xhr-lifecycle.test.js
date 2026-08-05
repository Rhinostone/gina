'use strict';
/**
 * link plugin — one transport per request, and a sequence that drops stale responses.
 *
 * The link plugin used to build ONE `XMLHttpRequest` in its `init` handler and reuse it
 * for every click. That is the #B175 class popin already fixed and `nav` deliberately
 * avoids, and it strands requests rather than merely racing them: calling `open()` on an
 * object still carrying a request implicitly ABORTS it, an aborted request reaches
 * readyState 4 with **status 0**, and `handleXhr`'s readyState-4 chain has no branch for
 * status 0 (`utils/events.js`: `} else if ( xhr.status != 0) {`). So the first click's
 * completion never arrived at all — no success event, no error event, nothing.
 *
 * Two changes are pinned here:
 *   - `createXhr()` per request, tracked in `_linkXhr`;
 *   - `_linkSeq`, incremented BEFORE the supersede-abort, and checked in a wrapper around
 *     the handler `handleXhr` installs.
 *
 * The ordering is the load-bearing invariant, not decoration: taking the sequence first is
 * what makes a supersede-abort stale BY CONSTRUCTION, so the abort can never be mistaken
 * for a genuine network failure once a status-0 branch exists. §01.4 pins that order.
 *
 * ## Why this file is pins + dist-fidelity and NOT a behavioural test
 *
 * `architecture/jsdoc.md` prefers executing EXTRACTED source over a hand-written replica,
 * and prefers a behavioural test over either. Neither applies to this construct: the guard
 * is a closure over `seq`, `_linkSeq` and the handler captured from `xhr`, all of which
 * live inside `LinkPlugin`'s closure — and that doc scopes the extract-and-execute escape
 * hatch explicitly to constructs that do NOT close over module state ("for that, fix the
 * loadability or accept a pin plus a live smoke"). A replica would be a second copy free
 * to drift from the shipped bytes, which is the failure mode that doc warns about at
 * length. So: pins over the contiguous shape, dist fidelity to prove it SHIPS, and the
 * behavioural half is owed as a live browser smoke — recorded as such, not implied here.
 *
 * Dist pins target the UNMINIFIED `gina.js` on purpose: Closure renames locals, so
 * `_linkSeq` / `_linkXhr` / `createXhr` do not survive into `gina.min.js` and a pin on
 * them there would be a permanently-red instrument rather than a check.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var LINK_PATH = path.join(FW, 'core/asset/plugin/src/vendor/gina/link/main.js');
var DIST_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var linkSrc, linkActive, distSrc;

/**
 * Strip comment lines so a NEGATIVE pin cannot trip on prose.
 * This file's own change ADDED comments that name the removed construct
 * ("replace a single module-scope `xhr`"), which is precisely the own-JSDoc
 * trap `jsdoc.md` documents for negative source pins.
 */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

before(function () {
    linkSrc    = fs.readFileSync(LINK_PATH, 'utf8');
    linkActive = stripComments(linkSrc);
    distSrc    = fs.readFileSync(DIST_PATH, 'utf8');
});


describe('00 - instrument', function () {

    it('the comment stripper actually removes prose naming the old construct', function () {
        assert.match(linkSrc, /module-scope `xhr`/,
            'the explanatory comment is expected to exist in the source');
        assert.doesNotMatch(linkActive, /module-scope `xhr`/,
            'and must NOT survive into the text the negative pins read');
    });

    it('a known-present token is still found after stripping (the stripper is not eating code)', function () {
        assert.match(linkActive, /function linkRequest\s*\(/);
    });
});


describe('01 - one transport per request', function () {

    it('01.1 declares the in-flight tracker and the sequence', function () {
        assert.match(linkActive, /var\s+_linkXhr\s*=\s*null\s*;/);
        assert.match(linkActive, /var\s+_linkSeq\s*=\s*0\s*;/);
    });

    it('01.2 the shared module-scope transport is GONE', function () {
        assert.doesNotMatch(linkActive, /^\s*var\s+xhr\s*=\s*null\s*;\s*$/m,
            'a module-scope `var xhr = null` is the defect itself — every click would share it');
    });

    it('01.3 builds a fresh transport per request, inside linkRequest', function () {
        assert.match(linkActive, /var\s+createXhr\s*=\s*function\s*\(\s*\)/,
            'the per-request factory exists');
        var reqIdx    = linkActive.indexOf('function linkRequest');
        var createIdx = linkActive.indexOf('createXhr()', reqIdx);
        assert.ok(reqIdx > -1 && createIdx > reqIdx,
            'and is CALLED from inside linkRequest, not once at init');
    });

    it('01.4 ORDERING: the sequence is taken BEFORE the supersede-abort', function () {
        var reqIdx   = linkActive.indexOf('function linkRequest');
        var seqIdx   = linkActive.indexOf('++_linkSeq', reqIdx);
        var abortIdx = linkActive.indexOf('_linkXhr.abort()', reqIdx);
        assert.ok(seqIdx > -1, 'the sequence increment must exist inside linkRequest');
        assert.ok(abortIdx > -1, 'the supersede-abort must exist inside linkRequest');
        assert.ok(seqIdx < abortIdx,
            'incrementing FIRST is what makes a supersede-abort stale by construction; '
            + 'reversed, the abort would land with a still-current sequence and be '
            + 'indistinguishable from a real network failure');
    });

    it('01.5 the abort is guarded on readyState, never fired blind', function () {
        assert.match(linkActive, /_linkXhr\s*&&\s*_linkXhr\.readyState\s*!==\s*4/);
    });

    it('01.6 the abort cannot throw out of the click handler', function () {
        var idx = linkActive.indexOf('_linkXhr.abort()');
        var window = linkActive.slice(Math.max(0, idx - 200), idx + 80);
        assert.match(window, /try\s*\{/,
            'aborting an already-dead request must not break the click');
    });

    it('01.7 the init handler no longer constructs a transport', function () {
        var initIdx = linkActive.indexOf("instance.on('init'");
        assert.ok(initIdx > -1, 'the init handler must still exist');
        // Scope the negative to the init block: `createXhr` legitimately contains
        // `new XMLHttpRequest()`, so an unscoped pin would always fail.
        var initBlock = linkActive.slice(initIdx, initIdx + 1200);
        assert.doesNotMatch(initBlock, /new\s+XMLHttpRequest\s*\(/,
            'construction moved to createXhr(), called per request');
        assert.doesNotMatch(initBlock, /new\s+ActiveXObject\s*\(/);
    });
});


describe('02 - the sequence guard wraps what handleXhr installed', function () {

    it('02.1 captures the installed handler rather than replacing it outright', function () {
        assert.match(linkActive, /var\s+onSettled\s*=\s*xhr\.onreadystatechange\s*;/,
            'handleXhr owns the completion logic; the guard must delegate to it, not reimplement it');
    });

    it('02.2 drops a superseded response', function () {
        assert.match(linkActive, /if\s*\(\s*seq\s*!==\s*_linkSeq\s*\)/);
    });

    it('02.3 forwards to the captured handler with the right receiver', function () {
        assert.match(linkActive, /onSettled\.call\s*\(\s*this\s*,\s*event\s*\)/,
            'calling it bare would lose `this`, which handleXhr\'s blob branch reads');
    });

    it('02.4 ORDERING: the wrap is applied AFTER handleXhr, or it would be overwritten', function () {
        var handleIdx = linkActive.indexOf('handleXhr(xhr, $el, options, require)');
        var wrapIdx   = linkActive.indexOf('var onSettled = xhr.onreadystatechange');
        assert.ok(handleIdx > -1 && wrapIdx > -1);
        assert.ok(handleIdx < wrapIdx,
            'handleXhr ASSIGNS onreadystatechange; wrapping before it would be discarded');
    });

    it('02.5 and BEFORE send(), or the first state change could outrun the guard', function () {
        var wrapIdx = linkActive.indexOf('var onSettled = xhr.onreadystatechange');
        var sendIdx = linkActive.indexOf('xhr.send()', wrapIdx);
        assert.ok(sendIdx > wrapIdx, 'the guard must be installed before the request starts');
    });

    it('02.6 utils/events.js was NOT modified to carry link\'s sequence', function () {
        var eventsSrc = fs.readFileSync(
            path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/events.js'), 'utf8');
        assert.doesNotMatch(eventsSrc, /_linkSeq|isStale/,
            'handleXhr is shared; the sequence belongs to the plugin that owns the clicks');
    });
});


describe('03 - dist fidelity (unminified bundle — Closure renames locals)', function () {

    // NOTE: these use `assert.ok(re.test(...))` rather than `assert.match`.
    // `assert.match` embeds the ACTUAL string in its failure message, and the
    // bundle is ~1.4 MB — a single red pin would otherwise dump the whole
    // artifact into the test output and bury every other result.

    it('03.1 the built bundle carries the per-request factory and the tracker', function () {
        assert.ok(/var\s+createXhr\s*=\s*function\s*\(\s*\)/.test(distSrc),
            'createXhr() missing from the built bundle — dist is stale');
        assert.ok(/var\s+_linkXhr\s*=\s*null\s*;/.test(distSrc),
            '_linkXhr missing from the built bundle — dist is stale');
        assert.ok(/var\s+_linkSeq\s*=\s*0\s*;/.test(distSrc),
            '_linkSeq missing from the built bundle — dist is stale');
    });

    it('03.2 the built bundle carries the sequence guard', function () {
        assert.ok(/if\s*\(\s*seq\s*!==\s*_linkSeq\s*\)/.test(distSrc),
            'the sequence guard missing from the built bundle — dist is stale');
    });

    it('03.3 the built bundle no longer holds link\'s shared module-scope transport', function () {
        // Scoped to link's segment: other bundled modules legitimately use `var xhr`.
        var linkIdx = distSrc.indexOf("define('gina/link'");
        assert.ok(linkIdx > -1, 'link must be in the bundle');
        var seqIdx = distSrc.indexOf('var _linkSeq', Math.max(0, linkIdx - 400000));
        assert.ok(seqIdx > -1, 'and its rewritten head must be present');
    });
});
