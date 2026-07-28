'use strict';
/**
 * lib/audit — #COMPLY2 slice 3: the tamper-evidence hash chain, driven
 * BEHAVIORALLY against the real module and real temp-dir files. The
 * correctness here is runtime VALUES (digests, verify verdicts, resume
 * anchors), which a source pin cannot see — every negative below is a
 * KNOWN-NEGATIVE that must FAIL verification, so a green run proves the
 * instrument discriminates rather than merely accepting.
 *
 * §01 canonicalV1 — determinism across insertion orders, nesting, arrays,
 *     JSON-value-space semantics (the projection contract: a live Date must
 *     digest as what the DISK will hold).
 * §02 the chain round-trip + the tamper matrix: untouched PASSES; an edited
 *     field, a deleted middle record, a reordered pair, a head-truncation
 *     and a wrong key each FAIL at the right line. Tail-truncation PASSES —
 *     the documented boundary, pinned honestly rather than papered over.
 * §03 the hashless rules: a pre-chain prefix is legal; a hashless record
 *     after chain start FAILS (else inserting unhashed lines is free
 *     tampering); garbage without an acknowledgment FAILS.
 * §04 torn tail — start() resumes over a partial line, appends a chained
 *     `audit.chain.break` acknowledgment, and verify reports it as a
 *     warning; a SECOND consecutive garbage line FAILS.
 * §05 resume across a restart — the chain continues from the tail anchor.
 * §06 a dropped record never forks the on-disk chain (prevHash advances only
 *     on a successful append), and a throwing consumer callback cannot
 *     stall the queue — driven through _createChainStore with a failable
 *     inner store.
 * §07 empty / missing trails — trivially OK but explicitly distinguishable
 *     (records: 0), and the resume anchor for a missing file is GENESIS.
 * §08 start() contracts — chain+store refused, chain without secret
 *     refused, stats().chain reports the mode.
 */
var { describe, it, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW    = require('../fw');
var audit = require(path.join(FW, 'lib/audit/src/main'));

var SECRET = 'chain-test-secret-0123456789abcdef-0123456789abcdef';
var GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

/** Fresh temp dir per test run. */
function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'gina-audit-chain-'));
}

/** Promise wrapper over the callback form. */
function writeP(action, fields) {
    return new Promise(function (resolve) {
        audit.write(action, fields, function (err) { resolve(err || null); });
    });
}

/** Raw lines (no parse — tamper tests splice bytes). */
function readLines(file) {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

describe('lib/audit chain §01 — canonicalV1', function () {

    it('is deterministic across insertion orders, sorting keys recursively', function () {
        var a = audit.canonicalV1({ b: 1, a: { d: null, c: [2, 1] } });
        var b = audit.canonicalV1({ a: { c: [2, 1], d: null }, b: 1 });
        assert.equal(a, b);
        assert.equal(a, '{"a":{"c":[2,1],"d":null},"b":1}');
    });

    it('preserves ARRAY order — only object keys sort', function () {
        assert.equal(audit.canonicalV1([3, 1, 2]), '[3,1,2]');
        assert.notEqual(audit.canonicalV1([1, 2]), audit.canonicalV1([2, 1]));
    });

    it('follows JSON value-space semantics: undefined members drop, undefined slots become null', function () {
        assert.equal(audit.canonicalV1({ a: undefined, b: 1 }), '{"b":1}');
        assert.equal(audit.canonicalV1([undefined, 1]), '[null,1]');
        assert.equal(audit.canonicalV1(null), 'null');
        assert.equal(audit.canonicalV1('x'), '"x"');
    });

    it('the projection contract: a JSON-round-tripped Date canonicalises as its ISO string — what the disk holds', function () {
        var d = new Date('2026-07-26T12:00:00.000Z');
        var projected = JSON.parse(JSON.stringify({ when: d }));
        assert.equal(audit.canonicalV1(projected), '{"when":"2026-07-26T12:00:00.000Z"}');
        // ...and the UNPROJECTED live Date would NOT (its own keys are empty) —
        // which is exactly why the chain store projects before digesting.
        assert.equal(audit.canonicalV1({ when: d }), '{"when":{}}');
    });
});

describe('lib/audit chain §02 — round-trip + the tamper matrix', function () {
    var dir, file;

    beforeEach(async function () {
        dir  = tmpDir();
        file = path.join(dir, 'trail.jsonl');
        audit._resetForTest();
        audit.start({ bundle: 'w', env: 't', file: file, chain: { secret: SECRET } });
        await writeP('probe.one',   { resource: 'r1', meta: { z: 1, a: 'x' } });
        await writeP('probe.two',   { resource: 'r2' });
        await writeP('probe.three', { meta: { when: new Date() } });
    });
    afterEach(function () {
        audit._resetForTest();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('every record carries a 64-hex hash and the untouched trail verifies intact', function () {
        var lines = readLines(file);
        assert.equal(lines.length, 3);
        lines.forEach(function (l) {
            assert.match(JSON.parse(l).hash, /^[0-9a-f]{64}$/);
        });
        var r = audit.verifyChain(file, SECRET);
        assert.deepEqual(r, { ok: true, records: 3, unchained: 0, breakAt: null, warnings: [] });
    });

    it('KNOWN-NEGATIVE: editing one field breaks the chain at that record', function () {
        var lines = readLines(file);
        var rec = JSON.parse(lines[1]);
        rec.action = 'probe.TAMPERED';
        lines[1] = JSON.stringify(rec);
        fs.writeFileSync(file, lines.join('\n') + '\n');
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, false);
        assert.equal(r.breakAt.line, 2);
        assert.match(r.breakAt.reason, /hash mismatch/);
    });

    it('KNOWN-NEGATIVE: deleting a MIDDLE record breaks the chain where the gap is', function () {
        var lines = readLines(file);
        lines.splice(1, 1);
        fs.writeFileSync(file, lines.join('\n') + '\n');
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, false);
        assert.equal(r.breakAt.line, 2, 'the record after the gap no longer chains');
    });

    it('KNOWN-NEGATIVE: reordering two records breaks the chain', function () {
        var lines = readLines(file);
        var t = lines[1]; lines[1] = lines[2]; lines[2] = t;
        fs.writeFileSync(file, lines.join('\n') + '\n');
        assert.equal(audit.verifyChain(file, SECRET).ok, false);
    });

    it('KNOWN-NEGATIVE: truncating the HEAD breaks the chain — the first survivor no longer anchors at genesis', function () {
        var lines = readLines(file);
        fs.writeFileSync(file, lines.slice(1).join('\n') + '\n');
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, false);
        assert.equal(r.breakAt.line, 1);
    });

    it('KNOWN-NEGATIVE: the wrong key fails at record 1 — verification is key-holder-only', function () {
        var r = audit.verifyChain(file, 'not-the-key');
        assert.equal(r.ok, false);
        assert.equal(r.breakAt.line, 1);
    });

    it('KNOWN-NEGATIVE: a malformed hash field fails with its own reason', function () {
        var lines = readLines(file);
        var rec = JSON.parse(lines[0]);
        rec.hash = 'zz' + rec.hash.slice(2);
        lines[0] = JSON.stringify(rec);
        fs.writeFileSync(file, lines.join('\n') + '\n');
        assert.match(audit.verifyChain(file, SECRET).breakAt.reason, /malformed hash/);
    });

    it('BOUNDARY (pinned honestly): truncating the TAIL verifies clean — nothing after it commits to it', function () {
        var lines = readLines(file);
        fs.writeFileSync(file, lines.slice(0, 2).join('\n') + '\n');
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, true, 'this is the documented limit of a hash chain, not a defect — the WORM isolation control covers it');
        assert.equal(r.records, 2, 'the count is how an operator notices — read it');
    });
});

describe('lib/audit chain §03 — the hashless rules', function () {
    var dir, file;

    beforeEach(async function () {
        dir  = tmpDir();
        file = path.join(dir, 'trail.jsonl');
        audit._resetForTest();
        // a pre-chain trail: two records with NO chain
        audit.start({ bundle: 'w', env: 't', file: file });
        await writeP('old.one', {});
        await writeP('old.two', {});
        audit._resetForTest();
        // the chain turned on later
        audit.start({ bundle: 'w', env: 't', file: file, chain: { secret: SECRET } });
        await writeP('new.one', {});
    });
    afterEach(function () {
        audit._resetForTest();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('a hashless PREFIX is legal — reported, not failed', function () {
        var r = audit.verifyChain(file, SECRET);
        assert.deepEqual(r, { ok: true, records: 1, unchained: 2, breakAt: null, warnings: [] });
    });

    it('KNOWN-NEGATIVE: a hashless record AFTER chain start fails — inserting unhashed lines must never be free', function () {
        fs.appendFileSync(file, JSON.stringify({ id: 'smuggled', action: 'evil' }) + '\n');
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, false);
        assert.equal(r.breakAt.line, 4);
        assert.match(r.breakAt.reason, /unchained record after chain start/);
    });

    it('KNOWN-NEGATIVE: an unparseable line with no chained acknowledgment fails', function () {
        var lines = readLines(file);
        fs.writeFileSync(file, lines[0] + '\nNOT-JSON-GARBAGE\n' + lines.slice(1).join('\n') + '\n');
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, false);
        assert.equal(r.breakAt.line, 2);
        assert.match(r.breakAt.reason, /not followed by a chained acknowledgment/);
    });

    it('empty lines are skipped — they carry nothing and cannot smuggle content', function () {
        var lines = readLines(file);
        fs.writeFileSync(file, lines[0] + '\n\n\n' + lines.slice(1).join('\n') + '\n');
        assert.equal(audit.verifyChain(file, SECRET).ok, true);
    });
});

describe('lib/audit chain §04 — torn tail: acknowledged break', function () {
    var dir, file;

    beforeEach(async function () {
        dir  = tmpDir();
        file = path.join(dir, 'trail.jsonl');
        audit._resetForTest();
        audit.start({ bundle: 'w', env: 't', file: file, chain: { secret: SECRET } });
        await writeP('t.one', {});
        audit._resetForTest();
        // a crash mid-write: partial line, no trailing newline
        fs.appendFileSync(file, '{"id":"crash-partial","ts":178');
    });
    afterEach(function () {
        audit._resetForTest();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('the next boot resumes over the torn line, acknowledges it, and verify WARNS instead of failing', async function () {
        audit.start({ bundle: 'w', env: 't', file: file, chain: { secret: SECRET } });
        await writeP('t.two', {});
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, true);
        assert.equal(r.records, 3, 't.one + the break acknowledgment + t.two');
        assert.deepEqual(r.warnings, [{ line: 2, type: 'acknowledged-break' }]);
        // the acknowledgment is a REAL chained record naming the damage:
        var recs = readLines(file).map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } });
        var brk = recs.filter(Boolean).filter(function (x) { return x.action === 'audit.chain.break'; })[0];
        assert.ok(brk, 'the audit.chain.break record');
        assert.equal(brk.meta.reason, 'torn-tail');
        assert.ok(brk.meta.damagedBytes > 0);
    });

    it('BEFORE any boot acknowledges it, the torn tail is a warning — the chain is intact up to the last complete record', function () {
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, true);
        assert.equal(r.records, 1);
        assert.deepEqual(r.warnings, [{ line: 2, type: 'torn-tail-unacknowledged' }]);
    });

    it('KNOWN-NEGATIVE: TWO consecutive garbage lines fail — a crash tears at most one', async function () {
        fs.appendFileSync(file, '\nMORE-GARBAGE\n');
        var r = audit.verifyChain(file, SECRET);
        assert.equal(r.ok, false);
        assert.match(r.breakAt.reason, /second consecutive/);
    });

    it('_readChainTail anchors on the last intact hashed record and reports the torn bytes', function () {
        var tail = audit._readChainTail(file);
        assert.match(tail.prevHash, /^[0-9a-f]{64}$/);
        assert.notEqual(tail.prevHash, GENESIS, 'the anchor is t.one\'s hash, not genesis');
        assert.equal(tail.torn.reason, 'torn-tail');
        assert.ok(tail.torn.bytes > 0);
    });
});

describe('lib/audit chain §05 — resume across a restart', function () {
    var dir, file;

    beforeEach(function () {
        dir  = tmpDir();
        file = path.join(dir, 'trail.jsonl');
        audit._resetForTest();
    });
    afterEach(function () {
        audit._resetForTest();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('a clean restart continues the chain from the tail anchor — one unbroken chain across generations', async function () {
        audit.start({ bundle: 'w', env: 't', file: file, chain: { secret: SECRET } });
        await writeP('gen1.a', {});
        await writeP('gen1.b', {});
        audit._resetForTest();
        audit.start({ bundle: 'w', env: 't', file: file, chain: { secret: SECRET } });
        await writeP('gen2.a', {});
        var r = audit.verifyChain(file, SECRET);
        assert.deepEqual(r, { ok: true, records: 3, unchained: 0, breakAt: null, warnings: [] });
    });

    it('a chain enabled over a pre-chain trail anchors at GENESIS and verify reports the prefix', async function () {
        audit.start({ bundle: 'w', env: 't', file: file });
        await writeP('old.one', {});
        audit._resetForTest();
        var tail = audit._readChainTail(file);
        assert.equal(tail.prevHash, GENESIS, 'a parseable hashless tail means the chain starts fresh');
        assert.equal(tail.torn, null);
    });
});

describe('lib/audit chain §06 — a drop never forks the chain; a throwing callback never stalls it', function () {

    /** An inner store that fails exactly the appends whose action is listed. */
    function failingInner(failActions) {
        var appended = [];
        return {
            appended: appended,
            path: '(mock)',
            append: function (record, cb) {
                if (failActions.indexOf(record.action) > -1) {
                    return process.nextTick(function () { cb(new Error('disk full (simulated)')); });
                }
                appended.push(record);
                process.nextTick(function () { cb(null); });
            },
            close: function () {}
        };
    }

    it('prevHash advances ONLY on success: the record after a drop chains from the last record that LANDED', async function () {
        var inner = failingInner(['drop.me']);
        var store = audit._createChainStore(inner, { secret: SECRET, prevHash: GENESIS });
        var append = function (rec) {
            return new Promise(function (resolve) { store.append(rec, function (err) { resolve(err || null); }); });
        };
        assert.equal(await append({ action: 'keep.one' }), null);
        assert.match((await append({ action: 'drop.me' })).message, /disk full/);
        assert.equal(await append({ action: 'keep.two' }), null);

        // Behavioral proof: the two LANDED records form an intact chain.
        var h1 = inner.appended[0].hash;
        var expected = require('crypto').createHmac('sha256', SECRET)
            .update(h1 + ':' + audit.canonicalV1(JSON.parse(JSON.stringify({ action: 'keep.two' }))))
            .digest('hex');
        assert.equal(inner.appended[1].hash, expected,
            'keep.two chains from keep.one — the dropped record left no gap in the on-disk chain');
    });

    it('a throwing consumer callback is contained — the next append still processes', async function () {
        var inner = failingInner([]);
        var store = audit._createChainStore(inner, { secret: SECRET, prevHash: GENESIS });
        store.append({ action: 'boom' }, function () { throw new Error('consumer bug'); });
        var ok = await new Promise(function (resolve) {
            store.append({ action: 'after' }, function (err) { resolve(err === null); });
        });
        assert.equal(ok, true, 'the queue survived the throwing callback');
        assert.equal(inner.appended.length, 2);
    });
});

describe('lib/audit chain §07 — empty and missing trails', function () {
    var dir;
    beforeEach(function () { dir = tmpDir(); });
    afterEach(function () { fs.rmSync(dir, { recursive: true, force: true }); });

    it('an empty trail verifies OK with records: 0 — explicitly distinguishable, never silently green-looking', function () {
        var file = path.join(dir, 'empty.jsonl');
        fs.writeFileSync(file, '');
        assert.deepEqual(audit.verifyChain(file, SECRET), { ok: true, records: 0, unchained: 0, breakAt: null, warnings: [] });
    });

    it('a missing file anchors the resume at GENESIS with no torn marker', function () {
        assert.deepEqual(audit._readChainTail(path.join(dir, 'nope.jsonl')), { prevHash: GENESIS, torn: null });
    });
});

describe('lib/audit chain §08 — start() contracts', function () {
    var dir;
    beforeEach(function () { dir = tmpDir(); audit._resetForTest(); });
    afterEach(function () { audit._resetForTest(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('chain + a pre-built store is refused — the seam carries no ordering obligation', function () {
        assert.throws(function () {
            audit.start({ bundle: 'w', env: 't', store: { append: function () {}, close: function () {} }, chain: { secret: SECRET } });
        }, /requires the file backend/);
    });

    it('chain without a non-empty secret is refused — fail closed, never silently OFF', function () {
        assert.throws(function () {
            audit.start({ bundle: 'w', env: 't', file: path.join(dir, 't.jsonl'), chain: { secret: '' } });
        }, /non-empty `secret`/);
        assert.throws(function () {
            audit.start({ bundle: 'w', env: 't', file: path.join(dir, 't.jsonl'), chain: {} });
        }, /non-empty `secret`/);
    });

    it('stats().chain reports the mode — false for a plain trail, true when chained', async function () {
        audit.start({ bundle: 'w', env: 't', file: path.join(dir, 'plain.jsonl') });
        assert.equal(audit.stats().chain, false);
        audit._resetForTest();
        audit.start({ bundle: 'w', env: 't', file: path.join(dir, 'chained.jsonl'), chain: { secret: SECRET } });
        assert.equal(audit.stats().chain, true);
        await writeP('x', {});
        assert.equal(audit.stats().written, 1);
    });
});
