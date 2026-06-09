'use strict';
/**
 * PATCH and HEAD method support — server + controller layer tests
 *
 * Strategy: source inspection + inline logic replicas.
 * No live HTTP server, no framework bootstrap, no project required.
 *
 * Suites:
 *  01 — server.js: request object initialisation
 *  02 — server.js: processRequestData PATCH case
 *  03 — server.js: processRequestData HEAD case
 *  04 — server.js: handle() method matching (HEAD→GET fallback, PATCH URI params)
 *  05 — controller.js: getParams / getParam PATCH and HEAD cases
 *  06 — render-json.js: HEAD body suppression guard
 *  07 — render-swig.js: HEAD body suppression guard
 *  08 — inline logic: PATCH body parsing replica
 *  09 — inline logic: HEAD query-string processing replica
 *  10 — server.js source: method-routing fix (405 continue instead of break)
 *  11 — inline logic: method-routing 405 after full scan
 *  12 — body parser: '+' → space decoding for application/x-www-form-urlencoded
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW              = require('../fw');
var SERVER_SRC      = path.join(FW, 'core/server.js');
var CONTROLLER_SRC  = path.join(FW, 'core/controller/controller.js');
var RENDER_JSON_SRC = path.join(FW, 'core/controller/controller.render-json.js');
var RENDER_SWIG_SRC = path.join(FW, 'core/controller/controller.render-swig.js');


// ─── 01 — server.js: request object initialisation ───────────────────────────

describe('01 - HTTP methods: server.js request init', function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    it('initialises request.patch = {}', function() {
        assert.ok(/request\.patch\s*=\s*\{\}/.test(src));
    });

    it('initialises request.head = {}', function() {
        assert.ok(/request\.head\s*=\s*\{\}/.test(src));
    });

    it('initialises request.patch before request.files', function() {
        var patchIdx = src.indexOf('request.patch   = {};');
        var filesIdx = src.indexOf('request.files   = [];');
        assert.ok(patchIdx > 0 && filesIdx > 0 && patchIdx < filesIdx,
            'patch init should appear before files init');
    });

    it('no longer has the commented-out //request.patch = {}; ??? line', function() {
        assert.ok(!/\/\/request\.patch\s*=\s*\{\}/.test(src));
    });
});


// ─── 02 — server.js: processRequestData PATCH case ───────────────────────────

describe('02 - HTTP methods: server.js processRequestData PATCH', function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    it("has a case 'patch': branch in processRequestData", function() {
        assert.ok(/case\s+'patch'\s*:/.test(src));
    });

    it('assigns parsed body to request.patch', function() {
        assert.ok(/request\.patch\s*=\s*obj/.test(src));
    });

    it('aliases request.body to request.patch on success', function() {
        assert.ok(/request\.body\s*=\s*request\.patch\s*=\s*obj/.test(src));
    });

    it('sets cache-control no-cache headers for PATCH (not cacheable)', function() {
        // The cache-control block appears inside the patch case
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/cache-control.*no-cache/.test(patchCase));
        assert.ok(/pragma.*no-cache/.test(patchCase));
    });

    it('clears request.get after PATCH processing', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/request\.get\s*=\s*undefined/.test(patchCase));
    });

    it('clears request.post after PATCH processing', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/request\.post\s*=\s*undefined/.test(patchCase));
    });

    it('clears request.put after PATCH processing', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/request\.put\s*=\s*undefined/.test(patchCase));
    });

    it('clears request.delete after PATCH processing', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/request\.delete\s*=\s*undefined/.test(patchCase));
    });

    it('handles string body with decodeURIComponent', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/decodeURIComponent/.test(patchCase));
    });

    it('handles object body via JSON.stringify + JSON.parse round-trip', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/JSON\.stringify/.test(patchCase));
        assert.ok(/JSON\.parse/.test(patchCase));
    });

    it('logs a warning on PATCH body parse failure instead of throwing', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.ok(/console\.warn/.test(patchCase));
    });
});


// ─── 03 — server.js: processRequestData HEAD case ────────────────────────────

describe('03 - HTTP methods: server.js processRequestData HEAD', function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    it("has a case 'head': branch in processRequestData", function() {
        assert.ok(/case\s+'head'\s*:/.test(src));
    });

    it('assigns processed query string to request.head', function() {
        assert.ok(/request\.head\s*=\s*request\.query/.test(src));
    });

    it('clears request.get after HEAD processing (HEAD has its own req.head)', function() {
        var headStart = src.indexOf("case 'head':");
        var headCase  = src.slice(headStart, headStart + 3000);
        assert.ok(/request\.get\s*=\s*undefined/.test(headCase));
    });

    it('clears request.post after HEAD processing', function() {
        var headStart = src.indexOf("case 'head':");
        var headCase  = src.slice(headStart, headStart + 3000);
        assert.ok(/request\.post\s*=\s*undefined/.test(headCase));
    });

    it('clears request.put after HEAD processing', function() {
        var headStart = src.indexOf("case 'head':");
        var headCase  = src.slice(headStart, headStart + 3000);
        assert.ok(/request\.put\s*=\s*undefined/.test(headCase));
    });

    it('clears request.patch after HEAD processing', function() {
        var headStart = src.indexOf("case 'head':");
        var headCase  = src.slice(headStart, headStart + 3000);
        assert.ok(/request\.patch\s*=\s*undefined/.test(headCase));
    });

    it('does NOT set cache-control headers for HEAD (read-only, cacheable)', function() {
        var headStart = src.indexOf("case 'head':");
        var headCase  = src.slice(headStart, headStart + 3000);
        assert.ok(!/setHeader\('cache-control'/.test(headCase));
    });
});


// ─── 04 — server.js: handle() method matching ────────────────────────────────

describe('04 - HTTP methods: server.js handle() routing', function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    it('has a HEAD→GET fallback in isMethodAllowed check', function() {
        assert.ok(/\/\^head\$\/i\.test\(req\.method\)\s*&&\s*\/\^get\$\/i\.test\(_routing\.method\)/.test(src));
    });

    it('HEAD→GET fallback sets isMethodAllowed = true without overwriting req.method', function() {
        // Unlike the GET→DELETE override which rewrites req.method,
        // the HEAD→GET fallback must leave req.method as 'HEAD'
        var headFallback = src.match(/\/\^head\$\/i\.test\(req\.method\)[^}]+}/);
        assert.ok(headFallback, 'HEAD fallback block not found');
        assert.ok(!/req\.method\s*=\s*_routing\.method/.test(headFallback[0]),
            'HEAD fallback should not overwrite req.method');
    });

    it("has an else if (method === 'patch') URI param merging block", function() {
        assert.ok(/else if \( method === 'patch' \)/.test(src));
    });

    it('PATCH URI param merging assigns to req.patch', function() {
        var patchBlock = src.slice(
            src.indexOf("else if ( method === 'patch' )"),
            src.indexOf("else if ( method === 'head' )")
        );
        assert.ok(/req\.patch\[parameter\]\s*=\s*req\.params\[parameter\]/.test(patchBlock));
    });

    it("has an else if (method === 'head') URI param merging block", function() {
        assert.ok(/else if \( method === 'head' \)/.test(src));
    });

    it('HEAD URI param merging assigns to req.head (not req.get)', function() {
        var headBlock = src.slice(src.indexOf("else if ( method === 'head' )"));
        var blockEnd  = headBlock.indexOf('\n                    }');
        var block     = headBlock.slice(0, blockEnd + 1);
        assert.ok(/req\.head\[parameter\]\s*=\s*req\.params\[parameter\]/.test(block));
        assert.ok(!/req\.get\[parameter\]/.test(block));
    });
});


// ─── 05 — controller.js: getParams / getParam ────────────────────────────────

describe('05 - HTTP methods: controller.js getParams and getParam', function() {

    var src;
    before(function() { src = fs.readFileSync(CONTROLLER_SRC, 'utf8'); });

    it("getParams() has case 'patch': merging req.patch", function() {
        assert.ok(/case\s+'patch'\s*:\s*\n\s*params\s*=\s*merge\(params,\s*req\.patch/.test(src));
    });

    it("getParams() has case 'head': merging req.head", function() {
        assert.ok(/case\s+'head'\s*:\s*\n\s*params\s*=\s*merge\(params,\s*req\.head/.test(src));
    });

    it("getParam() has case 'patch': reading req.patch[name]", function() {
        assert.ok(/case\s+'patch'\s*:\s*\n\s*param\s*=\s*req\.patch\[name\]/.test(src));
    });

    it("getParam() has case 'head': reading req.head[name]", function() {
        assert.ok(/case\s+'head'\s*:\s*\n\s*param\s*=\s*req\.head\[name\]/.test(src));
    });

    it('getParams() switch covers all six methods', function() {
        var getParamsFn = src.slice(src.indexOf('req.getParams = function()'), src.indexOf('req.getParam = function(name)'));
        ['get', 'post', 'put', 'delete', 'patch', 'head'].forEach(function(method) {
            assert.ok(new RegExp("case\\s+'" + method + "'").test(getParamsFn),
                'getParams() missing case for ' + method);
        });
    });

    it('getParam() switch covers all six methods', function() {
        var getParamStart = src.indexOf('req.getParam = function(name)');
        var getParamFn = src.slice(getParamStart, src.indexOf('}\n    }', getParamStart) + 6);
        ['get', 'post', 'put', 'delete', 'patch', 'head'].forEach(function(method) {
            assert.ok(new RegExp("case\\s+'" + method + "'").test(getParamFn),
                'getParam() missing case for ' + method);
        });
    });
});


// ─── 06 — render-json.js: HEAD body suppression ──────────────────────────────

describe('06 - HTTP methods: render-json.js HEAD suppression', function() {

    var src;
    before(function() { src = fs.readFileSync(RENDER_JSON_SRC, 'utf8'); });

    it('has a HEAD method guard', function() {
        assert.ok(/\/\^HEAD\$\/i\.test\(request\.method\)/.test(src));
    });

    it('calculates content-length from Buffer.byteLength for HEAD response', function() {
        assert.ok(/Buffer\.byteLength\(data/.test(src));
    });

    it('calls stream.end() without body for HTTP/2 HEAD', function() {
        var headBlock = src.slice(src.indexOf('/^HEAD$/i.test(request.method)'));
        var blockEnd  = headBlock.indexOf('\n        return;\n        }');
        var block     = headBlock.slice(0, blockEnd);
        assert.ok(/stream\.end\(\)/.test(block));
    });

    it('calls response.end() without body for HTTP/1.1 HEAD', function() {
        var headBlock = src.slice(src.indexOf('/^HEAD$/i.test(request.method)'));
        var blockEnd  = headBlock.indexOf('\n        return;\n        }');
        var block     = headBlock.slice(0, blockEnd);
        assert.ok(/response\.end\(\)/.test(block));
    });

    it('nulls local.req, local.res, local.next after HEAD response', function() {
        var headBlock = src.slice(src.indexOf('/^HEAD$/i.test(request.method)'));
        var blockEnd  = headBlock.indexOf('\n        return;\n        }');
        var block     = headBlock.slice(0, blockEnd);
        assert.ok(/local\.req\s*=\s*null/.test(block));
        assert.ok(/local\.res\s*=\s*null/.test(block));
        assert.ok(/local\.next\s*=\s*null/.test(block));
    });

    it('HEAD guard appears before the XHR and stream write paths', function() {
        var headIdx   = src.indexOf('/^HEAD$/i.test(request.method)');
        var streamIdx = src.indexOf('stream.end(data)');
        assert.ok(headIdx < streamIdx, 'HEAD guard should appear before stream.end(data)');
    });
});


// ─── 07 — render-swig.js: HEAD body suppression ──────────────────────────────

describe('07 - HTTP methods: render-swig.js HEAD suppression', function() {

    var src;
    before(function() { src = fs.readFileSync(RENDER_SWIG_SRC, 'utf8'); });

    it('has a HEAD method guard in the Swig render path', function() {
        // Post-#M1 retrofit: `local.req.method` reads were renamed to the
        // function-scoped capture `req.method` (race-safe against external
        // null-outs of local.req during render's async awaits).
        assert.ok(/\/\^HEAD\$\/i\.test\(req\.method\)/.test(src));
    });

    it('sets content-type header for HEAD HTML response', function() {
        assert.ok(/setHeader\('content-type'/.test(src));
    });

    it('calculates content-length from Buffer.byteLength for HEAD HTML response', function() {
        assert.ok(/Buffer\.byteLength\(htmlContent/.test(src));
    });

    it('calls res.end() without body for HEAD', function() {
        // The HEAD path should call res.end() with no argument (HTTP/1.1 fallback).
        // #H8 added an inner stream branch: if (stream) { stream.end() } else { res.end() }
        // so we look for res.end() within the full HEAD block (up to `} else if`).
        // Word-boundary anchor since `res` is the function-scoped capture (no `local.` prefix).
        var headGuards = src.split('/^HEAD$/i.test(req.method)');
        assert.ok(headGuards.length >= 2, 'Expected at least one HEAD guard in render-swig');
        headGuards.slice(1).forEach(function(block) {
            var blockEnd = block.indexOf('} else if');
            assert.ok(/\bres\.end\(\)/.test(block.slice(0, blockEnd)),
                'HEAD branch should call res.end() with no body');
        });
    });

    it('has HEAD suppression in both render code paths (cache hit and normal)', function() {
        var count = (src.match(/\/\^HEAD\$\/i\.test\(req\.method\)/g) || []).length;
        assert.strictEqual(count, 2, 'Expected HEAD guard in 2 render paths, found ' + count);
    });
});


// ─── 08 — inline logic: PATCH body parsing replica ───────────────────────────

describe('08 - HTTP methods: PATCH body parsing logic (inline replica)', function() {

    // Replica of the PATCH body parsing logic from processRequestData.
    // #B28 — application/json bodies are now parsed verbatim (no url-decode,
    // no "true"/"false"/"on"/"null" coercion); only the urlencoded / legacy
    // path still decodes + coerces.
    function parsePatchBody(body, contentType) {
        var obj = null, bodyStr = null;
        contentType = contentType || 'application/json';

        if (typeof body === 'string') {
            if (!/multipart\/form-data;/.test(contentType)) {
                if (/application\/json/i.test(contentType)) {
                    try { obj = JSON.parse(body); } catch (e) { obj = null; }
                } else {
                    if (/application\/x-www-form-urlencoded/.test(contentType) && /\+/.test(body)) {
                        body = body.replace(/\+/g, ' ');
                    }
                    if (body.substring(0, 1) === '?') body = body.substring(1);
                    try { bodyStr = decodeURIComponent(body); } catch (e) { bodyStr = body; }
                    bodyStr = bodyStr
                        .replace(/"false"/g, false)
                        .replace(/"true"/g, true)
                        .replace(/"null"/ig, null);
                    try { obj = JSON.parse(bodyStr); } catch (e) { obj = null; }
                }
            }
        } else {
            bodyStr = JSON.stringify(body);
            bodyStr = bodyStr.replace(/"false"/g, false).replace(/"true"/g, true);
            obj = JSON.parse(bodyStr);
        }

        if (obj && Object.keys(obj).length > 0) {
            return { patch: obj, body: obj };
        }
        return { patch: {}, body: {} };
    }

    it('parses a JSON string body into req.patch', function() {
        var result = parsePatchBody('{"email":"new@example.com"}');
        assert.deepEqual(result.patch, { email: 'new@example.com' });
    });

    it('aliases req.body to the same object as req.patch', function() {
        var result = parsePatchBody('{"name":"Alice"}');
        assert.deepEqual(result.body, result.patch);
    });

    it('strips a leading ? from the body string (form-encoded edge case)', function() {
        var result = parsePatchBody('?{"role":"admin"}', 'application/x-www-form-urlencoded');
        assert.deepEqual(result.patch, { role: 'admin' });
    });

    it('preserves literal + in non-form-encoded bodies (JSON contentType)', function() {
        var result = parsePatchBody('{"tag":"hello+world"}');
        assert.strictEqual(result.patch.tag, 'hello+world',
            "JSON body must preserve literal '+' — only urlencoded bodies get '+' → space");
    });

    it('preserves "true" as a string under application/json (no coercion) — #B28', function() {
        var result = parsePatchBody('{"active":"true"}');
        assert.strictEqual(result.patch.active, 'true');
    });

    it('preserves "false" as a string under application/json (no coercion) — #B28', function() {
        var result = parsePatchBody('{"active":"false"}');
        assert.strictEqual(result.patch.active, 'false');
    });

    it('preserves "null" as a string under application/json (no coercion) — #B28', function() {
        var result = parsePatchBody('{"value":"null"}');
        assert.strictEqual(result.patch.value, 'null');
    });

    it('still coerces "true"→boolean on the urlencoded / legacy path', function() {
        var result = parsePatchBody('{"active":"true"}', 'application/x-www-form-urlencoded');
        assert.strictEqual(result.patch.active, true);
    });

    it('handles an already-parsed object body', function() {
        var result = parsePatchBody({ score: 42 });
        assert.deepEqual(result.patch, { score: 42 });
    });

    it('returns empty patch for an empty body', function() {
        var result = parsePatchBody('{}');
        assert.deepEqual(result.patch, {});
    });

    it('PATCH only changes sent fields — unsent fields are absent from req.patch', function() {
        // This verifies the contract: PATCH body contains only what was sent
        var result = parsePatchBody('{"email":"new@example.com"}');
        assert.ok(!('name' in result.patch), 'unsent field should not appear in req.patch');
        assert.ok(!('role' in result.patch), 'unsent field should not appear in req.patch');
    });
});


// ─── 09 — inline logic: HEAD query-string processing replica ─────────────────

describe('09 - HTTP methods: HEAD query-string processing (inline replica)', function() {

    // Replica of HEAD query processing from processRequestData
    // HEAD uses req.head (not req.get) to store query params
    function processHeadQuery(query) {
        if (!query || Object.keys(query).length === 0) {
            return { head: {}, get: undefined, post: undefined, put: undefined };
        }
        var head = Object.assign({}, query);
        return { head: head, get: undefined, post: undefined, put: undefined };
    }

    it('populates req.head from query string', function() {
        var result = processHeadQuery({ id: '42', format: 'json' });
        assert.deepEqual(result.head, { id: '42', format: 'json' });
    });

    it('sets req.get to undefined (HEAD has its own req.head)', function() {
        var result = processHeadQuery({ q: 'test' });
        assert.strictEqual(result.get, undefined);
    });

    it('sets req.post to undefined for HEAD', function() {
        var result = processHeadQuery({ q: 'test' });
        assert.strictEqual(result.post, undefined);
    });

    it('sets req.put to undefined for HEAD', function() {
        var result = processHeadQuery({ q: 'test' });
        assert.strictEqual(result.put, undefined);
    });

    it('sets req.head to empty object when no query params', function() {
        var result = processHeadQuery({});
        assert.deepEqual(result.head, {});
    });

    it('HEAD does not set req.body (HEAD has no request body)', function() {
        var result = processHeadQuery({ id: '1' });
        assert.ok(!('body' in result), 'HEAD processing should not set req.body');
    });

    it('GET routes automatically match HEAD — verified in server.js source', function() {
        var src = fs.readFileSync(SERVER_SRC, 'utf8');
        assert.ok(/\/\^head\$\/i\.test\(req\.method\)\s*&&\s*\/\^get\$\/i\.test\(_routing\.method\)/.test(src),
            'server.js must have HEAD→GET fallback in isMethodAllowed');
    });

    it('HEAD response body is suppressed — req.head holds same data as GET would in req.get', function() {
        var getResult = { get: { page: '2', q: 'gina' } };
        var headResult = processHeadQuery({ page: '2', q: 'gina' });
        // Same params, different storage key
        assert.deepEqual(headResult.head, getResult.get);
    });
});


// ─── 10 — server.js source: method-routing fix (405 continue instead of break) ─

describe('10 - method-routing fix: server.js source structure', function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    it('_methodMismatch405msg variable is declared in handle()', function() {
        assert.ok(/_methodMismatch405msg\s*=\s*null/.test(src),
            'server.js must declare _methodMismatch405msg = null');
    });

    it('method mismatch assigns _methodMismatch405msg and uses continue (not break)', function() {
        // Must assign message then continue scanning — not break
        // Find the specific mismatch assignment (not the initialisation = null)
        var assignStr = "_methodMismatch405msg = 'Method Not Allowed";
        var idx = src.indexOf(assignStr);
        assert.ok(idx >= 0, 'server.js must set _methodMismatch405msg on method mismatch');
        // `continue` must appear within ~200 chars after the assignment
        var context = src.slice(idx, idx + 250);
        assert.ok(/continue/.test(context),
            'method mismatch assignment must be followed by continue (not break)');
    });

    it('does NOT have a bare break immediately after method mismatch assignment', function() {
        // Old code had: throwError(405) + break; new code: assign message + continue
        var assignStr = "_methodMismatch405msg = 'Method Not Allowed";
        var lines = src.split('\n');
        var mismatchLine = lines.findIndex(function(l) { return l.indexOf(assignStr) >= 0; });
        assert.ok(mismatchLine >= 0, 'mismatch assignment line not found');
        // Next non-blank line must be `continue`, not `break` or `throwError`
        var next = lines.slice(mismatchLine + 1).find(function(l) { return /\S/.test(l); }) || '';
        assert.ok(/\bcontinue\b/.test(next), 'line after mismatch assignment must be continue, got: ' + next.trim());
        assert.ok(!/\bbreak\b/.test(next), 'line after mismatch assignment must not be break');
    });

    it('404 check after loop only fires when no match AND no method mismatch was recorded', function() {
        // The 405 guard must come BEFORE the generic 404
        var idx405 = src.indexOf('if (!matched && _methodMismatch405msg)');
        var idx404 = src.indexOf("throwError(res, 404, 'Page not found");
        assert.ok(idx405 >= 0, '405 guard not found in server.js');
        assert.ok(idx404 >= 0, '404 handler not found in server.js');
        assert.ok(idx405 < idx404, '405 guard must come before generic 404');
    });
});


// ─── 11 — inline logic: method-routing 405 after full scan ────────────────────

describe('11 - method-routing fix: inline scan logic', function() {

    /**
     * Minimal replica of the server.js routing loop that implements the fix:
     * – continue on method mismatch (not break)
     * – emit 405 only if no route matched AND a method mismatch was recorded
     */
    function runScan(routes, reqMethod, reqUrl) {
        var matched = false;
        var _methodMismatch405msg = null;

        for (var name in routes) {
            var route = routes[name];
            if (route.url !== reqUrl) continue;            // URL doesn't match
            if (route.method !== reqMethod) {
                // method mismatch — record but KEEP scanning
                _methodMismatch405msg = 'Method Not Allowed';
                continue;
            }
            matched = true;
            break;
        }

        if (!matched && _methodMismatch405msg) return { status: 405, matched: false };
        if (!matched)                           return { status: 404, matched: false };
        return { status: 200, matched: true };
    }

    it('GET /notes matches list-notes and returns 200', function() {
        var routes = {
            'list-notes':   { url: '/notes', method: 'GET' },
            'create-note':  { url: '/notes', method: 'POST' }
        };
        assert.deepEqual(runScan(routes, 'GET',  '/notes'), { status: 200, matched: true });
    });

    it('POST /notes matches create-note and returns 200 (GET rule does not break the scan)', function() {
        var routes = {
            'list-notes':   { url: '/notes', method: 'GET' },
            'create-note':  { url: '/notes', method: 'POST' }
        };
        assert.deepEqual(runScan(routes, 'POST', '/notes'), { status: 200, matched: true });
    });

    it('PUT /notes returns 405 when only GET and POST are declared', function() {
        var routes = {
            'list-notes':   { url: '/notes', method: 'GET' },
            'create-note':  { url: '/notes', method: 'POST' }
        };
        assert.deepEqual(runScan(routes, 'PUT',  '/notes'), { status: 405, matched: false });
    });

    it('GET /unknown returns 404 (no URL match at all, not 405)', function() {
        var routes = {
            'list-notes':   { url: '/notes', method: 'GET' },
            'create-note':  { url: '/notes', method: 'POST' }
        };
        assert.deepEqual(runScan(routes, 'GET',  '/unknown'), { status: 404, matched: false });
    });

    it('DELETE /notes returns 405 after scanning all three routes', function() {
        var routes = {
            'r1': { url: '/notes', method: 'GET' },
            'r2': { url: '/notes', method: 'POST' },
            'r3': { url: '/notes', method: 'PUT' }
        };
        assert.deepEqual(runScan(routes, 'DELETE', '/notes'), { status: 405, matched: false });
    });

    it('first route method mismatch does NOT stop the scan — second route with correct method wins', function() {
        // This is the core regression: old `break` would stop after the GET mismatch
        var routes = {
            'wrong-method': { url: '/api', method: 'GET' },
            'correct':      { url: '/api', method: 'POST' }
        };
        assert.deepEqual(runScan(routes, 'POST', '/api'), { status: 200, matched: true });
    });
});


// ─── 12 — body parser: '+' → space decoding for application/x-www-form-urlencoded ───

describe("12 - body parser: '+' → space decoding for application/x-www-form-urlencoded", function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    // Source-level pins: confirm the urlencoded test fires WHEN content-type IS urlencoded
    // (no leading ! on the inner test) at all three sites — POST, PUT, PATCH branches.

    it('POST branch: urlencoded test fires WHEN content-type IS urlencoded (no leading !)', function() {
        var postCase = src.slice(src.indexOf("case 'post':"), src.indexOf("case 'put':"));
        assert.match(
            postCase,
            /if\s*\(\s*\/application\\\/x\\-www\\-form\\-urlencoded\/\.test\(request\.headers\['content-type'\]\)\s*&&\s*\/\\\+\/\.test\(request\.body\)\s*\)/,
            'POST branch must check IS urlencoded (no leading !) and short-circuit on absent + char'
        );
    });

    it('PUT branch: urlencoded test fires WHEN content-type IS urlencoded (no leading !)', function() {
        var putCase = src.slice(src.indexOf("case 'put':"), src.indexOf("case 'delete':"));
        assert.match(
            putCase,
            /if\s*\(\s*\/application\\\/x\\-www\\-form\\-urlencoded\/\.test\(request\.headers\['content-type'\]\)\s*\)/,
            'PUT branch must check IS urlencoded (no leading !)'
        );
    });

    it('PATCH branch: urlencoded test fires WHEN content-type IS urlencoded (no leading !)', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.match(
            patchCase,
            /if\s*\(\s*\/application\\\/x\\-www\\-form\\-urlencoded\/\.test\(request\.headers\['content-type'\]\)\s*&&\s*\/\\\+\/\.test\(request\.body\)\s*\)/,
            'PATCH branch must check IS urlencoded (no leading !) and short-circuit on absent + char'
        );
    });

    // Negative-invariant lock: no inverted shape remains anywhere in server.js.
    it('no inverted (!/...urlencoded.../) tests remain in server.js', function() {
        var inverted = src.match(/!\s*\/application\\\/x\\-www\\-form\\-urlencoded\/\.test/g) || [];
        assert.strictEqual(inverted.length, 0, 'inverted urlencoded tests must not return — would re-introduce the +→space spec inversion');
    });

    // Pure-logic replica of the corrected body-parser transform shared across
    // POST/PUT/PATCH branches (the +→space step plus decodeURIComponent).
    function parseBodyAfterFix(body, contentType) {
        if (typeof body !== 'string') return body;
        if (/multipart\/form-data;/.test(contentType || '')) return body;
        if (/application\/x-www-form-urlencoded/.test(contentType || '')) {
            body = body.replace(/\+/g, ' ');
        }
        if (body.substring(0, 1) === '?') body = body.substring(1);
        try { return decodeURIComponent(body); } catch (e) { return body; }
    }

    // Positive cases — urlencoded path

    it("urlencoded body 'name=Hello+World' decodes to 'name=Hello World'", function() {
        var bodyStr = parseBodyAfterFix('name=Hello+World', 'application/x-www-form-urlencoded');
        assert.strictEqual(bodyStr, 'name=Hello World');
    });

    it("urlencoded body 'name=Hello%20World' still decodes to 'name=Hello World' (decodeURIComponent path)", function() {
        var bodyStr = parseBodyAfterFix('name=Hello%20World', 'application/x-www-form-urlencoded');
        assert.strictEqual(bodyStr, 'name=Hello World');
    });

    it('urlencoded body: mixed + and %20 both decode to space', function() {
        var bodyStr = parseBodyAfterFix('a=Hello+World&b=Hi%20there', 'application/x-www-form-urlencoded');
        assert.strictEqual(bodyStr, 'a=Hello World&b=Hi there');
    });

    it('URLSearchParams.toString() output → urlencoded branch yields decoded space', function() {
        var params = new URLSearchParams({ name: 'Hello World' });
        // URLSearchParams.toString() encodes space as '+'
        assert.ok(/\+/.test(params.toString()), 'URLSearchParams must encode space as +');
        var bodyStr = parseBodyAfterFix(params.toString(), 'application/x-www-form-urlencoded');
        assert.strictEqual(bodyStr, 'name=Hello World');
    });

    // Negative cases — non-urlencoded paths preserve literal '+'

    it("JSON body '{\"version\":\"1.0+rc1\"}' is preserved (no '+' → space replacement)", function() {
        var bodyStr = parseBodyAfterFix('{"version":"1.0+rc1"}', 'application/json');
        assert.strictEqual(bodyStr, '{"version":"1.0+rc1"}');
    });

    it("JSON body parsed: literal '+' survives to the controller", function() {
        var bodyStr = parseBodyAfterFix('{"version":"1.0+rc1"}', 'application/json');
        var obj = JSON.parse(bodyStr);
        assert.strictEqual(obj.version, '1.0+rc1');
    });

    it("multipart body: '+' is left untouched (multipart guard skips the inner branch)", function() {
        var bodyStr = parseBodyAfterFix('name=Hello+World', 'multipart/form-data; boundary=----abc');
        assert.strictEqual(bodyStr, 'name=Hello+World');
    });

    it("text/plain body: '+' is preserved (not urlencoded, no replacement)", function() {
        var bodyStr = parseBodyAfterFix('Hello+World', 'text/plain');
        assert.strictEqual(bodyStr, 'Hello+World');
    });

    it("missing content-type header: '+' is preserved (defensive — no replacement without explicit urlencoded)", function() {
        var bodyStr = parseBodyAfterFix('Hello+World', undefined);
        assert.strictEqual(bodyStr, 'Hello+World');
    });
});


// ─── 13 — body parser: application/json parsed verbatim (no decode, no coercion) — #B28 ───

describe('13 - body parser: application/json verbatim parse (no url-decode, no coercion) — #B28', function() {

    var src;
    before(function() { src = fs.readFileSync(SERVER_SRC, 'utf8'); });

    // Source-level pins: each of POST/PUT/PATCH must branch on application/json
    // and JSON.parse the raw request.body (bypassing decodeURIComponent + the
    // "true"/"false"/"on"/"null" coercion + formatDataFromString bracket-expansion).

    it('POST branch: has an application/json check that JSON.parse(request.body) verbatim', function() {
        var postCase = src.slice(src.indexOf("case 'post':"), src.indexOf("case 'put':"));
        assert.match(postCase, /\/application\\\/json\/i\.test\(request\.headers\['content-type'\]\)/,
            'POST must branch on application/json');
        assert.match(postCase, /obj\s*=\s*JSON\.parse\(request\.body\)/,
            'POST json branch must JSON.parse(request.body) verbatim');
    });

    it('PUT branch: has an application/json check that JSON.parse(request.body) verbatim', function() {
        var putCase = src.slice(src.indexOf("case 'put':"), src.indexOf("case 'delete':"));
        assert.match(putCase, /\/application\\\/json\/i\.test\(request\.headers\['content-type'\]\)/,
            'PUT must branch on application/json');
        assert.match(putCase, /obj\s*=\s*JSON\.parse\(request\.body\)/,
            'PUT json branch must JSON.parse(request.body) verbatim');
    });

    it('PATCH branch: has an application/json check that JSON.parse(request.body) verbatim', function() {
        var patchCase = src.slice(src.indexOf("case 'patch':"), src.indexOf("case 'head':"));
        assert.match(patchCase, /\/application\\\/json\/i\.test\(request\.headers\['content-type'\]\)/,
            'PATCH must branch on application/json');
        assert.match(patchCase, /obj\s*=\s*JSON\.parse\(request\.body\)/,
            'PATCH json branch must JSON.parse(request.body) verbatim');
    });

    // The json branch must NOT route application/json through formatDataFromString
    // (that helper is the one that double-decodes + coerces). Pin it stays only on
    // the urlencoded / GET / HEAD paths, never inside an application/json branch.
    it('the application/json branches do not call formatDataFromString', function() {
        // For each method, the substring between the application/json test and the
        // closing of its branch (the `} else {`) must not contain formatDataFromString.
        ['post', 'put', 'patch'].forEach(function(m) {
            var nextCase = { post: 'put', put: 'delete', patch: 'head' }[m];
            var caseSrc  = src.slice(src.indexOf("case '" + m + "':"), src.indexOf("case '" + nextCase + "':"));
            var jsonIdx  = caseSrc.indexOf("/application\\/json/i.test");
            assert.ok(jsonIdx >= 0, m + ' must have an application/json branch');
            var branch   = caseSrc.slice(jsonIdx, caseSrc.indexOf('} else {', jsonIdx));
            assert.doesNotMatch(branch, /formatDataFromString/,
                m + ' json branch must not call formatDataFromString');
            assert.doesNotMatch(branch, /decodeURIComponent/,
                m + ' json branch must not url-decode');
        });
    });

    // Pure-logic replicas: the NEW json branch (verbatim) vs the LEGACY decode+coerce
    // path that application/json bodies wrongly flowed through before #B28.

    function parseJsonBranch(body) {
        // #B28 — application/json: verbatim, no decodeURIComponent, no coercion
        return JSON.parse(body);
    }

    function legacyDecodeCoerce(body) {
        // the pre-#B28 path: decodeURIComponent + "true"/"false"/"on"/"null" coercion
        var bodyStr;
        try { bodyStr = decodeURIComponent(body); } catch (e) { bodyStr = body; }
        bodyStr = bodyStr
            .replace(/"false"/g, false)
            .replace(/"true"/g, true)
            .replace(/"on"/g, true)
            .replace(/"null"/ig, null);
        return JSON.parse(bodyStr);
    }

    it('%XX inside a JSON string value is PRESERVED (was corrupted by decodeURIComponent)', function() {
        assert.strictEqual(parseJsonBranch('{"v":"50%20off"}').v, '50%20off',
            'json branch must not url-decode %XX inside a string value');
        // contrast: the legacy decode path is exactly what corrupted it
        assert.strictEqual(legacyDecodeCoerce('{"v":"50%20off"}').v, '50 off',
            'sanity: legacy decodeURIComponent turned 50%20off into "50 off"');
    });

    it('a JSON string value "true" stays the string "true" (was coerced to boolean)', function() {
        var v = parseJsonBranch('{"active":"true"}');
        assert.strictEqual(v.active, 'true');
        assert.strictEqual(typeof v.active, 'string');
        assert.strictEqual(legacyDecodeCoerce('{"active":"true"}').active, true);
    });

    it('a JSON string value "false" stays the string "false"', function() {
        assert.strictEqual(parseJsonBranch('{"active":"false"}').active, 'false');
        assert.strictEqual(legacyDecodeCoerce('{"active":"false"}').active, false);
    });

    it('a JSON string value "null" stays the string "null" (was coerced to null)', function() {
        assert.strictEqual(parseJsonBranch('{"x":"null"}').x, 'null');
        assert.strictEqual(legacyDecodeCoerce('{"x":"null"}').x, null);
    });

    it('real JSON types are preserved verbatim (boolean, number, null, nested object)', function() {
        var v = parseJsonBranch('{"b":true,"n":42,"z":null,"o":{"k":"v"}}');
        assert.strictEqual(v.b, true);
        assert.strictEqual(v.n, 42);
        assert.strictEqual(v.z, null);
        assert.deepEqual(v.o, { k: 'v' });
    });

    it('a literal bracket-notation JSON key is preserved (no form-style expansion)', function() {
        var v = parseJsonBranch('{"a[b]":1}');
        assert.deepEqual(v, { 'a[b]': 1 });
        assert.ok('a[b]' in v, 'json branch keeps the literal key, does not expand a[b] → {a:{b}}');
    });

    it('a literal + in a JSON string value is preserved', function() {
        assert.strictEqual(parseJsonBranch('{"v":"1.0+rc1"}').v, '1.0+rc1');
    });
});
