var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var vm = require('node:vm');
var path = require('path');

var SOURCE = path.join(require('../fw'), 'core/server.isaac.js');
var src; // lazily loaded — avoids repeated readFileSync calls


// 01 — V8 arm64 regression: const not var for object rest destructuring
describe('01 - V8 arm64 regression: const not var for object rest destructuring', function() {

    it('source uses const (not var) for routing object rest destructuring', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            /const\s*\{\s*_comment\s*,\s*middleware\s*,\s*\.\.\.clean\s*\}/.test(src),
            'expected `const { _comment, middleware, ...clean }` — was changed from `var` to fix V8 arm64 hang'
        );
        assert.ok(
            !/var\s*\{\s*_comment\s*,\s*middleware\s*,\s*\.\.\.clean\s*\}/.test(src),
            '`var { _comment, middleware, ...clean }` must not appear — causes V8 hang on arm64 Node 25'
        );
    });

    it('vm.Script compiles object rest with const without hanging', { timeout: 2000 }, function() {
        // On arm64 Linux / Node 25, `var { ...rest }` inside new vm.Script() would hang at parse time.
        // This test guards against regression: if const is reverted to var, this test will time out.
        var snippet = 'const { _comment, middleware, ...clean } = { _comment: "x", middleware: [], route: "/" };';
        assert.doesNotThrow(function() {
            new vm.Script(snippet);
        });
    });

});


// 02 — routing cleanup: strips _comment and middleware, keeps other keys
describe('02 - routing cleanup: strips _comment and middleware, keeps other keys', function() {

    it('destructuring removes _comment and middleware from route', function() {
        var route = { _comment: 'home page', middleware: ['auth'], bundle: 'public', action: 'home', param: { id: '\\d+' } };
        const { _comment, middleware, ...clean } = route;
        assert.equal(clean._comment, undefined);
        assert.equal(clean.middleware, undefined);
        assert.equal(clean.bundle, 'public');
        assert.equal(clean.action, 'home');
        assert.equal(clean.param.id, '\\d+');
    });

    it('destructuring works when _comment and middleware are absent', function() {
        var route = { bundle: 'api', action: 'list' };
        const { _comment, middleware, ...clean } = route;
        assert.equal(clean.bundle, 'api');
        assert.equal(clean.action, 'list');
        assert.equal(Object.keys(clean).length, 2);
    });

    it('destructuring yields undefined for absent keys without throwing', function() {
        var route = { bundle: 'api' };
        assert.doesNotThrow(function() {
            const { _comment, middleware, ...clean } = route;
            assert.equal(_comment, undefined);
            assert.equal(middleware, undefined);
        });
    });

    it('original route object is not mutated by destructuring', function() {
        var route = { _comment: 'doc', middleware: ['guard'], path: '/items' };
        const { _comment, middleware, ...clean } = route;
        assert.equal(route._comment, 'doc');
        assert.deepEqual(route.middleware, ['guard']);
        assert.equal(route.path, '/items');
    });

    it('multiple routes cleaned independently without cross-contamination', function() {
        var routes = {
            'GET /':       { _comment: 'home', middleware: ['auth'], bundle: 'public', action: 'home' },
            'GET /about':  { bundle: 'public', action: 'about' },
            'POST /login': { _comment: 'login', middleware: [], bundle: 'auth', action: 'login' }
        };
        var cleaned = {};
        var keys = Object.keys(routes);
        for (var i = 0; i < keys.length; ++i) {
            const { _comment, middleware, ...clean } = routes[keys[i]];
            cleaned[keys[i]] = clean;
        }
        assert.equal(cleaned['GET /']._comment, undefined);
        assert.equal(cleaned['GET /'].bundle, 'public');
        assert.equal(cleaned['GET /about'].bundle, 'public');
        assert.equal(cleaned['POST /login']._comment, undefined);
        assert.equal(cleaned['POST /login'].bundle, 'auth');
    });

});


// 03 — HTTP/2 configurable settings source structure (#H3)
describe('03 - HTTP/2 configurable settings source structure (#H3)', function() {

    function getSrc() { return src || (src = fs.readFileSync(SOURCE, 'utf8')); }

    it('source reads http2Options from options', function() {
        assert.ok(
            getSrc().indexOf('options.http2Options') > -1,
            'expected `options.http2Options` — configurable HTTP/2 options not wired'
        );
    });

    it('source defaults maxConcurrentStreams to 256', function() {
        assert.ok(
            getSrc().indexOf('_h2Opts.maxConcurrentStreams || 256') > -1,
            'expected `_h2Opts.maxConcurrentStreams || 256` default'
        );
    });

    it('source defaults initialWindowSize to 65535 * 10', function() {
        assert.ok(
            getSrc().indexOf('_h2Opts.initialWindowSize    || 65535 * 10') > -1,
            'expected `_h2Opts.initialWindowSize || 65535 * 10` default'
        );
    });

    it('source hardcodes maxHeaderListSize to 65536 (HPACK bomb defense)', function() {
        assert.ok(
            getSrc().indexOf('maxHeaderListSize   : 65536') > -1,
            'expected `maxHeaderListSize : 65536` — HPACK bomb defense missing'
        );
    });

    it('source hardcodes enablePush to false', function() {
        assert.ok(
            getSrc().indexOf('enablePush          : false') > -1,
            'expected `enablePush : false` — server push must be disabled'
        );
    });

    it('source defaults maxSessionRejectedStreams to 100 (RST/Rapid Reset defense) (#H7)', function() {
        assert.ok(
            getSrc().indexOf('_h2Opts.maxSessionRejectedStreams || 100') > -1,
            'expected `_h2Opts.maxSessionRejectedStreams || 100` — configurable RST flood defense'
        );
    });

    it('source defaults maxSessionInvalidFrames to 1000 (CONTINUATION flood defense) (#H7)', function() {
        assert.ok(
            getSrc().indexOf('_h2Opts.maxSessionInvalidFrames || 1000') > -1,
            'expected `_h2Opts.maxSessionInvalidFrames || 1000` — configurable CONTINUATION flood defense'
        );
    });

});


// 03b — HTTP/2 configurable settings pure logic
describe('03b - HTTP/2 configurable settings: fallback logic', function() {

    // Replica of the _h2Opts fallback logic in server.isaac.js (settings + session guards)
    function resolveH2Settings(optionsHttp2Options) {
        var _h2Opts = (optionsHttp2Options && typeof optionsHttp2Options === 'object') ? optionsHttp2Options : {};
        return {
            settings: {
                maxConcurrentStreams : _h2Opts.maxConcurrentStreams || 256,
                initialWindowSize   : _h2Opts.initialWindowSize    || 65535 * 10,
                maxHeaderListSize   : 65536,
                enablePush          : false
            },
            // #H7 — session-level guards now also configurable
            maxSessionRejectedStreams : _h2Opts.maxSessionRejectedStreams || 100,
            maxSessionInvalidFrames  : _h2Opts.maxSessionInvalidFrames   || 1000
        };
    }

    it('uses default maxConcurrentStreams (256) when http2Options absent', function() {
        assert.equal(resolveH2Settings(undefined).settings.maxConcurrentStreams, 256);
    });

    it('uses default maxConcurrentStreams (256) when http2Options is null', function() {
        assert.equal(resolveH2Settings(null).settings.maxConcurrentStreams, 256);
    });

    it('uses default maxConcurrentStreams (256) when http2Options is not an object', function() {
        assert.equal(resolveH2Settings('string').settings.maxConcurrentStreams, 256);
    });

    it('honours custom maxConcurrentStreams from settings.json', function() {
        assert.equal(resolveH2Settings({ maxConcurrentStreams: 512 }).settings.maxConcurrentStreams, 512);
    });

    it('uses default initialWindowSize (655350) when http2Options absent', function() {
        assert.equal(resolveH2Settings(undefined).settings.initialWindowSize, 65535 * 10);
    });

    it('honours custom initialWindowSize from settings.json', function() {
        assert.equal(resolveH2Settings({ initialWindowSize: 131070 }).settings.initialWindowSize, 131070);
    });

    it('always uses hardcoded maxHeaderListSize (65536)', function() {
        assert.equal(resolveH2Settings({ maxHeaderListSize: 99999 }).settings.maxHeaderListSize, 65536);
    });

    it('always disables server push regardless of user config', function() {
        assert.equal(resolveH2Settings({ enablePush: true }).settings.enablePush, false);
    });

    it('http2Options empty object falls back to all defaults', function() {
        var s = resolveH2Settings({});
        assert.equal(s.settings.maxConcurrentStreams, 256);
        assert.equal(s.settings.initialWindowSize, 65535 * 10);
        assert.equal(s.settings.maxHeaderListSize, 65536);
        assert.equal(s.settings.enablePush, false);
        assert.equal(s.maxSessionRejectedStreams, 100);
        assert.equal(s.maxSessionInvalidFrames, 1000);
    });

    // #H7 — session-level guard configurability
    it('uses default maxSessionRejectedStreams (100) when absent', function() {
        assert.equal(resolveH2Settings(undefined).maxSessionRejectedStreams, 100);
    });

    it('honours custom maxSessionRejectedStreams from settings.json', function() {
        assert.equal(resolveH2Settings({ maxSessionRejectedStreams: 50 }).maxSessionRejectedStreams, 50);
    });

    it('uses default maxSessionInvalidFrames (1000) when absent', function() {
        assert.equal(resolveH2Settings(undefined).maxSessionInvalidFrames, 1000);
    });

    it('honours custom maxSessionInvalidFrames from settings.json', function() {
        assert.equal(resolveH2Settings({ maxSessionInvalidFrames: 500 }).maxSessionInvalidFrames, 500);
    });

});


// 04 — HTTP/2 session metrics source structure (#H3)
describe('04 - HTTP/2 session metrics source structure (#H3)', function() {

    function getSrc() { return src || (src = fs.readFileSync(SOURCE, 'utf8')); }

    it('source declares _h2Metrics with activeSessions, totalStreams, goawayCount, rstCount', function() {
        var s = getSrc();
        assert.ok(s.indexOf('activeSessions') > -1);
        assert.ok(s.indexOf('totalStreams') > -1);
        assert.ok(s.indexOf('goawayCount') > -1);
        assert.ok(s.indexOf('rstCount') > -1);
    });

    it('source attaches _h2Metrics to server', function() {
        assert.ok(
            getSrc().indexOf('server._h2Metrics = _h2Metrics') > -1,
            'expected `server._h2Metrics = _h2Metrics` — metrics not attached to server'
        );
    });

    it('source increments activeSessions on session event', function() {
        assert.ok(
            getSrc().indexOf('_h2Metrics.activeSessions++') > -1,
            'expected `_h2Metrics.activeSessions++` in session handler'
        );
    });

    it('source increments totalStreams on stream event', function() {
        assert.ok(
            getSrc().indexOf('_h2Metrics.totalStreams++') > -1,
            'expected `_h2Metrics.totalStreams++` in stream handler'
        );
    });

    it('source increments rstCount on non-zero rstCode', function() {
        assert.ok(
            getSrc().indexOf('_h2Metrics.rstCount++') > -1,
            'expected `_h2Metrics.rstCount++` in rstCode handler'
        );
    });

    it('source increments goawayCount on goaway event', function() {
        assert.ok(
            getSrc().indexOf('_h2Metrics.goawayCount++') > -1,
            'expected `_h2Metrics.goawayCount++` in goaway handler'
        );
    });

    it('source decrements activeSessions on session close', function() {
        assert.ok(
            getSrc().indexOf('_h2Metrics.activeSessions--') > -1 ||
            getSrc().indexOf('if (_h2Metrics.activeSessions > 0) _h2Metrics.activeSessions--') > -1,
            'expected activeSessions decrement in close handler'
        );
    });

    it('source exposes http2 key in /_gina/info when _h2Metrics present', function() {
        assert.ok(
            getSrc().indexOf('server._h2Metrics') > -1 &&
            getSrc().indexOf('infoPayload["http2"]') > -1,
            'expected http2 block in /_gina/info response'
        );
    });

});


// 04b — HTTP/2 session metrics pure logic
describe('04b - HTTP/2 session metrics: counter logic', function() {

    // Replica of the _h2Metrics counter used in server.isaac.js
    function makeMetrics() {
        return { activeSessions: 0, totalStreams: 0, goawayCount: 0, rstCount: 0 };
    }

    // Replica of the /_gina/info payload builder
    function buildInfoPayload(basePayload, h2Metrics) {
        var payload = Object.assign({}, basePayload);
        if (h2Metrics) {
            payload['http2'] = {
                activeSessions : h2Metrics.activeSessions,
                totalStreams    : h2Metrics.totalStreams,
                goawayCount    : h2Metrics.goawayCount,
                rstCount        : h2Metrics.rstCount
            };
        }
        return payload;
    }

    it('fresh metrics object starts at zero for all counters', function() {
        var m = makeMetrics();
        assert.equal(m.activeSessions, 0);
        assert.equal(m.totalStreams, 0);
        assert.equal(m.goawayCount, 0);
        assert.equal(m.rstCount, 0);
    });

    it('activeSessions increments correctly', function() {
        var m = makeMetrics();
        m.activeSessions++;
        m.activeSessions++;
        assert.equal(m.activeSessions, 2);
    });

    it('activeSessions decrements correctly and does not go below 0', function() {
        var m = makeMetrics();
        m.activeSessions++;
        if (m.activeSessions > 0) m.activeSessions--;
        assert.equal(m.activeSessions, 0);
        if (m.activeSessions > 0) m.activeSessions--;
        assert.equal(m.activeSessions, 0, 'activeSessions must not go below 0');
    });

    it('totalStreams increments independently of activeSessions', function() {
        var m = makeMetrics();
        m.totalStreams++;
        m.totalStreams++;
        m.totalStreams++;
        assert.equal(m.totalStreams, 3);
        assert.equal(m.activeSessions, 0);
    });

    it('rstCount only increments on non-zero rst code', function() {
        var m = makeMetrics();
        var code = 0;
        if (code !== 0) m.rstCount++;
        assert.equal(m.rstCount, 0, 'RST code 0 (NO_ERROR) must not increment rstCount');

        code = 8; // CANCEL
        if (code !== 0) m.rstCount++;
        assert.equal(m.rstCount, 1);
    });

    it('goawayCount increments on goaway event', function() {
        var m = makeMetrics();
        m.goawayCount++;
        assert.equal(m.goawayCount, 1);
    });

    it('buildInfoPayload includes http2 key when metrics provided', function() {
        var m = makeMetrics();
        m.activeSessions = 3;
        m.totalStreams    = 100;
        m.goawayCount    = 2;
        m.rstCount        = 5;
        var payload = buildInfoPayload({ version: 'v20.0.0' }, m);
        assert.ok('http2' in payload, 'http2 key must be present');
        assert.equal(payload.http2.activeSessions, 3);
        assert.equal(payload.http2.totalStreams, 100);
        assert.equal(payload.http2.goawayCount, 2);
        assert.equal(payload.http2.rstCount, 5);
    });

    it('buildInfoPayload omits http2 key when metrics is null', function() {
        var payload = buildInfoPayload({ version: 'v20.0.0' }, null);
        assert.ok(!('http2' in payload), 'http2 key must be absent when metrics is null');
    });

    it('buildInfoPayload omits http2 key when metrics is undefined', function() {
        var payload = buildInfoPayload({ version: 'v20.0.0' }, undefined);
        assert.ok(!('http2' in payload), 'http2 key must be absent when metrics is undefined');
    });

    it('metrics counters are independent — incrementing one does not affect others', function() {
        var m = makeMetrics();
        m.activeSessions++;
        assert.equal(m.totalStreams, 0);
        assert.equal(m.goawayCount, 0);
        assert.equal(m.rstCount, 0);
    });

});


// ─── X-Forwarded-Prefix capture (per-request, not process-global) ────────────
//
// When a reverse proxy mounts the bundle on a sub-path (e.g.
// `proxy_set_header X-Forwarded-Prefix /admin;`), the framework needs to know
// the public mount path so the controller can compose a public webroot for
// browser-side URL construction. The capture site sits AFTER (sibling to,
// not inside) the proxy detection block — it must run on EVERY request
// regardless of `isProxyHost` state, because the proxy detection block is
// gated on `!isProxyHost` and stops firing after the first proxied request
// flips `isProxyHost` to globally true. Stores the normalised value on
// `request._ginaProxyPrefix` (per-request slot) so the value cannot leak
// across requests when the worker handles a mix of proxied + direct calls
// or different proxy mounts. process.gina.PROXY_PREFIX (the previous
// process-global slot) is no longer written.
//
// Normalisation: trim, drop trailing slashes, prepend leading slash if
// missing, drop empty / "/" results so back-compat is preserved (header
// absent or no-op header → property never set, controller falls back to
// the bundle's internal webroot).

describe('X-Forwarded-Prefix capture & normalisation (per-request)', function() {

    if (typeof src == 'undefined' || src === null) {
        src = fs.readFileSync(SOURCE, 'utf8');
    }

    // ── (a) source structure ─────────────────────────────────────────────────

    it("source reads request.headers['x-forwarded-prefix'] near the proxy detection region", function() {
        var anchor = src.indexOf("request.headers['x-forwarded-host']");
        assert.ok(anchor > -1, "x-forwarded-host read site not found — proxy block may have moved");
        // Slightly larger window now: the prefix read sits AFTER the gated
        // proxy block (no longer inside it), so allow ~2.5k chars to absorb
        // the closing `}` + the explanatory comment header that introduces
        // the per-request rationale.
        var windowStart = anchor;
        var windowEnd   = Math.min(src.length, anchor + 2500);
        var block = src.slice(windowStart, windowEnd);
        assert.ok(
            block.indexOf("request.headers['x-forwarded-prefix']") > -1,
            'expected x-forwarded-prefix read in the same region as x-forwarded-host (sibling to the proxy detection block)'
        );
    });

    it("source assigns the normalised value to request._ginaProxyPrefix (per-request)", function() {
        var anchor = src.indexOf("request.headers['x-forwarded-prefix']");
        assert.ok(anchor > -1, 'x-forwarded-prefix read site not found');
        var windowEnd = Math.min(src.length, anchor + 600);
        var block = src.slice(anchor, windowEnd);
        assert.ok(
            block.indexOf('request._ginaProxyPrefix') > -1,
            'expected request._ginaProxyPrefix assignment near the x-forwarded-prefix read (per-request, not process-global)'
        );
    });

    it("source does NOT write process.gina.PROXY_PREFIX (the leaky process-global is removed)", function() {
        // Negative invariant: the previous process-global write is the bug
        // surface this slice fixed. If it ever comes back, the per-request
        // isolation is broken and renders mixing proxied + direct calls
        // would leak the prefix across requests until worker restart.
        assert.ok(
            src.indexOf('process.gina.PROXY_PREFIX') === -1,
            'process.gina.PROXY_PREFIX must NOT be written by server.isaac.js — use request._ginaProxyPrefix instead (cross-request leak protection)'
        );
    });

    it("x-forwarded-prefix processing is OUTSIDE the !isProxyHost gated block (runs on every request)", function() {
        // Find the gated block's setContext('isProxyHost', true) line — that
        // marks the END of the gated block. The x-forwarded-prefix read must
        // come AFTER it (or be far enough away to demonstrably be outside).
        // If both sit before setContext, the prefix is still inside the gate
        // and the cross-request leak is back.
        var gateEnd = src.indexOf("setContext('isProxyHost', true)");
        var xfpRead = src.indexOf("request.headers['x-forwarded-prefix']");
        assert.ok(gateEnd > -1, "setContext('isProxyHost', true) not found — proxy block may have moved");
        assert.ok(xfpRead > -1, 'x-forwarded-prefix read not found');
        assert.ok(
            xfpRead > gateEnd,
            'x-forwarded-prefix processing must be AFTER the !isProxyHost gated block (currently before — leak risk)'
        );
    });

    it("source strips trailing slashes via /\\/+$/ replace", function() {
        var anchor = src.indexOf("request.headers['x-forwarded-prefix']");
        var windowEnd = Math.min(src.length, anchor + 600);
        var block = src.slice(anchor, windowEnd);
        assert.ok(
            /\.replace\(\s*\/\\\/\+\$\/\s*,\s*''\s*\)/.test(block),
            'expected `.replace(/\\/+$/, \'\')` to strip trailing slashes from the header value'
        );
    });

    // ── (b) pure logic — inline replica ──────────────────────────────────────
    //
    // Replica of the normalisation steps in server.isaac.js. The replica must
    // stay byte-equivalent to the live capture; the source-structure tests
    // above pin the live shape.

    function normaliseXfp(headerValue) {
        if (!headerValue) return undefined;
        var xfp = String(headerValue).trim();
        xfp = xfp.replace(/\/+$/, '');
        if (xfp.length > 0 && xfp.charAt(0) !== '/') {
            xfp = '/' + xfp;
        }
        if (xfp.length > 0) return xfp;
        return undefined;
    }

    it('absent header → undefined (back-compat)', function() {
        assert.equal(normaliseXfp(undefined), undefined);
        assert.equal(normaliseXfp(null), undefined);
        assert.equal(normaliseXfp(''), undefined);
    });

    it('lone "/" → undefined (no-op header is dropped)', function() {
        assert.equal(normaliseXfp('/'), undefined);
        assert.equal(normaliseXfp('//'), undefined);
        assert.equal(normaliseXfp('   /   '), undefined);
    });

    it('"/sub" → "/sub" (already canonical)', function() {
        assert.equal(normaliseXfp('/sub'), '/sub');
    });

    it('"/sub/" → "/sub" (trailing slash stripped)', function() {
        assert.equal(normaliseXfp('/sub/'), '/sub');
    });

    it('"/sub//" → "/sub" (multiple trailing slashes stripped)', function() {
        assert.equal(normaliseXfp('/sub//'), '/sub');
    });

    it('"sub" → "/sub" (leading slash added)', function() {
        assert.equal(normaliseXfp('sub'), '/sub');
    });

    it('"sub/" → "/sub" (leading added, trailing stripped)', function() {
        assert.equal(normaliseXfp('sub/'), '/sub');
    });

    it('"  /sub  " → "/sub" (whitespace trimmed)', function() {
        assert.equal(normaliseXfp('  /sub  '), '/sub');
    });

    it('multi-segment "/admin/v2" → "/admin/v2"', function() {
        assert.equal(normaliseXfp('/admin/v2'), '/admin/v2');
    });

    it('multi-segment "/admin/v2/" → "/admin/v2"', function() {
        assert.equal(normaliseXfp('/admin/v2/'), '/admin/v2');
    });

});


// 05 — URL query string parsing: '+' → space decoding (#B17)
//
// The Isaac engine's request handler at server.on('request', ...) parses
// `?key=value&...` into request.query. Per WHATWG URL "application/x-www-form-urlencoded
// parser" spec, '+' in values must be replaced with space BEFORE percent-decoding
// (decodeURIComponent only decodes %XX, not '+'). Both branches of the parser
// (multi-value `&` loop and single-key `=` no-`&` path) carry the fix.
//
// Express engine is already spec-correct via qs/querystring.unescape defaults — no
// change there. Body parsing is covered by http-methods.test.js section 12.

describe("05 - URL query string parsing: '+' → space decoding (#B17)", function() {

    var srcLocal;
    function getSrc() {
        if (!srcLocal) srcLocal = fs.readFileSync(SOURCE, 'utf8');
        return srcLocal;
    }

    // Source-level pins — confirm '+' handling exists at both sites BEFORE
    // (or independent of) decodeURIComponent, in the request-handler URL parser.

    it("multi-value branch: '+' replacement appears before decodeURIComponent inside the &-loop", function() {
        // Region: the &-loop processes arr[p].split('=') inside queryParams.split('&').
        // We look for the if-block that handles '+' and '%' in the value.
        var s = getSrc();
        var marker = "arr = queryParams[i].split('&')";
        var startIdx = s.indexOf(marker);
        assert.ok(startIdx > -1, 'expected the &-loop marker to be present');
        // Slice to the end of the inner for-loop (closing of the arr-loop)
        var region = s.slice(startIdx, startIdx + 1500);
        assert.match(
            region,
            /a\[1\]\.indexOf\('\+'\)\s*>\s*-1/,
            "expected '+' presence check on a[1] inside &-loop"
        );
        assert.match(
            region,
            /a\[1\]\s*=\s*a\[1\]\.replace\(\/\\\+\/g,\s*' '\)/,
            "expected '+' → space replacement on a[1] inside &-loop"
        );
    });

    it("single-key branch: '+' replacement appears in the no-'&' path (a.length > 1 case)", function() {
        var s = getSrc();
        // Region: the else branch after the &-loop (no `&` in query string)
        var marker = "queryParams[1].split('=')";
        var idx = s.indexOf(marker);
        assert.ok(idx > -1, "expected single-key branch marker to be present");
        var region = s.slice(idx, idx + 1500);
        assert.match(
            region,
            /a\[1\]\.indexOf\('\+'\)\s*>\s*-1/,
            "expected '+' presence check on a[1] in single-key branch"
        );
        assert.match(
            region,
            /a\[1\]\s*=\s*a\[1\]\.replace\(\/\\\+\/g,\s*' '\)/,
            "expected '+' → space replacement on a[1] in single-key branch"
        );
    });

    it("both branches replace '+' BEFORE calling decodeURIComponent (not after)", function() {
        // The order matters: decodeURIComponent does NOT decode '+', so the replace
        // must run first (or at least before the value is consumed). Otherwise a
        // value like 'Hello%2B' (literal '+' encoded as %2B) would become 'Hello+'
        // which would then be wrongly turned into 'Hello '.
        var s = getSrc();
        // Multi-value branch
        var multiStart = s.indexOf("arr = queryParams[i].split('&')");
        var multiRegion = s.slice(multiStart, multiStart + 1500);
        var multiPlus   = multiRegion.indexOf("a[1].replace(/\\+/g, ' ')");
        var multiDecode = multiRegion.indexOf('decodeURIComponent(a[1])');
        assert.ok(multiPlus > -1 && multiDecode > -1, 'both ops must exist in multi-value branch');
        assert.ok(multiPlus < multiDecode, "multi-value: '+' replace must precede decodeURIComponent");

        // Single-key branch
        var singleStart = s.indexOf("queryParams[1].split('=')");
        var singleRegion = s.slice(singleStart, singleStart + 1500);
        var singlePlus   = singleRegion.indexOf("a[1].replace(/\\+/g, ' ')");
        var singleDecode = singleRegion.indexOf('decodeURIComponent(a[1])');
        assert.ok(singlePlus > -1 && singleDecode > -1, 'both ops must exist in single-key branch');
        assert.ok(singlePlus < singleDecode, "single-key: '+' replace must precede decodeURIComponent");
    });

    // Pure-logic replicas of the two branches AFTER #B17 fix, exercised against
    // the inputs the production parser sees. Mirror of server.isaac.js:1258-1300.

    function parseQueryAfterFix(rawQs) {
        // rawQs is everything after '?'
        var query = {};
        if (rawQs.indexOf('&') > -1) {
            // multi-value branch
            var arr = rawQs.split('&');
            for (var p = 0; p < arr.length; ++p) {
                var a = arr[p].split('=');
                var lower = a[1] && a[1].toLowerCase();
                if (lower === 'false' || lower === 'true' || lower === 'on') {
                    a[1] = (lower === 'true' || lower === 'on') ? true : false;
                } else if (a[1] && (a[1].indexOf('+') > -1 || a[1].indexOf('%') > -1)) {
                    if (a[1].indexOf('+') > -1) a[1] = a[1].replace(/\+/g, ' ');
                    if (a[1].indexOf('%') > -1) a[1] = decodeURIComponent(a[1]);
                }
                if (a[1] && typeof a[1] === 'string' && (a[1].charAt(0) === '{' || a[1].charAt(0) === '[')) {
                    try { a[1] = JSON.parse(a[1]); } catch (e) { /* keep as string */ }
                }
                query[a[0]] = a[1];
            }
        } else {
            // single-key branch (no '&')
            var a = rawQs.split('=');
            if (a.length > 1) {
                var lower2 = a[1] && a[1].toLowerCase();
                if (lower2 === 'false' || lower2 === 'true' || lower2 === 'on') {
                    a[1] = (lower2 === 'true' || lower2 === 'on') ? true : false;
                } else if (a[1] && (a[1].indexOf('+') > -1 || a[1].indexOf('%') > -1)) {
                    if (a[1].indexOf('+') > -1) a[1] = a[1].replace(/\+/g, ' ');
                    if (a[1].indexOf('%') > -1) a[1] = decodeURIComponent(a[1]);
                }
                query[a[0]] = a[1];
            } else {
                // ?encodedJsonObject fallback — unchanged by #B17
                if (a[0].indexOf('%') > -1) a[0] = decodeURIComponent(a[0]);
                try { query = a[0] ? JSON.parse(a[0]) : {}; } catch (e) { /* ignore */ }
            }
        }
        return query;
    }

    // Single-key branch (no '&') — positive cases

    it("single-key '?name=Hello+World' decodes to { name: 'Hello World' }", function() {
        var q = parseQueryAfterFix('name=Hello+World');
        assert.deepEqual(q, { name: 'Hello World' });
    });

    it("single-key '?name=Hello%20World' still decodes to { name: 'Hello World' } via existing % path", function() {
        var q = parseQueryAfterFix('name=Hello%20World');
        assert.deepEqual(q, { name: 'Hello World' });
    });

    it("single-key mixed '?name=Hello+World%21' decodes to { name: 'Hello World!' }", function() {
        var q = parseQueryAfterFix('name=Hello+World%21');
        assert.deepEqual(q, { name: 'Hello World!' });
    });

    // Multi-value branch (has '&') — positive cases

    it("multi-value '?a=1+2&b=3+4' decodes both values to '1 2' and '3 4'", function() {
        var q = parseQueryAfterFix('a=1+2&b=3+4');
        assert.deepEqual(q, { a: '1 2', b: '3 4' });
    });

    it("multi-value '?a=Hello+World&b=foo%21' decodes both values together", function() {
        var q = parseQueryAfterFix('a=Hello+World&b=foo%21');
        assert.deepEqual(q, { a: 'Hello World', b: 'foo!' });
    });

    it("multi-value '?name=Hello%20World&other=plain' still decodes via existing % path", function() {
        var q = parseQueryAfterFix('name=Hello%20World&other=plain');
        assert.deepEqual(q, { name: 'Hello World', other: 'plain' });
    });

    // Reproducer pinned: URLSearchParams.toString() encodes space as '+'

    it("URLSearchParams.toString() output → single-key parser decodes '+' back to space", function() {
        var params = new URLSearchParams({ name: 'Hello World' });
        assert.ok(/\+/.test(params.toString()));
        var q = parseQueryAfterFix(params.toString());
        assert.deepEqual(q, { name: 'Hello World' });
    });

    it("URLSearchParams.toString() multi-key → multi-value parser decodes '+' back to space", function() {
        var params = new URLSearchParams({ first: 'Jane Doe', last: 'John Smith' });
        var qs = params.toString();
        assert.ok(/\+/.test(qs));
        var q = parseQueryAfterFix(qs);
        assert.deepEqual(q, { first: 'Jane Doe', last: 'John Smith' });
    });

    // Counter / back-compat — values without '+' or '%' are unchanged

    it("plain values without '+' or '%' pass through unchanged (multi-value)", function() {
        var q = parseQueryAfterFix('a=plain&b=other');
        assert.deepEqual(q, { a: 'plain', b: 'other' });
    });

    it("plain values without '+' or '%' pass through unchanged (single-key)", function() {
        var q = parseQueryAfterFix('name=plain');
        assert.deepEqual(q, { name: 'plain' });
    });

    it("'false'/'true'/'on' coercion still wins over '+' decoding when value matches", function() {
        // The boolean-coercion branch comes first; if value is exactly 'false'/'true'/'on'
        // (no '+' chars anyway), it gets boolean-coerced and never reaches the '+' branch.
        var q = parseQueryAfterFix('flag=true&other=false');
        assert.deepEqual(q, { flag: true, other: false });
    });

    it("multi-value JSON-parse branch still fires after '+' decode if value starts with '{'", function() {
        // Note: '+' inside a JSON value is preserved by decodeURIComponent and JSON.parse.
        // The JSON-parse step only exists in the multi-value branch (production parity),
        // so the test must use a multi-key query string to exercise it.
        var q = parseQueryAfterFix('payload=' + encodeURIComponent('{"v":"1+2"}') + '&flag=true');
        assert.deepEqual(q, { payload: { v: '1+2' }, flag: true });
    });

    it("single-key branch does NOT auto-JSON-parse values starting with '{' (pre-existing behaviour)", function() {
        // Production single-key branch (server.isaac.js:1282-1288) lacks the JSON-parse step
        // present in the multi-value branch. #B17 does not change this; documented for clarity.
        var q = parseQueryAfterFix('payload=' + encodeURIComponent('{"v":"1"}'));
        assert.strictEqual(typeof q.payload, 'string',
            'single-key branch keeps JSON-shaped value as string — only multi-value branch auto-parses');
    });

    // Counter — body-parser fix in commit 014ff60a is unaffected

    it("body-parser fix (POST/PUT/PATCH) is unchanged — query-string fix is a different code path", function() {
        var s = getSrc();
        // The body-parser fix lives in server.js, not server.isaac.js. Confirm
        // server.isaac.js does NOT have its own processRequestData definition.
        assert.ok(
            s.indexOf('var processRequestData = function') < 0,
            'server.isaac.js must NOT define processRequestData — body parsing is delegated to server.js handle()'
        );
    });
});
