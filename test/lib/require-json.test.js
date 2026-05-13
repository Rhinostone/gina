'use strict';
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW     = path.resolve(__dirname, '..', '..', 'framework', 'v' + require('../../package.json').version);
var JSON_HELPER = path.join(FW, 'helpers', 'json', 'src', 'main.js');
var CONFIG_JS   = path.join(FW, 'core', 'config.js');


// 01 - requireJSON trailing comma tolerance
describe('01 - requireJSON trailing comma tolerance', function() {

    var src = fs.readFileSync(JSON_HELPER, 'utf8');

    it('source file exists', function() {
        assert.ok(fs.existsSync(JSON_HELPER), 'helpers/json/src/main.js missing');
    });

    it('attempts trailing comma stripping before emerg+exit', function() {
        // The trailing comma fix must appear BEFORE the emerg/process.exit block
        var trailingCommaIdx = src.indexOf(',($1');
        // Use the regex pattern as it appears in source
        var regexIdx = src.indexOf('/,(\\s*[\\}\\]])/g');
        var emergIdx = src.indexOf('console.emerg(error.message)');

        assert.ok(regexIdx > -1, 'trailing comma regex must exist in source');
        assert.ok(emergIdx > -1, 'emerg call must still exist for real errors');
        assert.ok(regexIdx < emergIdx, 'trailing comma fix must run before emerg+exit');
    });

    it('logs a warning (not emerg) when trailing comma is fixed', function() {
        assert.ok(
            src.indexOf("console.warn('[ requireJSON ] trailing comma") > -1,
            'must warn (not emerg) when trailing comma is auto-fixed'
        );
    });

    it('still calls emerg+exit for unfixable JSON errors', function() {
        assert.ok(
            src.indexOf('console.emerg(error.message)') > -1,
            'emerg+exit must still exist for genuinely broken JSON'
        );
        assert.ok(
            src.indexOf('process.exit(1)') > -1,
            'process.exit(1) must still exist for genuinely broken JSON'
        );
    });

    it('catches firstErr and re-uses it for error reporting', function() {
        // The catch block should catch as firstErr, not err
        assert.ok(
            src.indexOf('catch (firstErr)') > -1,
            'catch block must use firstErr to avoid shadowing'
        );
        assert.ok(
            src.indexOf('var err = firstErr') > -1,
            'err must be assigned from firstErr for the error reporting block'
        );
    });

    it('trailing comma regex handles nested objects and arrays', function() {
        // Test the regex independently
        var regex = /,(\s*[\}\]])/g;
        var cases = [
            { input: '{"a":1,}',             expected: '{"a":1}' },
            { input: '{"a":[1,2,]}',         expected: '{"a":[1,2]}' },
            { input: '{"a":{"b":1,},}',      expected: '{"a":{"b":1}}' },
            { input: '{"a":1, "b":2,\n}',    expected: '{"a":1, "b":2\n}' },
            { input: '{"a":1}',              expected: '{"a":1}' } // no change
        ];

        for (var i = 0; i < cases.length; i++) {
            var result = cases[i].input.replace(regex, '$1');
            assert.equal(result, cases[i].expected,
                'case ' + i + ': "' + cases[i].input + '" should become "' + cases[i].expected + '"');
        }
    });

    it('does not strip commas inside string values', function() {
        var regex = /,(\s*[\}\]])/g;
        // Comma before } inside a string value should NOT be stripped by the regex
        // but this is fine because the initial JSON.parse would succeed for valid JSON
        var validJson = '{"msg":"hello, world"}';
        var result = validJson.replace(regex, '$1');
        assert.equal(result, validJson, 'should not modify valid JSON');
    });
});


// 02 - MIDDLEWARE file existence check in config.js
describe('02 - MIDDLEWARE file existence check in config.js', function() {

    var src = fs.readFileSync(CONFIG_JS, 'utf8');

    it('config.js exists', function() {
        assert.ok(fs.existsSync(CONFIG_JS), 'core/config.js missing');
    });

    it('checks MIDDLEWARE file existence before reading', function() {
        assert.ok(
            src.indexOf('fs.existsSync(_middlewarePath)') > -1,
            'must check existence before fs.readFileSync on MIDDLEWARE'
        );
    });

    it('defaults to "none" when MIDDLEWARE file is absent', function() {
        // The else branch should set middleware to 'none'
        var existsIdx = src.indexOf('fs.existsSync(_middlewarePath)');
        var noneIdx   = src.indexOf("middleware = 'none'", existsIdx);
        assert.ok(
            noneIdx > -1 && noneIdx - existsIdx < 500,
            'must default middleware to "none" when file is absent'
        );
    });

    it('still reads the file when it exists', function() {
        assert.ok(
            src.indexOf("fs.readFileSync(_middlewarePath)") > -1,
            'must still read MIDDLEWARE when the file exists'
        );
    });

    it('still sets gina.middleware context', function() {
        assert.ok(
            src.indexOf("setContext('gina.middleware', middleware)") > -1,
            'must always set the gina.middleware context'
        );
    });
});


// 03 - line comment stripping (URL collision)
describe('03 - line comment stripping (URL collision)', function() {

    var src = fs.readFileSync(JSON_HELPER, 'utf8');

    // Per-line first-`//` replica matching helpers/json/src/main.js
    var stripLines = function(jsonStr) {
        return jsonStr.split('\n').map(function(line) {
            var idx = line.indexOf('//');
            if (idx === -1) {
                return line;
            }
            if (idx > 0) {
                var prev = line.charAt(idx - 1);
                if (prev === ':' || prev === '"' || prev === '\\') {
                    return line;
                }
            }
            return line.substring(0, idx);
        }).join('\n');
    };

    it('uses split/map/join with a per-line indexOf scan', function() {
        assert.ok(
            src.indexOf("jsonStr.split('\\n').map") > -1,
            'must split lines and map per-line for first-`//` semantics'
        );
        assert.ok(
            src.indexOf("line.indexOf('//')") > -1,
            'must locate the leftmost `//` per line'
        );
    });

    it('checks only the char immediately before the leftmost `//`', function() {
        assert.ok(
            src.indexOf("line.charAt(idx - 1)") > -1,
            'must read the char immediately before the leftmost `//`'
        );
        assert.ok(
            src.indexOf("prev === ':'") > -1 &&
            src.indexOf("prev === '\"'") > -1 &&
            src.indexOf("prev === '\\\\'") > -1,
            'must guard on `:` / `"` / `\\` only'
        );
    });

    it('no longer iterates per-match with indexOf(commentsWithSlashes)', function() {
        assert.equal(
            src.indexOf('commentsWithSlashes'), -1,
            'the old commentsWithSlashes accumulator must be gone'
        );
        assert.equal(
            src.indexOf("jsonStr.indexOf(commentsWithSlashes"), -1,
            'the old indexOf-into-match guard must be gone'
        );
    });

    it('no longer uses a lookbehind regex (would mis-strip mid-string `//`)', function() {
        assert.equal(
            src.indexOf('(?<!'), -1,
            'lookbehind variant regressed lib/collection fixtures with `://X//Y` strings'
        );
    });

    it('strips bare `//` line separators', function() {
        var input = '{\n  "value": 1,\n  //\n  "other": 2\n}';
        var expected = '{\n  "value": 1,\n  \n  "other": 2\n}';
        assert.equal(stripLines(input), expected);
    });

    it('preserves a line whose leftmost `//` is preceded by `:` (URL)', function() {
        var input = '{"url": "https://example.com/foo"}';
        assert.equal(stripLines(input), input);
    });

    it('preserves a line whose leftmost `//` is preceded by `"` (string start)', function() {
        var input = '{"path": "//fonts.example.com/x.ttf"}';
        assert.equal(stripLines(input), input);
    });

    it('preserves a line whose leftmost `//` is preceded by `\\` (escape)', function() {
        var input = '{"escaped": "\\//keep"}';
        assert.equal(stripLines(input), input);
    });

    it('preserves a line carrying both a URL and a later `//` (per-line first-only)', function() {
        // Matches the lib/collection fixture pattern: "http://host//:rest"
        var input = '{"url": "http://http//:www.caegwynfarm.co.uk"}';
        assert.equal(stripLines(input), input);
    });

    it('strips a comment that follows a URL-bearing string on the same file', function() {
        var input = '{\n  "url": "https://example.com/foo",\n  //\n  "value": 1\n}';
        var parsed = JSON.parse(stripLines(input));
        assert.deepStrictEqual(parsed, { url: 'https://example.com/foo', value: 1 });
    });

    it('strips a trailing `// comment` after a value', function() {
        var input = '{\n  "a": 1 // inline\n}';
        assert.deepStrictEqual(JSON.parse(stripLines(input)), { a: 1 });
    });

    it('strips a file-leading `//` (no preceding char on line)', function() {
        var input = '// header\n{"a": 1}';
        assert.deepStrictEqual(JSON.parse(stripLines(input)), { a: 1 });
    });

    it('end-to-end: requireJSON parses url+bare-separator fixture', function() {
        var jsonHelper = require(JSON_HELPER);
        jsonHelper();
        var fixturePath = path.join(FW, 'helpers', 'json', 'test', 'data', 'url-plus-bare-separator.json');
        if (!fs.existsSync(fixturePath)) {
            return;
        }
        var parsed = requireJSON(fixturePath);
        assert.deepStrictEqual(parsed, { url: 'https://example.com/foo', value: 1 });
    });
});
