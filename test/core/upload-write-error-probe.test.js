'use strict';
/**
 * server.js — #B144 upload write-error probe (`simulateWriteError`)
 *
 * The feature: a consumer wanted to re-confirm the #B143 mid-stream write-error
 * crash-guard (a destroyed/errored write stream → a guarded 500, never an
 * uncaughtException → SIGTERM) on their own upload surface after each pickup —
 * but every trigger they could construct was either a global config change (an
 * unwritable per-group `path` breaks REAL uploads to that group) or a whole-
 * bundle destabiliser (a full disk). #B144 ships a per-group `simulateWriteError`
 * flag: a group carrying it makes the 'file' handler create the REAL write stream,
 * arm the REAL #B143 terminal listeners, then synthetically `destroy()` it so the
 * production 'error' listener fires the production throwError(500) with the EXACT
 * terminal semantics of a real mid-stream ENOSPC/EIO. The flag is honoured OUTSIDE
 * production scope only; a boot warn surfaces it if it is ever shipped to
 * production (where it stays inert). config = consent; no magic group name; an
 * unconfigured group still 400s.
 *
 * MEASURED (2026-07-22) — two facts the assertions rest on:
 *  - The `group="…"` upload tag rides a Content-Disposition PARAMETER, which
 *    `curl -F` / browser FormData cannot emit; the @rhinostone/busboy fork parses
 *    it into `info.dispositionParams.group` (the whole reason for the fork). A
 *    faithful probe HAND-BUILDS the multipart body — these are the requesting
 *    consumer's own probe bodies, reused verbatim as the e2e fixtures.
 *  - In the two-part probe (variant B) busboy parses BOTH parts and BOTH write
 *    streams are destroyed → TWO 'error' events — but throwError's `!res.headersSent`
 *    guard (server.js:6426) collapses them to exactly ONE 500 (the second is a
 *    no-op). Busboy does NOT "stall on the unconsumed first part"; the guard is
 *    what makes it one 500. The shipped 'file'-handler comment says the same.
 *
 * Strategy: source pins on comment-stripped ACTIVE source (each discriminator
 * red-first-validated against the pre-#B144 blob 137578ed) + a REAL
 * @rhinostone/busboy drive of the consumer's variant-A and variant-B probe bodies through a
 * faithful replica of the shipped 'file' handler (real createWriteStream, real
 * terminal-listener arming, the shipped `simulateWriteError && !isProductionScope()`
 * gate, throwError's guard). The SAME drive with the gate OFF (flag unset OR
 * production scope) is the instrument control — it must read ZERO 500s and a normal
 * resume, proving the 500-counter can read both ONE and ZERO. server.js is
 * server-side only — no dist pins.
 *
 * Suites:
 *  01 — source pins: the guarded destroy block, the two-branch boot warn, the
 *       commented settings sample; negatives (destroy is never unguarded; the
 *       flag is not shipped active in the real config)
 *  02 — variant A (single file part): exactly one guarded 500, no resume, no
 *       throw, and a second NORMAL drive still resumes (the probe never
 *       destabilises the process)
 *  03 — variant B (small THEN large, both tagged): both parts parsed + both
 *       streams destroyed, yet exactly ONE guarded 500 (the headersSent guard),
 *       no resume, no hang
 *  04 — prod-scope inert + flag-off subtract: the SAME body through the SAME
 *       drive with the gate OFF reads ZERO 500s and resumes once (instrument
 *       validated both ways)
 *  05 — mechanism proof: createWriteStream(...).destroy(new Error) → the 'error'
 *       listener fires with the error and 'finish' never does (the terminal
 *       no-decrement semantics)
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var stream = require('stream');

var FW           = require('../fw');
var SERVER_SRC   = path.join(FW, 'core/server.js');
var SETTINGS_TPL = path.join(FW, 'core/template/conf/settings.json');
var Busboy       = require('@rhinostone/busboy');

// Strip full-line `//` comments so a negative pin does not trip on a commented-out
// line (jsdoc.md: "a negative source-inspection pin trips on the file's own
// comment"). The settings SAMPLE is asserted against the RAW text — it is
// commented on purpose, so a stripped read would (correctly) not see it.
function stripLineComments(src) {
    return src.split('\n').filter(function(l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// ─── 01 — #B144 source pins ───────────────────────────────────────────────────
describe('01 - #B144 source pins', function() {
    var active, rawSettings, strippedSettings;
    before(function() {
        active           = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8'));
        rawSettings      = fs.readFileSync(SETTINGS_TPL, 'utf8');
        strippedSettings = stripLineComments(rawSettings);
    });

    it('the destroy is the FIRST statement inside the `simulateWriteError && !isProductionScope()` gate', function() {
        assert.match(active,
            /if\s*\(\s*opt\.groups\[fileGroup\]\.simulateWriteError\s*&&\s*!self\.isProductionScope\(\)\s*\)\s*\{\s*writeStreams\[index\]\.destroy\(new Error\(/);
    });

    it('the destroy carries the simulateWriteError marker, then ++index; return false', function() {
        assert.match(active,
            /writeStreams\[index\]\.destroy\(new Error\([\s\S]{0,140}?simulateWriteError[\s\S]{0,60}?\)\);\s*\+\+index;\s*return false;/);
    });

    it('boot: scans upload.groups for a simulateWriteError flag', function() {
        assert.match(active, /var _probeGroups\s*=\s*Object\.keys\(_uploadSettings\.groups\)\.filter/);
        assert.match(active, /_uploadSettings\.groups\[g\]\.simulateWriteError/);
    });

    it('boot: two warn branches — production IGNORED vs non-prod PROBE active — gated on isProductionScope', function() {
        assert.match(active,
            /if\s*\(\s*self\.isProductionScope\(\)\s*\)\s*\{[\s\S]{0,260}?console\.warn\([\s\S]{0,160}?IGNORED in production scope/);
        assert.match(active, /console\.warn\([\s\S]{0,160}?upload write-error PROBE active/);
    });

    it('settings template ships a COMMENTED `_probe_fail` / `simulateWriteError` sample', function() {
        assert.match(rawSettings, /"_probe_fail"\s*:\s*\{/);
        assert.match(rawSettings, /"simulateWriteError"\s*:\s*true/);
    });

    it('NEGATIVE — the destroy is never emitted UNGUARDED (no bare writeStreams[index].destroy on active source)', function() {
        // the ONLY destroy site is the one inside the prod-gated if above; there is
        // no unconditional writeStreams[index].destroy(new Error( ... anywhere.
        var re = /writeStreams\[index\]\.destroy\(new Error\(/g, m, count = 0, guarded = 0;
        while ((m = re.exec(active)) !== null) {
            count++;
            var pre = active.slice(Math.max(0, m.index - 80), m.index);
            if (/simulateWriteError\s*&&\s*!self\.isProductionScope\(\)\s*\)\s*\{\s*$/.test(pre)) { guarded++; }
        }
        assert.equal(count, 1, 'exactly one writeStreams[index].destroy(new Error( site');
        assert.equal(guarded, 1, 'and it is the prod-gated one');
    });

    it('NEGATIVE — the flag is NOT shipped active in the real config (only in the commented sample)', function() {
        assert.doesNotMatch(strippedSettings, /simulateWriteError/);
    });
});

// ─── real @rhinostone/busboy drive of a hand-built multipart body ─────────────
// Faithful replica of the shipped 'file' handler: real createWriteStream, the
// #B143 creation-time terminal-listener arming, the #B144 gate, and throwError's
// !res.headersSent guard. The gate flags (simulateWriteError / prodScope) are the
// ONLY thing that varies between the probe drive and its subtract control, so any
// 500-vs-no-500 difference is attributable to the gate alone.
var BOUNDARY = '----b144probe';
var CT       = 'multipart/form-data; boundary=' + BOUNDARY;

function part(name, filename, group, body) {
    return '--' + BOUNDARY + '\r\n' +
        'Content-Disposition: form-data; name="' + name + '"; group="' + group + '"; filename="' + filename + '"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n' + body + '\r\n';
}
var CLOSING = '--' + BOUNDARY + '--\r\n';

function drive(cfg, cb) {
    // cfg: { body, simulateWriteError, prodScope, expectFiles }
    var base = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b144-'));
    var bb   = Busboy({ headers: { 'content-type': CT }, defParamCharset: 'utf8' });
    var codes = [], resumes = 0, fileEvents = 0, wsErrors = 0, bbErrors = [], groups = [];
    var pending = 0, busboyDone = false, sinkN = 0, reported = false;
    var state = { headersSent: false };
    var isDestroyPath = cfg.simulateWriteError && !cfg.prodScope;

    // mirror of throwError(response, 500, ...): the !res.headersSent guard
    // (server.js:6426) makes a second errored part's 500 a no-op.
    function throwError500() {
        if (state.headersSent) { return; }
        state.headersSent = true;
        codes.push(500);
    }
    function resume() { resumes++; }   // mirror of resumeAfterMultipart()

    function report() {
        if (reported) { return; }
        // destroy path: terminal is the guarded 500 once every part has been seen
        // AND every stream destroyed. normal path: terminal is the resume.
        if (fileEvents < cfg.expectFiles) { return; }
        if (isDestroyPath) {
            if (!(wsErrors >= cfg.expectFiles && codes.length >= 1)) { return; }
        } else if (resumes < 1) {
            return;
        }
        reported = true;
        // two macro-ticks so any trailing (guarded) event surfaces before we read
        setImmediate(function() { setImmediate(function() {
            try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* best effort */ }
            cb({ codes: codes, resumes: resumes, fileEvents: fileEvents, wsErrors: wsErrors, bbErrors: bbErrors, groups: groups });
        }); });
    }

    bb.on('file', function(fieldname, file, info) {
        fileEvents++;
        var group     = ( info.dispositionParams ) ? info.dispositionParams.group : undefined;
        var fileGroup = ( typeof(group) != 'undefined' && group ) ? group : 'untagged';
        groups.push(fileGroup);
        var ws = fs.createWriteStream(path.join(base, 'probe-' + (sinkN++) + '.bin'));
        // #B143 — arm the terminal listeners AT CREATION (the shipped shape)
        ++pending;
        ws.on('error', function() {
            wsErrors++;
            throwError500();
            try { this.close(); } catch (e) { /* already destroyed */ }
            // an errored stream never emits 'finish' → never decrements pending
            report();
        });
        ws.on('finish', function() {
            this.close(function onUploaded() {
                --pending;
                if (busboyDone && pending === 0) { resume(); }
                report();
            });
        });
        // #B144 gate replica — the shipped `simulateWriteError && !isProductionScope()`
        if (cfg.simulateWriteError && !cfg.prodScope) {
            ws.destroy(new Error('simulated write error — upload group `'+ fileGroup +'` has `simulateWriteError` enabled (test-only fault injector)'));
            report();                  // ++index; return false — the source part is NOT piped
            return;
        }
        file.pipe(ws);                 // normal path
        report();
    });

    bb.on('finish', function() {
        busboyDone = true;
        if (pending === 0) { resume(); }
        report();
    });
    bb.on('error', function(e) { bbErrors.push(String(e && e.message || e)); });

    bb.end(cfg.body);
}

// ─── 02 — variant A: single file part → one guarded 500 ───────────────────────
describe('02 - variant A: single-file probe → guarded 500, process survives', function() {
    var bodyA = part('files', 'probe.png', 'probe', 'A'.repeat(70)) + CLOSING;

    it('exactly one guarded 500, no resume, group parsed from the disposition param', function(t, done) {
        drive({ body: bodyA, simulateWriteError: true, prodScope: false, expectFiles: 1 }, function(r) {
            try {
                assert.deepEqual(r.codes, [500], 'exactly one guarded 500');
                assert.equal(r.resumes, 0, 'no resume — an errored stream never decrements');
                assert.equal(r.fileEvents, 1, 'one file part parsed');
                assert.equal(r.wsErrors, 1, 'one write stream destroyed → one error');
                assert.deepEqual(r.groups, ['probe'], 'group="probe" read from info.dispositionParams');
                assert.deepEqual(r.bbErrors, [], 'no busboy-level error');
                done();
            } catch (e) { done(e); }
        });
    });

    it('a SECOND, NORMAL drive still resumes (the probe never destabilised the process)', function(t, done) {
        // first the probe (500), then an ordinary upload to prove the process is fine
        drive({ body: bodyA, simulateWriteError: true, prodScope: false, expectFiles: 1 }, function(r1) {
            try { assert.deepEqual(r1.codes, [500]); } catch (e) { return done(e); }
            drive({ body: bodyA, simulateWriteError: false, prodScope: false, expectFiles: 1 }, function(r2) {
                try {
                    assert.deepEqual(r2.codes, [], 'the normal drive sends no 500');
                    assert.equal(r2.resumes, 1, 'the normal drive resumes exactly once');
                    assert.equal(r2.wsErrors, 0, 'no write error on the normal path');
                    done();
                } catch (e) { done(e); }
            });
        });
    });
});

// ─── 03 — variant B: two parts small THEN large → still one guarded 500 ────────
describe('03 - variant B: two tagged parts (70B then ~1.2MB) → exactly one guarded 500', function() {
    var bodyB = part('files', 'small.png', 'probe', 'S'.repeat(70)) +
                part('files', 'large.png', 'probe', 'L'.repeat(1200000)) + CLOSING;

    it('both parts parsed + both streams destroyed, yet exactly ONE 500 (the headersSent guard), no resume, no hang', function(t, done) {
        drive({ body: bodyB, simulateWriteError: true, prodScope: false, expectFiles: 2 }, function(r) {
            try {
                assert.equal(r.fileEvents, 2, 'BOTH parts parsed — busboy does not stall on the unconsumed first part');
                assert.equal(r.wsErrors, 2, 'BOTH write streams destroyed → two errors');
                assert.deepEqual(r.codes, [500], 'yet exactly ONE 500 — the second throwError is a no-op behind !res.headersSent');
                assert.equal(r.resumes, 0, 'no resume — the request is terminal at the 500');
                assert.deepEqual(r.groups, ['probe', 'probe'], 'both parts tagged group="probe"');
                assert.deepEqual(r.bbErrors, [], 'no busboy-level error (the request is answered by the 500)');
                done();
            } catch (e) { done(e); }
        });
    });
});

// ─── 04 — prod-scope inert + flag-off subtract (instrument validated both ways)─
// The SAME variant-A body through the SAME drive with the gate OFF must read ZERO
// 500s and resume once — proving (a) the 500-counter can read zero, not only one
// (a control that cannot fail is no control), and (b) the destroy branch is what
// produces the 500.
describe('04 - the gate OFF is inert: production scope AND flag-unset both skip the destroy', function() {
    var bodyA = part('files', 'probe.png', 'probe', 'A'.repeat(70)) + CLOSING;

    it('production scope: the flag is set but isProductionScope() short-circuits the gate → no 500, normal resume', function(t, done) {
        drive({ body: bodyA, simulateWriteError: true, prodScope: true, expectFiles: 1 }, function(r) {
            try {
                assert.deepEqual(r.codes, [], 'inert in production scope — no 500');
                assert.equal(r.resumes, 1, 'the upload completes normally');
                assert.equal(r.wsErrors, 0, 'no synthetic destroy fired');
                done();
            } catch (e) { done(e); }
        });
    });

    it('SUBTRACT — flag unset (non-prod): the identical body takes the normal path → no 500, normal resume', function(t, done) {
        drive({ body: bodyA, simulateWriteError: false, prodScope: false, expectFiles: 1 }, function(r) {
            try {
                assert.deepEqual(r.codes, [], 'no flag → no 500 (the destroy is what produces the 500)');
                assert.equal(r.resumes, 1, 'the upload completes normally');
                assert.equal(r.wsErrors, 0, 'no destroy');
                done();
            } catch (e) { done(e); }
        });
    });
});

// ─── 05 — mechanism proof: destroy(err) → 'error', never 'finish' ─────────────
describe('05 - mechanism proof: a destroyed write stream errors (never finishes)', function() {
    var base;
    before(function() { base = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b144-mech-')); });
    after(function()  { try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* best effort */ } });

    it('createWriteStream(...).destroy(new Error(x)) → the error listener fires with x, finish never does, no throw', function(t, done) {
        var ws = fs.createWriteStream(path.join(base, 'mech.bin'));
        var finishes = 0, settled = false;
        ws.on('finish', function() { finishes++; });
        // gate on the actual 'error' event (destroy-before-open resolves via the fd
        // open→close cycle, so a fixed tick count would race it); then give 'finish'
        // a further tick to (not) fire before asserting.
        ws.on('error', function(err) {
            if (settled) { return; }
            settled = true;
            try {
                assert.match(String(err && err.message), /simulated write error/,
                    'the destroy error is the one delivered to the listener');
            } catch (e) { return done(e); }
            setImmediate(function() {
                try {
                    assert.equal(finishes, 0, 'a destroyed stream never emits finish — the pending counter is never decremented, so the request stays terminal at the 500');
                    done();
                } catch (e) { done(e); }
            });
        });
        assert.doesNotThrow(function() {
            ws.destroy(new Error('simulated write error'));
        });
    });
});
