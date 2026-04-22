var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var Domain = require(path.join(require('../fw'), 'lib/domain/src/main'));


// These test cases document wrapper-specific behaviour introduced by the psl swap.
// They run BESIDE the historical `domain.test.js` suite — they do not replace it.
// Each case either:
//   - fixes a pre-existing bug in the old lib (IPv4/IPv6/undefined handling), or
//   - exercises a hostname shape the old `.dat`-based parser mishandled (IDN, case).


// 04 — URL parsing (protocol + path + query + port stripping)
describe('04 - URL parsing', function () {

    it('strips protocol and path', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('https://sub.example.com/path?q=1').value, 'example.com');
    });

    it('strips :port from a bare hostname', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('example.com:8080').value, 'example.com');
    });

    it('strips :port from a URL', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('https://example.com:443/').value, 'example.com');
    });

    it('trims surrounding whitespace', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('  example.com  ').value, 'example.com');
    });
});


// 05 — IP literals (today's lib returned broken values: '1.5' for IPv4, '[' for IPv6)
describe('05 - IP literals', function () {

    it('IPv4 returns the full literal', function () {
        var d = new Domain();
        var r = d.getRootDomain('192.168.1.5');
        assert.equal(r.value, '192.168.1.5');
        assert.equal(r.isSLD, false);
        assert.equal(r.isRegisteredTldOrSld, false);
    });

    it('IPv6 literal with brackets returns the address without brackets', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('[::1]').value, '::1');
    });
});


// 06 — defensive handling (today's lib threw on undefined; wrapper returns empty string)
describe('06 - defensive handling', function () {

    it('undefined does not throw', function () {
        var d = new Domain();
        assert.doesNotThrow(function () { d.getRootDomain(undefined); });
        assert.equal(d.getRootDomain(undefined).value, '');
    });

    it('null does not throw', function () {
        var d = new Domain();
        assert.doesNotThrow(function () { d.getRootDomain(null); });
        assert.equal(d.getRootDomain(null).value, '');
    });

    it('empty string returns empty string', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('').value, '');
    });
});


// 07 — IDN (internationalised domain names)
describe('07 - IDN', function () {

    it('punycode label passes through', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('xn--p1ai').value, 'xn--p1ai');
    });

    it('unicode label is converted to punycode', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('россия.xn--p1ai').value,
                     'xn--h1alffa9f.xn--p1ai');
    });
});


// 08 — case normalisation (psl lowercases known suffixes; unknown suffixes keep source case)
describe('08 - case normalisation', function () {

    it('lowercases a recognised eTLD+1', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('EXAMPLE.COM').value, 'example.com');
    });

    it('preserves input case for unrecognised pseudo-TLDs', function () {
        var d = new Domain();
        assert.equal(d.getRootDomain('Mac-mini.local').value, 'Mac-mini.local');
    });
});
