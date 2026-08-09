'use strict';
// #B287 + #B326 — the link plugin resolves the OPERATED registration, and publishes ONCE.
//
// #B287. `linkRequest(url, options)` re-derived its element from the url — `getLinkByUrl`
// walks the registrations and returns the FIRST `.url` match — so two anchors sharing one
// url collapsed onto the first: its loading state armed, its HTML-callback attributes were
// read, its listeners fired, whichever anchor was actually clicked. The dispatch listener
// in `registerLink` had ALREADY resolved the correct registration (`getLinkById(e.target.id)`)
// and then threw it away, passing only a bare url string back to `linkRequest`. The fix
// hands that registration through a module-scoped slot, consumed (and cleared) at
// `linkRequest` entry BEFORE any other step so an early exit can never leak it into a later
// call; the url lookup survives as the fallback for the public `gina.link.request(url)`
// path, which genuinely has nothing but a url. Both click paths — the direct anchor
// listener and `proxyClick`'s child delegation — dispatch into the same `registerLink`
// listener, so one hand-off site covers both.
//
// #B326. The publish was still the pre-#B90 merge-publish (`gina.link = merge(gina.link,
// instance)`). nav and popin were both fixed to publish ONCE (a second construction
// deep-merging into the live published instance freezes accessors and scalar state), and
// nav is pinned against regressing; link had neither the guard nor the pin. Measured
// before the change: `gina.link` is not pre-seeded anywhere and `merge(undefined,
// instance)` returns the instance — so the first construction is behaviourally identical
// under the guard, and only the #B90 freeze path changes.
//
// The runtime counterpart of #B287 lives in test/e2e/link-same-url-attribution.spec.js —
// this file is source pins plus an extracted-execution check, per the house pattern.

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW = require('../fw');
var LINK_SRC  = path.join(FW, 'core/asset/plugin/src/vendor/gina/link/main.js');
var NAV_SRC   = path.join(FW, 'core/asset/plugin/src/vendor/gina/nav/main.js');
var DIST_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }

// Drops whole-line comments, so a negative assertion cannot be tripped by the very
// comment that documents it. Same stripper as the sibling link tests: only lines that
// START with a marker are removed — a trailing `// …` on a code line survives.
function activeSource(p) {
    return read(p).split('\n').filter(function(l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// Extracts a balanced-brace block starting at `anchor` (see link-modifier-guard.test.js).
function blockAt(src, anchor) {
    var start = src.indexOf(anchor);
    assert.ok(start > -1, 'extraction anchor not found: ' + anchor);
    var open = src.indexOf('{', start);
    assert.ok(open > -1, 'no opening brace after anchor: ' + anchor);
    var depth = 0, i = open;
    for (; i < src.length; ++i) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    assert.equal(depth, 0, 'unbalanced braces while extracting block for: ' + anchor);
    return src.slice(start, i + 1);
}

var RESOLVE_RE = /var \$link\s*=\s*\$operated \|\| getLinkByUrl\(url\);/;


// ── 01 — the hand-off, pinned in source ──────────────────────────────────────

describe('01 - link: the operated-registration hand-off (#B287)', function() {

    it('01.1 the slot exists, and the identifier appears exactly four times in active source', function() {
        var code = activeSource(LINK_SRC);
        assert.ok(code.indexOf('var _operatedLink = null;') > -1,
            'the module-scoped slot must be declared (beside the transport state)');
        // declaration + consume + clear + dispatch-site set. A fifth occurrence means a
        // new consumer crept in; three means one of the halves was "simplified" away.
        assert.equal(code.split('_operatedLink').length - 1, 4,
            'exactly four uses: declare, consume, clear, set — nothing else may touch the slot');
    });

    it('01.2 linkRequest consumes and clears the slot FIRST — before the transport swap, before any lookup', function() {
        var block   = blockAt(read(LINK_SRC), 'function linkRequest(url, options)');
        var consume = block.indexOf('var $operated = _operatedLink;');
        var clear   = block.indexOf('_operatedLink = null;');
        var seq     = block.indexOf('var seq = ++_linkSeq;');
        var lookup  = block.indexOf('getLinkByUrl');
        assert.ok(consume > -1, 'linkRequest must consume the slot into a local');
        assert.ok(clear > consume, 'and clear it immediately after the consume');
        assert.ok(seq > clear,
            'consume+clear must precede the seq/abort block — an early exit there must not leak the slot into a later call');
        assert.ok(lookup > clear, 'no lookup may run before the slot is consumed');
    });

    it('01.3 the resolution prefers the operated registration and KEEPS the url fallback', function() {
        assert.match(activeSource(LINK_SRC), RESOLVE_RE,
            'expected `var $link = $operated || getLinkByUrl(url);` — the fallback serves gina.link.request(url), which has nothing but a url');
    });

    it('01.4 the dispatch listener hands off the registration it already resolved, then calls linkRequest', function() {
        var block = blockAt(read(LINK_SRC), 'addListener(gina, $el, evt, function(e)');
        var local = block.indexOf('var $localLink = getLinkById(e.target.id)');
        var set   = block.indexOf('_operatedLink = $localLink;');
        var call  = block.indexOf('linkRequest(localUrl, $localLink.options);');
        assert.ok(local > -1, 'control: this must be the registerLink dispatch listener');
        assert.ok(set > local, 'the hand-off must use the registration the listener resolved');
        assert.ok(call > set, 'and must be in place BEFORE linkRequest runs');
    });

    it('01.5 CONTROL: the pinned two-argument signature is untouched (green in both trees)', function() {
        // Mirrors link-loading-state.test.js:145. If this fails, the fix changed the
        // signature and every indexOf-anchored pin in the sibling files is suspect.
        assert.match(read(LINK_SRC), /function linkRequest\(url, options\)/);
    });
});


// ── 02 — the consume/resolve semantics, executed ─────────────────────────────
// Brace-extract the shipped lines and run them (the #B175 pattern): the pins above prove
// the text, this proves the short-circuit and the cannot-leak clear actually behave.

describe('02 - link: the extracted hand-off executes with the documented semantics', function() {

    var runSlice;

    before(function() {
        var src   = read(LINK_SRC);
        var start = src.indexOf('var $operated = _operatedLink;');
        assert.ok(start > -1, 'the consume line must exist (red before the fix lands)');
        var m = RESOLVE_RE.exec(src);
        assert.ok(m && m.index > start, 'the resolution line must follow the consume');
        var slice = src.slice(start, m.index + m[0].length);
        // The slice spans the seq/abort/createXhr block; stub its collaborators.
        var fn = new Function('_operatedLink', 'getLinkByUrl', 'createXhr', '_linkXhr', '_linkSeq', 'url',
            slice + '\nreturn { link: $link, cleared: _operatedLink };');
        runSlice = function(operated, lookup) {
            var calls = [];
            var out = fn(operated, function(u) { calls.push(u); return lookup; },
                function() { return {}; }, null, 0, '/probe');
            out.lookupCalls = calls;
            return out;
        };
    });

    it('02.1 an operated registration WINS, and the url lookup is short-circuited entirely', function() {
        var out = runSlice({ id: 'operated' }, { id: 'first-match' });
        assert.equal(out.link.id, 'operated', 'the clicked registration must win');
        assert.equal(out.lookupCalls.length, 0, 'getLinkByUrl must not even run — the first-match walk is the defect');
    });

    it('02.2 with no hand-off, the historical first-match lookup serves the public path', function() {
        var out = runSlice(null, { id: 'first-match' });
        assert.equal(out.link.id, 'first-match');
        assert.deepEqual(out.lookupCalls, ['/probe'], 'the fallback must receive the caller\'s url');
    });

    it('02.3 the slot cannot leak: it reads as cleared the moment it is consumed', function() {
        var out = runSlice({ id: 'operated' }, { id: 'first-match' });
        assert.equal(out.cleared, null,
            'a subsequent linkRequest — public or dispatched — must start from an empty slot');
    });
});


// ── 03 — the publish-once guard (#B326) ──────────────────────────────────────

describe('03 - link: publishes ONCE, guarded — never a merge-publish (#B326, the #B90 shape)', function() {

    it('03.1 the guarded publish is in place, inside the init publish block', function() {
        var code = activeSource(LINK_SRC);
        var anchor = code.indexOf('gina.hasLinkHandler = true;');
        assert.ok(anchor > -1, 'control: the publish block must still set hasLinkHandler');
        var windowed = code.slice(anchor, anchor + 400);
        assert.ok(windowed.indexOf("if ( typeof(gina.link) == 'undefined' || !gina.link ) {") > -1,
            'the publish must be guarded — later constructions have nothing to publish');
        assert.ok(windowed.indexOf('gina.link = instance;') > -1,
            'gina.link must be the LIVE first instance, not a merged copy');
    });

    it('03.2 the merge-publish stays deleted', function() {
        // Comment-stripped, so the #B326 comment explaining the removal cannot satisfy
        // the needle. Red before the fix: the pre-change line is `gina.link =
        // merge(gina.link, instance);`.
        assert.doesNotMatch(activeSource(LINK_SRC), /merge\(\s*gina\.link/,
            're-merging a later construction into the live published instance freezes accessors and scalar state (#B90)');
    });

    it('03.3 CONTROL: nav still carries the same guard — the two plugins stay in lockstep', function() {
        // Green in both trees, and it validates the guard-shape needle syntax: if this
        // fails, 03.1 could be failing on a broken needle rather than a missing guard.
        var nav = read(NAV_SRC);
        assert.ok(nav.indexOf("if ( typeof(gina.nav) == 'undefined' || !gina.nav ) {") > -1);
        assert.ok(nav.indexOf('gina.nav = instance;') > -1);
    });
});


// ── 04 — dist fidelity (unminified bundle — Closure renames locals in .min) ─────
// These double as the stale-artifact detector: they are RED between editing the source
// and rebuilding the bundle, which is exactly the state they exist to catch.

describe('04 - dist fidelity: the shipped bundle carries both changes', function() {

    it('04.1 the hand-off is in the built bundle', function() {
        var dist = read(DIST_PATH);
        assert.ok(dist.indexOf('var $operated = _operatedLink;') > -1, 'consume');
        assert.match(dist, RESOLVE_RE, 'resolution with fallback');
        assert.ok(dist.indexOf('_operatedLink = $localLink;') > -1, 'dispatch-site set');
    });

    it('04.2 the guarded publish is in the built bundle, and the merge-publish is gone', function() {
        var dist = read(DIST_PATH);
        assert.ok(dist.indexOf("if ( typeof(gina.link) == 'undefined' || !gina.link ) {") > -1);
        assert.doesNotMatch(dist, /merge\(\s*gina\.link/,
            'the bundle still carrying the merge-publish means the dist was not rebuilt after the source change');
    });
});
