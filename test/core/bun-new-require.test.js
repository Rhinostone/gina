/**
 * `new require(...)` — the Bun boot-crash class.
 *
 * `new require(p)(a, b)` does NOT construct the module. It parses as
 * `(new require(p))(a, b)`: `require` is invoked as a CONSTRUCTOR with `p`, and
 * because a constructor returning an object yields that object, the expression
 * evaluates to `module.exports` — which is then invoked as a PLAIN CALL.
 *
 * Node tolerates that because its `require` is an ordinary function with a
 * [[Construct]] slot. Bun's does not, so every such site throws
 * `TypeError: function is not a constructor` under Bun.
 *
 * MEASURED 2026-07-29 (node:24 + oven/bun:1.3.14, same module, one probe):
 *
 *   | form                    | node:24 | bun 1.3.14                     |
 *   |-------------------------|---------|--------------------------------|
 *   | new require(p)(a, b)    | works   | THROWS "not a constructor"     |
 *   | require(p)(a, b)        | works   | works                          |
 *
 * On Node both forms returned IDENTICAL results — which is what makes the plain
 * call the zero-Node-delta repair, and why the fix is deliberately NOT
 * `new (require(p))(a, b)`: that WOULD change Node semantics (real construction
 * instead of a plain call) for every connector.
 *
 * Found by the SQLite connector leg of the container smoke on its first Bun run:
 * `lib/model.js:314` aborted the boot of any bundle declaring ANY connector. It
 * had been invisible because no CI leg — Node or Bun — exercised a connector.
 *
 * These are source pins: the runtime behaviour is Bun-only and the suite is
 * Node-only by design, so the replica below encodes the measured Bun contract.
 */

'use strict';

var fs       = require('fs');
var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');

/** Every file that carried a live `new require(...)` call site. */
var GUARDED = [
    nodePath.join(FW, 'lib/model.js'),
    nodePath.join(FW, 'core/model/template/index.js'),
    nodePath.join(FW, 'core/server.js')
];

/**
 * Strips full-line `//` comments so the pins below cannot be satisfied — or
 * tripped — by the two commented-out historical `new require(` lines that
 * deliberately remain in lib/model.js as a record of the original shape.
 *
 * @param   {string} src
 * @returns {string}
 */
function stripLineComments(src) {
    return src.split('\n')
        .filter(function (line) { return !/^\s*\/\//.test(line); })
        .join('\n');
}

describe('01 - new require(): no live call site remains', function () {

    GUARDED.forEach(function (file) {
        it('has zero live `new require(` in ' + nodePath.relative(FW, file), function () {
            var code = stripLineComments(fs.readFileSync(file, 'utf8'));
            assert.doesNotMatch(code, /new\s+require\s*\(/,
                'a live `new require(` would abort boot under Bun with "function is not a constructor"');
        });
    });

    it('the connector managers are built with a plain call (both model.js sites)', function () {
        var code = stripLineComments(fs.readFileSync(nodePath.join(FW, 'lib/model.js'), 'utf8'));
        var hits = code.match(/entitiesManager = require\( _\(connectorPath \+ '\/index\.js', true\) \)\(conn,/g) || [];
        assert.equal(hits.length, 2,
            'both the boot path and the reloadModels/DB-reconnect path must use the plain call');
    });

    it('the multipart liner is built with a plain call (core/server.js)', function () {
        var code = stripLineComments(fs.readFileSync(nodePath.join(FW, 'core/server.js'), 'utf8'));
        assert.match(code, /var liner = require\('stream'\)\.Transform\(\{objectMode: true\}\);/);
    });

    // Control: the pins above must be capable of FAILING. If the comment
    // stripper ever swallowed the whole file, every doesNotMatch would pass
    // vacuously — so assert the files still carry the token we anchor on.
    it('control — the stripper leaves real code behind (pins can fail)', function () {
        GUARDED.forEach(function (file) {
            var code = stripLineComments(fs.readFileSync(file, 'utf8'));
            assert.ok(code.indexOf('require(') > -1,
                nodePath.relative(FW, file) + ' still contains require( after stripping');
            assert.ok(code.length > 500, nodePath.relative(FW, file) + ' is non-trivial after stripping');
        });
    });

    it('control — the stripper does NOT hide a live `new require(` from the pins', function () {
        // A live site on a non-comment line must survive stripping and be caught.
        var poisoned = stripLineComments([
            '// entitiesManager = new require(x)(1);',
            'var m = new require(y)(2);'
        ].join('\n'));
        assert.match(poisoned, /new\s+require\s*\(/, 'a live site must survive the stripper');
        assert.doesNotMatch(stripLineComments('// var m = new require(y)(2);'), /new\s+require\s*\(/,
            'a commented site must be stripped');
    });
});

describe('03 - entity.js: the `arguments` reassignment repair is SCOPE-LIMITED', function () {

    var ENTITY = nodePath.join(FW, 'core/model/entity.js');
    var src    = fs.readFileSync(ENTITY, 'utf8');

    it('no longer assigns to `arguments` (Bun/JSC rejects it outright)', function () {
        assert.doesNotMatch(src, /^\s*arguments\s*=[^=]/m,
            'assigning to `arguments` is a SyntaxError under Bun: "Invalid assignment target"');
    });

    it('carries the reassigned value in a local instead', function () {
        assert.match(src, /var _args = arguments\[0\];/);
        assert.match(src, /Array\.prototype\.slice\.call\(_args\)/);
    });

    it('leaves the NESTED callbacks reading their OWN `arguments`', function () {
        // These two sit inside `.on(evt, function () {...})`. A non-arrow function
        // has its own `arguments` binding, so it was NEVER the outer reassigned
        // value — rewriting them to `_args` would silently change behaviour.
        // A first pass did exactly that; this pin exists so it cannot recur.
        assert.match(src, /\.apply\(this\[method\], arguments\);/,
            'the alias-trigger dispatch must forward the CALLBACK\'s own arguments');
        assert.match(src, /this\._arguments\[trigger\]\.push\(arguments\);/,
            'the preemptive buffer must push the CALLBACK\'s own arguments');
    });

    it('uses _args ONLY in setListener\'s own scope', function () {
        // Count CODE occurrences only — the explanatory comment above the repair
        // names `_args` too, and a reworded comment must not move this pin.
        var uses = (stripLineComments(src).match(/\b_args\b/g) || []).length;
        // 1 declaration + 1 read. Anything more means the repair leaked into a
        // nested callback scope where `arguments` means something different.
        assert.equal(uses, 2, 'expected exactly the declaration and one read');
    });
});

describe('02 - new require(): the measured semantics replica', function () {

    // Stands in for a connector index.js: called with (conn, infos), returns an
    // entity map. Mirrors core/connectors/sqlite/index.js, which ends in an
    // explicit `return init(conn, infos)` and never touches `this`.
    function connectorModule(conn, infos) {
        return { conn: conn, database: infos && infos.database };
    }

    it('the plain call reproduces what `new require(...)(...)` did on Node', function () {
        // `new require(p)` yields module.exports, then (...) is a PLAIN call —
        // so the plain call is behaviourally identical on Node.
        var viaPlain = connectorModule('CONN', { database: 'smokedb' });
        assert.deepEqual(viaPlain, { conn: 'CONN', database: 'smokedb' });
    });

    it('subtract — `new` on the module WOULD change Node semantics', function () {
        // Documents why the repair is the plain call and not `new (require(p))(...)`:
        // a constructor call binds `this` and only yields the explicit return when
        // that return is an object. For a connector that returns a primitive or
        // nothing, the two forms diverge.
        function returnsNothing() { this.marker = 'constructed'; }
        var constructed = new returnsNothing();
        var called      = returnsNothing.call({});
        assert.equal(constructed.marker, 'constructed');
        assert.equal(called, undefined, 'a plain call yields undefined where `new` yields the instance');
    });

    it('replica — Bun rejects constructing `require`, Node does not', function () {
        // The measured discriminator, encoded: Bun's require has no [[Construct]].
        // Node's does, which is the only reason the original form ever worked.
        var nodeLikeRequire = function (p) { return connectorModule; };
        var bunLikeRequire  = (p) => connectorModule;   // arrow fn: no [[Construct]] slot

        assert.doesNotThrow(function () { return new nodeLikeRequire('p'); },
            'a plain function is constructible — the Node reading');
        assert.throws(function () { return new bunLikeRequire('p'); }, TypeError,
            'a function without [[Construct]] throws — the Bun reading');
    });
});
