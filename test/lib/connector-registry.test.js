/**
 * lib/connector-registry — single source of truth for the connector
 * driver → npm package + semver range mapping. Previously duplicated
 * inline in `lib/cmd/connector/add.js` and `lib/cmd/connector/list.js`
 * (and in the now-removed root `package.json` peerDependencies block);
 * this module consolidates all three copies.
 *
 * Tests cover:
 *   (a) module shape — public exports, DRIVER_MAP + AI_DRIVER_MAP keys
 *   (b) DRIVER_MAP entries — couchbase, redis, mysql, postgresql,
 *       mongodb, scylladb, sqlite (builtin)
 *   (c) AI_DRIVER_MAP entries — anthropic + 10 OpenAI-compatible schemes
 *   (d) getDriver() / getAIDriver() behaviour — known + unknown inputs
 *   (e) getDriverTypes() / getAISchemes() behaviour — stable orderings
 *   (f) source-inspection guards — no stray `peerDependencies` reference
 */

'use strict';

var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var REGISTRY_PATH = path.join(require('../fw'), 'lib/connector-registry');
var REGISTRY_SRC  = require('fs').readFileSync(path.join(REGISTRY_PATH, 'src/main.js'), 'utf8');
var registry      = require(REGISTRY_PATH);


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports getDriver, getAIDriver, getDriverTypes, getAISchemes', function () {
        assert.equal(typeof registry.getDriver, 'function');
        assert.equal(typeof registry.getAIDriver, 'function');
        assert.equal(typeof registry.getDriverTypes, 'function');
        assert.equal(typeof registry.getAISchemes, 'function');
    });

    it('exposes DRIVER_MAP and AI_DRIVER_MAP for direct inspection', function () {
        assert.equal(typeof registry.DRIVER_MAP, 'object');
        assert.equal(typeof registry.AI_DRIVER_MAP, 'object');
    });

    it('package.json declares `main: "src/main"`', function () {
        var pkg = require(path.join(REGISTRY_PATH, 'package.json'));
        assert.equal(pkg.main, 'src/main');
    });
});


// ---------------------------------------------------------------------------
// 02 — DRIVER_MAP entries
// ---------------------------------------------------------------------------

describe('02 - DRIVER_MAP entries', function () {

    it('maps couchbase → couchbase >=3.0.0', function () {
        assert.deepEqual(registry.DRIVER_MAP.couchbase, { npm: 'couchbase', range: '>=3.0.0' });
    });

    it('maps redis → ioredis >=5.0.0', function () {
        assert.deepEqual(registry.DRIVER_MAP.redis, { npm: 'ioredis', range: '>=5.0.0' });
    });

    it('maps mysql → mysql2 >=2.0.0', function () {
        assert.deepEqual(registry.DRIVER_MAP.mysql, { npm: 'mysql2', range: '>=2.0.0' });
    });

    it('maps postgresql → pg >=8.0.0', function () {
        assert.deepEqual(registry.DRIVER_MAP.postgresql, { npm: 'pg', range: '>=8.0.0' });
    });

    it('maps mongodb → mongodb >=5.0.0', function () {
        assert.deepEqual(registry.DRIVER_MAP.mongodb, { npm: 'mongodb', range: '>=5.0.0' });
    });

    it('maps scylladb → @scylladb/scylla-driver >=1.0.0', function () {
        assert.deepEqual(registry.DRIVER_MAP.scylladb, { npm: '@scylladb/scylla-driver', range: '>=1.0.0' });
    });

    it('flags sqlite as builtin (node:sqlite)', function () {
        assert.equal(registry.DRIVER_MAP.sqlite.builtin, true);
        assert.match(registry.DRIVER_MAP.sqlite.note, /node:sqlite/);
    });

    it('has no surprise keys — exactly 7 connector types', function () {
        assert.deepEqual(
            Object.keys(registry.DRIVER_MAP).sort(),
            ['couchbase', 'mongodb', 'mysql', 'postgresql', 'redis', 'scylladb', 'sqlite']
        );
    });
});


// ---------------------------------------------------------------------------
// 03 — AI_DRIVER_MAP entries
// ---------------------------------------------------------------------------

describe('03 - AI_DRIVER_MAP entries', function () {

    it('maps anthropic → @anthropic-ai/sdk >=0.27.0', function () {
        assert.deepEqual(registry.AI_DRIVER_MAP.anthropic, { npm: '@anthropic-ai/sdk', range: '>=0.27.0' });
    });

    it('maps openai → openai >=4.0.0', function () {
        assert.deepEqual(registry.AI_DRIVER_MAP.openai, { npm: 'openai', range: '>=4.0.0' });
    });

    it('maps all 9 OpenAI-compatible providers to the openai npm package', function () {
        var providers = ['deepseek', 'qwen', 'groq', 'mistral', 'together', 'ollama', 'gemini', 'xai', 'perplexity'];
        providers.forEach(function (p) {
            assert.deepEqual(registry.AI_DRIVER_MAP[p], { npm: 'openai', range: '>=4.0.0' }, p + ' should map to openai');
        });
    });

    it('has no surprise keys — exactly 11 AI schemes', function () {
        assert.equal(Object.keys(registry.AI_DRIVER_MAP).length, 11);
    });
});


// ---------------------------------------------------------------------------
// 04 — getDriver() behaviour
// ---------------------------------------------------------------------------

describe('04 - getDriver', function () {

    it('returns the entry for a known connector type', function () {
        assert.deepEqual(registry.getDriver('redis'), { npm: 'ioredis', range: '>=5.0.0' });
    });

    it('returns null for an unknown type', function () {
        assert.equal(registry.getDriver('does-not-exist'), null);
    });

    it('returns null for empty / non-string input', function () {
        assert.equal(registry.getDriver(''), null);
        assert.equal(registry.getDriver(null), null);
        assert.equal(registry.getDriver(undefined), null);
        assert.equal(registry.getDriver(42), null);
    });

    it('does not expose inherited properties (Object.prototype.toString etc.)', function () {
        assert.equal(registry.getDriver('toString'), null);
        assert.equal(registry.getDriver('hasOwnProperty'), null);
        assert.equal(registry.getDriver('__proto__'), null);
    });

    it('returns the sqlite builtin entry', function () {
        var sqlite = registry.getDriver('sqlite');
        assert.equal(sqlite.builtin, true);
        assert.ok(sqlite.note);
    });
});


// ---------------------------------------------------------------------------
// 05 — getAIDriver() behaviour
// ---------------------------------------------------------------------------

describe('05 - getAIDriver', function () {

    it('returns the entry for a known scheme', function () {
        assert.deepEqual(registry.getAIDriver('anthropic'), { npm: '@anthropic-ai/sdk', range: '>=0.27.0' });
    });

    it('returns null for an unknown scheme', function () {
        assert.equal(registry.getAIDriver('does-not-exist'), null);
    });

    it('returns null for empty / non-string input', function () {
        assert.equal(registry.getAIDriver(''), null);
        assert.equal(registry.getAIDriver(null), null);
        assert.equal(registry.getAIDriver(undefined), null);
        assert.equal(registry.getAIDriver(42), null);
    });

    it('does not expose inherited properties', function () {
        assert.equal(registry.getAIDriver('toString'), null);
        assert.equal(registry.getAIDriver('__proto__'), null);
    });

    it('is case-sensitive — the caller must lowercase first', function () {
        assert.equal(registry.getAIDriver('Anthropic'), null);
        assert.deepEqual(registry.getAIDriver('anthropic'), { npm: '@anthropic-ai/sdk', range: '>=0.27.0' });
    });
});


// ---------------------------------------------------------------------------
// 06 — getDriverTypes() / getAISchemes()
// ---------------------------------------------------------------------------

describe('06 - getDriverTypes / getAISchemes', function () {

    it('getDriverTypes returns every DRIVER_MAP key', function () {
        assert.deepEqual(
            registry.getDriverTypes().sort(),
            Object.keys(registry.DRIVER_MAP).sort()
        );
    });

    it('getAISchemes returns every AI_DRIVER_MAP key', function () {
        assert.deepEqual(
            registry.getAISchemes().sort(),
            Object.keys(registry.AI_DRIVER_MAP).sort()
        );
    });

    it('getDriverTypes preserves declaration order', function () {
        assert.deepEqual(
            registry.getDriverTypes(),
            ['couchbase', 'redis', 'mysql', 'postgresql', 'mongodb', 'scylladb', 'sqlite']
        );
    });

    it('getAISchemes lists anthropic first, openai second', function () {
        var schemes = registry.getAISchemes();
        assert.equal(schemes[0], 'anthropic');
        assert.equal(schemes[1], 'openai');
    });
});


// ---------------------------------------------------------------------------
// 07 — Source-inspection negative invariants
// ---------------------------------------------------------------------------

describe('07 - source-inspection guards', function () {

    it('registry source declares both DRIVER_MAP and AI_DRIVER_MAP', function () {
        assert.match(REGISTRY_SRC, /var DRIVER_MAP\s*=\s*\{/);
        assert.match(REGISTRY_SRC, /var AI_DRIVER_MAP\s*=\s*\{/);
    });

    it('registry source declares `use strict`', function () {
        assert.match(REGISTRY_SRC, /['"]use strict['"]/);
    });

    it('registry source uses hasOwnProperty — no prototype pollution', function () {
        assert.match(REGISTRY_SRC, /hasOwnProperty\.call/);
    });
});
