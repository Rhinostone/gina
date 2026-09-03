'use strict';
/**
 * #B462 — client-side notFound registry: composed diagnostics must be EMITTED
 *
 * Strategy: source inspection + inline logic replicas (the routing-fixes.test.js
 * pattern — no live HTTP server, no framework bootstrap, no browser).
 *
 * Context: `getRouteByUrl`'s GFF (browser) branch detects a rendered
 * `404:[<METHOD>]<rule>@<bundle>` marker, composes a precise
 * "route [ %r ] is called but not found inside your view" message and stores it
 * on the `self.notFound` registry — but nothing ever emitted it (two of the
 * three registry-create arms carried a disabled warn, the first never had one),
 * and the third arm (the compareUrls alt-route bookkeeping) never wrote the
 * registry entry at all, leaving its own increment arm unreachable. The
 * server-side fallback branch, by contrast, has always warned — the asymmetry
 * this fix removes. Consumer-reported (silent dead links on a 200 page).
 *
 * Suites:
 *  01 — source pins: every registry-create arm emits console.warn(msg) once,
 *       the alt-route arm writes the registry entry, no disabled warn remains
 *  02 — inline replica: warn-once-per-key semantics + the pre-fix alt-route
 *       shape as a subtract (its increment arm provably unreachable)
 *  03 — dist fidelity: the browser bundle carries the emission (pins derived
 *       from the built artifact, validated red against the pre-fix dist)
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');

var FW          = require('../fw');
var ROUTING_SRC = path.join(FW, 'lib/routing/src/main.js');
var DIST_MIN    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var src = require('fs').readFileSync(ROUTING_SRC, 'utf8');


// ─── 01 — source pins ─────────────────────────────────────────────────────────

describe('01 - notFound registry emission: source structure', function() {

    it('every registry-create arm is followed by console.warn(msg) — exactly 3', function() {
        // The create arm's closing shape `message: msg };` immediately followed by
        // the emission. Repeat visits take the ++count arm and must NOT re-warn —
        // the registry itself is the dedup. (Measured pre-fix: 0; the two
        // pre-existing create arms closed silently, the third did not exist.)
        var m = src.match(/message:\s*msg\s*\}\s*;?\s*console\.warn\(msg\)/g) || [];
        assert.equal(m.length, 3,
            'expected all 3 notFound create arms to emit the composed message once (got ' + m.length + ')');
    });

    it('the alt-route bookkeeping arm writes its registry entry (the missing write)', function() {
        // Pre-fix, this branch composed msg but never wrote self.notFound[notFound],
        // so its else-arm increment could never fire. Anchor on the branch gate
        // (code-unique, measured 1 occurrence) and require the assignment form —
        // ` = {` discriminates from the ++count member access — before return false.
        var a = src.indexOf('if(altRoute.past && isMethodProvidedByDefault)');
        assert.ok(a > -1, 'alt-route branch gate not found');
        var blk = src.substring(a, src.indexOf('return false', a));
        assert.ok(blk.indexOf('self.notFound[notFound] = {') > -1,
            'alt-route create arm must write the registry entry');
        assert.ok(blk.indexOf('console.warn(msg)') > -1,
            'alt-route create arm must emit the composed message');
    });

    it('no disabled warn remains in the file', function() {
        // The two historical `//console.warn(msg);` lines are the defect —
        // re-enabled, not duplicated. (Measured pre-fix: 2.)
        assert.equal(src.split('//console.warn(msg);').length - 1, 0,
            'disabled console.warn(msg) lines must be gone');
    });

    it('registry assignment count is 3 (marker-scan, reverseRouting, alt-route)', function() {
        // Pre-fix: 2 — the alt-route arm was the missing writer.
        assert.equal(src.split('self.notFound[notFound] = {').length - 1, 3);
    });

    it('retained control: the server-side fallback warn is untouched', function() {
        // This branch always emitted (the asymmetry the fix removes). It must
        // still be there — a retained control, expected green on both revisions.
        assert.equal(src.split('route not found for url').length - 1, 1);
    });
});


// ─── 02 — inline replica: warn-once-per-key semantics ─────────────────────────

// Mirrors the fixed create/increment shape shared by all three arms.
function notFoundBookkeeping(registry, key, msg, warn) {
    if (typeof(registry[key]) == 'undefined') {
        registry[key] = {
            count: 1,
            message: msg
        };
        warn(msg);
    } else {
        ++registry[key].count;
    }
}

describe('02 - notFound bookkeeping replica: warn once per key, count repeats', function() {

    it('first sighting creates the entry and warns exactly once', function() {
        var reg = {}, warns = [];
        notFoundBookkeeping(reg, 'GET::home@public', 'msg-a', function(m){ warns.push(m); });
        assert.equal(reg['GET::home@public'].count, 1);
        assert.equal(reg['GET::home@public'].message, 'msg-a');
        assert.deepEqual(warns, ['msg-a']);
    });

    it('repeat sightings increment the count and do NOT re-warn', function() {
        var reg = {}, warns = [];
        notFoundBookkeeping(reg, 'k', 'msg', function(m){ warns.push(m); });
        notFoundBookkeeping(reg, 'k', 'msg', function(m){ warns.push(m); });
        notFoundBookkeeping(reg, 'k', 'msg', function(m){ warns.push(m); });
        assert.equal(reg['k'].count, 3);
        assert.equal(warns.length, 1, 'the registry is the dedup — one warn per key');
    });

    it('distinct keys each warn once', function() {
        var reg = {}, warns = [];
        notFoundBookkeeping(reg, 'a', 'msg-a', function(m){ warns.push(m); });
        notFoundBookkeeping(reg, 'b', 'msg-b', function(m){ warns.push(m); });
        assert.deepEqual(warns, ['msg-a', 'msg-b']);
    });

    it('SUBTRACT — the pre-fix alt-route shape (no registry write) can never reach its increment arm', function() {
        // The defect being fixed, demonstrated: without the create-arm write,
        // every visit is a "first" visit — the count never moves, and with the
        // warn also disabled the whole branch was pure dead bookkeeping.
        function preFixShape(registry, key, warns) {
            if (typeof(registry[key]) == 'undefined') {
                // (composed msg here; no registry write, warn disabled)
            } else {
                ++registry[key].count; // unreachable
            }
        }
        var reg = {};
        preFixShape(reg, 'k');
        preFixShape(reg, 'k');
        assert.equal(typeof reg['k'], 'undefined',
            'pre-fix shape never creates the entry, so the increment arm is dead code');
    });
});


// ─── 03 — dist fidelity ───────────────────────────────────────────────────────

describe('03 - dist fidelity: the browser bundle carries the emission', function() {

    it('gina.min.js pairs each surviving registry write with a console.warn', function() {
        // `.notFound[` is a property access (survives SIMPLE optimizations) and
        // `console.warn` is a global chain (survives too). Wrap-agnostic, name-
        // agnostic: an assignment into the registry whose object literal ends in
        // the message member, followed within the same statement run by a warn.
        // Validated red against the pre-fix artifact via git show (0 there).
        var dist = require('fs').readFileSync(DIST_MIN, 'utf8');
        var m = dist.match(/message:\s*[$\w.]+\s*\}\s*,?\s*console\.warn\(/g) || [];
        assert.ok(m.length >= 3,
            'expected >=3 registry-write→warn pairs in the built bundle (got ' + m.length + ')');
    });
});
