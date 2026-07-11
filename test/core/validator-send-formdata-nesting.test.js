/**
 * send(FormData) bracket-notation nesting — #B92
 *
 * The programmatic `$form.send(FormData)` path flat-copied every non-File entry
 * (`newData[key] = value`) and `JSON.stringify`'d it verbatim, so a bracket-notation
 * field name like `item[0][id]` reached the server as a LITERAL JSON key
 * (`{"item[0][id]":"x"}`) — `req.post['item[0][id]']` populated while `req.post.item`
 * stayed undefined. The DECLARATIVE submit path nests the same names client-side
 * (via `formatDataFromString` -> `parseObject`/`parseLocalObj`), so one field set
 * behaved differently per submit path.
 *
 * The fix nests the non-File entries in the FormData loop with a byte-faithful port
 * of the data helper's `parseLocalObj` (`nestBracketNotationKey`), applied per entry.
 * Values stay VERBATIM — no url-decode, no `"true"`/`"false"`/`"null"` coercion —
 * because the non-binary body is posted as `application/json` and the server keeps
 * JSON keys/values as sent (#B28). File routing and the `send(plainObject)` verbatim
 * escape hatch are untouched.
 *
 * Coverage: source pins on the fix shape + a real-bytes extract+eval proving the
 * ported helper is behaviourally identical to the source `parseLocalObj`, the
 * canonical nesting cases + a SUBTRACT reproducing the pre-fix flat shape, and
 * dist-fidelity pins (red before the rebuild, green after).
 *
 * Usage: node --test test/core/validator-send-formdata-nesting.test.js
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var MAIN_SRC_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var DATA_SRC_PATH = path.join(FW, 'helpers/data/src/main.js');
var DIST_JS       = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_JS   = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var mainSrc = fs.readFileSync(MAIN_SRC_PATH, 'utf8');
var dataSrc = fs.readFileSync(DATA_SRC_PATH, 'utf8');

// the FormData handling block sits ~700 lines into send(); anchor on the data-block
// head so the pins reach the not-FormData escape hatch, the File branch, and the
// nesting branch (send()'s long head is irrelevant here).
var dataBlockSlice = (function () {
    var start = mainSrc.indexOf('var hasBinaries = false;');
    assert.ok(start > -1, 'send() data-block anchor not found');
    return mainSrc.substring(start, start + 6000);
})();

// the FormData entries loop, comment-stripped, for the value-verbatim negative pin.
// The block's only `formatData`/`decodeURIComponent` mentions are in comments (the
// nesting comment names `formatDataFromString`; the #FORMCT comment names
// `decodeURIComponent`), so stripping `//` comments avoids the own-comment
// false-positive per jsdoc.md.
var loopBodyStripped = (function () {
    var s = mainSrc.indexOf('for (var [key, value] of data.entries()');
    var e = mainSrc.indexOf('if (hasBinaries && binaries.length > 0)', s);
    assert.ok(s > -1 && e > s, 'FormData loop body not isolatable');
    return mainSrc.substring(s, e).replace(/\/\/[^\n]*/g, '');
})();

// ---------------------------------------------------------------------------
// real-bytes extraction: eval the ACTUAL ported helper + the ACTUAL source it
// ports, so the parity assertions run the shipped code, not a hand replica.
// Direct eval in sloppy mode hoists the `var <name>` into the IIFE scope, so the
// self-recursive reference inside each function body resolves.
// ---------------------------------------------------------------------------
function extractFn(src, name) {
    return (function () {
        var __fn;
        eval(src + '\n__fn = ' + name + ';');   // eslint-disable-line no-eval
        return __fn;
    })();
}

var nestSrc = (function () {
    var start = mainSrc.indexOf('var nestBracketNotationKey = function');
    var end   = mainSrc.indexOf('/**\n     * send', start);
    assert.ok(start > -1 && end > start, 'nestBracketNotationKey source not isolatable');
    return mainSrc.substring(start, end);
})();
// the real def is preceded by a commented-out copy — anchor on the LAST occurrence
var parseLocalObjSrc = (function () {
    var start = dataSrc.lastIndexOf('var parseLocalObj = function');
    var end   = dataSrc.indexOf('} //EO DataHelper', start);
    assert.ok(start > -1 && end > start, 'parseLocalObj source not isolatable');
    return dataSrc.substring(start, end);
})();

var nestBracketNotationKey = extractFn(nestSrc, 'nestBracketNotationKey');
var parseLocalObj          = extractFn(parseLocalObjSrc, 'parseLocalObj');

// mirror the call-site key transform: `item[0][id]` -> ['item','0','id']
function splitKey(k) { return k.replace(/\]/g, '').split(/\[/g); }

// build a nested object from flat FormData-style [key, value] entries, exactly as
// the fixed non-File branch does (bracket keys nested, plain keys flat).
function nestEntries(entries) {
    var out = {};
    entries.forEach(function (e) {
        var key = e[0], value = e[1];
        if ( /^(.*)\[(.*)\]/.test(key) ) {
            out = nestBracketNotationKey(out, splitKey(key), 0, value);
        } else {
            out[key] = value;
        }
    });
    return out;
}

describe('#B92 send(FormData) nesting — source pins', function () {

    it('01 - the ported helper is defined near send()', function () {
        assert.match(mainSrc, /var nestBracketNotationKey = function\(obj, key, k, value\)/,
            'nestBracketNotationKey helper is missing');
    });

    it('02 - the FormData non-File branch nests bracket keys through the helper', function () {
        // reassigns newData (parseObject-faithful: a numeric head segment can replace the accumulator)
        assert.match(dataBlockSlice,
            /newData = nestBracketNotationKey\(newData, key\.replace\(\/\\\]\/g, ''\)\.split\(\/\\\[\/g\), 0, value\)/,
            'the nesting call-site is missing or reshaped');
    });

    it('03 - the bracket-notation test gates the nesting (plain keys stay flat)', function () {
        var branchIdx = dataBlockSlice.indexOf('} else if ( /^(.*)\\[(.*)\\]/.test(key) ) {');
        var flatIdx   = dataBlockSlice.indexOf('newData[key] = value');
        assert.ok(branchIdx > -1, 'the bracket-test else-if branch is missing');
        assert.ok(flatIdx > branchIdx, 'the flat fallback must remain AFTER the bracket branch');
    });

    it('04 - File routing is untouched and precedes the nesting branch', function () {
        var fileIdx = dataBlockSlice.indexOf('if (value instanceof File)');
        var nestIdx = dataBlockSlice.indexOf('nestBracketNotationKey(newData');
        assert.ok(fileIdx > -1, 'the File branch is missing');
        assert.ok(nestIdx > fileIdx, 'the nesting branch must sit in the non-File else, after the File check');
        // still builds the binaries[] multipart record
        assert.match(dataBlockSlice, /binaries\[b\] = \{/, 'File binaries record is missing');
    });

    it('05 - values are VERBATIM on this path (no decode / coerce / formatData)', function () {
        // the declarative path uses formatData/formatDataFromString + decodeURIComponent;
        // the send(FormData) nesting path must NOT — it only shapes keys. Checked against
        // the comment-stripped loop body so the region's own comment mentions don't trip it.
        assert.ok(loopBodyStripped.indexOf('formatData') < 0,
            'send() FormData path must not route values through formatData');
        assert.ok(loopBodyStripped.indexOf('decodeURIComponent') < 0,
            'send() FormData path must not url-decode values');
    });

    it('06 - the send(plainObject) verbatim escape hatch is preserved', function () {
        // a non-FormData object arg is still JSON.stringify'd verbatim (no nesting applied)
        var notFdIdx  = dataBlockSlice.indexOf('if ( !(data instanceof FormData) ) {');
        var strfyIdx  = dataBlockSlice.indexOf('data = JSON.stringify(data)', notFdIdx);
        assert.ok(notFdIdx > -1 && strfyIdx > notFdIdx && (strfyIdx - notFdIdx) < 120,
            'the not-FormData branch must still stringify the object verbatim');
    });
});

describe('#B92 send(FormData) nesting — the ported helper equals the source parseLocalObj', function () {

    // battery of key paths driven identically through the real ported helper and the
    // real source function it ports; deep-equal proves byte-faithfulness (holes and all).
    var paths = [
        [ ['item','0','id'],                 'x' ],
        [ ['item','1','id'],                 'y' ],
        [ ['item','0','nested','1','value'], 'z' ],
        [ ['a','b','c'],                     'p' ],
        [ ['top'],                           'q' ],
        [ ['n','0'],                         'r' ],
        [ ['n','1'],                         's' ]
    ];

    it('01 - single-entry parity across the battery', function () {
        paths.forEach(function (p) {
            var mine = nestBracketNotationKey({}, p[0].slice(), 0, p[1]);
            var src  = parseLocalObj({}, p[0].slice(), 0, p[1]);
            assert.deepEqual(mine, src, 'diverged on ' + JSON.stringify(p[0]));
        });
    });

    it('02 - accumulated-entry parity (mirrors the FormData loop)', function () {
        // accumulate every path into ONE object, both ways, and compare
        var mine = {}, src = {};
        paths.forEach(function (p) {
            mine = nestBracketNotationKey(mine, p[0].slice(), 0, p[1]);
            src  = parseLocalObj(src, p[0].slice(), 0, p[1]);
        });
        assert.deepEqual(mine, src, 'accumulated shapes diverged');
    });
});

describe('#B92 send(FormData) nesting — canonical shapes + subtract', function () {

    it('01 - the ledger fixture nests into a dense array', function () {
        var out = nestEntries([
            ['item[0][id]', 'x'],
            ['item[1][id]', 'y'],
            ['plain',       'z']
        ]);
        assert.deepEqual(out, { item: [ { id: 'x' }, { id: 'y' } ], plain: 'z' });
    });

    it('02 - deep mixed path nests through arrays and objects', function () {
        var out = nestEntries([
            ['item[0][id]',                 'x'],
            ['item[0][nested][1][value]',   'z'],
            ['plain',                       'p']
        ]);
        // item[0] carries id + a sparse nested array whose live index 1 holds {value:'z'}
        assert.equal(out.item[0].id, 'x');
        assert.deepEqual(out.item[0].nested[1], { value: 'z' });
        assert.equal(out.plain, 'p');
    });

    it('03 - a plain (non-bracket) key stays flat', function () {
        assert.deepEqual(nestEntries([['email', 'a+b@x.io']]), { email: 'a+b@x.io' });
    });

    it('04 - values are placed verbatim (no + -> space, no boolean/null coercion)', function () {
        var out = nestEntries([
            ['flags[0]', 'true'],
            ['flags[1]', 'false'],
            ['q',        '50%20off'],
            ['n',        'null']
        ]);
        // unlike the declarative formatDataFromString path, NOTHING is decoded/coerced
        assert.deepEqual(out.flags, ['true', 'false']);
        assert.equal(out.q, '50%20off');
        assert.equal(out.n, 'null');
    });

    it('05 - SUBTRACT: the pre-fix flat copy kept literal bracket keys (the #B92 defect)', function () {
        // model the OLD non-File branch: newData[key] = value for every entry
        var preFix = {};
        [['item[0][id]', 'x'], ['item[1][id]', 'y'], ['plain', 'z']].forEach(function (e) {
            preFix[e[0]] = e[1];
        });
        var wire = JSON.parse(JSON.stringify(preFix));
        // the defect the server saw: literal bracket key present, `item` absent
        assert.equal(wire['item[0][id]'], 'x');
        assert.equal(typeof wire.item, 'undefined');
    });
});

describe('#B92 send(FormData) nesting — built bundles carry the fix (dist pins)', function () {

    var distJs  = fs.readFileSync(DIST_JS, 'utf8');
    var distMin = fs.readFileSync(DIST_MIN_JS, 'utf8');

    it('01 - the unminified dist carries the ported helper by name', function () {
        // gina.js carries validator src verbatim (comments + local names); the helper
        // name survives, so its presence proves the rebuilt artifact has the fix.
        assert.ok(distJs.indexOf('nestBracketNotationKey') > -1,
            'gina.js does not carry nestBracketNotationKey — rebuild the dist');
    });

    it('02 - the unminified dist carries the #B92 nesting call-site', function () {
        assert.ok(distJs.indexOf('nestBracketNotationKey(newData') > -1,
            'gina.js does not carry the nesting call-site — rebuild the dist');
    });

    it('03 - the minified dist gained the fix\'s bracket-split nesting idiom', function () {
        // `nestBracketNotationKey`/`newData` are `var` locals -> Closure renames them,
        // so pin a minify-surviving token: the `.replace(/\]/g,'').split(/\[/g)` bracket
        // splitter (regex literals survive minification). It already appeared TWICE in
        // the baseline (helpers/data `parseObject` + `parseBody`); the fix's call-site is
        // the THIRD — so a count of >= 3 is red on the pre-rebuild artifact, green after.
        var m = distMin.match(/\.replace\(\/\\\]\/g,\s*(?:''|"")\)\.split\(\/\\\[\/g\)/g) || [];
        assert.ok(m.length >= 3,
            'minified dist has ' + m.length + ' bracket-split idioms; expected >= 3 after the rebuild');
    });
});
