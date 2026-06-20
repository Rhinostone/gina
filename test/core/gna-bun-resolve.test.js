/**
 * core/gna.js — Bun bare-module resolution shim (Stage 2 of Bun runtime support).
 *
 * Under Node, gna.js makes bare require('lib/<name>') resolve to the framework
 * dir by appending the framework path to NODE_PATH and calling
 * Module._initPaths(). Bun reads NODE_PATH only at process start and treats
 * _initPaths() as a callable no-op, so that mechanism does nothing under Bun and
 * the bare requires used by framework entities/controllers (e.g. the render
 * delegate's require('lib/inspector-redact') at module-top) fail at request time
 * — surfacing as an HTTP 500.
 *
 * The fix installs an isBun()-gated Module._resolveFilename shim that
 * re-implements NODE_PATH fallback semantics: when the default resolver cannot
 * find a *bare* specifier, retry it against each NODE_PATH dir (which includes
 * the framework path). Default-first (so it never shadows a real package or a
 * relative/absolute request) and bare-only (relative './' '../' and absolute
 * '/' '\\' 'C:' requests are never retried). Gated on isBun() so Node keeps its
 * native NODE_PATH/_initPaths resolution untouched — zero Node-side change.
 *
 * These tests are two-layered:
 *   (a) source-inspection — the shim is isBun-gated, idempotent, default-first,
 *       bare-only, and falls back through the NODE_PATH dirs (framework path
 *       included);
 *   (b) behaviour — a pure-logic replica of the resolver proving a bare
 *       'lib/<name>' resolves through the framework fallback dir, that relative/
 *       absolute requests and genuinely-missing modules are NOT diverted, and a
 *       subtract showing the bare require fails without the shim (the Bun break).
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');

var FW  = require('../fw');
var GNA = path.join(FW, 'core/gna.js');


// ---------------------------------------------------------------------------
// 01 — source: the shim is isBun-gated, idempotent, default-first, bare-only,
//      and resolves through the NODE_PATH dirs (framework path included).
// ---------------------------------------------------------------------------
describe('01 - core/gna.js: bun resolve shim is isBun-gated and NODE_PATH-faithful', function() {

    var src;
    before(function() { src = fs.readFileSync(GNA, 'utf8'); });

    it('requires utils/runtime and gates the shim on isBun()', function() {
        assert.match(src, /require\(ctxObj\.paths\.gina\.root \+ '\/utils\/runtime'\)/,
            'must load utils/runtime via the gina root path');
        assert.match(src, /_runtime\.isBun\(\)/,
            'must gate the shim on _runtime.isBun()');
    });

    it('the Module._resolveFilename override is installed ONLY inside the isBun() gate', function() {
        var gateIdx     = src.indexOf('_runtime.isBun()');
        var overrideIdx = src.indexOf('_Module._resolveFilename =');
        assert.ok(gateIdx >= 0, 'isBun() gate present');
        assert.ok(overrideIdx >= 0, '_resolveFilename override present');
        assert.ok(overrideIdx > gateIdx,
            'the _resolveFilename reassignment must come AFTER (inside) the isBun() gate');
    });

    it('is idempotent (guarded by a patched flag)', function() {
        assert.match(src, /_ginaBunResolvePatched/,
            'must guard against double-patching with _ginaBunResolvePatched');
    });

    it('is default-first: tries the original resolver before any fallback', function() {
        // The override body tries _ginaOrigResolve with the verbatim request first,
        // then enters a catch before iterating fallback dirs.
        var bodyIdx     = src.indexOf('_Module._resolveFilename = function');
        var firstTryIdx = src.indexOf('_ginaOrigResolve.call(this, request,', bodyIdx);
        var catchIdx    = src.indexOf('catch (resolveErr)', bodyIdx);
        var fallbackIdx = src.indexOf('_ginaFallbackDirs[', bodyIdx);
        assert.ok(firstTryIdx > bodyIdx, 'tries the original resolver with the verbatim request');
        assert.ok(catchIdx > firstTryIdx, 'the fallback lives in a catch after the first attempt');
        assert.ok(fallbackIdx > catchIdx, 'the NODE_PATH-dir fallback runs only after the catch');
    });

    it('falls back through the NODE_PATH dirs with the framework path ensured', function() {
        assert.match(src, /process\.env\.NODE_PATH \|\| ''\)\.split\(_resolvePath\.delimiter\)/,
            'fallback dirs derive from NODE_PATH');
        assert.match(src, /_ginaFallbackDirs\.indexOf\(_fwPath\) < 0[\s\S]{0,80}?_ginaFallbackDirs\.push\(_fwPath\)/,
            'the framework path is ensured present in the fallback dirs');
        assert.match(src, /_resolvePath\.join\(_ginaFallbackDirs\[_gi\], request\)/,
            'each fallback attempt joins a NODE_PATH dir with the request');
    });

    it('is bare-only: relative and absolute requests are excluded from the fallback', function() {
        assert.match(src, /request\.charAt\(0\) !== '\.'/,   'excludes relative ("." prefixed) requests');
        assert.match(src, /request\.charAt\(0\) !== '\/'/,   'excludes absolute ("/" prefixed) requests');
        assert.match(src, /request\.charAt\(0\) !== '\\\\'/, 'excludes Windows-backslash requests');
        assert.match(src, /\/\^\[A-Za-z\]:\/\.test\(request\)/, 'excludes Windows drive-letter requests');
    });

});


// ---------------------------------------------------------------------------
// 02 — behaviour: a pure-logic replica of the shim proves a bare 'lib/<name>'
//      resolves through the framework fallback dir, relative/absolute/missing
//      requests are not diverted, and the pre-fix path fails (the Bun break).
// ---------------------------------------------------------------------------
describe('02 - core/gna.js: resolver shim behaviour (pure-logic replica)', function() {

    var FW_DIR = '/fw';

    // A "filesystem" of paths the default resolver can find. A bare specifier is
    // only resolvable when its absolute form is present (mirrors Bun: bare
    // require('lib/x') fails until joined with a NODE_PATH dir).
    var resolvable = new Set([
        '/fw/lib/inspector-redact',  // framework lib (reachable only via the FW fallback)
        '/fw/lib/merge',
        'fs',                        // a builtin/real package the default resolver finds directly
    ]);

    function joinPath(a, b) { return (a + '/' + b).replace(/\/{2,}/g, '/'); }

    // Mirrors Node's Module._resolveFilename for our model: exact-match lookup,
    // throws MODULE_NOT_FOUND otherwise.
    function origResolve(request) {
        if (resolvable.has(request)) { return request; }
        var err = new Error("Cannot find module '" + request + "'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }

    // EXACT shape of the implemented gna.js shim.
    function makeShim(orig, fallbackDirs) {
        return function resolveFilename(request) {
            try {
                return orig(request);
            } catch (resolveErr) {
                if (
                    typeof request === 'string'
                    && request.charAt(0) !== '.'
                    && request.charAt(0) !== '/'
                    && request.charAt(0) !== '\\'
                    && !/^[A-Za-z]:/.test(request)
                ) {
                    for (var i = 0; i < fallbackDirs.length; i++) {
                        try { return orig(joinPath(fallbackDirs[i], request)); } catch (e) {}
                    }
                }
                throw resolveErr;
            }
        };
    }

    var shim = makeShim(origResolve, [FW_DIR]);

    it('a bare lib/<name> resolves through the framework fallback dir', function() {
        assert.strictEqual(shim('lib/inspector-redact'), '/fw/lib/inspector-redact');
        assert.strictEqual(shim('lib/merge'),            '/fw/lib/merge');
    });

    it('default-first: a real package resolves directly, never via the fallback', function() {
        assert.strictEqual(shim('fs'), 'fs');
    });

    it('relative requests are NOT diverted to the framework dir', function() {
        // './lib/merge' would wrongly resolve to /fw/lib/merge if the shim
        // diverted relative requests — it must throw instead.
        assert.throws(function() { shim('./lib/merge'); }, /Cannot find module '\.\/lib\/merge'/);
    });

    it('absolute requests are NOT diverted to the framework dir', function() {
        assert.throws(function() { shim('/lib/merge'); }, /Cannot find module '\/lib\/merge'/);
    });

    it('a genuinely missing bare module throws the ORIGINAL error (not masked)', function() {
        assert.throws(
            function() { shim('totally-missing-pkg'); },
            function(e) { return e.code === 'MODULE_NOT_FOUND' && /totally-missing-pkg/.test(e.message); }
        );
    });

    it('subtract: WITHOUT the shim the bare framework require fails (the Bun break)', function() {
        assert.throws(
            function() { origResolve('lib/inspector-redact'); },
            function(e) { return e.code === 'MODULE_NOT_FOUND'; }
        );
    });

});
