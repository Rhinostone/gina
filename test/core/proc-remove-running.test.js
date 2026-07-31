'use strict';
/**
 * #B180 — removeRunningProc() deletes the wrong procs.json entry
 *
 * Contract under test: `removeRunningProc(pid)` matches the registry entry
 * whose `.pid` field equals the argument and removes THAT entry — under its
 * own key — whatever bundle the Proc instance was constructed for. The
 * defect: the loop matched by pid but executed `delete runningProcs[bundle]`,
 * `bundle` being the constructor's closure-captured first parameter, so the
 * delete always targeted the constructing instance's own key. It worked by
 * accident when the two coincided; when they did not, a live record was
 * destroyed while the genuinely-dead matched entry survived — and when the
 * constructing bundle had no registry entry at all, the delete was a silent
 * no-op and the dead entry was rewritten back, accumulating stale records.
 *
 * Strategy: lib/proc.js cannot be require()d standalone (it loads the lib
 * registry at module scope and reads framework globals at construct time), so
 * `removeRunningProc` is EXTRACTED from the shipped source by brace-matching
 * and executed as real bytes — no drift-prone replica. The registry file is
 * modelled in memory through the function's own seams (`_`, `requireJSON`,
 * `generator.createFileFromDataSync`): the body does no direct fs access, so
 * the harness never touches a real GINA_HOMEDIR. The extraction is
 * control-gated (declaration appears exactly once; the brace walk balances; a
 * known-negative input reports failure), and `bundle` is injected as a
 * compile parameter to reproduce the constructor closure the shipped bytes
 * reference.
 *
 * All seams are synchronous, so every arm asserts after the call returns — a
 * regression can only FAIL, never hang the suite.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW   = require('../fw');
var PROC = path.join(FW, 'lib/proc.js');

var src;
before(function () { src = fs.readFileSync(PROC, 'utf8'); });

/**
 * Drop full-line comments so extraction and negative pins can never anchor on
 * a `// was:` line or a JSDoc mention.
 *
 * @param   {string} source
 * @returns {string}
 * @inner
 */
function stripComments(source) {
    return source.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

/**
 * Brace-match the `removeRunningProc` function expression out of the shipped
 * source. A line-bounded regex cannot capture the multi-line body, so the
 * opening brace is located after the declaration and the source walked until
 * depth returns to zero — safe here because the body contains no brace inside
 * a string literal.
 *
 * @param   {string} source
 * @returns {{count: number, balanced: boolean, body: (string|null)}}
 * @inner
 */
function extractRemove(source) {
    var active = stripComments(source);
    var decl   = 'var removeRunningProc = function(pid)';
    var i      = active.indexOf(decl);

    if (i < 0) {
        return { count: 0, balanced: false, body: null };
    }
    // control — a second declaration would make the slice ambiguous
    if (active.indexOf(decl, i + 1) !== -1) {
        return { count: 2, balanced: false, body: null };
    }

    var open  = active.indexOf('{', i + decl.length - 1);
    var depth = 0;
    var end   = -1;

    for (var j = open; j < active.length; j++) {
        if (active[j] === '{') {
            depth++;
        } else if (active[j] === '}') {
            depth--;
            if (depth === 0) { end = j; break; }
        }
    }

    if (end < 0 || depth !== 0) {
        return { count: 1, balanced: false, body: null };
    }

    return {
        count    : 1,
        balanced : true,
        body     : active.slice(active.indexOf('function', i), end + 1)
    };
}

/**
 * In-memory registry world: compiles the extracted bytes with the seams the
 * body closes over (`_`, GINA_HOMEDIR, requireJSON, generator) stubbed onto a
 * virtual file map, plus `bundle` reproducing the constructor closure.
 *
 * @param   {object|null} initialProcs - seeded procs.json content (null = file absent)
 * @param   {string}      bundle       - the constructing instance's bundle name
 * @returns {{remove: function, writes: object[], procsPath: string, read: function}}
 * @inner
 */
function makeWorld(initialProcs, bundle) {
    var HOME      = '/virtual/gina-home';
    var procsPath = HOME + '/procs.json';
    var files     = {};
    var writes    = [];

    if (initialProcs !== null) {
        files[procsPath] = JSON.stringify(initialProcs, null, 2);
    }

    // `_` is used both ways by the body: `_(str, true)` returns a path string,
    // `new _(path)` returns an object exposing existsSync().
    var PathStub = function (p) {
        if (this instanceof PathStub) {
            this.existsSync = function () { return typeof files[p] === 'string'; };
            return this;
        }
        return p;
    };
    var requireJSONStub = function (p) { return JSON.parse(files[p]); };
    var generatorStub   = {
        createFileFromDataSync: function (data, target) {
            writes.push({ path: target, data: data });
            files[target] = data;
        }
    };

    var remove = new Function(
        '_', 'GINA_HOMEDIR', 'requireJSON', 'generator', 'bundle',
        'return (' + extractRemove(src).body + ');'
    )(PathStub, HOME, requireJSONStub, generatorStub, bundle);

    return {
        remove    : remove,
        writes    : writes,
        procsPath : procsPath,
        read      : function () { return JSON.parse(files[procsPath]); }
    };
}


// ─── 01 — extraction controls ────────────────────────────────────────────────

describe('01 - #B180 extraction controls', function () {

    it('the removeRunningProc declaration appears exactly once', function () {
        assert.equal(extractRemove(src).count, 1);
    });

    it('the brace walk balances (extraction is complete)', function () {
        var ex = extractRemove(src);
        assert.equal(ex.balanced, true);
        assert.ok(ex.body && ex.body.length > 100);
    });

    it('the slice carries the pid-match loop (right function captured)', function () {
        var body = extractRemove(src).body;
        assert.ok(body.indexOf('for (let name in runningProcs)') > -1);
        assert.ok(body.indexOf('runningProcs[name].pid == pid') > -1);
    });

    it('known-negative: the extractor reports failure on unrelated source', function () {
        assert.equal(extractRemove('var x = 1;').count, 0);
    });
});


// ─── 02 — behaviour (the shipped bytes, driven) ──────────────────────────────

describe('02 - #B180 the matched entry is removed, not the constructing bundle\'s', function () {

    it('a non-coinciding pid removes the MATCHED (dead) entry and spares the instance\'s own', function () {
        var world = makeWorld({
            'gina-alpha': { pid: 111, title: 'gina-alpha', port: 3100 },
            'gina-beta' : { pid: 222, title: 'gina-beta',  port: 3200 }
        }, 'gina-alpha');

        world.remove(222);

        var procs = world.read();
        assert.equal(world.writes.length, 1);
        assert.ok(!('gina-beta' in procs), 'the dead matched entry must be removed');
        assert.ok('gina-alpha' in procs,   'the constructing instance\'s live entry must survive');
    });

    it('the removal lands even when the constructing bundle has no registry entry', function () {
        var world = makeWorld({
            'gina-beta': { pid: 222, title: 'gina-beta', port: 3200 }
        }, 'my-bundle');

        world.remove(222);

        var procs = world.read();
        assert.equal(world.writes.length, 1);
        assert.ok(!('gina-beta' in procs), 'the dead matched entry must be removed, not rewritten back');
        assert.deepEqual(procs, {});
    });

    it('control — the coinciding self-removal case is unchanged', function () {
        var world = makeWorld({
            'gina-alpha': { pid: 111, title: 'gina-alpha', port: 3100 },
            'gina-beta' : { pid: 222, title: 'gina-beta',  port: 3200 }
        }, 'gina-alpha');

        world.remove(111);

        var procs = world.read();
        assert.equal(world.writes.length, 1);
        assert.ok(!('gina-alpha' in procs), 'self-removal must still remove the instance\'s own entry');
        assert.ok('gina-beta' in procs);
    });

    it('control — an unmatched pid rewrites nothing', function () {
        var seeded = {
            'gina-alpha': { pid: 111, title: 'gina-alpha', port: 3100 },
            'gina-beta' : { pid: 222, title: 'gina-beta',  port: 3200 }
        };
        var world = makeWorld(seeded, 'gina-alpha');

        world.remove(999);

        assert.equal(world.writes.length, 0);
        assert.deepEqual(world.read(), seeded);
    });

    it('control — a missing registry file is a clean no-op', function () {
        var world = makeWorld(null, 'gina-alpha');

        assert.doesNotThrow(function () { world.remove(222); });
        assert.equal(world.writes.length, 0);
    });
});


// ─── 03 — source pins (structural lock) ──────────────────────────────────────

describe('03 - #B180 source pins', function () {

    it('the delete targets the matched key (active code)', function () {
        assert.ok(stripComments(src).indexOf('delete runningProcs[name]') > -1);
    });

    it('the retired closure-keyed delete is gone from active code', function () {
        assert.ok(stripComments(src).indexOf('delete runningProcs[bundle]') < 0);
    });

    it('the dismiss caller still passes the matched process-list pid', function () {
        assert.ok(src.indexOf('removeRunningProc(process.list[p].pid)') > -1);
    });
});
