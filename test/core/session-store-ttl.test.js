'use strict';
/**
 * #B163 — session-store ttl vs cookie maxAge (cross-store contract)
 *
 * Strategy: the six session stores cannot be require()d standalone (they read
 * framework globals + drivers at factory-call time), so the constructor `ttl`
 * assignment and the set()/touch() ttl expression are EXTRACTED from the
 * shipped source and executed as real bytes (no drift-prone replica). Each
 * extraction is control-gated: a regex that silently matched zero (or the
 * wrong count) would vacuously pass everything after it.
 *
 * Contract under test: when neither `options.ttl` nor connectors.json `ttl`
 * is configured, the constructor leaves `this.ttl` null so the set()/touch()
 * expression falls back to the cookie's maxAge — converging the four
 * redis/sqlite/mongodb/scylladb stores on the couchbase stores' behaviour.
 * An explicitly configured ttl still wins over maxAge.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var STORES = {
    redis    : path.join(FW, 'core/connectors/redis/lib/session-store.js'),
    sqlite   : path.join(FW, 'core/connectors/sqlite/lib/session-store.js'),
    mongodb  : path.join(FW, 'core/connectors/mongodb/lib/session-store.js'),
    scylladb : path.join(FW, 'core/connectors/scylladb/lib/session-store.js')
};
var COUCHBASE = {
    'couchbase v3' : path.join(FW, 'core/connectors/couchbase/lib/session-store.v3.js'),
    'couchbase v4' : path.join(FW, 'core/connectors/couchbase/lib/session-store.v4.js')
};

var ONE_DAY = 86400;

/**
 * Drop full-line comments so extraction regexes and negative pins can never
 * anchor on a `// was:` line or a JSDoc mention.
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

/**
 * Extract the constructor `this.ttl = (options.ttl != null) ? … ;` statement
 * and return an evaluator running those exact bytes.
 *
 * @param   {string} src - full store source
 * @returns {{count: number, fn: function}} evaluator `(options, connConf, oneDay) -> ttl`
 * @inner
 */
function makeCtorTtl(src) {
    var matches = stripComments(src).match(/^\s*this\.ttl\s+=\s+\(options\.ttl[^\n]*;\s*$/mg);
    if (!matches || matches.length !== 1) {
        return { count: (matches || []).length, fn: null };
    }
    var line = matches[0].replace('this.ttl', 'out.ttl');
    return {
        count: 1,
        fn: new Function('options', 'connConf', 'oneDay', 'var out = {}; ' + line + ' return out.ttl;')
    };
}

/**
 * Extract the shared set()/touch() expression
 * `var ttl = this.ttl || ('number' === typeof maxAge ? maxAge / 1000 | 0 : oneDay);`
 * — expected exactly twice per store (set + touch) — and return one evaluator
 * per occurrence.
 *
 * @param   {string} src - full store source
 * @returns {{count: number, fns: function[]}} evaluators `(ctorTtl, maxAge, oneDay) -> ttl`
 * @inner
 */
function makeSetTtl(src) {
    var matches = stripComments(src).match(/^\s*var ttl\s+=\s+this\.ttl \|\|[^\n]*;\s*$/mg);
    if (!matches) {
        return { count: 0, fns: [] };
    }
    return {
        count: matches.length,
        fns: matches.map(function (line) {
            return new Function('ctorTtl', 'maxAge', 'oneDay',
                line.replace('this.ttl', 'ctorTtl') + ' return ttl;');
        })
    };
}

/**
 * Extract the couchbase constructor `this.ttl = options.ttl || null;` line.
 *
 * @param   {string} src
 * @returns {{count: number, fn: function}} evaluator `(options) -> ttl`
 * @inner
 */
function makeCouchbaseCtorTtl(src) {
    var matches = stripComments(src).match(/^\s*this\.ttl = options\.ttl \|\| null;\s*$/mg);
    if (!matches || matches.length !== 1) {
        return { count: (matches || []).length, fn: null };
    }
    var line = matches[0].replace('this.ttl', 'out.ttl');
    return {
        count: 1,
        fn: new Function('options', 'var out = {}; ' + line + ' return out.ttl;')
    };
}

var SRC = {};
before(function () {
    Object.keys(STORES).forEach(function (name) {
        SRC[name] = fs.readFileSync(STORES[name], 'utf8');
    });
    Object.keys(COUCHBASE).forEach(function (name) {
        SRC[name] = fs.readFileSync(COUCHBASE[name], 'utf8');
    });
});


// ─── 01 — extraction controls (an instrument that cannot fail is not one) ────

describe('01 - #B163 extraction controls', function () {

    Object.keys(STORES).forEach(function (name) {
        it(name + ': constructor ttl assignment extracted exactly once', function () {
            assert.equal(makeCtorTtl(SRC[name]).count, 1);
        });
        it(name + ': set()/touch() ttl expression extracted exactly twice', function () {
            assert.equal(makeSetTtl(SRC[name]).count, 2);
        });
    });

    Object.keys(COUCHBASE).forEach(function (name) {
        it(name + ': constructor ttl assignment extracted exactly once', function () {
            assert.equal(makeCouchbaseCtorTtl(SRC[name]).count, 1);
        });
    });

    it('known-negative: the ctor extractor does not fire on unrelated source', function () {
        assert.equal(makeCtorTtl('var x = 1;\nthis.prefix = options.prefix;\n').count, 0);
    });
});


// ─── 02 — constructor behaviour (the real bytes, driven) ─────────────────────

describe('02 - #B163 constructor ttl derivation', function () {

    Object.keys(STORES).forEach(function (name) {

        it(name + ': nothing configured -> null (maxAge branch reachable)', function () {
            var ctor = makeCtorTtl(SRC[name]);
            assert.equal(ctor.fn({}, {}, ONE_DAY), null);
        });

        it(name + ': connectors.json ttl 0 -> null (explicit 0 defers to maxAge)', function () {
            var ctor = makeCtorTtl(SRC[name]);
            assert.equal(ctor.fn({}, { ttl: 0 }, ONE_DAY), null);
        });

        it(name + ': options.ttl wins over connectors.json', function () {
            var ctor = makeCtorTtl(SRC[name]);
            assert.equal(ctor.fn({ ttl: 300 }, { ttl: 600 }, ONE_DAY), 300);
        });

        it(name + ': connectors.json ttl honoured when options silent', function () {
            var ctor = makeCtorTtl(SRC[name]);
            assert.equal(ctor.fn({}, { ttl: 600 }, ONE_DAY), 600);
        });

        it(name + ': options.ttl 0 stays 0 (defer-to-maxAge semantics preserved)', function () {
            var ctor = makeCtorTtl(SRC[name]);
            assert.equal(ctor.fn({ ttl: 0 }, { ttl: 600 }, ONE_DAY), 0);
        });
    });
});


// ─── 03 — ctor + set()/touch() composition (end-to-end ttl resolution) ───────

describe('03 - #B163 set()/touch() composition with the real ctor state', function () {

    Object.keys(STORES).forEach(function (name) {

        it(name + ': unconfigured store honours cookie.maxAge (1h cookie -> 3600s record)', function () {
            var ctorTtl = makeCtorTtl(SRC[name]).fn({}, {}, ONE_DAY);
            makeSetTtl(SRC[name]).fns.forEach(function (setTtl) {
                assert.equal(setTtl(ctorTtl, 3600000, ONE_DAY), 3600);
            });
        });

        it(name + ': unconfigured store without maxAge falls back to one day', function () {
            var ctorTtl = makeCtorTtl(SRC[name]).fn({}, {}, ONE_DAY);
            makeSetTtl(SRC[name]).fns.forEach(function (setTtl) {
                assert.equal(setTtl(ctorTtl, undefined, ONE_DAY), ONE_DAY);
            });
        });

        it(name + ': explicitly configured ttl still wins over maxAge', function () {
            var ctorTtl = makeCtorTtl(SRC[name]).fn({ ttl: 600 }, {}, ONE_DAY);
            makeSetTtl(SRC[name]).fns.forEach(function (setTtl) {
                assert.equal(setTtl(ctorTtl, 3600000, ONE_DAY), 600);
            });
        });
    });
});


// ─── 04 — six-store convergence ──────────────────────────────────────────────

describe('04 - #B163 all six stores default to null when nothing is configured', function () {

    it('redis / sqlite / mongodb / scylladb / couchbase v3 / couchbase v4 all -> null', function () {
        Object.keys(STORES).forEach(function (name) {
            assert.equal(makeCtorTtl(SRC[name]).fn({}, {}, ONE_DAY), null,
                name + ' should default ttl to null');
        });
        Object.keys(COUCHBASE).forEach(function (name) {
            assert.equal(makeCouchbaseCtorTtl(SRC[name]).fn({}), null,
                name + ' should default ttl to null');
        });
    });
});


// ─── 05 — source pins (structural lock on the shipped shape) ─────────────────

describe('05 - #B163 source pins', function () {

    Object.keys(STORES).forEach(function (name) {

        it(name + ': ctor falls back to null, not oneDay', function () {
            var active = stripComments(SRC[name]);
            assert.match(active, /connConf\.ttl\s+\|\|\s+null\)/);
            assert.doesNotMatch(active, /connConf\.ttl\s+\|\|\s+oneDay/);
        });

        it(name + ': the oneDay constant survives as the set()/touch() last resort', function () {
            assert.match(SRC[name], /var oneDay\s*=\s*86400/);
        });
    });
});
