/**
 * lib/connector-config — pure connector-entry resolver shared by the
 * connector:* runtime CLI commands (connector:infer). Merges a project's
 * shared + bundle connectors.json maps (bundle wins), selects an entry by
 * name, and detects the AI subtype.
 *
 * The module is pure (no node builtins, no lib.*, no framework globals), so it
 * is exercised here BEHAVIOURALLY via a direct require — same style as
 * connector-registry.test.js — plus a few source pins locking the purity +
 * export contract.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var MODULE_DIR  = path.join(require('../fw'), 'lib/connector-config');
var MAIN_SOURCE = path.join(MODULE_DIR, 'src/main.js');
var cfg = require(MODULE_DIR);
var src = fs.readFileSync(MAIN_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — module shape + purity
// ---------------------------------------------------------------------------

describe('01 - module shape + purity', function () {

    it('exports resolve + isAIConnector', function () {
        assert.equal(typeof cfg.resolve, 'function');
        assert.equal(typeof cfg.isAIConnector, 'function');
    });

    it('is pure — requires nothing (no node builtins, no lib.*, no globals)', function () {
        assert.doesNotMatch(src, /require\(/, 'connector-config must not require anything');
    });

    it('package.json main points at src/main', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'package.json'), 'utf8'));
        assert.equal(pkg.main, 'src/main');
        assert.equal(pkg.name, 'gina-lib-connector-config');
    });
});


// ---------------------------------------------------------------------------
// 02 — resolve(): selection + source
// ---------------------------------------------------------------------------

describe('02 - resolve selection + source', function () {

    it('returns the shared entry when no bundle declares it', function () {
        var r = cfg.resolve({ claude: { connector: 'ai', model: 's' } }, {}, 'claude');
        assert.deepEqual(r, { entry: { connector: 'ai', model: 's' }, source: 'shared' });
    });

    it('returns the bundle entry when shared lacks it', function () {
        var r = cfg.resolve({}, { claude: { connector: 'ai', model: 'b' } }, 'claude');
        assert.deepEqual(r, { entry: { connector: 'ai', model: 'b' }, source: 'bundle' });
    });

    it('merges shared + bundle with bundle winning (source: merged)', function () {
        var r = cfg.resolve(
            { claude: { connector: 'ai', model: 's', protocol: 'anthropic://' } },
            { claude: { model: 'b' } },
            'claude'
        );
        assert.deepEqual(r, { entry: { connector: 'ai', model: 'b', protocol: 'anthropic://' }, source: 'merged' });
    });

    it('returns { entry: null, source: null } when declared nowhere', function () {
        assert.deepEqual(cfg.resolve({ other: {} }, { another: {} }, 'claude'), { entry: null, source: null });
    });

    it('never selects the $schema meta-key', function () {
        assert.deepEqual(cfg.resolve({ '$schema': 'https://gina.io/schema/connectors.json' }, {}, '$schema'), { entry: null, source: null });
    });

    it('treats null / non-object map args as empty', function () {
        assert.deepEqual(cfg.resolve(null, null, 'x'), { entry: null, source: null });
        assert.deepEqual(cfg.resolve({ x: { connector: 'ai' } }, null, 'x').source, 'shared');
    });
});


// ---------------------------------------------------------------------------
// 03 — resolve(): fresh object (no aliasing the input JSON)
// ---------------------------------------------------------------------------

describe('03 - fresh object', function () {

    it('shared entry is a fresh copy (mutating it does not touch the source)', function () {
        var shared = { claude: { connector: 'ai' } };
        var e = cfg.resolve(shared, {}, 'claude').entry;
        e.model = 'mutated';
        assert.equal(shared.claude.model, undefined);
    });

    it('merged entry is a fresh copy of neither side', function () {
        var shared = { claude: { connector: 'ai', a: 1 } };
        var bundle = { claude: { b: 2 } };
        var e = cfg.resolve(shared, bundle, 'claude').entry;
        e.a = 99;
        assert.equal(shared.claude.a, 1, 'must not mutate the shared source');
        assert.equal(bundle.claude.b, 2, 'must not mutate the bundle source');
    });
});


// ---------------------------------------------------------------------------
// 04 — isAIConnector()
// ---------------------------------------------------------------------------

describe('04 - isAIConnector', function () {

    it('true for connector:ai', function () {
        assert.equal(cfg.isAIConnector({ connector: 'ai', protocol: 'ollama://' }), true);
    });

    it('false for a non-ai connector type', function () {
        assert.equal(cfg.isAIConnector({ connector: 'mysql' }), false);
    });

    it('false for an entry with no connector field', function () {
        assert.equal(cfg.isAIConnector({ host: '127.0.0.1' }), false);
    });

    it('false for null / array / non-object', function () {
        assert.equal(cfg.isAIConnector(null), false);
        assert.equal(cfg.isAIConnector(['ai']), false);
        assert.equal(cfg.isAIConnector('ai'), false);
    });
});
