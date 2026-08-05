'use strict';
/**
 * link plugin — `data-gina-loading` arm on click, release on `loadend`.
 *
 * The link plugin had no loading handling at all. It now arms the clicked anchor through
 * the shared `lib/loading-state` primitive and releases it from a `loadend` LISTENER.
 *
 * ## Why `loadend`, and why that is not blocked on #B282
 *
 * link's completion path is `utils/events.js::handleXhr`, whose readyState-4 chain reads
 * `} else if ( xhr.status != 0 ) {` — so a request that ends at readyState 4 with status 0
 * (an abort, or a genuine network failure) executes no branch and fires no event. Waiting
 * for that gap to close before arming would have blocked this on #B282, which is a
 * consumer-visible behaviour change (it starts firing `error.<id>` where the plugin is
 * silent today).
 *
 * A `loadend` listener sidesteps it entirely: a LISTENER emits no events of its own, so it
 * releases on success, error, abort AND the status-0 failure with zero consumer-visible
 * surface. §03.2 measures that status-0 arm directly rather than asserting it.
 *
 * ## The one invariant that is easy to get backwards
 *
 * The release is deliberately NOT sequence-guarded, unlike the response wrapper
 * `link-xhr-lifecycle.test.js §02` pins. The sequence exists to drop a stale RESPONSE; a
 * superseded request must still RELEASE its trigger, and guarding the release would strand
 * exactly the trigger the feature exists to protect. That is safe because `abort()` fires
 * `loadend` synchronously, so a superseded request releases BEFORE the newer click arms —
 * §03.4 measures that ordering rather than trusting the spec text.
 *
 * ## Residual, stated rather than implied
 *
 * A request that never terminates never fires `loadend`, so an indefinite hang still
 * strands the trigger. That is #B283 (no `xhr.timeout` is set), a separate behaviour
 * change, and it is NOT covered here or by this file.
 *
 * ## Test shape
 *
 * §01/§02 are source pins: the arm/release lives inside `LinkPlugin`'s closure over
 * `$el`/`xhr`, which `architecture/jsdoc.md` scopes out of the extract-and-execute escape
 * hatch — same reasoning `link-xhr-lifecycle.test.js` records at length.
 *
 * §03 is genuinely behavioural anyway, by extracting the SHIPPED arm/release block and
 * running it against real jsdom nodes and a real failing XHR — the pattern `jsdoc.md`
 * records for #B175. The bytes under test are the shipped bytes, not a replica, and §03.3
 * is a firing subtract proving the listener is what releases.
 *
 * Dist pins target the UNMINIFIED `gina.js`: Closure renames locals, so `loadingState`
 * does not survive into `gina.min.js` and a pin on it there would be permanently red.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var http   = require('http');

var { JSDOM } = require('jsdom');

var FW = require('../fw');

var LINK_PATH = path.join(FW, 'core/asset/plugin/src/vendor/gina/link/main.js');
var DIST_PATH = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var LS_PATH   = path.join(FW, 'lib/loading-state/src/main.js');

var loadingState = require(LS_PATH);

var linkSrc, linkActive, distSrc, armBlock, runArmBlock;

/**
 * Strip comment lines so a NEGATIVE pin cannot trip on prose. This change's own
 * comments name every construct the negatives below exclude ("no `addEventListener`",
 * "the sequence drops a stale RESPONSE"), which is the own-JSDoc trap `jsdoc.md`
 * documents for negative source pins.
 */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * Brace-match a block out of the (comment-stripped) source so §03 executes the shipped
 * bytes rather than a replica. Extracting from the stripped text is deliberate: it
 * guarantees the anchor matched CODE and not a comment that happens to quote it.
 */
function extractBlock(src, anchor) {
    var start = src.indexOf(anchor);
    assert.ok(start > -1, 'extraction anchor not found in source: ' + anchor);
    var open  = src.indexOf('{', start);
    assert.ok(open > -1, 'no opening brace after anchor');
    var depth = 0, i = open;
    for (; i < src.length; ++i) {
        if (src[i] === '{') { ++depth; }
        else if (src[i] === '}') { --depth; if (depth === 0) { break; } }
    }
    assert.equal(depth, 0, 'unbalanced braces while extracting the arm block');
    return src.slice(start, i + 1);
}

// The semantic token, used for the uniqueness/ordering/dist pins.
var ARM_ANCHOR = "typeof(xhr.addEventListener) == 'function'";
// The whole statement, used for extraction: slicing from the token alone starts
// mid-expression and yields a dangling `) {`, which `new Function` rejects.
var ARM_STATEMENT = 'if ( ' + ARM_ANCHOR + ' ) {';

/** A fresh document + anchor per case, so no test inherits another's attribute. */
function freshAnchor(url) {
    var dom = new JSDOM('<!doctype html><html><body><a id="lnk" data-gina-link>Go</a></body></html>',
        { url: url || 'http://127.0.0.1/' });
    return { dom: dom, $a: dom.window.document.getElementById('lnk') };
}

before(function () {
    linkSrc    = fs.readFileSync(LINK_PATH, 'utf8');
    linkActive = stripComments(linkSrc);
    distSrc    = fs.readFileSync(DIST_PATH, 'utf8');
    armBlock   = extractBlock(linkActive, ARM_STATEMENT);
    // The shipped block, callable. `loadingState` is passed in rather than closed over so
    // the test can not accidentally substitute a stub for the real primitive.
    runArmBlock = new Function('xhr', '$el', 'loadingState', armBlock);
});


describe('00 - instrument', function () {

    it('00.1 the extraction anchor is unique, so §03 runs the block it means to', function () {
        var hits = linkActive.split(ARM_ANCHOR).length - 1;
        assert.equal(hits, 1, 'the arm gate must appear exactly once in the active source');
    });

    it('00.2 the extracted block really is the arm/release pair, not a neighbour', function () {
        assert.match(armBlock, /loadingState\.arm\(\s*\$el\s*\)/, 'block must arm');
        assert.match(armBlock, /addEventListener\(\s*'loadend'/, 'block must attach loadend');
        assert.match(armBlock, /loadingState\.disarm\(\s*\$el\s*\)/, 'block must release');
    });

    it('00.3 the comment stripper removes prose naming the excluded constructs', function () {
        assert.ok(/no `addEventListener`/.test(linkSrc),
            'precondition: the source comment names addEventListener');
        assert.ok(!/no `addEventListener`/.test(linkActive),
            'the stripper must remove it, or every negative pin below is trippable by prose');
    });

    it('00.4 a known-present token survives stripping (the stripper is not eating code)', function () {
        assert.match(linkActive, /function linkRequest\(url, options\)/);
    });
});


describe('01 - wiring', function () {

    it('01.1 the AMD define array declares the shared primitive', function () {
        assert.match(
            linkActive,
            /define\(\s*'gina\/link'\s*,\s*\[[^\]]*'lib\/loading-state'[^\]]*\]/,
            'lib/loading-state must be a declared dependency, not an implicit global'
        );
    });

    it('01.2 the primitive is bound to a local', function () {
        assert.match(linkActive, /var\s+loadingState\s*=\s*require\(\s*'lib\/loading-state'\s*\)/);
    });

    it('01.3 arm and release both target `$el` — the anchor — never `event.target`', function () {
        // `$el` is `getElementById($link.id)`, i.e. the registered anchor. Arming from a
        // click target instead would land the state on an inner node on the child-click
        // path; `resolveTrigger` is not needed here precisely because this site never
        // sees the inner node.
        assert.match(armBlock, /loadingState\.arm\(\s*\$el\s*\)/);
        assert.ok(!/event\.target|e\.target/.test(armBlock),
            'the arm site must not reach for a click target it does not have');
    });
});


describe('02 - the release contract', function () {

    it('02.1 never arms what it can not release — the arm is gated on addEventListener', function () {
        // The CORS branch can swap in a legacy XDomainRequest, which has no
        // addEventListener and therefore no loadend. Arming it would strand it forever.
        var gate = armBlock.indexOf(ARM_ANCHOR);
        var arm  = armBlock.search(/loadingState\.arm\(/);
        assert.ok(gate > -1 && arm > gate, 'the arm must sit INSIDE the addEventListener gate');
    });

    it('02.2 releases on `loadend`, not on readyState 4', function () {
        assert.match(armBlock, /addEventListener\(\s*'loadend'\s*,\s*function/);
        assert.ok(!/readyState/.test(armBlock),
            'a readyState-4 release would sit behind the sequence guard and skip superseded requests');
    });

    it('02.3 ORDERING: the arm sits BELOW the `!xhr` throw', function () {
        // Arming above it would light a trigger for a transport that never materialises.
        var thrown = linkActive.indexOf("throw new Error('No `xhr` object initiated')");
        var armed  = linkActive.indexOf(ARM_ANCHOR);
        assert.ok(thrown > -1 && armed > -1, 'both anchors must be present');
        assert.ok(armed > thrown, 'the arm must come after the no-transport throw');
    });

    it('02.4 the release is NOT sequence-guarded — a superseded request must still release', function () {
        assert.ok(!/_linkSeq/.test(armBlock),
            'guarding the release on the sequence would strand the very trigger it protects');
        // Control: the sequence guard genuinely exists elsewhere in the file, so this
        // negative is scoped to the block rather than vacuous.
        assert.match(linkActive, /seq\s*!==\s*_linkSeq/, 'the response wrapper still carries its guard');
    });

    it('02.5 a synchronous send() throw releases before the error escapes', function () {
        var sendIdx = linkActive.indexOf('xhr.send();');
        assert.ok(sendIdx > -1, 'send() must still be called');
        var window = linkActive.slice(sendIdx, sendIdx + 400);
        assert.match(window, /catch\s*\(\s*sendErr\s*\)/, 'send() must be wrapped');
        assert.match(window, /loadingState\.disarm\(\s*\$el\s*\)/, 'the catch must release');
        assert.match(window, /throw\s+sendErr/, 'and must rethrow unchanged');
    });
});


describe('03 - behavioural: the SHIPPED block, executed', function () {

    it('03.1 arms the anchor at send time', function () {
        var f   = freshAnchor();
        var xhr = new f.dom.window.XMLHttpRequest();
        xhr.open('GET', 'http://127.0.0.1:1/nope');

        assert.equal(f.$a.getAttribute('data-gina-loading'), null, 'precondition: not armed');
        runArmBlock(xhr, f.$a, loadingState);
        assert.equal(f.$a.getAttribute('data-gina-loading'), 'true');
    });

    it('03.2 releases on a readyState-4/status-0 failure — the case handleXhr is silent on', function (t, done) {
        var f   = freshAnchor();
        var xhr = new f.dom.window.XMLHttpRequest();
        xhr.open('GET', 'http://127.0.0.1:1/nope');

        runArmBlock(xhr, f.$a, loadingState);
        // Registered second, so the shipped listener has already run when this fires.
        xhr.addEventListener('loadend', function () {
            try {
                assert.equal(xhr.status, 0, 'arm precondition: this really is the status-0 path');
                assert.equal(f.$a.getAttribute('data-gina-loading'), 'false', 'released');
                done();
            } catch (err) { done(err); }
        });
        xhr.send();
    });

    it('03.3 SUBTRACT — the same arm WITHOUT the listener strands the trigger', function (t, done) {
        var f   = freshAnchor();
        var xhr = new f.dom.window.XMLHttpRequest();
        xhr.open('GET', 'http://127.0.0.1:1/nope');

        loadingState.arm(f.$a); // the block's release removed, nothing else changed
        xhr.addEventListener('loadend', function () {
            try {
                assert.equal(f.$a.getAttribute('data-gina-loading'), 'true',
                    'control must fire: without the loadend listener the trigger stays lit');
                done();
            } catch (err) { done(err); }
        });
        xhr.send();
    });

    it('03.4 a superseded request releases INSIDE abort(), before a newer click could arm', function (t, done) {
        // A real server, so the request is genuinely in flight rather than instantly
        // refused. abort() is called immediately after send() — no wall-clock wait — and
        // the assertion is on the state the moment abort() RETURNS.
        var server = http.createServer(function (req, res) {
            setTimeout(function () { res.end('late'); }, 10000).unref();
        });
        server.listen(0, '127.0.0.1', function () {
            var port = server.address().port;
            var f    = freshAnchor('http://127.0.0.1:' + port + '/');
            var xhr  = new f.dom.window.XMLHttpRequest();
            xhr.open('GET', 'http://127.0.0.1:' + port + '/slow');

            runArmBlock(xhr, f.$a, loadingState);
            xhr.send();

            var err = null;
            try {
                assert.equal(f.$a.getAttribute('data-gina-loading'), 'true', 'armed while in flight');
                xhr.abort();
                assert.equal(f.$a.getAttribute('data-gina-loading'), 'false',
                    'released synchronously inside abort() — this is what makes '
                    + 'supersede-then-arm safe without a sequence guard on the release');
            } catch (e) { err = e; }
            server.close(function () { done(err); });
        });
    });
});


describe('04 - dist fidelity (unminified bundle — Closure renames locals)', function () {

    it('04.1 the built bundle declares the primitive as a link dependency', function () {
        assert.match(
            distSrc,
            /define\(\s*'gina\/link'\s*,\s*\[[^\]]*'lib\/loading-state'[^\]]*\]/,
            'the shipped bundle must carry the dependency, or link resolves it to undefined'
        );
    });

    it('04.2 the built bundle carries the gated arm and the loadend release', function () {
        var idx = distSrc.indexOf(ARM_ANCHOR);
        assert.ok(idx > -1, 'the arm gate must be in the built bundle');
        var window = distSrc.slice(idx, idx + 400);
        assert.match(window, /loadingState\.arm\(\s*\$el\s*\)/);
        assert.match(window, /addEventListener\(\s*'loadend'/);
        assert.match(window, /loadingState\.disarm\(\s*\$el\s*\)/);
    });
});
