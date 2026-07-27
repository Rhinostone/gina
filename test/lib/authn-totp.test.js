'use strict';
/**
 * lib/authn TOTP — RFC 6238 time-based one-time passwords (#COMPLY3 slice C).
 *
 * Shape of this suite:
 *   §01 RFC 6238 Appendix B vectors — the published (time, seed, algorithm) ->
 *       code table, driven against `_hotp` with RAW seed buffers. Deliberately
 *       NOT through base32: feeding the implementation's own encoder into its
 *       own verifier would test the pair against each other rather than against
 *       the specification.
 *   §02 RFC 4648 base32 vectors — the encoder checked against the published
 *       table, and the decoder's tolerance (case, whitespace, padding) plus its
 *       refusal of an out-of-alphabet character.
 *   §03 generateTotpSecret — entropy, encoding, and the floor.
 *   §04 generateTotp / verifyTotp round trip at the API level, including the
 *       millisecond `at` contract.
 *   §05 the acceptance window — drift either side is accepted, beyond it is
 *       refused, and `window: 0` narrows to the current step (each with the
 *       control on the other side of the boundary).
 *   §06 `delta` — the replay-defence signal: it identifies WHICH step matched,
 *       which is the whole reason a caller can detect reuse.
 *   §07 malformed submissions — every shape is `{valid:false}`, never a throw
 *       and never an exception a caller could distinguish from a wrong code.
 *   §08 otpauthURL — the Key Uri Format, and its encoding of hostile input.
 *   §09 option validation.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');

var FW    = require('../fw');
var authn = require(path.join(FW, 'lib/authn/src/main.js'));

/** RFC 6238 Appendix B seeds — ASCII, one per algorithm. */
var SEED_SHA1   = Buffer.from('12345678901234567890', 'ascii');                                             // 20 bytes
var SEED_SHA256 = Buffer.from('12345678901234567890123456789012', 'ascii');                                 // 32 bytes
var SEED_SHA512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii'); // 64 bytes

/** The well-known base32 of the SHA-1 seed (RFC 4648 encoding of "12345678901234567890"). */
var SEED_SHA1_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('01 - RFC 6238 Appendix B test vectors', function () {

    // time (seconds) -> published 8-digit code, X = 30, T0 = 0.
    var SHA1_VECTORS = [
        [ 59,          '94287082' ],
        [ 1111111109,  '07081804' ],
        [ 1111111111,  '14050471' ],
        [ 1234567890,  '89005924' ],
        [ 2000000000,  '69279037' ],
        [ 20000000000, '65353130' ]
    ];

    SHA1_VECTORS.forEach(function (v) {
        it('sha1, T=' + v[0] + ' -> ' + v[1], function () {
            var counter = Math.floor(v[0] / 30);
            assert.equal(authn._hotp(SEED_SHA1, counter, 'sha1', 8), v[1]);
        });
    });

    it('sha256, T=59 -> 46119246', function () {
        assert.equal(authn._hotp(SEED_SHA256, Math.floor(59 / 30), 'sha256', 8), '46119246');
    });

    it('sha512, T=59 -> 90693936', function () {
        assert.equal(authn._hotp(SEED_SHA512, Math.floor(59 / 30), 'sha512', 8), '90693936');
    });

    it('sha256, T=1234567890 -> 91819424', function () {
        assert.equal(authn._hotp(SEED_SHA256, Math.floor(1234567890 / 30), 'sha256', 8), '91819424');
    });

    it('sha512, T=1234567890 -> 93441116', function () {
        assert.equal(authn._hotp(SEED_SHA512, Math.floor(1234567890 / 30), 'sha512', 8), '93441116');
    });

    it('control: a wrong seed does NOT produce the published code', function () {
        // Without this the vector table could pass on an implementation that
        // ignored the key entirely.
        var wrong = Buffer.from('09876543210987654321', 'ascii');
        assert.notEqual(authn._hotp(wrong, Math.floor(59 / 30), 'sha1', 8), '94287082');
    });

    it('control: a wrong counter does NOT produce the published code', function () {
        assert.notEqual(authn._hotp(SEED_SHA1, 999, 'sha1', 8), '94287082');
    });

    it('reaches the vectors through the public API too', function () {
        // `at` is MILLISECONDS at the API boundary; the vectors are seconds.
        assert.equal(authn.generateTotp(SEED_SHA1_B32, { at: 59 * 1000, digits: 8 }), '94287082');
        assert.equal(authn.generateTotp(SEED_SHA1_B32, { at: 1111111109 * 1000, digits: 8 }), '07081804');
    });
});

describe('02 - RFC 4648 base32', function () {

    // The published table, minus padding (this encoder emits unpadded).
    var VECTORS = [
        [ '',       '' ],
        [ 'f',      'MY' ],
        [ 'fo',     'MZXQ' ],
        [ 'foo',    'MZXW6' ],
        [ 'foob',   'MZXW6YQ' ],
        [ 'fooba',  'MZXW6YTB' ],
        [ 'foobar', 'MZXW6YTBOI' ]
    ];

    VECTORS.forEach(function (v) {
        it('encodes ' + JSON.stringify(v[0]) + ' -> ' + JSON.stringify(v[1]), function () {
            assert.equal(authn._base32Encode(Buffer.from(v[0], 'ascii')), v[1]);
        });
    });

    VECTORS.forEach(function (v) {
        it('decodes ' + JSON.stringify(v[1]) + ' -> ' + JSON.stringify(v[0]), function () {
            assert.equal(authn._base32Decode(v[1]).toString('ascii'), v[0]);
        });
    });

    it('encodes the RFC 6238 sha1 seed to the well-known value', function () {
        assert.equal(authn._base32Encode(SEED_SHA1), SEED_SHA1_B32);
    });

    it('tolerates padding, lowercase and whitespace on the way in', function () {
        // A user retyping a secret off a screen produces all three.
        assert.equal(authn._base32Decode('MZXW6YTBOI======').toString('ascii'), 'foobar');
        assert.equal(authn._base32Decode('mzxw6ytboi').toString('ascii'), 'foobar');
        assert.equal(authn._base32Decode('MZXW 6YTB OI').toString('ascii'), 'foobar');
    });

    it('REFUSES an out-of-alphabet character rather than skipping it', function () {
        // Silently skipping would yield a secret that never matches, with no
        // clue why — a mistyped enrolment must fail loudly.
        assert.throws(function () { authn._base32Decode('MZXW6YTB!!'); }, /not valid base32/);
        assert.throws(function () { authn._base32Decode('MZXW0YTB'); }, /not valid base32/); // 0 is not in the alphabet
        assert.throws(function () { authn._base32Decode('MZXW1YTB'); }, /not valid base32/); // nor is 1
    });

    it('round-trips arbitrary bytes', function () {
        for (var n = 1; n <= 40; n++) {
            var buf = Buffer.alloc(n);
            for (var i = 0; i < n; i++) { buf[i] = (i * 7 + n) & 255; }
            assert.deepEqual(authn._base32Decode(authn._base32Encode(buf)), buf, 'round trip failed at ' + n + ' bytes');
        }
    });
});

describe('03 - generateTotpSecret', function () {

    it('returns unpadded base32 decoding to 20 bytes by default', function () {
        var s = authn.generateTotpSecret();
        assert.match(s, /^[A-Z2-7]+$/, 'base32 alphabet only, no padding');
        assert.equal(authn._base32Decode(s).length, 20, 'RFC 4226 recommends 160 bits');
    });

    it('honours a larger size', function () {
        assert.equal(authn._base32Decode(authn.generateTotpSecret(32)).length, 32);
    });

    it('refuses a secret below 128 bits', function () {
        assert.throws(function () { authn.generateTotpSecret(8); }, /whole number >= 16/);
        assert.throws(function () { authn.generateTotpSecret(20.5); }, /whole number >= 16/);
        assert.throws(function () { authn.generateTotpSecret('20'); }, /whole number >= 16/);
    });

    it('is different every time', function () {
        var seen = new Set();
        for (var i = 0; i < 20; i++) { seen.add(authn.generateTotpSecret()); }
        assert.equal(seen.size, 20);
    });
});

describe('04 - generate / verify round trip', function () {

    it('verifies a freshly generated code', function () {
        var secret = authn.generateTotpSecret();
        var code   = authn.generateTotp(secret);
        var res    = authn.verifyTotp(code, secret);
        assert.equal(res.valid, true);
        assert.equal(typeof res.delta, 'number');
    });

    it('rejects a code from a different secret', function () {
        var code = authn.generateTotp(authn.generateTotpSecret());
        assert.equal(authn.verifyTotp(code, authn.generateTotpSecret()).valid, false);
    });

    it('defaults to six digits', function () {
        assert.equal(authn.generateTotp(authn.generateTotpSecret()).length, 6);
    });

    it('honours a digit count end to end', function () {
        var secret = authn.generateTotpSecret();
        var code   = authn.generateTotp(secret, { digits: 8 });
        assert.equal(code.length, 8);
        assert.equal(authn.verifyTotp(code, secret, { digits: 8 }).valid, true);
    });

    it('a code minted for one digit count does not verify at another', function () {
        var secret = authn.generateTotpSecret();
        var code8  = authn.generateTotp(secret, { digits: 8 });
        assert.equal(authn.verifyTotp(code8, secret, { digits: 6 }).valid, false);
    });

    it('works across all three algorithms', function () {
        [ 'sha1', 'sha256', 'sha512' ].forEach(function (alg) {
            var secret = authn.generateTotpSecret();
            var code   = authn.generateTotp(secret, { algorithm: alg });
            assert.equal(authn.verifyTotp(code, secret, { algorithm: alg }).valid, true, alg + ' round trip');
        });
    });

    it('a code minted under one algorithm does not verify under another', function () {
        var secret = authn.generateTotpSecret();
        var code   = authn.generateTotp(secret, { algorithm: 'sha256' });
        assert.equal(authn.verifyTotp(code, secret, { algorithm: 'sha1' }).valid, false);
    });
});

describe('05 - the acceptance window', function () {

    var SECRET = authn.generateTotpSecret();
    var NOW    = 1700000000000; // fixed epoch ms so the steps are deterministic

    it('accepts the previous step (clock drift behind)', function () {
        var past = authn.generateTotp(SECRET, { at: NOW - 30000 });
        assert.equal(authn.verifyTotp(past, SECRET, { at: NOW, window: 1 }).valid, true);
    });

    it('accepts the next step (clock drift ahead)', function () {
        var future = authn.generateTotp(SECRET, { at: NOW + 30000 });
        assert.equal(authn.verifyTotp(future, SECRET, { at: NOW, window: 1 }).valid, true);
    });

    it('refuses two steps away', function () {
        var stale = authn.generateTotp(SECRET, { at: NOW - 60000 });
        assert.equal(authn.verifyTotp(stale, SECRET, { at: NOW, window: 1 }).valid, false);
    });

    it('window:0 narrows acceptance to the current step only', function () {
        var past = authn.generateTotp(SECRET, { at: NOW - 30000 });
        assert.equal(authn.verifyTotp(past, SECRET, { at: NOW, window: 0 }).valid, false);
        var now = authn.generateTotp(SECRET, { at: NOW });
        assert.equal(authn.verifyTotp(now, SECRET, { at: NOW, window: 0 }).valid, true);
    });

    it('a wider window accepts what the default refuses', function () {
        var stale = authn.generateTotp(SECRET, { at: NOW - 60000 });
        assert.equal(authn.verifyTotp(stale, SECRET, { at: NOW, window: 1 }).valid, false);
        assert.equal(authn.verifyTotp(stale, SECRET, { at: NOW, window: 2 }).valid, true);
    });
});

describe('06 - delta, the replay-defence signal', function () {

    var SECRET = authn.generateTotpSecret();
    var NOW    = 1700000000000;

    it('reports the absolute step counter that matched', function () {
        var res = authn.verifyTotp(authn.generateTotp(SECRET, { at: NOW }), SECRET, { at: NOW });
        assert.equal(res.delta, Math.floor(NOW / 1000 / 30));
    });

    it('an older code reports a SMALLER delta — which is how a caller detects reuse', function () {
        var older = authn.verifyTotp(authn.generateTotp(SECRET, { at: NOW - 30000 }), SECRET, { at: NOW });
        var now   = authn.verifyTotp(authn.generateTotp(SECRET, { at: NOW }), SECRET, { at: NOW });
        assert.equal(older.valid, true);
        assert.ok(older.delta < now.delta, 'the replayed step must be identifiable as older');
    });

    it('is null when nothing matched', function () {
        // Derive a guaranteed-wrong code by advancing the real one's first
        // digit — picking a literal like '000000' would be right by chance one
        // time in a million, and a flaky control is worse than none.
        var real  = authn.generateTotp(SECRET, { at: NOW });
        var wrong = String((Number(real.charAt(0)) + 1) % 10) + real.slice(1);
        assert.notEqual(wrong, real, 'fixture sanity: the mutated code differs');
        assert.deepEqual(authn.verifyTotp(wrong, SECRET, { at: NOW, window: 0 }),
            { valid: false, delta: null });
    });

    it('the documented replay check actually rejects a reused code', function () {
        // Replays the recipe from the module JSDoc, since that is what consumers
        // will paste: persist the accepted step, require strictly greater.
        var lastStep = 0;
        function attempt(code, at) {
            var res = authn.verifyTotp(code, SECRET, { at: at });
            if (!res.valid || res.delta <= lastStep) { return false; }
            lastStep = res.delta;
            return true;
        }
        var code = authn.generateTotp(SECRET, { at: NOW });
        assert.equal(attempt(code, NOW), true, 'first use succeeds');
        assert.equal(attempt(code, NOW), false, 'the same code must not work twice');
    });
});

describe('07 - malformed submissions', function () {

    var SECRET = authn.generateTotpSecret();

    var BAD = [
        [ 'empty string',      '' ],
        [ 'letters',           'abcdef' ],
        [ 'too short',         '12345' ],
        [ 'too long',          '1234567' ],
        [ 'null',              null ],
        [ 'undefined',         undefined ],
        [ 'an object',         {} ],
        [ 'an array',          [] ],
        [ 'a boolean',         true ],
        [ 'signed',            '+12345' ],
        [ 'float',             '123.45' ],
        [ 'unicode digits',    '١٢٣٤٥٦' ]
    ];

    BAD.forEach(function (pair) {
        it('returns {valid:false} without throwing for: ' + pair[0], function () {
            var res = authn.verifyTotp(pair[1], SECRET);
            assert.deepEqual(res, { valid: false, delta: null });
        });
    });

    it('tolerates whitespace inside an otherwise valid code', function () {
        // Authenticator apps display codes grouped ("123 456"), and users paste
        // them that way.
        var secret = authn.generateTotpSecret();
        var code   = authn.generateTotp(secret);
        var spaced = code.slice(0, 3) + ' ' + code.slice(3);
        assert.equal(authn.verifyTotp(spaced, secret).valid, true);
    });

    it('accepts a numeric submission', function () {
        var secret = authn.generateTotpSecret();
        var code   = authn.generateTotp(secret, { at: 1700000000000 });
        if (code.charAt(0) !== '0') { // a leading zero cannot survive Number()
            assert.equal(authn.verifyTotp(Number(code), secret, { at: 1700000000000 }).valid, true);
        }
    });

    it('an unusable SECRET throws — that is configuration, not a login attempt', function () {
        assert.throws(function () { authn.verifyTotp('123456', '!!!!'); }, /not valid base32/);
        assert.throws(function () { authn.verifyTotp('123456', ''); }, /empty/);
    });
});

describe('08 - otpauthURL', function () {

    it('builds the Key Uri Format with issuer, algorithm, digits and period', function () {
        var url = authn.otpauthURL({ secret: 'JBSWY3DPEHPK3PXP', account: 'ada@example.com', issuer: 'Acme' });
        assert.match(url, /^otpauth:\/\/totp\/Acme:ada%40example\.com\?/);
        assert.match(url, /secret=JBSWY3DPEHPK3PXP/);
        assert.match(url, /issuer=Acme/);
        assert.match(url, /algorithm=SHA1/);
        assert.match(url, /digits=6/);
        assert.match(url, /period=30/);
    });

    it('omits the issuer prefix when no issuer is given', function () {
        var url = authn.otpauthURL({ secret: 'JBSWY3DPEHPK3PXP', account: 'ada@example.com' });
        assert.match(url, /^otpauth:\/\/totp\/ada%40example\.com\?/);
        assert.doesNotMatch(url, /issuer=/);
    });

    it('reflects non-default options', function () {
        var url = authn.otpauthURL({
            secret: 'JBSWY3DPEHPK3PXP', account: 'a@b.c', issuer: 'X',
            algorithm: 'sha256', digits: 8, step: 60
        });
        assert.match(url, /algorithm=SHA256/);
        assert.match(url, /digits=8/);
        assert.match(url, /period=60/);
    });

    it('percent-encodes hostile label input', function () {
        // An account name is user-controlled; it must not be able to inject
        // query parameters or path segments into the URI.
        var url = authn.otpauthURL({
            secret: 'JBSWY3DPEHPK3PXP',
            account: 'a@b.c?issuer=Evil&x=/../',
            issuer: 'Good'
        });
        var label = url.slice('otpauth://totp/'.length, url.indexOf('?'));
        assert.doesNotMatch(label, /[?&/]/, 'the label must carry no unencoded delimiter');
        assert.match(url, /issuer=Good/);
        // The injected pair must appear only in encoded form inside the label.
        assert.equal(url.split('issuer=').length - 1, 1, 'exactly one real issuer parameter');
    });

    it('requires a secret and an account', function () {
        assert.throws(function () { authn.otpauthURL({ account: 'a@b.c' }); }, /requires a `secret`/);
        assert.throws(function () { authn.otpauthURL({ secret: 'JBSWY3DPEHPK3PXP' }); }, /requires an `account`/);
    });
});

describe('09 - option validation', function () {

    var SECRET = authn.generateTotpSecret();

    it('refuses an unsupported algorithm', function () {
        assert.throws(function () { authn.generateTotp(SECRET, { algorithm: 'md5' }); },
            /must be one of sha1, sha256, sha512/);
    });

    it('refuses a digit count outside 6..10', function () {
        assert.throws(function () { authn.generateTotp(SECRET, { digits: 4 }); }, /in 6\.\.10/);
        assert.throws(function () { authn.generateTotp(SECRET, { digits: 12 }); }, /in 6\.\.10/);
    });

    it('refuses a non-positive step', function () {
        assert.throws(function () { authn.generateTotp(SECRET, { step: 0 }); }, /positive whole number/);
        assert.throws(function () { authn.generateTotp(SECRET, { step: -30 }); }, /positive whole number/);
    });

    it('refuses a negative window', function () {
        assert.throws(function () { authn.verifyTotp('123456', SECRET, { window: -1 }); }, /whole number >= 0/);
    });

    it('accepts an uppercase algorithm name', function () {
        assert.doesNotThrow(function () { authn.generateTotp(SECRET, { algorithm: 'SHA256' }); });
    });
});
