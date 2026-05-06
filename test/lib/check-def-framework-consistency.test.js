/**
 * script/check_def_framework_consistency.js — behavioural tests.
 *
 * Covers the orchestrating `check()` function with an injected fs
 * driver so no real ~/.gina or framework/ tree is needed.
 *
 * Negative-invariant pattern: `check()` must return `ok: false` when
 * `~/.gina/main.json`'s `def_framework` points to a framework
 * directory that does not exist on disk — even if every other input
 * succeeds. That is the exact silent drift that aborted the v0.3.10
 * stable publish on 2026-05-06 with a deep MODULE_NOT_FOUND from
 * inside `getSelectedVersion`.
 */

'use strict';

var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SCRIPT = nodePath.join(__dirname, '..', '..', 'script', 'check_def_framework_consistency.js');
var CHECK  = require(SCRIPT);


/**
 * Builds a fake fs driver from a flat record of paths → contents.
 * `existsSync` returns true when the key is present in `files`.
 * `readFileSync` returns the value (string).
 * `readdirSync` returns the list of basenames whose parent path matches the call.
 *
 * @param {object} files map of absolute path → file contents (string).
 * @param {object} dirs  map of absolute parent path → list of basenames.
 */
function fakeFs(files, dirs) {
    files = files || {};
    dirs  = dirs  || {};
    return {
        existsSync: function (p) {
            if (Object.prototype.hasOwnProperty.call(files, p)) return true;
            // A directory exists if it appears as a key in `dirs` OR as a
            // basename under one of the parent entries.
            if (Object.prototype.hasOwnProperty.call(dirs, p)) return true;
            for (var parent in dirs) {
                if (!Object.prototype.hasOwnProperty.call(dirs, parent)) continue;
                var entries = dirs[parent];
                for (var i = 0; i < entries.length; i++) {
                    if (nodePath.join(parent, entries[i]) === p) return true;
                }
            }
            return false;
        },
        readFileSync: function (p) {
            if (Object.prototype.hasOwnProperty.call(files, p)) return files[p];
            var err = new Error('ENOENT: ' + p);
            err.code = 'ENOENT';
            throw err;
        },
        readdirSync: function (p) {
            if (Object.prototype.hasOwnProperty.call(dirs, p)) return dirs[p].slice();
            var err = new Error('ENOENT: ' + p);
            err.code = 'ENOENT';
            throw err;
        }
    };
}

var GINA_HOME = '/fake/home/.gina';
var GINA_PATH = '/fake/srv/gina';
var MAIN_JSON = nodePath.join(GINA_HOME, 'main.json');


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports check', function () {
        assert.equal(typeof CHECK.check, 'function');
    });

    it('exports listFrameworkDirs', function () {
        assert.equal(typeof CHECK.listFrameworkDirs, 'function');
    });

    it('exports renderFailure', function () {
        assert.equal(typeof CHECK.renderFailure, 'function');
    });

    it('exports main', function () {
        assert.equal(typeof CHECK.main, 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — happy path: def_framework matches an existing framework dir
// ---------------------------------------------------------------------------

describe('02 - check() happy path', function () {

    it('returns ok=true when def_framework dir exists', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ def_framework: '0.3.10-alpha.2' }) },
            { [nodePath.join(GINA_PATH, 'framework')]: ['v0.3.10-alpha.2'] }
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,           true);
        assert.equal(r.reason,       'ok');
        assert.equal(r.defFramework, '0.3.10-alpha.2');
        assert.equal(r.frameworkDir, nodePath.join(GINA_PATH, 'framework', 'v0.3.10-alpha.2'));
        assert.deepEqual(r.presentDirs, ['v0.3.10-alpha.2']);
    });

    it('strips a leading "v" from def_framework before resolving', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ def_framework: 'v0.3.10-alpha.2' }) },
            { [nodePath.join(GINA_PATH, 'framework')]: ['v0.3.10-alpha.2'] }
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,           true);
        assert.equal(r.frameworkDir, nodePath.join(GINA_PATH, 'framework', 'v0.3.10-alpha.2'));
    });
});


// ---------------------------------------------------------------------------
// 03 — drift scenarios — the exact bug shape from the v0.3.10 publish
// ---------------------------------------------------------------------------

describe('03 - check() drift detection', function () {

    it('returns ok=false with reason=def_framework-drift when the dir does not exist', function () {
        // Replays the v0.3.10 stable publish failure: main.json says
        // 0.3.9 but framework dir on disk is v0.3.10-alpha.2.
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ def_framework: '0.3.9' }) },
            { [nodePath.join(GINA_PATH, 'framework')]: ['v0.3.10-alpha.2'] }
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,           false);
        assert.equal(r.reason,       'def_framework-drift');
        assert.equal(r.defFramework, '0.3.9');
        assert.equal(r.frameworkDir, nodePath.join(GINA_PATH, 'framework', 'v0.3.9'));
        assert.deepEqual(r.presentDirs, ['v0.3.10-alpha.2']);
    });

    it('reports presentDirs even when multiple framework dirs coexist', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ def_framework: '0.3.9' }) },
            { [nodePath.join(GINA_PATH, 'framework')]: ['v0.3.10-alpha.1', 'v0.3.10-alpha.2'] }
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok, false);
        assert.deepEqual(r.presentDirs, ['v0.3.10-alpha.1', 'v0.3.10-alpha.2']);
    });

    it('filters out non-v* entries from presentDirs', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ def_framework: '0.3.9' }) },
            { [nodePath.join(GINA_PATH, 'framework')]: ['v0.3.10-alpha.2', '.DS_Store', 'README.md'] }
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.deepEqual(r.presentDirs, ['v0.3.10-alpha.2']);
    });
});


// ---------------------------------------------------------------------------
// 04 — fresh-state and bad-input scenarios
// ---------------------------------------------------------------------------

describe('04 - check() fresh-state and bad-input', function () {

    it('returns ok=true with reason=main-json-absent on first install', function () {
        var fs = fakeFs({}, {});
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,           true);
        assert.equal(r.reason,       'main-json-absent');
        assert.equal(r.defFramework, null);
        assert.equal(r.frameworkDir, null);
    });

    it('returns ok=false with reason=malformed-main-json on bad JSON', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: '{ this is not valid json' },
            {}
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,     false);
        assert.equal(r.reason, 'malformed-main-json');
    });

    it('returns ok=false with reason=missing-def-framework when the field is absent', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ frameworks: {} }) },
            { [nodePath.join(GINA_PATH, 'framework')]: ['v0.3.10-alpha.2'] }
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,     false);
        assert.equal(r.reason, 'missing-def-framework');
        assert.deepEqual(r.presentDirs, ['v0.3.10-alpha.2']);
    });

    it('returns ok=false with reason=missing-def-framework when the field is empty string', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ def_framework: '' }) },
            {}
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,     false);
        assert.equal(r.reason, 'missing-def-framework');
    });

    it('returns ok=false with reason=missing-def-framework when the field is non-string', function () {
        var fs = fakeFs(
            { [MAIN_JSON]: JSON.stringify({ def_framework: 123 }) },
            {}
        );
        var r = CHECK.check({ ginaHomeDir: GINA_HOME, ginaPath: GINA_PATH, fs: fs });
        assert.equal(r.ok,     false);
        assert.equal(r.reason, 'missing-def-framework');
    });

    it('returns ok=false with reason=missing-input when ginaHomeDir is missing', function () {
        var r = CHECK.check({ ginaPath: GINA_PATH });
        assert.equal(r.ok,     false);
        assert.equal(r.reason, 'missing-input');
    });

    it('returns ok=false with reason=missing-input when ginaPath is missing', function () {
        var r = CHECK.check({ ginaHomeDir: GINA_HOME });
        assert.equal(r.ok,     false);
        assert.equal(r.reason, 'missing-input');
    });
});


// ---------------------------------------------------------------------------
// 05 — listFrameworkDirs returns [] on read failure (degraded path)
// ---------------------------------------------------------------------------

describe('05 - listFrameworkDirs degraded path', function () {

    it('returns [] when framework/ does not exist', function () {
        var fs = fakeFs({}, {}); // no entries
        var dirs = CHECK.listFrameworkDirs(GINA_PATH, fs);
        assert.deepEqual(dirs, []);
    });

    it('returns [] when readdirSync throws', function () {
        var throwing = {
            readdirSync: function () { throw new Error('EPERM'); }
        };
        var dirs = CHECK.listFrameworkDirs(GINA_PATH, throwing);
        assert.deepEqual(dirs, []);
    });
});
