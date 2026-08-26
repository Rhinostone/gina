'use strict';
/**
 * #B423 — the per-request routing-host copy must not CREATE undefined-valued keys.
 *
 * `core/config.js` deliberately excludes `param.control === 'redirect'` rules from
 * the host/hostname defaulting, so those keys are ABSENT on such rules. The
 * `setOptions` copy loop then copied `envConf.routing[r].host` / `.hostname` for
 * EVERY rule with no redirect exclusion — and assigning `undefined` creates an own
 * property valued `undefined`. That write lands on `_routingCloned`, cached on
 * envConf for the process lifetime, so every later no-arg `getConfig()` ->
 * `JSON.clone(local.options.conf)` hit `source[key] === undefined` and emitted the
 * clone's "should not be left `undefined`. Assigning to `null`" warn — once per
 * redirect rule per clone, permanently.
 *
 * Suites:
 *  01 — core/config.js source: the redirect exclusion that leaves the keys absent
 *  02 — core/controller/controller.js source: both copies are existence-guarded
 *  03 — behavioral: the copy-loop shape against the REAL JSON.clone, with a
 *       subtract proving the guard is load-bearing
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var CONFIG_PATH     = path.join(FW, 'core/config.js');
var CONTROLLER_PATH = path.join(FW, 'core/controller/controller.js');

var CONFIG_SRC     = fs.readFileSync(CONFIG_PATH, 'utf8');
var CONTROLLER_SRC = fs.readFileSync(CONTROLLER_PATH, 'utf8');

/** Count non-overlapping occurrences of a literal needle. */
function countOf(src, needle) {
    var n = 0, i = src.indexOf(needle);
    while (i > -1) { ++n; i = src.indexOf(needle, i + needle.length); }
    return n;
}

// ─── 01 — the upstream exclusion this guard exists for ───────────────────────

describe('01 - #B423 config.js: redirect rules are excluded from host/hostname defaulting', function() {

    it('the defaulting gate excludes control === "redirect" (so the keys stay ABSENT)', function() {
        assert.ok(
            countOf(CONFIG_SRC, "!/^redirect$/.test(routing[rule].param.control)") >= 1,
            'the host/hostname defaulting must remain redirect-excluded — this is the condition ' +
            'that makes the keys absent, and the reason the copy loop needs a guard'
        );
    });
});

// ─── 02 — the guard itself ───────────────────────────────────────────────────

describe('02 - #B423 controller.js: the routing host/hostname copy is existence-guarded', function() {

    it('both copies are guarded on the SOURCE being defined', function() {
        assert.equal(
            countOf(CONTROLLER_SRC, "if ( typeof(ctx.config.envConf.routing[r].host) != 'undefined' ) {"), 1,
            'the host copy must be existence-guarded');
        assert.equal(
            countOf(CONTROLLER_SRC, "if ( typeof(ctx.config.envConf.routing[r].hostname) != 'undefined' ) {"), 1,
            'the hostname copy must be existence-guarded');
    });

    it('no UNGUARDED bare copy of either key survives', function() {
        // the bare statements the fix replaced, at their original indentation
        assert.equal(
            countOf(CONTROLLER_SRC, "\n                    local.options.conf.routing[r].host = ctx.config.envConf.routing[r].host;"), 0,
            'the unguarded host copy must be gone');
        assert.equal(
            countOf(CONTROLLER_SRC, "\n                    local.options.conf.routing[r].hostname = ctx.config.envConf.routing[r].hostname;"), 0,
            'the unguarded hostname copy must be gone');
    });

    it('each guarded copy sits INSIDE its guard (the assignment follows the test)', function() {
        var hostGuard = CONTROLLER_SRC.indexOf("if ( typeof(ctx.config.envConf.routing[r].host) != 'undefined' ) {");
        var hostCopy  = CONTROLLER_SRC.indexOf('local.options.conf.routing[r].host = ctx.config.envConf.routing[r].host;', hostGuard);
        assert.ok(hostGuard > -1 && hostCopy > hostGuard && (hostCopy - hostGuard) < 200,
            'the host assignment must directly follow its guard');
    });
});

// ─── 03 — behavioral: the real clone, with a subtract ────────────────────────

describe('03 - #B423 behavioral: an absent key stays absent through the copy + clone', function() {

    require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));   // JSON.clone

    /**
     * The envConf routing shape the loop reads: a normal rule carrying host +
     * hostname, and a `redirect` rule carrying NEITHER (the config.js exclusion).
     */
    function mkEnvConfRouting() {
        return {
            'home@b': {
                url: '/', method: 'GET',
                param: { control: 'home' },
                host: 'localhost', hostname: 'http://localhost:3100'
            },
            'old-path@b': {                       // redirect: host/hostname ABSENT
                url: '/old-path', method: 'GET',
                param: { control: 'redirect', path: '/', code: 301 }
            }
        };
    }

    /** The SHIPPED copy-loop shape (guarded). */
    function copyGuarded(target, source) {
        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; ++i) {
            var r = keys[i];
            if ( typeof(source[r].host) != 'undefined' ) {
                target[r].host = source[r].host;
            }
            if ( typeof(source[r].hostname) != 'undefined' ) {
                target[r].hostname = source[r].hostname;
            }
        }
    }

    /** The PRE-FIX shape — the subtract control. */
    function copyUnguarded(target, source) {
        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; ++i) {
            var r = keys[i];
            target[r].host = source[r].host;
            target[r].hostname = source[r].hostname;
        }
    }

    /** Clone with the real JSON.clone, capturing the warns it emits. */
    function cloneCapturingWarns(obj) {
        var warns = [];
        var orig = console.warn;
        console.warn = function (m) { warns.push(String(m)); };
        try { JSON.clone(obj); } finally { console.warn = orig; }
        return warns;
    }

    it('guarded copy: the redirect rule keeps host/hostname ABSENT', function() {
        var envConf = mkEnvConfRouting();
        var cloned  = JSON.clone(envConf);          // the _routingCloned equivalent
        copyGuarded(cloned, envConf);

        assert.equal(Object.prototype.hasOwnProperty.call(cloned['old-path@b'], 'host'), false,
            'an absent host must NOT be created by the copy');
        assert.equal(Object.prototype.hasOwnProperty.call(cloned['old-path@b'], 'hostname'), false,
            'an absent hostname must NOT be created by the copy');
        // the defined-value path is untouched
        assert.equal(cloned['home@b'].host, 'localhost');
        assert.equal(cloned['home@b'].hostname, 'http://localhost:3100');
    });

    it('guarded copy: a later clone of the result emits NO undefined-key warn', function() {
        var envConf = mkEnvConfRouting();
        var cloned  = JSON.clone(envConf);
        copyGuarded(cloned, envConf);

        var warns = cloneCapturingWarns({ routing: cloned });
        var hostWarns = warns.filter(function (w) { return w.indexOf('source[host]') > -1; });
        var nameWarns = warns.filter(function (w) { return w.indexOf('source[hostname]') > -1; });
        assert.equal(hostWarns.length, 0, 'no host warn: ' + hostWarns.join(' | '));
        assert.equal(nameWarns.length, 0, 'no hostname warn: ' + nameWarns.join(' | '));
    });

    it('SUBTRACT (pre-fix shape): the unguarded copy creates the keys AND the clone warns', function() {
        var envConf = mkEnvConfRouting();
        var cloned  = JSON.clone(envConf);
        copyUnguarded(cloned, envConf);

        // the defect: own properties valued undefined
        assert.equal(Object.prototype.hasOwnProperty.call(cloned['old-path@b'], 'host'), true,
            'control: the unguarded copy must CREATE the key (else this subtract proves nothing)');
        assert.equal(cloned['old-path@b'].host, undefined);

        var warns = cloneCapturingWarns({ routing: cloned });
        var hostWarns = warns.filter(function (w) { return w.indexOf('source[host]') > -1; });
        var nameWarns = warns.filter(function (w) { return w.indexOf('source[hostname]') > -1; });
        assert.equal(hostWarns.length, 1, 'control must fire exactly one host warn');
        assert.equal(nameWarns.length, 1, 'control must fire exactly one hostname warn');
    });

    it('the warn counts are per-redirect-rule (equal per key — the reported fingerprint)', function() {
        var envConf = mkEnvConfRouting();
        envConf['other-old@b'] = { url: '/o', method: 'GET', param: { control: 'redirect', path: '/', code: 301 } };
        var cloned = JSON.clone(envConf);
        copyUnguarded(cloned, envConf);

        var warns = cloneCapturingWarns({ routing: cloned });
        var hostWarns = warns.filter(function (w) { return w.indexOf('source[host]') > -1; }).length;
        var nameWarns = warns.filter(function (w) { return w.indexOf('source[hostname]') > -1; }).length;
        assert.equal(hostWarns, 2, 'one per redirect rule');
        assert.equal(nameWarns, 2, 'one per redirect rule');
        assert.equal(hostWarns, nameWarns, 'the two keys warn in exactly equal counts');
    });
});
