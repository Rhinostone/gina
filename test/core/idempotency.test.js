'use strict';
/**
 * lib/idempotency — the #FIN6 Idempotency-Key dedup gate.
 *
 * Contract (design of record, 2026-09-03, per the IETF
 * draft-ietf-httpapi-idempotency-key-header): a route OPTS IN via routing.json
 * top-level `idempotency: true | { required: true }`. core/router.js runs the
 * gate at BOTH dispatch sites AFTER the rate-limit gate (order
 * 401 -> 429 -> 409/422/replay -> DTO 422). Reservations are `setnx` over the
 * #KV1 primitive with an in-flight TTL (crash-safe by expiry); completion
 * records a response envelope {status, allowlisted headers, body, fingerprint}
 * with a retention TTL. A duplicate while in flight gets 409 + Retry-After; a
 * key reused with a different payload gets 422; a replay serves the recorded
 * envelope + `Idempotency-Replayed: true`. Anonymous (principal-less) callers
 * are SKIPPED — a stored response must never cross principals (the render-cache
 * authz+cache lesson). 5xx and oversize bodies RELEASE the reservation so
 * retries re-execute.
 *
 * Shape of this suite:
 *   §01 source pins — router.js both sites (order after rate-limit, owned
 *       terminals, the hoisted dispatch helper), lib/index.js plain-require,
 *       types decl, config fold, engine-start stamp, both per-route builders,
 *       the renderJSON record hook at the stringify choke point, the schema.
 *   §02 resolveConf — dormant shapes, fail-closed refusals, defaults, warns,
 *       per-route lint.
 *   §03 header parse + reservation-key derivation (sf-string tolerant read,
 *       the kv 512-char belt).
 *   §04 gate: inapplicable returns null SYNCHRONOUSLY (no store call).
 *   §05 gate: reservation won — capture stamped, finish-belt attached.
 *   §06 gate: in-flight duplicate — 409 + Retry-After.
 *   §07 gate: replay / payload mismatch / missing-required-key / race fallback.
 *   §08 record() — allowlisted headers, sync recorded flag, 5xx + oversize
 *       release, owned rejection.
 *   §09 failMode arms — closed rejection answers 503 (the open-circuit shape);
 *       open degrades to proceed-without-dedup.
 *   §10 finish-belt — an unrecorded finish releases the reservation.
 *   §11 real-kv integration — reserve -> record -> replay -> 422 against the
 *       real #KV1 memory namespace (the _createNamespace test seam).
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var crypto = require('crypto');

var FW = require('../fw');

// The lib calls the framework-global `parseTimeout` (installed at boot; the
// same standalone-install shape as test/core/rate-limit.test.js, whose §11
// pins the replica against the real source — this copy is byte-identical).
var PARSE_TIMEOUT_REPLICA = function(value) {
    if (value === false || value === null || typeof value === 'undefined' || value === '') {
        return null;
    }
    if (typeof value === 'number') {
        // 0 is a valid value — it disables the timeout in Node.js APIs
        return value;
    }
    if (typeof value === 'string') {
        var _match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
        if (!_match) return null;
        var _n = parseFloat(_match[1]);
        switch (_match[2]) {
            case 'ms': return Math.round(_n);
            case 's':  return Math.round(_n * 1000);
            case 'm':  return Math.round(_n * 60000);
            case 'h':  return Math.round(_n * 3600000);
        }
    }
    return null;
};
if ( typeof(global.parseTimeout) == 'undefined' ) { global.parseTimeout = PARSE_TIMEOUT_REPLICA; }

var IDEM_PATH   = path.join(FW, 'lib/idempotency/src/main.js');
var idem        = require(IDEM_PATH);

var ROUTER_SRC  = fs.readFileSync(path.join(FW, 'core/router.js'), 'utf8');
var LIBIDX_SRC  = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var SERVER_SRC  = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var CONFIG_SRC  = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');
var ROUTING_SRC = fs.readFileSync(path.join(FW, 'lib/routing/src/main.js'), 'utf8');
var TYPES_SRC   = fs.readFileSync(path.join(FW, '../../types/index.d.ts'), 'utf8');
var RJSON_SRC   = fs.readFileSync(path.join(FW, 'core/controller/controller.render-json.js'), 'utf8');
var SCHEMA_SRC  = fs.readFileSync(path.join(FW, '../../schema/settings.json'), 'utf8');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ---------------------------------------------------------------- fakes ----

/** A namespace handle whose ops are scripted per test, calls recorded. */
function fakeNs(script) {
    script = script || {};
    var ns = { calls: { setnx: [], get: [], set: [], del: [] } };
    ns.setnx = function (key, v, opts) {
        ns.calls.setnx.push({ key: key, v: v, opts: opts });
        return script.setnx ? script.setnx(key, v, opts) : Promise.resolve(true);
    };
    ns.get = function (key) {
        ns.calls.get.push(key);
        return script.get ? script.get(key) : Promise.resolve(null);
    };
    ns.set = function (key, v, opts) {
        ns.calls.set.push({ key: key, v: v, opts: opts });
        return script.set ? script.set(key, v, opts) : Promise.resolve(true);
    };
    ns.del = function (key) {
        ns.calls.del.push(key);
        return script.del ? script.del(key) : Promise.resolve(true);
    };
    return ns;
}
/** A controller stub recording the denial throwError would put on the wire. */
function ctl() {
    var c = { thrown: null };
    c.throwError = function (errObj) { c.thrown = errObj; return false; };
    return c;
}
/** A response stub recording headers, status, body and finish listeners. */
function res() {
    var r = { headers: {}, headersSent: false, statusCode: 200, endedWith: null, finishCbs: [] };
    r.setHeader = function (k, v) { r.headers[k] = v; };
    r.getHeaders = function () { return r.headers; };
    r.on = function (ev, cb) { if (ev === 'finish') { r.finishCbs.push(cb); } };
    r.end = function (body) { r.endedWith = ( typeof(body) == 'undefined' ) ? '' : body; };
    r.emitFinish = function () { r.finishCbs.forEach(function (cb) { cb(); }); };
    return r;
}
/** A request shaped like the one router.js dispatches with, post-authz. */
function req(shape) {
    shape = shape || {};
    var r = {
        method  : shape.method || 'POST',
        headers : shape.headers || {},
        routing : { rule: shape.rule || 'pay@app' }
    };
    // the warm builder stamps `null` when routing.json never mentions it
    r.routing.idempotency = ( typeof(shape.idempotency) != 'undefined' ) ? shape.idempotency : null;
    if ( typeof(shape.rawBody) != 'undefined' ) { r.rawBody = shape.rawBody; }
    if ( shape.user ) { r.session = { user: shape.user }; }
    if ( shape.machine ) { r.machineCaller = shape.machine; }
    return r;
}
/** An armed conf as resolveConf would stamp it. */
function conf(ns, over) {
    var c = {
        enabled: true, namespace: 'idem', keyField: 'id',
        ttlMs: 86400000, inflightTtlMs: 120000, maxBodySize: 262144, retryAfterSec: 5,
        ns: ns
    };
    for (var k in (over || {})) { c[k] = over[k]; }
    return c;
}
/** deps for resolveConf with a declared `idem` namespace. */
function deps(over) {
    var d = {
        kv: { get: function (name) {
            if ( name !== 'idem' ) { throw new Error('[kv] no namespace `' + name + '` (configured: idem)'); }
            return fakeNs();
        } },
        kvSettings : { namespaces: { idem: { store: 'kvred', failMode: 'closed' } } },
        connectors : { kvred: { connector: 'redis', enableOfflineQueue: false, commandTimeout: 500 } },
        routing    : {},
        warns      : [],
    };
    d.warn = function (m) { d.warns.push(m); };
    for (var k in (over || {})) { d[k] = over[k]; }
    return d;
}
var BLOCK = { enabled: true, namespace: 'idem', keyField: 'id' };
function block(over) {
    var b = {}; for (var k in BLOCK) { b[k] = BLOCK[k]; }
    for (var j in (over || {})) { if ( typeof(over[j]) == 'undefined' ) { delete b[j]; } else { b[j] = over[j]; } }
    return b;
}
/** A reserving gate call that wins, returning {request, response, verdict}. */
function reserve(ns, shape, cOver) {
    var r = req(shape || { idempotency: true, user: { id: 42 }, headers: { 'idempotency-key': 'k-1' }, rawBody: '{"a":1}' });
    var rs = res();
    return idem.gate(r, rs, ctl(), conf(ns, cOver)).then(function (verdict) {
        return { request: r, response: rs, verdict: verdict };
    });
}

// ------------------------------------------------------------------- §01 ----

describe('idempotency §01 — source pins (the seams)', function () {

    it('01.01 - router.js calls the gate at BOTH dispatch sites', function () {
        var calls = ROUTER_SRC.match(/idempotency\.gate\(request, response, controller, _idemConf\)/g) || [];
        assert.equal(calls.length, 2);
    });

    it('01.02 - dormancy guard is STRICT `enabled === true` at both sites', function () {
        var guards = ROUTER_SRC.match(/_idemConf && _idemConf\.enabled === true/g) || [];
        assert.equal(guards.length, 2);
    });

    it('01.03 - both verdict promises are OWNED: named .then + named .catch per site', function () {
        assert.equal((ROUTER_SRC.match(/\.then\(function onIdempotencyVerdict\(/g) || []).length, 2);
        assert.equal((ROUTER_SRC.match(/\.catch\(function onIdempotencyError\(/g) || []).length, 2);
    });

    it('01.04 - per site: the idempotency gate runs AFTER the rate-limit gate (429 before 409/replay), and the rate-limit allow path routes through the idem helper', function () {
        var re = /authzGate\.authorizeRequest\(controller, request, response\)/g, m, seen = 0;
        while ((m = re.exec(ROUTER_SRC)) !== null) {
            var after   = ROUTER_SRC.slice(m.index);
            var rlIdx   = after.indexOf('rateLimit.gate(');
            var idemIdx = after.indexOf('idempotency.gate(');
            assert.ok(rlIdx > -1 && idemIdx > rlIdx, 'idempotency.gate must sit after rateLimit.gate');
            seen++;
        }
        assert.equal(seen, 2);
        assert.equal((ROUTER_SRC.match(/if \(proceed\) \{ _idemThenDispatch\(\); \}/g) || []).length, 2,
            'the rate-limit allow path must route through the idempotency helper');
        assert.equal((ROUTER_SRC.match(/if \(proceed\) \{ _dispatchControllerAction\(\); \}/g) || []).length, 2,
            'the idempotency allow path dispatches the band');
        assert.equal((ROUTER_SRC.match(/function _idemThenDispatch\(\)/g) || []).length, 2,
            'the hoisted helper exists at both sites');
    });

    it('01.05 - lib/index.js plain-requires idempotency (router-bound; #B32-residual)', function () {
        assert.match(LIBIDX_SRC, /idempotency\s*:\s*require\('\.\/idempotency'\)/);
        assert.doesNotMatch(LIBIDX_SRC, /idempotency\s*:\s*_require\(/);
    });

    it('01.06 - GinaLib declares idempotency (the types-runtime parity gate)', function () {
        assert.match(TYPES_SRC, /idempotency: any;/);
    });

    it('01.07 - config.js folds settings.server.idempotency into the runtime server block (env wins)', function () {
        assert.match(CONFIG_SRC, /content\.settings\.server\.idempotency/);
        assert.match(CONFIG_SRC, /server\.idempotency = merge\(conf\[bundle\]\[env\]\.server\.idempotency, conf\[bundle\]\[env\]\.content\.settings\.server\.idempotency\)/);
    });

    it('01.08 - server.js stamps the resolved conf ONCE on the engine instance at start', function () {
        assert.match(SERVER_SRC, /typeof\(instance\._idempotency\) == 'undefined'/);
        assert.match(SERVER_SRC, /instance\._idempotency = lib\.idempotency\.resolveConf\(/);
    });

    it('01.09 - both per-route builders propagate the opt-in (cold typeof-guarded copy; warm typeof-not-||)', function () {
        assert.match(ROUTING_SRC, /typeof\(routeObject\.idempotency\) != 'undefined'/);
        assert.match(ROUTING_SRC, /params\.idempotency = routeObject\.idempotency/);
        assert.match(SERVER_SRC, /idempotency\s*:\s*\( typeof\(routing\[name\]\.idempotency\) != 'undefined' \) \? routing\[name\]\.idempotency : null/);
    });

    it('01.10 - renderJSON records at the single stringify choke point', function () {
        assert.match(RJSON_SRC, /lib\.idempotency\.record\(request, response, data\)/);
        var strIdx  = RJSON_SRC.indexOf('var data = JSON.stringify(jsonObj);');
        var hookIdx = RJSON_SRC.indexOf('lib.idempotency.record(request, response, data)');
        assert.ok(strIdx > -1 && hookIdx > strIdx, 'the hook must sit after the stringify');
        var headIdx = RJSON_SRC.indexOf('/^HEAD$/i.test(request.method)');
        assert.ok(headIdx > -1 && hookIdx < headIdx, 'the hook must sit before the body-write forks');
    });

    it('01.11 - schema/settings.json documents server.idempotency', function () {
        assert.ok(SCHEMA_SRC.indexOf('"idempotency"') > -1);
        assert.ok(SCHEMA_SRC.indexOf('Idempotency-Key') > -1);
    });
});

// ------------------------------------------------------------------- §02 ----

describe('idempotency §02 — resolveConf', function () {

    it('02.01 - dormant: absent block / enabled:false / enabled:"true" string', function () {
        assert.deepEqual(idem.resolveConf({}, deps()), { enabled: false });
        assert.deepEqual(idem.resolveConf({ idempotency: { enabled: false } }, deps()), { enabled: false });
        assert.deepEqual(idem.resolveConf({ idempotency: { enabled: 'true' } }, deps()), { enabled: false });
    });

    it('02.02 - refusals: namespace / keyField missing or empty', function () {
        assert.throws(function () { idem.resolveConf({ idempotency: block({ namespace: undefined }) }, deps()); }, /namespace/);
        assert.throws(function () { idem.resolveConf({ idempotency: block({ namespace: '' }) }, deps()); }, /namespace/);
        assert.throws(function () { idem.resolveConf({ idempotency: block({ keyField: undefined }) }, deps()); }, /keyField/);
    });

    it('02.03 - refusals: malformed durations and sizes on an enabled block', function () {
        assert.throws(function () { idem.resolveConf({ idempotency: block({ ttl: 'nope' }) }, deps()); }, /ttl/);
        assert.throws(function () { idem.resolveConf({ idempotency: block({ inflightTtl: -5 }) }, deps()); }, /inflightTtl/);
        assert.throws(function () { idem.resolveConf({ idempotency: block({ maxBodySize: 1.5 }) }, deps()); }, /maxBodySize/);
        assert.throws(function () { idem.resolveConf({ idempotency: block({ retryAfter: 'later' }) }, deps()); }, /retryAfter/);
    });

    it('02.04 - refusals: undeclared namespace, missing kv facade', function () {
        assert.throws(function () { idem.resolveConf({ idempotency: block({ namespace: 'ghost' }) }, deps()); }, /ghost/);
        assert.throws(function () { idem.resolveConf({ idempotency: block() }, deps({ kv: undefined })); }, /kv/);
    });

    it('02.05 - defaults: 24h retention, 2m in-flight, 256KB body cap, 5s retry-after', function () {
        var c = idem.resolveConf({ idempotency: block() }, deps());
        assert.equal(c.enabled, true);
        assert.equal(c.ttlMs, 86400000);
        assert.equal(c.inflightTtlMs, 120000);
        assert.equal(c.maxBodySize, 262144);
        assert.equal(c.retryAfterSec, 5);
        assert.ok(c.ns && typeof c.ns.setnx == 'function');
    });

    it('02.06 - explicit values parsed through parseTimeout', function () {
        var c = idem.resolveConf({ idempotency: block({ ttl: '1h', inflightTtl: '30s', maxBodySize: 1024, retryAfter: '10s' }) }, deps());
        assert.equal(c.ttlMs, 3600000);
        assert.equal(c.inflightTtlMs, 30000);
        assert.equal(c.maxBodySize, 1024);
        assert.equal(c.retryAfterSec, 10);
    });

    it('02.07 - warn tiers: unknown key, memory-backed namespace scope', function () {
        var d1 = deps();
        idem.resolveConf({ idempotency: block({ bogus: 1 }) }, d1);
        assert.ok(d1.warns.some(function (w) { return /bogus/.test(w); }));

        var d2 = deps({ kvSettings: { namespaces: { idem: {} } } });
        idem.resolveConf({ idempotency: block() }, d2);
        assert.ok(d2.warns.some(function (w) { return /PER PROCESS/i.test(w) && /re-execut/i.test(w); }),
            'the memory warn must state that a retry on another replica RE-EXECUTES');
    });

    it('02.08 - warn tier: redis namespace missing the fail-fast trio', function () {
        var d = deps({ connectors: { kvred: { connector: 'redis' } } });
        idem.resolveConf({ idempotency: block() }, d);
        assert.ok(d.warns.some(function (w) { return /enableOfflineQueue/.test(w); }));
    });

    it('02.09 - per-route lint: bad shapes refuse the boot, unknown keys warn, valid shapes pass', function () {
        assert.throws(function () {
            idem.resolveConf({ idempotency: block() }, deps({ routing: { 'pay@app': { idempotency: 'yes' } } }));
        }, /pay@app/);
        assert.throws(function () {
            idem.resolveConf({ idempotency: block() }, deps({ routing: { 'pay@app': { idempotency: { required: 'yes' } } } }));
        }, /required/);
        var d = deps({ routing: {
            'a@app': { idempotency: true },
            'b@app': { idempotency: false },
            'c@app': { idempotency: { required: true } },
            'd@app': { idempotency: { required: false, bogus: 1 } }
        } });
        idem.resolveConf({ idempotency: block() }, d);
        assert.ok(d.warns.some(function (w) { return /d@app/.test(w) && /bogus/.test(w); }));
    });
});

// ------------------------------------------------------------------- §03 ----

describe('idempotency §03 — header parse + reservation key', function () {

    it('03.01 - sf-string tolerant read: quoted, escaped, bare, empty', function () {
        assert.equal(idem.parseIdempotencyKey('"8e03978e-40d5"'), '8e03978e-40d5');
        assert.equal(idem.parseIdempotencyKey('"a\\"b\\\\c"'), 'a"b\\c');
        assert.equal(idem.parseIdempotencyKey('bare-token'), 'bare-token');
        assert.equal(idem.parseIdempotencyKey('  padded  '), 'padded');
        assert.equal(idem.parseIdempotencyKey('""'), null);
        assert.equal(idem.parseIdempotencyKey(''), null);
        assert.equal(idem.parseIdempotencyKey(undefined), null);
    });

    it('03.02 - reservation key: principal + method + rule + hashed client key', function () {
        var k = idem.deriveResKey('u:42', 'POST', 'pay@app', 'k-1');
        assert.equal(k, 'idem:u:42:POST:pay@app:' + sha256('k-1'));
        assert.ok(k.length <= 512);
    });

    it('03.03 - the 512-char belt folds an oversize key', function () {
        var longRule = new Array(500).join('r');
        var k = idem.deriveResKey('u:' + new Array(180).join('u'), 'POST', longRule, 'k');
        assert.ok(k.length <= 512);
        assert.ok(/^idem:h:[0-9a-f]{64}$/.test(k));
    });
});

// ------------------------------------------------------------------- §04 ----

describe('idempotency §04 — inapplicable returns null SYNCHRONOUSLY', function () {

    it('04.01 - route not opted in (null from the warm builder / false / undefined)', function () {
        var ns = fakeNs();
        assert.equal(idem.gate(req({ user: { id: 42 } }), res(), ctl(), conf(ns)), null);
        assert.equal(idem.gate(req({ idempotency: false, user: { id: 42 } }), res(), ctl(), conf(ns)), null);
        assert.equal(ns.calls.setnx.length, 0, 'no store call on the inapplicable path');
    });

    it('04.02 - anonymous caller is SKIPPED (no session user, no machine caller)', function () {
        var ns = fakeNs();
        var r  = req({ idempotency: true, headers: { 'idempotency-key': 'k-1' } });
        assert.equal(idem.gate(r, res(), ctl(), conf(ns)), null);
        assert.equal(ns.calls.setnx.length, 0);
    });

    it('04.03 - header absent on an opted-in-but-not-required route', function () {
        var ns = fakeNs();
        assert.equal(idem.gate(req({ idempotency: true, user: { id: 42 } }), res(), ctl(), conf(ns)), null);
        assert.equal(ns.calls.setnx.length, 0);
    });
});

// ------------------------------------------------------------------- §05 ----

describe('idempotency §05 — reservation won', function () {

    it('05.01 - verdict true, capture stamped, in-flight envelope + TTL', function () {
        var ns = fakeNs();
        return reserve(ns).then(function (out) {
            assert.equal(out.verdict, true);
            assert.ok(out.request._idemCapture);
            assert.equal(out.request._idemCapture.recorded, false);
            assert.equal(out.request._idemCapture.resKey, 'idem:u:42:POST:pay@app:' + sha256('k-1'));
            assert.equal(out.request._idemCapture.fp, sha256('{"a":1}'));
            assert.equal(ns.calls.setnx.length, 1);
            assert.equal(ns.calls.setnx[0].v.state, 'processing');
            assert.equal(ns.calls.setnx[0].v.fp, sha256('{"a":1}'));
            assert.deepEqual(ns.calls.setnx[0].opts, { ttl: 120000 });
        });
    });

    it('05.02 - the finish release-belt is attached on the winning path', function () {
        var ns = fakeNs();
        return reserve(ns).then(function (out) {
            assert.equal(out.response.finishCbs.length, 1);
        });
    });

    it('05.03 - machine callers reserve under their m: class', function () {
        var ns = fakeNs();
        var r  = req({ idempotency: true, machine: { name: 'worker-1', roles: [], machine: true }, headers: { 'idempotency-key': 'k-2' }, rawBody: '' });
        return idem.gate(r, res(), ctl(), conf(ns)).then(function (verdict) {
            assert.equal(verdict, true);
            assert.equal(r._idemCapture.resKey, 'idem:m:worker-1:POST:pay@app:' + sha256('k-2'));
        });
    });
});

// ------------------------------------------------------------------- §06 ----

describe('idempotency §06 — in-flight duplicate', function () {

    it('06.01 - 409 + Retry-After through controller.throwError', function () {
        var ns = fakeNs({
            setnx: function () { return Promise.resolve(false); },
            get:   function () { return Promise.resolve({ v: 1, state: 'processing', fp: sha256('{"a":1}') }); }
        });
        var c  = ctl();
        var rs = res();
        var r  = req({ idempotency: true, user: { id: 42 }, headers: { 'idempotency-key': 'k-1' }, rawBody: '{"a":1}' });
        return idem.gate(r, rs, c, conf(ns)).then(function (verdict) {
            assert.equal(verdict, false);
            assert.ok(c.thrown && c.thrown.status === 409);
            assert.equal(rs.headers['Retry-After'], '5');
            assert.equal(typeof r._idemCapture, 'undefined', 'a losing request must not capture');
        });
    });
});

// ------------------------------------------------------------------- §07 ----

describe('idempotency §07 — replay, mismatch, required key, race fallback', function () {

    var DONE = {
        v: 1, state: 'done', status: 201,
        headers: { 'content-type': 'application/json; charset=utf8', 'location': '/orders/9' },
        body: '{"id":9}', fp: sha256('{"a":1}')
    };

    it('07.01 - replay serves the recorded envelope + Idempotency-Replayed', function () {
        var ns = fakeNs({
            setnx: function () { return Promise.resolve(false); },
            get:   function () { return Promise.resolve(DONE); }
        });
        var c  = ctl();
        var rs = res();
        var r  = req({ idempotency: true, user: { id: 42 }, headers: { 'idempotency-key': 'k-1' }, rawBody: '{"a":1}' });
        return idem.gate(r, rs, c, conf(ns)).then(function (verdict) {
            assert.equal(verdict, false);
            assert.equal(c.thrown, null, 'a replay is not an error');
            assert.equal(rs.statusCode, 201);
            assert.equal(rs.endedWith, '{"id":9}');
            assert.equal(rs.headers['Idempotency-Replayed'], 'true');
            assert.equal(rs.headers['content-type'], 'application/json; charset=utf8');
            assert.equal(rs.headers['location'], '/orders/9');
        });
    });

    it('07.02 - key reused with a DIFFERENT payload: 422', function () {
        var ns = fakeNs({
            setnx: function () { return Promise.resolve(false); },
            get:   function () { return Promise.resolve(DONE); }
        });
        var c = ctl();
        var r = req({ idempotency: true, user: { id: 42 }, headers: { 'idempotency-key': 'k-1' }, rawBody: '{"a":2}' });
        return idem.gate(r, res(), c, conf(ns)).then(function (verdict) {
            assert.equal(verdict, false);
            assert.ok(c.thrown && c.thrown.status === 422);
        });
    });

    it('07.03 - missing key on a required route: 400, no store call', function () {
        var ns = fakeNs();
        var c  = ctl();
        var r  = req({ idempotency: { required: true }, user: { id: 42 } });
        var g  = idem.gate(r, res(), c, conf(ns));
        assert.ok(g && typeof g.then == 'function', 'the 400 is an ANSWERED verdict, not an inapplicable null');
        return g.then(function (verdict) {
            assert.equal(verdict, false);
            assert.ok(c.thrown && c.thrown.status === 400);
            assert.equal(ns.calls.setnx.length, 0);
        });
    });

    it('07.04 - required route WITH a key reserves normally', function () {
        var ns = fakeNs();
        var r  = req({ idempotency: { required: true }, user: { id: 42 }, headers: { 'idempotency-key': 'k-9' }, rawBody: '' });
        return idem.gate(r, res(), ctl(), conf(ns)).then(function (verdict) {
            assert.equal(verdict, true);
            assert.ok(r._idemCapture);
        });
    });

    it('07.05 - race fallback: reservation vanished between setnx and get -> proceed WITHOUT dedup', function () {
        var ns = fakeNs({
            setnx: function () { return Promise.resolve(false); },
            get:   function () { return Promise.resolve(null); }
        });
        var r = req({ idempotency: true, user: { id: 42 }, headers: { 'idempotency-key': 'k-1' }, rawBody: '{"a":1}' });
        return idem.gate(r, res(), ctl(), conf(ns)).then(function (verdict) {
            assert.equal(verdict, true);
            assert.equal(typeof r._idemCapture, 'undefined', 'the fallback proceeds uncaptured');
        });
    });
});

// ------------------------------------------------------------------- §08 ----

describe('idempotency §08 — record()', function () {

    it('08.01 - no capture: a plain request records nothing', function () {
        var ns = fakeNs();
        idem.record({ }, res(), '{"x":1}');
        assert.equal(ns.calls.set.length, 0);
    });

    it('08.02 - 2xx stores the envelope with ALLOWLISTED headers only, retention TTL, sync recorded flag', function () {
        var ns = fakeNs();
        return reserve(ns).then(function (out) {
            var rs = out.response;
            rs.statusCode = 201;
            rs.headers = {
                'content-type' : 'application/json; charset=utf8',
                'location'     : '/orders/9',
                'set-cookie'   : 'sid=SECRET',
                'x-custom'     : 'nope'
            };
            idem.record(out.request, rs, '{"id":9}');
            assert.equal(out.request._idemCapture.recorded, true, 'the flag must flip SYNCHRONOUSLY');
            assert.equal(ns.calls.set.length, 1);
            var stored = ns.calls.set[0];
            assert.equal(stored.key, out.request._idemCapture.resKey);
            assert.equal(stored.v.state, 'done');
            assert.equal(stored.v.status, 201);
            assert.equal(stored.v.body, '{"id":9}');
            assert.equal(stored.v.fp, out.request._idemCapture.fp);
            assert.deepEqual(stored.v.headers, {
                'content-type' : 'application/json; charset=utf8',
                'location'     : '/orders/9'
            }, 'set-cookie and unknown headers must NEVER be stored');
            assert.deepEqual(stored.opts, { ttl: 86400000 });
        });
    });

    it('08.03 - 5xx releases the reservation (retries must re-execute)', function () {
        var ns = fakeNs();
        return reserve(ns).then(function (out) {
            out.response.statusCode = 502;
            idem.record(out.request, out.response, '{"error":"upstream"}');
            assert.equal(out.request._idemCapture.recorded, true);
            assert.equal(ns.calls.set.length, 0);
            assert.equal(ns.calls.del.length, 1);
        });
    });

    it('08.04 - an oversize body releases the reservation', function () {
        var ns = fakeNs();
        return reserve(ns, null, { maxBodySize: 4 }).then(function (out) {
            out.response.statusCode = 200;
            idem.record(out.request, out.response, '{"big":"body"}');
            assert.equal(ns.calls.set.length, 0);
            assert.equal(ns.calls.del.length, 1);
        });
    });

    it('08.05 - a store rejection is OWNED (no unhandled rejection, no throw)', function () {
        var ns = fakeNs({ set: function () { return Promise.reject(new Error('backend down')); } });
        return reserve(ns).then(function (out) {
            out.response.statusCode = 200;
            idem.record(out.request, out.response, '{}');
            return new Promise(function (r) { setImmediate(r); });
        });
    });

    it('08.06 - double record is a no-op', function () {
        var ns = fakeNs();
        return reserve(ns).then(function (out) {
            out.response.statusCode = 200;
            idem.record(out.request, out.response, '{}');
            idem.record(out.request, out.response, '{}');
            assert.equal(ns.calls.set.length, 1);
        });
    });
});

// ------------------------------------------------------------------- §09 ----

describe('idempotency §09 — failMode arms', function () {

    it('09.01 - closed: a setnx rejection answers 503 + Retry-After and RESOLVES false (ownership)', function () {
        var ns = fakeNs({ setnx: function () { return Promise.reject(new Error('backend down')); } });
        var c  = ctl();
        var rs = res();
        var r  = req({ idempotency: true, user: { id: 42 }, headers: { 'idempotency-key': 'k-1' }, rawBody: '' });
        return idem.gate(r, rs, c, conf(ns)).then(function (verdict) {
            assert.equal(verdict, false);
            assert.ok(c.thrown && c.thrown.status === 503);
            assert.equal(rs.headers['Retry-After'], '5');
        });
    });

    it('09.02 - open: setnx degrades to its miss shape, get to null -> proceed WITHOUT dedup', function () {
        var ns = fakeNs({
            setnx: function () { return Promise.resolve(false); }, // failMode:open degrade
            get:   function () { return Promise.resolve(null); }
        });
        var r = req({ idempotency: true, user: { id: 42 }, headers: { 'idempotency-key': 'k-1' }, rawBody: '' });
        return idem.gate(r, res(), ctl(), conf(ns)).then(function (verdict) {
            assert.equal(verdict, true);
        });
    });
});

// ------------------------------------------------------------------- §10 ----

describe('idempotency §10 — the finish release-belt', function () {

    it('10.01 - an unrecorded finish releases the reservation', function () {
        var ns = fakeNs();
        return reserve(ns).then(function (out) {
            out.response.emitFinish();
            assert.equal(ns.calls.del.length, 1);
            assert.equal(ns.calls.del[0], out.request._idemCapture.resKey);
        });
    });

    it('10.02 - a recorded finish does NOT release', function () {
        var ns = fakeNs();
        return reserve(ns).then(function (out) {
            out.response.statusCode = 200;
            idem.record(out.request, out.response, '{}');
            out.response.emitFinish();
            assert.equal(ns.calls.del.length, 0);
        });
    });
});

// ------------------------------------------------------------------- §11 ----

describe('idempotency §11 — real #KV1 memory namespace (integration)', function () {

    var kv = require(path.join(FW, 'lib/kv'));

    function realNs() {
        return kv._createNamespace('idem-it', kv._createMemoryStore({}), { failMode: 'closed' }, function () {});
    }

    it('11.01 - reserve -> record -> replay round-trip against the real primitive', function () {
        var ns = realNs();
        var c1 = conf(ns);
        var r1 = req({ idempotency: true, user: { id: 7 }, headers: { 'idempotency-key': 'it-1' }, rawBody: '{"amount":"10.00"}' });
        var rs1 = res();
        return idem.gate(r1, rs1, ctl(), c1).then(function (v1) {
            assert.equal(v1, true, 'first request reserves');
            rs1.statusCode = 201;
            rs1.headers = { 'content-type': 'application/json', 'location': '/pay/1' };
            idem.record(r1, rs1, '{"paid":true}');
            return new Promise(function (r) { setImmediate(r); });
        }).then(function () {
            var r2  = req({ idempotency: true, user: { id: 7 }, headers: { 'idempotency-key': 'it-1' }, rawBody: '{"amount":"10.00"}' });
            var rs2 = res();
            var c   = ctl();
            return idem.gate(r2, rs2, c, conf(realNsHandleReuse())).then(function (v2) {
                assert.equal(v2, false, 'second request is answered by replay');
                assert.equal(rs2.statusCode, 201);
                assert.equal(rs2.endedWith, '{"paid":true}');
                assert.equal(rs2.headers['Idempotency-Replayed'], 'true');
                assert.equal(c.thrown, null);
            });
        });
        // the same live namespace handle must serve both calls
        function realNsHandleReuse() { return ns; }
    });

    it('11.02 - same key, different payload: 422 from the real store', function () {
        var ns = realNs();
        var r1 = req({ idempotency: true, user: { id: 8 }, headers: { 'idempotency-key': 'it-2' }, rawBody: '{"amount":"10.00"}' });
        var rs1 = res();
        return idem.gate(r1, rs1, ctl(), conf(ns)).then(function () {
            rs1.statusCode = 200;
            idem.record(r1, rs1, '{"ok":true}');
            return new Promise(function (r) { setImmediate(r); });
        }).then(function () {
            var c = ctl();
            var r2 = req({ idempotency: true, user: { id: 8 }, headers: { 'idempotency-key': 'it-2' }, rawBody: '{"amount":"99.99"}' });
            return idem.gate(r2, res(), c, conf(ns)).then(function (v) {
                assert.equal(v, false);
                assert.ok(c.thrown && c.thrown.status === 422);
            });
        });
    });

    it('11.03 - concurrent duplicate while in flight: 409 from the real store', function () {
        var ns = realNs();
        var r1 = req({ idempotency: true, user: { id: 9 }, headers: { 'idempotency-key': 'it-3' }, rawBody: '{}' });
        return idem.gate(r1, res(), ctl(), conf(ns)).then(function (v1) {
            assert.equal(v1, true);
            var c = ctl();
            var r2 = req({ idempotency: true, user: { id: 9 }, headers: { 'idempotency-key': 'it-3' }, rawBody: '{}' });
            return idem.gate(r2, res(), c, conf(ns)).then(function (v2) {
                assert.equal(v2, false);
                assert.ok(c.thrown && c.thrown.status === 409);
            });
        });
    });
});
