'use strict';
/**
 * lib/authn — password hashing, verification and policy (#COMPLY3 slice A).
 *
 * Shape of this suite:
 *   §01 registry wiring — the plain-require entry (a security primitive stays out
 *       of the dev-mode hot-reload path) and the GinaLib declaration the two-way
 *       parity gate enforces.
 *   §02 hashPassword — the PHC encoding, salt uniqueness, parameter overrides,
 *       and every input rejection (with a firing positive control alongside).
 *   §03 verifyPassword, gina scrypt — round trip, wrong password, near-miss
 *       passwords, and a SUBTRACT proving the comparison is over the derived key
 *       rather than the encoded string.
 *   §04 malformed / hostile stored hashes — every shape resolves to `false`, never
 *       a throw, and the parameter bounds refuse an attacker-chosen cost.
 *   §05 foreign formats — argon2 / bcrypt route to the project's own package;
 *       absent package is an operational ERROR, a rejecting verifier is `false`.
 *   §06 needsRehash — the migration predicate, both directions.
 *   §07 validatePasswordPolicy — length-first defaults, opt-in composition, the
 *       deny list, and code-point counting.
 *   §08 dummyVerify — the enumeration-resistance seam.
 *   §09 concurrency — the FIFO slot gauge bounds in-flight work and drains.
 *
 * Cost note: every hashing case runs at `ln: 12` (~4 ms) except §03's one
 * default-cost round trip, which proves the shipped parameters actually work.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var AUTHN_PATH = path.join(FW, 'lib/authn/src/main.js');
var authn      = require(AUTHN_PATH);

var AUTHN_SRC  = fs.readFileSync(AUTHN_PATH, 'utf8');
var LIBIDX_SRC = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var TYPES_SRC  = fs.readFileSync(path.resolve(__dirname, '..', '..', 'types/index.d.ts'), 'utf8');

/**
 * Lowest SUPPORTED cost, used for the bulk of the suite.
 *
 * `ln: 14` is the module's floor, not an arbitrary test value — anything lower
 * is refused, so this fixture doubles as coverage of the minimum supported
 * configuration. ~16 MiB and a few ms per hash.
 */
var FAST = { ln: 14 };

describe('01 - lib/authn registry wiring', function () {

    it('is registered with a plain require, not _require', function () {
        assert.match(LIBIDX_SRC, /authn\s*:\s*require\('\.\/authn'\)/,
            'lib/index.js must register authn with plain require()');
        assert.doesNotMatch(LIBIDX_SRC, /authn\s*:\s*_require\('\.\/authn'\)/,
            'a security primitive holding the concurrency queue must not hot-reload');
    });

    it('control: the registry does use _require for hot-reloadable libs', function () {
        // Proves the negative pin above can actually fire — _require IS present
        // in this file for other entries.
        assert.match(LIBIDX_SRC, /_require\('\.\/routing-introspect'\)/);
    });

    it('is declared on GinaLib (the two-way parity gate)', function () {
        assert.match(TYPES_SRC, /^\s+authn: any;$/m,
            'types/index.d.ts GinaLib must declare authn or the parity test reds the suite');
    });

    it('exposes the slice-A surface', function () {
        [ 'hashPassword', 'verifyPassword', 'dummyVerify', 'needsRehash',
          'validatePasswordPolicy', 'setMaxConcurrentHashes' ].forEach(function (fn) {
            assert.equal(typeof authn[fn], 'function', fn + ' must be exported');
        });
    });

    it('has no synchronous hashing variant', function () {
        // A sync KDF on the request path blocks the event loop for ~100ms.
        assert.equal(typeof authn.hashPasswordSync, 'undefined');
        assert.doesNotMatch(AUTHN_SRC, /crypto\.scryptSync/);
    });
});

describe('02 - hashPassword', function () {

    it('produces a self-describing PHC string', function (t, done) {
        authn.hashPassword('correct horse battery staple', FAST, function (err, hash) {
            assert.equal(err, null);
            assert.match(hash, /^\$scrypt\$ln=14,r=8,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
            // Padding, specifically — `=` also separates the cost parameters, so
            // only the salt and key fields can carry the assertion. 16 and 32
            // bytes both encode with padding, so this fires if b64() regresses.
            var fields = hash.split('$'); // ['', 'scrypt', params, salt, key]
            assert.doesNotMatch(fields[3], /=/, 'the salt field must be unpadded base64');
            assert.doesNotMatch(fields[4], /=/, 'the key field must be unpadded base64');
            assert.equal(fields[3].length, 22, '16 salt bytes, unpadded');
            assert.equal(fields[4].length, 43, '32 key bytes, unpadded');
            done();
        });
    });

    it('defaults to the shipped parameters when none are given', function (t, done) {
        // Parse-only assertion: no KDF run at default cost here (§03 pays that once).
        assert.equal(authn._SCRYPT_PARAMS.ln, 17);
        assert.equal(authn._SCRYPT_PARAMS.r, 8);
        assert.equal(authn._SCRYPT_PARAMS.p, 1);
        done();
    });

    it('salts every hash independently', function (t, done) {
        authn.hashPassword('same password', FAST, function (e1, h1) {
            authn.hashPassword('same password', FAST, function (e2, h2) {
                assert.equal(e1, null);
                assert.equal(e2, null);
                assert.notEqual(h1, h2, 'identical passwords must not produce identical hashes');
                done();
            });
        });
    });

    it('accepts an options object or a bare callback', function (t, done) {
        authn.hashPassword('a password long enough', function (err, hash) {
            // Bare callback -> the arity shift, and the shipped default applied.
            assert.equal(err, null);
            assert.match(hash, /^\$scrypt\$ln=17,/);
            done();
        });
    });

    it('rejects a non-string password', function (t, done) {
        authn.hashPassword(12345, FAST, function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /must be a string/);
            done();
        });
    });

    it('rejects an empty password', function (t, done) {
        authn.hashPassword('', FAST, function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /must not be empty/);
            done();
        });
    });

    it('rejects a password over the byte cap rather than truncating it', function (t, done) {
        // Silent truncation would make two different passwords authenticate
        // each other — the reason this is an error, not a slice().
        var huge = 'a'.repeat(authn._MAX_PASSWORD_BYTES + 1);
        authn.hashPassword(huge, FAST, function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /exceeds 1024 bytes/);
            done();
        });
    });

    it('control: a password at exactly the cap is accepted', function (t, done) {
        var atCap = 'a'.repeat(authn._MAX_PASSWORD_BYTES);
        authn.hashPassword(atCap, FAST, function (err, hash) {
            assert.equal(err, null);
            assert.ok(hash.length > 0);
            done();
        });
    });

    it('counts the cap in BYTES, not characters', function (t, done) {
        // 'é' is 2 bytes UTF-8; 600 of them is 1200 bytes but only 600 chars.
        var multibyte = 'é'.repeat(600);
        assert.ok(multibyte.length < authn._MAX_PASSWORD_BYTES, 'fixture must be under the cap by char count');
        authn.hashPassword(multibyte, FAST, function (err) {
            assert.ok(err instanceof Error, 'the cap must be measured in bytes');
            assert.match(err.message, /exceeds 1024 bytes/);
            done();
        });
    });

    it('rejects an out-of-range cost parameter', function (t, done) {
        authn.hashPassword('a password long enough', { ln: 8 }, function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /`ln` must be an integer in 14\.\.20/);
            done();
        });
    });

    it('throws synchronously without a callback', function () {
        assert.throws(function () { authn.hashPassword('pw'); },
            /requires a callback function/);
    });
});

describe('03 - verifyPassword against gina scrypt hashes', function () {

    it('round-trips at the SHIPPED default cost', function (t, done) {
        // The one full-cost pass in the suite: proves the shipped ln=17 params
        // are actually usable (maxmem large enough, etc.), not just encodable.
        var pw = 'a genuinely long default cost passphrase';
        authn.hashPassword(pw, function (err, hash) {
            assert.equal(err, null);
            assert.match(hash, /^\$scrypt\$ln=17,r=8,p=1\$/);
            authn.verifyPassword(pw, hash, function (vErr, ok) {
                assert.equal(vErr, null);
                assert.equal(ok, true);
                done();
            });
        });
    });

    it('rejects the wrong password', function (t, done) {
        authn.hashPassword('the real password', FAST, function (err, hash) {
            authn.verifyPassword('the wrong password', hash, function (vErr, ok) {
                assert.equal(vErr, null);
                assert.equal(ok, false);
                done();
            });
        });
    });

    it('rejects a near-miss (one character off)', function (t, done) {
        authn.hashPassword('passphrase-with-suffix', FAST, function (err, hash) {
            authn.verifyPassword('passphrase-with-suffiX', hash, function (vErr, ok) {
                assert.equal(ok, false);
                done();
            });
        });
    });

    it('rejects a prefix of the real password', function (t, done) {
        authn.hashPassword('longpassphrase123', FAST, function (err, hash) {
            authn.verifyPassword('longpassphrase', hash, function (vErr, ok) {
                assert.equal(ok, false);
                done();
            });
        });
    });

    it('SUBTRACT: verification is over the derived key, not the stored string', function (t, done) {
        // If verify compared the submitted plaintext to the PHC string in any
        // way, passing the hash itself as the password would authenticate.
        authn.hashPassword('the real password', FAST, function (err, hash) {
            authn.verifyPassword(hash, hash, function (vErr, ok) {
                assert.equal(ok, false, 'the stored hash must never authenticate as its own password');
                done();
            });
        });
    });

    it('verifies a hash minted at a DIFFERENT cost than the current default', function (t, done) {
        // The migration guarantee: raising SCRYPT_PARAMS must not invalidate
        // stored hashes.
        authn.hashPassword('parameters travel with the hash', { ln: 14, r: 8, p: 1 }, function (err, hash) {
            assert.equal(err, null);
            authn.verifyPassword('parameters travel with the hash', hash, function (vErr, ok) {
                assert.equal(vErr, null);
                assert.equal(ok, true);
                done();
            });
        });
    });

    it('throws synchronously without a callback', function () {
        assert.throws(function () { authn.verifyPassword('pw', '$scrypt$...'); },
            /requires a callback function/);
    });
});

describe('04 - malformed and hostile stored hashes', function () {

    var HOSTILE = [
        [ 'empty string',            '' ],
        [ 'not a hash at all',       'hunter2' ],
        [ 'truncated',               '$scrypt$ln=12,r=8,p=1$abc' ],
        [ 'missing fields',          '$scrypt$$$' ],
        [ 'unknown algorithm',       '$pbkdf2$ln=12$abc$def' ],
        [ 'non-numeric params',      '$scrypt$ln=xx,r=8,p=1$YWJj$ZGVm' ],
        [ 'empty salt',              '$scrypt$ln=12,r=8,p=1$$ZGVm' ],
        [ 'null byte injection',     '$scrypt$ln=12,r=8,p=1$YWJj $ZGVm' ]
    ];

    HOSTILE.forEach(function (pair) {
        it('resolves false (never throws) for: ' + pair[0], function (t, done) {
            authn.verifyPassword('any password here', pair[1], function (err, ok) {
                assert.equal(err, null, 'a malformed record must not be distinguishable from a wrong password');
                assert.equal(ok, false);
                done();
            });
        });
    });

    it('refuses an attacker-chosen cost above the accepted range', function (t, done) {
        // A stored hash is attacker-controlled once the credential store is.
        // ln=30 would ask for ~137 GiB; the parser must reject it outright
        // rather than attempt the allocation.
        var hostile = '$scrypt$ln=30,r=8,p=1$YWJjZGVmZ2hpamtsbW5vcA$ZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NQ';
        assert.equal(authn._parseScryptPhc(hostile), null, 'parser must reject an out-of-range ln');
        authn.verifyPassword('any password here', hostile, function (err, ok) {
            assert.equal(err, null);
            assert.equal(ok, false);
            done();
        });
    });

    it('refuses an attacker-chosen r above the accepted range', function () {
        assert.equal(authn._parseScryptPhc('$scrypt$ln=14,r=999,p=1$YWJj$ZGVm'), null);
    });

    it('control: a well-formed hash DOES parse', function (t, done) {
        // Proves the rejections above are discriminating, not blanket.
        authn.hashPassword('a password long enough', FAST, function (err, hash) {
            var parsed = authn._parseScryptPhc(hash);
            assert.ok(parsed, 'a genuine hash must parse');
            assert.equal(parsed.ln, 14);
            assert.equal(parsed.r, 8);
            assert.equal(parsed.p, 1);
            assert.ok(Buffer.isBuffer(parsed.salt));
            assert.equal(parsed.salt.length, 16);
            done();
        });
    });

    it('rejects a non-string stored value without throwing', function (t, done) {
        authn.verifyPassword('any password here', null, function (err, ok) {
            assert.equal(err, null);
            assert.equal(ok, false);
            done();
        });
    });
});

describe('05 - foreign hash formats (argon2 / bcrypt)', function () {

    it('argon2: routes to the project package and returns its verdict', function (t, done) {
        var seen = {};
        authn._setVerifier('argon2', {
            verify: function (stored, pw) { seen = { stored: stored, pw: pw }; return Promise.resolve(true); }
        });
        authn.verifyPassword('submitted', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA', function (err, ok) {
            authn._setVerifier('argon2', null);
            assert.equal(err, null);
            assert.equal(ok, true);
            assert.equal(seen.pw, 'submitted');
            assert.match(seen.stored, /^\$argon2id\$/);
            done();
        });
    });

    it('argon2: a rejecting verifier is a wrong password, not an error', function (t, done) {
        authn._setVerifier('argon2', { verify: function () { return Promise.resolve(false); } });
        authn.verifyPassword('submitted', '$argon2i$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', function (err, ok) {
            authn._setVerifier('argon2', null);
            assert.equal(err, null);
            assert.equal(ok, false);
            done();
        });
    });

    it('argon2: a throwing verifier fails closed', function (t, done) {
        authn._setVerifier('argon2', { verify: function () { return Promise.reject(new Error('corrupt')); } });
        authn.verifyPassword('submitted', '$argon2d$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', function (err, ok) {
            authn._setVerifier('argon2', null);
            assert.equal(err, null);
            assert.equal(ok, false, 'a verifier failure must deny, never admit');
            done();
        });
    });

    it('bcrypt: routes to the project package (callback style)', function (t, done) {
        authn._setVerifier('bcrypt', {
            compare: function (pw, stored, cb) { cb(null, pw === 'right'); }
        });
        authn.verifyPassword('right', '$2b$12$abcdefghijklmnopqrstuv', function (err, ok) {
            assert.equal(err, null);
            assert.equal(ok, true);
            authn.verifyPassword('wrong', '$2b$12$abcdefghijklmnopqrstuv', function (err2, ok2) {
                authn._setVerifier('bcrypt', null);
                assert.equal(ok2, false);
                done();
            });
        });
    });

    it('reports an operational ERROR when the package is not installed', function (t, done) {
        // Distinct from a wrong password on purpose: this needs an operator.
        authn._setVerifier('argon2', null);
        authn.verifyPassword('submitted', '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', function (err, ok) {
            assert.ok(err instanceof Error, 'a missing verifier package is operational, not a credential failure');
            assert.match(err.message, /npm install argon2/);
            assert.equal(ok, undefined);
            done();
        });
    });

    it('gina never MINTS a foreign format', function (t, done) {
        authn.hashPassword('a password long enough', FAST, function (err, hash) {
            assert.doesNotMatch(hash, /^\$argon2/);
            assert.doesNotMatch(hash, /^\$2[aby]\$/);
            assert.match(hash, /^\$scrypt\$/);
            done();
        });
    });
});

describe('06 - needsRehash', function () {

    it('is false for a hash at the current parameters', function (t, done) {
        authn.hashPassword('a password long enough', function (err, hash) {
            assert.equal(authn.needsRehash(hash), false);
            done();
        });
    });

    it('is true for a hash below the current cost', function (t, done) {
        authn.hashPassword('a password long enough', { ln: 14 }, function (err, hash) {
            assert.equal(authn.needsRehash(hash), true);
            done();
        });
    });

    it('is true for a foreign format (the migration signal)', function () {
        assert.equal(authn.needsRehash('$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA'), true);
        assert.equal(authn.needsRehash('$2b$12$abcdefghijklmnopqrstuv'), true);
    });

    it('is true for anything unparseable', function () {
        assert.equal(authn.needsRehash(''), true);
        assert.equal(authn.needsRehash(null), true);
        assert.equal(authn.needsRehash('garbage'), true);
    });
});

describe('07 - validatePasswordPolicy', function () {

    it('defaults to length-only, 12 characters', function () {
        assert.equal(authn._DEFAULT_MIN_LENGTH, 12);
        assert.deepEqual(authn.validatePasswordPolicy('twelve chars'), { valid: true, errors: [] });
        var short = authn.validatePasswordPolicy('short');
        assert.equal(short.valid, false);
        assert.deepEqual(short.errors, [ 'too-short' ]);
    });

    it('imposes NO composition requirements by default', function () {
        // NIST SP 800-63B: length over composition.
        var allLower = authn.validatePasswordPolicy('abcdefghijklmnop');
        assert.equal(allLower.valid, true, 'an all-lowercase passphrase must pass the default policy');
    });

    it('enforces composition rules when they are opted into', function () {
        var opts = { requireUppercase: true, requireDigit: true, requireSymbol: true };
        var weak = authn.validatePasswordPolicy('abcdefghijklmnop', opts);
        assert.equal(weak.valid, false);
        assert.deepEqual(weak.errors.sort(), [ 'missing-digit', 'missing-symbol', 'missing-uppercase' ]);
        assert.equal(authn.validatePasswordPolicy('Abcdefghijk1!', opts).valid, true);
    });

    it('honours a custom minLength', function () {
        assert.equal(authn.validatePasswordPolicy('shortish', { minLength: 6 }).valid, true);
        assert.equal(authn.validatePasswordPolicy('shortish', { minLength: 20 }).valid, false);
    });

    it('rejects a denied substring, case-insensitively', function () {
        var res = authn.validatePasswordPolicy('myEmail@example.com!!', { deny: [ 'myemail@example.com' ] });
        assert.equal(res.valid, false);
        assert.deepEqual(res.errors, [ 'denied-substring' ]);
    });

    it('control: the same password passes without the deny list', function () {
        assert.equal(authn.validatePasswordPolicy('myEmail@example.com!!').valid, true);
    });

    it('ignores empty and non-string deny entries', function () {
        var res = authn.validatePasswordPolicy('a long enough password', { deny: [ '', null, 42 ] });
        assert.equal(res.valid, true, 'an empty needle must not match everything');
    });

    it('counts length in CODE POINTS, not UTF-16 units', function () {
        // 12 astral characters: length 24 in UTF-16 units, 12 code points.
        var astral = '𝔞'.repeat(12);
        assert.equal(astral.length, 24, 'fixture sanity: UTF-16 length is doubled');
        assert.equal(authn.validatePasswordPolicy(astral).valid, true,
            '12 real characters must satisfy a 12-character minimum');
        assert.equal(authn.validatePasswordPolicy('𝔞'.repeat(11)).valid, false);
    });

    it('rejects a non-string with a stable code', function () {
        assert.deepEqual(authn.validatePasswordPolicy(null), { valid: false, errors: [ 'not-a-string' ] });
        assert.deepEqual(authn.validatePasswordPolicy(undefined), { valid: false, errors: [ 'not-a-string' ] });
    });

    it('returns machine-readable codes, never prose', function () {
        var res = authn.validatePasswordPolicy('a', { requireDigit: true });
        res.errors.forEach(function (code) {
            assert.match(code, /^[a-z-]+$/, 'error codes must be stable slugs: ' + code);
        });
    });
});

describe('08 - dummyVerify', function () {

    it('calls back with no arguments', function (t, done) {
        authn.dummyVerify('anything', function () {
            assert.equal(arguments.length, 0, 'there is nothing to decide — no verdict is exposed');
            done();
        });
    });

    it('tolerates a hostile or absent password', function (t, done) {
        // It must not throw on the account-not-found branch, whatever was posted.
        authn.dummyVerify(null, function () {
            authn.dummyVerify('a'.repeat(authn._MAX_PASSWORD_BYTES + 50), function () {
                done();
            });
        });
    });

    it('throws synchronously without a callback', function () {
        assert.throws(function () { authn.dummyVerify('pw'); }, /requires a callback function/);
    });
});

describe('09 - scrypt concurrency gauge', function () {

    it('bounds in-flight work and drains the queue', function (t, done) {
        // Five concurrent hashes against a ceiling of 2: all must complete.
        var pending = 5;
        var results = [];
        for (var i = 0; i < 5; i++) {
            authn.hashPassword('concurrent password ' + i, FAST, function (err, hash) {
                assert.equal(err, null);
                results.push(hash);
                if (--pending === 0) {
                    assert.equal(results.length, 5, 'every queued hash must eventually run');
                    assert.equal(new Set(results).size, 5, 'each must be independently salted');
                    done();
                }
            });
        }
    });

    it('rejects a non-positive ceiling', function () {
        assert.throws(function () { authn.setMaxConcurrentHashes(0); }, /positive integer/);
        assert.throws(function () { authn.setMaxConcurrentHashes(2.5); }, /positive integer/);
        assert.throws(function () { authn.setMaxConcurrentHashes('4'); }, /positive integer/);
    });

    it('accepts a raised ceiling and still completes work', function (t, done) {
        authn.setMaxConcurrentHashes(4);
        authn.hashPassword('after raising the ceiling', FAST, function (err, hash) {
            assert.equal(err, null);
            assert.ok(hash.length > 0);
            authn.setMaxConcurrentHashes(2); // restore the default for suite isolation
            done();
        });
    });
});
