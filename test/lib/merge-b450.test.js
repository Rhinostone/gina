/**
 * #B450 — merge() throws on a source object carrying an own `constructor` key
 * whose value has no usable `.prototype`.
 *
 * Mechanism: isObject()'s "added test for node > v6" hoisted `hasMethodPrototyped`
 * OUT of the original short-circuit (jQuery's isPlainObject computes it only when
 * the object has NO own `constructor`), so it is evaluated EAGERLY on every input.
 * An own `constructor` key shadows `Object.prototype.constructor`; when its value
 * is a primitive / null / plain object / array, `obj.constructor.prototype` is
 * undefined (or the read itself throws for null), and
 * `hasOwn.call(undefined, 'isPrototypeOf')` throws
 * `TypeError: Cannot convert undefined or null to object`.
 *
 * Reachable from the request path: core/server.js merges JSON.parse output of a
 * PUT body as the merge SOURCE, so `{"job":{"constructor":"A"}}` in a body was an
 * unauthenticated request-triggered throw. PRE-EXISTING — measured identical on
 * shipped v0.6.21, before the #B446 guard existed (the guard drops `constructor`
 * as a key at copy time, but isObject() crashes on the VALUE HOLDER first).
 *
 * The crash family is FIVE shapes wide (measured): string, null, plain object,
 * array, number/boolean — anything whose `.prototype` is not a usable object.
 *
 * Fix shape: restore the lazy short-circuit (compute `hasMethodPrototyped` only
 * when `!hasOwnConstructor`) and guard the `.prototype` read. A 24-shape
 * differential sweep pins that the fixed predicate answers IDENTICALLY on every
 * input the old one did not crash on (entities, class instances, null-proto,
 * Date/RegExp/Error/function, JSON `__proto__` shapes) — the recurse-vs-graft
 * routing the whole call surface depends on is unchanged.
 *
 * RED-FIRST: arms 01-06 fail on the pre-fix isObject (TypeError), while the
 * controls 07-12 stay green on both revisions.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path   = require('path');
const fs     = require('fs');
const util   = require('util');
const { EventEmitter } = require('events');

const FW      = path.join(__dirname, '..', '..', 'framework');
const version = fs.readdirSync(FW).filter(d => /^v/.test(d))[0];
const merge   = require(path.join(FW, version, 'lib', 'merge', 'src', 'main.js'));

describe('#B450 — shadowed-constructor source values must not crash merge', function () {

    // The five measured crash shapes. Each carries a sibling key so the arm also
    // pins that only the guarded name is dropped (#B446 disclosed behaviour),
    // never the whole subtree.
    const CRASH_SHAPES = {
        '01 — string':  '{"job":{"constructor":"A","keep":1}}',
        '02 — null':    '{"job":{"constructor":null,"keep":1}}',
        '03 — object':  '{"job":{"constructor":{},"keep":1}}',
        '04 — array':   '{"job":{"constructor":[1],"keep":1}}',
        '05 — number':  '{"job":{"constructor":7,"keep":1}}',
    };

    for (const [label, json] of Object.entries(CRASH_SHAPES)) {
        it(label + ' shadowed constructor merges without throwing, sibling keys survive', function () {
            const out = merge({}, JSON.parse(json));
            assert.deepStrictEqual(out, { job: { keep: 1 } },
                'the guarded key is dropped, the sibling survives, nothing throws');
        });
    }

    it('06 — boolean-valued shadowed constructor (same family)', function () {
        const out = merge({}, JSON.parse('{"job":{"constructor":false,"keep":1}}'));
        assert.deepStrictEqual(out, { job: { keep: 1 } });
    });

    it('07 — CONTROL: top-level shadowed constructor never crashed (guard drops it first)', function () {
        assert.deepStrictEqual(merge({}, JSON.parse('{"constructor":"A"}')), {});
    });

    it('08 — CONTROL: benign nested merge unchanged', function () {
        assert.deepStrictEqual(
            merge({}, JSON.parse('{"job":{"name":"A","keep":1}}')),
            { job: { name: 'A', keep: 1 } });
    });

    it('09 — CONTROL: the fix does not weaken the #B446 guard', function () {
        try {
            merge({}, JSON.parse('{"__proto__":{"pollutedByB450":"OWNED"}}'));
            assert.strictEqual({}.pollutedByB450, undefined);
            merge({}, JSON.parse('{"job":{"constructor":{"prototype":{"pollutedByB450":"OWNED"}}}}'));
            assert.strictEqual({}.pollutedByB450, undefined);
        } finally {
            delete Object.prototype.pollutedByB450;
        }
    });

    it('10 — CONTROL: entity prototype methods still survive (the #B446-follow-up contract)', function () {
        function Entity() { this.name = 'demo'; }
        util.inherits(Entity, EventEmitter);
        Entity.prototype.getOneById = function () { return 'proto'; };
        const m = merge({}, new Entity());
        assert.strictEqual(typeof m.getOneById, 'function');
        assert.strictEqual(m.name, 'demo');
    });

    it('11 — CONTROL: recurse-vs-graft routing unchanged — a class-instance VALUE is grafted by reference', function () {
        class Svc { constructor() { this.tag = 'live'; } }
        const inst = new Svc();
        const t = {};
        merge(t, { svc: inst });
        assert.strictEqual(t.svc, inst, 'instance values must alias, never be recursed into');
    });

    it('12 — CONTROL: recurse-vs-graft routing unchanged — a plain-object VALUE is copied, not aliased', function () {
        const src = { job: { name: 'A' } };
        const t = {};
        merge(t, src);
        assert.notStrictEqual(t.job, src.job, 'plain-object values take the createMode fresh-clone path');
        assert.deepStrictEqual(t.job, { name: 'A' });
    });
});
