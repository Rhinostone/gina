/**
 * #B349 — the `sharded` strategy's build-time temp-orphan sweep.
 *
 * A `put()` whose PROCESS died leaves its temp file behind. `cas` has always
 * reclaimed those at build and `stream` has its own age-gated pass, which left
 * `sharded` as the one strategy where the leak was permanent — nothing in the
 * codebase ever removed the file.
 *
 * The sweep is gated on `sweepGrace`, the same key/default/meaning cas uses.
 * The age gate is the whole safety story: a temp younger than the grace may be
 * a SIBLING process's in-flight write on a shared root, and eating it would
 * corrupt a live put. `sharded` deliberately takes no `sweepInterval` — there
 * is no periodic pass, because a restart is the earliest moment the previous
 * process is provably gone.
 *
 * @module test/lib/storage-sharded-temp-sweep
 */

'use strict';

var { describe, it, after } = require('node:test');
var assert   = require('node:assert');
var fs       = require('node:fs');
var os       = require('node:os');
var nodePath = require('node:path');

var ROOT    = nodePath.join(__dirname, '..', '..');
var VERSION = require(nodePath.join(ROOT, 'package.json')).version;
var FW      = nodePath.join(ROOT, 'framework', 'v' + VERSION);

var storage                 = require(nodePath.join(FW, 'lib', 'storage', 'src', 'main.js'));
var createLocalDriver       = require(nodePath.join(FW, 'lib', 'storage', 'src', 'local.js'));
var createEmbeddedMetaStore = require(nodePath.join(FW, 'lib', 'storage', 'src', 'meta-store.js'));

var roots = [];

/**
 * Build a sharded driver over a fresh temp root.
 *
 * @inner
 * @param {object} [over] - Config overrides (notably `root`, `sweepGrace`).
 * @returns {object} `{driver, root, store}`.
 */
function freshSharded(over) {
    over = over || {};
    var root = over.root || fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tsweep-'));
    if ( roots.indexOf(root) < 0 ) { roots.push(root); }
    var store  = createEmbeddedMetaStore(nodePath.join(root, '.meta.db'));
    var conf   = {
        root          : root,
        strategy      : 'sharded',
        maxObjectSize : 1024 * 1024
    };
    if ( typeof over.sweepGrace !== 'undefined' ) { conf.sweepGrace = over.sweepGrace; }
    return { driver: createLocalDriver('t', conf, store), root: root, store: store };
}

/**
 * Seed a `.tmp` directory with one aged entry and one fresh entry.
 *
 * @inner
 * @param {string} root    - Driver root.
 * @param {number} ageMs   - How far in the past to backdate the aged entry.
 * @returns {{oldTmp: string, freshTmp: string}} The two paths.
 */
function seedTemps(root, ageMs) {
    var tmpD = nodePath.join(root, '.tmp');
    fs.mkdirSync(tmpD, { recursive: true });
    var oldTmp   = nodePath.join(tmpD, 'OLD.tmp');
    var freshTmp = nodePath.join(tmpD, 'FRESH.tmp');
    fs.writeFileSync(oldTmp, 'crashed put residue');
    fs.writeFileSync(freshTmp, 'a sibling process is writing this right now');
    var past = new Date(Date.now() - ageMs);
    fs.utimesSync(oldTmp, past, past);
    return { oldTmp: oldTmp, freshTmp: freshTmp };
}

after(function () {
    roots.forEach(function (r) {
        try { fs.rmSync(r, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });
});

describe('01 - the sweep reclaims aged temps and spares fresh ones', function () {

    it('an aged temp is gone at build; a fresh one survives', function () {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tsweep-'));
        roots.push(root);
        var t = seedTemps(root, 2 * 60 * 60 * 1000);          // 2h, past the 1h default grace

        var f = freshSharded({ root: root, sweepGrace: 60 * 60 * 1000 });

        assert.strictEqual(fs.existsSync(t.oldTmp), false, 'the aged orphan is reclaimed');
        assert.strictEqual(fs.existsSync(t.freshTmp), true,
            'a temp younger than the grace is untouchable — it may be a sibling process\'s live write');
        f.driver.close();
    });

    it('SUBTRACT: with no sweepGrace the sweep does not run, which is what the pre-#B349 driver did', function () {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tsweep-'));
        roots.push(root);
        var t = seedTemps(root, 2 * 60 * 60 * 1000);

        // No sweepGrace at all — a direct factory caller, the maxObjectSize
        // pattern. Both temps must survive, which is ALSO the control proving
        // the assertion above is caused by the sweep and not by the harness.
        var f = freshSharded({ root: root });

        assert.strictEqual(fs.existsSync(t.oldTmp), true, 'no grace means no sweep: the aged temp stays');
        assert.strictEqual(fs.existsSync(t.freshTmp), true);
        f.driver.close();
    });

    it('a grace LONGER than the temp\'s age spares it (the gate is the age, not the presence of a grace)', function () {
        var root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gina-storage-tsweep-'));
        roots.push(root);
        var t = seedTemps(root, 10 * 60 * 1000);              // 10m old

        var f = freshSharded({ root: root, sweepGrace: 60 * 60 * 1000 });  // 1h grace

        assert.strictEqual(fs.existsSync(t.oldTmp), true, '10m < 1h grace: not yet abandoned');
        f.driver.close();
    });

    it('an absent .tmp directory is not an error', function () {
        var f = freshSharded({ sweepGrace: 60 * 60 * 1000 });
        assert.ok(f.driver, 'the driver builds over a root that has no .tmp yet');
        f.driver.close();
    });
});

describe('02 - sweepGrace is a CONSUMED key on sharded, not an ignored one', function () {

    it('does not warn as ignored — while a bogus key still does (control)', function () {
        var v = storage.validateConfig({
            drivers: { a: { adapter: 'local', strategy: 'sharded', root: '/var/data/x', sweepGrace: '1h' } }
        });
        assert.strictEqual(v.fatal, null);
        assert.deepStrictEqual(v.warnings, [], 'sweepGrace is consumed by sharded');

        var v2 = storage.validateConfig({
            drivers: { a: { adapter: 'local', strategy: 'sharded', root: '/var/data/x', bogusKey: 1 } }
        });
        assert.strictEqual(v2.warnings.length, 1, 'control: the checker still names a genuinely unknown key');
        assert.match(v2.warnings[0], /bogusKey/);
    });

    it('sweepInterval stays cas-only and is still named as ignored under sharded', function () {
        var v = storage.validateConfig({
            drivers: { a: { adapter: 'local', strategy: 'sharded', root: '/var/data/x', sweepInterval: '15m' } }
        });
        assert.strictEqual(v.warnings.length, 1, 'sharded has no periodic pass to configure');
        assert.match(v.warnings[0], /sweepInterval/);
        assert.match(v.warnings[0], /`sharded` strategy/);
    });

    it('lints its value the way cas does', function () {
        var base = { adapter: 'local', strategy: 'sharded', root: '/var/data/x' };
        var v1 = storage.validateConfig({ drivers: { a: Object.assign({}, base, { sweepGrace: 'soon' }) } });
        assert.match(v1.warnings[0], /`sweepGrace` must carry a unit/);
        var v2 = storage.validateConfig({ drivers: { a: Object.assign({}, base, { sweepGrace: '0s' }) } });
        assert.match(v2.warnings[0], /`sweepGrace` must be greater than zero/);
    });
});

describe('03 - the resolved default', function () {

    it('sharded resolves sweepGrace to the shared default, and takes no sweepInterval', function () {
        var r = storage._resolveDriverConf({ root: '/x', strategy: 'sharded', maxObjectSize: '1MB' });
        assert.equal(r.sweepGrace, storage._DEFAULT_SWEEP_GRACE, 'same default as cas');
        assert.strictEqual(typeof r.sweepInterval, 'undefined', 'no periodic sweep on sharded');
    });

    it('an explicit duration wins', function () {
        var r = storage._resolveDriverConf({ root: '/x', strategy: 'sharded', maxObjectSize: '1MB', sweepGrace: '30m' });
        assert.equal(r.sweepGrace, 30 * 60 * 1000);
    });
});
