/**
 * #B43 — atomic `~/.gina` state-file writes (StateStore sidecar + generator legacy).
 *
 * The five `~/.gina` state files (main.json, projects.json, settings.json, …) were
 * written with a truncate-in-place `fs.writeFileSync`, leaving a window in which a
 * concurrent fleet-boot reader observes a partial/empty file. Every state-file read
 * path is FATAL on a parse failure (`requireJSON` -> `process.exit(1)`; plain
 * `require` -> uncaught `SyntaxError`), so the race intermittently crashes booting
 * bundles. The fix writes a same-dir temp then `fs.renameSync` (atomic within a
 * filesystem — a reader sees the complete old file or the complete new one, never a
 * torn one).
 *
 * Both write sites carry the identical temp+rename shape:
 *   - lib/state.js              this.write             (StateStore JSON sidecar)
 *   - lib/generator/index.js    createFileFromDataSync (legacy fallback)
 *
 * Coverage:
 *   §01 source pins on both sites (temp+rename present, the bare truncate-in-place
 *       write gone, unlink-on-failure present);
 *   §02 behavioural fs-spy on the REAL generator legacy path — target reached via
 *       renameSync from a sibling temp, never a direct writeFileSync(target); the
 *       target stays complete throughout the temp write (no torn window); the temp is
 *       unlinked + the error rethrown on a write failure;
 *   §03 the same, behaviourally, on the REAL StateStore sidecar write (a temp
 *       GINA_HOMEDIR so the real ~/.gina is never touched; guarded on node:sqlite);
 *   §04 the deterministic torn-read consequence the atomic write prevents.
 *
 * The real heavily-contended concurrent race is the out-of-band measurement
 * (/tmp/b43-repro/race.js — empty + partial reads -> JSON.parse SyntaxError);
 * the gated suite asserts the atomic mechanism deterministically (no timing flake).
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');

var STATE_SRC = fs.readFileSync(path.join(FW, 'lib/state.js'), 'utf8');
var GEN_SRC   = fs.readFileSync(path.join(FW, 'lib/generator/index.js'), 'utf8');

var Generator  = require(path.join(FW, 'lib/generator'));
var StateStore = require(path.join(FW, 'lib/state'));

// Real (un-spied) fs handles captured once, for setup/teardown + assertions.
var realWriteFileSync = fs.writeFileSync.bind(fs);
var realReadFileSync  = fs.readFileSync.bind(fs);
var realRenameSync    = fs.renameSync.bind(fs);
var realChmodSync     = fs.chmodSync.bind(fs);
var realUnlinkSync    = fs.unlinkSync.bind(fs);

function mkTmpDir(tag) {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'b43-' + tag + '-'));
}

// Install recording spies over the fs methods the write paths use. Each spy records
// its args then delegates to the real impl. opts.onWrite lets a test observe state
// mid-write or force a failure. Returns { calls, restore }.
function installFsSpy(opts) {
    opts = opts || {};
    var calls = { write: [], rename: [], chmod: [], unlink: [] };
    fs.writeFileSync = function (p, d) {
        calls.write.push(p);
        if (opts.onWrite) opts.onWrite(p, d, calls); // mid-write observation / throw
        return realWriteFileSync(p, d);
    };
    fs.renameSync = function (from, to) { calls.rename.push([from, to]); return realRenameSync(from, to); };
    fs.chmodSync  = function (p, m)     { calls.chmod.push([p, m]);     return realChmodSync(p, m); };
    fs.unlinkSync = function (p)        { calls.unlink.push(p);         return realUnlinkSync(p); };
    return {
        calls: calls,
        restore: function () {
            fs.writeFileSync = realWriteFileSync;
            fs.renameSync    = realRenameSync;
            fs.chmodSync     = realChmodSync;
            fs.unlinkSync    = realUnlinkSync;
        }
    };
}

// ---------------------------------------------------------------------------
// 01 — source pins (both write sites)
// ---------------------------------------------------------------------------
// Slice each write site's function body so the negative "old in-place write is gone"
// pins don't trip on a SIBLING method that legitimately keeps that call shape:
// generator.createFileFromTemplateSync writes a template via fs.writeFileSync(target, data)
// — a different operation, deliberately out of #B43 scope.
var STATE_WRITE_BLOCK = (function () {
    var s = STATE_SRC.indexOf('this.write = function');
    var rest = STATE_SRC.slice(s + 10);
    var e = rest.search(/\n    this\.\w+\s*=/); // next public method declaration
    return e >= 0 ? STATE_SRC.slice(s, s + 10 + e) : STATE_SRC.slice(s);
})();
var GEN_DATA_BLOCK = (function () {
    var s = GEN_SRC.indexOf('createFileFromDataSync : function'); // the method, not the top-of-file comment
    var e = GEN_SRC.indexOf('createPathSync', s);                 // next method in the object literal
    return GEN_SRC.slice(s, e > s ? e : s + 2200);
})();

describe('01 - atomic temp+rename source pins', function () {

    it('state.js sidecar: builds a sibling temp, writes it, renames onto the target', function () {
        assert.match(STATE_WRITE_BLOCK, /var _tmp = filePath \+[^\n]*_sidecarWriteSeq\+\+[^\n]*\.tmp/);
        assert.match(STATE_WRITE_BLOCK, /fs\.writeFileSync\(_tmp, value\)/);
        assert.match(STATE_WRITE_BLOCK, /fs\.renameSync\(_tmp, filePath\)/);
        assert.match(STATE_WRITE_BLOCK, /fs\.unlinkSync\(_tmp\)/);
        assert.match(STATE_SRC, /var _sidecarWriteSeq = 0/); // module-level counter (outside the method)
    });

    it('state.js sidecar: the old truncate-in-place write is gone (within this.write)', function () {
        assert.doesNotMatch(STATE_WRITE_BLOCK, /fs\.writeFileSync\(filePath, value\)/);
    });

    it('generator legacy: builds a sibling temp, writes it, renames onto the target', function () {
        assert.match(GEN_DATA_BLOCK, /var _tmp = target \+[^\n]*_atomicWriteSeq\+\+[^\n]*\.tmp/);
        assert.match(GEN_DATA_BLOCK, /fs\.writeFileSync\(_tmp, data\)/);
        assert.match(GEN_DATA_BLOCK, /fs\.renameSync\(_tmp, target\)/);
        assert.match(GEN_DATA_BLOCK, /fs\.unlinkSync\(_tmp\)/);
        assert.match(GEN_SRC, /var _atomicWriteSeq = 0/); // module-level counter (outside the method)
    });

    it('generator legacy: the old truncate-in-place write is gone (within createFileFromDataSync)', function () {
        // createFileFromTemplateSync legitimately keeps fs.writeFileSync(target, data)
        // (template copy, not a state-file write) — hence the block scope above.
        assert.doesNotMatch(GEN_DATA_BLOCK, /fs\.writeFileSync\(target, data\)/);
    });
});

// ---------------------------------------------------------------------------
// 02 — behavioural: real generator legacy path (no SQLite needed)
// ---------------------------------------------------------------------------
describe('02 - generator legacy path is atomic (real createFileFromDataSync)', function () {
    var dir, target;

    before(function () {
        dir = mkTmpDir('gen');
        target = path.join(dir, 'foo.json'); // not under ~/.gina, not a state name -> legacy path
    });
    after(function () {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    });

    it('reaches the target via renameSync from a sibling temp, never a direct writeFileSync(target)', function () {
        realWriteFileSync(target, JSON.stringify({ old: true }, null, 4)); // pre-seed complete old content
        var spy = installFsSpy();
        try {
            Generator.createFileFromDataSync({ a: 1, b: 2 }, target);
        } finally { spy.restore(); }

        assert.deepEqual(JSON.parse(realReadFileSync(target, 'utf8')), { a: 1, b: 2 }, 'final content is the new data');
        assert.ok(spy.calls.write.every(function (p) { return p !== target; }), 'target is never written in place');
        var tmp = spy.calls.write.find(function (p) { return p.indexOf(target + '.') === 0 && /\.tmp$/.test(p); });
        assert.ok(tmp, 'a sibling .tmp file was written');
        assert.equal(path.dirname(tmp), path.dirname(target), 'temp shares the target dir (same fs -> atomic rename)');
        assert.ok(spy.calls.rename.some(function (r) { return r[0] === tmp && r[1] === target; }), 'renameSync(tmp, target) ran');
        assert.ok(spy.calls.chmod.some(function (c) { return c[0] === tmp; }), 'chmod was applied to the temp (before rename)');
    });

    it('keeps the target complete + parseable throughout the temp write — no torn window', function () {
        realWriteFileSync(target, JSON.stringify({ old: 'complete' }, null, 4));
        var observedDuringWrite = [];
        var spy = installFsSpy({
            onWrite: function (p) {
                // At the instant the new bytes hit the temp, the target must still hold the
                // complete previous content — the atomic write never touches the target
                // until the rename. A non-atomic in-place write would expose a torn read here.
                if (/\.tmp$/.test(p)) {
                    try { observedDuringWrite.push(JSON.parse(realReadFileSync(target, 'utf8'))); }
                    catch (e) { observedDuringWrite.push({ __torn: e.message }); }
                }
            }
        });
        try {
            Generator.createFileFromDataSync({ fresh: 1 }, target);
        } finally { spy.restore(); }

        assert.ok(observedDuringWrite.length >= 1, 'the temp was written (hook fired)');
        observedDuringWrite.forEach(function (snap) {
            assert.deepEqual(snap, { old: 'complete' }, 'target stayed complete + parseable during the temp write');
        });
    });

    it('unlinks the temp and rethrows when the write fails', function () {
        realWriteFileSync(target, JSON.stringify({ old: true }, null, 4));
        var spy = installFsSpy({
            onWrite: function (p) { if (/\.tmp$/.test(p)) { throw new Error('disk full'); } }
        });
        var threw = null, tmpWritten = null;
        try {
            try { Generator.createFileFromDataSync({ a: 1 }, target); }
            catch (e) { threw = e; }
            tmpWritten = spy.calls.write[0];
        } finally { spy.restore(); }

        assert.ok(threw && /disk full/.test(threw.message), 'the write error propagates to the caller');
        assert.ok(tmpWritten && /\.tmp$/.test(tmpWritten), 'the failed write targeted the temp, not the real file');
        assert.ok(spy.calls.unlink.indexOf(tmpWritten) !== -1, 'the partial temp was unlinked on failure');
        // the pre-existing complete file is untouched by the failed write
        assert.deepEqual(JSON.parse(realReadFileSync(target, 'utf8')), { old: true }, 'the prior target content survives a failed write');
    });
});

// ---------------------------------------------------------------------------
// 03 — behavioural: real StateStore sidecar write (guarded on node:sqlite)
// ---------------------------------------------------------------------------
describe('03 - StateStore sidecar write is atomic (real this.write)', function () {
    var home, sidecar, prevGetEnvVar, hadGetEnvVar, sqliteOK;

    before(function () {
        home    = mkTmpDir('state');
        sidecar = path.join(home, 'projects.json');
        // state.js _homeDir() reads GINA_HOMEDIR via the global getEnvVar; inject a temp
        // home so the real ~/.gina is never touched.
        hadGetEnvVar  = Object.prototype.hasOwnProperty.call(global, 'getEnvVar');
        prevGetEnvVar = global.getEnvVar;
        global.getEnvVar = function (k) { return k === 'GINA_HOMEDIR' ? home : undefined; };
        try { sqliteOK = !!require('node:sqlite').DatabaseSync; } catch (e) { sqliteOK = false; }
    });
    after(function () {
        if (hadGetEnvVar) { global.getEnvVar = prevGetEnvVar; }
        else { try { delete global.getEnvVar; } catch (e) { global.getEnvVar = undefined; } }
        try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
    });

    it('reaches the sidecar via renameSync from a sibling temp, never a direct writeFileSync(sidecar)', function (t) {
        if (!sqliteOK) { t.skip('node:sqlite unavailable (Node < 22.5.0) — sidecar path not reachable'); return; }
        var store = new StateStore(); // fresh instance (own _db), avoids singleton-cache coupling
        assert.equal(store.isStatePath(sidecar), true, 'projects.json under GINA_HOMEDIR is a managed state path');

        var spy = installFsSpy();
        var ok;
        try {
            ok = store.write(sidecar, { demo: { path: '/x' } });
        } finally { spy.restore(); }

        assert.equal(ok, true, 'write() took the SQLite + sidecar path');
        assert.deepEqual(JSON.parse(realReadFileSync(sidecar, 'utf8')), { demo: { path: '/x' } }, 'sidecar holds the new data');
        assert.ok(spy.calls.write.every(function (p) { return p !== sidecar; }), 'sidecar is never written in place');
        var tmp = spy.calls.write.find(function (p) { return p.indexOf(sidecar + '.') === 0 && /\.tmp$/.test(p); });
        assert.ok(tmp, 'a sibling .tmp file was written for the sidecar');
        assert.ok(spy.calls.rename.some(function (r) { return r[0] === tmp && r[1] === sidecar; }), 'renameSync(tmp, sidecar) ran');
    });
});

// ---------------------------------------------------------------------------
// 04 — the torn-read consequence the atomic write prevents (deterministic)
// ---------------------------------------------------------------------------
describe('04 - torn-read consequence', function () {
    it('an empty or truncated state file is fatal to parse; a complete one parses', function () {
        // The two window shapes a non-atomic truncate-in-place write exposes to a
        // concurrent reader (measured in /tmp/b43-repro/race.js):
        assert.throws(function () { JSON.parse(''); }, SyntaxError, 'empty (post-truncate) read');
        assert.throws(function () { JSON.parse('{"frameworks": {"a": {"vers'); }, SyntaxError, 'partial (mid-write) read');
        // The state the atomic rename guarantees a reader always sees instead:
        assert.deepEqual(JSON.parse('{"frameworks": {"a": {"version": "x"}}}'), { frameworks: { a: { version: 'x' } } });
    });
});
