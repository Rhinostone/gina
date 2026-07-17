'use strict';
/**
 * #B121 — completeHeaders falsy-routing guard (the bundle-kill fix)
 *
 * A failed route resolution can leave `request.routing` holding the boolean
 * `false` (getRouteByUrl's not-found sentinel, written verbatim onto the
 * request by the redirect path). core/server.js is strict-mode, and
 * completeHeaders' guard tested only `typeof == 'undefined'` — `typeof(false)`
 * is 'boolean', so the falsy value walked past the default-install and the
 * `.bundle` write onto the primitive threw:
 *
 *     TypeError: Cannot create property 'bundle' on boolean 'false'
 *
 * Worse, the throw fired from INSIDE the error-response path (throwError →
 * completeHeaders), so the router's catch re-entered throwError → the same
 * throw again, now uncaught → process kill (SIGTERM). One unresolvable
 * redirect target downed the whole bundle.
 *
 * Coverage: source pins + EXTRACT-AND-EXECUTE of the shipped guard bytes
 * (no replica to drift; the extraction is control-gated to exactly one match
 * and the run re-asserts 'use strict' — `new Function` bodies are sloppy by
 * default, and the entire bug only exists under strict mode) + a SUBTRACT
 * executing the same bytes with the guard perturbed back to the pre-fix
 * typeof-only shape, reproducing the exact TypeError.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/server.js');
var src    = fs.readFileSync(SOURCE, 'utf8');

// active source = comments stripped, so the `// was:` replace-code line cannot
// trip the negative pin (the documented own-comment trap)
var activeSrc = src.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');

describe('01 - #B121 completeHeaders: falsy-aware routing guard (source pins)', function() {

    it('server.js is strict-mode (the premise: a primitive property-write THROWS here)', function() {
        assert.match(src.slice(0, 200), /^'use strict';/, 'file-level strict mode is what turns the write into a crash');
    });

    it('the guard is falsy-aware: `if ( !request.routing )` installs the default routing object', function() {
        assert.ok(
            /if \( !request\.routing \) \{\s*\n\s*request\.routing = \{\s*\n\s*'url'\s*:\s*request\.url,\s*\n\s*'method':\s*request\.method\s*\n\s*\}/.test(src),
            'completeHeaders must install the default routing object for ANY falsy routing, not just undefined'
        );
    });

    it('negative (comment-stripped): the typeof-only guard on request.routing is gone from active code', function() {
        assert.ok(
            activeSrc.indexOf("if ( typeof(request.routing) == 'undefined' ) {") === -1,
            'the pre-fix typeof-only guard must not survive in active code — typeof(false) is "boolean", so it let the sentinel through'
        );
    });

    it('the .bundle default-fill guard on the (now guaranteed) object remains', function() {
        assert.ok(
            activeSrc.indexOf("if ( typeof(request.routing.bundle) == 'undefined' ) {") > -1,
            'the bundle default-fill must stay — it is correct once routing is a real object'
        );
    });
});

describe('02 - #B121 completeHeaders: extract-and-execute the SHIPPED guard bytes', function() {

    // ── extraction, control-gated ─────────────────────────────────────────────
    function extractGuardBlock(fromSrc) {
        var mm = fromSrc.match(/if \( (?:!request\.routing|typeof\(request\.routing\) == 'undefined') \) \{\s*request\.routing = \{\s*'url'\s*:\s*request\.url,\s*'method':\s*request\.method\s*\}\s*\}\s*if \( typeof\(request\.routing\.bundle\) == 'undefined' \) \{\s*request\.routing\.bundle = self\.appName\s*\}/g);
        assert.ok(mm, 'extraction control: the guard block must be found');
        assert.equal(mm.length, 1, 'extraction control: the guard block must match exactly once');
        return mm[0];
    }

    function runGuard(block, routingValue) {
        // `new Function` bodies are SLOPPY by default — re-assert strict mode, or
        // this harness models a world where the write silently no-ops and the
        // whole bug is invisible.
        var fn = new Function('request', 'self',
            "'use strict';\n" + block + "\nreturn request.routing;");
        return fn({ routing: routingValue, url: '/b121/x', method: 'GET' }, { appName: 'b121app' });
    }

    it('extraction fires on exactly one active guard block (instrument control)', function() {
        extractGuardBlock(activeSrc);
    });

    it('shipped bytes: routing === false → default object installed, bundle filled, NO throw', function() {
        var out = runGuard(extractGuardBlock(activeSrc), false);
        assert.equal(typeof out, 'object');
        assert.equal(out.url, '/b121/x');
        assert.equal(out.method, 'GET');
        assert.equal(out.bundle, 'b121app');
    });

    it('shipped bytes: routing === undefined → same default install (the historical case still works)', function() {
        var out = runGuard(extractGuardBlock(activeSrc), undefined);
        assert.equal(out.bundle, 'b121app');
        assert.equal(out.url, '/b121/x');
    });

    it('shipped bytes: routing === null → default install (typeof null is "object" — the sibling trap)', function() {
        var out = runGuard(extractGuardBlock(activeSrc), null);
        assert.equal(out.bundle, 'b121app');
    });

    it('shipped bytes: a REAL routing object without bundle → preserved, bundle default-filled', function() {
        var real = { url: '/kept', method: 'POST' };
        var out  = runGuard(extractGuardBlock(activeSrc), real);
        assert.equal(out, real, 'a live routing object must never be replaced');
        assert.equal(out.bundle, 'b121app');
    });

    it('shipped bytes: a routing object WITH bundle → fully untouched', function() {
        var real = { url: '/kept', method: 'POST', bundle: 'owner' };
        var out  = runGuard(extractGuardBlock(activeSrc), real);
        assert.equal(out.bundle, 'owner');
    });

    // ── SUBTRACT: the pre-fix shape, same bytes, same driver ──────────────────
    it('SUBTRACT (typeof-only guard restored): the same bytes THROW the exact #B121 TypeError on false', function() {
        var block     = extractGuardBlock(activeSrc);
        var perturbed = block.replace(
            'if ( !request.routing ) {',
            "if ( typeof(request.routing) == 'undefined' ) {"
        );
        assert.notEqual(perturbed, block, 'perturbation control: the replace must have changed the block');
        assert.throws(
            function () { runGuard(perturbed, false); },
            function (err) {
                return err instanceof TypeError
                    && /Cannot create property 'bundle' on boolean 'false'/.test(err.message);
            },
            'the pre-fix guard must reproduce the measured crash byte-for-byte'
        );
    });

    it('SUBTRACT control: the perturbed (pre-fix) bytes still work for undefined — the bug hid because the common case was fine', function() {
        var perturbed = extractGuardBlock(activeSrc).replace(
            'if ( !request.routing ) {',
            "if ( typeof(request.routing) == 'undefined' ) {"
        );
        var out = runGuard(perturbed, undefined);
        assert.equal(out.bundle, 'b121app', 'undefined passed the old guard — which is why the defect stayed invisible');
    });
});
