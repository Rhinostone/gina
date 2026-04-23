'use strict';
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var math = require(path.join(require('../fw'), 'lib/math'));

describe('01 - math.operate — basic arithmetic', function () {

    it('evaluates `10*2` → 20', function () {
        assert.equal(math.operate('10*2'), 20);
    });

    it('respects operator precedence — `2+3*4` → 14', function () {
        assert.equal(math.operate('2+3*4'), 14);
    });

    it('respects parentheses — `(2+3)*4` → 20', function () {
        assert.equal(math.operate('(2+3)*4'), 20);
    });

    it('handles division — `100/5` → 20', function () {
        assert.equal(math.operate('100/5'), 20);
    });

    it('handles modulo — `10%3` → 1', function () {
        assert.equal(math.operate('10%3'), 1);
    });

    it('chains left-to-right at equal precedence — `1+2-3+4` → 4', function () {
        assert.equal(math.operate('1+2-3+4'), 4);
    });

    it('mixes precedence levels — `2*3+4*5` → 26', function () {
        assert.equal(math.operate('2*3+4*5'), 26);
    });

    it('nests parentheses — `((1+2)*3)+4` → 13', function () {
        assert.equal(math.operate('((1+2)*3)+4'), 13);
    });
});

describe('02 - math.operate — decimals and unary sign', function () {

    it('handles decimals — `1.5*2` → 3', function () {
        assert.equal(math.operate('1.5*2'), 3);
    });

    it('preserves JS float semantics — `0.1+0.2` → 0.30000000000000004', function () {
        assert.equal(math.operate('0.1+0.2'), 0.1 + 0.2);
    });

    it('accepts leading unary minus — `-5+10` → 5', function () {
        assert.equal(math.operate('-5+10'), 5);
    });

    it('accepts unary minus on a parenthesised expression — `-(2+3)` → -5', function () {
        assert.equal(math.operate('-(2+3)'), -5);
    });

    it('accepts decimal with no integer part — `.5*2` → 1', function () {
        assert.equal(math.operate('.5*2'), 1);
    });

    it('tolerates whitespace — `  10 * 2  ` → 20', function () {
        assert.equal(math.operate(' 10 * 2 '), 20);
    });
});

describe('03 - math.operate — rejects non-arithmetic input', function () {

    it('throws on letters — `abc`', function () {
        assert.throws(function () { math.operate('abc'); }, /invalid character/);
    });

    it('throws on mixed letters — `1+a`', function () {
        assert.throws(function () { math.operate('1+a'); }, /invalid character/);
    });

    it('throws on unbalanced open paren — `(1+2`', function () {
        assert.throws(function () { math.operate('(1+2'); }, /mismatched parenthesis/);
    });

    it('throws on unbalanced close paren — `1)+2`', function () {
        assert.throws(function () { math.operate('1)+2'); }, /mismatched parenthesis/);
    });

    it('throws on trailing operator — `1++`', function () {
        assert.throws(function () { math.operate('1++'); }, /malformed expression/);
    });

    it('throws on empty string', function () {
        assert.throws(function () { math.operate(''); }, /malformed expression/);
    });

    it('throws on malformed decimal — `1.2.3`', function () {
        assert.throws(function () { math.operate('1.2.3'); }, /invalid number literal/);
    });

    it('rejects identifiers that would have been eval-usable — `process.exit(1)`', function () {
        assert.throws(function () { math.operate('process.exit(1)'); }, /invalid character/);
    });

    it('rejects function-body escape — `});process.exit(1)//`', function () {
        assert.throws(function () { math.operate('});process.exit(1)//'); }, /invalid character/);
    });
});

describe('04 - math.operate — source-inspection guards', function () {

    var fs         = require('fs');
    var mathSource = fs.readFileSync(path.join(require('../fw'), 'lib/math/index.js'), 'utf8');

    it('no longer calls `new Function(`', function () {
        // Only the commented-out reference block may contain `new Function(` now;
        // strip line comments before asserting the live code has none.
        var stripped = mathSource.replace(/^\s*\/\/.*$/gm, '');
        assert.ok(
            !/new\s+Function\s*\(/.test(stripped),
            'live code still contains `new Function(`'
        );
    });

    it('no longer calls `eval(`', function () {
        var stripped = mathSource.replace(/^\s*\/\/.*$/gm, '');
        assert.ok(
            !/\beval\s*\(/.test(stripped),
            'live code still contains `eval(`'
        );
    });

    it('carries the #SCS1 provenance comment', function () {
        assert.ok(/#SCS1/.test(mathSource), 'expected `#SCS1` tag in source');
    });
});
