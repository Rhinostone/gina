/**
 * #B467 — two of `throwError`'s five `writeHead` calls misuse Node's 3-arg
 * overload, passing the literal string `"content-type"` as the statusMessage.
 *
 *     res.writeHead(code, "content-type", "text/plain");          // MSIE branch
 *     res.writeHead(code, "content-type", <json mime + charset>); // no-user-agent branch
 *
 * Node's signature is `writeHead(statusCode[, statusMessage][, headers])`, so
 * `"content-type"` lands in the statusMessage slot and the mime STRING lands in
 * the headers slot. The two sibling branches beside them already use the
 * correct 2-arg object form, which is what makes this read as a typo.
 *
 * WHAT NODE ACTUALLY DOES (measured, node v25.3.0 — it does NOT throw):
 *   HTTP/1.1 — the reason phrase becomes "content-type" and `Object.keys()` of
 *              the mime STRING yields its INDEX keys, so the response carries
 *              ~10-31 junk headers named "0","1","2",... and NO content-type.
 *   HTTP/2   — a one-time `UnsupportedWarning` (status message unsupported,
 *              RFC7540 8.1.2.4) and again NO content-type.
 * So the defect is SILENT corruption of the error response, not a crash — it is
 * invisible in logs and fatal to content negotiation exactly when the error page
 * is being served.
 *
 * REACHABILITY (measured by driving the real method, not inferred): the
 * no-user-agent branch fires for any caller that sends no `user-agent` header at
 * all, which is the common shape for machine callers.
 *
 * WHY THE FIX DECLARES A CHARSET ON THE MSIE BRANCH TOO:
 * every branch here ends at `res.end(JSON.stringify(errorObject))`, whose
 * `error`/`message` fields carry arbitrary caller-supplied text. Measured:
 * `JSON.stringify` does NOT escape non-ASCII and `res.end(<string>)` writes
 * UTF-8, so a charset-less `text/plain` invites a latin-1 guess that corrupts it
 * ("refusé" -> "refusÃ©"). The framework already builds exactly this form at
 * `controller.js:2158` (`'text/plain' + '; charset='+ conf.encoding`).
 *
 * Arms:
 *   §00 instrument validation — the harness can fire AND can fail
 *   §01 source pins          — no 3-arg literal form survives in LIVE code
 *   §02 behaviour, real bytes — both defective branches, driven
 *   §03 controls              — the two correct sibling branches are untouched
 *   §04 charset               — the declared charset matches bundleConf.encoding
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');
var src    = fs.readFileSync(SOURCE, 'utf8');

// The file legitimately RETAINS the defective shape inside a commented-out
// block (the original IE override, kept as history). A negative pin over raw
// source can therefore never reach 0 — strip comment lines first, and assert
// the RAW text still carries the token so a broken strip cannot pass vacuously.
function stripComments(source) {
    return source.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}
var live = stripComments(src);

function countOf(hay, needle) {
    return hay.split(needle).length - 1;
}

var THREE_ARG = 'writeHead(code, "content-type"';


describe('#B467 §00 - instrument validation', function () {

    it('finds a token known to exist and rejects a bogus one', function () {
        assert.ok(src.indexOf('res.writeHead(') > -1, 'known-present token must fire');
        assert.equal(src.indexOf('zz-b467-bogus-token'), -1, 'bogus token must not fire');
    });

    it('the comment strip removes lines without blanking the file', function () {
        // the strip must fail in BOTH directions: a no-op strip and a gutting
        // strip each make the negative pins below vacuous. The floor is the one
        // the sibling strip controls use (connector-settle-parity, couchbase-
        // concurrency): controller.js is comment-dense and legitimately sits
        // near 50% live, so a 0.5 floor tripped on a dead-code removal (#B475).
        assert.ok(live.length < src.length,
            'the strip must have removed something');
        assert.ok(live.length > src.length * 0.3,
            'strip must not gut the source - the pins below would pass vacuously');
        assert.ok(live.indexOf('res.writeHead(') > -1,
            'live code must survive the strip');
    });

    it('the defective shape is a real, findable expression in RAW source', function () {
        // This is the control for the negative pin in §01: raw must always
        // carry the token (the commented-out original at the IE block), so a
        // strip that returned an empty string could never satisfy §01 silently.
        assert.ok(countOf(src, THREE_ARG) > 0,
            'the 3-arg literal shape must be locatable in raw source');
    });
});


describe('#B467 §01 - source pins', function () {

    it('no LIVE code passes "content-type" as the statusMessage argument', function () {
        assert.equal(countOf(live, THREE_ARG), 0,
            '#B467: writeHead(code, "content-type", X) puts the mime string in the '
            + 'headers slot - Node then emits index-keyed junk headers and no content-type');
    });

    it('no live writeHead(code, ...) passes a STRING LITERAL as its second argument', function () {
        // The defect shape is a quoted literal in the statusMessage slot. The
        // predicate is "arg 2 is not a string literal" rather than "arg 2 is a
        // brace", because `res.writeHead(code, headInfos)` on the redirect path
        // legitimately passes an object VARIABLE and must not be flagged.
        var re = /res\.writeHead\(code,\s*(.)/g, m, bad = 0, total = 0;
        while ((m = re.exec(live)) !== null) {
            total++;
            if (m[1] === '"' || m[1] === "'") bad++;
        }
        assert.ok(total >= 5, 'expected at least the five writeHead(code, ...) sites, saw ' + total);
        assert.equal(bad, 0, '#B467: ' + bad + ' live writeHead(code, ...) call(s) pass a string literal '
            + 'where Node expects a statusMessage - the mime string then lands in the headers slot');
    });

    it('the framework text/plain+charset convention is the one adopted', function () {
        assert.ok(live.indexOf("'text/plain; charset='") > -1,
            '#B467: the MSIE branch must declare the charset of the UTF-8 body it sends');
    });
});


/**
 * Drives the REAL throwError and captures every argument handed to writeHead.
 *
 * @param {Object} reqHeaders    - request headers (selects the branch)
 * @param {Object} resGetHeaders - what res.getHeaders() returns
 * @returns {{seen: Array, threw: (string|null)}}
 */
function makeDriver() {
    process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
    require('module').Module._initPaths();
    require(path.join(FW, 'helpers'));
    setPath('gina', { core: path.join(FW, 'core') });
    var SuperController = require(SOURCE);

    var STATUS_CODES = {
        '200': 'OK', '404': 'Not Found',
        '500': 'Internal Server Error', '503': 'Service Unavailable'
    };

    return function drive(reqHeaders, resGetHeaders) {
        var seen = [];
        var res = {
            statusCode: 200, headersSent: false,
            setHeader: function () {}, getHeader: function () {},
            getHeaders: function () { return resGetHeaders; },
            writeHead: function () { seen.push(Array.prototype.slice.call(arguments)); },
            end: function () {}
        };
        var req = {
            url: '/x', method: 'GET',
            routing: { rule: 'r@b', param: {} },
            params: {}, get: {}, headers: reqHeaders
        };
        var options = {
            rule: 'r', control: 'action', encoding: 'utf8',
            conf: {
                bundle: 'b', encoding: 'utf8',
                server: { coreConfiguration: {
                    statusCodes: STATUS_CODES,
                    mime: { json: 'application/json', html: 'text/html' }
                } },
                content: { routing: {}, templates: { _common: {} } }
            }
        };
        var inst = SuperController.createTestInstance({
            req: req, res: res, next: function () {}, options: options
        });
        var threw = null;
        try { inst.throwError({ status: 404, error: 'boom' }); }
        catch (e) { threw = e.code || e.name; }
        return { seen: seen, threw: threw };
    };
}

var MSIE = { 'user-agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1)' };


describe('#B467 §02 - behaviour over real bytes', function () {

    var drive = makeDriver();

    it('the MSIE branch hands writeHead an object, not a statusMessage', function () {
        var r = drive(MSIE, {});
        assert.ok(r.seen.length > 0, 'writeHead was never called');
        assert.equal(r.seen[0].length, 2,
            '#B467: MSIE branch called writeHead with ' + r.seen[0].length
            + ' args - the 3-arg form puts the mime string in the headers slot');
        assert.equal(typeof r.seen[0][1], 'object',
            '#B467: the headers argument must be an object');
        assert.ok(r.seen[0][1]['content-type'],
            '#B467: a content-type must actually reach the client');
    });

    it('the no-user-agent branch hands writeHead an object, not a statusMessage', function () {
        // Reachable for any machine caller that sends no user-agent at all.
        var r = drive({}, {});
        assert.ok(r.seen.length > 0, 'writeHead was never called');
        assert.equal(r.seen[0].length, 2,
            '#B467: no-user-agent branch called writeHead with ' + r.seen[0].length + ' args');
        assert.equal(typeof r.seen[0][1], 'object',
            '#B467: the headers argument must be an object');
        assert.ok(r.seen[0][1]['content-type'],
            '#B467: a content-type must actually reach the client');
    });

    it('neither defective branch throws - the defect is silent (documents the failure mode)', function () {
        assert.equal(drive(MSIE, {}).threw, null);
        assert.equal(drive({}, {}).threw, null);
    });
});


describe('#B467 §03 - controls (the correct sibling branches must be untouched)', function () {

    var drive = makeDriver();

    it('control - a normal user-agent still gets the json mime object form', function () {
        var r = drive({ 'user-agent': 'curl/8.0' }, {});
        assert.equal(r.seen[0].length, 2, 'sibling branch must stay 2-arg');
        assert.equal(r.seen[0][1]['content-type'], 'application/json; charset=utf8');
    });

    it('control - no user-agent but a preset content-type is echoed back', function () {
        var r = drive({}, { 'content-type': 'application/json' });
        assert.equal(r.seen[0].length, 2, 'sibling branch must stay 2-arg');
        assert.equal(r.seen[0][1]['content-type'], 'application/json');
    });
});


describe('#B467 §04 - the declared charset matches the bytes actually sent', function () {

    var drive = makeDriver();

    it('the MSIE branch declares text/plain with the bundle encoding', function () {
        // The body is JSON.stringify(errorObject) written via res.end(), i.e.
        // UTF-8 on the wire; a charset-less text/plain invites a latin-1 guess.
        var r = drive(MSIE, {});
        assert.equal(r.seen[0][1]['content-type'], 'text/plain; charset=utf8',
            '#B467: the MSIE override must still declare the charset of its UTF-8 body');
    });

    it('the no-user-agent branch keeps its json mime and charset', function () {
        var r = drive({}, {});
        assert.equal(r.seen[0][1]['content-type'], 'application/json; charset=utf8');
    });
});
