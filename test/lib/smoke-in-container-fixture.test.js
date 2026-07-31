/**
 * script/smoke_in_container.js — the SQLite connector fixture.
 *
 * The container smoke writes a SQLite fixture into its `db` bundle so that at
 * least one connector is exercised end-to-end on every Node leg and on the Bun
 * CI leg. Before this existed, NO CI leg — Node or Bun — touched any connector
 * (measured 2026-07-28), so "Bun is a supported, CI-gated runtime" only ever
 * meant install → boot → HTTP 200 on a connector-FREE scaffold.
 *
 * These tests cover the parts that don't need Docker: the pure fixture builders.
 * A typo in an embedded SQL/JSON string would otherwise only surface after a
 * full multi-container smoke cycle, so the point here is to fail in ~1s instead.
 *
 * Requiring the script is safe: it is guarded behind `require.main === module`
 * (measured true when run directly under BOTH node:24 and oven/bun:1.3.14, and
 * false when required from node:test — so the guard can neither skip the smoke
 * in a container nor start one inside this suite).
 */

'use strict';

var vm       = require('vm');
var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var CONT = require(nodePath.join(__dirname, '..', '..', 'script', 'smoke_in_container.js'));

var FIXTURE  = CONT.sqliteFixtureFiles();
var REL      = Object.keys(FIXTURE);
var MODEL_DIR = 'models/' + CONT.DB_ENTRY;


describe('01 - sqlite fixture: the file set', function () {

    it('writes exactly the expected bundle-relative paths', function () {
        assert.deepEqual(REL.slice().sort(), [
            'config/connectors.json',
            'controllers/controller.' + CONT.DB_NS + '.js',
            MODEL_DIR + '/entities/' + CONT.DB_ENTITY + '.js',
            MODEL_DIR + '/sql/' + CONT.DB_ENTITY + '/findByToken.sql',
            MODEL_DIR + '/sql/' + CONT.DB_ENTITY + '/insert.sql'
        ].sort());
    });

    it('every file has content and ends with a newline', function () {
        REL.forEach(function (rel) {
            assert.ok(FIXTURE[rel].length > 0, rel + ' is empty');
            assert.ok(/\n$/.test(FIXTURE[rel]), rel + ' must end with a newline');
        });
    });

    it('ships NO setup.sql — the harness owns the schema', function () {
        // The connector PRE-COMPILES every .sql at boot, so a statement naming a
        // not-yet-created table fails prepare() and latches the error for the
        // process lifetime; a setup.sql called later cannot rescue it.
        assert.ok(REL.every(function (rel) { return rel.indexOf('setup.sql') < 0; }),
            'schema creation must happen before boot, not from a .sql entity method');
    });
});


describe('02 - sqlite fixture: connectors.json', function () {

    var conf, entry;

    it('parses as strict JSON (no comment stripping needed)', function () {
        conf  = JSON.parse(FIXTURE['config/connectors.json']);
        entry = conf[CONT.DB_ENTRY];
        assert.ok(entry, 'the ' + CONT.DB_ENTRY + ' entry exists');
    });

    it('declares the sqlite connector', function () {
        assert.equal(entry.connector, 'sqlite');
    });

    it('sets `database` EQUAL to the entry key', function () {
        // Two independent code paths auto-create the models dir — one from the
        // entry key (core/model/index.js), one from `database`
        // (core/connectors/sqlite/index.js). A mismatch silently creates two
        // directories and the SQL is loaded into neither.
        assert.equal(entry.database, CONT.DB_ENTRY);
    });

    it('puts the PATH in `file`, never in `database`', function () {
        // `database` is a NAME to the model layer; a path there fails the boot.
        assert.equal(entry.file, CONT.DB_FILE);
        assert.doesNotMatch(entry.database, /[\/\\]/, '`database` must not look like a path');
    });

    it('keeps the $schema annotation (a non-object key the loader skips)', function () {
        assert.equal(conf.$schema, 'https://gina.io/schema/connectors.json');
    });

    it('has at least one object-valued key', function () {
        // A connectors.json whose only key is `$schema` boots green and SILENT
        // (the #B29 zero-connector short-circuit), so the fixture losing its
        // entry would not fail the boot — it would quietly gate nothing.
        var objectKeys = Object.keys(conf).filter(function (k) {
            return typeof conf[k] === 'object' && conf[k] !== null;
        });
        assert.ok(objectKeys.length >= 1, 'a $schema-only connectors.json gates nothing');
    });
});


describe('03 - sqlite fixture: the SQL files', function () {

    var insertSql  = FIXTURE[MODEL_DIR + '/sql/' + CONT.DB_ENTITY + '/insert.sql'];
    var findSql    = FIXTURE[MODEL_DIR + '/sql/' + CONT.DB_ENTITY + '/findByToken.sql'];

    it('every .sql names the same table as the harness schema', function () {
        assert.ok(CONT.sqliteSchemaSql().indexOf(CONT.DB_TABLE) > -1, 'schema names the table');
        REL.filter(function (r) { return /\.sql$/.test(r); }).forEach(function (rel) {
            assert.ok(FIXTURE[rel].indexOf(CONT.DB_TABLE) > -1,
                rel + ' must reference ' + CONT.DB_TABLE);
        });
    });

    it('the schema is CREATE TABLE IF NOT EXISTS (idempotent across re-runs)', function () {
        assert.match(CONT.sqliteSchemaSql(), /CREATE TABLE IF NOT EXISTS/);
    });

    it('insert.sql is a positional write op carrying a @param annotation', function () {
        assert.match(insertSql, /@param\s+\{string\}/);
        assert.match(insertSql, /INSERT INTO/);
        assert.match(insertSql, /VALUES \(\?\)/);
        assert.doesNotMatch(insertSql, /@return/, 'a write op takes no @return');
    });

    it('findByToken.sql annotates @return {object} so it maps to stmt.get()', function () {
        assert.match(findSql, /@param\s+\{string\}/);
        assert.match(findSql, /@return\s+\{object\}/);
        assert.match(findSql, /^\s*SELECT/m);
        assert.match(findSql, /WHERE token = \?/);
    });

    it('the sql/ directory name matches the entity filename', function () {
        // The connector derives the entity class from the sql/ DIRECTORY name and
        // matches it against the class built from the entity FILENAME; a mismatch
        // silently attaches no methods at all.
        var sqlDirs   = REL.filter(function (r) { return /\.sql$/.test(r); })
                           .map(function (r) { return r.split('/').slice(-2)[0]; });
        var entityFile = REL.filter(function (r) { return /entities\/.*\.js$/.test(r); })[0];
        var entityName = nodePath.basename(entityFile, '.js');
        sqlDirs.forEach(function (d) { assert.equal(d, entityName); });
    });
});


describe('04 - sqlite fixture: the entity + controller', function () {

    var entitySrc = FIXTURE[MODEL_DIR + '/entities/' + CONT.DB_ENTITY + '.js'];
    var ctrlSrc   = FIXTURE['controllers/controller.' + CONT.DB_NS + '.js'];

    it('the entity source is syntactically valid', function () {
        assert.doesNotThrow(function () { new vm.Script(entitySrc); });
    });

    it('the entity class name starts uppercase', function () {
        // lib/model.js throws "Entity Class `x` should start with an uppercase !"
        assert.match(entitySrc, /function\s+[A-Z]\w*Entity\s*\(/);
        assert.match(entitySrc, /module\.exports\s*=/);
    });

    it('the controller source is syntactically valid', function () {
        assert.doesNotThrow(function () { new vm.Script(ctrlSrc); });
    });

    it('the controller defines the action the routing rule dispatches', function () {
        assert.ok(ctrlSrc.indexOf('this.' + CONT.DB_ACTION + ' = ') > -1,
            'controller must define this.' + CONT.DB_ACTION);
    });

    it('the controller reaches the entity by its registered lowercase-first key', function () {
        // MEASURED in a live container run: getModel() exposes
        // ["_connection","getConnection","probeEntity","probe"] — the short alias
        // is the class name minus the `Entity` suffix (lib/model.js updateModel).
        assert.ok(ctrlSrc.indexOf("getModel('" + CONT.DB_ENTRY + "')") > -1);
        assert.ok(ctrlSrc.indexOf('db.' + CONT.DB_ENTITY + '.insert(') > -1);
        assert.ok(ctrlSrc.indexOf('db.' + CONT.DB_ENTITY + '.findByToken(') > -1);
    });

    it('does NOT pass a status code to renderJSON', function () {
        // renderJSON(jsonObj) takes ONE argument (core/controller/controller.js);
        // a second arg is silently ignored, so a "500" would still return 200.
        assert.doesNotMatch(ctrlSrc, /renderJSON\([^)]*\}\s*,\s*\d{3}\s*\)/);
    });

    it('reports the driver + file so the gate has positive evidence', function () {
        assert.ok(ctrlSrc.indexOf('conn.constructor') > -1, 'reports the resolved driver name');
        assert.ok(ctrlSrc.indexOf('conn._file') > -1, 'reports the opened database path');
        assert.ok(ctrlSrc.indexOf('readBack') > -1, 'reports the value read back out of the DB');
    });

    it('dumps the model keys on failure so a contract move is self-diagnosing', function () {
        assert.ok(ctrlSrc.indexOf('modelKeys') > -1);
    });
});


describe('05 - sqlite fixture: the routing rule', function () {

    var rule = CONT.sqliteRoutingRule();

    it('declares exactly one rule, named after the route', function () {
        assert.deepEqual(Object.keys(rule), [CONT.DB_ROUTE]);
    });

    it('is a GET whose url segment matches the route name', function () {
        assert.equal(rule[CONT.DB_ROUTE].method, 'GET');
        assert.equal(rule[CONT.DB_ROUTE].url, '/' + CONT.DB_ROUTE);
    });

    it('names a namespace that matches the controller filename', function () {
        // Without `namespace` the router loads controllers/controller.js, whose
        // scaffold declares no actions at all — the route would 500.
        assert.equal(rule[CONT.DB_ROUTE].namespace, CONT.DB_NS);
        assert.ok(FIXTURE['controllers/controller.' + CONT.DB_NS + '.js'],
            'a controller file must exist for the declared namespace');
    });

    it('dispatches param.control to the action the controller defines', function () {
        assert.equal(rule[CONT.DB_ROUTE].param.control, CONT.DB_ACTION);
    });
});


describe('06 - sqlite fixture: wiring constants', function () {

    it('the fixture bundle is actually scaffolded by the smoke', function () {
        assert.ok(CONT.BUNDLES.indexOf(CONT.DB_BUNDLE) > -1,
            'DB_BUNDLE must be in BUNDLES or the fixture is written to a bundle that never boots');
    });

    it('accepts BOTH driver names so the bun adapter self-retiring is not a false red', function () {
        // `DatabaseSync` = node:sqlite native; `BunDatabaseSync` = the bun:sqlite
        // adapter. If Bun ever ships node:sqlite the seam returns the native class
        // under Bun too — pinning the adapter name would go red exactly then.
        assert.deepEqual(CONT.DB_DRIVERS.slice().sort(), ['BunDatabaseSync', 'DatabaseSync']);
    });
});


describe('07 - readConfigJSON (the routing.json merge instrument)', function () {

    var scaffolded = [
        '// bundle needs to be restarted on changes !!',
        '{',
        '  "$schema": "https://gina.io/schema/routing.json",',
        '  "homepage": { "namespace": "content", "url": "/", "method": "GET", "param": { "control": "home" } }',
        '}'
    ].join('\n');

    var tmp = nodePath.join(require('os').tmpdir(), 'gina-readconfig-probe.json');

    it('strips the leading // comment the scaffold ships', function () {
        require('fs').writeFileSync(tmp, scaffolded);
        var parsed = CONT.readConfigJSON(tmp);
        assert.equal(parsed.homepage.param.control, 'home');
    });

    it('preserves the https:// inside values (only FULL-LINE comments go)', function () {
        var parsed = CONT.readConfigJSON(tmp);
        assert.equal(parsed.$schema, 'https://gina.io/schema/routing.json');
    });

    it('control — plain JSON.parse THROWS on the same input', function () {
        // Proves the stripper is load-bearing rather than decorative.
        assert.throws(function () { JSON.parse(scaffolded); }, SyntaxError);
        require('fs').unlinkSync(tmp);
    });
});
