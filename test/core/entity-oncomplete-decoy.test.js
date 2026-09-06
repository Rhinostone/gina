'use strict';
/**
 * #B491 (d) — the dead `entity[f].onComplete = function (cb) {}` decoy.
 *
 * `buildEntity` attached an empty `onComplete` to every entity METHOD object,
 * commented « just for display purpose: will be overriden by the previous code ».
 * That comment was false. The « previous code » attaches `.onComplete(cb)` to the
 * per-call `_promise` that the method RETURNS, never to the method function
 * itself, so nothing ever overrode the empty one — it simply sat there swallowing
 * any callback registered on it, silently and forever.
 *
 * It is a leftover of the pre-Option-B design, which the surviving rationale
 * comment states outright: JS entity methods « previously returned `this[m]` (the
 * entity function, with .onComplete attached as a property) ». Since the
 * 2026-03-20 switch to returning a native Promise, the documented form is
 * `entity.method(args).onComplete(cb)` — the promise's own handle.
 *
 * Reader census (core/, lib/, helpers/): the only occurrence of `.onComplete` on
 * an entity method object was that assignment. With it gone, a caller using the
 * wrong form gets Node's own « is not a function » at the call site instead of a
 * callback that never fires.
 *
 * Source pins only — building a live entity needs a model/connector bootstrap,
 * and the defect is entirely structural.
 */

var assert   = require('node:assert');
var fs       = require('node:fs');
var path     = require('node:path');
var describe = require('node:test').describe;
var it       = require('node:test').it;

var FW  = require('../fw');
var SRC = fs.readFileSync(path.join(FW, 'core/model/entity.js'), 'utf8');

describe('01 - #B491 (d) the decoy onComplete is gone from entity.js', function() {

    it('no empty onComplete is attached to the entity method object', function() {
        assert.ok(
            SRC.indexOf('entity[f].onComplete') === -1,
            '#B491 (d): `entity[f].onComplete = function (cb) {}` swallowed every callback registered on it — the per-call handle on the returned promise is the real one'
        );
    });

    it('its false "will be overriden by the previous code" comment is gone with it', function() {
        assert.ok(
            SRC.indexOf('will be overriden by the previous code') === -1,
            '#B491 (d): nothing overrode it — the previous code attaches onComplete to _promise, not to the method'
        );
    });

    it('control — the real per-call handle survives, still chaining on the returned promise', function() {
        assert.match(
            SRC,
            /_promise\.onComplete\s*=\s*function\(cb\)\s*\{\s*_promise\.then\(/,
            'the promise-side onComplete is the supported form and must stay'
        );
        assert.match(SRC, /return _promise;\s*\/\/ preserve chaining/, 'and it must keep returning the promise');
    });

    it('control — the Option B rationale naming the old this[m] form is still on file', function() {
        assert.match(SRC, /previously returned `this\[m\]`/, 'the comment that explains WHY the decoy is dead (control)');
    });
});
