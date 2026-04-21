/**
 * CLI argv parsing — split on first `=` only.
 *
 * Two entry points in the pipeline both used to call `.split(/=/)` with no
 * limit, silently truncating any `--<key>=<value>` where the value itself
 * contained `=`:
 *
 *   utils/helper.js::filterArgs            — populates process.gina.GINA_*
 *   lib/cmd/helper.js::getParams           — populates cmd.params[<key>]
 *
 * Real-world values that used to break:
 *   --driver-version=">=5.3.0 <6.0.0"      → truncated to ">"
 *   --password=foo=bar                     → truncated to "foo"
 *   --api-key=sk-=abc                      → truncated to "sk-"
 *
 * Fix: split on the first `=` only (indexOf-based substring).
 *
 * These tests are two-layered:
 *   (a) source-inspection — confirm both sites use the new indexOf pattern
 *       and none of them uses a bare `split(/=/)` without a limit;
 *   (b) behaviour — replicate the exact parsing snippet and assert it
 *       preserves multi-`=` values.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var CMD_HELPER_PATH = path.join(require('../fw'), 'lib/cmd/helper.js');
var UTILS_HELPER_PATH = path.resolve(__dirname, '..', '..', 'utils', 'helper.js');

var cmdHelperSrc = fs.readFileSync(CMD_HELPER_PATH, 'utf8');
var utilsHelperSrc = fs.readFileSync(UTILS_HELPER_PATH, 'utf8');


// ---------------------------------------------------------------------------
// 01 — lib/cmd/helper.js::getParams — source structure
// ---------------------------------------------------------------------------

describe('01 - lib/cmd/helper.js::getParams source structure', function () {

    it('splits on the first `=` only via indexOf + substring', function () {
        // Positive invariant: the new pattern is present.
        assert.match(
            cmdHelperSrc,
            /var\s+_raw\s*=\s*process\.argv\[a\]\.replace\(\/--\/,\s*''\);\s*var\s+_eq\s*=\s*_raw\.indexOf\('='\);\s*arr\s*=\s*\(_eq\s*>\s*-1\)\s*\?\s*\[\s*_raw\.substring\(0,\s*_eq\)\s*,\s*_raw\.substring\(_eq\s*\+\s*1\)\s*\]\s*:\s*\[\s*_raw\s*\];/
        );
    });

    it('does NOT call bare `.split(/=/)` on process.argv[a] (no-limit truncation trap)', function () {
        // Negative invariant: the old pattern must not come back. Restricted
        // to lines where process.argv[a] is the subject so we don't flag
        // unrelated string splits elsewhere in the file.
        var lines = cmdHelperSrc.split(/\r?\n/);
        var re    = /process\.argv\[a\][^;]*\.split\(\s*\/=\/\s*\)/;
        var hits  = lines.filter(function (ln) { return re.test(ln); });
        assert.deepEqual(hits, [], 'bare split(/=/) reintroduced: ' + hits.join(' | '));
    });

    it('still lower-cases arr[0] after splitting', function () {
        // Sanity check — whitelist matching in getParams is case-insensitive
        // only because arr[0] is lower-cased after the split.
        assert.match(cmdHelperSrc, /arr\[0\]\s*=\s*arr\[0\]\.toLowerCase\(\);/);
    });

});


// ---------------------------------------------------------------------------
// 02 — utils/helper.js::filterArgs — source structure
// ---------------------------------------------------------------------------

describe('02 - utils/helper.js::filterArgs source structure', function () {

    it('splits on the first `=` only via indexOf + substring', function () {
        assert.match(
            utilsHelperSrc,
            /var\s+_raw\s*=\s*\(process\.argv\[a\]\.replace\(\/--\/,\s*''\)\)\.replace\(\/-\/,\s*'_'\);\s*var\s+_eq\s*=\s*_raw\.indexOf\('='\);\s*evar\s*=\s*\(_eq\s*>\s*-1\)\s*\?\s*\[\s*_raw\.substring\(0,\s*_eq\)\s*,\s*_raw\.substring\(_eq\s*\+\s*1\)\s*\]\s*:\s*\[\s*_raw\s*\];/
        );
    });

    it('does NOT call bare `.split(/=/)` on process.argv[a] (no-limit truncation trap)', function () {
        var lines = utilsHelperSrc.split(/\r?\n/);
        var re    = /process\.argv\[a\][^;]*\.split\(\s*\/=\/\s*\)/;
        var hits  = lines.filter(function (ln) { return re.test(ln); });
        assert.deepEqual(hits, [], 'bare split(/=/) reintroduced: ' + hits.join(' | '));
    });

    it('still upper-cases evar[0] after splitting', function () {
        assert.match(utilsHelperSrc, /evar\[0\]\s*=\s*evar\[0\]\.toUpperCase\(\);/);
    });

});


// ---------------------------------------------------------------------------
// 03 — Behaviour — replicate the fix snippet and assert multi-`=` preservation
// ---------------------------------------------------------------------------

function splitOnFirstEq(raw) {
    var eq = raw.indexOf('=');
    return (eq > -1) ? [ raw.substring(0, eq), raw.substring(eq + 1) ] : [ raw ];
}

describe('03 - split-on-first-= behaviour', function () {

    it('preserves a version range with leading `>=`', function () {
        var arr = splitOnFirstEq('driver-version=>=5.3.0 <6.0.0');
        assert.equal(arr[0], 'driver-version');
        assert.equal(arr[1], '>=5.3.0 <6.0.0');
    });

    it('preserves a caret range', function () {
        var arr = splitOnFirstEq('driver-version=^5.3.0');
        assert.equal(arr[0], 'driver-version');
        assert.equal(arr[1], '^5.3.0');
    });

    it('preserves a password with embedded `=`', function () {
        var arr = splitOnFirstEq('password=foo=bar');
        assert.equal(arr[0], 'password');
        assert.equal(arr[1], 'foo=bar');
    });

    it('preserves a base64-ish api key with embedded `=`', function () {
        var arr = splitOnFirstEq('api-key=sk-=abc=');
        assert.equal(arr[0], 'api-key');
        assert.equal(arr[1], 'sk-=abc=');
    });

    it('handles a simple value unchanged', function () {
        var arr = splitOnFirstEq('port=8124');
        assert.equal(arr[0], 'port');
        assert.equal(arr[1], '8124');
    });

    it('handles an empty value', function () {
        var arr = splitOnFirstEq('flag=');
        assert.equal(arr[0], 'flag');
        assert.equal(arr[1], '');
    });

    it('handles a token with no `=` at all', function () {
        var arr = splitOnFirstEq('dry-run');
        assert.equal(arr[0], 'dry-run');
        assert.equal(arr.length, 1);
    });

});
