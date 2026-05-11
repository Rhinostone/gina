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

    // ── (d) negative invariant: no `local.req` / `local.res` reads in
    //     active code outside the captures and the bug-explanation comment ─

    it('no `local.req` reads remain in active code outside the captures', function() {
        var src = getSrc();
        // Strip single-line and block comments so commented-out documentation
        // (e.g. the bug explanation in the captures' comment block) does not
        // count as an "active read".
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.req\b/g) || [];
        // Allowed: only the capture `var req   = local.req;` (1 occurrence)
        assert.strictEqual(
            allReads.length, 1,
            'expected exactly 1 `local.req` reference in active code (the capture line), found ' + allReads.length
        );
    });

    it('no `local.res` reads remain in active code outside the captures', function() {
        var src = getSrc();
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.res\b/g) || [];
        assert.strictEqual(
            allReads.length, 1,
            'expected exactly 1 `local.res` reference in active code (the capture line), found ' + allReads.length
        );
    });

    it('no `local.next` reads remain in active code outside the captures', function() {
        var src = getSrc();
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.next\b/g) || [];
        assert.strictEqual(
            allReads.length, 1,
            'expected exactly 1 `local.next` reference in active code (the capture line), found ' + allReads.length
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
