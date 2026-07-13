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
