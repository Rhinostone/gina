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
 *  04 — #B51 server.js source: parseSize + byte comparison + maxSize guard + maxFields cap
 *  05 — #B51 inline logic replica: parseSize units (KB/MB/GB, bare=MB) + the back-compat tightening
 *  06 — #B51 inline logic replica: global maxFields count gate (default 1000; 0/unset disables)
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
        assert.match(active, /fs\.createWriteStream\(\s*_\(fileUploadDir \+ '\/' \+ stagedName\)/);
        assert.match(active, /tmpFilename\s*=\s*_\(fileUploadDir \+ '\/' \+ stagedName\)/);
    });

    it('no write site still uses the old bare `uploadDir` path form', function() {
        // the global decl keeps `uploadDir` as the fallback, but neither write
        // site nor tmpFilename may use the bare global as the destination.
        // #B419 retargeted this from `+ filename` to `+ stagedName`: the rename
        // made the old needle unmatchable, so it had become a control that could
        // not fire — it would have passed even if the #B49 regression returned.
        assert.doesNotMatch(active, /_\(uploadDir \+ '\/' \+ stagedName\)/);
        // instrument validation: the needle must be findable in principle, or the
        // assertion above proves nothing.
        assert.match(active, /_\(fileUploadDir \+ '\/' \+ stagedName\)/);
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

// ─── 04 — #B51 server.js source pins ──────────────────────────────────────────
describe('04 - upload limits: server.js source pins (#B51)', function() {
    var active;
    before(function() {
        active = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8'));
    });

    it('parses the maxFieldsSize unit suffix via a parseSize helper (into bytes)', function() {
        assert.match(active, /var parseSize\s*=\s*function/);
        assert.match(active, /var maxSize\s*=\s*parseSize\(opt\.maxFieldsSize\)/);
    });

    it('compares content-length in bytes (no /1024/1024 MB conversion)', function() {
        assert.match(active, /var fileSize\s*=\s*parseInt\(request\.headers\["content-length"\], 10\)/);
        assert.doesNotMatch(active, /\["content-length"\]\s*\/\s*1024\s*\/\s*1024/);
    });

    it('no longer uses the suffix-dropping parseInt on maxFieldsSize', function() {
        assert.doesNotMatch(active, /parseInt\(opt\.maxFieldsSize\)/);
    });

    it('guards the size check so 0 / unset disables the cap', function() {
        assert.match(active, /if \(maxSize && fileSize > maxSize\)/);
    });

    it('enforces a global maxFields file-count cap (HTTP 400), disabled when 0/unset', function() {
        assert.match(active, /var maxFields\s*=\s*parseInt\(opt\.maxFields, 10\)/);
        assert.match(active, /if \(\s*maxFields && fileCount > maxFields\s*\)/);
        assert.match(active, /too many upload fields/);
    });
});

// ─── 05 — #B51 parseSize replica ──────────────────────────────────────────────
describe('05 - upload size: parseSize replica (#B51)', function() {

    // mirror of the server.js parseSize helper
    function parseSize(value) {
        if ( typeof(value) === 'number' ) { return value * 1024 * 1024; }
        if ( typeof(value) !== 'string' ) { return NaN; }
        var m = value.trim().match(/^([0-9]*\.?[0-9]+)\s*(b|kb|k|mb|m|gb|g)?$/i);
        if ( !m ) { return NaN; }
        var n = parseFloat(m[1]);
        switch ( (m[2] || 'mb').toLowerCase() ) {
            case 'b':            return n;
            case 'k': case 'kb': return n * 1024;
            case 'g': case 'gb': return n * 1024 * 1024 * 1024;
            default:             return n * 1024 * 1024;
        }
    }

    var MB = 1024 * 1024, KB = 1024, GB = 1024 * 1024 * 1024;

    it('"2MB" → 2 MB in bytes (shipped default, unchanged)', function() {
        assert.equal(parseSize('2MB'), 2 * MB);
    });
    it('a bare number is treated as MB (back-compat)', function() {
        assert.equal(parseSize(2), 2 * MB);
    });
    it('a unitless numeric string defaults to MB', function() {
        assert.equal(parseSize('100'), 100 * MB);
    });
    it('"512K" / "512KB" → 512 KB (NOT 512 MB — the bug)', function() {
        assert.equal(parseSize('512K'), 512 * KB);
        assert.equal(parseSize('512KB'), 512 * KB);
    });
    it('"1GB" / "1g" → 1 GB, case-insensitive', function() {
        assert.equal(parseSize('1GB'), GB);
        assert.equal(parseSize('1g'), GB);
    });
    it('fractional values parse ("1.5MB")', function() {
        assert.equal(parseSize('1.5MB'), 1.5 * MB);
    });
    it('invalid / non-numeric / undefined / null → NaN', function() {
        assert.ok(Number.isNaN(parseSize('abc')));
        assert.ok(Number.isNaN(parseSize(undefined)));
        assert.ok(Number.isNaN(parseSize(null)));
    });

    it('the back-compat tightening: a 100 MB request is REJECTED against "512K"', function() {
        // OLD: parseInt("512K") = 512 (read as MB) → 100 < 512 → allowed (the bug).
        // NEW: parseSize("512K") = 524288 bytes → 100*MB > 524288 → rejected.
        var contentLength = 100 * MB;
        var maxSize = parseSize('512K');
        assert.equal(maxSize, 512 * KB);
        assert.equal(contentLength > maxSize, true);
    });

    it('boundary: a request exactly at the limit is allowed (strict >)', function() {
        assert.equal((2 * MB) > parseSize('2MB'), false);     // exactly 2 MB: allowed
        assert.equal((2 * MB + 1) > parseSize('2MB'), true);  // 1 byte over: rejected
    });
});

// ─── 06 — #B51 maxFields count gate replica ───────────────────────────────────
describe('06 - upload count: maxFields gate replica (#B51)', function() {

    // mirror of the server.js global maxFields cap
    function exceedsMaxFields(opt, fileCount) {
        var maxFields = parseInt(opt.maxFields, 10);
        return !!( maxFields && fileCount > maxFields );
    }

    it('default 1000 allows exactly 1000, rejects the 1001st', function() {
        assert.equal(exceedsMaxFields({ maxFields: 1000 }, 1000), false);
        assert.equal(exceedsMaxFields({ maxFields: 1000 }, 1001), true);
    });
    it('a small cap rejects past it', function() {
        assert.equal(exceedsMaxFields({ maxFields: 2 }, 2), false);
        assert.equal(exceedsMaxFields({ maxFields: 2 }, 3), true);
    });
    it('a string cap is parsed', function() {
        assert.equal(exceedsMaxFields({ maxFields: '5' }, 6), true);
    });
    it('unset maxFields disables the cap (back-compat — was unbounded)', function() {
        assert.equal(exceedsMaxFields({}, 100000), false);
    });
    it('maxFields:0 disables the cap (no limit)', function() {
        assert.equal(exceedsMaxFields({ maxFields: 0 }, 100000), false);
    });
});

// ─── 07 — #B145: mkdirSync guarded against a non-creatable dir (crash → 500) ───
// A configured group `path` whose parent is read-only / EROFS / EACCES makes
// mkdirSync throw SYNCHRONOUSLY inside the busboy 'file' callback; unguarded that
// propagates → uncaughtException → proc.js SIGTERM, an UNAUTHENTICATED single-
// request bundle-kill (the #B30/#B97 family). The guard turns it into a 500.
describe('07 - upload dir: mkdirSync guarded against a non-creatable dir (#B145)', function() {
    var active;
    before(function() {
        active = stripLineComments(fs.readFileSync(SERVER_SRC, 'utf8'));
    });

    // the #B49 mkdir pins (section 01) still hold — the existsSync/mkdirSync pair
    // is preserved verbatim INSIDE the try; here we assert the wrapping catch.
    it('the existsSync/mkdirSync pair is wrapped in try/catch', function() {
        assert.match(active, /try\s*\{[\s\S]{0,200}?fs\.mkdirSync\(fileUploadDir,\s*\{\s*recursive:\s*true\s*\}\)[\s\S]{0,80}?\}\s*catch\s*\(\s*mkdirErr\s*\)/);
    });

    it('the catch answers a guarded 500 (server config problem, not a client 400) and stops the file', function() {
        assert.match(active, /catch\s*\(\s*mkdirErr\s*\)\s*\{[\s\S]{0,300}?throwError\(response,\s*500,[\s\S]{0,140}?not creatable[\s\S]{0,220}?return false/);
    });

    // replica of the guarded dir-creation — proves a throwing mkdir degrades to a
    // captured 500 + `return false`, never a synchronous throw.
    function guardedEnsureDir(fs_, fileUploadDir, fileGroup, response, throwError) {
        try {
            if ( !fs_.existsSync(fileUploadDir) ) {
                fs_.mkdirSync(fileUploadDir, { recursive: true });
            }
        } catch (mkdirErr) {
            throwError(response, 500, 'upload destination for group `'+ fileGroup +'` is not creatable ('+ fileUploadDir +')\n' + mkdirErr);
            return false;
        }
        return true;
    }

    function throwingFs() {
        return {
            existsSync: function() { return false; },
            mkdirSync: function() { var e = new Error('EACCES: permission denied, mkdir'); e.code = 'EACCES'; throw e; }
        };
    }

    it('a non-creatable dir → captured 500 + returns false, never throws (the crash-guard)', function() {
        var codes = [];
        var result;
        assert.doesNotThrow(function() {
            result = guardedEnsureDir(throwingFs(), '/read-only/nope', 'docs', {}, function(res, code) { codes.push(code); });
        });
        assert.deepEqual(codes, [500], 'exactly one guarded 500');
        assert.equal(result, false, 'the file is stopped (return false)');
    });

    it('a creatable dir → no error, proceeds (return true)', function() {
        var codes = [];
        var okFs = { existsSync: function() { return false; }, mkdirSync: function() { /* ok */ } };
        var result = guardedEnsureDir(okFs, '/tmp/ok', 'docs', {}, function(res, code) { codes.push(code); });
        assert.deepEqual(codes, [], 'no error on a creatable dir');
        assert.equal(result, true);
    });

    // SUBTRACT — the pre-#B145 shape (no try/catch) throws SYNCHRONOUSLY, which in
    // the real busboy callback is the uncaughtException → SIGTERM bundle-kill.
    it('subtract: the unguarded pre-fix shape throws synchronously (the bundle-kill)', function() {
        function unguardedEnsureDir(fs_, fileUploadDir) {
            if ( !fs_.existsSync(fileUploadDir) ) {
                fs_.mkdirSync(fileUploadDir, { recursive: true }); // no catch
            }
        }
        assert.throws(function() { unguardedEnsureDir(throwingFs(), '/read-only/nope'); }, /EACCES/);
    });
});
