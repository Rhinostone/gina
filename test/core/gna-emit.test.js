'use strict';

/**
 * #B109 — the module-level `gina.emit` is an inert stub.
 *
 * History: the assignment was a DETACHED copy of the internal lifecycle
 * emitter's method (`gna.emit = e.emit`) — `this` at call time was the plain
 * module object (no `_events`), so it dispatched nothing and returned false
 * for every name EXCEPT 'error', where Node's unhandled-'error' path THREW
 * the argument (or ERR_UNHANDLED_ERROR without one). The stub converges the
 * runtime with the published types contract (types/index.d.ts: always
 * `false`, never dispatches, never throws). The module object is a plain
 * literal with no `on`/`once`, so it is not an event surface — application
 * events go through `self.emitEvent()` (#EVTBUS).
 *
 * Test shape — extracted-source execution, not a module load: `core/gna.js`
 * is the bundle bootstrap and cannot be module-loaded in isolation (its
 * top-level flow needs a bundle context — GINA_HOMEDIR state files plus a
 * projectName parsed from the ctx argv; the framework-unit gna-exports test
 * deliberately STUBS it for exactly this reason). Instead the behavioral
 * section extracts the ACTIVE `gna.emit = <RHS>` assignment from the source
 * at run time and executes those exact shipped bytes — a replica cannot
 * drift because there is no replica. Reachability of the assignment is
 * structural: it sits at unconditional top-level module scope (pinned
 * below); top-level code runs iff the module loads at all, which every real
 * boot covers.
 *
 * Run with:
 *   node --test test/core/gna-emit.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW      = require('../fw');
var GNA_SRC = fs.readFileSync(path.join(FW, 'core', 'gna.js'), 'utf8');

// Active code only: the replace-code convention keeps the old assignment as
// a comment above the stub, so whole-source pins would trip on their own
// comment (jsdoc.md negative-pin trap).
var ACTIVE = GNA_SRC.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');

describe('#B109 gina.emit — source pins', function () {

    it('the detached-copy assignment is gone from active code', function () {
        assert.doesNotMatch(ACTIVE, /gna\.emit\s*=\s*e\.emit/);
    });

    it('the inert stub is the active assignment, at top-level column 0 (unconditional module scope)', function () {
        assert.match(GNA_SRC, /^gna\.emit\s*=\s*function \(\) \{ return false; \};/m);
    });
});

describe('#B109 gina.emit — behavioral (executes the extracted shipped bytes)', function () {

    // Extract the active assignment's right-hand side and execute it. The
    // extraction MUST fire (an instrument that cannot fail is not a control):
    // exactly one active `gna.emit = function …;` assignment.
    var matches = ACTIVE.match(/^gna\.emit\s*=\s*(function[^\n]*\{[^\n]*\});\s*$/mg);

    it('extraction fires on exactly one active single-line stub assignment', function () {
        assert.ok(matches, 'no active `gna.emit = function …;` assignment found');
        assert.equal(matches.length, 1, 'expected exactly one active emit assignment');
    });

    var emit = null;
    if (matches && matches.length === 1) {
        var rhs = matches[0].replace(/^gna\.emit\s*=\s*/, '').replace(/;\s*$/, '');
        emit = new Function('return (' + rhs + ');')();
    }

    it('a custom event name returns false', function () {
        assert.equal(emit('myAppEvent'), false);
        assert.equal(emit('myAppEvent', { any: 'payload' }), false);
    });

    it("emit('error', err) returns false and does NOT throw (pre-#B109: threw the argument)", function () {
        var r;
        assert.doesNotThrow(function () {
            r = emit('error', new Error('boom'));
        });
        assert.equal(r, false);
    });

    it("emit('error') without an argument returns false (pre-#B109: ERR_UNHANDLED_ERROR)", function () {
        var r;
        assert.doesNotThrow(function () {
            r = emit('error');
        });
        assert.equal(r, false);
    });

    it('framework lifecycle names are inert (nothing can reach the internal emitter)', function () {
        ['init', 'server#started', 'route', 'complete'].forEach(function (name) {
            assert.equal(emit(name, {}), false, name + ' must be inert');
        });
    });

    it('detached invocation (plain-object this) is equally inert — the runtime call shape', function () {
        var carrier = { emit: emit };
        assert.equal(carrier.emit('error', new Error('x')), false);
    });
});
