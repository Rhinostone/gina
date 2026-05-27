var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var SOURCE = path.join(require('../fw'), 'core/controller/controller.render-swig.js');


// 01 — Async conversion: exported render function and writeCache must be async (#P28-#P31)
describe('01 - async I/O conversion: render and writeCache are async functions', function() {

    it('module.exports is an async function (render)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /module\.exports\s*=\s*async\s+function\s+render/.test(src),
            'expected `module.exports = async function render` — async conversion (#P28-#P31) was reverted'
        );
    });

    it('writeCache is an async function', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /async\s+function\s+writeCache/.test(src),
            'expected `async function writeCache` — async conversion (#P30) was reverted'
        );
    });

});


// 02 — No synchronous blocking I/O calls remain in render-swig.js (#P28-#P31)
describe('02 - no synchronous blocking fs I/O in render-swig.js', function() {

    it('no fs.readFileSync calls (outside comments)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        // Strip single-line comments before checking
        var stripped = src.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/fs\.readFileSync/.test(stripped),
            'fs.readFileSync found outside comments — async read (#P28, #P29) was reverted'
        );
    });

    it('no fs.openSync calls (outside comments)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var stripped = src.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/fs\.openSync/.test(stripped),
            'fs.openSync found outside comments — async write (#P30, #P31) was reverted'
        );
    });

    it('no fs.writeSync calls (outside comments)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var stripped = src.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/fs\.writeSync/.test(stripped),
            'fs.writeSync found outside comments — async write (#P30, #P31) was reverted'
        );
    });

    it('no fs.closeSync calls (outside comments)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var stripped = src.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/fs\.closeSync/.test(stripped),
            'fs.closeSync found outside comments — async write (#P30, #P31) was reverted'
        );
    });

});


// 03 — Async replacements are present
describe('03 - async fs.promises calls are present', function() {

    it('uses fs.promises.readFile for template read (#P28)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /await\s+fs\.promises\.readFile\(path\)/.test(src),
            'expected `await fs.promises.readFile(path)` for template read (#P28)'
        );
    });

    it('uses fs.promises.readFile for layout read (#P29)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /await\s+fs\.promises\.readFile\(layoutPath/.test(src),
            'expected `await fs.promises.readFile(layoutPath` for layout read (#P29)'
        );
    });

    it('uses fs.promises.writeFile for cache write (#P30)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /await\s+fs\.promises\.writeFile\(htmlFilename/.test(src),
            'expected `await fs.promises.writeFile(htmlFilename` for cache write (#P30)'
        );
    });

    it('uses async fs.promises for layout cache placement (#P31)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        // The layout cache write must be async (#P31). After the
        // 2026-05-11 atomic-rename race fix, the cache file is placed via
        // a temp+rename pair: writeFile to a per-process temp, then rename
        // onto newLayoutFilename. The rename target identifier is the
        // load-bearing signal — section 02 already guards globally against
        // fs.openSync / fs.writeSync, so any path reaching the rename
        // below has gone through async fs.promises.
        assert.ok(
            /await\s+fs\.promises\.rename\([^,)]+,\s*newLayoutFilename\s*\)/.test(src),
            'expected `await fs.promises.rename(<temp>, newLayoutFilename)` for atomic layout cache placement (#P31)'
        );
    });

});


// 04 — Error field priority: actual upstream error over generic statusCodes label (#Q1 / #Q2)
describe('04 - error field priority: data.page.data.error wins over statusCodes[status] (#Q1/#Q2)', function() {

    it('_errDetail is assigned from data.page.data.error first', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /var _errDetail\s*=\s*data\.page\.data\.error\s*\|\|/.test(src),
            'expected `var _errDetail = data.page.data.error ||` — normalization must start from the actual error (#Q2)'
        );
    });

    it('errorObject.error is built with _errDetail first (normalized string)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /error\s*:\s*_errDetail\s*\|\|/.test(src),
            'expected `error: _errDetail ||` — normalized string must be used, not raw data.page.data.error (#Q2)'
        );
    });

    it('statusCodes[...] is used as fallback only (after || _errDetail || _msgDetail)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /_errDetail\s*\|\|.*statusCodes\[/.test(src),
            'expected statusCodes[...] after _errDetail || in the error field (#Q1)'
        );
    });

    it('#Q1 marker is present in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('#Q1') > -1,
            'expected #Q1 marker — comment convention not applied'
        );
    });

    it('replaced comment documents old statusCodes-first pattern', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /replaced:.*statusCodes\[data\.page\.data\.status\]\s+first/.test(src),
            'expected "replaced: statusCodes[data.page.data.status] first" comment (#Q1)'
        );
    });

    it('pure logic: actual error takes priority over generic label', function() {
        // Replicate the errorObject.error assignment logic from render-swig.js
        var statusCodes = { '502': 'Bad Gateway' };
        var data = { status: 502, error: 'upstream timeout', message: 'connection reset' };
        var error = data.error || data.message || statusCodes[data.status] || '';
        assert.equal(error, 'upstream timeout');
    });

    it('pure logic: message used when error is absent', function() {
        var statusCodes = { '502': 'Bad Gateway' };
        var data = { status: 502, message: 'connection reset' };
        var error = data.error || data.message || statusCodes[data.status] || '';
        assert.equal(error, 'connection reset');
    });

    it('pure logic: statusCodes label used when both error and message are absent', function() {
        var statusCodes = { '502': 'Bad Gateway' };
        var data = { status: 502 };
        var error = data.error || data.message || statusCodes[data.status] || '';
        assert.equal(error, 'Bad Gateway');
    });

});


// 05 — console.error fires before throwError on non-2xx interception (#Q1)
describe('05 - console.error fires before throwError in error interception block (#Q1)', function() {

    it('console.error call is present in the error interception block', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /console\.error\(/.test(src),
            'expected console.error() call in error interception block (#Q1)'
        );
    });

    it('[render] prefix is used in console.error log line', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /\[render\].*from upstream/.test(src),
            'expected `[render] ... from upstream` in console.error call (#Q1)'
        );
    });

    it('_errDetail is used in the log to include the actual error reason', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /_errDetail/.test(src),
            'expected `_errDetail` variable used for log detail in error interception (#Q1)'
        );
    });

    it('console.error appears before return self.throwError(errorObject) in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var errLogIdx    = src.indexOf("'[render] '");
        var throwErrIdx  = src.indexOf('return self.throwError(errorObject)');
        assert.ok(errLogIdx > -1,   'console.error with [render] prefix not found');
        assert.ok(throwErrIdx > -1, 'return self.throwError(errorObject) not found');
        assert.ok(
            errLogIdx < throwErrIdx,
            'console.error must appear before return self.throwError(errorObject) (#Q1)'
        );
    });

});


// 06 — Object error normalization: upstream object errors do not render as "[object Object]" (#Q2)
describe('06 - object error normalization: error/message objects coerced to strings (#Q2)', function() {

    it('#Q2 marker is present in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('#Q2') > -1,
            'expected #Q2 marker — comment convention not applied'
        );
    });

    it('normalization guard checks typeof _errDetail === object', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /typeof\(_errDetail\)\s*===\s*'object'/.test(src),
            'expected typeof(_errDetail) === \'object\' guard for normalization (#Q2)'
        );
    });

    it('normalization guard checks typeof _msgDetail === object', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /typeof\(_msgDetail\)\s*===\s*'object'/.test(src),
            'expected typeof(_msgDetail) === \'object\' guard for normalization (#Q2)'
        );
    });

    it('normalization appears before errorObject construction in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var normIdx = src.indexOf('var _errDetail = data.page.data.error');
        var objIdx  = src.indexOf('var errorObject = {');
        assert.ok(normIdx > -1, 'var _errDetail assignment not found');
        assert.ok(objIdx  > -1, 'var errorObject = { not found');
        assert.ok(
            normIdx < objIdx,
            '_errDetail normalization must appear before errorObject construction (#Q2)'
        );
    });

    it('pure logic: object error is coerced via .message', function() {
        var raw = { message: 'upstream timeout', code: 503 };
        var errDetail = raw;
        if (errDetail && typeof errDetail === 'object') {
            errDetail = errDetail.message || errDetail.error || JSON.stringify(errDetail);
        }
        assert.equal(errDetail, 'upstream timeout');
    });

    it('pure logic: object error falls back to .error when .message absent', function() {
        var raw = { error: 'service unavailable' };
        var errDetail = raw;
        if (errDetail && typeof errDetail === 'object') {
            errDetail = errDetail.message || errDetail.error || JSON.stringify(errDetail);
        }
        assert.equal(errDetail, 'service unavailable');
    });

    it('pure logic: object error falls back to JSON.stringify when both absent', function() {
        var raw = { code: 503, reason: 'quota exceeded' };
        var errDetail = raw;
        if (errDetail && typeof errDetail === 'object') {
            errDetail = errDetail.message || errDetail.error || JSON.stringify(errDetail);
        }
        assert.equal(errDetail, JSON.stringify(raw));
    });

    it('pure logic: string error passes through unchanged', function() {
        var raw = 'plain string error';
        var errDetail = raw;
        if (errDetail && typeof errDetail === 'object') {
            errDetail = errDetail.message || errDetail.error || JSON.stringify(errDetail);
        }
        assert.equal(errDetail, 'plain string error');
    });

    it('pure logic: null/undefined error does not trigger normalization', function() {
        var errDetail = null;
        if (errDetail && typeof errDetail === 'object') {
            errDetail = errDetail.message || errDetail.error || JSON.stringify(errDetail);
        }
        assert.equal(errDetail, null);
    });

});


// ── 07 — Normal render exit paths: cache-hit and cache-miss (#H8-prereq) ─────

describe('07 - normal render exit paths: response.end() sites and guards', function() {

    var _src;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    // ── Cache-hit path ──────────────────────────────────────────────────

    it('cache-hit: res.end(htmlContent) exists on the cache-hit path', function() {
        var src = getSrc();
        // cache.get(cacheKey) is unique to the cache-HIT path (line 766); cache.has(cacheKey)
        // first appears on the cache-WRITE path (line 47) and would anchor the search wrong.
        // Window widened from 10000 → 12000 after slice 2 combined the
        // flow-late-entries patch with the new metrics late-bind in the
        // cache-hit branch (~500 chars added). Per inspector-server.md
        // "Source-scanning tests" gotcha: always recheck after substantial
        // code additions.
        var cacheGetIdx = src.indexOf('cache.get(cacheKey)');
        assert.ok(cacheGetIdx > -1, 'cache.get(cacheKey) not found');
        var block = src.substring(cacheGetIdx, cacheGetIdx + 12000);
        assert.ok(
            block.indexOf('res.end( htmlContent )') > -1,
            'expected res.end( htmlContent ) on cache-hit path'
        );
    });

    it('cache-hit: HEAD branch calls res.end() without body', function() {
        var src = getSrc();
        var cacheGetIdx = src.indexOf('cache.get(cacheKey)');
        var block = src.substring(cacheGetIdx, cacheGetIdx + 10000);
        // HEAD check pattern: /^HEAD$/i.test(req.method)
        assert.ok(
            /HEAD.*\.test\(req\.method\)/.test(block),
            'expected HEAD method check on cache-hit path'
        );
        // content-length set for HEAD
        assert.ok(
            block.indexOf("'content-length'") > -1,
            'expected content-length header set on HEAD cache-hit path'
        );
    });

    it('cache-hit: content-type header set before response', function() {
        var src = getSrc();
        var cacheGetIdx = src.indexOf('cache.get(cacheKey)');
        var endIdx = src.indexOf('res.end( htmlContent )', cacheGetIdx);
        var between = src.substring(cacheGetIdx, endIdx);
        assert.ok(
            between.indexOf("setHeader('content-type'") > -1,
            'expected content-type header set before .end() on cache-hit path'
        );
    });

    it('cache-hit: per-request refs nulled after response', function() {
        var src = getSrc();
        var cacheGetIdx = src.indexOf('cache.get(cacheKey)');
        var endIdx = src.indexOf('res.end( htmlContent )', cacheGetIdx);
        var after = src.substring(endIdx, endIdx + 500);
        assert.ok(after.indexOf('local.req = null') > -1, 'expected local.req = null after cache-hit .end()');
        assert.ok(after.indexOf('local.res = null') > -1, 'expected local.res = null after cache-hit .end()');
        assert.ok(after.indexOf('local.next = null') > -1, 'expected local.next = null after cache-hit .end()');
    });

    it('cache-hit: _next() called after cleanup', function() {
        var src = getSrc();
        var cacheGetIdx = src.indexOf('cache.get(cacheKey)');
        var endIdx = src.indexOf('res.end( htmlContent )', cacheGetIdx);
        // Window grew from 500 → 800 after the #M1 retrofit added an inline
        // explanation of the function-scoped captures pattern alongside the
        // closure-null cleanup. The pattern we want (`if (_next) return _next()`)
        // still sits in the same block, just further down the source.
        var after = src.substring(endIdx, endIdx + 800);
        assert.ok(
            /if\s*\(\s*_next\s*\)\s*return\s+_next\(\)/.test(after),
            'expected _next() call after cache-hit cleanup'
        );
    });

    // ── Cache-miss (fresh compile) path ─────────────────────────────────

    it('cache-miss: res.end(htmlContent) exists on the fresh-compile path', function() {
        var src = getSrc();
        // Find the second .end(htmlContent) — the first is cache-hit, second is cache-miss
        var first = src.indexOf('res.end( htmlContent )');
        assert.ok(first > -1, 'first res.end( htmlContent ) not found');
        var second = src.indexOf('res.end( htmlContent )', first + 1);
        assert.ok(second > -1, 'second res.end( htmlContent ) not found (cache-miss path)');
    });

    it('cache-miss: HEAD branch exists with content-length', function() {
        var src = getSrc();
        var first = src.indexOf('res.end( htmlContent )');
        var second = src.indexOf('res.end( htmlContent )', first + 1);
        // Look for HEAD check before the second .end(htmlContent).
        // Window widened 3000 -> 3400 for #H10 (trailer wiring added ~7 lines in the
        // cache-miss HTTP/2 body branch; the HEAD check now sits ~3205 chars back).
        var before = src.substring(second - 3400, second);
        assert.ok(
            /HEAD.*\.test\(req\.method\)/.test(before),
            'expected HEAD method check on cache-miss path'
        );
    });

    it('cache-miss: per-request refs nulled after response', function() {
        var src = getSrc();
        var first = src.indexOf('res.end( htmlContent )');
        var second = src.indexOf('res.end( htmlContent )', first + 1);
        var after = src.substring(second, second + 500);
        assert.ok(after.indexOf('local.req = null') > -1, 'expected local.req = null after cache-miss .end()');
        assert.ok(after.indexOf('local.res = null') > -1, 'expected local.res = null after cache-miss .end()');
    });

    // ── Fallthrough error path ─────────────────────────���────────────────

    it('fallthrough: safety-net .end() with error message', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf("res.end('Unexpected controller error while trying to render.')") > -1,
            'expected fallthrough safety-net .end() with error message'
        );
    });

    it('fallthrough: per-request refs nulled after safety-net', function() {
        var src = getSrc();
        var idx = src.indexOf("res.end('Unexpected controller error");
        var after = src.substring(idx, idx + 500);
        assert.ok(after.indexOf('local.req = null') > -1, 'expected local.req = null after fallthrough .end()');
        assert.ok(after.indexOf('local.res = null') > -1, 'expected local.res = null after fallthrough .end()');
    });

    // ── Total .end() count ──────────────────────────────────────────────

    it('exactly 5 res.end() calls in the file', function() {
        var src = getSrc();
        // Word-boundary anchor since `res` is now used as the function-scoped
        // capture name (no `local.` prefix to disambiguate).
        var matches = src.match(/\bres\.end\s*\(/g);
        assert.ok(matches, 'no res.end() calls found');
        assert.strictEqual(matches.length, 5, 'expected exactly 5 res.end() calls (2 HEAD + 2 body + 1 fallthrough)');
    });

    it('zero res.write() calls — all writes use .end(body)', function() {
        var src = getSrc();
        // Strip comments
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(
            !/\bres\.write\(/.test(stripped),
            'expected no res.write() — all responses should use .end(body) for HTTP/2 compatibility'
        );
    });

});


// ── 08 — Error exit paths: throwError sites and early returns (#H8-prereq) ───

describe('08 - error exit paths: throwError calls and early returns', function() {

    var _src;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    it('upstream non-2xx interception: return self.throwError(errorObject)', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('return self.throwError(errorObject)') > -1,
            'expected return self.throwError(errorObject) for upstream error interception'
        );
    });

    it('non-2xx interception guarded by status not starting with 2', function() {
        var src = getSrc();
        assert.ok(
            /String\(data\.page\.data\.status\)\.startsWith\('2'\)/.test(src),
            'expected status.startsWith("2") guard for non-2xx interception'
        );
    });

    it('non-2xx interception requires data.page.data.error to be defined', function() {
        var src = getSrc();
        var interceptIdx = src.indexOf('return self.throwError(errorObject)');
        var before = src.substring(Math.max(0, interceptIdx - 3500), interceptIdx);
        assert.ok(
            before.indexOf("data.page.data.error") > -1,
            'expected data.page.data.error check before interception'
        );
    });

    it('template not found: throwError + return', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf("fs.existsSync(path)") > -1,
            'expected fs.existsSync(path) check for template existence'
        );
        // throwError with ApiError followed by return
        var tplCheckIdx = src.indexOf("!fs.existsSync(path)");
        assert.ok(tplCheckIdx > -1, '!fs.existsSync(path) not found');
        var block = src.substring(tplCheckIdx, tplCheckIdx + 1000);
        assert.ok(
            /self\.throwError\(err\)\s*;[\s\S]*?return\s*;/.test(block),
            'expected self.throwError(err); return; after template not found'
        );
    });

    it('swig filter exception: throwError + return', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('[SwigFilters]') > -1,
            'expected [SwigFilters] error message in throwError call'
        );
    });

    it('layout not found: throwError + return', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('could not locate the file') > -1,
            'expected layout not found error message'
        );
    });

    it('data blacklist escaping failure: throwError + return', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('compilation error') > -1,
            'expected compilation error message for blacklist escaping failure'
        );
    });

    it('getAssets failure: throwError + return', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('calling getAssets') > -1,
            'expected getAssets error message in throwError call'
        );
    });

    it('deferred error object forwarding: return self.throwError(req.params.errorObject)', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('return self.throwError(req.params.errorObject)') > -1,
            'expected deferred error object forwarding'
        );
    });

    it('catch-all: return self.throwError(res, 500, err)', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('return self.throwError(res, 500, err)') > -1,
            'expected catch-all throwError at the end of the try block'
        );
    });

    it('catch-all is in a catch block', function() {
        var src = getSrc();
        var catchAllIdx = src.indexOf('return self.throwError(res, 500, err)');
        var before = src.substring(Math.max(0, catchAllIdx - 100), catchAllIdx);
        assert.ok(
            /\}\s*catch\s*\(err\)\s*\{/.test(before),
            'expected catch(err) block before the catch-all throwError'
        );
    });

    it('rendering stack guard: return false when length > 1', function() {
        var src = getSrc();
        assert.ok(
            /renderingStack\.length\s*>\s*1/.test(src),
            'expected renderingStack.length > 1 guard'
        );
        // Must return false
        var guardIdx = src.indexOf('renderingStack.length > 1');
        var block = src.substring(guardIdx, guardIdx + 200);
        assert.ok(
            block.indexOf('return false') > -1,
            'expected return false after rendering stack guard'
        );
    });

    it('CVE-2023-25345 path traversal throw', function() {
        var src = getSrc();
        assert.ok(
            src.indexOf('[CVE-2023-25345] Path traversal attempt blocked') > -1,
            'expected CVE-2023-25345 path traversal throw'
        );
    });

});


// ── 09 — Guard patterns: headersSent, HEAD, stream variable (#H8-prereq) ────

describe('09 - guard patterns: headersSent, HEAD, stream setup', function() {

    var _src;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    it('headersSent() guard exists on cache-hit path', function() {
        var src = getSrc();
        var cacheGetIdx = src.indexOf('cache.get(cacheKey)');
        var block = src.substring(cacheGetIdx, cacheGetIdx + 4000);
        assert.ok(
            /if\s*\(\s*!headersSent\(\)\s*\)/.test(block),
            'expected !headersSent() guard on cache-hit path'
        );
    });

    it('headersSent() guard exists on cache-miss path', function() {
        var src = getSrc();
        // The cache-miss path headersSent guard is after the swig.compile section
        var compileIdx = src.indexOf('swig.compile(');
        assert.ok(compileIdx > -1, 'swig.compile not found');
        var block = src.substring(compileIdx, compileIdx + 5000);
        assert.ok(
            /if\s*\(\s*!headersSent\(\)\s*\)/.test(block),
            'expected !headersSent() guard on cache-miss path'
        );
    });

    it('stream variable set up from res.stream', function() {
        var src = getSrc();
        assert.ok(
            /stream\s*=\s*res\.stream/.test(src),
            'expected stream = res.stream assignment'
        );
    });

    it('stream variable initialized to null', function() {
        var src = getSrc();
        assert.ok(
            /,\s*stream\s*=\s*null/.test(src),
            'expected stream = null initialization'
        );
    });

    it('3 cleanup blocks with local.req/res/next = null', function() {
        var src = getSrc();
        var matches = src.match(/local\.req\s*=\s*null\s*;\s*\n\s*local\.res\s*=\s*null/g);
        assert.ok(matches, 'no cleanup blocks found');
        assert.strictEqual(matches.length, 3, 'expected exactly 3 cleanup blocks (cache-hit, cache-miss, fallthrough)');
    });

    it('_next alias pattern used (not direct local.next())', function() {
        var src = getSrc();
        // Post-retrofit shape (#M1 race-fix): _next is captured ONCE at the top
        // of render() from local.next, then used at each terminal exit. Pre-retrofit
        // the file had 3 redundant `var _next = local.next` captures (one per
        // exit block); those are now consolidated into the single top-of-render
        // capture, with terminal exits relying on the function-scoped _next.
        var matches = src.match(/var _next\s*=.*local\.next/g);
        assert.ok(matches && matches.length >= 1, 'expected at least 1 _next capture from local.next at top of render()');
        // _next must still be invoked at terminal exits (the `if (_next) return _next()` pattern).
        var invokes = src.match(/if\s*\(\s*_next\s*\)\s*return\s+_next\(\)/g);
        assert.ok(invokes && invokes.length >= 3, 'expected at least 3 `if (_next) return _next()` terminal-exit invocations');
    });

    it('isRenderingCustomError flag cleared on cache-hit and cache-miss paths', function() {
        var src = getSrc();
        var matches = src.match(/localOptions\.isRenderingCustomError\s*=\s*false/g);
        assert.ok(matches && matches.length >= 2, 'expected isRenderingCustomError = false on at least 2 paths');
    });

});


// ── 10 — HTTP/2 readiness: commented blocks and render-json.js patterns (#H8) ─

describe('10 - HTTP/2 direct stream implementation (#H8)', function() {

    var _src, _jsonSrc;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }
    function getJsonSrc() {
        if (!_jsonSrc) {
            var jsonPath = path.join(path.dirname(SOURCE), 'controller.render-json.js');
            _jsonSrc = fs.readFileSync(jsonPath, 'utf8');
        }
        return _jsonSrc;
    }
    function stripComments(s) { return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); }

    // ── Commented HTTP/2 blocks exist ──────────────────────────���─────────

    it('5 active stream.respond() calls (2 HEAD + 2 body + 1 error)', function() {
        var stripped = stripComments(getSrc());
        var matches = stripped.match(/stream\.respond\(/g);
        assert.ok(matches, 'no active stream.respond() found');
        assert.strictEqual(matches.length, 5, 'expected 5 stream.respond() calls');
    });

    it('5 active stream.end() calls (2 HEAD + 2 body + 1 error)', function() {
        var stripped = stripComments(getSrc());
        var matches = stripped.match(/stream\.end\(/g);
        assert.ok(matches, 'no active stream.end() found');
        assert.strictEqual(matches.length, 5, 'expected 5 stream.end() calls');
    });

    // ── All 5 patterns from render-json.js are now present ───────────────

    it('stream.destroyed guard exists in active code (3 response-path + 2 trailer-callback guards)', function() {
        var stripped = stripComments(getSrc());
        var matches = stripped.match(/stream\.destroyed/g);
        assert.ok(matches, 'no stream.destroyed guard found');
        // 3 response-path guards (cache-hit body, cache-miss body, error) + 2 #H10
        // trailer-callback guards (cache-hit + cache-miss wantTrailers handlers).
        assert.strictEqual(matches.length, 5, 'expected 5 stream.destroyed guards (3 response-path + 2 trailer-callback)');
    });

    it('res.getHeaders merge exists in active code (5 paths)', function() {
        var stripped = stripComments(getSrc());
        // Word-boundary anchor since `res` is now the function-scoped capture
        // name (no `local.` prefix to disambiguate from other identifiers).
        var matches = stripped.match(/\bres\.getHeaders/g);
        assert.ok(matches, 'no res.getHeaders found');
        assert.ok(matches.length >= 5, 'expected at least 5 getHeaders merges (2 HEAD + 2 body + 1 error)');
    });

    it('res.headersSent = true assignment exists in active code (5 paths)', function() {
        var stripped = stripComments(getSrc());
        var matches = stripped.match(/\bres\.headersSent\s*=\s*true/g);
        assert.ok(matches, 'no res.headersSent = true found');
        assert.strictEqual(matches.length, 5, 'expected 5 headersSent = true assignments');
    });

    it('dynamic :status from res.statusCode || 200 in body/HEAD paths', function() {
        var stripped = stripComments(getSrc());
        var matches = stripped.match(/\bres\.statusCode\s*\|\|\s*200/g);
        assert.ok(matches, 'no dynamic :status found');
        assert.strictEqual(matches.length, 4, 'expected 4 dynamic :status (2 HEAD + 2 body, error uses hardcoded 500)');
    });

    it('hardcoded :status 500 in error fallthrough path', function() {
        var src = getSrc();
        var errFallthru = src.indexOf("stream.end('Unexpected controller error");
        assert.ok(errFallthru > -1, 'error fallthrough stream.end() not found');
        var block = src.substring(Math.max(0, errFallthru - 500), errFallthru);
        assert.ok(
            /':status'\s*:\s*500/.test(block),
            'expected :status 500 before error stream.end()'
        );
    });

    it('!stream.headersSent check before every stream.respond() (5 paths)', function() {
        var stripped = stripComments(getSrc());
        var matches = stripped.match(/!stream\.headersSent/g);
        assert.ok(matches, 'no !stream.headersSent found');
        assert.strictEqual(matches.length, 5, 'expected 5 !stream.headersSent checks');
    });

    // ── Pattern parity with render-json.js ──────────────────────────────

    it('render-swig.js now matches render-json.js stream patterns', function() {
        var swigStripped = stripComments(getSrc());
        var jsonStripped = stripComments(getJsonSrc());
        assert.ok(swigStripped.indexOf('stream.destroyed') > -1, 'render-swig.js must have stream.destroyed');
        assert.ok(jsonStripped.indexOf('stream.destroyed') > -1, 'render-json.js must have stream.destroyed');
        assert.ok(swigStripped.indexOf('.getHeaders') > -1, 'render-swig.js must merge pending headers');
        assert.ok(jsonStripped.indexOf('.getHeaders') > -1, 'render-json.js must merge pending headers');
        assert.ok(/headersSent\s*=\s*true/.test(swigStripped), 'render-swig.js must set headersSent = true');
        assert.ok(/headersSent\s*=\s*true/.test(jsonStripped), 'render-json.js must set headersSent = true');
    });

    // ── HTTP/1.1 fallback preserved ─────────────────────────────────────

    it('res.end() calls preserved for HTTP/1.1 fallback', function() {
        var src = getSrc();
        // Word-boundary anchor: `res` is the function-scoped capture name.
        var matches = src.match(/\bres\.end\s*\(/g);
        assert.ok(matches, 'no res.end() found');
        assert.strictEqual(matches.length, 5, 'expected 5 res.end() calls for HTTP/1.1 fallback');
    });

    // ── Pure logic: patterns that #H8 must implement ────────────────────

    it('pure logic: destroyed stream guard prevents ERR_HTTP2_INVALID_STREAM', function() {
        // Replicate the guard from render-json.js
        var stream = { destroyed: true, closed: false, respond: function() { throw new Error('should not call'); }, end: function() { throw new Error('should not call'); } };
        var called = false;
        if (stream.destroyed || stream.closed) {
            called = true; // guard triggers — skip response
        }
        assert.ok(called, 'destroyed stream must trigger the guard');
    });

    it('pure logic: pending headers merge preserves CORS headers', function() {
        // Replicate the getHeaders merge from render-json.js
        var _streamHeaders = { 'content-type': 'text/html', ':status': 200 };
        var _pendingHeaders = {
            'access-control-allow-origin': '*',
            'x-custom': 'value'
        };
        for (var k in _pendingHeaders) {
            if (!(k in _streamHeaders)) _streamHeaders[k] = _pendingHeaders[k];
        }
        assert.strictEqual(_streamHeaders['access-control-allow-origin'], '*');
        assert.strictEqual(_streamHeaders['x-custom'], 'value');
        // content-type must not be overridden
        assert.strictEqual(_streamHeaders['content-type'], 'text/html');
    });

    it('pure logic: dynamic :status uses res.statusCode', function() {
        var res = { statusCode: 404 };
        var status = res.statusCode || 200;
        assert.strictEqual(status, 404, ':status must use statusCode when set');
    });

    it('pure logic: :status defaults to 200 when statusCode is 0 or undefined', function() {
        var res1 = { statusCode: 0 };
        var res2 = {};
        assert.strictEqual(res1.statusCode || 200, 200, ':status must default to 200 for statusCode=0');
        assert.strictEqual(res2.statusCode || 200, 200, ':status must default to 200 for undefined statusCode');
    });

});


// 11 — Layout cache uses atomic temp+rename to avoid ENOENT under concurrent renders
//
// In dev mode (_cacheIsEnabled !== 'true'), two concurrent renders of the
// same template (via `{% extends "layout.html" %}`) used to race because the
// priming block deleted the cached layout file (rmSync) before rewriting it,
// opening a gap window where a parallel render could observe the file as
// absent at the readFile call ~340 lines below. Atomic temp+rename closes
// the gap — readers always see the previous content or the new content,
// never an absent file.
describe('11 - layout cache atomic temp+rename (race fix, 2026-05-11)', function() {

    it('priming block: no rmSync on newLayoutFilename (race surface removed)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        // Strip both line and block comments before checking — the leading
        // comment of the new block describes the old rmSync pattern.
        var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/fs\.rmSync\(\s*newLayoutFilename/.test(stripped),
            'fs.rmSync(newLayoutFilename) was reintroduced — the race fix was reverted'
        );
    });

    it('priming block: writeFile target is a temp file, then rename onto newLayoutFilename', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /await\s+fs\.promises\.writeFile\(\s*_layoutTmp\s*,\s*buffer\s*\)/.test(src),
            'expected `await fs.promises.writeFile(_layoutTmp, buffer)` at the priming block'
        );
        assert.ok(
            /await\s+fs\.promises\.rename\(\s*_layoutTmp\s*,\s*newLayoutFilename\s*\)/.test(src),
            'expected `await fs.promises.rename(_layoutTmp, newLayoutFilename)` at the priming block'
        );
    });

    it('post-asset-injection write: writeFile target is a temp file, then rename onto newLayoutFilename', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /await\s+fs\.promises\.writeFile\(\s*_layoutTmpAssets\s*,\s*layout\s*\)/.test(src),
            'expected `await fs.promises.writeFile(_layoutTmpAssets, layout)` at the post-asset write'
        );
        assert.ok(
            /await\s+fs\.promises\.rename\(\s*_layoutTmpAssets\s*,\s*newLayoutFilename\s*\)/.test(src),
            'expected `await fs.promises.rename(_layoutTmpAssets, newLayoutFilename)` at the post-asset write'
        );
    });

    it('temp file names embed process.pid, Date.now(), and Math.random() for collision-safety', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        // Two temp-file derivations are expected, both anchored on
        // newLayoutFilename + '.tmp.' — pin the pattern by counting matches
        // and asserting each carries pid/time/random.
        var matches = src.match(/newLayoutFilename\s*\+\s*'\.tmp\.'\s*\+\s*process\.pid\s*\+\s*'\.'\s*\+\s*Date\.now\(\)\s*\+\s*'\.'\s*\+\s*Math\.random\(\)/g);
        assert.ok(
            matches && matches.length >= 2,
            'expected two temp-file derivations (priming + post-asset) both embedding pid + Date.now() + Math.random()'
        );
    });

    it('CVE-2023-25345 boundary check preserved verbatim at the priming block', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /\[CVE-2023-25345\] Path traversal attempt blocked in \{% extends %\}/.test(src),
            'CVE-2023-25345 throw guard must be preserved'
        );
        assert.ok(
            /nodePath\.resolve\(_layoutTemplateRoot,\s*layoutPath\)/.test(src),
            'CVE-2023-25345 boundary resolve must be preserved'
        );
        assert.ok(
            /!_layoutResolvedPath\.startsWith\(_layoutTemplateRoot \+ '\/'\)/.test(src),
            'CVE-2023-25345 startsWith guard must be preserved'
        );
    });

    // Behavior test: run the atomic-rename pattern under concurrent load and
    // verify 0 ENOENT failures. The harness extracts the pattern from the
    // source fix; the source pins above guarantee the source file uses this
    // pattern. Race tests are stochastic so we run several iterations; with
    // the atomic pattern, 0 failures is the deterministic outcome regardless
    // of timing.
    it('behavior: 0 ENOENT across 200 concurrent atomic writes (10 iter × 20)', { timeout: 60000 }, async function() {
        var os       = require('os');
        var nodePath = require('path');
        var ROOT     = nodePath.join(os.tmpdir(), 'gina-render-swig-race-' + process.pid + '-' + Date.now());
        var SRC      = nodePath.join(ROOT, 'source', 'layout.html');
        var TARGET   = nodePath.join(ROOT, 'cache',  'layout.html');
        var CONTENT  = '<!doctype html><html>{% block content %}{% endblock %}</html>\n';

        fs.mkdirSync(nodePath.dirname(SRC),    { recursive: true });
        fs.mkdirSync(nodePath.dirname(TARGET), { recursive: true });
        fs.writeFileSync(SRC, CONTENT);

        async function atomicWrite() {
            var buf = await fs.promises.readFile(SRC);
            var tmp = TARGET + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2);
            await fs.promises.writeFile(tmp, buf);
            await fs.promises.rename(tmp, TARGET);
        }

        // Approximates one render in dev mode: pre-block async work to
        // create natural stagger (the request-lifecycle awaits before the
        // racy block), the atomic write, ~340 lines of sync intervening
        // work, then the racy readFile.
        async function render() {
            for (var k = 0; k < 5; k++) await Promise.resolve();
            await atomicWrite();
            var sink = 0;
            for (var i = 0; i < 5000000; i++) sink += i;
            return await fs.promises.readFile(TARGET, 'utf8');
        }

        var ITER = 10;
        var N    = 20;
        var fails = [];

        try {
            for (var iter = 0; iter < ITER; iter++) {
                var promises = [];
                for (var i = 0; i < N; i++) {
                    promises.push(new Promise(function(resolve) {
                        setTimeout(function() {
                            render().then(
                                function() { resolve(null); },
                                function(err) { resolve({ code: err.code, message: err.message }); }
                            );
                        }, Math.floor(Math.random() * 30));
                    }));
                }
                var results = await Promise.all(promises);
                for (var r = 0; r < results.length; r++) {
                    if (results[r]) fails.push(results[r]);
                }
            }
        } finally {
            try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}
        }

        assert.strictEqual(
            fails.length, 0,
            'expected 0 failures across ' + (ITER * N) + ' concurrent atomic writes — saw ' + fails.length + ' (codes: ' + JSON.stringify(fails.map(function(f) { return f.code; })) + ')'
        );
    });

});


// ─── 12 — Function-scoped captures of per-request refs (#M1 race fix) ────────
//
// The exported render() is async. Between awaits, the controller's `local`
// closure can have its `req` / `res` / `next` properties nulled by another
// code path — most commonly throwError's generic-error fallthrough that
// runs when a second throwError fires after renderCustomError already
// started this render. Pre-retrofit, render-swig.js read `local.req` /
// `local.res` / `local.next` directly throughout, so any post-await read
// after such a null-out crashed with `Cannot read properties of null
// (reading 'method')` at the first such site.
//
// The retrofit captures `local.req` / `local.res` / `local.next` into
// function-scoped `var req` / `var res` / `var _next` at the very top of
// render() (immediately after the deps unpack, before any await), then
// uses those captures for every post-deps read. The closure properties
// are still nulled at terminal exits for early per-request memory release.

describe('12 - function-scoped captures of per-request refs (#M1 race fix)', function() {

    var _src;
    function getSrc() { return _src || (_src = fs.readFileSync(SOURCE, 'utf8')); }

    // ── (a) source structure: captures at top of render() ───────────────

    it("render() body captures `var req = local.req` after the deps unpack", function() {
        var src = getSrc();
        var renderIdx = src.indexOf('module.exports = async function render');
        assert.ok(renderIdx > -1, 'render() exported declaration not found');
        // Window from render() declaration to the first `await` — this is the
        // synchronous prologue where the captures must live to be set before
        // any yield point that another path could exploit to null the closure.
        // Use the first CODE await (fs.promises is unambiguously code; the
        // word `await` also appears in the doc comment about "await boundaries"
        // which we must skip).
        var awaitIdx = src.indexOf('await fs.promises.', renderIdx);
        assert.ok(awaitIdx > -1, 'first await fs.promises in render() not found');
        var prologue = src.substring(renderIdx, awaitIdx);
        assert.ok(
            /var\s+req\s*=\s*local\.req\s*;/.test(prologue),
            'expected `var req = local.req;` capture before any await in render()'
        );
    });

    it("render() body captures `var res = local.res` after the deps unpack", function() {
        var src = getSrc();
        var renderIdx = src.indexOf('module.exports = async function render');
        var awaitIdx  = src.indexOf('await fs.promises.', renderIdx);
        var prologue  = src.substring(renderIdx, awaitIdx);
        assert.ok(
            /var\s+res\s*=\s*local\.res\s*;/.test(prologue),
            'expected `var res = local.res;` capture before any await in render()'
        );
    });

    it("render() body captures `var _next = local.next` after the deps unpack", function() {
        var src = getSrc();
        var renderIdx = src.indexOf('module.exports = async function render');
        var awaitIdx  = src.indexOf('await fs.promises.', renderIdx);
        var prologue  = src.substring(renderIdx, awaitIdx);
        assert.ok(
            /var\s+_next\s*=\s*local\.next\s*;/.test(prologue),
            'expected `var _next = local.next;` capture before any await in render()'
        );
    });

    it("captures come AFTER `local = deps.local;` so they read the populated closure", function() {
        var src = getSrc();
        var depsIdx    = src.indexOf('local           = deps.local;');
        var captureIdx = src.indexOf('var req         = local.req;');
        assert.ok(depsIdx > -1, '`local = deps.local;` deps assignment not found');
        assert.ok(captureIdx > -1, '`var req = local.req;` capture not found');
        assert.ok(
            captureIdx > depsIdx,
            'captures must come AFTER `local = deps.local;` so `local` is populated when read'
        );
    });

    // ── (b) source structure: writeCache signature takes req, res params ─

    it('writeCache signature includes `req, res` parameters', function() {
        var src = getSrc();
        assert.ok(
            /async\s+function\s+writeCache\s*\(\s*bundle\s*,\s*opt\s*,\s*htmlContent\s*,\s*req\s*,\s*res\s*\)/.test(src),
            'writeCache must take `bundle, opt, htmlContent, req, res` — req/res are render()-captured copies (race-safe)'
        );
    });

    it('writeCache call sites pass `req, res` (no falling back to closure reads inside writeCache)', function() {
        var src = getSrc();
        var matches = src.match(/await\s+writeCache\([^)]*,\s*req\s*,\s*res\s*\)/g);
        assert.ok(matches && matches.length >= 2, 'expected at least 2 `writeCache(..., req, res)` call sites (cache-write + post-asset-injection)');
    });

    // ── (c) source structure: terminal exits still null the CLOSURE ─────

    it("terminal exits null local.req / local.res / local.next on the closure (early memory release)", function() {
        var src = getSrc();
        // The block-style null trio must appear exactly 3 times — once per
        // terminal exit (cache-hit, cache-miss, fallthrough). Renaming
        // these to `req = null` etc. would be a regression (the function-
        // scoped captures are GC'd on return anyway; nulling the closure
        // releases the per-request payload earlier while the controller
        // instance may still be alive via pending event listeners).
        var matches = src.match(/local\.req\s*=\s*null\s*;\s*\n\s*local\.res\s*=\s*null\s*;\s*\n\s*local\.next\s*=\s*null\s*;/g);
        assert.ok(matches, 'no closure-nulling blocks found');
        assert.strictEqual(matches.length, 3, 'expected exactly 3 closure-nulling blocks (cache-hit + cache-miss + fallthrough)');
    });

    // ── (d) negative invariant: no post-deps `local.req` / `local.res`
    //     reads (apart from the captures and the terminal-exit nulling) ───

    it('no `local.req` reads remain outside the capture line and the terminal-exit nulling', function() {
        var src = getSrc();
        // Strip comments so commented-out historical code does not match.
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.req\b/g) || [];
        // Allowed: `var req = local.req;` (1×) + `local.req = null;` (3×) = 4
        assert.strictEqual(
            allReads.length, 4,
            'expected exactly 4 `local.req` references in active code (1 capture + 3 closure-nulls), found ' + allReads.length
        );
    });

    it('no `local.res` reads remain outside the capture line and the terminal-exit nulling', function() {
        var src = getSrc();
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.res\b/g) || [];
        assert.strictEqual(
            allReads.length, 4,
            'expected exactly 4 `local.res` references in active code (1 capture + 3 closure-nulls), found ' + allReads.length
        );
    });

    it('no `local.next` reads remain outside the capture line and the terminal-exit nulling', function() {
        var src = getSrc();
        var stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var allReads = stripped.match(/local\.next\b/g) || [];
        assert.strictEqual(
            allReads.length, 4,
            'expected exactly 4 `local.next` references in active code (1 capture + 3 closure-nulls), found ' + allReads.length
        );
    });

    // ── (e) pure-logic replica: race-safety property ────────────────────
    //
    // Simulates the exact race shape: a captured `req` reference must
    // continue to point at the original req object even after the closure
    // property is nulled. This is the property the retrofit relies on.

    it('captured `req` survives `local.req = null` (function-scoped vs closure-scoped)', function() {
        // Simulate the shape of the controller's per-request closure
        var local = { req: { method: 'POST', url: '/x' }, res: {}, next: function() {} };
        // Capture function-scoped refs (mirrors `var req = local.req;` in render())
        var req = local.req;
        var res = local.res;
        var _next = local.next;
        // External path nulls the closure properties (mirrors throwError's
        // generic-error fallthrough at controller.js:5342-5344).
        local.req = null;
        local.res = null;
        local.next = null;
        // Pre-retrofit: `local.req.method.toLowerCase()` would have thrown
        // "Cannot read properties of null (reading 'method')". Post-retrofit:
        // the captured `req` still references the original object.
        assert.equal(req.method, 'POST', 'captured req survives the closure null-out');
        assert.equal(req.url, '/x', 'captured req object is still the same reference');
        assert.notEqual(res, null, 'captured res survives the closure null-out');
        assert.equal(typeof _next, 'function', 'captured _next survives the closure null-out');
    });

    it('repro of the original crash: `local.req.method.toLowerCase()` after null-out throws TypeError', function() {
        // This is the EXACT pre-retrofit access at render-swig.js:467.
        // Locks the failure mode the retrofit eliminates: any post-await
        // read via `local.req.X` crashes when `local.req` was nulled.
        var local = { req: { method: 'GET' } };
        local.req = null;
        assert.throws(
            function() {
                /* eslint-disable no-unused-vars */
                var x = typeof(local.req[ local.req.method.toLowerCase() ]);
                /* eslint-enable no-unused-vars */
            },
            /Cannot read prop(erty|erties).+null.+(reading\s+'method'|of\s+null)/,
            'pre-retrofit access pattern must throw TypeError on null local.req'
        );
    });

    it('post-retrofit: the same access via the captured `req` does NOT throw', function() {
        var local = { req: { method: 'GET', get: { debug: 'true' } } };
        var req = local.req;
        // External null-out (the race window — `req` capture is unaffected).
        local.req = null;
        // Mirrors line 467's cacheless-debug detection (the canonical crash site).
        var value = typeof(req[ req.method.toLowerCase() ]);
        assert.equal(value, 'object', 'captured `req[method]` returns the per-method bucket — no TypeError on null');
    });

});


// 13 — HTTP/2 response trailers (#H10)
describe('13 - HTTP/2 response trailers (#H10)', function() {

    function src() { return fs.readFileSync(SOURCE, 'utf8'); }

    it('captures _trailers from local._trailers', function() {
        assert.ok(/var _trailers\s*=.*local\._trailers/.test(src()), 'expected _trailers capture from local._trailers');
    });

    it('wires waitForTrailers + wantTrailers + sendTrailers (#H10 marker present)', function() {
        var s = src();
        assert.ok(s.indexOf('#H10') > -1, 'expected #H10 marker');
        assert.ok(s.indexOf('waitForTrailers') > -1, 'expected waitForTrailers');
        assert.ok(s.indexOf("'wantTrailers'") > -1, 'expected wantTrailers listener');
        assert.ok(s.indexOf('sendTrailers') > -1, 'expected sendTrailers call');
    });

    it('wires trailers on BOTH body paths (cache-hit + cache-miss), each gated on if (_trailers)', function() {
        var s = src();
        assert.ok(/stream\.respond\(_streamHeaders,\s*_trailers\s*\?/.test(s),  'expected conditional respond on the cache-hit body path');
        assert.ok(/stream\.respond\(_streamHeaders2,\s*_trailers\s*\?/.test(s), 'expected conditional respond on the cache-miss body path');
        var ifMatches = s.match(/if\s*\(\s*_trailers\s*\)/g) || [];
        assert.ok(ifMatches.length >= 2, 'expected an `if (_trailers)` gate on each body path');
    });

    it('does not add extra stream.respond() calls — single-conditional-arg form keeps the 5-path count (section 10)', function() {
        // The trailer wiring uses stream.respond(headers, _trailers ? {...} : undefined),
        // so each path still has exactly one respond() call; section 10 pins the total at 5.
        var stripped = src().replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var matches = stripped.match(/stream\.respond\(/g) || [];
        assert.strictEqual(matches.length, 5, 'expected 5 stream.respond() calls — trailers must not add respond calls');
    });
});


// 14 — CSP nonce on framework-injected inline scripts (#HDR5)
describe('14 - CSP nonce: onGinaLoaded bootstrap carries req._ginaCspNonce', function() {

    function src() { return fs.readFileSync(SOURCE, 'utf8'); }

    it('captures _cspNonce from req._ginaCspNonce', function() {
        assert.ok(
            /var _cspNonce\s*=\s*\(req && req\._ginaCspNonce\)\s*\?\s*req\._ginaCspNonce\s*:\s*null/.test(src()),
            'expected _cspNonce captured from req._ginaCspNonce'
        );
    });

    it('defines the _nonceLoader helper that stamps the bootstrap <script> (#HDR5)', function() {
        var s = src();
        assert.ok(/var _nonceLoader\s*=\s*function/.test(s), 'expected the _nonceLoader helper');
        assert.ok(s.indexOf('#HDR5') > -1, 'expected #HDR5 marker');
        assert.ok(
            /'<script type="text\/javascript" nonce="'\s*\+\s*_cspNonce\s*\+\s*'">'/.test(s),
            'expected the nonce attribute injected into the bootstrap script tag'
        );
    });

    it('routes every ginaLoader injection site through _nonceLoader()', function() {
        var s = src();
        var direct  = s.match(/localOptions\.template\.ginaLoader/g) || [];
        var wrapped = s.match(/_nonceLoader\(localOptions\.template\.ginaLoader\)/g) || [];
        assert.ok(wrapped.length >= 3, 'expected all 3 ginaLoader injection sites wrapped in _nonceLoader()');
        assert.strictEqual(direct.length, wrapped.length,
            'every localOptions.template.ginaLoader occurrence should be inside a _nonceLoader() call');
    });

    // pure-logic replica of the _nonceLoader transform
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

    it('replica: injects the nonce attribute when a nonce is present (base64 chars allowed)', function() {
        var out = nonceLoader(LOADER, 'ABC+/=');
        assert.ok(out.indexOf('<script type="text/javascript" nonce="ABC+/=">') > -1);
        assert.strictEqual(out.indexOf('<script type="text/javascript">'), -1,
            'the bare opening tag should be rewritten');
    });

    it('replica: returns the loader unchanged when no nonce (back-compat)', function() {
        assert.strictEqual(nonceLoader(LOADER, null), LOADER);
        assert.strictEqual(nonceLoader(LOADER, undefined), LOADER);
    });

    it('replica: only the opening tag is rewritten (closing </script> untouched)', function() {
        var out = nonceLoader(LOADER, 'XYZ');
        assert.ok(out.indexOf('</script>') > -1, 'closing tag preserved');
        assert.strictEqual((out.match(/<script/g) || []).length, 1, 'exactly one <script opening');
    });

});


// 15 — CSP nonce on the dev-only Inspector + metrics-patch inline scripts (#HDR16)
describe('15 - CSP nonce: dev-only Inspector + patch inline scripts', function() {

    function src() { return fs.readFileSync(SOURCE, 'utf8'); }

    it('derives _cspNonceAttr from the captured _cspNonce', function() {
        assert.ok(
            /var _cspNonceAttr\s*=\s*_cspNonce\s*\?\s*\(\s*' nonce="'\s*\+\s*_cspNonce\s*\+\s*'"'\s*\)\s*:\s*''/.test(src()),
            'expected _cspNonceAttr derived from _cspNonce'
        );
    });

    it('injects _cspNonceAttr into every framework-assembled inline <script> opening', function() {
        var nonced = (src().match(/'<script' \+ _cspNonceAttr \+ '>/g) || []);
        // __gdScript, __logsScript, _cachePatchScript, _patchScript = 4 dev-script sites
        assert.ok(nonced.length >= 4,
            'expected all 4 dev-script openings to carry _cspNonceAttr (got ' + nonced.length + ')');
    });

    it('leaves no bare framework-assembled <script> opening assignment', function() {
        var s = src();
        assert.ok(!/=\s*'<script>'/.test(s),          'no bare <script> assignment should remain');
        assert.ok(!/=\s*'<script>\(function/.test(s), 'no bare <script>(function assignment should remain');
        assert.ok(!/=\s*'<script>window/.test(s),     'no bare <script>window assignment should remain');
    });

    // pure-logic replica of the _cspNonceAttr fragment
    function nonceAttr(nonce) { return nonce ? (' nonce="' + nonce + '"') : ''; }

    it('replica: emits a nonce attribute when a nonce is present (base64 chars)', function() {
        assert.strictEqual(nonceAttr('AbC+/=='), ' nonce="AbC+/=="');
        assert.strictEqual('<script' + nonceAttr('AbC+/==') + '>', '<script nonce="AbC+/==">');
    });

    it('replica: emits nothing (back-compat bare tag) when no nonce', function() {
        assert.strictEqual(nonceAttr(null), '');
        assert.strictEqual('<script' + nonceAttr(null) + '>', '<script>');
        assert.strictEqual('<script' + nonceAttr(undefined) + '>', '<script>');
    });

});


// 16 — CSP nonce app-template helper: data.page.cspNonce + statusbar.html (#HDR16 follow-up)
describe('16 - CSP nonce: page.cspNonce template var + statusbar include', function() {

    function src() { return fs.readFileSync(SOURCE, 'utf8'); }

    var FW             = require('../fw');
    var STATUSBAR_SRC  = path.join(FW, 'core/asset/plugin/src/vendor/gina/inspector/html/statusbar.html');
    var STATUSBAR_DIST = path.join(FW, 'core/asset/plugin/dist/vendor/gina/html/statusbar.html');

    // ── data.page.cspNonce wiring (the application-template nonce helper) ──

    it('exposes the nonce on data.page.cspNonce, guarded so the key is absent when no nonce', function() {
        assert.ok(
            /if \(_cspNonce\) \{ data\.page\.cspNonce = _cspNonce; \}/.test(src()),
            'expected `if (_cspNonce) { data.page.cspNonce = _cspNonce; }` guard'
        );
    });

    it('sets data.page.cspNonce before BOTH compiledTemplate(data) sites (cache-hit + cache-miss)', function() {
        var s = src();
        var assigns = (s.match(/data\.page\.cspNonce = _cspNonce/g) || []);
        assert.strictEqual(assigns.length, 2,
            'expected exactly 2 data.page.cspNonce assignments — one before each compiledTemplate(data) call');
        // each assignment must immediately precede a compiledTemplate(data) call
        var paired = (s.match(/data\.page\.cspNonce = _cspNonce;[\s\S]{0,200}?htmlContent = compiledTemplate\(data\);/g) || []);
        assert.strictEqual(paired.length, 2,
            'expected both data.page.cspNonce assignments immediately before a compiledTemplate(data) call');
    });

    // ── statusbar.html — dev-only swig include carries the nonce attribute ──

    var NONCE_COND = '<script{% if page.cspNonce %} nonce="{{ page.cspNonce }}"{% endif %}>';

    it('dist statusbar.html OPENS with the page.cspNonce conditional (runtime include artifact)', function() {
        var dist = fs.readFileSync(STATUSBAR_DIST, 'utf8');
        assert.strictEqual(dist.indexOf(NONCE_COND), 0,
            'expected dist statusbar.html to open with the page.cspNonce conditional <script> tag');
    });

    it('src statusbar.html carries the same conditional', function() {
        var srcSb = fs.readFileSync(STATUSBAR_SRC, 'utf8');
        assert.strictEqual(srcSb.indexOf(NONCE_COND), 0,
            'expected src statusbar.html to open with the page.cspNonce conditional <script> tag');
    });

    it('src and dist statusbar.html are byte-identical (dist is a plain copy, not in build.json)', function() {
        var srcSb = fs.readFileSync(STATUSBAR_SRC, 'utf8');
        var dist  = fs.readFileSync(STATUSBAR_DIST, 'utf8');
        assert.strictEqual(srcSb, dist, 'src and dist statusbar.html must stay byte-identical');
    });

    it('statusbar.html JS body has no swig delimiters beyond the line-1 conditional (no collision)', function() {
        var dist = fs.readFileSync(STATUSBAR_DIST, 'utf8');
        // The only swig constructs are on line 1 ({% if %}, {{ }}, {% endif %});
        // the JS body must contain none or swig would try to interpret it.
        var body = dist.slice(dist.indexOf('\n'));
        assert.ok(!/\{\{|\}\}|\{%|%\}|\{#|#\}/.test(body),
            'statusbar.html JS body must contain no swig delimiters (template-processing collision)');
    });

    // ── pure-logic replica of the guarded page.cspNonce assignment ──

    function applyPageNonce(page, nonce) {
        if (nonce) { page.cspNonce = nonce; }
        return page;
    }

    it('replica: sets page.cspNonce when a nonce is present', function() {
        assert.strictEqual(applyPageNonce({}, 'AbC+/==').cspNonce, 'AbC+/==');
    });

    it('replica: leaves the key ABSENT when no nonce (back-compat for non-useNonce bundles)', function() {
        assert.ok(!('cspNonce' in applyPageNonce({}, null)),      'absent when null');
        assert.ok(!('cspNonce' in applyPageNonce({}, undefined)), 'absent when undefined');
    });

});
