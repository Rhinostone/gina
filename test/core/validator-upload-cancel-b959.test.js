'use strict';
/**
 * FormValidator - a file input change that carries no file leaves the input's records (#B959)
 *
 * The file input's `change` listener records the selection on the input (`customFiles`, the entries
 * its reset and delete links act on) and, since #B150, keeps the stored entries a selection replaces
 * (`_replacedStoredFiles`). A change that carries no file (an emptied selection) wrote both before
 * the listener's early return, so the entries were emptied and every reset or delete link of the
 * input was left bound to nothing: a click sent no request, removed nothing and logged the
 * zero-match warning, while the files' previews and hidden fields stayed in the form. Since the fix
 * the early return comes first.
 *
 * Strategy:
 *  - 01 source pins on the shipped `main.js`, comment-stripped: in the change listener the early
 *    return follows the file-list read and precedes both writes, with no write in between.
 *  - 02 dist fidelity: the unminified bundle carries the same order; in the minified bundle the
 *    listener's early return precedes its `customFiles` read.
 *  The browser path end to end is test/e2e/validator-upload-zero-removal-b150.spec.js (F4, F5).
 *
 * Seams for a red-first run against PRE-fix bytes without touching the shared tree:
 * B959_VALIDATOR_SRC=<copy of main.js>, B959_PLUGIN_DIST=<dir holding js/>.
 *
 * Usage: node --test test/core/validator-upload-cancel-b959.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var MAIN     = process.env.B959_VALIDATOR_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST     = process.env.B959_PLUGIN_DIST   || path.join(FW, 'core/asset/plugin/dist/vendor/gina');
var DIST_RAW = path.join(DIST, 'js/gina.js');
var DIST_MIN = path.join(DIST, 'js/gina.min.js');

var READ    = 'var files = $el.files;';
var RETURN  = 'if (!files.length ) return false;';
var STASH   = '$el._replacedStoredFiles = ( $el._replacedStoredFiles || [] ).concat(_replacedStoredFiles);';
var REPLACE = '$el.customFiles = Array.from(files);';

// the minified listener: its `customFiles` read, and the early return Closure emits
var MIN_READ   = '.customFiles||[]).filter(';
var MIN_RETURN = '.length)return!1;';
var MIN_OPEN   = "'change',function(";

function count(hay, needle) { return hay.split(needle).length - 1; }

/**
 * Drops `//` line comments and `/* *\/` block comments, outside string literals, so a `was:`
 * line or a JSDoc naming a pinned expression cannot satisfy a pin (jsdoc.md, the own-comment trap).
 *
 * @inner
 * @param {string} text - the source
 * @returns {string} the source without its comments
 */
function stripComments(text) {
    var out = '', i = 0, n = text.length, quote = null;
    while (i < n) {
        var c = text[i], d = text[i + 1];
        if (quote) {
            out += c;
            if (c === '\\') { out += d; i += 2; continue; }
            if (c === quote) { quote = null; }
            i++; continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
        if (c === '/' && d === '/') { var e = text.indexOf('\n', i); if (e < 0) { e = n; } i = e; continue; }
        if (c === '/' && d === '*') { var f = text.indexOf('*/', i + 2); assert.ok(f > -1, 'unterminated block comment'); i = f + 2; continue; }
        out += c; i++;
    }
    return out;
}

/**
 * Asserts the listener's order in a text: the file-list read, the early return, the #B150 record,
 * then the `customFiles` write. Each line must occur once, so a copy in a comment fails loudly.
 *
 * @inner
 * @param {string} code - the text to read
 * @param {string} label - names the text in the messages
 * @returns {{read: number, ret: number}} the offsets of the read and of the return
 */
function assertOrder(code, label) {
    assert.equal(count(code, READ), 1, label + ': the file-list read');
    assert.equal(count(code, RETURN), 1, label + ': the early return');
    assert.equal(count(code, STASH), 1, label + ': the #B150 record');
    assert.equal(count(code, REPLACE), 1, label + ': the customFiles write');
    var read = code.indexOf(READ), ret = code.indexOf(RETURN), stash = code.indexOf(STASH), replace = code.indexOf(REPLACE);
    assert.ok(read < ret, label + ': the return follows the file-list read');
    assert.ok(ret < stash, label + ': the return precedes the #B150 record');
    assert.ok(stash < replace, label + ': the #B150 record precedes the customFiles write');
    return { read: read, ret: ret };
}

describe('#B959 - a file input change that carries no file leaves the input\'s records', function () {
    var src  = fs.readFileSync(MAIN, 'utf8');
    var code = stripComments(src);

    describe('01 - source pins (comment-stripped)', function () {
        it('the change listener returns on an empty file list before it writes either record', function () {
            var at = assertOrder(code, 'src');
            var before = code.slice(at.read, at.ret);
            assert.equal(count(before, 'customFiles'), 0, 'no customFiles write before the return');
            assert.equal(count(before, '_replacedStoredFiles'), 0, 'no #B150 record before the return');
        });

        it('[instrument] the raw source carries the lines the stripped read counts', function () {
            assert.ok(count(src, RETURN) >= 1 && count(src, READ) >= 1 && count(src, REPLACE) >= 1, 'the stripped reads above are not vacuous');
        });
    });

    describe('02 - dist fidelity', function () {
        it('the unminified bundle carries the same order', function () {
            assertOrder(fs.readFileSync(DIST_RAW, 'utf8'), 'gina.js');
        });

        it('in the minified bundle the listener returns on an empty file list before it reads customFiles', function () {
            var min = fs.readFileSync(DIST_MIN, 'utf8');
            assert.equal(count(min, MIN_READ), 1, 'the listener\'s customFiles read');
            var read = min.indexOf(MIN_READ);
            var open = min.lastIndexOf(MIN_OPEN, read);
            assert.ok(open > -1 && read - open < 200, 'the read sits at the start of a change listener (' + (read - open) + ' chars)');
            assert.equal(count(min.slice(open, read), MIN_RETURN), 1, 'the early return comes before the read');
        });
    });
});
