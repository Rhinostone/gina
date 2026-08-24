'use strict';
/**
 * #B414 / #B415 / #B416 — client-boot routing-dependency gate.
 *
 * The client routing table arrives ONLY by async fetch (the server whispers
 * `page.environment.routing` as a hardcoded '{}'), yet handler release was
 * driven by DOMContentLoaded alone. Loopback wins that race by single-digit
 * milliseconds; a real deployment loses it by 150ms+ on every load — so any
 * getRoute()/toUrl() during handler init ran against `{}`, deterministically,
 * on deployed tiers only. Consumer-reported with a two-way Playwright repro
 * (delaying only the routing fetch flips a passing page into the broken one).
 *
 * Strategy (house style: no live browser here — the client bundle cannot be
 * smoke-tested from a static page, because the loader script is rendered
 * per-page with server-whispered values and its raw form carries
 * un-interpolated tokens): source pins on the three gated release paths +
 * pure-logic replicas of the settle/queue semantics and the scheduler gate.
 * Every pin red-first validated against the pre-change source.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var CORE     = path.join(FW, 'core/asset/plugin/src/vendor/gina/core.js');
var ROUTING  = path.join(FW, 'lib/routing/src/main.js');

describe('01 - #B414 source pins: the three release paths gate on depsSettled', function() {

    var src;
    before(function() { src = fs.readFileSync(CORE, 'utf8'); });

    it('the settle flag, queue and helpers exist at file scope', function() {
        assert.ok(src.indexOf('var _ginaDepsSettled = false;') > -1, 'flag');
        assert.ok(src.indexOf('var _ginaDepsQueue   = [];') > -1,   'queue');
        assert.ok(src.indexOf('function _settleDeps(forced)') > -1, 'settle fn');
        assert.ok(src.indexOf('function _whenDepsSettled(fn)') > -1,'when fn');
    });

    it('the 5s force-settle is armed at PARSE TIME, not inside getDependencies', function() {
        // The timer exists for the degenerate case where the fetch is NEVER
        // issued (script-tag scan matches nothing) — arming it inside
        // getDependencies would never start it in exactly that case.
        var timerAt   = src.indexOf('setTimeout(function () { _settleDeps(true); }, 5000);');
        var getDepsAt = src.indexOf('function getDependencies');
        assert.ok(timerAt > -1, 'force-settle timer present');
        assert.ok(getDepsAt > -1, 'getDependencies present');
        assert.ok(timerAt < getDepsAt,
            'the timer must be armed above/outside getDependencies (parse time)');
    });

    it('path 1 — the readyList scheduler advances only on result AND depsSettled', function() {
        assert.ok(/if\s*\(\s*result\s*&&\s*_ginaDepsSettled\s*\)\s*\{\s*\n\s*window\.clearInterval\(scheduler\);/.test(src),
            'scheduler advance gated on both');
        assert.equal(/if\s*\(result\)\s*\{\s*\n\s*window\.clearInterval\(scheduler\);/.test(src), false,
            'the ungated advance must be gone');
    });

    it('path 2 — bootValidator polls until depsSettled too', function() {
        var fn = src.substring(src.indexOf('var bootValidator = function'), src.indexOf('bootValidator();'));
        assert.ok(/\|\|\s*!_ginaDepsSettled/.test(fn), 'deps condition in the retry gate');
    });

    it('path 3 — the late gina.ready (readyFired) branch queues through _whenDepsSettled', function() {
        // This branch bypasses the scheduler entirely (setTimeout(cb,1)) — the
        // path both the consumer report and the first fix draft missed.
        var i = src.indexOf('if (readyFired) {');
        assert.ok(i > -1);
        var branch = src.slice(i, i + 700);
        assert.ok(branch.indexOf('_whenDepsSettled(function () {') > -1,
            'late registrations must gate on the deps too');
    });

    it('the real settle fires where cb() already fired (loaded AND failed both settle)', function() {
        assert.ok(/_settleDeps\(\);\s*\n\s*cb\(\)/.test(src),
            '_settleDeps() precedes cb() in the deps.loaded drain');
    });

    it('#B416 — the deps.loaded listener surfaces event.detail.error', function() {
        var i = src.indexOf("depsEventBus.addEventListener('deps.loaded'");
        assert.ok(i > -1);
        var listener = src.slice(i, i + 1200);
        assert.ok(listener.indexOf('event.detail.error') > -1, 'detail.error is read');
        assert.ok(listener.indexOf('routing dependency failed to load') > -1,
            'a failed fetch now leaves console evidence');
    });

    it('the gina.ready docblock no longer claims plain DOMContentLoaded equivalence', function() {
        assert.equal(src.indexOf("It is an equivalent of document.addEventListener('DOMContentLoaded', cb)"), -1,
            'stale docblock gone');
        assert.ok(src.indexOf('mandatory routing dependency have settled') > -1,
            'docblock states the new contract');
    });
});

describe('02 - #B414 replica: settle/queue semantics', function() {

    /** Line-for-line replica of the shipped _settleDeps/_whenDepsSettled pair. */
    function makeGate() {
        var settled = false, queue = [], forcedLog = 0;
        function settleDeps(forced) {
            if (settled) return;
            settled = true;
            if (forced) forcedLog++;
            while (queue.length) queue.shift()();
        }
        function whenSettled(fn) { settled ? fn() : queue.push(fn); }
        return {
            settle: settleDeps, when: whenSettled,
            isSettled: function(){ return settled; },
            forcedLogs: function(){ return forcedLog; },
            pending: function(){ return queue.length; }
        };
    }

    it('queued callbacks run exactly once, on settle, in order', function() {
        var g = makeGate(), ran = [];
        g.when(function(){ ran.push('a'); });
        g.when(function(){ ran.push('b'); });
        assert.equal(ran.length, 0, 'nothing runs before settle');
        g.settle();
        assert.deepEqual(ran, ['a', 'b']);
        assert.equal(g.pending(), 0);
    });

    it('a callback registered AFTER settle runs immediately', function() {
        var g = makeGate(), ran = 0;
        g.settle();
        g.when(function(){ ran++; });
        assert.equal(ran, 1);
    });

    it('settle is idempotent — forced then real (or reversed) settles once', function() {
        var g = makeGate(), ran = 0;
        g.when(function(){ ran++; });
        g.settle(true);   // the 5s fallback
        g.settle();       // the fetch lands late
        assert.equal(ran, 1, 'drain happens once');
        assert.equal(g.forcedLogs(), 1, 'only the FIRST settle logs (and only if forced)');
    });

    it('real settle first means the fallback logs nothing', function() {
        var g = makeGate();
        g.settle();       // fetch landed in time
        g.settle(true);   // the 5s timer fires later — must be a no-op
        assert.equal(g.forcedLogs(), 0, 'no spurious degraded-table error on healthy pages');
    });
});

describe('03 - #B414 replica: scheduler advance truth table', function() {

    /** The shipped advance condition. */
    function advances(result, depsSettled) { return !!(result && depsSettled); }

    it('framework truthy + deps pending → keep polling (the old bug: this advanced)', function() {
        assert.equal(advances(true, false), false);
    });
    it('framework truthy + deps settled → advance (the only release)', function() {
        assert.equal(advances(true, true), true);
    });
    it('framework not ready → never advances regardless of deps', function() {
        assert.equal(advances(false, true), false);
        assert.equal(advances(false, false), false);
    });
});

describe('04 - #B415: getRoute names the bundle instead of null-dereferencing', function() {

    var src;
    before(function() { src = fs.readFileSync(ROUTING, 'utf8'); });

    it('source: a null-table guard sits between getRouting and the #B132 check', function() {
        var get  = src.indexOf('var routing = config.getRouting(bundle, env);');
        var b132 = src.indexOf('#B132 — name the bundle');
        var guard = src.indexOf('has no routing table for rule');
        assert.ok(get > -1 && b132 > -1 && guard > -1, 'all three anchors present');
        assert.ok(get < guard && guard < b132,
            'guard placed after getRouting and before the #B132 deref');
    });

    it('replica: null table → named error; missing rule → the #B132 shape; hit → route', function() {
        function resolve(routing, rule, bundle) {
            if ( !routing ) {
                throw new Error('[ RoutingHelper::getRoute(rule, params) ] : bundle `'+ bundle +'` has no routing table for rule `'+ rule +'` (client: routing config not loaded yet, or empty)');
            }
            if ( typeof(routing[rule]) == 'undefined' ) {
                throw new Error('[ RoutingHelper::getRouting(rule, params) ] : `' + rule + '` not found ! (bundle `'+ bundle +'` holds '+ Object.keys(routing).length +' rules)');
            }
            return routing[rule];
        }
        // the fixed case: null table (the pre-fetch client state) names the bundle
        assert.throws(function(){ resolve(null, 'home@web', 'web'); },
            /bundle `web` has no routing table for rule `home@web`/);
        // control — the #B132 path is untouched for a present-but-missing rule
        assert.throws(function(){ resolve({}, 'home@web', 'web'); }, /holds 0 rules/);
        assert.throws(function(){ resolve({ other: 1 }, 'home@web', 'web'); }, /holds 1 rules/);
        // control — a hit resolves
        assert.equal(resolve({ 'home@web': 42 }, 'home@web', 'web'), 42);
        // the pre-fix behaviour this replaces: a bare TypeError with no bundle name
        assert.throws(function(){ var r = null; void r['home@web']; }, TypeError);
    });
});
