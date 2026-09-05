/**
 * #MS5 — per-authority circuit breaker in `query()` (opt-in)
 *
 * The breaker's functions are closure-locals inside SuperController (and the
 * boot resolver a closure-local inside server.js); they cannot be required
 * directly. Same two strategies as http2-client.test.js / controller.test.js §24:
 *
 *   A. Source inspection — position-sensitive pins proving the gate sits ABOVE
 *      the protocol dispatch (so an open circuit rejects before any retry or
 *      pre-flight machinery — the #B34/#B52/#B53 invariants are untouched),
 *      plus the contract lines a refactor must not lose.
 *
 *   B. Logic replicas — `_circuitAdmit` / `_circuitRecord` /
 *      `_isCircuitTransportFailure` / `GinaCircuitOpenError` and the server.js
 *      boot resolver, replicated verbatim and driven through the full state
 *      machine. Replica drift is caught by the section-A pins.
 *
 * Subtract arms encode the two designed-against failure shapes: a breaker whose
 * probe ignores criticality wedges on a swallowed non-critical probe, and a
 * classifier that counts caller bugs trips on a healthy upstream.
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var SOURCE        = path.join(require('../fw'), 'core/controller/controller.js');
var SERVER_SOURCE = path.join(require('../fw'), 'core/server.js');
var CONFIG_SOURCE = path.join(require('../fw'), 'core/config.js');
var GNA_SOURCE    = path.join(require('../fw'), 'core/gna.js');


// ─── A. Source inspection ─────────────────────────────────────────────────────

describe('01 - source: the breaker gate sits ABOVE the protocol dispatch', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    it('admission runs before the client lib is even required', function() {
        var gate     = src.indexOf('var _cbGate      = _circuitAdmit(_cbEntry, _cbConf, isCritical);');
        var required = src.indexOf("browser = require(''+ httpLib);");
        assert.ok(gate > -1, 'the admission call must exist');
        assert.ok(required > -1, 'the dispatch require must exist');
        assert.ok(gate < required, 'the gate must run before the dispatch require');
    });

    it('admission runs before both protocol handlers are invoked', function() {
        var gate = src.indexOf('var _cbGate      = _circuitAdmit(');
        var h2   = src.indexOf('handleHTTP2ClientRequest(browser, options, callback, 0, isCritical);');
        var h1   = src.indexOf('handleHTTP1ClientRequest(browser, options, callback);');
        assert.ok(gate > -1 && h2 > -1 && h1 > -1, 'gate + both dispatch calls must exist');
        assert.ok(gate < h2 && gate < h1, 'the gate must precede both dispatch calls');
    });

    it('the gate is dormant unless the boot-stamped policy is enabled', function() {
        assert.match(src, /var _cbConf = self\.serverInstance && self\.serverInstance\._queryCircuitBreaker;/,
            'policy must be read from the boot-resolved instance stamp');
        assert.match(src, /if \( _cbConf && _cbConf\.enabled \) \{/,
            'the whole breaker path must be guarded on enabled');
    });

    it('an open-circuit rejection mirrors the H3 non-critical swallow contract', function() {
        var rejection = src.indexOf('var _cbErr = new GinaCircuitOpenError(_cbAuthority, _cbGate.retryAfterMs);');
        assert.ok(rejection > -1);
        var blk = src.slice(rejection, rejection + 900);
        assert.match(blk, /if \(!isCritical\) \{/, 'criticality must be checked');
        assert.match(blk, /\[QUERY\]\[circuit-open\]\[non-critical\]/, 'non-critical rejection is log-only');
        assert.match(blk, /if \(callback\) \{/, 'callback mode must be handled');
        assert.match(blk, /self\.emit\('query#complete', _cbErr\)/, 'emitter mode must be handled');
    });

    it('outcomes are recorded once, via a wrapped callback', function() {
        assert.match(src, /function onCircuitObservedOutcome\(err\)/, 'the recording wrapper must exist');
        assert.match(src, /if \(!_cbSettled\) \{/, 'the record-once guard must exist');
        assert.match(src, /_circuitRecord\(_cbEntry, _cbConf, _cbGate\.probe, err\);/, 'the wrapper must record against the entry');
    });

    it('a probe admitted without a callback releases its slot immediately', function() {
        var noCb = src.indexOf('} else if (_cbGate.probe) {');
        assert.ok(noCb > -1, 'the no-callback probe branch must exist');
        assert.match(src.slice(noCb, noCb + 500), /_cbEntry\.probeInFlight = false;/,
            'an unobservable probe must not wedge the half-open state');
    });

    it('only CRITICAL requests may serve as the half-open probe', function() {
        assert.match(src, /if \(entry\.probeInFlight \|\| !isCritical\) \{/,
            'the admit logic must refuse a non-critical probe (its failure would be swallowed and never recorded)');
    });

    it('the classifier names the HTTP/1.x socket-level codes and honours err.cause', function() {
        assert.match(src, /\^\(ECONNREFUSED\|ECONNRESET\|ETIMEDOUT\|EPIPE\|ECONNABORTED\|EHOSTUNREACH\|ENETUNREACH\)\$/,
            'the transport-code allow-list must exist');
        assert.match(src, /err\.code \|\| \(err\.cause && err\.cause\.code\)/,
            'both the code and cause.code shapes must be read');
        assert.match(src, /if \(err\.name === 'GinaHttp2Error'\) return true;/,
            'every GinaHttp2Error is transport-class');
    });

    it('breaker STATE lives on the server instance (survives dev hot-reload)', function() {
        assert.match(src, /self\.serverInstance\._queryCircuitBreakers = \{\};/,
            'the registry must be minted on the server instance, not module/controller scope');
    });

    it('GinaCircuitOpenError carries the machine-readable contract fields', function() {
        var ctor = src.indexOf('function GinaCircuitOpenError(authority, retryAfterMs)');
        assert.ok(ctor > -1);
        var blk = src.slice(ctor, ctor + 1200);
        assert.match(blk, /this\.code {8,}= 'CIRCUIT_OPEN';/, 'code');
        assert.match(blk, /this\.status {6,}= 503;/, 'status');
        assert.match(blk, /this\.retryable {3,}= false;/, 'retryable');
        assert.match(blk, /this\.authority {3,}= authority;/, 'authority');
        assert.match(blk, /this\.retryAfterMs = retryAfterMs;/, 'retryAfterMs');
    });
});

describe('02 - source: boot resolver (server.js) and settings fold (config.js)', function() {

    var srv = fs.readFileSync(SERVER_SOURCE, 'utf8');
    var cfg = fs.readFileSync(CONFIG_SOURCE, 'utf8');
    var gna = fs.readFileSync(GNA_SOURCE, 'utf8');

    it('the policy is resolved once at start() and stamped on the instance', function() {
        assert.match(srv, /if \( typeof\(instance\._queryCircuitBreaker\) == 'undefined' \) \{/,
            'the stamp guard must exist');
        assert.match(srv, /instance\._queryCircuitBreaker = resolveQueryCircuitBreakerConf\(self\.conf\[self\.appName\]\[self\.env\]\.server\);/,
            'the stamp must read the post-fold server block');
    });

    it('the resolver is dormant unless enabled is strictly true', function() {
        assert.match(srv, /if \( !block \|\| block\.enabled !== true \) \{/, 'strict enabled check');
        assert.match(srv, /return \{ enabled: false \};/, 'dormant shape');
    });

    it('an ENABLED block with invalid values refuses the boot (throw, not warn-and-disable)', function() {
        assert.match(srv, /`server\.query\.circuitBreaker\.failureThreshold` must be an integer >= 1/,
            'threshold refusal');
        assert.match(srv, /`server\.query\.circuitBreaker\.cooldown` must be a positive timeout/,
            'cooldown refusal');
    });

    it('defaults are threshold 5 / cooldown "30s"', function() {
        assert.match(srv, /typeof\(block\.failureThreshold\) == 'undefined' \) \? 5 : block\.failureThreshold;/);
        assert.match(srv, /typeof\(block\.cooldown\) == 'undefined' \) \? '30s' : block\.cooldown/);
    });

    it('config.js folds settings.json server.query with env.json keys winning (#B114 semantics)', function() {
        assert.match(cfg, /conf\[bundle\]\[env\]\.content\.settings\.server\.query/, 'the fold must read the settings surface');
        assert.match(cfg, /conf\[bundle\]\[env\]\.server\.query = merge\(conf\[bundle\]\[env\]\.server\.query, conf\[bundle\]\[env\]\.content\.settings\.server\.query\);/,
            'merge with server.query (env.json) as the base — its keys win');
    });

    it('parseTimeout documents the null-on-invalid contract the resolver relies on', function() {
        assert.match(gna, /to milliseconds\. Returns `null` when the timeout is disabled\/invalid\./,
            'the resolver turns parseTimeout null into a boot refusal — the contract must stay documented');
    });
});


// ─── B. Logic replicas ────────────────────────────────────────────────────────
//
// Verbatim copies of the closure-locals. If the source changes, the section-A
// pins fail before these drift silently.

function GinaCircuitOpenError(authority, retryAfterMs) {
    Error.call(this);
    this.name    = 'GinaCircuitOpenError';
    this.message = 'Controller::query() circuit is OPEN for [ '+ authority +' ] — failing fast'+ ( retryAfterMs > 0 ? ' (next probe allowed in '+ retryAfterMs +'ms)' : '' );
    if (Error.captureStackTrace) {
        Error.captureStackTrace(this, GinaCircuitOpenError);
    } else {
        this.stack = (new Error(this.message)).stack;
    }
    this.code         = 'CIRCUIT_OPEN';
    this.retryable    = false;
    this.status       = 503;
    this.retryCount   = 0;
    this.authority    = authority;
    this.retryAfterMs = retryAfterMs;
}
GinaCircuitOpenError.prototype             = Object.create(Error.prototype);
GinaCircuitOpenError.prototype.constructor = GinaCircuitOpenError;

var _CB_TRANSPORT_CODES = /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|EHOSTUNREACH|ENETUNREACH)$/;
var _isCircuitTransportFailure = function(err) {
    if (!err) return false;
    if (err.name === 'GinaHttp2Error') return true;
    var code = err.code || (err.cause && err.cause.code);
    return _CB_TRANSPORT_CODES.test(String(code || ''));
};

// Replica takes `now` injected where the source uses Date.now() — the only
// deliberate delta, so the state machine is testable without global clock mocks.
var _circuitAdmit = function(entry, conf, isCritical, now) {
    if (entry.state === 'open') {
        var elapsed = now - entry.openedAt;
        if (elapsed < conf.cooldownMs) {
            return { admitted: false, probe: false, retryAfterMs: conf.cooldownMs - elapsed };
        }
        entry.state = 'half-open';
        entry.probeInFlight = false;
    }
    if (entry.state === 'half-open') {
        if (entry.probeInFlight || !isCritical) {
            return { admitted: false, probe: false, retryAfterMs: 0 };
        }
        entry.probeInFlight = true;
        return { admitted: true, probe: true, retryAfterMs: 0 };
    }
    return { admitted: true, probe: false, retryAfterMs: 0 };
};

var _circuitRecord = function(entry, conf, isProbe, err, now) {
    if (isProbe) {
        entry.probeInFlight = false;
    }
    if (!err) {
        entry.state = 'closed';
        entry.consecutiveFailures = 0;
        return;
    }
    if ( !_isCircuitTransportFailure(err) ) {
        return; // neutral — caller bug or app-level error
    }
    entry.consecutiveFailures++;
    if (isProbe || entry.consecutiveFailures >= conf.failureThreshold) {
        entry.state = 'open';
        entry.openedAt = now;
    }
};

function freshEntry() {
    return { state: 'closed', consecutiveFailures: 0, openedAt: 0, probeInFlight: false };
}
var CONF = { enabled: true, failureThreshold: 5, cooldownMs: 30000 };
var TRANSPORT_ERR = { name: 'Error', code: 'ECONNREFUSED' };

describe('03 - replica: CLOSED behaviour and the trip threshold', function() {

    it('closed admits, failures below the threshold stay closed', function() {
        var e = freshEntry();
        for (var i = 0; i < 4; i++) {
            var g = _circuitAdmit(e, CONF, true, 1000);
            assert.equal(g.admitted, true);
            _circuitRecord(e, CONF, g.probe, TRANSPORT_ERR, 1000);
        }
        assert.equal(e.state, 'closed');
        assert.equal(e.consecutiveFailures, 4);
    });

    it('the Nth consecutive transport failure opens the circuit', function() {
        var e = freshEntry();
        for (var i = 0; i < 5; i++) {
            _circuitRecord(e, CONF, false, TRANSPORT_ERR, 2000);
        }
        assert.equal(e.state, 'open');
        assert.equal(e.openedAt, 2000);
    });

    it('a success resets the consecutive counter (5 failures never accumulate across a success)', function() {
        var e = freshEntry();
        for (var i = 0; i < 4; i++) _circuitRecord(e, CONF, false, TRANSPORT_ERR, 1000);
        _circuitRecord(e, CONF, false, false, 1000); // query() success sentinel is `false` (§9)
        assert.equal(e.consecutiveFailures, 0);
        for (var j = 0; j < 4; j++) _circuitRecord(e, CONF, false, TRANSPORT_ERR, 1000);
        assert.equal(e.state, 'closed', 'four failures after the reset must not trip a threshold of five');
    });

    it('neutral errors neither trip nor reset', function() {
        var e = freshEntry();
        for (var i = 0; i < 3; i++) _circuitRecord(e, CONF, false, TRANSPORT_ERR, 1000);
        _circuitRecord(e, CONF, false, new TypeError('caller bug'), 1000);
        assert.equal(e.consecutiveFailures, 3, 'a caller bug must not reset the count');
        assert.equal(e.state, 'closed', 'a caller bug must not trip the circuit');
    });
});

describe('04 - replica: OPEN rejects fast, then lazily half-opens', function() {

    it('while cooling, rejects with the remaining cooldown', function() {
        var e = freshEntry();
        e.state = 'open'; e.openedAt = 10000;
        var g = _circuitAdmit(e, CONF, true, 22000); // 12s elapsed of 30s
        assert.equal(g.admitted, false);
        assert.equal(g.retryAfterMs, 18000);
        assert.equal(e.state, 'open', 'no transition while cooling');
    });

    it('after the cooldown, the first CRITICAL request becomes the probe', function() {
        var e = freshEntry();
        e.state = 'open'; e.openedAt = 10000;
        var g = _circuitAdmit(e, CONF, true, 40001);
        assert.equal(e.state, 'half-open');
        assert.equal(g.admitted, true);
        assert.equal(g.probe, true);
        assert.equal(e.probeInFlight, true);
    });

    it('while the probe is in flight, everything else is rejected', function() {
        var e = freshEntry();
        e.state = 'half-open'; e.probeInFlight = true;
        var g = _circuitAdmit(e, CONF, true, 50000);
        assert.equal(g.admitted, false);
        assert.equal(g.retryAfterMs, 0);
    });

    it('a NON-critical request can never probe (its failure would be swallowed, never recorded)', function() {
        var e = freshEntry();
        e.state = 'half-open'; e.probeInFlight = false;
        var g = _circuitAdmit(e, CONF, false, 50000);
        assert.equal(g.admitted, false);
        assert.equal(e.probeInFlight, false, 'the probe slot must stay free for a critical request');
    });

    it('probe success closes the circuit and resets the counter', function() {
        var e = freshEntry();
        e.state = 'open'; e.openedAt = 0; e.consecutiveFailures = 5;
        var g = _circuitAdmit(e, CONF, true, 30001);
        _circuitRecord(e, CONF, g.probe, false, 30001);
        assert.equal(e.state, 'closed');
        assert.equal(e.consecutiveFailures, 0);
        assert.equal(e.probeInFlight, false);
    });

    it('probe transport-failure re-opens with a fresh cooldown', function() {
        var e = freshEntry();
        e.state = 'open'; e.openedAt = 0;
        var g = _circuitAdmit(e, CONF, true, 30001);
        _circuitRecord(e, CONF, g.probe, TRANSPORT_ERR, 30001);
        assert.equal(e.state, 'open');
        assert.equal(e.openedAt, 30001, 'cooldown must re-arm from the probe failure');
        assert.equal(e.probeInFlight, false);
    });

    it('probe neutral error releases the slot and stays half-open (next critical re-probes)', function() {
        var e = freshEntry();
        e.state = 'open'; e.openedAt = 0;
        var g = _circuitAdmit(e, CONF, true, 30001);
        _circuitRecord(e, CONF, g.probe, new TypeError('caller bug'), 30001);
        assert.equal(e.state, 'half-open');
        assert.equal(e.probeInFlight, false);
        var g2 = _circuitAdmit(e, CONF, true, 30002);
        assert.equal(g2.probe, true, 'the slot must be probeable again');
    });
});

describe('05 - replica: transport-failure classifier', function() {

    it('every GinaHttp2Error counts (all its codes are transport-class, post-#B34)', function() {
        assert.equal(_isCircuitTransportFailure({ name: 'GinaHttp2Error', code: 'BAD_GATEWAY' }), true);
        assert.equal(_isCircuitTransportFailure({ name: 'GinaHttp2Error', code: 'TIMEOUT' }), true);
    });

    it('HTTP/1.x socket codes count, on err.code and err.cause.code alike', function() {
        ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ECONNABORTED','EHOSTUNREACH','ENETUNREACH'].forEach(function(code) {
            assert.equal(_isCircuitTransportFailure({ code: code }), true, code);
            assert.equal(_isCircuitTransportFailure({ cause: { code: code } }), true, 'cause.' + code);
        });
    });

    it('caller bugs and app-level errors are neutral', function() {
        assert.equal(_isCircuitTransportFailure(new TypeError('boom')), false);
        assert.equal(_isCircuitTransportFailure({ code: 'ENOENT' }), false);
        assert.equal(_isCircuitTransportFailure({ status: 422 }), false);
        assert.equal(_isCircuitTransportFailure(false), false, 'the §9 success sentinel is not a failure');
        assert.equal(_isCircuitTransportFailure(null), false);
    });

    it('GinaCircuitOpenError is an Error with the documented contract', function() {
        var e = new GinaCircuitOpenError('api.example.local:3101', 1234);
        assert.ok(e instanceof Error);
        assert.equal(e.code, 'CIRCUIT_OPEN');
        assert.equal(e.status, 503);
        assert.equal(e.retryable, false);
        assert.equal(e.authority, 'api.example.local:3101');
        assert.equal(e.retryAfterMs, 1234);
        assert.match(e.message, /api\.example\.local:3101/);
    });

    it('per-authority isolation: one authority tripping never affects another', function() {
        var registry = {};
        function entryFor(a) { if (!registry[a]) registry[a] = freshEntry(); return registry[a]; }
        for (var i = 0; i < 5; i++) _circuitRecord(entryFor('down.local:3101'), CONF, false, TRANSPORT_ERR, 1000);
        assert.equal(entryFor('down.local:3101').state, 'open');
        assert.equal(entryFor('up.local:3102').state, 'closed');
        assert.equal(_circuitAdmit(entryFor('up.local:3102'), CONF, true, 1000).admitted, true);
    });
});

describe('06 - replica: boot resolver', function() {

    // Contract-faithful parseTimeout stub (pinned by §02's gna.js JSDoc test):
    // "30s"→30000-style strings, numbers pass through, disabled/invalid → null.
    function parseTimeoutStub(v) {
        if (typeof v === 'number') return (v > 0 ? v : null);
        if (typeof v === 'string') {
            var m = v.match(/^(\d+)(ms|s|m|h)$/);
            if (!m) return null;
            var n = parseInt(m[1], 10);
            return n * ({ ms: 1, s: 1000, m: 60000, h: 3600000 })[m[2]];
        }
        return null;
    }

    // Verbatim replica of server.js resolveQueryCircuitBreakerConf, with
    // parseTimeout injected (same deliberate delta as the clock above).
    function resolveQueryCircuitBreakerConf(serverConf, parseTimeout) {
        var block = serverConf && serverConf.query && serverConf.query.circuitBreaker;
        if ( !block || block.enabled !== true ) {
            return { enabled: false };
        }
        var threshold = ( typeof(block.failureThreshold) == 'undefined' ) ? 5 : block.failureThreshold;
        if ( typeof(threshold) != 'number' || threshold !== ~~threshold || threshold < 1 ) {
            throw new Error('[SERVER][#MS5] `server.query.circuitBreaker.failureThreshold` must be an integer >= 1 — got `'+ threshold +'`');
        }
        var cooldownMs = parseTimeout( ( typeof(block.cooldown) == 'undefined' ) ? '30s' : block.cooldown );
        if ( typeof(cooldownMs) != 'number' || cooldownMs < 1 ) {
            throw new Error('[SERVER][#MS5] `server.query.circuitBreaker.cooldown` must be a positive timeout (e.g. "30s", 500) — got `'+ block.cooldown +'`');
        }
        return { enabled: true, failureThreshold: threshold, cooldownMs: cooldownMs };
    }

    it('absent block → dormant', function() {
        assert.deepEqual(resolveQueryCircuitBreakerConf(undefined, parseTimeoutStub), { enabled: false });
        assert.deepEqual(resolveQueryCircuitBreakerConf({}, parseTimeoutStub), { enabled: false });
        assert.deepEqual(resolveQueryCircuitBreakerConf({ query: {} }, parseTimeoutStub), { enabled: false });
    });

    it('enabled must be strictly true — a truthy string does not arm it', function() {
        assert.deepEqual(
            resolveQueryCircuitBreakerConf({ query: { circuitBreaker: { enabled: 'true' } } }, parseTimeoutStub),
            { enabled: false });
    });

    it('enabled with defaults → threshold 5 / cooldown 30000', function() {
        assert.deepEqual(
            resolveQueryCircuitBreakerConf({ query: { circuitBreaker: { enabled: true } } }, parseTimeoutStub),
            { enabled: true, failureThreshold: 5, cooldownMs: 30000 });
    });

    it('custom values pass through', function() {
        assert.deepEqual(
            resolveQueryCircuitBreakerConf({ query: { circuitBreaker: { enabled: true, failureThreshold: 2, cooldown: '5s' } } }, parseTimeoutStub),
            { enabled: true, failureThreshold: 2, cooldownMs: 5000 });
    });

    it('invalid threshold refuses the boot', function() {
        [0, -1, 1.5, '5', true].forEach(function(bad) {
            assert.throws(function() {
                resolveQueryCircuitBreakerConf({ query: { circuitBreaker: { enabled: true, failureThreshold: bad } } }, parseTimeoutStub);
            }, /failureThreshold/, String(bad));
        });
    });

    it('invalid cooldown refuses the boot', function() {
        ['abc', 0, -5, false].forEach(function(bad) {
            assert.throws(function() {
                resolveQueryCircuitBreakerConf({ query: { circuitBreaker: { enabled: true, cooldown: bad } } }, parseTimeoutStub);
            }, /cooldown/, String(bad));
        });
    });
});

describe('07 - subtract: the designed-against failure shapes', function() {

    it('subtract: a probe policy that ignores criticality wedges on a swallowed non-critical probe', function() {
        // Broken variant: admits ANY request as the probe.
        function brokenAdmit(entry, conf, isCritical, now) {
            if (entry.state === 'open') {
                if (now - entry.openedAt < conf.cooldownMs) return { admitted: false, probe: false };
                entry.state = 'half-open'; entry.probeInFlight = false;
            }
            if (entry.state === 'half-open') {
                if (entry.probeInFlight) return { admitted: false, probe: false };
                entry.probeInFlight = true;
                return { admitted: true, probe: true };
            }
            return { admitted: true, probe: false };
        }
        var e = freshEntry();
        e.state = 'open'; e.openedAt = 0;
        var g = brokenAdmit(e, CONF, false, 30001); // non-critical becomes the probe
        assert.equal(g.probe, true);
        // Its transport failure is swallowed by _swallowIfNonCritical → the
        // callback never fires → nothing ever records → probeInFlight stays true:
        assert.equal(e.probeInFlight, true);
        var g2 = brokenAdmit(e, CONF, true, 30002);
        assert.equal(g2.admitted, false, 'the wedge: every later request is rejected forever');
        // The shipped policy refuses the non-critical probe, so the slot stays free:
        var e2 = freshEntry();
        e2.state = 'open'; e2.openedAt = 0;
        _circuitAdmit(e2, CONF, false, 30001);
        assert.equal(e2.probeInFlight, false, 'shipped: the slot survives for a critical request');
    });

    it('subtract: a classifier that counts every error trips the circuit on caller bugs', function() {
        function brokenRecord(entry, conf, err, now) { // counts ANY truthy err
            if (!err) { entry.consecutiveFailures = 0; return; }
            entry.consecutiveFailures++;
            if (entry.consecutiveFailures >= conf.failureThreshold) { entry.state = 'open'; entry.openedAt = now; }
        }
        var broken = freshEntry();
        for (var i = 0; i < 5; i++) brokenRecord(broken, CONF, new TypeError('same caller bug'), 1000);
        assert.equal(broken.state, 'open', 'the failure shape: a healthy upstream is declared down');
        var shipped = freshEntry();
        for (var j = 0; j < 5; j++) _circuitRecord(shipped, CONF, false, new TypeError('same caller bug'), 1000);
        assert.equal(shipped.state, 'closed', 'shipped: caller bugs are neutral');
    });
});
