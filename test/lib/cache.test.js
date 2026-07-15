var path = require('path');
var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');

var helpers = require(path.join(require('../fw'), 'helpers'));
var Cache = require(path.join(require('../fw'), 'lib/cache/src/main'));


// 01 — basic operations
describe('01 - basic operations', function () {

    var cache;

    beforeEach(function () {
        cache = new Cache();
        cache.from(new Map());
    });

    it('set and get a string value', function () {
        cache.set('key1', 'hello');
        assert.equal(cache.get('key1'), 'hello');
    });

    it('set and get an object value with createdAt', function () {
        cache.set('key1', { name: 'test' });
        var result = cache.get('key1');
        assert.equal(result.name, 'test');
        assert.ok(result.createdAt instanceof Date);
    });

    it('has returns true for existing key', function () {
        cache.set('key1', 'value');
        assert.equal(cache.has('key1'), true);
    });

    it('has returns false for non-existing key', function () {
        assert.equal(cache.has('missing'), false);
    });

    it('get returns undefined for non-existing key', function () {
        assert.equal(cache.get('missing'), undefined);
    });

    it('delete returns true for existing key', function () {
        cache.set('key1', 'value');
        assert.equal(cache.delete('key1'), true);
        assert.equal(cache.has('key1'), false);
    });

    it('delete returns false for non-existing key', function () {
        assert.equal(cache.delete('missing'), false);
    });

    it('size returns correct count', function () {
        assert.equal(cache.size(), 0);
        cache.set('a', 'v1');
        cache.set('b', 'v2');
        assert.equal(cache.size(), 2);
    });

    it('clear removes all entries', function () {
        cache.set('a', 'v1');
        cache.set('b', 'v2');
        cache.clear();
        assert.equal(cache.size(), 0);
        assert.equal(cache.has('a'), false);
        assert.equal(cache.has('b'), false);
    });

    it('set overwrites existing value', function () {
        cache.set('key1', 'first');
        cache.set('key1', 'second');
        assert.equal(cache.get('key1'), 'second');
        assert.equal(cache.size(), 1);
    });
});


// 02 — TTL auto-expiry
describe('02 - TTL auto-expiry', function () {

    it('entry expires after TTL', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var cache = new Cache();
        cache.from(new Map());

        cache.set('temp', { data: 'will expire', ttl: 5 });
        assert.equal(cache.has('temp'), true);

        t.mock.timers.tick(5000);
        assert.equal(cache.has('temp'), false);
        assert.equal(cache.get('temp'), undefined);
    });

    it('entry persists before TTL expires', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var cache = new Cache();
        cache.from(new Map());

        cache.set('temp', { data: 'still here', ttl: 10 });

        t.mock.timers.tick(9000);
        assert.equal(cache.has('temp'), true);
        assert.equal(cache.get('temp').data, 'still here');
    });

    it('TTL converts seconds to milliseconds (boundary)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var cache = new Cache();
        cache.from(new Map());

        cache.set('temp', { data: 'x', ttl: 3 });

        t.mock.timers.tick(2999);
        assert.equal(cache.has('temp'), true);

        t.mock.timers.tick(1);
        assert.equal(cache.has('temp'), false);
    });

    it('delete clears TTL timeout', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var cache = new Cache();
        cache.from(new Map());

        cache.set('temp', { data: 'x', ttl: 5 });
        cache.delete('temp');

        // Tick past TTL — should not throw (timeout was cleared)
        t.mock.timers.tick(6000);
        assert.equal(cache.has('temp'), false);
    });
});


// 03 — cleanup functions
describe('03 - cleanup functions', function () {

    var cache;

    beforeEach(function () {
        cache = new Cache();
        cache.from(new Map());
    });

    it('cleanup called on delete', function () {
        var called = false;
        cache.set('key1', 'value', function () { called = true; });
        cache.delete('key1');
        assert.equal(called, true);
    });

    it('cleanup called on replace (set existing key)', function () {
        var firstCleaned = false;
        cache.set('key1', 'first', function () { firstCleaned = true; });
        cache.set('key1', 'second');
        assert.equal(firstCleaned, true);
    });

    it('cleanup called for each entry on clear', function () {
        var count = 0;
        cache.set('a', 'v1', function () { count++; });
        cache.set('b', 'v2', function () { count++; });
        cache.clear();
        assert.equal(count, 2);
    });

    it('no error when cleanup is null', function () {
        cache.set('key1', 'value');
        assert.doesNotThrow(function () {
            cache.delete('key1');
        });
    });

    it('TTL expiry runs the cleanup fn (routed through instance.delete — #B113)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        var called = false;
        cache.set('temp', { data: 'x', ttl: 1 }, function () { called = true; });

        t.mock.timers.tick(1000);
        assert.equal(cache.has('temp'), false);
        // #B113: expiry now routes through instance.delete, so the cleanup fn runs (an fs
        // entry's body + .meta are removed on expiry). Was: bypassed via the raw Map.delete.
        assert.equal(called, true);
    });

    it('TTL expiry reclaims the key\'s event registrations (#B113)', function (t) {
        t.mock.timers.enable(['setTimeout']);
        cache.set('ev', { data: 'x', ttl: 1 });
        cache.setEvents('ev', ['some#event']);
        assert.equal(cache._events.length, 1);

        t.mock.timers.tick(1000);
        assert.equal(cache.has('ev'), false);
        // #B113: expiry routes through instance.delete → dropEvents reclaims the rows.
        // Was: the raw Map.delete stranded them until a later delete of the same key.
        assert.equal(cache._events.length, 0);
    });
});


// 04 — from (shared Map)
describe('04 - from (shared Map)', function () {

    it('operates on the provided Map', function () {
        var sharedMap = new Map();
        var cache = new Cache();
        cache.from(sharedMap);

        cache.set('shared', 'data');
        assert.equal(sharedMap.has('shared'), true);
    });

    it('two instances share state via same Map', function () {
        var sharedMap = new Map();
        var cache1 = new Cache();
        var cache2 = new Cache();
        cache1.from(sharedMap);
        cache2.from(sharedMap);

        cache1.set('key', 'from-c1');
        assert.equal(cache2.get('key'), 'from-c1');
    });
});


// 05 — event invalidation
describe('05 - event invalidation', function () {

    var cache;

    beforeEach(function () {
        cache = new Cache();
        cache.from(new Map());
    });

    it('setEvents registers events for a cache key', function () {
        cache.set('user:123', { name: 'Alice' });
        cache.setEvents('user:123', ['user:updated', 'user:deleted']);

        assert.equal(cache._events.length, 2);
    });

    it('invalidateByEvent deletes the cache entry', function () {
        cache.set('user:123', { name: 'Alice' });
        cache.setEvents('user:123', ['user:updated']);

        cache.invalidateByEvent('user:updated');
        assert.equal(cache.has('user:123'), false);
    });

    it('invalidateByEvent removes the event registration', function () {
        cache.set('user:123', { name: 'Alice' });
        cache.setEvents('user:123', ['user:updated']);

        cache.invalidateByEvent('user:updated');

        // Second invalidation should be a no-op (no error)
        cache.invalidateByEvent('user:updated');
    });

    it('multiple events for same key — first event evicts', function () {
        cache.set('user:123', { name: 'Alice' });
        cache.setEvents('user:123', ['user:updated', 'user:deleted']);

        cache.invalidateByEvent('user:updated');
        assert.equal(cache.has('user:123'), false);

        // Key already gone — second event is harmless
        cache.invalidateByEvent('user:deleted');
    });

    it('multiple keys for same event — all evicted', function () {
        cache.set('user:1', { name: 'Alice' });
        cache.set('user:2', { name: 'Bob' });
        cache.setEvents('user:1', ['users:changed']);
        cache.setEvents('user:2', ['users:changed']);

        cache.invalidateByEvent('users:changed');
        assert.equal(cache.has('user:1'), false);
        assert.equal(cache.has('user:2'), false);
    });

    it('invalidateByEvent calls cleanup on evicted entries', function () {
        var cleaned = false;
        cache.set('user:123', { name: 'Alice' }, function () { cleaned = true; });
        cache.setEvents('user:123', ['user:updated']);

        cache.invalidateByEvent('user:updated');
        assert.equal(cleaned, true);
    });

    it('repeated setEvents is idempotent (no duplicate rows)', function () {
        cache.set('key', { v: 1 });
        cache.setEvents('key', ['evt']);
        cache.setEvents('key', ['evt']);

        // Load-bearing: a route re-registers its events on EVERY cache-miss
        // re-render, so a non-idempotent setEvents grows the registry without
        // bound for the life of the process.
        assert.equal(cache._events.length, 1);
    });

    // ---- the registry must never hand a cache key to a query evaluator ----
    // A cache key is `<token>:<kind>:<bundle>:<url>` and the url carries the
    // querystring, so keys routinely hold `?` and `=`. Registering twice against
    // such a key used to THROW ('Could not evaluate condition `"<key>""<key>"`'),
    // because the dedup lookup ran the key through lib/collection's condition
    // parser, which reads those chars as operator tokens.
    it('setEvents accepts a key holding a querystring (no evaluator)', function () {
        var key = 'static:demo:/invoice/9?v=2&sort=asc';
        cache.set(key, { v: 1 });

        assert.doesNotThrow(function () {
            cache.setEvents(key, ['invoice#saved']);
            cache.setEvents(key, ['invoice#saved']);   // the re-registration that threw
        });
        assert.equal(cache._events.length, 1);
        assert.equal(cache.invalidateByEvent('invoice#saved'), 1);
        assert.equal(cache.has(key), false);
    });

    it('a TTL-expired key does not strand its registration', function () {
        // The sliding/TTL timers installed by set() delete straight off the Map and
        // never route through delete(), so a timed-out key could strand its rows —
        // and the next miss-render's setEvents would then hit the stale row. The
        // reclaim in delete() (which runs even on a miss) is what closes that.
        var key = 'static:demo:/a?x=1';
        cache.set(key, { v: 1 });
        cache.setEvents(key, ['e#x']);
        assert.equal(cache._events.length, 1);

        cache.delete(key);
        assert.equal(cache._events.length, 0, 'the row must go with the entry');

        // …and the next cache-miss re-render re-registers cleanly.
        assert.doesNotThrow(function () {
            cache.set(key, { v: 2 });
            cache.setEvents(key, ['e#x']);
        });
        assert.equal(cache._events.length, 1);
    });

    it('invalidateByEvent returns the number of entries evicted', function () {
        cache.set('a', { v: 1 });
        cache.set('b', { v: 2 });
        cache.setEvents('a', ['bulk']);
        cache.setEvents('b', ['bulk']);

        assert.equal(cache.invalidateByEvent('bulk'), 2);
        // Rows were reclaimed with the entries, so a re-fire evicts nothing.
        assert.equal(cache.invalidateByEvent('bulk'), 0);
        assert.equal(cache.invalidateByEvent('never-registered'), 0);
    });

    it('invalidateByEvent counts each key once, not each registration', function () {
        cache.set('a', { v: 1 });
        cache.setEvents('a', ['e1', 'e2']);   // one key, two rows
        // Only e1's key is evicted — and it is ONE entry, not two rows' worth.
        assert.equal(cache.invalidateByEvent('e1'), 1);
    });

    it('clear() drops every registration', function () {
        cache.set('a', { v: 1 });
        cache.setEvents('a', ['e1']);

        cache.clear();
        assert.equal(cache._events.length, 0);
        assert.equal(cache.invalidateByEvent('e1'), 0);
    });
});


describe('06 - keys()', function () {
    it('returns every key held — object- AND string-valued (unlike stats(), which drops strings)', function () {
        var cache = new Cache();
        cache.from(new Map());
        cache.set('static:demo:/a', { v: 1 });
        cache.set('data:demo:/b',   { v: 2 });
        cache.set('plain-string',   'a raw string value');   // stats() would omit this
        var keys = cache.keys();
        assert.ok(Array.isArray(keys), 'returns an array');
        assert.equal(keys.length, 3);
        assert.ok(keys.indexOf('static:demo:/a') > -1);
        assert.ok(keys.indexOf('data:demo:/b') > -1);
        assert.ok(keys.indexOf('plain-string') > -1, 'includes string-valued entries');
    });

    it('returns [] for an empty cache and yields a snapshot (not a live view)', function () {
        var cache = new Cache();
        cache.from(new Map());
        assert.deepEqual(cache.keys(), []);
        cache.set('k', { v: 1 });
        var snap = cache.keys();
        assert.equal(snap.length, 1);
        cache.delete('k');
        assert.equal(snap.length, 1, 'the earlier snapshot is unaffected by a later delete');
        assert.equal(cache.keys().length, 0, 'a fresh keys() reflects the delete');
    });

    it('keys() is complete where stats() is lossy', function () {
        var cache = new Cache();
        cache.from(new Map());
        cache.set('obj', { v: 1 });
        cache.set('str', 'raw');
        var statsKeys = cache.stats().entries.map(function (e) { return e.key; });
        assert.ok(statsKeys.indexOf('str') < 0, 'stats() drops the string entry');
        assert.ok(cache.keys().indexOf('str') > -1, 'keys() keeps it');
    });
});
