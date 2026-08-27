'use strict';
/**
 * Validator live-check (`query` rule) Content-Type resolution — #FORMCT query path (#B425)
 *
 * Sibling of test/core/validator-formct-content-type.test.js, which pins the SAME
 * defect class on the two `send` sites in the plugin's main.js. This file pins the
 * third and last sender that carries a body: the `query` (live-check) request built
 * in core/plugins/lib/validator/src/form-validator.js.
 *
 * Bug being pinned (#B425): the live-check body is JSON (`JSON.stringify`), but the
 * request inherited `application/x-www-form-urlencoded` from the plugin's xhrOptions
 * defaults. The gina server, correctly honouring that label, runs
 * `body.replace(/\+/g, ' ')` + decodeURIComponent BEFORE JSON.parse — so a value such
 * as an email "+alias" arrives with the '+' turned into a space. The body is still
 * well-formed JSON, so it parses, the handler answers 200, and the live-check returns
 * the WRONG verdict. Because a `query` rule also gates the submit trigger, an affected
 * user cannot submit the form at all.
 *
 * The server half is NOT the defect: for a genuine urlencoded body '+' really does
 * mean space and '%2B' survives. The client's labelling is. The fix therefore mirrors
 * main.js's non-binary send path: honour an EXPLICIT rule-declared Content-Type, else
 * send application/json for a JSON body.
 *
 * Why the resolution needs a value captured BEFORE the merge: `lib/merge` is variadic
 * and earlier sources win, so the rule's own `options` already beat `xhrOptions` — but
 * once merged, a rule-declared 'urlencoded' and the inherited default are the same
 * string in the same slot. Provenance is unrecoverable after the merge, and an
 * explicit per-rule override must keep winning (consumers use it as a workaround).
 * §06 pins that merge behaviour, since the fix depends on it.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW    = require('../fw');
var FVSRC = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var merge = require(path.join(FW, 'lib/merge'));

var fvSrc;

before(function () {
    fvSrc = fs.readFileSync(FVSRC, 'utf8');
});


// ─── 01 — Source inspection: the query-path #FORMCT blocks are present ──────

describe('01 - source inspection: #FORMCT query-path blocks', function () {

    it('captures the rule-declared Content-Type BEFORE the merge', function () {
        // Anchored gap-free from the capture to the merge it must precede: if the
        // capture is ever moved below the merge, provenance is lost and an explicit
        // per-rule override stops winning.
        var re = /var ruleContentType = \( options && options\.headers \) \? options\.headers\['Content-Type'\] : null;[\s\S]{0,80}queryOptions = merge\(queryOptions, options, xhrOptions\);/;
        assert.ok(re.test(fvSrc),
            'expected ruleContentType to be captured immediately before the xhrOptions merge');
    });

    it('resolves explicit-rule-header-else-json for a JSON body', function () {
        // Gap-free over exactly what the §02-§05 replica mirrors.
        var re = /var enctype = queryOptions\.headers\['Content-Type'\];\s*if \(\s*\( !ruleContentType \|\| ruleContentType == '' \)\s*&& typeof\(queryData\) == 'string'\s*&& \/\^\[\\\[\{\]\/\.test\(queryData\.trim\(\)\)\s*\) \{\s*enctype = 'application\/json; charset=UTF-8';\s*\}/;
        assert.ok(re.test(fvSrc),
            'expected the query-path JSON Content-Type resolution to follow the enctype read');
    });

    it('the query path no longer sends a JSON body under the inherited default alone', function () {
        // Regression guard: the resolution must exist between the enctype read and the
        // header emit. Scoped to the block so the file's other Content-Type mentions
        // cannot satisfy it, and matched on the CODE literal (with charset) rather than
        // the bare token the surrounding comments also carry.
        var start = fvSrc.indexOf("var enctype = queryOptions.headers['Content-Type'];");
        var end   = fvSrc.indexOf("xhr.setRequestHeader('Content-Type', enctype);");
        assert.ok(start > -1 && end > start, 'expected the enctype read to precede the header emit');
        var block = fvSrc.slice(start, end);
        assert.ok(/'application\/json; charset=UTF-8'/.test(block),
            'the query path must offer an application/json Content-Type before emitting the header');
    });
});


// ─── helpers — mirror of the resolution snippet in form-validator.js ───────
//
// Kept in lock-step with the source by the 01 pins, which anchor gap-free over
// exactly this expression.
function resolveQueryContentType(queryData, ruleContentType, enctype) {
    if (
        ( !ruleContentType || ruleContentType == '' )
        && typeof(queryData) == 'string'
        && /^[\[{]/.test(queryData.trim())
    ) {
        return 'application/json; charset=UTF-8';
    }
    return enctype;
}

var URLENCODED = 'application/x-www-form-urlencoded; charset=UTF-8';
var JSON_CT    = 'application/json; charset=UTF-8';


// ─── 02 — JSON body, no rule-declared header -> application/json ───────────

describe('02 - JSON body, no rule header -> application/json', function () {

    it('object body uses application/json', function () {
        var body = JSON.stringify({ account: { username: 'alias+test@example.test' } });
        assert.equal(resolveQueryContentType(body, null, URLENCODED), JSON_CT);
    });

    it('array body uses application/json', function () {
        assert.equal(resolveQueryContentType(JSON.stringify([1, 2]), null, URLENCODED), JSON_CT);
    });

    it('leading whitespace before the JSON still resolves to application/json', function () {
        assert.equal(resolveQueryContentType('  {"a":1}', null, URLENCODED), JSON_CT);
    });

    it('an empty-string rule header is treated as absent', function () {
        assert.equal(resolveQueryContentType('{"a":1}', '', URLENCODED), JSON_CT);
    });

    it('an undefined rule header is treated as absent', function () {
        assert.equal(resolveQueryContentType('{"a":1}', undefined, URLENCODED), JSON_CT);
    });
});


// ─── 03 — an explicit rule-declared header wins ────────────────────────────

describe('03 - explicit rule-declared Content-Type wins over the JSON default', function () {

    it('an explicit urlencoded declaration is preserved (opt back in)', function () {
        assert.equal(resolveQueryContentType('{"a":1}', URLENCODED, URLENCODED), URLENCODED);
    });

    it('an explicit application/json declaration is preserved', function () {
        // The interim workaround consumers adopted must keep working unchanged.
        assert.equal(resolveQueryContentType('{"a":1}', JSON_CT, JSON_CT), JSON_CT);
    });

    it('a custom declaration is preserved', function () {
        assert.equal(resolveQueryContentType('{"a":1}', 'application/vnd.x+json', 'application/vnd.x+json'),
            'application/vnd.x+json');
    });
});


// ─── 04 — non-JSON bodies keep the resolved enctype ───────────────────────

describe('04 - non-JSON bodies fall back to the resolved enctype', function () {

    it('a plain (non-{/[) string keeps the resolved enctype', function () {
        assert.equal(resolveQueryContentType('a=1&b=2', null, URLENCODED), URLENCODED);
    });

    it('a stringified null keeps the resolved enctype', function () {
        // options.data absent -> JSON.stringify(null) === 'null'
        assert.equal(resolveQueryContentType('null', null, URLENCODED), URLENCODED);
    });

    it('a non-string body keeps the resolved enctype', function () {
        assert.equal(resolveQueryContentType({ a: 1 }, null, URLENCODED), URLENCODED);
    });
});


// ─── 05 — the corruption the JSON Content-Type prevents ───────────────────

describe('05 - the corruption the JSON Content-Type prevents', function () {

    it('a "+" alias email survives JSON.parse but is corrupted by the urlencoded decode', function () {
        var body = JSON.stringify({ account: { username: 'alias+test@example.test' } });

        // What the server does for an application/x-www-form-urlencoded body.
        var urlencodedPath = decodeURIComponent(body.replace(/\+/g, ' '));
        var corrupted = JSON.parse(urlencodedPath);
        assert.equal(corrupted.account.username, 'alias test@example.test',
            'the urlencoded path must corrupt the + into a space');
        // Still well-formed JSON — which is why nothing errors and the wrong verdict ships.
        assert.equal(typeof corrupted.account.username, 'string');

        // What the server does for an application/json body (#B28: parse verbatim).
        var intact = JSON.parse(body);
        assert.equal(intact.account.username, 'alias+test@example.test');

        // And the resolution routes this body to the intact path.
        assert.equal(resolveQueryContentType(body, null, URLENCODED), JSON_CT);
    });
});


// ─── 06 — the merge behaviour the fix depends on ──────────────────────────

describe('06 - lib/merge semantics the query-path resolution relies on', function () {

    it('is variadic: a third OBJECT argument merges as a source, not as an override flag', function () {
        var out = merge({ isSynchrone: false, headers: {} }, { url: '/check' }, {
            method: 'GET',
            headers: { 'Content-Type': URLENCODED, 'X-Requested-With': 'XMLHttpRequest' }
        });
        assert.equal(out.headers['Content-Type'], URLENCODED,
            'the xhrOptions default must reach queryOptions — this is why the defect existed');
        assert.equal(out.headers['X-Requested-With'], 'XMLHttpRequest');
        assert.equal(out.method, 'GET');
    });

    it('earlier sources win over later ones, which is why a per-rule header overrides the default', function () {
        var out = merge({ isSynchrone: false, headers: {} },
            { method: 'POST', headers: { 'Content-Type': JSON_CT } },
            { method: 'GET',  headers: { 'Content-Type': URLENCODED, 'X-Requested-With': 'XMLHttpRequest' } });
        assert.equal(out.method, 'POST', 'the rule value must beat the default');
        assert.equal(out.headers['Content-Type'], JSON_CT);
        assert.equal(out.headers['X-Requested-With'], 'XMLHttpRequest',
            'later sources still fill gaps');
    });

    it('a trailing BOOLEAN is still read as the override flag (control)', function () {
        assert.deepEqual(merge({ a: 'keep' }, { a: 'new' }, true),  { a: 'new' });
        assert.deepEqual(merge({ a: 'keep' }, { a: 'new' }),        { a: 'keep' });
    });
});
