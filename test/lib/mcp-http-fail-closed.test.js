/**
 * lib/mcp-http — fail-closed start gate + constant-time bearer compare (ZT4).
 *
 * Companion to test/lib/mcp-http.test.js, which owns the behavioural surface of
 * the transport. This file covers only what the ZT4 hardening added:
 *
 *   - `start()` refuses to bind, token-less, once an ambient protection has
 *     been removed (non-loopback bind, or a wildcard Origin allowlist);
 *   - `allowInsecure` waives that refusal, and is a STRICT boolean;
 *   - the bearer compare hashes both sides, so a length mismatch is no longer
 *     short-circuited (it used to be, which leaked the token length by timing).
 *
 * NOTE ON THE NON-LOOPBACK CASES: they bind `192.0.2.1` — TEST-NET-1 from
 * RFC 5737, which is guaranteed not to be assigned to any interface. So the OS
 * refuses the bind and NO test here ever opens a listening socket on a public
 * interface. That gives a clean three-way discrimination on one address:
 *   no token          -> rejects with OUR message  (the gate fired)
 *   token / insecure  -> rejects with the OS error (the gate let it through)
 * The second case is the control: without it, "it rejected" would prove nothing.
 */

'use strict';

var path   = require('path');
var fs     = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW      = require('../fw');
var SRC     = path.join(FW, 'lib/mcp-http/src/main.js');
var httpLib = require(path.join(FW, 'lib/mcp-http/src/main'));
var SRC_TXT = fs.readFileSync(SRC, 'utf8');

var UNBINDABLE = '192.0.2.1';   // RFC 5737 TEST-NET-1 — never assigned
var REFUSAL    = /refusing to listen without a bearer token/;


/**
 * Stub mcpServer — the transport only needs `handleMessage`.
 */
function stubServer() {
    return {
        handleMessage: function(raw) {
            var frame = JSON.parse(raw);
            if (typeof(frame.id) === 'undefined') return Promise.resolve(null);
            return Promise.resolve(JSON.stringify({
                jsonrpc: '2.0', id: frame.id, result: { ok: true }
            }));
        }
    };
}

/**
 * Calls start() and reports the outcome without leaking a listener.
 * Resolves `{ started: boolean, message: string }`.
 */
function startOutcome(opts) {
    var merged = Object.assign({ mcpServer: stubServer(), port: 0 }, opts || {});
    var t = httpLib.createHttpTransport(merged);
    return t.start().then(
        function()    { return t.stop().then(function() { return { started: true,  message: '' }; }); },
        function(err) { return { started: false, message: (err && err.message) || String(err) }; }
    );
}


// ---------------------------------------------------------------------------
// 01 — the loopback default is untouched
// ---------------------------------------------------------------------------

describe('01 - loopback default still starts token-less', function() {

    it('starts on 127.0.0.1 with no token (the documented default posture)', async function() {
        var r = await startOutcome({ host: '127.0.0.1' });
        assert.equal(r.started, true);
    });

    it('starts on localhost with no token', async function() {
        var r = await startOutcome({ host: 'localhost' });
        assert.equal(r.started, true);
    });

    it('starts on ::1 with no token', async function() {
        var r = await startOutcome({ host: '::1' });
        assert.equal(r.started, true);
    });

    // Asserted via the gate rather than a successful bind: Linux has the whole
    // 127.0.0.0/8 on loopback, macOS only 127.0.0.1, so binding 127.0.0.5 is
    // platform-dependent. Whether the OS can bind it is not what is under test
    // — that the gate recognises it as loopback is.
    it('recognises the rest of 127.0.0.0/8 as loopback', async function() {
        var r = await startOutcome({ host: '127.0.0.5' });
        assert.doesNotMatch(r.message, REFUSAL);
    });

    it('recognises an IPv4-mapped loopback (::ffff:127.0.0.1)', async function() {
        var r = await startOutcome({ host: '::ffff:127.0.0.1' });
        assert.doesNotMatch(r.message, REFUSAL);
    });

    it('recognises a bracketed IPv6 loopback ([::1])', async function() {
        var r = await startOutcome({ host: '[::1]' });
        assert.doesNotMatch(r.message, REFUSAL);
    });
});


// ---------------------------------------------------------------------------
// 02 — non-loopback bind requires a token
// ---------------------------------------------------------------------------

describe('02 - non-loopback bind requires a bearer token', function() {

    it('refuses a non-loopback bind with no token, naming the address', async function() {
        var r = await startOutcome({ host: UNBINDABLE });
        assert.equal(r.started, false);
        assert.match(r.message, REFUSAL);
        assert.match(r.message, /non-loopback address/);
        assert.ok(r.message.indexOf(UNBINDABLE) > -1, 'the message should name the bind address');
    });

    it('refuses 0.0.0.0 with no token', async function() {
        var r = await startOutcome({ host: '0.0.0.0' });
        assert.equal(r.started, false);
        assert.match(r.message, REFUSAL);
    });

    it('refuses :: (all interfaces, v6) with no token', async function() {
        var r = await startOutcome({ host: '::' });
        assert.equal(r.started, false);
        assert.match(r.message, REFUSAL);
    });

    // CONTROL for the three above: same address, token supplied. The gate must
    // let it through to the real bind, which then fails on the OS error. If
    // this ever produced OUR refusal message, the gate would be over-refusing.
    it('CONTROL — with a token the gate lets a non-loopback bind through', async function() {
        var r = await startOutcome({ host: UNBINDABLE, authToken: 's3cr3t' });
        assert.equal(r.started, false, 'TEST-NET-1 is unbindable, so start still fails');
        assert.doesNotMatch(r.message, REFUSAL, 'but NOT with the fail-closed refusal');
    });

    it('CONTROL — allowInsecure also lets a non-loopback bind through', async function() {
        var r = await startOutcome({ host: UNBINDABLE, allowInsecure: true });
        assert.equal(r.started, false);
        assert.doesNotMatch(r.message, REFUSAL);
    });
});


// ---------------------------------------------------------------------------
// 03 — wildcard Origin allowlist requires a token, even on loopback
// ---------------------------------------------------------------------------
//
// Disabling the Origin check removes the only defence against a DNS-rebinding
// attack driven from an arbitrary web page. The loopback bind does not help
// there — the browser is already on the machine.

describe('03 - wildcard Origin allowlist requires a bearer token', function() {

    it('refuses loopback + wildcard origins + no token', async function() {
        var r = await startOutcome({ host: '127.0.0.1', allowedOrigins: ['*'] });
        assert.equal(r.started, false);
        assert.match(r.message, REFUSAL);
        assert.match(r.message, /Origin allowlist is disabled/);
    });

    it('starts when the wildcard is paired with a token', async function() {
        var r = await startOutcome({ host: '127.0.0.1', allowedOrigins: ['*'], authToken: 's3cr3t' });
        assert.equal(r.started, true);
    });

    it('starts when the wildcard is paired with allowInsecure', async function() {
        var r = await startOutcome({ host: '127.0.0.1', allowedOrigins: ['*'], allowInsecure: true });
        assert.equal(r.started, true);
    });

    it('a NON-wildcard extra origin does not trigger the refusal', async function() {
        var r = await startOutcome({ host: '127.0.0.1', allowedOrigins: ['http://example.com'] });
        assert.equal(r.started, true);
    });
});


// ---------------------------------------------------------------------------
// 04 — allowInsecure is a strict boolean
// ---------------------------------------------------------------------------

describe('04 - allowInsecure is a strict boolean', function() {

    it('does not accept the string "true"', async function() {
        var r = await startOutcome({ host: UNBINDABLE, allowInsecure: 'true' });
        assert.equal(r.started, false);
        assert.match(r.message, REFUSAL);
    });

    it('does not accept 1', async function() {
        var r = await startOutcome({ host: UNBINDABLE, allowInsecure: 1 });
        assert.equal(r.started, false);
        assert.match(r.message, REFUSAL);
    });

    it('does not accept a truthy object', async function() {
        var r = await startOutcome({ host: UNBINDABLE, allowInsecure: {} });
        assert.equal(r.started, false);
        assert.match(r.message, REFUSAL);
    });
});


// ---------------------------------------------------------------------------
// 05 — constant-time bearer compare (no length oracle)
// ---------------------------------------------------------------------------

describe('05 - bearer compare hashes both sides', function() {

    it('hashes the configured token once, at construction', function() {
        assert.match(SRC_TXT, /var authTokenHash = authToken/);
        assert.match(SRC_TXT, /createHash\('sha256'\)\.update\(authToken, 'utf8'\)\.digest\(\)/);
    });

    it('hashes the presented token before comparing', function() {
        assert.match(SRC_TXT, /createHash\('sha256'\)\.update\(presented, 'utf8'\)\.digest\(\)/);
        assert.match(SRC_TXT, /timingSafeEqual\(presentedHash, authTokenHash\)/);
    });

    it('no longer short-circuits on a raw length mismatch', function() {
        assert.doesNotMatch(SRC_TXT, /if \(expected\.length !== actual\.length\) return false;/);
    });

    it('no longer builds raw token buffers for the compare', function() {
        assert.doesNotMatch(SRC_TXT, /Buffer\.from\(authToken, 'utf8'\)/);
    });
});


// ---------------------------------------------------------------------------
// 06 — the start gate is source-pinned where it matters
// ---------------------------------------------------------------------------

describe('06 - fail-closed gate wiring', function() {

    it('refuses BEFORE creating the http server', function() {
        var gateIdx   = SRC_TXT.indexOf('var exposure = describeExposure();');
        var createIdx = SRC_TXT.indexOf('var server = http.createServer(handleHttpRequest);');
        assert.ok(gateIdx > -1,   'the gate must be present in start()');
        assert.ok(createIdx > -1, 'the server creation must be present');
        assert.ok(gateIdx < createIdx,
            'the exposure gate must run before the listener is created');
    });

    it('treats an unrecognised host as exposed (fail-closed)', function() {
        assert.match(SRC_TXT, /if \(!isLoopbackBind\(host\)\)/);
    });

    it('waives the gate on a token or an explicit allowInsecure', function() {
        assert.match(SRC_TXT, /if \(authToken \|\| allowInsecure\) return null;/);
    });
});
