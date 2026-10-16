/**
 * #B893 — a couchbase connectors.json entry without `scope` must fall back to NODE_SCOPE.
 *
 * The defect. `connector.v{3,4}.js` `init()` merged the connector's own defaults into
 * the object it was given — `merge()` writes into its first argument — and that object
 * is the connectors.json entry the model layer shares (`core/model/index.js` hands the
 * connector `self.getConfig(_connector)`). One of those defaults is the SDK's collections
 * scope, `scope: '_default'`, which the connector never uses; but `lib/model.js` then
 * passes the entry's `scope` to the couchbase factory as the DATA scope, where a set
 * value wins over NODE_SCOPE (`resolveScope()`). So an entry without `scope` scoped its
 * entities to `_default`, and every query filtered on `_scope = $scope` missed the
 * documents stamped with the bundle's scope. Measured end to end on develop 1de78a19b
 * (the gina-starter stack): `entityScope` `_default` with NODE_SCOPE `local`, 0 of 3
 * documents found; with `"scope": "local"` on the entry, `local`, 3 of 3.
 *
 * The fix: `init()` merges the defaults into a COPY, so the entry is never changed; the
 * keep-alive ping's reconnect hands `connect()` that same copy (it used to pass the
 * constructor's own argument, the entry); and the factory logs, for each connector,
 * the data scope its entities use and where it came from.
 *
 * What each arm exists for:
 *   §01 controls       — a boot succeeds and settles once, and an explicit `scope` on the
 *                        entry stays as set (the firing control for §02's reading).
 *   §02 the fix        — after `init()`, an entry without `scope` still has none, and
 *                        no key at all was written into it (v3 and v4).
 *   §03 the copy       — the connector still runs with its defaults: the options it hands
 *                        the SDK are a distinct object that carries them.
 *   §04 ping reconnect — a reconnect started by the keep-alive ping hands the SDK the same
 *                        merged options and writes nothing into the entry.
 *   §05 boot line      — the factory logs the data scope and its source, for an entry with
 *                        `scope` and for one without; the entities' `_scope` matches.
 *
 * Harness notes (mirrors test/core/couchbase-boot-deadline.test.js and
 * test/core/couchbase-b608.test.js):
 *   - The SDK is a PROJECT-side require, so planting `<TMP>/node_modules/couchbase/` is
 *     the seam; one stub serves both the connector arms (`connect`) and the factory
 *     arms (`QueryScanConsistency`).
 *   - `connector.v*.js` read `lib.logger` / `lib.merge` / `lib.Model` from `core/gna`,
 *     stubbed here with the REAL `lib/merge`, so §02 measures the real merge semantics.
 *   - The factory binds `console` to the framework's own `lib.logger`
 *     (`couchbase/index.js:16`), so §05 records that logger's `info()`.
 *   - Timers are mocked in §01–§04: the ping arms a 2-minute interval on every connect.
 *   - §04's SDK records the reconnect and never completes it: on v3, completing it runs
 *     the post-reconnect `onPing` chain, which calls an Error as a callback after the
 *     test has ended (a pre-existing defect, #B899, outside this fix).
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

// ─── throwaway project: one SDK stub for both harnesses, one entity ──────────
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b893-'));
fs.mkdirSync(path.join(TMP, 'node_modules/couchbase'), { recursive: true });
fs.writeFileSync(
    path.join(TMP, 'node_modules/couchbase/index.js'),
    "module.exports = {\n" +
    "    QueryScanConsistency: { NotBounded: 'not_bounded', RequestPlus: 'request_plus' },\n" +
    "    Cluster: function Cluster(url) { this.url = url; },\n" +
    "    connect: function connect(url, opts, cb) { return global.__B893_CONNECT__(url, opts, cb); }\n" +
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

// ─── context wiring (an unwired getConfig() makes init() settle with an error) ─
var BUNDLE = 'b893bundle';
var ENV    = 'dev';
setContext('__mock__', { config: function() { return { bundle: BUNDLE }; } });
setContext('bundle', BUNDLE);
setContext('env', ENV);
setContext('gina', {
    config: {
        envConf: (function() {
            var e = {}; e[BUNDLE] = {};
            // a nonexistent modelsPath keeps onConnect() short
            e[BUNDLE][ENV] = { modelsPath: path.join(TMP, 'no/such/models') };
            return e;
        })()
    }
});

var FILES = {
    v4: path.join(FW, 'core/connectors/couchbase/lib/connector.v4.js'),
    v3: path.join(FW, 'core/connectors/couchbase/lib/connector.v3.js')
};

/**
 * A connectors.json couchbase entry, as the model layer hands it to the connector.
 *
 * @inner
 * @param {object} [extra] - keys to add (e.g. `{ scope: 'beta' }`)
 * @returns {object}
 */
function entryFor(extra) {
    var d = {
        connector: 'couchbase', database: 'db', protocol: 'couchbase://',
        host: '127.0.0.1', username: 'u', password: 'p'
    };
    for (var k in (extra || {})) d[k] = extra[k];
    return d;
}

/** Let queued microtasks run; timers stay mocked. @inner @param {number} [n=6] */
async function flush(n) {
    for (var i = 0; i < (n || 6); i++) await Promise.resolve();
}

/**
 * An SDK `connect` that succeeds and records the options object it was handed.
 * With `settleCalls`, only the first N calls complete; a later one is recorded and
 * then never settles, so the connector stops there (§04: what matters is what the
 * reconnect hands the SDK, and on v3 the post-reconnect `onPing` chain throws a
 * pre-existing « cb is not a function » after the test ends — #B899).
 *
 * @inner
 * @param {Array<{url: string, opts: object}>} calls - receives one record per call
 * @param {number} [settleCalls] - how many calls complete (default: all)
 * @returns {function}
 */
function recordingSdk(calls, settleCalls) {
    return function(url, opts, cb) {
        calls.push({ url: url, opts: opts });
        if ( typeof(settleCalls) == 'number' && calls.length > settleCalls ) {
            return new Promise(function() {});
        }
        var conn = {
            bucket: function() { return { name: 'b', defaultCollection: function() { return {}; } }; },
            query: function() {}, close: function() {}
        };
        queueMicrotask(function() { cb(null, conn); });
        return Promise.resolve(conn);
    };
}

/**
 * Boots a connector as `core/model/index.js` does: `.on('ready')`, then `onReady()`,
 * which runs `init()`.
 *
 * @inner
 * @param {function} Connector
 * @param {object} entry - the connectors.json entry object
 * @returns {{c: object, once: Array<{err: *, inst: *}>}}
 */
function boot(Connector, entry) {
    var c = new Connector(entry);
    var once = [];
    c.on('ready', function() {});
    c.onReady(function(err, inst) { once.push({ err: err, inst: inst }); });
    return { c: c, once: once };
}

/** Keys the run added to an entry, compared with its keys before. @inner */
function addedKeys(entry, before) {
    return Object.keys(entry).filter(function(k) { return before.indexOf(k) < 0; }).sort();
}

after(function() {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
});


// ─── 01 — controls ───────────────────────────────────────────────────────────
describe('01 - controls: a boot succeeds, and an explicit scope stays as set', function() {

    Object.keys(FILES).forEach(function(v) {
        it(v + ': the boot settles once with an instance; scope "beta" on the entry is kept', async function(t) {
            t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
            try {
                var calls = [];
                global.__B893_CONNECT__ = recordingSdk(calls);
                var entry = entryFor({ scope: 'beta' });
                var b = boot(require(FILES[v]), entry);
                await flush();

                assert.equal(b.once.length, 1, 'the onReady consumer settled exactly once');
                assert.ok(!b.once[0].err, 'no error: ' + (b.once[0].err && b.once[0].err.message));
                assert.ok(b.once[0].inst, 'an instance was delivered');
                assert.equal(calls.length, 1, 'the SDK was reached exactly once');
                assert.equal(entry.scope, 'beta', 'an explicit scope on the entry is never overwritten');
                try { clearInterval(b.c.pingId); } catch (e) {}
            } finally {
                t.mock.timers.reset();
            }
        });
    });
});


// ─── 02 — the fix: init() writes nothing into the entry ──────────────────────
describe('02 - #B893: an entry without scope keeps none after init()', function() {

    Object.keys(FILES).forEach(function(v) {
        it(v + ': no scope appears on the entry, and no other key is written into it', async function(t) {
            t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
            try {
                var calls = [];
                global.__B893_CONNECT__ = recordingSdk(calls);
                var entry = entryFor();
                var before = Object.keys(entry);
                var b = boot(require(FILES[v]), entry);
                await flush();

                assert.equal(b.once.length, 1, 'the boot settled (the reading below is after init() ran)');
                assert.equal('scope' in entry, false,
                    'the entry has no scope, so lib/model.js hands the factory none and NODE_SCOPE applies'
                    + ' (got scope ' + JSON.stringify(entry.scope) + ')');
                assert.deepEqual(addedKeys(entry, before), [], 'init() wrote these keys into the shared entry');
                try { clearInterval(b.c.pingId); } catch (e) {}
            } finally {
                t.mock.timers.reset();
            }
        });
    });
});


// ─── 03 — the connector still runs with its defaults ─────────────────────────
describe('03 - #B893: the options the connector hands the SDK are a merged copy', function() {

    Object.keys(FILES).forEach(function(v) {
        it(v + ': a distinct object carrying the defaults, the inert collections ones included', async function(t) {
            t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
            try {
                var calls = [];
                global.__B893_CONNECT__ = recordingSdk(calls);
                var entry = entryFor();
                var b = boot(require(FILES[v]), entry);
                await flush();

                assert.equal(calls.length, 1, 'the SDK was reached once');
                var opts = calls[0].opts;
                assert.notStrictEqual(opts, entry, 'the SDK options are a copy, not the shared entry');
                assert.equal(opts.keepAlive, true, 'keepAlive default');
                assert.equal(opts.pingInterval, '2m', 'pingInterval default');
                assert.equal(opts.readyTimeout, 50000, 'readyTimeout default');
                assert.equal(opts.database, 'db', 'the entry\'s own keys are in the copy');
                // architecture/connectors.md § 21: the collections defaults stay, used by nothing
                assert.equal(opts.scope, '_default', 'the SDK collections scope default stays in the connector\'s own options');
                try { clearInterval(b.c.pingId); } catch (e) {}
            } finally {
                t.mock.timers.reset();
            }
        });
    });
});


// ─── 04 — a ping-started reconnect passes the same merged options ────────────
describe('04 - #B893: a reconnect started by the keep-alive ping uses the merged copy', function() {

    Object.keys(FILES).forEach(function(v) {
        it(v + ': the second SDK call carries the defaults, and the entry stays untouched', async function(t) {
            t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
            try {
                var calls = [];
                global.__B893_CONNECT__ = recordingSdk(calls, 1); // the reconnect is recorded, not completed
                var entry = entryFor();
                var before = Object.keys(entry);
                var b = boot(require(FILES[v]), entry);
                await flush();
                assert.equal(calls.length, 1, 'the boot reached the SDK once');
                assert.ok(b.c.instance && b.c.instance.connected === true, 'the boot left the instance connected');

                b.c.instance.connected = false;      // the ping's reconnect condition
                t.mock.timers.tick(2 * 60 * 1000);   // pingInterval "2m"
                await flush(12);

                assert.equal(calls.length, 2, 'the ping started exactly one reconnect');
                assert.equal(calls[1].opts.keepAlive, true, 'the reconnect hands the SDK the merged options');
                assert.equal(calls[1].opts.pingInterval, '2m', 'the reconnect hands the SDK the merged options');
                assert.deepEqual(addedKeys(entry, before), [], 'the reconnect wrote these keys into the shared entry');
                try { clearInterval(b.c.pingId); } catch (e) {}
            } finally {
                t.mock.timers.reset();
            }
        });
    });
});


// ─── 05 — the factory says which data scope it resolved, and from where ──────
describe('05 - #B893: the factory logs each connector\'s data scope and its source', function() {

    /**
     * Builds the couchbase factory as lib/model.js does, recording the framework
     * logger's info() lines while it runs.
     *
     * @inner
     * @param {object} infos - `{ database, model, bundle[, scope] }`
     * @returns {{entities: object, lines: string[]}}
     */
    function buildFactory(infos) {
        var fwLib  = require(FW + '/lib');
        var logger = fwLib.logger;
        var saved  = logger.info;
        var lines  = [];
        logger.info = function() { lines.push(Array.prototype.join.call(arguments, ' ')); };
        try {
            var Couchbase = require(path.join(FW, 'core/connectors/couchbase/index.js'));
            var conn = { sdk: { version: 4 }, _cluster: { query: function() { return Promise.resolve({ rows: [], meta: {} }); } } };
            return { entities: new Couchbase(conn, infos), lines: lines };
        } finally {
            logger.info = saved;
        }
    }

    it('scope on the entry: logs `beta`, from connectors.json "scope"; the entities use beta', function() {
        var r = buildFactory({ database: 'db', model: 'withscope', bundle: 'b893bundle', scope: 'beta' });
        var hit = r.lines.filter(function(l) { return /data scope/.test(l); });
        assert.equal(hit.length, 1, 'exactly one data-scope line (got: ' + JSON.stringify(r.lines) + ')');
        assert.match(hit[0], /data scope: `beta` \(from connectors\.json "scope"\)/, 'names the scope and its source');
        assert.match(hit[0], /\[ withscope \]/, 'names the connector');
        assert.match(hit[0], /\[ b893bundle \]/, 'names the bundle');
        assert.equal(r.entities.Thing.prototype._scope, 'beta', 'the entities use the entry\'s scope');
    });

    it('no scope on the entry: logs NODE_SCOPE\'s value, from NODE_SCOPE; the entities use it', function() {
        var savedScope = process.env.NODE_SCOPE;
        process.env.NODE_SCOPE = 'local';
        try {
            var r = buildFactory({ database: 'db', model: 'noscope', bundle: 'b893bundle' });
            var hit = r.lines.filter(function(l) { return /data scope/.test(l); });
            assert.equal(hit.length, 1, 'exactly one data-scope line (got: ' + JSON.stringify(r.lines) + ')');
            assert.match(hit[0], /data scope: `local` \(from NODE_SCOPE\)/, 'names the scope and its source');
            assert.equal(r.entities.Thing.prototype._scope, 'local', 'the entities fall back to NODE_SCOPE');
        } finally {
            if (savedScope === undefined) delete process.env.NODE_SCOPE; else process.env.NODE_SCOPE = savedScope;
        }
    });
});
