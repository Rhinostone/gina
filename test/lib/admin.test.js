'use strict';

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW        = require('../fw');
var ADMIN_SRC = path.join(FW, 'lib/admin/src/main.js');
var LIB_INDEX = path.join(FW, 'lib/index.js');
var admin     = require(path.join(FW, 'lib/admin/src/main'));

// ─────────────────────────────────────────────────────────────────────────
// #S7 — lib/admin: shared admin /_gina/* IP-allowlist gate
// ─────────────────────────────────────────────────────────────────────────
//
// Extracted from the byte-identical `isAdminClientAllowed` helper that used
// to live in BOTH core/server.js and core/server.isaac.js. This module is
// the single source of truth; both engines now call
// lib.admin.isClientAllowed(req). It reads the allowlist from
// process.gina._adminAllowList (populated by gna.js from app.json
// admin.allowFrom), defaults to loopback, never trusts X-Forwarded-For, and
// normalises ::ffff:IPv4 → IPv4. The helper-body source-pins below + the
// pure-seam branch replica were moved here from server.test.js #S7 /
// server.isaac.test.js §08 when the duplicate was retired.

describe('01 - lib/admin source structure', function () {
    var src = fs.readFileSync(ADMIN_SRC, 'utf8');

    it('exports isClientAllowed (function)', function () {
        assert.equal(typeof admin.isClientAllowed, 'function');
    });

    it('exports the _isAllowedWithList test seam + DEFAULT_ALLOW_LIST', function () {
        assert.equal(typeof admin._isAllowedWithList, 'function');
        assert.deepEqual(admin.DEFAULT_ALLOW_LIST, ['127.0.0.1', '::1']);
    });

    it('reads process.gina._adminAllowList, defaults to loopback', function () {
        assert.ok(src.indexOf('process.gina._adminAllowList') > -1, 'must read process.gina._adminAllowList');
        assert.ok(src.indexOf("'127.0.0.1'") > -1 && src.indexOf("'::1'") > -1, 'must default to loopback');
    });

    it('never trusts X-Forwarded-For (reads req.socket only)', function () {
        // Scope the negative pin to the IP-resolution function BODY, not the
        // whole file — the module/function JSDoc legitimately names
        // X-Forwarded-For to document the defense (jsdoc.md "a negative source
        // pin trips on the file's own JSDoc" trap).
        var fnStart = src.indexOf('function _isAllowedWithList(req, list)');
        var body    = src.slice(fnStart, src.indexOf('}', src.indexOf('return list.indexOf(ip) >= 0', fnStart)));
        assert.ok(body.indexOf('req.socket') > -1, 'must read req.socket.remoteAddress');
        assert.ok(body.indexOf('x-forwarded-for') < 0 && body.indexOf('X-Forwarded-For') < 0,
            'the IP-resolution code must NOT reference X-Forwarded-For');
    });

    it('normalises ::ffff:IPv4 → IPv4', function () {
        assert.ok(src.indexOf('::ffff:') > -1 && src.indexOf('slice(7)') > -1,
            'must strip the ::ffff: prefix from IPv6-mapped IPv4 addresses');
    });
});

describe('02 - lib/index.js registration (plain require, not _require)', function () {
    var idx = fs.readFileSync(LIB_INDEX, 'utf8');

    it('registers admin via plain require(./admin)', function () {
        assert.match(idx, /admin\s*:\s*require\(['"]\.\/admin['"]\)/,
            'lib/index.js must register `admin: require(\'./admin\')`');
    });

    it('does NOT register admin via _require (stateless leaf — #B32-residual)', function () {
        assert.doesNotMatch(idx, /admin\s*:\s*_require\(['"]\.\/admin['"]\)/,
            'admin is a stateless pure-function leaf; it must use plain require, not _require');
    });
});

describe('03 - isClientAllowed (process.gina-backed resolution)', function () {
    var hadGina, savedList;

    before(function () {
        hadGina  = (typeof process.gina === 'object' && process.gina !== null);
        savedList = hadGina ? process.gina._adminAllowList : undefined;
    });
    after(function () {
        if (!hadGina) { delete process.gina; return; }
        if (savedList === undefined) delete process.gina._adminAllowList;
        else process.gina._adminAllowList = savedList;
    });

    it('uses process.gina._adminAllowList when it is a set array', function () {
        process.gina = process.gina || {};
        process.gina._adminAllowList = ['10.0.0.5'];
        assert.equal(admin.isClientAllowed({ socket: { remoteAddress: '10.0.0.5' } }), true);
        assert.equal(admin.isClientAllowed({ socket: { remoteAddress: '127.0.0.1' } }), false,
            'loopback is NOT implicitly allowed once an explicit list is set');
    });

    it('empty allowlist denies everyone (explicit lockdown)', function () {
        process.gina = process.gina || {};
        process.gina._adminAllowList = [];
        assert.equal(admin.isClientAllowed({ socket: { remoteAddress: '127.0.0.1' } }), false);
        assert.equal(admin.isClientAllowed({ socket: { remoteAddress: '::1' } }), false);
    });

    it('falls back to loopback default when _adminAllowList is missing', function () {
        process.gina = process.gina || {};
        delete process.gina._adminAllowList;
        assert.equal(admin.isClientAllowed({ socket: { remoteAddress: '127.0.0.1' } }), true);
        assert.equal(admin.isClientAllowed({ socket: { remoteAddress: '::1' } }), true);
        assert.equal(admin.isClientAllowed({ socket: { remoteAddress: '203.0.113.42' } }), false);
    });
});

describe('04 - _isAllowedWithList (pure seam — full branch coverage)', function () {
    // Mirrors the former server.isaac.test.js §08b / server.test.js replica.
    var isAllowed = admin._isAllowedWithList;

    it('loopback IPv4 is allowed by default', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '127.0.0.1' } }, ['127.0.0.1', '::1']), true);
    });
    it('loopback IPv6 (::1) is allowed by default', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '::1' } }, ['127.0.0.1', '::1']), true);
    });
    it('::ffff:127.0.0.1 (IPv6-mapped IPv4 loopback) is normalised and allowed', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '::ffff:127.0.0.1' } }, ['127.0.0.1', '::1']), true);
    });
    it('arbitrary public IP is denied by the default loopback list', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '203.0.113.42' } }, ['127.0.0.1', '::1']), false);
    });
    it('private network IP is allowed when listed', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '10.0.1.5' } }, ['127.0.0.1', '::1', '10.0.1.5']), true);
    });
    it('::ffff:10.0.1.5 (IPv6-mapped non-loopback) is normalised and matched', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '::ffff:10.0.1.5' } }, ['10.0.1.5']), true);
    });
    it('empty allowlist denies everyone (explicit lockdown)', function () {
        assert.equal(isAllowed({ socket: { remoteAddress: '127.0.0.1' } }, []), false);
        assert.equal(isAllowed({ socket: { remoteAddress: '::1' } }, []), false);
        assert.equal(isAllowed({ socket: { remoteAddress: '10.0.0.1' } }, []), false);
    });
    it('falls back to req.connection.remoteAddress when req.socket is missing', function () {
        assert.equal(isAllowed({ connection: { remoteAddress: '127.0.0.1' } }, ['127.0.0.1', '::1']), true);
    });
    it('req with no socket and no connection denies', function () {
        assert.equal(isAllowed({}, ['127.0.0.1', '::1']), false);
    });
    it('X-Forwarded-For is ignored even when present (spoofing defense)', function () {
        var req = { socket: { remoteAddress: '203.0.113.42' }, headers: { 'x-forwarded-for': '127.0.0.1' } };
        assert.equal(isAllowed(req, ['127.0.0.1', '::1']), false,
            'must NOT trust X-Forwarded-For — reverse proxies could spoof it');
    });
});

// ─────────────────────────────────────────────────────────────────────────
// #B384 — cross-origin WRITE guard for the /_gina/* control family
// ─────────────────────────────────────────────────────────────────────────
//
// The admin endpoints authenticate with an AMBIENT credential (the client
// IP), so a lured operator browsing from an allowlisted address carries it
// into any request an attacker's page makes. /_gina/storage/gc,
// /_gina/cache/clear and /_gina/release/rebuild read their whole input from
// the QUERY STRING and no body, so the attack needs no fetch and no CORS
// reasoning — a plain auto-submitting <form> is enough.
//
// NOTE ON THE SHAPE OF THESE TESTS: §06 and §07 are deliberately mirrored.
// §06 asserts the hostile corpus is REFUSED and would go red against a
// `return false`-always implementation; §07 asserts the legitimate corpus is
// ALLOWED and would go red against a `return true`-always one. Neither alone
// is a control — a guard that refuses everything is as broken as one that
// refuses nothing, and this arc has already shipped one assertion whose
// control could not fail (the #MAINT1 F2 open-redirect check).

describe('05 - isSafeMethod (RFC 9110 safe-method set)', function () {
    it('GET / HEAD / OPTIONS / TRACE are safe, case-insensitively', function () {
        ['GET', 'get', 'HEAD', 'head', 'OPTIONS', 'options', 'TRACE', 'trace'].forEach(function (m) {
            assert.equal(admin.isSafeMethod(m), true, m + ' must be safe');
        });
    });
    it('POST / PUT / PATCH / DELETE are NOT safe', function () {
        ['POST', 'post', 'PUT', 'PATCH', 'DELETE', 'delete'].forEach(function (m) {
            assert.equal(admin.isSafeMethod(m), false, m + ' must NOT be safe');
        });
    });
    it('missing / non-string methods are NOT safe (fail closed)', function () {
        [undefined, null, '', 0, {}, []].forEach(function (m) {
            assert.equal(admin.isSafeMethod(m), false, JSON.stringify(m) + ' must NOT be safe');
        });
    });
});

describe('06 - isCrossOriginWrite REFUSES the hostile corpus', function () {
    it('Sec-Fetch-Site: cross-site is refused (the auto-submitting form)', function () {
        assert.equal(admin.isCrossOriginWrite({ headers: { 'sec-fetch-site': 'cross-site' } }), true);
    });
    it('Sec-Fetch-Site: same-site is refused (sibling subdomain is still cross-origin)', function () {
        assert.equal(admin.isCrossOriginWrite({ headers: { 'sec-fetch-site': 'same-site' } }), true);
    });
    it('a foreign Origin against Host is refused', function () {
        assert.equal(admin.isCrossOriginWrite({
            headers: { origin: 'http://evil.tld:9811', host: '127.0.0.1:3100' }
        }), true);
    });
    it('a foreign Origin against an HTTP/2 :authority is refused', function () {
        assert.equal(admin.isCrossOriginWrite({
            headers: { origin: 'https://evil.tld', ':authority': 'app.tld' }
        }), true);
    });
    it('Origin: null (sandboxed iframe / file://) is refused — #CSRF3 precedent', function () {
        assert.equal(admin.isCrossOriginWrite({ headers: { origin: 'null', host: 'app.tld' } }), true);
    });
    it('X-Forwarded-Host CANNOT be used to fake a same-origin match (#B367)', function () {
        // The attacker controls every forwarded header. If the comparison ever
        // consulted one, this request would read as same-origin and pass.
        assert.equal(admin.isCrossOriginWrite({
            headers: {
                origin: 'http://evil.tld',
                host: '127.0.0.1:3100',
                'x-forwarded-host': 'evil.tld',
                'x-forwarded-proto': 'http'
            }
        }), true, 'must compare against Host/:authority ONLY, never a forwarded header');
    });
    it('a malformed request fails CLOSED', function () {
        [null, undefined, 'nope', 42].forEach(function (r) {
            assert.equal(admin.isCrossOriginWrite(r), true, JSON.stringify(r) + ' must fail closed');
        });
    });
    it('an Origin present with no comparable authority fails CLOSED', function () {
        assert.equal(admin.isCrossOriginWrite({ headers: { origin: 'http://evil.tld' } }), true);
    });
});

describe('07 - isCrossOriginWrite ALLOWS the legitimate corpus', function () {
    it('Sec-Fetch-Site: same-origin is allowed', function () {
        assert.equal(admin.isCrossOriginWrite({ headers: { 'sec-fetch-site': 'same-origin' } }), false);
    });
    it('Sec-Fetch-Site: none is allowed (user-initiated navigation)', function () {
        assert.equal(admin.isCrossOriginWrite({ headers: { 'sec-fetch-site': 'none' } }), false);
    });
    it('no browser signal at all is allowed (curl / the gina CLI / a deploy script)', function () {
        assert.equal(admin.isCrossOriginWrite({ headers: {} }), false);
        assert.equal(admin.isCrossOriginWrite({}), false);
    });
    it('a matching Origin/Host pair is allowed', function () {
        assert.equal(admin.isCrossOriginWrite({
            headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' }
        }), false);
    });
    it('a matching Origin/:authority pair is allowed over HTTP/2', function () {
        assert.equal(admin.isCrossOriginWrite({
            headers: { origin: 'https://app.tld', ':authority': 'app.tld' }
        }), false);
    });
    it('Sec-Fetch-Site WINS over a Host the proxy rewrote (why signal 1 is preferred)', function () {
        // nginx rewriting Host to an upstream name desynchronises the Origin
        // comparison; the browser-computed signal is immune to that.
        assert.equal(admin.isCrossOriginWrite({
            headers: { 'sec-fetch-site': 'same-origin', origin: 'https://public.tld', host: 'localhost:3100' }
        }), false, 'Sec-Fetch-Site must be consulted BEFORE the Origin/Host comparison');
    });
    it('host comparison is case-insensitive', function () {
        assert.equal(admin.isCrossOriginWrite({
            headers: { origin: 'http://APP.tld', host: 'app.TLD' }
        }), false);
    });
});

describe('08 - both engines carry the guard ABOVE every IP-gated handler', function () {
    var SERVER = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
    var ISAAC  = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');

    [['core/server.js', SERVER], ['core/server.isaac.js', ISAAC]].forEach(function (pair) {
        var name = pair[0], src = pair[1];

        it(name + ' calls lib.admin.isCrossOriginWrite', function () {
            assert.ok(src.indexOf('lib.admin.isCrossOriginWrite(request)') > -1,
                'expected the guard call in ' + name);
        });
        it(name + ' exempts SAFE methods', function () {
            assert.ok(src.indexOf('!lib.admin.isSafeMethod(request.method)') > -1,
                'expected the safe-method exemption in ' + name + ' — a cross-origin GET is not a CSRF vector');
        });
        it(name + ' places the guard ABOVE the first IP-gated handler', function () {
            var guardPos = src.indexOf('lib.admin.isCrossOriginWrite(request)');
            var gatePos  = src.indexOf('lib.admin.isClientAllowed(request)');
            assert.ok(guardPos > -1 && gatePos > -1, 'both markers must exist in ' + name);
            assert.ok(guardPos < gatePos,
                'PLACEMENT IS THE FEATURE: the cross-origin guard must run before any ' +
                'IP-gated /_gina/* handler in ' + name + ', so current AND future handlers inherit it');
        });
    });
});
