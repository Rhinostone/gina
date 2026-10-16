/**
 * #B911 — the DuckDB connector refuses an entry that names neither `file` nor
 * `database`.
 *
 * Its default file is `<gina home>/<database>.duckdb`, so an entry with neither key
 * opened `<gina home>/undefined.duckdb`, and an entry with both keys set to empty
 * strings opened `<gina home>/.duckdb`: the connection opened, the boot went on, and
 * nothing named the missing key. Reproduced on develop `386aa3571` with the real
 * connector and a stub driver. The connector now sets its error before it requires the
 * driver, so `onReady()` reports that the entry names neither key, and the model layer
 * ends the boot (core/model/index.js, then lib/model.js: exit 1). An empty string
 * counts as absent. Decided by Martin Luther ETOUMAN NDAMBWE at the plan gate,
 * 2026-10-16 (« Refuse the boot »).
 *
 * Harness: the REAL core/connectors/duckdb/lib/connector.js, with `core/gna` stubbed in
 * require.cache (the connector reads `lib.logger` and `lib.inherits` from it), and a
 * stub `@duckdb/node-api` in a temp project that records the path of every
 * `DuckDBInstance.create()` call; a second temp project holds no driver.
 *
 *   §00 controls, the stub driver is reached:
 *       `database` alone opens <gina home>/<database>.duckdb
 *       `file` opens that path; `file: ":memory:"` passes through verbatim
 *       an empty `file` beside a `database` opens <gina home>/<database>.duckdb
 *   §01 neither key:
 *       onReady() reports an error before it returns                       [red pre-fix]
 *       the message names both keys                                        [red pre-fix]
 *       nothing is opened: no create() call                                [red pre-fix]
 *   §02 both keys set to empty strings: the same refusal, nothing opened   [red pre-fix]
 *   §03 a project with no driver:
 *       CONTROL: with a `database`, onReady() reports « not installed »
 *       neither key: it reports the refusal, not « not installed »         [red pre-fix]
 *
 * Run: node --test test/core/duckdb-no-file-no-database-b911.test.js
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

var FW  = path.resolve(require('../fw'));
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b911-'));

// ─── globals bootstrap ───────────────────────────────────────────────────────
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(path.join(FW, 'helpers'));
if ( typeof GINA_FRAMEWORK_DIR == 'undefined' ) {
    global.GINA_FRAMEWORK_DIR = FW;
}
var HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME, { recursive: true });
setPath('gina', { core: path.join(FW, 'core'), home: HOME });

// ─── stub: core/gna (the connector reads lib.logger and lib.inherits) ────────
var quiet = {
    log: function() {}, info: function() {}, debug: function() {},
    warn: function() {}, error: function() {}, emerg: function() {}
};
var gnaId = require.resolve(path.join(FW, 'core/gna'));
require.cache[gnaId] = {
    id: gnaId, filename: gnaId, loaded: true,
    exports: {
        lib: { logger: quiet, inherits: require(path.join(FW, 'lib/inherits/src/main.js')) },
        onError: function() {}
    }
};

// ─── two temp projects: one with a stub driver, one with none ────────────────
var WITH_DRIVER = path.join(TMP, 'project-with-driver');
var NO_DRIVER   = path.join(TMP, 'project-no-driver');
var DRIVER_DIR  = path.join(WITH_DRIVER, 'node_modules/@duckdb/node-api');
fs.mkdirSync(DRIVER_DIR, { recursive: true });
fs.mkdirSync(NO_DRIVER, { recursive: true });
fs.writeFileSync(
    path.join(DRIVER_DIR, 'index.js'),
    "module.exports = { DuckDBInstance: { create: function(file) {\n" +
    "    global.__b911Creates.push(file);\n" +
    "    return Promise.resolve({ connect: function() { return Promise.resolve({}); } });\n" +
    "} } };\n"
);

var DuckdbConnector = require(path.join(FW, 'core/connectors/duckdb/lib/connector.js'));

/**
 * Opens one DuckDB connector over the given project, and reports what `onReady()`
 * passed, whether it fired before `onReady()` returned, and every path the stub
 * driver was asked to open.
 *
 * @inner
 * @param {string} project - the temp project the connector loads its driver from
 * @param {object} conf    - the connectors.json entry
 * @returns {Promise<{sync: boolean, err: *, conn: *, creates: string[]}>} the reading
 */
function open(project, conf) {
    var creates = global.__b911Creates = [];
    setPath('project', project);
    return new Promise(function(resolve) {
        var returned = false;
        var out      = { sync: false, err: 'NOT CALLED', conn: null, creates: creates };
        new DuckdbConnector(conf).onReady(function(err, conn) {
            out.sync = !returned;
            out.err  = err;
            out.conn = conn;
            resolve(out);
        });
        returned = true;
    });
}

after(function() {
    fs.rmSync(TMP, { recursive: true, force: true });
});

describe('00 - #B911: controls, the stub driver is reached', function() {

    it('CONTROL: `database` alone opens <gina home>/<database>.duckdb', async function() {
        var o = await open(WITH_DRIVER, { connector: 'duckdb', database: 'analytics' });
        assert.equal(o.err, null);
        assert.deepEqual(o.creates, [ path.join(HOME, 'analytics.duckdb') ]);
    });

    it('CONTROL: `file` opens that path', async function() {
        var file = path.join(TMP, 'explicit.duckdb');
        var o = await open(WITH_DRIVER, { connector: 'duckdb', file: file });
        assert.equal(o.err, null);
        assert.deepEqual(o.creates, [ file ]);
    });

    it('CONTROL: `file: ":memory:"` passes through verbatim', async function() {
        var o = await open(WITH_DRIVER, { connector: 'duckdb', file: ':memory:' });
        assert.equal(o.err, null);
        assert.deepEqual(o.creates, [ ':memory:' ]);
    });

    it('CONTROL: an empty `file` beside a `database` opens <gina home>/<database>.duckdb', async function() {
        var o = await open(WITH_DRIVER, { connector: 'duckdb', file: '', database: 'analytics' });
        assert.equal(o.err, null);
        assert.deepEqual(o.creates, [ path.join(HOME, 'analytics.duckdb') ]);
    });
});

describe('01 - #B911: an entry with neither key', function() {

    var o = null;
    before(async function() {
        o = await open(WITH_DRIVER, { connector: 'duckdb' });
    });

    it('onReady() reports an error before it returns', function() {
        assert.equal(o.sync, true, 'onReady() fired after it returned: the connector went on to open a file');
        assert.ok(o.err instanceof Error, 'onReady() passed no error: ' + o.err);
        assert.equal(o.conn, null);
    });

    it('the message names both keys', function() {
        assert.match(String(o.err && o.err.message), /^\[DuckdbConnector\] The connectors\.json entry names neither `file` nor `database`\./);
    });

    it('nothing is opened: no create() call', function() {
        assert.deepEqual(o.creates, []);
    });
});

describe('02 - #B911: both keys set to empty strings', function() {

    it('reports the same refusal, and opens nothing', async function() {
        var o = await open(WITH_DRIVER, { connector: 'duckdb', file: '', database: '' });
        assert.equal(o.sync, true, 'onReady() fired after it returned: the connector went on to open a file');
        assert.match(String(o.err && o.err.message), /names neither `file` nor `database`/);
        assert.deepEqual(o.creates, []);
    });
});

describe('03 - #B911: a project with no driver', function() {

    it('CONTROL: with a `database`, onReady() reports « not installed »', async function() {
        var o = await open(NO_DRIVER, { connector: 'duckdb', database: 'analytics' });
        assert.match(String(o.err && o.err.message), /@duckdb\/node-api is not installed/);
    });

    it('neither key: it reports the refusal, not « not installed »', async function() {
        var o = await open(NO_DRIVER, { connector: 'duckdb' });
        assert.match(String(o.err && o.err.message), /names neither `file` nor `database`/);
        assert.doesNotMatch(String(o.err && o.err.message), /is not installed/);
    });
});
