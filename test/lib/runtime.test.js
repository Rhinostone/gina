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
