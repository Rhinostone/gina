/**
 * #B909 — a ScyllaDB entry configured as the guides show loads its entities from
 * `models/<keyspace>/`.
 *
 * Every documented ScyllaDB entry names its keyspace with `keyspace` and sets no
 * `database`, and the ScyllaDB connector connects with `keyspace || database`. But
 * `lib/model.js` built the factory infos from the entry's `database` alone, at boot
 * (`loadAllModels`) and on a reload (`reloadModels`), and the ScyllaDB factory reads
 * `models/<infos.database>/entities` and `models/<infos.database>/cql`. So such an
 * entry loaded no entity, and the factory created `models/undefined/entities`
 * (measured on develop `11947d227` with the real factory). Both calls now pass the
 * entry's `database`, or its `keyspace` when it sets none: an entry that sets
 * `database` is unchanged, also when it sets both.
 *
 * Harness: the REAL `lib/model.js`. `core/model` is stubbed in require.cache with a
 * Model whose `onReady` answers on the next turn with a fake connection, so
 * `loadAllModels` runs its real ready step without a cluster; `GINA_FRAMEWORK_DIR`
 * points at a temp framework whose `core/connectors/scylladb/index.js` is a spy that
 * records the infos each factory call receives and returns no entity. §03 hands the
 * infos recorded at boot to the REAL ScyllaDB factory, over a temp bundle holding
 * `models/mykeyspace/entities/user.js` and `models/mykeyspace/cql/User/findById.sql`;
 * `gina`, `core/gna` and the lib registry are stubbed in require.cache for it (the
 * bootstrap of model-entry-dir-b901.test.js).
 *
 *   §00 controls: the stubbed Model is what `loadAllModels` builds; each path calls
 *       the spy once per entry, with the entry key and the bundle; the listing sees
 *       a directory it is given
 *   §01 boot: the guide's entry, which sets only `keyspace`, reaches the factory with
 *       `database: 'mykeyspace'`                                         [red pre-fix]
 *       controls: an entry that sets `database` (what `connector:add --database`
 *       writes) and one that sets both, whose directory stays the `database` one
 *   §02 reload: the same three entries                                  [red pre-fix]
 *   §03 the real ScyllaDB factory, given the infos recorded at boot: the keyspace-only
 *       entry loads `User` with its CQL method and creates no `models/undefined`;
 *       an ORM entry and a session entry on one keyspace each get their own `User`
 *       class from the shared directory                                  [red pre-fix]
 *       control: the infos of the `database` entry load `User` with its CQL method
 *
 * An entry that sets neither key is #B907's and has no arm here.
 *
 * Run: node --test test/lib/model-keyspace-b909.test.js
 */
'use strict';

// Before anything loads: no cache-busting re-requires, and no MQ dial from the logger.
process.env.NODE_ENV_IS_DEV = 'false';
process.env.GINA_LOG_STDOUT = 'true';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW        = path.resolve(require('../fw'));
var REPO      = path.resolve(__dirname, '../..');
var MODEL_SRC = path.join(FW, 'lib/model.js');
var SCYLLADB  = path.join(FW, 'core/connectors/scylladb/index.js');

// ─── globals bootstrap ───────────────────────────────────────────────────────
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
setPath('gina', { core: path.join(FW, 'core') });

// ─── stubs: gina, core/gna and the lib registry, for the real factory ────────
var quiet = {
    log: function() {}, info: function() {}, debug: function() {},
    warn: function() {}, error: function() {}, emerg: function() {}
};
var libStub = {
    logger   : quiet,
    helpers  : {},
    inherits : require(path.join(FW, 'lib/inherits/src/main.js')),
    merge    : require(path.join(FW, 'lib/merge/src/main.js')),
    Model    : require(MODEL_SRC)
};
[ require.resolve(path.join(FW, 'core/gna')), require.resolve(REPO) ].forEach(function(id) {
    require.cache[id] = { id: id, filename: id, loaded: true, exports: { lib: libStub, onError: function() {} } };
});
var libId = require.resolve(path.join(FW, 'lib'));
require.cache[libId] = { id: libId, filename: libId, loaded: true, exports: libStub };

// ─── stub: core/model, the Model loadAllModels builds for each entry ─────────
var built = [];

/**
 * Stand-in for `core/model`: answers `onReady` on the next turn with no error and a
 * fake connection, as a connector does once it is connected.
 *
 * @inner
 * @constructor
 * @param {string} id   - `<bundle>/<entry key>`, as `loadAllModels` passes it
 * @param {object} conf - the bundle's env conf (not read)
 */
function FakeModel(id, conf) {
    var parts = id.split('/');
    built.push(id);
    this.onReady = function(cb) {
        setImmediate(function() { cb(false, parts[0], parts[1], { fakeConnection: parts[1] }); });
        return this;
    };
}
var coreModelId = require.resolve(path.join(FW, 'core/model'));
require.cache[coreModelId] = { id: coreModelId, filename: coreModelId, loaded: true, exports: FakeModel };

// ─── a temp framework whose scylladb factory is a spy ────────────────────────
var TMP     = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b909-'));
var FAKE_FW = path.join(TMP, 'fw');
fs.mkdirSync(path.join(FAKE_FW, 'core/connectors/scylladb'), { recursive: true });
fs.writeFileSync(path.join(FAKE_FW, 'core/connectors/scylladb/index.js'),
    'module.exports = function(conn, infos) {\n'
    + '    (global.__b909Infos = global.__b909Infos || []).push(infos);\n'
    + '    return {};\n'
    + '};\n');

// lib/model.js builds the connector path from the bare global the boot defines.
if ( typeof global.GINA_FRAMEWORK_DIR != 'undefined' ) {
    throw new Error('#B909 harness: GINA_FRAMEWORK_DIR must not be defined before this file sets it');
}
global.GINA_FRAMEWORK_DIR = FAKE_FW;

var ModelUtil = require(MODEL_SRC);
var mu        = new ModelUtil();

after(function() {
    delete global.GINA_FRAMEWORK_DIR;
    delete global.__b909Infos;
    fs.rmSync(TMP, { recursive: true, force: true });
});

// ─── the entries ─────────────────────────────────────────────────────────────
// data/scylladb-orm.md, « Connector config (connectors.json) », without its credentials.
var KEYSPACE_ONLY = {
    connector       : 'scylladb',
    contactPoints   : ['127.0.0.1:9042'],
    localDataCenter : 'datacenter1',
    keyspace        : 'mykeyspace'
};
// What `gina connector:add <name> --connector=scylladb --database=mykeyspace` writes.
var DATABASE_ONLY = {
    connector       : 'scylladb',
    contactPoints   : ['127.0.0.1:9042'],
    localDataCenter : 'datacenter1',
    database        : 'mykeyspace'
};
// Both keys: the connection uses the keyspace, the model directory stays the `database` one.
var BOTH = {
    connector       : 'scylladb',
    contactPoints   : ['127.0.0.1:9042'],
    localDataCenter : 'datacenter1',
    database        : 'models_dir',
    keyspace        : 'cql_keyspace'
};
// The session entry of the connectors reference (« Single host (dev) »), on the ORM keyspace.
var SESSION_SAME_KEYSPACE = {
    connector : 'scylladb',
    host      : '127.0.0.1',
    port      : 9042,
    keyspace  : 'mykeyspace',
    table     : 'sessions',
    ttl       : 86400
};

/**
 * Lists every directory under `root`, as paths relative to it, sorted.
 *
 * @inner
 * @param {string} root - the directory to walk
 * @returns {string[]} relative directory paths; `[]` when `root` does not exist
 */
function listDirs(root) {
    var out = [];
    (function walk(dir) {
        if ( !fs.existsSync(dir) ) return;
        fs.readdirSync(dir).sort().forEach(function(name) {
            var p = path.join(dir, name);
            if ( fs.statSync(p).isDirectory() ) {
                out.push(path.relative(root, p));
                walk(p);
            }
        });
    })(root);
    return out;
}

/**
 * Runs the real `loadAllModels` over one bundle, `app`, whose connectors.json holds
 * `entries`, and resolves with what the spy factory received and which Models were
 * built. A callback that never comes rejects after 5 s instead of hanging the file.
 *
 * @inner
 * @param {object} entries - connectors.json content: entry key to entry
 * @returns {Promise<{infos: object[], built: string[]}>}
 */
function boot(entries) {
    global.__b909Infos = [];
    built.length = 0;
    mu.models   = {};
    mu.entities = {};
    var conf = { bundle: 'app', env: 'dev', content: { connectors: entries }, modelsPath: path.join(TMP, 'models') };
    return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() { reject(new Error('loadAllModels did not call back within 5 s')); }, 5000);
        mu.loadAllModels(['app'], { app: { dev: conf } }, 'dev', function() {
            clearTimeout(timer);
            resolve({ infos: global.__b909Infos.slice(), built: built.slice() });
        });
    });
}

/**
 * Runs the real `reloadModels` over one entry, `db`, of bundle `app`, and returns
 * what the spy factory received and how the reload called back.
 *
 * @inner
 * @param {object} entry - the connectors.json entry
 * @returns {{infos: object[], calls: Array<Array>}}
 */
function reload(entry) {
    global.__b909Infos = [];
    mu.models = { app: { db: {} } };
    setContext('modelConnectors', { app: { db: { conn: { fakeConnection: 'db' } } } });
    var calls = [];
    mu.reloadModels({
        bundle     : 'app',
        modelsPath : path.join(TMP, 'models'),
        content    : { connectors: { db: entry } }
    }, function() { calls.push(Array.prototype.slice.call(arguments)); });
    return { infos: global.__b909Infos.slice(), calls: calls };
}

/**
 * Runs the REAL ScyllaDB factory once per infos, over one temp bundle that holds
 * `models/mykeyspace/entities/user.js` and `models/mykeyspace/cql/User/findById.sql`.
 *
 * @inner
 * @param {string}   label     - the arm's temp root name
 * @param {object[]} infosList - the infos to pass, as recorded from lib/model.js
 * @returns {{entities: object[], dirs: string[]}} one entity map per infos, and the
 *   directories under the bundle's `models/` afterwards
 */
function runFactory(label, infosList) {
    var bundle = path.join(TMP, label, 'bundle');
    var models = path.join(bundle, 'models');
    fs.mkdirSync(path.join(models, 'mykeyspace/entities'), { recursive: true });
    fs.mkdirSync(path.join(models, 'mykeyspace/cql/User'), { recursive: true });
    fs.writeFileSync(path.join(models, 'mykeyspace/entities/user.js'),
        'function User(conn) {}\nmodule.exports = User;\n');
    fs.writeFileSync(path.join(models, 'mykeyspace/cql/User/findById.sql'),
        '/*\n * @param  {uuid}  ?  user id\n * @return {object}\n */\nSELECT id FROM users WHERE id = ?\n');
    setPath('bundle', bundle);
    var conn = { execute: function() { return Promise.resolve({ rows: [] }); } };
    var entities = infosList.map(function(infos) { return require(SCYLLADB)(conn, infos); });
    return { entities: entities, dirs: listDirs(models) };
}

describe('00 - #B909: controls', function() {

    it('the listing sees a directory it is given', function() {
        var root = path.join(TMP, 'listing');
        fs.mkdirSync(path.join(root, 'a/entities'), { recursive: true });
        assert.deepEqual(listDirs(root), ['a', 'a/entities']);
        assert.deepEqual(listDirs(path.join(TMP, 'no-such-dir')), []);
    });

    it('loadAllModels builds the stubbed Model and calls the spy once, with the entry key and the bundle', async function() {
        var r = await boot({ primary: DATABASE_ONLY });
        assert.deepEqual(r.built, ['app/primary']);
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].model, 'primary');
        assert.equal(r.infos[0].bundle, 'app');
    });

    it('reloadModels calls the spy once, with the entry key and the bundle, and calls back once with false', function() {
        var r = reload(DATABASE_ONLY);
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].model, 'db');
        assert.equal(r.infos[0].bundle, 'app');
        assert.deepEqual(r.calls, [[false]]);
    });
});

describe('01 - #B909: the infos built at boot (loadAllModels)', function() {

    it('the guide\'s entry, which sets only `keyspace`, reaches the factory with the keyspace as `database`', async function() {
        var r = await boot({ primary: KEYSPACE_ONLY });
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].database, 'mykeyspace');
    });

    it('CONTROL: an entry that sets `database` keeps it', async function() {
        var r = await boot({ primary: DATABASE_ONLY });
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].database, 'mykeyspace');
    });

    it('CONTROL: an entry that sets both keeps its `database`', async function() {
        var r = await boot({ primary: BOTH });
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].database, 'models_dir');
    });
});

describe('02 - #B909: the infos built on a reload (reloadModels)', function() {

    it('the guide\'s entry, which sets only `keyspace`, reaches the factory with the keyspace as `database`', function() {
        var r = reload(KEYSPACE_ONLY);
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].database, 'mykeyspace');
    });

    it('CONTROL: an entry that sets `database` keeps it', function() {
        var r = reload(DATABASE_ONLY);
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].database, 'mykeyspace');
    });

    it('CONTROL: an entry that sets both keeps its `database`', function() {
        var r = reload(BOTH);
        assert.equal(r.infos.length, 1);
        assert.equal(r.infos[0].database, 'models_dir');
    });
});

describe('03 - #B909: the real ScyllaDB factory, given the infos recorded at boot', function() {

    var ks = null, db = null, pair = null;
    before(async function() {
        ks   = (await boot({ primary: KEYSPACE_ONLY })).infos;
        db   = (await boot({ primary: DATABASE_ONLY })).infos;
        pair = (await boot({ primary: KEYSPACE_ONLY, session: SESSION_SAME_KEYSPACE })).infos;
    });

    it('CONTROL: the infos of the `database` entry load User with its CQL method', function() {
        var r = runFactory('factory-db', [db[0]]);
        assert.equal(typeof r.entities[0].User, 'function', 'no User entity was loaded');
        assert.equal(typeof r.entities[0].User.prototype.findById, 'function');
    });

    it('the infos of the keyspace-only entry load User with its CQL method', function() {
        var r = runFactory('factory-ks', [ks[0]]);
        assert.equal(typeof r.entities[0].User, 'function', 'no User entity was loaded');
        assert.equal(typeof r.entities[0].User.prototype.findById, 'function');
        assert.equal(r.entities[0].User.prototype.database, 'mykeyspace');
    });

    it('the keyspace-only entry creates no models/undefined directory', function() {
        var r = runFactory('factory-ks-dirs', [ks[0]]);
        assert.deepEqual(r.dirs, ['mykeyspace', 'mykeyspace/cql', 'mykeyspace/cql/User', 'mykeyspace/entities']);
    });

    it('an ORM entry and a session entry on one keyspace each get their own User class', function() {
        assert.equal(pair.length, 2);
        var byModel = {};
        pair.forEach(function(infos) { byModel[infos.model] = infos; });
        var r = runFactory('factory-pair', [byModel.primary, byModel.session]);
        var A = r.entities[0].User, B = r.entities[1].User;
        assert.equal(typeof A, 'function', 'the ORM entry loaded no User entity');
        assert.equal(typeof B, 'function', 'the session entry loaded no User entity');
        assert.notEqual(A, B);
        assert.equal(A.prototype.model, 'primary');
        assert.equal(B.prototype.model, 'session');
        assert.equal(typeof B.prototype.findById, 'function');
    });
});
