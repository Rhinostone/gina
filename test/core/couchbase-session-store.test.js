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


// ─── 07 — touch() stamps lastModified unconditionally (#B165) ────────────────

/**
 * Compile a multi-line prototype method straight out of the shipped source.
 *
 * The couchbase stores cannot be `require`d from a test: they load `core/gna` at
 * module scope (needs a live bundle context) and resolve `debug` through the
 * global `_()` / `getPath('project')` helpers. Executing the shipped bytes beats
 * hand-writing a replica, which would silently drift from the source it mirrors.
 * Brace-matched rather than regex-captured because the body is multi-line.
 *
 * @param   {string}   src  - full file source.
 * @param   {string}   decl - declaration prefix, e.g. `CouchbaseStore.prototype.touch`.
 * @returns {function}        the compiled method; closure vars are injected here.
 * @inner
 */
function extractMethod(src, decl) {
    var declIdx = src.indexOf(decl);
    assert.ok(declIdx > -1, 'declaration must exist: ' + decl);
    assert.equal(src.indexOf(decl, declIdx + 1), -1,
        'declaration must appear exactly once — an extraction matching twice is not a control: ' + decl);

    var fnStart = src.indexOf('function', declIdx);
    var open    = src.indexOf('{', fnStart);
    assert.ok(open > -1, 'method body must have an opening brace');

    var depth = 0
        , end = -1
    ;
    for (var i = open; i < src.length; i++) {
        if (src[i] === '{') {
            depth++;
        } else if (src[i] === '}') {
            depth--;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    assert.equal(depth, 0, 'braces must balance — an unbalanced slice is not a control');
    assert.ok(end > open, 'method body must terminate');

    // `oneDay`, `noop` and `debug` are module-scope closure vars in the store.
    return new Function('oneDay', 'noop', 'debug',
        'return (' + src.slice(fnStart, end) + ');'
    )(86400, function () {}, function () {});
}

/**
 * Minimal stand-in for the store instance: `touch()` reads `this.prefix`,
 * `this.ttl` and `this.client` only.
 *
 * @param   {number|null} ttl - the value `this.ttl` resolves to.
 * @returns {object}            store stand-in; `_upserts` records every write.
 * @inner
 */
function makeStore(ttl) {
    var upserts = [];
    return {
        prefix   : 'sess:',
        ttl      : ttl,
        client   : {
            upsert: function (sid, sess, opts) {
                upserts.push({ sid: sid, sess: sess, opts: opts });
                return Promise.resolve({ cas: '1' });
            }
        },
        _upserts : upserts
    };
}

var ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

[ ['v3', STORE_V3], ['v4', STORE_V4] ].forEach(function (pair) {

    var label = pair[0]
        , file  = pair[1]
    ;

    describe('07 - session-store.' + label + ': touch() stamps lastModified unconditionally (#B165)', function () {

        var touch;
        before(function () {
            touch = extractMethod(fs.readFileSync(file, 'utf8'), 'CouchbaseStore.prototype.touch');
        });

        it('re-stamps a RECENT lastModified — the exact case the removed idle-check skipped', function (t, done) {
            // maxAge 3600000 -> ttl 3600 (seconds); the stamp is 1000ms old. The
            // removed check compared elapsed MILLISECONDS against ttl SECONDS
            // (1000 > 3600 -> false), so it left the stamp untouched while the
            // upsert below still extended the document's expiry. That divergence
            // is the defect: post-fix the stamp tracks every extension.
            var store    = makeStore(null)
                , previous = new Date(Date.now() - 1000).toISOString()
                , sess     = { cookie: { maxAge: 3600000 }, lastModified: previous }
            ;

            touch.call(store, 'abc', sess, function (err) {
                assert.equal(err, null, 'touch must succeed');
                assert.notEqual(sess.lastModified, previous,
                    'lastModified must be re-stamped even when the session was touched moments ago');
                assert.match(sess.lastModified, ISO_UTC,
                    'stamp must be ISO 8601 UTC — the browser re-parses it for the session countdown');
                done();
            });
        });

        it('extends expiry on every touch, independent of the stamp', function (t, done) {
            var store = makeStore(null)
                , sess  = { cookie: { maxAge: 3600000 }, lastModified: new Date().toISOString() }
            ;

            touch.call(store, 'abc', sess, function () {
                assert.equal(store._upserts.length, 1, 'exactly one write per touch');
                assert.deepEqual(store._upserts[0].opts, { expiry: 3600 },
                    'expiry must be refreshed unconditionally — this is why the stamp must be too');
                assert.equal(store._upserts[0].sid, 'sess:abc', 'prefix must be applied to the key');
                done();
            });
        });

        it('a long-idle session is still stamped (no regression in the direction the old check did fire)', function (t, done) {
            var store    = makeStore(null)
                , previous = new Date(Date.now() - 90000000).toISOString()
                , sess     = { cookie: { maxAge: 3600000 }, lastModified: previous }
            ;

            touch.call(store, 'abc', sess, function () {
                assert.notEqual(sess.lastModified, previous, 'long-idle session must be re-stamped');
                assert.match(sess.lastModified, ISO_UTC, 'stamp stays ISO 8601 UTC');
                done();
            });
        });

        it('does not stamp when ttl resolves to 0 — the retained `ttl > 0` guard', function (t, done) {
            var store    = makeStore(null)
                , previous = new Date(Date.now() - 1000).toISOString()
                , sess     = { cookie: { maxAge: 0 }, lastModified: previous }
            ;

            touch.call(store, 'abc', sess, function () {
                assert.equal(sess.lastModified, previous,
                    'a session with no positive ttl must keep its stamp — only the idle-check was removed');
                done();
            });
        });

        it('serialises the stamped session, so the refreshed value is what gets written', function (t, done) {
            var store = makeStore(null)
                , sess  = { cookie: { maxAge: 3600000 }, lastModified: new Date(Date.now() - 1000).toISOString() }
            ;

            touch.call(store, 'abc', sess, function () {
                var written = JSON.parse(store._upserts[0].sess);
                assert.equal(written.lastModified, sess.lastModified,
                    'the persisted payload must carry the refreshed stamp, not the stale one');
                done();
            });
        });

    });

});


// ─── 08 — the idle-check is gone from the source (#B165) ────────────────────

describe('08 - session-store v3/v4: idle-check removed, ISO stamps (#B165)', function () {

    /**
     * Comments are stripped before every negative assertion: the fix's own
     * explanatory comments deliberately NAME the removed construct, and a
     * negative pin cannot tell a code reference from a prose one.
     *
     * @param   {string} file
     * @returns {string} source with `//` comments removed.
     * @inner
     */
    function activeSrc(file) {
        return fs.readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '');
    }

    [ ['v3', STORE_V3], ['v4', STORE_V4] ].forEach(function (pair) {

        var label = pair[0]
            , file  = pair[1]
        ;

        it(label + ': no elapsed-vs-ttl comparison survives in live code', function () {
            var src = activeSrc(file);
            assert.ok(src.indexOf('timeElapsed') < 0,
                label + ': the ms-vs-seconds comparison must be gone, not merely corrected');
            assert.ok(src.indexOf('currentDate') < 0,
                label + ': its operand must be gone too, so no partial revival is possible');
        });

        it(label + ': touch() stamps with toISOString()', function () {
            var src       = activeSrc(file)
                , touchIdx  = src.indexOf('CouchbaseStore.prototype.touch')
                , touchBody = src.slice(touchIdx)
            ;
            assert.match(touchBody, /sess\.lastModified\s*=\s*new Date\(\)\.toISOString\(\);/,
                label + ': touch() must stamp an unambiguous UTC value');
        });

        it(label + ': no zone-less isoDateTime stamp remains in live code', function () {
            var src = activeSrc(file);
            assert.ok(src.indexOf("format('isoDateTime')") < 0,
                label + ': a zone-less local-time stamp is re-parsed as browser-local and skews the countdown');
        });

    });

});
