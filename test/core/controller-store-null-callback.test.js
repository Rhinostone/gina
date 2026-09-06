'use strict';
/**
 * #B480 — `self.store()`'s null / non-function callback asymmetry.
 *
 * The fluent guard read `typeof(cb) == 'undefined'`, so `store(target, files, null)`
 * — or any non-function — took the callback branch of the inner `start()`, whose
 * seven `if (cb) { cb(…) } else { self.emit('uploaded', …) }` arms then emitted to
 * an event with zero in-tree listeners: the upload ran and its outcome was silently
 * dropped, and a truthy non-function (`.onComplete('oops')`) threw `TypeError` from
 * INSIDE an fs callback — an uncaughtException on every path but the synchronous
 * empty-upload one. Driven pre-fix on a real createTestInstance: null returned
 * `undefined` with 0 listeners, a spy attached first HEARD the dropped outcome, and
 * `.onComplete('oops')` threw `cb is not a function`.
 *
 * Fix mirrors `query()`'s minting guard (`typeof(callback) != 'function'`, cdda2ea3d):
 * any non-function cb gets the fluent handle; `onComplete()` rejects a non-function
 * synchronously at the caller's line; `start()` is therefore only ever entered with a
 * function, so the seven emitter arms are unreachable and go, mirroring 96ec291bb.
 *
 * House style: source pins censused on a comment-stripped copy, each with a raw-text
 * control proving the strip is load-bearing; behavioural arms on the real instance.
 * Every discriminating pin was run RED against the pre-change source first.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');

function stripComments(src) {
    return src.split('\n').filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
}
function countOf(hay, needle) { return hay.split(needle).length - 1; }

describe('01 - #B480 source pins: the guard, the registration check, and the retired arms', function () {
    var src, live, storeLive;
    before(function () {
        src  = fs.readFileSync(SOURCE, 'utf8');
        live = stripComments(src);
        var from = live.indexOf('this.store = function');
        var to   = live.indexOf('this.query = function(options, data, callback)');
        assert.ok(from > -1 && to > from, 'structural anchors: store() precedes query()');
        storeLive = live.slice(from, to);
    });

    it('the fluent guard mints the handle for ANY non-function cb — null included', function () {
        assert.ok(storeLive.indexOf("if ( typeof(cb) != 'function' ) {") > -1, 'the minting guard is the function-type check');
        assert.equal(storeLive.indexOf("typeof(cb) == 'undefined'"), -1, 'the undefined-only guard must be gone from store()');
    });

    it('onComplete() rejects a non-function synchronously, at registration', function () {
        assert.ok(storeLive.indexOf('onComplete expects a function') > -1, 'the registration-site TypeError message is present');
    });

    it("zero live emit('uploaded') arms remain in store() — the strip is load-bearing", function () {
        var EMIT = "self.emit('uploaded'";
        assert.equal(countOf(storeLive, EMIT), 0, 'the seven emitter arms are gone');
        assert.ok(countOf(src, EMIT) >= 1, 'control: the raw source still names the retired arm in a comment, so the strip did real work');
    });

    it('no callback-presence guard is left inside start() — the minting guard is the only callback type check', function () {
        var s = storeLive.indexOf('var start = function(target, files, cb)');
        assert.ok(s > -1, 'inner start() located');
        var startLive = storeLive.slice(s);
        assert.equal(countOf(startLive, 'if (cb)'), 0, "no `if (cb)` guard survives in start()");
        assert.ok(startLive.indexOf('cb(false, uploadedFiles)') > -1, 'control: the success delivery survives');
    });
});

describe('02 - #B480 behavioural: null and non-function callbacks on a real instance', function () {
    var SuperController = null;
    var T = '/tmp/gina-b480-never-written';

    before(function () {
        process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
        require('module').Module._initPaths();
        require(path.join(FW, 'helpers'));
        require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));
        process.gina = process.gina || {};
        setPath('gina', { core: path.join(FW, 'core') });
        SuperController = require(SOURCE);
    });

    function mk(rule) {
        return SuperController.createTestInstance({
            req  : { method: 'POST', url: '/upload', headers: {}, routing: { param: {} } },
            res  : { statusCode: 200, headersSent: false, getHeaders: function () { return {}; },
                     getHeader: function () {}, setHeader: function () {}, writeHead: function () {}, end: function () {} },
            next : function () {},
            options: { rule: rule, conf: {
                bundle: 'test', server: { protocol: 'http/1.1', coreConfiguration: { mime: {} } }, encoding: 'utf-8',
                content: { routing: {}, settings: { upload: { groups: {} } } } } }
        });
    }

    it('store(target, files, null) returns the fluent handle, like an omitted cb', function () {
        var ret = mk('_b480_null').store(T, [], null);
        assert.ok(ret !== null && typeof ret === 'object', 'a handle must come back for null');
        assert.equal(typeof ret.onComplete, 'function');
    });

    it('the null-cb handle delivers the empty-upload error through .onComplete, and nothing is emitted', function () {
        var inst = mk('_b480_null_deliver'); var got = []; var heard = [];
        inst.on('uploaded', function (e) { heard.push(e); });
        inst.store(T, [], null).onComplete(function (err) { got.push(err); });
        assert.equal(got.length, 1, 'the registered callback was invoked');
        assert.match(got[0].message, /No file to upload/);
        assert.equal(heard.length, 0, 'the outcome no longer leaks to the instance emitter');
    });

    it('.onComplete(non-function) throws a TypeError at registration naming onComplete', function () {
        var handle = mk('_b480_nonfn').store(T);
        assert.throws(function () { handle.onComplete('oops'); }, function (e) {
            return e instanceof TypeError && /onComplete expects a function/.test(e.message);
        }, 'must fail fast at the caller, not inside an fs callback');
    });

    it('control — store(target) with cb omitted still returns the handle', function () {
        var ret = mk('_b480_omitted').store(T);
        assert.equal(typeof (ret && ret.onComplete), 'function');
    });

    it('control — the 3-arg function form still delivers the documented way', function () {
        var got = [];
        mk('_b480_fn').store(T, [], function (err) { got.push(err); });
        assert.equal(got.length, 1);
        assert.match(got[0].message, /No file to upload/);
    });
});
