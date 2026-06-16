'use strict';
/**
 * Upload config — #B49 (upload dir resolution) + #B51 (maxFields / maxFieldsSize)
 *
 * Strategy: source inspection + inline logic replica (mirrors upload-groups.test.js
 * / http-methods.test.js). No live HTTP server, no framework bootstrap, no project
 * required. One behavioural test uses a throwaway temp dir for the real mkdir guard.
 *
 * Suites:
 *  01 — #B49 server.js source: global tmpPath fallback + per-group path + mkdir guard + write sites
 *  02 — #B49 inline logic replica: dir resolution precedence (uploadDir > tmpPath > os.tmpdir; group path overrides)
 *  03 — #B49 behavioural: mkdir-if-missing creates a custom dir (real fs, throwaway dir)
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW           = require('../fw');
var SERVER_SRC   = path.join(FW, 'core/server.js');
var SETTINGS_TPL = path.join(FW, 'core/template/conf/settings.json');

// Strip full-line `//` comments so the negative pins do not trip on the
// commented-out old lines (jsdoc.md: "a negative source-inspection pin trips on
// the file's own comment").
function stripLineComments(src) {
    return src.split('\n').filter(function(l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// ─── 01 — #B49 server.js source pins ──────────────────────────────────────────
describe('01 - upload dir: server.js source pins (#B49)', function() {
    var active;
    before(function() {
        active = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8'));
    });

    it('global uploadDir now falls back to opt.tmpPath before os.tmpdir()', function() {
        assert.match(active, /var uploadDir\s*=\s*opt\.uploadDir\s*\|\|\s*opt\.tmpPath\s*\|\|\s*os\.tmpdir\(\)/);
    });

    it('per-group `path` overrides the global dir (with a fallback to it)', function() {
        assert.match(active, /var fileUploadDir\s*=\s*\(\s*opt\.groups\[fileGroup\]\s*&&\s*opt\.groups\[fileGroup\]\.path\s*\)/);
        assert.match(active, /opt\.groups\[fileGroup\]\.path[\s\S]{0,40}?:\s*uploadDir/);
    });

    it('mkdir-if-missing guards a custom (possibly non-existent) dir', function() {
        assert.match(active, /if\s*\(\s*!fs\.existsSync\(fileUploadDir\)\s*\)/);
        assert.match(active, /fs\.mkdirSync\(fileUploadDir,\s*\{\s*recursive:\s*true\s*\}\)/);
    });

    it('both write sites use the resolved per-file dir, not the bare global', function() {
        assert.match(active, /fs\.createWriteStream\(\s*_\(fileUploadDir \+ '\/' \+ filename\)/);
        assert.match(active, /tmpFilename\s*=\s*_\(fileUploadDir \+ '\/' \+ filename\)/);
    });

    it('no write site still uses the old bare `uploadDir` path form', function() {
        // the global decl keeps `uploadDir` as the fallback, but neither write
        // site nor tmpFilename may use `_(uploadDir + '/' + filename)` any more.
        assert.doesNotMatch(active, /_\(uploadDir \+ '\/' \+ filename\)/);
    });
});

// ─── 02 — #B49 inline logic replica ───────────────────────────────────────────
describe('02 - upload dir: resolution replica (#B49)', function() {

    // mirror of the server.js global decl (`:3412`)
    function resolveGlobalDir(opt, osTmp) {
        return opt.uploadDir || opt.tmpPath || osTmp;
    }
    // mirror of the per-file decl in the busboy 'file' handler (`:3597`)
    function resolveFileDir(opt, fileGroup, globalDir) {
        return ( opt.groups[fileGroup] && opt.groups[fileGroup].path )
            ? opt.groups[fileGroup].path
            : globalDir;
    }

    var OSTMP = '/os/tmp';

    it('global: uploadDir wins when set (back-compat)', function() {
        assert.equal(resolveGlobalDir({ uploadDir: '/explicit', tmpPath: '/proj/tmp' }, OSTMP), '/explicit');
    });

    it('global: tmpPath is used when uploadDir is unset', function() {
        assert.equal(resolveGlobalDir({ tmpPath: '/proj/tmp' }, OSTMP), '/proj/tmp');
    });

    it('global: os.tmpdir() is the last resort when neither is set', function() {
        assert.equal(resolveGlobalDir({}, OSTMP), OSTMP);
    });

    it('per-group: a group `path` overrides the global dir', function() {
        var opt = { tmpPath: '/proj/tmp', groups: { docs: { path: '/proj/docs' } } };
        var g = resolveGlobalDir(opt, OSTMP);
        assert.equal(resolveFileDir(opt, 'docs', g), '/proj/docs');
    });

    it('per-group: falls back to the global dir when the group declares no path', function() {
        var opt = { tmpPath: '/proj/tmp', groups: { untagged: { allowedExtensions: '*' } } };
        var g = resolveGlobalDir(opt, OSTMP);
        assert.equal(resolveFileDir(opt, 'untagged', g), '/proj/tmp');
    });

    it('full precedence: group path > global tmpPath > uploadDir > os.tmpdir()', function() {
        // group path beats everything
        var a = { uploadDir: '/u', tmpPath: '/t', groups: { x: { path: '/g' } } };
        assert.equal(resolveFileDir(a, 'x', resolveGlobalDir(a, OSTMP)), '/g');
        // no group path → global uploadDir beats tmpPath
        var b = { uploadDir: '/u', tmpPath: '/t', groups: { x: {} } };
        assert.equal(resolveFileDir(b, 'x', resolveGlobalDir(b, OSTMP)), '/u');
        // no uploadDir → tmpPath
        var c = { tmpPath: '/t', groups: { x: {} } };
        assert.equal(resolveFileDir(c, 'x', resolveGlobalDir(c, OSTMP)), '/t');
        // nothing → os.tmpdir()
        var d = { groups: { x: {} } };
        assert.equal(resolveFileDir(d, 'x', resolveGlobalDir(d, OSTMP)), OSTMP);
    });
});

// ─── 03 — #B49 behavioural: mkdir-if-missing (real fs, throwaway dir) ──────────
describe('03 - upload dir: mkdir-if-missing creates a custom dir (#B49)', function() {
    var base;
    before(function() {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b49-'));
    });
    after(function() {
        try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    // replica of the guard at server.js :3600-3602
    function ensureDir(fileUploadDir) {
        if ( !fs.existsSync(fileUploadDir) ) {
            fs.mkdirSync(fileUploadDir, { recursive: true });
        }
        return fileUploadDir;
    }

    it('creates a missing custom per-group dir (so createWriteStream cannot ENOENT)', function() {
        var custom = path.join(base, 'group', 'nested'); // does not exist yet
        assert.equal(fs.existsSync(custom), false);
        ensureDir(custom);
        assert.equal(fs.existsSync(custom), true);
        assert.equal(fs.statSync(custom).isDirectory(), true);
    });

    it('is a no-op when the dir already exists (default <project>/tmp / os.tmpdir case)', function() {
        // base already exists; ensureDir must not throw and must leave it intact
        var before = fs.readdirSync(base).length;
        ensureDir(base);
        assert.equal(fs.existsSync(base), true);
        assert.equal(fs.readdirSync(base).length >= before, true);
    });
});
