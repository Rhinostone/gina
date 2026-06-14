/**
 * lib/secrets — ${secret:KEY} placeholder resolver for bundle JSON
 * configs. Walks the merged config object in place at config-load time
 * (per-bundle, inside core/config.js::loadBundleConfig). Default backend
 * reads process.env; fail-closed on unset/empty values.
 *
 * Sections:
 *   01 — module shape (exports + SECRET_RE)
 *   02 — basic substitution                       (spec test #1)
 *   03 — missing key throws with exact message    (spec test #2)
 *   04 — no-placeholder config passes through     (spec test #3)
 *   05 — nested object substitution               (spec test #4)
 *   06 — array element substitution               (spec test #5)
 *   07 — mixed-string passthrough                 (spec test #6)
 *   08 — idempotency / once-per-cycle             (spec test #7)
 *   09 — getResolvedPaths tracking                (spec test #8)
 *   10 — custom backend override
 *   11 — source-inspection: wired into framework
 */

'use strict';

var path                                   = require('path');
var fs                                     = require('fs');
var { describe, it, beforeEach, afterEach } = require('node:test');
var assert                                 = require('node:assert/strict');

var FW           = require('../fw');
var SECRETS_PATH = path.join(FW, 'lib/secrets');
var secrets      = require(SECRETS_PATH);


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports resolve, getResolvedPaths, SECRET_RE', function () {
        assert.equal(typeof secrets.resolve, 'function');
        assert.equal(typeof secrets.getResolvedPaths, 'function');
        assert.ok(secrets.SECRET_RE instanceof RegExp);
    });

    it('SECRET_RE matches valid placeholders only', function () {
        assert.ok(secrets.SECRET_RE.test('${secret:DB_PASSWORD}'));
        assert.ok(secrets.SECRET_RE.test('${secret:A}'));
        assert.ok(secrets.SECRET_RE.test('${secret:_PRIVATE}'));
        assert.ok(secrets.SECRET_RE.test('${secret:K_1}'));
    });

    it('SECRET_RE rejects lowercase, leading digit, empty, embedded, trailing whitespace', function () {
        assert.ok(!secrets.SECRET_RE.test('${secret:lowercase}'));
        assert.ok(!secrets.SECRET_RE.test('${secret:1STARTS_WITH_DIGIT}'));
        assert.ok(!secrets.SECRET_RE.test('${secret:}'));
        assert.ok(!secrets.SECRET_RE.test('prefix-${secret:K}-suffix'));
        assert.ok(!secrets.SECRET_RE.test('${secret:K} '));
        assert.ok(!secrets.SECRET_RE.test(' ${secret:K}'));
    });

    it('package.json declares main: "src/main"', function () {
        var pkg = require(path.join(SECRETS_PATH, 'package.json'));
        assert.equal(pkg.main, 'src/main');
    });
});


// ---------------------------------------------------------------------------
// 02 — Basic substitution (spec test #1)
// ---------------------------------------------------------------------------

describe('02 - basic substitution', function () {

    var _saved;
    beforeEach(function () { _saved = process.env.GINA_SECRET_TEST_KEY; });
    afterEach(function () {
        if (typeof _saved === 'undefined') {
            delete process.env.GINA_SECRET_TEST_KEY;
        } else {
            process.env.GINA_SECRET_TEST_KEY = _saved;
        }
    });

    it('replaces ${secret:KEY} with the env-var value', function () {
        process.env.GINA_SECRET_TEST_KEY = 'hello';
        var conf = { feature: { key: '${secret:GINA_SECRET_TEST_KEY}' } };
        secrets.resolve(conf);
        assert.equal(conf.feature.key, 'hello');
    });

    it('returns the same config reference (mutation in place)', function () {
        process.env.GINA_SECRET_TEST_KEY = 'world';
        var conf = { a: '${secret:GINA_SECRET_TEST_KEY}' };
        var returned = secrets.resolve(conf);
        assert.equal(returned, conf);
        assert.equal(returned.a, 'world');
    });
});


// ---------------------------------------------------------------------------
// 03 — Missing key throws (spec test #2)
// ---------------------------------------------------------------------------

describe('03 - missing key throws with exact message', function () {

    var _saved;
    beforeEach(function () { _saved = process.env.GINA_SECRET_TEST_KEY; });
    afterEach(function () {
        if (typeof _saved === 'undefined') {
            delete process.env.GINA_SECRET_TEST_KEY;
        } else {
            process.env.GINA_SECRET_TEST_KEY = _saved;
        }
    });

    it('throws Error("Secret resolution failed") when env var is unset', function () {
        delete process.env.GINA_SECRET_TEST_KEY;
        var conf = { a: '${secret:GINA_SECRET_TEST_KEY}' };
        assert.throws(
            function () { secrets.resolve(conf); },
            function (err) {
                return err instanceof Error && err.message === 'Secret resolution failed';
            }
        );
    });

    it('throws Error("Secret resolution failed") when env var is empty string', function () {
        process.env.GINA_SECRET_TEST_KEY = '';
        var conf = { a: '${secret:GINA_SECRET_TEST_KEY}' };
        assert.throws(
            function () { secrets.resolve(conf); },
            function (err) {
                return err.message === 'Secret resolution failed';
            }
        );
    });

    it('error message does NOT include the key name', function () {
        delete process.env.GINA_SECRET_TEST_KEY;
        var conf = { a: '${secret:GINA_SECRET_TEST_KEY}' };
        try {
            secrets.resolve(conf);
            assert.fail('should have thrown');
        } catch (e) {
            assert.equal(e.message, 'Secret resolution failed');
            assert.equal(e.message.indexOf('GINA_SECRET_TEST_KEY'), -1);
        }
    });

    it('error carries non-enumerable _ginaSecretKey for debug logging', function () {
        delete process.env.GINA_SECRET_TEST_KEY;
        var conf = { a: '${secret:GINA_SECRET_TEST_KEY}' };
        try {
            secrets.resolve(conf);
            assert.fail('should have thrown');
        } catch (e) {
            assert.equal(e._ginaSecretKey, 'GINA_SECRET_TEST_KEY');
            // Confirm non-enumerable so the key does NOT leak via JSON.stringify(err) or own-keys iteration
            var keys = Object.keys(e);
            assert.equal(keys.indexOf('_ginaSecretKey'), -1);
        }
    });
});


// ---------------------------------------------------------------------------
// 04 — No-placeholder pass-through (spec test #3)
// ---------------------------------------------------------------------------

describe('04 - no-placeholder config passes through unchanged', function () {

    it('non-placeholder strings, numbers, booleans, null all pass through', function () {
        var conf = {
            literal: 'literal',
            num: 42,
            flag: true,
            empty: null,
            arr: [1, 'literal', true]
        };
        secrets.resolve(conf);
        assert.deepStrictEqual(conf, {
            literal: 'literal',
            num: 42,
            flag: true,
            empty: null,
            arr: [1, 'literal', true]
        });
    });

    it('returns non-object inputs unchanged', function () {
        assert.equal(secrets.resolve(null), null);
        assert.equal(secrets.resolve(undefined), undefined);
        assert.equal(secrets.resolve('literal'), 'literal');
        assert.equal(secrets.resolve(42), 42);
    });

    it('empty object and empty array are no-ops', function () {
        var emptyObj = {};
        var emptyArr = [];
        secrets.resolve(emptyObj);
        secrets.resolve(emptyArr);
        assert.deepStrictEqual(emptyObj, {});
        assert.deepStrictEqual(emptyArr, []);
    });
});


// ---------------------------------------------------------------------------
// 05 — Nested object substitution (spec test #4)
// ---------------------------------------------------------------------------

describe('05 - nested object substitution', function () {

    var _saved;
    beforeEach(function () { _saved = process.env.GINA_SECRET_NESTED; });
    afterEach(function () {
        if (typeof _saved === 'undefined') {
            delete process.env.GINA_SECRET_NESTED;
        } else {
            process.env.GINA_SECRET_NESTED = _saved;
        }
    });

    it('reaches arbitrary depth (4 levels)', function () {
        process.env.GINA_SECRET_NESTED = 'deep';
        var conf = { a: { b: { c: { d: '${secret:GINA_SECRET_NESTED}' } } } };
        secrets.resolve(conf);
        assert.equal(conf.a.b.c.d, 'deep');
    });
});


// ---------------------------------------------------------------------------
// 06 — Array element substitution (spec test #5)
// ---------------------------------------------------------------------------

describe('06 - array element substitution', function () {

    var _saved1, _saved2;
    beforeEach(function () {
        _saved1 = process.env.GINA_SECRET_K1;
        _saved2 = process.env.GINA_SECRET_K2;
    });
    afterEach(function () {
        if (typeof _saved1 === 'undefined') delete process.env.GINA_SECRET_K1; else process.env.GINA_SECRET_K1 = _saved1;
        if (typeof _saved2 === 'undefined') delete process.env.GINA_SECRET_K2; else process.env.GINA_SECRET_K2 = _saved2;
    });

    it('substitutes in array elements; non-placeholder elements pass through', function () {
        process.env.GINA_SECRET_K1 = 'v1';
        process.env.GINA_SECRET_K2 = 'v2';
        var conf = { items: ['${secret:GINA_SECRET_K1}', 'literal', '${secret:GINA_SECRET_K2}'] };
        secrets.resolve(conf);
        assert.deepStrictEqual(conf.items, ['v1', 'literal', 'v2']);
    });

    it('substitutes inside object-valued array elements', function () {
        process.env.GINA_SECRET_K1 = 'nv';
        var conf = { items: [{ k: '${secret:GINA_SECRET_K1}' }, { k: 'literal' }] };
        secrets.resolve(conf);
        assert.equal(conf.items[0].k, 'nv');
        assert.equal(conf.items[1].k, 'literal');
    });
});


// ---------------------------------------------------------------------------
// 07 — Mixed-string passthrough (spec test #6)
// ---------------------------------------------------------------------------

describe('07 - mixed-string passthrough (no substitution attempted)', function () {

    var _saved;
    beforeEach(function () { _saved = process.env.GINA_SECRET_HOST; });
    afterEach(function () {
        if (typeof _saved === 'undefined') {
            delete process.env.GINA_SECRET_HOST;
        } else {
            process.env.GINA_SECRET_HOST = _saved;
        }
    });

    it('placeholder embedded in a larger string is returned unchanged', function () {
        process.env.GINA_SECRET_HOST = 'example.com'; // would-be substitute
        var conf = { url: 'https://${secret:GINA_SECRET_HOST}/path' };
        secrets.resolve(conf);
        assert.equal(conf.url, 'https://${secret:GINA_SECRET_HOST}/path');
    });

    it('placeholder followed by trailing whitespace passes through', function () {
        var conf = { x: '${secret:GINA_SECRET_HOST} ' };
        secrets.resolve(conf);
        assert.equal(conf.x, '${secret:GINA_SECRET_HOST} ');
    });

    it('mixed-string is NOT recorded in getResolvedPaths', function () {
        process.env.GINA_SECRET_HOST = 'example.com';
        var conf = { url: 'https://${secret:GINA_SECRET_HOST}/path' };
        secrets.resolve(conf);
        assert.deepStrictEqual(secrets.getResolvedPaths(conf), []);
    });
});


// ---------------------------------------------------------------------------
// 08 — Idempotency / once-per-cycle (spec test #7 reframed)
// ---------------------------------------------------------------------------

describe('08 - resolution happens once per config; idempotent', function () {

    var _saved;
    beforeEach(function () { _saved = process.env.GINA_SECRET_ONCE; });
    afterEach(function () {
        if (typeof _saved === 'undefined') {
            delete process.env.GINA_SECRET_ONCE;
        } else {
            process.env.GINA_SECRET_ONCE = _saved;
        }
    });

    it('subsequent resolve() calls do not re-resolve (placeholder is gone after first call)', function () {
        var conf = { feature: { key: '${secret:GINA_SECRET_ONCE}' } };
        process.env.GINA_SECRET_ONCE = 'first';
        secrets.resolve(conf);
        assert.equal(conf.feature.key, 'first');

        // Mutating the env between calls must NOT affect the already-resolved value:
        process.env.GINA_SECRET_ONCE = 'second';
        secrets.resolve(conf);
        assert.equal(conf.feature.key, 'first');
    });

    it('resolved values are not re-walked (placeholder-like resolved value is not substituted again)', function () {
        // Backend returns a string that itself looks like a placeholder.
        // The lib must NOT re-walk it — single-pass substitution.
        var backend = {
            calls: 0,
            resolve: function (key) {
                this.calls++;
                if (key === 'OUTER') return '${secret:INNER}';
                if (key === 'INNER') return 'inner-value';
                throw new Error('Secret resolution failed');
            }
        };
        var conf = { k: '${secret:OUTER}' };
        secrets.resolve(conf, backend);
        assert.equal(conf.k, '${secret:INNER}');
        assert.equal(backend.calls, 1, 'backend resolve must be called once, not twice');
    });
});


// ---------------------------------------------------------------------------
// 09 — getResolvedPaths tracking (spec test #8 reframed per user choice)
// ---------------------------------------------------------------------------

describe('09 - getResolvedPaths tracking', function () {

    var _saved1, _saved2;
    beforeEach(function () {
        _saved1 = process.env.GINA_SECRET_TR1;
        _saved2 = process.env.GINA_SECRET_TR2;
    });
    afterEach(function () {
        if (typeof _saved1 === 'undefined') delete process.env.GINA_SECRET_TR1; else process.env.GINA_SECRET_TR1 = _saved1;
        if (typeof _saved2 === 'undefined') delete process.env.GINA_SECRET_TR2; else process.env.GINA_SECRET_TR2 = _saved2;
    });

    it('reports dotted paths for object keys', function () {
        process.env.GINA_SECRET_TR1 = 'v1';
        var conf = { db: { password: '${secret:GINA_SECRET_TR1}' } };
        secrets.resolve(conf);
        assert.deepStrictEqual(secrets.getResolvedPaths(conf), ['db.password']);
    });

    it('reports bracketed indices for array elements', function () {
        process.env.GINA_SECRET_TR1 = 'v1';
        process.env.GINA_SECRET_TR2 = 'v2';
        var conf = { items: ['${secret:GINA_SECRET_TR1}', 'literal', '${secret:GINA_SECRET_TR2}'] };
        secrets.resolve(conf);
        assert.deepStrictEqual(secrets.getResolvedPaths(conf), ['items[0]', 'items[2]']);
    });

    it('reports multiple paths from nested + array mix', function () {
        process.env.GINA_SECRET_TR1 = 'v1';
        process.env.GINA_SECRET_TR2 = 'v2';
        var conf = {
            db: { password: '${secret:GINA_SECRET_TR1}' },
            items: ['${secret:GINA_SECRET_TR2}']
        };
        secrets.resolve(conf);
        var paths = secrets.getResolvedPaths(conf).slice().sort();
        assert.deepStrictEqual(paths, ['db.password', 'items[0]']);
    });

    it('returns empty array when no substitutions happened', function () {
        var conf = { literal: 'value' };
        secrets.resolve(conf);
        assert.deepStrictEqual(secrets.getResolvedPaths(conf), []);
    });

    it('returns empty array for non-object inputs', function () {
        assert.deepStrictEqual(secrets.getResolvedPaths(null), []);
        assert.deepStrictEqual(secrets.getResolvedPaths(undefined), []);
        assert.deepStrictEqual(secrets.getResolvedPaths('string'), []);
    });

    it('paths contain field names only — never the resolved values', function () {
        process.env.GINA_SECRET_TR1 = 'super-secret-value';
        var conf = { db: { password: '${secret:GINA_SECRET_TR1}' } };
        secrets.resolve(conf);
        var paths = secrets.getResolvedPaths(conf);
        for (var i = 0; i < paths.length; i++) {
            assert.equal(paths[i].indexOf('super-secret-value'), -1);
        }
    });
});


// ---------------------------------------------------------------------------
// 10 — Custom backend override (future plug-in shape)
// ---------------------------------------------------------------------------

describe('10 - custom backend override', function () {

    it('accepts a backend override (used by tests and future plug-ins)', function () {
        var conf = { k: '${secret:CUSTOM_KEY}' };
        var backend = {
            resolve: function (key) {
                if (key === 'CUSTOM_KEY') return 'value-from-custom';
                throw new Error('Secret resolution failed');
            }
        };
        secrets.resolve(conf, backend);
        assert.equal(conf.k, 'value-from-custom');
    });

    it('custom backend errors propagate through unchanged', function () {
        var conf = { k: '${secret:MISSING}' };
        var backend = {
            resolve: function () { throw new Error('Secret resolution failed'); }
        };
        assert.throws(
            function () { secrets.resolve(conf, backend); },
            function (err) { return err.message === 'Secret resolution failed'; }
        );
    });
});


// ---------------------------------------------------------------------------
// 11 — Source-inspection: integration into core/config.js + lib/index.js
// ---------------------------------------------------------------------------

describe('11 - source-inspection: lib/secrets wired into framework', function () {

    var LIB_INDEX_SRC = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
    var CONFIG_SRC    = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');

    it('lib/index.js registers secrets via _require()', function () {
        assert.ok(
            /secrets\s*:\s*_require\(\s*'\.\/secrets'\s*\)/.test(LIB_INDEX_SRC),
            'lib/index.js must register secrets via _require(\'./secrets\')'
        );
    });

    it('core/config.js captures `var secrets = lib.secrets`', function () {
        assert.ok(
            /var\s+secrets\s*=\s*lib\.secrets;/.test(CONFIG_SRC),
            'core/config.js must capture `var secrets = lib.secrets;` near the top'
        );
    });

    it('core/config.js calls secrets.resolve(self.envConf[bundle][env]) post-merge', function () {
        assert.ok(
            CONFIG_SRC.indexOf('secrets.resolve(self.envConf[bundle][env])') > -1,
            'core/config.js must call secrets.resolve(self.envConf[bundle][env]) after the merge'
        );
    });

    it('core/config.js propagates secrets.resolve errors through the load callback', function () {
        // #B42 loosened: a console.debug(...) line may sit between `{` and the
        // return now (it names the failing key + config path); the invariant
        // pinned here is that the catch still propagates via callback(secretErr).
        assert.ok(
            /catch\s*\(\s*secretErr\s*\)\s*\{[\s\S]*?return\s+callback\(secretErr\)/.test(CONFIG_SRC),
            'core/config.js must propagate secrets.resolve errors via callback(err)'
        );
    });
});


// ---------------------------------------------------------------------------
// 13 — #B42: catch site names the failing secret + config path at debug level
// ---------------------------------------------------------------------------

describe('13 - #B42 secret-resolution failure names the key + config path (debug)', function () {

    var CONFIG_SRC = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');

    // Replica of the #B42 debug-message composition at the catch site
    // (bundle / env / scope are loadBundleConfig locals in scope there).
    function buildSecretDebugMsg(err, bundle, env, scope) {
        return '[CONFIG][loadBundleConfig] Secret resolution failed for `'
            + ((err && err._ginaSecretKey) || '<unknown>')
            + '` in `' + bundle + '/' + env + ':' + scope + '` configuration';
    }

    it('the catch logs via console.debug before propagating', function () {
        assert.ok(
            /catch\s*\(\s*secretErr\s*\)\s*\{[\s\S]*?console\.debug\([\s\S]*?return\s+callback\(secretErr\)/.test(CONFIG_SRC),
            'the secretErr catch must console.debug(...) before return callback(secretErr)'
        );
    });

    it('the debug log surfaces the non-enumerable _ginaSecretKey', function () {
        assert.ok(
            CONFIG_SRC.indexOf('secretErr._ginaSecretKey') > -1,
            'the catch must reference secretErr._ginaSecretKey'
        );
    });

    it('the debug log composes the bundle/env:scope config path', function () {
        assert.ok(
            /_ginaSecretKey[\s\S]*?bundle\s*\+[\s\S]*?env[\s\S]*?scope/.test(CONFIG_SRC),
            'the debug message must compose bundle + "/" + env + ":" + scope'
        );
    });

    it('logs at debug level only — never warn/error/emerg (user channel stays generic)', function () {
        var catchSlice = CONFIG_SRC.slice(
            CONFIG_SRC.indexOf('catch (secretErr)'),
            CONFIG_SRC.indexOf('return callback(secretErr)')
        );
        assert.ok(catchSlice.indexOf('console.debug') > -1, 'catch logs at debug level');
        assert.equal(catchSlice.indexOf('console.warn'), -1, 'catch must not warn');
        assert.equal(catchSlice.indexOf('console.error'), -1, 'catch must not error');
        assert.equal(catchSlice.indexOf('console.emerg'), -1, 'catch must not emerg');
    });

    it('replica: names the key + the bundle/env:scope path', function () {
        var err = {};
        Object.defineProperty(err, '_ginaSecretKey', { value: 'DB_PASSWORD', enumerable: false });
        var msg = buildSecretDebugMsg(err, 'demo', 'dev', 'local');
        assert.ok(msg.indexOf('DB_PASSWORD') > -1, 'msg names the key');
        assert.ok(msg.indexOf('demo/dev:local') > -1, 'msg names the bundle/env:scope path');
    });

    it('replica: falls back to <unknown> when _ginaSecretKey is absent', function () {
        var msg = buildSecretDebugMsg(new Error('Secret resolution failed'), 'demo', 'dev', 'local');
        assert.ok(msg.indexOf('<unknown>') > -1, 'missing key → <unknown> placeholder');
        assert.equal(msg.indexOf('undefined'), -1, 'never renders the literal "undefined"');
    });
});


// ---------------------------------------------------------------------------
// 12 — getRequiredKeys: read-only placeholder enumeration (backs secrets:scan)
// ---------------------------------------------------------------------------

describe('12 - getRequiredKeys enumeration', function () {

    it('exports getRequiredKeys as a function', function () {
        assert.equal(typeof secrets.getRequiredKeys, 'function');
    });

    it('enumerates bare placeholders — sorted and de-duplicated', function () {
        var conf = {
            db: { password: '${secret:DB_PASSWORD}' },
            cache: { token: '${secret:DB_PASSWORD}' },   // duplicate key
            api: { key: '${secret:API_KEY}' }
        };
        assert.deepStrictEqual(secrets.getRequiredKeys(conf), ['API_KEY', 'DB_PASSWORD']);
    });

    it('does NOT report mixed-content placeholders (mirrors resolve())', function () {
        var conf = {
            bare: '${secret:BARE}',
            mixed: 'https://${secret:HOST}/v1',
            trailing: '${secret:TRAIL} '
        };
        assert.deepStrictEqual(secrets.getRequiredKeys(conf), ['BARE']);
    });

    it('walks nested objects and arrays (including object-valued elements)', function () {
        var conf = {
            a: { b: { c: '${secret:DEEP}' } },
            items: ['${secret:ARR0}', 'literal', { k: '${secret:ARR_OBJ}' }]
        };
        assert.deepStrictEqual(secrets.getRequiredKeys(conf), ['ARR0', 'ARR_OBJ', 'DEEP']);
    });

    it('returns [] for non-object inputs', function () {
        assert.deepStrictEqual(secrets.getRequiredKeys(null), []);
        assert.deepStrictEqual(secrets.getRequiredKeys(undefined), []);
        assert.deepStrictEqual(secrets.getRequiredKeys('string'), []);
        assert.deepStrictEqual(secrets.getRequiredKeys(42), []);
    });

    it('returns [] for configs with no bare placeholders', function () {
        assert.deepStrictEqual(secrets.getRequiredKeys({ a: 'literal', n: 1, b: true, z: null }), []);
        assert.deepStrictEqual(secrets.getRequiredKeys({}), []);
        assert.deepStrictEqual(secrets.getRequiredKeys([]), []);
    });

    it('never calls a backend — non-throwing even when the env var is unset', function () {
        delete process.env.GINA_GRK_UNSET;   // resolve() would throw here; getRequiredKeys must not
        assert.doesNotThrow(function () {
            var keys = secrets.getRequiredKeys({ a: '${secret:GINA_GRK_UNSET}' });
            assert.deepStrictEqual(keys, ['GINA_GRK_UNSET']);
        });
    });

    it('does not mutate the config (read-only)', function () {
        var conf = { a: '${secret:KEEP_ME}', nested: { b: '${secret:KEEP_TOO}' } };
        secrets.getRequiredKeys(conf);
        assert.equal(conf.a, '${secret:KEEP_ME}');
        assert.equal(conf.nested.b, '${secret:KEEP_TOO}');
    });

    it('reports exactly the keys resolve() would substitute (consistency)', function () {
        // Use a custom backend so no env mutation is needed. The count of
        // required keys must equal the count of resolved paths — mixed-content
        // is excluded from both.
        var probeA = { x: '${secret:C1}', y: { z: '${secret:C2}' }, mixed: 'p-${secret:C1}' };
        var probeB = { x: '${secret:C1}', y: { z: '${secret:C2}' }, mixed: 'p-${secret:C1}' };
        var required = secrets.getRequiredKeys(probeA);
        secrets.resolve(probeB, { resolve: function (k) { return 'val:' + k; } });
        var resolvedPaths = secrets.getResolvedPaths(probeB);
        assert.deepStrictEqual(required, ['C1', 'C2']);
        assert.equal(resolvedPaths.length, 2);   // mixed not substituted, not counted
    });
});
