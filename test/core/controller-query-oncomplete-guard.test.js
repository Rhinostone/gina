'use strict';
/**
 * #B485 — `self.query()`'s fluent `onComplete()` rejects a non-function at registration.
 *
 * The fluent handle minted for a missing/`null` callback (#B475) pushed `_fluentDelivery(cb)`
 * without testing `typeof(cb)`, so `.onComplete('oops')` / `.onComplete(null)` registered a
 * deliverer whose `cb(...)` call threw at settle — INSIDE `_fluentDelivery`'s own try/catch,
 * which converted it into `self.throwError(new Error('Controller Query Exception while catching
 * back…'))`: a 500 that blamed the application's callback for an exception it never had, at
 * settle time rather than at the caller's line. (The ledger's first reading — "uncaughtException"
 * — was code-read and WRONG; driven pre-fix on a real createTestInstance the throw is caught and
 * misattributed. A fixture lacking `options.controller` does produce an uncaughtException — from
 * the catch block's own `.substring` on undefined — which is how that misreading arose.)
 *
 * Fix mirrors `store()`'s registration guard (#B480): `onComplete()` throws a `TypeError` naming
 * `Controller::query` synchronously when given a non-function; the minting guard on the CALL
 * argument (`typeof(callback) != 'function'`) is untouched — a different site, a different check.
 *
 * House style: source pins censused on a comment-stripped slice of query(), behavioural arms on
 * the real instance using the #B479 nested-render refusal as a synchronous settle, a
 * `throwError` spy as the misattribution instrument, and store()'s shipped guard as the control.
 * Every discriminating arm was run RED against the pre-change source first.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW     = process.env.GINA_FW || require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');

function stripComments(src) {
    return src.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
}
function countOf(hay, needle) { return hay.split(needle).length - 1; }

describe('01 - #B485 source pins: the registration guard in query(), the minting guard untouched', function () {
    var src, live, queryLive, storeLive;
    before(function () {
        src  = fs.readFileSync(SOURCE, 'utf8');
        live = stripComments(src);
        var qFrom = live.indexOf('this.query = function(options, data, callback)');
        var qTo   = live.indexOf('this.queryOptions = function');   // structural anchor after query()
        if (qTo < 0) { qTo = live.indexOf('Make an outbound HTTP', qFrom); }
        assert.ok(qFrom > -1, 'query() present');
        queryLive = live.slice(qFrom, qTo > qFrom ? qTo : undefined);
        var sFrom = live.indexOf('this.store = function');
        storeLive = live.slice(sFrom, qFrom);
        assert.ok(sFrom > -1 && sFrom < qFrom, 'store() precedes query()');
    });

    it('onComplete() rejects a non-function at registration with a TypeError naming Controller::query', function () {
        var re = /onComplete: function\(cb\) \{\s*if \( typeof\(cb\) != 'function' \) \{\s*throw new TypeError\('Controller::query — onComplete expects a function, got '/;
        assert.ok(re.test(queryLive), 'the guard sits first in the registration body');
    });

    it('the deliverer is still minted exactly once, after the guard', function () {
        assert.strictEqual(countOf(queryLive, 'var deliver = _fluentDelivery(cb);'), 1);
        var g = queryLive.indexOf("if ( typeof(cb) != 'function' ) {");
        var d = queryLive.indexOf('var deliver = _fluentDelivery(cb);');
        assert.ok(g > -1 && d > g, 'guard precedes the mint');
    });

    it('the minting guard on the CALL argument is the one check at its site (untouched)', function () {
        assert.strictEqual(countOf(queryLive, "if ( typeof(callback) != 'function' ) {"), 1);
    });

    it('control — store()\'s #B480 registration guard is intact and distinct', function () {
        assert.ok(storeLive.indexOf('Controller::store — onComplete expects a function') > -1);
        assert.strictEqual(storeLive.indexOf('Controller::query — onComplete'), -1, 'store() does not carry query()\'s message');
    });

    it('the strip is load-bearing: the raw source names #B485 in a comment and the stripped copy does not', function () {
        assert.ok(countOf(src, '#B485') >= 1);
        assert.strictEqual(countOf(live, '#B485'), 0);
    });
});

describe('02 - #B485 behaviour on a real instance (the #B479 refusal as a synchronous settle)', function () {
    var SuperController;
    before(function () {
        process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
        require('module').Module._initPaths();
        require(path.join(FW, 'helpers'));
        require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));
        process.gina = process.gina || {};
        setPath('gina', { core: path.join(FW, 'core') });
        SuperController = require(SOURCE);
    });

    /** A nested-render instance: renderingStack depth 2 makes query() refuse synchronously (#B479). */
    function mk(rule) {
        var inst = SuperController.createTestInstance({
            req  : { method: 'GET', url: '/q', headers: {}, routing: { param: {} } },
            res  : { statusCode: 200, headersSent: false, getHeaders: function () { return {}; },
                     getHeader: function () {}, setHeader: function () {}, writeHead: function () {}, end: function () {} },
            next : function () {},
            options: { rule: rule, controller: '/app/controllers/index.js', control: 'act', bundle: 'test',
                       renderingStack: ['outer', 'inner'],
                       conf: { bundle: 'test', server: { protocol: 'http/1.1', coreConfiguration: { mime: {}, statusCodes: {} } },
                               encoding: 'utf-8', content: { routing: {}, settings: {} } } }
        });
        inst._thrown = [];
        inst.throwError = function (e) { inst._thrown.push(e); };
        return inst;
    }
    function tick() { return new Promise(function (r) { setTimeout(r, 20); }); }

    it('.onComplete(non-function) throws a TypeError at registration naming Controller::query and the type', function () {
        var handle = mk('_b485_str').query({ id: 'x' }, {});
        assert.throws(function () { handle.onComplete('oops'); }, function (e) {
            return e instanceof TypeError && /Controller::query — onComplete expects a function, got string/.test(e.message);
        });
    });

    it('.onComplete(null) throws the same way, naming null', function () {
        var handle = mk('_b485_null').query({ id: 'y' }, {});
        assert.throws(function () { handle.onComplete(null); }, function (e) {
            return e instanceof TypeError && /got null$/.test(e.message);
        });
    });

    it('a rejected registration no longer reaches settle as a misattributed 500 — throwError stays silent', async function () {
        var inst = mk('_b485_no500');
        var handle = inst.query({ id: 'z' }, {});
        try { handle.onComplete('oops'); } catch (e) { /* the registration-site TypeError */ }
        await tick();
        assert.strictEqual(inst._thrown.length, 0, 'no "Query Exception while catching back" reached throwError');
    });

    it('control — a function registers, chains, and is delivered the refusal', async function () {
        var inst = mk('_b485_fn'); var got = [];
        var handle = inst.query({ id: 'w' }, {});
        var ret = handle.onComplete(function (err) { got.push(err); });
        assert.strictEqual(ret, handle, 'onComplete returns the handle');
        await tick();
        assert.strictEqual(got.length, 1);
        assert.strictEqual(got[0].error && got[0].error.code, 'NESTED_RENDER');
        assert.strictEqual(inst._thrown.length, 0);
    });

    it('control — a valid registration after a rejected one still delivers (the handle survives the throw)', async function () {
        var inst = mk('_b485_after'); var got = [];
        var handle = inst.query({ id: 'v' }, {});
        try { handle.onComplete(42); } catch (e) { /* rejected */ }
        handle.onComplete(function (err) { got.push(err); });
        await tick();
        assert.strictEqual(got.length, 1, 'the valid callback was delivered');
    });

    it('control — store().onComplete(non-function) still throws at registration (#B480, shipped)', function () {
        var h = mk('_b485_store').store('/tmp/nowhere');
        assert.throws(function () { h.onComplete('oops'); }, /Controller::store — onComplete expects a function/);
    });
});
