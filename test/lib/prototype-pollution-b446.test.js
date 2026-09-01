/**
 * #B446 — prototype pollution on the request path.
 *
 * Two independent sources were confirmed by probe before the fix:
 *   (1) helpers/data parseLocalObj / nestBracketNotationKey / formatDataFromString —
 *       client-supplied bracket-notation field names assigned as property paths.
 *   (2) lib/merge — an OWN `__proto__` key, which JSON.parse produces, copied through
 *       the unguarded for..in loops.
 *
 * Each describe pairs the attack arms with a BENIGN control, so a guard that simply
 * broke nesting/merging outright would fail the suite rather than pass it vacuously.
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path   = require('path');

const FW      = path.join(__dirname, '..', '..', 'framework');
const fs      = require('fs');
const version = fs.readdirSync(FW).filter(d => /^v/.test(d))[0];
const DATA    = path.join(FW, version, 'helpers', 'data', 'src', 'main.js');
const MERGE   = path.join(FW, version, 'lib', 'merge', 'src', 'main.js');

require(DATA)();                       // installs the implicit globals
const merge = require(MERGE);

/** Remove anything a failing arm may have planted, so arms cannot contaminate each other. */
function scrub() {
    ['polluted', 'POST', 'csrfExempt', 'protocol', 'rejectUnauthorized'].forEach(function (k) {
        delete Object.prototype[k];
    });
}

describe('#B446 — source 1: bracket-notation key nesting', function () {
    beforeEach(scrub);
    afterEach(scrub);

    it('01 — `__proto__[polluted]` does not reach Object.prototype', function () {
        formatDataFromString('__proto__[polluted]=OWNED');
        assert.strictEqual({}.polluted, undefined);
        assert.strictEqual([].polluted, undefined);
    });

    it('02 — `constructor[prototype][polluted]` does not reach Object.prototype', function () {
        formatDataFromString('constructor[prototype][polluted]=OWNED');
        assert.strictEqual({}.polluted, undefined);
    });

    it('03 — the percent-encoded form does not reach Object.prototype', function () {
        // a filter matching the literal `__proto__` would miss this one
        formatDataFromString('%5F%5Fproto%5F%5F[polluted]=OWNED');
        assert.strictEqual({}.polluted, undefined);
    });

    it('04 — CONTROL: legitimate bracket notation still nests', function () {
        const out = formatDataFromString('user[name]=Ada&user[age]=37');
        assert.deepStrictEqual(out, { user: { name: 'Ada', age: '37' } });
        assert.strictEqual({}.polluted, undefined);
    });

    it('05 — CONTROL: array index notation still nests', function () {
        const out = formatDataFromString('item[0][id]=x');
        assert.deepStrictEqual(out, { item: [ { id: 'x' } ] });
    });

    it('06 — nestBracketNotationKey rejects an unsafe segment and returns the accumulator', function () {
        const acc = {};
        const ret = nestBracketNotationKey(acc, ['__proto__', 'polluted'], 0, 'OWNED');
        assert.strictEqual(ret, acc);
        assert.deepStrictEqual(acc, {});
        assert.strictEqual({}.polluted, undefined);
    });
});

describe('#B446 — source 2: merge with an own __proto__ key', function () {
    beforeEach(scrub);
    afterEach(scrub);

    it('07 — JSON.parse output as merge SOURCE does not pollute (default mode)', function () {
        const src = JSON.parse('{"__proto__":{"polluted":"OWNED"}}');
        assert.ok(Object.prototype.hasOwnProperty.call(src, '__proto__'), 'fixture must carry an own __proto__');
        merge({}, src);
        assert.strictEqual({}.polluted, undefined);
    });

    it('08 — same, override mode', function () {
        const src = JSON.parse('{"__proto__":{"polluted":"OWNED"}}');
        merge({}, src, true);
        assert.strictEqual({}.polluted, undefined);
    });

    it('09 — CONTROL: ordinary deep merge still works', function () {
        assert.deepStrictEqual(merge({ a: 1 }, { b: { c: 2 } }), { a: 1, b: { c: 2 } });
    });

    it('10 — CONTROL: documented conflict semantics unchanged (target wins by default)', function () {
        assert.deepStrictEqual(merge({ a: 1 }, { a: 9 }),       { a: 1 });
        assert.deepStrictEqual(merge({ a: 1 }, { a: 9 }, true),  { a: 9 });
    });

    it('11 — CONTROL: array union semantics unchanged (#B436)', function () {
        assert.deepStrictEqual(merge([25], [25, 25]), [25, 25]);
    });

    it('12 — merge does not copy INHERITED enumerable source properties', function () {
        function Src() { this.own = 1; }
        Src.prototype.inherited = 'nope';
        const out = merge({}, new Src());
        assert.strictEqual(out.own, 1);
        assert.ok(!Object.prototype.hasOwnProperty.call(out, 'inherited'));
    });
});

describe('#B446 — gadgets are no longer reachable from either source', function () {
    beforeEach(scrub);
    afterEach(scrub);

    // verbatim from lib/admin/src/main.js:106 and core/controller/controller.js:5069
    const SAFE_HTTP_METHODS = { GET: true, HEAD: true, OPTIONS: true, TRACE: true };
    const isSafe = m => SAFE_HTTP_METHODS[ String(m || '').toUpperCase() ] === true;

    it('13 — POST is not classified safe after a JSON-vector attempt', function () {
        merge({}, JSON.parse('{"__proto__":{"POST":true}}'));
        assert.strictEqual(isSafe('POST'), false);
        assert.strictEqual(isSafe('GET'), true, 'control: GET must still be safe');
    });

    it('14 — csrfExempt does not read true on a routing object lacking the key', function () {
        merge({}, JSON.parse('{"__proto__":{"csrfExempt":true}}'));
        const routing = {};
        assert.strictEqual(!!(routing && routing.csrfExempt), false);
    });

    it('15 — query-option defaults are not grafted from a polluted prototype', function () {
        formatDataFromString('__proto__[protocol]=EVIL');
        const defaults = { host: undefined, hostname: undefined, port: 80, method: 'GET' };
        const options  = merge(JSON.clone({ path: '/x' }), defaults);
        assert.ok(!Object.prototype.hasOwnProperty.call(options, 'protocol'));
    });
});
