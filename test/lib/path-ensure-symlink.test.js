/**
 * #B381 — `helpers/path.js` ensureSymlinkSync: idempotent, atomic,
 * concurrent-creator-tolerant symlink publishing.
 *
 * Boot-time mounts used to unlink-then-recreate every bundle link on every
 * (re)start, in two non-atomic steps with no mutual exclusion — so several
 * processes booting one shared project tree collided on the same directory
 * entries (captured in the wild as an EIO from a contended create on a POSIX
 * network filesystem, killing the boot). The helper under test replaces that
 * sequence everywhere on the boot path:
 *
 *   1. a link that already resolves to the source (and whose source exists)
 *      is KEPT — zero writes in the steady state;
 *   2. a wrong/missing link is published atomically: temp sibling in the same
 *      directory, then rename(2) over the destination;
 *   3. a create/rename failure is accepted as success ONLY when the
 *      destination then resolves to the intended source (a concurrent process
 *      published the identical link); anything else re-throws.
 *
 * §01 pins the mechanism on the source (positives; the file's own docblock
 * describes shapes in prose, never in the exact pinned forms).
 * §02 drives the REAL helper through real-filesystem arms, including the
 * tolerance path (monkeypatched rename simulating a concurrent winner) and
 * its genuine-failure control.
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ginaRoot = path.resolve(__dirname, '../..');
var version = require(ginaRoot + '/package.json').version;
var FW = path.join(ginaRoot, 'framework', 'v' + version);
var SOURCE = path.join(FW, 'helpers', 'path.js');

var RAW = fs.readFileSync(SOURCE, 'utf8');

// ---------------------------------------------------------------------------
// 01 — source pins
// ---------------------------------------------------------------------------
describe('01 - source pins: the ensureSymlinkSync mechanism is in the source', function () {

    it('the prototype method is declared with the house convention (value=source, arg=link name)', function () {
        assert.ok(RAW.indexOf('_.prototype.ensureSymlinkSync = function(destination, type)') > -1,
            'prototype declaration missing');
    });

    it('publishes via a temp sibling + rename, in that order', function () {
        var tmpIdx = RAW.indexOf("var _tmpLink = destination + '.gina-tmp-'");
        assert.ok(tmpIdx > -1, 'temp sibling naming missing');
        var renameIdx = RAW.indexOf('fs.renameSync(_tmpLink, destination)', tmpIdx);
        assert.ok(renameIdx > tmpIdx, 'atomic rename publish missing (or precedes the temp create)');
    });

    it('the fast path and the tolerance path both verify resolution AND source existence', function () {
        // Both guards use the same conjunction; there must be exactly two
        // (fast path + concurrent-creator verify). File order = the fast path
        // first. Counted with a needle unique to the helper.
        var m = RAW.match(/isSymlinkResolvingTo\(destination, source\) && existsSync\(source\)/g);
        assert.ok(m, 'the resolve-and-source-exists conjunction is missing');
        assert.equal(m.length, 2,
            'expected the conjunction at exactly the fast path and the tolerance verify');
    });

    it('a failed publish cleans its temp sibling before deciding', function () {
        var catchIdx = RAW.indexOf('} catch (linkErr) {');
        assert.ok(catchIdx > -1, 'publish catch missing');
        var cleanupIdx = RAW.indexOf('fs.unlinkSync(_tmpLink)', catchIdx);
        assert.ok(cleanupIdx > catchIdx, 'temp-sibling cleanup missing from the catch');
    });
});

// ---------------------------------------------------------------------------
// 02 — behavioural arms against the real filesystem
// ---------------------------------------------------------------------------
describe('02 - real-filesystem behaviour', function () {

    var root = null;
    var srcA = null;   // a real directory to link at
    var srcB = null;   // a second real directory (the "wrong" target)

    before(function () {
        // Installing the global `_` (and friends) — the same idiom every
        // real-helpers suite uses.
        require('module').Module._initPaths();
        require(path.join(FW, 'helpers'));

        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-ensure-symlink-'));
        srcA = path.join(root, 'source-a');
        srcB = path.join(root, 'source-b');
        fs.mkdirSync(srcA);
        fs.mkdirSync(srcB);
    });

    after(function () {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
    });

    it('creates the link when nothing is at the destination', function () {
        var dst = path.join(root, 'link-create');
        var out = new _(srcA).ensureSymlinkSync(dst);
        assert.equal(out, 'created');
        assert.equal(fs.readlinkSync(dst), srcA);
    });

    it('keeps an already-correct link untouched (same inode, zero writes)', function () {
        var dst = path.join(root, 'link-keep');
        fs.symlinkSync(srcA, dst);
        var inoBefore = fs.lstatSync(dst).ino;
        var out = new _(srcA).ensureSymlinkSync(dst);
        assert.equal(out, 'kept');
        assert.equal(fs.lstatSync(dst).ino, inoBefore,
            'the link must not have been re-created — the steady state writes nothing');
        assert.equal(fs.readlinkSync(dst), srcA);
    });

    it('keeps a correct link whose stored text is RELATIVE', function () {
        var dst = path.join(root, 'link-keep-rel');
        fs.symlinkSync(path.relative(root, srcA), dst);   // stored text: 'source-a'
        var out = new _(srcA).ensureSymlinkSync(dst);
        assert.equal(out, 'kept',
            'a relative link text resolving to the same source is already correct');
    });

    it('atomically replaces a link pointing at the wrong target', function () {
        var dst = path.join(root, 'link-replace');
        fs.symlinkSync(srcB, dst);
        var inoBefore = fs.lstatSync(dst).ino;
        var out = new _(srcA).ensureSymlinkSync(dst);
        assert.equal(out, 'replaced');
        assert.equal(fs.readlinkSync(dst), srcA);
        assert.notEqual(fs.lstatSync(dst).ino, inoBefore, 'a new link object must have been published');
    });

    it('replaces a dangling link when the intended source exists', function () {
        var gone = path.join(root, 'gone-dir');
        fs.mkdirSync(gone);
        var dst = path.join(root, 'link-dangling');
        fs.symlinkSync(gone, dst);
        fs.rmdirSync(gone);                                // dst now dangles
        var out = new _(srcA).ensureSymlinkSync(dst);
        assert.equal(out, 'replaced');
        assert.equal(fs.readlinkSync(dst), srcA);
    });

    it('fails LOUDLY when the source itself is missing — even if the stale link text matches', function () {
        var ghost = path.join(root, 'ghost-src');
        fs.mkdirSync(ghost);
        var dst = path.join(root, 'link-ghost');
        fs.symlinkSync(ghost, dst);
        fs.rmdirSync(ghost);                               // correct text, dangling source
        assert.throws(function () {
            new _(ghost).ensureSymlinkSync(dst);
        }, /Cannot complete symlinkSync from/,
            'a mount whose release vanished must fail with the usual clear message, not be kept');
    });

    it('the refused publish leaves the existing dangling link UNTOUCHED — same inode, same text (#B388 refutation record)', function () {
        // #B388 probed whether this scene silently rewrites the link every
        // call ("a futile write per mount per boot"). Measured on the real
        // bytes: it does not — the wrapper refuses BEFORE any write, and the
        // tmp-sibling pattern means nothing has touched the destination by
        // then. This arm pins that survival property, which the arm above
        // (the throw) does not: pre-#B381 unlink-then-create DESTROYED the
        // existing link before its create failed. The asserted throw is this
        // arm's firing control — the helper demonstrably ran and refused.
        var ghost = path.join(root, 'ghost-src-b388');
        fs.mkdirSync(ghost);
        var dst = path.join(root, 'link-ghost-b388');
        fs.symlinkSync(ghost, dst);
        fs.rmdirSync(ghost);                               // correct text, dangling source
        var inoBefore = fs.lstatSync(dst).ino;
        assert.throws(function () {
            new _(ghost).ensureSymlinkSync(dst);
        }, /Cannot complete symlinkSync from/);
        assert.equal(fs.lstatSync(dst).ino, inoBefore,
            'the refusal must not have re-created the link — the failed publish leaves the name exactly as found');
        assert.equal(fs.readlinkSync(dst), ghost,
            'the link text must be byte-identical to what was found');
    });

    it('does NOT silently destroy a real directory sitting at the destination', function () {
        var dst = path.join(root, 'real-dir');
        fs.mkdirSync(dst);
        fs.writeFileSync(path.join(dst, 'keep.txt'), 'still here');
        assert.throws(function () {
            new _(srcA).ensureSymlinkSync(dst);
        }, Error, 'publishing over a real directory must surface, never rm -rf it');
        assert.equal(fs.readFileSync(path.join(dst, 'keep.txt'), 'utf8'), 'still here',
            'the directory content must have survived the refused publish');
    });

    it('leaves no temp-sibling residue after a refused publish', function () {
        // The real-dir arm above is the failure driver; assert the whole root
        // carries no leftover temp names from any arm so far.
        var residue = fs.readdirSync(root).filter(function (n) {
            return n.indexOf('.gina-tmp-') > -1;
        });
        assert.deepEqual(residue, [], 'temp siblings must be cleaned on every failure path');
    });

    it('tolerates a concurrent creator that published the identical link', function () {
        var dst = path.join(root, 'link-concurrent');
        var realRename = fs.renameSync;
        var fired = 0;
        fs.renameSync = function (a, b) {
            if (b === dst) {
                fired++;
                // Simulate losing the race: the concurrent winner has already
                // published the correct link, and our own publish fails.
                fs.symlinkSync(srcA, dst);
                var e = new Error('EEXIST: file already exists, rename');
                e.code = 'EEXIST';
                throw e;
            }
            return realRename.apply(fs, arguments);
        };
        try {
            var out = new _(srcA).ensureSymlinkSync(dst);
            assert.equal(out, 'concurrent',
                'an identical concurrent publish is a success, not a boot-killing error');
            assert.equal(fs.readlinkSync(dst), srcA);
            assert.equal(fired, 1, 'the simulated collision must actually have fired');
        } finally {
            fs.renameSync = realRename;
        }
    });

    it('control: a genuine publish failure still throws (tolerance is verify-gated)', function () {
        var dst = path.join(root, 'link-genuine-fail');
        var realRename = fs.renameSync;
        fs.renameSync = function (a, b) {
            if (b === dst) {
                // No concurrent winner plants anything: the destination stays
                // absent, so the verify cannot pass and the error must surface.
                var e = new Error('EIO: i/o error, rename');
                e.code = 'EIO';
                throw e;
            }
            return realRename.apply(fs, arguments);
        };
        try {
            assert.throws(function () {
                new _(srcA).ensureSymlinkSync(dst);
            }, /EIO/, 'with no correct link present, the failure must re-throw');
            assert.equal(fs.existsSync(dst), false, 'nothing may have been published');
        } finally {
            fs.renameSync = realRename;
        }
    });
});
