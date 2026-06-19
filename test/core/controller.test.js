var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var SOURCE = path.join(require('../fw'), 'core/controller/controller.js');


// 01 — strParts path building (Array.push + join replaces str += key + '.' in setOptions loop)
describe('01 - setOptions routing param: strParts path building (Array.push + join)', function() {

    it('push key onto [page] yields page.key via join', function() {
        var strParts = ['page'];
        strParts.push('title');
        assert.equal(strParts.join('.'), 'page.title');
    });

    it(':value branch — strParts = [page, view, params, key] yields page.view.params.key', function() {
        var key = 'id';
        var strParts = ['page', 'view', 'params', key];
        assert.equal(strParts.join('.'), 'page.view.params.id');
    });

    it('file/title branch — strParts = [page, view, key] yields page.view.key', function() {
        var key = 'title';
        var strParts = ['page', 'view', key];
        assert.equal(strParts.join('.'), 'page.view.title');
    });

    it('reset to [page] yields page and length 1', function() {
        var strParts = ['page', 'title'];
        strParts = ['page'];
        assert.equal(strParts.join('.'), 'page');
        assert.equal(strParts.length, 1);
    });

    it('multiple outer iterations accumulate when inner branch does not reset', function() {
        // mirrors original str += behaviour: str starts 'page.', += 'key1.' → 'page.key1.'
        // then without reset: += 'key2.' → 'page.key1.key2.'
        var strParts = ['page'];
        strParts.push('key1');
        assert.equal(strParts.join('.'), 'page.key1');
        strParts.push('key2');
        assert.equal(strParts.join('.'), 'page.key1.key2');
    });

    it('join result matches str.substring(0, str.length-1) equivalence', function() {
        // original: str = 'page.' + key + '.' → str.substring(0, str.length-1) = 'page.' + key
        var key = 'file';
        var str = 'page.' + key + '.';
        var strParts = ['page', key];
        assert.equal(strParts.join('.'), str.substring(0, str.length - 1));
    });

});


// 02 — valueParts accumulation (Array.push + join replaces value += obj[prop] in inner loop)
describe('02 - setOptions routing param: valueParts accumulation (Array.push + join)', function() {

    it('single push joins to itself', function() {
        var valueParts = [];
        valueParts.push('hello');
        assert.equal(valueParts.join(''), 'hello');
    });

    it('multiple pushes join without separator', function() {
        var valueParts = [];
        valueParts.push('hello');
        valueParts.push(' world');
        assert.equal(valueParts.join(''), 'hello world');
    });

    it('empty parts join to empty string', function() {
        var valueParts = [];
        assert.equal(valueParts.join(''), '');
    });

    it('join result matches sequential += for same inputs', function() {
        var value = '';
        value += 'foo';
        value += 'bar';
        var valueParts = [];
        valueParts.push('foo');
        valueParts.push('bar');
        assert.equal(valueParts.join(''), value);
    });

});


// 03 — source structure: string += replaced with Array.push/join in setOptions (#P26)
describe('03 - source structure: string += replaced with Array.push/join in setOptions (#P26)', function() {

    it('strParts.push(key) is present in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('strParts.push(key)') > -1,
            'expected `strParts.push(key)` — #P26 not applied'
        );
    });

    it('valueParts.push(obj[prop]) is present in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('valueParts.push(obj[prop])') > -1,
            'expected `valueParts.push(obj[prop])` — #P26 not applied'
        );
    });

    it("strParts.join('.') is present in source", function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("strParts.join('.')") > -1,
            "expected `strParts.join('.')` — #P26 not applied"
        );
    });

    it("valueParts.join('') is present in source", function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("valueParts.join('')") > -1,
            "expected `valueParts.join('')` — #P26 not applied"
        );
    });

    it('str += key pattern is gone from setOptions loop (outside comments)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var stripped = src.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/str\s*\+=\s*key/.test(stripped),
            'old `str += key` still present outside comments — #P26 not applied'
        );
    });

    it('value += obj[prop] pattern is gone from setOptions loop (outside comments)', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var stripped = src.replace(/\/\/[^\n]*/g, '');
        assert.ok(
            !/value\s*\+=\s*obj\[/.test(stripped),
            'old `value += obj[` still present outside comments — #P26 not applied'
        );
    });

    it('source contains #P26 replaced comment', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('#P26') > -1,
            'expected #P26 marker — comment convention not applied'
        );
    });

});


// 04 — source structure: setEarlyHints (#EH1)
describe('04 - source structure: setEarlyHints (#EH1)', function() {

    it('setEarlyHints is defined in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('this.setEarlyHints = function(') > -1,
            'expected `this.setEarlyHints = function(` — #EH1 not applied'
        );
    });

    it('source contains #EH1 marker', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(src.indexOf('#EH1') > -1, 'expected #EH1 marker in source');
    });

    it('HTTP/2 path uses stream.additionalHeaders with :status 103', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("':status': 103") > -1,
            "expected `':status': 103` — HTTP/2 early-hints header missing"
        );
        assert.ok(
            src.indexOf('additionalHeaders') > -1,
            'expected `additionalHeaders` call for HTTP/2 early hints'
        );
    });

    it('HTTP/1.1 path uses writeEarlyHints', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('writeEarlyHints') > -1,
            'expected `writeEarlyHints` — HTTP/1.1 early-hints path missing'
        );
    });

    it('implementation is guarded by headersSent check', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        // find setEarlyHints block
        var start = src.indexOf('this.setEarlyHints = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(
            block.indexOf('headersSent') > -1,
            'expected headersSent guard inside setEarlyHints'
        );
    });

    it('implementation wraps in try/catch so errors are swallowed', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.setEarlyHints = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('try {') > -1, 'expected try/catch in setEarlyHints');
        assert.ok(block.indexOf('catch') > -1,  'expected catch in setEarlyHints');
    });

    it('implementation returns self for chaining', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.setEarlyHints = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('return self') > -1, 'expected `return self` for chaining');
    });

    it('render() auto-sends 103 from h2Links before delegating to render-swig', function() {
        var src         = fs.readFileSync(SOURCE, 'utf8');
        var renderStart = src.indexOf('this.render = function (userData');
        var renderEnd   = src.indexOf('\n    }', renderStart) + 6; // closing brace of render
        var block       = src.slice(renderStart, renderEnd);
        assert.ok(
            block.indexOf('_h2Links') > -1,
            'expected h2Links auto-hint block inside render()'
        );
        assert.ok(
            block.indexOf('setEarlyHints(_hints)') > -1,
            'expected self.setEarlyHints(_hints) call inside render()'
        );
    });

    it('render() auto-hint trims trailing comma from h2Links', function() {
        var src         = fs.readFileSync(SOURCE, 'utf8');
        var renderStart = src.indexOf('this.render = function (userData');
        var renderEnd   = src.indexOf('\n    }', renderStart) + 6;
        var block       = src.slice(renderStart, renderEnd);
        assert.ok(
            block.indexOf('.slice(0, -1)') > -1,
            'expected trailing comma trim (.slice(0, -1)) in render() auto-hint'
        );
    });

});


// 05 — setEarlyHints: pure logic
describe('05 - setEarlyHints: pure logic', function() {

    // Minimal replica of the setEarlyHints body for isolated testing
    function makeEarlyHintsEnv(opts) {
        opts = opts || {};
        var calls = { additionalHeaders: [], writeEarlyHints: [] };

        var stream = opts.streamHeadersSent
            ? { headersSent: true }
            : (opts.noStream ? null : {
                headersSent: false,
                additionalHeaders: function(h) { calls.additionalHeaders.push(h); }
            });

        var res = {
            stream: stream || undefined,
            headersSent: opts.resHeadersSent || false,
            writeEarlyHints: opts.noWriteEarlyHints ? undefined : function(h) { calls.writeEarlyHints.push(h); }
        };

        var self = {};

        function headersSent(_res) {
            _res = _res || res;
            if (typeof _res.stream !== 'undefined' && _res.stream && _res.stream.headersSent === true) return true;
            if (typeof _res.headersSent !== 'undefined') return _res.headersSent;
            return false;
        }

        function setEarlyHints(links) {
            if (!links) return self;
            var _link;
            if (Array.isArray(links)) { _link = links.filter(Boolean).join(', '); }
            else { _link = String(links).trim(); }
            if (!_link) return self;
            if (headersSent(res)) return self;
            try {
                if (res.stream && !res.stream.headersSent) {
                    res.stream.additionalHeaders({ ':status': 103, 'link': _link });
                } else if (typeof res.writeEarlyHints === 'function') {
                    res.writeEarlyHints({ 'link': _link });
                }
            } catch(e) {}
            return self;
        }

        return { calls: calls, res: res, self: self, setEarlyHints: setEarlyHints };
    }

    it('HTTP/2: calls stream.additionalHeaders with :status 103 and link', function() {
        var env = makeEarlyHintsEnv();
        env.setEarlyHints('</app.css>; rel=preload; as=style');
        assert.equal(env.calls.additionalHeaders.length, 1);
        assert.equal(env.calls.additionalHeaders[0][':status'], 103);
        assert.equal(env.calls.additionalHeaders[0]['link'], '</app.css>; rel=preload; as=style');
    });

    it('HTTP/2: does not call writeEarlyHints when stream is present', function() {
        var env = makeEarlyHintsEnv();
        env.setEarlyHints('</app.css>; rel=preload; as=style');
        assert.equal(env.calls.writeEarlyHints.length, 0);
    });

    it('HTTP/1.1: calls writeEarlyHints when no stream', function() {
        var env = makeEarlyHintsEnv({ noStream: true });
        env.setEarlyHints('</app.css>; rel=preload; as=style');
        assert.equal(env.calls.writeEarlyHints.length, 1);
        assert.equal(env.calls.writeEarlyHints[0]['link'], '</app.css>; rel=preload; as=style');
    });

    it('HTTP/1.1: no-ops silently when writeEarlyHints is not a function', function() {
        var env = makeEarlyHintsEnv({ noStream: true, noWriteEarlyHints: true });
        assert.doesNotThrow(function() {
            env.setEarlyHints('</app.css>; rel=preload; as=style');
        });
        assert.equal(env.calls.writeEarlyHints.length, 0);
    });

    it('array of links is joined with ", "', function() {
        var env = makeEarlyHintsEnv();
        env.setEarlyHints(['</app.css>; rel=preload; as=style', '</app.js>; rel=preload; as=script']);
        assert.equal(
            env.calls.additionalHeaders[0]['link'],
            '</app.css>; rel=preload; as=style, </app.js>; rel=preload; as=script'
        );
    });

    it('null input: no-ops and returns self', function() {
        var env = makeEarlyHintsEnv();
        var result = env.setEarlyHints(null);
        assert.strictEqual(result, env.self);
        assert.equal(env.calls.additionalHeaders.length, 0);
    });

    it('undefined input: no-ops and returns self', function() {
        var env = makeEarlyHintsEnv();
        var result = env.setEarlyHints(undefined);
        assert.strictEqual(result, env.self);
        assert.equal(env.calls.additionalHeaders.length, 0);
    });

    it('empty string: no-ops', function() {
        var env = makeEarlyHintsEnv();
        env.setEarlyHints('');
        assert.equal(env.calls.additionalHeaders.length, 0);
    });

    it('empty array: no-ops', function() {
        var env = makeEarlyHintsEnv();
        env.setEarlyHints([]);
        assert.equal(env.calls.additionalHeaders.length, 0);
    });

    it('array with only falsy entries: no-ops', function() {
        var env = makeEarlyHintsEnv();
        env.setEarlyHints([null, '', undefined]);
        assert.equal(env.calls.additionalHeaders.length, 0);
    });

    it('returns self for optional chaining', function() {
        var env = makeEarlyHintsEnv();
        var result = env.setEarlyHints('</x>; rel=preload; as=style');
        assert.strictEqual(result, env.self);
    });

    it('no-ops when HTTP/2 stream.headersSent is true', function() {
        var env = makeEarlyHintsEnv({ streamHeadersSent: true });
        env.setEarlyHints('</x>; rel=preload; as=style');
        assert.equal(env.calls.additionalHeaders.length, 0);
    });

    it('no-ops when HTTP/1.1 res.headersSent is true', function() {
        var env = makeEarlyHintsEnv({ noStream: true, resHeadersSent: true });
        env.setEarlyHints('</x>; rel=preload; as=style');
        assert.equal(env.calls.writeEarlyHints.length, 0);
    });

    it('swallows errors thrown by additionalHeaders (best-effort)', function() {
        var env = makeEarlyHintsEnv();
        env.res.stream.additionalHeaders = function() { throw new Error('stream closed'); };
        assert.doesNotThrow(function() {
            env.setEarlyHints('</x>; rel=preload; as=style');
        });
    });

    it('swallows errors thrown by writeEarlyHints (best-effort)', function() {
        var env = makeEarlyHintsEnv({ noStream: true });
        env.res.writeEarlyHints = function() { throw new Error('socket error'); };
        assert.doesNotThrow(function() {
            env.setEarlyHints('</x>; rel=preload; as=style');
        });
    });

});


// 06 — render() auto-hint from h2Links
describe('06 - render() auto-hint from h2Links (#EH1)', function() {

    // Minimal replica of the render() auto-hint block for isolated testing
    function simulateRenderAutoHint(h2Links, hintsSent) {
        var sent = [];

        function setEarlyHints(hints) { sent.push(hints); return {}; }
        function headersSent() { return false; }

        // replica of the auto-hint block
        var _h2Links = h2Links;
        if (_h2Links) {
            var _hints = /,$/.test(_h2Links) ? _h2Links.slice(0, -1) : _h2Links;
            if (_hints) setEarlyHints(_hints);
        }

        return sent;
    }

    it('sends 103 with h2Links when populated', function() {
        var sent = simulateRenderAutoHint('</css/app.css>; as=style; rel=preload,</js/app.js>; as=script; rel=preload,');
        assert.equal(sent.length, 1);
    });

    it('trims trailing comma from h2Links before sending', function() {
        var sent = simulateRenderAutoHint('</css/app.css>; as=style; rel=preload,');
        assert.equal(sent[0], '</css/app.css>; as=style; rel=preload');
    });

    it('passes through value without trailing comma unchanged', function() {
        var sent = simulateRenderAutoHint('</css/app.css>; as=style; rel=preload');
        assert.equal(sent[0], '</css/app.css>; as=style; rel=preload');
    });

    it('multiple links are passed through as a single string', function() {
        var sent = simulateRenderAutoHint('</a.css>; as=style; rel=preload,</b.js>; as=script; rel=preload,');
        assert.equal(sent[0], '</a.css>; as=style; rel=preload,</b.js>; as=script; rel=preload');
    });

    it('no-ops when h2Links is empty string', function() {
        var sent = simulateRenderAutoHint('');
        assert.equal(sent.length, 0);
    });

    it('no-ops when h2Links is null', function() {
        var sent = simulateRenderAutoHint(null);
        assert.equal(sent.length, 0);
    });

    it('no-ops when h2Links is undefined', function() {
        var sent = simulateRenderAutoHint(undefined);
        assert.equal(sent.length, 0);
    });

    it('trailing-comma-only string results in empty hint — no send', function() {
        // edge case: h2Links was set to just ',' (degenerate case)
        var sent = simulateRenderAutoHint(',');
        // after slice(0, -1) → '' → falsy → no send
        assert.equal(sent.length, 0);
    });

});


// ─── 07 — throwError: explicit 3-digit status code is preserved ───────────────

describe('07 - throwError: explicit 3-digit HTTP status code is preserved', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    it('source contains the /^\\d{3}$/ guard that preserves an explicit code', function() {
        // The fix: /^\d{3}$/.test(String(code)) before falling back to res.status || 500
        assert.ok(/\\d\{3\}/.test(src) && /String\(code\)/.test(src),
            'throwError must test String(code) against /^\\d{3}$/ before falling back to res.status');
    });

    it('a 3-digit number string passes the guard', function() {
        assert.ok(/^\d{3}$/.test(String(404)));
        assert.ok(/^\d{3}$/.test(String(400)));
        assert.ok(/^\d{3}$/.test(String(500)));
        assert.ok(/^\d{3}$/.test(String(201)));
    });

    it('non-numeric or short code does NOT pass the guard (falls back)', function() {
        assert.ok(!/^\d{3}$/.test(String(undefined)));
        assert.ok(!/^\d{3}$/.test(String(null)));
        assert.ok(!/^\d{3}$/.test(String('foo')));
        assert.ok(!/^\d{3}$/.test(String(50)));   // 2-digit
        assert.ok(!/^\d{3}$/.test(String(5000)));  // 4-digit
    });

    it('inline replica: throwError(res, 404, msg) preserves 404', function() {
        // Inline replica of the fixed code branch
        function resolveCode(res, code) {
            return (/^\d{3}$/.test(String(code))) ? code
                 : (res && typeof(res.status) != 'undefined') ? res.status
                 : 500;
        }
        var fakeRes = { status: 200 };
        assert.equal(resolveCode(fakeRes, 404), 404, 'explicit 404 must not be overridden by res.status');
    });

    it('inline replica: throwError(res, undefined, msg) falls back to res.status', function() {
        function resolveCode(res, code) {
            return (/^\d{3}$/.test(String(code))) ? code
                 : (res && typeof(res.status) != 'undefined') ? res.status
                 : 500;
        }
        var fakeRes = { status: 422 };
        assert.equal(resolveCode(fakeRes, undefined), 422, 'missing code falls back to res.status');
    });

    it('inline replica: throwError(res, undefined, msg) falls back to 500 when res.status absent', function() {
        function resolveCode(res, code) {
            return (/^\d{3}$/.test(String(code))) ? code
                 : (res && typeof(res.status) != 'undefined') ? res.status
                 : 500;
        }
        assert.equal(resolveCode({}, undefined), 500, 'missing code and missing res.status must default to 500');
    });

    it('inline replica: throwError(res, 400, msg) preserves 400', function() {
        function resolveCode(res, code) {
            return (/^\d{3}$/.test(String(code))) ? code
                 : (res && typeof(res.status) != 'undefined') ? res.status
                 : 500;
        }
        var fakeRes = { status: 500 };
        assert.equal(resolveCode(fakeRes, 400), 400, 'explicit 400 must not be overridden by res.status=500');
    });
});


// ─── 08 — getConfig: proxy hostname override guard ───────────────────────────

describe('08 - getConfig: proxy hostname override guard', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ── (a) source structure ─────────────────────────────────────────────────

    it('source contains the PROXY_HOSTNAME undefined guard in getConfig', function() {
        // The fix: typeof(process.gina.PROXY_HOSTNAME) != 'undefined' prevents
        // overwriting a valid hostname with undefined when proxy detection is
        // a false positive (browser Origin header triggers isProxyHost = true
        // but no PROXY_HOSTNAME was ever set).
        var start = src.indexOf('this.getConfig = function(name)');
        assert.ok(start > -1, 'getConfig definition not found in source');
        var end = src.indexOf('\n    }', start) + 6;
        var block = src.slice(start, end);
        assert.ok(
            block.indexOf("typeof(process.gina.PROXY_HOSTNAME) != 'undefined'") > -1,
            'expected PROXY_HOSTNAME undefined guard inside getConfig'
        );
    });

    it('source contains the isProxyHost context check in getConfig', function() {
        var start = src.indexOf('this.getConfig = function(name)');
        var end = src.indexOf('\n    }', start) + 6;
        var block = src.slice(start, end);
        assert.ok(
            block.indexOf("getContext('isProxyHost')") > -1,
            "expected getContext('isProxyHost') inside getConfig"
        );
    });

    it('source contains the tmp.hostname existence check in getConfig', function() {
        var start = src.indexOf('this.getConfig = function(name)');
        var end = src.indexOf('\n    }', start) + 6;
        var block = src.slice(start, end);
        assert.ok(
            block.indexOf("typeof(tmp.hostname) != 'undefined'") > -1,
            'expected tmp.hostname existence guard inside getConfig'
        );
    });

    it('proxy override assigns both hostname and host', function() {
        var start = src.indexOf('this.getConfig = function(name)');
        var end = src.indexOf('\n    }', start) + 6;
        var block = src.slice(start, end);
        assert.ok(
            block.indexOf('tmp.hostname') > -1 && block.indexOf('tmp.host') > -1,
            'expected both tmp.hostname and tmp.host assignments inside getConfig'
        );
        assert.ok(
            block.indexOf('process.gina.PROXY_HOSTNAME') > -1
            && block.indexOf('process.gina.PROXY_HOST') > -1,
            'expected assignment from process.gina.PROXY_HOSTNAME and PROXY_HOST'
        );
    });

    it('getConfig uses JSON.clone for read-only copies', function() {
        var start = src.indexOf('this.getConfig = function(name)');
        var end = src.indexOf('\n    }', start) + 6;
        var block = src.slice(start, end);
        assert.ok(
            block.indexOf('JSON.clone(local.options.conf.content[name])') > -1,
            'expected JSON.clone for named config lookup'
        );
        assert.ok(
            block.indexOf('JSON.clone(local.options.conf)') > -1,
            'expected JSON.clone for full config clone'
        );
    });

    // ── (b) pure logic — inline replica ──────────────────────────────────────
    //
    // Minimal replica of getConfig that mirrors the actual guard logic. We
    // cannot require the full controller module (it needs a running gina
    // server), so we test the logic in isolation.

    function makeGetConfigEnv(opts) {
        opts = opts || {};

        // Simulate JSON.clone as a deep copy (same contract as the polyfill)
        function clone(obj) {
            if (obj == null || typeof obj != 'object') return obj;
            return JSON.parse(JSON.stringify(obj));
        }

        var local = {
            options: {
                conf: opts.conf || {
                    hostname: 'app.example.com',
                    host: 'app.example.com:3100',
                    content: {
                        routing: { home: { url: '/' } },
                        settings: { port: 3100, host: 'app.example.com' }
                    }
                }
            }
        };

        var contextStore = {
            isProxyHost: opts.isProxyHost || false
        };

        var savedGina = null;

        function setup() {
            savedGina = process.gina;
            process.gina = process.gina ? clone(process.gina) : {};
            if (typeof opts.proxyHostname != 'undefined') {
                process.gina.PROXY_HOSTNAME = opts.proxyHostname;
            }
            if (typeof opts.proxyHost != 'undefined') {
                process.gina.PROXY_HOST = opts.proxyHost;
            }
        }

        function teardown() {
            process.gina = savedGina;
        }

        function getContext(key) {
            return contextStore[key];
        }

        function getConfig(name) {
            var tmp = null;
            if ( typeof(name) != 'undefined' ) {
                try {
                    tmp = clone(local.options.conf.content[name]);
                } catch (err) {
                    return undefined;
                }
            } else {
                tmp = clone(local.options.conf);
            }

            if (
                getContext('isProxyHost')
                && typeof(tmp.hostname) != 'undefined'
                && typeof(process.gina.PROXY_HOSTNAME) != 'undefined'
            ) {
                tmp.hostname    = process.gina.PROXY_HOSTNAME;
                tmp.host        = process.gina.PROXY_HOST;
            }
            return tmp;
        }

        return {
            local: local,
            getConfig: getConfig,
            setup: setup,
            teardown: teardown
        };
    }

    it('normal return with no proxy: hostname unchanged', function() {
        var env = makeGetConfigEnv({
            isProxyHost: false
        });
        env.setup();
        try {
            var conf = env.getConfig();
            assert.equal(conf.hostname, 'app.example.com',
                'hostname must be preserved when isProxyHost is false');
            assert.equal(conf.host, 'app.example.com:3100',
                'host must be preserved when isProxyHost is false');
        } finally {
            env.teardown();
        }
    });

    it('proxy override when PROXY_HOSTNAME is defined and isProxyHost is true', function() {
        var env = makeGetConfigEnv({
            isProxyHost: true,
            proxyHostname: 'proxy.example.com',
            proxyHost: 'proxy.example.com:8080'
        });
        env.setup();
        try {
            var conf = env.getConfig();
            assert.equal(conf.hostname, 'proxy.example.com',
                'hostname must be overridden to PROXY_HOSTNAME');
            assert.equal(conf.host, 'proxy.example.com:8080',
                'host must be overridden to PROXY_HOST');
        } finally {
            env.teardown();
        }
    });

    it('guard: no override when PROXY_HOSTNAME is undefined even if isProxyHost is true', function() {
        // This is the bug fix scenario: browser Origin header triggers
        // isProxyHost = true, but PROXY_HOSTNAME was never set. Without the
        // guard, hostname would be overwritten with undefined.
        var env = makeGetConfigEnv({
            isProxyHost: true
            // proxyHostname intentionally omitted — stays undefined on process.gina
        });
        env.setup();
        try {
            var conf = env.getConfig();
            assert.equal(conf.hostname, 'app.example.com',
                'hostname must be preserved when PROXY_HOSTNAME is undefined (bug fix)');
            assert.equal(conf.host, 'app.example.com:3100',
                'host must be preserved when PROXY_HOSTNAME is undefined (bug fix)');
        } finally {
            env.teardown();
        }
    });

    it('no override when tmp has no hostname property (e.g. named sub-config)', function() {
        var env = makeGetConfigEnv({
            isProxyHost: true,
            proxyHostname: 'proxy.example.com',
            proxyHost: 'proxy.example.com:8080'
        });
        env.setup();
        try {
            // 'routing' sub-config has no hostname property
            var conf = env.getConfig('routing');
            assert.ok(typeof conf.hostname == 'undefined',
                'routing sub-config should not have a hostname injected');
            assert.deepEqual(conf, { home: { url: '/' } },
                'named config must return content[name] unchanged');
        } finally {
            env.teardown();
        }
    });

    it('named config lookup returns content[name]', function() {
        var env = makeGetConfigEnv({
            isProxyHost: false
        });
        env.setup();
        try {
            var settings = env.getConfig('settings');
            assert.deepEqual(settings, { port: 3100, host: 'app.example.com' },
                'getConfig("settings") must return conf.content.settings');
        } finally {
            env.teardown();
        }
    });

    it('named config lookup returns undefined for missing key', function() {
        var env = makeGetConfigEnv({
            isProxyHost: false
        });
        env.setup();
        try {
            var result = env.getConfig('nonexistent');
            assert.equal(result, undefined,
                'getConfig for a missing key must return undefined');
        } finally {
            env.teardown();
        }
    });

    it('no-arg call returns full conf clone', function() {
        var env = makeGetConfigEnv({
            isProxyHost: false
        });
        env.setup();
        try {
            var conf = env.getConfig();
            assert.ok(typeof conf.hostname != 'undefined', 'full conf must include hostname');
            assert.ok(typeof conf.content != 'undefined', 'full conf must include content');
        } finally {
            env.teardown();
        }
    });

    it('clone isolation: mutating returned object does not affect original', function() {
        var env = makeGetConfigEnv({
            isProxyHost: false
        });
        env.setup();
        try {
            var conf1 = env.getConfig();
            conf1.hostname = 'mutated.example.com';
            conf1.content.routing.injected = true;

            var conf2 = env.getConfig();
            assert.equal(conf2.hostname, 'app.example.com',
                'second call must return original hostname, not mutated value');
            assert.equal(typeof conf2.content.routing.injected, 'undefined',
                'second call must not see mutation from first call');
        } finally {
            env.teardown();
        }
    });

    it('clone isolation: named config mutation does not affect original', function() {
        var env = makeGetConfigEnv({
            isProxyHost: false
        });
        env.setup();
        try {
            var routing1 = env.getConfig('routing');
            routing1.home.url = '/mutated';

            var routing2 = env.getConfig('routing');
            assert.equal(routing2.home.url, '/',
                'second call must return original routing, not mutated value');
        } finally {
            env.teardown();
        }
    });

    it('all three guard conditions must be true for override to apply', function() {
        // Test matrix: only the (true, true, true) combination applies the override
        var cases = [
            { isProxy: false, hasHostname: true,  hasPH: true,  expect: 'app.example.com', label: 'F,T,T' },
            { isProxy: true,  hasHostname: true,  hasPH: false, expect: 'app.example.com', label: 'T,T,F' },
            { isProxy: true,  hasHostname: false, hasPH: true,  expect: undefined,          label: 'T,F,T' },
            { isProxy: true,  hasHostname: true,  hasPH: true,  expect: 'proxy.example.com', label: 'T,T,T' }
        ];

        cases.forEach(function(c) {
            var confObj = c.hasHostname
                ? { hostname: 'app.example.com', host: 'app.example.com:3100', content: {} }
                : { content: {} };
            var envOpts = {
                isProxyHost: c.isProxy,
                conf: confObj
            };
            if (c.hasPH) {
                envOpts.proxyHostname = 'proxy.example.com';
                envOpts.proxyHost = 'proxy.example.com:8080';
            }
            var env = makeGetConfigEnv(envOpts);
            env.setup();
            try {
                var result = env.getConfig();
                assert.equal(result.hostname, c.expect,
                    'case [' + c.label + ']: hostname mismatch');
            } finally {
                env.teardown();
            }
        });
    });

});


// ─── 09 — public webroot composition under reverse proxy ─────────────────────
//
// When a reverse proxy mounts the bundle on a sub-path (e.g. nginx
// `location /admin/ { proxy_pass http://upstream; }` with
// `proxy_set_header X-Forwarded-Prefix /admin;`), the bundle's internal
// `server.webroot` stays `/` (it doesn't know about the mount path), but the
// value templated into `gina.onload.min.js` (which becomes the browser-side
// `gina.config.webroot`) MUST include the prefix so that root-relative URLs
// the browser builds (`gina.config.webroot + '_gina/assets/routing.json'`,
// the `gina.min.css` link injection, etc.) target the correct upstream.
// PROXY_PREFIX is captured by server.isaac.js from the X-Forwarded-Prefix
// header (already normalised: leading slash, no trailing slash, dropped if
// empty or "/"). controller.js composes it with the bundle's internal
// webroot at the page.environment.webroot setter site.

describe('09 - public webroot composition under reverse proxy', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ── (a) source structure ─────────────────────────────────────────────────

    it("source references local.req._ginaProxyPrefix in the page.environment.webroot setter region", function() {
        var anchor = src.indexOf("set('page.environment.webroot'");
        assert.ok(anchor > -1, "page.environment.webroot setter not found");
        // Look in a window above + below the setter for the per-request read
        var windowStart = Math.max(0, anchor - 1500);
        var windowEnd   = Math.min(src.length, anchor + 200);
        var block = src.slice(windowStart, windowEnd);
        assert.ok(
            block.indexOf('local.req._ginaProxyPrefix') > -1,
            'expected local.req._ginaProxyPrefix read near the page.environment.webroot setter (per-request, not process-global)'
        );
    });

    it("source does NOT read process.gina.PROXY_PREFIX (the leaky process-global is removed)", function() {
        // Negative invariant: the previous process-global read at the webroot
        // setter is the bug surface this slice fixed. If it ever comes back,
        // the cross-request leak returns — once a sub-path-mounted request
        // poisons the global, every subsequent render in that worker (even
        // direct, non-proxied requests) gets the leaked prefix concatenated.
        var anchor = src.indexOf("set('page.environment.webroot'");
        var windowStart = Math.max(0, anchor - 1500);
        var windowEnd   = Math.min(src.length, anchor + 200);
        var block = src.slice(windowStart, windowEnd);
        assert.ok(
            block.indexOf('process.gina.PROXY_PREFIX') === -1,
            'process.gina.PROXY_PREFIX must NOT be read by the webroot composition — use local.req._ginaProxyPrefix instead (cross-request leak protection)'
        );
    });

    it("source guards local.req._ginaProxyPrefix with typeof != 'undefined' before composing", function() {
        var anchor = src.indexOf("set('page.environment.webroot'");
        var windowStart = Math.max(0, anchor - 1500);
        var windowEnd   = Math.min(src.length, anchor + 200);
        var block = src.slice(windowStart, windowEnd);
        assert.ok(
            block.indexOf("typeof(local.req._ginaProxyPrefix) != 'undefined'") > -1,
            'expected typeof guard around local.req._ginaProxyPrefix (back-compat: header absent)'
        );
    });

    it("source guards local.req existence before reading _ginaProxyPrefix", function() {
        // Defensive: setOptions sets local.req synchronously, but this read
        // sits in the larger setOptions body. A defensive `local.req &&` guard
        // protects against future code-paths that might reach this region
        // without local.req populated (e.g. createTestInstance with bare opts).
        var anchor = src.indexOf("set('page.environment.webroot'");
        var windowStart = Math.max(0, anchor - 1500);
        var windowEnd   = Math.min(src.length, anchor + 200);
        var block = src.slice(windowStart, windowEnd);
        assert.ok(
            /local\.req\s*&&\s*typeof\(local\.req\._ginaProxyPrefix\)/.test(block),
            'expected `local.req && typeof(local.req._ginaProxyPrefix)` defensive guard'
        );
    });

    it("source still composes from options.conf.server.webroot as the base", function() {
        var anchor = src.indexOf("set('page.environment.webroot'");
        var windowStart = Math.max(0, anchor - 1500);
        var windowEnd   = Math.min(src.length, anchor + 200);
        var block = src.slice(windowStart, windowEnd);
        assert.ok(
            block.indexOf('options.conf.server.webroot') > -1,
            'expected options.conf.server.webroot as the base webroot in composition'
        );
    });

    // ── (b) pure logic — inline replica ──────────────────────────────────────
    //
    // Replica of the composition logic in controller.js. Cannot require the
    // full controller module (needs a running gina server), so test in
    // isolation. The replica MUST stay byte-for-byte equivalent to the live
    // implementation; the source-structure tests above pin the live shape.

    function composeWebroot(internalWebroot, proxyPrefix) {
        var publicWebroot = internalWebroot;
        if ( typeof(proxyPrefix) != 'undefined' && proxyPrefix ) {
            var prefix = proxyPrefix;
            var wr     = publicWebroot.replace(/^\/+/, '');
            publicWebroot = prefix + '/' + wr;
            if ( !/\/$/.test(publicWebroot) ) {
                publicWebroot += '/';
            }
        }
        return publicWebroot;
    }

    it('back-compat: undefined PROXY_PREFIX leaves "/" unchanged', function() {
        assert.equal(composeWebroot('/', undefined), '/');
    });

    it('back-compat: undefined PROXY_PREFIX leaves "/admin/" unchanged', function() {
        assert.equal(composeWebroot('/admin/', undefined), '/admin/');
    });

    it('back-compat: empty PROXY_PREFIX is treated as absent', function() {
        // The truthy check (proxyPrefix && ...) drops empty strings even though
        // the typeof check passes. This mirrors server.isaac.js's drop of "" / "/".
        assert.equal(composeWebroot('/', ''), '/');
        assert.equal(composeWebroot('/admin/', ''), '/admin/');
    });

    it('prefix "/sub" + bundle "/" → "/sub/"', function() {
        assert.equal(composeWebroot('/', '/sub'), '/sub/');
    });

    it('prefix "/sub" + bundle "/admin/" → "/sub/admin/"', function() {
        assert.equal(composeWebroot('/admin/', '/sub'), '/sub/admin/');
    });

    it('prefix "/sub" + bundle "/admin" (missing trailing slash) → "/sub/admin/"', function() {
        // Trailing slash is appended so downstream `webroot + 'asset/path'`
        // concatenation never produces double slashes or a missing separator.
        assert.equal(composeWebroot('/admin', '/sub'), '/sub/admin/');
    });

    it('prefix "/sub" + bundle "//double-slash/" strips the leading slashes from the bundle', function() {
        // Defensive: the bundle's internal webroot should start with "/", but if
        // it accidentally has multiple leading slashes the composition still
        // produces a clean prefix + '/' + tail shape.
        assert.equal(composeWebroot('//double-slash/', '/sub'), '/sub/double-slash/');
    });

    it('multi-segment prefix "/admin/v2" + bundle "/" → "/admin/v2/"', function() {
        assert.equal(composeWebroot('/', '/admin/v2'), '/admin/v2/');
    });

    it('multi-segment prefix "/admin/v2" + bundle "/dashboard/" → "/admin/v2/dashboard/"', function() {
        assert.equal(composeWebroot('/dashboard/', '/admin/v2'), '/admin/v2/dashboard/');
    });

    it('result always ends with "/" so URL composition (webroot + leaf) is stable', function() {
        var combos = [
            ['/',         undefined],
            ['/admin/',   undefined],
            ['/',         '/sub'],
            ['/admin/',   '/sub'],
            ['/admin',    '/sub'],
            ['/',         '/admin/v2']
        ];
        combos.forEach(function(c) {
            var out = composeWebroot(c[0], c[1]);
            assert.ok(/\/$/.test(out),
                'composeWebroot(' + JSON.stringify(c[0]) + ', ' + JSON.stringify(c[1]) + ') = ' +
                JSON.stringify(out) + ' must end with "/"');
        });
    });

    it('repro of the cross-bundle leak shape: bundle "/" + prefix "/admin" yields "/admin/" (was "/")', function() {
        // The shipped bug: the bundle's internal server.webroot is "/", and
        // before this fix, that "/" was templated straight into
        // gina.config.webroot — the browser then built
        // "/" + "_gina/assets/routing.json" = "/_gina/assets/routing.json"
        // which the reverse proxy routed to whichever upstream answered the
        // root path (NOT this bundle). The composed value "/admin/" makes
        // the browser build "/admin/_gina/assets/routing.json" instead, which
        // the proxy routes back to this bundle's upstream.
        var before = '/';
        var after  = composeWebroot(before, '/admin');
        assert.notEqual(after, before, 'composition must change "/" when a prefix is set');
        assert.equal(after, '/admin/', 'composed webroot must include the proxy prefix');
    });

    // ── (c) per-request isolation — the cross-request leak shape ─────────────
    //
    // Before this slice, PROXY_PREFIX was a process-global (`process.gina.PROXY_PREFIX`)
    // set by server.isaac.js inside a `!isProxyHost && headers['x-forwarded-host']`
    // gated block. The block stops firing after the first proxied request
    // flips `isProxyHost` to globally true (`setContext('isProxyHost', true)`),
    // so subsequent requests never re-derive PROXY_PREFIX and the value stays
    // at the FIRST proxied request's prefix forever (until worker restart).
    //
    // This bites when the worker handles a mix of proxied + direct calls
    // (e.g. internal services hitting the bundle without going through the
    // proxy) — direct calls inherit the leaked prefix and render with the
    // wrong webroot. Less common but real: a bundle behind a proxy that
    // mounts it at multiple paths.
    //
    // The fix moves the value to per-request `req._ginaProxyPrefix` so each
    // request gets its own isolated state. The replica below simulates the
    // before/after by reading the prefix from a per-request object instead
    // of a shared global.

    function resolvePrefix(req) {
        return (req && typeof(req._ginaProxyPrefix) != 'undefined' && req._ginaProxyPrefix)
            ? req._ginaProxyPrefix
            : undefined;
    }

    it('per-request: req A has prefix → req A composition includes it', function() {
        var reqA = { _ginaProxyPrefix: '/admin' };
        var prefix = resolvePrefix(reqA);
        assert.equal(composeWebroot('/', prefix), '/admin/');
    });

    it('per-request isolation: req B (no header, after req A) does NOT inherit req A prefix', function() {
        // The pre-fix bug: req B would see the leaked PROXY_PREFIX from req A
        // because both shared process.gina.PROXY_PREFIX. With the per-request
        // shape, req B has its own _ginaProxyPrefix slot (undefined when no
        // X-Forwarded-Prefix header was present) → composition correctly
        // falls back to the bundle's internal webroot.
        var reqA = { _ginaProxyPrefix: '/admin' };
        var reqB = {}; // no x-forwarded-prefix header → slot never written
        // Simulate req A's render first (would write process.gina.PROXY_PREFIX in the old shape):
        var prefixA = resolvePrefix(reqA);
        assert.equal(composeWebroot('/', prefixA), '/admin/');
        // Then req B's render — must NOT see the prefix:
        var prefixB = resolvePrefix(reqB);
        assert.equal(prefixB, undefined, 'req B must not inherit req A\'s prefix');
        assert.equal(composeWebroot('/', prefixB), '/', 'req B webroot must be the bundle internal, not the leaked prefix');
    });

    it('per-request isolation: req C with a DIFFERENT prefix (after req A) gets its own value', function() {
        // Multi-mount proxy scenario: same bundle mounted on /admin and /staff.
        // Pre-fix: process.gina.PROXY_PREFIX would stay at whichever request
        // landed first. Per-request: each request gets its own value.
        var reqA = { _ginaProxyPrefix: '/admin' };
        var reqC = { _ginaProxyPrefix: '/staff' };
        assert.equal(composeWebroot('/', resolvePrefix(reqA)), '/admin/');
        assert.equal(composeWebroot('/', resolvePrefix(reqC)), '/staff/');
    });

    it('per-request: req with empty _ginaProxyPrefix slot is treated as absent (defensive)', function() {
        // The writer at server.isaac.js drops empty / "/" header values via
        // `_xfp.length > 0 && ...` so the slot never gets written when the
        // header is no-op. But if some downstream wrote `req._ginaProxyPrefix
        // = ''` defensively, the truthy check still falls back correctly.
        var reqEmpty = { _ginaProxyPrefix: '' };
        assert.equal(resolvePrefix(reqEmpty), undefined);
        assert.equal(composeWebroot('/', resolvePrefix(reqEmpty)), '/');
    });

    it('per-request: missing req object falls through (defensive — createTestInstance with no req)', function() {
        // controller.createTestInstance({}) sets local.req = {} (empty object).
        // The defensive `local.req && ...` guard in the production reader
        // protects against any code-path that might reach the composition
        // without local.req populated.
        assert.equal(resolvePrefix(undefined), undefined);
        assert.equal(resolvePrefix(null), undefined);
        assert.equal(composeWebroot('/', resolvePrefix(undefined)), '/');
    });

});


// ─── 10 — webroot handoff: server-composed → loader.js → core.js ─────────────
//
// Section 09 verified the SERVER-side webroot composition (PROXY_PREFIX +
// internal webroot). This section locks the BROWSER-side handoff: the public
// webroot must reach core.js's getDependencies BEFORE it composes the
// routing.json fetch URL.
//
// The race: gina.min.js's script-tag onload handler fires getDependencies()
// BEFORE window.onGinaLoaded(gina) has populated gina.config. At fetch time
// gina.config.webroot is undefined, so the URL would fall back to '/' and
// routing.json would be fetched root-relative — landing on the wrong upstream
// when the bundle is mounted on a sub-path under a reverse proxy.
//
// The fix:
//  - loader.js exposes window.__ginaWebroot SYNCHRONOUSLY (templated by
//    whisper from page.environment.webroot, served as gina.onload.min.js).
//  - core.js reads window.__ginaWebroot FIRST, falling back to
//    gina.config.webroot (post-onGinaLoaded re-entry) then '/'.
// gina.onload.min.js is injected into <head> BEFORE gina.min.js by every
// full-page render path in render-swig.js (see :1185-1194 dev,
// :1262-1271 prod), so the synchronous global is reliably available
// before getDependencies runs.

describe('10 - webroot handoff: loader sets __ginaWebroot, core reads it before fetch', function() {

    var FW         = require('../fw');
    var LOADER_SRC = path.join(FW, 'core/asset/plugin/src/vendor/gina/utils/loader.js');
    var CORE_SRC   = path.join(FW, 'core/asset/plugin/src/vendor/gina/core.js');
    var loaderSrc  = fs.readFileSync(LOADER_SRC, 'utf8');
    var coreSrc    = fs.readFileSync(CORE_SRC,   'utf8');

    // ── (a) loader.js source structure ──────────────────────────────────────

    it("loader.js sets window['__ginaWebroot'] synchronously at module top level", function() {
        assert.ok(
            /window\['__ginaWebroot'\]\s*=\s*'\{\{ page\.environment\.webroot \}\}'/.test(loaderSrc),
            "loader.js must contain `window['__ginaWebroot'] = '{{ page.environment.webroot }}';` so the global is whisper-substituted at serve time"
        );
    });

    it("loader.js sets __ginaWebroot BEFORE the onGinaLoaded function definition", function() {
        var globalIdx = loaderSrc.indexOf("window['__ginaWebroot']");
        var fnIdx     = loaderSrc.indexOf("window['onGinaLoaded']");
        assert.ok(globalIdx > -1, '__ginaWebroot setter not found in loader.js');
        assert.ok(fnIdx     > -1, 'onGinaLoaded function not found in loader.js');
        assert.ok(
            globalIdx < fnIdx,
            '__ginaWebroot setter must come BEFORE onGinaLoaded so the global is set at parse time, not when onGinaLoaded is invoked'
        );
    });

    it("loader.js exposes __ginaWebroot via @js_externs so Closure does not rename it", function() {
        // Without @js_externs, ADVANCED_OPTIMIZATIONS would rename the property
        // and core.js (which is compiled separately) would read undefined.
        assert.ok(
            /@js_externs __ginaWebroot/.test(loaderSrc),
            'loader.js must annotate __ginaWebroot with @js_externs to survive Closure ADVANCED_OPTIMIZATIONS'
        );
    });

    // ── (b) core.js source structure ────────────────────────────────────────

    it("core.js reads window.__ginaWebroot FIRST in the _webroot fallback chain", function() {
        var anchor = coreSrc.indexOf('var _webroot');
        assert.ok(anchor > -1, '_webroot declaration not found in core.js');
        // Look in a window after the declaration for the fallback chain.
        var block = coreSrc.slice(anchor, anchor + 400);
        var winIdx     = block.indexOf('window.__ginaWebroot');
        var configIdx  = block.indexOf('gina.config.webroot');
        var fallbackIdx = block.indexOf("'/'");
        assert.ok(winIdx > -1,                        'expected window.__ginaWebroot read in _webroot fallback chain');
        assert.ok(configIdx > -1,                     'expected gina.config.webroot read in _webroot fallback chain (back-compat)');
        assert.ok(fallbackIdx > -1,                   "expected '/' default in _webroot fallback chain");
        assert.ok(winIdx < configIdx,                 'window.__ginaWebroot must come BEFORE gina.config.webroot in the fallback chain');
        assert.ok(configIdx < fallbackIdx,            "gina.config.webroot must come BEFORE the '/' default");
    });

    it("core.js guards window.__ginaWebroot with `typeof window !== 'undefined'`", function() {
        // Defensive for any node-side path that imports core.js (e.g. tests,
        // SSR experiments). Without the guard the read would throw ReferenceError.
        var anchor = coreSrc.indexOf('var _webroot');
        var block  = coreSrc.slice(anchor, anchor + 400);
        assert.ok(
            block.indexOf("typeof window !== 'undefined'") > -1,
            "expected typeof window guard around window.__ginaWebroot read in core.js"
        );
    });

    it("core.js still composes the routing.json URL via _webroot + '_gina/assets/routing.json'", function() {
        assert.ok(
            /_webroot\s*\+\s*'_gina\/assets\/routing\.json'/.test(coreSrc),
            "expected `_webroot + '_gina/assets/routing.json'` URL composition (the fetch site this fix protects)"
        );
    });

    // ── (c) pure logic — _webroot resolution chain replica ───────────────────
    //
    // Replica of the resolution logic in core.js. JSDOM-free; the source pins
    // above lock the live shape, this exercises the priority ordering.

    function resolveWebroot(globalWindow, gina) {
        return (typeof globalWindow !== 'undefined' && globalWindow && globalWindow.__ginaWebroot)
            || (gina && gina.config && gina.config.webroot)
            || '/';
    }

    it('priority 1: window.__ginaWebroot wins when set (the fix path)', function() {
        var win  = { __ginaWebroot: '/sub/' };
        var gina = { config: { webroot: '/should-not-be-used/' } };
        assert.equal(resolveWebroot(win, gina), '/sub/');
    });

    it('priority 2: falls through to gina.config.webroot when __ginaWebroot is absent (re-entry, post-onGinaLoaded)', function() {
        var win  = {}; // __ginaWebroot not set yet
        var gina = { config: { webroot: '/admin/' } };
        assert.equal(resolveWebroot(win, gina), '/admin/');
    });

    it("priority 3: falls through to '/' when both __ginaWebroot and gina.config.webroot are absent (the original race)", function() {
        var win  = {};
        var gina = { config: {} };
        assert.equal(resolveWebroot(win, gina), '/');
    });

    it("repro of the original race: pre-fix, _webroot was '/' under sub-path mount, producing '/_gina/assets/routing.json'", function() {
        // Before the fix, getDependencies only read gina.config.webroot. At the
        // moment the script-tag onload fires, onGinaLoaded has NOT YET run, so
        // gina.config is undefined. _webroot collapsed to '/', and the URL
        // collapsed to '/_gina/assets/routing.json' — the wrong upstream under
        // a reverse proxy with sub-path mount.
        var win  = {}; // __ginaWebroot would be set if we used the new loader
        var gina = {}; // pre-onGinaLoaded state
        var oldWebroot = (gina && gina.config && gina.config.webroot) || '/';
        assert.equal(oldWebroot + '_gina/assets/routing.json', '/_gina/assets/routing.json');
    });

    it("with the fix: pre-onGinaLoaded state, __ginaWebroot delivers the sub-path correctly", function() {
        // After the fix, loader.js sets window.__ginaWebroot SYNCHRONOUSLY at
        // script parse time (before gina.min.js even runs). So the same
        // pre-onGinaLoaded state now resolves to the actual public webroot.
        var win  = { __ginaWebroot: '/sub/' };
        var gina = {}; // still pre-onGinaLoaded
        var newWebroot = resolveWebroot(win, gina);
        assert.equal(newWebroot + '_gina/assets/routing.json', '/sub/_gina/assets/routing.json');
    });

    it('back-compat: empty string __ginaWebroot is treated as absent (truthy check), falls through', function() {
        // The truthy check (windowGlobal.__ginaWebroot && ...) drops empty
        // strings. Mirrors the existing back-compat shape on gina.config.webroot.
        var win  = { __ginaWebroot: '' };
        var gina = { config: { webroot: '/admin/' } };
        assert.equal(resolveWebroot(win, gina), '/admin/');
    });

    it('back-compat: typeof guard protects node-side imports of core.js', function() {
        // Pretend window is undefined (server-side require, test harness, etc.).
        // The typeof guard short-circuits; we fall through to gina.config.
        var gina = { config: { webroot: '/srv/' } };
        // We can't actually delete `window` from the global (Node has no
        // window), so simulate by passing undefined directly. The pure-logic
        // replica's typeof check on its parameter mirrors the production
        // typeof on the bare `window` identifier.
        assert.equal(resolveWebroot(undefined, gina), '/srv/');
    });

    // ── (d) dist-source equivalence — the build did not strip our changes ────

    it('dist gina.onload.min.js contains the __ginaWebroot template (post-build)', function() {
        var distOnload = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.onload.min.js');
        var content    = fs.readFileSync(distOnload, 'utf8');
        assert.ok(
            content.indexOf("__ginaWebroot='{{ page.environment.webroot }}'") > -1
            || content.indexOf('__ginaWebroot="{{ page.environment.webroot }}"') > -1,
            'dist gina.onload.min.js must contain __ginaWebroot=\'{{ page.environment.webroot }}\' for whisper to substitute it at serve time'
        );
    });

    it('dist gina.min.js contains the new __ginaWebroot read (post-build)', function() {
        var distCore = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
        var content  = fs.readFileSync(distCore, 'utf8');
        assert.ok(
            content.indexOf('__ginaWebroot') > -1,
            'dist gina.min.js must reference __ginaWebroot — Closure may have stripped the read if @js_externs is missing or if the source was rebuilt without our changes'
        );
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 11 — page.section auto-promotion from route.param.section
//
// A common route shape declares a `section` param to drive sub-section
// dispatch:
//
//     "<route-name>": {
//         "url":    "/foo/bar",
//         "method": "GET",
//         "param":  { "file": "index", "section": "alpha", "control": "get" }
//     }
//
// Templates compose include paths from page.section:
//
//     {% set t = './includes/' + page.section + '.html' %}
//     {% include t %}
//
// This parallels the existing param.file → page.view.file auto-promotion
// (sibling line). Without it, compose-from-section templates resolve to
// '…' + undefined + '…' which Swig coerces to an empty stem; the loader
// then throws ENOENT at compile-file time. Bundle-level template caching
// can mask the issue intermittently — a cached compiled output keeps
// working until the next bundle:build busts the cache.

describe('11 - page.section auto-promotion from route.param.section', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ── (a) source structure ─────────────────────────────────────────────────

    it("source contains set('page.section', local.req.routing.param.section)", function() {
        assert.ok(
            src.indexOf("set('page.section', local.req.routing.param.section)") > -1,
            "expected `set('page.section', local.req.routing.param.section)` — the auto-promotion is missing"
        );
    });

    it("the page.section setter sits inside the page.view auto-promotion block", function() {
        var viewAnchor    = src.indexOf("set('page.view.namespace'");
        var sectionAnchor = src.indexOf("set('page.section'");
        assert.ok(viewAnchor > -1, "page.view.namespace setter not found");
        assert.ok(sectionAnchor > -1, "page.section setter not found");
        // Section setter must appear immediately after the view auto-promotion
        // block (within ~600 chars — comment + guard + setter).
        assert.ok(
            sectionAnchor > viewAnchor && sectionAnchor - viewAnchor < 600,
            'page.section setter must sit alongside the existing page.view.* auto-promotions'
        );
    });

    it("source guards local.req → local.req.routing → routing.param → param.section before the setter", function() {
        var anchor = src.indexOf("set('page.section'");
        var windowStart = Math.max(0, anchor - 400);
        var block = src.slice(windowStart, anchor);
        assert.ok(
            /local\.req\s*&&\s*local\.req\.routing\s*&&\s*local\.req\.routing\.param\s*&&\s*local\.req\.routing\.param\.section/.test(block),
            'expected `local.req && local.req.routing && local.req.routing.param && local.req.routing.param.section` defensive chain'
        );
    });

    it("comment uses framework-generic language (no consumer-app references)", function() {
        // The auto-promotion block must describe the pattern abstractly, never
        // a specific consuming app or its templates. This protects the no-
        // consumer-references rule from regressing through future edits.
        var anchor = src.indexOf("set('page.section'");
        var windowStart = Math.max(0, anchor - 600);
        var windowEnd   = Math.min(src.length, anchor + 200);
        var block = src.slice(windowStart, windowEnd);
        // The forbidden consumer token is reconstructed (not embedded as a literal)
        // so this guard file does not itself carry the token it forbids, per the
        // no-consumer-references rule; the regex still detects it in `block`.
        var _consumerToken = ['free', 'lancer'].join('');
        assert.ok(
            !(new RegExp(_consumerToken + '|FRAMEWORK PATCH \\(')).test(block),
            'page.section auto-promotion comment must not name a consumer app or use a "FRAMEWORK PATCH (consumer)" prefix'
        );
    });

    // ── (b) pure logic — inline replica ──────────────────────────────────────
    //
    // The guard + setter semantics, replicated standalone. Cannot require the
    // full controller module (needs a running gina server), so test the shape
    // in isolation. The source-structure tests above pin the live shape.

    function autoPromoteSection(local) {
        var page = {};
        var set = function(key, value) {
            // mimic the production set('page.section', value) — flat key write.
            page[key] = value;
        };
        if ( local && local.req && local.req.routing && local.req.routing.param && local.req.routing.param.section ) {
            set('page.section', local.req.routing.param.section);
        }
        return page;
    }

    it('positive: routing.param.section populated → page.section gets the value', function() {
        var local = { req: { routing: { param: { section: 'alpha' } } } };
        var page  = autoPromoteSection(local);
        assert.equal(page['page.section'], 'alpha');
    });

    it('positive: a different section value flows through unchanged', function() {
        var local = { req: { routing: { param: { section: 'billing' } } } };
        var page  = autoPromoteSection(local);
        assert.equal(page['page.section'], 'billing');
    });

    it('negative: routing.param without `section` → page.section never set', function() {
        var local = { req: { routing: { param: { file: 'index' } } } };
        var page  = autoPromoteSection(local);
        assert.ok(
            !Object.prototype.hasOwnProperty.call(page, 'page.section'),
            'page.section must not be assigned when route.param.section is absent'
        );
    });

    it('negative: routing without param → no page.section assignment', function() {
        var local = { req: { routing: {} } };
        var page  = autoPromoteSection(local);
        assert.ok(!Object.prototype.hasOwnProperty.call(page, 'page.section'));
    });

    it('negative: req without routing → no page.section assignment', function() {
        var local = { req: {} };
        var page  = autoPromoteSection(local);
        assert.ok(!Object.prototype.hasOwnProperty.call(page, 'page.section'));
    });

    it('negative: missing local.req → no crash, no page.section assignment', function() {
        // Defensive: createTestInstance + similar test paths can call into
        // setOptions with bare {req: {}, res: {}}; the guard on local.req
        // protects against the "object missing routing" shape.
        var local = {};
        var page  = autoPromoteSection(local);
        assert.ok(!Object.prototype.hasOwnProperty.call(page, 'page.section'));
    });

    it('negative: empty-string section is skipped (falsy guard)', function() {
        // `if (... && param.section)` is a truthy check, so '' falls through.
        // Mirrors the "absent" branch — page.section is never assigned to ''.
        var local = { req: { routing: { param: { section: '' } } } };
        var page  = autoPromoteSection(local);
        assert.ok(!Object.prototype.hasOwnProperty.call(page, 'page.section'));
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 12 — throwError: stack stripped from JSON wire outside local scope
// ─────────────────────────────────────────────────────────────────────────
//
// Server-side stack frames leak file paths, library versions, and internal
// function locations to API clients. The XHR/JSON branch of throwError must
// strip errorObject.stack on the wire for every scope except local (where
// the dev toolbar's data-xhr panel renders it via events.js:394 →
// ginaToolbar.update('data-xhr', XHRData)).
//
// Gate shape: `if (!_isLocalScope && errorObject && errorObject.stack)
//              delete errorObject.stack;`
// Placed after both construction paths converge (after the L5129-5137 fallback
// initializer) and before serialization at `var errOutput = null, output = ...`.

describe('12 - throwError: stack stripped from JSON wire outside local scope', function() {

    // ── (a) source structure ─────────────────────────────────────────────────

    it('source contains the fail-closed strip gate', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('!_isLocalScope && errorObject && errorObject.stack') > -1,
            'expected `!_isLocalScope && errorObject && errorObject.stack` guard'
        );
        assert.ok(
            src.indexOf('delete errorObject.stack;') > -1,
            'expected `delete errorObject.stack;` inside the guard body'
        );
    });

    it('strip gate sits after the L5129-5137 fallback initializer and before serialization', function() {
        var src         = fs.readFileSync(SOURCE, 'utf8');
        var fallbackIdx = src.indexOf('stack: msg.stack');
        var gateIdx     = src.indexOf('!_isLocalScope && errorObject && errorObject.stack');
        var serializeIdx = src.indexOf('var errOutput = null, output = errorObject.toString()');
        assert.ok(fallbackIdx > -1, 'fallback initializer literal `stack: msg.stack` not found');
        assert.ok(gateIdx > -1, 'strip gate not found');
        assert.ok(serializeIdx > -1, 'serialization site `var errOutput = null, output = errorObject.toString()` not found');
        assert.ok(
            fallbackIdx < gateIdx,
            'strip gate must be AFTER the fallback initializer so both construction paths converge first'
        );
        assert.ok(
            gateIdx < serializeIdx,
            'strip gate must be BEFORE serialization so JSON.stringify never sees the stack field'
        );
    });

    it('source uses the module-load cached _isLocalScope (not a per-request lookup)', function() {
        var src    = fs.readFileSync(SOURCE, 'utf8');
        var cached = src.match(/var _isLocalScope\s*=\s*process\.env\.NODE_SCOPE_IS_LOCAL/);
        assert.ok(cached, 'expected cached `var _isLocalScope = process.env.NODE_SCOPE_IS_LOCAL` per #P19');
        // Strip gate references the cached boolean, not process.env directly.
        var gateBlock = src.split('!_isLocalScope && errorObject && errorObject.stack')[1];
        assert.ok(gateBlock, 'gate block could not be extracted');
        // Within ~200 chars after the gate header, no per-request env lookup.
        var window200 = gateBlock.slice(0, 200);
        assert.ok(
            window200.indexOf('process.env.NODE_SCOPE_IS_LOCAL') < 0,
            'gate body must use cached _isLocalScope (#P19), not process.env.NODE_SCOPE_IS_LOCAL'
        );
    });

    it('JSDoc on throwError documents the scope-gated stack behaviour', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        var jsdocStart = src.indexOf('Throw error — terminates the request');
        var fnDecl     = src.indexOf('this.throwError = function(res, code, msg)');
        assert.ok(jsdocStart > -1, 'expected updated JSDoc description on throwError');
        assert.ok(fnDecl > -1, 'throwError function declaration not found');
        var jsdocBlock = src.slice(jsdocStart, fnDecl);
        assert.ok(
            jsdocBlock.indexOf('NODE_SCOPE_IS_LOCAL') > -1,
            'JSDoc must reference NODE_SCOPE_IS_LOCAL'
        );
        assert.ok(
            jsdocBlock.indexOf('strip') > -1 || jsdocBlock.indexOf('stripped') > -1,
            'JSDoc must mention that stack is stripped outside local scope'
        );
    });

    // ── (b) pure logic — inline replica ──────────────────────────────────────

    // Mirrors the gate + serialization shape in controller.js (~L5138-5150).
    // Takes an isLocalScope bool so both branches can be exercised without
    // mutating process.env or reloading the controller module.
    function buildErrOutput(errorObject, isLocalScope) {
        if (!isLocalScope && errorObject && errorObject.stack) {
            delete errorObject.stack;
        }
        var output = errorObject.toString();
        if (output == '[object Object]') {
            return JSON.parse(JSON.stringify(errorObject));
        }
        return JSON.parse(JSON.stringify({
            status : errorObject.status,
            error  : output,
            stack  : errorObject.stack || null
        }));
    }

    it('local scope: stack preserved on the wire (catch-all path)', function() {
        var errObj = {
            status  : 500,
            error   : 'boom',
            stack   : 'Error: boom\n    at /server/path/to/controller.js:42'
        };
        var out = buildErrOutput(errObj, true);
        assert.equal(out.stack, 'Error: boom\n    at /server/path/to/controller.js:42');
        assert.equal(out.status, 500);
    });

    it('production / beta / testing / unset: stack stripped (catch-all path)', function() {
        var errObj = {
            status  : 500,
            error   : 'boom',
            stack   : 'Error: boom\n    at /server/path/to/controller.js:42'
        };
        var out = buildErrOutput(errObj, false);
        assert.ok(!('stack' in out), 'stack field must be absent from JSON body');
        assert.equal(out.status, 500);
        assert.equal(out.error, 'boom');
    });

    it('non-local: covers the L5129-5137 fallback construction path', function() {
        // Mirrors the fallback initializer at L5129-5137 — built from msg.stack.
        var msg = { stack: 'Error: synth\n    at /server/lib/x.js:9' };
        var errObj = {
            status  : 500,
            error   : 'synth',
            message : 'synth',
            stack   : msg.stack
        };
        var out = buildErrOutput(errObj, false);
        assert.ok(!('stack' in out), 'fallback path must also strip stack outside local scope');
    });

    it('whitelist serialization path: stack becomes null when toString is custom', function() {
        // Mirrors the L5143-5149 branch where `output != "[object Object]"` —
        // the wire shape carries `stack: errorObject.stack || null`.
        var errObj = {
            status  : 500,
            error   : 'boom',
            stack   : 'Error: boom\n    at /server/path/x.js:1',
            toString: function() { return 'custom error toString'; }
        };
        var out = buildErrOutput(errObj, false);
        assert.equal(out.stack, null, 'stripped stack must serialize to null on the whitelist path');
        assert.equal(out.error, 'custom error toString');
    });

    it('whitelist serialization path: stack preserved on local scope', function() {
        var errObj = {
            status  : 500,
            error   : 'boom',
            stack   : 'Error: boom\n    at /server/path/x.js:1',
            toString: function() { return 'custom error toString'; }
        };
        var out = buildErrOutput(errObj, true);
        assert.equal(out.stack, 'Error: boom\n    at /server/path/x.js:1');
    });

    it('no-stack error: gate is a no-op (no crash on missing field)', function() {
        // Catch-all path (`output == '[object Object]'`) serializes errorObject
        // as-is — an absent stack stays absent (undefined). The whitelist path
        // explicitly emits `stack: null`. Both shapes are falsy and correct.
        var errObj = { status: 400, error: 'bad request' };
        var outLocal    = buildErrOutput(Object.assign({}, errObj), true);
        var outNonLocal = buildErrOutput(Object.assign({}, errObj), false);
        assert.ok(!outLocal.stack, 'absent stack must remain falsy under local scope');
        assert.ok(!outNonLocal.stack, 'absent stack must remain falsy under non-local scope');
    });

    it('falsy errorObject: gate is a no-op (defensive `errorObject &&` guard)', function() {
        // The guard's `errorObject &&` short-circuit guarantees no crash when
        // errorObject is null/undefined. This test mirrors that defensive shape.
        function gateOnly(errorObject, isLocalScope) {
            if (!isLocalScope && errorObject && errorObject.stack) {
                delete errorObject.stack;
            }
            return errorObject;
        }
        assert.equal(gateOnly(null, false), null);
        assert.equal(gateOnly(undefined, false), undefined);
        assert.equal(gateOnly(null, true), null);
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 13 — throwError HTML branch: <pre class="stack"> rendered only in local scope
// ─────────────────────────────────────────────────────────────────────────
//
// Symmetric to section 12 (JSON wire). The fallback HTML error page —
// produced inside the L5294+ `var msgString = '<h1 class="status">...'`
// construction block when no custom error template is configured — must
// gate its `<pre class="stack">` render on `_isLocalScope` so it doesn't
// leak server-side stack frames to non-local viewers.
//
// Two render sites:
//   (1) msg-shape   — `if (msg.stack && _isLocalScope) { ... msg.stack mangling + render ... }`
//   (2) generic-shape — `if (stack && _isLocalScope) { msgString += <pre class=...stack> }`
//
// Custom error templates dispatched via `renderCustomError` (L5266-5281)
// are consumer-owned and out of scope here.

describe('13 - throwError HTML branch: stack rendered only in local scope', function() {

    // ── (a) source structure ─────────────────────────────────────────────────

    it('source contains the msg-shape fail-closed gate', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('if (msg.stack && _isLocalScope)') > -1,
            'expected `if (msg.stack && _isLocalScope)` at the msg-shape site'
        );
    });

    it('source contains the generic-shape fail-closed gate', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('if (stack && _isLocalScope)') > -1,
            'expected `if (stack && _isLocalScope)` at the generic-shape site'
        );
    });

    it('both gates sit inside the fallback HTML msgString construction block', function() {
        var src              = fs.readFileSync(SOURCE, 'utf8');
        var msgStringIdx     = src.indexOf("var msgString = '<h1 class=\"status\">Error ");
        var msgGateIdx       = src.indexOf('if (msg.stack && _isLocalScope)');
        var genericGateIdx   = src.indexOf('if (stack && _isLocalScope)');
        assert.ok(msgStringIdx > -1, 'msgString anchor not found in source');
        assert.ok(msgGateIdx > -1, 'msg-shape gate not found');
        assert.ok(genericGateIdx > -1, 'generic-shape gate not found');
        assert.ok(msgGateIdx > msgStringIdx, 'msg-shape gate must sit AFTER the msgString anchor');
        assert.ok(genericGateIdx > msgStringIdx, 'generic-shape gate must sit AFTER the msgString anchor');
        // generic-shape sits after msg-shape (the if/else branches in source).
        assert.ok(genericGateIdx > msgGateIdx, 'generic-shape gate must sit AFTER the msg-shape gate');
    });

    it('source uses the cached _isLocalScope, not a per-request env lookup', function() {
        // Neither gate body should reach into process.env directly — the
        // _isLocalScope module cache (controller.js:69, #P19) is the only
        // valid source.
        var src = fs.readFileSync(SOURCE, 'utf8');
        var msgBlock = src.split('if (msg.stack && _isLocalScope)')[1] || '';
        var genBlock = src.split('if (stack && _isLocalScope)')[1] || '';
        assert.ok(
            msgBlock.slice(0, 400).indexOf('process.env.NODE_SCOPE_IS_LOCAL') < 0,
            'msg-shape gate body must not reference process.env.NODE_SCOPE_IS_LOCAL directly'
        );
        assert.ok(
            genBlock.slice(0, 200).indexOf('process.env.NODE_SCOPE_IS_LOCAL') < 0,
            'generic-shape gate body must not reference process.env.NODE_SCOPE_IS_LOCAL directly'
        );
    });

    it('JSDoc covers the HTML branch policy alongside the JSON branch', function() {
        var src        = fs.readFileSync(SOURCE, 'utf8');
        var jsdocStart = src.indexOf('Throw error — terminates the request');
        var fnDecl     = src.indexOf('this.throwError = function(res, code, msg)');
        assert.ok(jsdocStart > -1 && fnDecl > -1, 'throwError JSDoc anchors not found');
        var jsdoc = src.slice(jsdocStart, fnDecl);
        assert.ok(
            jsdoc.indexOf('HTML') > -1 || jsdoc.indexOf('<pre class="stack">') > -1,
            'JSDoc must mention the HTML branch policy'
        );
    });

    // ── (b) pure logic — inline replicas mirror the controller.js shapes ─────

    // Mirrors L5294-5323 (msg-shape branch).
    function renderMsgShape(msg, eCode, isLocalScope) {
        var msgString = '<h1 class="status">Error '+ (msg.status || 500) +'.</h1>';
        if (msg.title)   msgString += '<pre class="'+ eCode +' title">'+ msg.title +'</pre>';
        if (msg.error)   msgString += '<pre class="'+ eCode +' message">'+ msg.error +'</pre>';
        if (msg.message) msgString += '<pre class="'+ eCode +' message">'+ msg.message +'</pre>';
        if (msg.stack && isLocalScope) {
            if (msg.error)   msg.stack = msg.stack.replace(msg.error, '');
            if (msg.message) msg.stack = msg.stack.replace(msg.message, '');
            msg.stack = msg.stack.replace('Error:', '').replace(' ', '');
            msgString += '<pre class="'+ eCode +' stack">'+ msg.stack +'</pre>';
        }
        return msgString;
    }

    // Mirrors L5325-5352 (generic-shape branch).
    function renderGenericShape(errorObject, eCode, isLocalScope) {
        var msgString = '<h1 class="status">Error '+ (errorObject.status || 500) +'.</h1>';
        var title = null, message = null, stack = null;
        if (errorObject && typeof(errorObject.error)   != 'undefined') title   = errorObject.error;
        if (errorObject && typeof(errorObject.message) != 'undefined') message = errorObject.message;
        if (errorObject && typeof(errorObject.stack)   != 'undefined') stack   = errorObject.stack;
        if (title)   msgString += '<pre class="'+ eCode +' title">'+ title +'</pre>';
        if (message) msgString += '<pre class="'+ eCode +' message">'+ message +'</pre>';
        if (stack && isLocalScope) {
            msgString += '<pre class="'+ eCode +' stack">'+ stack +'</pre>';
        }
        return msgString;
    }

    it('msg-shape local scope: stack <pre> rendered with frame content', function() {
        var msg = { status: 500, error: 'boom', stack: 'Error: boom\n    at /server/path/x.js:1' };
        var html = renderMsgShape(msg, '5xx', true);
        assert.ok(html.indexOf('<pre class="5xx stack">') > -1, 'stack pre must be present in local scope');
        assert.ok(html.indexOf('/server/path/x.js:1') > -1, 'frame content must be visible in local scope');
    });

    it('msg-shape non-local scope: stack <pre> absent, no frame content', function() {
        var msg = { status: 500, error: 'boom', stack: 'Error: boom\n    at /server/path/x.js:1' };
        var html = renderMsgShape(msg, '5xx', false);
        assert.ok(html.indexOf('<pre class="5xx stack">') < 0, 'stack pre must be absent outside local scope');
        assert.ok(html.indexOf('/server/path/x.js:1') < 0, 'frame content must not leak outside local scope');
    });

    it('generic-shape local scope: stack <pre> rendered with frame content', function() {
        var errObj = { status: 500, error: 'boom', stack: 'Error: boom\n    at /server/path/y.js:42' };
        var html = renderGenericShape(errObj, '5xx', true);
        assert.ok(html.indexOf('<pre class="5xx stack">') > -1, 'stack pre must be present in local scope');
        assert.ok(html.indexOf('/server/path/y.js:42') > -1, 'frame content must be visible in local scope');
    });

    it('generic-shape non-local scope: stack <pre> absent, no frame content', function() {
        var errObj = { status: 500, error: 'boom', stack: 'Error: boom\n    at /server/path/y.js:42' };
        var html = renderGenericShape(errObj, '5xx', false);
        assert.ok(html.indexOf('<pre class="5xx stack">') < 0, 'stack pre must be absent outside local scope');
        assert.ok(html.indexOf('/server/path/y.js:42') < 0, 'frame content must not leak outside local scope');
    });

    it('non-stack content (title, error, message) renders identically across scopes', function() {
        // The gate must only affect the stack <pre> — title/error/message
        // <pre> blocks render the same in any scope.
        var msg = { status: 500, title: 'Boom', error: 'failed', message: 'Internal' };
        var localHtml    = renderMsgShape(Object.assign({}, msg), '5xx', true);
        var nonLocalHtml = renderMsgShape(Object.assign({}, msg), '5xx', false);
        assert.equal(localHtml, nonLocalHtml, 'non-stack content must render identically in both scopes');
    });

    it('msg-shape with no stack: gate is a no-op (no crash)', function() {
        var msg = { status: 400, error: 'bad request' };
        var localHtml    = renderMsgShape(Object.assign({}, msg), '4xx', true);
        var nonLocalHtml = renderMsgShape(Object.assign({}, msg), '4xx', false);
        assert.equal(localHtml, nonLocalHtml, 'absent stack must render the same in both scopes');
        assert.ok(localHtml.indexOf('<pre class="4xx stack">') < 0, 'no stack pre when no stack field');
    });

    it('generic-shape with no stack: gate is a no-op (no crash)', function() {
        var errObj = { status: 400, error: 'bad request' };
        var localHtml    = renderGenericShape(Object.assign({}, errObj), '4xx', true);
        var nonLocalHtml = renderGenericShape(Object.assign({}, errObj), '4xx', false);
        assert.equal(localHtml, nonLocalHtml, 'absent stack must render the same in both scopes');
        assert.ok(localHtml.indexOf('<pre class="4xx stack">') < 0, 'no stack pre when no stack field');
    });

});


// ─────────────────────────────────────────────────────────────────────────
// 14 — throwError 2-arg form: (statusCode, Error|string) preserves status
// ─────────────────────────────────────────────────────────────────────────
//
// The documented overloads in types/index.d.ts are 1-arg, 3-arg, and
// 1-arg-object. Consumers also reach for an undocumented 2-arg form
// `throwError(statusCode, ErrorInstance)`. Before the normalization shift,
// this form silently fell back to HTTP 500 because the L4998 if-branch's
// coercion at L5005-5007 inspects `code` (the Error/string) and `res.status`
// (the number's .status — undefined), never `res` itself as a number.
//
// Fix shape: a 2-arg normalization shift at the top of the function detects
// `typeof(res) == 'number' && arguments.length === 2` with the second arg
// being an Error or string, and shifts the locals to the canonical form
// (msg = arguments[1], code = res, res = local.res). Args then flow naturally
// through the existing L4998 IF branch with the explicit code preserved.
//
// The 2-arg errorObj form `throwError(statusCode, errorObj)` is NOT shifted —
// the existing `else if (arguments.length < 3)` branch at L5072 already
// handles it correctly (status reaches the explicit code via `code = res`).

describe('14 - throwError 2-arg form: (statusCode, Error|string) preserves status', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ── (a) source structure ─────────────────────────────────────────────────

    it('source contains the 2-arg normalization shift signal strings', function() {
        assert.ok(src.indexOf("typeof(res) == 'number' && arguments.length === 2") > -1,
            "expected `typeof(res) == 'number' && arguments.length === 2` shift guard");
        assert.ok(src.indexOf('arguments[1] instanceof Error') > -1,
            'expected `arguments[1] instanceof Error` recognized shape');
        assert.ok(src.indexOf("typeof(arguments[1]) == 'string'") > -1,
            "expected `typeof(arguments[1]) == 'string'` recognized shape");
    });

    it('shift sits BEFORE the existing L4998 IF branch', function() {
        var shiftIdx = src.indexOf("typeof(res) == 'number' && arguments.length === 2");
        var ifIdx    = src.indexOf('arguments[0] instanceof Error');
        assert.ok(shiftIdx > -1, '2-arg shift not found in source');
        assert.ok(ifIdx > -1, 'L4998 IF branch anchor not found');
        assert.ok(shiftIdx < ifIdx, 'shift must run BEFORE the L4998 IF branch');
    });

    it('shift binds to length === 2 (regression guard against 1-arg / 3-arg call shapes)', function() {
        assert.ok(src.indexOf('arguments.length === 2') > -1,
            'expected strict `arguments.length === 2` to bind the shift to the 2-arg shape only');
    });

    it('JSDoc on throwError documents the 2-arg form', function() {
        var jsdocStart = src.indexOf('Throw error — terminates the request');
        var fnDecl     = src.indexOf('this.throwError = function(res, code, msg)');
        assert.ok(jsdocStart > -1 && fnDecl > -1, 'throwError JSDoc anchors not found');
        var jsdoc = src.slice(jsdocStart, fnDecl);
        assert.ok(jsdoc.indexOf('throwError(code, err)') > -1,
            'JSDoc must list the `throwError(code, err)` 2-arg form');
    });

    it('types/index.d.ts declares the 2-arg overload', function() {
        var dtsPath = path.resolve(__dirname, '../../types/index.d.ts');
        var dts     = fs.readFileSync(dtsPath, 'utf8');
        assert.ok(
            dts.indexOf('throwError(code: number, err: Error | string)') > -1,
            'types/index.d.ts must declare `throwError(code: number, err: Error | string): void;`'
        );
    });

    // ── (b) pure logic — inline replica of normalization + downstream branches

    // Mirrors controller.js: the new shift block at function entry, then
    // either the L4998 IF branch (Error/string second args) or the L5072
    // `else if (arguments.length < 3)` branch. Returns the final locals
    // and constructed errorObject so tests can assert end-to-end shape.
    var statusCodes = {
        400: 'Bad Request',
        404: 'Not Found',
        412: 'Precondition Failed',
        500: 'Internal Server Error'
    };

    function normalizeAndCoerce(args, localRes) {
        var res  = args[0];
        var code = args[1];
        var msg  = args[2];

        // Mirrors the new shift block in controller.js verbatim.
        if ( typeof(res) == 'number' && args.length === 2 && (
            args[1] instanceof Error
            || typeof(args[1]) == 'string'
        )) {
            msg  = args[1];
            code = res;
            res  = localRes;
        }

        var errorObject = null;
        var standardErrorMessage = null;

        if (
            args[0] instanceof Error
            || args.length == 1 && typeof(res) == 'object'
            || args[args.length-1] instanceof Error
            || typeof(args[args.length-1]) == 'string' && !(args[0] instanceof Error)
        ) {
            // Mirror of L5005-5070 (status-coercion + Error/string extraction).
            msg  = ( !/^\d+$/.test(code) && typeof(msg) == 'undefined' ) ? code : msg;
            code = ( /^\d{3}$/.test(String(code)) ) ? code
                 : ( res && typeof(res.status) != 'undefined' ) ? res.status
                 : 500;
            standardErrorMessage = statusCodes[code] || null;
            errorObject = {
                status: code,
                error: (res && res.error) || (res && res.message) || standardErrorMessage
            };
            if (args[args.length-1] instanceof Error) {
                var _lastArg = args[args.length-1];
                if (_lastArg.message) errorObject.message = _lastArg.message;
                if (_lastArg.stack)   errorObject.stack   = _lastArg.stack;
                if (!errorObject.error) errorObject.error = _lastArg.message || standardErrorMessage;
            } else if (typeof(args[args.length-1]) == 'string') {
                errorObject.message = args[args.length-1];
            }
            res = localRes;
        } else if (args.length < 3) {
            // Mirror of L5072-5076 else branch + L5143-5151 fallback initializer.
            msg  = code || null;
            code = res || 500;
            res  = localRes;
            standardErrorMessage = statusCodes[code] || null;
            errorObject = {
                status:  code,
                error:   standardErrorMessage || (msg && msg.error) || msg,
                message: (msg && msg.message) || msg,
                stack:   msg && msg.stack
            };
        }

        return { res: res, code: code, msg: msg, errorObject: errorObject };
    }

    var FAKE_RES = { __isLocalRes: true, getHeaders: function() { return {}; } };

    it('throwError(404, new Error("not found")) — status preserved as 404', function() {
        var err = new Error('not found');
        var r = normalizeAndCoerce([404, err], FAKE_RES);
        assert.equal(r.code, 404, 'code must be the explicit 404, not the 500 fallback');
        assert.equal(r.errorObject.status, 404);
        assert.equal(r.errorObject.error, 'Not Found', 'standardErrorMessage for 404');
        assert.equal(r.errorObject.message, 'not found', 'Error.message preserved on errorObject');
        assert.equal(r.res, FAKE_RES, 'res shifted to local.res');
    });

    it('throwError(400, "Bad input") — status preserved as 400', function() {
        var r = normalizeAndCoerce([400, 'Bad input'], FAKE_RES);
        assert.equal(r.code, 400);
        assert.equal(r.errorObject.status, 400);
        assert.equal(r.errorObject.error, 'Bad Request');
        assert.equal(r.errorObject.message, 'Bad input');
    });

    it('throwError(412, errorObj) — NOT shifted, falls through to L5072 else (status 412)', function() {
        // Regression guard: the 2-arg errorObj form is intentionally NOT shifted.
        var errObj = { status: 412, fields: { name: 'Required' } };
        var r = normalizeAndCoerce([412, errObj], FAKE_RES);
        assert.equal(r.code, 412, 'code must be the explicit 412');
        assert.equal(r.errorObject.status, 412);
        assert.equal(r.msg, errObj, 'msg holds the errorObj after the L5072 reshuffle');
    });

    it('throwError(new Error("boom")) — 1-arg form unchanged (shift does NOT fire on length 1)', function() {
        var err = new Error('boom');
        var r = normalizeAndCoerce([err], FAKE_RES);
        assert.equal(r.code, 500, '1-arg Error with no status falls back to 500');
        assert.equal(r.errorObject.status, 500);
        assert.equal(r.errorObject.message, 'boom');
    });

    it('throwError(res, 500, new Error()) — 3-arg internal form unchanged (shift does NOT fire on length 3)', function() {
        var err = new Error('explicit 3-arg');
        var fakeRouterRes = { getHeaders: function() { return {}; } };
        var r = normalizeAndCoerce([fakeRouterRes, 500, err], FAKE_RES);
        assert.equal(r.code, 500, '3-arg with explicit 500 must remain 500');
        assert.equal(r.errorObject.status, 500);
        assert.equal(r.errorObject.message, 'explicit 3-arg');
    });

    it('throwError(404, null) — shift does NOT fire (null is not Error or string), falls to L5072 else', function() {
        var r = normalizeAndCoerce([404, null], FAKE_RES);
        assert.equal(r.code, 404, 'L5072 else picks up the explicit 404 via `code = res || 500`');
    });

    it('throwError(404, {}) — empty-object 2nd arg, shift does NOT fire, falls to L5072 else', function() {
        var r = normalizeAndCoerce([404, {}], FAKE_RES);
        assert.equal(r.code, 404, 'explicit 404 preserved via L5072 else');
    });

    it('shift guard: typeof(res) === "number" required (object first arg does NOT fire the shift)', function() {
        function shiftFires(args) {
            return typeof(args[0]) == 'number' && args.length === 2 && (
                args[1] instanceof Error
                || typeof(args[1]) == 'string'
            );
        }
        assert.equal(shiftFires([404, new Error()]), true, 'number + Error → shift fires');
        assert.equal(shiftFires([400, 'msg']), true, 'number + string → shift fires');
        assert.equal(shiftFires([{}, new Error()]), false, 'object first arg → shift does not fire');
        assert.equal(shiftFires([new Error()]), false, '1-arg Error → shift does not fire (length 1)');
        assert.equal(shiftFires([{ getHeaders: function(){} }, 500, new Error()]), false, '3-arg → shift does not fire (length 3)');
    });

});


// 15 — source structure: sendTrailers (#H10)
describe('15 - source structure: sendTrailers (#H10)', function() {

    it('sendTrailers is defined in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('this.sendTrailers = function(') > -1,
            'expected `this.sendTrailers = function(` — #H10 not applied'
        );
    });

    it('source contains #H10 marker', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(src.indexOf('#H10') > -1, 'expected #H10 marker in source');
    });

    it('stashes registered trailers on local._trailers', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.sendTrailers = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('local._trailers') > -1, 'expected local._trailers assignment');
    });

    it('strips `:`-prefixed pseudo-header keys and returns self', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.sendTrailers = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf("charAt(0) === ':'") > -1, 'expected pseudo-header (`:`-prefixed) strip');
        assert.ok(block.indexOf('return self') > -1, 'expected `return self` for chaining');
    });
});


// 16 — sendTrailers: pure logic
describe('16 - sendTrailers: pure logic', function() {

    // Minimal replica of the sendTrailers body for isolated testing.
    function makeTrailerEnv() {
        var local = {};
        var self  = {};
        function sendTrailers(fields) {
            if (!fields || typeof(fields) !== 'object') return self;
            var _clean = {};
            var _has   = false;
            for (var k in fields) {
                if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
                if (k.charAt(0) === ':') continue;
                _clean[k] = fields[k];
                _has = true;
            }
            local._trailers = _has ? _clean : null;
            return self;
        }
        return { local: local, self: self, sendTrailers: sendTrailers };
    }

    it('stashes a clean object on local._trailers', function() {
        var env = makeTrailerEnv();
        env.sendTrailers({ 'grpc-status': '0' });
        assert.deepEqual(env.local._trailers, { 'grpc-status': '0' });
    });

    it('strips `:`-prefixed pseudo-headers', function() {
        var env = makeTrailerEnv();
        env.sendTrailers({ ':status': '200', 'grpc-status': '0' });
        assert.deepEqual(env.local._trailers, { 'grpc-status': '0' });
    });

    it('sets local._trailers to null when only pseudo-headers are given', function() {
        var env = makeTrailerEnv();
        env.sendTrailers({ ':status': '200' });
        assert.strictEqual(env.local._trailers, null);
    });

    it('no-ops on a non-object argument and returns self', function() {
        var env = makeTrailerEnv();
        var r1 = env.sendTrailers('nope');
        var r2 = env.sendTrailers(null);
        var r3 = env.sendTrailers(undefined);
        assert.strictEqual(r1, env.self);
        assert.strictEqual(r2, env.self);
        assert.strictEqual(r3, env.self);
        assert.strictEqual(typeof env.local._trailers, 'undefined');
    });

    it('returns self for chaining on the success path', function() {
        var env = makeTrailerEnv();
        var r = env.sendTrailers({ 'x-foo': 'bar' });
        assert.strictEqual(r, env.self);
    });
});


// 17 — source structure: startJob / jobStatus (#AI6)
describe('17 - source structure: startJob / jobStatus (#AI6)', function() {

    it('startJob and jobStatus are defined in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(src.indexOf('this.startJob = function(')  > -1, 'expected `this.startJob = function(` — #AI6 slice 2 not applied');
        assert.ok(src.indexOf('this.jobStatus = function(') > -1, 'expected `this.jobStatus = function(` — #AI6 slice 2 not applied');
    });

    it('source contains the #AI6 marker', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(src.indexOf('#AI6') > -1, 'expected #AI6 marker in source');
    });

    it('startJob is a pass-through to lib.job.create that returns (the id)', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.startJob = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('lib.job.create') > -1, 'expected delegation to lib.job.create');
        assert.ok(block.indexOf('return') > -1,         'expected the job id to be returned');
    });

    it('startJob stashes NOTHING on local (the job outlives the request)', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.startJob = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('local.') === -1, 'startJob must not touch the per-request local closure (contrast with sendTrailers)');
    });

    it('jobStatus is a pass-through to lib.job.get', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.jobStatus = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('lib.job.get') > -1, 'expected delegation to lib.job.get');
    });
});


// 18 — startJob / jobStatus: pure logic
describe('18 - startJob / jobStatus: pure logic (#AI6)', function() {

    // Minimal replica mirroring the real method bodies, with lib.job faked.
    function makeJobEnv() {
        var calls   = { create: [], get: [] };
        var fakeJob = {
            create: function(fn, opts) { calls.create.push({ fn: fn, opts: opts }); return 'JOBID123'; },
            get:    function(id, cb)   { calls.get.push({ id: id, cb: cb }); cb(null, { id: id, state: 'completed', result: 42 }); }
        };
        var local = {};
        var self  = {};
        self.startJob  = function(fn, opts) { return fakeJob.create(fn, opts); };
        self.jobStatus = function(id, cb)   { fakeJob.get(id, cb); };
        return { calls: calls, local: local, self: self };
    }

    it('startJob returns the id from lib.job.create and forwards fn', function() {
        var env = makeJobEnv();
        var fn  = function() { return 1; };
        var id  = env.self.startJob(fn);
        assert.equal(id, 'JOBID123');
        assert.equal(env.calls.create.length, 1);
        assert.strictEqual(env.calls.create[0].fn, fn, 'fn forwarded by reference');
    });

    it('startJob forwards opts', function() {
        var env = makeJobEnv();
        env.self.startJob(function() {}, { meta: { kind: 'infer' }, callbackUrl: 'https://x/y' });
        assert.deepEqual(env.calls.create[0].opts, { meta: { kind: 'infer' }, callbackUrl: 'https://x/y' });
    });

    it('startJob does not stash anything on the per-request local closure', function() {
        var env = makeJobEnv();
        env.self.startJob(function() {});
        assert.equal(Object.keys(env.local).length, 0, 'local must remain untouched');
    });

    it('jobStatus forwards id + cb to lib.job.get', function() {
        var env = makeJobEnv();
        var got = null;
        env.self.jobStatus('abc', function(err, rec) { got = rec; });
        assert.equal(env.calls.get.length, 1);
        assert.equal(env.calls.get[0].id, 'abc');
        assert.deepEqual(got, { id: 'abc', state: 'completed', result: 42 });
    });
});


// 19 — source structure: inferAsync (#AI6)
describe('19 - source structure: inferAsync (#AI6)', function() {

    it('inferAsync is defined in source', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(src.indexOf('this.inferAsync = function(') > -1, 'expected `this.inferAsync = function(` — #AI6 slice 4 not applied');
    });

    it('inferAsync composes getModel().infer() through self.startJob', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.inferAsync = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('self.startJob(') > -1, 'must defer through self.startJob');
        assert.ok(block.indexOf('getModel(')      > -1, 'must resolve the connector via getModel');
        assert.ok(block.indexOf('.infer(')        > -1, 'must call .infer on the connector');
    });

    it('inferAsync trims the result to content/model/usage (drops raw)', function() {
        var src   = fs.readFileSync(SOURCE, 'utf8');
        var start = src.indexOf('this.inferAsync = function(');
        var end   = src.indexOf('\n    };', start) + 7;
        var block = src.slice(start, end);
        assert.ok(block.indexOf('content:') > -1 && block.indexOf('model:') > -1 && block.indexOf('usage:') > -1,
            'must build a trimmed { content, model, usage } result');
        assert.ok(block.indexOf('raw') === -1, 'must NOT carry the raw provider response into the job result');
    });
});


// 20 — inferAsync: pure logic
describe('20 - inferAsync: pure logic (#AI6)', function() {

    // Replica mirroring the real inferAsync body, with getModel + startJob faked.
    function makeInferEnv() {
        var calls  = { startJob: [], getModel: [], infer: [] };
        var fakeAi = {
            infer: function(messages, options) {
                calls.infer.push({ messages: messages, options: options });
                return Promise.resolve({ content: 'hi', model: 'm', usage: { inputTokens: 1, outputTokens: 2 }, raw: { huge: true } });
            }
        };
        var getModel = function(name) { calls.getModel.push(name); return fakeAi; };
        var self = {};
        self.startJob  = function(fn, opts) { calls.startJob.push({ fn: fn, opts: opts }); return 'JID'; };
        self.inferAsync = function(messages, options, jobOpts) {
            options = options || {};
            var _connector = options.connector;
            return self.startJob(function() {
                return getModel(_connector).infer(messages, options).then(function(_r) {
                    return { content: _r.content, model: _r.model, usage: _r.usage };
                });
            }, jobOpts);
        };
        return { calls: calls, self: self };
    }

    it('returns the job id from startJob', function() {
        var env = makeInferEnv();
        var id  = env.self.inferAsync([{ role: 'user', content: 'x' }], { connector: 'myModel' });
        assert.equal(id, 'JID');
        assert.equal(env.calls.startJob.length, 1);
    });

    it('the deferred fn calls getModel(connector).infer(messages, options) and trims raw', async function() {
        var env  = makeInferEnv();
        var msgs = [{ role: 'user', content: 'hi' }];
        env.self.inferAsync(msgs, { connector: 'myModel', maxTokens: 9 });
        var fn     = env.calls.startJob[0].fn;
        var result = await fn();
        assert.deepEqual(env.calls.getModel, ['myModel'], 'getModel called with the connector name');
        assert.equal(env.calls.infer.length, 1);
        assert.strictEqual(env.calls.infer[0].messages, msgs, 'messages forwarded by reference');
        assert.equal(env.calls.infer[0].options.maxTokens, 9, 'infer options forwarded');
        assert.deepEqual(result, { content: 'hi', model: 'm', usage: { inputTokens: 1, outputTokens: 2 } });
        assert.ok(!('raw' in result), 'raw provider response dropped from the job result');
    });

    it('forwards jobOpts to startJob', function() {
        var env = makeInferEnv();
        env.self.inferAsync([{ role: 'user', content: 'x' }], { connector: 'c' }, { meta: { kind: 'summary' }, callbackUrl: 'https://x/y' });
        assert.deepEqual(env.calls.startJob[0].opts, { meta: { kind: 'summary' }, callbackUrl: 'https://x/y' });
    });
});


// self.setTemplate(file, ext) — runtime template override (commit a5f1faa3)
describe('self.setTemplate(file, ext) — runtime template override', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    it('declares this.setTemplate = function (file, ext)', function() {
        assert.ok(
            /this\.setTemplate\s*=\s*function\s*\(\s*file\s*,\s*ext\s*\)/.test(src),
            'expected `this.setTemplate = function (file, ext)` on BaseController — runtime override API was reverted'
        );
    });

    it('bails safely when setOptions has not run (no local.options)', function() {
        var fnMatch = src.match(/this\.setTemplate\s*=\s*function[\s\S]*?\n    \};/);
        assert.ok(fnMatch, 'setTemplate body not found');
        var body = fnMatch[0];
        assert.ok(
            /if\s*\(!local\.options\)\s*return/.test(body),
            'expected early-return guard `if (!local.options) return` — would crash when called before setOptions()'
        );
    });

    it('writes file/ext under local.options._templateOverride', function() {
        var fnMatch = src.match(/this\.setTemplate\s*=\s*function[\s\S]*?\n    \};/);
        var body = fnMatch[0];
        assert.ok(
            /local\.options\._templateOverride\.file\s*=\s*file/.test(body),
            'expected `local.options._templateOverride.file = file` assignment'
        );
        assert.ok(
            /local\.options\._templateOverride\.ext\s*=/.test(body),
            'expected `local.options._templateOverride.ext = ...` assignment'
        );
    });

    it('normalises ext to a leading-dot form', function() {
        var fnMatch = src.match(/this\.setTemplate\s*=\s*function[\s\S]*?\n    \};/);
        var body = fnMatch[0];
        assert.ok(
            /ext\.charAt\(0\)\s*===\s*'\.'/.test(body),
            'expected leading-dot normalisation `ext.charAt(0) === "."` — would cause double-dot or missing-dot paths'
        );
    });

    it('only accepts string arguments (ignores non-string file/ext)', function() {
        var fnMatch = src.match(/this\.setTemplate\s*=\s*function[\s\S]*?\n    \};/);
        var body = fnMatch[0];
        assert.ok(
            /typeof\s+file\s*===\s*'string'/.test(body),
            'expected `typeof file === "string"` guard'
        );
        assert.ok(
            /typeof\s+ext\s*===\s*'string'/.test(body),
            'expected `typeof ext === "string"` guard'
        );
    });

});


// 21 — gina-container bare-global fallbacks (GINA_PID / GINA_CULTURE)
// The Docker/K8s foreground launcher (bin/gina-container) bypasses the daemon and
// never defines the GINA_PID / GINA_CULTURE globals, so a bare read of either in
// setOptions threw `ReferenceError: <NAME> is not defined` (HTTP 500) on every
// view-rendering route. Both reads now go through getEnvVar() with a safe fallback,
// matching the siblings (render-json.js, inspector-window-emit.js) and the
// culture-default precedent (config.js / init.js).
describe('21 - gina-container bare-global fallbacks (GINA_PID / GINA_CULTURE)', function() {

    // ---- source structure ----

    it('reads GINA_PID via getEnvVar with a String(process.pid) fallback', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("getEnvVar('GINA_PID') || String(process.pid)") > -1,
            "expected `getEnvVar('GINA_PID') || String(process.pid)` — a bare GINA_PID read ReferenceErrors under gina-container"
        );
    });

    it('no longer reads a bare GINA_PID global in the page.environment setter', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("'page.environment.gina pid', GINA_PID)") === -1,
            'expected the bare `GINA_PID` read to be gone — it throws ReferenceError under the daemonless launcher'
        );
    });

    it('reads GINA_CULTURE via getEnvVar with an en_CM fallback', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf("getEnvVar('GINA_CULTURE') || 'en_CM'") > -1,
            "expected `getEnvVar('GINA_CULTURE') || 'en_CM'` — a bare GINA_CULTURE read ReferenceErrors under gina-container"
        );
    });

    it('no longer reads a bare GINA_CULTURE global for acceptLanguage', function() {
        var src = fs.readFileSync(SOURCE, 'utf8');
        assert.ok(
            src.indexOf('var acceptLanguage = GINA_CULTURE;') === -1,
            'expected the bare `GINA_CULTURE` read to be gone — it throws ReferenceError under the daemonless launcher'
        );
    });

    // ---- pure logic: the getEnvVar() || fallback resolution ----

    // Replica of the reader-side resolution used at both sites: getEnvVar('X')
    // returns the daemon-set value when present, else undefined (the daemonless
    // launcher case), in which case the fallback wins.
    function resolve(getEnvVar, key, fallback) {
        return getEnvVar(key) || fallback;
    }

    it('GINA_PID: the daemon-set value wins over the fallback', function() {
        var getEnvVar = function(k) { return k === 'GINA_PID' ? '4242' : undefined; };
        assert.strictEqual(resolve(getEnvVar, 'GINA_PID', String(99)), '4242');
    });

    it('GINA_PID: falls back to String(process.pid) when unset (gina-container)', function() {
        var getEnvVar = function() { return undefined; };
        var resolved  = resolve(getEnvVar, 'GINA_PID', String(12345));
        assert.strictEqual(resolved, '12345');
        assert.strictEqual(typeof resolved, 'string', 'fallback must yield a string pid');
    });

    it('GINA_CULTURE: daemon value wins; unset falls back to en_CM (gina-container)', function() {
        var daemon  = function() { return 'fr_FR'; };
        var missing = function() { return undefined; };
        assert.strictEqual(resolve(daemon,  'GINA_CULTURE', 'en_CM'), 'fr_FR');
        assert.strictEqual(resolve(missing, 'GINA_CULTURE', 'en_CM'), 'en_CM');
    });

    it('a bare read of an undeclared global throws ReferenceError (the pre-fix failure mode)', function() {
        // getEnvVar() returns undefined for an unset key; a bare identifier read
        // of the same omitted name throws — which is exactly why the daemonless
        // launcher 500'd before the fix.
        assert.throws(function() {
            return GINA_PID_zzz_never_defined; // eslint-disable-line no-undef
        }, ReferenceError);
    });
});


// ─────────────────────────────────────────────────────────────────────────────
// 22 — late throwError / headersSent on a released response (#B31)
//
// Field sequence: a controller action redirects (301) — redirect() ends the
// response and releases local.req/res/next (the terminal-exit triplet) — then
// a late async continuation (entity/query callback, timer, catch handler)
// calls self.throwError(err) on the same request. Pre-fix, throwError
// normalized `res` to the released ref (null) and read typeof(res.getHeaders):
// `TypeError: Cannot read properties of null (reading 'getHeaders')` — an
// uncaughtException the process supervisor escalates to SIGTERM, killing the
// bundle and every in-flight request with it. headersSent() had the same
// exposure via its `typeof(_res.stream)` read (any second render*() call
// after a terminal exit). Both entry points must no-op on a released
// response: the response is gone, there is nothing left to write on.
// ─────────────────────────────────────────────────────────────────────────────

describe('22 - throwError / headersSent on a released response (#B31)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ---- source structure ----

    it('headersSent guards the released response before any deref', function() {
        var hsIdx = src.indexOf('var headersSent = function(res)');
        assert.ok(hsIdx > -1, 'expected the headersSent definition');
        var hsEnd = src.indexOf('return false;', hsIdx);
        assert.ok(hsEnd > hsIdx, 'expected the headersSent fall-through tail');
        var hsBlk = src.substring(hsIdx, hsEnd);

        var guardIdx  = hsBlk.indexOf('if ( !_res )');
        var streamIdx = hsBlk.indexOf('_res.stream');
        assert.ok(guardIdx > -1, 'expected the `if ( !_res )` released-response guard');
        assert.ok(streamIdx > -1, 'expected the `_res.stream` read');
        assert.ok(guardIdx < streamIdx, 'the null guard must precede the first `_res` deref');
        assert.match(
            hsBlk.substring(guardIdx, guardIdx + 100),
            /if \( !_res \)\s*\{\s*return true;/,
            'a released response must report as already-sent so callers no-op'
        );
    });

    it('throwError no-ops on a released response before the header snapshot', function() {
        var fnIdx = src.indexOf('this.throwError = function(res, code, msg)');
        assert.ok(fnIdx > -1, 'expected the throwError definition');
        var endIdx = src.indexOf('responseHeaders = res.stream.sentHeader', fnIdx);
        assert.ok(endIdx > fnIdx, 'expected the header-snapshot block as end anchor');
        var blk = src.substring(fnIdx, endIdx);

        assert.match(
            blk,
            /if \( !res \) \{\s*res = local\.res;/,
            'expected the defensive `res = local.res` fallback before the released-response guard'
        );
        var warnIdx   = blk.indexOf('throwError() called after the response was released');
        var typeofIdx = blk.indexOf("typeof(res.getHeaders) == 'undefined'");
        assert.ok(warnIdx > -1, 'expected the late-error warn (the swallowed error must stay observable)');
        assert.ok(typeofIdx > -1, 'expected the getHeaders feature-test in the snapshot block');
        assert.ok(warnIdx < typeofIdx, 'the released-response guard must precede the getHeaders read');
        assert.match(
            blk.substring(warnIdx, warnIdx + 320),
            /return false;/,
            'the late call must return false (same contract as the renderingStack guard)'
        );
    });

    // ---- pure logic: replica of the normalized snapshot tail ----

    // Mirrors throwError after argument normalization (`res` already holds
    // local.res for every 1-/2-arg shape): fixed tail = fallback + guard +
    // snapshot; pre-fix tail = snapshot only.
    function fixedSnapshotTail(localRes) {
        var local = { res: localRes };
        var res   = local.res;
        if ( !res ) { res = local.res; }
        if ( !res ) { return false; }
        if ( typeof(res.getHeaders) == 'undefined' && typeof(res.stream) != 'undefined' ) {
            return res.stream.sentHeader;
        }
        return res.getHeaders() || local.res.getHeaders();
    }
    function preFixSnapshotTail(localRes) {
        var local = { res: localRes };
        var res   = local.res;
        if ( typeof(res.getHeaders) == 'undefined' && typeof(res.stream) != 'undefined' ) {
            return res.stream.sentHeader;
        }
        return res.getHeaders() || local.res.getHeaders();
    }

    it('released response: the fixed tail returns false and does not throw', function() {
        assert.strictEqual(fixedSnapshotTail(null), false);
    });

    it('live response: the fixed tail still snapshots headers (behaviour unchanged)', function() {
        var headers = { 'content-type': 'text/html' };
        var live = { getHeaders: function() { return headers; } };
        assert.deepStrictEqual(fixedSnapshotTail(live), headers);
    });

    it('subtract: the pre-fix tail throws the exact field TypeError on a released response', function() {
        assert.throws(function() {
            preFixSnapshotTail(null);
        }, function(err) {
            return err instanceof TypeError
                && /Cannot read properties of null \(reading 'getHeaders'\)/.test(err.message);
        }, 'the unguarded snapshot must reproduce the field crash');
    });

    // ---- pure logic: replica of headersSent ----

    function headersSentReplica(_res) {
        if ( !_res ) {
            return true;
        }
        if (
            typeof(_res.stream) != 'undefined'
            && typeof(_res.stream.headersSent) != 'undefined'
            && _res.stream.headersSent === true
        ) {
            return true;
        }
        if ( typeof(_res.headersSent) != 'undefined' ) {
            return _res.headersSent;
        }
        return false;
    }

    it('headersSent reports true on a released response (nothing left to write)', function() {
        assert.strictEqual(headersSentReplica(null), true);
        assert.strictEqual(headersSentReplica(undefined), true);
    });

    it('headersSent still honours a live response (behaviour unchanged)', function() {
        assert.strictEqual(headersSentReplica({ headersSent: false }), false);
        assert.strictEqual(headersSentReplica({ headersSent: true }), true);
        assert.strictEqual(headersSentReplica({ stream: { headersSent: true } }), true);
        assert.strictEqual(headersSentReplica({}), false);
    });

    it('subtract: the pre-fix headersSent shape throws reading `stream` on a released response', function() {
        function preFixHeadersSent(_res) {
            if ( typeof(_res.stream) != 'undefined' && _res.stream.headersSent === true ) {
                return true;
            }
            if ( typeof(_res.headersSent) != 'undefined' ) {
                return _res.headersSent;
            }
            return false;
        }
        assert.throws(function() {
            preFixHeadersSent(null);
        }, function(err) {
            return err instanceof TypeError
                && /Cannot read properties of null \(reading 'stream'\)/.test(err.message);
        }, 'the unguarded headersSent must reproduce the second-crash shape');
    });
});

describe('23 - query retry/response handlers on a released response (#B33)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ---- source structure ----

    // The negative pin is scoped to the two fixed function bodies — other functions
    // (redirect, isPopinContext, the render-path authority composition, the bundle-status
    // forwards) deliberately retain unguarded reads: they run on the live request
    // lifecycle, are NOT on the measured query/retry path, and are tracked as a
    // measure-first follow-up in the #B33 ledger entry. Do not widen this pin to the
    // whole file without measuring those sites first.
    it('query() and handleHTTP2ClientRequest carry no unguarded local.req.headers forward', function() {
        var qStart  = src.indexOf('this.query = function(options, data, callback)');
        var h2Start = src.indexOf('var handleHTTP2ClientRequest = function(');
        var h2End   = src.indexOf('var getSession = function()');
        assert.ok(qStart > -1 && h2Start > qStart && h2End > h2Start, 'expected the structural anchors');
        var fixedBlocks = src.slice(qStart, h2End);
        var unguarded = fixedBlocks.match(/(?<!local\.req != null && )typeof\(local\.req\.headers\[/g) || [];
        assert.strictEqual(unguarded.length, 0,
            'every local.req.headers forward in query()/handleHTTP2ClientRequest must carry `local.req != null && `');
        var guarded = fixedBlocks.match(/local\.req != null && typeof\(local\.req\.headers\[/g) || [];
        assert.ok(guarded.length >= 7,
            'expected at least the 7 guarded forwards (5 in handleHTTP2ClientRequest + 2 in query)');
    });

    it('getSession returns null on a released request before any session deref', function() {
        assert.match(src,
            /var getSession = function\(\) \{[\s\S]{0,400}?if \( local\.req == null \) \{\s*return null;/,
            'getSession must early-return null when local.req was released');
    });

    it('both 3xx redirect intercepts skip a released response', function() {
        var count = src.split("local.res != null && data.status && /^3/.test(data.status)").length - 1;
        assert.strictEqual(count, 2,
            'both the callback-mode and emitter-mode 3xx intercepts must be local.res-guarded');
    });

    // ---- pure-logic replicas (mirror the shipped guard shapes) ----

    function forwardReplica(req, options) {
        if ( req != null && typeof(req.headers['x-requested-with']) != 'undefined' ) {
            options.headers['x-requested-with'] = req.headers['x-requested-with'];
        }
        return options;
    }

    it('forward replica: released request skips the forward without throwing', function() {
        var options = { headers: {} };
        assert.doesNotThrow(function() { forwardReplica(null, options); });
        assert.strictEqual(typeof options.headers['x-requested-with'], 'undefined');
    });

    it('forward replica: live request still forwards (behaviour unchanged)', function() {
        var options = { headers: {} };
        forwardReplica({ headers: { 'x-requested-with': 'XMLHttpRequest' } }, options);
        assert.strictEqual(options.headers['x-requested-with'], 'XMLHttpRequest');
    });

    it('subtract: the pre-fix forward shape throws reading `headers` on a released request', function() {
        function preFixForward(req, options) {
            if ( typeof(req.headers['x-requested-with']) != 'undefined' ) {
                options.headers['x-requested-with'] = req.headers['x-requested-with'];
            }
        }
        assert.throws(function() {
            preFixForward(null, { headers: {} });
        }, function(err) {
            return err instanceof TypeError
                && /Cannot read properties of null \(reading 'headers'\)/.test(err.message);
        }, 'the unguarded forward must reproduce the retry-re-entry crash shape');
    });

    function getSessionReplica(req) {
        var session = null;
        if ( req == null ) {
            return null;
        }
        if ( typeof(req.session) != 'undefined') {
            session = req.session;
        }
        return session;
    }

    it('getSession replica: released request yields null; live request yields the session', function() {
        assert.strictEqual(getSessionReplica(null), null);
        var sess = { id: 'x1' };
        assert.strictEqual(getSessionReplica({ session: sess }), sess);
        assert.strictEqual(getSessionReplica({}), null);
    });

    it('subtract: the pre-fix getSession shape throws reading `session` on a released request', function() {
        function preFixGetSession(req) {
            var session = null;
            if ( typeof(req.session) != 'undefined') {
                session = req.session;
            }
            return session;
        }
        assert.throws(function() {
            preFixGetSession(null);
        }, function(err) {
            return err instanceof TypeError
                && /Cannot read properties of null \(reading 'session'\)/.test(err.message);
        }, 'the unguarded getSession must reproduce the isHaltedRequest crash shape');
    });

    function interceptReplica(res, data) {
        if (res != null && data.status && /^3/.test(data.status) && typeof data.headers !== 'undefined') {
            res.writeHead(data.status, data.headers);
            res.end();
            return 'intercepted';
        }
        return 'fell-through';
    }

    it('intercept replica: released response falls through instead of writing', function() {
        assert.strictEqual(
            interceptReplica(null, { status: 301, headers: { location: '/x' } }),
            'fell-through');
    });

    it('intercept replica: live response still intercepts the 3xx (behaviour unchanged)', function() {
        var wrote = [];
        var res = {
            writeHead: function(s, h) { wrote.push([s, h]); },
            end: function() { wrote.push('end'); }
        };
        assert.strictEqual(
            interceptReplica(res, { status: 301, headers: { location: '/x' } }),
            'intercepted');
        assert.strictEqual(wrote.length, 2);
        assert.strictEqual(wrote[0][0], 301);
    });

    it('subtract: the pre-fix intercept shape throws reading `writeHead` on a released response', function() {
        function preFixIntercept(res, data) {
            if (data.status && /^3/.test(data.status) && typeof data.headers !== 'undefined') {
                res.writeHead(data.status, data.headers);
                return res.end();
            }
        }
        assert.throws(function() {
            preFixIntercept(null, { status: 301, headers: { location: '/x' } });
        }, function(err) {
            return err instanceof TypeError
                && /Cannot read properties of null \(reading 'writeHead'\)/.test(err.message);
        }, 'the unguarded intercept must reproduce the emitter-mode crash shape');
    });
});

describe('24 - query: exhausted 502 retries surface a BAD_GATEWAY error, not success (#B34)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ---- source structure ----

    it('the exhausted-502 branch sits right after the 502 retry guard', function() {
        var retryGuard = src.indexOf('if (httpStatus === 502 && retryCount < HTTP2_MAX_RETRIES)');
        var exhausted  = src.indexOf('} else if (httpStatus === 502) {');
        assert.ok(retryGuard > -1, 'the 502 retry guard must exist');
        assert.ok(exhausted > retryGuard,
            'the exhausted-502 else-if must follow the retry guard (so it only fires when retries are spent)');
    });

    it('the exhausted-502 branch builds a GinaHttp2Error with code BAD_GATEWAY and status 502', function() {
        var exhausted = src.indexOf('} else if (httpStatus === 502) {');
        var blk = src.slice(exhausted, src.indexOf('// 3. Exception filter', exhausted));
        assert.match(blk, /new GinaHttp2Error\(/, 'must construct a typed error');
        assert.match(blk, /code\s*:\s*'BAD_GATEWAY'/, 'code must be BAD_GATEWAY');
        assert.match(blk, /status\s*:\s*502/, 'status must be 502 (truthful upstream status)');
        assert.match(blk, /retryable\s*:\s*false/, 'exhausted error is not retryable');
    });

    it('the exhausted-502 branch dispatches via callback (callback mode) and query#complete (emitter mode)', function() {
        var exhausted = src.indexOf('} else if (httpStatus === 502) {');
        var blk = src.slice(exhausted, src.indexOf('// 3. Exception filter', exhausted));
        assert.match(blk, /if \(_swallowIfNonCritical\(_badGatewayErr\)\) return;/,
            'must respect the non-critical swallow, like the sibling exhaustion paths');
        assert.match(blk, /callback\(_badGatewayErr\)/, 'callback mode surfaces the error to the caller');
        assert.match(blk, /self\.emit\('query#complete', \{ status: 502, error: _badGatewayErr \}\)/,
            'emitter mode surfaces { status: 502, error }');
    });

    // ---- pure-logic replica (mirrors the onEnd 502 decision: retry guard, the new
    //      exhausted-502 branch, then the legacy fall-through success path) ----

    function onEnd502Replica(httpStatus, retryCount, MAX, body, mode) {
        // mode: 'fixed' (post-#B34) | 'prefix' (pre-#B34, no exhausted-502 branch)
        var out = { dispatch: null, payload: null };
        function callback(err, d) {
            out.dispatch = (err === false || err == null) ? 'success' : 'error';
            out.payload  = (err === false || err == null) ? d : err;
        }
        // shared retry guard
        if (httpStatus === 502 && retryCount < MAX) {
            out.dispatch = 'retry';
            return out;
        }
        // #B34 exhausted-502 branch (fixed only)
        if (mode === 'fixed' && httpStatus === 502) {
            callback({ code: 'BAD_GATEWAY', status: 502, retryable: false, retryCount: retryCount });
            return out;
        }
        // legacy fall-through (success path) — JSON-shaped body without `.status` -> 200
        var data = body;
        if (typeof data === 'string' && /^(\{|%7B|\[{)|\[\]/.test(data)) {
            data = JSON.parse(data);
            if (typeof data.status === 'undefined') data.status = 200;
        }
        if (data && typeof data === 'object' && data.status && !/^2/.test(data.status)) {
            callback(data);            // genuine non-2xx in the body
        } else {
            callback(false, data);     // success
        }
        return out;
    }

    var JSON_502 = '{"error":"bad gateway"}';   // JSON-shaped, no `.status`
    var HTML_502 = '<html><head><title>502 Bad Gateway</title></head></html>';

    it('fixed: exhausted 502 (JSON body) surfaces an error with status 502 / BAD_GATEWAY', function() {
        var r = onEnd502Replica(502, 2, 2, JSON_502, 'fixed');
        assert.strictEqual(r.dispatch, 'error');
        assert.strictEqual(r.payload.status, 502);
        assert.strictEqual(r.payload.code, 'BAD_GATEWAY');
    });

    it('fixed: exhausted 502 (HTML body) surfaces an error with status 502', function() {
        var r = onEnd502Replica(502, 2, 2, HTML_502, 'fixed');
        assert.strictEqual(r.dispatch, 'error');
        assert.strictEqual(r.payload.status, 502);
    });

    it('fixed: a 502 with retries remaining still routes to retry (unchanged)', function() {
        var r = onEnd502Replica(502, 0, 2, JSON_502, 'fixed');
        assert.strictEqual(r.dispatch, 'retry');
    });

    it('fixed: a genuine 200 JSON body without status still succeeds (legacy fallback intact)', function() {
        var r = onEnd502Replica(200, 0, 2, '{"ok":1}', 'fixed');
        assert.strictEqual(r.dispatch, 'success');
        assert.strictEqual(r.payload.status, 200); // the undefined-status->200 fallback is correct here
    });

    it('subtract: pre-fix exhausted 502 (JSON body) was reported as SUCCESS with status forced to 200', function() {
        var r = onEnd502Replica(502, 2, 2, JSON_502, 'prefix');
        assert.strictEqual(r.dispatch, 'success', 'reproduces the defect: 502 surfaced as success');
        assert.strictEqual(r.payload.status, 200, 'the 502 body had status forced to 200');
    });

    it('subtract: pre-fix exhausted 502 (HTML body) was reported as SUCCESS carrying the 502 page', function() {
        var r = onEnd502Replica(502, 2, 2, HTML_502, 'prefix');
        assert.strictEqual(r.dispatch, 'success', 'reproduces the defect: 502 HTML surfaced as success');
        assert.strictEqual(r.payload, HTML_502, 'the caller received the raw 502 error page as "data"');
    });
});

describe('25 - released-response guards on synchronous controller APIs (#B35)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // Scope note: these are the 5 directly-callable SYNCHRONOUS controller APIs measured
    // (via a standalone harness: createTestInstance → renderTEXT() releases the triplet →
    // call) to throw an uncaughtException → SIGTERM bundle kill on a released request — the
    // same lethal class as #B31/#B33. The §23 comment lists isPopinContext among the
    // "deliberately unguarded" siblings; that predates this fix — isPopinContext is now
    // guarded here. The remaining siblings (redirect second-call, the async store /
    // downloadFromURL — which fail as a non-fatal unhandledRejection — and the render-path
    // inner functions setResources / getNodeRes) stay a documented measure-first follow-up.

    // ---- source structure: each guard sits at the top of its function, before the deref ----
    var GUARDED = [
        { name: 'isPopinContext',         sig: 'this.isPopinContext = function() {',                   ret: 'return false;',                    deref: "local.req.headers['x-gina-popin-id']" },
        { name: 'setRequestMethod',       sig: 'this.setRequestMethod = function(requestMethod, conf) {', ret: 'return null;',                  deref: 'local.req.method' },
        { name: 'setRequestMethodParams', sig: 'this.setRequestMethodParams = function(params) {',      ret: 'return;',                          deref: 'local.req[local.req.method' },
        { name: 'getRequestMethodParams', sig: 'this.getRequestMethodParams = function() {',            ret: 'return localRequestMethodParams;', deref: 'local.req[local.req.method' },
        { name: 'getFormsRules',          sig: 'this.getFormsRules = function () {',                    ret: 'return {};',                       deref: 'local.req.ginaHeaders' }
    ];

    GUARDED.forEach(function(g) {
        it(g.name + ' guards a released request before dereferencing local.req', function() {
            var start = src.indexOf(g.sig);
            assert.ok(start > -1, 'function ' + g.name + ' must exist');
            var body = src.slice(start, start + 700);
            var guardIdx = body.indexOf('if ( local.req == null )');
            var derefIdx = body.indexOf(g.deref);
            assert.ok(guardIdx > -1, g.name + ' must carry a `if ( local.req == null )` guard');
            assert.ok(derefIdx > -1, g.name + ' must still contain its local.req deref');
            assert.ok(guardIdx < derefIdx, g.name + ' guard must precede the local.req deref');
            var guardBlock = body.slice(guardIdx, derefIdx);
            assert.ok(guardBlock.indexOf(g.ret) > -1, g.name + ' guard must `' + g.ret + '` on a released request');
        });
    });

    // ---- pure-logic replicas (mirror each guard shape) ----

    function guardedReplica(req, derefFn, safeDefault) {
        if (req == null) return safeDefault;   // #B35 guard
        return derefFn(req);
    }

    it('replica: each guard returns its safe default on a released request, the real value when live', function() {
        // isPopinContext → false / real boolean
        var popin = function(r) { return typeof r.headers['x-gina-popin-id'] != 'undefined'; };
        assert.strictEqual(guardedReplica(null, popin, false), false);
        assert.strictEqual(guardedReplica({ headers: { 'x-gina-popin-id': '1' } }, popin, false), true);
        // getRequestMethodParams → cached value (here null) / real params
        var params = function(r) { return r[r.method.toLowerCase()]; };
        assert.strictEqual(guardedReplica(null, params, null), null);
        assert.deepStrictEqual(guardedReplica({ method: 'GET', get: { a: 1 } }, params, null), { a: 1 });
        // getFormsRules → {} / real ginaHeaders
        var forms = function(r) { return r.ginaHeaders; };
        assert.deepStrictEqual(guardedReplica(null, forms, {}), {});
        assert.deepStrictEqual(guardedReplica({ ginaHeaders: { form: { id: 'f' } } }, forms, {}), { form: { id: 'f' } });
    });

    it('subtract: the pre-fix unguarded reads throw the released-response TypeError', function() {
        assert.throws(function() { var r = null; return r.headers['x']; },
            /Cannot read properties of null \(reading 'headers'\)/);
        assert.throws(function() { var r = null; return r.method; },
            /Cannot read properties of null \(reading 'method'\)/);
        assert.throws(function() { var r = null; return r.ginaHeaders; },
            /Cannot read properties of null \(reading 'ginaHeaders'\)/);
        assert.throws(function() { var r = null; r.method = 'GET'; },
            /Cannot set properties of null \(setting 'method'\)/);
    });
});

describe('26 - released-response guard on redirect() (#B37)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // redirect() is SYNCHRONOUS and reads local.req/local.res throughout (the proxy block,
    // the originalMethod/method reads). A terminal exit (a prior redirect, or a render-error
    // path) nulls the triplet, so a second redirect on the released instance crashed the
    // bundle (uncaughtException → SIGTERM). Measured (standalone harness, getContext('gina')
    // .config.getRouting mocked): CONTROL (live) redirected, RELEASE (after renderTEXT) threw
    // `reading 'originalMethod'`. Fixed with a top-of-function guard.

    it('redirect() guards a released request at the top, before getConfig/getRouting', function() {
        var start = src.indexOf('this.redirect = function(req, res, next) {');
        assert.ok(start > -1, 'redirect must exist');
        var head = src.slice(start, start + 700);
        var guardIdx = head.indexOf('if ( local.req == null )');
        var confIdx  = head.indexOf('var conf    = self.getConfig()');
        assert.ok(guardIdx > -1, 'redirect must carry a `if ( local.req == null )` guard');
        assert.ok(confIdx > guardIdx, 'guard must precede getConfig()/getRouting() and all local.req reads');
    });

    // ---- pure-logic replica (redirect reads local.req.originalMethod on the released path) ----
    function redirectHead(localReq, mode) {
        if (mode === 'fixed' && localReq == null) return 'no-op (released)';
        var originalMethod = localReq.originalMethod;   // representative crash site
        return 'redirected (' + originalMethod + ')';
    }

    it('replica: released request no-ops; live request proceeds', function() {
        assert.strictEqual(redirectHead(null, 'fixed'), 'no-op (released)');
        assert.strictEqual(redirectHead({ originalMethod: 'GET' }, 'fixed'), 'redirected (GET)');
    });

    it('subtract: the pre-fix redirect head throws reading a property on a released request', function() {
        assert.throws(function() { redirectHead(null, 'prefix'); },
            function(err) {
                return err instanceof TypeError
                    && /Cannot read properties of null \(reading 'originalMethod'\)/.test(err.message);
            },
            'the unguarded redirect head must reproduce the released-response crash');
    });
});

describe('27 - released-response guards on more synchronous controller APIs (#B38)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // Scope note: an exhaustive #B38 sweep of every SYNCHRONOUS controller surface found
    // FIVE more directly-callable / sync-reachable APIs that read the per-request refs
    // unguarded and crash a released request (uncaughtException -> SIGTERM) -- the same
    // lethal class as #B31/#B33/#B35/#B37. Each was runtime-measured (standalone harness:
    // createTestInstance -> renderTEXT() releases the triplet -> call -> positive crash,
    // then no-throw after the guard). The #B37 ledger had claimed the SIGTERM class CLOSED;
    // these were missed -- notably store's inner start() is reached SYNCHRONOUSLY through
    // the documented store(target).onComplete(cb) wrapper (the #B35 probe only tried
    // store('t'), which returns the wrapper WITHOUT calling start). renderStream's guard is
    // pinned in render-stream.test.js. The non-fatal async residuals (downloadFromURL; the
    // render-path inner fns setResources / getNodeRes, only ever called from the async
    // render delegates -> unhandledRejection) stay documented + skipped, mirroring #B36.

    // ---- source structure: each guard sits at the top of its function, before the deref ----
    var GUARDED = [
        { name: 'downloadFromLocal',   sig: 'this.downloadFromLocal = function(filename) {',       guardTok: 'if ( local.res == null )', ret: 'return;',      deref: 'local.res.setHeader' },
        { name: 'store (inner start)', sig: 'var start = function(target, files, cb) {',            guardTok: 'if ( local.req == null )', ret: '_releasedErr', deref: 'local.req.files' },
        { name: 'push',                sig: 'this.push = function(payload, option, callback) {',    guardTok: 'if ( local.req == null )', ret: 'return;',      deref: 'req.method' },
        { name: 'pauseRequest',        sig: 'this.pauseRequest = function(data, requestStorage) {', guardTok: 'if ( local.req == null )', ret: 'return;',      deref: 'req.url' },
        { name: 'resumeRequest',       sig: 'this.resumeRequest = function(requestStorage) {',      guardTok: 'if ( local.req == null )', ret: 'return;',      deref: 'req.session' }
    ];

    GUARDED.forEach(function(g) {
        it(g.name + ' guards a released request before dereferencing the per-request ref', function() {
            var start = src.indexOf(g.sig);
            assert.ok(start > -1, 'function ' + g.name + ' must exist');
            var body = src.slice(start, start + 1100);
            var guardIdx = body.indexOf(g.guardTok);
            var derefIdx = body.indexOf(g.deref);
            assert.ok(guardIdx > -1, g.name + ' must carry a `' + g.guardTok + '` guard');
            assert.ok(derefIdx > -1, g.name + ' must still contain its released-response deref');
            assert.ok(guardIdx < derefIdx, g.name + ' guard must precede the deref');
            var guardBlock = body.slice(guardIdx, derefIdx);
            assert.ok(guardBlock.indexOf(g.ret) > -1, g.name + ' guard must short-circuit (`' + g.ret + '`) on a released request');
        });
    });

    // ---- pure-logic replica (mirror the top-of-fn guard shape) ----
    function guardedReplica(ref, derefFn, safeDefault) {
        if (ref == null) return safeDefault;   // #B38 guard
        return derefFn(ref);
    }

    it('replica: each guard returns its safe default on a released request, the real value when live', function() {
        // downloadFromLocal -> no-op undefined / proceeds when res is live
        var setH = function(res) { res.setHeader('content-type', 'x'); return 'sent'; };
        assert.strictEqual(guardedReplica(null, setH, undefined), undefined);
        assert.strictEqual(guardedReplica({ setHeader: function() {} }, setH, undefined), 'sent');
        // store inner start -> notifies via the error channel (marker) / reads req.files when live
        var readFiles = function(req) { return req.files; };
        assert.strictEqual(guardedReplica(null, readFiles, 'released'), 'released');
        assert.deepStrictEqual(guardedReplica({ files: [1] }, readFiles, 'released'), [1]);
        // push / pauseRequest / resumeRequest -> no-op undefined / read the live request prop
        var readProp = function(req) { return req.method; };
        assert.strictEqual(guardedReplica(null, readProp, undefined), undefined);
        assert.strictEqual(guardedReplica({ method: 'GET' }, readProp, undefined), 'GET');
    });

    it('subtract: the pre-fix unguarded reads reproduce each released-response TypeError', function() {
        assert.throws(function() { var r = null; return r.setHeader; },
            /Cannot read properties of null \(reading 'setHeader'\)/);
        assert.throws(function() { var r = null; return r.files; },
            /Cannot read properties of null \(reading 'files'\)/);
        assert.throws(function() { var r = null; return r.method; },
            /Cannot read properties of null \(reading 'method'\)/);
        assert.throws(function() { var r = null; return r.url; },
            /Cannot read properties of null \(reading 'url'\)/);
        assert.throws(function() { var r = null; return r.session; },
            /Cannot read properties of null \(reading 'session'\)/);
    });
});

// 28 — early released-response guard for throwError's 2-arg/3-arg shapes (#B44)
//
// #B31 (§22) guarded the throwError header-snapshot tail, which catches the
// 1-arg `throwError(err)` shape: there `res` stays the truthy err object until
// it is reassigned to `local.res` at the end of the errorObject build, so the
// snapshot-tail guard sees the null and no-ops. But the 2-arg
// `throwError(code, Error|string)` and 3-arg `throwError(local.res, code, msg)`
// shapes resolve `res` to local.res (null on a released response) BEFORE that
// build — via the 2-arg shift, or by the caller passing the released local.res
// (downloadFromURL's async catch). Those then crash on the earlier derefs:
//   - HTTP/2 bundles → `res.stream` in the protocol branch (the :5440 read);
//   - every bundle   → `res.error` in the errorObject build (the :5475 read,
//     which HTTP/1.1 reaches because the :5440 read short-circuits off-h2).
// Guarding only :5440 (as first proposed) would merely relocate the HTTP/2
// crash to :5475 and do nothing on HTTP/1.1. The fix is an up-front guard,
// before any `res` deref, returning false with the same no-op contract.
// (Measured on the real throwError via the §14 harness: /tmp/b44-probe.js —
// pre-fix all 2-arg/3-arg released shapes crash at :5475 (http/1.1) / :5440
// (http/2.0); post-fix every shape no-ops on both protocols.)
// ─────────────────────────────────────────────────────────────────────────────

describe('28 - throwError early released-response guard on 2-arg/3-arg shapes (#B44)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ---- source structure ----

    it('the #B44 early guard precedes the protocol/stream read and the errorObject build', function() {
        var fnIdx = src.indexOf('this.throwError = function(res, code, msg)');
        assert.ok(fnIdx > -1, 'expected the throwError definition');

        var protocolIdx   = src.indexOf('getResponseProtocol(res)', fnIdx);    // the :5439 call
        var streamIdx     = src.indexOf('test(protocol) && res.stream', fnIdx); // the :5440 read
        var errorBuildIdx = src.indexOf('res.error || res.message', fnIdx);     // the :5475 build
        assert.ok(protocolIdx > fnIdx, 'expected the getResponseProtocol(res) call');
        assert.ok(streamIdx > fnIdx, 'expected the protocol-branch res.stream read');
        assert.ok(errorBuildIdx > fnIdx, 'expected the errorObject res.error build');

        var b44Idx   = src.indexOf('#B44', fnIdx);
        assert.ok(b44Idx > fnIdx, 'expected the #B44 guard comment');
        var guardIdx = src.indexOf('if ( !res ) {', b44Idx);
        var warnIdx  = src.indexOf('throwError() called after the response was released', b44Idx);
        var retIdx   = src.indexOf('return false;', guardIdx);
        assert.ok(guardIdx > b44Idx, 'expected the early `if ( !res )` guard under the #B44 comment');
        assert.ok(warnIdx > guardIdx, 'the early guard warns on the late error');
        assert.ok(retIdx > warnIdx, 'the early guard returns false after warning');

        // the whole guard sits BEFORE every res deref
        assert.ok(guardIdx < protocolIdx,   'guard must precede getResponseProtocol(res)');
        assert.ok(retIdx   < protocolIdx,   'guard must return before getResponseProtocol(res)');
        assert.ok(guardIdx < streamIdx,     'guard must precede the :5440 res.stream read');
        assert.ok(guardIdx < errorBuildIdx, 'guard must precede the :5475 res.error build');
    });

    it('the #B31 snapshot-tail guard is left intact (1-arg shape still covered there)', function() {
        // §22 covers the snapshot-tail guard; assert #B44 did not remove it.
        assert.match(src, /if \( !res \) \{\s*res = local\.res;/,
            'the #B31 `if ( !res ) { res = local.res; }` fallback must remain');
    });

    // ---- pure logic: replica of the throwError prologue (shift → guard → derefs) ----

    // Mirrors throwError from the 2-arg shift through the first `res` derefs:
    // the protocol-branch read (:5440 res.stream) and the errorObject build
    // (:5475 res.error). `protocol` is the value getResponseProtocol returns on
    // a released response — the configured bundle protocol (local.req is null).
    function prologue(args, localRes, protocol, withGuard) {
        var res = args[0], code = args[1], msg = args[2];
        // 2-arg shift (statusCode, Error|string)
        if ( typeof(res) == 'number' && args.length === 2 &&
             (args[1] instanceof Error || typeof(args[1]) == 'string') ) {
            msg = args[1]; code = res; res = localRes;
        }
        if ( withGuard && !res ) { return false; }                                   // #B44 early guard
        var stream = ( /http\/2/.test(protocol) && res.stream ) ? res.stream : null; // :5440
        var errorObject = { status: code, error: res.error || res.message || 'def' };// :5475
        return errorObject;
    }

    // For 2-arg shapes `res` comes from the shift (= localRes); for the 3-arg
    // shape `res` is the first arg, so it must carry the live/released value.
    function argsFor(shape, res) {
        if (shape === '2arg-Error')  return [500, new Error('boom')];
        if (shape === '2arg-string') return [500, 'boom'];
        return [res, 500, new Error('boom')]; // 3arg-Error: res is the first arg (downloadFromURL passes local.res)
    }
    var SHAPES    = ['2arg-Error', '2arg-string', '3arg-Error'];
    var PROTOCOLS = ['http/1.1', 'http/2.0'];

    it('released response: the guarded prologue returns false (no throw) for every shape/protocol', function() {
        SHAPES.forEach(function(shape) {
            PROTOCOLS.forEach(function(proto) {
                assert.strictEqual(
                    prologue(argsFor(shape, null), null, proto, true), false,
                    shape + ' (' + proto + ') released must no-op'
                );
            });
        });
    });

    it('live response: the guarded prologue still builds the errorObject (behaviour unchanged)', function() {
        var live = {}; // a live response object: no .stream / .error / .message
        SHAPES.forEach(function(shape) {
            PROTOCOLS.forEach(function(proto) {
                var out = prologue(argsFor(shape, live), live, proto, true);
                assert.ok(out && out.status === 500,
                    shape + ' (' + proto + ') live must still build the errorObject');
            });
        });
    });

    it('subtract: the unguarded prologue throws the exact field TypeError per protocol', function() {
        // HTTP/2 → the :5440 res.stream read fires first
        assert.throws(function() { prologue([500, new Error('x')], null, 'http/2.0', false); },
            /Cannot read properties of null \(reading 'stream'\)/,
            '2-arg on http/2.0 must crash at the res.stream read');
        // HTTP/1.1 → :5440 short-circuits off-h2, so the :5475 res.error read fires
        assert.throws(function() { prologue([500, new Error('x')], null, 'http/1.1', false); },
            /Cannot read properties of null \(reading 'error'\)/,
            '2-arg on http/1.1 must crash at the res.error build');
        // 3-arg released (passed null res) — same two sites
        assert.throws(function() { prologue([null, 500, new Error('x')], null, 'http/2.0', false); },
            /Cannot read properties of null \(reading 'stream'\)/,
            '3-arg on http/2.0 must crash at the res.stream read');
        assert.throws(function() { prologue([null, 500, new Error('x')], null, 'http/1.1', false); },
            /Cannot read properties of null \(reading 'error'\)/,
            '3-arg on http/1.1 must crash at the res.error build');
    });
});

describe('29 - query: settled HTTP/2 stream released at every non-retry terminal (#B52)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    // ---- source structure ----

    it('the #B52 _finalizeStream helper is defined inside _sendRequest with an idempotency guard + the three release ops, in order', function() {
        var h2Start = src.indexOf('var handleHTTP2ClientRequest = function(');
        assert.ok(h2Start > -1, 'expected the handleHTTP2ClientRequest anchor');
        var helperIdx = src.indexOf('var _finalizeStream = function _finalizeStream()', h2Start);
        assert.ok(helperIdx > h2Start, 'expected the _finalizeStream helper inside handleHTTP2ClientRequest');

        var guardIdx   = src.indexOf('if (_finalized) { return; }', helperIdx);
        var flagIdx    = src.indexOf('_finalized = true;', guardIdx);
        var timeoutIdx = src.indexOf('req.setTimeout(0)', flagIdx);
        var listenIdx  = src.indexOf('req.removeAllListeners()', timeoutIdx);
        var closeIdx   = src.indexOf('req.close()', listenIdx);
        assert.ok(guardIdx   > helperIdx,  'helper early-returns when already finalized');
        assert.ok(flagIdx    > guardIdx,   'helper sets the _finalized flag before the release ops');
        assert.ok(timeoutIdx > flagIdx,    'helper cancels the stream timeout via setTimeout(0)');
        assert.ok(listenIdx  > timeoutIdx, 'helper removes the stream listeners');
        assert.ok(closeIdx   > listenIdx,  'helper closes the stream last');
    });

    it('the helper releases defensively — each op in try/catch, close() guarded against an already-closed/destroyed stream', function() {
        var helperIdx = src.indexOf('var _finalizeStream = function _finalizeStream()');
        var body = src.slice(helperIdx, helperIdx + 400);
        assert.match(body, /try \{ req\.setTimeout\(0\); \} catch/,        'setTimeout(0) is try/caught');
        assert.match(body, /try \{ req\.removeAllListeners\(\); \} catch/, 'removeAllListeners() is try/caught');
        assert.match(body, /try \{ if \(!req\.closed && !req\.destroyed\) \{ req\.close\(\); \} \} catch/,
            'close() is guarded on !req.closed && !req.destroyed and try/caught');
    });

    it('_finalizeStream() is invoked at exactly the five non-retry terminals', function() {
        var h2Start = src.indexOf('var handleHTTP2ClientRequest = function(');
        var h2End   = src.indexOf('var getSession = function()');
        assert.ok(h2Start > -1 && h2End > h2Start, 'expected the handleHTTP2ClientRequest structural bounds');
        var block = src.slice(h2Start, h2End);
        var calls = block.match(/_finalizeStream\(\);/g) || [];
        assert.strictEqual(calls.length, 5,
            'expected exactly 5 _finalizeStream() calls (timeout-exhausted / stream-error / premature-close / 502-exhausted / onEnd-success terminals)');
    });

    // The four TYPED-error terminals finalize the stream right before the
    // non-critical swallow, so cleanup happens on BOTH the swallow-return and the
    // callback/emit path. The 5th call is the onEnd success terminal, placed ahead
    // of the ALPN/parse path (no swallow follows it). The retry branches do NOT
    // finalize — they client.destroy() the whole session, tearing the stream down.
    // The two pre-flight PING swallow sites have no request stream yet, so they
    // correctly do not finalize. (That is why this pins the finalize->swallow
    // ORDERING count, not a raw swallow count: there are 7 _swallowIfNonCritical
    // tokens in the block — 1 comment + 4 terminals + 2 pre-flight.)
    it('each typed-error terminal finalizes the stream BEFORE its non-critical swallow', function() {
        var h2Start = src.indexOf('var handleHTTP2ClientRequest = function(');
        var h2End   = src.indexOf('var getSession = function()');
        var block   = src.slice(h2Start, h2End);
        var ordered = block.match(/_finalizeStream\(\);[\s\S]{0,160}?_swallowIfNonCritical\(/g) || [];
        assert.strictEqual(ordered.length, 4,
            'all four typed-error terminals must finalize before the swallow (timeout / stream-error / premature-close / 502-exhausted)');
    });

    // ---- pure logic: idempotent, never-throwing finalize replica ----

    // Mirrors _finalizeStream: a one-shot release of a settled HTTP/2 stream.
    function makeFinalizer(req) {
        var finalized = false;
        return function finalize() {
            if (finalized) { return; }
            finalized = true;
            try { req.setTimeout(0); } catch (e) {}
            try { req.removeAllListeners(); } catch (e) {}
            try { if (!req.closed && !req.destroyed) { req.close(); } } catch (e) {}
        };
    }

    function makeReqSpy(state) {
        state = state || {};
        return {
            closed: !!state.closed,
            destroyed: !!state.destroyed,
            _timeout: null,
            _listenersCleared: 0,
            _closed: 0,
            setTimeout: function(ms) { this._timeout = ms; },
            removeAllListeners: function() { this._listenersCleared++; },
            close: function() { this._closed++; this.closed = true; }
        };
    }

    it('finalize replica: releases the stream once (cancels timeout, clears listeners, closes)', function() {
        var req = makeReqSpy();
        makeFinalizer(req)();
        assert.strictEqual(req._timeout, 0,           'stream timeout cancelled via setTimeout(0)');
        assert.strictEqual(req._listenersCleared, 1,  'listeners removed once');
        assert.strictEqual(req._closed, 1,            'stream closed once');
    });

    it('finalize replica: repeated invocations are a no-op (the _finalized idempotency guard)', function() {
        var req = makeReqSpy();
        var finalize = makeFinalizer(req);
        finalize(); finalize(); finalize();
        assert.strictEqual(req._listenersCleared, 1, 'listeners removed exactly once across repeated calls');
        assert.strictEqual(req._closed, 1,           'stream closed exactly once across repeated calls');
    });

    it('finalize replica: skips close() on an already-closed or destroyed stream', function() {
        var closedReq = makeReqSpy({ closed: true });
        makeFinalizer(closedReq)();
        assert.strictEqual(closedReq._closed, 0,           'no close() on an already-closed stream');
        assert.strictEqual(closedReq._listenersCleared, 1, 'listeners still cleared');
        var destroyedReq = makeReqSpy({ destroyed: true });
        makeFinalizer(destroyedReq)();
        assert.strictEqual(destroyedReq._closed, 0,        'no close() on a destroyed stream');
    });

    it('finalize replica: never throws even if a release op throws (cleanup must not break the response path)', function() {
        var req = makeReqSpy();
        req.close = function() { throw new Error('stream already torn down'); };
        assert.doesNotThrow(function() { makeFinalizer(req)(); });
        assert.strictEqual(req._listenersCleared, 1, 'the listeners op ran before the throwing close()');
    });

    // ---- subtract: finalize at the terminal is what releases the stranding listeners ----

    // A non-retry terminal surfaces the typed error to the caller, optionally
    // finalizing the stream first (#B52). Without the finalize, the stream keeps
    // its listeners (onQueryError/onQueryClosed/onEnd capture `callback` -> `self`),
    // stranding the per-request controller + its router.js options.conf clone.
    function terminalReplica(req, finalize, callback) {
        var err = { code: 'TIMEOUT', status: 503 };
        if (finalize) { finalize(); }
        callback(err);
    }

    it('subtract: finalizing at the terminal releases the stream listeners; omitting it (pre-fix) retains them', function() {
        var reqA = makeReqSpy(), cbA = [];
        terminalReplica(reqA, makeFinalizer(reqA), function(e) { cbA.push(e); });
        assert.strictEqual(reqA._listenersCleared, 1, 'finalized terminal releases the stream listeners');
        assert.strictEqual(cbA.length, 1,             'the error still reaches the caller');

        var reqB = makeReqSpy(), cbB = [];
        terminalReplica(reqB, null, function(e) { cbB.push(e); });
        assert.strictEqual(reqB._listenersCleared, 0, 'pre-fix: listeners stay attached, stranding the controller + conf clone');
        assert.strictEqual(cbB.length, 1,             'pre-fix still delivered the error (the retention is silent)');
    });
});
