'use strict';
/**
 * #B131 — the SERVER-side `throwError` (core/server.js, attached to the engine
 * instance at `instance.throwError`) serialized stack-bearing `msg` values
 * verbatim to HTTP clients on EVERY scope: its feeders (router.js action and
 * middleware catches, server.js internals) pass `err.stack` pre-flattened as
 * the message STRING, so non-local deployments shipped absolute framework
 * paths + frames in 500 bodies — the JSON XHR/API branches, the inline HTML
 * fallback, and the custom-error-page data all emitted it. The CONTROLLER-side
 * `this.throwError` has had a fail-closed scope gate since 2026-05-16; this
 * locks the server-side twin plus its two same-class siblings (render-json's
 * HTTP/1.1 reason-phrase catch, isaac's cache-file stream error — the isaac
 * pin lives in error-message-annihilation.test.js §03).
 *
 * Live-verified 2026-07-19 on an isolated production-scope boot: pre-fix the
 * 500 body carried the full stack; post-fix the body is the message line only
 * and the full stack lands in the server log; a local-scope boot is
 * byte-identical to pre-fix (the dev toolbar reads the stack off the wire).
 *
 * §01 — source pins: the gate exists inside throwError, both call points
 *       (top-of-function + the 1-arg errorObject reshape), gate-before-
 *       normalization ordering, the self.isLocalScope() scope read, and the
 *       untouched wire-emit shape (the sanitize is upstream of the emits).
 * §02 — behavioral: the EXTRACTED shipped helper (real bytes, no replica)
 *       drives both msg shapes × local/non-local, the frame detector against
 *       a REAL V8 stack, non-mutation of the caller's object, and that the
 *       helper is log-free (#ERRREF moved the full-text capture to the
 *       ref-paired line at throwError entry, EVERY scope — behavioral
 *       coverage of that guarantee lives in test/core/error-ref.test.js).
 * §03 — sibling pins: render-json's reason-phrase ships err.message, never a
 *       stack (a multi-line reason phrase is invalid HTTP/1.1 anyway).
 * §04 — subtract: the non-local output differs from the pre-fix wire value on
 *       the same input (truncation, not rewrite — the full text contains it).
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

// installs JSON.clone (the helper's object-strip path uses it)
require('../../utils/prototypes');

var SRC    = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var RJ_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.render-json.js'), 'utf8');

// ─── the throwError body slice (declaration → end-of-file anchor) ─────────────
var T_START = SRC.indexOf('var throwError = function(res, code, msg, next)');
var T_END   = SRC.indexOf('Server = inherits(Server, EventEmitter)');
var T       = SRC.substring(T_START, T_END);

// ─── 01 — source pins ─────────────────────────────────────────────────────────
describe('#B131 §01 — the scope gate is wired inside server-side throwError', function () {

    it('slice anchors resolve (extraction control)', function () {
        assert.ok(T_START > -1, 'throwError declaration must exist');
        assert.ok(T_END > T_START, 'end anchor must follow throwError');
    });

    it('the sanitize helper is declared inside throwError', function () {
        assert.ok(T.indexOf('var sanitizeWireError = function(m, c)') > -1);
    });

    it('the gate reads self.isLocalScope() — same env read as the controller gate', function () {
        assert.ok(T.indexOf('self.isLocalScope()') > -1);
    });

    it('exactly two call points: top-of-function + the 1-arg errorObject reshape', function () {
        var calls = T.match(/msg\s+=\s+sanitizeWireError\(msg, code\);/g);
        assert.ok(calls);
        assert.equal(calls.length, 2);
    });

    it('the top call runs BEFORE the err normalization (custom-error eData inherits sanitized values)', function () {
        var callIdx = T.indexOf('msg = sanitizeWireError(msg, code);');
        var normIdx = T.indexOf("if ( typeof(msg) != 'object' )");
        assert.ok(callIdx > -1 && normIdx > -1);
        assert.ok(callIdx < normIdx, 'sanitize must precede the err build');
    });

    it('the second call sits AFTER the 1-arg errorObject reshape assigns msg/code', function () {
        var reshapeIdx = T.indexOf('code    = code.status;');
        assert.ok(reshapeIdx > -1, 'the 1-arg reshape must exist');
        var secondCall = T.indexOf('sanitizeWireError(msg, code);', T.indexOf('sanitizeWireError(msg, code);') + 1);
        assert.ok(secondCall > reshapeIdx, 'the reshaped msg must be sanitized too');
    });

    it('the wire-emit keeps its status/error shape (the #ERRREF ref rides alongside) — the sanitize is upstream of the emits', function () {
        assert.ok(T.indexOf('error: msg') > -1,   'HTTP/2 JSON emit keeps its shape');
        assert.ok(T.indexOf('error   : msg') > -1, 'HTTP/1.1 JSON emit keeps its shape');
    });
});

// ─── 02 — behavioral: execute the EXTRACTED shipped helper ────────────────────
describe('#B131 §02 — the extracted shipped helper (real bytes) behaves', function () {

    // slice: helper declaration → the adjacent top call (unique adjacency)
    var H_START = T.indexOf('var sanitizeWireError = function(m, c)');
    var H_END   = T.indexOf('msg = sanitizeWireError(msg, code);');
    var H_SRC   = T.substring(H_START, H_END);

    it('extraction fires and carries all three branches (instrument control)', function () {
        assert.ok(H_START > -1 && H_END > H_START, 'helper slice anchors');
        assert.ok(H_SRC.indexOf('self.isLocalScope()') > -1,  'local-scope passthrough branch');
        assert.ok(H_SRC.indexOf("split('\\n')[0]") > -1,       'string truncation branch');
        assert.ok(H_SRC.indexOf('delete m.stack') > -1,        'object strip branch');
    });

    function build(isLocal, calls) {
        var self  = { isLocalScope: function () { return isLocal; }, appName: 'fixtureapp' };
        var local = { request: { method: 'GET', url: '/fixture' } };
        var cons  = { error: function () { calls.push(Array.prototype.slice.call(arguments).join(' ')); } };
        /* jshint evil: true */
        var fn = new Function('self', 'local', 'console', 'JSON',
            H_SRC + '\nreturn sanitizeWireError;')(self, local, cons, JSON);
        return fn;
    }

    it('the frame detector matches a REAL V8 stack', function () {
        var e = new Error('b131 real');
        assert.match(e.stack, /\n\s+at\s/, 'V8 frame format is what the gate detects');
    });

    it('LOCAL scope: stack-bearing string passes through untouched, nothing logged', function () {
        var calls = [];
        var fn = build(true, calls);
        var input = new Error('b131 local').stack;
        assert.equal(fn(input, 500), input);
        assert.equal(calls.length, 0);
    });

    it('NON-local: a real stack string truncates to its message line; the helper is log-free (#ERRREF — the pairing line at entry owns the log)', function () {
        var calls = [];
        var fn = build(false, calls);
        var input = new Error('b131 wire').stack;
        var out = fn(input, 500);
        assert.equal(out, 'Error: b131 wire');
        assert.ok(out.indexOf('\n') < 0, 'single line on the wire');
        assert.ok(out.indexOf(' at ') < 0, 'no frames on the wire');
        // #ERRREF — the full-text capture moved to the ref-paired line at
        // throwError entry (fires in EVERY scope, message-only errors
        // included); error-ref.test.js drives that guarantee behaviorally.
        assert.equal(calls.length, 0, 'the helper itself no longer logs');
    });

    it('NON-local: a plain single-line message passes through untouched, not logged', function () {
        var calls = [];
        var fn = build(false, calls);
        assert.equal(fn('Page not found', 404), 'Page not found');
        assert.equal(calls.length, 0);
    });

    it('NON-local: a multi-line message WITHOUT frames passes through (the detector needs a frame)', function () {
        var calls = [];
        var fn = build(false, calls);
        var input = 'Page not found: \n/some/path';
        assert.equal(fn(input, 404), input);
        assert.equal(calls.length, 0);
    });

    it('NON-local: an object msg has .stack stripped off a CLONE — the caller object is untouched', function () {
        var calls = [];
        var fn = build(false, calls);
        var input = { status: 500, error: 'boom', message: 'boom', stack: 'Error: boom\n    at site (/x.js:1:1)' };
        var out = fn(input, 500);
        assert.equal(typeof out.stack, 'undefined', 'no stack on the emitted object');
        assert.equal(out.error, 'boom');
        assert.equal(out.message, 'boom');
        assert.ok(typeof input.stack != 'undefined', 'the caller object keeps its stack (non-mutation)');
        assert.equal(calls.length, 0, 'the helper itself no longer logs (#ERRREF — the pairing line owns it)');
    });

    it('NON-local: an object msg WITHOUT a stack passes through, not logged', function () {
        var calls = [];
        var fn = build(false, calls);
        var input = { status: 422, error: 'invalid', fields: { a: 1 } };
        var out = fn(input, 422);
        assert.equal(out.error, 'invalid');
        assert.equal(calls.length, 0);
    });

    it('LOCAL scope: object msg keeps its stack (dev toolbar contract)', function () {
        var calls = [];
        var fn = build(true, calls);
        var input = { status: 500, error: 'boom', stack: 'Error: boom\n    at x' };
        var out = fn(input, 500);
        assert.equal(out.stack, input.stack);
        assert.equal(calls.length, 0);
    });
});

// ─── 03 — sibling pins: render-json reason phrase ─────────────────────────────
describe('#B131 §03 — render-json reason-phrase catch ships message-only', function () {

    it('the catch assigns err.message with a static fallback', function () {
        assert.ok(RJ_SRC.indexOf("response.statusMessage = err.message || 'Internal Server Error'") > -1);
    });

    it('no reason-phrase assignment carries a stack (globally zero)', function () {
        assert.ok(RJ_SRC.indexOf('response.statusMessage = err.stack') < 0);
    });

    it('the diagnostic moved to the server log', function () {
        assert.ok(RJ_SRC.indexOf('[ RENDER-JSON ] status resolution failed') > -1);
    });
});

// ─── 04 — subtract: the fix discriminates from the pre-fix wire value ─────────
describe('#B131 §04 — subtract: non-local output differs from the pre-fix wire value', function () {

    it('same input, different wire: pre-fix shipped the input verbatim; the gate ships its first line', function () {
        var calls = [];
        var self  = { isLocalScope: function () { return false; }, appName: 'fixtureapp' };
        var local = { request: { method: 'GET', url: '/fixture' } };
        var cons  = { error: function () { calls.push('x'); } };
        var T2      = SRC.substring(SRC.indexOf('var sanitizeWireError = function(m, c)'));
        var H_SRC   = T2.substring(0, T2.indexOf('msg = sanitizeWireError(msg, code);'));
        /* jshint evil: true */
        var fn = new Function('self', 'local', 'console', 'JSON',
            H_SRC + '\nreturn sanitizeWireError;')(self, local, cons, JSON);
        var input = new Error('b131 subtract').stack;   // the pre-fix wire value WAS the input
        var out = fn(input, 500);
        assert.notEqual(out, input, 'the gate changes the wire value — the discriminator');
        assert.ok(input.indexOf(out) === 0, 'truncation, not rewrite: the full text starts with the wire line');
    });
});
