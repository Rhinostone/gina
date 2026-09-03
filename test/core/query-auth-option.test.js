/**
 * #B465 — `options.auth` handling in `self.query()`
 *
 * The documented basic-auth option (`auth: "user:password"`) was consumed by
 * node's own `request()` on the HTTP/1.x path only. On the HTTP/2 path the
 * post-merge option-copy loop forwarded every top-level option into the
 * outgoing header block, and the strip set `_NON_HTTP_OPTS` did not list
 * `auth` — so the credential travelled as a literal `auth:` header and no
 * `Authorization: Basic` was ever minted.
 *
 * Fix under test: a single pre-dispatch block (between `// #B465` markers)
 * mints `Authorization: Basic <base64>` from `auth` when no authorization
 * header is already present, then deletes the option so NEITHER transport can
 * forward it — plus `auth` added to `_NON_HTTP_OPTS` as the belt.
 *
 * `this.query` is an instance method whose dispatch internals are
 * closure-local; per this suite's house pattern (http2-client.test.js,
 * query-circuit-breaker.test.js) the coverage is:
 *
 *   A. Source pins — the fix block exists, is positioned after the
 *      undefined-strip (`options = cleanedOptions;`) and before the
 *      circuit-breaker band, and `_NON_HTTP_OPTS` lists 'auth'.
 *   B. Behaviour replica — the #B465 block is EXTRACTED VERBATIM from the
 *      source and executed. The block is deliberately self-contained
 *      (reads `options` + the global `Buffer` only), so the lifted-scope
 *      hazard of `new Function` does not apply: there is no closure to lose.
 *   C. Leak-mechanism replica — the HTTP/2 copy-loop logic replayed against
 *      the REAL `_NON_HTTP_OPTS` literal extracted from source, proving the
 *      belt strips `auth` even if a future path reintroduces the option.
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var SOURCE = path.join(require('../fw'), 'core/controller/controller.js');
var src    = fs.readFileSync(SOURCE, 'utf8');


// ─── helpers ──────────────────────────────────────────────────────────────────

function extractBetween(startMarker, endMarker) {
    var s = src.indexOf(startMarker);
    var e = src.indexOf(endMarker);
    assert.ok(s > -1, 'start marker not found in source: ' + startMarker);
    assert.ok(e > s,  'end marker not found after start: ' + endMarker);
    return src.slice(s, e);
}


describe('#B465 §00 — instrument validation', function () {

    it('finds a token known to exist and rejects a bogus one', function () {
        assert.ok(src.indexOf('_NON_HTTP_OPTS') > -1, 'known-present token must fire');
        assert.equal(src.indexOf('zz-b465-bogus-token'), -1, 'bogus token must not fire');
    });
});


describe('#B465 §01 — source pins: the fix block exists and is correctly placed', function () {

    it('carries both #B465 markers exactly once each', function () {
        var startCount = src.split('// #B465 — mint Authorization from `auth`').length - 1;
        var endCount   = src.split('// end #B465').length - 1;
        assert.equal(startCount, 1, 'start marker count');
        assert.equal(endCount,   1, 'end marker count');
    });

    it('sits after the undefined-strip and before the circuit-breaker band', function () {
        var strip = src.indexOf('options = cleanedOptions;');
        var block = src.indexOf('// #B465 — mint Authorization from `auth`');
        var cb    = src.indexOf('var _cbAuthority');
        assert.ok(strip > -1 && block > -1 && cb > -1, 'all three anchors present');
        assert.ok(block > strip, 'fix block must run after the undefined-strip');
        assert.ok(block < cb,    'fix block must run before the circuit-breaker band');
    });

    it('deletes the option so no transport can forward it', function () {
        var block = extractBetween('// #B465 — mint Authorization from `auth`', '// end #B465');
        assert.ok(block.indexOf('delete options.auth') > -1, 'the block must delete options.auth');
    });
});


describe('#B465 §02 — source pin: _NON_HTTP_OPTS lists auth (the belt)', function () {

    // Extract the real Set literal from source and materialise it.
    function extractNonHttpOpts() {
        var m = src.match(/_NON_HTTP_OPTS = new Set\(\[([\s\S]*?)\]\)/);
        assert.ok(m, '_NON_HTTP_OPTS literal not found');
        var entries = m[1].match(/'[^']+'/g).map(function (q) { return q.slice(1, -1); });
        return new Set(entries);
    }

    it('contains auth, with a firing control and a known-negative', function () {
        var set = extractNonHttpOpts();
        assert.ok(set.has('agent'),     'control: agent must be in the strip set');
        assert.ok(!set.has('headers'),  'known-negative: headers is filtered separately, never via the set');
        assert.ok(set.has('auth'),      'auth must be in the strip set (#B465 belt)');
    });
});


describe('#B465 §03 — behaviour replica: the extracted block, executed verbatim', function () {

    function runBlock(options) {
        var block = extractBetween('// #B465 — mint Authorization from `auth`', '// end #B465');
        /* The block reads `options` and the global `Buffer` only — asserted by
           the fact this Function compiles and runs with no other bindings. */
        return new Function('options', block + '\nreturn options;')(options);
    }

    it('mints Authorization: Basic from auth and deletes the option', function () {
        var out = runBlock({ auth: 'user:pass', headers: {} });
        assert.equal(out.headers.authorization, 'Basic ' + Buffer.from('user:pass').toString('base64'));
        assert.ok(!('auth' in out), 'auth must be deleted');
    });

    it('a caller-supplied Authorization header wins (uppercase)', function () {
        var out = runBlock({ auth: 'x:y', headers: { 'Authorization': 'Bearer t' } });
        assert.equal(out.headers['Authorization'], 'Bearer t');
        assert.ok(!('authorization' in out.headers), 'no duplicate lowercase key minted');
        assert.ok(!('auth' in out), 'auth still deleted');
    });

    it('a caller-supplied authorization header wins (lowercase)', function () {
        var out = runBlock({ auth: 'x:y', headers: { 'authorization': 'Bearer t' } });
        assert.equal(out.headers.authorization, 'Bearer t');
        assert.ok(!('auth' in out), 'auth still deleted');
    });

    it('an empty-string auth mints nothing but is still deleted', function () {
        var out = runBlock({ auth: '', headers: {} });
        assert.ok(!('authorization' in out.headers), 'nothing minted from an empty credential');
        assert.ok(!('auth' in out), 'auth deleted so it cannot leak');
    });

    it('a non-string auth mints nothing but is still deleted', function () {
        var out = runBlock({ auth: { user: 1 }, headers: {} });
        assert.ok(!('authorization' in out.headers), 'nothing minted from a malformed credential');
        assert.ok(!('auth' in out), 'auth deleted so it cannot leak');
    });

    it('no auth: the block is a no-op', function () {
        var out = runBlock({ headers: { 'content-type': 'application/json' } });
        assert.ok(!('authorization' in out.headers));
        assert.equal(out.headers['content-type'], 'application/json');
    });

    it('a missing headers object is created rather than crashed on', function () {
        // Defensive arm: post-merge `headers` is always an object today (the
        // defaults guarantee it) — the block must still not assume it.
        var out = runBlock({ auth: 'a:b' });
        assert.equal(out.headers.authorization, 'Basic ' + Buffer.from('a:b').toString('base64'));
    });
});


describe('#B465 §04 — leak-mechanism replica: the HTTP/2 copy loop over the REAL strip set', function () {

    // Replays the copy-then-strip logic of handleHTTP2ClientRequest's header
    // build (the copy loop + _NON_HTTP_OPTS sanitisation) with the strip set
    // taken from the shipped source, not re-typed.
    function buildH2Headers(options) {
        var m = src.match(/_NON_HTTP_OPTS = new Set\(\[([\s\S]*?)\]\)/);
        var strip = new Set(m[1].match(/'[^']+'/g).map(function (q) { return q.slice(1, -1); }));

        var headers = Object.assign({
            ':method': options[':method'] || 'GET',
            ':path':   options[':path']   || '/'
        }, options.headers);
        var optKeys = Object.keys(options);
        for (var oi = 0; oi < optKeys.length; ++oi) {
            var o = optKeys[oi];
            if (o.charAt(0) !== ':' && o !== 'headers' && typeof headers[o] == 'undefined') {
                headers[o] = options[o];
            }
        }
        strip.forEach(function (k) { delete headers[k]; });
        return headers;
    }

    it('an auth key surviving to the copy loop is stripped by the belt', function () {
        var headers = buildH2Headers({ auth: 'user:pass', hostname: 'x', port: 443, headers: {} });
        assert.ok(!('auth' in headers), 'the belt must strip a stray auth option');
        assert.ok(!('hostname' in headers), 'control: hostname stripped as before');
    });

    it('a minted authorization header survives the strip', function () {
        var headers = buildH2Headers({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
        assert.equal(headers.authorization, 'Basic dXNlcjpwYXNz');
    });
});
