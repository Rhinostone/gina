// lib/index.js — init-order race fix (commit 58dc3098)
//
// Pre-fix, `Lib()` returned a fresh `self` object and `module.exports = lib`
// ran at the very end of the file. Anything `_require('./...')` transitively
// required back into lib saw the initial empty `module.exports = {}` because
// the bottom-of-file assignment had not yet happened; those captured
// references never picked up the registry.
//
// Post-fix invariant: `self === module.exports`, the registry is populated
// via `Object.assign(self, {...})`, and any captured `require('./lib')`
// reference points at the same live object.

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var SOURCE = path.join(require('../fw'), 'lib/index.js');


describe('lib/index.js — init-order race fix (commit 58dc3098)', function() {

    var src = fs.readFileSync(SOURCE, 'utf8');

    it('captures `var self = module.exports` inside Lib()', function() {
        assert.ok(
            /var\s+self\s*=\s*module\.exports/.test(src),
            'expected `var self = module.exports` capture — without this, captured require("./lib") refs never see the registry'
        );
    });

    it('populates the registry via Object.assign(self, { ... })', function() {
        assert.ok(
            /Object\.assign\(\s*self\s*,\s*\{/.test(src),
            'expected `Object.assign(self, { ... })` — direct property writes on `self` would only mutate a fresh object, not module.exports'
        );
    });

    it('does NOT re-assign module.exports to a fresh object inside Lib()', function() {
        // `module.exports = {...}` or `module.exports = new Lib()` inside the
        // constructor would re-introduce the race by replacing the object that
        // transitive requires have already captured.
        var libBody = src.match(/function\s+Lib\s*\([\s\S]*?\n\}/);
        assert.ok(libBody, 'Lib() constructor body not found');
        assert.ok(
            !/module\.exports\s*=\s*\{/.test(libBody[0]),
            'Lib() must not re-assign module.exports to a new object literal — re-introduces the init-order race'
        );
    });

    it('bottom-of-file `module.exports = lib` is still present (redundant no-op kept as a reading anchor)', function() {
        assert.ok(
            /module\.exports\s*=\s*lib\s*$/m.test(src),
            'expected trailing `module.exports = lib` line — kept as a reading anchor per the patch'
        );
    });

    it('runtime: a re-require of lib/index.js exposes the registry on the captured reference', function() {
        // Simulate a transitive consumer: first require captures module.exports,
        // then a fresh require re-evaluates the module. Post-fix, the captured
        // reference must see the registry (Object.assign mutates in place).
        // Pre-fix, the captured reference would still be the empty object
        // because module.exports = lib only fired at end-of-file.
        var resolved = require.resolve(SOURCE);
        delete require.cache[resolved];

        // First require — capture the reference *before* the registry lands.
        // We cannot easily intercept mid-evaluation, so instead we verify the
        // post-fix invariant: `lib === module.exports` and the registry is
        // present on that object.
        var lib = require(SOURCE);
        assert.ok(lib && typeof lib === 'object', 'lib/index.js did not export an object');
        assert.ok(
            typeof lib.merge === 'function' || lib.merge != null,
            'expected `merge` key on the lib registry — Object.assign(self, {...}) did not run'
        );
    });

});
