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

describe('05 - math.checkSumSync — file/data dispatch on extension-shaped tails', function () {
    // #B207 — an extension-shaped tail (`.com`, `.pdf`, ...) is only a HINT that the
    // input names a file: serialized data can end the same way. The file branch must
    // only be taken when the path actually resolves to a file; everything else is data.
    var { before, after } = require('node:test');
    var fs     = require('fs');
    var os     = require('os');
    var crypto = require('crypto');

    var sha1 = function (data) {
        return crypto.createHash('sha1').update(data, 'utf8').digest('hex');
    };

    var tmpDir = null, tmpFile = null, tmpSubDir = null;
    before(function () {
        tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-math-'));
        tmpFile   = path.join(tmpDir, 'fixture.txt');
        fs.writeFileSync(tmpFile, 'file body bytes\n');
        tmpSubDir = path.join(tmpDir, 'sub.com'); // an existing DIRECTORY with a dot+3 tail
        fs.mkdirSync(tmpSubDir);
    });
    after(function () {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('hashes an object whose serialization ends in an extension-shaped tail as data', function () {
        assert.equal(
            math.checkSumSync({ contact: 'user@example.com' }, 'sha1'),
            sha1('contact:user@example.com')
        );
    });

    it('hashes string data ending in `.com` as data', function () {
        var data = 'any text mentioning example.com';
        assert.equal(math.checkSumSync(data, 'sha1'), sha1(data));
    });

    it('hashes data longer than the OS filename limit ending in `.com` as data', function () {
        var data = 'x'.repeat(1000) + '.com';
        assert.equal(math.checkSumSync(data, 'sha1'), sha1(data));
    });

    it('hashes data containing a NUL byte ending in `.com` as data', function () {
        var data = 'data\u0000ending.com';
        assert.equal(math.checkSumSync(data, 'sha1'), sha1(data));
    });

    it('hashes a path naming an existing directory with a dot+3 tail as data', function () {
        assert.equal(math.checkSumSync(tmpSubDir, 'sha1'), sha1(tmpSubDir));
    });

    it('still hashes an existing file with a dot+3 tail by its bytes (control)', function () {
        assert.equal(
            math.checkSumSync(tmpFile, 'sha1'),
            crypto.createHash('sha1').update(fs.readFileSync(tmpFile)).digest('hex')
        );
    });

    it('still hashes plain string data with no extension tail (control)', function () {
        assert.equal(math.checkSumSync('hello world', 'sha1'), sha1('hello world'));
    });

    it('still hashes an object with a non-extension tail (control)', function () {
        assert.equal(math.checkSumSync({ count: 42 }, 'sha1'), sha1('count:42'));
    });

    it('defaults to md5/hex when algorithm and encoding are omitted (control)', function () {
        assert.equal(
            math.checkSumSync('hello world'),
            crypto.createHash('md5').update('hello world', 'utf8').digest('hex')
        );
    });
});

describe('06 - math.checkSumSync — array and object serialization', function () {
    // #B208 — the array branch of the serializer assigned its JSON to the wrong
    // variable and returned the empty string, so EVERY array input collapsed to
    // the checksum of '' (all arrays collided), and it sorted the caller's array
    // in place. Arrays must produce a real, order-insensitive content sum.
    var crypto = require('crypto');

    var sha1 = function (data) {
        return crypto.createHash('sha1').update(data, 'utf8').digest('hex');
    };

    it('different arrays produce different checksums', function () {
        assert.notEqual(
            math.checkSumSync(['user@example.com'], 'sha1'),
            math.checkSumSync(['completely', 'different', 'values'], 'sha1')
        );
    });

    it('an array checksum is not the empty-string hash', function () {
        assert.notEqual(math.checkSumSync(['user@example.com'], 'sha1'), sha1(''));
    });

    it('an array checksum is the hash of the JSON of a sorted copy', function () {
        assert.equal(
            math.checkSumSync(['b', 'a'], 'sha1'),
            sha1(JSON.stringify(['a', 'b']))
        );
    });

    it('an array checksum is order-insensitive', function () {
        assert.equal(
            math.checkSumSync(['b', 'a'], 'sha1'),
            math.checkSumSync(['a', 'b'], 'sha1')
        );
    });

    it('does not mutate the input array', function () {
        var input = ['b', 'a'];
        math.checkSumSync(input, 'sha1');
        assert.deepEqual(input, ['b', 'a']);
    });

    it('an object checksum is key-order-insensitive (control)', function () {
        assert.equal(
            math.checkSumSync({ a: 1, b: 2 }, 'sha1'),
            math.checkSumSync({ b: 2, a: 1 }, 'sha1')
        );
    });
});
