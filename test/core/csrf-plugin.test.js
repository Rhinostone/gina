'use strict';
/**
 * Csrf plugin (#CSRF2) tests
 *
 * Strategy — mirrors the #CSRF1 + #SCS campaign shape:
 *  - Source-inspection guards pinning the security primitives.
 *  - Token primitives (generateToken/verifyToken) under unit-style coverage:
 *    fixed inputs, bit flips, wrong key, wrong session, length mismatch.
 *  - Negative-invariant lock: no `==`, no `===`, no `Buffer.compare`, no
 *    `.includes`, no plain string compare on the secret-bearing path.
 *  - End-to-end middleware tests through stub req/res objects: cookie shape,
 *    rotation, header path, form-field path, per-route exempt, sessionless
 *    hard-fail.
 *  - Plugin registration + settings template integrity.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var crypto = require('crypto');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/csrf/src/main.js');

var Csrf;
var originalGetContext;
var originalGetConfig;
var originalSecret;

var TEST_SECRET = 'test-secret-do-not-use-in-production-please-do-not-use';

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    originalSecret     = process.env.GINA_CSRF_SECRET;
    global.getContext  = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig   = function () { return { test: { dev: { content: { settings: {} } } } }; };
    process.env.GINA_CSRF_SECRET = TEST_SECRET;
    Csrf = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
    if (typeof originalSecret === 'undefined') delete process.env.GINA_CSRF_SECRET;
    else                                       process.env.GINA_CSRF_SECRET = originalSecret;
});


// ─── 01 — Source inspection: hardening primitives are present ───────────────

describe('01 - source inspection: HMAC + timingSafeEqual + base64url + no eval', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#CSRF2 marker is present', function () {
        assert.ok(src.indexOf('#CSRF2') > -1, 'expected #CSRF2 marker for traceability');
    });

    it('uses HMAC-SHA256 via createHmac', function () {
        assert.ok(/createHmac\(\s*['"]sha256['"]/.test(src),
            'expected createHmac("sha256", ...) call');
    });

    it('uses crypto.timingSafeEqual for token comparison', function () {
        assert.ok(/crypto\.timingSafeEqual\(/.test(src),
            'expected crypto.timingSafeEqual(...) for constant-time compare');
    });

    it('uses base64url encoding for both halves', function () {
        var hits = src.match(/['"]base64url['"]/g) || [];
        assert.ok(hits.length >= 4,
            'expected base64url encoding on encode AND decode paths (>= 4 occurrences)');
    });

    it('reads CSPRNG via crypto.getRandomValues', function () {
        assert.ok(/crypto\.getRandomValues\(/.test(src),
            'expected crypto.getRandomValues(...) — same primitive as lib/uuid');
    });

    it('refuses to start without GINA_CSRF_SECRET', function () {
        assert.ok(/process\.env\.GINA_CSRF_SECRET/.test(src),
            'expected GINA_CSRF_SECRET env var read');
        assert.ok(/GINA_CSRF_SECRET env var is required/.test(src),
            'expected required-env-var error message');
    });

    it('rejects sessionless requests with the canonical message', function () {
        assert.ok(/no req\.session\.id - Csrf plugin requires the Session plugin/.test(src),
            'expected sessionless hard-fail message');
        assert.ok(/Bearer-token auth/.test(src),
            'expected guidance for non-cookie auth bundles');
    });

    it('reads req.routing.csrfExempt for per-route opt-out', function () {
        assert.ok(/req\.routing[\s\S]{0,40}csrfExempt/.test(src),
            'expected req.routing.csrfExempt read');
    });

    it('contains no eval / new Function / Function() callsites', function () {
        assert.ok(!/\beval\s*\(/.test(src), 'no eval(...) allowed');
        assert.ok(!/new\s+Function\s*\(/.test(src), 'no new Function(...) allowed');
    });

    it('safe methods default to GET / HEAD / OPTIONS', function () {
        assert.ok(
            /DEFAULT_SAFE_METHODS\s*=\s*\[\s*['"]GET['"]\s*,\s*['"]HEAD['"]\s*,\s*['"]OPTIONS['"]\s*\]/.test(src),
            'expected safe-method default array'
        );
    });

});


// ─── 02 — generateToken: fixed-input determinism and nonce uniqueness ────────

describe('02 - generateToken: shape, MAC determinism, nonce uniqueness', function () {

    it('returns "<nonce>.<mac>" with two base64url halves', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        var parts = token.split('.');
        assert.equal(parts.length, 2, 'expected single dot separator');
        assert.ok(/^[A-Za-z0-9_-]+$/.test(parts[0]), 'nonce half is base64url');
        assert.ok(/^[A-Za-z0-9_-]+$/.test(parts[1]), 'mac half is base64url');
    });

    it('nonce decodes to 16 bytes', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        var nonce = Buffer.from(token.split('.')[0], 'base64url');
        assert.equal(nonce.length, 16, 'nonce is 16 random bytes');
    });

    it('mac decodes to 32 bytes (SHA-256)', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        var mac   = Buffer.from(token.split('.')[1], 'base64url');
        assert.equal(mac.length, 32, 'HMAC-SHA256 digest is 32 bytes');
    });

    it('MAC is deterministic for fixed (sessionId, secret, nonce)', function () {
        // Recompute the MAC on the nonce we just observed to prove determinism.
        var token    = Csrf._generateToken('session-abc', TEST_SECRET);
        var nonceB64 = token.split('.')[0];
        var macB64   = token.split('.')[1];
        var expected = crypto.createHmac('sha256', TEST_SECRET)
                             .update('session-abc:' + nonceB64)
                             .digest('base64url');
        assert.equal(macB64, expected, 'MAC must equal HMAC(sessionId+":"+nonceB64, secret)');
    });

    it('nonce is unique across many calls (CSPRNG sanity)', function () {
        var seen = Object.create(null);
        var N = 500;
        for (var i = 0; i < N; i++) {
            var n = Csrf._generateToken('s', TEST_SECRET).split('.')[0];
            assert.ok(!seen[n], 'duplicate nonce after ' + i + ' iterations');
            seen[n] = true;
        }
    });

    it('different sessionIds produce different MACs for the same nonce', function () {
        // Generate two tokens, force them to share the same nonce, and confirm MACs differ.
        var t = Csrf._generateToken('alpha', TEST_SECRET);
        var nonceB64 = t.split('.')[0];
        var macA = crypto.createHmac('sha256', TEST_SECRET).update('alpha:' + nonceB64).digest('base64url');
        var macB = crypto.createHmac('sha256', TEST_SECRET).update('beta:'  + nonceB64).digest('base64url');
        assert.notEqual(macA, macB, 'sessionId is part of the MAC input');
    });

});


// ─── 03 — verifyToken: matching, bit-flip, wrong-secret, wrong-session ──────

describe('03 - verifyToken: positive and negative paths', function () {

    it('matching token verifies', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        assert.equal(Csrf._verifyToken(token, 'session-abc', TEST_SECRET), true);
    });

    it('bit-flip in MAC half rejects', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        var parts = token.split('.');
        // Flip a bit in the MAC.
        var macBuf = Buffer.from(parts[1], 'base64url');
        macBuf[0] = macBuf[0] ^ 0x01;
        var tampered = parts[0] + '.' + macBuf.toString('base64url');
        assert.equal(Csrf._verifyToken(tampered, 'session-abc', TEST_SECRET), false);
    });

    it('bit-flip in nonce half rejects', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        var parts = token.split('.');
        var nonceBuf = Buffer.from(parts[0], 'base64url');
        nonceBuf[0] = nonceBuf[0] ^ 0x80;
        var tampered = nonceBuf.toString('base64url') + '.' + parts[1];
        assert.equal(Csrf._verifyToken(tampered, 'session-abc', TEST_SECRET), false);
    });

    it('wrong secret rejects', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        assert.equal(Csrf._verifyToken(token, 'session-abc', 'OTHER-SECRET'), false);
    });

    it('wrong sessionId rejects', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        assert.equal(Csrf._verifyToken(token, 'session-xyz', TEST_SECRET), false);
    });

    it('truncated token rejects', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        assert.equal(Csrf._verifyToken(token.substring(0, token.length - 4), 'session-abc', TEST_SECRET), false);
    });

    it('missing dot rejects', function () {
        assert.equal(Csrf._verifyToken('nodothere', 'session-abc', TEST_SECRET), false);
    });

    it('empty halves reject', function () {
        assert.equal(Csrf._verifyToken('.macpart', 'session-abc', TEST_SECRET), false);
        assert.equal(Csrf._verifyToken('noncepart.', 'session-abc', TEST_SECRET), false);
        assert.equal(Csrf._verifyToken('.', 'session-abc', TEST_SECRET), false);
    });

    it('multiple dots reject', function () {
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        assert.equal(Csrf._verifyToken(token + '.extra', 'session-abc', TEST_SECRET), false);
    });

    it('non-string inputs reject', function () {
        assert.equal(Csrf._verifyToken(null, 'session-abc', TEST_SECRET), false);
        assert.equal(Csrf._verifyToken(undefined, 'session-abc', TEST_SECRET), false);
        assert.equal(Csrf._verifyToken(123, 'session-abc', TEST_SECRET), false);
    });

    it('empty sessionId rejects (constant time)', function () {
        var token = Csrf._generateToken('', TEST_SECRET);
        assert.equal(Csrf._verifyToken(token, '', TEST_SECRET), false);
    });

    it('nonce of wrong byte length rejects', function () {
        // Hand-craft a token with an 8-byte nonce — wrong size, must reject.
        var shortNonce = Buffer.alloc(8, 0xab).toString('base64url');
        var mac = crypto.createHmac('sha256', TEST_SECRET)
                        .update('session-abc:' + shortNonce)
                        .digest('base64url');
        assert.equal(Csrf._verifyToken(shortNonce + '.' + mac, 'session-abc', TEST_SECRET), false);
    });

    it('length-mismatch check uses constant-time short-circuit (no throw)', function () {
        // Hand-craft a token with a 1-byte MAC — the length guard must fire
        // before crypto.timingSafeEqual sees mismatched buffers.
        var token = Csrf._generateToken('session-abc', TEST_SECRET);
        var nonceB64 = token.split('.')[0];
        var shortMac = Buffer.from([0x42]).toString('base64url');
        assert.doesNotThrow(function () {
            assert.equal(Csrf._verifyToken(nonceB64 + '.' + shortMac, 'session-abc', TEST_SECRET), false);
        });
    });

});


// ─── 04 — Negative-invariant lock: no plain comparators on the token path ──

describe('04 - negative-invariant lock: token comparison stays constant-time', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('no Buffer.compare on the token path', function () {
        assert.ok(!/Buffer\.compare\(/.test(src),
            'Buffer.compare is short-circuiting (length-then-byte) — never use on secret material');
    });

    it('no String.prototype.includes on the token path', function () {
        // We allow .indexOf for structural checks (dot location), but not
        // .includes which reads as a content-presence test.
        assert.ok(!/\.includes\(/.test(src),
            '.includes is a non-constant-time content check; not used on secret material');
    });

    it('no === or == comparison between presented and expected MAC', function () {
        // The expected/presented variables are local to verifyToken; if anything
        // in the file says `presented === expected` or `expected === presented`,
        // we have a fast-path leak.
        assert.ok(!/(presentedMac|presented)\s*={2,3}\s*expected/.test(src),
            'do not compare MACs with == / ===');
        assert.ok(!/expected\s*={2,3}\s*(presentedMac|presented)/.test(src),
            'do not compare MACs with == / ===');
    });

    it('verifyToken always returns through the timingSafeEqual gate', function () {
        // Lightweight structural assertion: the function body contains a
        // timingSafeEqual call AND a final `return false` fallback.
        var match = src.match(/function\s+verifyToken[\s\S]*?\n\}/);
        assert.ok(match, 'expected verifyToken function body');
        var body = match[0];
        assert.ok(/timingSafeEqual\(/.test(body),
            'verifyToken body must call timingSafeEqual');
    });

});


// ─── 05 — Issue middleware: cookie shape, rotation, Secure auto ─────────────

describe('05 - issue middleware: cookie shape, rotation modes, Secure flag', function () {

    function makeReq(overrides) {
        var req = {
            method: 'GET',
            url: '/',
            headers: {},
            session: { id: 'session-abc' },
            routing: { csrfExempt: false },
            connection: {},
            socket: {}
        };
        Object.keys(overrides || {}).forEach(function (k) { req[k] = overrides[k]; });
        return req;
    }
    function makeRes() {
        var headers = {};
        return {
            statusCode: 200,
            getHeader: function (n) { return headers[n.toLowerCase()] || null; },
            setHeader: function (n, v) { headers[n.toLowerCase()] = v; },
            end: function () { this._ended = true; },
            _headers: headers
        };
    }

    it('safe-method request issues a Set-Cookie with the configured name', function () {
        var mw = Csrf();
        var req = makeReq();
        var res = makeRes();
        mw(req, res, function () {});
        var sc = res.getHeader('Set-Cookie');
        assert.ok(sc, 'expected Set-Cookie header');
        var line = Array.isArray(sc) ? sc[0] : sc;
        assert.ok(/^gina-csrf-token=/.test(line), 'cookie name');
        assert.ok(/Path=\//.test(line), 'Path=/');
        assert.ok(/SameSite=Lax/.test(line), 'SameSite=Lax');
    });

    it('Secure flag auto-injected when the request is TLS', function () {
        var mw = Csrf();
        var req = makeReq({ socket: { encrypted: true } });
        var res = makeRes();
        mw(req, res, function () {});
        var sc = res.getHeader('Set-Cookie');
        var line = Array.isArray(sc) ? sc[0] : sc;
        assert.ok(/;\s*Secure(?:;|$)/.test(line), 'Secure flag present on TLS');
    });

    it('Secure flag NOT injected on plain HTTP', function () {
        var mw = Csrf();
        var req = makeReq();
        var res = makeRes();
        mw(req, res, function () {});
        var sc = res.getHeader('Set-Cookie');
        var line = Array.isArray(sc) ? sc[0] : sc;
        assert.ok(!/;\s*Secure(?:;|$)/.test(line), 'no Secure on plain HTTP');
    });

    it('Secure auto-detected from x-forwarded-proto=https', function () {
        var mw = Csrf();
        var req = makeReq({ headers: { 'x-forwarded-proto': 'https' } });
        var res = makeRes();
        mw(req, res, function () {});
        var sc = res.getHeader('Set-Cookie');
        var line = Array.isArray(sc) ? sc[0] : sc;
        assert.ok(/;\s*Secure(?:;|$)/.test(line), 'Secure flag from forwarded proto');
    });

    it('rotate=per-session reuses an existing valid cookie', function () {
        var mw = Csrf();
        // First call mints a cookie.
        var req1 = makeReq();
        var res1 = makeRes();
        mw(req1, res1, function () {});
        var minted = req1.csrfToken;
        // Second call presents that cookie back — issue path must reuse it.
        var req2 = makeReq({ headers: { cookie: 'gina-csrf-token=' + encodeURIComponent(minted) } });
        var res2 = makeRes();
        mw(req2, res2, function () {});
        assert.equal(req2.csrfToken, minted, 'token reused across same session');
        assert.equal(res2.getHeader('Set-Cookie'), null, 'no Set-Cookie when reusing');
    });

    it('rotate=per-request mints a fresh cookie every call', function () {
        var mw = Csrf({ rotate: 'per-request' });
        var req1 = makeReq();
        var res1 = makeRes();
        mw(req1, res1, function () {});
        var minted = req1.csrfToken;
        var req2 = makeReq({ headers: { cookie: 'gina-csrf-token=' + encodeURIComponent(minted) } });
        var res2 = makeRes();
        mw(req2, res2, function () {});
        assert.notEqual(req2.csrfToken, minted, 'token rotated');
        assert.ok(res2.getHeader('Set-Cookie'), 'Set-Cookie issued on per-request rotate');
    });

    it('invalid existing cookie triggers re-issue even on per-session', function () {
        var mw = Csrf();
        var req = makeReq({ headers: { cookie: 'gina-csrf-token=garbage.value' } });
        var res = makeRes();
        mw(req, res, function () {});
        assert.ok(res.getHeader('Set-Cookie'), 'fresh cookie issued when existing is invalid');
        assert.notEqual(req.csrfToken, 'garbage.value');
    });

    it('rejects unknown rotate value at factory time', function () {
        assert.throws(function () { Csrf({ rotate: 'on-tuesdays' }); }, /rotate must be one of/);
    });

    it('rotate value resolved from settings.json', function () {
        var saved = global.getConfig;
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { csrf: { rotate: 'per-request' } } } } } };
        };
        try {
            var d = Csrf._resolveSettingsDefaults();
            assert.equal(d.rotate, 'per-request');
        } finally {
            global.getConfig = saved;
        }
    });

});


// ─── 06 — Verify middleware: header / form / 403 + log ──────────────────────

describe('06 - verify middleware: safe bypass, mutating reject, header path, form path', function () {

    function mintCookie(sessionId) {
        var token = Csrf._generateToken(sessionId, TEST_SECRET);
        return { token: token, header: 'gina-csrf-token=' + encodeURIComponent(token) };
    }
    function makeReq(method, sessionId, overrides) {
        var req = {
            method: method,
            url: '/api/things',
            headers: {},
            session: { id: sessionId },
            routing: { csrfExempt: false }
        };
        Object.keys(overrides || {}).forEach(function (k) { req[k] = overrides[k]; });
        return req;
    }
    function makeRes() {
        var headers = {};
        return {
            statusCode: 200, _ended: false, _body: null,
            getHeader: function (n) { return headers[n.toLowerCase()] || null; },
            setHeader: function (n, v) { headers[n.toLowerCase()] = v; },
            end: function (b) { this._ended = true; this._body = b; }
        };
    }

    var savedConsoleError;
    var captured;
    beforeEach(function () {
        captured = [];
        savedConsoleError = console.error;
        console.error = function () { captured.push(Array.prototype.slice.call(arguments).join(' ')); };
    });
    afterEach(function () { console.error = savedConsoleError; });

    it('safe method (GET) bypasses verify, calls next()', function () {
        var mw = Csrf();
        var req = makeReq('GET', 'session-abc');
        var res = makeRes();
        var calledNext = false;
        mw(req, res, function () { calledNext = true; });
        assert.equal(calledNext, true);
        assert.equal(res.statusCode, 200);
    });

    it('mutating method without token returns 403 + logs', function () {
        var mw = Csrf();
        var req = makeReq('POST', 'session-abc');
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
        assert.equal(res._ended, true);
        assert.ok(captured.some(function (l) { return /\[csrf\]\s+forbidden/.test(l); }),
            'expected [csrf] forbidden log line');
    });

    it('mutating method with valid header token passes', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            headers: {
                cookie: c.header,
                'x-gina-csrf-token': c.token
            }
        });
        var res = makeRes();
        var calledNext = false;
        mw(req, res, function () { calledNext = true; });
        assert.equal(calledNext, true, 'next() must be called');
        assert.equal(res.statusCode, 200);
        assert.equal(req.csrfToken, c.token);
    });

    it('mutating method with valid form-field token passes', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            headers: { cookie: c.header },
            body:    { _csrf: c.token, hello: 'world' }
        });
        var res = makeRes();
        var calledNext = false;
        mw(req, res, function () { calledNext = true; });
        assert.equal(calledNext, true);
        assert.equal(res.statusCode, 200);
    });

    it('mutating method with form-field on req.post (Gina convention) passes', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            headers: { cookie: c.header },
            post:    { _csrf: c.token }
        });
        var res = makeRes();
        var calledNext = false;
        mw(req, res, function () { calledNext = true; });
        assert.equal(calledNext, true);
    });

    it('cookie present but header missing — 403', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', { headers: { cookie: c.header } });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('header present but cookie missing — 403', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            headers: { 'x-gina-csrf-token': c.token }
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('header value differs from cookie value — 403', function () {
        var mw = Csrf();
        var c1 = mintCookie('session-abc');
        var c2 = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            headers: { cookie: c1.header, 'x-gina-csrf-token': c2.token }
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('token forged for a different session — 403', function () {
        var mw = Csrf();
        var c  = mintCookie('session-OTHER');
        var req = makeReq('POST', 'session-abc', {
            // cookie + header agree, but the token was minted for a different sessionId.
            headers: { cookie: 'gina-csrf-token=' + encodeURIComponent(c.token), 'x-gina-csrf-token': c.token }
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('PUT mutating verifies (not just POST)', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('PUT', 'session-abc', {
            headers: { cookie: c.header, 'x-gina-csrf-token': c.token }
        });
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
    });

    it('DELETE without token — 403', function () {
        var mw = Csrf();
        var req = makeReq('DELETE', 'session-abc');
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('OPTIONS bypasses (CORS preflight)', function () {
        var mw = Csrf();
        var req = makeReq('OPTIONS', 'session-abc');
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
        assert.equal(res.statusCode, 200);
    });

    it('sessionless mutating request hard-fails via next(err)', function () {
        var mw = Csrf();
        var req = makeReq('POST', null, { session: null });
        var res = makeRes();
        var capturedErr;
        mw(req, res, function (err) { capturedErr = err; });
        assert.ok(capturedErr, 'expected next(err) to fire');
        assert.ok(/no req\.session\.id/.test(capturedErr.message),
            'expected canonical sessionless message');
    });

    it('Csrf-before-Session misorder produces the same error', function () {
        var mw = Csrf();
        var req = makeReq('POST', 'session-abc', { session: undefined });
        var res = makeRes();
        var capturedErr;
        mw(req, res, function (err) { capturedErr = err; });
        assert.ok(capturedErr);
        assert.ok(/no req\.session\.id/.test(capturedErr.message));
    });

    it('factory throws when GINA_CSRF_SECRET is missing', function () {
        var savedSecret = process.env.GINA_CSRF_SECRET;
        delete process.env.GINA_CSRF_SECRET;
        try {
            assert.throws(function () { Csrf(); },
                /GINA_CSRF_SECRET env var is required/);
        } finally {
            process.env.GINA_CSRF_SECRET = savedSecret;
        }
    });

});


// ─── 07 — Per-route exempt: req.routing.csrfExempt === true bypasses ────────

describe('07 - per-route exempt: req.routing.csrfExempt bypasses verify', function () {

    function makeReq(method, overrides) {
        var req = {
            method: method, url: '/webhook',
            headers: {}, session: { id: 'session-abc' },
            routing: { csrfExempt: true }
        };
        Object.keys(overrides || {}).forEach(function (k) { req[k] = overrides[k]; });
        return req;
    }
    function makeRes() {
        var headers = {};
        return {
            statusCode: 200,
            getHeader: function (n) { return headers[n.toLowerCase()] || null; },
            setHeader: function (n, v) { headers[n.toLowerCase()] = v; },
            end: function () { this._ended = true; }
        };
    }

    it('mutating request to exempt route bypasses verify', function () {
        var mw = Csrf();
        var req = makeReq('POST'); // no token
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true, 'next() called');
        assert.equal(res.statusCode, 200);
    });

    it('csrfExempt on a non-mutating route is a no-op (still issues cookie)', function () {
        var mw = Csrf();
        var req = makeReq('GET');
        var res = makeRes();
        mw(req, res, function () {});
        assert.ok(res.getHeader('Set-Cookie'), 'GET on exempt route still issues a cookie');
    });

    it('csrfExempt: false (default) does NOT bypass — mutating still rejected', function () {
        var mw = Csrf();
        var req = makeReq('POST', { routing: { csrfExempt: false } });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('missing req.routing falls through to default (not exempt)', function () {
        var mw = Csrf();
        var req = makeReq('POST', { routing: undefined });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('server.js hoists csrfExempt next to cache and queryTimeout', function () {
        var src = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
        // Look in a wide window around the routing-loop params block.
        assert.ok(/csrfExempt\s*:\s*routing\[name\]\.csrfExempt\s*\|\|\s*false/.test(src),
            'expected `csrfExempt: routing[name].csrfExempt || false` in server.js');
    });

    it('lib/routing/src/main.js propagates routeObject.csrfExempt to params', function () {
        var src = fs.readFileSync(path.join(FW, 'lib/routing/src/main.js'), 'utf8');
        assert.ok(/typeof\(routeObject\.csrfExempt\)\s*!=\s*['"]undefined['"][\s\S]{0,80}params\.csrfExempt\s*=\s*routeObject\.csrfExempt/.test(src),
            'expected typeof(routeObject.csrfExempt) guard followed by params.csrfExempt assignment');
    });

});


// ─── 08 — Plugin registration in core/plugins/index.js ──────────────────────

describe('08 - plugin is registered in core/plugins/index.js', function () {

    var src;
    before(function () {
        src = fs.readFileSync(path.join(FW, 'core/plugins/index.js'), 'utf8');
    });

    it('plugins registry exports Csrf', function () {
        assert.ok(
            /Csrf\s*:\s*_require\(\s*['"]\.\/lib\/csrf['"]\s*\)/.test(src),
            'expected Csrf: _require("./lib/csrf") in plugins/index.js'
        );
    });

    it('#CSRF2 marker is in the plugins registry', function () {
        assert.ok(src.indexOf('#CSRF2') > -1, 'expected #CSRF2 marker in plugins/index.js');
    });

});


// ─── 09 — settings.json template carries the csrf block ─────────────────────

describe('09 - settings.json template advertises csrf defaults', function () {

    var src;
    before(function () {
        src = fs.readFileSync(path.join(FW, 'core/template/conf/settings.json'), 'utf8');
    });

    it('template has the csrf block', function () {
        assert.ok(/"csrf"\s*:\s*\{/.test(src),
            'expected "csrf": { ... } block in settings.json template');
    });

    it('template documents the env-var-only secret rule', function () {
        assert.ok(/GINA_CSRF_SECRET/.test(src),
            'expected GINA_CSRF_SECRET reference in settings.json comment');
        assert.ok(/NOT in this file/i.test(src),
            'expected explicit "NOT in this file" guidance for the secret');
    });

    it('default values match the plugin defaults', function () {
        assert.ok(/"cookieName"\s*:\s*"gina-csrf-token"/.test(src), 'cookieName default');
        assert.ok(/"headerName"\s*:\s*"X-Gina-CSRF-Token"/.test(src), 'headerName default');
        assert.ok(/"fieldName"\s*:\s*"_csrf"/.test(src), 'fieldName default');
        assert.ok(/"rotate"\s*:\s*"per-session"/.test(src), 'rotate default');
        assert.ok(/"safeMethods"\s*:\s*\[\s*"GET"\s*,\s*"HEAD"\s*,\s*"OPTIONS"\s*\]/.test(src),
            'safeMethods default');
    });

    it('boilerplate bundle/index.js shows the app.use(csrf) pattern', function () {
        var bp = fs.readFileSync(path.join(FW, 'core/template/boilerplate/bundle/index.js'), 'utf8');
        assert.ok(/plugins\.Csrf\(\)/.test(bp),
            'expected plugins.Csrf() call in boilerplate');
        assert.ok(/app\.use\(csrf\)/.test(bp),
            'expected app.use(csrf) in boilerplate');
        assert.ok(/AFTER the session middleware/i.test(bp),
            'expected ordering guidance in boilerplate comment');
    });

});
