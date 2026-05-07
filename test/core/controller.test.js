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
