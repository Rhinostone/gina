'use strict';
/**
 * Inspector SPA handler — path-traversal regression tests (#B179)
 *
 * The dev-mode Inspector static-file handler built its served filename from
 * `request.url` by raw concatenation, guarded ONLY by an existence check:
 *
 *     _bmPath = request.url.replace(/^.*\/_gina\/inspector\/?/, '').split('?')[0]
 *     _bmFile = _(_bmBase + '/' + _bmPath, true)      // `_()` NORMALISES `..`
 *     if (fs.existsSync(_bmFile)) -> readFileSync
 *
 * `_()` calls `Path.normalize` (helpers/path.js), which RESOLVES `..` rather
 * than rejecting it — so a request-target carrying a literal `..` escaped the
 * Inspector asset root and read any absolute path the bundle process could
 * reach (verified live: `GET /_gina/inspector/../../…/etc/passwd` → 200).
 * Encoded `%2e%2e` forms are NOT affected: this handler never decodes, so they
 * stay literal and miss.
 *
 * Fixed by the `confineToBase()` guard in BOTH engines (the handler is
 * duplicated, unlike the #B64 static resolvers which live only in server.js):
 *   - core/server.js        (Inspector block, `_bmFile` / `_bmBase`)
 *   - core/server.isaac.js  (Inspector block, `_inspFile` / `_inspBase`)
 *
 * Strategy (established gina idiom, mirrors server-static-traversal.test.js):
 *   §01  extract the REAL confineToBase from BOTH sources and drive them —
 *        the copies must be behaviourally identical
 *   §02  source-pins locking the server.js Inspector guard wiring
 *   §03  source-pins locking the server.isaac.js Inspector guard wiring
 *   §04  pure-logic replica over a REAL temp fs — traversal blocked on both
 *        engines, legit asset still served, encoded form still a miss
 *   §05  subtract — removing the guard leaks the out-of-base file
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW          = require('../fw');
var SRC_EXPRESS = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var SRC_ISAAC   = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');

// ── extract a REAL function body from source (brace-balanced) ────────────────
// Both copies are passed `path` under BOTH identifiers: server.js's copy closes
// over `path`, server.isaac.js's over `nodePath`.
function extractFn(src, decl) {
    var start = src.indexOf(decl);
    assert.ok(start > -1, 'declaration not found: ' + decl);
    var braceStart = src.indexOf('{', start);
    var depth = 0, i = braceStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    var fnText = src.slice(src.indexOf('function', start), i + 1);
    // eslint-disable-next-line no-new-func
    return new Function('path', 'nodePath', 'return (' + fnText + ');')(path, path);
}

var DECL          = 'var confineToBase = function(filename, base)';
var confineExpress = extractFn(SRC_EXPRESS, DECL);
var confineIsaac   = extractFn(SRC_ISAAC,   DECL);

// ── region helper: slice the Inspector block out of a source ─────────────────
function inspectorRegion(src, baseVar) {
    var s = src.indexOf('// ── Inspector SPA — served at /_gina/inspector/ in dev mode');
    assert.ok(s > -1, 'Inspector block header not found');
    var e = src.indexOf(baseVar + 'Ext', s);
    e = src.indexOf('}', src.indexOf('readFileSync', s));
    return src.slice(s, e > s ? e + 1 : s + 3000);
}


// ─── §01 — both extracted confineToBase copies ───────────────────────────────
describe('01 - confineToBase behaves identically in both engines', function() {

    var cases = [
        ['in-base child',            '/srv/insp/js/app.js',                 '/srv/insp', path.resolve('/srv/insp/js/app.js')],
        ['base itself',              '/srv/insp',                           '/srv/insp', path.resolve('/srv/insp')],
        ['literal ../ escape',       '/srv/insp/../../etc/passwd',          '/srv/insp', null],
        ['deep climb to root',       '/srv/insp/' + '../'.repeat(20) + 'etc/passwd', '/srv/insp', null],
        ['sibling dir (beemaster)',  '/srv/vendor/gina/beemaster/x.js',     '/srv/vendor/gina/inspector', null],
        ['sibling-prefix bypass',    '/srv/insp-secrets/x.js',              '/srv/insp', null],
        ['in-base non-normalized',   '/srv/insp/a/../b.js',                 '/srv/insp', path.resolve('/srv/insp/b.js')]
    ];

    cases.forEach(function(c) {
        it('server.js: ' + c[0], function() {
            assert.equal(confineExpress(c[1], c[2]), c[3]);
        });
        it('server.isaac.js: ' + c[0], function() {
            assert.equal(confineIsaac(c[1], c[2]), c[3]);
        });
    });

    it('fails closed on a null/empty base or non-string filename (both engines)', function() {
        [confineExpress, confineIsaac].forEach(function(fn) {
            assert.equal(fn('/srv/insp/x', ''), null);
            assert.equal(fn('/srv/insp/x', null), null);
            assert.equal(fn(null, '/srv/insp'), null);
        });
    });

    it('the two copies agree on every case (duplication has not drifted)', function() {
        cases.forEach(function(c) {
            assert.equal(confineExpress(c[1], c[2]), confineIsaac(c[1], c[2]),
                'engines disagree for: ' + c[0]);
        });
    });
});


// ─── §02 — server.js Inspector guard wiring (source-pins) ────────────────────
describe('02 - server.js Inspector block confines the resolved filename', function() {

    var region;
    before(function() { region = inspectorRegion(SRC_EXPRESS, '_bm'); });

    it('calls confineToBase(_bmFile, _bmBase)', function() {
        assert.ok(region.indexOf('confineToBase(_bmFile, _bmBase)') > -1,
            'expected confineToBase(_bmFile, _bmBase) in the Inspector block');
    });

    it('applies the guard BEFORE the existsSync/readFileSync sink', function() {
        var guardIdx = region.indexOf('confineToBase(_bmFile, _bmBase)');
        var readIdx  = region.indexOf('readFileSync');
        assert.ok(guardIdx > -1 && readIdx > -1, 'guard and sink must both be present');
        assert.ok(guardIdx < readIdx, 'guard must precede the file read');
    });

    it('gates the existsSync on the guard result (not a bare existsSync)', function() {
        assert.match(region,
            /confineToBase\(_bmFile,\s*_bmBase\)\s*!==\s*null\s*&&\s*fs\.existsSync\(_bmFile\)/);
    });
});


// ─── §03 — server.isaac.js Inspector guard wiring (source-pins) ──────────────
describe('03 - server.isaac.js Inspector block confines the resolved filename', function() {

    var region;
    before(function() { region = inspectorRegion(SRC_ISAAC, '_insp'); });

    it('declares its own confineToBase (server.js copy is scoped inside Server())', function() {
        assert.ok(SRC_ISAAC.indexOf(DECL) > -1,
            'expected an engine-local confineToBase declaration in server.isaac.js');
    });

    it('requires path as nodePath for the boundary check', function() {
        assert.match(SRC_ISAAC, /const\s+nodePath\s+=\s+require\('path'\)/);
    });

    it('calls confineToBase(_inspFile, _inspBase)', function() {
        assert.ok(region.indexOf('confineToBase(_inspFile, _inspBase)') > -1,
            'expected confineToBase(_inspFile, _inspBase) in the Inspector block');
    });

    it('applies the guard BEFORE the existsSync/readFileSync sink', function() {
        var guardIdx = region.indexOf('confineToBase(_inspFile, _inspBase)');
        var readIdx  = region.indexOf('readFileSync');
        assert.ok(guardIdx > -1 && readIdx > -1, 'guard and sink must both be present');
        assert.ok(guardIdx < readIdx, 'guard must precede the file read');
    });

    it('gates the existsSync on the guard result (not a bare existsSync)', function() {
        assert.match(region,
            /confineToBase\(_inspFile,\s*_inspBase\)\s*!==\s*null\s*&&\s*fs\.existsSync\(_inspFile\)/);
    });
});


// ─── §04/§05 — replica over a REAL temp fs, with subtract ────────────────────
// VERBATIM copy of the Inspector block's path build. `_()` is replaced by
// path.normalize — measured equivalent (helpers/path.js calls Path.normalize).
// GUARD toggles the fix so §05 can prove it is load-bearing.

describe('04/05 - Inspector traversal blocked end-to-end (real fs)', function() {

    var ROOT, BASE, confine;

    before(function() {
        ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b179-'));
        // mirror the real layout: <root>/vendor/gina/{inspector,beemaster}
        BASE = path.join(ROOT, 'vendor', 'gina', 'inspector');
        fs.mkdirSync(BASE, { recursive: true });
        fs.mkdirSync(path.join(ROOT, 'vendor', 'gina', 'beemaster'), { recursive: true });
        fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
        fs.writeFileSync(path.join(BASE, 'index.html'), '<html>inspector</html>');
        fs.writeFileSync(path.join(ROOT, 'vendor', 'gina', 'beemaster', 'main.js'), 'sibling');
        fs.writeFileSync(path.join(ROOT, 'config', 'secret.json'), '{"pw":"TOP-SECRET"}');
        confine = confineExpress;
    });

    after(function() { fs.rmSync(ROOT, { recursive: true, force: true }); });

    // gate + path build, verbatim from the Inspector block
    var GATE = /\/_gina\/inspector(\/.*)?$/;

    function serve(url, GUARD) {
        if (!GATE.test(url)) return '__no-match__';
        var _bmPath = url.replace(/^.*\/_gina\/inspector\/?/, '').split('?')[0];
        if (!_bmPath || _bmPath === '') _bmPath = 'index.html';
        var _bmFile = path.normalize(BASE + '/' + _bmPath);   // `_(x, true)`
        if ( GUARD && confine(_bmFile, BASE) === null ) return '__404__';
        return fs.existsSync(_bmFile) ? fs.readFileSync(_bmFile, 'utf8') : '__404__';
    }

    // ── positive controls: the handler must still work ──
    it('serves the SPA index for the bare path', function() {
        assert.equal(serve('/_gina/inspector', true), '<html>inspector</html>');
    });

    it('serves the SPA index for the trailing-slash path', function() {
        assert.equal(serve('/_gina/inspector/', true), '<html>inspector</html>');
    });

    it('serves a named in-base asset', function() {
        assert.equal(serve('/_gina/inspector/index.html', true), '<html>inspector</html>');
    });

    it('still strips the query string', function() {
        assert.equal(serve('/_gina/inspector/index.html?v=2', true), '<html>inspector</html>');
    });

    it('404s a genuinely missing in-base asset (unchanged behaviour)', function() {
        assert.equal(serve('/_gina/inspector/nope.js', true), '__404__');
    });

    // ── the traversal cases ──
    it('blocks the sibling-directory escape (beemaster)', function() {
        assert.equal(serve('/_gina/inspector/../beemaster/main.js', true), '__404__');
    });

    it('blocks an escape to a config file outside the asset root', function() {
        assert.equal(serve('/_gina/inspector/../../../config/secret.json', true), '__404__');
    });

    it('blocks a deep climb toward the filesystem root', function() {
        assert.equal(serve('/_gina/inspector/' + '../'.repeat(20) + 'etc/passwd', true), '__404__');
    });

    it('leaves the encoded %2e%2e form a plain miss (handler never decodes)', function() {
        assert.equal(serve('/_gina/inspector/%2e%2e/beemaster/main.js', true), '__404__');
    });

    // ── §05 SUBTRACT — remove the guard, the leak must return ──
    it('SUBTRACT: without the guard the sibling file leaks', function() {
        assert.equal(serve('/_gina/inspector/../beemaster/main.js', false), 'sibling');
    });

    it('SUBTRACT: without the guard the out-of-base secret leaks', function() {
        assert.equal(serve('/_gina/inspector/../../../config/secret.json', false),
            '{"pw":"TOP-SECRET"}');
    });

    it('SUBTRACT: the positive control is unaffected by the guard toggle', function() {
        // proves §05 isolates the guard and nothing else
        assert.equal(serve('/_gina/inspector/index.html', false), '<html>inspector</html>');
    });
});
