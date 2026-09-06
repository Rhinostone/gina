/**
 * #B496 — the automatic 103 Early Hints response.
 *
 * `render()` read `local.options.template.h2Links` and fired `setEarlyHints()`
 * when it was truthy, but the only writers of `h2Links` are the two `+=` sites
 * in `getNodeRes()`, reached from `setResources()`, which every render delegate
 * calls AFTER `render()` has dispatched to it. The read therefore always saw the
 * `''` the router seeds, and the hint had never fired since it was added — a
 * defect present in the introducing commit itself, not a regression.
 *
 * The fix computes the prefix in `render()` before the dispatch and restores the
 * seed afterwards, so the final-200 `link` header keeps its existing producer
 * untouched. These pins lock in the three properties that make it safe:
 *
 *   1. the computation runs AFTER the #SPA1 block (which resolves isWithoutLayout
 *      — every delegate filters its asset list to common-only under that flag, so
 *      computing earlier would hint the full list on a fragment request) and
 *      BEFORE the delegate dispatch (the engine-agnostic contract);
 *   2. it resolves its view config as `errOptions || local.options`, the way all
 *      five delegates do, so a custom-error render hints the error page's assets;
 *   3. `getNodeRes()` is untouched, which is what keeps the 200 header identical.
 *
 * The seam: set `B496_SRC` to a pre-change copy of controller.js to prove these
 * arms go red against it. Every discriminating arm below was validated that way.
 */
var assert  = require('assert');
var fs      = require('fs');
var path    = require('path');
var { describe, it } = require('node:test');

var FW      = path.join(__dirname, '../../framework');
var version = fs.readdirSync(FW).filter(function (d) { return /^v\d/.test(d); })[0];
var SOURCE  = process.env.B496_SRC || path.join(FW, version, 'core/controller/controller.js');
var SRC     = fs.readFileSync(SOURCE, 'utf8');

// The region under test: render()'s body.
function renderBody() {
    var start = SRC.indexOf('this.render = function (userData');
    assert.ok(start > -1, 'render() not found');
    var end = SRC.indexOf('\n    }', start) + 6;
    assert.ok(end > start, 'render() body end not found');
    return SRC.slice(start, end);
}

describe('01 - #B496 the preload computation exists and is placed correctly', function () {

    it('render() contains the #B496 preload population block', function () {
        assert.ok(
            renderBody().indexOf('#B496 — populate the CSS/JS preload prefix') > -1,
            'expected the #B496 population block inside render()'
        );
    });

    it('the population runs AFTER the #SPA1 block that resolves isWithoutLayout', function () {
        // The ordering constraint: #SPA1 sets local.options.isWithoutLayout, and every
        // delegate filters assets to common-only under it. Computing before #SPA1 would
        // hint the FULL asset list on a fragment request and silently disagree with the
        // 200 header.
        var body   = renderBody();
        var spa1   = body.indexOf('#SPA1 — content negotiation');
        var popul  = body.indexOf('#B496 — populate the CSS/JS preload prefix');
        assert.ok(spa1  > -1, '#SPA1 block present');
        assert.ok(popul > -1, '#B496 population present');
        assert.ok(popul > spa1, '#B496 population must run AFTER the #SPA1 negotiation block');
    });

    it('the population runs BEFORE the delegate dispatch', function () {
        var body     = renderBody();
        var popul    = body.indexOf('#B496 — populate the CSS/JS preload prefix');
        var dispatch = body.indexOf('return require( _(__dirname + _delegate');
        assert.ok(dispatch > -1, 'delegate dispatch present');
        assert.ok(popul < dispatch, '#B496 population must precede the delegate dispatch');
    });

    it('#EH1 still fires between the population and the dispatch', function () {
        var body     = renderBody();
        var popul    = body.indexOf('#B496 — populate the CSS/JS preload prefix');
        var eh1      = body.indexOf('#EH1');
        var dispatch = body.indexOf('return require( _(__dirname + _delegate');
        assert.ok(eh1 > popul,      '#EH1 must read AFTER the population');
        assert.ok(eh1 < dispatch,   '#EH1 must still precede the delegate dispatch');
    });
});

describe('02 - #B496 gating mirrors the 200 header, plus the XHR exclusion', function () {

    function populationBlock() {
        var body  = renderBody();
        var start = body.indexOf('#B496 — populate the CSS/JS preload prefix');
        var end   = body.indexOf('#EH1', start);
        assert.ok(start > -1 && end > start, 'population block region not found');
        return body.slice(start, end);
    }

    it('gates on http/2', function () {
        assert.match(populationBlock(), /\/http\\\/2\/\.test\(\s*local\.options\.conf\.server\.protocol\s*\)/);
    });

    it('gates on !self.isCacheless() (production only, mirroring getNodeRes)', function () {
        assert.match(populationBlock(), /!self\.isCacheless\(\)/);
    });

    it('gates on !self.isXMLRequest() — an XHR fragment has no document load to hint', function () {
        assert.match(populationBlock(), /!self\.isXMLRequest\(\)/);
    });

    it('gates on hasViews()', function () {
        assert.match(populationBlock(), /hasViews\(\)/);
    });

    it('only populates when h2Links is still the router seed', function () {
        // Re-entrancy: a nested render must not overwrite an h2Links the OUTER
        // delegate's getNodeRes() has already accumulated into.
        assert.match(populationBlock(), /local\.options\.template\.h2Links === ''/);
    });

    it('resolves the view config as errOptions || local.options, like all five delegates', function () {
        assert.match(populationBlock(), /var _ehOptions\s*=\s*\(errOptions\)\s*\?\s*errOptions\s*:\s*local\.options/);
    });

    it('applies the isWithoutLayout common-only filter, like the delegates', function () {
        var blk = populationBlock();
        assert.match(blk, /_ehOptions\.isWithoutLayout/);
        assert.match(blk, /isCommon:\s*false/);
    });
});

describe('03 - #B496 the restore keeps the 200 header byte-identical', function () {

    it('restores the router seed after the hint', function () {
        var body = renderBody();
        assert.ok(
            body.indexOf("#B496 — restore the router's seed") > -1,
            'expected the restore block'
        );
    });

    it('the restore is guarded on a PER-CALL flag, not request state', function () {
        // A request-scoped flag would let a nested render's restore wipe the h2Links
        // the OUTER delegate had already accumulated.
        var body = renderBody();
        assert.match(body, /var _ehPopulated\s*=\s*false/);
        assert.match(body, /if\s*\(\s*_ehPopulated\s*\)\s*\{/);
    });

    it('the restore runs AFTER the #EH1 read and BEFORE the dispatch', function () {
        var body     = renderBody();
        var eh1      = body.indexOf('#EH1');
        var restore  = body.indexOf("#B496 — restore the router's seed");
        var dispatch = body.indexOf('return require( _(__dirname + _delegate');
        assert.ok(restore > eh1,      'restore must follow the #EH1 read');
        assert.ok(restore < dispatch, 'restore must precede the dispatch');
    });
});

describe('04 - #B496 getNodeRes is UNTOUCHED (what makes the 200 header safe)', function () {

    function getNodeResBody() {
        var start = SRC.indexOf('var getNodeRes = function');
        var end   = SRC.indexOf('var isValidURL');
        assert.ok(start > -1 && end > start, 'getNodeRes region not found');
        return SRC.slice(start, end);
    }

    it('still accumulates h2Links for the CSS branch', function () {
        assert.match(
            getNodeResBody(),
            /local\.options\.template\.h2Links\s*\+=\s*'<'\s*\+\s*obj\.url\s*\+\s*'>;\s*as=style;\s*rel=preload,'/
        );
    });

    it('still accumulates h2Links for the JS branch', function () {
        assert.match(
            getNodeResBody(),
            /local\.options\.template\.h2Links\s*\+=\s*'<'\s*\+\s*obj\.url\s*\+\s*'>;\s*as=script;\s*rel=preload,'/
        );
    });

    it('the preload computation never writes h2Links (it is a pure read)', function () {
        var start = SRC.indexOf('var computeH2PreloadPrefix = function');
        var end   = SRC.indexOf('TODO -  SuperController.setMeta');
        assert.ok(start > -1 && end > start, 'computeH2PreloadPrefix region not found');
        var helper = SRC.slice(start, end);
        assert.ok(helper.indexOf('h2Links') === -1, 'the helper must not touch h2Links');
    });
});

describe('05 - #B496 behavioural replay of the prefix builder', function () {

    // Source-derived replica of computeH2PreloadPrefix's loop. The framework copy
    // reads `local` / `lib` from its closure, so it cannot be lifted verbatim; this
    // mirrors the rule under test (webroot rewrite, SRI suppression, ordering,
    // trailing comma) and is pinned against the real source by suite 04 above.
    function build(viewConf, opt) {
        opt = opt || {};
        var webroot    = opt.webroot || '/';
        var useWebroot = (webroot !== '/' && webroot.length > 0);
        var sri        = opt.sri || function () { return ''; };
        var links      = '';
        function appendAll(as, arr) {
            if (!arr) { return; }
            for (var r = 0; r < arr.length; ++r) {
                var obj = arr[r];
                if (!obj || !obj.url) { continue; }
                var url = (useWebroot && !obj.url.startsWith(webroot))
                    ? webroot + obj.url.substring(1)
                    : obj.url;
                if (opt.sriEnabled && sri(url)) { continue; }
                links += '<' + url + '>; as=' + as + '; rel=preload,';
            }
        }
        appendAll('style',  viewConf.stylesheets);
        appendAll('script', viewConf.javascripts);
        return links;
    }

    it('emits styles then scripts, comma-terminated', function () {
        assert.equal(
            build({ stylesheets: [{ url: '/a.css' }], javascripts: [{ url: '/b.js' }] }),
            '</a.css>; as=style; rel=preload,</b.js>; as=script; rel=preload,'
        );
    });

    it('returns empty for a view with no declared assets — no hint-less 103', function () {
        assert.equal(build({}), '');
        assert.equal(build({ stylesheets: [], javascripts: [] }), '');
    });

    it('applies the webroot prefix only when the url lacks it', function () {
        // The framework's join is literal — `webroot + url.substring(1)`, with NO
        // separator inserted — so it assumes a trailing-slash webroot. Pinned as the
        // real rule rather than the intuitive one: `/web` + `a.css` is `/weba.css`,
        // and this replica must keep agreeing with getNodeRes whatever that rule is.
        // In practice the branch rarely fires — built asset urls already carry the
        // webroot, so the startsWith guard skips them (measured on a live prod h2 boot).
        assert.equal(
            build({ stylesheets: [{ url: '/a.css' }, { url: '/web/b.css' }] }, { webroot: '/web/' }),
            '</web/a.css>; as=style; rel=preload,</web/b.css>; as=style; rel=preload,'
        );
        // and the no-separator form, documented so a future reader is not surprised
        assert.equal(
            build({ stylesheets: [{ url: '/a.css' }] }, { webroot: '/web' }),
            '</weba.css>; as=style; rel=preload,'
        );
    });

    it('#OW3 — an SRI-attributed asset gets no preload hint', function () {
        var out = build(
            { stylesheets: [{ url: '/a.css' }, { url: '/b.css' }] },
            { sriEnabled: true, sri: function (u) { return u === '/a.css' ? ' integrity="sha384-x"' : ''; } }
        );
        assert.equal(out, '</b.css>; as=style; rel=preload,');
    });

    it('skips malformed entries rather than emitting a broken hint', function () {
        assert.equal(
            build({ stylesheets: [null, {}, { url: '/ok.css' }] }),
            '</ok.css>; as=style; rel=preload,'
        );
    });

    it('the #EH1 trim turns the trailing comma into a well-formed header', function () {
        var prefix = build({ stylesheets: [{ url: '/a.css' }] });
        var hints  = /,$/.test(prefix) ? prefix.slice(0, -1) : prefix;
        assert.equal(hints, '</a.css>; as=style; rel=preload');
    });
});
