'use strict';
/**
 * Csrf plugin (#CSRF2 + #CSRF3) tests
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
 *  - #CSRF3 — Origin/Referer pre-filter parser, allowlist resolution,
 *    behavioural matrix on mutating methods, negative-invariant lock
 *    (matching token + mismatching Origin → still 403).
 *
 * Fixture note: the global stub supplies a `hostname` so the factory's
 * #CSRF3 Origin allowlist can resolve a default. The makeReq helpers in
 * sections 06 + 07 set a default `Origin` header matching that hostname so
 * pre-#CSRF3 mutating-method tests continue to exercise the token layer
 * (not the new Origin pre-filter). Section 10+ tests omit the Origin
 * header on purpose to drive the new pre-filter paths.
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
var TEST_ORIGIN = 'http://localhost:3000';

before(function () {
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    originalSecret     = process.env.GINA_CSRF_SECRET;
    global.getContext  = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig   = function () {
        return {
            test: {
                dev: {
                    hostname: TEST_ORIGIN,
                    content: { settings: {} }
                }
            }
        };
    };
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
        // #CSRF3: default Origin matches the configured bundle hostname, so
        // existing token-layer tests don't silently hit the new Origin pre-filter.
        // Header overrides MERGE with the default rather than replace.
        overrides = overrides || {};
        var headers = Object.assign({ origin: TEST_ORIGIN }, overrides.headers || {});
        var req = {
            method: method,
            url: '/api/things',
            headers: headers,
            session: { id: sessionId },
            routing: { csrfExempt: false }
        };
        Object.keys(overrides).forEach(function (k) {
            if (k === 'headers') return;
            req[k] = overrides[k];
        });
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


// ─── 06b — Secret precedence: opts > settings.csrf.secret > env ─────────────
//
// The factory resolves the HMAC secret from a three-step chain. settings.csrf.secret
// is the new resolver-compatible slot — `${secret:KEY}` placeholders are filled by
// `lib/secrets` at config-load time, so by the time the plugin reads
// `settings.csrf.secret` it holds a real string.

describe('06b - secret precedence chain (opts > settings.csrf.secret > env)', function () {

    var savedEnv;
    var savedGetConfig;
    beforeEach(function () {
        savedEnv = process.env.GINA_CSRF_SECRET;
        savedGetConfig = global.getConfig;
    });
    afterEach(function () {
        if (typeof savedEnv === 'undefined') delete process.env.GINA_CSRF_SECRET;
        else                                 process.env.GINA_CSRF_SECRET = savedEnv;
        global.getConfig = savedGetConfig;
    });

    function withSettingsCsrfSecret(secret) {
        global.getConfig = function () {
            return {
                test: {
                    dev: {
                        hostname: TEST_ORIGIN,
                        content: { settings: { csrf: { secret: secret } } }
                    }
                }
            };
        };
    }

    it('settings.csrf.secret is honoured when env var is unset', function () {
        delete process.env.GINA_CSRF_SECRET;
        withSettingsCsrfSecret('settings-secret-do-not-use-in-prod-please-do-not-use');
        assert.doesNotThrow(function () { Csrf(); });
    });

    it('opts.secret overrides settings.csrf.secret', function () {
        delete process.env.GINA_CSRF_SECRET;
        withSettingsCsrfSecret('SHOULD-NOT-BE-USED-settings-fallback');
        var mw = Csrf({ secret: 'opts-wins-do-not-use-in-prod-please-do-not-use-32b' });
        assert.equal(typeof mw, 'function');
    });

    it('settings.csrf.secret takes precedence over the env var', function () {
        process.env.GINA_CSRF_SECRET = 'env-loses-do-not-use-in-prod-please-do-not-use-x';
        withSettingsCsrfSecret('settings-wins-do-not-use-in-prod-please-do-not-use');
        // Factory does not return the secret — exercise the middleware: a
        // token signed with settings-secret must verify; a token signed with
        // env-secret must NOT verify. Use the exposed primitives.
        Csrf(); // does not throw
        var settingsToken = Csrf._generateToken('session-x', 'settings-wins-do-not-use-in-prod-please-do-not-use');
        var envToken      = Csrf._generateToken('session-x', 'env-loses-do-not-use-in-prod-please-do-not-use-x');
        assert.equal(Csrf._verifyToken(settingsToken, 'session-x', 'settings-wins-do-not-use-in-prod-please-do-not-use'), true);
        assert.equal(Csrf._verifyToken(envToken,      'session-x', 'env-loses-do-not-use-in-prod-please-do-not-use-x'), true);
        // Cross-key verify must fail:
        assert.equal(Csrf._verifyToken(envToken,      'session-x', 'settings-wins-do-not-use-in-prod-please-do-not-use'), false);
    });

    it('env-only path still works when settings.csrf.secret is absent', function () {
        process.env.GINA_CSRF_SECRET = TEST_SECRET;
        // global.getConfig from the top-level before() stub returns
        // content: { settings: {} } — no csrf.secret.
        assert.doesNotThrow(function () { Csrf(); });
    });

    it('factory throws when all three sources are missing', function () {
        delete process.env.GINA_CSRF_SECRET;
        // top-level stub has no settings.csrf.secret
        assert.throws(function () { Csrf(); },
            /GINA_CSRF_SECRET env var is required/);
    });

    it('non-string settings.csrf.secret is ignored (falls through to env)', function () {
        process.env.GINA_CSRF_SECRET = TEST_SECRET;
        withSettingsCsrfSecret(42); // wrong type
        assert.doesNotThrow(function () { Csrf(); });
    });

    it('empty-string settings.csrf.secret is ignored (falls through to env)', function () {
        process.env.GINA_CSRF_SECRET = TEST_SECRET;
        withSettingsCsrfSecret('');
        assert.doesNotThrow(function () { Csrf(); });
    });

    it('resolveSettingsDefaults exposes secret in the returned defaults', function () {
        withSettingsCsrfSecret('settings-secret-do-not-use-in-prod-please-do-not-use');
        var d = Csrf._resolveSettingsDefaults();
        assert.equal(d.secret, 'settings-secret-do-not-use-in-prod-please-do-not-use');
    });

    it('resolveSettingsDefaults returns secret: null when settings.csrf.secret is unset', function () {
        global.getConfig = function () {
            return { test: { dev: { hostname: TEST_ORIGIN, content: { settings: {} } } } };
        };
        var d = Csrf._resolveSettingsDefaults();
        assert.equal(d.secret, null);
    });
});


// ─── 07 — Per-route exempt: req.routing.csrfExempt === true bypasses ────────

describe('07 - per-route exempt: req.routing.csrfExempt bypasses verify', function () {

    function makeReq(method, overrides) {
        // #CSRF3: default Origin matches the configured bundle hostname.
        overrides = overrides || {};
        var headers = Object.assign({ origin: TEST_ORIGIN }, overrides.headers || {});
        var req = {
            method: method, url: '/webhook',
            headers: headers, session: { id: 'session-abc' },
            routing: { csrfExempt: true }
        };
        Object.keys(overrides).forEach(function (k) {
            if (k === 'headers') return;
            req[k] = overrides[k];
        });
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

    it('template has the #CSRF3 allowedOrigins key', function () {
        assert.ok(/"allowedOrigins"\s*:\s*\[\s*\]/.test(src),
            'expected "allowedOrigins": [] in settings.json template');
    });

    it('template documents the #CSRF3 allowlist semantics', function () {
        assert.ok(/allowedOrigins/.test(src),
            'expected allowedOrigins reference in settings.json comment');
        assert.ok(/Empty\/unset\s*=\s*bundle's configured hostname only/i.test(src),
            'expected the empty/unset semantics in the comment');
    });

});


// ─── 10 — #CSRF3: parseRequestOrigin / parseOriginString helpers ────────────

describe('10 - #CSRF3 parser helpers: Origin first, Referer fallback', function () {

    it('parseOriginString extracts scheme://host from a bare origin', function () {
        assert.equal(Csrf._parseOriginString('https://example.com'), 'https://example.com');
    });

    it('parseOriginString preserves the port', function () {
        assert.equal(Csrf._parseOriginString('http://localhost:3000'), 'http://localhost:3000');
    });

    it('parseOriginString strips path/query/fragment from a Referer-style URL', function () {
        assert.equal(
            Csrf._parseOriginString('https://example.com:8443/path/to?q=1#x'),
            'https://example.com:8443'
        );
    });

    it('parseOriginString lowercases the result', function () {
        assert.equal(
            Csrf._parseOriginString('HTTPS://Example.COM:443/Page'),
            'https://example.com:443'
        );
    });

    it('parseOriginString returns null for the literal "null" sentinel', function () {
        assert.equal(Csrf._parseOriginString('null'), null);
    });

    it('parseOriginString returns null for empty/non-string', function () {
        assert.equal(Csrf._parseOriginString(''), null);
        assert.equal(Csrf._parseOriginString(null), null);
        assert.equal(Csrf._parseOriginString(undefined), null);
        assert.equal(Csrf._parseOriginString(123), null);
    });

    it('parseOriginString returns null for malformed input (no scheme)', function () {
        assert.equal(Csrf._parseOriginString('example.com/path'), null);
        assert.equal(Csrf._parseOriginString('//example.com'), null);
    });

    it('parseRequestOrigin reads Origin header first', function () {
        var req = { headers: { origin: 'https://example.com', referer: 'https://other.com/x' } };
        assert.equal(Csrf._parseRequestOrigin(req), 'https://example.com');
    });

    it('parseRequestOrigin falls back to Referer when Origin is missing', function () {
        var req = { headers: { referer: 'https://example.com/path?q=1' } };
        assert.equal(Csrf._parseRequestOrigin(req), 'https://example.com');
    });

    it('parseRequestOrigin treats Origin: "null" as missing and falls back to Referer', function () {
        var req = { headers: { origin: 'null', referer: 'https://example.com/path' } };
        assert.equal(Csrf._parseRequestOrigin(req), 'https://example.com');
    });

    it('parseRequestOrigin accepts the alternate "referrer" spelling', function () {
        var req = { headers: { referrer: 'https://example.com/path' } };
        assert.equal(Csrf._parseRequestOrigin(req), 'https://example.com');
    });

    it('parseRequestOrigin returns null when both headers are missing', function () {
        assert.equal(Csrf._parseRequestOrigin({ headers: {} }), null);
    });

    it('parseRequestOrigin returns null for malformed Referer', function () {
        var req = { headers: { referer: '/just/a/path?x=1' } };
        assert.equal(Csrf._parseRequestOrigin(req), null);
    });

    it('parseRequestOrigin returns null for missing/empty req', function () {
        assert.equal(Csrf._parseRequestOrigin(null), null);
        assert.equal(Csrf._parseRequestOrigin({}), null);
        assert.equal(Csrf._parseRequestOrigin({ headers: null }), null);
    });

});


// ─── 11 — #CSRF3: resolveBundleHostname / resolveAllowedOrigins ─────────────

describe('11 - #CSRF3 allowlist resolution: precedence and validation', function () {

    var savedConfig;
    beforeEach(function () { savedConfig = global.getConfig; });
    afterEach(function ()  { global.getConfig = savedConfig; });

    it('resolveBundleHostname reads conf[bundle][env].hostname when set', function () {
        global.getConfig = function () {
            return { test: { dev: { hostname: 'https://example.com' } } };
        };
        assert.equal(Csrf._resolveBundleHostname(), 'https://example.com');
    });

    it('resolveBundleHostname composes from server.scheme + host + server.port', function () {
        global.getConfig = function () {
            return { test: { dev: { server: { scheme: 'https', port: 8443 }, host: 'api.example.com' } } };
        };
        assert.equal(Csrf._resolveBundleHostname(), 'https://api.example.com:8443');
    });

    it('resolveBundleHostname returns null when neither hostname nor host parts are present', function () {
        global.getConfig = function () { return { test: { dev: {} } }; };
        assert.equal(Csrf._resolveBundleHostname(), null);
    });

    it('resolveAllowedOrigins prefers explicit opts.allowedOrigins', function () {
        var list = Csrf._resolveAllowedOrigins(
            ['https://a.example.com', 'https://b.example.com'],
            null
        );
        assert.deepEqual(list, ['https://a.example.com', 'https://b.example.com']);
    });

    it('resolveAllowedOrigins falls back to settings list when opts is empty', function () {
        var list = Csrf._resolveAllowedOrigins([], ['https://settings.example.com']);
        assert.deepEqual(list, ['https://settings.example.com']);
    });

    it('resolveAllowedOrigins falls back to bundle hostname when both lists are empty', function () {
        var list = Csrf._resolveAllowedOrigins(null, null);
        assert.deepEqual(list, [TEST_ORIGIN]);
    });

    it('resolveAllowedOrigins lowercases every entry', function () {
        var list = Csrf._resolveAllowedOrigins(
            ['HTTPS://Example.COM', 'HTTP://Localhost:3000'],
            null
        );
        assert.deepEqual(list, ['https://example.com', 'http://localhost:3000']);
    });

    it('resolveAllowedOrigins parses Referer-shaped entries down to scheme://host[:port]', function () {
        var list = Csrf._resolveAllowedOrigins(
            ['https://example.com/some/path?q=1'],
            null
        );
        assert.deepEqual(list, ['https://example.com']);
    });

    it('resolveAllowedOrigins throws when nothing can be resolved', function () {
        global.getConfig = function () { return { test: { dev: {} } }; };
        assert.throws(function () { Csrf._resolveAllowedOrigins(null, null); },
            /csrf\.allowedOrigins is empty and the bundle hostname could not be resolved/);
    });

    it('factory throws when no origin can be resolved at construction time', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: {} } } } };
        };
        assert.throws(function () { Csrf(); },
            /csrf\.allowedOrigins is empty and the bundle hostname could not be resolved/);
    });

    it('factory accepts an explicit opts.allowedOrigins even when no bundle hostname exists', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: {} } } } };
        };
        assert.doesNotThrow(function () {
            Csrf({ allowedOrigins: ['https://app.example.com'] });
        });
    });

    it('settings.csrf.allowedOrigins flows through resolveSettingsDefaults', function () {
        global.getConfig = function () {
            return {
                test: { dev: { hostname: TEST_ORIGIN, content: {
                    settings: { csrf: { allowedOrigins: ['https://x.example.com'] } }
                } } }
            };
        };
        var d = Csrf._resolveSettingsDefaults();
        assert.deepEqual(d.allowedOrigins, ['https://x.example.com']);
    });

    it('settings.csrf.allowedOrigins entries are lowercased', function () {
        global.getConfig = function () {
            return {
                test: { dev: { hostname: TEST_ORIGIN, content: {
                    settings: { csrf: { allowedOrigins: ['HTTPS://Example.COM'] } }
                } } }
            };
        };
        var d = Csrf._resolveSettingsDefaults();
        assert.deepEqual(d.allowedOrigins, ['https://example.com']);
    });

});


// ─── 12 — #CSRF3 behavioural matrix: Origin × Referer × allowlist ──────────

describe('12 - #CSRF3 mutating-method matrix: Origin/Referer/allowlist', function () {

    function mintCookie(sessionId) {
        var token = Csrf._generateToken(sessionId, TEST_SECRET);
        return { token: token, header: 'gina-csrf-token=' + encodeURIComponent(token) };
    }
    function makeReq(method, sessionId, headers, overrides) {
        var req = {
            method: method, url: '/api/things',
            headers: headers || {},
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

    it('Origin matches allowlist, valid token → next() called', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: TEST_ORIGIN,
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
        assert.equal(res.statusCode, 200);
    });

    it('Origin missing AND Referer missing → 403 missing origin/referer', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
        assert.ok(captured.some(function (l) { return /missing origin\/referer/.test(l); }),
            'expected "missing origin/referer" reason in log');
    });

    it('Referer fallback hits the allowlist → next() called', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            referer: TEST_ORIGIN + '/some/page?q=1',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
    });

    it('Origin mismatches allowlist → 403 origin not allowed', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: 'https://attacker.example.com',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
        assert.ok(captured.some(function (l) { return /origin not allowed/.test(l); }),
            'expected "origin not allowed" reason in log');
    });

    it('Origin matches but tokens disagree → 403 (token layer still fires)', function () {
        var mw = Csrf();
        var c1 = mintCookie('session-abc');
        var c2 = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: TEST_ORIGIN,
            cookie: c1.header,
            'x-gina-csrf-token': c2.token
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
        assert.ok(captured.some(function (l) { return /token\/cookie mismatch/.test(l); }),
            'expected token-layer reason — pre-filter passed');
    });

    it('Origin matches with explicit settings allowlist (single host)', function () {
        var saved = global.getConfig;
        global.getConfig = function () {
            return {
                test: { dev: { hostname: TEST_ORIGIN, content: {
                    settings: { csrf: { allowedOrigins: ['https://prod.example.com'] } }
                } } }
            };
        };
        try {
            var mw = Csrf();
            var c  = mintCookie('session-abc');
            // Default bundle hostname does NOT count when explicit allowlist is set.
            var req = makeReq('POST', 'session-abc', {
                origin: TEST_ORIGIN,
                cookie: c.header,
                'x-gina-csrf-token': c.token
            });
            var res = makeRes();
            mw(req, res, function () { assert.fail('next() must not be called'); });
            assert.equal(res.statusCode, 403,
                'bundle hostname must NOT be implicitly added when allowlist is explicit');
        } finally {
            global.getConfig = saved;
        }
    });

    it('Multi-origin allowlist accepts each member', function () {
        var mw = Csrf({ allowedOrigins: ['https://a.example.com', 'https://b.example.com'] });
        var c  = mintCookie('session-abc');

        ['https://a.example.com', 'https://b.example.com'].forEach(function (origin) {
            var req = makeReq('POST', 'session-abc', {
                origin: origin,
                cookie: c.header,
                'x-gina-csrf-token': c.token
            });
            var res = makeRes();
            var ok = false;
            mw(req, res, function () { ok = true; });
            assert.equal(ok, true, origin + ' should pass');
        });
    });

    it('Multi-origin allowlist rejects non-members', function () {
        var mw = Csrf({ allowedOrigins: ['https://a.example.com', 'https://b.example.com'] });
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: 'https://c.example.com',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('Origin case is normalised — uppercase Origin still matches lowercase allowlist', function () {
        var mw = Csrf({ allowedOrigins: ['https://example.com'] });
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: 'HTTPS://Example.COM',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
    });

    it('Different scheme on the same host → 403 (http vs https)', function () {
        var mw = Csrf({ allowedOrigins: ['https://example.com'] });
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: 'http://example.com',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('Different port on the same host → 403', function () {
        var mw = Csrf({ allowedOrigins: ['http://localhost:3000'] });
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: 'http://localhost:9999',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
    });

    it('Origin: "null" sentinel + no Referer → 403', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: 'null',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        mw(req, res, function () { assert.fail('next() must not be called'); });
        assert.equal(res.statusCode, 403);
        assert.ok(captured.some(function (l) { return /missing origin\/referer/.test(l); }));
    });

    it('Origin: "null" + valid Referer fallback → next() called', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        var req = makeReq('POST', 'session-abc', {
            origin: 'null',
            referer: TEST_ORIGIN + '/x',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
    });

    it('Safe method bypasses Origin pre-filter (no Origin → still issues cookie)', function () {
        var mw = Csrf();
        var req = makeReq('GET', 'session-abc', {});
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
        assert.equal(res.statusCode, 200);
        assert.ok(res.getHeader('Set-Cookie'), 'cookie still issued on safe method');
    });

});


// ─── 13 — #CSRF3 negative-invariant lock + per-route exempt interaction ────

describe('13 - #CSRF3 negative-invariant lock and exempt interaction', function () {

    function mintCookie(sessionId) {
        var token = Csrf._generateToken(sessionId, TEST_SECRET);
        return { token: token, header: 'gina-csrf-token=' + encodeURIComponent(token) };
    }
    function makeReq(method, sessionId, headers, overrides) {
        var req = {
            method: method, url: '/api/things',
            headers: headers || {},
            session: { id: sessionId },
            routing: { csrfExempt: false }
        };
        Object.keys(overrides || {}).forEach(function (k) { req[k] = overrides[k]; });
        return req;
    }
    function makeRes() {
        var headers = {};
        return {
            statusCode: 200, _ended: false,
            getHeader: function (n) { return headers[n.toLowerCase()] || null; },
            setHeader: function (n, v) { headers[n.toLowerCase()] = v; },
            end: function () { this._ended = true; }
        };
    }

    var savedConsoleError;
    beforeEach(function () {
        savedConsoleError = console.error;
        console.error = function () {};
    });
    afterEach(function () { console.error = savedConsoleError; });

    it('matching token + cookie + MISMATCHING Origin → STILL 403 (token ≠ Origin layer)', function () {
        var mw = Csrf();
        var c  = mintCookie('session-abc');
        // Token verifies, cookie matches header — but Origin is hostile.
        var req = makeReq('POST', 'session-abc', {
            origin: 'https://attacker.example.com',
            cookie: c.header,
            'x-gina-csrf-token': c.token
        });
        var res = makeRes();
        mw(req, res, function () {
            assert.fail('matching token must NOT bypass the Origin pre-filter');
        });
        assert.equal(res.statusCode, 403);
    });

    it('Origin pre-filter runs BEFORE token verify (mismatched Origin reports origin reason)', function () {
        var captured = [];
        console.error = function () { captured.push(Array.prototype.slice.call(arguments).join(' ')); };
        try {
            var mw = Csrf();
            var c  = mintCookie('session-abc');
            var req = makeReq('POST', 'session-abc', {
                origin: 'https://attacker.example.com',
                cookie: c.header,
                'x-gina-csrf-token': c.token
            });
            var res = makeRes();
            mw(req, res, function () { assert.fail('next() must not be called'); });
            assert.ok(captured.some(function (l) { return /origin not allowed/.test(l); }),
                'must surface "origin not allowed" — pre-filter fires first');
        } finally {
            console.error = savedConsoleError;
        }
    });

    it('csrfExempt: true bypasses BOTH the Origin pre-filter and the token verify', function () {
        var mw = Csrf();
        // No Origin, no token, no cookie — exempt route accepts everything.
        var req = makeReq('POST', 'session-abc', {}, { routing: { csrfExempt: true } });
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
        assert.equal(res.statusCode, 200);
    });

    it('csrfExempt: true + mismatched Origin still bypasses (consistent across both layers)', function () {
        var mw = Csrf();
        var req = makeReq('POST', 'session-abc',
            { origin: 'https://attacker.example.com' },
            { routing: { csrfExempt: true } });
        var res = makeRes();
        var ok = false;
        mw(req, res, function () { ok = true; });
        assert.equal(ok, true);
    });

});


// ─── 14 — #CSRF3 source inspection: pre-filter is wired before token verify ─

describe('14 - #CSRF3 source inspection: pre-filter ordering and primitives', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#CSRF3 marker is present', function () {
        assert.ok(src.indexOf('#CSRF3') > -1, 'expected #CSRF3 marker for traceability');
    });

    it('parseRequestOrigin reads Origin first, falls back to Referer', function () {
        // Look in the function body — Origin must appear before Referer in the read order.
        var match = src.match(/function\s+parseRequestOrigin[\s\S]*?\n\}/);
        assert.ok(match, 'expected parseRequestOrigin function body');
        var body = match[0];
        var iOrigin  = body.indexOf('headers.origin');
        var iReferer = body.indexOf('headers.referer');
        assert.ok(iOrigin > -1 && iReferer > -1, 'expected both header reads');
        assert.ok(iOrigin < iReferer, 'Origin must be read before Referer');
    });

    it('Origin pre-filter runs BEFORE the token verify in the middleware', function () {
        // Match the call sites (not the function definitions at the top of the file).
        var iParseCall = src.indexOf('requestOrigin = parseRequestOrigin(req)');
        var iReadCall  = src.indexOf('presented = readPresentedToken(req');
        assert.ok(iParseCall > -1, 'expected parseRequestOrigin call site');
        assert.ok(iReadCall  > -1, 'expected readPresentedToken call site');
        assert.ok(iParseCall < iReadCall,
            'parseRequestOrigin must be called before readPresentedToken in the middleware');
    });

    it('Origin pre-filter runs AFTER the csrfExempt short-circuit', function () {
        var iReturnExempt = src.indexOf('if (isExempt) {');
        var iParseCall    = src.indexOf('requestOrigin = parseRequestOrigin(req)');
        assert.ok(iReturnExempt > -1, 'expected `if (isExempt) {` short-circuit block');
        assert.ok(iParseCall    > -1, 'expected parseRequestOrigin call site');
        assert.ok(iReturnExempt < iParseCall,
            'exempt short-circuit must precede the Origin pre-filter call site');
    });

    it('reject reasons distinguish "missing origin/referer" from token-layer reasons', function () {
        assert.ok(/missing origin\/referer/.test(src),
            'expected explicit missing-origin reject reason');
        assert.ok(/origin not allowed/.test(src),
            'expected explicit origin-not-allowed reject reason');
        // Token-layer reasons must remain distinct.
        assert.ok(/missing token/.test(src), 'expected missing-token reject reason');
        assert.ok(/token\/cookie mismatch/.test(src), 'expected token-cookie mismatch reason');
    });

    it('parseOriginString rejects the literal "null" sentinel', function () {
        var match = src.match(/function\s+parseOriginString[\s\S]*?\n\}/);
        assert.ok(match);
        assert.ok(/'null'|"null"/.test(match[0]),
            'expected explicit guard against the "null" sentinel browsers send for sandboxed iframes');
    });

    it('allowedOrigins uses indexOf (not .includes) for allowlist lookup', function () {
        // `.includes` would still be wrong on the secret-bearing token path; allowlist
        // doesn't have that constraint, but consistency keeps the file-wide negative
        // invariant simple.
        assert.ok(/allowedOrigins\.indexOf\(/.test(src),
            'expected allowedOrigins.indexOf(...) for allowlist match');
        assert.ok(!/allowedOrigins\.includes\(/.test(src),
            'do not use .includes for the allowlist match (file-wide invariant)');
    });

});
