var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var SOURCE = path.join(require('../fw'), 'core/controller/controller.render-json.js');


// ─── 01 — Function-scoped captures of per-request refs (#M1 race fix) ────────
//
// renderJSON() is SYNCHRONOUS (not async), so its main body has no await
// boundaries — no race window between the captures at the top and the
// terminal-exit closure-nulling at the bottom. BUT the writeCache helper IS
// async and is called fire-and-forget at the end of renderJSON. After
// writeCache yields at `await fs.promises.writeFile(...)`, control returns
// to renderJSON which can complete and null `local.req` / `local.res` /
// `local.next` on the closure. If writeCache then resumes and reads
// `local.res` post-await (the narrow `invalidateOnEvents` non-Array branch
// at the bottom), it dereferences null. The fix passes `res` (the renderJSON-
// captured response) into writeCache as a parameter, so the post-await read
// goes through the function-scoped capture instead of the closure.

describe('01 - function-scoped captures of per-request refs (#M1 race fix)', function() {

    var _src;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    // ── (a) source structure: renderJSON's existing captures preserved ──

    it("renderJSON() body captures `var request = local.req` after the deps unpack", function() {
        var src = getSrc();
        assert.ok(
            /var\s+request\s*=\s*local\.req\s*;/.test(src),
            'expected `var request = local.req;` capture in renderJSON()'
        );
    });

    it("renderJSON() body captures `var response = local.res`", function() {
        var src = getSrc();
        assert.ok(
            /var\s+response\s*=\s*local\.res\s*;/.test(src),
            'expected `var response = local.res;` capture in renderJSON()'
        );
    });

    it("renderJSON() body captures `var next = local.next || null`", function() {
        var src = getSrc();
        assert.ok(
            /var\s+next\s*=\s*local\.next\s*\|\|\s*null\s*;/.test(src),
            'expected `var next = local.next || null;` capture in renderJSON()'
        );
    });

    // ── (b) source structure: writeCache signature takes res param ──────

    it('writeCache signature includes `res` parameter', function() {
        var src = getSrc();
        assert.ok(
            /async\s+function\s+writeCache\s*\(\s*bundle\s*,\s*opt\s*,\s*jsonContent\s*,\s*res\s*\)/.test(src),
            'writeCache must take `bundle, opt, jsonContent, res` — res is the renderJSON-captured response (race-safe)'
        );
    });

    it('writeCache post-await throwError uses `res` parameter, not `local.res`', function() {
        var src = getSrc();
        // The post-await throwError sits in the `invalidateOnEvents` non-Array
        // validation branch. After the `await fs.promises.writeFile(...)` at
        // line 100, `local.res` may have been nulled by renderJSON's terminal
        // exit. The fix routes the throwError through the captured `res` instead.
        assert.ok(
            /return\s+self\.throwError\(\s*res\s*,\s*500\s*,\s*new\s+Error\('cache\.invalidateOn must be an array'/.test(src),
            "expected `return self.throwError(res, 500, new Error('cache.invalidateOn must be an array'))` (post-await throwError uses captured res, not local.res)"
        );
    });

    it('writeCache call site passes `response` (the renderJSON-captured ref)', function() {
        var src = getSrc();
        assert.ok(
            /writeCache\(self\._options\.bundle,\s*local\.options\.conf\.server\.cache,\s*data,\s*response\)/.test(src),
            'writeCache call site must pass `response` (the captured ref from renderJSON line 152-153)'
        );
    });

    // ── (c) negative invariant: no `local.res` reads remain post-await in writeCache ─

    it('writeCache body has no `local.res` reads after the first await', function() {
        var src = getSrc();
        // Find writeCache function span
        var fnStart = src.indexOf('async function writeCache');
        assert.ok(fnStart > -1, 'writeCache not found');
        var fnBodyStart = src.indexOf('{', fnStart);
        // Find first await within writeCache (the writeFile await)
        var awaitIdx = src.indexOf('await fs.promises.writeFile', fnBodyStart);
        assert.ok(awaitIdx > -1, 'first await in writeCache not found');
        // Find the end of writeCache (matching closing brace) — approximate
        // by scanning forward to the next module-scope function declaration.
        var fnEnd = src.indexOf('\n}', awaitIdx);
        assert.ok(fnEnd > -1, 'writeCache closing brace not found');
        var postAwaitBlock = src.substring(awaitIdx, fnEnd);
        // Strip comments
        var stripped = postAwaitBlock.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(
            !/local\.res\b/.test(stripped),
            'no `local.res` reads allowed after writeCache\'s first await — must go through the captured `res` parameter'
        );
    });

    // ── (d) pure-logic replica: race-safety property ────────────────────

    it('captured `res` survives `local.res = null` (function-scoped vs closure-scoped)', function() {
        // Simulates: renderJSON captures response = local.res, kicks off
        // writeCache fire-and-forget, completes and nulls local.res, then
        // writeCache resumes and would have dereferenced local.res — but
        // now reads via the captured `res` parameter instead.
        var local = { req: { method: 'POST', url: '/x' }, res: { statusCode: 200 }, next: function() {} };
        var response = local.res;
        // Simulate renderJSON's terminal-exit null:
        local.res = null;
        // Simulate writeCache's post-await access via captured ref:
        assert.equal(response.statusCode, 200, 'captured response survives the closure null-out');
        assert.notEqual(response, null, 'captured response is still the same reference');
    });

});
