/**
 * utils/runtime — Bun vs Node runtime detection.
 *
 * Stage 1 of Bun-runtime support. The helper is additive: Node stays the
 * first-class runtime, so isNode() must report true under the Node test
 * process. The Bun branch is exercised via a stub seam (no Bun binary needed)
 * by injecting process.versions.bun / a global Bun, since the helper reads
 * them live (no memoisation).
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var runtime     = require('../../utils/runtime.js');
var RUNTIME_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'utils', 'runtime.js'),
    'utf8'
);


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------
describe('01 - utils/runtime: module shape', function() {

    it('exports isBun and isNode as functions', function() {
        assert.equal(typeof runtime.isBun, 'function');
        assert.equal(typeof runtime.isNode, 'function');
    });

});


// ---------------------------------------------------------------------------
// 02 — detection under the Node test process (the additive guarantee)
// ---------------------------------------------------------------------------
describe('02 - utils/runtime: detection under Node', function() {

    it('isBun() is false and isNode() is true in this Node process', function() {
        assert.equal(runtime.isBun(), false, 'must not mis-detect Node as Bun');
        assert.equal(runtime.isNode(), true);
    });

    it('isNode() is exactly the negation of isBun()', function() {
        assert.equal(runtime.isNode(), !runtime.isBun());
    });

});


// ---------------------------------------------------------------------------
// 03 — Bun detection via stub seam (no Bun binary required)
// ---------------------------------------------------------------------------
describe('03 - utils/runtime: Bun detection via stub seam', function() {

    it('detects Bun when process.versions.bun is present', function() {
        var had  = Object.prototype.hasOwnProperty.call(process.versions, 'bun');
        var prev = process.versions.bun;
        try {
            process.versions.bun = '1.3.14';
            assert.equal(runtime.isBun(), true);
            assert.equal(runtime.isNode(), false);
        } finally {
            if (had) { process.versions.bun = prev; }
            else     { delete process.versions.bun; }
        }
    });

    it('detects Bun when the global Bun object is present', function() {
        var had  = Object.prototype.hasOwnProperty.call(globalThis, 'Bun');
        var prev = globalThis.Bun;
        try {
            globalThis.Bun = {};
            assert.equal(runtime.isBun(), true);
            assert.equal(runtime.isNode(), false);
        } finally {
            if (had) { globalThis.Bun = prev; }
            else     { delete globalThis.Bun; }
        }
    });

    it('returns to Node detection once the stubs are removed (no leak)', function() {
        assert.equal(runtime.isBun(), false);
        assert.equal(runtime.isNode(), true);
    });

});


// ---------------------------------------------------------------------------
// 04 — source pins (lock the detection mechanism + the isNode = !isBun rule)
// ---------------------------------------------------------------------------
describe('04 - utils/runtime: source pins', function() {

    it('keys detection off process.versions.bun', function() {
        assert.match(RUNTIME_SRC, /process\.versions\.bun/);
    });

    it('defines isNode as the negation of isBun', function() {
        assert.match(RUNTIME_SRC, /return\s*!isBun\(\)/);
    });

});


// ---------------------------------------------------------------------------
// 05 — runtimeBinary under Node (the byte-identical no-op guarantee)
// ---------------------------------------------------------------------------
describe('05 - utils/runtime: runtimeBinary under Node', function() {

    it('exports runtimeBinary as a function', function() {
        assert.equal(typeof runtime.runtimeBinary, 'function');
    });

    it('returns the fallback binary verbatim (no Node delta)', function() {
        assert.equal(runtime.runtimeBinary('/usr/local/bin/node'), '/usr/local/bin/node');
        assert.equal(runtime.runtimeBinary(process.execPath), process.execPath);
    });

    it('is a pure passthrough of any string under Node', function() {
        assert.equal(runtime.runtimeBinary('anything'), 'anything');
    });

});


// ---------------------------------------------------------------------------
// 06 — runtimeBinary under Bun (stub seam — no Bun binary required)
// ---------------------------------------------------------------------------
describe('06 - utils/runtime: runtimeBinary under Bun', function() {

    var saveBun = function() {
        return {
            had  : Object.prototype.hasOwnProperty.call(process.versions, 'bun'),
            prev : process.versions.bun
        };
    };
    var restoreBun = function(s) {
        if (s.had) { process.versions.bun = s.prev; }
        else       { delete process.versions.bun; }
    };

    it('returns the Bun binary (process.execPath) when execPath looks like bun', function() {
        var s = saveBun();
        var origExec = process.execPath;
        try {
            process.versions.bun = '1.3.14';
            process.execPath = '/home/user/.bun/bin/bun';
            assert.equal(runtime.runtimeBinary('/some/which/node'), '/home/user/.bun/bin/bun');
        } finally {
            process.execPath = origExec;
            restoreBun(s);
        }
    });

    it('ignores the fallback under Bun (does not return the which-node value)', function() {
        var s = saveBun();
        var origExec = process.execPath;
        try {
            process.versions.bun = '1.3.14';
            process.execPath = '/x/.bun/bin/bun';
            assert.notEqual(runtime.runtimeBinary('/usr/local/bin/node'), '/usr/local/bin/node');
        } finally {
            process.execPath = origExec;
            restoreBun(s);
        }
    });

    it('falls back to Bun.which("bun") when execPath is not recognisably bun', function() {
        var s = saveBun();
        var origExec = process.execPath;
        var hadGlobalBun  = Object.prototype.hasOwnProperty.call(globalThis, 'Bun');
        var prevGlobalBun = globalThis.Bun;
        try {
            process.execPath = '/opt/embedded/myapp';      // not bun-looking
            globalThis.Bun = { which: function(n) { return n === 'bun' ? '/resolved/bun' : null; } };
            assert.equal(runtime.runtimeBinary('/fallback'), '/resolved/bun');
        } finally {
            process.execPath = origExec;
            if (hadGlobalBun) { globalThis.Bun = prevGlobalBun; }
            else              { delete globalThis.Bun; }
            restoreBun(s);
        }
    });

});


// ---------------------------------------------------------------------------
// 07 — runtimeBinary source pins
// ---------------------------------------------------------------------------
describe('07 - utils/runtime: runtimeBinary source pins', function() {

    it('short-circuits to the fallback under Node', function() {
        assert.match(RUNTIME_SRC, /if\s*\(\s*isNode\(\)\s*\)\s*\{\s*\n?\s*return fallbackBinary;/);
    });

    it('uses process.execPath as the Bun binary', function() {
        assert.ok(RUNTIME_SRC.indexOf('var execPath = process.execPath;') > -1);
    });

    it('has a `which bun` PATH fallback and a Bun.which fast-path', function() {
        assert.ok(RUNTIME_SRC.indexOf("'which bun'") > -1);
        assert.ok(RUNTIME_SRC.indexOf('Bun.which') > -1);
    });

    it('exports runtimeBinary', function() {
        assert.match(RUNTIME_SRC, /runtimeBinary\s*:\s*runtimeBinary/);
    });

});
