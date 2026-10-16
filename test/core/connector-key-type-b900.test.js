/**
 * #B900 / #D61 — a connectors.json entry with no `connector` field takes its
 * type from its key when the key names a built-in connector type.
 *
 * `gina connector:add <name>` leaves `connector` out when the type equals the
 * name, the connectors schema calls the field "required when the key name does
 * not match a built-in connector name", and `connector:list` resolves the type
 * the same way, but the runtime read only `connectors[name].connector`: such an
 * entry stopped the bundle at boot with « [MODEL][<name>] No connector found ».
 * Since 0.7.5 core/config.js fills the field from the key where it finalises a
 * bundle's connectors, through lib/connector-config's applyKeyTypes(); a set
 * `connector` always wins, and a key that names no type is left alone.
 *
 * Part 1 drives applyKeyTypes() directly. Part 2 boots real bundles: the REAL
 * bin/cli scaffolds a project in a throwaway home (HOME pinned, GINA_HOMEDIR
 * removed), then the REAL bin/gina-container boots it once per shape of the
 * bundle's connectors.json:
 *   A — `{ "sqlite": { "database": … } }`, no `connector` field;
 *   B — the entry `gina connector:add sqlite <bundle> @<project>` writes;
 *   C — `{ "redis": { "connector": "sqlite", … } }`: the field beats the key;
 *   D — `{ "myDb": { "database": … } }`: a key that names no type still fails.
 * A, B and C must bind, answer 200 and create their SQLite file under the
 * throwaway gina home (the SQLite connector opened it); D must exit 1 with
 * « [MODEL][myDb] No connector found ».
 *
 * Module-path seam: GINA_B900_TREE points the test at another tree (a
 * `git archive` copy of the pre-fix tree, its node_modules linked per entry
 * with node_modules/gina pointing at that copy) for the red-first run.
 *
 * Run: node --test test/core/connector-key-type-b900.test.js
 */
'use strict';

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var https  = require('https');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync, spawn } = require('child_process');

var TREE      = process.env.GINA_B900_TREE || path.resolve(__dirname, '..', '..');
var FW        = path.join(TREE, 'framework', 'v' + require(path.join(TREE, 'package.json')).version);
var CLI       = path.join(TREE, 'bin', 'cli');
var CONTAINER = path.join(TREE, 'bin', 'gina-container');

var TMP        = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b900-'));
var GINA_HOME  = path.join(TMP, '.gina');
var PROJ       = 'b900' + String(Date.now()).slice(-6);
var BUNDLE     = 'app';
var PROJ_DIR   = path.join(TMP, 'proj');
var CONN_FILE  = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'connectors.json');
var PORT_START = 12500;

var BOOT_TIMEOUT_MS  = 20000;
var POLL_INTERVAL_MS = 250;

var CHILD_ENV = Object.assign({}, process.env, { HOME: TMP, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;   // the home must derive from HOME, not inherit the runner's
delete CHILD_ENV.NODE_ENV;       // `bun test` injects NODE_ENV=test, and a non-dev env makes
                                 // gina-container look for a release build; the project's def_env applies


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves true when something accepts a TCP connection on the port.
 *
 * @inner
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortOpen(port) {
    return new Promise(function (resolve) {
        var sock = new net.Socket();
        sock.setTimeout(800);
        sock.on('connect', function () { sock.destroy(); resolve(true); });
        sock.on('error',   function () { resolve(false); });
        sock.on('timeout', function () { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
    });
}

/**
 * Waits the given time.
 *
 * @inner
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * One GET against the booted bundle.
 *
 * @inner
 * @param {string} scheme - `http` or `https`
 * @param {number} port
 * @param {string} reqPath
 * @returns {Promise<{status: (number|null), body: string}>}
 */
function httpGet(scheme, port, reqPath) {
    var lib = (scheme === 'https') ? https : http;
    return new Promise(function (resolve) {
        var req = lib.request({
            host: '127.0.0.1', port: port, path: reqPath, method: 'GET', rejectUnauthorized: false
        }, function (res) {
            var body = '';
            res.on('data', function (chunk) { body += chunk; });
            res.on('end',  function () { resolve({ status: res.statusCode, body: body }); });
        });
        req.on('error', function (e) { resolve({ status: null, body: 'request error: ' + e.message }); });
        req.end();
    });
}

/**
 * Runs an offline bin/cli command against the throwaway home. Its exit code is
 * not trusted (the first-run home bootstrap can exit non-zero on a benign MQ
 * teardown); callers check the files the command writes.
 *
 * @inner
 * @param {string[]} args
 * @returns {{status: (number|null), out: string}}
 */
function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/**
 * Parses a gina config file, dropping full-line `//` comments (an `https://`
 * inside a string value is kept).
 *
 * @inner
 * @param {string} file
 * @returns {object}
 */
function readConfig(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').split('\n').filter(function (l) {
        return !/^\s*\/\//.test(l);
    }).join('\n'));
}

/**
 * Boots the bundle with the REAL gina-container, waits until it binds its port
 * or exits, GETs the webroot when it bound, then stops it and waits for the
 * port to close.
 *
 * @inner
 * @param {{port: number, scheme: string, webroot: string}} target
 * @returns {Promise<{bound: boolean, exit: (object|null), get: (object|null), out: string}>}
 */
async function boot(target) {
    var out = '';
    var exit = null;
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], {
        env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { out += d; });
    child.on('exit', function (code, signal) { exit = { code: code, signal: signal }; });

    var bound = false;
    var deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await isPortOpen(target.port)) { bound = true; break; }
        if (exit) break;
        await sleep(POLL_INTERVAL_MS);
    }
    // a bundle that exits on a model error can do so a moment after its exit
    // code is known; give its output a beat to drain
    if (!bound) await sleep(300);

    var get = bound ? await httpGet(target.scheme, target.port, target.webroot) : null;

    if (!exit) {
        try { child.kill('SIGTERM'); } catch (e) { /* already gone */ }
        var until = Date.now() + 4000;
        while (!exit && Date.now() < until) await sleep(100);
        if (!exit) { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }
    }
    var closedBy = Date.now() + 5000;
    while (Date.now() < closedBy && await isPortOpen(target.port)) await sleep(100);

    return { bound: bound, exit: exit, get: get, out: out };
}

/**
 * Renders a boot result for an assertion message.
 *
 * @inner
 * @param {object} r - A boot() result
 * @returns {string}
 */
function detail(r) {
    if (!r) return '\n  (arm did not run)';
    return '\n  bound=' + r.bound + ' exit=' + JSON.stringify(r.exit) +
        ' get=' + JSON.stringify(r.get) + '\n  output tail: ' + String(r.out).slice(-1200);
}


// ---------------------------------------------------------------------------
// Part 1 — applyKeyTypes()
// ---------------------------------------------------------------------------

describe('#B900 part 1 - lib/connector-config applyKeyTypes()', function () {

    var connectorConfig = require(path.join(FW, 'lib', 'connector-config'));
    var TYPES = ['couchbase', 'redis', 'mysql', 'postgresql', 'mongodb', 'scylladb', 'duckdb', 'sqlite', 'ai'];

    it('is exported as a function', function () {
        assert.equal(typeof connectorConfig.applyKeyTypes, 'function');
    });

    it('gives an entry with no `connector` the type its key names, and lists that key', function () {
        var connectors = { couchbase: { database: 'myapp' } };
        var applied = connectorConfig.applyKeyTypes(connectors, TYPES);
        assert.equal(connectors.couchbase.connector, 'couchbase');
        assert.deepEqual(applied, ['couchbase']);
    });

    it('fills every built-in type it is given', function () {
        var connectors = {};
        TYPES.forEach(function (t) { connectors[t] = {}; });
        var applied = connectorConfig.applyKeyTypes(connectors, TYPES);
        TYPES.forEach(function (t) { assert.equal(connectors[t].connector, t, t); });
        assert.deepEqual(applied.slice().sort(), TYPES.slice().sort());
    });

    it('leaves a set `connector` as it is, even when the key names another type', function () {
        var connectors = { redis: { connector: 'sqlite', database: 'x' } };
        var applied = connectorConfig.applyKeyTypes(connectors, TYPES);
        assert.equal(connectors.redis.connector, 'sqlite');
        assert.deepEqual(applied, []);
    });

    it('leaves an entry alone when its key names no type', function () {
        var connectors = { myDb: { database: 'x' }, session: { file: ':memory:' } };
        var applied = connectorConfig.applyKeyTypes(connectors, TYPES);
        assert.equal(Object.prototype.hasOwnProperty.call(connectors.myDb, 'connector'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(connectors.session, 'connector'), false);
        assert.deepEqual(applied, []);
    });

    it('fills an empty or null `connector`, as `entry.connector || key` does in the CLI', function () {
        var connectors = { sqlite: { connector: '', database: 'a' }, redis: { connector: null } };
        var applied = connectorConfig.applyKeyTypes(connectors, TYPES);
        assert.equal(connectors.sqlite.connector, 'sqlite');
        assert.equal(connectors.redis.connector, 'redis');
        assert.deepEqual(applied.slice().sort(), ['redis', 'sqlite']);
    });

    it('skips `$schema` and every value that is not a plain object', function () {
        var connectors = { $schema: 'https://gina.io/schema/connectors.json', sqlite: 'x', redis: null, ai: ['a'] };
        var before = JSON.stringify(connectors);
        var applied = connectorConfig.applyKeyTypes(connectors, TYPES);
        assert.equal(JSON.stringify(connectors), before);
        assert.deepEqual(applied, []);
    });

    it('returns an empty list, and throws nothing, on missing or malformed arguments', function () {
        assert.deepEqual(connectorConfig.applyKeyTypes(undefined, TYPES), []);
        assert.deepEqual(connectorConfig.applyKeyTypes(null, TYPES), []);
        assert.deepEqual(connectorConfig.applyKeyTypes({ sqlite: {} }, undefined), []);
        assert.deepEqual(connectorConfig.applyKeyTypes({ sqlite: {} }, 'sqlite'), []);
    });
});


// ---------------------------------------------------------------------------
// Part 2 — real boots
// ---------------------------------------------------------------------------

describe('#B900 part 2 - a bundle boots with an entry keyed by its connector type', function () {

    var skip = (process.platform === 'win32') ? 'gina-container is Unix-centric' : null;
    var setupError = null;
    var target = null;
    var addOut = '';
    var addedEntry = null;
    var arms = {};

    before(async function () {
        if (skip) return;
        fs.mkdirSync(PROJ_DIR, { recursive: true });

        runCli(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
        var projectsFile = path.join(GINA_HOME, 'projects.json');
        if (!fs.existsSync(projectsFile) || !readConfig(projectsFile)[PROJ]) {
            setupError = 'project:add did not register @' + PROJ;
            return;
        }
        runCli(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
        var reverseFile = path.join(GINA_HOME, 'ports.reverse.json');
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(reverseFile) || !readConfig(reverseFile)[key]) {
            setupError = 'bundle:add did not register ' + key;
            return;
        }

        var pe = readConfig(projectsFile)[PROJ];
        var env = pe.def_env || 'dev';
        var scheme = pe.def_scheme || 'http';
        var port = null;
        try { port = readConfig(reverseFile)[key][env][pe.def_protocol][scheme]; } catch (e) { port = null; }
        if (!port) { setupError = 'could not resolve the port of ' + key; return; }
        var webroot = '/' + BUNDLE + '/';
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            webroot = ((ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE)).replace(/\/+$/, '') + '/';
        } catch (e) { /* the scaffold default */ }
        target = { port: port, scheme: scheme, webroot: webroot };

        var scaffold = fs.readFileSync(CONN_FILE, 'utf8');
        var write = function (entries) {
            fs.writeFileSync(CONN_FILE, JSON.stringify(Object.assign({
                $schema: 'https://gina.io/schema/connectors.json'
            }, entries), null, 4) + '\n');
        };

        write({ sqlite: { database: 'b900a' } });
        arms.A = await boot(target);

        fs.writeFileSync(CONN_FILE, scaffold);
        addOut = runCli(['connector:add', 'sqlite', BUNDLE, '@' + PROJ, '--database=b900b']).out;
        try { addedEntry = readConfig(CONN_FILE).sqlite || null; } catch (e) { addedEntry = null; }
        arms.B = await boot(target);

        write({ redis: { connector: 'sqlite', database: 'b900c' } });
        arms.C = await boot(target);

        write({ myDb: { database: 'b900d' } });
        arms.D = await boot(target);
    });

    after(function () {
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* best effort */ }
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    it('scaffolds the project and resolves its port', function (t) {
        if (skip) return t.skip(skip);
        assert.equal(setupError, null, setupError);
    });

    it('A - an entry keyed `sqlite` with no `connector` field: the bundle boots, answers 200 and opens its SQLite file', function (t) {
        if (skip) return t.skip(skip);
        var r = arms.A;
        assert.ok(r && r.bound, 'the bundle did not bind' + detail(r));
        assert.equal(r.get && r.get.status, 200, detail(r));
        assert.ok(fs.existsSync(path.join(GINA_HOME, 'b900a.sqlite')), 'no b900a.sqlite in the gina home' + detail(r));
        assert.doesNotMatch(r.out, /No connector found/, detail(r));
    });

    it('B - `gina connector:add sqlite <bundle>` writes no `connector` field, and the bundle boots with that entry', function (t) {
        if (skip) return t.skip(skip);
        assert.ok(addedEntry, 'connector:add wrote no `sqlite` entry:\n' + addOut);
        assert.equal(addedEntry.database, 'b900b', JSON.stringify(addedEntry));
        assert.equal(Object.prototype.hasOwnProperty.call(addedEntry, 'connector'), false, JSON.stringify(addedEntry));
        var r = arms.B;
        assert.ok(r && r.bound, 'the bundle did not bind' + detail(r));
        assert.equal(r.get && r.get.status, 200, detail(r));
        assert.ok(fs.existsSync(path.join(GINA_HOME, 'b900b.sqlite')), 'no b900b.sqlite in the gina home' + detail(r));
    });

    it('C - a set `connector` beats the key: an entry keyed `redis` with `connector: sqlite` loads SQLite', function (t) {
        if (skip) return t.skip(skip);
        var r = arms.C;
        assert.ok(r && r.bound, 'the bundle did not bind' + detail(r));
        assert.equal(r.get && r.get.status, 200, detail(r));
        assert.ok(fs.existsSync(path.join(GINA_HOME, 'b900c.sqlite')), 'no b900c.sqlite in the gina home' + detail(r));
    });

    it('D - a key that names no type, with no `connector` field, still stops the boot', function (t) {
        if (skip) return t.skip(skip);
        var r = arms.D;
        assert.ok(r, 'arm D did not run');
        assert.equal(r.bound, false, 'the bundle bound' + detail(r));
        assert.equal(r.exit && r.exit.code, 1, detail(r));
        assert.match(r.out, /\[MODEL\]\[myDb\] No connector found/, detail(r));
        assert.equal(fs.existsSync(path.join(GINA_HOME, 'b900d.sqlite')), false, detail(r));
    });
});
