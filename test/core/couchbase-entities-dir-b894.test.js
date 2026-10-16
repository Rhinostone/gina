/**
 * #B894 — the Couchbase factory creates `models/<database>/entities` when it is
 * missing, as the other ORM factories do.
 *
 * The model layer creates `models/<entry key>/entities` for every connectors.json
 * entry, while each ORM factory reads `models/<database>/entities`. For an entry
 * named differently from its bucket (`"couchbase": { "database": "demo", … }`) on
 * a project with no models directory, the MongoDB, MySQL, PostgreSQL, SQLite,
 * ScyllaDB and DuckDB factories create that directory first; the Couchbase
 * factory read it with `fs.readdirSync` and the boot aborted with « ENOENT: no
 * such file or directory, scandir '…/models/demo/entities' » (reproduced on the
 * gina-starter Docker stack, the bundle restarting in a loop).
 *
 * The arms build the real factory as lib/model.js does (`new Couchbase(conn,
 * infos)`), with the bootstrap of couchbase-entry-scope-b893.test.js §05:
 *   §01 a database with no models directory: no throw, `models/<database>/entities`
 *       now exists, and no `models/<entry key>/` is created by the factory;
 *   §02 control: an existing directory with an entity: the factory builds it.
 *
 * Run: node --test test/core/couchbase-entities-dir-b894.test.js
 */
'use strict';

var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var { describe, it, after } = require('node:test');
var assert = require('node:assert/strict');

var FW   = path.resolve(require('../fw'));
var REPO = path.resolve(__dirname, '../..');

// ─── globals bootstrap ───────────────────────────────────────────────────────
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(FW + '/helpers');
setPath('gina', { core: path.join(FW, 'core') });

// ─── throwaway project: an SDK stub, a bundle with one entity on bucket `db` ──
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b894-'));
fs.mkdirSync(path.join(TMP, 'node_modules/couchbase'), { recursive: true });
fs.writeFileSync(
    path.join(TMP, 'node_modules/couchbase/index.js'),
    "module.exports = {\n" +
    "    QueryScanConsistency: { NotBounded: 'not_bounded', RequestPlus: 'request_plus' },\n" +
    "    Cluster: function Cluster(url) { this.url = url; },\n" +
    "    connect: function connect() { throw new Error('#B894: the factory must not connect'); }\n" +
    "};\n"
);
fs.mkdirSync(path.join(TMP, 'bundle/models/db/entities'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'bundle/models/db/entities/thing.js'), 'function Thing(conn) {}\nmodule.exports = Thing;\n');
setPath('project', TMP);
setPath('bundle',  path.join(TMP, 'bundle'));

// ─── core/gna + gina package stubs ──────────────────────────────────────────
var _inherits = require(FW + '/lib/inherits/src/main.js');
var _merge    = require(FW + '/lib/merge/src/main.js');
var ModelUtil = require(FW + '/lib/model');
var quietConsole = {
    log: function() {}, info: function() {}, debug: function() {},
    warn: function() {}, error: function() {}, emerg: function() {}
};
var ginaExports = {
    lib: { logger: quietConsole, helpers: {}, inherits: _inherits, merge: _merge, Model: ModelUtil },
    onError: function() {}
};
[ require.resolve(path.join(FW, 'core/gna')), require.resolve(REPO) ].forEach(function(id) {
    require.cache[id] = { id: id, filename: id, loaded: true, exports: ginaExports };
});

// ─── context wiring ──────────────────────────────────────────────────────────
var BUNDLE = 'b894bundle';
var ENV    = 'dev';
setContext('__mock__', { config: function() { return { bundle: BUNDLE }; } });
setContext('bundle', BUNDLE);
setContext('env', ENV);
setContext('gina', {
    config: {
        envConf: (function() {
            var e = {}; e[BUNDLE] = {};
            e[BUNDLE][ENV] = { modelsPath: path.join(TMP, 'bundle/models') };
            return e;
        })()
    }
});

after(function() {
    fs.rmSync(TMP, { recursive: true, force: true });
});

/**
 * Builds the couchbase factory as lib/model.js does, with the framework logger
 * quiet while it runs.
 *
 * @inner
 * @param {object} infos - `{ database, model, bundle[, scope] }`
 * @returns {object} The entities object the factory returns
 */
function buildFactory(infos) {
    var logger = require(FW + '/lib').logger;
    var saved  = logger.info;
    logger.info = function() {};
    try {
        var Couchbase = require(path.join(FW, 'core/connectors/couchbase/index.js'));
        var conn = { sdk: { version: 4 }, _cluster: { query: function() { return Promise.resolve({ rows: [], meta: {} }); } } };
        return new Couchbase(conn, infos);
    } finally {
        logger.info = saved;
    }
}

describe('01 - #B894: an entry whose bucket has no models directory', function() {

    var dir   = path.join(TMP, 'bundle/models/demo/entities');
    var keyed = path.join(TMP, 'bundle/models/couchbase');
    var built = null;
    var error = null;

    it('the bucket-named directory does not exist beforehand (the precondition)', function() {
        assert.equal(fs.existsSync(path.join(TMP, 'bundle/models/demo')), false);
    });

    it('builds without throwing', function() {
        try {
            built = buildFactory({ database: 'demo', model: 'couchbase', bundle: BUNDLE, scope: 'local' });
        } catch (e) {
            error = e;
        }
        assert.equal(error, null, 'the factory threw: ' + (error && (error.stack || error.message)));
        assert.equal(typeof built, 'object');
    });

    it('creates models/<database>/entities, the directory it reads', function() {
        assert.equal(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), true, dir + ' was not created');
    });

    it('creates no models/<entry key>/ directory', function() {
        assert.equal(fs.existsSync(keyed), false, keyed + ' was created');
    });
});

describe('02 - #B894: control — an existing directory with an entity', function() {

    it('builds the entity it finds, as before', function() {
        var built = buildFactory({ database: 'db', model: 'db', bundle: BUNDLE, scope: 'local' });
        assert.equal(typeof built.Thing, 'function', 'no Thing entity: ' + Object.keys(built).join(', '));
        assert.equal(built.Thing.prototype._scope, 'local');
    });
});
