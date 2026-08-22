'use strict';
/**
 * lib/rate-limit — the #MS6 identified-caller quota gate.
 *
 * Quota semantics, not flood control: core/router.js runs the gate at BOTH
 * dispatch sites AFTER `authorizeRequest` (the principal resolver) and BEFORE
 * the DTO pipe (401 -> 429 -> 422 — a throttled caller never receives a 422
 * field map). Counters are fixed windows over the #KV1 primitive (`incr` with
 * create-only TTL); the response surface is RFC 9110 `Retry-After` plus the
 * draft-ietf-httpapi-ratelimit-headers-11 structured fields.
 *
 * Shape of this suite:
 *   §01 source pins — the two router.js call sites (strict dormancy guard, owned
 *       terminals, the wrapped band), the lib/index.js plain-require, the types
 *       declaration, the #MS6 config fold, the engine-start stamp, and BOTH
 *       per-route builders (cold typeof-not-`||`; warm typeof-guarded copy).
 *   §02 resolveConf — dormant shapes, every fail-closed refusal, the three
 *       warn tiers (unknown key / memory scope / redis fail-fast trio), the
 *       per-route override lint, and the resolved shape.
 *   §03 deriveKey — session-wins precedence (the authorizeRequest mirror),
 *       class prefixes, unidentified shapes, the long-value hash under the kv
 *       512-char key cap.
 *   §04 structured-field serialization — sf-string escaping, both items.
 *   §05 gate: allow path — headers exact, at-limit boundary.
 *   §06 gate: deny path — 429 through controller.throwError, Retry-After from
 *       the store's own ttl (one extra read on the throttled path only), the
 *       ttl-failure fallback.
 *   §07 gate: inapplicable — exempt route and unidentified caller return null
 *       SYNCHRONOUSLY (no promise, no store call — the dormancy invariant's
 *       per-request half).
 *   §08 gate: per-route override — REPLACE semantics (own bucket, own policy
 *       name), partial-object inheritance.
 *   §09 gate: failMode arms — `null` (open) allows WITHOUT headers (the
 *       null-coercion trap: `null <= limit` is true, so the explicit check is
 *       load-bearing); a rejection (closed) answers 503 + Retry-After and
 *       RESOLVES false (ownership — never an unowned rejection).
 *   §10 header write is best-effort — bare stubs and sent headers never turn a
 *       verdict into a throw.
 *   §11 the parseTimeout replica this suite installs is pinned against the
 *       real utils/helper.js source (replica discipline).
 */
var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

// The lib calls the framework-global `parseTimeout` (installed at boot by
// utils/helper.js; the lib/routing house precedent). Standalone, install a
// verbatim replica — §11 pins it against the real source so it cannot drift.
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

var RL_PATH     = path.join(FW, 'lib/rate-limit/src/main.js');
var rl          = require(RL_PATH);

var ROUTER_SRC  = fs.readFileSync(path.join(FW, 'core/router.js'), 'utf8');
var LIBIDX_SRC  = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var SERVER_SRC  = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var CONFIG_SRC  = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');
var ROUTING_SRC = fs.readFileSync(path.join(FW, 'lib/routing/src/main.js'), 'utf8');
var TYPES_SRC   = fs.readFileSync(path.join(FW, '../../types/index.d.ts'), 'utf8');
var HELPER_SRC  = fs.readFileSync(path.join(FW, '../../utils/helper.js'), 'utf8');

// ---------------------------------------------------------------- fakes ----

/** A namespace handle whose incr/ttl are scripted per test. */
function fakeNs(script) {
    var ns = { calls: { incr: [], ttl: [] } };
    ns.incr = function (key, by, opts) {
        ns.calls.incr.push({ key: key, by: by, opts: opts });
        return script.incr(key, by, opts);
    };
    ns.ttl = function (key) {
        ns.calls.ttl.push(key);
        return script.ttl ? script.ttl(key) : Promise.resolve(null);
    };
    return ns;
}
/** A controller stub recording the denial throwError would put on the wire. */
function ctl() {
    var c = { thrown: null };
    c.throwError = function (errObj) { c.thrown = errObj; return false; };
    return c;
}
/** A response stub recording set headers. */
function res() {
    var r = { headers: {}, headersSent: false };
    r.setHeader = function (k, v) { r.headers[k] = v; };
    return r;
}
/** A request shaped like the one router.js dispatches with, post-authz. */
function req(shape) {
    shape = shape || {};
    var r = { routing: { rule: shape.rule || 'home@app' } };
    if ( typeof(shape.rateLimit) != 'undefined' ) { r.routing.rateLimit = shape.rateLimit; }
    if ( shape.user ) { r.session = { user: shape.user }; }
    if ( shape.machine ) { r.machineCaller = shape.machine; }
    return r;
}
/** An armed conf as resolveConf would stamp it. */
function conf(ns, over) {
    var c = { enabled: true, namespace: 'quota', keyField: 'id', limit: 5, windowMs: 60000, ns: ns };
    for (var k in (over || {})) { c[k] = over[k]; }
    return c;
}
/** deps for resolveConf with a declared `quota` namespace. */
function deps(over) {
    var d = {
        kv: { get: function (name) {
            if ( name !== 'quota' ) { throw new Error('[kv] no namespace `' + name + '` (configured: quota)'); }
            return { incr: function(){}, ttl: function(){} };
        } },
        kvSettings : { namespaces: { quota: { store: 'kvred', failMode: 'open' } } },
        connectors : { kvred: { connector: 'redis', enableOfflineQueue: false, commandTimeout: 500 } },
        routing    : {},
        warns      : [],
    };
    d.warn = function (m) { d.warns.push(m); };
    for (var k in (over || {})) { d[k] = over[k]; }
    return d;
}
var BLOCK = { enabled: true, namespace: 'quota', keyField: 'id', limit: 100, window: '1m' };
function block(over) {
    var b = {}; for (var k in BLOCK) { b[k] = BLOCK[k]; }
    for (var j in (over || {})) { if ( typeof(over[j]) == 'undefined' ) { delete b[j]; } else { b[j] = over[j]; } }
    return b;
}

// ------------------------------------------------------------------- §01 ----

describe('rate-limit §01 — source pins (the seams)', function () {

    it('01.01 - router.js calls the gate at BOTH dispatch sites', function () {
        var calls = ROUTER_SRC.match(/rateLimit\.gate\(request, response, controller, _rlConf\)/g) || [];
        assert.equal(calls.length, 2);
    });

    it('01.02 - dormancy guard is STRICT `enabled === true` at both sites (a "true" string stays dormant)', function () {
        var guards = ROUTER_SRC.match(/_rlConf && _rlConf\.enabled === true/g) || [];
        assert.equal(guards.length, 2);
    });

    it('01.03 - both verdict promises are OWNED: named .then + named .catch per site', function () {
        assert.equal((ROUTER_SRC.match(/\.then\(function onRateLimitVerdict\(/g) || []).length, 2);
        assert.equal((ROUTER_SRC.match(/\.catch\(function onRateLimitError\(/g) || []).length, 2);
    });

    it('01.04 - per site: authz precedes the wrapped band, which precedes the gate call; the sync fall-through exists', function () {
        var re = /authzGate\.authorizeRequest\(controller, request, response\)/g, m, seen = 0;
        while ((m = re.exec(ROUTER_SRC)) !== null) {
            var after   = ROUTER_SRC.slice(m.index);
            var defIdx  = after.indexOf('var _dispatchControllerAction = function');
            var gateIdx = after.indexOf('rateLimit.gate(');
            var syncIdx = after.indexOf('_dispatchControllerAction();');
            assert.ok(defIdx > -1, 'the band must be wrapped after authz');
            assert.ok(gateIdx > defIdx, 'the gate call must follow the wrapped band definition');
            assert.ok(syncIdx > gateIdx, 'the synchronous fall-through must exist after the gate block');
            seen++;
        }
        assert.equal(seen, 2);
    });

    it('01.05 - inside the wrapped band the order is dto -> reservedActions -> action (both sites)', function () {
        var re = /var _dispatchControllerAction = function/g, m, seen = 0;
        while ((m = re.exec(ROUTER_SRC)) !== null) {
            var after = ROUTER_SRC.slice(m.index);
            var dto   = after.indexOf('dtoPipe.validateRequestPayload');
            var loop  = after.indexOf('reservedActions.length');
            var act   = after.indexOf('controller[action](');
            assert.ok(dto > -1 && loop > dto && act > loop);
            seen++;
        }
        assert.equal(seen, 2);
    });

    it('01.06 - lib/index.js plain-requires rate-limit (router-bound; #B32-residual)', function () {
        assert.match(LIBIDX_SRC, /rateLimit\s*:\s*require\('\.\/rate-limit'\)/);
        assert.doesNotMatch(LIBIDX_SRC, /rateLimit\s*:\s*_require\(/);
    });

    it('01.07 - GinaLib declares rateLimit (the types-runtime parity gate)', function () {
        assert.match(TYPES_SRC, /rateLimit: any;/);
    });

    it('01.08 - config.js folds settings.server.rateLimit into the runtime server block (env wins)', function () {
        assert.match(CONFIG_SRC, /content\.settings\.server\.rateLimit/);
        assert.match(CONFIG_SRC, /server\.rateLimit = merge\(conf\[bundle\]\[env\]\.server\.rateLimit, conf\[bundle\]\[env\]\.content\.settings\.server\.rateLimit\)/);
    });

    it('01.09 - server.js stamps the resolved conf ONCE on the engine instance at start', function () {
        assert.match(SERVER_SRC, /typeof\(instance\._rateLimit\) == 'undefined'/);
        assert.match(SERVER_SRC, /instance\._rateLimit = lib\.rateLimit\.resolveConf\(/);
        var stampIdx   = SERVER_SRC.indexOf('instance._rateLimit = lib.rateLimit.resolveConf(');
        var breakerIdx = SERVER_SRC.indexOf('instance._queryCircuitBreaker = resolveQueryCircuitBreakerConf(');
        assert.ok(breakerIdx > -1 && stampIdx > breakerIdx, 'the stamp lives in the instance-scalars family beside the #MS5 breaker');
    });

    it('01.10 - the COLD route builder is typeof-guarded, never `||` (false is MEANINGFUL: exempt)', function () {
        assert.match(SERVER_SRC, /rateLimit\s+:\s+\( typeof\(routing\[name\]\.rateLimit\) != 'undefined' \) \? routing\[name\]\.rateLimit : null,/);
        assert.doesNotMatch(SERVER_SRC, /rateLimit\s+:\s+routing\[name\]\.rateLimit \|\|/);
    });

    it('01.11 - the WARM (cached-route) builder copies the key typeof-guarded, top-level (the #CSRF2 trap)', function () {
        assert.match(ROUTING_SRC, /typeof\(routeObject\.rateLimit\) != 'undefined'/);
        assert.match(ROUTING_SRC, /params\.rateLimit = routeObject\.rateLimit;/);
        assert.doesNotMatch(ROUTING_SRC, /params\.param\.rateLimit/);
    });
});

// ------------------------------------------------------------------- §02 ----

describe('rate-limit §02 — resolveConf (fail-closed on enabled, warn tiers, route lint)', function () {

    it('02.01 - absent block / enabled:"true" / enabled:1 are all dormant', function () {
        assert.deepEqual(rl.resolveConf({}, deps()), { enabled: false });
        assert.deepEqual(rl.resolveConf({ rateLimit: { enabled: 'true' } }, deps()), { enabled: false });
        assert.deepEqual(rl.resolveConf({ rateLimit: { enabled: 1 } }, deps()), { enabled: false });
        assert.deepEqual(rl.resolveConf(undefined, deps()), { enabled: false });
    });

    it('02.02 - enabled without namespace / keyField / limit / window each REFUSE (never warn-and-disable)', function () {
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ namespace: undefined }) }, deps()); }, /namespace/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ keyField: undefined }) }, deps()); }, /keyField/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ limit: undefined }) }, deps()); }, /limit/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ window: undefined }) }, deps()); }, /window/);
    });

    it('02.03 - structurally invalid limit / window shapes refuse', function () {
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ limit: 0 }) },      deps()); }, /limit/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ limit: 1.5 }) },    deps()); }, /limit/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ limit: '100' }) },  deps()); }, /limit/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ window: 'soon' }) },deps()); }, /window/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ window: 0 }) },     deps()); }, /window/);
    });

    it('02.04 - an UNDECLARED kv namespace refuses (never a silent memory fallback)', function () {
        assert.throws(function(){ rl.resolveConf({ rateLimit: block({ namespace: 'ghost' }) }, deps()); }, /ghost/);
    });

    it('02.05 - a missing kv facade refuses', function () {
        assert.throws(function(){ rl.resolveConf({ rateLimit: block() }, { warn: function(){} }); }, /kv primitive/);
    });

    it('02.06 - unknown block keys WARN by name (never silently dropped)', function () {
        var d = deps();
        rl.resolveConf({ rateLimit: block({ burst: 10 }) }, d);
        assert.ok(d.warns.some(function(w){ return /burst/.test(w); }));
    });

    it('02.07 - a memory-backed namespace warns PER-PROCESS scope', function () {
        var d = deps({ kvSettings: { namespaces: { quota: {} } } });
        rl.resolveConf({ rateLimit: block() }, d);
        assert.ok(d.warns.some(function(w){ return /PER PROCESS/.test(w); }));
    });

    it('02.08 - a redis namespace missing the fail-fast trio warns; the full trio does not; sqlite does not', function () {
        var d1 = deps({ connectors: { kvred: { connector: 'redis' } } });
        rl.resolveConf({ rateLimit: block() }, d1);
        assert.ok(d1.warns.some(function(w){ return /enableOfflineQueue/.test(w); }), 'defaults must warn');

        var d2 = deps(); // trio present in the default fake
        rl.resolveConf({ rateLimit: block() }, d2);
        assert.ok(!d2.warns.some(function(w){ return /enableOfflineQueue/.test(w); }), 'the trio must not warn');

        var d3 = deps({ connectors: { kvred: { connector: 'sqlite' } } });
        rl.resolveConf({ rateLimit: block() }, d3);
        assert.ok(!d3.warns.some(function(w){ return /enableOfflineQueue/.test(w); }), 'sqlite must not warn');
    });

    it('02.09 - route lint: malformed shapes refuse WITH the rule name; false/absent skip; unknown keys warn', function () {
        assert.throws(function(){ rl.resolveConf({ rateLimit: block() }, deps({ routing: { 'bad@app': { rateLimit: true } } })); }, /bad@app/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block() }, deps({ routing: { 'bad@app': { rateLimit: [] } } })); }, /bad@app/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block() }, deps({ routing: { 'bad@app': { rateLimit: { limit: 0 } } } })); }, /bad@app/);
        assert.throws(function(){ rl.resolveConf({ rateLimit: block() }, deps({ routing: { 'bad@app': { rateLimit: { window: 'nope' } } } })); }, /bad@app/);
        var d = deps({ routing: { 'a@app': { rateLimit: false }, 'b@app': {}, 'c@app': { rateLimit: { limit: 2, burst: 9 } } } });
        rl.resolveConf({ rateLimit: block() }, d); // must not throw
        assert.ok(d.warns.some(function(w){ return /c@app/.test(w) && /burst/.test(w); }));
    });

    it('02.10 - the resolved shape carries the LIVE namespace handle and parsed window', function () {
        var d = deps();
        var out = rl.resolveConf({ rateLimit: block() }, d);
        assert.equal(out.enabled, true);
        assert.equal(out.namespace, 'quota');
        assert.equal(out.keyField, 'id');
        assert.equal(out.limit, 100);
        assert.equal(out.windowMs, 60000);
        assert.equal(typeof out.ns.incr, 'function');
    });
});

// ------------------------------------------------------------------- §03 ----

describe('rate-limit §03 — deriveKey (the authorizeRequest precedence mirror)', function () {
    var C = { keyField: 'id' };

    it('03.01 - session user keys u:<field>; machine keys m:<name>', function () {
        assert.equal(rl.deriveKey(req({ user: { id: 'u1' } }), C), 'u:u1');
        assert.equal(rl.deriveKey(req({ machine: { name: 'svc-a', machine: true } }), C), 'm:svc-a');
    });

    it('03.02 - session WINS over a machine identity (the gate never consults the machine path for a signed-in caller)', function () {
        var r = req({ user: { id: 'u1' }, machine: { name: 'svc-a', machine: true } });
        assert.equal(rl.deriveKey(r, C), 'u:u1');
    });

    it('03.03 - unidentified shapes return null: no session+no machine, absent/empty/null keyField value, machine without the forced flag', function () {
        assert.equal(rl.deriveKey(req({}), C), null);
        assert.equal(rl.deriveKey(req({ user: { name: 'no-id-field' } }), C), null);
        assert.equal(rl.deriveKey(req({ user: { id: '' } }), C), null);
        assert.equal(rl.deriveKey(req({ user: { id: null } }), C), null);
        assert.equal(rl.deriveKey(req({ machine: { name: 'svc-a' } }), C), null, 'machine:true is FORCED by the authz gate — its absence means this is not a machine principal');
        assert.equal(rl.deriveKey(null, C), null);
    });

    it('03.04 - a long identity value is sha256-hexed; the class prefix survives; the key fits the kv 512 cap with a rule suffix', function () {
        var long = new Array(300).join('x');
        var k = rl.deriveKey(req({ user: { id: long } }), C);
        assert.match(k, /^u:[0-9a-f]{64}$/);
        assert.ok((k + ':' + 'some-very-long-rule-name@bundle').length <= 512);
    });

    it('03.05 - a numeric identity value keys on its string form', function () {
        assert.equal(rl.deriveKey(req({ user: { id: 42 } }), C), 'u:42');
    });
});

// ------------------------------------------------------------------- §04 ----

describe('rate-limit §04 — structured-field serialization (draft-11 shapes)', function () {

    it('04.01 - sfString escapes backslash and DQUOTE, in that order', function () {
        assert.equal(rl.sfString('default'), '"default"');
        assert.equal(rl.sfString('a"b'), '"a\\"b"');
        assert.equal(rl.sfString('a\\b'), '"a\\\\b"');
    });

    it('04.02 - the policy item is "<name>";q=<limit>;w=<windowSec>', function () {
        assert.equal(rl.buildPolicyItem('default', 100, 60), '"default";q=100;w=60');
    });

    it('04.03 - the RateLimit item is "<name>";r=<remaining>, with ;t= only when given', function () {
        assert.equal(rl.buildRateLimitItem('default', 42), '"default";r=42');
        assert.equal(rl.buildRateLimitItem('default', 0, 17), '"default";r=0;t=17');
    });
});

// ------------------------------------------------------------------- §05 ----

describe('rate-limit §05 — gate: allow path', function () {

    it('05.01 - under the limit: resolves true, sets RateLimit (r = limit - count, no t) + RateLimit-Policy', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(1); } });
        var r = res(), c = ctl();
        var verdict = await rl.gate(req({ user: { id: 'u1' } }), r, c, conf(ns));
        assert.equal(verdict, true);
        assert.equal(c.thrown, null);
        assert.equal(r.headers['RateLimit'], '"default";r=4');
        assert.equal(r.headers['RateLimit-Policy'], '"default";q=5;w=60');
        assert.equal(typeof r.headers['Retry-After'], 'undefined');
        assert.equal(ns.calls.incr.length, 1);
        assert.equal(ns.calls.incr[0].key, 'u:u1');
        assert.deepEqual(ns.calls.incr[0].opts, { ttl: 60000 });
        assert.equal(ns.calls.ttl.length, 0, 'the allow path pays NO second store read');
    });

    it('05.02 - AT the limit (count === limit): still allowed, r=0', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(5); } });
        var r = res(), c = ctl();
        assert.equal(await rl.gate(req({ user: { id: 'u1' } }), r, c, conf(ns)), true);
        assert.equal(r.headers['RateLimit'], '"default";r=0');
    });
});

// ------------------------------------------------------------------- §06 ----

describe('rate-limit §06 — gate: deny path', function () {

    it('06.01 - over the limit: 429 via controller.throwError, Retry-After from the store ttl, r=0;t=<sec>', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(6); }, ttl: function(){ return Promise.resolve(17000); } });
        var r = res(), c = ctl();
        var verdict = await rl.gate(req({ user: { id: 'u1' } }), r, c, conf(ns));
        assert.equal(verdict, false);
        assert.deepEqual(c.thrown, { status: 429, error: 'Too many requests' });
        assert.equal(r.headers['Retry-After'], '17');
        assert.equal(r.headers['RateLimit'], '"default";r=0;t=17');
        assert.equal(r.headers['RateLimit-Policy'], '"default";q=5;w=60');
        assert.equal(ns.calls.ttl.length, 1, 'exactly one extra read, on the throttled path only');
    });

    it('06.02 - a failing/absent ttl degrades Retry-After to the full window (never blocks the verdict)', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(6); }, ttl: function(){ return Promise.reject(new Error('down')); } });
        var r = res(), c = ctl();
        assert.equal(await rl.gate(req({ user: { id: 'u1' } }), r, c, conf(ns)), false);
        assert.equal(r.headers['Retry-After'], '60');
        assert.equal(r.headers['RateLimit'], '"default";r=0;t=60');
    });

    it('06.03 - the deny body is GENERIC (the disclosure doctrine — specifics ride the headers)', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(6); } });
        var c = ctl();
        await rl.gate(req({ user: { id: 'u1' } }), res(), c, conf(ns));
        assert.equal(c.thrown.error, 'Too many requests');
        assert.ok(!/quota|limit|window|u1/.test(c.thrown.error));
    });
});

// ------------------------------------------------------------------- §07 ----

describe('rate-limit §07 — gate: inapplicable is SYNCHRONOUS null (no promise, no store call)', function () {

    it('07.01 - an exempt route (rateLimit: false) returns null and never touches the store', function () {
        var ns = fakeNs({ incr: function(){ throw new Error('must not be called'); } });
        var out = rl.gate(req({ user: { id: 'u1' }, rateLimit: false }), res(), ctl(), conf(ns));
        assert.equal(out, null);
        assert.equal(ns.calls.incr.length, 0);
    });

    it('07.02 - an unidentified caller returns null and never touches the store', function () {
        var ns = fakeNs({ incr: function(){ throw new Error('must not be called'); } });
        assert.equal(rl.gate(req({}), res(), ctl(), conf(ns)), null);
        assert.equal(ns.calls.incr.length, 0);
    });
});

// ------------------------------------------------------------------- §08 ----

describe('rate-limit §08 — gate: per-route override (REPLACE semantics, own bucket)', function () {

    it('08.01 - an override counts in its OWN bucket (key gains :<rule>) under its OWN policy name', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(1); } });
        var r = res();
        var verdict = await rl.gate(req({ user: { id: 'u1' }, rule: 'upload@app', rateLimit: { limit: 2 } }), r, ctl(), conf(ns));
        assert.equal(verdict, true);
        assert.equal(ns.calls.incr[0].key, 'u:u1:upload@app');
        assert.equal(r.headers['RateLimit'], '"upload@app";r=1');
        assert.equal(r.headers['RateLimit-Policy'], '"upload@app";q=2;w=60', 'window inherited from the default');
    });

    it('08.02 - a partial override inherits the missing key (window given, limit inherited)', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(1); } });
        var r = res();
        await rl.gate(req({ user: { id: 'u1' }, rule: 'slow@app', rateLimit: { window: '30s' } }), r, ctl(), conf(ns));
        assert.deepEqual(ns.calls.incr[0].opts, { ttl: 30000 });
        assert.equal(r.headers['RateLimit-Policy'], '"slow@app";q=5;w=30');
    });

    it('08.03 - an overridden route DENIES on its own budget while the global stays untouched', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(3); }, ttl: function(){ return Promise.resolve(9000); } });
        var r = res(), c = ctl();
        var verdict = await rl.gate(req({ user: { id: 'u1' }, rule: 'upload@app', rateLimit: { limit: 2 } }), r, c, conf(ns));
        assert.equal(verdict, false);
        assert.equal(c.thrown.status, 429);
        assert.equal(ns.calls.incr.length, 1, 'REPLACE: no second incr against the global bucket');
        assert.equal(ns.calls.incr[0].key, 'u:u1:upload@app');
    });
});

// ------------------------------------------------------------------- §09 ----

describe('rate-limit §09 — gate: failMode arms (the store-outage contract)', function () {

    it('09.01 - failMode OPEN: incr degrades to null -> ALLOW with NO headers (the null-coercion trap is guarded)', async function () {
        // `null <= limit` is TRUE by coercion — an unguarded compare would allow
        // WITH r = limit - null = limit, i.e. a fabricated full-quota reading.
        var ns = fakeNs({ incr: function(){ return Promise.resolve(null); } });
        var r = res(), c = ctl();
        var verdict = await rl.gate(req({ user: { id: 'u1' } }), r, c, conf(ns));
        assert.equal(verdict, true);
        assert.equal(c.thrown, null);
        assert.deepEqual(r.headers, {}, 'no reading exists, so no reading is reported');
    });

    it('09.02 - failMode CLOSED: incr rejects -> 503 + Retry-After, RESOLVES false (ownership, never a hang)', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.reject(new Error('redis down')); } });
        var r = res(), c = ctl();
        var verdict = await rl.gate(req({ user: { id: 'u1' } }), r, c, conf(ns));
        assert.equal(verdict, false);
        assert.deepEqual(c.thrown, { status: 503, error: 'Service temporarily unavailable' });
        assert.equal(r.headers['Retry-After'], '60');
        assert.equal(typeof r.headers['RateLimit'], 'undefined', 'the caller is NOT over quota and must not be told it is');
    });
});

// ------------------------------------------------------------------- §10 ----

describe('rate-limit §10 — header write is best-effort (the WWW-Authenticate mould)', function () {

    it('10.01 - a response without setHeader still gets its verdict', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(6); }, ttl: function(){ return Promise.resolve(1000); } });
        var c = ctl();
        assert.equal(await rl.gate(req({ user: { id: 'u1' } }), {}, c, conf(ns)), false);
        assert.equal(c.thrown.status, 429);
    });

    it('10.02 - headersSent suppresses the write, never the verdict', async function () {
        var ns = fakeNs({ incr: function(){ return Promise.resolve(1); } });
        var r = res(); r.headersSent = true;
        assert.equal(await rl.gate(req({ user: { id: 'u1' } }), r, ctl(), conf(ns)), true);
        assert.deepEqual(r.headers, {});
    });
});

// ------------------------------------------------------------------- §11 ----

describe('rate-limit §11 — the parseTimeout replica is pinned to the real source', function () {

    it('11.01 - the replica body matches utils/helper.js (the grammar cannot drift silently)', function () {
        // Distinctive lines of the real implementation, asserted present verbatim.
        assert.ok(HELPER_SRC.indexOf("var _match = value.match(/^(\\d+(?:\\.\\d+)?)(ms|s|m|h)$/);") > -1);
        assert.ok(HELPER_SRC.indexOf("case 'ms': return Math.round(_n);") > -1);
        assert.ok(HELPER_SRC.indexOf("case 'm':  return Math.round(_n * 60000);") > -1);
    });

    it('11.02 - behaviour parity on the shapes the resolver accepts', function () {
        assert.equal(PARSE_TIMEOUT_REPLICA('1m'), 60000);
        assert.equal(PARSE_TIMEOUT_REPLICA('30s'), 30000);
        assert.equal(PARSE_TIMEOUT_REPLICA('500ms'), 500);
        assert.equal(PARSE_TIMEOUT_REPLICA(60000), 60000);
        assert.equal(PARSE_TIMEOUT_REPLICA('soon'), null);
        assert.equal(PARSE_TIMEOUT_REPLICA(''), null);
    });
});
