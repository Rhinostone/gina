var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var SOURCE = path.join(require('../fw'), 'core/controller/controller.render-nunjucks.js');


// ─── 01 — Function-scoped captures of per-request refs (#M1 race fix) ────────
//
// Mirror of render-swig.test.js section 12. renderNunjucks() is async with
// awaits at writeCache; between yields, the controller's `local` closure can
// have its `req` / `res` / `next` properties nulled by another code path
// (most commonly throwError's generic-HTML fallthrough at
// controller.js:5342-5344). Pre-retrofit, renderNunjucks read `local.req` /
// `local.res` directly throughout its body and helpers (sendHtmlResponse /
// writeCache / registerGinaFilters), so any post-await read after such a
// null-out would crash with `Cannot read properties of null (reading
// 'method')` or similar.
//
// The retrofit captures `local.req` / `local.res` / `local.next` into
// function-scoped `var req` / `var res` / `var _next` at the very top of
// renderNunjucks() (immediately after the deps unpack, before any await).
// All post-deps reads go through the captures. Helpers that read the
// per-request refs (sendHtmlResponse / writeCache / registerGinaFilters)
// take the captures as parameters.

describe('01 - function-scoped captures of per-request refs (#M1 race fix)', function() {

    var _src;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    // ── (a) source structure: captures at top of renderNunjucks ─────────

    it("renderNunjucks() body captures `var req = local.req` after the deps unpack", function() {
        var src = getSrc();
        var renderIdx = src.indexOf('module.exports = async function renderNunjucks');
        assert.ok(renderIdx > -1, 'renderNunjucks() exported declaration not found');
        // Window from renderNunjucks() declaration to the first await on a
        // user-visible promise (writeCache). Anchored on `await writeCache(`
        // since the writeCache helper above also has its own await but lives
        // outside the renderNunjucks body.
        var awaitIdx = src.indexOf('await writeCache(', renderIdx);
        assert.ok(awaitIdx > -1, 'first await writeCache(...) in renderNunjucks not found');
        var prologue = src.substring(renderIdx, awaitIdx);
        assert.ok(
            /var\s+req\s*=\s*local\.req\s*;/.test(prologue),
            'expected `var req = local.req;` capture before any await in renderNunjucks()'
        );
    });

    it("renderNunjucks() body captures `var res = local.res` after the deps unpack", function() {
        var src = getSrc();
        var renderIdx = src.indexOf('module.exports = async function renderNunjucks');
        var awaitIdx  = src.indexOf('await writeCache(', renderIdx);
        var prologue  = src.substring(renderIdx, awaitIdx);
        assert.ok(
            /var\s+res\s*=\s*local\.res\s*;/.test(prologue),
            'expected `var res = local.res;` capture before any await in renderNunjucks()'
        );
    });

    it("renderNunjucks() body captures `var _next = local.next` after the deps unpack", function() {
        var src = getSrc();
        var renderIdx = src.indexOf('module.exports = async function renderNunjucks');
        var awaitIdx  = src.indexOf('await writeCache(', renderIdx);
        var prologue  = src.substring(renderIdx, awaitIdx);
        assert.ok(
            /var\s+_next\s*=\s*local\.next\s*;/.test(prologue),
            'expected `var _next = local.next;` capture before any await in renderNunjucks()'
        );
    });

    it("captures come AFTER `local = deps.local;` so they read the populated closure", function() {
        var src = getSrc();
        var depsIdx    = src.indexOf('var local = deps.local;');
        var captureIdx = src.indexOf('var req   = local.req;');
        assert.ok(depsIdx > -1, '`var local = deps.local;` deps assignment not found');
        assert.ok(captureIdx > -1, '`var req   = local.req;` capture not found');
        assert.ok(
            captureIdx > depsIdx,
            'captures must come AFTER `var local = deps.local;` so `local` is populated when read'
        );
    });

    // ── (b) source structure: helper signatures take req, res params ────

    it('writeCache signature includes `req, res` parameters', function() {
        var src = getSrc();
        assert.ok(
            /async\s+function\s+writeCache\s*\(\s*local\s*,\s*self\s*,\s*bundle\s*,\s*opt\s*,\s*htmlContent\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'writeCache must take `local, self, bundle, opt, htmlContent, req, res` — req/res are renderNunjucks()-captured copies (race-safe)'
        );
    });

    it('sendHtmlResponse signature includes `req, res` parameters', function() {
        var src = getSrc();
        assert.ok(
            /function\s+sendHtmlResponse\s*\(\s*local\s*,\s*html\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'sendHtmlResponse must take `local, html, req, res` — its 19 post-await local.req/res reads now go through the captures'
        );
    });

    it('registerGinaFilters signature includes `req, res` parameters', function() {
        var src = getSrc();
        assert.ok(
            /function\s+registerGinaFilters\s*\(\s*env\s*,\s*self\s*,\s*local\s*,\s*localOptions\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'registerGinaFilters must take `env, self, local, localOptions, req, res` — its 11 local.req reads now go through the captures'
        );
    });

    // ── (c) source structure: call sites pass req, res ──────────────────

    it('renderNunjucks calls sendHtmlResponse with `req, res` on both paths', function() {
        var src = getSrc();
        // Two call sites: empty-string fallback (no-views early return) and the
        // main render path at the bottom of renderNunjucks(). The function
        // declaration above (`function sendHtmlResponse(local, html, req, res)`)
        // matches the same parameter-shape regex, so we expect 3 total
        // occurrences (1 definition + 2 call sites).
        var matches = src.match(/sendHtmlResponse\s*\(\s*local\s*,\s*[^,)]+\s*,\s*req\s*,\s*res\s*\)/g);
        assert.ok(matches, 'no sendHtmlResponse(..., req, res) occurrences found');
        assert.strictEqual(matches.length, 3, 'expected 3 occurrences: 1 definition + 2 call sites (no-views + main render)');
        // Verify the no-views call site (empty string body) is present.
        assert.ok(
            /sendHtmlResponse\s*\(\s*local\s*,\s*''\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'expected sendHtmlResponse(local, "", req, res) for no-views early return'
        );
        // Verify the main-path call site (html body) is present.
        assert.ok(
            /sendHtmlResponse\s*\(\s*local\s*,\s*html\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'expected sendHtmlResponse(local, html, req, res) for main render path (post-await)'
        );
    });

    it('renderNunjucks calls registerGinaFilters with `req, res`', function() {
        var src = getSrc();
        assert.ok(
            /registerGinaFilters\s*\(\s*env\s*,\s*self\s*,\s*local\s*,\s*localOptions\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'registerGinaFilters call site must pass req, res'
        );
    });

    it('renderNunjucks awaits writeCache with `req, res`', function() {
        var src = getSrc();
        assert.ok(
            /await\s+writeCache\s*\(\s*local\s*,\s*self\s*,\s*localOptions\.bundle\s*,\s*localOptions\.conf\.server\.cache\s*,\s*html\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'writeCache call site must pass req, res — this is the critical post-await race window'
        );
    });

    // ── (d) negative invariant: no `local.req` / `local.res` / `local.next`
    //     READS in active code outside the captures and the bug-explanation
    //     comment. The negative lookahead `(?!\s*=)` excludes terminal-exit
    //     WRITES (`local.req = null;` etc.) — those are deliberate per
    //     class.controller.md § 4 and don't carry the post-await race risk
    //     the captures guard against.

    it('no `local.req` reads remain in active code outside the captures', function() {
        var src = getSrc();
        // Strip single-line and block comments so commented-out documentation
        // (e.g. the bug explanation in the captures' comment block) does not
        // count as an "active read".
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.req\b(?!\s*=)/g) || [];
        // Allowed: only the capture `var req   = local.req;` (1 occurrence)
        assert.strictEqual(
            allReads.length, 1,
            'expected exactly 1 `local.req` READ in active code (the capture line), found ' + allReads.length
        );
    });

    it('no `local.res` reads remain in active code outside the captures', function() {
        var src = getSrc();
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.res\b(?!\s*=)/g) || [];
        assert.strictEqual(
            allReads.length, 1,
            'expected exactly 1 `local.res` READ in active code (the capture line), found ' + allReads.length
        );
    });

    it('no `local.next` reads remain in active code outside the captures', function() {
        var src = getSrc();
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.next\b(?!\s*=)/g) || [];
        assert.strictEqual(
            allReads.length, 1,
            'expected exactly 1 `local.next` READ in active code (the capture line), found ' + allReads.length
        );
    });

    // ── (e) pure-logic replica: race-safety property ────────────────────

    it('captured `req` survives `local.req = null` (function-scoped vs closure-scoped)', function() {
        // Simulate the controller's per-request closure shape.
        var local = { req: { method: 'GET', url: '/x' }, res: {}, next: function() {} };
        // Capture function-scoped refs (mirrors the captures in renderNunjucks).
        var req = local.req;
        var res = local.res;
        var _next = local.next;
        // External path nulls the closure properties (mirrors throwError's
        // generic-error fallthrough at controller.js:5342-5344).
        local.req = null;
        local.res = null;
        local.next = null;
        // Pre-retrofit: any `local.req.X` post-await read crashed. Post-
        // retrofit: the captured `req` still references the original object.
        assert.equal(req.method, 'GET', 'captured req survives the closure null-out');
        assert.equal(req.url, '/x', 'captured req object is still the same reference');
        assert.notEqual(res, null, 'captured res survives the closure null-out');
        assert.equal(typeof _next, 'function', 'captured _next survives the closure null-out');
    });

    it('repro of the pre-retrofit failure: `local.req.method` after null-out throws TypeError', function() {
        // sendHtmlResponse line 396 pre-retrofit: `var isHead = /^HEAD$/i.test(local.req.method);`
        // The race surface: if local.req was nulled while renderNunjucks was
        // suspended at the writeCache await, sendHtmlResponse on resume would
        // crash here. Post-retrofit, sendHtmlResponse receives `req` as a
        // parameter (the captured ref) so this access never sees null.
        var local = { req: { method: 'GET' } };
        local.req = null;
        assert.throws(
            function() {
                /* eslint-disable no-unused-vars */
                var isHead = /^HEAD$/i.test(local.req.method);
                /* eslint-enable no-unused-vars */
            },
            /Cannot read prop(erty|erties).+null.+(reading\s+'method'|of\s+null)/,
            'pre-retrofit access pattern must throw TypeError on null local.req'
        );
    });

    it('post-retrofit: the same access via the captured `req` does NOT throw', function() {
        var local = { req: { method: 'GET' } };
        var req = local.req;
        local.req = null;
        var isHead = /^HEAD$/i.test(req.method);
        assert.equal(isHead, false, 'GET is not HEAD; the access returns a boolean instead of throwing');
    });

});


// ─── 02 — Terminal-exit closure nulling (#M1 retrofit follow-up) ─────────────
//
// render-swig.js nulls `local.req` / `local.res` / `local.next` on the closure
// at every success-side terminal exit (cache-hit, normal render, error
// fallthrough) for early per-request memory release. The captures from
// section 01 stay alive until the function returns and are GC'd then; the
// closure properties need explicit nulling for early release of the per-
// request payload (the controller's `local` closure also holds `options` and
// other per-request fields that GC can reclaim once the request is done).
//
// Mirror site: render-swig.js terminal exits at lines 964, 1603, 1637.

describe('02 - terminal-exit closure nulling (#M1 retrofit follow-up)', function() {

    var _src;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    it('no-view short-circuit nulls local.req/res/next after sendHtmlResponse', function() {
        var src = getSrc();
        // Match the 5-line shape: sendHtmlResponse + 3 null writes + return.
        var pattern = /sendHtmlResponse\(local,\s*['"]['"],\s*req,\s*res\);[\s\S]{0,300}?local\.req\s*=\s*null;\s*local\.res\s*=\s*null;\s*local\.next\s*=\s*null;\s*return;/;
        assert.ok(
            pattern.test(src),
            'expected the no-view short-circuit to null local.req/res/next after sendHtmlResponse and before return'
        );
    });

    it('final terminal exit nulls local.req/res/next after sendHtmlResponse', function() {
        var src = getSrc();
        // Match the final sendHtmlResponse(local, html, req, res) + 3 null
        // writes at the end of the function, followed by the function close `};`.
        var pattern = /sendHtmlResponse\(local,\s*html,\s*req,\s*res\);[\s\S]{0,300}?local\.req\s*=\s*null;\s*local\.res\s*=\s*null;\s*local\.next\s*=\s*null;\s*\};/;
        assert.ok(
            pattern.test(src),
            'expected the final terminal exit to null local.req/res/next after sendHtmlResponse before the function close'
        );
    });

    it('exactly 2 closure-nulling sites (no over-nulling on throwError paths)', function() {
        var src = getSrc();
        // Strip comments so commented-out documentation doesn't count.
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var writes = stripped.match(/local\.req\s*=\s*null/g) || [];
        // Two sites: no-view short-circuit + final terminal exit. throwError
        // paths handle cleanup via their own controller render chain, matching
        // render-swig.js's "only success-side terminals" pattern.
        assert.strictEqual(
            writes.length, 2,
            'expected exactly 2 `local.req = null` writes (no-view + final), found ' + writes.length
        );
    });

    it('captures precede the first nulling site (ordering invariant)', function() {
        var src = getSrc();
        var captureIdx = src.indexOf('var req   = local.req;');
        var firstNull  = src.indexOf('local.req = null');
        assert.ok(captureIdx > -1, 'capture line `var req   = local.req;` not found');
        assert.ok(firstNull > -1, 'no `local.req = null` site found');
        assert.ok(
            captureIdx < firstNull,
            'captures must precede the first nulling site so the function-scoped refs hold live values when the closure is nulled'
        );
    });

    it('triple-null block: req → res → next ordering matches render-swig pattern', function() {
        var src = getSrc();
        // Each nulling block must be the exact three-line shape in the order
        // req → res → next. This locks the pattern against partial regressions
        // (e.g. someone adding `local.res = null` without the matching pair).
        var pattern = /local\.req\s*=\s*null;\s*local\.res\s*=\s*null;\s*local\.next\s*=\s*null;/g;
        var matches = src.match(pattern) || [];
        assert.strictEqual(
            matches.length, 2,
            'expected exactly 2 `local.req=null; local.res=null; local.next=null;` triple-blocks, found ' + matches.length
        );
    });
});


// 03 — HTTP/2 response trailers (#H10)
describe('03 - HTTP/2 response trailers (#H10)', function() {

    function src() { return fs.readFileSync(SOURCE, 'utf8'); }

    it('captures _trailers from local._trailers', function() {
        assert.ok(/var _trailers\s*=.*local\._trailers/.test(src()), 'expected _trailers capture from local._trailers');
    });

    it('wires waitForTrailers + wantTrailers + sendTrailers in the body path', function() {
        var s = src();
        assert.ok(s.indexOf('#H10') > -1, 'expected #H10 marker');
        assert.ok(s.indexOf('waitForTrailers') > -1, 'expected waitForTrailers');
        assert.ok(s.indexOf("'wantTrailers'") > -1, 'expected wantTrailers listener');
        assert.ok(s.indexOf('sendTrailers') > -1, 'expected sendTrailers call');
    });

    it('gates the trailer wiring on registered trailers (if (_trailers))', function() {
        assert.ok(/if\s*\(\s*_trailers\s*\)/.test(src()), 'expected `if (_trailers)` gate');
    });

    it('passes waitForTrailers conditionally to the body-path stream.respond()', function() {
        assert.ok(
            /stream\.respond\(_streamHeaders,\s*_trailers\s*\?\s*\{\s*waitForTrailers:\s*true\s*\}\s*:\s*undefined\)/.test(src()),
            'expected single conditional stream.respond(_streamHeaders, _trailers ? {...} : undefined) in Case 3 (body)'
        );
    });
});


// 04 — CSP nonce on framework-injected inline scripts (#HDR5)
describe('04 - CSP nonce: onGinaLoaded bootstrap carries req._ginaCspNonce', function() {

    function src() { return fs.readFileSync(SOURCE, 'utf8'); }

    it('captures _cspNonce from req._ginaCspNonce', function() {
        assert.ok(
            /var _cspNonce\s*=\s*\(req && req\._ginaCspNonce\)\s*\?\s*req\._ginaCspNonce\s*:\s*null/.test(src()),
            'expected _cspNonce captured from req._ginaCspNonce'
        );
    });

    it('threads cspNonce into injectAssets (param + call site)', function() {
        var s = src();
        assert.ok(/function injectAssets\(html, data, localOptions, cspNonce\)/.test(s),
            'expected injectAssets to accept a cspNonce param');
        assert.ok(/injectAssets\(html, data, localOptions, _cspNonce\)/.test(s),
            'expected the call site to pass _cspNonce');
    });

    it('stamps the bootstrap <script> with the nonce inside injectAssets (#HDR5)', function() {
        var s = src();
        assert.ok(s.indexOf('#HDR5') > -1, 'expected #HDR5 marker');
        assert.ok(
            /'<script type="text\/javascript" nonce="'\s*\+\s*cspNonce\s*\+\s*'">'/.test(s),
            'expected the nonce attribute injected into the bootstrap script tag'
        );
    });

    // pure-logic replica (mirrors the injectAssets nonce transform)
    function nonceLoader(loaderTag, cspNonce) {
        if (cspNonce && typeof loaderTag === 'string') {
            return loaderTag.replace(
                '<script type="text/javascript">',
                '<script type="text/javascript" nonce="' + cspNonce + '">'
            );
        }
        return loaderTag;
    }

    var LOADER = '\n\t\t<script type="text/javascript">\n\t\t<!--\n\t\tvar x=1;\n\t\t//-->\n\t\t</script>';

    it('replica: injects the nonce attribute when a nonce is present', function() {
        var out = nonceLoader(LOADER, 'ABC+/=');
        assert.ok(out.indexOf('<script type="text/javascript" nonce="ABC+/=">') > -1);
        assert.strictEqual(out.indexOf('<script type="text/javascript">'), -1, 'bare tag rewritten');
    });

    it('replica: returns the loader unchanged when no nonce (back-compat)', function() {
        assert.strictEqual(nonceLoader(LOADER, null), LOADER);
        assert.strictEqual(nonceLoader(LOADER, undefined), LOADER);
    });

});
