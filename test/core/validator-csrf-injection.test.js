'use strict';
/**
 * Validator AJAX CSRF header injection (#CSRF2 follow-up) tests
 *
 * Covers the browser-side validator plugin reading the gina-csrf-token
 * cookie set by the Csrf plugin and injecting the X-Gina-CSRF-Token
 * header on mutating XHR requests (POST/PUT/PATCH/DELETE).
 *
 * Strategy:
 *  - Source-inspection guards pin the three injection sites.
 *  - readCsrfCookie() helper extracted via vm sandbox (purity check).
 *  - Synthetic XHR + document.cookie sandbox covers the behaviour:
 *      * cookie present + non-safe method  -> header set
 *      * cookie absent                     -> no header
 *      * safe method (GET/HEAD/OPTIONS)    -> no header
 *  - Negative invariant: no eval, no Function constructor, no
 *    `new Function(` in the new helper region.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var vm     = require('vm');

var FW         = require('../fw');
var MAIN       = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var FORM_VAL   = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');

var mainSrc, formValSrc;

before(function () {
    mainSrc    = fs.readFileSync(MAIN, 'utf8');
    formValSrc = fs.readFileSync(FORM_VAL, 'utf8');
});


// ─── 01 — Source inspection: three injection sites are present ─────────────

describe('01 - source inspection: three CSRF header injection sites', function () {

    it('main.js form-submit XHR injection site (#1)', function () {
        // form-submit XHR header loop, followed by isMutatingMethod + readCsrfCookie
        var re = /for \(var hearder in options\.headers\)[\s\S]{0,500}xhr\.setRequestHeader\(hearder[\s\S]{0,400}#CSRF2 follow-up[\s\S]{0,200}isMutatingMethod\(options\.method\)[\s\S]{0,200}readCsrfCookie\(\)[\s\S]{0,200}xhr\.setRequestHeader\('X-Gina-CSRF-Token'/;
        assert.ok(re.test(mainSrc),
            'expected CSRF header injection after the form-submit header loop in main.js');
    });

    it('main.js file-removal DELETE XHR injection site (#2)', function () {
        // file-removal: xhrOptions.headers['X-Gina-CSRF-Token'] = csrfToken before setupXhr
        var re = /let xhrOptions = \{[\s\S]{0,1200}#CSRF2 follow-up[\s\S]{0,300}isMutatingMethod\(method\)[\s\S]{0,300}readCsrfCookie\(\)[\s\S]{0,300}xhrOptions\.headers\['X-Gina-CSRF-Token'\][\s\S]{0,200}setupXhr\(xhrOptions\)/;
        assert.ok(re.test(mainSrc),
            'expected CSRF header injection in file-removal xhrOptions in main.js');
    });

    it('form-validator.js live-validation XHR injection site (#3)', function () {
        // live-validation: queryOptions.method, after the header loop
        var re = /xhr\.setRequestHeader\('Content-Type', enctype\)[\s\S]{0,400}#CSRF2 follow-up[\s\S]{0,200}isMutatingMethod\(queryOptions\.method\)[\s\S]{0,200}readCsrfCookie\(\)[\s\S]{0,200}xhr\.setRequestHeader\('X-Gina-CSRF-Token'/;
        assert.ok(re.test(formValSrc),
            'expected CSRF header injection after live-validation header loop in form-validator.js');
    });

    it('main.js declares the readCsrfCookie helper', function () {
        assert.ok(/var readCsrfCookie = function \(\)/.test(mainSrc),
            'expected readCsrfCookie helper declaration in main.js');
        assert.ok(/'gina-csrf-token'/.test(mainSrc),
            'expected gina-csrf-token cookie name literal in main.js');
    });

    it('form-validator.js declares the readCsrfCookie helper', function () {
        assert.ok(/var readCsrfCookie = function \(\)/.test(formValSrc),
            'expected readCsrfCookie helper declaration in form-validator.js');
        assert.ok(/'gina-csrf-token'/.test(formValSrc),
            'expected gina-csrf-token cookie name literal in form-validator.js');
    });

    it('main.js declares the isMutatingMethod helper', function () {
        assert.ok(/var isMutatingMethod = function/.test(mainSrc),
            'expected isMutatingMethod helper declaration in main.js');
        // checks that GET/HEAD/OPTIONS are excluded
        assert.ok(/'GET'/.test(mainSrc) && /'HEAD'/.test(mainSrc) && /'OPTIONS'/.test(mainSrc),
            'expected GET/HEAD/OPTIONS literals in main.js');
    });

    it('form-validator.js declares the isMutatingMethod helper', function () {
        assert.ok(/var isMutatingMethod = function/.test(formValSrc),
            'expected isMutatingMethod helper declaration in form-validator.js');
    });
});


// ─── helpers — extract readCsrfCookie + isMutatingMethod via vm sandbox ────

function loadHelpers(src) {
    // Locate the readCsrfCookie + isMutatingMethod block. We extract the
    // first occurrence of each via small sub-sandbox. The helpers are pure
    // (only depend on `document.cookie` for readCsrfCookie) so we can
    // evaluate them in isolation.
    var rcMatch = src.match(/var readCsrfCookie = function \(\) \{[\s\S]*?\n    \};/);
    var imMatch = src.match(/var isMutatingMethod = function \(method\) \{[\s\S]*?\n    \};/);
    assert.ok(rcMatch, 'could not locate readCsrfCookie source block');
    assert.ok(imMatch, 'could not locate isMutatingMethod source block');

    var bundle =
        '(function (sandbox) {\n' +
        '    var document = sandbox.document;\n' +
        '    ' + rcMatch[0] + '\n' +
        '    ' + imMatch[0] + '\n' +
        '    sandbox.readCsrfCookie  = readCsrfCookie;\n' +
        '    sandbox.isMutatingMethod = isMutatingMethod;\n' +
        '})';

    var sandbox = {};
    var fn = vm.runInThisContext(bundle);
    return { invoke: fn, sandbox: sandbox };
}


// ─── 02 — readCsrfCookie helper: parses cookie correctly ───────────────────

describe('02 - readCsrfCookie: pure parser behaviour', function () {

    it('returns the token value when the gina-csrf-token cookie is present', function () {
        var loader = loadHelpers(mainSrc);
        loader.invoke({
            document: { cookie: 'gina-csrf-token=abc.def-xyz; foo=bar' }
        });
        var s = {};
        loader.invoke(Object.assign(s, {
            document: { cookie: 'gina-csrf-token=abc.def-xyz; foo=bar' }
        }));
        assert.equal(s.readCsrfCookie(), 'abc.def-xyz');
    });

    it('returns null when no cookie matches', function () {
        var loader = loadHelpers(mainSrc);
        var s = { document: { cookie: 'foo=bar; baz=qux' } };
        loader.invoke(s);
        assert.equal(s.readCsrfCookie(), null);
    });

    it('returns null when document is undefined', function () {
        var loader = loadHelpers(mainSrc);
        var s = {};
        loader.invoke(s);
        assert.equal(s.readCsrfCookie(), null);
    });

    it('returns null when document.cookie is empty', function () {
        var loader = loadHelpers(mainSrc);
        var s = { document: { cookie: '' } };
        loader.invoke(s);
        assert.equal(s.readCsrfCookie(), null);
    });

    it('handles leading whitespace between cookie pairs', function () {
        var loader = loadHelpers(mainSrc);
        var s = { document: { cookie: 'foo=bar;   gina-csrf-token=signed.value' } };
        loader.invoke(s);
        assert.equal(s.readCsrfCookie(), 'signed.value');
    });

    it('URL-decodes the cookie value', function () {
        var loader = loadHelpers(mainSrc);
        var s = { document: { cookie: 'gina-csrf-token=' + encodeURIComponent('abc/def+ghi') } };
        loader.invoke(s);
        assert.equal(s.readCsrfCookie(), 'abc/def+ghi');
    });

    it('does not match a cookie whose name is a prefix of gina-csrf-token', function () {
        var loader = loadHelpers(mainSrc);
        var s = { document: { cookie: 'gina-csrf=wrong; gina-csrf-token=correct' } };
        loader.invoke(s);
        assert.equal(s.readCsrfCookie(), 'correct');
    });
});


// ─── 03 — isMutatingMethod gate ────────────────────────────────────────────

describe('03 - isMutatingMethod: safe-method bypass', function () {

    it('returns false for GET, HEAD, OPTIONS (case-insensitive)', function () {
        var loader = loadHelpers(mainSrc);
        var s = {};
        loader.invoke(s);
        assert.equal(s.isMutatingMethod('GET'),     false);
        assert.equal(s.isMutatingMethod('get'),     false);
        assert.equal(s.isMutatingMethod('HEAD'),    false);
        assert.equal(s.isMutatingMethod('head'),    false);
        assert.equal(s.isMutatingMethod('OPTIONS'), false);
        assert.equal(s.isMutatingMethod('options'), false);
    });

    it('returns true for POST, PUT, PATCH, DELETE (case-insensitive)', function () {
        var loader = loadHelpers(mainSrc);
        var s = {};
        loader.invoke(s);
        assert.equal(s.isMutatingMethod('POST'),   true);
        assert.equal(s.isMutatingMethod('post'),   true);
        assert.equal(s.isMutatingMethod('PUT'),    true);
        assert.equal(s.isMutatingMethod('PATCH'),  true);
        assert.equal(s.isMutatingMethod('DELETE'), true);
    });

    it('returns false for non-string / empty method', function () {
        var loader = loadHelpers(mainSrc);
        var s = {};
        loader.invoke(s);
        assert.equal(s.isMutatingMethod(undefined), false);
        assert.equal(s.isMutatingMethod(null),      false);
        assert.equal(s.isMutatingMethod(''),        false);
        assert.equal(s.isMutatingMethod(123),       false);
    });
});


// ─── 04 — End-to-end: header injection on mutating method, no-op otherwise ─

describe('04 - header injection end-to-end via XHR stub', function () {

    function buildXhrStub() {
        var headers = {};
        return {
            headers: headers,
            setRequestHeader: function (k, v) { headers[k] = v; }
        };
    }

    function injectInto(stub, method, cookieJar) {
        // Mirrors the snippet appended to each header loop in the source.
        var loader = loadHelpers(mainSrc);
        var s = { document: { cookie: cookieJar } };
        loader.invoke(s);
        if ( s.isMutatingMethod(method) ) {
            var csrfToken = s.readCsrfCookie();
            if (csrfToken) {
                stub.setRequestHeader('X-Gina-CSRF-Token', csrfToken);
            }
        }
    }

    it('sets X-Gina-CSRF-Token when cookie present and method is POST', function () {
        var x = buildXhrStub();
        injectInto(x, 'POST', 'gina-csrf-token=tok-1');
        assert.equal(x.headers['X-Gina-CSRF-Token'], 'tok-1');
    });

    it('sets X-Gina-CSRF-Token on PUT, PATCH, DELETE', function () {
        ['PUT', 'PATCH', 'DELETE'].forEach(function (m) {
            var x = buildXhrStub();
            injectInto(x, m, 'gina-csrf-token=tok-' + m);
            assert.equal(x.headers['X-Gina-CSRF-Token'], 'tok-' + m, 'method ' + m);
        });
    });

    it('does NOT set the header when method is GET (safe method bypass)', function () {
        var x = buildXhrStub();
        injectInto(x, 'GET', 'gina-csrf-token=tok-2');
        assert.equal(x.headers['X-Gina-CSRF-Token'], undefined);
    });

    it('does NOT set the header when method is HEAD or OPTIONS', function () {
        ['HEAD', 'OPTIONS'].forEach(function (m) {
            var x = buildXhrStub();
            injectInto(x, m, 'gina-csrf-token=tok-3');
            assert.equal(x.headers['X-Gina-CSRF-Token'], undefined, 'method ' + m);
        });
    });

    it('does NOT set the header when cookie is absent (mutating method, no token)', function () {
        var x = buildXhrStub();
        injectInto(x, 'POST', 'foo=bar; baz=qux');
        assert.equal(x.headers['X-Gina-CSRF-Token'], undefined);
    });

    it('does NOT set the header when document.cookie is empty', function () {
        var x = buildXhrStub();
        injectInto(x, 'POST', '');
        assert.equal(x.headers['X-Gina-CSRF-Token'], undefined);
    });
});


// ─── 05 — Negative invariant: no eval / new Function in the new helpers ────

describe('05 - negative invariant: no eval / new Function in CSRF helpers', function () {

    function isolateCsrfRegion(src) {
        // Pull just the CSRF helper block (readCsrfCookie + isMutatingMethod).
        var start = src.indexOf('var readCsrfCookie = function ()');
        assert.ok(start > -1, 'expected readCsrfCookie marker');
        // ends after isMutatingMethod's closing };
        var end   = src.indexOf('};', src.indexOf('var isMutatingMethod = function', start));
        assert.ok(end > start, 'expected isMutatingMethod block after readCsrfCookie');
        return src.slice(start, end + 2);
    }

    it('main.js CSRF region contains no eval(', function () {
        var region = isolateCsrfRegion(mainSrc);
        assert.ok(!/\beval\s*\(/.test(region), 'eval() must not appear in the CSRF helper region');
    });

    it('main.js CSRF region contains no new Function(', function () {
        var region = isolateCsrfRegion(mainSrc);
        assert.ok(!/new\s+Function\s*\(/.test(region),
            'new Function(...) must not appear in the CSRF helper region');
    });

    it('form-validator.js CSRF region contains no eval(', function () {
        var region = isolateCsrfRegion(formValSrc);
        assert.ok(!/\beval\s*\(/.test(region), 'eval() must not appear in the CSRF helper region');
    });

    it('form-validator.js CSRF region contains no new Function(', function () {
        var region = isolateCsrfRegion(formValSrc);
        assert.ok(!/new\s+Function\s*\(/.test(region),
            'new Function(...) must not appear in the CSRF helper region');
    });
});
