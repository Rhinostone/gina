'use strict';
/**
 * #B848 / #B847 — the DELETE container `req.delete` is a plain object holding the
 * query's own fields.
 *
 * The DELETE branch of core/server.js handed `request.query` over as `req.delete` by
 * reference. On isaac a query field `__proto__` holding a JSON value had re-pointed that
 * object's prototype (the parser assigned every field with `request.query[name] = value`),
 * so on a warm route the action read the injected properties through `req.delete` while
 * `Object.keys` did not list them, and a shadowed `count` / `hasOwnProperty` / `toString`
 * made the documented calls throw (#B848). On Express 4 with a query parser built on
 * node's `querystring` the bag has a null prototype, so `req.delete.count()` is not a
 * function (#B847).
 *
 * Fix, two files:
 *   - core/server.js — `request.delete = copyOwnQueryKeys(request.query)`: a plain object
 *     holding each own key, minus `__proto__`, `constructor` and `prototype` (the names the
 *     data helper drops from a query string, #B592); any value that is not a plain or
 *     null-prototype object (an array, a string) is handed over as before;
 *   - core/server.isaac.js — both query assignment sites skip those three names.
 *
 * Strategy: `copyOwnQueryKeys` is cut out of the SHIPPED server.js and compiled with
 * `new Function`; it must reference nothing but globals (asserted, and every branch is
 * run, so a lifted-scope reference would throw). The isaac guards are pinned on the
 * comment-stripped source; the booted proof is
 * test/integration/container-boot-delete-proto-b848.test.js, and the Express 4 / 5
 * acceptance is a live scene (Express is consumer-provided, never a dependency).
 *
 * Red-first seams: B848_SERVER_SRC / B848_ISAAC_SRC = a pre-fix copy
 * (`git show <ref>:<path>`).
 *
 * Run standalone: node --test test/core/delete-query-copy-b848.test.js
 */
var { describe, it, before } = require('node:test');
var assert      = require('node:assert/strict');
var fs          = require('fs');
var path        = require('path');
var querystring = require('querystring');

var FW       = require('../fw');
var ginaRoot = path.resolve(__dirname, '../..');
// the copies must serve gina's own count() helper — install it exactly as a bundle does
require(path.join(ginaRoot, 'utils', 'prototypes'));

var SERVER_SRC = process.env.B848_SERVER_SRC || path.join(FW, 'core', 'server.js');
var ISAAC_SRC  = process.env.B848_ISAAC_SRC  || path.join(FW, 'core', 'server.isaac.js');

/**
 * Drops full-line comments (`//`, and the `/*` / `*` lines of a JSDoc block), so no pin
 * can anchor on a `// was:` line or a JSDoc mention. Line-based on purpose: a
 * `/\*[\s\S]*?\*\/` pass also matches a `/*` that sits inside a string or a regex of
 * these files and removes the code up to the next `*\/` — on server.isaac.js it removed
 * both query assignment sites (measured: 2 in the source, 0 after that pass).
 *
 * @param   {string} src
 * @returns {string}
 * @inner
 */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}


// ---------------------------------------------------------------------------
// 01 — copyOwnQueryKeys(), the shipped helper
// ---------------------------------------------------------------------------
describe('01 - core/server.js copyOwnQueryKeys(): a plain object with the query\'s own keys (#B848 / #B847)', function () {

    var copy = null;

    before(function () {
        var src   = fs.readFileSync(SERVER_SRC, 'utf8');
        var start = src.indexOf('function copyOwnQueryKeys(query) {');
        assert.ok(start > -1, 'extraction control: copyOwnQueryKeys must be defined in server.js');
        assert.equal(src.indexOf('function copyOwnQueryKeys(query) {', start + 1), -1, 'extraction control: defined once');
        var end = src.indexOf('\n}\n', start);
        assert.ok(end > -1, 'extraction control: the function must close at column 0');
        var block = src.slice(start, end + 2);
        // lifted-scope control: a `new Function` body captures NO closure, so the helper
        // must reference no module-scope binding of server.js (#B364 lesson)
        var active = stripComments(block);
        ['ownCount', 'merge(', 'console.', 'lib.', 'getContext', 'require(', 'formatDataFromString', 'self.'].forEach(function (needle) {
            assert.equal(active.indexOf(needle), -1, 'the helper must not reference the server binding `' + needle + '`');
        });
        /* eslint-disable no-new-func */
        copy = new Function("'use strict';\n" + block + '\nreturn copyOwnQueryKeys;')();
    });

    it('a plain query is copied: the same own keys and values, a new plain object', function () {
        var src = { a: '1', b: '2' };
        var out = copy(src);
        assert.notEqual(out, src, 'a copy, not the same object');
        assert.equal(Object.getPrototypeOf(out), Object.prototype);
        assert.deepEqual(Object.keys(out), ['a', 'b']);
        assert.equal(out.a, '1');
        assert.equal(out.count(), 2, 'the documented count() works on the copy');
    });

    it('#B847 — a null-prototype query (querystring.parse) becomes a plain object: count() and hasOwnProperty() work', function () {
        var src = querystring.parse('a=1&b=2');
        assert.equal(Object.getPrototypeOf(src), null, 'control: querystring.parse returns a null-prototype object');
        assert.equal(typeof src.count, 'undefined', 'control: the source has no count() to call');
        var out = copy(src);
        assert.equal(Object.getPrototypeOf(out), Object.prototype);
        assert.deepEqual(Object.keys(out), ['a', 'b']);
        assert.equal(out.count(), 2);
        assert.equal(out.hasOwnProperty('a'), true);
    });

    it('#B848 — a source whose prototype was re-pointed (the isaac pair form) gives a copy without the injected properties', function () {
        var src = {};
        src['__proto__'] = { polluted: 1, count: 1 };   // what `request.query[name] = value` did
        src.a = '1';
        assert.equal(src.polluted, 1, 'control: the source reads the injected property');
        var out = copy(src);
        assert.equal(Object.getPrototypeOf(out), Object.prototype);
        assert.deepEqual(Object.keys(out), ['a']);
        assert.equal(out.polluted, undefined);
        assert.equal(out.count(), 1, 'count() is the helper again, not the injected number');
    });

    it('own keys named __proto__, constructor and prototype are dropped; the copy\'s prototype is untouched', function () {
        var src = JSON.parse('{"__proto__":{"polluted":1},"constructor":"x","prototype":"y","a":"1"}');
        assert.deepEqual(Object.keys(src), ['__proto__', 'constructor', 'prototype', 'a'], 'control: JSON.parse makes them own keys');
        var out = copy(src);
        assert.equal(Object.getPrototypeOf(out), Object.prototype);
        assert.deepEqual(Object.keys(out), ['a']);
        assert.equal(out.polluted, undefined);
        assert.equal(out.constructor, Object, 'the inherited constructor, not the sent string');
    });

    it('the three names are dropped from a null-prototype source as well (an engine-parsed own `__proto__` key)', function () {
        var src = querystring.parse('__proto__=x&constructor=y&prototype=z&a=1');
        assert.deepEqual(Object.keys(src).sort(), ['__proto__', 'a', 'constructor', 'prototype'], 'control: querystring keeps them as own keys');
        var out = copy(src);
        assert.equal(Object.getPrototypeOf(out), Object.prototype);
        assert.deepEqual(Object.keys(out), ['a']);
    });

    it('values are kept by reference; a near-miss name is kept', function () {
        var inner = { x: 1 };
        var out = copy({ a: inner, __proto__x: 'k', constructors: 'k' });
        assert.equal(out.a, inner);
        assert.deepEqual(Object.keys(out), ['a', '__proto__x', 'constructors']);
    });

    it('any other value is handed over as before: an array, a string, a number, null, undefined', function () {
        var arr = [1, 2];
        assert.equal(copy(arr), arr, 'an array (a whole-query JSON array) is handed over as is');
        assert.equal(copy('a=1'), 'a=1');
        assert.equal(copy(3), 3);
        assert.equal(copy(null), null);
        assert.equal(copy(undefined), undefined);
    });
});


// ---------------------------------------------------------------------------
// 02 — the hand-over and the isaac guards, on the comment-stripped sources
// ---------------------------------------------------------------------------
describe('02 - the DELETE hand-over uses the copy, and isaac skips the three names (#B848)', function () {

    var server = null, isaac = null;

    before(function () {
        server = stripComments(fs.readFileSync(SERVER_SRC, 'utf8'));
        isaac  = stripComments(fs.readFileSync(ISAAC_SRC, 'utf8'));
    });

    it('core/server.js — the DELETE branch hands over copyOwnQueryKeys(request.query), never request.query itself', function () {
        var at = server.indexOf("case 'delete':");
        assert.ok(at > -1, "extraction control: the `case 'delete':` branch must exist");
        var branch = server.slice(at, server.indexOf('break', at));
        assert.ok(branch.indexOf('request.delete = copyOwnQueryKeys(request.query);') > -1, branch);
        assert.equal(server.indexOf('request.delete = request.query'), -1, 'no assignment of request.query itself remains');
    });

    it('core/server.isaac.js — both query assignment sites are guarded against the three names', function () {
        var needle = 'request.query[ a[0] ] = a[1]';
        var sites = [], i = -1;
        while ((i = isaac.indexOf(needle, i + 1)) > -1) { sites.push(i); }
        assert.equal(sites.length, 2, 'extraction control: two query assignment sites (the multi-field and the single-field branch)');
        sites.forEach(function (at, n) {
            var before = isaac.slice(Math.max(0, at - 220), at);
            assert.ok(/a\[0\] [!=]== '__proto__'/.test(before) && /a\[0\] [!=]== 'constructor'/.test(before) && /a\[0\] [!=]== 'prototype'/.test(before),
                'site ' + (n + 1) + ' must test the three names right before the assignment:\n' + before);
        });
    });
});
