'use strict';
/**
 * #B432 — connector settlement parity: one contract, every fixed connector.
 *
 * A connector delivers its result by invoking a callback the CALLER supplied.
 * That callback is application code and can throw for reasons unrelated to the
 * query. Two shapes then ran it a SECOND time with a different payload:
 *
 *   sync   `try { cb(null, rows); } catch (e) { cb(e); }`
 *   async  `.then(function () { cb(null, rows); }).catch(function (e) { cb(e); })`
 *
 * Both delivered a success and then an error for one operation, so the
 * canonical `if (err) { return next(err); } render(data);` shape ran BOTH
 * branches — and the second call reported the caller's own exception as though
 * the database had failed.
 *
 * Shape of this file (the N-backend parity matrix):
 *   §01 harness controls  — the instrument can read CORRECT, and it can SEE a
 *                           double settle at all. Both must pass, or every
 *                           reading below is void.
 *   §02 the SPEC          — declared ONCE, run against every fixed connector.
 *                           Arms are labelled discriminating (red pre-fix) or
 *                           control (green pre-fix), because a tally of reds is
 *                           meaningless unless you know which bucket each is in.
 *   §03 broken backend    — the same spec run against a deliberately UNGUARDED
 *                           delivery, asserting the discriminating arms FAIL.
 *                           Without this, a spec every backend passes could be a
 *                           spec that asserts nothing.
 *   §04 source pins       — the guard is wired at each site, checked against
 *                           COMMENT-STRIPPED source so the fix's own prose
 *                           cannot satisfy a pin vacuously.
 *
 * Harness notes:
 *   - Boots the REAL connector against a controllable driver stub — the same
 *     approach as `couchbase-concurrency.test.js`. The connector is shipped
 *     bytes; only the driver is stubbed.
 *   - Calls the generated prototype method DIRECTLY rather than through the
 *     entity singleton. #B429 was about the shared singleton, so that test had
 *     to route through it; #B432 lives entirely in the per-call closure, so the
 *     prototype method is the honest unit and it keeps three connectors from
 *     colliding on one `EntitySuper` entry.
 *   - Callback arms CAPTURE EVERY invocation and hold a grace window before
 *     asserting. A resolve-on-first promise wrapper cannot observe a second
 *     settle — it is the defect's natural blind spot.
 *   - Every wait is BOUNDED, so a regression to a never-settling shape FAILS
 *     rather than hanging the gated suite.
 */

process.env.NODE_ENV_IS_DEV = 'false';

var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW   = path.resolve(require('../fw'));
var REPO = path.resolve(__dirname, '../..');

// ─── globals bootstrap (mirrors couchbase-concurrency.test.js) ───────────────
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
require('module').Module._initPaths();
require(FW + '/helpers');
setPath('gina', { core: path.join(FW, 'core') });

var ginaMain  = require.resolve(REPO);
var _inherits = require(FW + '/lib/inherits/src/main.js');
var _merge    = require(FW + '/lib/merge/src/main.js');
var ModelUtil = require(FW + '/lib/model');
if (!require.cache[ginaMain] || !require.cache[ginaMain].exports.lib) {
    require.cache[ginaMain] = {
        id: ginaMain, filename: ginaMain, loaded: true,
        exports: { lib: { logger: console, helpers: {}, inherits: _inherits, merge: _merge, Model: ModelUtil } }
    };
}

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b432-'));

/** Driver behaviour for the arm currently running. @type {{value:string}} */
var MODE = { value: 'ok' };

/** @inner @param {number} [ms=10] @returns {Promise<void>} */
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

/**
 * Capture EVERY invocation of a callback-style call, then settle after a grace
 * window so a SECOND (wrong) invocation is observable. A never-called callback
 * resolves `timedOut` rather than hanging the suite.
 *
 * @inner
 * @param {function(function)} run - receives the callback to hand the connector
 * @returns {Promise<{calls: Array<Array>, timedOut: boolean}>}
 */
function captureCalls(run) {
    return new Promise(function (resolve) {
        var calls = [];
        var guard = setTimeout(function () { resolve({ calls: calls, timedOut: true }); }, 3000);
        run(function () {
            calls.push(Array.prototype.slice.call(arguments));
            if (calls.length === 1) {
                setTimeout(function () { clearTimeout(guard); resolve({ calls: calls, timedOut: false }); }, 250);
            }
        });
    });
}

/**
 * Write a throwaway bundle for one connector and return its query-method handle.
 *
 * @inner
 * @param {object} b - backend descriptor
 * @returns {function} the generated prototype method (shipped bytes)
 */
function mount(b) {
    var root = path.join(TMP, b.name);
    fs.mkdirSync(path.join(root, 'bundle/models/db/entities'), { recursive: true });
    fs.mkdirSync(path.join(root, 'bundle/models/db/' + b.queryDir + '/thing'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bundle/models/db/entities/thing.js'),
        'function Thing(conn) {}\nmodule.exports = Thing;\n');
    fs.writeFileSync(path.join(root, 'bundle/models/db/' + b.queryDir + '/thing/getRecord' + b.queryExt), b.queryBody);
    setPath('project', root);
    setPath('bundle', path.join(root, 'bundle'));
    var Ctor = require(path.join(FW, b.src));
    var entities = new Ctor(b.conn, { database: 'db', model: 'model', bundle: 'bundle', scope: 'local' });
    assert.ok(entities.Thing, b.name + ': harness fault — the entity was not built');
    assert.equal(typeof entities.Thing.prototype.getRecord, 'function',
        b.name + ': harness fault — the query method was not attached');
    return entities.Thing.prototype.getRecord;
}

// ─── the three connectors fixed in this commit ───────────────────────────────
var BACKENDS = [
    {
        name: 'sqlite',
        src : 'core/connectors/sqlite/index.js',
        queryDir: 'sql', queryExt: '.sql',
        queryBody: '/**\n * @param {string} $key\n * @return {Array}\n */\nSELECT * FROM thing WHERE key = ?\n',
        conn: {
            prepare: function () {
                return {
                    all: function () { if (MODE.value === 'fail') { throw new Error('driver-boom'); } return [{ key: 'k1' }]; },
                    get: function () { if (MODE.value === 'fail') { throw new Error('driver-boom'); } return { key: 'k1' }; },
                    run: function () { if (MODE.value === 'fail') { throw new Error('driver-boom'); } return { changes: 1 }; }
                };
            }
        },
        self: { _collection: 'thing', _scope: 'local' }
    },
    {
        name: 'mongodb',
        src : 'core/connectors/mongodb/index.js',
        queryDir: 'pipelines', queryExt: '.json',
        queryBody: '/**\n * @param {string} arg0\n * @return {object}\n */\n{ "op": "findOne", "filter": { "key": { "$arg": 0 } } }\n',
        conn: {
            collection: function () {
                return {
                    findOne: function () {
                        return MODE.value === 'fail'
                            ? Promise.reject(new Error('driver-boom'))
                            : Promise.resolve({ key: 'k1' });
                    }
                };
            }
        },
        self: { _collection: 'thing', _scope: 'local' }
    },
    {
        name: 'scylladb',
        src : 'core/connectors/scylladb/index.js',
        queryDir: 'cql', queryExt: '.sql',
        queryBody: '/**\n * @param {string} ?\n * @return {Array}\n */\nSELECT * FROM thing WHERE key = ?\n',
        conn: {
            execute: function () {
                return MODE.value === 'fail'
                    ? Promise.reject(new Error('driver-boom'))
                    : Promise.resolve({ rows: [{ key: 'k1' }] });
            }
        },
        self: { _collection: 'thing', _scope: 'local' }
    }
];

/**
 * The settlement contract, declared ONCE. Each arm states its bucket:
 * `discriminating` arms go RED on the pre-fix bytes; `control` arms stay GREEN
 * both before and after, and exist to prove the harness reads correct behaviour.
 *
 * @type {Array<{name:string, bucket:string, run:function}>}
 */
var SPEC = [
    {
        name  : 'a callback that THROWS is invoked exactly once',
        bucket: 'discriminating',
        run   : async function (call) {
            MODE.value = 'ok';
            var r = await call(function () { throw new Error('cb-boom'); });
            assert.equal(r.timedOut, false, 'the callback must be invoked at all');
            assert.equal(r.calls.length, 1, 'a throwing callback must not be re-invoked');
        }
    },
    {
        name  : 'a throwing callback is never handed a fabricated query failure',
        bucket: 'discriminating',
        run   : async function (call) {
            MODE.value = 'ok';
            var seen = [];
            var r = await call(function (err) { seen.push(err); throw new Error('cb-boom'); });
            assert.equal(r.calls.length, 1);
            assert.ok(!(seen[0] instanceof Error),
                'the single settle is the SUCCESS; the caller\'s own throw must not come back as a query error');
        }
    },
    {
        name  : 'a FAILED query settles exactly once, carrying the error',
        bucket: 'control',
        run   : async function (call) {
            MODE.value = 'fail';
            var r = await call(function () {});
            MODE.value = 'ok';
            assert.equal(r.timedOut, false);
            assert.equal(r.calls.length, 1, 'a failed query must settle once');
            assert.ok(r.calls[0][0], 'the settle carries an error');
        }
    },
    {
        name  : 'a SUCCESSFUL query settles exactly once',
        bucket: 'control',
        run   : async function (call) {
            MODE.value = 'ok';
            var r = await call(function () {});
            assert.equal(r.timedOut, false);
            assert.equal(r.calls.length, 1, 'a successful query must settle once');
            assert.ok(!r.calls[0][0], 'success reports no error');
        }
    }
];

// ─── §01 harness controls ────────────────────────────────────────────────────
describe('01 - harness controls (an instrument that cannot fail is not one)', function () {

    it('captureCalls SEES a second invocation', async function () {
        var r = await captureCalls(function (cb) { cb(null, 1); cb(new Error('second')); });
        assert.equal(r.calls.length, 2, 'the harness must be able to observe a double settle');
    });

    it('captureCalls reads a single invocation as one', async function () {
        var r = await captureCalls(function (cb) { cb(null, 1); });
        assert.equal(r.calls.length, 1);
        assert.equal(r.timedOut, false);
    });

    it('captureCalls FAILS (does not hang) when the callback is never invoked', async function () {
        var r = await captureCalls(function () {});
        assert.equal(r.timedOut, true, 'a never-settling shape must time out, not hang the suite');
    });
});

// ─── §02 the spec, against every fixed connector ─────────────────────────────
BACKENDS.forEach(function (b) {
    describe('02 - settlement parity [' + b.name + ']', function () {

        var method;
        before(function () { method = mount(b); });

        SPEC.forEach(function (arm) {
            it(arm.name + '  (' + arm.bucket + ')', async function () {
                await arm.run(function (userCb) {
                    return captureCalls(function (cb) {
                        method.call(b.self, 'k1', function () {
                            cb.apply(null, arguments);
                            userCb.apply(null, arguments);
                        });
                    });
                });
            });
        });
    });
});

// ─── §03 broken backend — proves the discriminating arms discriminate ────────
describe('03 - the spec run against an UNGUARDED delivery must FAIL', function () {

    /**
     * A faithful replica of the PRE-fix delivery shape: the callback is invoked
     * inside a `try`, and the `catch` invokes it again. Nothing here is shipped
     * code — its only job is to prove the spec's arms can go red.
     *
     * @inner
     * @param {function} cb - the caller's callback
     * @returns {void}
     */
    function unguardedDelivery(cb) {
        try {
            cb(null, [{ key: 'k1' }]);
        } catch (e) {
            cb(new Error('[ replica ] ' + e.message));
        }
    }

    /**
     * Throw on the FIRST invocation only. A callback that throws every time makes
     * the replay's own throw escape `unguardedDelivery` and reject the capture
     * promise before any assertion runs — which reads as a failing control while
     * actually measuring the harness. Throwing once keeps the second (wrong)
     * settle observable, which is the whole point of this section.
     *
     * @inner
     * @param {function} cb - the capture sink
     * @returns {function} a callback that throws exactly once
     */
    function throwsOnce(cb) {
        var n = 0;
        return function () {
            cb.apply(null, arguments);
            if (++n === 1) { throw new Error('cb-boom'); }
        };
    }

    it('the throwing-callback arm goes RED on an unguarded delivery', async function () {
        var r = await captureCalls(function (cb) { unguardedDelivery(throwsOnce(cb)); });
        assert.equal(r.calls.length, 2,
            'the unguarded shape MUST invoke the callback twice — if it does not, the arms above assert nothing');
    });

    it('the second (wrong) settle carries a fabricated query failure', async function () {
        var r = await captureCalls(function (cb) { unguardedDelivery(throwsOnce(cb)); });
        assert.ok(r.calls[1][0] instanceof Error, 'the replay hands the caller an Error');
        assert.match(r.calls[1][0].message, /cb-boom/,
            'and it is the CALLER\'S OWN exception, dressed as a query error');
    });
});

// ─── §04 source pins ─────────────────────────────────────────────────────────
describe('04 - the guard is wired at each fixed site (source pins)', function () {

    /**
     * Strip BOTH comment forms. The fix's own comments name the defect and the
     * removed shape, so an unstripped negative pin would match the prose.
     *
     * @inner
     * @param {string} t - raw source
     * @returns {string} source with block and line comments removed
     */
    function live(t) {
        return t.replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
    }

    var FILES = ['sqlite', 'mongodb', 'scylladb'].map(function (n) {
        return { name: n, src: fs.readFileSync(path.join(FW, 'core/connectors/' + n + '/index.js'), 'utf8') };
    });

    FILES.forEach(function (f) {
        var liveSrc = live(f.src);

        it(f.name + ': the comment strip is real AND does not eat live code', function () {
            // NB: the needle must live ONLY in a full-line comment. `#B432` does not
            // qualify — it also tags the require line as a TRAILING comment, which
            // this strip deliberately does not remove (stripping trailing `//` would
            // eat `://` inside string literals).
            assert.equal(liveSrc.indexOf('per-call guard'), -1, 'block/line comments are stripped');
            assert.ok(liveSrc.indexOf("require('./../settle-once')") > -1, 'live code survives the strip');
            assert.ok(liveSrc.length > f.src.length * 0.3, 'the strip must not blank the file');
        });

        it(f.name + ': requires the shared guard', function () {
            assert.match(liveSrc, /var settleOnce\s*=\s*require\('\.\/\.\.\/settle-once'\);/);
        });

        it(f.name + ': builds the guard PER CALL, not at module scope', function () {
            var decl = liveSrc.indexOf('var _deliver = settleOnce(');
            assert.ok(decl > -1, 'a per-call guard is built');
            var proto = liveSrc.indexOf('prototype[name] = function()');
            assert.ok(proto > -1 && decl > proto,
                'the guard must be built inside the entity method — a module-scope guard would let the FIRST call suppress every later one');
        });

        it(f.name + ': no live settle bypasses the guard on the callback path', function () {
            assert.equal(liveSrc.indexOf('_mainCallback(null, raw)'), -1, 'success settles through the guard');
            assert.equal(liveSrc.indexOf('_mainCallback(null, result)'), -1, 'success settles through the guard');
            assert.equal(liveSrc.indexOf('_mainCallback(lib.connectorError.stamp('), -1, 'errors settle through the guard');
        });
    });

    it('the shared helper never re-invokes a callback that threw', function () {
        var src = fs.readFileSync(path.join(FW, 'core/connectors/settle-once.js'), 'utf8');
        var liveSrc = live(src);
        assert.match(liveSrc, /if \(delivered\) \{[\s\S]{0,60}return false;/, 'at-most-once');
        assert.match(liveSrc, /catch \(cbErr\)/, 'a callback throw is caught');
        var cat = liveSrc.slice(liveSrc.indexOf('catch (cbErr)'));
        assert.equal(cat.indexOf('cb.apply'), -1, 'the catch must NOT call the callback again');
    });
});

after(function () { fs.rmSync(TMP, { recursive: true, force: true }); });
