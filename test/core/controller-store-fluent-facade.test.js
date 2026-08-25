/**
 * #B420 — the fluent upload-persistence form `self.store(target).onComplete(cb)`
 * is the public guide's first worked example, and it threw
 * `TypeError: self.store(...).onComplete is not a function` on every recent
 * release: the declaration carried an accidental `async` keyword, so the
 * deliberate `{ onComplete }` facade (returned when `cb` is omitted) was
 * handed back wrapped in a Promise the caller never unwraps. The body
 * contains no `await` and nothing anywhere awaits `store()`, so dropping the
 * keyword restores the documented contract with no other behaviour change.
 *
 * §01 pins the declaration shape (comment-stripped, with an anti-vacuity
 * control so a broken strip cannot pass the negative vacuously). §02 is
 * BEHAVIOURAL, per the "a source pin is not a behavioral test" discipline:
 * it drives the REAL SuperController.createTestInstance() and asserts the
 * facade's runtime shape and that the documented chain actually wires
 * (facade → 'uploaded' listener → start() → callback) — the reachability
 * claim controller.test.js §27's source-structure pin cannot certify.
 *
 * Red-validated against the pre-fix tree (all arms fail there: the two §01
 * pins, `onComplete` undefined on the Promise, the chained call's TypeError
 * — the exact consumer symptom — and the cb-form's Promise return).
 */
'use strict';
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW     = require('../fw');
var SOURCE = path.join(FW, 'core/controller/controller.js');

// Strip line/block-style comment LINES so the negative pin cannot trip on
// prose mentions (jsdoc.md discipline).
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// ---------------------------------------------------------------------------
// 01 — declaration-shape pins (comment-stripped)
// ---------------------------------------------------------------------------
describe('01 - #B420 pins: store() is declared synchronous', function () {
    var ACTIVE = null;
    before(function () {
        ACTIVE = stripComments(fs.readFileSync(SOURCE, 'utf8'));
    });

    it('the declaration is the plain-function form', function () {
        assert.ok(ACTIVE.indexOf('this.store = function(target, files, cb)') > -1,
            'store() must be declared as a plain function — the facade must return synchronously');
    });

    it('the async form is gone from active code (with an anti-vacuity control)', function () {
        assert.ok(ACTIVE.indexOf('this.store = async function') < 0,
            'an async declaration wraps the fluent facade in a Promise (#B420)');
        // anti-vacuity control: the stripped view still holds the facade the
        // pin protects — an over-eager strip cannot green the negative by
        // emptying the corpus.
        assert.ok(ACTIVE.indexOf('onComplete : function(cb)') > -1,
            'comment strip must leave the facade in view');
    });
});

// ---------------------------------------------------------------------------
// 02 — behavioural: the facade is returned synchronously and wires end-to-end
// ---------------------------------------------------------------------------
describe('02 - #B420 behavioural: store(target) hands back a live fluent handle', function () {
    var SuperController = null;

    before(function () {
        // §14 framework-globals bootstrap (class.controller.md §10) — a cold
        // require(SOURCE) fails without it.
        process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
        require('module').Module._initPaths();
        require(path.join(FW, 'helpers'));                              // _, setPath, setContext, ...
        require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));   // JSON.clone, Object.count()
        process.gina = process.gina || {};
        setPath('gina', { core: path.join(FW, 'core') });
        SuperController = require(SOURCE);
    });

    function mkInstance() {
        return SuperController.createTestInstance({
            req  : { method: 'POST', url: '/upload', headers: {}, routing: { param: {} } },
            res  : {
                statusCode : 200,
                headersSent: false,
                getHeaders : function () { return {}; },
                getHeader  : function () {},
                setHeader  : function () {},
                writeHead  : function () {},
                end        : function () {}
            },
            next : function () {},
            options: {
                rule: '_storefluent',
                conf: {
                    bundle : 'test',
                    server : { protocol: 'http/1.1', coreConfiguration: { mime: {} } },
                    encoding: 'utf-8',
                    content: {
                        routing : {},
                        settings: { upload: { groups: {} } }
                    }
                }
            }
        });
    }

    it('store(target) with no callback returns the {onComplete} handle, not a Promise', function () {
        var inst = mkInstance();
        var ret = inst.store('/tmp/gina-b420-never-written');   // no files, no cb — facade path
        assert.ok(ret !== null && typeof ret === 'object', 'a handle object must come back');
        assert.equal(typeof ret.onComplete, 'function',
            'the handle must expose a callable onComplete (#B420: undefined on a Promise)');
        assert.equal(typeof ret.then, 'undefined',
            'the handle must not be a thenable — the promise wrapper is the defect');
    });

    it('the documented chain wires end-to-end: onComplete registers, start() answers through it', function () {
        var inst = mkInstance();
        var calls = [];
        // The mock request carries no files, so start() answers through the
        // 'uploaded' channel with the empty-upload error — a same-tick emit,
        // which is exactly the synchronous dispatch the facade promises.
        // This is the reachability §27's structure pin passes regardless of.
        inst.store('/tmp/gina-b420-never-written').onComplete(function (err, files) {
            calls.push({ err: err, files: files });
        });
        assert.equal(calls.length, 1, 'the registered callback must have been invoked');
        assert.ok(calls[0].err instanceof Error, 'the empty-upload signal is an Error');
        assert.match(calls[0].err.message, /No file to upload/);
    });

    it('the callback form is byte-unchanged and returns nothing', function () {
        var inst = mkInstance();
        var calls = [];
        var ret = inst.store('/tmp/gina-b420-never-written', undefined, function (err) {
            calls.push(err);
        });
        assert.equal(calls.length, 1, 'the cb form answers synchronously on the empty-upload path');
        assert.ok(calls[0] instanceof Error, 'same empty-upload Error through the direct channel');
        assert.equal(typeof ret, 'undefined',
            'the cb form returns undefined — pre-fix it returned a Promise nothing consumed');
    });
});
