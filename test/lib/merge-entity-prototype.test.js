/**
 * #B446 follow-up — merge must preserve PROTOTYPE-attached source methods.
 *
 * Regression guard for a defect introduced by the first cut of #B446 and caught by a
 * consumer before release. That cut skipped inherited enumerable source properties as
 * extra hardening. It broke every entity in the model registry:
 *
 *   - lib/model.js setModel round-trips entity instances through merge():
 *         self.models[bundle][name] = merge(self.models[bundle][name], obj)
 *   - all six SQL connectors attach their `.sql`-derived query methods to the
 *     PROTOTYPE:  entities[entityName].prototype[name] = function () { ... }
 *     (couchbase, postgresql, duckdb, mongodb, scylladb, mysql)
 *
 * So an own-only copy silently dropped every query method, and any call of the form
 * `db.<x>Entity.<queryMethod>()` threw `... is not a function` at runtime — while a
 * constructor-assigned (`this.x = function`) method on the same object survived, which
 * is what made the breakage look partial and hard to attribute.
 *
 * The pollution defence does NOT depend on the own-property check: an own `__proto__`
 * (the shape JSON.parse yields) passes an own-property check by construction, so only
 * the key-name rejection ever stopped it. That is pinned in
 * prototype-pollution-b446.test.js; this file pins the contract it must not cost.
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

/** Build an entity shaped exactly as a connector leaves it. */
function makeEntity() {
    function Entity() {
        this.name          = 'demo';
        this.constructorFn = function () { return 'own'; };   // survives even own-only
    }
    util.inherits(Entity, EventEmitter);                       // connectors inherit EE
    // connector shape: entities[entityName].prototype[name] = function () {...}
    Entity.prototype.getOneById = function () { return 'proto'; };
    Entity.prototype.getAll     = function () { return 'proto'; };
    return new Entity();
}

describe('#B446 follow-up — merge preserves prototype-attached entity methods', function () {

    it('01 — a connector-shaped entity keeps its query methods through merge()', function () {
        const merged = merge({}, makeEntity());

        assert.strictEqual(typeof merged.getOneById, 'function',
            'prototype-attached query method must survive merge (lib/model.js setModel)');
        assert.strictEqual(typeof merged.getAll, 'function');
        assert.strictEqual(merged.getOneById(), 'proto');
    });

    it('02 — DISCRIMINATOR: own methods survived even when inherited ones did not', function () {
        // Pins the asymmetry that made the original breakage partial. If a future change
        // reintroduces own-only copying, 01 goes red while this arm stays green — which is
        // the signature to look for.
        const merged = merge({}, makeEntity());
        assert.strictEqual(typeof merged.constructorFn, 'function');
        assert.strictEqual(merged.name, 'demo');
    });

    it('03 — the same holds in override mode', function () {
        const merged = merge({}, makeEntity(), true);
        assert.strictEqual(typeof merged.getOneById, 'function');
    });

    it('04 — merging onto a populated target keeps both sides', function () {
        const merged = merge({ existing: 1 }, makeEntity());
        assert.strictEqual(merged.existing, 1);
        assert.strictEqual(typeof merged.getOneById, 'function');
    });

    it('05 — CONTROL: preserving the chain does not reopen #B446', function () {
        // The guard that actually stops pollution is the key-name rejection, which is
        // independent of how the chain is walked. Proven here so this file cannot be
        // read as a licence to drop it.
        try {
            merge({}, JSON.parse('{"__proto__":{"pollutedByEntityTest":"OWNED"}}'));
            assert.strictEqual({}.pollutedByEntityTest, undefined);
        } finally {
            delete Object.prototype.pollutedByEntityTest;
        }
    });
});
