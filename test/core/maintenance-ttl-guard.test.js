/**
 * #B498 — `POST /_gina/maintenance` `ttlSeconds` must not FAIL OPEN.
 *
 * Both engines validated `enable` (400 when missing / non-boolean) but guarded
 * `ttlSeconds` with a single POSITIVE condition — integer, 1..86400 — and when it
 * failed simply left `until` null and answered 200. So a caller asking for a
 * bounded window (`ttlSeconds: 90000`, a float, a numeric string) got an UNBOUNDED
 * one: the dead-man switch was dropped in the fail-open direction, and the only
 * tell was `until: null` in a response nothing prompts you to read.
 *
 * After #B498 a PRESENT `ttlSeconds` that is not an integer in 1..86400 answers
 * 400 naming the bound and the config alternative, and the runtime state is left
 * untouched. Absent — and `null` — still mean "no timer", the documented default.
 *
 * Sections:
 *   01 — source pins on BOTH engines: the guard exists, sits ahead of the positive
 *        `_rtNew.until` arm, and the `enable` 400 it mirrors is still there (CONTROL).
 *   02 — behavioural: the POST callback is extracted from each engine's shipped
 *        bytes (bounded to the /_gina/maintenance region, end anchor asserted to
 *        FOLLOW the start) and driven with every input shape. Invalid shapes red-
 *        first; the valid/absent shapes are CONTROLs, green on both revisions.
 *
 * Red-first seams: GINA_SERVER_SRC / GINA_ISAAC_SRC point the pins at a pre-change
 * extract (e.g. `git show <sha>:framework/v<ver>/core/server.js > /tmp/pre.js`).
 */

'use strict';

var assert = require('node:assert');
var { describe, it } = require('node:test');
var fs     = require('fs');
var path   = require('path');

var FW = require('../fw');
var ENGINES = [
    { name: 'server.js (engine-agnostic)', file: process.env.GINA_SERVER_SRC || path.join(FW, 'core', 'server.js'),       send: 'response' },
    { name: 'server.isaac.js',             file: process.env.GINA_ISAAC_SRC  || path.join(FW, 'core', 'server.isaac.js'), send: '_mtSend'  }
];

var GUARD_MSG = '`ttlSeconds` must be an integer from 1 to 86400';

/**
 * The /_gina/maintenance handler region of one engine. The END anchor is asserted
 * to follow the START — a region whose end anchor is declared ahead of it reads
 * as a permanent -1 and is indistinguishable from a true red (measurement-traps).
 */
function maintenanceRegion(src) {
    var a = src.indexOf('── /_gina/maintenance');
    var b = src.indexOf('── /_gina/instrument');
    assert.ok(a > -1, 'start anchor present');
    assert.ok(b > -1, 'end anchor present');
    assert.ok(b > a, 'end anchor FOLLOWS the start anchor (' + a + ' < ' + b + ')');
    return src.slice(a, b);
}

/**
 * Lift the POST callback `function(_mbErr, _mbBody) { … }` out of the region and
 * compile it with every free identifier injected. The region's LAST `});` closes
 * the `_readInstrumentBody(request, …)` call, so the function text runs from the
 * callback keyword to that closing brace.
 */
function buildPostCallback(engine, src) {
    var region = maintenanceRegion(src);
    var start  = region.indexOf('function(_mbErr, _mbBody) {');
    assert.ok(start > -1, engine.name + ': POST callback present in the maintenance region');
    var end    = region.lastIndexOf('});');
    assert.ok(end > start, engine.name + ': callback closes inside the region');
    var fnText = region.slice(start, end + 1); // keep the closing `}` of the function
    // server.js answers through `response`; isaac through `_mtSend(status, obj)`.
    return new Function('response', '_mtSend', '_mtCtl', '_mtStatus', 'self', 'console', 'return ' + fnText);
}

/** One drive of the callback with a given body; returns what the engine answered + the state left behind. */
function drive(engine, cb, body) {
    var answered = { status: 200, json: null };
    var response = {
        statusCode: 200,
        setHeader: function() {},
        end: function(s) { answered.status = this.statusCode; answered.json = JSON.parse(s); }
    };
    var _mtSend = function(status, obj) { answered.status = status; answered.json = obj; };
    var _mtCtl  = { runtime: { active: false, until: null, sentinel: 'UNTOUCHED' } };
    var _mtStatus = function() { return { statusFrom: 'stub', runtime: _mtCtl.runtime }; };
    var fn = cb(response, _mtSend, _mtCtl, _mtStatus, { appName: 'tb498' }, { warn: function() {} });
    fn(null, body);
    return { status: answered.status, json: answered.json, runtime: _mtCtl.runtime };
}


// ── 01 — source pins ────────────────────────────────────────────────────────

describe('01 - #B498 source pins, both engines', function() {
    ENGINES.forEach(function(engine) {
        var src = fs.readFileSync(engine.file, 'utf8');

        it(engine.name + ': a present-but-invalid ttlSeconds is refused 400, ahead of the positive arm', function() {
            var region = maintenanceRegion(src);
            var guard  = region.indexOf(GUARD_MSG);
            var arm    = region.indexOf('_rtNew.until = Date.now() + (_mbBody.ttlSeconds * 1000)');
            assert.ok(guard > -1, 'the 400 guard names the bound');
            assert.ok(arm > -1, 'the positive arm is still there');
            assert.ok(guard < arm, 'the guard precedes the positive arm');
            assert.ok(region.indexOf('#B498') > -1, 'the marker comment is present');
        });

        it(engine.name + ': CONTROL — the `enable` 400 it mirrors is unchanged', function() {
            var region = maintenanceRegion(src);
            assert.ok(region.indexOf('_mbBody.enable !== true && _mbBody.enable !== false') > -1);
            assert.ok(region.indexOf('body must be {"enable":true|false') > -1);
        });
    });
});


// ── 02 — behavioural, on the shipped bytes ──────────────────────────────────

describe('02 - #B498 behavioural: the extracted POST callback, both engines', function() {
    ENGINES.forEach(function(engine) {
        var src = fs.readFileSync(engine.file, 'utf8');
        var cb  = buildPostCallback(engine, src);

        // Every shape that used to slip through and arm an UNBOUNDED window.
        [
            ['too large (25h)',        90000],
            ['zero',                   0],
            ['negative',               -1],
            ['a float',                1800.5],
            ['a numeric string',       '1800'],
            ['NaN (upstream parser)',  NaN],
            ['Infinity',               Infinity],
            ['a boolean',              true]
        ].forEach(function(c) {
            it(engine.name + ': ttlSeconds ' + c[0] + ' → 400, runtime untouched', function() {
                var r = drive(engine, cb, { enable: true, ttlSeconds: c[1] });
                assert.strictEqual(r.status, 400, 'got ' + r.status + ' ' + JSON.stringify(r.json));
                assert.strictEqual(r.json.error, 'bad_request');
                assert.ok(r.json.message.indexOf('86400') > -1, 'names the bound: ' + r.json.message);
                assert.ok(r.json.message.indexOf('server.maintenance.enabled') > -1, 'names the config alternative');
                assert.strictEqual(r.runtime.sentinel, 'UNTOUCHED', 'a refused request must not flip the state');
            });
        });

        // The shapes that are, and stay, legal.
        it(engine.name + ': CONTROL — absent ttlSeconds → 200, no timer', function() {
            var r = drive(engine, cb, { enable: true });
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.runtime.active, true);
            assert.strictEqual(r.runtime.until, null);
        });
        it(engine.name + ': null ttlSeconds → 200, treated as absent', function() {
            var r = drive(engine, cb, { enable: true, ttlSeconds: null });
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.runtime.until, null);
        });
        [['lower bound', 1], ['typical', 1800], ['upper bound (24h)', 86400]].forEach(function(c) {
            it(engine.name + ': CONTROL — ttlSeconds ' + c[0] + ' → 200 with a timer', function() {
                var t0 = Date.now();
                var r  = drive(engine, cb, { enable: true, ttlSeconds: c[1] });
                assert.strictEqual(r.status, 200, JSON.stringify(r.json));
                assert.ok(typeof r.runtime.until === 'number', 'until armed');
                assert.ok(r.runtime.until >= t0 + c[1] * 1000 - 5 && r.runtime.until <= Date.now() + c[1] * 1000 + 5, 'until ≈ now + ttl');
            });
        });
        it(engine.name + ': CONTROL — a bad `enable` is still refused first', function() {
            var r = drive(engine, cb, { enable: 'yes', ttlSeconds: 90000 });
            assert.strictEqual(r.status, 400);
            assert.ok(r.json.message.indexOf('body must be') > -1, 'the enable message, not the ttl one');
        });
    });
});
