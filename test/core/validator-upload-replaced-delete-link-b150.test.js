'use strict';
/**
 * FormValidator - the delete link of a stored file a selection replaces (#B150)
 *
 * In an edit form, the bind-time scan records each stored file with the id of its delete link
 * (`<input id>-<index>-delete-trigger`), and a selection replaces those entries with the chosen
 * files. The staging success empties the preview container, which takes a delete link placed
 * inside it, never one placed after it — the shape the uploads guide documents — so that link
 * stayed on the page, bound to an entry the input no longer held: a click sent nothing, removed
 * nothing, and logged the zero-match warning. Since the fix the change listener keeps the replaced
 * entries on the input (`_replacedStoredFiles`, carried over a failed staging and an empty
 * selection) and the staging success removes their links, as a delete removes a link.
 *
 * Strategy:
 *  - 01 source pins on the shipped `main.js`, comment-stripped: the change listener keeps the
 *    replaced entries BEFORE it replaces the file list; the staging success removes their links
 *    right after it records the staged files, then clears the record.
 *  - 02 dist fidelity: the unminified bundle carries both sites; the minified one carries the
 *    property the fix adds.
 *  The browser path end to end is test/e2e/validator-upload-zero-removal-b150.spec.js (F1-F3).
 *
 * Seams for a red-first run against PRE-fix bytes without touching the shared tree:
 * B150_VALIDATOR_SRC=<copy of main.js>, B150_PLUGIN_DIST=<dir holding js/>.
 *
 * Usage: node --test test/core/validator-upload-replaced-delete-link-b150.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var MAIN     = process.env.B150_VALIDATOR_SRC || path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DIST     = process.env.B150_PLUGIN_DIST   || path.join(FW, 'core/asset/plugin/dist/vendor/gina');
var DIST_RAW = path.join(DIST, 'js/gina.js');
var DIST_MIN = path.join(DIST, 'js/gina.min.js');

var STASH   = '$el._replacedStoredFiles = ( $el._replacedStoredFiles || [] ).concat(_replacedStoredFiles);';
var REPLACE = '$el.customFiles = Array.from(files);';
var STAGED  = '$uploadTriger.stagedFiles = files;';
var LOOKUP  = 'var $replacedLink = document.getElementById($uploadTriger._replacedStoredFiles[r].deleteLinkId);';
var CLEAR   = '$uploadTriger._replacedStoredFiles = [];';

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

describe('#B150 - the delete link of a stored file a selection replaces', function () {
    var src  = fs.readFileSync(MAIN, 'utf8');
    var code = stripComments(src);

    describe('01 - source pins (comment-stripped)', function () {
        it('the change listener keeps the replaced stored entries on the input, before it replaces the file list', function () {
            assert.equal(count(code, STASH), 1, 'the stash line');
            assert.equal(count(code, REPLACE), 1, 'the file-list replacement');
            assert.ok(code.indexOf(STASH) < code.indexOf(REPLACE), 'the stash comes first');
            assert.equal(count(code, "return entry && entry.deleteLinkId; });"), 1, 'only entries that carry a delete link id are kept');
        });

        it('the staging success removes the links of the replaced entries right after it records the staged files, then clears the record', function () {
            assert.equal(count(code, STAGED), 1);
            assert.equal(count(code, LOOKUP), 1, 'the link lookup');
            assert.equal(count(code, CLEAR), 1, 'the clear');
            var staged = code.indexOf(STAGED), lookup = code.indexOf(LOOKUP), clear = code.indexOf(CLEAR);
            assert.ok(staged < lookup && lookup < clear, 'record, remove, clear — in that order');
            assert.ok(clear - staged < 1200, 'the removal sits with the record, not elsewhere in the file (' + (clear - staged) + ' chars)');
            assert.equal(count(code.slice(lookup, clear), 'dropEmptyUploadPreviewItem($replacedItem, $previewContainer);'), 1, 'an emptied <li> of the container goes with the link');
        });

        it('[instrument] the raw source names the property the pins count', function () {
            assert.ok(count(src, '_replacedStoredFiles') >= 6, 'the stripped reads above are not vacuous');
        });
    });

    describe('02 - dist fidelity', function () {
        it('the unminified bundle carries both sites', function () {
            var raw = fs.readFileSync(DIST_RAW, 'utf8');
            assert.equal(count(raw, STASH), 1);
            assert.equal(count(raw, LOOKUP), 1);
            assert.equal(count(raw, CLEAR), 1);
        });

        it('the minified bundle carries the property the fix adds', function () {
            var min = fs.readFileSync(DIST_MIN, 'utf8');
            assert.ok(count(min, '_replacedStoredFiles') >= 3, 'the stash, the lookup and the clear survive minification (' + count(min, '_replacedStoredFiles') + ')');
        });
    });
});
