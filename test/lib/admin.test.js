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
