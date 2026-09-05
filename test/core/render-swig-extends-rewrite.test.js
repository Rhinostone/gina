/**
 * #B482 / #B484 — the {% extends %} layout-cache re-point must target the
 * DIRECTIVE, and the directive must be extracted correctly in the first place.
 *
 * Two defects, one rewrite, same symptom family (the page silently extends the
 * raw, un-assembled layout instead of the assembled cache copy):
 *
 *   #B482 — the re-point was a bare string search over the whole template, so
 *           the FIRST occurrence of the layout filename anywhere won. A child
 *           whose leading comment names its layout had the COMMENT rewritten
 *           while the directive kept the raw path.
 *   #B484 — the two extraction quantifiers were greedy, so a one-line directive
 *           followed by another quoted tag produced a corrupted layout path that
 *           matched nothing, and no re-point happened at all.
 *
 * Sections:
 *   01 — source pins on the three changed expressions, each anchored over the
 *        WHOLE expression so a later right-extension breaks them, plus negative
 *        pins that the superseded forms are gone.
 *   02 — behavioural arms driving the SHIPPED bytes: the two regex literals are
 *        extracted from the source and the helper region is compiled from it
 *        under `new Function`. Seven templates: the two defects and five shapes
 *        that must keep working.
 *   03 — the real swig engine over temp files: a comment-before-directive child
 *        renders the CACHED layout after the re-point, and the superseded
 *        rewrite reproduces the defect (it renders the RAW layout).
 *
 * Red-first: run with GINA_RENDER_SWIG_SRC pointed at a pre-fix blob
 * (`git show HEAD:framework/v<ver>/core/controller/controller.render-swig.js`).
 * Every 01 pin and every 02 arm must go red there — the 02 arms through their
 * banner/extraction controls, which fail loudly rather than passing vacuously
 * on an empty extraction. The 03 defect-reproduction arm is deliberately
 * source-independent and stays green on both revisions.
 */

var assert = require('assert');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { describe, it, before, after } = require('node:test');

var FW     = require('../fw');
var SOURCE = process.env.GINA_RENDER_SWIG_SRC
            || path.join(FW, 'core/controller/controller.render-swig.js');

var SRC = fs.readFileSync(SOURCE, 'utf8');

var LAZY_OUTER  = "var extendFound = _templateContent.match(/\\{\\%(\\s+extends|extends)(.*?)\\%}/);";
var LAZY_QUOTED = "layoutPath = extendFound[0].match(/(\\\"|\\')(.*?)(\\\"|\\')/)[0].replace(/(\\\"|\\')/g, '');";
var CALL_FORM   = "_templateContent = spliceExtendsTarget(_templateContent, extendFound, layoutPath, ";
var BANNER      = '// ---- #B482/#B484 - module-scope helper for the extends layout-cache re-point ----';


// ── 01 — source pins ────────────────────────────────────────────────────────

describe('01 - #B482/#B484 source pins', function() {

    it('the directive match uses a lazy quantifier (whole expression anchored)', function() {
        assert.ok(SRC.indexOf(LAZY_OUTER) > -1,
            'expected the directive match to be the lazy form, verbatim');
    });

    it('the superseded greedy directive match is GONE', function() {
        assert.strictEqual(SRC.indexOf('(\\s+extends|extends)(.*)\\%}'), -1,
            'the greedy directive quantifier must not survive anywhere in the file');
    });

    it('the quoted-path extraction uses a lazy quantifier (whole expression anchored)', function() {
        assert.ok(SRC.indexOf(LAZY_QUOTED) > -1,
            'expected the quoted-path extraction to be the lazy form, verbatim');
    });

    it('the extraction still reads extendFound[0] (render-swig-fragment-parent.test.js:85 anchors on it)', function() {
        assert.ok(SRC.indexOf('extendFound[0].match') > -1,
            'the #SPA1 ordering pin anchors on this literal — it must survive');
    });

    it('the re-point goes through the splice helper, exactly once (assignment form, not the declaration or the @example)', function() {
        var n = SRC.split(CALL_FORM).length - 1;
        assert.strictEqual(n, 1, 'expected exactly one spliced re-point call site, found ' + n);
    });

    it('the superseded whole-template string re-point is GONE', function() {
        assert.strictEqual(SRC.indexOf('_templateContent.replace(layoutPath'), -1,
            'the bare whole-template re-point must not survive');
    });

    it('the helper is a module-scope function with the params-only signature', function() {
        assert.ok(SRC.indexOf('function spliceExtendsTarget(templateContent, extendFound, layoutPath, target) {') > -1,
            'expected the params-only helper declaration');
    });

    it('the helper uses a FUNCTION replacer, so a dollar-pattern in the path cannot expand', function() {
        assert.ok(SRC.indexOf('extendFound[0].replace(layoutPath, function () { return target; })') > -1,
            'expected a function replacer, not a string replacement');
    });
});


// ── 02 — behavioural arms over the SHIPPED bytes ────────────────────────────

describe('02 - #B482/#B484 behaviour, driven from the extracted source', function() {

    var TARGET = '/cache/bundle/swig/layout.html';

    // Compile the helper region from the source. On a pre-fix blob the banner is
    // absent and this fails loudly — the arms must never pass on an empty region.
    function loadHelper() {
        var at = SRC.indexOf(BANNER);
        assert.ok(at > -1, 'the #B482/#B484 helper region banner must be present');
        return new Function(SRC.slice(at) + '\nreturn { spliceExtendsTarget: spliceExtendsTarget };')();
    }

    // Lift the two regex literals out of the source and compile them.
    function loadRegexes() {
        var outer  = SRC.match(/var extendFound = _templateContent\.match\((\/.*\/)\);/);
        var quoted = SRC.match(/layoutPath = extendFound\[0\]\.match\((\/.*\/)\)\[0\]\.replace/);
        assert.ok(outer,  'could not lift the directive regex literal from the source');
        assert.ok(quoted, 'could not lift the quoted-path regex literal from the source');
        var out = new Function('return { outer: ' + outer[1] + ', quoted: ' + quoted[1] + ' };')();
        // Fixture validation: a lifted literal that does not behave like the real
        // one would make every arm below meaningless.
        assert.ok(out.outer instanceof RegExp && out.quoted instanceof RegExp, 'lifted literals must be RegExp');
        assert.ok(out.outer.test("{% extends 'a.html' %}"), 'the lifted directive regex must match a plain directive');
        return out;
    }

    // The shipped pipeline: lifted regexes + the compiled helper.
    function rewrite(tpl) {
        var re  = loadRegexes();
        var h   = loadHelper();
        var extendFound = tpl.match(re.outer);
        if (!extendFound) { return { matched: false }; }
        var layoutPath  = extendFound[0].match(re.quoted)[0].replace(/("|')/g, '');
        return {
            matched: true,
            layoutPath: layoutPath,
            content: h.spliceExtendsTarget(tpl, extendFound, layoutPath, TARGET)
        };
    }

    function directiveTargetOf(content) {
        var m = content.match(/\{\%\s*extends\s*["']([^"']*)["']/);
        return m ? m[1] : null;
    }

    it('#B482 — a leading comment naming the layout does NOT steal the rewrite', function() {
        var tpl = "{# layout.html must expose a content block #}\n"
                + "{% extends 'layout.html' %}\n{% block content %}x{% endblock %}";
        var r = rewrite(tpl);
        assert.strictEqual(r.layoutPath, 'layout.html');
        assert.strictEqual(directiveTargetOf(r.content), TARGET, 'the DIRECTIVE must carry the cache target');
        assert.ok(r.content.indexOf('{# layout.html must expose a content block #}') > -1,
            'the comment must be left exactly as the author wrote it');
    });

    it('#B484 — a one-line directive followed by another quoted tag extracts a clean path and is re-pointed', function() {
        var tpl = "{% extends 'layout.html' %}{% block t %}{{ a|default('z') }}{% endblock %}";
        var r = rewrite(tpl);
        assert.strictEqual(r.layoutPath, 'layout.html', 'the extraction must stop at the directive');
        assert.strictEqual(directiveTargetOf(r.content), TARGET);
        assert.ok(r.content.indexOf("{{ a|default('z') }}") > -1, 'the trailing tag must be untouched');
    });

    it('CONTROL - the healthy shape (directive first) still re-points', function() {
        var r = rewrite("{% extends 'layout.html' %}\n{% block content %}x{% endblock %}");
        assert.strictEqual(directiveTargetOf(r.content), TARGET);
    });

    it('CONTROL - double-quoted path', function() {
        var r = rewrite('{% extends "layout.html" %}\n{% block content %}x{% endblock %}');
        assert.strictEqual(r.layoutPath, 'layout.html');
        assert.strictEqual(directiveTargetOf(r.content), TARGET);
    });

    it('CONTROL - subfolder path', function() {
        var r = rewrite("{% extends 'layouts/main.html' %}\n{% block content %}x{% endblock %}");
        assert.strictEqual(r.layoutPath, 'layouts/main.html');
        assert.strictEqual(directiveTargetOf(r.content), TARGET);
    });

    it('CONTROL - extra whitespace inside the directive', function() {
        var r = rewrite("{%  extends   'layout.html'  %}\n{% block content %}x{% endblock %}");
        assert.strictEqual(r.layoutPath, 'layout.html');
        assert.strictEqual(directiveTargetOf(r.content), TARGET);
    });

    it('CONTROL - a later legitimate mention of the same filename survives untouched', function() {
        var tpl = "{% extends 'layout.html' %}\n{% block content %}see layout.html for the blocks{% endblock %}";
        var r = rewrite(tpl);
        assert.strictEqual(directiveTargetOf(r.content), TARGET);
        assert.ok(r.content.indexOf('see layout.html for the blocks') > -1,
            'only the directive may be rewritten');
    });

    it('a dollar-pattern in the target is inserted literally (function replacer)', function() {
        var h = loadHelper();
        var re = loadRegexes();
        var tpl = "{% extends 'layout.html' %}\n";
        var extendFound = tpl.match(re.outer);
        var out = h.spliceExtendsTarget(tpl, extendFound, 'layout.html', "/cache/$&x/layout.html");
        assert.ok(out.indexOf("/cache/$&x/layout.html") > -1,
            'a string replacement would have expanded the dollar-pattern here');
    });
});


// ── 03 — real swig engine ─────────────────────────────────────

describe('03 - real swig: the re-pointed directive compiles against the CACHED layout', function() {

    var swig   = require('@rhinostone/swig');
    var engine = new swig.Swig({ cache: false });
    var tmpDir = null;

    // Production extracts the BARE path out of the directive and rewrites with
    // that, so the fixture uses relative names and lets swig's own loader
    // resolve them from the child's dirname — this is what makes the leading
    // comment collide with the rewrite target, which is the whole defect.
    var RAW    = 'layout.html';
    var CACHED = 'assembled.html';

    before(function() {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b482-'));
        fs.writeFileSync(path.join(tmpDir, RAW),
            '<html><body>RAW{% block content %}{% endblock %}</body></html>');
        fs.writeFileSync(path.join(tmpDir, CACHED),
            '<html><body>CACHED{% block content %}{% endblock %}<!--shell--></body></html>');
    });

    after(function() {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    function child() {
        // The #B482 shape: the layout filename appears in a comment FIRST.
        return "{# " + RAW + " must expose a content block #}\n"
             + "{% extends '" + RAW + "' %}\n"
             + "{% block content %}<h1>HELLO</h1>{% endblock %}";
    }

    function compileIn(sourceText, name) {
        var abs = path.join(tmpDir, name);
        fs.writeFileSync(abs, sourceText);
        return engine.compile(sourceText, { filename: abs })({});
    }

    it('the shipped rewrite sends the child to the CACHED layout', function() {
        var at = SRC.indexOf(BANNER);
        assert.ok(at > -1, 'the #B482/#B484 helper region banner must be present');
        var h  = new Function(SRC.slice(at) + '\nreturn { spliceExtendsTarget: spliceExtendsTarget };')();
        var outerM = SRC.match(/var extendFound = _templateContent\.match\((\/.*\/)\);/);
        assert.ok(outerM, 'could not lift the directive regex literal');
        var outer  = new Function('return ' + outerM[1] + ';')();

        var src = child();
        var extendFound = src.match(outer);
        assert.ok(extendFound, 'the fixture must contain a matchable directive');
        var out = compileIn(h.spliceExtendsTarget(src, extendFound, RAW, CACHED), 'child-fixed.html');

        assert.ok(out.indexOf('CACHED') > -1, 'must extend the assembled cache copy: ' + out);
        assert.ok(out.indexOf('<h1>HELLO</h1>') > -1, 'the child block must render');
        assert.strictEqual(out.indexOf('RAW'), -1, 'must NOT extend the raw layout');
    });

    it('CONTROL (source-independent) - the superseded bare rewrite reproduces the defect', function() {
        // Exactly what the file used to do: a bare whole-template string replace,
        // which the leading comment absorbs.
        var out = compileIn(child().replace(RAW, CACHED), 'child-prefix.html');
        assert.ok(out.indexOf('RAW') > -1,
            'the superseded rewrite must still extend the RAW layout — this is the measured defect');
        assert.strictEqual(out.indexOf('CACHED'), -1,
            'and it must NOT have reached the assembled copy');
    });
});
