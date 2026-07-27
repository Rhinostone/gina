/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * lib/authn — authentication hardening primitives (#COMPLY3).
 *
 * **Hooks and helpers, never an identity provider.** Gina does not own a user
 * record, a credential store, a login route, or a session id — those are the
 * bundle's. What this module supplies is the handful of primitives that are
 * dangerous to hand-roll: a memory-hard password hash with a self-describing
 * encoding, a constant-time verify, and a password policy check.
 *
 * It composes with what already ships rather than replacing it:
 *
 *   1. `validatePasswordPolicy(pw)` — at registration / password change.
 *   2. `hashPassword(pw)`           — store the returned PHC string.
 *   3. `createLockout()`            — refuse an account under attack BEFORE
 *                                     spending a KDF on it.
 *   4. `verifyPassword(pw, stored)` — at login.
 *   5. `req.login(user, done)`      — core/router.js rotates the session id and
 *                                     binds `req.session.user` (#COMPLY4).
 *
 * Step 5 is where authentication ENDS and authorization begins: `lib/authz-gate`
 * reads `req.session.user`, so nothing here ever touches a session.
 *
 * **Encoding.** Hashes are PHC strings — `$scrypt$ln=17,r=8,p=1$<salt>$<hash>`
 * (base64, unpadded). Self-describing, so the parameters travel with the hash
 * and can be raised later without a flag day: {@link needsRehash} reports which
 * stored hashes are below the current policy, and the login action upgrades
 * them transparently (it is the only moment the plaintext is in hand).
 *
 * **Why scrypt.** It is memory-hard and lives in node core, so a consumer needs
 * no native addon to get a defensible default — the framework must work out of
 * the box. Argon2id is the stronger primitive where a consumer can install it;
 * {@link verifyPassword} therefore ALSO verifies `$argon2*$` and `$2a/2b/2y$`
 * (bcrypt) hashes through the consumer's own `argon2` / `bcrypt` package, so a
 * bundle migrating onto gina keeps its existing hashes working. Gina never
 * MINTS those formats — one mint path, one set of parameters to reason about.
 *
 * **What this module deliberately does NOT do:** no credential storage, no user
 * lookup, no login route, no session handling, no password reset or email
 * flows, no breach-corpus checks (that needs a network service — see the guide
 * for the k-anonymity pattern), no password history (it needs the store gina
 * does not own).
 *
 * @module lib/authn
 * @see module:lib/authz-gate — the authorization half; reads `req.session.user`
 *
 * @example
 * // in a bundle's login action
 * var authn = require('gina').lib.authn;
 *
 * authn.verifyPassword(self.post.password, account.passwordHash, function (err, ok) {
 *     if (err) { return self.throwError(500); }
 *     if (!ok) { return self.renderJSON({ error: 'invalid credentials' }); }
 *     self.req.login({ id: account.id, roles: account.roles }, function (loginErr) {
 *         if (loginErr) { return self.throwError(500); }
 *         self.redirect('/dashboard');
 *     });
 * });
 */

var crypto  = require('crypto');
var lockout = require('./lockout');

/**
 * Current scrypt cost parameters.
 *
 * `ln` is the base-2 logarithm of scrypt's `N`: `N = 2^17 = 131072`, which with
 * `r = 8` puts the working set at roughly 128 MiB and a single hash in the
 * ~100 ms range on 2026 server hardware — the OWASP Password Storage guidance
 * for scrypt. `p = 1` keeps one hash on one core so the cost is memory, not
 * parallelism.
 *
 * Raising these is a supported change: existing hashes keep verifying (their
 * own parameters are encoded in them) and {@link needsRehash} starts reporting
 * `true` for them.
 *
 * @constant
 * @type {{ln: number, r: number, p: number}}
 * @inner
 * @private
 */
var SCRYPT_PARAMS = { ln: 17, r: 8, p: 1 };

/** @constant {number} Salt length in bytes (128 bits). @inner @private */
var SALT_BYTES = 16;
/** @constant {number} Derived-key length in bytes (256 bits). @inner @private */
var KEY_BYTES = 32;

/**
 * Upper bound on an accepted password, in bytes of UTF-8.
 *
 * A memory-hard KDF is a denial-of-service surface: the work is paid by the
 * server, and an unbounded input lets a caller choose how much. 1024 bytes is
 * far above any real passphrase and far below anything that matters. Rejected
 * as an ERROR rather than silently truncated — a silent truncation would make
 * two different passwords authenticate each other.
 *
 * @constant
 * @type {number}
 * @inner
 * @private
 */
var MAX_PASSWORD_BYTES = 1024;

/**
 * Default minimum password LENGTH.
 *
 * 12 with no composition rules, per NIST SP 800-63B: mandatory character-class
 * mixing measurably pushes users toward predictable substitutions, so length is
 * the requirement and composition is available but off.
 *
 * @constant
 * @type {number}
 * @inner
 * @private
 */
var DEFAULT_MIN_LENGTH = 12;

/**
 * Concurrency ceiling for in-flight scrypt operations.
 *
 * Each hash reserves ~128 MiB and occupies a libuv threadpool slot (default
 * size 4). Without a ceiling, a burst of login attempts is a memory-exhaustion
 * vector and starves every other threadpool user — fs, zlib, dns. Two keeps a
 * burst bounded while leaving threadpool capacity for the rest of the process.
 *
 * @constant
 * @type {number}
 * @inner
 * @private
 */
var DEFAULT_MAX_CONCURRENT = 2;

/** @type {number} In-flight scrypt operations. @inner @private */
var _inFlight = 0;
/** @type {Array<function>} FIFO of queued scrypt starters. @inner @private */
var _queue = [];
/** @type {number} Effective concurrency ceiling. @inner @private */
var _maxConcurrent = DEFAULT_MAX_CONCURRENT;

/**
 * Run `fn` once a concurrency slot is free, releasing the slot when it calls
 * back.
 *
 * FIFO, so a queued attempt cannot be starved by later arrivals. `release` is
 * latched: a KDF callback that fired twice would otherwise corrupt the counter
 * and permanently shrink the pool.
 *
 * @param {function} fn - receives `release` and must call it exactly once.
 * @returns {void}
 * @inner
 * @private
 */
function withSlot(fn) {
    function start() {
        _inFlight++;
        var released = false;
        fn(function release() {
            if (released) {
                return;
            }
            released = true;
            _inFlight--;
            if (_queue.length > 0) {
                var next = _queue.shift();
                next();
            }
        });
    }
    if (_inFlight < _maxConcurrent) {
        return start();
    }
    _queue.push(start);
}

/**
 * Set the scrypt concurrency ceiling.
 *
 * Raise it only alongside a matching threadpool size (`UV_THREADPOOL_SIZE`) and
 * a memory budget — `maxConcurrent * 128 MiB` is the peak.
 *
 * @param {number} n - positive integer.
 * @returns {void}
 * @throws {Error} when `n` is not a positive integer.
 * @memberof module:lib/authn
 *
 * @example
 * lib.authn.setMaxConcurrentHashes(4); // needs UV_THREADPOOL_SIZE >= 6 and ~512 MiB headroom
 */
function setMaxConcurrentHashes(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 1 || Math.floor(n) !== n) {
        throw new Error('[gina authn] setMaxConcurrentHashes(n) expects a positive integer — got: ' + JSON.stringify(n));
    }
    _maxConcurrent = n;
    while (_inFlight < _maxConcurrent && _queue.length > 0) {
        var next = _queue.shift();
        next();
    }
}

/**
 * Reject anything that is not a usable password string.
 *
 * @param {*} password
 * @returns {?Error} the error, or `null` when acceptable.
 * @inner
 * @private
 */
function checkPasswordInput(password) {
    if (typeof password !== 'string') {
        return new Error('[gina authn] password must be a string — got: ' + (password === null ? 'null' : typeof password));
    }
    if (password.length === 0) {
        return new Error('[gina authn] password must not be empty');
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
        return new Error('[gina authn] password exceeds ' + MAX_PASSWORD_BYTES + ' bytes — reject it in your form validation before hashing');
    }
    return null;
}

/**
 * base64 without padding, for PHC fields.
 *
 * @param {Buffer} buf
 * @returns {string}
 * @inner
 * @private
 */
function b64(buf) {
    return buf.toString('base64').replace(/=+$/, '');
}

/**
 * Hash a password, producing a self-describing PHC string.
 *
 * Asynchronous by construction — there is no synchronous variant, because the
 * work is ~100 ms and a sync KDF on the request path blocks the event loop for
 * every other connection.
 *
 * The returned string is what you persist. It embeds the algorithm, the cost
 * parameters and the salt, so nothing else needs storing and the parameters can
 * be raised later without invalidating it.
 *
 * @param {string}   password    - plaintext; 1..1024 bytes UTF-8.
 * @param {object}   [options]   - overrides.
 * @param {number}   [options.ln=17] - base-2 log of scrypt N (14..20).
 * @param {number}   [options.r=8]   - block size.
 * @param {number}   [options.p=1]   - parallelism.
 * @param {function} cb          - `cb(err, phcString)`.
 * @returns {void}
 * @memberof module:lib/authn
 *
 * @example
 * lib.authn.hashPassword('correct horse battery staple', function (err, hash) {
 *     // hash === '$scrypt$ln=17,r=8,p=1$<salt>$<key>'  -> store it
 * });
 *
 * @example <caption>Lower cost in a test suite</caption>
 * lib.authn.hashPassword(pw, { ln: 12 }, function (err, hash) { });
 */
function hashPassword(password, options, cb) {
    if (typeof options === 'function') {
        cb = options;
        options = {};
    }
    if (typeof cb !== 'function') {
        throw new Error('[gina authn] hashPassword(password[, options], cb) requires a callback function');
    }
    options = options || {};

    var inputErr = checkPasswordInput(password);
    if (inputErr) {
        return process.nextTick(function () { cb(inputErr); });
    }

    var ln = (typeof options.ln === 'number') ? options.ln : SCRYPT_PARAMS.ln;
    var r  = (typeof options.r === 'number')  ? options.r  : SCRYPT_PARAMS.r;
    var p  = (typeof options.p === 'number')  ? options.p  : SCRYPT_PARAMS.p;

    if (!isFinite(ln) || ln < 14 || ln > 20 || Math.floor(ln) !== ln) {
        return process.nextTick(function () {
            cb(new Error('[gina authn] hashPassword: `ln` must be an integer in 14..20 — got: ' + JSON.stringify(options.ln)));
        });
    }
    if (!isFinite(r) || r < 1 || Math.floor(r) !== r || !isFinite(p) || p < 1 || Math.floor(p) !== p) {
        return process.nextTick(function () {
            cb(new Error('[gina authn] hashPassword: `r` and `p` must be positive integers — got: r=' + JSON.stringify(options.r) + ', p=' + JSON.stringify(options.p)));
        });
    }

    var salt = crypto.randomBytes(SALT_BYTES);
    var N    = Math.pow(2, ln);

    withSlot(function (release) {
        // node's default maxmem (32 MiB) is below what these parameters need, so
        // it must be raised explicitly or scrypt throws. 128 * N * r is the
        // documented working-set formula; the headroom multiplier covers node's
        // own bookkeeping.
        var maxmem = 128 * N * r * 2;
        crypto.scrypt(password, salt, KEY_BYTES, { N: N, r: r, p: p, maxmem: maxmem }, function (err, derived) {
            release();
            if (err) {
                return cb(err);
            }
            cb(null, '$scrypt$ln=' + ln + ',r=' + r + ',p=' + p + '$' + b64(salt) + '$' + b64(derived));
        });
    });
}

/**
 * Parse a gina scrypt PHC string.
 *
 * @param {string} stored
 * @returns {?{ln: number, r: number, p: number, salt: Buffer, hash: Buffer}} `null` when the string is not a well-formed gina scrypt hash.
 * @inner
 * @private
 */
function parseScryptPhc(stored) {
    if (typeof stored !== 'string') {
        return null;
    }
    var m = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
    if (!m) {
        return null;
    }
    var ln = parseInt(m[1], 10);
    var r  = parseInt(m[2], 10);
    var p  = parseInt(m[3], 10);
    // A stored hash is attacker-controlled the moment the credential store is.
    // Unbounded parameters here would let a single verify allocate arbitrary
    // memory — the same DoS the input cap closes from the other side.
    if (!(ln >= 14 && ln <= 20) || !(r >= 1 && r <= 32) || !(p >= 1 && p <= 16)) {
        return null;
    }
    var salt = Buffer.from(m[4], 'base64');
    var hash = Buffer.from(m[5], 'base64');
    if (salt.length === 0 || hash.length === 0) {
        return null;
    }
    return { ln: ln, r: r, p: p, salt: salt, hash: hash };
}

/**
 * Resolve an optional verifier package from the consuming project.
 *
 * Same project-path resolution every gina connector uses for its driver — the
 * package belongs to the bundle, not the framework.
 *
 * @param {string} pkg - `'argon2'` or `'bcrypt'`.
 * @returns {?object} the module, or `null` when not installed.
 * @inner
 * @private
 */
function resolveVerifier(pkg) {
    if (_injectedVerifiers[pkg]) {
        return _injectedVerifiers[pkg];
    }
    try {
        var p = _(getPath('project') + '/node_modules/' + pkg, true);
        return require(p);
    } catch (e) {
        return null;
    }
}

/** @type {object} Test-injected verifier modules. @inner @private */
var _injectedVerifiers = {};

/**
 * Inject a verifier module, bypassing project-path resolution.
 *
 * Test seam — mirrors `lib/metrics`' `opts.client`. Not part of the supported
 * surface.
 *
 * @param {string}  pkg - `'argon2'` or `'bcrypt'`.
 * @param {?object} mod - the module, or `null` to clear.
 * @returns {void}
 * @memberof module:lib/authn
 * @private
 */
function _setVerifier(pkg, mod) {
    if (mod === null) {
        delete _injectedVerifiers[pkg];
        return;
    }
    _injectedVerifiers[pkg] = mod;
}

/**
 * Verify a password against a stored hash.
 *
 * Accepts gina's own `$scrypt$` hashes, and — through the consuming project's
 * own `argon2` / `bcrypt` install — `$argon2i$` / `$argon2d$` / `$argon2id$`
 * and `$2a$` / `$2b$` / `$2y$`. That foreign-format branch exists so a bundle
 * arriving with existing hashes keeps working; pair it with {@link needsRehash}
 * to migrate on login.
 *
 * **Never throws for a bad password.** A malformed or unrecognised stored hash
 * is `cb(null, false)`, not an error — a corrupted record must not be
 * distinguishable from a wrong password by an attacker watching responses. A
 * genuine operational failure (KDF error, verifier package missing for a format
 * that needs one) IS an error, because it needs an operator, not a login form.
 *
 * @param {string}   password - plaintext to check.
 * @param {string}   stored   - the persisted hash string.
 * @param {function} cb       - `cb(err, isValid)`.
 * @returns {void}
 * @memberof module:lib/authn
 *
 * @example
 * lib.authn.verifyPassword(submitted, account.passwordHash, function (err, ok) {
 *     if (err)  { return self.throwError(500); }  // operational
 *     if (!ok)  { return deny(); }                // wrong password
 * });
 *
 * @example <caption>Unknown account — spend the same time (see dummyVerify)</caption>
 * if (!account) { return lib.authn.dummyVerify(submitted, function () { deny(); }); }
 */
function verifyPassword(password, stored, cb) {
    if (typeof cb !== 'function') {
        throw new Error('[gina authn] verifyPassword(password, stored, cb) requires a callback function');
    }
    var inputErr = checkPasswordInput(password);
    if (inputErr) {
        return process.nextTick(function () { cb(inputErr); });
    }
    if (typeof stored !== 'string' || stored.length === 0) {
        return process.nextTick(function () { cb(null, false); });
    }

    if (/^\$argon2[id]{1,2}\$/.test(stored)) {
        var argon2 = resolveVerifier('argon2');
        if (!argon2 || typeof argon2.verify !== 'function') {
            return process.nextTick(function () {
                cb(new Error('[gina authn] this hash is argon2, which gina verifies through your project\'s own package. Run: npm install argon2'));
            });
        }
        return Promise.resolve()
            .then(function () { return argon2.verify(stored, password); })
            .then(function (ok) { cb(null, ok === true); })
            .catch(function () { cb(null, false); });
    }

    if (/^\$2[aby]\$/.test(stored)) {
        var bcrypt = resolveVerifier('bcrypt');
        if (!bcrypt || typeof bcrypt.compare !== 'function') {
            return process.nextTick(function () {
                cb(new Error('[gina authn] this hash is bcrypt, which gina verifies through your project\'s own package. Run: npm install bcrypt'));
            });
        }
        return bcrypt.compare(password, stored, function (err, ok) {
            if (err) {
                return cb(null, false);
            }
            cb(null, ok === true);
        });
    }

    var parsed = parseScryptPhc(stored);
    if (!parsed) {
        return process.nextTick(function () { cb(null, false); });
    }

    var N = Math.pow(2, parsed.ln);
    withSlot(function (release) {
        var maxmem = 128 * N * parsed.r * 2;
        crypto.scrypt(password, parsed.salt, parsed.hash.length, { N: N, r: parsed.r, p: parsed.p, maxmem: maxmem }, function (err, derived) {
            release();
            if (err) {
                return cb(err);
            }
            // Lengths match by construction (derived is requested at the stored
            // length), so timingSafeEqual cannot throw here — the try/catch is
            // the house convention, and it keeps a future refactor fail-closed.
            var ok = false;
            try {
                ok = crypto.timingSafeEqual(derived, parsed.hash);
            } catch (e) {
                ok = false;
            }
            cb(null, ok);
        });
    });
}

/**
 * Spend a verify's worth of time without a stored hash.
 *
 * A login that returns instantly for an unknown account and slowly for a known
 * one is a user-enumeration oracle, and it is measurable across a network. Call
 * this on the account-not-found branch so both branches cost the same.
 *
 * @param {string}   password - the submitted plaintext.
 * @param {function} cb       - `cb()`; no arguments, nothing to decide.
 * @returns {void}
 * @memberof module:lib/authn
 *
 * @example
 * if (!account) {
 *     return lib.authn.dummyVerify(self.post.password, function () {
 *         self.renderJSON({ error: 'invalid credentials' });
 *     });
 * }
 */
function dummyVerify(password, cb) {
    if (typeof cb !== 'function') {
        throw new Error('[gina authn] dummyVerify(password, cb) requires a callback function');
    }
    var pw = (typeof password === 'string' && password.length > 0 && Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES)
        ? password
        : 'x';
    var salt = crypto.randomBytes(SALT_BYTES);
    var N    = Math.pow(2, SCRYPT_PARAMS.ln);
    withSlot(function (release) {
        var maxmem = 128 * N * SCRYPT_PARAMS.r * 2;
        crypto.scrypt(pw, salt, KEY_BYTES, { N: N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, maxmem: maxmem }, function () {
            release();
            cb();
        });
    });
}

/**
 * Report whether a stored hash is below the current policy.
 *
 * True when the hash is not gina scrypt (a foreign argon2 / bcrypt hash, or an
 * unparseable string) or when its encoded parameters are weaker than the
 * current defaults. Re-hash on the next successful login — the one moment the
 * plaintext is available.
 *
 * @param {string} stored - the persisted hash string.
 * @returns {boolean}
 * @memberof module:lib/authn
 *
 * @example
 * if (ok && lib.authn.needsRehash(account.passwordHash)) {
 *     lib.authn.hashPassword(submitted, function (err, fresh) {
 *         if (!err) { account.passwordHash = fresh; account.save(); }
 *     });
 * }
 */
function needsRehash(stored) {
    var parsed = parseScryptPhc(stored);
    if (!parsed) {
        return true;
    }
    return parsed.ln < SCRYPT_PARAMS.ln
        || parsed.r < SCRYPT_PARAMS.r
        || parsed.p < SCRYPT_PARAMS.p;
}

/**
 * Validate a password against a length / composition policy.
 *
 * Length-first, per NIST SP 800-63B: the default is a 12-character minimum with
 * NO character-class requirements, because mandatory composition measurably
 * degrades real-world password quality. Composition rules are available for
 * consumers whose auditor requires them.
 *
 * @param {string}   password  - the candidate.
 * @param {object}   [options] - policy overrides.
 * @param {number}   [options.minLength=12]      - minimum characters (code points, not bytes).
 * @param {number}   [options.maxLength=1024]    - maximum bytes of UTF-8.
 * @param {boolean}  [options.requireUppercase=false]
 * @param {boolean}  [options.requireLowercase=false]
 * @param {boolean}  [options.requireDigit=false]
 * @param {boolean}  [options.requireSymbol=false]
 * @param {string[]} [options.deny=[]]           - case-insensitive substrings to reject (the user's own email, the site name, …).
 * @returns {{valid: boolean, errors: string[]}} `errors` are stable machine-readable codes: `too-short`, `too-long`, `missing-uppercase`, `missing-lowercase`, `missing-digit`, `missing-symbol`, `denied-substring`, `not-a-string`.
 * @memberof module:lib/authn
 *
 * @example
 * var check = lib.authn.validatePasswordPolicy(self.post.password, {
 *     deny: [ self.post.email, 'gina' ]
 * });
 * if (!check.valid) { return self.renderJSON({ errors: check.errors }); }
 */
function validatePasswordPolicy(password, options) {
    options = options || {};
    var errors = [];

    if (typeof password !== 'string') {
        return { valid: false, errors: [ 'not-a-string' ] };
    }

    var minLength = (typeof options.minLength === 'number') ? options.minLength : DEFAULT_MIN_LENGTH;
    var maxLength = (typeof options.maxLength === 'number') ? options.maxLength : MAX_PASSWORD_BYTES;

    // Count code points, not UTF-16 units, so an emoji or an astral character
    // counts once rather than twice.
    var length = Array.from(password).length;
    if (length < minLength) {
        errors.push('too-short');
    }
    if (Buffer.byteLength(password, 'utf8') > maxLength) {
        errors.push('too-long');
    }
    if (options.requireUppercase === true && !/[A-Z]/.test(password)) {
        errors.push('missing-uppercase');
    }
    if (options.requireLowercase === true && !/[a-z]/.test(password)) {
        errors.push('missing-lowercase');
    }
    if (options.requireDigit === true && !/[0-9]/.test(password)) {
        errors.push('missing-digit');
    }
    if (options.requireSymbol === true && !/[^A-Za-z0-9]/.test(password)) {
        errors.push('missing-symbol');
    }
    if (Array.isArray(options.deny) && options.deny.length > 0) {
        var lower = password.toLowerCase();
        for (var i = 0; i < options.deny.length; i++) {
            var needle = options.deny[i];
            if (typeof needle === 'string' && needle.length > 0 && lower.indexOf(needle.toLowerCase()) > -1) {
                errors.push('denied-substring');
                break;
            }
        }
    }

    return { valid: errors.length === 0, errors: errors };
}

module.exports = {
    hashPassword            : hashPassword,
    verifyPassword          : verifyPassword,
    dummyVerify             : dummyVerify,
    needsRehash             : needsRehash,
    validatePasswordPolicy  : validatePasswordPolicy,
    setMaxConcurrentHashes  : setMaxConcurrentHashes,
    createLockout           : lockout.createLockout,
    // test seams — may change without notice
    _createMemoryStore      : lockout._createMemoryStore,
    _DEFAULT_MAX_ATTEMPTS   : lockout._DEFAULT_MAX_ATTEMPTS,
    _DEFAULT_LOCK_MS        : lockout._DEFAULT_LOCK_MS,
    _parseScryptPhc         : parseScryptPhc,
    _setVerifier            : _setVerifier,
    _SCRYPT_PARAMS          : SCRYPT_PARAMS,
    _MAX_PASSWORD_BYTES     : MAX_PASSWORD_BYTES,
    _DEFAULT_MIN_LENGTH     : DEFAULT_MIN_LENGTH
};
