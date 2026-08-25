/**
 * #B344 — the `page.environment.forms` whisper excludes the `mocks` group.
 *
 * `setOptions` (core/controller/controller.js) whispers the bundle forms
 * catalog RFC5987-encoded into every page as `page.environment.forms`
 * (consumed by the client loader into `gina.forms`). The catalog's `mocks`
 * group (dev fixture data walked from `<bundle>/forms/mocks/`) has zero
 * client-side consumers — the client bundle reads `gina.forms.rules` (the
 * validator live-check gate) and `gina.forms.validators` (user-defined
 * validators) only — so the whispered export excludes `mocks` in EVERY env:
 * a uniform client contract (no dev/prod shape divergence) plus page weight.
 *
 * The fix builds a SHALLOW COPY minus `mocks` and feeds ONLY the stringify:
 * `forms` / `local.options.conf.forms` / `page.forms` keep the original full
 * catalog reference (server-side validation, templates and the Inspector
 * catalog card all keep the complete object), and the shared per-process
 * catalog object is NEVER mutated.
 *
 * Suites:
 *   01 — source pins on the shipped block (count-guarded anchors).
 *   02 — extract-and-execute of the real span through a capturing `set`
 *        stub + the REAL `encodeRFC5987ValueChars` global (installed by
 *        requiring `helpers`, exactly as gna.js does at boot), plus an
 *        inline PRE-FIX control arm proving this harness DOES surface
 *        mocks when the code ships them (a control that can fire).
 */

var path   = require('path');
var fs     = require('fs');
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core', 'controller', 'controller.js');

// Installs the `encodeRFC5987ValueChars` global exactly as gna.js does at boot.
require(path.join(FW, 'helpers'));

var src = fs.readFileSync(SOURCE, 'utf8');

// Span anchors — both lines are byte-stable across the fix (the fix inserts
// between them). Uniqueness is asserted in §01.
var START_ANCHOR = "var forms = local.options.conf.forms = options.conf.content.forms";
var END_ANCHOR   = "set('page.forms', options.conf.content.forms);";

function extractSpan(text) {
    var s = text.indexOf(START_ANCHOR);
    var e = text.indexOf(END_ANCHOR);
    assert.ok(s > -1, 'start anchor not found in source');
    assert.ok(e > -1, 'end anchor not found in source');
    assert.ok(e > s, 'end anchor precedes start anchor');
    return text.slice(s, e + END_ANCHOR.length);
}

// Executes a span with harness-provided outer identifiers. Every non-global
// identifier the span references (`local`, `options`, `set`) is a PARAMETER —
// nothing relies on closure capture, so the global-scope compile of
// `new Function` is correct here; `encodeRFC5987ValueChars` is a real global.
function runSpan(spanText, catalog) {
    var captured = {};
    var set = function (key, value) { captured[key] = value; };
    var local   = { options: { conf: {} } };
    var options = { conf: { content: { forms: catalog } } };
    var fn = new Function('local', 'options', 'set', spanText);
    fn(local, options, set);
    return { captured: captured, local: local, options: options };
}

function makeCatalog() {
    return {
        rules: {
            myform: { email: { isRequired: true, isEmail: true } }
        },
        mocks: {
            myform: { email: 'sample@fixture.test' }
        },
        validators: {
            myValidator: 'function (value) { return true; }'
        }
    };
}

describe('01 - source pins: the whisper excludes mocks via a shallow copy', function () {

    it('01.1 - both span anchors are unique in the file', function () {
        assert.equal(src.indexOf(START_ANCHOR), src.lastIndexOf(START_ANCHOR),
            'start anchor is not unique');
        assert.equal(src.indexOf(END_ANCHOR), src.lastIndexOf(END_ANCHOR),
            'end anchor is not unique');
    });

    it('01.2 - exactly ONE page.environment.forms whisper site exists file-wide', function () {
        var count = src.split("set('page.environment.forms'").length - 1;
        assert.equal(count, 1, 'expected exactly one whisper site, got ' + count);
    });

    it('01.3 - the whisper stringifies the copy, never the shared catalog', function () {
        var span = extractSpan(src);
        assert.ok(span.indexOf('JSON.stringify(_whisperedForms)') > -1,
            'whisper does not stringify _whisperedForms');
        assert.equal(span.indexOf('JSON.stringify(forms)'), -1,
            'whisper still stringifies the shared catalog reference');
    });

    it('01.4 - the copy block skips the mocks group and cites #B344', function () {
        var span = extractSpan(src);
        assert.ok(/['"]mocks['"]/.test(span), 'no mocks group handling in the span');
        assert.ok(span.indexOf('_whisperedForms') > -1
            && span.indexOf('_whisperedForms') !== span.lastIndexOf('_whisperedForms'),
            'expected the copy to be declared and consumed');
        assert.ok(span.indexOf('#B344') > -1, 'the block does not cite #B344');
    });

    it('01.5 - the page.forms export still hands over the ORIGINAL full catalog', function () {
        var span = extractSpan(src);
        assert.ok(span.indexOf(END_ANCHOR) > -1,
            'page.forms no longer exports options.conf.content.forms directly');
    });
});

describe('02 - behavior: extract-and-execute of the shipped span', function () {

    it('02.1 - the whispered export parses back WITHOUT mocks', function () {
        var out = runSpan(extractSpan(src), makeCatalog());
        var whispered = out.captured['page.environment.forms'];
        assert.ok(typeof whispered === 'string' && whispered.length > 0,
            'no whispered value captured');
        var parsed = JSON.parse(decodeURIComponent(whispered));
        assert.equal(typeof parsed.mocks, 'undefined',
            'mocks group leaked into the whispered export');
    });

    it('02.2 - rules and validators still ride the whisper intact', function () {
        var catalog = makeCatalog();
        var out = runSpan(extractSpan(src), catalog);
        var parsed = JSON.parse(decodeURIComponent(out.captured['page.environment.forms']));
        assert.deepEqual(parsed.rules, catalog.rules, 'rules were altered in transit');
        assert.deepEqual(parsed.validators, catalog.validators, 'validators were altered in transit');
    });

    it('02.3 - page.forms receives the ORIGINAL reference, mocks included', function () {
        var catalog = makeCatalog();
        var out = runSpan(extractSpan(src), catalog);
        assert.equal(out.captured['page.forms'], catalog,
            'page.forms no longer receives the original catalog reference');
        assert.ok(out.captured['page.forms'].mocks,
            'page.forms lost the mocks group');
    });

    it('02.4 - conf.forms keeps the original reference (the shared graft contract)', function () {
        var catalog = makeCatalog();
        var out = runSpan(extractSpan(src), catalog);
        assert.equal(out.local.options.conf.forms, catalog,
            'local.options.conf.forms is no longer the original reference');
    });

    it('02.5 - the shared catalog object is NEVER mutated', function () {
        var catalog = makeCatalog();
        var snapshot = JSON.stringify(catalog);
        runSpan(extractSpan(src), catalog);
        assert.ok(catalog.mocks, 'the catalog lost its mocks group');
        assert.equal(JSON.stringify(catalog), snapshot,
            'the shared catalog was mutated by the whisper path');
    });

    it('02.6 - a catalog with NO mocks group whispers byte-identical to a direct encode', function () {
        var catalog = { rules: { myform: { email: { isRequired: true } } } };
        var out = runSpan(extractSpan(src), catalog);
        assert.equal(out.captured['page.environment.forms'],
            encodeRFC5987ValueChars(JSON.stringify(catalog)),
            'no-mocks whisper diverged from the direct encode of the catalog');
    });

    it('02.7 - a missing catalog whispers an empty object instead of crashing', function () {
        var out = runSpan(extractSpan(src), undefined);
        var parsed = JSON.parse(decodeURIComponent(out.captured['page.environment.forms']));
        assert.deepEqual(parsed, {}, 'missing catalog did not whisper {}');
    });

    it('02.8 - CONTROL: the pre-fix shape whispers mocks through this same harness', function () {
        // The literal pre-#B344 span (whisper stringifies the shared reference
        // directly). Proves the harness CAN observe a mocks leak — so the empty
        // reads in 02.1 are a finding, not a blind instrument.
        var preFixSpan = ""
            + "var forms = local.options.conf.forms = options.conf.content.forms\n"
            + "set('page.environment.forms', encodeRFC5987ValueChars(JSON.stringify(forms)));\n"
            + "set('page.forms', options.conf.content.forms);";
        var catalog = makeCatalog();
        var captured = {};
        var set = function (key, value) { captured[key] = value; };
        var fn = new Function('local', 'options', 'set', preFixSpan);
        fn({ options: { conf: {} } }, { conf: { content: { forms: catalog } } }, set);
        var parsed = JSON.parse(decodeURIComponent(captured['page.environment.forms']));
        assert.ok(parsed.mocks, 'control failed to fire: pre-fix shape did not whisper mocks');
        assert.deepEqual(parsed.mocks, catalog.mocks);
    });
});
