'use strict';
// helpers/index.js — the helpers load in a fixed order (#B927)
//
// index.js requires every entry of its directory in the order fs.readdirSync returns it.
// Node returns a directory sorted; Bun returns it as the file system lists it. path.js,
// task.js, json and context load lib/logger, and the logger, while it loads, requires
// helpers/path, helpers/json and helpers/context back and CALLS them. When path.js or json
// is the first of the four, that call reaches a module that is still loading and throws
// `require(...) is not a function`: every process that loads the helpers before the logger
// fails. The list is now sorted, the order node has always used.
//
// The arms run in a child process: the loader runs once per process, so each order needs
// its own. The child patches fs.readdirSync for the helpers directory to hand the loader a
// chosen order, loads the helpers, and writes what happened to a file.
//
// GINA_B927_INDEX_SRC points the whole file, pins and arms, at another copy of
// helpers/index.js: the copy before the change reads red on every #B927 arm and green on
// the controls. The child compiles that copy's SOURCE at the real path, registered in the
// module cache under it, so __dirname, the relative requires and the logger's require of
// the helpers resolve as they do for the real file.
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var cp     = require('child_process');

var FW         = require('../fw');
var HELPERS    = path.join(FW, 'helpers');
var REAL_INDEX = path.join(HELPERS, 'index.js');
var INDEX_SRC  = process.env.GINA_B927_INDEX_SRC || REAL_INDEX;
var SRC        = fs.readFileSync(INDEX_SRC, 'utf8');

var tmp;
before(function() { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b927-')); });
after(function()  { fs.rmSync(tmp, { recursive: true, force: true }); });

// The child. argv[1] = the loader source to run, argv[2] = the real index.js path, argv[3] =
// the order handed to the loader (comma-separated; empty = the runtime's own), argv[4] = the
// result file. The real file is required as any module is; another copy is compiled at the
// real path and registered under it first.
var CHILD = [
    'var fs = require("fs"), path = require("path"), Module = require("module");',
    'var srcPath = process.argv[1], real = process.argv[2];',
    'var order = process.argv[3] ? process.argv[3].split(",") : [];',
    'var dir = path.dirname(real), seen = null, orig = fs.readdirSync;',
    'fs.readdirSync = function(p) {',
    '    var r = orig.apply(this, arguments);',
    '    if (path.resolve(String(p)) === dir) {',
    '        if (order.length) {',
    '            var out = order.filter(function(n) { return r.indexOf(n) > -1; });',
    '            r.forEach(function(n) { if (out.indexOf(n) < 0) { out.push(n); } });',
    '            r = out;',
    '        }',
    '        seen = r.slice();',
    '    }',
    '    return r;',
    '};',
    'var result = { seen: null, loaded: false, error: null, globals: {} };',
    'try {',
    '    if (srcPath === real) {',
    '        require(real);',
    '    } else {',
    '        var m = new Module(real, null);',
    '        m.filename = real;',
    '        m.paths = Module._nodeModulePaths(dir);',
    '        Module._cache[real] = m;',
    '        m._compile(fs.readFileSync(srcPath, "utf8"), real);',
    '    }',
    '    result.loaded = true;',
    '} catch (e) { result.error = String(e && e.message || e).slice(0, 300); }',
    'result.seen = seen;',
    'result.globals = { _: typeof _, requireJSON: typeof requireJSON, getContext: typeof getContext };',
    'fs.writeFileSync(process.argv[4], JSON.stringify(result));'
].join('\n');

/**
 * Loads the helpers in a child process, the directory listed in `order`.
 *
 * @param {Array<string>} order - the entries to list first, in this order (the rest follow);
 *   empty for the runtime's own order
 * @returns {{seen: (Array<string>|null), loaded: boolean, error: (string|null), globals: object}}
 *   `seen` is the order the loader was handed, `loaded` whether index.js ran to its end,
 *   `error` the message it threw, `globals` the typeof of `_`, `requireJSON` and `getContext`
 */
function childLoad(order) {
    var outf = path.join(tmp, 'child-' + process.hrtime.bigint() + '.json');
    var r = cp.spawnSync(process.execPath, ['-e', CHILD, INDEX_SRC, REAL_INDEX, order.join(','), outf],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    if ( !fs.existsSync(outf) ) {
        return { seen: null, loaded: false, globals: {},
            error: 'no result file; status ' + r.status + '; ' + String(r.stderr || '').slice(-300) };
    }
    return JSON.parse(fs.readFileSync(outf, 'utf8'));
}

/** `text` without its whole-line comments, so a pin never matches a `// was:` record. */
function activeLines(text) {
    return text.split('\n').filter(function(l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
}

/** The read of the directory, with nothing after it: the shape before the change. */
var UNSORTED_READ = /= fs\.readdirSync\(path\)\s*$/m;
/** The read followed by the sort. */
var SORTED_READ   = /files\s+= fs\.readdirSync\(path\)\.sort\(\)\s*$/m;

// The helpers directory's entries, besides index.js and the hidden ones, in a stable order.
var ENTRIES = fs.readdirSync(HELPERS).filter(function(n) { return !/^\./.test(n) && n !== 'index.js'; }).sort();

/** `name` first, the other entries after it. */
function first(name) {
    assert.ok(ENTRIES.indexOf(name) > -1, name + ' must be a helpers entry: ' + ENTRIES.join(','));
    return [name].concat(ENTRIES.filter(function(n) { return n !== name; }));
}

// ─── 01 — the loader's source ────────────────────────────────────────────────

describe('01 - the loader sorts the directory before it loads it', function() {

    it('01.1 - #B927: the entries are sorted, once', function() {
        assert.equal((activeLines(SRC).match(SORTED_READ) || []).length, 1, 'one sorted read');
    });

    it('01.2 - #B927: no unsorted read of the directory is left in the code', function() {
        assert.equal(UNSORTED_READ.test(activeLines(SRC)), false);
    });

    it('01.3 - CONTROL: the raw text still carries the unsorted read, so 01.2 cannot pass vacuously', function() {
        assert.equal(UNSORTED_READ.test(SRC), true);
    });
});

// ─── 02 — the helpers load whatever order the directory lists them ───────────

describe('02 - the helpers load whatever order the directory lists them', function() {

    it('02.1 - CONTROL: the harness reaches the loader — the runtime\'s own order loads, and the patched read was hit', function() {
        var r = childLoad([]);
        assert.equal(r.loaded, true, 'the loader threw: ' + JSON.stringify(r).slice(0, 400));
        assert.ok(Array.isArray(r.seen) && r.seen.indexOf('path.js') > -1,
            'the patched readdirSync must have served the helpers directory: ' + JSON.stringify(r.seen));
        assert.deepEqual(r.globals, { _: 'function', requireJSON: 'function', getContext: 'function' });
    });

    it('02.2 - CONTROL: a forced order reaches the loader — the child hands it path.js first', function() {
        var r = childLoad(first('path.js'));
        assert.ok(Array.isArray(r.seen), 'no order was seen: ' + JSON.stringify(r).slice(0, 300));
        // the loader skips index.js and the hidden entries, which the patch lists last
        assert.deepEqual(r.seen.filter(function(n) { return !/^\./.test(n) && n !== 'index.js'; }), first('path.js'));
    });

    it('02.3 - #B927: with path.js listed first, the helpers load', function() {
        var r = childLoad(first('path.js'));
        assert.equal(r.loaded, true, 'the loader threw: ' + r.error);
        assert.equal(r.globals._, 'function');
    });

    it('02.4 - #B927: with json listed first, the helpers load', function() {
        var r = childLoad(first('json'));
        assert.equal(r.loaded, true, 'the loader threw: ' + r.error);
        assert.equal(r.globals.requireJSON, 'function');
    });
});
