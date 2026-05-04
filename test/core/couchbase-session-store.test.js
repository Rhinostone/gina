'use strict';
/**
 * Couchbase session store — CB-BUG-4 regression tests
 *
 * Strategy: source inspection + pure-logic replicas.
 * No live Couchbase cluster is required.
 *
 * Bug: session-store.v3.js and session-store.v4.js `touch()` and `destroy()`
 * forwarded the Couchbase SDK v3/v4 `MutationResult` ({cas, token}) as the
 * first argument of the express-session callback.  express-session v1.18.1
 * treats a truthy first arg as an error and calls defer(next, err), routing
 * the CAS token through the error handler as a 500 response body on every
 * authenticated read-only request.  (#CB-BUG-4)
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');
var STORE_V3 = path.join(FW, 'core/connectors/couchbase/lib/session-store.v3.js');
var STORE_V4 = path.join(FW, 'core/connectors/couchbase/lib/session-store.v4.js');


// ─── 01 — v4: destroy() does not leak MutationResult (#CB-BUG-4) ─────────────

describe('01 - session-store.v4: destroy() safe callback (#CB-BUG-4)', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE_V4, 'utf8'); });

    it('#CB-BUG-4 marker is present', function() {
        assert.ok(
            src.indexOf('#CB-BUG-4') > -1,
            'expected #CB-BUG-4 marker — fix comment missing'
        );
    });

    it('destroy() does not use .then(fn) directly', function() {
        // Isolate the destroy method body and strip // comments to avoid matching
        // the explanatory comment that references the old pattern.
        var destroyStart = src.indexOf('CouchbaseStore.prototype.destroy');
        var touchStart   = src.indexOf('CouchbaseStore.prototype.touch');
        var destroyBody  = src.slice(destroyStart, touchStart > destroyStart ? touchStart : src.length);
        var stripped     = destroyBody.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/\.then\(fn\)/.test(stripped),
            'destroy() must not use .then(fn) in live code — MutationResult would be forwarded as err (#CB-BUG-4)'
        );
    });

    it('destroy() calls fn(null) explicitly on success', function() {
        var destroyStart = src.indexOf('CouchbaseStore.prototype.destroy');
        var touchStart   = src.indexOf('CouchbaseStore.prototype.touch');
        var destroyBody  = src.slice(destroyStart, touchStart > destroyStart ? touchStart : src.length);
        assert.ok(
            /fn\(null\)/.test(destroyBody),
            'destroy() .then() must call fn(null) explicitly — not forward resolved value (#CB-BUG-4)'
        );
    });

});


// ─── 02 — v4: touch() does not leak MutationResult (#CB-BUG-4) ──────────────

describe('02 - session-store.v4: touch() safe callback (#CB-BUG-4)', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE_V4, 'utf8'); });

    it('touch() does not use fn.apply(this, arguments) in .then()', function() {
        // Strip // comments — the commented-out old code contains fn.apply(this, arguments)
        var touchStart = src.indexOf('CouchbaseStore.prototype.touch');
        var touchBody  = src.slice(touchStart);
        var stripped   = touchBody.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/fn\s*&&\s*fn\.apply\(this,\s*arguments\)/.test(stripped),
            'touch() must not use fn.apply(this, arguments) in live code — MutationResult forwarded as err (#CB-BUG-4)'
        );
    });

    it('touch() calls fn(null) explicitly on success', function() {
        var touchStart = src.indexOf('CouchbaseStore.prototype.touch');
        var touchBody  = src.slice(touchStart);
        assert.ok(
            /fn\s*&&\s*fn\(null\)/.test(touchBody),
            'touch() .then() must call fn(null) explicitly on success (#CB-BUG-4)'
        );
    });

    it('touch() calls fn(err) in .catch()', function() {
        var touchStart = src.indexOf('CouchbaseStore.prototype.touch');
        var touchBody  = src.slice(touchStart);
        assert.ok(
            /fn\s*&&\s*fn\(err\)/.test(touchBody),
            'touch() .catch() must forward err to callback (#CB-BUG-4)'
        );
    });

});


// ─── 03 — v3: destroy() does not leak MutationResult (#CB-BUG-4) ─────────────

describe('03 - session-store.v3: destroy() safe callback (#CB-BUG-4)', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE_V3, 'utf8'); });

    it('#CB-BUG-4 marker is present', function() {
        assert.ok(
            src.indexOf('#CB-BUG-4') > -1,
            'expected #CB-BUG-4 marker — fix comment missing'
        );
    });

    it('destroy() does not use .then(fn) directly', function() {
        var destroyStart = src.indexOf('CouchbaseStore.prototype.destroy');
        var touchStart   = src.indexOf('CouchbaseStore.prototype.touch');
        var destroyBody  = src.slice(destroyStart, touchStart > destroyStart ? touchStart : src.length);
        var stripped     = destroyBody.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/\.then\(fn\)/.test(stripped),
            'destroy() must not use .then(fn) in live code — MutationResult would be forwarded as err (#CB-BUG-4)'
        );
    });

    it('destroy() calls fn(null) explicitly on success', function() {
        var destroyStart = src.indexOf('CouchbaseStore.prototype.destroy');
        var touchStart   = src.indexOf('CouchbaseStore.prototype.touch');
        var destroyBody  = src.slice(destroyStart, touchStart > destroyStart ? touchStart : src.length);
        assert.ok(
            /fn\(null\)/.test(destroyBody),
            'destroy() .then() must call fn(null) explicitly (#CB-BUG-4)'
        );
    });

});


// ─── 04 — v3: touch() does not leak MutationResult (#CB-BUG-4) ──────────────

describe('04 - session-store.v3: touch() safe callback (#CB-BUG-4)', function() {

    var src;
    before(function() { src = fs.readFileSync(STORE_V3, 'utf8'); });

    it('touch() does not use fn.apply(this, arguments) in .then()', function() {
        // Strip // comments — the commented-out old code contains fn.apply(this, arguments)
        var touchStart = src.indexOf('CouchbaseStore.prototype.touch');
        var touchBody  = src.slice(touchStart);
        var stripped   = touchBody.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/fn\s*&&\s*fn\.apply\(this,\s*arguments\)/.test(stripped),
            'touch() must not use fn.apply(this, arguments) in live code (#CB-BUG-4)'
        );
    });

    it('touch() calls fn(null) explicitly on success', function() {
        var touchStart = src.indexOf('CouchbaseStore.prototype.touch');
        var touchBody  = src.slice(touchStart);
        assert.ok(
            /fn\s*&&\s*fn\(null\)/.test(touchBody),
            'touch() .then() must call fn(null) explicitly on success (#CB-BUG-4)'
        );
    });

    it('touch() calls fn(err) in .catch()', function() {
        var touchStart = src.indexOf('CouchbaseStore.prototype.touch');
        var touchBody  = src.slice(touchStart);
        assert.ok(
            /fn\s*&&\s*fn\(err\)/.test(touchBody),
            'touch() .catch() must forward err to callback (#CB-BUG-4)'
        );
    });

});


// ─── 05 — Pure logic: Promise .then() argument forwarding ────────────────────

describe('05 - pure logic: Promise .then() argument forwarding (#CB-BUG-4)', function() {

    it('forwarding arguments from .then() passes resolved value as first arg (the bug)', function(t, done) {
        var mutationResult = { cas: '1774918045556670464', token: { bucket_name: 'session', vbid: 1, seqno: 2 } };
        var receivedAsErr = null;

        // Simulates the old pattern: .then(function onResult() { fn.apply(this, arguments) })
        Promise.resolve(mutationResult)
            .then(function onResult() {
                receivedAsErr = arguments[0]; // MutationResult ends up as err
            })
            .then(function() {
                assert.deepEqual(
                    receivedAsErr,
                    mutationResult,
                    'arguments[0] in .then() is the resolved value — express-session would treat it as an error'
                );
                done();
            });
    });

    it('calling fn(null) explicitly in .then() always produces err=null (the fix)', function(t, done) {
        var mutationResult = { cas: '1774918045556670464', token: { bucket_name: 'session', vbid: 1, seqno: 2 } };
        var receivedErr = 'sentinel'; // non-null sentinel to confirm it gets overwritten

        Promise.resolve(mutationResult)
            .then(function onResult() {
                receivedErr = null; // explicit fn(null) pattern
            })
            .then(function() {
                assert.equal(receivedErr, null, 'fn(null) guarantees err=null regardless of what upsert resolves with');
                done();
            });
    });

    it('express-session touch callback: truthy first arg triggers defer(next, err)', function() {
        // Replica of express-session v1.18.1 touch callback logic (lines 355-357)
        var deferred = null;
        var writeendCalled = false;

        var defer = function(next, err) { deferred = { next: next, err: err }; };
        var next  = function() {};
        var writeend = function() { writeendCalled = true; };

        var mutationResult = { cas: '1774918045556670464', token: { bucket_name: 'session' } };

        // Simulate: store.touch(sid, sess, function ontouch(err) { if (err) defer(next, err); writeend(); })
        var ontouch = function(err) {
            if (err) {
                defer(next, err);
                return;
            }
            writeend();
        };

        ontouch(mutationResult);   // bug: MutationResult passed as err
        assert.ok(deferred !== null,       'defer() was called — MutationResult treated as error');
        assert.equal(deferred.err, mutationResult, 'MutationResult is the deferred error');
        assert.equal(writeendCalled, false, 'writeend() was NOT called — response cycle disrupted');
    });

    it('express-session touch callback: fn(null) allows normal writeend() path', function() {
        var deferred = null;
        var writeendCalled = false;

        var defer = function(next, err) { deferred = { next: next, err: err }; };
        var next  = function() {};
        var writeend = function() { writeendCalled = true; };

        var ontouch = function(err) {
            if (err) {
                defer(next, err);
                return;
            }
            writeend();
        };

        ontouch(null);   // fix: explicit fn(null)
        assert.equal(deferred, null,       'defer() was NOT called — no error propagated');
        assert.equal(writeendCalled, true,  'writeend() was called — normal response cycle');
    });

});


// ─── 06 — v4: get() handles JsonTranscoder pre-decoded object (#CB-BUG-5) ────
//
// Couchbase Node.js SDK 4.x's `JsonTranscoder` returns the already-decoded
// value rather than raw bytes. The pre-fix code called `.toString()` on the
// resulting object (producing `"[object Object]"`) and then `JSON.parse`d
// it, surfacing as a 500 on every authenticated request that touched
// session retrieval. The fix detects an already-parsed object (non-Buffer)
// and short-circuits before the legacy `.toString()` + `JSON.parse` path.

describe('06 - session-store.v4: get() handles JsonTranscoder pre-decoded object (#CB-BUG-5)', function () {

    var src;
    before(function () { src = fs.readFileSync(STORE_V4, 'utf8'); });

    it('source: FRAMEWORK PATCH marker for the JsonTranscoder branch is present', function () {
        // Negative-invariant lock against an accidental revert.
        assert.ok(
            src.indexOf('JsonTranscoder') > -1,
            'expected `JsonTranscoder` reference in the patch comment'
        );
        assert.ok(
            /typeof\s+data\.value\s*===\s*['"]object['"]\s*&&\s*!Buffer\.isBuffer\(\s*data\.value\s*\)/.test(src),
            'expected the pre-decoded-object short-circuit guard before .toString()'
        );
    });

    it('source: short-circuit returns fn(null, data.value) before .toString()', function () {
        // The branch must call fn(null, parsedValue) directly — falling through
        // to .toString() would re-coerce to "[object Object]" and corrupt parse.
        // Strip line comments first so the commented-out reference implementation
        // higher up in the file (`//         data = data.value.toString();`)
        // doesn't trip the indexOf search.
        var srcCode = src.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        var guardIdx    = srcCode.indexOf("typeof data.value === 'object'");
        var toStringIdx = srcCode.indexOf('data = data.value.toString()');
        assert.ok(guardIdx > -1,    'guard must exist');
        assert.ok(toStringIdx > -1, '.toString() fallback must still exist for legacy raw-bytes path');
        assert.ok(guardIdx < toStringIdx,
            'guard must sit BEFORE the .toString() call so pre-decoded objects skip the legacy path');

        // Region between guard and toString must contain `fn(null, data.value)`.
        var region = srcCode.slice(guardIdx, toStringIdx);
        assert.match(region, /return\s+fn\(\s*null\s*,\s*data\.value\s*\)/,
            'pre-decoded-object branch must short-circuit via fn(null, data.value)');
    });

    // Pure-logic replica of the get() resolution branch isolated from the
    // surrounding async client.get() call. Mirrors the source byte-for-byte
    // for the parse-or-passthrough decision.
    function resolveSessionValue(data, fn) {
        if (!data || !data.value) return fn();
        if (typeof data.value === 'object' && !Buffer.isBuffer(data.value)) {
            return fn(null, data.value);
        }
        var raw = data.value.toString();
        try {
            return fn(null, JSON.parse(raw));
        } catch (e) {
            return fn(e);
        }
    }

    it('pre-decoded object: callback receives the parsed object, not "[object Object]"', function () {
        var parsed = { sessionId: 'abc', cookie: { httpOnly: true }, user: { id: 42 } };
        var captured = null;
        var capturedErr = null;

        resolveSessionValue({ value: parsed }, function (err, value) {
            capturedErr = err;
            captured    = value;
        });

        assert.equal(capturedErr, null, 'no error must surface');
        assert.strictEqual(captured, parsed,
            'callback must receive the parsed-object value as-is — pre-fix it received the JSON.parse of "[object Object]" which throws');
        assert.equal(captured.user.id, 42, 'parsed object must remain navigable post-callback');
    });

    it('Buffer payload: legacy .toString() + JSON.parse path still fires', function () {
        var json = '{"sessionId":"abc","user":{"id":42}}';
        var buf  = Buffer.from(json, 'utf8');
        var captured = null;

        resolveSessionValue({ value: buf }, function (err, value) {
            assert.equal(err, null);
            captured = value;
        });

        assert.deepEqual(captured, JSON.parse(json),
            'Buffer payload must still flow through the legacy .toString() + JSON.parse path');
    });

    it('missing data: callback fires with no args (no-session path)', function () {
        var calls = 0;
        var args  = null;
        resolveSessionValue(null, function () { calls++; args = arguments; });
        assert.equal(calls, 1, 'callback must fire exactly once');
        assert.equal(args.length, 0, 'no-session path passes no arguments to fn');
    });
});
