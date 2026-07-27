'use strict';
/**
 * lib/authn lockout — the credential-stuffing brake (#COMPLY3 slice B).
 *
 * Shape of this suite:
 *   §01 defaults — the PCI-DSS 8.3.4 numbers, and the option validation.
 *   §02 counting — consecutive failures accumulate; success clears; the state
 *       projection reports `remaining` honestly.
 *   §03 the lock — crossing the threshold locks, a locked account refuses, and
 *       a SUBTRACT proving the threshold is what locks (not merely "any failure").
 *   §04 expiry — the lock lifts on its own, the counting window rolls, and a
 *       lapsed entry never reports locked. Driven with MOCK TIMERS: a real
 *       30-minute wait is untestable, and a real armed interval hangs the file.
 *   §05 the store contract — a caller-supplied store is used for every
 *       operation, an incomplete one is refused at construction, and a store
 *       error propagates rather than failing open.
 *   §06 the audit event — emitted once on the TRANSITION into locked, carrying
 *       the key; never per attempt; a throwing audit never changes the outcome.
 *   §07 key validation and callback discipline.
 *   §08 memory-store hygiene — lazy expiry on read, and the unref'd sweep.
 */
var { describe, it, mock, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var AUTHN_PATH   = path.join(FW, 'lib/authn/src/main.js');
var LOCKOUT_PATH = path.join(FW, 'lib/authn/src/lockout.js');
var authn        = require(AUTHN_PATH);
var LOCKOUT_SRC  = fs.readFileSync(LOCKOUT_PATH, 'utf8');

/** Collect every open engine so no test leaves a sweep timer armed. */
var _open = [];
function makeLockout(opts) {
    var lo = authn.createLockout(opts);
    _open.push(lo);
    return lo;
}

afterEach(function () {
    _open.forEach(function (lo) {
        try { lo.close(); } catch (e) { /* best effort */ }
    });
    _open = [];
});

describe('01 - defaults and option validation', function () {

    it('defaults to the PCI-DSS 8.3.4 numbers', function () {
        assert.equal(authn._DEFAULT_MAX_ATTEMPTS, 10, 'PCI-DSS 8.3.4: not more than 10 attempts');
        assert.equal(authn._DEFAULT_LOCK_MS, 30 * 60000, 'PCI-DSS 8.3.4: minimum 30 minutes');
        var lo = makeLockout();
        assert.equal(lo._config.maxAttempts, 10);
        assert.equal(lo._config.lockMs, 1800000);
    });

    it('accepts overrides', function () {
        var lo = makeLockout({ maxAttempts: 3, lockMs: 1000, windowMs: 5000 });
        assert.equal(lo._config.maxAttempts, 3);
        assert.equal(lo._config.lockMs, 1000);
        assert.equal(lo._config.windowMs, 5000);
    });

    it('refuses a non-positive or non-numeric option', function () {
        assert.throws(function () { authn.createLockout({ maxAttempts: 0 }); }, /must be a positive number/);
        assert.throws(function () { authn.createLockout({ lockMs: -1 }); }, /must be a positive number/);
        assert.throws(function () { authn.createLockout({ windowMs: '30' }); }, /must be a positive number/);
        assert.throws(function () { authn.createLockout({ maxAttempts: 2.5 }); }, /must be a whole number/);
    });

    it('exposes the engine surface', function () {
        var lo = makeLockout();
        [ 'check', 'recordFailure', 'recordSuccess', 'reset', 'close' ].forEach(function (fn) {
            assert.equal(typeof lo[fn], 'function', fn + ' must exist on the engine');
        });
    });
});

describe('02 - counting failures', function () {

    it('starts clean for an unknown key', function (t, done) {
        makeLockout().check('nobody@example.com', function (err, state) {
            assert.equal(err, null);
            assert.deepEqual(state, { locked: false, attempts: 0, remaining: 10, retryAt: null });
            done();
        });
    });

    it('accumulates consecutive failures and reports remaining', function (t, done) {
        var lo = makeLockout({ maxAttempts: 3 });
        lo.recordFailure('a@example.com', function (e1, s1) {
            assert.equal(s1.attempts, 1);
            assert.equal(s1.remaining, 2);
            assert.equal(s1.locked, false);
            lo.recordFailure('a@example.com', function (e2, s2) {
                assert.equal(s2.attempts, 2);
                assert.equal(s2.remaining, 1);
                assert.equal(s2.locked, false);
                done();
            });
        });
    });

    it('counts each key independently', function (t, done) {
        var lo = makeLockout({ maxAttempts: 3 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function () {
                lo.check('b@example.com', function (err, state) {
                    assert.equal(state.attempts, 0, 'one account\'s failures must not lock another');
                    assert.equal(state.remaining, 3);
                    done();
                });
            });
        });
    });

    it('clears the counter on success', function (t, done) {
        var lo = makeLockout({ maxAttempts: 3 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function () {
                lo.recordSuccess('a@example.com', function (err) {
                    assert.equal(err, null);
                    lo.check('a@example.com', function (e2, state) {
                        assert.equal(state.attempts, 0);
                        assert.equal(state.remaining, 3);
                        done();
                    });
                });
            });
        });
    });

    it('check() records nothing', function (t, done) {
        var lo = makeLockout({ maxAttempts: 3 });
        lo.recordFailure('a@example.com', function () {
            lo.check('a@example.com', function () {
                lo.check('a@example.com', function () {
                    lo.check('a@example.com', function (err, state) {
                        assert.equal(state.attempts, 1, 'reading the state must never advance it');
                        done();
                    });
                });
            });
        });
    });
});

describe('03 - the lock', function () {

    it('locks once the threshold is reached', function (t, done) {
        var lo = makeLockout({ maxAttempts: 3, lockMs: 60000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function () {
                lo.recordFailure('a@example.com', function (err, state) {
                    assert.equal(state.locked, true);
                    assert.equal(state.attempts, 3);
                    assert.equal(state.remaining, 0);
                    assert.equal(typeof state.retryAt, 'number');
                    assert.ok(state.retryAt > Date.now(), 'retryAt must be in the future');
                    done();
                });
            });
        });
    });

    it('SUBTRACT: below the threshold it does NOT lock', function (t, done) {
        // Proves the lock is threshold-driven — a suite where everything locks
        // would pass the test above vacuously.
        var lo = makeLockout({ maxAttempts: 3, lockMs: 60000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function (err, state) {
                assert.equal(state.locked, false, 'two of three failures must not lock');
                assert.equal(state.retryAt, null);
                done();
            });
        });
    });

    it('reports locked on a subsequent check', function (t, done) {
        var lo = makeLockout({ maxAttempts: 2, lockMs: 60000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function () {
                lo.check('a@example.com', function (err, state) {
                    assert.equal(state.locked, true);
                    assert.equal(state.remaining, 0);
                    done();
                });
            });
        });
    });

    it('reset() lifts a lock administratively', function (t, done) {
        // The "or until the user's identity is confirmed" half of PCI 8.3.4.
        var lo = makeLockout({ maxAttempts: 2, lockMs: 60000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function (e, locked) {
                assert.equal(locked.locked, true);
                lo.reset('a@example.com', function (err) {
                    assert.equal(err, null);
                    lo.check('a@example.com', function (e2, state) {
                        assert.equal(state.locked, false);
                        assert.equal(state.attempts, 0);
                        done();
                    });
                });
            });
        });
    });
});

describe('04 - expiry (mock timers)', function () {

    beforeEach(function () {
        mock.timers.enable({ apis: [ 'Date', 'setInterval' ] });
    });

    afterEach(function () {
        mock.timers.reset();
    });

    it('lifts the lock once lockMs has elapsed', function (t, done) {
        var lo = makeLockout({ maxAttempts: 2, lockMs: 60000, windowMs: 60000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function (e, locked) {
                assert.equal(locked.locked, true);
                mock.timers.tick(60001);
                lo.check('a@example.com', function (err, state) {
                    assert.equal(state.locked, false, 'the lock must lift on its own');
                    assert.equal(state.attempts, 0, 'and the counter starts over');
                    done();
                });
            });
        });
    });

    it('control: BEFORE lockMs elapses it is still locked', function (t, done) {
        // Without this the tick test could pass on an engine that never locks.
        var lo = makeLockout({ maxAttempts: 2, lockMs: 60000, windowMs: 60000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function () {
                mock.timers.tick(59000);
                lo.check('a@example.com', function (err, state) {
                    assert.equal(state.locked, true, 'one second early must still refuse');
                    done();
                });
            });
        });
    });

    it('rolls the counting window: an old failure stops counting', function (t, done) {
        var lo = makeLockout({ maxAttempts: 3, lockMs: 60000, windowMs: 10000 });
        lo.recordFailure('a@example.com', function () {
            mock.timers.tick(10001);
            lo.recordFailure('a@example.com', function (err, state) {
                assert.equal(state.attempts, 1, 'a failure outside the window must not accumulate');
                assert.equal(state.remaining, 2);
                done();
            });
        });
    });

    it('control: within the window failures DO accumulate', function (t, done) {
        var lo = makeLockout({ maxAttempts: 3, lockMs: 60000, windowMs: 10000 });
        lo.recordFailure('a@example.com', function () {
            mock.timers.tick(5000);
            lo.recordFailure('a@example.com', function (err, state) {
                assert.equal(state.attempts, 2, 'inside the window they must accumulate');
                done();
            });
        });
    });

    it('a failure after a lapsed lock starts a fresh count', function (t, done) {
        var lo = makeLockout({ maxAttempts: 2, lockMs: 30000, windowMs: 30000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function () {
                mock.timers.tick(30001);
                lo.recordFailure('a@example.com', function (err, state) {
                    assert.equal(state.attempts, 1, 'a lapsed lock must not leave the counter at the threshold');
                    assert.equal(state.locked, false);
                    done();
                });
            });
        });
    });
});

describe('05 - the store contract', function () {

    /** A minimal conforming store that records what it was asked to do. */
    function spyStore() {
        var map = new Map();
        var calls = [];
        return {
            calls: calls,
            get: function (k, cb) { calls.push([ 'get', k ]); process.nextTick(function () { cb(null, map.get(k) || null); }); },
            set: function (k, v, cb) { calls.push([ 'set', k ]); map.set(k, v); process.nextTick(function () { cb(null); }); },
            del: function (k, cb) { calls.push([ 'del', k ]); map.delete(k); process.nextTick(function () { cb(null); }); }
        };
    }

    it('routes every operation through a caller-supplied store', function (t, done) {
        var store = spyStore();
        var lo = makeLockout({ store: store, maxAttempts: 3 });
        lo.recordFailure('a@example.com', function () {
            lo.check('a@example.com', function () {
                lo.recordSuccess('a@example.com', function () {
                    var verbs = store.calls.map(function (c) { return c[0]; });
                    assert.ok(verbs.indexOf('get') > -1, 'get must be used');
                    assert.ok(verbs.indexOf('set') > -1, 'set must be used');
                    assert.ok(verbs.indexOf('del') > -1, 'del must be used');
                    done();
                });
            });
        });
    });

    it('refuses an incomplete store at construction', function () {
        assert.throws(function () { authn.createLockout({ store: {} }); }, /missing: get/);
        assert.throws(function () {
            authn.createLockout({ store: { get: function () {}, set: function () {} } });
        }, /missing: del/);
    });

    it('propagates a store read error rather than failing open', function (t, done) {
        var lo = makeLockout({
            store: {
                get: function (k, cb) { cb(new Error('backend down')); },
                set: function (k, v, cb) { cb(null); },
                del: function (k, cb) { cb(null); }
            }
        });
        lo.check('a@example.com', function (err, state) {
            assert.ok(err instanceof Error, 'a store failure must surface, not read as "not locked"');
            assert.match(err.message, /backend down/);
            assert.equal(state, undefined);
            done();
        });
    });

    it('propagates a store write error', function (t, done) {
        var lo = makeLockout({
            store: {
                get: function (k, cb) { cb(null, null); },
                set: function (k, v, cb) { cb(new Error('write failed')); },
                del: function (k, cb) { cb(null); }
            }
        });
        lo.recordFailure('a@example.com', function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /write failed/);
            done();
        });
    });

    it('does not require close() on a caller-supplied store', function () {
        var lo = authn.createLockout({ store: spyStore() });
        assert.doesNotThrow(function () { lo.close(); });
    });
});

describe('06 - the audit event', function () {

    var audit = require(path.join(FW, 'lib/audit'));

    afterEach(function () {
        audit._resetForTest();
        mock.restoreAll();
    });

    it('emits once on the TRANSITION into locked, carrying the key', function (t, done) {
        var written = [];
        mock.method(audit, 'isEnabled', function () { return true; });
        mock.method(audit, 'write', function (action, data) { written.push([ action, data ]); });

        var lo = makeLockout({ maxAttempts: 2, lockMs: 60000 });
        lo.recordFailure('victim@example.com', function () {
            assert.equal(written.length, 0, 'a failure below the threshold must not emit');
            lo.recordFailure('victim@example.com', function () {
                assert.equal(written.length, 1, 'the transition emits exactly once');
                assert.equal(written[0][0], 'auth.lockout');
                assert.equal(written[0][1].meta.key, 'victim@example.com',
                    'the record must name the locked account — that is the question an assessor asks');
                assert.equal(written[0][1].meta.attempts, 2);
                assert.equal(typeof written[0][1].meta.lockedUntil, 'number');
                done();
            });
        });
    });

    it('does NOT re-emit while already locked', function (t, done) {
        // An attacker hammering a locked account must not be able to flood the trail.
        var written = [];
        mock.method(audit, 'isEnabled', function () { return true; });
        mock.method(audit, 'write', function (action) { written.push(action); });

        var lo = makeLockout({ maxAttempts: 2, lockMs: 60000 });
        lo.recordFailure('a@example.com', function () {
            lo.recordFailure('a@example.com', function () {
                assert.equal(written.length, 1);
                lo.recordFailure('a@example.com', function () {
                    lo.recordFailure('a@example.com', function () {
                        assert.equal(written.length, 1, 'further attempts on a locked account must not re-emit');
                        done();
                    });
                });
            });
        });
    });

    it('emits nothing when the audit trail is disabled', function (t, done) {
        var written = [];
        mock.method(audit, 'isEnabled', function () { return false; });
        mock.method(audit, 'write', function (action) { written.push(action); });

        var lo = makeLockout({ maxAttempts: 1, lockMs: 60000 });
        lo.recordFailure('a@example.com', function (err, state) {
            assert.equal(state.locked, true, 'the lockout itself still works');
            assert.equal(written.length, 0);
            done();
        });
    });

    it('honours audit:false', function (t, done) {
        var written = [];
        mock.method(audit, 'isEnabled', function () { return true; });
        mock.method(audit, 'write', function (action) { written.push(action); });

        var lo = makeLockout({ maxAttempts: 1, lockMs: 60000, audit: false });
        lo.recordFailure('a@example.com', function (err, state) {
            assert.equal(state.locked, true);
            assert.equal(written.length, 0, 'audit:false must suppress the event');
            done();
        });
    });

    it('a THROWING audit never changes the lockout outcome', function (t, done) {
        // Contained, exactly like emitAuthzDenied: the security control must
        // survive an observability failure.
        mock.method(audit, 'isEnabled', function () { return true; });
        mock.method(audit, 'write', function () { throw new Error('trail is on fire'); });

        var lo = makeLockout({ maxAttempts: 1, lockMs: 60000 });
        lo.recordFailure('a@example.com', function (err, state) {
            assert.equal(err, null, 'an audit failure must not surface as a lockout error');
            assert.equal(state.locked, true, 'and must not prevent the lock');
            done();
        });
    });

    it('is wired through the contained shape in source', function () {
        // The emit body must be try/caught in full — the emitAuthzDenied precedent.
        var i = LOCKOUT_SRC.indexOf('function emitLocked');
        assert.ok(i > -1, 'emitLocked must exist');
        var body = LOCKOUT_SRC.slice(i, LOCKOUT_SRC.indexOf('\n    }', i));
        assert.match(body, /try\s*\{/, 'the whole emit body is contained');
        assert.match(body, /catch/, 'and its failure is swallowed');
    });
});

describe('07 - key validation and callback discipline', function () {

    it('refuses a non-string or empty key', function (t, done) {
        var lo = makeLockout();
        lo.check('', function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /non-empty string/);
            lo.recordFailure(null, function (err2) {
                assert.ok(err2 instanceof Error);
                lo.recordSuccess(42, function (err3) {
                    assert.ok(err3 instanceof Error);
                    done();
                });
            });
        });
    });

    it('throws synchronously without a callback', function () {
        var lo = makeLockout();
        assert.throws(function () { lo.check('a'); }, /requires a callback function/);
        assert.throws(function () { lo.recordFailure('a'); }, /requires a callback function/);
        assert.throws(function () { lo.recordSuccess('a'); }, /requires a callback function/);
        assert.throws(function () { lo.reset('a'); }, /requires a callback function/);
    });

    it('never calls back synchronously', function (t, done) {
        // A sync callback would make the engine's control flow re-entrant in a
        // way the caller cannot reason about.
        var lo = makeLockout();
        var after = false;
        lo.check('a@example.com', function () {
            assert.equal(after, true, 'the callback must be deferred');
            done();
        });
        after = true;
    });
});

describe('08 - memory-store hygiene', function () {

    it('expires an entry lazily on read', function (t, done) {
        mock.timers.enable({ apis: [ 'Date', 'setInterval' ] });
        var lo = makeLockout({ maxAttempts: 5, lockMs: 1000, windowMs: 1000 });
        lo.recordFailure('a@example.com', function () {
            assert.equal(lo._store._map.size, 1);
            mock.timers.tick(1001);
            lo.check('a@example.com', function (err, state) {
                assert.equal(state.attempts, 0, 'an expired entry must read as clean');
                assert.equal(lo._store._map.size, 0, 'and must be dropped on read, not left to the sweep');
                mock.timers.reset();
                done();
            });
        });
    });

    it('arms an unref\'d sweep timer', function () {
        // unref is load-bearing: the sweep must never hold the process open.
        assert.match(LOCKOUT_SRC, /timer\.unref\(\)/, 'the sweep timer must be unref\'d');
        var i = LOCKOUT_SRC.indexOf('setInterval');
        var after = LOCKOUT_SRC.slice(i, i + 600);
        assert.match(after, /unref/, 'unref must follow the setInterval that arms the sweep');
    });

    it('close() releases the store', function (t, done) {
        var lo = authn.createLockout({ maxAttempts: 5 });
        lo.recordFailure('a@example.com', function () {
            assert.equal(lo._store._map.size, 1);
            lo.close();
            assert.equal(lo._store._map.size, 0, 'close must clear the map');
            done();
        });
    });
});
