/**
 * #B907 — an entry that names no `database` gets no model directory, and a SQLite
 * entry that names neither `file` nor `database` gets an in-process database.
 *
 * Each ORM factory built its model directory from `infos.database` with no guard, so
 * an entry without `database` (a store-only entry, as the guides show the SQLite
 * session, job and kv entries) got `models/undefined/entities`; and the SQLite
 * connector's default file, `<gina home>/<database>.sqlite`, became
 * `<gina home>/undefined.sqlite` for an entry with neither key, as the
 * going-to-production tutorial's session entry is. Reproduced on develop `4077cc114`
 * with `bin/gina-container` boots of both entries. Each factory now creates and reads
 * `models/<database>/` only when the infos carry a database, and the SQLite connector
 * opens `:memory:` when the entry names neither key.
 *
 * Harness: the REAL factories, called as lib/model.js calls them
 * (`require(<connector>/index.js)(conn, infos)`), each over a temp bundle of its own
 * and with no driver: `gina`, `core/gna`, `core/config` and the lib registry are
 * stubbed in require.cache (the bootstraps of model-keyspace-b909.test.js and
 * model-entry-dir-b901.test.js), and the Couchbase SDK is a stub module in a temp
 * project (couchbase-entities-dir-b894.test.js). While a factory runs,
 * `fs.existsSync`, `fs.readdirSync`, `fs.mkdirSync` and `fs.statSync` record the
 * paths they receive.
 *
 *   §00 controls: the listing sees a directory it is given; the fs spy records the
 *       path a call receives and restores the functions it wrapped
 *   §01-§07 one factory each (sqlite, mysql, postgresql, scylladb, duckdb, mongodb,
 *       couchbase):
 *       CONTROL: with a database, it reads models/<database>/entities and its query
 *       directory, and loads the entity it finds
 *       CONTROL: with no database, it returns an entity map without throwing
 *       with no database, it passes no path under models/ to the fs calls  [red pre-fix]
 *       with no database, it creates no directory                        [red pre-fix]
 *   §08 the SQLite connector:
 *       CONTROLS: `database` alone opens <gina home>/<database>.sqlite; `file` wins
 *       over `database`; `file: ":memory:"` opens an in-process database
 *       neither key: it opens `:memory:`                                  [red pre-fix]
 *       neither key: it writes no file in the gina home                   [red pre-fix]
 *       an empty `database` counts as absent                              [red pre-fix]
 *       CONTROL: neither key: the connection answers a query
 *   §09 the tutorial's session entry, `{ "connector": "sqlite" }`, through the model
 *       layer, then the SQLite factory with the infos lib/model.js passes:
 *       CONTROL: it reaches model#ready
 *       the connection is in memory                                       [red pre-fix]
 *       no directory under models/                                         [red pre-fix]
 *       no database file in the gina home                                  [red pre-fix]
 *
 * Run: node --test test/core/connector-no-database-b907.test.js
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

var FW   = path.resolve(require('../fw'));
var REPO = path.resolve(__dirname, '../..');
var TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b907-'));

// ─── globals bootstrap ───────────────────────────────────────────────────────
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
if ( typeof GINA_FRAMEWORK_DIR == 'undefined' ) {
    global.GINA_FRAMEWORK_DIR = FW;
}

/**
 * Points `getPath('gina')` at the framework's core and at a gina home of the arm's own.
 *
 * @inner
 * @param {string} home - the gina home for the arm (created when missing)
 * @returns {string} `home`
 */
function useGinaHome(home) {
    fs.mkdirSync(home, { recursive: true });
    setPath('gina', { core: path.join(FW, 'core'), home: home });
    return home;
}
useGinaHome(path.join(TMP, 'home'));

// ─── stubs: gina, core/gna, core/config and the lib registry ─────────────────
var quiet = {
    log: function() {}, info: function() {}, debug: function() {},
    warn: function() {}, error: function() {}, emerg: function() {}
};
var libStub = {
    logger   : quiet,
    helpers  : {},
    inherits : require(path.join(FW, 'lib/inherits/src/main.js')),
    merge    : require(path.join(FW, 'lib/merge/src/main.js')),
    math     : {},
    Config   : function Config() {},
    Model    : require(path.join(FW, 'lib/model'))
};
[ require.resolve(path.join(FW, 'core/gna')), require.resolve(REPO) ].forEach(function(id) {
    require.cache[id] = { id: id, filename: id, loaded: true, exports: { lib: libStub, onError: function() {} } };
});
var libId = require.resolve(path.join(FW, 'lib'));
require.cache[libId] = { id: libId, filename: libId, loaded: true, exports: libStub };
var configId = require.resolve(path.join(FW, 'core/config'));
require.cache[configId] = {
    id: configId, filename: configId, loaded: true,
    exports: function Config() {
        this.getInstance = function() { throw new Error('#B907 harness: the conf is passed to Model, getInstance must not run'); };
    }
};

// ─── a temp project holding the Couchbase SDK stub (its factory requires it at load) ──
var PROJECT = path.join(TMP, 'project');
fs.mkdirSync(path.join(PROJECT, 'node_modules/couchbase'), { recursive: true });
fs.writeFileSync(
    path.join(PROJECT, 'node_modules/couchbase/index.js'),
    "module.exports = {\n" +
    "    QueryScanConsistency: { NotBounded: 'not_bounded', RequestPlus: 'request_plus' },\n" +
    "    Cluster: function Cluster(url) { this.url = url; },\n" +
    "    connect: function connect() { throw new Error('#B907: the factory must not connect'); }\n" +
    "};\n"
);
setPath('project', PROJECT);

var BUNDLE = 'b907bundle';

/** @type {string[]} the fs functions the spy wraps */
var SPIED = ['existsSync', 'readdirSync', 'mkdirSync', 'statSync'];

/**
 * The ORM factories, each with the directory its query files live in and a
 * connection object that is enough for its init (no driver call is made there).
 *
 * @type {Array<{name: string, queryDir: string, conn: object}>}
 */
var FACTORIES = [
    { name: 'sqlite',     queryDir: 'sql',       conn: {} },
    { name: 'mysql',      queryDir: 'sql',       conn: {} },
    { name: 'postgresql', queryDir: 'sql',       conn: {} },
    { name: 'scylladb',   queryDir: 'cql',       conn: { execute: function() { return Promise.resolve({ rows: [] }); } } },
    { name: 'duckdb',     queryDir: 'sql',       conn: {} },
    { name: 'mongodb',    queryDir: 'pipelines', conn: {} },
    { name: 'couchbase',  queryDir: 'n1ql',      conn: { sdk: { version: 4 }, _cluster: { query: function() { return Promise.resolve({ rows: [], meta: {} }); } } } }
];

/** @type {object[]} connections opened by §08 and §09, closed after the run */
var opened = [];

after(function() {
    opened.forEach(function(conn) {
        try { if (conn && typeof conn.close === 'function') conn.close(); } catch (e) {}
    });
    fs.rmSync(TMP, { recursive: true, force: true });
});

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
 * Runs `fn` with the SPIED fs functions wrapped so that each records the path it
 * receives, and restores them afterwards, also when `fn` throws.
 *
 * @inner
 * @param {function} fn - the code to observe
 * @returns {{result: *, error: (Error|null), touched: string[]}} what `fn` returned,
 *   what it threw, and the first argument of every wrapped call, in call order
 */
function withFsSpy(fn) {
    var touched = [], saved = {}, result = null, error = null;
    SPIED.forEach(function(m) {
        saved[m] = fs[m];
        fs[m] = function(p) {
            touched.push(String(p));
            return saved[m].apply(this, arguments);
        };
    });
    try {
        result = fn();
    } catch (e) {
        error = e;
    } finally {
        SPIED.forEach(function(m) { fs[m] = saved[m]; });
    }
    return { result: result, error: error, touched: touched };
}

/**
 * Builds one ORM factory as lib/model.js does, over a temp bundle of its own, with
 * the fs spy on.
 *
 * @inner
 * @param {object}  f            - a FACTORIES row
 * @param {string}  label        - the arm's temp root name
 * @param {object}  infos        - `{ model, bundle[, database], scope }`
 * @param {boolean} [withEntity] - first write `models/<infos.database>/entities/thing.js`
 * @returns {{entities: *, error: (Error|null), models: string, touched: string[]}} the
 *   factory's return, what it threw, the bundle's models root, and the paths under
 *   that root the wrapped fs calls received
 */
function runFactory(f, label, infos, withEntity) {
    var bundle = path.join(TMP, label, 'bundle');
    var models = path.join(bundle, 'models');
    fs.mkdirSync(bundle, { recursive: true });
    if (withEntity) {
        fs.mkdirSync(path.join(models, infos.database, 'entities'), { recursive: true });
        fs.writeFileSync(path.join(models, infos.database, 'entities/thing.js'), 'function Thing(conn) {}\nmodule.exports = Thing;\n');
    }
    setPath('bundle', bundle);
    var r = withFsSpy(function() {
        return require(path.join(FW, 'core/connectors', f.name, 'index.js'))(f.conn, infos);
    });
    return {
        entities : r.result,
        error    : r.error,
        models   : models,
        touched  : r.touched.filter(function(p) { return p === models || p.indexOf(models + '/') === 0; })
    };
}

describe('00 - #B907: controls', function() {

    it('the listing sees a directory it is given', function() {
        var root = path.join(TMP, 'listing');
        fs.mkdirSync(path.join(root, 'a/entities'), { recursive: true });
        assert.deepEqual(listDirs(root), ['a', 'a/entities']);
        assert.deepEqual(listDirs(path.join(TMP, 'no-such-dir')), []);
    });

    it('the fs spy records the path a call receives, and restores the functions it wrapped', function() {
        var originals = SPIED.map(function(m) { return fs[m]; });
        var probe     = path.join(TMP, 'spy-probe');
        var r = withFsSpy(function() { return fs.existsSync(probe); });
        assert.equal(r.error, null);
        assert.equal(r.result, false);
        assert.deepEqual(r.touched, [probe]);
        assert.deepEqual(SPIED.map(function(m) { return fs[m]; }), originals);
    });
});

FACTORIES.forEach(function(f, i) {

    describe(('0' + (i + 1)).slice(-2) + ' - #B907: the ' + f.name + ' factory', function() {

        it('CONTROL: with a database, it reads models/<database>/entities and its ' + f.queryDir + '/ directory, and loads the entity it finds', function() {
            var r = runFactory(f, f.name + '-db', { model: 'db', bundle: BUNDLE, database: 'db', scope: 'local' }, true);
            assert.equal(r.error, null, 'the factory threw: ' + (r.error && (r.error.stack || r.error.message)));
            assert.equal(typeof r.entities.Thing, 'function', 'no Thing entity: ' + Object.keys(r.entities || {}).join(', '));
            assert.ok(r.touched.indexOf(path.join(r.models, 'db/entities')) > -1, 'no fs call on models/db/entities: ' + JSON.stringify(r.touched));
            assert.ok(r.touched.indexOf(path.join(r.models, 'db', f.queryDir)) > -1, 'no fs call on models/db/' + f.queryDir + ': ' + JSON.stringify(r.touched));
        });

        it('CONTROL: with no database, it returns an entity map without throwing', function() {
            var r = runFactory(f, f.name + '-nodb-a', { model: 'session', bundle: BUNDLE, scope: 'local' });
            assert.equal(r.error, null, 'the factory threw: ' + (r.error && (r.error.stack || r.error.message)));
            assert.equal(typeof r.entities, 'object');
            assert.notEqual(r.entities, null);
        });

        it('with no database, it passes no path under models/ to the fs calls', function() {
            var r = runFactory(f, f.name + '-nodb-b', { model: 'session', bundle: BUNDLE, scope: 'local' });
            assert.equal(r.error, null, 'the factory threw: ' + (r.error && (r.error.stack || r.error.message)));
            assert.deepEqual(r.touched, []);
        });

        it('with no database, it creates no directory', function() {
            var r = runFactory(f, f.name + '-nodb-c', { model: 'session', bundle: BUNDLE, scope: 'local' });
            assert.equal(r.error, null, 'the factory threw: ' + (r.error && (r.error.stack || r.error.message)));
            assert.deepEqual(listDirs(r.models), []);
        });
    });
});

describe('08 - #B907: the SQLite connector', function() {

    var SqliteConnector = null;
    before(function() {
        SqliteConnector = require(path.join(FW, 'core/connectors/sqlite/lib/connector.js'));
    });

    /**
     * Opens one SQLite connector, over a gina home of its own.
     *
     * @inner
     * @param {string} label - the arm's temp root name
     * @param {object} conf  - the connectors.json entry
     * @returns {{err: *, conn: *, file: (string|null), home: string}} what onReady
     *   passed, the file the connection opened, and the arm's gina home
     */
    function open(label, conf) {
        var home = useGinaHome(path.join(TMP, 'conn-' + label, 'home'));
        var out  = { err: 'NOT CALLED', conn: null, file: null, home: home };
        new SqliteConnector(conf).onReady(function(err, conn) { out.err = err; out.conn = conn; });
        if (out.conn) {
            opened.push(out.conn);
            out.file = out.conn._file;
        }
        return out;
    }

    it('CONTROL: `database` alone opens <gina home>/<database>.sqlite', function() {
        var o = open('db', { connector: 'sqlite', database: 'mydb' });
        assert.equal(o.err, null);
        assert.equal(o.file, path.join(o.home, 'mydb.sqlite'));
        assert.equal(fs.existsSync(path.join(o.home, 'mydb.sqlite')), true);
    });

    it('CONTROL: `file` wins over `database`', function() {
        var file = path.join(TMP, 'conn-file', 'explicit.sqlite');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        var o = open('file', { connector: 'sqlite', database: 'mydb', file: file });
        assert.equal(o.err, null);
        assert.equal(o.file, file);
        assert.deepEqual(fs.readdirSync(o.home), []);
    });

    it('CONTROL: `file: ":memory:"` opens an in-process database', function() {
        var o = open('memory', { connector: 'sqlite', file: ':memory:', ttl: 86400 });
        assert.equal(o.err, null);
        assert.equal(o.file, ':memory:');
    });

    it('with neither `file` nor `database`, it opens an in-process database', function() {
        var o = open('neither', { connector: 'sqlite' });
        assert.equal(o.err, null);
        assert.equal(o.file, ':memory:');
    });

    it('with neither key, it writes no file in the gina home', function() {
        var o = open('neither-home', { connector: 'sqlite' });
        assert.equal(o.err, null);
        assert.deepEqual(fs.readdirSync(o.home), []);
    });

    it('an empty `database` counts as absent', function() {
        var o = open('empty', { connector: 'sqlite', database: '' });
        assert.equal(o.err, null);
        assert.equal(o.file, ':memory:');
    });

    it('CONTROL: with neither key, the connection answers a query', function() {
        var o = open('neither-query', { connector: 'sqlite' });
        assert.equal(o.err, null);
        assert.equal(o.conn.prepare('SELECT 1 AS one').get().one, 1);
    });
});

describe('09 - #B907: the tutorial\'s session entry through the model layer', function() {

    var entry = { connector: 'sqlite' };
    var r     = null;

    before(async function() {
        var Model  = require(path.join(FW, 'core/model'));
        var root   = path.join(TMP, 'tutorial');
        var bundle = path.join(root, 'bundle');
        var models = path.join(bundle, 'models');
        var home   = useGinaHome(path.join(root, 'home'));
        fs.mkdirSync(bundle, { recursive: true });
        setPath('bundle', bundle);
        var conf = { env: 'dev', bundle: 'app', content: { connectors: { session: entry } }, modelsPath: models };
        r = await new Promise(function(resolve, reject) {
            var timer = setTimeout(function() { reject(new Error('model#ready did not come within 5 s')); }, 5000);
            new Model('app/session', conf).onReady(function(err, bundleName, name, conn) {
                clearTimeout(timer);
                var out = { err: err, conn: conn, file: conn ? conn._file : null, models: models, home: home, error: null };
                if (conn) opened.push(conn);
                if (!err) {
                    try {
                        // lib/model.js passes the entry's `database`, or its `keyspace` when it sets none (#B909).
                        require(path.join(FW, 'core/connectors/sqlite/index.js'))(conn, { model: name, bundle: bundleName, database: entry.database || entry.keyspace, scope: entry.scope });
                    } catch (e) {
                        out.error = e;
                    }
                }
                resolve(out);
            });
        });
    });

    it('CONTROL: it reaches model#ready, and the factory does not throw', function() {
        assert.equal(r.err, false);
        assert.equal(r.error, null, 'the factory threw: ' + (r.error && (r.error.stack || r.error.message)));
    });

    it('the connection is in memory', function() {
        assert.equal(r.file, ':memory:');
    });

    it('no directory is left under models/', function() {
        assert.deepEqual(listDirs(r.models), []);
    });

    it('no database file is left in the gina home', function() {
        assert.deepEqual(fs.readdirSync(r.home), []);
    });
});
