/**
 * #STO1 slice 1 — `self.store()` becomes the compatibility facade over
 * `lib/storage`: a file whose upload group carries a `driver` key publishes
 * through the named storage driver (opaque key, layer-measured size, atomic
 * temp+rename inside the driver root), while files in groups without one keep
 * the historical move path byte-for-byte. One call may mix both kinds; result
 * slots stay 1:1 with the input array. Riding the same arc, #B140: the
 * multipart `req.files` record now carries the RESOLVED group (`untagged`
 * when the part had no group tag) instead of the raw disposition param — the
 * exact field the facade routes on.
 *
 * §01-§02 are source pins over comment-stripped slices (the store slice runs
 * `this.store = function` to `this.query = function`, the same anchors
 * controller-store-move.test.js uses). §03 pins the #B140 record change in
 * core/server.js. §04+ drive the REAL SuperController.createTestInstance()
 * against a REAL lib/storage driver on a throwaway root — behavioural, per
 * the "a source pin is not a behavioral test" discipline. No arm is
 * crash-shaped: the driver arms its stream errors at creation.
 */
'use strict';
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');

var FW         = require('../fw');
var SOURCE     = path.join(FW, 'core/controller/controller.js');
var SERVER_SRC = path.join(FW, 'core/server.js');

// Strip line/block-style comment LINES so pins cannot trip on JSDoc mentions
// or the replace-code convention's `was:` comments (jsdoc.md discipline).
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

var ST = null;   // store slice (comment-stripped)
var SV = null;   // server.js (comment-stripped)

before(function () {
    var RAW = fs.readFileSync(SOURCE, 'utf8');

    var stStart = RAW.indexOf('this.store = function');
    var stEnd   = RAW.indexOf('this.query = function', stStart);
    assert.ok(stStart > -1, 'extraction control: store declaration located');
    assert.ok(stEnd > stStart, 'extraction control: store slice terminator located');
    ST = stripComments(RAW.slice(stStart, stEnd));

    SV = stripComments(fs.readFileSync(SERVER_SRC, 'utf8'));
});

// ---------------------------------------------------------------------------
// 01 — the facade's routing pieces exist inside store(), in the right shape
// ---------------------------------------------------------------------------
describe('01 - #STO1 pins: the driver-routing facade lives inside store()', function () {
    it('declares the group→driver resolver and the sequential publisher', function () {
        assert.ok(ST.indexOf('var getFileDriverName = function') > -1,
            'the group→driver resolver must live inside store()');
        assert.ok(ST.indexOf('var putfiles = function') > -1,
            'the sequential driver publisher must live inside store()');
    });
    it('reads group config off the resolved bundle conf directly — never a per-call clone', function () {
        assert.ok(ST.indexOf('local.options.conf.content.settings.upload') > -1,
            'the upload block is read off the request conf, the direct idiom');
        assert.ok(ST.indexOf('self.getConfig(') === -1,
            'getConfig() clones the whole settings block per call — the facade must not');
    });
    it('streams the staged source into the driver and tolerates a timer-consumed source', function () {
        assert.ok(ST.indexOf('driver.put(fs.createReadStream(entry.record.path)') > -1,
            'the publisher streams from the parse-time staging path, as movefiles reads it');
        assert.ok(ST.indexOf("unlinkErr.code != 'ENOENT'") > -1,
            'a source consumed by the upload tmp-cleanup timer AFTER a successful publish is not a failure');
    });
    it('partitions into routed and unrouted entries, keeping slot identity', function () {
        assert.ok(ST.indexOf('routed.push({ record:') > -1, 'routed entries carry their record + slot');
        assert.ok(ST.indexOf('unrouted.push({ record:') > -1, 'unrouted entries carry their slot index');
    });
});

// ---------------------------------------------------------------------------
// 02 — target handling: required only for the move path; mkdir gated on it
// ---------------------------------------------------------------------------
describe('02 - #STO1 pins: target is only required (and only created) for the move path', function () {
    it('guards a null/empty target only when an unrouted file needs it', function () {
        assert.ok(ST.indexOf("target == null || target === ''") > -1,
            'an all-routed call may omit the target; a move-path call cannot');
    });
    it('creates the target dir only when at least one file stays on the move path', function () {
        var gateIdx  = ST.indexOf('if ( unrouted.length ) {');
        var mkdirIdx = ST.indexOf('new _(target)');
        assert.ok(gateIdx > -1, 'the mkdir gate must exist');
        assert.ok(mkdirIdx > gateIdx,
            'the target dir construction must sit inside the unrouted gate');
    });
    it('publishes driver-routed files AFTER the move phase settles', function () {
        var moveIdx = ST.indexOf('movefiles(0, local.res, list,');
        var putIdx  = ST.indexOf('putfiles(routed,');
        assert.ok(moveIdx > -1 && putIdx > -1, 'both phases must exist');
        assert.ok(putIdx > moveIdx, 'the driver phase runs inside the move phase\'s success path');
    });
});

// ---------------------------------------------------------------------------
// 03 — #B140: the multipart record carries the RESOLVED group
// ---------------------------------------------------------------------------
describe('03 - #B140 pins: req.files carries the resolved group, never the raw param', function () {
    it('the pushed record reads fileGroup (untagged-normalized), not the raw disposition param', function () {
        assert.ok(SV.indexOf('group: fileGroup,') > -1,
            'the record must carry the resolved configured group');
        assert.ok(SV.indexOf('group: group,') === -1,
            'the raw param is undefined for untagged parts — the record must not carry it');
    });
});

// ---------------------------------------------------------------------------
// 04+ — behavioral: the REAL store() against a REAL lib/storage driver
// ---------------------------------------------------------------------------
describe('04 - behavioral arms (createTestInstance + real lib/storage driver)', function () {

    var SuperController = null;
    var storage = null;
    var work = null;         // per-run scratch root
    var driverRoot = null;   // the real driver's root

    // The exact key layout the sharded strategy mints (Crockford base32 ULID).
    var KEY_RE = /^\d{4}\/\d{2}\/\d{2}\/[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}(\.[a-z0-9]{1,10})?$/;

    before(function () {
        process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
        require('module').Module._initPaths();
        require(path.join(FW, 'helpers'));                              // _, setPath, setContext, ...
        require(path.resolve(FW, '..', '..', 'utils', 'prototypes'));   // JSON.clone, Object.count()
        process.gina = process.gina || {};
        setPath('gina', { core: path.join(FW, 'core') });

        SuperController = require(SOURCE);
        storage = require(path.join(FW, 'lib', 'storage'));   // same module instance the registry serves

        work       = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-store-driver-'));
        driverRoot = path.join(work, 'driver-root');
        fs.mkdirSync(driverRoot, { recursive: true });

        assert.equal(storage.isStarted(), false,
            'control: storage must not be started yet in this process');
        storage.start({
            // inlineThreshold '0B' pins these arms to the FILE path: this suite
            // exercises the facade's mechanics (partition, slot shapes, source
            // consumption), which read only `key`/`size` and are tier-agnostic
            // — the inline tier has its own suite (test/lib/storage-tiering).
            drivers : { testdrv: { adapter: 'local', strategy: 'sharded', root: driverRoot, inlineThreshold: '0B' } },
            default : 'testdrv'
        });
    });

    after(function () {
        try { storage.reset(); } catch (e) { /* best effort */ }
        try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    function mkInstance(settings) {
        var content = { routing: {} };
        if (settings) { content.settings = settings; }
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
                rule: '_storedriver',
                conf: {
                    bundle : 'test',
                    server : { protocol: 'http/1.1', coreConfiguration: { mime: {} } },
                    encoding: 'utf-8',
                    content: content
                }
            }
        });
    }

    // Settles on the FIRST callback, then holds a short grace window so a
    // double-callback is captured; bounded so a never-called callback FAILS
    // instead of hanging the suite.
    function callStore(inst, target, files) {
        return new Promise(function (resolve) {
            var calls = [];
            var guard = setTimeout(function () { resolve({ calls: calls, timedOut: true }); }, 5000);
            inst.store(target, files, function (err, uploaded) {
                calls.push({ err: err, uploaded: uploaded });
                if (calls.length === 1) {
                    setTimeout(function () { clearTimeout(guard); resolve({ calls: calls, timedOut: false }); }, 250);
                }
            });
        });
    }

    function statKey(driverName, key) {
        return new Promise(function (resolve, reject) {
            storage.get(driverName).stat(key, function (err, meta) {
                if (err) { return reject(err); }
                resolve(meta);
            });
        });
    }

    // Published objects on disk: everything under the root except the
    // driver-internal `.tmp/` tree and the embedded `.meta.db` store.
    function publishedObjects() {
        return fs.readdirSync(driverRoot, { recursive: true }).filter(function (f) {
            var rel = String(f);
            if (/^\.tmp([\\/]|$)/.test(rel)) { return false; }
            if (/\.meta\.db/.test(rel)) { return false; }
            return fs.statSync(path.join(driverRoot, rel)).isFile();
        });
    }

    var GROUPS = { upload: { groups: {
        docs  : { driver: 'testdrv' },
        plain : { }
    } } };

    it('05 - a driver-routed file publishes through the layer: opaque key, on-disk size, no filename', async function () {
        var srcDir  = path.join(work, 'staged-a');
        fs.mkdirSync(srcDir, { recursive: true });
        var srcFile = path.join(srcDir, 'report.pdf');
        fs.writeFileSync(srcFile, 'PDF-BYTES-abc');

        var out = await callStore(mkInstance(GROUPS), null, [
            { name: 'doc', group: 'docs', originalFilename: 'report.pdf', encoding: '7bit', type: 'application/pdf', size: 13, path: srcFile }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls.length, 1, 'exactly one settle');
        assert.equal(out.calls[0].err, false, 'success reports err === false — the historical sentinel');

        var u = out.calls[0].uploaded[0];
        assert.deepEqual(Object.keys(u), ['file', 'group', 'driver', 'key', 'size', 'type', 'encoding'],
            'the routed entry shape: file/group/driver/key/size/type/encoding — and NO filename');
        assert.equal(u.file, 'report.pdf');
        assert.equal(u.group, 'docs');
        assert.equal(u.driver, 'testdrv');
        assert.match(u.key, KEY_RE, 'the key is the sharded layout — opaque to the caller');
        assert.equal(u.size, 13, 'size is the layer\'s on-disk measurement');
        assert.equal(u.type, 'application/pdf');

        assert.equal(String(fs.readFileSync(path.join(driverRoot, u.key))), 'PDF-BYTES-abc',
            'the published object carries the exact bytes');
        assert.equal(fs.existsSync(srcFile), false,
            'the staged source is consumed after a successful publish (movefiles parity)');

        var meta = await statKey('testdrv', u.key);
        assert.ok(meta, 'the metadata row exists');
        assert.equal(meta.originalName, 'report.pdf', 'the client name lives in metadata, not the path');
        assert.equal(meta.contentType, 'application/pdf');
        assert.equal(meta.size, 13);
    });

    it('06 - a mixed call keeps 1:1 slot order: moved entry unchanged, routed entry keyed', async function () {
        var srcDir = path.join(work, 'staged-b');
        fs.mkdirSync(srcDir, { recursive: true });
        var plainSrc = path.join(srcDir, 'a.txt');
        var docSrc   = path.join(srcDir, 'b.bin');
        fs.writeFileSync(plainSrc, 'plain-content');
        fs.writeFileSync(docSrc, 'routed-content');

        var targetDir = path.join(work, 'dest-mixed');

        var out = await callStore(mkInstance(GROUPS), targetDir, [
            { name: 'a', group: 'plain', originalFilename: 'a.txt', encoding: '7bit', type: 'text/plain', size: 13, path: plainSrc },
            { name: 'b', group: 'docs',  originalFilename: 'b.bin', encoding: '7bit', type: 'application/octet-stream', size: 14, path: docSrc }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls[0].err, false, 'success');
        var moved  = out.calls[0].uploaded[0];
        var routed = out.calls[0].uploaded[1];

        assert.deepEqual(Object.keys(moved), ['file', 'filename', 'size', 'type', 'encoding'],
            'slot 0 (move path) keeps the historical shape byte-for-byte — no new fields');
        assert.equal(moved.file, 'a.txt');
        assert.equal(String(fs.readFileSync(path.join(targetDir, 'a.txt'))), 'plain-content',
            'the moved file landed under the target');

        assert.equal(routed.file, 'b.bin');
        assert.equal(routed.driver, 'testdrv');
        assert.match(routed.key, KEY_RE);
        assert.ok(!('filename' in routed), 'a routed entry never carries a filesystem path');
        assert.equal(String(fs.readFileSync(path.join(driverRoot, routed.key))), 'routed-content');
    });

    it('07 - an all-routed call may pass a null target — no directory is created', async function () {
        var srcDir  = path.join(work, 'staged-c');
        fs.mkdirSync(srcDir, { recursive: true });
        var srcFile = path.join(srcDir, 'only.bin');
        fs.writeFileSync(srcFile, 'x');

        var out = await callStore(mkInstance(GROUPS), null, [
            { name: 'f', group: 'docs', originalFilename: 'only.bin', encoding: '7bit', type: 'application/octet-stream', size: 1, path: srcFile }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls[0].err, false, 'an all-routed null-target call succeeds');
        assert.match(out.calls[0].uploaded[0].key, KEY_RE);
    });

    it('08 - an unrouted file with a null target fails cleanly, naming the file and group', async function () {
        var srcDir  = path.join(work, 'staged-d');
        fs.mkdirSync(srcDir, { recursive: true });
        var srcFile = path.join(srcDir, 'needs-target.txt');
        fs.writeFileSync(srcFile, 'y');

        var out = await callStore(mkInstance(GROUPS), null, [
            { name: 'f', group: 'plain', originalFilename: 'needs-target.txt', encoding: '7bit', type: 'text/plain', size: 1, path: srcFile }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls.length, 1, 'exactly one settle');
        assert.ok(out.calls[0].err instanceof Error, 'a real Error, not a crash');
        assert.match(out.calls[0].err.message, /target directory is required/);
        assert.match(out.calls[0].err.message, /needs-target\.txt/, 'the error names the file');
        assert.match(out.calls[0].err.message, /plain/, 'the error names the group');
        assert.ok(fs.existsSync(srcFile), 'nothing was consumed');
    });

    it('09 - with no driver config at all, the historical path is untouched (parity subtract)', async function () {
        var srcDir  = path.join(work, 'staged-e');
        fs.mkdirSync(srcDir, { recursive: true });
        var srcFile = path.join(srcDir, 'legacy.txt');
        fs.writeFileSync(srcFile, 'legacy-content');

        var targetDir = path.join(work, 'dest-legacy');

        var out = await callStore(mkInstance(null), targetDir, [
            { filename: 'legacy.txt', path: srcFile, size: 14, type: 'text/plain', encoding: '7bit' }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls[0].err, false, 'success');
        var u = out.calls[0].uploaded[0];
        assert.deepEqual(Object.keys(u), ['file', 'filename', 'size', 'type', 'encoding'],
            'the historical entry shape gains NO fields when no driver is configured');
        assert.equal(String(fs.readFileSync(path.join(targetDir, 'legacy.txt'))), 'legacy-content');
    });

    it('10 - a mid-list publish failure settles once with the real error and keeps earlier objects (no rollback)', async function () {
        var before = publishedObjects().length;

        var srcDir  = path.join(work, 'staged-f');
        fs.mkdirSync(srcDir, { recursive: true });
        var okSrc = path.join(srcDir, 'ok.bin');
        fs.writeFileSync(okSrc, 'first-one');

        var out = await callStore(mkInstance(GROUPS), null, [
            { name: 'ok',   group: 'docs', originalFilename: 'ok.bin',   encoding: '7bit', type: 'application/octet-stream', size: 9, path: okSrc },
            { name: 'gone', group: 'docs', originalFilename: 'gone.bin', encoding: '7bit', type: 'application/octet-stream', size: 1, path: path.join(srcDir, 'vanished.bin') }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle (the driver arms source errors at creation)');
        assert.equal(out.calls.length, 1, 'exactly one settle');
        assert.ok(out.calls[0].err instanceof Error, 'the real Error surfaces');
        assert.equal(out.calls[0].err.code, 'ENOENT', 'the real filesystem code survives');
        assert.equal(publishedObjects().length, before + 1,
            'the first file stays published — abort, never roll back (mover parity)');
    });

    it('11 - a group naming an unbuilt driver fails cleanly at store() time', async function () {
        var srcDir  = path.join(work, 'staged-g');
        fs.mkdirSync(srcDir, { recursive: true });
        var srcFile = path.join(srcDir, 'z.txt');
        fs.writeFileSync(srcFile, 'z');

        var out = await callStore(mkInstance({ upload: { groups: { docs: { driver: 'ghost' } } } }), null, [
            { name: 'z', group: 'docs', originalFilename: 'z.txt', encoding: '7bit', type: 'text/plain', size: 1, path: srcFile }
        ]);

        assert.equal(out.timedOut, false, 'the callback must settle');
        assert.equal(out.calls.length, 1, 'exactly one settle');
        assert.ok(out.calls[0].err instanceof Error, 'a real Error (the boot lint normally refuses this config)');
        assert.match(out.calls[0].err.message, /no driver/, 'the storage registry names the miss');
        assert.ok(fs.existsSync(srcFile), 'the staged source is untouched on a resolution failure');
    });
});
