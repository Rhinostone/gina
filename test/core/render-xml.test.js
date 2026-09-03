'use strict';
/**
 * renderXML — controller.render-xml.js unit tests (#FIN2)
 *
 * Strategy: drive the REAL delegate with injected deps and fake HTTP objects.
 * Source pins cover the structural invariants (scoping, guard placement); every
 * behavioural claim is driven and asserted on a captured response.
 *
 * ⚠️ `res` is captured BEFORE each call: the delegate nulls local.req/res/next
 * on every terminal exit, so `deps.local.res.<prop>` after the call reads off
 * null. That failure surfaces at the assertion line and reads like "the source
 * is wrong" — it is a harness bug every time (jsdoc.md).
 *
 * Suites:
 *  01 — controller.js: renderXML wired to the delegate
 *  02 — guards: double-render, isProcessingError, released response (#B36)
 *  03 — content-type: application/xml default, override, charset
 *  04 — HTTP/1.1 body
 *  05 — HTTP/2: respond frame, :status, pending-header fold, #H10 trailers
 *  06 — HEAD suppression
 *  07 — input coercion
 *  08 — #FIN6 idempotency record hook
 *  09 — terminal-exit ref nulling
 *  10 — source pins: #B63 function-scoped deps
 */
var { describe, it }  = require('node:test');
var assert  = require('node:assert/strict');
var path    = require('path');
var fs      = require('fs');

var FW              = require('../fw');
var CONTROLLER_SRC  = path.join(FW, 'core/controller/controller.js');
var RENDER_XML_SRC  = path.join(FW, 'core/controller/controller.render-xml.js');

var renderXML = require(RENDER_XML_SRC);
var lib       = require(path.join(FW, 'lib'));

var DOC = '<?xml version="1.0" encoding="UTF-8"?><Document><Amt Ccy="EUR">123.45</Amt></Document>';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRes(overrides) {
    var headers = {};
    return Object.assign({
        statusCode  : 200,
        headersSent : false,
        _ended      : null,
        _headers    : headers,
        setHeader   : function(k, v) { headers[k.toLowerCase()] = v; },
        getHeaders  : function() { return headers; },
        end         : function(b) { this._ended = (typeof b == 'undefined') ? '' : b; }
    }, overrides);
}

function makeStream() {
    return {
        headersSent : false,
        destroyed   : false,
        closed      : false,
        _frame      : null,
        _opts       : null,
        _ended      : null,
        _trailers   : null,
        _once       : {},
        once        : function(ev, cb) { this._once[ev] = cb; },
        respond     : function(f, o) { this._frame = f; this._opts = o; this.headersSent = true; },
        sendTrailers: function(t) { this._trailers = t; },
        end         : function(b) { this._ended = (typeof b == 'undefined') ? '' : b; }
    };
}

function makeDeps(o) {
    o = o || {};
    var res = o.res || makeRes();
    if (o.stream) { res.stream = o.stream; }
    var local = {
        req  : Object.assign({ method: 'POST', url: '/iso20022' }, o.req || {}),
        res  : ('res' in o && o.res === null) ? null : res,
        next : o.next || null,
        options: { renderingStack: o.renderingStack || [], conf: { encoding: 'utf-8' } }
    };
    if (o.trailers) { local._trailers = o.trailers; }
    var thrown = [];
    var self = {
        isProcessingError : !!o.isProcessingError,
        throwError        : function() { thrown.push(Array.prototype.slice.call(arguments)); }
    };
    var sent = !!o.headersSent;
    return {
        deps   : { self: self, local: local, headersSent: function() { return sent; } },
        res    : res,      // captured BEFORE the call — the delegate nulls local.res
        thrown : thrown
    };
}


// ─── 01 — controller.js wiring ───────────────────────────────────────────────

describe('01 - renderXML: controller.js wiring', function() {
    var src = fs.readFileSync(CONTROLLER_SRC, 'utf8');

    it('registers renderXML as an instance method (not on the prototype)', function() {
        assert.match(src, /this\.renderXML\s*=\s*function\(xmlContent, contentType\)/);
        assert.doesNotMatch(src, /prototype\.renderXML/);
    });

    it('delegates to controller.render-xml with the 3-key deps contract', function() {
        var i = src.indexOf('this.renderXML = function');
        var block = src.slice(i, src.indexOf('this.renderTEXT', i));
        assert.match(block, /require\(\s*_\(__dirname \+ '\/controller\.render-xml', true\)\s*\)\(xmlContent, contentType, \{/);
        ['self', 'local', 'headersSent'].forEach(function(k) {
            assert.ok(block.indexOf(k + '        : ' + k) > -1 || new RegExp(k + '\\s*:\\s*' + k).test(block), 'deps must carry ' + k);
        });
    });

    it('cache-busts the delegate in dev mode (the house hot-reload pattern)', function() {
        var i = src.indexOf('this.renderXML = function');
        var block = src.slice(i, src.indexOf('this.renderTEXT', i));
        assert.match(block, /isCacheless\(\)[\s\S]{0,120}delete require\.cache\[require\.resolve\([\s\S]{0,80}controller\.render-xml/);
    });
});


// ─── 02 — guards ─────────────────────────────────────────────────────────────

describe('02 - renderXML: guards', function() {
    it('returns false when another controller is already rendering (renderingStack)', function() {
        var h = makeDeps({ renderingStack: [1, 2] });
        assert.equal(renderXML(DOC, null, h.deps), false);
        assert.equal(h.res._ended, null, 'nothing must be written');
    });

    it('bails while an error is being processed', function() {
        var h = makeDeps({ isProcessingError: true });
        renderXML(DOC, null, h.deps);
        assert.equal(h.res._ended, null);
    });

    it('#B36 — a RELEASED response returns without dereferencing null', function() {
        var h = makeDeps({ res: null });
        assert.doesNotThrow(function() { renderXML(DOC, null, h.deps); },
            'the local.res.stream read would crash the bundle (uncaughtException -> SIGTERM)');
    });
});


// ─── 03 — content type ───────────────────────────────────────────────────────

describe('03 - renderXML: content-type and charset', function() {
    it('defaults to application/xml (RFC 7303 §4.1), never the mime-table text/xml', function() {
        var h = makeDeps();
        renderXML(DOC, null, h.deps);
        assert.equal(h.res._headers['content-type'], 'application/xml; charset=utf-8');
    });

    it('honours an explicit content type — the suffix family needs no second API', function() {
        [
            'application/soap+xml',
            'application/atom+xml',
            'application/vnd.acme.order+xml'
        ].forEach(function(ct) {
            var h = makeDeps();
            renderXML(DOC, ct, h.deps);
            assert.equal(h.res._headers['content-type'], ct + '; charset=utf-8');
        });
    });

    it('ignores a blank/whitespace override and falls back to the default', function() {
        var h = makeDeps();
        renderXML(DOC, '   ', h.deps);
        assert.equal(h.res._headers['content-type'], 'application/xml; charset=utf-8');
    });

    it('takes the charset from the bundle encoding, not a literal', function() {
        var h = makeDeps();
        h.deps.local.options.conf.encoding = 'iso-8859-1';
        renderXML(DOC, null, h.deps);
        assert.equal(h.res._headers['content-type'], 'application/xml; charset=iso-8859-1');
    });
});


// ─── 04 — HTTP/1.1 ───────────────────────────────────────────────────────────

describe('04 - renderXML: HTTP/1.1 body', function() {
    it('writes the document verbatim', function() {
        var h = makeDeps();
        renderXML(DOC, null, h.deps);
        assert.equal(h.res._ended, DOC, 'the body must be byte-identical to what the action passed');
    });

    it('does not force a 200 — the status set upstream survives', function() {
        var h = makeDeps({ res: makeRes({ statusCode: 202 }) });
        renderXML(DOC, null, h.deps);
        assert.equal(h.res.statusCode, 202);
    });
});


// ─── 05 — HTTP/2 ─────────────────────────────────────────────────────────────

describe('05 - renderXML: HTTP/2 stream path', function() {
    it('responds with a frame carrying content-type and :status, then ends with the body', function() {
        var st = makeStream();
        var h  = makeDeps({ stream: st, res: makeRes({ statusCode: 201 }) });
        renderXML(DOC, null, h.deps);
        assert.equal(st._frame['content-type'], 'application/xml; charset=utf-8');
        assert.equal(st._frame[':status'], 201, 'a literal 200 here would serve every error as 200 (#B172)');
        assert.equal(st._ended, DOC);
    });

    it('folds pending response headers into the frame (they do not travel with respond())', function() {
        var st  = makeStream();
        var res = makeRes();
        res.setHeader('x-custom', 'kept');
        var h = makeDeps({ stream: st, res: res });
        renderXML(DOC, null, h.deps);
        assert.equal(st._frame['x-custom'], 'kept');
    });

    it('a destroyed stream is detected — no respond() on a disconnected client', function() {
        var st = makeStream();
        st.destroyed = true;
        var h  = makeDeps({ stream: st });
        assert.doesNotThrow(function() { renderXML(DOC, null, h.deps); });
        assert.equal(st._frame, null, 'respond() would throw ERR_HTTP2_INVALID_STREAM');
    });

    it('#H10 — trailers set waitForTrailers and flush on wantTrailers', function() {
        var st = makeStream();
        var h  = makeDeps({ stream: st, trailers: { 'x-checksum': 'abc' } });
        renderXML(DOC, null, h.deps);
        assert.deepEqual(st._opts, { waitForTrailers: true });
        assert.equal(typeof st._once['wantTrailers'], 'function', 'without the handler the stream hangs forever');
        st._once['wantTrailers']();
        assert.deepEqual(st._trailers, { 'x-checksum': 'abc' });
    });

    it('no trailers registered — waitForTrailers stays undefined', function() {
        var st = makeStream();
        var h  = makeDeps({ stream: st });
        renderXML(DOC, null, h.deps);
        assert.equal(st._opts, undefined);
    });
});


// ─── 06 — HEAD ───────────────────────────────────────────────────────────────

describe('06 - renderXML: HEAD suppression', function() {
    it('HTTP/1.1 HEAD sends content-length but no body', function() {
        var h = makeDeps({ req: { method: 'HEAD' } });
        renderXML(DOC, null, h.deps);
        assert.equal(h.res._headers['content-length'], Buffer.byteLength(DOC, 'utf8'));
        assert.equal(h.res._ended, '', 'HEAD must not carry a body');
    });

    it('HTTP/2 HEAD responds with the frame and ends empty', function() {
        var st = makeStream();
        var h  = makeDeps({ stream: st, req: { method: 'HEAD' } });
        renderXML(DOC, null, h.deps);
        assert.equal(st._frame['content-length'], Buffer.byteLength(DOC, 'utf8'));
        assert.equal(st._ended, '');
    });

    it('content-length is BYTE length, not string length (multi-byte documents)', function() {
        var wide = '<n>' + 'ééé' + '</n>';
        var h = makeDeps({ req: { method: 'HEAD' } });
        renderXML(wide, null, h.deps);
        assert.equal(h.res._headers['content-length'], Buffer.byteLength(wide, 'utf8'));
        assert.notEqual(Buffer.byteLength(wide, 'utf8'), wide.length, 'fixture must actually be multi-byte');
    });
});


// ─── 07 — input coercion ─────────────────────────────────────────────────────

describe('07 - renderXML: input coercion', function() {
    it('null and undefined send an empty body rather than throwing', function() {
        [null, undefined].forEach(function(v) {
            var h = makeDeps();
            assert.doesNotThrow(function() { renderXML(v, null, h.deps); },
                'toString() on ' + String(v) + ' would throw inside the render');
            assert.equal(h.res._ended, '');
        });
    });

    it('a non-string is coerced via toString() (the renderTEXT convention)', function() {
        var h = makeDeps();
        renderXML({ toString: function() { return '<n/>'; } }, null, h.deps);
        assert.equal(h.res._ended, '<n/>');
    });
});


// ─── 08 — #FIN6 idempotency hook ─────────────────────────────────────────────

describe('08 - renderXML: #FIN6 idempotency record hook', function() {
    function withStubbedRecord(fn) {
        var original = lib.idempotency.record;
        var calls    = [];
        lib.idempotency.record = function() { calls.push(Array.prototype.slice.call(arguments)); };
        try { fn(calls); } finally { lib.idempotency.record = original; }
    }

    it('records the envelope when the request carries an idempotency capture', function() {
        withStubbedRecord(function(calls) {
            var h = makeDeps({ req: { _idemCapture: { resKey: 'k' } } });
            renderXML(DOC, null, h.deps);
            assert.equal(calls.length, 1, 'an idempotency-reserved XML route must RECORD, or a retry re-executes');
            assert.equal(calls[0][2], DOC, 'the recorded body must be what goes on the wire');
        });
    });

    it('does not record on an ordinary request (one property read, no store traffic)', function() {
        withStubbedRecord(function(calls) {
            var h = makeDeps();
            renderXML(DOC, null, h.deps);
            assert.equal(calls.length, 0);
        });
    });
});


// ─── 09 — terminal-exit nulling ──────────────────────────────────────────────

describe('09 - renderXML: per-request refs released on every exit path', function() {
    [
        ['HTTP/1.1 body', {}],
        ['HTTP/2 body',   { stream: true }],
        ['HTTP/1.1 HEAD', { req: { method: 'HEAD' } }],
        ['HTTP/2 HEAD',   { stream: true, req: { method: 'HEAD' } }]
    ].forEach(function(c) {
        it(c[0] + ' nulls local.req/res/next', function() {
            var o = Object.assign({}, c[1]);
            if (o.stream) { o.stream = makeStream(); }
            var h = makeDeps(o);
            renderXML(DOC, null, h.deps);
            assert.equal(h.deps.local.req, null);
            assert.equal(h.deps.local.res, null);
            assert.equal(h.deps.local.next, null);
        });
    });
});


// ─── 10 — source pins ────────────────────────────────────────────────────────

describe('10 - renderXML: #B63 function-scoped deps', function() {
    var src = fs.readFileSync(RENDER_XML_SRC, 'utf8');

    it('declares NO per-request state at module scope', function() {
        var prefix = src.slice(0, src.indexOf('module.exports'));
        ['self', 'local', 'headersSent', 'request', 'response', 'stream'].forEach(function(name) {
            assert.doesNotMatch(prefix, new RegExp('^[ \\t]*(?:var|const|let)[ \\t]+' + name + '\\b', 'm'),
                name + ' is module-scoped — a concurrent render would reassign it (#B63)');
        });
    });

    it('the released-response guard precedes the first local.res dereference', function() {
        // Comment-stripped deliberately: the guard's own comment EXPLAINS itself by
        // naming `local.res.stream`, and that mention sits above the guard — a raw
        // indexOf finds the comment first and inverts the ordering assertion. Same
        // anchor-theft shape the pre-existing http-methods §13 pin hit this arc.
        var live  = src.split('\n').filter(function(l) { return !/^\s*\/\//.test(l); }).join('\n');
        var guard = live.indexOf('if ( local.res == null )');
        var deref = live.indexOf('local.res.stream');
        assert.ok(guard > -1 && deref > -1, 'both anchors present');
        assert.ok(guard < deref, 'the guard must come first, or a released response crashes the bundle');
        // anti-vacuity: the strip must not have removed the code the pin measures
        assert.match(live, /if \( local\.res == null \)/);
    });

    it('carries the #FIN6 hook at a single body-resolution point', function() {
        var hits = (src.match(/lib\.idempotency\.record\(/g) || []).length;
        assert.equal(hits, 1, 'exactly one record site, mirroring render-json stringify choke point');
    });
});
