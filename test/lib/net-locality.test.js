/**
 * lib/net-locality — control-plane dial-host resolution (#B160).
 *
 * Behavioral coverage of the REAL module (require-by-path — the lib is pure
 * and framework-global-free by design): address normalization, interface
 * matching against an injected `os.networkInterfaces()`-shaped map, the full
 * dial-resolution matrix, and the fail-safe paths (a hostname, a remote
 * address, malformed interface data, and an interface enumeration that
 * throws must all leave today's dial behaviour unchanged).
 *
 * Run: node --test test/lib/net-locality.test.js
 */
'use strict';

var assert = require('node:assert');
var { describe, it } = require('node:test');
var fs   = require('fs');
var path = require('path');

var FW        = require('../fw');
var LIB_MAIN  = path.join(FW, 'lib/net-locality/src/main.js');
var LIB_PKG   = path.join(FW, 'lib/net-locality/package.json');
var LIB_INDEX = path.join(FW, 'lib/index.js');

var nl        = require(LIB_MAIN);
var pkgJson   = JSON.parse(fs.readFileSync(LIB_PKG, 'utf8'));
var libIndex  = fs.readFileSync(LIB_INDEX, 'utf8');

// Deterministic interface fixture — the addresses deliberately avoid this
// machine's real ones so the tests cannot pass by accident on a matching LAN.
var FAKE = {
    en0: [
        { address: '192.168.7.20', family: 'IPv4', internal: false },
        { address: 'fe80::abcd%en0', family: 'IPv6', internal: false }
    ],
    lo0: [
        { address: '127.0.0.1', family: 'IPv4', internal: true },
        { address: '::1', family: 'IPv6', internal: true }
    ]
};

// An interfaces object whose enumeration THROWS — drives the fail-safe path
// without stubbing os.networkInterfaces itself.
var THROWING = new Proxy({}, {
    ownKeys: function () { throw new Error('enumeration failure'); },
    getOwnPropertyDescriptor: function () { throw new Error('enumeration failure'); }
});

describe('01 - module surface', function () {

    it('exports isLocalAddress and resolveDialHost as functions', function () {
        assert.equal(typeof nl.isLocalAddress, 'function');
        assert.equal(typeof nl.resolveDialHost, 'function');
    });

    it('package.json resolves the module via src/main', function () {
        assert.equal(pkgJson.main, 'src/main');
    });

    it('is registered in the lib registry as netLocality', function () {
        assert.match(libIndex, /netLocality\s*:\s*_require\('\.\/net-locality'\),/);
    });
});

describe('02 - isLocalAddress', function () {

    it('loopback is always local (v4, v6, name)', function () {
        assert.equal(nl.isLocalAddress('127.0.0.1', FAKE), true);
        assert.equal(nl.isLocalAddress('127.0.0.53', FAKE), true); // whole 127/8
        assert.equal(nl.isLocalAddress('::1', FAKE), true);
        assert.equal(nl.isLocalAddress('localhost', FAKE), true);
    });

    it('an address assigned to an interface matches exactly', function () {
        assert.equal(nl.isLocalAddress('192.168.7.20', FAKE), true);
    });

    it('a non-local address does not match (TEST-NET)', function () {
        assert.equal(nl.isLocalAddress('192.0.2.1', FAKE), false);
    });

    it('a hostname never matches — only literal addresses are compared', function () {
        assert.equal(nl.isLocalAddress('my-host.local', FAKE), false);
        assert.equal(nl.isLocalAddress('example.com', FAKE), false);
    });

    it('normalizes an IPv4-mapped IPv6 input', function () {
        assert.equal(nl.isLocalAddress('::ffff:192.168.7.20', FAKE), true);
        assert.equal(nl.isLocalAddress('::ffff:192.0.2.1', FAKE), false);
    });

    it('normalizes an IPv6 zone suffix on the interface side', function () {
        assert.equal(nl.isLocalAddress('fe80::abcd', FAKE), true);
    });

    it('trims and lowercases the input', function () {
        assert.equal(nl.isLocalAddress('  192.168.7.20  ', FAKE), true);
        assert.equal(nl.isLocalAddress('LOCALHOST', FAKE), true);
    });

    it('tolerates malformed interface entries', function () {
        assert.equal(nl.isLocalAddress('192.168.7.20', { bad: null }), false);
        assert.equal(nl.isLocalAddress('192.168.7.20', { odd: [null, {}, { address: 42 }] }), false);
    });

    it('fails safe (false) when interface enumeration throws', function () {
        assert.equal(nl.isLocalAddress('192.168.7.20', THROWING), false);
    });

    it('rejects non-string and empty input', function () {
        assert.equal(nl.isLocalAddress('', FAKE), false);
        assert.equal(nl.isLocalAddress(null, FAKE), false);
        assert.equal(nl.isLocalAddress(undefined, FAKE), false);
        assert.equal(nl.isLocalAddress(19124, FAKE), false);
    });

    it('smoke against the REAL interfaces: loopback is local here too', function () {
        assert.equal(nl.isLocalAddress('127.0.0.1'), true);
    });
});

describe('03 - resolveDialHost', function () {

    it('no usable hostV4 falls back to loopback', function () {
        assert.equal(nl.resolveDialHost('', '127.0.0.1', FAKE), '127.0.0.1');
        assert.equal(nl.resolveDialHost(undefined, '127.0.0.1', FAKE), '127.0.0.1');
        assert.equal(nl.resolveDialHost(null, '127.0.0.1', FAKE), '127.0.0.1');
    });

    it('a loopback hostV4 is returned unchanged, in its original form', function () {
        assert.equal(nl.resolveDialHost('127.0.0.1', '0.0.0.0', FAKE), '127.0.0.1');
        assert.equal(nl.resolveDialHost('localhost', '127.0.0.1', FAKE), 'localhost');
        assert.equal(nl.resolveDialHost('::1', '127.0.0.1', FAKE), '::1');
    });

    it('a LOCAL hostV4 dials the concrete bind address', function () {
        assert.equal(nl.resolveDialHost('192.168.7.20', '127.0.0.1', FAKE), '127.0.0.1');
        // operator deliberately bound a concrete non-loopback address
        assert.equal(nl.resolveDialHost('192.168.7.20', '192.168.7.20', FAKE), '192.168.7.20');
    });

    it('a LOCAL hostV4 with a wildcard or missing bind dials loopback', function () {
        assert.equal(nl.resolveDialHost('192.168.7.20', '0.0.0.0', FAKE), '127.0.0.1');
        assert.equal(nl.resolveDialHost('192.168.7.20', '::', FAKE), '127.0.0.1');
        assert.equal(nl.resolveDialHost('192.168.7.20', undefined, FAKE), '127.0.0.1');
        assert.equal(nl.resolveDialHost('192.168.7.20', '', FAKE), '127.0.0.1');
    });

    it('a REMOTE hostV4 is dialled unchanged', function () {
        assert.equal(nl.resolveDialHost('192.0.2.1', '127.0.0.1', FAKE), '192.0.2.1');
        assert.equal(nl.resolveDialHost('203.0.113.7', '0.0.0.0', FAKE), '203.0.113.7');
    });

    it('a hostname is dialled unchanged (never treated as local)', function () {
        assert.equal(nl.resolveDialHost('some-host.example', '127.0.0.1', FAKE), 'some-host.example');
    });

    it('an IPv4-mapped local hostV4 is recognised as local', function () {
        assert.equal(nl.resolveDialHost('::ffff:192.168.7.20', '127.0.0.1', FAKE), '127.0.0.1');
    });

    it('fails safe under interface-enumeration failure: dial unchanged', function () {
        assert.equal(nl.resolveDialHost('192.168.7.20', '127.0.0.1', THROWING), '192.168.7.20');
    });

    it('smoke against the REAL interfaces: loopback resolves to itself', function () {
        assert.equal(nl.resolveDialHost('127.0.0.1', '127.0.0.1'), '127.0.0.1');
    });
});

describe('04 - resolveLocalDialHost (#B320 — intra-host transports: MQ speaker + file container)', function () {

    it('exports as a function', function () {
        assert.equal(typeof nl.resolveLocalDialHost, 'function');
    });

    it('a concrete, non-wildcard LOCAL bind is dialled as-is', function () {
        assert.equal(nl.resolveLocalDialHost('192.168.7.20', FAKE), '192.168.7.20');
        assert.equal(nl.resolveLocalDialHost('127.0.0.1', FAKE), '127.0.0.1');
        assert.equal(nl.resolveLocalDialHost('localhost', FAKE), 'localhost');
    });

    it('a wildcard bind dials loopback (a wildcard includes it)', function () {
        assert.equal(nl.resolveLocalDialHost('0.0.0.0', FAKE), '127.0.0.1');
        assert.equal(nl.resolveLocalDialHost('::', FAKE), '127.0.0.1');
    });

    it('an absent or empty bind dials loopback (the default bind)', function () {
        assert.equal(nl.resolveLocalDialHost(undefined, FAKE), '127.0.0.1');
        assert.equal(nl.resolveLocalDialHost(null, FAKE), '127.0.0.1');
        assert.equal(nl.resolveLocalDialHost('', FAKE), '127.0.0.1');
    });

    it('a FOREIGN bind refuses to leave the host — the shared/stale ~/.gina shape', function () {
        // The regression this function exists for: per-host state stamped by
        // ANOTHER machine must produce a loud local refusal, never a silent
        // cross-host delivery.
        assert.equal(nl.resolveLocalDialHost('203.0.113.7', FAKE), '127.0.0.1');
        assert.equal(nl.resolveLocalDialHost('198.51.100.9', FAKE), '127.0.0.1');
    });

    it('a non-loopback hostname dials loopback (locality of a name is unverifiable)', function () {
        assert.equal(nl.resolveLocalDialHost('my-host.local', FAKE), '127.0.0.1');
    });

    it('an IPv4-mapped local bind is recognised, and returned in its original form', function () {
        assert.equal(nl.resolveLocalDialHost('::ffff:192.168.7.20', FAKE), '::ffff:192.168.7.20');
    });

    it('enumeration failure stays LOCAL — the deliberate inverse of resolveDialHost fail-safe', function () {
        // resolveDialHost fails safe by dialling UNCHANGED (remote
        // administration must keep working). An intra-host transport fails
        // safe the other way: when locality cannot be established, staying on
        // loopback is the refusal that cannot mis-deliver.
        assert.equal(nl.resolveLocalDialHost('192.168.7.20', THROWING), '127.0.0.1');
    });

    it('smoke against the REAL interfaces: the default bind dials loopback', function () {
        assert.equal(nl.resolveLocalDialHost(undefined), '127.0.0.1');
    });
});
