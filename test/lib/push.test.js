'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW       = require('../fw');
var PUSH_SRC = path.join(FW, 'lib/push/src/main.js');
var LIB_INDEX = path.join(FW, 'lib/index.js');
var GNA_SRC   = path.join(FW, 'core/gna.js');
var push      = require(path.join(FW, 'lib/push/src/main'));

// ─────────────────────────────────────────────────────────────────────────
// #B366 — lib/push: out-of-request push primitive
// ─────────────────────────────────────────────────────────────────────────
//
// `SuperController.push()` needs a live request (#B38 released-request
// guard), so out-of-request code had no route to the socket set. This module
// is that route, and the security-relevant half of its contract is what it
// REFUSES to do: the recipient is required, and no broadcast is reachable
// from this API at all. #B364 shipped because a missing recipient was read as
// "everyone" — the tests below pin that an absent/empty one now sends NOTHING.
//
// The fake instance is the same shape push() reads: `instance.eio.clients`, a
// dict of objects whose constructor name must be 'Socket'. Constructing them
// through a real `function Socket()` keeps constructor.name honest rather
// than stubbing the property the guard reads.

function Socket(sessionId) {
    this.sessionId = sessionId;
    this.sent      = [];
}
Socket.prototype.sendPacket = function (type, data, option) {
    this.sent.push({ type: type, data: data, option: option });
};

function NotASocket(sessionId) {
    this.sessionId = sessionId;
    this.sent      = [];
}
NotASocket.prototype.sendPacket = function (type, data, option) {
    this.sent.push({ type: type, data: data, option: option });
};

function makeInstance(clients) {
    return { eio: { clients: clients } };
}

describe('01 - lib/push source structure', function () {
    var src = fs.readFileSync(PUSH_SRC, 'utf8');

    it('exports toSession', function () {
        assert.equal(typeof push.toSession, 'function');
    });

    it('never reads a recipient from a request object', function () {
        // The whole point of #B364: no request-sourced recipient anywhere.
        assert.equal(/req\[method\]/.test(src), false);
        assert.equal(/\breq\./.test(src), false);
    });

    it('has no broadcast branch at all', function () {
        // Not "broadcast is guarded" — absent. The word may appear in prose
        // explaining where broadcast DOES live, so assert on the code shape.
        assert.equal(/option\s*\.\s*broadcast/.test(src), false);
        assert.equal(/\bbroadcast\s*(&&|\|\||\?)/.test(src), false);
    });

    it('is registered on the lib registry with a plain require', function () {
        var idx = fs.readFileSync(LIB_INDEX, 'utf8');
        assert.match(idx, /push\s*:\s*require\('\.\/push'\)/);
    });

    it('is exposed as the gna.pushToSession global', function () {
        var gna = fs.readFileSync(GNA_SRC, 'utf8');
        assert.match(gna, /gna\.pushToSession\s*=\s*function/);
        assert.match(gna, /lib\.push\.toSession/);
    });
});

describe('02 - recipient is required and never means everyone', function () {

    it('an ABSENT recipient sends nothing and reports PUSH_INVALID_RECIPIENT', function (t, done) {
        var a = new Socket('SESSION-A');
        var b = new Socket('SESSION-B');
        push.toSession(makeInstance({ a: a, b: b }), undefined, { x: 1 }, null, function (err, res) {
            assert.ok(err instanceof Error);
            assert.equal(err.code, 'PUSH_INVALID_RECIPIENT');
            assert.equal(res, undefined);
            // The #B364 invariant: nothing went anywhere.
            assert.equal(a.sent.length, 0);
            assert.equal(b.sent.length, 0);
            done();
        });
    });

    it('an EMPTY-STRING recipient sends nothing', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), '', { x: 1 }, null, function (err) {
            assert.equal(err.code, 'PUSH_INVALID_RECIPIENT');
            assert.equal(a.sent.length, 0);
            done();
        });
    });

    it('a NON-STRING recipient sends nothing', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), { sessionID: 'SESSION-A' }, { x: 1 }, null, function (err) {
            assert.equal(err.code, 'PUSH_INVALID_RECIPIENT');
            assert.equal(a.sent.length, 0);
            done();
        });
    });

    it('POSITIVE CONTROL — a valid recipient DOES deliver, so the zeros above are real', function (t, done) {
        var a = new Socket('SESSION-A');
        var b = new Socket('SESSION-B');
        push.toSession(makeInstance({ a: a, b: b }), 'SESSION-A', { x: 1 }, null, function (err, res) {
            assert.equal(err, null);
            assert.equal(res.delivered, 1);
            assert.equal(a.sent.length, 1);
            assert.equal(b.sent.length, 0);
            done();
        });
    });
});

describe('03 - targeted delivery', function () {

    it('delivers to EVERY socket bound to the session, and only those', function (t, done) {
        var a1 = new Socket('SESSION-A');
        var a2 = new Socket('SESSION-A');   // same user, second tab
        var b  = new Socket('SESSION-B');
        push.toSession(makeInstance({ a1: a1, a2: a2, b: b }), 'SESSION-A', { x: 1 }, null, function (err, res) {
            assert.equal(err, null);
            assert.equal(res.delivered, 2);
            assert.equal(a1.sent.length, 1);
            assert.equal(a2.sent.length, 1);
            assert.equal(b.sent.length, 0);
            done();
        });
    });

    it('reports delivered: 0 without an error when nobody is listening', function (t, done) {
        var b = new Socket('SESSION-B');
        push.toSession(makeInstance({ b: b }), 'SESSION-GONE', { x: 1 }, null, function (err, res) {
            assert.equal(err, null);
            assert.equal(res.delivered, 0);
            done();
        });
    });

    it('skips entries whose constructor is not Socket', function (t, done) {
        // #B364's inert guard (`!clients[s].constructor.name == 'Socket'`) never
        // skipped anything. This pins the corrected `!==` form.
        var real = new Socket('SESSION-A');
        var fake = new NotASocket('SESSION-A');
        push.toSession(makeInstance({ real: real, fake: fake }), 'SESSION-A', { x: 1 }, null, function (err, res) {
            assert.equal(err, null);
            assert.equal(res.delivered, 1);
            assert.equal(fake.sent.length, 0);
            done();
        });
    });

    it('calls back exactly ONCE even when several sockets match', function (t, done) {
        var calls = 0;
        var a1 = new Socket('SESSION-A');
        var a2 = new Socket('SESSION-A');
        push.toSession(makeInstance({ a1: a1, a2: a2 }), 'SESSION-A', { x: 1 }, null, function () {
            ++calls;
            assert.equal(calls, 1);
            setImmediate(function () { assert.equal(calls, 1); done(); });
        });
    });
});

describe('04 - payload handling', function () {

    it('stringifies an object payload', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), 'SESSION-A', { event: 'ready' }, null, function () {
            assert.equal(a.sent[0].data, JSON.stringify({ event: 'ready' }));
            assert.equal(a.sent[0].type, 'message');
            done();
        });
    });

    it('passes a string payload through verbatim', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), 'SESSION-A', '{"pre":"serialized"}', null, function () {
            assert.equal(a.sent[0].data, '{"pre":"serialized"}');
            done();
        });
    });

    it('stamps option.section onto an object payload lacking one', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), 'SESSION-A', { event: 'ready' }, { section: 'exports' }, function () {
            assert.equal(JSON.parse(a.sent[0].data).section, 'exports');
            done();
        });
    });

    it('does not overwrite a section the payload already carries', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), 'SESSION-A', { section: 'mine' }, { section: 'theirs' }, function () {
            assert.equal(JSON.parse(a.sent[0].data).section, 'mine');
            done();
        });
    });

    it('rejects a missing payload — there is no request to fall back to', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), 'SESSION-A', null, null, function (err) {
            assert.equal(err.code, 'PUSH_INVALID_PAYLOAD');
            assert.equal(a.sent.length, 0);
            done();
        });
    });

    it('reports a circular payload as PUSH_PAYLOAD_SERIALIZE_FAILED rather than throwing', function (t, done) {
        var a = new Socket('SESSION-A');
        var circular = { self: null };
        circular.self = circular;
        push.toSession(makeInstance({ a: a }), 'SESSION-A', circular, null, function (err) {
            assert.equal(err.code, 'PUSH_PAYLOAD_SERIALIZE_FAILED');
            assert.equal(a.sent.length, 0);
            done();
        });
    });
});

describe('05 - channel availability', function () {

    it('reports PUSH_CHANNEL_NOT_CONFIGURED when the instance has no eio (the express engine)', function (t, done) {
        push.toSession({}, 'SESSION-A', { x: 1 }, null, function (err) {
            assert.equal(err.code, 'PUSH_CHANNEL_NOT_CONFIGURED');
            done();
        });
    });

    it('reports PUSH_CHANNEL_NOT_CONFIGURED on a null instance', function (t, done) {
        push.toSession(null, 'SESSION-A', { x: 1 }, null, function (err) {
            assert.equal(err.code, 'PUSH_CHANNEL_NOT_CONFIGURED');
            done();
        });
    });

    it('surfaces a transport throw through the callback instead of escaping', function (t, done) {
        var boom = new Socket('SESSION-A');
        boom.sendPacket = function () { throw new Error('transport gone'); };
        push.toSession(makeInstance({ boom: boom }), 'SESSION-A', { x: 1 }, null, function (err) {
            assert.ok(err instanceof Error);
            assert.match(err.message, /transport gone/);
            done();
        });
    });
});

describe('06 - callback arity', function () {

    it('accepts the callback in the option position', function (t, done) {
        var a = new Socket('SESSION-A');
        push.toSession(makeInstance({ a: a }), 'SESSION-A', { x: 1 }, function (err, res) {
            assert.equal(err, null);
            assert.equal(res.delivered, 1);
            done();
        });
    });

    it('does not throw when no callback is supplied', function () {
        var a = new Socket('SESSION-A');
        assert.doesNotThrow(function () {
            push.toSession(makeInstance({ a: a }), 'SESSION-A', { x: 1 });
        });
        assert.equal(a.sent.length, 1);
    });
});
