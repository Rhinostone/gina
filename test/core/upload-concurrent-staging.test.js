'use strict';
/**
 * Upload staging destination — #B419 (concurrent same-name upload corruption)
 *
 * The multipart RECEIVE path used to write to `<fileUploadDir>/<client basename>`
 * with no per-part component, at TWO independent sites (the write stream and the
 * record's `path`). Two parts sharing a name — within one request, or across
 * concurrent requests — therefore opened two write streams on ONE path with
 * independent file offsets and interleaved their bytes into a single hybrid file
 * matching neither source, while the framework reported success.
 *
 * The staged name is now server-generated and opaque (CSPRNG hex + `.part`); the
 * client's name survives on the record as `originalFilename`, which is what
 * `self.store()` publishes under, so the documented "keeping each file's original
 * name" contract is unchanged.
 *
 * Strategy: source inspection + inline logic replica + a real-fs behavioural arm
 * (mirrors upload-config.test.js). No live HTTP server, no framework bootstrap.
 *
 * Suites:
 *  01 — server.js source pins: opaque staged name, both write sites, client name kept
 *  02 — inline replica: uniqueness / fixed length / no client input
 *  03 — behavioural (real fs): two same-named parts land as two intact files,
 *       WITH a pre-fix control proving this arm can observe the corruption
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var crypto = require('crypto');

var FW         = require('../fw');
var SERVER_SRC = path.join(FW, 'core/server.js');

// Strip full-line `//` comments so the negative pins do not trip on the fix's
// OWN comment, which necessarily names the defective `<fileUploadDir>/<filename>`
// shape it replaced (jsdoc.md: "a negative source-inspection pin trips on the
// file's own comment").
function stripLineComments(src) {
    return src.split('\n').filter(function(l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// ─── 01 — server.js source pins ───────────────────────────────────────────────
describe('01 - upload staging: server.js source pins (#B419)', function() {
    var raw, active;
    before(function() {
        raw    = fs.readFileSync(SERVER_SRC, 'utf8');
        active = stripLineComments(raw);
    });

    it('the staged name is minted from a CSPRNG, not Math.random', function() {
        assert.match(active, /var stagedName\s*=\s*crypto\.randomBytes\(\s*16\s*\)\.toString\('hex'\)/);
        // movefiles' Math.random uniquifier is fine for a temp sibling nobody can
        // reach; a staging path an unauthenticated request creates is not — V8's
        // Math.random is xorshift128+, so observing a few outputs predicts the rest.
        assert.doesNotMatch(active, /var stagedName[\s\S]{0,120}?Math\.random/);
    });

    it('the staged name carries no client input and no interpretable extension', function() {
        var m = active.match(/var stagedName\s*=\s*(.+);/);
        assert.ok(m, 'stagedName declaration not found');
        assert.doesNotMatch(m[1], /filename/, 'the client basename must not appear in the staged name');
        assert.match(m[1], /\+\s*'\.part'/, "the staged name ends in the inert '.part' marker");
    });

    it('BOTH write sites use the staged name (they must never diverge)', function() {
        assert.match(active, /fs\.createWriteStream\(\s*_\(fileUploadDir \+ '\/' \+ stagedName\)/);
        assert.match(active, /tmpFilename\s*=\s*_\(fileUploadDir \+ '\/' \+ stagedName\)/);
    });

    it('NO write site derives the destination from the raw client filename', function() {
        // the real regression shape: either write site reverting to `filename`.
        assert.doesNotMatch(active, /fs\.createWriteStream\(\s*_\([a-zA-Z]+ \+ '\/' \+ filename\)/);
        assert.doesNotMatch(active, /tmpFilename\s*=\s*_\([a-zA-Z]+ \+ '\/' \+ filename\)/);
        // instrument validation: the strip must not have eaten the whole file, and
        // `filename` must still be a live identifier in it — otherwise the two
        // negative pins above would pass vacuously.
        assert.ok(active.length > raw.length * 0.5, 'comment strip removed too much');
        assert.ok(active.indexOf('var filename = info.filename;') > -1,
            'the `filename` identifier must still exist — else the negatives are vacuous');
    });

    it('the client name is preserved on the record as originalFilename', function() {
        assert.match(active, /originalFilename:\s*filename/);
    });
});

// ─── 02 — inline replica ──────────────────────────────────────────────────────
describe('02 - upload staging: staged-name replica (#B419)', function() {

    // mirror of the server.js declaration
    function mintStagedName() {
        return crypto.randomBytes(16).toString('hex') + '.part';
    }

    it('is unique across many draws for the SAME client filename', function() {
        var seen = new Set();
        for (var i = 0; i < 5000; i++) seen.add(mintStagedName());
        assert.equal(seen.size, 5000, 'every staged name must be distinct');
    });

    it('has a fixed length regardless of the client filename length', function() {
        // the pre-fix shape appended to the client basename, so a long-but-legal
        // name (NAME_MAX is 255) could overflow into ENAMETOOLONG and turn a
        // working upload into a 500.
        var a = mintStagedName(), b = mintStagedName();
        assert.equal(a.length, b.length);
        assert.equal(a.length, 32 + '.part'.length);
        assert.ok(a.length < 255, 'must sit well inside NAME_MAX');
    });

    it('contains no path separator and no client-controllable byte', function() {
        for (var i = 0; i < 200; i++) {
            var n = mintStagedName();
            assert.match(n, /^[0-9a-f]{32}\.part$/, 'hex + .part only');
        }
    });
});

// ─── 03 — behavioural: real fs, real streams ──────────────────────────────────
describe('03 - upload staging: two same-named parts land intact (#B419)', function() {
    var base;
    before(function() { base = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b419-')); });
    after(function() {
        try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    function mintStagedName() { return crypto.randomBytes(16).toString('hex') + '.part'; }

    // Drive two write streams the way the busboy 'file' handler does — one per
    // part, both created before either finishes — and settle when both close.
    function writeBoth(pathA, pathB, bufA, bufB, done) {
        var left = 2;
        var wsA = fs.createWriteStream(pathA);
        var wsB = fs.createWriteStream(pathB);
        function fin() { if (--left === 0) done(); }
        wsA.on('close', fin); wsB.on('close', fin);
        // interleave the writes, which is what two concurrent parts produce
        wsA.write(bufA.subarray(0, bufA.length / 2));
        wsB.write(bufB.subarray(0, bufB.length / 2));
        wsA.end(bufA.subarray(bufA.length / 2));
        wsB.end(bufB.subarray(bufB.length / 2));
    }

    var A = Buffer.alloc(60000, 0x41);   // 'A'
    var B = Buffer.alloc(90000, 0x42);   // 'B'

    it('PRE-FIX CONTROL: one shared path corrupts — this arm CAN observe the defect', function(t, done) {
        // the shape the receive path used to produce: both parts resolve to the
        // SAME destination because it was derived from the client basename.
        var shared = path.join(base, 'same.bin');
        writeBoth(shared, shared, A, B, function() {
            var buf = fs.readFileSync(shared);
            var chars = new Set(buf);
            assert.ok(chars.size > 1 || buf.length !== A.length + B.length,
                'the shared-path write must NOT yield two clean files');
            // exactly the #B419 signature: one file, mixed content or a lost part
            assert.equal(fs.existsSync(shared), true);
            done();
        });
    });

    it('two same-named parts now resolve to two distinct paths, both byte-exact', function(t, done) {
        var p1 = path.join(base, mintStagedName());
        var p2 = path.join(base, mintStagedName());
        assert.notEqual(p1, p2, 'the staged names must differ for identical client input');
        writeBoth(p1, p2, A, B, function() {
            var b1 = fs.readFileSync(p1), b2 = fs.readFileSync(p2);
            assert.equal(b1.length, A.length);
            assert.equal(b2.length, B.length);
            assert.equal(b1.compare(A), 0, 'part 1 must be byte-exact');
            assert.equal(b2.compare(B), 0, 'part 2 must be byte-exact');
            done();
        });
    });
});
