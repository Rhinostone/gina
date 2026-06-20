/**
 * core/gna.js — Bun-safety of the NODE_ENV_IS_DEV / scope boot env-var writes.
 *
 * gna.js sets three boot env vars from the resolved dev/scope flags. Under Node,
 * assigning a boolean to a process.env slot coerces it to the string
 * 'true'/'false', so every downstream reader behaves — the `.toLowerCase()`
 * readers (controller.js / router.js / server.isaac.js,
 * `process.env.X && process.env.X.toLowerCase() === 'true'`) and the
 * comparison readers (connectors / lib / model, `process.env.X == 'false'`).
 * Under Bun the assignment PRESERVES the boolean, so the `.toLowerCase()`
 * readers throw `… .toLowerCase is not a function` — crashing bundle boot — and
 * the `== 'false'` readers misread (`false == 'false'` is false), so production
 * silently runs in cacheless/dev mode.
 *
 * The fix assigns the string literals 'true'/'false' directly at the write site:
 * byte-identical to Node's implicit coercion (zero Node-side change) and correct
 * under Bun. These tests are two-layered:
 *   (a) source-inspection — the three writes use the string form, not the bare
 *       boolean form;
 *   (b) behaviour — a pure-logic replica proving the string value satisfies both
 *       reader shapes, with a subtract showing the old boolean value breaks both
 *       (the exact Bun failure the fix removes).
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');

var FW  = require('../fw');
var GNA = path.join(FW, 'core/gna.js');

var ENV_VARS = ['NODE_ENV_IS_DEV', 'NODE_SCOPE_IS_LOCAL', 'NODE_SCOPE_IS_PRODUCTION'];


// ---------------------------------------------------------------------------
// 01 — source: the three boot env writes assign string literals, not booleans
// ---------------------------------------------------------------------------
describe('01 - core/gna.js: boot env writes are Bun-safe strings', function() {

    var gnaSrc;
    before(function() { gnaSrc = fs.readFileSync(GNA, 'utf8'); });

    ENV_VARS.forEach(function(name) {
        it(name + ' is assigned the string "true"/"false", not a boolean', function() {
            // Anchored on the var name so other ternaries in gna.js can't trip it.
            var strForm  = new RegExp('process\\.env\\.' + name + "\\s*=[^;]*\\?\\s*'true'\\s*:\\s*'false'");
            var boolForm = new RegExp('process\\.env\\.' + name + '\\s*=[^;]*\\?\\s*true\\s*:\\s*false');
            assert.match(gnaSrc, strForm,
                name + " must assign the string form ? 'true' : 'false'");
            assert.doesNotMatch(gnaSrc, boolForm,
                name + ' must NOT assign the bare boolean form ? true : false');
        });
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: the string value satisfies both reader shapes; the pre-fix
//      boolean value (which Bun preserves) breaks both.
// ---------------------------------------------------------------------------
describe('02 - core/gna.js: env value satisfies the downstream readers', function() {

    // Mirrors the gna.js write — coerce a raw flag to the env-var value.
    var writeStr  = function(flag) { return (/^true$/i.test(flag)) ? 'true' : 'false'; }; // FIXED
    var writeBool = function(flag) { return (/^true$/i.test(flag)) ? true   : false;   }; // pre-fix (Bun keeps this)

    // The two downstream reader shapes.
    var readIsDev       = function(v) { return v && v.toLowerCase() === 'true'; };  // controller.js:75 / router.js:31 / server.isaac.js:39
    var readIsCacheless = function(v) { return (v == 'false') ? false : true; };    // connectors / lib/index / model / helpers

    it('writes a string, not a boolean', function() {
        assert.strictEqual(typeof writeStr('true'), 'string');
        assert.strictEqual(writeStr('true'),  'true');
        assert.strictEqual(writeStr('false'), 'false');
    });

    it('the .toLowerCase() reader works on the string value (dev and prod)', function() {
        assert.doesNotThrow(function() { readIsDev(writeStr('true')); });
        assert.strictEqual(readIsDev(writeStr('true')),  true);
        assert.strictEqual(readIsDev(writeStr('false')), false);
    });

    it('the == "false" reader (isCacheless) is correct — prod is NOT cacheless', function() {
        assert.strictEqual(readIsCacheless(writeStr('false')), false); // production
        assert.strictEqual(readIsCacheless(writeStr('true')),  true);  // dev
    });

    it('subtract: the pre-fix boolean value breaks both readers (the Bun bug)', function() {
        // Under Bun the boolean survives the env assignment; model that raw boolean.
        assert.strictEqual(typeof writeBool('false'), 'boolean');
        // .toLowerCase() on a boolean throws — the controller.js:75 boot crash.
        assert.throws(function() { readIsDev(writeBool('true')); }, TypeError);
        // false == 'false' is false → isCacheless true → production wrongly cacheless.
        assert.strictEqual(readIsCacheless(writeBool('false')), true);
    });

});
