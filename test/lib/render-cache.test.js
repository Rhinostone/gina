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
 *
 * ⚠️ ANY test that calls set() with a `ttl` MUST enable node's mock timers first
 * (`function (t) { t.mock.timers.enable(['setTimeout']); ... }`, the idiom in
 * test/lib/cache.test.js). lib/cache.set() arms a REAL setTimeout(ttl * 1000) per
 * entry and stores the handle ON the entry, so only a delete()/clear() of THAT
 * entry can clearTimeout it. But `cache` is a module-scope var that `from()`
 * REASSIGNS process-wide — so a `from(new Map())` restart-swap (which most of the
 * fs tests below do, by design) strands the handle on the discarded Map, where
 * clear() can never reach it. The timer then holds the event loop open for its
 * whole TTL and `node --test` never exits this FILE. An afterEach drain does NOT
 * fix it; --test-force-exit only MASKS it. Mock timers make the strand impossible:
 * the real loop never sees a timer at all, and every ttl assertion still holds.
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
        await rc.set('memcached', 'static:demo:/r', {}, { content: 'x', path: tmpRoot, bundle: 'demo', url: '/r', kind: 'html' });
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

    it('set(fs) writes a .meta sidecar carrying the replay metadata', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('recovers an orphaned disk entry: fresh Map + cachePath → has()/get() read back', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('SUBTRACT — without the disk-aware layer a fresh Map orphans the entry', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('read-back is INERT without a configured cache root (delegate semantics)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('preserves ABSOLUTE expiry on read-back (non-sliding: ttl → remaining)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('drops an already-expired non-sliding entry on read-back (miss + files removed)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('preserves the absolute CEILING on read-back (sliding + maxAge)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('drops a sliding entry past its absolute ceiling on read-back', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('pure sliding (no maxAge) read-back is treated as a fresh access', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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

    it('missing .meta sidecar → get() miss (self-heals on the next render)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
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


// ---------------------------------------------------------------------------
// 08 — release-namespaced keys: buildKey + fs cross-namespace invalidation (Slice 2)
//
// buildKey prepends GINA_CACHE_NAMESPACE || GINA_VERSION (sanitized) so a
// redeploy / framework upgrade auto-invalidates the cache; the token is also an
// fs path segment (<bundle>/<token>/…) so a namespace change lands NEW files in
// a fresh dir and the read-back never serves cross-namespace stale content.
// getEnvVar/setEnvVar are injected by require(FW+'/helpers'); in this harness
// both env keys start unset → the flat, pre-namespace format (back-compat).
// ---------------------------------------------------------------------------
describe('08 - release-namespaced keys (buildKey + fs invalidation)', function () {
    var rc;
    beforeEach(function () { rc = freshRc(); });
    afterEach(function () {
        try { rc.clear(); } catch (e) {}
        // Reset the env so a namespace never leaks into the next test.
        if (process.gina) { delete process.gina.GINA_CACHE_NAMESPACE; delete process.gina.GINA_VERSION; }
    });

    it('buildKey with no namespace env → flat kind:bundle:url (back-compat)', function () {
        assert.equal(rc.buildKey('static', 'demo', '/page'), 'static:demo:/page');
        assert.equal(rc.buildKey('data', 'demo', '/api'), 'data:demo:/api');
    });

    it('buildKey prepends GINA_CACHE_NAMESPACE', function () {
        setEnvVar('GINA_CACHE_NAMESPACE', 'rel1');
        assert.equal(rc.buildKey('static', 'demo', '/page'), 'rel1:static:demo:/page');
    });

    it('buildKey falls back to GINA_VERSION when the namespace is unset', function () {
        setEnvVar('GINA_VERSION', '0.5.18-alpha.2');
        assert.equal(rc.buildKey('static', 'demo', '/'), '0.5.18-alpha.2:static:demo:/');
    });

    it('GINA_CACHE_NAMESPACE wins over GINA_VERSION', function () {
        setEnvVar('GINA_VERSION', '0.5.18-alpha.2');
        setEnvVar('GINA_CACHE_NAMESPACE', 'deploy-42');
        assert.equal(rc.buildKey('data', 'demo', '/x'), 'deploy-42:data:demo:/x');
    });

    it('sanitizes an unsafe namespace to a path/key-safe identifier', function () {
        setEnvVar('GINA_CACHE_NAMESPACE', 'a/b:c d');            // slash, colon, space → _
        assert.equal(rc.buildKey('static', 'demo', '/p'), 'a_b_c_d:static:demo:/p');
    });

    it('fs write + read-back under a namespace: file lives in the <token> dir', async function (t) {
        t.mock.timers.enable(['setTimeout']);
        setEnvVar('GINA_CACHE_NAMESPACE', 'relA');
        var key = rc.buildKey('static', 'nsbundle', '/page');   // relA:static:nsbundle:/page
        await rc.set('fs', key, { ttl: 300 }, { content: '<h1>ns</h1>', path: tmpRoot, bundle: 'nsbundle', url: '/page', kind: 'html' });
        var file = String(rc.get(key).filename);
        assert.ok(file.endsWith('/nsbundle/relA/html/page.html'), 'token is a path segment: ' + file);
        assert.equal(fs.existsSync(file), true);

        // Post-restart read-back under the SAME namespace recovers it.
        rc.from(new Map(), tmpRoot);
        assert.equal(rc.has(key), true);
        assert.ok(rc.get(key), 'read-back reconstructs the namespaced entry');
        rc.clear();
    });

    it('a namespace change INVALIDATES the fs read-back (different <token> dir)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
        // Write under relA.
        setEnvVar('GINA_CACHE_NAMESPACE', 'relA');
        var keyA = rc.buildKey('static', 'inv', '/page');       // relA:static:inv:/page
        await rc.set('fs', keyA, { ttl: 300 }, { content: 'OLD', path: tmpRoot, bundle: 'inv', url: '/page', kind: 'html' });
        var fileA = String(rc.get(keyA).filename);
        assert.ok(fileA.endsWith('/inv/relA/html/page.html'));

        // Redeploy: namespace → relB. setEnvVar refuses to overwrite an existing
        // value (a real redeploy is a fresh process), so clear it first.
        delete process.gina.GINA_CACHE_NAMESPACE;
        setEnvVar('GINA_CACHE_NAMESPACE', 'relB');
        rc.from(new Map(), tmpRoot);
        var keyB = rc.buildKey('static', 'inv', '/page');       // relB:static:inv:/page
        assert.notEqual(keyB, keyA, 'the key changed with the namespace');
        assert.equal(rc.has(keyB), false, 'no relB file → read-back misses (invalidated)');
        assert.equal(rc.get(keyB), undefined, 'the old relA content is NOT served under relB');
        // The relA file is untouched on disk (orphaned; Slice 3 flush cleans it).
        assert.equal(fs.existsSync(fileA), true, 'old-namespace file orphaned, not overwritten');
        rc.clear();
    });

    it('write path == read-back path under a namespace (parseFsKey round-trip)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
        // The whole feature hinges on the write filename (set, token from the key)
        // and the read-back filename (get→fsBodyFor, token from the key) agreeing.
        setEnvVar('GINA_CACHE_NAMESPACE', 'rt');
        var key = rc.buildKey('data', 'rtb', '/api/users');     // rt:data:rtb:/api/users
        await rc.set('fs', key, { ttl: 300 }, { content: '{"ok":1}', path: tmpRoot, bundle: 'rtb', url: '/api/users', kind: 'data' });
        var written = String(rc.get(key).filename);
        assert.ok(written.endsWith('/rtb/rt/data/api/users.json'), 'namespaced data path: ' + written);

        rc.from(new Map(), tmpRoot);                            // restart
        var back = rc.get(key);
        assert.ok(back, 'read-back finds the same namespaced file');
        assert.equal(String(back.filename), written, 'write path == read-back path');
        rc.clear();
    });
});


// ---------------------------------------------------------------------------
// 09 — cross-strategy flush: scoped clear(bundle?) + clearFsBundle (Slice 3)
//
// clear() is re-scoped to the output namespaces (static:/data:, across every
// release token in the Map) and optionally filtered by bundle — it NEVER touches
// swig: (compiled templates) or http2session: entries. Each match routes through
// delete() so its timer is cleared AND its cleanup fn runs (fs body + .meta).
// clearFsBundle() is the OFFLINE disk-reclamation counterpart: it removes a
// bundle's render-output dirs (html/data + token dirs) directly — reclaiming
// old-namespace orphans a Map-scoped clear() cannot reach — while preserving the
// config/ (routing) + swig/ (layout) infra caches.
// ---------------------------------------------------------------------------
describe('09 - cross-strategy flush (scoped clear + clearFsBundle)', function () {
    var Cache = require(path.join(FW, 'lib/cache/src/main'));

    afterEach(function () {
        if (process.gina) { delete process.gina.GINA_CACHE_NAMESPACE; delete process.gina.GINA_VERSION; }
    });

    it('clear() removes ALL output-namespace entries and returns the count', async function () {
        var rc = freshRc();
        await rc.set('memory', 'static:demo:/a', {}, { content: 'a' });
        await rc.set('memory', 'data:demo:/b',   {}, { content: 'b' });
        var n = rc.clear();
        assert.equal(n, 2, 'returns the number removed');
        assert.equal(rc.has('static:demo:/a'), false);
        assert.equal(rc.has('data:demo:/b'), false);
        assert.equal(rc.stats().size, 0);
    });

    it('clear() NEVER evicts swig: / http2session: entries', async function () {
        var shared = new Map();
        var rc  = new RenderCache({ store: shared });
        var raw = new Cache(); raw.from(shared);            // same module-singleton Map
        raw.set('swig:layouts/main',          { compiled: true });
        raw.set('http2session:host.example',  { session: true });
        await rc.set('memory', 'static:demo:/x', {}, { content: 'x' });

        var n = rc.clear();
        assert.equal(n, 1, 'only the one output entry was removed');
        assert.equal(shared.has('swig:layouts/main'), true, 'compiled template survives');
        assert.equal(shared.has('http2session:host.example'), true, 'http2 session survives');
        assert.equal(shared.has('static:demo:/x'), false, 'output entry flushed');
        rc.clear();
    });

    it('clear(bundle) flushes only that bundle; other bundles survive', async function () {
        var rc = freshRc();
        await rc.set('memory', 'static:alpha:/1', {}, { content: '1' });
        await rc.set('memory', 'data:alpha:/2',   {}, { content: '2' });
        await rc.set('memory', 'static:beta:/3',  {}, { content: '3' });

        var n = rc.clear('alpha');
        assert.equal(n, 2, 'both alpha entries removed');
        assert.equal(rc.has('static:alpha:/1'), false);
        assert.equal(rc.has('data:alpha:/2'), false);
        assert.equal(rc.has('static:beta:/3'), true, 'beta untouched');
        rc.clear();
    });

    it('clear(bundle) matches the bundle segment across release tokens', async function () {
        var rc = freshRc();
        await rc.set('memory', 'static:demo:/flat',       {}, { content: 'f' });   // empty-token
        await rc.set('memory', 'relX:static:demo:/nsd',   {}, { content: 'n' });   // namespaced
        await rc.set('memory', 'relX:static:other:/keep', {}, { content: 'k' });

        var n = rc.clear('demo');
        assert.equal(n, 2, 'both demo tokens removed');
        assert.equal(rc.has('static:demo:/flat'), false);
        assert.equal(rc.has('relX:static:demo:/nsd'), false);
        assert.equal(rc.has('relX:static:other:/keep'), true, 'other bundle untouched');
        rc.clear();
    });

    it('clear() runs the fs cleanup fn (current-namespace body + .meta removed)', async function (t) {
        t.mock.timers.enable(['setTimeout']);
        var rc  = freshRc();
        var key = 'static:fsc:/page';
        await rc.set('fs', key, { ttl: 300 }, { content: 'x', path: tmpRoot, bundle: 'fsc', url: '/page', kind: 'html' });
        var file = String(rc.get(key).filename);
        assert.equal(fs.existsSync(file), true);
        assert.equal(fs.existsSync(file + '.meta'), true);

        var n = rc.clear('fsc');
        assert.equal(n, 1);
        assert.equal(fs.existsSync(file), false, 'body removed by cleanup fn');
        assert.equal(fs.existsSync(file + '.meta'), false, '.meta removed by cleanup fn');
    });

    it('clear() returns 0 on an empty store / an unmatched bundle', function () {
        var rc = freshRc();
        assert.equal(rc.clear(), 0);
        assert.equal(rc.clear('nope'), 0);
    });

    // --- clearFsBundle (offline disk reclamation) --------------------------
    function seedBundleTree(root, bundle) {
        // render output: empty-token html/data + a namespaced (orphaned) token dir
        fs.mkdirSync(path.join(root, bundle, 'html'), { recursive: true });
        fs.writeFileSync(path.join(root, bundle, 'html', 'page.html'), 'H');
        fs.mkdirSync(path.join(root, bundle, 'data'), { recursive: true });
        fs.writeFileSync(path.join(root, bundle, 'data', 'api.json'), '{}');
        fs.mkdirSync(path.join(root, bundle, 'relOLD', 'html'), { recursive: true });
        fs.writeFileSync(path.join(root, bundle, 'relOLD', 'html', 'old.html'), 'OLD');
        // infra caches — must survive
        fs.mkdirSync(path.join(root, bundle, 'config'), { recursive: true });
        fs.writeFileSync(path.join(root, bundle, 'config', 'routing.json'), '{}');
        fs.mkdirSync(path.join(root, bundle, 'swig', 'layouts'), { recursive: true });
        fs.writeFileSync(path.join(root, bundle, 'swig', 'layouts', 'main.html'), 'L');
    }

    it('clearFsBundle removes render-output dirs (html/data + token) and preserves config/swig', function () {
        var rc   = freshRc();
        var root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-fsb-'));
        seedBundleTree(root, 'b1');

        var removed = rc.clearFsBundle(root, 'b1');
        assert.equal(fs.existsSync(path.join(root, 'b1', 'html')),   false, 'html render dir removed');
        assert.equal(fs.existsSync(path.join(root, 'b1', 'data')),   false, 'data render dir removed');
        assert.equal(fs.existsSync(path.join(root, 'b1', 'relOLD')), false, 'orphaned token dir removed');
        assert.equal(fs.existsSync(path.join(root, 'b1', 'config', 'routing.json')),      true, 'routing cache preserved');
        assert.equal(fs.existsSync(path.join(root, 'b1', 'swig', 'layouts', 'main.html')), true, 'swig layout cache preserved');
        assert.equal(removed.length, 3, 'reports the three removed dirs');
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('clearFsBundle on a missing bundle dir / empty args is a no-op (returns [])', function () {
        var rc = freshRc();
        assert.deepEqual(rc.clearFsBundle(tmpRoot, 'does-not-exist'), []);
        assert.deepEqual(rc.clearFsBundle('', 'x'), []);
        assert.deepEqual(rc.clearFsBundle(tmpRoot, ''), []);
    });

    it('clearFsBundle({dryRun}) reports the SAME set it would remove, but removes nothing', function () {
        var rc   = freshRc();
        var root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-dry-'));
        seedBundleTree(root, 'b2');

        var preview = rc.clearFsBundle(root, 'b2', { dryRun: true });
        assert.equal(preview.length, 3, 'previews the three render dirs');
        assert.equal(fs.existsSync(path.join(root, 'b2', 'html')),   true, 'dry run removed nothing');
        assert.equal(fs.existsSync(path.join(root, 'b2', 'data')),   true);
        assert.equal(fs.existsSync(path.join(root, 'b2', 'relOLD')), true);

        // The preview and the real run resolve the same set from the same code —
        // so a --dry-run can never disagree with what a real run does.
        var removed = rc.clearFsBundle(root, 'b2');
        assert.deepEqual(removed.sort(), preview.sort(), 'dry-run preview == real removal set');
        assert.equal(fs.existsSync(path.join(root, 'b2', 'html')), false, 'real run removed them');
        assert.equal(fs.existsSync(path.join(root, 'b2', 'config', 'routing.json')), true, 'config still preserved');
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('SUBTRACT — a Map-scoped clear() leaves the old-namespace orphan that clearFsBundle reclaims', async function (t) {
        t.mock.timers.enable(['setTimeout']);
        var rc   = freshRc();
        var root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-orphan-'));
        setEnvVar('GINA_CACHE_NAMESPACE', 'relOLD');
        var keyOld  = rc.buildKey('static', 'orph', '/p');          // relOLD:static:orph:/p
        await rc.set('fs', keyOld, { ttl: 300 }, { content: 'OLD', path: root, bundle: 'orph', url: '/p', kind: 'html' });
        var oldFile = String(rc.get(keyOld).filename);
        var oldDir  = path.join(root, 'orph', 'relOLD');
        assert.equal(fs.existsSync(oldDir), true, 'relOLD dir written');

        // Redeploy: fresh process → fresh (empty) Map + a new namespace. The old
        // entry is no longer in the Map, so a Map-scoped clear() cannot reach it.
        delete process.gina.GINA_CACHE_NAMESPACE;
        setEnvVar('GINA_CACHE_NAMESPACE', 'relNEW');
        rc.from(new Map(), root);
        assert.equal(rc.clear('orph'), 0, 'Map-scoped clear removes nothing (fresh Map)');
        assert.equal(fs.existsSync(oldFile), true, 'the orphaned old-namespace file survives the Map clear');

        rc.clearFsBundle(root, 'orph');
        assert.equal(fs.existsSync(oldDir), false, 'clearFsBundle reclaims the orphaned token dir');
        fs.rmSync(root, { recursive: true, force: true });
    });
});


// ---------------------------------------------------------------------------
// 10 — event invalidation: the firing half + restart survival
//
// Registration (setEvents) always worked; nothing ever FIRED it, so a route's
// `cache.invalidateOnEvents` was inert end-to-end. This section covers the
// firing contract, the count the flush endpoint reports, and the `fs` half —
// an entry read back from disk after a restart must come back WITH its
// registrations, or firing the event silently fails to evict it.
// ---------------------------------------------------------------------------
describe('10 - event invalidation (firing + restart survival)', function () {

    var root, stores;
    beforeEach(function () {
        root   = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-events-'));
        stores = [];
    });
    afterEach(function () {
        // Drain every entry (and the setTimeout(ttl) lib/cache armed for it) — an
        // un-evicted entry would otherwise hold the event loop open for its whole TTL
        // and hang the file, since node --test waits for the loop to drain.
        stores.forEach(function (st) { try { new RenderCache().from(st).clear(); } catch (e) {} });
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
    });

    // A dispatcher whose backing Map is registered for teardown.
    function rcOn(cachePath) {
        var store = new Map();
        stores.push(store);
        return new RenderCache().from(store, cachePath);
    }

    it('invalidateByEvent returns the number of entries evicted', async function () {
        var rc = rcOn();
        var keys = ['/a', '/b', '/c'].map(function (u) {
            var k = rc.buildKey('static', 'demo', u);
            rc.set('memory', k, { ttl: 60 }, { content: u });
            rc.setEvents(k, ['bulk#evt']);
            return k;
        });

        assert.equal(rc.invalidateByEvent('bulk#evt'), 3);
        keys.forEach(function (k) { assert.equal(rc.has(k), false); });

        // Registrations are reclaimed with their entries → a re-fire evicts nothing.
        assert.equal(rc.invalidateByEvent('bulk#evt'), 0);
        assert.equal(rc.invalidateByEvent('never#registered'), 0);
    });

    it('an unrelated event evicts nothing', function () {
        var rc = rcOn();
        var k  = rc.buildKey('static', 'demo', '/keep');
        rc.set('memory', k, { ttl: 60 }, { content: 'keep' });
        rc.setEvents(k, ['mine#evt']);

        assert.equal(rc.invalidateByEvent('other#evt'), 0);
        assert.ok(rc.get(k), 'the entry must survive an event it is not registered to');
    });

    // A cached URL carries its querystring into the key, so keys routinely hold
    // `?`/`=`. Re-registering against such a key used to THROW inside the dedup
    // lookup — and in render-swig that throw rejects `await writeCache(...)`,
    // which sits BEFORE res.end(), so the request would hang. This is the exact
    // production sequence: miss → TTL expiry → miss.
    it('a querystring key survives the miss → expiry → miss cycle', function () {
        var rc  = rcOn();
        var key = rc.buildKey('static', 'demo', '/invoice/9?v=2&sort=asc');

        rc.set('memory', key, { ttl: 60 }, { content: 'v1' });
        rc.setEvents(key, ['invoice#saved']);

        rc.delete(key);                       // TTL expiry

        assert.doesNotThrow(function () {     // the re-render that used to hang the request
            rc.set('memory', key, { ttl: 60 }, { content: 'v2' });
            rc.setEvents(key, ['invoice#saved']);
        });
        assert.equal(rc.invalidateByEvent('invoice#saved'), 1);
    });

    it('fs: setEvents persists the events into the .meta sidecar', async function () {
        var rc  = rcOn(root);
        var key = rc.buildKey('static', 'demo', '/inv?v=2');
        await rc.set('fs', key, { ttl: 600, visibility: 'public', responseHeaders: {} },
                     { content: '<h1>inv</h1>', path: root, bundle: 'demo', url: '/inv?v=2', kind: 'html' });
        await rc.setEvents(key, ['invoice#saved']);

        var meta = JSON.parse(fs.readFileSync(rc.get(key).filename + '.meta', 'utf8'));
        assert.deepEqual(meta.events, ['invoice#saved']);
    });

    it('fs: a restart read-back restores the registration, and evicting removes the files', async function () {
        var rc  = rcOn(root);
        var key = rc.buildKey('static', 'demo', '/inv?v=2');
        await rc.set('fs', key, { ttl: 600, visibility: 'public', responseHeaders: {} },
                     { content: '<h1>inv</h1>', path: root, bundle: 'demo', url: '/inv?v=2', kind: 'html' });
        await rc.setEvents(key, ['invoice#saved']);
        var body = String(rc.get(key).filename);

        // Restart: a fresh (empty) Map, same disk.
        var restarted = rcOn(root);
        assert.equal(restarted.has(key), true, 'served from disk after the restart');
        assert.ok(restarted.get(key), 'read-back repopulates the Map');

        assert.equal(restarted.invalidateByEvent('invoice#saved'), 1,
            'the registration must survive the restart');
        assert.equal(restarted.get(key), undefined, 'entry evicted from the heap');
        assert.equal(fs.existsSync(body), false, 'fs body removed');
        assert.equal(fs.existsSync(body + '.meta'), false, 'sidecar removed');
    });

    // SUBTRACT: strip `events` from the sidecar (a pre-fix sidecar) and the
    // restored entry comes back with NO registration — proving meta.events is
    // what carries the contract across a restart.
    it('fs: a sidecar without events restores nothing (subtract)', async function () {
        var rc  = rcOn(root);
        var key = rc.buildKey('static', 'demo', '/sub');
        await rc.set('fs', key, { ttl: 600, visibility: 'public', responseHeaders: {} },
                     { content: 'x', path: root, bundle: 'demo', url: '/sub', kind: 'html' });
        await rc.setEvents(key, ['e#x']);

        var metaPath = rc.get(key).filename + '.meta';
        var meta     = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        delete meta.events;
        fs.writeFileSync(metaPath, JSON.stringify(meta));

        var restarted = rcOn(root);
        restarted.get(key);                                    // read back
        assert.equal(restarted.invalidateByEvent('e#x'), 0,
            'without meta.events the restored entry is not registered');
    });

    it('memory entries never touch the sidecar path', async function () {
        var rc  = rcOn(root);
        var key = rc.buildKey('static', 'demo', '/mem');
        await rc.set('memory', key, { ttl: 60 }, { content: 'm' });
        await rc.setEvents(key, ['m#evt']);         // must not throw, must write no file

        assert.equal(fs.existsSync(path.join(root, 'demo')), false);
        assert.equal(rc.invalidateByEvent('m#evt'), 1);
    });
});


// ---------------------------------------------------------------------------
// 11 — redis L2 strategy (render-cache Slice 4)
// ---------------------------------------------------------------------------
//
// Behavioral coverage of the redis integration: set('redis') writes L1
// synchronously + L2 fire-and-forget; warm() reads L2 back on an L1 miss,
// repopulates L1 with the authoritative remaining PTTL, and re-registers the
// route's invalidateOnEvents (the events param — a warmed entry skipped the
// delegate's setEvents, so without it the entry could not be event-evicted);
// delete/clear/invalidateByEvent DEL the L2 keys (B1); fail-open throughout (a
// rejecting L2 never reaches the caller). Drives the REAL RenderCache with an
// injected fake L2 store (the seam lib/render-cache-store builds:
// set/warmRead/del), plus the process.gina._renderCacheStore lazy-resolution path.
//
// ⚠️ set('redis',…,{ttl}) and warm() with a ttl BOTH arm a real setTimeout via
// mem.set (the L1 timer) — so every test that seeds a ttl'd entry enables node
// mock timers first (the file-header idiom), or the strand hangs the file.
describe('11 - redis L2 strategy', function () {

    // A synchronous fake of the render-cache-store seam. Records every call and
    // applies state synchronously (like the real store's fake ioredis), so a
    // fire-and-forget write is observable right after an `await rc.set(...)`.
    function fakeL2() {
        var s = {
            strings: Object.create(null),
            pttls:   Object.create(null),   // key -> ms (>0) or -1 (no expiry)
            calls:   { set: [], warmRead: [], del: [] },
            failSet: null, failWarm: null, failDel: null,
            set: function (key, value, ttlMs) {
                s.calls.set.push({ key: key, value: value, ttlMs: ttlMs });
                if (s.failSet) return Promise.reject(s.failSet);
                s.strings[key] = value;
                s.pttls[key]   = (ttlMs && ttlMs > 0) ? ttlMs : -1;
                return Promise.resolve();
            },
            warmRead: function (key) {
                s.calls.warmRead.push(key);
                if (s.failWarm) return Promise.reject(s.failWarm);
                if (!(key in s.strings)) return Promise.resolve(null);
                return Promise.resolve({
                    value: s.strings[key],
                    ttlMs: (s.pttls[key] > 0) ? s.pttls[key] : null
                });
            },
            del: function (key) {
                s.calls.del.push(key);
                if (s.failDel) return Promise.reject(s.failDel);
                var existed = (key in s.strings);
                delete s.strings[key];
                delete s.pttls[key];
                return Promise.resolve(existed ? 1 : 0);
            }
        };
        return s;
    }

    function rcRedis(l2) {
        var rc = new RenderCache({ l2: l2 });
        rc.from(new Map());
        return rc;
    }

    // Any test that stashes on process.gina must restore it.
    var _prevStore;
    beforeEach(function () {
        _prevStore = (process.gina && process.gina._renderCacheStore);
    });
    afterEach(function () {
        if (process.gina) {
            if (typeof _prevStore === 'undefined') { delete process.gina._renderCacheStore; }
            else { process.gina._renderCacheStore = _prevStore; }
        }
    });

    // --- set('redis') ------------------------------------------------------

    it('set(redis) writes L1 (fromMemory + content) AND L2 (JSON body, PSETEX ms)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2 = fakeL2();
        var rc = rcRedis(l2);
        var key = rc.buildKey('static', 'demo', '/p');
        return rc.set('redis', key, { ttl: 60, visibility: 'public', responseHeaders: { 'x': '1' } },
                      { content: 'HTML' }).then(function () {
            // L1
            var hit = rc.get(key);
            assert.equal(hit.fromMemory, true);
            assert.equal(hit.content, 'HTML');
            // L2 (fire-and-forget, but the fake records synchronously)
            assert.equal(l2.calls.set.length, 1);
            assert.equal(l2.calls.set[0].key, key);
            assert.equal(l2.calls.set[0].ttlMs, 60000, 'ttl seconds → PSETEX ms');
            assert.deepEqual(JSON.parse(l2.calls.set[0].value),
                { content: 'HTML', responseHeaders: { 'x': '1' }, visibility: 'public' },
                'L2 stores only content + headers + visibility — never a filename');
        });
    });

    it('set(redis) with no ttl → L2 ttlMs null (plain SET, no expiry)', function () {
        var l2 = fakeL2();
        var rc = rcRedis(l2);
        var key = rc.buildKey('static', 'demo', '/noexp');
        return rc.set('redis', key, { visibility: 'private', responseHeaders: {} },
                      { content: 'X' }).then(function () {
            assert.equal(l2.calls.set[0].ttlMs, null);
        });
    });

    it('set(redis) is fail-open: a rejecting L2 write never rejects set()', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2 = fakeL2();
        l2.failSet = new Error('DOWN');
        var rc = rcRedis(l2);
        var key = rc.buildKey('static', 'demo', '/fo');
        return rc.set('redis', key, { ttl: 30, responseHeaders: {} }, { content: 'Y' })
            .then(function () {
                // L1 still holds it — per-replica caching survives an L2 outage.
                assert.equal(rc.get(key).content, 'Y');
            });
    });

    it('set(redis) with no L2 configured → L1-only, no throw', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var rc = rcRedis(null);   // options.l2 null, process stash absent
        var key = rc.buildKey('static', 'demo', '/l1only');
        return rc.set('redis', key, { ttl: 10, responseHeaders: {} }, { content: 'Z' })
            .then(function () {
                assert.equal(rc.get(key).content, 'Z');
            });
    });

    // --- warm() ------------------------------------------------------------

    it('warm() reads L2 → memory-shaped entry, populates L1, ttl from PTTL', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2 = fakeL2();
        var key = 'static:demo:/w';
        // Seed L2 directly (as another replica would have).
        l2.strings[key] = JSON.stringify({ content: 'FROM_L2', responseHeaders: { 'c': 'x' }, visibility: 'public' });
        l2.pttls[key]   = 45000;   // 45s remaining

        var rc = rcRedis(l2);      // fresh L1 (empty)
        assert.equal(rc.has(key), false, 'L1 starts empty');

        return rc.warm(key).then(function (entry) {
            assert.equal(entry.fromMemory, true);
            assert.equal(entry.content, 'FROM_L2');
            assert.deepEqual(entry.responseHeaders, { 'c': 'x' });
            assert.equal(entry.visibility, 'public');
            assert.equal(entry.ttl, 45, 'ttl = PTTL ms / 1000 (authoritative remaining life)');
            assert.equal('filename' in entry, false, 'never an fs filename (B3)');
            // L1 populated → the NEXT read hits L1 without touching redis.
            assert.equal(rc.get(key).content, 'FROM_L2');
        });
    });

    it('warm() with PTTL null (no expiry) → non-expiring L1 entry (no ttl)', function () {
        var l2 = fakeL2();
        var key = 'static:demo:/noexp2';
        l2.strings[key] = JSON.stringify({ content: 'C', responseHeaders: {}, visibility: 'private' });
        l2.pttls[key]   = -1;      // → warmRead returns ttlMs null

        var rc = rcRedis(l2);
        return rc.warm(key).then(function (entry) {
            assert.equal(entry.content, 'C');
            assert.equal('ttl' in entry, false, 'no ttl when L2 has no expiry');
        });
    });

    it('warm() on an L2 miss → undefined, L1 not populated', function () {
        var l2 = fakeL2();
        var rc = rcRedis(l2);
        return rc.warm('static:demo:/missing').then(function (entry) {
            assert.equal(entry, undefined);
            assert.equal(rc.has('static:demo:/missing'), false);
        });
    });

    it('warm() is fail-open: an L2 error → undefined (render normally)', function () {
        var l2 = fakeL2();
        l2.failWarm = new Error('CONN');
        var rc = rcRedis(l2);
        return rc.warm('static:demo:/err').then(function (entry) {
            assert.equal(entry, undefined);
        });
    });

    it('warm() on a corrupt L2 value → undefined (self-heals on re-render)', function () {
        var l2 = fakeL2();
        var key = 'static:demo:/corrupt';
        l2.strings[key] = '{not json';
        l2.pttls[key]   = 10000;
        var rc = rcRedis(l2);
        return rc.warm(key).then(function (entry) {
            assert.equal(entry, undefined);
        });
    });

    it('F5: warm() on a parseable L2 value with NO string content → undefined (never a blank 200)', function () {
        var l2 = fakeL2();
        var key = 'static:demo:/nocontent';
        // Valid JSON but `content` absent (a foreign write to our keyspace, a schema
        // drift, or a degenerate contentless render) — must be a MISS (render the real
        // page), never an empty body served as HTTP 200.
        l2.strings[key] = JSON.stringify({ responseHeaders: {}, visibility: 'public' });
        l2.pttls[key]   = 10000;
        var rc = rcRedis(l2);
        return rc.warm(key).then(function (entry) {
            assert.equal(entry, undefined, 'contentless value is a miss');
            assert.equal(rc.has(key), false, 'L1 not populated with a blank entry');
        });
    });

    it('F5: warm() on an L2 value with non-string content → undefined', function () {
        var l2 = fakeL2();
        var key = 'static:demo:/objcontent';
        l2.strings[key] = JSON.stringify({ content: { not: 'a string' }, responseHeaders: {}, visibility: 'public' });
        l2.pttls[key]   = 10000;
        var rc = rcRedis(l2);
        return rc.warm(key).then(function (entry) {
            assert.equal(entry, undefined);
        });
    });

    it('warm() with no L2 configured → undefined', function () {
        var rc = rcRedis(null);
        return rc.warm('static:demo:/x').then(function (entry) {
            assert.equal(entry, undefined);
        });
    });

    it('warm(key, events) re-registers invalidateOnEvents — the warmed entry is event-evictable', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2  = fakeL2();
        var key = 'static:demo:/we';
        l2.strings[key] = JSON.stringify({ content: 'W', responseHeaders: {}, visibility: 'public' });
        l2.pttls[key]   = 30000;
        var rc = rcRedis(l2);
        return rc.warm(key, ['post#saved']).then(function (entry) {
            assert.equal(entry.content, 'W');
            // The warmed entry skipped the delegate's setEvents — the events
            // param must have re-registered it, or this event fires into nothing
            // (stale served until TTL — the fs-restart sidecar class).
            var evicted = rc.invalidateByEvent('post#saved');
            assert.equal(evicted, 1, 'the warmed entry must be evictable via its re-registered event');
            assert.equal(rc.has(key), false, 'L1 gone');
            assert.equal(l2.calls.del.indexOf(key) > -1, true, 'and DELd from L2 (B1)');
        });
    });

    it('warm(key) without events registers nothing (back-compat single-arg call)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2  = fakeL2();
        var key = 'static:demo:/wne';
        l2.strings[key] = JSON.stringify({ content: 'X', responseHeaders: {}, visibility: 'public' });
        l2.pttls[key]   = 30000;
        var rc = rcRedis(l2);
        return rc.warm(key).then(function () {
            var evicted = rc.invalidateByEvent('post#saved');
            assert.equal(evicted, 0, 'no registration without the events param');
            assert.equal(rc.has(key), true, 'entry still in L1');
        });
    });

    // --- B1: delete / clear / invalidateByEvent DEL from L2 ----------------

    it('delete() drops the key from L2 too (B1)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2 = fakeL2();
        var rc = rcRedis(l2);
        var key = rc.buildKey('static', 'demo', '/d');
        return rc.set('redis', key, { ttl: 60, responseHeaders: {} }, { content: 'D' }).then(function () {
            assert.ok(key in l2.strings, 'L2 holds it after set');
            rc.delete(key);
            assert.equal(l2.calls.del.indexOf(key) > -1, true, 'L2 del was fired');
            assert.equal(key in l2.strings, false, 'L2 body gone — warm cannot re-seed it');
        });
    });

    it('clear(bundle) DELs the matched keys from L2 (B1)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2 = fakeL2();
        var rc = rcRedis(l2);
        var mine  = rc.buildKey('static', 'demo',  '/a');
        var other = rc.buildKey('static', 'other', '/b');
        return rc.set('redis', mine,  { ttl: 60, responseHeaders: {} }, { content: 'A' })
            .then(function () { return rc.set('redis', other, { ttl: 60, responseHeaders: {} }, { content: 'B' }); })
            .then(function () {
                var removed = rc.clear('demo');
                assert.equal(removed, 1, 'only demo evicted from L1');
                assert.equal(l2.calls.del.indexOf(mine) > -1, true, 'demo key DELd from L2');
                assert.equal(l2.calls.del.indexOf(other) > -1, false, 'other bundle untouched');
                assert.equal(mine in l2.strings, false);
                assert.equal(other in l2.strings, true);
            });
    });

    it('invalidateByEvent() DELs every registered key from L2 (B1)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2 = fakeL2();
        var rc = rcRedis(l2);
        var k1 = rc.buildKey('static', 'demo', '/one');
        var k2 = rc.buildKey('static', 'demo', '/two');
        return rc.set('redis', k1, { ttl: 60, responseHeaders: {} }, { content: '1' })
            .then(function () { return rc.setEvents(k1, ['post#saved']); })
            .then(function () { return rc.set('redis', k2, { ttl: 60, responseHeaders: {} }, { content: '2' }); })
            .then(function () { return rc.setEvents(k2, ['post#saved']); })
            .then(function () {
                var evicted = rc.invalidateByEvent('post#saved');
                assert.equal(evicted, 2, 'both L1 entries evicted');
                assert.equal(l2.calls.del.indexOf(k1) > -1, true, 'k1 DELd from L2');
                assert.equal(l2.calls.del.indexOf(k2) > -1, true, 'k2 DELd from L2');
                assert.equal(k1 in l2.strings, false);
                assert.equal(k2 in l2.strings, false);
            });
    });

    it('delete/clear/invalidateByEvent are fail-open when the L2 del rejects', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var l2 = fakeL2();
        var rc = rcRedis(l2);
        var key = rc.buildKey('static', 'demo', '/fo2');
        return rc.set('redis', key, { ttl: 60, responseHeaders: {} }, { content: 'F' }).then(function () {
            l2.failDel = new Error('DOWN');
            assert.doesNotThrow(function () { rc.delete(key); });
            assert.doesNotThrow(function () { rc.clear('demo'); });
            assert.doesNotThrow(function () { rc.invalidateByEvent('nope'); });
        });
    });

    // --- lazy resolution off process.gina._renderCacheStore ----------------

    it('resolves the L2 lazily from process.gina._renderCacheStore (not the constructor)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        // Construct BEFORE the stash exists (mirrors a render delegate loaded at
        // module init, before gna.js boot wires the store).
        var rc  = new RenderCache();
        rc.from(new Map());
        var key = rc.buildKey('static', 'demo', '/lazy');

        // No stash yet → L1-only.
        var l2 = fakeL2();
        if (!process.gina) { process.gina = {}; }
        process.gina._renderCacheStore = l2;   // wired AFTER construction

        return rc.set('redis', key, { ttl: 60, responseHeaders: {} }, { content: 'L' }).then(function () {
            assert.equal(l2.calls.set.length, 1, 'lazy _l2() picked up the process stash post-construction');
            assert.equal(key in l2.strings, true);
        });
    });
});

// #RC4 — boot-time cache-config validation. Pure + static (no L1/L2, no timers):
// feed a RESOLVED server.cache (post the config.js settings→server fold) + a routing
// map, assert { fatal, warnings, redisConfigured }. The ttl/sliding/type resolution
// mirrors the render delegates' writeCache exactly (route value wins; else the
// bundle-wide server.cache default).
describe('12 - validateConfig (boot-time redis config validation)', function () {
    var vc = RenderCache.validateConfig;

    it('memory bundle + memory route → clean (no fatal / warn / redis)', function () {
        var r = vc({ type: 'memory', ttl: 60 }, { home: { cache: { type: 'memory', ttl: 30 } } }, 'demo');
        assert.equal(r.fatal, null);
        assert.deepEqual(r.warnings, []);
        assert.equal(r.redisConfigured, false);
    });

    it('redis route with store + ttl → ok (redisConfigured, no fatal/warn)', function () {
        var r = vc({ type: 'memory', store: 'cacheRedis' },
                   { home: { cache: { type: 'redis', ttl: 60 } } }, 'demo');
        assert.equal(r.fatal, null);
        assert.deepEqual(r.warnings, []);
        assert.equal(r.redisConfigured, true);
    });

    it('redis + effective sliding → FATAL (redis TTL is per-key absolute)', function () {
        var r = vc({ store: 'cacheRedis' },
                   { home: { cache: { type: 'redis', ttl: 60, sliding: true } } }, 'demo');
        assert.match(r.fatal, /sliding.*redis is unsupported/);
    });

    it('redis inheriting a bundle-wide sliding:true → FATAL (route omits sliding)', function () {
        var r = vc({ store: 'cacheRedis', sliding: true, ttl: 60 },
                   { home: { cache: { type: 'redis' } } }, 'demo');
        assert.match(r.fatal, /sliding.*redis is unsupported/);
    });

    it('redis + no ttl + no events → FATAL (orphaned non-expiring L2 key)', function () {
        var r = vc({ store: 'cacheRedis' },
                   { home: { cache: { type: 'redis' } } }, 'demo');
        assert.match(r.fatal, /needs a ttl/);
    });

    it('redis + no ttl + WITH events → WARN (not fatal), redisConfigured', function () {
        var r = vc({ store: 'cacheRedis' },
                   { home: { cache: { type: 'redis', invalidateOnEvents: ['post#saved'] } } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, true);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /invalidate-only/);
    });

    it('redis route but no server.cache.store → FATAL', function () {
        var r = vc({ type: 'memory' },
                   { home: { cache: { type: 'redis', ttl: 60 } } }, 'demo');
        assert.match(r.fatal, /server\.cache\.store.*not set/);
    });

    it('unknown bundle-wide type → WARN (routes inheriting it are not cached)', function () {
        var r = vc({ type: 'reddis' }, {}, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /unknown server\.cache\.type `reddis`/);
    });

    it('unknown per-route type → WARN (route not cached)', function () {
        var r = vc({ type: 'memory' },
                   { home: { cache: { type: 'memroy' } } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /route `home`: unknown cache\.type `memroy`/);
    });

    it('bundle-wide redis default inherited by a type-less opt-in route → redisConfigured (ttl from server.cache)', function () {
        var r = vc({ type: 'redis', store: 'cacheRedis', ttl: 120 },
                   { home: { cache: {} } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, true);
        assert.deepEqual(r.warnings, []);
    });

    it('a type-less route inheriting redis but NO bundle ttl + no events → FATAL', function () {
        var r = vc({ type: 'redis', store: 'cacheRedis' },
                   { home: { cache: {} } }, 'demo');
        assert.match(r.fatal, /needs a ttl/);
    });

    it('routes of another bundle are skipped', function () {
        var r = vc({ store: 'cacheRedis' },
                   { home: { cache: { type: 'redis' }, bundle: 'other' } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, false);
    });

    it('cache:"redis" string form is honoured (inherits server.cache.ttl)', function () {
        var r = vc({ store: 'cacheRedis', ttl: 60 },
                   { home: { cache: 'redis' } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, true);
    });

    it('cache:true (inherit bundle default) with a memory bundle → not redis, clean', function () {
        var r = vc({ type: 'memory', ttl: 60 }, { home: { cache: true } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, false);
        assert.deepEqual(r.warnings, []);
    });

    it('$schema / non-object routing annotations are skipped (no crash)', function () {
        var r = vc({ type: 'memory' }, { '$schema': 'http://x', home: { cache: { type: 'memory' } } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, false);
    });

    it('a route with no cache is ignored (not opted into caching)', function () {
        var r = vc({ type: 'redis', store: 'cacheRedis', ttl: 60 }, { home: { } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, false);
    });

    // --- F2: a blank/non-string route type must NOT falsely inherit the bundle redis ---
    it('F2: route type:"" with a bundle redis default → NOT redisConfigured, no false-fatal', function () {
        // Pre-F2 (effType via length>0): "" inherited the bundle redis → redisConfigured
        // → the no-store / no-ttl checks could ABORT boot for a route writeCache treats
        // as not-cached (blank type kept → set("") → no strategy match). Post-F2 (effType
        // via typeof!==undefined): a SET-but-blank route type is kept → not-cached.
        var r = vc({ type: 'redis', store: 'cacheRedis', ttl: 60 },
                   { home: { cache: { type: '' } } }, 'demo');
        assert.equal(r.fatal, null, 'an inert blank-type route must not abort boot');
        assert.equal(r.redisConfigured, false, 'blank route type is not-cached, not inherited-redis');
    });

    it('F2: route type:"" with a bundle redis + NO store → still no fatal (blank = not cached)', function () {
        var r = vc({ type: 'redis' }, { home: { cache: { type: '' } } }, 'demo');
        assert.equal(r.redisConfigured, false);
        assert.equal(r.fatal, null, 'no redis route resolves → the no-store check never fires');
    });

    it('F2: a numeric route type is not-cached (parity with writeCache), no fatal', function () {
        var r = vc({ type: 'redis', store: 'cacheRedis', ttl: 60 },
                   { home: { cache: { type: 123 } } }, 'demo');
        assert.equal(r.redisConfigured, false);
        assert.equal(r.fatal, null);
    });

    it('a NON-empty typo route type still WARNS (F2 preserves the #B114 typo signal)', function () {
        var r = vc({ type: 'memory' }, { home: { cache: { type: 'reddis' } } }, 'demo');
        assert.equal(r.fatal, null);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /unknown cache\.type `reddis`/);
    });

    // --- first-fatal-wins ordering + null-arg safety ---
    it('validateConfig never throws on null/empty args', function () {
        assert.doesNotThrow(function () { vc(null, null, 'demo'); });
        assert.doesNotThrow(function () { vc(undefined, undefined); });
        var r = vc(null, null);
        assert.equal(r.fatal, null);
        assert.equal(r.redisConfigured, false);
    });
});
