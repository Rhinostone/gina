/**
 * #SPA1 — fragment-parent fix for layoutless renders of {% extends %} templates.
 *
 * A negotiated (layoutless) render of an {% extends %} template used to arrive
 * content-EMPTY: render-swig re-points the child's extends at the shared
 * cached-layout file, and the pre-compile persist wrote THIS render's assembled
 * `layout` — for a fragment, the (empty) nolayout shell — over that shared
 * file, so the child's blocks extended a block-less parent and were discarded
 * (and any full-page render compiling in that window inherited the blanked
 * parent). The fix, in `controller.render-swig.js`:
 *
 *   (1) fragment renders target a separate `fragments/` cache namespace, so
 *       the full-page cached layout is never touched by a fragment render;
 *   (2) the fragments/ parent is primed from the child's OWN block roster
 *       (declaration order, deduped) instead of the original layout file;
 *   (3) the post-asset persist composes `roster + '\n' + layout` for
 *       fragments, keeping the xhr-inputs/scripts shell tail in the response;
 *   (4) the swig compiled-template cacheKey carries a `:fragment` shape
 *       suffix (first-shape-wins collision between the two shapes otherwise).
 *
 * Sections:
 *   01 — source pins on (1)-(4), whole-expression anchored.
 *        Red-first: run with GINA_SPA_FRAGMENT_PRE_SRC=<path to a pre-fix
 *        controller.render-swig.js blob> — every 01/02 test must fail there
 *        while the 03 engine-semantics controls keep passing.
 *   02 — the roster derivation executed from the SHIPPED bytes (extraction,
 *        no replica) over synthetic child templates.
 *   03 — the REAL swig engine over temp files: a roster parent renders the
 *        child's blocks with the shell tail composed after them; an EMPTY
 *        parent (the pre-fix poisoned state) reproduces the discard — the
 *        control proving the roster is load-bearing.
 */

var assert = require('assert');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { describe, it, before, after } = require('node:test');

var FW     = require('../fw');
var SOURCE = process.env.GINA_SPA_FRAGMENT_PRE_SRC
            || path.join(FW, 'core/controller/controller.render-swig.js');

var SRC = fs.readFileSync(SOURCE, 'utf8');


// ── 01 — source pins ────────────────────────────────────────────────────────

describe('01 - #SPA1 fragment-parent source pins', function() {

    it('cacheKey carries the :fragment shape suffix (whole expression anchored)', function() {
        assert.ok(
            /cacheKey\s*=\s*'swig:'\s*\+\s*localOptions\.bundle\s*\+\s*subFolder\s*\+\s*'\/'\s*\+\s*data\.page\.view\.file\s*\+\s*\(\s*\(isWithoutLayout\)\s*\?\s*':fragment'\s*:\s*''\s*\);/.test(SRC),
            'expected the swig compiled-template cacheKey to end with the isWithoutLayout ? ":fragment" : "" shape suffix'
        );
    });

    it('newLayoutPath branches into the fragments/ namespace for layoutless renders', function() {
        assert.ok(
            /var newLayoutPath\s*=\s*'swig'\s*\+\s*subFolder\s*\+\s*\(\s*\(isWithoutLayout\)\s*\?\s*'\/fragments\/'\s*:\s*'\/'\s*\)\s*\+\s*layoutPath;/.test(SRC),
            'expected newLayoutPath to branch fragments into their own cache namespace'
        );
    });

    it('the prime write assigns the roster for fragments, BEFORE the full-page layout read (which survives)', function() {
        var fragIdx = SRC.indexOf('buffer = fragmentBlockRoster;');
        var readIdx = SRC.indexOf("buffer = await fs.promises.readFile(localOptions.template.html + '/'+ layoutPath);");
        assert.ok(fragIdx > -1, 'expected the fragment prime `buffer = fragmentBlockRoster;`');
        assert.ok(readIdx > -1, 'the full-page prime read of the original layout must survive');
        assert.ok(fragIdx < readIdx, 'the fragment branch must be tested first (if/else ordering)');
    });

    it('the post-asset persist composes roster + newline + layout for fragments', function() {
        assert.ok(
            /var _persistedLayout\s*=\s*\(\s*isWithoutLayout\s*&&\s*fragmentBlockRoster\s*!==\s*null\s*\)\s*\?\s*fragmentBlockRoster\s*\+\s*'\\n'\s*\+\s*layout\s*:\s*layout;/.test(SRC),
            'expected `_persistedLayout = ( isWithoutLayout && fragmentBlockRoster !== null ) ? fragmentBlockRoster + "\\n" + layout : layout;`'
        );
        assert.ok(
            /await\s+fs\.promises\.writeFile\(\s*_layoutTmpAssets\s*,\s*_persistedLayout\s*\)/.test(SRC),
            'the atomic post-asset write must persist the composed variable'
        );
    });

    it('the roster derivation sits between the extends extraction and the namespace branch', function() {
        var extendsIdx = SRC.indexOf('extendFound[0].match');
        var deriveIdx  = SRC.indexOf('var _fragBlockRe');
        var branchIdx  = SRC.indexOf('var newLayoutPath');
        assert.ok(extendsIdx > -1, 'extends extraction anchor not found');
        assert.ok(deriveIdx > -1, 'roster derivation not found');
        assert.ok(branchIdx > -1, 'namespace branch not found');
        assert.ok(extendsIdx < deriveIdx && deriveIdx < branchIdx,
            'expected extends extraction -> roster derivation -> fragments/ namespace branch, in order');
    });

    it('the fragment gate appears at exactly the two composition sites (prime + persist)', function() {
        var matches = SRC.match(/isWithoutLayout && fragmentBlockRoster !== null/g);
        assert.ok(matches && matches.length === 2,
            'expected exactly 2 `isWithoutLayout && fragmentBlockRoster !== null` gates (prime + persist), found ' + (matches ? matches.length : 0));
    });

});


// ── 02 — the roster derivation, executed from the shipped bytes ─────────────

var START_TOK = 'var _fragBlockRe';
var END_TOK   = '_fragBlockRe = null; _fragBlockNames = null; _fragMatch = null; _fragLines = null;';

function extractDerivation() {
    var i = SRC.indexOf(START_TOK);
    var j = SRC.indexOf(END_TOK);
    if (i < 0 || j < 0 || j < i) return null;
    return SRC.substring(i, j + END_TOK.length);
}

function makeDerive() {
    var body = extractDerivation();
    if (body === null) return null;
    /* jshint evil:true */
    return new Function('_templateContent',
        'var fragmentBlockRoster = null;\n' + body + '\nreturn fragmentBlockRoster;');
}

describe('02 - roster derivation (extracted shipped bytes, no replica)', function() {

    it('extraction control: both anchors appear exactly once, ordered', function() {
        var i = SRC.indexOf(START_TOK);
        var j = SRC.indexOf(END_TOK);
        assert.ok(i > -1, 'derivation start anchor not found');
        assert.ok(j > -1, 'derivation end anchor not found');
        assert.ok(i < j, 'anchors out of order');
        assert.equal(SRC.indexOf(START_TOK, i + 1), -1, 'start anchor must be unique');
        assert.equal(SRC.indexOf(END_TOK, j + 1), -1, 'end anchor must be unique');
    });

    it('single block: one empty placeholder line', function() {
        var derive = makeDerive();
        assert.ok(derive, 'derivation not extractable');
        var out = derive("{% extends 'layouts/main.html' %}\n{% block content %}<h1>x</h1>{% endblock %}");
        assert.equal(out, '{% block content %}{% endblock %}');
    });

    it('multiple blocks: declaration order preserved', function() {
        var derive = makeDerive();
        var out = derive("{% extends 'l.html' %}{% block title %}t{% endblock %}{% block content %}c{% endblock %}{% block aside %}a{% endblock %}");
        assert.equal(out,
            '{% block title %}{% endblock %}\n{% block content %}{% endblock %}\n{% block aside %}{% endblock %}');
    });

    it('duplicate block names are deduped', function() {
        var derive = makeDerive();
        var out = derive("{% block content %}a{% endblock %}{% block content %}b{% endblock %}");
        assert.equal(out, '{% block content %}{% endblock %}');
    });

    it('whitespace-control form ({%- block x %}) is matched', function() {
        var derive = makeDerive();
        var out = derive("{%- block content %}x{%- endblock %}");
        assert.equal(out, '{% block content %}{% endblock %}');
    });

    it('endblock tags never produce roster entries; a block-less child yields an empty roster', function() {
        var derive = makeDerive();
        var one = derive("{% block content %}x{% endblock %}{% endblock %}");
        assert.equal(one, '{% block content %}{% endblock %}', 'endblock leaked into the roster');
        var none = derive("{% extends 'l.html' %}\n<p>no blocks at all</p>");
        assert.equal(none, '', 'a block-less child must derive an empty roster');
    });

    it('hyphen and underscore block names are matched whole', function() {
        var derive = makeDerive();
        var out = derive("{% block main-nav_2 %}x{% endblock %}");
        assert.equal(out, '{% block main-nav_2 %}{% endblock %}');
    });

});


// ── 03 — the REAL swig engine over temp files ───────────────────────────────

describe('03 - real swig: roster parent renders child blocks, empty parent discards them', function() {

    var swig   = require('@rhinostone/swig');
    var engine = new swig.Swig({ cache: false });
    var tmpDir = null;

    var TAIL = '<input type="hidden" id="frag-tail">';

    before(function() {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-frag-parent-'));
    });

    after(function() {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    function childSrc(parentAbs, blocks) {
        return "{% extends '" + parentAbs + "' %}\n" + blocks;
    }

    it('roster parent + shell tail: child blocks render, tail composes AFTER them', function() {
        var derive = makeDerive();
        assert.ok(derive, 'derivation not extractable');
        var blocks = "{% block content %}<h1>{{ msg }}</h1>{% endblock %}";
        var roster = derive(blocks);
        // The exact composition the :SPA1 persist writes: roster + '\n' + layout
        var parentAbs = path.join(tmpDir, 'parent-roster.html');
        fs.writeFileSync(parentAbs, roster + '\n' + TAIL);
        var childAbs = path.join(tmpDir, 'child-roster.html');
        var src = childSrc(parentAbs, blocks);
        fs.writeFileSync(childAbs, src);
        var out = engine.compile(src, { filename: childAbs })({ msg: 'hello' });
        assert.ok(out.indexOf('<h1>hello</h1>') > -1, 'child block content must render: ' + out);
        assert.ok(out.indexOf('frag-tail') > -1, 'the shell tail must ride the fragment: ' + out);
        assert.ok(out.indexOf('<h1>hello</h1>') < out.indexOf('frag-tail'),
            'the tail must compose AFTER the block placeholders');
    });

    it('EMPTY parent (the pre-fix poisoned state) discards the child blocks — the defect, reproduced', function() {
        var blocks = "{% block content %}<h1>{{ msg }}</h1>{% endblock %}";
        var parentAbs = path.join(tmpDir, 'parent-empty.html');
        fs.writeFileSync(parentAbs, '');
        var childAbs = path.join(tmpDir, 'child-empty.html');
        var src = childSrc(parentAbs, blocks);
        fs.writeFileSync(childAbs, src);
        var out = engine.compile(src, { filename: childAbs })({ msg: 'hello' });
        assert.equal(out.indexOf('<h1>hello</h1>'), -1,
            'a block-less parent must discard the child blocks (this is the measured defect)');
    });

    it('multi-block child: every derived placeholder renders its block, tail last', function() {
        var derive = makeDerive();
        var blocks = "{% block content %}<main>{{ msg }}</main>{% endblock %}\n{% block aside %}<aside>side</aside>{% endblock %}";
        var roster = derive(blocks);
        var parentAbs = path.join(tmpDir, 'parent-multi.html');
        fs.writeFileSync(parentAbs, roster + '\n' + TAIL);
        var childAbs = path.join(tmpDir, 'child-multi.html');
        var src = childSrc(parentAbs, blocks);
        fs.writeFileSync(childAbs, src);
        var out = engine.compile(src, { filename: childAbs })({ msg: 'body' });
        assert.ok(out.indexOf('<main>body</main>') > -1, 'first block must render');
        assert.ok(out.indexOf('<aside>side</aside>') > -1, 'second block must render');
        assert.ok(out.indexOf('<aside>side</aside>') < out.indexOf('frag-tail'), 'tail composes last');
    });

    it('CONTROL (fix-independent): a hand-written full-page parent still renders the child into its shell', function() {
        var parentAbs = path.join(tmpDir, 'parent-page.html');
        fs.writeFileSync(parentAbs, '<html><body>{% block content %}default{% endblock %}</body></html>');
        var childAbs = path.join(tmpDir, 'child-page.html');
        var src = childSrc(parentAbs, "{% block content %}<h1>{{ msg }}</h1>{% endblock %}");
        fs.writeFileSync(childAbs, src);
        var out = engine.compile(src, { filename: childAbs })({ msg: 'page' });
        assert.ok(out.indexOf('<body><h1>page</h1></body>') > -1,
            'full-page extends semantics must be intact: ' + out);
    });

});
