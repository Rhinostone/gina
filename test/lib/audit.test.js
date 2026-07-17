'use strict';
/**
 * lib/audit — the #COMPLY2 audit-trail primitive (core + the default file
 * JSONL backend), driven BEHAVIORALLY against the real module and a real
 * temp-dir file — no replicas: the correctness here is runtime VALUES
 * (record fields, on-disk lines, counters), which a source pin cannot see.
 *
 * §01 record schema v1 — every field derived from a realistic request; the
 *     actor snapshot (key + a COPY of roles, never the whole user); overrides.
 * §02 the file backend — valid JSONL, emit-order == disk-order under a burst
 *     (the serialized-queue property the slice-3 hash chain will rely on),
 *     append across a restart, recursive dir creation, a poisoned record
 *     drops without poisoning its successors.
 * §03 disabled — a write before start() is a benign no-op (`cb(null)`).
 * §04 emitAuthzDenied — the framework auto-event: outcome in meta, the
 *     events.authz opt-out, and CONTAINMENT (it can never throw into the gate).
 * §05 adopt-once — a second start() is refused loudly, the first store stays.
 * §06 a bad `action` — dropped + counted + cb(err), never thrown.
 */
var { describe, it, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW    = require('../fw');
var audit = require(path.join(FW, 'lib/audit/src/main'));

/** Fresh temp dir per test run. */
function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'gina-audit-'));
}

/** Promise wrapper over the callback form. */
function writeP(action, fields) {
    return new Promise(function (resolve) {
        audit.write(action, fields, function (err) { resolve(err || null); });
    });
}

/** Read every JSONL record back. */
function readRecords(file) {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

/** A request shaped like the one the controller/gate hands over. */
function fakeReq(over) {
    return Object.assign({
        method     : 'POST',
        _ginaReqId : 'req-abc-123',
        routing    : { rule: 'invoice-edit' },
        socket     : { remoteAddress: '::ffff:10.0.0.9' },
        session    : { user: { id: 'u1', email: 'a@b.c', roles: ['admin', 'ops'] } }
    }, over || {});
}

describe('lib/audit §01 — record schema v1', function () {
    var dir, file;
    beforeEach(function () {
        dir  = tmpDir();
        file = path.join(dir, 'audit-b-test.jsonl');
        audit.start({ bundle: 'b', env: 'test', file: file });
    });
    afterEach(function () { audit._resetForTest(); });

    it('01. derives every field from the request + the boot config', async function () {
        var err = await writeP('invoice.delete', { req: fakeReq(), resource: 'inv-42', meta: { why: 'gdpr' } });
        assert.equal(err, null);
        var rec = readRecords(file)[0];

        assert.match(rec.id, /^[0-9a-f-]{36}$/, 'a UUID id');
        assert.ok(Math.abs(Date.now() - rec.ts) < 5000, 'ts is epoch ms, now-ish');
        assert.equal(rec.requestId, 'req-abc-123');
        assert.deepEqual(rec.actor, { key: 'u1', roles: ['admin', 'ops'] });
        assert.equal(rec.action, 'invoice.delete');
        assert.equal(rec.resource, 'inv-42');
        assert.deepEqual(rec.meta, { why: 'gdpr' });
        assert.equal(rec.ip, '10.0.0.9', '::ffff:-normalized (the #OBS1 rule)');
        assert.equal(rec.rule, 'invoice-edit');
        assert.equal(rec.method, 'POST');
        assert.equal(rec.bundle, 'b');
        assert.equal(rec.env, 'test');
    });

    it('02. the actor snapshot carries ONLY key + roles — never the whole user (PII)', async function () {
        await writeP('a.b', { req: fakeReq() });
        var rec = readRecords(file)[0];
        assert.deepEqual(Object.keys(rec.actor).sort(), ['key', 'roles'], 'email etc. must never leak into the trail');
    });

    it('03. roles is a COPY — mutating the session array after emit cannot rewrite the record', async function () {
        var req = fakeReq();
        await writeP('a.b', { req: req });
        req.session.user.roles.push('root');
        var rec = readRecords(file)[0];
        assert.deepEqual(rec.actor.roles, ['admin', 'ops']);
    });

    it('04. actorKey is configurable; a missing key snapshots null', async function () {
        audit._resetForTest();
        audit.start({ bundle: 'b', env: 'test', file: file, actorKey: 'email' });
        await writeP('a.b', { req: fakeReq() });
        var req2 = fakeReq(); delete req2.session.user.email;
        await writeP('c.d', { req: req2 });
        var recs = readRecords(file);
        assert.equal(recs[0].actor.key, 'a@b.c');
        assert.equal(recs[1].actor.key, null);
    });

    it('05. data.actor overrides the session-derived snapshot per call', async function () {
        await writeP('a.b', { req: fakeReq(), actor: { key: 'svc-batch', roles: [] } });
        assert.deepEqual(readRecords(file)[0].actor, { key: 'svc-batch', roles: [] });
    });

    it('06. resource/meta are ABSENT (not null) when the caller passed none', async function () {
        await writeP('a.b', { req: fakeReq() });
        var rec = readRecords(file)[0];
        assert.equal('resource' in rec, false);
        assert.equal('meta' in rec, false);
    });

    it('07. a released/absent request degrades — null request fields, empty actor — instead of dropping', async function () {
        var err = await writeP('late.audit', { req: null });
        assert.equal(err, null, 'the write still lands');
        var rec = readRecords(file)[0];
        assert.equal(rec.requestId, null);
        assert.equal(rec.ip, null);
        assert.equal(rec.rule, null);
        assert.equal(rec.method, null);
        assert.deepEqual(rec.actor, { key: null, roles: [] });
        assert.equal(rec.action, 'late.audit');
    });

    it('08. an unauthenticated request (no session.user) yields the empty actor', async function () {
        await writeP('a.b', { req: fakeReq({ session: {} }) });
        assert.deepEqual(readRecords(file)[0].actor, { key: null, roles: [] });
    });

    it('09. a bare IPv4 remoteAddress passes through unmodified; connection is the fallback read', async function () {
        await writeP('a.b', { req: fakeReq({ socket: { remoteAddress: '192.168.1.5' } }) });
        await writeP('c.d', { req: fakeReq({ socket: null, connection: { remoteAddress: '::ffff:172.16.0.2' } }) });
        var recs = readRecords(file);
        assert.equal(recs[0].ip, '192.168.1.5');
        assert.equal(recs[1].ip, '172.16.0.2');
    });
});

describe('lib/audit §02 — the file JSONL backend', function () {
    var dir, file;
    beforeEach(function () {
        dir  = tmpDir();
        file = path.join(dir, 'audit.jsonl');
    });
    afterEach(function () { audit._resetForTest(); });

    it('01. one valid JSON line per record', async function () {
        audit.start({ bundle: 'b', env: 'test', file: file });
        await writeP('a.one', {});
        await writeP('a.two', {});
        var lines = fs.readFileSync(file, 'utf8').split('\n');
        assert.equal(lines[lines.length - 1], '', 'trailing newline');
        assert.equal(lines.filter(Boolean).length, 2);
        lines.filter(Boolean).forEach(function (l) { assert.doesNotThrow(function () { JSON.parse(l); }); });
    });

    it('02. emit order == disk order under a fire-and-forget burst (the serialized queue)', async function () {
        audit.start({ bundle: 'b', env: 'test', file: file });
        for (var i = 0; i < 25; i++) {
            audit.write('burst.' + i, { meta: { i: i } }); // NO await — fire-and-forget
        }
        await writeP('burst.marker', {}); // the queue is FIFO: the marker lands last
        var recs = readRecords(file);
        assert.equal(recs.length, 26);
        for (var j = 0; j < 25; j++) {
            assert.equal(recs[j].meta.i, j, 'record ' + j + ' is in emit order');
        }
        assert.equal(recs[25].action, 'burst.marker');
    });

    it('03. append-only across a restart — a re-start on the same path keeps the earlier records', async function () {
        audit.start({ bundle: 'b', env: 'test', file: file });
        await writeP('boot.one', {});
        audit._resetForTest();
        audit.start({ bundle: 'b', env: 'test', file: file });
        await writeP('boot.two', {});
        var recs = readRecords(file);
        assert.equal(recs.length, 2);
        assert.equal(recs[0].action, 'boot.one');
        assert.equal(recs[1].action, 'boot.two');
    });

    it('04. the parent dir is created recursively at start()', async function () {
        var nested = path.join(dir, 'a/b/c/audit.jsonl');
        audit.start({ bundle: 'b', env: 'test', file: nested });
        await writeP('x.y', {});
        assert.equal(readRecords(nested).length, 1);
    });

    it('05. an unwritable destination THROWS at start() — the boot-refusal contract, never a silent drop', function () {
        var blocked = path.join(dir, 'blocked');
        fs.writeFileSync(blocked, ''); // a FILE where a directory is needed
        assert.throws(function () {
            audit.start({ bundle: 'b', env: 'test', file: path.join(blocked, 'audit.jsonl') });
        });
        assert.equal(audit.isEnabled(), false, 'a failed start adopts nothing');
    });

    it('06. a record whose meta cannot be serialized drops (cb(err) + counter) without poisoning its successors', async function () {
        audit.start({ bundle: 'b', env: 'test', file: file });
        var circular = {}; circular.self = circular;
        var err = await writeP('bad.meta', { meta: circular });
        assert.ok(err instanceof Error, 'the caller that asked gets the error');
        var err2 = await writeP('good.after', {});
        assert.equal(err2, null);
        var recs = readRecords(file);
        assert.equal(recs.length, 1, 'only the good record landed');
        assert.equal(recs[0].action, 'good.after');
        var s = audit.stats();
        assert.equal(s.dropped, 1);
        assert.equal(s.written, 1);
        assert.equal(s.path, file);
    });
});

describe('lib/audit §03 — disabled is a benign no-op', function () {
    afterEach(function () { audit._resetForTest(); });

    it('01. write() before start(): cb(null), nothing thrown, stats stay zero/disabled', async function () {
        var err = await writeP('any.thing', { req: fakeReq() });
        assert.equal(err, null, 'application code never branches on deployment config');
        var s = audit.stats();
        assert.equal(s.enabled, false);
        assert.equal(s.written, 0);
        assert.equal(s.dropped, 0);
        assert.equal(s.path, null);
    });
});

describe('lib/audit §04 — emitAuthzDenied (the framework auto-event)', function () {
    var dir, file;
    beforeEach(function () {
        dir  = tmpDir();
        file = path.join(dir, 'audit.jsonl');
    });
    afterEach(function () { audit._resetForTest(); });

    it('01. writes an authz.denied record with the outcome riding meta (schema stays v1)', async function () {
        audit.start({ bundle: 'b', env: 'test', file: file });
        audit.emitAuthzDenied(fakeReq({ session: {} }), '401');
        await writeP('flush.marker', {}); // FIFO barrier
        var recs = readRecords(file);
        assert.equal(recs[0].action, 'authz.denied');
        assert.deepEqual(recs[0].meta, { outcome: '401' });
        assert.deepEqual(recs[0].actor, { key: null, roles: [] }, 'a 401 has no authenticated actor');
        assert.equal(recs[0].rule, 'invoice-edit');
    });

    it('02. an authenticated 403 carries the denied user as the actor', async function () {
        audit.start({ bundle: 'b', env: 'test', file: file });
        audit.emitAuthzDenied(fakeReq(), '403-roles');
        await writeP('flush.marker', {});
        var rec = readRecords(file)[0];
        assert.deepEqual(rec.meta, { outcome: '403-roles' });
        assert.deepEqual(rec.actor, { key: 'u1', roles: ['admin', 'ops'] });
    });

    it('03. events.authz: false opts the auto-events out — self.audit-style writes still work', async function () {
        audit.start({ bundle: 'b', env: 'test', file: file, eventsAuthz: false });
        audit.emitAuthzDenied(fakeReq(), '401');
        var err = await writeP('app.event', {});
        assert.equal(err, null);
        var recs = readRecords(file);
        assert.equal(recs.length, 1, 'only the app event landed');
        assert.equal(recs[0].action, 'app.event');
    });

    it('04. disabled: a no-op that never throws', function () {
        assert.doesNotThrow(function () { audit.emitAuthzDenied(fakeReq(), '401'); });
    });

    it('05. CONTAINMENT — a poisoned request (throwing session getter) cannot throw into the gate', function () {
        audit.start({ bundle: 'b', env: 'test', file: file });
        var poisoned = { method: 'GET' };
        Object.defineProperty(poisoned, 'session', { get: function () { throw new Error('boom'); } });
        assert.doesNotThrow(function () { audit.emitAuthzDenied(poisoned, '401'); },
            'an audit failure must NEVER change an authorization outcome');
    });
});

describe('lib/audit §05 — adopt-once', function () {
    afterEach(function () { audit._resetForTest(); });

    it('01. a second start() is refused; the first store keeps receiving the writes', async function () {
        var dir   = tmpDir();
        var file1 = path.join(dir, 'one.jsonl');
        var file2 = path.join(dir, 'two.jsonl');
        assert.equal(audit.start({ bundle: 'b', env: 'test', file: file1 }), true);
        assert.equal(audit.start({ bundle: 'b', env: 'test', file: file2 }), false);
        await writeP('a.b', {});
        assert.equal(readRecords(file1).length, 1);
        assert.equal(fs.existsSync(file2), false, 'the ignored options built no second store');
        assert.equal(audit.stats().path, file1);
    });

    it('02. start() without file or store throws (the registrar always provides one)', function () {
        assert.throws(function () { audit.start({ bundle: 'b', env: 'test' }); }, /store.*or.*file|file.*or.*store/i);
    });
});

describe('lib/audit §06 — a bad action drops, is counted, and never throws', function () {
    afterEach(function () { audit._resetForTest(); });

    it('01. non-string / empty action -> cb(err) + dropped++ + no line', async function () {
        var dir  = tmpDir();
        var file = path.join(dir, 'audit.jsonl');
        audit.start({ bundle: 'b', env: 'test', file: file });
        var e1 = await writeP(123, {});
        var e2 = await writeP('', {});
        assert.ok(e1 instanceof Error);
        assert.ok(e2 instanceof Error);
        assert.equal(audit.stats().dropped, 2);
        assert.equal(fs.readFileSync(file, 'utf8'), '', 'nothing landed');
    });
});
