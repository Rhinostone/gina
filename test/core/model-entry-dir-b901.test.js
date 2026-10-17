/**
 * #B901 — the model layer creates no directory named after a connectors.json entry.
 *
 * `core/model/index.js` init() built `<modelsPath>/<entry key>/entities` for every
 * connectors.json entry, logged « Scanning model entities » with that path and
 * created it when missing. Nothing reads it: every ORM connector factory reads,
 * and creates, `models/<database>/entities`, and the redis and ai connectors read
 * no directory. So an entry named differently from its database, a redis entry and
 * an entry with no `database` each left an empty directory behind (reproduced on
 * develop `ca653e135` with `bin/gina-container` boots). init() now creates only the
 * models root, which the Couchbase reconnect checks before it reloads the models.
 *
 * Harness: the REAL `core/model/index.js` Model, built as lib/model.js builds it
 * (`new Model(bundle + '/' + key, conf).onReady(cb)`), with the real redis no-op
 * connector and the real SQLite connector on `:memory:`; where an arm needs the
 * directory a factory reads, the REAL SQLite factory runs after it with the infos
 * lib/model.js passes (`database`, or `keyspace` when the entry sets none, since
 * #B909). `gina` and `core/config` are stubbed in require.cache (the bootstrap of
 * couchbase-entities-dir-b894.test.js). Each arm has its own temp root, and fails
 * with a message naming its entry when model#ready does not fire within 5 s.
 *
 *   §00 controls: the listing sees a directory it is given; init creates the models
 *       root when it is missing and reaches model#ready with the connection
 *   §01 an entry named differently from its database: after the model layer and the
 *       factory, `models/<database>/entities` is the only directory      [red pre-fix]
 *   §02 control: an entry whose key is its database: the same single directory
 *   §03 a redis entry (no models): nothing under the models root         [red pre-fix]
 *   §04 an entry with no `database` (the in-memory SQLite session entry of the
 *       connectors reference): nothing under the models root             [red pre-fix]
 *   §05 no debug line names a `models/<entry key>/entities` path          [red pre-fix]
 *
 * Run: node --test test/core/model-entry-dir-b901.test.js
 */
'use strict';

// Before anything loads: no cache-busting re-requires, and no MQ dial from the logger.
process.env.NODE_ENV_IS_DEV = 'false';
process.env.GINA_LOG_STDOUT = 'true';

var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW   = path.resolve(require('../fw'));
var REPO = path.resolve(__dirname, '../..');

// ─── globals bootstrap ───────────────────────────────────────────────────────
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(FW + '/helpers');
setPath('gina', { core: path.join(FW, 'core') });
if (typeof GINA_FRAMEWORK_DIR == 'undefined') {
    global.GINA_FRAMEWORK_DIR = FW;
}

// ─── gina package + core/config stubs ────────────────────────────────────────
var debugLines = [];
var logger = {
    log: function() {}, info: function() {}, warn: function() {}, error: function() {}, emerg: function() {},
    debug: function() { debugLines.push(Array.prototype.join.call(arguments, ' ')); }
};
var ginaExports = {
    lib: {
        logger   : logger,
        helpers  : {},
        inherits : require(FW + '/lib/inherits/src/main.js'),
        merge    : require(FW + '/lib/merge/src/main.js'),
        math     : {},
        Config   : function Config() {},
        Model    : require(FW + '/lib/model')
    },
    onError: function() {}
};
[ require.resolve(path.join(FW, 'core/gna')), require.resolve(REPO) ].forEach(function(id) {
    require.cache[id] = { id: id, filename: id, loaded: true, exports: ginaExports };
});
var configId = require.resolve(path.join(FW, 'core/config'));
require.cache[configId] = {
    id: configId, filename: configId, loaded: true,
    exports: function Config() {
        this.getInstance = function() { throw new Error('#B901 harness: the conf is passed to Model, getInstance must not run'); };
    }
};

var Model  = require(path.join(FW, 'core/model'));
var SQLITE = path.join(FW, 'core/connectors/sqlite/index.js');
var TMP    = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b901-'));

after(function() {
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
 * How long runModel waits for model#ready. Ready takes milliseconds here, so a model
 * layer that never gets ready fails the arm with a named message instead of hanging
 * it until the suite's --test-timeout.
 *
 * @constant
 * @type {number}
 */
var READY_TIMEOUT_MS = 5000;

/**
 * Runs the model layer for one connectors.json entry, as lib/model.js does at boot,
 * in a temp root of its own, then, when `withFactory` is set, the SQLite factory with
 * the connection and infos lib/model.js passes it.
 *
 * @inner
 * @param {string}  label        - the arm's temp root name
 * @param {string}  key          - the connectors.json entry key
 * @param {object}  entry        - the connectors.json entry
 * @param {boolean} [withFactory] - also run the SQLite factory
 * @returns {Promise<{models: string, err: (Error|false|null), name: string, conn: *, debug: string[]}>}
 *   rejects with an Error naming the entry when model#ready does not fire within
 *   READY_TIMEOUT_MS
 */
function runModel(label, key, entry, withFactory) {
    var root   = path.join(TMP, label);
    var models = path.join(root, 'bundle/models');
    fs.mkdirSync(path.join(root, 'bundle'), { recursive: true });
    setPath('project', root);
    setPath('bundle', path.join(root, 'bundle'));

    var connectors = {};
    connectors[key] = entry;
    var conf = { env: 'dev', bundle: 'app', content: { connectors: connectors }, modelsPath: models };

    debugLines = [];
    return new Promise(function(resolve, reject) {
        var guard = setTimeout(function() {
            reject(new Error('#B901 harness: model#ready did not fire within ' + READY_TIMEOUT_MS + ' ms (entry « ' + key + ' »)'));
        }, READY_TIMEOUT_MS);
        new Model('app/' + key, conf).onReady(function(err, bundle, name, conn) {
            clearTimeout(guard);
            if (!err && withFactory) {
                require(SQLITE)(conn, { model: name, bundle: bundle, database: entry.database || entry.keyspace, scope: entry.scope });
            }
            resolve({ models: models, err: err, name: name, conn: conn, debug: debugLines.slice() });
        });
    });
}

describe('00 - #B901: controls', function() {

    it('the listing sees a directory it is given', function() {
        var root = path.join(TMP, 'listing');
        fs.mkdirSync(path.join(root, 'a/entities'), { recursive: true });
        assert.deepEqual(listDirs(root), ['a', 'a/entities']);
        assert.deepEqual(listDirs(path.join(TMP, 'no-such-dir')), []);
    });

    it('init creates the models root when it is missing, and reaches model#ready with the connection', async function() {
        var r = await runModel('ready', 'b901db', { connector: 'sqlite', database: 'b901db', file: ':memory:' });
        assert.equal(r.err, false);
        assert.equal(r.name, 'b901db');
        assert.equal(typeof r.conn, 'object');
        assert.notEqual(r.conn, null);
        assert.equal(fs.existsSync(r.models) && fs.statSync(r.models).isDirectory(), true, r.models + ' was not created');
    });
});

describe('01 - #B901: an entry named differently from its database', function() {

    var r = null;
    before(async function() {
        r = await runModel('named', 'sqlite', { connector: 'sqlite', database: 'b901db', file: ':memory:' }, true);
    });

    it('reaches model#ready', function() {
        assert.equal(r.err, false);
    });

    it('leaves models/<database>/entities as the only directory (no models/<entry key>/)', function() {
        assert.deepEqual(listDirs(r.models), ['b901db', 'b901db/entities']);
    });
});

describe('02 - #B901: control — an entry whose key is its database', function() {

    it('leaves models/<database>/entities as the only directory', async function() {
        var r = await runModel('same', 'b901db', { connector: 'sqlite', database: 'b901db', file: ':memory:' }, true);
        assert.equal(r.err, false);
        assert.deepEqual(listDirs(r.models), ['b901db', 'b901db/entities']);
    });
});

describe('03 - #B901: a redis entry (no models)', function() {

    var r = null;
    before(async function() {
        r = await runModel('redis', 'session', { connector: 'redis', host: '127.0.0.1', port: 6379, ttl: 86400, prefix: 'sess:' });
    });

    it('reaches model#ready with the no-op connector\'s null connection', function() {
        assert.equal(r.err, false);
        assert.equal(r.conn, null);
    });

    it('creates nothing under the models root', function() {
        assert.deepEqual(listDirs(r.models), []);
    });
});

describe('04 - #B901: an entry with no database (the in-memory SQLite session entry)', function() {

    var r = null;
    before(async function() {
        r = await runModel('nodb', 'session', { connector: 'sqlite', file: ':memory:', ttl: 86400 });
    });

    it('reaches model#ready', function() {
        assert.equal(r.err, false);
    });

    it('creates nothing under the models root', function() {
        assert.deepEqual(listDirs(r.models), []);
    });
});

describe('05 - #B901: the debug output', function() {

    it('names no models/<entry key>/entities path', async function() {
        var keys  = ['sqlite', 'session'];
        var lines = [];
        lines = lines.concat((await runModel('debug-named', 'sqlite', { connector: 'sqlite', database: 'b901db', file: ':memory:' })).debug);
        lines = lines.concat((await runModel('debug-redis', 'session', { connector: 'redis', host: '127.0.0.1', port: 6379 })).debug);
        assert.ok(lines.length > 0, 'no debug line was captured: the logger stub is not the one the model layer uses');
        var named = lines.filter(function(l) {
            return keys.some(function(k) { return l.indexOf('/models/' + k + '/entities') > -1; });
        });
        assert.deepEqual(named, []);
    });
});
