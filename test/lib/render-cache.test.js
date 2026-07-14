/**
 * lib/render-cache — the output/render-cache backend strategy dispatcher.
 *
 * Slice 0 extracts the memory/fs write branch previously inlined in each render
 * delegate's `writeCache()` into ONE server-only seam (`lib/render-cache`),
 * wrapping the shared `lib/cache` Map primitive. This is where that storage
 * coverage now lives — the render delegate source-pins only assert they now
 * DELEGATE to `renderCache.set(...)` (cmd-status-format extraction precedent).
 *
 * Coverage:
 *   01 memory strategy  — set stamps fromMemory + content; get/has; overwrite;
 *                         case-insensitive type token; writes through to the Map.
 *   02 fs strategy      — writes the body to <path>/<bundle>/<html|data><url>.<ext>,
 *                         creates the dir, stamps filename, trailing-slash→index,
 *                         cleanupFn removes the file on delete/clear.
 *   03 unknown type     — undefined / unrecognised strategy is a no-op (not cached),
 *                         matching the pre-strategy behaviour.
 *   04 expiry metadata  — ttl / sliding / maxAge pass through onto the stored entry
 *                         (lib/cache honours them: expiresAt is computed).
 *   05 events           — setEvents registers; invalidateByEvent evicts one/many.
 *   06 clear + stats    — clear empties the store; stats classifies memory vs fs.
 *
 * Bootstraps the `_` PathObject global via require(FW + '/helpers') — the fs
 * strategy resolves + mkdirs the cache dir through it (the smoke in the Slice 0
 * handoff is the behavioural template). Real fs + a temp dir; the shared
 * `lib/cache` backing Map is a process singleton, so every test resets it via
 * `from(new Map())` for isolation, mirroring test/lib/cache.test.js.
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');

// Side-effect: installs the `_` PathObject constructor (+ getPath/setPath)
// globals that lib/render-cache's fs strategy uses. Mirrors cache.test.js.
require(path.join(FW, 'helpers'));

var RenderCache = require(path.join(FW, 'lib/render-cache/src/main'));

// Fresh dispatcher pointed at a fresh backing Map — resets the process-wide
// lib/cache singleton so each test is isolated.
function freshRc() {
    var rc = new RenderCache();
    rc.from(new Map());
    return rc;
}

var tmpRoot;
before(function () {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'render-cache-'));
});
after(function () {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
});


// ---------------------------------------------------------------------------
// 01 — memory strategy
// ---------------------------------------------------------------------------
describe('01 - memory strategy', function () {
    var rc;
    beforeEach(function () { rc = freshRc(); });
    afterEach(function () { try { rc.clear(); } catch (e) {} });

    it('set stamps fromMemory + inline content and stores the entry', async function () {
        await rc.set('memory', 'static:demo:/', { visibility: 'public' }, { content: '<p>hi</p>' });

        assert.equal(rc.has('static:demo:/'), true);
        var entry = rc.get('static:demo:/');
        assert.equal(entry.fromMemory, true);
        assert.equal(entry.content, '<p>hi</p>');
        assert.equal(entry.visibility, 'public', 'the caller entry fields pass through');
        assert.ok(entry.createdAt instanceof Date, 'lib/cache stamps createdAt');
    });

    it('the type token is case-insensitive (/^memory$/i)', async function () {
        await rc.set('MEMORY', 'static:demo:/x', {}, { content: 'X' });
        assert.equal(rc.get('static:demo:/x').content, 'X');
    });

    it('a re-set of the same key overwrites the entry', async function () {
        await rc.set('memory', 'static:demo:/o', {}, { content: 'first' });
        await rc.set('memory', 'static:demo:/o', {}, { content: 'second' });
        assert.equal(rc.get('static:demo:/o').content, 'second');
        assert.equal(rc.stats().size, 1);
    });

    it('from() adopts a shared Map so writes land in it', async function () {
        var shared = new Map();
        var r = new RenderCache({ store: shared });
        await r.set('memory', 'static:demo:/s', {}, { content: 'shared' });
        assert.equal(shared.has('static:demo:/s'), true);
        r.clear();
    });

    it('delete returns true for a present key, false for a missing one', async function () {
        await rc.set('memory', 'static:demo:/d', {}, { content: 'd' });
        assert.equal(rc.delete('static:demo:/d'), true);
        assert.equal(rc.has('static:demo:/d'), false);
        assert.equal(rc.delete('static:demo:/nope'), false);
    });
});


// ---------------------------------------------------------------------------
// 02 — fs strategy (real disk under a temp dir)
// ---------------------------------------------------------------------------
describe('02 - fs strategy', function () {
    var rc;
    beforeEach(function () { rc = freshRc(); });
    afterEach(function () { try { rc.clear(); } catch (e) {} });

    it('writes the body to <path>/<bundle>/html<url>.html and stamps filename', async function () {
        var key = 'static:demo:/page';
        await rc.set('fs', key, {}, { content: '<h1>page</h1>', path: tmpRoot, bundle: 'demo', url: '/page', kind: 'html' });

        var file = String(rc.get(key).filename);
        assert.ok(file.endsWith('/demo/html/page.html'), 'fs html path shape: ' + file);
        assert.equal(fs.existsSync(file), true, 'the cache file exists on disk');
        assert.equal(fs.readFileSync(file, 'utf8'), '<h1>page</h1>');
    });

    it('kind:"data" writes to <path>/<bundle>/data<url>.json', async function () {
        var key = 'data:demo:/api/users';
        await rc.set('fs', key, {}, { content: '{"ok":true}', path: tmpRoot, bundle: 'demo', url: '/api/users', kind: 'data' });

        var file = String(rc.get(key).filename);
        assert.ok(file.endsWith('/demo/data/api/users.json'), 'fs data path shape: ' + file);
        assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}');
    });

    it('a trailing-slash url resolves to <dir>/index.<ext>', async function () {
        var key = 'data:demo:/api/';
        await rc.set('fs', key, {}, { content: '{}', path: tmpRoot, bundle: 'demo', url: '/api/', kind: 'data' });

        var file = String(rc.get(key).filename);
        assert.ok(file.endsWith('/demo/data/api/index.json'), 'trailing-slash url → index.json: ' + file);
        assert.equal(fs.existsSync(file), true);
    });

    it('creates the (nested, missing) target directory before writing', async function () {
        var key = 'static:demo:/deep/nested/leaf';
        await rc.set('fs', key, {}, { content: 'x', path: tmpRoot, bundle: 'freshbundle', url: '/deep/nested/leaf', kind: 'html' });

        var file = String(rc.get(key).filename);
        assert.equal(fs.existsSync(file), true, 'the nested dir was mkdir-ed and the file written');
        assert.equal(fs.existsSync(path.join(tmpRoot, 'freshbundle', 'html', 'deep', 'nested')), true);
    });

    it('deleting the entry removes the cached file from disk (cleanupFn)', async function () {
        var key = 'static:demo:/gone';
        await rc.set('fs', key, {}, { content: 'bye', path: tmpRoot, bundle: 'demo', url: '/gone', kind: 'html' });
        var file = String(rc.get(key).filename);
        assert.equal(fs.existsSync(file), true);

        rc.delete(key);
        assert.equal(rc.has(key), false);
        assert.equal(fs.existsSync(file), false, 'cleanupFn removed the cached file on eviction');
    });

    it('clear removes the cached files from disk (cleanupFn per entry)', async function () {
        await rc.set('fs', 'static:demo:/c1', {}, { content: 'a', path: tmpRoot, bundle: 'clr', url: '/c1', kind: 'html' });
        await rc.set('fs', 'static:demo:/c2', {}, { content: 'b', path: tmpRoot, bundle: 'clr', url: '/c2', kind: 'html' });
        var f1 = String(rc.get('static:demo:/c1').filename);
        var f2 = String(rc.get('static:demo:/c2').filename);

        rc.clear();
        assert.equal(fs.existsSync(f1), false);
        assert.equal(fs.existsSync(f2), false);
        assert.equal(rc.stats().size, 0);
    });
});


// ---------------------------------------------------------------------------
// 03 — unknown / undefined strategy is a no-op (pre-strategy behaviour)
// ---------------------------------------------------------------------------
describe('03 - unknown / undefined type is a no-op', function () {
    var rc;
    beforeEach(function () { rc = freshRc(); });
    afterEach(function () { try { rc.clear(); } catch (e) {} });

    it('undefined type does not cache (route without cache.type, no server default)', async function () {
        await rc.set(undefined, 'static:demo:/u', {}, { content: 'x' });
        assert.equal(rc.has('static:demo:/u'), false);
        assert.equal(rc.stats().size, 0);
    });

    it('an unrecognised type does not cache (e.g. a not-yet-shipped strategy)', async function () {
        await rc.set('redis', 'static:demo:/r', {}, { content: 'x', path: tmpRoot, bundle: 'demo', url: '/r', kind: 'html' });
        assert.equal(rc.has('static:demo:/r'), false);
    });
});


// ---------------------------------------------------------------------------
// 04 — expiry metadata passes through onto the stored entry
// ---------------------------------------------------------------------------
describe('04 - ttl / sliding / maxAge pass-through', function () {
    var rc;
    beforeEach(function () { rc = freshRc(); });
    afterEach(function () { try { rc.clear(); } catch (e) {} });

    it('an absolute ttl passes through', async function () {
        await rc.set('memory', 'static:demo:/ttl', { ttl: 30 }, { content: 'x' });
        assert.equal(rc.get('static:demo:/ttl').ttl, 30);
    });

    it('sliding + maxAge pass through (lib/cache computes expiresAt)', async function () {
        await rc.set('memory', 'static:demo:/sl', { ttl: 30, sliding: true, maxAge: 300 }, { content: 'x' });
        var e = rc.get('static:demo:/sl');
        assert.equal(e.ttl, 30);
        assert.equal(e.sliding, true);
        assert.equal(e.maxAge, 300);
        assert.ok(e.expiresAt instanceof Date, 'the maxAge ceiling was honoured by lib/cache');
    });
});


// ---------------------------------------------------------------------------
// 05 — event-driven invalidation (delegated to lib/cache)
// ---------------------------------------------------------------------------
describe('05 - event invalidation', function () {
    var rc;
    beforeEach(function () { rc = freshRc(); });
    afterEach(function () { try { rc.clear(); } catch (e) {} });

    it('setEvents registers an event that invalidateByEvent then evicts', async function () {
        await rc.set('memory', 'static:demo:/e', {}, { content: 'x' });
        rc.setEvents('static:demo:/e', ['content:updated']);
        assert.equal(rc.has('static:demo:/e'), true);

        rc.invalidateByEvent('content:updated');
        assert.equal(rc.has('static:demo:/e'), false);
    });

    it('invalidateByEvent evicts every key registered to the event', async function () {
        await rc.set('memory', 'static:demo:/a', {}, { content: 'a' });
        await rc.set('memory', 'static:demo:/b', {}, { content: 'b' });
        rc.setEvents('static:demo:/a', ['bust']);
        rc.setEvents('static:demo:/b', ['bust']);

        rc.invalidateByEvent('bust');
        assert.equal(rc.has('static:demo:/a'), false);
        assert.equal(rc.has('static:demo:/b'), false);
    });

    it('invalidateByEvent for an unrelated event leaves the entry in place', async function () {
        await rc.set('memory', 'static:demo:/keep', {}, { content: 'k' });
        rc.setEvents('static:demo:/keep', ['some:event']);

        rc.invalidateByEvent('other:event');
        assert.equal(rc.has('static:demo:/keep'), true);
    });
});


// ---------------------------------------------------------------------------
// 06 — clear + stats classification
// ---------------------------------------------------------------------------
describe('06 - clear + stats', function () {
    var rc;
    beforeEach(function () { rc = freshRc(); });
    afterEach(function () { try { rc.clear(); } catch (e) {} });

    it('clear empties the store', async function () {
        await rc.set('memory', 'static:demo:/1', {}, { content: 'a' });
        await rc.set('memory', 'static:demo:/2', {}, { content: 'b' });
        rc.clear();
        assert.equal(rc.has('static:demo:/1'), false);
        assert.equal(rc.has('static:demo:/2'), false);
        assert.equal(rc.stats().size, 0);
    });

    it('stats classifies memory vs fs entries', async function () {
        await rc.set('memory', 'static:demo:/m', {}, { content: 'm' });
        await rc.set('fs', 'static:demo:/f', {}, { content: 'f', path: tmpRoot, bundle: 'statsbundle', url: '/f', kind: 'html' });

        var byKey = {};
        rc.stats().entries.forEach(function (e) { byKey[e.key] = e.type; });
        assert.equal(byKey['static:demo:/m'], 'memory');
        assert.equal(byKey['static:demo:/f'], 'fs');
    });
});


// ---------------------------------------------------------------------------
// 07 — fs restart-hardening: disk read-back on a Map miss (Slice 1)
//
// After a restart the backing Map is empty, so every fs-cached file on disk was
// previously orphaned (has() was Map-only). With a cache root configured via
// from(store, cachePath), has()/get() fall back to the disk body + its .meta
// sidecar, preserving the ORIGINAL absolute expiry (a restart never extends a
// TTL). The lib/cache Map is a process singleton, so a fresh Map == post-restart.
// ---------------------------------------------------------------------------
describe('07 - fs restart-hardening (disk read-back)', function () {
    // Raw lib/cache for the subtract (proves the disk-aware layer is load-bearing).
    var Cache = require(path.join(FW, 'lib/cache/src/main'));

    // Simulate elapsed wall-clock between write and restart by backdating the
    // on-disk .meta createdAt — deterministic, no sleeping.
    function backdateMeta(bodyFile, secondsAgo) {
        var meta = JSON.parse(fs.readFileSync(bodyFile + '.meta', 'utf8'));
        meta.createdAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
        fs.writeFileSync(bodyFile + '.meta', JSON.stringify(meta));
    }

    it('set(fs) writes a .meta sidecar carrying the replay metadata', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/meta';
        await rc.set('fs', key, { ttl: 30, visibility: 'public', responseHeaders: { 'content-type': 'text/html' } },
            { content: '<b>m</b>', path: tmpRoot, bundle: 'rh', url: '/meta', kind: 'html' });

        var file = String(rc.get(key).filename);
        assert.equal(fs.existsSync(file + '.meta'), true, 'the .meta sidecar exists next to the body');
        var meta = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'));
        assert.equal(meta.ttl, 30);
        assert.equal(meta.sliding, false);
        assert.equal(meta.visibility, 'public');
        assert.equal(meta.responseHeaders['content-type'], 'text/html', 'responseHeaders replayed');
        assert.ok(!isNaN(new Date(meta.createdAt).getTime()), 'createdAt is a parseable ISO stamp');
        rc.clear();
    });

    it('recovers an orphaned disk entry: fresh Map + cachePath → has()/get() read back', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/page';
        await rc.set('fs', key, { ttl: 300, visibility: 'public' },
            { content: '<h1>page</h1>', path: tmpRoot, bundle: 'rh', url: '/page', kind: 'html' });
        var file = String(rc.get(key).filename);
        assert.equal(fs.existsSync(file), true);

        // Post-restart: a fresh empty Map (the process singleton), cache root configured.
        rc.from(new Map(), tmpRoot);

        assert.equal(rc.has(key), true, 'has() sees the disk body after a restart');
        var entry = rc.get(key);
        assert.ok(entry, 'get() reconstructs the entry from disk');
        assert.equal(String(entry.filename), file, 'filename preserved');
        assert.equal(entry.visibility, 'public', 'visibility replayed from .meta');
        assert.equal(entry.sliding, undefined, 'non-sliding stays non-sliding');
        assert.ok(entry.createdAt instanceof Date, 're-stamped createdAt (repopulated into the Map)');

        // Now a Map hit — a subsequent get() no longer touches disk.
        assert.equal(rc.stats().size, 1, 'the read-back repopulated the Map');
        rc.clear();
    });

    it('SUBTRACT — without the disk-aware layer a fresh Map orphans the entry', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/orphan';
        await rc.set('fs', key, { ttl: 300 },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/orphan', kind: 'html' });

        var freshMap = new Map();
        rc.from(freshMap, tmpRoot);            // dispatcher: disk-aware
        var raw = new Cache();
        raw.from(freshMap);                     // raw lib/cache: Map-only (the pre-fix behaviour)

        assert.equal(raw.has(key), false, 'raw Map-only has() → orphaned after restart');
        assert.equal(raw.get(key), undefined, 'raw Map-only get() → orphaned after restart');
        assert.equal(rc.has(key), true, 'the dispatcher recovers it from disk');
        assert.ok(rc.get(key), 'the dispatcher reconstructs it from disk');
        rc.clear();
    });

    it('read-back is INERT without a configured cache root (delegate semantics)', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/nopath';
        await rc.set('fs', key, { ttl: 300 },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/nopath', kind: 'html' });
        var file = String(rc.get(key).filename);
        assert.equal(fs.existsSync(file), true, 'the disk file exists');

        rc.from(new Map());                     // fresh Map, NO cachePath (how the delegates call from())
        assert.equal(rc.has(key), false, 'Map-only has() — no disk fallback without a root');
        assert.equal(rc.get(key), undefined, 'Map-only get() — no disk fallback without a root');
        rc.clear();
    });

    it('preserves ABSOLUTE expiry on read-back (non-sliding: ttl → remaining)', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/ttl';
        await rc.set('fs', key, { ttl: 30 },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/ttl', kind: 'html' });
        var file = String(rc.get(key).filename);
        backdateMeta(file, 20);                 // written 20 s ago; ttl 30 → ~10 s left

        rc.from(new Map(), tmpRoot);
        var entry = rc.get(key);
        assert.ok(entry, 'still valid (10 s remaining)');
        // Restart must NOT reset the 30 s window: remaining ≈ 10 (not 30).
        assert.ok(entry.ttl > 7 && entry.ttl < 13, 'ttl reduced to the remaining window, got ' + entry.ttl);
        rc.clear();
    });

    it('drops an already-expired non-sliding entry on read-back (miss + files removed)', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/expired';
        await rc.set('fs', key, { ttl: 30 },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/expired', kind: 'html' });
        var file = String(rc.get(key).filename);
        backdateMeta(file, 40);                 // written 40 s ago; ttl 30 → expired

        rc.from(new Map(), tmpRoot);
        assert.equal(rc.get(key), undefined, 'expired entry is a miss');
        assert.equal(fs.existsSync(file), false, 'stale body removed on read-back');
        assert.equal(fs.existsSync(file + '.meta'), false, 'stale .meta removed on read-back');
        rc.clear();
    });

    it('preserves the absolute CEILING on read-back (sliding + maxAge)', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/sliding';
        await rc.set('fs', key, { ttl: 30, sliding: true, maxAge: 300 },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/sliding', kind: 'html' });
        var file = String(rc.get(key).filename);
        backdateMeta(file, 20);                 // 20 s into the 300 s ceiling

        rc.from(new Map(), tmpRoot);
        var entry = rc.get(key);
        assert.ok(entry, 'still within the ceiling');
        assert.equal(entry.sliding, true);
        assert.equal(entry.ttl, 30, 'the idle window restarts on the read-back access (ttl unchanged)');
        // ceiling remaining ≈ 280 (not reset to 300); lib/cache computed expiresAt from it.
        assert.ok(entry.maxAge > 277 && entry.maxAge < 283, 'maxAge reduced to the remaining ceiling, got ' + entry.maxAge);
        assert.ok(entry.expiresAt instanceof Date, 'the ceiling timer was honoured by lib/cache');
        rc.clear();
    });

    it('drops a sliding entry past its absolute ceiling on read-back', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/ceiling';
        await rc.set('fs', key, { ttl: 30, sliding: true, maxAge: 300 },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/ceiling', kind: 'html' });
        var file = String(rc.get(key).filename);
        backdateMeta(file, 320);                // past the 300 s ceiling

        rc.from(new Map(), tmpRoot);
        assert.equal(rc.get(key), undefined, 'past-ceiling entry is a miss');
        assert.equal(fs.existsSync(file), false, 'stale body removed');
        rc.clear();
    });

    it('pure sliding (no maxAge) read-back is treated as a fresh access', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/pure';
        await rc.set('fs', key, { ttl: 30, sliding: true },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/pure', kind: 'html' });
        var file = String(rc.get(key).filename);
        backdateMeta(file, 999);                // long idle — but no persisted lastAccess to judge it

        rc.from(new Map(), tmpRoot);
        var entry = rc.get(key);
        assert.ok(entry, 'pure-sliding recovers (documented restart imprecision)');
        assert.equal(entry.sliding, true);
        assert.equal(entry.ttl, 30, 'idle window restarts');
        assert.equal(entry.maxAge, undefined, 'no ceiling');
        assert.equal(entry.expiresAt, undefined, 'no absolute ceiling stamped');
        rc.clear();
    });

    it('missing .meta sidecar → get() miss (self-heals on the next render)', async function () {
        var rc  = freshRc();
        var key = 'static:rh:/nometa';
        await rc.set('fs', key, { ttl: 300 },
            { content: 'x', path: tmpRoot, bundle: 'rh', url: '/nometa', kind: 'html' });
        var file = String(rc.get(key).filename);
        fs.rmSync(file + '.meta');              // body present, sidecar gone

        rc.from(new Map(), tmpRoot);
        assert.equal(rc.has(key), true, 'has() is lenient (body exists)');
        assert.equal(rc.get(key), undefined, 'get() cannot replay expiry without the sidecar → miss');
        rc.clear();
    });
});
